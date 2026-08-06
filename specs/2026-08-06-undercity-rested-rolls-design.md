# Undercity — Rested Rolls

**Date:** 2026-08-06
**Status:** Design approved, ready for implementation plan

## Problem

The roll economy banks 3 rolls per 30-minute tick up to `ROLL_CAP = 15`
([undercity_engine.py](../infrastructure/lambda/undercity_engine.py) `regen_rolls`). At
cap, further regen is silently discarded — the regen timestamp advances even when
full, so overflow simply evaporates.

Two consequences:

1. A 15-roll cap is ~2.5 hours of buffer. That's long enough that the active
   moment-to-moment roll tempo barely matters, and the game plays best in shorter
   bursts.
2. A "game day" is a live 6–8 hour session where players constantly step away
   (food, socializing, other games). Under the current cap, stepping away for more
   than ~2.5h *loses* rolls to the ceiling — the game quietly punishes the natural
   rhythm of the event.

## Goal

Tighten the *active* roll cap so short-burst play feels alive, while ensuring the
overflow you'd otherwise lose during a normal event absence is preserved and paid
back as a satisfying accelerated refill when you return.

This **reinforces** the project's "equal turns, no rubberbanding" principle: nobody
gets a catch-up handout. Players simply stop being penalized for the event's
cadence. The design is deliberately **net-neutral** — being away nets the same total
rolls as playing continuously (up to a ceiling on extreme absence).

## Model

A second per-player resource, **rested**, measured internally **in rolls** (not
display "stacks"). Time-based regen is the only source and sink.

The unit that makes net-neutrality exact: one 30-minute tick is worth
`ROLLS_PER_REGEN` (3) rolls. When full, a tick banks those 3 rolls into `rested`
instead of discarding them. When there's room, a tick pays out **double** (6) by
drawing the extra 3 from `rested`. Over any window, rolls delivered equal rolls that
would have regenerated — until `rested` hits its ceiling.

### Config ([undercity_config.py](../infrastructure/lambda/undercity_config.py))

| Name | Old | New | Meaning |
|------|-----|-----|---------|
| `ROLL_CAP` | 15 | **10** | Active roll bank ceiling (~1.7h of tempo before overflow). |
| `RESTED_CAP` | — | **15** | Overflow protection, in rolls (~5 "stacks" of 3, ~2.5h more). |
| `ROLLS_PER_REGEN` | 3 | 3 | Unchanged. One tick's worth = one conceptual "stack." |

Active 10 + rested 15 ≈ 4.2h of theoretical protection, preserving the ~2.5–3h
"you won't lose turns" feel while keeping the *active* number low. Absence beyond
~4h finally starts costing rolls — the single deliberate exception to strict
neutrality, preventing multi-day no-shows from trickle-refilling forever. All three
values are tunable via the `tune-undercity-balance` skill.

### Engine — rewrite `regen_rolls` ([undercity_engine.py:924](../infrastructure/lambda/undercity_engine.py#L924))

The current aggregate `min(ROLL_CAP, ...)` computation is replaced by a **tick-by-tick**
loop, because per-tick behavior depends on whether the bank is at cap. For each of
the whole `intervals` elapsed since `rollRegenAt`:

- **At cap** (`rolls >= ROLL_CAP`): `rested = min(RESTED_CAP, rested + ROLLS_PER_REGEN)`.
  Do **not** draw from `rested` (no room to deliver it).
- **Below cap:**
  1. `gain = ROLLS_PER_REGEN`.
  2. If `rested > 0`: `bonus = min(rested, ROLLS_PER_REGEN)`; `gain += bonus`;
     `rested -= bonus`. (This is the "double" → up to 6/tick.)
  3. `new_rolls = rolls + gain`. If `new_rolls > ROLL_CAP`, the overshoot pushes
     back: `rested = min(RESTED_CAP, rested + (new_rolls - ROLL_CAP))`;
     `rolls = ROLL_CAP`. Otherwise `rolls = new_rolls`.
- **Early break** once `rolls == ROLL_CAP` and `rested == RESTED_CAP` — a long
  absence must not iterate thousands of times. The remaining intervals are still
  consumed by advancing the timestamp (unchanged: whole intervals only, so partial
  progress toward the next tick is never lost).

Worked example (cap 10, rested>0, `rolls = 9`, one tick): base 3, draw bonus 3 →
`gain = 6`, `new = 15`, overshoot 5 pushed back to `rested`, `rolls = 10`. Net this
tick: rolls +1, rested net +2 (drew 3, returned 5) = +3 total = exactly one tick's
regen. Neutrality holds.

### Direct roll grants — out of scope for v1

`_add_rolls` ([undercity_db.py:960](../infrastructure/lambda/undercity_db.py#L960))
grants rolls from rewards/purchases and already returns a `lost` count when it hits
the cap. For v1 these continue to cap-and-lose exactly as today, so reward economics
are unchanged. The rested mechanic hooks **only** time-based regen
(`regen_rolls`). Routing direct-grant overflow into `rested` is a trivial future
extension (the `lost` value is already surfaced) but is intentionally excluded here
to keep the blast radius small.

### Client

- Mirror the new `ROLL_CAP` wherever it is duplicated under
  `src/app/undercity/data/*.ts`.
- Surface `rested` in the `you` view (it flows through the existing state payload)
  and render it beside the roll counter as a small secondary meter — rolls-denominated
  pips labeled "Rested". **No button**: the payout is automatic on each tick.
- Follow the symbol language: uc-*/Material icons only, no emoji.

## Testing

New `infrastructure/lambda/tests/test_undercity_rested.py` (in-memory FakeTable
style, matching the existing suite):

1. **At-cap banks rested** — full bank + N ticks → `rested` grows by `3*N`, `rolls`
   stays at `ROLL_CAP`.
2. **Below-cap pays double** — `rolls` below cap with `rested > 0` → a tick delivers
   6 and burns 3 of `rested`.
3. **Overshoot pushes back** — the `rolls = 9`, doubled-tick case banks the
   remainder into `rested`, no rolls lost.
4. **`RESTED_CAP` clamps** — rested never exceeds the ceiling; overflow beyond it is
   lost (extreme-absence exception).
5. **Net-neutral cycle** — spend rolls, then regen: total rolls delivered over a
   spend→refill cycle equals the plain-regen total, until the ceiling is hit.
6. **Timestamp discipline** — `rollRegenAt` advances by whole intervals only;
   sub-tick partial progress is preserved.

Run: `cd infrastructure/lambda && python -m pytest tests -q` (keep green).

## Out of scope

- Manual "spend rested" action (decided against — automatic is simpler and
  phone-friendly).
- Rested from direct grants, PvP, or facilities (regen-only for v1).
- Any change to reward/purchase roll economics.
