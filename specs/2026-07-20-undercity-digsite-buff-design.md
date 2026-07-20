# Undercity Digsite Rework — Visible Finds + Worthwhile Loot

**Date:** 2026-07-20
**Status:** Approved, implementing

## Problem

Digsites (`excavation` nodes) feel dead — players don't linger because a visit
rarely pays out anything, and it's unclear what (if anything) is going on. Two
symptoms, one root cause:

1. **Underpowered / "might be broken."** The server *masks* all item positions,
   so 3 digs are pure luck on a 5×5 grid. You must uncover *every* cell of an
   item to claim it, so the 1×2 (2 cells) and 2×2 (4 cells) are essentially
   unclaimable in 3 blind digs, and even a 1×1 is a long shot. Most visits: 3
   digs, nothing. On top of that, a 1×1 is 70% just 8–15 spores.
2. **"Where do I dig?"** Nothing shows where finds are buried — just anonymous
   brown squares.

Both dissolve if the buried finds are **visible under the dirt**: digging
becomes a guided, strategic budget decision instead of a lottery.

## Design

### 1. Symbols under the dirt (visibility)

- The server's dig view (`_dig_view`) stops masking positions. Each item in the
  view now carries its **footprint `cells`** plus its **loot** (`kind`, `item`
  id, `spores` amount). This applies both to the modal and the bulk `excavations`
  map in game state.
- The client (`ExcavationModalComponent`) renders each covered cell that sits
  over a buried find as **its icon glowing faintly beneath a dirt texture**
  (Material icon via `CONSUMABLE_MAP[id].icon`; spore caches use `grain`).
  Digging scrapes the dirt off; a fully-uncovered find brightens to full and,
  once claimed, dims with a check. Empty cells stay plain dirt. No more
  anonymous colored squares — the `data-item` color-index scheme is replaced by
  real icons.

### 2. Digs = a real choice

Because finds are visible, "reveal every cell" is now just a **dig budget**:
1×1 = 1 dig, 1×2 = 2 digs, 2×2 = 4 digs. Bump digs/visit **3 → 4** so a visit is
a genuine decision:

- all 4 on the marquee 2×2, **or**
- the 1×2 + a 1×1, **or** both 1×1s and bank a dig.

The site holds 8 item-cells, so you still can't strip it solo in one visit — it
stays a shared, competitive, return-worthy spot.

### 3. Loot worth walking over for

`_roll_dig_loot` rebalanced so every find lands:

| Shape | Reward |
|-------|--------|
| 1×1   | 55% Spore cache **15–25**, else common consumable (`healing_moss` / `snare` / `smoke_spore`) |
| 1×2   | any consumable |
| 2×2 (marquee) | 55% strong combat item (`loaded_die` / `scrying_spore` / `rot_bomb` / `chitin_ward` / `ambush_musk`), else big Spore cache **50–80** |

Loot is fixed at grid-gen, so the icon you see always matches what you'll get.

### Unchanged

Shared-per-season sites, the clear bonus + reset, the entry flow, and the
`dig`/collect server logic (uncover full footprint → claim).

## Touch points

- `infrastructure/lambda/undercity_data.py` — `EXCAVATION_DIGS_PER_VISIT` 3→4.
- `infrastructure/lambda/undercity_db.py` — `_roll_dig_loot` buff; `_dig_view`
  emits `cells` + loot per item.
- `src/app/undercity/services/undercity-models.ts` — `DigItemView` gains
  `cells`, `kind`, `item`, `spores`.
- `src/app/undercity/tabs/excavation.component.ts` — icons-under-dirt rendering.
- Tests: `tests/test_undercity_db.py` stays green (asserts reference constants
  and shape only).
