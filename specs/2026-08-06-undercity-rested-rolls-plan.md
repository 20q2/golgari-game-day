# Rested Rolls Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Lower the active roll cap and convert the overflow the game currently discards into a net-neutral "rested" pool that pays back at double the regen rate.

**Architecture:** Time-based roll regen (`engine.regen_rolls`) becomes tick-by-tick. When the roll bank is full, a tick banks `ROLLS_PER_REGEN` into a new per-player `rested` field (capped at `RESTED_CAP`) instead of discarding it; when there's room and rested is available, a tick pays out double and draws the extra from rested. First-time-joiner seeding keeps the old cap-and-discard behavior so latecomers don't stockpile rested. The client surfaces `rested` (which already flows through the `you` payload) as a small indicator; the payout is fully automatic.

**Tech Stack:** Python 3.11 Lambda (pure engine functions + in-memory FakeTable pytest suite); Angular 20 standalone client.

Design doc: [specs/2026-08-06-undercity-rested-rolls-design.md](2026-08-06-undercity-rested-rolls-design.md)

---

## File Structure

- **Modify** `infrastructure/lambda/undercity_config.py` — `ROLL_CAP` 15→10, add `RESTED_CAP`.
- **Modify** `infrastructure/lambda/undercity_engine.py` — rewrite `regen_rolls` (tick-by-tick, `bank_rested` flag).
- **Modify** `infrastructure/lambda/undercity_db.py` — `_seed_night_rolls` passes `bank_rested=False`; `_roll_meta` shows the countdown while rested is still filling.
- **Create** `infrastructure/lambda/tests/test_undercity_rested.py` — the rested-mechanic unit suite.
- **Modify** `src/app/undercity/services/undercity-models.ts` — add `rested?: number` to the `you` interface.
- **Modify** `src/app/undercity/tabs/board-tab.component.ts` + `.html` — a `restedRolls` computed and a small band-status indicator.

Run the Python suite from `infrastructure/lambda`: `python -m pytest tests -q`.
Verify the client with a build (lint is known-broken in this repo): `npm run build`.

---

### Task 1: Config — lower the cap, add the rested ceiling

**Files:**
- Modify: `infrastructure/lambda/undercity_config.py:17` and `:22-24`

- [ ] **Step 1: Edit the roll-economy block**

In `undercity_config.py`, change `ROLL_CAP` and add `RESTED_CAP` directly beneath the regen knobs:

```python
# ── Roll economy ─────────────────────────────────────────────────────────────
ROLL_CAP = 10                # active roll bank ceiling (~1.7h of tempo before overflow)
JOIN_ROLLS = 3
BRAVERY_BONUS_ROLLS = 1      # extra starting rolls for hatching a random creature
SHINY_HATCH_CHANCE = 0.05    # chance a hatched creature is shiny — purely cosmetic
                             # (a gold sparkle over its sprite + a hatch-log call-out)
ROLL_REGEN_MINUTES = 30      # regen tick length in minutes, up to ROLL_CAP
ROLLS_PER_REGEN = 3          # rolls banked each tick (3 rolls every 30 minutes)
RESTED_CAP = 15              # overflow protection, in rolls (~5 "stacks" of 3). At cap,
                             # a tick banks ROLLS_PER_REGEN here; below cap a tick pays
                             # DOUBLE and draws the extra from rested — net-neutral until
                             # this ceiling. Client shows it; payout is automatic.
ROLL_NUDGE_THRESHOLD = 3     # push "rolls ready" when idle rolls regen up to this
```

`RESTED_CAP` is re-exported as `data.RESTED_CAP` via the `from undercity_config import *` at the top of `undercity_data.py`, matching `ROLL_CAP`.

- [ ] **Step 2: Verify the constant is reachable**

Run: `cd infrastructure/lambda && python -c "import undercity_data as d; print(d.ROLL_CAP, d.RESTED_CAP)"`
Expected: `10 15`

- [ ] **Step 3: Commit**

```bash
git add infrastructure/lambda/undercity_config.py
git commit -m "feat(undercity): lower ROLL_CAP to 10, add RESTED_CAP"
```

---

### Task 2: Engine — rewrite `regen_rolls` tick-by-tick

The new function banks overflow into `rested` and pays it back at double. A `bank_rested` flag (default `True`) lets the join-seed path opt out (Task 3). Write the tests first.

**Files:**
- Create: `infrastructure/lambda/tests/test_undercity_rested.py`
- Modify: `infrastructure/lambda/undercity_engine.py:924-940`

- [ ] **Step 1: Write the failing tests**

Create `infrastructure/lambda/tests/test_undercity_rested.py`:

```python
"""Rested-rolls mechanic — unit tests over engine.regen_rolls (no table needed)."""
from datetime import datetime, timedelta

import undercity_data as data
import undercity_engine as engine


def _player(rolls, rested=0, base='2020-01-01T00:00:00'):
    return {'rolls': rolls, 'rested': rested, 'rollRegenAt': base}


def _later(base, ticks):
    """ISO string `ticks` full regen intervals after `base`."""
    t = datetime.fromisoformat(base) + timedelta(
        minutes=ticks * data.ROLL_REGEN_MINUTES)
    return t.strftime('%Y-%m-%dT%H:%M:%S')


def test_at_cap_banks_rested_instead_of_discarding():
    p = _player(rolls=data.ROLL_CAP, rested=0)
    engine.regen_rolls(p, _later(p['rollRegenAt'], 2))
    assert p['rolls'] == data.ROLL_CAP
    assert p['rested'] == 2 * data.ROLLS_PER_REGEN


def test_below_cap_with_rested_pays_double_and_draws_rested():
    # One tick below cap with rested available delivers 2x and burns a tick's worth.
    p = _player(rolls=1, rested=data.ROLLS_PER_REGEN)
    engine.regen_rolls(p, _later(p['rollRegenAt'], 1))
    assert p['rolls'] == 1 + 2 * data.ROLLS_PER_REGEN
    assert p['rested'] == 0


def test_doubled_tick_overshoot_pushes_back_into_rested():
    # rolls one below cap, rested available: gain would overshoot; the excess is
    # banked back to rested, never lost.
    p = _player(rolls=data.ROLL_CAP - 1, rested=data.ROLLS_PER_REGEN)
    before_total = p['rolls'] + p['rested']
    engine.regen_rolls(p, _later(p['rollRegenAt'], 1))
    assert p['rolls'] == data.ROLL_CAP
    # net gain over the tick is exactly one tick's regen — nothing evaporated
    assert p['rolls'] + p['rested'] == before_total + data.ROLLS_PER_REGEN


def test_rested_clamps_at_cap():
    # Very long absence: rolls fill, then rested fills, then everything is pinned.
    p = _player(rolls=0, rested=0)
    engine.regen_rolls(p, _later(p['rollRegenAt'], 999))
    assert p['rolls'] == data.ROLL_CAP
    assert p['rested'] == data.RESTED_CAP


def test_net_neutral_over_spend_then_refill():
    # Bank some rested at cap, spend rolls down, then regen the same number of
    # ticks: total rolls delivered equals plain regen (no gain, no loss).
    p = _player(rolls=data.ROLL_CAP, rested=0)
    engine.regen_rolls(p, _later(p['rollRegenAt'], 3))      # bank 3 ticks of rested
    assert p['rested'] == 3 * data.ROLLS_PER_REGEN
    spent = 3 * data.ROLLS_PER_REGEN
    p['rolls'] -= spent                                     # simulate spending
    base2 = p['rollRegenAt']
    engine.regen_rolls(p, _later(base2, 3))                 # refill 3 ticks
    # back to exactly where we were before spending — net-neutral
    assert p['rolls'] == data.ROLL_CAP
    assert p['rested'] == 3 * data.ROLLS_PER_REGEN


def test_timestamp_advances_by_whole_intervals_only():
    base = '2020-01-01T00:00:00'
    p = _player(rolls=0, rested=0, base=base)
    # 2.5 intervals elapse; only 2 whole ticks apply and the stamp advances by 2.
    almost = datetime.fromisoformat(base) + timedelta(
        minutes=int(2.5 * data.ROLL_REGEN_MINUTES))
    engine.regen_rolls(p, almost.strftime('%Y-%m-%dT%H:%M:%S'))
    assert p['rollRegenAt'] == _later(base, 2)


def test_bank_rested_false_restores_cap_and_discard():
    # The join-seed path opts out: overflow past the cap is discarded, no rested.
    p = _player(rolls=0, rested=0)
    engine.regen_rolls(p, _later(p['rollRegenAt'], 999), bank_rested=False)
    assert p['rolls'] == data.ROLL_CAP
    assert p['rested'] == 0
```

- [ ] **Step 2: Run the tests to verify they fail**

Run: `cd infrastructure/lambda && python -m pytest tests/test_undercity_rested.py -q`
Expected: FAIL — several assertions fail (current `regen_rolls` discards overflow, never sets `rested`, and rejects the `bank_rested` keyword with a `TypeError`).

- [ ] **Step 3: Rewrite `regen_rolls`**

Replace the body of `regen_rolls` in `undercity_engine.py` (currently lines 924-940) with:

```python
def regen_rolls(player: dict, now_iso: str, bank_rested: bool = True) -> None:
    """Bank ROLLS_PER_REGEN rolls per full ROLL_REGEN_MINUTES since rollRegenAt,
    lazily, capped at ROLL_CAP. Overflow past the cap banks into `rested` (up to
    RESTED_CAP); when the bank has room and rested is available, a tick pays out
    DOUBLE and draws the extra from rested — so being away is net-neutral in total
    rolls until rested hits its ceiling. The timestamp advances by whole intervals
    only, so partial progress toward the next tick is never lost, and it advances
    even when fully maxed so a full bank doesn't stockpile hidden progress.

    bank_rested=False restores the legacy cap-and-discard behaviour — used when
    seeding a first-time joiner's bank from the night start, so latecomers get a
    full bank but no rested stockpile."""
    last = player.get('rollRegenAt')
    if not last:
        player['rollRegenAt'] = now_iso
        return
    minutes = (_parse_iso(now_iso) - _parse_iso(last)).total_seconds() / 60
    intervals = int(minutes // data.ROLL_REGEN_MINUTES)
    if intervals <= 0:
        return
    rolls = player.get('rolls', 0)
    rested = player.get('rested', 0)
    per, cap, rcap = data.ROLLS_PER_REGEN, data.ROLL_CAP, data.RESTED_CAP
    for _ in range(intervals):
        if rolls >= cap:
            if not bank_rested or rested >= rcap:
                break            # maxed (or legacy mode) — remaining ticks are no-ops
            rested = min(rcap, rested + per)
        else:
            gain = per
            if bank_rested and rested > 0:
                bonus = min(rested, per)   # the "double": up to 2x this tick
                gain += bonus
                rested -= bonus
            new_rolls = rolls + gain
            if new_rolls > cap:
                if bank_rested:
                    rested = min(rcap, rested + (new_rolls - cap))
                rolls = cap        # legacy mode discards the overshoot
            else:
                rolls = new_rolls
    player['rolls'] = rolls
    player['rested'] = rested
    advanced = _parse_iso(last) + timedelta(minutes=intervals * data.ROLL_REGEN_MINUTES)
    player['rollRegenAt'] = advanced.strftime(_ISO)
```

- [ ] **Step 4: Run the tests to verify they pass**

Run: `cd infrastructure/lambda && python -m pytest tests/test_undercity_rested.py -q`
Expected: PASS (7 passed).

- [ ] **Step 5: Commit**

```bash
git add infrastructure/lambda/undercity_engine.py infrastructure/lambda/tests/test_undercity_rested.py
git commit -m "feat(undercity): rested-roll overflow banking in regen_rolls"
```

---

### Task 3: Join-seed opts out of rested

`_seed_night_rolls` anchors a first-time joiner's bank to the night start and calls `regen_rolls`. With Task 2 that would hand latecomers a full `rested` stockpile — a hidden bonus we don't want. Pass `bank_rested=False`.

**Files:**
- Modify: `infrastructure/lambda/undercity_db.py:3194-3204`
- Test: `infrastructure/lambda/tests/test_undercity_rested.py` (append)

- [ ] **Step 1: Write the failing test**

Append to `infrastructure/lambda/tests/test_undercity_rested.py`:

```python
from tests.test_undercity_db import table, act, _sid  # noqa: E402
import undercity_db as db  # noqa: E402


def test_late_joiner_fills_bank_but_gets_no_rested(table):
    # Backdate the season so a joiner would have accrued well past both ceilings.
    cfg = db._get(table, db._season_pk(_sid(table)), 'CONFIG')
    old = datetime.fromisoformat(cfg['startedAt']) - timedelta(hours=12)
    cfg['startedAt'] = old.strftime('%Y-%m-%dT%H:%M:%S')
    table.put_item(Item=cfg)

    _, resp = act(table, 'join', starter='pest')
    you = resp['you']
    assert you['rolls'] == data.ROLL_CAP
    assert you.get('rested', 0) == 0        # seeding must NOT stockpile rested
```

Note: importing `table`/`act`/`_sid` from `tests.test_undercity_db` reuses the existing FakeTable fixtures, exactly as `test_undercity_nest_eggs.py` does.

- [ ] **Step 2: Run the test to verify it fails**

Run: `cd infrastructure/lambda && python -m pytest tests/test_undercity_rested.py::test_late_joiner_fills_bank_but_gets_no_rested -q`
Expected: FAIL — `rested` comes back as `RESTED_CAP` (15), not 0.

- [ ] **Step 3: Pass `bank_rested=False` in the seed**

In `undercity_db.py`, in `_seed_night_rolls`, change the regen call:

```python
    if started:
        doc['rollRegenAt'] = started
        engine.regen_rolls(doc, _now(), bank_rested=False)
```

- [ ] **Step 4: Run the test to verify it passes**

Run: `cd infrastructure/lambda && python -m pytest tests/test_undercity_rested.py::test_late_joiner_fills_bank_but_gets_no_rested -q`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add infrastructure/lambda/undercity_db.py infrastructure/lambda/tests/test_undercity_rested.py
git commit -m "feat(undercity): late-join seeding skips rested stockpiling"
```

---

### Task 4: Countdown keeps ticking while rested fills

`_roll_meta` only emits `nextRollAt` while `rolls < ROLL_CAP`. Once the bank is full but `rested` is still filling, the client would show no countdown even though a rested tick is imminent. Extend the condition.

**Files:**
- Modify: `infrastructure/lambda/undercity_db.py:2647-2654`
- Test: `infrastructure/lambda/tests/test_undercity_rested.py` (append)

- [ ] **Step 1: Write the failing test**

Append to `infrastructure/lambda/tests/test_undercity_rested.py`:

```python
def test_roll_meta_shows_countdown_while_rested_still_filling():
    # Full bank, rested below its cap, regen anchored → countdown should appear.
    doc = {'rolls': data.ROLL_CAP, 'rested': 0,
           'rollRegenAt': '2020-01-01T00:00:00'}
    meta = db._roll_meta(doc)
    assert 'nextRollAt' in meta

    # Full bank AND rested maxed → nothing left to accrue, no countdown.
    doc2 = {'rolls': data.ROLL_CAP, 'rested': data.RESTED_CAP,
            'rollRegenAt': '2020-01-01T00:00:00'}
    assert 'nextRollAt' not in db._roll_meta(doc2)
```

- [ ] **Step 2: Run the test to verify it fails**

Run: `cd infrastructure/lambda && python -m pytest tests/test_undercity_rested.py::test_roll_meta_shows_countdown_while_rested_still_filling -q`
Expected: FAIL — `nextRollAt` absent in the first case (bank is full).

- [ ] **Step 3: Extend the `_roll_meta` guard**

In `undercity_db.py`, `_roll_meta`, replace the guard so a full bank with room in rested still reports the next tick:

```python
def _roll_meta(doc):
    """Debug flag + next regen tick, injected into every `you` view so the
    client can gate its dev tools and show a next-roll countdown. The countdown
    keeps running while the bank is full but `rested` is still filling — that
    tick banks a rested stack rather than a roll."""
    meta = {'debug': data.DEBUG}
    still_accruing = (doc.get('rolls', 0) < data.ROLL_CAP
                      or doc.get('rested', 0) < data.RESTED_CAP)
    if still_accruing and doc.get('rollRegenAt'):
        nxt = engine._parse_iso(doc['rollRegenAt']) + timedelta(minutes=data.ROLL_REGEN_MINUTES)
        meta['nextRollAt'] = nxt.strftime('%Y-%m-%dT%H:%M:%S')
    return meta
```

- [ ] **Step 4: Run the test to verify it passes**

Run: `cd infrastructure/lambda && python -m pytest tests/test_undercity_rested.py::test_roll_meta_shows_countdown_while_rested_still_filling -q`
Expected: PASS.

- [ ] **Step 5: Run the full Python suite (guard against the ROLL_CAP change)**

Run: `cd infrastructure/lambda && python -m pytest tests -q`
Expected: PASS. If any pre-existing test hardcoded the old cap of 15 (rather than referencing `data.ROLL_CAP`), update that literal to match the new value or the `data.ROLL_CAP` constant — do not change engine behavior to satisfy a stale literal.

- [ ] **Step 6: Commit**

```bash
git add infrastructure/lambda/undercity_db.py infrastructure/lambda/tests/test_undercity_rested.py
git commit -m "feat(undercity): keep roll countdown while rested is still filling"
```

---

### Task 5: Client — model field + rested indicator

`rested` already flows to the client (the `you` payload spreads every doc field in `_ok`), so this task is purely display: type it, and show it beside the roll counter. No button — payout is automatic.

**Files:**
- Modify: `src/app/undercity/services/undercity-models.ts:151` (near `rollRegenAt`)
- Modify: `src/app/undercity/tabs/board-tab.component.ts:1706`
- Modify: `src/app/undercity/tabs/board-tab.component.html:78-82`

- [ ] **Step 1: Add the model field**

In `undercity-models.ts`, immediately after the `rollRegenAt?: string;` line, add:

```typescript
  /** Rested rolls (in rolls, not "stacks"): overflow banked past the roll cap.
   * While > 0 and the bank has room, each timed tick pays DOUBLE and draws this
   * down. Server-owned; the client only displays it. */
  rested?: number;
```

- [ ] **Step 2: Add the computed in the board tab**

In `board-tab.component.ts`, directly below the `rollsBanked` computed (line 1706), add:

```typescript
  /** Rested rolls banked past the cap (server-owned; display only). */
  protected readonly restedRolls = computed(() => this.store.you()?.rested ?? 0);
```

- [ ] **Step 3: Show the indicator in the action band**

In `board-tab.component.html`, extend the band-status region (lines 78-82) so rested shows when present:

```html
  <app-uc-action-band>
    <!-- Roll-regen cooldown: its own small status line pinned to the band's top-left -->
    @if (nextRollLabel(); as nrl) {
      <div class="band-status">new rolls in {{ nrl }}</div>
    }
    @if (restedRolls() > 0) {
      <div class="band-status band-status-rested"
           title="Rested rolls — your next timed rolls come in twice as fast until spent.">
        <mat-icon class="mi">bedtime</mat-icon> {{ restedRolls() }} rested
      </div>
    }
```

`mat-icon` and the `mi` class are already used throughout this template (e.g. the reroll button), so no new imports are needed. `bedtime` is a stock Material icon — consistent with the no-emoji symbol rule.

- [ ] **Step 4: Verify the client builds**

Run: `npm run build`
Expected: build succeeds (Angular compiles the template + type). Lint is known-broken in this repo — do not rely on it.

- [ ] **Step 5: Commit**

```bash
git add src/app/undercity/services/undercity-models.ts src/app/undercity/tabs/board-tab.component.ts src/app/undercity/tabs/board-tab.component.html
git commit -m "feat(undercity): show rested rolls in the board action band"
```

---

### Task 6: Full verification pass

- [ ] **Step 1: Python suite green**

Run: `cd infrastructure/lambda && python -m pytest tests -q`
Expected: PASS (all tests, including the new `test_undercity_rested.py`).

- [ ] **Step 2: Client build green**

Run: `npm run build`
Expected: build succeeds.

- [ ] **Step 3: Manual sanity (optional, via the run-undercity skill)**

Drive the game to a full roll bank and confirm: overflow accrues as a "N rested" indicator, and after spending rolls the next ticks refill twice as fast while the indicator drains. The `run-undercity` skill covers the dev server + live-backend prerequisites.

Deployment is the user's responsibility — end here with tests + build green and note that a deploy (backend `cdk deploy` for the engine/config/db changes, plus a frontend deploy) is needed for the change to go live. The server balance changes (`ROLL_CAP`, `RESTED_CAP`) and their client display are already mirror-consistent; there is no separate numeric mirror file to update for this feature.

---

## Self-Review

**Spec coverage:**
- Lower `ROLL_CAP` to 10, add `RESTED_CAP` → Task 1. ✓
- Tick-by-tick `regen_rolls` with at-cap banking, doubled below-cap payout, overshoot push-back, early break → Task 2. ✓
- Net-neutral invariant + `RESTED_CAP` ceiling exception → Task 2 tests (`test_net_neutral_over_spend_then_refill`, `test_rested_clamps_at_cap`). ✓
- Direct grants (`_add_rolls`) unchanged / out of scope → not touched by any task (verified by leaving `_add_rolls` alone); no task modifies it. ✓
- Latecomer seeding must not stockpile rested (design "regen-only" nuance) → Task 3. ✓
- Countdown UX while rested fills → Task 4. ✓
- Client model + rolls-denominated indicator, automatic (no button), no emoji → Task 5. ✓
- Tests enumerated in the design (at-cap bank, double payout, overshoot, clamp, net-neutral, timestamp discipline) → all present in Task 2, plus seed + meta tests. ✓

**Placeholder scan:** No TBD/TODO; every code step shows complete code. ✓

**Type/name consistency:** `regen_rolls(player, now_iso, bank_rested=True)` signature is used identically in Tasks 2, 3. `rested` field name consistent across engine, db, model, and component. `RESTED_CAP`/`ROLL_CAP`/`ROLLS_PER_REGEN` referenced by name everywhere. Client computed `restedRolls()` matches its single template use. ✓
