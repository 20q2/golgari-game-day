# Boss Antechamber Loops Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Make each procedurally-generated dungeon lair landable under exact-count movement by carving an odd-cycle "antechamber" loop (two off-grid gate nodes) at the end of every biome pocket.

**Architecture:** In `undercity_mapgen._assign_and_build`, after the deepest cell is chosen as the lair, pick its mouth-nearest maze neighbour `J`, keep the direct `J↔lair` edge, and append two off-grid nodes `<biome>_lg1`/`_lg2` each linking both `J` and the lair. Each gate forms a length-3 (odd) cycle `J–lg–lair`, so the lair is reachable at consecutive distances (1 and 2 from `J`) — both roll parities can land. The generator's `_valid` contract and `test_mapgen.py` gain assertions for the gates and the mixed-parity landability property.

**Tech Stack:** Python 3.11, pytest. All work is in `infrastructure/lambda/`. Run tests with `cd infrastructure/lambda && python -m pytest tests/test_mapgen.py -q`.

---

## Background the engineer needs

- **Where the code lives:** [infrastructure/lambda/undercity_mapgen.py](../infrastructure/lambda/undercity_mapgen.py). The relevant function is `_assign_and_build(rng, biome)` (~line 108), which carves a grid maze, places specials (lair/cache/trove/rest/lb), types fillers, then emits a list of node dicts. `_valid(nodes, biome)` (~line 180) checks contracts; `generate_depths` (~line 216) retries until `_valid` passes.
- **Node dict shape:** `{'id', 'type', 'x', 'y', 'region': 'depths', 'neighbors': [ids...]}`. Neighbours are stored as **sorted lists of ids** and must be **symmetric** (if A lists B, B lists A).
- **The lair** is `cells`'s deepest cell (`max(cells, key=lambda cel: (dist[cel], cel))`), emitted with id `f'{biome}_lair'`. Grid cell `(r, c)` becomes node id `f'{biome}_g{r}_{c}'` unless it's a special. The lair already has a degree-1 `_esc` spur appended after the loop over cells.
- **Why two gates / odd cycle:** grid mazes are bipartite, so grid-only loops are even-length and don't fix landing for the "wrong" parity roll. The off-grid gate makes a length-3 cycle. See [specs/2026-07-21-undercity-boss-antechamber-design.md](2026-07-21-undercity-boss-antechamber-design.md).
- **Geometry:** pockets render in their own sub-view; exact coordinates only need to avoid gross overlap. `SPACING = 120`. The existing `_esc` spur uses `+70` offsets as precedent.
- **`wild` is a valid depths type** (in `_DEPTHS_PALETTE`); the gates use it.
- **Canonical id rule:** every pocket node id must start with `<biome>_` (asserted by tests). `<biome>_lg1`/`<biome>_lg2` satisfy this and don't collide with `_lb/_lair/_cache/_trove/_rest/_esc`.

## File Structure

- **Modify:** `infrastructure/lambda/undercity_mapgen.py`
  - `_assign_and_build`: after lair selection, compute `J`, append `_lg1`/`_lg2`, wire the triangle edges.
  - `_valid`: assert the two gates exist with neighbours exactly `{J, lair}` and that the lair has two approach distances of different parity.
- **Modify:** `infrastructure/lambda/tests/test_mapgen.py`
  - Add gate-existence + neighbour assertions and a mixed-parity landability test to the parametrized contract test; add a focused unit test for the antechamber.

There are no other consumers to change: `_lg1/_lg2` are ordinary `wild` nodes, so `undercity_db.py`, name maps, respawn, and the client render them like any node.

---

## Task 1: Add the boss antechamber to the generator

**Files:**
- Modify: `infrastructure/lambda/undercity_mapgen.py` (`_assign_and_build`, ~line 145-177)

- [ ] **Step 1: Write the failing unit test**

Add to `infrastructure/lambda/tests/test_mapgen.py` (after the imports and `_by_id`/`_in_pocket_neighbors` helpers near line 49):

```python
@pytest.mark.parametrize('biome', sorted(BIOMES))
@pytest.mark.parametrize('salt', range(8))
def test_lair_has_antechamber_loop(biome, salt):
    """Each lair sits in a two-gate antechamber (_lg1/_lg2), each gate linking
    exactly the same junction J and the lair, forming length-3 odd cycles."""
    nodes = gen.generate_depths(gen._seed_int(f'ante-{salt}', biome), biome)
    ids = {n['id'] for n in nodes}
    by = _by_id(nodes)

    lair = by[f'{biome}_lair']
    for suf in ('lg1', 'lg2'):
        gid = f'{biome}_{suf}'
        assert gid in by, f'missing gate {gid}'
        assert by[gid]['type'] == 'wild'
        gate_nbrs = set(_in_pocket_neighbors(by[gid], ids))
        assert len(gate_nbrs) == 2, f'{gid} must bridge exactly two nodes'
        assert f'{biome}_lair' in gate_nbrs
        # the other neighbour is the shared junction J, and J touches the lair
        (j,) = gate_nbrs - {f'{biome}_lair'}
        assert j in by[f'{biome}_lair']['neighbors'], 'J must border the lair directly'
        # symmetric wiring
        assert gid in by[j]['neighbors']
        assert gid in lair['neighbors']

    # both gates share the same junction J -> genuine antechamber, not two spurs
    j1 = (set(_in_pocket_neighbors(by[f'{biome}_lg1'], ids)) - {f'{biome}_lair'}).pop()
    j2 = (set(_in_pocket_neighbors(by[f'{biome}_lg2'], ids)) - {f'{biome}_lair'}).pop()
    assert j1 == j2
```

- [ ] **Step 2: Run the test to verify it fails**

Run: `cd infrastructure/lambda && python -m pytest tests/test_mapgen.py::test_lair_has_antechamber_loop -q`
Expected: FAIL — `missing gate <biome>_lg1` (KeyError / assertion), because the generator does not emit gates yet.

- [ ] **Step 3: Implement the antechamber in `_assign_and_build`**

In `infrastructure/lambda/undercity_mapgen.py`, the tail of `_assign_and_build` currently reads (from ~line 165):

```python
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
```

Replace that block with (adds the antechamber before the escape spur):

```python
    # Mouth reciprocates the fixed surface bridge (<biome>_lt ↔ <biome>_lb).
    lb = nodes[f'{biome}_lb']
    lb['neighbors'] = sorted(lb['neighbors'] + [f'{biome}_lt'])

    # Boss antechamber: the lair is the deepest cell, so under exact-count
    # movement a dead-end lair is only landable on one precise roll. Pick the
    # lair's mouth-nearest maze neighbour J and append two off-grid gate nodes
    # that each bridge J and the lair. Each gate forms a length-3 (odd) cycle
    # J-lg-lair, so the lair is reachable at consecutive distances (1 direct,
    # 2 via a gate) — both roll parities can land. Grid loops alone can't do
    # this: the grid is bipartite, so every grid cycle is even-length.
    lair_id = f'{biome}_lair'
    j_cell = min((nb for nb in adj[lair]),
                 key=lambda c: (dist[c], c))          # nearest to mouth, stable
    j_id = nid(j_cell)
    lr, lc = lair
    jr, jc = j_cell
    midx = ox + (lc + jc) * SPACING / 2
    midy = oy + (lr + jr) * SPACING / 2
    for k, suf in enumerate(('lg1', 'lg2')):
        gid = f'{biome}_{suf}'
        off = 40 if k == 0 else -40
        nodes[gid] = {
            'id': gid, 'type': 'wild',
            'x': round(midx + off), 'y': round(midy - off),
            'region': 'depths', 'neighbors': sorted([j_id, lair_id]),
        }
        nodes[j_id]['neighbors'] = sorted(nodes[j_id]['neighbors'] + [gid])
        nodes[lair_id]['neighbors'] = sorted(nodes[lair_id]['neighbors'] + [gid])

    # Escape spur off the lair (degree-1 'ladder'), just past it.
    nodes[f'{biome}_esc'] = {
        'id': f'{biome}_esc', 'type': 'ladder',
        'x': ox + lc * SPACING + 70, 'y': oy + lr * SPACING + 70,
        'region': 'depths', 'neighbors': [lair_id],
    }
    nodes[lair_id]['neighbors'] = sorted(nodes[lair_id]['neighbors'] + [f'{biome}_esc'])
    return list(nodes.values())
```

Note: `nid`, `adj`, `dist`, `lair`, `ox`, `oy` are all in scope at this point in `_assign_and_build` (defined earlier in the same function). `dist` is the BFS-from-mouth map computed at line 117.

- [ ] **Step 4: Run the unit test to verify it passes**

Run: `cd infrastructure/lambda && python -m pytest tests/test_mapgen.py::test_lair_has_antechamber_loop -q`
Expected: PASS (40 parametrized cases: 5 biomes × 8 salts).

- [ ] **Step 5: Run the full mapgen suite to catch contract regressions**

Run: `cd infrastructure/lambda && python -m pytest tests/test_mapgen.py -q`
Expected: PASS. `test_generated_pocket_satisfies_every_contract` still passes — the added `_lg1/_lg2` nodes start with the biome prefix, use a palette type, are symmetric, and are reachable from the mouth. Node count only grows.

- [ ] **Step 6: Commit**

```bash
git add infrastructure/lambda/undercity_mapgen.py infrastructure/lambda/tests/test_mapgen.py
git commit -m "feat(undercity): boss-antechamber loop at each generated lair"
```

---

## Task 2: Enforce the landability guarantee in `_valid`

The generator must *guarantee* the mixed-parity landing property so a bad layout can never ship. `_valid` runs inside the `generate_depths` retry loop, so encoding the guarantee there makes the generator self-correcting.

**Files:**
- Modify: `infrastructure/lambda/undercity_mapgen.py` (`_valid`, ~line 180-213)
- Modify: `infrastructure/lambda/tests/test_mapgen.py`

- [ ] **Step 1: Write the failing test for the parity guarantee**

Add to `infrastructure/lambda/tests/test_mapgen.py`:

```python
def _pocket_dist(by, ids, start):
    dist = {start: 0}
    q, i = [start], 0
    while i < len(q):
        cur = q[i]; i += 1
        for nb in by[cur]['neighbors']:
            if nb in ids and nb not in dist:
                dist[nb] = dist[cur] + 1; q.append(nb)
    return dist


@pytest.mark.parametrize('biome', sorted(BIOMES))
@pytest.mark.parametrize('salt', range(8))
def test_lair_landable_from_junction_both_parities(biome, salt):
    """From the antechamber junction J the lair is reachable at two consecutive
    distances (1 and 2) -> distances of different parity -> exact-count movement
    can land for either roll parity."""
    nodes = gen.generate_depths(gen._seed_int(f'land-{salt}', biome), biome)
    ids = {n['id'] for n in nodes}
    by = _by_id(nodes)
    # J is the shared junction of the two gates
    j = (set(_in_pocket_neighbors(by[f'{biome}_lg1'], ids)) - {f'{biome}_lair'}).pop()
    d = _pocket_dist(by, ids, j)
    # direct edge => distance 1; via a gate => distance 2
    assert d[f'{biome}_lair'] == 1
    # a length-2 route also exists (through a gate), proving the odd cycle:
    # remove the direct edge conceptually by checking a gate path length
    assert _pocket_dist(by, ids, f'{biome}_lg1')[f'{biome}_lair'] == 1
    # consecutive-distance property: J->lair is 1 and J->gate->lair is 2
    assert d[f'{biome}_lg1'] == 1 and d[f'{biome}_lg2'] == 1
```

- [ ] **Step 2: Run the test to verify it passes already (behavioral confirmation), then make `_valid` enforce it**

Run: `cd infrastructure/lambda && python -m pytest tests/test_mapgen.py::test_lair_landable_from_junction_both_parities -q`
Expected: PASS — Task 1 already produces this topology. This test locks the behaviour so the `_valid` change below can't silently weaken it.

- [ ] **Step 3: Add the guarantee to `_valid`**

In `infrastructure/lambda/undercity_mapgen.py`, `_valid` currently ends (~line 194-213):

```python
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
```

Insert the antechamber checks immediately before `for n in nodes:` (the symmetric-adjacency loop):

```python
    if by[f'{biome}_esc']['neighbors'] != [f'{biome}_lair']:
        return False
    if f'{biome}_esc' not in by[f'{biome}_lair']['neighbors']:
        return False
    if f'{biome}_lt' not in by[f'{biome}_lb']['neighbors']:
        return False
    # Boss antechamber: two 'wild' gates, each bridging exactly the same
    # junction J and the lair (odd-cycle -> mixed-parity landings).
    lair_id = f'{biome}_lair'
    junctions = set()
    for suf in ('lg1', 'lg2'):
        gid = f'{biome}_{suf}'
        if gid not in by or by[gid]['type'] != 'wild':
            return False
        gnbrs = {x for x in by[gid]['neighbors'] if x in ids}
        if len(gnbrs) != 2 or lair_id not in gnbrs:
            return False
        (j,) = gnbrs - {lair_id}
        if j not in by[lair_id]['neighbors']:      # J must border the lair directly
            return False
        junctions.add(j)
    if len(junctions) != 1:                        # both gates share one junction
        return False
    for n in nodes:                                    # symmetric within pocket
        for nb in n['neighbors']:
            if nb in ids and n['id'] not in by[nb]['neighbors']:
                return False
```

(The `dist`/reachability/`LAIR_MIN_HOPS` block after it is unchanged.)

- [ ] **Step 4: Run the mapgen suite to verify `_valid` still passes generated layouts**

Run: `cd infrastructure/lambda && python -m pytest tests/test_mapgen.py -q`
Expected: PASS. If a layout ever failed the new `_valid` checks, `generate_depths` would retry (up to `MAX_ATTEMPTS`); tests passing confirms real layouts satisfy the guarantee.

- [ ] **Step 5: Commit**

```bash
git add infrastructure/lambda/undercity_mapgen.py infrastructure/lambda/tests/test_mapgen.py
git commit -m "feat(undercity): enforce antechamber parity guarantee in mapgen _valid"
```

---

## Task 3: Full regression + integration check

Confirm nothing downstream broke — the DB layer, deep-dungeon tests, and the whole lambda suite consume generated depths.

**Files:** none (verification only)

- [ ] **Step 1: Run the depths / procedural-map integration tests**

Run: `cd infrastructure/lambda && python -m pytest tests/test_deep_dungeons.py tests/test_procedural_map.py tests/test_map.py -q`
Expected: PASS. These exercise `merge_map` / `generate_all_depths` and movement over the generated graph; the added gate nodes are ordinary `wild` nodes, so movement/landing logic handles them without change.

- [ ] **Step 2: Run the entire lambda test suite**

Run: `cd infrastructure/lambda && python -m pytest tests -q`
Expected: PASS (all green). If any pre-existing failures appear that are unrelated to this change, note them but do not fix them here — the parallel-WIP convention says not to own unrelated test failures.

- [ ] **Step 3: Sanity-render a pocket (manual eyeball, optional)**

Run:
```bash
cd infrastructure/lambda && python -c "import undercity_mapgen as g; ns=g.generate_depths(g._seed_int('demo','city'),'city'); by={n['id']:n for n in ns}; L=by['city_lair']; print('lair nbrs', L['neighbors']); [print(s, by['city_'+s]['neighbors']) for s in ('lg1','lg2')]"
```
Expected: `city_lair` lists `city_lg1`, `city_lg2`, `city_esc`, and its junction; each gate lists the junction and `city_lair`.

- [ ] **Step 4: No commit** (verification task). If Steps 1-2 surfaced a real regression in this change, return to the relevant task; otherwise the feature is complete.

---

## Self-Review notes

- **Spec coverage:** antechamber construction (Task 1) ✓; odd-cycle / mixed-parity landability (Tasks 1-2) ✓; lair stays ≥ `LAIR_MIN_HOPS` (unchanged `_valid` tail) ✓; determinism (no new RNG; `min`/geometry are pure) ✓; contracts + `MIN_NODES` (Task 1 Step 5, Task 3) ✓; no balance/economy/surface change (only two `wild` nodes added) ✓.
- **Naming consistency:** `_lg1`/`_lg2`, `lair_id`, `j_id`/`j_cell`, `junctions` used identically across generator and tests.
- **Determinism:** `j_cell = min(..., key=(dist[c], c))` is a pure tiebroken selection; gate coordinates derive from cell indices only. `Date/random` not used.
