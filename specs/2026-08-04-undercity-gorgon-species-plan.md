# Gorgon Species ("The Stonewright") Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add the Gorgon — an economy/returning-player starter species that begins with +5 banked stat points, levels at 1 point/level instead of 2, and whose Blacksmith upgrades mint tradeable "Gear+" masterworks that fill her late-game stat gap.

**Architecture:** Two phases. **Phase 1** makes the Gorgon a fully-playable starter (base stats, `stonewright` passive, +5 start, slow leveling, a stone-themed tier-2/3 evolution line reusing existing passives + apex forms, a light pet bonus, client mirrors). She is deliberately under-tuned until Phase 2. **Phase 2** adds Gear+: "+" gear variants are generated from base entries so the existing bare-id gear pipeline (equip/stash/market/salvage/client) carries them for free; the Blacksmith mints "+" when the upgrader is a Gorgon (detected via `'stonewright' in passives`, which survives evolution). Do not expose the Gorgon in the starter picker until Phase 2 lands.

**Tech Stack:** Python 3.11 Lambda (`infrastructure/lambda/`), pytest integration suite (in-memory `FakeTable`), Angular 20 standalone components with TS data mirrors under `src/app/undercity/data/`.

Reference spec: [specs/2026-08-04-undercity-gorgon-species-design.md](2026-08-04-undercity-gorgon-species-design.md).

---

## Key facts (verified against the codebase)

- **"Is this player a Gorgon?"** → `'stonewright' in _passives(doc)` (backend) / `passives.includes('stonewright')`. Passives persist and accumulate through evolution (same pattern as `scrounger`), so this is robust across tier-2/3 forms. Never key on the mutable `species`/`form` id.
- **Single new-player builder:** `_new_player_doc` in [undercity_db.py:2751](../infrastructure/lambda/undercity_db.py#L2751) (used by both `_join` and admin bot-add).
- **Leveling:** `apply_level_ups` in [undercity_engine.py](../infrastructure/lambda/undercity_engine.py) adds `data.STAT_POINTS_PER_LEVEL` (=2) per level.
- **Blacksmith:** `_upgrade_gear` in [undercity_db.py:1365](../infrastructure/lambda/undercity_db.py#L1365). Gear is stored as **bare string ids** (`doc['gear'][slot]`, `doc['gearStash'][i]`) everywhere. Upgrade path: `next_gid = data.GEAR_FAMILY[rider][tier+1]`.
- **`GEAR_FAMILY`** is built from base `GEAR` entries in [undercity_data.py:336-340](../infrastructure/lambda/undercity_data.py#L336). Any "+" generation must run **after** this block so "+" ids never enter the upgrade family.
- **Pet combat:** `engine.pet_combat(pet)` — single call site at [undercity_db.py:598](../infrastructure/lambda/undercity_db.py#L598); the only other callers are engine unit tests (which call it positionally, so an optional 2nd arg is safe).
- **Config:** `undercity_data.py` does `from undercity_config import *`, so Gorgon scalars go in `undercity_config.py` and are referenced as `data.GORGON_*`.
- **Test helpers:** `from tests.test_undercity_db import table, act, _sid, _player_at`. `act(table, 'join', starter='pest')` joins as user `user-alex`; `_player_at(table, node, **fields)` joins-as-pest, sets position + fields, returns `(sid, doc)`.

---

## File Structure

**Modified (backend):**
- `infrastructure/lambda/undercity_config.py` — new Gorgon scalar block.
- `infrastructure/lambda/undercity_data.py` — `STARTERS['gorgon']`; two `TIER2` gorgon forms; append gorgon tier-2 ids to four `APEX` `from` lists; Gear+ variant generation + `plus_id`/`PLUS_SUFFIX` helpers (Phase 2).
- `infrastructure/lambda/undercity_engine.py` — species-aware rate in `apply_level_ups`; `level_bonus` param on `pet_combat`.
- `infrastructure/lambda/undercity_db.py` — +5 start in `_new_player_doc`; owner-aware `pet_combat` call; Gear+ mint in `_upgrade_gear` (Phase 2); refresh the `_join` starter-list error string.

**Modified (client mirrors):**
- `src/app/undercity/data/forms.ts` — `STARTERS`, `TIER2`, `APEX` from-lists, `PASSIVE_NAMES.stonewright`, `PASSIVE_BLURBS.stonewright`.
- `src/app/undercity/data/species.ts` — `FORM_SPRITES` for `gorgon`/`basalt_matron`/`medusa_stalker`.
- `src/app/undercity/data/items.ts` — Gear+ resolver `gearById()` (Phase 2).

**Created:**
- `infrastructure/lambda/tests/test_undercity_gorgon.py` — Gorgon integration + data tests.
- `public/undercity/sprites/gorgon.png` — placeholder sprite (copied from an existing sprite; real art is a later swap).

---

## PHASE 1 — Playable species scaffold

### Task 1: Gorgon config scalars + starter definition

**Files:**
- Modify: `infrastructure/lambda/undercity_config.py`
- Modify: `infrastructure/lambda/undercity_data.py` (`STARTERS`)
- Create: `infrastructure/lambda/tests/test_undercity_gorgon.py`

- [ ] **Step 1: Write the failing test**

Create `infrastructure/lambda/tests/test_undercity_gorgon.py`:

```python
"""Gorgon ("Stonewright") species: start bonus, slow leveling, Gear+ minting."""
import undercity_data as data
import undercity_db as db

from tests.test_undercity_db import (  # noqa: F401
    table, act, _sid, _player_at)


def test_gorgon_scalars_defined():
    assert data.GORGON_START_POINTS == 5
    assert data.GORGON_STAT_POINTS_PER_LEVEL == 1
    assert data.GORGON_PET_LEVEL_BONUS == 1


def test_gorgon_starter_defined():
    g = data.STARTERS['gorgon']
    assert g['passive'] == 'stonewright'
    assert (g['hp'], g['atk'], g['def'], g['spd']) == (25, 6, 6, 4)
```

- [ ] **Step 2: Run test to verify it fails**

Run: `cd infrastructure/lambda && python -m pytest tests/test_undercity_gorgon.py -q`
Expected: FAIL — `AttributeError: module 'undercity_data' has no attribute 'GORGON_START_POINTS'`.

- [ ] **Step 3: Add the config scalars**

Append to `infrastructure/lambda/undercity_config.py`:

```python
# ── Gorgon ("Stonewright") species ───────────────────────────────────────────
GORGON_START_POINTS = 5           # banked stat points a Gorgon spawns with
GORGON_STAT_POINTS_PER_LEVEL = 1  # she banks 1/level instead of the usual 2
GORGON_PET_LEVEL_BONUS = 1        # her active pet fights as if this many levels higher
GEAR_PLUS_BUMP = 1                # Gear+ adds this to a piece's primary stat…
GEAR_PLUS_MYTHIC_BUMP = 2         # …or this at Mythic (tier 4)
```

- [ ] **Step 4: Add the starter definition**

In `infrastructure/lambda/undercity_data.py`, add to the `STARTERS` dict (after the `squirrel` entry, before the closing `}`):

```python
    'gorgon': {
        'name': 'Gorgon', 'hp': 25, 'atk': 6, 'def': 6, 'spd': 4,
        'passive': 'stonewright',
        'blurb': 'Ancient and stone-scaled — born strong, slow to change; her power is in '
                 'her works. Stonewright: gear she upgrades comes out hardened (Gear+), and '
                 'her pet fights a step above its level.',
    },
```

- [ ] **Step 5: Run test to verify it passes**

Run: `cd infrastructure/lambda && python -m pytest tests/test_undercity_gorgon.py -q`
Expected: PASS (2 tests).

- [ ] **Step 6: Commit**

```bash
git add infrastructure/lambda/undercity_config.py infrastructure/lambda/undercity_data.py infrastructure/lambda/tests/test_undercity_gorgon.py
git commit -m "feat(undercity): Gorgon starter definition + config scalars"
```

---

### Task 2: Gorgon evolution line (tier-2 forms + apex hookups)

Reuses existing, already-implemented passives (`spikeshell`, `vexing`) and existing apex forms — no new combat logic or apex art.

**Files:**
- Modify: `infrastructure/lambda/undercity_data.py` (`TIER2`, `APEX`)
- Modify: `infrastructure/lambda/tests/test_undercity_gorgon.py`

- [ ] **Step 1: Write the failing test**

Add to `test_undercity_gorgon.py`:

```python
def test_gorgon_evolution_line():
    assert set(data.tier2_options('gorgon')) == {'basalt_matron', 'medusa_stalker'}
    # Each gorgon tier-2 form has two apex options grafted onto existing apexes.
    assert 'grave_titan' in data.apex_options('basalt_matron')
    assert 'golgari_lich_lord' in data.apex_options('basalt_matron')
    assert 'swamp_dragon' in data.apex_options('medusa_stalker')
    assert 'izoni' in data.apex_options('medusa_stalker')
```

- [ ] **Step 2: Run test to verify it fails**

Run: `cd infrastructure/lambda && python -m pytest tests/test_undercity_gorgon.py::test_gorgon_evolution_line -q`
Expected: FAIL — `tier2_options('gorgon')` returns `[]`.

- [ ] **Step 3: Add the tier-2 forms**

In `undercity_data.py`, add to the `TIER2` dict (before its closing `}`):

```python
    'basalt_matron': {
        'name': 'Basalt Matron', 'line': 'gorgon', 'bonus': {'maxHp': 6, 'def': 2},
        'passive': 'spikeshell',
        'blurb': 'Stone bulwark. Spiked Shell: retaliate for 2 whenever a foe’s blow lands.',
    },
    'medusa_stalker': {
        'name': 'Medusa Stalker', 'line': 'gorgon', 'bonus': {'spd': 2, 'atk': 2},
        'passive': 'vexing',
        'blurb': 'Gaze-hunter. Vexing: 25% chance enemy strikes miss.',
    },
```

- [ ] **Step 4: Graft onto existing apex `from` lists**

In `undercity_data.py`'s `APEX` dict, append the gorgon tier-2 ids to these four `from` lists:
- `grave_titan['from']` — add `'basalt_matron'`
- `golgari_lich_lord['from']` — add `'basalt_matron'`
- `swamp_dragon['from']` — add `'medusa_stalker'`
- `izoni['from']` — add `'medusa_stalker'`

Example (grave_titan):

```python
        'from': ['brackish_trudge', 'shambling_shell', 'deathrite_shaman', 'underrealm_lich', 'basalt_matron'],
```

- [ ] **Step 5: Run test to verify it passes**

Run: `cd infrastructure/lambda && python -m pytest tests/test_undercity_gorgon.py::test_gorgon_evolution_line -q`
Expected: PASS.

- [ ] **Step 6: Commit**

```bash
git add infrastructure/lambda/undercity_data.py infrastructure/lambda/tests/test_undercity_gorgon.py
git commit -m "feat(undercity): Gorgon tier-2 forms + apex evolution hookups"
```

---

### Task 3: Slow leveling (1 point/level for Gorgons)

**Files:**
- Modify: `infrastructure/lambda/undercity_engine.py` (`apply_level_ups`)
- Modify: `infrastructure/lambda/tests/test_undercity_engine.py`

- [ ] **Step 1: Write the failing test**

Add to `infrastructure/lambda/tests/test_undercity_engine.py` (near `test_level_up_grants`):

```python
def test_gorgon_levels_slower():
    p = {'level': 1, 'xp': 25, 'maxHp': 30, 'hp': 10, 'statPoints': 0,
         'passives': ['stonewright'], 'spentThisLevel': {}}
    assert apply_level_ups(p) == 1
    assert p['statPoints'] == 1          # Gorgon banks 1, not the usual 2
    assert p['maxHp'] == 33              # HP-per-level unchanged
```

- [ ] **Step 2: Run test to verify it fails**

Run: `cd infrastructure/lambda && python -m pytest tests/test_undercity_engine.py::test_gorgon_levels_slower -q`
Expected: FAIL — `assert p['statPoints'] == 1` fails (got 2).

- [ ] **Step 3: Make leveling species-aware**

In `undercity_engine.py`, inside `apply_level_ups`, replace:

```python
        player['statPoints'] = player.get('statPoints', 0) + data.STAT_POINTS_PER_LEVEL
```

with:

```python
        rate = (data.GORGON_STAT_POINTS_PER_LEVEL
                if 'stonewright' in (player.get('passives') or [])
                else data.STAT_POINTS_PER_LEVEL)
        player['statPoints'] = player.get('statPoints', 0) + rate
```

- [ ] **Step 4: Run tests to verify pass (new + existing leveling tests)**

Run: `cd infrastructure/lambda && python -m pytest tests/test_undercity_engine.py -q -k "level"`
Expected: PASS — `test_gorgon_levels_slower`, `test_level_up_grants` (still 2 for non-gorgons), `test_level_cap` all green.

- [ ] **Step 5: Commit**

```bash
git add infrastructure/lambda/undercity_engine.py infrastructure/lambda/tests/test_undercity_engine.py
git commit -m "feat(undercity): Gorgons bank 1 stat point per level"
```

---

### Task 4: +5 banked start points at creation

**Files:**
- Modify: `infrastructure/lambda/undercity_db.py` (`_new_player_doc`, `_join` error string)
- Modify: `infrastructure/lambda/tests/test_undercity_gorgon.py`

- [ ] **Step 1: Write the failing test**

Add to `test_undercity_gorgon.py`:

```python
def test_gorgon_starts_with_five_banked_points(table):
    act(table, 'join', starter='gorgon')
    sid = _sid(table)
    doc = db._get_player(table, sid, 'user-alex')
    assert doc['species'] == 'gorgon'
    assert 'stonewright' in doc['passives']
    assert doc['statPoints'] == 5


def test_non_gorgon_starts_with_zero_points(table):
    act(table, 'join', starter='pest')
    sid = _sid(table)
    doc = db._get_player(table, sid, 'user-alex')
    assert doc['statPoints'] == 0
```

- [ ] **Step 2: Run test to verify it fails**

Run: `cd infrastructure/lambda && python -m pytest tests/test_undercity_gorgon.py -q -k "banked or zero"`
Expected: FAIL — Gorgon `statPoints` is 0 (not yet 5).

- [ ] **Step 3: Grant the start points in the shared builder**

In `undercity_db.py`, in `_new_player_doc`, immediately after the `doc = { ... }` literal is fully constructed (before the `# ── Home-biome hatch perks ──` block), add:

```python
    # Gorgon (Stonewright): born strong — spawn with banked points to spend now.
    if 'stonewright' in doc.get('passives', []):
        doc['statPoints'] = data.GORGON_START_POINTS
```

- [ ] **Step 4: Refresh the stale starter-list error string**

In `undercity_db.py`, in `_join`, update the rejection message to include all current starters:

```python
    if starter not in data.STARTERS:
        return _err('Pick a starter: pest, kraul, saproling, zombie, squirrel, or gorgon.')
```

- [ ] **Step 5: Run test to verify it passes**

Run: `cd infrastructure/lambda && python -m pytest tests/test_undercity_gorgon.py -q -k "banked or zero"`
Expected: PASS.

- [ ] **Step 6: Commit**

```bash
git add infrastructure/lambda/undercity_db.py infrastructure/lambda/tests/test_undercity_gorgon.py
git commit -m "feat(undercity): Gorgons spawn with 5 banked stat points"
```

---

### Task 5: Light pet bonus (active pet fights as +1 level)

**Files:**
- Modify: `infrastructure/lambda/undercity_engine.py` (`pet_combat`)
- Modify: `infrastructure/lambda/undercity_db.py:598` (call site)
- Modify: `infrastructure/lambda/tests/test_undercity_engine.py`

- [ ] **Step 1: Write the failing test**

First confirm an attack-role pet species to use:

Run: `cd infrastructure/lambda && python -c "import undercity_data as d; print(d.pet_role('decimator_beetle'))"`
Expected: prints `attack`. (If not `attack`, pick any species where `pet_role(...) == 'attack'` and use it below.)

Add to `test_undercity_engine.py`:

```python
def test_pet_combat_level_bonus_raises_contribution():
    pet = {'species': 'decimator_beetle', 'tier': 1, 'level': 2}
    base = pet_combat(pet)
    boosted = pet_combat(pet, level_bonus=1)
    assert boosted['followup_chance'] > base['followup_chance']
```

- [ ] **Step 2: Run test to verify it fails**

Run: `cd infrastructure/lambda && python -m pytest tests/test_undercity_engine.py::test_pet_combat_level_bonus_raises_contribution -q`
Expected: FAIL — `pet_combat() got an unexpected keyword argument 'level_bonus'`.

- [ ] **Step 3: Add the `level_bonus` parameter**

In `undercity_engine.py`, change the signature and the level read in `pet_combat`:

```python
def pet_combat(pet: dict, level_bonus: int = 0) -> dict:
```

and:

```python
    lvl = int(pet.get('level', 1)) + level_bonus
```

- [ ] **Step 4: Wire the owner-aware call**

In `undercity_db.py:598`, replace:

```python
    pc = engine.pet_combat(_find_pet(doc, doc.get('activePetId')))
```

with:

```python
    pc = engine.pet_combat(
        _find_pet(doc, doc.get('activePetId')),
        level_bonus=data.GORGON_PET_LEVEL_BONUS if 'stonewright' in _passives(doc) else 0)
```

- [ ] **Step 5: Run tests to verify pass**

Run: `cd infrastructure/lambda && python -m pytest tests/test_undercity_engine.py -q -k "pet_combat"`
Expected: PASS (new test + the existing `pet_combat` tests, which call it positionally and are unaffected).

- [ ] **Step 6: Commit**

```bash
git add infrastructure/lambda/undercity_engine.py infrastructure/lambda/undercity_db.py infrastructure/lambda/tests/test_undercity_engine.py
git commit -m "feat(undercity): Gorgon's active pet fights as +1 level"
```

---

### Task 6: Client mirror — forms.ts (starter, passive, evolution)

**Files:**
- Modify: `src/app/undercity/data/forms.ts`

- [ ] **Step 1: Add the passive display strings**

In `forms.ts`, add to `PASSIVE_NAMES`:

```typescript
  stonewright: 'Stonewright',
```

and to `PASSIVE_BLURBS`:

```typescript
  stonewright: 'Upgrades she forges come out hardened (Gear+); her active pet fights a step above its level.',
```

- [ ] **Step 2: Add the starter to the picker list**

In `forms.ts`, add to the `STARTERS` array (after `squirrel`):

```typescript
  {
    id: 'gorgon', name: 'Gorgon', tier: 1, passive: 'stonewright', passiveName: 'Stonewright',
    blurb: 'Ancient and stone-scaled — born strong, slow to grow; her power is in her works.',
    stats: { hp: 25, atk: 6, def: 6, spd: 4 },
  },
```

- [ ] **Step 3: Add the tier-2 forms + apex from-lists**

In `forms.ts`, add to the `TIER2` array:

```typescript
  { id: 'basalt_matron', name: 'Basalt Matron', tier: 2, line: 'gorgon', passive: 'spikeshell', passiveName: 'Spiked Shell', bonus: { maxHp: 6, def: 2 }, blurb: 'Stone bulwark (+HP/+DEF).' },
  { id: 'medusa_stalker', name: 'Medusa Stalker', tier: 2, line: 'gorgon', passive: 'vexing', passiveName: 'Vexing', bonus: { spd: 2, atk: 2 }, blurb: 'Gaze-hunter (+SPD/+ATK).' },
```

Then append the gorgon tier-2 ids to the matching `APEX` `from` arrays (mirror the backend):
- `grave_titan.from` — add `'basalt_matron'`
- `golgari_lich_lord.from` — add `'basalt_matron'`
- `swamp_dragon.from` — add `'medusa_stalker'`
- `izoni.from` — add `'medusa_stalker'`

- [ ] **Step 4: Verify the build type-checks**

Run: `npm run build`
Expected: build succeeds (lint is broken repo-wide; the build is the type-check gate).

- [ ] **Step 5: Commit**

```bash
git add src/app/undercity/data/forms.ts
git commit -m "feat(undercity): client mirror for Gorgon starter + evolution"
```

---

### Task 7: Client sprite mapping + placeholder art

**Files:**
- Modify: `src/app/undercity/data/species.ts` (`FORM_SPRITES`)
- Create: `public/undercity/sprites/gorgon.png`

- [ ] **Step 1: Add a placeholder sprite asset**

Copy an existing sprite as a stand-in (real Gorgon art is a later swap, per the design's non-goals):

```bash
cp public/undercity/sprites/zombie.png public/undercity/sprites/gorgon.png
```

- [ ] **Step 2: Map the forms to sprites**

In `src/app/undercity/data/species.ts`, add to `FORM_SPRITES` (all three point at the `gorgon` placeholder for now):

```typescript
  gorgon: { sprite: 'gorgon', regions: MASK_REGIONS, scale: 0.7 },
  basalt_matron: { sprite: 'gorgon', regions: MASK_REGIONS, scale: 0.9 },
  medusa_stalker: { sprite: 'gorgon', regions: MASK_REGIONS, scale: 0.9 },
```

- [ ] **Step 3: Verify the build + sprite manifest**

Run: `npm run build`
Expected: build succeeds. (`ALL_SPRITES` derives from `FORM_SPRITES` values, so `gorgon` is picked up automatically.)

- [ ] **Step 4: Commit**

```bash
git add src/app/undercity/data/species.ts public/undercity/sprites/gorgon.png
git commit -m "feat(undercity): Gorgon placeholder sprite + form mapping"
```

---

### Task 8: Phase 1 gate — full backend suite green

**Files:** none (verification only)

- [ ] **Step 1: Run the whole backend suite**

Run: `cd infrastructure/lambda && python -m pytest tests -q`
Expected: PASS (entire suite green — no regressions from the new species).

- [ ] **Step 2: Run the frontend build**

Run: `npm run build`
Expected: build succeeds.

> **Phase 1 exit state:** the Gorgon is playable end-to-end (selectable, correct stats/start/leveling/evolution/pet bonus, renders with placeholder art) but is a −6 race with nothing filling the gap. Keep her hidden from the live starter picker (or unreleased) until Phase 2. If you must gate her out of the UI, do it in the starter-picker component, not by removing the `forms.ts` entry (the backend needs it).

---

## PHASE 2 — Gear+ (the Stonewright payoff)

### Task 9: Generate Gear+ variants

**Files:**
- Modify: `infrastructure/lambda/undercity_data.py` (after the `GEAR_FAMILY` block)
- Modify: `infrastructure/lambda/tests/test_undercity_gorgon.py`

- [ ] **Step 1: Write the failing test**

Add to `test_undercity_gorgon.py`:

```python
def test_gear_plus_variants_generated():
    base = 'bramble_hide'                 # tier-1 rider gear (primary stat: def)
    pid = base + '+'
    assert pid in data.GEAR
    assert data.GEAR[pid]['plus'] is True
    assert data.GEAR[pid]['name'] == data.GEAR[base]['name'] + ' +'
    assert data.GEAR[pid]['def'] == data.GEAR[base]['def'] + data.GEAR_PLUS_BUMP
    assert data.GEAR[pid]['tier'] == data.GEAR[base]['tier']
    assert data.GEAR[pid]['rider'] == data.GEAR[base]['rider']


def test_gear_plus_mythic_bump_is_larger():
    mythic = data.GEAR_FAMILY['bramble'][4]
    assert data.GEAR[mythic + '+']['def'] == data.GEAR[mythic]['def'] + data.GEAR_PLUS_MYTHIC_BUMP


def test_gear_family_never_contains_plus_ids():
    # "+" is a within-tier bonus, not an upgrade rung — it must not leak into the path.
    for rider, tiers in data.GEAR_FAMILY.items():
        for tier, gid in tiers.items():
            assert not gid.endswith('+')
```

- [ ] **Step 2: Run test to verify it fails**

Run: `cd infrastructure/lambda && python -m pytest tests/test_undercity_gorgon.py -q -k "plus or family"`
Expected: FAIL — `'bramble_hide+' in data.GEAR` is False.

- [ ] **Step 3: Generate the "+" entries**

In `undercity_data.py`, immediately **after** the `GEAR_FAMILY` construction block (the `for _gid, _g in GEAR.items(): ...` at lines ~336-340), add:

```python
# ── Gear+ (Gorgon Stonewright mint) ──────────────────────────────────────────
# A Gorgon's Blacksmith upgrade mints a "+" variant of the piece: same slot,
# tier, and rider, with its primary stat bumped. Generated here from the base
# rider gear so the entire bare-id gear pipeline (equip, stash, market, salvage,
# client lookup) carries "+" ids for free. Runs AFTER GEAR_FAMILY so "+" ids are
# never treated as an upgrade rung.
PLUS_SUFFIX = '+'


def _gear_primary_stat(g):
    """Stat a Gear+ bump lands on: the largest of atk/def/spd (ties resolve in
    that order). maxHp is never the primary."""
    best, best_val = 'atk', -1
    for stat in ('atk', 'def', 'spd'):
        v = g.get(stat, 0)
        if v > best_val:
            best, best_val = stat, v
    return best


def plus_id(gid):
    """The Gear+ id for a base gid; idempotent (never doubles the suffix)."""
    return gid if gid.endswith(PLUS_SUFFIX) else gid + PLUS_SUFFIX


for _gid, _g in list(GEAR.items()):
    if _g.get('rider') in GEAR_FAMILY:          # upgradeable pieces only
        _p = dict(_g)
        _prime = _gear_primary_stat(_g)
        _bump = GEAR_PLUS_MYTHIC_BUMP if _g['tier'] >= 4 else GEAR_PLUS_BUMP
        _p[_prime] = _g.get(_prime, 0) + _bump
        _p['name'] = _g['name'] + ' +'
        _p['plus'] = True
        GEAR[plus_id(_gid)] = _p
```

- [ ] **Step 4: Run test to verify it passes**

Run: `cd infrastructure/lambda && python -m pytest tests/test_undercity_gorgon.py -q -k "plus or family"`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add infrastructure/lambda/undercity_data.py infrastructure/lambda/tests/test_undercity_gorgon.py
git commit -m "feat(undercity): generate Gear+ variants from base gear"
```

---

### Task 10: Blacksmith mints Gear+ for Gorgons (and preserves the stamp)

**Files:**
- Modify: `infrastructure/lambda/undercity_db.py` (`_upgrade_gear`)
- Modify: `infrastructure/lambda/tests/test_undercity_gorgon.py`

- [ ] **Step 1: Write the failing tests**

Add to `test_undercity_gorgon.py`:

```python
def test_gorgon_upgrade_mints_plus(table):
    sid, doc = _player_at(table, 'city_r0', spores=100)
    doc['passives'] = ['stonewright']                    # act as a Gorgon
    doc['gear'] = {'carapace': 'bramble_hide'}           # tier-1 bramble
    doc['materials'] = {'moltings': 10, 'ichor': 0}
    status, _ = db._upgrade_gear(
        table, sid, doc, {'target': {'where': 'equipped', 'slot': 'carapace'}})
    assert status == 200
    base_next = data.GEAR_FAMILY['bramble'][2]
    assert doc['gear']['carapace'] == base_next + '+'
    got = data.GEAR[doc['gear']['carapace']]
    assert got['plus'] is True
    assert got['def'] == data.GEAR[base_next]['def'] + data.GEAR_PLUS_BUMP


def test_non_gorgon_upgrade_stays_plain(table):
    sid, doc = _player_at(table, 'city_r0', spores=100)   # joined as pest (no stonewright)
    doc['gear'] = {'carapace': 'bramble_hide'}
    doc['materials'] = {'moltings': 10, 'ichor': 0}
    status, _ = db._upgrade_gear(
        table, sid, doc, {'target': {'where': 'equipped', 'slot': 'carapace'}})
    assert status == 200
    assert doc['gear']['carapace'] == data.GEAR_FAMILY['bramble'][2]   # no "+"


def test_plus_stamp_survives_non_gorgon_upgrade(table):
    sid, doc = _player_at(table, 'city_r0', spores=100)   # a pest, not a Gorgon
    doc['gear'] = {'carapace': data.GEAR_FAMILY['bramble'][2] + '+'}   # a forged tier-2+
    doc['materials'] = {'moltings': 10, 'ichor': data.UPGRADE_ICHOR[3]}
    status, _ = db._upgrade_gear(
        table, sid, doc, {'target': {'where': 'equipped', 'slot': 'carapace'}})
    assert status == 200
    assert doc['gear']['carapace'] == data.GEAR_FAMILY['bramble'][3] + '+'  # "+" preserved
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `cd infrastructure/lambda && python -m pytest tests/test_undercity_gorgon.py -q -k "mints or plain or survives"`
Expected: FAIL — `test_gorgon_upgrade_mints_plus` (no "+" minted) and `test_plus_stamp_survives_non_gorgon_upgrade` (stamp dropped). `test_non_gorgon_upgrade_stays_plain` already passes.

- [ ] **Step 3: Mint / preserve the "+" in the handler**

In `undercity_db.py`, in `_upgrade_gear`, after the existing lines:

```python
    next_tier = g['tier'] + 1
    next_gid = data.GEAR_FAMILY[rider].get(next_tier)
    if not next_gid:
        top = 'Mythic' if g['tier'] >= 4 else 'Legendary'
        return _err(f'That piece is already {top}.', 409)
```

insert:

```python
    # Gorgon Stonewright mints a Gear+; and an existing "+" stamp is permanent,
    # surviving further upgrades no matter who performs them.
    if 'stonewright' in _passives(doc) or gid.endswith(data.PLUS_SUFFIX):
        next_gid = data.plus_id(next_gid)
```

(The cost lookups below key on `next_tier`, so they are unaffected by "+", and `data.GEAR[next_gid]` resolves for the success text because the "+" variant exists in `GEAR`.)

- [ ] **Step 4: Run tests to verify they pass**

Run: `cd infrastructure/lambda && python -m pytest tests/test_undercity_gorgon.py -q -k "mints or plain or survives"`
Expected: PASS (3 tests).

- [ ] **Step 5: Commit**

```bash
git add infrastructure/lambda/undercity_db.py infrastructure/lambda/tests/test_undercity_gorgon.py
git commit -m "feat(undercity): Blacksmith mints tradeable Gear+ for Gorgons"
```

---

### Task 11: Regression check — Gear+ flows through market & salvage

Confirms the id-suffix approach carries "+" through the pipelines with no extra code (the point of the approach). If any of these fail, the fix is a `.strip('+')`/`plus_id` normalization at the failing lookup — but they are expected to pass because "+" ids resolve in `data.GEAR`.

**Files:**
- Modify: `infrastructure/lambda/tests/test_undercity_gorgon.py`

- [ ] **Step 1: Write the tests**

Add to `test_undercity_gorgon.py`:

```python
def test_plus_gear_resolves_name_and_cost():
    # Market/name lookups (data.GEAR[i]['name'/'cost']) must resolve "+" ids.
    pid = data.GEAR_FAMILY['bramble'][2] + '+'
    assert data.GEAR[pid]['name'].endswith(' +')
    assert isinstance(data.GEAR[pid]['cost'], int)


def test_plus_gear_contributes_stats_when_equipped():
    import undercity_engine as engine
    base = data.GEAR_FAMILY['bramble'][2]
    plain = {'gear': {'carapace': base}, 'atk': 5, 'def': 5, 'spd': 5, 'maxHp': 25}
    forged = {'gear': {'carapace': base + '+'}, 'atk': 5, 'def': 5, 'spd': 5, 'maxHp': 25}
    assert engine.effective_stats(forged)['def'] == engine.effective_stats(plain)['def'] + data.GEAR_PLUS_BUMP
```

- [ ] **Step 2: Run tests**

Run: `cd infrastructure/lambda && python -m pytest tests/test_undercity_gorgon.py -q -k "resolves or contributes"`
Expected: PASS (both — `effective_stats` reads gear via `data.GEAR.get(id)`, so "+" stats apply automatically).

- [ ] **Step 3: Commit**

```bash
git add infrastructure/lambda/tests/test_undercity_gorgon.py
git commit -m "test(undercity): Gear+ flows through stats, market naming & cost"
```

---

### Task 12: Client Gear+ resolver + display

**Files:**
- Modify: `src/app/undercity/data/items.ts` (add `gearById` resolver)
- Modify: gear-display sites that resolve a bare gear id (located via grep in Step 2)

- [ ] **Step 1: Add a "+"-aware resolver to items.ts**

In `src/app/undercity/data/items.ts`, after the `GEAR` array, add a base map + resolver:

```typescript
const GEAR_BY_ID: Record<string, GearInfo> = Object.fromEntries(GEAR.map((g) => [g.id, g]));

/** Resolve a gear id to its display info, synthesizing Gorgon "+" variants
 * (mirror of the Gear+ generation in undercity_data.py): +1 to the primary
 * stat, +2 at Mythic. Returns undefined for unknown ids. */
export function gearById(id: string | undefined | null): GearInfo | undefined {
  if (!id) return undefined;
  const direct = GEAR_BY_ID[id];
  if (direct) return direct;
  if (!id.endsWith('+')) return undefined;
  const base = GEAR_BY_ID[id.slice(0, -1)];
  if (!base) return undefined;
  const prime: 'atk' | 'def' | 'spd' =
    (base.spd ?? 0) > (base.atk ?? 0) && (base.spd ?? 0) > (base.def ?? 0)
      ? 'spd'
      : (base.def ?? 0) > (base.atk ?? 0)
        ? 'def'
        : 'atk';
  const bump = base.tier >= 4 ? 2 : 1;
  return { ...base, id, name: `${base.name} +`, [prime]: (base[prime] ?? 0) + bump, plus: true };
}
```

Add `plus?: boolean;` to the `GearInfo` interface in the same file.

- [ ] **Step 2: Route id-based gear lookups through the resolver**

Run: `grep -rn "GEAR_BY_ID\|GEAR.find(\|\.find((g) => g.id" src/app/undercity` to find gear-display sites. For each place that looks up gear info by a stored id (inventory, equipped slots, plaza market listings, battle gear readout — candidate files from the earlier scan: `tabs/creature-tab.component.ts/.html`, `tabs/plaza-tab.component.ts`, `tabs/interactive-battle.component.ts`, `tabs/battle-playback.component.ts`), replace the direct lookup with `gearById(id)`.

For gear **icon/sprite** resolution keyed on id, strip the suffix first so the base art is used: `gearById(id)?.id.replace(/\+$/, '')` — or, wherever an icon map is indexed, index with `id.replace(/\+$/, '')`.

- [ ] **Step 3: Show the "+" in the UI**

Where a gear name is rendered, `gearById(id)?.name` already yields the trailing " +". Add a visual badge on "+" pieces in the inventory/market templates, e.g. a small `masterwork` chip when `gearById(id)?.plus`, styled with an existing accent token from [STYLE_GUIDE.md](../STYLE_GUIDE.md) (no new color tokens). Keep it icon/text — no emoji (house rule).

- [ ] **Step 4: Verify the build**

Run: `npm run build`
Expected: build succeeds.

- [ ] **Step 5: Commit**

```bash
git add src/app/undercity/data/items.ts src/app/undercity/tabs/
git commit -m "feat(undercity): client renders Gear+ (masterwork) pieces"
```

---

### Task 13: Final gate — full suite + build

**Files:** none (verification only)

- [ ] **Step 1: Full backend suite**

Run: `cd infrastructure/lambda && python -m pytest tests -q`
Expected: PASS (entire suite green).

- [ ] **Step 2: Frontend build**

Run: `npm run build`
Expected: build succeeds.

- [ ] **Step 3: Manual smoke (optional, via the run-undercity skill)**

Create a Gorgon; confirm 5 banked points at L1 and 1 point on the next level-up; at the Blacksmith upgrade a piece and confirm it becomes "+"; list it on the Player Market and confirm the "+" name/stats persist for a buyer; as a non-Gorgon, upgrade a "+" piece and confirm the "+" survives.

---

## Deferred / non-goals (from the spec)

- No full "Pet+" minting (v1 is the light +1-level bonus only).
- No cost-discount or material-yield economy levers (Gear+ is the sole mechanism).
- No real Gorgon art (placeholder sprite; real art is a later swap).
- No new gear tier — Gear+ is a within-tier bonus, not a rung past Mythic.
- Balance validation: after deploy, if a Gorgon bot is cheap to add to `infrastructure/lambda/sim/`, confirm a Gorgon and a normal race land within ~1-2 stat points at cap once Gear+ is factored, and that "+" pieces price at roughly a half-tier premium on the market. (Deploys are run by the user.)
```
