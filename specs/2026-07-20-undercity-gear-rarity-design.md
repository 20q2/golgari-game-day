# Undercity — Gear Rarity & Upgrade Progression

**Date:** 2026-07-20
**Status:** Draft, pending user review
**Builds on / extends:** [2026-07-20-undercity-gear-expansion-design.md](2026-07-20-undercity-gear-expansion-design.md),
[2026-07-18-undercity-gear-drops-design.md](2026-07-18-undercity-gear-drops-design.md),
[2026-07-19-undercity-deep-dungeons-design.md](2026-07-19-undercity-deep-dungeons-design.md),
[2026-07-14-undercity-combat-redesign-design.md](2026-07-14-undercity-combat-redesign-design.md).

## Problem

Two coupled problems, one root cause.

1. **Gear is illegible.** Every piece already carries a `tier` (1/2/3) on server
   ([undercity_data.py](../infrastructure/lambda/undercity_data.py) `GEAR`) and
   client ([items.ts](../src/app/undercity/data/items.ts)), wired into cost bands
   and drop weights — but the tier is **never shown**. The equip tiles
   ([creature-tab.component.html](../src/app/undercity/tabs/creature-tab.component.html#L149))
   show only a name + rider blurb, so a player can't tell if they're holding a
   starter or a top-tier piece.

2. **Progression dies after one good find.** Once a player finds a piece they like,
   there is nothing to strive toward — and a single find is a big enough power step
   that they "clap all combats." The chase evaporates. Rider effects are fixed-
   strength binary flags (`has_rider('bramble')` → flat `BRAMBLE_REFLECT`); only
   flat stats and cost scale by tier. So the same `spiked` on a T2 Bark Hide and a
   T3 Troll Hide reflects the *same* amount — a rarer piece is a bigger stat-stick,
   not a stronger effect. There's no ladder to climb and no way to invest in the
   piece you already love.

The game *does* already have a difficulty ramp to strive against — overworld fodder
(~22–34 HP), elites (~30 HP), the **wilderness frontier** (~46–70 HP, 13–18 ATK),
deep sigil dungeons, then Savra. The deep-dungeons doc notes players reach Savra
"faster than intended" — the mid-game is thin. So the content exists; what's
missing is a **legible, gated gear progression that maps onto it** and a reason to
keep gearing after the first find.

## Goal

Make gear a satisfying long-term chase, on four pillars:

1. **Legible rarity** — Common (grey) / Rare (green) / Legendary (gold), shown
   everywhere gear appears.
2. **Effects scale with rarity** — a rarer piece is a *stronger version of the same
   effect* (Common Thorns reflects 1, Legendary reflects 3), so the ladder is real.
3. **Upgrade the piece you love** — invest resources to advance an owned piece up
   its family's rungs (Common→Rare→Legendary). A good find is a *starting point*.
4. **Zone-gated, small steps** — each rung is matched to a content zone, and the
   final rung is gated behind deep/boss content, so no single find trivializes the
   game and combat stays tested as you climb.

Non-goals: no new riders, no new combat mechanics, no random-roll/affix system, no
enemy-scaling/NG+ treadmill (the fixed zone ramp does the difficulty work).

## Relationship to the "purely horizontal" invariant

The gear-expansion doc kept the roster deliberately **horizontal** ("new archetypes
at existing tiers, no stat-ceiling inflation"). This design **intentionally adds a
vertical axis** on top — but with minimal disruption:

- **No existing piece changes.** All 20 current pieces keep name/tier/stats/cost/
  rider; each *becomes* the rung it already occupies in its family's ladder.
- We only **fill missing rungs** (~28 new pieces) so every family spans all three
  rarities.
- **The stat ceiling does not rise.** New Legendaries reuse the existing T3 stat
  band. What newly scales is *rider magnitude*, in gentle steps — so the per-find
  power step stays small and enemies need no rebalance beyond re-running the tests.

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
    # rider         {1: common, 2: rare, 3: legendary}   # unit
    'barbed':       {1: 1, 2: 2, 3: 3},            # rot stacks on Aggress
    'deep_biter':   {1: 2, 2: 3, 3: 4},            # bonus dmg on a winning exchange
    'bloodfang':    {1: 0.30, 2: 0.40, 3: 0.50},   # heal frac of Aggress-win dmg
    'rabid':        {1: 1, 2: 2, 3: 3},            # +ATK per Aggress win (ramp)
    'gutcleaver':   {1: 0.35, 2: 0.50, 3: 0.70},   # +mult vs foe <30% HP
    'thick':        {1: 0.10, 2: 0.15, 3: 0.22},   # stall chip-through mult
    'spiked':       {1: 1.3, 2: 1.5, 3: 1.8},      # guard-counter reflect mult
    'bramble':      {1: 1, 2: 2, 3: 3},            # flat reflect when struck
    'bulwark':      {1: 1, 2: 1, 3: 2},            # +DEF per round ended in Guard
    'mossback':     {1: 2, 2: 3, 3: 4},            # heal per round ended in Guard
    'trickster':    {1: 0.30, 2: 0.50, 3: 0.70},   # frac of a lost-Feint punish negated
    'serrated':     {1: 1, 2: 2, 3: 3},            # flat cut to foe's next-round dmg
    'venomtrick':   {1: 1, 2: 2, 3: 3},            # rot on a winning Feint
    'cutpurse':     {1: 4, 2: 6, 3: 9},            # Spores after a won fight w/ Feint win
    'seer':         {1: 0.15, 2: 0.30, 3: 0.45},   # +read chance (was gear readBonus)
    'glint':        {1: 0.08, 2: 0.12, 3: 0.18},   # +read chance (reveal stays binary)
}
```

Starting anchors; final numbers are a tuning pass gated by the balance test.

### 2. `Combatant` carries per-rider magnitudes

[undercity_engine.py](../infrastructure/lambda/undercity_engine.py): the
`Combatant` already has `riders: frozenset`. Add `rider_mag: dict`, built at
construction from equipped gear (`rider_mag[rider] = RIDER_SCALE[rider][gear_tier]`)
and an accessor `mag(rider, default=0)`. `has_rider` stays for presence/binary
checks (glint's reveal); `mag` gives the scaled number.

### 3. Engine reads magnitude instead of constants

Each rider branch in `resolve_round` (+ helpers `_bramble`, `cutpurse_bonus`, and
`_read_chance`) swaps its flat constant for `s.mag('<rider>')`. E.g.
`-= data.BRAMBLE_REFLECT` → `-= struck.mag('bramble')`; `* 1.5` (spiked) →
`* winr.mag('spiked')`; deep_biter/rabid/bulwark/mossback/bloodfang/gutcleaver/
venomtrick/barbed/serrated/trickster/thick likewise; `readBonus` folds into
`mag('seer'|'glint')`. The old scalar constants are removed or become the
Rare-rung value the table references.

## The full ladder — filling missing rungs

All 20 current pieces unchanged (their rung noted). **New** in bold. Stats follow
existing bands; charms stay light. New names follow family flavor (hybrid
convention) with a rarity badge; existing names are **not** reworked.

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

## Upgrade system — climb the ladder of the piece you love

The load-bearing new mechanic. An owned gear piece can be **upgraded to the next
rung of its own family**, transforming it into that named higher-rarity piece (new
stats + scaled rider). Two paths to any rung — **find it** (luck, from drops/shop)
or **upgrade into it** (deterministic investment).

- **Where:** an "Upgrade" affordance on the piece in the **Gear tab** (no new board
  space). It shows the next rung, its scaled effect ("Reflect 2 → 3"), and the cost.
- **Common → Rare:** **Spores** only (≈ the Rare piece's shop cost). A pure
  Spore sink — reachable through normal mid-game play.
- **Rare → Legendary:** Spores **+ 1 deep material** (working name **Chrysalis
  Ichor**) that drops only from **wilderness elites / lairs / boss / dungeon
  troves**. This gates the top rung behind endgame engagement (pillar 4) while
  staying deterministic — you upgrade *your* piece rather than praying for a
  specific legendary drop. Chasing "one more Ichor for my Legendary" is the
  concrete mid/late-game carrot.
- **Server action:** new `POST /game/action` kind `gear-upgrade` (slot). The
  engine/db validates ownership + resources + material, swaps the equipped id to
  the family's next rung, debits Spores/material, returns the new piece.
- **Family lookup:** derive family = the piece's `rider` (+ slot); the next rung =
  the GEAR entry in that family at `tier+1`. A small `GEAR_FAMILY` index (rider →
  {tier: id}) built once from `GEAR` makes this O(1) and also powers the drop/upgrade
  "is this an upgrade?" checks.

## Sourcing & zone-gating

- **Common + Rare:** bazaar rotation (`_gen_shop_stock` already picks random gear
  per slot per window — the wider catalog just deepens rotation, no UI change) and
  normal drops. Weight shop/drops so Legendaries never appear here.
- **Legendary:** **drop-only** from rich sources (treasure/lair/boss — existing
  `GEAR_DROP` weights already favor t3), OR reached by upgrading with Chrysalis
  Ichor. Both require deep-content engagement.
- `_roll_gear_drop` already auto-equips a strictly-higher-tier drop and salvages the
  rest; the rarity badge on the drop-reveal toast makes the upgrade legible.
- **Chrysalis Ichor** is a new inventory material (not a gear/consumable): drops
  from the deep sources above at a modest rate; displayed in the player's resource
  header beside Spores.

## Presentation (client)

- `tierRarity(tier)` helper + a rarity pill (colored dot + word) / colored border,
  applied to **equip tiles, shop rows, drop-reveal toast, and the bag**.
- Blurbs show the **scaled** number ("Reflect **3** damage" at Legendary vs
  "Reflect **1**" at Common), sourced from the client `RIDER_SCALE` mirror.
- Gear tab gains the **Upgrade** control (next-rung preview + cost + a disabled/CTA
  state when you lack Spores or Ichor) and a Chrysalis Ichor counter in the resource
  header.

## Files to touch

**Backend ([infrastructure/lambda/](../infrastructure/lambda/)):**
- `undercity_data.py` — `RIDER_SCALE`; ~28 new `GEAR` entries; `GEAR_FAMILY` index;
  Chrysalis Ichor item + its drop hooks; add pieces to bazaar/`GEAR_DROP`; retire
  flat rider constants; upgrade cost knobs (into `undercity_config.py`).
- `undercity_engine.py` — `Combatant.rider_mag` + `mag()`; swap rider branches to
  `mag(...)`; `_read_chance` uses `mag`.
- `undercity_db.py` — `gear-upgrade` action (validate/swap/debit); Ichor drop
  granting on the deep sources; `cutpurse_bonus` reads `mag`.
- `lambda_function.py` — route the `gear-upgrade` action (existing dispatcher).
- `tests/` — `test_rider_scale_monotonic`; per-rider magnitude tests; upgrade-flow
  tests (happy path, insufficient resources, no-next-rung at Legendary); keep
  `test_balance_good_play_beats_fodder` + full suite green.

**Client mirrors ([src/app/undercity/data/](../src/app/undercity/data/)):**
- `items.ts` — ~28 new `GEAR` entries; `RIDER_SCALE` mirror; `tierRarity`;
  scaled-magnitude blurbs.
- Gear tab + shop + drop-toast — rarity badge/border; Upgrade control; Ichor counter.
- Whatever service issues `POST /game/action` — a `gear-upgrade` call.

**Docs:**
- Update [specs/undercity-combat.md](undercity-combat.md) §4 (add-equipment) & §7
  (tuning knobs): `RIDER_SCALE` and upgrade-cost knobs are the new tuning surface;
  adding a piece now means placing it in a family rung.

## Balance & invariants

- Stat ceiling unchanged; only rider magnitude scales, in gentle steps → small
  per-find power delta.
- `RIDER_SCALE` anchored so **Rare ≈ today's live value**; net drift mild.
- Every ladder **monotonic non-decreasing** (enforced by test).
- Balance numbers stay mirrored between `undercity_data.py` and `data/*.ts` (combat
  spec §6), including `RIDER_SCALE`.
- `test_balance_good_play_beats_fodder` stays green.

## Testing

- `cd infrastructure/lambda && python -m pytest tests -q` — green, incl. new
  monotonicity, per-rider magnitude, and upgrade-flow tests.
- `npm run build` — client compiles (repo lint is known-broken; verify via build).
- Manual: equip Common vs Legendary of a family (badge + scaled blurb + harder
  effect in battle); upgrade Common→Rare with Spores; fail Rare→Legendary without
  Ichor, then succeed with it.

## Phasing (this is two coupled features — the plan may split it)

1. **Scaling core** — `RIDER_SCALE` + engine magnitude refactor with existing 20
   pieces re-anchored. Independently shippable; no new content.
2. **Ladder fill** — the ~28 new pieces + drop/shop reach.
3. **Legibility** — client rarity badges + scaled blurbs.
4. **Upgrade system** — Chrysalis Ichor material, `gear-upgrade` action, Gear-tab
   Upgrade UI. The biggest slice; depends on 1–3.

## Coordination note

`undercity_data.py`, `undercity_db.py`, and the engine/tests have frequent in-flight
working-tree edits. Implementation should layer onto whatever is current, not the
committed snapshot.

## Open / deferred

- Chrysalis Ichor naming/art and exact drop rate — tuning.
- Whether Legendary should *also* be buyable late (currently no — drop/upgrade only).
- Exact per-piece stat/cost lines and upgrade Spore costs — enumerated in the plan.
