# Undercity Guardian Targeting & Pacing Lair Bosses — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Let the range-based field spells (`field_damage`/`field_curse`) target guardians of any kind — barrier guardians (the Golgari Grave-Troll), biome lair bosses, and Savra — and make lair bosses pace menacingly behind their spaces.

**Architecture:** Server-side, both barrier guardians and lair/boss records gain a persistent HP pool + a persisted-curse `buffs[]` list; a target dispatcher routes field spells to a new `_cast_at_guardian` handler that range-checks, chips the pool (floored at 1, no dodge, no reward), or stores a curse read as a flat stat penalty at the guardian's next battle. Client-side, the state payload gains a `guardians` map so the spell picker can list in-range guardians with live HP, and the board canvas draws a menacing-idle boss behind each lair node.

**Tech Stack:** Python 3.11 Lambda (pure functions + DynamoDB via a FakeTable pytest suite), Angular 20 standalone components + a hand-rolled 2.5D canvas renderer (TypeScript).

**Spec:** `specs/2026-07-19-undercity-guardian-targeting-design.md`

---

## File Structure

**Server (`infrastructure/lambda/`):**
- `undercity_data.py` — add `GUARDIAN_DEBUFF` table (curse-kind → flat NPC stat penalty).
- `undercity_db.py` — the bulk: `_apply_guardian_debuffs`, barrier pool helpers, `buffs[]` round-trip on lair/boss setters, consume-at-battle-start wiring in `_barrier`/`_lair`/`_boss`, the `_cast_field` dispatcher + `_cast_at_guardian`, and `_guardian_pools` in the state serializer.
- `tests/test_undercity_spells.py` — new guardian-targeting tests.
- `tests/test_undercity_db.py` — barrier-pool persistence test.

**Client (`src/app/undercity/`):**
- `services/undercity-models.ts` — `GuardianPool` type + `boss`/`guardians` on `GameState`.
- `services/undercity-state.service.ts` — `guardians` computed signal.
- `tabs/board-tab.component.ts` — `spellGuardianTargets()`.
- `tabs/board-tab.component.html` — render guardian entries in the field-spell picker.
- `data/items.ts` — `LAIR_GUARDIANS` (lair node → npc art id).
- `engine/board-canvas.ts` — `drawLairBoss()` + menacing-idle constants.

**Test command (server):** `cd infrastructure/lambda && python -m pytest tests -q`
**Verify command (client):** `npm run build` (no JS test runner in this repo — the CLAUDE.md notes `ng test` is not wired up; verify TS changes compile).

---

## Task 1: Guardian debuff table + apply helper (server)

A field-curse buff (e.g. Bone Chill) is designed as a *player* debuff read by `effective_stats`. On a rooted guardian we translate it to a flat stat penalty applied for its next battle. This task adds the mapping and the pure helper; later tasks call it.

**Files:**
- Modify: `infrastructure/lambda/undercity_data.py` (after `LAIR_BOSSES`, ~line 575)
- Modify: `infrastructure/lambda/undercity_db.py` (near `_apply_buff`, ~line 2314)
- Test: `infrastructure/lambda/tests/test_undercity_spells.py`

- [ ] **Step 1: Write the failing test**

Add to `tests/test_undercity_spells.py`:

```python
def test_guardian_debuff_applies_flat_penalty():
    npc = {'atk': 11, 'def': 6, 'spd': 3}
    db._apply_guardian_debuffs(npc, [{'kind': 'bone_chill'}, {'kind': 'vines'}])
    assert npc['atk'] == 11 - 2      # bone_chill
    assert npc['spd'] == 3 - 2       # vines -> speed bite
    # Penalties floor at 1, unknown kinds are ignored.
    npc2 = {'atk': 2, 'def': 6, 'spd': 3}
    db._apply_guardian_debuffs(npc2, [{'kind': 'weaken_hex'}, {'kind': 'nonsense'}])
    assert npc2['atk'] == 1          # max(1, 2 - 3)
```

- [ ] **Step 2: Run test to verify it fails**

Run: `cd infrastructure/lambda && python -m pytest tests/test_undercity_spells.py::test_guardian_debuff_applies_flat_penalty -q`
Expected: FAIL — `AttributeError: module 'undercity_db' has no attribute '_apply_guardian_debuffs'`.

- [ ] **Step 3: Add the data table**

In `undercity_data.py`, after the `LAIR_BOSSES` dict:

```python
# Field-curse buffs, when they land on a rooted guardian/boss, resolve to a
# flat NPC stat penalty applied for its NEXT battle (floored at 1). Roll-halving
# (vines/bog_snare) is meaningless for an NPC, so it becomes a speed bite.
# Keys are field_curse buffKinds; mirror any new field curse here.
GUARDIAN_DEBUFF = {
    'bone_chill': {'atk': -2},
    'weaken_hex': {'atk': -3},
    'vines':      {'spd': -2},
}
```

- [ ] **Step 4: Add the apply helper**

In `undercity_db.py`, just after `_apply_buff`:

```python
def _apply_guardian_debuffs(npc, buffs):
    """Translate persisted field-curse buffs into flat NPC stat penalties for
    this one battle (each stat floored at 1). Guardians are rooted, so a
    roll-halving curse becomes a speed penalty (see data.GUARDIAN_DEBUFF)."""
    for b in buffs or []:
        delta = data.GUARDIAN_DEBUFF.get(b.get('kind'))
        if not delta:
            continue
        for stat, d in delta.items():
            npc[stat] = max(1, npc.get(stat, 0) + d)
```

- [ ] **Step 5: Run test to verify it passes**

Run: `cd infrastructure/lambda && python -m pytest tests/test_undercity_spells.py::test_guardian_debuff_applies_flat_penalty -q`
Expected: PASS.

- [ ] **Step 6: Commit**

```bash
git add infrastructure/lambda/undercity_data.py infrastructure/lambda/undercity_db.py infrastructure/lambda/tests/test_undercity_spells.py
git commit -m "feat(undercity): guardian debuff table + apply helper"
```

---

## Task 2: Barrier guardian persistent pool + curse state (server)

Barrier guardians have no persistent HP today (a barrier is a binary open/closed gate). Give them a `BARRIER#{node}` record with `hp` + `buffs[]` — like a lair pool — so wounds and curses linger across the season. Wire `_barrier` to read the pool, apply+consume curses, and `_finish_barrier` to persist the pool on a non-winning fight.

**Files:**
- Modify: `infrastructure/lambda/undercity_db.py` (`_barrier` ~1726, `_finish_barrier` ~1991)
- Test: `infrastructure/lambda/tests/test_undercity_db.py`

- [ ] **Step 1: Write the failing test**

Add to `tests/test_undercity_db.py` (it already imports `db`, `data`, `FakeTable`, `act`, and has `_sid`-style helpers — reuse the module's existing `_sid`/player helpers; if none, mirror `test_undercity_spells._sid`):

```python
def test_barrier_pool_lingers_and_reads_back(table):
    sid, _ = db._active_season(table)
    # No record yet -> full HP, no buffs.
    hp, buffs = db._barrier_state(table, sid, 'bar_e')
    assert hp == data.BARRIER_GUARDIANS['bar_e']['hp'] and buffs == []
    # A wounded pool + a stored curse round-trip.
    db._set_barrier_state(table, sid, 'bar_e', 20, [{'kind': 'bone_chill'}])
    hp, buffs = db._barrier_state(table, sid, 'bar_e')
    assert hp == 20 and buffs == [{'kind': 'bone_chill'}]
```

Use the `table` fixture from `test_undercity_spells` if `test_undercity_db` lacks one — otherwise add at top of `test_undercity_db.py`:

```python
@pytest.fixture
def table():
    t = FakeTable()
    status, _ = act(t, 'season-start', hostKey='swampking')
    assert status == 200
    return t
```

- [ ] **Step 2: Run test to verify it fails**

Run: `cd infrastructure/lambda && python -m pytest tests/test_undercity_db.py::test_barrier_pool_lingers_and_reads_back -q`
Expected: FAIL — `AttributeError: ... '_barrier_state'`.

- [ ] **Step 3: Add barrier state helpers**

In `undercity_db.py`, next to `_lair_state`/`_set_lair_state` (~line 1736):

```python
def _barrier_state(table, sid, node):
    """Barrier guardian's lingering pool: current HP + persisted curse buffs."""
    rec = _get(table, _season_pk(sid), f'BARRIER#{node}') or {}
    full = data.BARRIER_GUARDIANS[node]['hp']
    return int(rec.get('hp', full)), list(rec.get('buffs') or [])


def _set_barrier_state(table, sid, node, hp, buffs=None):
    """Write the pool. buffs=None preserves whatever curses are already stored
    (so a post-battle HP write never clobbers a fresh curse); pass [] to clear."""
    if buffs is None:
        buffs = (_get(table, _season_pk(sid), f'BARRIER#{node}') or {}).get('buffs') or []
    item = {'pk': _season_pk(sid), 'sk': f'BARRIER#{node}', 'hp': int(hp)}
    if buffs:
        item['buffs'] = buffs
    table.put_item(Item=item)
```

- [ ] **Step 4: Wire `_barrier` to read the pool + apply/consume curses**

Replace the body of `_barrier` (~line 1726):

```python
def _barrier(table, sid, doc, node):
    if node in _open_barriers(table, sid):
        return {'type': 'barrier_open',
                'text': 'The shattered barricade lies in rubble. The way stands open.'}
    g = data.BARRIER_GUARDIANS[node]
    hp_pool, buffs = _barrier_state(table, sid, node)
    npc = dict(g, hp=hp_pool, maxHp=g['hp'],
               personality=g.get('personality', 'turtle'), bluff=g.get('bluff', 0.15))
    _apply_guardian_debuffs(npc, buffs)
    if buffs:
        _set_barrier_state(table, sid, node, hp_pool, [])   # consumed on engagement
    return _start_battle(table, sid, doc, 'barrier', npc, node=node)
```

- [ ] **Step 5: Wire `_finish_barrier` to persist the pool on non-win**

In `_finish_barrier` (~line 1991), add a pool write to the two non-attacker branches. Replace the `elif`/`else` tail:

```python
    elif result['outcome'] == 'defender':
        _set_barrier_state(table, sid, node, max(1, result['defenderHp']))
        _grant_xp(table, sid, doc, data.XP_REWARDS['wild_loss'])
        _compost(table, sid, doc,
                 f"{doc['username']} was crushed by the {g['name']}. The barrier holds.")
        out['text'] = f"The {g['name']} hurls you back. The barrier holds…"
    else:
        _set_barrier_state(table, sid, node, max(1, result['defenderHp']))
        _grant_xp(table, sid, doc, data.XP_REWARDS['timeout'])
        out['text'] = f"You trade blows with the {g['name']}, but the barrier holds."
    return out
```

(The `attacker` branch is unchanged: winning opens the barrier via `_open_barrier`, retiring the guardian.)

- [ ] **Step 6: Run test to verify it passes**

Run: `cd infrastructure/lambda && python -m pytest tests/test_undercity_db.py::test_barrier_pool_lingers_and_reads_back -q`
Expected: PASS.

- [ ] **Step 7: Run the full suite (guard against the barrier-difficulty change)**

Run: `cd infrastructure/lambda && python -m pytest tests -q`
Expected: PASS. If a test asserted the barrier NPC starts at full HP every attempt, it now lingers when wounded — update that test's expectation to match the new persistent-pool behaviour (documented in the design as intentional).

- [ ] **Step 8: Commit**

```bash
git add infrastructure/lambda/undercity_db.py infrastructure/lambda/tests/test_undercity_db.py
git commit -m "feat(undercity): barrier guardians keep a persistent HP + curse pool"
```

---

## Task 3: Lair & Savra curse round-trip + consume-at-battle-start (server)

Lair bosses and Savra already persist HP; extend their records with `buffs[]` and apply+consume any stored curse when the fight begins. This requires changing `_lair_state`'s return arity, so update its two existing callers.

**Files:**
- Modify: `infrastructure/lambda/undercity_db.py` (`_lair_state`/`_set_lair_state` ~1736, `_lair` ~1748, `_boss` ~2136, `_boss_hp`/`_set_boss_hp` ~1770, `_cast_boss_strike` ~2508)
- Test: `infrastructure/lambda/tests/test_undercity_spells.py`

- [ ] **Step 1: Write the failing test**

```python
def test_lair_curse_applies_and_is_consumed(table):
    sid, _ = db._active_season(table)
    node = 'city_lair'
    db._set_lair_state(table, sid, node, data.LAIR_BOSSES[node]['hp'], False,
                       [{'kind': 'weaken_hex'}])
    # Round-trips with buffs.
    hp, slain, buffs = db._lair_state(table, sid, node)
    assert buffs == [{'kind': 'weaken_hex'}] and slain is False
    # Starting the fight applies -3 ATK to the NPC and clears the stored curse.
    act(table, 'join', starter='pest', home='city')
    doc = db._get_player(table, sid, 'user-alex')
    doc['position'] = node
    db._put_player(table, doc)
    db._lair(table, sid, doc, node)
    rec = db._get(table, db._season_pk(sid), f'LAIR#{node}')
    assert not (rec or {}).get('buffs')      # consumed at battle start
    battle = db._get_player(table, sid, 'user-alex')['battle']
    assert battle['npc']['atk'] == data.LAIR_BOSSES[node]['atk'] - 3
```

(Confirm the field name the battle snapshot uses for the NPC's attack — grep `_start_battle` ~line 389/1923 for the stored `npc` shape; adjust `battle['npc']['atk']` to the actual key if it differs.)

- [ ] **Step 2: Run test to verify it fails**

Run: `cd infrastructure/lambda && python -m pytest tests/test_undercity_spells.py::test_lair_curse_applies_and_is_consumed -q`
Expected: FAIL — `_lair_state` returns a 2-tuple, so the 3-tuple unpack raises `ValueError`.

- [ ] **Step 3: Extend `_lair_state`/`_set_lair_state`**

Replace both (~line 1736):

```python
def _lair_state(table, sid, node):
    """Season-shared lair pool: current HP, whether the true boss has fallen,
    and any persisted curse buffs."""
    rec = _get(table, _season_pk(sid), f'LAIR#{node}') or {}
    full = data.LAIR_BOSSES[node]['hp']
    return int(rec.get('hp', full)), bool(rec.get('slain', False)), list(rec.get('buffs') or [])


def _set_lair_state(table, sid, node, hp, slain, buffs=None):
    """buffs=None preserves stored curses; pass [] to clear."""
    if buffs is None:
        buffs = (_get(table, _season_pk(sid), f'LAIR#{node}') or {}).get('buffs') or []
    item = {'pk': _season_pk(sid), 'sk': f'LAIR#{node}', 'hp': int(hp), 'slain': bool(slain)}
    if buffs:
        item['buffs'] = buffs
    table.put_item(Item=item)
```

- [ ] **Step 4: Update `_lair` and the `_cast_boss_strike` caller**

In `_lair` (~line 1757), change the unpack and apply/consume the curse:

```python
    b = data.LAIR_BOSSES[node]
    hp_pool, slain, buffs = _lair_state(table, sid, node)
    vest_max = b['hp'] // 2
    display = f"Vestige of {b['name']}" if slain else b['name']
    npc = dict(b, hp=hp_pool, name=display, maxHp=(vest_max if slain else b['hp']),
               personality=b.get('personality', 'balanced'), bluff=b.get('bluff', 0.20))
    _apply_guardian_debuffs(npc, buffs)
    if buffs:
        _set_lair_state(table, sid, node, hp_pool, slain, [])   # consumed on engagement
    return _start_battle(table, sid, doc, 'lair', npc, node=node,
                         ctx={'slain': slain, 'vestMax': vest_max})
```

In `_cast_boss_strike` (~line 2509), fix the now-3-tuple unpack:

```python
        hp, slain, _ = _lair_state(table, sid, target)
```

- [ ] **Step 5: Add boss buffs round-trip + apply/consume in `_boss`**

Replace `_set_boss_hp` and add a reader (~line 1770):

```python
def _boss_hp(table, sid):
    item = _get(table, _season_pk(sid), 'BOSS')
    return int((item or {}).get('hp', data.ROT_SOVEREIGN['hp']))


def _boss_buffs(table, sid):
    return list((_get(table, _season_pk(sid), 'BOSS') or {}).get('buffs') or [])


def _set_boss_hp(table, sid, hp, buffs=None):
    """buffs=None preserves stored curses; pass [] to clear."""
    if buffs is None:
        buffs = (_get(table, _season_pk(sid), 'BOSS') or {}).get('buffs') or []
    item = {'pk': _season_pk(sid), 'sk': 'BOSS', 'hp': int(hp)}
    if buffs:
        item['buffs'] = buffs
    table.put_item(Item=item)
```

In `_boss` (~line 2154), apply+consume:

```python
    boss = data.ROT_SOVEREIGN
    hp_before = _boss_hp(table, sid)
    buffs = _boss_buffs(table, sid)
    npc = dict(boss, hp=hp_before, maxHp=boss['hp'])
    _apply_guardian_debuffs(npc, buffs)
    if buffs:
        _set_boss_hp(table, sid, hp_before, [])   # consumed on engagement
    return _start_battle(table, sid, doc, 'boss', npc, node=node,
                         ctx={'hpBefore': hp_before})
```

- [ ] **Step 6: Run the test + full suite**

Run: `cd infrastructure/lambda && python -m pytest tests/test_undercity_spells.py::test_lair_curse_applies_and_is_consumed -q`
Expected: PASS.
Run: `cd infrastructure/lambda && python -m pytest tests -q`
Expected: PASS (the `_lair_state` arity change is fully propagated).

- [ ] **Step 7: Commit**

```bash
git add infrastructure/lambda/undercity_db.py infrastructure/lambda/tests/test_undercity_spells.py
git commit -m "feat(undercity): lair bosses & Savra carry persisted curses into battle"
```

---

## Task 4: Field-spell target dispatcher + `_cast_at_guardian` (server)

Route `field_damage`/`field_curse` to guardians/bosses when the target is a barrier/lair node or `'boss'`. Range-checked, chip floored at 1, no dodge, no reward; curses persist to the entity's `buffs[]`.

**Files:**
- Modify: `infrastructure/lambda/undercity_db.py` (`_cast` field branch ~2360, add `_cast_field` + `_cast_at_guardian` near `_cast_at_player` ~2399)
- Test: `infrastructure/lambda/tests/test_undercity_spells.py`

- [ ] **Step 1: Write the failing tests**

```python
def _cast_near_node(table, target_node, home='city', spell='scrap_toss'):
    """Join a caster on a neighbour of target_node (distance 1, guaranteed in
    range) and return (sid, caster_doc)."""
    sid, _ = db._active_season(table)
    act(table, 'join', starter='pest', home=home)
    doc = db._get_player(table, sid, 'user-alex')
    doc['position'] = data.MAP_NODES[target_node]['neighbors'][0]
    db._put_player(table, doc)
    return sid


def test_field_damage_chips_barrier_floored(table):
    sid = _cast_near_node(table, 'bar_e')
    full = data.BARRIER_GUARDIANS['bar_e']['hp']
    status, resp = act(table, 'cast', spellId='scrap_toss', source='innate', target='bar_e')
    assert status == 200 and resp['cast']['dmg'] == 8
    hp, _ = db._barrier_state(table, sid, 'bar_e')
    assert hp == full - 8
    # Floor: a huge pre-chip leaves exactly 1, never opens the barrier.
    db._set_barrier_state(table, sid, 'bar_e', 3)
    alex = db._get_player(table, sid, 'user-alex'); alex['spellCooldowns'] = {}
    db._put_player(table, alex)
    status, resp = act(table, 'cast', spellId='scrap_toss', source='innate', target='bar_e')
    hp, _ = db._barrier_state(table, sid, 'bar_e')
    assert hp == 1
    assert 'bar_e' not in db._open_barriers(table, sid)


def test_field_curse_persists_on_barrier(table):
    sid = _cast_near_node(table, 'bar_e', home='bone', spell='bone_chill')
    status, resp = act(table, 'cast', spellId='bone_chill', source='innate', target='bar_e')
    assert status == 200
    _, buffs = db._barrier_state(table, sid, 'bar_e')
    assert {'kind': 'bone_chill'} in buffs


def test_field_spell_guardian_out_of_range_no_cooldown(table):
    sid, _ = db._active_season(table)
    act(table, 'join', starter='pest', home='city')
    doc = db._get_player(table, sid, 'user-alex')
    doc['position'] = 'city_r1'   # far from bar_e; scrap_toss range 5
    db._put_player(table, doc)
    status, resp = act(table, 'cast', spellId='scrap_toss', source='innate', target='bar_e')
    # If city_r1 happens to be within 5 of bar_e on this map, skip.
    if status == 200:
        pytest.skip('city_r1 within range of bar_e on this board')
    assert status == 409 and resp['code'] == 'out_of_range'
    alex = db._get_player(table, sid, 'user-alex')
    assert 'scrap_toss' not in (alex.get('spellCooldowns') or {})
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `cd infrastructure/lambda && python -m pytest tests/test_undercity_spells.py -k "chips_barrier or curse_persists_on_barrier or guardian_out_of_range" -q`
Expected: FAIL — casting at `'bar_e'` currently hits the player path and returns `invalid_target` (no such player).

- [ ] **Step 3: Add the dispatcher + guardian handler**

In `undercity_db.py`, change the `_cast` field branch (~line 2360) from calling `_cast_at_player` to `_cast_field`:

```python
    elif effect in ('field_damage', 'field_curse'):
        out = _cast_field(table, sid, doc, spell_id, spell, payload.get('target'))
        if isinstance(out, tuple):
            return out
        result = out
```

Add, just above `_cast_at_player` (~line 2399):

```python
def _cast_field(table, sid, doc, spell_id, spell, target_id):
    """Route a field spell to a guardian/boss target, else a rival player."""
    if target_id == 'boss' or target_id in data.BARRIER_GUARDIANS or target_id in data.LAIR_BOSSES:
        return _cast_at_guardian(table, sid, doc, spell, target_id)
    return _cast_at_player(table, sid, doc, spell_id, spell, target_id)


def _cast_at_guardian(table, sid, doc, spell, target_id):
    """Field damage/curse at a rooted guardian/boss within range. Chips its
    persistent pool (floored at 1 — no remote kill/open) or persists a curse
    read at its next battle. No dodge, no bounty. An error tuple leaves the
    caster's cooldown unstarted."""
    if target_id == 'boss':
        node = data.BOSS_NODE
        name = data.ROT_SOVEREIGN['name']
        hp = _boss_hp(table, sid)
        maxhp = data.ROT_SOVEREIGN['hp']
        buffs = _boss_buffs(table, sid)

        def save(new_hp, new_buffs):
            _set_boss_hp(table, sid, new_hp, new_buffs)
    elif target_id in data.BARRIER_GUARDIANS:
        if target_id in _open_barriers(table, sid):
            return _spell_err('That barrier already lies in rubble.', 'invalid_target', 409)
        node = target_id
        name = data.BARRIER_GUARDIANS[target_id]['name']
        maxhp = data.BARRIER_GUARDIANS[target_id]['hp']
        hp, buffs = _barrier_state(table, sid, target_id)

        def save(new_hp, new_buffs):
            _set_barrier_state(table, sid, target_id, new_hp, new_buffs)
    else:  # lair boss
        node = target_id
        b = data.LAIR_BOSSES[target_id]
        hp, slain, buffs = _lair_state(table, sid, target_id)
        name = f"Vestige of {b['name']}" if slain else b['name']
        maxhp = (b['hp'] // 2) if slain else b['hp']

        def save(new_hp, new_buffs):
            _set_lair_state(table, sid, target_id, new_hp, slain, new_buffs)

    dist = engine.board_distance(data.MAP_NODES, doc['position'], node,
                                 spell['range'], _closed_barriers(table, sid))
    if dist is None:
        return _spell_err(f"It is beyond the spell's reach ({spell['range']} spaces).",
                          'out_of_range')

    if spell['effect'] == 'field_damage':
        new_hp = max(1, hp - spell['power'])
        dealt = hp - new_hp
        save(new_hp, buffs)
        if dealt:
            _event(table, sid, 'spell',
                   f"{doc['username']}'s {spell['name']} wounds {name} from afar "
                   f'({new_hp}/{maxhp} HP)!', actor=doc['userId'])
            text = f'{spell["name"]} wounds {name} for {dealt}! ({new_hp}/{maxhp} HP)'
        else:
            text = f'{name} is already at the brink — finish it in person.'
        return {'dmg': dealt, 'targetName': name, 'text': text}

    # field_curse: refresh-don't-stack, then persist.
    buffs = [x for x in buffs if x.get('kind') != spell['buffKind']]
    buffs.append({'kind': spell['buffKind']})
    save(hp, buffs)
    _event(table, sid, 'spell',
           f"{doc['username']} cursed {name} with {spell['name']}!", actor=doc['userId'])
    return {'targetName': name,
            'text': f'{spell["name"]} settles over {name} — it will fester in its next fight.'}
```

- [ ] **Step 4: Run the tests to verify they pass**

Run: `cd infrastructure/lambda && python -m pytest tests/test_undercity_spells.py -k "chips_barrier or curse_persists_on_barrier or guardian_out_of_range" -q`
Expected: PASS.

- [ ] **Step 5: Run the full suite**

Run: `cd infrastructure/lambda && python -m pytest tests -q`
Expected: PASS.

- [ ] **Step 6: Commit**

```bash
git add infrastructure/lambda/undercity_db.py infrastructure/lambda/tests/test_undercity_spells.py
git commit -m "feat(undercity): field spells can chip/curse guardians in range"
```

---

## Task 5: Expose guardian pools in the state payload (server)

The client picker needs each in-range guardian's name, art id, and live HP.

**Files:**
- Modify: `infrastructure/lambda/undercity_db.py` (state serializer ~640, add `_guardian_pools` near `_barrier_state`)
- Test: `infrastructure/lambda/tests/test_undercity_spells.py`

- [ ] **Step 1: Write the failing test**

```python
def test_state_exposes_guardian_pools(table):
    sid, _ = db._active_season(table)
    status, state = act(table, 'join', starter='pest', home='city')
    assert status == 200
    guardians = state['guardians']
    # Every unbroken barrier and every lair boss is listed with HP + art id.
    assert 'bar_e' in guardians
    assert guardians['bar_e']['npcId'] == 'golgari_grave_troll'
    assert guardians['bar_e']['hp'] == data.BARRIER_GUARDIANS['bar_e']['hp']
    assert 'city_lair' in guardians and guardians['city_lair']['kind'] == 'lair'
```

- [ ] **Step 2: Run test to verify it fails**

Run: `cd infrastructure/lambda && python -m pytest tests/test_undercity_spells.py::test_state_exposes_guardian_pools -q`
Expected: FAIL — `KeyError: 'guardians'`.

- [ ] **Step 3: Add `_guardian_pools` and include it in the payload**

Add near `_barrier_state`:

```python
def _guardian_pools(table, sid):
    """Live HP + curse state for every rooted target a field spell can reach:
    unbroken barrier guardians and lair bosses. Savra stays under `boss`."""
    open_bars = _open_barriers(table, sid)
    out = {}
    for node, g in data.BARRIER_GUARDIANS.items():
        if node in open_bars:
            continue
        hp, buffs = _barrier_state(table, sid, node)
        out[node] = {'kind': 'barrier', 'name': g['name'], 'npcId': g['id'],
                     'hp': hp, 'maxHp': g['hp'], 'buffs': [b['kind'] for b in buffs]}
    for node, b in data.LAIR_BOSSES.items():
        hp, slain, buffs = _lair_state(table, sid, node)
        out[node] = {'kind': 'lair', 'npcId': b['id'],
                     'name': f"Vestige of {b['name']}" if slain else b['name'],
                     'hp': hp, 'maxHp': (b['hp'] // 2) if slain else b['hp'],
                     'buffs': [x['kind'] for x in buffs]}
    return out
```

In the `out = {...}` dict (~line 652), add after the `'boss'` line:

```python
        'guardians': _guardian_pools(table, sid),
```

- [ ] **Step 4: Run test + full suite**

Run: `cd infrastructure/lambda && python -m pytest tests/test_undercity_spells.py::test_state_exposes_guardian_pools -q`
Expected: PASS.
Run: `cd infrastructure/lambda && python -m pytest tests -q`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add infrastructure/lambda/undercity_db.py infrastructure/lambda/tests/test_undercity_spells.py
git commit -m "feat(undercity): expose guardian HP pools in game state"
```

---

## Task 6: Client — list in-range guardians in the field-spell picker

Surface `guardians` (and Savra) as tappable targets in the existing field-spell picker, with distance and HP.

**Files:**
- Modify: `src/app/undercity/services/undercity-models.ts` (`GameState` ~178)
- Modify: `src/app/undercity/services/undercity-state.service.ts` (~67)
- Modify: `src/app/undercity/tabs/board-tab.component.ts` (~226)
- Modify: `src/app/undercity/tabs/board-tab.component.html` (~610)
- Verify: `npm run build`

- [ ] **Step 1: Add model types**

In `undercity-models.ts`, add before `GameState`:

```typescript
export interface GuardianPool {
  kind: 'barrier' | 'lair';
  name: string;
  npcId: string;
  hp: number;
  maxHp: number;
  buffs: string[];
}
```

Inside `GameState`, after `barriersOpen?`:

```typescript
  /** Island-boss (Savra) persistent HP pool. */
  boss?: { hp: number; maxHp: number };
  /** Barrier/lair node id -> its live guardian HP pool (field-spell targets). */
  guardians?: Record<string, GuardianPool>;
```

- [ ] **Step 2: Add store computed**

In `undercity-state.service.ts`, after the `barriersOpen` computed (~line 67):

```typescript
  readonly guardians = computed(() => this._state()?.guardians ?? {});
```

- [ ] **Step 3: Add `spellGuardianTargets` to the board tab**

In `board-tab.component.ts`, after `spellTargets` (~line 238):

```typescript
  /** In-range guardians/bosses a field spell can hit, with distance + HP.
   * Barrier/lair targets carry their node id; Savra carries the 'boss' token. */
  protected spellGuardianTargets(
    spell: SpellInfo,
  ): { target: string; name: string; hp: number; maxHp: number; dist: number }[] {
    const you = this.store.you();
    if (!you || !spell.range) return [];
    const closed = this.closedBarrierIds();
    const out: { target: string; name: string; hp: number; maxHp: number; dist: number }[] = [];
    for (const [node, g] of Object.entries(this.store.guardians())) {
      const dist = boardDistance(this.map, you.position, node, spell.range, closed);
      if (dist !== null) out.push({ target: node, name: g.name, hp: g.hp, maxHp: g.maxHp, dist });
    }
    const boss = this.store.state()?.boss;
    const bossNode = this.map.boss;
    if (boss && bossNode) {
      const dist = boardDistance(this.map, you.position, bossNode, spell.range, closed);
      if (dist !== null)
        out.push({ target: 'boss', name: 'Savra, the Queen', hp: boss.hp, maxHp: boss.maxHp, dist });
    }
    return out.sort((a, b) => a.dist - b.dist);
  }
```

(`this.map.boss` is the island-boss node id — the same field the spectator reads as `map.boss`. If the local `map` type doesn't expose `boss`, read it as `(this.map as { boss?: string }).boss`.)

- [ ] **Step 4: Render guardian targets in the picker**

In `board-tab.component.html`, inside the field-spell picker (~line 611), update the empty-state guard and add a guardian list. Replace the block from `<p class="modal-sub">Pick a rival...` through the rivals `@for`:

```html
        <p class="modal-sub">Pick a target within {{ sp.range }} spaces.</p>
        @if (!spellTargets(sp).length && !spellGuardianTargets(sp).length) {
          <p class="modal-sub">Nothing is in range. Stalk closer.</p>
        }
        @for (t of spellTargets(sp); track t.p.userId) {
          <div class="shop-row">
            <span class="shop-name">
              {{ t.p.username }}'s {{ t.p.creatureName || t.p.formName }}
              <em>{{ t.dist }} space{{ t.dist === 1 ? '' : 's' }} away · {{ t.p.hp }} HP</em>
            </span>
            <button class="uc-btn shop-buy" [disabled]="busy()" (click)="castSpell(sp, { target: t.p.userId })">
              Cast
            </button>
          </div>
        }
        @for (g of spellGuardianTargets(sp); track g.target) {
          <div class="shop-row">
            <span class="shop-name">
              {{ g.name }}
              <em>{{ g.dist }} space{{ g.dist === 1 ? '' : 's' }} away · {{ g.hp }}/{{ g.maxHp }} HP</em>
            </span>
            <button class="uc-btn shop-buy" [disabled]="busy()" (click)="castSpell(sp, { target: g.target })">
              Cast
            </button>
          </div>
        }
```

- [ ] **Step 5: Build to verify it compiles**

Run: `npm run build`
Expected: build succeeds (no TS errors). If `SpellInfo`/`boardDistance` imports are already present at the top of the component (they are — used by `spellTargets`), no new imports are needed.

- [ ] **Step 6: Commit**

```bash
git add src/app/undercity/services/undercity-models.ts src/app/undercity/services/undercity-state.service.ts src/app/undercity/tabs/board-tab.component.ts src/app/undercity/tabs/board-tab.component.html
git commit -m "feat(undercity): field-spell picker lists in-range guardians"
```

---

## Task 7: Client — menacing lair boss pacing behind its space

Draw the sigil boss lurking behind each lair node with a slow heavy-breathing idle and an occasional lunge.

**Files:**
- Modify: `src/app/undercity/data/items.ts` (after `GUARDIAN_PLACEHOLDER_SPRITE` ~205)
- Modify: `src/app/undercity/engine/board-canvas.ts` (import ~14, constants ~234, draw path ~1040, new method after `drawGuardian` ~1103)
- Verify: `npm run build`

- [ ] **Step 1: Add the lair→art-id map**

In `items.ts`, after `DEFAULT_GUARDIAN_SPRITE`:

```typescript
/**
 * Which boss lurks behind each lair space — mirrors LAIR_BOSSES ids
 * (undercity_data.py). Drawn pacing behind the lair; art at
 * undercity/guardians/<id>.png with the same placeholder fallback as barriers.
 */
export const LAIR_GUARDIANS: Record<string, string> = {
  lair_titan: 'gravebound_colossus',
  city_lair: 'ishkanah',
  cavern_lair: 'sarulf',
  bog_lair: 'gitrog_monster',
  bone_lair: 'skullbriar',
  garden_lair: 'slimefoot',
};
```

- [ ] **Step 2: Import it and add animation constants**

In `board-canvas.ts`, extend the `data/items` import (~line 14):

```typescript
import {
  BARRIER_GUARDIANS,
  LAIR_GUARDIANS,
  DEFAULT_GUARDIAN,
  GUARDIAN_PLACEHOLDER_SPRITE,
  DEFAULT_GUARDIAN_SPRITE,
} from '../data/items';
```

After the `GUARDIAN_*` constants (~line 234):

```typescript
// A lair boss paces behind its gate: heavier/slower breathing than a token and
// an occasional lunge — mostly stationary, reads as a caged beast.
const LAIR_H = 84; // bigger than a barrier guardian — it's a boss
const LAIR_BREATH_SPEED = 1.3; // slow, deep breathing
const LAIR_BREATH_AMT = 0.07; // ±7% vertical wobble
const LAIR_LUNGE_PERIOD = 5.0; // seconds between lunges
const LAIR_LUNGE_AMT = 12; // px forward dip at the lunge peak
const LAIR_BACK_OFFSET = 26; // px north — sits behind the lair space
```

- [ ] **Step 3: Call `drawLairBoss` from the node draw path**

In the node-draw method, right after the sealed-barrier guardian line (~line 1040):

```typescript
    // A sealed barrier is held by the area's guardian creature, standing across
    // the route; it's drawn no more the moment someone breaks the barrier.
    if (sealed) this.drawGuardian(n, elapsed);

    // Sigil bosses pace behind their lair spaces.
    if (n.type === 'lair') this.drawLairBoss(n, elapsed);
```

- [ ] **Step 4: Add `drawLairBoss`**

After `drawGuardian` (~line 1103):

```typescript
  /**
   * The sigil boss lurking behind its lair space: a slow, deep breathing idle
   * with an occasional forward lunge, drawn north of the coin so the lair
   * building reads as standing in front of it. Reuses the barrier guardian's
   * lazy art loader (undercity/guardians/<id>.png; placeholder sprite until).
   */
  private drawLairBoss(n: BoardNode, elapsed: number): void {
    const ctx = this.ctx;
    const bossId = LAIR_GUARDIANS[n.id] ?? DEFAULT_GUARDIAN;
    const art = this.guardianArt(bossId);
    if (!art) return;

    const phase = ((hashStr(n.id) % 1000) / 1000) * Math.PI * 2;
    const breath = 1 + Math.sin(elapsed * LAIR_BREATH_SPEED + phase) * LAIR_BREATH_AMT;
    // A lunge every ~LAIR_LUNGE_PERIOD s: a brief forward dip, else it settles.
    const t = (elapsed + phase) % LAIR_LUNGE_PERIOD;
    const lunge = t < 0.6 ? Math.sin((t / 0.6) * Math.PI) * LAIR_LUNGE_AMT : 0;

    const cx = n.x;
    const footAnchor = n.y - LAIR_BACK_OFFSET + lunge; // behind the space, dips on lunge

    ctx.save();
    const drawH = LAIR_H * breath;
    const w = art.img.width * (LAIR_H / art.img.height);
    const top = footAnchor - drawH;
    ctx.imageSmoothingEnabled = !art.pixelArt;
    ctx.drawImage(art.img, cx - w / 2, top, w, drawH);
    ctx.imageSmoothingEnabled = true;
    ctx.restore();
  }
```

- [ ] **Step 5: Build to verify it compiles**

Run: `npm run build`
Expected: build succeeds. `hashStr`, `getRawImage`, and `guardianArt` are already in this file (used by `drawGuardian`).

- [ ] **Step 6: Visual smoke check**

Run: `npm start`, open `/undercity`, enter a biome dungeon with a lair, and confirm the boss breathes and occasionally lunges behind the lair space without visual glitches. (No automated canvas test exists in this repo.)

- [ ] **Step 7: Commit**

```bash
git add src/app/undercity/data/items.ts src/app/undercity/engine/board-canvas.ts
git commit -m "feat(undercity): lair bosses pace menacingly behind their spaces"
```

---

## Self-review notes

- **Spec coverage:** Part 1 → Task 7. Part 2 persistent state → Tasks 2, 3, 5. Casting/dispatch → Task 4. `GUARDIAN_DEBUFF` + battle application → Tasks 1, 2, 3. Frontend picker + state exposure → Tasks 5, 6. Curse "consumed on any engagement" → the `if buffs: _set_*_state(..., [])` at battle start in Tasks 2/3. Floored-at-1 / no-remote-open → Task 4. Reward parity (no bounty on chip) → `_cast_at_guardian` grants none.
- **Type consistency:** `_lair_state` returns a 3-tuple everywhere after Task 3 (callers updated in the same task). `_set_lair_state`/`_set_barrier_state`/`_set_boss_hp` all take `buffs=None` = preserve. Client `GuardianPool` fields (`kind/name/npcId/hp/maxHp/buffs`) match the server `_guardian_pools` output exactly. `spellGuardianTargets` returns `target` (node id or `'boss'`), matching what `_cast_at_guardian` accepts.
- **Known minor race (documented, accepted):** a curse landed on a guardian while another player is mid-battle with it can be dropped when that battle's `_finish_*` writes HP — consistent with the game's existing optimistic-write model.
- **Deferred (per design):** dim-when-slain lair rendering (Task 7 renders full presence for slain/Vestige too).
