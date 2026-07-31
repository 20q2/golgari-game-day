# Undercity Hazard Wheel — Design

**Date:** 2026-07-30
**Status:** Approved, pending implementation plan

## Summary

When a player lands on a **hazard** space, instead of the effect appearing
immediately in a modal, a *Wheel of Fortune*–style radial wheel pops up, spins,
decelerates, and lands on the effect — then cross-fades into the existing hazard
card. The spin is **purely cosmetic**: the server has already decided and applied
the effect; the wheel only animates to that predetermined result.

- **Surface hazards** spin a wheel of the three generic effects (swamp gas,
  grasping vines, spore cloud) and land **truthfully** on the one the server
  rolled — genuine suspense.
- **Dungeon (depths) hazards** spin a wheel dominated by that lair's **boss
  silhouette**, salted with 1–2 "safe" decoy wedges, and are **rigged** to land
  on a boss wedge — the tease that you might dodge, then the curse lands anyway.

This reuses the pattern already established by the mystery-space slot reel
(`mystery-reel.component.ts`): route the space event through a spinner overlay
first, open the event card once it settles.

## Non-goals

- No change to hazard *rules* or *balance*. The wheel is presentation only.
- No new hazard effects. Wedges visualize the existing outcomes.
- No reduced-motion setting work beyond a short spin + tap-to-skip.

## Architecture

### Client

New standalone component **`HazardWheelComponent`**
(`src/app/undercity/tabs/hazard-wheel.component.ts`), a sibling of
`mystery-reel.component.ts`, rendered as a full-screen overlay.

Integration in `board-tab.component.ts` mirrors the mystery flow exactly:

- Add signal `hazardWheel = signal<HazardWheelTarget | null>(null)` and field
  `pendingHazardEv: SpaceEvent | null`.
- In `routeSpaceEvent`, add a branch **before** the fallback
  `spaceModal.set(ev)`:

  ```ts
  } else if (ev.type === 'hazard') {
    this.pendingHazardEv = ev;
    this.hazardWheel.set(this.hazardWheelTarget(ev));
  }
  ```

- `onWheelSettled()` (called by the component's settle event) opens the hazard
  card and tears down the wheel, matching `onReelSettled`:

  ```ts
  onWheelSettled(): void {
    if (this.pendingHazardEv) {
      this.spaceModal.set(this.pendingHazardEv);
      this.pendingHazardEv = null;
    }
    setTimeout(() => this.hazardWheel.set(null), 340);
  }
  ```

- Register `HazardWheelComponent` in the component `imports` and add its element
  to the template guarded by `@if (hazardWheel(); as target)`.

`hazardWheelTarget(ev)` maps the event to a wheel spec:

- Dungeon (`ev.biome` present) → `{ mode: 'dungeon', biome, bossId }` where
  `bossId = LAIR_GUARDIANS[`${biome}_lair`]` (from `data/items.ts`).
- Surface → `{ mode: 'surface', outcome: ev.hazardOutcome }` where outcome is one
  of `swamp_gas | vines | spore_cloud`.

### Server

`infrastructure/lambda/undercity_db.py` — report what already happened, no rules
change:

- Surface `_hazard`: stamp `out['hazardOutcome'] = kind` (the chosen
  `swamp_gas | vines | spore_cloud`). Currently the surface branches return
  early; refactor so each carries the outcome key.
- Dungeon `_dungeon_hazard`: stamp `out['biome'] = biome`.

Mirror both fields into the client `SpaceEvent` model
(`services/undercity-models.ts`): `hazardOutcome?: string`, `biome?: string`.

## The wheel component

### Visual

An **SVG radial wheel**: `WEDGE_COUNT = 8` equal wedges (SVG `<path>` slices)
inside a circle, with a fixed pointer triangle at the top (12 o'clock). A
rotating `<g transform="rotate(θ)">` holds the wedges and their symbols; the
pointer and rim are static overlays.

Each wedge shows a symbol at its mid-angle:

- **Surface:** Material-Icon glyph + tint per generic effect
  - `swamp_gas` → `air` (sickly green)
  - `vines` → `grass` (bog green)
  - `spore_cloud` → `cloud` (spore purple)
  - Wedges cycle these three around the ring so multiple faces of each exist.
- **Dungeon:** boss silhouette wedges show the guardian PNG
  (`undercity/guardians/<bossId>.png`) tinted to a black silhouette via CSS
  `filter: brightness(0)`; decoy wedges show a neutral `shield`/`check_circle`
  "safe" glyph. Composition: 6 boss wedges + 2 decoys (of 8).

### Behavior / rig

1. On init, build the wedge strip and pick a **target wedge index** whose symbol
   matches the server result:
   - Surface: a wedge whose effect == `outcome`.
   - Dungeon: any boss wedge (rigged; decoys are never the target).
2. Compute final rotation: `θ = SPINS * 360 + (pointerAngle − wedgeCenterAngle)`,
   with `SPINS = 4` full turns, so the target wedge ends under the pointer.
3. Animate `transform: rotate(θ)` via CSS transition,
   `cubic-bezier(0.16, 1, 0.3, 1)` (ease-out) over `SPIN_MS ≈ 1800`.
4. `transitionend` → brief win-flash on the landed wedge (~250ms) → emit
   `settled` (which triggers `onWheelSettled` cross-fade).
5. **Tap-to-skip:** tapping the overlay jumps the transition to its end
   (shortened duration) so the wheel never blocks flow.

### Constants

```ts
const WEDGE_COUNT = 8;
const SPINS = 4;
const SPIN_MS = 1800;
const FLASH_MS = 250;
const DUNGEON_DECOYS = 2; // remaining WEDGE_COUNT-DUNGEON_DECOYS are boss wedges
```

### Fallbacks / edge cases

- Boss art missing/not yet loaded → boss wedges render a skull glyph
  (`❌`/Material `dangerous`) instead of the image. The component preloads the
  PNG and swaps in when ready; a 404 stays on the glyph.
- Reduced motion / accessibility: spin is short and skippable; not gating the
  reveal behind animation.
- `spore_cloud` (dungeon) mutates position via `ev.to`; because biome comes from
  the server-stamped `ev.biome` (captured before/at resolution), the wheel still
  shows the correct lair boss.

## Data flow

```
land on hazard
  → server _hazard/_dungeon_hazard applies effect, returns SpaceEvent
      + hazardOutcome (surface) | biome (dungeon)
  → board-tab.routeSpaceEvent sees type==='hazard'
      → hazardWheelTarget(ev) → hazardWheel.set(target); stash pendingHazardEv
  → HazardWheelComponent spins, lands on target wedge, emits (settled)
  → onWheelSettled → spaceModal.set(pendingHazardEv) (existing hazard card)
      → wheel unmounts after cross-fade
```

## Testing

### Backend (`infrastructure/lambda/tests/`)

- `_hazard` surface: assert the returned event includes `hazardOutcome` in
  `{swamp_gas, vines, spore_cloud}` and that it matches the branch taken (drive
  each branch by monkeypatching `_rng.choice`).
- `_dungeon_hazard`: assert every signature hazard event includes `biome` equal
  to the pocket's biome.
- Keep the existing hazard assertions green.

### Frontend

- `npm run build` green (no unit-test runner in this repo).
- Manual/visual: drive into a surface hazard and a dungeon hazard, confirm the
  wheel spins and lands on the correct symbol, then the hazard card opens with
  the same text/deltas as today.

## Files touched

| File | Change |
|---|---|
| `infrastructure/lambda/undercity_db.py` | Stamp `hazardOutcome` (surface) + `biome` (dungeon) |
| `infrastructure/lambda/tests/test_undercity_db.py` | Assertions for the new fields |
| `src/app/undercity/tabs/hazard-wheel.component.ts` | **New** radial wheel overlay |
| `src/app/undercity/tabs/board-tab.component.ts` | Route hazard → wheel; `hazardWheelTarget`, `onWheelSettled` |
| `src/app/undercity/services/undercity-models.ts` | `hazardOutcome?`, `biome?` on `SpaceEvent` |

## Open questions

None outstanding — design approved 2026-07-30.
