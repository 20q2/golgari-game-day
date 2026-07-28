# Undercity — Shambling Shell heal + Deathrite Shaman trophy

**Date:** 2026-07-26
**Status:** Design (approved for planning)

Two form-ability changes to the zombie line:

1. **Shambling Shell** learns **Mend Flesh** as an innate spell, kept through its apexes.
2. **Deathrite Shaman**'s `soul_harvest` passive is **replaced** by **Soul Trophy**: after any won fight, choose ATK / DEF / SPD and gain a bonus to it equal to the defeated foe's level, lasting one battle.

Source of truth is the Python engine (`infrastructure/lambda/undercity_data.py`, `undercity_db.py`, `undercity_engine.py`); the Angular `src/app/undercity/data/*.ts` files are display mirrors that must be kept in sync.

---

## Part 1 — Shambling Shell learns Mend Flesh

### Rules
- `mend_flesh` already exists (`SPELLS['mend_flesh']`: tier-1 buff, `self_heal` power 12, 20-min cooldown). No new spell is authored.
- Shambling Shell gains it as an **innate gift** (always castable, no grimoire needed), cast via `source: 'innate'` like biome/species innates.
- It **persists into apex**. Shambling Shell evolves into Grave Titan or Golgari Lich Lord; those keep Mend Flesh.

### Mechanism — gate on the form passive
Passives accumulate through evolution: `_evolve` does `doc.setdefault('passives', []).append(spec['passive'])`, and the starter/line passive is seeded at creature creation. Shambling Shell's form passive `rootwall` is unique to it, so:

- A creature that is now (or was ever) a Shambling Shell has `rootwall` in `doc['passives']`.
- Gating the Mend Flesh grant on `'rootwall' in passives` gives free apex-persistence **and** retroactively covers every existing live Shambling Shell — no data migration.

### Server changes
- **`undercity_data.py`**: add
  ```python
  # Form passive -> extra innate spell it grants (persists via accumulated
  # passives, so the form's apexes keep it). Mirror: innateSpellIds() in spells.ts.
  FORM_SPELLS = {'rootwall': 'mend_flesh'}
  ```
- **`undercity_db.py`**: add a helper that returns all innate spell ids for a doc:
  ```python
  def _innate_spell_ids(doc):
      ids = {data.BIOME_SPELLS.get(doc.get('homeBiome')),
             data.SPECIES_SPELLS.get(doc.get('species'))}
      for p in _passives(doc):
          if p in data.FORM_SPELLS:
              ids.add(data.FORM_SPELLS[p])
      ids.discard(None)
      return ids
  ```
  Use it in `_cast` where `source == 'innate'` (currently `undercity_db.py:4357-4361`, which hard-codes the biome+species set) so Mend Flesh counts as innate for Shambling Shell / its apexes. If player state surfaces a castable-innate list to the client, build it from the same helper.

### Client changes
- **`src/app/undercity/data/spells.ts`**: extend the helper to accept passives:
  ```ts
  export function innateSpellIds(
    homeBiome: string | undefined,
    species: string | undefined,
    passives: string[] = [],
  ): string[] { … append FORM_SPELLS[p] for p in passives … }
  ```
  Add a `FORM_SPELLS` const mirroring the Python map (in `spells.ts`, not the generated file — it is not part of the sync payload; document the mirror).
- **`creature-tab.component.ts:431`**: pass `you.passives` into `innateSpellIds(...)`. Confirm `you.passives` is present on the state payload; if not, add it to the `you` serialization.

---

## Part 2 — Deathrite Shaman "Soul Trophy" (replaces Soul Harvest)

### Rules
- The `soul_harvest` form passive (+50% Spores from wild/elite wins) is **removed** from Deathrite Shaman and replaced by `soul_trophy`.
- **Soul Trophy:** after **any won fight** (`outcome == 'attacker'`, all kinds — wild, elite, barrier, lair, world, boss), the player is offered a menu to choose **ATK, DEF, or SPD**. They gain **+[defeated foe's level]** to that stat **for their next battle only**. Uncapped.
- Foe level = the `Lv. N` already computed for the battle UI (`data.enemy_level(atk, def, spd, maxHp)`, already stamped on the battle snapshot).
- **Boss note:** Savra uses a shared persistent HP pool, so a "win" there means landing the killing blow; the trophy fires only on that. Acceptable and rare.

### Buff model — reuse the one-battle-buff rail, add a variable amount
Existing "next battle" buffs (`savage_roar` +5 ATK, etc.) are stored as `{'kind': <name>}` in `doc['buffs']`, resolved to fixed stat deltas in `engine.effective_stats`, and cleared by `_consume_one_battle_buffs` (`ONE_BATTLE_BUFFS`). Soul Trophy is the first buff whose magnitude is dynamic, so its buff entry carries explicit fields:

```python
{'kind': 'trophy', 'stat': 'atk'|'def'|'spd', 'amount': N}
```

- **`engine.effective_stats`**: handle `kind == 'trophy'`: `eff[buff['stat']] += buff['amount']`. (No `mult` — it is not a self-cast spell buff, so Squirrel Warrior's doubling does not apply.)
- **`undercity_db.py ONE_BATTLE_BUFFS`**: add `'trophy'` so it is consumed after the next fight.

### Flow (server-authoritative)
1. **On win** — in `_finish_battle`, after the per-kind finisher, if `result['outcome'] == 'attacker'` and `'soul_trophy' in _passives(doc)`:
   - `doc['pendingTrophy'] = {'amount': <foe level>}`
   - `spaceEvent['trophy'] = {'amount': N}` so the client shows the menu.
   - A later win overwrites an unclaimed `pendingTrophy` (only the latest kill matters).
2. **New action `trophy-choose {stat}`** (registered in the action dispatcher):
   - Reject if no `pendingTrophy` or `stat` not in `{atk, def, spd}`.
   - Append `{'kind': 'trophy', 'stat': stat, 'amount': pendingTrophy['amount']}` to `doc['buffs']`; clear `pendingTrophy`.
   - The menu is dismissable — not choosing forfeits the trophy (it stays pending until claimed or overwritten by the next win).
3. **Consumption** — the buff applies to the next battle via `effective_stats`, then `_consume_one_battle_buffs` clears it. Because you must fight (and thus consume) to earn the next trophy, at most one `trophy` buff is ever live.

### Client changes
- Battle-result handler: when `spaceEvent.trophy` is present, show a 3-button modal (ATK / DEF / SPD, each showing `+N`); on pick, POST `trophy-choose {stat}`. Dismiss = forfeit.
- Render an active `trophy` buff in the existing buff/status list, e.g. "Soul Trophy: +N ATK".

---

## Mirrors, docs & tests

### Display mirrors
- **`src/app/undercity/data/forms.ts`**:
  - `deathrite_shaman`: `passive: 'soul_trophy'`, `passiveName: 'Soul Trophy'`.
  - Remove the `soul_harvest` entries from `PASSIVE_NAMES` / `PASSIVE_BLURBS`; add `soul_trophy: 'Soul Trophy'` and a blurb ("After any won fight, choose a stat and gain +[foe level] to it for your next battle.").
  - Optionally note Shambling Shell's Mend Flesh in its blurb.
- **`src/app/undercity/data/spells.ts`**: add the `FORM_SPELLS` mirror + extended `innateSpellIds`.

### Docs
- **`specs/undercity-spells.md`**: document form-passive innate grants (`FORM_SPELLS`) and add Mend Flesh to Shambling Shell's entry.
- **`specs/undercity-combat.md`**: document the `trophy` buff kind and the `trophy-choose` action / post-win flow.
- **`UNDERCITY_EVOLUTION.html`**: update the Deathrite Shaman card (Soul Trophy) and Shambling Shell card (learns Mend Flesh). Regenerate via the `scratchpad/gen_bestiary.py` generator's data tables.

### Tests (`infrastructure/lambda/tests`, in-memory FakeTable suite — keep green)
- Shambling Shell can cast `mend_flesh` from `source: 'innate'`; a Grave Titan / Golgari Lich Lord evolved from Shambling Shell can too; an unrelated form cannot.
- Deathrite Shaman: winning a fight sets `pendingTrophy` with amount == foe level and surfaces `spaceEvent.trophy`.
- `trophy-choose` appends the buff and clears `pendingTrophy`; rejects when no pending trophy or bad stat.
- The trophy buff changes `effective_stats` by exactly `amount` on the chosen stat, and is gone after the next fight (in `ONE_BATTLE_BUFFS`).
- A second win overwrites an unclaimed `pendingTrophy`.
- Update/replace any existing assertion that Deathrite Shaman grants `soul_harvest` (+50% Spores).

## Naming note
`soul_trophy` / "Soul Trophy" is the working name for the new passive; adjust flavor freely during implementation without changing the mechanic.

## Out of scope
- No cap on the trophy bonus.
- No new sprite/art work.
- Soul Harvest's +50% Spore economy is retired, not relocated to another form.
