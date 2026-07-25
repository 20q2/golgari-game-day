# Undercity Push Notifications — Design

**Date:** 2026-07-25
**Status:** Approved, ready for implementation plan

## Problem

The app has a complete web-push stack (VAPID via `push.py`, per-user
subscriptions in DynamoDB, Angular `SwPush` in `queue-push.service.ts`) but it
is wired to exactly one moment: someone joining a board-game **queue** ("Alex
wants to play Catan too"). The Undercity sub-game never sends a browser push —
it only writes to its two *in-app* feeds (the Grapevine event log and the
"while you were away" list), which a player sees only after they reopen the app.

Worse, **the existing queue pushes almost certainly never display.** The app
registers Angular's stock `ngsw-worker.js` (no custom service worker). ngsw only
calls `showNotification` when the push payload is wrapped in a top-level
`notification` key, but `push.py` sends a flat `{title, body, gameId}`. ngsw
receives the message, emits it on `SwPush.messages` (which nothing subscribes
to), and shows nothing. There is also no notification-click handler, so the
`gameId` field is dead code.

We want the Undercity game to fire real browser notifications for:

1. **You got more rolls** — a board game you were in gets closed out and you are
   awarded reward rolls while away (personal).
2. **Sigil boss beaten** — a player clears a sigil dungeon and claims a Guild
   Sigil (broadcast).
3. **Raid boss spawns** — a world-event raid boss appears (broadcast).
4. **Raid boss falls** — the world-event boss is killed (broadcast).
5. **Savra (the Queen) awakens** — the host triggers the finale (broadcast to
   everyone).

## Constraints

- **No cron / scheduled Lambda.** The backend only runs when a client makes a
  request. Rolls regenerate *lazily* (computed on read), so there is no server
  moment where "your rolls refilled while idle" occurs — it cannot be pushed.
  Browser-side scheduling can't cover it either: `setTimeout` dies when the
  PWA/tab is closed, and the Notification Triggers API (`TimestampTrigger`) was
  removed from Chrome and never existed on iOS. Roll notifications are therefore
  limited to rolls that are *granted by an event* (source #1 above). If a
  scheduled Lambda is ever added, refill nudges become trivial to layer on.
- **Best-effort only.** A web-push failure (missing dependency, bad VAPID key,
  network error, dead subscription) must never fail the game action that
  triggered it. This matches the existing lazy-import + swallow-errors guard in
  `queue_db._notify_others`.
- **No circular imports.** `queue_db` imports `undercity_db`, so `undercity_db`
  must not import `queue_db`.
- **Base href** is `/golgari-game-day/`; the Undercity route is `/undercity`, so
  notification click URLs are `/golgari-game-day/undercity`.

## Design

### 1. Fix the push payload so notifications render (also fixes the queue)

Reshape what `push.py` emits into the ngsw contract:

```json
{ "notification": {
    "title": "The Undercity",
    "body": "A raid boss stalks the caverns!",
    "data": { "onActionClick": { "default":
        { "operation": "focusLastFocusedOrOpen", "url": "/golgari-game-day/undercity" } } }
}}
```

`push.send(sub, message, game_id)` becomes `push.send(sub, title, body, url)`.
The queue caller passes its own title (e.g. "Game Queue") and the queue URL; the
Undercity callers pass the Undercity title/URL. This single fix makes the
existing "wants to play X" queue notifications actually appear for the first
time, and makes tapping a notification focus/open the right page.

### 2. Shared fan-out seam — new `push_db.py`

Because `undercity_db` cannot import `queue_db`, extract the subscription store
and fan-out helpers into a new module both can import:

- **Move out of `queue_db`:** `handle_push_subscribe`, `handle_push_unsubscribe`,
  `_subscriptions_for`, `_pushsub_pk`, `_endpoint_hash` → `push_db.py`.
- **Add to `push_db`:**
  - `send_to_user(table, user_id, title, body, url)` — push to every one of a
    single user's subscriptions; delete any that report `PushGone`.
  - `broadcast(table, sid, title, body, url, exclude_user_id=None)` — walk the
    season's players (`undercity_db._season_players`) and `send_to_user` each,
    skipping `exclude_user_id`.
  - Both keep the lazy `import push` inside the function and swallow non-`PushGone`
    errors, exactly as `_notify_others` does today.
- **Rewire callers:** `lambda_function` routes the subscribe/unsubscribe
  endpoints to `push_db`; `queue_db._notify_others` calls
  `push_db.send_to_user`; `undercity_db` calls both new helpers.

`push_db` may import `undercity_db` (for `_season_players`) — that direction is
already the norm and is not circular.

> Note on module boundaries: `_season_players` currently lives in `undercity_db`.
> `push_db.broadcast` needs it. Calling `undercity_db._season_players` from
> `push_db` is acceptable (undercity_db is the lower layer). The implementation
> plan should confirm no import cycle results (push_db → undercity_db only).

### 3. Hook the five events

Each event already writes to the Grapevine (`_event`) and/or away
(`_push_away_event` / `_broadcast_away`) feed. The push call sits immediately
beside the existing feed write, using the same target set:

| Event | Call site (undercity_db) | Target | Helper |
|---|---|---|---|
| Board-game reward rolls | `_apply_reward` (the `'reward'` `_push_away_event`) | the recipient | `send_to_user` |
| Sigil boss beaten | `_finish_lair`, sigil-claim branch (~L3549) | all but the slayer | `broadcast(exclude=slayer)` |
| Raid boss spawns | `_spawn_world_event` (~L3132) | all but the spawner | `broadcast(exclude=actor)` |
| Raid boss falls | world-event finish (`"…has fallen!"`, ~L3656) | all but the killer | `broadcast(exclude=killer)` |
| Savra awakens | `_boss_awaken` (~L1716) | everyone | `broadcast(exclude=None)` |

Notification copy is short and phone-glanceable, e.g.:
- reward: `"+N rolls from {game} — come spend them!"`
- sigil: `"{who} cleared the {biome} dungeon and claimed a Guild Sigil."`
- raid spawn: `"A {boss name} has surfaced in the Undercity!"`
- raid fall: `"The {boss name} has fallen!"`
- Savra: `"THE ROT-WARDS FALL — Savra stirs. Storm her lair!"`

All five moments are naturally idempotent or once-per-night (season-global first
kill, idempotent world-event spawn, one-way boss awaken, per-close reward), so
no additional dedupe/rate-limiting is required.

### 4. Subscribe Undercity players

Today the permission prompt only fires on queue-join, so a pure Undercity player
is never subscribed. Trigger the existing `ensureSubscribed()` at high-intent
moments in the Undercity client:

- **After a creature hatches** (the player has committed to tonight's game).
- **Silently on game load** if the player already has a creature (re-subscribe
  path is a no-op when already subscribed or opted out).

Reuse the existing opt-out flag (`gameday-queue-push-opt-out`) so a decline is
never re-nagged. The service (`QueuePushService`, `providedIn: 'root'`) is not
actually queue-specific in behavior; rename it to `PushService` for honesty and
update the two queue imports. (Rename is cosmetic — behavior unchanged.)

## Testing

Follow the existing FakeTable / pytest pattern (`tests/test_push.py`,
`tests/test_queue_db.py`):

- **`push.send`** — assert the new `notification`-wrapped payload shape and that
  `PushGone` still raises on 404/410 (extend `test_push.py`).
- **`push_db`** — `send_to_user` fans to all of a user's subs and deletes on
  `PushGone`; `broadcast` hits every season player except the excluded one.
- **Event hooks** — one integration test per hook asserting the fan-out is
  invoked with the expected target set (personal recipient vs. all-but-actor vs.
  everyone), using a fake/monkeypatched `push_db` to capture calls.
- Keep the whole `infrastructure/lambda` suite green
  (`cd infrastructure/lambda && python -m pytest tests -q`).

Frontend has no test runner; verify the subscribe trigger and payload rendering
manually via the run-undercity flow after deploy (deploys are run by the user).

## Out of scope

- Regen-refill / "rolls are full" nudges (no server timer; browser can't
  schedule reliably).
- Per-event notification preferences / a settings UI (single opt-out flag is
  enough for a game-night friend group).
- Revenge/PvP-steal, level-up, and achievement notifications (not requested;
  easy to add later on the same seam).
