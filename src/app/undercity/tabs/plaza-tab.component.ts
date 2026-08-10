import {
  AfterViewInit,
  Component,
  ElementRef,
  OnDestroy,
  ViewChild,
  computed,
  effect,
  inject,
  signal,
} from '@angular/core';
import { CommonModule } from '@angular/common';
import { FormsModule } from '@angular/forms';
import { MatIconModule } from '@angular/material/icon';
import { UndercityStateService } from '../services/undercity-state.service';
import { PlazaCanvas, PlazaCreature } from '../engine/plaza-canvas';
import { toPlazaCreature } from '../engine/plaza-roster';
import {
  GEAR_MAP,
  CONSUMABLE_MAP,
  tierRarity,
  nextRung,
  UPGRADE_COST,
  SALVAGE_YIELD,
  marketBand,
  MarketKind,
  MARKET_MAX_LISTINGS,
  Rarity,
  RarityInfo,
  GearInfo,
} from '../data/items';
import { SPELL_MAP } from '../data/spells';
import { PET_SPECIES, PetSpecies, petSpriteUrl, eggSpriteUrl } from '../data/pets';
import { MarketListing } from '../services/undercity-models';
import { affordReason, containerFullReason, materialReason } from '../data/block-reasons';
import { UcActionBandComponent } from './action-band.component';
import { UcChatComponent } from './plaza-chat.component';
import { PokeWheelComponent } from './poke-wheel.component';

// ── Player Market browse groups & sort (design 2026-08-05) ───────────────────
type MarketFilter = 'all' | 'gear' | 'consumable' | 'scroll' | 'pets' | 'mine';

// A filter chip maps to one or more stored MarketKinds. Only "Pets" bundles more
// than one (pets + eggs); the backend still stores them distinctly (they route
// into pets[] vs eggs[] on buy) — this is display grouping.
const MARKET_GROUPS: { key: Exclude<MarketFilter, 'all' | 'mine'>; label: string; kinds: MarketKind[] }[] = [
  { key: 'gear', label: 'Gear', kinds: ['gear'] },
  { key: 'consumable', label: 'Consumables', kinds: ['consumable'] },
  { key: 'scroll', label: 'Scrolls', kinds: ['scroll'] },
  { key: 'pets', label: 'Pets', kinds: ['pet', 'egg'] },
];

// Rarity sort order, best first. Consumables carry no rarity (see marketView) and rank last.
const MARKET_RARITY_RANK: Record<Rarity, number> = { mythic: 0, legendary: 1, rare: 2, common: 3 };

/**
 * A run of the upgraded description. `same` is unchanged carry-over text; a change
 * run instead carries `from`/`to` (either may be '' for a pure delete/insert).
 * One optional-field shape (not a union) so the template can read every field.
 */
export interface DescSeg {
  same?: string;
  from?: string;
  to?: string;
}

/** Normalized display fields for a market listing, resolved from its kind. */
interface MarketView {
  name: string;
  desc: string;
  icon?: string; // material-icon ligature (consumable / scroll)
  svgIcon?: string; // gear slot svg id, e.g. 'uc-fang'
  imgUrl?: string; // pixel-art sprite (pet / egg)
  rarity?: RarityInfo; // gear / scroll tier rarity; undefined for consumables
}

interface UpgradeRow {
  where: 'equipped' | 'stash';
  slot?: string;
  index?: number;
  from: GearInfo;
  to: GearInfo;
  cost: { spores: number; moltings: number; ichor: number };
  diff: DescSeg[]; // from.desc → to.desc, word-diffed for the Blacksmith preview
}

const GEAR_SELL_BACK = 0.5; // mirrors undercity_data.GEAR_SELL_BACK

/**
 * Word-level diff of two gear descriptions for the Blacksmith upgrade preview.
 * Returns runs of the *new* description: unchanged text passes through, and any
 * span that differs becomes a `{from, to}` change so the UI can show e.g.
 * "50% → 60%" or highlight a freshly-added stat. Standard LCS backtrack; adjacent
 * deletes+inserts coalesce into one change so a bumped number reads as old→new.
 */
function descDiff(a: string, b: string): DescSeg[] {
  const at = a.split(' ');
  const bt = b.split(' ');
  const n = at.length;
  const m = bt.length;
  // LCS length table (suffixes).
  const dp: number[][] = Array.from({ length: n + 1 }, () => new Array(m + 1).fill(0));
  for (let i = n - 1; i >= 0; i--) {
    for (let j = m - 1; j >= 0; j--) {
      dp[i][j] = at[i] === bt[j] ? dp[i + 1][j + 1] + 1 : Math.max(dp[i + 1][j], dp[i][j + 1]);
    }
  }
  const ops: { t: 'same' | 'del' | 'ins'; w: string }[] = [];
  let i = 0;
  let j = 0;
  while (i < n && j < m) {
    if (at[i] === bt[j]) {
      ops.push({ t: 'same', w: bt[j] });
      i++;
      j++;
    } else if (dp[i + 1][j] >= dp[i][j + 1]) {
      ops.push({ t: 'del', w: at[i++] });
    } else {
      ops.push({ t: 'ins', w: bt[j++] });
    }
  }
  while (i < n) ops.push({ t: 'del', w: at[i++] });
  while (j < m) ops.push({ t: 'ins', w: bt[j++] });

  // Coalesce adjacent ops into display segments.
  const segs: DescSeg[] = [];
  let sameBuf: string[] = [];
  let delBuf: string[] = [];
  let insBuf: string[] = [];
  const flushSame = () => {
    if (sameBuf.length) {
      segs.push({ same: sameBuf.join(' ') });
      sameBuf = [];
    }
  };
  const flushChange = () => {
    if (delBuf.length || insBuf.length) {
      segs.push({ from: delBuf.join(' '), to: insBuf.join(' ') });
      delBuf = [];
      insBuf = [];
    }
  };
  for (const op of ops) {
    if (op.t === 'same') {
      flushChange();
      sameBuf.push(op.w);
    } else {
      flushSame();
      (op.t === 'del' ? delBuf : insBuf).push(op.w);
    }
  }
  flushSame();
  flushChange();
  return segs;
}

@Component({
  selector: 'app-undercity-plaza-tab',
  standalone: true,
  imports: [
    CommonModule,
    FormsModule,
    MatIconModule,
    UcActionBandComponent,
    UcChatComponent,
    PokeWheelComponent,
  ],
  templateUrl: './plaza-tab.component.html',
  styleUrls: ['./plaza-tab.component.scss'],
})
export class PlazaTabComponent implements AfterViewInit, OnDestroy {
  @ViewChild('plazaCanvas') canvasRef!: ElementRef<HTMLCanvasElement>;

  protected readonly store = inject(UndercityStateService);
  private plaza: PlazaCanvas | null = null;

  protected readonly selected = signal<PlazaCreature | null>(null);
  protected readonly busy = signal(false);
  protected readonly toast = signal<string | null>(null);

  protected readonly STATUS_MAX = 24;
  protected readonly statusDraft = signal('');

  // ── Forge buildings (Salvage Yard · Blacksmith) ──────────────────────────
  protected readonly gearMap = GEAR_MAP;
  protected readonly tierRarity = tierRarity;
  protected readonly building = signal<'salvage' | 'blacksmith' | 'market' | null>(null);
  protected readonly marketTab = signal<'buy' | 'sell'>('buy');
  protected readonly marketBand = marketBand;

  protected readonly materials = computed(
    () => this.store.you()?.materials ?? { moltings: 0, ichor: 0 },
  );

  /** Which material's info popover is open above the band (null = none). */
  protected readonly matInfo = signal<'moltings' | 'ichor' | null>(null);

  /** Player-facing blurbs for the two crafting materials (tap a chip to read).
   *  `ichor` is the internal id for the Gemstone the UI shows. */
  protected readonly matMeta: Record<
    'moltings' | 'ichor',
    { name: string; icon: string; desc: string }
  > = {
    moltings: {
      name: 'Moltings',
      icon: 'grass',
      desc: 'Shed husks and chitin — the common crafting material. Grind gear at the Salvage Yard, or dig them from Excavation Sites and mines. Spend them at the Blacksmith to climb a piece up its rarity ladder.',
    },
    ichor: {
      name: 'Gemstone',
      icon: 'diamond',
      desc: 'Raw crystal torn from the deep — the rare crafting material. Comes from grinding Rare-or-better gear and from deep mine strikes. The Blacksmith needs Gemstones for the top upgrade rungs.',
    },
  };

  /** Toggle a material's info popover; tapping the open one (or its card) closes it. */
  protected toggleMatInfo(kind: 'moltings' | 'ichor'): void {
    this.matInfo.update((cur) => (cur === kind ? null : kind));
  }

  protected readonly stashRows = computed(() =>
    (this.store.you()?.gearStash ?? [])
      .map((id, index) => ({ index, info: GEAR_MAP[id] }))
      .filter((r) => !!r.info),
  );

  protected readonly bagRows = computed(() =>
    (this.store.you()?.bag ?? [])
      .map((id, index) => ({ index, info: CONSUMABLE_MAP[id] }))
      .filter((r) => !!r.info),
  );

  protected readonly scrollRows = computed(() =>
    (this.store.you()?.scrolls ?? [])
      .map((id, index) => ({ index, info: SPELL_MAP[id] }))
      .filter((r) => !!r.info),
  );

  protected readonly upgradeRows = computed<UpgradeRow[]>(() => {
    const you = this.store.you();
    if (!you) return [];
    const rows: UpgradeRow[] = [];
    for (const slot of ['fang', 'carapace', 'charm']) {
      const id = you.gear?.[slot];
      const nxt = id ? nextRung(id) : null;
      if (id && nxt) {
        rows.push({ where: 'equipped', slot, from: GEAR_MAP[id], to: GEAR_MAP[nxt],
                    cost: UPGRADE_COST[GEAR_MAP[nxt].tier],
                    diff: descDiff(GEAR_MAP[id].desc, GEAR_MAP[nxt].desc) });
      }
    }
    (you.gearStash ?? []).forEach((id, index) => {
      const nxt = nextRung(id);
      if (nxt) {
        rows.push({ where: 'stash', index, from: GEAR_MAP[id], to: GEAR_MAP[nxt],
                    cost: UPGRADE_COST[GEAR_MAP[nxt].tier],
                    diff: descDiff(GEAR_MAP[id].desc, GEAR_MAP[nxt].desc) });
      }
    });
    return rows;
  });

  protected salvageYield(tier: number): { moltings: number; ichor: number } {
    return SALVAGE_YIELD[tier] ?? { moltings: 0, ichor: 0 };
  }
  protected sellSpores(info: GearInfo): number {
    return Math.floor(info.cost * GEAR_SELL_BACK);
  }
  /** Why a Blacksmith upgrade is blocked (Spores first, then materials), or null
   *  when it can be forged. */
  protected upgradeReason(cost: { spores: number; moltings: number; ichor: number }): string | null {
    const you = this.store.you();
    if (!you) return 'Unavailable';
    const m = this.materials();
    return (
      affordReason(you.spores, cost.spores) ??
      materialReason(m.moltings, m.ichor, cost.moltings, cost.ichor)
    );
  }
  /** The displayed block note for an upgrade. Spore shortfalls only — a material
   *  shortfall is already spelled out by the cost line, so it gets no note. */
  protected upgradeNote(cost: { spores: number; moltings: number; ichor: number }): string | null {
    const you = this.store.you();
    if (!you) return 'Unavailable';
    return affordReason(you.spores, cost.spores);
  }

  private marketView(kind: MarketKind, id: string, payload?: MarketListing['payload']): MarketView | null {
    if (kind === 'gear') {
      const g = GEAR_MAP[id];
      if (!g) return null;
      return { name: g.name, desc: g.desc, svgIcon: 'uc-' + g.slot, rarity: tierRarity(g.tier) };
    }
    if (kind === 'consumable') {
      const c = CONSUMABLE_MAP[id];
      if (!c) return null;
      return { name: c.name, desc: c.desc, icon: c.icon };
    }
    if (kind === 'pet') {
      const sp = payload?.species ? PET_SPECIES[payload.species as PetSpecies] : undefined;
      const tier = payload?.tier ?? 1;
      return {
        name: sp?.name ?? id ?? 'Companion',
        desc: sp?.blurb ?? 'A companion.',
        icon: sp?.icon ?? 'pets',
        imgUrl: payload?.species ? petSpriteUrl(payload.species) : undefined,
        rarity: tierRarity(tier),
      };
    }
    if (kind === 'egg') {
      const tier = payload?.tier ?? 1;
      return {
        name: `${tierRarity(tier).label} Egg`,
        desc: 'Incubate it to hatch a companion.',
        icon: 'egg',
        imgUrl: eggSpriteUrl(tier),
        rarity: tierRarity(tier),
      };
    }
    const s = SPELL_MAP[id];
    if (!s) return null;
    return { name: s.name, desc: s.desc, icon: s.icon, rarity: tierRarity(s.tier) };
  }

  // Player Market listings, normalized by kind + own-listing flag.
  protected readonly marketRows = computed(() =>
    this.store
      .market()
      .map((l) => {
        const kind = (l.kind ?? 'gear') as MarketKind;
        const itemId = l.itemId ?? l.gearId ?? '';
        return {
          id: l.id,
          itemId,
          price: l.price,
          sellerName: l.sellerName,
          kind,
          view: this.marketView(kind, itemId, l.payload),
          own: l.sellerId === this.store.ownUserId,
        };
      })
      .filter((r) => !!r.view),
  );

  /** Why a market Buy is blocked (destination-full first, then affordability),
   *  or null when it can be bought. Own listings never reach here (Cancel shows
   *  instead). */
  protected buyReason(l: { price: number; own: boolean; kind: MarketKind }): string | null {
    const you = this.store.you();
    if (!you || l.own) return 'Unavailable';
    // Pets/eggs have no capped container (they land in pets[]/eggs[]) — only
    // affordability gates the buy.
    if (l.kind === 'pet' || l.kind === 'egg') return affordReason(you.spores, l.price);
    const held =
      l.kind === 'consumable' ? you.bag : l.kind === 'scroll' ? you.scrolls : you.gearStash;
    const cap = l.kind === 'consumable' ? 5 : 6; // BAG_SIZE=5; gearStash/scrolls=6
    const label =
      l.kind === 'consumable' ? 'Bag' : l.kind === 'scroll' ? 'Scroll satchel' : 'Stash';
    return (
      containerFullReason(held?.length ?? 0, cap, label) ?? affordReason(you.spores, l.price)
    );
  }

  // ── Player Market browse state (design 2026-08-05) ────────────────────────
  protected readonly marketFilter = signal<MarketFilter>('all');
  protected readonly marketSort = signal<'price-asc' | 'price-desc' | 'rarity'>('price-asc');
  protected readonly marketAffordable = signal(false);
  protected readonly maxListings = MARKET_MAX_LISTINGS;

  // Id of the own-listing whose price is being edited inline, or null. Only one
  // row edits at a time; opening another closes the first.
  protected readonly editingListing = signal<string | null>(null);

  protected startEdit(id: string): void {
    this.editingListing.set(id);
  }
  protected cancelEdit(): void {
    this.editingListing.set(null);
  }

  /** Chip descriptors: All + each non-empty kind group + Mine, with live counts. */
  protected readonly marketChips = computed(() => {
    const rows = this.marketRows();
    const countIn = (kinds: MarketKind[]) => rows.filter((r) => kinds.includes(r.kind)).length;
    const groups = MARKET_GROUPS.map((g) => ({
      key: g.key as MarketFilter,
      label: g.label,
      count: countIn(g.kinds),
      mine: false,
    })).filter((c) => c.count > 0);
    return [
      { key: 'all' as MarketFilter, label: 'All', count: rows.length, mine: false },
      ...groups,
      { key: 'mine' as MarketFilter, label: 'Mine', count: rows.filter((r) => r.own).length, mine: true },
    ];
  });

  /** Count of the player's own active listings (for the Mine N / cap header). */
  protected readonly mineListingCount = computed(() => this.marketRows().filter((r) => r.own).length);

  /** marketRows() narrowed by the active chip + affordability, then sorted. */
  protected readonly visibleMarketRows = computed(() => {
    const filter = this.marketFilter();
    const sort = this.marketSort();
    const spores = this.store.you()?.spores ?? 0;
    let rows = this.marketRows();

    if (filter === 'mine') {
      rows = rows.filter((r) => r.own);
    } else if (filter !== 'all') {
      const kinds = MARKET_GROUPS.find((g) => g.key === filter)?.kinds ?? [];
      rows = rows.filter((r) => kinds.includes(r.kind));
    }
    // Price-only; never hides your own; container-full stays a per-row note.
    if (this.marketAffordable() && filter !== 'mine') {
      rows = rows.filter((r) => r.own || spores >= r.price);
    }

    const rankOf = (r: (typeof rows)[number]) => {
      const rar = r.view?.rarity;
      return rar ? MARKET_RARITY_RANK[rar.key] : 4;
    };
    const nameOf = (r: (typeof rows)[number]) => r.view?.name ?? '';
    return [...rows].sort((a, b) => {
      if (sort === 'price-asc') return a.price - b.price || nameOf(a).localeCompare(nameOf(b));
      if (sort === 'price-desc') return b.price - a.price || nameOf(a).localeCompare(nameOf(b));
      return rankOf(a) - rankOf(b) || a.price - b.price || nameOf(a).localeCompare(nameOf(b));
    });
  });

  protected setMarketFilter(f: MarketFilter): void {
    this.marketFilter.set(f);
  }
  protected setMarketSort(s: 'price-asc' | 'price-desc' | 'rarity'): void {
    this.marketSort.set(s);
  }
  protected toggleMarketAffordable(): void {
    this.marketAffordable.update((v) => !v);
  }

  /** Empty-state line tailored to the active filter. */
  protected marketEmptyMessage(): string {
    const f = this.marketFilter();
    if (f === 'mine') return 'No active listings — switch to Sell to list something.';
    if (this.marketAffordable()) return 'Nothing here you can afford yet.';
    if (f === 'all') return 'The market is empty right now.';
    const label = MARKET_GROUPS.find((g) => g.key === f)?.label ?? 'items';
    return `No ${label.toLowerCase()} listed right now.`;
  }

  // Reset an emptied kind filter back to All (last of that kind bought/cancelled).
  private readonly _marketFilterGuard = effect(() => {
    const f = this.marketFilter();
    if (f === 'all' || f === 'mine') return;
    if (!this.marketChips().some((c) => c.key === f)) this.marketFilter.set('all');
  });

  protected openBuilding(b: 'salvage' | 'blacksmith' | 'market'): void {
    if (b === 'market') this.marketTab.set('buy');
    this.matInfo.set(null);
    this.building.set(b);
  }
  protected closeBuilding(): void {
    this.building.set(null);
  }

  async marketBuy(listingId: string): Promise<void> {
    if (this.busy()) return;
    this.busy.set(true);
    try {
      const resp = await this.store.action('market-buy', { listingId });
      this.showToast(resp.text ?? 'Bought.');
    } catch (e) {
      this.showToast(e instanceof Error ? e.message : 'Purchase failed');
    } finally {
      this.busy.set(false);
    }
  }

  async marketList(kind: MarketKind, index: number, price: number): Promise<void> {
    if (this.busy() || !Number.isFinite(price)) return;
    this.busy.set(true);
    try {
      const resp = await this.store.action('market-list', {
        kind,
        index,
        price: Math.round(price),
      });
      this.showToast(resp.text ?? 'Listed.');
    } catch (e) {
      this.showToast(e instanceof Error ? e.message : 'Listing failed');
    } finally {
      this.busy.set(false);
    }
  }

  async marketEdit(listingId: string, price: number): Promise<void> {
    if (this.busy() || !Number.isFinite(price)) return;
    this.busy.set(true);
    try {
      const resp = await this.store.action('market-edit', { listingId, price: Math.round(price) });
      this.editingListing.set(null);
      this.showToast(resp.text ?? 'Re-priced.');
    } catch (e) {
      this.showToast(e instanceof Error ? e.message : 'Re-pricing failed');
    } finally {
      this.busy.set(false);
    }
  }

  async marketCancel(listingId: string): Promise<void> {
    if (this.busy()) return;
    this.busy.set(true);
    try {
      const resp = await this.store.action('market-cancel', { listingId });
      this.showToast(resp.text ?? 'Cancelled.');
    } catch (e) {
      this.showToast(e instanceof Error ? e.message : 'Cancel failed');
    } finally {
      this.busy.set(false);
    }
  }

  async salvage(index: number, mode: 'grind' | 'sell'): Promise<void> {
    if (this.busy()) return;
    this.busy.set(true);
    try {
      const resp = await this.store.action('salvage-gear', { index, mode });
      this.showToast(resp.text ?? 'Salvaged.');
    } catch (e) {
      this.showToast(e instanceof Error ? e.message : 'Salvage failed');
    } finally {
      this.busy.set(false);
    }
  }

  async upgrade(row: UpgradeRow): Promise<void> {
    if (this.busy()) return;
    this.busy.set(true);
    try {
      const target =
        row.where === 'equipped'
          ? { where: 'equipped', slot: row.slot }
          : { where: 'stash', index: row.index };
      const resp = await this.store.action('upgrade-gear', { target });
      this.showToast(resp.text ?? 'Forged!');
    } catch (e) {
      this.showToast(e instanceof Error ? e.message : 'Upgrade failed');
    } finally {
      this.busy.set(false);
    }
  }

  /** Newest chat ts already bubbled (ISO strings compare chronologically);
   * undefined until the first effect run seeds it. */
  private lastChatTs?: string;

  constructor() {
    effect(() => {
      const players = this.store.players();
      if (!this.plaza) return;
      this.plaza.updatePartners(players.map(toPlazaCreature));
    });
    effect(() => {
      const diff = this.store.rosterDiff();
      if (!this.plaza) return;
      for (const id of diff.departed) this.plaza.fadeOutDino(id);
      for (const id of diff.arrived) this.plaza.dropInDino(id);
      for (const id of diff.restyled) this.plaza.boingDino(id);
    });
    // Fresh chat messages pop a speech bubble over the sender's creature.
    // The first run seeds silently so opening the plaza doesn't replay the
    // whole backlog as a bubble storm; own sends land instantly because
    // sendChat appends the echoed message before any poll.
    effect(() => {
      const msgs = this.store.chat();
      const newest = msgs.length ? msgs[msgs.length - 1].ts : '';
      if (this.lastChatTs === undefined) {
        this.lastChatTs = newest;
        return;
      }
      const fresh = msgs.filter((m) => m.ts > this.lastChatTs!);
      if (newest > this.lastChatTs) this.lastChatTs = newest;
      if (!this.plaza) return;
      for (const m of fresh) this.plaza.showChatBubble(m.userId, m.text);
    });
  }

  ngAfterViewInit(): void {
    this.plaza = new PlazaCanvas(
      this.canvasRef.nativeElement,
      this.store.players().map(toPlazaCreature),
      (creature) => {
        this.selected.set(creature);
        if (creature && creature.userId === this.store.ownUserId) {
          this.statusDraft.set(this.store.you()?.status ?? '');
        }
      },
      this.store.ownUserId,
    );
    this.plaza.start();
  }

  ngOnDestroy(): void {
    this.plaza?.stop();
    this.plaza = null;
  }

  async poke(): Promise<void> {
    const target = this.selected();
    if (!target || this.busy()) return;
    this.busy.set(true);
    try {
      const resp = await this.store.action('poke', { targetUserId: target.userId });
      this.plaza?.boingDino(target.userId);
      this.showToast(
        resp.granted
          ? `You poked ${target.username} — they gained a roll!`
          : `You poked ${target.username}.`,
      );
      this.selected.set(null);
    } catch (e) {
      this.showToast(e instanceof Error ? e.message : 'Poke failed');
    } finally {
      this.busy.set(false);
    }
  }

  async saveStatus(): Promise<void> {
    if (this.busy()) return;
    const text = this.statusDraft().trim();
    this.busy.set(true);
    try {
      await this.store.setStatus(text);
      const ownId = this.store.ownUserId;
      if (ownId) this.plaza?.setStatus(ownId, text.slice(0, this.STATUS_MAX));
      this.showToast(text ? 'Status updated.' : 'Status cleared.');
      this.selected.set(null);
    } catch (e) {
      this.showToast(e instanceof Error ? e.message : 'Could not update status');
    } finally {
      this.busy.set(false);
    }
  }

  private showToast(text: string): void {
    this.toast.set(text);
    setTimeout(() => {
      if (this.toast() === text) this.toast.set(null);
    }, 3000);
  }
}
