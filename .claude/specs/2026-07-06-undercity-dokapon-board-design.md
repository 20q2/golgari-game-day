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

## Terrain theming (v2, board-terrain.ts)

Per-region plateau palettes, path ribbon styles (city cobblestone, cavern
amber-edged stone, bog planks with cross-ticks), and decoration sets (city:
ruined pillars/arches, glowing windows, skull piles; cavern: mushrooms +
crystals; bog: water pools with lily pads, reeds, tree silhouettes, wisp
glows). The river follows fixed control points: out of the Mosslight
Cavern, through the hollow south of the island, draining east through the
Sedgemoor. Each chamber gets a low-alpha painted name label at its hollow
center. Landmarks and the dynamic layer (discs, tokens, glows) are
unchanged.

---

# v3 Addendum — Goals on the Map (approved 2026-07-08)

Dokapon boards give you somewhere to *go*. This revision adds destinations,
gates, and a sub-area, expanding the world to 3200×2100.

## New space types

- **barrier** (×2): a blocked passage guarded by a strong fixed guardian.
  Exact-count movement may END on a closed barrier but never pass THROUGH
  it. Landing on it starts a battle; winning breaks the barrier open **for
  the whole season** (shared state on the season doc, announced in the
  event log, winner gets bounty + renown). Open barriers are plain
  pass-through spaces.
- **lair** (×2): a mini-boss much stronger than any wild. First kill per
  player pays a large reward (spores + XP + renown); repeat kills pay a
  small bounty. Tracked per player in `poiClaims`.
- **vault** (×1): deep behind a barrier; first visit per player pays a big
  treasure (spores + renown). Tracked in `poiClaims`.
- **ladder** (×2, one pair): the two ends of a climb. They are graph
  neighbors, so movement flows through them normally, but the client draws
  no path ribbon between them — the link reads as "descends to the
  Broodwarrens" rather than a road across the map.

## New areas (all loops — no strandable dead ends)

- **Titan's Rest** (far east, behind barrier `bar_e` off the Sedgemoor):
  guardian *Rubble Hulk*; inside, a small loop with the *Gravebound
  Colossus* lair.
- **The Sunken Vaults** (far south-east, behind `bar_s` off the Undercity):
  guardian *Bone Warden*; inside, a loop holding the treasure vault.
- **The Broodwarrens** (south-west corner): a pitch-dark `depths`-region
  dungeon pocket reached only via the ladder pair from the Undercity's
  west side; dense wild/hazard loop with the *Broodmother* lair at the
  bottom.

## Engine

`legal_destinations(nodes, start, steps, closed)` gains a `closed` set:
closed barrier nodes are valid endpoints but never expanded through. `_roll`
computes dests with the season's current closed set; the client `legalSteps`
mirrors the same rule. Barrier/lair fights reuse `resolve_battle` with fixed
(unscaled) stats; losses compost as usual. `GET /game/state` now returns
`barriersOpen`.

Balance tables (`BARRIER_GUARDIANS`, `LAIR_BOSSES`, `VAULT_REWARD`) live in
`undercity_data.py`; display copies mirror into the client data files.

## Client

New type colors/icons/names; closed barriers draw a rubble mound + lock
that clears when opened; lairs draw as menacing landmarks; the dungeon gets
its own near-black region theme and floor zone; terrain skips ladder-pair
edges when drawing ribbons and ground. Board-tab reuses the existing battle
playback for guardian/lair fights and the space modal for vault/ladder.

---

# v4 Addendum — Five Home Biomes + Sigil Boss Gate (approved 2026-07-09)

World grows to 3600×2400. Five home-biome rings (10 spaces each: gate facing
the island, tier shop, warp, shrine/ossuary, loot/wild/mystery/hazard) sit in
a pentagon around the floating boss island, each with a 2-space inner chord
across its hollow and a 7-node dungeon pocket hanging off its outward side,
reached only by a ladder pair. Pentagon tunnels link neighbor rings. The two
v3 barrier pockets (Titan's Rest, Sunken Vaults) remain as optional side
content. 120 nodes total.

**Biomes + hatch perks** (`BIOMES` in undercity_data.py; picked at hatch after
the creature, before join):
- Undercity — City Rat: +15 starting Spores
- Mosslight Cavern — Glowblessed: +10% flee chance
- Sedgemoor — Mirefoot: hazards cost half
- Ossuary Fields — Marrowborn: +2 DEF vs wilds
- Rot-Gardens — Composter: +2 Spores from loot

Home biome sets your start gate and respawn gate (`homeBiome` on the player
doc; `_compost` respawns there).

**Guild Sigils:** first-clear of a biome dungeon's lair (`SIGIL_LAIRS`) grants
that biome's sigil (a `poiClaims` entry, +25 renown each). Titan's Rest lair
is non-sigil side content.

**Island boss (The Rot Sovereign):** unseals per-player at 3 sigils; landing
without enough bounces with a taunt. One persistent HP pool on the season doc
(`BOSS` item) — anyone qualified chips at it across fights; the killing blow
takes the kill (first-per-player pays big + `poiClaims` 'boss'), then it
reforms at full HP for the next challenger. `bossDamage` accrues per hit. HP
surfaced in `/game/state.boss`.

**Client:** hatch gains a biome-picker step; terrain is now data-driven from
per-region node centroids (floor zones, tint washes, labels auto-fit any
layout); `bone` and `garden` region themes added.

---

# v5 Addendum — Layered Board + Grand Crossings (approved 2026-07-09)

Two client-only visual/UX changes to the board tab. **No backend, map-data,
or `undercity-map.json` changes**, and the existing `MAP_NODES` graph
(positions, regions, ladder pairs) is the source of truth as-is.

## Goal

1. **Hide the dungeons.** The five `depths` dungeon pockets (reached only by a
   ladder down from a home biome) should NOT clutter the overworld map. Each
   is its own hidden **layer**, presented as a separate sub-view revealed only
   once your token actually descends its ladder.
2. **Make crossings feel like crossings.** Paths that connect one region to
   another should read as deliberate **raised stone roads** (grand causeways),
   visually distinct from the local paths inside a chamber, so leaving a biome
   is legible.

## Facts (verified against the current map)

- `depths` nodes form exactly **5 connected components, 6 nodes each**. Each
  component touches the overworld only through its ladder pair
  `<biome>_lt` (region = home biome, on the overworld) ↔ `<biome>_lb`
  (region = `depths`, in the pocket). No other depths↔overworld edges exist.
- Ruin / vault pockets (Titan's Rest, Sunken Vaults) are reached by
  **barriers, not ladders**, so they stay on the overworld. Only `depths`
  pockets become hidden layers.
- The boss `isle` is warp-reached and stays on the overworld.

## Layer model

Define `layerOf(nodeId)`:
- `'overworld'` for every node with `region !== 'depths'`.
- one pocket id per `depths` connected component (computed once at construct
  via union-find over depths-only edges; the ladder edge to `_lt` is not
  crossed, so components stay separate).

`BoardCanvas` holds `layers: Map<layerId, Layer>` where
`Layer = { terrain: TerrainArt; bounds: {w,h}; nodeIds: Set<string> }` and an
`activeLayerId` (default `'overworld'`).

## Active layer = where your token is (auto-follow)

The active layer follows YOUR token, using signals BoardCanvas already
receives — so **`BoardCanvas`'s public API and `BoardTabComponent` are
unchanged**:

- `setPlayers` already sets `ownPosition`. On change, recompute
  `layerOf(ownPosition)`. If it differs from `activeLayerId`, swap: set the
  new active layer, `centerOn(ownPosition, false)`, clamp camera to the new
  layer's bounds.
- During a multi-step walk the component feeds `ownPosition = stepPos(step)`
  each step (existing behaviour), so the swap happens naturally the moment the
  token crosses the ladder; the camera glide already fires per step.

Rendering/interaction are filtered to the active layer:
- `draw()` blits `layers.get(activeLayerId).terrain` and draws only nodes,
  tokens, choices, snares, and glows whose node is in that layer's `nodeIds`.
  A player who is down a dungeon you're not in simply isn't drawn (reappears
  when they climb out).
- Hit-testing (`handleTap`) only considers active-layer nodes — plus the
  ladder-partner routing below.
- `clampCamera` / min-zoom-fit use the active layer's `bounds` (the dungeon
  canvas is small, so at min zoom it fits its own pocket; no extra math —
  same clamp with swapped dims).

## Descent / ascent (crossing the ladder)

The step-choice to cross a ladder targets a node on the *other* (hidden)
layer, so the hidden partner needs a visible, tappable stand-in:

- **Overworld:** each ladder-top `_lt` is drawn as a **stairwell-down
  landmark** (replacing v3's faint dotted plumb-line). When its partner `_lb`
  is a live step-choice (present in `choices`), the stairwell wears the same
  glowing "forward step" ring the discs use. In `handleTap`, a tap that lands
  on a ladder node returns its depths-partner id when that partner is a
  current choice — so the existing `onTapNode` → `stepChoices` → step flow
  moves the token to `_lb`, which flips the active layer to that dungeon.
- **Dungeon:** the `_lb` node draws a **stairs-up marker**; the same
  partner-routing lets a tap step back up to `_lt`.
- No new buttons, no new component state; reuses the existing step walk.

## Terrain: prerender per layer (`board-terrain.ts`)

`renderTerrain` is refactored to build one canvas per layer instead of one
world canvas. Signature adds an optional layer descriptor (nodes subset +
bounds); the loader in `BoardCanvas` builds all layers and rebuilds them all
when floor/landmark images arrive (same rebuild pattern as today).

- **Overworld canvas:** the current world render, but depths nodes, their
  edges, and their decorations are excluded; each `_lt` gets the stairwell
  landmark.
- **Dungeon canvas (per pocket):** sized to that pocket's bounding box +
  `TERRAIN_MARGIN`, drawn with the existing `depths` region theme, its own
  floor painting, and a label from that pocket's own centroid. (Bonus: this
  fixes today's single muddy "The Deep" label/floor-zone that averages all
  five pockets into one blob.)

## Grand crossings — raised stone roads

In the overworld render, an edge whose endpoints are in **different regions**
(both non-depths) draws as a **causeway** instead of the current
cavern-stone fallback: a wider deck, a stone kerb stripe down each side,
a lantern post near each end, and a faint lantern glow-spot registered for
the animated layer. Same-region edges keep their per-chamber path style;
ladder edges draw no road (they get the stairwell landmark instead). River
bridges still overlay wherever a causeway crosses the river.

## Error handling / perf

- Layers are prerendered once (and once per image-load rebuild), unchanged
  from today's offscreen-canvas approach; the per-frame cost is one blit +
  the filtered dynamic layer, same as now.
- A pocket whose floor image fails to load just renders dark `depths` theme —
  still fully playable, matching current behaviour.
- If `ownPosition` is ever unknown, active layer stays `'overworld'`.

## Testing / verification

No frontend test runner (per CLAUDE.md). Verify: `npm run lint` clean;
`npm start`; on `/undercity` board tab confirm — overworld shows no dungeon
clutter; ladder-tops show stairwell + descend ring when a roll reaches them;
stepping down swaps to the dungeon sub-view centered on the token; climbing
back returns to the overworld; inter-region edges read as lantern-lit
causeways distinct from in-chamber paths; pan/zoom/tap, step choices, snares,
and battles still work on both layers. Backend tests untouched.

## Out of scope

- Any map/topology/backend change; new node types; plaza/ceremony canvases.
- A manual "peek" toggle (view strictly auto-follows the token).

---

# v6 Addendum — Unique Dungeons (approved 2026-07-09)

Each of the five biome dungeons becomes a distinct place: its own name,
shape, look, lair set-piece, hazard, fauna, treasure, light, ambience, and
entry flavor. Approved with two rulings: **shapes win, lair odds free** (no
2/4-step guarantee) and **the entry rite has NO spore blessing/curse** —
flavor text only. User provides battle art PNGs for the new wilds.

## The five dungeons

| biome | dungeon | shape | hazard | wild | treasure |
|---|---|---|---|---|---|
| city | **The Broodwarrens** | figure-8 warren (7 nodes, two fused loops) | *Webbing* — your next roll is halved (rounded up) | Broodling | Egg Cache |
| cavern | **Gloomroot Hollow** | inward spiral that loops back (6 nodes) | *Spore Cloud* — teleport to a random node in this pocket | Glowmite | Crystal Hoard |
| bog | **The Drownedway** | flooded ring + island chord (7 nodes) | *Sinkwater* — lose 15% of carried Spores | Mire Leech | Sunken Chest |
| bone | **The Marrow Pits** | 2×3 crypt grid, outer ring + one rung (6 nodes) | *Bone Chill* — −2 ATK in your next battle | Gravewight | Reliquary |
| garden | **The Rotcellar** | branching root: main loop + side loop (7 nodes) | *Rot Bloom* — lose 3 HP, gain 4 Spores | Rot Grub | Seed Vault |

Constraints on every shape: all nodes degree ≥ 2 (exact-count movement never
strands), single connected component per pocket (layer partition unchanged),
`<biome>_lb` remains the only door, `<biome>_lair` id survives (SIGIL_LAIRS
and existing poiClaims keep working). New node ids extend the `_d` series
(`city_d4`…); the treasure node id is `<biome>_cache`.

## Backend (`undercity_data.py`, `undercity_engine.py`, `undercity_db.py`)

- **Layout:** `_build_map` replaces the shared 6-hex pocket builder with five
  hand-laid pocket layouts (planar — no crossing edges), positioned at the
  same pocket centers as today.
- **`cache` space type (new):** first visit per player pays a mid-size
  treasure (Spores + renown, ~half a vault), tracked in `poiClaims` as
  `cache:<nodeId>`; repeat visits pay nothing ("Already plundered."). One per
  dungeon, placed past the lair so it rewards the full loop.
- **Signature hazards:** `depths` hazard spaces resolve by their dungeon's
  signature instead of the generic hazard. Data: `DUNGEON_HAZARDS[biome] ->
  {id, name, text, effect}`. Effects map onto engine state:
  - `webbing`: set `halveNextRoll` on the player doc; `_roll` consumes it.
  - `spore_cloud`: server picks a uniform random node in the same pocket,
    moves the player, resolves nothing further (no chain events).
  - `sinkwater`: `spores -= ceil(spores * 0.15)`.
  - `bone_chill`: set `atkDebuff = 2`; next `resolve_battle` consumes it.
  - `rot_bloom`: `hp -= 3` (compost-safe: min 1 — a garden never kills),
    `spores += 4`.
  Mirefoot ("hazards cost half") halves the numeric costs (spores/HP) and
  halves nothing about webbing/spore-cloud/bone-chill.
- **Dungeon wilds:** `DUNGEON_NPCS[biome]` — one themed NPC per dungeon,
  stats ~15% above the surface NPC of the same level band, +25% bounty.
  `wild` spaces whose node region is `depths` draw from the dungeon's own
  table. Ids: `broodling`, `glowmite`, `mire_leech`, `gravewight`,
  `rot_grub`.
- **State:** `GET /game/state` needs nothing new (poiClaims already
  surfaces; `halveNextRoll`/`atkDebuff` are internal).

## Client

- **Battle art (user-provided):** `public/undercity/enemies/broodling.png`,
  `glowmite.png`, `mire_leech.png`, `gravewight.png`, `rot_grub.png` — same
  framing as existing enemy PNGs. Until a file exists the battle card falls
  back to the NPC icon (`NPC_ICONS` gains the five ids).
- **Per-dungeon themes (`board-terrain.ts`):** theme selection for `depths`
  nodes keys off the pocket's biome prefix, not the shared `depths` theme.
  Five palettes + decoration sets: Broodwarrens (egg clusters, webbing
  strands, chitin), Gloomroot (giant fungi, brighter teal glow), Drownedway
  (water-floor pools, drowned reeds), Marrow Pits (bone-stack pillars, grave
  walls), Rotcellar (compost heaps, hanging roots). Pocket label = dungeon
  name; floor painting per dungeon reuses the parent biome's background art.
- **Lair set-pieces:** five bespoke procedural landmarks (egg-throne,
  crystal dais, whirlpool maw, bone throne, compost altar), each ~1.5× a
  normal landmark with its boss-colored glow spot.
- **Light in the dark (client-only):** inside a dungeon, an unexplored
  gloom veil covers the pocket; a light radius (~2 nodes) follows your
  token, and nodes you've stood on stay lit. Explored sets persist per
  player+season in localStorage. Overworld unaffected. Other players' tokens
  only render inside your lit area.
- **Sigil trophies (client-only):** when YOUR poiClaims holds the dungeon's
  sigil, that pocket renders "cleared": webs/gloom accents removed, a small
  banner at the lair, glow spots shift from menacing to friendly. Terrain
  rebuild keyed on own-sigil set.
- **Entry rite (client-only):** first descent into each dungeon per session
  shows a one-line flavor card ("The Broodwarrens. The walls pulse.") — text
  only, auto-dismisses. NO mechanical effect.
- **Ambience:** `BoardAmbient` gains per-layer particle sets: drifting
  eggsac motes, glow spores, marsh bubbles, bone dust, rot flies. Active
  layer picks its set; overworld keeps spores + bats.

## Testing

Backend: extend `tests/test_map.py` (new distribution counts, planarity =
degree ≥ 2 everywhere, one cache per pocket, lair ids unchanged) and engine
tests for each hazard effect, cache first/repeat, dungeon-wild selection,
Mirefoot halving. FakeTable integration suite stays green.
Client: no runner — `npm run lint` + tsc + visual pass per dungeon.

## Out of scope (v6)

- Entry-rite blessings/curses (explicitly cut).
- New overworld content; boss changes; per-dungeon music.
