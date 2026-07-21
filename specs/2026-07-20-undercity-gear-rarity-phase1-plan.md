# Gear Rarity Phase 1 — Scaling Core (Implementation Plan)

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Make gear rider effects scale with rarity (tier) by replacing the flat rider constants with a `RIDER_SCALE` table and a per-combatant `rider_mag` lookup — with **zero new gear content and zero client changes** (those are Phases 2–3).

**Architecture:** One `RIDER_SCALE[rider][tier]` table in `undercity_config.py` (re-exported into `undercity_data` via the existing `from undercity_config import *`). The engine `Combatant` gains a `rider_mag` dict + `mag()` accessor; `undercity_db` builds it from equipped gear and persists it in the battle snapshot. Every rider branch in `undercity_engine.resolve_round` reads `mag(...)` instead of a flat constant. Values are anchored so each rider's **current live magnitude is preserved at the tier it occupies today** (no nerfs); the only intended change is that riders currently sharing T2/T3 magnitude (`deep_biter`/`spiked`/`rabid`/`bulwark`) get a modest T3 buff so the ladder is monotonic.

**Tech Stack:** Python 3.11, pytest (in-memory `FakeTable` suite). Run tests from `infrastructure/lambda`.

**Scope note:** This is Phase 1 of the [Gear Rarity & Scaling spec](2026-07-20-undercity-gear-rarity-design.md). Phase 2 (fill ~28 ladder rungs) and Phase 3 (client rarity badges + scaled blurbs) are separate plans authored after this lands green. `seer`/`glint` read-rate scaling is **not** in `RIDER_SCALE` — it already scales per-piece via the gear `readBonus` field, handled in Phase 2 content.

**Working-tree caution:** `undercity_data.py`, `undercity_db.py`, `undercity_engine.py`, and `tests/` are frequently edited in parallel by the user. Before each task, re-read the target function — anchor on the **function names and rider branches described here**, not on line numbers, which will drift.

---

## The RIDER_SCALE table (reference for all tasks)

Anchored to today's live values (see `undercity_config.py`: `BRAMBLE_REFLECT=2`, `CUTPURSE_SPORES=6`; engine hardcodes: spiked `×1.5`, deep_biter/gutcleaver `mult += 0.5`, rabid `aggress_ramp += 2`, bloodfang `×0.4`, trickster `dmg/2`, serrated `dmg_penalty += 2`, venomtrick/barbed `rot += 1`, bulwark `dfn += 1`, mossback `heal 3`, thick chip = `STANCE_STALL_MULT = 0.15`).

```python
RIDER_SCALE = {
    # rider          {1: common, 2: rare, 3: legendary}   # unit / anchor
    'barbed':        {1: 1,    2: 2,    3: 3},     # rot stacks on Aggress (T1 today=1)
    'bloodfang':     {1: 0.40, 2: 0.50, 3: 0.60},  # heal frac of Aggress-win dmg (T1 today=0.40)
    'deep_biter':    {1: 0.35, 2: 0.50, 3: 0.70},  # +win multiplier (T2 today=0.50; T3 buffed)
    'rabid':         {1: 1,    2: 2,    3: 3},      # +ATK ramp per Aggress win (T2 today=2; T3 buffed)
    'gutcleaver':    {1: 0.35, 2: 0.50, 3: 0.70},  # +win multiplier vs <30% HP (T2 today=0.50)
    'thick':         {1: 0.15, 2: 0.20, 3: 0.25},  # stall chip-through mult (T1 today=0.15)
    'spiked':        {1: 1.3,  2: 1.5,  3: 1.8},    # guard-counter reflect mult (T2 today=1.5; T3 buffed)
    'bramble':       {1: 2,    2: 3,    3: 4},      # flat reflect when struck (T1 today=2)
    'bulwark':       {1: 1,    2: 1,    3: 2},      # +DEF per Guard round (T2 today=1; T3 buffed)
    'mossback':      {1: 2,    2: 3,    3: 4},      # heal per Guard round (T2 today=3)
    'trickster':     {1: 0.50, 2: 0.60, 3: 0.70},  # frac of lost-Feint punish negated (T1 today=0.50)
    'serrated':      {1: 1,    2: 2,    3: 3},      # flat cut to foe next-round dmg (T2 today=2)
    'venomtrick':    {1: 1,    2: 2,    3: 3},      # rot on a winning Feint (T1 today=1)
    'cutpurse':      {1: 4,    2: 6,    3: 9},      # Spores after a won fight w/ Feint (T2 today=6)
}
```

Every existing gear piece keeps its rider's current magnitude at its current tier; the buffs are only to the T3 `deep_biter`/`spiked`/`rabid`/`bulwark` pieces (Wurm Tooth, Troll Hide, Ravening Maw, Ironshell Bulwark) — intended, so Legendary > Rare.

---

## Task 1: Add `RIDER_SCALE` + a monotonicity test

**Files:**
- Modify: `infrastructure/lambda/undercity_config.py` (add the table near the combat scalars)
- Test: `infrastructure/lambda/tests/test_undercity_gear_scaling.py` (new)

- [ ] **Step 1: Write the failing test**

```python
# tests/test_undercity_gear_scaling.py
import undercity_data as data


def test_rider_scale_covers_every_geared_rider():
    """Every rider referenced by a GEAR piece must have a scale row."""
    geared = {g['rider'] for g in data.GEAR.values() if g.get('rider')}
    read_only = {'seer', 'glint'}  # scale via per-piece readBonus, not RIDER_SCALE
    missing = geared - read_only - set(data.RIDER_SCALE)
    assert not missing, f"riders with no RIDER_SCALE row: {missing}"


def test_rider_scale_is_monotonic_non_decreasing():
    for rider, rungs in data.RIDER_SCALE.items():
        assert set(rungs) == {1, 2, 3}, f"{rider} must define tiers 1,2,3"
        assert rungs[1] <= rungs[2] <= rungs[3], f"{rider} ladder not monotonic: {rungs}"
```

- [ ] **Step 2: Run it to verify it fails**

Run: `cd infrastructure/lambda && python -m pytest tests/test_undercity_gear_scaling.py -q`
Expected: FAIL — `AttributeError: module 'undercity_data' has no attribute 'RIDER_SCALE'`.

- [ ] **Step 3: Add the table**

Paste the full `RIDER_SCALE` dict from the reference section above into `undercity_config.py`, directly beneath the existing combat scalars (after `BRAMBLE_REFLECT = 2`). Add a one-line comment: `# Per-rarity rider magnitude ladder (see gear-rarity Phase 1 plan).`

- [ ] **Step 4: Run it to verify it passes**

Run: `cd infrastructure/lambda && python -m pytest tests/test_undercity_gear_scaling.py -q`
Expected: PASS (2 passed).

- [ ] **Step 5: Commit**

```bash
git add infrastructure/lambda/undercity_config.py infrastructure/lambda/tests/test_undercity_gear_scaling.py
git commit -m "feat(undercity): add RIDER_SCALE rarity magnitude ladder + invariants"
```

---

## Task 2: `Combatant.rider_mag` + `mag()` accessor

**Files:**
- Modify: `infrastructure/lambda/undercity_engine.py` (the `Combatant` dataclass)
- Test: `infrastructure/lambda/tests/test_undercity_gear_scaling.py`

- [ ] **Step 1: Write the failing test**

```python
def test_combatant_mag_reads_rider_mag_with_default():
    import undercity_engine as engine
    c = engine.Combatant(name='x', hp=30, max_hp=30, atk=8, dfn=3, spd=5,
                         riders=frozenset({'bramble'}), rider_mag={'bramble': 3})
    assert c.mag('bramble') == 3          # equipped -> scaled value
    assert c.mag('spiked', 1.0) == 1.0    # not equipped -> caller's default
    assert c.mag('spiked') == 0           # not equipped -> default 0
```

- [ ] **Step 2: Run it to verify it fails**

Run: `cd infrastructure/lambda && python -m pytest tests/test_undercity_gear_scaling.py::test_combatant_mag_reads_rider_mag_with_default -q`
Expected: FAIL — `TypeError: __init__() got an unexpected keyword argument 'rider_mag'`.

- [ ] **Step 3: Add the field + accessor**

In the `Combatant` dataclass, add beside `riders`/`buffs` (note `field` is already imported):

```python
    rider_mag: dict = field(default_factory=dict)  # rider tag -> magnitude at equipped tier
```

And beside `has_rider`:

```python
    def mag(self, rider, default=0):
        """Scaled magnitude of an equipped rider (RIDER_SCALE at the gear's tier)."""
        return self.rider_mag.get(rider, default)
```

- [ ] **Step 4: Run it to verify it passes**

Run: `cd infrastructure/lambda && python -m pytest tests/test_undercity_gear_scaling.py -q`
Expected: PASS (3 passed).

- [ ] **Step 5: Commit**

```bash
git add infrastructure/lambda/undercity_engine.py infrastructure/lambda/tests/test_undercity_gear_scaling.py
git commit -m "feat(undercity): Combatant.rider_mag + mag() accessor"
```

---

## Task 3: Build `rider_mag` from gear + persist it in the battle snapshot

`undercity_db._combatant` builds the player Combatant; `_bt_snapshot`/`_bt_to_combatant` persist a battle across polls. Both must carry `rider_mag`, and its float values (0.5, 1.5, …) must survive DynamoDB (which needs `Decimal`, not `float`).

**Files:**
- Modify: `infrastructure/lambda/undercity_db.py` (`_riders` region, `_combatant`, `_bt_snapshot`, `_bt_to_combatant`)
- Test: `infrastructure/lambda/tests/test_undercity_gear_scaling.py`

- [ ] **Step 1: Write the failing test**

```python
def test_combatant_from_doc_has_scaled_rider_mag():
    import undercity_db as db
    # bark_hide = tier-2 'spiked' carapace; RIDER_SCALE['spiked'][2] == 1.5
    doc = {'username': 'p', 'hp': 40, 'level': 1, 'gear': {'carapace': 'bark_hide'}}
    c = db._combatant(doc)
    assert c.mag('spiked', 1.0) == 1.5


def test_battle_snapshot_roundtrips_rider_mag():
    import undercity_db as db, undercity_engine as engine
    c = engine.Combatant(name='p', hp=40, max_hp=40, atk=8, dfn=4, spd=5,
                         riders=frozenset({'spiked'}), rider_mag={'spiked': 1.5})
    restored = db._bt_to_combatant(db._bt_snapshot(c))
    assert restored.mag('spiked', 1.0) == 1.5
```

- [ ] **Step 2: Run it to verify it fails**

Run: `cd infrastructure/lambda && python -m pytest tests/test_undercity_gear_scaling.py -k rider_mag -q`
Expected: FAIL — `_combatant` returns a Combatant whose `mag('spiked',1.0)` is `1.0` (rider_mag empty).

- [ ] **Step 3: Add `_rider_mags`, wire it into `_combatant`, and persist it**

Add beside `_riders`:

```python
def _rider_mags(doc):
    """Map each equipped gear rider -> its magnitude at that piece's tier."""
    out = {}
    for gid in (doc.get('gear') or {}).values():
        g = data.GEAR.get(gid)
        if not g:
            continue
        rider = g.get('rider')
        if rider and rider in data.RIDER_SCALE:
            out[rider] = data.RIDER_SCALE[rider][g['tier']]
    return out
```

In `_combatant(...)`, add to the `Combatant(...)` kwargs (next to `riders=_riders(doc)`):

```python
        rider_mag=_rider_mags(doc),
```

In `_bt_snapshot(c)`, add to the returned dict (keys become DynamoDB attrs):

```python
        'rider_mag': {k: _dyn_num(v) for k, v in c.rider_mag.items()},
```

In `_bt_to_combatant(s)`, add `rider_mag` to the `Combatant(...)` kwargs:

```python
        rider_mag={k: float(v) for k, v in (s.get('rider_mag') or {}).items()},
```

**Float-safety (`_dyn_num`):** the snapshot is written to DynamoDB, which rejects `float`. Check how the module already stores non-integers (grep the file for `Decimal`). If a float→Decimal helper exists, reuse it as `_dyn_num`. If not, add:

```python
from decimal import Decimal
def _dyn_num(v):
    """DynamoDB-safe number: int stays int, float -> Decimal(str(v))."""
    return v if isinstance(v, int) else Decimal(str(v))
```

(The `float(v)` on the read side normalizes Decimal back to float for the engine.)

- [ ] **Step 4: Run it to verify it passes**

Run: `cd infrastructure/lambda && python -m pytest tests/test_undercity_gear_scaling.py -q`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add infrastructure/lambda/undercity_db.py infrastructure/lambda/tests/test_undercity_gear_scaling.py
git commit -m "feat(undercity): build + persist rider_mag from equipped gear"
```

---

## Task 4: Refactor the multiplier/heal riders to read `mag()`

Riders whose effect is a multiplier or heal amount: `spiked`, `deep_biter`, `gutcleaver`, `bloodfang`, `trickster`, `mossback`, `bulwark`. All in `undercity_engine.resolve_round` (and the end-of-round loops).

**Files:**
- Modify: `infrastructure/lambda/undercity_engine.py` (`resolve_round`)
- Test: `infrastructure/lambda/tests/test_undercity_gear_scaling.py`

- [ ] **Step 1: Write the failing test** — Legendary reflects/counters harder than Common. Uses the engine directly with forced stances.

```python
def _duel(rider, mag, foe_stance, my_stance, seed=1):
    """One deterministic round; return total damage dealt to the foe."""
    import undercity_engine as engine, random
    me = engine.Combatant(name='me', hp=100, max_hp=100, atk=10, dfn=5, spd=5,
                          riders=frozenset({rider}), rider_mag={rider: mag})
    foe = engine.Combatant(name='foe', hp=100, max_hp=100, atk=10, dfn=5, spd=5)
    entries = engine.resolve_round(me, foe, my_stance, foe_stance, 1, random.Random(seed))
    return 100 - foe.hp


def test_spiked_counter_scales_with_mag():
    # Guard (me) beats Aggress (foe): my counter is STANCE_GUARD_COUNTER * mag.
    low = _duel('spiked', 1.3, 'aggress', 'guard')
    high = _duel('spiked', 1.8, 'aggress', 'guard')
    assert high > low
```

- [ ] **Step 2: Run it to verify it fails**

Run: `cd infrastructure/lambda && python -m pytest tests/test_undercity_gear_scaling.py::test_spiked_counter_scales_with_mag -q`
Expected: FAIL — counter still uses the hardcoded `1.5`, so `low == high`.

- [ ] **Step 3: Replace the hardcoded values with `mag()`**

In the **Guard-beats-Aggress** branch:

```python
            ctr_mult = data.STANCE_GUARD_COUNTER * winr.mag('spiked', 1.0)
```

In the **decisive-win** branch, replace the deep_biter / gutcleaver / bloodfang / trickster lines:

```python
            mult += winr.mag('deep_biter', 0.0)
            if (win_stance == 'aggress'
                    and losr.max_hp and losr.hp / losr.max_hp < 0.30):
                mult += winr.mag('gutcleaver', 0.0)   # execute a low-HP foe
```
(Delete the two old `if winr.has_rider('deep_biter'): mult += 0.5` / `has_rider('gutcleaver') … mult += 0.5` blocks; the `mag` default of 0 makes the check implicit.)

```python
                elif win_stance == 'aggress' and winr.has_rider('bloodfang'):
                    heal = round(dmg * winr.mag('bloodfang', 0.0))
                    winr.hp = min(winr.max_hp, winr.hp + heal); entry['heal'] = heal
```

```python
            if lose_stance == 'feint' and losr.has_rider('trickster'):
                dmg = round(dmg * (1 - losr.mag('trickster', 0.0)))
```

In the **end-of-round Guard** loop, replace bulwark/mossback:

```python
        if c.has_rider('bulwark'):
            c.dfn += c.mag('bulwark', 0)
        if c.has_rider('mossback') and c.hp < c.max_hp:
            heal = min(c.mag('mossback', 0), c.max_hp - c.hp)
            c.hp += heal
            entries.append({'round': rnd, 'by': side, 'heal': heal})
```

- [ ] **Step 4: Run it to verify it passes**

Run: `cd infrastructure/lambda && python -m pytest tests/test_undercity_gear_scaling.py -q`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add infrastructure/lambda/undercity_engine.py infrastructure/lambda/tests/test_undercity_gear_scaling.py
git commit -m "refactor(undercity): multiplier/heal riders read rider_mag"
```

---

## Task 5: Refactor the flat rot/reflect/debuff riders to read `mag()`

Riders adding flat stacks/damage/penalties: `bramble`, `barbed`, `venomtrick`, `serrated`, `rabid`, and the `thick` stall chip.

**Files:**
- Modify: `infrastructure/lambda/undercity_engine.py` (`_bramble`, `resolve_round`)
- Test: `infrastructure/lambda/tests/test_undercity_gear_scaling.py`

- [ ] **Step 1: Write the failing test**

```python
def test_bramble_reflect_scales_with_mag():
    import undercity_engine as engine, random
    def reflect(mag):
        me = engine.Combatant(name='me', hp=100, max_hp=100, atk=10, dfn=5, spd=5,
                              riders=frozenset({'bramble'}), rider_mag={'bramble': mag})
        foe = engine.Combatant(name='foe', hp=100, max_hp=100, atk=30, dfn=0, spd=9)
        # foe wins Aggress vs my Feint -> foe strikes me -> bramble reflects `mag`
        engine.resolve_round(me, foe, 'feint', 'aggress', 1, random.Random(3))
        return 100 - foe.hp
    assert reflect(4) > reflect(2)


def test_venomtrick_rot_scales_with_mag():
    import undercity_engine as engine, random
    def applied(mag):
        me = engine.Combatant(name='me', hp=100, max_hp=100, atk=10, dfn=5, spd=9,
                              riders=frozenset({'venomtrick'}), rider_mag={'venomtrick': mag})
        foe = engine.Combatant(name='foe', hp=100, max_hp=100, atk=10, dfn=5, spd=1)
        engine.resolve_round(me, foe, 'feint', 'guard', 1, random.Random(1))  # my Feint beats Guard
        return foe.rot_stacks
    assert applied(3) > applied(1)
```

- [ ] **Step 2: Run it to verify it fails**

Run: `cd infrastructure/lambda && python -m pytest tests/test_undercity_gear_scaling.py -k "bramble or venomtrick" -q`
Expected: FAIL — flat `BRAMBLE_REFLECT` / `+1 rot` don't vary with `mag`.

- [ ] **Step 3: Replace the flat constants with `mag()`**

`_bramble(...)` — reflect the struck combatant's scaled amount:

```python
def _bramble(struck, striker, struck_side, rnd, entries):
    amt = struck.mag('bramble', 0)
    if amt and striker.hp > 0:
        striker.hp -= amt
        entries.append({'round': rnd, 'by': struck_side, 'dmg': amt, 'retaliation': True})
```

In `resolve_round`, the **winning-Feint** block (`serrated`/`venomtrick`) and **rabid**:

```python
                if winr.has_rider('serrated'):
                    losr.dmg_penalty += winr.mag('serrated', 0)
                ...
                if winr.has_rider('venomtrick') and losr.hp > 0:
                    n = winr.mag('venomtrick', 0)
                    losr.rot_stacks += n
                    entries.append({'round': rnd, 'by': win_side, 'rotApplied': n})
```
```python
            if win_stance == 'aggress' and winr.has_rider('rabid'):
                winr.aggress_ramp += winr.mag('rabid', 0)
```

The **barbed** end-of-round loop (also covers the `rot_surge` buff — keep that path at +1):

```python
        if st == 'aggress' and t.hp > 0 and (s.has_rider('barbed') or s.has_buff('rot_surge')):
            n = s.mag('barbed', 0) or 1   # buff-only source (no gear) still applies 1
            t.rot_stacks += n
            entries.append({'round': rnd, 'by': side, 'rotApplied': n})
```

The **stall** branch — `thick` chips at its scaled mult, the frenzy path stays at `STANCE_STALL_MULT`:

```python
            if s.has_rider('thick'):
                raw = _base_hit(s, t, rng, stance='guard', ramp=ramp)
                _deal(s, t, side, rnd, raw, s.mag('thick', 0), entries, tag='chip')
            elif ramp > 1.0:
                raw = _base_hit(s, t, rng, stance='guard', ramp=ramp)
                _deal(s, t, side, rnd, raw, data.STANCE_STALL_MULT, entries, tag='chip')
```

- [ ] **Step 4: Run it to verify it passes**

Run: `cd infrastructure/lambda && python -m pytest tests/test_undercity_gear_scaling.py -q`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add infrastructure/lambda/undercity_engine.py infrastructure/lambda/tests/test_undercity_gear_scaling.py
git commit -m "refactor(undercity): flat rot/reflect/debuff riders read rider_mag"
```

---

## Task 6: Cutpurse payout reads the scaled magnitude

`cutpurse_bonus` (in `undercity_db.py`) currently pays the flat `data.CUTPURSE_SPORES`.

**Files:**
- Modify: `infrastructure/lambda/undercity_db.py` (`cutpurse_bonus`)
- Test: `infrastructure/lambda/tests/test_undercity_gear_scaling.py`

- [ ] **Step 1: Write the failing test**

```python
def test_cutpurse_bonus_uses_scaled_mag():
    import undercity_db as db
    # cutpurse_charm = tier-2 -> RIDER_SCALE['cutpurse'][2] == 6
    doc = {'gear': {'charm': 'cutpurse_charm'}}
    assert db.cutpurse_bonus(doc, feint_won=True, won=True) == 6
    assert db.cutpurse_bonus(doc, feint_won=False, won=True) == 0
    assert db.cutpurse_bonus({'gear': {}}, feint_won=True, won=True) == 0
```

- [ ] **Step 2: Run it to verify it fails**

Run: `cd infrastructure/lambda && python -m pytest tests/test_undercity_gear_scaling.py::test_cutpurse_bonus_uses_scaled_mag -q`
Expected: PASS by coincidence *only if* `CUTPURSE_SPORES == RIDER_SCALE['cutpurse'][2] == 6`. To force a real check, temporarily assert a tier-1 cutpurse would pay 4 — but no T1 cutpurse exists yet (Phase 2). So instead verify the code path: the test above should pass; then confirm the source no longer references `CUTPURSE_SPORES` (Step 3 grep).

- [ ] **Step 3: Rewrite `cutpurse_bonus`**

```python
def cutpurse_bonus(doc, feint_won, won):
    """Flat Spores a Cutpurse charm pays after a won fight in which the player
    landed a winning Feint. Scales with the charm's rarity via RIDER_SCALE."""
    if not (won and feint_won):
        return 0
    return _rider_mags(doc).get('cutpurse', 0)
```

Verify no stragglers: `grep -n CUTPURSE_SPORES infrastructure/lambda/*.py` should show only the (now-unused) definition in `undercity_config.py`; leave the constant in place (harmless) or delete it if nothing references it.

- [ ] **Step 4: Run it to verify it passes**

Run: `cd infrastructure/lambda && python -m pytest tests/test_undercity_gear_scaling.py -q`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add infrastructure/lambda/undercity_db.py infrastructure/lambda/tests/test_undercity_gear_scaling.py
git commit -m "refactor(undercity): cutpurse payout reads scaled rider_mag"
```

---

## Task 7: Full suite green + balance invariant

**Files:** none (verification task).

- [ ] **Step 1: Run the whole Undercity suite**

Run: `cd infrastructure/lambda && python -m pytest tests -q`
Expected: PASS. The existing `test_balance_good_play_beats_fodder` must still pass — the anchoring preserves current values at current tiers, so fodder outcomes are unchanged. If any existing rider test asserted an exact hardcoded number (e.g. a bramble reflect of 2), it should still pass because the equipped piece's tier maps to the same value; if a test constructed a `Combatant` with `riders=` but no `rider_mag=`, update that test to also pass `rider_mag=` (the effect now reads `mag()`, which defaults to 0/1.0 without it).

- [ ] **Step 2: Grep for any Combatant test missing rider_mag**

Run: `grep -rn "riders=frozenset" infrastructure/lambda/tests`
For each hit that exercises a rider's *magnitude* in combat, add the matching `rider_mag={...}`. Re-run the suite.

- [ ] **Step 3: Commit any test fixups**

```bash
git add infrastructure/lambda/tests
git commit -m "test(undercity): pass rider_mag where combat magnitude is exercised"
```

---

## Self-review checklist (done while authoring)

- **Spec coverage:** Phase 1 items — `RIDER_SCALE` (Task 1), `Combatant.rider_mag`+`mag()` (Task 2), build+persist from gear (Task 3), engine reads magnitude at every rider branch (Tasks 4–5), cutpurse (Task 6), suite/balance green (Task 7). `seer`/`glint` explicitly deferred to Phase 2 (readBonus). Ladder-fill + client badges are Phases 2–3.
- **Placeholders:** none — every code step shows the code.
- **Type consistency:** `mag(rider, default=0)` used everywhere; multiplier call sites pass `1.0`, additive sites pass `0`/omit. `_rider_mags` used by both `_combatant` and `cutpurse_bonus`. `rider_mag` persisted via `_dyn_num` and restored via `float()`.
- **Anchor correctness:** values preserve each rider's current magnitude at its current tier; only T3 `deep_biter`/`spiked`/`rabid`/`bulwark` change (intended buff for monotonicity).
```
