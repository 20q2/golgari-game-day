# Undercity — Shared Item-Acquisition Pipeline + Overflow Modal

**Date:** 2026-08-03
**Status:** Design approved, pending implementation plan

## Problem

Items enter a player through many independent code paths — gear drops, battle
and boss rewards, loot/dig spaces, scavenge, board-game rewards, shop buys,
starter kit — and each path handles a full inventory *differently and silently*:

- `_gain_gear` grinds an overflowing piece into materials.
- `_give_consumable` salvages an overflowing consumable into 5 Spores.
- The dig-site path auto-lists an overflowing consumable on the market.
- Scroll grants convert an overflowing scroll to Spores.
- Shop buys instead hard-error before charging.

The player never gets a say in what happens to an item they earned. We want a
single shared pipeline so that **every** item gain routes through one place, and
when inventory is full the player is prompted — via a blocking modal that pops
after whatever event granted the item — to either sell the new item on the
market or manage their inventory (salvage an owned piece or list an owned piece)
to make room.

## Scope

**In scope (capacity-limited kinds):** gear (`gearStash`, cap 6), consumables
(`bag`, cap 3), spell scrolls (`scrolls`, cap 6).

**Out of scope:** companion eggs, grimoires (owned-once set), materials
(unbounded counters). These do not route through the new pipeline.

## Decisions (from brainstorming)

1. **Interaction model:** a *blocking modal*, resolved *one item at a time*.
   Multiple overflows queue (FIFO). Grants that happen while the player is
   offline (e.g. board-game rewards) park in the queue and the modal appears on
   next app open.
2. **Resolution actions:** (a) list the new item on the market; (b) manage
   inventory by *salvaging* an owned same-kind piece, or *listing* an owned
   same-kind piece on the market. No explicit "discard" and no "sell owned gear
   for Spores" button.
3. **Salvage generalizes per kind** so every kind has a cap-free escape:
   grind → materials for gear, convert → Spores for consumables/scrolls (reusing
   today's auto-salvage rates, but now applied to a piece the *player* picks).
4. **Shop buys and starter-kit keep their existing up-front capacity checks** —
   they are *not* routed through the pipeline. Buying is a voluntary spend where
   erroring-before-charging is better UX than charge-then-force-a-modal, and the
   starter kit is a one-time controlled selection, not an item "gain."

## Architecture (approach A: single chokepoint)

### Server data model

New player-doc field:

```
pendingPickups: [ { kind, itemId, source, at } ]
```

- `kind` ∈ `{'gear', 'consumable', 'scroll'}`
- `itemId` — the gear / consumable / spell id
- `source` — short tag for the modal's flavor line: `battle`, `loot`, `boss`,
  `dig`, `scavenge`, `reward`
- `at` — timestamp (from `_now()`)

Included in the `YouDoc` projection (the doc returned as `resp.you`) so the
client sees the queue after every action and every `refresh()`.

### The chokepoint: `_acquire(doc, kind, item_id, source)`

Becomes the **only** function that puts an item into a player. Per-kind
placement rules:

| kind       | placement order                                  | overflow |
|------------|--------------------------------------------------|----------|
| gear       | auto-equip empty slot → stash (if room)          | park     |
| consumable | append to `bag` (if room)                        | park     |
| scroll     | append to `scrolls` (if room)                    | park     |

"Park" = append `{kind, itemId, source, at}` to `pendingPickups` and return
outcome `'pending'`. Returns a small dict `{kind, itemId, outcome, ...}` where
outcome ∈ `equipped | stashed | stored | pending` (plus per-kind extras like the
freed slot for gear).

**Deletions:** the silent overflow branches are removed and their behavior moves
into *player-directed* salvage inside `pickup-resolve`:
- `_gain_gear`'s grind-to-materials tail.
- `_give_consumable`'s salvage-to-Spores tail.
- the dig-site consumable auto-list.
- the scroll-satchel-full → Spores convert.

`_gain_gear` becomes a thin wrapper over `_acquire(doc, 'gear', gid, source)` (or
is replaced at call sites). Its existing `equipped`/`stashed` outcomes are
preserved for callers that display "equipped!" vs "stashed" text.

**Call sites rewired to `_acquire`:** `_roll_gear_drop`, boss finale rewards,
scavenge consumable grants, dig-site consumable grants, board-game reward grants
(`_grant_to_player`, `apply_banked_rewards`), and any other loot/battle grant.
Grimoire, egg, and material grants are left untouched.

### The resolve action: `pickup-resolve`

Registered in the action dispatcher. Always operates on the **head** of
`pendingPickups` (`pendingPickups[0]`). Payload `{ choice, ... }`:

- **`list-new`** `{ price }` — create a market listing for the parked item at a
  price inside its bounded band (`_market_price_band`), then pop the head.
  Returns 409 if the seller is already at `MARKET_MAX_LISTINGS` (5) or price is
  out of band. The parked item never enters inventory.
- **`salvage-owned`** `{ index }` — salvage an owned **same-kind** item at
  `index`: grind gear → materials (`_grind_materials`), or convert
  consumable/scroll → Spores at today's rate. This frees a slot; the parked item
  is then placed via the normal per-kind placement (it now has room), and the
  head is popped. **Cap-free — this is the guaranteed escape hatch.**
- **`list-owned`** `{ index, price }` — list an owned **same-kind** item on the
  market (bounded price), freeing a slot; the parked item is placed and the head
  is popped. Returns 409 at the listing cap / out-of-band price.

Reuses existing helpers: `_grind_materials`, `_create_market_listing`,
`_market_price_band`, `_market_listing_count`, and the `_MARKET_KINDS` routing
table. Response is the updated doc via `_ok`; if `pendingPickups` is still
non-empty the client simply renders the next item.

**Invariant — the modal is never stuck:** overflow means that kind's inventory
is full, so an owned same-kind item always exists to `salvage-owned`, which is
cap-free. Therefore every pending item is always resolvable even at the 5/5
market cap.

**Validation:** reject `choice`/`index`/`price` that don't match the head item's
kind or a valid owned slot; reject when `pendingPickups` is empty.

### Client

- Add `pendingPickups: PendingPickup[]` to the `YouDoc` model in
  `undercity-models.ts` (with a `PendingPickup` interface).
- New **`pickup-modal.component.ts`** — a blocking overlay rendered at the
  `undercity-page` level whenever `state().you?.pendingPickups?.length`. It:
  - shows the head item: name, a `uc-*`/Material icon (per the no-emoji symbol
    language), and a source line ("You found a Barbed Maul", "Savra dropped …");
  - offers **List on Market** — a price input clamped to the item's band →
    `pickup-resolve { choice: 'list-new', price }`;
  - offers **Manage Inventory** — expands the same-kind inventory list with a
    per-row **Salvage** (`salvage-owned { index }`) and **List** (`list-owned
    { index, price }`) action;
  - after each resolve, re-renders for the next queued item until the queue is
    empty.
- Reuse the market price-band and salvage UI patterns already in `plaza-tab`.
- No new balance mirrors needed beyond the model field.

## Testing

pytest integration in `infrastructure/lambda/tests` (FakeTable suite, kept
green):

1. Overflow parks to `pendingPickups` for each kind (gear stash full, bag full,
   satchel full).
2. `list-new` creates a listing and pops the head; rejects at the 5-listing cap
   and out-of-band price.
3. `salvage-owned` frees a slot (grind for gear, Spores for consumable/scroll),
   places the parked item, pops the head — and works even at the 5/5 market cap
   (deadlock escape).
4. `list-owned` lists the owned piece, places the parked item, pops the head.
5. An offline board-game-reward overflow parks in `pendingPickups` and surfaces
   on the next `GET /game/state`.
6. Grimoire/egg/material grants and shop-buy/starter pre-checks are unchanged.

## Files touched (anticipated)

- `infrastructure/lambda/undercity_db.py` — `_acquire`, `pickup-resolve`,
  rewire grant sites, `pendingPickups` in the `YouDoc` projection + fresh-doc
  defaults, remove silent-overflow tails.
- `infrastructure/lambda/tests/` — new integration tests.
- `src/app/undercity/services/undercity-models.ts` — `PendingPickup`, `YouDoc`.
- `src/app/undercity/tabs/pickup-modal.component.ts` (new) + host wiring in
  `undercity-page`.
- `specs/undercity-combat.md` / loot docs — cross-reference note if warranted.
