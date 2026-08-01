# Undercity Plaza Chat — Design

**Date:** 2026-07-31
**Status:** Approved for implementation

## Goal

A lightweight season-wide text chat for the night's players, opened from the
Plaza tab via a floating chat-bubble button in the bottom-left corner of the
plaza scene, sitting just above the action band.

## Scope decisions

- **One room per season.** Everyone in the active season shares a single
  channel. No DMs, no channels, no moderation tooling — this is a party game
  played by friends in one room.
- **Piggyback the existing 10s poll.** No websockets, no new endpoint. The
  `/game/state` response gains a `chat` array (newest 50 messages,
  chronological). Sending is a normal `POST /game/action` with
  `type: 'chat'`. 10-second delivery latency is acceptable for a couch game;
  opening the panel triggers an immediate `refresh()`.
- **Join-gated.** You need a hatched creature to talk (the action dispatcher
  already requires a player doc). Chat is allowed mid-battle (added to
  `_BATTLE_ALLOWED_ACTIONS`, like `set-status`).

## Backend (`infrastructure/lambda/undercity_db.py`)

**Storage.** One item per message under the season partition:

```
pk = UNDERCITY#{sid}
sk = CHAT#{ts_ms}#{6-hex}
{ id: '{ts_ms}#{hex}', userId, username, text, ts: ts_ms }
```

Seasons are one-night affairs, so no TTL/pruning — same policy as `EVENT#`.

**Action `chat`.** Payload `{ text }`. Text is normalized like status bubbles
(trim, collapse whitespace runs to single spaces) and capped at
`CHAT_MAX_LEN = 140`. Empty-after-normalize → 400. Returns
`{ ok, you, chat: <the created message> }` so the client can append it
instantly without waiting for a poll.

**Grapevine mirror.** Each message is also written to the `EVENT#` log as a
`type: 'chat'` event (`"<username>: <text>"`), so chat surfaces in the board
event ticker and the Log tab alongside the other game notifications.

**State projection.** `handle_state` runs its own `CHAT#` query (`CHAT#`
sorts before `PLAYER#`, so — like `FIRST#`/`FOG#` — the main range query
doesn't cover it): descending, `Limit=50`, then reversed so the client gets
chronological order.

## Frontend

**Models** (`undercity-models.ts`): `ChatMessage { id, userId, username,
text, ts }`; `GameState.chat?: ChatMessage[]`.

**Store** (`undercity-state.service.ts`):

- `chat` computed from state.
- `refresh()` merges chat by `id` (union of current + incoming, sorted by
  `ts`, capped 50) instead of replacing wholesale — a poll that raced the
  eventually-consistent DynamoDB query would otherwise briefly drop a
  just-sent message that was appended optimistically.
- `sendChat(text)` → `action('chat', { text })`, then appends the returned
  message into local state.
- Unread tracking: `chatLastReadTs` signal seeded from localStorage
  (`uc-chat-read`); `chatUnread` computed = messages from *others* newer than
  last-read; `markChatRead()` advances both signal and localStorage.

**UI** — new standalone `UcChatComponent`
(`tabs/plaza-chat.component.ts/.html/.scss`), embedded in the plaza tab:

- **FAB:** `chat_bubble` icon button, absolutely positioned bottom-left
  inside `.plaza-scene` (which ends where the action band begins, so the
  button naturally sits above the action row). Shows a red unread-count
  badge (`9+` cap).
- **Panel:** tapping the FAB opens a panel anchored above the button
  (backdrop tap or ✕ closes). Message list scrolls, auto-pinned to bottom;
  each row shows the sender's recolored creature portrait (reusing
  `formSprite` + `getRecoloredWithHatDataUrl` against the public roster,
  falling back to a generic icon for departed players), username, HH:MM
  time, and text. Own messages are highlighted/right-aligned.
- **Composer:** single-line input, `maxlength` mirror `CHAT_MAX = 140`,
  Enter or send button submits; disabled while in flight.
- Opening the panel calls `refresh()` once and marks read; new messages
  arriving while open keep being marked read.
- **Plaza speech bubble:** a fresh chat message pops a speech bubble (tailed,
  vs. the status bubble's thought-dots) over the sender's creature for 5
  seconds, temporarily outranking their status bubble. Long messages clip to
  40 chars with an ellipsis. The override lives on the canvas Dino record so
  roster polls don't clobber it; the plaza tab seeds its chat watermark
  silently on mount so reopening the tab never replays the backlog.

## Testing

Pytest (FakeTable integration suite, `tests/test_undercity_db.py`):

1. Post + read back through `handle_state` (text, username, ordering).
2. Normalization: whitespace collapse + 140 cap.
3. Empty text → 400.
4. No creature yet → 409 join gate.
5. Allowed while a battle is pending.
6. State returns only the newest 50, oldest-first.

Frontend is verified by `npm run build:prod` (no unit runner is wired up).

## Explicitly out of scope

Rate limiting, profanity filtering, message deletion, DMs, chat on other
tabs/board, push notifications for messages, typing indicators.
