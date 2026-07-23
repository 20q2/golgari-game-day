# Undercity — Ladder crossing as a free pause-point

**Date:** 2026-07-23
**Status:** Design — approved, pending implementation plan

## Problem

Rusted ladders (surface ↔ depths descent pairs `<biome>_lt` ↔ `<biome>_lb`, and
the post-boss escape spurs `<biome>_esc`) are the only links between the fixed
surface and each dungeon pocket. Their current crossing UX is broken and, even
when it worked, was fiddly: you had to tap the ladder *disc* on a later roll and
the crossing consumed a movement step. The escape spur used a separate one-off
"tap the spur → offered `_lt` as a teleport destination" path (`escapeClimbTarget`),
so there were two divergent ladder mechanics to maintain.

We want one consistent, obvious ladder mechanic that never wastes a roll.

## Goal

A ladder is a **free pause-point**. Reaching one never costs or wastes movement:

1. **Pause on arrival.** Walking up to a ladder halts you *on* it and opens a
   dialog — every time. Ladders are always reachable (march-up-and-stop, like a
   sealed barrier), so no exact-count landing is required.
2. **Keep your remaining steps.** If you rolled 5 and spent 2 reaching the
   ladder, 3 steps stay banked.
3. **Travel through, or Close.**
   - **Travel through** → relocate *for free* to the ladder's other end, then
     continue walking there with your banked steps.
   - **Close** → stay on this end and continue walking on this side with your
     banked steps.
4. **Chain + terminate.** Reaching another ladder pauses again. When steps reach
   0 you stop wherever you are (a 0-step **Travel through** still crosses for
   free and simply ends the turn on the far side).

This applies to all ladders. Escape spurs fold in: bonk onto `<biome>_esc`,
**Travel through** relocates one-way to the biome's surface mouth `<biome>_lt`,
and you continue on the surface with your banked steps — still gated behind
holding that lair's claim (`poiClaims`).

## Chosen approach: per-segment walks with a relocating checkpoint

Each walk *segment* stays an ordinary single-layer exact-count walk. The ladder
is a checkpoint where the server relocates you (or not) and hands your leftover
steps back as a fresh pending move. The core movement engine
(`engine.legal_destinations` / `engine.validate_walk`) is **not touched**.

**Rejected — zero-cost ladder hops in one continuous path.** Model the
`_lt`↔`_lb` edge (and a virtual directed `_esc`→`_lt` teleport edge) as costing
0 inside a single path, so one roll spans both layers. Cleaner "single walk"
mental model, but it requires surgery on the two most heavily-tested core
movement functions plus a movement-only edge that violates the graph's symmetric
-edge invariant. Not worth the risk for the same player-visible behavior.

## How the roll is preserved (the key mechanism)

Today `_move` clears `pendingMove` and ends the turn's movement once the walk
commits. The change: **landing/bonking on a ladder keeps the movement alive.**

- The client walks locally to the ladder and commits the partial path via the
  normal `move` action (the ladder is a `closed`/stop node, so a bonk landing
  with `hops < value` is a legal walk — see `engine.validate_walk`'s bonk rule).
- Server, on a ladder landing, sets `pendingMove = {value: remaining, dests:
  legal_destinations(ladder, remaining, …)}` where `remaining = value - hops`,
  instead of clearing it. It returns a `ladder` space event carrying the cross
  target.
- Client: `move()` already resets local `stepping` to `null` whenever the server
  leaves `pendingMove` set ([board-tab move()]), and the store effect re-seeds
  the walk from the current position with `pendingMove.value`. So the walk simply
  *resumes* from the ladder with the banked steps — no new client walk plumbing.
- The `ladder` space event opens the dialog. **Close** dismisses it (the walk is
  already resumed on this side). **Travel through** fires a `ladder-cross`
  action that relocates to the far end and re-issues `pendingMove = {value:
  remaining, dests: legal_destinations(far_end, remaining, …)}`, consequence-free.

"Consequence-free" = arriving on the far end does **not** re-resolve its landing
effect. Since the far end of a descent pair is itself a ladder, this is what
stops the dialog from immediately re-opening (no ping-pong). It mirrors the Nyx
Weaver tunnel relocate, which is likewise consequence-free.

## Components

### Server — `undercity_data.py`
- Expose the full set of ladder node ids (all `type == 'ladder'` nodes) for the
  stop set and for cross-target lookup. Descent pairs and escape spurs both
  qualify. `ESCAPE_LADDERS` / `ESCAPE_EXITS` already exist and stay as-is.
- Cross-target rule:
  - Escape spur (`node in ESCAPE_LADDERS`): target = `ESCAPE_EXITS[node]`
    (`<biome>_lt`), **one-way**.
  - Descent ladder: target = the neighbor whose `type == 'ladder'` (the partner:
    `_lt`↔`_lb`).

### Server — `undercity_db.py`
- **Stop set.** Add all ladder nodes to `_closed_barriers` / `_stop_nodes` so a
  walk always halts on them and never corridors through. (Escape spurs are
  already in via `ESCAPE_LADDERS`; descent ladders are the new members.)
- **Ladder landing preserves the roll.** In `_move` / `_resolve_space`, when the
  landing node is a ladder, set `pendingMove` to the banked remainder instead of
  clearing it, and return a `ladder` event: `{type: 'ladder', to: <target|null>,
  oneWay: <bool>, text: …}`. `to` is `null` when no crossing is available (e.g.
  an unclaimed escape spur can't be landed on at all because it stays in
  `_blocked_nodes`, so in practice `to` is always present for a reachable ladder;
  a `null` guard keeps the client defensive).
- **`ladder-cross` action.** New action in the dispatcher:
  - Validate the player is standing on a ladder and a cross target exists.
  - For an escape spur, enforce the claim gate (its lair in `poiClaims`).
  - Relocate `position` to the target. Because the cross is consequence-free it
    bypasses `_resolve_space`, which is where the on-surfacing resets normally
    fire — so replicate them here *when the target is on the surface* (`region !=
    'depths'`): clear `restsUsed` and drop `lastStandUsed`, matching
    `_resolve_space`'s surfacing block. A descent (target in the depths) resets
    nothing.
  - Re-issue `pendingMove = {value: remaining, dests: legal_destinations(target,
    remaining, …)}` from the banked remainder (drop it if `remaining == 0`).
  - Consequence-free: do not chain-resolve the target's landing.
- **Retire** the escape-specific climb branches: the `_roll` block that injects
  `ESCAPE_EXITS[pos]` into `dests`, and the `_move` block that special-cases
  `prev in ESCAPE_LADDERS and to == ESCAPE_EXITS[prev]`. Escape now flows through
  `ladder-cross` like every other ladder.

### Client — `board-tab.component.ts`
- Add ladders to `stepClosedIds()` (client stop set) so the local walk bonk-stops
  on every ladder, not just degree-1 spurs.
- `commitStep()`: generalize `escapeStop` → any `type === 'ladder'` node
  auto-commits on arrival (the walk halts, `move` fires, server banks the
  remainder).
- **Retire** `escapeClimbTarget()`, the escape-climb branch in `onTapNode()`, and
  the escape-climb choice-injection in `syncBoard()`.
- Ladder space-event modal: add a **Travel through** action button (shown when
  `ev.to` is present) that dispatches `ladder-cross`, plus a **Close** button.
  Modeled on the existing `world_event` two-button block in
  `board-tab.component.html`. Tapping a ladder you're already standing on
  (start-of-turn, having paused there earlier) re-opens the same modal.

### Client — `board-canvas.ts`
- **Retire** the `ladderPartner` map, the tap-redirect (tap a ladder whose
  partner is a choice → cross), and the partner-based disc-lighting. Crossing is
  now driven entirely by the modal, so the canvas no longer needs ladder-specific
  tap or highlight logic. Keep the vestige/skull badge and the layer-follow
  (view swaps to the destination layer after a cross, via the existing
  own-token-layer follow).

### Client — `board-movement.ts`
- No change. `legalSteps` already treats `closed` nodes as valid bonk stops, so
  listing ladders as closed makes them always-reachable pause points for free.

## Data flow (descent example)

1. On the surface, 2 hops from `cavern_lt`, player rolls 5 → `pendingMove
   {value: 5, dests}`.
2. Player taps toward the ladder; local walk bonk-stops on `cavern_lt` after 2
   hops (`cavern_lt` is closed). Client fires `move` with the 3-node path.
3. Server: landing is a ladder → `position = cavern_lt`, `pendingMove = {value: 3,
   dests: legal_destinations(cavern_lt, 3)}`, returns `{type:'ladder', to:
   'cavern_lb', oneWay:false, text}`.
4. Client re-seeds the walk from `cavern_lt` (3 steps) and opens the ladder modal.
5. **Travel through** → `ladder-cross`: `position = cavern_lb`, `pendingMove =
   {value: 3, dests: legal_destinations(cavern_lb, 3)}`, consequence-free. View
   follows the token into the depths.
6. Player walks the remaining 3 steps through the dungeon; a normal landing there
   resolves as usual (or pauses again on another ladder).

## Testing (`tests/test_deep_dungeons.py`, `tests/test_map.py`)

- **Stop set:** every ladder node is in `_closed_barriers` / `_stop_nodes`; a
  walk toward a ladder can land on it at any hop count and never corridors past.
- **Roll preserved:** landing on a ladder with steps remaining leaves
  `pendingMove.value == remaining` (not cleared) with dests recomputed from the
  ladder.
- **Descent cross:** `ladder-cross` on `<biome>_lt` relocates to `<biome>_lb`
  (and vice-versa) for free, preserves the banked steps, and is consequence-free
  (no re-resolve, no immediate re-pause).
- **0-step cross:** `ladder-cross` with `remaining == 0` relocates and cleanly
  ends the turn (no lingering `pendingMove`).
- **Escape cross:** `ladder-cross` on `<biome>_esc` relocates one-way to
  `<biome>_lt`, is claim-gated (rejected without the lair in `poiClaims`), and an
  unclaimed spur stays in `_blocked_nodes` (can't be landed on at all).
- **Retired paths:** the old `_roll`/`_move` escape-teleport branches are gone;
  escape crossing is exercised only through `ladder-cross`.
- **Reachability unchanged:** the raw-graph maze BFS
  (`test_maze_is_large_dark_and_complete`) still passes — edges are untouched.
- Keep the map-sync lint green; no map.json node/edge changes are required.

## Non-goals / invariants preserved

- No new graph edges; edge symmetry (`test_neighbors_symmetric_and_known`) holds.
- Lair distance-from-mouth (≥6 hops) unchanged — ladders add no shortcut into a
  lair; escape stays strictly one-way out.
- No environmental combat damage; unrelated systems untouched.
- Season-shared lair pools and the sigil-claim reward flow are read-only here.
