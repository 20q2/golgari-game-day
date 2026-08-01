import { Component, computed, effect, inject, signal } from '@angular/core';
import { CommonModule } from '@angular/common';
import { FormsModule } from '@angular/forms';
import { MatIconModule } from '@angular/material/icon';
import { UndercityStateService } from '../services/undercity-state.service';
import {
  FormInfo,
  PASSIVE_BLURBS,
  PASSIVE_NAMES,
  evolutionOptions,
  formName,
  xpToNext,
} from '../data/forms';
import { GEAR_MAP, CONSUMABLE_MAP, tierRarity, marketBand, MarketKind } from '../data/items';
import { RIDER_AUGMENTS } from '../data/combat';
import {
  innateSpellIds,
  GRIMOIRE_MAP,
  GRIMOIRES,
  GrimoireInfo,
  SPELL_MAP,
  SpellInfo,
  cooldownLeftMin,
  grimoireSwapLeftMin,
} from '../data/spells';
import {
  HATS,
  PAINTS,
  SPECIAL_PAINTS,
  SPECIAL_PAINT_SWATCH,
  paintSwatchCss,
  HatInfo,
  PaintInfo,
  SpecialPaintInfo,
} from '../data/cosmetics';
import { PERKS, PERK_TRACKS, PerkTrack } from '../data/perks';
import { formSprite } from '../data/species';
import { getRecoloredDataUrl, getRecoloredWithHatEffectDataUrl } from '../engine/sprite-engine';
import { isShielded } from '../services/undercity-models';
import { DUNGEONS, SIGILS_REQUIRED } from '../data/dungeons';
import { regionInfo } from '../data/regions';
import { UcActionBandComponent } from './action-band.component';

type CreatureSubTab = 'stats' | 'gear' | 'wardrobe' | 'sigils';

/** localStorage key remembering the last-open creature sub-tab across tab
 *  switches (the component is destroyed when you leave) and page reloads. */
const SUBTAB_KEY = 'uc-creature-subtab';
const SUBTABS: readonly CreatureSubTab[] = ['stats', 'gear', 'wardrobe', 'sigils'];

function loadSubTab(): CreatureSubTab {
  try {
    const v = localStorage.getItem(SUBTAB_KEY) as CreatureSubTab | null;
    if (v && SUBTABS.includes(v)) return v;
  } catch {
    /* storage blocked — fall back to the default */
  }
  return 'stats';
}

type GearSection = 'home' | 'equip' | 'magic' | 'bag';

/** localStorage key remembering which gear section (hub or a drilled-in
 *  panel) was last open, so returning to the Gear tab restores it. */
const GEAR_SECTION_KEY = 'uc-gear-section';
const GEAR_SECTIONS: readonly GearSection[] = ['home', 'equip', 'magic', 'bag'];

function loadGearSection(): GearSection {
  try {
    const v = localStorage.getItem(GEAR_SECTION_KEY) as GearSection | null;
    if (v && GEAR_SECTIONS.includes(v)) return v;
  } catch {
    /* storage blocked — fall back to the hub */
  }
  return 'home';
}

type ItemSource = 'equipped' | 'stash' | 'bag';

/** A chip rendered in the item-detail popup. Stat chips have no blurb;
 *  ability chips carry an expandable blurb explaining what they do. */
interface ItemChip {
  label: string;
  blurb?: string;
}

/** The inventory item whose detail popup is open. `index` is the array index
 *  used by market-list / equip-gear (stash or bag); -1 for equipped gear,
 *  which is info-only (no unequip action exists). */
interface SelectedItem {
  source: ItemSource;
  kind: MarketKind; // 'gear' for equipped/stash, 'consumable' for bag
  id: string;
  index: number;
  slotLabel: string; // 'Fang' | 'Carapace' | 'Charm' | item type — header sub-label
}

@Component({
  selector: 'app-undercity-creature-tab',
  standalone: true,
  imports: [CommonModule, FormsModule, MatIconModule, UcActionBandComponent],
  templateUrl: './creature-tab.component.html',
  styleUrls: ['./creature-tab.component.scss'],
})
export class CreatureTabComponent {
  protected readonly store = inject(UndercityStateService);

  protected readonly busy = signal(false);
  protected readonly toast = signal<string | null>(null);
  protected readonly showEvolve = signal(false);
  protected readonly loadedDiePick = signal(false);

  /** Which inventory item's detail popup is open (null = none). */
  protected readonly selectedItem = signal<SelectedItem | null>(null);
  /** Which ability chip inside the popup is expanded to show its blurb. */
  protected readonly expandedChip = signal<number | null>(null);
  /** Whether the popup's send-to-market price control is revealed. */
  protected readonly listOpen = signal(false);
  /** Current price typed into the send-to-market control (Spores). */
  protected readonly listPrice = signal(0);

  /** Which sub-panel of the creature screen is showing below the pinned hero.
   *  Seeded from and persisted to localStorage so it survives leaving the tab. */
  protected readonly subTab = signal<CreatureSubTab>(loadSubTab());

  /** Which gear section is showing: the hub grid ('home') or a drilled-in
   *  panel. Seeded from and persisted to localStorage so the last-open
   *  section is restored when the player returns to the Gear tab. */
  protected readonly gearSection = signal<GearSection>(loadGearSection());

  constructor() {
    effect(() => {
      const tab = this.subTab();
      try {
        localStorage.setItem(SUBTAB_KEY, tab);
      } catch {
        /* storage full/blocked — stay session-only */
      }
    });

    effect(() => {
      const section = this.gearSection();
      try {
        localStorage.setItem(GEAR_SECTION_KEY, section);
      } catch {
        /* storage full/blocked — stay session-only */
      }
    });
  }

  /** Which stat's description panel is open ('atk' | 'def' | 'spd' | null). */
  protected readonly openStat = signal<string | null>(null);

  /** The stat mid-celebration after a point was spent, plus the number it
   *  rolled up from — drives the count-up flourish on the tile. */
  protected readonly rollStat = signal<string | null>(null);
  protected readonly rollFrom = signal(0);

  /** Plain-language stat descriptions, matching the battle engine's math. */
  protected readonly statInfo: Record<string, { label: string; icon: string; desc: string }> = {
    atk: {
      label: 'Attack',
      icon: 'uc-sword',
      desc: "The muscle behind each strike. Higher ATK means more damage per hit — minus whatever the enemy's DEF soaks up.",
    },
    def: {
      label: 'Defense',
      icon: 'uc-shield',
      desc: 'Armor against blows. Every point of DEF shaves damage off each hit you take.',
    },
    spd: {
      label: 'Speed',
      icon: 'uc-bolt',
      desc: "Strike first when it beats your foe's Speed, and slip away more often when you try to flee.",
    },
  };

  selectStat(stat: string): void {
    this.openStat.update((cur) => (cur === stat ? null : stat));
  }

  /** Open a gear section from the hub, or return to the hub with 'home'. */
  selectGear(section: GearSection): void {
    this.gearSection.set(section);
  }

  /** Bottom-bar Gear button: entering the tab restores the remembered section;
   *  tapping it again while already on Gear pops back to the hub. */
  selectGearTab(): void {
    if (this.subTab() === 'gear') {
      this.gearSection.set('home');
    } else {
      this.subTab.set('gear');
    }
  }

  /** Flat stat bonus contributed by currently-equipped gear, per stat.
   * Mirrors the backend's effective_stats() gear sum — the stored atk/def/spd
   * on `you` are base values, so this surfaces what the gear adds on top. */
  protected readonly gearMods = computed<Record<string, number>>(() => {
    const gear = this.store.you()?.gear ?? {};
    const mods: Record<string, number> = { atk: 0, def: 0, spd: 0, maxHp: 0 };
    for (const id of Object.values(gear)) {
      const g = id ? GEAR_MAP[id] : undefined;
      if (!g) continue;
      mods['atk'] += g.atk ?? 0;
      mods['def'] += g.def ?? 0;
      mods['spd'] += g.spd ?? 0;
      mods['maxHp'] += g.maxHp ?? 0;
    }
    return mods;
  });

  /** The three combat stats as {base, gear, total} rows — powers the compact
   *  preview at the top of the Gear tab so equipping/swapping shows its effect. */
  protected readonly statPreview = computed(() => {
    const you = this.store.you();
    const mods = this.gearMods();
    if (!you) return [];
    return (['atk', 'def', 'spd'] as const).map((key) => ({
      key,
      label: key.toUpperCase(),
      icon: this.statInfo[key].icon,
      base: you[key],
      mod: mods[key] ?? 0,
    }));
  });

  /** Max held stash pieces (mirrors GEAR_STASH_SIZE in undercity_data.py). */
  protected readonly stashCap = 6;

  /** Unequipped gear you're carrying, keyed by its stash index for equip-gear. */
  protected readonly stashRows = computed(() =>
    (this.store.you()?.gearStash ?? [])
      .map((id, index) => ({ index, info: GEAR_MAP[id] }))
      .filter((r) => !!r.info),
  );

  /** How many of the three gear slots are filled — the Equipment tile count. */
  protected readonly wornCount = computed(() => {
    const gear = this.store.you()?.gear ?? {};
    return (['fang', 'carapace', 'charm'] as const).filter((s) => gear[s]).length;
  });

  /** Compact "ATK +2 · DEF +1" summary of equipped gear's stat bonuses, or ''
   *  when gear adds nothing — the Equipment tile pill. */
  protected readonly gearModLabel = computed(() => {
    const m = this.gearMods();
    const parts: string[] = [];
    if (m['atk']) parts.push(`ATK +${m['atk']}`);
    if (m['def']) parts.push(`DEF +${m['def']}`);
    if (m['spd']) parts.push(`SPD +${m['spd']}`);
    if (m['maxHp']) parts.push(`+${m['maxHp']} HP`);
    return parts.join(' · ');
  });

  /** Innate + open-book spells currently off cooldown — the Magic tile pill. */
  protected readonly spellsReadyCount = computed(() => {
    const you = this.store.you();
    if (!you) return 0;
    let n = this.innateSpells().filter((sp) => this.cooldownLabel(sp.id) === 'Ready').length;
    const book = this.equippedBook();
    if (book) n += this.bookSpells(book).filter((sp) => this.cooldownLabel(sp.id) === 'Ready').length;
    return n;
  });

  /** Equip a stash piece into its slot; the worn piece swaps back to the stash.
   *  Same server action the Salvage Yard uses — index-based, server picks slot. */
  async equipFromStash(index: number): Promise<void> {
    await this.run(async () => {
      const resp = await this.store.action('equip-gear', { index });
      this.showToast(resp.text ?? 'Equipped.');
    });
  }

  // ── Item-detail popup ─────────────────────────────────────────────────────
  protected readonly marketBand = marketBand;

  /** Open the item-detail popup for an inventory item. */
  protected selectItem(source: ItemSource, id: string, index: number, slotLabel: string): void {
    if (!id) return;
    const kind: MarketKind = source === 'bag' ? 'consumable' : 'gear';
    this.expandedChip.set(null);
    this.listOpen.set(false);
    this.selectedItem.set({ source, kind, id, index, slotLabel });
  }

  /** Close the popup and reset its transient state. */
  protected closeItem(): void {
    this.selectedItem.set(null);
    this.expandedChip.set(null);
    this.listOpen.set(false);
  }

  /** Toggle an ability chip's blurb open/closed. */
  protected toggleChip(i: number): void {
    this.expandedChip.update((cur) => (cur === i ? null : i));
  }

  /** Stat chips (+2 ATK, +1 SPD, +3 max HP) for a gear item; empty for others. */
  protected statChips(item: SelectedItem): ItemChip[] {
    if (item.kind !== 'gear') return [];
    const g = GEAR_MAP[item.id];
    if (!g) return [];
    const chips: ItemChip[] = [];
    if (g.atk) chips.push({ label: `+${g.atk} ATK` });
    if (g.def) chips.push({ label: `+${g.def} DEF` });
    if (g.spd) chips.push({ label: `+${g.spd} SPD` });
    if (g.maxHp) chips.push({ label: `+${g.maxHp} max HP` });
    return chips;
  }

  /** Expandable ability chips: gear rider + illumination, or a consumable's effect. */
  protected abilityChips(item: SelectedItem): ItemChip[] {
    if (item.kind === 'consumable') {
      const c = CONSUMABLE_MAP[item.id];
      return c ? [{ label: 'Effect', blurb: c.desc }] : [];
    }
    const g = GEAR_MAP[item.id];
    if (!g) return [];
    const chips: ItemChip[] = [];
    if (g.rider) {
      const aug = RIDER_AUGMENTS[g.rider];
      if (aug) chips.push({ label: aug.label, blurb: aug.blurb });
    }
    if (g.light === 'full') {
      chips.push({ label: 'Illuminating', blurb: 'Reveals the whole dungeon while equipped.' });
    }
    return chips;
  }

  /** Reveal the price control, seeding the cheapest allowed price. */
  protected beginList(item: SelectedItem): void {
    this.listPrice.set(this.marketBand(item.kind, item.id).lo);
    this.listOpen.set(true);
  }

  /** List the selected item on the Player Market at the typed price.
   *  Reuses the shipped `market-list` action; band + listing-cap errors come
   *  back as descriptive text and surface via the toast. */
  protected async sendToMarket(item: SelectedItem, price: number): Promise<void> {
    if (!Number.isFinite(price)) return;
    await this.run(async () => {
      const resp = await this.store.action('market-list', {
        kind: item.kind,
        index: item.index,
        price: Math.round(price),
      });
      this.showToast(resp.text ?? 'Listed on the market.');
      this.closeItem();
    });
  }

  /** Equip a stash piece from the popup, then close it. */
  protected async equipFromPopup(item: SelectedItem): Promise<void> {
    await this.equipFromStash(item.index);
    this.closeItem();
  }

  /** Use/plant a bag consumable from the popup, then close it.
   *  loaded_die keeps its picker flow (useItem returns early), so only close
   *  when the popup isn't handing off to the die picker. */
  protected async useFromPopup(item: SelectedItem): Promise<void> {
    await this.useItem(item.id);
    if (item.id !== 'loaded_die') this.closeItem();
  }

  // ── Status bubble ───────────────────────────────────────────────────────────
  protected readonly STATUS_MAX = 24;
  protected readonly editingStatus = signal(false);
  protected readonly statusDraft = signal('');

  beginEditStatus(): void {
    this.statusDraft.set(this.store.you()?.status ?? '');
    this.editingStatus.set(true);
  }

  cancelEditStatus(): void {
    this.editingStatus.set(false);
  }

  async saveStatus(): Promise<void> {
    await this.run(async () => {
      await this.store.setStatus(this.statusDraft().trim());
      this.editingStatus.set(false);
    });
  }

  protected readonly passiveBlurbs = PASSIVE_BLURBS;

  passiveName(p: string): string {
    return PASSIVE_NAMES[p] ?? p;
  }

  // ── Attribute perk tracks ──────────────────────────────────────────────────
  protected readonly perkMap = PERKS;
  protected readonly perkTracks = PERK_TRACKS;
  /** The three stat tracks, in display order. */
  protected readonly perkTrackOrder: PerkTrack[] = ['atk', 'def', 'spd'];

  /** Nodes for a track, each tagged with whether the current creature has it. */
  protected trackNodes(track: PerkTrack) {
    const you = this.store.you();
    const unlocked = new Set(you?.perks ?? []);
    return this.perkTracks[track].map((n) => ({
      perk: this.perkMap[n.id],
      threshold: n.threshold,
      lit: unlocked.has(n.id),
    }));
  }

  /** Value on a track counting toward perks: base stat + equipped gear (buffs
   *  excluded) — mirrors the server's perk_stat() and drives the "next at N". */
  protected trackValue(track: PerkTrack): number {
    const you = this.store.you();
    if (!you) return 0;
    return you[track] + (this.gearMods()[track] ?? 0);
  }
  protected readonly gearMap = GEAR_MAP;
  protected readonly tierRarity = tierRarity;
  /** Rarity key ('common'|'rare'|'legendary') for an equipped gear id, or null. */
  protected rarityKey(id: string | undefined | null): string | null {
    const g = id ? GEAR_MAP[id] : undefined;
    return g ? tierRarity(g.tier).key : null;
  }
  protected readonly consumableMap = CONSUMABLE_MAP;
  protected readonly hats = HATS;
  protected readonly paints = PAINTS;
  protected readonly specialPaints = SPECIAL_PAINTS;
  protected readonly specialPaintSwatch = SPECIAL_PAINT_SWATCH;

  /** CSS background for a paint swatch (neutral-aware). */
  protected swatchCss(value: number): string {
    return paintSwatchCss(value);
  }
  protected readonly formName = formName;
  protected readonly isShielded = isShielded;
  protected readonly dieValues = [1, 2, 3, 4, 5, 6];

  protected readonly spriteUrl = computed(() => {
    const you = this.store.you();
    if (!you) return null;
    const spr = formSprite(you.form, you.spriteVariant);
    return getRecoloredWithHatEffectDataUrl(spr.sprite, you.paint ?? {}, spr.regions, you.hat, you.effect);
  });

  /** Recolorable zones for the current form — drives the wardrobe paint groups.
   * Empty for finished art that isn't tintable, two for the insect, three for
   * the marker-based sprites. */
  protected readonly paintRegions = computed(() => {
    const you = this.store.you();
    return you ? formSprite(you.form, you.spriteVariant).regions : [];
  });

  protected readonly xpNext = computed(() => {
    const you = this.store.you();
    return you ? xpToNext(you.level) : 0;
  });

  /** The server already reports the effective max (base + every +Max HP gear
   * piece + the Carapace Grind perk) on both the state fetch and every action
   * response, so trust it directly (mirrors the HUD header). */
  protected readonly effectiveMaxHp = computed(() => {
    const you = this.store.you();
    if (!you) return 1;
    return you.maxHp;
  });

  protected readonly hpPct = computed(() => {
    const you = this.store.you();
    if (!you) return 0;
    return Math.round((you.hp / Math.max(1, this.effectiveMaxHp())) * 100);
  });

  protected readonly xpPct = computed(() => {
    const you = this.store.you();
    if (!you) return 0;
    return Math.min(100, Math.round((you.xp / Math.max(1, this.xpNext())) * 100));
  });

  /** The five biome Guild Sigils, in fixed display order. */
  protected readonly sigilEntries = Object.entries(DUNGEONS).map(([biome, d]) => ({
    biome,
    ...d,
  }));
  protected readonly sigilsRequired = SIGILS_REQUIRED;

  hasSigil(biome: string): boolean {
    return (this.store.you()?.poiClaims ?? []).includes(`${biome}_lair`);
  }

  protected readonly sigilCount = computed(() => {
    const claims = this.store.you()?.poiClaims ?? [];
    return this.sigilEntries.filter((d) => claims.includes(`${d.biome}_lair`)).length;
  });

  protected readonly evolveReady = computed(() => {
    const you = this.store.you();
    if (!you) return false;
    return (you.tier === 1 && you.level >= 5) || (you.tier === 2 && you.level >= 10);
  });

  protected readonly innateSpells = computed<SpellInfo[]>(() => {
    const you = this.store.you();
    if (!you) return [];
    return innateSpellIds(you.homeBiome, you.species, you.passives)
      .map((id) => SPELL_MAP[id])
      .filter((sp): sp is SpellInfo => !!sp);
  });

  /** The home-biome innate ability (Darkvision, Mirefoot, …), shown as a trait
   *  on the Stats tab. Resolved from the biome the player chose at the home step
   *  — the hatch perk, not the biome spell. */
  protected readonly biomeInnate = computed<{ name: string; blurb: string } | null>(() => {
    const you = this.store.you();
    if (!you) return null;
    const region = regionInfo(you.homeBiome);
    return region ? { name: region.perk, blurb: region.blurb } : null;
  });

  protected readonly equippedBook = computed<GrimoireInfo | null>(() => {
    const id = this.store.you()?.equippedGrimoire;
    return id ? (GRIMOIRE_MAP[id] ?? null) : null;
  });

  protected readonly ownedBooks = computed<GrimoireInfo[]>(() => {
    const owned = new Set(this.store.you()?.grimoires ?? []);
    return GRIMOIRES.filter((g) => owned.has(g.id));
  });

  bookSpells(book: GrimoireInfo): SpellInfo[] {
    // Prefer the player's mutable contents (inscribed at the Sedgemoor Witch),
    // falling back to the static bundle for older docs.
    const ids = this.store.you()?.grimoireSpells?.[book.id] ?? book.spells;
    return ids.map((id) => SPELL_MAP[id]).filter(Boolean);
  }

  cooldownLabel(spellId: string): string {
    const left = cooldownLeftMin(this.store.you()?.spellCooldowns, spellId);
    return left > 0 ? `${left} min` : 'Ready';
  }

  /** Minutes until a *different* grimoire can be opened (0 = ready). */
  protected readonly grimoireSwapLeft = computed(() =>
    grimoireSwapLeftMin(this.store.you()?.lastGrimoireSwap),
  );

  async equipBook(id: string): Promise<void> {
    // Clicking the already-open book is a no-op — never stow to no-book (that
    // silently strips every spell and confuses players). Opening a *different*
    // book is what the swap cooldown gates.
    if (this.store.you()?.equippedGrimoire === id) {
      this.showToast('Already open.');
      return;
    }
    await this.run(async () => {
      const resp = await this.store.action('equip-grimoire', { grimoireId: id });
      this.showToast(resp.text ?? 'Done.');
    });
    this.confirmOpen.set(null);
    this.expandedBook.set(null);
  }

  protected readonly evolveChoices = computed<FormInfo[]>(() => {
    const you = this.store.you();
    if (!you) return [];
    return evolutionOptions(you.tier, you.species, you.form);
  });

  protected readonly ownedHats = computed<HatInfo[]>(() => {
    const owned = new Set(this.store.wardrobe()?.hats ?? []);
    return HATS.filter((h) => owned.has(h.id));
  });

  protected readonly ownedPaints = computed<PaintInfo[]>(() => {
    const owned = new Set(this.store.wardrobe()?.paints ?? []);
    return PAINTS.filter((p) => owned.has(p.id));
  });

  protected readonly ownedEffects = computed<SpecialPaintInfo[]>(() => {
    const owned = new Set(this.store.wardrobe()?.effects ?? []);
    return SPECIAL_PAINTS.filter((e) => owned.has(e.id));
  });

  formSpriteUrl(form: FormInfo): string | null {
    const you = this.store.you();
    const spr = formSprite(form.id);
    return getRecoloredDataUrl(spr.sprite, you?.paint ?? {}, spr.regions);
  }

  bonusText(form: FormInfo): string {
    if (!form.bonus) return '';
    return Object.entries(form.bonus)
      .map(([k, v]) => `+${v} ${k === 'maxHp' ? 'HP' : k.toUpperCase()}`)
      .join(', ');
  }

  async spendStat(stat: string): Promise<void> {
    const you = this.store.you();
    const before = you ? (you as unknown as Record<string, number>)[stat] : 0;
    await this.run(async () => {
      await this.store.action('spend-stat', { stat });
      // Kick off the roll only once the store holds the new value.
      this.rollFrom.set(before);
      this.rollStat.set(stat);
      setTimeout(() => {
        if (this.rollStat() === stat) this.rollStat.set(null);
      }, 700);
    });
  }

  async evolve(form: FormInfo): Promise<void> {
    await this.run(async () => {
      await this.store.action('evolve', { form: form.id });
      this.showEvolve.set(false);
      this.showToast(`You are now a ${form.name}! Fully healed.`);
    });
  }

  async useItem(item: string): Promise<void> {
    if (item === 'loaded_die') {
      this.loadedDiePick.set(true);
      return;
    }
    await this.run(async () => {
      const resp = await this.store.action('use-item', { item });
      this.showToast(resp.text ?? 'Used.');
    });
  }

  /** How a bag item is actioned: usable now, planted here, a passive hold, or a
   *  battle-only consumable (so we never offer a "Use" that the server rejects). */
  protected itemAction(item: string): 'use' | 'plant' | 'passive' | 'battle' {
    if (item === 'snare') return 'plant';
    if (item === 'smoke_spore') return 'passive';
    if (CONSUMABLE_MAP[item]?.inBattle) return 'battle';
    return 'use';
  }

  /** Which owned grimoire's spell list is expanded for reading (null = none). */
  protected readonly expandedBook = signal<string | null>(null);
  /** Which grimoire has its "locks swapping for 30 min" confirm prompt live. */
  protected readonly confirmOpen = signal<string | null>(null);

  /** Expand/collapse a book for reading. The open book is never expandable —
   *  its spells already render in the top loadout panel. */
  toggleBook(id: string): void {
    if (this.store.you()?.equippedGrimoire === id) return;
    this.confirmOpen.set(null);
    this.expandedBook.set(this.expandedBook() === id ? null : id);
  }

  /** Show the swap-confirm prompt for a book. */
  askOpen(id: string): void {
    this.confirmOpen.set(id);
  }

  /** Back out of the swap-confirm prompt, leaving the book expanded to read. */
  cancelOpen(): void {
    this.confirmOpen.set(null);
  }

  async useLoadedDie(value: number): Promise<void> {
    await this.run(async () => {
      const resp = await this.store.action('use-item', { item: 'loaded_die', value });
      this.loadedDiePick.set(false);
      this.showToast(resp.text ?? 'Loaded.');
    });
  }

  async setHat(hat: string | null): Promise<void> {
    await this.run(() => this.store.action('customize', { hat: hat ?? '' }).then(() => undefined));
  }

  async setPaint(region: 'body' | 'belly' | 'stripes', paint: PaintInfo): Promise<void> {
    const you = this.store.you();
    if (!you) return;
    const next = { ...you.paint, [region]: paint.hue };
    await this.run(() => this.store.action('customize', { paint: next, hat: you.hat ?? '' }).then(() => undefined));
  }

  async setEffect(effect: string | null): Promise<void> {
    const you = this.store.you();
    if (!you) return;
    const next = you.effect === effect ? '' : (effect ?? '');
    await this.run(() =>
      this.store.action('customize', { effect: next, hat: you.hat ?? '' }).then(() => undefined),
    );
  }

  protected async run(fn: () => Promise<void>): Promise<void> {
    if (this.busy()) return;
    this.busy.set(true);
    try {
      await fn();
    } catch (e) {
      this.showToast(e instanceof Error ? e.message : 'Something went wrong');
    } finally {
      this.busy.set(false);
    }
  }

  private showToast(text: string): void {
    this.toast.set(text);
    setTimeout(() => {
      if (this.toast() === text) this.toast.set(null);
    }, 3500);
  }
}
