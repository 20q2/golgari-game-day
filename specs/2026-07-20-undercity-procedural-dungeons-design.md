# Undercity — Procedural Dungeons (per-night, per-biome)

**Date:** 2026-07-20
**Status:** Design approved, pending implementation plan

## Problem

Every night (season) the five biome dungeons are the same hand-authored mazes.
Once you've walked the Broodwarrens, you've walked it forever. We want each new
night to regenerate a **fresh dungeon per biome**, so descending is a discovery
again — while each dungeon keeps its identity (theme, boss, hazard).

## Goals & scope

- **Depths-only.** Only the five dungeon pockets regenerate. The surface board
  (biome rings, tunnels, warps, island, barriers, vault) stays fixed and remains
  sourced from the committed `map.json`.
- **Server generates and serves the whole graph.** One generator (Python). The
  client fetches the season's map and just renders it — no client-side generation,
  no twin RNG to keep in sync.
- **Keep identity, randomize layout + content.** Each biome keeps its theme,
  signature hazard, themed wild, and lair boss (its sigil identity). The maze
  topology, size, room placement, and node-type spread randomize each night.
- **Grid-based generation.** Mazes are carved on a grid, which guarantees
  planarity (no strangely overlapping corridors) and gives clean render
  coordinates for free.

Non-goals: regenerating the surface; shuffling which boss lives in which biome;
client-side or seed-rebuilt generation; changing combat/economy balance.

## Key architectural enabler

The combat/movement **engine is already parameterized on the map** —
`undercity_engine.py` has zero references to the `MAP_NODES` global; callers pass
`data.MAP_NODES` in (e.g. `engine.legal_destinations(data.MAP_NODES, …)`). So
making the map per-season is confined to:

- `undercity_db.py` — ~31 `data.MAP_NODES` reads (the request/rules layer).
- `undercity_data.py` — ~9 helper references.
- one client fetch — `undercity-page.component.ts` (`GET data/undercity-map.json`).

The admin panel and map editor keep reading the static `map.json` (surface +
template depths); they are dev/host tools, not the live game view.

### Naming contract (load-bearing)

The depths-derived name maps already key off **biome naming**, not off live map
nodes:
- `SIGIL_LAIRS = {b + '_lair': b for b in BIOMES}`
- `ESCAPE_LADDERS = {b + '_esc': b + '_lair' for b in BIOMES}`
- `dungeon_entrance(biome)` returns `<biome>_lb`.

Therefore the generator **must** emit these canonical ids per biome: exactly one
`<biome>_lb` (mouth), one `<biome>_lair`, one `<biome>_esc` (escape spur off the
lair), one `<biome>_cache`, one trove, one rest. All other depths nodes use
`<biome>_<suffix>` ids unique within the pocket. Honoring this contract keeps the
name maps, the escape-ladder feature, and respawn logic valid with no changes.

## Components

### 1. Generator — `infrastructure/lambda/undercity_mapgen.py` (new, pure)

Pure functions, no boto3, deterministic from a seed.

```
generate_depths(seed: int, biome: str) -> list[node dict]
generate_all_depths(season_id: str) -> dict[biome -> list[node]]
```

- **Seed:** derived from `(season_id, biome)` so a night is reproducible and each
  biome differs. Uses a local `random.Random(seed)` — never the module global.
- **Primitive:** carve a maze on a small integer grid (cells → nodes, walls
  removed → edges). Grid guarantees planarity and supplies coordinates
  (`cell → world x/y` mapped into the pocket's local frame; pockets render in
  their own sub-view, so absolute placement only needs to be self-consistent and
  non-overlapping).
- **Per-biome identity (fixed, from existing tables):** theme name (`DUNGEONS`),
  themed wild (`DUNGEON_NPCS`), signature hazard (`DUNGEON_HAZARDS`), lair boss
  (`LAIR_BOSSES`/`SIGIL_LAIRS`). Each biome also carries a **shape bias** so its
  character survives: cavern = radial hub, bog = long corridor, city = serpentine,
  bone = lattice, garden = tangle. Bias = grid dimensions + carving rule.
- **Content (randomized):** grid size within a band; corridor topology; placement
  of the lair (deep, ≥6 hops from the mouth) and of the hidden trove/rest/escape
  rooms on dead-end tips; a weighted node-type spread (wild/hazard/loot/elite)
  over the remaining cells.
- **Contract enforcement:** after carving, validate the invariants below and
  **repair or re-roll** (bounded retries) until they hold, so a night can never
  ship a broken dungeon.

**Invariants every generated pocket must satisfy** (mirrors the existing
`tests/test_deep_dungeons.py` expectations):
- ≥ 24 depths nodes.
- exactly one each of: mouth `<biome>_lb`, `<biome>_lair`, trove, rest,
  `<biome>_cache`, escape spur `<biome>_esc`.
- lair is ≥ 6 hops (shortest path) from the mouth.
- trove and rest are dead-ends (degree 1); escape spur neighbors only the lair.
- every node reachable from the mouth; all edges symmetric.
- node types drawn only from the depths palette.

### 2. Season map assembly — `undercity_data.py` + `undercity_db.py`

- `undercity_data.py` continues to load `map.json`, and additionally exposes
  `SURFACE_NODES` = every node whose region is not a depths pocket. The committed
  depths nodes remain as a **fallback template** (see the config flag).
- The season-map builder lives in `undercity_db.py` because it reads DynamoDB
  (the `MAP` record); `undercity_data.py` stays pure (balance/graph only, no
  boto3) and just contributes `SURFACE_NODES` and a pure surface+depths merge
  helper. `season_map(table, sid) -> dict[node_id -> node]` = `SURFACE_NODES`
  merged with the season's stored depths, **cached per `sid`** (module dict) so
  it is built once per warm Lambda per season, not per request.
- `undercity_db.py` swaps its ~31 `data.MAP_NODES` reads for the season handle
  obtained once at the top of the request (the season id is already known there).
- `undercity_data.py` helpers that inspect depths (`dungeon_biome`) become
  name-based where they currently rely on the global, so they work for generated
  nodes without a live-map lookup.

### 3. Persistence & delivery

- **Storage:** `_season_start` calls `generate_all_depths(sid)` and writes all
  five biomes' depths to a **single** season-scoped record (`pk = SEASON#<sid>`,
  `sk = MAP`). A ~30-node maze is a few KB; five together are well under
  DynamoDB's 400 KB item limit, and one item keeps the read simple.
- **Delivery:** new route `GET /game/map` returns `{ nodes: surface + season
  depths, regions, … }` in the same `BoardMap` shape the client already consumes.
  `undercity-page.component.ts` fetches this instead of the static asset. The map
  is immutable for the night, so the client fetches it once per session.

### 4. Config flag (safe rollout)

`undercity_config.py` gets `PROCEDURAL_DUNGEONS` (bool). When **off**, `season_map`
falls back to the committed depths in `map.json` — behavior identical to today.
This lets the de-globalization land first with zero behavior change, and lets us
disable generation instantly if a bad night ever escapes the invariants.

## Data flow (a night)

1. Host runs `season-start` → new `sid`; `generate_all_depths(sid)` → depths
   graph → stored at `SEASON#<sid> / MAP`.
2. Player opens the game → `GET /game/map` → surface + this night's depths →
   client renders.
3. Every action → db loads `season_map(table, sid)` (cached), passes `nodes` to
   the engine exactly as today.
4. Next night → new `sid` → new depths; old season (and its node ids) archived.

## Error handling

- Generator retries on invariant failure; if it cannot satisfy the contract after
  a bounded number of attempts (should never happen), it falls back to the
  committed template depths for that biome and logs an event — a night always
  boots with a playable dungeon.
- `GET /game/map` for a season with no stored `MAP` record (legacy/mid-migration)
  falls back to the committed depths, so old seasons still render.
- Cache is keyed by `sid`; a season change naturally invalidates it.

## Testing

- **Generator property tests** (new): run `generate_depths` over many seeds ×
  every biome and assert *every* invariant above holds *every* time — the primary
  guard against a broken night. Assert determinism (same seed → identical graph)
  and diversity (different seeds → different graphs).
- **Golden → invariant conversion:** `test_map.py`'s exact depths counts and
  `test_map_file.py`'s node-count assertion become surface-only counts plus
  "depths validated by the generator suite." Surface invariants (gates, tunnels,
  warps, reachability of the surface) stay exact.
- **`test_deep_dungeons.py`** already asserts per-biome structural invariants; it
  is repointed at a freshly generated pocket instead of the committed one.
- **Regression safety:** Phase A (flag off) must leave the entire existing suite
  green with no assertion changes.

## Implementation phasing

- **Phase A — de-globalize, generation OFF.** Introduce `SURFACE_NODES`,
  `season_map`, the `PROCEDURAL_DUNGEONS` flag (default off), the `MAP` record
  path (serving committed depths), and `GET /game/map`; switch the client fetch.
  All existing tests stay green; no visible change.
- **Phase B — the generator, standalone.** Build `undercity_mapgen.py` + its
  property tests. Not wired into the game yet.
- **Phase C — flip it on.** `season-start` generates and stores; default the flag
  on; convert the golden map tests to invariants; repoint `test_deep_dungeons.py`
  at generated pockets.

Each phase produces working, tested software on its own and gets its own
implementation plan.

## Risks

- **De-globalization breadth.** ~31 db reads — mechanical but wide; Phase A
  isolates it behind the flag so it lands without behavior change.
- **Grid layout aesthetics.** Grid mazes can look boxy; per-biome shape bias +
  coordinate jitter keep them from all looking identical.
- **Item size / cost.** Storing five mazes per season is a few KB; negligible for
  the free-tier single-table budget.
