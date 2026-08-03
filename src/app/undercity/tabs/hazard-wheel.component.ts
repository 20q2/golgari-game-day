import {
  AfterViewInit,
  Component,
  EventEmitter,
  Input,
  Output,
  signal,
} from '@angular/core';
import { CommonModule } from '@angular/common';
import { MatIconModule } from '@angular/material/icon';

/** What the wheel should reveal — built by board-tab.hazardWheelTarget(). */
export interface HazardWheelTarget {
  mode: 'surface' | 'dungeon';
  /** Surface: which generic effect rolled (swamp_gas|vines|spore_cloud|safe). */
  outcome?: string;
  /** Dungeon: the lair boss's art id (undercity/guardians/<id>.png). */
  bossId?: string;
  /** Thick Hide active — render the extra "resist" tease wedges. */
  hasPerk?: boolean;
  /** How the hazard did no harm, if it didn't: 'lucky' (baseline luck fizzle) or
   *  'resist' (Thick Hide turned it aside). Absent ⇒ the hazard landed and the
   *  winning wedge is the effect/boss. */
  avoid?: 'lucky' | 'resist';
}

interface Effect {
  icon: string;
  color: string;
}

/** Surface hazard faces — mirror the three generic outcomes in undercity_db._hazard. */
const EFFECTS: Record<string, Effect> = {
  swamp_gas: { icon: 'air', color: '#8bbf6a' },
  vines: { icon: 'grass', color: '#5a9a5a' },
  spore_cloud: { icon: 'cloud', color: '#9b7fd0' },
};
const EFFECT_KEYS = Object.keys(EFFECTS);

/** The two no-harm faces. "Lucky" (gold sparkle) is the baseline fizzle any
 *  creature can land on; "Resist" (green hide) is Thick Hide's own turn-aside —
 *  same effect, different flavour (see the design in undercity_db._hazard). */
const LUCKY_FACE: Effect = { icon: 'auto_awesome', color: '#ffd76a' };
const RESIST_FACE: Effect = { icon: 'shield', color: '#7fce8f' };
const LUCKY_TEASE_SLOT = 4; // the always-present lucky wedge (a loser tease)
const RESIST_TEASE_SLOTS = [2, 6]; // extra no-harm teases, Thick Hide only

interface Wedge {
  kind: 'boss' | 'effect';
  icon: string;
  color: string;
  pos: string; // place at the wedge's angle, out along the radius
  upright: string; // counter-rotate so the glyph sits upright in the wheel frame
}

const WEDGE_COUNT = 8;
const SYM_RADIUS = 80; // px from hub to symbol center

/**
 * A Wheel-of-Fortune reveal for hazard tiles: it spins several turns, eases to a
 * stop with the winning wedge under the top pointer, flashes, then emits
 * `settled` so the parent opens the hazard card underneath (a cross-fade, like
 * the mystery reel). The server already applied the effect — this is pure juice.
 *
 * The rig is honest-looking but predetermined: the winning symbol always sits in
 * wedge 0 (top), so the wheel always stops ~upright after a whole number of
 * turns. Wedge 0 shows the actual outcome — the rolled effect / lair boss on a
 * hit, or the lucky/resist face when the hazard did no harm. Loser wedges always
 * include one lucky tease, plus a couple of resist teases for Thick Hide.
 */
@Component({
  selector: 'app-undercity-hazard-wheel',
  standalone: true,
  imports: [CommonModule, MatIconModule],
  template: `
    <div
      class="wheel-overlay"
      [class.leaving]="leaving()"
      [style.background-image]="washBg"
      (click)="skip()"
    >
      <div class="wheel-stage" [class.dungeon]="target.mode === 'dungeon'">
        <div class="wheel-title">
          {{ target.mode === 'dungeon' ? '☠ THE LAIR STIRS ☠' : '⚠ HAZARD ⚠' }}
        </div>
        <div class="wheel-frame" [class.landed]="landed()">
          <div class="pointer"></div>
          <div
            class="wheel"
            [style.transform]="'rotate(' + angle() + 'deg)'"
            [style.transitionDuration]="spinMs + 'ms'"
            [style.background]="wheelBg"
            (transitionend)="onStop()"
          >
            @for (w of wedges; track $index) {
              <div class="sym" [style.transform]="w.pos">
                <div class="sym-inner" [style.transform]="w.upright">
                  @if (w.kind === 'boss') {
                    @if (!bossFailed) {
                      <img class="boss" [src]="bossArt" alt="" (error)="bossFailed = true" />
                    } @else {
                      <mat-icon class="boss-fallback">dangerous</mat-icon>
                    }
                  } @else {
                    <mat-icon [style.color]="w.color">{{ w.icon }}</mat-icon>
                  }
                </div>
              </div>
            }
          </div>
          <div class="hub"></div>
        </div>
        <div class="wheel-caption">{{ landed() ? caption() : 'Round and round…' }}</div>
      </div>
    </div>
  `,
  styles: [
    `
      .wheel-overlay {
        position: fixed;
        inset: 0;
        z-index: 1180;
        display: flex;
        align-items: center;
        justify-content: center;
        padding: 16px;
        background: rgba(8, 6, 4, 0.82);
        backdrop-filter: blur(5px);
        animation: fade 0.18s ease;
        transition: opacity 0.34s ease;
      }
      .wheel-overlay.leaving {
        opacity: 0;
        pointer-events: none;
      }
      .wheel-overlay.leaving .wheel-stage {
        transform: scale(0.94);
        transition: transform 0.34s ease;
      }
      @keyframes fade {
        from { opacity: 0; }
        to { opacity: 1; }
      }
      .wheel-stage {
        position: relative;
        display: flex;
        flex-direction: column;
        align-items: center;
        animation: stage-in 0.32s cubic-bezier(0.2, 1.5, 0.4, 1);
      }
      @keyframes stage-in {
        from { opacity: 0; transform: translateY(18px) scale(0.9); }
        to { opacity: 1; transform: none; }
      }
      .wheel-title {
        font-weight: 900;
        letter-spacing: 0.24em;
        text-indent: 0.24em;
        font-size: 0.9rem;
        color: #ffd76a;
        margin-bottom: 14px;
        text-shadow: 0 1px 4px rgba(0, 0, 0, 0.85);
      }
      .dungeon .wheel-title {
        color: #ef7a8a;
      }
      .wheel-frame {
        position: relative;
        width: 236px;
        height: 236px;
      }
      /* Pointer sits at 12 o'clock, biting down into the winning wedge. */
      .pointer {
        position: absolute;
        top: -4px;
        left: 50%;
        transform: translateX(-50%);
        width: 0;
        height: 0;
        border-left: 13px solid transparent;
        border-right: 13px solid transparent;
        border-top: 22px solid #ffd76a;
        z-index: 3;
        filter: drop-shadow(0 2px 3px rgba(0, 0, 0, 0.7));
      }
      .landed .pointer {
        animation: peck 0.4s ease 2;
      }
      @keyframes peck {
        50% { transform: translateX(-50%) translateY(4px); }
      }
      .wheel {
        position: absolute;
        inset: 0;
        border-radius: 50%;
        border: 5px solid rgba(20, 14, 10, 0.9);
        box-shadow:
          0 20px 50px rgba(0, 0, 0, 0.7),
          inset 0 0 0 3px rgba(255, 255, 255, 0.06),
          inset 0 0 26px rgba(0, 0, 0, 0.6);
        transition-property: transform;
        transition-timing-function: cubic-bezier(0.16, 1, 0.3, 1);
        will-change: transform;
      }
      .sym {
        position: absolute;
        left: 50%;
        top: 50%;
        width: 0;
        height: 0;
      }
      .sym-inner {
        position: absolute;
        transform-origin: center;
        display: flex;
        align-items: center;
        justify-content: center;
        translate: -50% -50%;
      }
      .sym-inner mat-icon {
        font-size: 38px;
        width: 38px;
        height: 38px;
        filter: drop-shadow(0 2px 4px rgba(0, 0, 0, 0.7));
      }
      .boss {
        width: 54px;
        height: 54px;
        object-fit: contain;
        /* flatten the guardian art to a dark shadow so each lair's wheel reads
           as its boss without clashing with the wedge colours. */
        filter: brightness(0) drop-shadow(0 2px 3px rgba(0, 0, 0, 0.5));
        opacity: 0.82;
      }
      .boss-fallback {
        font-size: 40px;
        width: 40px;
        height: 40px;
        color: #1c1016;
        opacity: 0.85;
      }
      .hub {
        position: absolute;
        left: 50%;
        top: 50%;
        width: 42px;
        height: 42px;
        transform: translate(-50%, -50%);
        border-radius: 50%;
        background: radial-gradient(circle at 40% 35%, #4a3a2a, #1c130d);
        border: 3px solid #ffd76a;
        box-shadow: 0 3px 8px rgba(0, 0, 0, 0.6);
        z-index: 2;
      }
      .dungeon .hub {
        border-color: #ef7a8a;
      }
      .wheel-caption {
        margin-top: 16px;
        font-size: 0.85rem;
        color: #cdbfae;
        font-style: italic;
        min-height: 1.2em;
        text-align: center;
      }
    `,
  ],
})
export class HazardWheelComponent implements AfterViewInit {
  @Input({ required: true }) target!: HazardWheelTarget;
  /** Region biome wash painted behind the wheel (from the board tab). */
  @Input() washBg: string | null = null;
  @Output() settled = new EventEmitter<void>();

  protected wedges: Wedge[] = [];
  protected readonly angle = signal(0);
  protected readonly leaving = signal(false);
  protected readonly landed = signal(false);
  protected bossFailed = false;
  protected spinMs = 1900;
  protected wheelBg = '';
  private done = false;

  protected get bossArt(): string {
    return `undercity/guardians/${this.target.bossId}.png`;
  }

  protected caption(): string {
    if (this.target.avoid === 'lucky') return 'Lucky! The hazard fizzles out.';
    if (this.target.avoid === 'resist') return 'Turned aside! (Thick Hide)';
    return this.target.mode === 'dungeon' ? 'The lair claims you.' : 'No dodging that.';
  }

  ngAfterViewInit(): void {
    this.wedges = this.buildWedges();
    this.wheelBg = this.buildWheelBg();
    // A whole number of turns keeps wedge 0 (the winner) under the pointer and
    // ~upright; a few degrees of jitter make the stop feel physical.
    const turns = 3 + Math.floor(Math.random() * 3); // 3–5
    const jitter = (Math.random() * 2 - 1) * 8; // ±8° stays well inside the 45° wedge
    this.spinMs = 1700 + Math.round(Math.random() * 500);

    // Paint at 0°, then trigger the eased spin on the next frame.
    requestAnimationFrame(() => {
      requestAnimationFrame(() => this.angle.set(turns * 360 + jitter));
    });
  }

  /** Wheel 0 is the winner (top). Each wedge is placed at its angle and its glyph
   *  counter-rotated so it reads upright when the wheel rests. */
  private buildWedges(): Wedge[] {
    const isDungeon = this.target.mode === 'dungeon';
    const avoid = this.target.avoid;
    const hasPerk = this.target.hasPerk === true;
    const outcome = EFFECTS[this.target.outcome ?? ''] ? this.target.outcome! : 'spore_cloud';
    const face = (e: Effect, base: Pick<Wedge, 'pos' | 'upright'>): Wedge => ({
      kind: 'effect',
      icon: e.icon,
      color: e.color,
      ...base,
    });
    const hazardWedge = (base: Pick<Wedge, 'pos' | 'upright'>, i: number): Wedge =>
      isDungeon
        ? { kind: 'boss', icon: '', color: '', ...base }
        : face(EFFECTS[EFFECT_KEYS[i % EFFECT_KEYS.length]], base);
    return Array.from({ length: WEDGE_COUNT }, (_, i) => {
      const deg = i * (360 / WEDGE_COUNT);
      const base = {
        pos: `rotate(${deg}deg) translateY(-${SYM_RADIUS}px)`,
        upright: `rotate(${-deg}deg)`,
      };
      // Winner (0) shows the actual outcome: the no-harm face on an avoid, else
      // the rolled effect (surface) / the lair boss (dungeon).
      if (i === 0) {
        if (avoid === 'lucky') return face(LUCKY_FACE, base);
        if (avoid === 'resist') return face(RESIST_FACE, base);
        return isDungeon ? hazardWedge(base, i) : face(EFFECTS[outcome], base);
      }
      // Losers: one guaranteed lucky tease, resist teases for Thick Hide, and the
      // hazard (boss silhouette / a generic effect face) everywhere else.
      if (i === LUCKY_TEASE_SLOT) return face(LUCKY_FACE, base);
      if (hasPerk && RESIST_TEASE_SLOTS.includes(i)) return face(RESIST_FACE, base);
      return hazardWedge(base, i);
    });
  }

  /** Alternating wedge shades via a conic gradient, wedge 0 centred at the top. */
  private buildWheelBg(): string {
    const [a, b] =
      this.target.mode === 'dungeon' ? ['#3a2030', '#281624'] : ['#3a4657', '#2c3542'];
    const step = 360 / WEDGE_COUNT;
    const stops = Array.from({ length: WEDGE_COUNT }, (_, i) => {
      const c = i % 2 === 0 ? a : b;
      return `${c} ${i * step}deg ${(i + 1) * step}deg`;
    }).join(', ');
    return `conic-gradient(from ${-step / 2}deg, ${stops})`;
  }

  protected onStop(): void {
    this.finish();
  }

  /** Tapping the overlay skips straight to the reveal. */
  protected skip(): void {
    this.finish();
  }

  private finish(): void {
    if (this.done) return;
    this.done = true;
    this.landed.set(true);
    // Flash the win, then fade out AND open the card underneath at once.
    setTimeout(() => {
      this.leaving.set(true);
      this.settled.emit();
    }, 420);
  }
}
