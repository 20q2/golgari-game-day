# Undercity Companions — Plan 1: Foundation (server) Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add the server-side companion foundation — pet/egg data, player state, and the incubate → hatch → own → merge / level / salvage lifecycle — all behind `POST /game/action`, fully covered by the pytest FakeTable suite.

**Architecture:** New balance tables in `undercity_data.py` + scalars in `undercity_config.py`; new player-doc fields (`pets`, `eggs`, `incubator`, `activePetId`, `petCooldowns`) seeded in `_new_player_doc`; new action handlers in `undercity_db.py` following the existing `def _handler(table, sid, doc, payload) -> (status, body)` → `_save_or_conflict` → `_ok(doc, text=...)` convention; registered in the `handlers` dispatch map. Pets are instances `{id, species, tier, level, mergeProgress}` where **tier is rarity** (mirrors gear). Materials reuse the existing `moltings` + `ichor` (ichor = "Gemstones"). No client work in this plan.

**Tech Stack:** Python 3.11 Lambda, pytest with in-memory `FakeTable`. No boto3 in engine/rules.

---

## Verification approach

The server has a real test runner. Every task is TDD:

- Test command (from repo root): `cd infrastructure/lambda && python -m pytest tests/test_undercity_companions.py -q`
- Full suite regression before the final commit: `cd infrastructure/lambda && python -m pytest tests -q` (keep it green).
- New tests live in `infrastructure/lambda/tests/test_undercity_companions.py`, importing the shared harness (`table`, `act`, `_player_at`, `_sid`) from `test_undercity_db`, exactly like `test_undercity_market.py` does.

Balance numbers in this plan are **initial values meant to be tuned later** (via the tune-undercity-balance workflow) — they exist so the code and tests are concrete, not because they're final.

## File structure

- `infrastructure/lambda/undercity_data.py` — companion balance tables (`PET_SPECIES`, `PET_HATCH`, `PET_LEVEL_CAP`, `PET_MERGE_POINTS`, `PET_MERGE_COST`, `PET_LEVEL_MOLTINGS`, `PET_LEVEL_ICHOR`, `PET_SALVAGE_MOLTINGS`, `PET_SALVAGE_ICHOR_MIN_TIER`).
- `infrastructure/lambda/undercity_config.py` — `PET_INCUBATE_MINUTES`.
- `infrastructure/lambda/undercity_db.py` — player-state seeding, pet helpers, six action handlers, dispatch registration.
- `infrastructure/lambda/tests/test_undercity_companions.py` — new test module.

## Data shapes (referenced across tasks)

```
Egg   = {'id': str, 'tier': int}                      # tier 1..4, biases hatch
Pet   = {'id': str, 'species': str, 'tier': int,      # tier == rarity (1..4)
         'level': int, 'mergeProgress': int}
incubator = {'eggId': str, 'startedAt': str} | None   # startedAt = ISO (server clock, no Z)
```

---

### Task 1: Companion balance tables + config

**Files:**
- Modify: `infrastructure/lambda/undercity_data.py`
- Modify: `infrastructure/lambda/undercity_config.py`
- Create: `infrastructure/lambda/tests/test_undercity_companions.py`

- [ ] **Step 1: Write the failing test**

Create `infrastructure/lambda/tests/test_undercity_companions.py`:

```python
import sys, os
from datetime import datetime, timedelta

sys.path.insert(0, os.path.join(os.path.dirname(__file__), '..'))

import undercity_db as db
import undercity_data as data
import undercity_config as config
# Shared harness (fixtures + helpers) from the DB test module.
from test_undercity_db import table, act, _player_at, _sid  # noqa: F401


def test_pet_tables_wellformed():
    # Five species, each with a name/kind/blurb.
    assert set(data.PET_SPECIES) == {'fox', 'turtle', 'bird', 'mouse', 'grub'}
    for sp in data.PET_SPECIES.values():
        assert sp['kind'] in ('combat-passive', 'activated', 'economy')
        assert sp['name'] and sp['blurb']
    # Progression tables cover the four rarity tiers.
    assert set(data.PET_LEVEL_CAP) == {1, 2, 3, 4}
    assert data.PET_MERGE_COST.keys() == {2, 3, 4}       # cost to REACH tier 2/3/4
    assert config.PET_INCUBATE_MINUTES == 15
```

- [ ] **Step 2: Run test to verify it fails**

Run: `cd infrastructure/lambda && python -m pytest tests/test_undercity_companions.py::test_pet_tables_wellformed -v`
Expected: FAIL with `AttributeError: module 'undercity_data' has no attribute 'PET_SPECIES'`.

- [ ] **Step 3: Add the config scalar**

In `infrastructure/lambda/undercity_config.py`, near the other timer scalars (e.g. below `GRIMOIRE_SWAP_COOLDOWN_MIN`):

```python
# ── Companions ────────────────────────────────────────────────────────────
# Minutes an egg sits in the (single) incubator before it can hatch.
PET_INCUBATE_MINUTES = 15
```

- [ ] **Step 4: Add the balance tables**

In `infrastructure/lambda/undercity_data.py`, append a companions section (initial, tunable values):

```python
# ── Companions ────────────────────────────────────────────────────────────
# Each pet is an instance whose `tier` is its rarity (1 Common .. 4 Mythic),
# mirroring gear. `kind` selects how the pet acts.
PET_SPECIES = {
    'fox':    {'name': 'Fox',    'kind': 'combat-passive',
               'blurb': 'Chance to strike a follow-up hit in battle.'},
    'turtle': {'name': 'Turtle', 'kind': 'combat-passive',
               'blurb': 'Chance to deflect a few points of damage.'},
    'bird':   {'name': 'Bird',   'kind': 'activated',
               'blurb': "Scouts a bazaar's stock before you arrive."},
    'mouse':  {'name': 'Mouse',  'kind': 'activated',
               'blurb': 'Scavenges a small cache of loot.'},
    'grub':   {'name': 'Grub',   'kind': 'economy',
               'blurb': 'Trickles moltings as you travel.'},
}

# Egg tier -> weighted species outcomes. An egg always hatches; the egg's tier
# also becomes the hatched pet's starting tier. Higher-tier eggs skew away from
# the economy Grub toward the rarer actives.
PET_HATCH = {
    1: {'fox': 1.0, 'turtle': 1.0, 'bird': 1.0, 'mouse': 1.0, 'grub': 1.0},
    2: {'fox': 1.0, 'turtle': 1.0, 'bird': 1.0, 'mouse': 1.0, 'grub': 0.6},
    3: {'fox': 1.0, 'turtle': 1.0, 'bird': 0.8, 'mouse': 0.8, 'grub': 0.4},
    4: {'fox': 1.0, 'turtle': 1.0, 'bird': 0.6, 'mouse': 0.6, 'grub': 0.3},
}

# Level cap per tier — merging raises tier, leveling fills to the cap.
PET_LEVEL_CAP = {1: 3, 2: 5, 3: 7, 4: 9}

# Merge: each fodder pet contributes points by ITS tier; a pet advances one tier
# when accumulated mergeProgress reaches PET_MERGE_COST[next_tier]. Remainder
# carries over. Same-species fodder only (enforced in the handler).
PET_MERGE_POINTS = {1: 1, 2: 3, 3: 7, 4: 15}
PET_MERGE_COST   = {2: 2, 3: 3, 4: 4}   # points to reach tier 2 / 3 / 4

# Per-level upgrade cost, by the pet's current tier.
PET_LEVEL_MOLTINGS = {1: 2, 2: 3, 3: 5, 4: 8}
PET_LEVEL_ICHOR    = {1: 0, 2: 0, 3: 1, 4: 1}

# Salvage yield: moltings = base[tier] + (level-1); ichor granted at/above tier.
PET_SALVAGE_MOLTINGS      = {1: 1, 2: 2, 3: 4, 4: 6}
PET_SALVAGE_ICHOR_MIN_TIER = 3
```

- [ ] **Step 5: Run test to verify it passes**

Run: `cd infrastructure/lambda && python -m pytest tests/test_undercity_companions.py::test_pet_tables_wellformed -v`
Expected: PASS.

- [ ] **Step 6: Commit**

```bash
git add infrastructure/lambda/undercity_data.py infrastructure/lambda/undercity_config.py infrastructure/lambda/tests/test_undercity_companions.py
git commit -m "feat(undercity): companion balance tables + incubate config"
```

---

### Task 2: Player-state fields + pet helpers

**Files:**
- Modify: `infrastructure/lambda/undercity_db.py`
- Test: `infrastructure/lambda/tests/test_undercity_companions.py`

- [ ] **Step 1: Write the failing test**

Append to `test_undercity_companions.py`:

```python
def test_new_player_has_empty_companion_state(table):
    sid, doc = _player_at(table, 'n1')
    assert doc['pets'] == []
    assert doc['eggs'] == []
    assert doc['incubator'] is None
    assert doc['activePetId'] is None
    assert doc['petCooldowns'] == {}


def test_pet_helpers(table):
    sid, doc = _player_at(table, 'n1')
    pid = db._new_id('pet-')
    assert pid.startswith('pet-') and len(pid) > 4
    pet = {'id': pid, 'species': 'fox', 'tier': 1, 'level': 1, 'mergeProgress': 0}
    doc['pets'] = [pet]
    assert db._find_pet(doc, pid) is pet
    assert db._find_pet(doc, 'missing') is None
```

- [ ] **Step 2: Run test to verify it fails**

Run: `cd infrastructure/lambda && python -m pytest tests/test_undercity_companions.py -k "companion_state or pet_helpers" -v`
Expected: FAIL — `KeyError: 'pets'` (or `AttributeError` on `_new_id`).

- [ ] **Step 3: Seed the new fields**

In `undercity_db.py`, inside `_new_player_doc` (the `doc = {...}` literal, ~lines 2182-2211), add these entries alongside the existing inventory fields:

```python
        'pets': [], 'activePetId': None,
        'eggs': [], 'incubator': None,
        'petCooldowns': {},
```

- [ ] **Step 4: Add helpers + the id generator**

Ensure `uuid4` is importable — at the top of `undercity_db.py` add (if not already present):

```python
from uuid import uuid4
```

Then add these helpers near the other `_materials`-style doc helpers (~line 855):

```python
def _new_id(prefix):
    """Short unique id for pets/eggs (e.g. 'pet-1a2b3c4d')."""
    return f"{prefix}{uuid4().hex[:8]}"


def _find_pet(doc, pet_id):
    for p in doc.get('pets') or []:
        if p.get('id') == pet_id:
            return p
    return None
```

- [ ] **Step 5: Run tests to verify they pass**

Run: `cd infrastructure/lambda && python -m pytest tests/test_undercity_companions.py -k "companion_state or pet_helpers" -v`
Expected: PASS (2 tests).

- [ ] **Step 6: Commit**

```bash
git add infrastructure/lambda/undercity_db.py infrastructure/lambda/tests/test_undercity_companions.py
git commit -m "feat(undercity): seed companion player-state + pet helpers"
```

---

### Task 3: Grant egg, incubate, and hatch

**Files:**
- Modify: `infrastructure/lambda/undercity_db.py`
- Test: `infrastructure/lambda/tests/test_undercity_companions.py`

- [ ] **Step 1: Write the failing test**

Append to `test_undercity_companions.py`:

```python
def _incubating_since(minutes_ago):
    return (datetime.utcnow() - timedelta(minutes=minutes_ago)).isoformat(timespec='seconds')


def test_grant_incubate_hatch_flow(table):
    sid, doc = _player_at(table, 'n1')
    # Grant an egg (drop helper) — tier-2 egg lands in the inventory.
    db._grant_egg(doc, 2)
    assert len(doc['eggs']) == 1 and doc['eggs'][0]['tier'] == 2
    egg_id = doc['eggs'][0]['id']

    # Put it in the incubator.
    status, body = db._incubate_egg(table, sid, doc, {'eggId': egg_id})
    assert status == 200
    assert doc['eggs'] == []
    assert doc['incubator']['eggId'] == egg_id

    # Not ready yet -> hatch is rejected.
    status, _ = db._hatch_egg(table, sid, doc, {})
    assert status == 429

    # Backdate the timer past the incubation window, then hatch.
    doc['incubator']['startedAt'] = _incubating_since(config.PET_INCUBATE_MINUTES + 1)
    status, body = db._hatch_egg(table, sid, doc, {})
    assert status == 200
    assert doc['incubator'] is None
    assert len(doc['pets']) == 1
    pet = doc['pets'][0]
    assert pet['species'] in data.PET_SPECIES
    assert pet['tier'] == 2 and pet['level'] == 1 and pet['mergeProgress'] == 0
    assert body['you']['pets'][0]['id'] == pet['id']


def test_incubate_rejects_when_slot_busy(table):
    sid, doc = _player_at(table, 'n1')
    db._grant_egg(doc, 1); db._grant_egg(doc, 1)
    first = doc['eggs'][0]['id']; second = doc['eggs'][1]['id']
    db._incubate_egg(table, sid, doc, {'eggId': first})
    status, _ = db._incubate_egg(table, sid, doc, {'eggId': second})
    assert status == 409
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `cd infrastructure/lambda && python -m pytest tests/test_undercity_companions.py -k "incubate or hatch" -v`
Expected: FAIL — `AttributeError: module 'undercity_db' has no attribute '_grant_egg'`.

- [ ] **Step 3: Implement grant + incubate + hatch**

In `undercity_db.py`, add near the pet helpers from Task 2:

```python
def _pick_weighted(rng, weights):
    """Pick a key from {key: weight}; deterministic ordering by sorted key."""
    total = sum(weights.values())
    roll = rng.random() * total
    for key in sorted(weights):
        roll -= weights[key]
        if roll < 0:
            return key
    return max(weights, key=weights.get)


def _grant_egg(doc, tier):
    """Drop a companion egg of the given tier into the player's inventory."""
    egg = {'id': _new_id('egg-'), 'tier': int(tier)}
    doc.setdefault('eggs', []).append(egg)
    return egg


def _incubate_egg(table, sid, doc, payload):
    if doc.get('incubator'):
        return _err('The incubator is already busy.', 409)
    eggs = doc.setdefault('eggs', [])
    egg_id = payload.get('eggId')
    egg = next((e for e in eggs if e.get('id') == egg_id), None)
    if not egg:
        return _err('No such egg.', 409)
    eggs.remove(egg)
    doc['incubator'] = {'eggId': egg['id'], 'startedAt': _now(), 'tier': egg['tier']}
    conflict = _save_or_conflict(table, doc)
    if conflict:
        return conflict
    return _ok(doc, text='The egg is warming in the incubator.')


def _incubator_ready(inc):
    started = inc.get('startedAt')
    if not started:
        return False
    elapsed = datetime.utcnow() - datetime.fromisoformat(started)
    return elapsed >= timedelta(minutes=config.PET_INCUBATE_MINUTES)


def _hatch_egg(table, sid, doc, payload):
    inc = doc.get('incubator')
    if not inc:
        return _err('Nothing is incubating.', 409)
    if not _incubator_ready(inc):
        elapsed = datetime.utcnow() - datetime.fromisoformat(inc['startedAt'])
        wait = config.PET_INCUBATE_MINUTES - int(elapsed.total_seconds() // 60)
        return _err(f'The egg needs {max(wait, 1)} more min.', 429)
    tier = int(inc.get('tier', 1))
    species = _pick_weighted(_rng, data.PET_HATCH.get(tier, data.PET_HATCH[1]))
    pet = {'id': _new_id('pet-'), 'species': species, 'tier': tier,
           'level': 1, 'mergeProgress': 0}
    doc.setdefault('pets', []).append(pet)
    doc['incubator'] = None
    conflict = _save_or_conflict(table, doc)
    if conflict:
        return conflict
    name = data.PET_SPECIES[species]['name']
    return _ok(doc, text=f'The egg hatches into a {name}!', hatched=pet)
```

Note: `datetime`, `timedelta`, and the seeded module RNG `_rng` are already imported/defined in `undercity_db.py` (used by `_equip_grimoire` and `_weighted_tier`). `_now()` returns an ISO string on the server clock (no trailing `Z`), matching the grimoire-swap timer.

- [ ] **Step 4: Run tests to verify they pass**

Run: `cd infrastructure/lambda && python -m pytest tests/test_undercity_companions.py -k "incubate or hatch" -v`
Expected: PASS (2 tests).

- [ ] **Step 5: Commit**

```bash
git add infrastructure/lambda/undercity_db.py infrastructure/lambda/tests/test_undercity_companions.py
git commit -m "feat(undercity): egg grant + incubate + hatch actions"
```

---

### Task 4: Activate a pet (swap)

**Files:**
- Modify: `infrastructure/lambda/undercity_db.py`
- Test: `infrastructure/lambda/tests/test_undercity_companions.py`

- [ ] **Step 1: Write the failing test**

Append:

```python
def _give_pet(doc, species='fox', tier=1, level=1):
    pet = {'id': db._new_id('pet-'), 'species': species, 'tier': tier,
           'level': level, 'mergeProgress': 0}
    doc.setdefault('pets', []).append(pet)
    return pet


def test_activate_pet(table):
    sid, doc = _player_at(table, 'n1')
    pet = _give_pet(doc, 'turtle')
    status, body = db._activate_pet(table, sid, doc, {'petId': pet['id']})
    assert status == 200
    assert doc['activePetId'] == pet['id']
    # Unknown pet is rejected.
    status, _ = db._activate_pet(table, sid, doc, {'petId': 'nope'})
    assert status == 409
```

- [ ] **Step 2: Run test to verify it fails**

Run: `cd infrastructure/lambda && python -m pytest tests/test_undercity_companions.py -k activate -v`
Expected: FAIL — `AttributeError: ... '_activate_pet'`.

- [ ] **Step 3: Implement**

In `undercity_db.py`, add:

```python
def _activate_pet(table, sid, doc, payload):
    pet = _find_pet(doc, payload.get('petId'))
    if not pet:
        return _err('No such pet.', 409)
    doc['activePetId'] = pet['id']
    conflict = _save_or_conflict(table, doc)
    if conflict:
        return conflict
    return _ok(doc, text=f"{data.PET_SPECIES[pet['species']]['name']} is at your side.")
```

- [ ] **Step 4: Run test to verify it passes**

Run: `cd infrastructure/lambda && python -m pytest tests/test_undercity_companions.py -k activate -v`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add infrastructure/lambda/undercity_db.py infrastructure/lambda/tests/test_undercity_companions.py
git commit -m "feat(undercity): activate-pet action"
```

---

### Task 5: Merge pets (same-species → tier up)

**Files:**
- Modify: `infrastructure/lambda/undercity_db.py`
- Test: `infrastructure/lambda/tests/test_undercity_companions.py`

- [ ] **Step 1: Write the failing test**

Append:

```python
def test_merge_same_species_ranks_up(table):
    sid, doc = _player_at(table, 'n1')
    keeper = _give_pet(doc, 'fox', tier=1)
    f1 = _give_pet(doc, 'fox', tier=1)
    f2 = _give_pet(doc, 'fox', tier=1)
    # 2 tier-1 fodder = 2 merge points = PET_MERGE_COST[2] -> tier 2.
    status, body = db._merge_pet(table, sid, doc, {
        'targetPetId': keeper['id'], 'fodderPetIds': [f1['id'], f2['id']]})
    assert status == 200
    assert keeper['tier'] == 2
    assert keeper['mergeProgress'] == 0
    # Fodder consumed; only the keeper remains.
    assert [p['id'] for p in doc['pets']] == [keeper['id']]


def test_merge_rejects_cross_species(table):
    sid, doc = _player_at(table, 'n1')
    keeper = _give_pet(doc, 'fox')
    fodder = _give_pet(doc, 'turtle')
    status, _ = db._merge_pet(table, sid, doc, {
        'targetPetId': keeper['id'], 'fodderPetIds': [fodder['id']]})
    assert status == 409
    # Nothing consumed on rejection.
    assert len(doc['pets']) == 2


def test_merge_partial_progress_carries(table):
    sid, doc = _player_at(table, 'n1')
    keeper = _give_pet(doc, 'fox', tier=1)   # needs 2 points for tier 2
    f1 = _give_pet(doc, 'fox', tier=1)       # 1 point
    status, _ = db._merge_pet(table, sid, doc, {
        'targetPetId': keeper['id'], 'fodderPetIds': [f1['id']]})
    assert status == 200
    assert keeper['tier'] == 1 and keeper['mergeProgress'] == 1
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `cd infrastructure/lambda && python -m pytest tests/test_undercity_companions.py -k merge -v`
Expected: FAIL — `AttributeError: ... '_merge_pet'`.

- [ ] **Step 3: Implement**

In `undercity_db.py`, add:

```python
def _merge_pet(table, sid, doc, payload):
    target = _find_pet(doc, payload.get('targetPetId'))
    if not target:
        return _err('No such pet.', 409)
    fodder_ids = payload.get('fodderPetIds') or []
    if not fodder_ids:
        return _err('Pick pets to merge in.')
    fodder = []
    for fid in fodder_ids:
        p = _find_pet(doc, fid)
        if not p or p['id'] == target['id']:
            return _err('Bad merge selection.', 409)
        if p['species'] != target['species']:
            return _err('Only the same species can be merged.', 409)
        fodder.append(p)
    # Award merge points, then advance tiers while affordable (cap tier 4).
    gained = sum(data.PET_MERGE_POINTS[p['tier']] for p in fodder)
    target['mergeProgress'] = target.get('mergeProgress', 0) + gained
    while target['tier'] < 4:
        cost = data.PET_MERGE_COST[target['tier'] + 1]
        if target['mergeProgress'] < cost:
            break
        target['mergeProgress'] -= cost
        target['tier'] += 1
    # Consume fodder.
    consumed = {p['id'] for p in fodder}
    doc['pets'] = [p for p in doc['pets'] if p['id'] not in consumed]
    conflict = _save_or_conflict(table, doc)
    if conflict:
        return conflict
    r = data.tierRarity(target['tier']) if hasattr(data, 'tierRarity') else target['tier']
    return _ok(doc, text=f"Your {data.PET_SPECIES[target['species']]['name']} grows stronger.")
```

Note: `data.tierRarity` does not exist server-side (tier IS rarity on the server; the label map lives only in the client `items.ts`). The `hasattr` guard keeps the text safe; the label isn't needed in the message, so the handler just names the species.

- [ ] **Step 4: Run tests to verify they pass**

Run: `cd infrastructure/lambda && python -m pytest tests/test_undercity_companions.py -k merge -v`
Expected: PASS (3 tests).

- [ ] **Step 5: Commit**

```bash
git add infrastructure/lambda/undercity_db.py infrastructure/lambda/tests/test_undercity_companions.py
git commit -m "feat(undercity): merge-pet (same-species tier up)"
```

---

### Task 6: Level a pet (spend moltings/ichor, capped by tier)

**Files:**
- Modify: `infrastructure/lambda/undercity_db.py`
- Test: `infrastructure/lambda/tests/test_undercity_companions.py`

- [ ] **Step 1: Write the failing test**

Append:

```python
def test_level_pet_spends_materials(table):
    sid, doc = _player_at(table, 'n1')
    pet = _give_pet(doc, 'fox', tier=1, level=1)   # tier-1 level cost: 2 moltings
    doc['materials'] = {'moltings': 5, 'ichor': 0}
    status, body = db._level_pet(table, sid, doc, {'petId': pet['id']})
    assert status == 200
    assert pet['level'] == 2
    assert doc['materials']['moltings'] == 3


def test_level_pet_rejects_when_short(table):
    sid, doc = _player_at(table, 'n1')
    pet = _give_pet(doc, 'fox', tier=1, level=1)
    doc['materials'] = {'moltings': 0, 'ichor': 0}
    status, _ = db._level_pet(table, sid, doc, {'petId': pet['id']})
    assert status == 402
    assert pet['level'] == 1


def test_level_pet_rejects_at_cap(table):
    sid, doc = _player_at(table, 'n1')
    # Tier-1 cap is 3.
    pet = _give_pet(doc, 'fox', tier=1, level=data.PET_LEVEL_CAP[1])
    doc['materials'] = {'moltings': 99, 'ichor': 99}
    status, _ = db._level_pet(table, sid, doc, {'petId': pet['id']})
    assert status == 409
    assert pet['level'] == data.PET_LEVEL_CAP[1]
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `cd infrastructure/lambda && python -m pytest tests/test_undercity_companions.py -k level_pet -v`
Expected: FAIL — `AttributeError: ... '_level_pet'`.

- [ ] **Step 3: Implement**

In `undercity_db.py`, add (reuses the existing `_materials(doc)` helper that backfills `moltings`/`ichor`):

```python
def _level_pet(table, sid, doc, payload):
    pet = _find_pet(doc, payload.get('petId'))
    if not pet:
        return _err('No such pet.', 409)
    cap = data.PET_LEVEL_CAP[pet['tier']]
    if pet['level'] >= cap:
        return _err('Already at this rarity’s level cap — merge to rank up.', 409)
    need_m = data.PET_LEVEL_MOLTINGS[pet['tier']]
    need_i = data.PET_LEVEL_ICHOR[pet['tier']]
    m = _materials(doc)
    if m['moltings'] < need_m or m['ichor'] < need_i:
        return _err('Not enough moltings/gemstones.', 402)
    m['moltings'] -= need_m
    m['ichor'] -= need_i
    pet['level'] += 1
    conflict = _save_or_conflict(table, doc)
    if conflict:
        return conflict
    return _ok(doc, text=f"{data.PET_SPECIES[pet['species']]['name']} reaches level {pet['level']}.")
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `cd infrastructure/lambda && python -m pytest tests/test_undercity_companions.py -k level_pet -v`
Expected: PASS (3 tests).

- [ ] **Step 5: Commit**

```bash
git add infrastructure/lambda/undercity_db.py infrastructure/lambda/tests/test_undercity_companions.py
git commit -m "feat(undercity): level-pet (moltings/ichor sink, tier-capped)"
```

---

### Task 7: Salvage a pet (→ moltings, +ichor past threshold)

**Files:**
- Modify: `infrastructure/lambda/undercity_db.py`
- Test: `infrastructure/lambda/tests/test_undercity_companions.py`

- [ ] **Step 1: Write the failing test**

Append:

```python
def test_salvage_low_tier_gives_moltings(table):
    sid, doc = _player_at(table, 'n1')
    pet = _give_pet(doc, 'fox', tier=1, level=1)   # base 1 molting, no ichor
    doc['materials'] = {'moltings': 0, 'ichor': 0}
    status, body = db._salvage_pet(table, sid, doc, {'petId': pet['id']})
    assert status == 200
    assert doc['materials']['moltings'] == 1
    assert doc['materials']['ichor'] == 0
    assert doc['pets'] == []


def test_salvage_high_tier_gives_ichor_and_scales_with_level(table):
    sid, doc = _player_at(table, 'n1')
    pet = _give_pet(doc, 'fox', tier=3, level=3)   # base 4 + (level-1)=2 -> 6 moltings, +1 ichor
    doc['materials'] = {'moltings': 0, 'ichor': 0}
    status, _ = db._salvage_pet(table, sid, doc, {'petId': pet['id']})
    assert status == 200
    assert doc['materials']['moltings'] == 6
    assert doc['materials']['ichor'] == 1


def test_salvage_clears_active_pointer(table):
    sid, doc = _player_at(table, 'n1')
    pet = _give_pet(doc, 'fox')
    doc['activePetId'] = pet['id']
    db._salvage_pet(table, sid, doc, {'petId': pet['id']})
    assert doc['activePetId'] is None
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `cd infrastructure/lambda && python -m pytest tests/test_undercity_companions.py -k salvage -v`
Expected: FAIL — `AttributeError: ... '_salvage_pet'`.

- [ ] **Step 3: Implement**

In `undercity_db.py`, add:

```python
def _salvage_pet(table, sid, doc, payload):
    pet = _find_pet(doc, payload.get('petId'))
    if not pet:
        return _err('No such pet.', 409)
    moltings = data.PET_SALVAGE_MOLTINGS[pet['tier']] + (pet['level'] - 1)
    ichor = 1 if pet['tier'] >= data.PET_SALVAGE_ICHOR_MIN_TIER else 0
    m = _materials(doc)
    m['moltings'] += moltings
    m['ichor'] += ichor
    doc['pets'] = [p for p in doc['pets'] if p['id'] != pet['id']]
    if doc.get('activePetId') == pet['id']:
        doc['activePetId'] = None
    conflict = _save_or_conflict(table, doc)
    if conflict:
        return conflict
    gem = f" +{ichor} gemstone" if ichor else ''
    return _ok(doc, text=f"Salvaged for {moltings} moltings{gem}.")
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `cd infrastructure/lambda && python -m pytest tests/test_undercity_companions.py -k salvage -v`
Expected: PASS (3 tests).

- [ ] **Step 5: Commit**

```bash
git add infrastructure/lambda/undercity_db.py infrastructure/lambda/tests/test_undercity_companions.py
git commit -m "feat(undercity): salvage-pet (moltings + ichor yield)"
```

---

### Task 8: Register actions in the dispatcher

**Files:**
- Modify: `infrastructure/lambda/undercity_db.py:1661-1684` (the `handlers` dict)
- Test: `infrastructure/lambda/tests/test_undercity_companions.py`

- [ ] **Step 1: Write the failing test**

This exercises the full `handle_action` dispatch path (not the private handlers) via the `act` harness, proving the actions are wired and routable.

```python
def test_actions_routed_through_dispatch(table):
    # Join a player through the real dispatcher, then drive a pet action.
    _player_at(table, 'n1')   # ensures a season + a joined player 'user-alex'
    # Seed an egg directly on the stored doc, then incubate via full dispatch.
    doc = db._get_player(table, _sid(table), 'user-alex')
    db._grant_egg(doc, 1)
    db._save_or_conflict(table, doc)
    egg_id = doc['eggs'][0]['id']
    status, body = act(table, 'incubate-egg', eggId=egg_id)
    assert status == 200
    assert body['you']['incubator']['eggId'] == egg_id

    # An unknown pet action is still rejected by the dispatcher.
    status, body = act(table, 'activate-pet', petId='nope')
    assert status == 409
```

- [ ] **Step 2: Run test to verify it fails**

Run: `cd infrastructure/lambda && python -m pytest tests/test_undercity_companions.py -k routed -v`
Expected: FAIL — `Unknown action: incubate-egg` (status 400), so the `status == 200` assert fails.

- [ ] **Step 3: Register the handlers**

In `undercity_db.py`, add these entries to the `handlers` dict (~lines 1661-1684), next to the other economy actions:

```python
        'incubate-egg': _incubate_egg,
        'hatch-egg': _hatch_egg,
        'activate-pet': _activate_pet,
        'merge-pet': _merge_pet,
        'level-pet': _level_pet,
        'salvage-pet': _salvage_pet,
```

These are intentionally left out of `_BATTLE_ALLOWED_ACTIONS` (line 1696), so they're blocked mid-fight like other non-combat economy actions — a pet action returns "Finish your fight first." during a battle, which is the desired behavior.

- [ ] **Step 4: Run test to verify it passes**

Run: `cd infrastructure/lambda && python -m pytest tests/test_undercity_companions.py -k routed -v`
Expected: PASS.

- [ ] **Step 5: Run the full companion module + full suite**

Run: `cd infrastructure/lambda && python -m pytest tests/test_undercity_companions.py -q`
Expected: all companion tests PASS.
Run: `cd infrastructure/lambda && python -m pytest tests -q`
Expected: the whole suite stays green (no regressions).

- [ ] **Step 6: Commit**

```bash
git add infrastructure/lambda/undercity_db.py infrastructure/lambda/tests/test_undercity_companions.py
git commit -m "feat(undercity): register companion actions in dispatcher"
```

---

## Self-review

- **Spec coverage (Plan 1 scope):** data model (Task 1-2), eggs + 1-slot 15-min incubator + hatch (Task 3), one active + activate/swap (Task 4), same-species merge → rarity/tier (Task 5), level via moltings/ichor capped by tier (Task 6), salvage → moltings +ichor past threshold (Task 7), dispatch wiring + mid-fight blocking (Task 8). Egg *drop sources*, combat hooks (Fox/Turtle), activated abilities (Bird/Mouse), the Grub trickle, client mirrors, the Companion UI, and market-sell are **later plans (2-4)** by the stated decomposition, not gaps.
- **Placeholder scan:** none — every code step is complete; balance numbers are concrete (flagged as tunable).
- **Type/name consistency:** `_new_id`, `_find_pet`, `_grant_egg`, `_incubate_egg`, `_incubator_ready`, `_hatch_egg`, `_activate_pet`, `_merge_pet`, `_level_pet`, `_salvage_pet`, `_pick_weighted` are defined once and referenced consistently; pet fields (`id/species/tier/level/mergeProgress`), egg fields (`id/tier`), and `incubator` (`eggId/startedAt/tier`) match across tasks; tables (`PET_SPECIES`, `PET_HATCH`, `PET_LEVEL_CAP`, `PET_MERGE_POINTS`, `PET_MERGE_COST`, `PET_LEVEL_MOLTINGS`, `PET_LEVEL_ICHOR`, `PET_SALVAGE_MOLTINGS`, `PET_SALVAGE_ICHOR_MIN_TIER`) and `PET_INCUBATE_MINUTES` are defined in Task 1 and used as written; reuses existing `_ok`/`_err`/`_save_or_conflict`/`_materials`/`_now`/`_rng` per the confirmed signatures.
