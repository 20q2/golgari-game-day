/**
 * Sprite engine — TypeScript port of Dino Party's spriteEngine.js.
 *
 * Loads pixel-art sprites by URL (base-href relative, from public/undercity/)
 * and recolors them by hue-shifting green marker regions:
 *   region 0 (primary/body):    hue ≈ 85–135, v > 50%
 *   region 1 (secondary/belly): hue ≈ 50–80 (yellow-green highlights)
 *   region 2 (accent/stripes):  hue ≈ 85–135, v 28–50% (darker shading)
 * Outline pixels (v < 28%) are untouched. A pure-red (255,0,0) pixel marks
 * the hat anchor and is repainted as body color.
 */
import { rgbToHsv, hsvToRgb } from './colors';
import { ALL_SPRITES } from '../data/species';
import { HATS, HatInfo, NEUTRAL_BANDS } from '../data/cosmetics';

type Classifier = (r: number, g: number, b: number, a: number) => number;

/**
 * Recolor a single pixel by a paint value. A value ≥ 0 is a hue: shift hue and
 * keep the pixel's own saturation/brightness (the classic marker recolor). A
 * value < 0 is an achromatic sentinel (see NEUTRAL_BANDS in cosmetics.ts):
 * force saturation to 0 and remap the pixel's brightness into the paint's band,
 * so the region turns greyscale while keeping its light-and-shadow.
 */
export function paintedRgb(r: number, g: number, b: number, value: number): [number, number, number] {
  const hsv = rgbToHsv(r, g, b);
  if (value >= 0) return hsvToRgb(value, hsv.s, hsv.v);
  const band = NEUTRAL_BANDS[value];
  if (!band) return hsvToRgb(0, 0, hsv.v); // unknown sentinel → plain desaturate
  const [lo, hi] = band;
  return hsvToRgb(0, 0, lo + hsv.v * (hi - lo));
}

const CUSTOM_CLASSIFIERS: Record<string, Classifier> = {
  godzilla: classifyGodzillaPixel,
  // Full-colour player art (undercity/player_sprites/) — segmented by their real
  // hues, not the green-marker convention classifyPixel assumes. Region order is
  // 0=body (primary), 1=belly (secondary), 2=stripes (accent), matching the
  // ['body','belly','stripes'] regions in species.ts and the wardrobe paints.
  pest: classifyPestPixel,
  insect: classifyInsectPixel,
  zombie: classifyZombiePixel,
  saproling: classifySaprolingPixel,
};

// Legacy Dino-Party placeholder art that recolours via the default green-marker
// classifier despite shipping no authored mask. Every real sprite is segmented
// by its <key>.mask.png; a maskless sprite that isn't listed here (and has no
// custom classifier) can't be split into body/belly/stripes without garbling
// full-colour art, so canRecolor() leaves it untouched until its mask lands.
const GREEN_MARKER_SPRITES = new Set(['diplo']);

/** Whether a sprite can be segmented for recolouring: it has an authored mask,
 *  a custom classifier, or is a known green-marker placeholder. */
function canRecolor(sprite: string): boolean {
  return !!maskImages[sprite] || sprite in CUSTOM_CLASSIFIERS || GREEN_MARKER_SPRITES.has(sprite);
}

const rawImages: Record<string, HTMLImageElement> = {};
const maskImages: Record<string, HTMLImageElement> = {};
// Optional per-sprite hat guides (undercity/player_sprites/<key>.hat.png): a
// copy of the art with one flat RGB(0,0,255) horizontal line marking where a
// hat sits — its length is the hat's width, its y is the hat's bottom edge, its
// midpoint is the hat's horizontal center.
const hatGuideImages: Record<string, HTMLImageElement> = {};

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

const recolorCache = new Map<string, HTMLCanvasElement>();
const anchorCache: Record<string, { x: number; y: number } | null> = {};
let plazaBgImage: HTMLImageElement | null = null;
let starryImage: HTMLImageElement | null = null;
let loadPromise: Promise<void> | null = null;

/** The Starry special-paint texture, or null until it loads (effect skips a frame). */
export function getStarryTexture(): HTMLImageElement | null {
  return starryImage;
}

interface HatImage {
  img: HTMLImageElement;
  offsetY: number;
  loaded: boolean;
}
const hatCache: Record<string, HatImage> = {};

function classifyPixel(r: number, g: number, b: number, a: number): number {
  if (a < 128) return -1;
  const { h, s, v } = rgbToHsv(r, g, b);
  if (v > 0.92 && s < 0.12) return -1; // white background
  if (v < 0.28) return -1; // outline
  if (h >= 50 && h <= 80 && v > 0.4) return 1;
  if (h >= 85 && h <= 135 && v > 0.5) return 0;
  if (h >= 85 && h <= 135 && v >= 0.28 && v <= 0.5) return 2;
  return -1;
}

function classifyGodzillaPixel(r: number, g: number, b: number, a: number): number {
  if (a < 128) return -1;
  const { h, s, v } = rgbToHsv(r, g, b);
  if (s < 0.06 || v < 0.12) return -1;
  if (h >= 90 && h <= 165) return v > 0.45 ? 1 : 2;
  if (h >= 170 && h <= 230) return 0;
  return -1;
}

// pest — purple grub, saturated pink underbelly, yellow eye-spots. Everything
// that isn't the pink belly or a yellow spot (purple back, magenta shading, and
// the bone-cream spines/back-highlights) follows the body slider, so the whole
// dorsal recolours together and nothing stays a fixed natural colour. The pink
// belly gate is s>0.30 so the lower-saturation cream stays with the body.
function classifyPestPixel(r: number, g: number, b: number, a: number): number {
  if (a < 128) return -1;
  const { h, s, v } = rgbToHsv(r, g, b);
  if (v < 0.14) return -1; // black outline / mouth interior
  if (h >= 40 && h <= 72 && s > 0.38) return 2; // yellow eye-spots (accent)
  if ((h <= 25 || h >= 335) && s > 0.3 && v > 0.35) return 1; // pink underbelly (secondary)
  return 0; // purple back + magenta shading + cream spines/highlights (body)
}

// insect — rose/magenta segmented carapace with tan legs and pincers. Only two
// colour zones (no accent), so it uses the ['body','belly'] region pair.
function classifyInsectPixel(r: number, g: number, b: number, a: number): number {
  if (a < 128) return -1;
  const { h, s, v } = rgbToHsv(r, g, b);
  if (v < 0.12) return -1; // black outline
  if (v > 0.9 && s < 0.12) return -1; // white background (defensive; art is alpha)
  if ((h >= 325 || h <= 8) && s > 0.35) return 0; // rose/magenta carapace (primary)
  if (h >= 15 && h <= 45) return 1; // tan legs & pincers (secondary)
  return -1;
}

// zombie — green flesh, tan leather vest, dark brown trousers/boots. The two
// browns share a hue, so brightness splits the light vest from the dark legs.
function classifyZombiePixel(r: number, g: number, b: number, a: number): number {
  if (a < 128) return -1;
  const { h, s, v } = rgbToHsv(r, g, b);
  if (v < 0.12) return -1; // outline
  if (v > 0.9 && s < 0.12) return -1; // white background
  if (h >= 75 && h <= 150 && s > 0.2) return 0; // green flesh + decay patches (primary)
  if (h >= 12 && h <= 48 && s >= 0.25) return v >= 0.42 ? 1 : 2; // tan vest vs dark trousers
  return -1; // red eyes, greys stay put
}

// saproling — mossy green mound on brown root-legs, tipped with crimson.
function classifySaprolingPixel(r: number, g: number, b: number, a: number): number {
  if (a < 128) return -1;
  const { h, s, v } = rgbToHsv(r, g, b);
  if (v < 0.12) return -1; // outline
  if (v > 0.9 && s < 0.12) return -1; // white background
  if ((h <= 14 || h >= 346) && s > 0.5) return 2; // crimson tips / cap flecks (accent)
  if (h >= 15 && h <= 48) return 1; // tan/brown roots & mushroom caps (secondary)
  if (h >= 80 && h <= 160) return 0; // green moss (primary)
  return -1;
}

/** The pixel classifier for a sprite — its custom override, else the default
 * green-marker classifier. Exposed so the color-test sandbox segments each
 * sprite exactly the way the board/plaza recolor does. */
export function classifierFor(sprite: string | null | undefined): Classifier {
  return (sprite && CUSTOM_CLASSIFIERS[sprite]) || classifyPixel;
}

function pickMax(cnt: number[]): number {
  let best = -1;
  let bestCount = 0;
  for (let k = 0; k < cnt.length; k++) {
    if (cnt[k] > bestCount) {
      bestCount = cnt[k];
      best = k;
    }
  }
  return best;
}

/**
 * Per-pixel region map for an image: 0/1/2 = body/belly/stripes, -1 =
 * untouched/outline, -2 = transparent. The assignment is majority-smoothed at
 * the art's block scale so a single misclassified block adopts its neighbours'
 * region, killing the salt-and-pepper strays in the mask/recolor. Crucially it
 * only smooths the *assignment* — callers keep every pixel's original RGB, so
 * the art is never blurred. Deliberate multi-block features (e.g. pest's spots)
 * survive; true outline pixels always stay -1. Sprites already at true pixel
 * resolution (small, cell < 2) are returned unsmoothed.
 */
export function buildRegionMap(
  data: Uint8ClampedArray,
  w: number,
  h: number,
  classify: Classifier,
): Int8Array {
  const n = w * h;
  const per = new Int8Array(n);
  for (let i = 0; i < n; i++) {
    const j = i * 4;
    per[i] = data[j + 3] < 128 ? -2 : classify(data[j], data[j + 1], data[j + 2], data[j + 3]);
  }

  // Block size of the upscaled faux-pixel art (grid ≈ 128). Native pixel art
  // (small sprites) needs no smoothing.
  const cell = Math.round(Math.max(w, h) / 128);
  if (cell < 2) return per;

  const cw = Math.ceil(w / cell);
  const ch = Math.ceil(h / cell);
  // Majority colour-region (0/1/2 only; outline/transparent don't vote) per cell.
  const coarse = new Int8Array(cw * ch);
  for (let cy = 0; cy < ch; cy++) {
    for (let cx = 0; cx < cw; cx++) {
      const cnt = [0, 0, 0];
      const yEnd = Math.min(h, (cy + 1) * cell);
      const xEnd = Math.min(w, (cx + 1) * cell);
      for (let y = cy * cell; y < yEnd; y++) {
        for (let x = cx * cell; x < xEnd; x++) {
          const r = per[y * w + x];
          if (r >= 0 && r <= 2) cnt[r]++;
        }
      }
      coarse[cy * cw + cx] = pickMax(cnt);
    }
  }
  // 3×3 majority over the coarse grid flips lone stray cells to their neighbours.
  const smooth = new Int8Array(cw * ch);
  for (let cy = 0; cy < ch; cy++) {
    for (let cx = 0; cx < cw; cx++) {
      const cnt = [0, 0, 0];
      for (let dy = -1; dy <= 1; dy++) {
        for (let dx = -1; dx <= 1; dx++) {
          const nx = cx + dx;
          const ny = cy + dy;
          if (nx < 0 || ny < 0 || nx >= cw || ny >= ch) continue;
          const r = coarse[ny * cw + nx];
          if (r >= 0 && r <= 2) cnt[r]++;
        }
      }
      const m = pickMax(cnt);
      smooth[cy * cw + cx] = m < 0 ? coarse[cy * cw + cx] : m;
    }
  }
  // Expand back: outline/transparent pixels keep their per-pixel value; coloured
  // pixels take their (smoothed) cell region.
  const out = new Int8Array(n);
  for (let y = 0; y < h; y++) {
    for (let x = 0; x < w; x++) {
      const i = y * w + x;
      const p = per[i];
      if (p < 0) {
        out[i] = p;
      } else {
        const s = smooth[Math.floor(y / cell) * cw + Math.floor(x / cell)];
        out[i] = s < 0 ? p : s;
      }
    }
  }
  return out;
}

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

function recolorImage(
  img: HTMLImageElement,
  targetHues: number[],
  regionMap: Int8Array,
): HTMLCanvasElement {
  const w = img.naturalWidth || img.width;
  const h = img.naturalHeight || img.height;
  const src = document.createElement('canvas');
  src.width = w;
  src.height = h;
  const srcCtx = src.getContext('2d')!;
  srcCtx.drawImage(img, 0, 0);
  const imageData = srcCtx.getImageData(0, 0, w, h);
  const data = imageData.data;

  for (let p = 0; p < regionMap.length; p++) {
    const i = p * 4;
    const r = data[i],
      g = data[i + 1],
      b = data[i + 2],
      a = data[i + 3];

    // Hat-anchor marker → repaint as body color (mid-tone for a hue, band
    // midpoint for a neutral).
    if (r === 255 && g === 0 && b === 0 && a > 0) {
      const bodyVal = targetHues[0] ?? 120;
      const [nr, ng, nb] =
        bodyVal >= 0 ? hsvToRgb(bodyVal, 0.65, 0.55) : paintedRgb(128, 128, 128, bodyVal);
      data[i] = nr;
      data[i + 1] = ng;
      data[i + 2] = nb;
      continue;
    }

    const region = regionMap[p];
    if (region < 0) continue; // outline / untouched / transparent
    const value = targetHues[region];
    if (value === undefined) continue; // no paint for this region → keep art
    const [nr, ng, nb] = paintedRgb(r, g, b, value);
    data[i] = nr;
    data[i + 1] = ng;
    data[i + 2] = nb;
  }

  const out = document.createElement('canvas');
  out.width = w;
  out.height = h;
  out.getContext('2d')!.putImageData(imageData, 0, 0);
  return out;
}

function loadImage(url: string): Promise<HTMLImageElement> {
  return new Promise((resolve, reject) => {
    const img = new Image();
    img.onload = () => resolve(img);
    img.onerror = reject;
    img.src = url;
  });
}

/** Load the first URL that succeeds, trying each candidate in order. */
function loadImageWithFallback(urls: string[]): Promise<HTMLImageElement> {
  return urls.reduce<Promise<HTMLImageElement>>(
    (chain, url) => chain.catch(() => loadImage(url)),
    Promise.reject(),
  );
}

/** Preload all sprite + hat images and the plaza background. Idempotent. */
export function preloadAll(): Promise<void> {
  if (loadPromise) return loadPromise;
  // Player pawns use the recolored player art in undercity/player_sprites/,
  // preferring <name>.png and falling back to <name>.jfif. Forms without any
  // player art yet (Dino Party placeholders like spino/godzilla) fall back to
  // the legacy undercity/sprites/ pixel art.
  const sprites = ALL_SPRITES.map(async (key) => {
    rawImages[key] = await loadImageWithFallback([
      `undercity/player_sprites/${key}.png`,
      `undercity/player_sprites/${key}.jfif`,
      `undercity/sprites/${key}.png`,
    ]);
  });
  // Optional authored region masks (undercity/player_sprites/<key>.mask.png).
  // Missing masks are fine — those sprites use their classifier instead.
  const masks = ALL_SPRITES.map(async (key) => {
    try {
      maskImages[key] = await loadImage(`undercity/player_sprites/${key}.mask.png`);
    } catch {
      /* no mask for this sprite — classifier fallback */
    }
  });
  // Optional hat guides (undercity/player_sprites/<key>.hat.png). Missing guides
  // are fine — those sprites fall back to the head anchor + native hat size.
  const hatGuides = ALL_SPRITES.map(async (key) => {
    try {
      hatGuideImages[key] = await loadImage(`undercity/player_sprites/${key}.hat.png`);
    } catch {
      /* no hat guide for this sprite */
    }
  });
  const bg = loadImage('undercity/plaza_background.png').then((img) => {
    plazaBgImage = img;
  });
  // Starry special-paint texture. Fire-and-forget: a missing texture must not
  // break preload — the starry effect simply skips its frames until it loads.
  const starry = loadImage('undercity/effects/starry.jpg')
    .then((img) => {
      starryImage = img;
    })
    .catch(() => {
      /* no starry texture — the starry effect renders nothing */
    });
  // Canvases draw Material Icons ligatures (board glyphs, plaza emotes) —
  // make sure the font is resident before the first frame.
  const iconFont = document.fonts.load("26px 'Material Icons'").then(() => undefined);
  // Hats are awaited (not fire-and-forget) so that once preloadAll resolves,
  // static <img> sprite portraits can composite the hat in on first render.
  const hatLoads = HATS.map((hat) =>
    loadImage(`undercity/hats/${hat.file}`)
      .then((img) => {
        hatCache[hat.id] = { img, offsetY: hat.offsetY, loaded: true };
      })
      .catch(() => {
        /* missing hat art — getHatImage returns null and renderers skip it */
      }),
  );
  loadPromise = Promise.all([
    ...sprites,
    ...masks,
    ...hatGuides,
    ...hatLoads,
    bg,
    starry,
    iconFont,
  ]).then(() => undefined);
  return loadPromise;
}

// Hat guides fetched on demand (per key), so ensureHatGuide is idempotent and
// non-destructive — it only ever adds a <key>.hat.png guide, never touches the
// shared raw-sprite or mask caches.
const ensuredGuides = new Set<string>();

/**
 * Load a sprite's <key>.hat.png guide into the engine so hatPlacement() can
 * position a hat on it — for keys outside ALL_SPRITES (which preloadAll covers),
 * e.g. sprites the dev color-test sandbox discovers from the folder. A missing
 * guide is fine (the caller simply won't offer a hat). Idempotent per key.
 */
export function ensureHatGuide(key: string): Promise<void> {
  if (ensuredGuides.has(key)) return Promise.resolve();
  ensuredGuides.add(key);
  return loadImage(`undercity/player_sprites/${key}.hat.png`)
    .then((img) => {
      hatGuideImages[key] = img;
      delete hatGuideCache[key]; // drop any cached "no guide" result
    })
    .catch(() => {
      ensuredGuides.delete(key); // allow a retry if the file appears later
    });
}

export function getPlazaBackground(): HTMLImageElement | null {
  return plazaBgImage;
}

export function getRawImage(sprite: string): HTMLImageElement | null {
  return rawImages[sprite] ?? null;
}

// Region maps are paint-independent, so build once per sprite and reuse across
// every hue combination.
const regionMapCache = new Map<string, Int8Array>();
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
      console.warn(
        `Mask for ${sprite} is ${md.w}×${md.h} but sprite is ${iw}×${ih}; using classifier.`,
      );
      map = buildRegionMap(imageDataOf(img).data, iw, ih, CUSTOM_CLASSIFIERS[sprite] ?? classifyPixel);
    }
  } else {
    map = buildRegionMap(imageDataOf(img).data, iw, ih, CUSTOM_CLASSIFIERS[sprite] ?? classifyPixel);
  }
  regionMapCache.set(sprite, map);
  return map;
}

// ── Special-paint (animated effect) overlays ────────────────────────────────

// Silhouette masks: opaque white where the sprite has any colored region, else
// transparent. Built once per sprite from its cached region map and reused for
// every effect frame — the animated overlay is clipped to this via source-in.
const silhouetteCache = new Map<string, HTMLCanvasElement>();

/** A white-on-transparent silhouette canvas from a region map (opaque white
 *  wherever a colored region sits). Shared by getSilhouetteMask and any caller
 *  that already has a region map (e.g. the color-test sandbox). */
export function buildSilhouette(map: Int8Array, w: number, h: number): HTMLCanvasElement {
  const canvas = document.createElement('canvas');
  canvas.width = w;
  canvas.height = h;
  const ctx = canvas.getContext('2d')!;
  const imageData = ctx.createImageData(w, h);
  const data = imageData.data;
  for (let p = 0; p < map.length; p++) {
    if (map[p] >= 0) {
      const i = p * 4;
      data[i] = 255;
      data[i + 1] = 255;
      data[i + 2] = 255;
      data[i + 3] = 255;
    }
  }
  ctx.putImageData(imageData, 0, 0);
  return canvas;
}

export function getSilhouetteMask(sprite: string): HTMLCanvasElement | null {
  const cached = silhouetteCache.get(sprite);
  if (cached) return cached;
  const img = rawImages[sprite];
  if (!img) return null;
  const w = img.naturalWidth || img.width;
  const h = img.naturalHeight || img.height;
  const canvas = buildSilhouette(regionMapFor(sprite, img), w, h);
  silhouetteCache.set(sprite, canvas);
  return canvas;
}

// One reusable scratch canvas for all effect compositing — grown, never
// reallocated per frame. Effects are painted here (clipped to the silhouette)
// then blitted onto the destination canvas with plain source-over.
let effectScratch: HTMLCanvasElement | null = null;
function scratchOf(w: number, h: number): CanvasRenderingContext2D {
  if (!effectScratch) effectScratch = document.createElement('canvas');
  if (effectScratch.width < w || effectScratch.height < h) {
    effectScratch.width = Math.max(effectScratch.width, w);
    effectScratch.height = Math.max(effectScratch.height, h);
  }
  const ctx = effectScratch.getContext('2d')!;
  ctx.setTransform(1, 0, 0, 1, 0, 0);
  ctx.globalCompositeOperation = 'source-over';
  ctx.globalAlpha = 1;
  ctx.clearRect(0, 0, effectScratch.width, effectScratch.height);
  return ctx;
}

/**
 * Paint an animated special-paint overlay for `effect` onto `ctx`, clipped to
 * the sprite's silhouette and confined to the destination box (dx,dy,dw,dh).
 * `timeMs` is a monotonic time (e.g. the RAF timestamp); pass 0 for a static
 * frame. Cheap: mask blit + one fill/texture draw + composite — no pixel reads.
 */
export function drawCreatureEffect(
  ctx: CanvasRenderingContext2D,
  sprite: string,
  effect: string,
  dx: number,
  dy: number,
  dw: number,
  dh: number,
  timeMs: number,
): void {
  const mask = getSilhouetteMask(sprite);
  if (!mask) return;
  drawEffectMasked(ctx, mask, effect, dx, dy, dw, dh, timeMs);
}

/**
 * Like drawCreatureEffect but takes an explicit silhouette `mask` canvas
 * (opaque white where the creature is) instead of a sprite-name lookup — for
 * callers outside the engine's sprite caches, e.g. the color-test sandbox which
 * segments its own arbitrary images.
 */
export function drawEffectMasked(
  ctx: CanvasRenderingContext2D,
  mask: HTMLCanvasElement,
  effect: string,
  dx: number,
  dy: number,
  dw: number,
  dh: number,
  timeMs: number,
): void {
  if (dw <= 0 || dh <= 0) return;
  const w = Math.ceil(dw);
  const h = Math.ceil(dh);
  const sc = scratchOf(w, h);
  const now = timeMs / 1000;

  // 1) lay the silhouette, 2) clip the effect to it via source-in.
  sc.imageSmoothingEnabled = false;
  sc.drawImage(mask, 0, 0, w, h);
  sc.globalCompositeOperation = 'source-in';

  if (effect === 'metallic') {
    const shineX = (((now * 0.4) % 1.6) - 0.3) * w;
    const grad = sc.createLinearGradient(shineX - 0.12 * w, 0, shineX + 0.12 * w, 0);
    grad.addColorStop(0, 'rgba(255,255,255,0)');
    grad.addColorStop(0.5, 'rgba(255,255,255,0.35)');
    grad.addColorStop(1, 'rgba(255,255,255,0)');
    sc.fillStyle = grad;
    sc.fillRect(0, 0, w, h);
  } else if (effect === 'rainbow') {
    const band = w * 0.5;
    const sweepX = (((now * 0.35) % 1.6) - 0.3) * w;
    const base = Math.floor((now * 50) % 360);
    const grad = sc.createLinearGradient(sweepX - band, 0, sweepX + band, 0);
    grad.addColorStop(0, 'rgba(255,255,255,0)');
    grad.addColorStop(0.2, `hsla(${base}, 100%, 65%, 0.35)`);
    grad.addColorStop(0.5, `hsla(${(base + 120) % 360}, 100%, 65%, 0.4)`);
    grad.addColorStop(0.8, `hsla(${(base + 240) % 360}, 100%, 65%, 0.35)`);
    grad.addColorStop(1, 'rgba(255,255,255,0)');
    sc.fillStyle = grad;
    sc.fillRect(0, 0, w, h);
  } else if (effect === 'prismatic') {
    sc.globalAlpha = 0.12;
    const hue = Math.floor((now * 10 + 180) % 360);
    sc.fillStyle = `hsl(${hue}, 100%, 70%)`;
    sc.fillRect(0, 0, w, h);
    sc.globalAlpha = 1;
  } else if (effect === 'starry') {
    const tex = starryImage;
    if (!tex) return; // texture not loaded yet — skip this frame
    sc.imageSmoothingEnabled = true;
    sc.globalAlpha = 0.6;
    const texW = tex.naturalWidth;
    const texH = tex.naturalHeight;
    const range = texW * 0.08;
    const panX = texW * 0.25 + Math.sin(now * 0.15) * range;
    const panY = texH * 0.25 + Math.cos(now * 0.1) * range * 0.6;
    sc.drawImage(tex, panX, panY, texW * 0.4, texH * 0.4, 0, 0, w, h);
    sc.globalAlpha = 1;
  } else {
    return; // unknown effect id — draw nothing
  }

  // Blit the silhouette-clipped effect onto the destination.
  ctx.drawImage(effectScratch!, 0, 0, w, h, dx, dy, dw, dh);
}

/**
 * Recolored sprite canvas for a sprite + hue map, cached by hue key.
 * @param colors region-name → hue, e.g. { body: 130, belly: 50, stripes: 130 }
 * @param regions ordered region names for this sprite
 */
export function getRecolored(
  sprite: string,
  colors: Record<string, number>,
  regions: string[],
): HTMLCanvasElement | null {
  const img = rawImages[sprite];
  if (!img) return null;
  // No mask (and no classifier) → we can't split this art into body/belly/
  // stripes without garbling it, so return it unrecoloured. Recolour turns on
  // automatically the moment a <key>.mask.png ships — no code change needed.
  if (!canRecolor(sprite)) {
    const cached = recolorCache.get(`${sprite}-raw`);
    if (cached) return cached;
    const w = img.naturalWidth || img.width;
    const h = img.naturalHeight || img.height;
    const canvas = document.createElement('canvas');
    canvas.width = w;
    canvas.height = h;
    canvas.getContext('2d')!.drawImage(img, 0, 0);
    recolorCache.set(`${sprite}-raw`, canvas);
    return canvas;
  }
  const hues = regions.map((r) => colors[r] ?? 120);
  const key = `${sprite}-${hues.join('-')}`;
  const cached = recolorCache.get(key);
  if (cached) return cached;
  const canvas = recolorImage(img, hues, regionMapFor(sprite, img));
  recolorCache.set(key, canvas);
  return canvas;
}

export function getRecoloredDataUrl(
  sprite: string,
  colors: Record<string, number>,
  regions: string[],
): string | null {
  return getRecolored(sprite, colors, regions)?.toDataURL() ?? null;
}

export function getHatImage(hatId: string): HatImage | null {
  return hatCache[hatId] ?? null;
}

/**
 * Placement for a hat on a sprite, read from its <key>.hat.png guide line
 * (RGB(0,0,255)). All values are in the sprite's own pixel space (same space as
 * the sprite canvas + getHatAnchor):
 *   centerX — horizontal midpoint of the line (hat centers here)
 *   bottomY — the line's row (the hat's bottom edge rests here)
 *   width   — the line's length in pixels (the hat is scaled to this width)
 * Null when the sprite has no guide file (or no blue line in it).
 */
export interface HatGuide {
  centerX: number;
  bottomY: number;
  width: number;
}
const hatGuideCache: Record<string, HatGuide | null> = {};

export function getHatGuide(sprite: string): HatGuide | null {
  if (sprite in hatGuideCache) return hatGuideCache[sprite];
  const img = hatGuideImages[sprite];
  if (!img) {
    hatGuideCache[sprite] = null;
    return null;
  }
  const { data, w } = imageDataOf(img);
  let minX = Infinity,
    maxX = -Infinity,
    sumY = 0,
    count = 0;
  for (let i = 0; i < data.length; i += 4) {
    // Solid blue marker: high blue, low red/green, opaque.
    if (data[i] < 80 && data[i + 1] < 80 && data[i + 2] > 200 && data[i + 3] >= 128) {
      const p = i / 4;
      const x = p % w;
      if (x < minX) minX = x;
      if (x > maxX) maxX = x;
      sumY += Math.floor(p / w);
      count++;
    }
  }
  if (count === 0) {
    hatGuideCache[sprite] = null;
    return null;
  }
  const guide: HatGuide = {
    centerX: (minX + maxX) / 2,
    bottomY: Math.round(sumY / count),
    width: maxX - minX + 1,
  };
  hatGuideCache[sprite] = guide;
  return guide;
}

/**
 * Where a hat sits on a sprite, in the sprite's own pixel space (same space as
 * the recolored sprite canvas). sy may be negative — a hat can poke above the
 * sprite bounds — so canvas renderers should draw it as a separate image (not
 * composite into the fixed sprite canvas) unless they add headroom.
 *
 * Uses the sprite's blue-line hat guide (width + bottom + center) when present,
 * else falls back to the head anchor + the hat's native size. Returns null when
 * there's no hat id or the hat art hasn't loaded yet.
 */
export interface HatRect {
  img: HTMLImageElement;
  sx: number;
  sy: number;
  sw: number;
  sh: number;
}

export function hatPlacement(sprite: string, hatId: string | null | undefined): HatRect | null {
  if (!hatId) return null;
  const hat = hatCache[hatId];
  if (!hat || !hat.loaded) return null;
  const aspect = hat.img.naturalHeight / Math.max(1, hat.img.naturalWidth);
  const guide = getHatGuide(sprite);
  if (guide) {
    const sw = guide.width;
    const sh = sw * aspect;
    return { img: hat.img, sx: guide.centerX - sw / 2, sy: guide.bottomY + hat.offsetY - sh, sw, sh };
  }
  const anchor = getHatAnchor(sprite);
  const sw = hat.img.naturalWidth;
  const sh = hat.img.naturalHeight;
  return { img: hat.img, sx: anchor.x - sw / 2, sy: anchor.y + hat.offsetY - sh, sw, sh };
}

// Recolored-sprite-plus-hat canvases, cached by sprite + hues + hat id.
const recolorHatCache = new Map<string, HTMLCanvasElement>();

/**
 * A recolored sprite with its hat composited on, for static <img> portraits.
 * The canvas is expanded upward (and sideways if needed) so a tall or high hat
 * isn't clipped; the sprite stays bottom-aligned and horizontally centered, so
 * an `object-fit: contain` box shows creature + hat as one image. Returns the
 * plain recolor when there's no hat (or it hasn't loaded), and null when the
 * sprite art is missing.
 */
export function getRecoloredWithHat(
  sprite: string,
  colors: Record<string, number>,
  regions: string[],
  hatId: string | null | undefined,
): HTMLCanvasElement | null {
  const base = getRecolored(sprite, colors, regions);
  if (!base) return null;
  const rect = hatPlacement(sprite, hatId);
  if (!rect) return base;

  const hues = regions.map((r) => colors[r] ?? 120);
  const key = `${sprite}-${hues.join('-')}-${hatId}`;
  const cached = recolorHatCache.get(key);
  if (cached) return cached;

  const topPad = Math.max(0, -rect.sy);
  const sidePad = Math.max(0, -rect.sx, rect.sx + rect.sw - base.width);
  const out = document.createElement('canvas');
  out.width = base.width + sidePad * 2;
  out.height = base.height + topPad;
  const ctx = out.getContext('2d')!;
  ctx.imageSmoothingEnabled = false;
  ctx.drawImage(base, sidePad, topPad);
  ctx.drawImage(rect.img, sidePad + rect.sx, topPad + rect.sy, rect.sw, rect.sh);
  recolorHatCache.set(key, out);
  return out;
}

export function getRecoloredWithHatDataUrl(
  sprite: string,
  colors: Record<string, number>,
  regions: string[],
  hatId: string | null | undefined,
): string | null {
  return getRecoloredWithHat(sprite, colors, regions, hatId)?.toDataURL() ?? null;
}

// Static portraits with a single (non-animated) frame of a special paint baked
// in — for list rows and small portraits that shouldn't each spin up a RAF.
const recolorHatEffectCache = new Map<string, HTMLCanvasElement>();

/**
 * A static portrait: recolored sprite + hat with one frame of `effect`
 * composited on. Cached by sprite + hues + hat + effect. Falls back to the
 * plain hat portrait when there's no effect.
 */
export function getRecoloredWithHatEffect(
  sprite: string,
  colors: Record<string, number>,
  regions: string[],
  hatId: string | null | undefined,
  effect: string | null | undefined,
): HTMLCanvasElement | null {
  const base = getRecoloredWithHat(sprite, colors, regions, hatId);
  if (!base || !effect) return base;
  const hues = regions.map((r) => colors[r] ?? 120).join('-');
  const key = `${sprite}-${hues}-${hatId}-${effect}`;
  const cached = recolorHatEffectCache.get(key);
  if (cached) return cached;

  const out = document.createElement('canvas');
  out.width = base.width;
  out.height = base.height;
  const ctx = out.getContext('2d')!;
  ctx.imageSmoothingEnabled = false;
  ctx.drawImage(base, 0, 0);
  const img = rawImages[sprite];
  if (img) {
    const sw = img.naturalWidth || img.width;
    const sh = img.naturalHeight || img.height;
    // The plain recolor is exactly sprite-sized and sits bottom-aligned,
    // horizontally centered within the (hat-)padded portrait. Draw the effect
    // over that footprint.
    const ex = (base.width - sw) / 2;
    const ey = base.height - sh;
    drawCreatureEffect(ctx, sprite, effect, ex, ey, sw, sh, 0);
  }
  recolorHatEffectCache.set(key, out);
  return out;
}

export function getRecoloredWithHatEffectDataUrl(
  sprite: string,
  colors: Record<string, number>,
  regions: string[],
  hatId: string | null | undefined,
  effect: string | null | undefined,
): string | null {
  return getRecoloredWithHatEffect(sprite, colors, regions, hatId, effect)?.toDataURL() ?? null;
}

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
