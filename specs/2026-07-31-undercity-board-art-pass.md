# Undercity Board Art Pass Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Implement the five approved board-beautification treatments at the rev-2 tuned levels demoed in the "Waking the Chambers" artifact: living surface texture, whisper rim catch-light, cave-only god-rays + node light-pools + vignette, toned ambience (denser spores + fog banks), and illuminated region labels.

**Architecture:** Treatments 1–3 (partially) bake into the existing offscreen terrain canvas inside `renderTerrain()` — zero per-frame cost, no new persistent backing stores (the rim pass uses one transient canvas that is freed immediately, respecting the iOS WebKit memory ceiling). The vignette is one cached screen-space gradient in `BoardCanvas.draw()`. Ambience extends the existing `BoardAmbient` class (which already owns spore motes + bats). Labels restyle two existing draw sites in `board-terrain.ts`.

**Tech Stack:** TypeScript, Canvas 2D. Pure client-side rendering — no Lambda/DynamoDB/config-mirror changes.

**Design reference:** Approved interactive demo (rev 2 levels): https://claude.ai/code/artifact/a157f9dd-b303-4bb8-9931-04c7bf3dc39f — user feedback baked in: rim at ~⅓ pitch intensity ("catch-light, not neon"), god-rays only in cavern biomes and sparse, spores/fog toned down, texture as pitched, labels quiet.

**Verification:** No frontend test runner exists (per CLAUDE.md — do NOT try `ng test`; lint is broken, use the build). Every task verifies with `npm run build` (must exit 0) and the final task does a live browser check via the `run-undercity` skill. The Python suite (`cd infrastructure/lambda && python -m pytest tests -q`) is untouched by this work but run once at the end to prove it.

**Git hygiene (IMPORTANT):** The working tree carries unrelated user WIP (notably `board-canvas.ts`, `items.ts`, tab components — see `git status` before starting). Stage ONLY the files each task names, with explicit paths (`git add -- <file>`). Before any commit that touches `board-canvas.ts`, run `git diff --cached` and confirm only this plan's hunks are staged (`git add -p` if user WIP is present in the same file — and if the WIP overlaps our hunks, STOP and ask the user).

---

## Rendering-pipeline map (context for every task)

`src/app/undercity/engine/board-terrain.ts` — `renderTerrain()` bakes the whole world once into an offscreen canvas at `TERRAIN_RES = 0.6`:

- Step 1 (~line 1398): cave floor `#141110`, ghosted floor paintings, 320 dark blotches, per-chamber `tint` washes over `FLOOR_ZONES`.
- Step 3 (~line 1476): plateau blobs grouped per region in `blobs: Map<string, TerrainBlob[]>`; `fillRegionBlobs()` (~line 1824) draws cliff pass, top pass, then a sparse `mottle` loop (~line 1514–1523).
- Step 5 (~line 1546): ghosted region titles (`italic 600 46px Georgia`, `rgba(210,235,220,0.16)`), plus `drawMapLabels()` (~line 3352) for hand-placed labels.
- `REGION_THEMES` (~line 126): 14 entries (9 overworld + 5 `dungeon:*`), each `{ top, cliff, cliffH, mottle, tint, path:{rim,edge,fill,stud} }`.
- `glowSpots: GlowSpot[]` collected during bake; `BoardCanvas.drawGlows()` (board-canvas.ts:1575) animates them each frame with alpha 0.05–0.10, view-culled.

`src/app/undercity/engine/board-canvas.ts` — `draw()` (line 1269) blits the baked terrain (line 1305), then motifs/glows/flora/discs/tokens, then `this.ambient.drawAtmosphere(...)` (line 1505), `drawInfo()`, and closes the camera transform with `ctx.restore()` at line 1520.

`src/app/undercity/engine/board-ambient.ts` — `BoardAmbient`: 42 spore motes world-wide + bat flock. `AMBIENT_STYLES` keyed `overworld | city | cavern | bog | bone | garden`; `setContext()` re-scatters motes when entering a dungeon pocket.

The map editor calls `renderTerrain` full-res with everything baked — all new bake passes appear there automatically; no editor changes needed.

---

### Task 1: Theme plumbing — `glow`, `rimAlpha`, `shafts` on `RegionTheme`

**Files:**
- Modify: `src/app/undercity/engine/board-terrain.ts:117-260` (the `RegionTheme` interface + all 14 `REGION_THEMES` entries)

- [ ] **Step 1: Extend the interface**

In `board-terrain.ts`, add three fields to `RegionTheme` (after `path`):

```ts
interface RegionTheme {
  top: string; // plateau surface
  cliff: string; // pseudo-height rim under the south edge
  cliffH: number; // how tall the ground reads — chunky stone vs low marsh
  mottle: string; // soft highlight blotches on the surface
  tint: string; // floor wash coloring the cave floor around the chamber
  path: { rim: string; edge: string; fill: string; stud: string };
  /** 'r, g, b' triple for rim catch-light, light pools, shafts and label glow. */
  glow: string;
  /** Per-region rim intensity multiplier (default 1) — pale/bright biomes dial down. */
  rimAlpha?: number;
  /** Bake faint god-ray shafts into this chamber's floor (living caves only). */
  shafts?: boolean;
}
```

- [ ] **Step 2: Add the values to every theme entry**

Each `glow` is the biome's `path.edge` hue as an rgb triple. Pale/bright biomes (bone, isle, depths and dungeon:bone) get `rimAlpha` reductions — the user flagged bone/isle as the loudest glow colors. Only the two living-cave themes get `shafts: true`.

| theme key | add |
|---|---|
| `city` | `glow: '120, 240, 170',` |
| `cavern` | `glow: '116, 240, 214', shafts: true,` |
| `bog` | `glow: '214, 170, 92',` |
| `isle` | `glow: '184, 122, 255', rimAlpha: 0.7,` |
| `wilderness` | `glow: '224, 117, 46',` |
| `ruin` | `glow: '226, 204, 150',` |
| `bone` | `glow: '230, 222, 196', rimAlpha: 0.7,` |
| `garden` | `glow: '160, 210, 90',` |
| `depths` | `glow: '160, 110, 220', rimAlpha: 0.6,` |
| `dungeon:city` | `glow: '216, 188, 150',` |
| `dungeon:cavern` | `glow: '143, 252, 226', shafts: true,` |
| `dungeon:bog` | `glow: '106, 168, 160',` |
| `dungeon:bone` | `glow: '214, 203, 170', rimAlpha: 0.7,` |
| `dungeon:garden` | `glow: '185, 194, 90',` |

Example (the `cavern` entry after the edit):

```ts
  cavern: {
    top: '#1a4740',
    cliff: '#0a231e',
    cliffH: 13,
    mottle: 'rgba(96, 214, 190, 0.20)',
    tint: 'rgba(52, 158, 146, 0.20)',
    path: { rim: '#233028', edge: '#74f0d6', fill: '#527568', stud: 'rgba(214, 250, 240, 0.6)' },
    glow: '116, 240, 214',
    shafts: true,
  },
```

- [ ] **Step 3: Verify the build**

Run: `npm run build` (from repo root, via Bash)
Expected: exit 0. (TS will error on any theme entry missing `glow` since the field is non-optional — that's the completeness check.)

- [ ] **Step 4: Commit**

```bash
git add -- src/app/undercity/engine/board-terrain.ts
git commit -m "feat(undercity): add glow/rimAlpha/shafts fields to region themes"
```

---

### Task 2: Split `fillRegionBlobs` into trace + fill, add the surface-texture pass

**Files:**
- Modify: `src/app/undercity/engine/board-terrain.ts:1824-1902` (refactor), `:1514-1523` area (new bake pass after the mottle loop)

- [ ] **Step 1: Extract `traceRegionBlobs`**

Replace the body of `fillRegionBlobs` so the path construction lives in a new `traceRegionBlobs` (identical shape code, no fill), and `fillRegionBlobs` becomes a wrapper. The shape branches (masonry slab / bog splat / isle shard / cavern blob) move verbatim — only the `ctx.fillStyle = style;` line and final `ctx.fill();` stay in the wrapper:

```ts
/** Build one region's unioned ground path (no fill) — shared by the fill,
 *  rim and texture passes so every pass traces the identical silhouette. */
function traceRegionBlobs(
  ctx: CanvasRenderingContext2D,
  region: string,
  list: TerrainBlob[],
  offsetY: number,
): void {
  ctx.beginPath();
  for (const b of list) {
    // Move the existing shape-language branches here VERBATIM from the current
    // fillRegionBlobs body (board-terrain.ts lines 1833-1900): the per-blob
    // `const rnd = mulberry32(b.seed)` + `const y = b.y + offsetY` preamble and
    // the four branches (city/ruin/bone masonry slab, bog marsh splat, isle
    // shard, default cavern blob). No logic changes — only the surrounding
    // `ctx.fillStyle = style` and trailing `ctx.fill()` stay in the wrapper.
  }
}

function fillRegionBlobs(
  ctx: CanvasRenderingContext2D,
  region: string,
  list: TerrainBlob[],
  offsetY: number,
  style: string,
): void {
  ctx.fillStyle = style;
  traceRegionBlobs(ctx, region, list, offsetY);
  ctx.fill();
}
```

(The existing body already opens with `ctx.beginPath()`; keep the seed-driven `mulberry32(b.seed)` per blob so all passes reproduce the same wobble.)

- [ ] **Step 2: Add the texture stamp function**

Next to `fillRegionBlobs`, add:

```ts
/**
 * Living-surface texture: seeded grain speckle, hairline cracks and soft
 * moss/lichen patches, clipped to the region's plateau union so nothing
 * bleeds onto the cave floor. Bake-time only. Mark sizes stay ≥3 world px
 * so the TERRAIN_RES 0.6 bake doesn't dissolve them.
 */
function textureRegionBlobs(
  ctx: CanvasRenderingContext2D,
  region: string,
  list: TerrainBlob[],
): void {
  if (!list.length) return;
  const th = theme(region);
  const rand = mulberry32(hashStr('tex-' + region));
  let x0 = Infinity, y0 = Infinity, x1 = -Infinity, y1 = -Infinity;
  for (const b of list) {
    x0 = Math.min(x0, b.x - b.r * 1.3);
    y0 = Math.min(y0, b.y - b.r * 1.3);
    x1 = Math.max(x1, b.x + b.r * 1.3);
    y1 = Math.max(y1, b.y + b.r * 1.3);
  }
  const area = (x1 - x0) * (y1 - y0);
  ctx.save();
  traceRegionBlobs(ctx, region, list, 0);
  ctx.clip();
  // Grain: two-tone speckle, ~1 mark per 2600 px² of bbox (clip discards misses).
  const speckles = Math.min(2400, Math.round(area / 2600));
  for (let i = 0; i < speckles; i++) {
    const x = x0 + rand() * (x1 - x0);
    const y = y0 + rand() * (y1 - y0);
    ctx.fillStyle = rand() > 0.5 ? 'rgba(255,255,255,0.05)' : 'rgba(0,0,0,0.10)';
    ctx.beginPath();
    ctx.ellipse(x, y, 2 + rand() * 2, 1.5 + rand() * 1.5, rand() * 3, 0, Math.PI * 2);
    ctx.fill();
  }
  // Hairline cracks: short seeded polylines.
  const cracks = Math.min(70, Math.round(area / 45000));
  ctx.strokeStyle = 'rgba(0,0,0,0.28)';
  ctx.lineWidth = 2;
  for (let i = 0; i < cracks; i++) {
    let cx = x0 + rand() * (x1 - x0);
    let cy = y0 + rand() * (y1 - y0);
    ctx.beginPath();
    ctx.moveTo(cx, cy);
    const segs = 3 + Math.floor(rand() * 3);
    for (let s = 0; s < segs; s++) {
      cx += (rand() - 0.5) * 46;
      cy += (rand() - 0.3) * 26;
      ctx.lineTo(cx, cy);
    }
    ctx.stroke();
  }
  // Moss/lichen: soft radial patches in the region's existing mottle color.
  const moss = Math.min(110, Math.round(area / 30000));
  for (let i = 0; i < moss; i++) {
    const x = x0 + rand() * (x1 - x0);
    const y = y0 + rand() * (y1 - y0);
    const r = 10 + rand() * 20;
    const g = ctx.createRadialGradient(x, y, 0, x, y, r);
    g.addColorStop(0, th.mottle);
    g.addColorStop(1, 'rgba(0,0,0,0)');
    ctx.fillStyle = g;
    ctx.fillRect(x - r, y - r, r * 2, r * 2);
  }
  ctx.restore();
}
```

- [ ] **Step 3: Call it from renderTerrain**

Immediately after the existing mottle loop in step 3 (the `for (const [region, list] of blobs) { for (const b of list) { if (rand() > 0.4) continue; ...mottle gradient... } }` block ending ~line 1523), add:

```ts
  // 3b. Living surface texture — grain/cracks/moss clipped to each plateau.
  for (const [region, list] of blobs) {
    textureRegionBlobs(ctx, region, list);
  }
```

- [ ] **Step 4: Verify the build**

Run: `npm run build`
Expected: exit 0.

- [ ] **Step 5: Commit**

```bash
git add -- src/app/undercity/engine/board-terrain.ts
git commit -m "feat(undercity): bake living surface texture onto region plateaus"
```

---

### Task 3: Rim catch-light pass

**Files:**
- Modify: `src/app/undercity/engine/board-terrain.ts` (new pass right after Task 2's texture pass; helper next to `textureRegionBlobs`)

- [ ] **Step 1: Add the rim pass**

Insert after the `3b` texture loop added in Task 2 (this runs inside `renderTerrain`, where `canvas`, `resolution`, `bx`, `by` are in scope):

```ts
  // 3c. Rim catch-light: a ~4 px lit band along each region's silhouette in
  // the biome glow color, plus a soft blurred spill. Rendered on a transient
  // canvas (fill minus shrunken refill = band), then composited and freed —
  // no persistent backing store, so the iOS memory budget is unchanged.
  {
    const rimCanvas = document.createElement('canvas');
    rimCanvas.width = canvas.width;
    rimCanvas.height = canvas.height;
    const rc = rimCanvas.getContext('2d')!;
    rc.scale(resolution, resolution);
    rc.translate(TERRAIN_MARGIN - bx, TERRAIN_MARGIN - by);
    for (const [region, list] of blobs) {
      // Per-region intensity (rimAlpha) bakes into the band brightness here,
      // so bright glow colors (bone, isle, depths) come out pre-dimmed.
      rc.globalAlpha = theme(region).rimAlpha ?? 1;
      fillRegionBlobs(rc, region, list, 0, `rgb(${theme(region).glow})`);
    }
    rc.globalAlpha = 1;
    rc.globalCompositeOperation = 'destination-out';
    for (const [region, list] of blobs) {
      const shrunk = list.map((b) => ({ ...b, r: Math.max(6, b.r - 4) }));
      fillRegionBlobs(rc, region, shrunk, 0, '#000');
    }
    ctx.save();
    ctx.setTransform(1, 0, 0, 1, 0, 0);
    ctx.globalCompositeOperation = 'lighter';
    if (typeof ctx.filter === 'string') {
      ctx.filter = 'blur(5px)'; // soft spill just outside the edge
      ctx.globalAlpha = 0.09;
      ctx.drawImage(rimCanvas, 0, 0);
      ctx.filter = 'none';
    }
    ctx.globalAlpha = 0.16; // the crisp band itself — catch-light, not neon
    ctx.drawImage(rimCanvas, 0, 0);
    ctx.restore();
    rimCanvas.width = 0; // free the transient store immediately (iOS)
    rimCanvas.height = 0;
  }
```

- [ ] **Step 2: Verify the build**

Run: `npm run build`
Expected: exit 0.

- [ ] **Step 3: Visual sanity check**

Open the map editor route (`npm start`, browse to `/undercity/map-editor` — it renders `renderTerrain` full-res without needing game state). Confirm: thin lit band hugging every plateau edge, brighter in cavern/city, dimmer on bone/isle, no interior glow flooding.

- [ ] **Step 4: Commit**

```bash
git add -- src/app/undercity/engine/board-terrain.ts
git commit -m "feat(undercity): whisper rim catch-light along plateau silhouettes"
```

---

### Task 4: Cave-only god-rays + node light-pools

**Files:**
- Modify: `src/app/undercity/engine/board-terrain.ts` (step 1 after the `FLOOR_ZONES` tint-wash loop ~line 1444-1454; step 3 after the rim pass)

- [ ] **Step 1: Bake the shafts**

After the `FLOOR_ZONES` tint-wash loop (the `for (const z of FLOOR_ZONES) { for (const scale of [1, 0.55]) {...} }` block), add:

```ts
  // 1b. God-rays — reserved for the living caves (theme.shafts) and sparse
  // even there: two faint trapezoids of falling light per cave chamber.
  for (const z of FLOOR_ZONES) {
    const th = theme(z.region);
    if (!th.shafts) continue;
    const sRand = mulberry32(hashStr('shaft-' + z.region));
    ctx.save();
    ctx.globalCompositeOperation = 'lighter';
    for (const s of [
      { dx: -z.r * 0.18, w: z.r * 0.5, a: 0.05 },
      { dx: z.r * 0.55, w: z.r * 0.28, a: 0.03 },
    ]) {
      const topY = z.cy - z.r * 0.95;
      const botY = z.cy + z.r * 0.55;
      const x = z.cx + s.dx + (sRand() - 0.5) * 40;
      const g = ctx.createLinearGradient(x, topY, x + s.w * 0.35, botY);
      g.addColorStop(0, `rgba(${th.glow}, ${s.a})`);
      g.addColorStop(0.7, `rgba(${th.glow}, ${s.a * 0.35})`);
      g.addColorStop(1, 'rgba(0,0,0,0)');
      ctx.fillStyle = g;
      ctx.beginPath();
      ctx.moveTo(x - s.w * 0.14, topY);
      ctx.lineTo(x + s.w * 0.14, topY);
      ctx.lineTo(x + s.w * 0.62, botY);
      ctx.lineTo(x - s.w * 0.62, botY);
      ctx.closePath();
      ctx.fill();
    }
    ctx.restore();
  }
```

- [ ] **Step 2: Node light-pools via glowSpots**

After the rim pass (Task 3's `3c` block), add — these ride the existing `drawGlows` animator (alpha 0.05–0.10, view-culled), so the pools pulse for free:

```ts
  // 3d. Faint pulsing light-pool under every disc, in the biome glow color.
  for (const n of nodes) {
    glowSpots.push({
      x: n.x,
      y: n.y,
      r: 46,
      color: theme(themeKeyFor(n)).glow,
      phase: (hashStr(n.id) % 628) / 100,
    });
  }
```

- [ ] **Step 3: Verify the build**

Run: `npm run build`
Expected: exit 0.

- [ ] **Step 4: Commit**

```bash
git add -- src/app/undercity/engine/board-terrain.ts
git commit -m "feat(undercity): cave-only god-rays and pulsing node light-pools"
```

---

### Task 5: Screen-space vignette in BoardCanvas

**Files:**
- Modify: `src/app/undercity/engine/board-canvas.ts` — new private method + one call after the camera-transform `ctx.restore()` at the end of `draw()` (line ~1520)

- [ ] **Step 1: Add the cached-gradient method**

Add near `drawGlows` (board-canvas.ts:1575):

```ts
  /** Soft screen-space vignette so the cave darkens away from the action.
   *  Gradient is cached per viewport size — one fillRect per frame. */
  private vignetteCache: { grad: CanvasGradient; w: number; h: number } | null = null;
  private drawVignette(): void {
    const ctx = this.ctx;
    if (
      !this.vignetteCache ||
      this.vignetteCache.w !== this.viewW ||
      this.vignetteCache.h !== this.viewH
    ) {
      const cx = this.viewW / 2;
      const cy = this.viewH / 2;
      const g = ctx.createRadialGradient(
        cx, cy, Math.min(cx, cy) * 0.9,
        cx, cy, Math.hypot(cx, cy) * 1.05,
      );
      g.addColorStop(0, 'rgba(4, 3, 6, 0)');
      g.addColorStop(1, 'rgba(4, 3, 6, 0.32)');
      this.vignetteCache = { grad: g, w: this.viewW, h: this.viewH };
    }
    ctx.fillStyle = this.vignetteCache.grad;
    ctx.fillRect(0, 0, this.viewW, this.viewH);
  }
```

- [ ] **Step 2: Call it after the world restore**

At the end of `draw()`, immediately after the `ctx.restore();` that closes the camera transform (line 1520, right after `this.drawInfo();`):

```ts
    ctx.restore();

    // Screen-space vignette over the whole scene (transform is the dpr base).
    this.drawVignette();
```

- [ ] **Step 3: Verify the build**

Run: `npm run build`
Expected: exit 0.

- [ ] **Step 4: Commit (careful — this file carries user WIP)**

```bash
git add -p -- src/app/undercity/engine/board-canvas.ts   # stage ONLY the vignette hunks
git diff --cached   # confirm nothing unrelated is staged
git commit -m "feat(undercity): screen-space vignette on the game board"
```

---

### Task 6: Ambience tune-up — denser motes + drifting fog banks

**Files:**
- Modify: `src/app/undercity/engine/board-ambient.ts`

- [ ] **Step 1: Raise mote density with a per-context cap**

Today: 42 motes over the whole 4600×3200 world ≈ 4 visible per screen — invisible in practice. Target ≈ 20 visible (the approved rev-2 level). In the constructor, create 150 motes instead of 42; add an active-count field so a small dungeon pocket doesn't become a blizzard when `setContext` re-scatters:

```ts
  private motes: Mote[] = [];
  private activeMotes = 150;
```

Constructor loop: `for (let i = 0; i < 150; i++) { ... }` (body unchanged).

In `setContext`, after `this.styleKey = next;`:

```ts
    this.activeMotes = bounds ? 48 : 150;
```

In `drawAtmosphere`, change the mote loop to respect the cap:

```ts
    for (let i = 0; i < this.activeMotes; i++) {
      const m = this.motes[i];
      // ... existing body unchanged ...
    }
```

Keep the existing alpha formula (`Math.sin(life * Math.PI) * 0.32`) — it already matches the approved toned level.

- [ ] **Step 2: Add fog banks**

Add the interface + field + seeding (constructor) and drawing (top of `drawAtmosphere`, before the mote loop so fog sits under motes):

```ts
interface FogBank {
  x: number;
  y: number;
  r: number;
  phase: number;
}
```

```ts
  private fog: FogBank[] = [];
```

Constructor, after the mote loop:

```ts
    for (let i = 0; i < 8; i++) {
      this.fog.push({
        x: this.rand() * map.worldW,
        y: 120 + this.rand() * (map.worldH - 240),
        r: 170 + this.rand() * 120,
        phase: this.rand() * Math.PI * 2,
      });
    }
```

`setContext`, inside the `if (bounds)` re-scatter (dungeon pockets get 2 banks worth of coverage; just re-scatter all — the view cull handles density):

```ts
      for (const f of this.fog) {
        f.x = bounds.x + this.rand() * Math.max(1, bounds.w);
        f.y = bounds.y + 80 + this.rand() * Math.max(1, bounds.h - 160);
      }
```

`drawAtmosphere`, after `ctx.save();` and before the mote loop:

```ts
    // Barely-there fog banks drifting east, wrapping across the world.
    ctx.globalCompositeOperation = 'lighter';
    const span = this.map.worldW + 600;
    for (const f of this.fog) {
      const x = ((f.x + t * 8 + 300) % span) - 300;
      const y = f.y + Math.sin(t * 0.3 + f.phase) * 18;
      if (x < view.x0 - f.r || x > view.x1 + f.r || y < view.y0 - f.r || y > view.y1 + f.r) continue;
      const g = ctx.createRadialGradient(x, y, 0, x, y, f.r);
      g.addColorStop(0, `rgba(${style.colors[0]}, 0.022)`);
      g.addColorStop(1, 'rgba(0,0,0,0)');
      ctx.fillStyle = g;
      ctx.fillRect(x - f.r, y - f.r, f.r * 2, f.r * 2);
    }
    ctx.globalCompositeOperation = 'source-over';
```

- [ ] **Step 3: Verify the build**

Run: `npm run build`
Expected: exit 0.

- [ ] **Step 4: Commit**

```bash
git add -- src/app/undercity/engine/board-ambient.ts
git commit -m "feat(undercity): denser spore motes and drifting fog banks"
```

---

### Task 7: Illuminated region labels

**Files:**
- Modify: `src/app/undercity/engine/board-terrain.ts` — step 5 region titles (~line 1546-1577) and `drawMapLabels` (~line 3352)

- [ ] **Step 1: Restyle the overworld region titles**

Replace the overworld branch's label loop (inside `if (isOverworld) { ... }`, step 5). Current body sets one `fillStyle` and calls `fillText` per region; new version adds a soft biome-colored glow and a flourish underline:

```ts
    ctx.save();
    ctx.font = 'italic 600 46px Georgia, "Times New Roman", serif';
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';
    for (const [region, name] of Object.entries(LABEL_NAMES)) {
      if (!regionPts.has(region)) continue;
      const z = regionZone(region);
      const ox = z.cx - ISLAND.cx;
      const oy = z.cy - ISLAND.cy;
      const L = Math.hypot(ox, oy) || 1;
      const lx = z.cx + (ox / L) * 125;
      const ly = z.cy + (oy / L) * 125;
      const glow = theme(region).glow;
      ctx.save();
      ctx.shadowColor = `rgba(${glow}, 0.32)`;
      ctx.shadowBlur = 14;
      ctx.fillStyle = 'rgba(224, 240, 230, 0.20)';
      ctx.fillText(name, lx, ly);
      ctx.restore();
      // Flourish: a fading underline with a small diamond at its center.
      const uw = ctx.measureText(name).width * 0.42;
      const uy = ly + 32;
      const g = ctx.createLinearGradient(lx - uw, uy, lx + uw, uy);
      g.addColorStop(0, `rgba(${glow}, 0)`);
      g.addColorStop(0.5, `rgba(${glow}, 0.30)`);
      g.addColorStop(1, `rgba(${glow}, 0)`);
      ctx.strokeStyle = g;
      ctx.lineWidth = 1.5;
      ctx.beginPath();
      ctx.moveTo(lx - uw, uy);
      ctx.lineTo(lx + uw, uy);
      ctx.stroke();
      ctx.save();
      ctx.translate(lx, uy);
      ctx.rotate(Math.PI / 4);
      ctx.fillStyle = `rgba(${glow}, 0.45)`;
      ctx.fillRect(-3, -3, 6, 6);
      ctx.restore();
    }
    ctx.restore();
```

- [ ] **Step 2: Restyle the dungeon-layer title (the `else` branch)**

Same treatment, using the pocket's biome theme:

```ts
    const biome = nodes.length ? dungeonBiome(nodes[0].id, nodes[0].region) : null;
    const glow = theme(biome ? `dungeon:${biome}` : 'depths').glow;
    ctx.save();
    ctx.font = 'italic 600 40px Georgia, "Times New Roman", serif';
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';
    ctx.shadowColor = `rgba(${glow}, 0.32)`;
    ctx.shadowBlur = 14;
    ctx.fillStyle = 'rgba(224, 240, 230, 0.20)';
    ctx.fillText(biome ? DUNGEONS[biome].name : (LABEL_NAMES['depths'] ?? 'The Deep'), cx, cy);
    ctx.restore();
```

(Keep the existing `cx`/`cy` centroid computation above it unchanged.)

- [ ] **Step 3: Glow on hand-placed map labels**

In `drawMapLabels`, tint each label with its nearest region's glow (the function already imports `nearestNode`; call it unconditionally now):

```ts
export function drawMapLabels(
  ctx: CanvasRenderingContext2D,
  map: BoardMap,
  layer?: LayerSpec,
): void {
  for (const l of map.labels ?? []) {
    const n = nearestNode(map, l.x, l.y);
    if (layer && (!n || !layer.nodeIds.has(n.id))) continue;
    const glow = theme(n ? themeKeyFor(n) : 'cavern').glow;
    ctx.save();
    ctx.translate(l.x, l.y);
    ctx.rotate(l.rot);
    ctx.font = `italic 600 ${l.size}px Georgia, "Times New Roman", serif`;
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';
    ctx.shadowColor = `rgba(${glow}, 0.30)`;
    ctx.shadowBlur = 12;
    ctx.fillStyle = `rgba(210, 235, 220, ${Math.min(1, l.alpha * 1.25)})`;
    ctx.fillText(l.text, 0, 0);
    ctx.restore();
  }
}
```

- [ ] **Step 4: Verify the build**

Run: `npm run build`
Expected: exit 0.

- [ ] **Step 5: Commit**

```bash
git add -- src/app/undercity/engine/board-terrain.ts
git commit -m "feat(undercity): illuminated region titles and map labels"
```

---

### Task 8: End-to-end verification

**Files:** none (verification only)

- [ ] **Step 1: Full build**

Run: `npm run build`
Expected: exit 0, no new warnings about board-terrain/board-canvas/board-ambient.

- [ ] **Step 2: Python suite untouched**

Run: `cd infrastructure/lambda && python -m pytest tests -q`
Expected: all pass (no server files were modified; this is a regression tripwire).

- [ ] **Step 3: Live board check**

Use the `run-undercity` skill to launch the game in a browser and screenshot the overworld board. Verify against the approved artifact:
- Plateau tops show grain/moss (not flat vinyl); rim reads as a subtle catch-light; bone/isle are NOT louder than cavern/city.
- God-rays visible ONLY over Mosslight Cavern (and Gloomroot Hollow if you enter that pocket) — nowhere else.
- Spores clearly present but sparse (~15-25 on screen); fog barely perceptible; vignette darkens screen corners without crushing tokens.
- Region titles glow softly with the flourish underline; hand-placed labels (The Sedgemoor, Ossuary Fields plaques) glow in their region hue.
- Enter a dungeon pocket: gloom veil, mote re-scatter, and dungeon title glow all behave.
- Check the map editor at `/undercity/map-editor` still renders and drag-editing doesn't error (it re-bakes terrain with the new passes).

- [ ] **Step 4: Screenshot comparison for the user**

Capture before/after screenshots (git stash / unstash is NOT needed — the artifact serves as "before" reference). Report results; the user runs deploys themselves.
