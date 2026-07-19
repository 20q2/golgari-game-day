# Undercity Crystal Vein — player agency + 3D boulder collapse

**Date:** 2026-07-19
**Status:** Design approved, pending implementation plan
**Area:** Undercity sub-game — the Crystal Vein "mining wall" minigame

## Summary

Two independent changes to the Crystal Vein facility (the shared shaft players
Strike to mine spores, with a rising cave-in risk):

1. **Agency fix (server):** stop auto-swinging the pick when a player *lands*
   on a vein node. Every strike — including the first — becomes a deliberate
   player action.
2. **3D boulders (client):** replace the flat CSS "rung" shaft visual with a
   `three.js` canvas that shows a mine-wall face. Striking dislodges a few
   boulders that tumble down; a cave-in triggers a full boulder cascade.

The two parts are independent and can ship/verify separately.

## Part A — Remove the auto-strike on landing

### Current behavior

`undercity_db._resolve_space`, the `crystal_vein` branch
(`infrastructure/lambda/undercity_db.py`, ~line 1504) currently:

- sets `doc['veinStrikesLeft'] = VEIN_STRIKES_PER_VISIT` (3), then
- immediately calls `_vein_strike_once(...)`, which spends one strike, awards
  spores for the level entered, and **can trigger a cave-in** (damage + shaft
  collapse) before the player has interacted at all.

The landing event text reads "your pick is already swinging". The player
arrives to a fait accompli — including taking cave-in damage on arrival.

### New behavior

Landing **opens** the shaft without swinging:

- Set `doc['veinStrikesLeft'] = VEIN_STRIKES_PER_VISIT` (all 3 are now optional
  player swings).
- Do **not** call `_vein_strike_once`. No spores awarded, no cave-in on arrival.
- Return the event with the current *shared* depth read from the VEIN# record
  (`_vein_rec`), `strikesLeft = VEIN_STRIKES_PER_VISIT`, and text along the
  lines of: `"You reach the crystal vein — ready your pick."`

All three swings happen through the existing `strike` action / ⛏️ Strike
button, which already guards on `veinStrikesLeft` and runs `_vein_strike_once`.

### Ripple edits

- `_strike` docstring ("Optional strikes 2-3 at the vein (the first happens on
  landing).") — reword: all strikes are optional.
- Client comment in `board-tab.component.ts` (~line 514): "the first is spent on
  landing" — remove.
- Landing event text (server) as above.

### Test changes

`infrastructure/lambda/tests/test_undercity_db.py`:

- `test_vein_landing_forces_first_strike` — rewrite (and rename, e.g.
  `test_vein_landing_opens_without_striking`) to assert:
  - `ev['type'] == 'crystal_vein'`
  - `ev['depth']` equals the shared shaft depth (0 on a fresh cavern)
  - `ev['strikesLeft'] == data.VEIN_STRIKES_PER_VISIT`
  - `doc['spores']` is **unchanged** from before landing
  - no `collapsed` flag / no HP loss
- `test_vein_strike_action_and_guards`, `test_vein_cave_in_hurts_and_resets`,
  `test_vein_heartstone_pays_and_resets` — these already drive `strike`
  directly with an explicit `veinStrikesLeft`, so they should stay green
  unchanged. Confirm during implementation.

Verify with `cd infrastructure/lambda && python -m pytest tests -q`.

### Balance note

Effective swings per visit change from "1 forced + 2 optional" to "3 optional",
and the forced cave-in risk on arrival is removed. `VEIN_STRIKES_PER_VISIT`
stays 3 (both the server value in `undercity_data.py` and the client mirror in
`src/app/undercity/data/vein-vault.ts` are unchanged). This is the intended
effect of the change (agency), noted here because it is a live balance number.

## Part B — 3D boulders in the Crystal Vein modal

### Dependency

- Add `three` (dependency) and `@types/three` (devDependency) to
  `package.json`.
- Import three.js via **dynamic `import('three')`** inside the vein canvas
  module so the bundler emits it as a separate lazy chunk that only downloads
  when a player first opens a vein. It must not enter the main bundle or the
  initial Undercity chunk.

### New engine module: `src/app/undercity/engine/vein-canvas.ts`

A plain TypeScript class (`VeinCanvas`), Angular-free, in the same style as the
existing `engine/board-canvas.ts` and `engine/sprite-engine.ts`. It owns its own
`requestAnimationFrame` loop and all three.js objects.

Public API (driven by the component):

- `mount(canvas: HTMLCanvasElement): Promise<boolean>` — lazy-loads three,
  builds the scene, starts the loop. Returns `false` if WebGL/three is
  unavailable (so the component can fall back to CSS).
- `resize(): void` — handle container/DPR changes.
- `dispose(): void` — stop the loop, dispose geometries/materials/renderer.
- `setDepth(depth: number, max: number): void` — recede the wall face and
  reveal more embedded crystals as the shared shaft deepens.
- `playStrike(): void` — pick bites the wall, brief camera shake, **a few small
  boulders dislodge and tumble down** on scripted parabola + spin (~1s).
- `playCaveIn(): void` — full cascade: many low-poly boulders rain from the top
  with dust and a hard shake, then the wall resets to the surface.
- `playHeartstone(): void` — a large crystal rises and glints (max-depth win).

Visual style: low-poly flat-shaded rock meshes (jittered icosahedron geometry),
a teal crystal glow matching the vein palette (`#8fd0dd`). Ambient + one
directional light + a tinted point light. No physics engine — all motion is
deterministic time-based tweens with fixed easing.

### Component wiring: `src/app/undercity/tabs/crystal-vein.component.ts`

- Replace the `.shaft` rung `<div>` with a `<canvas #veinCanvas>` element.
- The component gains `AfterViewInit` (mount), `OnDestroy` (dispose), and
  `OnChanges`:
  - on `depth` change → `setDepth(depth, MAX)`
  - on a new `effect` input (below) → play the matching animation
- New input to tell the canvas *which* animation to play:
  `@Input() effect: { kind: 'strike' | 'cave-in' | 'heartstone'; seq: number } | null`
  The `seq` counter makes repeat kinds retrigger (`OnChanges` fires on identity
  change; a bumped counter guarantees a change even for two strikes in a row).
- One-way data flow only — no `ViewChild` reach-in from the parent.

### Parent wiring: `src/app/undercity/tabs/board-tab.component.ts`

- Add a `veinEffect` signal seeded `null`, bound to the component's `effect`
  input.
- In `strike()`, after the server responds, set `veinEffect` from `resp`:
  - `resp.collapsed` → `{ kind: 'cave-in', seq: ++n }`
  - `resp.heartstone` → `{ kind: 'heartstone', seq: ++n }`
  - otherwise → `{ kind: 'strike', seq: ++n }`
  `resp.depth` already flows to the existing `veinDepth` signal / `depth` input.

### Graceful fallback

Keep the existing CSS rung shaft markup in the template inside an `@if`
fallback, shown when `mount()` returns `false` (no WebGL / three failed to
load). The modal must remain fully playable on a low-end phone with the Strike
button, odds text, and Leave button intact.

## Non-goals

- No physics engine (`cannon-es` or similar).
- No changes to vein balance numbers, loot tables, or the heartstone reward.
- No 3D in the separate grid Dig Site (Excavation) — this is Crystal Vein only.
- No multiplayer/spectator rendering of the 3D scene; it is local to the
  acting player's modal.

## Verification

- `npm run build` (repo lint is unreliable — build is the source of truth).
- `cd infrastructure/lambda && python -m pytest tests -q` for Part A.
- Manual: start the app, land on a cavern crystal-vein node, confirm no strike
  is auto-spent, then Strike and watch boulders fall; force a deep shaft to
  observe a cave-in cascade and the fallback path with WebGL disabled.
