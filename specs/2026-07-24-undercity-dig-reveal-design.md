# Undercity Dig Site — reveal-as-you-dig with a single spanning symbol

**Date:** 2026-07-24
**Status:** Design — approved for planning
**Area:** `src/app/undercity/tabs/excavation.component.ts` (client only)

## Summary

Change the excavation dig site so a multi-cell find renders as **one large symbol
spanning its whole footprint**, occluded by the dirt grid, instead of the same
Material icon tiled once per cell (a 2×2 find currently shows four identical
bolts). Covered cells show only dirt; each dig uncovers that cell's **slice** of
the one symbol, so exposing a corner tells the player which direction to keep
digging ("looks like there's more down and to the right").

This reverses today's *fully-visible* dig site (where every find shows faintly
through the dirt up front) in favour of a light guessing game.

## Goal / player experience

- Before digging, the site is a uniform field of dirt — no find hints.
- Digging a cell that sits over a find reveals that cell's fragment of a single
  large glyph. Adjacent fragments visually connect into one symbol.
- A partial reveal reads as a directional hint. Fully clearing a find's
  footprint claims it (unchanged from today).
- Partial reveals still persist across visits and players (shared site,
  server-tracked) — a corner you expose helps whoever digs next.

## Current behaviour (what changes)

- `_dig_view` (backend) sends every find's footprint + loot + icon up front,
  regardless of reveal state. **Unchanged** — see Non-goals.
- `buildView()` marks a cell `hasItem` purely by footprint membership, so covered
  find-cells render a faint icon (`.cell.covered .find { opacity: 0.42 }`), and
  each find-cell renders its own `<mat-icon>`. → A 2×2 = four glyphs.
- Covered find-cells expose the find's label via `title`/`aria-label`. → leaks
  the answer and is inaccurate under the new model.

## Design

### Rendering approach — one glyph, clipped per cell (Option A)

Reuse the existing Material icon; no new art, no backend change. Each `.cell` is
already `position: relative; overflow: hidden`. For a **revealed** find-cell we
render the shared `<mat-icon>` sized to the find's full footprint and offset so
its top-left aligns with the footprint's top-left. Because the cell clips
overflow, each cell shows only its slice; neighbouring slices line up into one
continuous symbol (the 4px grid gaps break it up — the intended "under a grid"
look).

Geometry, computed per find-cell in `buildView()` from the find's footprint
bounding box and exposed as inline CSS custom properties on the cell:

- `--span-c`, `--span-r` — footprint width/height in cells (1, 2).
- `--lc`, `--lr` — this cell's column/row **within** the footprint (0-based).

Stylesheet drives the glyph off those vars (gap `g = 4px`, kept in a shared
`--dig-gap` var used by both the grid `gap` and these calcs so they never
diverge):

- `width  = calc(var(--span-c) * 100% + (var(--span-c) - 1) * var(--dig-gap))`
- `height = calc(var(--span-r) * 100% + (var(--span-r) - 1) * var(--dig-gap))`
- `left   = calc(var(--lc) * -1 * (100% + var(--dig-gap)))`
- `top    = calc(var(--lr) * -1 * (100% + var(--dig-gap)))`

Glyph fill: the cell is a container (`container-type: size`); the icon's
`font-size` tracks the footprint height in container-query units
(`calc(var(--span-r) * 100cqh + (var(--span-r) - 1) * var(--dig-gap))`) so it
stays responsive to the `1fr` grid. Scale the glyph ~10–15% past the footprint
so corner slices of a diagonal shape (a bolt) still carry recognizable shape
rather than empty box padding.

1×1 finds fall out of the same code path (span 1×1, local 0,0) — the whole glyph
in one cell, just hidden until dug.

### Visibility rules

- **Covered cell** (`code === -2`): dirt only. Render no glyph, no hint;
  `aria-label = "rubble"`, no `title`. (Removes the current faint-icon rule and
  the label leak.)
- **Revealed find-cell** (`code >= 0`, not collected): render its slice at full
  opacity, coloured as today (green for item finds, gold for spores).
- **Revealed rubble** (`code === -1`): open pit, as today.
- **Collected find**: grey the revealed slices (as today via `.cell.collected`)
  and show a **single** ✓ centred over the footprint — rendered once from the
  top-left cell using the same span geometry, **not** one ✓ per cell.

### Data-model changes (client only)

`CellVM` gains optional slice fields, populated only for find-cells:
`spanR`, `spanC`, `localR`, `localC`. `buildView()` computes each find's
bounding box once (min/max over `item.cells`) and fills these in. A
`revealedFind` flag (`hasItem && !covered`) gates whether the glyph renders.

No changes to `DigGrid` / `DigItemView` interfaces, services, or the backend.

## Non-goals / deferred

1. **Server-side hiding of undug finds.** The Lambda still sends the full layout;
   the client just doesn't draw covered cells. A player could read the answer in
   devtools. Acceptable for casual co-op; a proper fix (withhold undug find data
   in `_dig_view` + update `test_undercity_db.py`) is a possible follow-up and
   needs a deploy.
2. **Dig economy rebalance.** Blind digging changes risk/reward (4 digs/visit;
   you may hit rubble or only expose a corner). Keep current loot tables and dig
   counts; playtest the blind feel before touching
   `EXCAVATION_DIGS_PER_VISIT` / `_roll_dig_loot`.
3. **Dedicated SVG art per find (Option B).** Not doing it; reuse Material icons.

## Verification

No test runner for the frontend. Verify by:

- `npm run build` succeeds (per repo convention — lint is unreliable).
- Drive the real dig site via the `run-undercity` skill: land on an excavation
  node, confirm the grid starts as plain dirt, dig a corner of the 2×2 and see a
  single connected bolt fragment (not a whole small bolt), keep digging to claim
  it with one centred ✓, and confirm 1×1 / 1×2 finds still read correctly.
- Backend pytest suite is untouched but should stay green:
  `cd infrastructure/lambda && python -m pytest tests -q`.

## Files touched

- `src/app/undercity/tabs/excavation.component.ts` — `CellVM`, `buildView()`,
  template (`@if` gating + slice bindings), and styles.
