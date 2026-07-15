# Undercity Player-Sprite Region Masks Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Replace the per-sprite HSV region classifiers for the four finished player sprites (`pest`, `insect`, `saproling`, `zombie`) with hand-authored flat-color PNG masks the artist edits in Photoshop.

**Architecture:** A mask only answers "which region does this pixel belong to"; the recolor math (hue-shift each region while preserving the sprite's own S/V) is unchanged. The engine prefers `<name>.mask.png` when present and falls back to the existing classifiers (kept for the Dino placeholder apexes). A dev-only export button bootstraps each mask from the current classifier output so the artist refines rather than paints from scratch.

**Tech Stack:** Angular 20 standalone components, TypeScript, HTML5 canvas `getImageData`/`putImageData`. No frontend test runner is wired up in this repo (per CLAUDE.md), so verification is a production build plus driving the dev-only color-test sandbox at `/undercity/color-test`.

**Reference spec:** [specs/2026-07-15-undercity-sprite-masks-design.md](specs/2026-07-15-undercity-sprite-masks-design.md)

---

## Mask format (shared reference for all tasks)

A `<name>.mask.png` is the same pixel dimensions as its sprite. Flat index colors, anti-aliasing off:

| Mask color | Region index | Meaning |
| --- | --- | --- |
| pure red `(255,0,0)` | 0 | body |
| pure green `(0,255,0)` | 1 | belly |
| pure blue `(0,0,255)` | 2 | stripes |
| pure white `(255,255,255)` | 0 (body) | hat anchor — recolors as body; also marks the hat position |
| black or transparent | — | untouched (outline / background) |

Classification is dominant-channel with tolerance: transparent → untouched; all channels high → white (anchor); max channel below a floor → untouched (black); otherwise the region is the index of the dominant channel.

---

## Task 1: Export-region-mask button in the color-test sandbox (bootstrap)

This runs **first**, while the classifiers still exist, so the artist can export a correct-ish starting mask for each sprite before the classifiers are deleted.

**Files:**
- Modify: `src/app/undercity/color-test/color-test.component.ts`
- Modify: `src/app/undercity/color-test/color-test.component.html`

- [ ] **Step 1: Add the `exportMask()` method**

In `src/app/undercity/color-test/color-test.component.ts`, add this method to the `ColorTestComponent` class (e.g. after `reset()` around line 190). It rebuilds the region map from the current classifier, paints pure mask colors (transparent elsewhere, white for any baked red hat-anchor pixel), and downloads `<sprite>.mask.png`:

```ts
  /**
   * Export a flat-color region mask PNG for the selected sprite (see
   * specs/2026-07-15-undercity-sprite-masks-design.md). Bootstraps an authorable
   * mask from the current classifier output: pure red/green/blue per region,
   * white for a baked hat-anchor pixel, transparent elsewhere. Uploads (no
   * sprite key) are skipped.
   */
  exportMask(): void {
    const img = this.currentImage();
    const key = this.spriteKey();
    if (!img || !key) return;
    const w = img.naturalWidth || img.width;
    const h = img.naturalHeight || img.height;
    const off = document.createElement('canvas');
    off.width = w;
    off.height = h;
    const octx = off.getContext('2d')!;
    octx.drawImage(img, 0, 0);
    const src = octx.getImageData(0, 0, w, h).data;
    const regionMap = buildRegionMap(src, w, h, classifierFor(key));

    const maskData = octx.createImageData(w, h);
    const md = maskData.data;
    const PURE: Record<number, [number, number, number]> = {
      0: [255, 0, 0],
      1: [0, 255, 0],
      2: [0, 0, 255],
    };
    for (let p = 0; p < regionMap.length; p++) {
      const i = p * 4;
      // Baked hat-anchor pixel on the sprite → white in the mask.
      if (src[i] === 255 && src[i + 1] === 0 && src[i + 2] === 0 && src[i + 3] >= 128) {
        md[i] = 255;
        md[i + 1] = 255;
        md[i + 2] = 255;
        md[i + 3] = 255;
        continue;
      }
      const region = regionMap[p];
      if (region >= 0 && src[i + 3] >= 128) {
        const [r, g, b] = PURE[region];
        md[i] = r;
        md[i + 1] = g;
        md[i + 2] = b;
        md[i + 3] = 255;
      } else {
        md[i + 3] = 0; // transparent = untouched
      }
    }
    octx.putImageData(maskData, 0, 0);
    off.toBlob((blob) => {
      if (!blob) return;
      const url = URL.createObjectURL(blob);
      const a = document.createElement('a');
      a.href = url;
      a.download = `${key}.mask.png`;
      a.click();
      URL.revokeObjectURL(url);
    });
  }
```

- [ ] **Step 2: Add the button to the template**

In `src/app/undercity/color-test/color-test.component.html`, add an export button inside the `.toggles` div (after the "Reset hues" button on line 50):

```html
        <button class="btn" (click)="reset()">Reset hues</button>
        <button class="btn" (click)="exportMask()">Export region mask</button>
```

- [ ] **Step 3: Build to verify it compiles**

Run: `npm run build`
Expected: build succeeds with no TypeScript errors. (`buildRegionMap` and `classifierFor` are already imported at the top of the component — line 13.)

- [ ] **Step 4: Drive the sandbox and export the four masks**

Run `npm start`, open `http://localhost:4200/undercity/color-test`. For each of `pest`, `insect`, `zombie`, `saproling`: select the sprite, click "Show region mask" to sanity-check the segmentation, then click "Export region mask". Confirm a `<name>.mask.png` downloads with flat red/green/blue regions on a transparent field.

- [ ] **Step 5: Commit**

```bash
git add src/app/undercity/color-test/color-test.component.ts src/app/undercity/color-test/color-test.component.html
git commit -m "feat(undercity): export-region-mask button in color-test sandbox"
```

---

## Task 2: Save the authored masks into the sprite folder (manual/art step)

**Files:**
- Create: `public/undercity/player_sprites/pest.mask.png`
- Create: `public/undercity/player_sprites/insect.mask.png`
- Create: `public/undercity/player_sprites/zombie.mask.png`
- Create: `public/undercity/player_sprites/saproling.mask.png`

- [ ] **Step 1: Place the exported masks**

Move the four PNGs exported in Task 1 into `public/undercity/player_sprites/`, named exactly `<sprite>.mask.png` (matching the sprite asset key, e.g. `insect.mask.png` accompanies `insect.png`).

- [ ] **Step 2: (Optional) Refine in Photoshop**

Open each mask alongside its sprite and touch up region boundaries with a hard-edged pencil/bucket (anti-aliasing off). Keep the four flat colors pure. Add a white pixel/small blob where the hat should anchor if desired.

- [ ] **Step 3: Verify dimensions match**

Each `<name>.mask.png` must be the exact pixel dimensions of its `<name>.png`. (The engine falls back to the classifier if they differ — Task 3 — but the intent is an exact match.)

- [ ] **Step 4: Commit**

```bash
git add public/undercity/player_sprites/pest.mask.png public/undercity/player_sprites/insect.mask.png public/undercity/player_sprites/zombie.mask.png public/undercity/player_sprites/saproling.mask.png
git commit -m "assets(undercity): region masks for player sprites"
```

---

## Task 3: Engine loads and prefers masks

Add mask loading + a mask-based region map + mask-based hat anchor to the sprite engine. Classifiers stay in place for now so nothing breaks if a mask is missing or mis-sized.

**Files:**
- Modify: `src/app/undercity/engine/sprite-engine.ts`

- [ ] **Step 1: Add the `maskImages` store and an image-data helper**

In `src/app/undercity/engine/sprite-engine.ts`, next to the `rawImages` declaration (line 30), add:

```ts
const maskImages: Record<string, HTMLImageElement> = {};

/** Read an image's pixels into a fresh canvas. */
function imageDataOf(img: HTMLImageElement): { data: Uint8ClampedArray; w: number; h: number } {
  const w = img.naturalWidth || img.width;
  const h = img.naturalHeight || img.height;
  const c = document.createElement('canvas');
  c.width = w;
  c.height = h;
  const ctx = c.getContext('2d')!;
  ctx.drawImage(img, 0, 0);
  return { data: ctx.getImageData(0, 0, w, h).data, w, h };
}
```

- [ ] **Step 2: Add `buildRegionMapFromMask`**

Add this exported function after `buildRegionMap` (after line 212). No smoothing — the mask is authored precisely:

```ts
/**
 * Region map from an authored flat-color mask (see
 * specs/2026-07-15-undercity-sprite-masks-design.md). Dominant-channel with
 * tolerance so anti-aliased fringes fall back to untouched rather than
 * misclassifying: transparent → -2; all-high → white = hat anchor, recolored as
 * body (0); max channel below a floor → -1 (black outline); otherwise the region
 * is the dominant channel (red→0, green→1, blue→2).
 */
export function buildRegionMapFromMask(data: Uint8ClampedArray, w: number, h: number): Int8Array {
  const n = w * h;
  const out = new Int8Array(n);
  for (let i = 0; i < n; i++) {
    const j = i * 4;
    if (data[j + 3] < 128) {
      out[i] = -2;
      continue;
    }
    const r = data[j],
      g = data[j + 1],
      b = data[j + 2];
    if (r > 180 && g > 180 && b > 180) {
      out[i] = 0; // white = hat anchor, recolored as body
      continue;
    }
    const max = Math.max(r, g, b);
    if (max < 60) {
      out[i] = -1; // black outline
      continue;
    }
    out[i] = r === max ? 0 : g === max ? 1 : 2;
  }
  return out;
}
```

- [ ] **Step 3: Load masks in `preloadAll`**

In `preloadAll` (line 280), after the `sprites` array is declared (line 292), add an optional mask-load array. A failed mask load is swallowed — a missing mask means classifier fallback:

```ts
  // Optional authored region masks (undercity/player_sprites/<key>.mask.png).
  // Missing masks are fine — those sprites use their classifier instead.
  const masks = ALL_SPRITES.map(async (key) => {
    try {
      maskImages[key] = await loadImage(`undercity/player_sprites/${key}.mask.png`);
    } catch {
      /* no mask for this sprite — classifier fallback */
    }
  });
```

Then add `...masks` to the `Promise.all` on line 306:

```ts
  loadPromise = Promise.all([...sprites, ...masks, bg, iconFont]).then(() => undefined);
```

- [ ] **Step 4: Prefer the mask in `regionMapFor`**

Replace the body of `regionMapFor` (lines 321-335) with a version that uses the mask when it is loaded and dimensionally matches the sprite, else the classifier:

```ts
function regionMapFor(sprite: string, img: HTMLImageElement): Int8Array {
  const cached = regionMapCache.get(sprite);
  if (cached) return cached;
  const iw = img.naturalWidth || img.width;
  const ih = img.naturalHeight || img.height;
  const mask = maskImages[sprite];
  let map: Int8Array;
  if (mask) {
    const md = imageDataOf(mask);
    if (md.w === iw && md.h === ih) {
      map = buildRegionMapFromMask(md.data, md.w, md.h);
    } else {
      console.warn(`Mask for ${sprite} is ${md.w}×${md.h} but sprite is ${iw}×${ih}; using classifier.`);
      map = buildRegionMap(imageDataOf(img).data, iw, ih, CUSTOM_CLASSIFIERS[sprite] ?? classifyPixel);
    }
  } else {
    map = buildRegionMap(imageDataOf(img).data, iw, ih, CUSTOM_CLASSIFIERS[sprite] ?? classifyPixel);
  }
  regionMapCache.set(sprite, map);
  return map;
}
```

- [ ] **Step 5: Use the mask's white blob as the hat anchor**

Replace `getHatAnchor` (lines 371-393) so it first tries the mask's white pixels (their centroid), then the existing baked-red-pixel scan on the sprite, then the default:

```ts
/** Head anchor: mask white-blob centroid, else the sprite's pure-red marker, else default. */
export function getHatAnchor(sprite: string): { x: number; y: number } {
  if (sprite in anchorCache) return anchorCache[sprite] ?? { x: 16, y: 6 };

  const mask = maskImages[sprite];
  if (mask) {
    const { data, w } = imageDataOf(mask);
    let sx = 0,
      sy = 0,
      count = 0;
    for (let i = 0; i < data.length; i += 4) {
      if (data[i] > 180 && data[i + 1] > 180 && data[i + 2] > 180 && data[i + 3] >= 128) {
        const p = i / 4;
        sx += p % w;
        sy += Math.floor(p / w);
        count++;
      }
    }
    if (count > 0) {
      anchorCache[sprite] = { x: Math.round(sx / count), y: Math.round(sy / count) };
      return anchorCache[sprite]!;
    }
  }

  const img = rawImages[sprite];
  if (!img) return { x: 16, y: 6 };
  const { data, w } = imageDataOf(img);
  for (let i = 0; i < data.length; i += 4) {
    if (data[i] === 255 && data[i + 1] === 0 && data[i + 2] === 0 && data[i + 3] >= 128) {
      const p = i / 4;
      anchorCache[sprite] = { x: p % w, y: Math.floor(p / w) };
      return anchorCache[sprite]!;
    }
  }
  anchorCache[sprite] = null;
  return { x: 16, y: 6 };
}
```

- [ ] **Step 6: Build to verify it compiles**

Run: `npm run build`
Expected: build succeeds. Note the existing `getHatAnchor` and `regionMapFor` inline their own canvas reads; those are now replaced by `imageDataOf`, so confirm no unused-variable or duplicate-declaration errors.

- [ ] **Step 7: Drive the board/plaza to verify recolor + anchor**

Run `npm start`, enter Undercity, and confirm each of the four player forms (`pest`→ Pest, `kraul`→ insect, `saproling`, `zombie`) recolors per region on the board/plaza and the hat sits at the mask anchor. Compare against the pre-change look — regions should match the authored masks.

- [ ] **Step 8: Commit**

```bash
git add src/app/undercity/engine/sprite-engine.ts
git commit -m "feat(undercity): recolor player sprites from authored masks"
```

---

## Task 4: Color-test sandbox displays the authored masks

So the sandbox segments the four sprites the same way the board does (mask-preferred), matching engine parity.

**Files:**
- Modify: `src/app/undercity/color-test/color-test.component.ts`

- [ ] **Step 1: Import `buildRegionMapFromMask`**

Update the import on line 13 of `src/app/undercity/color-test/color-test.component.ts`:

```ts
import { classifierFor, buildRegionMap, buildRegionMapFromMask } from '../engine/sprite-engine';
```

- [ ] **Step 2: Add a per-sprite mask cache and loader**

Add a field near `imageCache` (line 109):

```ts
  // Authored masks loaded on demand for the selected sprite (null once a fetch fails).
  private readonly maskCache = new Map<string, HTMLImageElement | null>();
  private readonly currentMask = signal<HTMLImageElement | null>(null);
```

In the constructor's first `effect` (the image loader, lines 122-137), after the image is resolved, also resolve the mask for the current sprite key. Add this as a **second** `effect` right after it (before the redraw effect on line 140):

```ts
    // Load the authored mask for the selected sprite key (if any), so the
    // sandbox segments exactly like the board. Uploads (null key) never have one.
    effect(() => {
      const key = this.spriteKey();
      if (!key) {
        this.currentMask.set(null);
        return;
      }
      if (this.maskCache.has(key)) {
        this.currentMask.set(this.maskCache.get(key)!);
        return;
      }
      const img = new Image();
      img.onload = () => {
        this.maskCache.set(key, img);
        this.currentMask.set(img);
      };
      img.onerror = () => {
        this.maskCache.set(key, null);
        this.currentMask.set(null);
      };
      img.src = `undercity/player_sprites/${key}.mask.png`;
    });
```

- [ ] **Step 3: Track the mask in `regionCache`**

The existing `regionCache` (lines 105-108) keys only on `img`, so a mask arriving *after* the image would be ignored (`regionCache.img === img` skips the rebuild). Add `mask` to the cache so it invalidates when the mask loads. Replace the field with:

```ts
  private regionCache: {
    img: HTMLImageElement | null;
    mask: HTMLImageElement | null;
    map: Int8Array | null;
  } = { img: null, mask: null, map: null };
```

- [ ] **Step 4: Re-render when the mask changes, and use it in `render`**

Add `this.currentMask();` to the redraw effect's dependency reads (in the effect starting line 140, alongside `this.spriteKey();`):

```ts
      this.spriteKey(); // re-render when the classifier changes
      this.currentMask(); // re-render when the authored mask loads
```

Then in `render` (lines 202-281), replace the region-map build block (lines 221-224) with this — a loaded, dimension-matching mask wins over the classifier, and the cache invalidates on either `img` or `mask` changing:

```ts
    // Prefer the authored mask (board parity); else the smoothed classifier map.
    const mask = this.currentMask();
    if (this.regionCache.img !== img || this.regionCache.mask !== mask) {
      let map: Int8Array;
      if (mask && (mask.naturalWidth || mask.width) === w && (mask.naturalHeight || mask.height) === h) {
        const mc = document.createElement('canvas');
        mc.width = w;
        mc.height = h;
        const mctx = mc.getContext('2d')!;
        mctx.drawImage(mask, 0, 0);
        map = buildRegionMapFromMask(mctx.getImageData(0, 0, w, h).data, w, h);
      } else {
        map = buildRegionMap(data, w, h, classifierFor(this.spriteKey()));
      }
      this.regionCache = { img, mask, map };
    }
```

(The `const regionMap = this.regionCache.map!;` line right after the old block stays.)

- [ ] **Step 5: Build to verify it compiles**

Run: `npm run build`
Expected: build succeeds, no unused-import or type errors.

- [ ] **Step 6: Drive the sandbox to confirm mask parity**

Run `npm start`, open `/undercity/color-test`, select each masked sprite, toggle "Show region mask", and confirm the regions shown match the authored mask (not the old classifier). Select a non-masked placeholder (e.g. `spino`) and confirm it still segments via the classifier. Upload an arbitrary image and confirm it still uses the default classifier (no crash).

- [ ] **Step 7: Commit**

```bash
git add src/app/undercity/color-test/color-test.component.ts
git commit -m "feat(undercity): color-test sandbox segments from authored masks"
```

---

## Task 5: Delete the four custom player classifiers

Now that the four player sprites recolor from masks, remove their bespoke classifiers. Keep `classifyPixel` (green-marker) and `classifyGodzillaPixel` for the Dino apexes.

**Files:**
- Modify: `src/app/undercity/engine/sprite-engine.ts`

- [ ] **Step 1: Remove the four classifier functions**

In `src/app/undercity/engine/sprite-engine.ts`, delete `classifyPestPixel` (lines 68-75), `classifyInsectPixel` (79-87), `classifyZombiePixel` (91-99), and `classifySaprolingPixel` (102-111), along with their leading comment blocks.

- [ ] **Step 2: Trim `CUSTOM_CLASSIFIERS`**

Reduce the `CUSTOM_CLASSIFIERS` map (lines 18-28) to just the surviving godzilla entry, and update its comment:

```ts
const CUSTOM_CLASSIFIERS: Record<string, Classifier> = {
  godzilla: classifyGodzillaPixel,
};
```

- [ ] **Step 3: Update the file header comment**

The module header (lines 1-11) describes the green-marker convention and is still accurate for the fallback path. Add one line noting masks take precedence, e.g. after line 10:

```ts
 * Player sprites with an authored <name>.mask.png (undercity/player_sprites/)
 * are segmented from that mask instead of a classifier — see buildRegionMapFromMask.
```

- [ ] **Step 4: Build to verify it compiles**

Run: `npm run build`
Expected: build succeeds with no "unused function" or missing-reference errors. `classifierFor` still returns `classifyPixel` for the now-classifier-less player sprites, which is only used as the fallback when a mask is absent.

- [ ] **Step 5: Drive the board once more**

Run `npm start`, enter Undercity, and confirm the four player forms still recolor correctly (they now depend solely on their masks). Temporarily rename one mask file to confirm the green-marker fallback still produces *something* (not a crash) for a mask-less player sprite, then restore it.

- [ ] **Step 6: Commit**

```bash
git add src/app/undercity/engine/sprite-engine.ts
git commit -m "refactor(undercity): drop per-sprite player classifiers now masks exist"
```

---

## Task 6: Final verification

**Files:** none (verification only)

- [ ] **Step 1: Production build**

Run: `npm run build:prod`
Expected: build succeeds and `flatten-build` completes without error.

- [ ] **Step 2: Full sandbox + board sweep**

Run `npm start`. In `/undercity/color-test`, verify all four masked sprites segment and recolor from their masks and the placeholder Dino sprites still segment via classifier. In Undercity proper, verify the four player forms recolor per region and hats sit at the mask anchors.

- [ ] **Step 3: Confirm no stray references**

Run: `git grep -n "classifyPestPixel\|classifyInsectPixel\|classifyZombiePixel\|classifySaprolingPixel"`
Expected: no matches.

- [ ] **Step 4: Note deploy**

Per repo convention, the user runs deploys. End with the build green and note that a `npm run deploy` is needed to publish.
