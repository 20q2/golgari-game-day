# Overgrown Cache — routing-puzzle redesign

**Status:** design, 2026-07-23
**Feature area:** Undercity loot spaces (the "Overgrown Cache" Flow puzzle)

## Problem / motivation

The current Overgrown Cache is a **Hamiltonian** puzzle: landing on a `loot` node
opens a grid where the player must trace a single line from the green start (🌱)
through *every* non-rock tile to the amber goal (🌾). Reward symbols are scattered on
the grid and the first one the path crosses is awarded. It's a brain-teaser, and the
"fill every tile" requirement is the fiddly part.

We want it to feel like *foraging a route*, not solving a maze:

- **Movement pays.** Every tile you cross grants spores — so a longer, snakier route
  earns more, up to a fair cap.
- **The only requirement is to connect green → amber.** Any simple path counts; no
  more mandatory full coverage.
- **Grab-what-you-cross.** 2–3 item/gear pickups sit on the board; the *first one your
  path touches* is redeemed at the end. Skip them all and you still keep the movement
  spores.

This turns the interaction into a light risk/route decision (beeline for few spores,
or work the board and pick which treasure to hit first) instead of a coverage puzzle.

## Economy constraint (hard requirement)

These spaces must only ever yield **~10 spores** so the loot economy stays fair
(today's floor award is `choice([8,8,9,9,10,10,11,12,13,15])`, avg ~10.5). The new
movement-spore model replaces that floor and is capped so it can never exceed it.

- `FLOW_SPORE_PER_CELL = 0.5`
- `FLOW_SPORE_CAP = 10`
- Award (base) = `min(round(tiles_crossed * FLOW_SPORE_PER_CELL), FLOW_SPORE_CAP)`

Effect: a minimal connecting path (~6–8 tiles) nets ~3–4 spores; snaking a full board
tops out at 10. Scrounger / Composter perks still apply on top of the base (a pest may
land slightly above 10 — consistent with the pest being a spore-gatherer everywhere
else). Item/gear pickups are separate loot, unchanged.

## Design

### Reward model

On landing (`_resolve_space` loot branch):

- Pick a board from `FLOW_PUZZLES` (rock preference no longer matters for difficulty,
  but keeping the current "prefer boards with rocks" pick is fine — rocks add routing
  flavor).
- Place pickups via the existing `_place_loot_rewards(puzzle, kinds, rng)`:
  - `kinds = ['item', 'item']` (two consumable pouches), **plus** `'gear'` appended
    when the existing gear presence roll hits (`_rng.random() < data.GEAR_DROP['loot'][0]`).
  - Result: 2–3 pickups, gear being the rare "varied" one. **No `'spores'` symbol is
    placed** — spores now come from movement, not from a grid cell.
- Stash `pendingLoot = {puzzleId, view, rewards}` exactly as today; return the masked
  `loot_puzzle` event.

On solve (`_solve_loot_puzzle`):

1. Validate the drawn path with the **new** `engine.validate_flow_path` (below).
2. Award movement spores: `min(round(len(path) * FLOW_SPORE_PER_CELL), FLOW_SPORE_CAP)`,
   then apply `_scrounge` + garden Composter bonus (same helpers `_award_spores` uses).
3. Determine the first item/gear the path crossed via the existing
   `engine.first_reward_on_path(rewards, path)`. If one was crossed, award it with the
   existing `_award_item` / `_award_gear`. If none, no item — spores only.
4. Return a `loot` space event carrying the spores and (if any) the item/gear, so the
   existing reward dialog pops.

The event should report both the spores and the item together (the dialog already
renders `spores` + `item`/`gear` fields).

### Server: relaxed validator (pure)

Add to `undercity_engine.py`:

```python
def validate_flow_path(puzzle, path):
    """True iff `path` is a valid single-line route from start to end.

    Same rules as validate_flow_solution EXCEPT full coverage is NOT required:
    non-empty, begins at start, ends at end, every consecutive pair is orthogonally
    adjacent, no cell repeats, no cell is a rock or out of bounds.
    """
    w, h = puzzle['w'], puzzle['h']
    rocks = {tuple(c) for c in puzzle['rocks']}
    start, end = tuple(puzzle['start']), tuple(puzzle['end'])
    if not path:
        return False
    cells = [tuple(c) for c in path]
    for r, c in cells:
        if not (0 <= r < h and 0 <= c < w) or (r, c) in rocks:
            return False
    if cells[0] != start or cells[-1] != end:
        return False
    for (r1, c1), (r2, c2) in zip(cells, cells[1:]):
        if abs(r1 - r2) + abs(c1 - c2) != 1:
            return False
    return len(set(cells)) == len(cells)
```

`validate_flow_solution` (Hamiltonian) and `test_flow_puzzles_all_solvable` stay
untouched — they still prove every packed board is fully solvable, hence trivially
connectable, so no board can be a dead end under the relaxed rule.

### Client (`flow-puzzle.component.ts`)

- **Win condition** `isSolved` → "connected": `path.length >= 2 && first === start &&
  last === end`. (Adjacency / no-revisit / no-rock are already enforced by `extend()`.)
- **Explicit Claim** instead of auto-submit. Today `onUp()` auto-emits the moment the
  puzzle is "solved". Under the relaxed rule that would fire the instant the line
  brushes amber, before the player has routed for spores. Replace with a **"Claim"
  button** enabled once connected; `onUp()` no longer auto-emits.
- **Live feedback:**
  - Running spore tally, e.g. `Spores: 7 / 10`, computed from the current path length
    with the same `min(round(len * 0.5), 10)` formula (mirror the constants).
  - Keep the existing first-crossed-item highlight (`claimedRewardCell` / `isFaded`).
  - Update the copy: from "filling every tile" to something like "Trace a vine from 🌱
    to 🌾 — every tile is spores, and the first treasure you cross is yours."

### Config + mirror

- `undercity_config.py`: `FLOW_SPORE_PER_CELL = 0.5`, `FLOW_SPORE_CAP = 10`.
- Mirror the two constants wherever the client reads balance display values
  (`src/app/undercity/data/*.ts`) so the "Spores: n/10" tally matches the server.

## Files touched

- `infrastructure/lambda/undercity_config.py` — add the two knobs.
- `infrastructure/lambda/undercity_engine.py` — add `validate_flow_path`.
- `infrastructure/lambda/undercity_db.py` — loot-branch placement (drop `spores`
  kind; 2× item + rare gear), `_solve_loot_puzzle` rewrite (movement spores + first
  item), a `_award_flow_spores`-style helper for the capped movement award.
- `infrastructure/lambda/tests/test_undercity_engine.py` — `validate_flow_path` unit
  tests (accepts short connecting path, rejects gap/diagonal/revisit/rock/wrong ends).
- `infrastructure/lambda/tests/test_undercity_db.py` — update loot-puzzle integration
  tests: land → connect a short path → assert capped movement spores + first-item
  award; skip-all-items path → spores only; give-up unchanged.
- `src/app/undercity/tabs/flow-puzzle.component.ts` — connected win condition, Claim
  button, live spore tally, copy.
- `src/app/undercity/services/undercity-models.ts` — no shape change expected
  (`FlowReward`, `FlowPuzzleView.rewards` already exist); confirm during impl.
- Client balance mirror in `src/app/undercity/data/*.ts` — the two spore constants.

## Test / build loop

- Server: `cd infrastructure/lambda && python -m pytest tests -q`
- Client: `npm run build`

## Out of scope / non-goals

- No change to the underlying loot tables (consumable pool, gear drop tiers) — only
  *how many* pickups appear and *how* the player reaches them.
- No new puzzle boards; the existing `FLOW_PUZZLES` pack is reused. Its `solution`
  field and the Hamiltonian validator remain (dead for gameplay, live for the
  solvability guarantee) rather than being deleted from a green suite.
- Multiplayer / PvP unaffected.
