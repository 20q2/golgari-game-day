# Elf Tier-2 Rework (Gorgon + Wood Lurker) Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Rework the Elf line's tier-2 forms: rename the petrifier to **Gorgon** (new sprite, Petrify unchanged), replace Basalt Matron with a **Wood Lurker** shapeshifter whose **Mimicry** passive takes on the foe's fighting style at battle start, and remove the orphaned Shatter/Brittle system.

**Architecture:** Mimicry reuses the Soul-Trophy variable one-battle-buff pattern — `_start_battle` appends a `mimic` buff derived from the enemy `personality` before the combatant is built, so `effective_stats` folds it in and `ONE_BATTLE_BUFFS` clears it. Form ids are renamed (`medusa_stalker`→`gorgon`, `basalt_matron`→`wood_lurker`) with their APEX `from`-list and sprite cascades. Brittle is torn out (field, `resolve_round` branches, snapshot round-trip, chip, config, tests).

**Tech Stack:** Python 3.11 Lambda + pytest (`FakeTable` suite); Angular 20 TS data mirrors.

Reference spec: [specs/2026-08-04-undercity-elf-tier2-rework-design.md](2026-08-04-undercity-elf-tier2-rework-design.md). Not deployed → **no save-compat aliases**.

---

## Key facts (verified)

- **Combatant build:** `_combatant(doc)` (`undercity_db.py:603`) sets stats from `engine.effective_stats(doc)`, which sums `doc['buffs']` entries — so a buff added to `doc['buffs']` before the build folds into combat stats.
- **Battle start:** `_start_battle` (`undercity_db.py:830`) builds `player_c = _combatant(doc)` at line 834 and has the `npc` dict (with `personality`) in scope.
- **Trophy pattern:** `effective_stats` (`undercity_engine.py:823`) has `elif kind == 'trophy': stat=buff.get('stat'); eff[stat]+=int(buff.get('amount',0))`. `ONE_BATTLE_BUFFS` (`undercity_db.py:884`) lists one-battle kinds; `_consume_one_battle_buffs` strips them post-fight.
- **Status chips:** `_battle_status` surfaces buff kinds; client `STATUS_INFO` (`combat.ts`) renders each.
- **Brittle sites:** `Combatant.brittle` (`undercity_engine.py:44`); the amp + Shatter proc in `resolve_round`; `brittle` in `_bt_snapshot`/`_bt_to_combatant`/`_bt_store` + `_battle_status`; `BRITTLE_AMP`/`BRITTLE_MAX` in `undercity_config.py`; `brittle` chip in `combat.ts`; `shatter` in `forms.ts`; 3 engine tests + 1 abilities test.
- **Forms:** `TIER2` in `undercity_data.py` (`medusa_stalker` passive `stone_gaze`; `basalt_matron` passive `shatter`, bonus `{atk:2,maxHp:4}`) + mirror in `forms.ts`; `FORM_SPRITES` in `species.ts` (both currently `sprite:'elf'`). APEX `from` lists reference the tier-2 ids in both files.

---

## PHASE 1 — Mimicry mechanism

### Task 1: Config scalars + `effective_stats` mimic branch

**Files:**
- Modify: `infrastructure/lambda/undercity_config.py`
- Modify: `infrastructure/lambda/undercity_engine.py` (`effective_stats`)
- Create: `infrastructure/lambda/tests/test_undercity_wood_lurker.py`

- [ ] **Step 1: Write the failing test**

Create `infrastructure/lambda/tests/test_undercity_wood_lurker.py`:

```python
"""Wood Lurker: Mimicry (mirror the foe's fighting style at battle start)."""
import undercity_data as data
import undercity_db as db
import undercity_engine as engine

from tests.test_undercity_db import (  # noqa: F401
    table, act, _sid, _player_at)


def _doc(**kw):
    # Player docs use 'def' (not 'dfn'); build via a literal since def is a keyword.
    base = {'atk': 5, 'def': 5, 'spd': 5, 'maxHp': 25, 'hp': 25,
            'gear': {}, 'buffs': [], 'passives': ['stonewright', 'mimicry']}
    base.update(kw)
    return base


def test_config_scalars_defined():
    assert data.MIMIC_MIRROR == 3
    assert data.MIMIC_BALANCED == 1


def test_effective_stats_reads_mimic_buff():
    d = _doc(buffs=[{'kind': 'mimic', 'stat': 'atk', 'amount': data.MIMIC_MIRROR}])
    assert engine.effective_stats(d)['atk'] == 5 + data.MIMIC_MIRROR
```

- [ ] **Step 2: Run test to verify it fails**

Run: `cd infrastructure/lambda && python -m pytest tests/test_undercity_wood_lurker.py -q`
Expected: FAIL — `MIMIC_MIRROR` missing; `mimic` buff ignored by `effective_stats`.

- [ ] **Step 3: Add config scalars**

Append to `infrastructure/lambda/undercity_config.py`:

```python
# ── Wood Lurker (Mimicry) ────────────────────────────────────────────────────
MIMIC_MIRROR = 3     # +stat matching the foe's fighting style (brute/turtle/trickster)
MIMIC_BALANCED = 1   # +ATK/+DEF/+SPD vs a balanced foe
```

- [ ] **Step 4: Extend the trophy branch to cover mimic**

In `undercity_engine.py` `effective_stats`, change the trophy branch:

```python
        elif kind in ('trophy', 'mimic'):
            # Variable +N to a chosen stat for one battle — the amount + stat ride
            # on the buff entry itself. Soul Trophy (Deathrite Shaman) and Mimicry
            # (Wood Lurker) share this shape.
            stat = buff.get('stat')
            if stat in ('atk', 'def', 'spd'):
                eff[stat] += int(buff.get('amount', 0))
```

- [ ] **Step 5: Run test to verify it passes**

Run: `cd infrastructure/lambda && python -m pytest tests/test_undercity_wood_lurker.py -q`
Expected: PASS (2 tests).

- [ ] **Step 6: Commit**

```bash
git add infrastructure/lambda/undercity_config.py infrastructure/lambda/undercity_engine.py infrastructure/lambda/tests/test_undercity_wood_lurker.py
git commit -m "feat(undercity): Mimicry scalars + effective_stats mimic buff"
```

---

### Task 2: `_apply_mimicry` + `_start_battle` hook + ONE_BATTLE_BUFFS

**Files:**
- Modify: `infrastructure/lambda/undercity_db.py` (`_start_battle`, `ONE_BATTLE_BUFFS`)
- Modify: `infrastructure/lambda/tests/test_undercity_wood_lurker.py`

- [ ] **Step 1: Write the failing tests**

Add to `test_undercity_wood_lurker.py`:

```python
def test_apply_mimicry_by_personality():
    for personality, stat in (('brute', 'atk'), ('turtle', 'def'), ('trickster', 'spd')):
        d = _doc()
        db._apply_mimicry(d, {'personality': personality})
        assert {'kind': 'mimic', 'stat': stat, 'amount': data.MIMIC_MIRROR} in d['buffs']
        assert engine.effective_stats(d)[stat] == 5 + data.MIMIC_MIRROR


def test_apply_mimicry_balanced_boosts_all():
    d = _doc()
    db._apply_mimicry(d, {'personality': 'balanced'})
    eff = engine.effective_stats(d)
    assert eff['atk'] == 5 + data.MIMIC_BALANCED
    assert eff['def'] == 5 + data.MIMIC_BALANCED
    assert eff['spd'] == 5 + data.MIMIC_BALANCED


def test_apply_mimicry_is_idempotent():
    d = _doc()
    db._apply_mimicry(d, {'personality': 'brute'})
    db._apply_mimicry(d, {'personality': 'turtle'})   # re-entry replaces, never stacks
    mimic = [b for b in d['buffs'] if b['kind'] == 'mimic']
    assert mimic == [{'kind': 'mimic', 'stat': 'def', 'amount': data.MIMIC_MIRROR}]


def test_mimic_is_a_one_battle_buff():
    assert 'mimic' in db.ONE_BATTLE_BUFFS


def test_start_battle_applies_mimicry(table):
    act(table, 'join', starter='elf')
    sid = _sid(table)
    doc = db._get_player(table, sid, 'user-alex')
    doc['passives'] = ['stonewright', 'mimicry']
    ev = db._wild_battle(table, sid, doc, region='cavern')
    assert ev['type'] == 'battle_start'
    # The hook applied a mimic buff to the doc, matching whatever wild was drawn.
    assert any(b.get('kind') == 'mimic' for b in (doc.get('buffs') or []))
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `cd infrastructure/lambda && python -m pytest tests/test_undercity_wood_lurker.py -q -k "mimicry or one_battle or start_battle"`
Expected: FAIL — `_apply_mimicry` undefined; `mimic` not in `ONE_BATTLE_BUFFS`.

- [ ] **Step 3: Add `_apply_mimicry` + the `_start_battle` hook**

In `undercity_db.py`, add the helper just above `_start_battle` (before line 830):

```python
_MIMIC_STAT = {'brute': 'atk', 'turtle': 'def', 'trickster': 'spd'}


def _apply_mimicry(doc, npc):
    """Wood Lurker Mimicry: take on the prey's shape — a one-battle buff matching
    the foe's fighting style. brute→ATK, turtle→DEF, trickster→SPD, balanced→a
    little of everything. Idempotent (strips any prior mimic buff first)."""
    buffs = [b for b in (doc.get('buffs') or []) if b.get('kind') != 'mimic']
    stat = _MIMIC_STAT.get(npc.get('personality', data.NPC_DEFAULT_PERSONALITY))
    if stat:
        buffs.append({'kind': 'mimic', 'stat': stat, 'amount': data.MIMIC_MIRROR})
    else:  # balanced / unknown → +MIMIC_BALANCED to each
        for s in ('atk', 'def', 'spd'):
            buffs.append({'kind': 'mimic', 'stat': s, 'amount': data.MIMIC_BALANCED})
    doc['buffs'] = buffs
```

Then in `_start_battle`, insert before `player_c = _combatant(doc)` (line 834):

```python
    # Wood Lurker Mimicry: shape to the prey before the combatant freezes.
    if 'mimicry' in _passives(doc):
        _apply_mimicry(doc, npc)
```

- [ ] **Step 4: Add `mimic` to ONE_BATTLE_BUFFS**

In `undercity_db.py`, extend the tuple (line 886) to end with `'trophy', 'mimic')`:

```python
                    'warding_dance', 'sap_vigor', 'rust_curse', 'high_five', 'trophy', 'mimic')
```

- [ ] **Step 5: Run tests to verify they pass**

Run: `cd infrastructure/lambda && python -m pytest tests/test_undercity_wood_lurker.py -q`
Expected: PASS.

- [ ] **Step 6: Commit**

```bash
git add infrastructure/lambda/undercity_db.py infrastructure/lambda/tests/test_undercity_wood_lurker.py
git commit -m "feat(undercity): Mimicry applies a foe-matched buff at battle start"
```

---

### Task 3: Mimic status chip (client)

**Files:**
- Modify: `src/app/undercity/data/combat.ts` (`STATUS_INFO`)

- [ ] **Step 1: Add the chip**

In `src/app/undercity/data/combat.ts` `STATUS_INFO`, add (Material icon, no emoji):

```typescript
  mimic: { label: 'Mimic', icon: 'theater_comedy', tone: 'buff',
    blurb: 'Shapeshifted to match the foe — a stat bump mirroring its fighting style.' },
```

- [ ] **Step 2: Verify build**

Run: `npm run build`
Expected: succeeds.

- [ ] **Step 3: Commit**

```bash
git add src/app/undercity/data/combat.ts
git commit -m "feat(undercity): Mimic status chip"
```

---

## PHASE 2 — Form renames (Gorgon + Wood Lurker)

### Task 4: Backend — rename both tier-2 forms

**Files:**
- Modify: `infrastructure/lambda/undercity_data.py` (`TIER2`, `APEX`)
- Modify: `infrastructure/lambda/tests/test_undercity_wood_lurker.py`

- [ ] **Step 1: Write the failing test**

Add to `test_undercity_wood_lurker.py`:

```python
def test_tier2_forms_renamed():
    assert set(data.tier2_options('elf')) == {'gorgon', 'wood_lurker'}
    assert data.TIER2['gorgon']['passive'] == 'stone_gaze'
    assert data.TIER2['gorgon']['name'] == 'Gorgon'
    wl = data.TIER2['wood_lurker']
    assert wl['passive'] == 'mimicry'
    assert wl['name'] == 'Wood Lurker'
    assert wl['bonus'] == {'maxHp': 6}
    # apex routing preserved under the new ids
    assert 'swamp_dragon' in data.apex_options('gorgon')
    assert 'grave_titan' in data.apex_options('wood_lurker')
```

- [ ] **Step 2: Run test to verify it fails**

Run: `cd infrastructure/lambda && python -m pytest tests/test_undercity_wood_lurker.py::test_tier2_forms_renamed -q`
Expected: FAIL — keys `gorgon`/`wood_lurker` don't exist.

- [ ] **Step 3: Rename the two `TIER2` entries**

In `undercity_data.py` `TIER2`, replace the `medusa_stalker` entry with:

```python
    'gorgon': {
        'name': 'Gorgon', 'line': 'elf', 'bonus': {'spd': 2, 'atk': 2},
        'passive': 'stone_gaze',
        'blurb': 'Gaze-hunter. Stone Gaze: reads come easily, and every read you land '
                 'petrifies the foe — stacking slow that ends in a one-round freeze.',
    },
```

and replace the `basalt_matron` entry with:

```python
    'wood_lurker': {
        'name': 'Wood Lurker', 'line': 'elf', 'bonus': {'maxHp': 6},
        'passive': 'mimicry',
        'blurb': 'Ambush shapeshifter. Mimicry: at the first blow it takes on the shape '
                 'of its prey — a stat bump matching how the foe fights.',
    },
```

- [ ] **Step 4: Update the four APEX `from` lists**

In `undercity_data.py` `APEX`, replace ids in these `from` lists:
- `grave_titan`: `'basalt_matron'` → `'wood_lurker'`
- `golgari_lich_lord`: `'basalt_matron'` → `'wood_lurker'`
- `swamp_dragon`: `'medusa_stalker'` → `'gorgon'`
- `izoni`: `'medusa_stalker'` → `'gorgon'`

- [ ] **Step 5: Run test to verify it passes**

Run: `cd infrastructure/lambda && python -m pytest tests/test_undercity_wood_lurker.py::test_tier2_forms_renamed -q`
Expected: PASS.

- [ ] **Step 6: Update the stale evolution test**

In `infrastructure/lambda/tests/test_undercity_gorgon.py`, change `test_gorgon_evolution_line`:

```python
def test_gorgon_evolution_line():
    assert set(data.tier2_options('elf')) == {'gorgon', 'wood_lurker'}
    assert 'grave_titan' in data.apex_options('wood_lurker')
    assert 'golgari_lich_lord' in data.apex_options('wood_lurker')
    assert 'swamp_dragon' in data.apex_options('gorgon')
    assert 'izoni' in data.apex_options('gorgon')
```

- [ ] **Step 7: Run + commit**

Run: `cd infrastructure/lambda && python -m pytest tests/test_undercity_wood_lurker.py tests/test_undercity_gorgon.py -q`
Expected: PASS.

```bash
git add infrastructure/lambda/undercity_data.py infrastructure/lambda/tests/test_undercity_wood_lurker.py infrastructure/lambda/tests/test_undercity_gorgon.py
git commit -m "feat(undercity): rename tier-2 forms -> gorgon + wood_lurker"
```

---

### Task 5: Client — form mirror + sprites

**Files:**
- Modify: `src/app/undercity/data/forms.ts` (`TIER2`, `APEX`, passive strings)
- Modify: `src/app/undercity/data/species.ts` (`FORM_SPRITES`)

- [ ] **Step 1: Rename the two `TIER2` entries in forms.ts**

Replace the `medusa_stalker` line with:

```typescript
  { id: 'gorgon', name: 'Gorgon', tier: 2, line: 'elf', passive: 'stone_gaze', passiveName: 'Stone Gaze', bonus: { spd: 2, atk: 2 }, blurb: 'Gaze-hunter (+SPD/+ATK).' },
```

Replace the `basalt_matron` line with:

```typescript
  { id: 'wood_lurker', name: 'Wood Lurker', tier: 2, line: 'elf', passive: 'mimicry', passiveName: 'Mimicry', bonus: { maxHp: 6 }, blurb: 'Ambush shapeshifter (+HP).' },
```

- [ ] **Step 2: Update the APEX `from` lists in forms.ts**

Same four edits as the backend: `basalt_matron`→`wood_lurker` in `grave_titan`/`golgari_lich_lord`; `medusa_stalker`→`gorgon` in `swamp_dragon`/`izoni`.

- [ ] **Step 3: Passive strings**

In `forms.ts` `PASSIVE_NAMES` add `mimicry: 'Mimicry',`; in `PASSIVE_BLURBS` add:

```typescript
  mimicry: 'At the first blow it takes the shape of its prey — a stat bump matching how the foe fights.',
```

- [ ] **Step 4: Sprites in species.ts**

In `species.ts` `FORM_SPRITES`, remove the old `medusa_stalker`/`basalt_matron` keys and add:

```typescript
  gorgon: { sprite: 'gorgon', regions: MASK_REGIONS, scale: 0.9 },
  // Wood Lurker: placeholder (reuses the elf sprite) until dedicated art lands.
  wood_lurker: { sprite: 'elf', regions: MASK_REGIONS, scale: 0.9 },
```

- [ ] **Step 5: Verify build**

Run: `npm run build`
Expected: succeeds (the `gorgon` sprite resolves to `player_sprites/gorgon.*`).

- [ ] **Step 6: Commit**

```bash
git add src/app/undercity/data/forms.ts src/app/undercity/data/species.ts
git commit -m "feat(undercity): client mirror for Gorgon + Wood Lurker forms"
```

---

## PHASE 3 — Remove Shatter / Brittle

### Task 6: Engine — remove the Brittle field + resolve_round branches

**Files:**
- Modify: `infrastructure/lambda/undercity_engine.py`
- Modify: `infrastructure/lambda/tests/test_undercity_engine.py` (delete the 3 brittle tests)

- [ ] **Step 1: Delete the three Brittle engine tests**

In `tests/test_undercity_engine.py`, delete `test_shatter_applies_brittle_on_aggress_win`, `test_brittle_amplifies_gorgon_damage`, and `test_brittle_caps` (the block added under "Gorgon Shatter / Brittle").

- [ ] **Step 2: Remove the `brittle` field**

In `undercity_engine.py` `Combatant`, delete the line:

```python
    brittle: int = field(default=0, repr=False)        # Gorgon Shatter: enemy damage-amp stacks
```

(Keep the `petrify` line above it.)

- [ ] **Step 3: Remove the amp + proc in `resolve_round`**

Delete the Brittle amp block:

```python
            if winr.has('shatter') and losr.brittle:
                mult += data.BRITTLE_AMP * min(losr.brittle, data.BRITTLE_MAX)   # crack the stone
```

and the Shatter proc block:

```python
            # Shatter (Basalt Matron): a winning Aggress cracks the foe — a stacking
            # Brittle debuff that amplifies the Gorgon's future hits.
            if win_stance == 'aggress' and winr.has('shatter') and losr.hp > 0:
                losr.brittle = min(data.BRITTLE_MAX, losr.brittle + 1)
```

- [ ] **Step 4: Run tests to verify green (no brittle refs)**

Run: `cd infrastructure/lambda && python -m pytest tests/test_undercity_engine.py -q -k "not brittle and not shatter"`
Expected: PASS; and `grep -rn "brittle" infrastructure/lambda/undercity_engine.py` returns nothing.

- [ ] **Step 5: Commit**

```bash
git add infrastructure/lambda/undercity_engine.py infrastructure/lambda/tests/test_undercity_engine.py
git commit -m "refactor(undercity): remove Brittle from the combat engine"
```

---

### Task 7: DB + config — remove Brittle plumbing

**Files:**
- Modify: `infrastructure/lambda/undercity_db.py` (`_bt_snapshot`, `_bt_to_combatant`, `_bt_store`, `_battle_status`)
- Modify: `infrastructure/lambda/undercity_config.py`
- Modify: `infrastructure/lambda/tests/test_undercity_gorgon.py` (drop the Basalt-Shatter test)

- [ ] **Step 1: Remove `brittle` from the snapshot round-trip**

In `undercity_db.py`:
- `_bt_snapshot`: change `'petrify': int(c.petrify), 'brittle': int(c.brittle),` → `'petrify': int(c.petrify),`
- `_bt_to_combatant`: delete `c.brittle = int(s.get('brittle', 0))` (keep the `c.petrify` line).
- `_bt_store`: delete `rec_side['brittle'] = int(c.brittle)` (keep `rec_side['petrify']`).

- [ ] **Step 2: Remove `brittle` from `_battle_status`**

Change the traits line to drop brittle:

```python
    traits += [k for k in ('petrify',) if side.get(k)]   # Gorgon debuff
```

and delete:

```python
    if side.get('brittle'):
        stacks['brittle'] = int(side['brittle'])
```

- [ ] **Step 3: Remove the config scalars**

In `undercity_config.py`, delete `BRITTLE_AMP` and `BRITTLE_MAX` lines.

- [ ] **Step 4: Drop the stale Basalt-Shatter test**

In `infrastructure/lambda/tests/test_undercity_gorgon.py`, delete `test_basalt_has_shatter_and_bruiser_bonus` if present (it moved into the abilities suite as `test_undercity_gorgon_abilities.py::test_basalt_has_shatter_and_bruiser_bonus` — delete it wherever it lives; `grep -rn "basalt_matron\|shatter" tests/` to find it).

- [ ] **Step 5: Verify no brittle refs remain + suite green**

Run: `grep -rn "brittle\|BRITTLE\|shatter" infrastructure/lambda/*.py` → only expected leftover is none.
Run: `cd infrastructure/lambda && python -m pytest tests/test_undercity_gorgon.py tests/test_undercity_gorgon_abilities.py tests/test_undercity_wood_lurker.py -q`
Expected: PASS.

- [ ] **Step 6: Commit**

```bash
git add infrastructure/lambda/undercity_db.py infrastructure/lambda/undercity_config.py infrastructure/lambda/tests/
git commit -m "refactor(undercity): remove Brittle plumbing (db + config + tests)"
```

---

### Task 8: Client — remove Shatter/Brittle

**Files:**
- Modify: `src/app/undercity/data/combat.ts` (drop `brittle` chip)
- Modify: `src/app/undercity/data/forms.ts` (drop `shatter` passive strings)

- [ ] **Step 1: Remove the brittle chip**

In `combat.ts` `STATUS_INFO`, delete the `brittle:` entry (keep `petrify` and the new `mimic`).

- [ ] **Step 2: Remove the shatter passive strings**

In `forms.ts`, delete `shatter: 'Shatter',` from `PASSIVE_NAMES` and the `shatter: '...'` line from `PASSIVE_BLURBS`.

- [ ] **Step 3: Verify build**

Run: `npm run build`
Expected: succeeds; `grep -rn "brittle\|shatter" src/app/undercity/data/` returns nothing.

- [ ] **Step 4: Commit**

```bash
git add src/app/undercity/data/combat.ts src/app/undercity/data/forms.ts
git commit -m "refactor(undercity): remove Shatter/Brittle from the client"
```

---

### Task 9: Final gate

**Files:** none (verification only)

- [ ] **Step 1: Full backend suite**

Run: `cd infrastructure/lambda && python -m pytest tests -q`
Expected: the Wood Lurker suite is green and no **new** failures vs the branch baseline (the branch carries ~50 pre-existing failures unrelated to this work; confirm none mention `mimic`/`gorgon`/`wood_lurker`/`brittle`/`shatter`).

- [ ] **Step 2: Frontend build**

Run: `npm run build`
Expected: succeeds.

- [ ] **Step 3: Manual smoke (optional, via run-undercity skill)**

Evolve/stamp an Elf to Wood Lurker; start a fight vs a brute-personality foe and confirm a "Mimic" chip + raised ATK; confirm it clears after the fight. Evolve another to Gorgon and confirm the new sprite + Petrify still works.

---

## Self-review notes (addressed)

- **Spec coverage:** Mimicry mechanism (T1–T2) + chip (T3); Gorgon rename + Wood Lurker form + sprites (T4–T5); Shatter/Brittle removal across engine/db/config/client/tests (T6–T8). `petrify`/Gorgon Petrify untouched.
- **Type consistency:** `mimic` buff shape `{kind,stat,amount}` matches the extended `effective_stats` branch, `_apply_mimicry`, and `ONE_BATTLE_BUFFS` across all tasks. New ids `gorgon`/`wood_lurker` and passive `mimicry` consistent in data + mirror + tests.
- **No save-compat** (confirmed pre-deploy).

## Non-goals (from the spec)

- No shapeshift-into-enemy-sprite visual; no copying enemy passives; no change to Petrify / Stonewright / wildcard slot; no Wood Lurker art (placeholder).
