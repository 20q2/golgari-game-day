import {
  AfterViewInit,
  Component,
  EventEmitter,
  Input,
  OnDestroy,
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
  /** Dungeon: the hazard's display name (DUNGEONS[biome].hazardName), e.g.
   *  'Webbing' — the word printed on that lair's hazard wedges. */
  hazardLabel?: string;
  /** Thick Hide active — render the extra "resist" wedges. */
  hasPerk?: boolean;
  /** How the hazard did no harm, if it didn't: 'lucky' (baseline luck fizzle) or
   *  'resist' (Thick Hide turned it aside). Absent ⇒ the hazard landed and the
   *  winning wedge is the effect/boss. */
  avoid?: 'lucky' | 'resist';
}

/** One kind of face the wheel can show. `wedge` is the slice's background; `color`
 *  paints the glyph and its word. */
interface Face {
  key: string;
  kind: 'boss' | 'effect';
  icon: string;
  label: string;
  color: string;
  wedge: string;
}

/** Surface hazard faces — mirror the three generic outcomes in undercity_db._hazard. */
const SURFACE_FACES: Record<string, Face> = {
  swamp_gas: {
    key: 'swamp_gas', kind: 'effect', icon: 'air', label: 'Swamp Gas',
    color: '#8bbf6a', wedge: '#2f4029',
  },
  vines: {
    key: 'vines', kind: 'effect', icon: 'grass', label: 'Vines',
    color: '#7fbf5f', wedge: '#243a1e',
  },
  spore_cloud: {
    key: 'spore_cloud', kind: 'effect', icon: 'cloud', label: 'Spore Cloud',
    color: '#9b7fd0', wedge: '#372b4d',
  },
};

/** The two no-harm faces. "Lucky" (gold sparkle) is the baseline fizzle any
 *  creature can land on; "Resist" (green hide) is Thick Hide's own turn-aside —
 *  same effect, different flavour (see the design in undercity_db._hazard). */
const LUCKY_FACE: Face = {
  key: 'lucky', kind: 'effect', icon: 'auto_awesome', label: 'Lucky',
  color: '#ffd76a', wedge: '#4a3a1a',
};
const RESIST_FACE: Face = {
  key: 'resist', kind: 'effect', icon: 'shield', label: 'Resist',
  color: '#7fce8f', wedge: '#1f4230',
};

interface Wedge extends Face {
  /** Place the glyph at the wedge's angle, out along the radius. */
  iconPos: string;
  /** Same, further out, for the word. */
  labelPos: string;
  /** Counter-rotate so glyph and word sit upright in the wheel frame. */
  upright: string;
}

const WEDGE_COUNT = 8;
const STEP = 360 / WEDGE_COUNT;
const ICON_RADIUS = 56; // px from hub to glyph centre
// Far enough out to clear the glyph, close enough that a 70px word box still
// fits inside both the rim (frame is 252px ⇒ radius 126) and its own 72px arc.
const LABEL_RADIUS = 92;

/**
 * A Wheel-of-Fortune reveal for hazard tiles: it spins several turns, eases to a
 * stop with the winning wedge under the top pointer, flashes, then emits
 * `settled` so the parent opens the hazard card underneath (a cross-fade, like
 * the mystery reel). The server already applied the effect — this is the reveal.
 *
 * The spin is honest. Every face the wheel can show is laid out around it once or
 * twice, each wedge captioned with the word for what it does ("Lucky", "Swamp
 * Gas", "Webbing"). The component then finds the wedges matching the outcome the
 * server actually rolled, picks one of them at random, and spins so THAT wedge
 * stops under the pointer. So the wheel lands somewhere different each time, and
 * where it lands is genuinely what happened to you.
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
            <div class="spokes" aria-hidden="true"></div>
            @for (w of wedges; track $index; let i = $index) {
              <div class="slice" [class.win]="landed() && i === winner">
                <div class="sym" [style.transform]="w.iconPos">
                  <div class="sym-inner" [style.transform]="w.upright">
                    @if (w.kind === 'boss' && !bossFailed) {
                      <img class="boss" [src]="bossArt" alt="" (error)="bossFailed = true" />
                    } @else {
                      <mat-icon [style.color]="w.color">{{ w.icon }}</mat-icon>
                    }
                  </div>
                </div>
                <div class="sym" [style.transform]="w.labelPos">
                  <div class="sym-inner word" [style.transform]="w.upright">
                    <span [style.color]="w.color">{{ w.label }}</span>
                  </div>
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
        width: 252px;
        height: 252px;
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
      /* Hairline dividers so neighbouring wedges of the same face still read as
         separate slices (a dungeon wheel is mostly one hazard face). The angles
         below are WEDGE_COUNT = 8 spelled out: 45deg per slice, offset -22.5deg
         so slice 0 is centred at 12 o'clock like the conic gradient behind it.
         Change WEDGE_COUNT and these two numbers move with it. */
      .spokes {
        position: absolute;
        inset: 0;
        border-radius: 50%;
        background: repeating-conic-gradient(
          from -22.5deg,
          rgba(0, 0, 0, 0.55) 0deg 1.1deg,
          transparent 1.1deg 45deg
        );
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
        font-size: 32px;
        width: 32px;
        height: 32px;
        filter: drop-shadow(0 2px 4px rgba(0, 0, 0, 0.7));
      }
      .word {
        width: 70px;
        text-align: center;
        font-size: 8.5px;
        font-weight: 800;
        line-height: 1.15;
        letter-spacing: 0.04em;
        text-transform: uppercase;
        text-shadow: 0 1px 3px rgba(0, 0, 0, 0.9);
      }
      /* The wedge the pointer bit into: brighten it and lift it off the rest. */
      .slice.win .sym-inner mat-icon,
      .slice.win .boss {
        animation: win-pop 0.45s ease both;
      }
      .slice.win .word {
        animation: win-pop 0.45s ease 0.05s both;
      }
      @keyframes win-pop {
        50% { filter: brightness(1.9) drop-shadow(0 0 10px rgba(255, 231, 160, 0.9)); }
      }
      .boss {
        width: 46px;
        height: 46px;
        object-fit: contain;
        /* flatten the guardian art to a dark shadow so each lair's wheel reads
           as its boss without clashing with the wedge colours. */
        filter: brightness(0) drop-shadow(0 2px 3px rgba(0, 0, 0, 0.5));
        opacity: 0.82;
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

      @media (prefers-reduced-motion: reduce) {
        .wheel {
          transition-duration: 0.4s !important;
        }
        .landed .pointer,
        .slice.win .sym-inner mat-icon,
        .slice.win .boss,
        .slice.win .word {
          animation: none;
        }
      }
    `,
  ],
})
export class HazardWheelComponent implements AfterViewInit, OnDestroy {
  @Input({ required: true }) target!: HazardWheelTarget;
  /** Region biome wash painted behind the wheel (from the board tab). */
  @Input() washBg: string | null = null;
  @Output() settled = new EventEmitter<void>();

  protected wedges: Wedge[] = [];
  /** Index of the wedge the pointer lands on — the outcome the server rolled. */
  protected winner = 0;
  protected readonly angle = signal(0);
  protected readonly leaving = signal(false);
  protected readonly landed = signal(false);
  protected bossFailed = false;
  protected spinMs = 2600;
  protected wheelBg = '';
  private done = false;
  private failsafe: ReturnType<typeof setTimeout> | null = null;
  private flash: ReturnType<typeof setTimeout> | null = null;

  protected get bossArt(): string {
    return `undercity/guardians/${this.target.bossId}.png`;
  }

  protected caption(): string {
    if (this.target.avoid === 'lucky') return 'Lucky! The hazard fizzles out.';
    if (this.target.avoid === 'resist') return 'Turned aside! (Thick Hide)';
    return this.target.mode === 'dungeon' ? 'The lair claims you.' : 'No dodging that.';
  }

  ngAfterViewInit(): void {
    const faces = this.layout();
    this.winner = this.pickWinner(faces);
    this.wedges = faces.map((f, i) => {
      const deg = i * STEP;
      return {
        ...f,
        iconPos: `rotate(${deg}deg) translateY(-${ICON_RADIUS}px)`,
        labelPos: `rotate(${deg}deg) translateY(-${LABEL_RADIUS}px)`,
        upright: `rotate(${-deg}deg)`,
      };
    });
    this.wheelBg = this.buildWheelBg(faces);

    // Bring the winning wedge under the pointer after a few whole turns. The
    // jitter stays well inside the wedge, so the stop reads physical without
    // ever drifting onto a neighbour. Someone who asked for less motion gets the
    // result placed rather than whipped past them — a 4-turn blur compressed
    // into the shortened duration would be the worst of both.
    const calm = this.prefersReducedMotion();
    const turns = calm ? 0 : 4 + Math.floor(Math.random() * 3); // 4–6
    const jitter = calm ? 0 : (Math.random() * 2 - 1) * (STEP * 0.3);
    this.spinMs = calm ? 400 : 2400 + Math.round(Math.random() * 700);

    // Paint at 0°, then trigger the eased spin on the next frame.
    requestAnimationFrame(() => {
      requestAnimationFrame(() =>
        this.angle.set(turns * 360 - this.winner * STEP + jitter),
      );
    });

    // `transitionend` is the normal way this settles, but it is not guaranteed:
    // in the reduced-motion path a winning wedge 0 means the angle never
    // actually changes, and a backgrounded tab can swallow the event outright.
    // Without this the overlay would sit there forever holding up the hazard
    // card underneath it.
    this.failsafe = setTimeout(() => this.finish(), this.spinMs + 600);
  }

  ngOnDestroy(): void {
    this.clearTimers();
  }

  private prefersReducedMotion(): boolean {
    return (
      typeof matchMedia === 'function' &&
      matchMedia('(prefers-reduced-motion: reduce)').matches
    );
  }

  /** The face key the server actually rolled — what the wheel must land on. */
  private winningKey(): string {
    if (this.target.avoid === 'lucky') return 'lucky';
    if (this.target.avoid === 'resist') return 'resist';
    if (this.target.mode === 'dungeon') return 'hazard';
    const rolled = this.target.outcome ?? '';
    if (rolled === 'safe') return 'lucky';
    return SURFACE_FACES[rolled] ? rolled : 'spore_cloud';
  }

  /** The dungeon hazard face: this lair's boss silhouette under its hazard word. */
  private dungeonFace(): Face {
    return {
      key: 'hazard',
      kind: 'boss',
      icon: 'dangerous',
      label: this.target.hazardLabel || 'Hazard',
      color: '#ef7a8a',
      wedge: '#3a2030',
    };
  }

  /** The ring of faces, laid out so no two neighbours repeat where it's possible
   *  and every outcome the wheel can report is present at least once. */
  private layout(): Face[] {
    const perk = this.target.hasPerk === true;
    if (this.target.mode === 'dungeon') {
      const h = this.dungeonFace();
      return perk
        ? [h, LUCKY_FACE, h, RESIST_FACE, h, h, RESIST_FACE, LUCKY_FACE]
        : [h, LUCKY_FACE, h, h, h, LUCKY_FACE, h, h];
    }
    const gas = SURFACE_FACES['swamp_gas'];
    const vines = SURFACE_FACES['vines'];
    const spore = SURFACE_FACES['spore_cloud'];
    return perk
      ? [gas, LUCKY_FACE, vines, RESIST_FACE, spore, LUCKY_FACE, gas, RESIST_FACE]
      : [gas, LUCKY_FACE, vines, spore, gas, LUCKY_FACE, vines, spore];
  }

  /** Choose which of the wedges bearing the true outcome the pointer bites into,
   *  so the same result lands somewhere different each time. Mutates `faces` only
   *  in the impossible case that the outcome has no wedge — the wheel must never
   *  land on a face that isn't what happened. */
  private pickWinner(faces: Face[]): number {
    const key = this.winningKey();
    const matches = faces.reduce<number[]>(
      (acc, f, i) => (f.key === key ? [...acc, i] : acc),
      [],
    );
    if (!matches.length) {
      faces[0] = key === 'resist' ? RESIST_FACE : (SURFACE_FACES[key] ?? LUCKY_FACE);
      return 0;
    }
    return matches[Math.floor(Math.random() * matches.length)];
  }

  /** Paint each slice in its own face colour, wedge 0 centred at the top. */
  private buildWheelBg(faces: Face[]): string {
    const stops = faces
      .map((f, i) => `${f.wedge} ${i * STEP}deg ${(i + 1) * STEP}deg`)
      .join(', ');
    return `conic-gradient(from ${-STEP / 2}deg, ${stops})`;
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
    this.clearTimers();
    this.landed.set(true);
    // Flash the win, then fade out AND open the card underneath at once.
    this.flash = setTimeout(() => {
      this.leaving.set(true);
      this.settled.emit();
    }, 620);
  }

  private clearTimers(): void {
    if (this.failsafe) {
      clearTimeout(this.failsafe);
      this.failsafe = null;
    }
    if (this.flash) {
      clearTimeout(this.flash);
      this.flash = null;
    }
  }
}
