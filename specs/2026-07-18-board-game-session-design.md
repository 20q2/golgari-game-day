# Board-Game Session & Close-Out Rewards — Design

## Overview

Extends the game-night Queue with a **session lifecycle**: a ready lobby can be
*started* (marking "we're playing now"), and later *closed out* by any
participant. Closing out reports whether the game had a winner and who won, then
grants rewards inside the Undercity sub-game — a participation dice roll for
everyone at the table, and a random item for the winner(s). Rewards for players
who haven't made an Undercity creature yet this night are **banked** and applied
when they next create one.

This is the structured, multiplayer-verified counterpart to Undercity's existing
self-report `claim` action (`_claim`, `undercity_db.py:1077`), which hands out
rolls/spores on the honor system with a cooldown. The session path needs no
cooldown because a real queued lobby with a locked roster is the verification.

## Lifecycle & data model

A queue entry (`QUEUE#{sid}` / `GAME#{gameId}`) gains:

- `status`: `'lobby'` (default, as today) → `'active'` (after Start) → deleted on close-out.
- `startedAt`: unix seconds, set on Start.
- `ver`: integer optimistic-concurrency counter (mirrors the Undercity player-doc
  `ver` pattern) so a double close-out can't double-grant rewards.

New actions on `POST /queue/action`:

- **`start`** — any member of a `lobby` entry flips it to `active` and locks the
  roster (`startedAt` set). Allowed regardless of whether the minimum player count
  is met (the seat/min UI is guidance, not a gate). Idempotent: starting an
  already-active session is a no-op returning the entry.
- **`close`** — any member of an `active` entry ends it. Payload:
  `{ hadWinner: bool, winnerType?: 'single' | 'group', winnerId?: string }`.
  Grants rewards exactly once (guarded by the `ver` check), deletes the entry,
  posts Undercity events, and returns a reward summary.

**Banked-reward record** (new item type): `QUEUEREWARD#{sid}` / `USER#{userId}` →
`{ pk, sk, userId, rolls: int, items: [consumableId, ...] }`. Created only for
session participants who have no Undercity player doc for the active season at
close-out time.

## Reward rules

Reused/added balance constants in `undercity_config.py`:

- `QUEUE_SESSION_ROLLS = 1` — participation rolls granted to every participant.
- Winner item uses the existing `_give_consumable` path (random `CONSUMABLES`
  entry into `bag`, overflowing to spores if the bag is full at `BAG_SIZE=3`).

Grant logic (all rolls respect `ROLL_CAP=6` via `_add_rolls`):

| Close-out answer            | Every participant | Winner(s) additionally |
|-----------------------------|-------------------|------------------------|
| No winner                   | +1 roll           | —                      |
| Single winner (`winnerId`)  | +1 roll           | that player: +1 random item |
| Group victory (coop)        | +1 roll           | every participant: +1 random item |

For a participant **with** an active Undercity creature: apply immediately
(`_add_rolls` / `_give_consumable`, then `_save_or_conflict`). For one **without**:
write/merge a `QUEUEREWARD` bank record. Each applied grant posts an Undercity
Grapevine event, e.g. *"Catan wrapped up — everyone at the table earned a roll;
Andrew took the spoils!"*

## Where the logic lives

`undercity_db.py` owns all player-doc mutation and the bank, exposing two public
functions so `queue_db.py` never reaches into Undercity internals (and avoids a
circular import — `queue_db` already imports `undercity_db`, not vice-versa):

- `grant_board_game_rewards(table, sid, participant_ids, winner_ids) -> summary`
  — for each participant applies-or-banks the participation roll; for each winner
  applies-or-banks a random item. Returns a small dict summarizing what was
  granted vs banked (for the client toast).
- `apply_banked_rewards(table, sid, user_id, doc)` — called inside the existing
  Undercity `join` (`_join`) right after the new player doc is created: if a
  `QUEUEREWARD` record exists for `(sid, user_id)`, apply its rolls/items to the
  fresh doc, delete the record, and post an event.

`queue_db.py` owns session lifecycle (`_start`, `_close`) and calls
`grant_board_game_rewards` from `_close`.

## Frontend

`QueueService` gains `start(gameId)` and `close(gameId, result)` wrapping the new
actions, plus the entry `status` in `QueueEntry`.

`QueuePanelComponent` card states:

- **Lobby** (`status: 'lobby'`): existing seat row + Join/Leave, plus a **Start
  playing** button (any member).
- **Active** (`status: 'active'`): an "In progress" badge; Join/Leave hidden;
  a **Close out** button.

**Close-out modal** (new small standalone component, opened from the card):

1. "Did the game have a winner?" — **Yes / No**.
2. If Yes: "Who won?" — **Single winner** (radio list of the locked roster) or
   **Group victory (coop)**.
3. **Confirm** → calls `close` → shows a reward summary toast ("Everyone earned a
   roll 🎲 — winner grabbed an item!"). Modal closes; the card disappears on the
   next poll (entry deleted server-side).

State stays backend-truth via the existing 20s poll; actions apply optimistically
like the rest of the queue.

## Edge cases

- **Double close-out**: the `ver` check makes the second writer lose the race and
  return the already-closed result without re-granting; whoever wins deletes the
  entry. A close on a missing/already-closed entry returns `404`.
- **Close a lobby that was never started**: allowed — `close` works on `active`
  only; the client only shows Close-out on active sessions, and the server
  returns `409` if called on a `lobby` entry.
- **`winnerId` not in the roster**: `400`.
- **Group victory with `winnerId` set**: `winnerId` ignored (coop = all win).
- **Roll cap reached**: `_add_rolls` returns the lost overflow; surfaced in the
  summary but not an error.
- **Bag full for a winner item**: `_give_consumable` overflows to spores (existing
  behavior); still counts as the reward.
- **Banked record merge**: if a user is a winner in two sessions before joining,
  their bank record accumulates (`rolls += `, `items += `).

## Testing

Python/FakeTable (`tests/test_queue_db.py` + `tests/test_undercity_db.py`):

- `start` flips status and locks roster; idempotent re-start.
- `close` with no winner → every participant +1 roll, entry deleted.
- `close` single winner → winner also gets an item.
- `close` group victory → every participant gets roll + item.
- Reward for a non-Undercity participant is banked, then applied on their next
  `join`, and the bank record is deleted.
- Double close-out grants rewards exactly once.
- `close` on a `lobby` entry → 409; unknown/absent entry → 404; bad `winnerId` → 400.

No frontend test runner exists; the close-out flow is verified manually.

## Out of scope (v1)

- Session history / "recently finished" list (entry is deleted on close-out).
- Editing a result after close-out.
- Rewards beyond the participation roll + winner item (no spores/XP/renown tuning).
- Disabling or merging the existing self-report `claim` action (both coexist).
