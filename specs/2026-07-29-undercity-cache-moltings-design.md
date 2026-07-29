# Overgrown Cache: Moltings reward, reachability guarantee, friendlier pickup message

**Date:** 2026-07-29
**Status:** Approved, ready for implementation plan

## Problem

The Overgrown Cache loot-tile mini-game (the "vine" flow puzzle) currently offers
two consumable pouches plus a chance at a gear chest. Three gaps:

1. Moltings (the crafting material) have no loot-tile source — you only get them
   from salvage, mining, and excavation. They should be a draggable option in the
   cache so a player can route their vine to grab material instead of a pouch.
2. A reward can, in principle, be placed on a cell no valid start→end vine route
   can cross (boxed in by rocks / off every path), making it uncollectible.
3. The gear pickup message dwells on inventory logistics — *"You unearth a piece
   of gear — stashed!"* and a chip reading *"to stash" / "stash full → materials"*.
   It should read as a win, not a storage report.

## Design

### Part A — Moltings replace one pouch (1 per grab)

The cache reward pool changes from `['item', 'item']` (+ optional `'gear'`) to
`['item', 'molting']` (+ optional `'gear'`). Every cache now offers one pouch and
one molting pile, plus a gear chest on the existing gear roll. The vine still
claims only the **first** reward its route crosses, so the molting is a genuine
trade-off against the pouch and the gear.

**Server** (`infrastructure/lambda/undercity_db.py`):
- `_loot_puzzle`: `kinds = ['item', 'molting']`; gear appended on the same
  `GEAR_DROP['loot']` roll as today.
- New `_award_molting(doc)`: grants `FLOW_MOLTING_REWARD` moltings via the
  existing `_mine_materials(doc, moltings=...)` path. Returns
  `{'type': 'loot', 'text': 'You pry a Molting loose from the cache!',
    'materials': {'moltings': N, 'ichor': 0}}`.
- Register `'molting'` in `_LOOT_AWARDERS`.
- `_award_flow_reward`: handle `kind == 'molting'` — call `_award_molting`, and
  merge its `materials` (and any spores) onto the movement-spore event the same
  way item/gear are merged.

**Config** (`infrastructure/lambda/undercity_config.py`):
- `FLOW_MOLTING_REWARD = 1` — moltings granted per cache molting pickup.

**Engine** (`infrastructure/lambda/undercity_engine.py`):
- No change needed: `first_reward_on_path` already returns the reward `kind`
  string generically, so `'molting'` flows through untouched.

**Client:**
- `src/app/undercity/services/undercity-models.ts`: add `'molting'` to
  `FlowReward['kind']`.
- `src/app/undercity/tabs/flow-puzzle.component.ts`: render the molting pile with
  the Material Icons `grass` ligature (the glyph the Plaza already uses for
  moltings) rather than a custom SVG. The other kinds keep their `svgIcon`s, so
  the template renders a ligature `mat-icon` for `molting` and `svgIcon` for the
  rest.
- `src/app/undercity/tabs/board-tab.component.html`: add a moltings chip to the
  space-event modal so a claimed molting shows `grass +N` (mirrors the Plaza
  materials chip styling).

No client mirror of `FLOW_MOLTING_REWARD` is needed — the amount is only shown
post-claim, and the server sends the actual amount in the event.

### Part B — Reachability guarantee

`_place_loot_rewards` today only avoids rocks/start/end (and keeps gear off cells
orthogonally adjacent to start). It does not verify a reward cell is on any valid
route, so a boxed-in cell could hold an uncollectible reward.

- New pure helper `engine.cell_on_some_route(puzzle, cell)`: returns `True` iff a
  valid single-line start→end route (same rules as `validate_flow_path`) exists
  that passes through `cell`. Implemented as a bounded DFS — boards are ≤5×5 with
  ≤2 rocks, and neighbor expansion is ordered toward the target waypoint with
  early exit, so it resolves immediately in practice.
- `_place_loot_rewards`: accept a candidate cell only if `cell_on_some_route`
  passes (in addition to the existing rock/start/end/gear-adjacency rules). If no
  eligible cell qualifies for a kind (pathological board), fall back to the
  current behavior so a cache never errors — reachability is a guarantee we make
  best-effort, never a hard failure that eats a landing.

Covered by unit tests in the engine suite (`cell_on_some_route` truth cases +
a placement test asserting every placed reward is on some route).

### Part C — Friendlier gear pickup message

Reword the flow-reward gear text and the shared space-event modal chip so the
common cases celebrate and only the genuinely-different case explains itself.

`_drop_phrase` (or the flow-reward text builder) by outcome:
- `equipped`  → "You unearth {name} and slot it on!"
- `stashed`   → "You unearth {name}!"  (no stash logistics)
- `stash-full`→ "Your gear stash was full, so you grind {name} into materials."

Modal chip (`board-tab.component.html`, ~line 500):
- `equipped`   → `equipped`
- `stashed`    → (name only, no trailing storage label)
- `stash-full` → `→ materials`

**Scope:** this touches the loot-puzzle gear text and the shared space-event
modal chip (also used by cache / mystery gear finds — a consistent improvement).
`battle-playback`'s reward line is intentionally left unchanged.

## Testing

- Engine suite: `cd infrastructure/lambda && python -m pytest tests -q` must stay
  green. Add tests for `cell_on_some_route` and molting placement/reachability.
- Client: `npm run build` (lint is known-broken in this repo; verify via build).

## Out of scope

- Battle reward-line wording.
- Any change to moltings sinks (Blacksmith/Salvage costs).
- New molting art/SVG (reusing the `grass` ligature).
