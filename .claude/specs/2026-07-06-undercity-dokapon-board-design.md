# Undercity Board — Dokapon-Style 2.5D Map Design

**Date:** 2026-07-06
**Status:** Approved (user selected 2.5D painted canvas + luminous cavern palette)

## Goal

Replace the flat node-graph look of the Undercity board tab (dark background,
straight edges, flat colored circles) with a Dokapon Kingdom-style world map:
dimensional painterly terrain, winding path ribbons, chunky 3D-looking spaces,
and landmark buildings — while keeping the underground "Undercity" identity.

## Constraints

- **Client-side rendering only.** No changes to `undercity_data.py`,
  `undercity-map.json`, the node graph, coordinates, or any gameplay/backend
  code.
- **`BoardCanvas` public API unchanged**: constructor signature,
  `setPlayers`, `setSnares`, `setChoices`, `centerOn`, `start`, `stop`.
  `BoardTabComponent` needs no changes.
- **Input model unchanged**: same pan/drag/pinch/wheel/tap handling, same
  tap-radius hit testing on node centers.
- **Phone-first performance**: all static art is prerendered once to an
  offscreen canvas; the per-frame loop draws that image under the camera
  transform plus a small dynamic layer (tokens, pulses, glows).
- No new dependencies. Canvas 2D only.

## Palette: Luminous Cavern

Dokapon's bright overworld recolored underground, harmonizing with the
Golgari palette in STYLE_GUIDE.md:

- Cavern floor base: very dark warm brown-black (`#12100e` family) with
  vignette.
- Terrain plateaus: bioluminescent moss greens (mid `#2e4a2e` → bright
  `#4a7a3f` tops), dark rim shading on south edges for pseudo-height.
- River: glowing teal (`#2f7a7a` → `#5fd0c8` core), decorative only.
- Paths: lantern-lit stone — warm dark stone fill with glowing amber edge
  stripes (Dokapon's orange-edged roads, dimmed for a cave).
- Decorations: glowing mushrooms (violet/teal caps), pale crystals.
- Cavern wall border: near-black rock ring with stalagmite silhouettes at the
  world edges.

## Architecture

Two modules under `src/app/undercity/engine/`:

1. **`board-terrain.ts` (new, pure):**
   `renderTerrain(map: BoardMap): HTMLCanvasElement` — builds the full static
   world once (floor, plateaus, river, cavern walls, decorations, path
   ribbons, landmark buildings' *static* parts). Deterministic: all jitter and
   scatter uses a small seeded PRNG (mulberry32-style) keyed off node ids /
   fixed seed, so the map looks identical every load.
   Also exports the curved-edge geometry (`edgeCurves`) so the dynamic layer
   and terrain layer agree on path shapes if needed.

2. **`board-canvas.ts` (reworked drawing, same shell):** keeps camera, input,
   lifecycle, hit-testing. Per frame: draw terrain image, then the dynamic
   layer y-sorted (painter's algorithm): choice pulses, snare tells, space
   discs' animated accents, player tokens with ground shadows, name labels,
   animated glows (river shimmer, mushroom pulse) as cheap alpha-pulsed
   overlays.

## Visual Elements

### Terrain plateaus
Blobby unions of discs placed along every edge and around every node (drawn
as one filled path region on the offscreen canvas): a darker "cliff" pass
offset ~10px down first, then the lit top surface, then a brighter mottled
highlight pass. Reads as raised Dokapon-style land masses over the cavern
floor.

### River
A hardcoded spline of control points crossing a node-free region of the
1800×1200 world, drawn as a wide dark channel + teal core + soft glow. The
dynamic layer adds a slow-moving alpha shimmer.

### Paths
Each graph edge is a quadratic Bézier: control point = midpoint offset
perpendicular by a deterministic jitter (±18–36px, seeded per edge key).
Drawn as: wide dark stone base stripe → lighter stone fill → two thin glowing
amber border stripes → sparse center studs (Dokapon's dashed road center).
Tap/step logic is unaffected (hit testing stays on nodes).

### Spaces (coin discs)
Each node: elliptical disc (rx = 26, ry ≈ 0.72·rx) with a darker side-wall
ellipse offset ~7px below (thickness), type-colored top face with radial
highlight, thin dark outline, Material Icons glyph on top. Choice highlight =
pulsing golden ellipse ring + fill (dynamic layer). Snare tell = dashed
brown ellipse (dynamic layer, unchanged semantics).

### Landmarks
Procedural canvas drawings anchored just above their node's disc, static on
the terrain layer, sized ~60–110px:

- **boss** — dark citadel: crenellated towers, glowing violet windows.
- **gate** — stone arch over the disc.
- **shop** (3 tiers share one stall design) — awning stall, front + roof face.
- **shrine** — stone altar with glowing brazier.
- **warp** — glowing portal ring/stones.
- **ossuary** — bone-pile crypt front.

Each uses a lit front face + darker/lighter roof face for the faux-3D read.

### Tokens
Existing recolored sprites unchanged; add an elliptical ground shadow under
each token. Tokens y-sort among themselves (back-to-front) so sprites on
lower nodes draw over sprites on higher ones. Landmarks are baked into the
static terrain layer, so tokens always draw over them — acceptable because
landmarks sit above their own disc and nodes are far enough apart that a
token rarely overlaps another node's landmark.

## Draw order (per frame)

1. Screen clear → terrain image (camera transform).
2. Animated terrain accents: river shimmer, mushroom/crystal glow pulse.
3. Space discs (top faces + glyphs), snare tells, choice pulses.
4. Player tokens sorted by world y, drawn back-to-front, each with its
   ground shadow.
5. Name labels last (never occluded).

## Error handling

- `renderTerrain` is pure math + canvas calls with no I/O, built once at
  construction. Discs, icons, tokens, and highlights all draw on the dynamic
  layer, so even a blank terrain image leaves the board fully playable.
- Material Icons font readiness is already handled by sprite-engine preload;
  glyph drawing is unchanged.

## Testing / verification

- No frontend test runner exists (per CLAUDE.md). Verification is:
  `npm run lint` clean, `npm start`, drive `/undercity` board tab, and
  visually confirm terrain, paths, discs, landmarks, tokens, pan/zoom/tap,
  step-choice pulses, and snare tells.
- Backend tests untouched (no backend changes).

## Out of scope

- three.js / WebGL, real perspective camera.
- Map/topology changes, new node types, gameplay changes.
- Plaza and ceremony canvases (board tab only).

---

# v2 Addendum — Three Linked Caverns (approved 2026-07-06)

The ring-with-cross layout is replaced by three themed chambers. This
revision DOES change map topology (positions + edges in
`undercity_data._build_map()`), but keeps every node id, type, shop tier,
and the `BOSS_BRIDGE` anchor, so all map tests and balance stay intact.

## Layout

- **South, 12 spaces — The Undercity** (`n0-n9`, `n24`, `n25`): large loop,
  gate `n0` bottom center, tier-1 shop `n5`. Theme matches
  `public/undercity/undercity_background.png`: emerald-teal gothic stone.
- **Northwest, 10 spaces — Mosslight Cavern** (`n10-n17`, `a5`, `b4`):
  mid-size loop, tier-2 shop `n14`. Keeps the v1 luminous-cavern look
  (moss, mushrooms, crystals).
- **Northeast, 9 spaces — The Sedgemoor** (`n18-n23`, `a1`, `a2`, `b0`):
  small bog loop, tier-3 shop `a2`. Theme matches
  `public/undercity/swamp_background.png`: murky pools, lily pads, reeds,
  gnarled trees, wisps.
- **Tunnels, 2 nodes each**: south↔NW (`a0`, `a4`), south↔NE (`b1`, `b2`),
  NW↔NE across the top (`b3`, `a3`). Every walkable node keeps degree ≥ 2 so
  exact-count movement never strands (the warp-only boss island keeps its
  existing linear chain, unchanged behavior).
- **Boss island** (`isl_warp`, `isl_ossuary`, `boss`) floats in the dark
  central hollow.

## Data

Each node gains a `region` field (`city` | `cavern` | `bog` | `isle`) in
`MAP_NODES`, flowing into `undercity-map.json` via the existing generator.
The engine ignores it; the client `BoardNode` type gets an optional
`region?: string`.

## Terrain theming (board-terrain.ts)

Per-region plateau palettes, path ribbon styles (city cobblestone, cavern
amber-edged stone, bog planks with cross-ticks), and decoration sets (city:
ruined pillars/arches, glowing windows, skull piles; cavern: mushrooms +
crystals; bog: water pools with lily pads, reeds, tree silhouettes, wisp
glows). The river follows fixed control points: out of the Mosslight
Cavern, through the hollow south of the island, draining east through the
Sedgemoor. Each chamber gets a low-alpha painted name label at its hollow
center. Landmarks and the dynamic layer (discs, tokens, glows) are
unchanged.
