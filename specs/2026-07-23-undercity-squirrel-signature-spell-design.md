# The Undercity — Squirrel Signature Spell — design

**Status:** approved design, ready to plan.
**Date:** 2026-07-23.

Give the **Squirrel** caster race a unique, always-castable signature spell,
**Acorn Fury** — a small one-battle attack buff — introducing a new
*species-innate* slot that sits alongside the existing biome-innate. Builds on the
squirrel line from
[2026-07-23-undercity-squirrel-simple-design.md](2026-07-23-undercity-squirrel-simple-design.md)
and the spell system in [undercity-spells.md](undercity-spells.md).

## The spell — Acorn Fury

| Field | Value |
|---|---|
| id | `acorn_fury` |
| name | Acorn Fury |
| category | `buff` |
| effect | `self_buff` |
| buffKind | `acorn_fury` |
| magnitude | **+2 ATK next battle** |
| cooldown | **15 min** base (→ 7.5 min with squirrel `spell_haste`) |
| tier | I |
| range | — (self) |

- One-battle buff, consumed when the next fight ends — same lifecycle as Rot Surge
  (`acorn_fury` joins `ONE_BATTLE_BUFFS`).
- Because it is a `self_buff`, **Squirrel Warrior's `spell_warrior` ×2 doubling
  applies automatically** via the buff-entry `mult` → **+4 ATK on a Warrior**.
- Buff magnitude is flat — no level scaling (matches every other buff/curse).

## Delivery — a new "species-innate" slot

Innate spells are currently keyed only to home biome
(`BIOME_SPELLS[homeBiome]`, checked in `_cast`). We add a parallel, additive slot:

- **`SPECIES_SPELLS = {'squirrel': 'acorn_fury'}`** in `undercity_data.py`, keyed
  on the stored `species` (the starter id). `species` persists through evolution,
  so Squirrel Warrior / Mage / Archmage all keep Acorn Fury. The map is
  extensible for future species signatures.
- **Innate-cast check** ([undercity_db.py:3960](../infrastructure/lambda/undercity_db.py))
  accepts `source: 'innate'` when the spell matches **either** the caster's biome
  spell **or** its species spell:
  ```python
  innate_ids = {data.BIOME_SPELLS.get(doc.get('homeBiome')),
                data.SPECIES_SPELLS.get(doc.get('species'))}
  if spell_id not in innate_ids:
      return _spell_err("That is not one of your innate gifts.", 'not_castable')
  ```
- **Additive:** a squirrel keeps its biome innate *and* gains Acorn Fury — the only
  race with two always-castable innates. Non-squirrels are unaffected
  (`SPECIES_SPELLS.get(...)` → `None`).

### Buff stacking (intended)

A garden-hatched squirrel has both Rot Surge (+3 ATK) and Acorn Fury (+2 ATK).
They are different `buffKind`s, so casting both stacks to **+5 ATK** for one fight
(two separate cooldowns). This is intended, not a bug — it costs two casts and two
cooldowns, and rewards the caster identity. No stacking cap.

## Client

- **One combined "Innate" group.** The Creature tab Grimoire card currently pins
  the single biome innate on top; for squirrels it lists **both** innate spells
  together under one *Innate* heading (biome spell + Acorn Fury), each with its own
  live cooldown label. Both remain castable.
- **Board cast picker:** the innate `source` offers every spell the creature can
  cast innately — for a squirrel that's the biome spell *and* Acorn Fury.
- **Mirror generation:** `sync_spells.py` emits a `SPECIES_SPELLS` map next to
  `BIOME_SPELLS`; regenerate `spells.generated.ts`. `spells.ts` re-exports it and
  any helper that resolves "innate spells for this creature" reads both maps.

## Where the code changes land

Server (`infrastructure/lambda/`):
- `undercity_data.py` — `SPELLS['acorn_fury']` (with client `icon` + `desc`);
  new `SPECIES_SPELLS` map.
- `undercity_engine.py` — one `elif` in `effective_stats` for `acorn_fury` (+2 ATK,
  × the buff `mult`).
- `undercity_db.py` — OR-branch in the `source == 'innate'` check; add
  `acorn_fury` to `ONE_BATTLE_BUFFS`.
- `sync_spells.py` — render `SPECIES_SPELLS` into the generated client mirror.

Client (`src/app/undercity/`):
- `data/spells.generated.ts` — regenerated (do not hand-edit).
- `data/spells.ts` — export `SPECIES_SPELLS`; a helper returning the innate spell
  ids for a creature (biome + species).
- `tabs/creature-tab.component.*` — combined Innate group.
- `tabs/board-tab.component.*` — innate source lists all innate spells.

## Tests

`infrastructure/lambda/tests/test_undercity_spells.py`:
- A squirrel can cast `acorn_fury` as `source: 'innate'` and gains +2 ATK
  (`effective_stats`); a non-squirrel cannot (`not_castable`).
- A squirrel can still cast its **biome** innate (additive slot didn't break it).
- `acorn_fury` is consumed after one battle (`ONE_BATTLE_BUFFS`).
- Squirrel Warrior doubling: `acorn_fury` yields +4 ATK.
- Data-integrity + `test_spells_generated.py` (regenerated mirror) stay green.

Then `cd infrastructure/lambda && python -m pytest tests -q` and `npm run build`
both green. Backend changes need a `cdk deploy` before the live client uses them
(user runs deploys).

## Out of scope

- No new buff *resource* or in-combat casting.
- No stacking cap between biome and species ATK buffs (the +5 stack is intended).
- No dedicated icon art beyond picking an existing Material icon for Acorn Fury.
