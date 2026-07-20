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

@Component({
  selector: 'app-undercity-hatch-flow',
  standalone: true,
  imports: [CommonModule, MatIconModule],
  templateUrl: './hatch-flow.component.html',
  styleUrls: ['./hatch-flow.component.scss'],
})
export class HatchFlowComponent {
  protected readonly store = inject(UndercityStateService);

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

  /** Home biomes — mirrors BIOMES in undercity_data.py (id order = display). */
  protected readonly biomes = [
    { id: 'city', name: 'The Undercity', icon: 'location_city',
      perk: 'City Rat', blurb: '+15 starting Spores.' },
    { id: 'cavern', name: 'Mosslight Cavern', icon: 'diamond',
      perk: 'Glowblessed', blurb: '+10% flee chance.' },
    { id: 'bog', name: 'The Sedgemoor', icon: 'water',
      perk: 'Mirefoot', blurb: 'Hazards cost you half.' },
    { id: 'bone', name: 'Ossuary Fields', icon: 'skull',
      perk: 'Marrowborn', blurb: '+2 DEF against wild creatures.' },
    { id: 'garden', name: 'The Rot-Gardens', icon: 'psychiatry',
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

  paintName(hue: number): string {
    return PAINTS.find((p) => p.hue === hue)?.name ?? PAINT_MAP['forest'].name;
  }

  /** Step 1: pick the creature, then advance to the home-biome choice. */
  chooseStarter(starter: FormInfo): void {
    this.bravery.set(false);
    this.chosenStarter.set(starter);
  }

  /**
   * Step 1 (Bravery): let fate choose the creature and bank a bonus starting
   * roll for the nerve. The pick is revealed so naming/biome/shop proceed as
   * normal; the bonus roll is granted server-side from the `bravery` flag.
   */
  chooseBravery(): void {
    const pick = this.starters[Math.floor(Math.random() * this.starters.length)];
    this.bravery.set(true);
    this.chosenStarter.set(pick);
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
