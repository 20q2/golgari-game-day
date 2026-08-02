import {
  Component,
  EventEmitter,
  Input,
  Output,
  ViewChild,
  ElementRef,
  AfterViewInit,
  OnChanges,
  OnDestroy,
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
import { VeinCanvas } from '../engine/vein-canvas';

/** Which scripted animation the 3D wall should play, with a monotonic `seq`
 *  so repeat kinds (two strikes in a row) still retrigger via ngOnChanges. */
export interface VeinEffect {
  kind: 'strike' | 'cave-in' | 'heartstone';
  seq: number;
  /** Materials gained on this strike — drives the particle-burst count. */
  burst?: number;
}

/**
 * The crystal-vein modal: a shared shaft everyone digs deeper. Pure
 * presentation — the parent owns the shared depth and the `strike` action;
 * this component renders the shaft, the next-strike odds, and emits swings.
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

        <div class="vein-stage">
          @if (!failed) {
            <canvas #veinCanvas class="vein-canvas" [class.hidden]="!ready"></canvas>
          }
          @if (failed) {
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
            <div class="cols">
              <div class="col hold">
                <div class="col-head">{{ isHeartstoneNext ? 'If you pry it ✦' : 'If it holds ✓' }}</div>
                <ul>
                  @if (isHeartstoneNext) {
                    <li><strong>+{{ HEART_ICHOR }}</strong> 💠 Gemstones</li>
                    <li><strong>+1</strong> ⛏️ Molting</li>
                    <li>a <strong>guaranteed</strong> rare 💎</li>
                  } @else {
                    <li><strong>{{ gemPct }}%</strong> 💠 Gemstone</li>
                    <li><strong>+1</strong> ⛏️ Molting</li>
                    @if (itemChance) {
                      <li><strong>{{ itemChance.pct }}%</strong> {{ itemChance.label }}</li>
                    } @else {
                      <li class="muted">finds start at L{{ CONSUMABLE_MIN }}</li>
                    }
                  }
                </ul>
              </div>
              <div class="col cave">
                <div class="col-head">If it caves ✗</div>
                <ul>
                  <li><strong class="risk">{{ riskPct }}%</strong> chance</li>
                  <li><strong class="risk">{{ caveDmg }}</strong> damage</li>
                  <li>your visit ends</li>
                  <li class="muted">non-fatal · shaft holds</li>
                </ul>
              </div>
            </div>
          </div>

          <button class="uc-btn strike-btn" [disabled]="busy" (click)="strike.emit()">
            ⛏️ Strike
          </button>

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
      .vein-stage {
        position: relative;
        width: 100%;
        height: 180px;
        margin: 2px auto;
      }
      .vein-canvas {
        width: 100%;
        height: 100%;
        display: block;
        border-radius: 10px;
      }
      .vein-canvas.hidden {
        visibility: hidden;
      }
      .shaft {
        display: flex;
        flex-direction: column-reverse;
        gap: 3px;
        margin: 2px auto;
        width: 64px;
      }
      .rung {
        height: 10px;
        border-radius: 3px;
        background: #23282a;
        box-shadow: inset 0 2px 3px rgba(0, 0, 0, 0.6);
      }
      .rung.dug {
        background: linear-gradient(90deg, #2f6f7d 0%, #52a8ba 100%);
        box-shadow: inset 0 1px 2px rgba(255, 255, 255, 0.25);
      }
      .rung.next {
        outline: 1px dashed rgba(143, 208, 221, 0.7);
      }
      .rung.heart {
        border: 1px solid rgba(224, 192, 136, 0.8);
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
      .cols {
        display: flex;
        gap: 8px;
      }
      .col {
        flex: 1;
        text-align: left;
      }
      .col-head {
        font-size: 0.7rem;
        text-transform: uppercase;
        letter-spacing: 0.04em;
        margin-bottom: 5px;
        padding-bottom: 3px;
        border-bottom: 1px solid rgba(255, 255, 255, 0.08);
      }
      .col.hold .col-head {
        color: #b6ffbf;
      }
      .col.cave .col-head {
        color: #d08a6f;
      }
      .col ul {
        list-style: none;
        margin: 0;
        padding: 0;
        display: flex;
        flex-direction: column;
        gap: 3px;
      }
      .col li {
        font-size: 0.8rem;
        color: #cbd5ce;
      }
      .col li strong {
        color: #e7f0ea;
      }
      .col.hold li strong {
        color: #b6ffbf;
      }
      .col li .risk {
        color: #e6926f;
      }
      .col li .bonus {
        color: #e0c088;
        font-size: 0.72rem;
      }
      .col li.muted {
        color: #6f7d72;
        font-style: italic;
        font-size: 0.74rem;
      }
      .strike-btn {
        font-size: 1rem;
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
export class CrystalVeinModalComponent implements AfterViewInit, OnChanges, OnDestroy {
  @Input() depth = 0;
  @Input() strikesLeft = 0;
  @Input() busy = false;
  @Input() log: string | null = null;
  /** Gemstones banked from strikes so far this visit (parent-owned). */
  @Input() earnedThisVisit = 0;
  /** Region biome wash painted behind the card (from the board tab). */
  @Input() washBg: string | null = null;
  /** Set by the parent after each strike response to trigger a wall animation. */
  @Input() effect: VeinEffect | null = null;
  @Output() strike = new EventEmitter<void>();
  @Output() closed = new EventEmitter<void>();

  @ViewChild('veinCanvas') private canvasRef?: ElementRef<HTMLCanvasElement>;
  @ViewChild('earnedEl') private earnedRef?: ElementRef<HTMLElement>;

  protected readonly MAX = VEIN_MAX_DEPTH;
  protected readonly levels = Array.from({ length: VEIN_MAX_DEPTH }, (_, i) => i + 1);
  protected readonly HEART_ICHOR = VEIN_HEARTSTONE_ICHOR;
  protected readonly CONSUMABLE_MIN = VEIN_ITEM_CONSUMABLE_BAND.min;
  protected ready = false;
  protected failed = false;

  private readonly vein = new VeinCanvas();
  private lastSeq = -1;
  private resizeObs?: ResizeObserver;

  /** The level this next swing enters (shared depth + 1). */
  protected get level(): number {
    return this.depth + 1;
  }

  /** Gemstone (Ichor) drop chance %, level-scaling and capped at 100. */
  protected get gemPct(): number {
    return Math.round(Math.min(1, VEIN_ICHOR_BASE + this.level * VEIN_ICHOR_PER_LEVEL) * 100);
  }

  /** Cave-in chance % at this level. */
  protected get riskPct(): number {
    return Math.round(this.level * VEIN_CAVE_IN_PCT_PER_LEVEL * 100);
  }

  /** Rockfall damage if this strike caves in. */
  protected get caveDmg(): number {
    return this.level * VEIN_CAVE_IN_DMG_PER_LEVEL;
  }

  /** This swing pries the Heartstone (reaches VEIN_MAX_DEPTH). */
  protected get isHeartstoneNext(): boolean {
    return this.level >= this.MAX;
  }

  /** Bonus-item odds for this level, or null in the shallow band (no items). */
  protected get itemChance(): { pct: number; label: string } | null {
    const l = this.level;
    if (l >= VEIN_ITEM_RARE_BAND.min) {
      return { pct: Math.round(VEIN_ITEM_RARE_BAND.chance * 100), label: 'a rare find' };
    }
    if (l >= VEIN_ITEM_CONSUMABLE_BAND.min && l <= VEIN_ITEM_CONSUMABLE_BAND.max) {
      return { pct: Math.round(VEIN_ITEM_CONSUMABLE_BAND.chance * 100), label: 'a consumable' };
    }
    return null;
  }

  async ngAfterViewInit(): Promise<void> {
    const el = this.canvasRef?.nativeElement;
    if (!el) {
      this.failed = true;
      return;
    }
    const ok = await this.vein.mount(el);
    if (!ok) {
      this.failed = true;
      return;
    }
    this.ready = true;
    this.vein.setDepth(this.depth, this.MAX);
    this.resizeObs = new ResizeObserver(() => this.vein.resize());
    this.resizeObs.observe(el);
  }

  ngOnChanges(ch: SimpleChanges): void {
    if (ch['depth'] && this.ready) this.vein.setDepth(this.depth, this.MAX);
    if (
      ch['earnedThisVisit'] &&
      !ch['earnedThisVisit'].firstChange &&
      ch['earnedThisVisit'].currentValue > ch['earnedThisVisit'].previousValue
    ) {
      this.pulseEarned();
    }
    if (ch['effect'] && this.ready && this.effect && this.effect.seq !== this.lastSeq) {
      this.lastSeq = this.effect.seq;
      if (this.effect.kind === 'cave-in') this.vein.playCaveIn();
      else if (this.effect.kind === 'heartstone') this.vein.playHeartstone(this.effect.burst);
      else this.vein.playStrike(this.effect.burst);
    }
  }

  /** Scale + colour flash on the tally each time it climbs — the universal
   *  "Gemstone gained" cue that also covers the no-WebGL fallback. */
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

  ngOnDestroy(): void {
    this.resizeObs?.disconnect();
    this.vein.dispose();
  }
}
