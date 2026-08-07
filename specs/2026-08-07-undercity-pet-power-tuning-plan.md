# Pet Power Tuning — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Make same-species merges worth +50% rarity progress, and turn attack/defend pets into identical mirror stat-pets (10→66% chance, flat 2→8) with attack dealing flat bonus damage instead of a % of the hit.

**Architecture:** Reshape `PET_COMBAT` to one symmetric per-level form; rename the engine's attack multiplier field to a flat integer and apply it flat; add a same-species ×1.5 (ceil) bonus in `_merge_pet`; mirror all of it in the client display tables. Server authoritative; client mirrors for preview only.

**Tech Stack:** Python 3.11 Lambda (pytest + in-memory `FakeTable`), Angular 20 signals (no test runner — verify with `npm run build`).

**Reference spec:** [specs/2026-08-07-undercity-pet-power-tuning-design.md](2026-08-07-undercity-pet-power-tuning-design.md)

**Backend tests from** `infrastructure/lambda/`: `python -m pytest tests -q` (~49–51 pre-existing WIP failures in map/deep-dungeon/engine/spells are unrelated; keep the companions + engine pet tests green).

---

## File structure

| File | Responsibility | Change |
|------|----------------|--------|
| `infrastructure/lambda/undercity_data.py` | `PET_COMBAT` symmetric table | Modify |
| `infrastructure/lambda/undercity_engine.py` | `pet_combat()`, Combatant field, flat follow-up application | Modify |
| `infrastructure/lambda/undercity_db.py` | `_combatant` + battle serialize/deserialize field rename; `_merge_pet` same-species bonus | Modify |
| `infrastructure/lambda/tests/test_undercity_engine.py` | fix `fighter(...)` follow-up tests + add symmetric-scaling test | Modify |
| `infrastructure/lambda/tests/test_undercity_companions.py` | merge-bonus tests; fix same-species assertions | Modify |
| `src/app/undercity/data/pets.ts` | mirror `PET_COMBAT`, `petAbilityStats`, `mergePointsFor` | Modify |
| `src/app/undercity/tabs/creature-tab.component.ts` | merge preview passes keeper species | Modify |

Task 1 (combat rework) and Task 2 (merge bonus) are independent; do 1 then 2. Task 3 (client) after both.

---

## Task 1: Attack/defend → identical mirror stat-pets

**Files:** Modify `undercity_data.py`, `undercity_engine.py`, `undercity_db.py`, `tests/test_undercity_engine.py`

- [ ] **Step 1: Rewrite the pet-combat scaling test + add a precise symmetric test**

In `tests/test_undercity_engine.py`, replace `test_pet_combat_attack_scales_with_level` (currently ~1721–1727):

```python
def test_pet_combat_attack_scales_with_level():
    from undercity_engine import pet_combat
    lo = pet_combat({'species': 'baby_leyline_prowler', 'tier': 1, 'level': 1})
    hi = pet_combat({'species': 'baby_leyline_prowler', 'tier': 2, 'level': 4})
    assert lo['followup_chance'] > 0
    assert hi['followup_chance'] > lo['followup_chance']
    assert lo['deflect_chance'] == 0 and lo['deflect_flat'] == 0
```

with:

```python
def test_pet_combat_attack_scales_with_level():
    from undercity_engine import pet_combat
    lo = pet_combat({'species': 'baby_leyline_prowler', 'tier': 1, 'level': 1})
    hi = pet_combat({'species': 'baby_leyline_prowler', 'tier': 2, 'level': 4})
    assert lo['followup_chance'] > 0
    assert hi['followup_chance'] > lo['followup_chance']
    assert lo['deflect_chance'] == 0 and lo['deflect_flat'] == 0


def test_pet_combat_symmetric_scaling():
    from undercity_engine import pet_combat
    a1 = pet_combat({'species': 'baby_leyline_prowler', 'tier': 1, 'level': 1})  # attack
    a9 = pet_combat({'species': 'baby_leyline_prowler', 'tier': 4, 'level': 9})
    assert abs(a1['followup_chance'] - 0.10) < 1e-9 and a1['followup_flat'] == 2
    assert abs(a9['followup_chance'] - 0.66) < 1e-9 and a9['followup_flat'] == 8
    assert 'followup_mult' not in a9                     # multiplier is gone
    d9 = pet_combat({'species': 'decimator_beetle', 'tier': 4, 'level': 9})  # defend
    assert abs(d9['deflect_chance'] - 0.66) < 1e-9 and d9['deflect_flat'] == 8
```

- [ ] **Step 2: Fix the two follow-up application tests to use the flat field**

In the same file, change `test_attack_followup_adds_extra_hit_on_trigger` (~1740–1747):

```python
    a = fighter(atk=15, pet_followup_chance=1.0, pet_followup_mult=0.5)
    d = fighter(hp=100, max_hp=100, dfn=4)
    rng = FakeRng(randoms=[0.0], uniform=1.0)   # 0.0 < 1.0 -> follow-up fires
    entries = resolve_round(a, d, 'aggress', 'feint', 1, rng)
    pet_hits = [e for e in entries if e.get('pet') == 'attack']
    assert len(pet_hits) == 1 and pet_hits[0]['dmg'] >= 1
```

to (flat field + exact damage):

```python
    a = fighter(atk=15, pet_followup_chance=1.0, pet_followup_flat=5)
    d = fighter(hp=100, max_hp=100, dfn=4)
    rng = FakeRng(randoms=[0.0], uniform=1.0)   # 0.0 < 1.0 -> follow-up fires
    entries = resolve_round(a, d, 'aggress', 'feint', 1, rng)
    pet_hits = [e for e in entries if e.get('pet') == 'attack']
    assert len(pet_hits) == 1 and pet_hits[0]['dmg'] == 5
```

And in `test_attack_followup_skipped_when_roll_high` (~1751) change the fighter kwarg:

```python
    a = fighter(atk=15, pet_followup_chance=0.2, pet_followup_mult=0.5)
```

to:

```python
    a = fighter(atk=15, pet_followup_chance=0.2, pet_followup_flat=5)
```

- [ ] **Step 3: Run the tests to confirm they fail**

Run: `python -m pytest tests/test_undercity_engine.py -q -k "pet_combat or followup"`
Expected: FAIL — `pet_combat` still returns `followup_mult` / lacks `followup_flat`, and `Combatant` rejects the `pet_followup_flat` kwarg.

- [ ] **Step 4: Reshape `PET_COMBAT`**

In `undercity_data.py` replace (currently ~1845–1850):

```python
PET_COMBAT = {
    'attack': {'followup_chance_base': 0.10, 'followup_chance_per_lvl': 0.03,
               'followup_mult': 0.30},
    'defend': {'deflect_chance_base': 0.12, 'deflect_chance_per_lvl': 0.03,
               'deflect_flat_base': 2, 'deflect_flat_per_lvl': 0.34},
}
```

with the symmetric form (chance 10→66% at L9, flat 2→8 at L9, identical for both):

```python
PET_COMBAT = {
    'attack': {'chance_base': 0.10, 'chance_per_lvl': 0.07,
               'flat_base': 2, 'flat_per_lvl': 0.75},
    'defend': {'chance_base': 0.10, 'chance_per_lvl': 0.07,
               'flat_base': 2, 'flat_per_lvl': 0.75},
}
```

- [ ] **Step 5: Rewrite `pet_combat()`**

In `undercity_engine.py` replace `pet_combat` (currently ~899–919):

```python
def pet_combat(pet: dict, level_bonus: int = 0) -> dict:
    """Derive an active pet's combat contribution by ROLE: an 'attack' pet adds a
    follow-up hit, a 'defend' pet deflects, both scaled by level. `level_bonus`
    (a Gorgon owner's Stonewright edge) makes the pet fight as if that many levels
    higher. Non-combat role / None -> all zeros."""
    out = {'followup_chance': 0.0, 'followup_mult': 0.0,
           'deflect_chance': 0.0, 'deflect_flat': 0}
    if not pet:
        return out
    role = data.pet_role(pet.get('species'))
    cfg = data.PET_COMBAT.get(role)
    if not cfg:
        return out
    lvl = int(pet.get('level', 1)) + level_bonus
    if role == 'attack':
        out['followup_chance'] = cfg['followup_chance_base'] + cfg['followup_chance_per_lvl'] * (lvl - 1)
        out['followup_mult'] = cfg['followup_mult']
    elif role == 'defend':
        out['deflect_chance'] = cfg['deflect_chance_base'] + cfg['deflect_chance_per_lvl'] * (lvl - 1)
        out['deflect_flat'] = int(cfg['deflect_flat_base'] + cfg['deflect_flat_per_lvl'] * (lvl - 1))
    return out
```

with:

```python
def pet_combat(pet: dict, level_bonus: int = 0) -> dict:
    """Derive an active pet's combat contribution by ROLE. Attack and defend are
    symmetric: a scaling % chance to apply a scaling flat magnitude — attack deals
    it as bonus damage on a decisive win, defend blocks it on a decisive loss.
    `level_bonus` (a Gorgon owner's Stonewright edge) makes the pet fight as if
    that many levels higher. Non-combat role / None -> all zeros."""
    out = {'followup_chance': 0.0, 'followup_flat': 0,
           'deflect_chance': 0.0, 'deflect_flat': 0}
    if not pet:
        return out
    role = data.pet_role(pet.get('species'))
    cfg = data.PET_COMBAT.get(role)
    if not cfg:
        return out
    lvl = int(pet.get('level', 1)) + level_bonus
    chance = cfg['chance_base'] + cfg['chance_per_lvl'] * (lvl - 1)
    flat = int(cfg['flat_base'] + cfg['flat_per_lvl'] * (lvl - 1))
    if role == 'attack':
        out['followup_chance'] = chance
        out['followup_flat'] = flat
    elif role == 'defend':
        out['deflect_chance'] = chance
        out['deflect_flat'] = flat
    return out
```

- [ ] **Step 6: Rename the Combatant field + apply the follow-up flat**

In `undercity_engine.py`, the `Combatant` field (currently ~47):

```python
    pet_followup_mult: float = field(default=0.0, repr=False)
```

→

```python
    pet_followup_flat: int = field(default=0, repr=False)
```

And the attack application (currently ~345):

```python
                    extra = max(1, round(dmg * winr.pet_followup_mult))
```

→

```python
                    extra = max(1, winr.pet_followup_flat)
```

(The surrounding trigger — `if winr.pet_followup_chance and losr.hp > 0 and rng.random() < winr.pet_followup_chance:` — is unchanged. Defend's application at ~327–331 is unchanged in shape; only its magnitudes grow via the new config.)

- [ ] **Step 7: Update the db combatant build + battle serialize/deserialize**

In `undercity_db.py` `_combatant` (currently ~634):

```python
        pet_followup_chance=pc['followup_chance'], pet_followup_mult=pc['followup_mult'],
```

→

```python
        pet_followup_chance=pc['followup_chance'], pet_followup_flat=pc['followup_flat'],
```

In the serialize dict (currently ~667):

```python
        'pet_followup_mult': float(c.pet_followup_mult),
```

→

```python
        'pet_followup_flat': int(c.pet_followup_flat),
```

In `_bt_to_combatant` (currently ~685):

```python
        pet_followup_mult=float(s.get('pet_followup_mult', 0.0)),
```

→

```python
        pet_followup_flat=int(s.get('pet_followup_flat', 0)),
```

- [ ] **Step 8: Run the pet-combat + follow-up tests**

Run: `python -m pytest tests/test_undercity_engine.py -q -k "pet_combat or followup or deflect"`
Expected: PASS (symmetric scaling, flat follow-up == 5, skip-when-high, existing deflect test).

- [ ] **Step 9: Run the companions combat-flow test**

Run: `python -m pytest tests/test_undercity_companions.py -q -k "combat_pet or flows_into"`
Expected: PASS (`test_active_combat_pet_flows_into_combatant` still holds — it only checks `pet_followup_chance`).

- [ ] **Step 10: Commit**

```bash
git add infrastructure/lambda/undercity_data.py infrastructure/lambda/undercity_engine.py infrastructure/lambda/undercity_db.py infrastructure/lambda/tests/test_undercity_engine.py
git commit -m "feat(undercity): attack/defend pets become symmetric stat-pets (flat, 10->66%)"
```

---

## Task 2: Same-species merge bonus (+50%)

**Files:** Modify `infrastructure/lambda/undercity_db.py` (`_merge_pet`); `tests/test_undercity_companions.py`

- [ ] **Step 1: Add the bonus tests + fix existing same-species assertions**

In `tests/test_undercity_companions.py`, add two new tests:

```python
def test_merge_same_species_bonus_points(table):
    # Same-species Common fodder = ceil(1*1.5) = 2 pts -> ranks a Common keeper
    # straight into Rare (cost to T2 is 2).
    sid, doc = _player_at(table, 'n1')
    k = _give_pet(doc, 'baby_leyline_prowler', tier=1)
    f = _give_pet(doc, 'baby_leyline_prowler', tier=1)
    status, _ = db._merge_pet(table, sid, doc, {'targetPetId': k['id'], 'fodderPetIds': [f['id']]})
    assert status == 200 and k['tier'] == 2 and k['mergeProgress'] == 0


def test_merge_offspecies_no_bonus(table):
    # Different-species Common fodder = 1 pt -> not enough to reach Rare (cost 2).
    sid, doc = _player_at(table, 'n1')
    k = _give_pet(doc, 'baby_leyline_prowler', tier=1)
    f = _give_pet(doc, 'decimator_beetle', tier=1)
    status, _ = db._merge_pet(table, sid, doc, {'targetPetId': k['id'], 'fodderPetIds': [f['id']]})
    assert status == 200 and k['tier'] == 1 and k['mergeProgress'] == 1
```

Then update the two existing tests whose math the bonus changes:

`test_merge_same_species_ranks_up` — two same-species Commons now give 2×2 = 4 pts (into T2 costs 2 → tier 2, remainder 2, not enough for T3 which costs 3). Replace its assertions:

```python
    assert status == 200
    assert keeper['tier'] == 2
    assert keeper['mergeProgress'] == 0
    assert [p['id'] for p in doc['pets']] == [keeper['id']]
```

with:

```python
    assert status == 200
    assert keeper['tier'] == 2
    assert keeper['mergeProgress'] == 2          # 4 pts − 2 (into Rare); T3 costs 3
    assert [p['id'] for p in doc['pets']] == [keeper['id']]
```

`test_merge_partial_progress_carries` wants a *partial, no-rank-up* result; with the bonus a same-species Common would rank up, so switch its fodder to a different species (1 flat point). Replace:

```python
    keeper = _give_pet(doc, 'baby_leyline_prowler', tier=1)
    f1 = _give_pet(doc, 'baby_leyline_prowler', tier=1)
    status, _ = db._merge_pet(table, sid, doc, {
        'targetPetId': keeper['id'], 'fodderPetIds': [f1['id']]})
    assert status == 200
    assert keeper['tier'] == 1 and keeper['mergeProgress'] == 1
```

with:

```python
    keeper = _give_pet(doc, 'baby_leyline_prowler', tier=1)
    f1 = _give_pet(doc, 'decimator_beetle', tier=1)   # off-species = 1 flat pt (no bonus)
    status, _ = db._merge_pet(table, sid, doc, {
        'targetPetId': keeper['id'], 'fodderPetIds': [f1['id']]})
    assert status == 200
    assert keeper['tier'] == 1 and keeper['mergeProgress'] == 1
```

- [ ] **Step 2: Run to confirm the new tests fail**

Run: `python -m pytest tests/test_undercity_companions.py -q -k "same_species_bonus or offspecies_no_bonus"`
Expected: FAIL — `test_merge_same_species_bonus_points` gets tier 1 / progress 1 (no bonus yet).

- [ ] **Step 3: Add the same-species bonus in `_merge_pet`**

In `undercity_db.py` `_merge_pet`, replace the `gained` line:

```python
    gained = sum(data.PET_MERGE_POINTS[p['tier']] for p in fodder)
```

with a per-fodder computation that gives same-species fodder ×1.5 (integer ceil, no `math` import needed):

```python
    def _fodder_points(f):
        pts = data.PET_MERGE_POINTS[f['tier']]
        if f['species'] == target['species']:      # same-species duplicate bonus (+50%, ceil)
            pts = (pts * 3 + 1) // 2
        return pts
    gained = sum(_fodder_points(f) for f in fodder)
```

Also update the comment just above it from "flat by fodder tier, ANY species" to note the same-species bonus:

```python
    # Award merge points: flat by fodder tier for any species, +50% (ceil) when the
    # fodder matches the keeper's species. Then advance tiers while affordable.
```

- [ ] **Step 4: Run the merge tests**

Run: `python -m pytest tests/test_undercity_companions.py -q`
Expected: PASS (new bonus tests, updated same-species/partial tests, and the untouched `test_merge_cross_species_ranks_up` / active-pointer tests).

- [ ] **Step 5: Commit**

```bash
git add infrastructure/lambda/undercity_db.py infrastructure/lambda/tests/test_undercity_companions.py
git commit -m "feat(undercity): same-species merge gives +50% rarity progress"
```

---

## Task 3: Client mirrors (display + merge preview)

**Files:** Modify `src/app/undercity/data/pets.ts`, `src/app/undercity/tabs/creature-tab.component.ts`

- [ ] **Step 1: Mirror the new `PET_COMBAT` shape**

In `pets.ts` replace (currently ~206–209):

```typescript
export const PET_COMBAT = {
  attack: { followupChanceBase: 0.1, followupChancePerLvl: 0.03, followupMult: 0.3 },
  defend: { deflectChanceBase: 0.12, deflectChancePerLvl: 0.03, deflectFlatBase: 2, deflectFlatPerLvl: 0.34 },
} as const;
```

with:

```typescript
export const PET_COMBAT = {
  attack: { chanceBase: 0.1, chancePerLvl: 0.07, flatBase: 2, flatPerLvl: 0.75 },
  defend: { chanceBase: 0.1, chancePerLvl: 0.07, flatBase: 2, flatPerLvl: 0.75 },
} as const;
```

- [ ] **Step 2: Update the attack/defend ability stat lines**

In `pets.ts` `petAbilityStats`, replace the `attack` and `defend` cases (currently ~265–278):

```typescript
    case 'attack': {
      const c = PET_COMBAT.attack;
      return [
        { label: 'Follow-up chance', value: pct(c.followupChanceBase + c.followupChancePerLvl * (lvl - 1)) },
        { label: 'Follow-up damage', value: `${pct(c.followupMult)} of the hit` },
      ];
    }
    case 'defend': {
      const c = PET_COMBAT.defend;
      return [
        { label: 'Deflect chance', value: pct(c.deflectChanceBase + c.deflectChancePerLvl * (lvl - 1)) },
        { label: 'Damage blocked', value: `${Math.floor(c.deflectFlatBase + c.deflectFlatPerLvl * (lvl - 1))}` },
      ];
    }
```

with:

```typescript
    case 'attack': {
      const c = PET_COMBAT.attack;
      return [
        { label: 'Strike chance', value: pct(c.chanceBase + c.chancePerLvl * (lvl - 1)) },
        { label: 'Bonus damage', value: `${Math.floor(c.flatBase + c.flatPerLvl * (lvl - 1))}` },
      ];
    }
    case 'defend': {
      const c = PET_COMBAT.defend;
      return [
        { label: 'Deflect chance', value: pct(c.chanceBase + c.chancePerLvl * (lvl - 1)) },
        { label: 'Damage blocked', value: `${Math.floor(c.flatBase + c.flatPerLvl * (lvl - 1))}` },
      ];
    }
```

- [ ] **Step 3: Teach `mergePointsFor` the same-species bonus**

In `pets.ts` replace `mergePointsFor` and `mergeWouldRankUp` (currently ~346–355):

```typescript
export function mergePointsFor(fodder: Pet[]): number {
  return fodder.reduce((sum, f) => sum + (PET_MERGE_POINTS[f.tier] ?? 0), 0);
}

/** Would feeding `fodder` into `target` complete the next tier? */
export function mergeWouldRankUp(target: Pet, fodder: Pet[]): boolean {
  if (atMaxTier(target)) return false;
  const need = PET_MERGE_COST[target.tier + 1] ?? Infinity;
  return target.mergeProgress + mergePointsFor(fodder) >= need;
}
```

with:

```typescript
/** Merge points from `fodder`. When `keeperSpecies` is given, fodder of that same
 *  species is worth +50% (ceil) — mirrors the server's same-species bonus. */
export function mergePointsFor(fodder: Pet[], keeperSpecies?: PetSpecies): number {
  return fodder.reduce((sum, f) => {
    let pts = PET_MERGE_POINTS[f.tier] ?? 0;
    if (keeperSpecies && f.species === keeperSpecies) pts = Math.ceil(pts * 1.5);
    return sum + pts;
  }, 0);
}

/** Would feeding `fodder` into `target` complete the next tier? */
export function mergeWouldRankUp(target: Pet, fodder: Pet[]): boolean {
  if (atMaxTier(target)) return false;
  const need = PET_MERGE_COST[target.tier + 1] ?? Infinity;
  return target.mergeProgress + mergePointsFor(fodder, target.species) >= need;
}
```

- [ ] **Step 4: Pass the keeper species into the merge preview**

In `creature-tab.component.ts` `mergeState`, the `points` line currently reads:

```typescript
      points: keeper.mergeProgress + mergePointsFor(selected),
```

Change it to include the keeper species so the preview bar reflects the bonus:

```typescript
      points: keeper.mergeProgress + mergePointsFor(selected, keeper.species),
```

- [ ] **Step 5: Build**

Run: `npm run build`
Expected: build succeeds. If any other caller referenced the old `PET_COMBAT` keys (`followupMult`, `deflectFlatBase`, …), the compile error names it — `git grep -n "followupMult\|followupChanceBase\|deflectFlatBase\|deflectChanceBase"` should return nothing after this task.

- [ ] **Step 6: Commit**

```bash
git add src/app/undercity/data/pets.ts src/app/undercity/tabs/creature-tab.component.ts
git commit -m "feat(undercity): mirror stat-pet combat + same-species merge preview"
```

---

## Final verification

- [ ] Engine + companions green: `cd infrastructure/lambda && python -m pytest tests/test_undercity_engine.py tests/test_undercity_companions.py -q`
- [ ] Full backend suite adds no new failures beyond the known ~49–51 WIP ones.
- [ ] Frontend compiles: `npm run build`
- [ ] Mirror check: `PET_COMBAT` numbers match server (`chance_base 0.10 / per_lvl 0.07`, `flat_base 2 / per_lvl 0.75`) in `undercity_data.py` and `pets.ts`.
- [ ] No stragglers: `git grep -n "pet_followup_mult\|followupMult"` returns nothing.
- [ ] Manual (optional, `run-undercity`): a level-9 attack pet's card reads "Strike chance 66% / Bonus damage 8"; a same-species duplicate in the merge popup fills the progress bar faster than an off-species one.

**Deploy:** the user runs the deploy (`cdk deploy` for the Lambda — combat + merge are server-authoritative — and `npm run deploy` for the site). End with tests green and note a deploy is needed for both.

---

## Self-review notes

- **Spec coverage:** same-species +50% ceil (Task 2 `_fodder_points` + tests), symmetric stat-pets 10→66% / 2→8 (Task 1 `PET_COMBAT` + `pet_combat` + tests), attack flat-not-multiplier (Task 1 field rename + application + `test_pet_combat_symmetric_scaling` asserting `followup_flat`), client mirrors + merge preview (Task 3). All spec sections map to a task.
- **Type/name consistency:** server keys `chance_base/chance_per_lvl/flat_base/flat_per_lvl`; engine `followup_flat`/`deflect_flat` + Combatant `pet_followup_flat`; client `chanceBase/chancePerLvl/flatBase/flatPerLvl`; `mergePointsFor(fodder, keeperSpecies?)` used consistently by `mergeWouldRankUp` and `creature-tab`. The integer ceil `(pts*3+1)//2` (server) and `Math.ceil(pts*1.5)` (client) agree for all point values (1→2, 3→5, 7→11, 15→23).
- **Breakage handled:** the field rename breaks two `fighter(...pet_followup_mult=)` engine tests (fixed in Task 1 Step 2); the merge bonus breaks `test_merge_same_species_ranks_up` and `test_merge_partial_progress_carries` (fixed in Task 2 Step 1).
- **No placeholders:** every code step shows full before/after; the only conditional step (Task 3 Step 5 grep) specifies the exact fix path.
