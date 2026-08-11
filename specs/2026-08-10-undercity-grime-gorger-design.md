# Grime Gorger — an apex that rewrites the board

**Date:** 2026-08-10 (revised 2026-08-11)
**Status:** designed, not implemented
**Art:** `public/undercity/player_sprites/grime_gorger.{png,mask.png,hat.png}` (already in the repo)

## Premise

The Grime Gorger is a tier-3 apex: a hulking refuse-elemental that eats junk and
spits out ground worth walking on. It is the game's first **economy apex that
edits the map**. Every other form interacts with the board by *travelling* it;
the Gorger is the only one that can change what a space *is*.

Its role at the table is groundskeeper. It hauls ten slots of trash around, eats
the filth off hazard tiles, and leaves three plots of cultivated ground that
everybody's pawns walk over. It is also the table's standing buyer for Common
gear — the first player who genuinely wants everyone else's junk.

Precedent for an economy-shaped apex passive is the Colossal Grave-Reaver
(`treasure_sense`): no combat effect, all value.

## Placement in the evolution graph

A second **non-signature shared apex**, like Golgari Lich Lord. Reachable from
the three scavenger/composter tier-2 forms:

| Source | Line | Why |
| --- | --- | --- |
| `brackish_trudge` | pest | Bog Forager already scrounges from losses — the primary flavour home |
| `shambling_shell` | zombie | shell-hoarder |
| `woodwraith_strangler` | saproling | fungal composter (displays as Sporeback Skirmisher) |

This keeps every invariant in `tests/test_undercity_signatures.py` green
(verified against the current tables):

- Each of the three gains a third option, going 2 → 3, within the 2–3 bound.
- `deathrite_shaman` is untouched — it is the only form already at 3.
- No sibling sets collide: pest becomes `{titan, reaver, gorger}` vs
  `{izoni, reaver}`; zombie `{titan, reaver, gorger}` vs `{titan, lich_lord}` vs
  `{titan, lich_lord, reaver}`; saproling `{titan, izoni, gorger}` vs
  `{dragon, izoni}` vs `{lich, izoni}`.
- Every line's signature stays reachable by all of its tier-2 forms.
- The new apex has 3 sources, satisfying the ≥2 rule.

**Stats:** `bonus: {maxHp: 8, def: 2}` — a slow, heavy hauler, sitting between
Grave Titan's wall (`{maxHp: 12, def: 4}`) and the Reaver's spread.

**Passives:** two, using the `passives: [...]` list precedent established by Elf
— `gorge` (input) and `reclaim` (output).

## Gorge — the input

**Bag 10.** The Gorger's consumable bag holds 10 instead of the normal 5. This
is the mechanical spine of the fantasy: it is a hauler, and it needs room to
carry junk to the ground it intends to feed.

**Devour for Mulch.** It can devour any stashed gear piece or bagged consumable
to gain **Mulch**, a new per-creature counter. Mulch is a third fate for an
item, alongside Salvage (→ moltings/ichor) and the Player Market (→ Spores). It
duplicates neither, so "what do I do with this junk" becomes a real fork.

| Rarity | Consumable → Mulch | Gear → Mulch |
| --- | --- | --- |
| Common | 1 | 2 |
| Rare | 2 | 4 |
| Legendary | 3 | 6 |
| Mythic | 4 | 8 |

Gear is worth double a consumable of the same rarity, which matches the real
price tables almost exactly (gear 23/47/82/150 against consumables 12/25/45/80).

Against 50% sell-back, Mulch costs roughly **6–9 Spores of forgone value** each —
and deliberately comes out *slightly worse* at high rarity (5.5 Spores per Mulch
for Common gear, 9.4 for Mythic). Commons are therefore the efficient fuel. That
is the right way round: it makes the Gorger the market's junk buyer rather than a
creature that cannibalises its own best equipment.

Scale check: a night's found-gear surplus is around a dozen pieces ≈ 35 Mulch, so
pure scavenging buys one good space or two cheap ones per night. Reaching the
expensive end of the price list requires deliberately buying other players' junk.

Mulch lives on the creature doc and is season-scoped like the rest of it: it
survives death, and it is gone at the next new night.

## Reclaim — the output

Standing on a space, the Gorger spends Mulch to **rewrite what that space is**.

### The freedom rule

> **A player may change what a space *does*. A player may never change what the
> map *is*.**

Two categories are therefore permanently off-limits, and everything else is for
sale:

- **Topology is sacred** — `gate`, `warp`, `ladder`, `tunnel`, `barrier`. These
  are connectivity, not outcomes. Editing them rewrites the graph itself and
  breaks the barrier system, and a player-made gate deep down would gut the
  descent, since a Gatestone recalls to *any* home gate and full-heals on
  arrival.
- **Landmarks stay unique** — `vault`, `vault_lock`, `shrine`, `witch`,
  `ossuary`, `boss`. There is one witch. A second one is not more content, it is
  less: the landmark stops being a landmark.

### Price list

| Mulch | Space created |
| --- | --- |
| 4 | `wild` — filth attracts vermin |
| 6 | `mystery` |
| 10 | `loot` |
| 12 | `elite` |
| 14 | `cache` |
| 18 | `rest` — **surface only** |
| 24 | `crystal_vein` / `excavation` — the biome's signature site |
| 30 | `trove` |
| 60 | `shop` — **surface only** |

A created shop needs no new plumbing: `_gen_shop_stock(nid, window)` is already
keyed per node, so a new shop node begins stocking itself on the next window.

`shop` at 60 is the number least trusted here, and the first one to revisit after
a real session.

### Why `rest` and `shop` are surface-only

`restsUsed` (`undercity_db.py:6256`) is tracked **per node**, not as a per-descent
count — each rest node is one full heal per descent. So a player able to create
rest nodes in the depths could manufacture extra full heals mid-run and dissolve
the attrition that makes a deep descent frightening. A created shop is the same
failure in economic form: the descent's tension is that you commit without
resupply. Both are freely creatable on the surface, where neither matters.

### The filth asymmetry

`hazard` can be **overwritten but never created**. A hazard on your own claim is
useless to you — you would not walk on it — so creating one can only ever be
aimed at other players: pure griefing with no self-benefit, in a game where PvP
is shelved. Making hazard a legal *source* and an illegal *target* encodes the
fantasy precisely: **the Gorger eats filth, it does not spread it.**

The same asymmetry runs the other way for `crystal_vein`, `excavation` and
`shop`: creatable, but never overwritable. You can make one; you cannot unmake
one. That also protects a dig site's uncollected `SITE#` loot from being erased.

**Overwritable (sources):** `wild`, `hazard`, `fog` (once revealed), `loot`,
`mystery`, `cache`, `trove`, `rest`, `elite`.
**Creatable (targets):** `wild`, `mystery`, `loot`, `elite`, `cache`, `rest`,
`crystal_vein`, `excavation`, `trove`, `shop`.

### Claims

**Three standing claims, ever.** This is the structural cap, and under these
cheaper prices it is the only thing between a wealthy hoarder and a rebuilt
biome. Planting a fourth collapses the oldest back to its original type, with no
refund. The decision is always *where*, never *how many*.

Re-landscaping one of your own claims pays the new type's **full price**, with no
credit for what is already invested — with a flat price list, "pay the
difference" is incoherent on a sideways move from `trove` to `rest`.

Three further eligibility rules close the edge cases:

- A `fog` node may only be reclaimed **once revealed**; you cannot re-landscape
  ground you have not seen. Its `FOG#` record stops mattering afterwards, since
  the effective-type layer takes precedence.
- A node holding **another player's claim** is not a legal source. Claims cannot
  be stolen between two Gorgers.
- The target must differ from the node's current effective type, so a `trove`
  cannot be "reclaimed" into a `trove` for nothing.

Claims are visible to the entire table and anyone may land on them, labelled with
the owner's name. They are season-scoped, so they die with the night.

## Why this cannot be exploited

**The market.** Listings are bounded to 0.5×–2× of base cost. Common gear is the
efficient fuel, so Mulch costs about **6 Spores** each at the absolute market
floor, ~11.5 at bazaar price, and ~23 at the 2× ceiling. In Spores:

| | Market floor | Bazaar price | Market ceiling |
| --- | --- | --- | --- |
| One `shop` (60 Mulch) | ~345 | ~690 | ~1380 |
| Three top-tier claims (180 Mulch) | ~1035 | ~2070 | ~4140 |

Even the floor case is a serious sum, and it buys exactly **three tiles**. The
exploit does not scale, because the cap is structural rather than economic —
wealth converts into *quality*, never quantity. The floor case also requires
other players to dump gear at half price, which costs *them* real value: that is
a trade, not an arbitrage.

**The roll economy.** No new roll sink is introduced. Gorging is a stash action.
Reclaiming is free but requires standing on the node, so its price is the trip.
Rolls gate how *fast* the board changes; Mulch gates how *good* it gets. Two
independent axes, and rolls remain the master clock — consistent with the
step-timer principle of gating a player's action economy on spaces and rolls
rather than the wall clock.

**Farming, and the real cost of it.** A `loot` tile costs 10 Mulch — about 60–115
Spores of forgone value — and pays ~10 Spores a landing, so it breaks even after
roughly 6–12 landings on that one tile. That is reachable if a player camps a
3-tile loop. What stops it is not arithmetic but opportunity cost: **a loot ring
pays no XP.** Levelling is the night's primary progression, and the target pacing
is L10 as the normal ceiling. A Gorger that camps its own forage loop banks Spores
and falls behind on levels, which is a genuine trade rather than a free lunch.

That tension is the intended shape of the whole price list, and it is why `wild`
is the cheapest thing on it: **cheap spaces buy XP, expensive spaces buy wealth.**
A Gorger that wants levels can carpet its route in 4-Mulch vermin dens; one that
wants Spores builds troves and forage ground and accepts a lower level at the
boss.

## Server implementation

### `undercity_config.py` — scalars

```python
GORGE_BAG_SIZE          = 10        # the Gorger's bag; normal BAG_SIZE stays 5
GORGE_MULCH_CONSUMABLE  = {1: 1, 2: 2, 3: 3, 4: 4}
GORGE_MULCH_GEAR        = {1: 2, 2: 4, 3: 6, 4: 8}
RECLAIM_MAX_CLAIMS      = 3
RECLAIM_PRICES = {'wild': 4, 'mystery': 6, 'loot': 10, 'elite': 12,
                  'cache': 14, 'rest': 18, 'crystal_vein': 24,
                  'excavation': 24, 'trove': 30, 'shop': 60}
RECLAIM_SURFACE_ONLY    = ('rest', 'shop')
```

### `undercity_data.py` — tables

- `APEX['grime_gorger']` — name, `bonus`, `passives: ['gorge', 'reclaim']`,
  `from: ['brackish_trudge', 'shambling_shell', 'woodwraith_strangler']`, blurb.
- `RECLAIM_SOURCES` — the frozenset of overwritable types (note: includes
  `hazard`, excludes `crystal_vein` / `excavation` / `shop`).
- Targets are the keys of `config.RECLAIM_PRICES`; no second table needed.

### `undercity_db.py` — behaviour

**A per-creature bag cap.** Add `bag_cap(doc)` returning `GORGE_BAG_SIZE` for a
Grime Gorger and `data.BAG_SIZE` otherwise, then route the seven existing
`data.BAG_SIZE` call sites through it (lines 1590, 1926, 3664, 4395, 5164, 7331,
7526). The effective cap ships in state as `you.bagCap` so the client stops
hardcoding it.

**An effective-type layer, not a mutated map.** `_season_map()` returns the
module-level `data.MAP_NODES` object directly when `PROCEDURAL_DUNGEONS` is off,
so **the node graph must never be mutated** — doing so would corrupt global state
across Lambda invocations. Instead:

- `_reclaimed(table, sid)` — one `begins_with(sk, 'RECLAIM#')` query returning
  `{node: {type, price, by, byName, origType}}`.
- `_effective_type(table, sid, node)` — the reclaimed override, else the season
  map's type. `_resolve_space` reads through this, including for its
  `_metric(doc, f'space.{ntype}')` call so metrics reflect what actually
  happened.

**Two new actions** on the dispatcher:

- `gorge` — `{kind: 'gear'|'consumable', index}`. Removes the item, credits Mulch
  by rarity, returns the new total. Rejects non-Gorger callers.
- `reclaim` — `{target, release?}`, acting on the player's current node.
  Validates form; that the node's effective type is in `RECLAIM_SOURCES` and is
  not another player's claim; that a `fog` source is revealed; that `target` is a
  `RECLAIM_PRICES` key and differs from the current effective type; that a
  `RECLAIM_SURFACE_ONLY` target is not in the `depths` region; and that the
  player holds enough Mulch for the full price. If the player already holds
  `RECLAIM_MAX_CLAIMS` claims and this is a *new* node, it returns 409 with the
  claim list unless `release: <nodeId>` names the claim to collapse; the client
  then presents that choice explicitly.

Writes go to `{pk: SEASON#<sid>, sk: 'RECLAIM#<node>'}`, matching the existing
`FOG#` / `LAIR#` / `BARRIER#` / `SHOP#` / `SITE#` shape. State gains
`season.reclaimed` (every claim, so all clients render the board identically)
plus `you.mulch`, `you.bagCap`, and `you.claims`.

## Client implementation

- `data/forms.ts` — the `APEX` mirror entry, `PASSIVE_NAMES` and
  `PASSIVE_BLURBS` for `gorge` and `reclaim`.
- `data/species.ts` — `grime_gorger: { sprite: 'grime_gorger', regions: MASK_REGIONS, scale: 1.3 }`,
  matching the other apexes' scale. The mask ships already, so recolouring works
  from day one.
- `services/undercity-models.ts` — `mulch`, `bagCap`, `claims`, `reclaimed`.
- `tabs/creature-tab.component.*` — a Mulch counter and the Gorge feeding UI
  (pick a stash/bag item, see its yield, devour).
- `tabs/board-tab.component.*` — the Reclaim modal on the current space: the
  price list with unaffordable and ineligible targets disabled and *why* shown,
  plus the release-a-claim prompt.
- `engine/board-canvas.ts` — render reclaimed nodes as their effective type plus
  a "cultivated" treatment so the change is legible to the whole table, with the
  owner's name in the node tooltip.
- `tabs/plaza-tab.component.ts:356` — replace the hardcoded `5` with the
  server's `bagCap`.

Per the project's symbol language, all new UI uses `uc-*` / Material icons — no
emoji.

## Tests

New `tests/test_undercity_grime_gorger.py`:

- Gorge credits the right Mulch per rarity for gear and for consumables, and
  consumes the item.
- Gorge and Reclaim both reject non-Gorger forms.
- The Gorger's bag accepts 10 consumables; every other form still caps at 5.
- Reclaim rewrites an eligible node, charges the price, and a subsequent landing
  there resolves as the *new* type.
- Reclaim refuses every non-source type, and refuses a node the player is not
  standing on.
- Reclaim refuses `hazard` as a target while accepting it as a source (the filth
  asymmetry), and refuses `crystal_vein` as a source while accepting it as a
  target.
- `rest` and `shop` are refused on a `depths` node and accepted on the surface.
- Reclaim refuses an unrevealed `fog` node, a node holding another player's
  claim, and a target matching the current effective type.
- Re-landscaping your own claim charges the new type's full price.
- A fourth claim 409s with the claim list, then succeeds with `release`, and the
  released node resolves as its original type again.
- Insufficient Mulch is rejected without mutating state.
- A created `shop` node serves stock on a following landing.
- Reclaimed state appears in `season.reclaimed` for a *different* player's state
  fetch.
- The existing `tests/test_undercity_signatures.py` stays green unchanged.

## Out of scope

- Any combat effect. The Gorger is deliberately an economy/utility apex.
- Creating topology (gates, warps, ladders, tunnels, barriers) or unique
  landmarks (vault, shrine, witch, ossuary, boss).
- Creating `hazard` — see the filth asymmetry.
- Feeding pets, eggs, or scrolls to Gorge — gear and consumables only.
- Claims surviving the night, or any cross-season board persistence.
