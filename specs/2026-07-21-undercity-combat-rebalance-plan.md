# Undercity Combat Rebalance Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** De-god SPD, make DEF proportional mitigation, and tame reads/boss AI so combat is a multi-round stance duel instead of a first-exchange one-shot — without scaling enemies to the player.

**Architecture:** All rules are server-side pure functions in `infrastructure/lambda/undercity_engine.py`, driven by scalars in `undercity_data.py`. Three coupled changes: (1) split the shared Feint/Guard signature weight so Feint scales less on SPD; (2) replace flat `swing − DEF` with proportional mitigation `swing × (1 − DEF/(DEF+K))`; (3) lower the SPD read coefficient/cap and raise boss bluff. Balance is verified with the existing sim harness in `infrastructure/lambda/sim/`.

**Tech Stack:** Python 3.11, pytest (in-memory `FakeTable` suite). Client mirrors are TypeScript (Angular) display-only.

**Design doc:** [specs/2026-07-21-undercity-combat-rebalance-design.md](2026-07-21-undercity-combat-rebalance-design.md)

**Run the suite from `infrastructure/lambda/`:** `python -m pytest tests -q` (Windows: use the Bash tool; `python`, not `python3`).

**The new damage formula (authoritative — every recomputed test value derives from this):**

```
swing_base(aggress) = atk × (1 + STANCE_STAT_WEIGHT)              # 1.5, unchanged
swing_base(guard)   = STANCE_OFFHAND_ATK_WEIGHT×atk + GUARD_SIG_WEIGHT×def   # 0.5×atk + 1.0×def
swing_base(feint)   = STANCE_OFFHAND_ATK_WEIGHT×atk + FEINT_SIG_WEIGHT×spd   # 0.5×atk + 0.6×spd

_base_hit:  raw = swing_base × ramp × uniform(0.85,1.15)
            dfn = max(0, target.def − pierce)
            mitigation = min(MITIGATION_CAP, dfn / (dfn + MITIGATION_K))
            hit = max(1, round(raw × (1 − mitigation)))
```

Oracle for recomputing any exact-value test (uniform=1.0, ramp=1.0):

```python
def expected_hit(swing_base, target_def, pierce=0, K=10.0, CAP=0.75):
    d = max(0, target_def - pierce)
    mit = min(CAP, d / (d + K))
    return max(1, round(swing_base * (1 - mit)))
```

---

## Task 1: Add the new tunables, retire `STANCE_SIG_WEIGHT`

**Files:**
- Modify: `infrastructure/lambda/undercity_data.py` (the stance-multiplier block, around `STANCE_SIG_WEIGHT` ~line 341, and the read block ~lines 379–380)
- Test: `infrastructure/lambda/tests/test_undercity_engine.py` (append near the other constant checks)

- [ ] **Step 1: Write the failing test**

Append to `tests/test_undercity_engine.py`:

```python
def test_rebalance_tunables_exist_and_are_sane():
    # SPD de-god: Feint leans less on its signature stat than Guard does.
    assert data.GUARD_SIG_WEIGHT == 1.0
    assert data.FEINT_SIG_WEIGHT == 0.6
    assert data.FEINT_SIG_WEIGHT < data.GUARD_SIG_WEIGHT
    # DEF mitigation curve.
    assert data.MITIGATION_K == 10.0
    assert 0.0 < data.MITIGATION_CAP <= 1.0
    # Reads tamed.
    assert data.READ_SPD_COEFF == 0.008
    assert data.READ_MAX == 0.80
    # The single shared weight is gone (replaced by the two above).
    assert not hasattr(data, 'STANCE_SIG_WEIGHT')
```

- [ ] **Step 2: Run test to verify it fails**

Run: `python -m pytest tests/test_undercity_engine.py::test_rebalance_tunables_exist_and_are_sane -q`
Expected: FAIL (`AttributeError: module 'undercity_data' has no attribute 'GUARD_SIG_WEIGHT'`).

- [ ] **Step 3: Edit `undercity_data.py`**

Replace the existing `STANCE_SIG_WEIGHT = 1.0 ...` line (in the `STANCE_*` block ~line 341) with:

```python
# Per-stance signature-stat weight (spec 2026-07-21 rebalance). Guard keeps DEF's
# full weight (the tank's identity); Feint's SPD weight is lowered so SPD is a
# tempo/read stat, not also a heavy damage stat. Replaces the old single
# STANCE_SIG_WEIGHT (Guard↔DEF and Feint↔SPD used to share it at 1.0).
GUARD_SIG_WEIGHT = 1.0
FEINT_SIG_WEIGHT = 0.6

# DEF is proportional mitigation, not flat subtraction (spec 2026-07-21). A hit is
# scaled by (1 - def/(def+MITIGATION_K)), capped at MITIGATION_CAP so nothing is
# invincible. def5 ~33%, def7 ~41%, def15 ~60% reduction.
MITIGATION_K = 10.0
MITIGATION_CAP = 0.75
```

In the read block (~lines 379–380) change the two constants in place:

```python
READ_MAX = 0.80             # cap so a read is never near-guaranteed (was 0.90)
READ_SPD_COEFF = 0.008      # faster creatures read better, but SPD no longer
                            # monopolises reads (was 0.015)
```

- [ ] **Step 4: Run test to verify it passes**

Run: `python -m pytest tests/test_undercity_engine.py::test_rebalance_tunables_exist_and_are_sane -q`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add infrastructure/lambda/undercity_data.py infrastructure/lambda/tests/test_undercity_engine.py
git commit -m "feat(undercity): add combat-rebalance tunables (split sig weight, DEF mitigation, tamed reads)"
```

---

## Task 2: Split Feint/Guard signature weight in `_swing_base`

**Files:**
- Modify: `infrastructure/lambda/undercity_engine.py` — `_swing_base` (lines ~125–139)
- Test: `infrastructure/lambda/tests/test_undercity_engine.py`

- [ ] **Step 1: Write the failing test**

Append to `tests/test_undercity_engine.py` (it uses the existing `fighter`/`FakeRng` helpers and the module-level `_base_hit` import at line 546):

```python
def test_feint_swing_leans_lighter_on_spd_than_guard_on_def():
    # Same magnitude in the signature stat: a Feint (SPD) should now swing for
    # less than a Guard (DEF), because FEINT_SIG_WEIGHT < GUARD_SIG_WEIGHT.
    guarder = fighter(atk=10, dfn=12, spd=0)
    feinter = fighter(atk=10, dfn=0, spd=12)
    tgt = fighter(atk=0, dfn=0)
    rng = FakeRng(uniform=1.0)
    guard_hit = _base_hit(guarder, tgt, rng, stance='guard')
    feint_hit = _base_hit(feinter, tgt, rng, stance='feint')
    assert guard_hit == round(0.5 * 10 + 1.0 * 12)   # 17
    assert feint_hit == round(0.5 * 10 + 0.6 * 12)   # 12
    assert feint_hit < guard_hit
```

- [ ] **Step 2: Run test to verify it fails**

Run: `python -m pytest tests/test_undercity_engine.py::test_feint_swing_leans_lighter_on_spd_than_guard_on_def -q`
Expected: FAIL (`feint_hit == 17`, still using the old 1.0 weight).

- [ ] **Step 3: Edit `_swing_base` in `undercity_engine.py`**

Replace the non-aggress return (the last two lines of `_swing_base`) so the weight is chosen per stance:

```python
def _swing_base(striker: 'Combatant', stance: str) -> float:
    if stance == 'aggress':
        # Aggress double-dips on ATK (str is the aggressor's whole identity):
        # swing = atk + STANCE_STAT_WEIGHT × atk. Rabid adds a flat, stacking ramp.
        base = striker.atk * (1 + data.STANCE_STAT_WEIGHT) + striker.aggress_ramp
        # Deathdrive (ATK-15 perk): berserker — swing harder while below half HP.
        if (striker.has_perk('deathdrive') and striker.max_hp
                and striker.hp < 0.5 * striker.max_hp):
            base *= (1 + data.DEATHDRIVE_MULT)
        return base
    # Guard/Feint lean on their OWN signature stat, but at DIFFERENT weights:
    # Guard↔DEF at full weight (tank), Feint↔SPD lighter (SPD is a tempo stat,
    # not a heavy hitter). Both take only a partial ATK base.
    sig = getattr(striker, _STANCE_STAT[stance])
    sig_weight = data.GUARD_SIG_WEIGHT if stance == 'guard' else data.FEINT_SIG_WEIGHT
    return data.STANCE_OFFHAND_ATK_WEIGHT * striker.atk + sig_weight * sig
```

- [ ] **Step 4: Run the new test + the swing-scaling tests**

Run: `python -m pytest tests/test_undercity_engine.py -q -k "swing or feint or guard"`
Expected: the new test PASSES; `test_feint_swing_scales_with_speed` and `test_aggress_swing_*` still PASS (they only assert monotonicity/independence). `test_guard_swing_scales_with_defense` still PASSES numerically (7 and 13) but its assertion references `data.STANCE_SIG_WEIGHT`, which no longer exists — it will error. Fix it in Step 5.

- [ ] **Step 5: Fix the `STANCE_SIG_WEIGHT` reference**

In `tests/test_undercity_engine.py` `test_guard_swing_scales_with_defense` (~lines 595–596) rename the constant (values are unchanged, 7 and 13):

```python
    assert lo_hit == round(data.STANCE_OFFHAND_ATK_WEIGHT * 10 + data.GUARD_SIG_WEIGHT * 2)  # 7
    assert hi_hit == round(data.STANCE_OFFHAND_ATK_WEIGHT * 10 + data.GUARD_SIG_WEIGHT * 8)  # 13
```

Then run `python -m pytest tests/test_undercity_engine.py -q -k "swing or feint or guard"` — expected: all PASS.

- [ ] **Step 6: Commit**

```bash
git add infrastructure/lambda/undercity_engine.py infrastructure/lambda/tests/test_undercity_engine.py
git commit -m "feat(undercity): Feint scales lighter on SPD than Guard on DEF (de-god SPD)"
```

---

## Task 3: Proportional DEF mitigation in `_base_hit`

**Files:**
- Modify: `infrastructure/lambda/undercity_engine.py` — `_base_hit` (lines ~142–155)
- Test: `infrastructure/lambda/tests/test_undercity_engine.py` (new test + recompute broken exact-value assertions)

- [ ] **Step 1: Write the failing test**

Append to `tests/test_undercity_engine.py`:

```python
def test_def_is_proportional_mitigation():
    # A raw aggress swing of 15 (atk10) against increasing DEF is reduced by a
    # fraction def/(def+10), capped at 0.75. Not a flat subtraction.
    striker = fighter(atk=10, dfn=0, spd=0)
    rng = FakeRng(uniform=1.0)
    assert _base_hit(striker, fighter(atk=0, dfn=0), rng, stance='aggress') == 15   # no DEF
    assert _base_hit(striker, fighter(atk=0, dfn=5), rng, stance='aggress') == 10   # 15×(1−5/15)=10
    assert _base_hit(striker, fighter(atk=0, dfn=10), rng, stance='aggress') == 8   # 15×0.5=7.5→8
    # Cap: even absurd DEF cannot reduce below 25% of the swing.
    big = fighter(atk=100, dfn=0, spd=0)   # aggress swing 150
    assert _base_hit(big, fighter(atk=0, dfn=1000), rng, stance='aggress') == round(150 * 0.25)  # 38
    # pierce eats into the mitigation, not the final damage.
    assert (_base_hit(striker, fighter(atk=0, dfn=10), rng, stance='aggress', pierce=5)
            == _base_hit(striker, fighter(atk=0, dfn=5), rng, stance='aggress'))
```

- [ ] **Step 2: Run test to verify it fails**

Run: `python -m pytest tests/test_undercity_engine.py::test_def_is_proportional_mitigation -q`
Expected: FAIL (old flat formula gives 10 for def5 but 5 for def10, and no cap).

- [ ] **Step 3: Edit `_base_hit` in `undercity_engine.py`**

Replace the body of `_base_hit` (keep the signature and docstring intent):

```python
def _base_hit(striker: Combatant, target: Combatant, rng, pierce: int = 0,
              *, stance: str, ramp: float = 1.0) -> int:
    """The raw stance-scaled hit before stance multipliers. The swing base comes
    from _swing_base (Aggress↔ATK, Guard↔DEF, Feint↔SPD, at per-stance weights).
    DEF is PROPORTIONAL mitigation: the swing is scaled by (1 - def/(def+K)),
    capped at MITIGATION_CAP so nothing is invincible; `pierce` lowers effective
    DEF before the ratio. `ramp` is the Collapse escalation factor. Floors at 1.
    A pending dmg_penalty (Serrated feint) is spent here on the striker's next hit."""
    raw = _swing_base(striker, stance) * ramp * rng.uniform(0.85, 1.15)
    dfn = max(0, target.dfn - pierce)
    mitigation = min(data.MITIGATION_CAP, dfn / (dfn + data.MITIGATION_K))
    hit = max(1, round(raw * (1 - mitigation)))
    if striker.dmg_penalty:
        hit = max(1, hit - striker.dmg_penalty)
        striker.dmg_penalty = 0
    return hit
```

- [ ] **Step 4: Run the new test**

Run: `python -m pytest tests/test_undercity_engine.py::test_def_is_proportional_mitigation -q`
Expected: PASS.

- [ ] **Step 5: Recompute the broken exact-value assertions**

Run the full engine suite: `python -m pytest tests/test_undercity_engine.py -q`

Most `resolve_round` exact-value tests still pass (at test-scale stats, mitigation rounds to the same value as the old flat subtraction). The known change is `test_round_guard_beats_aggress_mitigate_and_counter` (~line 569): the guard-counter raw hit is now `round((0.5×10 + 1.0×5) × (1 − 5/15)) = round(10 × 0.6667) = 7`, so `round(7 × 0.6) = 4`, giving `a.hp == 26` (was 27). Update it:

```python
    # guard counter base 0.5*10 + 1.0*5 = 10, ×(1−5/15)=7, *0.6 => round(4.2)=4
    assert a.hp == 26
```

For any *other* assertion that fails, recompute its expected value with the `expected_hit(...)` oracle at the top of this plan using that test's `fighter(...)` stats and the stance/mult in play, then update the literal and its inline comment. Do **not** weaken an assertion to a range — recompute the exact number. Worked reference values (uniform=1.0):

- aggress swing atk10 → 15; vs def4 → hit 11; vs def5 → hit 10; vs def0 → 15.
- guard swing atk10/def5 → 10; vs def5 target → hit 7.
- feint swing atk10/spd5 → 8; vs def5 target → hit 5.

- [ ] **Step 6: Run the whole engine suite to green**

Run: `python -m pytest tests/test_undercity_engine.py -q`
Expected: PASS (all).

- [ ] **Step 7: Commit**

```bash
git add infrastructure/lambda/undercity_engine.py infrastructure/lambda/tests/test_undercity_engine.py
git commit -m "feat(undercity): DEF becomes proportional mitigation (armor visibly matters)"
```

---

## Task 4: Confirm reads are tamed (constants already changed in Task 1)

**Files:**
- Test: `infrastructure/lambda/tests/test_undercity_db.py`

The `READ_SPD_COEFF`/`READ_MAX` values changed in Task 1. The existing read tests (`test_read_chance_rises_with_reader_passive_and_gear` ~line 1963, and the SPD test ~line 1922) reference `data.READ_*` symbolically, so they stay valid. Add one test that pins the taming intent.

- [ ] **Step 1: Write the test**

Append to `tests/test_undercity_db.py`:

```python
def test_reads_no_longer_monopolised_by_spd():
    # A high-SPD build reads better but nowhere near the old ~48% at SPD 15, and
    # the cap holds below 0.90.
    base = {'atk': 6, 'def': 6, 'spd': 15}
    chance = db._read_chance(base)
    assert chance == data.READ_BASE + data.READ_SPD_COEFF * 15      # 0.25 + 0.12 = 0.37
    assert chance < 0.40
    # Nothing can exceed the tightened cap.
    assert db._read_chance({'atk': 0, 'def': 0, 'spd': 999}) == data.READ_MAX == 0.80
```

- [ ] **Step 2: Run test to verify it passes**

Run: `python -m pytest tests/test_undercity_db.py::test_reads_no_longer_monopolised_by_spd -q`
Expected: PASS (Task 1 already set the constants).

- [ ] **Step 3: Run the read-related tests**

Run: `python -m pytest tests/test_undercity_db.py -q -k "read"`
Expected: PASS (all).

- [ ] **Step 4: Commit**

```bash
git add infrastructure/lambda/tests/test_undercity_db.py
git commit -m "test(undercity): pin tamed read chance (SPD no longer monopolises reads)"
```

---

## Task 5: Raise boss / guardian bluff

**Files:**
- Modify: `infrastructure/lambda/undercity_data.py` — `LAIR_BOSSES` (~lines 731–750), `BARRIER_GUARDIANS` (~lines 717–724)
- Test: `infrastructure/lambda/tests/test_undercity_db.py`

- [ ] **Step 1: Write the failing test**

Append to `tests/test_undercity_db.py`:

```python
def test_bosses_and_guardians_bluff_enough_to_resist_feint_spam():
    # A telegraphing turtle can't be blindly hard-countered every round.
    for spec in data.LAIR_BOSSES.values():
        assert spec['bluff'] >= 0.35, spec['name']
    for spec in data.BARRIER_GUARDIANS.values():
        assert spec['bluff'] >= 0.30, spec['name']
```

- [ ] **Step 2: Run test to verify it fails**

Run: `python -m pytest tests/test_undercity_db.py::test_bosses_and_guardians_bluff_enough_to_resist_feint_spam -q`
Expected: FAIL (current lair bluffs are 0.20–0.25; guardians 0.15–0.20).

- [ ] **Step 3: Edit `undercity_data.py`**

In every `LAIR_BOSSES` entry set `'bluff': 0.35` (raise the `0.20` values; Skullbriar's `0.25` also becomes `0.35`). In both `BARRIER_GUARDIANS` entries set `'bluff': 0.30` (from `0.15`/`0.20`). Leave personality weights and all other stats unchanged.

- [ ] **Step 4: Run test to verify it passes**

Run: `python -m pytest tests/test_undercity_db.py::test_bosses_and_guardians_bluff_enough_to_resist_feint_spam -q`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add infrastructure/lambda/undercity_data.py infrastructure/lambda/tests/test_undercity_db.py
git commit -m "feat(undercity): bosses/guardians bluff harder (resist blind Feint-spam)"
```

---

## Task 6: Balance regression tests — SPD no longer trivialises, DEF measurably mitigates

**Files:**
- Test: `infrastructure/lambda/tests/test_undercity_engine.py`

These lock in the two player-facing outcomes from the design so a future tune can't silently regress them. They exercise `resolve_round` directly with a smart-play policy (no board setup needed).

- [ ] **Step 1: Write the tests**

Append to `tests/test_undercity_engine.py` (uses `fighter`, `pick_stance`, `telegraph`, `resolve_round`, `data`, and Python's `random`):

```python
import random as _random
from undercity_engine import pick_stance, telegraph

_CTR = {'guard': 'feint', 'aggress': 'guard', 'feint': 'aggress'}

def _fight_vs_gitrog(atk, dfn, spd, hp, read_chance, seeds=1500):
    """Smart-play a build against the Gitrog Monster (turtle, hp48/def7); return
    (win_rate, median_hp_taken)."""
    taken = []
    wins = 0
    for seed in range(seeds):
        rng = _random.Random(seed)
        class R:
            uniform = staticmethod(lambda a, b: rng.uniform(a, b))
            random = staticmethod(rng.random)
            randint = staticmethod(rng.randint)
            choice = staticmethod(rng.choice)
        p = fighter(name='P', hp=hp, max_hp=hp, atk=atk, dfn=dfn, spd=spd)
        g = fighter(name='G', hp=48, max_hp=48, atk=12, dfn=7, spd=5)
        for rnd in range(1, 25):
            actual = pick_stance('turtle', R)
            shown = telegraph(actual, 0.35, R)
            ps = _CTR[shown] if R.random() < read_chance else 'feint'
            resolve_round(p, g, ps, actual, rnd, R, frenzy_from=data.FRENZY_START)
            if g.hp <= 0 or p.hp <= 0:
                wins += 1 if (g.hp <= 0 and p.hp > 0) else 0
                taken.append(hp - max(0, p.hp))
                break
        else:
            taken.append(hp - max(0, p.hp))
    taken.sort()
    return wins / seeds, taken[len(taken) // 2]

def test_spd_build_no_longer_trivialises_a_boss():
    rc = min(data.READ_MAX, data.READ_BASE + data.READ_SPD_COEFF * 15)
    _win, taken = _fight_vs_gitrog(8, 6, 15, 40, rc)
    # Used to take ~10 of 40 and win ~89%; now it must actually bleed.
    assert taken >= 16, f'SPD build only took {taken} — still too safe'

def test_def_measurably_reduces_damage_taken():
    rc = min(data.READ_MAX, data.READ_BASE + data.READ_SPD_COEFF * 5)
    _w_low, taken_low = _fight_vs_gitrog(8, 2, 5, 50, rc)
    _w_high, taken_high = _fight_vs_gitrog(8, 15, 5, 50, rc)
    # Same HP pool, same offense — armor must visibly lower HP lost.
    assert taken_high < taken_low, f'DEF did nothing: {taken_high} vs {taken_low}'
```

- [ ] **Step 2: Run the tests**

Run: `python -m pytest tests/test_undercity_engine.py -q -k "trivialise or measurably"`
Expected: PASS. If `test_spd_build_no_longer_trivialises_a_boss` fails (SPD still too safe), that's a signal to tune in Task 7 — lower `FEINT_SIG_WEIGHT` toward 0.5 or `READ_SPD_COEFF` — not to weaken the assertion.

- [ ] **Step 3: Commit**

```bash
git add infrastructure/lambda/tests/test_undercity_engine.py
git commit -m "test(undercity): lock in SPD-no-longer-trivialises and DEF-mitigates outcomes"
```

---

## Task 7: Full-suite green + sim sweep to the target band

**Files:**
- Read/run: `infrastructure/lambda/sim/` (`arena.py`, `driver.py`, `sweep.py`)
- Possibly tune: `infrastructure/lambda/undercity_data.py` (the Task 1 constants)

- [ ] **Step 1: Run the whole suite**

Run: `python -m pytest tests -q`
Expected: PASS (all). In particular `test_balance_good_play_beats_fodder` (a level-1 kraul vs Drudge Beetle with perfect reads) must still show ≥18/20 wins — perfect play still composts fodder. If any unrelated exact-value test now fails, recompute it with the oracle (Task 3, Step 5) and fix inline.

- [ ] **Step 2: Sim sweep across enemy tiers**

The arena (`sim/arena.py`) builds a creature at a controlled level+gear and fights it against every enemy tier (fodder → elite → wilderness → each lair boss → finale) using the real engine. Run the existing sweep entry point and read its summary:

Run: `python -m sim.sweep` (from `infrastructure/lambda/`; if the module name differs, run `python sim/driver.py` — check `sim/README.md` for the current entry point).
Expected: focused builds (ATK / DEF / SPD) land in roughly a 70–85% win band against tier-appropriate foes over 6–9 round fights, and no build one-shots a lair boss.

- [ ] **Step 3: Tune if outside the band**

If a build is out of band, adjust ONE knob at a time in `undercity_data.py` and re-run Step 2, in this order of preference (per the design's risk notes):
- Tanks unkillable → lower `MITIGATION_CAP` (0.75→0.70) or raise `MITIGATION_K` (10→12).
- SPD still dominant → lower `FEINT_SIG_WEIGHT` (0.6→0.5) before touching reads further.
- SPD too weak → raise `FEINT_SIG_WEIGHT` back toward 0.7 (reads staying tamed is the intended identity).
After any change, re-run `python -m pytest tests -q` (the Task 6 tests will catch overshoots) and re-run the sweep. **Log any knob you changed** in the design doc's §5.

- [ ] **Step 4: Commit (only if a knob changed)**

```bash
git add infrastructure/lambda/undercity_data.py
git commit -m "balance(undercity): tune combat rebalance constants to the target win band"
```

---

## Task 8: Update client mirror copy + combat reference doc

**Files:**
- Modify: `src/app/undercity/data/combat.ts` (stance blurbs ~lines 15–17)
- Modify: `specs/undercity-combat.md` (§1 and §7)
- Verify build: `npm run build` (from repo root — lint is known-broken in this repo; use the build to verify TS compiles)

No numeric combat constants are mirrored in the client (verified — `combat.ts` is display copy only), so this is copy + doc accuracy, not logic.

- [ ] **Step 1: Update the Guard/Feint stance blurbs in `combat.ts`**

In the `STANCES` array (~lines 15–17), reflect that DEF now mitigates and Feint is a lighter hit:

```typescript
  { id: 'guard', label: 'Guard', icon: 'shield', blurb: 'Beats Aggress. Loses to Feint. DEF hits back and soaks incoming damage.' },
  { id: 'feint', label: 'Feint', icon: 'bolt', blurb: 'Beats Guard. Loses to Aggress. A quick SPD strike — wins the read, not the slugfest.' },
```

- [ ] **Step 2: Update `specs/undercity-combat.md`**

- §1: change the hit description from `... ) - effective_def` (flat) to the proportional form: the swing is scaled by `(1 − def/(def+MITIGATION_K))`, capped at `MITIGATION_CAP`.
- §1: note the signature weights are now per-stance (`GUARD_SIG_WEIGHT` for Guard, `FEINT_SIG_WEIGHT` for Feint), replacing the single `STANCE_SIG_WEIGHT`.
- §7: in the tuning-knob list replace `STANCE_STAT_WEIGHT` neighbours' `STANCE_SIG_WEIGHT` with `GUARD_SIG_WEIGHT`, `FEINT_SIG_WEIGHT`, and add `MITIGATION_K`, `MITIGATION_CAP`. Note `READ_SPD_COEFF`/`READ_MAX` retuned and boss `bluff` raised.

- [ ] **Step 3: Verify the client compiles**

Run: `npm run build`
Expected: build succeeds (TypeScript compiles; the copy change has no type impact).

- [ ] **Step 4: Commit**

```bash
git add src/app/undercity/data/combat.ts specs/undercity-combat.md
git commit -m "docs(undercity): mirror combat rebalance in client copy + combat reference"
```

---

## Done criteria

- `python -m pytest tests -q` green (from `infrastructure/lambda/`).
- Task 6 regression tests pass: a SPD build bleeds against a boss; DEF measurably lowers HP taken.
- Sim sweep shows focused builds in the ~70–85% band over multi-round fights; no build one-shots a lair boss.
- Client builds; combat reference doc updated.
- **Deploy is the user's job** — hand off with the suite green and note that the Lambda needs a `cdk deploy` for the balance change to reach the live game (the client reads state from live AWS).
