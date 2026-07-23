# Undercity Ladder Crossing Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Make every rusted ladder a free pause-point — walking onto one always halts you there and opens a modal, banking your leftover steps; "Travel through" relocates free to the far end and you keep walking, "Close" keeps walking on the current side. Escape spurs fold into the same flow.

**Architecture:** Each walk segment stays an ordinary single-layer exact-count walk. Ladders join the *walking* stop set (not the spell set), so a walk always bonk-lands on them. Landing on a ladder re-issues `pendingMove` with the leftover steps instead of clearing it; a new `ladder-cross` action relocates to the far end and re-issues `pendingMove` from there. The core movement engine (`legal_destinations`/`validate_walk`) is untouched.

**Tech Stack:** Python 3.11 Lambda (pytest in-memory FakeTable suite), Angular 20 standalone components (no frontend test runner — verify with `npm run build`).

**Reference spec:** `specs/2026-07-23-undercity-ladder-crossing-design.md`

**Working directory for backend commands:** `infrastructure/lambda`
**Test command (backend):** `python -m pytest tests -q`
**Build command (frontend):** `npm run build` (from repo root)

---

## File Structure

- `infrastructure/lambda/undercity_data.py` — add `LADDER_NODES` constant.
- `infrastructure/lambda/undercity_db.py` — `_ladder_target` helper; ladders in `_stop_nodes`; ladder landing banks the roll in `_move`; `_resolve_space` ladder branch returns `to`/`oneWay`; retire escape-teleport branches in `_roll`/`_move`; new `_ladder_cross` action + handler registration.
- `infrastructure/lambda/tests/test_deep_dungeons.py` — new ladder-crossing tests.
- `src/app/undercity/tabs/board-tab.component.ts` — walking stop set + `commitStep`; retire `escapeClimbTarget`/escape tap/syncBoard; ladder target helper; `travelLadder`; tap-to-reopen.
- `src/app/undercity/tabs/board-tab.component.html` — ladder modal action buttons.
- `src/app/undercity/engine/board-canvas.ts` — retire `ladderPartner` map, tap-redirect, partner disc-lighting.

---

## Task 1: Server — ladder node set, target helper, walking stop set

**Files:**
- Modify: `infrastructure/lambda/undercity_data.py` (near `ESCAPE_LADDERS`, ~line 1132)
- Modify: `infrastructure/lambda/undercity_db.py` (`_ladder_target` new; `_stop_nodes` ~line 312)
- Test: `infrastructure/lambda/tests/test_deep_dungeons.py`

- [ ] **Step 1: Write the failing test**

Add to `tests/test_deep_dungeons.py`:

```python
def test_all_ladders_are_walk_stops(table):
    # Every ladder node (descent pairs + escape spurs) halts a walk: a mover is
    # stopped ON it, never corridors through. (data/db imported at file top.)
    doc = _join(table)
    stop = db._stop_nodes(table, _sid(table), doc)
    ladders = {n for n, nd in data.MAP_NODES.items() if nd['type'] == 'ladder'}
    assert ladders, 'expected some ladder nodes on the board'
    assert ladders <= stop


def test_ladder_target_descent_and_escape():
    nodes = data.MAP_NODES
    # Descent pair points at its ladder twin, both directions.
    assert db._ladder_target(nodes, 'cavern_lt') == 'cavern_lb'
    assert db._ladder_target(nodes, 'cavern_lb') == 'cavern_lt'
    # Escape spur points one-way at the biome surface mouth.
    assert db._ladder_target(nodes, 'cavern_esc') == 'cavern_lt'
    # Non-ladder nodes have no target.
    assert db._ladder_target(nodes, 'cavern_lair') is None
```

(If `_join` / `_sid` helpers are not already imported at the top of the file, mirror the existing tests in this file that use them — they are defined/imported there already.)

- [ ] **Step 2: Run the tests to verify they fail**

Run: `cd infrastructure/lambda && python -m pytest tests/test_deep_dungeons.py::test_all_ladders_are_walk_stops tests/test_deep_dungeons.py::test_ladder_target_descent_and_escape -q`
Expected: FAIL — `AttributeError: module 'undercity_data' has no attribute 'LADDER_NODES'` is not referenced yet, but `db._ladder_target` does not exist (AttributeError) and `_stop_nodes` does not contain descent ladders.

- [ ] **Step 3: Add `LADDER_NODES` to `undercity_data.py`**

Immediately after the `ESCAPE_EXITS = {...}` line (~1136):

```python
# Every ladder node on the board (descent pairs <biome>_lt / <biome>_lb plus the
# post-boss escape spurs <biome>_esc). Ladders are walk-stops: a mover halts ON a
# ladder and never corridors through, then crosses for free via the ladder-cross
# action. Static from the committed board; procedural depths preserve these ids.
LADDER_NODES = frozenset(n for n, nd in MAP_NODES.items() if nd['type'] == 'ladder')
```

- [ ] **Step 4: Add `_ladder_target` helper to `undercity_db.py`**

Place it right after `_stop_nodes` (after ~line 323):

```python
def _ladder_target(nodes, node):
    """The far end a ladder crosses to, or None if `node` is not a crossable
    ladder. Escape spurs go one-way to the biome surface mouth (ESCAPE_EXITS);
    a descent ladder goes to its ladder-type neighbour (the <biome>_lt / _lb
    twin)."""
    if node in data.ESCAPE_LADDERS:
        return data.ESCAPE_EXITS[node]
    nd = nodes.get(node)
    if not nd or nd.get('type') != 'ladder':
        return None
    for nb in nd['neighbors']:
        if nodes.get(nb, {}).get('type') == 'ladder':
            return nb
    return None
```

- [ ] **Step 5: Add all ladders to the walking stop set in `_stop_nodes`**

Replace the body of `_stop_nodes` (lines ~320-323) with:

```python
    # Walking stop set = shared sealed-barrier / escape-ladder stops, plus every
    # OTHER ladder (descent pairs), so a walk always halts on a ladder and never
    # corridors through. Ladders are added to the WALKING set only, not the spell
    # set (_closed_barriers), so spell range is unaffected.
    closed = _closed_barriers(table, sid) | data.LADDER_NODES
    if doc.get('tier', 1) > data.TUNNEL_TIER_MAX:
        closed = closed | data.TUNNEL_NODES
    return closed
```

- [ ] **Step 6: Run the tests to verify they pass**

Run: `cd infrastructure/lambda && python -m pytest tests/test_deep_dungeons.py::test_all_ladders_are_walk_stops tests/test_deep_dungeons.py::test_ladder_target_descent_and_escape -q`
Expected: PASS (2 passed)

- [ ] **Step 7: Run the full suite to catch regressions**

Run: `cd infrastructure/lambda && python -m pytest tests -q`
Expected: PASS (all green). If a pre-existing test asserted descent ladders are corridored-through, update it to reflect the stop behavior (there should be none — the maze reachability test uses a raw-graph BFS).

- [ ] **Step 8: Commit**

```bash
git add infrastructure/lambda/undercity_data.py infrastructure/lambda/undercity_db.py infrastructure/lambda/tests/test_deep_dungeons.py
git commit -m "feat(undercity): ladders are walk-stops + _ladder_target helper"
```

---

## Task 2: Server — ladder landing banks the roll; retire escape-teleport branches

**Files:**
- Modify: `infrastructure/lambda/undercity_db.py` (`_resolve_space` ladder branch ~2564-2581; `_move` ~2174-2248; `_roll` escape block ~2132-2137)
- Test: `infrastructure/lambda/tests/test_deep_dungeons.py`

- [ ] **Step 1: Write the failing test**

```python
def test_landing_on_ladder_banks_remaining_roll(table):
    # cavern_lt neighbours cavern_r5 (surface) and cavern_lb (depths twin).
    # Stand on cavern_r5, hand-roll a 5, walk the single hop onto the ladder:
    # it's a bonk landing (ladder is closed) that spends 1, banking 4.
    doc = _join(table)
    doc['position'] = 'cavern_r5'
    doc['pendingMove'] = {'value': 5, 'dests': ['cavern_lt']}
    db._put_player(table, doc)
    status, resp = db._move(table, _sid(table), doc,
                            {'to': 'cavern_lt', 'path': ['cavern_r5', 'cavern_lt']})
    assert status == 200
    ev = resp['spaceEvent']
    assert ev['type'] == 'ladder'
    assert ev['to'] == 'cavern_lb'
    assert ev['oneWay'] is False
    # Roll preserved (not cleared): 5 - 1 hop = 4 banked.
    assert doc['position'] == 'cavern_lt'
    assert doc['pendingMove']['value'] == 4
```

- [ ] **Step 2: Run the test to verify it fails**

Run: `cd infrastructure/lambda && python -m pytest tests/test_deep_dungeons.py::test_landing_on_ladder_banks_remaining_roll -q`
Expected: FAIL — `ev` has no `to`/`oneWay`, and `doc['pendingMove']` is `None` after the move.

- [ ] **Step 3: Make the `_resolve_space` ladder branch self-describe the crossing**

Replace the whole `if ntype == 'ladder':` block (lines ~2564-2581) with:

```python
    if ntype == 'ladder':
        nodes = _season_map(table, sid)
        target = _ladder_target(nodes, node)
        one_way = node in data.ESCAPE_LADDERS
        if one_way:
            text = ('A rusty escape ladder bolts up out of the depths. '
                    'Climb out to the surface?')
        elif data.dungeon_biome(node):
            text = 'A rusted ladder leads back up to the surface. Climb it?'
        else:
            b = node.split('_')[0]
            dname = data.DUNGEONS.get(b, {}).get('name', 'the depths')
            text = f'A rusted ladder leads down into {dname}. Descend?'
        return {'type': 'ladder', 'to': target, 'oneWay': one_way, 'text': text}
```

- [ ] **Step 4: Bank the remaining roll on a ladder landing in `_move`**

In `_move`, immediately AFTER `space_event = _resolve_space(table, sid, doc, to, prev)` (line ~2233) and BEFORE the `if space_event.get('type') == 'gate':` block, insert:

```python
    # Ladders never end movement. Landing on one banks the leftover steps as a
    # fresh pending move so the walk resumes after the crossing decision (the
    # ladder-cross action, or just walking on this side). pm was captured at the
    # top of _move, before pendingMove was cleared.
    if space_event.get('type') == 'ladder':
        hops = (len(path) - 1) if path else pm['value']
        allowed = [v for v in (pm.get('values') or [pm['value']]) if v >= hops]
        value_used = min(allowed) if allowed else pm['value']
        remaining = max(0, value_used - hops)
        if remaining > 0:
            doc['pendingMove'] = {
                'value': remaining,
                'dests': sorted(engine.legal_destinations(
                    nodes, to, remaining,
                    _stop_nodes(table, sid, doc), _blocked_nodes(doc))),
            }
```

- [ ] **Step 5: Retire the escape-teleport branch in `_move`**

Delete the block that special-cases the old escape climb (lines ~2186-2202), i.e. the entire comment + `if prev in data.ESCAPE_LADDERS and to == data.ESCAPE_EXITS[prev]:` clause through its `return _ok(...)`. Escape crossing now runs through `_ladder_cross` (Task 3).

- [ ] **Step 6: Retire the escape-dest injection in `_roll`**

Delete the block in `_roll` (lines ~2132-2137) that adds `ESCAPE_EXITS[pos]` to `dests`:

```python
    # DELETE these lines:
    pos = doc['position']
    if pos in data.ESCAPE_LADDERS and data.ESCAPE_LADDERS[pos] in (doc.get('poiClaims') or []):
        dests = sorted(set(dests) | {data.ESCAPE_EXITS[pos]})
```

If `pos` is referenced again later in `_roll`, keep a single `pos = doc['position']` assignment where still needed; otherwise remove it entirely.

- [ ] **Step 7: Run the test to verify it passes**

Run: `cd infrastructure/lambda && python -m pytest tests/test_deep_dungeons.py::test_landing_on_ladder_banks_remaining_roll -q`
Expected: PASS

- [ ] **Step 8: Run the full suite**

Run: `cd infrastructure/lambda && python -m pytest tests -q`
Expected: PASS. Any test exercising the old escape teleport-on-move or the `_roll` escape-dest injection must be migrated to the `ladder-cross` flow (see Task 3) — update or delete them.

- [ ] **Step 9: Commit**

```bash
git add infrastructure/lambda/undercity_db.py infrastructure/lambda/tests/test_deep_dungeons.py
git commit -m "feat(undercity): ladder landing banks the roll; retire escape teleport branches"
```

---

## Task 3: Server — the `ladder-cross` action

**Files:**
- Modify: `infrastructure/lambda/undercity_db.py` (new `_ladder_cross`; handler map ~1377)
- Test: `infrastructure/lambda/tests/test_deep_dungeons.py`

- [ ] **Step 1: Write the failing tests**

```python
def test_ladder_cross_descent_preserves_roll(table):
    doc = _join(table)
    doc['position'] = 'cavern_lt'
    doc['pendingMove'] = {'value': 3, 'dests': ['cavern_lb']}
    db._put_player(table, doc)
    status, resp = db._ladder_cross(table, _sid(table), doc, {})
    assert status == 200
    assert doc['position'] == 'cavern_lb'          # crossed to the twin
    assert doc['pendingMove']['value'] == 3        # roll fully preserved (free)


def test_ladder_cross_zero_steps_ends_turn(table):
    doc = _join(table)
    doc['position'] = 'cavern_lt'
    doc['pendingMove'] = None                      # 0 banked
    db._put_player(table, doc)
    status, resp = db._ladder_cross(table, _sid(table), doc, {})
    assert status == 200
    assert doc['position'] == 'cavern_lb'
    assert doc.get('pendingMove') is None          # clean end, no lingering move


def test_ladder_cross_escape_is_gated_and_one_way(table):
    doc = _join(table)
    doc['position'] = 'cavern_esc'
    doc['pendingMove'] = None
    db._put_player(table, doc)
    # Unclaimed: rejected, position unchanged.
    status, resp = db._ladder_cross(table, _sid(table), doc, {})
    assert status == 409
    assert 'error' in resp
    assert doc['position'] == 'cavern_esc'
    # Claimed: crosses one-way to the surface mouth.
    doc['poiClaims'] = ['cavern_lair']
    db._put_player(table, doc)
    status, resp = db._ladder_cross(table, _sid(table), doc, {})
    assert status == 200
    assert doc['position'] == 'cavern_lt'
```

- [ ] **Step 2: Run the tests to verify they fail**

Run: `cd infrastructure/lambda && python -m pytest tests/test_deep_dungeons.py -k ladder_cross -q`
Expected: FAIL — `AttributeError: module 'undercity_db' has no attribute '_ladder_cross'`

- [ ] **Step 3: Implement `_ladder_cross`**

Add near the other movement helpers (e.g. after `_move`, before `_respawn`):

```python
def _ladder_cross(table, sid, doc, payload):
    """Free ladder crossing: relocate to the ladder's far end, preserving any
    banked movement so the walk continues on the other side. One-way and
    claim-gated for escape spurs. Consequence-free: the far end's landing effect
    does not resolve (so arriving on the twin ladder does not re-open the
    dialog), mirroring the Nyx Weaver tunnel relocate."""
    pos = doc['position']
    nodes = _season_map(table, sid)
    target = _ladder_target(nodes, pos)
    if target is None:
        return _err('You are not on a ladder.', 409)
    if (pos in data.ESCAPE_LADDERS
            and data.ESCAPE_LADDERS[pos] not in (doc.get('poiClaims') or [])):
        return _err('That escape ladder is sealed until you clear its lair.', 409)

    pm = doc.get('pendingMove')
    remaining = int(pm['value']) if pm else 0
    doc['position'] = target
    # Surfacing resets normally live in _resolve_space, which this bypasses.
    if nodes.get(target, {}).get('region') != 'depths':
        doc['restsUsed'] = []
        doc.pop('lastStandUsed', None)
    if remaining > 0:
        doc['pendingMove'] = {
            'value': remaining,
            'dests': sorted(engine.legal_destinations(
                nodes, target, remaining,
                _stop_nodes(table, sid, doc), _blocked_nodes(doc))),
        }
    else:
        doc['pendingMove'] = None

    conflict = _save_or_conflict(table, doc)
    if conflict:
        return conflict
    occupants = _occupants(table, sid, doc['position'], doc['userId'])
    return _ok(doc, occupants=occupants, spaceEvent={
        'type': 'ladder_cross', 'to': target,
        'text': 'You slip through to the far side of the ladder.'})
```

- [ ] **Step 4: Register the handler**

In the `handlers = {...}` map (~line 1377), add:

```python
        'ladder-cross': _ladder_cross,
```

- [ ] **Step 5: Run the tests to verify they pass**

Run: `cd infrastructure/lambda && python -m pytest tests/test_deep_dungeons.py -k ladder_cross -q`
Expected: PASS (3 passed)

- [ ] **Step 6: Run the full suite**

Run: `cd infrastructure/lambda && python -m pytest tests -q`
Expected: PASS

- [ ] **Step 7: Commit**

```bash
git add infrastructure/lambda/undercity_db.py infrastructure/lambda/tests/test_deep_dungeons.py
git commit -m "feat(undercity): ladder-cross action — free relocate, roll preserved, escape gated"
```

---

## Task 4: Client — ladders stop the local walk

**Files:**
- Modify: `src/app/undercity/tabs/board-tab.component.ts` (`stepClosedIds` ~1508; `commitStep` ~1320-1338)

- [ ] **Step 1: Add all ladders to the walking stop set**

Replace `stepClosedIds()` (lines ~1508-1514) with:

```typescript
  private stepClosedIds(): string[] {
    const closed = this.closedBarrierIds();
    // Every ladder halts a walk (bonk-stop), so a mover always lands ON a ladder
    // and never corridors through — matching the server's _stop_nodes. Added to
    // the WALKING set only; closedBarrierIds() (spell range) is left alone.
    const ladders = this.map.nodes.filter((n) => n.type === 'ladder').map((n) => n.id);
    const base = [...closed, ...ladders];
    if ((this.store.you()?.tier ?? 1) > 1) {
      const bridges = this.map.nodes.filter((n) => n.type === 'tunnel').map((n) => n.id);
      return [...base, ...bridges];
    }
    return base;
  }
```

- [ ] **Step 2: Auto-commit the walk when it reaches any ladder**

In `commitStep` (lines ~1332-1337) replace the `escapeStop` definition and the final `if` with:

```typescript
    // Any ladder is a bonk-stop: the walk halts on arrival and commits, so the
    // server can bank the leftover steps and offer the crossing (see the ladder
    // space-event modal). Replaces the old degree-1-only escape-spur stop.
    const ladderStop = node?.type === 'ladder';
    if (step.left === 1 || sealedStop || bridgeStop || ladderStop) void this.move(nodeId);
```

- [ ] **Step 3: Verify the build compiles**

Run: `npm run build`
Expected: build succeeds (no TS errors). This task alone leaves the old escape-climb code present; that is removed in Task 5.

- [ ] **Step 4: Commit**

```bash
git add src/app/undercity/tabs/board-tab.component.ts
git commit -m "feat(undercity): client — every ladder bonk-stops the walk"
```

---

## Task 5: Client — retire the old descent/escape mechanics

**Files:**
- Modify: `src/app/undercity/engine/board-canvas.ts` (ladderPartner map ~301, population ~501-507, tap-redirect ~1050-1057, disc-light ~1339-1344)
- Modify: `src/app/undercity/tabs/board-tab.component.ts` (`escapeClimbTarget` ~1517-1528; `onTapNode` escape block ~1261-1276; `syncBoard` escape push ~1580-1585)

- [ ] **Step 1: Remove the `ladderPartner` map field in board-canvas**

Delete line ~301: `private ladderPartner = new Map<string, string>();`

- [ ] **Step 2: Remove the partner-population loop in the constructor**

Delete the block (lines ~501-507):

```typescript
    // A ladder node's partner is its neighbor that is also a ladder — its
    // twin on the other layer, tapped to descend/ascend.
    for (const n of map.nodes) {
      if (n.type !== 'ladder') continue;
      const partner = n.neighbors.find((nb) => this.nodeMap.get(nb)?.type === 'ladder');
      if (partner) this.ladderPartner.set(n.id, partner);
    }
```

- [ ] **Step 3: Remove the tap-redirect in `handleTap`**

Replace the block (lines ~1049-1057) with just:

```typescript
    const tappedId = best?.id ?? null;
    this.onTapNode(tappedId);
```

- [ ] **Step 4: Remove the partner disc-lighting in `drawSpace`**

Replace the `isChoice` computation (lines ~1341-1344) with:

```typescript
    const isChoice = this.choices.has(n.id);
```

(Delete the `const partner = this.ladderPartner.get(n.id);` line above it.)

- [ ] **Step 5: Remove `escapeClimbTarget` in board-tab**

Delete the whole `escapeClimbTarget()` method (lines ~1517-1528) and its doc comment.

- [ ] **Step 6: Remove the escape-climb branch in `onTapNode`**

Delete the block (lines ~1261-1276): the comment plus the `const climb = this.escapeClimbTarget();` through the `if (climb && ...) { void this.move(climb); return; }` clause and its stray `const climbStep`.

- [ ] **Step 7: Remove the escape-climb choice push in `syncBoard`**

Delete the block (lines ~1580-1585):

```typescript
    // Post-boss escape climb: light the escape spur ...
    if (step && step.path.length === 1 && here && this.escapeClimbTarget() && !choices.includes(here)) {
      choices.push(here);
    }
```

- [ ] **Step 8: Verify the build compiles**

Run: `npm run build`
Expected: build succeeds. If TS reports `escapeClimbTarget` still referenced, grep for remaining uses and remove them.

- [ ] **Step 9: Commit**

```bash
git add src/app/undercity/engine/board-canvas.ts src/app/undercity/tabs/board-tab.component.ts
git commit -m "refactor(undercity): retire ladderPartner tap-redirect + escapeClimbTarget"
```

---

## Task 6: Client — ladder modal (Travel through / Close) + tap-to-reopen

**Files:**
- Modify: `src/app/undercity/tabs/board-tab.component.ts` (ladder target helper; `travelLadder`; `onTapNode` tap-to-reopen)
- Modify: `src/app/undercity/tabs/board-tab.component.html` (event-actions block ~373-382)

- [ ] **Step 1: Add a client-side ladder-target helper in board-tab**

Add near the other private movement helpers:

```typescript
  /** The far end a ladder crosses to for display / button-gating (server is
   *  authoritative on the actual cross). Escape spurs go one-way to the biome
   *  surface mouth, and only when you hold that lair's claim; a descent ladder
   *  goes to its ladder-type neighbour. Null when there is no crossing. */
  private ladderTargetOf(nodeId: string): string | null {
    if (nodeId.endsWith('_esc')) {
      const biome = nodeId.split('_')[0];
      const claimed = (this.store.you()?.poiClaims ?? []).includes(biome + '_lair');
      return claimed ? biome + '_lt' : null;
    }
    const node = this.map.nodes.find((n) => n.id === nodeId);
    if (node?.type !== 'ladder') return null;
    const partner = node.neighbors.find(
      (nb) => this.map.nodes.find((m) => m.id === nb)?.type === 'ladder',
    );
    return partner ?? null;
  }
```

- [ ] **Step 2: Add `travelLadder` dispatch**

```typescript
  /** Ladder modal "Travel through": free relocate to the far end. The server
   *  preserves any banked steps as a fresh pendingMove, so the store effect
   *  resumes the walk on the other side (or ends the turn if 0 remain). */
  protected async travelLadder(): Promise<void> {
    this.closeSpaceModal();
    await this.run(async () => {
      const resp = await this.store.action('ladder-cross', {});
      if (resp.you) this.board?.centerOn(resp.you.position);
    });
  }
```

- [ ] **Step 3: Tap-to-reopen the ladder modal when standing on a ladder**

In `onTapNode`, after the teleport/empty-tap guards and BEFORE the `const step = this.stepping();` walk block, add:

```typescript
    // Standing on a ladder (e.g. paused here on an earlier roll): tapping it
    // re-opens the crossing modal so you can Travel through or keep walking.
    const you = this.store.you();
    if (
      nodeId === you?.position &&
      !this.busy() &&
      this.map.nodes.find((n) => n.id === nodeId)?.type === 'ladder'
    ) {
      const to = this.ladderTargetOf(nodeId);
      this.spaceModal.set({
        type: 'ladder',
        to: to ?? undefined,
        oneWay: nodeId.endsWith('_esc'),
        text: to
          ? 'A rusted ladder leads to the far side. Travel through?'
          : 'A rusted ladder — sealed until you clear its lair.',
      } as SpaceEvent);
      return;
    }
```

(If `SpaceEvent` requires other fields, set them to `undefined`; match the interface used by `spaceModal`. Confirm `spaceModal` is a writable signal on this component and `SpaceEvent` has optional `to` / `oneWay` — add `to?: string; oneWay?: boolean;` to the `SpaceEvent` interface if missing.)

- [ ] **Step 4: Ensure `SpaceEvent` carries `to` / `oneWay`**

Find the `SpaceEvent` interface (used by `spaceModal` / `routeSpaceEvent`). Confirm it has (add if missing):

```typescript
  to?: string;
  oneWay?: boolean;
```

`to` almost certainly already exists (warp/tunnel use it); add `oneWay` if absent.

- [ ] **Step 5: Add the ladder action buttons to the modal template**

In `board-tab.component.html`, extend the actions block (lines ~373-382). Replace:

```html
        @if (ev.type === 'world_event') {
          <div class="event-actions">
            <button class="uc-btn uc-btn-primary" (click)="engageWorldEvent()">
              Engage ({{ worldEventRoundCap }} rounds)
            </button>
            <button class="uc-btn" (click)="closeSpaceModal()">Back off</button>
          </div>
        } @else {
          <button class="uc-btn uc-btn-primary" (click)="closeSpaceModal()">OK</button>
        }
```

with:

```html
        @if (ev.type === 'world_event') {
          <div class="event-actions">
            <button class="uc-btn uc-btn-primary" (click)="engageWorldEvent()">
              Engage ({{ worldEventRoundCap }} rounds)
            </button>
            <button class="uc-btn" (click)="closeSpaceModal()">Back off</button>
          </div>
        } @else if (ev.type === 'ladder') {
          <div class="event-actions">
            @if (ev.to) {
              <button class="uc-btn uc-btn-primary" (click)="travelLadder()">Travel through</button>
            }
            <button class="uc-btn" (click)="closeSpaceModal()">Close</button>
          </div>
        } @else {
          <button class="uc-btn uc-btn-primary" (click)="closeSpaceModal()">OK</button>
        }
```

- [ ] **Step 6: Confirm `ladder_cross` events do not pop a modal**

Grep `routeSpaceEvent` for the fallthrough (`else { this.spaceModal.set(ev); }` or similar). The `ladder_cross` type returned by the action should NOT open the event modal (it is a silent relocate). If the fallthrough would show it, add an early guard:

```typescript
    if (ev.type === 'ladder_cross') return;   // silent free relocate
```

near the top of `routeSpaceEvent`.

- [ ] **Step 7: Verify the build compiles**

Run: `npm run build`
Expected: build succeeds.

- [ ] **Step 8: Commit**

```bash
git add src/app/undercity/tabs/board-tab.component.ts src/app/undercity/tabs/board-tab.component.html
git commit -m "feat(undercity): ladder crossing modal (Travel through / Close) + tap-to-reopen"
```

---

## Task 7: Full verification pass

- [ ] **Step 1: Backend suite green**

Run: `cd infrastructure/lambda && python -m pytest tests -q`
Expected: all pass.

- [ ] **Step 2: Frontend builds clean**

Run: `npm run build`
Expected: success, no TS errors.

- [ ] **Step 3: Manual smoke (real app)**

Per the `run-undercity` skill (dev server + live AWS backend), drive a creature to:
- a surface descent ladder → walk onto it → modal opens → **Travel through** drops into the depths and the walk continues with the leftover steps; **Close** keeps you on the surface ladder with the leftover steps.
- a cleared lair's escape spur → **Travel through** climbs one-way to the surface; an uncleared lair's spur is unreachable.
Confirm the roll is never wasted at a ladder and there is no dialog ping-pong after crossing.

Note: the user runs deploys; end here with tests green and the build clean, and note that a Lambda deploy is required for the server changes to take effect in the live game.

---

## Self-Review Notes

- **Spec coverage:** pause-on-arrival (Task 1 stop set + Task 4 client stop); roll preserved (Task 2 bank + Task 3 cross); Travel through / Close modal (Task 6); escape unified + gated + one-way (Task 2 retire, Task 3 gate); consequence-free (Task 3); retire old mechanics (Task 2 server, Task 5 client); engine untouched (no changes to `legal_destinations`/`validate_walk`); reachability test unaffected (Task 1 Step 7 / Task 2 Step 8 full-suite runs).
- **Type consistency:** server `to`/`oneWay` on the `ladder` event (Task 2 Step 3) are consumed by the client modal `ev.to` / `ev.oneWay` (Task 6 Steps 4-5); `ladder_cross` event type is produced by `_ladder_cross` (Task 3) and guarded in `routeSpaceEvent` (Task 6 Step 6); `_ladder_target(nodes, node)` defined in Task 1, used in Tasks 2 and 3.
- **Test harness:** tests use the real helpers from `tests/test_deep_dungeons.py` / `tests/test_undercity_db.py` — `_join(table)` (returns the doc), `_sid(table)`, `db._put_player(table, doc)` to persist, and direct `db._move` / `db._ladder_cross` calls that return `(status, resp)` and mutate `doc` in place. `_ok` → `(200, {'ok', 'you', **extra})`; `_err` → `(status, {'error': ...})`.
