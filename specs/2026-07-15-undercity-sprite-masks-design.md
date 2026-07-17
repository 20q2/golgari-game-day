# Undercity player-sprite region masks

**Date:** 2026-07-15
**Status:** Design approved, pending implementation plan

## Problem

Player sprites are recolored by hue-shifting per-region: the wardrobe supplies a
target hue per region (body / belly / stripes), the sprite art supplies each
pixel's saturation and value, and a *classifier* decides which region each pixel
belongs to. Today that classifier is hand-tuned HSV logic per sprite
(`classifyPestPixel`, `classifyInsectPixel`, `classifyZombiePixel`,
`classifySaprolingPixel` in `src/app/undercity/engine/sprite-engine.ts`), plus a
majority-smoothing pass (`buildRegionMap`) to kill salt-and-pepper strays.

This means region boundaries are decided by computer vision that has to be
re-tuned by hand whenever the art changes, and the author cannot directly say
"this area is the belly." We want region assignment to be **authored in
Photoshop** as an explicit mask image, editable at will.

## Goal

Replace the programmatic region classification for the four finished player
sprites (`pest`, `insect`, `saproling`, `zombie`) with hand-authored PNG masks.
The recolor pipeline is otherwise unchanged — a mask only answers *"which region
does this pixel belong to."* The sprite art still supplies shading (S/V); the
wardrobe still supplies the target hue.

The Dino Party placeholder apexes (`spino`, `pachy`, `parasaur`, `diplo`,
`godzilla`) keep their existing classifiers until real Golgari art replaces
them, so the change is a hybrid: mask when present, classifier otherwise.

## Mask file spec

- **Location / name:** `public/undercity/player_sprites/<name>.mask.png`, same
  pixel dimensions as the sprite it accompanies.
- **Encoding — flat index colors.** Author with anti-aliasing **off**
  (pencil / bucket fill, hard edges):

  | Mask color              | Meaning                                   |
  | ----------------------- | ----------------------------------------- |
  | pure red `(255,0,0)`    | region 0 — body                           |
  | pure green `(0,255,0)`  | region 1 — belly                          |
  | pure blue `(0,0,255)`   | region 2 — stripes                        |
  | pure white `(255,255,255)` | hat anchor (centroid of the white blob) |
  | black or transparent    | untouched (outline / background)          |

- **Classification is dominant-channel with tolerance**, so minor PNG edge
  artifacts don't matter:
  - alpha `< 128` → untouched (`-2` transparent).
  - all three channels high (min channel `> ~180`) → hat anchor.
  - max channel below a floor (`< ~60`) → untouched (black outline).
  - otherwise the region is the index of the dominant channel
    (R → 0, G → 1, B → 2).
  - These thresholds are tunable; the intent is that clean flat colors classify
    exactly and anti-aliased fringes fall back to untouched rather than
    misclassifying.
- Sprites with only two regions (e.g. `insect`: body + belly) simply never use
  the blue color. The region *names* still come from `species.ts`; the mask's
  color→index mapping (red=0, green=1, blue=2) lines up with the ordered
  `regions` array there.
- Masks are authored precisely, so **no majority-smoothing** is applied to the
  mask path. `buildRegionMap`'s smoothing stays only on the classifier-fallback
  path used by the Dino apexes.

## Engine changes

All in `src/app/undercity/engine/sprite-engine.ts` unless noted.

- **Preload:** `preloadAll` additionally attempts to load
  `undercity/player_sprites/<name>.mask.png` for each player sprite into a new
  `maskImages: Record<string, HTMLImageElement>` map. A mask is **optional** —
  a load failure just means that sprite uses the classifier fallback.
- **Region map source:** `regionMapFor(sprite, img)` becomes:
  - if a mask image is loaded for `sprite` → build the region map from the mask
    via a new `buildRegionMapFromMask(maskData, w, h)` (no smoothing).
  - else → the current classifier + `buildRegionMap` path.
  - The existing `regionMapCache` still keys by sprite (region maps are
    paint-independent), so this is a one-time build per sprite either way.
- **Hat anchor:** `getHatAnchor(sprite)` becomes:
  - if the sprite's mask has white pixels → return their centroid (average x/y).
  - else → the current pure-red-pixel scan on the sprite art.
  - else → the default `{ x: 16, y: 6 }`.
- **Delete** the four custom player classifiers (`classifyPestPixel`,
  `classifyInsectPixel`, `classifyZombiePixel`, `classifySaprolingPixel`) and
  their entries in `CUSTOM_CLASSIFIERS`. Keep `classifyPixel` (green-marker) and
  `classifyGodzillaPixel` for the Dino apexes.
- **Color-test sandbox** (`src/app/undercity/color-test/color-test.component.ts`)
  segments through the same `regionMapFor` / `classifierFor` path, so it picks
  up masks automatically. Verify it still renders region overlays correctly for
  masked sprites.

## Bootstrap workflow

So the author refines rather than paints from scratch:

- Add a **dev-only "Export region mask" button** to the color-test sandbox that
  runs the *current* classifier output for the selected sprite and downloads a
  flat-color `<name>.mask.png` (red/green/blue per region, transparent
  elsewhere; the hat anchor, if any, painted white).
- The author saves the exported PNG into `public/undercity/player_sprites/`,
  then refines it in Photoshop.
- This captures the existing hand-tuned segmentation as a correct-ish starting
  point *before* the classifiers are deleted, and gives a per-sprite mask to
  edit rather than a blank canvas.

Order of operations: add the export button → export all four masks → save them
→ (optionally refine in Photoshop) → switch the engine to the mask path →
delete the four classifiers.

## Testing / verification

- No frontend test runner is wired up in this repo (per CLAUDE.md), so
  verification is: a production build (`npm run build:prod`) succeeding, plus
  driving the color-test sandbox to confirm each masked sprite recolors per
  region and the hat sits at the mask anchor.
- Backend / pytest suite is untouched by this change.

## Out of scope

- Masks for the Dino placeholder apexes (they keep classifiers).
- Soft/gradient region blending (flat index colors only).
- Any change to the recolor math (hue-shift preserving S/V) or the wardrobe.
