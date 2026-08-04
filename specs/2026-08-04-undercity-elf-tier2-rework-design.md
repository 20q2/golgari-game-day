# Undercity: Elf Line Tier-2 Rework — Gorgon + Wood Lurker

**Date:** 2026-08-04
**Status:** Approved, ready for implementation plan

## Goal

Rework the Elf line's two tier-2 forms so they read as two distinct fantasies and
play as two distinct archetypes:

1. **Gorgon** — the read→petrify→freeze **controller** (kept, just renamed +
   re-sprited). This is the tier-2 the player likes.
2. **Wood Lurker** — a new **shapeshifter mimic** that *becomes what it fights*,
   replacing the old Basalt Matron / Shatter bruiser (whose Brittle mechanic never
   escaped "another damage snowball").

Builds on the Elf species + abilities already implemented
([2026-08-04-undercity-gorgon-species-design.md](2026-08-04-undercity-gorgon-species-design.md),
[2026-08-04-undercity-gorgon-abilities-design.md](2026-08-04-undercity-gorgon-abilities-design.md)).
Combat model: [undercity-combat.md](undercity-combat.md).

## Design decisions (from brainstorming)

1. **Mimic identity:** "becomes what it fights" — it *adapts to* the foe (not
   *deceives* it; the engine's reads are player→enemy, so there's no AI to bluff).
2. **What it copies:** the foe's **nature** (fighting style), not its ability —
   because most wilds have no passive to steal, while every enemy has a
   `personality`. Consistent, bounded, readable.
3. **Buff size:** the gentler **+3 to the mirrored stat / +1 all-round** vs a
   balanced foe — a shape-shift toward the right build, not a raw power spike.
4. **Statline:** a **pure survivor** (`{maxHp: 6}`) blank slate — it endures and
   lets the mirrored buff define its offense/defense each fight.
5. **Scope:** rename the petrifier to **Gorgon**, remove the **Shatter/Brittle**
   system entirely, and **rename the form ids** (not just display names) to match.

## Part 1 — Gorgon (rename of `medusa_stalker`)

Pure rename + re-sprite; the mechanic (`stone_gaze` → Petrify) is untouched.

- **Form id:** `medusa_stalker` → **`gorgon`** (tier-2 form id; distinct from the
  tier-1 species id `elf`).
- **Display name:** `Medusa Stalker` → **`Gorgon`**.
- **Sprite:** → `'gorgon'` (the player-added `public/undercity/player_sprites/gorgon.{png,mask.png}`;
  a `gorgon.hat.png` is present too).
- **Cascade:** update the `APEX` `from` lists that reference `medusa_stalker`
  (`swamp_dragon`, `izoni`) in both backend `undercity_data.py` and client
  `forms.ts`; the `FORM_SPRITES` key in `species.ts`; and the
  `tier2_options('elf')` test assertion.

## Part 2 — Wood Lurker (replaces `basalt_matron`)

- **Form id:** `basalt_matron` → **`wood_lurker`** (line `elf`, tier 2).
- **Display name:** **`Wood Lurker`**.
- **Bonus:** `{maxHp: 6}` (was `{atk: 2, maxHp: 4}`).
- **Passive:** `shatter` → **`mimicry`** (new).
- **Sprite:** placeholder for now (no `wood_lurker` art yet) — reuse the `'elf'`
  sprite key until dedicated art lands, per the GDD placeholder approach.
- **Cascade:** update the `APEX` `from` lists that reference `basalt_matron`
  (`grave_titan`, `golgari_lich_lord`) in backend + client; the `FORM_SPRITES`
  key; blurbs; and the `tier2_options('elf')` test (now `{'gorgon', 'wood_lurker'}`).

### Mimicry — the mechanic

At **battle start**, if the player has the `mimicry` passive, read the enemy's
`personality` and grant a **one-battle buff** matching it:

| Enemy `personality` | Mimic buff |
|---|---|
| `brute` | +`MIMIC_MIRROR` ATK |
| `turtle` | +`MIMIC_MIRROR` DEF |
| `trickster` | +`MIMIC_MIRROR` SPD |
| `balanced` (or unknown) | +`MIMIC_BALANCED` ATK / DEF / SPD |

Scalars in `undercity_config.py`: **`MIMIC_MIRROR = 3`**, **`MIMIC_BALANCED = 1`**.

**Implementation shape:** reuse the Soul-Trophy variable-amount buff pattern. A
`mimic` buff entry rides its numbers on itself and lives in
`undercity_db.ONE_BATTLE_BUFFS` so it clears when the fight ends:

- For the mirrored case: `{'kind': 'mimic', 'stat': 'atk'|'def'|'spd', 'amount': MIMIC_MIRROR}`.
- For balanced, apply three small entries (one per stat at `MIMIC_BALANCED`), or a
  single entry the `effective_stats` branch expands — the plan picks the cleaner
  of the two; the observable contract is "+1 to each stat."

The buff is appended to `doc['buffs']` in `_start_battle` (where the enemy is
known) **before** the player combatant is built, so `effective_stats` folds it
into the combatant's stats and it survives a battle **resume** (it lives on the
doc, not on a mutated combatant). `effective_stats` gains a `mimic` branch
(mirrors the existing `trophy` branch). A **`mimic` status chip** is added to
`combat.ts STATUS_INFO` so the player sees what it became; `_battle_status`
already surfaces buff kinds.

**How it plays:** a durable generalist that is always at least decently matched to
its prey — the opposite of the Gorgon's fixed, slow lockdown.

## Part 3 — Remove Shatter / Brittle

The Brittle system is orphaned once no form procs it. Remove:

- **Engine (`undercity_engine.py`):** the `Combatant.brittle` field; the Brittle
  amp + Shatter proc branches in `resolve_round`.
- **DB (`undercity_db.py`):** `brittle` from `_bt_snapshot` / `_bt_to_combatant` /
  `_bt_store`; the `brittle` entries in `_battle_status`.
- **Config (`undercity_config.py`):** `BRITTLE_AMP`, `BRITTLE_MAX`.
- **Client:** the `shatter` `PASSIVE_NAMES`/`PASSIVE_BLURBS` and the `brittle`
  `STATUS_INFO` chip in `combat.ts`.
- **Tests:** the three Shatter/Brittle engine tests; the Basalt-Shatter data test.

**Keep `petrify`** and everything Gorgon — that's untouched.

## Assets

- **Elf** (tier 1) → `sprite: 'elf'` → `player_sprites/elf.{png,mask.png}` (added).
- **Gorgon** (tier 2) → `sprite: 'gorgon'` → `player_sprites/gorgon.{png,mask.png}`
  (added).
- **Wood Lurker** (tier 2) → placeholder (`'elf'` sprite key) until art lands.
- **Typo to fix:** `player_sprites/elft.hat.png` looks like it should be
  `elf.hat.png` (the elf hat overlay) — rename if so; otherwise the elf hat won't
  resolve.

## Implementation reach

**Backend (Python):**
- `undercity_data.py` — rename `TIER2` keys `medusa_stalker`→`gorgon`,
  `basalt_matron`→`wood_lurker`; update the four `APEX` `from` lists; Wood Lurker
  bonus `{maxHp: 6}` + `mimicry` passive + blurb; Gorgon display name.
- `undercity_config.py` — add `MIMIC_MIRROR`/`MIMIC_BALANCED`; remove
  `BRITTLE_AMP`/`BRITTLE_MAX`.
- `undercity_engine.py` — remove `Combatant.brittle` + the Shatter/Brittle
  `resolve_round` branches; add the `mimic` branch to `effective_stats`.
- `undercity_db.py` — `_start_battle` applies the Mimicry buff from enemy
  personality; add `mimic` to `ONE_BATTLE_BUFFS`; remove `brittle` from the three
  snapshot funcs + `_battle_status`.

**Client (TypeScript mirrors):**
- `forms.ts` — rename the two `TIER2` ids + `APEX` `from` lists; Wood Lurker
  entry (`mimicry`/`Mimicry`, `{maxHp: 6}`); Gorgon display name; add
  `PASSIVE_NAMES`/`PASSIVE_BLURBS` for `mimicry`; remove `shatter`.
- `species.ts` — `FORM_SPRITES` keys `gorgon` (sprite `'gorgon'`) and
  `wood_lurker` (placeholder); drop the old `medusa_stalker`/`basalt_matron` keys.
- `combat.ts` — add `mimic` `STATUS_INFO`; remove `brittle`.

**Tests (`infrastructure/lambda/tests/`):**
- Mimicry: vs a brute foe → +ATK buff applied at battle start; vs turtle → +DEF;
  vs trickster → +SPD; vs balanced → +1 each; the buff clears after the fight.
- Evolution: `tier2_options('elf') == {'gorgon', 'wood_lurker'}`; apex options for
  both resolve.
- Remove the Shatter/Brittle tests.
- Keep the suite green (the branch carries pre-existing failures unrelated here).

## Save compatibility

Renaming the form ids means a stored `form`/`species` of `medusa_stalker` or
`basalt_matron` would fail an `ALL_FORMS[...]` lookup. **Assumed pre-deploy** (this
line was built this session and is not confirmed live). If it *is* live with
players who evolved into those forms, add a backward-compat alias
(`medusa_stalker → gorgon`, `basalt_matron → wood_lurker`) the way the
Spore→Zombie rename did — call it out during planning if the deploy state is
uncertain.

## Phasing (for the implementation plan)

- **Phase 1 — Mimicry + Wood Lurker:** the new mechanic, the form (id + bonus +
  passive + placeholder sprite), config, chip, tests.
- **Phase 2 — Gorgon rename + sprite:** rename `medusa_stalker`→`gorgon`, wire the
  new sprite, update apex/tests.
- **Phase 3 — Remove Shatter/Brittle:** tear out the orphaned system + its tests.

Each phase is independently shippable; ordering them Mimicry-first means the line
always has two working tier-2 forms.

## Non-goals

- No visual "shapeshift into the enemy sprite" (the Lurker keeps its own art; a
  future stretch).
- No copying enemy passives/abilities (nature-mirror only).
- No change to the Gorgon's Petrify mechanic or the Elf's Stonewright / wildcard
  slot.
- No new Wood Lurker art (placeholder until provided).

## Open questions (resolve during planning)

- Balanced-foe buff as one expanding entry vs three small entries (impl detail;
  contract is +1 each).
- Whether the Wood Lurker keeps Basalt's apex options (`grave_titan`,
  `golgari_lich_lord`) or is re-pointed — default: **keep** them (an endurance
  mimic fits the HP/DEF titan and the ATK/HP sovereign fine).
