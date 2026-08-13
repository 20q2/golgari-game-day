import {
  ChangeDetectionStrategy,
  Component,
  EventEmitter,
  Input,
  Output,
} from '@angular/core';
import { MatIconModule } from '@angular/material/icon';

/** Dial primary-action mode. `blink` and `pick` open the face ring; `roll` rolls. */
export type DialMode = 'roll' | 'blink' | 'pick';

/**
 * One satellite button on the arc. `slot` is a FIXED position — an unavailable
 * action leaves its slot empty rather than letting the others reflow, so icon
 * positions never move and muscle memory holds.
 */
export interface DialSatellite {
  key: string;
  /** 0 = 180deg (left of the dial) … 3 = 270deg (directly above it). */
  slot: 0 | 1 | 2 | 3;
  /** Tooltip and aria-label. */
  label: string;
  /** Material icon ligature. */
  icon?: string;
  /** Registered `uc-*` svgIcon name (see data/icons.ts). */
  svgIcon?: string;
  /** Sprite image URL — used by the pet slot. */
  spriteUrl?: string;
  /** Small corner badge, e.g. a bag count. */
  badge?: string | null;
  /** `ctx` tints the slot amber for current-space actions. */
  tone?: 'ctx';
  disabled?: boolean;
  /** Gold pulse, e.g. a pet ability that is ready. */
  ready?: boolean;
}

/**
 * The dial centre's offset from the wrapper's top-left corner.
 *
 * The wrapper is 150x150 and the dial is drawn at this offset. Both numbers are
 * ALSO hardcoded in the SCSS below (`.dial-box` width/height, `.dial` left/top)
 * because Angular's `styles` array is a plain string and cannot interpolate a TS
 * constant. Keep the two in sync.
 */
const CENTRE = 104;
/** Satellite ring: radius, and the fixed angle of each slot in degrees. */
const SAT_R = 66;
const SLOT_ANGLES = [180, 210, 240, 270];
/** Face ring: radius, and the angular span the faces spread across. */
const FACE_R = 58;
const FACE_FROM = 150;
const FACE_TO = 300;
/** Gauge geometry in the 100x100 SVG viewBox. */
const GAUGE_R = 42;
const RESTED_R = 48;
const GAUGE_CIRC = 2 * Math.PI * GAUGE_R;
const RESTED_CIRC = 2 * Math.PI * RESTED_R;

/**
 * Radial turn control for the board tab — the `dial` HUD skin's replacement for
 * the routine half of the action band. Purely presentational: every input is
 * supplied by BoardTabComponent and every tap is emitted straight back out. No
 * store access, no API calls, no game rules.
 *
 * The wrapper is `pointer-events: none` with `auto` on the buttons, so the board
 * canvas still pans through the gaps in the arc. Buttons additionally never
 * start a pan — board-canvas.ts excludes them.
 */
@Component({
  selector: 'app-uc-turn-dial',
  standalone: true,
  changeDetection: ChangeDetectionStrategy.OnPush,
  imports: [MatIconModule],
  template: `
    <div class="dial-box">
      <!-- Transient notes (first-turn coach nudge, Blink recharge) stack above. -->
      @if (notes.length) {
        <div class="dial-notes">
          @for (note of notes; track note) {
            <span class="dial-note">{{ note }}</span>
          }
        </div>
      }

      <!-- Face ring: Blink (production) and dev Pick choose the die value. -->
      @if (faceRingOpen) {
        @for (f of faces(); track f.value) {
          <button
            type="button"
            class="dial-face"
            [class.random]="f.value === 0"
            [style.left.px]="f.left"
            [style.top.px]="f.top"
            [disabled]="disabled"
            [attr.aria-label]="f.value === 0 ? 'Roll at random' : 'Move ' + f.value"
            [title]="f.value === 0 ? 'Roll at random — keeps Blink ready' : 'Move ' + f.value"
            (click)="pickFace.emit(f.value)"
          >
            @if (f.value === 0) {
              <mat-icon class="mi">casino</mat-icon>
            } @else {
              {{ f.value }}
            }
          </button>
        }
      }

      <!-- Satellite arc. Hidden while the face ring is up: the two rings share
           angles and sit only 8px apart radially (66 vs 58), so they would
           overlap and steal each other's taps. -->
      @if (!faceRingOpen) {
        @for (s of satellites; track s.key) {
          <button
            type="button"
            class="dial-sat"
            [class.ctx]="s.tone === 'ctx'"
            [class.ready]="!!s.ready"
            [style.left.px]="slotPos(s.slot).left"
            [style.top.px]="slotPos(s.slot).top"
            [disabled]="!!s.disabled"
            [attr.aria-label]="s.label"
            [title]="s.label"
            (click)="act.emit(s.key)"
          >
            @if (s.spriteUrl) {
              <img class="dial-sat-sprite" [src]="s.spriteUrl" alt="" />
            } @else if (s.svgIcon) {
              <mat-icon class="mi" [svgIcon]="s.svgIcon"></mat-icon>
            } @else if (s.icon) {
              <mat-icon class="mi">{{ s.icon }}</mat-icon>
            }
            @if (s.badge) {
              <span class="dial-sat-badge">{{ s.badge }}</span>
            }
          </button>
        }
      }

      <!-- The dial itself -->
      <button
        type="button"
        class="dial"
        [class.dimmed]="dimmed"
        [disabled]="disabled || dimmed"
        [attr.aria-label]="ariaLabel()"
        [title]="ariaLabel()"
        (click)="primary.emit()"
      >
        <svg class="dial-gauge" viewBox="0 0 100 100" aria-hidden="true">
          <circle class="gauge-track" cx="50" cy="50" [attr.r]="gaugeR" />
          <circle
            class="gauge-arc"
            cx="50"
            cy="50"
            [attr.r]="gaugeR"
            [style.stroke-dasharray]="gaugeDash()"
            transform="rotate(-90 50 50)"
          />
          @if (restedFrac > 0) {
            <circle
              class="gauge-rested"
              cx="50"
              cy="50"
              [attr.r]="restedR"
              [style.stroke-dasharray]="restedDash()"
              transform="rotate(-90 50 50)"
            />
          }
        </svg>
        <span class="dial-inner">
          @if (mode === 'roll') {
            <img class="dial-die" src="undercity/icons/die.png" alt="" />
          } @else if (mode === 'blink') {
            <mat-icon class="mi dial-mode-icon">bolt</mat-icon>
          } @else {
            <mat-icon class="mi dial-mode-icon">casino</mat-icon>
          }
          <b class="dial-count" [class.rolled]="rolledValue !== null">{{ countLabel() }}</b>
          @if (countdown) {
            <span class="dial-countdown">{{ countdown }}</span>
          }
        </span>
      </button>
    </div>
  `,
  styles: [
    `
      :host {
        position: absolute;
        right: 6px;
        bottom: 6px;
        z-index: 7;
        // The board canvas still pans through the arc's gaps; only the buttons
        // themselves take taps.
        pointer-events: none;
      }

      .dial-box {
        position: relative;
        // 150x150 — keep in sync with the CENTRE doc comment in the .ts above.
        width: 150px;
        height: 150px;
      }

      button {
        pointer-events: auto;
      }

      .mi {
        font-size: 1.15rem;
        height: 1.15rem;
        width: 1.15rem;
      }

      .dial {
        position: absolute;
        // left/top = the CENTRE constant (104). Keep in sync.
        left: 104px;
        top: 104px;
        transform: translate(-50%, -50%);
        width: 72px;
        height: 72px;
        padding: 0;
        border-radius: 50%;
        background: radial-gradient(circle at 35% 30%, #5d8f63, #2e4a33);
        border: 2px solid rgba(143, 214, 162, 0.9);
        box-shadow:
          0 0 14px rgba(103, 194, 128, 0.4),
          inset 0 2px 0 rgba(255, 255, 255, 0.14);
        color: #eafff0;
        cursor: pointer;
        transition:
          opacity 0.14s ease,
          transform 0.1s ease;

        &:active:not(:disabled) {
          transform: translate(-50%, -50%) scale(0.95);
        }

        &:disabled {
          opacity: 0.45;
          cursor: default;
        }

        &.dimmed {
          opacity: 0.32;
        }
      }

      .dial-gauge {
        position: absolute;
        inset: 0;
        width: 100%;
        height: 100%;
        pointer-events: none;
      }

      .gauge-track {
        fill: none;
        stroke: rgba(0, 0, 0, 0.32);
        stroke-width: 6;
      }

      .gauge-arc {
        fill: none;
        stroke: #f2a900;
        stroke-width: 6;
        stroke-linecap: round;
        transition: stroke-dasharray 0.3s ease;
      }

      .gauge-rested {
        fill: none;
        stroke: #7fb2ff;
        stroke-width: 2;
        stroke-linecap: round;
      }

      .dial-inner {
        position: relative;
        display: flex;
        flex-direction: column;
        align-items: center;
        justify-content: center;
        gap: 1px;
        line-height: 1;
      }

      .dial-die {
        width: 13px;
        height: 13px;
        image-rendering: pixelated;
      }

      .dial-mode-icon {
        font-size: 0.95rem;
        height: 0.95rem;
        width: 0.95rem;
        color: #f2c95c;
      }

      .dial-count {
        font-size: 1.15rem;
        font-weight: 800;
        font-variant-numeric: tabular-nums;

        &.rolled {
          color: #f2c95c;
        }
      }

      .dial-countdown {
        font-size: 0.42rem;
        letter-spacing: 0.3px;
        opacity: 0.8;
      }

      .dial-sat {
        position: absolute;
        transform: translate(-50%, -50%);
        width: 30px;
        height: 30px;
        padding: 0;
        border-radius: 50%;
        background: rgba(26, 24, 21, 0.9);
        border: 1px solid rgba(74, 124, 89, 0.75);
        color: #b7e4c7;
        cursor: pointer;
        backdrop-filter: blur(2px);
        display: inline-flex;
        align-items: center;
        justify-content: center;

        &:active:not(:disabled) {
          transform: translate(-50%, -50%) scale(0.92);
        }

        &:disabled {
          opacity: 0.4;
          cursor: default;
        }

        &.ctx {
          border-color: rgba(242, 169, 0, 0.8);
          color: #f2c95c;
        }

        &.ready {
          border-color: #f2a900;
          box-shadow: 0 0 8px rgba(242, 169, 0, 0.55);
        }
      }

      .dial-sat-sprite {
        width: 22px;
        height: 22px;
        image-rendering: pixelated;
      }

      .dial-sat-badge {
        position: absolute;
        top: -3px;
        right: -3px;
        min-width: 15px;
        height: 15px;
        padding: 0 3px;
        border-radius: 8px;
        background: #4a7c59;
        color: #eafff0;
        font-size: 0.6rem;
        font-weight: 700;
        line-height: 15px;
        font-variant-numeric: tabular-nums;
      }

      .dial-face {
        position: absolute;
        transform: translate(-50%, -50%);
        width: 24px;
        height: 24px;
        padding: 0;
        border-radius: 50%;
        background: #2a3324;
        border: 1px solid rgba(143, 214, 162, 0.7);
        color: #eafff0;
        font-size: 0.72rem;
        font-weight: 700;
        cursor: pointer;
        display: inline-flex;
        align-items: center;
        justify-content: center;
        animation: dial-face-in 0.14s ease;

        .mi {
          font-size: 0.8rem;
          height: 0.8rem;
          width: 0.8rem;
        }

        &.random {
          border-color: rgba(242, 169, 0, 0.8);
          color: #f2c95c;
        }
      }

      .dial-notes {
        position: absolute;
        right: 0;
        bottom: 100%;
        margin-bottom: 4px;
        display: flex;
        flex-direction: column;
        align-items: flex-end;
        gap: 3px;
      }

      .dial-note {
        pointer-events: none;
        max-width: 190px;
        padding: 3px 7px;
        border-radius: 10px;
        background: rgba(21, 23, 15, 0.92);
        border: 1px solid rgba(103, 194, 128, 0.45);
        color: #b7e4c7;
        font-size: 0.62rem;
        line-height: 1.25;
        text-align: right;
      }

      @keyframes dial-face-in {
        from {
          opacity: 0;
          transform: translate(-50%, -50%) scale(0.6);
        }
        to {
          opacity: 1;
          transform: translate(-50%, -50%) scale(1);
        }
      }
    `,
  ],
})
export class UcTurnDialComponent {
  /** Which primary action the dial currently offers. */
  @Input() mode: DialMode = 'roll';
  /** Rolls banked. Ignored for display when `infinite` is true. */
  @Input() count = 0;
  /** Server DEBUG: show an infinity glyph instead of the count. */
  @Input() infinite = false;
  /** Roll-bank gauge fill, 0..1 (`rollsBanked / ROLL_CAP`). */
  @Input() gaugeFrac = 0;
  /** Rested-roll outer arc fill, 0..1. */
  @Input() restedFrac = 0;
  /** Short countdown to the next timed roll, e.g. "4m". Null hides the line. */
  @Input() countdown: string | null = null;
  /** The value just rolled — replaces the count while a move is resolving. */
  @Input() rolledValue: number | null = null;
  /** Hard-blocked (out of rolls, pending pickups). Deliberately no reason text. */
  @Input() disabled = false;
  /** An exclusive decision is pending in the band — visible but inert. */
  @Input() dimmed = false;
  /** Face ring visibility (Blink / dev Pick). */
  @Input() faceRingOpen = false;
  /** Include the 7th "random" slot — Blink only; dev Pick has no random. */
  @Input() faceRandom = false;
  /** Arc satellites. Pass a NEW array when it changes — this component is
   *  OnPush, so an in-place mutation (push/splice) will not repaint. */
  @Input() satellites: DialSatellite[] = [];
  /** Transient one-line notes stacked above the dial. Pass a NEW array when it
   *  changes — same OnPush caveat as `satellites`. */
  @Input() notes: string[] = [];

  /** Dial tapped. */
  @Output() readonly primary = new EventEmitter<void>();
  /** A die face chosen from the ring. 0 means the random slot. */
  @Output() readonly pickFace = new EventEmitter<number>();
  /** A satellite tapped, carrying its `key`. */
  @Output() readonly act = new EventEmitter<string>();

  protected readonly gaugeR = GAUGE_R;
  protected readonly restedR = RESTED_R;

  /** Fixed slot position, in px from the wrapper's top-left. */
  protected slotPos(slot: 0 | 1 | 2 | 3): { left: number; top: number } {
    return this.polar(SAT_R, SLOT_ANGLES[slot]);
  }

  /** Face ring positions. Value 0 is the random slot, rendered last. */
  protected faces(): { value: number; left: number; top: number }[] {
    const values = [1, 2, 3, 4, 5, 6];
    if (this.faceRandom) values.push(0);
    const step = (FACE_TO - FACE_FROM) / (values.length - 1);
    return values.map((value, i) => ({ value, ...this.polar(FACE_R, FACE_FROM + step * i) }));
  }

  protected countLabel(): string {
    if (this.rolledValue !== null) return String(this.rolledValue);
    return this.infinite ? '∞' : String(this.count);
  }

  protected gaugeDash(): string {
    return `${Math.max(0, Math.min(1, this.gaugeFrac)) * GAUGE_CIRC} ${GAUGE_CIRC}`;
  }

  protected restedDash(): string {
    return `${Math.max(0, Math.min(1, this.restedFrac)) * RESTED_CIRC} ${RESTED_CIRC}`;
  }

  protected ariaLabel(): string {
    if (this.mode === 'blink') return 'Blink — choose your die face';
    if (this.mode === 'pick') return 'Pick your die face';
    const left = this.infinite ? 'unlimited' : `${this.count}`;
    return `Roll (${left} rolls left)`;
  }

  /** Screen-space point on a circle about the dial centre. y grows downward, so
   *  270deg lands directly ABOVE the centre. */
  private polar(r: number, deg: number): { left: number; top: number } {
    const rad = (deg * Math.PI) / 180;
    return { left: CENTRE + r * Math.cos(rad), top: CENTRE + r * Math.sin(rad) };
  }
}
