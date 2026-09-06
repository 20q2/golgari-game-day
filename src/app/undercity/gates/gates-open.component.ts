import {
  AfterViewInit,
  ChangeDetectionStrategy,
  Component,
  EventEmitter,
  OnDestroy,
  Output,
  signal,
} from '@angular/core';
import { CommonModule } from '@angular/common';

/** How long the cinematic holds before it dismisses itself (ms). Long enough to
 *  read both lines; the player can always tap through. */
const HOLD_MS = 6200;

/** Brood sprites that pour through the gap. Each gets its own lane, delay and
 *  scale so the spill reads as a swarm rather than a row. Lane/drift are written
 *  as finished CSS lengths: the `spill` keyframes read them as custom properties,
 *  and binding the units here keeps that independent of how Angular chooses to
 *  serialise a `[style.--x.px]` shorthand. */
const BROOD = [-46, 18, -12, 42, -30, 8, 34, -20]
  .map((lane, i) => ({
    lane: `${lane}px`,
    drift: `${[-190, 150, -95, 205, -240, 60, 265, -145][i]}px`,
    scale: [0.62, 0.78, 0.95, 0.7, 0.85, 1.05, 0.66, 0.9][i],
    delay: `${1.05 + i * 0.16}s`,
  }));

/**
 * The Queen's Awakening announcement: the sealed gate from the intro cutscene
 * splits down the middle, grinds open on a rising crimson glare, and Savra's
 * brood pours out past the camera.
 *
 * Every player gets this the moment the third Guild Sigil is raised — the board
 * event and the push broadcast already say the rot-wards fell, but a line of log
 * text is easy to miss mid-turn, and this is the night's pivot. Deliberately
 * built from the same parts as the intro's `gate` panel (the arched silhouette,
 * `gate_background.webp`, the same crimson glow) so it reads as that same gate
 * finally giving way rather than as a new piece of art.
 *
 * Self-contained: no store access and no persistence. The parent decides when to
 * show it (a bossPhase false→true transition) and listens for `done`.
 */
@Component({
  selector: 'app-undercity-gates-open',
  standalone: true,
  changeDetection: ChangeDetectionStrategy.OnPush,
  imports: [CommonModule],
  template: `
    <div class="gates" [class.go]="go()" (click)="finish()">
      <div class="bg" aria-hidden="true" [style.backgroundImage]="bgUrl"></div>
      <div class="scrim" aria-hidden="true"></div>

      <div class="stage" role="alert" aria-live="assertive">
        <div class="arch" aria-hidden="true">
          <!-- The glare behind the gate, revealed as the leaves part. -->
          <div class="breach"></div>
          @for (b of brood; track $index) {
            <img
              class="brood"
              [src]="broodUrl"
              alt=""
              [style.--lane]="b.lane"
              [style.--drift]="b.drift"
              [style.--scale]="b.scale"
              [style.animationDelay]="b.delay"
            />
          }
          <div class="leaf left"></div>
          <div class="leaf right"></div>
        </div>

        <h2 class="headline">The Gates Are Open</h2>
        <p class="sub">The Scouring Swarm has been released.</p>
      </div>

      <p class="hint" aria-hidden="true">Tap to continue</p>
    </div>
  `,
  styles: [
    `
      :host {
        position: fixed;
        inset: 0;
        z-index: 1400;
        --ease: cubic-bezier(0.22, 1, 0.36, 1);
        --gold: #e0b445;
        --gate-w: 190px;
        --gate-h: 240px;
      }
      .gates {
        position: absolute;
        inset: 0;
        overflow: hidden;
        display: flex;
        flex-direction: column;
        align-items: center;
        justify-content: center;
        background: #08080a;
        color: #f2ede0;
        text-align: center;
        cursor: pointer;
        user-select: none;
        animation: fade-in 0.35s ease both;
      }
      @keyframes fade-in {
        from { opacity: 0; }
        to { opacity: 1; }
      }
      .gates.leaving {
        opacity: 0;
        transition: opacity 0.45s ease;
      }

      .bg {
        position: absolute;
        inset: -6%;
        background-position: center 42%;
        background-size: cover;
        background-repeat: no-repeat;
        transform-origin: 50% 42%;
        animation: push-in 7s ease-out both;
      }
      .scrim {
        position: absolute;
        inset: 0;
        background:
          radial-gradient(ellipse at 50% 42%, rgba(8, 8, 10, 0.2), rgba(8, 8, 10, 0.88) 76%),
          linear-gradient(rgba(8, 8, 10, 0.6), rgba(8, 8, 10, 0.75));
      }
      @keyframes push-in {
        from { transform: scale(1); }
        to { transform: scale(1.16); }
      }

      .stage {
        position: relative;
        z-index: 2;
        display: flex;
        flex-direction: column;
        align-items: center;
        gap: 1.6rem;
        padding: 1.5rem;
      }

      /* --- the gate itself --- */
      .arch {
        position: relative;
        width: var(--gate-w);
        height: var(--gate-h);
      }
      .leaf {
        position: absolute;
        top: 0;
        width: 50%;
        height: 100%;
        background:
          linear-gradient(180deg, rgba(64, 40, 62, 0.95), rgba(14, 10, 18, 0.98)),
          radial-gradient(ellipse at 50% 30%, rgba(140, 60, 120, 0.5), transparent 70%);
        box-shadow: inset 0 0 40px rgba(0, 0, 0, 0.9);
        transform-origin: center;
      }
      /* Two halves of one arch: each leaf keeps the outer corner rounded so the
         closed pair reads as the intro's single arched silhouette. */
      .leaf.left {
        left: 0;
        border-radius: 96% 0 0 24% / 48% 0 0 12%;
        border-right: 1px solid rgba(0, 0, 0, 0.8);
      }
      .leaf.right {
        right: 0;
        border-radius: 0 96% 24% 0 / 0 48% 12% 0;
      }
      .go .leaf.left {
        animation: grind-left 2.4s cubic-bezier(0.5, 0, 0.2, 1) 0.55s both;
      }
      .go .leaf.right {
        animation: grind-right 2.4s cubic-bezier(0.5, 0, 0.2, 1) 0.55s both;
      }
      @keyframes grind-left {
        0% { transform: translateX(0); }
        12% { transform: translateX(4px); }
        100% { transform: translateX(calc(var(--gate-w) * -0.9)); }
      }
      @keyframes grind-right {
        0% { transform: translateX(0); }
        12% { transform: translateX(-4px); }
        100% { transform: translateX(calc(var(--gate-w) * 0.9)); }
      }

      /* The furnace light behind the doors, widening as they part. */
      .breach {
        position: absolute;
        left: 50%;
        top: 4%;
        width: 6px;
        height: 92%;
        transform: translateX(-50%);
        border-radius: 50% 50% 14% 14%;
        background: radial-gradient(ellipse at 50% 40%, #ffd08a, #c8324f 45%, rgba(90, 12, 40, 0) 78%);
        filter: blur(2px);
        opacity: 0;
      }
      .go .breach {
        animation: breach-open 2.4s cubic-bezier(0.5, 0, 0.2, 1) 0.55s both,
          breach-throb 2.2s ease-in-out 2.9s infinite;
      }
      @keyframes breach-open {
        0% { width: 6px; opacity: 0.5; }
        100% { width: calc(var(--gate-w) * 1.06); opacity: 1; }
      }
      @keyframes breach-throb {
        50% { filter: blur(4px) brightness(1.2); }
      }

      /* --- the brood pouring through --- */
      .brood {
        position: absolute;
        left: 50%;
        bottom: 12%;
        width: 74px;
        height: auto;
        margin-left: -37px;
        opacity: 0;
        filter: drop-shadow(0 6px 10px rgba(0, 0, 0, 0.75));
        animation: spill 2.6s ease-in both;
        will-change: transform, opacity;
      }
      /* Out of the gap, then past the camera: scale up and fling outward. */
      @keyframes spill {
        0% {
          opacity: 0;
          transform: translate(var(--lane), 20px) scale(calc(var(--scale) * 0.2));
        }
        22% { opacity: 1; }
        100% {
          opacity: 0;
          transform: translate(calc(var(--lane) + var(--drift)), 190px)
            scale(calc(var(--scale) * 2.1));
        }
      }

      /* --- copy --- */
      .headline {
        margin: 0;
        font-size: clamp(1.5rem, 8vw, 2.3rem);
        font-weight: 900;
        letter-spacing: 0.12em;
        text-transform: uppercase;
        color: #ffd76a;
        text-shadow: 0 2px 18px rgba(200, 50, 79, 0.8), 0 2px 6px rgba(0, 0, 0, 0.9);
        opacity: 0;
      }
      .sub {
        margin: 0;
        max-width: 26rem;
        font-size: 1.05rem;
        color: #f0d9d9;
        text-shadow: 0 2px 12px rgba(0, 0, 0, 0.9);
        opacity: 0;
      }
      .go .headline {
        animation: slam 0.7s cubic-bezier(0.2, 1.4, 0.4, 1) 2.05s both;
      }
      .go .sub {
        animation: rise 0.6s var(--ease) 2.5s both;
      }
      @keyframes slam {
        from { opacity: 0; transform: scale(1.6); filter: blur(6px); }
        to { opacity: 1; transform: none; filter: none; }
      }
      @keyframes rise {
        from { opacity: 0; transform: translateY(14px); }
        to { opacity: 1; transform: none; }
      }

      .hint {
        position: absolute;
        bottom: 1.1rem;
        left: 0;
        right: 0;
        z-index: 3;
        margin: 0;
        font-size: 0.8rem;
        opacity: 0;
      }
      .go .hint {
        animation: hint-in 2.4s ease 3.2s infinite;
      }
      @keyframes hint-in {
        0%, 100% { opacity: 0.3; }
        50% { opacity: 0.65; }
      }

      @media (prefers-reduced-motion: reduce) {
        .bg,
        .breach,
        .hint {
          animation: none !important;
        }
        .breach {
          opacity: 1;
          width: var(--gate-w);
        }
        .go .leaf.left {
          animation: none;
          transform: translateX(calc(var(--gate-w) * -0.9));
        }
        .go .leaf.right {
          animation: none;
          transform: translateX(calc(var(--gate-w) * 0.9));
        }
        .brood {
          display: none;
        }
        .go .headline,
        .go .sub {
          animation: none;
          opacity: 1;
        }
        .hint {
          opacity: 0.5;
        }
      }
    `,
  ],
})
export class GatesOpenComponent implements AfterViewInit, OnDestroy {
  /** Emitted when the cinematic times out or the player taps through. */
  @Output() done = new EventEmitter<void>();

  protected readonly brood = BROOD;
  /** Bound at runtime (not in the stylesheet) so webpack doesn't try to resolve
   *  the asset at build time — it's served from the app base href. */
  protected readonly bgUrl = "url('undercity/gate_background.webp')";
  protected readonly broodUrl = 'undercity/boss_spawns/scouring_swarm.png';

  /** Gates the animations so they start after first paint rather than mid-mount. */
  protected readonly go = signal(false);

  private hold: ReturnType<typeof setTimeout> | null = null;
  private start: ReturnType<typeof setTimeout> | null = null;
  private finished = false;

  ngAfterViewInit(): void {
    this.start = setTimeout(() => {
      this.go.set(true);
      this.hold = setTimeout(() => this.finish(), HOLD_MS);
    }, 40);
  }

  ngOnDestroy(): void {
    this.clear();
  }

  protected finish(): void {
    if (this.finished) return;
    this.finished = true;
    this.clear();
    this.done.emit();
  }

  private clear(): void {
    if (this.hold) {
      clearTimeout(this.hold);
      this.hold = null;
    }
    if (this.start) {
      clearTimeout(this.start);
      this.start = null;
    }
  }
}
