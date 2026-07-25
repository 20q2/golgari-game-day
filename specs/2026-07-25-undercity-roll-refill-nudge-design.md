# Undercity Roll-Refill Nudge — Design

**Date:** 2026-07-25
**Status:** Approved, ready for implementation plan

Builds on [specs/2026-07-25-undercity-notifications-design.md](2026-07-25-undercity-notifications-design.md)
(the `push_db` seam + `_push_user` wrapper).

## Problem

The notification feature deliberately left out a "your rolls are ready — come
back" nudge because there was no way to fire it: the backend has no scheduler
and rolls regenerate lazily (computed on read), so no server moment marks the
refill; and a browser timer (`setTimeout` / `TimestampTrigger`) can't fire once
the PWA is closed.

We want that re-engagement nudge without standing up an expensive per-player
timer.

## Key insight

A per-player timer doesn't need per-player infrastructure. A single lightweight
poll that sweeps all season players emulates every player's timer at near-zero
cost. One EventBridge rule + one Lambda + one DynamoDB query per tick.

## Roll economy (context)

`ROLL_REGEN_MINUTES = 30`, `ROLLS_PER_REGEN = 3`, `ROLL_CAP = 15`
(`undercity_config.py`). So 0→cap is ~2.5 hours — reachable within a game night.
`engine.regen_rolls(player, now_iso)` banks whole 30-minute ticks and advances
`rollRegenAt`.

## Constraints

- **Free-tier.** A 5-minute rule is ~288 Lambda invocations/day plus one small
  DynamoDB query each — inside the free tier. The sweep writes a player doc only
  on an actual nudge-state transition, never on plain regen.
- **Best-effort.** A push failure never affects gameplay (inherited from
  `push_db`). A lost optimistic-lock write in the sweep is fine — it means the
  player just acted, so *not* nudging them is correct.
- **No migration.** New player-doc fields are optional/defaulted; existing docs
  work unchanged.
- **No cron precision needed.** ±5-minute timing is fine for a "come back" nudge.

## Design

### 1. Scheduled invocation

Add to the CDK stack (`infrastructure/lib/game-day-backend-stack.ts`), using
`aws-cdk-lib/aws-events` + `aws-cdk-lib/aws-events-targets`:

```ts
const rollSweep = new events.Rule(this, 'RollRefillSweep', {
  schedule: events.Schedule.rate(cdk.Duration.minutes(5)),
});
rollSweep.addTarget(new targets.LambdaFunction(gameDayApi, {
  event: events.RuleTargetInput.fromObject({ task: 'roll-refill-sweep' }),
}));
```

`lambda_handler` detects the marker **before** any HTTP parsing and routes to the
sweep:

```python
def lambda_handler(event, context):
    if event.get('task') == 'roll-refill-sweep':
        undercity_db.sweep_roll_refills(table)
        return {'ok': True}
    ...  # existing HTTP handling
```

(An EventBridge invocation is a plain dict with no `requestContext`/`rawPath`, so
the marker check is unambiguous.)

### 2. The sweep — `undercity_db.sweep_roll_refills(table)`

```
sid, config = _active_season(table)
if not active season: return           # idle nights cost ~one get_item
for doc in _season_players(table, sid):
    engine.regen_rolls(doc, now)        # in memory only
    rolls   = doc.get('rolls', 0)
    nudged  = doc.get('rollNudged', False)
    active  = _acted_within(doc, ROLL_NUDGE_IDLE_MIN)   # lastActionAt recent
    if rolls >= ROLL_NUDGE_THRESHOLD and not nudged and not active:
        _push_user(table, doc['userId'],
                   f"You've got {rolls} rolls waiting — come take a turn!")
        doc['rollNudged'] = True
        _put_player(table, doc)         # best-effort; lost race == active == skip
    elif rolls < ROLL_NUDGE_THRESHOLD and nudged:
        doc['rollNudged'] = False
        _put_player(table, doc)
    # else: no write — regen is recomputed lazily on the next real read
```

**Flag lifecycle.** `rollNudged` fires once per refill cycle. It is set when the
player crosses up to the threshold while idle and cleared when they drop back
below it. Because regen is a 30-minute floor, rolls cannot climb back above the
threshold within a single 5-minute sweep interval, so at least one sweep always
observes the sub-threshold state and re-arms the flag before the next nudge is
possible. (A social `poke` can add +1 instantly and, in a rare window, carry a
player back over the threshold without a sweep seeing the dip — acceptable: the
poke already sent its own notification.)

### 3. Idle guard

Stamp `doc['lastActionAt'] = _now()` in the shared pre-dispatch block in
`handle_action` (right where `engine.regen_rolls` / `_expire_buffs` /
`_prune_cooldowns` already run for every non-join player action). It piggybacks
the doc write the action handlers already perform, so it adds no extra write.

`_acted_within(doc, minutes)` compares `lastActionAt` to now; a doc with no
`lastActionAt` (never acted, or pre-existing) is treated as **not** recently
active, so it remains eligible for a nudge.

### 4. Config (`undercity_config.py`, tunable — mirror any client display if used)

```python
ROLL_NUDGE_THRESHOLD = 3     # rolls; a playable turn's worth (matches JOIN_ROLLS)
ROLL_NUDGE_IDLE_MIN  = 10    # don't nudge someone who acted within this many minutes
```

Sweep cadence (5 min) lives in the CDK rate, not Python.

New player-doc fields: `lastActionAt` (ISO string) and `rollNudged` (bool), both
optional with sensible defaults.

## Testing

FakeTable / pytest, following the existing suite:

- **`sweep_roll_refills`**
  - nudges a player who crossed the threshold while idle (asserts `_push_user`
    called + `rollNudged` set)
  - skips a player whose `lastActionAt` is within `ROLL_NUDGE_IDLE_MIN`
  - does not double-notify (second sweep with the flag set → no push)
  - re-arms: rolls below threshold clears the flag
  - no-op when there is no active season (no push, no error)
  - only writes docs that changed state (no write on plain regen)
- **Idle stamp:** an action sets `lastActionAt` on the player doc.
- **Routing:** `lambda_handler({'task': 'roll-refill-sweep'}, None)` reaches the
  sweep (monkeypatch `undercity_db.sweep_roll_refills`).
- CDK rule verified via `cdk synth` (deploys are run by the user).

Keep the whole `infrastructure/lambda` suite green
(`cd infrastructure/lambda && python -m pytest tests -q`).

## Deployment

User runs deploys. `cdk deploy` provisions the EventBridge rule + the
invoke permission automatically. No new env vars.

## Out of scope

- "In-app right now" detection beyond the `lastActionAt` action heuristic (a
  passive viewer sitting at the threshold could still get one ping; reliable
  presence detection would need a client heartbeat write on every poll, which is
  not free-tier friendly).
- At-cap-only nudges (superseded by the lower-threshold trigger).
- Other time-based nudges (world-event timeouts, general idle re-engagement) —
  they can hang off the same `{task: ...}` dispatch later.
