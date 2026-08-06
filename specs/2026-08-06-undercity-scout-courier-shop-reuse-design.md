# Undercity — Scout Courier Reuses the Bazaar Shop UI

**Date:** 2026-08-06
**Status:** Design (awaiting review → plan)

## Problem

The Scout Courier (Plan: `specs/2026-08-05-undercity-scout-remote-buy-*.md`) ships a
bespoke list modal that duplicates a thin slice of the real bazaar: no tabs, no
rarity badges, no item descriptions, no shopkeeper. It reads as a stripped-down
menu, not "shopping." Meanwhile the board already has a rich shop modal
(`showShop`) with tabs (Gear / Consumables / Grimoires / Eggs), rarity styling,
descriptions, a rotating shopkeeper portrait + quote, and a restock timer.

Goal: when the scout is used, reuse that shop modal so a courier trip feels like
real shopping, with the shopkeeper *and* your pet in the header, a courier-themed
line, and rows above the scout's tier cap disabled.

## Solution

Give the board shop modal a **courier mode**. The same modal renders normal
walk-in shopping or a remote scout trip depending on a `shopMode` flag; only the
data source, header, buy affordance, and checkout differ.

Scope decisions (locked in brainstorming):

- **Board tab only.** The courier opens the board shop modal in courier mode. The
  creature-tab scout entry becomes an informational chip (no separate courier UI).
- **One item per cooldown**, delivered via a **stage → checkout** flow.
- **Deliver = stage**, and the bottom bar becomes the checkout (**Purchase for X
  Spores**).
- **Server rules unchanged** — reuses `pet-scout-peek` / `pet-scout-buy`; one
  optional additive field on peek (`refreshesAt`).

## Architecture

All client changes are in `src/app/undercity/tabs/board-tab.component.ts` +
`.html` (courier mode) and `creature-tab.component.ts` + `.html` (drop the
courier, add the chip). One optional server touch in `undercity_db.py`.

### Mode flag + entry

- Add `shopMode = signal<'shop' | 'courier'>('shop')`.
- `openShopCourier()` (board scout box): free `pet-scout-peek` → store
  `{node, tierCap, stock}` in the existing `scoutView` signal → set
  `shopMode='courier'` → open `showShop`. On peek error (no bazaar / no scout),
  toast the server message and don't open.
- Closing the modal (`closeFacilities()` / Leave) resets `shopMode='shop'` and
  clears the cart.
- **Remove** the bespoke courier modal + members added previously:
  `scoutOpen`, `scoutGearLocked`, `scoutEggLocked`, `scoutBuy`,
  `closeScoutCourier`, and the courier modal template block. Keep `scoutView` and
  `scoutOnCooldown` (reused by courier mode).

### Data source

- New `activeBazaar = computed<BazaarView | null>(() =>
  this.shopMode() === 'courier' ? (this.scoutView()?.stock ?? null) :
  this.currentBazaar())`.
- Point the row getters (`shopGearRows`, `shopConsumableRows`,
  `shopGrimoireRows`, `shopEggRows`), `bazaarRestockLabel`, and the keeper-window
  read in `bazaarKeeper()` at `activeBazaar()` instead of `currentBazaar()`.
  (Behavior for normal shopping is identical — `activeBazaar()` == `currentBazaar()`
  when `shopMode==='shop'`.)

### Header — shopkeeper + your pet

In courier mode the modal header additionally renders the active pet's sprite
beside the shopkeeper art (`petSpriteUrl(activePet.species)`), and replaces the
welcome-gift/quote block with a single courier line, e.g.:

> "Your {petName} scampers up and drops your coin-pouch on the counter.
> '{keeperName} eyes it — sending your little runner to shop, eh? Point it at
> **one** thing and it'll haul it back.'"

`petName` from the active pet; `keeperName` may reuse the rotating keeper. Normal
mode header is unchanged.

### Tier-cap locks

A courier-only block reason: for **gear and egg** rows whose tier exceeds
`scoutView().tierCap`, the Deliver control is disabled and the existing
`block-reason` slot shows "Merge your scout to reach {rarity}". Consumables and
grimoires are never tier-locked. Implemented by extending `shopGearReason` /
adding an egg reason that is only consulted in courier mode (normal mode passes no
cap, so nothing locks).

### Deliver → cart → checkout

Courier mode changes the buy affordance (normal mode keeps immediate price-button
buys + a "Leave" button):

- **Buy buttons read "Deliver"**; the price is shown in the row text instead of on
  the button.
- **`cartItem = signal<CartItem | null>(null)`** holds at most ONE staged item:
  `CartItem = { kind: 'gear'|'consumable'|'grimoire'|'egg'; id?: string; tier?: number; name: string; cost: number; payload: Record<string, unknown> }`
  where `payload` is the `pet-scout-buy` body (`{itemId}` or `{kind:'egg', tier}`).
- Tapping Deliver stages that item (`cartItem.set(...)`); the row shows an "In
  cart" state. Tapping a different row's Deliver swaps the cart. Tapping the
  staged row again clears it (`cartItem.set(null)`).
- **Bottom bar** (replaces the courier-mode "Leave"):
  - `cartItem() === null` → button reads **"Leave"** → `closeFacilities()`.
  - `cartItem()` set → button reads **"Purchase for {cost} Spores"** →
    `checkoutCourier()`.
- `checkoutCourier()`: guard on `!scoutOnCooldown()` and a staged item; dispatch
  `pet-scout-buy` with `cartItem().payload`; on success toast, re-peek to refresh
  depleted stock, clear the cart, and close the modal (cooldown is now armed).
- **On cooldown** (`scoutOnCooldown()`): all Deliver buttons and the checkout are
  disabled, with a "Your scout is resting" hint; staging is blocked. Peek/browse
  stays free.

### Creature tab

Remove the courier modal + logic added there previously (`scoutOpen`,
`scoutView`, `openScoutCourier`, `scoutBuy`, `scoutGearLocked`, `scoutEggLocked`,
`closeScoutCourier`, `scoutOnCooldown`, `canAfford` if now unused, and the modal
markup). Replace the per-pet scout action button with a small **disabled
informational chip**: "Scout from the board map" — so the active-pet card doesn't
show a dead button.

### Server (optional, additive)

`_pet_scout_peek` currently returns `_clean(_shop_stock(...))`, which carries the
integer `window` but not `refreshesAt`. To make the courier header's restock timer
and rotating-keeper index accurate, include the same `refreshesAt` the normal
bazaar view uses (derive it from the shop window end). Without this the client
falls back to "now" — harmless (keeper still renders, timer just less precise),
so this is polish, not a blocker. No rules change; `pet-scout-buy` and the tier
gate are unchanged.

## Data flow

Scout box → `pet-scout-peek` (free) → `scoutView` + `shopMode='courier'` → shop
modal renders biome stock with pet+keeper header and tier locks → player taps
Deliver (stages one item) → bottom bar shows "Purchase for X Spores" →
`checkoutCourier()` → `pet-scout-buy` → server charges full price, delivers, arms
the scout cooldown → re-peek → modal closes.

## Testing

- **Server:** unchanged — the existing `tests/test_undercity_scout_remote_buy.py`
  (peek / remote-buy / tier gate / cooldown) and companions suite must stay green.
  If `refreshesAt` is added to peek, extend `test_peek_returns_biome_stock_without_cooldown`
  to assert the field is present.
- **Frontend:** no test runner — verify with `npm run build` (clean compile; no
  dangling references to the removed courier members in either tab).
- **Manual (optional, `run-undercity`):** with an active scout in a bazaar biome,
  tap the board scout box → confirm the shop modal opens with the shopkeeper + pet
  header and courier line; rows above the tier cap are locked; tapping Deliver
  stages one item and the bottom bar reads "Purchase for X Spores"; checkout buys
  it and arms the cooldown; reopening shows Deliver disabled while resting; a
  shopless biome toasts instead of opening.

## Out of scope / non-goals

- No multi-item cart or batch purchase (one staged item per cooldown).
- No change to walk-in shopping (normal `shopMode==='shop'` behavior identical).
- No change to merge, egg/hatch, or scout balance numbers (tier table, cooldown).
- No shared-component extraction of the shop modal (board-tab keeps it; creature
  tab does not reuse it).
