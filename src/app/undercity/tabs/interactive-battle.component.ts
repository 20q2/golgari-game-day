import { Component, EventEmitter, Input, OnInit, Output, signal } from '@angular/core';
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

type Outcome = 'attacker' | 'defender' | 'timeout' | 'fled';

/** One rendered line in the round log. */
interface UiLog {
  round: number;
  tone: 'you' | 'foe' | 'neutral';
  text: string;
}

/**
 * Interactive PvE battle (Plan 3): shows the monster's telegraph + personality,
 * takes one stance (± peek/flee/consumable) per round, and animates the
 * server-resolved exchange the parent feeds back via applyRound/finish/etc.
 * The parent (board-tab) owns the network round-trips.
 */
@Component({
  selector: 'app-undercity-interactive-battle',
  standalone: true,
  imports: [CommonModule, MatIconModule],
  templateUrl: './interactive-battle.component.html',
  styleUrls: ['./interactive-battle.component.scss'],
})
export class InteractiveBattleComponent implements OnInit {
  @Input({ required: true }) attacker!: BattleSide;
  @Input({ required: true }) defender!: BattleSide;
  @Input({ required: true }) personality!: string;
  @Input({ required: true }) telegraph!: Stance;
  @Input() canFlee = true;
  @Input() items: BattleItem[] = [];
  @Input() hasScry = false;

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
  protected readonly log = signal<UiLog[]>([]);
  protected readonly done = signal(false);
  protected readonly outcome = signal<Outcome | null>(null);
  protected readonly resultText = signal('');
  protected readonly rewards = signal<BattleRewards | null>(null);
  protected readonly attackerSpriteFailed = signal(false);
  protected readonly defenderSpriteFailed = signal(false);
  protected readonly hit = signal<'attacker' | 'defender' | null>(null);

  ngOnInit(): void {
    this.attackerHp.set(this.attacker.startHp);
    this.defenderHp.set(this.defender.startHp);
  }

  protected tellText(): string {
    return PERSONALITY_TELL[this.personality] ?? 'watching you';
  }
  protected telegraphText(): string {
    return TELEGRAPH_TEXT[this.telegraph];
  }
  protected logNewestFirst(): UiLog[] {
    return [...this.log()].reverse();
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

  /** Animate one resolved round, advance the telegraph, unlock input. */
  applyRound(entries: CombatEntry[], telegraph: Stance, playerHp: number, npcHp: number): void {
    const tookHit = npcHp < this.defenderHp() ? 'defender' : playerHp < this.attackerHp() ? 'attacker' : null;
    for (const e of entries) this.pushLog(e);
    this.attackerHp.set(playerHp);
    this.defenderHp.set(npcHp);
    this.telegraph = telegraph;
    this.revealed.set(null); // a scry only lasts its round
    this.busy.set(false);
    if (tookHit) {
      this.hit.set(tookHit);
      setTimeout(() => this.hit.set(null), 300);
    }
  }

  applyPeek(trueIntent: Stance): void {
    this.revealed.set(trueIntent);
    this.busy.set(false);
  }

  /** Re-enable input after a failed network action (nothing resolved). */
  unlock(): void {
    this.busy.set(false);
  }

  /** The battle ended: freeze HP, show the outcome banner + spoils. */
  finish(outcome: Outcome, playerHp: number, npcHp: number, text: string, rewards: BattleRewards | null): void {
    this.attackerHp.set(playerHp);
    this.defenderHp.set(npcHp);
    this.outcome.set(outcome);
    this.resultText.set(text);
    this.rewards.set(rewards);
    this.done.set(true);
    this.busy.set(false);
  }

  fleeResult(escaped: boolean): void {
    if (escaped) {
      this.log.set([...this.log(), { round: 0, tone: 'neutral', text: 'You slip away into the dark.' }]);
      this.outcome.set('fled');
      this.done.set(true);
    }
    this.busy.set(false); // failed flee: the fight continues, re-enable input
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

  hpPct(side: 'attacker' | 'defender'): number {
    const hp = side === 'attacker' ? this.attackerHp() : this.defenderHp();
    const max = side === 'attacker' ? this.attacker.maxHp : this.defender.maxHp;
    return Math.max(0, Math.min(100, Math.round((hp / Math.max(1, max)) * 100)));
  }

  private pushLog(e: CombatEntry): void {
    const foe = this.defender.name;
    let tone: UiLog['tone'] = 'neutral';
    let text = '';
    if (e.winner && e.aStance && e.dStance) {
      text = `You ${this.stanceMap[e.aStance].label}, it ${this.stanceMap[e.dStance].label}.`;
    } else if (e.negated) {
      text = 'Warded — the blow is turned aside.';
    } else if (e.miss) {
      text = 'Dodged!';
    } else if (e.rotApplied) {
      text = `Rot takes hold of ${foe}.`;
    } else if (e.rot) {
      tone = e.by === 'attacker' ? 'foe' : 'you';
      text = `Rot festers for ${e.dmg}.`;
    } else if (e.heal && !e.dmg) {
      tone = 'you';
      text = `You drain ${e.heal} back.`;
    } else if (e.dmg) {
      tone = e.by === 'attacker' ? 'you' : 'foe';
      const who = e.by === 'attacker' ? `You hit ${foe}` : `${foe} hits you`;
      const suffix = e.retaliation ? ' (counter)' : e.heal ? ` (drain ${e.heal})` : '';
      text = `${who} for ${e.dmg}${suffix}.`;
    }
    if (text) this.log.set([...this.log(), { round: e.round, tone, text }]);
  }
}
