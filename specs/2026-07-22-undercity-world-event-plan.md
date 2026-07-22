# Undercity World Event ("The Great Beast") Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add a season-shared co-op world boss that spawns on 3 adjacent wilderness nodes when the first sigil lair falls, that any player can chip in bounded 6-round skirmishes, and that pays every contributor by damage bracket when its shared HP pool empties — wherever they are on the board.

**Architecture:** All rules are server-side in the Python Lambda (`undercity_db.py` I/O + dispatch, `undercity_data.py` spec, `undercity_config.py` scalars), following the existing persistent-pool patterns (lair/boss HP, wild-warp shared state, `_broadcast_away` fan-out). The event's footprint is chosen at runtime and stored in a `WORLDEVENT` season record; it is *overlaid* onto three wilderness nodes rather than retyping the map. The Angular client gains a `worldEvent` state block, board-canvas rendering across the 3 nodes, and a modal→engage flow reusing the interactive combat UI.

**Tech Stack:** Python 3.11 Lambda + DynamoDB (FakeTable pytest suite); Angular 20 standalone components + canvas engines (no JS test runner — verify via `npm run build`).

**Design spec:** [specs/2026-07-22-undercity-world-event-design.md](2026-07-22-undercity-world-event-design.md)

**Reference skill:** follow the **add-undercity-space** skill while implementing — this adds a new landable space type spanning Python rules, the map graph, and Angular render + modal.

**Working-copy note:** the repo already has uncommitted edits in `undercity_db.py`, `undercity_config.py`, `board-canvas.ts`, `undercity-models.ts`, and the tab/plaza components. Rebase each change onto the current file state; do not revert those edits. Run `git status` before each commit and stage only the files this plan touches.

---

## File Structure

**Modify (server):**
- `infrastructure/lambda/undercity_config.py` — reward/HP/round-cap scalars.
- `infrastructure/lambda/undercity_data.py` — `WORLD_EVENT` NPC spec + `world_event_reward()` bracket helper.
- `infrastructure/lambda/undercity_db.py` — shared-state helpers, spawn hook, resolve-space overlay, engage action, round cap, finish/payout, state payload.
- `infrastructure/lambda/tests/test_world_event.py` — **new** FakeTable integration suite.

**Modify (client):**
- `src/app/undercity/services/undercity-models.ts` — `'world'` combat kind, `WorldEventState`, `world_event` space event, state field.
- `src/app/undercity/engine/board-canvas.ts` — render beast sprite + HP bar across the 3 nodes.
- `src/app/undercity/tabs/board-tab.component.ts` — route `world_event` space event → modal, Engage → `world-engage`, add `'world'` to fight types, spawn/payout event copy.
- `src/app/undercity/data/world-event.ts` — **new** client mirror (display stats + reward numbers + sprite id).

**Add (asset):**
- `public/undercity/sigil_boss/moor_wyrm.png` — converted from the existing `.jfif`.

---

## Task 1: Config scalars

**Files:**
- Modify: `infrastructure/lambda/undercity_config.py`

- [ ] **Step 1: Add the world-event scalars**

Append near the other combat/economy blocks in `undercity_config.py`:

```python
# ── World Event ("The Great Beast") ──────────────────────────────────────────
# A season-shared co-op boss that spawns in the wilderness once the first sigil
# lair is cleared. Players chip a shared HP pool in bounded skirmishes; on death
# every contributor is paid by damage bracket. Mirror in
# src/app/undercity/data/world-event.ts when tuned.
WORLD_EVENT_HP          = 200   # shared pool; sized so it takes many skirmishes
WORLD_EVENT_ROUND_CAP   = 6     # a single skirmish auto-ends after this many rounds
WORLD_EVENT_MAJOR_SHARE = 0.25  # damage-share threshold for the Major bracket
WORLD_EVENT_MINOR_SHARE = 0.10  # damage-share threshold for the Minor bracket

# Per-bracket payout: (spores, renown). Vanquisher = single top damage dealer.
WORLD_EVENT_REWARDS = {
    'vanquisher':  {'spores': 120, 'renown': 5},
    'major':       {'spores': 80,  'renown': 3},
    'minor':       {'spores': 45,  'renown': 2},
    'participant': {'spores': 20,  'renown': 0},
}
```

- [ ] **Step 2: Verify it imports**

Run: `cd infrastructure/lambda && python -c "import undercity_config as c; print(c.WORLD_EVENT_HP, c.WORLD_EVENT_REWARDS['vanquisher'])"`
Expected: `200 {'spores': 120, 'renown': 5}`

- [ ] **Step 3: Commit**

```bash
git add infrastructure/lambda/undercity_config.py
git commit -m "feat(undercity): world-event balance scalars"
```

---

## Task 2: NPC spec + bracket helper in data

**Files:**
- Modify: `infrastructure/lambda/undercity_data.py`

- [ ] **Step 1: Add the `WORLD_EVENT` spec near `LAIR_BOSSES` (after line ~781)**

```python
# The wilderness World Event boss. `spriteId` maps to public/undercity/sigil_boss/
# art on the client. Stats are per-swing combat stats; `hp` here is unused (the
# live shared pool comes from config.WORLD_EVENT_HP / the WORLDEVENT record).
WORLD_EVENT = {
    'id': 'moor_wyrm',
    'name': 'The Moor-Wyrm',
    'spriteId': 'moor_wyrm',
    'atk': 12, 'def': 6, 'spd': 5,
    'personality': 'brute', 'bluff': 0.30,
}
```

- [ ] **Step 2: Add the bracket helper at the end of the file**

```python
def world_event_reward(share, is_top):
    """Map a contributor's damage `share` (dealt / maxHp, 0..1) and whether they
    are the single top damage dealer to a bracket key + its reward dict.
    Returns (bracket_key, {'spores': int, 'renown': int})."""
    from undercity_config import (WORLD_EVENT_REWARDS, WORLD_EVENT_MAJOR_SHARE,
                                  WORLD_EVENT_MINOR_SHARE)
    if is_top:
        key = 'vanquisher'
    elif share >= WORLD_EVENT_MAJOR_SHARE:
        key = 'major'
    elif share >= WORLD_EVENT_MINOR_SHARE:
        key = 'minor'
    else:
        key = 'participant'
    return key, WORLD_EVENT_REWARDS[key]
```

(If `undercity_config` is already imported at the top of `undercity_data.py`, use the module reference instead of the local import — match the file's existing convention.)

- [ ] **Step 2b: Re-export the config scalars if the file mirrors config**

Check the top of `undercity_data.py`: if it already does `from undercity_config import *` or names scalars, the local import in Step 2 is redundant — drop it and reference the names directly. Otherwise keep the local import.

- [ ] **Step 3: Verify**

Run: `cd infrastructure/lambda && python -c "import undercity_data as d; print(d.WORLD_EVENT['name']); print(d.world_event_reward(0.30, False)); print(d.world_event_reward(0.05, True))"`
Expected:
```
The Moor-Wyrm
('major', {'spores': 80, 'renown': 3})
('vanquisher', {'spores': 120, 'renown': 5})
```

- [ ] **Step 4: Commit**

```bash
git add infrastructure/lambda/undercity_data.py
git commit -m "feat(undercity): world-event NPC spec + reward brackets"
```

---

## Task 3: Shared-state helpers + footprint selection

**Files:**
- Modify: `infrastructure/lambda/undercity_db.py`
- Test: `infrastructure/lambda/tests/test_world_event.py` (new)

- [ ] **Step 1: Write the failing test for footprint selection + state round-trip**

Create `infrastructure/lambda/tests/test_world_event.py`:

```python
import undercity_db as db
import undercity_data as data


def test_pick_world_event_run_is_connected_wilderness_triple():
    nodes = data.MAP_NODES
    run = db._pick_world_event_run(nodes)
    assert run is not None and len(run) == 3
    a, center, c = run
    for nid in run:
        assert nodes[nid]['region'] == 'wilderness'
    # center is adjacent to both flanks
    assert a in nodes[center]['neighbors']
    assert c in nodes[center]['neighbors']
    assert a != c


def test_world_event_state_round_trip(table_sid):
    table, sid = table_sid
    assert db._world_event(table, sid) is None
    rec = {'spawned': True, 'node': 'x', 'nodes': ['a', 'x', 'b'],
           'hp': 200, 'maxHp': 200, 'dmg': {}, 'dead': False}
    db._set_world_event(table, sid, rec)
    got = db._world_event(table, sid)
    assert got['hp'] == 200 and got['nodes'] == ['a', 'x', 'b']
```

If the suite has no `table_sid` fixture, add one to `tests/conftest.py` mirroring the existing FakeTable+season setup used by `test_undercity_db.py` (copy its fixture; name it `table_sid` returning `(table, sid)` for an active season with the map seeded). Check `tests/conftest.py` first and reuse whatever fixture already yields an active-season FakeTable.

- [ ] **Step 2: Run it to confirm it fails**

Run: `cd infrastructure/lambda && python -m pytest tests/test_world_event.py -q`
Expected: FAIL — `AttributeError: module 'undercity_db' has no attribute '_pick_world_event_run'`

- [ ] **Step 3: Implement the helpers**

Add near the other season-shared-state helpers in `undercity_db.py` (e.g. just below `_set_lair_state`, ~line 2648):

```python
# ── World Event ("The Great Beast") shared state ─────────────────────────────

def _world_event(table, sid):
    """The live world-event record, or None if it never spawned."""
    return _get(table, _season_pk(sid), 'WORLDEVENT')


def _set_world_event(table, sid, rec):
    item = dict(rec)
    item['pk'] = _season_pk(sid)
    item['sk'] = 'WORLDEVENT'
    table.put_item(Item=item)


def _pick_world_event_run(nodes):
    """A length-3 connected chain of wilderness nodes: [flank, center, flank].
    Picks a center that has >=2 wilderness neighbours. Returns None if the map
    has no such run (shouldn't happen on the real board)."""
    centers = []
    for nid, n in nodes.items():
        if n.get('region') != 'wilderness':
            continue
        wnb = [m for m in n.get('neighbors', [])
               if nodes.get(m, {}).get('region') == 'wilderness']
        if len(wnb) >= 2:
            centers.append((nid, wnb))
    if not centers:
        return None
    center, wnb = _rng.choice(centers)
    return [wnb[0], center, wnb[1]]
```

- [ ] **Step 4: Run the test to confirm it passes**

Run: `cd infrastructure/lambda && python -m pytest tests/test_world_event.py -q`
Expected: PASS (2 passed)

- [ ] **Step 5: Commit**

```bash
git add infrastructure/lambda/undercity_db.py infrastructure/lambda/tests/test_world_event.py infrastructure/lambda/tests/conftest.py
git commit -m "feat(undercity): world-event shared-state helpers + footprint picker"
```

---

## Task 4: Spawn on the first sigil-lair kill

**Files:**
- Modify: `infrastructure/lambda/undercity_db.py` (`_finish_lair`, ~line 3008; add `_spawn_world_event`)
- Test: `infrastructure/lambda/tests/test_world_event.py`

- [ ] **Step 1: Write the failing test**

Add to `test_world_event.py`:

```python
def test_first_lair_kill_spawns_world_event_once(table_sid, monkeypatch):
    table, sid = table_sid
    # Deterministic footprint.
    monkeypatch.setattr(db, '_pick_world_event_run',
                        lambda nodes: ['wild_a', 'wild_center', 'wild_b'])
    assert db._world_event(table, sid) is None

    # Simulate the season-global true-boss kill (slain False -> True).
    db._spawn_world_event(table, sid)
    ev = db._world_event(table, sid)
    assert ev is not None
    assert ev['spawned'] is True and ev['dead'] is False
    assert ev['node'] == 'wild_center'
    assert ev['hp'] == ev['maxHp']

    # Idempotent: a second spawn call does not reset or move it.
    ev['hp'] = 50
    db._set_world_event(table, sid, ev)
    db._spawn_world_event(table, sid)
    assert db._world_event(table, sid)['hp'] == 50
```

- [ ] **Step 2: Run it — expect failure**

Run: `cd infrastructure/lambda && python -m pytest tests/test_world_event.py::test_first_lair_kill_spawns_world_event_once -q`
Expected: FAIL — `_spawn_world_event` not defined.

- [ ] **Step 3: Implement `_spawn_world_event` and hook it into the first kill**

Add the spawn function near the other world-event helpers:

```python
def _spawn_world_event(table, sid):
    """Idempotently spawn the season's one World Event. No-op if it already
    exists (spawned or dead). Picks a 3-node wilderness footprint and seeds the
    shared HP pool, then announces it to everyone."""
    if _world_event(table, sid) is not None:
        return
    nodes = _season_map(table, sid)
    run = _pick_world_event_run(nodes)
    if not run:
        return
    rec = {'spawned': True, 'node': run[1], 'nodes': run,
           'hp': config.WORLD_EVENT_HP, 'maxHp': config.WORLD_EVENT_HP,
           'dmg': {}, 'dead': False}
    _set_world_event(table, sid, rec)
    _event(table, sid, 'boss',
           f"A {data.WORLD_EVENT['name']} has emerged in the wilderness — "
           'rally and bring it down together!')
    _broadcast_away(table, sid,
                    {'kind': 'world_spawn', 'name': data.WORLD_EVENT['name'],
                     'at': _now()})
```

Confirm `config` is imported in `undercity_db.py` (the config scalars are used elsewhere — match the existing import name; if the module imports it as `cfg`, use that).

In `_finish_lair`, inside the `if result['outcome'] == 'attacker':` block, the season-global first kill is the `not slain` case. Right after the existing `_set_lair_state(table, sid, node, vest_max, True)` call (line ~3009), add:

```python
        if not slain:
            _spawn_world_event(table, sid)
```

`slain` is the pre-battle flag (`rec['ctx'].get('slain', False)`), so `not slain` is exactly the first-ever kill of *any* lair — spawn is idempotent, so only the first lair across the season actually spawns the beast.

- [ ] **Step 4: Run — expect pass**

Run: `cd infrastructure/lambda && python -m pytest tests/test_world_event.py -q`
Expected: PASS (all)

- [ ] **Step 5: Full suite stays green**

Run: `cd infrastructure/lambda && python -m pytest tests -q`
Expected: PASS (no regressions)

- [ ] **Step 6: Commit**

```bash
git add infrastructure/lambda/undercity_db.py infrastructure/lambda/tests/test_world_event.py
git commit -m "feat(undercity): spawn world event on first sigil-lair kill"
```

---

## Task 5: Resolve-space overlay + engage action

**Files:**
- Modify: `infrastructure/lambda/undercity_db.py` (`_resolve_space` ~line 2262; handlers map ~line 1279; add `_world_engage`)
- Test: `infrastructure/lambda/tests/test_world_event.py`

- [ ] **Step 1: Write the failing test**

Add to `test_world_event.py`:

```python
def _place_live_event(table, sid, monkeypatch):
    monkeypatch.setattr(db, '_pick_world_event_run',
                        lambda nodes: ['wild_a', 'wild_center', 'wild_b'])
    db._spawn_world_event(table, sid)


def test_landing_on_event_node_returns_world_event_space(table_sid, monkeypatch, joined_player):
    table, sid, uid = joined_player
    _place_live_event(table, sid, monkeypatch)
    doc = db._get_player(table, sid, uid)
    ev = db._resolve_space(table, sid, doc, 'wild_center', prev=None)
    assert ev['type'] == 'world_event'
    assert ev['hp'] == db._world_event(table, sid)['hp']
    assert ev['name'] == data.WORLD_EVENT['name']


def test_world_engage_starts_world_battle(table_sid, monkeypatch, joined_player):
    table, sid, uid = joined_player
    _place_live_event(table, sid, monkeypatch)
    doc = db._get_player(table, sid, uid)
    doc['position'] = 'wild_a'
    db._put_player(table, doc)
    status, body = db.handle_action({'type': 'world-engage'}, uid, 'Tester')
    assert status == 200
    assert body['spaceEvent']['type'] == 'battle_start'
    assert body['spaceEvent']['kind'] == 'world'
```

Use whatever `joined_player` fixture / `handle_action` entrypoint the existing tests use (check `test_undercity_db.py`); adapt names to match. If action dispatch in tests goes through a different function name, mirror that call.

- [ ] **Step 2: Run — expect failure**

Run: `cd infrastructure/lambda && python -m pytest tests/test_world_event.py -q`
Expected: FAIL — `world_event` space type / `world-engage` handler missing.

- [ ] **Step 3: Add the resolve-space overlay**

In `_resolve_space`, immediately after the Umori override block (after line ~2261, before `if ntype == 'loot':`), insert:

```python
    # World Event overlay: a live Great Beast squats on 3 wilderness nodes and
    # overrides their normal event. Runs after snare/pile/Umori, before the
    # node's own type dispatch.
    we = _world_event(table, sid)
    if we and we.get('spawned') and not we.get('dead') and node in we.get('nodes', []):
        return {'type': 'world_event', 'node': node, 'center': we['node'],
                'nodes': we['nodes'], 'hp': we['hp'], 'maxHp': we['maxHp'],
                'name': data.WORLD_EVENT['name'], 'spriteId': data.WORLD_EVENT['spriteId'],
                'text': f"The {data.WORLD_EVENT['name']} looms over the mire. "
                        'Wade in and strike — every blow is tallied.'}
```

- [ ] **Step 4: Add the engage handler + dispatcher entry**

Add the handler (near `_battle` / the combat handlers):

```python
def _world_engage(table, sid, doc, payload):
    """Start a bounded skirmish against the live World Event. The player must be
    standing on one of its nodes. Loads the current shared pool as the NPC's HP;
    the round cap + damage banking are handled in _conclude_round/_finish_battle."""
    we = _world_event(table, sid)
    if not we or not we.get('spawned') or we.get('dead'):
        return _err('There is no World Event to fight right now.', 409)
    if doc.get('position') not in we.get('nodes', []):
        return _err('You must be standing on the beast to strike it.', 409)
    if doc.get('battle'):
        return _err('You are already in a fight.', 409)
    spec = data.WORLD_EVENT
    npc = dict(spec, hp=we['hp'], maxHp=we['maxHp'], name=spec['name'])
    return _start_battle(table, sid, doc, 'world', npc, node=doc['position'],
                         ctx={'poolStart': we['hp']})
```

Add to the `handlers` dict (~line 1298):

```python
        'world-engage': _world_engage,
```

- [ ] **Step 5: Run — expect pass**

Run: `cd infrastructure/lambda && python -m pytest tests/test_world_event.py -q`
Expected: PASS

- [ ] **Step 6: Commit**

```bash
git add infrastructure/lambda/undercity_db.py infrastructure/lambda/tests/test_world_event.py
git commit -m "feat(undercity): world-event resolve-space overlay + engage action"
```

---

## Task 6: 6-round skirmish cap

**Files:**
- Modify: `infrastructure/lambda/undercity_db.py` (`_conclude_round` ~line 2770; add `_round_cap`)
- Test: `infrastructure/lambda/tests/test_world_event.py`

- [ ] **Step 1: Write the failing test**

Add to `test_world_event.py`:

```python
def test_world_skirmish_caps_at_six_rounds(table_sid, monkeypatch, joined_player):
    table, sid, uid = joined_player
    _place_live_event(table, sid, monkeypatch)
    doc = db._get_player(table, sid, uid)
    doc['position'] = 'wild_center'
    db._put_player(table, doc)
    db.handle_action({'type': 'world-engage'}, uid, 'Tester')

    last = None
    for _ in range(10):  # more than the cap
        status, body = db.handle_action(
            {'type': 'combat-round', 'stance': 'fight'}, uid, 'Tester')
        last = body
        doc = db._get_player(table, sid, uid)
        if not doc.get('battle'):
            break
    # The battle ended (no dangling battle) at or before round 6.
    assert db._get_player(table, sid, uid).get('battle') is None
    assert 'spaceEvent' in last  # the finishing round returns a spaceEvent
```

- [ ] **Step 2: Run — expect failure**

Run: `cd infrastructure/lambda && python -m pytest tests/test_world_event.py::test_world_skirmish_caps_at_six_rounds -q`
Expected: FAIL — the fight runs to `COMBAT_HARD_CAP` (24) / player dies, not a clean cap.

- [ ] **Step 3: Add the per-kind round cap**

Add the helper near `_frenzy_from` (~line 580):

```python
def _round_cap(kind):
    """Rounds after which a battle auto-ends. World-event skirmishes are bounded
    (a chip, not a fight-to-KO); everything else uses the global safety cap."""
    if kind == 'world':
        return config.WORLD_EVENT_ROUND_CAP
    return data.COMBAT_HARD_CAP
```

In `_conclude_round`, change the `over` guard (line ~2770) from:

```python
    over = player_c.hp <= 0 or npc_c.hp <= 0 or rnd >= data.COMBAT_HARD_CAP
```

to:

```python
    over = player_c.hp <= 0 or npc_c.hp <= 0 or rnd >= _round_cap(rec['kind'])
```

The existing `else: outcome = 'timeout'` branch already handles "both alive at the cap" — for a world skirmish that is the normal ending (you chipped it and backed off), and a persistent-pool foe lingers at its current HP. Frenzy (`FRENZY_START=4`) still applies, so a skirmish stays dangerous; the player can be composted before round 6, which is acceptable (damage dealt is still banked in Task 7).

- [ ] **Step 4: Run — expect pass**

Run: `cd infrastructure/lambda && python -m pytest tests/test_world_event.py -q`
Expected: PASS

- [ ] **Step 5: Full suite green (the `over` change touches all fights)**

Run: `cd infrastructure/lambda && python -m pytest tests -q`
Expected: PASS

- [ ] **Step 6: Commit**

```bash
git add infrastructure/lambda/undercity_db.py infrastructure/lambda/tests/test_world_event.py
git commit -m "feat(undercity): bounded 6-round world-event skirmish cap"
```

---

## Task 7: Finish branch — bank damage, deplete pool, tiered payout

**Files:**
- Modify: `infrastructure/lambda/undercity_db.py` (`_finish_battle` ~line 2901; add `_finish_world` + `_world_event_payout`)
- Test: `infrastructure/lambda/tests/test_world_event.py`

- [ ] **Step 1: Write the failing tests**

Add to `test_world_event.py`:

```python
def test_skirmish_banks_damage_to_pool_and_dmg_map(table_sid, monkeypatch, joined_player):
    table, sid, uid = joined_player
    _place_live_event(table, sid, monkeypatch)
    doc = db._get_player(table, sid, uid)
    doc['position'] = 'wild_center'
    db._put_player(table, doc)

    start = db._world_event(table, sid)['hp']
    db.handle_action({'type': 'world-engage'}, uid, 'Tester')
    for _ in range(10):
        db.handle_action({'type': 'combat-round', 'stance': 'fight'}, uid, 'Tester')
        if not db._get_player(table, sid, uid).get('battle'):
            break

    we = db._world_event(table, sid)
    dealt = start - we['hp']
    assert dealt >= 0
    assert we['dmg'].get(uid, 0) == dealt


def test_pool_depletion_pays_contributors_by_bracket(table_sid, monkeypatch):
    table, sid = table_sid
    monkeypatch.setattr(db, '_pick_world_event_run',
                        lambda nodes: ['wild_a', 'wild_center', 'wild_b'])
    db._spawn_world_event(table, sid)
    # Two contributors already recorded; pool almost dead.
    we = db._world_event(table, sid)
    we['hp'] = 1
    we['dmg'] = {'u_top': 150, 'u_minor': 25}  # of maxHp 200
    db._set_world_event(table, sid, we)

    # Seed perm + player docs for both so payout can credit them.
    for u, dmg in (('u_top', 150), ('u_minor', 25)):
        p = db._get_perm(table, u); table.put_item(Item=p)

    result = {'outcome': 'timeout', 'attackerHp': 5, 'defenderHp': 0,
              'strikes': []}
    payout = db._world_event_payout(table, sid, killer_uid='u_top')
    assert db._world_event(table, sid)['dead'] is True
    brackets = {r['userId']: r['bracket'] for r in payout}
    assert brackets['u_top'] == 'vanquisher'
    assert brackets['u_minor'] == 'minor'
    # Renown credited to perm.
    assert db._get_perm(table, 'u_top')['renown'] >= 5

    # Idempotent: a second payout call does nothing (already dead).
    assert db._world_event_payout(table, sid, killer_uid='u_top') == []
```

Adjust seeding to match how the existing suite creates player docs (the payout must be able to `_get_player`/`_get_perm` each contributor). If contributors need real PLAYER docs for spores crediting, create them via the join fixture/helper.

- [ ] **Step 2: Run — expect failure**

Run: `cd infrastructure/lambda && python -m pytest tests/test_world_event.py -q`
Expected: FAIL — `_finish_world` / `_world_event_payout` missing.

- [ ] **Step 3: Route `kind == 'world'` in `_finish_battle`**

In `_finish_battle` (line ~2895), extend the kind dispatch:

```python
    if kind in ('wild', 'elite'):
        out = _finish_wild(table, sid, doc, rec, result)
    elif kind == 'barrier':
        out = _finish_barrier(table, sid, doc, rec, result)
    elif kind == 'lair':
        out = _finish_lair(table, sid, doc, rec, result)
    elif kind == 'world':
        out = _finish_world(table, sid, doc, rec, result)
    else:
        out = _finish_boss(table, sid, doc, rec, result)
```

- [ ] **Step 4: Implement `_finish_world` + `_world_event_payout`**

Add near `_finish_lair`:

```python
def _finish_world(table, sid, doc, rec, result):
    """Bank this skirmish's damage into the shared pool + the contributor map.
    Re-reads the live pool (concurrent skirmishes may have chipped it) and
    applies the delta, so no write clobbers another player's contribution. If
    the pool hits 0, resolve the tiered payout to everyone."""
    spec = data.WORLD_EVENT
    dealt = max(0, int(rec['ctx'].get('poolStart', 0)) - int(result['defenderHp']))
    uid = doc['userId']
    # XP for taking part (survivor or not), like other timeouts.
    _grant_xp(table, sid, doc, data.XP_REWARDS['timeout'])

    out = {'type': 'world_event', 'npc': {'name': spec['name'], 'id': spec['id'],
                                          'maxHp': rec['npc']['maxHp']},
           'battle': result, 'dealt': dealt}

    we = _world_event(table, sid)
    if not we or we.get('dead'):
        # Beast already fell (a concurrent killer). Still credit the damage tally
        # for the record, but no double payout.
        out['text'] = f"You land your blows, but the {spec['name']} has already fallen."
        return out

    new_hp = max(0, int(we['hp']) - dealt)
    we['hp'] = new_hp
    we['dmg'][uid] = int(we['dmg'].get(uid, 0)) + dealt
    _set_world_event(table, sid, we)

    if result['outcome'] == 'defender':
        _compost(table, sid, doc,
                 f"{doc['username']} was flung down by the {spec['name']} "
                 f"(it lingers at {new_hp} HP).")
        out['text'] = f"The {spec['name']} hurls you off — but your blows landed ({dealt} dmg). Back to the Gate…"
    else:
        out['text'] = f"You rake the {spec['name']} for {dealt} damage. It shrugs and settles back in."

    if new_hp <= 0:
        payout = _world_event_payout(table, sid, killer_uid=uid)
        out['worldKill'] = True
        mine = next((r for r in payout if r['userId'] == uid), None)
        if mine:
            # The killer's own reward is applied to `doc`/perm inside payout; echo it.
            out['reward'] = {'bracket': mine['bracket'], 'spores': mine['spores'],
                             'renown': mine['renown']}
            out['spores'] = out.get('spores', 0) + mine['spores']
        out['text'] = (f"Your blow fells the {spec['name']}! It collapses into the mire — "
                       'the spoils are shared out by who bled it most.')
    return out


def _world_event_payout(table, sid, killer_uid):
    """Deplete-triggered payout. Marks the event dead (idempotent guard), then
    pays every contributor by damage bracket: spores to their season doc, renown
    to their perm doc, and an awayEvent line so absent players learn of it.
    Returns a list of {userId, bracket, spores, renown} for the caller to echo."""
    we = _world_event(table, sid)
    if not we or we.get('dead'):
        return []
    we['dead'] = True
    we['hp'] = 0
    _set_world_event(table, sid, we)

    max_hp = max(1, int(we['maxHp']))
    dmg = {u: int(v) for u, v in (we.get('dmg') or {}).items() if int(v) > 0}
    if not dmg:
        _event(table, sid, 'boss', f"The {data.WORLD_EVENT['name']} has fallen!")
        return []
    top_uid = max(dmg, key=lambda u: (dmg[u], u))  # deterministic tiebreak

    results = []
    for uid, dealt in dmg.items():
        share = dealt / max_hp
        bracket, reward = data.world_event_reward(share, uid == top_uid)
        # Spores -> season player doc.
        p = _get_player(table, sid, uid)
        if p:
            p['spores'] = p.get('spores', 0) + reward['spores']
            _push_away_event(p, {
                'kind': 'world_kill', 'name': data.WORLD_EVENT['name'],
                'bracket': bracket, 'spores': reward['spores'],
                'renown': reward['renown'], 'at': _now()})
            for _ in range(3):
                if _put_player(table, p):
                    break
                p = _get_player(table, sid, uid)
                if not p:
                    break
        # Renown -> perm doc (spendable, cross-season).
        if reward['renown']:
            perm = _get_perm(table, uid)
            perm['renown'] = perm.get('renown', 0) + reward['renown']
            table.put_item(Item=perm)
        results.append({'userId': uid, 'bracket': bracket,
                        'spores': reward['spores'], 'renown': reward['renown']})

    _event(table, sid, 'boss',
           f"The {data.WORLD_EVENT['name']} has fallen! The wilderness quiets.")
    # News line for players who dealt no damage.
    _broadcast_away(table, sid, {'kind': 'world_fallen',
                                 'name': data.WORLD_EVENT['name'], 'at': _now()})
    return results
```

Notes for the implementer:
- `_finish_battle` already `_save_or_conflict`s `doc` after the finisher returns, so the killer's spores echoed via `out['spores']` are additive display; the killer's *actual* spores were credited to their season doc inside `_world_event_payout` (which re-reads and writes `p`). To avoid double-crediting the killer, do **not** also add to `doc['spores']` in `_finish_world` — only echo in `out['spores']` for the client. Confirm `out['spores']` is display-only in the response shape (compare with `_finish_lair`, where `out['spores']` mirrors the credited amount). If the client expects `out['spores']` to equal the delta applied to the returned `doc`, then instead skip crediting the killer inside payout and credit them here once. **Pick one path and add a test asserting the killer's final spores increased by exactly the bracket amount.**
- The `result` dict fields used are `outcome` and `defenderHp` — both present in the standard combat result (see `_conclude_round`).

- [ ] **Step 5: Run — expect pass**

Run: `cd infrastructure/lambda && python -m pytest tests/test_world_event.py -q`
Expected: PASS

- [ ] **Step 6: Full suite green**

Run: `cd infrastructure/lambda && python -m pytest tests -q`
Expected: PASS

- [ ] **Step 7: Commit**

```bash
git add infrastructure/lambda/undercity_db.py infrastructure/lambda/tests/test_world_event.py
git commit -m "feat(undercity): world-event damage banking + tiered payout"
```

---

## Task 8: Expose `worldEvent` in the state payload

**Files:**
- Modify: `infrastructure/lambda/undercity_db.py` (state builder ~line 1173; add `_world_event_public`)
- Test: `infrastructure/lambda/tests/test_world_event.py`

- [ ] **Step 1: Write the failing test**

Add to `test_world_event.py`:

```python
def test_state_exposes_world_event_block(table_sid, monkeypatch, joined_player):
    table, sid, uid = joined_player
    _place_live_event(table, sid, monkeypatch)
    status, state = db.get_state(uid)  # match the real state entrypoint name
    assert status == 200
    we = state['worldEvent']
    assert we['nodes'] == ['wild_a', 'wild_center', 'wild_b']
    assert we['center'] == 'wild_center'
    assert we['dead'] is False
    assert we['spriteId'] == 'moor_wyrm'
```

Match `db.get_state` to whatever the suite uses to fetch state (grep `test_undercity_db.py` for the state call).

- [ ] **Step 2: Run — expect failure**

Run: `cd infrastructure/lambda && python -m pytest tests/test_world_event.py::test_state_exposes_world_event_block -q`
Expected: FAIL — `KeyError: 'worldEvent'`.

- [ ] **Step 3: Add the public projection + wire it into the payload**

Add helper near `_world_event`:

```python
def _world_event_public(table, sid):
    """Client-facing world-event block, or None if it never spawned."""
    we = _world_event(table, sid)
    if not we:
        return None
    return {'nodes': we['nodes'], 'center': we['node'],
            'hp': we['hp'], 'maxHp': we['maxHp'],
            'name': data.WORLD_EVENT['name'], 'spriteId': data.WORLD_EVENT['spriteId'],
            'dead': bool(we.get('dead'))}
```

In the state `out = { ... }` dict (line ~1173), add a key next to `'boss'`:

```python
        'worldEvent': _world_event_public(table, sid),
```

- [ ] **Step 4: Run — expect pass**

Run: `cd infrastructure/lambda && python -m pytest tests/test_world_event.py -q`
Expected: PASS

- [ ] **Step 5: Full suite green + commit**

```bash
cd infrastructure/lambda && python -m pytest tests -q
git add infrastructure/lambda/undercity_db.py infrastructure/lambda/tests/test_world_event.py
git commit -m "feat(undercity): expose worldEvent in game state payload"
```

---

## Task 9: Sprite asset

**Files:**
- Create: `public/undercity/sigil_boss/moor_wyrm.png`

- [ ] **Step 1: Convert the existing `.jfif` to `.png`**

The source is `public/undercity/sigil_boss/moor_wyrm.jfif` (JPEG data). Convert to PNG (keeps every Undercity sprite consistently `.png`). Using ImageMagick if available:

Run (Bash tool): `cd /a/Coding/game-day-site && magick public/undercity/sigil_boss/moor_wyrm.jfif public/undercity/sigil_boss/moor_wyrm.png && ls -la public/undercity/sigil_boss/moor_wyrm.png`
Expected: a `moor_wyrm.png` file is created.

If `magick`/ImageMagick is not installed, use Python Pillow:
`cd /a/Coding/game-day-site && python -c "from PIL import Image; Image.open('public/undercity/sigil_boss/moor_wyrm.jfif').save('public/undercity/sigil_boss/moor_wyrm.png')"`

If neither is available, stop and ask the user to convert the file (do not ship a `.jfif` reference — flag it).

- [ ] **Step 2: Commit**

```bash
git add public/undercity/sigil_boss/moor_wyrm.png
git commit -m "asset(undercity): moor-wyrm world-event sprite (png)"
```

---

## Task 10: Client models

**Files:**
- Modify: `src/app/undercity/services/undercity-models.ts`

- [ ] **Step 1: Add `'world'` to the combat-kind unions**

At lines ~348 and ~540, add `'world'`:

```typescript
  kind: 'wild' | 'elite' | 'barrier' | 'lair' | 'boss' | 'world';
```
```typescript
  kind?: 'wild' | 'elite' | 'barrier' | 'lair' | 'boss' | 'world';
```

- [ ] **Step 2: Add the `WorldEventState` interface + state field**

Add an interface near the other state models:

```typescript
export interface WorldEventState {
  nodes: string[];
  center: string;
  hp: number;
  maxHp: number;
  name: string;
  spriteId: string;
  dead: boolean;
}
```

Add to the top-level game-state interface (where `boss`, `guardians` live):

```typescript
  worldEvent?: WorldEventState | null;
```

- [ ] **Step 3: Add the `world_event` space-event shape**

Extend the `SpaceEvent` union/interface (the `type` field near line ~539) to allow `'world_event'` and its fields:

```typescript
  // world_event (landing on a live World Event node)
  center?: string;
  nodes?: string[];
  spriteId?: string;
  // world_event finish echo
  dealt?: number;
  worldKill?: boolean;
  reward?: { bracket: string; spores: number; renown: number };
```

Add `'world_event'` to the `SpaceEvent['type']` string union.

- [ ] **Step 4: Verify the client still compiles**

Run (Bash tool): `cd /a/Coding/game-day-site && npm run build`
Expected: build succeeds (no TS errors). (This project has no unit-test runner; the production build is the type check.)

- [ ] **Step 5: Commit**

```bash
git add src/app/undercity/services/undercity-models.ts
git commit -m "feat(undercity): client models for world event"
```

---

## Task 11: Client data mirror

**Files:**
- Create: `src/app/undercity/data/world-event.ts`

- [ ] **Step 1: Create the mirror**

```typescript
// Display mirror of the server World Event tunables
// (infrastructure/lambda/undercity_config.py + undercity_data.py). Keep in sync
// when server numbers change — see CLAUDE.md mirror convention.

export const WORLD_EVENT = {
  id: 'moor_wyrm',
  name: 'The Moor-Wyrm',
  spriteId: 'moor_wyrm',
  roundCap: 6,
  rewards: {
    vanquisher: { spores: 120, renown: 5 },
    major: { spores: 80, renown: 3 },
    minor: { spores: 45, renown: 2 },
    participant: { spores: 20, renown: 0 },
  } as Record<string, { spores: number; renown: number }>,
};

export const WORLD_EVENT_SPRITE = 'undercity/sigil_boss/moor_wyrm.png';
```

- [ ] **Step 2: Build check + commit**

```bash
cd /a/Coding/game-day-site && npm run build
git add src/app/undercity/data/world-event.ts
git commit -m "feat(undercity): client mirror of world-event numbers"
```

---

## Task 12: Board-canvas rendering (sprite across 3 nodes + HP bar)

**Files:**
- Modify: `src/app/undercity/engine/board-canvas.ts`

- [ ] **Step 1: Load the sprite**

Find where board-canvas loads/caches other node/guardian images (grep `new Image(` / an image cache map in `board-canvas.ts`). Add a lazily-loaded image for `WORLD_EVENT_SPRITE` (import from `../data/world-event`). Follow the exact caching pattern already used for guardian/boss art so it participates in the same "images loaded → redraw" flow.

- [ ] **Step 2: Draw the beast + HP bar + tile highlight**

In the board draw routine, after nodes are drawn and before/with the players layer, add a block gated on the state's `worldEvent`:

```typescript
const we = this.state?.worldEvent;
if (we && !we.dead) {
  const nodes = we.nodes
    .map(id => this.nodePos(id))   // reuse the existing node→pixel helper
    .filter(Boolean) as { x: number; y: number }[];
  // Highlight the three tiles.
  for (const p of nodes) {
    ctx.save();
    ctx.strokeStyle = 'rgba(180, 40, 60, 0.9)';
    ctx.lineWidth = 3;
    ctx.beginPath();
    ctx.arc(p.x, p.y, this.nodeRadius * 1.15, 0, Math.PI * 2);
    ctx.stroke();
    ctx.restore();
  }
  // Sprite centered on the middle node, scaled to span the run.
  const center = this.nodePos(we.center);
  const img = this.worldEventImg; // the cached Image from Step 1
  if (center && img?.complete) {
    const span = this.nodeRadius * 4;      // ~3 tiles wide
    ctx.drawImage(img, center.x - span / 2, center.y - span / 2, span, span);
  }
  // Shared HP bar above the center.
  if (center) {
    const w = this.nodeRadius * 3, h = 7;
    const x = center.x - w / 2, y = center.y - this.nodeRadius * 2.4;
    ctx.fillStyle = 'rgba(0,0,0,0.6)'; ctx.fillRect(x - 1, y - 1, w + 2, h + 2);
    ctx.fillStyle = '#3a1f26'; ctx.fillRect(x, y, w, h);
    const pct = Math.max(0, Math.min(1, we.hp / we.maxHp));
    ctx.fillStyle = '#c62f3f'; ctx.fillRect(x, y, w * pct, h);
  }
}
```

Use the real helper names from `board-canvas.ts` — `this.nodePos(id)`, `this.nodeRadius`, and the class's `ctx`/`state` fields are placeholders for whatever the file actually calls them. Grep the file first and match its conventions (it already draws the Savra boss + guardians, so an equivalent overlay exists to copy).

- [ ] **Step 3: Build check**

Run (Bash tool): `cd /a/Coding/game-day-site && npm run build`
Expected: build succeeds.

- [ ] **Step 4: Commit**

```bash
git add src/app/undercity/engine/board-canvas.ts
git commit -m "feat(undercity): render world-event beast across its 3 nodes"
```

---

## Task 13: Board-tab modal + engage flow + event copy

**Files:**
- Modify: `src/app/undercity/tabs/board-tab.component.ts`

- [ ] **Step 1: Add `'world'` to the interactive-fight types**

At line ~1345, add `'world'` so an engaged skirmish opens the combat UI:

```typescript
    const fightTypes = ['wild', 'elite', 'barrier', 'lair', 'boss', 'world'];
```

- [ ] **Step 2: Route the `world_event` space event to a modal**

In `routeSpaceEvent` (~line 1329), before the generic handling, add a branch: when `ev.type === 'world_event'`, open a modal showing the beast name, sprite, the shared HP bar (`ev.hp`/`ev.maxHp`), the flavor `ev.text`, and an **Engage (6 rounds)** button. Follow the existing modal-opening pattern used for `shop`/`shrine`/`world_event`-like informational spaces (grep how a non-combat space like `'shrine'` opens its modal component and mirror it — set a `this.worldEventModal = ev` field bound in the template, or reuse the generic space-modal if one exists).

The Engage button calls a new method:

```typescript
engageWorldEvent(): void {
  this.worldEventModal = null;
  this.api.action({ type: 'world-engage' }).subscribe(resp => {
    if (resp.spaceEvent) {
      this.routeSpaceEvent(resp.spaceEvent, this.you?.hp ?? 0);
    }
  });
}
```

Match `this.api.action(...)`, the response handling, and the `preHp` argument to how the component already fires actions (e.g. how the `battle`/`combat-round` calls are made around lines 378 / 1827). Reuse the existing subscribe/finish plumbing rather than inventing new flow.

- [ ] **Step 3: Handle the finish echo (kill + reward)**

Where the component renders a finished fight's `spaceEvent` (the `finishLiveBattle` path, ~line 1828/1856), add copy for `ev.type === 'world_event'`:
- always show `ev.text` and `ev.dealt` ("you dealt N damage").
- if `ev.worldKill && ev.reward`, show a celebratory line: `"The Moor-Wyrm falls! You placed in the {reward.bracket} bracket: +{reward.spores} Spores, +{reward.renown} Renown."`

Reuse the existing result-toast/modal mechanism the other fight types use (copy the `lair`/`boss` finish rendering and adapt the strings).

- [ ] **Step 4: (Optional) Spawn/fallen news copy**

If the component renders `awayEvents` / `events` with per-kind copy (grep for `'boss'` / `kind ===` in the events rendering), add lines for the new away-event kinds `world_spawn`, `world_kill`, `world_fallen` so returning players see them. If events are rendered generically from server `text`, no change is needed (the server already provides `_event` text).

- [ ] **Step 5: Build check**

Run (Bash tool): `cd /a/Coding/game-day-site && npm run build`
Expected: build succeeds.

- [ ] **Step 6: Commit**

```bash
git add src/app/undercity/tabs/board-tab.component.ts
git commit -m "feat(undercity): world-event modal, engage flow, and result copy"
```

---

## Task 14: Manual end-to-end verification

**Files:** none (verification only)

- [ ] **Step 1: Server suite green**

Run: `cd infrastructure/lambda && python -m pytest tests -q`
Expected: PASS (including all `test_world_event.py` cases).

- [ ] **Step 2: Client builds**

Run (Bash tool): `cd /a/Coding/game-day-site && npm run build`
Expected: PASS.

- [ ] **Step 3: Drive the board (use the run-undercity skill)**

Follow the **run-undercity** skill to launch the app against the live backend and reach a state where a lair is cleared. Confirm:
- After the first sigil lair falls, the beast appears on 3 adjacent wilderness tiles with its sprite centered and a shared HP bar.
- Landing on any of the 3 tiles opens the world-event modal; Engage runs a fight that ends by round 6.
- Damage reduces the shared HP bar for everyone; repeated landings keep chipping.
- When the pool empties, the beast despawns and a bracketed reward (spores + renown) is shown.

Note (per project convention): the user runs deploys. End with tests green + build clean and tell the user a Lambda deploy is required for the server rules to go live.

- [ ] **Step 4: Update the design spec's status if needed and finish**

If any design decision changed during implementation (e.g. killer-spores crediting path in Task 7), reconcile the spec text so it matches the shipped behavior, then use the **finishing-a-development-branch** skill to decide merge/PR.

---

## Self-Review

**Spec coverage:**
- Trigger (first lair kill, once, global) → Task 4 (`not slain` hook, idempotent spawn). ✓
- 3 adjacent wilderness nodes, sprite centered → Task 3 (footprint picker), Task 12 (render). ✓
- Overlay engage on landing on any of 3 → Task 5. ✓
- 6-round bounded skirmish, repeatable, no cooldown → Task 6 (`_round_cap`), Task 5 (no per-player lock). ✓
- Damage banked to shared pool + per-player map → Task 7 (`_finish_world`). ✓
- Death → tiered renown+spores payout to all contributors regardless of location → Task 7 (`_world_event_payout` + `_broadcast_away`/perm renown). ✓
- Stationary, no expiry, one per season → Tasks 3/4 (no roam/expiry code; idempotent spawn). ✓
- State payload + client render + modal → Tasks 8/10/12/13. ✓
- Config scalars + client mirror → Tasks 1/11. ✓
- Sprite from unused `sigil_boss` pool, converted to png → Task 9. ✓
- Tests keep suite green → Tasks 3-8, 14. ✓

**Placeholder scan:** No "TBD"/"handle edge cases". The only deliberate open decision (killer-spores single-credit path) is called out in Task 7 Step 4 with an explicit instruction to pick one path and add an asserting test.

**Type consistency:** `_world_event`/`_set_world_event`/`_spawn_world_event`/`_world_event_payout`/`_world_event_public`/`_pick_world_event_run`/`_round_cap`/`_finish_world` names used consistently across tasks. Space-event `type` is `'world_event'` everywhere; combat `kind` is `'world'` everywhere. Reward bracket keys (`vanquisher`/`major`/`minor`/`participant`) match between config, `world_event_reward`, payout, and the client mirror. `worldEvent` state key matches between server payload (Task 8) and client model (Task 10).
