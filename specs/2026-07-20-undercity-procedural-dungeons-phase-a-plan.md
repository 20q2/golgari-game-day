# Procedural Dungeons — Phase A (De-globalize the map) Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Make the board map a per-season value instead of a hard global, behind a default-off flag, with zero behavior change — so Phase C can swap in generated depths by flipping one switch.

**Architecture:** Split the committed map into a fixed `SURFACE_NODES` half and a `COMMITTED_DEPTHS` half. Add `_season_map(table, sid)` in `undercity_db.py` that returns the committed board unchanged when the flag is off, or `surface + this-season's-stored-depths` when on. Route every `data.MAP_NODES` read in `undercity_db.py` through it (the engine already takes the map as a parameter). Add a read-only `GET /game/map` endpoint that serves the night's board.

**Tech Stack:** Python 3.11 Lambda, pytest (in-memory `FakeTable` suite).

Design: [specs/2026-07-20-undercity-procedural-dungeons-design.md](2026-07-20-undercity-procedural-dungeons-design.md).

**Test loop:** `cd infrastructure/lambda && python -m pytest tests -q`

**Scope note:** This plan is Phase A only. The generator (`undercity_mapgen.py`) is Phase B; wiring it into `season-start`, switching the client's map fetch to `GET /game/map`, and converting the golden map tests to invariants are Phase C. Phase A must leave the entire existing suite green with no assertion changes.

---

## File Structure

- `infrastructure/lambda/undercity_config.py` — **modify**: add `PROCEDURAL_DUNGEONS` flag (default `False`).
- `infrastructure/lambda/undercity_data.py` — **modify**: add `SURFACE_NODES`, `COMMITTED_DEPTHS`, pure `merge_map()`.
- `infrastructure/lambda/undercity_db.py` — **modify**: add `_load_season_depths`, `_season_map`, `_season_map_cache`, `handle_map`; migrate all `data.MAP_NODES` reads to `_season_map`.
- `infrastructure/lambda/lambda_function.py` — **modify**: route `GET /game/map`.
- `infrastructure/lambda/tests/test_procedural_map.py` — **create**: unit + integration tests for the above.

---

## Task 1: Flag + surface/depths split

**Files:**
- Modify: `infrastructure/lambda/undercity_config.py` (end of file)
- Modify: `infrastructure/lambda/undercity_data.py` (after `MAP_NODES` at ~line 835)
- Create: `infrastructure/lambda/tests/test_procedural_map.py`

- [ ] **Step 1: Write the failing test**

Create `infrastructure/lambda/tests/test_procedural_map.py`:

```python
"""Procedural dungeons Phase A: per-season map plumbing (generation still off)."""
import sys
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parents[1]))

import undercity_data as data
import undercity_db as db
import undercity_engine as engine
from tests.test_undercity_db import act, table, _sid  # reuse harness + fixture


def test_flag_defaults_off():
    assert data.PROCEDURAL_DUNGEONS is False


def test_surface_and_committed_depths_partition_the_map():
    assert set(data.SURFACE_NODES) | set(data.COMMITTED_DEPTHS) == set(data.MAP_NODES)
    assert not (set(data.SURFACE_NODES) & set(data.COMMITTED_DEPTHS))
    assert all(n.get('region') != 'depths' for n in data.SURFACE_NODES.values())
    assert all(n.get('region') == 'depths' for n in data.COMMITTED_DEPTHS.values())


def test_merge_map_reconstructs_committed_map():
    assert data.merge_map(data.COMMITTED_DEPTHS) == data.MAP_NODES
```

- [ ] **Step 2: Run to verify it fails**

Run: `cd infrastructure/lambda && python -m pytest tests/test_procedural_map.py -q`
Expected: FAIL — `AttributeError: module 'undercity_data' has no attribute 'PROCEDURAL_DUNGEONS'`.

- [ ] **Step 3: Add the config flag**

Append to `infrastructure/lambda/undercity_config.py`:

```python

# ── Procedural dungeons ──────────────────────────────────────────────────────
# When True, each night's five dungeon pockets are regenerated from a per-season
# graph (built at season-start, stored on the SEASON#<sid>/MAP record) instead of
# the committed depths in map.json. Off = the committed board, exactly as before.
# See specs/2026-07-20-undercity-procedural-dungeons-design.md.
PROCEDURAL_DUNGEONS = False
```

- [ ] **Step 4: Add the surface/depths split + merge helper**

In `infrastructure/lambda/undercity_data.py`, immediately after the `MAP_NODES = {...}` line (~835), add:

```python
# The board splits into a fixed surface and regenerable dungeon pockets. The
# depths (region == 'depths') are procedurally regenerated per night when
# PROCEDURAL_DUNGEONS is on (see the procedural-dungeons design); everything else
# is the fixed committed board.
SURFACE_NODES = {nid: n for nid, n in MAP_NODES.items() if n.get('region') != 'depths'}
COMMITTED_DEPTHS = {nid: n for nid, n in MAP_NODES.items() if n.get('region') == 'depths'}


def merge_map(depths):
    """Full node graph = fixed surface + a night's depths (dict of node dicts).
    Pure; callers supply the depths (stored, generated, or COMMITTED_DEPTHS)."""
    return {**SURFACE_NODES, **depths}
```

- [ ] **Step 5: Run to verify it passes**

Run: `cd infrastructure/lambda && python -m pytest tests/test_procedural_map.py -q`
Expected: PASS (3 passed).

- [ ] **Step 6: Commit**

```bash
git add infrastructure/lambda/undercity_config.py infrastructure/lambda/undercity_data.py \
        infrastructure/lambda/tests/test_procedural_map.py
git commit -m "feat(undercity): flag + surface/depths split for procedural dungeons"
```

---

## Task 2: `_season_map` accessor + cache

**Files:**
- Modify: `infrastructure/lambda/undercity_db.py` (near `_get`/`_season_pk`, ~line 145)
- Modify: `infrastructure/lambda/tests/test_procedural_map.py`

- [ ] **Step 1: Write the failing tests**

Append to `tests/test_procedural_map.py`:

```python
def test_season_map_off_returns_committed_object(table, monkeypatch):
    monkeypatch.setattr(data, 'PROCEDURAL_DUNGEONS', False)
    sid = _sid(table)
    assert db._season_map(table, sid) is data.MAP_NODES   # identical object, no copy


def test_season_map_on_merges_stored_depths(table, monkeypatch):
    monkeypatch.setattr(data, 'PROCEDURAL_DUNGEONS', True)
    db._season_map_cache.clear()
    sid = _sid(table)
    stub = [{'id': 'city_lb', 'type': 'ladder', 'x': 7, 'y': 7,
             'region': 'depths', 'neighbors': []}]
    table.put_item(Item={'pk': db._season_pk(sid), 'sk': 'MAP', 'depths': stub})
    nodes = db._season_map(table, sid)
    assert nodes['city_lb']['x'] == 7          # from the stored depths
    assert 'cavern_r0' in nodes                # surface preserved
    assert 'garden_lair' not in nodes          # committed depths NOT mixed in


def test_season_map_on_falls_back_when_no_record(table, monkeypatch):
    monkeypatch.setattr(data, 'PROCEDURAL_DUNGEONS', True)
    db._season_map_cache.clear()
    sid = _sid(table)
    nodes = db._season_map(table, sid)
    assert 'city_lair' in nodes                # committed depths fallback
```

- [ ] **Step 2: Run to verify they fail**

Run: `cd infrastructure/lambda && python -m pytest tests/test_procedural_map.py -k season_map -q`
Expected: FAIL — `AttributeError: module 'undercity_db' has no attribute '_season_map'`.

- [ ] **Step 3: Implement the accessor + cache**

In `infrastructure/lambda/undercity_db.py`, right after the `_get` helper (ends ~line 144), add:

```python
_season_map_cache = {}   # sid -> merged node dict for the night (built once)


def _load_season_depths(table, sid):
    """This night's depths pockets. Reads the SEASON#<sid>/MAP record; falls back
    to the committed depths when absent (a legacy season, or generation disabled)."""
    rec = _get(table, _season_pk(sid), 'MAP')
    if rec and rec.get('depths'):
        return {n['id']: n for n in rec['depths']}
    return data.COMMITTED_DEPTHS


def _season_map(table, sid):
    """The full node graph for the night: fixed surface + this season's depths,
    cached per sid. With PROCEDURAL_DUNGEONS off, returns the committed board
    unchanged (same object) so behaviour is exactly as before."""
    if not data.PROCEDURAL_DUNGEONS:
        return data.MAP_NODES
    cached = _season_map_cache.get(sid)
    if cached is None:
        cached = data.merge_map(_load_season_depths(table, sid))
        _season_map_cache[sid] = cached
    return cached
```

Note: `_season_pk` and `_get` are defined above this point; `data.COMMITTED_DEPTHS` / `data.merge_map` come from Task 1.

- [ ] **Step 4: Run to verify they pass**

Run: `cd infrastructure/lambda && python -m pytest tests/test_procedural_map.py -k season_map -q`
Expected: PASS (3 passed).

- [ ] **Step 5: Commit**

```bash
git add infrastructure/lambda/undercity_db.py infrastructure/lambda/tests/test_procedural_map.py
git commit -m "feat(undercity): per-season map accessor with committed fallback"
```

---

## Task 3: Route every db map read through `_season_map`

The engine already takes the map as a parameter, so this is confined to `undercity_db.py`. There are 31 `data.MAP_NODES` reads. Every containing function already has `table` and `sid` in scope **except** `_wild_warp_dest(node)`.

**Mechanical rule:** in each function that reads `data.MAP_NODES`, add `nodes = _season_map(table, sid)` once near the top and replace that function's `data.MAP_NODES` occurrences with `nodes`. The lone exception is `_wild_warp_dest`, which gets the map passed in.

**Files:**
- Modify: `infrastructure/lambda/undercity_db.py` (all 31 sites)
- Modify: `infrastructure/lambda/tests/test_procedural_map.py`

- [ ] **Step 1: Write the completeness guard + behavior test**

Append to `tests/test_procedural_map.py`:

```python
def test_no_direct_map_global_left_in_db():
    src = (Path(__file__).resolve().parents[1] / 'undercity_db.py').read_text(encoding='utf-8')
    assert 'data.MAP_NODES' not in src, \
        'route every map read through _season_map(table, sid) / passed-in nodes'


def test_movement_follows_generated_depths_when_on(table, monkeypatch):
    monkeypatch.setattr(data, 'PROCEDURAL_DUNGEONS', True)
    db._season_map_cache.clear()
    act(table, 'join', starter='pest', home='cavern')
    sid = _sid(table)
    # Alternate depths: cavern_lb gains a neighbor the committed map never had.
    stub = [
        {'id': 'cavern_lb', 'type': 'ladder', 'x': 100, 'y': 100,
         'region': 'depths', 'neighbors': ['cavern_x9']},
        {'id': 'cavern_x9', 'type': 'loot', 'x': 160, 'y': 100,
         'region': 'depths', 'neighbors': ['cavern_lb']},
    ]
    table.put_item(Item={'pk': db._season_pk(sid), 'sk': 'MAP', 'depths': stub})
    doc = db._get_player(table, sid, 'user-alex')
    doc['position'] = 'cavern_lb'
    dests = engine.legal_destinations(
        db._season_map(table, sid), 'cavern_lb', 1,
        db._closed_barriers(table, sid), db._blocked_nodes(doc))
    assert 'cavern_x9' in dests
```

- [ ] **Step 2: Run to verify the guard fails**

Run: `cd infrastructure/lambda && python -m pytest tests/test_procedural_map.py -k "no_direct_map or movement_follows" -q`
Expected: `test_no_direct_map_global_left_in_db` FAILS (31 references still present).

- [ ] **Step 3: Change `_wild_warp_dest` to take the map**

Replace the signature and body header of `_wild_warp_dest` (currently `def _wild_warp_dest(node):` reading `data.MAP_NODES.items()`):

```python
def _wild_warp_dest(nodes, node):
    """A random legal node to be flung to — never into a POI, past a barrier, or
    onto a post-boss escape ladder (those are earned, per-player exits)."""
    no_go = {'boss', 'barrier', 'lair', 'vault'}
    options = [n for n, nd in nodes.items()
               if n != node and nd['type'] not in no_go
               and nd.get('region') != 'ruin'
               and n not in data.ESCAPE_LADDERS]
    return _rng.choice(options)
```

Then update its call site inside `_resolve_space` (the `warp` branch). Both the wild-designated and the random-fling paths call it; each is inside `_resolve_space`, which has a local `nodes` (added in Step 4). Change `_wild_warp_dest(node)` → `_wild_warp_dest(nodes, node)` at every call.

- [ ] **Step 4: Migrate the remaining sites, function by function**

For each function below, add `nodes = _season_map(table, sid)` near its top (after `sid` is available) and replace its `data.MAP_NODES` reads with `nodes`. Locate sites with `grep -n 'data.MAP_NODES' undercity_db.py` (line numbers drift as you edit — match by function, not number):

- `handle_state` — the display-seed loops (`trading_post`, `excavation`, `crystal_vein`/`vault_lock`). `sid` is resolved near the top of the function; add `nodes = _season_map(table, sid)` right after the early `if not sid ...` guard returns, then swap the three loops.
- `_admin_teleport` — the `node not in data.MAP_NODES` guard and the `legal_destinations(data.MAP_NODES, …)` call.
- the roll handler — `legal_destinations(data.MAP_NODES, doc['position'], value, …)`.
- `_resolve_space` — the `ntype`/`region` lookups (`data.MAP_NODES[node]['type']`, `.get('region')`) and the two `_wild_warp_dest` calls.
- the snare/pile branch region reads (`data.MAP_NODES[node]['region']`) — same `nodes` local.
- `_mystery` — `data.MAP_NODES.get(doc['position'], {}).get('region')` and `_rng.choice([n for n in data.MAP_NODES if n != data.BOSS_NODE])`.
- the world/lair-group builder — `pocket = [nid for nid, n in data.MAP_NODES.items() …]`.
- the battle-finish respawn line — `prev if prev in data.MAP_NODES[node]['neighbors'] else 'isl_ossuary'`.
- the spell handlers — `board_distance(data.MAP_NODES, …)` (×3) and `to not in data.MAP_NODES`.
- the facility handlers — `shop`, `trading_post`, `excavation`, `crystal_vein`, `vault_lock`, `shrine`, `warp`, `ossuary`, and the `region`/`('gate','boss')` type reads: each `data.MAP_NODES.get(node, {}).get('type')` / `data.MAP_NODES[node]['region']` becomes `nodes.get(...)` / `nodes[...]`.

Each function reads its own `nodes` local; do not thread `nodes` between functions (except into `_wild_warp_dest`).

- [ ] **Step 5: Run the guard + behavior tests, then the FULL suite**

Run: `cd infrastructure/lambda && python -m pytest tests/test_procedural_map.py -q`
Expected: PASS — `test_no_direct_map_global_left_in_db` now green, `test_movement_follows_generated_depths_when_on` green.

Run: `cd infrastructure/lambda && python -m pytest tests -q`
Expected: all green (flag is off by default, so `_season_map` returns `data.MAP_NODES` and every migrated read behaves exactly as before). Investigate any failure before continuing — a red test here means a site was mis-migrated.

- [ ] **Step 6: Commit**

```bash
git add infrastructure/lambda/undercity_db.py infrastructure/lambda/tests/test_procedural_map.py
git commit -m "feat(undercity): route all db map reads through _season_map"
```

---

## Task 4: `GET /game/map` endpoint

Serves the night's full board in the `BoardMap` shape the client already consumes. Not yet wired to the client (Phase C) — built and tested now so it's ready.

**Files:**
- Modify: `infrastructure/lambda/undercity_db.py` (new `handle_map`, near `handle_state` ~line 642)
- Modify: `infrastructure/lambda/lambda_function.py` (`handle_game`, ~line 214)
- Modify: `infrastructure/lambda/tests/test_procedural_map.py`

- [ ] **Step 1: Write the failing test**

Append to `tests/test_procedural_map.py`:

```python
def test_handle_map_returns_boardmap_shape(table):
    status, doc = db.handle_map(table, {})
    assert status == 200
    assert {'worldW', 'worldH', 'gate', 'boss', 'nodes', 'regions'} <= set(doc)
    ids = {n['id'] for n in doc['nodes']}
    assert 'cavern_r0' in ids and 'city_lair' in ids   # surface + depths both present


def test_handle_map_serves_generated_depths_when_on(table, monkeypatch):
    monkeypatch.setattr(data, 'PROCEDURAL_DUNGEONS', True)
    db._season_map_cache.clear()
    sid = _sid(table)
    stub = [{'id': 'city_lb', 'type': 'ladder', 'x': 5, 'y': 5,
             'region': 'depths', 'neighbors': []}]
    table.put_item(Item={'pk': db._season_pk(sid), 'sk': 'MAP', 'depths': stub})
    status, doc = db.handle_map(table, {})
    ids = {n['id'] for n in doc['nodes']}
    assert 'city_lb' in ids and 'garden_lair' not in ids   # night's depths, not committed
```

- [ ] **Step 2: Run to verify it fails**

Run: `cd infrastructure/lambda && python -m pytest tests/test_procedural_map.py -k handle_map -q`
Expected: FAIL — `AttributeError: module 'undercity_db' has no attribute 'handle_map'`.

- [ ] **Step 3: Add `handle_map` to `undercity_db.py`**

Immediately before `def handle_state(` (~line 642), add:

```python
def handle_map(table, query_params):
    """GET /game/map — the night's board: fixed surface + this season's depths,
    in the BoardMap shape the client renders. Falls back to the committed board
    when no season is active."""
    doc = dict(data._MAP_DOC)     # worldW/H, gate, boss, regions, decals, labels
    sid, config = _active_season(table)
    nodes = _season_map(table, sid) if sid else data.MAP_NODES
    doc['nodes'] = list(nodes.values())
    return 200, doc
```

- [ ] **Step 4: Route it in `lambda_function.py`**

In `handle_game` (~line 214), add the map route before the `action` route:

```python
    if sub == 'map' and method == 'GET':
        status, payload = undercity_db.handle_map(table, query_params)
        return create_response(status, payload)
```

- [ ] **Step 5: Run the endpoint tests + full suite**

Run: `cd infrastructure/lambda && python -m pytest tests/test_procedural_map.py -q`
Expected: PASS (all procedural-map tests green).

Run: `cd infrastructure/lambda && python -m pytest tests -q`
Expected: all green.

- [ ] **Step 6: Commit**

```bash
git add infrastructure/lambda/undercity_db.py infrastructure/lambda/lambda_function.py \
        infrastructure/lambda/tests/test_procedural_map.py
git commit -m "feat(undercity): GET /game/map serves the night's board"
```

---

## Verification (whole phase)

- [ ] `cd infrastructure/lambda && python -m pytest tests -q` — all green, no assertions in the pre-existing suite changed.
- [ ] `grep -n 'data.MAP_NODES' infrastructure/lambda/undercity_db.py` returns nothing.
- [ ] Flag is `False` by default — no behavior change ships; the committed board is served exactly as before.
- [ ] Note for the user: no deploy needed to validate (tests only); Phase B (generator) and Phase C (wire-up + client fetch switch + golden→invariant test conversion) follow.

## Self-Review

**Spec coverage (Phase A slice):**
- `PROCEDURAL_DUNGEONS` flag → Task 1. ✔
- `SURFACE_NODES` + pure merge helper → Task 1. ✔
- `season_map` builder + cache + committed fallback → Task 2. ✔
- De-globalize db reads (engine already parameterized) → Task 3, verified by the `data.MAP_NODES`-free guard test. ✔
- `MAP` record load path → Task 2 (`_load_season_depths`). ✔
- `GET /game/map` → Task 4. ✔
- Zero behavior change with flag off → whole-suite-green checks in Tasks 3-4. ✔
- Deferred to later phases (called out in Scope note): generator (B); season-start generation, client fetch switch, golden→invariant conversion (C).

**Placeholder scan:** none — every step shows concrete code or an exact command.

**Type/name consistency:** `PROCEDURAL_DUNGEONS`, `SURFACE_NODES`, `COMMITTED_DEPTHS`, `merge_map`, `_load_season_depths`, `_season_map`, `_season_map_cache`, `handle_map` used identically across tasks. The `MAP` record shape is `{pk, sk:'MAP', depths:[node,…]}` in Task 2's loader, Task 2/3/4 tests, and (later) Phase C's writer. `_season_map(table, sid)` signature is stable everywhere.
