# Undercity — Post-boss escape ladder

**Date:** 2026-07-20 (revised 2026-07-22)
**Status:** Implemented; revised to a two-step climb (see "Revision" below)

## Revision (2026-07-22): two-step climb, not teleport-on-land

The original "teleport-on-land" behavior (below) made the stairwell behave
unlike every other rusted ladder: the instant you set foot on the spur you were
whisked to the surface, so players never got to *stand* on it and deliberately
leave — it read as inaccessible. The escape ladder now works like any other
rusted ladder: a **two-step climb**.

1. **Land / stop.** Bonk-stopping onto the escape spur (already a `closed` stop —
   reachable on any roll from the lair) just **stops** you there. `_resolve_space`
   no longer relocates; it returns a "you've reached the escape ladder" event and
   your `position` stays on `<biome>_esc`.
2. **Tap to climb.** On a later turn you roll, the escape spur lights up as a move
   choice, and tapping it hauls you out — **consuming that roll**, exactly like
   crossing a normal ladder pair.

Mechanics (no new graph edge, so edge symmetry and the one-way invariant hold):
- **`_roll`:** when your `position` is an escape ladder whose lair is in your
  `poiClaims`, add the biome's surface mouth `<biome>_lt` to `pendingMove.dests`
  as the climb target — alongside the normal "walk back into the maze"
  destinations (going back down stays legal).
- **`_move`:** if `prev` is an escape ladder and `to` is its mapped surface mouth
  (`data.ESCAPE_EXITS[prev]`), treat it as the climb: relocate to `<biome>_lt`,
  reset `restsUsed`, return the climb-out event, and skip `_resolve_space` (no
  chain-resolve, matching the old teleport). This is the *only* way to reach
  `<biome>_lt` from the spur, so exit stays strictly one-way.
- **Data:** add `ESCAPE_EXITS = {b + '_esc': b + '_lt' for b in BIOMES}`.
- **Client (`board-canvas`):** register each escape spur's `ladderPartner` as its
  surface mouth `<biome>_lt`. The existing tap-a-ladder-whose-partner-is-a-choice
  logic and disc-lighting then light the spur on the climb turn and send the
  climb move — no other client change.

The rest of the original design (per-player gating via `poiClaims`, hidden until
claimed, one-way, excluded `lair_titan`, wild-warp exclusion) is unchanged. The
sections below describe the original teleport-on-land approach for history.

---

## Problem

Each biome dungeon (a "depths" pocket) is a dark maze with its sigil **lair**
sitting ≥6 hops from the single entrance ladder (`<biome>_lb` ↔ `<biome>_lt`).
After a player beats the lair's sigil boss, the only way out is to walk the whole
maze back to that one entrance ladder. That backtrack is pure tedium once the
prize is claimed.

## Goal

After a player **personally** clears a biome's sigil lair, a rusty **escape
ladder** appears as a dead-end spur next to that lair. Landing on it climbs them
straight out to that biome's surface mouth. It is a convenience exit only — it can
never be used to skip *down* into the lair.

Applies to the five **sigil** lairs only (`{biome}_lair` for each biome in
`BIOMES`). `lair_titan` (Lord of Extinction) is side content and is excluded.

## Chosen approach: teleport-on-land, one-way

The escape node connects **only** to its lair (a degree-1 spur). Landing on it
relocates the player to the biome's surface mouth (`<biome>_lt`) — the same
pattern warp mushrooms already use in `_resolve_space` (`doc['position'] = dest`).

Because there is **no edge from the surface to the escape node**, it can never be
walked *into* the lair. This sidesteps two problems with a graph-bridge
alternative: (a) a two-way bridge would let claimed players skip the maze to farm
the repeat "vestige" kill, and (b) board edges are a hard symmetric invariant
(`test_neighbors_symmetric_and_known`), so a one-way graph edge is impossible —
runtime relocation is the only clean way to make exit strictly one-directional.

Rejected: **graph bridge** (escape neighbors both lair and `<biome>_lt`, crossed
over two turns like existing ladders). Consistent with current ladders but
reintroduces the maze-skip and adds a surface↔depths edge that must be
runtime-gated in both directions.

## Components

### 1. Map (`infrastructure/lambda/map.json` → synced to `public/data/undercity-map.json`)

Add five nodes: `city_esc`, `cavern_esc`, `bog_esc`, `bone_esc`, `garden_esc`.

- `type`: `"ladder"`
- `region`: `"depths"`
- `neighbors`: `["<biome>_lair"]` (single edge)
- The corresponding `<biome>_lair` node gains the reciprocal neighbor `<biome>_esc`.
- `x`/`y`: placed visually adjacent to the lair (small offset).

Sync the two map copies with `python infrastructure/lambda/sync_map.py` (a pytest
fails while the copies differ). Node count goes 267 → 272; `ladder` type count
10 → 15.

### 2. Data (`infrastructure/lambda/undercity_data.py`)

- Add `ESCAPE_LADDERS = {b + '_esc': b + '_lair' for b in BIOMES}` (escape node →
  its lair node).
- Fix `dungeon_entrance(biome)` so it returns the maze **mouth** (`<biome>_lb`)
  and never an escape node. It currently returns "the first depths ladder found",
  which is now ambiguous with two depths ladders per pocket. Make it explicit:
  return `<biome>_lb` (or filter escape nodes out of the candidate set).

### 3. Per-player gating (`infrastructure/lambda/undercity_db.py`)

Extend `_blocked_nodes(doc)` to add every escape node whose lair is **not** in the
player's `poiClaims`:

```python
def _blocked_nodes(doc):
    blocked = set()
    if doc.get('tier', 1) > data.TUNNEL_TIER_MAX:
        blocked |= data.TUNNEL_NODES
    claims = doc.get('poiClaims') or []
    for esc, lair in data.ESCAPE_LADDERS.items():
        if lair not in claims:
            blocked.add(esc)
    return frozenset(blocked)
```

`blocked` nodes are never a movement destination and never a corridor
(`engine.legal_destinations`), so an unclaimed player can neither land on nor path
through the escape node. No server-side "reveal" state is needed — the gate is
derived from `poiClaims`.

Also add escape nodes to the `no_go` filter in `_wild_warp_dest` so a random warp
fling can never dump a player onto an escape node.

### 4. Landing behavior (`_resolve_space`, `ladder` branch)

When the resolved node is an escape ladder (`node in data.ESCAPE_LADDERS`), set
`doc['position']` to the biome's surface mouth `<biome>_lt` (the surface-region
top of the existing entrance ladder pair; all five verified present) and return a
climb-out event,
e.g. *"You haul yourself up the rusty ladder and out of the depths."* Normal
ladders keep their existing "your next roll can carry you through" two-turn
behavior. Landing at `<biome>_lt` does not chain-resolve (matches warp behavior).

### 5. Client (`src/app/undercity/engine/board-canvas.ts` + node rendering)

Render escape nodes **only** when the player holds that lair's claim (the state
payload already carries `poiClaims` / sigil info); otherwise they stay hidden.
This hidden→visible transition is the "appears" moment the feature promises. Give
them the rusty-ladder visual. Confirm the dungeon fog / reveal path does not force
them visible before the claim.

## Testing

Update existing map invariants:
- `tests/test_map.py::test_node_count`: 267 → 272 (with a version note).
- `tests/test_map.py::test_space_type_distribution`: `ladder` 10 → 15.

New tests (in `tests/test_deep_dungeons.py`):
- Each sigil lair has exactly one adjacent escape node; edge is symmetric.
- Unclaimed player: escape node is in `_blocked_nodes` — not reachable / not a
  corridor from `legal_destinations`.
- Claimed player (`<biome>_lair` in `poiClaims`): escape node reachable; landing
  on it relocates `position` to `<biome>_lt`.
- `dungeon_entrance(biome)` still returns `<biome>_lb`, never `<biome>_esc`.
- `_wild_warp_dest` never returns an escape node.

Keep the map-sync lint green (`sync_map.py` / the copy-equality test).

## Non-goals / invariants preserved

- No environmental combat damage (unrelated; untouched).
- Lair distance from the entrance (≥6 hops) is unchanged — the escape node is a
  degree-1 spur off the lair and adds no shorter path to the lair.
- Season-shared lair HP pool and the sigil-claim reward flow are untouched; this
  feature reads `poiClaims` but never writes it.
- Edge symmetry, full reachability from the gate, and the redesigned-maze test
  exemptions all still hold.
