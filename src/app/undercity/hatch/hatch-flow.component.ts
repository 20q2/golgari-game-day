import { Component, computed, inject, signal } from '@angular/core';
import { CommonModule } from '@angular/common';
import { MatIconModule } from '@angular/material/icon';
import { UndercityStateService } from '../services/undercity-state.service';
import { STARTERS, TIER2, FormInfo, PASSIVE_BLURBS } from '../data/forms';
import { PAINTS, PAINT_MAP, HATS, HAT_MAP, HAT_PRICES, PAINT_PRICE } from '../data/cosmetics';
import { RENOWN_SHOP_ITEMS, RenownShopItem } from '../data/items';
import { getRecoloredDataUrl } from '../engine/sprite-engine';
import { formSprite } from '../data/species';
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
  /** The creature currently showcased, resolved from `showcaseId`. */
  protected readonly showcasedForm = computed(
    () => this.starters.find((s) => s.id === this.showcaseId()) ?? null,
  );

  /** True when the creature was rolled by Bravery — grants a bonus starting roll. */
  protected readonly bravery = signal(false);

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
  protected readonly shopItems = RENOWN_SHOP_ITEMS;

  /** Cart: ids the player intends to buy this visit. */
  protected readonly cartHats = signal<string[]>([]);
  protected readonly cartPaints = signal<string[]>([]);
  protected readonly cartItems = signal<string[]>([]);
  /** Which owned/bought cosmetic to spawn wearing (null = none). */
  protected readonly equipHat = signal<string | null>(null);
  protected readonly equipPaint = signal<string | null>(null);

  protected readonly balance = computed(() => this.store.wardrobe()?.renown ?? 0);

  private hatPrice(id: string): number {
    return this.hatPrices[HAT_MAP[id].rarity];
  }

  /** Renown committed by the current cart. */
  protected readonly cartCost = computed(() => {
    let sum = 0;
    for (const h of this.cartHats()) sum += this.hatPrice(h);
    sum += this.cartPaints().length * this.paintPrice;
    for (const i of this.cartItems()) {
      const it = this.shopItems.find((s) => s.id === i);
      if (it) sum += it.cost;
    }
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

  /** Consumable slots the starter kit would use, guarded against BAG_SIZE (3). */
  private cartBagCount(): number {
    return this.cartItems().filter(
      (i) => this.shopItems.find((s) => s.id === i)?.kind === 'consumable',
    ).length;
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
      perk: 'Glowblessed', blurb: '+10% flee chance.' },
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

  spriteUrl(starter: FormInfo): string | null {
    const spr = formSprite(starter.id);
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
    saproling: 'Tank',
    zombie: 'Horde',
  };
  archetype(form: FormInfo): string {
    return HatchFlowComponent.ARCHETYPES[form.id] ?? 'Balanced';
  }

  /** Per-stat bar scales, chosen for headroom above the starter spread so the
   *  bars read as relative strengths rather than all pinning to full. */
  private static readonly STAT_MAX: Record<string, number> = { hp: 40, atk: 10, def: 10, spd: 10 };

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
    this.showcaseId.set(starter.id);
  }

  /**
   * Step 1a (Bravery): let fate roll a creature and reveal it in the showcase.
   * The bonus starting roll is granted server-side from the `bravery` flag,
   * which is committed alongside the pick in `confirmShowcase`.
   */
  openBravery(): void {
    const pick = this.starters[Math.floor(Math.random() * this.starters.length)];
    this.braveryReveal.set(true);
    this.showcaseId.set(pick.id);
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

  /** One-tap balanced starter: +2 ATK fang and +2 DEF carapace (25+25 = full 50). */
  fillRecommendedKit(): void {
    this.cartItems.set(['rusted_fang', 'chitin_scrap']);
  }

  /** Empty the whole cart (items + cosmetics) and any pending equips. */
  clearCart(): void {
    this.cartItems.set([]);
    this.cartHats.set([]);
    this.cartPaints.set([]);
    this.equipHat.set(null);
    this.equipPaint.set(null);
  }

  toggleItem(item: RenownShopItem): void {
    const cart = this.cartItems();
    if (cart.includes(item.id)) {
      this.cartItems.set(cart.filter((i) => i !== item.id));
    } else if (this.canAfford(item.cost)) {
      if (item.kind === 'consumable' && this.cartBagCount() >= 3) return;
      this.cartItems.set([...cart, item.id]);
    }
  }

  wearHat(id: string | null): void {
    this.equipHat.set(this.equipHat() === id ? null : id);
  }
  wearPaint(id: string | null): void {
    this.equipPaint.set(this.equipPaint() === id ? null : id);
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
        buyItems: this.cartItems(),
        equipHat: this.equipHat(),
        equipPaint: this.equipPaint(),
        bravery: this.bravery(),
      });
    } catch (e) {
      this.error.set(e instanceof Error ? e.message : 'Could not hatch');
      this.joining.set(false);
    }
  }
}
