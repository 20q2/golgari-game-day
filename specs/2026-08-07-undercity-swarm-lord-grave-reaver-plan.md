# Swarm Lord & Colossal Grave-Reaver Apex Rework — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Re-skin the `swamp_dragon` apex into the insect finale **Swarm Lord** (passive `rot_breath`→`onslaught`), and add a new pest/economy apex **Colossal Grave-Reaver** with a `treasure_sense` loot-finder passive.

**Architecture:** All rules live server-side in `infrastructure/lambda/` (`undercity_data.py` tables, `undercity_engine.py` combat, `undercity_db.py` I/O + loot). Client `src/app/undercity/data/*.ts` files are display-only mirrors. Save-safety comes from the `_PASSIVE_RENAMES` migration map. TDD against the in-memory FakeTable pytest suite.

**Tech Stack:** Python 3.11 (Lambda, pytest), Angular 20 / TypeScript (client mirrors).

**Design doc:** [specs/2026-08-07-undercity-swarm-lord-grave-reaver-design.md](2026-08-07-undercity-swarm-lord-grave-reaver-design.md)

**Test command (run from `infrastructure/lambda/`):** `python -m pytest tests -q`

**Commit convention:** end every commit message with the trailer `Co-Authored-By: Claude Opus 4.8 (1M context) <noreply@anthropic.com>` (omitted from the sample commands below for brevity). Only stage the files named in each task — the working tree has unrelated parallel WIP that must not be swept into these commits.

---

## File Structure

- `infrastructure/lambda/undercity_config.py` — add Treasure-Sense scalar tunables.
- `infrastructure/lambda/undercity_data.py` — rename the `rot_breath` combat scalar + passive; re-skin `swamp_dragon` apex; add `grave_reaver` apex; trim two `from`-lists.
- `infrastructure/lambda/undercity_engine.py` — `has('rot_breath')` → `has('onslaught')`.
- `infrastructure/lambda/undercity_db.py` — `_PASSIVE_RENAMES` entry; `treasure_sense` rarity bump in `_roll_gear_drop`; new `_gear_drop_fires` helper routed through the gear-drop call sites.
- `infrastructure/lambda/tests/` — rename the rot_breath test; add onslaught-migration, apex-options, and treasure_sense tests.
- `src/app/undercity/data/forms.ts` — passive names/blurbs + APEX display list.
- `src/app/undercity/data/species.ts` — FORM_SPRITES sprite routing.
- `src/app/undercity/data/combat.ts` — PASSIVE_AUGMENTS key rename.
- `public/data/undercity-player-sprites.json` — register the `swarm_lord` sprite.
- `UNDERCITY_EVOLUTION.html` — relabel + re-edge the evolution graph.

---

## Task 1: Treasure-Sense config scalars

**Files:**
- Modify: `infrastructure/lambda/undercity_config.py`

- [ ] **Step 1: Add the scalars**

Append near the other economy/facility scalars in `undercity_config.py`:

```python
# ── Colossal Grave-Reaver: Treasure Sense (design 2026-08-07) ────────────────
# The economy apex finds gear far more often and one rarity tier higher.
TREASURE_SENSE_DROP_MULT   = 2.0  # gear-drop chance multiplier for the passive
TREASURE_SENSE_CHANCE_CAP  = 0.95 # cap so a boosted drop never becomes guaranteed
TREASURE_SENSE_RARITY_BUMP = 1    # rolled gear tier is bumped by this
TREASURE_SENSE_MAX_TIER    = 3    # ceiling — never bumps into craft-only tier-4 mythics
```

- [ ] **Step 2: Verify they import cleanly**

Run: `cd infrastructure/lambda && python -c "import undercity_data as d; print(d.TREASURE_SENSE_DROP_MULT, d.TREASURE_SENSE_MAX_TIER)"`
Expected: `2.0 3` (they surface on `undercity_data` via its `from undercity_config import *`).

- [ ] **Step 3: Commit**

```bash
git add infrastructure/lambda/undercity_config.py
git commit -m "feat(undercity): add Treasure Sense config scalars"
```

---

## Task 2: Rename passive `rot_breath` → `onslaught`

The effect is unchanged (round-1 winning exchange ×2); only the id/display and the scalar name change. Live saves migrate via `_PASSIVE_RENAMES`.

**Files:**
- Modify: `infrastructure/lambda/undercity_data.py:542` (scalar), `:203-208` (APEX entry passive)
- Modify: `infrastructure/lambda/undercity_engine.py:312-313`
- Modify: `infrastructure/lambda/undercity_db.py:353-358` (`_PASSIVE_RENAMES`)
- Test: `infrastructure/lambda/tests/test_undercity_engine.py:833`, `tests/test_undercity_onslaught_migration.py` (new)

- [ ] **Step 1: Update the existing combat test to the new id**

In `tests/test_undercity_engine.py`, replace `test_rot_breath_first_win_doubles` (currently at line 833) with:

```python
def test_onslaught_first_win_doubles():
    a = fighter(atk=10, dfn=5, hp=30, max_hp=30, passives=frozenset({'onslaught'}))
    d = fighter(atk=10, dfn=4, hp=60, max_hp=60)
    resolve_round(a, d, 'feint', 'guard', 1, FakeRng(uniform=1.0))  # feint>guard win
    # feint base 0.5*10+1.0*5=10, -def4=6; *WIN1.5*onslaught2 => 18
    assert d.hp == 60 - 18
```

- [ ] **Step 2: Run it — expect FAIL**

Run: `cd infrastructure/lambda && python -m pytest tests/test_undercity_engine.py::test_onslaught_first_win_doubles -q`
Expected: FAIL — the engine still checks `has('rot_breath')`, so a creature with `onslaught` gets no double and `d.hp` is 60 − 9 = 51, not 42.

- [ ] **Step 3: Rename the scalar in `undercity_data.py`**

At line 542, change:

```python
FIRST_WIN_ROT_BREATH_MULT = 2  # rot_breath: first winning exchange * this
```
to:
```python
ONSLAUGHT_MULT = 2  # onslaught (ex rot_breath): first winning exchange * this
```

- [ ] **Step 4: Update the engine hook in `undercity_engine.py`**

At lines 312-313, change:

```python
                if winr.has('rot_breath'):
                    mult *= data.FIRST_WIN_ROT_BREATH_MULT
```
to:
```python
                if winr.has('onslaught'):
                    mult *= data.ONSLAUGHT_MULT
```

- [ ] **Step 5: Update the APEX passive + blurb in `undercity_data.py`**

In `APEX['swamp_dragon']` (lines 203-208), change `'passive': 'rot_breath'` → `'passive': 'onslaught'`. (Name/from/blurb are handled in Task 3 — leave them for now, but the passive key must change here.)

- [ ] **Step 6: Add the migration entry in `undercity_db.py`**

In `_PASSIVE_RENAMES` (lines 353-358), add:

```python
    'rot_breath': 'onslaught',      # 2026-08-07: Rot Breath -> Onslaught (Swarm Lord)
```

- [ ] **Step 7: Add a migration test**

Create `tests/test_undercity_onslaught_migration.py`:

```python
import undercity_db as db


def test_rot_breath_migrates_to_onslaught():
    assert db._migrate_passives(['first_bite', 'rot_breath']) == ['first_bite', 'onslaught']


def test_onslaught_is_a_noop_once_migrated():
    assert db._migrate_passives(['onslaught']) == ['onslaught']
```

- [ ] **Step 8: Run the affected tests — expect PASS**

Run: `cd infrastructure/lambda && python -m pytest tests/test_undercity_engine.py::test_onslaught_first_win_doubles tests/test_undercity_onslaught_migration.py -q`
Expected: PASS (3 tests).

- [ ] **Step 9: Full suite green**

Run: `cd infrastructure/lambda && python -m pytest tests -q`
Expected: all pass (no lingering `rot_breath` reference — grep to confirm: `grep -rn "rot_breath\|FIRST_WIN_ROT_BREATH" infrastructure/lambda/*.py infrastructure/lambda/tests` returns nothing).

- [ ] **Step 10: Commit**

```bash
git add infrastructure/lambda/undercity_data.py infrastructure/lambda/undercity_engine.py infrastructure/lambda/undercity_db.py infrastructure/lambda/tests/test_undercity_engine.py infrastructure/lambda/tests/test_undercity_onslaught_migration.py
git commit -m "refactor(undercity): rename passive rot_breath -> onslaught (save-safe)"
```

---

## Task 3: Re-skin `swamp_dragon` apex → Swarm Lord (insect finale)

**Files:**
- Modify: `infrastructure/lambda/undercity_data.py:203-208`

- [ ] **Step 1: Rewrite the APEX entry**

Replace the `APEX['swamp_dragon']` block (lines 203-208, after Task 2 set its passive to `onslaught`) with:

```python
    'swamp_dragon': {
        'name': 'Swarm Lord', 'bonus': {'atk': 2, 'spd': 2},
        'passive': 'onslaught',
        'from': ['kraul_warrior', 'golgari_longlegs', 'slitherhead', 'woodwraith_strangler', 'corpsejack_menace', 'squirrel_warrior', 'gorgon'],
        'blurb': 'Onslaught: the swarm descends all at once — its round-1 strike hits for double.',
    },
```

Note: the id stays `swamp_dragon` for save-compat; `vexing_pest` is dropped from `from` (freed for the Grave-Reaver — see Task 4).

- [ ] **Step 2: Confirm the insect line still reaches it and pest no longer does**

Run: `cd infrastructure/lambda && python -c "import undercity_data as d; print('SL from kraul_warrior:', 'swamp_dragon' in d.apex_options('kraul_warrior')); print('SL from vexing_pest:', 'swamp_dragon' in d.apex_options('vexing_pest'))"`
Expected: `SL from kraul_warrior: True` / `SL from vexing_pest: False`.

- [ ] **Step 3: Full suite green (gorgon/wood_lurker tests still assert swamp_dragon reachable)**

Run: `cd infrastructure/lambda && python -m pytest tests -q`
Expected: all pass — `tests/test_undercity_gorgon.py` and `tests/test_undercity_wood_lurker.py` assert `'swamp_dragon' in apex_options('gorgon')`, which still holds (gorgon is retained in `from`).

- [ ] **Step 4: Commit**

```bash
git add infrastructure/lambda/undercity_data.py
git commit -m "feat(undercity): re-skin swamp_dragon apex as the Swarm Lord (insect finale)"
```

---

## Task 4: Add the Colossal Grave-Reaver apex + trim Calamity Beast

**Files:**
- Modify: `infrastructure/lambda/undercity_data.py` (`APEX` dict — trim `calamity_beast.from`, add `grave_reaver`)
- Test: `tests/test_undercity_grave_reaver.py` (new)

- [ ] **Step 1: Write the failing apex-options test**

Create `tests/test_undercity_grave_reaver.py`:

```python
import undercity_data as d


def test_grave_reaver_reachable_from_pest_line_and_deathrite():
    assert 'grave_reaver' in d.apex_options('brackish_trudge')
    assert 'grave_reaver' in d.apex_options('vexing_pest')
    assert 'grave_reaver' in d.apex_options('deathrite_shaman')


def test_grave_reaver_uses_dragon_stats_and_passive():
    gr = d.APEX['grave_reaver']
    assert gr['passive'] == 'treasure_sense'
    assert gr['name'] == 'Colossal Grave-Reaver'


def test_calamity_no_longer_from_deathrite():
    assert 'calamity_beast' not in d.apex_options('deathrite_shaman')


def test_every_tier2_form_has_two_or_three_apex_options():
    for fid in d.TIER2:
        assert 2 <= len(d.apex_options(fid)) <= 3, (fid, d.apex_options(fid))
```

- [ ] **Step 2: Run it — expect FAIL**

Run: `cd infrastructure/lambda && python -m pytest tests/test_undercity_grave_reaver.py -q`
Expected: FAIL — `grave_reaver` is not in `APEX`, so `d.APEX['grave_reaver']` raises `KeyError` and the option assertions fail.

- [ ] **Step 3: Trim `calamity_beast.from`**

In `APEX['calamity_beast']` (lines 223-228), remove `'deathrite_shaman'` from the `from` list so it reads:

```python
        'from': ['squirrel_warrior', 'squirrel_mage', 'vexing_pest', 'corpsejack_menace'],
```

- [ ] **Step 4: Add the `grave_reaver` apex**

Add a new entry inside the `APEX` dict (after `calamity_beast`):

```python
    'grave_reaver': {
        'name': 'Colossal Grave-Reaver', 'bonus': {'maxHp': 6, 'atk': 2, 'def': 2},
        'passive': 'treasure_sense',
        'from': ['brackish_trudge', 'vexing_pest', 'deathrite_shaman'],
        'blurb': 'Treasure Sense: a hoarder\'s eye — gear turns up far more often, and one rarity tier richer.',
    },
```

- [ ] **Step 5: Run the test — expect PASS**

Run: `cd infrastructure/lambda && python -m pytest tests/test_undercity_grave_reaver.py -q`
Expected: PASS (4 tests). The 2–3 option invariant holds: brackish_trudge=3, vexing_pest=3 (Izoni/Calamity/Grave-Reaver), deathrite_shaman=3 (Grave Titan/Lich Lord/Grave-Reaver).

- [ ] **Step 6: Full suite green**

Run: `cd infrastructure/lambda && python -m pytest tests -q`
Expected: all pass (including `tests/test_map.py`'s own 2–3 invariant).

- [ ] **Step 7: Commit**

```bash
git add infrastructure/lambda/undercity_data.py infrastructure/lambda/tests/test_undercity_grave_reaver.py
git commit -m "feat(undercity): add Colossal Grave-Reaver economy apex (pest signature)"
```

---

## Task 5: `treasure_sense` rarity bump in `_roll_gear_drop`

**Files:**
- Modify: `infrastructure/lambda/undercity_db.py:1540-1553`
- Test: `tests/test_undercity_treasure_sense.py` (new)

- [ ] **Step 1: Write the failing rarity-bump test**

Create `tests/test_undercity_treasure_sense.py`:

```python
import undercity_db as db
import undercity_data as data


class _FixedRng:
    """Deterministic: always the given slot, always tier-weight index 0."""
    def __init__(self, slot):
        self._slot = slot

    def choice(self, seq):
        return self._slot if self._slot in seq else seq[0]

    def choices(self, seq, weights=None, k=1):
        return [seq[0]]

    def random(self):
        return 0.0


def _doc(passives):
    return {'passives': list(passives), 'gear': {}, 'stash': [], 'spores': 0}


def test_treasure_sense_bumps_rolled_tier(monkeypatch):
    monkeypatch.setattr(db, '_rng', _FixedRng('fang'))
    # tier weights {1:1.0} -> index-0 tier is 1; treasure_sense bumps to 2.
    drop = db._roll_gear_drop(_doc({'treasure_sense'}), {1: 1.0})
    assert drop is not None
    assert data.WORLD_GEAR[drop['id']]['tier'] == 2


def test_no_passive_keeps_base_tier(monkeypatch):
    monkeypatch.setattr(db, '_rng', _FixedRng('fang'))
    drop = db._roll_gear_drop(_doc(set()), {1: 1.0})
    assert data.WORLD_GEAR[drop['id']]['tier'] == 1


def test_bump_caps_at_max_tier(monkeypatch):
    monkeypatch.setattr(db, '_rng', _FixedRng('fang'))
    # base tier 3 -> bump would be 4, but caps at TREASURE_SENSE_MAX_TIER (3).
    drop = db._roll_gear_drop(_doc({'treasure_sense'}), {3: 1.0})
    assert data.WORLD_GEAR[drop['id']]['tier'] == 3
```

- [ ] **Step 2: Run it — expect FAIL**

Run: `cd infrastructure/lambda && python -m pytest tests/test_undercity_treasure_sense.py -q`
Expected: FAIL on `test_treasure_sense_bumps_rolled_tier` — no bump yet, so the rolled tier is 1, not 2.

- [ ] **Step 3: Add the bump inside `_roll_gear_drop`**

In `undercity_db.py`, change `_roll_gear_drop` (lines 1540-1553) so the tier is bumped for the passive:

```python
def _roll_gear_drop(doc, tier_weights):
    """Roll a gear piece per the tier profile and route it via _gain_gear: found
    gear auto-equips into an empty slot, else stashes, else parks for the pickup
    modal so the find is never lost. The Grave-Reaver's Treasure Sense bumps the
    rolled tier one step (capped at TREASURE_SENSE_MAX_TIER — never tier-4 mythics).
    Returns {'id','slot','tier','outcome'} or None. outcome is 'equipped',
    'stashed', or 'pending' (parked when the stash is full)."""
    slot = _rng.choice(data.GEAR_SLOTS)
    tiers = list(tier_weights)
    tier = _rng.choices(tiers, weights=[tier_weights[t] for t in tiers])[0]
    if 'treasure_sense' in _passives(doc):
        tier = min(tier + data.TREASURE_SENSE_RARITY_BUMP, data.TREASURE_SENSE_MAX_TIER)
    pool = [gid for gid, g in data.WORLD_GEAR.items()
            if g['slot'] == slot and g['tier'] == tier]
    if not pool:
        return None
    return _gain_gear(doc, _rng.choice(pool))
```

- [ ] **Step 4: Run the test — expect PASS**

Run: `cd infrastructure/lambda && python -m pytest tests/test_undercity_treasure_sense.py -q`
Expected: PASS (3 tests). (All three gear slots carry tiers 1–4, so a bumped tier always has a pool.)

- [ ] **Step 5: Full suite green**

Run: `cd infrastructure/lambda && python -m pytest tests -q`
Expected: all pass.

- [ ] **Step 6: Commit**

```bash
git add infrastructure/lambda/undercity_db.py infrastructure/lambda/tests/test_undercity_treasure_sense.py
git commit -m "feat(undercity): Treasure Sense bumps rolled gear rarity"
```

---

## Task 6: `treasure_sense` drop-chance boost via `_gear_drop_fires`

Centralize the `_rng.random() < GEAR_DROP[source][0]` pattern behind one helper that applies the Treasure-Sense multiplier, then route every gated gear-drop site through it. (Guaranteed-drop sites — `_award_gear`, arena-kill, trove — are untouched; they already benefit from the Task-5 rarity bump.)

**Files:**
- Modify: `infrastructure/lambda/undercity_db.py` — add helper near `_roll_gear_drop`; update the 8 chance-gated call sites.
- Test: `tests/test_undercity_treasure_sense.py` (extend)

- [ ] **Step 1: Add the failing chance-boost test**

Append to `tests/test_undercity_treasure_sense.py`:

```python
class _ProbeRng:
    """Records the threshold each random() comparison is tested against."""
    def __init__(self, value):
        self._value = value
        self.seen = []

    def random(self):
        return self._value


def test_gear_drop_fires_boosts_chance_for_treasure_sense(monkeypatch):
    # 'loot' base chance is 0.10. Without the passive a 0.15 roll fails; with
    # Treasure Sense the effective chance is 0.10*2=0.20, so 0.15 now fires.
    monkeypatch.setattr(db, '_rng', _ProbeRng(0.15))
    assert db._gear_drop_fires(_doc(set()), 'loot') is False
    assert db._gear_drop_fires(_doc({'treasure_sense'}), 'loot') is True


def test_gear_drop_fires_respects_chance_cap(monkeypatch):
    # 'treasure' base 0.50 * 2 = 1.0, capped to 0.95 — a 0.97 roll still fails.
    monkeypatch.setattr(db, '_rng', _ProbeRng(0.97))
    assert db._gear_drop_fires(_doc({'treasure_sense'}), 'treasure') is False
```

- [ ] **Step 2: Run it — expect FAIL**

Run: `cd infrastructure/lambda && python -m pytest tests/test_undercity_treasure_sense.py -q`
Expected: FAIL — `db._gear_drop_fires` does not exist yet (`AttributeError`).

- [ ] **Step 3: Add the helper**

In `undercity_db.py`, immediately after `_roll_gear_drop` (after line 1553), add:

```python
def _gear_drop_fires(doc, source, chance_mult=1.0):
    """True if a gear drop should roll from GEAR_DROP[`source`]. Applies the
    Colossal Grave-Reaver's Treasure Sense chance boost (capped below a
    guaranteed drop). `chance_mult` thins the roll for already-plundered tiles."""
    chance = data.GEAR_DROP[source][0] * chance_mult
    if 'treasure_sense' in _passives(doc):
        chance = min(chance * data.TREASURE_SENSE_DROP_MULT, data.TREASURE_SENSE_CHANCE_CAP)
    return _rng.random() < chance
```

- [ ] **Step 4: Route the 8 chance-gated call sites**

Apply each edit (line numbers are pre-edit; use the surrounding code to locate them). In every case the `tiers` value must still be read for `_roll_gear_drop`.

**4a — loot puzzle (~line 3983):**
```python
    if _gear_drop_fires(doc, 'loot'):
        kinds.append('gear')
```

**4b — mystery (~lines 4390-4391):**
```python
        tiers = data.GEAR_DROP['mystery'][1]
        drop = _roll_gear_drop(doc, tiers) if _gear_drop_fires(doc, 'mystery') else None
```

**4c — wild/elite combat (~lines 5250-5252):**
```python
        source = 'elite' if elite else 'wild'
        tiers = data.GEAR_DROP[source][1]
        if _gear_drop_fires(doc, source):
            drop = _roll_gear_drop(doc, tiers)
            if drop:
                out['gear'] = drop
```

**4d — lair (~lines 5349-5351):**
```python
    tiers = data.GEAR_DROP['lair'][1]
    if _gear_drop_fires(doc, 'lair'):
        drop = _roll_gear_drop(doc, tiers)
        if drop:
            out['gear'] = drop
```

**4e — ruin lair (~lines 5409-5411):** identical shape to 4d:
```python
    tiers = data.GEAR_DROP['lair'][1]
    if _gear_drop_fires(doc, 'lair'):
        drop = _roll_gear_drop(doc, tiers)
        if drop:
            out['gear'] = drop
```

**4f — enraged (~lines 5552-5554):**
```python
    tiers = data.GEAR_DROP['enraged'][1]
    if _gear_drop_fires(doc, 'enraged'):
        drop = _roll_gear_drop(doc, tiers)
        if drop:
            out['gear'] = drop
```

**4g — boss (~lines 5754-5756):**
```python
    tiers = data.GEAR_DROP['boss'][1]
    if _gear_drop_fires(doc, 'boss'):
        drop = _roll_gear_drop(doc, tiers)
        if drop:
            out['gear'] = drop
```

**4h — treasure space (~lines 5950-5952, keep the `chance_mult` arg):**
```python
    tiers = data.GEAR_DROP['treasure'][1]
    if _gear_drop_fires(doc, 'treasure', chance_mult):
        drop = _roll_gear_drop(doc, tiers)
        if drop:
            out['gear'] = drop
            out['text'] += (' A piece of gear gleams among the hoard — '
```
(Only the two lines shown change; leave the rest of the `out['text'] +=` continuation intact.)

- [ ] **Step 5: Confirm no stray `_rng.random() < ... GEAR_DROP` remains**

Run: `grep -n "GEAR_DROP\[" infrastructure/lambda/undercity_db.py`
Expected: every remaining `GEAR_DROP[...]` reference is either `[1]` (tiers) inside a helper call, the `_gear_drop_fires` body, or `_award_gear`'s guaranteed `['loot'][1]` — no bare `_rng.random() < ...GEAR_DROP...[0]` comparisons outside `_gear_drop_fires`.

- [ ] **Step 6: Run the treasure-sense tests — expect PASS**

Run: `cd infrastructure/lambda && python -m pytest tests/test_undercity_treasure_sense.py -q`
Expected: PASS (5 tests).

- [ ] **Step 7: Full suite green**

Run: `cd infrastructure/lambda && python -m pytest tests -q`
Expected: all pass — existing gear-drop tests (`test_first_conqueror.py`, `test_deep_dungeons.py`) that stub `_rng.random` to 0.99 still suppress drops, because a non-Treasure-Sense doc keeps the base chance.

- [ ] **Step 8: Commit**

```bash
git add infrastructure/lambda/undercity_db.py infrastructure/lambda/tests/test_undercity_treasure_sense.py
git commit -m "feat(undercity): Treasure Sense boosts gear-drop frequency"
```

---

## Task 7: Client mirror — `forms.ts`

**Files:**
- Modify: `src/app/undercity/data/forms.ts`

- [ ] **Step 1: Update PASSIVE_NAMES**

In the `PASSIVE_NAMES` map, replace `rot_breath: 'Rot Breath',` with:

```typescript
  onslaught: 'Onslaught',
  treasure_sense: 'Treasure Sense',
```

- [ ] **Step 2: Update PASSIVE_BLURBS**

In `PASSIVE_BLURBS`, replace `rot_breath: 'Round-1 strike hits for double.',` with:

```typescript
  onslaught: 'Round-1 strike hits for double.',
  treasure_sense: 'Gear turns up far more often, and one rarity tier richer.',
```

- [ ] **Step 3: Rewrite the APEX display entries**

In the `APEX` array, replace the `swamp_dragon` object with the re-skinned Swarm Lord and add the Grave-Reaver; also drop `deathrite_shaman` from `calamity_beast`'s `from`:

```typescript
  { id: 'swamp_dragon', name: 'Swarm Lord', tier: 3, passive: 'onslaught', passiveName: 'Onslaught', bonus: { atk: 2, spd: 2 }, blurb: 'The swarm descends all at once — its round-1 strike hits for double.', from: ['kraul_warrior', 'golgari_longlegs', 'slitherhead', 'woodwraith_strangler', 'corpsejack_menace', 'squirrel_warrior', 'gorgon'] },
```
```typescript
  { id: 'grave_reaver', name: 'Colossal Grave-Reaver', tier: 3, passive: 'treasure_sense', passiveName: 'Treasure Sense', bonus: { maxHp: 6, atk: 2, def: 2 }, blurb: 'A hoarder\'s eye — gear turns up far more often, and one rarity tier richer.', from: ['brackish_trudge', 'vexing_pest', 'deathrite_shaman'] },
```

For `calamity_beast`, change its `from` to `['squirrel_warrior', 'squirrel_mage', 'vexing_pest', 'corpsejack_menace']` (remove `'deathrite_shaman'`).

- [ ] **Step 4: Sanity-check TypeScript compiles (checked by the build in Task 11)**

No isolated test runner — leave verification to the Task 11 build. Visually confirm no `rot_breath` remains: `grep -n "rot_breath" src/app/undercity/data/forms.ts` returns nothing.

- [ ] **Step 5: Commit**

```bash
git add src/app/undercity/data/forms.ts
git commit -m "feat(undercity): mirror Swarm Lord + Grave-Reaver in forms.ts"
```

---

## Task 8: Client mirror — `species.ts` sprite routing

**Files:**
- Modify: `src/app/undercity/data/species.ts:51`

- [ ] **Step 1: Point swamp_dragon at the swarm_lord art and add grave_reaver**

In `FORM_SPRITES`, replace line 51:

```typescript
  swamp_dragon: { sprite: 'swamp_dragon', regions: MASK_REGIONS, scale: 1.3 },
```
with:
```typescript
  swamp_dragon: { sprite: 'swarm_lord', regions: MASK_REGIONS, scale: 1.3 },
  grave_reaver: { sprite: 'swamp_dragon', regions: MASK_REGIONS, scale: 1.3 },
```

(The `swamp_dragon` *id* now displays as the Swarm Lord using `swarm_lord.png`; the new `grave_reaver` form inherits the original dragon art `swamp_dragon.png`.)

- [ ] **Step 2: Commit**

```bash
git add src/app/undercity/data/species.ts
git commit -m "feat(undercity): route Swarm Lord + Grave-Reaver sprites"
```

---

## Task 9: Client mirror — `combat.ts` stance augment

**Files:**
- Modify: `src/app/undercity/data/combat.ts:92`

- [ ] **Step 1: Rename the PASSIVE_AUGMENTS key**

Replace line 92:

```typescript
  rot_breath: { stance: 'aggress', label: 'Rot Breath', blurb: 'Your round-1 strike hits for double.' },
```
with:
```typescript
  onslaught: { stance: 'aggress', label: 'Onslaught', blurb: 'Your round-1 strike hits for double.' },
```

(`treasure_sense` is not a stance-boosting passive, so it gets no augment entry — consistent with the file's stated rule.)

- [ ] **Step 2: Commit**

```bash
git add src/app/undercity/data/combat.ts
git commit -m "feat(undercity): rename combat stance augment rot_breath -> onslaught"
```

---

## Task 10: Register the `swarm_lord` sprite in the player-sprite manifest

**Files:**
- Modify: `public/data/undercity-player-sprites.json`

- [ ] **Step 1: Inspect the manifest shape around the swamp_dragon entry**

Read `public/data/undercity-player-sprites.json` near line 124 (the `"name": "swamp_dragon"` entry) to see the exact object shape (fields such as `name`, hat/mask flags, dimensions).

- [ ] **Step 2: Add a `swarm_lord` entry mirroring the swamp_dragon one**

Duplicate the `swamp_dragon` manifest object and change its `name` to `swarm_lord` (keep `swamp_dragon` — it is still used by the Grave-Reaver). If the manifest is generated by a script, prefer regenerating it; otherwise hand-add the entry with the same field set. The `swarm_lord.png`, `swarm_lord.hat.png`, and `swarm_lord.mask.png` files already exist under `public/undercity/player_sprites/`.

- [ ] **Step 3: Validate JSON**

Run: `python -c "import json; json.load(open('public/data/undercity-player-sprites.json')); print('ok')"`
Expected: `ok`.

- [ ] **Step 4: Commit**

```bash
git add public/data/undercity-player-sprites.json
git commit -m "chore(undercity): register swarm_lord player sprite"
```

---

## Task 11: Update the evolution reference page + final verification

**Files:**
- Modify: `UNDERCITY_EVOLUTION.html`

- [ ] **Step 1: Relabel the swamp_dragon card**

In `UNDERCITY_EVOLUTION.html` (the `data-id="swamp_dragon"` card near line 496), update its display name to **Swarm Lord** and its passive text to Onslaught. Add a new card for **Colossal Grave-Reaver** (`data-id="grave_reaver"`, Treasure Sense).

- [ ] **Step 2: Fix the evolution edges**

In the edges array (around lines 569-591): remove `['vexing_pest', 'swamp_dragon', 'pest']`; add `['brackish_trudge', 'grave_reaver', 'pest']`, `['vexing_pest', 'grave_reaver', 'pest']`, `['deathrite_shaman', 'grave_reaver', 'zombie']`. Leave the remaining `swamp_dragon` edges (kraul/saproling/squirrel/elf sources) intact.

- [ ] **Step 3: Commit**

```bash
git add UNDERCITY_EVOLUTION.html
git commit -m "docs(undercity): update evolution page for Swarm Lord + Grave-Reaver"
```

- [ ] **Step 4: Full backend suite green**

Run: `cd infrastructure/lambda && python -m pytest tests -q`
Expected: all pass.

- [ ] **Step 5: Production build green (lint is known-broken in this repo — build is the gate)**

Run (from repo root, via Bash): `npm run build`
Expected: build completes without TypeScript errors.

- [ ] **Step 6: Manual spot-check (optional, via run-undercity skill)**

Drive an insect creature to level 10 → the evolution screen offers **Swarm Lord** (swarm_lord art, Onslaught). Drive a pest creature to level 10 → offers **Colossal Grave-Reaver** (dragon art, Treasure Sense). Confirm a Grave-Reaver's gear finds are noticeably frequent and high-tier.

---

## Self-review notes

- **Spec coverage:** Swarm Lord re-skin (Tasks 2–3, 7–10), Grave-Reaver + treasure_sense (Tasks 1, 4–8), option-cap reconciliation (Tasks 3–4), save-safety (Task 2 migration), touch-point list (Tasks 7–11) — all covered.
- **Balance levers** (`grave_reaver.bonus`, `TREASURE_SENSE_*`) are intentionally simple constants surfaced in `undercity_config.py` / the APEX table for later tuning via the tune-undercity-balance skill.
- **Deploy:** the user runs deploys. This plan ends with tests + build green; a Lambda (`cdk deploy`) + `npm run deploy` is required to ship, done by the user.
