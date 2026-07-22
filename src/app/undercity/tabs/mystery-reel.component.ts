import {
  AfterViewInit,
  Component,
  EventEmitter,
  Input,
  Output,
  WritableSignal,
  signal,
} from '@angular/core';
import { CommonModule } from '@angular/common';
import { MatIconModule } from '@angular/material/icon';

interface Symbol {
  icon: string;
  color: string;
}

/** Reel faces — the outcome the server rolled maps to one of these keys. */
const SYMBOLS: Record<string, Symbol> = {
  spores: { icon: 'grain', color: '#e0c069' },
  item: { icon: 'inventory_2', color: '#b79bff' },
  heal: { icon: 'favorite', color: '#7fce8f' },
  hurt: { icon: 'heart_broken', color: '#e07a7a' },
  warp: { icon: 'cyclone', color: '#4fc4bc' },
  mystery: { icon: 'help', color: '#c4a5ff' },
};
const KEYS = Object.keys(SYMBOLS);

interface Reel {
  strip: string[];
  targetIndex: number;
  y: WritableSignal<number>;
  dur: number;
}

const CELL = 76;
const VISIBLE = 3; // rows in the window; the middle one is the payline
const rand = <T,>(arr: T[]): T => arr[Math.floor(Math.random() * arr.length)];

/**
 * A 3-reel slot machine that spins and slams to a stop on the mystery
 * outcome — pure reveal juice. The server already rolled the result; this
 * just builds suspense, lands all three reels on the same symbol (jackpot
 * slam), throws a spark burst, then emits `settled` so the event card opens.
 */
@Component({
  selector: 'app-undercity-mystery-reel',
  standalone: true,
  imports: [CommonModule, MatIconModule],
  template: `
    <div class="reel-overlay" [class.leaving]="leaving()" [style.background-image]="washBg">
      <div class="reel-machine" [class.jackpot]="jackpot()">
        <div class="reel-title">✦ MYSTERY ✦</div>
        <div class="reel-window">
          @for (reel of reels; track $index) {
            <div class="reel">
              <div
                class="strip"
                [style.transform]="'translateY(' + reel.y() + 'px)'"
                [style.transitionDuration]="reel.dur + 'ms'"
                (transitionend)="onReelStop($index)"
              >
                @for (s of reel.strip; track $index) {
                  <div class="cell" [style.color]="symbols[s].color">
                    <mat-icon>{{ symbols[s].icon }}</mat-icon>
                  </div>
                }
              </div>
            </div>
          }
          <div class="payline"></div>
          @if (jackpot()) {
            <div class="burst">
              @for (p of particles; track $index) {
                <span
                  class="spark"
                  [style.--tx]="p.tx + 'px'"
                  [style.--ty]="p.ty + 'px'"
                  [style.background]="p.color"
                  [style.animationDelay]="p.delay + 'ms'"
                ></span>
              }
            </div>
          }
        </div>
        <div class="reel-caption">{{ jackpot() ? 'The rot decides…' : 'Spinning fate…' }}</div>
      </div>
    </div>
  `,
  styles: [
    `
      .reel-overlay {
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
      /* Fade out as the event card materializes underneath — seamless handoff. */
      .reel-overlay.leaving {
        opacity: 0;
        pointer-events: none;
      }
      .reel-overlay.leaving .reel-machine {
        transform: scale(0.94);
        transition: transform 0.34s ease;
      }
      @keyframes fade {
        from { opacity: 0; }
        to { opacity: 1; }
      }
      .reel-machine {
        position: relative;
        padding: 16px;
        border-radius: 18px;
        background: linear-gradient(180deg, #2a2434, #1a1620);
        border: 2px solid rgba(167, 139, 250, 0.5);
        box-shadow:
          0 24px 60px rgba(0, 0, 0, 0.7),
          inset 0 2px 0 rgba(196, 181, 253, 0.25);
        animation: machine-in 0.32s cubic-bezier(0.2, 1.5, 0.4, 1);
      }
      @keyframes machine-in {
        from { opacity: 0; transform: translateY(18px) scale(0.9); }
        to { opacity: 1; transform: none; }
      }
      .reel-machine.jackpot {
        border-color: #ffe08a;
        box-shadow:
          0 24px 60px rgba(0, 0, 0, 0.7),
          0 0 40px rgba(255, 214, 120, 0.45),
          inset 0 2px 0 rgba(255, 224, 150, 0.4);
        animation: slam 0.4s cubic-bezier(0.36, 0.07, 0.19, 0.97);
      }
      @keyframes slam {
        0%, 100% { transform: translate(0, 0); }
        20% { transform: translate(-4px, 3px); }
        40% { transform: translate(5px, -2px); }
        60% { transform: translate(-3px, 2px); }
        80% { transform: translate(2px, -1px); }
      }
      .reel-title {
        text-align: center;
        font-weight: 900;
        letter-spacing: 0.28em;
        text-indent: 0.28em;
        font-size: 0.9rem;
        color: #d8c4ff;
        margin-bottom: 12px;
        text-shadow: 0 1px 4px rgba(0, 0, 0, 0.8);
      }
      .reel-window {
        position: relative;
        display: flex;
        gap: 8px;
        padding: 8px;
        border-radius: 12px;
        background: #0f0c14;
        box-shadow: inset 0 4px 12px rgba(0, 0, 0, 0.8);
      }
      .reel {
        width: 84px;
        height: ${VISIBLE * CELL}px;
        overflow: hidden;
        border-radius: 8px;
        background: linear-gradient(180deg, #17131e, #221c2c);
        /* fade the top/bottom rows so the payline pops */
        -webkit-mask: linear-gradient(180deg, transparent, #000 22%, #000 78%, transparent);
        mask: linear-gradient(180deg, transparent, #000 22%, #000 78%, transparent);
      }
      .strip {
        display: flex;
        flex-direction: column;
        transition-property: transform;
        transition-timing-function: cubic-bezier(0.16, 0.9, 0.24, 1.01);
        will-change: transform;
      }
      .cell {
        height: ${CELL}px;
        display: flex;
        align-items: center;
        justify-content: center;
        flex: none;
      }
      .cell mat-icon {
        font-size: 44px;
        width: 44px;
        height: 44px;
        filter: drop-shadow(0 2px 4px rgba(0, 0, 0, 0.6));
      }
      /* the center payline band */
      .payline {
        position: absolute;
        left: 6px;
        right: 6px;
        top: 50%;
        height: ${CELL}px;
        transform: translateY(-50%);
        border-radius: 8px;
        border: 2px solid rgba(167, 139, 250, 0.35);
        box-shadow: inset 0 0 18px rgba(167, 139, 250, 0.2);
        pointer-events: none;
        transition: border-color 0.2s ease, box-shadow 0.2s ease;
      }
      .jackpot .payline {
        border-color: rgba(255, 214, 120, 0.9);
        box-shadow: inset 0 0 22px rgba(255, 214, 120, 0.4), 0 0 16px rgba(255, 214, 120, 0.3);
        animation: payline-pulse 0.5s ease 2;
      }
      @keyframes payline-pulse {
        50% { box-shadow: inset 0 0 30px rgba(255, 224, 150, 0.6), 0 0 26px rgba(255, 214, 120, 0.5); }
      }
      .reel-caption {
        text-align: center;
        margin-top: 12px;
        font-size: 0.85rem;
        color: #9d90b0;
        font-style: italic;
      }
      .burst {
        position: absolute;
        inset: 0;
        pointer-events: none;
        display: flex;
        align-items: center;
        justify-content: center;
      }
      .spark {
        position: absolute;
        width: 9px;
        height: 9px;
        border-radius: 50%;
        opacity: 0;
        animation: spark 0.7s ease-out forwards;
      }
      @keyframes spark {
        0% { opacity: 1; transform: translate(0, 0) scale(1); }
        100% { opacity: 0; transform: translate(var(--tx), var(--ty)) scale(0.3); }
      }
    `,
  ],
})
export class MysteryReelComponent implements AfterViewInit {
  @Input({ required: true }) target!: string;
  /** Region biome wash painted behind the machine, on the scrim (from the board tab). */
  @Input() washBg: string | null = null;
  @Output() settled = new EventEmitter<void>();

  protected readonly symbols = SYMBOLS;
  protected reels: Reel[] = [];
  protected readonly jackpot = signal(false);
  protected readonly leaving = signal(false);
  private done = false;

  protected readonly particles = Array.from({ length: 16 }, () => {
    const ang = Math.random() * Math.PI * 2;
    const dist = 70 + Math.random() * 90;
    return {
      tx: Math.round(Math.cos(ang) * dist),
      ty: Math.round(Math.sin(ang) * dist),
      delay: Math.round(Math.random() * 140),
      color: Math.random() < 0.5 ? '#ffe08a' : '#a5e0b5',
    };
  });

  ngAfterViewInit(): void {
    const key = this.symbols[this.target] ? this.target : 'mystery';
    const durs = [1500, 2000, 2600]; // staggered finishes for the classic left→right stop
    this.reels = durs.map((dur) => {
      const len = 32;
      const targetIndex = 27;
      const strip = Array.from({ length: len }, () => rand(KEYS));
      strip[targetIndex] = key;
      // Keep the two flanking faces off-target so the payline read is unambiguous.
      strip[targetIndex - 1] = rand(KEYS.filter((k) => k !== key));
      strip[targetIndex + 1] = rand(KEYS.filter((k) => k !== key));
      return { strip, targetIndex, y: signal(0), dur };
    });

    // Let the strips paint at y=0, then trigger the eased slide so the target
    // lands on the center payline (visible row index 1 of VISIBLE).
    requestAnimationFrame(() => {
      requestAnimationFrame(() => {
        for (const r of this.reels) r.y.set(-(r.targetIndex - 1) * CELL);
      });
    });
  }

  protected onReelStop(index: number): void {
    if (index !== this.reels.length - 1 || this.done) return;
    this.done = true;
    this.jackpot.set(true);
    // Celebrate, then fade the machine out AND signal the parent to open the
    // event card underneath at the same instant — a cross-fade, not a cut.
    setTimeout(() => {
      this.leaving.set(true);
      this.settled.emit();
    }, 600);
  }
}
