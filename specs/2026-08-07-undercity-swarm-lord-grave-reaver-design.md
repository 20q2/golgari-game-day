# Undercity — Swarm Lord & Colossal Grave-Reaver apex rework

**Date:** 2026-08-07
**Status:** Design approved, ready for implementation plan

## Problem

The insect (`kraul`) and pest lines have no *signature* apex. Every tier-3 form is a
shared pool: `swamp_dragon` (glass cannon, `rot_breath`) is reachable from eight tier-2
forms across four lines, and nothing reads as "this is what an insect becomes" or
"this is what a pest becomes." New art has landed (`swarm_lord.*` player sprites) and
the existing dragon art is a natural fit for a treasure-hoarding economy finale.

## Goals

- Give the **insect line** a signature glass-cannon finale: the **Swarm Lord**.
- Give the **pest line** a signature economy finale: the **Colossal Grave-Reaver**, a
  loot-finding "collector of treasure."
- Do it **save-safe** — no live creature's combat identity silently changes.

## Non-goals

- No new combat math beyond a new economy passive. The glass-cannon effect is unchanged.
- No boss/enemy changes (the `scouring_swarm` boss art in flight is a separate effort).
- No re-tuning of the existing apex roster's balance.

## Design

### 1. Swarm Lord — re-skin of the existing glass-cannon apex

The existing `swamp_dragon` apex **keeps its id, `from`-list, `bonus`, and combat
effect**, and is re-skinned into the insect finale:

| Field | Before | After |
|---|---|---|
| id | `swamp_dragon` | `swamp_dragon` *(unchanged — save-compat)* |
| name | Swamp Dragon | **Swarm Lord** |
| sprite | `swamp_dragon` | `swarm_lord` *(art already present)* |
| passive | `rot_breath` | **`onslaught`** *(same effect: round-1 winning strike ×2)* |
| `from` | 8-form list | unchanged |
| `bonus` | `{atk:2, spd:2}` | unchanged |

The passive is renamed `rot_breath` → `onslaught` (display "Onslaught", same
round-1-winning-exchange-×2 mechanic). An entry is added to `_PASSIVE_RENAMES`
(`'rot_breath': 'onslaught'`) so every live creature carrying `rot_breath` migrates on
load with **zero power change**. Insects (`kraul_warrior`, `golgari_longlegs`) already
sit in the `from`-list, so the insect line reaches the Swarm Lord with no `from` edits.

*Result:* anyone who had a Swamp Dragon simply sees a renamed, re-sprited Swarm Lord of
identical stats. Existing tests asserting `'swamp_dragon' in apex_options(...)` stay green
because the id lives on.

### 2. Colossal Grave-Reaver — new economy apex

A brand-new apex form inheriting the dragon art the Swarm Lord vacated:

| Field | Value |
|---|---|
| id | `grave_reaver` |
| name | **Colossal Grave-Reaver** |
| sprite | `swamp_dragon` *(the existing dragon art)* |
| passive | **`treasure_sense`** |
| `from` | `brackish_trudge`, `vexing_pest`, `deathrite_shaman` |
| `bonus` | `{maxHp:6, atk:2, def:2}` |

The `from`-list gives the **pest line** its signature apex (`brackish_trudge` = Bog
Forager, `vexing_pest` = the pest all-rounder) plus one sensible cross-line route
(`deathrite_shaman`, the grave-robbing ritualist). The `bonus` is a sturdy bruiser spread
nudged slightly above the ~2-stat apex curve to offset a **non-combat** passive — this is
an explicit balance lever (see tune-undercity-balance) and may be trimmed after play.

### 3. `treasure_sense` mechanic

A collector of treasure: gear drops fire far more often and roll one rarity tier higher.
Two hooks in `undercity_db.py`, driven by config scalars:

```
TREASURE_SENSE_DROP_MULT   = 2.0   # gear-drop chance multiplier
TREASURE_SENSE_RARITY_BUMP = 1     # rolled gear tier bump
```

- **Rarity bump (centralized):** inside `_roll_gear_drop(doc, tier_weights)`, if the
  creature `has('treasure_sense')`, bump the rolled tier by `TREASURE_SENSE_RARITY_BUMP`,
  **capped at tier 3** — never hands out craft-only tier-4 mythics. Single clean hook
  point; every gear-drop source benefits automatically.
- **Drop-chance boost (small refactor):** introduce a helper
  `_gear_drop_chance(doc, source) -> float` returning
  `min(GEAR_DROP[source][0] * mult, 0.95)` where `mult` is `TREASURE_SENSE_DROP_MULT`
  when the creature has the passive else `1.0`. Route the ~10
  `if _rng.random() < GEAR_DROP[source][0]` / inline-chance call sites through it. The
  0.95 cap keeps a `treasure` (0.50) or `enraged` (0.45) source below a guaranteed drop.

`treasure_sense` is a fresh passive id stored on `grave_reaver` creatures at evolution;
no migration needed.

## Touch points

**Backend**
- `undercity_config.py` — rename `FIRST_WIN_ROT_BREATH_MULT` → `ONSLAUGHT_MULT`; add
  `TREASURE_SENSE_DROP_MULT`, `TREASURE_SENSE_RARITY_BUMP`.
- `undercity_data.py` — `APEX['swamp_dragon']`: name → Swarm Lord, passive → `onslaught`,
  blurb; add `APEX['grave_reaver']`; ensure `treasure_sense` is described where passives
  are catalogued.
- `undercity_engine.py` — `winr.has('rot_breath')` → `has('onslaught')`; constant ref
  → `data.ONSLAUGHT_MULT`.
- `undercity_db.py` — add `'rot_breath': 'onslaught'` to `_PASSIVE_RENAMES`; tier-bump in
  `_roll_gear_drop`; add `_gear_drop_chance` helper and route the gear-drop call sites.

**Tests** (`infrastructure/lambda/tests/`)
- Rename `test_rot_breath_first_win_doubles` → onslaught (passive frozenset + constant).
- Add: `treasure_sense` bumps rolled gear tier (capped at 3) and multiplies drop chance;
  `grave_reaver` in `apex_options('brackish_trudge' / 'vexing_pest' / 'deathrite_shaman')`;
  a `rot_breath`-tagged save migrates to `onslaught`.
- Keep the full suite green (`python -m pytest tests -q`).

**Client mirrors**
- `src/app/undercity/data/forms.ts` — PASSIVE_NAMES/PASSIVE_BLURBS: replace `rot_breath`
  with `onslaught`, add `treasure_sense`; APEX list: rename `swamp_dragon` entry to Swarm
  Lord + `onslaught`, add `grave_reaver`.
- `src/app/undercity/data/species.ts` — FORM_SPRITES: `swamp_dragon` sprite →
  `'swarm_lord'`; add `grave_reaver` → sprite `'swamp_dragon'`.
- `src/app/undercity/data/combat.ts` — rename the `rot_breath` stance-augment entry key →
  `onslaught` (label/blurb unchanged; `treasure_sense` is not a combat-stance passive so
  needs no entry).
- `public/data/undercity-player-sprites.json` — register the `swarm_lord` sprite (keep
  `swamp_dragon`, still used by the Grave-Reaver).
- `UNDERCITY_EVOLUTION.html` — relabel the swamp_dragon card to Swarm Lord and add the
  `grave_reaver` node + its three evolution edges.

## Verification

- Backend suite green.
- `npm run build` green (lint is known-broken in this repo; build is the gate).
- Manual spot-check via the run-undercity flow: an insect evolving at level 10 offers the
  Swarm Lord (swarm_lord art, Onslaught); a pest offers the Colossal Grave-Reaver
  (dragon art, Treasure Sense); a Grave-Reaver's gear finds skew frequent and high-tier.

## Open balance levers (deferred to tune-undercity-balance / sim)

- Grave-Reaver `bonus` spread `{maxHp:6, atk:2, def:2}`.
- `TREASURE_SENSE_DROP_MULT` (2.0) and the 0.95 chance cap.
- `TREASURE_SENSE_RARITY_BUMP` (1) and its tier-3 ceiling.
