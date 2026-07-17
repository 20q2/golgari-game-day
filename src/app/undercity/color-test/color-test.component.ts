import {
  AfterViewInit,
  Component,
  ElementRef,
  ViewChild,
  computed,
  effect,
  signal,
} from '@angular/core';
import { CommonModule } from '@angular/common';
import { rgbToHsv, hsvToRgb } from '../engine/colors';
import { ALL_SPRITES } from '../data/species';
import { classifierFor, buildRegionMap, buildRegionMapFromMask } from '../engine/sprite-engine';
import { PAINTS } from '../data/cosmetics';

type RegionKey = 'body' | 'belly' | 'stripes';

interface SpriteOption {
  label: string;
  url: string;
  /** Classifier key (sprite name); undefined for uploaded files. */
  sprite?: string;
}

// The recolored player art lives here; keep in sync with public/undercity/player_sprites.
const PLAYER_SPRITES = [
  'pest',
  'insect',
  'zombie',
  'saproling',
  'grub',
  'plant',
  'myconid_sporetender',
  'slitherhead',
  'shambling_shell',
  'corpsejack_menace',
  'brackish_trudge',
  'brackish_trudge_stinky',
];

// Debug tints for the region-mask view (body / belly / stripes).
const MASK_RGB: Record<number, [number, number, number]> = {
  0: [239, 68, 68], // body   → red
  1: [163, 230, 53], // belly  → lime
  2: [59, 130, 246], // stripes→ blue
};

/**
 * Dev-only sprite recolor sandbox (route: /undercity/color-test).
 *
 * Loads any sprite by URL or file upload and applies the exact region
 * classifier from sprite-engine.ts, so you can dial each region's hue and
 * confirm a sprite is baked into the green marker palette correctly. The
 * "regions" toggle paints body/belly/stripes as flat debug colors to show
 * how every pixel was classified. Nothing here touches game state.
 */
@Component({
  selector: 'app-undercity-color-test',
  standalone: true,
  imports: [CommonModule],
  templateUrl: './color-test.component.html',
  styleUrls: ['./color-test.component.scss'],
})
export class ColorTestComponent implements AfterViewInit {
  @ViewChild('preview') previewRef!: ElementRef<HTMLCanvasElement>;

  protected readonly sprites: SpriteOption[] = [
    ...PLAYER_SPRITES.map((n) => ({
      label: `player: ${n}`,
      url: `undercity/player_sprites/${n}.png`,
      sprite: n,
    })),
    ...ALL_SPRITES.map((n) => ({
      label: `placeholder: ${n}`,
      url: `undercity/sprites/${n}.png`,
      sprite: n,
    })),
  ];
  protected readonly paints = PAINTS;

  protected readonly spriteUrl = signal(this.sprites[0].url);
  // Which classifier to segment with — the selected sprite's key (null for uploads).
  private readonly spriteKey = signal<string | null>(this.sprites[0].sprite ?? null);
  protected readonly hue = signal<Record<RegionKey, number>>({ body: 130, belly: 50, stripes: 130 });
  protected readonly showRegions = signal(false);
  protected readonly lightBg = signal(false);
  protected readonly scale = signal(5);
  protected readonly loadError = signal<string | null>(null);
  protected readonly dims = signal<{ w: number; h: number } | null>(null);
  protected readonly counts = signal<Record<'outline' | 'body' | 'belly' | 'stripes', number>>({
    outline: 0,
    body: 0,
    belly: 0,
    stripes: 0,
  });

  protected readonly regionList: { key: RegionKey; name: string }[] = [
    { key: 'body', name: 'Body · region 0 (primary)' },
    { key: 'belly', name: 'Belly · region 1 (secondary)' },
    { key: 'stripes', name: 'Stripes · region 2 (accent)' },
  ];

  // Smoothed region map cached against the image (and mask) it was built from, so
  // dragging the hue sliders doesn't rebuild it every frame.
  private regionCache: {
    img: HTMLImageElement | null;
    mask: HTMLImageElement | null;
    map: Int8Array | null;
  } = { img: null, mask: null, map: null };
  private readonly imageCache = new Map<string, HTMLImageElement>();
  // Authored masks loaded on demand for the selected sprite (null once a fetch fails).
  private readonly maskCache = new Map<string, HTMLImageElement | null>();
  private readonly currentMask = signal<HTMLImageElement | null>(null);
  private readonly currentImage = signal<HTMLImageElement | null>(null);
  private objectUrl: string | null = null;
  private viewReady = false;

  protected readonly swatch = computed(() => {
    const h = this.hue();
    const css = (deg: number) => `hsl(${deg}, 65%, 50%)`;
    return { body: css(h.body), belly: css(h.belly), stripes: css(h.stripes) };
  });

  constructor() {
    // Load the selected/ uploaded image, then cache + publish it.
    effect(() => {
      const url = this.spriteUrl();
      const cached = this.imageCache.get(url);
      if (cached) {
        this.currentImage.set(cached);
        return;
      }
      const img = new Image();
      img.onload = () => {
        this.imageCache.set(url, img);
        this.loadError.set(null);
        this.currentImage.set(img);
      };
      img.onerror = () => this.loadError.set(`Could not load ${url}`);
      img.src = url;
    });

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

    // Redraw whenever the image, hues, selected sprite, or view options change.
    effect(() => {
      const img = this.currentImage();
      const h = this.hue();
      const regions = this.showRegions();
      const scale = this.scale();
      this.spriteKey(); // re-render when the classifier changes
      this.currentMask(); // re-render when the authored mask loads
      if (this.viewReady && img) this.render(img, h, regions, scale);
    });
  }

  ngAfterViewInit(): void {
    this.viewReady = true;
    const img = this.currentImage();
    if (img) this.render(img, this.hue(), this.showRegions(), this.scale());
  }

  // ── Controls ────────────────────────────────────────────────────────────────

  selectSprite(event: Event): void {
    const url = (event.target as HTMLSelectElement).value;
    this.spriteUrl.set(url);
    this.spriteKey.set(this.sprites.find((s) => s.url === url)?.sprite ?? null);
  }

  onFile(event: Event): void {
    const file = (event.target as HTMLInputElement).files?.[0];
    if (!file) return;
    if (this.objectUrl) URL.revokeObjectURL(this.objectUrl);
    this.objectUrl = URL.createObjectURL(file);
    // Register under its own label so the <select> doesn't fight it.
    const url = this.objectUrl;
    this.spriteUrl.set(url);
    this.spriteKey.set(null); // uploads use the default green-marker classifier
  }

  setHue(region: RegionKey, event: Event): void {
    const value = Number((event.target as HTMLInputElement).value);
    this.hue.set({ ...this.hue(), [region]: value });
  }

  applyPaint(region: RegionKey, hue: number): void {
    this.hue.set({ ...this.hue(), [region]: hue });
  }

  setScale(event: Event): void {
    this.scale.set(Number((event.target as HTMLInputElement).value));
  }

  reset(): void {
    this.hue.set({ body: 130, belly: 50, stripes: 130 });
  }

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

  toggleRegions(): void {
    this.showRegions.set(!this.showRegions());
  }

  toggleBg(): void {
    this.lightBg.set(!this.lightBg());
  }

  // ── Recolor (uses the sprite-engine smoothed region map, mirroring the board) ──

  private render(
    img: HTMLImageElement,
    hues: Record<RegionKey, number>,
    showRegions: boolean,
    scale: number,
  ): void {
    const w = img.naturalWidth || img.width;
    const h = img.naturalHeight || img.height;
    this.dims.set({ w, h });

    const off = document.createElement('canvas');
    off.width = w;
    off.height = h;
    const octx = off.getContext('2d')!;
    octx.drawImage(img, 0, 0);
    const imageData = octx.getImageData(0, 0, w, h);
    const data = imageData.data;
    const targetHues = [hues.body, hues.belly, hues.stripes];

    // Prefer the authored mask (board parity); else the smoothed classifier map.
    // Cache invalidates on either the image or the mask changing.
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
    const regionMap = this.regionCache.map!;
    const tally = { outline: 0, body: 0, belly: 0, stripes: 0 };

    for (let p = 0; p < regionMap.length; p++) {
      const i = p * 4;
      const r = data[i],
        g = data[i + 1],
        b = data[i + 2],
        a = data[i + 3];
      if (a < 128) continue;

      // Hat-anchor marker → repaint as body color (engine parity).
      if (r === 255 && g === 0 && b === 0) {
        const [nr, ng, nb] = hsvToRgb(targetHues[0] ?? 120, 0.65, 0.55);
        data[i] = nr;
        data[i + 1] = ng;
        data[i + 2] = nb;
        continue;
      }

      const region = regionMap[p];
      if (region < 0) {
        tally.outline++;
        continue;
      }
      tally[(['body', 'belly', 'stripes'] as const)[region]]++;

      if (showRegions) {
        const [mr, mg, mb] = MASK_RGB[region];
        data[i] = mr;
        data[i + 1] = mg;
        data[i + 2] = mb;
      } else {
        const hsv = rgbToHsv(r, g, b);
        const [nr, ng, nb] = hsvToRgb(targetHues[region] ?? hsv.h, hsv.s, hsv.v);
        data[i] = nr;
        data[i + 1] = ng;
        data[i + 2] = nb;
      }
    }
    octx.putImageData(imageData, 0, 0);
    this.counts.set(tally);

    // Classification ran on the natural-res offscreen canvas above; the visible
    // canvas only needs a sane backing store. Cap the longest side so the 1024px
    // player sprites don't blow up to a multi-thousand-px (100MB+) canvas at high
    // zoom — small pixel sprites still magnify freely.
    const MAX_SIDE = 1536;
    const eff = Math.min(scale, MAX_SIDE / Math.max(w, h));
    const canvas = this.previewRef.nativeElement;
    canvas.width = Math.round(w * eff);
    canvas.height = Math.round(h * eff);
    const ctx = canvas.getContext('2d')!;
    ctx.clearRect(0, 0, canvas.width, canvas.height);
    ctx.imageSmoothingEnabled = false;
    ctx.drawImage(off, 0, 0, canvas.width, canvas.height);
  }
}
