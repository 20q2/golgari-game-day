# Undercity — Rot-Farm Bazaar first-visit welcome gift

**Date:** 2026-08-05
**Status:** Design approved, ready for implementation plan

## Problem

A fresh creature arrives at the Rot-Farm Bazaar with 0 Spores and can't buy
anything. The panel opens, every button is greyed for affordability, and the
player leaves empty-handed. That first bazaar visit feels bad exactly when a new
player is forming their impression of the shop.

## Goal

The **first time in a run** that a player shows up at a bazaar unable to afford
anything, the shopkeeper hands them a small gift "from the back" — a random
consumable — so nobody's first visit is a dead end. It happens once per run and
never repeats that night.

## Definitions

- **Run:** the current night's creature. The player `doc` is rebuilt fresh each
  night by the doc factory ([undercity_db.py:3062](../infrastructure/lambda/undercity_db.py)),
  so any per-run flag stored on the `doc` resets automatically when the host
  starts a new night. No explicit reset wiring is needed.
- **Can't afford anything:** `doc.spores` is below the cost of the cheapest item
  currently in the bazaar's stock (across all categories — see below).

## Where it lives — server-authoritative, inside the landing event

The gift is granted in `_resolve_space`, the `ntype == 'shop'` branch
([undercity_db.py:3944](../infrastructure/lambda/undercity_db.py)). This is the
single, authoritative moment a player "shows up" at a bazaar: it's the only path
that opens the bazaar panel on the client (`ev.type === 'shop'`,
[board-tab.component.ts:2351](../src/app/undercity/tabs/board-tab.component.ts)),
and the caller already persists the mutated `doc`. Piggybacking on this event
means no new action, no extra round-trip, and no second eligibility surface to
keep in sync.

Rejected alternative: a separate client-triggered `bazaar-welcome` action fired
when the panel opens. Redundant round-trip and duplicated eligibility logic.

## Eligibility — two gates

Both must hold; otherwise return the normal shop event unchanged:

1. `not doc.get('bazaarWelcomeGift')` — the per-run flag is unset.
2. `doc.get('spores', 0) < min_cost`, where `min_cost` is the minimum cost over
   the bazaar's current-window stock (`_shop_stock(table, sid, node)`):
   - gear lines with `qty > 0` → `data.GEAR[item]['cost']`
   - consumable lines with `qty > 0` → `data.CONSUMABLES[item]['cost']`
   - grimoires (always stocked, never deplete) → `data.GRIMOIRES[gid]['cost']`
   - egg lines with `qty > 0` → `line['cost']`

   Grimoires guarantee a non-empty set, so `min_cost` always exists. A fresh
   player starts at 0 Spores, so their first bazaar always passes this gate.

Bag-fullness and "is a consumable in stock" are **not** gates — the player always
leaves with something (see below).

## The gift — always fires once both gates pass

- **Bag has room** (`len(doc.get('bag', [])) < data.BAG_SIZE`): grant a random
  consumable drawn from *all* `data.CONSUMABLES` and append it to `doc['bag']`.
  This is the game's established "random consumable reward" convention
  (cf. `_give_consumable`, [undercity_db.py:990](../infrastructure/lambda/undercity_db.py)),
  so occasionally the gift is a premium combat trick — accepted, consistent with
  every other random-consumable reward. The gift is **not** drawn from and does
  **not** deplete the shared shelf stock (no stock write).
- **Bag full**: grant **1 Molting** via `_mine_materials(doc, moltings=1)`
  ([undercity_db.py:1319](../infrastructure/lambda/undercity_db.py)) instead.

Either branch then sets `doc['bazaarWelcomeGift'] = True`.

Use the module RNG (`_rng`) for the consumable pick, matching `_give_consumable`.

## Event payload

The shop event returned by `_resolve_space` gains a `welcomeGift` field and a
special shopkeeper `text`:

- consumable branch:
  `{'kind': 'consumable', 'item': <id>, 'name': data.CONSUMABLES[<id>]['name']}`
- molting branch:
  `{'kind': 'material', 'name': 'Molting', 'amount': 1}`

Shopkeeper line (flavor; no emoji, per the game's symbol-language rule):

> "New face — and not a spore to your name? The Rot-Farm doesn't send anyone off
> empty-handed. Here, a {name}, on the house. Come back when your purse rattles."

Bag-full / molting tail variant:

> "…your satchel's stuffed, so take a fresh Molting from the scrap bin instead."

When no gift is granted, the event keeps its existing text
("The Rot-Farm Bazaar creaks open.") and carries no `welcomeGift` field.

## Client

In the `ev.type === 'shop'` handler
([board-tab.component.ts:2351](../src/app/undercity/tabs/board-tab.component.ts)):
if `ev.welcomeGift` is present, store it in a new `welcomeGift` signal; clear it
when the shop closes (alongside the existing `showShop.set(false)` teardown).

In the bazaar panel, render a highlighted callout beneath the keeper quote
([board-tab.component.html:598](../src/app/undercity/tabs/board-tab.component.html))
showing the special dialogue plus the gifted item:

- consumable → the consumable's existing icon (via `CONSUMABLE_MAP` / the shop
  consumable row rendering) + its name.
- molting → the Molting icon (grass, per the established symbol language) +
  "Molting".

The item itself appears in the bag / materials via the refreshed `you` doc, as
with any other reward — the callout is purely the shopkeeper's dialogue moment.

## Testing (pytest, in-memory FakeTable suite)

Add coverage (new file or alongside the existing shop/pickup tests):

1. Broke fresh player (0 Spores) with bag room lands on a shop → a consumable is
   added to the bag, `doc['bazaarWelcomeGift']` is `True`, and the event's
   `welcomeGift.kind == 'consumable'`.
2. Broke fresh player with a **full** bag lands on a shop → `materials.moltings`
   increases by 1, flag set, `welcomeGift.kind == 'material'`.
3. Player who **can** afford the cheapest in-stock item lands on a shop → no
   gift, no flag, no `welcomeGift` field.
4. Second shop landing in the same run (flag already set) → no second gift.

Keep the existing suite green (`cd infrastructure/lambda && python -m pytest tests -q`).

## Out of scope / non-changes

- No balance-number changes; the special line is flavor only.
- No client data-mirror changes (`src/app/undercity/data/*.ts`) — the item is
  server-granted.
- No config knob — eligibility is a per-doc boolean, not a tunable.
