# Deep Sigil Dungeons Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Turn the `city` sigil dungeon into a large, dark, branching maze delve — with hidden trove and rest rooms and a toggleable torch (light vs. combat power) — as a vertical slice before replicating to the other four biomes.

**Architecture:** All rules stay server-side in the Python Lambda (`undercity_db.py` dispatcher + `undercity_data.py` tables). Two new node types (`rest`, `trove`) reuse the existing `poiClaims` first-visit pattern. The torch is a toggleable player state (`torchLit`) that `engine.effective_stats` reads for a flat combat penalty; the Angular fog-of-war (`board-canvas.ts`) reads it to widen the light radius. Depths deaths respawn at the dungeon entrance. The board maze itself is authored in `map.json` (source of truth) and guarded by a structural pytest.

**Tech Stack:** Python 3.11 Lambda (pytest, in-memory `FakeTable` suite), Angular 20 standalone components, canvas board engine (TS), `map.json` graph synced to `public/data/` via `sync_map.py`.

---

## Reference: how the pieces work today

- **Node dispatch:** `undercity_db._resolve_space(table, sid, doc, node, prev)` reads `data.MAP_NODES[node]['type']` and dispatches; the leaf handlers live in `_resolve_node`-style `if ntype == ...` branches ending around [undercity_db.py:1544-1616](../infrastructure/lambda/undercity_db.py#L1544).
- **First-visit rewards:** `_cache` / `_vault` append a key to `doc['poiClaims']` and pay once; renown flows automatically via `compute_renown` (`per_poi`).
- **Effective stats:** `engine.effective_stats(player)` sums `player['gear']` values then applies buff modifiers ([undercity_engine.py:528](../infrastructure/lambda/undercity_engine.py#L528)).
- **Compost/respawn:** `_compost(table, sid, doc, cause_text)` sets `doc['position'] = home_gate` and may offer a `pendingRespawn` choice ([undercity_db.py:547](../infrastructure/lambda/undercity_db.py#L547)).
- **Depths helpers:** `data.dungeon_biome(node_id)` returns the biome for a `depths` node (`'city_d0' -> 'city'`), else `None`.
- **Gear drops:** `data.GEAR_DROP[source] = (chance, {tier: weight})`; `db._roll_gear_drop(doc, tiers)` returns an equip/salvage result.
- **Tests:** `cd infrastructure/lambda && python -m pytest tests -q`. Harness helpers in `tests/test_undercity_db.py`: `act(table, atype, **payload)`, `_sid(table)`, `db._get_player`, `db._resolve_space`.
- **Client mirrors:** display tables duplicated under `src/app/undercity/data/*.ts`; keep in sync (tune-undercity-balance skill).

## File map

- Modify `infrastructure/lambda/undercity_data.py` — `REST_ROOM`, `TROVE_REWARD`, `TORCH`, entrance helper.
- Modify `infrastructure/lambda/undercity_engine.py` — torch penalty in `effective_stats`.
- Modify `infrastructure/lambda/undercity_db.py` — `_rest`, `_trove`, `toggle-torch` action, depths-aware `_compost`, per-descent reset, dispatch branches.
- Modify `infrastructure/lambda/map.json` + run `sync_map.py` — the `city` maze.
- Modify `infrastructure/lambda/tests/test_map_file.py` — node-count + structural asserts.
- Add `infrastructure/lambda/tests/test_deep_dungeons.py` — server behaviour tests.
- Modify `src/app/undercity/engine/board-canvas.ts` — torch light radius.
- Modify `src/app/undercity/tabs/board-tab.component.ts` + `engine/board-space.ts` — render `rest`/`trove`, torch toggle button.
- Modify `src/app/undercity/data/*.ts` — mirror new numbers.

---

## Task 1: Torch — toggleable light with a combat penalty

**Files:**
- Modify: `infrastructure/lambda/undercity_data.py`
- Modify: `infrastructure/lambda/undercity_engine.py:528-550`
- Modify: `infrastructure/lambda/undercity_db.py` (dispatcher + new handler)
- Test: `infrastructure/lambda/tests/test_deep_dungeons.py`

- [ ] **Step 1: Write the failing tests**

Create `infrastructure/lambda/tests/test_deep_dungeons.py`:

```python
"""Deep sigil dungeon feature: torch, rest, trove, depths respawn."""
import sys
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parents[1]))

import undercity_data as data
import undercity_db as db
import undercity_engine as engine
from tests.test_undercity_db import act, table, _sid  # reuse harness + fixture


def _join(t, **kw):
    kw.setdefault('starter', 'pest')
    act(t, 'join', **kw)
    return db._get_player(t, _sid(t), 'user-alex')


def test_torch_toggle_applies_combat_penalty(table):
    doc = _join(table)
    base = engine.effective_stats(doc)
    status, resp = act(table, 'toggle-torch')
    assert status == 200
    assert resp['you']['torchLit'] is True
    lit = engine.effective_stats(db._get_player(table, _sid(table), 'user-alex'))
    assert lit['atk'] == base['atk'] + data.TORCH['atk']   # atk is negative
    assert lit['def'] == base['def'] + data.TORCH['def']
    # Toggling again douses it, restoring stats.
    status, resp = act(table, 'toggle-torch')
    assert resp['you']['torchLit'] is False
    restored = engine.effective_stats(db._get_player(table, _sid(table), 'user-alex'))
    assert restored['atk'] == base['atk']


def test_torch_penalty_floors_at_one(table):
    doc = _join(table)
    doc['atk'] = 1
    doc['def'] = 1
    db._put_player(table, doc)
    act(table, 'toggle-torch')
    lit = engine.effective_stats(db._get_player(table, _sid(table), 'user-alex'))
    assert lit['atk'] >= 1 and lit['def'] >= 1
```

- [ ] **Step 2: Run the tests to verify they fail**

Run: `cd infrastructure/lambda && python -m pytest tests/test_deep_dungeons.py -q`
Expected: FAIL — `AttributeError: module 'undercity_data' has no attribute 'TORCH'` (or `toggle-torch` unknown action).

- [ ] **Step 3: Add the torch balance entry**

In `undercity_data.py`, after the `CONSUMABLES` block (near line 197), add:

```python
# The Swamp Torch: a toggleable light for the dark dungeons. Lit, it widens
# your fog-of-war radius (client-side) but saps combat power — light OR fight.
# Penalties are negative deltas applied in engine.effective_stats; both floor
# at 1 there. Tunable knobs; see specs/2026-07-19-undercity-deep-dungeons-design.md.
TORCH = {'atk': -3, 'def': -2, 'lightHops': 2}
```

- [ ] **Step 4: Apply the penalty in effective_stats**

In `undercity_engine.py`, inside `effective_stats`, after the gear-summing loop and before the buff loop (line ~537), add:

```python
    if player.get('torchLit'):
        eff['atk'] = max(1, eff['atk'] + data.TORCH['atk'])
        eff['def'] = max(1, eff['def'] + data.TORCH['def'])
```

- [ ] **Step 5: Add the toggle-torch action + handler**

In `undercity_db.py`, add the handler near the other small player actions (after `_respawn`, ~line 1426):

```python
def _toggle_torch(table, sid, doc, payload):
    """Light or douse the Swamp Torch: widens dungeon sight, saps combat."""
    doc['torchLit'] = not doc.get('torchLit', False)
    conflict = _save_or_conflict(table, doc)
    if conflict:
        return conflict
    verb = 'flares to life' if doc['torchLit'] else 'gutters out'
    return _ok(doc, text=f'Your torch {verb}.')
```

Register it in the action dispatch dict (near line 782, alongside `'respawn': _respawn`):

```python
        'toggle-torch': _toggle_torch,
```

- [ ] **Step 6: Surface `torchLit` in the public player payload**

In the player-serialisation dict around [undercity_db.py:718](../infrastructure/lambda/undercity_db.py#L718) (the one with `'composts'`, `'sigils'`), add:

```python
        'torchLit': bool(p.get('torchLit')),
```

Also confirm `_ok(doc, ...)` returns `you` with `torchLit` (it serialises the same way). If `_ok` uses a separate `you` projection, add `torchLit` there too.

- [ ] **Step 7: Run the tests to verify they pass**

Run: `cd infrastructure/lambda && python -m pytest tests/test_deep_dungeons.py -q`
Expected: PASS (2 passed).

- [ ] **Step 8: Commit**

```bash
git add infrastructure/lambda/undercity_data.py infrastructure/lambda/undercity_engine.py infrastructure/lambda/undercity_db.py infrastructure/lambda/tests/test_deep_dungeons.py
git commit -m "feat(undercity): toggleable swamp torch (light vs combat)"
```

---

## Task 2: Rest room — heal once per descent

**Files:**
- Modify: `infrastructure/lambda/undercity_data.py`
- Modify: `infrastructure/lambda/undercity_db.py` (`_resolve_space` reset + dispatch + handler)
- Test: `infrastructure/lambda/tests/test_deep_dungeons.py`

- [ ] **Step 1: Write the failing tests**

Append to `tests/test_deep_dungeons.py`:

```python
def test_rest_heals_once_per_descent(table):
    doc = _join(table)
    eff = engine.effective_stats(doc)
    doc['hp'] = 5
    doc['restsUsed'] = []
    db._put_player(table, doc)
    ev = db._rest(table, _sid(table), doc, 'city_rest')
    assert ev['type'] == 'rest'
    assert doc['hp'] == eff['maxHp']            # healed to full
    assert 'city_rest' in doc['restsUsed']
    # Second visit this descent: no heal.
    doc['hp'] = 5
    ev2 = db._rest(table, _sid(table), doc, 'city_rest')
    assert doc['hp'] == 5
    assert 'already' in ev2['text'].lower()


def test_leaving_depths_resets_rest(table):
    doc = _join(table)
    doc['restsUsed'] = ['city_rest']
    db._put_player(table, doc)
    # Landing on a surface (non-depths) node clears the per-descent record.
    surface = next(n for n, spec in data.MAP_NODES.items()
                   if spec.get('region') == 'city' and spec['type'] == 'loot')
    db._resolve_space(table, _sid(table), doc, surface, None)
    assert doc.get('restsUsed', []) == []
```

- [ ] **Step 2: Run to verify they fail**

Run: `cd infrastructure/lambda && python -m pytest tests/test_deep_dungeons.py -k rest -q`
Expected: FAIL — `module 'undercity_db' has no attribute '_rest'`.

- [ ] **Step 3: Add the rest reward constant**

In `undercity_data.py`, near `CACHE_REWARD` (line ~666):

```python
# Rest room: a hidden alcove that mends you fully, once per descent. Clears the
# lingering hazard debuffs (vines / bone_chill / cursed_idol) too.
REST_CURES = ('vines', 'bone_chill', 'cursed_idol')
```

- [ ] **Step 4: Add the `_rest` handler**

In `undercity_db.py`, near `_cache` (~line 2305):

```python
def _rest(table, sid, doc, node):
    """Hidden rest alcove: full heal + clear hazard debuffs, once per descent.
    Per-descent tracking lives in doc['restsUsed'], cleared on the surface."""
    used = doc.setdefault('restsUsed', [])
    if node in used:
        return {'type': 'rest',
                'text': 'The embers here are cold — you already rested this descent.'}
    used.append(node)
    doc['hp'] = engine.effective_stats(doc)['maxHp']
    doc['hpUpdatedAt'] = _now()
    doc['buffs'] = [b for b in (doc.get('buffs') or [])
                    if b.get('kind') not in data.REST_CURES]
    return {'type': 'rest',
            'text': 'A dry alcove, warm with old spores. You rest — wounds close, '
                    'curses lift.'}
```

- [ ] **Step 5: Reset per-descent rests on the surface + dispatch `rest`**

In `_resolve_space` (~line 1485, right after `region = data.MAP_NODES[node].get('region')`), add:

```python
    # Per-descent rest tracking resets the moment you stand on the surface.
    if region != 'depths' and doc.get('restsUsed'):
        doc['restsUsed'] = []
```

In the node-type dispatch (near [undercity_db.py:1601](../infrastructure/lambda/undercity_db.py#L1601), beside `if ntype == 'cache'`), add:

```python
    if ntype == 'rest':
        return _rest(table, sid, doc, node)
```

- [ ] **Step 6: Run to verify they pass**

Run: `cd infrastructure/lambda && python -m pytest tests/test_deep_dungeons.py -k rest -q`
Expected: PASS.

- [ ] **Step 7: Commit**

```bash
git add infrastructure/lambda/undercity_data.py infrastructure/lambda/undercity_db.py infrastructure/lambda/tests/test_deep_dungeons.py
git commit -m "feat(undercity): rest room node (full heal once per descent)"
```

---

## Task 3: Trove room — fat one-time payout with guaranteed gear

**Files:**
- Modify: `infrastructure/lambda/undercity_data.py`
- Modify: `infrastructure/lambda/undercity_db.py`
- Test: `infrastructure/lambda/tests/test_deep_dungeons.py`

- [ ] **Step 1: Write the failing tests**

Append to `tests/test_deep_dungeons.py`:

```python
def test_trove_pays_once_with_guaranteed_gear(table, monkeypatch):
    doc = _join(table)
    before = doc.get('spores', 0)
    # Force the gear roll to a known upgrade so the guarantee is observable.
    monkeypatch.setattr(db, '_roll_gear_drop',
                        lambda d, tiers: {'outcome': 'equipped', 'id': 'wurm_tooth'})
    ev = db._trove(table, _sid(table), doc, 'city_trove')
    assert ev['type'] == 'trove'
    assert doc['spores'] == before + data.TROVE_REWARD['spores']
    assert ev['gear']['id'] == 'wurm_tooth'
    assert 'trove:city_trove' in doc['poiClaims']
    # Second visit: looted bare, no double pay.
    doc['spores'] = 0
    ev2 = db._trove(table, _sid(table), doc, 'city_trove')
    assert doc['spores'] == 0
    assert 'gear' not in ev2
```

- [ ] **Step 2: Run to verify they fail**

Run: `cd infrastructure/lambda && python -m pytest tests/test_deep_dungeons.py -k trove -q`
Expected: FAIL — `module 'undercity_db' has no attribute '_trove'`.

- [ ] **Step 3: Add the trove reward constant**

In `undercity_data.py`, near `VAULT_REWARD` (line ~610):

```python
# Trove: a hidden dungeon strongroom. Fatter than a cache/vault and a GUARANTEED
# high-tier gear drop — the payoff for exploring the dark instead of beelining.
TROVE_REWARD = {'spores': 110, 'xp': 30}
TROVE_GEAR_TIERS = {2: 0.5, 3: 0.5}
```

- [ ] **Step 4: Add the `_trove` handler**

In `undercity_db.py`, near `_cache` (~line 2305):

```python
def _trove(table, sid, doc, node):
    """Hidden dungeon strongroom: fat spores + XP + a guaranteed gear drop,
    first visit per player (poiClaims 'trove:<node>')."""
    claims = doc.setdefault('poiClaims', [])
    key = f'trove:{node}'
    if key in claims:
        return {'type': 'trove',
                'text': 'The strongroom hangs open and empty — your work, last time.'}
    claims.append(key)
    r = data.TROVE_REWARD
    doc['spores'] = doc.get('spores', 0) + r['spores']
    _grant_xp(table, sid, doc, r['xp'])
    out = {'type': 'trove', 'spores': r['spores'],
           'text': f"A sealed strongroom cracks open — +{r['spores']} Spores!"}
    drop = _roll_gear_drop(doc, data.TROVE_GEAR_TIERS)
    if drop:
        out['gear'] = drop
        verb = 'equip it' if drop['outcome'] == 'equipped' else 'salvage it'
        out['text'] += f" A glimmering relic within — you {verb}!"
    _event(table, sid, 'trove',
           f"{doc['username']} cracked a hidden trove in the deep dark!",
           actor=doc['userId'])
    return out
```

- [ ] **Step 5: Dispatch the `trove` node type**

In the node-type dispatch (beside `if ntype == 'cache'`, ~line 1601), add:

```python
    if ntype == 'trove':
        return _trove(table, sid, doc, node)
```

- [ ] **Step 6: Run to verify they pass**

Run: `cd infrastructure/lambda && python -m pytest tests/test_deep_dungeons.py -k trove -q`
Expected: PASS.

- [ ] **Step 7: Commit**

```bash
git add infrastructure/lambda/undercity_data.py infrastructure/lambda/undercity_db.py infrastructure/lambda/tests/test_deep_dungeons.py
git commit -m "feat(undercity): trove room node (fat one-time payout + guaranteed gear)"
```

---

## Task 4: Depths-aware respawn

**Files:**
- Modify: `infrastructure/lambda/undercity_data.py` (entrance helper)
- Modify: `infrastructure/lambda/undercity_db.py:547-579` (`_compost`)
- Test: `infrastructure/lambda/tests/test_deep_dungeons.py`

- [ ] **Step 1: Write the failing test**

Append to `tests/test_deep_dungeons.py`:

```python
def test_compost_in_depths_respawns_at_entrance(table):
    doc = _join(table, home='city')
    entrance = data.dungeon_entrance('city')
    assert entrance and data.MAP_NODES[entrance]['region'] == 'depths'
    # Pretend the player died deep in the city dungeon.
    deep = next(n for n, spec in data.MAP_NODES.items()
                if data.dungeon_biome(n) == 'city' and n != entrance)
    doc['position'] = deep
    doc['hp'] = 1
    db._compost(table, _sid(table), doc, 'test death')
    assert doc['position'] == entrance
    assert 'pendingRespawn' not in doc          # no choice for a depths death


def test_compost_on_surface_unchanged(table):
    doc = _join(table, home='city')
    home_gate = data.HOME_GATES['city']
    doc['position'] = home_gate
    db._compost(table, _sid(table), doc, 'test death')
    assert doc['position'] == home_gate
```

- [ ] **Step 2: Run to verify they fail**

Run: `cd infrastructure/lambda && python -m pytest tests/test_deep_dungeons.py -k compost -q`
Expected: FAIL — `module 'undercity_data' has no attribute 'dungeon_entrance'`.

- [ ] **Step 3: Add the entrance helper**

In `undercity_data.py`, after `dungeon_biome` (~line 674):

```python
# The depths-side ladder mouth of each dungeon — the respawn point for a death
# in that biome's dark. Exactly one ladder node per depths pocket (map-linted).
def dungeon_entrance(biome):
    for nid, n in MAP_NODES.items():
        if n.get('region') == 'depths' and n['type'] == 'ladder' \
                and nid.split('_')[0] == biome:
            return nid
    return None
```

- [ ] **Step 4: Make `_compost` depths-aware**

In `undercity_db.py` `_compost`, capture the death location at the top of the function (right after the `undying` early-return block, before `home_biome = ...`, ~line 559):

```python
    died_at = doc.get('position')
    died_biome = data.dungeon_biome(died_at)
```

Then replace the `home_gate` position assignment / respawn-choice block so a depths death routes to the entrance. After the existing line `doc['position'] = home_gate  # provisional; ...` and the hp/shield/composts/pendingMove lines, change the respawn-offer block to:

```python
    if died_biome:
        # Died in the dark: crawl back to the dungeon mouth, no gate choice.
        entrance = data.dungeon_entrance(died_biome)
        if entrance:
            doc['position'] = entrance
        doc.pop('pendingRespawn', None)
    else:
        last_biome = doc.get('lastBiome')
        if last_biome and last_biome != home_biome and last_biome in data.HOME_GATES:
            doc['pendingRespawn'] = {'options': [
                {'gate': home_gate, 'label': f"{data.BIOMES[home_biome]['name']} (home)"},
                {'gate': data.HOME_GATES[last_biome], 'label': data.BIOMES[last_biome]['name']},
            ]}
        else:
            doc.pop('pendingRespawn', None)
```

(This preserves the original surface behaviour verbatim in the `else` branch.)

- [ ] **Step 5: Run to verify they pass**

Run: `cd infrastructure/lambda && python -m pytest tests/test_deep_dungeons.py -k compost -q`
Expected: PASS.

- [ ] **Step 6: Commit**

```bash
git add infrastructure/lambda/undercity_data.py infrastructure/lambda/undercity_db.py infrastructure/lambda/tests/test_deep_dungeons.py
git commit -m "feat(undercity): depths deaths respawn at the dungeon entrance"
```

---

## Task 5: Author the city maze in map.json

The behaviours above are node-type-agnostic; this task builds the actual large
dark maze for `city` and locks its shape with a structural test. Layout is done
in the dev editor (`/undercity/map-editor`), which writes `map.json`; the test is
the acceptance gate.

**Files:**
- Modify: `infrastructure/lambda/map.json` (via editor or by hand)
- Run: `python infrastructure/lambda/sync_map.py`
- Modify: `infrastructure/lambda/tests/test_map_file.py`
- Test: `infrastructure/lambda/tests/test_deep_dungeons.py`

- [ ] **Step 1: Write the failing structural test**

Append to `tests/test_deep_dungeons.py`:

```python
import collections


def _city_depths():
    return {n for n, spec in data.MAP_NODES.items()
            if spec.get('region') == 'depths' and n.split('_')[0] == 'city'}


def _bfs_hops(start, goal):
    seen = {start}
    q = collections.deque([(start, 0)])
    while q:
        cur, d = q.popleft()
        if cur == goal:
            return d
        for nb in data.MAP_NODES[cur]['neighbors']:
            if nb not in seen:
                seen.add(nb)
                q.append((nb, d + 1))
    return None


def test_city_maze_is_large_dark_and_complete():
    nodes = _city_depths()
    assert len(nodes) >= 24, 'city dungeon should be a real maze, not a pocket'
    types = collections.Counter(data.MAP_NODES[n]['type'] for n in nodes)
    assert types['trove'] == 1
    assert types['rest'] == 1
    assert types['lair'] == 1
    assert types['ladder'] >= 1
    # Every depths node reachable from the entrance mouth.
    entrance = data.dungeon_entrance('city')
    for n in nodes:
        assert _bfs_hops(entrance, n) is not None, f'{n} is stranded'
    # The lair sits a real journey from the mouth (>= 6 hops of shortest path;
    # actual travel is longer once exact-count movement is applied).
    lair = next(n for n in nodes if data.MAP_NODES[n]['type'] == 'lair')
    assert _bfs_hops(entrance, lair) >= 6


def test_city_lair_still_grants_the_sigil():
    lair = next(n for n in _city_depths() if data.MAP_NODES[n]['type'] == 'lair')
    assert lair in data.SIGIL_LAIRS and data.SIGIL_LAIRS[lair] == 'city'
```

- [ ] **Step 2: Run to verify it fails**

Run: `cd infrastructure/lambda && python -m pytest tests/test_deep_dungeons.py -k maze -q`
Expected: FAIL — the current city pocket has far fewer than 24 depths nodes and no `trove`/`rest`.

- [ ] **Step 3: Author the maze**

Open `/undercity/map-editor` (`npm start`, then navigate there). In the `city` depths region:

- Keep the existing ladder pair as the **entrance mouth** (its depths node id must remain `city_d*` so `dungeon_biome`/`dungeon_entrance` resolve).
- Lay a **critical path of ≥ 20 nodes** from the mouth to the lair, with 3–4 **branch spurs** (dead-ends) hanging off it. Total depths nodes ≥ 24.
- Node type mix along the path: mostly `wild`/`hazard`/`loot`, plus **1–2 `elite`** nodes weighted toward the lair, the existing biome `wild`/`hazard` theming.
- Place exactly one **`trove`** node and one **`rest`** node, each at the **end of a branch spur** (so a dark beeline misses them).
- Keep exactly one **`lair`** node at the far end (type `lair`, id `city_lair` per `SIGIL_LAIRS`), and one entrance `ladder`.
- Ensure the depths `region` entry in `map.json` keeps `"dark": true` (fog-of-war). New nodes must set `"region": "depths"`.

If hand-editing `map.json`, mirror the existing depths-node schema: `{ "id": "city_dN", "x": ..., "y": ..., "type": "...", "region": "depths", "neighbors": [...] }` with **symmetric** neighbor lists (each edge listed on both nodes — the map lint enforces this).

- [ ] **Step 4: Sync the client copy**

Run: `python infrastructure/lambda/sync_map.py`
Expected: `public/data/undercity-map.json` rewritten to match `map.json`.

- [ ] **Step 5: Update the node-count assertion**

`tests/test_map_file.py:20` asserts `len(doc['nodes']) == 131`. Change `131` to the new total (131 minus the old city depths pocket count plus the new maze count — read the actual number from the failing test output and set it exactly).

- [ ] **Step 6: Run the map + maze tests**

Run: `cd infrastructure/lambda && python -m pytest tests/test_map_file.py tests/test_deep_dungeons.py -q`
Expected: PASS (client copy matches, node count correct, maze structural asserts green).

- [ ] **Step 7: Run the full suite to catch map-coupling regressions**

Run: `cd infrastructure/lambda && python -m pytest tests -q`
Expected: PASS. If a test elsewhere hardcoded a specific `city_d*` id that you renumbered, fix the reference (do not weaken the assertion).

- [ ] **Step 8: Commit**

```bash
git add infrastructure/lambda/map.json public/data/undercity-map.json infrastructure/lambda/tests/test_map_file.py infrastructure/lambda/tests/test_deep_dungeons.py
git commit -m "feat(undercity): author the large dark city sigil maze"
```

---

## Task 6: Client — torch light radius, node rendering, toggle button

No frontend test runner exists (per CLAUDE.md); verify by running the app.

**Files:**
- Modify: `src/app/undercity/engine/board-canvas.ts`
- Modify: `src/app/undercity/tabs/board-tab.component.ts`
- Modify: `src/app/undercity/engine/board-space.ts`
- Modify: `src/app/undercity/services/undercity-models.ts` (add `torchLit` to the player type)

- [ ] **Step 1: Carry `torchLit` on the player model**

In `undercity-models.ts`, add `torchLit?: boolean;` to the `PublicPlayer` interface (beside `sigils`/`composts`).

- [ ] **Step 2: Widen the fog-of-war radius when the torch is lit**

In `board-canvas.ts`, add a field near `revealAll` (~line 343):

```typescript
  /** Own torch state: widens the light radius in dungeons. */
  private ownTorchLit = false;
```

In `setPlayers`, after computing `own`, set it:

```typescript
    this.ownTorchLit = !!own?.torchLit;
```

Replace the neighbor-only test in `isLit` ([board-canvas.ts:477-484](../src/app/undercity/engine/board-canvas.ts#L477)) with a radius-limited BFS:

```typescript
  private isLit(nodeId: string): boolean {
    if (this.activeLayerId === OVERWORLD) return true;
    if (this.revealAll) return true;
    if (this.explored.get(this.activeLayerId)?.has(nodeId)) return true;
    if (!this.ownPosition) return false;
    const hops = this.ownTorchLit ? TORCH_LIGHT_HOPS : 1;
    return this.hopsWithin(this.ownPosition, nodeId, hops);
  }

  /** True if `goal` is within `maxHops` graph steps of `start`. */
  private hopsWithin(start: string, goal: string, maxHops: number): boolean {
    if (start === goal) return true;
    const seen = new Set([start]);
    let frontier = [start];
    for (let d = 0; d < maxHops; d++) {
      const next: string[] = [];
      for (const id of frontier) {
        for (const nb of this.nodeMap.get(id)?.neighbors ?? []) {
          if (nb === goal) return true;
          if (!seen.has(nb)) { seen.add(nb); next.push(nb); }
        }
      }
      frontier = next;
    }
    return false;
  }
```

Add the constant near the top of the file (with the other module constants):

```typescript
const TORCH_LIGHT_HOPS = 2; // mirrors data.TORCH.lightHops
```

- [ ] **Step 3: Render the `rest` and `trove` node types**

In `board-space.ts` (and wherever node type → glyph/colour is mapped, following the existing `cache`/`vault` entries), add `rest` (a hearth/ember glyph, warm colour) and `trove` (a chest/gem glyph, gold accent). Match the existing icon/colour token conventions from STYLE_GUIDE.md — reuse `--accent-color`, do not invent new palette values.

- [ ] **Step 4: Add a torch toggle button in the board UI**

In `board-tab.component.ts`, add a button visible when the own player is in a `depths` node, calling the `toggle-torch` action through the existing action service (mirror how other board actions like `set-stance` are dispatched). Label reflects state: “Light torch” / “Douse torch”, with a subtitle noting the −ATK/−DEF cost.

- [ ] **Step 5: Build to verify it compiles**

Run: `npm run build`
Expected: build succeeds into `docs/` with no TS errors. (Per repo quirks, verify via build, not lint.)

- [ ] **Step 6: Manual verification**

Run `npm start`, open `/undercity`, join with `home: city`, descend into the city maze. Confirm: (a) unlit, you see ~1 hop; (b) after tapping the torch toggle, sight widens to ~2 hops and combat stats show the penalty; (c) landing on the rest node heals you and refuses a second heal the same descent; (d) the trove pays out once; (e) dying in the maze drops you at the entrance mouth with the map still lit.

- [ ] **Step 7: Commit**

```bash
git add src/app/undercity/engine/board-canvas.ts src/app/undercity/tabs/board-tab.component.ts src/app/undercity/engine/board-space.ts src/app/undercity/services/undercity-models.ts
git commit -m "feat(undercity): torch light radius, rest/trove rendering, toggle UI"
```

---

## Task 7: Balance mirrors + full verification

**Files:**
- Modify: `src/app/undercity/data/*.ts` (whichever mirrors gear/economy display)

- [ ] **Step 1: Mirror the new numbers**

Add display mirrors for `TORCH` (−3 ATK / −2 DEF), `REST` (full heal), and `TROVE_REWARD` (110 spores / guaranteed t2–t3 gear) to the relevant `src/app/undercity/data/*.ts` file(s), matching how existing rewards are mirrored (per the tune-undercity-balance skill). If no user-facing mirror surfaces these numbers, skip — do not create a mirror nothing reads.

- [ ] **Step 2: Full backend suite**

Run: `cd infrastructure/lambda && python -m pytest tests -q`
Expected: PASS (all green, including the map sync-copy check).

- [ ] **Step 3: Production build**

Run: `npm run build`
Expected: succeeds.

- [ ] **Step 4: Commit**

```bash
git add src/app/undercity/data
git commit -m "chore(undercity): mirror torch/rest/trove numbers to client data"
```

- [ ] **Step 5: Hand off for deploy**

Per project convention the user runs deploys. Report: backend suite green, build clean, city vertical slice ready to playtest; the CDK/Lambda deploy + `npm run deploy` are the user's to run. After playtesting confirms the feel, replicate the maze template to the `bog`/`cavern`/`bone`/`garden` dungeons (repeat Task 5 per biome; the Task 1–4 server behaviour is already biome-agnostic).

---

## Self-review notes

- **Spec coverage:** maze size (Task 5), hidden trove + rest (Tasks 2/3/5), darkness/torch tradeoff (Tasks 1/6), depths respawn keeping the lit map (Task 4 + client localStorage persistence), unchanged sigil reward (Task 5 `test_city_lair_still_grants_the_sigil`), vertical-slice-first (Task 5 city only; Task 7 Step 5 replicate later).
- **Design deviation:** the torch is a toggle (`torchLit`), not an equipped gear slot — the gear system has no unequip/inventory path, so a slot-based torch could not be "swapped out for a fight." The toggle delivers the same light-vs-combat tradeoff more simply and testably. Acquisition is deferred to the toggle being always-available for the slice; gating it behind finding/buying a torch is a follow-up knob.
- **Numbers are starting points:** `TORCH` penalty/hops, `TROVE_REWARD`, rest = full heal, maze length (≥24 nodes / ≥6 hop lair) — all tunable live next session.
