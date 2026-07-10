# Undercity Map Editor — Design

**Date:** 2026-07-10 · **Status:** approved (design walkthrough in session)

## Goal

A WYSIWYG editor so the host can move, add, remove, and connect board nodes,
build dungeon layouts, and place decals/backgrounds/sprite art — producing a
nice-looking board without developer help. The map becomes a hand-editable
data file that either the user or Claude can update.

## Decisions (from brainstorming)

1. **Map source of truth moves to a file.** `_build_map()`'s parametric ring
   math runs one last time as a seed, then retires to a reference script.
2. **Decals = both stamps and images.** Instances of the existing code-drawn
   set-pieces AND arbitrary PNGs from `public/undercity/`, each with position,
   scale, rotation, and layer. The procedural ambient scatter stays as a base
   layer, toggleable per region.
3. **"Sprite placement" = static art decals.** No critter/patrol/particle
   systems (deferred).
4. **Architecture: dev-only Angular route + one JSON schema** (approach 1).
   Editor renders with the real game engine; File System Access API saves
   in place; download fallback.

## Data model

`map.json` v2 — one schema, two synced copies:

- **Source of truth:** `infrastructure/lambda/map.json` (bundled with Lambda).
- **Client copy:** `public/data/undercity-map.json`, byte-identical.
- A pytest asserts the copies match (drift fails the suite). A small
  `sync_map.py` (successor of `generate_map_json.py`) copies source → client
  for hand-edit workflows; the editor writes both itself.

```jsonc
{
  "worldW": 3600, "worldH": 2400,
  "gate": "cavern_r0", "boss": "boss",
  "nodes":   [ { "id": "cavern_r0", "type": "gate", "x": 1162, "y": 704,
                 "region": "cavern", "neighbors": ["cavern_r1", "cavern_r9"] } ],
  "regions": { "cavern": { "label": "Mosslight Cavern",
                           "background": "cavern_background.png",
                           "scatter": true, "dark": false } },
  "decals":  [ { "kind": "stamp", "stamp": "mushroom", "x": 900, "y": 512,
                 "scale": 1.2, "rot": 0, "layer": "under", "seed": 7 },
               { "kind": "image", "src": "undercity/enemies/rot_grub.png",
                 "x": 2400, "y": 900, "scale": 1, "rot": 0, "layer": "under" } ]
}
```

- `nodes` keeps today's exact shape → `undercity_data.MAP_NODES` loads it
  unchanged; engine/db/tests untouched.
- Server ignores `regions`/`decals`.
- `layer`: `"under"` (behind tokens) or `"over"` (in front).
- `seed` lets a stamp keep its randomized details stable between renders.

### Python side

- `undercity_data.py`: replace the procedural build with
  `json.load(<module dir>/map.json)`; expose `MAP_NODES`, `WORLD_W/H`,
  `GATE_NODE`, `BOSS_NODE` exactly as before.
- The old `_build_map()` + geometry helpers move to
  `infrastructure/lambda/map_bootstrap.py` (not imported by the Lambda),
  runnable to regenerate a fresh procedural board if ever wanted.

## Editor (`/undercity/map-editor`)

Dev-gated standalone component (same pattern as `/undercity/color-test`).
Renders with the real `BoardCanvas` + `board-terrain` so the editor is
pixel-identical to the game.

**Toolbar modes**

- **Select/Move** — click to select node/decal; drag moves it (edges follow).
- **Add node** — click empty space; properties panel sets id/type/region.
- **Connect** — click two nodes to toggle the edge between them.
- **Decals** — palette of stamp set-pieces (mushroom, crystal, pillar, ruin
  block, skull pile, pool, reeds, bog tree, bone mound, …) + image palette
  enumerated from `public/undercity/` via the directory handle; click to
  place, handles for scale/rotate, layer toggle.
- **Region tool** — select nodes → assign region id (new or existing); region
  entry edits label, background image, `dark`, `scatter`. This is how dungeon
  pockets are authored.

**Interactions:** Delete removes selection (with neighbor cleanup), full
undo/redo stack, zoom/pan matching the game board, Ctrl+S saves.

**Save flow:** user picks the repo root once (File System Access API,
Chromium); editor writes `infrastructure/lambda/map.json` and
`public/data/undercity-map.json`. Fallback: download the JSON for manual
placement. Save is blocked while validation fails.

## Game-side rendering changes

- Region backgrounds come from `regions{}` (replacing the hardcoded
  `REGION_BACKGROUNDS` in `board-canvas.ts`).
- New decal pass in terrain rendering: `under` decals after terrain,
  `over` decals after tokens.
- Set-piece draw functions refactored into a named registry
  (`stamp name → draw(ctx, x, y, scale, rot, seed)`) shared by game
  and editor.
- Per-region `scatter` flag gates the procedural ambient decoration.
- Every new key falls back to current behavior — an unedited v2 file renders
  the board exactly as today.

## Validation (editor lint panel; blocks save)

- Neighbor symmetry; all nodes reachable from the gate.
- Unique node ids; exactly one `gate` and one `boss`.
- Barrier pairs and ladder pairs intact.
- Every node's `region` exists in `regions{}`; coordinates within world bounds.

## Testing

- Existing `test_map.py` invariants now validate the loaded JSON.
- New tests: copies-match (lambda vs public), loader shape (MAP_NODES ==
  previous procedural output on the seeded file).
- Frontend: `npm run build` green; editor route dev-only.

## Out of scope

Animated critters, particle editing, live-session editing, multi-user
editing, balance-table editing.
