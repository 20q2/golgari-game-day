import { Component, computed, inject, signal } from '@angular/core';
import { CommonModule } from '@angular/common';
import { MatIconModule } from '@angular/material/icon';
import { UndercityStateService } from '../services/undercity-state.service';
import { STARTERS, TIER2, FormInfo, PASSIVE_BLURBS } from '../data/forms';
import {
  PAINTS,
  PAINT_MAP,
  HATS,
  HAT_MAP,
  HAT_PRICES,
  PAINT_PRICE,
  SPECIAL_PAINTS,
  SPECIAL_PAINT_PRICE,
  SPECIAL_PAINT_SWATCH,
  paintSwatchCss,
} from '../data/cosmetics';
import { getRecoloredDataUrl } from '../engine/sprite-engine';
import { formSprite, FORM_VARIANTS, FormVariant } from '../data/species';
import { randomCreatureName } from '../data/names';
import { IntroCutsceneComponent } from './intro-cutscene.component';

@Component({
  selector: 'app-undercity-hatch-flow',
  standalone: true,
  imports: [CommonModule, MatIconModule, IntroCutsceneComponent],
  templateUrl: './hatch-flow.component.html',
  styleUrls: ['./hatch-flow.component.scss'],
})
export class HatchFlowComponent {
  protected readonly store = inject(UndercityStateService);

  /** localStorage flag: this device has hatched at least once (drives the
   *  once-per-device novice experience, NOT the per-night intro). */
  private static readonly INTRO_KEY = 'uc.introSeen';
  /** localStorage: the seasonId whose story intro has already been watched. */
  private static readonly INTRO_SEASON_KEY = 'uc.introSeenSeason';

  /** True for a first-time player — drives the novice defaults (Bravery-first,
   *  "good first home"). Permanent per device; unlike the intro it does not replay. */
  protected readonly firstHatch = signal(!localStorage.getItem(HatchFlowComponent.INTRO_KEY));

  /** The last season whose intro was dismissed, tracked so the story replays
   *  each new night. */
  private readonly introSeenSeason = signal<string | null>(
    localStorage.getItem(HatchFlowComponent.INTRO_SEASON_KEY),
  );

  /** Show the story intro once per night: whenever the current season differs
   *  from the one we last watched it for. Stays hidden until state loads. */
  protected readonly showIntro = computed(() => {
    const seasonId = this.store.season()?.seasonId;
    if (!seasonId) {
      return false;
    }
    return this.introSeenSeason() !== seasonId;
  });

  /** Finish the intro: remember it for this night (and mark the device seen). */
  dismissIntro(): void {
    const seasonId = this.store.season()?.seasonId ?? null;
    localStorage.setItem(HatchFlowComponent.INTRO_KEY, '1');
    if (seasonId) {
      localStorage.setItem(HatchFlowComponent.INTRO_SEASON_KEY, seasonId);
    }
    this.introSeenSeason.set(seasonId);
  }

  protected readonly taps = signal(0);
  protected readonly hatched = computed(() => this.taps() >= 3);
  protected readonly eggHue = signal<number>(130);
  protected readonly joining = signal(false);
  protected readonly error = signal<string | null>(null);

  protected readonly starters = STARTERS;
  protected readonly paints = PAINTS;
  protected readonly passiveBlurbs = PASSIVE_BLURBS;

  /** Chosen creature, held while the player then picks a home biome. */
  protected readonly chosenStarter = signal<FormInfo | null>(null);

  /** Step 1a: which creature's showcase is open (null = browse the lineup). */
  protected readonly showcaseId = signal<string | null>(null);
  /** True while the open showcase was reached via Bravery (a random roll). */
  protected readonly braveryReveal = signal(false);
  /** True while the Bravery commit prompt is up (before fate rolls). Committing
   *  is blind and irreversible — that's the point — so the roll only happens
   *  once the player confirms here. */
  protected readonly braveryConfirm = signal(false);
  /** The creature currently showcased, resolved from `showcaseId`. */
  protected readonly showcasedForm = computed(
    () => this.starters.find((s) => s.id === this.showcaseId()) ?? null,
  );

  /** True when the creature was rolled by Bravery — grants a bonus starting roll. */
  protected readonly bravery = signal(false);

  /** Chosen cosmetic look for the showcased creature; null = base sprite. */
  protected readonly chosenVariant = signal<string | null>(null);

  /** Variants for the currently showcased form (empty when it has only one). */
  protected readonly showcaseVariants = computed<FormVariant[]>(() => {
    const id = this.showcaseId();
    const v = id ? FORM_VARIANTS[id] : undefined;
    return v && v.length > 1 ? v : [];
  });

  pickVariant(id: string): void {
    this.chosenVariant.set(id);
  }

  /** Chosen home biome, held while the player names the creature. */
  protected readonly chosenBiome = signal<string | null>(null);

  /** Creature name input, pre-filled with a suggestion. */
  protected readonly creatureName = signal<string>(randomCreatureName());
  protected readonly nameValid = computed(() => {
    const n = this.creatureName().trim();
    return n.length >= 1 && n.length <= 16;
  });

  /** True once the player has confirmed a name and entered the Renown shop. */
  protected readonly inShop = signal(false);

  protected readonly allHats = HATS;
  protected readonly hatPrices = HAT_PRICES;
  protected readonly paintPrice = PAINT_PRICE;
  protected readonly allSpecialPaints = SPECIAL_PAINTS;
  protected readonly specialPaintPrice = SPECIAL_PAINT_PRICE;
  protected readonly specialPaintSwatch = SPECIAL_PAINT_SWATCH;

  /** Cart: ids the player intends to buy this visit. */
  protected readonly cartHats = signal<string[]>([]);
  protected readonly cartPaints = signal<string[]>([]);
  protected readonly cartEffects = signal<string[]>([]);
  /** Which owned/bought cosmetic to spawn wearing (null = none). */
  protected readonly equipHat = signal<string | null>(null);
  protected readonly equipPaint = signal<string | null>(null);
  protected readonly equipEffect = signal<string | null>(null);

  protected readonly balance = computed(() => this.store.wardrobe()?.renown ?? 0);

  private hatPrice(id: string): number {
    return this.hatPrices[HAT_MAP[id].rarity];
  }

  /** Renown committed by the current cart. */
  protected readonly cartCost = computed(() => {
    let sum = 0;
    for (const h of this.cartHats()) sum += this.hatPrice(h);
    sum += this.cartPaints().length * this.paintPrice;
    sum += this.cartEffects().length * this.specialPaintPrice;
    return sum;
  });

  protected readonly remaining = computed(() => this.balance() - this.cartCost());

  private owned(list: string[] | undefined, id: string, cart: string[]): boolean {
    return !!list?.includes(id) || cart.includes(id);
  }

  protected ownsHat(id: string): boolean {
    return this.owned(this.store.wardrobe()?.hats, id, this.cartHats());
  }
  protected ownsPaint(id: string): boolean {
    return this.owned(this.store.wardrobe()?.paints, id, this.cartPaints());
  }
  protected ownsEffect(id: string): boolean {
    return this.owned(this.store.wardrobe()?.effects, id, this.cartEffects());
  }

  /**
   * Home biomes — mirrors BIOMES in undercity_data.py (id order = display).
   * `bg` reuses the board floor art (see LEGACY_FLOOR_SRC in board-canvas.ts);
   * `tint` is a per-biome color overlay so cards that share a floor image
   * (bog/garden, bone) still read as distinct.
   */
  protected readonly biomes = [
    { id: 'city', name: 'The Undercity', bg: 'undercity/undercity_background.png', tint: 'rgba(38, 120, 110, 0.35)',
      perk: 'City Rat', blurb: 'Hatch with a random Tier-1 item, equipped.' },
    { id: 'cavern', name: 'Mosslight Cavern', bg: 'undercity/cavern_background.png', tint: 'rgba(70, 96, 190, 0.35)',
      perk: 'Darkvision', blurb: 'See 2 spaces away in dungeons.' },
    { id: 'bog', name: 'The Sedgemoor', bg: 'undercity/swamp_background.png', tint: 'rgba(52, 110, 60, 0.32)',
      perk: 'Mirefoot', blurb: 'Hazards cost you half.' },
    { id: 'bone', name: 'Ossuary Fields', bg: 'undercity/palace_background.png', tint: 'rgba(150, 150, 130, 0.30)',
      perk: 'Marrowborn', blurb: '+8 Max HP.' },
    { id: 'garden', name: 'The Rot-Gardens', bg: 'undercity/swamp_background.png', tint: 'rgba(140, 170, 40, 0.34)',
      perk: 'Composter', blurb: '+2 Spores from every loot space.' },
  ];

  protected readonly canPickShell = computed(() => (this.store.wardrobe()?.seals ?? 0) >= 1);

  tapEgg(): void {
    if (!this.hatched()) this.taps.set(this.taps() + 1);
  }

  pickShell(hue: number): void {
    this.eggHue.set(hue);
  }

  /** CSS background for a paint swatch (neutral-aware). */
  swatchCss(value: number): string {
    return paintSwatchCss(value);
  }

  spriteUrl(starter: FormInfo, variant?: string | null): string | null {
    const spr = formSprite(starter.id, variant ?? this.chosenVariant());
    return getRecoloredDataUrl(
      spr.sprite,
      { body: this.eggHue(), belly: 50, stripes: this.eggHue(), spines: 50, spines_dark: this.eggHue() },
      spr.regions,
    );
  }

  evolutionPreview(starter: FormInfo): string {
    return TIER2.filter((f) => f.line === starter.id)
      .map((f) => f.name)
      .join(' / ');
  }

  /** One-word archetype shown under each creature in the browse lineup. */
  private static readonly ARCHETYPES: Record<string, string> = {
    pest: 'Balanced',
    kraul: 'Glass Cannon',
    saproling: 'Horde',
    zombie: 'Tank',
  };
  archetype(form: FormInfo): string {
    return HatchFlowComponent.ARCHETYPES[form.id] ?? 'Balanced';
  }

  /** Per-stat bar scales. HP is standardized across all starters, so its bar
   *  sits uniformly below full (headroom for growth). ATK/DEF/SPD use a tighter
   *  max so the 3–6 starter spread reads as distinct relative strengths rather
   *  than all clustering near half. */
  private static readonly STAT_MAX: Record<string, number> = { hp: 40, atk: 8, def: 8, spd: 8 };

  /** Stat-sheet rows for the showcase: icon, label, value, and fill percent.
   *  `icon` is a ligature mat-icon, `svg` a registered [svgIcon] (uc-* set). */
  statRows(
    form: FormInfo,
  ): { key: string; label: string; icon?: string; svg?: string; value: number; pct: number }[] {
    const s = form.stats;
    if (!s) return [];
    const pct = (k: string, v: number) =>
      Math.min(100, Math.round((v / HatchFlowComponent.STAT_MAX[k]) * 100));
    return [
      { key: 'hp', label: 'HP', icon: 'favorite', value: s.hp, pct: pct('hp', s.hp) },
      { key: 'atk', label: 'ATK', svg: 'uc-sword', value: s.atk, pct: pct('atk', s.atk) },
      { key: 'def', label: 'DEF', svg: 'uc-shield', value: s.def, pct: pct('def', s.def) },
      { key: 'spd', label: 'SPD', svg: 'uc-bolt', value: s.spd, pct: pct('spd', s.spd) },
    ];
  }

  paintName(hue: number): string {
    return PAINTS.find((p) => p.hue === hue)?.name ?? PAINT_MAP['forest'].name;
  }

  /** Step 1a: open a creature's showcase from the lineup. */
  openShowcase(starter: FormInfo): void {
    this.braveryReveal.set(false);
    this.chosenVariant.set(null);
    this.showcaseId.set(starter.id);
  }

  /**
   * Step 1a (Bravery): open the commit prompt. No roll happens yet — Bravery is
   * a blind, irreversible bargain, so the player must accept the terms before
   * fate reveals anything (see `confirmBravery`).
   */
  openBravery(): void {
    this.braveryConfirm.set(true);
  }

  /**
   * Commit to Bravery: roll a random creature and reveal it, already locked in.
   * From here there's no back-to-browse and no "pick a different creature" — the
   * only way forward is to spawn what fate dealt. The bonus starting roll is
   * granted server-side from the `bravery` flag, committed in `confirmShowcase`.
   */
  confirmBravery(): void {
    const pick = this.starters[Math.floor(Math.random() * this.starters.length)];
    this.braveryConfirm.set(false);
    this.braveryReveal.set(true);
    this.chosenVariant.set(null);
    this.showcaseId.set(pick.id);
  }

  /** Dismiss the Bravery commit prompt without rolling — back to the lineup. */
  cancelBravery(): void {
    this.braveryConfirm.set(false);
  }

  /** Close the showcase and return to the lineup. */
  backToBrowse(): void {
    this.showcaseId.set(null);
    this.braveryReveal.set(false);
  }

  /** Step 1b: commit the showcased creature, then advance to the biome choice. */
  confirmShowcase(): void {
    const form = this.showcasedForm();
    if (!form) return;
    this.bravery.set(this.braveryReveal());
    this.chosenStarter.set(form);
  }

  /** Back out of biome selection all the way to the creature lineup. */
  resetCreatureChoice(): void {
    this.chosenStarter.set(null);
    this.showcaseId.set(null);
    this.braveryReveal.set(false);
    this.bravery.set(false);
    this.chosenVariant.set(null);
  }

  /** Step 2: pick a home biome, then advance to naming. */
  chooseBiome(biomeId: string): void {
    this.chosenBiome.set(biomeId);
    this.error.set(null);
  }

  rerollName(): void {
    this.creatureName.set(randomCreatureName(this.creatureName()));
  }

  /** Advance from naming into the Renown shop. */
  enterShop(): void {
    if (!this.nameValid()) return;
    this.inShop.set(true);
  }

  private canAfford(delta: number): boolean {
    return this.remaining() - delta >= 0;
  }

  toggleHat(id: string): void {
    const cart = this.cartHats();
    if (cart.includes(id)) {
      this.cartHats.set(cart.filter((h) => h !== id));
      if (this.equipHat() === id && !this.store.wardrobe()?.hats?.includes(id)) {
        this.equipHat.set(null);
      }
    } else if (!this.ownsHat(id) && this.canAfford(this.hatPrice(id))) {
      this.cartHats.set([...cart, id]);
    }
  }

  togglePaint(id: string): void {
    const cart = this.cartPaints();
    if (cart.includes(id)) {
      this.cartPaints.set(cart.filter((p) => p !== id));
      if (this.equipPaint() === id && !this.store.wardrobe()?.paints?.includes(id)) {
        this.equipPaint.set(null);
      }
    } else if (!this.ownsPaint(id) && this.canAfford(this.paintPrice)) {
      this.cartPaints.set([...cart, id]);
    }
  }

  toggleEffect(id: string): void {
    const cart = this.cartEffects();
    if (cart.includes(id)) {
      this.cartEffects.set(cart.filter((e) => e !== id));
      if (this.equipEffect() === id && !this.store.wardrobe()?.effects?.includes(id)) {
        this.equipEffect.set(null);
      }
    } else if (!this.ownsEffect(id) && this.canAfford(this.specialPaintPrice)) {
      this.cartEffects.set([...cart, id]);
    }
  }

  /** Empty the cosmetics cart and any pending equips. */
  clearCart(): void {
    this.cartHats.set([]);
    this.cartPaints.set([]);
    this.cartEffects.set([]);
    this.equipHat.set(null);
    this.equipPaint.set(null);
    this.equipEffect.set(null);
  }

  wearHat(id: string | null): void {
    this.equipHat.set(this.equipHat() === id ? null : id);
  }
  wearPaint(id: string | null): void {
    this.equipPaint.set(this.equipPaint() === id ? null : id);
  }
  wearEffect(id: string | null): void {
    this.equipEffect.set(this.equipEffect() === id ? null : id);
  }

  /** Step 3: name the creature and hatch for real. */
  async hatch(): Promise<void> {
    const starter = this.chosenStarter();
    const biome = this.chosenBiome();
    if (!starter || !biome || this.joining() || !this.nameValid()) return;
    this.joining.set(true);
    this.error.set(null);
    try {
      await this.store.action('join', {
        starter: starter.id,
        home: biome,
        eggHue: this.eggHue(),
        creatureName: this.creatureName().trim(),
        buyHats: this.cartHats(),
        buyPaints: this.cartPaints(),
        buyEffects: this.cartEffects(),
        buyItems: [],
        equipHat: this.equipHat(),
        equipPaint: this.equipPaint(),
        equipEffect: this.equipEffect(),
        bravery: this.bravery(),
        spriteVariant: this.chosenVariant(),
      });
    } catch (e) {
      this.error.set(e instanceof Error ? e.message : 'Could not hatch');
      this.joining.set(false);
    }
  }
}
