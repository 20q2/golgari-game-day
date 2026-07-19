# Renown Shop (pre-spawn) — Design

**Date:** 2026-07-18
**Feature area:** Undercity sub-game — hatch/onboarding flow
**Status:** Approved, pending implementation plan

## Summary

A pre-spawn **Renown Shop** that appears as a step in the hatch flow — after the
player names their creature, before they spawn into the world. It sells:

- **Hats** (permanent unlocks, priced by rarity)
- **Colors / paints** (permanent unlocks, flat price)
- **Low-tier starter items** (one-night boost for the run about to begin)

Renown is a new **spendable balance saved to the player's permanent record**. New
players start with a small seed — enough for exactly one common hat *or* one plain
color. After a night closes out, the renown earned that night is banked into the
spendable balance for use in future nights.

## Motivation

Today "renown" is only a derived leaderboard score (`compute_renown`) — never
stored, never spendable. Cosmetics are *won* at random (mystery table) and applied
in-world via the `customize` action; there is no way to deliberately spend toward a
hat or color, and no player-facing pre-spawn customization beyond a seal-gated egg
tint. This feature gives players an agency loop: earn renown by playing → spend it
before the next spawn on cosmetics you choose and a small starting edge.

## Design decisions (confirmed)

1. **Hats & colors are permanent unlocks; items are one-night.** Buying a hat or
   color adds it to the permanent wardrobe forever (like earning one, but paid).
   Items apply only to the night the player is spawning into.
2. **Renown banks each night's earned score.** At night close-out, that night's
   `compute_renown(player)` is added to the permanent spendable balance. The
   leaderboard renown stays a separate derived score; only the *bank* accumulates.
3. **Shop shows every night and is skippable.** After naming, the player always
   lands in the shop with an always-enabled "Spawn into the world" button.
4. **Items are a fixed cheap starter kit** (not randomized/rotating), so players can
   reliably save toward a known item.
5. **Seed = 50 renown** = one common hat *or* one plain color.

## Architecture

The entire hatch flow (species → biome → name → egg tint) is ephemeral client state
that only becomes real when a single `join` action fires and both creates and spawns
the player. The renown shop follows this exact pattern: **it is one more step in the
hatch flow, backed by a client-side cart, committed atomically in the extended
`join` call.** The server performs all validation and debiting in one transaction —
prices are never trusted from the client.

Rejected alternatives:
- *Immediate per-click server purchases (a new `renown-buy` action):* would survive a
  mid-hatch refresh, but one-night items cannot be granted before the player doc
  exists (`join` creates it), splitting spending across two code paths — and it would
  be inconsistent with the existing flow, which already discards species/name on
  refresh.
- *A separate route/phase after `join`:* contradicts "before spawning" — `join` *is*
  the spawn.

### Component 1 — Spendable renown balance (permanent doc)

The permanent record `UNDERCITYUSER#{uid}/META` already stores cross-night `hats`,
`paints`, `seals`, `nights`. Add one field:

- **`renown`** (int) — spendable balance.

`_get_perm` (`infrastructure/lambda/undercity_db.py`) default gains
`'renown': config.SHOP_START_RENOWN`, so both brand-new players and existing perm
docs missing the field are seeded/backfilled to the seed amount.

- **What it does:** holds the player's spendable renown across nights.
- **How it's used:** read at `join` to check affordability and debit; read at
  `_archive_season` to credit; surfaced to the client in the `wardrobe` payload.
- **Depends on:** `config.SHOP_START_RENOWN`.

### Component 2 — Earning renown at night close-out

In `_archive_season` (`undercity_db.py`), while iterating players to build standings,
add each player's `compute_renown(player)` for that night into their perm doc's
`renown` field (alongside the existing lifetime-stat writes such as
`lifetimePvpWins` and `apexReached`).

- **What it does:** converts the night's performance into future spending power.
- **How it's used:** invoked once per night by the host-gated `season-end` path.
- **Depends on:** `compute_renown` (`undercity_data.py`), the perm doc.

### Component 3 — Server-authoritative price tables

Prices live server-side (source of truth), with client display mirrors:

- `undercity_data.py`:
  - `HAT_PRICES` by rarity — **common 50 / uncommon 120 / legendary 300**.
  - `PAINT_PRICE` — **40** flat (Forest & Gold remain free defaults).
  - `RENOWN_SHOP_ITEMS` — the fixed starter kit: a small ordered list of
    `{id, kind, cost}`, drawn from existing tier-1 `CONSUMABLES` / `GEAR` plus a
    spores pouch. Exact ids and per-item costs (~15–35) are finalized during
    implementation against the current item tables.
- `undercity_config.py`:
  - `SHOP_START_RENOWN = 50`.
- Client mirrors in `src/app/undercity/data/cosmetics.ts` (hat/paint prices) and
  `src/app/undercity/data/items.ts` (starter-kit list), matching the existing
  "server numbers + client mirror" convention.

### Component 4 — The shop step (client)

A new step in `src/app/undercity/hatch/hatch-flow.component.ts` (+ `.html` / `.scss`),
rendered after naming and before the spawn call. Driven by signals like the rest of
the flow. Sections:

- **Balance** — current `renown` from `store.wardrobe()`, decremented live by the cart.
- **Hats** — every hat not already owned, priced by rarity; buying carts a permanent
  unlock. Owned hats show "owned" and are available to equip.
- **Colors** — the 8 paints not already owned (Forest/Gold are free defaults), flat
  price; buying carts a permanent unlock.
- **Starter items (one-night)** — the fixed `RENOWN_SHOP_ITEMS` list.
- **Equip** — choose which owned hat and owned color to spawn wearing. This is the
  first pre-spawn hat choice in the game (today only the in-world `customize` action
  can set a hat). A chosen color overrides the seal-gated egg-shell tint for the body
  region.
- **"Spawn into the world →"** — always enabled (skippable).

Cart rules: the running total cannot exceed the balance; equip choices must resolve
to items owned *after* the cart's purchases (so you can buy-and-equip in one visit).

### Component 5 — Commit at spawn (extended `join`)

The `join` payload gains: `buyHats[]`, `buyPaints[]`, `buyItems[]`, `equipHat`,
`equipPaint`. Server-side `_join` becomes authoritative:

1. Compute true total cost from the server price tables; reject with a 409 if it
   exceeds `perm['renown']`.
2. Debit `perm['renown']`; add bought hats/paints into `perm['hats']` / `perm['paints']`.
3. Set the new player doc's `hat` / `paint` from the equip choices, validated against
   the now-owned sets (reusing the ownership checks from `_customize`).
4. Grant one-night items into the doc's `bag` / `gear` / `spores` (respecting
   `BAG_SIZE` and existing grant rules; over-cap purchases are rejected at validation).
5. Write the perm doc and player doc under the existing optimistic-`ver` guard.

`join` remains idempotent: if a player doc already exists, it returns early **before**
any debit, so a double-submit never double-charges.

## Data flow

```
Night close-out (season-end, host-gated)
  _archive_season: perm.renown += compute_renown(player)   [banked]

Next night, hatch flow (client, ephemeral cart)
  species → biome → name → RENOWN SHOP (cart) → "Spawn"

Spawn (single join action)
  client → join{ ...starter/home/name, buyHats, buyPaints, buyItems,
                 equipHat, equipPaint }
  server _join (atomic):
    validate cost ≤ perm.renown
    perm.renown -= cost;  perm.hats/paints += bought
    doc.hat/doc.paint = equip choices (validated owned)
    doc.bag/gear/spores += one-night items
    save perm + player (optimistic ver)
  → response includes updated wardrobe.renown and the new `you` doc
  → page flips to 'play'
```

## Error handling

- **Insufficient renown:** server rejects the whole `join` with a 409 and a clear
  message; client keeps the shop open. The client's cart guard makes this a rare
  edge (concurrent spend across devices).
- **Unowned hat/paint equip:** reuse `_customize`'s 409 ownership errors, evaluated
  after purchases are applied.
- **Bag overflow / already-owned item:** validated before debit; reject with a
  message, no partial charge.
- **Double-submit `join`:** idempotent early return, no debit.
- **Existing perm docs without `renown`:** backfilled to the seed by `_get_perm`.

## Testing

Extend the in-memory FakeTable pytest suite (`infrastructure/lambda/tests`):

- `_get_perm` seeds/backfills `renown` to `SHOP_START_RENOWN`.
- `_archive_season` credits each player's night renown into the perm bank.
- `join` with purchases: happy path (permanent unlock + one-night grant + equip),
  affordability rejection (no partial debit), unowned-equip rejection, bag-overflow
  rejection, and idempotent re-join does not double-charge.

Keep the suite green: `cd infrastructure/lambda && python -m pytest tests -q`.

## Out of scope / YAGNI

- Randomized/rotating shop stock (explicitly chosen fixed kit).
- Selling/refunding cosmetics back for renown.
- Renown transfers/gifting between players.
- Reworking the existing mystery-table cosmetic drops (they continue unchanged).
- Any change to the leaderboard `compute_renown` weights.
