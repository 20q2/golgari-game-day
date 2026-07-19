# Undercity — Roaming Wild Warp

## Problem

Warp mushrooms already have a 20% chance to "wild warp" a player to a random
node instead of letting them choose a destination. We want a stronger, more
memorable version: at any moment **one** warp mushroom is designated *wild* —
landing on it always flings you somewhere random, no picker. To keep any single
biome from permanently owning "the wack portal," the wild designation **roams**:
after it fires, it jumps to a different biome's warp.

No visual tell on the board (it's a nasty surprise), but the post-event message
must make unmistakably clear what just happened.

## Design

### Shared session state

The currently-wild warp is session-level state (shared by all players), stored
like boss HP / barriers under `pk=_season_pk(sid)`:

- `sk = 'WILDWARP'`, `{ node: <warp node id> }`.
- `_wild_warp_node(table, sid)` reads it; if unset, it lazily initializes to a
  random `WARP_NODES` entry and stores it.
- `_rotate_wild_warp(table, sid, current)` reassigns it to a random *different*
  warp node and stores it.

### Resolve-space behavior (`_resolve_space`, warp branch)

When a player lands on a warp node:

1. If the node **is** the current wild warp:
   - Pick a random legal destination (reuse the existing wild-warp destination
     filter: exclude `boss/barrier/lair/vault` types and `ruin` region, and the
     current node).
   - Move the player there.
   - `_rotate_wild_warp(...)` so the wildness moves to another biome.
   - Return `{ type: 'wild_warp', text: 'Something went wrong… WILD WARP!!! The spores misfire and hurl you across the Undercity.', to: dest }`.
2. Otherwise: **unchanged** — existing 20% wild / 80% picker logic stays.

The random-destination selection is factored into a helper
`_wild_warp_dest(node)` used by both the designated path and the existing 20%
path, so there's a single source of truth.

### Client

No changes required to trigger the treatment: the client already renders a
`wild_warp` event as a distinct red "Wild Warp!" cyclone
(`src/app/undercity/data/items.ts`). The new text flows through the same event.

## Testing

`infrastructure/lambda/tests/` (FakeTable suite), deterministic via
`FixedRng` / monkeypatched `db._rng`:

- Landing on the designated wild warp **always** relocates (never returns a
  `warp` picker), returns `type == 'wild_warp'`, and the destination is a legal
  node (not boss/barrier/lair/vault/ruin).
- After firing, `_wild_warp_node` returns a **different** warp node (rotation).
- A non-wild warp still returns the `warp` picker when the 20% roll doesn't hit.

## Out of scope

- Board visual tell for the wild mushroom (deliberately omitted).
- Changing the ambient 20% wild chance on the other warps.
