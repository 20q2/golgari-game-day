# Undercity Spell Expansion & Single-Source Refactor — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add ~13 new spells (+6 new one-battle buff/curse kinds) and make spells define-once by generating the client `spells.ts` data from the Python source of truth.

**Architecture:** Python `undercity_data.py` stays the authored source (`SPELLS`/`GRIMOIRES`/`BIOME_SPELLS`), now carrying client `icon`/`desc` fields. A new `sync_spells.py` renders `src/app/undercity/data/spells.generated.ts` (data arrays only); the hand-written `spells.ts` keeps types + helpers and re-exports the generated arrays. A pytest guard fails if the generated file is stale (mirrors `test_map_file.py`). New buff kinds are one `elif` in `engine.effective_stats()` + one entry in `ONE_BATTLE_BUFFS`. No new effect-kind dispatcher branches.

**Tech Stack:** Python 3.11 Lambda (pytest), Angular 20 / TypeScript (esbuild), JSON.

**Spec:** [specs/2026-07-23-undercity-spell-expansion-design.md](../../../specs/2026-07-23-undercity-spell-expansion-design.md)

---

## File Structure

- `infrastructure/lambda/undercity_data.py` — MODIFY: add `icon`/`desc` to existing `SPELLS`; add 13 new spells; add 6 new grimoires.
- `infrastructure/lambda/undercity_engine.py` — MODIFY: 6 new `buffKind` branches in `effective_stats()`.
- `infrastructure/lambda/undercity_db.py` — MODIFY: append 6 kinds to `ONE_BATTLE_BUFFS`.
- `infrastructure/lambda/sync_spells.py` — CREATE: generator (`render()` + `__main__`).
- `src/app/undercity/data/spells.generated.ts` — CREATE (generated, committed): `SPELLS`/`GRIMOIRES`/`BIOME_SPELLS` arrays.
- `src/app/undercity/data/spells.ts` — MODIFY: drop the data-array literals; import + re-export from `spells.generated`; keep types, maps, helpers.
- `infrastructure/lambda/tests/test_undercity_spells.py` — MODIFY: enforce `icon`/`desc`; new-buff-kind tests; new-spell/grimoire assertions; bump tier-1 count; end-to-end cast tests.
- `infrastructure/lambda/tests/test_spells_generated.py` — CREATE: codegen staleness guard.
- `specs/undercity-spells.md` — MODIFY: refresh roadmap + tables + checklist.

Run all Python tests with: `cd infrastructure/lambda && python -m pytest tests -q`
Run the client build with: `npm run build` (from repo root).

---

## Task 1: Enrich existing Python spells with `icon`/`desc` (source parity)

Codegen needs every spell to carry the client display fields. Copy them from the current `spells.ts` into the Python `SPELLS` entries, and enforce their presence.

**Files:**
- Modify: `infrastructure/lambda/undercity_data.py` (the `SPELLS` dict, ~lines 457–515)
- Test: `infrastructure/lambda/tests/test_undercity_spells.py`

- [ ] **Step 1: Write the failing test**

Add after `test_spell_fields_match_effect_kind` (near line 99) in `test_undercity_spells.py`:

```python
def test_every_spell_has_client_display_fields():
    """Codegen source parity: every spell carries an icon + desc for the client."""
    for sid_, sp in data.SPELLS.items():
        assert sp.get('desc'), f'{sid_} missing desc'
        assert sp.get('icon'), f'{sid_} missing icon'
```

- [ ] **Step 2: Run test to verify it fails**

Run: `cd infrastructure/lambda && python -m pytest tests/test_undercity_spells.py::test_every_spell_has_client_display_fields -v`
Expected: FAIL — existing spells have no `desc`/`icon`.

- [ ] **Step 3: Add `icon` + `desc` to every existing spell**

In `undercity_data.py`, add `'icon'` and `'desc'` keys to each existing `SPELLS` entry (keep `blurb`). Use these exact values (copied from the current `spells.ts`):

```
rot_surge:      icon 'local_fire_department', desc '+3 ATK in your next battle.'
bone_chill:     icon 'ac_unit',               desc 'Curse a rival: −2 ATK in their next battle.'
bog_snare:      icon 'water_drop',            desc 'Curse a rival: their next roll is halved.'
glowveil:       icon 'flare',                 desc '+2 SPD and +15% flee chance in your next battle.'
scrap_toss:     icon 'construction',          desc 'Hurl city scrap at a rival.'
spore_bolt:     icon 'flash_on',              desc 'A puff of caustic spores at range.'
mend_flesh:     icon 'healing',               desc 'Knit your wounds.'
harden_shell:   icon 'shield',                desc '+2 DEF in your next battle.'
skitter_step:   icon 'directions_run',        desc 'Skitter ahead: choose your next roll (1–3).'
rot_bolt:       icon 'thunderstorm',          desc 'A lance of concentrated rot at range.'
weaken_hex:     icon 'heart_broken',          desc 'Curse a rival: −3 ATK in their next battle.'
mycelial_recall:icon 'home',                  desc 'The threads drag you home to your biome gate.'
fate_die:       icon 'casino',                desc 'Choose the value of your next roll (1–6).'
spore_burst:    icon 'coronavirus',           desc 'A detonation of spores at range.'
deep_step:      icon 'alt_route',             desc 'Blink to any space within 6 steps.'
queens_bane:    icon 'gavel',                 desc 'Sear the Queen or a lair boss, from anywhere.'
wish:           icon 'auto_awesome',          desc 'Cast any spell in existence, from any list.'
```

Example (the `scrap_toss` entry becomes):

```python
    'scrap_toss':  {'name': 'Scrap Toss', 'category': 'field', 'tier': 1, 'cooldownMin': 30,
                    'effect': 'field_damage', 'power': 8, 'range': 5,
                    'icon': 'construction', 'desc': 'Hurl city scrap at a rival.',
                    'blurb': 'Hurl city scrap at a rival for 8 damage.'},
```

- [ ] **Step 4: Run test to verify it passes**

Run: `cd infrastructure/lambda && python -m pytest tests/test_undercity_spells.py -q`
Expected: PASS (all spell tests green).

- [ ] **Step 5: Commit**

```bash
git add infrastructure/lambda/undercity_data.py infrastructure/lambda/tests/test_undercity_spells.py
git commit -m "feat(undercity): carry client icon/desc on Python spell source"
```

---

## Task 2: Codegen script + generated file + staleness guard

**Files:**
- Create: `infrastructure/lambda/sync_spells.py`
- Create: `src/app/undercity/data/spells.generated.ts`
- Modify: `src/app/undercity/data/spells.ts`
- Create: `infrastructure/lambda/tests/test_spells_generated.py`

- [ ] **Step 1: Write the generator**

Create `infrastructure/lambda/sync_spells.py`:

```python
"""Generate the client spell mirror from the Python source of truth.

Python (undercity_data.SPELLS/GRIMOIRES/BIOME_SPELLS) is authored; this renders
src/app/undercity/data/spells.generated.ts (data arrays only). The hand-written
spells.ts keeps the types + helpers and re-exports these arrays. The
copies-match pytest in tests/test_spells_generated.py fails while they differ.

Run after editing the spell tables:  python infrastructure/lambda/sync_spells.py
"""
import json
import sys
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parent))

import undercity_data as data  # noqa: E402

OUT = (Path(__file__).resolve().parents[2]
       / 'src' / 'app' / 'undercity' / 'data' / 'spells.generated.ts')

# Client SpellInfo carries no buffKind/blurb (server-only); grimoire desc is the
# Python blurb. Optional numeric fields are omitted when absent, matching style.
_SPELL_OPTIONAL = ('range', 'maxValue', 'power')


def _ts(value):
    """A TS string literal: double-quoted, unicode preserved, properly escaped."""
    return json.dumps(value, ensure_ascii=False)


def _spell_line(spell_id, sp):
    parts = [f'id: {_ts(spell_id)}', f'name: {_ts(sp["name"])}',
             f'category: {_ts(sp["category"])}', f'tier: {sp["tier"]}',
             f'cooldownMin: {sp["cooldownMin"]}', f'effect: {_ts(sp["effect"])}']
    for opt in _SPELL_OPTIONAL:
        if opt in sp:
            parts.append(f'{opt}: {sp[opt]}')
    parts.append(f'desc: {_ts(sp["desc"])}')
    parts.append(f'icon: {_ts(sp["icon"])}')
    return '  { ' + ', '.join(parts) + ' },'


def _grim_line(grim_id, g):
    spells = '[' + ', '.join(_ts(s) for s in g['spells']) + ']'
    parts = [f'id: {_ts(grim_id)}', f'name: {_ts(g["name"])}', f'tier: {g["tier"]}',
             f'cost: {g["cost"]}', f'spells: {spells}', f'desc: {_ts(g["blurb"])}']
    return '  { ' + ', '.join(parts) + ' },'


def render():
    lines = [
        '// AUTO-GENERATED by infrastructure/lambda/sync_spells.py — DO NOT EDIT.',
        '// Edit the Python tables in undercity_data.py, then re-run sync_spells.py.',
        "import type { SpellInfo, GrimoireInfo } from './spells';",
        '',
        'export const SPELLS: SpellInfo[] = [',
    ]
    lines += [_spell_line(sid, sp) for sid, sp in data.SPELLS.items()]
    lines += ['];', '', 'export const GRIMOIRES: GrimoireInfo[] = [']
    lines += [_grim_line(gid, g) for gid, g in data.GRIMOIRES.items()]
    lines += ['];', '', 'export const BIOME_SPELLS: Record<string, string> = {']
    lines += [f'  {_ts(biome)}: {_ts(spell_id)},'
              for biome, spell_id in data.BIOME_SPELLS.items()]
    lines += ['};', '']
    return '\n'.join(lines)


if __name__ == '__main__':
    OUT.write_text(render(), encoding='utf-8', newline='\n')
    print(f'wrote {OUT}')
```

- [ ] **Step 2: Generate the file**

Run: `cd infrastructure/lambda && python sync_spells.py`
Expected: prints `wrote .../spells.generated.ts`; the file now exists with `SPELLS`/`GRIMOIRES`/`BIOME_SPELLS`.

- [ ] **Step 3: Refactor `spells.ts` to consume the generated arrays**

In `src/app/undercity/data/spells.ts`, **delete** the three literal blocks — `export const SPELLS: SpellInfo[] = [ ... ];`, `export const GRIMOIRES: GrimoireInfo[] = [ ... ];`, and `export const BIOME_SPELLS ... = { ... };`. Replace the `SPELLS` block's location with an import at the top of the file (just after the header comment) and a re-export where the arrays used to be.

Add at the very top (line 2, after the header comment):

```typescript
import { SPELLS, GRIMOIRES, BIOME_SPELLS } from './spells.generated';
export { SPELLS, GRIMOIRES, BIOME_SPELLS };
```

Keep everything else in `spells.ts` unchanged: `SpellEffect`, `SpellInfo`, `GrimoireInfo`, `SPELL_MAP` (still `Object.fromEntries(SPELLS.map(...))`), `GRIMOIRE_MAP`, `cooldownLeftMin`, `grimoireSwapLeftMin`, `GRIMOIRE_SWAP_COOLDOWN_MIN`, `GRIMOIRE_CAPACITY`, `WITCH_SCROLL_STOCK`, `spellCategoryStyle`, `SPELL_POWER_PER_LEVEL`, `spellPower`, `spellPowerLabel`. `SPELL_MAP`/`GRIMOIRE_MAP` now reference the imported `SPELLS`/`GRIMOIRES` — no change needed since they're in scope.

(The `import type` in the generated file and the value import here form only a type-level cycle, which TypeScript/esbuild erase — there is no runtime cycle.)

- [ ] **Step 4: Verify the client build compiles**

Run (repo root): `npm run build`
Expected: build succeeds (only the pre-existing unrelated NG8113/CommonJS warnings). No errors referencing `spells.ts` or `spells.generated.ts`.

- [ ] **Step 5: Write the staleness guard test**

Create `infrastructure/lambda/tests/test_spells_generated.py`:

```python
"""Guard: the committed client spell mirror matches the Python source."""
import sys
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parents[1]))

import sync_spells


def test_generated_spells_in_sync():
    committed = sync_spells.OUT.read_text(encoding='utf-8')
    assert committed == sync_spells.render(), \
        'run: python infrastructure/lambda/sync_spells.py'
```

- [ ] **Step 6: Run the guard test**

Run: `cd infrastructure/lambda && python -m pytest tests/test_spells_generated.py -q`
Expected: PASS (file was just generated, so it matches).

- [ ] **Step 7: Commit**

```bash
git add infrastructure/lambda/sync_spells.py infrastructure/lambda/tests/test_spells_generated.py src/app/undercity/data/spells.generated.ts src/app/undercity/data/spells.ts
git commit -m "feat(undercity): generate client spell mirror from Python source"
```

---

## Task 3: Add the 6 new buff/curse kinds to the engine

**Files:**
- Modify: `infrastructure/lambda/undercity_engine.py` (`effective_stats()`, ~lines 711–722)
- Modify: `infrastructure/lambda/undercity_db.py` (`ONE_BATTLE_BUFFS`, line 661)
- Test: `infrastructure/lambda/tests/test_undercity_spells.py`

- [ ] **Step 1: Write the failing tests**

Add to `test_undercity_spells.py` (in the engine-helpers section, after the existing buff-related tests):

```python
import pytest as _pytest

_NEW_BUFFS = [
    ('savage_roar',  'atk', 5),
    ('iron_hide',    'def', 4),
    ('fleetfoot',    'spd', 3),
    ('sap_vigor',    'spd', -3),
    ('rust_curse',   'def', -4),
]


@_pytest.mark.parametrize('kind,stat,delta', _NEW_BUFFS)
def test_new_buff_kind_shifts_stat(kind, stat, delta):
    base = {'atk': 10, 'def': 10, 'spd': 10, 'maxHp': 30, 'buffs': [{'kind': kind}]}
    eff = engine.effective_stats(base)
    assert eff[stat] == 10 + delta


def test_warding_dance_shifts_two_stats():
    base = {'atk': 10, 'def': 10, 'spd': 10, 'maxHp': 30,
            'buffs': [{'kind': 'warding_dance'}]}
    eff = engine.effective_stats(base)
    assert eff['def'] == 13 and eff['spd'] == 13


@_pytest.mark.parametrize('kind', ['savage_roar', 'iron_hide', 'fleetfoot',
                                   'warding_dance', 'sap_vigor', 'rust_curse'])
def test_new_buff_kinds_are_one_battle(kind):
    assert kind in db.ONE_BATTLE_BUFFS
    doc = {'buffs': [{'kind': kind}]}
    db._consume_one_battle_buffs(doc)
    assert doc['buffs'] == []


def test_self_buff_mult_doubles_new_buff():
    """Squirrel Warrior doubling applies to the new self-buffs (mult carried)."""
    base = {'atk': 10, 'def': 10, 'spd': 10, 'maxHp': 30,
            'buffs': [{'kind': 'savage_roar', 'mult': 2}]}
    assert engine.effective_stats(base)['atk'] == 10 + 5 * 2
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `cd infrastructure/lambda && python -m pytest tests/test_undercity_spells.py -q -k "new_buff or warding_dance or self_buff_mult"`
Expected: FAIL — kinds not handled (stat unchanged) and not in `ONE_BATTLE_BUFFS`.

- [ ] **Step 3: Add the engine branches**

In `undercity_engine.py`, inside the `for buff in ...` loop in `effective_stats()`, add these branches after the existing `weaken_hex` branch (before the loop ends, ~line 722):

```python
        elif kind == 'savage_roar':
            eff['atk'] += 5 * mult
        elif kind == 'iron_hide':
            eff['def'] += 4 * mult
        elif kind == 'fleetfoot':
            eff['spd'] += 3 * mult
        elif kind == 'warding_dance':
            eff['def'] += 3 * mult
            eff['spd'] += 3 * mult
        elif kind == 'sap_vigor':
            eff['spd'] = max(1, eff['spd'] - 3)
        elif kind == 'rust_curse':
            eff['def'] = max(1, eff['def'] - 4)
```

- [ ] **Step 4: Add the kinds to `ONE_BATTLE_BUFFS`**

In `undercity_db.py` line 661, extend the tuple:

```python
ONE_BATTLE_BUFFS = ('rot_surge', 'bone_chill', 'glowveil', 'harden_shell', 'weaken_hex',
                    'savage_roar', 'iron_hide', 'fleetfoot', 'warding_dance',
                    'sap_vigor', 'rust_curse')
```

- [ ] **Step 5: Run tests to verify they pass**

Run: `cd infrastructure/lambda && python -m pytest tests/test_undercity_spells.py -q -k "new_buff or warding_dance or self_buff_mult"`
Expected: PASS.

- [ ] **Step 6: Commit**

```bash
git add infrastructure/lambda/undercity_engine.py infrastructure/lambda/undercity_db.py infrastructure/lambda/tests/test_undercity_spells.py
git commit -m "feat(undercity): six new one-battle buff/curse kinds"
```

---

## Task 4: Add the 13 new spells (data-only) + regenerate

**Files:**
- Modify: `infrastructure/lambda/undercity_data.py` (`SPELLS` dict)
- Modify: `src/app/undercity/data/spells.generated.ts` (regenerated)
- Test: `infrastructure/lambda/tests/test_undercity_spells.py`

- [ ] **Step 1: Write the failing test**

Add to `test_undercity_spells.py`:

```python
_NEW_SPELLS = {
    'ember_fleck': ('field_damage', 1), 'necrotic_lance': ('field_damage', 2),
    'withering_gout': ('field_damage', 3), 'renewing_bloom': ('self_heal', 2),
    'deep_mend': ('self_heal', 3), 'sear_throne': ('boss_strike', 3),
    'shadowstep': ('teleport', 2), 'savage_roar': ('self_buff', 2),
    'iron_hide': ('self_buff', 2), 'fleetfoot_draught': ('self_buff', 2),
    'warding_dance': ('self_buff', 3), 'sap_vigor': ('field_curse', 2),
    'rust_curse': ('field_curse', 3),
}


def test_new_spells_present_and_shaped():
    for sid_, (effect, tier) in _NEW_SPELLS.items():
        sp = data.SPELLS[sid_]
        assert sp['effect'] == effect and sp['tier'] == tier, sid_
        # buffKind on the new self_buff/field_curse spells must be a real handled kind
        if effect in ('self_buff', 'field_curse'):
            assert sp['buffKind'] in db.ONE_BATTLE_BUFFS, sid_
```

- [ ] **Step 2: Run test to verify it fails**

Run: `cd infrastructure/lambda && python -m pytest tests/test_undercity_spells.py::test_new_spells_present_and_shaped -v`
Expected: FAIL with `KeyError: 'ember_fleck'`.

- [ ] **Step 3: Add the new spells to `SPELLS`**

In `undercity_data.py`, add these entries to the `SPELLS` dict (before the closing `}`):

```python
    # ── Expansion 2026-07-23 (spec: undercity-spell-expansion) ──
    'ember_fleck':  {'name': 'Ember Fleck', 'category': 'field', 'tier': 1, 'cooldownMin': 15,
                     'effect': 'field_damage', 'power': 10, 'range': 4,
                     'icon': 'whatshot', 'desc': 'A quick fleck of ember at close range.',
                     'blurb': 'A fleck of ember scorches your rival.'},
    'necrotic_lance': {'name': 'Necrotic Lance', 'category': 'field', 'tier': 2, 'cooldownMin': 28,
                       'effect': 'field_damage', 'power': 16, 'range': 9,
                       'icon': 'colorize', 'desc': 'A long lance of necrotic rot.',
                       'blurb': 'A lance of necrotic rot strikes from afar.'},
    'withering_gout': {'name': 'Withering Gout', 'category': 'field', 'tier': 3, 'cooldownMin': 26,
                       'effect': 'field_damage', 'power': 26, 'range': 6,
                       'icon': 'coronavirus', 'desc': 'A gout of withering decay.',
                       'blurb': 'A gout of withering decay engulfs your rival.'},
    'renewing_bloom': {'name': 'Renewing Bloom', 'category': 'buff', 'tier': 2, 'cooldownMin': 25,
                       'effect': 'self_heal', 'power': 20,
                       'icon': 'local_florist', 'desc': 'A bloom of renewing spores.',
                       'blurb': 'Renewing spores bloom across your wounds.'},
    'deep_mend':    {'name': 'Deep Mend', 'category': 'buff', 'tier': 3, 'cooldownMin': 30,
                     'effect': 'self_heal', 'power': 34,
                     'icon': 'healing', 'desc': 'Deep restorative mycelium knits you whole.',
                     'blurb': 'Deep mycelium knits you whole.'},
    'sear_throne':  {'name': 'Sear the Throne', 'category': 'boss', 'tier': 3, 'cooldownMin': 60,
                     'effect': 'boss_strike', 'power': 22,
                     'icon': 'local_fire_department',
                     'desc': 'Sear the Queen or a lair boss, from anywhere.',
                     'blurb': 'A searing bolt lances the throne from afar.'},
    'shadowstep':   {'name': 'Shadowstep', 'category': 'traversal', 'tier': 2, 'cooldownMin': 25,
                     'effect': 'teleport', 'range': 3,
                     'icon': 'nightlight', 'desc': 'Blink to any space within 3 steps.',
                     'blurb': 'You step through the dark.'},
    'savage_roar':  {'name': 'Savage Roar', 'category': 'buff', 'tier': 2, 'cooldownMin': 25,
                     'effect': 'self_buff', 'buffKind': 'savage_roar',
                     'icon': 'local_fire_department', 'desc': '+5 ATK in your next battle.',
                     'blurb': '+5 ATK in your next battle.'},
    'iron_hide':    {'name': 'Iron Hide', 'category': 'buff', 'tier': 2, 'cooldownMin': 25,
                     'effect': 'self_buff', 'buffKind': 'iron_hide',
                     'icon': 'security', 'desc': '+4 DEF in your next battle.',
                     'blurb': '+4 DEF in your next battle.'},
    'fleetfoot_draught': {'name': 'Fleetfoot Draught', 'category': 'buff', 'tier': 2, 'cooldownMin': 25,
                          'effect': 'self_buff', 'buffKind': 'fleetfoot',
                          'icon': 'directions_run', 'desc': '+3 SPD in your next battle.',
                          'blurb': '+3 SPD in your next battle.'},
    'warding_dance': {'name': 'Warding Dance', 'category': 'buff', 'tier': 3, 'cooldownMin': 30,
                      'effect': 'self_buff', 'buffKind': 'warding_dance',
                      'icon': 'shield_moon', 'desc': '+3 DEF and +3 SPD in your next battle.',
                      'blurb': '+3 DEF and +3 SPD in your next battle.'},
    'sap_vigor':    {'name': 'Sap Vigor', 'category': 'field', 'tier': 2, 'cooldownMin': 25,
                     'effect': 'field_curse', 'buffKind': 'sap_vigor', 'range': 6,
                     'icon': 'trending_down', 'desc': 'Curse a rival: −3 SPD in their next battle.',
                     'blurb': 'Curse a rival: −3 SPD in their next battle.'},
    'rust_curse':   {'name': 'Rust Curse', 'category': 'field', 'tier': 3, 'cooldownMin': 28,
                     'effect': 'field_curse', 'buffKind': 'rust_curse', 'range': 6,
                     'icon': 'broken_image', 'desc': 'Curse a rival: −4 DEF in their next battle.',
                     'blurb': 'Curse a rival: −4 DEF in their next battle.'},
```

- [ ] **Step 4: Regenerate the client mirror**

Run: `cd infrastructure/lambda && python sync_spells.py`
Expected: prints `wrote .../spells.generated.ts`.

- [ ] **Step 5: Run tests + build to verify they pass**

Run: `cd infrastructure/lambda && python -m pytest tests/test_undercity_spells.py -q`
Expected: PASS (new-spell test + data-integrity + guard all green).
Run (repo root): `npm run build`
Expected: build succeeds.

- [ ] **Step 6: Commit**

```bash
git add infrastructure/lambda/undercity_data.py infrastructure/lambda/tests/test_undercity_spells.py src/app/undercity/data/spells.generated.ts
git commit -m "feat(undercity): 13 new spells across tiers"
```

---

## Task 5: Add the new grimoires + fix the tier-1 count assertion

**Files:**
- Modify: `infrastructure/lambda/undercity_data.py` (`GRIMOIRES` dict)
- Modify: `src/app/undercity/data/spells.generated.ts` (regenerated)
- Test: `infrastructure/lambda/tests/test_undercity_spells.py` (`test_tier1_grimoire_pool_enriched`)

- [ ] **Step 1: Update the failing count assertion**

In `test_undercity_spells.py`, `test_tier1_grimoire_pool_enriched` currently asserts `len(tier1) == 7`. Change it to `8` and add the new book to the checked set:

```python
def test_tier1_grimoire_pool_enriched():
    tier1 = [gid for gid, g in data.GRIMOIRES.items() if g['tier'] == 1]
    assert len(tier1) == 8, tier1
    for gid in ('warcasters_screed', 'hexweavers_codex',
                'nightrunners_ledger', 'tinkers_manual', 'skirmishers_notes'):
        g = data.GRIMOIRES[gid]
        assert g['tier'] == 1 and 1 <= len(g['spells']) <= 3
        for sp in g['spells']:
            assert sp in data.SPELLS
```

- [ ] **Step 2: Run test to verify it fails**

Run: `cd infrastructure/lambda && python -m pytest tests/test_undercity_spells.py::test_tier1_grimoire_pool_enriched -v`
Expected: FAIL — `skirmishers_notes` not defined / count is 7.

- [ ] **Step 3: Add the new grimoires to `GRIMOIRES`**

In `undercity_data.py`, add to the `GRIMOIRES` dict (before the closing `}`). Every book's member spells stay at or below the book's tier:

```python
    # ── Expansion 2026-07-23 books ──
    'skirmishers_notes': {'name': "Skirmisher's Notes", 'tier': 1, 'cost': 32,
                          'spells': ['ember_fleck'],
                          'blurb': 'Hit-and-run scribbles for the light-footed.'},
    'bulwark_breviary': {'name': 'Bulwark Breviary', 'tier': 2, 'cost': 70,
                         'spells': ['iron_hide', 'renewing_bloom'],
                         'blurb': 'Stand firm, then knit what breaks through.'},
    'snipers_folio':    {'name': "Sniper's Folio", 'tier': 2, 'cost': 70,
                         'spells': ['necrotic_lance', 'fleetfoot_draught'],
                         'blurb': 'Reach out and touch them, from across the dark.'},
    'saboteurs_libram': {'name': "Saboteur's Libram", 'tier': 2, 'cost': 70,
                         'spells': ['sap_vigor', 'shadowstep'],
                         'blurb': 'Slow them down, then slip away.'},
    'berserkers_roll':  {'name': "Berserker's Roll", 'tier': 2, 'cost': 72,
                         'spells': ['savage_roar', 'ember_fleck'],
                         'blurb': 'Work yourself into a froth, then swing.'},
    'throneburner_codex': {'name': 'Throneburner Codex', 'tier': 3, 'cost': 150,
                           'spells': ['sear_throne', 'withering_gout', 'rust_curse'],
                           'blurb': 'Rites to unmake thrones and titans alike.'},
    'warding_tome':     {'name': 'Warding Tome', 'tier': 3, 'cost': 150,
                         'spells': ['warding_dance', 'deep_mend'],
                         'blurb': 'Deep wards and deeper mending.'},
```

- [ ] **Step 4: Regenerate the client mirror**

Run: `cd infrastructure/lambda && python sync_spells.py`
Expected: prints `wrote .../spells.generated.ts`.

- [ ] **Step 5: Run tests + build**

Run: `cd infrastructure/lambda && python -m pytest tests -q`
Expected: PASS (`test_every_grimoire_spell_exists`, `test_tier1_grimoire_pool_enriched`, guard all green).
Run (repo root): `npm run build`
Expected: build succeeds.

- [ ] **Step 6: Commit**

```bash
git add infrastructure/lambda/undercity_data.py infrastructure/lambda/tests/test_undercity_spells.py src/app/undercity/data/spells.generated.ts
git commit -m "feat(undercity): six new grimoires bundling the expansion spells"
```

---

## Task 6: End-to-end cast tests (new buff spell + new curse spell)

Prove the whole cast pipeline works with the new data, via a grimoire.

**Files:**
- Test: `infrastructure/lambda/tests/test_undercity_spells.py`

- [ ] **Step 1: Write the failing tests**

Add to `test_undercity_spells.py`. These mirror the existing cast-flow tests (use `give_book`, `act`, and read the target/caster docs back):

```python
def test_cast_savage_roar_buffs_caster(table):
    sid = _sid(table)
    give_book(table, 'swampking', 'berserkers_roll')
    status, body = act(table, 'cast', userKey='swampking',
                       payload={'spellId': 'savage_roar', 'source': 'grimoire'})
    assert status == 200, body
    doc = db._get_player(table, sid, 'swampking')
    assert any(b['kind'] == 'savage_roar' for b in doc['buffs'])
    assert engine.effective_stats(doc)['atk'] == doc['atk'] + 5


def test_cast_rust_curse_debuffs_target(table):
    sid = _sid(table)
    # Two players adjacent so the curse is in range (range 6).
    status, _ = act(table, 'season-join', userKey='mirewitch', hostKey='swampking')
    assert status == 200
    caster = db._get_player(table, sid, 'swampking')
    victim = db._get_player(table, sid, 'mirewitch')
    victim['position'] = caster['position']
    assert db._put_player(table, victim)
    give_book(table, 'swampking', 'throneburner_codex')
    status, body = act(table, 'cast', userKey='swampking',
                       payload={'spellId': 'rust_curse', 'source': 'grimoire',
                                'target': 'mirewitch'})
    assert status == 200, body
    victim = db._get_player(table, sid, 'mirewitch')
    # A dodge still applies no debuff; assert either the buff landed or it was dodged.
    if not body.get('cast', {}).get('dodged'):
        assert any(b['kind'] == 'rust_curse' for b in victim['buffs'])
        assert engine.effective_stats(victim)['def'] == max(1, victim['def'] - 4)
```

Note: if `season-join` needs different arguments in this suite, match the signature used by other multi-player tests in `test_undercity_spells.py` / `test_undercity_db.py` (search for existing `season-join` usage and copy its exact `act(...)` call shape). The dodge chance uses effective SPD; to force determinism you may instead patch `db.random` like the existing dodge tests do (search `FixedRng` usage) — prefer copying an existing curse-cast test's setup verbatim.

- [ ] **Step 2: Run tests to verify they fail (then pass)**

Run: `cd infrastructure/lambda && python -m pytest tests/test_undercity_spells.py -q -k "savage_roar or rust_curse"`
Expected: initially may fail if setup differs — adjust setup to match the existing cast tests until PASS. Both must pass.

- [ ] **Step 3: Run the full spell suite**

Run: `cd infrastructure/lambda && python -m pytest tests/test_undercity_spells.py -q`
Expected: PASS.

- [ ] **Step 4: Commit**

```bash
git add infrastructure/lambda/tests/test_undercity_spells.py
git commit -m "test(undercity): end-to-end casts for new buff + curse spells"
```

---

## Task 7: Refresh the living spell reference

**Files:**
- Modify: `specs/undercity-spells.md`

- [ ] **Step 1: Update status + roadmap**

In `specs/undercity-spells.md`:
- Change the top `**Status:**` line (line 5) to note Phase 1 **and** Phase 2 (scrolls / Sedgemoor Witch) are shipped.
- In the Roadmap table (bottom), change Phase 2 status from "Not built" to "✅ Shipped" and update its description to mention the Sedgemoor Witch (buy-scroll / inscribe).

- [ ] **Step 2: Add the new content to the reference tables**

- Add the 13 new spells to the "Grimoire spells" table (name, tier, effect, range, cooldown) and note the new innate/buff kinds in the effect-kind section.
- Add the 6 new grimoires to "The books" table with their tier/cost/spells and "How to get it" (shop for `skirmishers_notes`; scrolls/phase-3 for the rest).
- In "Effect-kind vocabulary" → the `ONE_BATTLE_BUFFS` line, add the six new kinds (`savage_roar` +5 ATK, `iron_hide` +4 DEF, `fleetfoot` +3 SPD, `warding_dance` +3 DEF/+3 SPD, `sap_vigor` −3 SPD, `rust_curse` −4 DEF).

- [ ] **Step 3: Rewrite the add-a-spell checklist for the codegen flow**

Replace item 4 of the "Adding a spell or grimoire (checklist)" section with the generated-mirror flow:

```markdown
4. The Python entry now carries the client display fields too (`icon`, `desc`).
   Run `python infrastructure/lambda/sync_spells.py` to regenerate
   `src/app/undercity/data/spells.generated.ts` — do NOT hand-edit that file.
   Hand-written logic (types, maps, helpers) stays in `spells.ts`. The
   `test_spells_generated.py` guard fails while the mirror is stale.
```

Also update the "Where everything lives" table row for the client mirror to name both `spells.generated.ts` (data) and `spells.ts` (types + helpers), and note `sync_spells.py`.

- [ ] **Step 4: Verify the doc references are accurate**

Re-read the edited sections; confirm every spell/grimoire id and number matches `undercity_data.py`. No code to run.

- [ ] **Step 5: Commit**

```bash
git add specs/undercity-spells.md
git commit -m "docs(undercity): refresh spell reference for expansion + codegen"
```

---

## Task 8: Final verification

**Files:** none (verification only)

- [ ] **Step 1: Full backend suite**

Run: `cd infrastructure/lambda && python -m pytest tests -q`
Expected: all tests pass, including `test_spells_generated.py` and `test_undercity_spells.py`.

- [ ] **Step 2: Client build**

Run (repo root): `npm run build`
Expected: build succeeds (only pre-existing unrelated warnings).

- [ ] **Step 3: Confirm the mirror is not stale**

Run: `cd infrastructure/lambda && python sync_spells.py && git status --porcelain src/app/undercity/data/spells.generated.ts`
Expected: no output (file already up to date / unchanged).

- [ ] **Step 4: Deploy note**

The new spells/buff kinds live in the Python Lambda. Report to the user that a `cdk deploy` (run by the user) is required before the live client can cast the new spells; the frontend also needs its usual `npm run deploy`. Do not deploy automatically.

---

## Self-review notes

- **Spec coverage:** Part 1 (codegen) → Tasks 1–2; new buff kinds → Task 3; 13 spells → Task 4; grimoires → Task 5; tests → Tasks 1,3,4,5,6 + guard in 2; docs refresh → Task 7; final verification + deploy note → Task 8. All spec sections mapped.
- **Known cross-file assertion:** `test_tier1_grimoire_pool_enriched` (count 7→8) is handled in Task 5 Step 1 before the new book is added.
- **Client type-only cycle** between `spells.ts` and `spells.generated.ts` is intentional and erased at compile — noted in Task 2 Step 3.
- **buffKind/blurb are server-only** — the generator omits them from the client mirror (Task 2 Step 1, `_SPELL_OPTIONAL` + explicit field list).
