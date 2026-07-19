# The Undercity — Flow Loot Puzzle

Design doc. Gate the reward on a **loot space** (grass icon) behind a tiny
"Flow"-style line puzzle, so collecting spores feels earned instead of automatic.

Origin: player request — "one color Flow puzzle with some obstacles; whenever you
land on the loot space (the grass icon) you solve it to get the reward and see the
dialog pop up."

## What "Flow" means here

A single-color path puzzle on a small square grid. There is one **start** cell and
one **end** cell, plus zero or more **rock** cells (obstacles). The player drags a
continuous line from start to end. To win:

- the line is one unbroken path of orthogonally-adjacent steps from start to end,
- it never reuses a cell and never enters a rock, and
- it covers **every** non-rock cell (no empty squares left).

That "fill everything" rule is what makes it a puzzle rather than just pathfinding.

```
┌───┬───┬───┬───┐
│ S │   │   │   │
├───┼───┼───┼───┤
│   │ ▪ │ ▪ │   │
├───┼───┼───┼───┤
│   │   │   │   │
├───┼───┼───┼───┤
│   │   │   │ E │
└───┴───┴───┴───┘
```

## Decisions (locked)

1. **Easy / chill.** Small grids (4×4 and 5×5) with one or two rocks. It's a fun
   speed bump that makes the reward feel earned, never a brain-teaser. No
   difficulty scaling with depth.
2. **Give up = nothing, no penalty.** Free unlimited resets. A "Give up" button
   closes the puzzle and forfeits the loot for that space. Landing again later
   (or another loot space) offers a fresh puzzle. No consolation prize.
3. **Handmade pack, not procedural generation.** ~12–15 hand-authored puzzles,
   each stored as a grid layout *plus its known solution path*. Landing picks one
   at random. Occasional repeats are fine for a quick bonus. This avoids writing a
   solver and guarantees every puzzle is fair and pretty.
4. **Surprise reward.** The puzzle modal does not show what you're playing for.
   Solving reveals the loot via the existing reward dialog — a small reveal moment.
5. **All loot spaces are gated.** Every landing on a `loot` node runs the puzzle,
   whatever the roll would award (gear / consumable / forage spores).

## How it fits the existing loot flow

Today, landing on a `loot` node is fully resolved server-side in `_resolve_space()`
([undercity_db.py:1435-1455](../infrastructure/lambda/undercity_db.py)): it rolls
gear (10%) / consumable (10%) / forage spores, **mutates `doc` immediately**, and
returns a `{type:'loot', ...}` dict as the `spaceEvent`. The client's
`routeSpaceEvent()`
([board-tab.component.ts:902-960](../src/app/undercity/tabs/board-tab.component.ts))
sends anything it doesn't specially handle — including `loot` — to the generic
event modal, which renders the grassy reward card with reward "chips".

The closest existing pattern is the **excavation dig-site**: a server-authoritative
grid mini-game with a masked client view and a per-interaction action handler
(`_dig` / `ExcavationModalComponent`). We mirror its shape.

## Mechanic — defer the reward behind the puzzle

### Server: land on loot (change `_resolve_space` loot branch)

Instead of applying the reward at landing time, **roll it but hold it**:

1. Roll the same gear / consumable / forage outcome as today, producing a
   `pendingLoot` payload — the exact reward dict (`{type:'loot', ...}`) that would
   normally be returned — **without mutating `doc`'s spores/bag/gear yet**.
2. Pick a random puzzle id from the handmade pack.
3. Stash `doc['pendingLoot'] = {puzzleId, reward}` on the player doc.
4. Return a new event `{type:'loot_puzzle', node, puzzle:<masked view>}`.

The **masked view** sends only what the client needs to render — grid dimensions,
start cell, end cell, rock cells — and **never the solution path**. (Mirror
`_dig_view`'s "don't leak the answer" discipline. The reward is likewise omitted.)

### Server: new action `solve-loot-puzzle`

Handler `_solve_loot_puzzle(table, sid, doc, payload)`, registered in the `handlers`
dict ([undercity_db.py:743-755](../infrastructure/lambda/undercity_db.py)):

- Require `doc['pendingLoot']` to exist (else `_err(...)`).
- Read the drawn path from `payload.path` (list of `[row, col]` cells).
- **Validate server-side** that the path is a legal, complete solution for that
  puzzle: starts at start, ends at end, each step orthogonally adjacent, no cell
  repeats, no rock cells, and covers every non-rock cell. We do **not** require it
  to equal the stored solution — any valid solution wins (some grids have several).
  The stored solution is kept only as a guarantee the puzzle is solvable.
- On success: apply the held `reward` to `doc` (the spore/bag/gear mutations that
  `_resolve_space` used to do inline), clear `doc['pendingLoot']`, and return
  `_ok(doc, spaceEvent=reward)` — i.e. the normal `{type:'loot', ...}` event, so the
  existing reward dialog pops.
- On invalid path: `_err('That path isn\'t a full solution', 409)` — the client
  just lets the player keep trying (this is a safety net; the client validates too).

Giving up: a `cancel-loot-puzzle` action (or reuse a generic clear) drops
`doc['pendingLoot']` and returns `_ok(doc)` with no reward.

### Data: the handmade pack

New table in `undercity_data.py`, e.g. `FLOW_PUZZLES`:

```python
FLOW_PUZZLES = [
    {
        'id': 'p01',
        'w': 4, 'h': 4,
        'start': [0, 0],
        'end':   [3, 3],
        'rocks': [[1, 1], [1, 2]],
        'solution': [[0,0],[0,1],[0,2],[0,3],[1,3],[2,3],[2,2],[2,1],[2,0],[3,0],[3,1],[3,2],[3,3]],
    },
    # ~12-15 total, mix of 4x4 and 5x5, one or two rocks each
]
```

`solution` doubles as authoring-time proof of solvability and can back a "reveal
solution" debug aid under the existing `DEBUG` flag if wanted. A pytest asserts
every packed `solution` is itself a valid full solution (same validator the handler
uses), so a typo'd puzzle can never ship unsolvable.

## Client

### New standalone component `FlowPuzzleModalComponent`

Template: `ExcavationModalComponent` (pure-presentation, parent owns state).
Location: `src/app/undercity/tabs/flow-puzzle.component.ts`.

- `@Input() puzzle` — the masked view (dims, start, end, rocks).
- Renders the grid as DOM cells (small, phone-first). Start/end dots and rock tiles
  are visually distinct.
- **Drag to draw:** pointer/touch events build the path. Dragging onto a cell
  orthogonally adjacent to the current tip extends the line; dragging back onto the
  previous cell erases the last step (standard Flow feel). Illegal moves (rocks,
  non-adjacent, revisits) are ignored.
- Live "solved?" check client-side using the same rules as the server. When solved,
  the line glows and a Claim button enables (or it auto-submits after the glow).
- `@Output() solved` emits the path; `@Output() gaveUp` emits on Give up.
- Buttons: **Reset** (clear the line), **Give up**.

### Wiring in `board-tab`

- Add a branch in `routeSpaceEvent()` for `ev.type === 'loot_puzzle'` that opens
  the new modal (set a signal like `flowPuzzle.set(ev.puzzle)`), following the
  `store.openFacility` persistence pattern so a reopened tab restores the puzzle.
- `solved` → `store.action('solve-loot-puzzle', {path})`; on the `_ok` response the
  returned `spaceEvent` (the real loot) is fed to the *existing* reward path, so the
  grassy reward card pops exactly as it does today.
- `gaveUp` → `store.action('cancel-loot-puzzle', {})`, close modal, no reward.
- Add `'loot_puzzle'` handling to the `SpaceEvent` model
  ([undercity-models.ts:376-427](../src/app/undercity/services/undercity-models.ts))
  and a `FacilityKind` entry if we route it through `openFacility`.

## Data flow (happy path)

1. `move` → land on `loot` → server rolls reward, stashes `pendingLoot`, returns
   `{type:'loot_puzzle', puzzle}`.
2. Client opens `FlowPuzzleModalComponent` with the masked puzzle.
3. Player draws a full solution → client validates → `solve-loot-puzzle {path}`.
4. Server re-validates, applies the held reward, clears `pendingLoot`, returns the
   real `{type:'loot', ...}` as `spaceEvent`.
5. Client shows the normal reward dialog. Spores earned. 🌿

## Error handling & edge cases

- **Refresh / reopen mid-puzzle:** `pendingLoot` lives on the player doc, so
  `/game/state` can re-offer the puzzle (surface it like `openFacility` does). The
  reward is never lost until the player gives up or solves.
- **Double-solve / stale submit:** handler requires `pendingLoot`; a second
  `solve-loot-puzzle` after it's cleared returns `_err`, no double reward. Uses the
  existing optimistic-lock save.
- **Client sends a bad path:** server rejects with 409; client keeps letting the
  player try (client-side validation should normally prevent reaching submit).
- **Give up then land again:** fresh random puzzle, fresh roll — no memory of the
  forfeited reward.

## Testing

Add to the pytest suite (`infrastructure/lambda/tests/`):

- `test_flow_puzzles_all_solvable` — every `FLOW_PUZZLES.solution` passes the
  validator.
- Landing on a `loot` node returns `loot_puzzle` and sets `pendingLoot`; `doc`
  spores/bag/gear are unchanged at this point.
- `solve-loot-puzzle` with a packed solution awards the held reward, clears
  `pendingLoot`, and returns a `loot` space event.
- `solve-loot-puzzle` with an invalid path returns an error and leaves
  `pendingLoot` intact.
- `cancel-loot-puzzle` clears `pendingLoot` with no reward.
- Validator unit tests: reject short paths, diagonal steps, revisits, rock entry,
  and paths that leave a cell uncovered.

## Out of scope (YAGNI)

- Procedural puzzle generation / a solver.
- Difficulty scaling with depth or player progress.
- Multi-color Flow, timers, move-count scoring, or leaderboards.
- Consolation rewards for giving up.
- Puzzles on any space other than `loot`.

## Touch list

- `infrastructure/lambda/undercity_data.py` — `FLOW_PUZZLES` pack.
- `infrastructure/lambda/undercity_db.py` — defer reward in `_resolve_space` loot
  branch; `_solve_loot_puzzle` / `cancel-loot-puzzle` handlers + validator; register
  in `handlers`; masked `pendingLoot` surfacing in the state view.
- `infrastructure/lambda/tests/` — new tests above.
- `src/app/undercity/tabs/flow-puzzle.component.ts` — new modal.
- `src/app/undercity/tabs/board-tab.component.ts` / `.html` — route `loot_puzzle`,
  wire solve/give-up, feed real reward to existing dialog.
- `src/app/undercity/services/undercity-models.ts` — `loot_puzzle` event shape.
- (Optional) client mirror of the validator for live solved-checking.
