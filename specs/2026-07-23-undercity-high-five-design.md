# Undercity — High Five (design)

**Date:** 2026-07-23
**Status:** Approved for planning

## Summary

Add a social **High Five** between two players who share a board space. When another
creature is on your space, a High Five button appears next to their row in the
occupants strip. Tapping it:

1. Plays a "ready → jump → clap" animation between the two creatures on the board.
2. Notifies the recipient (toast + "while you were away" inbox note).
3. Grants the recipient a one-battle **High Five buff: +1 ATK / +1 DEF / +1 SPD**,
   consumed after their next combat.

It is a one-directional gift (only the recipient is buffed/notified) with a
per-target cooldown, closely mirroring the existing `poke` social action.

## Non-goals

- No buff for the giver (one-directional, per approved design).
- No stacking: re-high-fiving refreshes the single buff instance, never doubles it.
- No cross-space high-fives: both creatures must occupy the same node.

## Backend (`infrastructure/lambda/`)

### Buff mechanic (reuses the one-battle-buff system)

- **`undercity_engine.py` `effective_stats`:** add a branch
  `elif kind == 'high_five': eff['atk'] += 1 * mult; eff['def'] += 1 * mult; eff['spd'] += 1 * mult`.
  (Server is authoritative; the +1s surface to the client via the battle snapshot's
  `statDelta`, already wired.)
- **`undercity_db.py` `ONE_BATTLE_BUFFS`:** add `'high_five'` so it is auto-cleared
  by `_consume_one_battle_buffs` after the recipient's next battle.

### Action `_high_five` (modeled on `_poke`)

Registered in the action dispatcher as `'high-five': _high_five`.

- Reject missing target or self-target.
- Load the target with `_get_player`; 404 if absent.
- **Same-space guard:** `target['position'] == doc['position']`, else an error
  ("You can only high-five someone on your space.").
- **Per-target cooldown** via a new `highFiveCooldowns` map (same shape/semantics as
  `pokeCooldowns`):
  - Read `doc['highFiveCooldowns'].get(target_id)`; if still in the future, return a
    429 with the minutes remaining.
  - After a successful high-five, set it to
    `now + HIGH_FIVE_COOLDOWN_MIN` and persist on the giver's doc.
- Apply the buff with `_apply_buff(target, 'high_five')` (refresh-don't-stack).
- **Notify the recipient:** `_push_away_event(target, {'kind': 'high_five',
  'from': doc['username'], 'fromId': doc['userId'], 'at': _now()})`. `fromId` lets the
  recipient's client locate the giver's token to replay the animation.
- Emit a ticker line via `_event(table, sid, 'high-five', "<giver> high-fived <target>'s <creature>", actor=doc['userId'])`.
- Persist both docs (target first, then giver — mirror `_poke`'s ordering and its
  409 "crowded" retry on the target put).
- Return `_ok(doc)`.

### Plumbing

- Add `'highFiveCooldowns': {}` to the new-player doc seed (alongside `pokeCooldowns`).
- Extend `_prune_cooldowns` to prune `highFiveCooldowns` the same way it prunes
  `pokeCooldowns`.

### Config (`undercity_config.py`)

- Add `HIGH_FIVE_COOLDOWN_MIN` (dedicated knob, initial value mirroring
  `POKE_COOLDOWN_MIN`) so the two social actions tune independently.

### Tests (`tests/test_undercity_db.py`)

- High-five on the same space grants the target the `high_five` buff and returns ok.
- High-five off-space is rejected.
- Second high-five to the same target within the cooldown window is rejected (429).
- The buff yields a +1/+1/+1 `statDelta` in a battle snapshot and is gone after one
  battle (consumed by `_consume_one_battle_buffs`).

## Frontend (`src/app/undercity/`)

### Model + notification (`services/undercity-models.ts`, `board-tab.component.ts`)

- Add the `high_five` variant to the `AwayEvent` union: `{ kind: 'high_five';
  from: string; fromId: string; at: string }`.
- `awayText`: `` `${e.from} high-fived you — +1 to all stats next fight!` ``
- `awayIcon`: `'back_hand'` (or `'waving_hand'`).
- Away-event handling already toasts fresh events and calls a per-kind FX hook
  (`playHitFx`). Extend that hook so a fresh `high_five` event replays the animation:
  if the giver's token (`fromId`) is currently co-located, call
  `board.playHighFive(fromId, me)`; otherwise call `board.burstBuff(...)` on the
  recipient's own token as a solo celebratory flourish.

### Occupants strip (`board-tab.component.html` + `.ts`)

- In each `pvp-row`, add a **High Five** button beside the Battle button, calling
  `highFive(o)`. Icon `back_hand`, label "High Five".
- Unlike Battle, the button stays **enabled against shielded players** (a high-five
  is not an attack) — only gated by `busy()`.
- Add `async highFive(o: Occupant)` (mirror `poke`/`attack`):
  - `store.action('high-five', { targetUserId: o.userId })`
  - On success: `this.board?.playHighFive(this.store.ownUserId, o.userId)` and a toast
    (e.g. `` `You high-fived ${o.username} — they'll fight the next battle buffed!` ``).
  - On error: show the error message toast.

### Buff chip (`data/combat.ts`)

- Add to `STATUS_INFO`:
  `high_five: { label: 'High Five', icon: 'back_hand', tone: 'buff', blurb: '+1 ATK/DEF/SPD this battle.' }`
  so it renders in the recipient's in-battle status row.

### Animation (`engine/board-canvas.ts`)

New timed animation, following the existing cast/hit-queue pattern. Maps entirely
onto `drawToken`'s existing render params (`x`, `hopY`, `breath`) — **no drawToken
signature change**.

- **State:** `interface HighFiveAnim { aId: string; bId: string; start: number;
  clapped: boolean }` plus a single active-animation field (or short list).
- **`playHighFive(giverId: string, recipientId: string): void`** registers the
  animation at the current timestamp.
- **Duration** ~1000ms, phased on normalized `t`:
  - **Ready (0–0.25):** `breath` dips below 1 (anticipation crouch); `x` leans the two
    tokens slightly apart.
  - **Jump (0.25–0.55):** `hopY` rises on a sine arc; `x` eases toward the midpoint so
    the two converge to near-touching; `breath` stretches above 1.
  - **Clap (peak, once — guarded by `clapped`):** spawn an impact sparkle burst at the
    midpoint between the two tokens (reuse the `sparkles` system with sideways `vx`
    spread) + a landing dust puff.
  - **Settle (0.55–1.0):** bounce back apart to the resting fan positions; `hopY`→0,
    `breath`→1.
- Applied inside the token-placement loop: for a token participating in the active
  high-five, override the computed `x` / `hopY` / `breath` before it is pushed to
  `placed`. Expire the animation when `t >= 1` (same place the frame loop ages the
  other transient FX).
- Deliberately **not** reusing the spell `hitLife` shake — it flashes damage-red,
  wrong tone for a friendly gesture.

## Data flow recap

1. Giver taps High Five → `POST /game/action { action: 'high-five', targetUserId }`.
2. Server validates same-space + cooldown, applies `high_five` buff to the target,
   pushes a `high_five` away-event to the target, sets the giver's cooldown, emits a
   ticker line.
3. Giver's client plays `playHighFive(ownId, targetId)` immediately + a toast.
4. Recipient's next poll surfaces the away-event → toast + inbox note; client replays
   the clap if the giver is still co-located, else a solo sparkle burst. The buff is
   already on their doc and shows as a status chip + `statDelta` in their next battle,
   then is consumed.

## Files touched

- `infrastructure/lambda/undercity_engine.py` — `effective_stats` branch.
- `infrastructure/lambda/undercity_db.py` — `_high_five`, dispatcher entry,
  `ONE_BATTLE_BUFFS`, `_prune_cooldowns`, new-player seed.
- `infrastructure/lambda/undercity_config.py` — `HIGH_FIVE_COOLDOWN_MIN`.
- `infrastructure/lambda/tests/test_undercity_db.py` — new tests.
- `src/app/undercity/services/undercity-models.ts` — `AwayEvent` variant.
- `src/app/undercity/tabs/board-tab.component.ts` — `highFive`, away-event hook, text/icon.
- `src/app/undercity/tabs/board-tab.component.html` — High Five button.
- `src/app/undercity/data/combat.ts` — `STATUS_INFO` entry.
- `src/app/undercity/engine/board-canvas.ts` — `playHighFive` + animation.
