# Undercity Combat — per-stance stat scaling Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Make each combat stance's swing scale off a signature stat (Aggress↔ATK, Guard↔DEF, Feint↔SPD) on top of a universal ATK base, so Defense/Speed builds get offensive payoff from Guard/Feint.

**Architecture:** A one-function change in the pure engine: `_base_hit` gains a required `stance` argument and computes its swing base as `atk + STANCE_STAT_WEIGHT × signatureStat`. All 9 call sites in `resolve_round` pass the striker's stance for that swing; PvP inherits it for free through the shared `resolve_round`. One new tunable, plus display-copy and doc updates.

**Tech Stack:** Python 3.11 engine + pytest. Client display copy in Angular/TS (`combat.ts`). No JS test runner — client verified by `npm run build`. Run `pytest`/`npm` via the Bash tool.

**Design:** `specs/2026-07-19-undercity-stance-stat-scaling-design.md`

**⚠️ Pre-flight (do first):** `git status` — the engine (`undercity_engine.py`), data (`undercity_data.py`), and combat spec are currently committed/clean, but `tests/test_undercity_engine.py` may still carry uncommitted concurrent edits from other work. Confirm what's uncommitted before starting so this change doesn't tangle with it. If the test file has unrelated uncommitted edits, keep your additions in clearly separate regions and stage only the lines you change.

---

## Task 1: Damage-model change in the engine

**Files:**
- Modify: `infrastructure/lambda/undercity_data.py` (add one constant near line 230)
- Modify: `infrastructure/lambda/undercity_engine.py` (`_base_hit` + new `_swing_base` + 9 call sites in `resolve_round`)

- [ ] **Step 1: Add the tunable constant**

In `undercity_data.py`, immediately after the `STANCE_STALL_MULT` line (currently line 229) and before the `# F-vs-F is a whiff` comment, add:

```python
STANCE_STAT_WEIGHT    = 0.5   # each stance's swing += this × its signature stat
                              # (Aggress↔ATK, Guard↔DEF, Feint↔SPD); ATK is the
                              # universal base so it boosts every attack.
```

- [ ] **Step 2: Add the signature-stat helper**

In `undercity_engine.py`, immediately above `def _base_hit(` (currently line 108), add:

```python
# Each stance's swing scales off a signature stat (spec 2026-07-19):
# Aggress↔ATK, Guard↔DEF, Feint↔SPD. ATK (strength) is the universal base on
# every swing, so Aggress double-dips on it.
_STANCE_STAT = {'aggress': 'atk', 'guard': 'dfn', 'feint': 'spd'}


def _swing_base(striker: 'Combatant', stance: str) -> float:
    sig = getattr(striker, _STANCE_STAT.get(stance, 'atk'))
    return striker.atk + data.STANCE_STAT_WEIGHT * sig
```

- [ ] **Step 3: Rewrite `_base_hit` to take a stance**

Replace the whole `_base_hit` function (currently lines 108–116):

```python
def _base_hit(striker: Combatant, target: Combatant, rng, pierce: int = 0) -> int:
    """The raw ATK-vs-DEF hit before stance multipliers. Floors at 1. A pending
    dmg_penalty (from a Serrated feint) is spent here on the striker's next hit."""
    swing = round(striker.atk * rng.uniform(0.85, 1.15))
    hit = max(1, swing - max(0, target.dfn - pierce))
    if striker.dmg_penalty:
        hit = max(1, hit - striker.dmg_penalty)
        striker.dmg_penalty = 0
    return hit
```

with:

```python
def _base_hit(striker: Combatant, target: Combatant, rng, pierce: int = 0,
              *, stance: str) -> int:
    """The raw stance-scaled hit before stance multipliers. The swing base is
    striker.atk (universal) plus STANCE_STAT_WEIGHT × the stance's signature
    stat (Aggress↔ATK, Guard↔DEF, Feint↔SPD). Floors at 1. A pending dmg_penalty
    (from a Serrated feint) is spent here on the striker's next hit."""
    swing = round(_swing_base(striker, stance) * rng.uniform(0.85, 1.15))
    hit = max(1, swing - max(0, target.dfn - pierce))
    if striker.dmg_penalty:
        hit = max(1, hit - striker.dmg_penalty)
        striker.dmg_penalty = 0
    return hit
```

`stance` is keyword-only and required, so any missed call site is an immediate `TypeError` in the tests rather than a silent mis-scaling.

- [ ] **Step 4: Pass the striker's stance at all 9 call sites in `resolve_round`**

Make these exact replacements inside `resolve_round`:

1. Guard beats Aggress — mitigated aggressor hit (loser played aggress):
   - `raw_agg = _base_hit(losr, winr, rng)` → `raw_agg = _base_hit(losr, winr, rng, stance='aggress')`
2. Guard beats Aggress — guard's counter (winner played guard):
   - `raw_ctr = _base_hit(winr, losr, rng)` → `raw_ctr = _base_hit(winr, losr, rng, stance='guard')`
3. Decisive win — headline hit (winner played `win_stance`), which also passes `pierce`:
   - `raw = _base_hit(winr, losr, rng, pierce)` → `raw = _base_hit(winr, losr, rng, pierce, stance=win_stance)`
4. Feint-into-Aggress chip-back (loser played feint):
   - `chip_raw = _base_hit(losr, winr, rng)` → `chip_raw = _base_hit(losr, winr, rng, stance='feint')`
5. Clash (A-vs-A) — both strike (aggress):
   - `raw = _base_hit(s, t, rng)` → `raw = _base_hit(s, t, rng, stance='aggress')`
6. Stall (G-vs-G) — thick carapace chip (guard):
   - `raw = _base_hit(s, t, rng)` → `raw = _base_hit(s, t, rng, stance='guard')`
7. Whiff (F-vs-F) — both poke (feint):
   - `raw = _base_hit(s, t, rng)` → `raw = _base_hit(s, t, rng, stance='feint')`
8. Swarm extra chip — striker's actual round stance. Replace the swarm loop body line:
   - `chip = max(1, round(_base_hit(s, t, rng) * data.SWARM_CHIP_MULT))`
   with:
   ```python
   st = a_stance if side == 'attacker' else d_stance
   chip = max(1, round(_base_hit(s, t, rng, stance=st) * data.SWARM_CHIP_MULT))
   ```

Note there are exactly two `_base_hit(s, t, rng)` calls that become `stance='guard'` (thick stall, item 6) vs `stance='feint'` (whiff, item 7) vs `stance='aggress'` (clash, item 5) — they live in the `elif winner == 'stall'`, `elif winner == 'whiff'`, and `elif winner == 'clash'` branches respectively; match by branch, not by text.

- [ ] **Step 5: Sanity-check the engine imports and parses**

Run: `cd infrastructure/lambda && python -c "import undercity_engine"`
Expected: no output, exit 0 (no syntax/name errors).

- [ ] **Step 6: Commit**

```bash
git add infrastructure/lambda/undercity_data.py infrastructure/lambda/undercity_engine.py
git commit -m "feat(undercity): stance swings scale off signature stats"
```

---

## Task 2: New targeted unit tests

**Files:**
- Modify: `infrastructure/lambda/tests/test_undercity_engine.py` (append 4 tests near the other `resolve_round`/`_base_hit` tests, after `test_round_whiff_nobody_hit`)

- [ ] **Step 1: Add the import and the four tests**

Ensure `_base_hit` is importable in the test module. Near the existing `from undercity_engine import resolve_round` (line 458), add `_base_hit`:

```python
from undercity_engine import resolve_round, _base_hit
```

Then append these four tests (they call `_base_hit` directly against a defenseless target so the swing base is observed cleanly; `FakeRng(uniform=1.0)` makes the roll deterministic):

```python
def test_guard_swing_scales_with_defense():
    lo = fighter(atk=10, dfn=2, spd=5)
    hi = fighter(atk=10, dfn=8, spd=5)
    tgt = fighter(atk=0, dfn=0)
    rng = FakeRng(uniform=1.0)
    lo_hit = _base_hit(lo, tgt, rng, stance='guard')
    hi_hit = _base_hit(hi, tgt, rng, stance='guard')
    assert hi_hit > lo_hit
    assert lo_hit == round(10 + data.STANCE_STAT_WEIGHT * 2)   # 11
    assert hi_hit == round(10 + data.STANCE_STAT_WEIGHT * 8)   # 14


def test_feint_swing_scales_with_speed():
    slow = fighter(atk=10, dfn=5, spd=2)
    fast = fighter(atk=10, dfn=5, spd=8)
    tgt = fighter(atk=0, dfn=0)
    rng = FakeRng(uniform=1.0)
    assert (_base_hit(fast, tgt, rng, stance='feint')
            > _base_hit(slow, tgt, rng, stance='feint'))


def test_aggress_swing_scales_with_strength():
    weak = fighter(atk=6, dfn=5, spd=5)
    strong = fighter(atk=12, dfn=5, spd=5)
    tgt = fighter(atk=0, dfn=0)
    rng = FakeRng(uniform=1.0)
    assert (_base_hit(strong, tgt, rng, stance='aggress')
            > _base_hit(weak, tgt, rng, stance='aggress'))


def test_aggress_swing_ignores_defense_and_speed():
    base = fighter(atk=10, dfn=3, spd=3)
    tanky = fighter(atk=10, dfn=9, spd=9)   # more DEF/SPD, same ATK
    tgt = fighter(atk=0, dfn=0)
    rng = FakeRng(uniform=1.0)
    assert (_base_hit(base, tgt, rng, stance='aggress')
            == _base_hit(tanky, tgt, rng, stance='aggress'))
```

- [ ] **Step 2: Run the new tests**

Run: `cd infrastructure/lambda && python -m pytest tests/test_undercity_engine.py -q -k "swing"`
Expected: 4 passed.

- [ ] **Step 3: Commit**

```bash
git add infrastructure/lambda/tests/test_undercity_engine.py
git commit -m "test(undercity): cover per-stance signature-stat scaling"
```

---

## Task 3: Reconcile existing damage tests

The formula change alters the swing on every hit, so the round-damage tests that
hardcode the old `atk − def` swing must be recomputed. **New swing base** (with
`STANCE_STAT_WEIGHT = 0.5`), then `hit = max(1, round(base·uniform) − max(0, targetDef − pierce))`,
then the branch multiplier:

- Aggress base = `atk + 0.5·atk` = `1.5·atk`
- Guard base   = `atk + 0.5·def`
- Feint base   = `atk + 0.5·spd`

**Rounding is Python's banker's rounding** (`round(12.5) == 12`, `round(0.5) == 0`) — recompute, don't assume half-up.

**Files:**
- Modify: `infrastructure/lambda/tests/test_undercity_engine.py`

- [ ] **Step 1: Run the full engine suite and capture failures**

Run: `cd infrastructure/lambda && python -m pytest tests/test_undercity_engine.py -q`
Expected: multiple failures. The damage-value tests known to break (verify against the run):
`test_round_aggress_beats_feint_full_punish`, `test_round_guard_beats_aggress_mitigate_and_counter`,
`test_round_clash_both_take_full`, `test_swarm_adds_chip_each_round`,
`test_venom_barb_first_win_bonus_once`, `test_rot_breath_first_win_doubles`,
`test_drain_life_heals_on_win`, `test_force_winner_overrides_triangle`,
`test_double_win_for_doubles_winner_damage`, `test_deathtouch_aggress_pierces_def`,
`test_first_bite_wins_clash_order`, `test_deep_biter_boosts_winning_hit`,
`test_spiked_boosts_guard_counter`, `test_trickster_halves_lost_feint_punish`.
(Flag/rot/reveal-only tests — `test_barbed_...`, `test_serrated_...`, `test_glint_...`,
`test_rot_surge_...`, `test_double_guard_...`, `test_rot_stacks_...` — and chips that
still round identically — `test_thick_still_chips_in_a_stall`, `test_double_feint_both_chip`,
`test_round_whiff_nobody_hit` — should stay green; confirm.)

- [ ] **Step 2: Recompute each failing assertion**

For each failing test, replace the magic damage number with the value derived from
the new swing base, keeping the existing style (an inline `# comment` showing the
arithmetic). To get exact values deterministically, compute with the engine itself
rather than by hand — e.g. from `infrastructure/lambda`:

```bash
python -c "from tests.test_undercity_engine import fighter, FakeRng; from undercity_engine import _base_hit; \
print(_base_hit(fighter(atk=10,dfn=5,spd=5), fighter(atk=0,dfn=4), FakeRng(uniform=1.0), stance='aggress'))"
```

Worked example — `test_round_aggress_beats_feint_full_punish` (atk10/def5 attacker
aggress vs atk10/def4/spd5 feint defender):
- attacker aggress swing base = `1.5·10 = 15`; hit = `15 − 4 = 11`; ×`STANCE_WIN_MULT`(1.5) = `round(16.5) = 16`.
- caught feinter chip-back: defender feint base = `10 + 0.5·5 = 12.5 → round 12`; hit = `12 − 5 = 7`; ×`STANCE_STALL_MULT`(0.15) = `round(1.05) = 1`.
- New assertions:
  ```python
  assert d.hp == 30 - round((round(1.5 * 10) - 4) * data.STANCE_WIN_MULT)   # 30 - 16 = 14
  assert a.hp == 30 - round((round(10 + data.STANCE_STAT_WEIGHT * 5) - 5) * data.STANCE_STALL_MULT)  # 30 - 1
  ```
  Prefer expressing the number via the formula (as above) so it stays honest and
  self-documenting; a bare recomputed literal with an arithmetic comment is also
  acceptable where the formula form is unwieldy.

Apply the same recompute to every failing test from Step 1.

- [ ] **Step 3: Re-run until the engine suite is green**

Run: `cd infrastructure/lambda && python -m pytest tests/test_undercity_engine.py -q`
Expected: all passed.

- [ ] **Step 4: Handle the balance invariant**

Run: `cd infrastructure/lambda && python -m pytest tests/test_undercity_engine.py -q -k balance`
If `test_balance_good_play_beats_fodder` fails, open it and adjust only the round-count
expectation (fights now end at least as fast; good play must still win). Do **not**
weaken the "good play beats fodder" intent — if good play no longer wins, stop and
report (that would mean `STANCE_STAT_WEIGHT` is mistuned).

- [ ] **Step 5: Commit**

```bash
git add infrastructure/lambda/tests/test_undercity_engine.py
git commit -m "test(undercity): reconcile combat tests with stance stat scaling"
```

---

## Task 4: Client display copy + docs

**Files:**
- Modify: `src/app/undercity/data/combat.ts:13-17` (stance blurbs)
- Modify: `specs/undercity-combat.md` (§1 magnitude paragraph, §7 tuning knobs)

- [ ] **Step 1: Tell players which stat each stance uses**

In `src/app/undercity/data/combat.ts`, update the three stance blurbs:

```ts
export const STANCES: StanceInfo[] = [
  { id: 'aggress', label: 'Aggress', icon: 'uc-sword', blurb: 'Beats Feint. Loses to Guard. Damage scales with ATK.' },
  { id: 'guard', label: 'Guard', icon: 'shield', blurb: 'Beats Aggress. Loses to Feint. Damage scales with DEF.' },
  { id: 'feint', label: 'Feint', icon: 'bolt', blurb: 'Beats Guard. Loses to Aggress. Damage scales with SPD.' },
];
```

- [ ] **Step 2: Update the combat reference spec**

In `specs/undercity-combat.md` §1, replace the sentence:

```
**Magnitude comes from stats.** A "hit" is
`max(1, round(atk * uniform(0.85,1.15)) - effective_def)` (`engine._base_hit`),
scaled by the matchup multiplier:
```

with:

```
**Magnitude comes from stats.** A "hit" is
`max(1, round((atk + STANCE_STAT_WEIGHT * signature) * uniform(0.85,1.15)) - effective_def)`
(`engine._base_hit`), where the striker's stance picks the signature stat
(Aggress↔ATK, Guard↔DEF, Feint↔SPD) and ATK is the universal base added to every
swing. That hit is then scaled by the matchup multiplier:
```

In §7, add `STANCE_STAT_WEIGHT` to the tuning-knobs list (append it to the first
line of constants after `STANCE_STALL_MULT`).

- [ ] **Step 3: Verify the client build**

Run (repo root): `npm run build`
Expected: build succeeds (pre-existing warnings only; no new errors from `combat.ts`).

- [ ] **Step 4: Commit**

```bash
git add src/app/undercity/data/combat.ts specs/undercity-combat.md
git commit -m "docs(undercity): document per-stance stat scaling (client + spec)"
```

---

## Task 5: Full verification

**Files:** none (verification only)

- [ ] **Step 1: Full Lambda suite**

Run: `cd infrastructure/lambda && python -m pytest tests -q`
Expected: all passed (engine + db + spells + map + admin).

- [ ] **Step 2: Production-config client build**

Run (repo root): `npm run build`
Expected: build succeeds.

- [ ] **Step 3: Optional manual feel check**

Note for the user: the balance is a first pass at `STANCE_STAT_WEIGHT = 0.5`. To
feel it, start a fight in the running app and confirm Guard counters hit harder on
a high-DEF creature and Feints hit harder on a high-SPD creature. Retuning is a
one-number change in `undercity_data.py` (mirror the intent, though the client has
no numeric mirror for it).
