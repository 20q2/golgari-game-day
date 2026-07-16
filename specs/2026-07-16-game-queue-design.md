# Game Night Queue — Design

## Overview

A "Queue" feature lets logged-in (anonymous-identity) users pick a catalog game they want to play tonight, add it to a shared per-night queue, and let others join that game's lobby. Anyone in a lobby gets a real push notification when someone else joins, so people can find each other and go play. The queue's "night" is tied to Undercity's host-started season — it's empty whenever no Undercity season is active, and each new season starts with a fresh, empty queue.

## Architecture

Reuses existing patterns rather than introducing new infra:

- New item types added to the **existing single DynamoDB table** (no new table).
- A new `queue_db.py` module in the Lambda, mirroring the `atype` dispatch pattern already used by `undercity_db.py`.
- New routes added to the existing flat dispatcher in `lambda_function.py`.
- Push notification delivery via Web Push (VAPID), sent directly from the Lambda — no SNS, no WebSocket API Gateway, no new AWS services.

## Data model (new item types, same table)

- **Queue entry** — `pk: QUEUE#<seasonSid>`, `sk: GAME#<gameId>` → `{ addedBy: userId, addedAt, joined: [userId, ...] }`.
  - Keyed off the *current* Undercity season's `sid` (read from the existing `META_PK/CURRENT` pointer in `undercity_db.py`), so a fresh Undercity night automatically starts with an empty queue and past nights' queues stay archived-but-inert (never shown, never cleaned up specially).
  - Adding a game a user already wants to play auto-joins them as the first member of `joined`.
  - Adding a game that's already queued for tonight is equivalent to joining the existing entry (no duplicate entries per game per night).
  - Leaving removes the user from `joined`. When `joined` becomes empty, the entry is deleted automatically — there is no separate "remove" action.

- **Push subscription** — `pk: PUSHSUB#<userId>`, `sk: SUB#<endpointHash>` → the browser's `PushSubscription` JSON (endpoint + keys). A user may have multiple rows (multiple devices/browsers).

## Backend API

New routes in `lambda_function.py`, dispatched into `queue_db.py`:

- `GET /queue/state` — returns tonight's queue (empty list if no active Undercity season). Used for the front-page panel and game-card badges.
- `POST /queue/action` — body `{atype, gameId, userId, ...}`:
  - `add` — create-or-join a game's lobby for tonight (idempotent).
  - `join` — join an existing lobby (idempotent; joining a game you're already in is a no-op).
  - `leave` — leave a lobby; auto-deletes the entry if it becomes empty.
- `POST /queue/push/subscribe` — store a browser's push subscription.
- `POST /queue/push/unsubscribe` — remove it.

Error handling conventions match Undercity's existing ones:
- No active Undercity season → `/queue/action` returns `409` (same convention as Undercity's own "no active season" check).
- Acting on a queue entry that's gone (race — e.g. last member just left) → `404`; client refetches `/queue/state`.

## Push notifications

Uses Angular's built-in `SwPush` service (`@angular/service-worker`, already enabled in production per project conventions) rather than a hand-rolled service worker push handler — `SwPush` natively supports VAPID subscription and displaying notifications from a push payload with no custom SW code required.

- One-time setup: generate a VAPID keypair. Private key stored as a Lambda environment variable; public key baked into the Angular build config.
- The first time a user joins any lobby, the client prompts for notification permission and calls `SwPush.requestSubscription()`, then POSTs the resulting subscription to `/queue/push/subscribe`. Declining is remembered in `localStorage` (mirroring the existing anonymous-identity persistence pattern) so the prompt isn't repeated every session.
- On every successful `join`, the Lambda **synchronously** sends a Web Push message (via `pywebpush`, added as a Lambda dependency/layer) to every *other* subscribed user currently in that lobby's `joined` list: `"{name} wants to play {game} too"`.
- Synchronous send (not offloaded to an async/second Lambda invoke) — simplest implementation, no new infra, and negligible added latency at friend-group scale (a handful of push sends per join).
- A push send failure with a `404`/`410` response (expired/invalid subscription) deletes that subscription row; it does not fail the join request.

## Frontend

- **`QueueService`** (`src/app/services/queue.service.ts`) — fetches `/queue/state` folded into the existing app-startup bulk fetch (alongside comments/ratings/likes) so it's one extra field in the same round trip, not a new request. Exposes queue entries as observables and wraps add/join/leave with the same optimistic-local-update pattern `DataAggregationService` already uses for comments/ratings/likes.
- **"Tonight's Queue" panel** on `/home` (`GamesComponent`) — renders only while an Undercity season is active. Lists each queued game with the names of who's joined and a Join/Leave button.
- **Badge on existing game cards** — a small "🎲 N queued tonight" pill plus inline Join button on cards for games that are in tonight's queue, reusing the same `QueueService` state as the panel.
- **"Add to queue" entry point** — a button on each game card and/or the game detail view that adds the game to tonight's queue, auto-joining the adder.
- **Push opt-in prompt** — shown the first time a user joins any lobby ("Get notified when someone joins your lobby?"). Declining just means they rely on the in-app panel/badges instead.

## Edge cases

- No active Undercity season → queue panel and badges simply don't render on the front end; backend rejects mutating actions with `409`.
- Double-join (double-click, race) → idempotent no-op, same convention as Undercity's `_join`.
- Expired/invalid push subscription → deleted on send failure, doesn't block the triggering request.
- Last member leaving a lobby → entry auto-deletes; no explicit removal action exists.

## Testing

- Python: new test module under `infrastructure/lambda/tests/` using the existing `FakeTable` harness. Covers add/join/leave, auto-delete-when-empty, season-gating (`409` with no active season), duplicate-add-merges-into-join, and push subscription CRUD (with `pywebpush.webpush` mocked).
- No frontend test runner exists in this project (Karma/Jasmine removed per project conventions) — frontend behavior is verified manually via `npm start`.

## Out of scope (v1)

- Editing/reordering queue entries beyond add/join/leave.
- Any UI for browsing past nights' queues.
- Notification preferences beyond a single opt-in/opt-out toggle.
