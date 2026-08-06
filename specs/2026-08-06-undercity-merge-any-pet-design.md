# Undercity — Merge Any Pet Type to Raise Rarity

**Date:** 2026-08-06
**Status:** Design (awaiting review → plan)

## Problem

Ranking up a companion's rarity requires merging **same-species duplicates**
(`_merge_pet` rejects any fodder whose `species` differs from the keeper). With
ten species across five roles and low drop rates, a player rarely holds two of
the same species, so the merge path is effectively dead — pets pile up unused and
rarity almost never climbs.

## Solution

Let **any** owned pet be merge fuel. Fodder is consumed for its tier's merge
points regardless of species; the **keeper keeps its own species, ability, and
level** — only its tier/rarity rises. This turns the whole roster into fuel for
the one companion you care about.

Merge-point values are unchanged and **fully flat** — a fodder pet is worth
`PET_MERGE_POINTS[its tier]` (`{1:1, 2:3, 3:7, 4:15}`) no matter its species. The
per-tier advance costs (`PET_MERGE_COST = {2:2, 3:3, 4:4}`) and the
advance-while-affordable / bank-the-remainder behavior are unchanged.

### Decisions locked in brainstorming

- **Flat fuel value** — off-species fodder is worth exactly the same as a matching
  duplicate. Duplicates no longer matter for ranking up.
- **Keep the rank-up gate** — the Merge button stays enabled only when the current
  selection *completes* the keeper's next tier. The server still banks any
  leftover progress, but the UI never lets you spend pets for a sliver.
- **Confirm on high-rarity fuel** — when a selected fodder pet's tier is
  **strictly greater** than the keeper's (e.g. feeding a Legendary into a Common
  keeper), the client shows a confirm before merging so a valuable pet isn't
  fat-fingered into fuel. The server allows it either way. (Refinement of the
  brainstorm's "≥ keeper tier": using strictly-greater avoids nagging on the
  standard equal-tier merge such as two Commons → Rare. Flagged for review.)

## Architecture

### Server — `infrastructure/lambda/undercity_db.py` `_merge_pet`

1. **Remove the species gate.** Delete:
   ```python
   if p['species'] != target['species']:
       return _err('Only the same species can be merged.', 409)
   ```
   Keep the other fodder validations (exists, not the target itself).
2. **Clear a consumed active pet.** After building the `consumed` id set, if
   `doc.get('activePetId')` is in it, set `doc['activePetId'] = None`. (Latent bug
   today even for same-species merges; far more reachable once any pet is fodder.)

No change to merge-point math, tier-advance loop, or the response text (which
already names the keeper's species).

### Client — `src/app/undercity/tabs/creature-tab.component.ts` + `.html`

Collapse the per-species merge model into a **single keeper + free fodder** model.

Remove: the `MergeGroup` interface, `mergeGroups` computed, `mergeableSpeciesExist`
computed, `mergeKeepers` (per-species override map), `mergeKeeperPicker`,
`speciesPets`, `chooseKeeper(species, id)`, `toggleKeeperPicker`,
`mergeProgressPct(group)`, and `mergeGroup(group)`.

Add:
- `mergeKeeperId = signal<string | null>(null)` — explicit keeper; `null` = auto.
- `mergeState = computed<MergeState | null>(...)`:
  - **keeper**: the pet whose id is `mergeKeeperId()`, else the auto-pick — the
    best non-max-tier pet by `tier → level → mergeProgress`. `null` if every pet
    is max tier (nothing to rank up).
  - **fodder**: all owned pets except the keeper (any species).
  - **selected**: fodder ticked in `mergePicks`.
  - **points**: `keeper.mergeProgress + mergePointsFor(selected)`.
  - **need**: `PET_MERGE_COST[keeper.tier + 1]`.
  - **ready**: `mergeWouldRankUp(keeper, selected)` (already species-agnostic).
  - **currentRarity / nextRarity**: `tierRarity(...)`.
- `canMerge = computed(() => !!mergeState())` — drives the top-bar Merge button
  (replaces `mergeableSpeciesExist`). True when at least one non-max-tier pet and
  one other pet exist.
- `chooseKeeper(petId)` — set `mergeKeeperId`, and drop that id from `mergePicks`
  (a keeper can't also be fodder).
- `mergeProgressPct()` — over `mergeState()`.
- `needsHighRarityConfirm = computed(() => selected.some(f => f.tier > keeper.tier))`.
- `doMerge()`:
  - guard: `mergeState()?.ready` and non-empty selection.
  - if `needsHighRarityConfirm()`, require a confirm step first (a
    `mergeConfirm = signal(false)` that swaps the button for
    "Feed higher-rarity pets in? [Cancel] [Confirm]"). On confirm, proceed.
  - dispatch `merge-pet` with `{ targetPetId: keeper.id, fodderPetIds: selected ids }`,
    clear picks, refresh; keep the popup open if more merging remains, else close.

Template (`.html`, the `@if (mergeOpen())` block): replace the
`@for (group of mergeGroups())` list with a single panel:
- **Keeper row**: keeper sprite + name + `currentRarity → nextRarity · Lv N`.
- **Feed-in grid**: `@for (f of mergeState().fodder)` chips (sprite + rarity
  badge), each toggling `mergePicks`; tapping a *keeper-eligible* chip via a small
  "make keeper" affordance calls `chooseKeeper`. (Simplest: each fodder chip has a
  tick for fodder; a long-press / dedicated "★ keeper" mini-button reassigns
  keeper. Keep it one obvious tap for fodder, one clear control for keeper.)
- **Progress bar**: `points / need`.
- **Merge button**: disabled unless `ready`; label `Merge` when ready else
  `Pick more pets`. When `needsHighRarityConfirm()`, first tap arms the confirm.
- Empty state when `!mergeState()`: "No pets to rank up right now."

The client merge-point mirror in `data/pets.ts` (`mergePointsFor`,
`mergeWouldRankUp`, `PET_MERGE_POINTS`, `PET_MERGE_COST`) is already
species-agnostic — **no math changes there**, only the candidate list widens.

## Data flow

Player ticks fodder → `mergeState` recomputes points/ready → tap Merge (→ confirm
if high-rarity fuel) → `merge-pet` action → server awards flat points, advances
tier(s), banks remainder, consumes fodder, clears `activePetId` if it was consumed
→ optimistic refresh re-renders the popup from fresh roster state.

## Testing

`infrastructure/lambda/tests/test_undercity_companions.py`:
- **Replace** `test_merge_rejects_cross_species` with
  `test_merge_cross_species_ranks_up`: a keeper plus different-species fodder of
  sufficient tier ranks the keeper up and consumes the fodder; the keeper's
  `species` is unchanged.
- **Keep** `test_merge_same_species_ranks_up` and `test_merge_partial_progress_carries`
  (flat values mean same-species still works identically).
- **Add** `test_merge_consuming_active_pet_clears_pointer`: with `activePetId` set
  to a fodder pet, a merge consumes it and leaves `activePetId is None`.
- **Add** `test_merge_keeper_survives_as_active`: keeper == active pet stays and
  remains active after merge.

Run: `cd infrastructure/lambda && python -m pytest tests -q` — keep the companions
+ merge tests green (pre-existing map/engine/spells WIP failures are out of scope).

Frontend: `npm run build` compiles clean (no test runner).

## Out of scope / non-goals

- No change to merge-point values, tier costs, or level/salvage economics.
- No cross-species ability blending — the keeper's ability is untouched.
- No change to egg/hatch or the scout-courier work.
- No same-species bonus (explicitly rejected: fuel is flat).
