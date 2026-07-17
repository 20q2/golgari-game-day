# Undercity Admin Panel — Design

**Date:** 2026-07-15
**Status:** Approved, ready for implementation plan

## Goal

Give the host a single admin surface for the live Undercity game: create **puppet
bots** (real players that occupy/decorate the board and TV), and manage the
current season's roster (grant/heal/teleport/kick) plus broadcast host messages.
Reuses the existing host-passphrase trust model — no real auth.

## Scope (MVP)

**Bots:** occupy + decorate only. A bot has a species, name, paint, level, and
sits on a node so the board/TV looks populated. The host can create, teleport,
restyle (via paint defaults / future), and remove them. **No combat.**

**Admin operations (all four selected):**
- Roster view — live table of every player + bot.
- Grant / heal / teleport — per-player, works on humans and bots.
- Kick / remove — delete a player or bot from the current season.
- Broadcast event — post a custom message into the event log / TV ticker.

**Explicitly deferred:** bot combat/AI, board reseed, season clock/timers,
spawn wild/loot, full per-player reset, achievement/revenge editing.

## Architecture

### Route & access
- New lazy route `/undercity/admin` → standalone `AdminPanelComponent`, following
  the existing `/undercity/map-editor` pattern (keeps heavy admin UI out of the
  player bundle).
- Gated by the existing host passphrase stored in `localStorage` under
  `undercity-host-key` (the same key `HostPanelComponent` already uses). Every
  admin request carries `hostKey`; the server returns 403 on mismatch. No new
  auth mechanism.

### Bots are real player docs
A bot is a genuine `PLAYER#{userId}` document with a synthetic `userId` of the
form `BOT#<id>`. Because it is a normal player doc, it renders on the board, the
`/tv` spectator broadcast, the roster, and hero cards with **zero client
special-casing**. An `isBot: true` flag is the only marker.

### Server command surface (`undercity_db.py`)
Add **one** new action type `admin`, dispatched in `handle_action` right after
`season-start` (i.e. before the per-player doc lookup), so it does not require
the caller to be a joined player. It:

1. Resolves the active season; verifies `payload.hostKey` against the season
   `CONFIG.hostKey` → **403** on mismatch (reuse the existing check pattern from
   `_season_end` / `_boss_awaken`).
2. Routes on `payload.cmd` to an admin sub-handler.

Sub-commands:

| `cmd`       | Effect |
|-------------|--------|
| `bot-add`   | Mint `BOT#<id>`; build a full valid player doc; `isBot: true`. Optional `name`, `species`, `home` in payload; random species/home when omitted. |
| `kick`      | Delete the target `PLAYER#{target}` doc (bot or human). Posts an event. |
| `grant`     | Add `rolls` and/or `spores` directly; add `xp` via existing `_grant_xp` (so level-ups fire). Amounts from payload. |
| `heal`      | Restore target HP to effective max; reset `hpUpdatedAt`. |
| `teleport`  | Set target `position` to a validated node id. Puppet move — **no** landing effects. Reject unknown node ids with 400. |
| `broadcast` | Post a custom message via `_event(table, sid, 'host', text, ...)` so it appears in the log + TV ticker. |

**Refactor:** extract the player-doc construction currently inside `_join` into a
shared helper `_new_player_doc(sid, user_id, username, starter, home, seals_before, egg_hue)`
so `bot-add` and human `join` build identical doc shapes and cannot drift.
`_join` keeps its perm-record bookkeeping (seals/nights) and hatch event; bots
skip perm bookkeeping (a bot has no persistent account).

**Public shape:** `_public_player` gains an `isBot` field so the admin roster can
tag bots. The TV does **not** visually mark bots (filler should look real).

### Client (`AdminPanelComponent`)
- Passphrase gate: if no stored host key, prompt for it (same UX as host panel);
  store on submit. Every action includes `{ hostKey, cmd, ... }`.
- **Roster table** built from the existing `store.players()` signal: name,
  species/form, level, HP/maxHP, position (node name), rolls, spores, bot tag.
  Each row: **Teleport / Grant / Heal / Kick** controls.
- **Add-bot form:** name (optional), species dropdown (+ "Random"), home biome
  dropdown (+ "Random").
- **Grant form:** resource (rolls / xp / spores) + amount.
- **Broadcast input:** free text → posts an event.
- **Season controls:** embed the existing `HostPanelComponent` (New Night / End
  Night / Awaken the Queen) so this route is the single admin home.
- Teleport node dropdown is populated from the undercity map json (node id → name).
- Dispatch through `AwsApiService.action('admin', payload)`. The server ignores
  the caller's identity for admin commands and acts on `payload.target`; the
  host's own `userId` (already in localStorage) satisfies the
  `handle_action` "userId required" guard.

### Data flow
Admin commands mutate other players' docs, so after each call the client simply
triggers the existing `store.refresh()` (already the default in
`UndercityStateService.action`). No optimistic per-bot state needed.

## Error handling
- Wrong/absent `hostKey` → 403 with clear text; client surfaces it (existing
  `UndercityApiError` pattern).
- Unknown `cmd` → 400.
- Invalid node id / species / missing target doc → 400 with a specific message.
- Kicking / granting a non-existent target → 400 ("No such player this season").

## Testing
New `infrastructure/lambda/tests/test_admin.py` in the FakeTable integration
suite:
- Wrong hostKey → 403 for every admin cmd.
- `bot-add` produces a valid player doc that appears in `/game/state`, carries
  `isBot: true`, and has legal stats.
- `grant` adds rolls/spores and levels via xp; `heal` fills HP; `teleport`
  moves to a valid node and rejects an invalid one; `kick` removes the doc.
- `broadcast` posts an event visible in the log.
- Keep the whole suite green (`cd infrastructure/lambda && python -m pytest tests -q`).

No CDK/infra change — reuses the existing Function URL + `/game/action` route.

## Verification
- Backend: pytest suite green.
- Frontend: `npm run build` succeeds (lint is known-broken in this repo; verify
  via build).
- Manual: at `/undercity/admin`, add a bot → appears on board + `/tv`; teleport a
  player; grant rolls; broadcast a message → shows in log/ticker; kick the bot.
