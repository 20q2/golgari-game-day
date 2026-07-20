# Undercity — Boss/Lair Approach Loops

**Date:** 2026-07-20
**Status:** Approved

## Problem

Every dungeon lair and the island boss is a graph **dead-end** (a single
neighbor). Movement is Dokapon-style *exact-count*
(`undercity_engine.legal_destinations`): you must spend the whole roll to land,
and "dead-end branches shorter than the roll simply contribute nothing." So the
only way onto a lair is to roll its exact distance, and there is no way to
circle for a second chance — if you overshoot, you cannot reach it that turn.
Combined with the dark (`dark: true`) depths fog-of-war, players also cannot see
where the lair is until they are one hop away.

Two lairs already sit on loops and are fine: `bone_lair` (degree 2, on the bone
lattice) and `lair_titan` (ruin, on the `bar_e` ring). The dead-ends to fix are
the four biome lairs `cavern_lair`, `bog_lair`, `city_lair`, `garden_lair`, and
the island `boss`.

## Change

For each of the 5 targets, add **two "guardian" nodes** (`wild`) that ring the
target while **keeping the existing corridor→target edge**:

```
        R1
       /  \
corridor ---- target      edges added: corridor–R1, R1–target,
       \  /                             corridor–R2, R2–target
        R2                 edge kept:    corridor–target
```

Result: the target becomes **degree 3** and sits inside two **girth-3
triangles** (odd cycles). Consequences under exact-count movement:

- From the corridor node the target is reachable at distance **1** (direct) *or*
  **2** (via R1/R2) — both roll parities can land, not a single exact number.
- A player can **circle back onto the target** in 3–4 steps
  (`target→R1→corridor→R2→target`), so overshooting no longer wastes the turn.
- The direct edge is preserved, so shortest-path distances are unchanged and the
  `lair ≥ 6 hops from entrance` deep-dungeon invariant still holds.

### Node type

All 10 guardian nodes are type `wild`. In the four depths rings this pulls the
biome's dungeon fauna (`DUNGEON_NPCS`); the isle ring falls back to the default
overworld pool (`data.NPCS`) via `_wild_battle`. A `wild` fight on the guardian
naturally discourages farming the loop, and a player aiming for the lair still
lands on it directly via the retained edge. No new space type, no engine change,
no client-rendering change — `wild` already renders and resolves.

### Node IDs, regions, coordinates

IDs keep the biome prefix the tests split on (`n.split('_')[0]`):

| Target        | Region  | Corridor    | Guardians              |
|---------------|---------|-------------|------------------------|
| `cavern_lair` | depths  | `cavern_s6` | `cavern_lg1`,`cavern_lg2` |
| `bog_lair`    | depths  | `bog_m21`   | `bog_lg1`,`bog_lg2`    |
| `city_lair`   | depths  | `city_d13`  | `city_lg1`,`city_lg2`  |
| `garden_lair` | depths  | `garden_m11`| `garden_lg1`,`garden_lg2` |
| `boss`        | isle    | `isl_ossuary` | `isl_bg1`,`isl_bg2`  |

Guardians are placed flanking the corridor→target segment (offset to either
side). Exact coordinates are display-only; depths pockets are exempt from the
planarity guard and the isle is not subject to it.

## Lighting

Fog-of-war is left unchanged (per decision). Small side benefit: the two
guardians flanking each lair are revealed by the normal 1-hop light as you
approach, so the lair becomes visible one step sooner than before.

## Finale safety

The island boss seal (`_boss`, `undercity_db.py`) gates on **sigil count at
landing**, not on edges; a rejected player is bounced to `prev` if it is a boss
neighbor else `isl_ossuary`. Both R1/R2 are valid neighbors, so the ring is safe
for the sealed-boss finale.

## Files & tests

- `infrastructure/lambda/map.json` — add 10 nodes (source of truth).
- `python infrastructure/lambda/sync_map.py` — refresh `public/data/undercity-map.json`.
- `infrastructure/lambda/tests/test_map.py` — node count 257→267; `wild` 61→71;
  add a `v12` comment.
- `infrastructure/lambda/tests/test_map_file.py` — node count 257→267.
- Verify: `cd infrastructure/lambda && python -m pytest tests -q` stays green.

No frontend, engine, or balance changes.
