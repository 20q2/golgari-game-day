# Undercity — Forage recharges by distance, not time

**Date:** 2026-08-07
**Status:** Implemented (TDD, tests green) — uncommitted, awaiting user commit/deploy

## Problem

The forage companion ability ("Send scavenging") sits on a **20-minute real-time
cooldown** (`PET_ABILITY_COOLDOWN_MIN['forage'] = 20`, shrinking with level). A
real clock forces players to keep returning to the app to re-trigger it — bad for
a game meant to be played in bursts of active movement. We want forage to reward
*movement* instead of *waiting*.

Scope is **forage only**. The scout ability keeps its 30-minute timer. The true
"economy" pets (Broodspinner / Slime) are untouched — they already accrue by
movement (Spores per loot space passed).

## Mechanic

Forage recharges by **distance walked**, as a simple countdown that lives on the
player doc:

- A player has a `forageRecharge` counter (spaces remaining before forage is ready).
- **Using forage** sets `forageRecharge = PET_FORAGE_RECHARGE_SPACES` (`6`, flat —
  does not scale with level).
- **Every move** decrements it by the number of board nodes traversed that walk
  (`len(path) - 1`), clamped at `0`: `forageRecharge = max(0, forageRecharge - steps)`.
- Forage is **ready** when `forageRecharge <= 0` (or the field is absent / never used).

Cumulative across turns — every space moved counts down, regardless of turn
boundaries. A lucky roll of 6+ in one turn *can* recharge it in a single move;
that's intended (it rewards SPD / speed builds). "Spaces left" shown to the
player = the current `forageRecharge` value.

Leveling forage still raises its Spore payout (`PET_MOUSE_SPORES_PER_LVL`), so
leveling stays worthwhile even though the recharge distance is flat.

## Server changes (`infrastructure/lambda/`)

- **`undercity_config.py`**: add `PET_FORAGE_RECHARGE_SPACES = 6`. Leave
  `PET_ABILITY_COOLDOWN_MIN` etc. in place — scout still uses them.
- **`undercity_db.py`**:
  - Forage "ready" check no longer consults `petCooldowns['forage']`; it checks
    `doc.get('forageRecharge', 0) <= 0`. Scout keeps the timestamp path
    (`_pet_cd_ready` / `_start_pet_cooldown` unchanged for scout).
  - On a successful forage use, set `doc['forageRecharge'] = PET_FORAGE_RECHARGE_SPACES`
    instead of starting a real-time cooldown.
  - In `_move`, after resolving the walk, decrement:
    `doc['forageRecharge'] = max(0, doc.get('forageRecharge', 0) - steps)` where
    `steps = len(path) - 1` (guard `if path`, mirroring the economy-scavenge block
    that already lives in `_move`). Freemove (admin) does not count.
  - `forageRecharge` reaches the client automatically — `_ok` serializes the whole
    doc as `you`.
- **`undercity_data.py`** (client mirror note): scout-cooldown display stat for
  forage becomes a distance stat.

## Client changes (`src/app/undercity/`)

- **`data/pets.ts`**: mirror `PET_FORAGE_RECHARGE_SPACES = 6`. The forage stat row
  (currently "Cooldown: X min") becomes "Recharge: 6 spaces". Update the forage
  blurb to note it recharges as you move.
- **`tabs/creature-tab.component`**: the forage button already has its own branch.
  When not ready it shows `"{{ forageSpacesLeft() }} spaces"` instead of `"N min"`.
  `forageSpacesLeft()` reads `store.you()?.forageRecharge ?? 0`. Readiness for
  forage reads the same field (`<= 0`); scout readiness is unchanged.

## Tests (`infrastructure/lambda/tests/test_undercity_companions.py`)

Rewrite the forage-cooldown tests to the distance model:

1. Fresh forage is usable (no `forageRecharge`).
2. After use, `forageRecharge == 6` and forage is not ready.
3. Move fewer than 6 spaces total → still not ready, counter decremented.
4. Move to a cumulative ≥ 6 (across one or more turns) → counter clamps at 0,
   forage ready again.
5. Scout still uses its real-time cooldown (regression guard — unchanged).

Keep the in-memory FakeTable suite green: `cd infrastructure/lambda && python -m pytest tests -q`.

## Out of scope

- Scout timer (unchanged, still 30 min).
- Economy pets (already movement-based).
- Any change to forage's payout table.
