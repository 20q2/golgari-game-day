import {
  Component,
  EventEmitter,
  Input,
  OnDestroy,
  OnInit,
  Output,
  signal,
} from '@angular/core';
import { CommonModule } from '@angular/common';
import { MatIconModule } from '@angular/material/icon';
import { BattleSide, BattleRewards, CoinParticle, buildCoinParticles } from './battle-playback.component';
import { CombatEntry, Stance, BattleStatus } from '../services/undercity-models';
import { STANCES, STANCE_MAP, PERSONALITY_TELL, StanceAugment, COUNTER, StatusChip, StatusInfo, STATUS_INFO, statusChips, FRENZY_RAMP } from '../data/combat';

/** A held combat consumable the player may fire this round. */
export interface BattleItem {
  id: string;
  name: string;
  icon: string;
  effect: string;
  /** Human-readable description shown in the inventory tray. */
  desc: string;
}

/** Combat stats shown beside a fighter. The atk/def/spd are the effective values
 *  the fight actually uses (base + gear + any active buffs/curses); `delta` is the
 *  temporary buff/curse portion of that total, surfaced as a colored ±N. */
export interface CombatStats {
  atk: number;
  def: number;
  spd: number;
  delta?: { atk: number; def: number; spd: number };
}

type Outcome = 'attacker' | 'defender' | 'timeout' | 'fled';
type Side = 'attacker' | 'defender';

const ACTION_WORD: Record<Stance, string> = {
  aggress: 'Strike!',
  guard: 'Guard!',
  feint: 'Feint!',
};

/** Relative arena sprite scale for a fighter given its tier and its foe's tier.
 *  Symmetric: +25% per tier of advantage, clamped so a 2-tier gap lands at
 *  ±50% (e.g. a T1 pest vs a T3 apex → 0.5 vs 1.5). Missing either tier → 1
 *  (no scaling), so any tier-less path renders unchanged. */
export function spriteScale(mine?: number, theirs?: number): number {
  if (!mine || !theirs) return 1;
  const s = 1 + 0.25 * (mine - theirs);
  return Math.min(1.5, Math.max(0.5, s));
}

/**
 * Interactive PvE battle (Plan 3): shows the monster's telegraph + personality,
 * takes one stance (± peek/flee/consumable) per round, then plays the
 * server-resolved exchange as an animated bout — each fighter performs its
 * chosen stance (leaping strike / brace-and-shield / feint jab), the struck side
 * flashes red with a damage number. No text log; the sprites tell the story.
 */
@Component({
  selector: 'app-undercity-interactive-battle',
  standalone: true,
  imports: [CommonModule, MatIconModule],
  templateUrl: './interactive-battle.component.html',
  styleUrls: ['./interactive-battle.component.scss'],
})
export class InteractiveBattleComponent implements OnInit, OnDestroy {
  @Input({ required: true }) attacker!: BattleSide;
  @Input({ required: true }) defender!: BattleSide;
  @Input({ required: true }) personality!: string;
  /** Foe's predicted stance for the round — null when no read procced. */
  @Input() telegraph: Stance | null = null;
  @Input() canFlee = true;
  /** SPD-based escape % shown on the flee button (100 with a held Smoke Spore). */
  @Input() fleeChance: number | null = null;
  @Input() items: BattleItem[] = [];
  @Input() hasScry = false;
  @Input() attackerStats: CombatStats | null = null;
  @Input() defenderStats: CombatStats | null = null;
  /** Standing conditions per side (rot stacks + active buff/debuff kinds). */
  @Input() attackerStatus: BattleStatus | null = null;
  @Input() defenderStatus: BattleStatus | null = null;
  /** Equipped riders + stance passives that augment the player's stances. */
  @Input() augments: StanceAugment[] = [];
  /** Reopening a fight after a reload — skip the entrance, restore any scry. */
  @Input() resume = false;
  @Input() resumeRevealed: Stance | null = null;
  /** Round the fight opens on (>1 when resuming a fight already under way). */
  @Input() startRound = 1;
  /** Round the collapse begins for this fight, or null (boss/lair). */
  @Input() frenzyFrom: number | null = null;

  @Output() submitStance = new EventEmitter<{ stance: Stance; item?: string }>();
  @Output() peek = new EventEmitter<void>();
  @Output() flee = new EventEmitter<void>();
  @Output() closed = new EventEmitter<void>();

  protected readonly STANCES = STANCES;
  protected readonly stanceMap = STANCE_MAP;

  protected readonly attackerHp = signal(0);
  protected readonly defenderHp = signal(0);
  protected readonly aStatus = signal<BattleStatus | null>(null);
  protected readonly dStatus = signal<BattleStatus | null>(null);
  /** Which chip's popover is open, or null. */
  protected readonly openChip = signal<{ side: Side; kind: string } | null>(null);
  protected readonly busy = signal(false);
  protected readonly revealed = signal<Stance | null>(null);
  protected readonly pendingItem = signal<string | null>(null);
  protected readonly done = signal(false);
  protected readonly outcome = signal<Outcome | null>(null);
  protected readonly resultText = signal('');
  protected readonly rewards = signal<BattleRewards | null>(null);
  /** Brief "Couldn't escape!" flash shown when a flee attempt fails. */
  protected readonly fleeNotice = signal(false);
  protected readonly showHelp = signal(false);
  /** Which help tab is open: current battlefield effects, or the rules primer. */
  protected readonly helpTab = signal<'effects' | 'rules'>('effects');
  protected readonly showItems = signal(false);
  protected readonly attackerSpriteFailed = signal(false);
  protected readonly defenderSpriteFailed = signal(false);
  protected readonly companionSpriteFailed = signal(false);
  /** Which activation the sidekick is playing this beat (drives its CSS class). */
  protected readonly petAnim = signal<'attack' | 'defend' | null>(null);
  /** The companion's own popover text ('-N' follow-up dmg, or 'N' deflected). */
  protected readonly petPop = signal<{ text: string; kind: 'dmg' | 'block' } | null>(null);

  /** Relative sprite size for each fighter, driven by the tier gap. */
  protected attackerScale(): number {
    return spriteScale(this.attacker.tier, this.defender.tier);
  }
  protected defenderScale(): number {
    return spriteScale(this.defender.tier, this.attacker.tier);
  }
  /** The sidekick never grows with the player — it's a small companion, not a
   *  co-fighter. When the player towers over the foe (tier advantage) the pet
   *  shrinks a touch so the size gap reads clearly; it's floored so it never
   *  vanishes. */
  protected companionScale(): number {
    const s = this.attackerScale();
    return Math.min(1, Math.max(0.6, 1 - 0.5 * (s - 1)));
  }

  // Bout animation state driven by the beat sequence.
  protected readonly stanceAnim = signal<{ attacker?: Stance; defender?: Stance }>({});
  protected readonly actWord = signal<{ attacker?: string; defender?: string }>({});
  protected readonly guard = signal<{ attacker: boolean; defender: boolean }>({
    attacker: false,
    defender: false,
  });
  protected readonly struck = signal<Side | null>(null);
  protected readonly pop = signal<{
    side: Side;
    text: string;
    kind: 'dmg' | 'heal' | 'miss';
    /** Source glyph shown before the number (stance / rot / thorns / …). */
    icon?: string;
    /** True when `icon` is a registered `uc-*` SVG rather than a Material ligature. */
    iconSvg?: boolean;
  } | null>(null);
  /** Hide the telegraph/controls while the exchange plays. */
  protected readonly resolving = signal(false);

  // Opening sequence: blank arena → fighters drop in → VS → stats → controls.
  protected readonly enteredFighters = signal(false);
  protected readonly enteredVs = signal(false);
  protected readonly enteredStats = signal(false);
  protected readonly introDone = signal(false);

  /** You can't flee until you've traded at least one blow (server also gates). */
  protected readonly hasActed = signal(false);

  /** The round the player is about to act on (drives the collapse warning). */
  protected readonly round = signal(1);

  private timers: ReturnType<typeof setTimeout>[] = [];

  ngOnInit(): void {
    this.attackerHp.set(this.attacker.startHp);
    this.defenderHp.set(this.defender.startHp);
    this.aStatus.set(this.attackerStatus);
    this.dStatus.set(this.defenderStatus);
    this.round.set(this.startRound);
    this.hasActed.set(this.startRound > 1); // resumed mid-fight: already acted
    if (this.resume) {
      // Reopened after a reload: fighters are already in the ring.
      this.enteredFighters.set(true);
      this.enteredVs.set(true);
      this.enteredStats.set(true);
      this.introDone.set(true);
      this.revealed.set(this.resumeRevealed);
      return;
    }
    this.timers.push(setTimeout(() => this.enteredFighters.set(true), 250));
    this.timers.push(setTimeout(() => this.enteredVs.set(true), 950));
    this.timers.push(setTimeout(() => this.enteredStats.set(true), 1300));
    this.timers.push(setTimeout(() => this.introDone.set(true), 1650));
  }

  ngOnDestroy(): void {
    this.clearTimers();
  }

  private clearTimers(): void {
    for (const t of this.timers) clearTimeout(t);
    this.timers = [];
  }

  protected tellText(): string {
    return PERSONALITY_TELL[this.personality] ?? 'watching you';
  }

  /** The escalation multiplier now applied to every swing, formatted for display
   *  (e.g. "1.2"). Null until the ramp is live — mirrors engine `ramp = 1 +
   *  FRENZY_RAMP * (round - frenzyFrom + 1)`. */
  protected frenzyMult(): string | null {
    if (this.frenzyFrom == null) return null;
    const r = this.round();
    if (r < this.frenzyFrom) return null;
    return (1 + FRENZY_RAMP * (r - this.frenzyFrom + 1)).toFixed(1);
  }
  protected stanceOf(side: Side): Stance | undefined {
    return this.stanceAnim()[side];
  }

  /** The foe's shown next stance this round — a scry (certain) takes precedence
   *  over a bluffable read. Null when its intent is hidden. */
  protected foeIntent(): Stance | null {
    return this.revealed() ?? this.telegraph;
  }

  /** The stance that beats the foe's shown intent — the option we recommend the
   *  player pick. Null when we have no read on the foe. */
  protected counterStance(): Stance | null {
    const foe = this.foeIntent();
    return foe ? COUNTER[foe] : null;
  }

  /** A scry is guaranteed true (solid hint); a plain read can be a bluff, so its
   *  recommendation is only tentative. */
  protected readCertain(): boolean {
    return this.revealed() != null;
  }

  /** Equipped augments (gear riders + stance passives) that boost this stance. */
  protected augmentsFor(stance: Stance): StanceAugment[] {
    return this.augments.filter((a) => a.stance === stance);
  }

  /** Active status chips (rot + buffs/debuffs) for one fighter. */
  protected chipsFor(side: Side): StatusChip[] {
    return statusChips(side === 'attacker' ? this.aStatus() : this.dStatus());
  }

  protected toggleChip(side: Side, kind: string): void {
    const c = this.openChip();
    this.openChip.set(c && c.side === side && c.kind === kind ? null : { side, kind });
  }

  /** The StatusInfo whose popover is open on this side, or null. */
  protected chipPopover(side: Side): StatusInfo | null {
    const c = this.openChip();
    return c && c.side === side ? (STATUS_INFO[c.kind] ?? null) : null;
  }

  /** Open (or close) the help overlay. When opening, land on the Active Effects
   *  tab if there's anything live to explain (your stance perks or a standing
   *  buff/debuff on either side); otherwise open straight to the rules. */
  protected toggleHelp(): void {
    if (this.showHelp()) {
      this.showHelp.set(false);
      return;
    }
    this.helpTab.set(this.hasActiveEffects() ? 'effects' : 'rules');
    this.showHelp.set(true);
  }

  /** True when the Active Effects tab has anything to show. */
  protected hasActiveEffects(): boolean {
    return (
      this.augments.length > 0 ||
      this.chipsFor('attacker').length > 0 ||
      this.chipsFor('defender').length > 0
    );
  }

  /** Button tooltip: the stance blurb plus a line per active augment. */
  protected buttonTitle(s: (typeof STANCES)[number]): string {
    const augs = this.augmentsFor(s.id);
    if (!augs.length) return s.blurb;
    return [s.blurb, ...augs.map((a) => `+ ${a.label}: ${a.blurb}`)].join('\n');
  }

  // ── Player actions ─────────────────────────────────────────────────────────

  protected play(stance: Stance): void {
    if (this.busy() || this.done()) return;
    this.busy.set(true);
    this.submitStance.emit({ stance, item: this.pendingItem() ?? undefined });
    this.pendingItem.set(null);
  }

  /** Tap an item in the tray. The Scrying Spore (`effect: 'reveal'`) acts at
   *  once — it fires the peek instead of arming, since its whole point is to
   *  reveal before you commit a stance. Everything else arms (or disarms) and
   *  applies to the next stance. Either way, dismiss the panel. */
  protected armItem(id: string): void {
    if (this.busy() || this.done()) return;
    const it = this.items.find((i) => i.id === id);
    if (it?.effect === 'reveal') {
      this.showItems.set(false);
      this.doPeek();
      return;
    }
    this.pendingItem.set(this.pendingItem() === id ? null : id);
    this.showItems.set(false);
  }

  protected doPeek(): void {
    if (this.busy() || this.done() || this.revealed()) return;
    this.busy.set(true);
    this.peek.emit();
  }

  /** Tooltip for the flee button once fleeing is allowed — names the odds, and
   *  the Smoke Spore guarantee at 100%. */
  protected fleeTitle(): string {
    if (this.fleeChance == null) return 'Flee the fight';
    if (this.fleeChance >= 100) return 'Escape guaranteed (Smoke Spore)';
    return `Flee the fight — ${this.fleeChance}% chance to escape`;
  }

  protected doFlee(): void {
    if (this.busy() || this.done() || !this.hasActed()) return;
    this.busy.set(true);
    this.flee.emit();
  }

  protected close(): void {
    this.closed.emit();
  }

  // ── Parent-driven results ────────────────────────────────────────────────────

  /** Play one resolved round as an animated bout, then advance + unlock. */
  applyRound(
    entries: CombatEntry[],
    telegraph: Stance | null,
    playerHp: number,
    npcHp: number,
    playerStatus: BattleStatus | null = null,
    npcStatus: BattleStatus | null = null,
  ): void {
    this.hasActed.set(true); // a blow's been traded — fleeing is now allowed
    this.runSequence(entries, playerHp, npcHp, () => {
      this.telegraph = telegraph;
      this.round.update((r) => r + 1);
      this.revealed.set(null); // a scry only lasts its round
      this.aStatus.set(playerStatus);
      this.dStatus.set(npcStatus);
      this.openChip.set(null); // stale popover shouldn't survive the round
      this.busy.set(false);
    });
  }

  applyPeek(trueIntent: Stance): void {
    this.revealed.set(trueIntent);
    this.busy.set(false);
  }

  /** Re-enable input after a failed network action (nothing resolved). */
  unlock(): void {
    this.busy.set(false);
  }

  /**
   * The battle ended. Animate the final round's blows (if any) then drop the
   * outcome banner + spoils. `entries` is the full accumulated strike list;
   * only the last round is replayed here (earlier rounds already played).
   */
  finish(
    outcome: Outcome,
    playerHp: number,
    npcHp: number,
    text: string,
    rewards: BattleRewards | null,
    entries: CombatEntry[] = [],
  ): void {
    const bank = () => {
      this.attackerHp.set(playerHp);
      this.defenderHp.set(npcHp);
      this.outcome.set(outcome);
      this.resultText.set(text);
      this.rewards.set(rewards);
      this.done.set(true);
      this.busy.set(false);
    };
    const lastRound = entries.reduce((m, e) => Math.max(m, e.round || 0), 0);
    const finalEntries = entries.filter((e) => (e.round || 0) === lastRound);
    if (finalEntries.length) {
      this.runSequence(finalEntries, playerHp, npcHp, bank);
    } else {
      bank();
    }
  }

  fleeResult(escaped: boolean): void {
    if (escaped) {
      this.resultText.set('You slip away into the dark.');
      this.outcome.set('fled');
      this.done.set(true);
    }
    this.busy.set(false); // failed flee: the fight continues, re-enable input
  }

  /**
   * A flee attempt failed. Flash the notice, then play the enemy's free action
   * (the caught-off-guard round the server resolved). With no round args the
   * blow was lethal and the parent drives finish() separately — just flash.
   */
  fleeFailed(
    entries?: CombatEntry[],
    telegraph: Stance | null = null,
    playerHp = 0,
    npcHp = 0,
    playerStatus: BattleStatus | null = null,
    npcStatus: BattleStatus | null = null,
  ): void {
    this.fleeNotice.set(true);
    this.timers.push(setTimeout(() => this.fleeNotice.set(false), 1500));
    if (entries) {
      this.applyRound(entries, telegraph, playerHp, npcHp, playerStatus, npcStatus);
    }
    // lethal case: parent calls finish(); leave busy=true until it lands.
  }

  // ── Beat sequencer ───────────────────────────────────────────────────────────

  /**
   * Replay a round: both fighters perform their stance (word pops + animation),
   * the winner's blow lands mid-swing (struck side flashes red + damage pops),
   * then settle on the authoritative HP and call onDone.
   */
  private runSequence(
    entries: CombatEntry[],
    finalPlayerHp: number,
    finalNpcHp: number,
    onDone: () => void,
  ): void {
    this.clearTimers();
    this.resolving.set(true);
    let t = 0;
    const at = (delay: number, fn: () => void) => {
      t += delay;
      this.timers.push(setTimeout(fn, t));
    };

    const header = entries.find((e) => e.winner && e.aStance && e.dStance);
    const effects = entries.filter((e) => this.entryHasEffect(e));

    if (header) {
      const a = header.aStance!;
      const d = header.dStance!;
      at(0, () => {
        this.stanceAnim.set({ attacker: a, defender: d });
        this.actWord.set({ attacker: ACTION_WORD[a], defender: ACTION_WORD[d] });
        this.guard.set({ attacker: a === 'guard', defender: d === 'guard' });
      });
      at(750, () => this.actWord.set({})); // words fade once the wind-up reads
    }

    let first = true;
    for (const e of effects) {
      // First blow lands at the aggressor's impact (~mid leap); rest space out.
      const lead = first ? (header ? 780 : 220) : 560;
      // A companion beat waits a touch longer so it reads as its own moment.
      const delay = e.pet ? Math.max(lead, 720) : lead;
      at(delay, () => this.animateEntry(e, header?.aStance, header?.dStance));
      first = false;
    }

    at(720, () => {
      this.attackerHp.set(finalPlayerHp);
      this.defenderHp.set(finalNpcHp);
      this.stanceAnim.set({});
      this.guard.set({ attacker: false, defender: false });
      this.actWord.set({});
      this.struck.set(null);
      this.pop.set(null);
      this.petAnim.set(null);
      this.petPop.set(null);
      this.resolving.set(false);
      onDone();
    });
  }

  private entryHasEffect(e: CombatEntry): boolean {
    return !!(e.dmg || e.heal || e.miss || e.negated || e.deflect);
  }

  private animateEntry(e: CombatEntry, aStance?: Stance, dStance?: Stance): void {
    // rot + frenzy: `by` is the side TAKING the damage → it IS the target.
    const rot = !!e.rot || !!e.frenzy;
    // strike/counter/swarm: `by` is the dealer → target is the other side.
    // rot tick: `by` is the side taking the rot → it IS the target.
    const target: Side = rot ? (e.by as Side) : e.by === 'attacker' ? 'defender' : 'attacker';

    // Companion trigger: give the pet its own beat (lunge / block) + popover, and
    // skip the generic pop for this entry so the pet's message stands alone.
    if (e.pet === 'attack' && e.dmg) {
      const cur = target === 'attacker' ? this.attackerHp() : this.defenderHp();
      (target === 'attacker' ? this.attackerHp : this.defenderHp).set(Math.max(0, cur - e.dmg));
      this.struck.set(target);
      this.timers.push(setTimeout(() => this.struck.set(null), 380));
      this.petAnim.set('attack');
      this.petPop.set({ text: `-${e.dmg}`, kind: 'dmg' });
      this.timers.push(setTimeout(() => this.petAnim.set(null), 650));
      this.timers.push(setTimeout(() => this.petPop.set(null), 900));
      return;
    }
    if (e.pet === 'defend' && e.deflect) {
      this.petAnim.set('defend');
      this.petPop.set({ text: `${e.deflect}`, kind: 'block' });
      this.timers.push(setTimeout(() => this.petAnim.set(null), 650));
      this.timers.push(setTimeout(() => this.petPop.set(null), 900));
      return;
    }

    if (e.dmg) {
      const cur = target === 'attacker' ? this.attackerHp() : this.defenderHp();
      (target === 'attacker' ? this.attackerHp : this.defenderHp).set(Math.max(0, cur - e.dmg));
      this.struck.set(target);
      const ic = this.dmgIcon(e, aStance, dStance);
      this.pop.set({ side: target, text: `-${e.dmg}`, kind: 'dmg', icon: ic?.icon, iconSvg: ic?.svg });
      this.timers.push(setTimeout(() => this.struck.set(null), 380));
    } else if (e.miss || e.negated) {
      this.pop.set({ side: target, text: e.negated ? 'ward' : 'miss', kind: 'miss' });
    }

    if (e.heal) {
      const healer: Side = e.by as Side;
      const max = healer === 'attacker' ? this.attacker.maxHp : this.defender.maxHp;
      const cur = healer === 'attacker' ? this.attackerHp() : this.defenderHp();
      (healer === 'attacker' ? this.attackerHp : this.defenderHp).set(Math.min(max, cur + e.heal));
      if (!e.dmg) this.pop.set({ side: healer, text: `+${e.heal}`, kind: 'heal' });
    }

    this.timers.push(setTimeout(() => this.pop.set(null), 880));
  }

  /**
   * Pick the source glyph shown before a damage number so the pop reads at a
   * glance: rot tick, thorns reflect, swarm chip, guard counter, or the winning
   * stance itself. `svg:true` means a `uc-*` SVG icon; otherwise a Material
   * ligature. Order matters — specific effect tags win over the plain strike.
   */
  private dmgIcon(e: CombatEntry, aStance?: Stance, dStance?: Stance): { icon: string; svg: boolean } | null {
    if (e.rot) return { icon: 'coronavirus', svg: false }; // rot damage-over-time
    if (e.frenzy) return { icon: 'local_fire_department', svg: false }; // legacy escalation
    if (e.retaliation) return { icon: 'uc-carapace', svg: true }; // thorns / spikeshell reflect
    if (e.swarm) return { icon: 'uc-fang', svg: true }; // swarm chip
    if (e.counter || e.guardChip) return { icon: 'uc-shield', svg: true }; // guard counter / chip
    if (e.mitigated) return { icon: 'uc-sword', svg: true }; // aggressor's hit soaked by a guard
    // Plain decisive blow — badge it with the winner's stance.
    const stance = e.winner === 'attacker' ? aStance : e.winner === 'defender' ? dStance : undefined;
    if (stance) return { icon: STANCE_MAP[stance].icon, svg: true };
    return null;
  }

  protected hasRewards(): boolean {
    const r = this.rewards();
    return this.outcome() === 'attacker' && !!r && (!!r.spores || !!r.xp || !!r.renown || !!r.levels || !!r.itemName || !!r.gearName);
  }

  // Built once on first read (when a win is shown) so the victory rain doesn't
  // reshuffle on every change-detection tick.
  private coinsCache: CoinParticle[] | null = null;
  protected coinParticles(): CoinParticle[] {
    if (!this.coinsCache && this.hasRewards()) {
      this.coinsCache = buildCoinParticles(this.rewards()!);
    }
    return this.coinsCache ?? [];
  }

  protected outcomeLabel(): string {
    switch (this.outcome()) {
      case 'attacker':
        return 'VICTORY';
      case 'defender':
        return 'DEFEAT';
      case 'fled':
        return 'ESCAPED';
      default:
        // The escalation ramp forces a kill long before this; only reachable
        // via the (in practice unreachable) COMBAT_HARD_CAP safety bound.
        return 'THE FIGHT ENDS IN EXHAUSTION';
    }
  }

  /** A signed label for a temporary stat swing ("+3" / "-2"), or '' when zero. */
  protected fmtDelta(n: number | undefined | null): string {
    if (!n) return '';
    return n > 0 ? `+${n}` : `${n}`;
  }

  hpPct(side: Side): number {
    const hp = side === 'attacker' ? this.attackerHp() : this.defenderHp();
    const max = side === 'attacker' ? this.attacker.maxHp : this.defender.maxHp;
    return Math.max(0, Math.min(100, Math.round((hp / Math.max(1, max)) * 100)));
  }
}
