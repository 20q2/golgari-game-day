# Hybrid Equipment Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add a three-piece tier-2 off-ladder "hybrid" gear line that trades the rider effect for stats split across two perk attributes, so one piece can bridge two attribute-perk nodes at once.

**Architecture:** Pure data addition. Three no-rider entries in `GEAR` (`undercity_data.py`) flow through the existing generic systems — `engine.effective_stats`, `engine.perk_stat`, `_buy`, bazaar stock, and `_roll_gear_drop` — with zero new wiring, exactly like the existing Vital carapaces. Mirror the entries into the client display catalogue.

**Tech Stack:** Python 3.11 Lambda + pytest (backend rules/tests); Angular 20 / TypeScript (client display mirror).

**Spec:** [2026-07-23-undercity-hybrid-gear-design.md](2026-07-23-undercity-hybrid-gear-design.md)

---

## File Structure

- **Modify** `infrastructure/lambda/undercity_data.py` — add a `# Hybrid line` block of 3 entries to the `GEAR` dict (after the Vital line, before the Charm/Illuminating blocks or at the end of the tier-≤3 section — placement is cosmetic).
- **Create** `infrastructure/lambda/tests/test_undercity_hybrid_gear.py` — focused test of the three pieces' shape and their perk-bridging behavior.
- **Modify** `src/app/undercity/data/items.ts` — add the 3 mirror entries to the `GEAR` array (display only; no test runner for TS — verified by `npm run build`).

The three pieces (from the spec):

| id | Name | Slot | Stats | Cost |
|---|---|---|---|---|
| `duelist_fang` | Duelist Fang | fang | atk 3 · spd 2 | 46 |
| `warbrand_plate` | Warbrand Plate | carapace | def 3 · atk 2 | 46 |
| `wardens_charm` | Warden's Charm | charm | spd 2 · def 2 | 46 |

---

## Task 1: Backend GEAR entries + perk-bridging test

**Files:**
- Create: `infrastructure/lambda/tests/test_undercity_hybrid_gear.py`
- Modify: `infrastructure/lambda/undercity_data.py` (the `GEAR` dict, ends at line ~315)

- [ ] **Step 1: Write the failing test**

Create `infrastructure/lambda/tests/test_undercity_hybrid_gear.py`:

```python
"""Hybrid gear line: two-stat, no-rider, off-ladder (design 2026-07-23)."""
import sys
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parents[1]))

import pytest  # noqa: E402

import undercity_data as data  # noqa: E402
import undercity_engine as engine  # noqa: E402

HYBRIDS = ('duelist_fang', 'warbrand_plate', 'wardens_charm')

# Expected stat blocks — the two-stat split per the design table.
EXPECTED = {
    'duelist_fang':  {'slot': 'fang',     'atk': 3, 'spd': 2},
    'warbrand_plate':{'slot': 'carapace', 'def': 3, 'atk': 2},
    'wardens_charm': {'slot': 'charm',    'spd': 2, 'def': 2},
}


@pytest.mark.parametrize('gid', HYBRIDS)
def test_hybrid_piece_exists_tier2_no_rider(gid):
    g = data.GEAR[gid]
    assert g['tier'] == 2
    assert g['cost'] == 46
    assert 'rider' not in g          # the whole point: no rider
    assert g['slot'] == EXPECTED[gid]['slot']


@pytest.mark.parametrize('gid', HYBRIDS)
def test_hybrid_piece_has_exactly_two_perk_stats(gid):
    g = data.GEAR[gid]
    present = [s for s in ('atk', 'def', 'spd') if g.get(s, 0) > 0]
    assert len(present) == 2, f'{gid} should carry exactly two perk stats'
    for stat in present:
        assert g[stat] == EXPECTED[gid][stat]


@pytest.mark.parametrize('gid', HYBRIDS)
def test_hybrid_not_in_gear_family(gid):
    # No rider => absent from every rider family => not forge/Mythic upgradable.
    for rider, rungs in data.GEAR_FAMILY.items():
        assert gid not in rungs.values()


def test_hybrid_bridges_two_perk_tracks():
    # A creature just under two thresholds: base atk 9, base def 11.
    # warbrand_plate (def 3, atk 2) lifts def to 14 (>=12 -> carapace_grind)
    # while atk 11 stays short of 12 (no menace). perk_stat sums base+gear.
    player = {'atk': 9, 'def': 11, 'spd': 1,
              'gear': {'carapace': 'warbrand_plate'}}
    assert engine.perk_stat(player, 'def') == 14
    assert engine.perk_stat(player, 'atk') == 11
    perks = engine.attribute_perks(player)
    assert 'carapace_grind' in perks       # DEF-12 lit by base+gear
    assert 'menace' not in perks           # ATK still short of 12


def test_hybrid_can_light_two_nodes_at_once():
    # base atk 10 / def 10 + warbrand_plate (def 3, atk 2) -> atk 12, def 13.
    player = {'atk': 10, 'def': 10, 'spd': 1,
              'gear': {'carapace': 'warbrand_plate'}}
    perks = engine.attribute_perks(player)
    assert 'menace' in perks               # ATK 12
    assert 'carapace_grind' in perks       # DEF 13
```

- [ ] **Step 2: Run the test to verify it fails**

Run: `cd infrastructure/lambda && python -m pytest tests/test_undercity_hybrid_gear.py -q`
Expected: FAIL — `KeyError: 'duelist_fang'` (and the other ids) because the `GEAR` entries don't exist yet.

- [ ] **Step 3: Add the GEAR entries**

In `infrastructure/lambda/undercity_data.py`, inside the `GEAR` dict, add this block immediately after the Vital line (`leviathan_hide`, ~line 265):

```python
    # ── Hybrid line (tier 2) — two-stat, no rider. Off-ladder like Vital/
    # Illuminating: trade the rider for stats split across two PERK attributes
    # so one piece can bridge two perk nodes (perk_stat sums equipped gear).
    # Each sits on the slot matching its PRIMARY stat. Design 2026-07-23.
    'duelist_fang':   {'name': 'Duelist Fang',   'slot': 'fang',     'tier': 2, 'cost': 46, 'atk': 3, 'spd': 2},
    'warbrand_plate': {'name': 'Warbrand Plate', 'slot': 'carapace', 'tier': 2, 'cost': 46, 'def': 3, 'atk': 2},
    'wardens_charm':  {'name': "Warden's Charm",  'slot': 'charm',    'tier': 2, 'cost': 46, 'spd': 2, 'def': 2},
```

- [ ] **Step 4: Run the test to verify it passes**

Run: `cd infrastructure/lambda && python -m pytest tests/test_undercity_hybrid_gear.py -q`
Expected: PASS (7 tests: 3×parametrized shape + 3×parametrized family + 2 perk-bridge — actually 3+3+3+2 = 11 with parametrization).

- [ ] **Step 5: Run the full backend suite to confirm nothing regressed**

Run: `cd infrastructure/lambda && python -m pytest tests -q`
Expected: PASS (whole suite green — the new pieces join tier-2 shop/drop pools automatically; existing gear-drop and gear-scaling tests must still pass).

- [ ] **Step 6: Commit**

```bash
git add infrastructure/lambda/undercity_data.py infrastructure/lambda/tests/test_undercity_hybrid_gear.py
git commit -m "feat(undercity): hybrid gear line — two-stat, no-rider tier-2 pieces

Duelist Fang / Warbrand Plate / Warden's Charm: trade the rider for
stats split across two perk attributes, so one piece can bridge two
attribute-perk nodes. Off-ladder like Vital; joins tier-2 shop+drop
pools with no new wiring.

Co-Authored-By: Claude Opus 4.8 (1M context) <noreply@anthropic.com>"
```

---

## Task 2: Client display mirror

**Files:**
- Modify: `src/app/undercity/data/items.ts` (the `GEAR: GearInfo[]` array; Vital entries at ~line 88-93)

- [ ] **Step 1: Add the mirror entries**

In `src/app/undercity/data/items.ts`, add these three objects to the `GEAR` array immediately after the `leviathan_hide` entry (~line 93). Match the existing formatting (a trailing `desc` line). `rider` is omitted — these are plain stat gear:

```typescript
  // Hybrid line (tier 2): two-stat, no rider — mirrors undercity_data.py.
  { id: 'duelist_fang', name: 'Duelist Fang', slot: 'fang', tier: 2, cost: 46, atk: 3, spd: 2,
    desc: '+3 ATK, +2 SPD. No rider — split stats bridge the Aggress and Feint tracks.' },
  { id: 'warbrand_plate', name: 'Warbrand Plate', slot: 'carapace', tier: 2, cost: 46, def: 3, atk: 2,
    desc: '+3 DEF, +2 ATK. No rider — split stats bridge the Guard and Aggress tracks.' },
  { id: 'wardens_charm', name: "Warden's Charm", slot: 'charm', tier: 2, cost: 46, spd: 2, def: 2,
    desc: '+2 SPD, +2 DEF. No rider — split stats bridge the Feint and Guard tracks.' },
```

- [ ] **Step 2: Verify the client build compiles**

Run: `npm run build`
Expected: build succeeds (no TypeScript errors). This is the verification step — there is no TS test runner in this repo (`ng test` is not wired up; see CLAUDE.md).

- [ ] **Step 3: Commit**

```bash
git add src/app/undercity/data/items.ts
git commit -m "feat(undercity): mirror hybrid gear line into client catalogue

Co-Authored-By: Claude Opus 4.8 (1M context) <noreply@anthropic.com>"
```

---

## Notes for the implementer

- **Do not** add a `rider` key, a `GEAR_RIDERS` entry, a `RIDER_SCALE` value, or a `resolve_round` branch — hybrids are deliberately rider-less. If you feel the urge to give them an effect, re-read the spec's "Out of scope" section.
- **Do not** add tier-1, tier-3, or tier-4/Mythic hybrid variants. This pass is the tier-2 trio only.
- The pieces reach players automatically: bazaar stock (`undercity_db` stock builder, `by_tier` grouping) and drops (`_roll_gear_drop`, slot+tier `rng.choice`) both filter only on `slot`+`tier`. No shop/drop table edits needed.
- Do not commit unrelated working-tree changes — this repo has parallel WIP; stage only the files each task names.

## Self-review notes

- **Spec coverage:** three pieces (Task 1 data + Task 2 mirror), no-rider/off-ladder (asserted in `test_hybrid_piece_exists_tier2_no_rider` + `test_hybrid_not_in_gear_family`), perk-bridging (`test_hybrid_bridges_two_perk_tracks`, `test_hybrid_can_light_two_nodes_at_once`), shop+drops automatic (implementer note, no code), tests green (Step 5). All spec sections mapped.
- **Placeholders:** none — all code shown in full.
- **Type consistency:** ids `duelist_fang`/`warbrand_plate`/`wardens_charm`, stat blocks, and cost 46 are identical across the test, the Python entries, and the TS mirror.
