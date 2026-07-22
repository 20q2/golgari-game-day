import {
  ChangeDetectionStrategy,
  Component,
  EventEmitter,
  OnDestroy,
  OnInit,
  Output,
  signal,
} from '@angular/core';
import { CommonModule } from '@angular/common';
import { MatIconModule } from '@angular/material/icon';

interface Panel {
  kind: 'gate' | 'guardians' | 'seals' | 'egg';
  text: string;
}

/** The five biome-lair guardians that hold Guild Sigils (mirrors LAIR_BOSSES,
 *  excluding lair_titan which is side content). Art: undercity/guardians/<id>.png. */
const GUARDIAN_IDS = ['ishkanah', 'sarulf', 'gitrog_monster', 'skullbriar', 'slimefoot'];

/**
 * One-time story intro shown to first-time players at the top of the hatch flow.
 * Still panels that set the night's goal — collect three Guild Sigils, wake the
 * Queen, grow the biggest legend by dawn — then hand off into the egg tap.
 *
 * Self-contained: no store access, no persistence. The parent decides when to
 * show it (localStorage flag) and listens for `done`.
 */
@Component({
  selector: 'app-undercity-intro-cutscene',
  standalone: true,
  changeDetection: ChangeDetectionStrategy.OnPush,
  imports: [CommonModule, MatIconModule],
  template: `
    <div class="cutscene" [style.background-image]="bgImage" (click)="next()">
      <button class="skip" (click)="skip(); $event.stopPropagation()">Skip</button>

      @if (panel(); as p) {
        <div class="panel" [attr.data-i]="index()">
          @switch (p.kind) {
            @case ('gate') {
              <div class="gate-silhouette" aria-hidden="true"></div>
            }
            @case ('guardians') {
              <div class="guardian-row">
                @for (g of guardians; track g) {
                  <img class="guardian" [src]="'undercity/guardians/' + g + '.png'" alt="" />
                }
              </div>
            }
            @case ('seals') {
              <div class="seal-row" aria-hidden="true">
                @for (s of [0, 1, 2]; track s) {
                  <mat-icon class="seal">workspace_premium</mat-icon>
                }
              </div>
            }
            @case ('egg') {
              <div class="egg-teaser" aria-hidden="true"></div>
            }
          }
          <p class="narration">{{ p.text }}</p>
        </div>
      }

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
      }
      .cutscene {
        position: absolute;
        inset: 0;
        display: flex;
        flex-direction: column;
        align-items: center;
        justify-content: center;
        gap: 1.5rem;
        padding: 2rem 1.5rem 3rem;
        background-size: cover;
        background-position: center;
        color: #f2ede0;
        text-align: center;
        cursor: pointer;
        user-select: none;
        overflow: hidden;
      }
      .skip {
        position: absolute;
        top: 1rem;
        right: 1rem;
        padding: 0.35rem 0.9rem;
        border: 1px solid rgba(242, 237, 224, 0.4);
        border-radius: 999px;
        background: rgba(0, 0, 0, 0.35);
        color: #f2ede0;
        font-size: 0.85rem;
        cursor: pointer;
      }
      .skip:hover {
        background: rgba(0, 0, 0, 0.55);
      }
      .panel {
        display: flex;
        flex-direction: column;
        align-items: center;
        gap: 1.75rem;
        max-width: 32rem;
        animation: panel-in 0.55s ease both;
      }
      @keyframes panel-in {
        from {
          opacity: 0;
          transform: translateY(10px);
        }
        to {
          opacity: 1;
          transform: none;
        }
      }
      .narration {
        margin: 0;
        font-size: 1.25rem;
        line-height: 1.5;
        text-shadow: 0 2px 12px rgba(0, 0, 0, 0.8);
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
      .seal-row {
        display: flex;
        gap: 1.25rem;
      }
      .seal {
        font-size: 3.25rem;
        width: 3.25rem;
        height: 3.25rem;
        color: #e0b445;
        filter: drop-shadow(0 0 14px rgba(224, 180, 69, 0.65));
        animation: seal-pop 0.5s ease both;
      }
      .seal:nth-child(2) {
        animation-delay: 0.15s;
      }
      .seal:nth-child(3) {
        animation-delay: 0.3s;
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
      .egg-teaser {
        width: 6rem;
        height: 7.5rem;
        border-radius: 50% 50% 46% 46%;
        background: linear-gradient(160deg, #8fae5c, #5f7d3a);
        box-shadow: 0 8px 24px rgba(0, 0, 0, 0.6), inset -8px -10px 20px rgba(0, 0, 0, 0.35);
        animation: egg-bob 1.6s ease-in-out infinite;
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
      .dots {
        position: absolute;
        bottom: 2.4rem;
        display: flex;
        gap: 0.5rem;
      }
      .dot {
        width: 0.5rem;
        height: 0.5rem;
        border-radius: 50%;
        background: rgba(242, 237, 224, 0.3);
        transition: background 0.2s;
      }
      .dot.on {
        background: #e0b445;
      }
      .advance-hint {
        position: absolute;
        bottom: 1rem;
        margin: 0;
        font-size: 0.8rem;
        opacity: 0.55;
      }
    `,
  ],
})
export class IntroCutsceneComponent implements OnInit, OnDestroy {
  /** Emitted when the player finishes the last panel or taps Skip. */
  @Output() done = new EventEmitter<void>();

  protected readonly guardians = GUARDIAN_IDS;
  protected readonly bgImage =
    "linear-gradient(rgba(8,8,10,0.78), rgba(8,8,10,0.9)), url('undercity/gate_background.png')";

  protected readonly panels: Panel[] = [
    {
      kind: 'gate',
      text: 'Beneath the game table, the Swarm Queen sleeps behind a sealed gate.',
    },
    { kind: 'guardians', text: 'Her guardians hold the Guild Sigils.' },
    {
      kind: 'seals',
      text: 'Claim three, and the gate opens. Grow the biggest legend by dawn to be crowned.',
    },
    { kind: 'egg', text: "But first — you're still in your shell. Tap to crack it." },
  ];

  protected readonly index = signal(0);
  protected panel(): Panel | null {
    return this.panels[this.index()] ?? null;
  }

  private timer: ReturnType<typeof setTimeout> | null = null;

  ngOnInit(): void {
    this.arm();
  }
  ngOnDestroy(): void {
    this.disarm();
  }

  /** (Re)start the auto-advance timer for the current panel. */
  private arm(): void {
    this.disarm();
    this.timer = setTimeout(() => this.next(), 4000);
  }
  private disarm(): void {
    if (this.timer) {
      clearTimeout(this.timer);
      this.timer = null;
    }
  }

  next(): void {
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
