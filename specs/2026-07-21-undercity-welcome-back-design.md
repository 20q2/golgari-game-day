# Undercity — Welcome-Back Notifications

Design date: 2026-07-21

## Goal

When a player returns to the Undercity, surface what happened while they were
away in the existing **"While you were away…"** modal. Three new categories, on
top of the spell hits/dodges already carried:

1. **Attacked by other players** — any PvP battle initiated on you (win, loss,
   flee, or draw).
2. **Board-game reward** — the reward you earned for a physical game you took
   part in and closed out, naming the specific game.
3. **Boss / guardian defeats** — every Sigil-lair boss and barrier guardian
   felled by anyone while you were gone.

## Existing system (reused, not rebuilt)

- Server: per-player `awayEvents` list on the creature doc; `_push_away_event`
  appends (capped at `AWAY_EVENTS_CAP = 20`, oldest dropped); the `ack-events`
  action clears it. Delivered to the client as part of the `you` doc.
- Client: `awayModal` signal + "While you were away…" modal in
  `board-tab.component`. Returning players see the full list; active players get
  a per-new-event toast that auto-acks. `dismissAway()` fires `ack-events`.
- Today only `spell_hit` / `spell_dodged` are carried (plus a `market-sold`
  entry that renders blank — see cleanup below).

## Data model — typed `AwayEvent`

Discriminated union on `kind`, mirrored server (plain dict) ↔ client (TS):

| kind | fields | meaning |
|---|---|---|
| `spell_hit` / `spell_dodged` | `from`, `spell`, `dmg?`, `at` | *(existing)* |
| `pvp` | `from`, `outcome`, `spores?`, `at` | attacked by a player |
| `reward` | `game`, `rolls`, `items` (count), `at` | board-game payout |
| `boss` | `by`, `name`, `at` | a guardian/boss was slain |
| `market` | `gear`, `price`, `at` | market sale (rename of `market-sold`) |

`pvp.outcome` ∈ `composted` (you lost, `spores` stolen from you), `defended`
(they attacked, you composted them), `fled` (they attacked, you escaped),
`timeout` (draw).

### Cleanup: market event normalization

The market sale currently pushes `{'type': 'market-sold', …}`, but the client
renderer keys on `kind`, so those rows show blank. Normalize to `kind:'market'`
as part of generalizing the renderer, and update `test_undercity_market.py`.

## Server changes

### PvP — notify the victim (`undercity_db._battle`)

After resolving, push one event to `target` (the victim) for **all** outcomes,
before the existing `_put_player(table, target)`:

- attacker wins → `{kind:'pvp', from: doc.username, outcome:'composted', spores: stolen}`
- defender wins → `{kind:'pvp', from: doc.username, outcome:'defended'}`
- fled → `{kind:'pvp', from: doc.username, outcome:'fled'}`
- timeout → `{kind:'pvp', from: doc.username, outcome:'timeout'}`

### Board-game reward — name the game

Thread the title from `queue_db._close` (`entry['gameTitle']`, already in scope):

- `grant_board_game_rewards(table, sid, participant_ids, winner_ids, game_name=None)`
- `_grant_to_player(…, game_name)` — after applying rolls/item to a live doc,
  push `{kind:'reward', game: game_name, rolls, items}`.
- `_bank_reward` — persist `game` on the bank record.
- `apply_banked_rewards` — when delivering banked rewards onto a freshly hatched
  doc, push the same `reward` event (in addition to the existing Grapevine post).

`rolls` = `CLAIM_FINISHED_ROLLS (+ CLAIM_WON_BONUS_ROLLS if winner)`; `items` =
count of consumables granted.

### Boss / guardian defeats — fan-out news

New helper `_broadcast_away(table, sid, entry, exclude_user_id)`: enumerate the
season's player docs (reusing the same query the leaderboard/state build uses),
and `_push_away_event` + `_put_player` for each except the actor. Best-effort —
a lost optimistic-lock race just drops that one news line.

Call it with `{kind:'boss', by: doc.username, name: <foe>}` at the milestone
sites that already emit Grapevine events:

- barrier guardian shattered — `_finish_barrier`, attacker branch (~2718)
- Sigil claimed — `_finish_lair`, `personal_first and sigil_biome` (~2769)
- legendary lair first-kill — `_finish_lair`, `not slain` branch (~2777)
- Savra / Rot Sovereign felled — `_finish_boss`, first-kill branch

Trade-off accepted: fan-out writes to every player doc on a milestone. Milestones
are rare (a few per night) and player counts small, so this is cheaper than
adding a second per-player "last seen" mechanism.

## Client changes

- Extend the `AwayEvent` TS interface to the union above.
- Replace `awayText()` with a typed renderer → `{icon, cssClass, text}` per kind.
- Group modal rows under light headers — **Attacks**, **Rewards**, **News** —
  keeping the existing backdrop/modal/`dismissAway()` flow.
- Active-player toast text handles each new kind.

## Tests

`infrastructure/lambda/tests`:

- PvP battle pushes a `pvp` event to the victim for each outcome.
- Board-game reward pushes a `reward` event naming the game (live grant + banked
  delivery on hatch).
- A guardian/boss defeat fans a `boss` event out to other players (and not the
  slayer).
- Update `test_undercity_market.py` for the `type`→`kind` rename.

Keep the suite green: `cd infrastructure/lambda && python -m pytest tests -q`.
Then `npm run build` for the client mirror. Config/engine deploy is the host's.
