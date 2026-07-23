# The Undercity — Squirrel Caster Race (design)

**Status:** ⚠️ SUPERSEDED (2026-07-23) by
[2026-07-23-undercity-squirrel-simple-design.md](2026-07-23-undercity-squirrel-simple-design.md).
The spell **level-scaling** (§2.5 pillar 1) shipped and is kept; the **Acorn
Stash** and **in-combat casting** here are dropped in favor of the simpler
multiplier-based squirrel. Retained for history.
**Date:** 2026-07-22.

Adds a fifth playable race — the **Squirrel**, a *caster* archetype built around a
new **Acorn Stash** resource. Ships a T1 starter, two T2 evolutions, and one new
T3 apex. It also carries a **magic-system revamp** (§2.5) that makes casting
viable and fun for a dedicated caster: spell power now **scales with level**, and
the squirrel can **cast during combat** by spending acorns. The revamp touches
existing spell numbers (scaling is universal) but no existing *form* or combat
balance number.

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
- **Spend — two uses:**
  1. *On the board:* casting normally starts the spell's cooldown as today; when
     a spell is **still on cooldown**, a stash-holder may instead **spend 1
     acorn** to cast it anyway (cooldown then refreshed), chaining casts
     back-to-back.
  2. *In combat:* spend 1 acorn to cast a spell as an add-on to a stance (see
     §2.5 pillar 2). This is the tactical payoff — the stash becomes the caster's
     in-fight resource.
- Board acorn-spends never bypass any other validation (range, dodge, shield,
  and the board never-kill floor). They only substitute for a ready cooldown.

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

## 2.5 Magic-system revamp

Two pillars make casting a real playstyle instead of an occasional board-side
chip. Pillar 1 is universal; pillar 2 is the squirrel's signature (gated by the
acorn resource, so it needs no per-race whitelist).

### Pillar 1 — spells scale with level (universal)

Every spell that carries a `power` field (damage, heal, boss-strike) resolves at
**`base + SPELL_POWER_PER_LEVEL × level`** instead of a flat number. So a
level-1 Scrap Toss lands for its printed 8, but a level-10 caster's lands for
~18; magic keeps pace with growing HP pools instead of falling off.

- Applies everywhere a `power` spell resolves: board `field_damage`,
  `self_heal`, `boss_strike`, **and** in-combat casts (§2.5 pillar 2).
- **Does not** touch `self_buff` / `field_curse` magnitudes — those are flat
  stat shifts (e.g. Harden Shell +2 DEF) and stay flat; scaling them would
  double-dip with the stat system.
- One pure helper (e.g. `engine.spell_power(spell, doc)`) centralizes the math so
  every resolution path and the client mirror agree.
- `SPELL_POWER_PER_LEVEL` lives in `undercity_config.py` (tunable; start ~1.0).
- **Never-kill floor is unchanged for board casting** — scaled board/field/boss
  damage still floors targets at 1 HP.

### Pillar 2 — cast during combat (squirrel-only, acorn-fueled)

Inside the interactive PvE stance-triangle fight, a stash-holder may, **once per
round, spend 1 acorn to cast a castable spell as an add-on to their stance**. The
spell resolves, then the normal stance exchange happens.

- **Castable in combat:** the same loadout (innate + open grimoire), restricted
  to effects that make sense in a fight:
  - `field_damage` → damage the enemy combatant (scaled by level).
  - `self_heal` → heal yourself (scaled, capped at max HP).
  - `self_buff` → apply the one-battle buff **immediately, to the current fight**
    (not "next battle").
  - `field_curse` → apply the debuff to the enemy combatant for this fight.
  - `teleport` / `recall` / `fate_die` / `boss_strike` → **rejected in combat**
    (no meaning inside a fight).
- **Cost is the acorn only.** In-combat casting **ignores the spell's real-time
  cooldown and does not start one** — otherwise you couldn't chain the same spell
  across rounds, which would gut the stockpile fantasy. The acorn cap (3–5) is
  the per-fight limiter (~3–5 casts, fewer than a fight's ~6 rounds).
- **In-combat damage CAN land the killing blow.** You are present — an in-person
  kill — so spell damage feeds the real battle HP and the existing combat death
  logic resolves it normally. This is a deliberate, scoped exception to the
  "spells never kill" invariant: it applies **only** to in-combat casting, never
  to remote board/field/boss casting.
- **Synergies fall out for free:** Overflow (Archmage) rolls its 35% no-consume
  on the in-combat spend too; Warlock's `acorn_charge` (+2 ATK) fires on any
  acorn spend, so an in-combat cast also buffs your swing that fight.
- **Non-squirrels never cast in combat** — they have no acorns.
- **PvE only.** Interactive combat is PvE; PvP stays the one-shot auto-resolver,
  untouched.

### Combat-cast action shape

Extend the existing `combat-round` submission with an optional cast rather than
adding a new action, so casting stays bundled to the round it modifies (mirrors
how a combat consumable already rides on a stance):

```
{type: 'combat-round', payload: {stance, item?, castSpellId?, castSource?}}
```

The engine resolves the optional cast first (spend acorn → apply spell to
combatants → check for a resulting death), then runs the stance exchange if the
fight is still live. Rejections (no acorn, spell not castable in combat, spell
not in loadout) return before any state change, exactly like the current cast
validation.

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
| Spend / bypass (board) | `undercity_db._cast` — when `_spell_cd_ready` is False, allow an acorn spend (respecting overflow + applying `acorn_charge` for Warlock) instead of the `spell_on_cooldown` error |
| Spell scaling (pillar 1) | `undercity_engine.spell_power(spell, doc)` — new pure `base + SPELL_POWER_PER_LEVEL × level`; call it from every `power` resolution (`_cast` field_damage/self_heal/boss_strike) |
| In-combat cast (pillar 2) | `undercity_db._combat_round` — resolve an optional `castSpellId`/`castSource`: validate castable-in-combat, spend acorn (overflow/Warlock), apply spell to the battle `Combatant`s, check death, then run the exchange. Damage can kill. A small shared `_cast_in_combat` helper keeps it beside `_cast` |
| Combat-cast contract | extend `combat-round` payload with `castSpellId`/`castSource` (both optional; absent = today's behavior) |
| New-doc field | `undercity_db._new_player_doc` — seed `acorns` (1 for squirrels, else 0) |
| Join validation | `undercity_db._join` — update the "Pick a starter" error string to include squirrel (validation is already `starter not in STARTERS`, so it works once the table entry exists) |
| State surface | expose `acorns` + derived `acornCap` on the player's own `you` doc (like `perks`) so the client can render the stash |
| Tunables | scalar knobs (`ACORN_CAP_BASE`, `ACORN_CAP_DEEP`, `ACORN_REGEN_PER_ROLL`, `ACORN_START`, `ACORN_OVERFLOW_CHANCE`, `ACORN_WARLOCK_ATK`, `SPELL_POWER_PER_LEVEL`) go in `undercity_config.py` |
| Spell reference | `specs/undercity-spells.md` — document level scaling, in-combat casting, and the scoped never-kill exception |
| Tests | `tests/` — starter/evo shape tests already sweep `ALL_FORMS`; add stash-behavior tests (regen on roll, cooldown-bypass spend, cap by passive, overflow no-consume via seeded RNG, Warlock buff applied and consumed), scaling tests (power grows with level; buffs stay flat), and in-combat cast tests (damage feeds battle HP and can kill; heal/buff/curse apply this fight; traversal/boss rejected; acorn-gated; no acorn → normal round). Keep the whole suite green. |

### Client (`src/app/undercity/`)

| Concern | File |
|---|---|
| Form mirror | `data/forms.ts` — mirror the three new forms into `STARTERS`/`TIER2`/`APEX`; add `stockpile`/`acorn_hoarder`/`acorn_warlock`/`acorn_archmage` to `PASSIVE_NAMES` + `PASSIVE_BLURBS` |
| Sprites | `data/species.ts` — `squirrel` → `squirrel` sprite (PLAYER_REGIONS; has `.hat`/`.mask`); `acorn_hoarder` → `squirrel_mage`, `acorn_warlock` → `squirrel_general` (both `regions: []`); `acorn_archmage` → `squirrel_mage` as placeholder until dedicated apex art exists |
| Hatch UI | `hatch/hatch-flow.component.ts` — add `squirrel: 'Caster'` to `ARCHETYPES`; SPD 7 fits the existing `STAT_MAX.spd = 8` bars |
| Stash display | `tabs/board-tab.component.*` (cast flow) + `tabs/creature-tab.component.*` (Grimoire card) — show current acorns / cap; when a spell is on cooldown and acorns > 0, offer "spend acorn to cast" instead of a disabled button |
| Combat cast UI | `tabs/board-tab.component.*` (combat-round flow) — when in a battle with acorns > 0, offer a cast option (castable-in-combat spells only) alongside stance selection; send `castSpellId`/`castSource` on `combat-round` |
| Spell scaling mirror | `data/spells.ts` — mirror `spellPower(base, level)` so tooltips/pickers show the scaled number, not the flat base |
| Types | `services/undercity-models.ts` — add `acorns` / `acornCap` to `YouDoc` |

Sprite assets already present: `squirrel.png` (+`.hat`/`.mask`), `squirrel_general.png`,
`squirrel_mage.png`. No new art needed for T1/T2; the T3 reuses `squirrel_mage`
until dedicated apex art is drawn. (`pest_2`/`saproling_2` assets in the tree are
unrelated to this feature.)

## 5. Invariants — preserved, and the one scoped change

- **Spells never kill — on the board.** Remote board/field/boss casting keeps
  its 1-HP floor (players, Savra, lairs). You still can't snipe a rival or a boss
  pool to death from across the map. Board acorn-spends only bypass a cooldown.
- **The one deliberate exception: in-combat casting can kill.** Inside an
  interactive PvE fight you are *present*, so a spell landing the killing blow is
  an in-person kill, consistent with the rule's spirit ("killing blows must be
  landed in person"). This is scoped strictly to in-combat casts; the spell
  reference doc is updated to say so.
- **Loadouts are fixed bundles.** Neither pillar lets you compose custom spell
  sets — the stash changes *when* you cast and combat-casting changes *where*,
  never *what*.
- **Cooldowns only start on a successful cast** (board). The board acorn-spend
  path still runs all validation (range/dodge/shield) before spending and before
  refreshing the cooldown; a rejected cast spends no acorn. In-combat casts are
  cooldown-independent by design (§2.5).
- **Combat balance for existing races untouched.** Only squirrels can cast in
  combat (acorn-gated), and level scaling raises every race's board spells
  equally. No `resolve_round` branch is added for the T1/T3 passives; the only
  new combat buff is the Warlock +2 ATK (same magnitude family as Rot Surge).
- **Server ↔ client mirror.** Every number added to `undercity_data.py` /
  `undercity_config.py` is mirrored in `data/forms.ts` / `data/spells.ts` for
  display, including the scaling formula.

## 6. Out of scope

- No new innate spell (innate comes from home biome, not species — the squirrel
  works with any biome).
- No new grimoires, spaces, or enemies.
- **Deferred revamp axes** (considered, not in this pass): broad cooldown
  reduction / "cast more often" tuning, and species-granted magic (extra book
  slot / signature spell). The two chosen pillars — level scaling and in-combat
  casting — are what make the caster viable; the others can layer on later.
- Revenge buffs / achievements / seal hats stay stubbed as elsewhere.
- Dedicated T3 apex art (placeholder reuse for now).
