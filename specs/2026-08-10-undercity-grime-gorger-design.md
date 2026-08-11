# Grime Gorger — an apex that rewrites the board

**Date:** 2026-08-10
**Status:** designed, not implemented
**Art:** `public/undercity/player_sprites/grime_gorger.{png,mask.png,hat.png}` (already in the repo)

## Premise

The Grime Gorger is a tier-3 apex: a hulking refuse-elemental that eats junk and
spits out fertile ground. It is the game's first **economy apex that edits the
map**. Every other form interacts with the board by *travelling* it; the Gorger
is the only one that can change what a space *is*.

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

Yields are deliberately **superlinear in rarity**, so rarity is what matters,
and gear is the good fuel while consumables are a dump valve for surplus:

| Rarity | Gear → Mulch | Consumable → Mulch |
| --- | --- | --- |
| Common | 2 | 1 |
| Rare | 5 | 2 |
| Legendary | 11 | 4 |
| Mythic | 24 | 8 |

Anchoring: gear costs 23 / 47 / 82 / 150 and sells back at 50%, so an item's
true opportunity cost is ~11 / 23 / 41 / 75 Spores. Per Spore forgone, the ladder
runs 5.5 / 4.6 / 3.7 / 3.1 Spores per Mulch — so feeding Mythic gear really is
about **1.8× more efficient** than feeding Common. That is intentional: rarity
should matter, and it carries its own counterweight, because high-rarity gear is
*wearable*. Eating a Mythic piece means giving up the best equipment in the game.

Mulch lives on the creature doc and is season-scoped like the rest of it: it
survives death, and it is gone at the next new night.

## Reclaim — the output

Standing on a space, the Gorger spends Mulch to **rewrite what that space is**.

**Eligible ground** (soft tiles only): `wild`, `hazard`, `fog`, `loot`,
`mystery`, `cache`, `trove`, `rest`.

**Never eligible** — the map's bones stay untouchable: `gate`, `boss`, `shop`,
`vault`, `vault_lock`, `shrine`, `witch`, `ossuary`, `warp`, `ladder`, `tunnel`,
`barrier`, `lair`, `elite`, `crystal_vein`, `excavation`. It cannot create or
destroy infrastructure, cannot delete an elite (protecting the challenge
economy), and cannot overwrite another player's dig site.

Three further eligibility rules close the edge cases:

- A `fog` node may only be reclaimed **once revealed** — you cannot re-landscape
  ground you have not seen. Its `FOG#` record simply stops mattering afterwards,
  since the effective-type layer takes precedence.
- A node already holding **another player's claim** is not eligible, even though
  `loot`/`cache`/`rest`/`trove` are otherwise soft types. Claims cannot be stolen
  or overwritten between two Gorgers.
- The target type must differ from the node's current effective type, so a
  `trove` cannot be "reclaimed" into a `trove` for nothing.

**Three rungs.** Any rung may be bought outright on fresh ground by paying its
listed total; upgrading a claim later pays only the difference, so a patient
Gorger is never punished for starting small. The UI reads as a running investment
("78 / 120 invested"):

| Rung | Mulch (total) | The space becomes |
| --- | --- | --- |
| I | 25 | `loot` — repeatable forage, ~8–15 Spores plus item/gear/molting chances |
| II | 55 | `cache` **or** `rest`, player's choice |
| III | 120 | `trove` **or** `crystal_vein`, player's choice |

Rung-III `crystal_vein` joins its region's existing vein depth pool, which is
already region-keyed — no new mining state.

**Three standing claims, ever.** This is the structural cap, and it is the whole
answer to abuse. Planting a fourth collapses the oldest back to its original
type, with no refund. The decision is always *where*, never *how many*.

Claims are visible to the entire table and anyone may land on them, labelled
with the owner's name. They are season-scoped, so they die with the night.

## Why this cannot be exploited

**The market.** Listings are bounded to 0.5×–2× of base cost. The cheapest
possible Mulch is therefore Mythic gear bought at the 0.5× floor — 75 Spores for
24 Mulch, about **3.1 Spores per Mulch** — and the realistic rate is worse, since
players list high-rarity gear nearer the 2× ceiling (~12.5 Spores per Mulch).
Across that whole range:

| | Best case (fire-sale Mythic) | Realistic (market-rate) |
| --- | --- | --- |
| One rung-III site (120 Mulch) | ~375 Spores | ~1500 Spores |
| All three sites at rung III (360 Mulch) | ~1100 Spores | ~4500 Spores |

Even the best case is a serious sum, and it buys exactly **three tiles**. The
exploit does not scale, because the cap is structural rather than economic —
wealth converts into *quality*, never quantity. And the floor case requires
another player to dump Mythic gear at half price, which costs *them* real value;
that is a trade, not an arbitrage.

**The roll economy.** No new roll sink is introduced. Gorging is a stash action.
Reclaiming is free but requires standing on the node, so its price is the trip.
Rolls gate how *fast* the board changes; Mulch gates how *good* it gets. Two
independent axes, and rolls remain the master clock — consistent with the
step-timer principle (gate the player's action economy on spaces and rolls, not
on the wall clock).

**Farming.** A reclaimed loot tile pays ~10 Spores a landing against a rung-I
cost of 25 Mulch — roughly 80–140 Spores of forgone value — so break-even is
about **8–14 landings on that one tile**. Reaching it means spending a large
share of a night's total movement revisiting a single space, while every other
space on the board also pays. So it is a weak Spore printer at best, and only for
a player who deliberately makes their night boring. Its real value is measured
against *the tile it replaced*: converting the hazard and wild ring around your
loop into forage ground turns rolls you were already spending from risk into
guaranteed yield. That is a consistency-and-utility payoff, the same shape as
Treasure Sense.

## Server implementation

### `undercity_config.py` — scalars

```python
GORGE_BAG_SIZE          = 10        # the Gorger's bag; normal BAG_SIZE stays 5
GORGE_MULCH_GEAR        = {1: 2, 2: 5, 3: 11, 4: 24}
GORGE_MULCH_CONSUMABLE  = {1: 1, 2: 2, 3: 4, 4: 8}
RECLAIM_MAX_CLAIMS      = 3
RECLAIM_RUNG_COST       = {1: 25, 2: 55, 3: 120}   # cumulative
```

### `undercity_data.py` — tables

- `APEX['grime_gorger']` — name, `bonus`, `passives: ['gorge', 'reclaim']`,
  `from: ['brackish_trudge', 'shambling_shell', 'woodwraith_strangler']`, blurb.
- `RECLAIM_ELIGIBLE` — the frozenset of overwritable node types.
- `RECLAIM_RUNGS = {1: ['loot'], 2: ['cache', 'rest'], 3: ['trove', 'crystal_vein']}`.

### `undercity_db.py` — behaviour

**A per-creature bag cap.** Add `bag_cap(doc)` returning `GORGE_BAG_SIZE` for a
Grime Gorger and `data.BAG_SIZE` otherwise, then route the seven existing
`data.BAG_SIZE` call sites through it (lines 1590, 1926, 3664, 4395, 5164, 7331,
7526). The effective cap ships in state as `you.bagCap` so the client stops
hardcoding it.

**An effective-type layer, not a mutated map.** `_season_map()` returns the
module-level `data.MAP_NODES` object directly when `PROCEDURAL_DUNGEONS` is off,
so **the node graph must never be mutated** — doing so would corrupt global
state across Lambda invocations. Instead:

- `_reclaimed(table, sid)` — one `begins_with(sk, 'RECLAIM#')` query returning
  `{node: {type, rung, invested, by, byName, origType}}`.
- `_effective_type(table, sid, node)` — the reclaimed override, else the season
  map's type. `_resolve_space` reads through this, including for its
  `_metric(doc, f'space.{ntype}')` call so metrics reflect what actually
  happened.

**Two new actions** on the dispatcher:

- `gorge` — `{kind: 'gear'|'consumable', index}`. Removes the item, credits
  Mulch by rarity, returns the new total. Rejects non-Gorger callers.
- `reclaim` — `{rung, target, release?}`, acting on the player's current node.
  Validates form, node eligibility, Mulch balance, and that `target` is in
  `RECLAIM_RUNGS[rung]`. Charges `RECLAIM_RUNG_COST[rung]` minus whatever is
  already invested in this node. If the player
  already holds `RECLAIM_MAX_CLAIMS` claims and this is a *new* node, it returns
  409 with the claim list unless `release: <nodeId>` names the claim to
  collapse; the client then presents that choice explicitly.

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
- `tabs/board-tab.component.*` — the Reclaim modal on the current space: rungs,
  costs, the target choice at rungs II/III, and the release-a-claim prompt.
- `engine/board-canvas.ts` — render reclaimed nodes as their effective type plus
  a "cultivated" treatment so the change is legible to the whole table, with the
  owner's name in the node tooltip.
- `tabs/plaza-tab.component.ts:356` — replace the hardcoded `5` with the
  server's `bagCap`.

Per the project's symbol language, all new UI uses `uc-*` / Material icons —
no emoji.

## Tests

New `tests/test_undercity_grime_gorger.py`:

- Gorge credits the right Mulch per rarity for gear and for consumables, and
  consumes the item.
- Gorge and Reclaim both reject non-Gorger forms.
- The Gorger's bag accepts 10 consumables; every other form still caps at 5.
- Reclaim rewrites an eligible node, charges the rung cost, and a subsequent
  landing there resolves as the *new* type.
- Reclaim refuses each ineligible type, and refuses a node the player is not
  standing on.
- Reclaim refuses an unrevealed `fog` node, a node holding another player's
  claim, and a target matching the node's current effective type.
- A rung may be bought outright (rung III on fresh ground costs 120); upgrading
  an existing rung-I claim to rung III costs only the 95 difference.
- A fourth claim 409s with the claim list, then succeeds with `release`, and the
  released node resolves as its original type again.
- Insufficient Mulch is rejected without mutating state.
- Reclaimed state appears in `season.reclaimed` for a *different* player's state
  fetch.
- The existing `tests/test_undercity_signatures.py` stays green unchanged.

## Out of scope

- Any combat effect. The Gorger is deliberately an economy/utility apex.
- Creating or destroying infrastructure (shops, gates, vaults, elites).
- Feeding pets, eggs, or scrolls to Gorge — gear and consumables only.
- Claims surviving the night, or any cross-season board persistence.
- Excavation dig sites as a rung target; that plumbing is heavier than the
  payoff justifies.
