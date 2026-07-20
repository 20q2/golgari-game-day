# Undercity — Wilderness Expansion

**Date:** 2026-07-20
**Status:** Approved, ready for planning
**Builds on:** [2026-07-20-undercity-tunnels-wilderness-design.md](2026-07-20-undercity-tunnels-wilderness-design.md)

## Summary

Turn the Wilderness from a bare 14-node connective hub into a distinct, dangerous
central region:

- Its own **visual identity** — "ashen bramble wastes": charcoal-grey terrain with
  ember-orange accents, no longer falling back to the cavern look.
- A **walkable route to the floating isle** — a long causeway from the Wilderness
  to `isl_warp` (previously warp-in only), open to all but a real journey.
- Grown to **~32 nodes** in a bigger world, **filled with T2+ enemies** — a new
  dedicated wilderness monster pool used by every wild *and* elite space there.

## Motivation

The Wilderness is the evolved-unit travel layer (tunnels are Tier-1 only). It
should feel like the tougher frontier evolved units are forced into: a
higher-stakes gauntlet with its own look, real rewards, and a coveted overland
path to the boss island — not a plain corridor.

## Current-state facts (verified)

- Enemy pools in `undercity_data.py`: `NPCS` (wild), `ELITE_NPCS` (elite),
  `DUNGEON_NPCS` (per-biome dungeon). `undercity_db._wild_battle(table, sid, doc,
  elite=False)` picks `ELITE_NPCS if elite else NPCS` — it does not know the
  landing node/region. `_resolve_space` computes `region` and calls
  `_wild_battle` for `wild`/`elite` types.
- The isle is warp-in only: `isl_warp` (type `warp`) neighbors only `isl_trade`;
  chain is `isl_warp → isl_trade → isl_ossuary → boss`. World is 3600×2400.
- Client region visuals: `REGION_THEMES` in `engine/board-terrain.ts` (keyed by
  region, falls back to `cavern`), region floor paintings, and `board-ambient`
  contexts. `map.json` `regions{}` holds `{label, background, scatter, dark}` per
  region. Available backgrounds: arena/cavern/gate/palace/plaza/pub/swamp/
  undercity `*_background.png` (no wilderness-specific art yet).
- Map source of truth is `infrastructure/lambda/map.json`, mirrored to
  `public/data/undercity-map.json` via `sync_map.py` (a pytest fails while they
  diverge). Current node count is 239 (post tunnels+wilderness).
- Movement engine `legal_destinations`/`board_distance` accept a `blocked` set;
  tunnels are blocked for tier > `TUNNEL_TIER_MAX` (=1).

## Design

### 1. Map expansion & layout

- Enlarge the world to **~4200×2800** so the center has room; **do not move**
  existing biome nodes (their terrain set-pieces are positioned).
- Grow the Wilderness from 14 → **~32 nodes**: a larger core cluster plus longer,
  branchier spokes, filling the inter-biome central gaps (left-center between
  cavern/bone, right-center between bog/garden, and the band below the isle) so it
  wraps around the floating isle.
- Coordinates are authored programmatically as a valid first pass, guarded by the
  symmetry / connectivity / no-overlap tests, then fine-tuned in
  `/undercity/map-editor` (which writes both map copies).

### 2. Isle causeway

- A **~6-node causeway** from the Wilderness core to `isl_warp`, adding exactly
  one new edge: `isl_warp ↔ <causeway_end>` (plus the reverse link).
- **Open to all** (no tier gate). It is long and lined with T2+ enemies, so a
  Tier-1 wandering toward the boss island is punished rather than forbidden. The
  warp network stays intact.
- Reachability from `isl_warp` changes, so `test_dead_end_paths_die_out` is
  updated to the new graph.

### 3. T2+ enemy pool

- Add two pools to `undercity_data.py`:
  - `WILDERNESS_NPCS` — 3-4 named wild monsters, ~hp 45-60 / atk 13-16.
  - `WILDERNESS_ELITE_NPCS` — 2-3 named elites, ~hp 55-70 / atk 15-18.
  - Bounty and XP scale above `ELITE_NPCS` (e.g. bounty 30-45, xp 35-50). Each
    uses an existing `personality` from `STANCE_PERSONALITIES` and a `bluff`
    value, matching the shape of the existing NPC dicts.
- `_wild_battle` gains a `region=None` parameter. When `region == 'wilderness'`,
  it draws from `WILDERNESS_ELITE_NPCS` (for `elite`) or `WILDERNESS_NPCS` (for
  `wild`) — so **both** space types there spawn T2+ monsters. `_resolve_space`
  passes the landing node's region. All other regions are unchanged.

### 4. Content mix (~32 nodes)

Heavy on **wild + elite** (the T2+ gauntlet), with scattered **hazard**, a few
**loot/cache** payouts, and the **causeway** nodes (which are themselves
wild/elite/hazard — the journey has teeth). No new space *types* are introduced;
the danger comes from placement plus the region-based pool swap.

### 5. Client theming — ashen bramble wastes

- Add a `wilderness` entry to `REGION_THEMES` (board-terrain.ts): charcoal-grey
  base terrain with ember-orange accents, visually distinct from the five biomes.
- Update `map.json` `regions.wilderness` to `{label: 'The Ashen Wilds',
  background: <reused placeholder art>, scatter: true, dark: false}`.
- Wire the region floor painting and `board-ambient` context so the Wilderness no
  longer renders with the cavern fallback. Art is a reused placeholder to be
  re-arted later (matching the project's placeholder-art convention).

### 6. Balance location

Enemy stat blocks live in `undercity_data.py` (weighted/structured tables). No
new scalar config knobs are required. No client NPC mirror exists (the client
renders monsters from the battle-start payload), so no display mirror to update.

## Testing

- **Map integrity:** node count updated (239 → ~257); type distribution updated;
  `map.json` and `public/data/undercity-map.json` stay in sync; neighbor symmetry
  holds; map-editor lint reachability passes.
- **Isle journey:** `board_distance` from a Wilderness core node (and from a
  biome, tunnels blocked) to `isl_warp` is not None and is a real journey (assert
  a minimum hop count, e.g. ≥ 5).
- **No-trap invariant:** evolved units can still reach every biome via the
  Wilderness (existing test still passes with the larger graph).
- **T2+ pools:** `WILDERNESS_NPCS` / `WILDERNESS_ELITE_NPCS` are non-empty and
  tougher than `ELITE_NPCS`; a `_wild_battle` on a wilderness `wild` node and on a
  wilderness `elite` node both return a monster from the wilderness pools, while a
  non-wilderness node still uses `NPCS`/`ELITE_NPCS`.
- **Dead-end update:** `test_dead_end_paths_die_out` reflects the new `isl_warp`
  neighbor.

## Out of scope

- Bespoke Wilderness background art (placeholder reused for now).
- Procedural / per-season map variation (layout remains hand-authored).
- Tier-gating the causeway or the Wilderness (both stay open to all).
- Changes to the boss finale, depths, tunnels, or PvP.
