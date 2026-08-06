# Undercity — "Waiting to Launch" lobby state

**Date:** 2026-08-06
**Status:** Approved, ready for implementation plan

## Problem

On a game day, players drift in over a couple of hours — some log in early out of
curiosity, well before the host wants the night to actually begin. Today the only
season states are `active` and `ended`, so an early visitor either sees a dead
`idle` screen (no season yet) or, if the host starts early, a live night that some
players are missing. The host needs a way to say "we're starting soon — sit tight"
with a visible countdown, while keeping everyone out of the actual game until they
press go.

## Concept

A new pre-game season status **`lobby`**. The host opens a lobby with a target
start time. Anyone who loads Undercity sees a full-screen countdown ("The night
begins in 1:23:45") and nothing else — no hatch, no roster, no board. When the
countdown reaches zero it switches to "The night is about to begin…" but the game
does **not** auto-start. The host still presses **Start Night** when ready, which
promotes the lobby into the live night (same `seasonId`).

Deliberate non-goals:

- **No auto-launch.** The timer is pure client-side display. At zero, gameplay is
  still gated until the host acts. This keeps the feature robust on the serverless
  stack — no cron or scheduler reliably flipping a DynamoDB record at a wall-clock
  time.
- **No prep during the wait.** Countdown only. No hatching, no roster peek. (Chosen
  over a "prep but don't play" lobby to keep scope tight.)

## Backend (`infrastructure/lambda/undercity_db.py`)

### Data shape

Season CONFIG (`UNDERCITY#{sid} / CONFIG`) gains:

- `status` — now one of `lobby | active | ended` (was `active | ended`).
- `launchAt` — ISO-8601 UTC string, the countdown target. Present on `lobby`
  seasons; may linger harmlessly on the promoted `active` season (ignored there).

### New action: `season-lobby` (passphrase-gated)

Routed **before** the active-status gate (alongside `season-start`, since the
season is by definition not yet active):

1. Require `hostKey`; if a CURRENT season exists, its `hostKey` must match (403).
2. If the CURRENT season is `active` → **refuse** with a clear message
   ("A night is already running — end it before opening a lobby."). The host must
   End Night first.
3. Otherwise write/overwrite the CURRENT season as
   `{status: 'lobby', hostKey, launchAt: <payload.launchAt>, bossPhase: False}`
   and point `META / CURRENT` at it.
   - If no CURRENT season exists (or it was `ended`/`lobby`), mint a fresh
     `seasonId` (same `%Y%m%d-%H%M%S` scheme as `season-start`) and, when
     `PROCEDURAL_DUNGEONS` is on, generate the night's maps now so promotion is a
     pure status flip.
   - Re-submitting while already in `lobby` reuses the existing `seasonId` and
     just updates `launchAt` (lets the host push the time back or pull it in).
4. Validate `launchAt` is a parseable ISO string; reject otherwise.
5. Emit a season log line ("The gates are sealed. The night begins soon…").
6. Return `{ok: True, seasonId, launchAt}`.

### `season-start` promotes a lobby

`_season_start` currently either creates a fresh season or archives a running one
and creates fresh. New behavior: if the CURRENT season is `lobby` (hostKey
matching), **promote it in place** — set `status='active'`, `startedAt=now()`,
keep the same `seasonId` and any pre-generated MAP. No archive, no new id. All
other paths (no season, `ended` season, or an already-`active` season needing a
forced restart) behave exactly as today.

### Gating (no change needed)

The dispatcher already rejects every gameplay/admin action when
`status != 'active'` (the line-2552 check). A `lobby` season therefore blocks
`roll`/`move`/`join`/etc. for free. Only `season-start` and the new `season-lobby`
run ahead of that gate.

### State response

The `season` block returned by the state builder includes `launchAt` alongside
`seasonId`, `status`, `startedAt`, `bossPhase`.

### Tests (`infrastructure/lambda/tests`, in-memory FakeTable suite)

Add cases:

- `season-lobby` from a clean slate creates a `lobby` season with the given
  `launchAt`; state reports `status='lobby'` and the timestamp round-trips.
- A gameplay action (e.g. `roll` / `join`) against a `lobby` season is rejected
  with the "no active season" 409.
- `season-lobby` while a season is `active` is refused (must end first).
- Re-submitting `season-lobby` updates `launchAt` and keeps the same `seasonId`.
- `season-start` on a `lobby` season promotes it: same `seasonId`, `status`
  becomes `active`, `startedAt` set.
- Wrong `hostKey` on `season-lobby` → 403.

## Frontend (`src/app/undercity/`)

### Model (`services/undercity-models.ts`)

```ts
export interface Season {
  seasonId: string;
  status: 'lobby' | 'active' | 'ended';
  startedAt?: string;
  launchAt?: string;   // countdown target for lobby status
  bossPhase: boolean;
}
```

### Phase routing (`undercity-page.component.ts`)

`phase` computed gains `'lobby'`. Sign-in stays first (state only polls once
signed in, and curious visitors are logging in anyway), then the lobby check slots
in ahead of the season-status branches:

- `signin` if not signed in; `loading` until state + assets + map are ready.
- Then, if `season.status === 'lobby'` → `'lobby'`.
- Otherwise the existing order (`idle`/`ended`/`hatch`/`play`) is unchanged.

### Lobby view

A new full-screen lobby/countdown view, styled to match the existing `idle` /
`ended` screens (same shell, MTG Golgari tokens, no emoji — use existing iconography
if any). Behavior:

- A client-side `setInterval` (1s) diffs `now` against `season.launchAt`.
- Above zero: "The night begins in `HH:MM:SS`" (drop the hours segment when zero).
- At/below zero: "The night is about to begin…" (host will start it).
- If `launchAt` is missing/unparseable, show a plain "Waiting to launch…" with no
  timer.
- Clean up the interval on destroy.

### Admin panel host controls (`host/host-panel.component.*`, rendered inside the
admin panel)

Add a **"Waiting to launch"** control block next to Start Night / End Night:

- A `datetime-local` input for the target clock time (local time, converted to an
  ISO UTC string for the payload).
- A button that fires `store.action('season-lobby', {hostKey, launchAt})`.
- When a lobby is live, show the current target and a short confirmation; the
  existing **Start Night** button promotes it (no wording change strictly required,
  but a hint like "Start Night promotes the lobby" is welcome).
- Reuse the existing `hostKey` localStorage handling and the `run()` busy/error
  wrapper.

## Files touched

- `infrastructure/lambda/undercity_db.py` — `season-lobby` action, `season-start`
  promotion, state `launchAt`, dispatcher route.
- `infrastructure/lambda/tests/…` — new lobby cases.
- `src/app/undercity/services/undercity-models.ts` — `Season` shape.
- `src/app/undercity/undercity-page.component.ts` / `.html` — `lobby` phase + view.
- `src/app/undercity/host/host-panel.component.ts` / `.html` / `.scss` — lobby
  control.

No infra/CDK changes; no new endpoints (rides the existing `POST /game/action`).
