/**
 * Static Dokapon-style terrain prerender for the Undercity board.
 *
 * renderTerrain() paints the entire world once (cavern floor, moss plateaus,
 * underground river, stalagmite wall border, glowing decorations, path
 * ribbons, landmark buildings) into an offscreen canvas that BoardCanvas
 * blits under its camera transform each frame. Everything random is seeded
 * (FNV-1a + mulberry32) so the map never changes between loads. Pure: no DOM
 * lookups, no I/O beyond createElement('canvas').
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
  /** River shimmer + mushroom/crystal/portal glows, animated by BoardCanvas. */
  glowSpots: GlowSpot[];
}

interface Pt {
  x: number;
  y: number;
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
 * Deterministic river polyline crossing the world left→right. It recovers
 * toward a sine base path (so node repulsion can't pin it against the world
 * edge behind the walls) and only dodges the discs themselves — path ribbons
 * drawn later cross over it like bridges.
 */
function riverPoints(map: BoardMap): Pt[] {
  const rand = mulberry32(hashStr('undercity-river'));
  const pts: Pt[] = [];
  let y = map.worldH * 0.52 + Math.sin(1.2) * 170;
  for (let x = -TERRAIN_MARGIN; x <= map.worldW + TERRAIN_MARGIN; x += 60) {
    const target = map.worldH * 0.52 + Math.sin(x * 0.0035 + 1.2) * 170;
    y += (target - y) * 0.18 + (rand() - 0.5) * 30;
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

export function renderTerrain(map: BoardMap): TerrainArt {
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

  // 1. Cavern floor + mottling
  ctx.fillStyle = '#141110';
  ctx.fillRect(-TERRAIN_MARGIN, -TERRAIN_MARGIN, w, h);
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

  // 2. Stalagmite wall ring hugging the world border
  drawWalls(ctx, map, rand);

  // 3. Plateaus: cliff pass (offset down, dark) then lit top pass then mottle
  const blobs: { x: number; y: number; r: number }[] = [];
  for (const n of map.nodes) blobs.push({ x: n.x, y: n.y, r: 92 + rand() * 26 });
  for (const c of curves) {
    for (const p of sampleCurve(c, 55)) blobs.push({ x: p.x, y: p.y, r: 64 + rand() * 18 });
  }
  fillBlobs(ctx, blobs, 14, '#151c12'); // cliff shadow under the south rim
  fillBlobs(ctx, blobs, 0, '#24391f'); // lit top surface
  for (const b of blobs) {
    if (rand() > 0.4) continue;
    const g = ctx.createRadialGradient(b.x, b.y - b.r * 0.2, 0, b.x, b.y, b.r * 0.8);
    g.addColorStop(0, 'rgba(88, 138, 70, 0.16)');
    g.addColorStop(1, 'rgba(0,0,0,0)');
    ctx.fillStyle = g;
    ctx.fillRect(b.x - b.r, b.y - b.r, b.r * 2, b.r * 2);
  }

  // 4. Underground river (paths drawn later cross it like bridges)
  const river = riverPoints(map);
  strokePolyline(ctx, river, 54, '#0d1b1c');
  strokePolyline(ctx, river, 34, '#174644');
  strokePolyline(ctx, river, 14, '#2f8a85');
  for (let i = 4; i < river.length - 4; i += 5) {
    glowSpots.push({ x: river[i].x, y: river[i].y, r: 46, color: '95, 208, 200', phase: i * 0.9 });
  }

  // 5. Decorations: glowing mushrooms & crystals, kept off nodes/paths/river
  const pathPts = curves.flatMap((c) => sampleCurve(c, 45));
  const clear = (x: number, y: number) =>
    map.nodes.every((n) => Math.hypot(n.x - x, n.y - y) > 95) &&
    pathPts.every((p) => Math.hypot(p.x - x, p.y - y) > 55) &&
    river.every((p) => Math.hypot(p.x - x, p.y - y) > 60);
  for (let i = 0; i < 130; i++) {
    const x = rand() * map.worldW;
    const y = rand() * map.worldH;
    if (!clear(x, y)) continue;
    if (rand() < 0.6) drawMushrooms(ctx, x, y, rand, glowSpots);
    else drawCrystal(ctx, x, y, rand, glowSpots);
  }

  // 6. Path ribbons — Dokapon's edge-striped roads, cave-toned
  for (const c of curves) {
    const ribbon = (width: number, style: string, dy = 0): void => {
      ctx.beginPath();
      ctx.moveTo(c.a.x, c.a.y + dy);
      ctx.quadraticCurveTo(c.cx, c.cy + dy, c.b.x, c.b.y + dy);
      ctx.lineWidth = width;
      ctx.strokeStyle = style;
      ctx.lineCap = 'round';
      ctx.stroke();
    };
    ribbon(24, 'rgba(0,0,0,0.35)', 5); // drop shadow
    ribbon(22, '#2a2118'); // dark rim
    ribbon(19, '#d99a3d'); // amber lantern edges peeking out each side
    ribbon(16, '#67553c'); // stone surface
    for (const p of sampleCurve(c, 55).slice(1, -1)) {
      ctx.beginPath();
      ctx.ellipse(p.x, p.y, 3, 2, 0, 0, Math.PI * 2);
      ctx.fillStyle = 'rgba(232, 205, 160, 0.55)';
      ctx.fill();
    }
  }

  // 7. Landmarks, y-sorted so lower buildings overlap higher ones correctly
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

function fillBlobs(
  ctx: CanvasRenderingContext2D,
  blobs: { x: number; y: number; r: number }[],
  offsetY: number,
  style: string,
): void {
  ctx.fillStyle = style;
  ctx.beginPath();
  for (const b of blobs) {
    ctx.moveTo(b.x + b.r, b.y + offsetY);
    ctx.ellipse(b.x, b.y + offsetY, b.r, b.r * 0.78, 0, 0, Math.PI * 2);
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
