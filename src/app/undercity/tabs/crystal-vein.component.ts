import {
  Component,
  EventEmitter,
  Input,
  Output,
  ViewChild,
  ElementRef,
  OnChanges,
  SimpleChanges,
} from '@angular/core';
import { CommonModule } from '@angular/common';
import {
  VEIN_CAVE_IN_PCT_PER_LEVEL,
  VEIN_CAVE_IN_DMG_PER_LEVEL,
  VEIN_ICHOR_BASE,
  VEIN_ICHOR_PER_LEVEL,
  VEIN_HEARTSTONE_ICHOR,
  VEIN_ITEM_CONSUMABLE_BAND,
  VEIN_ITEM_RARE_BAND,
  VEIN_MAX_DEPTH,
} from '../data/vein-vault';

/** One row of the next-strike odds table — a small gacha pull where the cave-in
 *  is just another possible result alongside the rewards. */
interface Outcome {
  icon: string;
  label: string;
  value: string;
  tone: 'gem' | 'item' | 'molt' | 'risk';
  muted?: boolean;
}

/**
 * The crystal-vein modal: a shared shaft everyone digs deeper. Pure
 * presentation — the parent owns the shared depth and the `strike` action.
 * You strike by tapping the shaft itself; the odds table shows what this swing
 * can turn up (cave-in included, gacha-style).
 */
@Component({
  selector: 'app-undercity-crystal-vein',
  standalone: true,
  imports: [CommonModule],
  template: `
    <div class="vein-overlay" (click)="closed.emit()">
      <div class="vein-card" (click)="$event.stopPropagation()" [style.background-image]="washBg">
        <h3>💎 Crystal Vein</h3>
        <p class="vein-sub">
          Shaft depth <strong>{{ depth }}</strong> / {{ MAX }} ·
          <strong>{{ strikesLeft }}</strong> strike{{ strikesLeft === 1 ? '' : 's' }} left ·
          Gemstones this visit: <strong #earnedEl class="earned">{{ earnedThisVisit }}</strong> 💠
        </p>

        <!-- The shaft IS the strike button: tap the vein to swing your pick. -->
        <div
          #shaftEl
          class="vein-stage"
          [class.tappable]="canStrike"
          [class.heart]="isHeartstoneNext"
          role="button"
          [attr.aria-label]="canStrike ? 'Strike the crystal vein' : null"
          [attr.aria-disabled]="!canStrike"
          [attr.tabindex]="canStrike ? 0 : -1"
          (click)="onStrike()"
          (keydown.enter)="onStrike()"
          (keydown.space)="onStrike(); $event.preventDefault()"
        >
          <div class="shaft">
            @for (lv of levels; track lv) {
              <div
                class="rung"
                [class.dug]="lv <= depth"
                [class.next]="lv === depth + 1"
                [class.heart]="lv === MAX"
              ></div>
            }
          </div>
          @if (strikesLeft > 0) {
            <div class="strike-cue">
              <span class="pick">⛏️</span>
              <span>{{
                busy
                  ? 'Striking…'
                  : isHeartstoneNext
                    ? 'Tap to pry the Heartstone ✦'
                    : 'Tap the vein to strike'
              }}</span>
            </div>
          }
        </div>

        @if (log) {
          <p class="vein-log">{{ log }}</p>
        }

        @if (strikesLeft > 0) {
          <div class="forecast" [class.heart]="isHeartstoneNext">
            <p class="forecast-title">
              Next strike · Level {{ level }}
              @if (isHeartstoneNext) {
                <span class="heart-tag">— The Heartstone ✦</span>
              }
            </p>
            <ul class="odds-list">
              @for (o of outcomes; track o.label) {
                <li class="odds-row" [class.risk]="o.tone === 'risk'" [class.muted]="o.muted">
                  <span class="odds-icon">{{ o.icon }}</span>
                  <span class="odds-label">{{ o.label }}</span>
                  <span class="odds-val">{{ o.value }}</span>
                </li>
              }
            </ul>
          </div>

          @if (!isHeartstoneNext) {
            <p class="vein-hint goal">
              → Reach level {{ MAX }} for the <strong>Heartstone</strong>:
              +{{ HEART_ICHOR }}💠 · a rare find
            </p>
          }
          <p class="vein-hint shared">
            Everyone digs the same shaft — your depth carries over for the next digger.
          </p>
        } @else {
          <p class="vein-hint out">Out of strikes — come back next time you land here.</p>
        }
        <button class="uc-btn close-btn" (click)="closed.emit()">Leave</button>
      </div>
    </div>
  `,
  styles: [
    `
      .vein-overlay {
        position: fixed;
        inset: 0;
        z-index: 1150;
        background: rgba(8, 6, 4, 0.75);
        display: flex;
        align-items: center;
        justify-content: center;
        padding: 16px;
      }
      .vein-card {
        width: min(360px, 100%);
        background: #151a1c;
        border: 1px solid rgba(90, 150, 165, 0.55);
        border-radius: 14px;
        padding: 18px;
        display: flex;
        flex-direction: column;
        gap: 10px;
        text-align: center;
      }
      h3 {
        margin: 0;
        color: #8fd0dd;
      }
      .vein-sub {
        margin: 0;
        font-size: 0.85rem;
        color: #9aa79a;
      }
      .vein-sub strong {
        color: #8fd0dd;
      }
      .earned {
        color: #b6ffbf;
        display: inline-block;
      }
      /* The tappable shaft — the vein you strike. */
      .vein-stage {
        display: flex;
        flex-direction: column;
        align-items: center;
        gap: 10px;
        padding: 14px 12px;
        border: 1px solid rgba(90, 150, 165, 0.28);
        border-radius: 12px;
        background: radial-gradient(120% 90% at 50% 0%, rgba(40, 62, 68, 0.55), rgba(16, 22, 24, 0.55));
        user-select: none;
        transition:
          transform 0.08s ease,
          border-color 0.15s ease,
          box-shadow 0.15s ease;
      }
      .vein-stage.tappable {
        cursor: pointer;
        border-color: rgba(143, 208, 221, 0.55);
      }
      .vein-stage.tappable:hover {
        box-shadow: 0 0 0 1px rgba(143, 208, 221, 0.35);
      }
      .vein-stage.tappable:active {
        transform: scale(0.98);
      }
      .vein-stage.heart.tappable {
        border-color: rgba(224, 192, 136, 0.7);
        box-shadow: 0 0 14px rgba(224, 192, 136, 0.25);
      }
      .shaft {
        display: flex;
        flex-direction: column-reverse;
        gap: 3px;
        width: 132px;
      }
      .rung {
        height: 12px;
        border-radius: 3px;
        background: #23282a;
        box-shadow: inset 0 2px 3px rgba(0, 0, 0, 0.6);
      }
      .rung.dug {
        background: linear-gradient(90deg, #2f6f7d 0%, #52a8ba 100%);
        box-shadow: inset 0 1px 2px rgba(255, 255, 255, 0.25);
      }
      .rung.next {
        outline: 1px dashed rgba(143, 208, 221, 0.85);
        animation: nextPulse 1.4s ease-in-out infinite;
      }
      .rung.heart {
        border: 1px solid rgba(224, 192, 136, 0.85);
      }
      @keyframes nextPulse {
        0%,
        100% {
          outline-color: rgba(143, 208, 221, 0.35);
        }
        50% {
          outline-color: rgba(143, 208, 221, 1);
        }
      }
      .strike-cue {
        display: flex;
        align-items: center;
        gap: 6px;
        font-size: 0.82rem;
        font-weight: 600;
        color: #b9e6ef;
      }
      .vein-stage.heart .strike-cue {
        color: #e7cf9c;
      }
      .strike-cue .pick {
        font-size: 1.05rem;
      }
      .vein-log {
        margin: 0;
        font-size: 0.82rem;
        color: #cbd5ce;
      }
      .forecast {
        border: 1px solid rgba(90, 150, 165, 0.35);
        border-radius: 10px;
        padding: 10px 8px;
        background: rgba(20, 30, 32, 0.5);
      }
      .forecast.heart {
        border-color: rgba(224, 192, 136, 0.6);
        background: rgba(38, 30, 16, 0.5);
      }
      .forecast-title {
        margin: 0 0 8px;
        font-size: 0.85rem;
        font-weight: 600;
        color: #8fd0dd;
      }
      .heart-tag {
        color: #e0c088;
      }
      /* Single gacha-style odds table: each swing's possible results, cave-in included. */
      .odds-list {
        list-style: none;
        margin: 0;
        padding: 0;
        display: flex;
        flex-direction: column;
        gap: 4px;
      }
      .odds-row {
        display: grid;
        grid-template-columns: 1.3rem 1fr auto;
        align-items: center;
        gap: 8px;
        padding: 4px 6px;
        border-radius: 6px;
        background: rgba(255, 255, 255, 0.03);
        font-size: 0.82rem;
        color: #d3ddd6;
        text-align: left;
      }
      .odds-icon {
        text-align: center;
      }
      .odds-val {
        font-weight: 700;
        color: #b6ffbf;
        font-variant-numeric: tabular-nums;
      }
      .odds-row.risk {
        background: rgba(120, 46, 30, 0.22);
        color: #f0c3b2;
      }
      .odds-row.risk .odds-val {
        color: #ef8f6d;
      }
      .odds-row.muted {
        color: #6f7d72;
        font-style: italic;
      }
      .odds-row.muted .odds-val {
        color: #6f7d72;
      }
      .vein-hint {
        margin: 0;
        font-size: 0.78rem;
        color: #8a978a;
      }
      .vein-hint.goal {
        color: #c9b07a;
      }
      .vein-hint.goal strong {
        color: #e0c088;
      }
      .vein-hint.shared {
        color: #7f8c84;
        font-size: 0.72rem;
      }
      .vein-hint.out {
        color: #d08a6f;
      }
      .close-btn {
        margin-top: 4px;
      }
    `,
  ],
})
export class CrystalVeinModalComponent implements OnChanges {
  @Input() depth = 0;
  @Input() strikesLeft = 0;
  @Input() busy = false;
  @Input() log: string | null = null;
  /** Gemstones banked from strikes so far this visit (parent-owned). */
  @Input() earnedThisVisit = 0;
  /** Region biome wash painted behind the card (from the board tab). */
  @Input() washBg: string | null = null;
  @Output() strike = new EventEmitter<void>();
  @Output() closed = new EventEmitter<void>();

  @ViewChild('earnedEl') private earnedRef?: ElementRef<HTMLElement>;
  @ViewChild('shaftEl') private shaftRef?: ElementRef<HTMLElement>;

  protected readonly MAX = VEIN_MAX_DEPTH;
  protected readonly levels = Array.from({ length: VEIN_MAX_DEPTH }, (_, i) => i + 1);
  protected readonly HEART_ICHOR = VEIN_HEARTSTONE_ICHOR;
  protected readonly CONSUMABLE_MIN = VEIN_ITEM_CONSUMABLE_BAND.min;

  /** The level this next swing enters (shared depth + 1). */
  protected get level(): number {
    return this.depth + 1;
  }

  /** This swing pries the Heartstone (reaches VEIN_MAX_DEPTH). */
  protected get isHeartstoneNext(): boolean {
    return this.level >= this.MAX;
  }

  /** A swing is available (has strikes, not mid-request). */
  protected get canStrike(): boolean {
    return this.strikesLeft > 0 && !this.busy;
  }

  private get gemPct(): number {
    return Math.round(Math.min(1, VEIN_ICHOR_BASE + this.level * VEIN_ICHOR_PER_LEVEL) * 100);
  }

  private get riskPct(): number {
    return Math.round(this.level * VEIN_CAVE_IN_PCT_PER_LEVEL * 100);
  }

  private get caveDmg(): number {
    return this.level * VEIN_CAVE_IN_DMG_PER_LEVEL;
  }

  /** Bonus-item odds for this level, or null in the shallow band (no items). */
  private get itemChance(): { pct: number; label: string } | null {
    const l = this.level;
    if (l >= VEIN_ITEM_RARE_BAND.min) {
      return { pct: Math.round(VEIN_ITEM_RARE_BAND.chance * 100), label: 'Rare find' };
    }
    if (l >= VEIN_ITEM_CONSUMABLE_BAND.min && l <= VEIN_ITEM_CONSUMABLE_BAND.max) {
      return { pct: Math.round(VEIN_ITEM_CONSUMABLE_BAND.chance * 100), label: 'Consumable' };
    }
    return null;
  }

  /** The next swing's full result table — every possible pull, cave-in last as
   *  the "bad roll". Rewards read as a Heartstone jackpot at max depth. */
  protected get outcomes(): Outcome[] {
    const rows: Outcome[] = [];
    if (this.isHeartstoneNext) {
      rows.push({ icon: '💠', label: 'Gemstones', value: `+${this.HEART_ICHOR}`, tone: 'gem' });
      rows.push({ icon: '💎', label: 'Rare find', value: 'guaranteed', tone: 'item' });
      rows.push({ icon: '⛏️', label: 'Molting', value: '+1', tone: 'molt' });
    } else {
      rows.push({ icon: '💠', label: 'Gemstone', value: `${this.gemPct}%`, tone: 'gem' });
      const item = this.itemChance;
      if (item) {
        rows.push({ icon: '🎁', label: item.label, value: `${item.pct}%`, tone: 'item' });
      } else {
        rows.push({
          icon: '🎁',
          label: `Finds start at L${this.CONSUMABLE_MIN}`,
          value: '—',
          tone: 'item',
          muted: true,
        });
      }
      rows.push({ icon: '⛏️', label: 'Molting', value: '+1', tone: 'molt' });
    }
    rows.push({
      icon: '⚠️',
      label: `Cave-in · ${this.caveDmg} dmg, visit ends`,
      value: `${this.riskPct}%`,
      tone: 'risk',
    });
    return rows;
  }

  /** Tap-the-vein handler: a quick pick-shake for feel, then emit the swing. */
  protected onStrike(): void {
    if (!this.canStrike) return;
    this.shaftRef?.nativeElement.animate(
      [
        { transform: 'translateX(0) scale(1)' },
        { transform: 'translateX(-4px) scale(1.01)' },
        { transform: 'translateX(4px) scale(1.01)' },
        { transform: 'translateX(0) scale(1)' },
      ],
      { duration: 220, easing: 'ease-in-out' },
    );
    this.strike.emit();
  }

  ngOnChanges(ch: SimpleChanges): void {
    if (
      ch['earnedThisVisit'] &&
      !ch['earnedThisVisit'].firstChange &&
      ch['earnedThisVisit'].currentValue > ch['earnedThisVisit'].previousValue
    ) {
      this.pulseEarned();
    }
  }

  /** Scale + colour flash on the tally each time it climbs — the "Gemstone
   *  gained" cue. */
  private pulseEarned(): void {
    this.earnedRef?.nativeElement.animate(
      [
        { transform: 'scale(1)', color: '#b6ffbf' },
        { transform: 'scale(1.55)', color: '#ffffff' },
        { transform: 'scale(1)', color: '#b6ffbf' },
      ],
      { duration: 420, easing: 'ease-out' },
    );
  }
}
