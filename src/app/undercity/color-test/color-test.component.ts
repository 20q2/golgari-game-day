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
import { PAINTS } from '../data/cosmetics';

type RegionKey = 'body' | 'belly' | 'stripes';

interface SpriteOption {
  label: string;
  url: string;
}

// The recolored player art lives here; keep in sync with public/undercity/player_sprites.
const PLAYER_SPRITES = [
  'pest',
  'grub',
  'saproling',
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
    ...PLAYER_SPRITES.map((n) => ({ label: `player: ${n}`, url: `undercity/player_sprites/${n}.png` })),
    ...ALL_SPRITES.map((n) => ({ label: `placeholder: ${n}`, url: `undercity/sprites/${n}.png` })),
  ];
  protected readonly paints = PAINTS;

  protected readonly spriteUrl = signal(this.sprites[0].url);
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
    { key: 'body', name: 'Body (mid green · region 0)' },
    { key: 'belly', name: 'Belly (yellow-green highlight · region 1)' },
    { key: 'stripes', name: 'Stripes (dark green shadow · region 2)' },
  ];

  private readonly imageCache = new Map<string, HTMLImageElement>();
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

    // Redraw whenever the image, hues, or view options change.
    effect(() => {
      const img = this.currentImage();
      const h = this.hue();
      const regions = this.showRegions();
      const scale = this.scale();
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
    this.spriteUrl.set((event.target as HTMLSelectElement).value);
  }

  onFile(event: Event): void {
    const file = (event.target as HTMLInputElement).files?.[0];
    if (!file) return;
    if (this.objectUrl) URL.revokeObjectURL(this.objectUrl);
    this.objectUrl = URL.createObjectURL(file);
    // Register under its own label so the <select> doesn't fight it.
    const url = this.objectUrl;
    this.spriteUrl.set(url);
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

  toggleRegions(): void {
    this.showRegions.set(!this.showRegions());
  }

  toggleBg(): void {
    this.lightBg.set(!this.lightBg());
  }

  // ── Recolor (mirrors sprite-engine.ts classifyPixel + recolorImage) ──────────

  private classify(r: number, g: number, b: number, a: number): number {
    if (a < 128) return -1;
    const { h, s, v } = rgbToHsv(r, g, b);
    if (v > 0.92 && s < 0.12) return -1; // white background
    if (v < 0.28) return -1; // outline
    if (h >= 50 && h <= 80 && v > 0.4) return 1; // belly
    if (h >= 85 && h <= 135 && v > 0.5) return 0; // body
    if (h >= 85 && h <= 135 && v >= 0.28 && v <= 0.5) return 2; // stripes
    return -1;
  }

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
    const tally = { outline: 0, body: 0, belly: 0, stripes: 0 };

    for (let i = 0; i < data.length; i += 4) {
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

      const region = this.classify(r, g, b, a);
      if (region === -1) {
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

    const canvas = this.previewRef.nativeElement;
    canvas.width = w * scale;
    canvas.height = h * scale;
    const ctx = canvas.getContext('2d')!;
    ctx.clearRect(0, 0, canvas.width, canvas.height);
    ctx.imageSmoothingEnabled = false;
    ctx.drawImage(off, 0, 0, canvas.width, canvas.height);
  }
}
