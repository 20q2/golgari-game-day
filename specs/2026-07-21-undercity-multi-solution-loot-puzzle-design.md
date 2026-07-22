# The Undercity — Multi-Solution Loot Puzzle

Design doc. Rework the Flow loot puzzle so the player's route decides the prize.
Instead of a pure gate that rolls a random reward on solve, scatter reward symbols
across the board and **let the player keep the first one their vine passes through**;
the rest fade the moment one is claimed.

Origin: player request — "the loot tiles should give items sometimes along with
spores… rework the very cool puzzle to have multiple solutions? Like we choose to
draw a path to spores, or to an item symbol — or maybe even a piece of gear."

Extends [2026-07-19-undercity-flow-loot-puzzle-design.md](2026-07-19-undercity-flow-loot-puzzle-design.md).
That doc's mechanics (full-fill Hamiltonian trace, handmade `FLOW_PUZZLES` pack,
`solve-loot-puzzle` / `cancel-loot-puzzle`, `pendingLoot` on the doc,
`validate_flow_solution`) stay as-is except where called out below.

## The change in one line

The full-fill puzzle is unchanged; what's new is **reward symbols placed on cells**
and a **first-hit-wins** rule. Because a full solution covers every non-rock cell,
the vine crosses *all* the reward cells anyway — so the only thing the player
controls is **the order** they reach them in. Routing to touch the gear *first*,
while still leaving a valid path to finish the fill, is the puzzle. Greedy routes
can strand you into a forfeit. Self-balancing, no extra difficulty knob.

```
┌───┬───┬───┬───┐
│ S │   │spr│   │     S = start,  E = end
├───┼───┼───┼───┤     spr = spore reward
│   │ ▪ │itm│   │     itm = item reward
├───┼───┼───┼───┤     gr  = gear reward (rare board)
│gr │   │   │   │
├───┼───┼───┼───┤     Whichever of spr/itm/gr the vine
│   │   │   │ E │     enters FIRST is claimed; others fade.
└───┴───┴───┴───┘
```

## Decisions (locked)

1. **Full-fill stays.** Still one unbroken line covering every non-rock cell from
   start to end. Grabbing a reward does **not** end the puzzle — you must finish.
2. **First-hit-wins.** The first reward cell the continuous path enters is the
   claimed reward; the others deactivate immediately (visually fade). Determined
   **server-side** from the submitted path order — the client's highlight is
   cosmetic only.
3. **Roll the cache.** On landing, the server rolls *presence* using today's loot
   odds:
   - **Spores** — always present (the floor; you're never empty-handed).
   - **Item** — present at today's consumable odds (~10%).
   - **Gear** — present at today's loot gear-drop chance (rare).
   Only symbols for what rolled get placed. Common board = spores + item; rare
   board = spores + item + gear.
4. **Values roll at claim time.** `pendingLoot` stores only *which categories are
   present and where*, never values. On solve, the server derives the first-hit
   category and *then* rolls that category's value (reusing the existing
   `_roll_gear_drop` / consumable / forage-spore helpers). No wasted rolls; bag-full
   logic only runs for the reward actually taken.
5. **Gear is not guaranteed claimable-first.** Placement is a cosmetic overlay that
   never changes traversability, so every puzzle stays solvable — but a given
   cache's layout may box the gear so you can't reach it first without stranding
   yourself. Settling for spores/item is the intended risk, and there is always
   exactly one first-hit reward, so no landing is ever empty-handed.
6. **SVG icons only, no emoji.** Reward markers use registered `uc-*` inline SVG
   icons. The existing puzzle's emoji (🌱 start / 🌾 end / 🪨 rock) are converted at
   the same time: start/end render as pure-CSS colored rings, rock as a muted
   hatched fill — no new icons needed for those. Three new reward icons are added
   (see below).
7. **Give up = nothing, no penalty.** Unchanged from the original design.

## Server

### Roll the cache (change the `loot` branch of `_resolve_space`)

Today the branch picks a rock-bearing puzzle id and stashes
`doc['pendingLoot'] = {puzzleId, view}`
([undercity_db.py:2130-2138](../infrastructure/lambda/undercity_db.py)). Extend it:

1. Pick the puzzle id as today (rock-bearing puzzles only).
2. Roll **presence**: spores always; item at the consumable chance; gear at
   `GEAR_DROP['loot']`'s chance. (Independent rolls — a board can have gear+item, or
   just spores+item, etc.)
3. **Place** each present reward on a distinct cell via a new helper
   `_place_loot_rewards(puzzle, kinds, rng)`:
   - candidate cells = all non-rock cells except `start` and `end`;
   - additional guard: the **gear** cell is never orthogonally adjacent to `start`
     (no trivial step-one grabs);
   - returns `[{'kind': 'spores'|'item'|'gear', 'cell': [r, c]}, …]`.
4. Stash `doc['pendingLoot'] = {puzzleId, view, rewards}` where `rewards` is the
   placement list. The masked `view` gains a `rewards` field (positions + kind
   only, **no values**).

### Determine the claim (change `_solve_loot_puzzle`)

Today it validates the path, then calls `_award_loot(doc)` which rolls a random
reward ([undercity_db.py:4006-4024](../infrastructure/lambda/undercity_db.py)).
New flow:

1. Validate the path with `validate_flow_solution` (unchanged — full fill required).
2. Compute the claimed category:
   `kind = engine.first_reward_on_path(pending['rewards'], path)`.
3. Award that category's reward by rolling its value now, reusing the existing
   helpers factored out of `_award_loot`:
   - `spores` → the forage roll (`_scrounge` + garden Composter perk);
   - `item` → `_give_consumable(doc)`;
   - `gear` → `_roll_gear_drop(doc, GEAR_DROP['loot'][1])`.
   Return the same `{type:'loot', …}` event shape today's reward dialog already
   renders (spores / item / gear chip), so the client reveal is unchanged.
4. Clear `pendingLoot`, save with the existing optimistic lock.

`_award_loot` is refactored into three small per-category award helpers so both the
old callers (if any remain) and the new claim path share one implementation.

### New engine helper (pure, `undercity_engine.py`)

```python
def first_reward_on_path(rewards, path):
    """Return the kind of the first reward cell the path enters, or None.
    `rewards` is [{'kind': str, 'cell': [r, c]}, …]; `path` is [[r, c], …] in
    draw order. Ties are impossible (one cell = one reward)."""
```

Walks `path` in order, returns the `kind` of the first cell that matches a reward
cell. Lives beside `validate_flow_solution`; no I/O, easy to unit test.

## Client

### `FlowPuzzleModalComponent` ([flow-puzzle.component.ts](../src/app/undercity/tabs/flow-puzzle.component.ts))

- `FlowPuzzleView` gains `rewards: { kind: 'spores' | 'item' | 'gear'; cell: [number, number] }[]`.
- Render each reward cell with its `uc-*` SVG via `<mat-icon [svgIcon]>`.
- As the path is drawn, compute the first reward cell the current `path()` crosses:
  that one gets a "claimed" highlight; the others get a `.faded` class (dimmed,
  desaturated). This is presentation only — recomputed from `path()` each change.
- Convert the existing markers off emoji: `.start` / `.end` keep their ring
  box-shadows (already present) and drop the `<span>🌱/🌾</span>`; `.rock` keeps its
  muted background and drops `<span>🪨</span>` (optionally a CSS hatch).
- Copy update: sub-line becomes something like "Trace to the prize you want — the
  first one your vine touches is yours."
- `solved` still emits the full path; the server decides the reward. No client trust.

### New icons ([data/icons.ts](../src/app/undercity/data/icons.ts))

Add three `24×24` `currentColor` inline SVGs, registered in `UC_SVG_ICONS`:

- `uc-spore` — spores reward (a spore-pod / seed cluster).
- `uc-pouch` — item reward (a drawstring consumable pouch).
- `uc-chest` — gear reward (a treasure chest; reads as "any gear slot" better than a
  single weapon).

### Board-tab wiring

No new routing — `loot_puzzle` already opens the modal and `solve-loot-puzzle` /
`cancel-loot-puzzle` are already wired. The only change is that the masked `puzzle`
view now carries `rewards`, which flows straight through to the component input.

## Balance note

Effective per-category rate becomes `P(category in cache) × P(player routes to it
first)`. Gear may dip slightly below today's flat rate (a present gear isn't always
claimable-first), while a skilled player raises their own ceiling by steering toward
the best present reward. Keep presence odds at today's numbers initially; mirror any
tuned value in the client `data/*.ts` and leave a playtest note, per the
`tune-undercity-balance` skill. The spore forage amount and its Composter perk bonus
are unchanged.

## Data flow (happy path)

1. `move` → land on `loot` → server picks puzzle, rolls presence, places rewards,
   stashes `pendingLoot = {puzzleId, view, rewards}`, returns
   `{type:'loot_puzzle', puzzle:<view with rewards>}`.
2. Client opens the modal; reward icons render on their cells.
3. Player draws a full solution, steering to reach the wanted reward first; the UI
   highlights the claimed one and fades the rest.
4. `solve-loot-puzzle {path}` → server re-validates fill, derives first-hit
   category, rolls that value, clears `pendingLoot`, returns the real `{type:'loot',
   …}` event.
5. Existing reward dialog pops with the claimed reward.

## Error handling & edge cases

- **Refresh / reopen mid-puzzle:** `pendingLoot` (now including `rewards`) lives on
  the doc, so `/game/state` re-offers the exact same board and placements. No reroll.
- **Path that somehow crosses no reward:** impossible under full-fill (every cell is
  covered, and every reward sits on a cell). `first_reward_on_path` returning `None`
  is treated defensively as a spore fallback rather than an error.
- **Double-solve / stale submit:** unchanged — handler requires `pendingLoot`; a
  second submit after clear returns `_err`, no double reward.
- **Client sends a bad path:** unchanged — server rejects with 409.
- **Give up:** unchanged — `cancel-loot-puzzle` drops `pendingLoot`, no reward.

## Testing

Engine (pure):
- `first_reward_on_path` — first-hit ordering across a path; correct kind when the
  wanted reward is reached before others; `None` when no reward cell is on the path.
- `_place_loot_rewards` — places one cell per present kind; cells are distinct,
  non-rock, non-start, non-end; gear cell is never adjacent to start.

DB integration (`infrastructure/lambda/tests/`):
- Landing on `loot` returns `loot_puzzle` with a `rewards` list matching the rolled
  presence; `doc` spores/bag/gear unchanged at this point.
- `solve-loot-puzzle` with a path engineered to hit the **gear** cell first awards
  gear; a path hitting the **spores** cell first awards spores (seed rng for
  determinism, as the existing gear-drop tests do).
- `solve-loot-puzzle` with an invalid path returns an error and leaves `pendingLoot`
  intact.
- `cancel-loot-puzzle` clears `pendingLoot` with no reward.
- Existing `test_flow_puzzles_all_solvable` and map tests untouched and still green.

## Out of scope (YAGNI)

- Procedural puzzle generation / a solver (still using the handmade pack).
- Difficulty scaling with depth.
- More than one of each reward category on a single board.
- Rewarding the player for *how* they solved (path length, speed, etc.).
- Consolation rewards for giving up.

## Touch list

- `infrastructure/lambda/undercity_db.py` — roll presence + `_place_loot_rewards` in
  the `loot` branch of `_resolve_space`; rework `_solve_loot_puzzle` to derive the
  first-hit reward and roll its value; refactor `_award_loot` into per-category
  helpers; add `rewards` to the masked `_flow_puzzle_view` payload.
- `infrastructure/lambda/undercity_engine.py` — `first_reward_on_path`.
- `infrastructure/lambda/tests/` — new engine + integration tests above.
- `src/app/undercity/tabs/flow-puzzle.component.ts` — render reward icons, first-hit
  highlight + fade, drop emoji markers, copy update.
- `src/app/undercity/data/icons.ts` — `uc-spore`, `uc-pouch`, `uc-chest`.
- `src/app/undercity/services/undercity-models.ts` — `rewards` on `FlowPuzzleView`.
- (If a value changes) client `data/*.ts` mirror + balance note.
