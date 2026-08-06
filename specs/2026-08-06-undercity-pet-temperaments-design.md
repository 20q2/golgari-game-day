# Undercity — Companion Pet Temperaments

**Date:** 2026-08-06
**Status:** Approved, implementing inline

## Problem

The board follower pet (the little companion that trails your token, drawn in
`engine/board-canvas.ts` via `updateAndDrawPet`) uses a single hard-coded wander
profile for **every** pet. It rests 2.6–6s, then roams a 30px radius in fast
34px/150ms hops. Every companion therefore feels equally hyper — "flies around
like a little crazy guy." The player wants variety: some pets hyper, some calm,
driven by personality.

## Goal

Give each pet a **temperament** that scales *how* it idles, wanders, and hops on
the board. Purely client-side cosmetic animation — no server, data-model, or
balance changes.

## Decisions

- **Personality source: role.** Temperament is fixed per role (the 5 roles:
  attack / defend / forage / scout / economy). The client already resolves
  species → role via `petRole()`, so no new data is needed. Two species share a
  role and therefore a temperament — that's acceptable.
- **Expressiveness: full profile.** Each temperament varies all animation
  dimensions (wander frequency, roam radius, dwell, hop height, hop speed, hop
  step, idle breath), so temperaments read distinctly at a glance.
- **Following stays reliable.** Temperament only reshapes idle/wander/hop feel.
  The follow-the-owner logic is unchanged and always converges on the owner, so a
  Calm pet ambles behind rather than getting lost.

## Temperament → role mapping

| Role | Temperament | Feel |
|------|-------------|------|
| scout | **Zippy** | Hyper (today's "crazy" end): wanders often, wide roam, snappy bouncy hops. |
| attack | **Restless** | Twitchy darter: frequent short sharp hops, very quick, mid-range roam. |
| forage | **Busy** | Head-down digger: wanders often but in a tight radius with little steps near the owner's feet. |
| defend | **Steady** | Calm sentinel: rarely leaves the owner's side, slow deliberate hops, stays close. |
| economy | **Laid-back** | Lazy grazer: very rarely wanders, low slow hops, slow breathing. |

## Profile fields & values

Each temperament sets every field. Current module constants (the baseline near
the Zippy/Restless end) are shown for reference.

| Field | base | Zippy | Restless | Busy | Steady | Laid-back |
|-------|-----:|------:|---------:|-----:|-------:|----------:|
| `exploreMin` (ms) | 2600 | 1800 | 2200 | 2000 | 6000 | 7000 |
| `exploreMax` (ms) | 6000 | 3800 | 4500 | 4200 | 11000 | 13000 |
| `exploreRadius` (px) | 30 | 40 | 30 | 20 | 16 | 22 |
| `exploreDwell` (ms) | 2200 | 2600 | 1500 | 2600 | 2000 | 3000 |
| `hopDur` (ms, lower=snappier) | 150 | 120 | 105 | 140 | 185 | 200 |
| `hopHeight` (px) | 7 | 9 | 8 | 6 | 6 | 5 |
| `hopStep` (px) | 34 | 34 | 28 | 24 | 34 | 34 |
| `breathAmp` (px) | 0.6 | 1.0 | 1.1 | 0.8 | 0.5 | 0.4 |

## Implementation (2 files)

### `src/app/undercity/data/pets.ts`
- Add `interface TemperamentProfile` with the 7 fields above plus a `name`
  (display label: Zippy / Restless / Busy / Steady / Laid-back).
- Add `PET_TEMPERAMENTS: Record<PetRole, TemperamentProfile>` with the table.
- Add `petTemperament(species: PetSpecies): TemperamentProfile` (via `petRole`).

This lives client-side only; it does **not** mirror a server table (unlike the
rest of `pets.ts`), so note that in a comment.

### `src/app/undercity/engine/board-canvas.ts`
- `setActivePet(spriteUrl, temperament?)` — store the profile on a
  `private petProfile: TemperamentProfile | null` field. When it's null, fall
  back to today's module constants (so nothing breaks if a pet has no role).
- `updateAndDrawPet` reads the active profile's fields in place of the module
  constants: `PET_HOP_DUR`, `PET_HOP_HEIGHT`, `PET_HOP_STEP`, `PET_EXPLORE_MIN`,
  `PET_EXPLORE_MAX`, `PET_EXPLORE_RADIUS`, `PET_EXPLORE_DWELL`, and the idle
  breath amplitude (`0.6`). The shadow-shrink normalizer uses the profile's
  `hopHeight` so the effect stays proportional.
- The shared constants (`PET_REST_DIST`, `PET_FOLLOW_DX/DY`, `PET_DRAW_H`,
  `PET_DUST_SCALE`) are unchanged.

### `src/app/undercity/tabs/board-tab.component.ts`
- Pass `petTemperament(activePet.species)` as the new `setActivePet` argument.

## Testing / verification

No test runner is wired up for the frontend. Verify with `npm run build` (dev
build) for type/compile correctness, then eyeball on the board that scout/attack
pets are lively while defend/economy pets settle down. Deploy is the user's step.
