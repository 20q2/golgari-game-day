# Undercity Gear Expansion Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Double the Undercity equipment roster from 10 to 20 pieces by adding 8 new gear riders (bold new build archetypes) at the existing tiers, surfaced automatically on the combat stance buttons.

**Architecture:** All combat rules live server-side in `undercity_engine.py` (pure functions); each rider is a `has_rider(...)` branch in `resolve_round`. Gear pieces are data rows in `undercity_data.py` (`GEAR` + `GEAR_RIDERS`) that flow into shops/drops and combatants generically — no wiring. Two client mirrors (`items.ts`, `combat.ts`) drive display; the stance-augment UI is data-driven so no component changes are needed. Interactive combat persists combatant state to DynamoDB between rounds, so new stateful fields must be added to the battle serde.

**Tech Stack:** Python 3.11 (Lambda, pytest), Angular 20 / TypeScript (client mirrors).

**Spec:** [2026-07-20-undercity-gear-expansion-design.md](2026-07-20-undercity-gear-expansion-design.md)

**⚠️ Coordination:** `undercity_data.py`, `undercity_db.py`, and `tests/test_undercity_engine.py` have unrelated in-flight edits in the working tree (a stance-stat-scaling change). Layer onto their current on-disk state; verify insertion points before editing (line numbers below may drift). The swing formula is already `_swing_base` using `STANCE_STAT_WEIGHT`/`STANCE_OFFHAND_ATK_WEIGHT`/`STANCE_SIG_WEIGHT` — do not reintroduce the old formula.

---

## File Structure

**Backend (`infrastructure/lambda/`):**
- `undercity_config.py` — add the `CUTPURSE_SPORES` scalar knob (re-exported into `data.*`).
- `undercity_data.py` — 10 new `GEAR` rows; 8 new `GEAR_RIDERS` rows.
- `undercity_engine.py` — 3 new `Combatant` fields; rider branches in `resolve_round`; a pure `cutpurse_bonus(...)` helper.
- `undercity_db.py` — persist the new fields in `_bt_snapshot`/`_bt_to_combatant`/`_bt_store`; call `cutpurse_bonus` in `_finish_battle`.
- `tests/test_undercity_engine.py` — one test per rider + a serde round-trip test + a data-integrity test.

**Client (`src/app/undercity/data/`):**
- `items.ts` — 10 new `GEAR` rows (mirror).
- `combat.ts` — 8 new `RIDER_AUGMENTS` rows (mirror; drives the stance-button tags).

**Commands:**
- Backend tests: `cd infrastructure/lambda && python -m pytest tests -q`
- Client build: `npm run build` (from repo root)

---

## Task 1: Data rows — GEAR + GEAR_RIDERS + config knob

**Files:**
- Modify: `infrastructure/lambda/undercity_config.py`
- Modify: `infrastructure/lambda/undercity_data.py:156-182` (the `GEAR` and `GEAR_RIDERS` dicts)
- Test: `infrastructure/lambda/tests/test_undercity_engine.py`

- [ ] **Step 1: Write the failing data-integrity test**

Append to `tests/test_undercity_engine.py`:

```python
def test_every_gear_rider_is_defined_and_stanced():
    valid = {'aggress', 'guard', 'feint'}
    for gid, g in data.GEAR.items():
        rider = g.get('rider')
        if rider is None:
            continue
        assert rider in data.GEAR_RIDERS, f"{gid} rider {rider} missing from GEAR_RIDERS"
        assert data.GEAR_RIDERS[rider]['stance'] in valid

def test_gear_roster_doubled():
    assert len(data.GEAR) == 20
    slots = {}
    for g in data.GEAR.values():
        slots[g['slot']] = slots.get(g['slot'], 0) + 1
    assert slots == {'fang': 7, 'carapace': 7, 'charm': 6}
```

- [ ] **Step 2: Run to verify it fails**

Run: `cd infrastructure/lambda && python -m pytest tests/test_undercity_engine.py::test_gear_roster_doubled -q`
Expected: FAIL (len is 10, not 20).

- [ ] **Step 3: Add the config knob**

In `undercity_config.py`, add near the other scalar knobs:

```python
# Cutpurse charm: flat Spores after a won fight in which you landed a Feint.
CUTPURSE_SPORES = 6
```

- [ ] **Step 4: Add the 8 new GEAR_RIDERS rows**

In `undercity_data.py`, extend the `GEAR_RIDERS` dict (keep existing rows):

```python
    # Aggress (fang)
    'bloodfang':  {'stance': 'aggress', 'blurb': 'Heal 40% of the damage your winning Aggress deals.'},
    'rabid':      {'stance': 'aggress', 'blurb': 'Each Aggress you win, your Aggress hits gain +2 for the rest of the fight.'},
    'gutcleaver': {'stance': 'aggress', 'blurb': 'A winning Aggress against a foe below 30% HP deals +50%.'},
    # Guard (carapace)
    'bramble':    {'stance': 'guard',   'blurb': 'Reflect 2 damage whenever you are struck.'},
    'bulwark':    {'stance': 'guard',   'blurb': 'Each round you end in Guard, gain +1 DEF for the rest of the fight.'},
    'mossback':   {'stance': 'guard',   'blurb': 'Heal 3 each round you end in Guard.'},
    # Feint (charm)
    'venomtrick': {'stance': 'feint',   'blurb': 'Winning a Feint applies 1 rot to the foe.'},
    'cutpurse':   {'stance': 'feint',   'blurb': 'Land a winning Feint and pocket +6 Spores after a won fight.'},
```

- [ ] **Step 5: Add the 10 new GEAR rows**

In `undercity_data.py`, extend the `GEAR` dict (keep existing rows). Group under the matching slot comments:

```python
    # Fang — Aggress riders (new)
    'bloodfang':    {'name': 'Bloodfang',    'slot': 'fang', 'tier': 1, 'cost': 25, 'atk': 2, 'rider': 'bloodfang'},
    'rabid_fang':   {'name': 'Rabid Fang',   'slot': 'fang', 'tier': 2, 'cost': 48, 'atk': 3, 'spd': 1, 'rider': 'rabid'},
    'gutcleaver':   {'name': 'Gutcleaver',   'slot': 'fang', 'tier': 2, 'cost': 50, 'atk': 4, 'rider': 'gutcleaver'},
    'ravening_maw': {'name': 'Ravening Maw', 'slot': 'fang', 'tier': 3, 'cost': 85, 'atk': 5, 'spd': 1, 'rider': 'rabid'},
    # Carapace — Guard riders (new)
    'bramble_hide':      {'name': 'Bramble Hide',      'slot': 'carapace', 'tier': 1, 'cost': 25, 'def': 2, 'rider': 'bramble'},
    'bulwark_plate':     {'name': 'Bulwark Plate',     'slot': 'carapace', 'tier': 2, 'cost': 48, 'def': 3, 'maxHp': 3, 'rider': 'bulwark'},
    'mossback':          {'name': 'Mossback',          'slot': 'carapace', 'tier': 2, 'cost': 50, 'def': 3, 'rider': 'mossback'},
    'ironshell_bulwark': {'name': 'Ironshell Bulwark', 'slot': 'carapace', 'tier': 3, 'cost': 85, 'def': 5, 'maxHp': 6, 'rider': 'bulwark'},
    # Charm — Feint riders (new)
    'venom_charm':    {'name': 'Venom Charm',    'slot': 'charm', 'tier': 1, 'cost': 25, 'spd': 1, 'rider': 'venomtrick'},
    'cutpurse_charm': {'name': 'Cutpurse Charm', 'slot': 'charm', 'tier': 2, 'cost': 48, 'spd': 1, 'rider': 'cutpurse'},
```

- [ ] **Step 6: Run the integrity tests**

Run: `cd infrastructure/lambda && python -m pytest tests/test_undercity_engine.py::test_gear_roster_doubled tests/test_undercity_engine.py::test_every_gear_rider_is_defined_and_stanced -q`
Expected: PASS (2 passed).

- [ ] **Step 7: Commit**

```bash
git add infrastructure/lambda/undercity_config.py infrastructure/lambda/undercity_data.py infrastructure/lambda/tests/test_undercity_engine.py
git commit -m "feat(undercity): add 10 new gear pieces + 8 rider definitions"
```

---

## Task 2: Combatant fields + battle serde persistence

New riders need per-battle state that survives interactive combat's round-to-round DynamoDB serde: `aggress_ramp` (rabid), `feint_won` (cutpurse). Bulwark mutates `dfn` directly, so `dfn` must persist in `_bt_store`.

**Files:**
- Modify: `infrastructure/lambda/undercity_engine.py:17-37` (`Combatant` dataclass)
- Modify: `infrastructure/lambda/undercity_db.py:307-342` (`_bt_snapshot`, `_bt_to_combatant`, `_bt_store`)
- Test: `infrastructure/lambda/tests/test_undercity_engine.py`

- [ ] **Step 1: Write the failing serde round-trip test**

Append to `tests/test_undercity_engine.py` (import the db helpers at the top of the file if not already imported: `import undercity_db as db`):

```python
def test_battle_serde_persists_new_fields():
    c = fighter(atk=6, dfn=5)
    c.aggress_ramp = 4
    c.feint_won = True
    c.dfn = 9  # bulwark bumped it mid-fight
    snap = db._bt_snapshot(c)
    back = db._bt_to_combatant(snap)
    assert back.aggress_ramp == 4
    assert back.feint_won is True
    # _bt_store writes the live dfn back into the snapshot each round
    c2 = db._bt_to_combatant(snap)
    c2.dfn = 12
    db._bt_store(c2, snap)
    assert snap['dfn'] == 12
```

- [ ] **Step 2: Run to verify it fails**

Run: `cd infrastructure/lambda && python -m pytest tests/test_undercity_engine.py::test_battle_serde_persists_new_fields -q`
Expected: FAIL (`Combatant` has no `aggress_ramp`).

- [ ] **Step 3: Add the Combatant fields**

In `undercity_engine.py`, inside the `Combatant` dataclass, alongside the other internal battle-state fields (after `struck_yet`):

```python
    aggress_ramp: int = field(default=0, repr=False)   # rabid: +dmg to Aggress, stacks
    feint_won: bool = field(default=False, repr=False)  # cutpurse: landed a winning Feint
```

- [ ] **Step 4: Persist the fields in the db serde**

In `undercity_db.py` `_bt_snapshot`, add to the returned dict:

```python
        'aggress_ramp': int(c.aggress_ramp), 'feint_won': bool(c.feint_won),
```

In `_bt_to_combatant`, after `c.reveal_next = ...`:

```python
    c.aggress_ramp = int(s.get('aggress_ramp', 0))
    c.feint_won = bool(s.get('feint_won', False))
```

In `_bt_store`, add so mid-fight mutations survive:

```python
    rec_side['dfn'] = int(c.dfn)
    rec_side['aggress_ramp'] = int(c.aggress_ramp)
    rec_side['feint_won'] = bool(c.feint_won)
```

- [ ] **Step 5: Run to verify it passes**

Run: `cd infrastructure/lambda && python -m pytest tests/test_undercity_engine.py::test_battle_serde_persists_new_fields -q`
Expected: PASS.

- [ ] **Step 6: Commit**

```bash
git add infrastructure/lambda/undercity_engine.py infrastructure/lambda/undercity_db.py infrastructure/lambda/tests/test_undercity_engine.py
git commit -m "feat(undercity): persist rabid/cutpurse/bulwark battle state across rounds"
```

---

## Task 3: Bloodfang rider (Aggress lifesteal)

**Files:**
- Modify: `infrastructure/lambda/undercity_engine.py` (decisive-win branch, `resolve_round`, ~line 236-242 where the winning hit is dealt)
- Test: `infrastructure/lambda/tests/test_undercity_engine.py`

- [ ] **Step 1: Write the failing test**

```python
def test_bloodfang_heals_on_aggress_win():
    a = fighter(atk=10, dfn=5, hp=20, max_hp=40, riders=frozenset({'bloodfang'}))
    d = fighter(atk=10, dfn=4, hp=60, max_hp=60)
    resolve_round(a, d, 'aggress', 'feint', 1, FakeRng(uniform=1.0))  # a's Aggress wins
    assert a.hp > 20  # healed off the winning hit
```

- [ ] **Step 2: Run to verify it fails**

Run: `cd infrastructure/lambda && python -m pytest tests/test_undercity_engine.py::test_bloodfang_heals_on_aggress_win -q`
Expected: FAIL (`a.hp == 20`).

- [ ] **Step 3: Implement**

In `resolve_round`, in the decisive-win `else` branch, inside the `if dmg > 0:` block that logs the winning hit, extend the heal alongside the existing `drain_life` heal:

```python
                if winr.has('drain_life'):
                    heal = round(dmg * 0.5)
                    winr.hp = min(winr.max_hp, winr.hp + heal); entry['heal'] = heal
                elif win_stance == 'aggress' and winr.has_rider('bloodfang'):
                    heal = round(dmg * 0.4)
                    winr.hp = min(winr.max_hp, winr.hp + heal); entry['heal'] = heal
```

(`elif` so a creature with both doesn't double-dip; drain_life already covers all stances.)

- [ ] **Step 4: Run to verify it passes**

Run: `cd infrastructure/lambda && python -m pytest tests/test_undercity_engine.py::test_bloodfang_heals_on_aggress_win -q`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add infrastructure/lambda/undercity_engine.py infrastructure/lambda/tests/test_undercity_engine.py
git commit -m "feat(undercity): bloodfang rider — heal off winning Aggress"
```

---

## Task 4: Rabid rider (Aggress damage ramp)

**Files:**
- Modify: `infrastructure/lambda/undercity_engine.py:114-123` (`_swing_base`) and the decisive-win branch
- Test: `infrastructure/lambda/tests/test_undercity_engine.py`

- [ ] **Step 1: Write the failing test**

```python
def test_rabid_ramps_aggress_damage_each_win():
    a = fighter(atk=10, dfn=5, hp=30, max_hp=30, riders=frozenset({'rabid'}))
    d = fighter(atk=10, dfn=4, hp=200, max_hp=200)
    resolve_round(a, d, 'aggress', 'feint', 1, FakeRng(uniform=1.0))  # win 1
    hp_after_1 = d.hp
    dmg1 = 200 - hp_after_1
    assert a.aggress_ramp == 2  # one stack gained
    resolve_round(a, d, 'aggress', 'feint', 2, FakeRng(uniform=1.0))  # win 2
    dmg2 = hp_after_1 - d.hp
    assert dmg2 > dmg1  # the ramp made the second win hit harder
    assert a.aggress_ramp == 4
```

- [ ] **Step 2: Run to verify it fails**

Run: `cd infrastructure/lambda && python -m pytest tests/test_undercity_engine.py::test_rabid_ramps_aggress_damage_each_win -q`
Expected: FAIL (no `aggress_ramp` accumulation / no damage change).

- [ ] **Step 3: Implement the ramp in the swing**

In `_swing_base`, add the ramp to the Aggress branch:

```python
def _swing_base(striker: 'Combatant', stance: str) -> float:
    if stance == 'aggress':
        # Aggress double-dips on ATK; rabid adds a flat, stacking ramp.
        return striker.atk * (1 + data.STANCE_STAT_WEIGHT) + striker.aggress_ramp
    sig = getattr(striker, _STANCE_STAT[stance])
    return data.STANCE_OFFHAND_ATK_WEIGHT * striker.atk + data.STANCE_SIG_WEIGHT * sig
```

- [ ] **Step 4: Implement the stack gain**

In `resolve_round`, in the decisive-win `else` branch, after `winr.first_win_used = True` handling (before/after the dmg is applied — placement doesn't affect this round's hit because the ramp is read in `_base_hit` at the top of the branch via `raw`). Add, at the end of the winning-hit handling for that branch:

```python
            if win_stance == 'aggress' and winr.has_rider('rabid'):
                winr.aggress_ramp += 2
```

Note: the increment happens after `raw = _base_hit(...)` is computed for this round, so the new stack applies to the NEXT Aggress win — matching the test (win 1 gains the stack; win 2 hits harder).

- [ ] **Step 5: Run to verify it passes**

Run: `cd infrastructure/lambda && python -m pytest tests/test_undercity_engine.py::test_rabid_ramps_aggress_damage_each_win -q`
Expected: PASS.

- [ ] **Step 6: Commit**

```bash
git add infrastructure/lambda/undercity_engine.py infrastructure/lambda/tests/test_undercity_engine.py
git commit -m "feat(undercity): rabid rider — stacking Aggress damage ramp"
```

---

## Task 5: Gutcleaver rider (Aggress execute)

**Files:**
- Modify: `infrastructure/lambda/undercity_engine.py` (decisive-win `else` branch, where `mult` is built ~line 220-229)
- Test: `infrastructure/lambda/tests/test_undercity_engine.py`

- [ ] **Step 1: Write the failing test**

```python
def test_gutcleaver_executes_low_hp_foe():
    # Baseline: full-HP target takes the normal winning hit.
    a1 = fighter(atk=10, dfn=5, riders=frozenset({'gutcleaver'}))
    d_full = fighter(atk=10, dfn=4, hp=100, max_hp=100)
    resolve_round(a1, d_full, 'aggress', 'feint', 1, FakeRng(uniform=1.0))
    base_dmg = 100 - d_full.hp
    # Low-HP target (<30%) takes +50%.
    a2 = fighter(atk=10, dfn=5, riders=frozenset({'gutcleaver'}))
    d_low = fighter(atk=10, dfn=4, hp=20, max_hp=100)  # 20% HP
    resolve_round(a2, d_low, 'aggress', 'feint', 1, FakeRng(uniform=1.0))
    exec_dmg = 20 - d_low.hp
    assert exec_dmg > base_dmg
```

- [ ] **Step 2: Run to verify it fails**

Run: `cd infrastructure/lambda && python -m pytest tests/test_undercity_engine.py::test_gutcleaver_executes_low_hp_foe -q`
Expected: FAIL (equal damage).

- [ ] **Step 3: Implement**

In `resolve_round`, in the decisive-win `else` branch, where `mult` is assembled (after the `deep_biter` bump), add:

```python
            if (win_stance == 'aggress' and winr.has_rider('gutcleaver')
                    and losr.max_hp and losr.hp / losr.max_hp < 0.30):
                mult += 0.5
```

- [ ] **Step 4: Run to verify it passes**

Run: `cd infrastructure/lambda && python -m pytest tests/test_undercity_engine.py::test_gutcleaver_executes_low_hp_foe -q`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add infrastructure/lambda/undercity_engine.py infrastructure/lambda/tests/test_undercity_engine.py
git commit -m "feat(undercity): gutcleaver rider — execute low-HP foes on Aggress"
```

---

## Task 6: Bramble rider (reflect when struck)

Bramble reflects a flat amount whenever its bearer takes an actual strike. Implement it in `_deal` (the single choke point for strike damage) so it covers every strike path, but NOT rot/frenzy (those call `entries.append` directly, not `_deal`, so environmental damage never reflects).

**Files:**
- Modify: `infrastructure/lambda/undercity_engine.py:140-153` (`_deal`) and `infrastructure/lambda/undercity_data.py` (a `BRAMBLE_REFLECT` knob, or reuse a literal)
- Test: `infrastructure/lambda/tests/test_undercity_engine.py`

- [ ] **Step 1: Write the failing test**

```python
def test_bramble_reflects_when_struck():
    a = fighter(atk=10, dfn=5, hp=30, max_hp=30)                       # aggressor
    d = fighter(atk=10, dfn=5, hp=40, max_hp=40, riders=frozenset({'bramble'}))
    resolve_round(a, d, 'aggress', 'feint', 1, FakeRng(uniform=1.0))   # a strikes d
    assert a.hp == 30 - 2   # d reflected 2 back onto the striker
```

- [ ] **Step 2: Run to verify it fails**

Run: `cd infrastructure/lambda && python -m pytest tests/test_undercity_engine.py::test_bramble_reflects_when_struck -q`
Expected: FAIL (`a.hp == 30`).

- [ ] **Step 3: Add the knob**

In `undercity_config.py`:

```python
BRAMBLE_REFLECT = 2  # flat damage a Bramble carapace reflects when struck
```

- [ ] **Step 4: Implement in `_deal`**

In `_deal`, after `target.hp -= dmg` and the entry is built, before the `drain_life` block, add:

```python
    if target.has_rider('bramble') and striker.hp > 0:
        striker.hp -= data.BRAMBLE_REFLECT
        entries.append({'round': rnd, 'by': side, 'dmg': data.BRAMBLE_REFLECT,
                        'retaliation': True})
```

Note: `side` in `_deal` is the striker's side, so the reflect entry is attributed to the struck defender's counter — matches the existing `retaliation` convention used by `_scavenge`. (`side` there is the dealer; the reflect is logged under the same `by` for animation symmetry with scavenge — confirm the client renders `retaliation` entries generically, which it does via `entryHasEffect`.)

- [ ] **Step 5: Run to verify it passes**

Run: `cd infrastructure/lambda && python -m pytest tests/test_undercity_engine.py::test_bramble_reflects_when_struck -q`
Expected: PASS.

- [ ] **Step 6: Commit**

```bash
git add infrastructure/lambda/undercity_engine.py infrastructure/lambda/undercity_config.py infrastructure/lambda/tests/test_undercity_engine.py
git commit -m "feat(undercity): bramble rider — reflect damage when struck"
```

---

## Task 7: Bulwark rider (stacking Guard DEF)

**Files:**
- Modify: `infrastructure/lambda/undercity_engine.py` (end-of-round section in `resolve_round`, after the rot tick / before or after the collapse — a per-side stance check)
- Test: `infrastructure/lambda/tests/test_undercity_engine.py`

- [ ] **Step 1: Write the failing test**

```python
def test_bulwark_fortifies_each_guard_round():
    a = fighter(atk=8, dfn=5, hp=40, max_hp=40, riders=frozenset({'bulwark'}))
    d = fighter(atk=8, dfn=5, hp=40, max_hp=40)
    resolve_round(a, d, 'guard', 'guard', 1, FakeRng(uniform=1.0))  # a ends in Guard
    assert a.dfn == 6   # +1 DEF
    resolve_round(a, d, 'guard', 'feint', 2, FakeRng(uniform=1.0))  # a ends in Guard again
    assert a.dfn == 7
    resolve_round(a, d, 'aggress', 'guard', 3, FakeRng(uniform=1.0))  # a NOT in Guard
    assert a.dfn == 7   # no change
```

- [ ] **Step 2: Run to verify it fails**

Run: `cd infrastructure/lambda && python -m pytest tests/test_undercity_engine.py::test_bulwark_fortifies_each_guard_round -q`
Expected: FAIL (`a.dfn == 5`).

- [ ] **Step 3: Implement**

In `resolve_round`, near the end (after the rot tick loop, before the `return entries` / collapse is fine — collapse reads max_hp not dfn), add a per-side end-of-round hook:

```python
    # Bulwark: ending a round in Guard fortifies DEF for the rest of the fight.
    for side, c, st in (('attacker', attacker, a_stance),
                        ('defender', defender, d_stance)):
        if st == 'guard' and c.has_rider('bulwark') and c.hp > 0:
            c.dfn += 1
```

- [ ] **Step 4: Run to verify it passes**

Run: `cd infrastructure/lambda && python -m pytest tests/test_undercity_engine.py::test_bulwark_fortifies_each_guard_round -q`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add infrastructure/lambda/undercity_engine.py infrastructure/lambda/tests/test_undercity_engine.py
git commit -m "feat(undercity): bulwark rider — stacking Guard DEF"
```

---

## Task 8: Mossback rider (Guard regen)

**Files:**
- Modify: `infrastructure/lambda/undercity_engine.py` (end-of-round section, beside Bulwark)
- Test: `infrastructure/lambda/tests/test_undercity_engine.py`

- [ ] **Step 1: Write the failing test**

```python
def test_mossback_heals_each_guard_round():
    a = fighter(atk=8, dfn=6, hp=20, max_hp=40, riders=frozenset({'mossback'}))
    d = fighter(atk=8, dfn=6, hp=40, max_hp=40)
    resolve_round(a, d, 'guard', 'guard', 1, FakeRng(uniform=1.0))  # stall, no dmg; a Guards
    assert a.hp == 23   # +3 regen
    # Does not overheal past max.
    a.hp = 39
    resolve_round(a, d, 'guard', 'guard', 2, FakeRng(uniform=1.0))
    assert a.hp == 40
```

- [ ] **Step 2: Run to verify it fails**

Run: `cd infrastructure/lambda && python -m pytest tests/test_undercity_engine.py::test_mossback_heals_each_guard_round -q`
Expected: FAIL (`a.hp == 20`).

- [ ] **Step 3: Implement**

In the same end-of-round per-side loop area, add (a separate loop or fold into Bulwark's loop):

```python
    # Mossback: ending a round in Guard knits a little flesh back.
    for side, c, st in (('attacker', attacker, a_stance),
                        ('defender', defender, d_stance)):
        if st == 'guard' and c.has_rider('mossback') and 0 < c.hp < c.max_hp:
            heal = min(3, c.max_hp - c.hp)
            c.hp += heal
            entries.append({'round': rnd, 'by': side, 'heal': heal})
```

- [ ] **Step 4: Run to verify it passes**

Run: `cd infrastructure/lambda && python -m pytest tests/test_undercity_engine.py::test_mossback_heals_each_guard_round -q`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add infrastructure/lambda/undercity_engine.py infrastructure/lambda/tests/test_undercity_engine.py
git commit -m "feat(undercity): mossback rider — regen while Guarding"
```

---

## Task 9: Venomtrick rider (rot on Feint win) + cutpurse feint flag

Both live in the winning-Feint block. Venomtrick applies rot; the same block flips `feint_won` (used by Cutpurse in Task 10).

**Files:**
- Modify: `infrastructure/lambda/undercity_engine.py` (winning-Feint block, ~line 244-248, and the rot-apply section ~311-315)
- Test: `infrastructure/lambda/tests/test_undercity_engine.py`

- [ ] **Step 1: Write the failing tests**

```python
def test_venomtrick_applies_rot_on_feint_win():
    a = fighter(atk=10, dfn=5, hp=30, max_hp=30, riders=frozenset({'venomtrick'}))
    d = fighter(atk=10, dfn=5, hp=60, max_hp=60)
    resolve_round(a, d, 'feint', 'guard', 1, FakeRng(uniform=1.0))  # a's Feint wins
    assert d.rot_stacks == 1

def test_feint_win_sets_feint_won_flag():
    a = fighter(atk=10, dfn=5, hp=30, max_hp=30)
    d = fighter(atk=10, dfn=5, hp=60, max_hp=60)
    resolve_round(a, d, 'feint', 'guard', 1, FakeRng(uniform=1.0))  # a's Feint wins
    assert a.feint_won is True
    assert d.feint_won is False
```

- [ ] **Step 2: Run to verify they fail**

Run: `cd infrastructure/lambda && python -m pytest tests/test_undercity_engine.py::test_venomtrick_applies_rot_on_feint_win tests/test_undercity_engine.py::test_feint_win_sets_feint_won_flag -q`
Expected: FAIL.

- [ ] **Step 3: Implement**

In `resolve_round`, in the `if win_stance == 'feint':` block (alongside `serrated`/`glint`), add:

```python
                winr.feint_won = True
                if winr.has_rider('venomtrick') and losr.hp > 0:
                    losr.rot_stacks += 1
                    entries.append({'round': rnd, 'by': win_side, 'rotApplied': 1})
```

- [ ] **Step 4: Run to verify they pass**

Run: `cd infrastructure/lambda && python -m pytest tests/test_undercity_engine.py::test_venomtrick_applies_rot_on_feint_win tests/test_undercity_engine.py::test_feint_win_sets_feint_won_flag -q`
Expected: PASS (2 passed).

- [ ] **Step 5: Commit**

```bash
git add infrastructure/lambda/undercity_engine.py infrastructure/lambda/tests/test_undercity_engine.py
git commit -m "feat(undercity): venomtrick rider + feint-won flag"
```

---

## Task 10: Cutpurse payout (post-fight Spore bonus)

A pure helper computes the bonus; `_finish_battle` applies it on a win. Unit-testing the helper avoids the FakeTable harness.

**Files:**
- Modify: `infrastructure/lambda/undercity_db.py` (add `cutpurse_bonus` helper; call it in `_finish_battle:2082-2101`)
- Test: `infrastructure/lambda/tests/test_undercity_engine.py`

- [ ] **Step 1: Write the failing test**

```python
def test_cutpurse_bonus_only_on_feint_win_and_victory():
    doc = {'gear': {'charm': 'cutpurse_charm'}}
    assert db.cutpurse_bonus(doc, feint_won=True, won=True) == data.CUTPURSE_SPORES
    assert db.cutpurse_bonus(doc, feint_won=False, won=True) == 0   # never landed a Feint
    assert db.cutpurse_bonus(doc, feint_won=True, won=False) == 0   # lost the fight
    assert db.cutpurse_bonus({'gear': {}}, feint_won=True, won=True) == 0  # no charm
```

- [ ] **Step 2: Run to verify it fails**

Run: `cd infrastructure/lambda && python -m pytest tests/test_undercity_engine.py::test_cutpurse_bonus_only_on_feint_win_and_victory -q`
Expected: FAIL (`db has no attribute cutpurse_bonus`).

- [ ] **Step 3: Implement the helper**

In `undercity_db.py`, near `_roll_gear_drop`:

```python
def cutpurse_bonus(doc, feint_won, won):
    """Flat Spores a Cutpurse charm pays after a won fight in which the player
    landed a winning Feint. Static — does not scale with the number of Feints."""
    if not (won and feint_won):
        return 0
    if 'cutpurse' not in _riders(doc):
        return 0
    return data.CUTPURSE_SPORES
```

- [ ] **Step 4: Wire it into `_finish_battle`**

In `_finish_battle`, after the per-kind finisher returns `out` and before `_save_or_conflict`:

```python
    bonus = cutpurse_bonus(doc, rec['player'].get('feint_won', False),
                           result['outcome'] == 'attacker')
    if bonus:
        doc['spores'] = doc.get('spores', 0) + bonus
        out['spores'] = out.get('spores', 0) + bonus
        out['cutpurse'] = bonus  # client can flag the pickpocket bonus if desired
```

- [ ] **Step 5: Run to verify it passes**

Run: `cd infrastructure/lambda && python -m pytest tests/test_undercity_engine.py::test_cutpurse_bonus_only_on_feint_win_and_victory -q`
Expected: PASS.

- [ ] **Step 6: Commit**

```bash
git add infrastructure/lambda/undercity_db.py infrastructure/lambda/tests/test_undercity_engine.py
git commit -m "feat(undercity): cutpurse charm — flat Spore bonus after a Feint win"
```

---

## Task 11: Full backend suite green

- [ ] **Step 1: Run the whole suite**

Run: `cd infrastructure/lambda && python -m pytest tests -q`
Expected: PASS (all green, including `test_balance_good_play_beats_fodder` and `test_all_battle_specs_have_valid_personality`).

- [ ] **Step 2: If `test_balance_good_play_beats_fodder` regressed**

It should not — new riders only fire when gear is equipped, and the balance test uses bare creatures. If it fails, a rider branch is firing unconditionally; re-check the `has_rider(...)` guards. Do not retune balance numbers to paper over it.

- [ ] **Step 3: Commit (only if any fixups were needed)**

```bash
git add -A infrastructure/lambda
git commit -m "test(undercity): gear expansion suite green"
```

---

## Task 12: Client mirrors — items.ts + combat.ts

**Files:**
- Modify: `src/app/undercity/data/items.ts:20-41` (the `GEAR` array)
- Modify: `src/app/undercity/data/combat.ts` (`RIDER_AUGMENTS` and `PASSIVE_AUGMENTS` were added in the augment feature; extend `RIDER_AUGMENTS`)

- [ ] **Step 1: Add the 10 new GEAR rows to items.ts**

Append to the `GEAR: GearInfo[]` array (mirror the backend stats/costs; `desc` follows the existing "±stat · Rider: blurb" format):

```typescript
  { id: 'bloodfang', name: 'Bloodfang', slot: 'fang', tier: 1, cost: 25, rider: 'bloodfang', atk: 2,
    desc: '+2 ATK · Bloodfang: heal 40% of your winning Aggress damage.' },
  { id: 'rabid_fang', name: 'Rabid Fang', slot: 'fang', tier: 2, cost: 48, rider: 'rabid', atk: 3, spd: 1,
    desc: '+3 ATK, +1 SPD · Rabid: each Aggress win, your Aggress hits gain +2 for the fight.' },
  { id: 'gutcleaver', name: 'Gutcleaver', slot: 'fang', tier: 2, cost: 50, rider: 'gutcleaver', atk: 4,
    desc: '+4 ATK · Gutcleaver: winning Aggress vs a foe below 30% HP deals +50%.' },
  { id: 'ravening_maw', name: 'Ravening Maw', slot: 'fang', tier: 3, cost: 85, rider: 'rabid', atk: 5, spd: 1,
    desc: '+5 ATK, +1 SPD · Rabid: each Aggress win, your Aggress hits gain +2 for the fight.' },
  { id: 'bramble_hide', name: 'Bramble Hide', slot: 'carapace', tier: 1, cost: 25, rider: 'bramble', def: 2,
    desc: '+2 DEF · Bramble: reflect 2 damage whenever you are struck.' },
  { id: 'bulwark_plate', name: 'Bulwark Plate', slot: 'carapace', tier: 2, cost: 48, rider: 'bulwark', def: 3, maxHp: 3,
    desc: '+3 DEF, +3 max HP · Bulwark: each round you Guard, +1 DEF for the fight.' },
  { id: 'mossback', name: 'Mossback', slot: 'carapace', tier: 2, cost: 50, rider: 'mossback', def: 3,
    desc: '+3 DEF · Mossback: heal 3 each round you end in Guard.' },
  { id: 'ironshell_bulwark', name: 'Ironshell Bulwark', slot: 'carapace', tier: 3, cost: 85, rider: 'bulwark', def: 5, maxHp: 6,
    desc: '+5 DEF, +6 max HP · Bulwark: each round you Guard, +1 DEF for the fight.' },
  { id: 'venom_charm', name: 'Venom Charm', slot: 'charm', tier: 1, cost: 25, rider: 'venomtrick', spd: 1,
    desc: '+1 SPD · Venomtrick: winning a Feint applies 1 rot.' },
  { id: 'cutpurse_charm', name: 'Cutpurse Charm', slot: 'charm', tier: 2, cost: 48, rider: 'cutpurse', spd: 1,
    desc: '+1 SPD · Cutpurse: land a winning Feint for +6 Spores after a win.' },
```

- [ ] **Step 2: Add the 8 new RIDER_AUGMENTS rows to combat.ts**

Extend the `RIDER_AUGMENTS` record (keep existing rows):

```typescript
  bloodfang: { stance: 'aggress', label: 'Bloodfang', blurb: 'Heal 40% of your winning Aggress damage.' },
  rabid: { stance: 'aggress', label: 'Rabid', blurb: 'Each Aggress win, your Aggress hits gain +2 for the fight.' },
  gutcleaver: { stance: 'aggress', label: 'Gutcleaver', blurb: 'Winning Aggress vs a foe below 30% HP deals +50%.' },
  bramble: { stance: 'guard', label: 'Bramble', blurb: 'Reflect 2 damage whenever you are struck.' },
  bulwark: { stance: 'guard', label: 'Bulwark', blurb: 'Each round you Guard, +1 DEF for the fight.' },
  mossback: { stance: 'guard', label: 'Mossback', blurb: 'Heal 3 each round you end in Guard.' },
  venomtrick: { stance: 'feint', label: 'Venomtrick', blurb: 'Winning a Feint applies 1 rot.' },
  cutpurse: { stance: 'feint', label: 'Cutpurse', blurb: 'Land a winning Feint for +6 Spores after a win.' },
```

- [ ] **Step 3: Build**

Run: `npm run build`
Expected: clean compile (pre-existing unrelated warnings only).

- [ ] **Step 4: Commit**

```bash
git add src/app/undercity/data/items.ts src/app/undercity/data/combat.ts
git commit -m "feat(undercity): mirror 10 new gear pieces + rider augments client-side"
```

---

## Task 13: Manual verification

- [ ] **Step 1: Sanity-check in the running app**

Run `npm start`, enter the Undercity, equip one new piece per slot (via a shop or debug), and start a battle. Confirm:
- The rider tag shows on the correct stance button (gold pill for the gear rider).
- The tooltip lists the augment blurb.
- The effect fires (e.g., Bloodfang heals on an Aggress win; Bulwark's DEF climbs across Guard rounds; Cutpurse pays out on a win after a Feint).

- [ ] **Step 2: Note completion**

Report tests green + build clean + manual check done. A deploy (CDK for the Lambda + `npm run deploy` for the client) is left to the user.

---

## Self-Review Notes

- **Spec coverage:** all 8 riders (bloodfang, rabid, gutcleaver, bramble, bulwark, mossback, venomtrick, cutpurse) have a task; all 10 gear pieces are in Task 1 + Task 12; Cutpurse's two-layer design is Task 9 (flag) + Task 10 (payout). Shop/drop placement needs no task — `_gen_shop_stock`/`_roll_gear_drop` enumerate `data.GEAR` generically.
- **Serde:** Task 2 covers the round-to-round persistence the ramps require — a real bug if skipped (ramps would reset each interactive round).
- **Balance invariant:** Task 11 guards `test_balance_good_play_beats_fodder`.
- **Naming consistency:** field names `aggress_ramp`/`feint_won`, rider ids, and gear ids match across engine, db, tests, and both client mirrors.
