# Undercity — Scout Pet Redesign: Biome Bazaar Delivery

**Date:** 2026-08-05
**Status:** Design (awaiting review → plan)

## Problem

The scout role (Gloomshrieker / Winding Constrictor) is the weakest activated
companion by a wide margin:

1. **Payoff is nearly worthless.** `_pet_scout` reveals a bazaar's current-window
   stock remotely and mutates nothing (`infrastructure/lambda/undercity_db.py`
   `_pet_scout`). In a 6–8h session you can simply walk to the bazaar and look;
   the ability only buys a little foreknowledge.
2. **Leveling does nothing.** Every other pet's `petAbilityStats` grows with level
   (follow-up %, deflect, spores, item chance). The scout's *only* stat line is
   `Cooldown` (`src/app/undercity/data/pets.ts`). Investing moltings/gemstones or
   merging a scout buys only a shorter cooldown on a low-value peek.
3. **Strictly dominated by forage.** Forage is also activated, has a shorter base
   cooldown (20 vs 30 min), and hands you real Spores + a bonus-item chance.

This is not a numbers-tuning problem — the ability has no teeth. The fix is a
redesign of what "scout" *does*.

## Solution

The scout becomes a **biome bazaar courier**: it ranges ahead to the bazaar in
your **current biome**, reports its stock (the reveal it already does), and hauls
back **one item you choose** — at full price, without you spending movement to
reach the shop.

### Why this is balanced

- **Local, not global.** The scout only reaches the one bazaar in your current
  biome (`region` of your position). It is not a map-wide sniping tool.
- **Positioning still matters.** Only 6 of 9 biomes have a bazaar
  (cavern / bog / city / bone / isle / garden — one each). The deep biomes
  (depths / ruin / wilderness) have none, so the scout cannot deliver there. The
  cost that used to be "walk to the exact shop node" becomes "be in that shop's
  biome."
- **Full price, no markup.** The scout sells convenience (tempo — no movement
  spent, and a chance to grab stock before the 30-min window rotates), not
  discounts.
- **Merging is the payoff.** A level/tier-gated ceiling (below) means a fresh
  common scout is a humble errand-runner and a merged-up scout is a high-end
  courier — giving merging and leveling a scout a concrete, desirable reward for
  the first time.

### Tier ceiling (the level payoff)

The scout can only carry back items whose tier is ≤ a ceiling set by its **level**:

| Pet level | 1–2 | 3–4 | 5–6 | 7–9 |
|-----------|-----|-----|-----|-----|
| Max item tier | T1 | T2 | T3 | T4 |

Formula: `max_tier = min(4, 1 + (level - 1) // 2)`.

Because per-tier level caps are `{T1:3, T2:5, T3:7, T4:9}` (`PET_LEVEL_CAP`):

- A **Common (tier-1)** scout caps at level 3 → tops out fetching **T2** gear.
- Reaching the rare **T3 black-market** gear line and **T3/T4 eggs** requires
  **merging up** to Rare/Legendary/Mythic. This directly rewards the merge system,
  which today does nothing for a scout.

The gate applies to **gear and eggs** (the items with a meaningful tier).
**Consumables and grimoires** (cheap, all effectively T1) are always fetchable so
the scout is never useless at low level.

### Cooldown: free peek, spent on buy

- Opening the remote-bazaar view (revealing the biome bazaar's stock) is **free**
  and requires only an active scout and standing in a biome that has a bazaar.
- The shared cooldown (keyed by role `scout`, 30 min → 5 min floor as the pet
  levels — unchanged constants) starts **only when the scout actually hauls an
  item back** (a confirmed purchase). Window-shopping never wastes a cooldown.
- **One item per cooldown.**

## Architecture

### Server (`infrastructure/lambda/undercity_db.py` + `undercity_data.py`/`undercity_config.py`)

Two actions, dispatched via the existing pet-ability / action router:

1. **Peek** — `pet-scout-peek` (read-only, no cooldown).
   - Requires an active scout pet.
   - Finds the bazaar node in `region` of `doc['position']`. If the biome has no
     shop, return a 409 (`'No bazaar in this biome for your scout to reach.'`).
   - Returns `{ node, region, stock: _shop_stock(...), tierCap }` where `tierCap`
     is derived from the scout's level via the formula above.
   - Does **not** start the cooldown.

2. **Remote buy** — `pet-scout-buy` (mutating, starts cooldown).
   - Requires an active scout; requires `_pet_cd_ready(doc, 'scout')`.
   - Resolves the biome bazaar node the same way (server-authoritative — never
     trusts a client-supplied node).
   - Validates the chosen item is in that bazaar's current-window stock and that
     its **tier ≤ tierCap** (for gear/eggs; consumables/grimoires bypass the tier
     check).
   - Reuses `_buy`'s logic for: Spore balance, stock line depletion, gear
     auto-equip / stash-full guard, bag-full guard, egg/grimoire grants. Factor
     the shared body of `_buy` so both the at-shop path and the remote path call
     it rather than duplicating.
   - On success: delivers the item, then `_start_pet_cooldown(doc, 'scout', level)`.

New tunable (mirror in client): the tier-ceiling formula/table. Put the mapping in
`undercity_config.py` (e.g. `PET_SCOUT_TIER_BY_LEVEL` or the formula constants) so
it is tunable and mirrored, consistent with the balance-number conventions in
CLAUDE.md.

The old `_pet_scout` reveal-only handler is superseded by the peek action and
removed (or repointed) so there is one code path.

### Client (`src/app/undercity/`)

- `data/pets.ts`: mirror the tier-ceiling table/formula; update the scout's
  `petAbilityStats` to show a **meaningful, level-scaled** line — "Delivers up to
  **{rarity}** gear" (the tier ceiling) alongside the cooldown, replacing the
  lone `Cooldown` row.
- Scout board quick-use box (`tabs/board-tab.component.*`): instead of a
  reveal-only toast, open a **remote-bazaar modal** that:
  - calls `pet-scout-peek` and renders the biome bazaar's stock,
  - locks items above the tier ceiling (greyed, with a "Merge your scout to reach
    {rarity}" hint) — reusing the existing shop item card + the affordable-filter
    toggle,
  - on buying an unlocked, affordable item, calls `pet-scout-buy`; on success
    shows the delivery result and reflects the started cooldown.
- If the current biome has no bazaar, the box shows a disabled state with the
  reason (mirrors the server 409).

## Testing

Add `infrastructure/lambda/tests/test_undercity_scout_remote_buy.py` (in-memory
`FakeTable`, matching the existing companion tests). Cover:

- **Biome lookup:** delivers from the current biome's bazaar; 409 in a shopless
  biome (depths/ruin/wilderness); 409 with no active scout.
- **Tier gate:** a level-1 scout is blocked from a T2/T3 item; the same scout
  after leveling/merging can fetch it; consumables/grimoires always allowed.
- **Cooldown:** peek does not start the cooldown and can repeat; a successful buy
  starts it; a second buy before it elapses is rejected (429).
- **Economy parity:** full price is charged, stock depletes by one, insufficient
  Spores is rejected, and stash-full / bag-full guards fire the same as `_buy`.
- **Determinism:** peek and buy resolve the same current-window stock as a normal
  visit to that bazaar.

Run: `cd infrastructure/lambda && python -m pytest tests -q` — keep green.

## Out of scope / non-goals

- No markup, discount, or delivery fee (decided: full price).
- No map-wide reach — biome-local only.
- No change to forage/attack/defend/economy roles.
- No change to the shop window/restock cadence or `_gen_shop_stock`.
