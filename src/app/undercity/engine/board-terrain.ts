/**
 * Static Dokapon-style terrain prerender for the Undercity board.
 *
 * renderTerrain() paints the entire world once into an offscreen canvas that
 * BoardCanvas blits under its camera transform each frame. The board is
 * three themed chambers (each node carries a `region` tag from the backend
 * map): The Undercity (emerald gothic stone, ruins, glowing windows),
 * Mosslight Cavern (moss plateaus, mushrooms, crystals) and The Sedgemoor
 * (bog pools, reeds, gnarled trees), plus the boss island in the dark
 * hollow. Everything random is seeded (FNV-1a + mulberry32) so the map
 * never changes between loads. Pure: no DOM lookups, no I/O beyond
 * createElement('canvas').
 */
import type { BoardMap, BoardNode } from './board-canvas';
import { OVERWORLD, type LayerSpec } from './board-layers';
import { DUNGEONS, dungeonBiome } from '../data/dungeons';

/** The camera clamps to -200..world+200, so the terrain covers that margin. */
export const TERRAIN_MARGIN = 200;

export interface EdgeCurve {
  a: BoardNode;
  b: BoardNode;
  cx: number; // quadratic Bézier control point
  cy: number;
}

export interface GlowSpot {
  x: number;
  y: number;
  r: number;
  color: string; // 'r, g, b' triple, alpha applied by the animator
  phase: number; // radians offset so pulses aren't synchronized
}

export interface TerrainArt {
  canvas: HTMLCanvasElement;
  /** River shimmer + flora/window/portal glows, animated by BoardCanvas. */
  glowSpots: GlowSpot[];
}

/** Floor paintings keyed by region, ghosted onto the cave floor per chamber. */
export type FloorTextures = Partial<Record<string, HTMLImageElement>>;

/**
 * Landmark building art keyed by node type (e.g. `shrine`, `boss`). When a
 * type has art here, drawLandmark blits it instead of drawing the procedural
 * building.
 */
export type LandmarkTextures = Partial<Record<string, HTMLImageElement>>;

/**
 * Where each region's floor painting sits and how far it reaches. Radii
 * overlap on purpose: the radial alpha masks cross-fade one biome floor
 * softly into the next.
 */
interface Pt {
  x: number;
  y: number;
}

interface RegionTheme {
  top: string; // plateau surface
  cliff: string; // pseudo-height rim under the south edge
  cliffH: number; // how tall the ground reads — chunky stone vs low marsh
  mottle: string; // soft highlight blotches on the surface
  tint: string; // floor wash coloring the cave floor around the chamber
  path: { rim: string; edge: string; fill: string; stud: string };
}

const REGION_THEMES: Record<string, RegionTheme> = {
  // The Undercity — emerald-teal gothic stone (undercity_background.png).
  // Shape language: chamfered, angular masonry slabs, tall and chunky.
  city: {
    top: '#22403a',
    cliff: '#0f201c',
    cliffH: 16,
    mottle: 'rgba(80, 190, 150, 0.13)',
    tint: 'rgba(26, 92, 76, 0.22)',
    path: { rim: '#16241f', edge: '#63d494', fill: '#46605a', stud: 'rgba(198, 236, 216, 0.6)' },
  },
  // Mosslight Cavern — cool, luminous teal-green so it reads at a glance as
  // the "living" glowing chamber. Shape language: soft lumpy organic blobs.
  cavern: {
    top: '#1a4740',
    cliff: '#0a231e',
    cliffH: 13,
    mottle: 'rgba(96, 214, 190, 0.20)',
    tint: 'rgba(52, 158, 146, 0.20)',
    path: { rim: '#233028', edge: '#74f0d6', fill: '#527568', stud: 'rgba(214, 250, 240, 0.6)' },
  },
  // The Sedgemoor — murky, jaundiced brown-green so it's unmistakably the
  // opposite of the cavern. Shape language: low ragged marsh splats.
  bog: {
    top: '#343516',
    cliff: '#17170a',
    cliffH: 7,
    mottle: 'rgba(158, 150, 66, 0.14)',
    tint: 'rgba(122, 98, 30, 0.22)',
    path: { rim: '#1c1710', edge: '#a37a42', fill: '#59472c', stud: 'rgba(24, 18, 10, 0.6)' },
  },
  // Boss island — bare haunted rock, raised tall on its own plateau. Shape
  // language: jagged shards.
  isle: {
    top: '#2b2430',
    cliff: '#0d0a10',
    cliffH: 24,
    mottle: 'rgba(180, 130, 210, 0.14)',
    tint: 'rgba(96, 58, 126, 0.16)',
    path: { rim: '#171218', edge: '#6f558a', fill: '#413748', stud: 'rgba(196, 176, 216, 0.5)' },
  },
  // Gated ruins (Titan's Rest, the Sunken Vaults) — dead grey-gold stonework,
  // clearly "older" than the living chambers. Masonry silhouette like the city.
  ruin: {
    top: '#3a352a',
    cliff: '#171510',
    cliffH: 18,
    mottle: 'rgba(200, 176, 110, 0.13)',
    tint: 'rgba(140, 118, 58, 0.14)',
    path: { rim: '#1c1912', edge: '#b09454', fill: '#55492f', stud: 'rgba(226, 204, 150, 0.55)' },
  },
  // Ossuary Fields — bone-white ash flats. Masonry silhouette like the city.
  bone: {
    top: '#4a463c',
    cliff: '#1e1b15',
    cliffH: 14,
    mottle: 'rgba(220, 210, 180, 0.14)',
    tint: 'rgba(150, 140, 108, 0.16)',
    path: { rim: '#26221a', edge: '#c8bd9c', fill: '#5c5644', stud: 'rgba(230, 222, 196, 0.6)' },
  },
  // The Rot-Gardens — fertile compost greens, warmer than the cavern.
  garden: {
    top: '#33421c',
    cliff: '#16200c',
    cliffH: 12,
    mottle: 'rgba(150, 200, 90, 0.16)',
    tint: 'rgba(96, 138, 44, 0.18)',
    path: { rim: '#241d10', edge: '#8fbf50', fill: '#4c5a2e', stud: 'rgba(210, 232, 160, 0.6)' },
  },
  // Generic depths fallback — near-black nest tunnels under everything.
  depths: {
    top: '#201824',
    cliff: '#0a070c',
    cliffH: 10,
    mottle: 'rgba(150, 100, 190, 0.12)',
    tint: 'rgba(70, 40, 96, 0.18)',
    path: { rim: '#120d14', edge: '#7a4a9a', fill: '#332638', stud: 'rgba(200, 160, 240, 0.45)' },
  },
  // v6 unique dungeon themes, keyed 'dungeon:<biome>' via themeKeyFor().
  'dungeon:city': {
    // Broodwarrens — chitin browns, silk-pale paths.
    top: '#2e2218',
    cliff: '#120c08',
    cliffH: 12,
    mottle: 'rgba(216, 188, 150, 0.10)',
    tint: 'rgba(140, 96, 50, 0.20)',
    path: { rim: '#160f0a', edge: '#c9b696', fill: '#4a3826', stud: 'rgba(238, 226, 200, 0.55)' },
  },
  'dungeon:cavern': {
    // Gloomroot Hollow — deep teal with hot bioluminescent edges.
    top: '#123a38',
    cliff: '#061716',
    cliffH: 12,
    mottle: 'rgba(110, 240, 210, 0.22)',
    tint: 'rgba(40, 170, 150, 0.22)',
    path: { rim: '#0c1f1d', edge: '#8ffce2', fill: '#33544c', stud: 'rgba(220, 255, 245, 0.6)' },
  },
  'dungeon:bog': {
    // Drownedway — drowned slate blue-greens.
    top: '#1c2e30',
    cliff: '#0a1314',
    cliffH: 8,
    mottle: 'rgba(120, 180, 180, 0.12)',
    tint: 'rgba(50, 110, 120, 0.22)',
    path: { rim: '#0e1718', edge: '#6aa8a0', fill: '#2e4a4a', stud: 'rgba(180, 220, 215, 0.5)' },
  },
  'dungeon:bone': {
    // Marrow Pits — ashen bone-greys.
    top: '#3c3830',
    cliff: '#161410',
    cliffH: 14,
    mottle: 'rgba(230, 222, 200, 0.12)',
    tint: 'rgba(160, 150, 120, 0.16)',
    path: { rim: '#1c1a14', edge: '#d6cbaa', fill: '#4e483a', stud: 'rgba(240, 233, 210, 0.55)' },
  },
  'dungeon:garden': {
    // Rotcellar — hot compost browns-greens.
    top: '#33301a',
    cliff: '#14120a',
    cliffH: 12,
    mottle: 'rgba(190, 200, 90, 0.14)',
    tint: 'rgba(120, 130, 40, 0.20)',
    path: { rim: '#181608', edge: '#b9c25a', fill: '#4a4726', stud: 'rgba(230, 235, 170, 0.5)' },
  },
};

/** Theme key for a node: dungeon pockets get their own theme per biome. */
function themeKeyFor(n: BoardNode): string {
  const biome = dungeonBiome(n.id, n.region);
  return biome ? `dungeon:${biome}` : (n.region ?? 'cavern');
}

function theme(region: string | undefined): RegionTheme {
  return REGION_THEMES[region ?? 'cavern'] ?? REGION_THEMES['cavern'];
}

function hashStr(s: string): number {
  let h = 2166136261;
  for (let i = 0; i < s.length; i++) {
    h ^= s.charCodeAt(i);
    h = Math.imul(h, 16777619);
  }
  return h >>> 0;
}

function mulberry32(seed: number): () => number {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

/** Curved edges: control point = midpoint pushed perpendicular by seeded jitter. */
export function edgeCurves(map: BoardMap): EdgeCurve[] {
  const byId = new Map(map.nodes.map((n) => [n.id, n]));
  const curves: EdgeCurve[] = [];
  const seen = new Set<string>();
  for (const n of map.nodes) {
    for (const nbId of n.neighbors) {
      const key = n.id < nbId ? `${n.id}|${nbId}` : `${nbId}|${n.id}`;
      if (seen.has(key)) continue;
      seen.add(key);
      const m = byId.get(nbId);
      if (!m) continue;
      const [a, b] = n.id < nbId ? [n, m] : [m, n];
      const dx = b.x - a.x;
      const dy = b.y - a.y;
      const len = Math.hypot(dx, dy) || 1;
      const amp = Math.min(40, Math.max(14, len * 0.16));
      const j = (mulberry32(hashStr(key))() * 2 - 1) * amp;
      curves.push({
        a,
        b,
        cx: (a.x + b.x) / 2 + (-dy / len) * j,
        cy: (a.y + b.y) / 2 + (dx / len) * j,
      });
    }
  }
  return curves;
}

function sampleCurve(c: EdgeCurve, step = 40): Pt[] {
  const len = Math.hypot(c.b.x - c.a.x, c.b.y - c.a.y);
  const n = Math.max(2, Math.round(len / step));
  const pts: Pt[] = [];
  for (let i = 0; i <= n; i++) {
    const t = i / n;
    const u = 1 - t;
    pts.push({
      x: u * u * c.a.x + 2 * u * t * c.cx + t * t * c.b.x,
      y: u * u * c.a.y + 2 * u * t * c.cy + t * t * c.b.y,
    });
  }
  return pts;
}

/**
 * The underground river: out of the Mosslight Cavern, through the hollow
 * south of the boss island, draining east through the Sedgemoor. Follows
 * fixed control points with seeded wobble, dodging the discs it passes.
 */
const RIVER_BASE: Pt[] = [
  { x: -200, y: 620 },
  { x: 300, y: 700 },
  { x: 650, y: 800 },
  { x: 1000, y: 870 },
  { x: 1200, y: 890 },
  { x: 1550, y: 820 },
  { x: 1850, y: 700 },
  { x: 2100, y: 640 },
  { x: 2600, y: 600 },
  { x: 3400, y: 560 },
];

function riverPoints(map: BoardMap): Pt[] {
  const rand = mulberry32(hashStr('undercity-river'));
  const pts: Pt[] = [];
  const baseAt = (x: number): number => {
    for (let i = 1; i < RIVER_BASE.length; i++) {
      if (x <= RIVER_BASE[i].x) {
        const t = (x - RIVER_BASE[i - 1].x) / (RIVER_BASE[i].x - RIVER_BASE[i - 1].x);
        return RIVER_BASE[i - 1].y + (RIVER_BASE[i].y - RIVER_BASE[i - 1].y) * t;
      }
    }
    return RIVER_BASE[RIVER_BASE.length - 1].y;
  };
  let y = baseAt(-TERRAIN_MARGIN);
  for (let x = -TERRAIN_MARGIN; x <= map.worldW + TERRAIN_MARGIN; x += 60) {
    y += (baseAt(x) - y) * 0.3 + (rand() - 0.5) * 26;
    for (const n of map.nodes) {
      const d = Math.hypot(n.x - x, n.y - y);
      if (d < 80) y += Math.sign(y - n.y || 1) * (80 - d) * 0.5;
    }
    y = Math.max(120, Math.min(map.worldH - 120, y));
    pts.push({ x, y });
  }
  return pts;
}

function strokePolyline(
  ctx: CanvasRenderingContext2D,
  pts: Pt[],
  width: number,
  style: string,
): void {
  ctx.beginPath();
  ctx.moveTo(pts[0].x, pts[0].y);
  for (let i = 1; i < pts.length - 1; i++) {
    ctx.quadraticCurveTo(
      pts[i].x,
      pts[i].y,
      (pts[i].x + pts[i + 1].x) / 2,
      (pts[i].y + pts[i + 1].y) / 2,
    );
  }
  ctx.lineTo(pts[pts.length - 1].x, pts[pts.length - 1].y);
  ctx.lineWidth = width;
  ctx.strokeStyle = style;
  ctx.lineCap = 'round';
  ctx.lineJoin = 'round';
  ctx.stroke();
}

/**
 * A grand crossing between two regions: a wide raised deck with a stone kerb
 * down each side and a lantern post near each end. Reads as a "highway between
 * chambers" versus the narrow local paths inside a region. (Distinct from
 * drawCauseway, which is the boss island's broken stepping-stone bridge.)
 */
function drawCrossing(
  ctx: CanvasRenderingContext2D,
  c: EdgeCurve,
  glowSpots: GlowSpot[],
): void {
  const ribbon = (width: number, color: string, dy = 0): void => {
    ctx.beginPath();
    ctx.moveTo(c.a.x, c.a.y + dy);
    ctx.quadraticCurveTo(c.cx, c.cy + dy, c.b.x, c.b.y + dy);
    ctx.lineWidth = width;
    ctx.strokeStyle = color;
    ctx.lineCap = 'round';
    ctx.stroke();
  };
  ribbon(52, 'rgba(0,0,0,0.4)', 8); // drop shadow
  ribbon(48, '#20242c'); // kerb / rim
  ribbon(40, '#6b6f66'); // pale flagstone deck
  ribbon(34, '#4a4e48'); // worn center
  ribbon(3, 'rgba(230, 214, 170, 0.5)', -14); // lit kerb highlight (north)
  ribbon(3, 'rgba(0,0,0,0.35)', 15); // shaded kerb (south)
  // Lantern posts a short way in from each end, plus animated glow spots.
  const post = (t: number): void => {
    const u = 1 - t;
    const x = u * u * c.a.x + 2 * u * t * c.cx + t * t * c.b.x;
    const y = u * u * c.a.y + 2 * u * t * c.cy + t * t * c.b.y;
    ctx.fillStyle = '#2a2018';
    ctx.fillRect(x - 3, y - 30, 6, 30); // post
    ctx.fillStyle = '#ffd58a';
    ctx.beginPath();
    ctx.arc(x, y - 32, 5, 0, Math.PI * 2); // lantern head
    ctx.fill();
    glowSpots.push({ x, y: y - 32, r: 46, color: '255, 200, 130', phase: t * 6.28 });
  };
  post(0.16);
  post(0.84);
}

/**
 * Still water read as a pool RECESSED into the cave floor: a dark body with a
 * faint teal depth, a dark inner rim for sunk-in shading, and one small
 * off-center reflection. Deliberately not a bright centered dome (that reads
 * as raised/floating).
 */
function drawWater(ctx: CanvasRenderingContext2D, cx: number, cy: number, rx: number, ry: number): void {
  const TAU = Math.PI * 2;
  for (const [s, col] of [
    [1.0, '#0c1f1e'],
    [0.9, '#123632'],
    [0.68, '#184a45'],
  ] as [number, string][]) {
    ctx.beginPath();
    ctx.ellipse(cx, cy, rx * s, ry * s, 0, 0, TAU);
    ctx.fillStyle = col;
    ctx.fill();
  }
  // dark inner rim → the water sits down in the ground, not on top of it
  ctx.beginPath();
  ctx.ellipse(cx, cy, rx * 0.96, ry * 0.93, 0, 0, TAU);
  ctx.strokeStyle = 'rgba(0,0,0,0.35)';
  ctx.lineWidth = 6;
  ctx.stroke();
  // small off-center reflection, low alpha
  ctx.beginPath();
  ctx.ellipse(cx - rx * 0.24, cy - ry * 0.3, rx * 0.32, ry * 0.2, -0.2, 0, TAU);
  ctx.fillStyle = 'rgba(120, 200, 185, 0.12)';
  ctx.fill();
}

/** Pale water spilling from a rim down into the river, with foam + glow. */
function drawWaterfall(
  ctx: CanvasRenderingContext2D,
  x: number,
  top: number,
  bottom: number,
  glowSpots: GlowSpot[],
): void {
  ctx.save();
  ctx.strokeStyle = 'rgba(120, 210, 195, 0.45)';
  ctx.lineWidth = 3;
  for (let i = 0; i < 6; i++) {
    const fx = x - 22 + i * 9;
    ctx.beginPath();
    ctx.moveTo(fx, top);
    ctx.lineTo(fx + (i - 2.5) * 3, bottom);
    ctx.stroke();
  }
  ctx.fillStyle = 'rgba(180, 235, 220, 0.4)'; // foam at the base
  ctx.beginPath();
  ctx.ellipse(x, bottom, 34, 10, 0, 0, Math.PI * 2);
  ctx.fill();
  ctx.restore();
  glowSpots.push({ x, y: (top + bottom) / 2, r: 54, color: '120, 220, 205', phase: 0.7 });
}

// ── Large curated set pieces (fill dead space; one clear silhouette each) ────

function drawGiantMushroom(
  ctx: CanvasRenderingContext2D,
  x: number,
  y: number,
  rand: () => number,
  glowSpots: GlowSpot[],
): void {
  groundShadow(ctx, x, y + 2, 46, 0.3);
  // a big central cap + two smaller ones
  for (const [ox, sc] of [
    [0, 1],
    [-34, 0.55],
    [30, 0.62],
  ] as [number, number][]) {
    const cx = x + ox;
    const h = 60 * sc;
    const capR = 30 * sc;
    ctx.fillStyle = '#d3c7a6'; // stalk
    ctx.beginPath();
    ctx.moveTo(cx - 6 * sc, y);
    ctx.lineTo(cx - 4 * sc, y - h);
    ctx.lineTo(cx + 4 * sc, y - h);
    ctx.lineTo(cx + 6 * sc, y);
    ctx.closePath();
    ctx.fill();
    ctx.beginPath(); // cap
    ctx.ellipse(cx, y - h, capR, capR * 0.7, 0, Math.PI, 0);
    ctx.fillStyle = '#6f57a8';
    ctx.fill();
    ctx.beginPath(); // lit crown
    ctx.ellipse(cx - capR * 0.2, y - h - capR * 0.15, capR * 0.6, capR * 0.4, 0, Math.PI, 0);
    ctx.fillStyle = '#8f74cf';
    ctx.fill();
    ctx.beginPath(); // shaded gills
    ctx.ellipse(cx, y - h, capR, capR * 0.18, 0, 0, Math.PI);
    ctx.fillStyle = 'rgba(0,0,0,0.35)';
    ctx.fill();
    // glowing spots on the cap
    ctx.fillStyle = 'rgba(190, 160, 255, 0.8)';
    for (let i = 0; i < 3; i++) {
      ctx.beginPath();
      ctx.arc(cx + (rand() - 0.5) * capR, y - h - capR * 0.25 - rand() * capR * 0.3, 2, 0, Math.PI * 2);
      ctx.fill();
    }
  }
  glowSpots.push({ x, y: y - 50, r: 90, color: '150, 110, 230', phase: rand() * 6.28 });
}

function drawArchRuin(
  ctx: CanvasRenderingContext2D,
  x: number,
  y: number,
  rand: () => number,
  glowSpots: GlowSpot[],
): void {
  groundShadow(ctx, x, y, 66, 0.34);
  const h = 96;
  const span = 48;
  const legW = 20;
  const stone = '#20362f';
  const lit = 'rgba(120, 205, 175, 0.16)';
  const seam = 'rgba(0,0,0,0.4)';

  // Draw a masonry leg as stacked blocks with mortar seams + a lit flank.
  const leg = (lx: number, topY: number): void => {
    ctx.fillStyle = stone;
    ctx.fillRect(lx - legW / 2, topY, legW, y - topY);
    ctx.fillStyle = lit;
    ctx.fillRect(lx - legW / 2, topY, 5, y - topY);
    ctx.strokeStyle = seam;
    ctx.lineWidth = 1.5;
    for (let by = topY + 14; by < y; by += 15) {
      ctx.beginPath();
      ctx.moveTo(lx - legW / 2, by);
      ctx.lineTo(lx + legW / 2, by);
      ctx.stroke();
    }
    ctx.beginPath(); // broken, jagged crown
    ctx.moveTo(lx - legW / 2, topY);
    ctx.lineTo(lx - legW * 0.15, topY - 5 - rand() * 5);
    ctx.lineTo(lx + legW * 0.2, topY + 2);
    ctx.lineTo(lx + legW / 2, topY - 4);
    ctx.lineTo(lx + legW / 2, topY + 4);
    ctx.lineTo(lx - legW / 2, topY + 4);
    ctx.closePath();
    ctx.fillStyle = stone;
    ctx.fill();
  };

  leg(x - span, y - h);
  leg(x + span, y - h * 0.72); // right leg is more collapsed

  // The arch itself — thick voussoir band, broken away on the right side.
  ctx.beginPath();
  ctx.arc(x, y - h, span + 10, Math.PI, Math.PI * 1.72);
  ctx.lineWidth = 20;
  ctx.strokeStyle = stone;
  ctx.stroke();
  ctx.beginPath(); // moonlit top edge of the arch
  ctx.arc(x, y - h, span + 18, Math.PI, Math.PI * 1.5);
  ctx.lineWidth = 3;
  ctx.strokeStyle = lit;
  ctx.stroke();

  // Glowing keystone lantern niche.
  ctx.fillStyle = '#a8f0c0';
  ctx.beginPath();
  ctx.moveTo(x - 3, y - h - span + 6);
  ctx.lineTo(x - 3, y - h - span - 6);
  ctx.arc(x, y - h - span - 6, 3, Math.PI, 0);
  ctx.lineTo(x + 3, y - h - span + 6);
  ctx.closePath();
  ctx.fill();

  // A fallen lintel block lying in the rubble on the collapsed side.
  ctx.save();
  ctx.translate(x + span * 0.7, y - 8);
  ctx.rotate(0.5);
  ctx.fillStyle = stone;
  ctx.fillRect(-22, -9, 44, 18);
  ctx.fillStyle = lit;
  ctx.fillRect(-22, -9, 44, 3);
  ctx.restore();

  // Rubble + moss at the base.
  for (let i = 0; i < 6; i++) {
    ctx.fillStyle = i % 3 === 0 ? '#2e4a2f' : '#16241f';
    ctx.beginPath();
    ctx.ellipse(
      x + (rand() - 0.5) * span * 2.4,
      y - rand() * 7,
      6 + rand() * 9,
      4 + rand() * 4,
      0,
      0,
      Math.PI * 2,
    );
    ctx.fill();
  }
  glowSpots.push({ x, y: y - h - span, r: 46, color: '140, 230, 170', phase: rand() * 6.28 });
}

function drawBoneMound(
  ctx: CanvasRenderingContext2D,
  x: number,
  y: number,
  rand: () => number,
): void {
  groundShadow(ctx, x, y + 2, 52, 0.32);
  // heaped mound
  ctx.beginPath();
  ctx.ellipse(x, y, 48, 22, 0, Math.PI, 0);
  ctx.fillStyle = '#2a2721';
  ctx.fill();
  // skulls and ribs poking out
  for (let i = 0; i < 7; i++) {
    const sx = x + (rand() - 0.5) * 82;
    const sy = y - rand() * 20;
    const r = 5 + rand() * 4;
    ctx.fillStyle = '#cfc4a8';
    ctx.beginPath();
    ctx.arc(sx, sy, r, 0, Math.PI * 2);
    ctx.fill();
    ctx.fillStyle = '#141110';
    ctx.beginPath();
    ctx.arc(sx - r * 0.35, sy - r * 0.1, r * 0.24, 0, Math.PI * 2);
    ctx.arc(sx + r * 0.35, sy - r * 0.1, r * 0.24, 0, Math.PI * 2);
    ctx.fill();
  }
  // a couple of ribs
  ctx.strokeStyle = '#b8ad91';
  ctx.lineWidth = 2.5;
  for (let i = 0; i < 3; i++) {
    const rx = x - 30 + i * 24;
    ctx.beginPath();
    ctx.arc(rx, y - 6, 10, Math.PI * 1.1, Math.PI * 1.9);
    ctx.stroke();
  }
}

/** Broken stone causeway leading off the island's south + its ominous glow. */
function drawCauseway(
  ctx: CanvasRenderingContext2D,
  cx: number,
  cy: number,
  glowSpots: GlowSpot[],
): void {
  ctx.save();
  // Slabs march from ON the island rock (first one overlaps it) down across the
  // moat to a worn landing, so the path reads as connected, not floating.
  const slabs = [
    { dx: -30, dy: 80, w: 52, rot: 0.05 }, // rooted in the island
    { dx: -22, dy: 118, w: 46, rot: 0.1 },
    { dx: -12, dy: 152, w: 40, rot: 0.16 },
    { dx: 0, dy: 186, w: 34, rot: 0.12 },
    { dx: 10, dy: 216, w: 28, rot: 0.08 }, // last stepping stone
  ];
  for (const s of slabs) {
    ctx.save();
    ctx.translate(cx + s.dx, cy + s.dy);
    ctx.rotate(s.rot);
    ctx.fillStyle = 'rgba(0,0,0,0.4)'; // contact shadow on the water
    ctx.beginPath();
    ctx.ellipse(0, 6, s.w / 2 + 3, 9, 0, 0, Math.PI * 2);
    ctx.fill();
    ctx.fillStyle = '#2c2433'; // slab side
    ctx.fillRect(-s.w / 2, -8, s.w, 16);
    ctx.fillStyle = '#3a3044'; // lit top
    ctx.fillRect(-s.w / 2, -8, s.w, 6);
    ctx.fillStyle = 'rgba(150, 120, 175, 0.22)';
    ctx.fillRect(-s.w / 2, -8, s.w, 2);
    ctx.strokeStyle = 'rgba(0,0,0,0.35)'; // a seam
    ctx.lineWidth = 1;
    ctx.beginPath();
    ctx.moveTo(s.w * 0.1, -8);
    ctx.lineTo(s.w * 0.1, 8);
    ctx.stroke();
    ctx.restore();
  }
  ctx.restore();
  glowSpots.push({ x: cx, y: cy, r: 210, color: '150, 80, 205', phase: 1.9 });
}

export function renderTerrain(
  map: BoardMap,
  floors?: FloorTextures,
  landmarkArt?: LandmarkTextures,
  layer?: LayerSpec,
): TerrainArt {
  // A layer restricts what we draw to a node subset within a world-space
  // bounding box; default (no layer) draws the whole world (legacy behaviour).
  const bx = layer ? layer.bounds.x : 0;
  const by = layer ? layer.bounds.y : 0;
  const bw = layer ? layer.bounds.w : map.worldW;
  const bh = layer ? layer.bounds.h : map.worldH;
  const isOverworld = !layer || layer.id === OVERWORLD;
  const inLayer = (n: BoardNode): boolean => !layer || layer.nodeIds.has(n.id);
  const nodes = map.nodes.filter(inLayer);

  const w = bw + TERRAIN_MARGIN * 2;
  const h = bh + TERRAIN_MARGIN * 2;
  const canvas = document.createElement('canvas');
  canvas.width = w;
  canvas.height = h;
  const ctx = canvas.getContext('2d')!;
  // Translate so world coordinates land correctly inside this cropped canvas.
  ctx.translate(TERRAIN_MARGIN - bx, TERRAIN_MARGIN - by);
  const glowSpots: GlowSpot[] = [];
  const allCurves = edgeCurves(map);
  const curves = allCurves.filter((c) => inLayer(c.a) && inLayer(c.b));
  let river: Pt[] = [];
  const rand = mulberry32(hashStr('undercity-terrain'));

  // Region geometry, derived from node positions so terrain fits any layout.
  const regionPts = new Map<string, Pt[]>();
  for (const n of nodes) {
    const r = themeKeyFor(n);
    (regionPts.get(r) ?? regionPts.set(r, []).get(r)!).push({ x: n.x, y: n.y });
  }
  const regionZone = (r: string): { cx: number; cy: number; rad: number } => {
    const pts = regionPts.get(r) ?? [];
    const cx = pts.reduce((s, p) => s + p.x, 0) / (pts.length || 1);
    const cy = pts.reduce((s, p) => s + p.y, 0) / (pts.length || 1);
    let rad = 0;
    for (const p of pts) rad = Math.max(rad, Math.hypot(p.x - cx, p.y - cy));
    return { cx, cy, rad: rad + 200 };
  };
  const isleZone = regionZone('isle');
  const ISLAND = { cx: isleZone.cx, cy: isleZone.cy };
  const LAKE = { cx: isleZone.cx, cy: isleZone.cy + 170, rx: 300, ry: 96 };
  const FLOOR_ZONES = [...regionPts.keys()].map((r) => {
    const z = regionZone(r);
    return { region: r, cx: z.cx, cy: z.cy, r: z.rad, alpha: 0.18 };
  });
  const LABEL_NAMES: Record<string, string> = {
    city: 'The Undercity', cavern: 'Mosslight Cavern', bog: 'The Sedgemoor',
    bone: 'Ossuary Fields', garden: 'The Rot-Gardens', depths: 'The Deep',
  };

  // 1. Cavern floor: per-biome floor paintings ghosted into the dark, each
  //    masked by a radial falloff so neighboring biomes cross-fade, then
  //    mottling and per-chamber tint washes.
  ctx.fillStyle = '#141110';
  ctx.fillRect(bx - TERRAIN_MARGIN, by - TERRAIN_MARGIN, w, h);
  if (floors) {
    for (const z of FLOOR_ZONES) {
      // Dungeon zones ('dungeon:<biome>') reuse their parent biome's painting.
      const img = floors[z.region] ?? floors[z.region.replace('dungeon:', '')];
      if (!img || !img.width) continue;
      const size = z.r * 2;
      const tmp = document.createElement('canvas');
      tmp.width = size;
      tmp.height = size;
      const tc = tmp.getContext('2d')!;
      const scale = Math.max(size / img.width, size / img.height);
      tc.drawImage(
        img,
        (size - img.width * scale) / 2,
        (size - img.height * scale) / 2,
        img.width * scale,
        img.height * scale,
      );
      const mask = tc.createRadialGradient(z.r, z.r, 0, z.r, z.r, z.r);
      mask.addColorStop(0, 'rgba(0,0,0,1)');
      mask.addColorStop(0.55, 'rgba(0,0,0,0.85)');
      mask.addColorStop(1, 'rgba(0,0,0,0)');
      tc.globalCompositeOperation = 'destination-in';
      tc.fillStyle = mask;
      tc.fillRect(0, 0, size, size);
      ctx.save();
      ctx.globalAlpha = z.alpha;
      ctx.drawImage(tmp, z.cx - z.r, z.cy - z.r);
      ctx.restore();
    }
  }
  for (let i = 0; i < 320; i++) {
    const x = bx - TERRAIN_MARGIN + rand() * w;
    const y = by - TERRAIN_MARGIN + rand() * h;
    const r = 20 + rand() * 60;
    const g = ctx.createRadialGradient(x, y, 0, x, y, r);
    g.addColorStop(0, rand() > 0.5 ? 'rgba(60, 52, 42, 0.10)' : 'rgba(0, 0, 0, 0.14)');
    g.addColorStop(1, 'rgba(0,0,0,0)');
    ctx.fillStyle = g;
    ctx.fillRect(x - r, y - r, r * 2, r * 2);
  }
  for (const z of FLOOR_ZONES) {
    // Broad wash plus a tighter core so each chamber's floor reads as its
    // own color, not just its plateaus.
    for (const scale of [1, 0.55]) {
      const g = ctx.createRadialGradient(z.cx, z.cy, 0, z.cx, z.cy, z.r * scale);
      g.addColorStop(0, theme(z.region).tint);
      g.addColorStop(1, 'rgba(0,0,0,0)');
      ctx.fillStyle = g;
      ctx.fillRect(z.cx - z.r, z.cy - z.r, z.r * 2, z.r * 2);
    }
  }

  // 2. Stalagmite wall ring + central water are whole-world overworld scenery.
  if (isOverworld) {
    // Stalagmite wall ring hugging the layer border (the declared world size
    // can lag behind the real node layout, so trust the layer bounds).
    drawWalls(ctx, bx, by, bw, bh, rand);

    // 2b. Central water — the boss-island moat opening south into a still lake
    //     that the river feeds. Laid down BEFORE the plateaus and set pieces so
    //     it reads as recessed into the floor, not floating on top of it.
    ctx.fillStyle = 'rgba(0,0,0,0.5)'; // depth shadow rimming both bodies
    ctx.beginPath();
    ctx.ellipse(ISLAND.cx, ISLAND.cy + 30, 262, 140, 0, 0, Math.PI * 2);
    ctx.fill();
    ctx.beginPath();
    ctx.ellipse(LAKE.cx, LAKE.cy, LAKE.rx + 16, LAKE.ry + 14, 0, 0, Math.PI * 2);
    ctx.fill();
    drawWater(ctx, ISLAND.cx, ISLAND.cy + 16, 238, 120); // moat around the isle
    drawWater(ctx, LAKE.cx, LAKE.cy, LAKE.rx, LAKE.ry); // lake it drains into
  }

  // 3. Plateaus, grouped by region so each chamber wears its own palette AND
  //    silhouette: angular masonry (city), lumpy organic blobs (cavern), low
  //    ragged marsh splats (bog), jagged shards (isle). Cliff pass (offset
  //    down, dark) then lit top pass then mottle. Each blob keeps a seed so
  //    both passes trace the identical shape.
  const blobs = new Map<string, TerrainBlob[]>();
  const addBlob = (region: string | undefined, x: number, y: number, r: number) => {
    const key = region ?? 'cavern';
    const list = blobs.get(key) ?? [];
    list.push({ x, y, r, seed: Math.floor(rand() * 0xffffffff) });
    blobs.set(key, list);
  };
  for (const n of nodes) {
    // The island reads as one raised mass, so its nodes get chunkier plateaus.
    addBlob(themeKeyFor(n), n.x, n.y, n.region === 'isle' ? 126 + rand() * 20 : 102 + rand() * 26);
  }
  if (isOverworld) {
    // Extra isle fill so warp/ossuary/boss sit on a single solid rock, not three.
    addBlob('isle', ISLAND.cx, ISLAND.cy, 150);
    addBlob('isle', ISLAND.cx, ISLAND.cy - 40, 120);
  }
  const byId = new Map(map.nodes.map((n) => [n.id, n]));
  const isLadderLink = (c: EdgeCurve): boolean =>
    byId.get(c.a.id)?.type === 'ladder' && byId.get(c.b.id)?.type === 'ladder';
  for (const c of curves) {
    if (isLadderLink(c)) continue; // a climb, not ground — no land bridge
    const pts = sampleCurve(c, 55);
    pts.forEach((p, i) => {
      const region = i < pts.length / 2 ? themeKeyFor(c.a) : themeKeyFor(c.b);
      addBlob(region, p.x, p.y, 64 + rand() * 18);
    });
  }
  for (const [region, list] of blobs) {
    fillRegionBlobs(ctx, region, list, theme(region).cliffH, theme(region).cliff);
  }
  for (const [region, list] of blobs) {
    fillRegionBlobs(ctx, region, list, 0, theme(region).top);
  }
  for (const [region, list] of blobs) {
    for (const b of list) {
      if (rand() > 0.4) continue;
      const g = ctx.createRadialGradient(b.x, b.y - b.r * 0.2, 0, b.x, b.y, b.r * 0.8);
      g.addColorStop(0, theme(region).mottle);
      g.addColorStop(1, 'rgba(0,0,0,0)');
      ctx.fillStyle = g;
      ctx.fillRect(b.x - b.r, b.y - b.r, b.r * 2, b.r * 2);
    }
  }

  // 4. Underground river: surfaces as a fall out of the Mosslight Cavern,
  //    sweeps down to a still pool cupping the boss island, then drains east
  //    through the Sedgemoor. Paths cross it on bridges (drawn after paths).
  // The lake + moat were already laid into the floor in step 2b; here the
  // flowing river channel is stroked over the top so the systems connect.
  if (isOverworld) {
    river = riverPoints(map);
    strokePolyline(ctx, river, 40, '#0d1b1c');
    strokePolyline(ctx, river, 26, '#153f3b');
    strokePolyline(ctx, river, 10, '#2f8a85');
    // Waterfall source where it spills out of the cavern's south rim.
    drawWaterfall(ctx, 490, 600, 752, glowSpots);
    for (let i = 4; i < river.length - 4; i += 6) {
      glowSpots.push({ x: river[i].x, y: river[i].y, r: 40, color: '95, 208, 200', phase: i * 0.9 });
    }

    // 4b. Broken causeway + menacing glow on the boss island (its water moat and
    //     raised base were laid down before the plateaus in step 2b).
    drawCauseway(ctx, ISLAND.cx, ISLAND.cy, glowSpots);
  }

  // 5. Region name labels, painted into the hollow of each chamber loop.
  if (isOverworld) {
    ctx.save();
    ctx.font = 'italic 600 46px Georgia, "Times New Roman", serif';
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';
    ctx.fillStyle = 'rgba(210, 235, 220, 0.16)';
    for (const [region, name] of Object.entries(LABEL_NAMES)) {
      if (!regionPts.has(region)) continue;
      const z = regionZone(region);
      ctx.fillText(name, z.cx, z.cy);
    }
    ctx.restore();
  } else {
    // A dungeon layer gets its own name, centered on its pocket.
    const cx = nodes.reduce((s, n) => s + n.x, 0) / (nodes.length || 1);
    const cy = nodes.reduce((s, n) => s + n.y, 0) / (nodes.length || 1);
    const biome = nodes.length ? dungeonBiome(nodes[0].id, nodes[0].region) : null;
    ctx.save();
    ctx.font = 'italic 600 40px Georgia, "Times New Roman", serif';
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';
    ctx.fillStyle = 'rgba(210, 235, 220, 0.16)';
    ctx.fillText(biome ? DUNGEONS[biome].name : (LABEL_NAMES['depths'] ?? 'The Deep'), cx, cy);
    ctx.restore();
  }

  // 6. Decorations: a thinner scatter of small props (kept off
  //    nodes/paths/river).
  const pathPts = curves.flatMap((c) => sampleCurve(c, 45));

  for (let i = 0; i < 140; i++) {
    // Keep clear of the stalagmite wall band on every side.
    const x = bx + 90 + rand() * (bw - 180);
    const y = by + 90 + rand() * (bh - 180);
    let nearest: BoardNode | null = null;
    let nd = Infinity;
    for (const n of nodes) {
      const d = Math.hypot(n.x - x, n.y - y);
      if (d < nd) {
        nd = d;
        nearest = n;
      }
    }
    if (
      nd < 100 ||
      nd > 260 ||
      !nearest ||
      nearest.region === 'isle' ||
      !pathPts.every((p) => Math.hypot(p.x - x, p.y - y) > 55) ||
      !river.every((p) => Math.hypot(p.x - x, p.y - y) > 60)
    ) {
      continue;
    }
    const roll = rand();
    const nearKey = themeKeyFor(nearest);
    if (nearKey === 'bone') {
      if (roll < 0.55) drawSkullPile(ctx, x, y, rand);
      else if (roll < 0.8) drawBoneMound(ctx, x, y, rand);
      else drawPillar(ctx, x, y, rand);
    } else if (nearKey === 'garden') {
      if (roll < 0.55) drawMushrooms(ctx, x, y, rand, glowSpots);
      else if (roll < 0.8) drawGiantMushroom(ctx, x, y, rand, glowSpots);
      else drawReeds(ctx, x, y, rand);
    } else if (nearKey === 'city' || nearKey === 'ruin') {
      if (roll < 0.35) drawPillar(ctx, x, y, rand);
      else if (roll < 0.6) drawRuinBlock(ctx, x, y, rand, glowSpots);
      else if (roll < 0.8) drawArchRuin(ctx, x, y, rand, glowSpots);
      else drawSkullPile(ctx, x, y, rand);
    } else if (nearKey === 'dungeon:city') {
      if (roll < 0.5) drawEggCluster(ctx, x, y, rand, glowSpots);
      else drawWebStrand(ctx, x, y, rand);
    } else if (nearKey === 'dungeon:cavern') {
      if (roll < 0.5) drawGiantMushroom(ctx, x, y, rand, glowSpots);
      else drawMushrooms(ctx, x, y, rand, glowSpots);
    } else if (nearKey === 'dungeon:bog') {
      if (roll < 0.6) drawPool(ctx, x, y, rand, glowSpots);
      else drawReeds(ctx, x, y, rand);
    } else if (nearKey === 'dungeon:bone') {
      if (roll < 0.5) drawBoneMound(ctx, x, y, rand);
      else drawSkullPile(ctx, x, y, rand);
    } else if (nearKey === 'dungeon:garden') {
      if (roll < 0.5) drawCompostHeap(ctx, x, y, rand, glowSpots);
      else drawMushrooms(ctx, x, y, rand, glowSpots);
    } else if (nearKey === 'depths') {
      if (roll < 0.5) drawMushrooms(ctx, x, y, rand, glowSpots);
      else drawSkullPile(ctx, x, y, rand);
    } else if (nearKey === 'bog') {
      if (roll < 0.45) drawPool(ctx, x, y, rand, glowSpots);
      else if (roll < 0.75) drawReeds(ctx, x, y, rand);
      else drawBogTree(ctx, x, y, rand, glowSpots);
    } else {
      if (roll < 0.6) drawMushrooms(ctx, x, y, rand, glowSpots);
      else drawCrystal(ctx, x, y, rand, glowSpots);
    }
  }

  // 7. Path ribbons — each edge styled by its chamber (tunnels between two
  //    regions fall back to raw cavern stone).
  for (const c of curves) {
    // A climb, not a road — the stairwell landmark signals the link instead.
    if (isLadderLink(c)) continue;
    // Region-to-region overworld edges are grand causeways, not local paths.
    if (isOverworld && c.a.region !== c.b.region) {
      drawCrossing(ctx, c, glowSpots);
      continue;
    }
    const keyA = themeKeyFor(c.a);
    const keyB = themeKeyFor(c.b);
    const style = keyA === keyB ? theme(keyA).path : REGION_THEMES['cavern'].path;
    const bog = keyA === 'bog' && keyB === 'bog';
    const ribbon = (width: number, color: string, dy = 0): void => {
      ctx.beginPath();
      ctx.moveTo(c.a.x, c.a.y + dy);
      ctx.quadraticCurveTo(c.cx, c.cy + dy, c.b.x, c.b.y + dy);
      ctx.lineWidth = width;
      ctx.strokeStyle = color;
      ctx.lineCap = 'round';
      ctx.stroke();
    };
    ribbon(36, 'rgba(0,0,0,0.35)', 6); // drop shadow
    ribbon(33, style.rim);
    ribbon(28, style.edge);
    ribbon(23, style.fill);
    const pts = sampleCurve(c, bog ? 20 : 48);
    if (bog) {
      // Plank ticks across a boardwalk instead of studs.
      ctx.strokeStyle = style.stud;
      ctx.lineWidth = 3;
      for (let i = 1; i < pts.length - 1; i++) {
        const dx = pts[i + 1].x - pts[i - 1].x;
        const dy = pts[i + 1].y - pts[i - 1].y;
        const len = Math.hypot(dx, dy) || 1;
        ctx.beginPath();
        ctx.moveTo(pts[i].x - (-dy / len) * 10, pts[i].y - (dx / len) * 10);
        ctx.lineTo(pts[i].x + (-dy / len) * 10, pts[i].y + (dx / len) * 10);
        ctx.stroke();
      }
    } else {
      for (const p of pts.slice(1, -1)) {
        ctx.beginPath();
        ctx.ellipse(p.x, p.y, 4.5, 3, 0, 0, Math.PI * 2);
        ctx.fillStyle = style.stud;
        ctx.fill();
      }
    }
  }

  // 7b. Bridges: wherever a path crosses the river, lay a plank deck with rails
  //     over the ribbon so the crossing reads as a bridge, not a smear.
  const riverYAt = (x: number): number => {
    if (!river.length) return -1e9; // no river on this layer → no bridges
    let best = river[0].y;
    let bestD = Infinity;
    for (const p of river) {
      const d = Math.abs(p.x - x);
      if (d < bestD) {
        bestD = d;
        best = p.y;
      }
    }
    return best;
  };
  for (const c of curves) {
    if (isLadderLink(c)) continue; // climbs don't get bridges
    const pts = sampleCurve(c, 12);
    for (let i = 1; i < pts.length - 1; i++) {
      const p = pts[i];
      if (Math.abs(p.y - riverYAt(p.x)) > 30) continue;
      const dx = pts[i + 1].x - pts[i - 1].x;
      const dy = pts[i + 1].y - pts[i - 1].y;
      const len = Math.hypot(dx, dy) || 1;
      const nx = -dy / len;
      const ny = dx / len;
      ctx.save();
      ctx.lineCap = 'butt';
      ctx.strokeStyle = '#3a2c1c'; // deck
      ctx.lineWidth = 36;
      ctx.beginPath();
      ctx.moveTo(pts[i - 1].x, pts[i - 1].y);
      ctx.lineTo(pts[i + 1].x, pts[i + 1].y);
      ctx.stroke();
      ctx.strokeStyle = '#5a4429'; // rails
      ctx.lineWidth = 3;
      for (const s of [-19, 19]) {
        ctx.beginPath();
        ctx.moveTo(pts[i - 1].x + nx * s, pts[i - 1].y + ny * s);
        ctx.lineTo(pts[i + 1].x + nx * s, pts[i + 1].y + ny * s);
        ctx.stroke();
      }
      ctx.strokeStyle = 'rgba(210, 180, 130, 0.5)'; // planks
      ctx.lineWidth = 2;
      ctx.beginPath();
      ctx.moveTo(p.x + nx * 16, p.y + ny * 16);
      ctx.lineTo(p.x - nx * 16, p.y - ny * 16);
      ctx.stroke();
      ctx.restore();
    }
  }

  // 8. Landmarks, y-sorted so lower buildings overlap higher ones correctly
  const landmarkTypes = ['boss', 'gate', 'shop', 'shrine', 'warp', 'ossuary',
    'lair', 'vault', 'ladder'];
  const landmarks = nodes
    .filter((n) => landmarkTypes.includes(n.type))
    .sort((a, b) => a.y - b.y);
  for (const n of landmarks) drawLandmark(ctx, n, glowSpots, landmarkArt);

  // Vignette last so it shades everything toward the cave edges
  const vg = ctx.createRadialGradient(
    bx + bw / 2,
    by + bh / 2,
    Math.min(bw, bh) * 0.35,
    bx + bw / 2,
    by + bh / 2,
    Math.max(bw, bh) * 0.75,
  );
  vg.addColorStop(0, 'rgba(0,0,0,0)');
  vg.addColorStop(1, 'rgba(0,0,0,0.55)');
  ctx.fillStyle = vg;
  ctx.fillRect(bx - TERRAIN_MARGIN, by - TERRAIN_MARGIN, w, h);

  return { canvas, glowSpots };
}

interface TerrainBlob {
  x: number;
  y: number;
  r: number;
  seed: number; // shape params derive from this, identical across passes
}

/**
 * Fill one region's ground as a single unioned path so overlapping shapes
 * merge cleanly. The silhouette is the region's shape language.
 */
function fillRegionBlobs(
  ctx: CanvasRenderingContext2D,
  region: string,
  list: TerrainBlob[],
  offsetY: number,
  style: string,
): void {
  ctx.fillStyle = style;
  ctx.beginPath();
  for (const b of list) {
    const rnd = mulberry32(b.seed);
    const y = b.y + offsetY;
    if (region === 'city' || region === 'ruin' || region === 'bone' || region === 'dungeon:bone') {
      // Chamfered masonry slab, slightly rotated — sunken-plaza geometry.
      const rot = (rnd() - 0.5) * 0.3;
      const w = b.r * 2.05;
      const h = b.r * 1.4;
      const ch = Math.min(w, h) * 0.26;
      ctx.save();
      ctx.translate(b.x, y);
      ctx.rotate(rot);
      ctx.moveTo(-w / 2 + ch, -h / 2);
      ctx.lineTo(w / 2 - ch, -h / 2);
      ctx.lineTo(w / 2, -h / 2 + ch);
      ctx.lineTo(w / 2, h / 2 - ch);
      ctx.lineTo(w / 2 - ch, h / 2);
      ctx.lineTo(-w / 2 + ch, h / 2);
      ctx.lineTo(-w / 2, h / 2 - ch);
      ctx.lineTo(-w / 2, -h / 2 + ch);
      ctx.closePath();
      ctx.restore();
    } else if (region === 'bog') {
      // Low ragged marsh splat: flat core plus satellite islets.
      const ry = b.r * 0.52;
      ctx.moveTo(b.x + b.r, y);
      ctx.ellipse(b.x, y, b.r, ry, 0, 0, Math.PI * 2);
      const sats = 3 + Math.floor(rnd() * 3);
      for (let i = 0; i < sats; i++) {
        const ang = rnd() * Math.PI * 2;
        const d = b.r * (0.7 + rnd() * 0.45);
        const sr = b.r * (0.18 + rnd() * 0.24);
        const sx = b.x + Math.cos(ang) * d;
        const sy = y + Math.sin(ang) * d * 0.52;
        ctx.moveTo(sx + sr, sy);
        ctx.ellipse(sx, sy, sr, sr * 0.55, 0, 0, Math.PI * 2);
      }
    } else if (region === 'isle') {
      // Jagged rock shard: straight-edged spiky polygon.
      const spikes = 9;
      for (let i = 0; i <= spikes; i++) {
        const ang = (i / spikes) * Math.PI * 2;
        const rr = b.r * (i % 2 === 0 ? 1 : 0.68) * (0.85 + rnd() * 0.3);
        const px = b.x + Math.cos(ang) * rr;
        const py = y + Math.sin(ang) * rr * 0.78;
        if (i === 0) ctx.moveTo(px, py);
        else ctx.lineTo(px, py);
      }
      ctx.closePath();
    } else {
      // Cavern: lumpy organic blob — wobbly radius smoothed with quadratics.
      const n = 9;
      const pts: Pt[] = [];
      for (let i = 0; i < n; i++) {
        const ang = (i / n) * Math.PI * 2;
        const rr = b.r * (0.78 + rnd() * 0.34);
        pts.push({ x: b.x + Math.cos(ang) * rr, y: y + Math.sin(ang) * rr * 0.78 });
      }
      const mid = (p: Pt, q: Pt): Pt => ({ x: (p.x + q.x) / 2, y: (p.y + q.y) / 2 });
      let m = mid(pts[n - 1], pts[0]);
      ctx.moveTo(m.x, m.y);
      for (let i = 0; i < n; i++) {
        m = mid(pts[i], pts[(i + 1) % n]);
        ctx.quadraticCurveTo(pts[i].x, pts[i].y, m.x, m.y);
      }
      ctx.closePath();
    }
  }
  ctx.fill();
}

function drawWalls(
  ctx: CanvasRenderingContext2D,
  bx: number,
  by: number,
  bw: number,
  bh: number,
  rand: () => number,
): void {
  const M = TERRAIN_MARGIN;
  ctx.fillStyle = '#0a0908';
  // Solid margin bands first, then a jagged stalagmite edge biting inward.
  ctx.fillRect(bx - M, by - M, bw + 2 * M, M);
  ctx.fillRect(bx - M, by + bh, bw + 2 * M, M);
  ctx.fillRect(bx - M, by - M, M, bh + 2 * M);
  ctx.fillRect(bx + bw, by - M, M, bh + 2 * M);
  const spikes = (x0: number, y0: number, x1: number, y1: number, inX: number, inY: number): void => {
    const len = Math.hypot(x1 - x0, y1 - y0);
    const n = Math.round(len / 55);
    ctx.beginPath();
    ctx.moveTo(x0, y0);
    for (let i = 0; i <= n; i++) {
      const t = i / n;
      const depth = 40 + rand() * 70;
      ctx.lineTo(x0 + (x1 - x0) * t + inX * depth, y0 + (y1 - y0) * t + inY * depth);
    }
    ctx.lineTo(x1, y1);
    ctx.closePath();
    ctx.fill();
  };
  spikes(bx, by, bx + bw, by, 0, 1);
  spikes(bx, by + bh, bx + bw, by + bh, 0, -1);
  spikes(bx, by, bx, by + bh, 1, 0);
  spikes(bx + bw, by, bx + bw, by + bh, -1, 0);
}

// ── Decorations (all 2.5D: lit faces, top/side planes, grounded by shadow) ───

/** Soft elliptical contact shadow that seats a decoration on the ground. */
function groundShadow(
  ctx: CanvasRenderingContext2D,
  x: number,
  y: number,
  rx: number,
  alpha = 0.3,
): void {
  ctx.beginPath();
  ctx.ellipse(x, y + 1, rx, rx * 0.36, 0, 0, Math.PI * 2);
  ctx.fillStyle = `rgba(0,0,0,${alpha})`;
  ctx.fill();
}

function drawMushrooms(
  ctx: CanvasRenderingContext2D,
  x: number,
  y: number,
  rand: () => number,
  glowSpots: GlowSpot[],
): void {
  const teal = rand() < 0.4;
  const cap = teal ? '#3f8f8a' : '#7a5fae';
  const glow = teal ? '95, 208, 200' : '186, 148, 255';
  const count = 2 + Math.floor(rand() * 2);
  groundShadow(ctx, x, y + 2, 16, 0.25);
  for (let i = 0; i < count; i++) {
    const mx = x + (rand() - 0.5) * 26;
    const my = y + (rand() - 0.5) * 14;
    const s = 5 + rand() * 6;
    ctx.fillStyle = '#c9bfa4';
    ctx.fillRect(mx - s * 0.18, my - s, s * 0.36, s);
    ctx.beginPath();
    ctx.ellipse(mx, my - s, s, s * 0.62, 0, Math.PI, 0);
    ctx.fillStyle = cap;
    ctx.fill();
    ctx.beginPath(); // dimmer underside lip
    ctx.ellipse(mx, my - s, s, s * 0.2, 0, 0, Math.PI);
    ctx.fillStyle = 'rgba(0,0,0,0.35)';
    ctx.fill();
  }
  glowSpots.push({ x, y: y - 8, r: 30, color: glow, phase: rand() * 6.28 });
}

function drawCrystal(
  ctx: CanvasRenderingContext2D,
  x: number,
  y: number,
  rand: () => number,
  glowSpots: GlowSpot[],
): void {
  const n = 2 + Math.floor(rand() * 2);
  groundShadow(ctx, x, y + 1, 14, 0.25);
  for (let i = 0; i < n; i++) {
    const cx = x + (rand() - 0.5) * 20;
    const hgt = 12 + rand() * 14;
    const wid = 4 + rand() * 4;
    ctx.beginPath();
    ctx.moveTo(cx - wid, y);
    ctx.lineTo(cx - wid * 0.3, y - hgt);
    ctx.lineTo(cx + wid * 0.4, y - hgt * 0.75);
    ctx.lineTo(cx + wid, y);
    ctx.closePath();
    ctx.fillStyle = 'rgba(188, 214, 208, 0.85)';
    ctx.fill();
    ctx.beginPath(); // lit facet
    ctx.moveTo(cx - wid * 0.3, y - hgt);
    ctx.lineTo(cx + wid * 0.4, y - hgt * 0.75);
    ctx.lineTo(cx, y);
    ctx.closePath();
    ctx.fillStyle = 'rgba(255,255,255,0.35)';
    ctx.fill();
  }
  glowSpots.push({ x, y: y - 10, r: 26, color: '188, 230, 220', phase: rand() * 6.28 });
}

// ── Undercity (city) decorations ─────────────────────────────────────────────

function drawPillar(
  ctx: CanvasRenderingContext2D,
  x: number,
  y: number,
  rand: () => number,
): void {
  const hgt = 22 + rand() * 18;
  const wid = 7 + rand() * 4;
  groundShadow(ctx, x, y, wid * 1.4);
  // plinth as a 2.5D slab: top face + front face
  ctx.fillStyle = '#2a473f';
  ctx.beginPath();
  ctx.ellipse(x, y - 4, wid * 0.9 + 2, (wid * 0.9 + 2) * 0.45, 0, 0, Math.PI * 2);
  ctx.fill();
  ctx.fillStyle = '#1f3630';
  ctx.beginPath();
  ctx.ellipse(x, y - 1, wid * 0.9 + 2, (wid * 0.9 + 2) * 0.45, 0, 0, Math.PI);
  ctx.fill();
  // shaft: lit west flank, shaded east flank
  ctx.fillStyle = '#2a473f';
  ctx.fillRect(x - wid / 2, y - hgt, wid, hgt - 3);
  ctx.fillStyle = 'rgba(120, 200, 170, 0.18)';
  ctx.fillRect(x - wid / 2, y - hgt, wid * 0.3, hgt - 3);
  ctx.fillStyle = 'rgba(0,0,0,0.28)';
  ctx.fillRect(x + wid / 2 - wid * 0.25, y - hgt, wid * 0.25, hgt - 3);
  // broken, jagged top with a pale fracture face catching the light
  ctx.fillStyle = '#3b5c50';
  ctx.beginPath();
  ctx.moveTo(x - wid / 2, y - hgt);
  ctx.lineTo(x - wid * 0.1, y - hgt - 4 - rand() * 4);
  ctx.lineTo(x + wid * 0.2, y - hgt + 2);
  ctx.lineTo(x + wid / 2, y - hgt - 3);
  ctx.lineTo(x + wid / 2, y - hgt + 3);
  ctx.lineTo(x - wid / 2, y - hgt + 3);
  ctx.closePath();
  ctx.fill();
}

function drawRuinBlock(
  ctx: CanvasRenderingContext2D,
  x: number,
  y: number,
  rand: () => number,
  glowSpots: GlowSpot[],
): void {
  const wid = 26 + rand() * 18;
  const hgt = 20 + rand() * 16;
  const d = 5 + rand() * 3; // 2.5D box depth
  groundShadow(ctx, x + d / 2, y, wid * 0.62 + d);
  // front face
  ctx.fillStyle = '#1c332d';
  ctx.fillRect(x - wid / 2, y - hgt, wid, hgt);
  // lit top face (skewed toward the upper-right)
  ctx.fillStyle = '#31514a';
  ctx.beginPath();
  ctx.moveTo(x - wid / 2, y - hgt);
  ctx.lineTo(x + wid / 2, y - hgt);
  ctx.lineTo(x + wid / 2 + d, y - hgt - d);
  ctx.lineTo(x - wid / 2 + d, y - hgt - d);
  ctx.closePath();
  ctx.fill();
  // shaded side face
  ctx.fillStyle = '#12241f';
  ctx.beginPath();
  ctx.moveTo(x + wid / 2, y - hgt);
  ctx.lineTo(x + wid / 2 + d, y - hgt - d);
  ctx.lineTo(x + wid / 2 + d, y - d);
  ctx.lineTo(x + wid / 2, y);
  ctx.closePath();
  ctx.fill();
  // glowing gothic windows
  const windows = 1 + Math.floor(rand() * 3);
  ctx.fillStyle = '#a8f0c0';
  for (let i = 0; i < windows; i++) {
    const wx = x - wid / 2 + 5 + i * ((wid - 10) / Math.max(1, windows - 1) || 0);
    const wy = y - hgt + 5 + rand() * (hgt - 14);
    ctx.beginPath();
    ctx.moveTo(wx - 2, wy + 6);
    ctx.lineTo(wx - 2, wy + 1);
    ctx.arc(wx, wy + 1, 2, Math.PI, 0);
    ctx.lineTo(wx + 2, wy + 6);
    ctx.closePath();
    ctx.fill();
  }
  glowSpots.push({ x, y: y - hgt / 2, r: 30, color: '140, 230, 170', phase: rand() * 6.28 });
}

function drawSkullPile(
  ctx: CanvasRenderingContext2D,
  x: number,
  y: number,
  rand: () => number,
): void {
  const n = 2 + Math.floor(rand() * 2);
  groundShadow(ctx, x, y + 3, 12, 0.25);
  for (let i = 0; i < n; i++) {
    const sx = x + (rand() - 0.5) * 16;
    const sy = y - rand() * 8;
    const r = 3.5 + rand() * 2.5;
    ctx.fillStyle = '#cfc4a8';
    ctx.beginPath();
    ctx.arc(sx, sy, r, 0, Math.PI * 2);
    ctx.fill();
    ctx.fillStyle = 'rgba(0,0,0,0.22)'; // shaded underside
    ctx.beginPath();
    ctx.arc(sx, sy + r * 0.45, r * 0.85, 0.35, Math.PI - 0.35);
    ctx.fill();
    ctx.fillStyle = '#141110';
    ctx.beginPath();
    ctx.arc(sx - r * 0.35, sy - r * 0.1, r * 0.22, 0, Math.PI * 2);
    ctx.arc(sx + r * 0.35, sy - r * 0.1, r * 0.22, 0, Math.PI * 2);
    ctx.fill();
  }
}

// ── Sedgemoor (bog) decorations ──────────────────────────────────────────────

function drawPool(
  ctx: CanvasRenderingContext2D,
  x: number,
  y: number,
  rand: () => number,
  glowSpots: GlowSpot[],
): void {
  const rx = 20 + rand() * 22;
  const ry = rx * (0.4 + rand() * 0.15);
  ctx.beginPath();
  ctx.ellipse(x, y, rx, ry, 0, 0, Math.PI * 2);
  ctx.fillStyle = '#101f1a';
  ctx.fill();
  ctx.beginPath();
  ctx.ellipse(x, y, rx * 0.82, ry * 0.78, 0, 0, Math.PI * 2);
  ctx.fillStyle = '#1a332a';
  ctx.fill();
  ctx.beginPath(); // still-water sheen
  ctx.ellipse(x - rx * 0.2, y - ry * 0.25, rx * 0.42, ry * 0.3, -0.3, 0, Math.PI * 2);
  ctx.fillStyle = 'rgba(110, 190, 160, 0.18)';
  ctx.fill();
  ctx.beginPath(); // lit far rim sinks the pool below ground level
  ctx.ellipse(x, y, rx * 0.94, ry * 0.9, 0, Math.PI * 0.15, Math.PI * 0.85);
  ctx.strokeStyle = 'rgba(150, 190, 140, 0.25)';
  ctx.lineWidth = 1.5;
  ctx.stroke();
  const pads = 1 + Math.floor(rand() * 3);
  ctx.fillStyle = '#4a7a3f';
  for (let i = 0; i < pads; i++) {
    const px = x + (rand() - 0.5) * rx * 1.2;
    const py = y + (rand() - 0.5) * ry * 1.2;
    ctx.beginPath();
    ctx.ellipse(px, py, 4 + rand() * 3, 2.5 + rand() * 2, rand(), 0.25, Math.PI * 2);
    ctx.fill();
  }
  glowSpots.push({ x, y, r: 34, color: '150, 220, 180', phase: rand() * 6.28 });
}

function drawReeds(
  ctx: CanvasRenderingContext2D,
  x: number,
  y: number,
  rand: () => number,
): void {
  const n = 3 + Math.floor(rand() * 3);
  for (let i = 0; i < n; i++) {
    const rx = x + (rand() - 0.5) * 22;
    const hgt = 12 + rand() * 12;
    const lean = (rand() - 0.5) * 6;
    ctx.strokeStyle = '#5a6b3a';
    ctx.lineWidth = 1.5;
    ctx.beginPath();
    ctx.moveTo(rx, y);
    ctx.quadraticCurveTo(rx + lean * 0.4, y - hgt * 0.6, rx + lean, y - hgt);
    ctx.stroke();
    if (rand() < 0.6) {
      // cattail tip
      ctx.fillStyle = '#7a5a3a';
      ctx.beginPath();
      ctx.ellipse(rx + lean, y - hgt, 1.8, 4, 0, 0, Math.PI * 2);
      ctx.fill();
    }
  }
}

function drawBogTree(
  ctx: CanvasRenderingContext2D,
  x: number,
  y: number,
  rand: () => number,
  glowSpots: GlowSpot[],
): void {
  const hgt = 30 + rand() * 22;
  const lean = (rand() - 0.5) * 16;
  groundShadow(ctx, x, y + 1, 14, 0.28);
  ctx.strokeStyle = '#10150c';
  ctx.lineWidth = 5;
  ctx.lineCap = 'round';
  ctx.beginPath(); // gnarled trunk
  ctx.moveTo(x, y);
  ctx.quadraticCurveTo(x - lean, y - hgt * 0.55, x + lean, y - hgt);
  ctx.stroke();
  ctx.lineWidth = 2.5;
  ctx.beginPath(); // low branch
  ctx.moveTo(x - lean * 0.3, y - hgt * 0.5);
  ctx.lineTo(x - lean * 0.3 - 10 - rand() * 8, y - hgt * 0.62);
  ctx.stroke();
  // mossy canopy blobs, each with a moonlit top
  for (let i = 0; i < 3; i++) {
    const bx = x + lean + (rand() - 0.5) * 20;
    const by = y - hgt + (rand() - 0.5) * 10;
    const brx = 10 + rand() * 8;
    const bry = 6 + rand() * 4;
    ctx.fillStyle = '#232e18';
    ctx.beginPath();
    ctx.ellipse(bx, by, brx, bry, 0, 0, Math.PI * 2);
    ctx.fill();
    ctx.fillStyle = '#33421f';
    ctx.beginPath();
    ctx.ellipse(bx - brx * 0.15, by - bry * 0.3, brx * 0.65, bry * 0.5, 0, 0, Math.PI * 2);
    ctx.fill();
  }
  if (rand() < 0.5) {
    // a wisp drifting near the tree
    glowSpots.push({
      x: x + (rand() - 0.5) * 30,
      y: y - hgt * 0.4,
      r: 20,
      color: '190, 230, 170',
      phase: rand() * 6.28,
    });
  }
}

/**
 * A stone stairwell at a ladder space: an arched opening in the ground with
 * receding steps. `down` shades the opening dark (a descent into the hidden
 * dungeon); otherwise it's lit as an ascent back to the surface.
 */
function drawStairwell(
  ctx: CanvasRenderingContext2D,
  x: number,
  y: number,
  down: boolean,
): void {
  groundShadow(ctx, x, y + 6, 40, 0.4);
  const w = 46;
  const top = y - 40;
  // Arched stone frame.
  ctx.fillStyle = '#2b2622';
  ctx.beginPath();
  ctx.moveTo(x - w / 2, y + 8);
  ctx.lineTo(x - w / 2, top + 12);
  ctx.arc(x, top + 12, w / 2, Math.PI, 0);
  ctx.lineTo(x + w / 2, y + 8);
  ctx.closePath();
  ctx.fill();
  // Receding steps: lighter (ascending) or darkening into black (descending).
  const steps = 5;
  for (let i = 0; i < steps; i++) {
    const t = i / steps;
    const sw = (w - 12) * (1 - t * 0.5);
    const sy = y - 2 - i * 6;
    const shade = down ? Math.round(70 - t * 60) : Math.round(90 + t * 60);
    ctx.fillStyle = `rgb(${shade}, ${shade - 6}, ${shade - 14})`;
    ctx.fillRect(x - sw / 2, sy, sw, 5);
  }
  // Lit stone rim on the arch.
  ctx.strokeStyle = 'rgba(220, 200, 160, 0.28)';
  ctx.lineWidth = 3;
  ctx.beginPath();
  ctx.arc(x, top + 12, w / 2, Math.PI, 0);
  ctx.stroke();
}

// ── v6 dungeon decorations ───────────────────────────────────────────────────

/** Broodwarrens: a cluster of pulsing eggs half-buried in the floor. */
function drawEggCluster(
  ctx: CanvasRenderingContext2D,
  x: number,
  y: number,
  rand: () => number,
  glowSpots: GlowSpot[],
): void {
  groundShadow(ctx, x, y + 2, 20, 0.3);
  const n = 3 + Math.floor(rand() * 3);
  for (let i = 0; i < n; i++) {
    const ex = x + (rand() - 0.5) * 30;
    const ey = y - rand() * 10;
    const r = 5 + rand() * 5;
    ctx.beginPath();
    ctx.ellipse(ex, ey, r * 0.8, r, 0, 0, Math.PI * 2);
    ctx.fillStyle = '#d8c9a8';
    ctx.fill();
    ctx.beginPath(); // membrane highlight
    ctx.ellipse(ex - r * 0.25, ey - r * 0.35, r * 0.3, r * 0.4, -0.3, 0, Math.PI * 2);
    ctx.fillStyle = 'rgba(255, 250, 230, 0.45)';
    ctx.fill();
    ctx.beginPath(); // dark embryo shadow
    ctx.ellipse(ex + r * 0.1, ey + r * 0.15, r * 0.35, r * 0.45, 0.2, 0, Math.PI * 2);
    ctx.fillStyle = 'rgba(90, 60, 40, 0.4)';
    ctx.fill();
  }
  glowSpots.push({ x, y: y - 8, r: 30, color: '230, 200, 150', phase: rand() * 6.28 });
}

/** Broodwarrens: a taut silk strand with hanging droplets. */
function drawWebStrand(
  ctx: CanvasRenderingContext2D,
  x: number,
  y: number,
  rand: () => number,
): void {
  const span = 30 + rand() * 26;
  const sag = 8 + rand() * 8;
  ctx.strokeStyle = 'rgba(230, 225, 210, 0.35)';
  ctx.lineWidth = 1.5;
  ctx.beginPath();
  ctx.moveTo(x - span / 2, y - 26 - rand() * 14);
  ctx.quadraticCurveTo(x, y - 26 + sag, x + span / 2, y - 30 - rand() * 10);
  ctx.stroke();
  ctx.fillStyle = 'rgba(240, 238, 228, 0.5)';
  for (let i = 0; i < 3; i++) {
    ctx.beginPath();
    ctx.arc(x - span / 2 + rand() * span, y - 24 + rand() * sag, 1.4, 0, Math.PI * 2);
    ctx.fill();
  }
}

/** Rotcellar: a steaming compost heap. */
function drawCompostHeap(
  ctx: CanvasRenderingContext2D,
  x: number,
  y: number,
  rand: () => number,
  glowSpots: GlowSpot[],
): void {
  groundShadow(ctx, x, y + 2, 26, 0.3);
  ctx.beginPath();
  ctx.ellipse(x, y, 26, 12, 0, Math.PI, 0);
  ctx.fillStyle = '#3a3418';
  ctx.fill();
  ctx.beginPath();
  ctx.ellipse(x - 4, y - 4, 16, 8, 0, Math.PI, 0);
  ctx.fillStyle = '#4c4620';
  ctx.fill();
  ctx.fillStyle = 'rgba(190, 200, 90, 0.5)'; // scattered peels/sprouts
  for (let i = 0; i < 4; i++) {
    ctx.beginPath();
    ctx.arc(x + (rand() - 0.5) * 40, y - rand() * 12, 1.6, 0, Math.PI * 2);
    ctx.fill();
  }
  glowSpots.push({ x, y: y - 14, r: 26, color: '180, 200, 90', phase: rand() * 6.28 });
}

// ── Landmarks ────────────────────────────────────────────────────────────────

/**
 * Blit a pixel-art landmark building, base seated just above the coin disc and
 * centered on the node, with a soft contact shadow. Height-driven so wide and
 * tall art both read at a consistent scale.
 */
function drawLandmarkImage(
  ctx: CanvasRenderingContext2D,
  x: number,
  nodeY: number,
  img: HTMLImageElement,
  box: number,
): void {
  // Fit by the LARGER side so near-square/wide art can't spill sideways into
  // neighbouring spaces or off the platform.
  const iw = img.naturalWidth || img.width;
  const ih = img.naturalHeight || img.height;
  const scale = box / Math.max(iw, ih);
  const w = iw * scale;
  const h = ih * scale;
  const bottom = nodeY - 26; // sit at the disc's top edge
  ctx.save();
  ctx.beginPath();
  ctx.ellipse(x, bottom, w * 0.34, w * 0.12, 0, 0, Math.PI * 2);
  ctx.fillStyle = 'rgba(0, 0, 0, 0.4)';
  ctx.fill();
  ctx.imageSmoothingEnabled = false;
  ctx.drawImage(img, x - w / 2, bottom - h, w, h);
  ctx.restore();
}

/** Buildings anchor their base ~24px above the node so the coin disc stays clear. */
function drawLandmark(
  ctx: CanvasRenderingContext2D,
  n: BoardNode,
  glowSpots: GlowSpot[],
  tex?: LandmarkTextures,
): void {
  const x = n.x;
  const base = n.y - 24;

  // Art landmarks: blit the sprite and keep the type's ambient glow so the
  // shrine flame / boss aura still pulse. Everything else stays procedural.
  const art = tex?.[n.type];
  if (art && (art.naturalWidth || art.width)) {
    // Small decorations that sit beside their space (box = max px on either
    // side). Sized to clear the tightest neighbour spacing (~118px) and the
    // central-isle cluster (~137px) so nothing overlaps or leaves the platform.
    if (n.type === 'boss') {
      drawLandmarkImage(ctx, x, n.y, art, 82);
      glowSpots.push({ x, y: base - 40, r: 36, color: '184, 122, 255', phase: 1.3 });
    } else if (n.type === 'shrine') {
      drawLandmarkImage(ctx, x, n.y, art, 64);
      glowSpots.push({ x, y: base - 30, r: 20, color: '120, 230, 150', phase: 2.1 });
    } else if (n.type === 'warp') {
      drawLandmarkImage(ctx, x, n.y, art, 66);
      glowSpots.push({ x, y: base - 34, r: 24, color: '95, 208, 200', phase: 0.4 });
    } else if (n.type === 'shop') {
      drawLandmarkImage(ctx, x, n.y, art, 66);
      glowSpots.push({ x, y: base - 26, r: 20, color: '235, 190, 110', phase: 1.7 });
    } else {
      drawLandmarkImage(ctx, x, n.y, art, 62);
    }
    return;
  }

  ctx.save();
  switch (n.type) {
    case 'boss': {
      // Dark citadel: three crenellated towers with glowing violet windows.
      ctx.fillStyle = 'rgba(0,0,0,0.4)';
      ctx.beginPath();
      ctx.ellipse(x, base + 4, 58, 12, 0, 0, Math.PI * 2);
      ctx.fill();
      const tower = (tx: number, tw: number, th: number): void => {
        ctx.fillStyle = '#241b2b';
        ctx.fillRect(tx - tw / 2, base - th, tw, th);
        ctx.fillStyle = '#191220'; // roof face
        for (let i = -1; i <= 1; i++) {
          ctx.fillRect(tx + (i * tw) / 3 - tw / 10, base - th - 6, tw / 5, 6);
        }
        ctx.fillRect(tx - tw / 2, base - th, tw, 4);
      };
      tower(x - 30, 26, 52);
      tower(x + 30, 26, 52);
      tower(x, 46, 72);
      ctx.fillStyle = '#b87aff';
      for (const [wx, wy] of [
        [x - 8, base - 52],
        [x + 4, base - 52],
        [x - 8, base - 34],
        [x + 4, base - 34],
        [x - 32, base - 36],
        [x + 26, base - 36],
      ]) {
        ctx.beginPath();
        ctx.roundRect(wx, wy, 4, 7, 2);
        ctx.fill();
      }
      glowSpots.push({ x, y: base - 44, r: 52, color: '184, 122, 255', phase: 1.3 });
      break;
    }
    case 'gate': {
      // Stone arch over the entry disc.
      ctx.fillStyle = '#4a4238';
      ctx.fillRect(x - 26, base - 34, 12, 34);
      ctx.fillRect(x + 14, base - 34, 12, 34);
      ctx.fillStyle = '#5c5346';
      ctx.fillRect(x - 26, base - 34, 12, 5);
      ctx.fillRect(x + 14, base - 34, 12, 5);
      ctx.beginPath();
      ctx.arc(x, base - 32, 22, Math.PI, 0);
      ctx.lineWidth = 8;
      ctx.strokeStyle = '#4a4238';
      ctx.stroke();
      ctx.beginPath();
      ctx.arc(x, base - 32, 25, -Math.PI * 0.65, -Math.PI * 0.35);
      ctx.lineWidth = 3;
      ctx.strokeStyle = 'rgba(255,255,255,0.12)';
      ctx.stroke();
      break;
    }
    case 'shop': {
      // Awning stall: counter front, striped canopy, posts.
      ctx.fillStyle = '#3a2f22';
      ctx.fillRect(x - 24, base - 26, 3, 26);
      ctx.fillRect(x + 21, base - 26, 3, 26);
      ctx.fillStyle = '#5c4a33';
      ctx.fillRect(x - 28, base - 14, 56, 14);
      ctx.fillStyle = 'rgba(255,255,255,0.08)';
      ctx.fillRect(x - 28, base - 14, 56, 3);
      for (let i = 0; i < 5; i++) {
        ctx.fillStyle = i % 2 === 0 ? '#8a6a2f' : '#c9a24a';
        ctx.beginPath();
        const sx = x - 30 + i * 12;
        ctx.moveTo(sx, base - 26);
        ctx.lineTo(sx + 12, base - 26);
        ctx.lineTo(sx + 12 + 4, base - 36);
        ctx.lineTo(sx + 4, base - 36);
        ctx.closePath();
        ctx.fill();
      }
      break;
    }
    case 'shrine': {
      // Stepped altar with a burning brazier.
      ctx.fillStyle = '#4a4238';
      ctx.fillRect(x - 20, base - 8, 40, 8);
      ctx.fillRect(x - 14, base - 16, 28, 8);
      ctx.fillRect(x - 5, base - 36, 10, 20);
      ctx.beginPath();
      ctx.ellipse(x, base - 36, 8, 4, 0, 0, Math.PI * 2);
      ctx.fillStyle = '#3a2f22';
      ctx.fill();
      const fg = ctx.createRadialGradient(x, base - 42, 0, x, base - 42, 14);
      fg.addColorStop(0, 'rgba(255, 180, 80, 0.9)');
      fg.addColorStop(1, 'rgba(255, 180, 80, 0)');
      ctx.fillStyle = fg;
      ctx.fillRect(x - 14, base - 56, 28, 28);
      glowSpots.push({ x, y: base - 42, r: 26, color: '255, 180, 80', phase: 2.1 });
      break;
    }
    case 'warp': {
      // Broken standing-stone ring around a glowing portal.
      ctx.fillStyle = '#4a4238';
      for (let i = 0; i < 5; i++) {
        const a = -Math.PI / 2 + (i / 5) * Math.PI * 2;
        ctx.fillRect(x + Math.cos(a) * 20 - 2.5, base - 20 + Math.sin(a) * 9 - 8, 5, 10);
      }
      ctx.beginPath();
      ctx.ellipse(x, base - 20, 16, 7, 0, 0, Math.PI * 2);
      ctx.lineWidth = 3;
      ctx.strokeStyle = 'rgba(95, 208, 200, 0.8)';
      ctx.stroke();
      glowSpots.push({ x, y: base - 20, r: 34, color: '95, 208, 200', phase: 0.4 });
      break;
    }
    case 'ossuary': {
      // Bone-pile crypt front.
      ctx.fillStyle = '#3a3630';
      ctx.fillRect(x - 24, base - 26, 48, 26);
      ctx.fillStyle = 'rgba(255,255,255,0.06)';
      ctx.fillRect(x - 24, base - 26, 48, 4);
      ctx.fillStyle = '#141110';
      ctx.beginPath();
      ctx.moveTo(x - 6, base);
      ctx.lineTo(x - 6, base - 12);
      ctx.arc(x, base - 12, 6, Math.PI, 0);
      ctx.lineTo(x + 6, base);
      ctx.closePath();
      ctx.fill();
      ctx.strokeStyle = '#cfc4a8';
      ctx.lineWidth = 3;
      ctx.lineCap = 'round';
      ctx.beginPath();
      ctx.moveTo(x - 14, base - 30);
      ctx.lineTo(x - 2, base - 40);
      ctx.moveTo(x - 14, base - 40);
      ctx.lineTo(x - 2, base - 30);
      ctx.stroke();
      ctx.fillStyle = '#cfc4a8';
      ctx.beginPath();
      ctx.arc(x + 10, base - 35, 6, 0, Math.PI * 2);
      ctx.fill();
      ctx.fillStyle = '#141110';
      ctx.beginPath();
      ctx.arc(x + 8, base - 36, 1.5, 0, Math.PI * 2);
      ctx.arc(x + 12.5, base - 36, 1.5, 0, Math.PI * 2);
      ctx.fill();
      break;
    }
    case 'lair': {
      // A fanged cave-mouth den with embers glowing inside.
      ctx.fillStyle = 'rgba(0,0,0,0.4)';
      ctx.beginPath();
      ctx.ellipse(x, base + 3, 52, 11, 0, 0, Math.PI * 2);
      ctx.fill();
      ctx.fillStyle = '#241d1a'; // the mound
      ctx.beginPath();
      ctx.moveTo(x - 52, base);
      ctx.quadraticCurveTo(x - 40, base - 46, x, base - 52);
      ctx.quadraticCurveTo(x + 44, base - 44, x + 52, base);
      ctx.closePath();
      ctx.fill();
      ctx.fillStyle = '#0a0605'; // the maw
      ctx.beginPath();
      ctx.moveTo(x - 24, base);
      ctx.quadraticCurveTo(x, base - 40, x + 24, base);
      ctx.closePath();
      ctx.fill();
      ctx.fillStyle = '#cfc4a8'; // fangs
      for (const [fx, fh] of [[-16, 10], [-6, 14], [5, 13], [15, 9]] as [number, number][]) {
        ctx.beginPath();
        ctx.moveTo(x + fx - 3, base - 26 - fh * 0.2);
        ctx.lineTo(x + fx, base - 26 + fh);
        ctx.lineTo(x + fx + 3, base - 26 - fh * 0.2);
        ctx.closePath();
        ctx.fill();
      }
      const eg = ctx.createRadialGradient(x, base - 12, 0, x, base - 12, 22);
      eg.addColorStop(0, 'rgba(255, 90, 60, 0.5)');
      eg.addColorStop(1, 'rgba(255, 90, 60, 0)');
      ctx.fillStyle = eg;
      ctx.fillRect(x - 22, base - 34, 44, 34);
      glowSpots.push({ x, y: base - 14, r: 44, color: '255, 100, 70', phase: 2.6 });
      break;
    }
    case 'vault': {
      // A round gilded vault door set into a stone frame.
      ctx.fillStyle = 'rgba(0,0,0,0.4)';
      ctx.beginPath();
      ctx.ellipse(x, base + 3, 40, 9, 0, 0, Math.PI * 2);
      ctx.fill();
      ctx.fillStyle = '#3a352a';
      ctx.fillRect(x - 36, base - 52, 72, 52);
      ctx.fillStyle = 'rgba(255,255,255,0.07)';
      ctx.fillRect(x - 36, base - 52, 72, 5);
      ctx.beginPath(); // golden door
      ctx.arc(x, base - 24, 20, 0, Math.PI * 2);
      ctx.fillStyle = '#c8a53e';
      ctx.fill();
      ctx.strokeStyle = '#8a6f24';
      ctx.lineWidth = 3;
      ctx.stroke();
      ctx.beginPath(); // spokes
      for (let i = 0; i < 6; i++) {
        const a = (i / 6) * Math.PI * 2;
        ctx.moveTo(x + Math.cos(a) * 5, base - 24 + Math.sin(a) * 5);
        ctx.lineTo(x + Math.cos(a) * 16, base - 24 + Math.sin(a) * 16);
      }
      ctx.lineWidth = 2.5;
      ctx.stroke();
      glowSpots.push({ x, y: base - 24, r: 40, color: '240, 205, 110', phase: 0.9 });
      break;
    }
    case 'ladder': {
      // `_lb` sits in the depths pocket → an ascent; `_lt` on the surface →
      // a descent into the hidden dungeon layer.
      drawStairwell(ctx, n.x, n.y - 6, n.region !== 'depths');
      break;
    }
  }
  ctx.restore();
}
