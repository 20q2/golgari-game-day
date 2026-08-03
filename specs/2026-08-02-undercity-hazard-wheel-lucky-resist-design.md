# Undercity — Hazard wheel: Lucky vs Resist split (2026-08-02)

**Status:** built + tests green (server + client). Deploy pending.

**Supersedes** the `hazardSafe` single-flag model from
[2026-08-01-undercity-def-perks-hazard-dodge-design.md](2026-08-01-undercity-def-perks-hazard-dodge-design.md).
That plan gave Thick Hide a full-dodge that landed on one generic "safe" wedge.
This change splits *no-harm* into two flavours and adds a baseline lucky slice for
everyone, so the wheel visibly rewards both luck and the Thick Hide perk.

## Motivation

The old wheel had a single "safe" concept (one green tick) that only Thick Hide
could reach, and no baseline lucky outcome. A player whose hazard "slid off" their
hide saw either an indistinct safe tick or — far more often — the plain hazard,
because Thick Hide's *other* effect (HP halving on a landed hazard) is not a dodge
and correctly still shows the hazard. Result: the perk felt unrewarded.

## Design

Two distinct no-harm outcomes, both mechanically "nothing happens":

- **Lucky** (gold sparkle, `auto_awesome`) — a small baseline chance that *any*
  creature no-sells a **surface** hazard. Pure luck, no perk required.
- **Resist** (green shield, `shield`) — Thick Hide's own turn-aside. Same result,
  Thick-Hide flavour.

The hazard wheel always carries **one lucky slice**; a Thick Hide creature also
gets a couple of **resist tease slices**. Wedge 0 (the rigged winner) shows the
actual outcome: lucky face / resist face / rolled effect / lair boss.

### Depths are exempt from luck

`HAZARD_LUCKY_AVOID` applies on the **surface only** (0 in the depths). Down there
only Thick Hide's resist can turn a hazard aside, keeping the boss approach brutal
(consistent with the solo-boss difficulty intent and the DEF-perk dodge design).

## Server (`infrastructure/lambda/`)

- **`undercity_config.py`** — `HAZARD_LUCKY_AVOID = 0.08` (surface-only baseline
  no-harm chance, tunable; set to 0 to disable). Thick Hide's own chance still
  comes from the existing `THICK_HIDE_DODGE_*` scalars.
- **`undercity_db.py`**
  - `_hazard` (surface): one shared `_rng.random()` draw `r` partitions
    `[0,1)` → lucky `[0, LUCKY)` → resist `[LUCKY, LUCKY+dodge)` (perk only) → hit.
  - `_dungeon_hazard` (depths): no lucky band; Thick Hide resist only.
  - Event fields (replacing `hazardSafe`):
    - `hazardAvoid: 'lucky' | 'resist'` — present only when the hazard did no
      harm; says which no-harm wedge won.
    - `hazardPerk: true` — set whenever the creature has Thick Hide (avoid **or**
      hit), so the wheel paints the resist tease slices even on a landed hazard.

## Client (`src/app/undercity/`)

- **`services/undercity-models.ts`** — `SpaceEvent` gains `hazardAvoid?` and
  `hazardPerk?`; `hazardSafe?` removed.
- **`tabs/board-tab.component.ts`** — `hazardWheelTarget` reads
  `hasPerk = ev.hazardPerk === true` and `avoid = ev.hazardAvoid`; surface
  `outcome = avoid ? 'safe' : ev.hazardOutcome`.
- **`tabs/hazard-wheel.component.ts`** — `HazardWheelTarget.avoid` replaces
  `safe`; `LUCKY_FACE` / `RESIST_FACE` replace the single `SAFE_FACE`;
  `LUCKY_TEASE_SLOT` always renders one lucky slice and `RESIST_TEASE_SLOTS`
  render resist teases when `hasPerk`.

The wheel is still cosmetic/predetermined — the server decides the outcome; the
wheel just lands wedge 0 on the matching face. Slice counts are flavour, not odds.

## Tests

`infrastructure/lambda/tests/test_undercity_db.py` hazard suite rewritten to the
new schema, plus new coverage:

- `test_surface_hazard_lucky_avoid` — baseline lucky fires for a non-perk pest.
- `test_surface_hazard_resisted_by_thick_hide` — draw lands in the resist band.
- `test_surface_hazard_hit_flags_perk_for_teases` — landed hazard still carries
  `hazardPerk`.
- `test_dungeon_hazard_resisted_by_thick_hide` / `test_dungeon_has_no_lucky_avoid`
  / `test_dungeon_resist_uses_reduced_chance` — depths: resist only, no luck.

## Balance knob

`HAZARD_LUCKY_AVOID` (default `0.08`) is the one number to tune for baseline
surface mercy. Depths difficulty is unaffected by it.
