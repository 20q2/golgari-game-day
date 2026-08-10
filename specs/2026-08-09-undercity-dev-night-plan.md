# Undercity Dev Night Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Give the host an admin-panel toggle that makes rolling free for every player on the running night, with no code edit and no deploy of a changed constant.

**Architecture:** A `devMode` boolean on the season CONFIG doc, written by a new host-gated `dev-night` admin cmd. `undercity_db` stamps a request-scoped module global from that CONFIG at the top of both entry points and reads it through one `_free_rolls()` helper, so the roll gate, the roll decrement, and the `you.debug` meta field all honor it without threading `config` through ~70 handlers. The client's `∞` roll UI already keys off `you.debug`, so only the admin panel needs new markup.

**Tech Stack:** Python 3.11 Lambda (no boto3 in rules code), pytest with an in-memory FakeTable, Angular 20 standalone components with signals.

**Spec:** [2026-08-09-undercity-dev-night-design.md](2026-08-09-undercity-dev-night-design.md)

---

## Commit policy for this plan — read first

`infrastructure/lambda/undercity_db.py`, `infrastructure/lambda/tests/test_admin.py`,
and `src/app/undercity/services/undercity-models.ts` are **already modified in the
working tree** by the user's parallel WIP (venom barb, backdated night, per-biome
pools, rested rolls…). `git add`-ing those paths would commit that WIP too.

**Therefore: no task in this plan commits.** Do not run `git add`, `git commit`,
or `git stash` against any file. Leave every change uncommitted and report what
was touched at the end. The user commits and deploys.

## File structure

No new files — every change lands in an existing unit that already owns that
responsibility.

| File | Responsibility | Change |
| --- | --- | --- |
| `infrastructure/lambda/undercity_db.py` | persistence + dispatch | request-scoped flag, `_free_rolls()`, 3 read sites, `dev-night` admin cmd, season block |
| `infrastructure/lambda/tests/test_admin.py` | admin-surface integration tests | 9 new tests |
| `src/app/undercity/services/undercity-models.ts` | `/game/state` payload shapes | `Season.devMode` |
| `src/app/undercity/admin/admin-panel.component.ts` | admin behavior | `devMode` computed + `toggleDevNight()` |
| `src/app/undercity/admin/admin-panel.component.html` | admin markup | one `<section class="admin-section">` |

---

### Task 1: Season flag + `dev-night` admin cmd + state exposure

**Files:**
- Modify: `infrastructure/lambda/undercity_db.py` (after `get_active_season`, ~line 368; season block at 2551-2555; `_ADMIN_CMDS` at 3277-3289)
- Test: `infrastructure/lambda/tests/test_admin.py`

- [ ] **Step 1: Write the failing tests**

Append to `infrastructure/lambda/tests/test_admin.py`:

```python
# ── Dev Night (host-toggled unlimited rolls) ─────────────────────────────────

def test_dev_night_requires_hostkey(table):
    status, resp = _admin(table, 'dev-night', host='nope', on=True)
    assert status == 403
    _, state = db.handle_state(table, {'userId': 'user-host'})
    assert state['season']['devMode'] is False


def test_dev_night_toggles_state_flag(table):
    status, resp = _admin(table, 'dev-night', on=True)
    assert status == 200 and resp['devMode'] is True
    _, state = db.handle_state(table, {'userId': 'user-host'})
    assert state['season']['devMode'] is True

    status, resp = _admin(table, 'dev-night', on=False)
    assert status == 200 and resp['devMode'] is False
    _, state = db.handle_state(table, {'userId': 'user-host'})
    assert state['season']['devMode'] is False


def test_dev_night_defaults_on(table):
    status, resp = _admin(table, 'dev-night')
    assert status == 200 and resp['devMode'] is True


def test_dev_night_is_idempotent(table):
    assert _admin(table, 'dev-night', on=True)[0] == 200
    status, resp = _admin(table, 'dev-night', on=True)
    assert status == 200 and resp['devMode'] is True
```

- [ ] **Step 2: Run the tests to verify they fail**

Run: `cd infrastructure/lambda && python -m pytest tests/test_admin.py -k dev_night -q`
Expected: FAIL — `dev-night` is not in `_ADMIN_CMDS`, so the dispatcher returns
400 `Unknown admin cmd: dev-night` where 200/403 is asserted, and
`state['season']` has no `devMode` key (KeyError).

- [ ] **Step 3: Add the request-scoped flag and its helpers**

In `undercity_db.py`, immediately after `get_active_season` (~line 368):

```python
# ── Dev Night (host-toggled free rolls) ──────────────────────────────────────
# Request-scoped mirror of the running season's `devMode`. Handlers are called as
# (table, sid, doc, payload) and _roll_meta is reached from nearly every
# response, so threading `config` through every one of them to deliver a single
# boolean isn't worth it. Both entry points re-stamp this on every request
# (including the no-season case), and Lambda serves one request at a time per
# container, so a value can never leak between invocations. Read it only through
# _free_rolls().
_DEV_NIGHT = False


def _set_dev_night(config):
    """Stamp the request-scoped Dev Night flag from a season CONFIG doc (or None)."""
    global _DEV_NIGHT
    _DEV_NIGHT = bool((config or {}).get('devMode'))


def _free_rolls():
    """True when a roll costs nothing: the deployed DEBUG constant (local sim and
    tests) or the host's per-night Dev Night toggle."""
    return data.DEBUG or _DEV_NIGHT
```

- [ ] **Step 4: Stamp the flag at both entry points**

In `handle_state`, after `sid, config = _active_season(table)` (line 2412) — before
the `if not sid or not config` early return, so a seasonless request clears it:

```python
    sid, config = _active_season(table)
    _set_dev_night(config)
```

In `handle_action`, clear it right after the payload guard (line 2652) and stamp it
from CONFIG once the season is loaded (line 2660):

```python
    if not atype or not user_id:
        return _err('type and userId are required')
    _set_dev_night(None)   # cleared until this night's CONFIG says otherwise

    if atype == 'season-start':
```

```python
    sid, config = _active_season(table)
    _set_dev_night(config)
```

- [ ] **Step 5: Add the admin command**

In `undercity_db.py`, after `_admin_set_admin` (~line 3178):

```python
def _admin_dev_night(table, sid, payload):
    """Dev Night: flip free rolls for EVERY player on the running night. The flag
    lives on the season CONFIG, so it needs no deploy and dies with the night;
    each request reads it back through _free_rolls(). Reversible, so — unlike the
    one-way boss-awaken — re-sending the same value is a no-op, not an error."""
    on = bool(payload.get('on', True))
    config = _get(table, _season_pk(sid), 'CONFIG')
    if not config:
        return _err('No active night to toggle.', 409)
    table.put_item(Item=dict(config, devMode=on))
    _set_dev_night({'devMode': on})
    return 200, {'ok': True, 'devMode': on}
```

Register it in `_ADMIN_CMDS`, next to the other player-facing toggles:

```python
    'grant-admin': _admin_set_admin,
    'dev-night': _admin_dev_night,
    'bot-step': _admin_bot_step,
```

- [ ] **Step 6: Expose it in the season block**

In `handle_state`'s `out` dict (lines 2551-2555):

```python
        'season': {'seasonId': sid, 'status': config.get('status'),
                   'startedAt': config.get('startedAt'),
                   'launchAt': config.get('launchAt'),
                   'bossPhase': bool(config.get('bossPhase')),
                   'devMode': bool(config.get('devMode'))},
```

- [ ] **Step 7: Run the tests to verify they pass**

Run: `cd infrastructure/lambda && python -m pytest tests/test_admin.py -k dev_night -q`
Expected: PASS — 4 passed.

---

### Task 2: Announce the toggle to players

**Files:**
- Modify: `infrastructure/lambda/undercity_db.py` (`_admin_dev_night`)
- Test: `infrastructure/lambda/tests/test_admin.py`

- [ ] **Step 1: Write the failing test**

Append to `infrastructure/lambda/tests/test_admin.py`:

```python
def test_dev_night_announces_both_ways(table):
    # Players must learn why rolls went free (toast while live, modal on return),
    # so each flip writes a log line AND fans out an away-event.
    assert act(table, 'join', user='user-alex', name='Alex', starter='saproling')[0] == 200
    assert _admin(table, 'dev-night', on=True)[0] == 200
    _, state = db.handle_state(table, {'userId': 'user-alex'})
    assert any('Dev Night engaged' in e['text'] for e in state['events'])
    assert any(e['kind'] == 'host' and 'Dev Night engaged' in e['text']
               for e in state['you']['awayEvents'])

    assert _admin(table, 'dev-night', on=False)[0] == 200
    _, state = db.handle_state(table, {'userId': 'user-alex'})
    assert any('Dev Night over' in e['text'] for e in state['events'])
```

- [ ] **Step 2: Run the test to verify it fails**

Run: `cd infrastructure/lambda && python -m pytest tests/test_admin.py -k announces -q`
Expected: FAIL — `assert any('Dev Night engaged' in e['text'] ...)` is False; the
handler writes no event yet.

- [ ] **Step 3: Write the announcement**

In `_admin_dev_night`, between the `_set_dev_night(...)` call and the return:

```python
    _set_dev_night({'devMode': on})
    text = ('Dev Night engaged — roll costs are off. Go wild.' if on
            else 'Dev Night over — the roll bank is live again.')
    _event(table, sid, 'host', text)
    _broadcast_away(table, sid, {'kind': 'host', 'text': text, 'at': _now()})
    return 200, {'ok': True, 'devMode': on}
```

- [ ] **Step 4: Run the test to verify it passes**

Run: `cd infrastructure/lambda && python -m pytest tests/test_admin.py -k dev_night -q`
Expected: PASS — 5 passed.

---

### Task 3: Free rolls

**Files:**
- Modify: `infrastructure/lambda/undercity_db.py:2770` (`_roll_meta`), `:3627` and `:3699` (`_roll`)
- Test: `infrastructure/lambda/tests/test_admin.py`

- [ ] **Step 1: Write the failing tests**

Append to `infrastructure/lambda/tests/test_admin.py`. `DEBUG` is forced False in
each so the real roll economy is what is under test, and the bank is zeroed
directly on the doc so only Dev Night can pay for a roll:

```python
def _set_bank(table, rolls, user='user-alex'):
    """Force a player's banked rolls and clear any pending move, so the next
    `roll` action is decided purely by the roll economy."""
    sid, _ = db._active_season(table)
    doc = db._get_player(table, sid, user)
    doc['rolls'] = rolls
    doc['pendingMove'] = None
    assert db._put_player(table, doc)


def test_dev_night_makes_rolls_free(table, monkeypatch):
    monkeypatch.setattr(data, 'DEBUG', False)   # the deployed default
    assert act(table, 'join', starter='saproling', home='cavern')[0] == 200

    _set_bank(table, 0)
    status, resp = act(table, 'roll')
    assert status == 409                        # regression: gated while off

    assert _admin(table, 'dev-night', on=True)[0] == 200
    _set_bank(table, 0)
    status, resp = act(table, 'roll')
    assert status == 200
    assert resp['you']['rolls'] == 0            # nothing spent
    assert resp['you']['debug'] is True         # client renders the ∞ button


def test_dev_night_read_from_config_each_request(table, monkeypatch):
    # The flag is a request-scoped global; prove every request re-reads it from
    # CONFIG rather than relying on the one the admin cmd happened to leave set.
    monkeypatch.setattr(data, 'DEBUG', False)
    assert act(table, 'join', starter='saproling', home='cavern')[0] == 200
    assert _admin(table, 'dev-night', on=True)[0] == 200
    for _ in range(3):
        _set_bank(table, 0)
        status, resp = act(table, 'roll')
        assert status == 200 and resp['you']['rolls'] == 0


def test_dev_night_off_restores_roll_cost(table, monkeypatch):
    monkeypatch.setattr(data, 'DEBUG', False)
    assert act(table, 'join', starter='saproling', home='cavern')[0] == 200
    assert _admin(table, 'dev-night', on=True)[0] == 200
    assert _admin(table, 'dev-night', on=False)[0] == 200

    _set_bank(table, 3)
    status, resp = act(table, 'roll')
    assert status == 200
    assert resp['you']['rolls'] == 2            # spending is live again
    assert resp['you']['debug'] is False

    _set_bank(table, 0)
    assert act(table, 'roll')[0] == 409
```

- [ ] **Step 2: Run the tests to verify they fail**

Run: `cd infrastructure/lambda && python -m pytest tests/test_admin.py -k dev_night -q`
Expected: FAIL — `test_dev_night_makes_rolls_free` gets 409 from the second roll
(`No rolls banked`), because `_roll` still reads `data.DEBUG` directly.

- [ ] **Step 3: Read the flag at the three sites**

`undercity_db.py:2770`, in `_roll_meta`:

```python
    meta = {'debug': _free_rolls()}
```

`undercity_db.py:3627`, the roll gate:

```python
    if not _free_rolls() and not is_reroll and doc.get('rolls', 0) < 1:
        return _err('No rolls banked. Finish a board game to earn more!', 409)
```

`undercity_db.py:3699`, the decrement:

```python
    if not _free_rolls() and not is_reroll:
        doc['rolls'] -= 1
```

Leave `undercity_db.py:3652` (`if data.DEBUG and picked is not None`) exactly as
it is — die-face picking is deliberately out of scope and stays `DEBUG`-only.

- [ ] **Step 4: Run the tests to verify they pass**

Run: `cd infrastructure/lambda && python -m pytest tests/test_admin.py -k dev_night -q`
Expected: PASS — 8 passed.

- [ ] **Step 5: Run the whole server suite for regressions**

Run: `cd infrastructure/lambda && python -m pytest tests -q`
Expected: PASS. If a pre-existing failure appears that no step here touched
(the working tree has unrelated WIP), report it — do not fix it.

---

### Task 4: Admin-panel toggle

**Files:**
- Modify: `src/app/undercity/services/undercity-models.ts:4-11`
- Modify: `src/app/undercity/admin/admin-panel.component.ts:1`, `:45-49`, and after `resetAll()`
- Modify: `src/app/undercity/admin/admin-panel.component.html` (new section before "Danger zone")

- [ ] **Step 1: Add the model field**

In `undercity-models.ts`, in the `Season` interface:

```ts
export interface Season {
  seasonId: string;
  status: 'lobby' | 'active' | 'ended';
  startedAt?: string;
  /** Countdown target (ISO-8601) while status is 'lobby'. */
  launchAt?: string;
  bossPhase: boolean;
  /** Host-toggled Dev Night: every player rolls for free. */
  devMode?: boolean;
}
```

- [ ] **Step 2: Add the component state and action**

In `admin-panel.component.ts`, extend the Angular core import on line 1:

```ts
import { Component, OnDestroy, OnInit, computed, inject, signal } from '@angular/core';
```

Add the computed next to `confirmReset` (~line 45):

```ts
  /** Two-tap guard for the destructive full reset. */
  protected readonly confirmReset = signal(false);
  /** Server-reported Dev Night state for the running night. */
  protected readonly devMode = computed(() => this.store.season()?.devMode === true);
```

Add the toggle after `resetAll()`:

```ts
  /**
   * Dev Night: unlimited rolls for every player on the running night. Reversible
   * and destroys nothing, so — unlike resetAll — there's no two-tap arming. The
   * label follows server state, which `admin()` refreshes on success.
   */
  protected toggleDevNight(): void {
    void this.admin('dev-night', { on: !this.devMode() });
  }
```

- [ ] **Step 3: Add the markup**

In `admin-panel.component.html`, insert between the "Session data" section and the
"Danger zone" section:

```html
  <section class="admin-section">
    <h2>Dev Night</h2>
    <p class="hint">
      Every player rolls for free — the roll bank stops being spent and the Roll
      button shows ∞. Nothing else changes: combat, spore costs, cooldowns and
      drops all behave exactly as in a real night. Reversible any time, and it
      ends with the night.
    </p>
    <button (click)="toggleDevNight()" [disabled]="busy() || !hostKey.trim()">
      <mat-icon class="mi">{{ devMode() ? 'stop_circle' : 'all_inclusive' }}</mat-icon>
      {{ devMode() ? 'End Dev Night' : 'Start Dev Night' }}
    </button>
  </section>
```

- [ ] **Step 4: Verify the client compiles**

Run: `npm run build` (from the repo root)
Expected: build succeeds. There is no frontend test runner in this repo, and
`npm run lint` is known-broken — the build is the check.

---

### Task 5: Final verification

- [ ] **Step 1: Full server suite**

Run: `cd infrastructure/lambda && python -m pytest tests -q`
Expected: PASS, including the 8 new `dev_night` tests.

- [ ] **Step 2: Confirm nothing was committed**

Run: `git status --short`
Expected: the five modified files above appear alongside the user's pre-existing
WIP, and nothing is staged. Report the file list; the user commits and deploys
(the Lambda change needs `cdk deploy`, the button needs a frontend deploy).
