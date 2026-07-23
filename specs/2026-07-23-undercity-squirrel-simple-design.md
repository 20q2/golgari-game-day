# The Undercity — Squirrel Caster Race (SIMPLE) — design

**Status:** approved design, implementing inline.
**Date:** 2026-07-23.

A fifth playable race, the **Squirrel** — a caster line whose whole identity is
*spell multipliers*, not a new resource. Deliberately simple. **Supersedes** the
Acorn Stash / in-combat-casting design in
[2026-07-22-undercity-squirrel-caster-design.md](2026-07-22-undercity-squirrel-caster-design.md)
(§2.5 pillar 1 — spell level scaling — already shipped and is kept; the acorn
mechanic and in-combat casting are dropped). The witch/scrolls design is
unaffected.

## Forms

| Tier | id | Name | Sprite | Passive | Stats / bonus |
|---|---|---|---|---|---|
| 1 | `squirrel` | Squirrel | `squirrel` | `spell_haste` | hp 25 / atk 4 / def 4 / spd 7 |
| 2 | `squirrel_warrior` | Squirrel Warrior | `squirrel_general` | `spell_warrior` | +6 maxHp, +2 atk |
| 2 | `squirrel_mage` | Squirrel Mage | `squirrel_mage` | `spell_mage` | +4 maxHp, +2 spd |
| 3 | `squirrel_archmage` | Squirrel Archmage | `squirrel_mage` (placeholder) | `wish` | +6 maxHp, +2 spd; `from: [squirrel_warrior, squirrel_mage]` |

Passives **stack** (existing convention): a Warrior is `spell_haste + spell_warrior`;
an Archmage is `spell_haste + (spell_warrior|spell_mage) + wish`. So every squirrel
casts 50% faster, and the Archmage keeps its T2 identity plus Wish.

## Passive mechanics

All multipliers are tunable scalars in `undercity_config.py`.

- **`spell_haste` (T1)** — spell cooldowns are **halved** (`SPELL_HASTE_MULT = 0.5`).
  Applied in `_start_spell_cooldown`: a hasted caster's cooldown duration is
  `base × 0.5`. Affects every spell the squirrel casts.
- **`spell_warrior` (T2)** — spells cast **on yourself** are doubled
  (`SPELL_WARRIOR_MULT = 2`): self-buff stat deltas (Rot Surge +3→+6 ATK, Harden
  Shell +2→+4 DEF, Glowveil +2→+4 SPD) and self-heals (Mend Flesh ×2). Buffs
  carry a per-entry `mult`; `effective_stats` multiplies the delta by it.
- **`spell_mage` (T2)** — offensive spells the mage casts hit harder and land
  more often: damage/boss-strike **×1.5** (`SPELL_MAGE_DAMAGE_MULT = 1.5`), and
  the target's dodge chance is **halved** (`SPELL_MAGE_DODGE_MULT = 0.5`, "2×
  hit chance"). Stacks on top of level scaling.
- **`wish` (T3)** — the Archmage always knows one extra spell, **Wish**
  (`wish`), castable regardless of loadout. Casting Wish lets the player choose
  **any** spell in the game — any tier, including Spore Burst, Queen's Bane, and
  teleports — and casts it. Wish itself has a long cooldown (`60 min`); the
  chosen spell's own cooldown is NOT consumed. (With `spell_haste` the effective
  Wish cooldown is 30 min.)

## The Wish spell

- New `SPELLS['wish']`: `{category: 'boss', tier: 3, cooldownMin: 60, effect:
  'wish'}` (long cooldown; category only affects the picker icon/grouping).
- **Castability:** a creature with the `wish` passive may cast `wish` with
  `source: 'wish'`; no grimoire/biome check. No other creature can cast it.
- **Resolution:** payload `{spellId: 'wish', source: 'wish', wishSpellId, target?,
  value?}`. The server looks up `wishSpellId` in `SPELLS`, then resolves that
  spell's effect via the shared dispatch (the same code path a normal cast uses),
  applying the caster's own passives (a Mage-Archmage's wished Rot Bolt still
  gets ×1.5). Then it starts the **wish** cooldown only.
- **Invariants unchanged:** the wished spell still floors damage at 1 (board
  never-kill), still rolls dodge, still respects range/shield. Wish is a spell
  *selector*, not a rules bypass.

## Where the code changes land

Server (`infrastructure/lambda/`):
- `undercity_data.py` — `STARTERS['squirrel']`, `TIER2` warrior/mage, `APEX`
  archmage; `SPELLS['wish']`.
- `undercity_config.py` — `SPELL_HASTE_MULT`, `SPELL_WARRIOR_MULT`,
  `SPELL_MAGE_DAMAGE_MULT`, `SPELL_MAGE_DODGE_MULT`.
- `undercity_engine.py` — `effective_stats` respects a buff `mult`.
- `undercity_db.py` — extract the effect dispatch from `_cast` into
  `_resolve_spell_effect`; add the `spell_haste` cooldown factor in
  `_start_spell_cooldown`; warrior doubling in the self_buff/self_heal paths;
  mage ×1.5 damage + halved dodge in the field_damage / boss_strike paths;
  `wish` source + branch that delegates to `_resolve_spell_effect`.

Client (`src/app/undercity/`):
- `data/forms.ts` — four forms + `spell_haste`/`spell_warrior`/`spell_mage`/`wish`
  in `PASSIVE_NAMES` + `PASSIVE_BLURBS`.
- `data/species.ts` — sprites (squirrel / squirrel_general / squirrel_mage;
  archmage reuses squirrel_mage until dedicated art).
- `data/spells.ts` — mirror the `wish` spell entry.
- `hatch/hatch-flow.component.ts` — `squirrel: 'Caster'` archetype.
- `tabs/board-tab.component.*` — cast picker offers **Wish** when the creature
  has the `wish` passive; picking Wish opens a second picker listing every spell,
  then flows into that spell's normal target/value picker with the `wish` source.

## Tests

`infrastructure/lambda/tests/` — forms wired (starter/T2/T3/apex options);
`spell_haste` halves cooldown; `spell_warrior` doubles a self-buff delta (via
`effective_stats`) and a self-heal; `spell_mage` deals ×1.5 and halves dodge;
Wish resolves the chosen spell's effect, applies caster passives, and starts only
the wish cooldown; a non-`wish` creature cannot cast Wish. Keep the suite green.

## Out of scope

- No acorns, no charges, no in-combat casting (dropped from the earlier design).
- No dedicated T3 art yet (placeholder).
- Wish does not let you pick a spell you couldn't otherwise target validly (e.g.
  a boss-strike still needs a valid pool); it only removes the "must know it"
  gate.
