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
  signal,
} from '@angular/core';
import { CommonModule } from '@angular/common';
import { MatIconModule } from '@angular/material/icon';
import { UndercityStateService } from '../services/undercity-state.service';
import { BoardCanvas, BoardMap, NodeInfo } from '../engine/board-canvas';
import { legalSteps, boardDistance, nodesWithin } from '../engine/board-movement';
import {
  AwayEvent,
  BattleResult,
  DigGrid,
  Occupant,
  PublicPlayer,
  SpaceEvent,
  TradeStockItem,
  VaultView,
  isShielded,
} from '../services/undercity-models';
import { VAULT_POT_SEED } from '../data/vein-vault';
import {
  BIOME_SPELLS,
  GRIMOIRE_MAP,
  GRIMOIRES,
  GrimoireInfo,
  SPELL_MAP,
  SpellInfo,
  cooldownLeftMin,
} from '../data/spells';
import {
  GEAR,
  CONSUMABLES,
  CONSUMABLE_MAP,
  SPACE_NAMES,
  SPACE_BLURBS,
  SPACE_ICONS,
  SPACE_TINTS,
  NPC_ICONS,
  GearInfo,
  ConsumableInfo,
} from '../data/items';
import { DUNGEONS, dungeonBiome } from '../data/dungeons';
import { formName } from '../data/forms';
import { formSprite } from '../data/species';
import { getRecoloredDataUrl } from '../engine/sprite-engine';
import { BattlePlaybackComponent, BattleSide, BattleRewards } from './battle-playback.component';
import { DiceRollComponent } from './dice-roll.component';
import { ExcavationModalComponent } from './excavation.component';
import { CrystalVeinModalComponent } from './crystal-vein.component';
import { GuildvaultModalComponent } from './guildvault.component';
import { MysteryReelComponent } from './mystery-reel.component';

interface BattleView {
  battle: BattleResult;
  attacker: BattleSide;
  defender: BattleSide;
  resultText: string;
  rewards: BattleRewards | null;
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

@Component({
  selector: 'app-undercity-board-tab',
  standalone: true,
  imports: [
    CommonModule,
    MatIconModule,
    BattlePlaybackComponent,
    DiceRollComponent,
    ExcavationModalComponent,
    CrystalVeinModalComponent,
    GuildvaultModalComponent,
    MysteryReelComponent,
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
  protected readonly showShop = signal(false);
  protected readonly showShrine = signal(false);
  protected readonly showWarp = signal<string[] | null>(null);
  protected readonly showOssuary = signal(false);
  protected readonly showTradingPost = signal(false);
  protected readonly tradingStock = signal<TradeStockItem[]>([]);
  protected readonly giveItem = signal<string | null>(null);
  protected readonly showExcavation = signal(false);
  protected readonly excavationGrid = signal<DigGrid | null>(null);
  protected readonly showVein = signal(false);
  protected readonly veinDepth = signal(0);
  protected readonly veinLog = signal<string | null>(null);
  protected readonly showVault = signal(false);
  protected readonly vaultView = signal<VaultView | null>(null);
  protected readonly reelSymbol = signal<string | null>(null);
  private pendingMysteryEv: SpaceEvent | null = null;
  protected readonly bet = signal(5);
  protected readonly gambleResult = signal<string | null>(null);
  protected readonly rolling = signal(false);
  protected readonly rolledValue = signal<number | null>(null);
  protected readonly gambleRolling = signal(false);
  protected readonly gambleDie = signal<number | null>(null);
  protected readonly gambleWon = signal<boolean | null>(null);
  private pendingGambleText: string | null = null;
  private pendingGambleWon: boolean | null = null;
  private readonly stepping = signal<StepState | null>(null);
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
  /** "While you were away" — populated once, from the first you-doc snapshot. */
  protected readonly awayModal = signal<AwayEvent[] | null>(null);
  private awayInitDone = false;
  private awaySeenCount = 0;

  protected readonly stepsLeft = computed(
    () => this.stepping()?.left ?? this.store.you()?.pendingMove?.value ?? 0,
  );

  protected readonly canStepBack = computed(() => (this.stepping()?.path.length ?? 0) > 1);

  protected readonly gear = GEAR;
  protected readonly consumables = CONSUMABLES;
  protected readonly isShielded = isShielded;
  protected readonly shopGrimoires = GRIMOIRES.filter((g) => g.tier === 1);

  protected readonly castableSpells = computed<SpellInfo[]>(() => {
    const you = this.store.you();
    if (!you) return [];
    const ids: string[] = [];
    const innate = BIOME_SPELLS[you.homeBiome ?? ''];
    if (innate) ids.push(innate);
    const book = you.equippedGrimoire ? GRIMOIRE_MAP[you.equippedGrimoire] : null;
    if (book) for (const s of book.spells) if (!ids.includes(s)) ids.push(s);
    return ids.map((id) => SPELL_MAP[id]).filter(Boolean);
  });

  protected cooldownLabel(spellId: string): string {
    const left = cooldownLeftMin(this.store.you()?.spellCooldowns, spellId);
    return left > 0 ? `${left} min` : 'Ready';
  }

  protected spellReady(spellId: string): boolean {
    return cooldownLeftMin(this.store.you()?.spellCooldowns, spellId) === 0;
  }

  private closedBarrierIds(): string[] {
    return this.map.nodes
      .filter((n) => n.type === 'barrier' && !this.store.barriersOpen().includes(n.id))
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

  /** Route a spell-picker tap to the right follow-up (target/value/node/cast). */
  pickSpell(spell: SpellInfo): void {
    if (!this.spellReady(spell.id)) return;
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
    const source = BIOME_SPELLS[you?.homeBiome ?? ''] === spell.id ? 'innate' : 'grimoire';
    const preHp = you?.hp ?? 0;
    await this.run(async () => {
      const resp = await this.store.action('cast', { spellId: spell.id, source, ...extra });
      this.closeSpellPickers();
      if (resp.cast?.text) this.showToast(resp.cast.text);
      if (resp.spaceEvent) {
        if (resp.you) this.board?.centerOn(resp.you.position);
        this.occupants.set(resp.occupants ?? []);
        this.routeSpaceEvent(resp.spaceEvent, preHp);
      }
    });
  }

  protected closeSpellPickers(): void {
    this.showSpells.set(false);
    this.spellTargetPick.set(null);
    this.spellValuePick.set(null);
    this.spellBossPick.set(null);
    this.castTeleport.set(null);
    this.syncBoard();
  }

  protected ownsGrimoire(id: string): boolean {
    return (this.store.you()?.grimoires ?? []).includes(id);
  }

  protected grimoireSpellList(g: GrimoireInfo): string {
    return g.spells.map((s) => SPELL_MAP[s]?.name ?? s).join(', ');
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

  /** Biome backdrop per node region — the scenery behind the event banner. */
  private readonly BIOME_BG: Record<string, string> = {
    city: 'undercity_background.png',
    cavern: 'cavern_background.png',
    bog: 'swamp_background.png',
    isle: 'palace_background.png',
  };

  /**
   * Event-card backdrop: the biome scenery for the space you landed on, fills
   * the whole dialog under a gradient that reads clear at the top and darkens
   * downward so the title, body, and chips stay legible in every chamber.
   */
  protected eventCardBg(): string {
    const pos = this.store.you()?.position;
    const region = this.map?.nodes.find((n) => n.id === pos)?.region ?? 'city';
    const file = this.BIOME_BG[region] ?? this.BIOME_BG['city'];
    return (
      `linear-gradient(to bottom, ` +
      `rgba(20, 18, 14, 0.15) 0%, ` +
      `rgba(20, 18, 14, 0.55) 42%, ` +
      `rgba(20, 18, 14, 0.97) 100%), ` +
      `url('undercity/${file}')`
    );
  }

  protected itemInfo(id: string): ConsumableInfo | null {
    return CONSUMABLE_MAP[id] ?? null;
  }

  protected eventHasChips(ev: SpaceEvent): boolean {
    return !!(ev.spores || ev.sporesLost || ev.hp || ev.item || ev.paint || ev.hat);
  }

  protected readonly nodeType = computed(() => {
    const pos = this.store.you()?.position;
    return this.map?.nodes.find((n) => n.id === pos)?.type ?? null;
  });

  /** Ossuary gambles remaining this visit (defaults to a full set of 3). */
  protected readonly ossuaryRollsLeft = computed(() => this.store.you()?.ossuaryRollsLeft ?? 3);

  /** Excavation digs remaining this visit. */
  protected readonly excavationDigsLeft = computed(() => this.store.you()?.excavationDigsLeft ?? 0);

  /** Crystal-vein strikes remaining this visit (the first is spent on landing). */
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
      } else if (pm && !step && you) {
        this.stepping.set({ path: [you.position], left: pm.value });
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
        this.showToast(this.awayText(events[events.length - 1]));
        void this.store.action('ack-events');
      }
      this.awaySeenCount = events.length;
    });
  }

  protected awayText(e: AwayEvent): string {
    const spell = SPELL_MAP[e.spell]?.name ?? e.spell;
    return e.kind === 'spell_hit'
      ? `${e.from}'s ${spell} hit you for ${e.dmg ?? 0}!`
      : `You dodged ${e.from}'s ${spell}!`;
  }

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
  }

  ngOnDestroy(): void {
    this.board?.stop();
    this.board = null;
  }

  // ── Roll & move ────────────────────────────────────────────────────────────

  async roll(): Promise<void> {
    if (this.busy()) return;
    this.rolledValue.set(null);
    this.rolling.set(true);
    await this.run(async () => {
      const resp = await this.store.action('roll');
      this.rolledValue.set(resp.roll?.value ?? resp.you?.pendingMove?.value ?? null);
    });
    // Errored (or no value came back) — drop the die, the toast explains why.
    if (this.rolledValue() === null) this.rolling.set(false);
  }

  onDiceSettled(): void {
    this.rolling.set(false);
  }

  /** Map a mystery outcome to a reel face so it lands on something meaningful. */
  private mysterySymbol(ev: SpaceEvent): string {
    if (ev.item) return 'item';
    if (ev.hat) return 'hat';
    if (ev.paint) return 'paint';
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
        this.hideInfo();
        this.stepping.set({ path: [...step.path, nodeId], left: step.left - 1 });
        this.board?.centerOn(nodeId);
        if (step.left === 1) void this.move(nodeId);
        return;
      }
    }
    // Not a walk step — peek at what this space does.
    this.toggleInfo(nodeId);
  }

  // ── Space info popover ───────────────────────────────────────────────────────

  private infoNodeId: string | null = null;

  /** Space name + blurb (with snare hint) for a node's popover. */
  private buildNodeInfo(nodeId: string): NodeInfo | null {
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
        body = `A ${d.wildName} hunts these tunnels. Beat it for XP and a fat bounty.`;
      } else if (node.type === 'lair') {
        body = `The den of ${d.lairName}. First kill claims the ${d.name} Guild Sigil.`;
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
    const closed = this.map.nodes
      .filter((n) => n.type === 'barrier' && !this.store.barriersOpen().includes(n.id))
      .map((n) => n.id);
    return legalSteps(this.map, stepPos(step), stepPrev(step), step.left, dests, closed);
  }

  private syncBoard(): void {
    if (!this.board) return;
    const step = this.stepping();
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
          level: p.level,
          paint: p.paint ?? {},
          position,
          shielded: isShielded(p),
        };
      }),
    );
    this.board.setSnares(this.store.snares());
    this.board.setBarriersOpen(this.store.barriersOpen());
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
  }

  private async move(to: string): Promise<void> {
    const preHp = this.store.you()?.hp ?? 0;
    await this.run(async () => {
      const resp = await this.store.action('move', { to });
      if (resp.you) this.board?.centerOn(resp.you.position);
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
    const fightTypes = ['wild', 'elite', 'barrier', 'lair', 'boss'];
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
        },
        resultText: ev.text,
        rewards: this.buildRewards(ev),
      });
    } else if (ev.type === 'warp' && ev.options) {
      this.showWarp.set(ev.options);
    } else if (ev.type === 'shop') {
      this.showShop.set(true);
    } else if (ev.type === 'shrine') {
      this.showShrine.set(true);
    } else if (ev.type === 'ossuary') {
      this.showOssuary.set(true);
    } else if (ev.type === 'trading_post') {
      this.openTradingPost(ev.stock);
    } else if (ev.type === 'excavation') {
      this.openExcavation(ev.grid);
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
            ? this.spriteUrl(targetPublic.form, targetPublic.paint)
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

  async shrine(choice: string): Promise<void> {
    await this.run(async () => {
      const resp = await this.store.action('shrine', { choice });
      this.showToast(resp.text ?? 'The shrine hums.');
      this.showShrine.set(false);
    });
  }

  // ── Trading post ─────────────────────────────────────────────────────────────

  protected readonly consumableMap = CONSUMABLE_MAP;

  /** Open the post, seeding the modal from the landing event or polled state. */
  openTradingPost(stock?: TradeStockItem[] | null): void {
    const pos = this.store.you()?.position ?? '';
    this.tradingStock.set(stock ?? this.store.tradingPosts()[pos] ?? []);
    this.giveItem.set(null);
    this.showTradingPost.set(true);
  }

  /** Swap the selected bag item for stock slot `takeIndex`. */
  async trade(takeIndex: number): Promise<void> {
    const give = this.giveItem();
    if (!give) return;
    await this.run(async () => {
      const resp = await this.store.action('trade', { give, takeIndex });
      if (resp.stock) this.tradingStock.set(resp.stock);
      this.giveItem.set(null);
      this.showToast(resp.text ?? 'Traded.');
    });
  }

  async warpTo(to: string): Promise<void> {
    await this.run(async () => {
      await this.store.action('warp', { to });
      this.showWarp.set(null);
      this.board?.centerOn(to);
    });
  }

  // ── Excavation ─────────────────────────────────────────────────────────────

  /** Open the dig site, seeding the grid from the landing event or polled state. */
  openExcavation(grid?: DigGrid | null): void {
    const pos = this.store.you()?.position ?? '';
    this.excavationGrid.set(grid ?? this.store.excavations()[pos] ?? null);
    this.showExcavation.set(true);
  }

  /** Reveal one cell; the response carries the updated grid and remaining digs. */
  async dig(cell: { r: number; c: number }): Promise<void> {
    await this.run(async () => {
      const resp = await this.store.action('dig', { r: cell.r, c: cell.c });
      if (resp.grid) this.excavationGrid.set(resp.grid);
      if (resp.found || resp.cleared) this.showToast(resp.text ?? 'You dig…');
    });
  }

  // ── Crystal Vein ───────────────────────────────────────────────────────────

  /** Open the shaft, seeding depth from the landing event or polled state. */
  openVein(ev?: SpaceEvent): void {
    const pos = this.store.you()?.position ?? '';
    const region = this.map?.nodes.find((n) => n.id === pos)?.region ?? '';
    this.veinDepth.set(ev?.depth ?? this.store.veins()[region]?.depth ?? 0);
    this.veinLog.set(ev?.text ?? null);
    this.showVein.set(true);
  }

  /** One optional swing; the response carries the new shared depth. */
  async strike(): Promise<void> {
    await this.run(async () => {
      const resp = await this.store.action('strike');
      if (resp.depth !== undefined) this.veinDepth.set(resp.depth);
      this.veinLog.set(resp.text ?? null);
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
  }

  /** One pick attempt; the response carries the updated ledger and pot. */
  async vaultGuess(guess: string[]): Promise<void> {
    await this.run(async () => {
      const resp = await this.store.action('vault-guess', { guess });
      if (resp.vault) this.vaultView.set(resp.vault);
      if (resp.guess?.cracked) this.showToast(resp.text ?? 'CRACKED!');
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
    if (evType === 'barrier') return `undercity/guardians/${npcId}.jfif`;
    // Lair mini-bosses and the island boss share the sigil_boss folder.
    return `undercity/sigil_boss/${npcId}.jfif`;
  }

  protected youSpriteUrl(): string | null {
    const you = this.store.you();
    return you ? this.spriteUrl(you.form, you.paint) : null;
  }

  protected spriteUrl(form: string, paint: Record<string, number>): string | null {
    const spr = formSprite(form);
    return getRecoloredDataUrl(spr.sprite, paint ?? {}, spr.regions);
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
  }): BattleRewards {
    const rewards: BattleRewards = { spores: src.spores, xp: src.xp, levels: src.levels };
    if (src.item) {
      const info = CONSUMABLE_MAP[src.item];
      rewards.itemName = info?.name ?? src.item;
      rewards.itemIcon = info?.icon;
    }
    return rewards;
  }

  closeBattle(): void {
    this.battleView.set(null);
    void this.store.refresh();
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
    this.showExcavation.set(false);
    this.excavationGrid.set(null);
    this.showVein.set(false);
    this.veinLog.set(null);
    this.showVault.set(false);
    this.vaultView.set(null);
    this.gambleResult.set(null);
    this.gambleRolling.set(false);
    this.gambleDie.set(null);
    this.gambleWon.set(null);
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
