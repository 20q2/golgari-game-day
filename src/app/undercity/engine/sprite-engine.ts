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
import { HATS, HatInfo } from '../data/cosmetics';

type Classifier = (r: number, g: number, b: number, a: number) => number;

const CUSTOM_CLASSIFIERS: Record<string, Classifier> = {
  godzilla: classifyGodzillaPixel,
};

const rawImages: Record<string, HTMLImageElement> = {};
const recolorCache = new Map<string, HTMLCanvasElement>();
const anchorCache: Record<string, { x: number; y: number } | null> = {};
let plazaBgImage: HTMLImageElement | null = null;
let loadPromise: Promise<void> | null = null;

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

function recolorImage(
  img: HTMLImageElement,
  targetHues: number[],
  classifier: Classifier,
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

  for (let i = 0; i < data.length; i += 4) {
    const r = data[i],
      g = data[i + 1],
      b = data[i + 2],
      a = data[i + 3];

    // Hat-anchor marker → repaint as body color.
    if (r === 255 && g === 0 && b === 0 && a > 0) {
      const [nr, ng, nb] = hsvToRgb(targetHues[0] ?? 120, 0.65, 0.55);
      data[i] = nr;
      data[i + 1] = ng;
      data[i + 2] = nb;
      continue;
    }

    const region = classifier(r, g, b, a);
    if (region === -1) continue;
    const hsv = rgbToHsv(r, g, b);
    const newHue = targetHues[region] ?? hsv.h;
    const [nr, ng, nb] = hsvToRgb(newHue, hsv.s, hsv.v);
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

/** Preload all sprite + hat images and the plaza background. Idempotent. */
export function preloadAll(): Promise<void> {
  if (loadPromise) return loadPromise;
  const sprites = ALL_SPRITES.map(async (key) => {
    rawImages[key] = await loadImage(`undercity/sprites/${key}.png`);
  });
  const bg = loadImage('undercity/plaza_background.png').then((img) => {
    plazaBgImage = img;
  });
  for (const hat of HATS) {
    const img = new Image();
    const entry: HatImage = { img, offsetY: hat.offsetY, loaded: false };
    img.onload = () => (entry.loaded = true);
    img.src = `undercity/hats/${hat.file}`;
    hatCache[hat.id] = entry;
  }
  loadPromise = Promise.all([...sprites, bg]).then(() => undefined);
  return loadPromise;
}

export function getPlazaBackground(): HTMLImageElement | null {
  return plazaBgImage;
}

export function getRawImage(sprite: string): HTMLImageElement | null {
  return rawImages[sprite] ?? null;
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
  const hues = regions.map((r) => colors[r] ?? 120);
  const key = `${sprite}-${hues.join('-')}`;
  const cached = recolorCache.get(key);
  if (cached) return cached;
  const canvas = recolorImage(img, hues, CUSTOM_CLASSIFIERS[sprite] ?? classifyPixel);
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

/** Head anchor from the sprite's pure-red marker pixel. */
export function getHatAnchor(sprite: string): { x: number; y: number } {
  if (sprite in anchorCache) return anchorCache[sprite] ?? { x: 16, y: 6 };
  const img = rawImages[sprite];
  if (!img) return { x: 16, y: 6 };
  const w = img.naturalWidth || img.width;
  const h = img.naturalHeight || img.height;
  const tmp = document.createElement('canvas');
  tmp.width = w;
  tmp.height = h;
  const ctx = tmp.getContext('2d')!;
  ctx.drawImage(img, 0, 0);
  const data = ctx.getImageData(0, 0, w, h).data;
  for (let i = 0; i < data.length; i += 4) {
    if (data[i] === 255 && data[i + 1] === 0 && data[i + 2] === 0 && data[i + 3] >= 128) {
      const px = (i / 4) % w;
      const py = Math.floor(i / 4 / w);
      anchorCache[sprite] = { x: px, y: py };
      return anchorCache[sprite]!;
    }
  }
  anchorCache[sprite] = null;
  return { x: 16, y: 6 };
}
