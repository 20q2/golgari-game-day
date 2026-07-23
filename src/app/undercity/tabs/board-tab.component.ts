import {
  AfterViewInit,
  Component,
  ElementRef,
  Input,
  OnDestroy,
  ViewChild,
  computed,
  effect,
  inject,
  isDevMode,
  signal,
  untracked,
} from '@angular/core';
import { CommonModule } from '@angular/common';
import { MatIconModule } from '@angular/material/icon';
import { UndercityStateService } from '../services/undercity-state.service';
import { BoardCanvas, BoardMap, NodeInfo, SpellCastFx } from '../engine/board-canvas';
import { legalSteps, boardDistance, nodesWithin } from '../engine/board-movement';
import {
  AwayEvent,
  BattleResult,
  BattleResume,
  BattleStatus,
  BazaarView,
  CastResult,
  CombatEntry,
  CombatFlee,
  CombatRound,
  DigGrid,
  FlowPuzzleView,
  Occupant,
  PublicPlayer,
  SpaceEvent,
  Stance,
  TradeOffer,
  TradeStockItem,
  VaultView,
  isShielded,
} from '../services/undercity-models';
import { VAULT_POT_SEED } from '../data/vein-vault';
import {
  innateSpellIds,
  GRIMOIRE_MAP,
  GRIMOIRE_CAPACITY,
  GrimoireInfo,
  SPELLS,
  SPELL_MAP,
  SpellInfo,
  WITCH_SCROLL_STOCK,
  cooldownLeftMin,
  spellCategoryStyle,
  spellPowerLabel,
} from '../data/spells';
import {
  GEAR_MAP,
  CONSUMABLE_MAP,
  SPACE_NAMES,
  SPACE_BLURBS,
  SPACE_ICONS,
  SPACE_TINTS,
  NPC_ICONS,
  GearInfo,
  ConsumableInfo,
  tierRarity,
} from '../data/items';
import { DUNGEONS, SIGILS_REQUIRED, dungeonBiome } from '../data/dungeons';
import { WORLD_EVENT } from '../data/world-event';
import { formName } from '../data/forms';
import { formSprite } from '../data/species';
import { getRecoloredWithHatDataUrl } from '../engine/sprite-engine';
import { BattlePlaybackComponent, BattleSide, BattleRewards } from './battle-playback.component';
import { InteractiveBattleComponent, BattleItem, CombatStats } from './interactive-battle.component';
import { computeStanceAugments, StanceAugment } from '../data/combat';
import { DiceRollComponent } from './dice-roll.component';
import { ExcavationModalComponent } from './excavation.component';
import { FlowPuzzleModalComponent } from './flow-puzzle.component';
import { CrystalVeinModalComponent, VeinEffect } from './crystal-vein.component';
import { GuildvaultModalComponent } from './guildvault.component';
import { MysteryReelComponent } from './mystery-reel.component';
import { BoardEventFeedComponent } from './board-event-feed.component';

interface BattleView {
  battle: BattleResult;
  attacker: BattleSide;
  defender: BattleSide;
  resultText: string;
  rewards: BattleRewards | null;
}

interface LiveBattle {
  attacker: BattleSide;
  defender: BattleSide;
  personality: string;
  telegraph: Stance | null;
  kind: string;
  items: BattleItem[];
  hasScry: boolean;
  attackerStats: CombatStats | null;
  defenderStats: CombatStats | null;
  attackerStatus: BattleStatus | null;
  defenderStatus: BattleStatus | null;
  augments: StanceAugment[];
  resume: boolean;
  resumeRevealed: Stance | null;
  startRound: number;
  frenzyFrom: number | null;
  /** SPD-based escape % for the flee button (100 with a held Smoke Spore). */
  fleeChance: number | null;
}

/** A row in the top-right focus picker (a player, or Umori). */
interface FocusTarget {
  key: string;
  label: string;
  spriteUrl: string | null;
  node: string;
  isYou: boolean;
}

/** Local walk-in-progress: the spaces walked so far (start first) and steps left. */
interface StepState {
  path: string[];
  left: number;
}

function stepPos(step: StepState): string {
  return step.path[step.path.length - 1];
}

function stepPrev(step: StepState): string | null {
  return step.path.length > 1 ? step.path[step.path.length - 2] : null;
}

/** Self-buff sparkle-burst colours [fill, glow], keyed by spell id. */
const BUFF_TINT: Record<string, [string, string]> = {
  rot_surge: ['#ffb26a', '#f2670a'], // +ATK — warm ember
  harden_shell: ['#8fb6ff', '#3a6ff2'], // +DEF — steel blue
  glowveil: ['#8ff0e6', '#25c9b8'], // +SPD — cyan
};
const DEFAULT_BUFF_TINT: [string, string] = ['#ffd76a', '#f2a900']; // gold

/** Spell effect → board-canvas cast-FX shape (self_buff handled separately). */
const FX_SHAPE: Record<string, SpellCastFx['shape']> = {
  self_heal: 'heal',
  field_damage: 'damage',
  field_curse: 'curse',
  teleport: 'teleport',
  recall: 'recall',
  fate_die: 'fate',
  boss_strike: 'boss',
  wish: 'wish',
};

/** Spell effect → cast-FX [fill, glow] palette. */
const FX_TINT: Record<string, [string, string]> = {
  self_heal: ['#7fe6a0', '#3ecf6a'], // green
  field_damage: ['#ff7a4a', '#ff3b2f'], // ember red
  field_curse: ['#c77dff', '#7b2ff7'], // hex purple
  teleport: ['#7fd4ff', '#2f9bff'], // blink blue
  recall: ['#7ff0d0', '#1fbfa0'], // teal
  fate_die: ['#ffe27a', '#f2a900'], // gold shimmer
  boss_strike: ['#ffd76a', '#ff5a2f'], // gold-into-fire
  wish: ['#ffb3f0', '#a54cff'], // prismatic
};

@Component({
  selector: 'app-undercity-board-tab',
  standalone: true,
  imports: [
    CommonModule,
    MatIconModule,
    BattlePlaybackComponent,
    InteractiveBattleComponent,
    DiceRollComponent,
    ExcavationModalComponent,
    FlowPuzzleModalComponent,
    CrystalVeinModalComponent,
    GuildvaultModalComponent,
    MysteryReelComponent,
    BoardEventFeedComponent,
  ],
  templateUrl: './board-tab.component.html',
  styleUrls: ['./board-tab.component.scss'],
})
export class BoardTabComponent implements AfterViewInit, OnDestroy {
  @Input({ required: true }) map!: BoardMap;
  @ViewChild('boardCanvas') canvasRef!: ElementRef<HTMLCanvasElement>;

  protected readonly store = inject(UndercityStateService);
  private board: BoardCanvas | null = null;

  protected readonly busy = signal(false);
  protected readonly toast = signal<string | null>(null);
  protected readonly spaceModal = signal<SpaceEvent | null>(null);
  protected readonly occupants = signal<Occupant[]>([]);
  protected readonly battleView = signal<BattleView | null>(null);
  protected readonly liveBattle = signal<LiveBattle | null>(null);
  @ViewChild(InteractiveBattleComponent) private liveB?: InteractiveBattleComponent;
  protected readonly showShop = signal(false);
  protected readonly shopTab = signal<'gear' | 'consumables' | 'grimoires'>('gear');
  protected setShopTab(tab: 'gear' | 'consumables' | 'grimoires'): void {
    this.shopTab.set(tab);
    this.store.openFacility.set({ kind: 'shop', shopTab: tab });
  }
  protected readonly showShrine = signal(false);
  protected readonly showWarp = signal<string[] | null>(null);
  protected readonly showOssuary = signal(false);
  // ── Sedgemoor Witch modal state ──
  protected readonly showWitch = signal(false);
  protected readonly witchSeg = signal<'inscribe' | 'buy'>('inscribe');
  protected readonly pickedScroll = signal<string | null>(null);
  protected readonly pickedBook = signal<string | null>(null);
  protected readonly burnTarget = signal<string | null>(null);
  protected readonly showTradingPost = signal(false);
  protected readonly tradingStock = signal<TradeStockItem[]>([]);
  protected readonly giveItem = signal<string | null>(null);
  /** Index of the stock line whose trade-in picker is open (take-first flow). */
  protected readonly selectedStock = signal<number | null>(null);
  /** True once the player has spent this rotation's single barter. */
  protected readonly umoriTraded = computed(() => !!this.store.umori()?.traded);
  /** Top-right focus picker: pick any player (or Umori) to center the camera on. */
  protected readonly showFocusMenu = signal(false);
  protected readonly showExcavation = signal(false);
  protected readonly excavationGrid = signal<DigGrid | null>(null);
  protected readonly showFlowPuzzle = signal(false);
  protected readonly flowPuzzle = signal<FlowPuzzleView | null>(null);
  /** Bonus Spores from clearing a dig site — drives the "site cleared" popup. */
  protected readonly digCleared = signal<number | null>(null);
  /** Guild Sigil just claimed — drives the auto-dismissing sunburst fanfare.
   * Set when a lair-boss win reports `sigil`, shown once its battle closes. */
  protected readonly sigilCelebration = signal<{
    biomeName: string;
    lairName: string;
    lairNpcId: string;
    count: number;
    required: number;
    unsealed: boolean;
  } | null>(null);
  /** Biome awaiting its sigil fanfare until the victory screen is dismissed. */
  private pendingSigilBiome: string | null = null;
  private sigilTimer: ReturnType<typeof setTimeout> | null = null;
  protected readonly showVein = signal(false);
  protected readonly veinDepth = signal(0);
  protected readonly veinLog = signal<string | null>(null);
  /** Latest vein animation cue for the 3D wall; seq bumps so repeats retrigger. */
  protected readonly veinEffect = signal<VeinEffect | null>(null);
  protected readonly showVault = signal(false);
  protected readonly vaultView = signal<VaultView | null>(null);
  protected readonly reelSymbol = signal<string | null>(null);
  private pendingMysteryEv: SpaceEvent | null = null;
  protected readonly bet = signal(5);
  protected readonly gambleResult = signal<string | null>(null);
  protected readonly rolling = signal(false);
  protected readonly rolledValue = signal<number | null>(null);
  /** Pathfinder (SPD-10): the advantage die shown alongside the primary one. */
  protected readonly rolledValue2 = signal<number | null>(null);

  /** First-turn coach-mark: points a new player at the Roll button until they
   *  take their first roll. Persisted per device so it never returns. */
  private static readonly COACH_KEY = 'uc.coachSeen';
  protected readonly showCoach = signal(!localStorage.getItem(BoardTabComponent.COACH_KEY));
  protected dismissCoach(): void {
    if (!this.showCoach()) return;
    localStorage.setItem(BoardTabComponent.COACH_KEY, '1');
    this.showCoach.set(false);
  }

  /** Fleetfoot (SPD-5): the last roll came up 1 and may be rerolled once. */
  protected readonly canReroll = signal(false);
  protected readonly gambleRolling = signal(false);
  protected readonly gambleDie = signal<number | null>(null);
  protected readonly gambleWon = signal<boolean | null>(null);
  private pendingGambleText: string | null = null;
  private pendingGambleWon: boolean | null = null;
  private readonly stepping = signal<StepState | null>(null);
  /** Node id of the wilderness step held pending the danger notice, or null. */
  protected readonly wildsPrompt = signal<string | null>(null);
  /** Node id of a bridge (tunnel) mouth whose tollkeeper dialog is open, or
   *  null. Shown on every attempt to cross a bridge, tier-aware. */
  protected readonly bridgePrompt = signal<string | null>(null);
  private readonly ritesShown = new Set<string>();

  protected readonly showSpells = signal(false);
  /** Field spell awaiting a player target. */
  protected readonly spellTargetPick = signal<SpellInfo | null>(null);
  /** Fate-die spell awaiting a value. */
  protected readonly spellValuePick = signal<SpellInfo | null>(null);
  /** Boss-strike spell awaiting a pool choice. */
  protected readonly spellBossPick = signal<SpellInfo | null>(null);
  /** Teleport in progress: reachable nodes are highlighted on the canvas. */
  protected readonly castTeleport = signal<{ spell: SpellInfo; nodes: string[] } | null>(null);
  /** Wish: the "choose any spell" list is open. */
  protected readonly wishPick = signal(false);
  /** Wish: the chosen spell being targeted — non-null routes the cast as a Wish. */
  protected readonly wishSpell = signal<SpellInfo | null>(null);
  /** Scroll cast: the spell being cast from a one-shot scroll (source 'scroll'). */
  protected readonly scrollCast = signal<SpellInfo | null>(null);
  /** "While you were away" — populated once, from the first you-doc snapshot. */
  protected readonly awayModal = signal<AwayEvent[] | null>(null);
  private awayInitDone = false;
  private awaySeenCount = 0;

  protected readonly stepsLeft = computed(
    () => this.stepping()?.left ?? this.store.you()?.pendingMove?.value ?? 0,
  );

  protected readonly canStepBack = computed(() => (this.stepping()?.path.length ?? 0) > 1);

  /** Blade indices for the Spore Mound grass-rustle banner. */
  protected readonly grassBlades = [0, 1, 2, 3, 4, 5, 6];
  /** Round cap shown on the World Event "Engage" button. */
  protected readonly worldEventRoundCap = WORLD_EVENT.roundCap;

  protected readonly isShielded = isShielded;

  protected readonly castableSpells = computed<SpellInfo[]>(() => {
    const you = this.store.you();
    if (!you) return [];
    const ids: string[] = [];
    for (const id of innateSpellIds(you.homeBiome, you.species)) {
      if (!ids.includes(id)) ids.push(id);
    }
    const book = you.equippedGrimoire ? GRIMOIRE_MAP[you.equippedGrimoire] : null;
    if (book) for (const s of book.spells) if (!ids.includes(s)) ids.push(s);
    // Calamity Beast knows Wish regardless of loadout.
    if ((you.passives ?? []).includes('wish') && !ids.includes('wish')) ids.push('wish');
    return ids.map((id) => SPELL_MAP[id]).filter(Boolean);
  });

  /** Every spell Wish can become (all but Wish itself). */
  protected readonly allSpellsForWish = SPELLS.filter((s) => s.id !== 'wish');

  /** Held scrolls as castable SpellInfos (one-shot, source 'scroll'). */
  protected readonly castableScrolls = computed<SpellInfo[]>(() =>
    (this.store.you()?.scrolls ?? []).map((id) => SPELL_MAP[id]).filter(Boolean),
  );

  /** Cast a held scroll one-shot: target it normally, then send source 'scroll'. */
  pickScrollCast(spell: SpellInfo): void {
    this.scrollCast.set(spell);
    this.routeSpellTargeting(spell);
  }

  protected cooldownLabel(spellId: string): string {
    const left = cooldownLeftMin(this.store.you()?.spellCooldowns, spellId);
    return left > 0 ? `${left} min` : 'Ready';
  }

  /** Level-scaled magnitude label for a spell at the player's level ('' if flat). */
  protected readonly spellPowerLabel = spellPowerLabel;
  protected playerLevel(): number {
    return this.store.you()?.level ?? 1;
  }

  protected spellReady(spellId: string): boolean {
    return cooldownLeftMin(this.store.you()?.spellCooldowns, spellId) === 0;
  }

  private closedBarrierIds(): string[] {
    return this.map.nodes
      .filter(
        (n) =>
          (n.type === 'barrier' && !this.store.barriersOpen().includes(n.id)) ||
          // Post-boss escape ladders are degree-1 dead-end spurs; like a sealed
          // barrier you march up and STOP, so exact-count rolls aren't required
          // to step onto the stairwell (mirrors the server's _closed_barriers).
          // Unclaimed ones are already absent from the server's dests, so
          // listing every one-neighbour ladder here is safe.
          (n.type === 'ladder' && n.neighbors.length === 1),
      )
      .map((n) => n.id);
  }

  /** Unshielded rivals within a field spell's reach, with board distance. */
  protected spellTargets(spell: SpellInfo): { p: PublicPlayer; dist: number }[] {
    const you = this.store.you();
    if (!you || !spell.range) return [];
    const closed = this.closedBarrierIds();
    return this.store
      .players()
      .filter((p) => p.userId !== you.userId && !isShielded(p))
      .map((p) => ({
        p,
        dist: boardDistance(this.map, you.position, p.position, spell.range!, closed),
      }))
      .filter((t): t is { p: PublicPlayer; dist: number } => t.dist !== null);
  }

  /** In-range guardians/bosses a field spell can hit, with distance + HP.
   * Barrier/lair targets carry their node id; Savra carries the 'boss' token. */
  protected spellGuardianTargets(
    spell: SpellInfo,
  ): { target: string; name: string; hp: number; maxHp: number; dist: number }[] {
    const you = this.store.you();
    if (!you || !spell.range) return [];
    const closed = this.closedBarrierIds();
    const out: { target: string; name: string; hp: number; maxHp: number; dist: number }[] = [];
    for (const [node, g] of Object.entries(this.store.guardians())) {
      const dist = boardDistance(this.map, you.position, node, spell.range, closed);
      if (dist !== null) out.push({ target: node, name: g.name, hp: g.hp, maxHp: g.maxHp, dist });
    }
    const boss = this.store.state()?.boss;
    const bossNode = this.map.boss;
    if (boss && bossNode) {
      const dist = boardDistance(this.map, you.position, bossNode, spell.range, closed);
      if (dist !== null)
        out.push({ target: 'boss', name: 'Savra, the Queen', hp: boss.hp, maxHp: boss.maxHp, dist });
    }
    return out.sort((a, b) => a.dist - b.dist);
  }

  /** Live lair bosses a boss-strike spell can sear. boss_strike is range-less
   *  ("from anywhere"), so no distance filter — lairs carry their node id, which
   *  the server matches against data.LAIR_BOSSES. */
  protected spellLairTargets(): { target: string; name: string; hp: number; maxHp: number }[] {
    return Object.entries(this.store.guardians())
      .filter(([, g]) => g.kind === 'lair')
      .map(([node, g]) => ({ target: node, name: g.name, hp: g.hp, maxHp: g.maxHp }));
  }

  /** Value-picker faces for a fate_die spell: 1..maxValue (Fate Die = 6, Skitter Step = 3). */
  protected dieFaces(spell: SpellInfo): number[] {
    return Array.from({ length: spell.maxValue ?? 6 }, (_, i) => i + 1);
  }

  /** Route a spell-picker tap to the right follow-up (target/value/node/cast). */
  pickSpell(spell: SpellInfo): void {
    if (!this.spellReady(spell.id)) return;
    // Wish opens a second picker listing every spell (see pickWish).
    if (spell.effect === 'wish') {
      this.showSpells.set(false);
      this.wishPick.set(true);
      return;
    }
    this.routeSpellTargeting(spell);
  }

  /** Wish: a spell was chosen from the "any spell" list — target it like normal,
   *  but the cast goes out as a Wish (wishSpell drives castSpell's routing). */
  pickWish(spell: SpellInfo): void {
    this.wishPick.set(false);
    this.wishSpell.set(spell);
    this.routeSpellTargeting(spell);
  }

  private routeSpellTargeting(spell: SpellInfo): void {
    switch (spell.effect) {
      case 'field_damage':
      case 'field_curse':
        this.spellTargetPick.set(spell);
        break;
      case 'fate_die':
        this.spellValuePick.set(spell);
        break;
      case 'boss_strike':
        this.spellBossPick.set(spell);
        break;
      case 'teleport': {
        const you = this.store.you();
        if (!you) return;
        const nodes = nodesWithin(this.map, you.position, spell.range ?? 0, this.closedBarrierIds());
        this.showSpells.set(false);
        this.castTeleport.set({ spell, nodes });
        this.showToast('Tap a highlighted space to blink there.');
        this.syncBoard();
        break;
      }
      default:
        void this.castSpell(spell); // self_buff / self_heal / recall
    }
  }

  async castSpell(spell: SpellInfo, extra: Record<string, unknown> = {}): Promise<void> {
    const you = this.store.you();
    const wished = this.wishSpell();
    const scrolling = this.scrollCast();
    // A Wish casts the chosen spell but sends spellId 'wish' + wishSpellId.
    const isWish = !!wished && wished.id === spell.id;
    const isScroll = !isWish && !!scrolling && scrolling.id === spell.id;
    const spellId = isWish ? 'wish' : spell.id;
    const source = isWish
      ? 'wish'
      : isScroll
        ? 'scroll'
        : innateSpellIds(you?.homeBiome, you?.species).includes(spell.id)
          ? 'innate'
          : 'grimoire';
    if (isWish) extra = { wishSpellId: spell.id, ...extra };
    const preHp = you?.hp ?? 0;
    await this.run(async () => {
      const resp = await this.store.action('cast', { spellId, source, ...extra });
      this.closeSpellPickers();
      if (resp.cast) this.playCastFx(spell, resp.cast, extra);
      if (resp.cast?.text) this.showToast(resp.cast.text);
      if (resp.spaceEvent) {
        if (resp.you) this.board?.centerOn(resp.you.position);
        this.occupants.set(resp.occupants ?? []);
        this.routeSpaceEvent(resp.spaceEvent, preHp);
      }
    });
  }

  /** Fire the board animation for a resolved cast: a tinted burst for self-buffs,
   *  else a per-category bolt/puff aimed at the target token or node. For a Wish,
   *  `spell` is the underlying chosen spell, so it animates as that effect. */
  private playCastFx(spell: SpellInfo, cast: CastResult, extra: Record<string, unknown>): void {
    const me = this.store.you()?.userId;
    if (!me || !this.board) return;
    if (spell.effect === 'self_buff') {
      const [fill, glow] = BUFF_TINT[spell.id] ?? DEFAULT_BUFF_TINT;
      this.board.burstBuff(fill, glow);
      return;
    }
    const shape = FX_SHAPE[spell.effect];
    if (!shape) return;
    const rawTarget = typeof extra['target'] === 'string' ? (extra['target'] as string) : undefined;
    // field spells target a player's userId; boss/teleport target a node.
    const targetId = rawTarget && rawTarget !== 'boss' && spell.effect !== 'teleport' ? rawTarget : undefined;
    const targetNode =
      spell.effect === 'boss_strike'
        ? this.map.boss
        : spell.effect === 'teleport'
          ? rawTarget
          : undefined;
    const [color, glow] = FX_TINT[spell.effect] ?? DEFAULT_BUFF_TINT;
    this.board.playSpellCast({
      shape,
      casterId: me,
      targetId,
      targetNode,
      color,
      glow,
      dmg: cast.dodged ? undefined : cast.dmg,
      dodged: cast.dodged,
    });
  }

  /** Flash your own token when a spell landed on you (an away-note arrived). */
  private playHitFx(e: AwayEvent): void {
    const me = this.store.you()?.userId;
    if (!me || !this.board) return;
    if (e.kind === 'spell_hit') this.board.playSpellHit({ targetId: me, dmg: e.dmg });
    else if (e.kind === 'spell_dodged') this.board.playSpellHit({ targetId: me, dodged: true });
  }

  protected closeSpellPickers(): void {
    this.showSpells.set(false);
    this.spellTargetPick.set(null);
    this.spellValuePick.set(null);
    this.spellBossPick.set(null);
    this.castTeleport.set(null);
    this.wishPick.set(false);
    this.wishSpell.set(null);
    this.scrollCast.set(null);
    this.syncBoard();
  }

  protected ownsGrimoire(id: string): boolean {
    return (this.store.you()?.grimoires ?? []).includes(id);
  }

  // ── Sedgemoor Witch ────────────────────────────────────────────────────────
  protected readonly spellCategoryStyle = spellCategoryStyle;
  protected readonly witchStock = WITCH_SCROLL_STOCK;
  protected spellInfo(id: string): SpellInfo | undefined {
    return SPELL_MAP[id];
  }
  /** Spells currently in a book (mutable per-player, falling back to the bundle). */
  protected bookSpells(gid: string): string[] {
    return this.store.you()?.grimoireSpells?.[gid] ?? GRIMOIRE_MAP[gid]?.spells ?? [];
  }
  protected bookCap(gid: string): number {
    return GRIMOIRE_CAPACITY[GRIMOIRE_MAP[gid]?.tier ?? 1] ?? 2;
  }
  protected bookName(gid: string): string {
    return GRIMOIRE_MAP[gid]?.name ?? gid;
  }
  protected bookTier(gid: string): number {
    return GRIMOIRE_MAP[gid]?.tier ?? 1;
  }
  protected bookFull(gid: string): boolean {
    return this.bookSpells(gid).length >= this.bookCap(gid);
  }
  /** Fill pips for a book's capacity meter. */
  protected bookPips(gid: string): boolean[] {
    const filled = this.bookSpells(gid).length;
    return Array.from({ length: this.bookCap(gid) }, (_, i) => i < filled);
  }
  protected pickScroll(id: string): void {
    this.pickedScroll.set(this.pickedScroll() === id ? null : id);
    this.pickedBook.set(null);
    this.burnTarget.set(null);
  }
  protected pickBook(gid: string): void {
    this.pickedBook.set(this.pickedBook() === gid ? null : gid);
    this.burnTarget.set(null);
  }
  /** Inscribe requires a burn target only when the chosen book is full. */
  protected canInscribe(): boolean {
    const s = this.pickedScroll();
    const b = this.pickedBook();
    if (!s || !b) return false;
    if (this.bookSpells(b).includes(s)) return false;
    return !this.bookFull(b) || !!this.burnTarget();
  }
  async inscribe(): Promise<void> {
    const scrollSpellId = this.pickedScroll();
    const grimoireId = this.pickedBook();
    if (!scrollSpellId || !grimoireId || !this.canInscribe()) return;
    const overwriteSpellId = this.bookFull(grimoireId) ? this.burnTarget() : null;
    await this.run(async () => {
      const resp = await this.store.action('witch-inscribe', {
        scrollSpellId,
        grimoireId,
        ...(overwriteSpellId ? { overwriteSpellId } : {}),
      });
      if (resp.text) this.showToast(resp.text);
      this.pickedScroll.set(null);
      this.pickedBook.set(null);
      this.burnTarget.set(null);
    });
  }
  async buyScroll(spellId: string): Promise<void> {
    await this.run(async () => {
      const resp = await this.store.action('witch-buy-scroll', { spellId });
      if (resp.text) this.showToast(resp.text);
    });
  }
  protected closeWitch(): void {
    this.showWitch.set(false);
    this.pickedScroll.set(null);
    this.pickedBook.set(null);
    this.burnTarget.set(null);
  }

  protected grimoireSpellList(g: GrimoireInfo): string {
    return g.spells.map((s) => SPELL_MAP[s]?.name ?? s).join(', ');
  }

  // ── Trading post (leave-one-take-one, any owned item) ───────────────────
  /** Material-icon fallbacks for gear slots (battle-reward chips that can't use
   *  the svg registry). The Bazaar/Umori rows use the richer 'uc-<slot>' svgs. */
  private readonly SLOT_ICONS: Record<string, string> = {
    fang: 'hardware',
    carapace: 'shield',
    charm: 'auto_awesome',
  };

  /** Owned items that qualify as a trade-in for a given stock line — same-slot
   *  gear (equipped + stashed, equipped flagged) or, for the grimoire line, owned
   *  grimoires. Mirror of the server match rule. */
  protected qualifyingGiveOffers(stockItem: string): TradeOffer[] {
    const you = this.store.you();
    if (!you) return [];
    const gear = GEAR_MAP[stockItem];
    if (gear) {
      const slot = gear.slot;
      const offers: TradeOffer[] = [];
      const equippedId = (you.gear ?? {})[slot];
      if (equippedId && GEAR_MAP[equippedId]) {
        const g = GEAR_MAP[equippedId];
        const r = tierRarity(g.tier);
        offers.push({ id: equippedId, kind: 'gear', icon: '', slot, rarity: r.key,
                      rarityLabel: r.label, label: g.name, sub: g.desc, equipped: true });
      }
      for (const id of you.gearStash ?? []) {
        const g = GEAR_MAP[id];
        if (g && g.slot === slot) {
          const r = tierRarity(g.tier);
          offers.push({ id, kind: 'gear', icon: '', slot, rarity: r.key,
                        rarityLabel: r.label, label: g.name, sub: g.desc });
        }
      }
      return offers;
    }
    const gr = GRIMOIRE_MAP[stockItem];
    if (gr) {
      return (you.grimoires ?? []).map((id) => {
        const t = GRIMOIRE_MAP[id];
        return { id, kind: 'grimoire' as const, icon: 'menu_book',
                 label: t?.name ?? id, sub: t ? this.grimoireSpellList(t) : '' };
      });
    }
    return [];
  }

  /** Display detail for a stock line — same icon/rarity vocabulary as the Bazaar
   *  (svg slot icon + rarity badge for gear; item icon for consumables/tomes). */
  protected tradeStockDetail(id: string): TradeOffer {
    const c = CONSUMABLE_MAP[id];
    if (c) return { id, kind: 'consumable', icon: c.icon, label: c.name, sub: c.desc };
    const g = GEAR_MAP[id];
    if (g) {
      const r = tierRarity(g.tier);
      return { id, kind: 'gear', icon: '', slot: g.slot, rarity: r.key,
               rarityLabel: r.label, label: g.name, sub: g.desc };
    }
    const gr = GRIMOIRE_MAP[id];
    if (gr) return { id, kind: 'grimoire', icon: 'menu_book', label: gr.name, sub: this.grimoireSpellList(gr) };
    return { id, kind: 'consumable', icon: 'help', label: id, sub: '' };
  }

  /** Whether a stock line's "Trade for this" button is live — mirrors the three
   *  server disable conditions. */
  protected canTradeFor(stockItem: string): boolean {
    if (this.umoriTraded()) return false;
    const gives = this.qualifyingGiveOffers(stockItem);
    if (gives.length === 0) return false;
    // Taking gear grows the stash by one; if it's full and the only trade-in is the
    // equipped piece (also net +1), there's no room. A stashed give is net-zero.
    if (GEAR_MAP[stockItem] && this.stashFull() && !gives.some((o) => !o.equipped)) {
      return false;
    }
    const you = this.store.you();
    if (GRIMOIRE_MAP[stockItem] && (you?.grimoires ?? []).includes(stockItem)) return false;
    return true;
  }

  /** Within the trade-in picker, whether this specific give can be handed over: an
   *  equipped gear give overflows a full stash (net +1); a stashed give is net-zero. */
  protected canUseGive(stockItem: string, give: TradeOffer): boolean {
    if (GEAR_MAP[stockItem] && give.equipped && this.stashFull()) return false;
    return true;
  }

  /** Tap a stock line: open its trade-in picker (clear any prior selection). */
  protected pickStock(index: number): void {
    this.selectedStock.set(index);
    this.giveItem.set(null);
  }

  // ── Bazaar (rotating limited stock) ──────────────────────────────────────
  /** Node ids whose bazaar is the central-island endgame vendor (mirror of
   * undercity_data.ISLAND_BAZAAR_NODES). */
  private readonly ISLAND_BAZAAR_NODES = new Set(['isl_bg1']);

  protected readonly currentBazaar = computed<BazaarView | null>(() => {
    const pos = this.store.you()?.position;
    return pos ? (this.store.bazaars()[pos] ?? null) : null;
  });

  protected islandBazaar(): boolean {
    const pos = this.store.you()?.position;
    return !!pos && this.ISLAND_BAZAAR_NODES.has(pos);
  }

  protected bazaarTitle(): string {
    return this.islandBazaar() ? "The Witch's Cauldron" : 'Rot-Farm Bazaar';
  }

  /** Rows for the top-right focus picker: every player on the board (you first,
   * marked "(You)") plus Umori while it's wandering. Sprites reuse the recolor
   * cache, so rebuilding this on each player diff is cheap. */
  protected readonly focusTargets = computed<FocusTarget[]>(() => {
    const youId = this.store.you()?.userId;
    const rows: FocusTarget[] = this.store.players().map((p) => {
      const spr = formSprite(p.form, p.spriteVariant);
      const isYou = p.userId === youId;
      return {
        key: p.userId,
        label: (p.creatureName || p.formName) + (isYou ? ' (You)' : ''),
        spriteUrl: getRecoloredWithHatDataUrl(spr.sprite, p.paint ?? {}, spr.regions, p.hat),
        node: p.position,
        isYou,
      };
    });
    rows.sort((a, b) => (a.isYou === b.isYou ? 0 : a.isYou ? -1 : 1));
    const u = this.store.umori();
    if (u) {
      rows.push({
        key: 'umori',
        label: 'Umori',
        spriteUrl: 'undercity/map_events/shopkeeper3.png',
        node: u.node,
        isYou: false,
      });
    }
    return rows;
  });

  /** Center the board camera on a focus-picker row, then close the menu. */
  protected focusTarget(node: string): void {
    // spectateOn (not centerOn) so the picker can follow a player who's down a
    // dungeon or in a lair — it dives to that layer and won't be yanked back by
    // the next poll's auto-follow.
    this.board?.spectateOn(node);
    this.showFocusMenu.set(false);
  }

  /** Snap the camera back to the active player's own creature. Called from the
   *  page's biome chip so tapping it re-centres on you. Uses spectateOn so it
   *  also crosses back to your layer if you'd been spectating elsewhere. */
  focusSelf(): void {
    const pos = this.store.you()?.position;
    if (pos) this.board?.spectateOn(pos);
  }

  protected shopGearRows(): { info: GearInfo; qty: number; blackMarket: boolean }[] {
    return (this.currentBazaar()?.gear ?? [])
      .map((s) => ({ info: GEAR_MAP[s.item], qty: s.qty, blackMarket: !!s.blackMarket }))
      .filter((r) => !!r.info);
  }

  protected readonly tierRarity = tierRarity;

  /** Held-stash cap (mirrors GEAR_STASH_SIZE in undercity_config.py). */
  protected readonly GEAR_STASH_SIZE = 6;

  /** Bought gear goes to the stash now (no auto-equip) — sales stall when it's full. */
  protected readonly stashFull = computed(
    () => (this.store.you()?.gearStash?.length ?? 0) >= this.GEAR_STASH_SIZE,
  );

  /** Whether the player can cover a straight Spore price. */
  protected canAfford(cost: number): boolean {
    return (this.store.you()?.spores ?? 0) >= cost;
  }

  protected shopConsumableRows(): { info: ConsumableInfo; qty: number }[] {
    return (this.currentBazaar()?.consumables ?? [])
      .map((s) => ({ info: CONSUMABLE_MAP[s.item], qty: s.qty }))
      .filter((r) => !!r.info);
  }

  protected shopGrimoireRows(): GrimoireInfo[] {
    return (this.currentBazaar()?.grimoires ?? [])
      .map((id) => GRIMOIRE_MAP[id])
      .filter((g): g is GrimoireInfo => !!g);
  }

  protected bazaarRestockLabel(): string {
    const at = this.currentBazaar()?.refreshesAt;
    if (!at) return '—';
    const ms = new Date(at + 'Z').getTime() - Date.now();
    const min = Math.max(0, Math.ceil(ms / 60_000));
    return min <= 1 ? 'under a minute' : `${min} min`;
  }

  /** Biome bazaar vendors, in rotation order. Which one is "on shift" alternates
   * with the shared restock window (mirrors data.SHOP_REFRESH_MIN = 30
   * server-side) so every player sees the same vendor until the next restock. */
  private readonly BAZAAR_KEEPERS: { art: string; quote: string }[] = [
    {
      art: 'undercity/map_events/shopkeeper1.png',
      quote: 'Spare a few spores, friend? Good honest wares — I swear it on me turnips.',
    },
    {
      art: 'undercity/map_events/shopkeeper2.png',
      quote: 'I hawked turnips at this very stall, once. One little bargain later… the stock improved, and so did the terms.',
    },
  ];

  /** The island bazaar's fixed vendor — the Witch (keeper 4). */
  private readonly islandKeeper = {
    art: 'undercity/map_events/shopkeeper4.png',
    quote: 'Come closer, morsel. Baba has cauldrons to fill and coin to make. Buy something, hmm?',
  };

  /** Trading Post is tended by the collector ooze — one fixed vendor. */
  protected readonly tradingKeeper = {
    art: 'undercity/map_events/shopkeeper3.png',
    quote: 'Ooh, what have you got? One of everything — that is Ooze’s motto. Leave a trinket, take a trinket.',
  };

  protected bazaarKeeper(): { art: string; quote: string } {
    if (this.islandBazaar()) return this.islandKeeper;
    const at = this.currentBazaar()?.refreshesAt;
    const windowEndMs = at ? new Date(at + 'Z').getTime() : Date.now();
    const windowIdx = Math.round(windowEndMs / (30 * 60_000));
    return this.BAZAAR_KEEPERS[windowIdx % this.BAZAAR_KEEPERS.length];
  }

  protected spaceIcon(type: string): string {
    return SPACE_ICONS[type] ?? 'radio_button_unchecked';
  }

  spaceName(type: string): string {
    return SPACE_NAMES[type] ?? 'The Undercity';
  }

  protected eventTint(type: string): string {
    return SPACE_TINTS[type] ?? '#4a7c59';
  }

  /** Glyph ink that stays legible on the tint disc — dark on light tints (e.g. the white gate). */
  protected eventInk(type: string): string {
    const hex = this.eventTint(type);
    const v = parseInt(hex.slice(1), 16);
    const lum = 0.299 * ((v >> 16) & 255) + 0.587 * ((v >> 8) & 255) + 0.114 * (v & 255);
    return lum > 176 ? 'rgba(24, 28, 22, 0.92)' : 'rgba(240, 253, 244, 0.95)';
  }

  /**
   * Biome scenery image for the region the active player is standing in, read
   * from the authoritative map.regions{} table so every chamber (bone, depths,
   * garden, ruin included) resolves correctly. Falls back to the city chamber,
   * then a literal path, if a region or its background is missing. The stored
   * path already includes the `undercity/` prefix.
   */
  private regionBgUrl(): string {
    const pos = this.store.you()?.position;
    const region = this.map?.nodes.find((n) => n.id === pos)?.region ?? 'city';
    const regions = this.map?.regions;
    const bg =
      regions?.[region]?.background ||
      regions?.['city']?.background ||
      'undercity/undercity_background.png';
    return `url('${bg}')`;
  }

  /**
   * Event-card backdrop: the biome scenery for the space you landed on, fills
   * the whole dialog under a gradient that reads clear at the top and darkens
   * downward so the title, body, and chips stay legible in every chamber.
   */
  protected eventCardBg(): string {
    return (
      `linear-gradient(to bottom, ` +
      `rgba(20, 18, 14, 0.15) 0%, ` +
      `rgba(20, 18, 14, 0.55) 42%, ` +
      `rgba(20, 18, 14, 0.97) 100%), ` +
      `${this.regionBgUrl()}`
    );
  }

  /**
   * Dimmer "atmospheric wash" over the same biome scenery — used behind the
   * interactive, content-heavy dialogs (shop, shrine, trading post, and the
   * minigame cards) where legibility matters more than the view. Darker than
   * the event card so buttons and grids stay readable.
   */
  protected regionWashBg(): string {
    return (
      `linear-gradient(to bottom, ` +
      `rgba(16, 14, 11, 0.62) 0%, ` +
      `rgba(16, 14, 11, 0.86) 100%), ` +
      `${this.regionBgUrl()}`
    );
  }

  protected itemInfo(id: string): ConsumableInfo | null {
    return CONSUMABLE_MAP[id] ?? null;
  }

  protected gearInfo(id: string): GearInfo | null {
    return GEAR_MAP[id] ?? null;
  }

  protected slotIcon(slot: string): string {
    return this.SLOT_ICONS[slot] ?? 'hardware';
  }

  protected eventHasChips(ev: SpaceEvent): boolean {
    // Loot spores are shown inline in the grass scene, not as a chip — so a
    // plain forage doesn't render an empty chip row.
    const spores = ev.spores && ev.type !== 'loot';
    return !!(spores || ev.sporesLost || ev.hp || ev.item || ev.gear);
  }

  protected readonly nodeType = computed(() => {
    const pos = this.store.you()?.position;
    return this.map?.nodes.find((n) => n.id === pos)?.type ?? null;
  });

  /** Illuminated: any equipped gear carries the 'full' light property, which
   *  reveals the whole dungeon (client-side fog). Power traded for information. */
  protected readonly illuminated = computed(() =>
    Object.values(this.store.you()?.gear ?? {}).some((id) => GEAR_MAP[id]?.light === 'full'),
  );

  /** Ossuary gambles remaining this visit (defaults to a full set of 3). */
  protected readonly ossuaryRollsLeft = computed(() => this.store.you()?.ossuaryRollsLeft ?? 3);

  /** Excavation digs remaining this visit. */
  protected readonly excavationDigsLeft = computed(() => this.store.you()?.excavationDigsLeft ?? 0);

  /** Crystal-vein strikes remaining this visit. */
  protected readonly veinStrikesLeft = computed(() => this.store.you()?.veinStrikesLeft ?? 0);

  /** Guildvault picks remaining this visit. */
  protected readonly vaultPicksLeft = computed(() => this.store.you()?.vaultPicksLeft ?? 0);

  protected readonly occupantsHere = computed<Occupant[]>(() => {
    const you = this.store.you();
    if (!you) return [];
    return this.store
      .players()
      .filter((p) => p.userId !== you.userId && p.position === you.position)
      .map((p) => ({
        userId: p.userId,
        username: p.username,
        formName: p.formName,
        creatureName: p.creatureName,
        level: p.level,
        shielded: isShielded(p),
        stance: p.stance,
      }));
  });

  constructor() {
    // Keep the canvas (and the local walk) in sync with the polled store.
    effect(() => {
      const you = this.store.you();
      const pm = you?.pendingMove ?? null;
      const step = this.stepping();
      if (!pm && step) {
        this.stepping.set(null);
      } else if (pm && !step && you && !this.canReroll()) {
        // A pending Fleetfoot reroll decision locks the board: don't begin the
        // walk until the player keeps the 1 or rerolls. Likewise a Pathfinder
        // advantage roll (two distinct faces) waits for the player to pick which
        // die to move — seeding the walk with only pm.value would strand the
        // second die's destinations (the exact-count walker can't reach them).
        const vals = pm.values;
        const needsPick = !!vals && vals.length === 2 && vals[0] !== vals[1];
        if (!needsPick) {
          this.stepping.set({ path: [you.position], left: pm.value });
        }
      }
      this.syncBoard();
    });
    // Away-events: a returning player gets the full modal; an active player
    // gets a toast per new hit (auto-acknowledged so it never re-shows).
    effect(() => {
      const events = this.store.you()?.awayEvents ?? [];
      if (!this.awayInitDone) {
        if (!this.store.you()) return; // wait for the first real snapshot
        this.awayInitDone = true;
        this.awaySeenCount = events.length;
        if (events.length) this.awayModal.set(events);
        return;
      }
      if (events.length > this.awaySeenCount && !this.awayModal()) {
        const fresh = events.slice(this.awaySeenCount);
        this.showToast(this.awayText(events[events.length - 1]));
        for (const e of fresh) this.playHitFx(e);
        void this.store.action('ack-events');
      }
      this.awaySeenCount = events.length;
    });
    // Resume a server-side pending battle after a reload — otherwise the
    // battle-guard blocks every action and the player is soft-locked.
    effect(() => {
      const pb = this.store.pendingBattle();
      if (pb && !this.liveBattle()) this.resumeLiveBattle(pb);
    });
    // HUD portrait tap → glide the camera back to your own creature. Track only
    // the pulse (read the position untracked) so polls don't yank the camera.
    effect(() => {
      this.store.recenterRequest();
      const pos = untracked(() => this.store.you()?.position);
      if (pos) this.board?.spectateOn(pos);
    });
  }

  /** One-line prose for a welcome-back note, per kind. */
  protected awayText(e: AwayEvent): string {
    switch (e.kind) {
      case 'spell_hit':
        return `${e.from}'s ${SPELL_MAP[e.spell]?.name ?? e.spell} hit you for ${e.dmg ?? 0}!`;
      case 'spell_dodged':
        return `You dodged ${e.from}'s ${SPELL_MAP[e.spell]?.name ?? e.spell}!`;
      case 'pvp':
        switch (e.outcome) {
          case 'composted':
            return `${e.from} composted your creature and looted ${e.spores ?? 0} Spores.`;
          case 'defended':
            return `${e.from} jumped you — and you composted them!`;
          case 'fled':
            return `${e.from} tried to jump you, but slipped away in the dark.`;
          default:
            return `${e.from} brawled you to a standstill.`;
        }
      case 'reward': {
        const bits = [`+${e.rolls} roll${e.rolls === 1 ? '' : 's'}`];
        if (e.items) bits.push(`${e.items} item${e.items === 1 ? '' : 's'}`);
        return `${bits.join(' and ')} for playing ${e.game || "tonight's games"}.`;
      }
      case 'boss':
        return `${e.name} was felled by ${e.by}.`;
      case 'market':
        return e.text;
    }
  }

  /** Material icon + severity class for a note's row. */
  protected awayIcon(e: AwayEvent): string {
    switch (e.kind) {
      case 'spell_hit':
        return 'flash_on';
      case 'spell_dodged':
        return 'shield';
      case 'pvp':
        return e.outcome === 'defended' ? 'military_tech' : 'sports_kabaddi';
      case 'reward':
        return 'casino';
      case 'boss':
        return 'whatshot';
      case 'market':
        return 'storefront';
    }
  }

  /** True for notes that cost you something — rendered with the alert accent. */
  protected awayIsHit(e: AwayEvent): boolean {
    return e.kind === 'spell_hit' || (e.kind === 'pvp' && e.outcome === 'composted');
  }

  /** The modal's notes split into labelled sections (empty groups dropped). */
  protected readonly awayGroups = computed(() => {
    const events = this.awayModal();
    if (!events) return [];
    const of = (...kinds: AwayEvent['kind'][]) =>
      events.filter((e) => kinds.includes(e.kind));
    return [
      { label: 'Attacks', rows: of('pvp', 'spell_hit', 'spell_dodged') },
      { label: 'Rewards', rows: of('reward') },
      { label: 'News', rows: of('boss') },
      { label: 'Market', rows: of('market') },
    ].filter((g) => g.rows.length);
  });

  async dismissAway(): Promise<void> {
    this.awayModal.set(null);
    try {
      await this.store.action('ack-events');
    } catch {
      // Non-fatal: the inbox re-shows next visit if the ack failed.
    }
  }

  ngAfterViewInit(): void {
    this.board = new BoardCanvas(
      this.canvasRef.nativeElement,
      this.map,
      (nodeId) => this.onTapNode(nodeId),
      this.store.ownUserId,
    );
    // First descent per dungeon per session shows its one-line rite card.
    this.board.setOnEnterDungeon((biome) => {
      if (this.ritesShown.has(biome)) return;
      this.ritesShown.add(biome);
      const rite = DUNGEONS[biome]?.rite;
      if (rite) this.showToast(rite);
    });
    this.syncBoard();
    this.board.start();
    this.restoreOpenFacility();
  }

  /** Reopen whatever facility modal was open before a tab switch destroyed
   * this component — mirrors the pendingBattle resume pattern in the
   * constructor, but runs here because openVein/openVault need `this.map`,
   * which isn't populated until after construction. */
  private restoreOpenFacility(): void {
    const openFacility = this.store.openFacility();
    if (!openFacility) return;
    switch (openFacility.kind) {
      case 'shop':
        this.shopTab.set(openFacility.shopTab ?? 'gear');
        this.showShop.set(true);
        break;
      case 'shrine':
        this.showShrine.set(true);
        break;
      case 'ossuary':
        this.showOssuary.set(true);
        break;
      case 'tradingPost':
        this.openTradingPost();
        break;
      case 'excavation':
        this.openExcavation();
        break;
      case 'flowPuzzle':
        this.openFlowPuzzle();
        break;
      case 'vein':
        this.openVein();
        break;
      case 'vault':
        this.openVault();
        break;
      case 'warp':
        this.showWarp.set(openFacility.warpOptions ?? null);
        break;
    }
  }

  ngOnDestroy(): void {
    this.board?.stop();
    this.board = null;
    if (this.sigilTimer) clearTimeout(this.sigilTimer);
  }

  // ── Roll & move ────────────────────────────────────────────────────────────

  /** Debug picker (server DEBUG flag): choose the exact die face 1–6. */
  protected readonly showRollPicker = signal(false);

  /** Server-reported DEBUG flag: gates the ∞ label / free-roll behavior. */
  protected readonly debugMode = computed(() => !!this.store.you()?.debug);

  /** Pick-a-face needs server DEBUG *and* a local dev build — the deployed
   * GitHub Pages site never shows it, even while DEBUG is still on. */
  protected readonly pickAllowed = computed(() => this.debugMode() && isDevMode());
  /** Owns the Blink perk (SPD-15), whether or not it's ready right now. */
  protected readonly hasBlink = computed(() => (this.store.you()?.perks ?? []).includes('blink'));
  /** Ordinary rolls still owed before Blink can be used again (0 = ready). */
  protected readonly blinkCooldown = computed(() => this.store.you()?.blinkCooldown ?? 0);
  /** Blink is paced: after a use it recharges for a roll before it's usable again. */
  protected readonly blinkRecharging = computed(() => this.hasBlink() && this.blinkCooldown() > 0);
  /** Blink (SPD-15): choose your die value — a real perk, live in production.
   * Ready only when the perk is owned and not recharging. */
  protected readonly blinkAllowed = computed(() => this.hasBlink() && !this.blinkRecharging());
  /** Dev-pick, a ready Blink, or a recharging Blink all keep the face control on
   * screen — recharging shows a disabled "recharging" state so it's not a mystery. */
  protected readonly canPickFace = computed(
    () => this.pickAllowed() || this.blinkAllowed() || this.blinkRecharging(),
  );
  protected readonly rollsBanked = computed(() => this.store.you()?.rolls ?? 0);

  /** Minute-granularity countdown to the next timed roll (null at cap / in debug).
   * Re-evaluated on state polls, same approach as bazaarRestockLabel(). */
  protected nextRollLabel(): string | null {
    const at = this.store.you()?.nextRollAt;
    if (!at || this.debugMode()) return null;
    const min = Math.max(1, Math.ceil((new Date(at + 'Z').getTime() - Date.now()) / 60_000));
    return min <= 1 ? 'under a minute' : `${min} min`;
  }

  async roll(picked?: number, opts?: { blink?: boolean; reroll?: boolean }): Promise<void> {
    this.dismissCoach();
    if (this.busy()) return;
    this.showRollPicker.set(false);
    this.canReroll.set(false);
    this.rolledValue.set(null);
    this.rolledValue2.set(null);
    this.rolling.set(true);
    await this.run(async () => {
      const payload: Record<string, unknown> = {};
      if (picked) payload['value'] = picked;
      if (opts?.blink) payload['blink'] = true;   // Blink: choose the value (production)
      if (opts?.reroll) payload['reroll'] = true; // Fleetfoot: discard a rolled 1
      const resp = await this.store.action('roll', payload);
      const primary = resp.roll?.value ?? resp.you?.pendingMove?.value ?? null;
      this.rolledValue.set(primary);
      // Pathfinder returns both faces; show the advantage die beside the primary.
      const vals = resp.roll?.values ?? resp.you?.pendingMove?.values ?? null;
      if (vals && vals.length === 2 && primary !== null) {
        const idx = vals.indexOf(primary);
        this.rolledValue2.set(vals[idx === 0 ? 1 : 0]);
      }
      this.canReroll.set(!!resp.roll?.canReroll);
    });
    // Errored (or no value came back) — drop the die, the toast explains why.
    if (this.rolledValue() === null) this.rolling.set(false);
  }

  /** A value-picker face: routes through Blink in production, or the dev pick. */
  pickRoll(n: number): void {
    void this.roll(n, this.blinkAllowed() ? { blink: true } : undefined);
  }

  /** Fleetfoot: discard the rolled 1 and roll fresh (no banked roll spent). */
  reroll(): void {
    void this.roll(undefined, { reroll: true });
  }

  /** Fleetfoot: keep the rolled 1 — dismiss the prompt and begin the move. */
  keepRoll(): void {
    this.canReroll.set(false);
  }

  /** Pathfinder (SPD-10): the two advantage faces awaiting a pick, or null when
   *  there's nothing to choose (single die, matched faces, or already walking). */
  protected pathfinderPick(): number[] | null {
    const vals = this.store.you()?.pendingMove?.values;
    if (!vals || vals.length !== 2 || vals[0] === vals[1]) return null;
    if (this.rolling() || this.canReroll() || this.stepping()) return null;
    return vals;
  }

  /** Pathfinder: commit to one of the two faces — that value seeds the walk, so
   *  only its destinations (a subset of the server's union dests) stay legal. */
  chooseDie(value: number): void {
    const you = this.store.you();
    if (!you?.pendingMove || this.stepping()) return;
    this.stepping.set({ path: [you.position], left: value });
    this.syncBoard();
  }

  onDiceSettled(): void {
    this.rolling.set(false);
  }

  /** Map a mystery outcome to a reel face so it lands on something meaningful. */
  private mysterySymbol(ev: SpaceEvent): string {
    if (ev.item) return 'item';
    if (ev.to) return 'warp';
    if ((ev.hp ?? 0) > 0) return 'heal';
    if ((ev.hp ?? 0) < 0 || ev.sporesLost) return 'hurt';
    if (ev.spores) return 'spores';
    return 'mystery';
  }

  /** Reel is fading out — open the event card underneath now (cross-fade),
   *  then unmount the reel once its fade completes. */
  onReelSettled(): void {
    if (this.pendingMysteryEv) {
      this.spaceModal.set(this.pendingMysteryEv);
      this.pendingMysteryEv = null;
    }
    setTimeout(() => this.reelSymbol.set(null), 340);
  }

  private onTapNode(nodeId: string | null): void {
    const tele = this.castTeleport();
    if (tele && nodeId && tele.nodes.includes(nodeId) && !this.busy()) {
      void this.castSpell(tele.spell, { target: nodeId });
      return;
    }
    if (!nodeId) {
      // Tapped empty tunnel — dismiss the space popover.
      this.hideInfo();
      return;
    }
    // Standing on a ladder (paused here on an earlier roll, or parked at turn
    // start): tapping it re-opens the crossing modal so you can Travel through.
    // Only while you're still ON the ladder — once you've walked off it, a tap on
    // the ladder retraces the step instead (handled below).
    const stepNow = this.stepping();
    const onLadder = !stepNow || (stepNow.path.length === 1 && stepPos(stepNow) === nodeId);
    if (
      onLadder &&
      nodeId === this.store.you()?.position &&
      !this.busy() &&
      this.map.nodes.find((n) => n.id === nodeId)?.type === 'ladder'
    ) {
      const to = this.ladderTargetOf(nodeId);
      this.spaceModal.set({
        type: 'ladder',
        to: to ?? undefined,
        oneWay: nodeId.endsWith('_esc'),
        text: to
          ? 'A rusted ladder leads to the far side. Travel through?'
          : 'A rusted ladder — sealed until you clear its lair.',
      } as SpaceEvent);
      return;
    }
    const step = this.stepping();
    if (step && !this.busy()) {
      // Tapping the space you came from retraces the step and reclaims it.
      if (nodeId === stepPrev(step)) {
        this.hideInfo();
        this.stepping.set({ path: step.path.slice(0, -1), left: step.left + 1 });
        this.board?.centerOn(nodeId);
        return;
      }
      if (step.left >= 1 && this.stepChoices(step).includes(nodeId)) {
        // First walk across the Ashen Wilds border, under-leveled, this
        // season: hold the step and warn before committing.
        if (this.shouldWarnWilds(step, nodeId)) {
          this.hideInfo();
          this.wildsPrompt.set(nodeId);
          return;
        }
        // Every bridge crossing meets the tollkeeper first (Tier-1 free,
        // Tier-2 pays 50) — hold the step and let the dialog commit it.
        if (this.isBridge(nodeId)) {
          this.hideInfo();
          this.bridgePrompt.set(nodeId);
          return;
        }
        this.commitStep(step, nodeId);
        return;
      }
    }
    // Tapping a bridge that isn't a legal step this roll (Tier-3 too large, or
    // a broke Tier-2) still opens the tollkeeper so they learn why — the dialog
    // is informational there, with only Turn back.
    if (this.isBridge(nodeId)) {
      this.hideInfo();
      this.bridgePrompt.set(nodeId);
      return;
    }
    // Not a walk step — peek at what this space does.
    this.toggleInfo(nodeId);
  }

  /** Advance the local walk onto `nodeId`, honoring the sealed-barrier bonk and
   *  the last-step auto-commit. Shared by a direct tap and the Ashen Wilds
   *  "Press on" confirmation so both paths behave identically. */
  private commitStep(step: StepState, nodeId: string): void {
    this.hideInfo();
    this.stepping.set({ path: [...step.path, nodeId], left: step.left - 1 });
    this.board?.centerOn(nodeId);
    // Bonk: a sealed barrier halts the walk immediately — you stop at the
    // wall and spend the rest of the roll, matching the server's dests.
    const node = this.map.nodes.find((n) => n.id === nodeId);
    const sealedStop =
      node?.type === 'barrier' && !this.store.barriersOpen().includes(nodeId);
    // Evolved units (tier > 1) halt on a bridge mouth to pay the toll — a bonk
    // stop like a sealed barrier, so the move auto-commits on arrival.
    const bridgeStop = node?.type === 'tunnel' && (this.store.you()?.tier ?? 1) > 1;
    // Any ladder is a bonk-stop: the walk halts on arrival and commits, so the
    // server can bank the leftover steps and offer the crossing (see the ladder
    // space-event modal). Replaces the old degree-1-only escape-spur stop.
    const ladderStop = node?.type === 'ladder';
    if (step.left === 1 || sealedStop || bridgeStop || ladderStop) void this.move(nodeId);
  }

  // ── Ashen Wilds first-entry warning ─────────────────────────────────────────

  private regionOf(nodeId: string | null): string | undefined {
    return nodeId ? this.map.nodes.find((n) => n.id === nodeId)?.region : undefined;
  }

  /** localStorage flag key for "already warned this season", or null if the
   *  season id isn't loaded yet. */
  private wildsWarnKey(): string | null {
    const seasonId = this.store.season()?.seasonId;
    return seasonId ? `uc-wilds-warned:${seasonId}` : null;
  }

  private wildsWarned(): boolean {
    const key = this.wildsWarnKey();
    // No season id → fail open (show the notice); otherwise trust the flag.
    return key ? localStorage.getItem(key) === '1' : false;
  }

  /** True when this step first crosses into the Ashen Wilds, the player is
   *  under the recommended level, and they haven't been warned this season. */
  private shouldWarnWilds(step: StepState, nodeId: string): boolean {
    return (
      this.regionOf(nodeId) === 'wilderness' &&
      this.regionOf(stepPos(step)) !== 'wilderness' &&
      (this.store.you()?.level ?? 0) < 5 &&
      !this.wildsWarned()
    );
  }

  /** "Press on" — remember the warning for this season and take the held step. */
  protected pressOnWilds(): void {
    const nodeId = this.wildsPrompt();
    const step = this.stepping();
    this.wildsPrompt.set(null);
    const key = this.wildsWarnKey();
    if (key) localStorage.setItem(key, '1');
    if (nodeId && step) this.commitStep(step, nodeId);
  }

  /** "Turn back" — dismiss; the walk is untouched so other routes stay open. */
  protected turnBackWilds(): void {
    this.wildsPrompt.set(null);
  }

  // ── Bridge tollkeeper ────────────────────────────────────────────────────────

  private isBridge(nodeId: string): boolean {
    return this.map.nodes.find((n) => n.id === nodeId)?.type === 'tunnel';
  }

  /** True when the held bridge is actually a reachable step this roll (Tier-1 /
   *  funded Tier-2). A blocked unit (Tier-3, or a broke Tier-2) sees the dialog
   *  purely as information — there is nothing to commit. */
  protected bridgeCommittable(): boolean {
    const nodeId = this.bridgePrompt();
    const step = this.stepping();
    return !!(nodeId && step && this.bridgeCommittableFor(step, nodeId));
  }

  protected bridgeTier(): number {
    return this.store.you()?.tier ?? 1;
  }

  /** "Hop across" (Tier-1) / "Pay 50 & cross" (funded Tier-2): take the held
   *  step. The server charges the toll / enforces the block on landing. */
  protected payBridge(): void {
    const nodeId = this.bridgePrompt();
    const step = this.stepping();
    this.bridgePrompt.set(null);
    if (nodeId && step && this.bridgeCommittableFor(step, nodeId)) {
      this.commitStep(step, nodeId);
    }
  }

  /** "Turn back": dismiss; leave the walk untouched so other routes stay open. */
  protected turnBackBridge(): void {
    this.bridgePrompt.set(null);
  }

  private bridgeCommittableFor(step: StepState, nodeId: string): boolean {
    return step.left >= 1 && this.stepChoices(step).includes(nodeId);
  }

  // ── Space info popover ───────────────────────────────────────────────────────

  private infoNodeId: string | null = null;

  /** Space name + blurb (with snare hint) for a node's popover. */
  private buildNodeInfo(nodeId: string): NodeInfo | null {
    const u = this.store.umori();
    if (u && nodeId === u.node) {
      const ms = new Date(u.movesAt + 'Z').getTime() - Date.now();
      const min = Math.max(0, Math.ceil(ms / 60_000));
      const t = min >= 60 ? `${Math.floor(min / 60)}h ${min % 60}m` : `${min} min`;
      return {
        nodeId,
        title: 'Umori, the Wandering Post',
        body: `A rare T3 barter — but Umori oozes on in ${t}. Trade while you can.`,
      };
    }
    const node = this.map?.nodes.find((n) => n.id === nodeId);
    if (!node) return null;
    let title = this.spaceName(node.type);
    let body = SPACE_BLURBS[node.type] ?? 'Unmapped tunnels.';
    // Inside a dungeon, the signature spaces introduce themselves.
    const dungeon = dungeonBiome(nodeId, node.region);
    if (dungeon) {
      const d = DUNGEONS[dungeon];
      if (node.type === 'hazard') {
        title = d.hazardName;
        body = d.hazardBlurb;
      } else if (node.type === 'wild') {
        body = `A ${d.wildName} hunts these tunnels. Beat it for XP and a fat bounty. Beatable from Level 1+.`;
      } else if (node.type === 'lair') {
        body = `The den of ${d.lairName}. First kill claims the ${d.name} Guild Sigil. Come at Level 5+.`;
      }
    }
    // The Ashen Wilds (wilderness region) draw from the tougher T2+ enemy pools,
    // so the generic "Level 1+/3+" blurbs understate the danger. Override them
    // with a frontier warning to steer new players back to their home biome.
    if (node.region === 'wilderness') {
      if (node.type === 'wild') {
        body =
          'An evolved predator prowls the Ashen Wilds — far deadlier than surface fauna. ' +
          'Rich XP and a fat Spore bounty, but bring an evolved unit. Recommended Level 5+.';
      } else if (node.type === 'elite') {
        body =
          'An apex terror of the Ashen Wilds claims this ground. Brutal even for evolved units, ' +
          'and a death sentence for fresh hatchlings. Recommended Level 8+.';
      }
    }
    if (this.store.snares().includes(nodeId)) {
      body += ' The ground here looks disturbed…';
    }
    return { nodeId, title, body };
  }

  private toggleInfo(nodeId: string): void {
    if (this.infoNodeId === nodeId) {
      this.hideInfo();
      return;
    }
    const info = this.buildNodeInfo(nodeId);
    if (!info) return;
    this.infoNodeId = nodeId;
    this.board?.setInfo(info);
  }

  private hideInfo(): void {
    if (!this.infoNodeId) return;
    this.infoNodeId = null;
    this.board?.setInfo(null);
  }

  private stepChoices(step: StepState): string[] {
    const dests = this.store.you()?.pendingMove?.dests ?? [];
    const closed = this.stepClosedIds();
    return legalSteps(this.map, stepPos(step), stepPrev(step), step.left, dests, closed);
  }

  /** Client walk-stop set: the shared sealed-barrier / escape-ladder stops
   *  (post-boss escape ladders are degree-1 dead-end spurs — bonk stops you
   *  march up to and halt on, so an exact-count landing isn't required; server
   *  dests gate unclaimed ones out), plus every bridge for evolved units
   *  (tier > 1) so their walk halts on the mouth. Mirrors undercity_db.
   *  _stop_nodes. Scoped to walking only — NOT used for spell range / distance
   *  (those keep closedBarrierIds()). */
  private stepClosedIds(): string[] {
    const closed = this.closedBarrierIds();
    // Every ladder halts a walk (bonk-stop), so a mover always lands ON a ladder
    // and never corridors through — matching the server's _stop_nodes. Added to
    // the WALKING set only; closedBarrierIds() (spell range) is left alone.
    const ladders = this.map.nodes.filter((n) => n.type === 'ladder').map((n) => n.id);
    const base = [...closed, ...ladders];
    if ((this.store.you()?.tier ?? 1) > 1) {
      const bridges = this.map.nodes.filter((n) => n.type === 'tunnel').map((n) => n.id);
      return [...base, ...bridges];
    }
    return base;
  }

  /** The far end a ladder crosses to, for display / button-gating (the server is
   *  authoritative on the actual cross). Escape spurs go one-way to the biome
   *  surface mouth, and only when you hold that lair's claim; a descent ladder
   *  goes to its ladder-type neighbour. Null when there is no crossing. */
  private ladderTargetOf(nodeId: string): string | null {
    if (nodeId.endsWith('_esc')) {
      const biome = nodeId.split('_')[0];
      const claimed = (this.store.you()?.poiClaims ?? []).includes(biome + '_lair');
      return claimed ? biome + '_lt' : null;
    }
    const node = this.map.nodes.find((n) => n.id === nodeId);
    if (node?.type !== 'ladder') return null;
    const partner = node.neighbors.find(
      (nb) => this.map.nodes.find((m) => m.id === nb)?.type === 'ladder',
    );
    return partner ?? null;
  }

  /** Ladder modal "Travel through": free relocate to the far end. The server
   *  preserves any banked steps as a fresh pendingMove, so the store effect
   *  resumes the walk on the other side (or ends the turn if 0 remain). */
  protected async travelLadder(): Promise<void> {
    this.closeSpaceModal();
    await this.run(async () => {
      const resp = await this.store.action('ladder-cross', {});
      if (resp.you) this.board?.centerOn(resp.you.position);
    });
  }

  private syncBoard(): void {
    if (!this.board) return;
    const step = this.stepping();
    // Sparkle promise: lit whenever the route walked so far touches a gate
    // (recomputed each step, so retracing off the gate clears it). The starting
    // space (path[0]) doesn't count — only spaces stepped onto.
    const willHeal =
      !!step &&
      step.path
        .slice(1)
        .some((id) => this.map.nodes.find((n) => n.id === id)?.type === 'gate');
    this.board.setSelfHealPending(willHeal);
    const ownId = this.store.ownUserId;
    const you = this.store.you();
    this.board.setPlayers(
      this.store.players().map((p) => {
        // Own token: while walking, use the local step position; otherwise trust
        // the optimistically-patched `you` doc — the public players array lags a
        // poll behind, which would otherwise snap us back to the old space and
        // then zip to the new one the moment a move resolves.
        let position = p.position;
        if (p.userId === ownId) {
          position = step ? stepPos(step) : (you?.position ?? p.position);
        }
        return {
          userId: p.userId,
          username: p.username,
          form: p.form,
          spriteVariant: p.spriteVariant,
          level: p.level,
          paint: p.paint ?? {},
          position,
          shielded: isShielded(p),
          hat: p.hat,
          shiny: p.shiny,
          effect: p.effect,
          illuminated: p.userId === ownId ? this.illuminated() : false,
          darkvision: p.userId === ownId ? you?.homeBiome === 'cavern' : false,
          tier: p.userId === ownId ? (you?.tier ?? p.tier) : p.tier,
          status: p.userId === ownId ? (you?.status ?? p.status ?? '') : (p.status ?? ''),
        };
      }),
    );
    this.board.setSnares(this.store.snares());
    this.board.setUmori(this.store.umori());
    this.board.setBarriersOpen(this.store.barriersOpen());
    this.board.setGuardianPools(this.store.guardians());
    this.board.setWorldEvent(this.store.worldEvent());
    const here = step ? stepPos(step) : null;
    const choices = step ? this.stepChoices(step) : [];
    const tele = this.castTeleport();
    this.board.setChoices(step ? choices : (tele?.nodes ?? null));
    this.board.setBackChoice(step ? stepPrev(step) : null);
    // Steps-left die over your head while a move is pending (Mario Party style).
    this.board.setStepDie(step && step.left > 0 ? step.left : null);
    // Don't leave a tapped popover pinned on the space you're standing on while
    // you're walking — the destination popovers should be the only ones up.
    if (here && this.infoNodeId === here) this.hideInfo();
    // While walking a roll, pin a popover on each reachable next space (never
    // the current one) so you can see what you'd step onto before committing.
    this.board.setChoiceInfos(
      choices
        .filter((id) => id !== here)
        .map((id) => this.buildNodeInfo(id))
        .filter((info): info is NodeInfo => info !== null),
    );
    // Dungeons you hold the sigil for render as cleared (banner, no webs).
    const claims = this.store.you()?.poiClaims ?? [];
    this.board.setClearedDungeons(
      claims.filter((c) => c.endsWith('_lair')).map((c) => c.split('_')[0]),
    );
    this.board.setFirsts(this.store.firsts());
  }

  private async move(to: string): Promise<void> {
    const preHp = this.store.you()?.hp ?? 0;
    const path = this.stepping()?.path;
    await this.run(async () => {
      const resp = await this.store.action('move', { to, path });
      if (resp.you) this.board?.centerOn(resp.you.position);
      const uid = this.store.ownUserId;
      if (resp.heal && uid) this.board?.popHealNumber(uid, resp.heal.amount);
      const ev = resp.spaceEvent;
      this.occupants.set(resp.occupants ?? []);
      if (!ev) return;
      this.routeSpaceEvent(ev, preHp);
    });
    // A failed move leaves pendingMove intact server-side — reset the local
    // walk so the effect restarts it from the real position with a full count.
    if (this.store.you()?.pendingMove) this.stepping.set(null);
  }

  /** Open the right modal/animation for a landing event (move or teleport). */
  private routeSpaceEvent(ev: SpaceEvent, preHp: number): void {
    if (ev.type === 'ladder_cross') return;   // silent free relocate, no modal
    if (ev.type === 'battle_start' && ev.npc) {
      this.openLiveBattle(ev, preHp);
      return;
    }
    const fightTypes = ['wild', 'elite', 'barrier', 'lair', 'boss', 'world'];
    if (fightTypes.includes(ev.type) && ev.battle && ev.npc) {
      this.battleView.set({
        battle: ev.battle,
        attacker: {
          name: this.youBattleName(),
          spriteUrl: this.youSpriteUrl(),
          startHp: preHp,
          maxHp: this.store.you()?.maxHp ?? preHp,
        },
        defender: {
          name: ev.npc.name,
          // Art folder per foe class; a missing file falls back to the icon
          // via the battle card's onerror handling.
          spriteUrl: this.npcSpriteUrl(ev.type, ev.npc.id),
          icon: NPC_ICONS[ev.npc.id] ?? 'bug_report',
          startHp: ev.npc.hp,
          // The island boss carries a persistent HP pool: current hp can be
          // well below its true max.
          maxHp: ev.npc.maxHp ?? ev.npc.hp,
          vestige: this.isVestigeFoe(ev.npc.name),
        },
        resultText: ev.text,
        rewards: this.buildRewards(ev),
      });
    } else if (ev.type === 'warp' && ev.options) {
      this.showWarp.set(ev.options);
      this.store.openFacility.set({ kind: 'warp', warpOptions: ev.options });
    } else if (ev.type === 'shop') {
      this.shopTab.set('gear');
      this.showShop.set(true);
      this.store.openFacility.set({ kind: 'shop', shopTab: 'gear' });
    } else if (ev.type === 'shrine') {
      this.showShrine.set(true);
      this.store.openFacility.set({ kind: 'shrine' });
    } else if (ev.type === 'ossuary') {
      this.showOssuary.set(true);
      this.store.openFacility.set({ kind: 'ossuary' });
    } else if (ev.type === 'witch') {
      this.showWitch.set(true);
    } else if (ev.type === 'trading_post') {
      this.openTradingPost(ev.stock);
    } else if (ev.type === 'excavation') {
      this.openExcavation(ev.grid);
    } else if (ev.type === 'loot_puzzle') {
      this.openFlowPuzzle(ev.puzzle);
    } else if (ev.type === 'crystal_vein') {
      this.openVein(ev);
    } else if (ev.type === 'vault_lock') {
      this.openVault(ev);
    } else if (ev.type === 'mystery') {
      // Spin the reveal reel first; the event card opens once it lands.
      this.pendingMysteryEv = ev;
      this.reelSymbol.set(this.mysterySymbol(ev));
    } else {
      this.spaceModal.set(ev);
    }
  }

  /** Wade into the wilderness World Event: a bounded skirmish that chips its
   *  shared pool. The server returns a battle_start (kind 'world'), which routes
   *  straight into the interactive battle UI. */
  async engageWorldEvent(): Promise<void> {
    const preHp = this.store.you()?.hp ?? 0;
    this.spaceModal.set(null);
    try {
      const resp = await this.store.action('world-engage', {});
      if (resp.spaceEvent) this.routeSpaceEvent(resp.spaceEvent, preHp);
    } catch {
      /* store surfaces the error toast */
    }
  }

  // ── PvP ────────────────────────────────────────────────────────────────────

  async attack(target: Occupant): Promise<void> {
    const preHp = this.store.you()?.hp ?? 0;
    const targetPublic = this.store.players().find((p) => p.userId === target.userId);
    await this.run(async () => {
      const resp = await this.store.action('battle', { targetUserId: target.userId });
      if (!resp.battle) return;
      this.battleView.set({
        battle: resp.battle,
        attacker: {
          name: this.youBattleName(),
          spriteUrl: this.youSpriteUrl(),
          startHp: preHp,
          maxHp: this.store.you()?.maxHp ?? preHp,
        },
        defender: {
          name: `${target.username}'s ${target.creatureName || target.formName}`,
          spriteUrl: targetPublic
            ? this.spriteUrl(targetPublic.form, targetPublic.paint, targetPublic.hat, targetPublic.spriteVariant)
            : null,
          icon: 'pets',
          startHp: targetPublic?.hp ?? 30,
          maxHp: targetPublic?.maxHp ?? 30,
        },
        resultText: resp.text ?? '',
        rewards: this.buildRewards({ spores: resp.stolen, xp: resp.xp, levels: resp.levels }),
      });
      this.occupants.set([]);
    });
  }

  // ── Node facilities ────────────────────────────────────────────────────────

  async buy(item: { id: string }): Promise<void> {
    await this.run(async () => {
      const resp = await this.store.action('buy', { itemId: item.id });
      this.showToast(resp.text ?? 'Purchased.');
    });
  }

  /** Spore price of a single shrine blessing (mirrors SHRINE_BLESSING_COST). */
  protected readonly SHRINE_COST = 15;

  /** Whether the player can afford a blessing — gates the shrine cards. */
  protected readonly canBless = computed(() => (this.store.you()?.spores ?? 0) >= this.SHRINE_COST);

  async shrine(choice: string): Promise<void> {
    await this.run(async () => {
      const resp = await this.store.action('shrine', { choice });
      this.showToast(resp.text ?? 'The shrine hums.');
      this.closeFacilities();
    });
  }

  // ── Trading post ─────────────────────────────────────────────────────────────

  protected readonly consumableMap = CONSUMABLE_MAP;

  /** Open the post, seeding the modal from the landing event or polled state. */
  openTradingPost(stock?: TradeStockItem[] | null): void {
    const pos = this.store.you()?.position ?? '';
    this.tradingStock.set(stock ?? this.store.tradingPosts()[pos] ?? []);
    this.giveItem.set(null);
    this.selectedStock.set(null);
    this.showTradingPost.set(true);
    this.store.openFacility.set({ kind: 'tradingPost' });
  }

  /** Hand over the selected give item for stock slot `takeIndex`. */
  async trade(takeIndex: number): Promise<void> {
    const give = this.giveItem();
    if (!give) return;
    await this.run(async () => {
      const resp = await this.store.action('trade', { give, takeIndex });
      if (resp.stock) this.tradingStock.set(resp.stock);
      this.giveItem.set(null);
      this.selectedStock.set(null);
      this.showToast(resp.text ?? 'Traded.');
    });
  }

  async warpTo(to: string): Promise<void> {
    await this.run(async () => {
      await this.store.action('warp', { to });
      this.showWarp.set(null);
      this.store.openFacility.set(null);
      this.board?.centerOn(to);
    });
  }

  // ── Excavation ─────────────────────────────────────────────────────────────

  /** Open the dig site, seeding the grid from the landing event or polled state. */
  openExcavation(grid?: DigGrid | null): void {
    const pos = this.store.you()?.position ?? '';
    this.excavationGrid.set(grid ?? this.store.excavations()[pos] ?? null);
    this.showExcavation.set(true);
    this.store.openFacility.set({ kind: 'excavation' });
  }

  /** Open the Flow loot puzzle, seeding from the landing event or the polled
   * player state (pendingLoot survives a refresh/tab switch). */
  openFlowPuzzle(view?: FlowPuzzleView | null): void {
    const pending = this.store.you()?.pendingLoot;
    this.flowPuzzle.set(view ?? pending?.view ?? null);
    if (!this.flowPuzzle()) return; // nothing pending — don't open an empty modal
    this.showFlowPuzzle.set(true);
    this.store.openFacility.set({ kind: 'flowPuzzle' });
  }

  private closeFlowPuzzle(): void {
    this.showFlowPuzzle.set(false);
    this.flowPuzzle.set(null);
    if (this.store.openFacility()?.kind === 'flowPuzzle') this.store.openFacility.set(null);
  }

  /** Player solved the puzzle — claim the deferred reward and show it. */
  async solveFlowPuzzle(path: [number, number][]): Promise<void> {
    const preHp = this.store.you()?.hp ?? 0;
    await this.run(async () => {
      const resp = await this.store.action('solve-loot-puzzle', { path });
      this.closeFlowPuzzle();
      const ev = resp.spaceEvent;
      if (ev) this.routeSpaceEvent(ev, preHp); // 'loot' → the normal reward dialog
    });
  }

  /** Player gave up — forfeit the reward, no penalty. */
  async giveUpFlowPuzzle(): Promise<void> {
    await this.run(async () => {
      await this.store.action('cancel-loot-puzzle', {});
      this.closeFlowPuzzle();
    });
  }

  /** Reveal one cell; the response carries the updated grid and remaining digs. */
  async dig(cell: { r: number; c: number }): Promise<void> {
    await this.run(async () => {
      const resp = await this.store.action('dig', { r: cell.r, c: cell.c });
      if (resp.grid) this.excavationGrid.set(resp.grid); // fresh board on clear
      if (resp.cleared) {
        // The site is picked clean: celebrate the clean-up bonus in a popup;
        // the board underneath has already reset to a fresh dig.
        this.digCleared.set(resp.bonus ?? 0);
      } else if (resp.found) {
        this.showToast(resp.text ?? 'You dig…');
      }
    });
  }

  /** Dismiss the "site cleared" popup — the fresh board is already in place. */
  protected closeDigCleared(): void {
    this.digCleared.set(null);
  }

  // ── Crystal Vein ───────────────────────────────────────────────────────────

  /** Open the shaft, seeding depth from the landing event or polled state. */
  openVein(ev?: SpaceEvent): void {
    this.veinEffect.set(null); // clear any stale cue so it can't replay on reopen
    const pos = this.store.you()?.position ?? '';
    const region = this.map?.nodes.find((n) => n.id === pos)?.region ?? '';
    this.veinDepth.set(ev?.depth ?? this.store.veins()[region]?.depth ?? 0);
    this.veinLog.set(ev?.text ?? null);
    this.showVein.set(true);
    this.store.openFacility.set({ kind: 'vein' });
  }

  /** One optional swing; the response carries the new shared depth. */
  async strike(): Promise<void> {
    await this.run(async () => {
      const resp = await this.store.action('strike');
      if (resp.depth !== undefined) this.veinDepth.set(resp.depth);
      this.veinLog.set(resp.text ?? null);
      const kind: VeinEffect['kind'] = resp.collapsed
        ? 'cave-in'
        : resp.heartstone
          ? 'heartstone'
          : 'strike';
      this.veinEffect.set({ kind, seq: (this.veinEffect()?.seq ?? 0) + 1 });
      if (resp.collapsed || resp.heartstone) this.showToast(resp.text ?? '');
    });
  }

  // ── Guildvault ─────────────────────────────────────────────────────────────

  /** Open the vault, seeding pot + ledger from the landing event or polled state. */
  openVault(ev?: SpaceEvent): void {
    const pos = this.store.you()?.position ?? '';
    const region = this.map?.nodes.find((n) => n.id === pos)?.region ?? '';
    this.vaultView.set(
      ev?.vault ?? this.store.vaults()[region] ?? { pot: VAULT_POT_SEED, history: [] },
    );
    this.showVault.set(true);
    this.store.openFacility.set({ kind: 'vault' });
  }

  /** One pick attempt; the response carries the updated ledger and pot. */
  async vaultGuess(guess: string[]): Promise<void> {
    await this.run(async () => {
      const resp = await this.store.action('vault-guess', { guess });
      if (resp.guess?.cracked) {
        // Cracked: the lock rerolled to a fresh empty vault and this was the
        // last pick anyway — close the modal and let the win toast stand.
        this.closeFacilities();
        this.showToast(resp.text ?? 'CRACKED!');
        return;
      }
      if (resp.vault) this.vaultView.set(resp.vault);
    });
  }

  // ── Respawn choice ───────────────────────────────────────────────────────────

  /** Choose which gate to wake at after a compost. */
  async respawn(gate: string): Promise<void> {
    await this.run(async () => {
      const resp = await this.store.action('respawn', { gate });
      if (resp.you) this.board?.centerOn(resp.you.position);
    });
  }

  async gamble(call: 'high' | 'low'): Promise<void> {
    if (this.busy()) return;
    this.gambleResult.set(null);
    this.gambleWon.set(null);
    this.gambleDie.set(null);
    this.gambleRolling.set(true);
    this.pendingGambleText = null;
    this.pendingGambleWon = null;
    await this.run(async () => {
      const resp = await this.store.action('gamble', { bet: this.bet(), call });
      this.pendingGambleText = resp.text ?? null;
      this.pendingGambleWon = resp.gamble?.won ?? null;
      this.gambleDie.set(resp.gamble?.die ?? null);
    });
    if (this.gambleDie() === null) {
      // Errored — skip the animation.
      this.gambleRolling.set(false);
      this.gambleResult.set(this.pendingGambleText);
    }
  }

  onGambleSettled(): void {
    this.gambleRolling.set(false);
    this.gambleResult.set(this.pendingGambleText);
    this.gambleWon.set(this.pendingGambleWon);
  }

  adjustBet(delta: number): void {
    this.bet.set(Math.max(1, Math.min(20, this.bet() + delta)));
  }

  // ── Helpers ────────────────────────────────────────────────────────────────

  /** Battle-card art path per foe class (missing files fall back to icons). */
  private npcSpriteUrl(evType: string, npcId: string): string {
    if (evType === 'wild' || evType === 'elite') return `undercity/enemies/${npcId}.png`;
    // The wilderness World Event beast lives in its own art folder.
    if (evType === 'world') return `undercity/sigil_boss/${npcId}.png`;
    // Barriers, lair mini-bosses, and the island boss all share the guardians folder.
    return `undercity/guardians/${npcId}.png`;
  }

  /** A beaten lair boss reforms at half strength as the "Vestige of <boss>"
   *  (server names it so). Detect it from the display name so its combat sprite
   *  wears the same drained filter it does in the overworld. */
  private isVestigeFoe(name: string | undefined): boolean {
    return (name ?? '').startsWith('Vestige of ');
  }

  protected youSpriteUrl(): string | null {
    const you = this.store.you();
    return you ? this.spriteUrl(you.form, you.paint, you.hat, you.spriteVariant) : null;
  }

  protected spriteUrl(
    form: string,
    paint: Record<string, number>,
    hat?: string | null,
    variant?: string | null,
  ): string | null {
    const spr = formSprite(form, variant);
    return getRecoloredWithHatDataUrl(spr.sprite, paint ?? {}, spr.regions, hat);
  }

  private youBattleName(): string {
    const you = this.store.you();
    return you ? `Your ${you.creatureName || formName(you.form)}` : 'You';
  }

  /** Assemble the victory-popup spoils from a battle response/event. */
  private buildRewards(src: {
    spores?: number;
    xp?: number;
    levels?: number;
    item?: string;
    gear?: SpaceEvent['gear'];
  }): BattleRewards {
    const rewards: BattleRewards = { spores: src.spores, xp: src.xp, levels: src.levels };
    if (src.item) {
      const info = CONSUMABLE_MAP[src.item];
      rewards.itemName = info?.name ?? src.item;
      rewards.itemIcon = info?.icon;
    }
    if (src.gear) {
      const g = GEAR_MAP[src.gear.id];
      rewards.gearName = g?.name ?? src.gear.id;
      rewards.gearIcon = this.SLOT_ICONS[src.gear.slot] ?? 'hardware';
      rewards.gearStashed = src.gear.outcome === 'stashed';
    }
    return rewards;
  }

  closeBattle(): void {
    this.battleView.set(null);
    void this.store.refresh();
  }

  // ── Interactive PvE battle (Plan 3) ──────────────────────────────────────────

  private openLiveBattle(ev: SpaceEvent, preHp: number): void {
    const you = this.store.you();
    const bag = you?.bag ?? [];
    const items: BattleItem[] = bag
      .map((id) => CONSUMABLE_MAP[id])
      .filter((c): c is ConsumableInfo => !!c && !!c.inBattle)
      .map((c) => ({ id: c.id, name: c.name, icon: c.icon, effect: c.effect ?? '', desc: c.desc ?? '' }));
    this.liveBattle.set({
      attacker: {
        name: this.youBattleName(),
        spriteUrl: this.youSpriteUrl(),
        startHp: preHp,
        maxHp: you?.maxHp ?? preHp,
      },
      defender: {
        name: ev.npc!.name,
        spriteUrl: this.npcSpriteUrl(ev.kind!, ev.npc!.id),
        icon: NPC_ICONS[ev.npc!.id] ?? 'bug_report',
        startHp: ev.npc!.hp,
        maxHp: ev.npc!.maxHp ?? ev.npc!.hp,
        level: ev.npc!.level,
        vestige: this.isVestigeFoe(ev.npc!.name),
      },
      personality: ev.npc!.personality ?? 'balanced',
      telegraph: ev.telegraph ?? null,
      kind: ev.kind ?? 'wild',
      items,
      hasScry: bag.includes('scrying_spore'),
      attackerStats: you ? { atk: you.atk, def: you.def, spd: you.spd } : null,
      defenderStats:
        ev.npc!.atk != null && ev.npc!.def != null && ev.npc!.spd != null
          ? { atk: ev.npc!.atk, def: ev.npc!.def, spd: ev.npc!.spd }
          : null,
      augments: computeStanceAugments(you?.gear, you?.passives),
      attackerStatus: ev.playerStatus ?? null,
      defenderStatus: ev.npcStatus ?? null,
      resume: false,
      resumeRevealed: null,
      startRound: 1,
      frenzyFrom: ev.frenzyFrom ?? null,
      fleeChance: ev.fleeChance ?? null,
    });
  }

  /** Reopen a pending battle after a reload (server-side battle-guard would
   *  otherwise soft-lock the player). Fed by the pendingBattle effect. */
  private resumeLiveBattle(pb: BattleResume): void {
    const you = this.store.you();
    const bag = you?.bag ?? [];
    const items: BattleItem[] = bag
      .map((id) => CONSUMABLE_MAP[id])
      .filter((c): c is ConsumableInfo => !!c && !!c.inBattle)
      .map((c) => ({ id: c.id, name: c.name, icon: c.icon, effect: c.effect ?? '', desc: c.desc ?? '' }));
    this.liveBattle.set({
      attacker: {
        name: this.youBattleName(),
        spriteUrl: this.youSpriteUrl(),
        startHp: pb.playerHp,
        maxHp: you?.maxHp ?? pb.playerHp,
      },
      defender: {
        name: pb.npc.name,
        spriteUrl: this.npcSpriteUrl(pb.kind, pb.npc.id ?? ''),
        icon: NPC_ICONS[pb.npc.id ?? ''] ?? 'bug_report',
        startHp: pb.npc.hp,
        maxHp: pb.npc.maxHp,
        level: pb.npc.level,
        vestige: this.isVestigeFoe(pb.npc.name),
      },
      personality: pb.npc.personality ?? 'balanced',
      telegraph: pb.telegraph,
      kind: pb.kind,
      items,
      hasScry: bag.includes('scrying_spore'),
      attackerStats: you ? { atk: you.atk, def: you.def, spd: you.spd } : null,
      defenderStats:
        pb.npc.atk != null && pb.npc.def != null && pb.npc.spd != null
          ? { atk: pb.npc.atk, def: pb.npc.def, spd: pb.npc.spd }
          : null,
      augments: computeStanceAugments(you?.gear, you?.passives),
      attackerStatus: pb.playerStatus ?? null,
      defenderStatus: pb.npcStatus ?? null,
      resume: true,
      resumeRevealed: pb.revealed ?? null,
      startRound: pb.round ?? 1,
      frenzyFrom: pb.frenzyFrom ?? null,
      fleeChance: pb.fleeChance ?? null,
    });
  }

  /** Held combat items may be consumed each round — recompute the button list. */
  private refreshBagFlags(): void {
    const lb = this.liveBattle();
    if (!lb) return;
    const bag = this.store.you()?.bag ?? [];
    const items: BattleItem[] = bag
      .map((id) => CONSUMABLE_MAP[id])
      .filter((c): c is ConsumableInfo => !!c && !!c.inBattle)
      .map((c) => ({ id: c.id, name: c.name, icon: c.icon, effect: c.effect ?? '', desc: c.desc ?? '' }));
    this.liveBattle.set({ ...lb, items, hasScry: bag.includes('scrying_spore') });
  }

  async onStance(e: { stance: Stance; item?: string }): Promise<void> {
    try {
      const resp = await this.store.action('combat-round', {
        stance: e.stance,
        ...(e.item ? { item: e.item } : {}),
      });
      if (resp.spaceEvent) {
        this.finishLiveBattle(resp.spaceEvent);
        return;
      }
      const c = resp.combat as CombatRound | undefined;
      if (c && 'entries' in c) {
        this.liveB?.applyRound(c.entries, c.telegraph, c.playerHp, c.npcHp, c.playerStatus ?? null, c.npcStatus ?? null);
      }
      this.refreshBagFlags();
    } catch {
      this.liveB?.unlock();
    }
  }

  async onPeek(): Promise<void> {
    try {
      const resp = await this.store.action('combat-peek');
      if (resp.peek) this.liveB?.applyPeek(resp.peek.trueIntent);
      else this.liveB?.unlock();
      this.refreshBagFlags();
    } catch {
      this.liveB?.unlock();
    }
  }

  async onFlee(): Promise<void> {
    try {
      const resp = await this.store.action('combat-flee');
      // A failed flee whose enemy blow was lethal comes back as a battle result.
      if (resp.spaceEvent) {
        this.liveB?.fleeFailed();
        this.finishLiveBattle(resp.spaceEvent);
        return;
      }
      const c = resp.combat as CombatFlee | undefined;
      if (c?.fled) {
        this.liveB?.fleeResult(true);
      } else if (c && c.entries) {
        // Failed flee: announce it, then play the enemy's free action.
        this.liveB?.fleeFailed(c.entries, c.telegraph ?? null, c.playerHp ?? 0, c.npcHp ?? 0, c.playerStatus ?? null, c.npcStatus ?? null);
      } else {
        this.liveB?.unlock();
      }
    } catch {
      this.liveB?.unlock();
    }
  }

  private finishLiveBattle(ev: SpaceEvent): void {
    const you = this.store.you();
    const outcome = ev.battle?.outcome ?? 'timeout';
    const npcHp = ev.battle?.defenderHp ?? 0;
    // The killing round isn't returned as a `combat` payload — its blows live in
    // the accumulated strike list (rich CombatEntry dicts). Hand them to finish()
    // so the last exchange animates before the outcome banner drops, instead of
    // the fight snapping straight to VICTORY.
    const entries = (ev.battle?.strikes ?? []) as unknown as CombatEntry[];
    // A first-kill lair boss reports the sigil it drops — remember it so the
    // sunburst fanfare can fire once the player dismisses the victory screen.
    this.pendingSigilBiome = outcome === 'attacker' && ev.sigil ? ev.sigil : null;
    let text = ev.text ?? '';
    if (ev.worldKill && ev.reward) {
      text +=
        ` (${ev.reward.bracket} bracket: +${ev.reward.spores} Spores` +
        (ev.reward.renown ? `, +${ev.reward.renown} Renown` : '') +
        ')';
    }
    this.liveB?.finish(outcome, you?.hp ?? 0, npcHp, text, this.buildRewards(ev), entries);
  }

  async closeLiveBattle(): Promise<void> {
    const biome = this.pendingSigilBiome;
    this.pendingSigilBiome = null;
    this.liveBattle.set(null);
    await this.store.refresh(); // so poiClaims reflects the just-won sigil
    if (biome) this.openSigilCelebration(biome);
  }

  /** Pop the auto-dismissing "Guild Sigil claimed!" fanfare for a biome. */
  private openSigilCelebration(biome: string): void {
    const d = DUNGEONS[biome];
    if (!d) return;
    const claims = this.store.you()?.poiClaims ?? [];
    const count = Object.keys(DUNGEONS).filter((b) => claims.includes(`${b}_lair`)).length;
    this.sigilCelebration.set({
      biomeName: d.biomeName,
      lairName: d.lairName,
      lairNpcId: d.lairNpcId,
      count,
      required: SIGILS_REQUIRED,
      unsealed: count >= SIGILS_REQUIRED,
    });
    if (this.sigilTimer) clearTimeout(this.sigilTimer);
    this.sigilTimer = setTimeout(() => this.closeSigilCelebration(), 5600);
  }

  protected closeSigilCelebration(): void {
    if (this.sigilTimer) {
      clearTimeout(this.sigilTimer);
      this.sigilTimer = null;
    }
    this.sigilCelebration.set(null);
  }

  closeSpaceModal(): void {
    this.spaceModal.set(null);
  }

  closeFacilities(): void {
    this.showShop.set(false);
    this.showShrine.set(false);
    this.showWarp.set(null);
    this.showOssuary.set(false);
    this.showTradingPost.set(false);
    this.giveItem.set(null);
    this.selectedStock.set(null);
    this.showExcavation.set(false);
    this.excavationGrid.set(null);
    this.showFlowPuzzle.set(false);
    this.flowPuzzle.set(null);
    this.showVein.set(false);
    this.veinLog.set(null);
    this.showVault.set(false);
    this.vaultView.set(null);
    this.gambleResult.set(null);
    this.gambleRolling.set(false);
    this.gambleDie.set(null);
    this.gambleWon.set(null);
    this.store.openFacility.set(null);
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
