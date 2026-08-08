# Undercity — Backdated New Night (host recovery tool)

**Date:** 2026-08-08
**Status:** Approved, implementing

## Problem

A bug was found mid-session and the host needs to restart the night. Restarting
wipes everyone's creature and forces a fresh hatch — but with a plain "New Night"
each fresh character spawns with only `JOIN_ROLLS` (3), losing the ~2 hours of
roll economy players had accrued before the restart.

The host wants to start a fresh night stamped with a chosen *past* start time, so
every new character spawns with the rolls it would have accrued since then.

## Key insight — reuse existing seeding

New characters already seed their roll bank from `config.startedAt`:
`_join` → `_seed_night_rolls` sets `rollRegenAt = startedAt` and runs
`engine.regen_rolls(..., bank_rested=False)`, which banks `ROLLS_PER_REGEN` (3)
per full `ROLL_REGEN_MINUTES` (30) since the night start, capped at `ROLL_CAP` (10).

So a night backdated ≥ ~1.7h makes a fresh character spawn at the 10-roll cap;
a smaller backdate gives proportionally fewer. **Backdating `startedAt` is the whole
mechanism — no new roll-granting code path.**

`config.startedAt` feeds only (a) the night-start time shown in state and (b) this
seeding. It does **not** drive shop / world-event / lobby windows (verified: no
other reads of `startedAt` in the Lambda). Backdating is therefore side-effect-free
beyond the intended seeding and the displayed start clock.

## Decisions

- **Preserve progression.** Use the existing archive-then-mint flow
  (`season-start`): the current night's Renown banks into perm docs on archive;
  no cosmetics / lifetime stats are wiped. (The heavier `reset-all` wipe is *not*
  used here.)
- **Date/time picker** for the start time (a `datetime-local`, like the existing
  lobby control), not an "hours-ago" field.

## Backend — `undercity_db.py` `_season_start`

- Accept an optional `startedAt` ISO string in the payload.
- Normalize + validate: parse (stripping any `Z`/offset), re-emit as naive-UTC
  seconds to match `_now()`. Reject a non-parseable value (`400`) and reject a
  future timestamp (`400`) — a future start would break regen math.
- Use the normalized value in place of `_now()` when stamping `startedAt` on the
  active night (both the fresh-mint branch and the lobby-promotion branch).
- **Omitted `startedAt` → unchanged behavior** (`startedAt` = now, fresh chars get
  only `JOIN_ROLLS`). No existing caller regresses.

## Client — `host-panel.component.ts` (Host controls panel)

Home is the Host controls panel, alongside New Night / End Night (already has a
`datetime-local` for the lobby countdown).

- Add a `datetime-local` input, prefilled to **now − 2h**, plus a
  **"Start Backdated Night"** button.
- Convert local wall-clock → UTC ISO (`new Date(value).toISOString()`, same as the
  lobby control) and call `season-start` with `{ hostKey, startedAt }`.
- Two-tap confirm guard (like End Night) — starting a night archives the running one.

## Tests — `infrastructure/lambda/tests/`

1. `season-start` with a backdated `startedAt` stamps `config.startedAt` to that value.
2. A player joining a night backdated ~2h gets a full bank (`ROLL_CAP` = 10);
   a small backdate (e.g. 20 min) gives fewer than the cap.
3. A future `startedAt` is rejected (`400`).
4. A non-ISO `startedAt` is rejected (`400`).
5. Omitting `startedAt` preserves current behavior (start ≈ now, `JOIN_ROLLS` only).

Keep the existing lambda pytest suite green.
