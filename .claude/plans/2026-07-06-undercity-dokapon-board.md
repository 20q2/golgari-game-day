# Dokapon-Style 2.5D Undercity Board Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Replace the flat Undercity board rendering with a Dokapon Kingdom-style painterly 2.5D map (luminous cavern palette) — terrain plateaus, curved lantern-lit path ribbons, 3D coin-disc spaces, landmark buildings — with zero backend/gameplay changes.

**Architecture:** A new pure module `board-terrain.ts` prerenders all static art (floor, plateaus, river, walls, decorations, path ribbons, landmarks) once into an offscreen canvas keyed off the `BoardMap`; `board-canvas.ts` keeps its public API, camera, and input, and per frame draws the terrain image plus a dynamic layer (glow pulses, coin discs, snare/choice tells, y-sorted tokens with shadows). All randomness is seeded (mulberry32 + FNV-1a string hash) so the map is identical every load.

**Tech Stack:** Angular 20 standalone component (unchanged), Canvas 2D only, no new dependencies. Spec: `.claude/specs/2026-07-06-undercity-dokapon-board-design.md`.

**Verification:** No frontend test runner exists (CLAUDE.md — don't try `ng test`). Each task verifies with `npm run lint` and, at the end, `npm start` + visual inspection of `/undercity`.

---

### Task 1: `board-terrain.ts` — seeded PRNG, edge curves, terrain prerender

**Files:**
- Create: `src/app/undercity/engine/board-terrain.ts`

- [ ] **Step 1: Create the module with PRNG + curve geometry + exported types**

```ts
/**
 * Static Dokapon-style terrain prerender for the Undercity board.
 *
 * renderTerrain() paints the entire world once (cavern floor, moss plateaus,
 * underground river, wall border, decorations, path ribbons, landmark
 * buildings) into an offscreen canvas that BoardCanvas blits under its camera
 * transform each frame. Everything random is seeded so the map never changes
 * between loads. Pure: no DOM lookups, no I/O beyond createElement('canvas').
 */
import { BoardMap, BoardNode } from './board-canvas';

export const TERRAIN_MARGIN = 200; // camera clamp allows -200..world+200

export interface EdgeCurve {
  a: BoardNode;
  b: BoardNode;
  cx: number; // quadratic control point
  cy: number;
}

export interface GlowSpot {
  x: number;
  y: number;
  r: number;
  color: string; // rgb() triple without alpha, e.g. '95, 208, 200'
  phase: number; // radians offset so pulses aren't synchronized
}

export interface TerrainArt {
  canvas: HTMLCanvasElement;
  glowSpots: GlowSpot[]; // river shimmer + mushroom/crystal glows (animated by BoardCanvas)
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

function sampleCurve(c: EdgeCurve, step = 40): { x: number; y: number }[] {
  const len = Math.hypot(c.b.x - c.a.x, c.b.y - c.a.y);
  const n = Math.max(2, Math.round(len / step));
  const pts: { x: number; y: number }[] = [];
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
```

- [ ] **Step 2: Add the river path generator (node-repulsed sine wander)**

```ts
/** Deterministic river polyline crossing the world left→right, repulsed from nodes. */
function riverPoints(map: BoardMap): { x: number; y: number }[] {
  const rand = mulberry32(hashStr('undercity-river'));
  const pts: { x: number; y: number }[] = [];
  let y = map.worldH * 0.42;
  for (let x = -TERRAIN_MARGIN; x <= map.worldW + TERRAIN_MARGIN; x += 60) {
    y += (rand() - 0.5) * 56 + Math.sin(x * 0.004) * 14;
    for (const n of map.nodes) {
      const d = Math.hypot(n.x - x, n.y - y);
      if (d < 150) y += Math.sign(y - n.y || 1) * (150 - d) * 0.6;
    }
    y = Math.max(90, Math.min(map.worldH - 90, y));
    pts.push({ x, y });
  }
  return pts;
}

function strokePolyline(
  ctx: CanvasRenderingContext2D,
  pts: { x: number; y: number }[],
  width: number,
  style: string,
): void {
  ctx.beginPath();
  ctx.moveTo(pts[0].x, pts[0].y);
  for (let i = 1; i < pts.length - 1; i++) {
    ctx.quadraticCurveTo(pts[i].x, pts[i].y, (pts[i].x + pts[i + 1].x) / 2, (pts[i].y + pts[i + 1].y) / 2);
  }
  ctx.lineTo(pts[pts.length - 1].x, pts[pts.length - 1].y);
  ctx.lineWidth = width;
  ctx.strokeStyle = style;
  ctx.lineCap = 'round';
  ctx.lineJoin = 'round';
  ctx.stroke();
}
```

- [ ] **Step 3: Add `renderTerrain(map)` — floor, vignette, walls, plateaus**

```ts
export function renderTerrain(map: BoardMap): TerrainArt {
  const w = map.worldW + TERRAIN_MARGIN * 2;
  const h = map.worldH + TERRAIN_MARGIN * 2;
  const canvas = document.createElement('canvas');
  canvas.width = w;
  canvas.height = h;
  const ctx = canvas.getContext('2d')!;
  ctx.translate(TERRAIN_MARGIN, TERRAIN_MARGIN); // world coords from here on
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
    const light = rand() > 0.5;
    g.addColorStop(0, light ? 'rgba(60, 52, 42, 0.10)' : 'rgba(0, 0, 0, 0.14)');
    g.addColorStop(1, 'rgba(0,0,0,0)');
    ctx.fillStyle = g;
    ctx.fillRect(x - r, y - r, r * 2, r * 2);
  }

  // 2. Stalagmite wall ring hugging the world border
  drawWalls(ctx, map, rand);

  // 3. Plateaus: cliff pass (offset down, dark) then lit top pass then mottle
  const blobs: { x: number; y: number; r: number }[] = [];
  for (const n of map.nodes) blobs.push({ x: n.x, y: n.y, r: 92 + rand() * 26 });
  for (const c of curves) for (const p of sampleCurve(c, 55)) blobs.push({ x: p.x, y: p.y, r: 64 + rand() * 18 });
  fillBlobs(ctx, blobs, 14, '#151c12'); // cliff shadow
  fillBlobs(ctx, blobs, 0, '#24391f'); // top surface
  for (const b of blobs) {
    if (rand() > 0.4) continue;
    const g = ctx.createRadialGradient(b.x, b.y - b.r * 0.2, 0, b.x, b.y, b.r * 0.8);
    g.addColorStop(0, 'rgba(88, 138, 70, 0.16)');
    g.addColorStop(1, 'rgba(0,0,0,0)');
    ctx.fillStyle = g;
    ctx.fillRect(b.x - b.r, b.y - b.r, b.r * 2, b.r * 2);
  }

  // ...river, decorations, paths, landmarks appended in later steps...

  // Vignette last so it shades everything toward the cave edges
  const vg = ctx.createRadialGradient(
    map.worldW / 2, map.worldH / 2, Math.min(map.worldW, map.worldH) * 0.35,
    map.worldW / 2, map.worldH / 2, Math.max(map.worldW, map.worldH) * 0.75,
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

function drawWalls(ctx: CanvasRenderingContext2D, map: BoardMap, rand: () => number): void {
  ctx.fillStyle = '#0a0908';
  const spikes = (x0: number, y0: number, x1: number, y1: number, inwardX: number, inwardY: number) => {
    const len = Math.hypot(x1 - x0, y1 - y0);
    const n = Math.round(len / 55);
    ctx.beginPath();
    ctx.moveTo(x0, y0);
    for (let i = 0; i <= n; i++) {
      const t = i / n;
      const depth = 40 + rand() * 70;
      ctx.lineTo(x0 + (x1 - x0) * t + inwardX * depth, y0 + (y1 - y0) * t + inwardY * depth);
    }
    ctx.lineTo(x1, y1);
    ctx.closePath();
    ctx.fill();
  };
  const M = TERRAIN_MARGIN;
  // Fill margin bands solid, then jagged inner edge
  ctx.fillRect(-M, -M, map.worldW + 2 * M, M); // top band
  ctx.fillRect(-M, map.worldH, map.worldW + 2 * M, M);
  ctx.fillRect(-M, -M, M, map.worldH + 2 * M);
  ctx.fillRect(map.worldW, -M, M, map.worldH + 2 * M);
  spikes(0, 0, map.worldW, 0, 0, 1);
  spikes(0, map.worldH, map.worldW, map.worldH, 0, -1);
  spikes(0, 0, 0, map.worldH, 1, 0);
  spikes(map.worldW, 0, map.worldW, map.worldH, -1, 0);
}
```

- [ ] **Step 4: Add river + decorations (mushrooms/crystals) with glow spot registration**

Insert between the plateau pass and the vignette:

```ts
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
```

With drawing helpers (violet/teal caps, pale crystals — front-face + shading for the 3D read):

```ts
function drawMushrooms(ctx, x, y, rand, glowSpots): void {
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

function drawCrystal(ctx, x, y, rand, glowSpots): void {
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
    ctx.fillStyle = 'rgba(255,255,255,0.35)'; // lit facet
    ctx.beginPath();
    ctx.moveTo(cx - wid * 0.3, y - hgt);
    ctx.lineTo(cx + wid * 0.4, y - hgt * 0.75);
    ctx.lineTo(cx, y);
    ctx.closePath();
    ctx.fill();
  }
  glowSpots.push({ x, y: y - 10, r: 26, color: '188, 230, 220', phase: rand() * 6.28 });
}
```

(Real code uses full type annotations on the helper params.)

- [ ] **Step 5: Add path ribbons (stone + amber lantern edges + center studs)**

Insert after decorations, before landmarks:

```ts
  // 6. Path ribbons — Dokapon's edge-striped roads, cave-toned
  for (const c of curves) {
    const ribbon = (width: number, style: string, dy = 0) => {
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
    ribbon(19, '#d99a3d'); // amber lantern edges (peeks 1.5px each side)
    ribbon(16, '#67553c'); // stone surface
    for (const p of sampleCurve(c, 55).slice(1, -1)) {
      ctx.beginPath();
      ctx.ellipse(p.x, p.y, 3, 2, 0, 0, Math.PI * 2);
      ctx.fillStyle = 'rgba(232, 205, 160, 0.55)';
      ctx.fill();
    }
  }
```

- [ ] **Step 6: Add landmark buildings (boss citadel, gate arch, shop stall, shrine, warp ring, ossuary)**

Dispatcher after paths (bottom of each drawing anchored ~24px above node center so the disc stays tappable/visible):

```ts
  // 7. Landmarks, y-sorted so lower buildings overlap higher ones correctly
  const landmarks = map.nodes
    .filter((n) => ['boss', 'gate', 'shop', 'shrine', 'warp', 'ossuary'].includes(n.type))
    .sort((a, b) => a.y - b.y);
  for (const n of landmarks) drawLandmark(ctx, n);
```

`drawLandmark` switches on `n.type`; every building = lit front face + darker side/roof face + glow accents. Complete drawing code (abbreviated geometry constants here; implement exactly):

- **boss**: three towers (rects `#241b2b`, center 46×72 flanked 26×52), 2px crenellation teeth on top edges, roof faces `#191220`, 6 glowing windows (`#b87aff`, 4×7 rounded rects), base shadow ellipse.
- **gate**: two pillars 12×34 `#4a4238` with lighter top faces `#5c5346`, arch: 8px-wide stroked semicircle r=22 spanning the pillars, keystone highlight `rgba(255,255,255,0.12)`.
- **shop**: stall 56 wide: counter front 56×18 `#5c4a33`, striped awning (4 alternating `#8a6a2f`/`#c9a24a` vertical stripes on a 60×14 parallelogram skewed −6px), two 3×16 posts `#3a2f22`.
- **shrine**: two stacked stone steps (40×8, 28×8 `#4a4238`), pillar 10×20, brazier: 8px ellipse bowl `#3a2f22` + radial-gradient flame glow (`rgba(255,180,80,0.9)` core → transparent, r=14).
- **warp**: broken ring of 5 small stones (5×8 rects `#4a4238` on a r=20 arc) around a glowing teal ellipse ring (`stroke rgba(95,208,200,0.8)`, lineWidth 3, rx 16 ry 7) + registered GlowSpot (`'95, 208, 200'`, r 34).
- **ossuary**: crypt front 48×26 `#3a3630` with darker doorway arch 12×16 `#141110`, two crossed bone strokes (`#cfc4a8`, lineWidth 3, with round caps) above the door, skull dot: 6px circle `#cfc4a8` + two 1.5px eye dots.

`drawLandmark` receives `glowSpots` too (warp + shrine register glows).

- [ ] **Step 7: Lint**

Run: `npm run lint`
Expected: clean (no errors) for `board-terrain.ts`.

- [ ] **Step 8: Commit**

```bash
git add src/app/undercity/engine/board-terrain.ts
git commit -m "feat(undercity): board terrain prerender - plateaus, river, paths, landmarks"
```

---

### Task 2: Rework `board-canvas.ts` drawing to use the terrain + 2.5D discs/tokens

**Files:**
- Modify: `src/app/undercity/engine/board-canvas.ts` (only the drawing section, lines ~276-433, plus constructor/fields; camera/input/lifecycle untouched)

- [ ] **Step 1: Wire in the terrain**

Add imports and fields; build terrain in the constructor:

```ts
import { renderTerrain, TerrainArt, TERRAIN_MARGIN } from './board-terrain';
// fields:
private terrain: TerrainArt;
// constructor, after nodeMap setup:
this.terrain = renderTerrain(map);
```

- [ ] **Step 2: Replace `draw()`**

New frame order (camera transform unchanged):

```ts
private draw(ts: number): void {
  const ctx = this.ctx;
  const elapsed = (ts - this.startTime) / 1000;
  ctx.fillStyle = '#0a0908';
  ctx.fillRect(0, 0, this.canvas.width, this.canvas.height);
  ctx.save();
  ctx.scale(this.zoom, this.zoom);
  ctx.translate(-this.camX, -this.camY);

  ctx.drawImage(this.terrain.canvas, -TERRAIN_MARGIN, -TERRAIN_MARGIN);
  this.drawGlows(elapsed);

  for (const n of this.map.nodes) this.drawSpace(n, elapsed);

  const tokens = this.players
    .map((p) => ({ p, n: this.nodeMap.get(p.position) }))
    .filter((t): t is { p: BoardPlayer; n: BoardNode } => !!t.n);
  // fan out co-located tokens (same offsets as before), then y-sort back-to-front
  // and draw shadows + sprites; labels drawn in a final pass so nothing occludes them
  ...
  ctx.restore();
}
```

`drawGlows` — cheap pulsing radial gradients over the terrain's registered spots, culled to the visible viewport:

```ts
private drawGlows(elapsed: number): void {
  const ctx = this.ctx;
  const vx0 = this.camX - 60, vy0 = this.camY - 60;
  const vx1 = this.camX + this.canvas.width / this.zoom + 60;
  const vy1 = this.camY + this.canvas.height / this.zoom + 60;
  for (const s of this.terrain.glowSpots) {
    if (s.x < vx0 || s.x > vx1 || s.y < vy0 || s.y > vy1) continue;
    const a = 0.05 + 0.05 * (1 + Math.sin(elapsed * 1.6 + s.phase)) * 0.5;
    const g = ctx.createRadialGradient(s.x, s.y, 0, s.x, s.y, s.r);
    g.addColorStop(0, `rgba(${s.color}, ${a})`);
    g.addColorStop(1, 'rgba(0,0,0,0)');
    ctx.fillStyle = g;
    ctx.fillRect(s.x - s.r, s.y - s.r, s.r * 2, s.r * 2);
  }
}
```

- [ ] **Step 3: `drawSpace(n, elapsed)` — coin discs replacing flat circles**

Ellipse geometry: `RX = 26`, `RY = 19`, side-wall thickness 7. Per node:

1. Choice pulse (if `choices.has(n.id)`): pulsing golden ellipse ring + fill at `rx RX+10 / ry RY+8` (same pulse math as today, ellipse instead of circle).
2. Ground shadow ellipse `rgba(0,0,0,0.4)` at `(x, y+9)`, rx `RX+4`.
3. Side wall: ellipse at `(x, y+7)` filled with `darken(TYPE_COLORS[type])` — precomputed `TYPE_SIDE_COLORS` map (each is the type color at ~55% brightness; compute once at module load with a small hex-scale helper).
4. Top face: ellipse at `(x, y)` filled with `TYPE_COLORS[type]`, then a radial highlight gradient centered `(x - 7, y - 6)` from `rgba(255,255,255,0.28)` to transparent, then a 2.5px `rgba(0,0,0,0.55)` outline.
5. Glyph: existing Material Icons ligature, `22px`, at `(x, y - 1)`.
6. Snare tell (if snared): dashed brown ellipse at rx `RX+5`, unchanged dash pattern/color.

`darken` helper:

```ts
function scaleHex(hex: string, f: number): string {
  const v = parseInt(hex.slice(1), 16);
  const ch = (n: number) => Math.round(((v >> n) & 255) * f);
  return `rgb(${ch(16)}, ${ch(8)}, ${ch(0)})`;
}
const TYPE_SIDE_COLORS: Record<string, string> = Object.fromEntries(
  Object.entries(TYPE_COLORS).map(([k, c]) => [k, scaleHex(c, 0.55)]),
);
```

- [ ] **Step 4: Token pass — shadows, y-sort, label pass**

Keep the existing fan-out placement math per node, but collect placements into an array `{p, x, y}` instead of drawing immediately; sort by `y` ascending; for each draw an elliptical ground shadow (`rgba(0,0,0,0.35)`, rx `targetH*0.42`, ry 40% of rx, centered at sprite feet `y + targetH*0.48 + bob`) then the existing sprite/own-ring/shield rendering (unchanged). After all sprites, loop the same sorted array again for the name labels (existing pill code) so labels always sit on top. Token base position changes from `n.y - NODE_R*0.9` to `n.y - RY - 8` so sprites stand on the disc's top face.

- [ ] **Step 5: Update the file header comment** to describe the Dokapon-style rendering (terrain prerender + dynamic layer).

- [ ] **Step 6: Lint**

Run: `npm run lint`
Expected: clean.

- [ ] **Step 7: Commit**

```bash
git add src/app/undercity/engine/board-canvas.ts
git commit -m "feat(undercity): Dokapon-style 2.5D board rendering - discs, glows, y-sorted tokens"
```

---

### Task 3: Visual verification

**Files:** none (verification only)

- [ ] **Step 1: Run the app**

Run: `npm start`, open `http://localhost:4200`, click the navbar logo to enter `/undercity`, join/open a run so the board tab shows.

- [ ] **Step 2: Verify checklist**

- Terrain: moss plateaus with cliff shading under every node/path; river visible with shimmer; stalagmite border at world edges; mushrooms/crystals glowing off-path.
- Paths: curved amber-edged stone ribbons (no straight lines), studs along centers.
- Spaces: elliptical coin discs with side walls + highlights; icons legible; boss/gate/shop/shrine/warp/ossuary landmarks present above their discs.
- Interactions: pan/pinch/wheel/tap all work; roll → step choices pulse gold; snare tell dashes show; tokens stand on discs with shadows; own-player ring + labels render.
- Performance: smooth panning on a throttled mobile viewport (DevTools device mode).

- [ ] **Step 3: Fix anything broken, re-lint, commit fixes**

---

## Self-review notes

- Spec coverage: terrain (T1 S3-4), river (T1 S4), paths (T1 S5), landmarks (T1 S6), discs/snare/choice (T2 S3), tokens/shadows/y-sort (T2 S4), glows/shimmer (T2 S2), API/input unchanged (T2 scope), verification (T3). No gaps.
- Types consistent: `TerrainArt{canvas, glowSpots}`, `GlowSpot`, `TERRAIN_MARGIN`, `EdgeCurve` used identically across tasks.
- No test runner exists; lint + visual verification stand in for TDD (documented in header).
