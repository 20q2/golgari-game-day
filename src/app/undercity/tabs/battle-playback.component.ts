import {
  Component,
  EventEmitter,
  Input,
  OnDestroy,
  OnInit,
  Output,
  computed,
  signal,
} from '@angular/core';
import { CommonModule } from '@angular/common';
import { MatIconModule } from '@angular/material/icon';
import { BattleResult, BattleStrike } from '../services/undercity-models';

export interface BattleSide {
  name: string;
  spriteUrl?: string | null;
  /** Material Icons ligature shown when there is no sprite (wild NPCs). */
  icon?: string;
  startHp: number;
  maxHp: number;
}

/** Spoils shown in the victory popup after a won battle. */
export interface BattleRewards {
  spores?: number;
  xp?: number;
  levels?: number;
  itemName?: string;
  itemIcon?: string;
}

/**
 * Plays back a server-resolved battle log as a short animated sequence —
 * sprites lunge, damage numbers pop, HP bars drain. Pure presentation.
 */
@Component({
  selector: 'app-undercity-battle-playback',
  standalone: true,
  imports: [CommonModule, MatIconModule],
  templateUrl: './battle-playback.component.html',
  styleUrls: ['./battle-playback.component.scss'],
})
export class BattlePlaybackComponent implements OnInit, OnDestroy {
  @Input({ required: true }) battle!: BattleResult;
  @Input({ required: true }) attacker!: BattleSide;
  @Input({ required: true }) defender!: BattleSide;
  @Input() resultText = '';
  @Input() rewards: BattleRewards | null = null;
  @Output() closed = new EventEmitter<void>();

  /** True once the fight has resolved in the player's favour with spoils to show. */
  protected hasRewards(): boolean {
    const r = this.rewards;
    return (
      this.battle.outcome === 'attacker' &&
      !!r &&
      (!!r.spores || !!r.xp || !!r.levels || !!r.itemName)
    );
  }

  protected readonly attackerHp = signal(0);
  protected readonly defenderHp = signal(0);
  // Missing sprite PNGs (e.g. dungeon wilds awaiting art) fall back to icons.
  // The component is recreated per battle, so no reset is needed.
  protected readonly attackerSpriteFailed = signal(false);
  protected readonly defenderSpriteFailed = signal(false);
  protected readonly lines = signal<string[]>([]);
  protected readonly lunge = signal<'attacker' | 'defender' | null>(null);
  protected readonly hit = signal<'attacker' | 'defender' | null>(null);
  protected readonly popup = signal<{ side: 'attacker' | 'defender'; text: string } | null>(null);
  protected readonly done = signal(false);

  /** Log rendered newest-first so the latest strike is always visible. */
  protected readonly linesNewestFirst = computed(() => [...this.lines()].reverse());

  protected outcomeLabel(): string {
    switch (this.battle.outcome) {
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

  private timer: ReturnType<typeof setInterval> | null = null;
  private idx = 0;

  ngOnInit(): void {
    this.attackerHp.set(this.attacker.startHp);
    this.defenderHp.set(this.defender.startHp);
    if (this.battle.outcome === 'fled' || this.battle.strikes.length === 0) {
      this.finish();
      return;
    }
    this.timer = setInterval(() => this.step(), 700);
  }

  ngOnDestroy(): void {
    if (this.timer) clearInterval(this.timer);
  }

  skip(): void {
    if (this.timer) clearInterval(this.timer);
    this.timer = null;
    this.finish();
  }

  close(): void {
    this.closed.emit();
  }

  private step(): void {
    const strike = this.battle.strikes[this.idx++];
    if (!strike) {
      if (this.timer) clearInterval(this.timer);
      this.timer = null;
      this.finish();
      return;
    }
    this.applyStrike(strike, true);
  }

  private applyStrike(s: BattleStrike, animate: boolean): void {
    const target = s.by === 'attacker' ? 'defender' : 'attacker';
    const byName = s.by === 'attacker' ? this.attacker.name : this.defender.name;
    const targetName = s.by === 'attacker' ? this.defender.name : this.attacker.name;

    if (animate) {
      this.lunge.set(s.by);
      setTimeout(() => this.lunge.set(null), 300);
    }

    let line: string;
    if (s.miss) {
      line = `${byName} strikes — ${targetName} slips aside!`;
      if (animate) this.popup.set({ side: target, text: 'miss' });
    } else {
      if (target === 'defender') this.defenderHp.set(Math.max(0, this.defenderHp() - s.dmg));
      else this.attackerHp.set(Math.max(0, this.attackerHp() - s.dmg));
      line = s.retaliation
        ? `${byName} retaliates for ${s.dmg}! (Scavenge)`
        : `${byName} hits ${targetName} for ${s.dmg}` + (s.heal ? ` and drains ${s.heal} HP` : '');
      if (s.heal) {
        if (s.by === 'attacker')
          this.attackerHp.set(Math.min(this.attacker.maxHp, this.attackerHp() + s.heal));
        else this.defenderHp.set(Math.min(this.defender.maxHp, this.defenderHp() + s.heal));
      }
      if (animate) {
        this.hit.set(target);
        this.popup.set({ side: target, text: `-${s.dmg}` });
        setTimeout(() => this.hit.set(null), 300);
      }
    }
    this.lines.set([...this.lines(), line]);
    if (animate) setTimeout(() => this.popup.set(null), 550);
  }

  private finish(): void {
    // Fast-forward remaining strikes into the log, land on final HP.
    while (this.idx < this.battle.strikes.length) {
      this.applyStrike(this.battle.strikes[this.idx++], false);
    }
    this.attackerHp.set(this.battle.attackerHp);
    this.defenderHp.set(this.battle.defenderHp);
    this.done.set(true);
  }

  hpPct(side: 'attacker' | 'defender'): number {
    const hp = side === 'attacker' ? this.attackerHp() : this.defenderHp();
    const max = side === 'attacker' ? this.attacker.maxHp : this.defender.maxHp;
    return Math.max(0, Math.min(100, Math.round((hp / Math.max(1, max)) * 100)));
  }
}
