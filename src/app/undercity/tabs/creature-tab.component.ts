import { Component, computed, effect, inject, input, signal } from '@angular/core';
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
import {
  GEAR_MAP,
  CONSUMABLE_MAP,
  tierRarity,
  marketBand,
  pricePresets,
  MarketKind,
  SALVAGE_YIELD,
} from '../data/items';
import { gearProperty } from '../data/combat';
import {
  innateSpellIds,
  GRIMOIRE_MAP,
  GRIMOIRES,
  GrimoireInfo,
  SPELL_MAP,
  SpellInfo,
  cooldownLeftMin,
  grimoireSwapLeftMin,
  GRIMOIRE_SWAP_COOLDOWN_MIN,
  spellPowerLabel,
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
import {
  PET_SPECIES,
  Pet,
  petInfo,
  petName,
  petAbilityStats,
  petRarity,
  levelCap,
  atLevelCap,
  atMaxTier,
  levelCost,
  salvageYield,
  mergeWouldRankUp,
  mergePointsFor,
  PET_MERGE_COST,
  abilityReady,
  abilitySpacesLeft,
  petMarketBand,
  eggMarketBand,
  petRole,
  petSpriteUrl,
  eggSpriteUrl,
  Egg,
  PET_INCUBATE_SPACES,
} from '../data/pets';
import { formSprite } from '../data/species';
import { getRecoloredDataUrl, getRecoloredWithHatEffectDataUrl } from '../engine/sprite-engine';
import { isShielded } from '../services/undercity-models';
import { DUNGEONS, SIGILS_REQUIRED } from '../data/dungeons';
import { regionInfo } from '../data/regions';
import { UcActionBandComponent } from './action-band.component';

/** Fraction of a gear piece's Spore cost refunded on a sell-salvage (mirrors
 *  undercity_data.GEAR_SELL_BACK; matches the Salvage Yard in the Plaza). */
const GEAR_SELL_BACK = 0.5;

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

type GearSection = 'home' | 'equip' | 'magic' | 'bag' | 'companion';

type ItemSource = 'equipped' | 'stash' | 'bag';

/** The single-keeper merge model: the pet being raised, every OTHER owned pet as
 *  candidate fuel (any species), the ticked subset, and derived progress. */
interface MergeState {
  keeper: Pet;
  fodder: Pet[];
  selected: Pet[];
  /** keeper.mergeProgress + points from `selected`. */
  points: number;
  /** Points needed to reach the keeper's next tier. */
  need: number;
  /** Whether `selected` would advance the keeper at least one tier. */
  ready: boolean;
  currentRarity: string;
  nextRarity: string;
  /** True if any ticked fodder outranks the keeper (arms the confirm). */
  highRarityFuel: boolean;
}

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
  /** Evolution cutscene: old→new sprite data URLs, or null when idle. */
  protected readonly evolveCutscene = signal<{ from: string; to: string } | null>(null);
  /** Auto-dismiss timer for the cutscene. */
  private cutsceneTimer: ReturnType<typeof setTimeout> | null = null;
  /** Toast queued to fire when the cutscene finishes. */
  private pendingCutsceneToast: string | null = null;
  /** Full cutscene runtime — MUST match the CSS timeline in the .scss
   *  (2700ms silhouette→strobe→reveal + 2000ms shake/jump/breathe). */
  private static readonly CUTSCENE_MS = 4700;
  /** Reduced-motion runtime — MUST match the reduced-motion CSS fallback. */
  private static readonly CUTSCENE_REDUCED_MS = 600;
  protected readonly showEvolve = signal(false);
  protected readonly loadedDiePick = signal(false);

  /** Which inventory item's detail popup is open (null = none). */
  protected readonly selectedItem = signal<SelectedItem | null>(null);
  /** Whether the popup's send-to-market price control is revealed. */
  protected readonly listOpen = signal(false);
  /** Current price typed into the send-to-market control (Spores). */
  protected readonly listPrice = signal(0);

  /** Which face this instance shows: the full creature screen, or the Gear
   *  screen (its own bottom-nav destination). Gear lives here so it can reuse the
   *  hub + all the gear/companion sub-sections and popups. */
  readonly view = input<'creature' | 'gear'>('creature');

  /** Which sub-panel of the creature screen is showing below the pinned hero.
   *  Seeded from and persisted to localStorage so it survives leaving the tab. */
  protected readonly subTab = signal<CreatureSubTab>(loadSubTab());

  /** The sub-panel to actually render: always 'gear' in the Gear view; in the
   *  Creature view, gear now has its own tab so a legacy-persisted 'gear' falls
   *  back to 'stats'. */
  protected readonly activeSubTab = computed<CreatureSubTab>(() => {
    if (this.view() === 'gear') return 'gear';
    const t = this.subTab();
    return t === 'gear' ? 'stats' : t;
  });

  /** Which gear section is showing: the hub grid ('home') or a drilled-in
   *  panel. Always starts at the hub — entering the Gear tab should present
   *  the choice of Equipment / Magic / Bag, never a remembered sub-panel. */
  protected readonly gearSection = signal<GearSection>('home');

  /** Direction of the last gear-section change, driving the slide-in
   *  animation: 'forward' when drilling into a tile, 'back' returning home. */
  protected readonly gearNav = signal<'forward' | 'back'>('forward');

  constructor() {
    effect(() => {
      const tab = this.subTab();
      try {
        localStorage.setItem(SUBTAB_KEY, tab);
      } catch {
        /* storage full/blocked — stay session-only */
      }
    });
    // Nudge the player once, the poll after an incubating egg finishes warming.
    effect(() => {
      const ready = this.incubatorReady() && !!this.incubator();
      if (ready && !this.wasIncubatorReady) this.showToast('An egg is ready to hatch!');
      this.wasIncubatorReady = ready;
    });
  }

  /** Tracks the ready→toast edge so the "egg ready" nudge fires only once. */
  private wasIncubatorReady = false;

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
    this.gearNav.set(section === 'home' ? 'back' : 'forward');
    this.gearSection.set(section);
  }

  /** Bottom-bar Gear button: always lands on the hub — whether entering the
   *  tab fresh or tapping it again while already on Gear, the player sees the
   *  Equipment / Magic / Bag choice rather than a remembered sub-panel. */
  selectGearTab(): void {
    this.gearNav.set('back');
    this.gearSection.set('home');
    this.subTab.set('gear');
  }

  // ── Companions ────────────────────────────────────────────────────────────
  // Template-exposed pets.ts helpers (Angular templates can only call class
  // members, so re-bind the pure helpers here).
  protected readonly petInfo = petInfo;
  protected readonly petName = petName;
  protected readonly petAbilityStats = petAbilityStats;
  protected readonly petRarity = petRarity;
  protected readonly petLevelCap = levelCap;
  protected readonly petAtLevelCap = atLevelCap;
  protected readonly petAtMaxTier = atMaxTier;
  protected readonly petLevelCost = levelCost;
  protected readonly petSalvageYield = salvageYield;
  protected readonly petSpriteUrl = petSpriteUrl;
  protected readonly eggSpriteUrl = eggSpriteUrl;
  protected readonly PET_INCUBATE_SPACES = PET_INCUBATE_SPACES;

  /** The pet whose detail popup is open (null = none). */
  protected readonly selectedPet = signal<Pet | null>(null);
  /** Inline pet-nickname editor open? Rename is demoted from a full-width field
   *  to a pencil on the name that swaps into this editor when tapped. */
  protected readonly editingPetName = signal(false);
  /** Two-tap guard for destructive Salvage/Grind: holds the armed target's key
   *  ('pet:<id>' or 'gear:<index>'), or null. First tap arms, second fires. */
  protected readonly salvageArmed = signal<string | null>(null);
  /** Fodder pet ids ticked for a merge into the keeper. */
  protected readonly mergePicks = signal<Set<string>>(new Set());
  /** Whether the roster-wide Merge popup is open. */
  protected readonly mergeOpen = signal(false);
  /** Explicit keeper id; null = auto-pick the best non-max-tier pet. */
  protected readonly mergeKeeperId = signal<string | null>(null);
  /** Armed high-rarity-fuel confirm (a second tap actually commits the merge). */
  protected readonly mergeConfirm = signal(false);

  protected readonly activePet = computed<Pet | null>(() => {
    const you = this.store.you();
    const id = you?.activePetId;
    return (you?.pets ?? []).find((p) => p.id === id) ?? null;
  });

  /** Owned pets that aren't the active one — the roster grid. */
  protected readonly rosterPets = computed<Pet[]>(() => {
    const you = this.store.you();
    const id = you?.activePetId;
    return (you?.pets ?? []).filter((p) => p.id !== id);
  });

  /** The single-keeper merge model, or null when nothing can be ranked up. */
  protected readonly mergeState = computed<MergeState | null>(() => {
    const pets = this.store.you()?.pets ?? [];
    if (pets.length < 2) return null;
    const eligible = pets.filter((p) => !atMaxTier(p));
    if (!eligible.length) return null;
    // Auto keeper: best non-max-tier pet (tier → level → banked progress).
    const sorted = [...eligible].sort(
      (a, b) => b.tier - a.tier || b.level - a.level || b.mergeProgress - a.mergeProgress,
    );
    const overrideId = this.mergeKeeperId();
    const keeper = eligible.find((p) => p.id === overrideId) ?? sorted[0];
    const fodder = pets.filter((p) => p.id !== keeper.id);
    const picks = this.mergePicks();
    const selected = fodder.filter((p) => picks.has(p.id));
    return {
      keeper,
      fodder,
      selected,
      points: keeper.mergeProgress + mergePointsFor(selected, keeper.species),
      need: PET_MERGE_COST[keeper.tier + 1] ?? Infinity,
      ready: mergeWouldRankUp(keeper, selected),
      currentRarity: tierRarity(keeper.tier).label,
      nextRarity: tierRarity(keeper.tier + 1).label,
      highRarityFuel: selected.some((f) => f.tier > keeper.tier),
    };
  });

  /** Is there anything to merge right now? Drives the top-bar button. */
  protected readonly canMerge = computed<boolean>(() => this.mergeState() !== null);

  protected readonly eggsList = computed(() => this.store.you()?.eggs ?? []);
  protected readonly incubator = computed(() => this.store.you()?.incubator ?? null);

  /** True once the egg has been CARRIED far enough to hatch. Step timer, not a
   *  clock — legacy docs with no counter read as ready. */
  protected readonly incubatorReady = computed<boolean>(() => {
    const inc = this.incubator();
    if (!inc) return false;
    return (inc.spacesLeft ?? 0) <= 0;
  });

  /** True when the incubator slot is free but eggs are sitting uncooked — a nudge
   *  to go start one. Mutually exclusive with incubatorReady (which needs a slotted egg). */
  protected readonly eggsWaiting = computed<boolean>(
    () => !this.incubator() && this.eggsList().length > 0,
  );

  /** Board spaces still to walk before the egg hatches (0 when ready). */
  protected incubatorSpacesLeft(): number {
    return Math.max(0, this.incubator()?.spacesLeft ?? 0);
  }

  /** Can this activated pet fire right now? Every activated ability recharges by
   *  DISTANCE — its space countdown must have reached 0. */
  protected petAbilityReady(pet: Pet): boolean {
    if (petInfo(pet.species).kind !== 'activated') return false;
    const role = petRole(pet.species);
    if (role === 'forage') return this.forageSpacesLeft() <= 0;
    return abilityReady(this.store.you()?.petRecharge, role);
  }

  /** Board spaces still to walk before this pet's ability is ready (0 = ready). */
  protected petAbilitySpacesLeft(pet: Pet): number {
    const role = petRole(pet.species);
    if (role === 'forage') return this.forageSpacesLeft();
    return abilitySpacesLeft(this.store.you()?.petRecharge, role);
  }

  /** Board spaces still to walk before forage recharges (0 = ready). */
  protected forageSpacesLeft(): number {
    return this.store.you()?.forageRecharge ?? 0;
  }

  /** Role of a pet's species, for template dispatch (forage/scout/…). */
  protected petRoleOf(pet: Pet): string {
    return petRole(pet.species);
  }

  /** Spores an active economy pet has scavenged and can collect right now
   *  (server-authoritative bank). `pet` is unused now the bank lives on the doc. */
  protected economyAccruedNow(_pet: Pet): number {
    return this.store.you()?.petSporeBank ?? 0;
  }

  /** Enough materials to level this pet? */
  protected canLevelPet(pet: Pet): boolean {
    if (atLevelCap(pet)) return false;
    const cost = levelCost(pet);
    const mats = this.store.you()?.materials ?? { moltings: 0, ichor: 0 };
    return mats.moltings >= cost.moltings && mats.ichor >= cost.ichor;
  }

  protected openPet(pet: Pet): void {
    this.mergePicks.set(new Set());
    this.petListOpen.set(false);
    this.salvageArmed.set(null);
    this.selectedPet.set(pet);
  }

  protected closePet(): void {
    this.selectedPet.set(null);
    this.mergePicks.set(new Set());
    this.petListOpen.set(false);
    this.salvageArmed.set(null);
    this.editingPetName.set(false);
  }

  protected beginEditPetName(): void {
    this.editingPetName.set(true);
  }

  protected cancelEditPetName(): void {
    this.editingPetName.set(false);
  }

  /** Friendly role noun for the pet subtitle (Attacker / Defender / …). */
  protected petRoleLabel(pet: Pet): string {
    const labels: Record<string, string> = {
      attack: 'Attacker',
      defend: 'Defender',
      forage: 'Forager',
      scout: 'Scout',
      economy: 'Prospector',
    };
    return labels[petInfo(pet.species).role] ?? 'Companion';
  }

  /** One entry per rarity star to render in a roster cell (tier 1..4 = 1..4
   *  stars, colored by rarity via the cell's rarity class). */
  protected petStars(pet: Pet): number[] {
    return Array.from({ length: pet.tier }, (_, i) => i);
  }

  /** How full the level track is (0..100) for the pet-sheet progress bar. */
  protected petLevelPct(pet: Pet): number {
    const cap = levelCap(pet.tier);
    return cap <= 0 ? 0 : Math.round((pet.level / cap) * 100);
  }

  protected toggleMergePick(id: string): void {
    this.mergePicks.update((s) => {
      const next = new Set(s);
      next.has(id) ? next.delete(id) : next.add(id);
      return next;
    });
    this.mergeConfirm.set(false); // selection changed — re-evaluate high-rarity confirm
  }

  protected openMerge(): void {
    this.mergePicks.set(new Set());
    this.mergeKeeperId.set(null);
    this.mergeConfirm.set(false);
    this.mergeOpen.set(true);
  }

  protected closeMerge(): void {
    this.mergeOpen.set(false);
    this.mergeConfirm.set(false);
  }

  /** Make a pet the keeper; it can't also be fodder, so drop it from picks and
   *  disarm any pending confirm. */
  protected chooseKeeper(petId: string): void {
    this.mergeKeeperId.set(petId);
    this.mergePicks.update((s) => {
      const next = new Set(s);
      next.delete(petId);
      return next;
    });
    this.mergeConfirm.set(false);
  }

  protected mergeProgressPct(): number {
    const st = this.mergeState();
    if (!st || !st.need || st.need === Infinity) return 0;
    return Math.min(100, Math.round((st.points / st.need) * 100));
  }

  /** Merge the ticked fodder into the keeper. Higher-rarity fuel arms a confirm
   *  on the first tap; the second tap (mergeConfirm true) commits. Keeps the
   *  popup open and lets mergeState() recompute; closes only if nothing remains. */
  async doMerge(): Promise<void> {
    const st = this.mergeState();
    if (!st || !st.ready) return;
    const fodderPetIds = st.selected.map((p) => p.id);
    if (!fodderPetIds.length) return;
    if (st.highRarityFuel && !this.mergeConfirm()) {
      this.mergeConfirm.set(true);
      return;
    }
    await this.run(async () => {
      const resp = await this.store.action('merge-pet', {
        targetPetId: st.keeper.id,
        fodderPetIds,
      });
      this.showToast(resp.text ?? 'Merged.');
    });
    this.mergePicks.set(new Set());
    this.mergeKeeperId.set(null);
    this.mergeConfirm.set(false);
    if (!this.mergeState()) this.closeMerge();
  }

  async incubateEgg(eggId: string): Promise<void> {
    await this.run(async () => {
      const resp = await this.store.action('incubate-egg', { eggId });
      this.showToast(resp.text ?? 'The egg is warming.');
    });
  }

  // ── Interactive hatch: tap 3× to crack the egg, then reveal the pet ────────
  protected readonly HATCH_TAPS = 3;
  protected readonly hatchTaps = signal(0);
  protected readonly hatchShaking = signal(false);
  protected readonly hatchChunks = signal<{ id: number; t: string }[]>([]);
  /** The freshly-hatched pet, shown in the reveal overlay (null = closed). */
  protected readonly hatchReveal = signal<Pet | null>(null);
  private chunkSeq = 0;
  private hatchBusy = false;

  protected hatchRemaining(): number {
    return Math.max(0, this.HATCH_TAPS - this.hatchTaps());
  }

  /** One crack: shake the egg, throw a few shell chunks, and on the 3rd tap
   *  actually hatch it on the server and reveal what came out. */
  protected tapHatch(): void {
    if (this.hatchBusy || this.busy() || !this.incubatorReady()) return;
    this.hatchShaking.set(true);
    setTimeout(() => this.hatchShaking.set(false), 260);

    const chunks = Array.from({ length: 6 }, () => {
      const ang = Math.random() * Math.PI * 2;
      const dist = 26 + Math.random() * 22;
      const dx = Math.round(Math.cos(ang) * dist);
      const dy = Math.round(Math.sin(ang) * dist) - 10; // bias upward
      const rot = Math.round((Math.random() - 0.5) * 360);
      return { id: this.chunkSeq++, t: `translate(${dx}px, ${dy}px) rotate(${rot}deg)` };
    });
    this.hatchChunks.update((cur) => [...cur, ...chunks]);
    const ids = new Set(chunks.map((c) => c.id));
    setTimeout(() => this.hatchChunks.update((cur) => cur.filter((c) => !ids.has(c.id))), 520);

    const taps = this.hatchTaps() + 1;
    this.hatchTaps.set(taps);
    if (taps >= this.HATCH_TAPS) {
      this.hatchBusy = true;
      void this.doHatch();
    }
  }

  private async doHatch(): Promise<void> {
    const before = new Set((this.store.you()?.pets ?? []).map((p) => p.id));
    await this.run(async () => {
      const resp = await this.store.action('hatch-egg', {});
      const fresh = (this.store.you()?.pets ?? []).find((p) => !before.has(p.id));
      if (fresh) this.hatchReveal.set(fresh);
      else this.showToast(resp.text ?? 'It hatched!');
    });
    this.hatchTaps.set(0);
    this.hatchChunks.set([]);
    this.hatchBusy = false;
  }

  protected closeReveal(): void {
    this.hatchReveal.set(null);
  }

  async activateFromReveal(pet: Pet): Promise<void> {
    this.closeReveal();
    await this.activatePet(pet);
  }

  async activatePet(pet: Pet): Promise<void> {
    await this.run(async () => {
      const resp = await this.store.action('activate-pet', { petId: pet.id });
      this.showToast(resp.text ?? `${petName(pet)} is now at your side.`);
    });
    this.closePet();
  }

  /** Give the open pet a nickname (empty clears it back to the species name).
   *  Keeps the detail sheet open, re-pointed at the freshly-named instance. */
  async renamePet(pet: Pet, name: string): Promise<void> {
    await this.run(async () => {
      const resp = await this.store.action('name-pet', { petId: pet.id, name: name.trim() });
      this.showToast(resp.text ?? 'Companion renamed.');
    });
    this.editingPetName.set(false);
    this.selectedPet.set((this.store.you()?.pets ?? []).find((p) => p.id === pet.id) ?? null);
  }

  async levelPet(pet: Pet): Promise<void> {
    await this.run(async () => {
      const resp = await this.store.action('level-pet', { petId: pet.id });
      this.showToast(resp.text ?? 'Leveled up!');
      // Keep the open popup pointed at the freshened pet instance.
      const fresh = (this.store.you()?.pets ?? []).find((p) => p.id === pet.id);
      this.selectedPet.set(fresh ?? null);
    });
  }

  /** True while this exact salvage target is armed (drives the confirm label). */
  protected salvageArmedFor(key: string): boolean {
    return this.salvageArmed() === key;
  }

  /** Salvage a pet — first tap arms, second tap (still armed) salvages. */
  protected confirmSalvagePet(pet: Pet): void {
    const key = 'pet:' + pet.id;
    if (this.salvageArmed() !== key) {
      this.salvageArmed.set(key);
      return;
    }
    this.salvageArmed.set(null);
    void this.salvagePet(pet);
  }

  /** Grind (salvage) a gear item — first tap arms, second tap grinds. */
  protected confirmSalvageGear(item: SelectedItem): void {
    const key = 'gear:' + item.index;
    if (this.salvageArmed() !== key) {
      this.salvageArmed.set(key);
      return;
    }
    this.salvageArmed.set(null);
    void this.salvageFromPopup(item, 'grind');
  }

  async salvagePet(pet: Pet): Promise<void> {
    await this.run(async () => {
      const resp = await this.store.action('salvage-pet', { petId: pet.id });
      this.showToast(resp.text ?? 'Salvaged.');
    });
    this.closePet();
  }

  async usePetAbility(pet: Pet, targetNode?: string): Promise<void> {
    await this.run(async () => {
      const resp = await this.store.action('use-pet-ability', targetNode ? { targetNode } : {});
      this.showToast(resp.text ?? 'Your companion goes to work.');
    });
  }

  // ── Pet market-sell (the "Sell" disposal exit) ────────────────────────────
  protected readonly petMarketBand = petMarketBand;
  protected readonly petListOpen = signal(false);
  protected readonly petListPrice = signal(0);

  protected beginPetList(pet: Pet): void {
    this.petListPrice.set(petMarketBand(pet).lo);
    this.petListOpen.set(true);
  }

  async listPetOnMarket(pet: Pet, price: number): Promise<void> {
    if (!Number.isFinite(price)) return;
    await this.run(async () => {
      const resp = await this.store.action('market-list', { kind: 'pet', petId: pet.id, price });
      this.showToast(resp.text ?? 'Listed on the market.');
    });
    this.closePet();
  }

  // ── Egg detail popup: incubate or sell ────────────────────────────────────
  protected readonly eggMarketBand = eggMarketBand;
  protected readonly selectedEgg = signal<Egg | null>(null);
  protected readonly eggListOpen = signal(false);
  protected readonly eggListPrice = signal(0);

  protected openEgg(egg: Egg): void {
    this.eggListOpen.set(false);
    this.selectedEgg.set(egg);
  }
  protected closeEgg(): void {
    this.selectedEgg.set(null);
    this.eggListOpen.set(false);
  }
  protected beginEggList(egg: Egg): void {
    this.eggListPrice.set(eggMarketBand(egg.tier).lo);
    this.eggListOpen.set(true);
  }

  async incubateEggFromPopup(egg: Egg): Promise<void> {
    await this.incubateEgg(egg.id);
    this.closeEgg();
  }

  async listEggOnMarket(egg: Egg, price: number): Promise<void> {
    if (!Number.isFinite(price)) return;
    await this.run(async () => {
      const resp = await this.store.action('market-list', { kind: 'egg', eggId: egg.id, price });
      this.showToast(resp.text ?? 'Listed on the market.');
    });
    this.closeEgg();
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
  /** Quick-fill price buttons for a `[lo, hi]` band — see the preset rows under
   *  each market-price input. */
  protected readonly pricePresets = pricePresets;

  /** Open the item-detail popup for an inventory item. */
  protected selectItem(source: ItemSource, id: string, index: number, slotLabel: string): void {
    if (!id) return;
    const kind: MarketKind = source === 'bag' ? 'consumable' : 'gear';
    this.listOpen.set(false);
    this.salvageArmed.set(null);
    this.selectedItem.set({ source, kind, id, index, slotLabel });
  }

  /** Close the popup and reset its transient state. */
  protected closeItem(): void {
    this.selectedItem.set(null);
    this.listOpen.set(false);
    this.salvageArmed.set(null);
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

  /** Stat chips (+2 DEF, +1 SPD…) for a gear id — shown on the equipment cards. */
  protected gearStatChips(gearId: string): ItemChip[] {
    const g = GEAR_MAP[gearId];
    if (!g) return [];
    const chips: ItemChip[] = [];
    if (g.atk) chips.push({ label: `+${g.atk} ATK` });
    if (g.def) chips.push({ label: `+${g.def} DEF` });
    if (g.spd) chips.push({ label: `+${g.spd} SPD` });
    if (g.maxHp) chips.push({ label: `+${g.maxHp} max HP` });
    return chips;
  }

  /** A gear's description with its leading "+N STAT" summary stripped — those are
   *  shown as chips now. Empty for a pure stat stick with no ability text. */
  protected gearAbilityText(gearId: string): string {
    const desc = GEAR_MAP[gearId]?.desc;
    if (!desc) return '';
    const parts = desc.split(' · ');
    while (parts.length && /^[+-]?\d/.test(parts[0].trim())) parts.shift();
    return parts.join(' · ');
  }

  /** Expandable ability chips: gear rider + illumination, or a consumable's effect. */
  protected abilityChips(item: SelectedItem): ItemChip[] {
    if (item.kind === 'consumable') {
      const c = CONSUMABLE_MAP[item.id];
      return c ? [{ label: '', blurb: c.desc }] : [];
    }
    const g = GEAR_MAP[item.id];
    if (!g) return [];
    // Every piece has exactly one named property — a stance rider, or an
    // off-ladder family like Vital or Hybrid — so the card always chips
    // whatever makes this piece special.
    const prop = gearProperty(g);
    return prop ? [{ label: prop.label, blurb: prop.blurb }] : [];
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

  /** The Daemogoth Titan's signature: a 4th equipment slot. Gated on its apex
   *  Arsenal passive (which no other creature has). The extra piece is stats-only
   *  — its rider effect is inert. */
  protected readonly hasWildcardSlot = computed(() => {
    const you = this.store.you();
    return (you?.passives ?? []).includes('arsenal');
  });

  /** Equip a stash piece into the Daemogoth's wildcard slot (stats only). */
  protected async equipToWildcard(item: SelectedItem): Promise<void> {
    await this.run(async () => {
      const resp = await this.store.action('equip-gear', { index: item.index, slot: 'wild' });
      this.showToast(resp.text ?? 'Set into the wildcard slot.');
    });
    this.closeItem();
  }

  /** Grind-salvage yield (Moltings / Gemstones) for a gear tier — mirrors the
   *  Salvage Yard so the popup can preview what grinding would give. */
  protected salvageYield(tier: number): { moltings: number; ichor: number } {
    return SALVAGE_YIELD[tier] ?? { moltings: 0, ichor: 0 };
  }

  /** Spores paid for selling a gear piece back (the 50% sell-back). */
  protected sellSpores(id: string): number {
    const g = GEAR_MAP[id];
    return g ? Math.floor(g.cost * GEAR_SELL_BACK) : 0;
  }

  /** Salvage a stash piece from the popup (grind → materials, sell → Spores),
   *  then close it. Reuses the shipped `salvage-gear` action — a plaza service
   *  that isn't gated on board position, so it works straight from this tab. */
  protected async salvageFromPopup(item: SelectedItem, mode: 'grind' | 'sell'): Promise<void> {
    await this.run(async () => {
      const resp = await this.store.action('salvage-gear', { index: item.index, mode });
      this.showToast(resp.text ?? 'Salvaged.');
      this.closeItem();
    });
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

  /** Player-facing names for the recolorable zones — the underlying region keys
   * (body/belly/stripes) stay put; only the wardrobe label reads Primary etc. */
  private readonly regionLabels: Record<string, string> = {
    body: 'Primary',
    belly: 'Secondary',
    stripes: 'Accent',
  };
  protected regionLabel(region: string): string {
    return this.regionLabels[region] ?? region;
  }

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

  /** Boss codex popout (Sigils tab): the biome whose lore card is open, or null. */
  protected readonly selectedBoss = signal<string | null>(null);
  protected toggleBoss(biome: string): void {
    this.selectedBoss.update((b) => (b === biome ? null : biome));
  }
  protected readonly selectedDungeon = computed(() => {
    const b = this.selectedBoss();
    return b ? (this.sigilEntries.find((d) => d.biome === b) ?? null) : null;
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

  /** One-shot scrolls the player holds, as SpellInfos (for the Scrolls card). */
  protected readonly ownedScrolls = computed<SpellInfo[]>(() =>
    (this.store.you()?.scrolls ?? []).map((id) => SPELL_MAP[id]).filter((sp): sp is SpellInfo => !!sp),
  );

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

  /** Whether a different book can be opened right now. */
  protected readonly swapReady = computed(() => this.grimoireSwapLeft() === 0);

  /** Fraction of the swap cooldown still remaining (1 → just swapped, 0 → ready),
   *  for the draining bar on the status pill. */
  protected readonly swapPct = computed(() =>
    Math.max(0, Math.min(1, this.grimoireSwapLeft() / GRIMOIRE_SWAP_COOLDOWN_MIN)),
  );

  /** The book selected in the switcher for preview/compare. Falls back to the
   *  equipped book when nothing is picked. */
  protected readonly previewedBook = computed<GrimoireInfo | null>(() => {
    const id = this.previewBook();
    if (id) return GRIMOIRE_MAP[id] ?? this.equippedBook();
    return this.equippedBook();
  });

  /** True when the previewed book differs from the equipped one — i.e. the
   *  compare view (current vs candidate) is meaningful. */
  protected readonly isComparing = computed(() => {
    const prev = this.previewedBook();
    return !!prev && prev.id !== this.store.you()?.equippedGrimoire;
  });

  /** Level-scaled magnitude label for a spell ("14 HP", "10 dmg", '' for buffs). */
  protected readonly spellPowerLabel = spellPowerLabel;
  protected playerLevel(): number {
    return this.store.you()?.level ?? 1;
  }

  /** Source label for a spell row in the loadout list. */
  spellSource(spellId: string): 'Innate' | 'Book' {
    return this.innateSpells().some((sp) => sp.id === spellId) ? 'Innate' : 'Book';
  }

  /** Spell effects that need board context (a target, a value, or a tap-a-space)
   *  and so route to the Board's picker rather than casting inline. */
  private static readonly NEEDS_BOARD = new Set([
    'field_damage',
    'field_curse',
    'boss_strike',
    'teleport',
    'fate_die',
    'wish',
  ]);

  /** Whether tapping a spell here casts it on the spot (self-buff/heal/recall)
   *  or "aims" it — routing to the Board so its targeting picker can open. */
  spellCastsInline(sp: SpellInfo): boolean {
    return !CreatureTabComponent.NEEDS_BOARD.has(sp.effect);
  }

  /** Cast a loadout spell or held scroll straight from the Magic menu.
   *  Self-targeting effects resolve here (server cast + toast); anything needing
   *  a target/value/space hands off to the Board via the shared castRequest.
   *  Scrolls (`asScroll`) are one-shot with no cooldown — the server consumes one
   *  on success. */
  async castFromMenu(sp: SpellInfo, asScroll = false): Promise<void> {
    if (this.busy()) return;
    // Grimoire/innate spells gate on cooldown; scrolls never do.
    if (!asScroll && this.cooldownLabel(sp.id) !== 'Ready') return;
    if (!this.spellCastsInline(sp)) {
      this.store.requestBoardCast(sp.id, asScroll);
      return;
    }
    const source = asScroll
      ? 'scroll'
      : this.spellSource(sp.id) === 'Innate'
        ? 'innate'
        : 'grimoire';
    await this.run(async () => {
      const resp = await this.store.action('cast', { spellId: sp.id, source });
      this.showToast(resp.cast?.text ?? resp.text ?? `${sp.name} cast.`);
    });
  }

  async equipBook(id: string): Promise<void> {
    // Clicking the already-open book is a no-op — never stow to no-book (that
    // silently strips every spell and confuses players). Opening a *different*
    // book is what the swap cooldown gates.
    if (this.store.you()?.equippedGrimoire === id) {
      this.showToast('Already attuned.');
      return;
    }
    await this.run(async () => {
      const resp = await this.store.action('equip-grimoire', { grimoireId: id });
      this.showToast(resp.text ?? 'Done.');
    });
    this.previewBook.set(null);
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
    // Snapshot the CURRENT sprite (old form) before the server swaps our form.
    const from = this.spriteUrl();
    await this.run(async () => {
      await this.store.action('evolve', { form: form.id });
      this.showEvolve.set(false);
      // spriteUrl recomputes off the now-updated store.you() → new form.
      const to = this.spriteUrl();
      const doneToast = `You are now a ${form.name}! Fully healed.`;
      if (from && to && from !== to) {
        this.playEvolveCutscene(from, to, doneToast);
      } else {
        // Missing sprite (or identical) → fall back to the instant behavior.
        this.showToast(doneToast);
      }
    });
  }

  /** Kick off the silhouette→strobe→color cutscene. */
  private playEvolveCutscene(from: string, to: string, doneToast: string): void {
    if (this.cutsceneTimer) clearTimeout(this.cutsceneTimer);
    const reduced =
      typeof window !== 'undefined' &&
      !!window.matchMedia?.('(prefers-reduced-motion: reduce)').matches;
    const dur = reduced
      ? CreatureTabComponent.CUTSCENE_REDUCED_MS
      : CreatureTabComponent.CUTSCENE_MS;
    this.pendingCutsceneToast = doneToast;
    this.evolveCutscene.set({ from, to });
    this.cutsceneTimer = setTimeout(() => this.endEvolveCutscene(), dur);
  }

  /** End the cutscene (natural completion or tap-to-skip) and fire the toast. */
  protected endEvolveCutscene(): void {
    if (!this.evolveCutscene()) return;
    if (this.cutsceneTimer) {
      clearTimeout(this.cutsceneTimer);
      this.cutsceneTimer = null;
    }
    this.evolveCutscene.set(null);
    if (this.pendingCutsceneToast) {
      this.showToast(this.pendingCutsceneToast);
      this.pendingCutsceneToast = null;
    }
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

  /** How a bag item is actioned: usable now, a passive hold, or a battle-only
   *  consumable (so we never offer a "Use" that the server rejects). */
  protected itemAction(item: string): 'use' | 'plant' | 'passive' | 'battle' {
    if (item === 'smoke_spore') return 'passive';
    if (CONSUMABLE_MAP[item]?.inBattle) return 'battle';
    return 'use';
  }

  /** Which owned grimoire is selected in the switcher for preview/compare
   *  (null = show the equipped book). */
  protected readonly previewBook = signal<string | null>(null);

  /** Select a book in the switcher. Tapping the equipped book clears the
   *  preview back to the plain active-loadout view. */
  selectBook(id: string): void {
    this.previewBook.set(id === this.store.you()?.equippedGrimoire ? null : id);
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
