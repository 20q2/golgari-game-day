# Undercity — Split the Elf's innate ability into two named passives

**Date:** 2026-08-05
**Status:** Approved, ready for implementation

## Summary

The Elf starter currently has a single overloaded innate passive, **Stonewright**
(id `stonewright`), that bundles four effects:

1. Spawns with 5 attribute points to allocate (`GORGON_START_POINTS = 5`).
2. Gains only 1 stat point per level instead of the normal 2
   (`GORGON_STAT_POINTS_PER_LEVEL = 1` vs `STAT_POINTS_PER_LEVEL = 2`).
3. Gear it upgrades comes out hardened (Gear+).
4. Its active pet fights one level higher (`GORGON_PET_LEVEL_BONUS = 1`).

Split this one ability into **two clearly-named passives**. **No balance change** —
the numbers are identical to today; this is a naming/presentation reorganization
backed by a real data split so both abilities appear everywhere the game lists
passives.

| Ability | Internal id | Effects |
|---|---|---|
| **Natural Enchanter** (renamed from Stonewright) | `stonewright` (unchanged) | Gear+ forging (#3) + pet fights a level higher (#4) |
| **Gift of the Fair Folk** (new) | `gift_of_fair_folk` | 5 starting attribute points (#1) + 1 point/level instead of 2 (#2) |

Keeping the internal id `stonewright` for the Enchanter half avoids renaming an
id that is referenced across the engine, config, and tests; only the *display*
name flips to "Natural Enchanter". The stat-economy gates move to the new
`gift_of_fair_folk` id.

Rationale for the split: passives already accumulate through evolution and the
creature sheet already renders one pill per passive, so two real passives is the
natural, consistent model and costs little over a display-only hack. Separating
the stat economy from the crafting flavor also leaves each independently tunable
or reusable later.

## Server changes (`infrastructure/lambda/`)

### `undercity_data.py`
- Elf species entry (`STARTERS['elf']`): add
  `'passives': ['stonewright', 'gift_of_fair_folk']`, keep `'passive'` for any
  singular readers, and reword the blurb so the Stonewright/stat wording is gone
  and the crafting half reads as "Natural Enchanter".

### `undercity_db.py`
- `join` (spawn): set `'passives'` from `s.get('passives') or [s['passive']]` so
  the Elf spawns with both. Move the **start-points** grant from
  `'stonewright' in passives` → `'gift_of_fair_folk' in passives`.
- Leave the **Gear+** gate (upgrade path) and the **pet-level-bonus** gate
  (`_combatant`) on `'stonewright'`.
- **Migration:** in the passive-load path, when a loaded creature has
  `stonewright` but not `gift_of_fair_folk`, append `gift_of_fair_folk` so live
  Elves keep the 1/level rate. (Start points are hatch-time only, so no
  retroactive grant is needed.)

### `undercity_engine.py`
- `apply_level_ups`: move the per-level-rate gate from `'stonewright' in passives`
  → `'gift_of_fair_folk' in passives`.

### `undercity_config.py`
- Leave the `GORGON_*` constant names (internal). Update the comments to note the
  start/per-level scalars belong to Gift of the Fair Folk and the pet bonus to
  Natural Enchanter.

## Client changes (`src/app/undercity/`)

### `data/forms.ts`
- `PASSIVE_NAMES`: `stonewright → 'Natural Enchanter'`; add
  `gift_of_fair_folk → 'Gift of the Fair Folk'`.
- `PASSIVE_BLURBS`: reword `stonewright` (Gear+ + pet only); add
  `gift_of_fair_folk` ("Starts with 5 attribute points to allocate; gains only 1
  point per level instead of the normal 2.").
- `FormInfo`: add optional `passives?: string[]`.
- Elf `STARTERS` entry: `passiveName: 'Natural Enchanter'`, add
  `passives: ['stonewright', 'gift_of_fair_folk']`, reword `blurb`.

### `hatch/hatch-flow.component.ts` + `.html`
- Render one ability card per entry in the form's ability list
  (`form.passives ?? [form.passive]`), resolving name via `PASSIVE_NAMES` and
  text via `PASSIVE_BLURBS`. Today the showcase renders exactly one card.

### Creature sheet (`tabs/creature-tab.component.html`)
- No change: it already loops `you.passives` and renders a pill per id, so both
  abilities appear once the server sends two passives.

## Tests (`infrastructure/lambda/tests/`)

Extend the in-memory pytest suite and keep it green
(`cd infrastructure/lambda && python -m pytest tests -q`):

- Elf hatches with `passives == ['stonewright', 'gift_of_fair_folk']`.
- `gift_of_fair_folk` grants 5 starting stat points and 1 point per level;
  a non-Elf gets 0 start points and 2/level.
- `stonewright` still drives Gear+ on upgrade and the pet level bonus.
- Migration: a loaded Elf with only `['stonewright']` gains `gift_of_fair_folk`.

Client has no test runner; verify with `npm run build`.

## Out of scope

No changes to the tier-2/3 Elf forms (Wood Lurker / Gorgon / Daemogoth) beyond
the fact that both new passives accumulate through evolution exactly as
`stonewright` does today. No balance retuning.
