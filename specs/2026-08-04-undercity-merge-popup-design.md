# Undercity — Roster-wide Merge popup

**Date:** 2026-08-04
**Status:** Design approved, ready for implementation plan
**Scope:** Client-only (Angular). No backend changes.

## Problem

Companion merging is buried inside each individual pet's detail popup (the
`.merge-box` at the bottom of the `selectedPet` sheet in
`creature-tab.component.html`). It is keeper-centric and cramped: to merge you
must first open one specific pet, and only that pet's same-species dupes appear
as fodder. There is no room to give a good merging experience, and no way to see
merge opportunities across the whole roster at once.

## Goal

Move merging out of the per-pet popup into a dedicated **Merge** button in the
Companion top bar that opens a roomy, roster-wide merge popup grouped by species.

## Non-goals

- No backend/engine changes. The existing `merge-pet` action is reused verbatim.
- No change to merge balance/economy (points, costs, rank-up thresholds).
- Gear merging is out of scope — merging remains a companion-only concept.

## Background: how merge works today

- Merging feeds same-species duplicate pets ("fodder") into a "keeper" to raise
  the keeper's rarity **tier** (1..4). Fodder pets are consumed.
- Fodder contributes points by *its* tier: `PET_MERGE_POINTS = {1:1, 2:3, 3:7,
  4:15}`. Advancing the keeper *into* tier 2/3/4 costs `PET_MERGE_COST =
  {2:2, 3:3, 4:4}` points.
- The keeper carries a running `mergeProgress`. The server (`_merge_pet` in
  `infrastructure/lambda/undercity_db.py`) adds the fodder's points to
  `mergeProgress`, then advances tier while affordable, capping at tier 4.
- Merge consumes only pets — **no moltings/gemstones cost.**
- Client mirror of the numbers + helpers lives in
  `src/app/undercity/data/pets.ts` (`mergeWouldRankUp`, `mergePointsFor`,
  `PET_MERGE_COST`, etc.).

## Design

### 1. Merge button (Companion top bar)

- Add a `Merge` button to `.gear-topbar`, rendered **only** in the
  `@case('companion')` gear section, and **only when** at least one species is
  owned 2+ times (`mergeableSpeciesExist()`).
- It sits to the left of `.gear-mat-chips` (which keep `margin-left: auto` and
  stay pinned right), landing in the currently-empty top-bar space.
- Icon + label ("Merge"). Tapping sets a new `mergeOpen` signal to `true`.
- When no species has a duplicate, the button is absent (never a dead-end).

### 2. Merge popup

Reuses the existing bottom-sheet chrome (`.item-sheet-backdrop` + `.item-sheet`,
max-width 480px, slide-up animation, close button, backdrop-tap to dismiss) so it
matches every other popup. Because it can hold several group cards, its body is
vertically scrollable.

- **Header:** title "Merge Companions" + a one-line explainer, e.g. "Feed
  duplicate companions into one to raise its rarity."
- **No resource chips** inside the popup — merging costs pets, not
  moltings/gemstones; showing them would mislead.
- **Empty/edge state:** the button is hidden when there is nothing to merge, so
  the popup always has at least one group when open. (If state changes out from
  under it, show a muted "No duplicates to merge." line.)

### 3. Per-species group card

One card per species the player owns 2+ of, ordered best rarity first (then by
count). Each card contains:

- **Keeper** shown prominently: sprite, name, `Lv N`, and
  `currentRarityLabel → nextRarityLabel`.
  - Auto-picked as: highest tier, then highest level, then highest
    `mergeProgress`.
  - A small **change** control lets the player reassign the keeper to another
    pet of that species. The previously-selected keeper drops back into the
    fodder row and its ticked state is cleared.
- **Fodder row:** the remaining same-species pets as tappable chips (reuse
  `.merge-chip` / `.merge-fodder` styling — sprite + `Lv N`, `picked` state on
  tap).
- **Progress bar:** fill = `(keeper.mergeProgress + selectedFodderPoints) /
  PET_MERGE_COST[keeper.tier + 1]`, with a `points/need` numeric readout.
  Species already at max tier (4) are not shown at all.
- **Merge button (rank-up gate — decision A):** enabled **only when** the
  ticked fodder would rank the keeper up at least one tier
  (`mergeWouldRankUp(keeper, selectedFodder)`). Disabled otherwise with a
  "Pick more fodder" / "Need more duplicates" label. This preserves today's
  exact balance behavior — you can never spend a pet without a visible rank-up.

### 4. Removal

- Delete the `.merge-box` block from the pet detail popup
  (`creature-tab.component.html`, the `@if (!petAtMaxTier(pet) &&
  mergeFodderFor(pet).length)` section).
- Keep the existing "At level cap — merge to raise its rarity" hint in the pet
  popup; it now nudges players toward the top-bar Merge button.
- The `.merge-box` SCSS may be retired or repurposed for the new group cards.

## Component changes (`creature-tab.component.ts`)

- **New signals:**
  - `mergeOpen = signal(false)` — popup visibility.
  - `mergeKeepers = signal<Record<string, string>>({})` — per-species keeper
    override (species → keeper pet id); empty means "use auto-pick".
  - Reuse the existing `mergePicks = signal<Set<string>>` for ticked fodder —
    pet ids are globally unique, so one set spans all groups safely.
- **New computed `mergeGroups()`:** groups `you().pets` by species where count
  ≥ 2 and keeper tier < 4; for each returns `{ species, keeper, fodder[],
  selectedPoints, need, ready, currentRarity, nextRarity }`.
- **New `mergeableSpeciesExist()`** derived from `mergeGroups().length > 0`
  (drives the button's visibility).
- **`openMerge()` / `closeMerge()`:** toggle `mergeOpen`, reset `mergePicks`
  and `mergeKeepers` on open.
- **`setMergeKeeper(species, petId)`:** record the override, clear that
  species' picks.
- **`mergeGroup(keeper)`:** call `store.action('merge-pet', { targetPetId,
  fodderPetIds })` with the ticked fodder for that group, then **keep the popup
  open**, clear that group's picks, and let `mergeGroups()` recompute from the
  refreshed state (auto-closing groups that drop below 2 or hit max tier). If no
  groups remain, close the popup.
- Existing `mergePet(keeper)` (which closed the pet popup) is superseded; the new
  `mergeGroup` is the popup-resident variant.

## Styling (`creature-tab.component.scss`)

- New `.merge-btn` (or reuse `.gear-back` sizing) for the top-bar button.
- `.merge-popup-body` scroll container inside `.item-sheet`.
- `.merge-group` card, `.merge-keeper` row with `.merge-change` control,
  `.merge-progress` bar, reusing `.merge-fodder` / `.merge-chip`.
- Follow STYLE_GUIDE tokens; no emoji (icons only, per project convention).

## Testing / verification

- No test runner is wired for the frontend; verify with `npm run build`.
- Manually verify via the `run-undercity` flow: reach the Companion screen with a
  roster containing dupes, open the Merge popup, confirm grouping, keeper
  auto-pick + change, progress bar, rank-up gating, and that a successful merge
  updates the roster and keeps the popup open until nothing is mergeable.
