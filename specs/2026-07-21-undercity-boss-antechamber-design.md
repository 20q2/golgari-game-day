# Undercity — Boss Antechamber Loops (procedural dungeons)

**Date:** 2026-07-21
**Status:** Design approved, pending implementation plan
**Scope:** `infrastructure/lambda/undercity_mapgen.py` + `tests/test_mapgen.py`

## Problem

The per-night dungeon generator ([undercity_mapgen.py](../infrastructure/lambda/undercity_mapgen.py))
carves each biome pocket as a grid maze, then picks the lair boss as the single
**deepest cell** from the mouth and hangs a dead-end `_esc` spur off it. The lair
is therefore almost always a **dead-end at a far corner** — reached by one
corridor.

Movement is **exact-count (Dokapon)**: a walk must land on a node in *exactly*
one of the rolled step counts (`engine.legal_destinations` /
`engine.validate_walk`). A dead-end boss is landable only on the single roll that
equals its distance; every other roll overshoots, and you cannot stop on it. So
reaching the boss is frustratingly luck-gated.

### Why "just add loops" is not enough (the parity trap)

Grid mazes are **bipartite** (cell colour = `(r + c) mod 2`). Every cycle built
from grid-adjacent cells therefore has **even length**, so both arms of such a
loop reach the lair at the **same parity**. Adding grid-only loops near the end
(e.g. biasing `_add_loops`) would still leave the boss unlandable for the
"wrong" parity roll. To make the boss reliably landable, the terminal loop must
contain an **odd cycle**, which requires at least one **off-grid** edge.

Historical note: the retired hand-built `map.json` already solved this — each
lair had a small `_lg1`/`_lg2` gate antechamber (a direct junction→lair edge
*and* junction→gate→lair), giving approach distances `{1, 2}`. The runtime
generator dropped that structure. This design restores it, procedurally.

## Goals & scope

- Make each of the **5 dungeon lairs** (`city`/`cavern`/`bog`/`bone`/`garden`
  `_lair`) easier to land on under exact-count movement, by placing an odd-cycle
  loop — a "boss antechamber" — at the end of each pocket.
- Keep the boss a real journey: lair stays the deepest cell, `>= LAIR_MIN_HOPS`
  (6) from the mouth.
- Preserve determinism (same season+biome → identical pocket).

**Non-goals:** the surface board, boss identity/placement, combat/economy
numbers, the barrier lairs (`lair_titan`/`vault`), and the isle boss. Those are
explicitly out of scope for this change.

## Design (Approach B — Boss Antechamber)

In `_assign_and_build`, after the lair cell is selected and before emitting node
dicts:

1. **Pick the approach junction `J`.** Among the lair's in-maze neighbour cells,
   choose the one with the smallest BFS distance to the mouth (deterministic
   tiebreak by cell coordinate). The lair is connected, so it has ≥ 1 such
   neighbour. Keep the existing `J ↔ lair` edge (the direct, distance-1 arm).

2. **Append two off-grid gate nodes** `<biome>_lg1` and `<biome>_lg2`, type
   `wild` (matching the historical antechamber and the depths palette). Each gate
   neighbours **exactly** `{J, lair}` and nothing else. Position them at a small
   perpendicular offset on the segment between `J` and the lair so their ribbons
   don't sit on top of the corridor (pockets render in their own sub-view, so
   only rough, non-overlapping placement is needed).

3. The lair keeps its existing degree-1 `_esc` escape spur.

### Resulting topology

Each gate forms a triangle `J – lg – lair` (length-3 odd cycle). From `J` the
lair is landable at distance **1** (direct) or **2** (via either gate). From any
cell `k` grid-steps back from `J`, the lair is landable at **k+1** and **k+2** —
consecutive integers, so at least one matches the roll's parity. Lair in-pocket
degree becomes ≥ 3 (`J` + `lg1` + `lg2`, plus the `_esc` spur = 4 total
neighbours).

### Canonical ids / contract

New ids `<biome>_lg1`, `<biome>_lg2` follow the `<biome>_<suffix>` convention, so
they pass the existing "every id starts with the biome" contract and do not
collide with the load-bearing canonical ids (`_lb`, `_lair`, `_cache`, `_trove`,
`_rest`, `_esc`). No name-map, respawn, or escape-ladder logic changes.

## Validation / tests

Extend `_valid()` (generator) and `test_mapgen.py`:

- `<biome>_lg1` and `<biome>_lg2` each exist exactly once, type `wild`, with
  in-pocket neighbours exactly `{J, lair}` (reciprocated).
- The lair sits on an **odd cycle** — equivalently, assert the concrete
  landability guarantee: the lair has two approach distances of **different
  parity** (the `{1, 2}`-from-`J` property). This is the property that actually
  makes the boss landable and is the real acceptance test.
- Existing contracts still hold: `len(nodes) >= MIN_NODES` (now +2), lair depth
  `>= LAIR_MIN_HOPS`, `_esc` neighbours == `[lair]`, symmetric adjacency,
  fully reachable from the mouth, deterministic per seed.

## Risks & edge cases

- **Lair with multiple maze neighbours:** pick the mouth-nearest as `J`; the
  others remain as extra approaches (only helps). Deterministic tiebreak keeps
  output stable.
- **Geometry overlap:** gates are placed with a perpendicular offset; the
  sub-view render is tolerant, and nothing depends on exact coordinates.
- **MIN_NODES / retries:** +2 nodes only relaxes the size floor; the existing
  `MAX_ATTEMPTS` retry loop is unaffected.
- **Difficulty:** the boss becomes reliably reachable, not trivial — it is still
  ≥ 6 hops deep and gated by the pocket's hazards/elites. No balance numbers
  change.
