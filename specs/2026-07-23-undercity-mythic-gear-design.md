# Undercity — Mythic Gear (T4, craft-only)

**Date:** 2026-07-23
**Status:** Draft, pending user review
**Part of:** [Plaza Economy umbrella](2026-07-20-undercity-plaza-economy-umbrella.md)
**Builds on:** [Gear Rarity & Scaling](2026-07-20-undercity-gear-rarity-design.md) (the rarity
ladder + `RIDER_SCALE` + `GEAR_FAMILY` index this spec extends) and
[Forge Economy](2026-07-20-undercity-forge-economy-design.md) (the Blacksmith `upgrade-gear`
path + Chrysalis Ichor material this spec's top rung consumes) — both **implemented**.

## Problem

The rarity ladder tops out at **Legendary (tier 3)**. Once a player has upgraded a piece to
Legendary at the Blacksmith, the forge loop is over — Chrysalis Ichor (the rare, deep-content
material) has no sink beyond that one step, and there is no aspirational item left to chase.
We want a true end-game rung that (a) gives Ichor a meaningful long-horizon sink, and (b) is a
*reward for engaging the forge*, not something you stumble onto as a drop.

## Goal

Add a 4th rarity, **Mythic (tier 4)**, one per rider family, that:

1. **Cannot be found** — never drops, never stocks in the bazaar, never appears in a boss trove.
   The *only* source is crafting.
2. **Is crafted by upgrading a Legendary** of the same rider family at the Blacksmith, spending
   **3 Chrysalis Ichor + Spores**.
3. **Is a new power ceiling** — unlike the flat Common→Legendary stat rule, Mythic raises *both*
   rider magnitude (one more `RIDER_SCALE` step) *and* a modest stat band above T3.

Non-goals: no new riders, no new gear slots, no random-roll/affix system, no new material (the
"legendary ichor goo" in the request **is** the existing Chrysalis Ichor).

## Why this is mostly data, not code

The forge/rarity systems were built to extend by tier index, so a 4th rung slots in with almost
no new logic:

- **`GEAR_FAMILY`** is auto-derived: `GEAR_FAMILY.setdefault(rider, {})[g['tier']] = gid`
  ([undercity_data.py:297](../infrastructure/lambda/undercity_data.py#L297)). New `tier: 4`
  entries appear as `GEAR_FAMILY[rider][4]` for free.
- **`_upgrade_gear`** already computes `next_tier = g['tier'] + 1` and looks up
  `GEAR_FAMILY[rider].get(next_tier)`, reading costs from `UPGRADE_SPORES/MOLTINGS/ICHOR` by
  `next_tier` ([undercity_db.py:919](../infrastructure/lambda/undercity_db.py#L919)). Adding the
  tier-4 entries + cost-dict keys makes Legendary→Mythic work with **no change to the upgrade
  path**.
- **Found-gear sources filter by tier and stop at 3**: `GEAR_DROP` weights
  ([undercity_data.py:349](../infrastructure/lambda/undercity_data.py#L349)) top out at tier 3;
  the bazaar picks from `BAZAAR_GEAR_TIERS`; the boss trove hard-filters `g['tier'] == 3`
  ([undercity_db.py:90](../infrastructure/lambda/undercity_db.py#L90)). **Leaving all three
  untouched is exactly what makes Mythic craft-only** — a tier-4 piece is unreachable by any
  find path. This is enforced by a test (below), not left to convention.

## Backend changes

### `undercity_data.py`

- **~16 new `GEAR` entries at `tier: 4`**, one per rider family (barbed, bloodfang, deep_biter,
  rabid, gutcleaver, thick, spiked, bramble, bulwark, mossback, trickster, venomtrick, serrated,
  cutpurse, seer, glint). Each reuses its family's slot + rider and takes a **new Mythic stat
  band** above T3:
  - Fangs (T3 = atk 6, spd 1) → Mythic ≈ atk 7–8, spd 1.
  - Carapaces (T3 = def 5, maxHp 6) → Mythic ≈ def 6, maxHp 8.
  - Charms stay light (charms carry effect, not stats).
  - `seer`/`glint` pieces get a Mythic `readBonus` (their magnitude scales via `readBonus`, not
    `RIDER_SCALE` — same as the other rungs).
  - Exact numbers are a `tune-undercity-balance` task; the band above is the starting proposal.
  - `cost` is set for completeness/sell-back math but is **not** a buy path (never stocked).
  - Names: Golgari end-game flavor (relic/godbeast), finalized as a tuning/asset task.

### `undercity_config.py`

- **Extend `RIDER_SCALE`** with a `4:` column per rider — one more monotonic non-decreasing
  step (e.g. `bramble {…, 3: 4, 4: 5}`, `spiked {…, 3: 1.8, 4: 2.0}`, `cutpurse {…, 3: 9, 4: 12}`).
  `seer`/`glint` remain absent from the table (readBonus path).
- **Cost knobs** for the new rung:
  - `UPGRADE_SPORES[4]` — a Spore cost above the Rare→Legendary step (proposal: ~150; tuning).
  - `UPGRADE_MOLTINGS[4] = 0` — Moltings are a low-tier material; the top rung's gate is Ichor.
  - `UPGRADE_ICHOR[4] = 3` — the headline gate (the request's "3 legendary ichor goo").
- **`SALVAGE_MOLTINGS[4]`** so a Mythic can be ground, and a **Mythic salvage Ichor return of 1**
  (strictly `< UPGRADE_ICHOR[4]`) so craft→salvage is never a net Ichor gain (no farming loop).
  Requires a small change to the salvage-yield code, which today hardcodes
  `'ichor': SALVAGE_ICHOR if tier >= 3 else 0`
  ([undercity_db.py:772](../infrastructure/lambda/undercity_db.py#L772)) — make the Ichor yield a
  per-tier lookup (tier 3 → 1, tier 4 → 1) rather than a single scalar.

### `undercity_db.py`

- **One text fix:** `_upgrade_gear`'s terminal "no next rung" error currently reads
  `'That piece is already Legendary.'` ([undercity_db.py:922](../infrastructure/lambda/undercity_db.py#L922)).
  Make it rarity-aware so a Mythic (no tier-5) reports `'That piece is already Mythic.'`.
- Salvage Ichor yield → per-tier lookup (see config bullet above).
- No other logic changes: the upgrade cost/debit path, stash/equip target handling, and the
  `salvage-gear`/`upgrade-gear` dispatch all already generalize over tier.

## Client changes (`src/app/undercity/`)

- **`data/items.ts`** — mirror the ~16 Mythic `GEAR` entries + the `RIDER_SCALE` tier-4 column +
  the cost mirrors (per the combat-spec §6 mirror rule).
- **`tierRarity(4)` → `Mythic`** and a new **`--rarity-mythic`** design token (a prismatic /
  violet above the Legendary gold; pick per STYLE_GUIDE palette).
- Rarity pills/borders already render from `tierRarity` on equip tiles, stash rows, shop rows,
  the drop-reveal, and the Blacksmith preview — they pick up Mythic once the helper + token
  exist.
- The **Blacksmith modal**'s before→after preview is tier-generic; it will show
  Legendary→Mythic with the scaled effect delta and the "3 Chrysalis Ichor + N Spores" cost
  automatically once the data/rarity helper know tier 4. Verify the disabled/CTA state when the
  player is short on Ichor.

## Balance & invariants

- **Mythic raises the stat ceiling** (deliberate; the only rung that does). Re-run the combat
  balance suite and sanity-check that a Mythic-equipped creature doesn't trivialize the enemy
  ladder; adjust the Mythic stat band (tuning) if it does.
- **Every `RIDER_SCALE` ladder stays monotonic non-decreasing** through tier 4
  (`test_rider_scale_monotonic`, extended).
- **Craft-only** is a hard invariant, asserted by a test: no `tier == 4` gear id appears in
  `GEAR_DROP` weight maps, the bazaar tier set, or the boss-trove filter.
- **No Ichor farming loop:** Mythic salvage Ichor return (1) `<` craft cost (3).
- Balance numbers mirrored between `undercity_data.py`/`undercity_config.py` and `data/*.ts`.

## Files to touch

**Backend ([infrastructure/lambda/](../infrastructure/lambda/)):**
- `undercity_data.py` — ~16 tier-4 `GEAR` entries (auto-index into `GEAR_FAMILY`).
- `undercity_config.py` — `RIDER_SCALE` tier-4 column; `UPGRADE_SPORES/MOLTINGS/ICHOR[4]`;
  `SALVAGE_MOLTINGS[4]` + per-tier salvage-Ichor.
- `undercity_db.py` — rarity-aware "already max rung" message; per-tier salvage-Ichor lookup.
- `tests/` — Legendary→Mythic happy path; blocked without 3 Ichor; Mythic can't upgrade
  further; Mythic absent from every found source; monotonic-ladder-through-4; salvage return
  `< 3`. Keep the full suite green.

**Client ([src/app/undercity/](../src/app/undercity/)):**
- `data/items.ts` — Mythic entries + `RIDER_SCALE` tier-4 mirror + cost mirrors.
- `tierRarity` + `--rarity-mythic` token; verify pills/borders + Blacksmith preview render it.

**Docs:** `specs/undercity-combat.md` §4/§6/§7 — note Mythic as the tier-4 rung and the
Ichor-3 forge gate.

## Testing

- `cd infrastructure/lambda && python -m pytest tests -q` — green incl. the new Mythic tests.
- `npm run build` — client compiles (repo lint is known-broken; verify via build).
- Manual (via `run-undercity`): own a Legendary of some family → Blacksmith shows a
  Legendary→Mythic upgrade at 3 Ichor + Spores; blocked with < 3 Ichor; succeed with 3; the
  Mythic renders with the new rarity pill and never appears in shop/drop/boss trove.

## Open / deferred (tuning, not structure)

- Exact Mythic stat band, `UPGRADE_SPORES[4]`, and salvage-Ichor return — `tune-undercity-balance`.
- Final Mythic names + art (Golgari relic/godbeast flavor).
- `--rarity-mythic` exact color.

## Coordination note

`undercity_db.py`, `undercity_data.py`, `undercity_config.py`, and the engine/tests have frequent
in-flight working-tree edits. Layer onto whatever is current, not the committed snapshot.
