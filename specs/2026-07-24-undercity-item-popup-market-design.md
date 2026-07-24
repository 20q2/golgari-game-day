# Undercity — Item-detail popup + "send to market" (design)

**Date:** 2026-07-24
**Area:** `/undercity` creature tab (`src/app/undercity/tabs/creature-tab.component.*`)
**Status:** approved, ready for implementation plan

## Goal

On the creature tab, make every inventory item tappable to open a popup that
explains what it does, and replace the throw-away ("Drop"/trash) path with a
"send to market" path. Nothing gets destroyed — unwanted items go to the shared
Player Market cheaply by default. This makes Spores more valuable and gives
newer/behind players a cheap supply (community + comeback).

## Existing building blocks (reused, not rebuilt)

- **Player Market is already fully implemented.** Backend actions `market-list` /
  `market-buy` / `market-cancel` in `infrastructure/lambda/undercity_db.py`
  (§ "Player Market"), with bounded price bands
  (`MARKET_PRICE_MIN_PCT`/`MARKET_PRICE_MAX_PCT`) and a per-player listing cap
  (`MARKET_MAX_LISTINGS`). Listings route by kind into the player doc:
  `gear`→`gearStash`, `consumable`→`bag`, `scroll`→`scrolls`, all **by array
  index**. The Plaza → Forge tab already exposes a manual listing UI.
- **Client helpers** in `src/app/undercity/data/items.ts`: `MarketKind`,
  `marketBand(kind, id) → {lo, hi}`, `marketItemCost`.
- **Ability copy** in `src/app/undercity/data/combat.ts`:
  `RIDER_AUGMENTS[rider] → { stance, label, blurb }` — one entry per gear rider
  tag. Gear also carries structured `atk/def/spd/maxHp` and `light: 'full'`
  fields on `GearInfo`, so chips are built from structured data (not by parsing
  the packed `desc` string).
- **No `unequip` action exists.** `_equip_gear` is the only slot⇄stash mover, and
  the market lists only from the stash. We do **not** add an unequip action.

## Scope

- **In:** the three inventory groups shown as tiles/rows on the creature tab —
  equipped-gear slots, Stash gear, Bag consumables.
- **Out:** scrolls/grimoire (already sellable via the Plaza forge; not surfaced
  as creature-tab tiles). No backend changes. No new `unequip` action.

## Approach

Signal-driven overlay **inside the creature tab** (bottom-sheet, phone-first),
matching the component's existing inline-overlay/confirm pattern (`dropConfirm`,
book swap-confirm). No MatDialog dependency, no new component.

## UI

**Trigger.** Tapping an equipped-gear tile, a stash tile, or a bag row sets a
`selectedItem` signal describing `{ source: 'equipped' | 'stash' | 'bag', index,
id, kind }` and opens the overlay. A backdrop/close dismisses it.

**Popup contents**
- Header: slot icon, name, rarity badge, tier.
- **Stat chips** (informational, non-interactive): `+2 ATK`, `+1 SPD`,
  `+3 max HP` — derived from the item's structured stat fields.
- **Ability chips** (expandable): gear `rider` via `RIDER_AUGMENTS` (e.g.
  "Barbed"), plus an "Illuminating" chip when `light: 'full'`. Tapping a chip
  toggles its `blurb` open ("Aggress applies rot even on a clash or loss.").
  For a bag consumable, a single chip carrying its effect text.
- **Contextual actions:**
  - Stash gear → **Equip** (`equip-gear`, by index) · **Send to market**
  - Bag consumable → **Use / Plant** (existing `use-item`, respecting
    `itemAction()` plant/passive/battle cases) · **Send to market**
  - Equipped gear → info + chips only. To sell it, equip another piece first
    (which stashes the worn one), then list from the stash. No unequip action.

**Send-to-market (replaces Drop).** The action reveals a compact price control
**pre-filled with `marketBand(kind, id).lo`** (cheapest allowed), editable up to
`.hi`, plus a **List** button that calls `market-list` with `{ kind, index,
price }`. Success/queue errors (satchel full, listing cap reached) surface via
the existing `showToast`. On success the overlay closes.

**Removed.** The Bag row's trash button, `askDrop`/`cancelDrop`/`confirmDrop`,
the `dropConfirm` signal, and the inline drop-confirm markup. The UI no longer
calls the `drop-item` action anywhere. (The backend `drop-item` handler may stay
untouched — simply unused by the client.)

## Data flow

1. Tap tile/row → `selectItem(source, index, id)` sets `selectedItem`.
2. Popup reads `GEAR_MAP[id]` / `consumableMap[id]` for display, `RIDER_AUGMENTS`
   for ability blurbs, `marketBand` for the price band.
3. Equip → `store.action('equip-gear', { index })`.
   Use → `store.action('use-item', …)` (existing paths).
   List → `store.action('market-list', { kind, index, price })`.
4. Store optimistically updates; overlay closes; toast confirms.

## Error handling

- Reuse the component's `run()` wrapper (sets `busy()`, catches, toasts).
- Market rejections (`MARKET_MAX_LISTINGS`, capacity, price out of band) already
  return descriptive text — surface verbatim via toast; keep the overlay open so
  the user can adjust the price or cancel.

## Testing / verification

- No backend logic changes → the pytest market suite
  (`infrastructure/lambda/tests/test_undercity_market.py`) stays green as-is;
  run it to confirm no accidental coupling.
- Frontend has no test runner (per CLAUDE.md); verify via `npm run build` and by
  driving the creature tab in a browser (see the `run-undercity` skill): open a
  gear item → chips render and expand; list a stash item at the cheap default →
  it appears in the Plaza market; confirm no trash icon / drop path remains.

## Out of scope / non-goals

- No unequip action; no equipped-item direct listing.
- No changes to price bands, listing caps, or market economy numbers.
- No scroll/grimoire popup (already handled in the Plaza forge).
