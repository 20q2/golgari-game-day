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
 * Where each region's floor painting sits and how far it reaches. Radii
 * overlap on purpose: the radial alpha masks cross-fade one biome floor
 * softly into the next.
 */
const FLOOR_ZONES: { region: string; cx: number; cy: number; r: number; alpha: number }[] = [
  { region: 'city', cx: 900, cy: 880, r: 860, alpha: 0.18 },
  { region: 'cavern', cx: 420, cy: 320, r: 640, alpha: 0.18 },
  { region: 'bog', cx: 1370, cy: 310, r: 600, alpha: 0.18 },
  { region: 'isle', cx: 900, cy: 470, r: 340, alpha: 0.14 },
];

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
    path: { rim: '#16241f', edge: '#4fae76', fill: '#3d5148', stud: 'rgba(178, 220, 200, 0.5)' },
  },
  // Mosslight Cavern — the luminous moss look.
  // Shape language: soft lumpy organic blobs.
  cavern: {
    top: '#24391f',
    cliff: '#151c12',
    cliffH: 13,
    mottle: 'rgba(88, 138, 70, 0.16)',
    tint: 'rgba(74, 122, 46, 0.16)',
    path: { rim: '#2a2118', edge: '#d99a3d', fill: '#67553c', stud: 'rgba(232, 205, 160, 0.55)' },
  },
  // The Sedgemoor — murky bog (swamp_background.png).
  // Shape language: low, ragged marsh splats barely above the waterline.
  bog: {
    top: '#2b3520',
    cliff: '#141a0e',
    cliffH: 7,
    mottle: 'rgba(122, 140, 62, 0.13)',
    tint: 'rgba(96, 104, 40, 0.16)',
    path: { rim: '#1c1710', edge: '#6b5133', fill: '#4a3b28', stud: 'rgba(30, 22, 12, 0.55)' },
  },
  // Boss island — bare haunted rock. Shape language: jagged shards.
  isle: {
    top: '#262024',
    cliff: '#120e11',
    cliffH: 12,
    mottle: 'rgba(160, 130, 180, 0.10)',
    tint: 'rgba(88, 58, 112, 0.14)',
    path: { rim: '#171218', edge: '#4a3a52', fill: '#38303c', stud: 'rgba(180, 160, 200, 0.4)' },
  },
};

const REGION_LABELS: { text: string; x: number; y: number }[] = [
  { text: 'The Undercity', x: 900, y: 905 },
  { text: 'Mosslight Cavern', x: 420, y: 335 },
  { text: 'The Sedgemoor', x: 1370, y: 325 },
];

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
  { x: -200, y: 420 },
  { x: 200, y: 470 },
  { x: 450, y: 540 },
  { x: 700, y: 600 },
  { x: 900, y: 620 },
  { x: 1150, y: 560 },
  { x: 1330, y: 490 },
  { x: 1550, y: 430 },
  { x: 2000, y: 380 },
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

export function renderTerrain(map: BoardMap, floors?: FloorTextures): TerrainArt {
  const w = map.worldW + TERRAIN_MARGIN * 2;
  const h = map.worldH + TERRAIN_MARGIN * 2;
  const canvas = document.createElement('canvas');
  canvas.width = w;
  canvas.height = h;
  const ctx = canvas.getContext('2d')!;
  ctx.translate(TERRAIN_MARGIN, TERRAIN_MARGIN); // world coordinates from here on
  const glowSpots: GlowSpot[] = [];
  const curves = edgeCurves(map);
  const rand = mulberry32(hashStr('undercity-terrain'));

  // 1. Cavern floor: per-biome floor paintings ghosted into the dark, each
  //    masked by a radial falloff so neighboring biomes cross-fade, then
  //    mottling and per-chamber tint washes.
  ctx.fillStyle = '#141110';
  ctx.fillRect(-TERRAIN_MARGIN, -TERRAIN_MARGIN, w, h);
  if (floors) {
    for (const z of FLOOR_ZONES) {
      const img = floors[z.region];
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
    const x = rand() * w - TERRAIN_MARGIN;
    const y = rand() * h - TERRAIN_MARGIN;
    const r = 20 + rand() * 60;
    const g = ctx.createRadialGradient(x, y, 0, x, y, r);
    g.addColorStop(0, rand() > 0.5 ? 'rgba(60, 52, 42, 0.10)' : 'rgba(0, 0, 0, 0.14)');
    g.addColorStop(1, 'rgba(0,0,0,0)');
    ctx.fillStyle = g;
    ctx.fillRect(x - r, y - r, r * 2, r * 2);
  }
  for (const [cx, cy, cr, region] of [
    [900, 880, 740, 'city'],
    [420, 320, 490, 'cavern'],
    [1370, 310, 460, 'bog'],
    [900, 470, 300, 'isle'],
  ] as [number, number, number, string][]) {
    // Broad wash plus a tighter core so each chamber's floor reads as its
    // own color, not just its plateaus.
    for (const scale of [1, 0.55]) {
      const g = ctx.createRadialGradient(cx, cy, 0, cx, cy, cr * scale);
      g.addColorStop(0, theme(region).tint);
      g.addColorStop(1, 'rgba(0,0,0,0)');
      ctx.fillStyle = g;
      ctx.fillRect(cx - cr, cy - cr, cr * 2, cr * 2);
    }
  }

  // 2. Stalagmite wall ring hugging the world border
  drawWalls(ctx, map, rand);

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
  for (const n of map.nodes) addBlob(n.region, n.x, n.y, 92 + rand() * 26);
  for (const c of curves) {
    const pts = sampleCurve(c, 55);
    pts.forEach((p, i) => {
      const region = i < pts.length / 2 ? c.a.region : c.b.region;
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

  // 4. Underground river (paths drawn later cross it like bridges)
  const river = riverPoints(map);
  strokePolyline(ctx, river, 54, '#0d1b1c');
  strokePolyline(ctx, river, 34, '#174644');
  strokePolyline(ctx, river, 14, '#2f8a85');
  for (let i = 4; i < river.length - 4; i += 5) {
    glowSpots.push({ x: river[i].x, y: river[i].y, r: 46, color: '95, 208, 200', phase: i * 0.9 });
  }

  // 5. Region name labels, painted into the hollow of each chamber loop.
  ctx.save();
  ctx.font = 'italic 600 42px Georgia, "Times New Roman", serif';
  ctx.textAlign = 'center';
  ctx.textBaseline = 'middle';
  ctx.fillStyle = 'rgba(210, 235, 220, 0.16)';
  for (const l of REGION_LABELS) ctx.fillText(l.text, l.x, l.y);
  ctx.restore();

  // 6. Decorations, themed by the nearest node's region, kept off
  //    nodes/paths/river.
  const pathPts = curves.flatMap((c) => sampleCurve(c, 45));
  for (let i = 0; i < 170; i++) {
    // Keep clear of the stalagmite wall band on every side.
    const x = 90 + rand() * (map.worldW - 180);
    const y = 90 + rand() * (map.worldH - 180);
    let nearest: BoardNode | null = null;
    let nd = Infinity;
    for (const n of map.nodes) {
      const d = Math.hypot(n.x - x, n.y - y);
      if (d < nd) {
        nd = d;
        nearest = n;
      }
    }
    if (
      nd < 95 ||
      nd > 280 ||
      !nearest ||
      nearest.region === 'isle' ||
      !pathPts.every((p) => Math.hypot(p.x - x, p.y - y) > 55) ||
      !river.every((p) => Math.hypot(p.x - x, p.y - y) > 60)
    ) {
      continue;
    }
    const roll = rand();
    if (nearest.region === 'city') {
      if (roll < 0.4) drawPillar(ctx, x, y, rand);
      else if (roll < 0.7) drawRuinBlock(ctx, x, y, rand, glowSpots);
      else drawSkullPile(ctx, x, y, rand);
    } else if (nearest.region === 'bog') {
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
    const style =
      c.a.region === c.b.region ? theme(c.a.region).path : REGION_THEMES['cavern'].path;
    const bog = c.a.region === 'bog' && c.b.region === 'bog';
    const ribbon = (width: number, color: string, dy = 0): void => {
      ctx.beginPath();
      ctx.moveTo(c.a.x, c.a.y + dy);
      ctx.quadraticCurveTo(c.cx, c.cy + dy, c.b.x, c.b.y + dy);
      ctx.lineWidth = width;
      ctx.strokeStyle = color;
      ctx.lineCap = 'round';
      ctx.stroke();
    };
    ribbon(24, 'rgba(0,0,0,0.35)', 5); // drop shadow
    ribbon(22, style.rim);
    ribbon(19, style.edge);
    ribbon(16, style.fill);
    const pts = sampleCurve(c, bog ? 16 : 55);
    if (bog) {
      // Plank ticks across a boardwalk instead of studs.
      ctx.strokeStyle = style.stud;
      ctx.lineWidth = 2;
      for (let i = 1; i < pts.length - 1; i++) {
        const dx = pts[i + 1].x - pts[i - 1].x;
        const dy = pts[i + 1].y - pts[i - 1].y;
        const len = Math.hypot(dx, dy) || 1;
        ctx.beginPath();
        ctx.moveTo(pts[i].x - (-dy / len) * 7, pts[i].y - (dx / len) * 7);
        ctx.lineTo(pts[i].x + (-dy / len) * 7, pts[i].y + (dx / len) * 7);
        ctx.stroke();
      }
    } else {
      for (const p of pts.slice(1, -1)) {
        ctx.beginPath();
        ctx.ellipse(p.x, p.y, 3, 2, 0, 0, Math.PI * 2);
        ctx.fillStyle = style.stud;
        ctx.fill();
      }
    }
  }

  // 8. Landmarks, y-sorted so lower buildings overlap higher ones correctly
  const landmarkTypes = ['boss', 'gate', 'shop', 'shrine', 'warp', 'ossuary'];
  const landmarks = map.nodes
    .filter((n) => landmarkTypes.includes(n.type))
    .sort((a, b) => a.y - b.y);
  for (const n of landmarks) drawLandmark(ctx, n, glowSpots);

  // Vignette last so it shades everything toward the cave edges
  const vg = ctx.createRadialGradient(
    map.worldW / 2,
    map.worldH / 2,
    Math.min(map.worldW, map.worldH) * 0.35,
    map.worldW / 2,
    map.worldH / 2,
    Math.max(map.worldW, map.worldH) * 0.75,
  );
  vg.addColorStop(0, 'rgba(0,0,0,0)');
  vg.addColorStop(1, 'rgba(0,0,0,0.55)');
  ctx.fillStyle = vg;
  ctx.fillRect(-TERRAIN_MARGIN, -TERRAIN_MARGIN, w, h);

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
    if (region === 'city') {
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
  map: BoardMap,
  rand: () => number,
): void {
  const M = TERRAIN_MARGIN;
  ctx.fillStyle = '#0a0908';
  // Solid margin bands first, then a jagged stalagmite edge biting inward.
  ctx.fillRect(-M, -M, map.worldW + 2 * M, M);
  ctx.fillRect(-M, map.worldH, map.worldW + 2 * M, M);
  ctx.fillRect(-M, -M, M, map.worldH + 2 * M);
  ctx.fillRect(map.worldW, -M, M, map.worldH + 2 * M);
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
  spikes(0, 0, map.worldW, 0, 0, 1);
  spikes(0, map.worldH, map.worldW, map.worldH, 0, -1);
  spikes(0, 0, 0, map.worldH, 1, 0);
  spikes(map.worldW, 0, map.worldW, map.worldH, -1, 0);
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

// ── Landmarks ────────────────────────────────────────────────────────────────

/** Buildings anchor their base ~24px above the node so the coin disc stays clear. */
function drawLandmark(
  ctx: CanvasRenderingContext2D,
  n: BoardNode,
  glowSpots: GlowSpot[],
): void {
  const x = n.x;
  const base = n.y - 24;
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
  }
  ctx.restore();
}
