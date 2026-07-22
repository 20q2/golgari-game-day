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
import { MatIconModule } from '@angular/material/icon';

interface Panel {
  kind: 'gate' | 'renown' | 'guardians' | 'seals' | 'egg';
  text: string;
}

/** The five biome-lair guardians that hold Guild Sigils (mirrors LAIR_BOSSES,
 *  excluding lair_titan which is side content). Art: undercity/guardians/<id>.png. */
const GUARDIAN_IDS = ['ishkanah', 'sarulf', 'gitrog_monster', 'skullbriar', 'slimefoot'];

/** Auto-advance dwell per panel (ms). Kept in sync with the CSS `--dur` timer bar. */
const PANEL_MS = 11000;

/**
 * One-time story intro shown to first-time players at the top of the hatch flow.
 *
 * Rendered as a cinematic slideshow: every panel is present in the DOM and
 * cross-faded via CSS `.active` toggling, so the outgoing panel slides up and
 * out while the incoming one rises in. Within a panel, the hero visual reveals
 * first, then the narration word-by-word, then any internal cascade (guardians,
 * seals). Fully self-contained — no store access, no persistence, no global
 * animation provider. The parent decides when to show it (localStorage flag)
 * and listens for `done`.
 */
@Component({
  selector: 'app-undercity-intro-cutscene',
  standalone: true,
  changeDetection: ChangeDetectionStrategy.OnPush,
  imports: [CommonModule, MatIconModule],
  template: `
    <div class="cutscene" (click)="next()">
      <div class="bg" aria-hidden="true" [style.backgroundImage]="bgUrl"></div>
      <div class="scrim" aria-hidden="true"></div>
      <div class="glow" aria-hidden="true"></div>

      <button class="skip" (click)="skip(); $event.stopPropagation()">Skip</button>

      <div class="stage">
        @for (p of panels; track $index; let pi = $index) {
          <div
            class="panel"
            [class.active]="ready() && pi === index()"
            [class.past]="pi < index()"
          >
            <div class="visual" [attr.data-kind]="p.kind">
              @switch (p.kind) {
                @case ('gate') {
                  <div class="gate-silhouette"></div>
                }
                @case ('renown') {
                  <mat-icon class="renown-medal">military_tech</mat-icon>
                }
                @case ('guardians') {
                  <div class="guardian-row">
                    @for (g of guardians; track g) {
                      <img class="guardian" [src]="'undercity/guardians/' + g + '.png'" alt="" />
                    }
                  </div>
                }
                @case ('seals') {
                  <div class="seal-row">
                    @for (s of [0, 1, 2]; track s) {
                      <mat-icon class="seal">workspace_premium</mat-icon>
                    }
                  </div>
                }
                @case ('egg') {
                  <div class="egg-teaser"></div>
                }
              }
            </div>

            <p class="narration">
              @for (w of p.words; track $index; let wi = $index) {
                <span
                  class="word"
                  [style.transitionDelay]="
                    ready() && pi === index() ? 0.34 + wi * 0.045 + 's' : '0s'
                  "
                  >{{ w }}</span
                >
              }
            </p>

            <span class="timer-bar" aria-hidden="true"></span>
          </div>
        }
      </div>

      <div class="dots" aria-hidden="true">
        @for (p of panels; track $index) {
          <span class="dot" [class.on]="$index === index()"></span>
        }
      </div>
      <p class="advance-hint">Tap to continue</p>
    </div>
  `,
  styles: [
    `
      :host {
        position: fixed;
        inset: 0;
        z-index: 40;
        --ease: cubic-bezier(0.22, 1, 0.36, 1);
        --gold: #e0b445;
        --dur: 11000ms;
      }
      .cutscene {
        position: absolute;
        inset: 0;
        overflow: hidden;
        color: #f2ede0;
        text-align: center;
        cursor: pointer;
        user-select: none;
        background: #08080a;
      }

      /* --- cinematic background layers --- */
      .bg {
        position: absolute;
        inset: -6%;
        background-position: center 42%;
        background-size: cover;
        background-repeat: no-repeat;
        transform-origin: 50% 42%;
        animation: kenburns 24s ease-in-out infinite alternate;
        will-change: transform;
      }
      .scrim {
        position: absolute;
        inset: 0;
        background: radial-gradient(
            ellipse at 50% 38%,
            rgba(8, 8, 10, 0.35),
            rgba(8, 8, 10, 0.82) 78%
          ),
          linear-gradient(rgba(8, 8, 10, 0.55), rgba(8, 8, 10, 0.7));
      }
      .glow {
        position: absolute;
        inset: -20%;
        background: radial-gradient(
          circle at 50% 40%,
          rgba(150, 48, 78, 0.28),
          transparent 45%
        );
        animation: drift 13s ease-in-out infinite alternate;
        will-change: transform, opacity;
      }
      @keyframes kenburns {
        from {
          transform: scale(1) translate(0, 0);
        }
        to {
          transform: scale(1.14) translate(-1.5%, -2%);
        }
      }
      @keyframes drift {
        from {
          transform: translate(-4%, 2%);
          opacity: 0.7;
        }
        to {
          transform: translate(5%, -3%);
          opacity: 1;
        }
      }

      .skip {
        position: absolute;
        top: 1rem;
        right: 1rem;
        z-index: 3;
        padding: 0.35rem 0.9rem;
        border: 1px solid rgba(242, 237, 224, 0.4);
        border-radius: 999px;
        background: rgba(0, 0, 0, 0.35);
        color: #f2ede0;
        font-size: 0.85rem;
        cursor: pointer;
        transition: background 0.2s;
      }
      .skip:hover {
        background: rgba(0, 0, 0, 0.6);
      }

      /* --- slideshow stage --- */
      .stage {
        position: absolute;
        inset: 0;
        z-index: 2;
      }
      .panel {
        position: absolute;
        inset: 0;
        display: flex;
        flex-direction: column;
        align-items: center;
        justify-content: center;
        gap: 2rem;
        padding: 2rem 1.5rem 4rem;
        opacity: 0;
        transform: translateY(34px) scale(0.985);
        pointer-events: none;
        transition: opacity 0.6s var(--ease), transform 0.7s var(--ease);
        will-change: opacity, transform;
      }
      .panel.past {
        transform: translateY(-34px) scale(0.985);
      }
      .panel.active {
        opacity: 1;
        transform: none;
        pointer-events: auto;
      }

      .visual {
        display: flex;
        align-items: flex-end;
        justify-content: center;
        min-height: 11rem;
      }

      .narration {
        margin: 0;
        max-width: 32rem;
        font-size: 1.3rem;
        line-height: 1.55;
        text-shadow: 0 2px 14px rgba(0, 0, 0, 0.85);
      }
      .word {
        display: inline-block;
        margin-right: 0.28em;
        opacity: 0;
        transform: translateY(14px);
        transition: opacity 0.5s var(--ease), transform 0.5s var(--ease);
      }
      .panel.active .word {
        opacity: 1;
        transform: none;
      }

      /* --- hero visuals: revealed only while their panel is active --- */
      .gate-silhouette,
      .renown-medal,
      .guardian,
      .seal,
      .egg-teaser {
        opacity: 0;
      }
      .panel.active .gate-silhouette,
      .panel.active .renown-medal,
      .panel.active .egg-teaser {
        animation: rise-pop 0.75s var(--ease) 0.05s both;
      }

      .gate-silhouette {
        width: 8rem;
        height: 11rem;
        border-radius: 48% 48% 12% 12%;
        background: radial-gradient(
          ellipse at 50% 35%,
          rgba(140, 60, 120, 0.55),
          rgba(10, 8, 14, 0.9) 70%
        );
        box-shadow: 0 0 60px rgba(150, 48, 78, 0.5), inset 0 0 40px rgba(0, 0, 0, 0.9);
      }
      .panel.active .gate-silhouette {
        animation: rise-pop 0.75s var(--ease) 0.05s both,
          gate-pulse 3.4s ease-in-out 0.8s infinite;
      }

      .renown-medal {
        font-size: 4.5rem;
        width: 4.5rem;
        height: 4.5rem;
        color: var(--gold);
        filter: drop-shadow(0 0 18px rgba(224, 180, 69, 0.65));
      }
      .panel.active .renown-medal {
        animation: rise-pop 0.75s var(--ease) 0.05s both,
          medal-glow 2.6s ease-in-out 0.9s infinite;
      }

      .guardian-row {
        display: flex;
        flex-wrap: wrap;
        align-items: flex-end;
        justify-content: center;
        gap: 0.75rem;
      }
      .guardian {
        width: 22vw;
        max-width: 6.5rem;
        height: auto;
        filter: drop-shadow(0 6px 14px rgba(0, 0, 0, 0.7));
      }
      .panel.active .guardian {
        animation: rise-pop 0.6s var(--ease) both;
      }
      .panel.active .guardian:nth-child(1) {
        animation-delay: 0.1s;
      }
      .panel.active .guardian:nth-child(2) {
        animation-delay: 0.22s;
      }
      .panel.active .guardian:nth-child(3) {
        animation-delay: 0.34s;
      }
      .panel.active .guardian:nth-child(4) {
        animation-delay: 0.46s;
      }
      .panel.active .guardian:nth-child(5) {
        animation-delay: 0.58s;
      }

      .seal-row {
        display: flex;
        gap: 1.25rem;
      }
      .seal {
        font-size: 3.4rem;
        width: 3.4rem;
        height: 3.4rem;
        color: var(--gold);
        filter: drop-shadow(0 0 14px rgba(224, 180, 69, 0.65));
      }
      .panel.active .seal {
        animation: seal-pop 0.55s var(--ease) both;
      }
      .panel.active .seal:nth-child(1) {
        animation-delay: 0.15s;
      }
      .panel.active .seal:nth-child(2) {
        animation-delay: 0.32s;
      }
      .panel.active .seal:nth-child(3) {
        animation-delay: 0.49s;
      }

      .egg-teaser {
        width: 6rem;
        height: 7.5rem;
        border-radius: 50% 50% 46% 46%;
        background: linear-gradient(160deg, #8fae5c, #5f7d3a);
        box-shadow: 0 8px 24px rgba(0, 0, 0, 0.6), inset -8px -10px 20px rgba(0, 0, 0, 0.35);
      }
      .panel.active .egg-teaser {
        animation: rise-pop 0.7s var(--ease) 0.05s both,
          egg-bob 1.7s ease-in-out 0.75s infinite;
      }

      /* --- per-panel auto-advance timer --- */
      .timer-bar {
        position: absolute;
        left: 0;
        bottom: 3.6rem;
        height: 2px;
        width: 0;
        background: linear-gradient(90deg, transparent, var(--gold));
        opacity: 0;
      }
      .panel.active .timer-bar {
        animation: fill var(--dur) linear both;
      }

      .dots {
        position: absolute;
        bottom: 2.4rem;
        left: 0;
        right: 0;
        z-index: 3;
        display: flex;
        justify-content: center;
        gap: 0.55rem;
      }
      .dot {
        width: 0.5rem;
        height: 0.5rem;
        border-radius: 999px;
        background: rgba(242, 237, 224, 0.3);
        transition: width 0.4s var(--ease), background 0.3s;
      }
      .dot.on {
        width: 1.5rem;
        background: var(--gold);
      }
      .advance-hint {
        position: absolute;
        bottom: 1rem;
        left: 0;
        right: 0;
        z-index: 3;
        margin: 0;
        font-size: 0.8rem;
        opacity: 0.55;
        animation: hint-pulse 2.4s ease-in-out infinite;
      }

      /* --- keyframes --- */
      @keyframes rise-pop {
        from {
          opacity: 0;
          transform: translateY(22px) scale(0.9);
        }
        60% {
          opacity: 1;
        }
        to {
          opacity: 1;
          transform: none;
        }
      }
      @keyframes seal-pop {
        from {
          opacity: 0;
          transform: scale(0.4) rotate(-20deg);
        }
        to {
          opacity: 1;
          transform: none;
        }
      }
      @keyframes egg-bob {
        0%,
        100% {
          transform: translateY(0) rotate(-3deg);
        }
        50% {
          transform: translateY(-6px) rotate(3deg);
        }
      }
      @keyframes gate-pulse {
        0%,
        100% {
          box-shadow: 0 0 60px rgba(150, 48, 78, 0.5), inset 0 0 40px rgba(0, 0, 0, 0.9);
        }
        50% {
          box-shadow: 0 0 90px rgba(150, 48, 78, 0.75), inset 0 0 40px rgba(0, 0, 0, 0.9);
        }
      }
      @keyframes medal-glow {
        0%,
        100% {
          filter: drop-shadow(0 0 18px rgba(224, 180, 69, 0.55));
        }
        50% {
          filter: drop-shadow(0 0 30px rgba(224, 180, 69, 0.95));
        }
      }
      @keyframes fill {
        from {
          width: 0;
          opacity: 0.9;
        }
        to {
          width: 100%;
          opacity: 0.9;
        }
      }
      @keyframes hint-pulse {
        0%,
        100% {
          opacity: 0.35;
        }
        50% {
          opacity: 0.7;
        }
      }

      @media (prefers-reduced-motion: reduce) {
        .bg,
        .glow,
        .advance-hint {
          animation: none;
        }
        .panel {
          transition: opacity 0.3s linear;
          transform: none;
        }
        .panel.past {
          transform: none;
        }
        .word {
          transition: opacity 0.2s linear;
          transform: none;
        }
        .panel.active .gate-silhouette,
        .panel.active .renown-medal,
        .panel.active .guardian,
        .panel.active .seal,
        .panel.active .egg-teaser {
          animation: none;
          opacity: 1;
        }
        .timer-bar {
          display: none;
        }
      }
    `,
  ],
})
export class IntroCutsceneComponent implements AfterViewInit, OnDestroy {
  /** Emitted when the player finishes the last panel or taps Skip. */
  @Output() done = new EventEmitter<void>();

  protected readonly guardians = GUARDIAN_IDS;
  /** Bound at runtime (not in the stylesheet) so webpack doesn't try to resolve
   *  the asset at build time — it's served from the app base href. */
  protected readonly bgUrl = "url('undercity/gate_background.png')";

  private static readonly RAW: Panel[] = [
    {
      kind: 'gate',
      text: 'Deep under the table lies the Undercity, where the Swarm Queen sleeps behind a sealed gate. Grow the greatest legend by dawn — the most Renown — and the night is yours.',
    },
    {
      kind: 'renown',
      text: "You'll roam the dark, hatch your strength, and clash with wild things and rival hatchlings alike. Every victory writes your legend.",
    },
    {
      kind: 'guardians',
      text: 'Five guardians prowl the deep biomes, each holding a Guild Sigil. Strike one down and the Sigil is yours.',
    },
    {
      kind: 'seals',
      text: "Gather three Sigils and the Queen's gate grinds open. Stand against her, and glory goes to the boldest.",
    },
    { kind: 'egg', text: "But first — you're still in your egg. Tap to crack it." },
  ];

  /** Panels with pre-split words for the staggered word-by-word reveal. */
  protected readonly panels = IntroCutsceneComponent.RAW.map((p) => ({
    ...p,
    words: p.text.split(' '),
  }));

  protected readonly index = signal(0);
  /** Gates the enter transition so the first panel animates in after paint. */
  protected readonly ready = signal(false);

  private timer: ReturnType<typeof setTimeout> | null = null;
  private readyTimer: ReturnType<typeof setTimeout> | null = null;

  ngAfterViewInit(): void {
    // Flip `ready` on the next tick so panel 0 transitions in from its
    // hidden initial state rather than mounting already-visible.
    this.readyTimer = setTimeout(() => {
      this.ready.set(true);
      this.arm();
    }, 40);
  }
  ngOnDestroy(): void {
    this.disarm();
    if (this.readyTimer) {
      clearTimeout(this.readyTimer);
      this.readyTimer = null;
    }
  }

  /** (Re)start the auto-advance timer for the current panel. */
  private arm(): void {
    this.disarm();
    this.timer = setTimeout(() => this.next(), PANEL_MS);
  }
  private disarm(): void {
    if (this.timer) {
      clearTimeout(this.timer);
      this.timer = null;
    }
  }

  next(): void {
    if (!this.ready()) {
      return;
    }
    if (this.index() >= this.panels.length - 1) {
      this.finish();
      return;
    }
    this.index.set(this.index() + 1);
    this.arm();
  }

  skip(): void {
    this.finish();
  }

  private finish(): void {
    this.disarm();
    this.done.emit();
  }
}
