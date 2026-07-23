# The Undercity — Hybrid Equipment (design)

Date: 2026-07-23. Companion to [undercity-combat.md](undercity-combat.md) (§4 Add
equipment) and [2026-07-21-undercity-attribute-perks-design.md](2026-07-21-undercity-attribute-perks-design.md).

## Goal

Add a small **off-ladder gear line** that trades the rider effect entirely for
**stats split across two of the three perk attributes** (ATK/DEF/SPD). It sits
beside the two existing off-ladder lines — **Vital** carapaces (rider → big Max
HP) and **Illuminating** gear (power → full-dungeon light) — as a third "give up
the effect for something else" axis.

The point (design intent): give players a real **acquisition tradeoff** when
reaching for attribute perks. Because `engine.perk_stat` now counts equipped-gear
stats toward the **6 / 12 / 18** perk thresholds (base + gear; temporary buffs
still excluded), a two-stat piece can **bridge a creature across two perk nodes
at once**. Hybrid gear is the reward for building wide, and the deliberate
counter-choice to a potent single-stat rider piece. Hybrid pieces grant **no
rider** — the split stats are their whole value.

## The three pieces

All tier 2, no rider. Each pairs the slot's **native** stat (primary) with one
other perk stat (secondary), so the tradeoff reads as "give up this slot's rider
for a spread." Together they cover all three attribute pairs and can be worn
simultaneously as a triple-hybrid generalist loadout.

| id | Name | Slot | Stats | Cost | Gives up |
|---|---|---|---|---|---|
| `duelist_fang` | Duelist Fang | fang | ATK 3 · SPD 2 | 46 | a fang ATK-rider |
| `warbrand_plate` | Warbrand Plate | carapace | DEF 3 · ATK 2 | 46 | a carapace DEF-rider |
| `wardens_charm` | Warden's Charm | charm | SPD 2 · DEF 2 | 46 | a charm rider |

**Stat budget rationale.** A tier-2 specialist gives ~4 in one stat **plus** a
rider. These give **5 total split across two tracks** — 4 on the charm, whose
rider is normally its whole value (charms carry only SPD 1 + a rider), so its
2·2 split is the rider compensation. The extra point vs a specialist's raw 4,
spread across two attributes, is the rider's worth converted to stats — the same
logic the Vital carapaces use (`engorged_carapace`: Max HP 12 + DEF 1, no rider,
tier 2, cost 46).

**Cost.** 46 = the tier-2 baseline (the `*_fang`/`*_hide` rarity-rung cost). Not
discounted: the two-perk bridge is valuable enough that "budget generalist"
should not also mean "cheaper than the specialist." Cost is a tuning knob.

## Mechanics — nothing new to wire

- **No rider** → no `GEAR_RIDERS` entry, no `engine.resolve_round` branch, no
  `RIDER_SCALE`. Stats flow through `engine.effective_stats` and `perk_stat`
  generically, exactly like every other stat on a gear piece.
- **Not in `GEAR_FAMILY`** (family is keyed by rider) → not forge-upgradable and
  **no Mythic (tier-4) craft path**. Off-ladder, like Vital/Illuminating. This is
  intended, not a gap.
- **Shop + drops are automatic.** Both selection paths filter purely on
  `slot` + `tier` with no rider whitelist:
  - Drops: `undercity_db._roll_gear_drop` picks a slot, then a tier by weight,
    then `rng.choice` over all `GEAR` of that slot+tier — the hybrids join the
    tier-2 pool automatically (`GEAR_DROP` tier-2 sources: elite, mystery,
    treasure, lair, boss).
  - Bazaar: the stock builder groups a slot's gear `by_tier` and `rng.choice`s
    within the chosen tier — hybrids appear in tier-2 bazaar stock automatically.
- **Equipping** is generic in `_buy` (no slot whitelist), so a bought/found
  hybrid equips like anything else and its stats immediately feed `perk_stat`
  (may light/dim a perk on equip/swap — the intended, already-live behavior).

## Work required

1. **`undercity_data.py`** — add a `# ── Hybrid line (tier 2) — two-stat, no
   rider ──` block to `GEAR` with the three entries above.
2. **Client mirror** — add the three entries to `GEAR` in
   [src/app/undercity/data/items.ts](../src/app/undercity/data/items.ts)
   (`rider` omitted; `atk`/`def`/`spd` set per the table). Display only.
3. **Tests** (`infrastructure/lambda/tests/`) — add a focused test asserting each
   hybrid piece: carries exactly two of `atk`/`def`/`spd`, has no `rider`, is
   absent from `GEAR_FAMILY`, and that equipping one raises `engine.perk_stat`
   for **both** its stats (i.e. it can bridge two thresholds). Keep the existing
   suite green (`cd infrastructure/lambda && python -m pytest tests -q`).

## Balance notes (playtest watch)

- **Two perks off one piece.** A base-9-ATK / base-11-DEF creature that equips
  `warbrand_plate` (DEF 3 · ATK 2) reaches ATK 11 (still short of 12) and DEF 14
  (lights the DEF-12 *Carapace Grind*); a base-10/base-10 creature could light
  two nodes from a single hybrid. This is the intended fantasy, but watch that it
  doesn't make the specialist rider pieces feel strictly worse for perk-hungry
  builds. Levers: the stat split and the cost.
- **Drop-table dilution.** Adding one hybrid per slot to the tier-2 pool slightly
  lowers the odds of any given specialist tier-2 piece dropping — same, small
  effect the Vital line already has. Acceptable; note it if drop feel changes.

## Out of scope (YAGNI)

- No tier-1 or tier-3 hybrids, no full rarity ladder (revisit only if the tier-2
  trio proves fun).
- No new "flexibility" rider family (considered and cut — the whole appeal is the
  clean stats-for-effect trade).
- No forge/Mythic path for hybrids.
