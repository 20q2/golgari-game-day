import {
  AfterViewInit,
  Component,
  ElementRef,
  ViewChild,
  computed,
  effect,
  inject,
  signal,
} from '@angular/core';
import { CommonModule } from '@angular/common';
import { HttpClient } from '@angular/common/http';
import { firstValueFrom } from 'rxjs';
import { hsvToRgb } from '../engine/colors';
import {
  classifierFor,
  buildRegionMap,
  buildRegionMapFromMask,
  ensureHatGuide,
  hatPlacement,
  paintedRgb,
  preloadAll,
} from '../engine/sprite-engine';
import { PAINTS, paintSwatchCss } from '../data/cosmetics';

type RegionKey = 'body' | 'belly' | 'stripes';

/** One selectable sprite, discovered from the folder manifest. */
interface SpriteOption {
  /** Sprite key = base filename without extension (undefined for uploads). */
  name?: string;
  label: string;
  /** Base art URL. */
  url: string;
  /** A `<name>.mask.png` sits beside the base art. */
  hasMask: boolean;
  /** A `<name>.hat.png` guide sits beside the base art (enables the hat toggle). */
  hasHat: boolean;
}

/** Shape of public/data/undercity-player-sprites.json — one entry per base
 *  `<name>.png` in public/undercity/player_sprites/, with flags for the
 *  companion mask/hat files. Built by scripts/gen-player-sprites-manifest.mjs. */
interface PlayerSpriteManifest {
  sprites: { name: string; hasMask: boolean; hasHat: boolean }[];
}

// Debug tints for the region-mask view (body / belly / stripes).
const MASK_RGB: Record<number, [number, number, number]> = {
  0: [239, 68, 68], // body   → red
  1: [163, 230, 53], // belly  → lime
  2: [59, 130, 246], // stripes→ blue
};

/**
 * Dev-only sprite recolor sandbox (route: /undercity/color-test).
 *
 * Lists every sprite in public/undercity/player_sprites/ (discovered from the
 * manifest, so new art appears automatically — no hardcoded list). Each sprite
 * is 1–3 files:
 *   <name>.png       base art
 *   <name>.mask.png  region mask — when it matches the art's size the hue
 *                    sliders recolor body/belly/stripes exactly as the board
 *                    does (buildRegionMapFromMask). No/size-mismatched mask →
 *                    the sprite's pixel classifier is used, same as the board.
 *   <name>.hat.png   hat guide — when present, the "Hat" toggle places a hat.
 * Uploads are supported for a quick look (classifier segmentation, no hat).
 * The recolor mirrors the engine, so this is the place to confirm a sprite
 * paints cleanly. Nothing here touches game state.
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

  private readonly http = inject(HttpClient);

  protected readonly sprites = signal<SpriteOption[]>([]);
  protected readonly paints = PAINTS;

  protected readonly spriteUrl = signal('');
  // The current selection (null for uploads) — carries its mask/hat availability.
  protected readonly current = signal<SpriteOption | null>(null);
  // Classifier key for segmentation (null for uploads → default green-marker).
  private readonly spriteKey = signal<string | null>(null);
  protected readonly hue = signal<Record<RegionKey, number>>({ body: 130, belly: 50, stripes: 130 });
  protected readonly showRegions = signal(false);
  protected readonly lightBg = signal(false);
  /** Draw a hat on the sprite via its `<name>.hat.png` guide. */
  protected readonly showTophat = signal(false);
  /** True once preloadAll() has the hat art resident. */
  private readonly hatReady = signal(false);
  /** Bumped once the selected sprite's hat guide has loaded, so the preview
   *  re-renders with the hat placed. */
  private readonly guideVersion = signal(0);
  protected readonly scale = signal(5);
  protected readonly loadError = signal<string | null>(null);
  protected readonly dims = signal<{ w: number; h: number } | null>(null);
  protected readonly counts = signal<Record<'outline' | 'body' | 'belly' | 'stripes', number>>({
    outline: 0,
    body: 0,
    belly: 0,
    stripes: 0,
  });

  /** The hat toggle is only offered when the sprite has a hat guide. */
  protected readonly canHat = computed(() => this.current()?.hasHat ?? false);

  protected readonly regionList: { key: RegionKey; name: string }[] = [
    { key: 'body', name: 'Body · region 0 (primary)' },
    { key: 'belly', name: 'Belly · region 1 (secondary)' },
    { key: 'stripes', name: 'Stripes · region 2 (accent)' },
  ];

  // Region map cached against the (image, mask) it was built from, so dragging
  // the hue sliders doesn't rebuild it every frame.
  private regionCache: {
    img: HTMLImageElement | null;
    mask: HTMLImageElement | null;
    map: Int8Array | null;
  } = { img: null, mask: null, map: null };
  private readonly imageCache = new Map<string, HTMLImageElement>();
  // Authored masks loaded on demand (null once a fetch fails or is skipped).
  private readonly maskCache = new Map<string, HTMLImageElement | null>();
  private readonly currentMask = signal<HTMLImageElement | null>(null);
  private readonly currentImage = signal<HTMLImageElement | null>(null);
  private objectUrl: string | null = null;
  private viewReady = false;

  protected readonly swatch = computed(() => {
    const h = this.hue();
    const css = (v: number) => paintSwatchCss(v, 65, 50);
    return { body: css(h.body), belly: css(h.belly), stripes: css(h.stripes) };
  });

  /** Swatch CSS for a paint value (template helper for the paint buttons). */
  protected swatchCss(value: number): string {
    return paintSwatchCss(value, 65, 50);
  }

  constructor() {
    // Load the selected / uploaded base art, then cache + publish it.
    effect(() => {
      const url = this.spriteUrl();
      if (!url) return;
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

    // Load the authored mask when the sprite has one, so the sliders segment
    // exactly like the board. No mask (or upload) → classifier fallback.
    effect(() => {
      const opt = this.current();
      if (!opt?.name || !opt.hasMask) {
        this.currentMask.set(null);
        return;
      }
      const key = opt.name;
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

    // Load the sprite's hat guide (preloadAll only covers the built-in sprites),
    // then re-render so the hat lands in the right place.
    effect(() => {
      const opt = this.current();
      if (!opt?.name || !opt.hasHat) return;
      void ensureHatGuide(opt.name).then(() => this.guideVersion.update((v) => v + 1));
    });

    // Redraw whenever the image, hues, selection, or view options change.
    effect(() => {
      const img = this.currentImage();
      const h = this.hue();
      const regions = this.showRegions();
      const scale = this.scale();
      this.spriteKey(); // re-render when the classifier changes
      this.currentMask(); // re-render once the mask loads
      this.showTophat(); // re-render when the hat toggles
      this.hatReady(); // re-render once the hat art has loaded
      this.guideVersion(); // re-render once the hat guide lands
      if (this.viewReady && img) this.render(img, h, regions, scale);
    });

    // Discover the sprite catalog from the folder manifest.
    void firstValueFrom(this.http.get<PlayerSpriteManifest>('data/undercity-player-sprites.json'))
      .then((manifest) => {
        const options: SpriteOption[] = manifest.sprites.map((s) => ({
          name: s.name,
          label: `${s.name}${s.hasMask ? ' · mask' : ''}${s.hasHat ? ' · hat' : ''}`,
          url: `undercity/player_sprites/${s.name}.png`,
          hasMask: s.hasMask,
          hasHat: s.hasHat,
        }));
        if (!options.length) {
          this.loadError.set('No sprites found in player_sprites/.');
          return;
        }
        this.sprites.set(options);
        // Open on the first sprite that actually recolors (has a mask) so the
        // sandbox is useful on load; else just the first sprite.
        this.select(options.find((o) => o.hasMask) ?? options[0]);
      })
      .catch(() =>
        this.loadError.set(
          'Could not load the sprite manifest — run `npm run gen:player-sprites`.',
        ),
      );
  }

  /** Point the sandbox at a sprite: its base art URL + mask/hat flags. */
  private select(opt: SpriteOption): void {
    this.spriteUrl.set(opt.url);
    this.spriteKey.set(opt.name ?? null);
    this.current.set(opt);
    if (!opt.hasHat) this.showTophat.set(false);
  }

  ngAfterViewInit(): void {
    this.viewReady = true;
    const img = this.currentImage();
    if (img) this.render(img, this.hue(), this.showRegions(), this.scale());
    // Load the hat art so the tophat toggle can draw once enabled.
    void preloadAll().then(() => this.hatReady.set(true));
  }

  // ── Controls ────────────────────────────────────────────────────────────────

  selectSprite(event: Event): void {
    const url = (event.target as HTMLSelectElement).value;
    const opt = this.sprites().find((s) => s.url === url);
    if (opt) this.select(opt);
  }

  onFile(event: Event): void {
    const file = (event.target as HTMLInputElement).files?.[0];
    if (!file) return;
    if (this.objectUrl) URL.revokeObjectURL(this.objectUrl);
    this.objectUrl = URL.createObjectURL(file);
    this.spriteUrl.set(this.objectUrl);
    this.spriteKey.set(null); // uploads use the default green-marker classifier
    this.current.set(null); // uploads have no mask/hat
    this.showTophat.set(false);
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

  toggleTophat(): void {
    if (this.canHat()) this.showTophat.set(!this.showTophat());
  }

  // ── Recolor (mirrors the engine: authored mask when it fits, else classifier) ──

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

    // Prefer the authored mask when it matches the art (board parity); else the
    // sprite's classifier. Cache invalidates on the image or the mask changing.
    const mask = this.currentMask();
    if (this.regionCache.img !== img || this.regionCache.mask !== mask) {
      let map: Int8Array;
      if (
        mask &&
        (mask.naturalWidth || mask.width) === w &&
        (mask.naturalHeight || mask.height) === h
      ) {
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
        const bodyVal = targetHues[0] ?? 120;
        const [nr, ng, nb] =
          bodyVal >= 0 ? hsvToRgb(bodyVal, 0.65, 0.55) : paintedRgb(128, 128, 128, bodyVal);
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
        const [nr, ng, nb] = paintedRgb(r, g, b, targetHues[region]);
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

    // Hat overlay via the sprite's guide (placement is in sprite-pixel space, so
    // it maps to the offscreen render 1:1 and scales by `eff`). The canvas grows
    // upward/sideways so a high or wide hat isn't clipped.
    const opt = this.current();
    const rect =
      this.showTophat() && this.hatReady() && opt?.hasHat
        ? hatPlacement(opt.name ?? '', 'top_hat')
        : null;
    const topPad = rect ? Math.max(0, -rect.sy) : 0;
    const sidePad = rect ? Math.max(0, -rect.sx, rect.sx + rect.sw - w) : 0;

    const canvas = this.previewRef.nativeElement;
    canvas.width = Math.round((w + sidePad * 2) * eff);
    canvas.height = Math.round((h + topPad) * eff);
    const ctx = canvas.getContext('2d')!;
    ctx.clearRect(0, 0, canvas.width, canvas.height);
    ctx.imageSmoothingEnabled = false;
    ctx.drawImage(off, sidePad * eff, topPad * eff, w * eff, h * eff);
    if (rect) {
      ctx.drawImage(
        rect.img,
        (sidePad + rect.sx) * eff,
        (topPad + rect.sy) * eff,
        rect.sw * eff,
        rect.sh * eff,
      );
    }
  }
}
