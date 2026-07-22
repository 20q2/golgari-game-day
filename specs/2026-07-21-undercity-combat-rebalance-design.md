# The Undercity — Combat Rebalance (SPD de-god · DEF mitigation · read/AI taming)

**Status:** design · 2026-07-21
**Companion:** [undercity-combat.md](undercity-combat.md) (the living reference — update it when this lands)
**Origin:** playtest report — "every build one-shots everything at level 4–5+, and I took
almost no damage with 6 DEF." Root-caused to SPD, not ATK.

## 1. Problem

Combat at level 4–5+ collapses into "win the first exchange → the fight is over, and I
never got hit." The reporter had **15 SPD / 6 DEF** and one-shot even lair bosses (the
Gitrog Monster) while taking negligible damage. Investigation found three coupled causes.

### 1.1 SPD triple-dips — it is the god-stat

SPD simultaneously buys **damage**, **evasion**, and **initiative**:

1. **Damage.** A Feint's swing is `STANCE_OFFHAND_ATK_WEIGHT×ATK + STANCE_SIG_WEIGHT×SPD`,
   and `STANCE_SIG_WEIGHT` is **1.0** — the *same* full weight DEF gets for Guard. So SPD is
   a first-class damage stat: 15 SPD ≈ a 15-point Feint base, ×1.5 on a win.
2. **Evasion / free wins.** Read chance is `READ_BASE(0.25) + READ_SPD_COEFF(0.015)×SPD`
   → ~48% at SPD 15 (`undercity_db._read_chance`). Every read lets the player play the hard
   counter, *winning* the exchange and taking **zero** that round.
3. **Initiative.** SPD wins clashes (strikes first).

Measured, same statline changing only SPD, vs. the Gitrog Monster (hp 48, def 7, turtle),
4000 seeds, smart-play policy (counter on a read, else Feint):

| Build | Win rate | Rounds to kill | HP taken (of 40) |
|---|---|---|---|
| **SPD 15** | 89% | ~4 (min 2) | **10** |
| SPD 5 | 51% | ~8 | **38** (nearly dead) |

That entire gap is SPD. Every build therefore funnels into SPD.

### 1.2 DEF barely mitigates — "6 DEF felt useless"

A hit is `max(1, swing − DEF)` (`engine._base_hit`), a **flat** subtraction. Against a ~30
swing amplified by `STANCE_WIN_MULT` (1.5), enemy DEF of 2–7 is a rounding error. In this
system you avoid damage by **winning the stance exchange** (reads / Feint-countering the
foe's personality), not by armor. So DEF is a near-dead stat outside the Guard/counter path —
exactly why 6 DEF "felt off." It genuinely did almost nothing.

### 1.3 Reads + boss personality = free wins

Reads are near-auto-wins (a read → play the perfect counter). Compounding it, bosses
telegraph a strong, exploitable personality: the Gitrog is a `turtle` (Guards 60% —
`STANCE_PERSONALITIES`), and **Feint beats Guard**, so blind Feint-spam already wins most
rounds before reads even help. A predictable boss is a Feint-checklist.

### 1.4 Non-goal: enemy-to-player scaling

Rubber-banding enemy stats to the player's level was explicitly rejected — leveling should
*feel* like power, and the game already provides a static, zone-gated difficulty curve
(home fodder → elites → wilderness → dungeons → barriers → boss). The fix bends the **damage
curve**, it does not chase player growth with enemy HP.

## 2. Design — three coupled changes

### 2.1 De-god SPD's damage lane

Split the single `STANCE_SIG_WEIGHT` into two per-stance weights in `undercity_config.py`:

- `GUARD_SIG_WEIGHT = 1.0` — unchanged; DEF keeps its full Guard weight (tank identity).
- `FEINT_SIG_WEIGHT = 0.6` — **down from 1.0**; SPD Feints hit lighter.

`engine._swing_base` picks the weight by stance. Feint becomes the *light trick* stance it is
meant to be: it wins via the triangle, not via raw magnitude. SPD stays valuable for
tempo / reads / initiative — it just is not also a heavy hitter.

### 2.2 DEF becomes proportional mitigation

Replace the flat subtraction in `engine._base_hit`:

```
# before
hit = max(1, swing − max(0, target.dfn − pierce))
# after
dfn = max(0, target.dfn − pierce)
mit = min(MITIGATION_CAP, dfn / (dfn + MITIGATION_K))   # MITIGATION_K = 10, cap = 0.75
hit = max(1, round(swing × (1 − mit)))
```

New scalars in `undercity_config.py`: `MITIGATION_K = 10`, `MITIGATION_CAP = 0.75`.

Effect: DEF 5 soaks ~33%, DEF 6 ~38%, DEF 7 ~41%, DEF 15 ~60%, hard-capped at 75% so nothing
becomes invincible. Armor now visibly reduces incoming damage, symmetric for players and
enemies, and it stretches a fair fight to multiple rounds **without touching enemy HP or
`STANCE_WIN_MULT`**. Existing enemy DEF values are left as-is — they finally matter.

`pierce` (deathtouch) keeps working: it lowers effective DEF *before* the ratio, so a pierce
build eats into the mitigation percentage.

### 2.3 Tame reads + boss AI

Scalars in `undercity_config.py` (read knobs live there / are re-exported through `data`):

- `READ_SPD_COEFF` 0.015 → **0.008** — reads are a smaller, less SPD-monopolized edge.
- `READ_MAX` 0.90 → **0.80** — reads are never near-guaranteed.

Boss / lair guardians in `undercity_data.py`: raise `bluff` **0.20 → 0.35** (bosses only, not
overworld fodder) so a telegraphed turtle can't be blindly Feint-countered every round.
Personality *weight* triples are left unchanged — bluff is the lighter-touch lever.

## 3. Validation

Prototype (all three changes monkeypatched into the real engine), vs. the Gitrog Monster,
4000 seeds:

| Build | Now: win / HP taken | Proposed: win / HP taken · rounds |
|---|---|---|
| SPD dump (8/6/15) | 89% / 10 of 40 | 79% / 20 of 40 · 6 |
| non-SPD (8/6/5) | 51% / 38 | 56% / 35 · 8 |
| DEF tank (6/15/5) | — | 82% / 26 of 50 · 9 |
| ATK (15/6/5) | — | 74% / 22 of 40 · 6 |

Outcome: focused builds land in a **74–82% win band over 6–9 round fights** (real stance
duels), SPD takes ~2× the damage it used to, and the DEF tank is a distinct, survivable,
grinding build. Final numbers to be re-confirmed in `infrastructure/lambda/sim/` against a
spread of foes (fodder, elites, wilderness, each lair boss) before deploy.

## 4. Blast radius

- **Engine** (`undercity_engine.py`): `_swing_base` (per-stance Feint/Guard weight),
  `_base_hit` (proportional mitigation).
- **Config** (`undercity_config.py`): add `GUARD_SIG_WEIGHT`, `FEINT_SIG_WEIGHT`,
  `MITIGATION_K`, `MITIGATION_CAP`; change `READ_SPD_COEFF`, `READ_MAX`. `STANCE_SIG_WEIGHT`
  is retired (or kept as an alias if anything else reads it — audit first).
- **Data** (`undercity_data.py`): boss/lair/barrier `bluff` bumps.
- **Client mirrors** (`src/app/undercity/data/*.ts`): update any duplicated combat constants
  / tooltip copy that describes DEF as flat reduction or SPD as a damage stat.
- **Tests** (`infrastructure/lambda/tests/`): the pytest suite has many **exact-damage
  assertions** baked around `swing − DEF` (e.g. `(15−4)*1.5`) and around the shared
  `STANCE_SIG_WEIGHT`. These must be recomputed for proportional mitigation and the split
  weights. `test_balance_good_play_beats_fodder` must stay green; add/adjust a case that
  asserts a SPD build no longer trivializes a boss and that DEF measurably lowers HP taken.
- **Untouched:** `STANCE_WIN_MULT`, enemy HP tables, personality weight triples, movement,
  spells, perks (though Carapace-Grind / Thick-Hide interact with DEF — re-verify their
  tests, no logic change expected).

## 5. Risks & tuning knobs

- **Mitigation cap vs. tank invincibility.** `MITIGATION_CAP = 0.75` bounds it; a very
  high-DEF late-game unit soaks at most 75%, so bosses (high ATK) still threaten it. Tune the
  cap / `MITIGATION_K` if tanks feel unkillable by fair content.
- **Over-nerfing SPD.** Reads are cut *and* Feint damage is cut; if SPD ends up weak, restore
  some Feint weight (0.6 → 0.7) before touching reads — reads being an information edge, not a
  damage edge, is the intended identity.
- **Guard-path DEF double-count.** DEF now scales Guard offense *and* passive mitigation. This
  is the intended tank identity (hits back on Guard + soaks hits), but watch that the DEF tank
  win-rate (82% in the prototype) doesn't creep above the band once mitigation compounds with
  Carapace Grind — retune `GUARD_CHIP_COEFF` if so.
- **All numbers are provisional** — the sim pass is the gate, not these first-cut values.

## 6. Testing plan

1. Rewrite the affected engine unit tests for the new `_base_hit` / `_swing_base` math.
2. Extend the balance suite: SPD build no longer one-shots a boss; DEF measurably reduces HP
   taken vs. a zero-DEF baseline; every focused build stays inside the target win band.
3. `cd infrastructure/lambda && python -m pytest tests -q` green.
4. Sim sweep in `infrastructure/lambda/sim/` across foe tiers; adjust `MITIGATION_K`,
   `FEINT_SIG_WEIGHT`, read knobs, and boss `bluff` to hit the band.
5. Update the client mirrors + `undercity-combat.md`. Hand off for deploy (user deploys).
