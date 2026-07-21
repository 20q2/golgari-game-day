# Procedural Dungeons — Phase B (The generator) Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Build a pure, deterministic per-night dungeon generator that emits each biome's depths pocket as a grid-carved maze — keeping the biome's identity while randomizing layout and content — and prove it satisfies every board contract over many seeds.

**Architecture:** New standalone module `undercity_mapgen.py` (no boto3, no DynamoDB). A recursive-backtracker maze on a per-biome grid gives planarity and coordinates for free; special rooms (mouth `<biome>_lb`, `_lair`, `_cache`, `_trove`, `_rest`, escape spur `_esc`) are placed onto grid cells and the rest are typed by a fixed quota. Not wired into the game yet — the flag stays off and `season-start` is untouched (that is Phase C).

**Tech Stack:** Python 3.11, pytest. Stdlib only (`hashlib`, `random`).

Design: [specs/2026-07-20-undercity-procedural-dungeons-design.md](2026-07-20-undercity-procedural-dungeons-design.md). Depends on Phase A (merged; `_season_map`/`GET /game/map` already live).

**Test loop:** `cd infrastructure/lambda && python -m pytest tests/test_mapgen.py -q`

**Contracts the generator must satisfy** (mirror `tests/test_deep_dungeons.py`, so Phase C can repoint those at generated pockets):
- ≥ 24 nodes; ids all start with `<biome>_`; region `depths`.
- exactly one each of `<biome>_lb` (mouth, type `ladder`), `<biome>_lair`, `<biome>_cache`, `<biome>_trove`, `<biome>_rest`, `<biome>_esc` (escape spur, type `ladder`).
- `_trove` and `_rest` are dead-ends (one in-pocket neighbor); `_esc` neighbors **only** `<biome>_lair`, and the lair lists `_esc` back.
- the mouth `<biome>_lb` also links to the fixed **surface** node `<biome>_lt` (the committed ladder-top → depths bridge), so the pocket connects to the board.
- every node reachable from the mouth; all in-pocket edges symmetric.
- `<biome>_lair` ≥ 6 hops from the mouth.
- node types drawn only from the depths palette (`ladder, lair, trove, rest, cache, wild, loot, hazard, elite`).

**Per-biome composition target** (matches today's committed pockets): elite 2, hazard ~30% of remaining filler, then wild ~60% / loot ~40% of what's left; ~28-31 nodes each.

---

## File Structure

- `infrastructure/lambda/undercity_mapgen.py` — **create**: the whole generator (constants, `_seed_int`, `_carve`, `_add_loops`, `_bfs`, `_assign_and_build`, `_valid`, `generate_depths`, `generate_all_depths`).
- `infrastructure/lambda/tests/test_mapgen.py` — **create**: unit tests for helpers + property tests over seeds × biomes.

---

## Task 1: Module scaffold + pure helpers

**Files:**
- Create: `infrastructure/lambda/undercity_mapgen.py`
- Create: `infrastructure/lambda/tests/test_mapgen.py`

- [ ] **Step 1: Write the failing helper tests**

Create `infrastructure/lambda/tests/test_mapgen.py`:

```python
"""Procedural dungeon generator (Phase B): pure, deterministic, contract-checked."""
import sys
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parents[1]))

import random
import undercity_mapgen as gen


def test_seed_is_deterministic_and_biome_specific():
    assert gen._seed_int('night-1', 'city') == gen._seed_int('night-1', 'city')
    assert gen._seed_int('night-1', 'city') != gen._seed_int('night-1', 'bog')
    assert gen._seed_int('night-1', 'city') != gen._seed_int('night-2', 'city')


def test_carve_spans_every_cell_connected():
    rng = random.Random(1)
    cells, adj = gen._carve(rng, 4, 5)
    assert len(cells) == 20
    # spanning tree: every cell reachable from (0,0), edges symmetric
    seen, stack = {(0, 0)}, [(0, 0)]
    while stack:
        cur = stack.pop()
        for nb in adj[cur]:
            assert cur in adj[nb]                 # symmetric
            if nb not in seen:
                seen.add(nb); stack.append(nb)
    assert seen == set(cells)


def test_bfs_hop_distances():
    # a straight 1x4 corridor: distances 0,1,2,3
    rng = random.Random(0)
    cells, adj = gen._carve(rng, 1, 4)
    dist = gen._bfs(adj, (0, 0))
    assert dist == {(0, 0): 0, (0, 1): 1, (0, 2): 2, (0, 3): 3}
```

- [ ] **Step 2: Run to verify it fails**

Run: `cd infrastructure/lambda && python -m pytest tests/test_mapgen.py -q`
Expected: FAIL — `ModuleNotFoundError: No module named 'undercity_mapgen'`.

- [ ] **Step 3: Create the module with constants + helpers**

Create `infrastructure/lambda/undercity_mapgen.py`:

```python
"""Procedural per-night dungeon generator (Phase B).

Pure, deterministic, no boto3. Given a season id, produces the five biome
depths pockets: grid-carved mazes that keep each biome's identity (theme,
hazard, wild, lair boss stay fixed via the canonical ids + the DUNGEONS tables)
while randomizing layout and content each night. Emits the canonical node ids
the rest of the code relies on (<biome>_lb mouth, _lair, _cache, _trove, _rest,
_esc escape spur). See specs/2026-07-20-undercity-procedural-dungeons-design.md.
"""
import hashlib
import random

from undercity_data import BIOMES   # biome keys only; no map globals used

# Grid shape per biome (rows, cols) biases the maze's character; every pocket
# ends up >= MIN_NODES nodes. Specials come out of grid cells; the escape spur
# is appended.
GRID = {
    'cavern': (5, 6),    # radial-ish hub
    'bog':    (3, 10),   # long corridor
    'city':   (5, 6),    # serpentine
    'bone':   (5, 6),    # lattice (most extra cross-links)
    'garden': (5, 6),    # tangle
}
EXTRA_LOOPS = {'cavern': 2, 'bog': 1, 'city': 1, 'bone': 4, 'garden': 3}
# Pocket-local world origin per biome (near each committed pocket). Pockets
# render in their own sub-view, so exact placement only needs to be consistent.
POCKET_ORIGIN = {
    'city':   (1300, 2300),
    'cavern': (150, 1150),
    'bog':    (2950, 450),
    'bone':   (450, 1950),
    'garden': (2850, 2050),
}
SPACING = 120
MIN_NODES = 24
LAIR_MIN_HOPS = 6
FILLER_ELITE = 2
FILLER_HAZARD_FRAC = 0.30
FILLER_WILD_FRAC = 0.60      # of what remains after elite + hazard; rest = loot
MAX_ATTEMPTS = 40
_DEPTHS_PALETTE = {'ladder', 'lair', 'trove', 'rest', 'cache',
                   'wild', 'loot', 'hazard', 'elite'}


def _seed_int(season_id, biome):
    """Deterministic 64-bit seed from (season, biome) — hashlib, not hash(), so
    it is stable across processes (independent of PYTHONHASHSEED)."""
    h = hashlib.sha256(f'{season_id}:{biome}'.encode()).digest()
    return int.from_bytes(h[:8], 'big')


def _carve(rng, rows, cols):
    """Recursive-backtracker maze over a rows×cols grid. Returns (cells, adj),
    adj mapping a (r, c) cell to the set of connected neighbor cells — a spanning
    tree (every cell reachable, no crossing corridors)."""
    cells = [(r, c) for r in range(rows) for c in range(cols)]
    adj = {cell: set() for cell in cells}
    seen = {(0, 0)}
    stack = [(0, 0)]
    while stack:
        r, c = stack[-1]
        opts = [(r + dr, c + dc) for dr, dc in ((1, 0), (-1, 0), (0, 1), (0, -1))
                if 0 <= r + dr < rows and 0 <= c + dc < cols
                and (r + dr, c + dc) not in seen]
        if not opts:
            stack.pop()
            continue
        nxt = rng.choice(sorted(opts))      # sorted → deterministic given rng
        adj[(r, c)].add(nxt)
        adj[nxt].add((r, c))
        seen.add(nxt)
        stack.append(nxt)
    return cells, adj


def _add_loops(rng, adj, rows, cols, n):
    """Add up to n extra edges between orthogonally-adjacent cells not already
    linked — cycles for a less tree-like maze. Still planar (only grid-adjacent
    cells connect), so corridors never cross."""
    candidates = []
    for r in range(rows):
        for c in range(cols):
            for dr, dc in ((1, 0), (0, 1)):
                nb = (r + dr, c + dc)
                if 0 <= r + dr < rows and 0 <= c + dc < cols and nb not in adj[(r, c)]:
                    candidates.append(((r, c), nb))
    rng.shuffle(candidates)
    for a, b in candidates[:n]:
        adj[a].add(b)
        adj[b].add(a)


def _bfs(adj, start):
    """Hop distance from start to every reachable cell (dict cell -> int)."""
    dist = {start: 0}
    q = [start]
    i = 0
    while i < len(q):
        cur = q[i]; i += 1
        for nb in adj[cur]:
            if nb not in dist:
                dist[nb] = dist[cur] + 1
                q.append(nb)
    return dist
```

- [ ] **Step 4: Run to verify the helper tests pass**

Run: `cd infrastructure/lambda && python -m pytest tests/test_mapgen.py -q`
Expected: PASS (3 passed).

- [ ] **Step 5: Commit**

```bash
git add infrastructure/lambda/undercity_mapgen.py infrastructure/lambda/tests/test_mapgen.py
git commit -m "feat(undercity): mapgen scaffold — seed, grid carve, bfs helpers"
```

---

## Task 2: `generate_depths` — assemble, type, validate

**Files:**
- Modify: `infrastructure/lambda/undercity_mapgen.py`
- Modify: `infrastructure/lambda/tests/test_mapgen.py`

- [ ] **Step 1: Write the failing contract tests**

Append to `tests/test_mapgen.py`:

```python
import pytest
from undercity_data import BIOMES


def _by_id(nodes):
    return {n['id']: n for n in nodes}


def _in_pocket_neighbors(node, ids):
    return [x for x in node['neighbors'] if x in ids]


@pytest.mark.parametrize('biome', sorted(BIOMES))
@pytest.mark.parametrize('salt', range(8))     # 8 different layouts per biome
def test_generated_pocket_satisfies_every_contract(biome, salt):
    nodes = gen.generate_depths(gen._seed_int(f'season-{salt}', biome), biome)
    ids = {n['id'] for n in nodes}
    by = _by_id(nodes)

    assert len(nodes) >= gen.MIN_NODES
    assert all(nid.split('_')[0] == biome for nid in ids)
    assert all(n['region'] == 'depths' for n in nodes)
    assert all(n['type'] in gen._DEPTHS_PALETTE for n in nodes)

    for suf in ('lb', 'lair', 'cache', 'trove', 'rest', 'esc'):
        assert sum(1 for n in nodes if n['id'] == f'{biome}_{suf}') == 1
    assert by[f'{biome}_lb']['type'] == 'ladder'
    assert by[f'{biome}_esc']['type'] == 'ladder'

    # trove / rest are dead ends within the pocket
    for suf in ('trove', 'rest'):
        assert len(_in_pocket_neighbors(by[f'{biome}_{suf}'], ids)) == 1
    # escape spur: only the lair, reciprocated
    assert by[f'{biome}_esc']['neighbors'] == [f'{biome}_lair']
    assert f'{biome}_esc' in by[f'{biome}_lair']['neighbors']
    # mouth bridges to the fixed surface ladder-top
    assert f'{biome}_lt' in by[f'{biome}_lb']['neighbors']

    # symmetric within the pocket
    for n in nodes:
        for nb in _in_pocket_neighbors(n, ids):
            assert n['id'] in by[nb]['neighbors']

    # reachable from the mouth, and the lair is a real journey (>= 6 hops)
    seen, stack = {f'{biome}_lb'}, [f'{biome}_lb']
    dist = {f'{biome}_lb': 0}
    while stack:
        cur = stack.pop()
        for nb in _in_pocket_neighbors(by[cur], ids):
            if nb not in seen:
                seen.add(nb); dist[nb] = dist[cur] + 1; stack.append(nb)
    assert seen == ids
    assert dist[f'{biome}_lair'] >= gen.LAIR_MIN_HOPS


@pytest.mark.parametrize('biome', sorted(BIOMES))
def test_generation_is_deterministic(biome):
    seed = gen._seed_int('same-night', biome)
    assert gen.generate_depths(seed, biome) == gen.generate_depths(seed, biome)
```

(The reachability walk above uses a stack, so `dist` is a valid hop count only on a
tree; extra loops can only make the true shortest path *shorter*, so a `>= 6`
assertion via this walk is a conservative check. The generator validates the true
BFS distance internally.)

- [ ] **Step 2: Run to verify they fail**

Run: `cd infrastructure/lambda && python -m pytest tests/test_mapgen.py -k "contract or deterministic" -q`
Expected: FAIL — `AttributeError: module 'undercity_mapgen' has no attribute 'generate_depths'`.

- [ ] **Step 3: Add assembly, validation, and `generate_depths`**

Append to `infrastructure/lambda/undercity_mapgen.py`:

```python
def _assign_and_build(rng, biome):
    """One attempt: carve, place specials, type fillers, emit node dicts. Returns
    the node list, or None if the layout misses a placement precondition (caller
    retries with a fresh rng)."""
    rows, cols = GRID[biome]
    cells, adj = _carve(rng, rows, cols)
    _add_loops(rng, adj, rows, cols, EXTRA_LOOPS[biome])

    mouth = (0, 0)
    dist = _bfs(adj, mouth)
    lair = max(cells, key=lambda cel: (dist[cel], cel))        # deepest cell
    if dist[lair] < LAIR_MIN_HOPS:
        return None
    leaves = sorted((c for c in cells if len(adj[c]) == 1 and c not in (mouth, lair)),
                    key=lambda cel: (-dist[cel], cel))          # dead-end tips, far first
    if len(leaves) < 2:
        return None
    trove, rest = leaves[0], leaves[1]
    taken = {mouth, lair, trove, rest}
    remaining = [c for c in cells if c not in taken]
    cache = remaining[len(remaining) // 2]
    taken.add(cache)

    fillers = [c for c in cells if c not in taken]
    rng.shuffle(fillers)
    ftype = {}
    for c in fillers[:FILLER_ELITE]:
        ftype[c] = 'elite'
    rest_cells = fillers[FILLER_ELITE:]
    n_haz = round(len(rest_cells) * FILLER_HAZARD_FRAC)
    for c in rest_cells[:n_haz]:
        ftype[c] = 'hazard'
    tail = rest_cells[n_haz:]
    n_wild = round(len(tail) * FILLER_WILD_FRAC)
    for i, c in enumerate(tail):
        ftype[c] = 'wild' if i < n_wild else 'loot'

    special = {mouth: 'lb', lair: 'lair', trove: 'trove', rest: 'rest', cache: 'cache'}
    special_type = {'lb': 'ladder', 'lair': 'lair', 'trove': 'trove',
                    'rest': 'rest', 'cache': 'cache'}
    ox, oy = POCKET_ORIGIN[biome]

    def nid(cell):
        suf = special.get(cell)
        return f'{biome}_{suf}' if suf else f'{biome}_g{cell[0]}_{cell[1]}'

    nodes = {}
    for cell in cells:
        r, c = cell
        suf = special.get(cell)
        nodes[nid(cell)] = {
            'id': nid(cell),
            'type': special_type[suf] if suf else ftype[cell],
            'x': ox + c * SPACING, 'y': oy + r * SPACING,
            'region': 'depths',
            'neighbors': sorted(nid(nb) for nb in adj[cell]),
        }
    # Mouth reciprocates the fixed surface bridge (<biome>_lt ↔ <biome>_lb).
    lb = nodes[f'{biome}_lb']
    lb['neighbors'] = sorted(lb['neighbors'] + [f'{biome}_lt'])
    # Escape spur off the lair (degree-1 'ladder'), just past it.
    lr, lc = lair
    nodes[f'{biome}_esc'] = {
        'id': f'{biome}_esc', 'type': 'ladder',
        'x': ox + lc * SPACING + 70, 'y': oy + lr * SPACING + 70,
        'region': 'depths', 'neighbors': [f'{biome}_lair'],
    }
    lair_node = nodes[f'{biome}_lair']
    lair_node['neighbors'] = sorted(lair_node['neighbors'] + [f'{biome}_esc'])
    return list(nodes.values())


def _valid(nodes, biome):
    """True iff `nodes` satisfies every board contract for this biome's pocket."""
    by = {n['id']: n for n in nodes}
    ids = set(by)
    if len(nodes) < MIN_NODES:
        return False
    if any(n['type'] not in _DEPTHS_PALETTE for n in nodes):
        return False
    for suf in ('lb', 'lair', 'cache', 'trove', 'rest', 'esc'):
        if f'{biome}_{suf}' not in by:
            return False
    for suf in ('trove', 'rest'):
        if len([x for x in by[f'{biome}_{suf}']['neighbors'] if x in ids]) != 1:
            return False
    if by[f'{biome}_esc']['neighbors'] != [f'{biome}_lair']:
        return False
    if f'{biome}_esc' not in by[f'{biome}_lair']['neighbors']:
        return False
    if f'{biome}_lt' not in by[f'{biome}_lb']['neighbors']:
        return False
    for n in nodes:                                    # symmetric within pocket
        for nb in n['neighbors']:
            if nb in ids and n['id'] not in by[nb]['neighbors']:
                return False
    dist = {f'{biome}_lb': 0}                           # reachable + lair depth
    q, i = [f'{biome}_lb'], 0
    while i < len(q):
        cur = q[i]; i += 1
        for nb in by[cur]['neighbors']:
            if nb in ids and nb not in dist:
                dist[nb] = dist[cur] + 1; q.append(nb)
    if set(dist) != ids:
        return False
    return dist[f'{biome}_lair'] >= LAIR_MIN_HOPS


def generate_depths(seed, biome):
    """A biome's depths pocket for the night: a grid-carved maze with canonical
    ids (<biome>_lb mouth, _lair, _cache, _trove, _rest, _esc). Deterministic in
    `seed`; retries layouts until every contract holds."""
    for attempt in range(MAX_ATTEMPTS):
        rng = random.Random(seed + attempt)
        nodes = _assign_and_build(rng, biome)
        if nodes and _valid(nodes, biome):
            return nodes
    raise RuntimeError(f'mapgen: no valid layout for {biome} after {MAX_ATTEMPTS} tries')
```

- [ ] **Step 4: Run the contract + determinism tests**

Run: `cd infrastructure/lambda && python -m pytest tests/test_mapgen.py -q`
Expected: PASS (all — 3 helpers + 40 contract params + 5 determinism). If a biome ever fails the lair-depth or leaf-count precondition, bump its `GRID` size in the constants and re-run.

- [ ] **Step 5: Commit**

```bash
git add infrastructure/lambda/undercity_mapgen.py infrastructure/lambda/tests/test_mapgen.py
git commit -m "feat(undercity): generate_depths — contract-validated biome pockets"
```

---

## Task 3: `generate_all_depths` + diversity

**Files:**
- Modify: `infrastructure/lambda/undercity_mapgen.py`
- Modify: `infrastructure/lambda/tests/test_mapgen.py`

- [ ] **Step 1: Write the failing tests**

Append to `tests/test_mapgen.py`:

```python
def test_generate_all_depths_covers_every_biome_with_unique_ids():
    nodes = gen.generate_all_depths('night-42')
    ids = [n['id'] for n in nodes]
    assert len(ids) == len(set(ids))                       # no duplicate ids
    for biome in BIOMES:
        assert f'{biome}_lair' in ids and f'{biome}_lb' in ids and f'{biome}_esc' in ids
    # every node is a depths node belonging to some biome
    assert all(n['region'] == 'depths' for n in nodes)
    assert all(n['id'].split('_')[0] in BIOMES for n in nodes)


def test_different_nights_differ():
    a = gen.generate_all_depths('night-A')
    b = gen.generate_all_depths('night-B')
    assert a != b                                          # fresh maze each night


def test_same_night_is_reproducible():
    assert gen.generate_all_depths('night-A') == gen.generate_all_depths('night-A')
```

- [ ] **Step 2: Run to verify they fail**

Run: `cd infrastructure/lambda && python -m pytest tests/test_mapgen.py -k "all_depths or different_nights or reproducible" -q`
Expected: FAIL — `AttributeError: module 'undercity_mapgen' has no attribute 'generate_all_depths'`.

- [ ] **Step 3: Add `generate_all_depths`**

Append to `infrastructure/lambda/undercity_mapgen.py`:

```python
def generate_all_depths(season_id):
    """All five biome pockets for a season, as one flat node list — the shape the
    SEASON#<sid>/MAP record stores (Phase C writes it at season-start)."""
    out = []
    for biome in BIOMES:
        out.extend(generate_depths(_seed_int(season_id, biome), biome))
    return out
```

- [ ] **Step 4: Run the full mapgen suite**

Run: `cd infrastructure/lambda && python -m pytest tests/test_mapgen.py -q`
Expected: PASS (all).

- [ ] **Step 5: Run the WHOLE suite (nothing else should move)**

Run: `cd infrastructure/lambda && python -m pytest tests -q`
Expected: all green. The generator is not imported by the game yet, so only `test_mapgen.py` is new; every existing test is unaffected.

- [ ] **Step 6: Commit**

```bash
git add infrastructure/lambda/undercity_mapgen.py infrastructure/lambda/tests/test_mapgen.py
git commit -m "feat(undercity): generate_all_depths — five pockets per night"
```

---

## Verification (whole phase)

- [ ] `cd infrastructure/lambda && python -m pytest tests/test_mapgen.py -q` — all green (helpers, 40 contract params, determinism, coverage, diversity).
- [ ] `cd infrastructure/lambda && python -m pytest tests -q` — full suite green; no existing test changed.
- [ ] The flag is still off and `season-start` is untouched — nothing user-facing changed. Phase C wires `generate_all_depths` into `season-start`, flips the flag on, switches the client's map fetch to `GET /game/map`, adds client pocket-layer grouping for generated ids, and converts the golden map tests to invariants.

## Self-Review

**Spec coverage (Phase B slice):**
- Pure, deterministic, no-boto3 module → Task 1 (`undercity_mapgen.py`, stdlib only). ✔
- Deterministic seed from `(season_id, biome)` via hashlib → Task 1 `_seed_int`. ✔
- Grid-based maze primitive (planarity + coords) → Task 1 `_carve`/`_add_loops`. ✔
- Per-biome shape bias (identity kept) → `GRID` + `EXTRA_LOOPS` constants; canonical ids tie boss/hazard/wild identity via the existing tables. ✔
- Randomized layout + content → `_assign_and_build` (maze + shuffled filler quota). ✔
- Every contract enforced with retry → Task 2 `_valid` + `generate_depths` attempt loop. ✔
- Mouth↔surface `<biome>_lt` bridge → `_assign_and_build` + `_valid` check + contract test. ✔
- Property tests over seeds × biomes; determinism + diversity → Tasks 2-3. ✔
- Not wired in (flag off, season-start untouched) → whole-suite-green check, Task 3. ✔
- Deferred to Phase C (called out in Verification): season-start wiring, flag flip, client fetch switch + pocket-layer grouping, golden→invariant conversion.

**Placeholder scan:** none — every step shows concrete code or an exact command.

**Type/name consistency:** `_seed_int`, `_carve`, `_add_loops`, `_bfs`, `_assign_and_build`, `_valid`, `generate_depths`, `generate_all_depths`, and the constants (`GRID`, `EXTRA_LOOPS`, `POCKET_ORIGIN`, `SPACING`, `MIN_NODES`, `LAIR_MIN_HOPS`, `FILLER_*`, `_DEPTHS_PALETTE`) are used identically across tasks and tests. `generate_all_depths` returns a flat node list — exactly the `depths` list shape Phase A's `_load_season_depths` reads from the `MAP` record.
