# Undercity: Fourth Species — Zombie (replaces Spore)

**Date:** 2026-07-12
**Status:** Approved, ready for implementation plan

## Goal

Replace the fourth starter species, **Spore**, with **Zombie**. A zombie was
someone before it died — human, elf, dwarf, whatever — and none of that matters
now: it's part of the swarm. This is a **re-theme + passive reflavor**, not a
mechanical redesign. Stats and the underlying passive mechanic are unchanged, so
game balance and the backend engine logic are untouched.

A happy side effect: "Spore" the species collided with "Spores" the currency.
Renaming the species removes that ambiguity — the currency stays "Spores".

## Scope decisions

- **Depth:** re-theme + reflavor the passive's *display* only. The passive
  mechanic and id (`drift`) stay, so the flee/reroll engine logic and its tests
  do not change.
- **Internal id:** rename the species id `spore` → `zombie` everywhere (backend
  data keys, evolution `line` refs, frontend data, sprite manifest, sprite
  asset, tests, reference chart).
- **Save-data safety:** add a backward-compat alias so any creature already
  stored with `species: 'spore'` resolves to `zombie` and cannot crash the
  lookup.

## Identity & lore

| Field | Before | After |
|---|---|---|
| id | `spore` | `zombie` |
| Name | Spore | **Zombie** |
| Stats (hp/atk/def/spd) | 27 / 5 / 5 / 6 | **unchanged** |
| Blurb | "A trickster fungus. Hard to pin down, luckier than it looks." | "Was somebody once — human, elf, dwarf, nobody asks anymore. Dead now, and glad of it. The swarm looks after its own: slips a losing fight and shrugs off a cruel roll of fate." |
| Evolution line | Shambling Shell → Corpsejack Menace | **unchanged** (already reads undead) |

The blurb keeps a hook to the mechanic (evade + reroll) so the flavor isn't arbitrary.

## Passive reflavor (mechanic unchanged)

The passive **id stays `drift`** internally. Only its display strings change:

| Field | Before | After |
|---|---|---|
| Passive name | Drift | **Endless Ranks** |
| Mechanical blurb | "+15% flee chance; bad mystery events reroll once." | **unchanged** |

Flavor: the swarm is endless, so a bad turn gets a second draw and there's always
another body to slip behind.

## Art

Rename the placeholder sprite `public/undercity/sprites/spore.png` →
`zombie.png` and repoint the sprite manifest. The art remains a fungus
placeholder for now; a real zombie sprite is a future art swap, consistent with
the GDD placeholder approach, and is out of scope here.

## Affected sites

Species-`spore` references to rename → `zombie`:

**Backend (Python):**
- `infrastructure/lambda/undercity_data.py`
  - creature key `'spore'` → `'zombie'`; `name` "Spore" → "Zombie"; blurb reflavored.
  - two `'line': 'spore'` refs (Shambling Shell, Corpsejack Menace) → `'zombie'`.
  - **Backward-compat alias:** where creatures are looked up by species id, map a
    stored `'spore'` to `'zombie'` (e.g. an alias entry or normalization in the
    lookup) so old saves don't KeyError.
- `infrastructure/lambda/tests/test_lambda_routing.py` — `starter: 'spore'` and the
  `species == 'spore'` assertion → `zombie`.
- `infrastructure/lambda/tests/test_undercity_db.py` — the four `join` calls using
  `starter='spore'` → `zombie`.

**Frontend (TypeScript):**
- `src/app/undercity/data/forms.ts` — `STARTERS` entry (id, name, blurb,
  `passiveName`), two `TIER2` `line: 'spore'` refs, and `PASSIVE_NAMES.drift` /
  `PASSIVE_BLURBS.drift` display (name → "Endless Ranks"; blurb unchanged).
- `src/app/undercity/data/species.ts` — `FORM_SPRITES` key `spore` → `zombie` and
  its `sprite: 'spore'` → `'zombie'`.

**Assets:**
- Rename `public/undercity/sprites/spore.png` → `public/undercity/sprites/zombie.png`.

**Reference chart:**
- `UNDERCITY_EVOLUTION.html` — `data-id="spore"`, edge tuples referencing `spore`,
  the `--line-spore` CSS var, and the displayed label → zombie equivalents.

## Must NOT change (not the species)

These share the substring "spore" but are unrelated:
- **Spores** currency (all "+N Spores" / "Spores stolen" text).
- Spells `spore_bolt`, `spore_burst`; item `smoke_spore`; hazard `spore_cloud`.
- Boss "Ghave, Guru of Spores"; `vigorspore`; "sporecraft" blurbs; board ambient
  spore decals/terrain.
- The `myconid_sporetender` player sprite (dev-only color-test entry; not bound to
  the species id).

## Non-goals

- No stat retuning, no new passive mechanic, no engine changes.
- No renaming the tier-2/apex evolution forms (they already read undead).
- No real zombie art (future placeholder swap).

## Verification

- `cd infrastructure/lambda && python -m pytest tests -q` stays green (tests
  updated for the new id; alias covers legacy saves).
- `npm run build` succeeds (lint is broken repo-wide; build is the type-check gate).
- Map copy parity unaffected (no map.json change), but if any test asserts species
  ids, it must reflect `zombie`.

## Addendum (2026-07-13): sprite swap + Myconid enemy

Follow-up to the rename: the zombie starter should *look* like a zombie, and the
freed fungus art gets a second life as an enemy.

- **Zombie starter art:** repointed to the `sewer_shambler` enemy art (a green
  humanoid rotting zombie), cropped from its 256×150 two-figure sheet down to a
  single figure (108×145) and written to `public/undercity/sprites/zombie.png`.
  No code change — `FORM_SPRITES.zombie` already resolves to `sprites/zombie.png`.
- **New enemy — Myconid:** the original fungus art (the large red-capped mushroom
  creature) is copied to `public/undercity/enemies/myconid.png` and registered as
  a **surface wild** in `undercity_data.NPCS`:
  `{'id': 'myconid', 'name': 'Myconid', 'hp': 24, 'atk': 4, 'def': 2, 'spd': 2, 'bounty': 9, 'xp': 10, 'itemChance': 0.0}`.
  Appended after `sewer_shambler` so `test_npc_fixed_stats` (which checks index 0)
  is unaffected. Statline verified against the engine: a fresh L1 reference wins
  within the round cap, satisfying `test_level1_beats_every_normal_wild` (def 3
  would time out — def 2 is the tanky-but-fair line).
- **Frontend wiring:** `NPC_ICONS.myconid = 'grain'` (fallback icon; battle art is
  the PNG) in `items.ts`, and `undercity/enemies/myconid.png` added to the
  map-editor `SEED_IMAGES` palette.
