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
import { BattleSide, BattleRewards } from './battle-playback.component';
import { CombatEntry, Stance } from '../services/undercity-models';
import { STANCES, STANCE_MAP, PERSONALITY_TELL, TELEGRAPH_TEXT } from '../data/combat';

/** A held combat consumable the player may fire this round. */
export interface BattleItem {
  id: string;
  name: string;
  icon: string;
  effect: string;
}

/** Combat stats shown beside a fighter. */
export interface CombatStats {
  atk: number;
  def: number;
  spd: number;
}

type Outcome = 'attacker' | 'defender' | 'timeout' | 'fled';
type Side = 'attacker' | 'defender';

const ACTION_WORD: Record<Stance, string> = {
  aggress: 'Strike!',
  guard: 'Guard!',
  feint: 'Feint!',
};

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
  @Input({ required: true }) telegraph!: Stance;
  @Input() canFlee = true;
  @Input() items: BattleItem[] = [];
  @Input() hasScry = false;
  @Input() attackerStats: CombatStats | null = null;
  @Input() defenderStats: CombatStats | null = null;
  /** Reopening a fight after a reload — skip the entrance, restore any scry. */
  @Input() resume = false;
  @Input() resumeRevealed: Stance | null = null;

  @Output() submitStance = new EventEmitter<{ stance: Stance; item?: string }>();
  @Output() peek = new EventEmitter<void>();
  @Output() flee = new EventEmitter<void>();
  @Output() closed = new EventEmitter<void>();

  protected readonly STANCES = STANCES;
  protected readonly stanceMap = STANCE_MAP;

  protected readonly attackerHp = signal(0);
  protected readonly defenderHp = signal(0);
  protected readonly busy = signal(false);
  protected readonly revealed = signal<Stance | null>(null);
  protected readonly pendingItem = signal<string | null>(null);
  protected readonly done = signal(false);
  protected readonly outcome = signal<Outcome | null>(null);
  protected readonly resultText = signal('');
  protected readonly rewards = signal<BattleRewards | null>(null);
  protected readonly showHelp = signal(false);
  protected readonly attackerSpriteFailed = signal(false);
  protected readonly defenderSpriteFailed = signal(false);

  // Bout animation state driven by the beat sequence.
  protected readonly stanceAnim = signal<{ attacker?: Stance; defender?: Stance }>({});
  protected readonly actWord = signal<{ attacker?: string; defender?: string }>({});
  protected readonly guard = signal<{ attacker: boolean; defender: boolean }>({
    attacker: false,
    defender: false,
  });
  protected readonly struck = signal<Side | null>(null);
  protected readonly pop = signal<{ side: Side; text: string; kind: 'dmg' | 'heal' | 'miss' } | null>(null);
  /** Hide the telegraph/controls while the exchange plays. */
  protected readonly resolving = signal(false);

  // Opening sequence: blank arena → fighters drop in → VS → stats → controls.
  protected readonly enteredFighters = signal(false);
  protected readonly enteredVs = signal(false);
  protected readonly enteredStats = signal(false);
  protected readonly introDone = signal(false);

  private timers: ReturnType<typeof setTimeout>[] = [];

  ngOnInit(): void {
    this.attackerHp.set(this.attacker.startHp);
    this.defenderHp.set(this.defender.startHp);
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
  protected telegraphText(): string {
    return TELEGRAPH_TEXT[this.telegraph];
  }
  protected stanceOf(side: Side): Stance | undefined {
    return this.stanceAnim()[side];
  }

  // ── Player actions ─────────────────────────────────────────────────────────

  protected play(stance: Stance): void {
    if (this.busy() || this.done()) return;
    this.busy.set(true);
    this.submitStance.emit({ stance, item: this.pendingItem() ?? undefined });
    this.pendingItem.set(null);
  }

  protected toggleItem(id: string): void {
    if (this.busy() || this.done()) return;
    this.pendingItem.set(this.pendingItem() === id ? null : id);
  }

  protected doPeek(): void {
    if (this.busy() || this.done() || this.revealed()) return;
    this.busy.set(true);
    this.peek.emit();
  }

  protected doFlee(): void {
    if (this.busy() || this.done()) return;
    this.busy.set(true);
    this.flee.emit();
  }

  protected close(): void {
    this.closed.emit();
  }

  // ── Parent-driven results ────────────────────────────────────────────────────

  /** Play one resolved round as an animated bout, then advance + unlock. */
  applyRound(entries: CombatEntry[], telegraph: Stance, playerHp: number, npcHp: number): void {
    this.runSequence(entries, playerHp, npcHp, () => {
      this.telegraph = telegraph;
      this.revealed.set(null); // a scry only lasts its round
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
      at(first ? (header ? 780 : 220) : 560, () => this.animateEntry(e));
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
      this.resolving.set(false);
      onDone();
    });
  }

  private entryHasEffect(e: CombatEntry): boolean {
    return !!(e.dmg || e.heal || e.miss || e.negated);
  }

  private animateEntry(e: CombatEntry): void {
    const rot = !!e.rot;
    // strike/counter/swarm: `by` is the dealer → target is the other side.
    // rot tick: `by` is the side taking the rot → it IS the target.
    const target: Side = rot ? (e.by as Side) : e.by === 'attacker' ? 'defender' : 'attacker';

    if (e.dmg) {
      const cur = target === 'attacker' ? this.attackerHp() : this.defenderHp();
      (target === 'attacker' ? this.attackerHp : this.defenderHp).set(Math.max(0, cur - e.dmg));
      this.struck.set(target);
      this.pop.set({ side: target, text: `-${e.dmg}`, kind: 'dmg' });
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

    this.timers.push(setTimeout(() => this.pop.set(null), 520));
  }

  protected hasRewards(): boolean {
    const r = this.rewards();
    return this.outcome() === 'attacker' && !!r && (!!r.spores || !!r.xp || !!r.levels || !!r.itemName);
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
        return 'STALEMATE';
    }
  }

  hpPct(side: Side): number {
    const hp = side === 'attacker' ? this.attackerHp() : this.defenderHp();
    const max = side === 'attacker' ? this.attacker.maxHp : this.defender.maxHp;
    return Math.max(0, Math.min(100, Math.round((hp / Math.max(1, max)) * 100)));
  }
}
