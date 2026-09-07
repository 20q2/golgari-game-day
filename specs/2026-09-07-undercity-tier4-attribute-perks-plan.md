# Undercity Tier-4 Attribute Perks (24 nodes) Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add a fourth node to each ATK/DEF/SPD attribute perk track at threshold 24 — Shellsplitter (strips foe DEF on won exchanges), Grindstone (+25 Max HP, Guard chips every round), and Longstride (combine both Pathfinder dice to travel up to 12 spaces).

**Architecture:** Perks stay derived, never persisted — `engine.attribute_perks` already walks `PERK_TRACKS`, so a fourth tuple per track is the entire unlock mechanism. Shellsplitter rides the existing-but-unused `pierce` parameter in `engine._base_hit` via a new fight-scoped `Combatant.armor_strip`. Grindstone widens the existing `carapace_grind` end-of-round block. Longstride extends the existing Pathfinder advantage roll with a third candidate value (the sum of the two faces), threaded through every place that reads `pendingMove['values']`.

**Tech Stack:** Python 3.11 Lambda (`infrastructure/lambda/`), pytest with an in-memory `FakeTable`, Angular 20 standalone components (`src/app/undercity/`).

---

## Pre-existing test failures (read this first)

The suite is **not** fully green at the start of this work. As of 2026-09-07:

```
37 failed  tests/test_deep_dungeons.py   (escape-ladder reachability)
 1 failed  tests/test_map.py             (test_space_type_distribution)
1403 passed
```

These are map-topology failures from recent map edits and are **unrelated to this plan**. Do
not fix them and do not let them block a commit. `tests/test_undercity_perks.py` is 39/39
green — that is the file this plan extends, and it must stay green.

Verification command used throughout:

```bash
cd infrastructure/lambda && python -m pytest tests/test_undercity_perks.py -q
```

Full-suite check (expect the 38 known failures above and no others):

```bash
cd infrastructure/lambda && python -m pytest tests -q
```

Frontend check — **lint is broken in this repo, verify with the build instead**, and run npm
through the Bash tool:

```bash
npm run build
```

---

## File Structure

| File | Responsibility | Change |
|---|---|---|
| `infrastructure/lambda/undercity_config.py` | scalar tunables | Modify: 3 new scalars |
| `infrastructure/lambda/undercity_data.py` | perk tracks + definitions | Modify: `PERK_TRACKS`, `PERKS` |
| `infrastructure/lambda/undercity_engine.py` | pure combat/movement rules | Modify: `Combatant`, `_base_hit`, `resolve_round`, `effective_stats` |
| `infrastructure/lambda/undercity_db.py` | DynamoDB I/O + action dispatch | Modify: battle serde trio, `_roll`, `_move`, new `_pm_values` helper |
| `infrastructure/lambda/tests/test_undercity_perks.py` | perk test suite | Modify: new cases per task |
| `src/app/undercity/data/perks.ts` | client perk mirror | Modify: 3 definitions, widen type |
| `src/app/undercity/services/undercity-models.ts` | wire types | Modify: `PendingMove.combined`, `roll.combined` |
| `src/app/undercity/tabs/board-tab.component.ts` | board walk + die picker | Modify: `pathfinderPick`, seeding guard |
| `src/app/undercity/tabs/board-tab.component.html` | picker template | Modify: picker label |

---

### Task 1: Scalars, perk definitions, and threshold unlocks

**Files:**
- Modify: `infrastructure/lambda/undercity_config.py` (after the `BLINK_COOLDOWN_ROLLS` block, ~line 232)
- Modify: `infrastructure/lambda/undercity_data.py:310-336` (`PERK_TRACKS` and `PERKS`)
- Test: `infrastructure/lambda/tests/test_undercity_perks.py`

- [ ] **Step 1: Write the failing tests**

Append to `tests/test_undercity_perks.py`:

```python
# ── Tier 4: the 24 nodes (design 2026-09-07) ─────────────────────────────────

def test_tier4_nodes_unlock_at_24():
    assert 'shellsplitter' in engine.attribute_perks(_doc(atk=24))
    assert 'grindstone' in engine.attribute_perks(_doc(dfn=24))
    assert 'longstride' in engine.attribute_perks(_doc(spd=24))


def test_tier4_locked_at_23():
    assert 'shellsplitter' not in engine.attribute_perks(_doc(atk=23))
    assert 'grindstone' not in engine.attribute_perks(_doc(dfn=23))
    assert 'longstride' not in engine.attribute_perks(_doc(spd=23))


def test_tier4_stacks_on_the_whole_track():
    assert engine.attribute_perks(_doc(atk=24)) == frozenset(
        {'brutal_strikes', 'menace', 'deathdrive', 'shellsplitter'})


def test_gear_can_bridge_to_tier4():
    # wurm_tooth is +6 atk, so base 18 + gear reaches the 24 node.
    doc = {'atk': 18, 'def': 1, 'spd': 1, 'gear': {'fang': 'wurm_tooth'}}
    assert 'shellsplitter' in engine.attribute_perks(doc)


def test_removing_gear_dims_tier4():
    doc = {'atk': 18, 'def': 1, 'spd': 1, 'gear': {'fang': 'wurm_tooth'}}
    assert 'shellsplitter' in engine.attribute_perks(doc)
    doc['gear'] = {}
    assert 'shellsplitter' not in engine.attribute_perks(doc)


def test_temporary_buffs_never_light_tier4():
    # savage_roar is +5 atk in effective_stats but must not reach the threshold.
    doc = {'atk': 20, 'def': 1, 'spd': 1, 'buffs': [{'kind': 'savage_roar'}]}
    assert 'shellsplitter' not in engine.attribute_perks(doc)


def test_every_track_has_four_nodes_with_definitions():
    for track, nodes in data.PERK_TRACKS.items():
        assert [t for t, _ in nodes] == [6, 12, 18, 24]
        for _, pid in nodes:
            assert data.PERKS[pid]['track'] == track
```

- [ ] **Step 2: Run the tests to verify they fail**

```bash
cd infrastructure/lambda && python -m pytest tests/test_undercity_perks.py -q -k tier4
```

Expected: FAIL — `assert 'shellsplitter' in frozenset(...)` (the perk id does not exist yet).

- [ ] **Step 3: Add the config scalars**

In `undercity_config.py`, immediately after the `BLINK_COOLDOWN_ROLLS = 1` line and its comment block, add:

```python
# ── Tier-4 attribute perks (the 24 nodes, design 2026-09-07) ─────────────────
# 24 is the first threshold a build split across two attributes cannot reach, so
# these are the loudest effects in the game — the payoff for going mono.
# Shellsplitter (ATK-24): each won exchange strips this much off the foe's
# effective DEF for the rest of the fight. DEF is PROPORTIONAL mitigation
# (def/(def+MITIGATION_K)), so stripping it is multiplicative on damage: against
# Savra (DEF 12) a full strip is +120% damage. Floored at 0 by _base_hit.
SHELLSPLITTER_STRIP = 2
# Grindstone (DEF-24): the DEF track's Max HP grant continues (cumulative
# +5/+15/+30/+55), and Carapace Grind's chip lands EVERY round including the ones
# the holder wins, at a raised coefficient. A turtle's problem against a 560 HP
# boss was never dying, it was dealing damage.
GRINDSTONE_MAXHP = 25
# SIM-SET. 0.8 is the design proposal, not a validated value — it roughly triples
# a turtle's damage output, the largest single swing in the tier-4 design. Set it
# with sim/tier4_check.py (see the 2026-09-07 plan, Task 12).
GRINDSTONE_CHIP_COEFF = 0.8
```

- [ ] **Step 4: Add the track tuples and perk definitions**

In `undercity_data.py`, replace the `PERK_TRACKS` dict (line 310) with:

```python
PERK_TRACKS = {
    'atk': [(6, 'brutal_strikes'), (12, 'menace'), (18, 'deathdrive'),
            (24, 'shellsplitter')],
    'def': [(6, 'thick_hide'), (12, 'carapace_grind'), (18, 'last_stand'),
            (24, 'grindstone')],
    'spd': [(6, 'fleetfoot'), (12, 'pathfinder'), (18, 'blink'),
            (24, 'longstride')],
}
```

Also update the comment above it — change `Nodes at 6/12/18;` to `Nodes at 6/12/18/24;`.

Then add three entries to `PERKS`, after the `blink` entry:

```python
    'shellsplitter':  {'name': 'Shellsplitter', 'track': 'atk', 'threshold': 24,
                       'blurb': "Every exchange you win cracks the foe's armour open."},
    'grindstone':     {'name': 'Grindstone', 'track': 'def', 'threshold': 24,
                       'blurb': '+25 Max HP. Guard grinds the foe down every single round.'},
    'longstride':     {'name': 'Longstride', 'track': 'spd', 'threshold': 24,
                       'blurb': 'Combine both dice — travel up to twelve spaces.'},
```

- [ ] **Step 5: Run the tests to verify they pass**

```bash
cd infrastructure/lambda && python -m pytest tests/test_undercity_perks.py -q
```

Expected: PASS, 46 passed.

- [ ] **Step 6: Commit**

```bash
git add infrastructure/lambda/undercity_config.py infrastructure/lambda/undercity_data.py infrastructure/lambda/tests/test_undercity_perks.py
git commit -m "feat(undercity): tier-4 perk nodes at 24 on every attribute track"
```

---

### Task 2: Grindstone Max HP

**Files:**
- Modify: `infrastructure/lambda/undercity_engine.py:866-873` (the DEF-track Max HP block in `effective_stats`)
- Test: `infrastructure/lambda/tests/test_undercity_perks.py`

- [ ] **Step 1: Write the failing test**

Append to `tests/test_undercity_perks.py`:

```python
def test_grindstone_extends_the_def_maxhp_stack():
    def mh(dfn):
        return engine.effective_stats({'atk': 1, 'def': dfn, 'spd': 1, 'maxHp': 30})['maxHp']
    # Cumulative across the track: +5 / +15 / +30 / +55.
    assert mh(18) == 60
    assert mh(24) == 60 + data.GRINDSTONE_MAXHP
    assert mh(24) == 85
```

- [ ] **Step 2: Run the test to verify it fails**

```bash
cd infrastructure/lambda && python -m pytest tests/test_undercity_perks.py -q -k grindstone_extends
```

Expected: FAIL — `assert 60 == 85` (the grindstone grant is not applied yet).

- [ ] **Step 3: Apply the grant**

In `undercity_engine.py`, in `effective_stats`, extend the DEF-track block. Replace:

```python
    if 'last_stand' in perks:
        eff['maxHp'] += data.LAST_STAND_MAXHP
    return eff
```

with:

```python
    if 'last_stand' in perks:
        eff['maxHp'] += data.LAST_STAND_MAXHP
    if 'grindstone' in perks:
        eff['maxHp'] += data.GRINDSTONE_MAXHP
    return eff
```

Also update that block's comment: change `DEF 6 -> +5, DEF 12 -> +15, DEF 18 -> +30.` to
`DEF 6 -> +5, DEF 12 -> +15, DEF 18 -> +30, DEF 24 -> +55.`

- [ ] **Step 4: Run the test to verify it passes**

```bash
cd infrastructure/lambda && python -m pytest tests/test_undercity_perks.py -q
```

Expected: PASS, 47 passed.

- [ ] **Step 5: Commit**

```bash
git add infrastructure/lambda/undercity_engine.py infrastructure/lambda/tests/test_undercity_perks.py
git commit -m "feat(undercity): Grindstone grants +25 Max HP on the DEF track"
```

---

### Task 3: Shellsplitter — `armor_strip` reduces effective DEF

This task adds the state and makes damage read it. Task 4 makes won exchanges accumulate it.

**Files:**
- Modify: `infrastructure/lambda/undercity_engine.py:39` area (`Combatant` internal battle state) and `:168-185` (`_base_hit`)
- Test: `infrastructure/lambda/tests/test_undercity_perks.py`

- [ ] **Step 1: Write the failing tests**

Append to `tests/test_undercity_perks.py`:

```python
def _strip_hit(strip, foe_dfn=12):
    """One aggress swing at a foe, with `strip` already accumulated. Fixed seed,
    so the only variable is the armour strip."""
    import random
    me = engine.Combatant(name='m', hp=40, max_hp=40, atk=12, dfn=5, spd=6)
    me.armor_strip = strip
    foe = engine.Combatant(name='f', hp=500, max_hp=500, atk=5, dfn=foe_dfn, spd=3)
    return engine._base_hit(me, foe, random.Random(7), stance='aggress')


def test_armor_strip_raises_damage_through_mitigation():
    assert _strip_hit(0) < _strip_hit(6) < _strip_hit(12)


def test_armor_strip_floors_at_zero_def():
    # Stripping past the foe's DEF is capped by the existing max(0, ...) floor,
    # so a full strip is its own ceiling — no negative-DEF damage bonus.
    assert _strip_hit(12) == _strip_hit(30)


def test_armor_strip_defaults_to_zero():
    c = engine.Combatant(name='c', hp=10, max_hp=10, atk=1, dfn=1, spd=1)
    assert c.armor_strip == 0
```

- [ ] **Step 2: Run the tests to verify they fail**

```bash
cd infrastructure/lambda && python -m pytest tests/test_undercity_perks.py -q -k armor_strip
```

Expected: two distinct failures. `Combatant` is a plain (non-frozen) dataclass, so
`me.armor_strip = strip` in the helper succeeds as an ad-hoc attribute — but nothing reads it:

- `test_armor_strip_raises_damage_through_mitigation` — FAIL, `assert 27 < 27` (all three
  strips produce the identical hit, since `_base_hit` ignores the field);
- `test_armor_strip_floors_at_zero_def` — PASSES for the wrong reason (both sides equal);
- `test_armor_strip_defaults_to_zero` — FAIL, `AttributeError: 'Combatant' object has no
  attribute 'armor_strip'` (a fresh instance has no such attribute until it is a real field).

- [ ] **Step 3: Add the field**

In `undercity_engine.py`, in the `Combatant` dataclass's internal battle state block, add after
the `aggress_ramp` line:

```python
    armor_strip: int = field(default=0, repr=False)  # shellsplitter: foe DEF stripped, stacks
```

- [ ] **Step 4: Consume it in `_base_hit`**

In `_base_hit`, replace:

```python
    dfn = max(0, target.dfn - pierce)
```

with:

```python
    dfn = max(0, target.dfn - pierce - striker.armor_strip)
```

And extend the docstring — after the sentence ending `` `pierce` lowers effective DEF before
the ratio.`` add:

```
    The striker's accumulated `armor_strip` (Shellsplitter, ATK-24) is applied on
    top of `pierce` here rather than at each call site, so every strike site
    inherits it and the existing floor doubles as its cap.
```

- [ ] **Step 5: Run the tests to verify they pass**

```bash
cd infrastructure/lambda && python -m pytest tests/test_undercity_perks.py -q
```

Expected: PASS, 50 passed.

- [ ] **Step 6: Commit**

```bash
git add infrastructure/lambda/undercity_engine.py infrastructure/lambda/tests/test_undercity_perks.py
git commit -m "feat(undercity): armor_strip lowers effective DEF at every strike site"
```

---

### Task 4: Shellsplitter — accumulate on a won exchange

**Files:**
- Modify: `infrastructure/lambda/undercity_engine.py` (`resolve_round`, end of the `if winner in ('attacker', 'defender'):` branch, just before `elif winner == 'clash':`)
- Test: `infrastructure/lambda/tests/test_undercity_perks.py`

- [ ] **Step 1: Write the failing tests**

Append to `tests/test_undercity_perks.py`:

```python
def _splitter(perks=frozenset({'shellsplitter'})):
    me = engine.Combatant(name='m', hp=200, max_hp=200, atk=24, dfn=5, spd=6,
                          perks=perks)
    foe = engine.Combatant(name='f', hp=5000, max_hp=5000, atk=5, dfn=12, spd=3)
    return me, foe


def test_shellsplitter_strips_on_a_won_exchange():
    import random
    me, foe = _splitter()
    # aggress > feint: me wins the exchange.
    entries = engine.resolve_round(me, foe, 'aggress', 'feint', 1, random.Random(3))
    assert me.armor_strip == data.SHELLSPLITTER_STRIP
    assert any(e.get('armorStrip') == data.SHELLSPLITTER_STRIP for e in entries)


def test_shellsplitter_accumulates_across_rounds():
    import random
    me, foe = _splitter()
    rng = random.Random(3)
    for rnd in (1, 2, 3):
        engine.resolve_round(me, foe, 'aggress', 'feint', rnd, rng)
    assert me.armor_strip == 3 * data.SHELLSPLITTER_STRIP


def test_shellsplitter_does_not_strip_on_a_loss():
    import random
    me, foe = _splitter()
    # feint < aggress: the foe wins, so no armour comes off.
    engine.resolve_round(me, foe, 'feint', 'aggress', 1, random.Random(3))
    assert me.armor_strip == 0


def test_shellsplitter_strips_on_a_won_guard_exchange_too():
    # "Any won exchange" — holding Guard to survive a round must not cost progress.
    import random
    me, foe = _splitter()
    entries = engine.resolve_round(me, foe, 'guard', 'aggress', 1, random.Random(3))
    assert me.armor_strip == data.SHELLSPLITTER_STRIP
    assert any(e.get('armorStrip') for e in entries)


def test_no_strip_without_the_perk():
    import random
    me, foe = _splitter(perks=frozenset())
    entries = engine.resolve_round(me, foe, 'aggress', 'feint', 1, random.Random(3))
    assert me.armor_strip == 0
    assert not any(e.get('armorStrip') for e in entries)
```

- [ ] **Step 2: Run the tests to verify they fail**

```bash
cd infrastructure/lambda && python -m pytest tests/test_undercity_perks.py -q -k shellsplitter
```

Expected: FAIL — `assert 0 == 2` (nothing accumulates yet).

- [ ] **Step 3: Accumulate on the win**

In `resolve_round`, the `if winner in ('attacker', 'defender'):` branch ends with an
`else:` block whose last statement is `_spikeshell(losr, winr, lose_side, rnd, entries)`.
Add this **after** that whole `if/elif/else` chain, still inside the
`if winner in ('attacker', 'defender'):` branch (8-space indent), immediately before
`elif winner == 'clash':`:

```python
        # Shellsplitter (ATK-24 perk): any won exchange cracks the foe's armour
        # open for the rest of the fight. Applied AFTER this round's damage, so
        # the strip pays off on subsequent hits — and on the triangle result
        # rather than on damage landing, so a dodged punish still counts.
        if winr.has_perk('shellsplitter') and losr.hp > 0:
            winr.armor_strip += data.SHELLSPLITTER_STRIP
            entries.append({'round': rnd, 'by': win_side,
                            'armorStrip': data.SHELLSPLITTER_STRIP,
                            'armorStripTotal': winr.armor_strip})
```

- [ ] **Step 4: Run the tests to verify they pass**

```bash
cd infrastructure/lambda && python -m pytest tests/test_undercity_perks.py -q
```

Expected: PASS, 55 passed.

- [ ] **Step 5: Commit**

```bash
git add infrastructure/lambda/undercity_engine.py infrastructure/lambda/tests/test_undercity_perks.py
git commit -m "feat(undercity): Shellsplitter strips foe DEF on every won exchange"
```

---

### Task 5: Shellsplitter — survive the battle snapshot

**This is the highest-risk task in the plan.** Interactive battles persist between HTTP
requests: each round is a separate Lambda invocation that rebuilds both `Combatant`s from a
stored snapshot. Any mutable field not in all three of `_bt_snapshot` / `_bt_to_combatant` /
`_bt_store` silently resets every round. Without this task Shellsplitter appears to work in
unit tests and does nothing in the actual game.

**Files:**
- Modify: `infrastructure/lambda/undercity_db.py:772-791` (`_bt_snapshot`), `:794-818` (`_bt_to_combatant`), `:821-837` (`_bt_store`)
- Test: `infrastructure/lambda/tests/test_undercity_perks.py`

- [ ] **Step 1: Write the failing test**

Append to `tests/test_undercity_perks.py`:

```python
def test_armor_strip_survives_the_round_boundary():
    # Battles are rebuilt from a stored snapshot on every request, so a strip that
    # does not round-trip resets each round and the perk does nothing in-game.
    doc = {'username': 'x', 'hp': 60, 'maxHp': 60, 'atk': 24, 'def': 5, 'spd': 5,
           'stance': 'fight'}
    c = db._combatant(doc)
    assert c.has_perk('shellsplitter')
    c.armor_strip = 6

    snap = db._bt_snapshot(c)
    assert snap['armor_strip'] == 6
    assert db._bt_to_combatant(snap).armor_strip == 6

    rec_side = {}
    db._bt_store(c, rec_side)
    assert rec_side['armor_strip'] == 6


def test_armor_strip_absent_from_an_old_snapshot_defaults_to_zero():
    doc = {'username': 'x', 'hp': 60, 'maxHp': 60, 'atk': 24, 'def': 5, 'spd': 5,
           'stance': 'fight'}
    snap = db._bt_snapshot(db._combatant(doc))
    del snap['armor_strip']          # a battle stored before this feature shipped
    assert db._bt_to_combatant(snap).armor_strip == 0
```

- [ ] **Step 2: Run the tests to verify they fail**

```bash
cd infrastructure/lambda && python -m pytest tests/test_undercity_perks.py -q -k round_boundary
```

Expected: FAIL — `KeyError: 'armor_strip'`.

- [ ] **Step 3: Add the field to all three functions**

In `_bt_snapshot`, add to the returned dict alongside `'aggress_ramp'`:

```python
        'armor_strip': int(c.armor_strip),
```

In `_bt_to_combatant`, add after the `c.aggress_ramp = ...` line:

```python
    c.armor_strip = int(s.get('armor_strip', 0))
```

In `_bt_store`, add after the `rec_side['aggress_ramp'] = ...` line:

```python
    rec_side['armor_strip'] = int(c.armor_strip)
```

- [ ] **Step 4: Run the tests to verify they pass**

```bash
cd infrastructure/lambda && python -m pytest tests/test_undercity_perks.py -q
```

Expected: PASS, 57 passed.

- [ ] **Step 5: Commit**

```bash
git add infrastructure/lambda/undercity_db.py infrastructure/lambda/tests/test_undercity_perks.py
git commit -m "fix(undercity): persist armor_strip across the battle round boundary"
```

---

### Task 6: Grindstone — Guard chips every round

**Files:**
- Modify: `infrastructure/lambda/undercity_engine.py:460-469` (the Carapace Grind block in `resolve_round`)
- Test: `infrastructure/lambda/tests/test_undercity_perks.py`

- [ ] **Step 1: Write the failing tests**

Append to `tests/test_undercity_perks.py`:

```python
def _tank(perks):
    tank = engine.Combatant(name='t', hp=200, max_hp=200, atk=5, dfn=24, spd=5,
                            perks=perks)
    foe = engine.Combatant(name='f', hp=5000, max_hp=5000, atk=6, dfn=6, spd=6)
    return tank, foe


def test_grindstone_chips_on_a_round_the_tank_wins():
    # guard > aggress: the tank WINS, which is exactly the round Carapace Grind
    # alone skips. Grindstone grinds anyway.
    import random
    tank, foe = _tank(frozenset({'carapace_grind', 'grindstone'}))
    entries = engine.resolve_round(tank, foe, 'guard', 'aggress', 1, random.Random(1))
    assert any(e.get('guardChip') for e in entries)


def test_carapace_grind_alone_skips_a_won_round():
    import random
    tank, foe = _tank(frozenset({'carapace_grind'}))
    entries = engine.resolve_round(tank, foe, 'guard', 'aggress', 1, random.Random(1))
    assert not any(e.get('guardChip') for e in entries)


def _lost_guard_chip(perks):
    """Chip magnitude on a round the tank LOSES (guard < feint), where both the
    plain grind and Grindstone fire — isolating the coefficient."""
    import random
    tank, foe = _tank(perks)
    entries = engine.resolve_round(tank, foe, 'guard', 'feint', 1, random.Random(1))
    return next(e['dmg'] for e in entries if e.get('guardChip'))


def test_grindstone_raises_the_chip_coefficient():
    assert (_lost_guard_chip(frozenset({'carapace_grind', 'grindstone'}))
            > _lost_guard_chip(frozenset({'carapace_grind'})))


def test_grindstone_without_carapace_grind_does_nothing():
    # Unreachable in play (24 implies 12), but the block must not fire on a bare
    # grindestone perk set — the gate is the Guard-chip mechanic itself.
    import random
    tank, foe = _tank(frozenset({'grindstone'}))
    entries = engine.resolve_round(tank, foe, 'guard', 'aggress', 1, random.Random(1))
    assert not any(e.get('guardChip') for e in entries)
```

- [ ] **Step 2: Run the tests to verify they fail**

```bash
cd infrastructure/lambda && python -m pytest tests/test_undercity_perks.py -q -k grindstone_chips
```

Expected: FAIL — `assert not any(...)` passes but `test_grindstone_chips_on_a_round_the_tank_wins`
fails with `assert False` (no chip on a won round yet).

- [ ] **Step 3: Widen the block**

In `resolve_round`, replace the entire Carapace Grind block:

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

with:

```python
    # Carapace Grind (DEF-12 perk): a Guard holder that did NOT win the exchange
    # still grinds the foe for a DEF-scaled chip — converts DEF to offense every
    # round independent of the triangle. Gated on the perk, so NPCs never do it.
    # Grindstone (DEF-24) widens it: the chip lands on EVERY round including the
    # ones the holder wins, at a raised coefficient. That is the turtle's answer
    # to a 560 HP boss, where its problem was output and never survival.
    grind_winner = exchange_winner(a_stance, d_stance)
    for side, s, t, st in (('attacker', attacker, defender, a_stance),
                           ('defender', defender, attacker, d_stance)):
        if not (st == 'guard' and s.has_perk('carapace_grind')
                and s.hp > 0 and t.hp > 0):
            continue
        grinds = s.has_perk('grindstone')
        if not grinds and grind_winner == side:
            continue
        coeff = data.GRINDSTONE_CHIP_COEFF if grinds else data.GUARD_CHIP_COEFF
        chip = max(1, round(_swing_base(s, 'guard') * ramp * coeff))
        t.hp -= chip
        entry = {'round': rnd, 'by': side, 'dmg': chip, 'guardChip': True}
        if grinds:
            entry['grindstone'] = True
        entries.append(entry)
```

- [ ] **Step 4: Run the tests to verify they pass**

```bash
cd infrastructure/lambda && python -m pytest tests/test_undercity_perks.py -q
```

Expected: PASS, 61 passed.

- [ ] **Step 5: Commit**

```bash
git add infrastructure/lambda/undercity_engine.py infrastructure/lambda/tests/test_undercity_perks.py
git commit -m "feat(undercity): Grindstone grinds every round at a raised coefficient"
```

---

### Task 7: Longstride — the roll offers combined destinations

**Files:**
- Modify: `infrastructure/lambda/undercity_db.py:3987-4025` (the Pathfinder branch of `_roll` and the response assembly)
- Test: `infrastructure/lambda/tests/test_undercity_perks.py`

- [ ] **Step 1: Write the failing tests**

Append to `tests/test_undercity_perks.py`:

```python
def test_longstride_unions_the_combined_value(table, monkeypatch):
    act(table, 'join', starter='pest')
    sid = _sid(table)
    doc = db._get_player(table, sid, 'user-alex'); doc['spd'] = 24  # longstride
    db._put_player(table, doc)
    vals = iter([2, 5])
    monkeypatch.setattr(db._rng, 'randint', lambda a, b: next(vals))
    status, resp = act(table, 'roll')
    assert status == 200
    assert sorted(resp['roll']['values']) == [2, 5]
    assert resp['roll']['combined'] == 7

    pos_doc = db._get_player(table, sid, 'user-alex')
    pos = pos_doc['position']
    closed = db._stop_nodes(table, sid, pos_doc)
    blocked = db._blocked_nodes(pos_doc)

    def legal(n):
        return set(engine.legal_destinations(data.MAP_NODES, pos, n, closed, blocked))

    assert set(resp['roll']['destinations']) == legal(2) | legal(5) | legal(7)
    assert pos_doc['pendingMove']['combined'] == 7
    # Note this also covers the design's barrier claim: the expected union is
    # computed with the same _stop_nodes/_blocked_nodes sets the roll uses, so a
    # _legal(combined) that ignored barriers would break the equality.


def test_pathfinder_alone_does_not_combine(table, monkeypatch):
    act(table, 'join', starter='pest')
    sid = _sid(table)
    doc = db._get_player(table, sid, 'user-alex'); doc['spd'] = 12  # pathfinder only
    db._put_player(table, doc)
    vals = iter([2, 5])
    monkeypatch.setattr(db._rng, 'randint', lambda a, b: next(vals))
    status, resp = act(table, 'roll')
    assert status == 200
    assert 'combined' not in resp['roll']
    assert 'combined' not in db._get_player(table, sid, 'user-alex')['pendingMove']


def test_longstride_keeps_values_face_only_for_fleetfoot(table, monkeypatch):
    # A 1 on either FACE must still offer the Fleetfoot reroll; the combined total
    # is not a die face and must not pollute pm['values'].
    act(table, 'join', starter='pest')
    sid = _sid(table)
    doc = db._get_player(table, sid, 'user-alex'); doc['spd'] = 24
    db._put_player(table, doc)
    vals = iter([1, 4])
    monkeypatch.setattr(db._rng, 'randint', lambda a, b: next(vals))
    status, resp = act(table, 'roll')
    assert status == 200
    assert sorted(resp['roll']['values']) == [1, 4]
    assert resp['roll']['combined'] == 5
    assert resp['roll'].get('canReroll') is True


def test_longstride_does_not_apply_to_a_blink(table):
    # Blink names a value, so random_roll is False and nothing combines.
    act(table, 'join', starter='pest')
    sid = _sid(table)
    doc = db._get_player(table, sid, 'user-alex'); doc['spd'] = 24
    db._put_player(table, doc)
    status, resp = act(table, 'roll', value=4, blink=True)
    assert status == 200
    assert resp['roll']['value'] == 4
    assert 'combined' not in resp['roll']
```

- [ ] **Step 2: Run the tests to verify they fail**

```bash
cd infrastructure/lambda && python -m pytest tests/test_undercity_perks.py -q -k longstride
```

Expected: FAIL — `KeyError: 'combined'`.

- [ ] **Step 3: Compute and store the combined value**

In `_roll`, replace the Pathfinder branch:

```python
    # Pathfinder (SPD-10 perk): roll a second die and keep either — destinations
    # are the union of both faces. Only on an ordinary random roll (a chosen
    # value via Blink/loaded die is already deliberate).
    values = None
    if random_roll and 'pathfinder' in perks:
        value2 = _rng.randint(1, 6)
        values = sorted([value, value2])
        dests = sorted(set(_legal(value)) | set(_legal(value2)))
    else:
        dests = sorted(_legal(value))
```

with:

```python
    # Pathfinder (SPD-10 perk): roll a second die and keep either — destinations
    # are the union of both faces. Only on an ordinary random roll (a chosen
    # value via Blink/loaded die is already deliberate).
    # Longstride (SPD-24 perk): the two faces may also be COMBINED, so the union
    # gains the destinations of their sum — up to 12 spaces on one roll. The short
    # destinations stay on the menu, so it is never a forced overshoot. Stored as
    # its own field: `values` stays face-only so Fleetfoot's "showed a 1" check
    # and the client's two-face display are untouched.
    values = None
    combined = None
    if random_roll and 'pathfinder' in perks:
        value2 = _rng.randint(1, 6)
        values = sorted([value, value2])
        dests = set(_legal(value)) | set(_legal(value2))
        if 'longstride' in perks:
            combined = value + value2
            dests |= set(_legal(combined))
        dests = sorted(dests)
    else:
        dests = sorted(_legal(value))
```

Then store it on the pending move — replace:

```python
    pm = {'value': value, 'dests': dests}
    if values:
        pm['values'] = values
```

with:

```python
    pm = {'value': value, 'dests': dests}
    if values:
        pm['values'] = values
    if combined:
        pm['combined'] = combined
```

And surface it in the response — replace:

```python
    roll = {'value': value, 'destinations': dests}
    if values:
        roll['values'] = values
```

with:

```python
    roll = {'value': value, 'destinations': dests}
    if values:
        roll['values'] = values
    if combined:
        roll['combined'] = combined
```

- [ ] **Step 4: Run the tests to verify they pass**

```bash
cd infrastructure/lambda && python -m pytest tests/test_undercity_perks.py -q
```

Expected: PASS, 65 passed.

- [ ] **Step 5: Commit**

```bash
git add infrastructure/lambda/undercity_db.py infrastructure/lambda/tests/test_undercity_perks.py
git commit -m "feat(undercity): Longstride offers the combined-dice destinations"
```

---

### Task 8: Longstride — accept the combined walk everywhere

Four places read `pendingMove['values']` to decide what a pending move may spend. Three of them
must learn about `combined`, and one must not. Missing the ladder/tunnel pair is a real bug, not
a cosmetic gap: a Longstride walk of 9 that lands on a ladder at hop 6 would compute
`allowed = [v for v in (4, 5) if v >= 6] == []`, fall back to `pm['value']`, and silently
discard the remaining 3 steps.

| site | needs `combined`? |
|---|---|
| `_roll` Fleetfoot "showed a 1" check (`1 in (_pm.get('values') or [])`) | **No** — a sum is not a die face |
| `_move` walk validation (`allowed`) | Yes |
| `_move` ladder resume | Yes |
| `_move` tunnel resume | Yes |
| high-five reach (`max(...)`) | Yes |

**Files:**
- Modify: `infrastructure/lambda/undercity_db.py` — new helper near `_move`, then lines `4055`, `4086`, `4104`, `8694`
- Test: `infrastructure/lambda/tests/test_undercity_perks.py`

- [ ] **Step 1: Write the failing tests**

Append to `tests/test_undercity_perks.py`:

```python
def test_pm_values_includes_the_combined_total():
    assert db._pm_values({'value': 4, 'values': [4, 5], 'combined': 9}) == [4, 5, 9]


def test_pm_values_without_longstride():
    assert db._pm_values({'value': 4, 'values': [4, 5]}) == [4, 5]
    assert db._pm_values({'value': 3}) == [3]


def test_move_accepts_a_combined_length_walk(table, monkeypatch):
    act(table, 'join', starter='pest')
    sid = _sid(table)
    doc = db._get_player(table, sid, 'user-alex'); doc['spd'] = 24
    db._put_player(table, doc)
    # 1 + 1 = 2, so the combined walk is a short, easy-to-construct two-hopper.
    monkeypatch.setattr(db._rng, 'randint', lambda a, b: 1)
    status, resp = act(table, 'roll')
    assert status == 200
    assert resp['roll']['combined'] == 2

    pos = db._get_player(table, sid, 'user-alex')['position']
    closed = db._stop_nodes(table, sid, db._get_player(table, sid, 'user-alex'))
    blocked = db._blocked_nodes(db._get_player(table, sid, 'user-alex'))
    # Find a legal 2-hop route: neighbour of a neighbour that is not the start and
    # is not blocked, walking through an open node.
    route = None
    for mid in data.MAP_NODES[pos]['neighbors']:
        if mid in blocked or mid in closed:
            continue
        for end in data.MAP_NODES[mid]['neighbors']:
            if end != pos and end not in blocked:
                route = [pos, mid, end]
                break
        if route:
            break
    assert route, 'map has no open 2-hop route from the spawn gate'

    status, resp = act(table, 'move', to=route[-1], path=route)
    assert status == 200
    assert db._get_player(table, sid, 'user-alex')['position'] == route[-1]


def test_move_still_rejects_an_illegal_length(table, monkeypatch):
    act(table, 'join', starter='pest')
    sid = _sid(table)
    doc = db._get_player(table, sid, 'user-alex'); doc['spd'] = 24
    db._put_player(table, doc)
    monkeypatch.setattr(db._rng, 'randint', lambda a, b: 1)
    act(table, 'roll')          # values [1, 1], combined 2
    pos = db._get_player(table, sid, 'user-alex')['position']
    mid = data.MAP_NODES[pos]['neighbors'][0]
    # A 3-hop path is neither face (1) nor the combined total (2).
    for end in data.MAP_NODES[mid]['neighbors']:
        if end == pos:
            continue
        for far in data.MAP_NODES[end]['neighbors']:
            if far in (mid,):
                continue
            status, _ = act(table, 'move', to=far, path=[pos, mid, end, far])
            assert status == 409
            return
    assert False, 'map has no 3-hop route to test rejection with'
```

- [ ] **Step 2: Run the tests to verify they fail**

```bash
cd infrastructure/lambda && python -m pytest tests/test_undercity_perks.py -q -k "pm_values or combined_length or illegal_length"
```

Expected: FAIL — `AttributeError: module 'undercity_db' has no attribute '_pm_values'`.

- [ ] **Step 3: Add the helper**

In `undercity_db.py`, immediately above `def _move(table, sid, doc, payload):`, add:

```python
def _pm_values(pm):
    """Every hop count a pending move may legally spend: the rolled face(s), plus
    their combined total under Longstride (SPD-24). Used for walk validation, for
    the ladder/tunnel resume that banks leftover steps, and for reach checks.

    Deliberately NOT used by Fleetfoot's "showed a 1" test — a combined total is
    not a die face, so a 1 there must never come from the sum.
    """
    vals = list(pm.get('values') or [pm['value']])
    combined = pm.get('combined')
    if combined:
        vals.append(combined)
    return vals
```

- [ ] **Step 4: Route the four call sites through it**

In `_move`, replace:

```python
        allowed = set(pm.get('values') or [pm['value']])
```

with:

```python
        allowed = set(_pm_values(pm))
```

In the **ladder** resume block, replace:

```python
        allowed = [v for v in (pm.get('values') or [pm['value']]) if v >= hops]
```

with:

```python
        allowed = [v for v in _pm_values(pm) if v >= hops]
```

In the **tunnel** resume block, replace the identical line with the identical replacement:

```python
        allowed = [v for v in _pm_values(pm) if v >= hops]
```

In the high-five reach check (~line 8694), replace:

```python
        reach = max(pm.get('values') or [pm['value']])
```

with:

```python
        reach = max(_pm_values(pm))
```

Leave the Fleetfoot check in `_roll` (`1 in (_pm.get('values') or [])`) exactly as it is.

- [ ] **Step 5: Run the tests to verify they pass**

```bash
cd infrastructure/lambda && python -m pytest tests/test_undercity_perks.py -q
```

Expected: PASS, 69 passed.

- [ ] **Step 6: Run the full suite**

```bash
cd infrastructure/lambda && python -m pytest tests -q
```

Expected: `38 failed, N passed` — **exactly** the 37 `test_deep_dungeons.py` + 1 `test_map.py`
pre-existing failures and nothing else. If any other test fails, it is a regression from this
task: `_move`, ladders, tunnels and high-fives are shared paths.

- [ ] **Step 7: Commit**

```bash
git add infrastructure/lambda/undercity_db.py infrastructure/lambda/tests/test_undercity_perks.py
git commit -m "feat(undercity): accept combined-dice walks in move, ladders, tunnels, reach"
```

---

### Task 9: Client mirrors

No test runner exists for the frontend (Karma/Jasmine was removed — do not try `ng test`).
Verification is `npm run build`.

**Files:**
- Modify: `src/app/undercity/data/perks.ts`
- Modify: `src/app/undercity/services/undercity-models.ts:78-83` and `:910-918`

- [ ] **Step 1: Update the perk mirror**

In `perks.ts`, change the header comment `Nodes at 6/12/18;` to `Nodes at 6/12/18/24;`, then
widen the type and add the entries:

```ts
export interface Perk {
  id: string;
  name: string;
  track: PerkTrack;
  threshold: 6 | 12 | 18 | 24;
  blurb: string;
}

export const PERK_TRACKS: Record<PerkTrack, { threshold: 6 | 12 | 18 | 24; id: string }[]> = {
  atk: [
    { threshold: 6, id: 'brutal_strikes' },
    { threshold: 12, id: 'menace' },
    { threshold: 18, id: 'deathdrive' },
    { threshold: 24, id: 'shellsplitter' },
  ],
  def: [
    { threshold: 6, id: 'thick_hide' },
    { threshold: 12, id: 'carapace_grind' },
    { threshold: 18, id: 'last_stand' },
    { threshold: 24, id: 'grindstone' },
  ],
  spd: [
    { threshold: 6, id: 'fleetfoot' },
    { threshold: 12, id: 'pathfinder' },
    { threshold: 18, id: 'blink' },
    { threshold: 24, id: 'longstride' },
  ],
};
```

And add to the `PERKS` record, after `blink`:

```ts
  shellsplitter: { id: 'shellsplitter', name: 'Shellsplitter', track: 'atk', threshold: 24, blurb: "Every exchange you win cracks the foe's armour open." },
  grindstone: { id: 'grindstone', name: 'Grindstone', track: 'def', threshold: 24, blurb: '+25 Max HP. Guard grinds the foe down every single round.' },
  longstride: { id: 'longstride', name: 'Longstride', track: 'spd', threshold: 24, blurb: 'Combine both dice — travel up to twelve spaces.' },
```

- [ ] **Step 2: Update the wire types**

In `undercity-models.ts`, in `PendingMove`, add after `values?: number[];`:

```ts
  /** Longstride (SPD-24): the two faces' combined total, also a legal walk length. */
  combined?: number;
```

And in the `roll` response type, add after its `values?: number[];`:

```ts
    /** Longstride (SPD-24): the two faces' combined total; its destinations are in the union. */
    combined?: number;
```

- [ ] **Step 3: Build to verify**

```bash
npm run build
```

Expected: build succeeds with no TypeScript errors. The creature tab needs **no** template
change — its perk chain is a generic `@for` over `trackNodes(stat)` and the "next at N" text
derives from `PERK_TRACKS`, so the fourth node renders automatically.

- [ ] **Step 4: Commit**

```bash
git add src/app/undercity/data/perks.ts src/app/undercity/services/undercity-models.ts
git commit -m "feat(undercity): mirror the tier-4 perks on the client"
```

---

### Task 10: Client — the three-way die picker

The board walks node-by-node with an exact-count walker seeded from one chosen value
(`stepping = {path, left: value}`). Pathfinder surfaces a two-face picker; Longstride needs a
third button for the combined total. Two changes, both in `pathfinderPick()`'s contract:

1. offer `[v1, v2, combined]` when `combined` is present;
2. stop returning `null` on matched faces — under Longstride, 3+3 is a real choice between
   moving 3 and moving 6.

**Files:**
- Modify: `src/app/undercity/tabs/board-tab.component.ts` (`pathfinderPick`, and the walk-seeding effect at ~line 1755)
- Modify: `src/app/undercity/tabs/board-tab.component.html:178-192`

- [ ] **Step 1: Update `pathfinderPick`**

Replace:

```ts
  /** Pathfinder (SPD-10): the two advantage faces awaiting a pick, or null when
   *  there's nothing to choose (single die, matched faces, or already walking). */
  protected pathfinderPick(): number[] | null {
    const vals = this.store.you()?.pendingMove?.values;
    if (!vals || vals.length !== 2 || vals[0] === vals[1]) return null;
    if (this.rolling() || this.canReroll() || this.stepping()) return null;
    return vals;
  }
```

with:

```ts
  /** Pathfinder (SPD-10): the two advantage faces awaiting a pick, plus the
   *  combined total under Longstride (SPD-24). Null when there's nothing to
   *  choose (single die, or matched faces with no combine available) or when the
   *  walk is already under way. Matched faces DO offer a choice under Longstride
   *  — 3+3 means "move 3 or move 6". */
  protected pathfinderPick(): number[] | null {
    const pm = this.store.you()?.pendingMove;
    const vals = pm?.values;
    if (!vals || vals.length !== 2) return null;
    if (this.rolling() || this.canReroll() || this.stepping()) return null;
    const combined = pm?.combined;
    if (combined) return [...new Set([...vals, combined])];
    return vals[0] === vals[1] ? null : vals;
  }

  /** True while the pick on offer includes a Longstride combine. */
  protected longstridePick(): boolean {
    return !!this.store.you()?.pendingMove?.combined;
  }
```

- [ ] **Step 2: Keep the walk-seeding guard in step**

In the effect at ~line 1755, replace:

```ts
        const vals = pm.values;
        const needsPick = !!vals && vals.length === 2 && vals[0] !== vals[1];
        if (!needsPick) {
          this.stepping.set({ path: [you.position], left: pm.value });
        }
```

with:

```ts
        // Seeding the walk with only pm.value would strand the other die's (and
        // the Longstride combine's) destinations, since the walker is exact-count.
        const vals = pm.values;
        const needsPick =
          !!vals && vals.length === 2 && (vals[0] !== vals[1] || !!pm.combined);
        if (!needsPick) {
          this.stepping.set({ path: [you.position], left: pm.value });
        }
```

- [ ] **Step 3: Update the picker label**

In `board-tab.component.html`, replace:

```html
      <!-- Pathfinder: keep either die -->
      <div class="band-morph reroll-prompt">
        <div class="reroll-prompt-msg">
          <img class="die-icon" src="undercity/icons/die.png" alt="" />
          <em>Pathfinder</em> — keep either die.
        </div>
```

with:

```html
      <!-- Pathfinder: keep either die. Longstride adds the combined total. -->
      <div class="band-morph reroll-prompt">
        <div class="reroll-prompt-msg">
          <img class="die-icon" src="undercity/icons/die.png" alt="" />
          @if (longstridePick()) {
            <em>Longstride</em> — keep either die, or combine them.
          } @else {
            <em>Pathfinder</em> — keep either die.
          }
        </div>
```

The `@for (v of pick; track v)` loop below it already renders one "Move {{ v }}" button per
value, so the third option needs no template work. `chooseDie` needs no change either — it
seeds the walker with whatever value it is handed, and the server validates the committed path
against `allowed`.

- [ ] **Step 4: Build to verify**

```bash
npm run build
```

Expected: build succeeds with no TypeScript errors.

- [ ] **Step 5: Commit**

```bash
git add src/app/undercity/tabs/board-tab.component.ts src/app/undercity/tabs/board-tab.component.html
git commit -m "feat(undercity): offer the Longstride combine in the die picker"
```

---

### Task 11: Documentation and a stale docstring

**Files:**
- Modify: `CLAUDE.md` (the "Attribute perks" bullet)
- Modify: `specs/2026-07-21-undercity-attribute-perks-design.md` (threshold mechanic section)
- Modify: `infrastructure/lambda/undercity_engine.py` (`resolve_round` docstring)

- [ ] **Step 1: Update CLAUDE.md**

In the "Attribute perks" bullet, replace `ATK/DEF/SPD threshold perks (nodes at 6/12/18,` with
`ATK/DEF/SPD threshold perks (nodes at 6/12/18/24,` and append to the end of that bullet:

```
Tier-4 nodes at 24 (Shellsplitter / Grindstone / Longstride) in [specs/2026-09-07-undercity-tier4-attribute-perks-design.md](specs/2026-09-07-undercity-tier4-attribute-perks-design.md) — 24 is unreachable for a build split across two stats, so mono-ATK and mono-DEF are the boss builds and mono-SPD owns the board.
```

- [ ] **Step 2: Cross-reference the original design**

In `specs/2026-07-21-undercity-attribute-perks-design.md`, in the "Threshold mechanic" section,
replace the line `- Nodes at **6 / 12 / 18**. Unlock is` with:

```markdown
- Nodes at **6 / 12 / 18**, plus a fourth at **24** added 2026-09-07 (see
  [2026-09-07-undercity-tier4-attribute-perks-design.md](2026-09-07-undercity-tier4-attribute-perks-design.md)).
  Unlock is
```

- [ ] **Step 3: Fix the stale frenzy docstring**

This claim is wrong and this design's tuning depends on knowing it is wrong: `_frenzy_from`
returns `FRENZY_START` for every battle kind, so boss and lair fights **do** escalate.

In `resolve_round`'s docstring, replace:

```
    damage. frenzy_from=None (boss/lair) disables the ramp entirely.
```

with:

```
    damage. frenzy_from=None disables the ramp entirely — but note that no caller
    does: undercity_db._frenzy_from returns FRENZY_START for EVERY battle kind,
    boss and lair included, so every fight escalates and none can stalemate.
```

- [ ] **Step 4: Verify nothing broke**

```bash
cd infrastructure/lambda && python -m pytest tests/test_undercity_perks.py -q
```

Expected: PASS, 69 passed.

- [ ] **Step 5: Commit**

```bash
git add CLAUDE.md specs/2026-07-21-undercity-attribute-perks-design.md infrastructure/lambda/undercity_engine.py
git commit -m "docs(undercity): record the 24 nodes; fix stale frenzy docstring"
```

---

### Task 12: Set `GRINDSTONE_CHIP_COEFF` with the simulator

`GRINDSTONE_CHIP_COEFF = 0.8` ships as a **proposal**, not a validated number. It roughly
triples a turtle's damage output, which is the largest single swing in this design.

Note `sim/proto_fix.py` is *not* the right tool here despite having set `GUARD_CHIP_COEFF`: it
exists to prototype rules by monkeypatching the engine *without* editing it, and these perks
are already in the real engine by this point. Measure the shipped rules directly through
`sim/arena.py` instead, isolating each perk by subtracting it from `attribute_perks`.

**Files:**
- Create: `infrastructure/lambda/sim/tier4_check.py`
- Modify: `infrastructure/lambda/undercity_config.py` (`GRINDSTONE_CHIP_COEFF` only)
- Modify: `specs/2026-09-07-undercity-tier4-attribute-perks-design.md` (record measured results)

- [ ] **Step 1: Write the measurement script**

Create `infrastructure/lambda/sim/tier4_check.py`:

```python
"""Tier-4 attribute perk measurement (design 2026-09-07).

Isolates each 24-node's contribution by subtracting it from attribute_perks at
identical stats — so the delta is the PERK, not the six points of raw stat that
came with it — and sweeps GRINDSTONE_CHIP_COEFF to pick the shipping value.

From infrastructure/lambda/:
    python -m sim.tier4_check
"""
import undercity_data as data
import undercity_engine as engine

from sim.arena import enemy_registry, make_leveled_doc, winrate
from sim.bots import Rusher, Speedster, Tank
from sim.driver import Build

TRIALS = 300
BOSS = enemy_registry()['rot_sovereign'][1]

# Each case: label, build, bot policy, the stat it maxes, its tier-4 perk id.
CASES = [
    ('mono-ATK / Aggress', Build('kraul', 'city'),      Rusher,    'atk', 'shellsplitter'),
    ('mono-DEF / Guard',   Build('zombie', 'bone'),     Tank,      'def', 'grindstone'),
    ('mono-SPD / Feint',   Build('squirrel', 'garden'), Speedster, 'spd', 'longstride'),
]

_real_perks = engine.attribute_perks


def _suppress(perk_id):
    """Patch attribute_perks to drop one perk, so the same doc can be measured
    with and without it at identical stats."""
    def patched(player):
        return _real_perks(player) - {perk_id}
    engine.attribute_perks = patched


def _restore():
    engine.attribute_perks = _real_perks


def build_doc(build, policy, stat, value):
    """A level-12 doc forced to `value` in `stat` and 5 elsewhere, at full HP."""
    doc = make_leveled_doc(build, policy(), level=12, seed=1)
    for s in ('atk', 'def', 'spd'):
        doc[s] = value if s == stat else 5
    doc['hp'] = engine.effective_stats(doc)['maxHp']
    return doc


def measure(label, build, policy, stat, perk_id):
    doc = build_doc(build, policy, stat, 24)
    _restore()
    on = winrate(doc, BOSS, policy(), trials=TRIALS, base_seed=7, kind='boss')
    _suppress(perk_id)
    doc_off = build_doc(build, policy, stat, 24)   # rebuild: maxHp depends on perks
    off = winrate(doc_off, BOSS, policy(), trials=TRIALS, base_seed=7, kind='boss')
    _restore()
    delta = (on['mean_dmg'] / off['mean_dmg'] - 1) * 100 if off['mean_dmg'] else 0.0
    print(f"{label:22s} dmg {off['mean_dmg']:7.1f} -> {on['mean_dmg']:7.1f} "
          f"({delta:+5.1f}%)  win {off['winrate']:.0%} -> {on['winrate']:.0%}")
    return on, off


def main():
    print(f"Savra: {BOSS['hp']} HP / atk {BOSS['atk']} / def {BOSS['def']}  "
          f"({TRIALS} trials)\n")
    print('== tier-4 perk contribution at stat 24 ==')
    for case in CASES:
        measure(*case)

    print('\n== GRINDSTONE_CHIP_COEFF sweep (mono-DEF / Guard) ==')
    label, build, policy, stat, _ = CASES[1]
    original = data.GRINDSTONE_CHIP_COEFF
    for coeff in (0.5, 0.6, 0.7, 0.8, 1.0):
        data.GRINDSTONE_CHIP_COEFF = coeff
        doc = build_doc(build, policy, stat, 24)
        r = winrate(doc, BOSS, policy(), trials=TRIALS, base_seed=7, kind='boss')
        print(f"  coeff {coeff:.2f}  mean dmg {r['mean_dmg']:7.1f}  win {r['winrate']:.0%}")
    data.GRINDSTONE_CHIP_COEFF = original


if __name__ == '__main__':
    main()
```

- [ ] **Step 2: Run it**

```bash
cd infrastructure/lambda && python -m sim.tier4_check
```

Expected: a per-case contribution table and the coefficient sweep. Every number printed is a
mean over 300 seeded boss fights, so reruns are reproducible.

- [ ] **Step 3: Sanity-check the output against the design's predictions**

Before choosing a coefficient, confirm the measurements are believable. If any of these is
badly off, the implementation is wrong, not the tuning:

| check | expectation | what a miss means |
|---|---|---|
| mono-ATK damage delta | roughly **+40-50%** | Much higher → the strip is applied to the same round's damage instead of subsequent rounds; re-check where Task 4 placed the accumulation. Near zero → `armor_strip` is not surviving the round boundary (Task 5). |
| mono-SPD damage delta | **~0%** | Longstride has no combat effect; any movement here means a perk id leaked into a combat path. |
| mono-DEF damage delta | large and positive | Near zero → the every-round chip is not firing; check the `grinds` branch in Task 6. |

- [ ] **Step 4: Choose the coefficient**

Acceptance criteria, in priority order:

1. mono-DEF/Guard becomes a viable boss path — in the same league as mono-ATK's `mean_dmg`,
   not obviously better than it;
2. mono-SPD's boss numbers are unchanged (the control above);
3. the value is **above `GUARD_CHIP_COEFF` (0.5)**, or the design's "raised coefficient"
   language and `test_grindstone_raises_the_chip_coefficient` both stop being true.

Set it in `undercity_config.py`, replacing the `SIM-SET` comment's "design proposal" wording
with the measured result and the date.

- [ ] **Step 5: Confirm normal content is unmoved**

The perks should feel enormous against the boss and merely nice in a 3-round trash fight.

```bash
cd infrastructure/lambda && python -m sim.sweep
```

Compare `sim/out/results.md` against the committed baseline: normal, wilderness and dungeon
clear rates should be unchanged. Note the sweep's bot never enters dungeons, so this says
nothing about sigil, treasure or XP pacing — those stay judged from measured export data.

- [ ] **Step 6: Record the measurements in the design doc**

Add a "Measured" subsection under "Balance validation" in
`specs/2026-09-07-undercity-tier4-attribute-perks-design.md`: the per-archetype contribution
table and the coefficient sweep, in the same shape the 2026-07-21 design recorded its
`proto_fix.py` outcome.

- [ ] **Step 7: Verify and commit**

```bash
cd infrastructure/lambda && python -m pytest tests/test_undercity_perks.py -q
```

Expected: PASS, 69 passed. (`test_grindstone_raises_the_chip_coefficient` asserts a strict
inequality against `GUARD_CHIP_COEFF`, so any chosen value above 0.5 keeps it green.)

```bash
git add infrastructure/lambda/sim/tier4_check.py infrastructure/lambda/undercity_config.py specs/2026-09-07-undercity-tier4-attribute-perks-design.md
git commit -m "balance(undercity): set GRINDSTONE_CHIP_COEFF from measured boss sims"
```

---
## Done criteria

- `tests/test_undercity_perks.py` green at 69 tests.
- Full suite shows **only** the 38 pre-existing map failures (37 `test_deep_dungeons.py`, 1 `test_map.py`).
- `npm run build` succeeds.
- `GRINDSTONE_CHIP_COEFF` is a measured value with its `proto_fix.py` results recorded in the design doc.
- **Deploy is the user's to run.** Do not run `cdk deploy`. Finish with tests green and note
  that both a `cdk deploy` (Lambda) and an `npm run deploy` (client) are needed.
