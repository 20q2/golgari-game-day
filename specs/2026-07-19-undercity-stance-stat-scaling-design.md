# Undercity Combat — per-stance stat scaling

**Date:** 2026-07-19
**Status:** Design approved, pending implementation plan
**Area:** Undercity sub-game — interactive combat damage model

## Summary

Make each combat stance's damage scale off a different stat, so builds that
invest in Defense or Speed get real offensive payoff from playing Guard or
Feint — while Strength (the `atk` stat) stays the universal damage stat that
boosts every attack.

- **Aggress** swing scales with **Strength** (`atk`)
- **Guard** swing scales with **Defense** (`def`)
- **Feint** swing scales with **Speed** (`spd`)
- **Strength (`atk`) is added to every swing** regardless of stance, so it
  boosts all attacks; Aggress therefore double-dips on Strength (its signature
  stat *and* the universal base).

Scaling weight: **0.5×** the signature stat. Applies to **every** swing a
striker makes in its current stance (headline hits, guard counters, feint
chip-backs, clashes, whiff/stall chips, swarm).

There is no separate "strength" stat in the game — `atk` *is* strength. `def`
and `spd` are the existing Defense and Speed stats (`Combatant.dfn` /
`Combatant.spd`).

## Current model (what changes, what doesn't)

All interactive-combat damage flows through one pure function,
`engine._base_hit(striker, target, rng, pierce=0)`
(`infrastructure/lambda/undercity_engine.py`):

```python
swing = round(striker.atk * rng.uniform(0.85, 1.15))
hit   = max(1, swing - max(0, target.dfn - pierce))
```

`resolve_round` then scales that `hit` by the matchup multiplier
(`STANCE_WIN_MULT`, `STANCE_GUARD_MITIGATE`, `STANCE_GUARD_COUNTER`,
`STANCE_CLASH_MULT`, `STANCE_STALL_MULT`). The stance multipliers are
**unchanged** by this design — only the swing *base* changes.

## New model

`_base_hit` gains a `stance` parameter (the striker's stance for that swing):

```python
STANCE_STAT_WEIGHT = 0.5   # new tunable in undercity_data.py

_SIGNATURE = {'aggress': 'atk', 'guard': 'dfn', 'feint': 'spd'}

def _swing_base(striker, stance):
    sig = getattr(striker, _SIGNATURE.get(stance, 'atk'))  # atk|dfn|spd
    return striker.atk + data.STANCE_STAT_WEIGHT * sig

# inside _base_hit:
swing = round(_swing_base(striker, stance) * rng.uniform(0.85, 1.15))
hit   = max(1, swing - max(0, target.dfn - pierce))
```

Worked examples with typical stats (`atk 8, def 3, spd 5`), before the stance
multiplier:

| Stance  | signature | swing base            |
|---------|-----------|-----------------------|
| Aggress | atk 8     | 8 + 0.5·8 = **12**    |
| Guard   | def 3     | 8 + 0.5·3 = **9.5**   |
| Feint   | spd 5     | 8 + 0.5·5 = **10.5**  |

The target's Defense is still subtracted from the swing exactly as today, and
`pierce` still reduces the target's effective Defense. Damage still floors at 1.

## Call-site stance mapping

Every one of the 9 `_base_hit` call sites in `resolve_round` already has an
unambiguous striker stance for the swing; each passes it explicitly:

| Call site (branch) | Striker | Stance passed |
|---|---|---|
| Guard beats Aggress — mitigated aggressor hit | loser | `aggress` |
| Guard beats Aggress — guard's counter | winner | `guard` |
| Decisive win (A>F or F>G) — headline hit | winner | `win_stance` (`aggress`/`feint`) |
| Feint-into-Aggress chip-back | loser | `feint` |
| Clash (A-vs-A) — both strike | each side | `aggress` |
| Stall (G-vs-G) — thick carapace chip | each side | `guard` |
| Whiff (F-vs-F) — both poke | each side | `feint` |
| Swarm extra chip | each side | that side's round stance (`a_stance`/`d_stance`) |

`_base_hit`'s `stance` argument is required (no silent default) so a missed
call site is a test failure, not a quiet mis-scaling.

## PvP

Interactive PvE and the one-shot PvP resolver (`resolve_battle` →
`resolve_battle_rounds` → `resolve_round`) share `resolve_round`, so PvP inherits
the new scaling automatically. No separate PvP code path to touch.

## Tuning + mirrors

- **`STANCE_STAT_WEIGHT = 0.5`** added beside the other `STANCE_*` constants in
  `undercity_data.py`.
- **Client mirror:** add `STANCE_STAT_WEIGHT` to the combat balance mirror in
  `src/app/undercity/data/*.ts` (the file that already mirrors the stance
  multipliers). If any combat help/tooltip text describes how stances deal
  damage, update it to mention the per-stance stat.
- **Combat spec:** update the "Magnitude comes from stats" paragraph in
  `specs/undercity-combat.md` §1 and the tuning-knobs list in §7 to document
  `STANCE_STAT_WEIGHT` and the signature-stat rule.

## Balance impact & testing

This increases damage on every swing (Aggress most: a decisive Aggress goes from
`1.5·atk` to ~`2.25·atk` before defense), so fights end faster.

- **New unit tests** in `test_undercity_engine.py` (monkeypatch `rng.uniform`
  to 1.0 for determinism): a Guard counter's damage rises when the guarding
  combatant's `def` rises; a winning Feint's damage rises with `spd`; a winning
  Aggress's damage rises with `atk`; and raising `def`/`spd` does **not** change
  an Aggress hit (proving the signature is stance-specific).
- **Keep `test_balance_good_play_beats_fodder` green.** Expect its round-count
  expectations to need loosening (good play still beats fodder — just faster). If
  the change makes fights *too* swingy in that test, note it; retuning
  `STANCE_STAT_WEIGHT` is a one-number change, not a redesign.

## Non-goals

- No new stats; `atk`/`def`/`spd` only.
- No change to the stance triangle, the matchup multipliers, rot/swarm/rider
  effects, or the Collapse.
- No change to `effective_stats` — gear/buff stat totals feed in unchanged;
  this only reinterprets how the finalized stats drive the swing.

## Coordination risk (implementation-time)

`undercity_engine.py`, `undercity_data.py`, and `test_undercity_engine.py`
currently have **uncommitted concurrent changes** from in-progress
combat-collapse / loot-puzzle work by another session. Before implementing this
design, confirm that work is committed or otherwise settled, so this change does
not tangle with it. Re-check `git status` at the start of implementation.
