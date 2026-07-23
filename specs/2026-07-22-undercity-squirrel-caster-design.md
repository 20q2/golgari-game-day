# The Undercity — Squirrel Caster Race (design)

**Status:** approved design, pending implementation plan.
**Date:** 2026-07-22.

Adds a fifth playable race — the **Squirrel**, a *caster* archetype built around a
new **Acorn Stash** resource. Ships a T1 starter, two T2 evolutions, and one new
T3 apex. No existing race, form, or balance number changes.

## 1. Why

The four existing races map to combat archetypes (Balanced / Glass Cannon /
Horde / Tank) and all their passives live in `engine.resolve_round`. None of them
engage the spell system, which is a whole second subsystem
([undercity-spells.md](undercity-spells.md)). The squirrel opens a genuinely new
axis — a race whose identity is *how it casts*, not how it swings — without
touching the combat balance the existing races are tuned around.

The fantasy is a hoarder of magic: it stashes "acorns" and spends them to cast
faster than cooldowns should allow.

## 2. The Acorn Stash (core mechanic)

A shared, per-creature charge pool. It exists only for creatures carrying the
`stockpile` passive (i.e. the squirrel line).

- **Field:** `acorns` (int) on the player doc. Defaults to `0` for every other
  race; the stash logic is gated on `stockpile` being present, so a non-squirrel
  never gains or spends acorns.
- **Cap:** base **3**. Raised to **5** by the Hoarder T2 and the Archmage T3.
- **Regen:** **+1 acorn per board roll** (`_roll`), clamped to cap. Ties the
  stash to active play. Idle time does not refill it (unlike spell cooldowns).
- **Starting acorns:** hatch with **1** (tunable).
- **Spend:** casting normally starts the spell's cooldown as today. When a spell
  is **still on cooldown**, a stash-holder may instead **spend 1 acorn** to cast
  it anyway; the cooldown is then refreshed. This is the *only* thing acorns do —
  they bypass cooldown so the squirrel can chain casts back-to-back.
- Acorns never bypass any other validation (range, dodge, shield, spells-never-
  kill). They only substitute for a ready cooldown.

### Derived stash config

A small pure helper (engine-side) reads the passive set and returns the stash
parameters, so stacked passives compose cleanly:

| Derived value | Rule |
|---|---|
| `has_stash` | `'stockpile' in passives` |
| `cap` | `5` if `acorn_hoarder` or `acorn_archmage` present, else `3` |
| `overflow_chance` | `0.35` if `acorn_archmage` present, else `0.0` |
| `spend_buff` | `True` if `acorn_warlock` present |

Because a creature evolves down exactly one T2 path and then into the single
squirrel apex, the reachable combinations are only: `{stockpile}`,
`{stockpile, acorn_hoarder}`, `{stockpile, acorn_warlock}`,
`{stockpile, acorn_hoarder, acorn_archmage}`,
`{stockpile, acorn_warlock, acorn_archmage}`.

## 3. Forms

### T1 — Squirrel (starter)

```
id: squirrel   name: 'Squirrel'   hp: 25  atk: 4  def: 4  spd: 7
passive: stockpile
```

Highest SPD in the game, lowest ATK/DEF — fragile in melee, but SPD also raises
spell-dodge (`spell_dodge_chance`) and combat reads, so its own defense is
"don't get hit." Archetype label: **Caster**.

Blurb: *"A twitchy hoarder of magic. Acorn Stash: bank up to 3 acorns (+1 each
turn); spend one to recast a spell that's still on cooldown."*

### T2 — two branches (level 5)

```
id: acorn_hoarder   name: 'Acorn Hoarder'   line: squirrel
bonus: {maxHp: 4, spd: 2}   passive: acorn_hoarder
  Bigger Stash: acorn cap rises to 5.

id: acorn_warlock   name: 'Acorn Warlock'   line: squirrel
bonus: {atk: 2, spd: 2}     passive: acorn_warlock
  Charged Cast: spending an acorn also grants +2 ATK for your next battle.
```

- **Hoarder** = the pure caster/economy direction (deeper stash → longer chains).
- **Warlock** = the battle-caster (each acorn spent buffs the next fight).

The Warlock buff is a new one-battle buff kind `acorn_charge` (+2 ATK), applied
in `_cast` only on the acorn-spend path, consumed like the other
`ONE_BATTLE_BUFFS` after any fight.

### T3 — Archmage (new apex, level 10)

```
id: acorn_archmage   name: 'Acorn Archmage'
bonus: {spd: 2, maxHp: 6}   passive: acorn_archmage
from: [acorn_hoarder, acorn_warlock]
  Overflow: acorn cap 5, and a spent acorn has a 35% chance not to be consumed.
```

- Reachable from **both** squirrel T2s; **squirrel-exclusive** (the capstone
  assumes a stash — it is NOT added to any existing form's evolution options,
  and no other line can reach it).
- A Warlock → Archmage keeps `acorn_warlock` (spend-buff) *and* gains overflow;
  a Hoarder → Archmage just gets the deeper stash + overflow. Both are valid by
  the config table above.
- **Open point for review:** this makes Archmage the squirrel's *only* T3 option
  (single-choice evolution), unlike other lines which choose between two apexes.
  Acceptable per the "a new T3" ask; noted here in case the user wants the
  squirrel T2s to *also* reach an existing SPD apex (e.g. Swamp Dragon) for a
  real branch.

## 4. Where the code changes land

Server is the source of truth; the client mirrors it for display (per CLAUDE.md).

### Backend (`infrastructure/lambda/`)

| Concern | File / symbol |
|---|---|
| Form tables | `undercity_data.py` — add `squirrel` to `STARTERS`; `acorn_hoarder` + `acorn_warlock` to `TIER2` (`line: 'squirrel'`); `acorn_archmage` to `APEX` |
| Stash config helper | `undercity_engine.py` — new pure `acorn_config(passives)` (cap / overflow / spend_buff / has_stash) |
| Warlock buff | `undercity_engine.effective_stats` (+ATK for `acorn_charge`) and `undercity_db.ONE_BATTLE_BUFFS` |
| Regen | `undercity_db._roll` — if `has_stash`, `acorns = min(cap, acorns+1)` |
| Spend / bypass | `undercity_db._cast` — when `_spell_cd_ready` is False, allow an acorn spend (respecting overflow + applying `acorn_charge` for Warlock) instead of the `spell_on_cooldown` error |
| New-doc field | `undercity_db._new_player_doc` — seed `acorns` (1 for squirrels, else 0) |
| Join validation | `undercity_db._join` — update the "Pick a starter" error string to include squirrel (validation is already `starter not in STARTERS`, so it works once the table entry exists) |
| State surface | expose `acorns` + derived `acornCap` on the player's own `you` doc (like `perks`) so the client can render the stash |
| Tunables | scalar knobs (`ACORN_CAP_BASE`, `ACORN_CAP_DEEP`, `ACORN_REGEN_PER_ROLL`, `ACORN_START`, `ACORN_OVERFLOW_CHANCE`, `ACORN_WARLOCK_ATK`) go in `undercity_config.py` |
| Tests | `tests/` — starter/evo shape tests already sweep `ALL_FORMS`; add stash-behavior tests (regen on roll, cooldown-bypass spend, cap by passive, overflow no-consume via seeded RNG, Warlock buff applied and consumed). Keep the whole suite green. |

### Client (`src/app/undercity/`)

| Concern | File |
|---|---|
| Form mirror | `data/forms.ts` — mirror the three new forms into `STARTERS`/`TIER2`/`APEX`; add `stockpile`/`acorn_hoarder`/`acorn_warlock`/`acorn_archmage` to `PASSIVE_NAMES` + `PASSIVE_BLURBS` |
| Sprites | `data/species.ts` — `squirrel` → `squirrel` sprite (PLAYER_REGIONS; has `.hat`/`.mask`); `acorn_hoarder` → `squirrel_mage`, `acorn_warlock` → `squirrel_general` (both `regions: []`); `acorn_archmage` → `squirrel_mage` as placeholder until dedicated apex art exists |
| Hatch UI | `hatch/hatch-flow.component.ts` — add `squirrel: 'Caster'` to `ARCHETYPES`; SPD 7 fits the existing `STAT_MAX.spd = 8` bars |
| Stash display | `tabs/board-tab.component.*` (cast flow) + `tabs/creature-tab.component.*` (Grimoire card) — show current acorns / cap; when a spell is on cooldown and acorns > 0, offer "spend acorn to cast" instead of a disabled button |
| Types | `services/undercity-models.ts` — add `acorns` / `acornCap` to `YouDoc` |

Sprite assets already present: `squirrel.png` (+`.hat`/`.mask`), `squirrel_general.png`,
`squirrel_mage.png`. No new art needed for T1/T2; the T3 reuses `squirrel_mage`
until dedicated apex art is drawn. (`pest_2`/`saproling_2` assets in the tree are
unrelated to this feature.)

## 5. Invariants preserved

- **Spells never kill.** Acorns only bypass a cooldown; every damage/heal path
  keeps its existing floor. No new damage source.
- **Loadouts are fixed bundles.** The stash changes *when* you cast, never *what*
  — no custom spell composition is introduced.
- **Cooldowns only start on a successful cast.** The acorn-spend path still runs
  all validation (range/dodge/shield) before spending and before refreshing the
  cooldown; a rejected cast spends no acorn.
- **Combat balance untouched.** The squirrel's only combat footprint is its stat
  line and the optional Warlock +2 ATK one-battle buff (same magnitude family as
  Rot Surge). No `resolve_round` branch is added for the T1/T3 passives.
- **Server ↔ client mirror.** Every number added to `undercity_data.py` /
  `undercity_config.py` is mirrored in `data/forms.ts` for display.

## 6. Out of scope

- No new innate spell (innate comes from home biome, not species — the squirrel
  works with any biome).
- No new grimoires, spaces, or enemies.
- Revenge buffs / achievements / seal hats stay stubbed as elsewhere.
- Dedicated T3 apex art (placeholder reuse for now).
