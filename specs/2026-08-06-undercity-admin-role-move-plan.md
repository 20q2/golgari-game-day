# Admin Role + In-Game Free Move Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Let a hostKey-holder grant a persistent Admin role to an active player, and give Admin players an in-game "Move" action that walks the board freely and resolves as a real landing.

**Architecture:** A new `isAdmin` flag on the player doc, set by a hostKey-gated `grant-admin` admin command. A new `freemove` action, gated on `isAdmin`, validates a client-walked path with a new engine helper `validate_free_walk` (adjacency + barriers, no roll-distance limit, backtracking allowed) and resolves the landing through the existing `_resolve_space`. The client reuses its existing local-walk (`stepping`) machinery in a new `moveMode`.

**Tech Stack:** Python 3.11 Lambda (pure engine + in-memory FakeTable pytest suite); Angular 20 standalone client (signals).

Design doc: [specs/2026-08-06-undercity-admin-role-move-design.md](2026-08-06-undercity-admin-role-move-design.md)

---

## File Structure

- **Modify** `infrastructure/lambda/undercity_engine.py` — add `validate_free_walk`.
- **Modify** `infrastructure/lambda/undercity_db.py` — add `_admin_set_admin` (+ register), `_freemove` handler (+ register).
- **Create** `infrastructure/lambda/tests/test_undercity_admin_move.py` — the full test suite.
- **Modify** `src/app/undercity/services/undercity-models.ts` — add `isAdmin?` to `YouDoc`.
- **Modify** `src/app/undercity/admin/admin-panel.component.ts` + `.html` — the grant/revoke toggle.
- **Modify** `src/app/undercity/tabs/board-tab.component.ts` + `.html` — the Move button, move mode, `freeMove`.

Run the Python suite from `infrastructure/lambda`: `python -m pytest tests -q`.
Verify the client with `npm run build` (lint is known-broken in this repo).

> **Baseline note:** the working tree currently has unrelated WIP and the suite is
> not fully green. Before starting, capture the baseline failure count
> (`python -m pytest tests -q 2>&1 | tail -1`) and treat "no NEW failures beyond
> baseline" as the bar — the new `test_undercity_admin_move.py` must be fully green.

---

### Task 1: Engine — `validate_free_walk`

A pure validator: a legal admin walk is edge-adjacent steps of any length, never onto a `blocked` node, never crossing a `closed` barrier (a closed node may only be the final landing). Backtracking is allowed and there is no distance cap.

**Files:**
- Modify: `infrastructure/lambda/undercity_engine.py` (add after `validate_walk`, ~line 682)
- Create: `infrastructure/lambda/tests/test_undercity_admin_move.py`

- [ ] **Step 1: Write the failing tests**

Create `infrastructure/lambda/tests/test_undercity_admin_move.py`:

```python
"""Admin role + in-game free move."""
import undercity_data as data
import undercity_db as db
import undercity_engine as engine

from tests.test_undercity_db import table, act, _sid  # noqa: F401


# A tiny synthetic graph: a—b—c—d in a line, plus a barrier `x` off c and a
# blocked tunnel `t` off b.
_NODES = {
    'a': {'neighbors': ['b']},
    'b': {'neighbors': ['a', 'c', 't']},
    'c': {'neighbors': ['b', 'd', 'x']},
    'd': {'neighbors': ['c']},
    'x': {'neighbors': ['c']},   # a sealed barrier
    't': {'neighbors': ['b']},   # a blocked tunnel
}


def test_free_walk_accepts_any_length_adjacent_path():
    assert engine.validate_free_walk(_NODES, ['a', 'b', 'c', 'd']) is True


def test_free_walk_allows_backtracking():
    # a→b→a→b is illegal for a dice move (immediate backtrack) but fine here.
    assert engine.validate_free_walk(_NODES, ['a', 'b', 'a', 'b']) is True


def test_free_walk_rejects_non_adjacent_jump():
    assert engine.validate_free_walk(_NODES, ['a', 'c']) is False


def test_free_walk_rejects_stepping_onto_blocked():
    assert engine.validate_free_walk(
        _NODES, ['a', 'b', 't'], blocked=frozenset({'t'})) is False


def test_free_walk_barrier_may_be_landing_but_not_corridor():
    closed = frozenset({'x'})
    # landing ON the barrier is allowed (bonk stop)
    assert engine.validate_free_walk(_NODES, ['a', 'b', 'c', 'x'], closed=closed) is True
    # but you can never corridor THROUGH it
    nodes = dict(_NODES)
    nodes['x'] = {'neighbors': ['c', 'd']}
    assert engine.validate_free_walk(nodes, ['a', 'b', 'c', 'x', 'd'], closed=closed) is False


def test_free_walk_rejects_degenerate_path():
    assert engine.validate_free_walk(_NODES, ['a']) is False
    assert engine.validate_free_walk(_NODES, []) is False
```

- [ ] **Step 2: Run the tests to verify they fail**

Run: `cd infrastructure/lambda && python -m pytest tests/test_undercity_admin_move.py -q`
Expected: FAIL — `AttributeError: module 'undercity_engine' has no attribute 'validate_free_walk'`.

- [ ] **Step 3: Implement `validate_free_walk`**

In `undercity_engine.py`, directly after `validate_walk` (ends ~line 682), add:

```python
def validate_free_walk(nodes: dict, path,
                       closed: frozenset = frozenset(),
                       blocked: frozenset = frozenset()) -> bool:
    """True if `path` is a legal admin free walk: edge-adjacent steps of any
    length, never stepping ONTO a `blocked` node, never crossing a `closed`
    barrier (a closed node may only be the final landing — the bonk stop).
    Backtracking is allowed and there is NO distance limit — the exact-hop-count
    and no-immediate-backtrack rules of validate_walk are intentionally dropped.
    The start node (path[0]) is never treated as blocked or closed, mirroring
    validate_walk (you can always walk off a node you already stand on)."""
    if not path or len(path) < 2:
        return False
    if any(n not in nodes for n in path):
        return False
    for i in range(1, len(path)):
        cur, prev = path[i], path[i - 1]
        if cur not in nodes[prev]['neighbors']:
            return False                    # not adjacent
        if cur in blocked:
            return False                    # never step onto a blocked node
        if cur in closed and i != len(path) - 1:
            return False                    # never a corridor through a seal
    return True
```

- [ ] **Step 4: Run the tests to verify they pass**

Run: `cd infrastructure/lambda && python -m pytest tests/test_undercity_admin_move.py -q`
Expected: PASS (6 passed).

- [ ] **Step 5: Commit**

```bash
git add infrastructure/lambda/undercity_engine.py infrastructure/lambda/tests/test_undercity_admin_move.py
git commit -m "feat(undercity): validate_free_walk engine helper for admin move"
```

---

### Task 2: Server — `grant-admin` command

A hostKey-gated admin command that sets/clears `isAdmin` on a target player.

**Files:**
- Modify: `infrastructure/lambda/undercity_db.py` — add `_admin_set_admin` after `_admin_teleport` (~line 3032); register in `_ADMIN_CMDS` (~line 3130).
- Test: `infrastructure/lambda/tests/test_undercity_admin_move.py` (append)

- [ ] **Step 1: Write the failing tests**

Append to `infrastructure/lambda/tests/test_undercity_admin_move.py`:

```python
def _start_with_host(t, host='swampking'):
    act(t, 'season-start', hostKey=host)
    act(t, 'join', starter='pest')          # user-alex
    return _sid(t)


def test_grant_admin_sets_flag_and_is_hostkey_gated(table):
    sid = _start_with_host(table)
    # wrong passphrase → 403, flag untouched
    status, _ = act(table, 'admin', hostKey='nope', cmd='grant-admin',
                    target='user-alex', on=True)
    assert status == 403
    assert not db._get_player(table, sid, 'user-alex').get('isAdmin')

    # correct passphrase → flag set
    status, resp = act(table, 'admin', hostKey='swampking', cmd='grant-admin',
                       target='user-alex', on=True)
    assert status == 200 and resp['isAdmin'] is True
    assert db._get_player(table, sid, 'user-alex')['isAdmin'] is True


def test_grant_admin_can_revoke(table):
    sid = _start_with_host(table)
    act(table, 'admin', hostKey='swampking', cmd='grant-admin',
        target='user-alex', on=True)
    status, resp = act(table, 'admin', hostKey='swampking', cmd='grant-admin',
                       target='user-alex', on=False)
    assert status == 200 and resp['isAdmin'] is False
    assert db._get_player(table, sid, 'user-alex')['isAdmin'] is False
```

- [ ] **Step 2: Run the tests to verify they fail**

Run: `cd infrastructure/lambda && python -m pytest tests/test_undercity_admin_move.py -k grant_admin -q`
Expected: FAIL — `Unknown admin cmd: grant-admin` (so the 200 assertions fail).

- [ ] **Step 3: Implement the handler and register it**

In `undercity_db.py`, add after `_admin_teleport` (the function ending ~line 3031):

```python
def _admin_set_admin(table, sid, payload):
    """Grant or revoke the in-game Admin role on a target player. `on` defaults
    to True. The flag rides the target's `you` view (auto-spread in _ok) and
    unlocks their free-move action; it is never added to _public_player."""
    doc, err = _admin_target(table, sid, payload)
    if err:
        return err
    doc['isAdmin'] = bool(payload.get('on', True))
    conflict = _save_or_conflict(table, doc)
    if conflict:
        return conflict
    return 200, {'ok': True, 'isAdmin': doc['isAdmin']}
```

Then add to the `_ADMIN_CMDS` dict (~line 3130), after the `'teleport'` entry:

```python
    'teleport': _admin_teleport,
    'grant-admin': _admin_set_admin,
```

- [ ] **Step 4: Run the tests to verify they pass**

Run: `cd infrastructure/lambda && python -m pytest tests/test_undercity_admin_move.py -k grant_admin -q`
Expected: PASS (2 passed).

- [ ] **Step 5: Commit**

```bash
git add infrastructure/lambda/undercity_db.py infrastructure/lambda/tests/test_undercity_admin_move.py
git commit -m "feat(undercity): grant-admin command sets per-player isAdmin"
```

---

### Task 3: Server — `freemove` action

Gated on `isAdmin`; validates the walked path with `validate_free_walk`; resolves the landing through `_resolve_space`; returns the same envelope shape as `_move`.

**Files:**
- Modify: `infrastructure/lambda/undercity_db.py` — add `_freemove` after `_move` (its `return _ok(...)` is ~line 3698); register in the `handlers` dict (~line 2581).
- Test: `infrastructure/lambda/tests/test_undercity_admin_move.py` (append)

- [ ] **Step 1: Write the failing tests**

Append to `infrastructure/lambda/tests/test_undercity_admin_move.py`:

```python
def _two_step_path(nodes, start):
    """Build a legal [start, n1, n2] adjacent path from the real season map."""
    n1 = nodes[start]['neighbors'][0]
    n2 = next(x for x in nodes[n1]['neighbors'] if x != start)
    return [start, n1, n2]


def test_freemove_rejected_for_non_admin(table):
    sid = _start_with_host(table)
    doc = db._get_player(table, sid, 'user-alex')
    nodes = db._season_map(table, sid)
    path = _two_step_path(nodes, doc['position'])
    status, resp = act(table, 'freemove', to=path[-1], path=path)
    assert status == 403


def test_freemove_walks_multi_step_and_resolves_landing(table):
    sid = _start_with_host(table)
    doc = db._get_player(table, sid, 'user-alex')
    doc['isAdmin'] = True
    db._put_player(table, doc)
    nodes = db._season_map(table, sid)
    path = _two_step_path(nodes, doc['position'])

    status, resp = act(table, 'freemove', to=path[-1], path=path)
    assert status == 200
    assert resp['you']['position'] == path[-1]
    # the landing resolved — a space event is always attached (may be a plain
    # 'nothing' tile, a facility, or a fight)
    assert 'spaceEvent' in resp


def test_freemove_rejects_illegal_route(table):
    sid = _start_with_host(table)
    doc = db._get_player(table, sid, 'user-alex')
    doc['isAdmin'] = True
    db._put_player(table, doc)
    nodes = db._season_map(table, sid)
    start = doc['position']
    # a non-adjacent 2-hop jump sent as a 2-node path
    far = _two_step_path(nodes, start)[-1]
    status, resp = act(table, 'freemove', to=far, path=[start, far])
    assert status == 409


def test_freemove_requires_path_ending_at_to(table):
    sid = _start_with_host(table)
    doc = db._get_player(table, sid, 'user-alex')
    doc['isAdmin'] = True
    db._put_player(table, doc)
    nodes = db._season_map(table, sid)
    path = _two_step_path(nodes, doc['position'])
    status, _ = act(table, 'freemove', to=path[1], path=path)   # to != path[-1]
    assert status == 409
```

- [ ] **Step 2: Run the tests to verify they fail**

Run: `cd infrastructure/lambda && python -m pytest tests/test_undercity_admin_move.py -k freemove -q`
Expected: FAIL — `Unknown action: freemove`.

- [ ] **Step 3: Implement `_freemove` and register it**

In `undercity_db.py`, add after `_move` returns (`_ladder_cross` begins ~line 3701 — insert just before it):

```python
def _freemove(table, sid, doc, payload):
    """Admin-only free walk: relocate along any legal adjacent path (barriers
    respected, no roll cost) and resolve the destination as a real landing.
    Gated hard on isAdmin — the capability is server-authoritative."""
    if not doc.get('isAdmin'):
        return _err('Admin move is not enabled for you.', 403)
    nodes = _season_map(table, sid)
    to = payload.get('to')
    path = payload.get('path')
    if to not in nodes:
        return _err('Unknown node: ' + str(to), 409)
    if not path or path[0] != doc['position'] or path[-1] != to:
        return _err('That route is not a legal walk.', 409)
    closed = _stop_nodes(table, sid, doc)
    blocked = _blocked_nodes(doc)
    if not engine.validate_free_walk(nodes, path, closed, blocked):
        return _err('That route is not a legal walk.', 409)

    prev = doc['position']
    doc['pendingMove'] = None
    doc['position'] = to
    space_event = _resolve_space(table, sid, doc, to, prev)

    # Landing on a gate full-heals inside _resolve_space; surface the amount so
    # the client floats heal numbers, mirroring _move.
    heal = None
    if space_event.get('type') == 'gate':
        healed = space_event.get('healed', 0)
        heal = {'amount': healed, 'hp': doc['hp'], 'kind': 'gate_land'} if healed else None

    conflict = _save_or_conflict(table, doc)
    if conflict:
        return conflict
    # _resolve_space may relocate (tunnel/warp) — report occupants of where it
    # actually ended up.
    occupants = _occupants(table, sid, doc['position'], doc['userId'])
    return _ok(doc, spaceEvent=space_event, occupants=occupants, heal=heal)
```

Then register it in the `handlers` dict inside `handle_action` (~line 2581), next to `'move'`:

```python
        'claim': _claim, 'roll': _roll, 'move': _move, 'freemove': _freemove,
        'ladder-cross': _ladder_cross,
```

- [ ] **Step 4: Run the tests to verify they pass**

Run: `cd infrastructure/lambda && python -m pytest tests/test_undercity_admin_move.py -k freemove -q`
Expected: PASS (4 passed).

- [ ] **Step 5: Commit**

```bash
git add infrastructure/lambda/undercity_db.py infrastructure/lambda/tests/test_undercity_admin_move.py
git commit -m "feat(undercity): freemove action — admin free walk with real landing"
```

---

### Task 4: Verify `isAdmin` visibility (surfaced privately, never public)

No new code — a guard test proving the flag reaches the owner's `you` view but is absent from the public/spectator view.

**Files:**
- Test: `infrastructure/lambda/tests/test_undercity_admin_move.py` (append)

- [ ] **Step 1: Write the test**

Append to `infrastructure/lambda/tests/test_undercity_admin_move.py`:

```python
def test_isadmin_in_you_view_but_not_public(table):
    sid = _start_with_host(table)
    act(table, 'admin', hostKey='swampking', cmd='grant-admin',
        target='user-alex', on=True)
    # owner's own view carries the flag
    status, resp = act(table, 'ack-events')   # any lightweight action returns `you`
    assert resp['you'].get('isAdmin') is True
    # the public projection never exposes it
    doc = db._get_player(table, sid, 'user-alex')
    assert 'isAdmin' not in db._public_player(doc)
```

- [ ] **Step 2: Run the test**

Run: `cd infrastructure/lambda && python -m pytest tests/test_undercity_admin_move.py -k isadmin -q`
Expected: PASS. (If `ack-events` doesn't return a `you` envelope, substitute `set-status` with `text='hi'`, which does.)

- [ ] **Step 3: Run the whole new test file + full suite**

Run: `cd infrastructure/lambda && python -m pytest tests/test_undercity_admin_move.py -q && python -m pytest tests -q 2>&1 | tail -1`
Expected: the admin-move file is fully green; the full-suite failure count is no higher than the baseline captured at the start.

- [ ] **Step 4: Commit**

```bash
git add infrastructure/lambda/tests/test_undercity_admin_move.py
git commit -m "test(undercity): isAdmin surfaces in you view, never in public"
```

---

### Task 5: Client — model field + admin-panel toggle

**Files:**
- Modify: `src/app/undercity/services/undercity-models.ts` (in `YouDoc`, near `isBot`/`renown` — place after `debug?`)
- Modify: `src/app/undercity/admin/admin-panel.component.ts`
- Modify: `src/app/undercity/admin/admin-panel.component.html`

- [ ] **Step 1: Add the model field**

In `undercity-models.ts`, inside `interface YouDoc`, after the `debug?: boolean;` line, add:

```typescript
  /** In-game Admin role (host-granted). Unlocks the free Move action. Owner-only
   * — never present on the public/spectator player view. */
  isAdmin?: boolean;
```

- [ ] **Step 2: Add the toggle method + local admin set to the panel component**

In `admin-panel.component.ts`, add a local set of known admin ids and a toggle. Add the field near the other `signal(...)` declarations (after `confirmReset`, ~line 45):

```typescript
  /** User ids granted Admin this session (local — the public roster omits the
   *  flag, so we track what we've toggled to label the button). */
  protected readonly adminIds = signal<Set<string>>(new Set());
```

Add the method next to `teleport`/`kick` (~line 146):

```typescript
  protected isAdminUser(userId: string): boolean {
    return this.adminIds().has(userId);
  }

  protected toggleAdmin(userId: string): void {
    const on = !this.isAdminUser(userId);
    void this.admin('grant-admin', { target: userId, on }).then(() => {
      if (this.message()) return;                       // command failed
      const next = new Set(this.adminIds());
      if (on) next.add(userId);
      else next.delete(userId);
      this.adminIds.set(next);
    });
  }
```

- [ ] **Step 3: Add the toggle button to the roster**

In `admin-panel.component.html`, find the per-player roster row that renders the Heal / Teleport / Kick buttons. Add, alongside them (skip bots, matching the existing `@if (!p.isBot)` pattern used for human-only controls — if the row has no such guard, wrap this button in `@if (!p.isBot) { ... }`):

```html
            <button class="uc-btn admin-role-btn" (click)="toggleAdmin(p.userId)" [disabled]="busy()">
              <mat-icon class="mi">{{ isAdminUser(p.userId) ? 'shield_person' : 'add_moderator' }}</mat-icon>
              {{ isAdminUser(p.userId) ? 'Revoke admin' : 'Make admin' }}
            </button>
```

(`p` is the roster loop variable — match the existing `@for` alias in that file; it iterates `store.players()`.)

- [ ] **Step 4: Verify the client builds**

Run: `npm run build`
Expected: build succeeds. If pre-existing unrelated WIP breaks the build, confirm none of the errors reference `admin-panel` or `undercity-models`; those files must be clean.

- [ ] **Step 5: Commit**

```bash
git add src/app/undercity/services/undercity-models.ts src/app/undercity/admin/admin-panel.component.ts src/app/undercity/admin/admin-panel.component.html
git commit -m "feat(undercity): admin-panel grant/revoke Admin role toggle"
```

---

### Task 6: Client — Move button + move mode

Add a `Move` button (Admin-only) that enters a `moveMode`, reusing the existing `stepping` walk. In move mode the board highlights all legal neighbors, taps build the path (with retrace), and an explicit **Move here** commits via `freemove`.

**Files:**
- Modify: `src/app/undercity/tabs/board-tab.component.ts`
- Modify: `src/app/undercity/tabs/board-tab.component.html`

- [ ] **Step 1: Add the `moveMode` signal + free-walk helpers + `freeMove`**

In `board-tab.component.ts`, add the signal near `stepping` (declared ~line 525):

```typescript
  /** Admin free-move: a local walk with no roll cost, committed by "Move here". */
  protected readonly moveMode = signal(false);
```

Add these methods near `move()` (~line 2338):

```typescript
  protected readonly isAdmin = computed(() => this.store.you()?.isAdmin ?? false);

  protected toggleMoveMode(): void {
    if (this.moveMode()) { this.exitMoveMode(); return; }
    const pos = this.store.you()?.position;
    if (!pos) return;
    this.hideInfo();
    this.moveMode.set(true);
    // Seed the walk at the current node; `left` is unused in free mode.
    this.stepping.set({ path: [pos], left: Number.MAX_SAFE_INTEGER });
    this.board?.centerOn(pos);
  }

  protected exitMoveMode(): void {
    this.moveMode.set(false);
    this.stepping.set(null);
  }

  /** Legal next nodes in free mode: every neighbour of the current node. A closed
   *  barrier may be stepped ONTO (a bonk landing) but never corridored through —
   *  so once you stand on one, only retrace is offered. Blocked/toll edges are
   *  enforced server-side; the walk here is deliberately permissive. */
  private freeStepChoices(step: StepState): string[] {
    const here = stepPos(step);
    const node = this.map.nodes.find((n) => n.id === here);
    if (!node) return [];
    const closed = new Set(this.stepClosedIds());
    if (closed.has(here) && here !== step.path[0]) return [];   // bonked — dead stop
    return node.neighbors;
  }

  /** Handle a board tap while in move mode: retrace on the previous node, else
   *  step onto a legal neighbour. No auto-commit — "Move here" finalises. */
  private moveModeTap(nodeId: string | null): void {
    const step = this.stepping();
    if (!nodeId || !step || this.busy()) return;
    if (nodeId === stepPrev(step)) {
      this.stepping.set({ path: step.path.slice(0, -1), left: step.left });
      this.board?.centerOn(nodeId);
      return;
    }
    if (this.freeStepChoices(step).includes(nodeId)) {
      this.stepping.set({ path: [...step.path, nodeId], left: step.left });
      this.board?.centerOn(nodeId);
    }
  }

  protected async commitFreeMove(): Promise<void> {
    const step = this.stepping();
    if (!step || step.path.length < 2) { this.exitMoveMode(); return; }
    const to = step.path[step.path.length - 1];
    const path = step.path;
    await this.freeMove(to, path);
    this.exitMoveMode();
  }

  private async freeMove(to: string, path: string[]): Promise<void> {
    const preHp = this.store.you()?.hp ?? 0;
    await this.run(async () => {
      const resp = await this.store.action('freemove', { to, path });
      if (resp.you) this.board?.centerOn(resp.you.position);
      const uid = this.store.ownUserId;
      if (resp.heal && uid) this.board?.popHealNumber(uid, resp.heal.amount);
      this.occupants.set(resp.occupants ?? []);
      const ev = resp.spaceEvent;
      if (ev) this.routeSpaceEvent(ev, preHp);
    });
  }
```

- [ ] **Step 2: Branch the tap handler and the canvas paint for move mode**

In `board-tab.component.ts`, at the very top of the board-tap handler `onNodeTap` (the method containing the ladder/stepping logic, whose body starts ~line 1889 with the teleport branch), add a move-mode short-circuit as the first statement. Find:

```typescript
      void this.castSpell(tele.spell, { target: nodeId });
      return;
    }
    if (!nodeId) {
```

and insert, immediately before `if (!nodeId) {`:

```typescript
    if (this.moveMode()) { this.moveModeTap(nodeId); return; }
```

Then in the canvas paint method, make the highlighted choices use the free set in move mode. Find (~line 2311):

```typescript
    const choices = step ? this.stepChoices(step) : [];
```

and replace with:

```typescript
    const choices = step
      ? (this.moveMode() ? this.freeStepChoices(step) : this.stepChoices(step))
      : [];
```

- [ ] **Step 3: Add the Move button and the move-mode control bar to the template**

In `board-tab.component.html`, add the **Move** button inside the `action-row`, right after the Cast button's closing `}` (the `@if (castableSpells()...) { ... }` block ends ~line 205):

```html
          @if (isAdmin() && !rolling() && !store.you()?.pendingMove) {
            <button
              class="uc-btn move-btn"
              [disabled]="busy()"
              (click)="toggleMoveMode()"
            >
              <mat-icon class="mi">open_with</mat-icon> Move
            </button>
          }
```

Then add the move-mode control bar as a new branch of the routine-actions block. Find the routine block opener (~line 170):

```html
    } @else {
      <!-- Routine turn actions -->
      <div class="roll-strip">
```

and change it to gate the roll-strip behind move mode, showing the control bar instead while active:

```html
    } @else if (moveMode()) {
      <div class="roll-strip">
        <div class="band-morph move-mode-bar">
          <div class="move-mode-msg">Tap spaces to walk, then land where you stop.</div>
          <div class="move-mode-actions">
            <button
              class="uc-btn uc-btn-primary"
              [disabled]="busy() || (stepping()?.path?.length ?? 0) < 2"
              (click)="commitFreeMove()"
            >
              <mat-icon class="mi">flag</mat-icon> Move here
            </button>
            <button class="uc-btn" [disabled]="busy()" (click)="exitMoveMode()">
              Cancel
            </button>
          </div>
        </div>
      </div>
    } @else {
      <!-- Routine turn actions -->
      <div class="roll-strip">
```

- [ ] **Step 4: Verify the client builds**

Run: `npm run build`
Expected: build succeeds. Confirm no error references `board-tab`.

- [ ] **Step 5: Commit**

```bash
git add src/app/undercity/tabs/board-tab.component.ts src/app/undercity/tabs/board-tab.component.html
git commit -m "feat(undercity): admin in-game free Move mode on the board"
```

---

### Task 7: Full verification pass

- [ ] **Step 1: Python suite — new file green, no new failures**

Run: `cd infrastructure/lambda && python -m pytest tests/test_undercity_admin_move.py -q && python -m pytest tests -q 2>&1 | tail -1`
Expected: admin-move file fully green; full-suite failure count ≤ baseline.

- [ ] **Step 2: Client build green**

Run: `npm run build`
Expected: build succeeds.

- [ ] **Step 3: Manual sanity (optional, via the run-undercity skill)**

Grant yourself Admin from the admin panel, confirm the Move button appears, enter move mode, walk several spaces, and commit — confirm the landing resolves (facility opens / fight starts). The `run-undercity` skill covers the dev server + live-backend prerequisites.

Deployment is the user's responsibility — end with tests + build green and note that a backend `cdk deploy` (for `grant-admin` + `freemove`) plus a frontend deploy are needed to go live.

---

## Self-Review

**Spec coverage:**
- Persistent per-user `isAdmin` flag → Task 2 (`_admin_set_admin`). ✓
- Granted/revoked from admin panel, hostKey-gated → Task 2 (gating via `_admin`), Task 5 (panel toggle). ✓
- `isAdmin` in `you`, not in public → Task 4 (guard test); relies on `_ok` spread + `_public_player` whitelist. ✓
- `freemove` action, isAdmin hard-gate (403) → Task 3. ✓
- Walk edges, respect barriers, unlimited length, backtracking, no roll cost → Task 1 (`validate_free_walk`) + Task 3 (wiring with `_stop_nodes`/`_blocked_nodes`). ✓
- Full real landing via `_resolve_space` (combat included) → Task 3. ✓
- Admin-only Move button next to Cast, idle-gated → Task 6. ✓
- Move mode: tap to walk one space at a time, retrace, commit on exit → Task 6 (`moveModeTap`, `commitFreeMove`). ✓
- Reuse existing walk/canvas machinery → Task 6 (reuses `stepping`, `board.centerOn`, paint choices). ✓
- Tests enumerated in the design → Tasks 1–4 cover grant gating/toggle, non-admin 403, adjacency/barrier/degenerate rejection, backtrack accept, landing resolves, visibility split. ✓

**Placeholder scan:** No TBD/TODO; every code step shows complete code. ✓

**Type/name consistency:** `validate_free_walk(nodes, path, closed, blocked)` signature identical in Task 1 def and Task 3 call. `_admin_set_admin`, `_freemove`, `grant-admin`, `freemove`, `isAdmin` used consistently across server, tests, model, and client. Client: `moveMode`, `freeStepChoices`, `moveModeTap`, `commitFreeMove`, `freeMove`, `exitMoveMode`, `isAdmin` all defined in Task 6 and referenced by the Task 6 template. `StepState`/`stepPos`/`stepPrev`/`stepClosedIds`/`this.map`/`this.board`/`this.run`/`this.occupants`/`this.routeSpaceEvent` are existing symbols reused. ✓

**Known edge (documented, acceptable):** the client's `freeStepChoices` is deliberately permissive about blocked/toll edges (evolved-unit tunnel tolls, unclaimed escape ladders); the server's `validate_free_walk` + `_blocked_nodes` is the authority and will 409 a rejected route. Rare in admin repositioning; the user can pick another path.
