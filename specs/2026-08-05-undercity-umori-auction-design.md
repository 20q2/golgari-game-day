# Undercity — Umori, the Collector's Sealed Auction

**Date:** 2026-08-05
**Status:** Design approved; ready for implementation plan
**Area:** Undercity sub-game — the wandering trader ("Umori")

## 1. Problem

Umori, the wandering trading post, currently lets any player **barter one owned item for
one of his stock lines** ([`_trade`](../infrastructure/lambda/undercity_db.py) in
`undercity_db.py`). His stock is always **tier-3 (endgame) gear** — one piece per slot plus
a T3 grimoire — and the only gate on a gear trade is that the piece you give occupies the
**same slot** as the piece you take. There is **no value/tier floor**.

The result: a level-2 player who happens to land on Umori's tile can hand over a grey
tier-1 fang and walk away with a legendary tier-3 fang, once per window, wherever he
happens to appear. This trivializes the entire early game. The code even states the
intended constraint — *"Endgame T3 gear should be a treat, never a shortcut"* — but nothing
enforces it.

A "game day" is a **6-8 hour** live session, so Umori is a recurring beat, not a one-off;
whatever he becomes should reward reaching him without letting one landing skip progression.

## 2. Summary

Replace the barter with a **shared, sealed-bid auction** themed around Umori as a
mysterious hoarder. Each time he stops at a wilderness node he sets out a **wrapped mystery
lot**. Players who reach his tile drop **sealed Spore bids**. When he wanders on, the
**top 3 bidders each pull a ranked mystery box** (1st best → 3rd smallest). Boxes contain
**equipment, eggs, grimoires, consumables, or crafting materials** — never Spores — and even
1st place is **variance** (only a *chance* at a top-tier piece), so winning is a treat, not a
guaranteed endgame spike. **Reserve prices** per rank stop a lone cheap bid from cracking the
best box.

## 3. Locked decisions

| Question | Decision |
|---|---|
| What is Umori now? | A mysterious collector running a **sealed-bid auction**, one per wander window |
| The lot | A **full mystery** (`???`) lot — contents unknown until unwrapped |
| Winners | **Top 3 bidders**, each get a **ranked mystery box** (Gilded / Curio / Trinket) |
| Bid currency | **Spores** (sealed, one bid per player, **raise-only**, escrowed at bid time) |
| Presence | Must **physically reach Umori's tile** that window to drop/raise a bid |
| Anti-exploit floor | **Reserve prices per rank** (public minimum bid to unlock a box's top table) |
| Box contents | equipment · eggs · grimoires · consumables · crafting materials — **no Spores** |
| Box philosophy | **Variance** — even 1st place is only a *chance* at top-tier; materials floor prevents whiffs |
| Pacing | **Shorten the wander dwell** (from 120 min) so a 6-8h event gets ~5-8 auction beats |

## 4. Detailed design

### 4.1 Window & location (reuses existing machinery)

Keep Umori's deterministic wander: a wilderness node per window
([`_umori_window`](../infrastructure/lambda/undercity_db.py) /
[`_umori_node`](../infrastructure/lambda/undercity_db.py), pure functions of the wall
clock — no server tick). **Each window is exactly one auction.** When he hops nodes the old
window's auction closes and a new one opens at the new tile.

Shorten `UMORI_DWELL_MIN` from 120 to a value that yields ~5-8 auctions across a 6-8h
session (start point **~75 min**, final number set in the balance pass). The world-event /
enraged-monster overlap logic that references the umori window
([`_enraged_node`](../infrastructure/lambda/undercity_db.py)) must keep working after the
dwell change.

### 4.2 Bidding

- **New action `umori-bid`** (payload `{amount: int}`), registered in the dispatcher next to
  where `'trade': _trade` lives; the `trade` action and `_trade` handler are removed.
- **Presence-gated:** reject unless the player's `position` equals `_umori_node(win)` for the
  current window — mirroring the old trade presence check.
- **Sealed & raise-only:** one bid per player per window. A new bid must be **strictly
  greater** than the player's existing bid this window (you may raise, never lower or cancel).
- **Escrow at bid time:** deduct `amount` (or the raise delta) from the player's Spores
  immediately and record the bid. This prevents bidding Spores you then spend elsewhere before
  close. Reject if the player can't afford the (delta) amount.
- **Minimum bid:** reject bids below `UMORI_MIN_BID` (a small floor, e.g. 5) to avoid 0/1-Spore
  noise bids.

### 4.3 Data model

**Shared auction record** (repurpose the existing `POST#UMORI#{win}` sk, which today holds
stock):

```
pk: <season>          sk: POST#UMORI#{win}
{
  node:    <nodeId>,                       # the window's tile (for display/validation)
  bids:    { userId: {amount, username, ts} },   # ts = server wall-clock, for tie-breaks
  resolved: false,
  results: null                            # filled once, at close (see 4.4)
}
```

**Player doc fields:**
- `umoriBidWindow`, `umoriBidAmount` — the player's current live bid (so the client shows
  "your bid" and the raise-only rule is enforceable). Escrow lives implicitly in the deducted
  Spore balance.
- `umoriCollectedWindow` — the last resolved window whose outcome (box **or** refund) this
  player has already pulled. Prevents double-collection.

### 4.4 Resolution — lazy, idempotent, deterministic (no server tick)

There is no scheduler, so resolution happens **on read/act**, exactly like shop windows and
market/pickup flows:

1. When any request observes that a `POST#UMORI#{w}` record exists for a **past** window
   (`w < current`) with `resolved == false`, it computes the outcome:
   - Rank `bids` by `amount` **descending**, ties broken by **earliest `ts`** (deterministic).
   - For each of the top 3 filled ranks, roll box contents **deterministically** — seeded by
     `(window, rank)` via the same stable-hash pattern used across Umori/shop stock — so every
     client/request computes the identical result. Only ranks that **clear their reserve**
     (§4.6) roll the top table; under-reserve ranks roll the consolation table.
   - Store `results: [{userId, rank, boxTier, items}]` back onto the record under a
     **conditional write** (`resolved` flips false→true) so concurrent resolvers converge on
     one stored outcome; losers of the race read the stored `results`.
2. **Pull model for delivery.** Each player, on their next state load or action, checks:
   *is there a resolved window `> umoriCollectedWindow` in which I bid?* If so:
   - If I placed top 3 → grant my box's `items` to my inventory (reusing existing grant
     helpers: `_gain_gear`, egg-grant, grimoire append, consumable/material grants).
   - Else → **refund** my escrowed Spores.
   - Set `umoriCollectedWindow = w`.
   This keeps every request writing only **its own player doc + the one shared record** — no
   fan-out writes across all players.

### 4.5 Boxes & reward tables

Model each box as a **loot source** with weighted contents, mirroring the existing
`GEAR_DROP` / `EGG_DROP` source→weight pattern in `undercity_data.py`. Reward pool per roll:
**equipment · eggs · grimoires · consumables · crafting materials** (Gemstones / Moltings /
Ichor count as crafting materials, preserving the gem-hoard flavor as a *payout*). No Spores.

| Rank | Box | Skew (weights tunable in `undercity_data.py`) |
|---|---|---|
| 1st | **Gilded Coffer** | best chance at high-tier **equipment / grimoire / egg**; solid crafting-material floor so it never fully whiffs |
| 2nd | **Curio Box** | mid-tier equipment or grimoire, a decent egg, or a materials bundle |
| 3rd | **Trinket Pouch** | a consumable, a low-tier egg, or a small materials bundle |

**Variance:** even the Gilded Coffer only *sometimes* yields a top-tier piece; the common
outcome is strong materials or a good egg. This is the core fix for the original complaint.

### 4.6 Reserve prices (anti-exploit floor)

Each rank has a **public** minimum winning bid, `UMORI_RESERVES = {1: R1, 2: R2, 3: R3}`
(e.g. 80 / 40 / 15). If the bid that lands in a rank is **below** that rank's reserve, that box
**downgrades to a consolation table** rather than its top skew. Reserves are public (shown in
the bid UI) so players can price a bid **without** seeing rivals' sealed amounts. A lone early
bidder dropping 5 Spores therefore "wins" 1st place but, under reserve, only opens the
consolation table — no Gilded Coffer.

### 4.7 Escrow & refund lifecycle

- Bid/raise → Spores deducted immediately (escrow).
- At close, top-3 winners have already "paid" (escrow is consumed as the box's cost); ranks 4+
  and any player in a window with no box for them are **refunded** their full escrow on pull.
- Because winners keep no Spores back and boxes contain no Spores, there is **no money-pump**.

### 4.8 Edge cases

- **Fewer than 3 bidders:** only the filled ranks award boxes; empty ranks are skipped.
- **Zero bidders:** window resolves to no results; Umori wanders on with his hoard intact.
- **Ties:** earliest `ts` ranks higher (deterministic, server-timestamped).
- **Stash full on delivery:** boxed **gear** that won't fit auto-lists on the Player Market at
  a fair price (reuse the excavation full-bag fallback). Eggs/grimoires/consumables/materials
  use their normal capacity rules.
- **Player never returns after bidding:** their box/refund simply waits; it's pulled whenever
  they next load. `umoriCollectedWindow` guards against double-pull.
- **Dwell change vs enraged overlap:** verify `_enraged_node`'s umori-window mapping still
  excludes Umori's tile after `UMORI_DWELL_MIN` changes.

## 5. Backend changes (`infrastructure/lambda/`)

**Remove:** `_trade`, the `'trade'` dispatcher entry, `UMORI_STOCK_SPEC`, `_umori_stock`,
`_umori_barter_stock`, and the T3-stock seeding of `POST#UMORI#{win}`
(`undercity_db.py` / `undercity_data.py` / `undercity_config.py`).

**Add:**
- `_umori_bid` handler + `'umori-bid'` dispatcher entry.
- `_resolve_umori_window(table, sid, win)` — deterministic ranking + box roll + conditional
  store.
- `_collect_umori(doc, table, sid)` — pull-model delivery/refund, called from the state-load /
  action path (near the existing lazy-resolution hooks).
- `_roll_umori_box(win, rank)` — deterministic weighted roll from the rank's table.
- Update the `state` payload's `umori` block (currently `{node, movesAt, traded}`) to
  `{node, movesAt, reserves, minBid, yourBid, standingCount?}` — **without** leaking rivals'
  amounts — plus any just-resolved result for a reveal.

**Config vs data split** (per project conventions):
- `undercity_config.py` (scalars): `UMORI_DWELL_MIN` (shortened), `UMORI_MIN_BID`,
  `UMORI_RESERVES`, `UMORI_WINNERS = 3`.
- `undercity_data.py` (weighted tables): the three box loot tables + consolation table.

## 6. Client changes (`src/app/undercity/`)

- **Board-tab Umori modal:** swap the give/take barter UI for a **sealed-bid panel** — enter a
  Spore amount, show the public reserves, a close-countdown (`movesAt`), and *your* standing
  bid; raise-only. No rival amounts shown.
- **Reveal modal:** when a resolved window has an outcome for the player, show a reveal
  ("Umori's auction closed — you placed 2nd → open your Curio Box") and the granted items;
  non-winners see the refund note.
- Update `services/undercity-models.ts` (auction/bid/result shapes) and the admin panel's
  Umori references.
- Icons only, no emoji (project rule): reuse the Spore/Gemstone/Molting symbol language.

## 7. Balance & tunables

All numbers land as tunables and get dialed in a follow-up balance pass (tune-undercity-balance
skill). Mirrors in `src/app/undercity/data/*.ts` must be updated to match server values.

| Tunable | Home | Starting point |
|---|---|---|
| `UMORI_DWELL_MIN` | config | ~75 min (≈5-8 auctions / 6-8h event) |
| `UMORI_MIN_BID` | config | 5 Spores |
| `UMORI_RESERVES` | config | `{1: 80, 2: 40, 3: 15}` |
| `UMORI_WINNERS` | config | 3 |
| Box loot tables (×3 + consolation) | data | seeded from GEAR/EGG/GRIMOIRE/CONSUMABLE/material weights |

## 8. Testing (`infrastructure/lambda/tests/`, keep the suite green)

Replace the trade tests with coverage for:
- Bidding: presence required; min-bid floor; raise-only (reject lower/equal); escrow deducts
  Spores; can't bid more than you hold.
- Ranking: top-3 selection; earliest-`ts` tie-break.
- Reserve gating: under-reserve winner gets consolation, not the top table.
- Resolution: deterministic box roll (same seed → same items); idempotent conditional store
  under concurrent resolvers.
- Delivery/refund: winners get boxes via pull model; ranks 4+ refunded; `umoriCollectedWindow`
  prevents double-pull; stash-full gear auto-lists to market.
- Regression: `_enraged_node` still excludes Umori's tile after the dwell change; map
  sync/window tests still pass.

## 9. Deferred / out of scope

- Auction layered onto a *revealed* lot (kept full-mystery per decision).
- Gemstone/mixed-currency bidding (Spores only).
- Open ascending bids / live outbidding (sealed only).
- Cross-window "collection" flavor (boxes drawn from items other players lost to Umori).
