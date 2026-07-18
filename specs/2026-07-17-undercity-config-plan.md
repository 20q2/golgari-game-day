# Undercity Config File, Roll Regen & DEBUG Gating — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** One tunables-only config file for the Undercity, a new timed roll-regen mechanic, and a single server `DEBUG` flag that gates unlimited rolls + pick-your-roll on both server and client.

**Architecture:** New `infrastructure/lambda/undercity_config.py` re-exported via `from undercity_config import *` in `undercity_data.py` so all `data.X` references (and test monkeypatches) keep working. Roll regen is lazy (computed on read/action), mirroring the existing `regen_hp` pattern in `undercity_engine.py`. The server injects `debug` + `nextRollAt` into every `you` payload; the Angular client renders dev tools only when the server says so.

**Tech Stack:** Python 3.11 Lambda + pytest (in-memory FakeTable), Angular 20 standalone components with signals.

**Spec:** `specs/2026-07-17-undercity-config-design.md`

**Test command (backend):** `cd infrastructure/lambda && python -m pytest tests -q` — keep it green after every task.
**Build check (frontend):** `npm run build` from repo root (lint is broken in this repo; verify with build).

---

### Task 1: Create `undercity_config.py`, rewire `undercity_data.py`, rename `UNLIMITED_ROLLS` → `DEBUG`

**Files:**
- Create: `infrastructure/lambda/undercity_config.py`
- Modify: `infrastructure/lambda/undercity_data.py` (lines ~374-377, ~488-514, ~662-664)
- Modify: `infrastructure/lambda/undercity_db.py:1098-1130` (three `data.UNLIMITED_ROLLS` refs)
- Modify: `infrastructure/lambda/tests/test_undercity_db.py:96,196,204` (monkeypatches)
- Modify: `src/app/undercity/tabs/board-tab.component.html:10-11` (stale TODO comment — full rewrite comes in Task 4)
- Modify: `CLAUDE.md` (balance-numbers bullet)

This is a pure refactor — the existing suite is the safety net. No new tests in this task.

- [ ] **Step 1: Run the suite to confirm a green baseline**

Run: `cd infrastructure/lambda && python -m pytest tests -q`
Expected: all pass.

- [ ] **Step 2: Create `infrastructure/lambda/undercity_config.py`**

```python
"""
Undercity tunables — the one file to edit when balancing the game.

Every constant here is re-exported through undercity_data (via
`from undercity_config import *`), so code and tests keep referencing
`data.ROLL_CAP` etc. Weighted tables (dig loot, shop stock, mystery
events, NPC pools) stay in undercity_data.py — this file is scalars only.
"""

# ── Debug ────────────────────────────────────────────────────────────────────
# True: rolling never checks or spends banked rolls, and the client may pick
# the exact die face (the client shows its dev tools when the server reports
# this flag). Flip to False and `cdk deploy` before game night.
DEBUG = True

# ── Roll economy ─────────────────────────────────────────────────────────────
ROLL_CAP = 6
JOIN_ROLLS = 3
SEAL_BONUS_CAP = 3
ROLL_REGEN_MINUTES = 10      # +1 banked roll per N minutes, up to ROLL_CAP
CLAIM_FINISHED_ROLLS = 2
CLAIM_WON_BONUS_ROLLS = 1
CLAIM_WON_SPORES = 10
CLAIM_FINISHED_COOLDOWN_MIN = 15
CLAIM_TAUGHT_ROLLS = 1
CLAIM_TAUGHT_MAX = 2
POKE_ROLL_LIMIT = 3          # first N pokes received per night grant +1 roll

# ── HP / death / PvP ─────────────────────────────────────────────────────────
HP_REGEN_PCT = 0.10          # of max HP
HP_REGEN_INTERVAL_MIN = 10
COMPOST_SHIELD_MIN = 15
COMPOST_RESPAWN_PCT = 0.5
PVP_SPORE_STEAL = 0.25
PVP_SPORE_STEAL_DEFEND = 0.10
DEATHRITE_STEAL_MULT = 1.5

# ── Facilities ───────────────────────────────────────────────────────────────
SHOP_REFRESH_MIN = 30        # bazaar restock window (minutes); the client's
                             # vendor rotation mirrors this — see BAZAAR_KEEPERS
                             # in board-tab.component.ts
SHOP_GEAR_SLOTS = 3          # gear lines offered per refresh (distinct slots)
SHOP_CONSUMABLE_SLOTS = 3    # consumable lines per refresh (>=1 in-battle)
SHOP_GRIMOIRE_SLOTS = 2      # tier-1 grimoires per refresh (never deplete)
SHRINE_BLESSING_COST = 15
SHRINE_TITHE_HP_PCT = 0.25
OSSUARY_MAX_BET = 20
OSSUARY_ROLLS_PER_VISIT = 3  # gambles allowed per landing; refills when you land again
SNARE_SPILL_PCT = 0.20
```

- [ ] **Step 3: Rewire `undercity_data.py`**

3a. Add the re-export just below the existing imports (after `from pathlib import Path`):

```python
# Tunables (roll economy, debug flag, facility knobs) live in their own file
# so balancing never means digging through this one. Re-exported so everything
# keeps reading `data.ROLL_CAP` etc.
from undercity_config import *  # noqa: F401,F403
```

3b. Delete the now-duplicated scalar definitions from `undercity_data.py`:
- `SHOP_REFRESH_MIN`, `SHOP_GEAR_SLOTS`, `SHOP_CONSUMABLE_SLOTS`, `SHOP_GRIMOIRE_SLOTS` (~lines 374-377) — keep any surrounding table definitions.
- The whole "Roll economy" scalar block (~lines 491-514): `ROLL_CAP` through `SNARE_SPILL_PCT`. Keep the `# ── Barriers & points of interest` section that follows.
- The `UNLIMITED_ROLLS = True` line and its two-line TODO comment (~lines 662-664).

- [ ] **Step 4: Rename the flag in `undercity_db.py`**

In `_roll` (three spots, lines ~1098-1130), replace `data.UNLIMITED_ROLLS` with `data.DEBUG` and update the stale comment:

```python
def _roll(table, sid, doc, payload):
    if not data.DEBUG and doc.get('rolls', 0) < 1:
        return _err('No rolls banked. Finish a board game to earn more!', 409)
```

```python
    # Dev convenience (DEBUG only): the client may name the face it wants
    # instead of rolling randomly. Skips loaded-die / vines so the picked
    # number is exactly what moves you.
    picked = payload.get('value') if payload else None
    picked = int(picked) if isinstance(picked, (int, float)) and 1 <= picked <= 6 else None

    value = None
    if data.DEBUG and picked is not None:
        value = picked
```

```python
    if not data.DEBUG:
        doc['rolls'] -= 1
```

- [ ] **Step 5: Update test monkeypatches**

In `infrastructure/lambda/tests/test_undercity_db.py`, replace all three `monkeypatch.setattr(data, 'UNLIMITED_ROLLS', ...)` with `monkeypatch.setattr(data, 'DEBUG', ...)` (lines 96, 196, 204). Also rename the two tests to match:
- `test_roll_picks_exact_face_when_unlimited` → `test_roll_picks_exact_face_in_debug`
- `test_roll_pick_ignored_when_rolls_are_limited` → `test_roll_pick_ignored_when_debug_off`

Then grep to confirm nothing else references the old name:

Run: `cd infrastructure/lambda && grep -rn UNLIMITED_ROLLS .`
Expected: no matches.

- [ ] **Step 6: Update docs**

In `CLAUDE.md`, Undercity section, change the balance-numbers bullet to:

```markdown
- **Balance numbers**: scalar tunables (roll economy, debug flag, facility knobs) live in `infrastructure/lambda/undercity_config.py`; weighted tables (loot, shop stock, evolution) stay in `undercity_data.py`. Display mirrors are duplicated in `src/app/undercity/data/*.ts` — if you tune server numbers, update those mirrors.
```

- [ ] **Step 7: Run the suite**

Run: `cd infrastructure/lambda && python -m pytest tests -q`
Expected: all pass.

- [ ] **Step 8: Commit**

```bash
git add infrastructure/lambda/undercity_config.py infrastructure/lambda/undercity_data.py infrastructure/lambda/undercity_db.py infrastructure/lambda/tests/test_undercity_db.py CLAUDE.md
git commit -m "refactor(undercity): extract tunables into undercity_config.py, UNLIMITED_ROLLS -> DEBUG"
```

---

### Task 2: `engine.regen_rolls` (pure function, TDD)

**Files:**
- Modify: `infrastructure/lambda/undercity_engine.py` (below `regen_hp`, ~line 531)
- Test: `infrastructure/lambda/tests/test_undercity_engine.py` (Regen section, ~line 220)

- [ ] **Step 1: Write the failing tests**

Add `regen_rolls` to the import list at the top of `test_undercity_engine.py` (it currently imports `regen_hp`), then append to the Regen section:

```python
def test_roll_regen_one_per_interval_keeps_partial_progress():
    p = {'rolls': 1, 'rollRegenAt': '2026-07-17T20:00:00'}
    regen_rolls(p, '2026-07-17T20:25:00')
    assert p['rolls'] == 3                              # 2 full 10-min intervals
    assert p['rollRegenAt'] == '2026-07-17T20:20:00'    # 5 leftover minutes kept


def test_roll_regen_caps_at_roll_cap():
    p = {'rolls': 5, 'rollRegenAt': '2026-07-17T20:00:00'}
    regen_rolls(p, '2026-07-17T23:00:00')
    assert p['rolls'] == 6                              # data.ROLL_CAP


def test_roll_regen_seeds_missing_timestamp():
    p = {'rolls': 2}
    regen_rolls(p, '2026-07-17T20:00:00')
    assert p['rolls'] == 2
    assert p['rollRegenAt'] == '2026-07-17T20:00:00'


def test_roll_regen_advances_clock_while_at_cap():
    # No hidden stockpile: the timestamp moves even when nothing is granted.
    p = {'rolls': 6, 'rollRegenAt': '2026-07-17T20:00:00'}
    regen_rolls(p, '2026-07-17T21:00:00')
    assert p['rolls'] == 6
    assert p['rollRegenAt'] == '2026-07-17T21:00:00'


def test_roll_regen_noop_within_interval():
    p = {'rolls': 1, 'rollRegenAt': '2026-07-17T20:00:00'}
    regen_rolls(p, '2026-07-17T20:09:59')
    assert p['rolls'] == 1
    assert p['rollRegenAt'] == '2026-07-17T20:00:00'
```

- [ ] **Step 2: Run them to verify they fail**

Run: `cd infrastructure/lambda && python -m pytest tests/test_undercity_engine.py -q -k roll_regen`
Expected: ImportError (`regen_rolls` not defined).

- [ ] **Step 3: Implement `regen_rolls`**

In `undercity_engine.py`, directly below `regen_hp` (same section, same style):

```python
def regen_rolls(player: dict, now_iso: str) -> None:
    """Bank +1 roll per full ROLL_REGEN_MINUTES since rollRegenAt, lazily,
    capped at ROLL_CAP. The timestamp advances by whole intervals only, so
    partial progress toward the next roll is never lost — and it advances
    even at cap, so a full bank doesn't stockpile hidden progress."""
    last = player.get('rollRegenAt')
    if not last:
        player['rollRegenAt'] = now_iso
        return
    minutes = (_parse_iso(now_iso) - _parse_iso(last)).total_seconds() / 60
    intervals = int(minutes // data.ROLL_REGEN_MINUTES)
    if intervals <= 0:
        return
    player['rolls'] = min(data.ROLL_CAP, player.get('rolls', 0) + intervals)
    advanced = _parse_iso(last) + timedelta(minutes=intervals * data.ROLL_REGEN_MINUTES)
    player['rollRegenAt'] = advanced.strftime(_ISO)
```

(`_parse_iso`, `_ISO`, `timedelta`, and `data` are already available in that module.)

- [ ] **Step 4: Run tests to verify they pass**

Run: `cd infrastructure/lambda && python -m pytest tests/test_undercity_engine.py -q`
Expected: all pass.

- [ ] **Step 5: Commit**

```bash
git add infrastructure/lambda/undercity_engine.py infrastructure/lambda/tests/test_undercity_engine.py
git commit -m "feat(undercity): timed roll regen engine function"
```

---

### Task 3: Wire regen + `debug`/`nextRollAt` into the DB layer

**Files:**
- Modify: `infrastructure/lambda/undercity_db.py` — `_new_player_doc` (~line 1005), `handle_action` (~line 692), `handle_state` (~lines 537-542), `_ok` (~line 725)
- Test: `infrastructure/lambda/tests/test_undercity_db.py`

- [ ] **Step 1: Write the failing tests**

Append to `test_undercity_db.py` (uses the existing `table`, `act`, `_sid` helpers):

```python
# ── Roll regen & debug reporting ─────────────────────────────────────────────

def test_roll_regen_grants_via_action_path(table, monkeypatch):
    monkeypatch.setattr(data, 'DEBUG', False)
    act(table, 'join', starter='pest')
    sid = _sid(table)
    doc = db._get_player(table, sid, 'user-alex')
    doc['rolls'] = 0
    doc['rollRegenAt'] = '2020-01-01T00:00:00'      # ages ago -> regen to cap
    db._put_player(table, doc)
    status, resp = act(table, 'roll')               # would 409 without regen
    assert status == 200
    assert resp['you']['rolls'] == data.ROLL_CAP - 1


def test_state_reports_debug_and_next_roll(table, monkeypatch):
    monkeypatch.setattr(data, 'DEBUG', False)
    act(table, 'join', starter='pest')              # 3+1 seal rolls < cap of 6
    status, state = db.handle_state(table, {'userId': 'user-alex'})
    assert status == 200
    assert state['you']['debug'] is False
    assert state['you']['nextRollAt'] > state['you']['rollRegenAt']


def test_next_roll_hidden_at_cap(table, monkeypatch):
    monkeypatch.setattr(data, 'DEBUG', False)
    act(table, 'join', starter='pest')
    sid = _sid(table)
    doc = db._get_player(table, sid, 'user-alex')
    doc['rolls'] = data.ROLL_CAP
    db._put_player(table, doc)
    status, state = db.handle_state(table, {'userId': 'user-alex'})
    assert 'nextRollAt' not in state['you']


def test_action_response_carries_debug_flag(table, monkeypatch):
    monkeypatch.setattr(data, 'DEBUG', True)
    status, resp = act(table, 'join', starter='pest')
    assert status == 200
    assert resp['you']['debug'] is True
```

- [ ] **Step 2: Run them to verify they fail**

Run: `cd infrastructure/lambda && python -m pytest tests/test_undercity_db.py -q -k "regen or debug or next_roll"`
Expected: the four new tests FAIL (KeyError `debug` / `nextRollAt`, or 409 on roll).

- [ ] **Step 3: Implement the wiring**

3a. `_new_player_doc` — seed the timestamp next to `hpUpdatedAt` (~line 1005):

```python
        'hpUpdatedAt': _now(),
        'rollRegenAt': _now(),
```

3b. `handle_action` — regen rolls next to HP regen (~line 692):

```python
    engine.regen_hp(doc, _now())
    engine.regen_rolls(doc, _now())
    _expire_buffs(doc)
```

3c. `handle_state` — same for the display path (~line 537):

```python
            engine.regen_hp(item, now)  # display-only; persisted on next action
            engine.regen_rolls(item, now)
```

3d. New helper next to `_ok` (~line 725), and inject into both `you` views:

```python
def _roll_meta(doc):
    """Debug flag + next regen tick, injected into every `you` view so the
    client can gate its dev tools and show a next-roll countdown."""
    meta = {'debug': data.DEBUG}
    if doc.get('rolls', 0) < data.ROLL_CAP and doc.get('rollRegenAt'):
        nxt = engine._parse_iso(doc['rollRegenAt']) + timedelta(minutes=data.ROLL_REGEN_MINUTES)
        meta['nextRollAt'] = nxt.strftime('%Y-%m-%dT%H:%M:%S')
    return meta


def _ok(doc, **extra):
    you = {k: v for k, v in doc.items() if k not in ('pk', 'sk')}
    you.update(_roll_meta(doc))
    return 200, {'ok': True, 'you': you, **extra}
```

And in `handle_state` (~line 542):

```python
            if item['userId'] == user_id:
                you = {k: v for k, v in item.items() if k not in ('pk', 'sk')}
                you.update(_roll_meta(item))
```

- [ ] **Step 4: Run the full backend suite**

Run: `cd infrastructure/lambda && python -m pytest tests -q`
Expected: all pass (including the four new tests).

- [ ] **Step 5: Commit**

```bash
git add infrastructure/lambda/undercity_db.py infrastructure/lambda/tests/test_undercity_db.py
git commit -m "feat(undercity): wire roll regen + debug/nextRollAt into state and actions"
```

---

### Task 4: Client — debug-gated roll UI + next-roll countdown

**Files:**
- Modify: `src/app/undercity/services/undercity-models.ts` (`YouDoc`, ~line 85)
- Modify: `src/app/undercity/tabs/board-tab.component.ts` (~lines 637-656)
- Modify: `src/app/undercity/tabs/board-tab.component.html` (roll strip, lines 4-26)
- Modify: `src/app/undercity/tabs/board-tab.component.scss` (one new class)

No frontend test runner exists in this repo — verification is `npm run build` plus manual check.

- [ ] **Step 1: Extend `YouDoc`**

In `undercity-models.ts`, after `rolls: number;` (~line 85):

```typescript
  /** Server DEBUG flag — when true the client shows dev tools (pick-your-roll, ∞ rolls). */
  debug?: boolean;
  /** ISO time the next timed roll banks; absent while at the roll cap. */
  nextRollAt?: string;
  rollRegenAt?: string;
```

- [ ] **Step 2: Add helpers to `board-tab.component.ts`**

Next to `showRollPicker` (~line 640) — `computed` is already imported in this file:

```typescript
  /** Server-reported DEBUG flag: gates the pick-a-face tool and the ∞ label. */
  protected readonly debugMode = computed(() => !!this.store.you()?.debug);
  protected readonly rollsBanked = computed(() => this.store.you()?.rolls ?? 0);

  /** Minute-granularity countdown to the next timed roll (null at cap / in debug).
   * Re-evaluated on state polls, same approach as bazaarRestockLabel(). */
  protected nextRollLabel(): string | null {
    const at = this.store.you()?.nextRollAt;
    if (!at || this.debugMode()) return null;
    const min = Math.max(1, Math.ceil((new Date(at + 'Z').getTime() - Date.now()) / 60_000));
    return min <= 1 ? 'under a minute' : `${min} min`;
  }
```

Also update the doc comment on `showRollPicker` from "Dev-mode picker (unlimited rolls)" to "Debug picker (server DEBUG flag): choose the exact die face 1–6."

- [ ] **Step 3: Rewrite the roll strip in `board-tab.component.html`**

Replace lines 9-26 (the roll button + pick button block, including both TODO comments) with:

```html
    @if (!rolling() && !store.you()?.pendingMove) {
      <button
        class="uc-btn uc-btn-primary roll-btn"
        [disabled]="busy() || (!debugMode() && rollsBanked() < 1)"
        (click)="roll()"
      >
        <img class="die-icon" src="undercity/icons/die.png" alt="" />
        Roll ({{ debugMode() ? '∞' : rollsBanked() }})
      </button>
      @if (debugMode()) {
        <button class="uc-btn pick-btn" [disabled]="busy()" (click)="showRollPicker.set(!showRollPicker())">
          <mat-icon class="mi">casino</mat-icon> Pick
        </button>
        @if (showRollPicker()) {
          <div class="roll-picker">
            @for (n of [1, 2, 3, 4, 5, 6]; track n) {
              <button class="uc-btn pick-face" [disabled]="busy()" (click)="roll(n)">{{ n }}</button>
            }
          </div>
        }
      }
      @if (nextRollLabel(); as nrl) {
        <span class="next-roll-hint">next roll in {{ nrl }}</span>
      }
    }
```

- [ ] **Step 4: Style the hint**

In `board-tab.component.scss`, inside the `.roll-strip` block (match the file's existing token usage):

```scss
  .next-roll-hint {
    font-size: 0.75rem;
    opacity: 0.75;
    align-self: center;
    white-space: nowrap;
  }
```

- [ ] **Step 5: Build**

Run (via Bash — npm is broken under PowerShell in this repo): `npm run build`
Expected: compiles with no errors.

- [ ] **Step 6: Commit**

```bash
git add src/app/undercity/services/undercity-models.ts src/app/undercity/tabs/board-tab.component.ts src/app/undercity/tabs/board-tab.component.html src/app/undercity/tabs/board-tab.component.scss
git commit -m "feat(undercity): debug-gated roll UI with banked-roll count and regen countdown"
```

---

### Final verification

- [ ] `cd infrastructure/lambda && python -m pytest tests -q` — green.
- [ ] `npm run build` — green.
- [ ] Grep for leftovers: `grep -rn "UNLIMITED_ROLLS" infrastructure src` → no matches.
- [ ] Note to user: flipping `DEBUG` (or any tunable) requires `cdk deploy` from `infrastructure/` — **user runs deploys himself**; do not deploy.
