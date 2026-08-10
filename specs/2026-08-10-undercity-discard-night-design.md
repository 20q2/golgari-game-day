# Undercity Discard Night (end a night without banking results) — Design

**Date:** 2026-08-10
**Status:** Approved (brainstorm)
**Related:** [2026-08-09-undercity-dev-night-design.md](2026-08-09-undercity-dev-night-design.md)
(the Dev Night toggle this interlocks with); host controls in
`2026-07-15-undercity-admin-panel-design.md`.

## Motivation

Test nights currently pollute permanent progression. Ending a night banks every
player's earned Renown onto their permanent profile, adds a Hall of Fame entry,
and bumps lifetime counters — which is correct for a real game day and wrong for
every test session. With Dev Night (free rolls) now available, a test night can
mint arbitrary Renown, so the host needs a way to throw a night away.

## What "the results" actually means

Permanent (cross-night) state a night writes, found by auditing every
`perm['renown']` mutation and `table.put_item(Item=perm)` call:

| When | Permanent write |
| --- | --- |
| End of night, `_archive_season` | earned Renown banked (`undercity_db.py:3423`), `lifetimePvpWins`, `apexReached`, Hall of Fame `NIGHT#{sid}` entry |
| Mid-night, immediately | enraged/raid-boss kill Renown (`:5821`), world-event payout Renown (`:5994`) |
| At join | `seals` +1, `nights` +1, and pre-spawn shop purchases — which *spend* Renown (`:3592`) and permanently grant hats/paints/effects |

A discard must therefore reverse more than the archive step: the mid-night grants
are already banked by the time the host ends the night.

## Scope — "Renown-clean"

**In:** skip the archive's banking and Hall of Fame entry, and hand back every
Renown the night granted mid-night, so the wallet ends where it started.

**Out, by decision:** the seal and nights-played from joining, and pre-spawn shop
purchases (Renown spent, cosmetics unlocked). Reversing purchases would undo
choices a player made deliberately. Consequence to accept: a host who runs many
test nights still accrues seals and nights-played.

## 1. Season ledger for mid-night grants

New helper in `undercity_db.py`:

```python
def _bank_perm_renown(table, sid, user_id, amount):
    """Bank Renown onto a permanent wallet AND tally it in this season's ledger,
    so a discarded night can hand back exactly what it granted."""
```

It writes the perm wallet exactly as the current inline code does, then
increments a season-scoped ledger item `UNDERCITY#{sid}` / `PERMRENOWN#{uid}`
holding a running `amount`.

**Why a season-scoped ledger rather than a counter on the player doc:** the
world-event payout writes non-killer participants through
`_pay_world_reward_retry`, which owns its own read-modify-write and optimistic
`ver` retry loop. A ledger item is written independently of player docs, so no
grant site has to thread a counter through a doc it does not own, and no grant can
be lost to a lock conflict.

Both mid-night grant sites (`_award_enraged_kill`, `_world_event_payout`) are
replaced by a call to this helper. Both already have `sid` and the user id in
scope.

The pre-spawn shop *spend* at `:3592` is deliberately not ledgered — spending is
not something a discard reverses.

## 2. `_archive_season(table, sid, config, discard=False)`

Standings are computed identically in both modes, so the ceremony screen and the
host `export` still work on a discarded night — reviewing a test night's numbers
is exactly when you want them.

When `discard` is true:

- Skip the per-player permanent writes: banked Renown, `lifetimePvpWins`,
  `apexReached`.
- Skip the Hall of Fame `NIGHT#{sid}` entry (it is permanent, cross-night state).
- Walk every `PERMRENOWN#` ledger item for the season and subtract its `amount`
  from that player's wallet, **clamped at zero** — a player who earned 10 and then
  spent down to 5 lands on 0, never negative.
- Write `RESULT` and the ended `CONFIG` with `discarded: True`.
- Log *"The night ends — results discarded. Nothing was banked."* instead of the
  champion line.

## 3. Dev Night interlock

`devMode` is cleared when the host ends Dev Night, so the interlock needs its own
sticky marker. `_admin_dev_night` sets `devEverOn: True` on the season CONFIG when
switching Dev Night **on**, and never clears it.

`_archive_season` then forces the mode:

```python
    discard = bool(discard or (config or {}).get('devEverOn'))
```

All three archive callers — `_season_end`, `_season_start` (archiving a live night
before opening a new one), and `_admin_reset_all` (which goes through
`_season_start`) — funnel through `_archive_season`, so no code path can bank a
night that ever had free rolls.

## 4. Action surface

- `season-end` accepts `discard: bool` (default False) and returns
  `{'ok': True, 'result': …, 'discarded': <bool>}`. The returned flag reflects what
  actually happened, including a forced discard.
- `handle_state`'s season block exposes `devEverOn` alongside `devMode`, so the
  host panel can show what ending the night will do.

## 5. Host panel

`host/host-panel.component.*`, which the admin panel already embeds, so the
control appears in both surfaces. Both buttons keep the existing two-tap arming
pattern (`confirmEnd`, plus a new `confirmDiscard`).

- **Normal night:** two buttons — *End Night* (banks, unchanged) and *Discard
  Night — save nothing*, the latter warning-styled with a hint naming what is and
  is not reversed.
- **Night with `devEverOn`:** the banking button is replaced by a single *End
  Night — results discarded*, above a line explaining that this night ran with
  free rolls so nothing can be banked.

## 6. Ceremony badge

`discarded` rides the `RESULT` payload into `SeasonResult`, and the ceremony
screen shows a "Results discarded — nothing saved" badge, so the host is never
guessing after the fact whether a night counted.

## Testing

New file `infrastructure/lambda/tests/test_undercity_discard.py` (a new file keeps
this clear of the user's in-flight edits to `test_admin.py`):

1. A normal `season-end` still banks earned Renown onto the perm wallet
   (regression — existing behavior must not shift).
2. `season-end` with `discard: True` leaves the perm wallet untouched.
3. Discard writes no Hall of Fame entry; a normal end does.
4. Discard still writes `RESULT` with full standings, flagged `discarded: True`.
5. Mid-night granted Renown (enraged kill / world event) is reversed on discard.
6. The same mid-night Renown is **kept** on a normal end.
7. The refund clamps at zero rather than going negative.
8. `lifetimePvpWins` / `apexReached` are not incremented on discard.
9. `devEverOn` forces a discard even when the host asks to bank.
10. `devEverOn` survives turning Dev Night back off (sticky).
11. `season-start` over a dev night archives without banking.
12. `devEverOn` appears in the season block for the host panel.

Run: `cd infrastructure/lambda && python -m pytest tests -q`. Client verified with
`npm run build` (no frontend test runner; `npm run lint` is known-broken).

## Deployment

Needs a `cdk deploy` for the Lambda and a frontend deploy for the host-panel
buttons. The host runs both.
