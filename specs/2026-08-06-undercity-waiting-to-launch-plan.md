# "Waiting to Launch" Lobby — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add a host-controlled pre-game "Waiting to launch" season state with a client-side countdown, so curious early arrivals see a timer instead of a dead screen or a live game they're missing.

**Architecture:** A new season `status` value `lobby` (config also carries a `launchAt` ISO timestamp). The action dispatcher already blocks all gameplay for any non-`active` status, so a `lobby` season locks players out for free. A new `season-lobby` host action opens the lobby; `season-start` is taught to promote an existing lobby into the live night in place. The frontend adds a `lobby` phase with a full-screen countdown and a host-panel control (rendered inside the admin panel) to set the target time.

**Tech Stack:** Python 3.11 Lambda (`undercity_db.py`, in-memory-FakeTable pytest suite), Angular 20 standalone components + signals.

Design spec: [specs/2026-08-06-undercity-waiting-to-launch-design.md](2026-08-06-undercity-waiting-to-launch-design.md)

---

## File Structure

- `infrastructure/lambda/undercity_db.py` — new `_season_lobby` action + route; `_season_start` promotion branch; `launchAt` in the state `season` block.
- `infrastructure/lambda/tests/test_undercity_lobby.py` — **new** test module (imports `FakeTable`, `act` from `test_undercity_db`).
- `src/app/undercity/services/undercity-models.ts` — `Season` interface gains `lobby` status + `launchAt`.
- `src/app/undercity/undercity-page.component.ts` — `lobby` phase, ticking `nowMs` signal, `launchCountdown` computed.
- `src/app/undercity/undercity-page.component.html` — `@case ('lobby')` full-screen view.
- `src/app/undercity/host/host-panel.component.ts` — `openLobby()` + target-time field.
- `src/app/undercity/host/host-panel.component.html` — "Waiting to launch" control block.
- `src/app/undercity/host/host-panel.component.scss` — (no new rules expected; reuse existing classes).

**Testing note:** There is no JS/Angular test runner in this repo (`ng test` is not wired up). Backend tasks are TDD with pytest. Frontend tasks are verified with `npm run build` (a dev build that type-checks the whole app) — treat a clean build as the pass condition. Do **not** run `npm run lint` (known-broken in this repo).

---

## Task 1: Backend — `season-lobby` action + `lobby` status

**Files:**
- Test: `infrastructure/lambda/tests/test_undercity_lobby.py` (create)
- Modify: `infrastructure/lambda/undercity_db.py` (add `_season_lobby`, route it, add `launchAt` to the state block)

- [ ] **Step 1: Write the failing tests**

Create `infrastructure/lambda/tests/test_undercity_lobby.py`:

```python
"""Integration tests for the 'Waiting to launch' lobby season state."""
import sys
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parents[1]))

import undercity_db as db
from test_undercity_db import FakeTable, act  # noqa: E402

LAUNCH = '2026-08-06T19:30:00Z'


def test_season_lobby_creates_lobby_and_reports_launch_at():
    t = FakeTable()
    status, resp = act(t, 'season-lobby', hostKey='swampking', launchAt=LAUNCH)
    assert status == 200
    assert resp['ok'] is True and resp['launchAt'] == LAUNCH
    sid, config = db._active_season(t)
    assert config['status'] == 'lobby'
    # State exposes the countdown target to the client.
    status, state = db.handle_state(t, {'userId': 'user-alex'})
    assert status == 200
    assert state['season']['status'] == 'lobby'
    assert state['season']['launchAt'] == LAUNCH


def test_lobby_blocks_gameplay_actions():
    t = FakeTable()
    act(t, 'season-lobby', hostKey='swampking', launchAt=LAUNCH)
    status, resp = act(t, 'join', starter='saproling', home='cavern')
    assert status == 409
    status, resp = act(t, 'roll')
    assert status == 409


def test_season_lobby_refused_while_night_active():
    t = FakeTable()
    act(t, 'season-start', hostKey='swampking')  # night is live
    status, resp = act(t, 'season-lobby', hostKey='swampking', launchAt=LAUNCH)
    assert status == 409
    # The active night is untouched.
    _, config = db._active_season(t)
    assert config['status'] == 'active'


def test_season_lobby_resubmit_updates_time_same_season():
    t = FakeTable()
    act(t, 'season-lobby', hostKey='swampking', launchAt=LAUNCH)
    sid1, _ = db._active_season(t)
    later = '2026-08-06T20:15:00Z'
    status, resp = act(t, 'season-lobby', hostKey='swampking', launchAt=later)
    assert status == 200
    sid2, config = db._active_season(t)
    assert sid2 == sid1  # same lobby, pushed back
    assert config['launchAt'] == later


def test_season_lobby_wrong_passphrase_is_403():
    t = FakeTable()
    act(t, 'season-lobby', hostKey='swampking', launchAt=LAUNCH)
    status, resp = act(t, 'season-lobby', hostKey='intruder', launchAt=LAUNCH)
    assert status == 403


def test_season_lobby_requires_valid_launch_at():
    t = FakeTable()
    status, resp = act(t, 'season-lobby', hostKey='swampking', launchAt='not-a-date')
    assert status == 400
    status, resp = act(t, 'season-lobby', hostKey='swampking')
    assert status == 400
```

- [ ] **Step 2: Run the tests to verify they fail**

Run: `cd infrastructure/lambda && python -m pytest tests/test_undercity_lobby.py -q`
Expected: FAIL — `season-lobby` is an unknown action (the dispatcher falls through to "No active season" 409 or an unknown-type error), and `launchAt` is absent from the state block.

- [ ] **Step 3: Add the `_season_lobby` implementation**

In `infrastructure/lambda/undercity_db.py`, add this function immediately **after** `_season_start` (which ends at the `return 200, {'ok': True, 'seasonId': sid}` around line 2799):

```python
def _season_lobby(table, payload):
    """
    Host "Waiting to launch": open (or re-time) a pre-game lobby. The season is
    registered as CURRENT with status='lobby' and a `launchAt` countdown target,
    but every gameplay action stays blocked by the active-status gate — curious
    early arrivals only see the countdown. `season-start` later promotes this
    same season into the live night. Re-submitting while already in lobby just
    pushes the target time; refuses outright if a night is already running.
    """
    host_key = (payload.get('hostKey') or '').strip()
    if not host_key:
        return _err('hostKey required')
    launch_at = (payload.get('launchAt') or '').strip()
    if not launch_at:
        return _err('launchAt required')
    try:
        datetime.fromisoformat(launch_at.replace('Z', '+00:00'))
    except ValueError:
        return _err('launchAt must be an ISO-8601 timestamp')

    sid_old, config_old = _active_season(table)
    if config_old and config_old.get('hostKey') and config_old.get('hostKey') != host_key:
        return _err('Wrong host passphrase.', 403)
    if config_old and config_old.get('status') == 'active':
        return _err('A night is already running — end it before opening a lobby.', 409)

    # Reuse a waiting lobby's id (and its pre-generated maps); otherwise mint fresh.
    if config_old and config_old.get('status') == 'lobby':
        sid = sid_old
    else:
        sid = datetime.utcnow().strftime('%Y%m%d-%H%M%S')
        if data.PROCEDURAL_DUNGEONS:
            table.put_item(Item={'pk': _season_pk(sid), 'sk': 'MAP',
                                 'depths': mapgen.generate_all_depths(sid)})
    table.put_item(Item={'pk': _season_pk(sid), 'sk': 'CONFIG',
                         'status': 'lobby', 'hostKey': host_key,
                         'launchAt': launch_at, 'bossPhase': False})
    table.put_item(Item={'pk': META_PK, 'sk': 'CURRENT', 'seasonId': sid})
    _event(table, sid, 'season', 'The gates are sealed. The night begins soon…')
    return 200, {'ok': True, 'seasonId': sid, 'launchAt': launch_at}
```

- [ ] **Step 4: Route the new action**

In `handle_action`, add the route immediately after the `season-start` route (currently lines 2538–2539), so it runs **before** the active-status gate:

```python
    if atype == 'season-start':
        return _season_start(table, payload)

    if atype == 'season-lobby':
        return _season_lobby(table, payload)
```

- [ ] **Step 5: Expose `launchAt` in the state response**

In `handle_state`, the `season` block is built around line 2438. Add `launchAt`:

```python
        'season': {'seasonId': sid, 'status': config.get('status'),
                   'startedAt': config.get('startedAt'),
                   'launchAt': config.get('launchAt'),
                   'bossPhase': bool(config.get('bossPhase'))},
```

- [ ] **Step 6: Run the tests to verify they pass**

Run: `cd infrastructure/lambda && python -m pytest tests/test_undercity_lobby.py -q`
Expected: PASS (all 6 tests). `test_season_lobby_refused_while_night_active` and the promotion in Task 2 rely on `season-start` behavior — the "refused while active" test passes now because the active check returns 409 before any write.

- [ ] **Step 7: Commit**

```bash
git add infrastructure/lambda/undercity_db.py infrastructure/lambda/tests/test_undercity_lobby.py
git commit -m "feat(undercity): season-lobby action + lobby status"
```

---

## Task 2: Backend — `season-start` promotes a waiting lobby

**Files:**
- Test: `infrastructure/lambda/tests/test_undercity_lobby.py` (add one test)
- Modify: `infrastructure/lambda/undercity_db.py` (`_season_start`)

- [ ] **Step 1: Write the failing test**

Append to `infrastructure/lambda/tests/test_undercity_lobby.py`:

```python
def test_season_start_promotes_lobby_in_place():
    t = FakeTable()
    act(t, 'season-lobby', hostKey='swampking', launchAt=LAUNCH)
    sid_lobby, _ = db._active_season(t)
    status, resp = act(t, 'season-start', hostKey='swampking')
    assert status == 200
    sid_active, config = db._active_season(t)
    assert sid_active == sid_lobby          # same season, promoted in place
    assert config['status'] == 'active'
    assert config.get('startedAt')          # start time stamped
    # A player can now actually join the promoted night.
    status, resp = act(t, 'join', starter='saproling', home='cavern')
    assert status == 200
```

- [ ] **Step 2: Run it to verify it fails**

Run: `cd infrastructure/lambda && python -m pytest tests/test_undercity_lobby.py::test_season_start_promotes_lobby_in_place -v`
Expected: FAIL — current `_season_start` ignores the `lobby` status: it falls through to minting a **fresh** season id (so `sid_active != sid_lobby`).

- [ ] **Step 3: Add the promotion branch to `_season_start`**

In `_season_start`, after the passphrase check and before the `if config_old and config_old.get('status') == 'active':` archive branch, insert the lobby-promotion branch. The function becomes:

```python
def _season_start(table, payload):
    host_key = (payload.get('hostKey') or '').strip()
    if not host_key:
        return _err('hostKey required')
    sid_old, config_old = _active_season(table)
    if config_old and config_old.get('hostKey') != host_key:
        return _err('Wrong host passphrase.', 403)

    # Promote a waiting "lobby" season into the live night in place: keep the
    # same id and its pre-generated maps, just flip status and stamp startedAt.
    if config_old and config_old.get('status') == 'lobby':
        table.put_item(Item=dict(config_old, status='active', startedAt=_now()))
        _event(table, sid_old, 'season',
               'A new night falls on the Undercity. The swarm stirs…')
        return 200, {'ok': True, 'seasonId': sid_old}

    if config_old and config_old.get('status') == 'active':
        # Archive the running night without ceremony before starting fresh.
        _archive_season(table, sid_old, config_old)

    sid = datetime.utcnow().strftime('%Y%m%d-%H%M%S')
    table.put_item(Item={'pk': _season_pk(sid), 'sk': 'CONFIG',
                         'status': 'active', 'hostKey': host_key,
                         'startedAt': _now(), 'bossPhase': False})
    table.put_item(Item={'pk': META_PK, 'sk': 'CURRENT', 'seasonId': sid})
    if data.PROCEDURAL_DUNGEONS:
        # Fresh mazes for the night; _season_map reads this record all night.
        table.put_item(Item={'pk': _season_pk(sid), 'sk': 'MAP',
                             'depths': mapgen.generate_all_depths(sid)})
    _event(table, sid, 'season',
           'A new night falls on the Undercity. The swarm stirs…')
    return 200, {'ok': True, 'seasonId': sid}
```

(Only the lobby-promotion branch is new; the rest is the existing body, unchanged.)

- [ ] **Step 4: Run the full lobby suite to verify pass**

Run: `cd infrastructure/lambda && python -m pytest tests/test_undercity_lobby.py -q`
Expected: PASS (7 tests).

- [ ] **Step 5: Run the whole backend suite to guard against regressions**

Run: `cd infrastructure/lambda && python -m pytest tests -q`
Expected: PASS (the pre-existing suite stays green — `season-start` behavior is unchanged for the no-season / ended / active paths).

- [ ] **Step 6: Commit**

```bash
git add infrastructure/lambda/undercity_db.py infrastructure/lambda/tests/test_undercity_lobby.py
git commit -m "feat(undercity): season-start promotes a waiting lobby in place"
```

---

## Task 3: Frontend — `Season` model

**Files:**
- Modify: `src/app/undercity/services/undercity-models.ts` (lines 4–9)

- [ ] **Step 1: Update the `Season` interface**

Replace the existing interface:

```ts
export interface Season {
  seasonId: string;
  status: 'active' | 'ended';
  startedAt?: string;
  bossPhase: boolean;
}
```

with:

```ts
export interface Season {
  seasonId: string;
  status: 'lobby' | 'active' | 'ended';
  startedAt?: string;
  /** Countdown target (ISO-8601) while status is 'lobby'. */
  launchAt?: string;
  bossPhase: boolean;
}
```

- [ ] **Step 2: Verify the build type-checks**

Run: `npm run build`
Expected: build succeeds (no type errors). It is fine for the new `lobby` status to be unused until Task 5.

- [ ] **Step 3: Commit**

```bash
git add src/app/undercity/services/undercity-models.ts
git commit -m "feat(undercity): Season model gains lobby status + launchAt"
```

---

## Task 4: Frontend — host-panel "Waiting to launch" control

**Files:**
- Modify: `src/app/undercity/host/host-panel.component.ts`
- Modify: `src/app/undercity/host/host-panel.component.html`

- [ ] **Step 1: Add lobby state + action to the component**

In `host-panel.component.ts`, add a `seasonLobby` computed and a `launchLocal` field alongside the existing signals, and an `openLobby()` method. Insert after the `bossAwake` computed (line 32):

```ts
  protected readonly inLobby = computed(() => this.store.season()?.status === 'lobby');
  /** Bound to the <input type="datetime-local"> — a local wall-clock string. */
  protected launchLocal = '';
```

Add this method after `startNight()`:

```ts
  /** Open (or re-time) the pre-game lobby with a countdown to a target clock time. */
  async openLobby(): Promise<void> {
    if (!this.launchLocal) {
      this.message.set('Pick a start time first.');
      return;
    }
    // datetime-local has no timezone; interpret it as local, send UTC ISO.
    const launchAt = new Date(this.launchLocal).toISOString();
    await this.run(async () => {
      localStorage.setItem(HOST_KEY_STORAGE, this.hostKey);
      await this.store.action('season-lobby', { hostKey: this.hostKey, launchAt });
      this.message.set('Lobby open — players see the countdown. Press New Night to begin.');
    });
  }
```

- [ ] **Step 2: Add the control block to the template**

In `host-panel.component.html`, inside the `@if (!seasonActive()) {` branch (which currently holds only the "New Night" button, lines 16–23), add the lobby control **above** the New Night button so it reads top-to-bottom (set time → open lobby → New Night promotes it). Replace lines 16–23:

```html
        @if (!seasonActive()) {
          <button
            class="uc-btn uc-btn-primary"
            [disabled]="busy() || !hostKey.trim()"
            (click)="startNight()"
          >
            <mat-icon class="mi">dark_mode</mat-icon> New Night
          </button>
        } @else {
```

with:

```html
        @if (!seasonActive()) {
          <div class="lobby-row">
            <input
              class="host-input"
              type="datetime-local"
              [(ngModel)]="launchLocal"
              aria-label="Launch time"
            />
            <button
              class="uc-btn"
              [disabled]="busy() || !hostKey.trim()"
              (click)="openLobby()"
            >
              <mat-icon class="mi">hourglass_top</mat-icon>
              {{ inLobby() ? 'Update start time' : 'Waiting to launch' }}
            </button>
          </div>
          <button
            class="uc-btn uc-btn-primary"
            [disabled]="busy() || !hostKey.trim()"
            (click)="startNight()"
          >
            <mat-icon class="mi">dark_mode</mat-icon>
            {{ inLobby() ? 'Start the night now' : 'New Night' }}
          </button>
        } @else {
```

- [ ] **Step 3: Add a minimal style for the lobby row**

In `host-panel.component.scss`, append:

```scss
.lobby-row {
  display: flex;
  gap: 8px;
  flex-wrap: wrap;
  width: 100%;

  .host-input {
    flex: 1;
    min-width: 150px;
  }

  button {
    flex: 1;
    min-width: 150px;
  }
}
```

- [ ] **Step 4: Verify the build type-checks**

Run: `npm run build`
Expected: build succeeds. (`store.action` already accepts an arbitrary payload object, matching the existing `season-start` call.)

- [ ] **Step 5: Commit**

```bash
git add src/app/undercity/host/host-panel.component.ts src/app/undercity/host/host-panel.component.html src/app/undercity/host/host-panel.component.scss
git commit -m "feat(undercity): host-panel Waiting to launch control"
```

---

## Task 5: Frontend — `lobby` phase + countdown view

**Files:**
- Modify: `src/app/undercity/undercity-page.component.ts`
- Modify: `src/app/undercity/undercity-page.component.html`

- [ ] **Step 1: Add `lobby` to the `phase` computed**

In `undercity-page.component.ts`, update the `phase` computed (lines 67–78). Add `'lobby'` to the union and slot the lobby check in after the season null-check, before the `ended`/`active` branches:

```ts
  protected readonly phase = computed<
    'signin' | 'loading' | 'idle' | 'lobby' | 'hatch' | 'play' | 'ended'
  >(() => {
    if (!this.userService.isSignedIn()) return 'signin';
    const state = this.store.state();
    if (!state || !this.assetsReady() || !this.map()) return 'loading';
    const season = state.season;
    if (!season) return 'idle';
    if (season.status === 'lobby') return 'lobby';
    if (season.status === 'ended') return 'ended';
    if (season.status !== 'active') return 'idle';
    return state.you ? 'play' : 'hatch';
  });
```

- [ ] **Step 2: Add a ticking clock signal + countdown computed**

Add the import for `OnDestroy`/`signal`/`computed` if not already present (they are — the file already uses `computed`, `signal`, `OnDestroy`). Add these fields near the other signals (e.g. just before the `phase` computed) and a timer that updates once a second.

Add the field + timer handle with the other private timer fields (the class already has `sporeDeltaTimer`/`sporePulseTimer`):

```ts
  /** Wall-clock tick (ms) driving the lobby countdown; updated every second. */
  protected readonly nowMs = signal(Date.now());
  private lobbyTimer: ReturnType<typeof setInterval> | null = null;
```

Add the countdown computed near the other computeds (after `phase`):

```ts
  /** Human countdown to the lobby launch time, or a ready/idle string. */
  protected readonly launchCountdown = computed(() => {
    const iso = this.store.season()?.launchAt;
    if (!iso) return null;
    const target = new Date(iso).getTime();
    if (Number.isNaN(target)) return null;
    let secs = Math.floor((target - this.nowMs()) / 1000);
    if (secs <= 0) return 'ready';
    const h = Math.floor(secs / 3600);
    secs -= h * 3600;
    const m = Math.floor(secs / 60);
    const s = secs - m * 60;
    const pad = (n: number) => n.toString().padStart(2, '0');
    return h > 0 ? `${h}:${pad(m)}:${pad(s)}` : `${m}:${pad(s)}`;
  });
```

Start the timer in `ngOnInit` (after the existing body) and clear it in `ngOnDestroy`:

In `ngOnInit`, append:

```ts
    this.lobbyTimer = setInterval(() => this.nowMs.set(Date.now()), 1000);
```

In `ngOnDestroy`, append (next to the other `clearTimeout` calls):

```ts
    if (this.lobbyTimer) clearInterval(this.lobbyTimer);
```

- [ ] **Step 3: Add the `@case ('lobby')` view**

In `undercity-page.component.html`, add a new `@case` after the `@case ('idle')` block (which ends at line 50, `}` closing the idle div's `@case`). Insert:

```html
    @case ('lobby') {
      <div
        class="gate-screen bg-vista"
        style="background-image: linear-gradient(rgba(12, 14, 11, 0.72), rgba(12, 14, 11, 0.85)), url('undercity/undercity_background.webp')"
      >
        <mat-icon class="gate-icon pulse">hourglass_top</mat-icon>
        <h1>Waiting to launch</h1>
        @if (launchCountdown(); as cd) {
          @if (cd === 'ready') {
            <p>The night is about to begin…</p>
          } @else {
            <p>The night begins in</p>
            <p class="lobby-countdown">{{ cd }}</p>
          }
        } @else {
          <p>The swarm stirs. Sit tight — the night begins soon.</p>
        }
        <app-undercity-host-panel />
      </div>
    }
```

- [ ] **Step 4: Add a style for the countdown numerals**

In `undercity-page.component.scss`, add a rule for `.lobby-countdown` (place it near the other `.gate-screen` styles; if unsure, append at the end of the file):

```scss
.lobby-countdown {
  font-size: 2.4rem;
  font-weight: 700;
  letter-spacing: 0.04em;
  color: #d8f3dc;
  font-variant-numeric: tabular-nums;
  margin: 4px 0 0;
}
```

- [ ] **Step 5: Verify the build type-checks**

Run: `npm run build`
Expected: build succeeds. The `app-undercity-host-panel` component is already imported by the page component (it renders in the `idle`/`ended` cases), so no new import is needed.

- [ ] **Step 6: Commit**

```bash
git add src/app/undercity/undercity-page.component.ts src/app/undercity/undercity-page.component.html src/app/undercity/undercity-page.component.scss
git commit -m "feat(undercity): lobby phase with launch countdown"
```

---

## Task 6: Manual end-to-end verification

**Files:** none (runtime check)

- [ ] **Step 1: Confirm the host-panel import wiring**

The lobby control lives in `HostPanelComponent`, which is rendered both inside `AdminPanelComponent` (`admin-panel.component.ts` imports it) and directly on the `idle`/`ended`/`lobby` page screens. No route change is needed — the admin panel is reached by URL as today.

- [ ] **Step 2: Note for the user (deploy required)**

The lobby is enforced server-side, so it only works against a deployed Lambda. Per repo convention, **the user runs the deploy** (`cd infrastructure && cdk deploy`). Hand off with: backend tests green, frontend build green, and a note that a Lambda deploy is required before the lobby is live. To drive it locally against the live backend, see the `run-undercity` skill (host panel → set a datetime a minute out → "Waiting to launch" → observe the countdown → "Start the night now" promotes it).

---

## Self-Review

**Spec coverage:**
- New `lobby` status + `launchAt` field → Task 1 (model + state), Task 3 (client model). ✓
- `season-lobby` action (create/re-time, refuse-while-active, 403, validation) → Task 1 tests + impl. ✓
- `season-start` promotes lobby in place → Task 2. ✓
- Gameplay blocked in lobby → Task 1 `test_lobby_blocks_gameplay_actions` (relies on existing gate). ✓
- `phase` gains `lobby`, sign-in stays first → Task 5 Step 1. ✓
- Full-screen countdown view, past-zero "about to begin", missing-launchAt fallback → Task 5 Step 3 + `launchCountdown`. ✓
- Host control in admin panel (datetime-local + button), Start Night promotes → Task 4. ✓
- No auto-launch, no infra change → Task 6 note; no CDK edits anywhere. ✓

**Placeholder scan:** No TBD/TODO; every code step shows full code. ✓

**Type consistency:** `season-lobby` payload `{hostKey, launchAt}` matches between client (`openLobby`) and server (`_season_lobby`). `launchAt` naming consistent across model, state block, action, and countdown. `launchCountdown` sentinel `'ready'` handled in the template. `inLobby`/`nowMs`/`lobbyTimer` names consistent within their files. ✓
