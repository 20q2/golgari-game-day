# Undercity: New Species — Gorgon, "The Stonewright"

**Date:** 2026-08-04
**Status:** Approved, ready for implementation plan

## Goal

Add a sixth starter species, the **Gorgon** — an *economy / returning-player*
species. She starts strong and grows slowly in the flesh, but **out-crafts
everyone into the endgame**: her hands mint masterwork "**Gear+**" that the whole
server can buy.

Fantasy: an ancient, stone-scaled matron. Born powerful and all but unchanging —
flesh-turned-stone doesn't grow — so her progression lives in her **works** (gear,
pets), not her body. Her petrifying touch *hardens* what she forges.

This is a full new species in the mold of Pest/Zombie/etc. (base stats, a passive,
a tier-2/3 evolution line), plus two new mechanics that no existing species has:
a **species-keyed leveling rate** and **Gear+ minting**.

## Identity & role

| Field | Value |
|---|---|
| id | `gorgon` |
| Name | Gorgon |
| Role | Economy / returning-player; front-loaded power, flat growth, crafting payoff |
| Base L1 stats (hp/atk/def/spd) | **25 / 6 / 6 / 4** — a sturdy, slightly-slow bruiser |
| Start bonus | **5 banked stat points** (`statPoints: 5` at creation; every other starter begins with 0) |
| Leveling | **1 stat point / level** instead of 2 (HP-per-level unchanged) |
| Passive | **Stonewright** — upgrading gear mints a tradeable **Gear+** variant; her active pet fights as if +1 level |
| Evolution line | Tier-2/3 stone-hardening forms (same bonus-stat budget as other lines, reflavored) |

Blurb (draft): *"Ancient and stone-scaled. Born powerful and slow to change — her
strength is in her works. Stonewright: gear she upgrades comes out hardened
(Gear+), and her pets grow a step beyond."*

## Design decisions (from brainstorming)

1. **Integration:** Gorgon is a **new starter species**, chosen at creation
   alongside pest/kraul/saproling/zombie/squirrel — not a new orthogonal "race"
   axis. Reuses the existing species + passive slots.
2. **Stat tradeoff sharpness:** a *true hole*. `+5` banked at start, `1`/level,
   yielding **~−6 raw stats at cap 12** vs a normal race — a gap her crafting
   must fill, not a soft snowball.
3. **What fills the hole:** the game is **economy-constrained, not
   level-constrained** — most players end a session at full Legendaries with 0–1
   Mythics. So superior crafting output is real endgame power.
4. **Mechanism:** **Gear+** — upgrading a piece mints a superior "+" variant of
   that tier (chosen over material-yield or cost-discount levers, which only speed
   the *journey* to a ceiling most players never reach).
5. **Gear+ binding:** **baked into the item and tradeable.** The "+" is a
   permanent stamp; a Gorgon becomes the realm's master smith, feeding Gear+ into
   the Player Market. Non-Gorgons may buy and wield "+" gear.
6. **Gear+ magnitude:** **+1 to the piece's primary stat** (atk on a fang, def on
   a carapace), `+2` at Mythic tier. Rider/effect untouched. Single flag — a piece
   is "+" or not; it never compounds to "++".
7. **Pets:** a *light* innate edge, not a full "Pet+" system — a Gorgon's active
   pet fights **as if +1 level**. Honors "better at raising pets" with no new
   per-pet data. (A full Pet+ mint is a possible v2.)

## Power budget (why it balances)

Approximate stat totals over a full game to cap (12):

| Source | Normal | Gorgon |
|---|---|---|
| L1 base | ~15 | 16 |
| Start bonus | 0 | **+5** |
| Leveling (L2→12) | +22 (2×11) | **+11** (1×11) |
| Evolution | ~+16 | ~+16 (same) |
| **Raw subtotal** | **~53** | **~48 (≈ −5/−6)** |
| Gear | normal tiers | **Gear+ (~+4–5 across ~4 equipped) + more Mythics** |

She is a hair behind on flesh and makes it up in gear — and only *just* pulls
ahead if she truly masters the economy. On-theme; no power creep. Reconciles with
the stated target: a Gorgon lands near **2 Mythics** in a typical session (3 for a
dedicated player), where equal-skill normals sit at Legendaries.

## Mechanic detail

### Front-load: banked start points
Grant `statPoints: 5` in the new-player doc when `starter == 'gorgon'`. The player
allocates them via the existing `spend-stat` action — early, player-directed
strength. `spentThisLevel` bookkeeping is unaffected (banked points aren't tied to
a level).

### Leveling override
`apply_level_ups` currently adds the global `data.STAT_POINTS_PER_LEVEL` (2) per
level. Introduce a **species-keyed rate**: a Gorgon gets 1. Implement as a small
lookup (e.g. `data.STAT_POINTS_PER_LEVEL_BY_SPECIES.get(species, STAT_POINTS_PER_LEVEL)`)
keyed on the player's *line* (so it persists across evolution — the evolved form's
`line` still resolves to `gorgon`). HP-per-level is unchanged.

### Stonewright — Gear+ (recommended implementation: id-suffix, NOT per-instance data)
Gear is stored as **bare string ids** throughout (`gear[slot] = id`,
`gearStash = [id, …]`, market listings, salvage, drops). Rather than refactor gear
into per-instance objects, **encode "+" in the id**:

- **"+" GEAR entries are generated programmatically.** For each upgradeable base
  entry, synthesize a `{gid}+` variant = a copy with `+1` to its primary stat
  (`+2` when `tier == 4`). Same slot, tier, rider, name (display appends "+"). This
  keeps `data.GEAR` the single source and the bare-id pipeline (equip, stash,
  market, salvage, client lookup) carries "+" ids **for free** — they resolve like
  any other id.
- **Minting:** in `_upgrade_gear`, when the acting player's line is `gorgon`,
  resolve the next-tier id via `GEAR_FAMILY` as today, then **append the "+"
  suffix**. If the piece being upgraded is *already* "+", the result stays "+"
  regardless of who upgrades it (the stamp is permanent and travels).
- **Non-Gorgon upgrading a "+" piece:** keeps the "+" (permanent stamp) but adds
  no new "+"; the next-tier id is `{next_gid}+`.
- **Salvage / cost:** a "+" piece salvages and costs to upgrade exactly like its
  base tier (the "+" is a stat bonus, not a tier). Upgrade-cost lookups key on
  `tier`, which is identical.
- **Client:** strip a trailing "+" to pick the base sprite/icon, and render a "+"
  badge + the boosted stat line. Gear mirror lives in
  `src/app/undercity/data/items.ts` — generate the same "+" variants there (or
  derive at render time) so tooltips/stat math match the server.

Rationale for id-suffix over per-instance dicts: **zero storage-model change**, so
market/stash/salvage/drops need no refactor — the single biggest de-risking of the
build.

### Pet bonus (light)
Where the owner's active-pet combat contribution is derived (`pet_combat`, called
with the owning player in context), a Gorgon owner computes it at `pet.level + 1`
(clamped to the pet's tier cap + 1 for scaling only — no change to the pet's stored
level or to `PET_LEVEL_CAP`). Minimal reach; no new per-pet data.

### Evolution
Gorgon gets tier-2 (L5) and tier-3 (apex) forms like every starter, with the same
bonus-stat budget as existing lines (reflavored as hardening/petrifaction stages),
so Gear+ only has to fill the −6 *leveling* gap — not a larger one. Placeholder art
per the GDD placeholder approach; real Gorgon art is a future swap.

## Affected sites

**Backend (Python):**
- `undercity_data.py` — new `STARTERS['gorgon']`; `STARTER_VARIANTS` (optional);
  `TIER2`/`TIER3` Gorgon forms (`line: 'gorgon'`); passive id `stonewright` +
  blurb; **generated "+" GEAR variants**; a `STAT_POINTS_PER_LEVEL_BY_SPECIES`
  (or equivalent) table.
- `undercity_config.py` — any Gorgon scalars worth tuning (start-points = 5,
  per-level = 1, Gear+ magnitude, pet +1-level) surfaced as named constants.
- `undercity_engine.py` — `apply_level_ups` species-keyed rate; `pet_combat`
  owner-aware +1-level; ensure `effective_stats` reads "+" gear (free via id
  lookup).
- `undercity_db.py` — new-player doc: `starter == 'gorgon'` sets `statPoints: 5`
  and Gorgon base stats/passive; `_upgrade_gear` mints "+" for Gorgon and
  preserves existing "+".
- `tests/` — join-with-`gorgon` coverage; a Gorgon-upgrade-mints-"+" test; a
  non-Gorgon-preserves-"+" test; leveling-rate test; keep the suite green.

**Frontend (TypeScript):**
- `src/app/undercity/data/forms.ts` — `STARTERS` entry (id/name/blurb/passive
  name+blurb), `TIER2`/`TIER3` Gorgon forms, `PASSIVE_NAMES.stonewright` /
  `PASSIVE_BLURBS.stonewright`.
- `src/app/undercity/data/items.ts` — "+" GEAR variants mirror (or render-time
  derivation) so client stat math matches the server.
- `src/app/undercity/data/species.ts` — `FORM_SPRITES` for the Gorgon +
  evolution forms → placeholder sprite(s).
- `src/app/undercity/data/pets.ts` — no data change (pet +1-level is server-side);
  confirm no client mirror asserts pet combat numbers that would drift.
- Gear rendering — strip trailing "+" for base art; show "+" badge + boosted
  stats in tooltips/inventory/market listings.

**Assets:**
- Placeholder Gorgon sprite(s) under `public/undercity/sprites/` (base + evolution
  forms). Real art is a later swap.

**Reference chart:**
- `UNDERCITY_EVOLUTION.html` — add the Gorgon line if the chart is being kept
  current.

## Balance / tuning

Per the tune-undercity-balance skill, expose the knobs as named constants and keep
client mirrors in sync:
- `GORGON_START_POINTS = 5`, `GORGON_STAT_POINTS_PER_LEVEL = 1`.
- Gear+ magnitude (`+1` primary; `+2` at tier 4).
- Pet effective-level bonus (`+1`).

Validate with the balance sim (`infrastructure/lambda/sim/`) if a Gorgon bot is
cheap to add: confirm a Gorgon and a normal race land within a stat point or two of
each other at cap once Gear+ is factored, and that Gorgon Gear+ on the Player
Market doesn't distort pricing (a "+" piece should be worth roughly a half-tier
premium, not a full tier).

## Verification

- `cd infrastructure/lambda && python -m pytest tests -q` stays green.
- `npm run build` succeeds (lint is broken repo-wide; build is the type-check
  gate).
- Manual: create a Gorgon, confirm 5 banked points at L1, confirm a level-up grants
  1 point, upgrade a piece at the Blacksmith and confirm it becomes "+", trade/sell
  it and confirm the "+" persists for the buyer, confirm a normal race upgrading a
  "+" piece keeps the "+".

## Non-goals

- No new orthogonal "race" system — Gorgon is a species.
- No full "Pet+" minting in v1 (light +1-level bonus only; Pet+ is a possible v2).
- No cost-discount or material-yield economy levers (Gear+ is the mechanism).
- No real Gorgon art (placeholder swap later).
- No change to the Mythic ceiling — Gear+ is a within-tier bonus, not a new tier.

## Open questions (resolve during planning)

- Exact tier-2/3 form names, stat bonuses, and form passives for the Gorgon line.
- Whether "+" GEAR variants are generated for *all* upgradeable families or only
  the standard rider families (edge: hybrid/black-market pieces).
- Market UI: how prominently to surface "+" so buyers understand the premium.
