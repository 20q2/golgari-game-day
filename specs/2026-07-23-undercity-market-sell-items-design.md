# Undercity — Sell Bag Items & Scrolls on the Player Market

**Date:** 2026-07-23
**Status:** Design approved, pending implementation plan

## Goal

The Plaza Player Market currently lets players list **gear** (from `gearStash`)
for other players to buy with Spores. Extend it so players can also list:

- **Bag consumables** (`doc['bag']` — Healing Moss, Loaded Die, Scrying Spore, …)
- **Spell scrolls** (`doc['scrolls']` — one-shot spell carriers from the scroll satchel)

Equippable **grimoire tomes** (`doc['grimoires']`) are explicitly **out of scope** —
they carry per-player mutable contents (`grimoireSpells`) and are messier to trade.

## Approach

Generalize the three existing market functions
(`_market_list` / `_market_buy` / `_market_cancel` in `undercity_db.py`) with a
**`kind` discriminator** (`'gear' | 'consumable' | 'scroll'`), rather than adding
parallel endpoints per item type. A small per-kind registry maps
`kind → (inventory field, capacity, base-cost fn, catalog name)` so each function
stays a single generalized routine and the optimistic-lock / seller-credit logic
is written once.

**Rejected:** separate `market-list-consumable` / `-scroll` endpoints — triples the
action surface and duplicates the conflict-retry and `_credit_market_seller` logic.

## 1. Listing shape & backward compatibility

Existing listings are stored as:

```
{pk, sk: 'MARKET#<id>', id, sellerId, sellerName, gearId, price, createdAt}
```

New listings write `kind` + `itemId` instead of `gearId`:

```
{pk, sk: 'MARKET#<id>', id, sellerId, sellerName, kind, itemId, price, createdAt}
```

The DynamoDB table is `RETAIN` (live prod data), so **legacy rows** with `gearId`
and no `kind` must keep working. Everywhere a listing is read (state builder,
`_market_buy`, `_market_cancel`) resolve:

```python
kind = listing.get('kind', 'gear')
item_id = listing.get('itemId') or listing.get('gearId')
```

State (`handle_state`) emits per listing:

```
{'id', 'sellerId', 'sellerName', 'kind', 'itemId', 'price'}
```

The gear-specific `gearId` key is dropped from state output in favour of
`kind` + `itemId`.

## 2. The kind registry (server)

| kind | inventory field | capacity | base cost |
|------|-----------------|----------|-----------|
| `gear` | `gearStash` | `GEAR_STASH_SIZE` (6) | `GEAR[id]['cost']` |
| `consumable` | `bag` | `BAG_SIZE` (**3**) | `CONSUMABLES[id]['cost']` |
| `scroll` | `scrolls` | `SCROLL_SATCHEL_CAP` (6) | `INSCRIBE_COST[SPELLS[id]['tier']]` |

Implemented as a module-level dict in `undercity_db.py`, e.g.:

```python
_MARKET_KINDS = {
    'gear':       {'field': 'gearStash', 'cap': data.GEAR_STASH_SIZE,
                   'cost': lambda i: data.GEAR[i]['cost'],
                   'name': lambda i: data.GEAR[i]['name']},
    'consumable': {'field': 'bag', 'cap': data.BAG_SIZE,
                   'cost': lambda i: data.CONSUMABLES[i]['cost'],
                   'name': lambda i: data.CONSUMABLES[i]['name']},
    'scroll':     {'field': 'scrolls', 'cap': data.SCROLL_SATCHEL_CAP,
                   'cost': lambda i: data.INSCRIBE_COST[data.SPELLS[i]['tier']],
                   'name': lambda i: data.SPELLS[i]['name']},
}
```

- **Price band** stays `0.5x–2x` of base cost
  (`MARKET_PRICE_MIN_PCT` / `MARKET_PRICE_MAX_PCT`) for every kind.
  `_market_price_band` becomes `(kind, item_id) -> (lo, hi)`.
- **`MARKET_MAX_LISTINGS`** stays a **shared** per-seller cap across all kinds.
- **Buy / cancel** check the *destination* capacity for that listing's kind before
  granting the item. `BAG_SIZE = 3` is deliberately tight — a full-bag buy simply
  returns a 409 "Your bag is full — make room first." (accepted, not worked around).

### Function changes

- `_market_list(table, sid, doc, payload)` — payload gains `kind` (default `'gear'`
  for safety). Validate `kind in _MARKET_KINDS`, pull the item from that kind's
  inventory field by `index`, price-band check against that kind's base cost, then
  write a `kind` + `itemId` listing. Unchanged: `MARKET_MAX_LISTINGS` guard,
  optimistic-lock save, listing id generation.
- `_market_buy` — resolve `kind`/`itemId` (with legacy fallback), check the
  destination field's cap, append `itemId` to that field, pay/credit as today.
- `_market_cancel` — resolve `kind`/`itemId`, check the destination cap, return
  `itemId` to that field.

## 3. Client (`plaza-tab.component.*` + `data/items.ts`)

- **`marketRows`** (`plaza-tab.component.ts`): enrich each listing by `kind` —
  look up the catalog (`GEAR_MAP` / `CONSUMABLE_MAP` / `SPELL_MAP`), keep `own`
  flag. Render:
  - gear → slot svg icon + gear rarity badge (`tierRarity`)
  - consumable → its material icon (`CONSUMABLE_MAP[id].icon`), no rarity badge
  - scroll → a scroll/spell icon + spell tier rarity badge
- **"Sell from your stash"** becomes three grouped lists — gear stash, bag,
  scrolls — each row showing the per-kind price band and a **List** button that
  calls `marketList(kind, index, price)`.
- **`marketList`** gains a `kind` param, passed through to the `market-list` action.
- **`canBuy`** checks the destination cap by kind
  (`gearStash` ≥ 6 / `bag` ≥ 3 / `scrolls` ≥ 6).
- **Mirrors** (`data/items.ts`): generalize `marketPriceBand` to take a base cost
  (or a `(kind, id)` pair) instead of assuming gear; add an `INSCRIBE_COST` mirror
  `{1:10, 2:20, 3:30}` for scroll base cost (source: `undercity_config.py`).

## 4. Tests (`infrastructure/lambda/tests/test_undercity_market.py`)

Extend the existing suite:

- consumable list → buy → seller credited, buyer bag gains item, listing gone
- scroll list → buy round-trip (base cost from `INSCRIBE_COST` by tier)
- cancel returns a consumable / scroll to the right inventory field
- price-band rejection per kind (too low / too high)
- destination-cap-full rejection on buy (esp. `bag` at `BAG_SIZE = 3`)
- a **legacy `gearId` listing** (no `kind`) still buys correctly
- shared `MARKET_MAX_LISTINGS` counts mixed-kind listings together

Run: `cd infrastructure/lambda && python -m pytest tests -q` — keep green.

## 5. Blacksmith — tag equipped rows (small, related UI)

The Blacksmith upgrade list (`plaza-tab.component.html`, the `b === 'blacksmith'`
block) already distinguishes rows by `where: 'equipped' | 'stash'` and renders a
`stash` tag for stash rows, but equipped rows carry no marker. Add a matching tag
so players can see which upgrade candidates are the gear they're currently wearing:

```html
@if (row.where === 'stash') { <span class="forge-tag">stash</span> }
@if (row.where === 'equipped') { <span class="forge-tag">equipped</span> }
```

Client-only, no backend or data changes. Scope note: this marks *equipped gear
that still has a higher rung* (the only equipped gear the Blacksmith lists) — a
full always-on loadout summary was considered and declined.

## Notes / invariants

- No new balance scalars beyond reusing `MARKET_PRICE_MIN/MAX_PCT`.
- Client display numbers that mirror server values (`INSCRIBE_COST`) must match —
  see the CLAUDE.md "update the mirrors" rule.
- The quick-sell-to-game path (Salvage Yard `mode='sell'`, 50% Spore buyback) is
  unrelated and unchanged; this is player-to-player only.
