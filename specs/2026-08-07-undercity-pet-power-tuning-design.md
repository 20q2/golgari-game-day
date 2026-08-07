# Undercity — Pet Power Tuning: Duplicate Merge Bonus + Stat-Pet Combat

**Date:** 2026-08-07
**Status:** Design (awaiting review → plan)

## Problem

Two weaknesses in the companion system:

1. **Duplicates aren't special.** After "merge any pet" made fodder fully flat, holding a *same-species* duplicate gives no advantage over any random pet. Pulling a second of a species you're building should feel good.
2. **Attack pets fall off; both combat pets are weak at max.** The attack pet's follow-up is a flat **30% of your hit** that never scales — only its proc chance grows (to 34% at level 9). The defend pet blocks only **2→4**. Given the steep cost to reach a maxed (Mythic, level-9) companion, neither feels influential enough at the top.

## Solution

### 1. Same-species merge bonus (+50%)

Merging stays any-species and flat, but a fodder pet whose species **matches the keeper** is worth **1.5× its merge points, rounded up**:

| Fodder rarity | Base points | Same-species (×1.5, ceil) |
|---|---|---|
| Common (T1) | 1 | 2 |
| Rare (T2) | 3 | 5 |
| Legendary (T3) | 7 | 11 |
| Mythic (T4) | 15 | 23 |

`PET_MERGE_COST` (points to reach a tier: 2 / 3 / 4) is unchanged. A single same-species Common (2 pts) now ranks a Common keeper straight into Rare.

### 2. Attack & defend become mirror-image stat-pets

Both pets become a **scaling % chance** to apply a **scaling flat magnitude**, with identical numbers:

- **Chance** = `0.10 + 0.07·(level − 1)` → 10% at L1, **66% at L9**.
- **Flat** = `floor(2 + 0.75·(level − 1))` → 2 at L1, **8 at L9**.

| Level | Chance | Flat |
|---|---|---|
| 1 | 10% | 2 |
| 2 | 17% | 2 |
| 3 | 24% | 3 |
| 4 | 31% | 4 |
| 5 | 38% | 5 |
| 6 | 45% | 5 |
| 7 | 52% | 6 |
| 8 | 59% | 7 |
| 9 | 66% | 8 |

- **Attack** — on a round you win, `chance` to deal **+flat bonus damage** to the loser. This **replaces** the old "% of your hit" multiplier: the attack contribution is now a flat integer, not a fraction of the triggering hit.
- **Defend** — on a round you take the decisive hit, `chance` to **block flat damage** off it (same mechanic today, just rescaled: chance 12%→ now 10→66%, block 2→4 → now 2→8).

They are deliberately symmetric — same shape, differing only in *deal vs. block* and *win-round vs. lose-round* (offense premium was considered and rejected).

## Architecture

Server is authoritative; client tables mirror for display only.

### Server — `undercity_data.py` `PET_COMBAT`

Reshape to a single symmetric form (per-level chance + per-level flat) for both roles:

```python
PET_COMBAT = {
    'attack': {'chance_base': 0.10, 'chance_per_lvl': 0.07,
               'flat_base': 2, 'flat_per_lvl': 0.75},
    'defend': {'chance_base': 0.10, 'chance_per_lvl': 0.07,
               'flat_base': 2, 'flat_per_lvl': 0.75},
}
```

(The old keys `followup_chance_base/per_lvl`, `followup_mult`, `deflect_chance_base/per_lvl`, `deflect_flat_base/per_lvl` are replaced.)

### Server — `undercity_engine.py`

- `pet_combat(pet, level_bonus=0)` returns `followup_chance`, **`followup_flat`** (int, was `followup_mult`), `deflect_chance`, `deflect_flat`, all from the new symmetric config with `flat = int(flat_base + flat_per_lvl·(lvl−1))`.
- `Combatant` field `pet_followup_mult: float` → **`pet_followup_flat: int`**.
- Attack application (currently `extra = max(1, round(dmg * pet_followup_mult))`) → **`extra = winr.pet_followup_flat`** (still `max(1, …)` guard; only on a decisive win with the loser still alive). Defend application is unchanged in shape (`blocked = min(dmg, pet_deflect_flat)`), only the magnitudes grow.

### Server — `undercity_db.py`

- `_combatant()` passes `pet_followup_flat=pc['followup_flat']` instead of `pet_followup_mult`.
- Battle serialize/deserialize (the `pet_followup_*` keys) rename `pet_followup_mult` → `pet_followup_flat` (int).
- `_merge_pet()` same-species bonus: for each fodder, `pts = PET_MERGE_POINTS[f['tier']]`; if `f['species'] == target['species']`, `pts = math.ceil(pts * 1.5)`. Sum for `gained`. (`import math` if not present, or use integer form `(pts * 3 + 1) // 2`.)

### Client — `src/app/undercity/data/pets.ts`

- Mirror the new `PET_COMBAT` shape.
- `petAbilityStats`:
  - **attack** → `Strike chance` (pct, scaling) + `Bonus damage` (flat int, scaling).
  - **defend** → `Deflect chance` (pct, scaling) + `Damage blocked` (flat int, scaling).
- `mergePointsFor(fodder, keeperSpecies?)` — when `keeperSpecies` is given, add the +50% (ceil) for fodder whose species matches. Keep the no-arg behavior (flat) for any existing callers.

### Client — `creature-tab.component.ts`

`mergeState` computes `points` via `mergePointsFor(selected, keeper.species)` so the preview bar reflects the same-species bonus.

## Data flow

Merge: pick keeper + fodder → client previews points (same-species fodder counted ×1.5) → `merge-pet` → server recomputes authoritatively with the same bonus. Combat: `_combatant` derives the pet's `followup_flat`/`deflect_flat` + chances by level → battle sim applies flat bonus damage / flat block on decisive rounds.

## Testing

`infrastructure/lambda/tests/`:
- **Merge bonus:** a same-species Rare fodder yields 5 points (not 3); a different-species Rare yields 3; a same-species Common (2) ranks a Common keeper into Rare in one merge.
- **`pet_combat` attack:** at L1 `followup_flat == 2`, chance ≈ 0.10; at L9 `followup_flat == 8`, chance ≈ 0.66; returns `followup_flat` (no `followup_mult` key).
- **`pet_combat` defend:** at L9 `deflect_flat == 8`, chance ≈ 0.66.
- **Combat application:** with a forced RNG, an attack pet's proc subtracts exactly `pet_followup_flat` from the loser (not a multiple of the hit); a defend proc blocks up to `pet_deflect_flat`.
- Keep the companions + scout suites green.

Run: `cd infrastructure/lambda && python -m pytest tests -q`. Frontend: `npm run build`.

## Out of scope / non-goals

- No change to level caps, per-level material costs, salvage, or cooldowns.
- No change to forage / scout / economy roles.
- No same-species bonus to *leveling* (the bonus is merge/rarity points only — leveling stays material-driven).
- No offense premium — attack and defend share identical numbers.
