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
import { VEIN_CAVE_IN_PCT_PER_LEVEL, VEIN_MAX_DEPTH } from '../data/vein-vault';
import { VeinCanvas } from '../engine/vein-canvas';

/** Which scripted animation the 3D wall should play, with a monotonic `seq`
 *  so repeat kinds (two strikes in a row) still retrigger via ngOnChanges. */
export interface VeinEffect {
  kind: 'strike' | 'cave-in' | 'heartstone';
  seq: number;
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
          <strong>{{ strikesLeft }}</strong> strike{{ strikesLeft === 1 ? '' : 's' }} left this
          visit
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
          <p class="vein-odds">
            Next strike — level {{ depth + 1 }}: <strong>+{{ depth + 2 }}</strong> Spores,
            <strong class="risk">{{ riskPct }}%</strong> cave-in
          </p>
          <button class="uc-btn strike-btn" [disabled]="busy" (click)="strike.emit()">
            ⛏️ Strike
          </button>
          <p class="vein-hint">
            A cave-in hurts you and collapses the shaft for everyone. Walking away leaves the
            depth for the next digger.
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
      .vein-odds {
        margin: 0;
        font-size: 0.85rem;
        color: #9aa79a;
      }
      .vein-odds strong {
        color: #8fd0dd;
      }
      .vein-odds .risk {
        color: #d08a6f;
      }
      .strike-btn {
        font-size: 1rem;
      }
      .vein-hint {
        margin: 0;
        font-size: 0.78rem;
        color: #8a978a;
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
  /** Region biome wash painted behind the card (from the board tab). */
  @Input() washBg: string | null = null;
  /** Set by the parent after each strike response to trigger a wall animation. */
  @Input() effect: VeinEffect | null = null;
  @Output() strike = new EventEmitter<void>();
  @Output() closed = new EventEmitter<void>();

  @ViewChild('veinCanvas') private canvasRef?: ElementRef<HTMLCanvasElement>;

  protected readonly MAX = VEIN_MAX_DEPTH;
  protected readonly levels = Array.from({ length: VEIN_MAX_DEPTH }, (_, i) => i + 1);
  protected ready = false;
  protected failed = false;

  private readonly vein = new VeinCanvas();
  private lastSeq = -1;
  private resizeObs?: ResizeObserver;

  protected get riskPct(): number {
    return Math.round((this.depth + 1) * VEIN_CAVE_IN_PCT_PER_LEVEL * 100);
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
    if (ch['effect'] && this.ready && this.effect && this.effect.seq !== this.lastSeq) {
      this.lastSeq = this.effect.seq;
      if (this.effect.kind === 'cave-in') this.vein.playCaveIn();
      else if (this.effect.kind === 'heartstone') this.vein.playHeartstone();
      else this.vein.playStrike();
    }
  }

  ngOnDestroy(): void {
    this.resizeObs?.disconnect();
    this.vein.dispose();
  }
}
