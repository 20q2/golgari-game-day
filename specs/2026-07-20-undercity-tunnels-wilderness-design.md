# Undercity: Tunnels & the Wilderness — Design

**Date:** 2026-07-20
**Status:** Approved, ready for planning

## Summary

Two coupled additions to the Undercity board that split surface travel into two
tier-dependent layers:

- **Tunnels** — the five existing biome-boundary spur pairs become a dedicated
  `tunnel` space type that **only Tier-1 (un-evolved) units may enter**. They are
  short, safe shortcuts between adjacent biomes, giving weak units cheap mobility.
- **The Wilderness** — a new central-hub region that reconnects all five biomes
  for evolved (Tier-2+) units, who are locked out of the tunnels. It is a longer,
  tougher, contested crossroads. It is **open to all** but only evolved units are
  *forced* to use it.

The two ship together: gating tunnels without the Wilderness would strand evolved
units in their home biome (the five surface biomes are connected *only* by tunnels;
each biome's depths is a dead-end loop back to itself).

## Motivation

- Give un-evolved units an mobility advantage — they can dart around the world
  freely while evolved units are slowed down, encouraging early-game exploration
  and giving a reason not to rush evolution.
- Give evolved units a distinct, higher-stakes travel layer (the Wilderness) that
  doubles as a contested endgame crossroads.

## Current-state facts (verified)

- The 5 surface biomes (cavern, bog, garden, city, bone) form a ring connected
  **only** by tunnel spur pairs. All other cross-region edges go down to the
  depths.
- The depths are **5 separate dead-end loops** — each drops from one biome and
  loops back up to the *same* biome. They do **not** interconnect biomes.
- The 10 existing `t_*` nodes are all **degree-2 spurs**: each has exactly one
  biome-side neighbor plus its paired tunnel node across the boundary. Pairs:
  `t_cavern_bog{0,1}`, `t_bog_garden{0,1}`, `t_garden_city{0,1}`,
  `t_city_bone{0,1}`, `t_bone_cavern{0,1}`. Current types are a mix of
  loot/hazard/elite/mystery/wild.
- Player tier is stored on the player doc as `tier` (1/2/3), set on join (`1`)
  and bumped in `_evolve`.
- Movement is computed by `engine.legal_destinations(nodes, start, steps, closed)`
  (Dokapon exact-count, no immediate backtrack). Call sites in `undercity_db.py`:
  the dice roll `_roll` (~L1392) and bot movement (~L1095). `board_distance` is
  used for spell range/targeting checks (~L2657/2696/2759).
- Space landing effects dispatch by `ntype` in `_resolve_space` (`undercity_db.py`).
- Client node rendering: `TYPE_COLORS` / `TYPE_SIDE_COLORS` / `SPACE_ICONS` and a
  `LOCKED_COLOR` grey path in `src/app/undercity/engine/board-space.ts`.
- Map source of truth: `infrastructure/lambda/map.json`; client mirror
  `public/data/undercity-map.json`. Editable via `/undercity/map-editor` (writes
  both) or by hand + `python infrastructure/lambda/sync_map.py`. A pytest fails
  while the copies differ. Map-editor lint (`map-lint.ts`) checks whole-graph
  reachability from the gate (tier-agnostic).

## Design

### 1. Tunnels

- Introduce node type **`tunnel`**. Convert the 10 existing `t_*` nodes to it
  (edit `map.json` + sync the client mirror). Neighbors are unchanged.
- **Landing event:** none — safe passage. `_resolve_space` returns a benign
  flavor event (e.g. `{type: 'tunnel', text: 'You slip through the tunnel.'}`)
  with no state mutation.
- **Gating:** a unit with `tier > 1` **cannot enter a tunnel node** — it is
  excluded both as a destination and as a pass-through step. Because tunnels are
  degree-2 spurs, "can't land" ⇒ "can't cross", and removing them for T2+ never
  disconnects a biome internally. Tier-1 units are unaffected.

> **Update (2026-07-23) — crossing is now a bonk-stop that keeps walking.**
> Superseding the "Tier-1 passes through freely" rule above (and folding in the
> later toll design), a bridge mouth is now a **walk-stop for every tier**
> (`_stop_nodes` always includes `TUNNEL_NODES`): a mover halts on the mouth and
> is carried across on landing — nobody corridors through. Landing charges the
> tier toll (T1 free, T2 pays, T3 barred by `_blocked_nodes`), relocates to the
> far biome node consequence-free, **and banks any leftover roll as a fresh
> `pendingMove` from the far side** (like a ladder crossing, see `_move`). So a
> crossing costs no steps and no longer ends the move — the client tollkeeper's
> "cross" button carries you over and the walk resumes on the other side.

### 2. Movement engine

- Add a `blocked: frozenset = frozenset()` parameter to `legal_destinations` and
  `board_distance` in `undercity_engine.py`. Semantics: a node in `blocked` is
  **never stepped onto** (skipped in the neighbor loop) — strictly impassable and
  never a result. This differs from the existing `closed`/barrier semantics
  (march-up-and-stop / bonk). The start node is never treated as blocked, so a
  unit standing on a tunnel can always walk **off** it — only *entering* is
  forbidden.
- Callers compute the blocked set from tier and pass it at every player-movement
  site:
  ```python
  blocked = data.TUNNEL_NODES if doc.get('tier', 1) > 1 else frozenset()
  ```
  Apply in `_roll`, bot movement, and any player-controlled teleport that places
  the unit on a chosen node (a T2+ cannot teleport onto a tunnel). Admin teleport
  bypasses the gate.

### 3. The Wilderness

- New region **`wilderness`**: a central crossroads cluster (~4 nodes) woven
  around the isle/ruin center, with a short spoke (~2 nodes) into each of the 5
  biomes. Total ~**12–16 new nodes**. Each spoke attaches to one inner-edge node
  of its biome. Biome→biome via the Wilderness is ~**6–8 hops** (vs. 2 by tunnel);
  all traffic funnels through the shared middle.
- **Open to all** (no tier gate). It is simply the only inter-biome route left for
  evolved units; Tier-1s may pass through but have no reason to.
- **Content — tough & rewarding:** populate spokes/cluster with existing space
  types (elite, hazard, loot, cache, wild) tuned for evolved units. Wilderness
  elites draw from the tougher `ELITE_NPCS` pool.
- **Not a home biome:** do **not** add `wilderness` to `data.BIOMES` — no gate, no
  home-biome perk, no respawn point. Dying in the Wilderness respawns the unit at
  its last home-biome gate via the existing `lastBiome` logic (which only records
  regions present in `BIOMES`).
- **No-trap invariant:** with tunnels blocked, every biome must remain reachable
  from every other biome through the Wilderness.
- **Authoring:** build in `/undercity/map-editor` (writes both map copies) around
  the isle/ruin center, avoiding decal overlap; then run `sync_map.py` and the
  test suite. Add region fill/decals + color for the new region.

### 4. Client rendering

- Add `tunnel` to `TYPE_COLORS`, `TYPE_SIDE_COLORS`, and `SPACE_ICONS`
  (`board-space.ts`) with a distinct color + icon.
- When the local player is **Tier-2+, render tunnel nodes locked/greyed** (reuse
  the existing `LOCKED_COLOR` path) with a no-entry icon, so evolved players can
  see why they can't route through them.
- Draw the Wilderness region fill/decals + color (`colors.ts` / `board-terrain` /
  `board-layers`) and a region label.
- Space modal / board tab: tunnel description ("Tunnel — Tier-1 units only") and
  Wilderness flavor text.
- Add `tunnel` to any client node-type list (`undercity-models.ts`) and to the
  map-editor lint's valid types.

### 5. Config / data

- `undercity_config.py`: `TUNNEL_TIER_MAX = 1` (tiers ≤ this may enter tunnels).
- `undercity_data.py`: `TUNNEL_NODES` — a frozenset derived once from `MAP_NODES`
  (ids where `type == 'tunnel'`). Wilderness constants as needed.

## Testing

- **Engine:** Tier-1 `legal_destinations` can cross a tunnel; Tier-2+ cannot land
  on or route through a tunnel; a Tier-2+ standing on a tunnel can still leave;
  `blocked` semantics verified in both `legal_destinations` and `board_distance`.
- **No-trap invariant:** for a Tier-2+ (tunnels blocked), a connectivity test
  confirms every biome is reachable from every other biome via the Wilderness.
- **Landing:** `_resolve_space` on a `tunnel` node produces no mechanical effect.
- **Map integrity:** `map.json` and `public/data/undercity-map.json` stay in sync;
  neighbor symmetry holds; map-editor lint reachability passes.

## Out of scope

- Procedural / per-season map variation (the layout remains hand-authored).
- Additional tunnels beyond the existing five boundaries.
- Any change to the depths, boss finale, or PvP.
