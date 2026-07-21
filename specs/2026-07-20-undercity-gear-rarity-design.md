# Undercity — Gear Rarity & Scaling

**Date:** 2026-07-20
**Status:** Draft, pending user review
**Part of:** [Plaza Economy umbrella](2026-07-20-undercity-plaza-economy-umbrella.md)
**Sibling spec:** [Forge Economy](2026-07-20-undercity-forge-economy-design.md) (owns upgrading/materials — the *climb*; this spec owns the *ladder*).
**Builds on / extends:** [2026-07-20-undercity-gear-expansion-design.md](2026-07-20-undercity-gear-expansion-design.md),
[2026-07-18-undercity-gear-drops-design.md](2026-07-18-undercity-gear-drops-design.md),
[2026-07-14-undercity-combat-redesign-design.md](2026-07-14-undercity-combat-redesign-design.md).

## Problem

Gear already carries a `tier` (1/2/3) on server ([undercity_data.py](../infrastructure/lambda/undercity_data.py)
`GEAR`) and client ([items.ts](../src/app/undercity/data/items.ts)), wired into cost
bands and drop weights — but **the tier is never shown** (equip tiles
[creature-tab.component.html](../src/app/undercity/tabs/creature-tab.component.html#L149)
show only a name + rider blurb), so a player can't tell a starter piece from a
top-tier one.

Worse, rarity carries no *promise of a stronger effect*. Rider effects are fixed-
strength binary flags (`has_rider('bramble')` → flat `BRAMBLE_REFLECT`); only flat
stats and cost scale by tier. The same `spiked` on a T2 Bark Hide and a T3 Troll
Hide reflects the **same** amount — a rarer piece is a bigger stat-stick, not a
stronger effect. So "if I found a Common Thorns, a better Thorns must exist" — the
player's natural intuition — is false today.

## Goal

Make rarity legible and meaningful, on three pillars:

1. **Legible rarity** — Common (grey) / Rare (green) / Legendary (gold), shown
   everywhere gear appears.
2. **Effects scale with rarity** — a rarer piece is a *stronger version of the same
   effect* (Common Thorns reflects 1, Legendary reflects 3).
3. **Full effect-family ladders** — every rider exists at all three rarities, so the
   "a better one exists" promise is literally true.

*Climbing* the ladder (upgrading a piece you own) and the *materials* that gate it
are specified in the **Forge Economy** spec; this spec provides the rungs and the
`GEAR_FAMILY` index it needs.

Non-goals: no new riders, no new combat mechanics, no random-roll/affix system.

## Relationship to the "purely horizontal" invariant

The gear-expansion doc kept the roster **horizontal** ("no stat-ceiling inflation").
This design adds a **vertical** axis with minimal disruption:

- **Existing pieces keep name/tier/stats/cost/rider.** Each *becomes* the rung it
  already occupies. The one exception: riders that today sit on **both T2 and T3**
  with identical magnitude (`deep_biter`/`spiked`/`rabid`/`bulwark`) get a modest
  **T3 magnitude buff** so the ladder is monotonic — this is the intended point
  (Legendary > Rare), not incidental.
- We only **fill missing rungs** (~28 new pieces) so every family spans all three
  rarities.
- **The stat ceiling does not rise.** New Legendaries reuse the T3 stat band. What
  newly scales is *rider magnitude*, in gentle steps → small per-find power delta,
  no enemy rebalance needed beyond re-running the tests.

## Rarity model

`rarity` is derived from `tier`, not a new stored field:

| tier | rarity | color |
|---|---|---|
| 1 | Common | neutral grey (`--text-muted`) |
| 2 | Rare | Golgari green (`--accent-color`) |
| 3 | Legendary | warm gold (new `--rarity-legendary` token) |

A client `tierRarity(tier)` helper is the single source; the server keeps using
`tier`.

## Architecture — rider magnitude that scales

### 1. `RIDER_SCALE` table (the whole ladder, one place)

New table in [undercity_data.py](../infrastructure/lambda/undercity_data.py):

```python
# Effect magnitude per rarity (tier). One row per rider = the whole ladder.
# Replaces the flat global constants (BRAMBLE_REFLECT, VENOM_BARB_BONUS, ...).
# Anchored so the Rare (t2) rung ≈ today's live value; gentle steps keep the
# per-find power delta small. Validated by test_balance_good_play_beats_fodder.
RIDER_SCALE = {
    # rider         {1: common, 2: rare, 3: legendary}   # unit / anchor to today's value
    'barbed':       {1: 1,    2: 2,    3: 3},      # rot stacks on Aggress (T1 today=1)
    'bloodfang':    {1: 0.40, 2: 0.50, 3: 0.60},   # heal frac of Aggress-win dmg (T1 today=0.40)
    'deep_biter':   {1: 0.35, 2: 0.50, 3: 0.70},   # +win MULTIPLIER (T2 today=0.50; T3 buffed)
    'rabid':        {1: 1,    2: 2,    3: 3},       # +ATK ramp per Aggress win (T2 today=2; T3 buffed)
    'gutcleaver':   {1: 0.35, 2: 0.50, 3: 0.70},   # +win multiplier vs <30% HP (T2 today=0.50)
    'thick':        {1: 0.15, 2: 0.20, 3: 0.25},   # stall chip-through mult (T1 today=0.15)
    'spiked':       {1: 1.3,  2: 1.5,  3: 1.8},     # guard-counter reflect mult (T2 today=1.5; T3 buffed)
    'bramble':      {1: 2,    2: 3,    3: 4},       # flat reflect when struck (T1 today=2)
    'bulwark':      {1: 1,    2: 1,    3: 2},       # +DEF per Guard round (T2 today=1; T3 buffed)
    'mossback':     {1: 2,    2: 3,    3: 4},       # heal per Guard round (T2 today=3)
    'trickster':    {1: 0.50, 2: 0.60, 3: 0.70},   # frac of lost-Feint punish negated (T1 today=0.50)
    'serrated':     {1: 1,    2: 2,    3: 3},       # flat cut to foe's next-round dmg (T2 today=2)
    'venomtrick':   {1: 1,    2: 2,    3: 3},       # rot on a winning Feint (T1 today=1)
    'cutpurse':     {1: 4,    2: 6,    3: 9},       # Spores after a won fight w/ Feint (T2 today=6)
}
```

**Anchoring rule:** each rider's magnitude equals its **current live value at the tier
it occupies today**, so no existing piece is nerfed. `RIDER_SCALE` lives in
`undercity_config.py` (re-exported into `undercity_data`), replacing the flat
constants `BRAMBLE_REFLECT` / `CUTPURSE_SPORES` and the engine's hardcoded rider
numbers. **`seer`/`glint` are not in this table** — read-rate already scales per-piece
via the gear `readBonus` field, set on each rung in Phase 2.

### 2. `Combatant` carries per-rider magnitudes

[undercity_engine.py](../infrastructure/lambda/undercity_engine.py): the
`Combatant` already has `riders: frozenset`. Add `rider_mag: dict`, built at
construction from equipped gear (`rider_mag[rider] = RIDER_SCALE[rider][gear_tier]`)
and an accessor `mag(rider, default=0)`. `has_rider` stays for presence/binary
checks (glint's reveal); `mag` gives the scaled number.

### 3. Engine reads magnitude instead of constants

Each rider branch in `resolve_round` (+ helpers `_bramble`, `cutpurse_bonus`, and
`_read_chance`) swaps its flat constant for `s.mag('<rider>')` — e.g.
`-= data.BRAMBLE_REFLECT` → `-= struck.mag('bramble')`; `* 1.5` (spiked) →
`* winr.mag('spiked')`; deep_biter/rabid/bulwark/mossback/bloodfang/gutcleaver/
venomtrick/barbed/serrated/trickster/thick likewise; `readBonus` folds into
`mag('seer'|'glint')`. The old scalar constants are removed or become the Rare-rung
value the table references.

### 4. `GEAR_FAMILY` index (shared with the Forge spec)

A derived index `GEAR_FAMILY[rider] = {tier: gear_id}` built once from `GEAR`. It
powers the drop "is this an upgrade?" check *and* the Blacksmith's next-rung lookup.

## The full ladder — filling missing rungs

All 20 current pieces unchanged (their rung noted). **New** in bold. Stats follow
existing bands; charms stay light. New names follow family flavor with a rarity
badge; existing names are **not** reworked.

### Fangs — Aggress
| Family | Common (t1) | Rare (t2) | Legendary (t3) |
|---|---|---|---|
| barbed | Rusted Fang | **Serpent Fang** | **Wyrm Venomtooth** |
| bloodfang | Bloodfang | **Sanguine Fang** | **Vampiric Maw** |
| deep_biter | **Cutter Fang** | Kraul Barb | Wurm Tooth |
| rabid | **Feral Nip** | Rabid Fang | Ravening Maw |
| gutcleaver | **Notched Cleaver** | Gutcleaver | **Gravecleaver** |

### Carapaces — Guard
| Family | Common (t1) | Rare (t2) | Legendary (t3) |
|---|---|---|---|
| thick | Chitin Scrap | **Ridged Carapace** | **Colossus Shell** |
| bramble | Bramble Hide | **Bramble Carapace** | **Bramble Aegis** |
| spiked | **Thornscrap Hide** | Bark Hide | Troll Hide |
| bulwark | **Barricade Shell** | Bulwark Plate | Ironshell Bulwark |
| mossback | **Mossling Hide** | Mossback | **Overgrown Bulwark** |

### Charms — Feint
| Family | Common (t1) | Rare (t2) | Legendary (t3) |
|---|---|---|---|
| trickster | Quartz Charm | **Jester's Charm** | **Trickster's Idol** |
| venomtrick | Venom Charm | **Toxin Charm** | **Plaguebloom Idol** |
| serrated | **Chipped Charm** | Serrated Charm | **Lacerating Idol** |
| seer | **Glass Eye** | Seer Charm | **Oracle's Idol** |
| cutpurse | **Pickpocket Charm** | Cutpurse Charm | **Brigand's Idol** |
| glint | **Glimmer Charm** | **Gleam Charm** | Glint Charm |

~28 new `GEAR` entries; per-piece stat/cost lines are mechanical (copy the tier
band) and enumerated in the plan.

## Sourcing & zone-gating (find side)

- **Common + Rare:** bazaar rotation (`_gen_shop_stock` already picks random gear
  per slot per window — a wider catalog just deepens rotation, no UI change) and
  normal drops.
- **Legendary: drop-only** from rich sources (treasure/lair/boss — existing
  `GEAR_DROP` weights already favor t3). (Legendaries are *also* reachable by
  upgrading — that path lives in the Forge spec.)
- `_roll_gear_drop`'s auto-equip/auto-salvage is **replaced** by the Forge spec's
  stash + loot-choice; the rarity badge on the drop-reveal makes tier legible.

## Presentation (client)

- `tierRarity(tier)` helper + a rarity pill (colored dot + word) / colored border,
  applied to **equip tiles, shop rows, drop-reveal, and the bag/stash**.
- Blurbs show the **scaled** number ("Reflect **3** damage" at Legendary vs
  "Reflect **1**" at Common), from the client `RIDER_SCALE` mirror.

## Files to touch

**Backend:** `undercity_data.py` — `RIDER_SCALE`, `GEAR_FAMILY`, ~28 new `GEAR`
entries, add to bazaar/`GEAR_DROP`, retire flat rider constants. `undercity_engine.py`
— `Combatant.rider_mag` + `mag()`; swap rider branches; `_read_chance` uses `mag`.
`undercity_db.py` — `cutpurse_bonus` reads `mag`.
**Client:** `items.ts` — ~28 new entries, `RIDER_SCALE` mirror, `tierRarity`,
scaled-magnitude blurbs. Gear/shop/drop components — rarity badge/border.
**Docs:** [specs/undercity-combat.md](undercity-combat.md) §4 & §7 — `RIDER_SCALE`
is the new tuning surface; adding a piece = placing it in a family rung.
**Tests:** `test_rider_scale_monotonic` (ladders non-decreasing); per-rider
magnitude tests (Legendary > Common); keep `test_balance_good_play_beats_fodder` +
suite green.

## Balance & invariants

- Stat ceiling unchanged; only rider magnitude scales, in gentle steps.
- `RIDER_SCALE` anchored so **Rare ≈ today's live value**; net drift mild.
- Every ladder **monotonic non-decreasing** (enforced by test).
- Balance numbers mirrored between `undercity_data.py` and `data/*.ts` (combat spec
  §6), incl. `RIDER_SCALE`.

## Phasing

1. **Scaling core** — `RIDER_SCALE` + engine magnitude refactor with existing 20
   pieces re-anchored. Independently shippable; no new content.
2. **Ladder fill** — the ~28 new pieces + drop/shop reach.
3. **Legibility** — client rarity badges + scaled blurbs.

(Upgrading, materials, stash, and the Plaza buildings are the Forge Economy spec.)

## Coordination note

`undercity_data.py`, `undercity_db.py`, and the engine/tests have frequent in-flight
working-tree edits. Layer onto whatever is current, not the committed snapshot.
