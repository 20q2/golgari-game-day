# Undercity overworld flora sway

**Date:** 2026-07-24
**Status:** approved, implementing

## Goal

Give the procedurally-scattered soft flora on the Undercity board a gentle idle
sway — a couple of degrees of wind pivot at the base — so the overworld reads as
alive instead of a frozen painting. Applies to mushrooms ("bushrooms"), giant
mushrooms, reeds, and bog trees. Rigid props (pillars, ruin blocks, bone/skull
piles, crystals, pools, etc.) stay dead still — stone shouldn't wobble.

## Constraint that shapes everything

The scatter decorations are **baked once** into the static terrain canvas in
`renderTerrain()` (board-terrain.ts, scatter loop) and blitted under the camera
each frame, so they physically can't move today. The engine already has a
per-frame dynamic pass right after tokens (`drawDecals('over')`,
`ambient.drawAtmosphere()`), and `drawGlows()` already pulses a list of static
`glowSpots` collected at bake time.

The fix: stop baking the four soft-flora kinds and redraw them each frame in a
new dynamic pass, wrapped in a base-pivot rotation. Re-running the (tiny) vector
draw functions per frame is cheap at these counts (~40-80 clusters on the
overworld, culled to viewport); a sprite-cache blit is the fallback if it ever
profiles hot.

## Design

### Data
- `FloraInstance { kind: string; x: number; y: number; seed: number }`.
- `TerrainArt` gains `flora: FloraInstance[]` — the collected soft-flora
  instances for this layer (empty when flora was baked statically).
- `SOFT_FLORA = Set(['mushrooms','giant_mushroom','reeds','bog_tree'])`.
- `FLORA_SWAY: Record<kind, { amp: number; speed: number }>` — per-kind sway so
  they don't all move as one:
  - `reeds`   `{ amp: 0.11, speed: 1.9 }` — light, sways most
  - `mushrooms` `{ amp: 0.06, speed: 1.5 }`
  - `giant_mushroom` `{ amp: 0.035, speed: 1.1 }` — bigger, heavier
  - `bog_tree` `{ amp: 0.028, speed: 0.9 }` — heavy trunk, barely

### Bake-time (board-terrain.ts)
- `renderTerrain` gains `opts.animateFlora?: boolean` (default **false** — every
  existing caller, notably the map editor, keeps baking flora statically and is
  unchanged).
- The scatter loop routes the four soft-flora kinds through one helper:
  - `animateFlora === false` → draw into the bake exactly as today (shared
    `rand`, glow into `glowSpots`).
  - `animateFlora === true` → derive `seed = floor(rand() * 2^32)`, harvest the
    prop's `glowSpots` once via a throwaway scratch ctx (using `stampRand(seed)`
    so the glow color/phase matches the drawn cluster), push a `FloraInstance`,
    and do **not** bake the shapes.
  - Rigid props are untouched in both modes.
- Determinism: seeds/positions stay seeded, so the layout is stable across
  reloads. It shifts once from today's exact positions (purely cosmetic) because
  the shared RNG now advances by one call per soft-flora instead of N.

### Per-frame (exported `drawFlora`, called from board-canvas.ts)
```
drawFlora(ctx, flora, elapsed, view, glowSink = []):
  for f in flora:
    cull to view (+80px margin)
    sway = FLORA_SWAY[f.kind].amp * sin(elapsed * speed + phase(f.seed))
    translate(f.x,f.y); rotate(sway); translate(-f.x,-f.y)
    STAMPS[f.kind](ctx, f.x, f.y, stampRand(f.seed), glowSink)   // fresh RNG => stable shape
```
- Phase from `seed` desyncs neighbours. Base-pivot keeps feet/ground-shadow
  planted; only the tops sway (~2-3px).
- Glow re-pushed per frame is discarded — the halos are already baked into
  `terrain.glowSpots` and pulsed by `drawGlows()`.

### Wiring (board-canvas.ts)
- The two `renderTerrain` calls owned by `BoardCanvas` (constructor +
  `rebuildLayers`) pass `animateFlora: true`.
- New pass calls `drawFlora(ctx, this.active.terrain.flora, elapsed, view)` right
  after the terrain blit + `drawGlows()` and before the gloom veil / discs, so
  flora sits under discs and tokens as it did when baked.

## Scope / caveats
- **Procedural scatter only** — hand-placed map.json flora *decals* stay static
  (easy follow-up for consistency if wanted).
- **All layers that scatter** — overworld + dungeon pockets (same code path).
- **Editor unchanged** — `animateFlora` defaults off, so the editor still bakes.
- **Minor:** dynamic flora now draws over the baked vignette (a hair less edge
  shading) and over paths — but scatter is kept 100-260px off nodes and 55px+ off
  paths/river, so nothing actually overlaps. Negligible.

## Verification
No canvas tests are wired. Confirm with `npm run build` (lint is broken in this
repo) and by running the board to eyeball the sway. Deploy is the user's.
