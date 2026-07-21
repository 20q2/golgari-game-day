# Undercity Attribute Perk Tracks + Guard/DEF Fix — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Give ATK/DEF/SPD threshold perks (nodes at 5/10/15) that grant identity outside the damage race, and fix Guard/DEF by delivering its combat conversion as the DEF-10 perk *Carapace Grind* — validated in the sim at `GUARD_CHIP_COEFF ≈ 0.5`.

**Architecture:** Perks are *derived* from the invested base stat (`doc['atk'/'def'/'spd']`), never stored and never from gear/buffs — so no save migration. A pure `engine.attribute_perks(doc)` computes the unlocked set; combat perks ride on the `Combatant` (new `perks` frozenset) so `resolve_round` sees them; roll/traversal perks are read in `db._roll`/`_move`; hazard/mystery perks in their db handlers. Scalars live in `undercity_config.py`, perk defs in `undercity_data.py`, mirrored to `src/app/undercity/data/perks.ts`.

**Tech Stack:** Python 3.11 engine (pure functions + DynamoDB dispatcher), pytest (`infrastructure/lambda/tests`), Angular 20 standalone client. Backend is TDD; the frontend has **no test runner** (per CLAUDE.md) — client tasks are verified by `npm run build`.

**Phases:** (1) Foundation, (2) Guard/DEF fix + combat perks, (3) SPD traversal roll perks, (4) data/config/state surfacing, (5) client. Each phase leaves the suite green and the game playable.

**Design source:** [2026-07-21-undercity-attribute-perks-design.md](2026-07-21-undercity-attribute-perks-design.md). Sim validation: `infrastructure/lambda/sim/proto_fix.py`.

**Commands:** run tests with `cd infrastructure/lambda && python -m pytest tests -q`; build client with `npm run build`.

---

## Phase 1 — Foundation: `attribute_perks` + Combatant plumbing

### Task 1: `engine.attribute_perks(doc)` derives the unlocked perk set

**Files:**
- Modify: `infrastructure/lambda/undercity_data.py` (add `PERK_TRACKS`)
- Modify: `infrastructure/lambda/undercity_engine.py` (add `attribute_perks`)
- Test: `infrastructure/lambda/tests/test_undercity_perks.py` (new)

- [ ] **Step 1: Write the failing test**

```python
# tests/test_undercity_perks.py
import sys
from pathlib import Path
sys.path.insert(0, str(Path(__file__).resolve().parents[1]))
import undercity_engine as engine


def _doc(atk=1, dfn=1, spd=1):
    return {'atk': atk, 'def': dfn, 'spd': spd}


def test_no_perks_below_first_threshold():
    assert engine.attribute_perks(_doc(4, 4, 4)) == frozenset()


def test_thresholds_unlock_in_order():
    assert engine.attribute_perks(_doc(atk=5)) == frozenset({'rend'})
    assert engine.attribute_perks(_doc(atk=10)) == frozenset({'rend', 'menace'})
    assert engine.attribute_perks(_doc(atk=15)) == frozenset({'rend', 'menace', 'deathdrive'})


def test_base_stat_lights_tier1_across_tracks():
    # saproling base def 7 -> thick_hide; kraul base atk 8 -> rend; spd 7 -> fleetfoot
    assert 'thick_hide' in engine.attribute_perks(_doc(dfn=7))
    assert 'rend' in engine.attribute_perks(_doc(atk=8))
    assert 'fleetfoot' in engine.attribute_perks(_doc(spd=7))


def test_all_three_tracks_independent():
    perks = engine.attribute_perks(_doc(atk=10, dfn=15, spd=5))
    assert perks == frozenset({'rend', 'menace', 'thick_hide', 'carapace_grind', 'last_stand', 'fleetfoot'})
```

- [ ] **Step 2: Run test to verify it fails**

Run: `python -m pytest tests/test_undercity_perks.py -q`
Expected: FAIL — `AttributeError: module 'undercity_engine' has no attribute 'attribute_perks'`

- [ ] **Step 3: Add `PERK_TRACKS` to `undercity_data.py`**

Add near the other creature tables (after `ALL_FORMS`):

```python
# ── Attribute perk tracks (design 2026-07-21) ────────────────────────────────
# A perk unlocks when the INVESTED base stat (species base + level spends +
# evolution bonuses; NOT gear/buffs) reaches its threshold. Client mirror:
# src/app/undercity/data/perks.ts
PERK_TRACKS = {
    'atk': [(5, 'rend'), (10, 'menace'), (15, 'deathdrive')],
    'def': [(5, 'thick_hide'), (10, 'carapace_grind'), (15, 'last_stand')],
    'spd': [(5, 'fleetfoot'), (10, 'pathfinder'), (15, 'blink')],
}

PERKS = {
    'rend':          {'name': 'Rend', 'track': 'atk', 'threshold': 5,
                      'blurb': 'A winning Aggress always applies 1 rot.'},
    'menace':        {'name': 'Menace', 'track': 'atk', 'threshold': 10,
                      'blurb': 'Enemies bluff you less often.'},
    'deathdrive':    {'name': 'Deathdrive', 'track': 'atk', 'threshold': 15,
                      'blurb': 'Below half HP, your Aggress swings hit harder.'},
    'thick_hide':    {'name': 'Thick Hide', 'track': 'def', 'threshold': 5,
                      'blurb': 'Halve HP lost to hazards and bad mystery rolls.'},
    'carapace_grind':{'name': 'Carapace Grind', 'track': 'def', 'threshold': 10,
                      'blurb': 'Holding Guard grinds the foe down even when you don’t win the exchange.'},
    'last_stand':    {'name': 'Last Stand', 'track': 'def', 'threshold': 15,
                      'blurb': 'Survive one lethal blow per descent at 1 HP.'},
    'fleetfoot':     {'name': 'Fleetfoot', 'track': 'spd', 'threshold': 5,
                      'blurb': 'You may reroll a die that shows 1.'},
    'pathfinder':    {'name': 'Pathfinder', 'track': 'spd', 'threshold': 10,
                      'blurb': 'Roll with advantage — roll two dice, keep either.'},
    'blink':         {'name': 'Blink', 'track': 'spd', 'threshold': 15,
                      'blurb': 'Once per turn, choose your die value.'},
}
```

- [ ] **Step 4: Add `attribute_perks` to `undercity_engine.py`**

Add after `effective_stats` (it must key off the raw doc stats, not effective):

```python
def attribute_perks(player: dict) -> frozenset:
    """Perks unlocked by INVESTED attributes (base + spends + evolution bonuses).
    Reads doc['atk'/'def'/'spd'] directly — gear/buffs never light a perk, so the
    set is stable across gear swaps and needs no persistence."""
    out = set()
    for stat, tiers in data.PERK_TRACKS.items():
        val = player.get(stat, 0)
        for threshold, pid in tiers:
            if val >= threshold:
                out.add(pid)
    return frozenset(out)
```

- [ ] **Step 5: Run test to verify it passes**

Run: `python -m pytest tests/test_undercity_perks.py -q`
Expected: PASS (4 tests)

- [ ] **Step 6: Commit**

```bash
git add infrastructure/lambda/undercity_data.py infrastructure/lambda/undercity_engine.py infrastructure/lambda/tests/test_undercity_perks.py
git commit -m "feat(undercity): attribute_perks helper + perk tables"
```

---

### Task 2: Combatant carries `perks`; `_combatant` populates it

**Files:**
- Modify: `infrastructure/lambda/undercity_engine.py` (Combatant dataclass + `has_perk`)
- Modify: `infrastructure/lambda/undercity_db.py` (`_combatant`, `_bt_snapshot`, `_bt_to_combatant`)
- Test: `infrastructure/lambda/tests/test_undercity_perks.py`

- [ ] **Step 1: Write the failing test**

```python
def test_combatant_carries_perks_and_survives_serde():
    import undercity_db as db
    doc = {'username': 'x', 'hp': 30, 'maxHp': 30, 'atk': 15, 'def': 5, 'spd': 5,
           'stance': 'fight'}
    c = db._combatant(doc)
    assert c.has_perk('rend') and c.has_perk('deathdrive')
    assert not c.has_perk('carapace_grind')
    # round-trips through the battle-record snapshot
    snap = db._bt_snapshot(c)
    c2 = db._bt_to_combatant(snap)
    assert c2.has_perk('rend') and c2.has_perk('deathdrive')
```

- [ ] **Step 2: Run test to verify it fails**

Run: `python -m pytest tests/test_undercity_perks.py::test_combatant_carries_perks_and_survives_serde -q`
Expected: FAIL — `AttributeError: 'Combatant' object has no attribute 'has_perk'`

- [ ] **Step 3: Add the `perks` field + `has_perk` to Combatant**

In `undercity_engine.py`, in the `Combatant` dataclass add alongside `riders`/`buffs`:

```python
    perks: frozenset = frozenset()    # attribute-threshold perks (creatures only)
```

and next to `has_rider`:

```python
    def has_perk(self, perk):
        return perk in self.perks
```

- [ ] **Step 4: Populate perks in `_combatant` and the snapshot serde**

In `undercity_db.py` `_combatant`, add `perks=engine.attribute_perks(doc)` to the `Combatant(...)` call.

In `_bt_snapshot(c)` add to the returned dict: `'perks': sorted(c.perks),`

In `_bt_to_combatant(s)` add to the `Combatant(...)` call: `perks=frozenset(s.get('perks') or []),`

- [ ] **Step 5: Run test + full suite**

Run: `python -m pytest tests/test_undercity_perks.py -q && python -m pytest tests -q`
Expected: PASS; suite still green.

- [ ] **Step 6: Commit**

```bash
git add infrastructure/lambda/undercity_engine.py infrastructure/lambda/undercity_db.py infrastructure/lambda/tests/test_undercity_perks.py
git commit -m "feat(undercity): combatants carry attribute perks"
```

---

## Phase 2 — Guard/DEF fix + combat perks

### Task 3: `GUARD_CHIP_COEFF` config + Carapace Grind chip

**Files:**
- Modify: `infrastructure/lambda/undercity_config.py`
- Modify: `infrastructure/lambda/undercity_engine.py` (`resolve_round`)
- Test: `infrastructure/lambda/tests/test_undercity_perks.py`

- [ ] **Step 1: Write the failing test**

```python
def test_carapace_grind_chips_when_guard_loses_and_only_for_holders():
    import random
    import undercity_engine as engine
    tank = engine.Combatant(name='t', hp=60, max_hp=60, atk=5, dfn=25, spd=5,
                            perks=frozenset({'carapace_grind'}))
    foe = engine.Combatant(name='f', hp=200, max_hp=200, atk=6, dfn=6, spd=6)
    # tank Guards, foe Feints -> foe wins the exchange; grind still chips the foe.
    before = foe.hp
    engine.resolve_round(tank, foe, 'guard', 'feint', 1, random.Random(1))
    assert foe.hp < before  # DEF converted to damage despite losing the exchange

    # a creature WITHOUT the perk does not chip on a lost Guard.
    plain = engine.Combatant(name='p', hp=60, max_hp=60, atk=5, dfn=25, spd=5)
    foe2 = engine.Combatant(name='f2', hp=200, max_hp=200, atk=6, dfn=6, spd=6)
    engine.resolve_round(plain, foe2, 'guard', 'feint', 1, random.Random(1))
    # only the feint-win poke chip differs; assert no guardChip entry was logged
    entries = engine.resolve_round(
        engine.Combatant(name='p', hp=60, max_hp=60, atk=5, dfn=25, spd=5),
        engine.Combatant(name='f', hp=200, max_hp=200, atk=6, dfn=6, spd=6),
        'guard', 'feint', 1, random.Random(1))
    assert not any(e.get('guardChip') for e in entries)
```

- [ ] **Step 2: Run test to verify it fails**

Run: `python -m pytest tests/test_undercity_perks.py::test_carapace_grind_chips_when_guard_loses_and_only_for_holders -q`
Expected: FAIL — the tank's foe HP is unchanged (no chip yet) / assertion error.

- [ ] **Step 3: Add the config knob**

In `undercity_config.py`, in the combat section (near `STANCE_*`):

```python
# Carapace Grind (DEF-10 perk): a Guard holder deals a DEF-scaled chip each round
# it does NOT win the exchange. Sim-validated at 0.5 (DEF/Guard becomes co-equal
# with ATK/Aggress vs the boss; 0.7 is stronger, 1.0 overshoots). Client mirror:
# src/app/undercity/data/perks.ts
GUARD_CHIP_COEFF = 0.5
# Deathdrive (ATK-15): bonus to Aggress swing while the striker is below half HP.
DEATHDRIVE_MULT = 0.5
# Menace (ATK-10): multiplies the enemy's bluff chance.
MENACE_FACTOR = 0.5
# Thick Hide (DEF-5): fraction of hazard/mystery HP loss taken (0.5 = halved).
THICK_HIDE_MULT = 0.5
```

- [ ] **Step 4: Add the chip to `resolve_round`**

In `undercity_engine.py` `resolve_round`, immediately BEFORE the final `return entries`, add the end-of-round grind pass (it reuses the same `ramp` computed at the top of the function and `exchange_winner`):

```python
    # Carapace Grind (DEF perk): a Guard holder that did NOT win the exchange
    # still grinds the foe for a DEF-scaled chip — converts DEF to offense every
    # round independent of the triangle. Gated on the perk, so NPCs never do it.
    grind_winner = exchange_winner(a_stance, d_stance)
    for side, s, t, st in (('attacker', attacker, defender, a_stance),
                           ('defender', defender, attacker, d_stance)):
        if (st == 'guard' and s.has_perk('carapace_grind')
                and s.hp > 0 and t.hp > 0 and grind_winner != side):
            chip = max(1, round(_swing_base(s, 'guard') * ramp * data.GUARD_CHIP_COEFF))
            t.hp -= chip
            entries.append({'round': rnd, 'by': side, 'dmg': chip, 'guardChip': True})
```

- [ ] **Step 5: Run test to verify it passes**

Run: `python -m pytest tests/test_undercity_perks.py -q`
Expected: PASS

- [ ] **Step 6: Commit**

```bash
git add infrastructure/lambda/undercity_config.py infrastructure/lambda/undercity_engine.py infrastructure/lambda/tests/test_undercity_perks.py
git commit -m "feat(undercity): Carapace Grind — DEF/Guard combat conversion"
```

---

### Task 4: Sim parity check for the real perk

**Files:**
- Modify: `infrastructure/lambda/sim/proto_fix.py` (add a `verify_real()` that uses the shipped perk, not the monkeypatch)

- [ ] **Step 1: Add a real-perk verification**

Append to `sim/proto_fix.py`:

```python
def verify_real():
    """Confirm the SHIPPED Carapace Grind perk reproduces the prototype: a
    pure-DEF/Guard build becomes a viable boss path, ATK/SPD unchanged."""
    from sim.arena import make_leveled_doc, winrate, enemy_registry
    from sim.driver import Build
    from sim.sweep import custom_policy
    reg = enemy_registry()
    for label, pri, stance in [('pure-DEF', ('def',), 'guard'),
                               ('pure-ATK', ('atk',), 'aggress'),
                               ('pure-SPD', ('spd',), 'feint')]:
        pol = custom_policy(pref_stance=stance, stat_priority=pri, name='x')
        doc = make_leveled_doc(Build('pest', 'city'), pol, 10, seed=1)
        w = winrate(doc, reg['rot_sovereign'][1], pol, trials=300, base_seed=5, kind='boss')
        print(f'{label}/{stance}: Savra {w["mean_dmg"]:.0f} dmg, {w["winrate"]*100:.0f}% '
              f'(perks: {sorted(__import__("undercity_engine").attribute_perks(doc))})')
```

- [ ] **Step 2: Run it and eyeball parity**

Run: `python -c "from sim.proto_fix import verify_real; verify_real()"`
Expected: pure-DEF/guard ≈ 300–340 dmg, ~10–15% (has `carapace_grind`); pure-ATK/aggress ≈ 360 dmg, ~62%; pure-SPD/feint ≈ 240 dmg, ~26%. If DEF is far off 0.5's numbers, adjust `GUARD_CHIP_COEFF` and re-run.

- [ ] **Step 3: Commit**

```bash
git add infrastructure/lambda/sim/proto_fix.py
git commit -m "test(undercity-sim): verify shipped Carapace Grind matches prototype"
```

---

### Task 5: Rend — winning Aggress applies rot

**Files:**
- Modify: `infrastructure/lambda/undercity_engine.py` (`resolve_round`, winning-Aggress branch)
- Test: `infrastructure/lambda/tests/test_undercity_perks.py`

- [ ] **Step 1: Write the failing test**

```python
def test_rend_applies_rot_on_winning_aggress():
    import random
    import undercity_engine as engine
    me = engine.Combatant(name='m', hp=40, max_hp=40, atk=12, dfn=5, spd=6,
                          perks=frozenset({'rend'}))
    foe = engine.Combatant(name='f', hp=60, max_hp=60, atk=5, dfn=3, spd=3)
    # aggress beats feint -> a win; Rend should leave the foe with a rot stack.
    engine.resolve_round(me, foe, 'aggress', 'feint', 1, random.Random(3))
    assert foe.rot_stacks >= 1
```

- [ ] **Step 2: Run test to verify it fails**

Run: `python -m pytest tests/test_undercity_perks.py::test_rend_applies_rot_on_winning_aggress -q`
Expected: FAIL — `foe.rot_stacks == 0`

- [ ] **Step 3: Implement Rend**

In `resolve_round`, inside the winning branch where `win_stance == 'aggress'` handling ends (in the block after the winning hit is dealt, alongside the `rabid`/`venom_barb` handling for `win_stance == 'aggress'`), add:

```python
            if win_stance == 'aggress' and winr.has_perk('rend') and losr.hp > 0:
                losr.rot_stacks += 1
                entries.append({'round': rnd, 'by': win_side, 'rotApplied': 1})
```

- [ ] **Step 4: Run test to verify it passes**

Run: `python -m pytest tests/test_undercity_perks.py -q`
Expected: PASS

- [ ] **Step 5: Commit**

```bash
git add infrastructure/lambda/undercity_engine.py infrastructure/lambda/tests/test_undercity_perks.py
git commit -m "feat(undercity): Rend perk — rot on winning Aggress"
```

---

### Task 6: Deathdrive — sub-50% Aggress bonus

**Files:**
- Modify: `infrastructure/lambda/undercity_engine.py` (`_swing_base`)
- Test: `infrastructure/lambda/tests/test_undercity_perks.py`

- [ ] **Step 1: Write the failing test**

```python
def test_deathdrive_boosts_aggress_only_when_low():
    import undercity_engine as engine
    low = engine.Combatant(name='l', hp=10, max_hp=40, atk=10, dfn=5, spd=5,
                           perks=frozenset({'deathdrive'}))
    high = engine.Combatant(name='h', hp=40, max_hp=40, atk=10, dfn=5, spd=5,
                            perks=frozenset({'deathdrive'}))
    assert engine._swing_base(low, 'aggress') > engine._swing_base(high, 'aggress')
    # no effect outside Aggress
    assert engine._swing_base(low, 'guard') == engine._swing_base(high, 'guard')
```

- [ ] **Step 2: Run test to verify it fails**

Run: `python -m pytest tests/test_undercity_perks.py::test_deathdrive_boosts_aggress_only_when_low -q`
Expected: FAIL — low == high (no bonus).

- [ ] **Step 3: Implement Deathdrive in `_swing_base`**

In `_swing_base`, in the `if stance == 'aggress':` branch, before `return`:

```python
    if stance == 'aggress':
        base = striker.atk * (1 + data.STANCE_STAT_WEIGHT) + striker.aggress_ramp
        if (striker.has_perk('deathdrive') and striker.max_hp
                and striker.hp < 0.5 * striker.max_hp):
            base *= (1 + data.DEATHDRIVE_MULT)
        return base
```

(Replace the existing single-line `return` in that branch with the block above.)

- [ ] **Step 4: Run test to verify it passes**

Run: `python -m pytest tests/test_undercity_perks.py -q`
Expected: PASS

- [ ] **Step 5: Commit**

```bash
git add infrastructure/lambda/undercity_engine.py infrastructure/lambda/tests/test_undercity_perks.py
git commit -m "feat(undercity): Deathdrive perk — berserker Aggress under 50% HP"
```

---

### Task 7: Menace — reduce enemy bluff

**Files:**
- Modify: `infrastructure/lambda/undercity_db.py` (`_telegraph_next`)
- Test: `infrastructure/lambda/tests/test_undercity_perks.py`

- [ ] **Step 1: Write the failing test**

```python
def test_menace_lowers_effective_bluff():
    import undercity_db as db
    # A rec whose npc always bluffs (1.0). With Menace, effective bluff halves,
    # so over many telegraphs the shown intent matches the actual MORE often.
    import random
    def make_rec(perks):
        return {'round': 1,
                'player': {'perks': perks, 'reveal_next': False},
                'npc': {'personality': 'balanced', 'bluff': 1.0},
                'readChance': 0.0}
    db._rng.seed(0)
    truth_plain = sum(_telegraph_truthful(db, make_rec([])) for _ in range(400))
    db._rng.seed(0)
    truth_menace = sum(_telegraph_truthful(db, make_rec(['menace'])) for _ in range(400))
    assert truth_menace > truth_plain


def _telegraph_truthful(db, rec):
    db._telegraph_next(rec)
    return 1 if rec['npcShown'] == rec['npcActual'] else 0
```

- [ ] **Step 2: Run test to verify it fails**

Run: `python -m pytest tests/test_undercity_perks.py::test_menace_lowers_effective_bluff -q`
Expected: FAIL — counts equal (Menace not applied).

- [ ] **Step 3: Implement Menace in `_telegraph_next`**

In `undercity_db.py` `_telegraph_next`, where `bluff` is read, apply the player's perk:

```python
    bluff = float(rec['npc'].get('bluff', data.NPC_DEFAULT_BLUFF))
    if 'menace' in (rec.get('player', {}).get('perks') or []):
        bluff *= data.MENACE_FACTOR
```

- [ ] **Step 4: Run test to verify it passes**

Run: `python -m pytest tests/test_undercity_perks.py -q`
Expected: PASS

- [ ] **Step 5: Commit**

```bash
git add infrastructure/lambda/undercity_db.py infrastructure/lambda/tests/test_undercity_perks.py
git commit -m "feat(undercity): Menace perk — enemies bluff you less"
```

---

### Task 8: Thick Hide — halve hazard/mystery HP loss

**Files:**
- Modify: `infrastructure/lambda/undercity_db.py` (`_hazard`, `_dungeon_hazard`, `_mystery` HP-loss application)
- Test: `infrastructure/lambda/tests/test_undercity_perks.py`

- [ ] **Step 1: Read the current HP-loss sites**

Read `_hazard` (undercity_db.py ~1799), `_dungeon_hazard` (~1824), and the `hpPct`/heal handling in `_mystery` (~1734). Identify each spot that does `doc['hp'] -= loss` or `doc['hp'] = ... hpPct`.

- [ ] **Step 2: Write the failing test**

```python
def test_thick_hide_halves_hazard_loss(table):
    import undercity_db as db, undercity_data as data
    from tests.test_undercity_db import act, _sid
    act(table, 'join', starter='saproling', home='cavern')  # base def 7 -> thick_hide
    sid = _sid(table)
    doc = db._get_player(table, sid, 'user-alex')
    assert 'thick_hide' in db.engine.attribute_perks(doc)
    doc['hp'] = 30
    node = next(n for n, v in data.MAP_NODES.items() if v['type'] == 'hazard')
    ev = db._hazard(table, sid, doc, node)
    # exact loss depends on the hazard, but a thick-hide creature must lose
    # strictly less than the raw amount reported for a no-perk creature.
    # (see helper below comparing perk vs stripped doc)
```

Since hazard rolls are RNG, assert the halving deterministically with a stubbed loss instead:

```python
def test_thick_hide_halving_is_applied(monkeypatch):
    import undercity_db as db
    doc = {'atk': 1, 'def': 7, 'spd': 1, 'hp': 30, 'maxHp': 30}
    assert db._apply_hp_loss(doc, 10) == 5      # thick_hide halves
    doc2 = {'atk': 1, 'def': 1, 'spd': 1, 'hp': 30, 'maxHp': 30}
    assert db._apply_hp_loss(doc2, 10) == 10    # no perk, full loss
```

- [ ] **Step 3: Run test to verify it fails**

Run: `python -m pytest tests/test_undercity_perks.py::test_thick_hide_halving_is_applied -q`
Expected: FAIL — `_apply_hp_loss` not defined.

- [ ] **Step 4: Add `_apply_hp_loss` helper and route hazard/mystery losses through it**

In `undercity_db.py`, add near `_compost`:

```python
def _apply_hp_loss(doc, amount):
    """Apply an environmental HP loss (hazard / bad mystery), halved by the
    Thick Hide perk. Returns the amount actually deducted. Caller sets hp."""
    if amount <= 0:
        return 0
    if 'thick_hide' in engine.attribute_perks(doc):
        amount = max(1, round(amount * data.THICK_HIDE_MULT))
    doc['hp'] = max(0, doc.get('hp', 0) - amount)
    return amount
```

Then in `_hazard`, `_dungeon_hazard`, and the mystery `hpPct`-loss branch, replace each direct `doc['hp'] -= loss` (and the negative-`hpPct` computation) with `loss = _apply_hp_loss(doc, loss)` after computing the raw `loss`. (For `hpPct`, compute `raw = round(maxHp * abs(hpPct))` first, then `_apply_hp_loss(doc, raw)`.)

- [ ] **Step 5: Run test + full suite**

Run: `python -m pytest tests/test_undercity_perks.py -q && python -m pytest tests -q`
Expected: PASS; suite green (existing hazard tests may need the halved value for a thick-hide starter — update those assertions if any fail, keeping non-perk cases unchanged).

- [ ] **Step 6: Commit**

```bash
git add infrastructure/lambda/undercity_db.py infrastructure/lambda/tests/test_undercity_perks.py
git commit -m "feat(undercity): Thick Hide perk — halve hazard/mystery HP loss"
```

---

### Task 9: Last Stand — survive one lethal blow per descent

**Files:**
- Modify: `infrastructure/lambda/undercity_db.py` (`_finish_battle` / `_compost` and descent reset)
- Test: `infrastructure/lambda/tests/test_undercity_perks.py`

- [ ] **Step 1: Write the failing test**

```python
def test_last_stand_survives_once_per_descent(table, monkeypatch):
    import undercity_db as db
    from tests.test_undercity_db import act, _sid, _finish_started_battle
    act(table, 'join', starter='pest')
    sid = _sid(table)
    doc = db._get_player(table, sid, 'user-alex')
    doc['def'] = 15  # unlock last_stand
    doc['hp'] = 20
    db._put_player(table, doc)
    db._wild_battle(table, sid, doc)
    # a killing blow: Last Stand leaves the player at 1 HP, not composted.
    se = _finish_started_battle(table, monkeypatch, db._get_player(table, sid, 'user-alex'),
                                outcome='defender', defender_hp=5)
    you = db._get_player(table, sid, 'user-alex')
    assert you['hp'] == 1
    assert you.get('lastStandUsed') is True
```

- [ ] **Step 2: Run test to verify it fails**

Run: `python -m pytest tests/test_undercity_perks.py::test_last_stand_survives_once_per_descent -q`
Expected: FAIL — player composts (hp 0), no `lastStandUsed`.

- [ ] **Step 3: Implement Last Stand in `_finish_battle`**

In `_finish_battle`, right after `doc['hp'] = result['attackerHp']`, intercept a lethal result:

```python
    if (result['attackerHp'] <= 0 and 'last_stand' in engine.attribute_perks(doc)
            and not doc.get('lastStandUsed')):
        doc['hp'] = 1
        doc['lastStandUsed'] = True
        result['attackerHp'] = 1
        result['outcome'] = 'attacker' if result.get('defenderHp', 1) <= 0 else result['outcome']
```

Reset the flag when the player surfaces: in `_resolve_space`, alongside the existing `restsUsed` reset (`if region != 'depths' and doc.get('restsUsed')`), also clear `doc.pop('lastStandUsed', None)`.

- [ ] **Step 4: Run test to verify it passes**

Run: `python -m pytest tests/test_undercity_perks.py -q`
Expected: PASS

- [ ] **Step 5: Commit**

```bash
git add infrastructure/lambda/undercity_db.py infrastructure/lambda/tests/test_undercity_perks.py
git commit -m "feat(undercity): Last Stand perk — cheat death once per descent"
```

---

## Phase 3 — SPD traversal roll perks

> These change the roll/move contract. Contract: `_roll` returns `roll: {value, destinations}` today. Pathfinder adds `values: [a, b]` and unions destinations; Blink lets the client name the value; Fleetfoot flags a rerollable 1.

### Task 10: Blink — choose your die value once per turn

**Files:**
- Modify: `infrastructure/lambda/undercity_db.py` (`_roll`)
- Test: `infrastructure/lambda/tests/test_undercity_perks.py`

- [ ] **Step 1: Write the failing test**

```python
def test_blink_lets_spd15_choose_value(table):
    import undercity_db as db, undercity_data as data
    from tests.test_undercity_db import act, _sid
    act(table, 'join', starter='pest')
    sid = _sid(table)
    doc = db._get_player(table, sid, 'user-alex')
    doc['spd'] = 15  # unlock blink
    db._put_player(table, doc)
    status, resp = act(table, 'roll', blink=True, value=6)
    assert status == 200 and resp['roll']['value'] == 6

    # without the perk, blink is ignored (random roll, not forced 6)
    act(table, 'move', to=resp['roll']['destinations'][0])
    doc = db._get_player(table, sid, 'user-alex'); doc['spd'] = 1
    db._put_player(table, doc)
    forced = [act(table, 'roll', blink=True, value=6)[1]['roll']['value'] for _ in range(1)
              if act(table, 'move', to='__noop__')[0] or True]
```

Simplify the negative case to a direct assert:

```python
def test_blink_ignored_without_perk(table):
    import undercity_db as db
    from tests.test_undercity_db import act, _sid
    act(table, 'join', starter='pest')
    sid = _sid(table)
    doc = db._get_player(table, sid, 'user-alex'); doc['spd'] = 1
    db._put_player(table, doc)
    status, resp = act(table, 'roll', blink=True, value=6)
    # no perk: value came from the die, not the request (may coincidentally be 6,
    # but the blink path must not have been taken — assert no blink marker).
    assert not resp['roll'].get('blink')
```

- [ ] **Step 2: Run test to verify it fails**

Run: `python -m pytest tests/test_undercity_perks.py::test_blink_lets_spd15_choose_value -q`
Expected: FAIL — value is random, not 6.

- [ ] **Step 3: Implement Blink in `_roll`**

In `_roll`, after computing `picked` (the DEBUG pick) and before the `value` decision, add a perk-gated pick that works in production:

```python
    perks = engine.attribute_perks(doc)
    blink = bool(payload.get('blink')) if payload else False
    blink_val = payload.get('value') if payload else None
    blink_val = int(blink_val) if isinstance(blink_val, (int, float)) and 1 <= blink_val <= 6 else None
```

Then in the value decision, add a branch (highest priority after DEBUG pick):

```python
    if data.DEBUG and picked is not None:
        value = picked
    elif blink and 'blink' in perks and blink_val is not None:
        value = blink_val
        doc.setdefault('_perkRoll', {})['blink'] = True
    elif doc.get('pendingLoadedDie'):
        ...
```

When building the response `roll` dict, include `'blink': True` when the blink branch was taken (read `doc.pop('_perkRoll', {}).get('blink')`).

- [ ] **Step 4: Run test to verify it passes**

Run: `python -m pytest tests/test_undercity_perks.py -q`
Expected: PASS

- [ ] **Step 5: Commit**

```bash
git add infrastructure/lambda/undercity_db.py infrastructure/lambda/tests/test_undercity_perks.py
git commit -m "feat(undercity): Blink perk — SPD-15 chooses the die value"
```

---

### Task 11: Pathfinder — roll two, keep either

**Files:**
- Modify: `infrastructure/lambda/undercity_db.py` (`_roll`, `_move`)
- Test: `infrastructure/lambda/tests/test_undercity_perks.py`

- [ ] **Step 1: Write the failing test**

```python
def test_pathfinder_rolls_two_and_unions_destinations(table, monkeypatch):
    import undercity_db as db, undercity_data as data
    from tests.test_undercity_db import act, _sid
    act(table, 'join', starter='pest')
    sid = _sid(table)
    doc = db._get_player(table, sid, 'user-alex'); doc['spd'] = 10  # pathfinder
    db._put_player(table, doc)
    # force two distinct die faces
    vals = iter([2, 5])
    monkeypatch.setattr(db._rng, 'randint', lambda a, b: next(vals))
    status, resp = act(table, 'roll')
    assert status == 200
    assert sorted(resp['roll']['values']) == [2, 5]
    # destinations are the union of what each value reaches
    d2 = db.engine.legal_destinations(data.MAP_NODES, doc['position'], 2, set(), set())
    d5 = db.engine.legal_destinations(data.MAP_NODES, doc['position'], 5, set(), set())
    assert set(resp['roll']['destinations']) == set(d2) | set(d5)
```

- [ ] **Step 2: Run test to verify it fails**

Run: `python -m pytest tests/test_undercity_perks.py::test_pathfinder_rolls_two_and_unions_destinations -q`
Expected: FAIL — `values` key missing.

- [ ] **Step 3: Implement Pathfinder in `_roll` and `_move`**

In `_roll`, when `'pathfinder' in perks` and the value was rolled (not blink/loaded/DEBUG), roll a second value and union destinations:

```python
    if 'pathfinder' in perks and not blink and not doc.get('pendingLoadedDie'):
        value2 = _rng.randint(1, 6)
        dests2 = engine.legal_destinations(data.MAP_NODES, doc['position'], value2,
                                           _closed_barriers(table, sid), _blocked_nodes(doc))
        dests = sorted(set(dests) | set(dests2))
        doc['pendingMove'] = {'value': value, 'values': sorted([value, value2]), 'dests': dests}
        # ... (skip the single-value pendingMove assignment below)
```

Keep the existing single-value path for non-pathfinder. `_move` already validates `to in pm['dests']`, so the union works with no `_move` change beyond tolerating the extra `values` key (it ignores unknown keys). Confirm `_move` reads `pm['dests']` only.

Include `values` in the returned `roll` dict when present.

- [ ] **Step 4: Run test to verify it passes**

Run: `python -m pytest tests/test_undercity_perks.py -q && python -m pytest tests -q`
Expected: PASS; suite green.

- [ ] **Step 5: Commit**

```bash
git add infrastructure/lambda/undercity_db.py infrastructure/lambda/tests/test_undercity_perks.py
git commit -m "feat(undercity): Pathfinder perk — roll with advantage"
```

---

### Task 12: Fleetfoot — optional reroll of a 1

**Files:**
- Modify: `infrastructure/lambda/undercity_db.py` (`_roll` response flag + reroll path)
- Test: `infrastructure/lambda/tests/test_undercity_perks.py`

- [ ] **Step 1: Write the failing test**

```python
def test_fleetfoot_offers_optional_reroll_of_a_one(table, monkeypatch):
    import undercity_db as db
    from tests.test_undercity_db import act, _sid
    act(table, 'join', starter='pest')
    sid = _sid(table)
    doc = db._get_player(table, sid, 'user-alex'); doc['spd'] = 5  # fleetfoot
    db._put_player(table, doc)
    monkeypatch.setattr(db._rng, 'randint', lambda a, b: 1)
    status, resp = act(table, 'roll')
    assert resp['roll']['value'] == 1 and resp['roll']['canReroll'] is True
    # accept the reroll (player chose to); a fresh die is rolled once.
    monkeypatch.setattr(db._rng, 'randint', lambda a, b: 4)
    status, resp = act(table, 'roll', reroll=True)
    assert status == 200 and resp['roll']['value'] == 4
```

- [ ] **Step 2: Run test to verify it fails**

Run: `python -m pytest tests/test_undercity_perks.py::test_fleetfoot_offers_optional_reroll_of_a_one -q`
Expected: FAIL — `canReroll` missing / reroll rejected because `pendingMove` exists.

- [ ] **Step 3: Implement Fleetfoot**

In `_roll`: when the rolled `value == 1` and `'fleetfoot' in perks` and not already rerolled this pending, set `roll['canReroll'] = True`. Allow a reroll request even with a pending move:

At the top of `_roll`, before the `pendingMove` guard, add:

```python
    reroll = bool(payload.get('reroll')) if payload else False
    pm = doc.get('pendingMove')
    if reroll and pm and pm.get('value') == 1 and 'fleetfoot' in engine.attribute_perks(doc) \
            and not pm.get('rerolled'):
        doc['pendingMove'] = None   # discard the 1 and fall through to a fresh roll
        doc['_fleetfootRerolled'] = True
```

Guard the normal "already rolled" error so it doesn't fire on a legal reroll. After the fresh value is computed, if `doc.pop('_fleetfootRerolled', False)`, mark `pendingMove['rerolled'] = True`. Add `canReroll` to the response when `value == 1 and 'fleetfoot' in perks and not pendingMove.get('rerolled')`.

- [ ] **Step 4: Run test to verify it passes**

Run: `python -m pytest tests/test_undercity_perks.py -q && python -m pytest tests -q`
Expected: PASS; suite green.

- [ ] **Step 5: Commit**

```bash
git add infrastructure/lambda/undercity_db.py infrastructure/lambda/tests/test_undercity_perks.py
git commit -m "feat(undercity): Fleetfoot perk — optional reroll of a 1"
```

---

## Phase 4 — Surface perks in state

### Task 13: `handle_state` exposes the unlocked perk set

**Files:**
- Modify: `infrastructure/lambda/undercity_db.py` (`handle_state` `you` view, `_public_player`)
- Test: `infrastructure/lambda/tests/test_undercity_perks.py`

- [ ] **Step 1: Write the failing test**

```python
def test_state_surfaces_perks(table):
    import undercity_db as db
    from tests.test_undercity_db import act
    act(table, 'join', starter='saproling', home='cavern')  # def 7 -> thick_hide
    status, state = db.handle_state(table, {'userId': 'user-alex'})
    assert 'thick_hide' in state['you']['perks']
```

- [ ] **Step 2: Run test to verify it fails**

Run: `python -m pytest tests/test_undercity_perks.py::test_state_surfaces_perks -q`
Expected: FAIL — `'perks'` not in `you`.

- [ ] **Step 3: Implement**

In `handle_state`, where `you` is built (`you = {k: v ...}`), add:

```python
                you['perks'] = sorted(engine.attribute_perks(item))
```

Optionally add the same to `_public_player` so spectators see build identity:
`'perks': sorted(engine.attribute_perks(p)),`

- [ ] **Step 4: Run test + full suite**

Run: `python -m pytest tests/test_undercity_perks.py -q && python -m pytest tests -q`
Expected: PASS; suite green.

- [ ] **Step 5: Commit**

```bash
git add infrastructure/lambda/undercity_db.py infrastructure/lambda/tests/test_undercity_perks.py
git commit -m "feat(undercity): surface unlocked perks in game state"
```

---

## Phase 5 — Client (Angular; verified by `npm run build`, no test runner)

### Task 14: Perk defs mirror

**Files:**
- Create: `src/app/undercity/data/perks.ts`

- [ ] **Step 1: Create the mirror** (values MUST match `undercity_data.PERKS` / `PERK_TRACKS`)

```typescript
// Mirror of infrastructure/lambda/undercity_data.py PERKS / PERK_TRACKS.
// Perks derive from the invested base stat (never gear/buffs). Keep in sync.
export type PerkTrack = 'atk' | 'def' | 'spd';
export interface Perk { id: string; name: string; track: PerkTrack; threshold: 5 | 10 | 15; blurb: string; }

export const PERK_TRACKS: Record<PerkTrack, { threshold: number; id: string }[]> = {
  atk: [{ threshold: 5, id: 'rend' }, { threshold: 10, id: 'menace' }, { threshold: 15, id: 'deathdrive' }],
  def: [{ threshold: 5, id: 'thick_hide' }, { threshold: 10, id: 'carapace_grind' }, { threshold: 15, id: 'last_stand' }],
  spd: [{ threshold: 5, id: 'fleetfoot' }, { threshold: 10, id: 'pathfinder' }, { threshold: 15, id: 'blink' }],
};

export const PERKS: Record<string, Perk> = {
  rend: { id: 'rend', name: 'Rend', track: 'atk', threshold: 5, blurb: 'A winning Aggress always applies 1 rot.' },
  menace: { id: 'menace', name: 'Menace', track: 'atk', threshold: 10, blurb: 'Enemies bluff you less often.' },
  deathdrive: { id: 'deathdrive', name: 'Deathdrive', track: 'atk', threshold: 15, blurb: 'Below half HP, your Aggress swings hit harder.' },
  thick_hide: { id: 'thick_hide', name: 'Thick Hide', track: 'def', threshold: 5, blurb: 'Halve HP lost to hazards and bad mystery rolls.' },
  carapace_grind: { id: 'carapace_grind', name: 'Carapace Grind', track: 'def', threshold: 10, blurb: 'Holding Guard grinds the foe down even when you don’t win.' },
  last_stand: { id: 'last_stand', name: 'Last Stand', track: 'def', threshold: 15, blurb: 'Survive one lethal blow per descent at 1 HP.' },
  fleetfoot: { id: 'fleetfoot', name: 'Fleetfoot', track: 'spd', threshold: 5, blurb: 'You may reroll a die that shows 1.' },
  pathfinder: { id: 'pathfinder', name: 'Pathfinder', track: 'spd', threshold: 10, blurb: 'Roll with advantage — roll two dice, keep either.' },
  blink: { id: 'blink', name: 'Blink', track: 'spd', threshold: 15, blurb: 'Once per turn, choose your die value.' },
};
```

- [ ] **Step 2: Build**

Run: `npm run build`
Expected: build succeeds.

- [ ] **Step 3: Commit**

```bash
git add src/app/undercity/data/perks.ts
git commit -m "feat(undercity): client perk defs mirror"
```

---

### Task 15: Attribute-track UI in the creature panel

**Files:**
- Modify: the creature/stats panel component under `src/app/undercity/` (locate the one rendering `you.atk/def/spd` — likely a `creature-*.component.ts`; grep `spend-stat` to find where stats are shown)
- Modify: the client model/service that types `you` (add `perks: string[]`)

- [ ] **Step 1: Find the stats panel**

Run: `rg -l "spend-stat|statPoints" src/app/undercity`
Read the component that renders the ATK/DEF/SPD rows and stat-spend buttons.

- [ ] **Step 2: Add `perks` to the `you` type**

Wherever the `you`/player interface is declared (grep `statPoints` in `src/app/undercity`), add `perks?: string[];`.

- [ ] **Step 3: Render three tracks**

For each attribute, render its three nodes from `PERK_TRACKS[track]`; a node is *lit* when `you.perks?.includes(node.id)`. Show the perk name + blurb (from `PERKS`) and the threshold; mark the next locked node with its threshold so the player sees "6 → 10 for Carapace Grind". Reuse existing SCSS tokens (`STYLE_GUIDE.md`) — the Golgari palette and the gear/spell card styling already in the panel. Lit nodes use the accent; locked nodes are muted.

- [ ] **Step 4: Build and eyeball**

Run: `npm run build` then `npm start` and open `/undercity`, hatch a saproling, confirm Thick Hide shows lit and the track renders in both themes.

- [ ] **Step 5: Commit**

```bash
git add src/app/undercity
git commit -m "feat(undercity): attribute perk tracks in creature panel"
```

---

### Task 16: Roll UX for SPD perks (Pathfinder / Blink / Fleetfoot)

**Files:**
- Modify: the roll/board component that calls the `roll` action (grep `'roll'` action dispatch in `src/app/undercity`)

- [ ] **Step 1: Find the roll dispatch**

Run: `rg -n "type: 'roll'|action\('roll'|'roll'" src/app/undercity`
Read the component/service method that fires `roll` and renders the die + destination picker.

- [ ] **Step 2: Pathfinder — two-value picker**

When `roll.values` is present (length 2), show both dice; destinations are already the union, so the existing destination picker works unchanged. Label which die reaches a highlighted destination if the UI shows per-die hints (optional).

- [ ] **Step 3: Blink — value picker (SPD-15)**

When `you.perks` includes `blink`, show a "choose value" affordance (reuse the loaded-die picker UI pattern already in the board tab) that fires `roll` with `{ blink: true, value }`. Gate visibility on the perk.

- [ ] **Step 4: Fleetfoot — optional reroll**

When `roll.canReroll` is true, show a "Reroll the 1?" button that fires `roll` with `{ reroll: true }`; leaving it dismisses (keep the 1). Only shows once (server clears `canReroll` after a reroll).

- [ ] **Step 5: Build and eyeball**

Run: `npm run build`; manually verify each perk's affordance appears only when unlocked.

- [ ] **Step 6: Commit**

```bash
git add src/app/undercity
git commit -m "feat(undercity): roll UX for SPD traversal perks"
```

---

## Phase 6 — Docs + final verification

### Task 17: Update specs/CLAUDE pointers + final green run

**Files:**
- Modify: `specs/undercity-combat.md` (note Carapace Grind + the perk system), `CLAUDE.md` (one line pointing at the perk spec + `perks.ts` mirror)

- [ ] **Step 1: Add a short "Attribute perks" note to `specs/undercity-combat.md`** describing the tracks, the derive-from-invested-stat rule, and that Carapace Grind is the Guard/DEF conversion. Add a bullet under the Undercity section of `CLAUDE.md` pointing at `specs/2026-07-21-undercity-attribute-perks-design.md` and the `perks.ts` mirror.

- [ ] **Step 2: Full backend suite + sim**

Run: `python -m pytest tests -q` (expect all green) and `python -c "from sim.proto_fix import verify_real; verify_real()"` (expect DEF/Guard viable, ATK/SPD unchanged).

- [ ] **Step 3: Client build**

Run: `npm run build` (expect success).

- [ ] **Step 4: Commit**

```bash
git add specs/undercity-combat.md CLAUDE.md
git commit -m "docs(undercity): document attribute perk tracks"
```

---

## Self-review notes

- **Spec coverage:** threshold mechanic (T1), invested-stat/no-migration (T1/T2), all 9 perks (T3,5,6,7,8,9,10,11,12), Guard/DEF fix as Carapace Grind (T3) + sim parity (T4), base-stat lights tier-1 (T1 test), state surfacing (T13), config scalars (T3), data + client mirrors (T1/T14), track UI (T15), roll UX (T16), tests throughout, docs (T17). No base combat-maths change (per design decision) — confirmed none of the `STANCE_*` constants are touched.
- **Deferred (per design):** no respec/refund; PvP interactions out of scope.
- **Risk flag:** Phase 3 touches the roll/move contract — Pathfinder adds `values`, Fleetfoot bends the "already rolled" guard. Keep the single-value path intact for non-perk creatures so existing tests and clients are unaffected.
