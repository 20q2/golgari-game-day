import { Component, Input, computed, signal } from '@angular/core';
import { CommonModule } from '@angular/common';
import { MatIconModule } from '@angular/material/icon';
import { MYSTERY_SYMBOLS } from '../data/mystery-symbols';

interface Particle {
  tx: number;
  ty: number;
  d: number; // delay ms
  s: number; // scale
}

const TAU = Math.PI * 2;
const rnd = (a: number, b: number) => a + Math.random() * (b - a);

/** A radial burst of particles (used for coin fountains, spark rings). */
function burst(n: number, minD: number, maxD: number, upBias = 0): Particle[] {
  return Array.from({ length: n }, () => {
    const ang = Math.random() * TAU;
    const dist = rnd(minD, maxD);
    return {
      tx: Math.round(Math.cos(ang) * dist),
      ty: Math.round(Math.sin(ang) * dist) - upBias, // negative ty = upward
      d: Math.round(rnd(0, 260)),
      s: +rnd(0.6, 1.15).toFixed(2),
    };
  });
}

/** Motes drifting upward with slight horizontal wander (spores / xp / heal). */
function rise(n: number): Particle[] {
  return Array.from({ length: n }, () => ({
    tx: Math.round(rnd(-34, 34)),
    ty: Math.round(rnd(-64, -30)),
    d: Math.round(rnd(0, 900)),
    s: +rnd(0.5, 1).toFixed(2),
  }));
}

const px = (n: number) => `${n}px`;
const ms = (n: number) => `${n}ms`;

/**
 * Mystery-event payoff animation. Given the server outcome key
 * (jackpot | gear | grimoire | item | heal | buff | curse | warp | hurt |
 * theft | spores | xp | mystery), plays a short, one-shot CSS scene inside the
 * event-card banner: a burst → reveal → settle beat, tinted per outcome to
 * match the reveal reel (shared MYSTERY_SYMBOLS). Purely decorative and
 * non-blocking — the card text and OK button read immediately underneath.
 *
 * Unit-bearing custom properties (--tx/--ty/--d) are bound as pre-suffixed
 * strings, matching the shipped reel — Angular does not append `.px`/`.ms`
 * units to custom properties.
 */
@Component({
  selector: 'app-undercity-mystery-fx',
  standalone: true,
  imports: [CommonModule, MatIconModule],
  template: `
    <div class="mfx" [attr.data-fx]="key()" [style.--tint]="sym().color">
      <!-- Shared shockwave rings behind the reveal. -->
      <span class="ring"></span>
      <span class="ring ring2"></span>

      @switch (key()) {
        @case ('jackpot') {
          <span class="coins">
            @for (p of coins; track $index) {
              <img
                class="coin"
                src="undercity/icons/rot.png"
                alt=""
                [style.--tx]="px(p.tx)"
                [style.--ty]="px(p.ty)"
                [style.--d]="ms(p.d)"
                [style.--s]="p.s"
              />
            }
          </span>
          <span class="disc jackpot-disc"><mat-icon>casino</mat-icon></span>
          <span class="flash"></span>
        }

        @case ('gear') {
          <span class="sparks">
            @for (p of sparks; track $index) {
              <span class="spark" [style.--tx]="px(p.tx)" [style.--ty]="px(p.ty)" [style.--d]="ms(p.d)"></span>
            }
          </span>
          <span class="disc lift"><mat-icon>shield</mat-icon></span>
          <span class="glint"></span>
        }

        @case ('grimoire') {
          <span class="disc book"><mat-icon>menu_book</mat-icon></span>
          <span class="motes">
            @for (p of motes; track $index) {
              <span class="mote" [style.--tx]="px(p.tx)" [style.--ty]="px(p.ty)" [style.--d]="ms(p.d)" [style.--s]="p.s"></span>
            }
          </span>
        }

        @case ('item') {
          <span class="disc pack"><mat-icon>backpack</mat-icon></span>
          <span class="pop-icon"><mat-icon>redeem</mat-icon></span>
        }

        @case ('heal') {
          <span class="bloom"></span>
          <span class="disc pulse"><mat-icon>favorite</mat-icon></span>
          <span class="motes heal-motes">
            @for (p of motes; track $index) {
              <span class="mote" [style.--tx]="px(p.tx)" [style.--ty]="px(p.ty)" [style.--d]="ms(p.d)" [style.--s]="p.s"></span>
            }
          </span>
        }

        @case ('buff') {
          <span class="charge">
            @for (p of sparks; track $index) {
              <span class="bolt-in" [style.--tx]="px(p.tx)" [style.--ty]="px(p.ty)" [style.--d]="ms(p.d)"></span>
            }
          </span>
          <span class="disc surge"><mat-icon>bolt</mat-icon></span>
          <span class="flash"></span>
        }

        @case ('spores') {
          <span class="disc drift"><mat-icon>grain</mat-icon></span>
          <span class="motes spore-motes">
            @for (p of motes; track $index) {
              <span class="mote" [style.--tx]="px(p.tx)" [style.--ty]="px(p.ty)" [style.--d]="ms(p.d)" [style.--s]="p.s"></span>
            }
          </span>
        }

        @case ('xp') {
          <span class="disc drift"><mat-icon>auto_awesome</mat-icon></span>
          <span class="motes xp-motes">
            @for (p of motes; track $index) {
              <span class="mote star" [style.--tx]="px(p.tx)" [style.--ty]="px(p.ty)" [style.--d]="ms(p.d)" [style.--s]="p.s"></span>
            }
          </span>
        }

        @case ('warp') {
          <span class="swirl"></span>
          <span class="swirl swirl2"></span>
          <span class="disc blink"><mat-icon>cyclone</mat-icon></span>
        }

        @case ('curse') {
          <span class="hex"></span>
          <span class="hex hex2"></span>
          <span class="disc sicken"><mat-icon>dangerous</mat-icon></span>
        }

        @case ('hurt') {
          <span class="crack"></span>
          <span class="disc hit"><mat-icon>heart_broken</mat-icon></span>
          <span class="flash hurt-flash"></span>
        }

        @case ('theft') {
          <span class="coins steal">
            @for (p of coins; track $index) {
              <img
                class="coin fly"
                src="undercity/icons/rot.png"
                alt=""
                [style.--tx]="px(p.tx)"
                [style.--d]="ms(p.d)"
                [style.--s]="p.s"
              />
            }
          </span>
          <span class="disc"><mat-icon>money_off</mat-icon></span>
        }

        @default {
          <span class="disc shimmer"><mat-icon>help</mat-icon></span>
        }
      }
    </div>
  `,
  styles: [
    `
      :host {
        display: block;
      }
      .mfx {
        position: relative;
        width: 136px;
        height: 104px;
        margin: 0 auto;
        display: flex;
        align-items: center;
        justify-content: center;
        overflow: visible;
      }

      /* ── Shared reveal disc ─────────────────────────────────────────────── */
      .disc {
        position: relative;
        z-index: 3;
        width: 64px;
        height: 64px;
        border-radius: 50%;
        display: flex;
        align-items: center;
        justify-content: center;
        color: #12100e;
        background: radial-gradient(
          circle at 35% 30%,
          color-mix(in srgb, var(--tint) 70%, #fff),
          var(--tint)
        );
        box-shadow:
          0 6px 18px rgba(0, 0, 0, 0.5),
          0 0 22px color-mix(in srgb, var(--tint) 55%, transparent),
          inset 0 2px 0 rgba(255, 255, 255, 0.35);
        animation: disc-in 0.5s cubic-bezier(0.2, 1.6, 0.35, 1) both;
      }
      .disc mat-icon {
        font-size: 38px;
        width: 38px;
        height: 38px;
        filter: drop-shadow(0 1px 1px rgba(0, 0, 0, 0.35));
      }
      @keyframes disc-in {
        0% { opacity: 0; transform: scale(0.2) translateY(6px); }
        60% { opacity: 1; }
        100% { opacity: 1; transform: none; }
      }

      /* Shockwave rings behind everything. */
      .ring {
        position: absolute;
        z-index: 1;
        width: 60px;
        height: 60px;
        border-radius: 50%;
        border: 2px solid color-mix(in srgb, var(--tint) 70%, transparent);
        opacity: 0;
        animation: ring-out 0.9s ease-out 0.05s forwards;
      }
      .ring2 {
        animation-delay: 0.24s;
        border-width: 1px;
      }
      @keyframes ring-out {
        0% { opacity: 0.85; transform: scale(0.3); }
        100% { opacity: 0; transform: scale(2.4); }
      }

      /* ── Coin fountain (jackpot) / coin theft ───────────────────────────── */
      .coins {
        position: absolute;
        inset: 0;
        z-index: 4;
        pointer-events: none;
      }
      .coin {
        position: absolute;
        left: 50%;
        top: 52%;
        width: 20px;
        height: 20px;
        margin: -10px 0 0 -10px;
        image-rendering: pixelated;
        opacity: 0;
        animation: coin-fountain 1.1s ease-out var(--d) forwards;
        transform-origin: center;
      }
      @keyframes coin-fountain {
        0% { opacity: 0; transform: translate(0, 0) scale(0.4); }
        20% { opacity: 1; }
        60% { opacity: 1; transform: translate(var(--tx), var(--ty)) scale(var(--s)); }
        100% { opacity: 0; transform: translate(calc(var(--tx) * 1.1), 34px) scale(var(--s)); }
      }
      .coin.fly {
        top: 50%;
        animation: coin-steal 0.8s ease-in var(--d) forwards;
      }
      @keyframes coin-steal {
        0% { opacity: 0; transform: translate(0, 0) scale(var(--s)); }
        25% { opacity: 1; }
        100% { opacity: 0; transform: translate(var(--tx), -46px) scale(0.4); }
      }
      .flash {
        position: absolute;
        z-index: 2;
        width: 80px;
        height: 80px;
        border-radius: 50%;
        background: radial-gradient(circle, color-mix(in srgb, var(--tint) 80%, #fff) 0%, transparent 65%);
        opacity: 0;
        animation: flash 0.5s ease-out 0.12s forwards;
      }
      @keyframes flash {
        0% { opacity: 0; transform: scale(0.4); }
        35% { opacity: 0.9; }
        100% { opacity: 0; transform: scale(1.6); }
      }
      .jackpot-disc {
        animation:
          disc-in 0.5s cubic-bezier(0.2, 1.6, 0.35, 1) both,
          jackpot-wobble 0.5s ease 0.5s 2;
      }
      @keyframes jackpot-wobble {
        0%, 100% { transform: rotate(0); }
        25% { transform: rotate(-7deg); }
        75% { transform: rotate(7deg); }
      }

      /* ── Gear glint ─────────────────────────────────────────────────────── */
      .sparks,
      .charge {
        position: absolute;
        inset: 0;
        z-index: 2;
        pointer-events: none;
      }
      .spark {
        position: absolute;
        left: 50%;
        top: 50%;
        width: 6px;
        height: 6px;
        border-radius: 50%;
        background: color-mix(in srgb, var(--tint) 60%, #fff);
        opacity: 0;
        animation: spark-out 0.7s ease-out var(--d) forwards;
      }
      @keyframes spark-out {
        0% { opacity: 1; transform: translate(0, 0) scale(1); }
        100% { opacity: 0; transform: translate(var(--tx), var(--ty)) scale(0.2); }
      }
      .disc.lift {
        animation:
          disc-in 0.5s cubic-bezier(0.2, 1.6, 0.35, 1) both,
          lift 2.4s ease-in-out 0.5s 1;
      }
      @keyframes lift {
        0%, 100% { transform: translateY(0); }
        50% { transform: translateY(-6px); }
      }
      .glint {
        position: absolute;
        z-index: 5;
        width: 64px;
        height: 64px;
        border-radius: 50%;
        overflow: hidden;
        pointer-events: none;
      }
      .glint::after {
        content: '';
        position: absolute;
        top: -20%;
        left: -60%;
        width: 40%;
        height: 140%;
        background: linear-gradient(90deg, transparent, rgba(255, 255, 255, 0.85), transparent);
        transform: rotate(18deg);
        animation: glint-sweep 1.1s ease-in-out 0.6s 2;
      }
      @keyframes glint-sweep {
        0% { left: -60%; }
        100% { left: 130%; }
      }

      /* ── Motes (grimoire / spores / xp / heal) ──────────────────────────── */
      .motes {
        position: absolute;
        inset: 0;
        z-index: 4;
        pointer-events: none;
      }
      .mote {
        position: absolute;
        left: 50%;
        top: 56%;
        width: 8px;
        height: 8px;
        border-radius: 50%;
        background: color-mix(in srgb, var(--tint) 70%, #fff);
        box-shadow: 0 0 6px color-mix(in srgb, var(--tint) 80%, transparent);
        opacity: 0;
        animation: mote-rise 1.8s ease-out var(--d) forwards;
      }
      .mote.star {
        border-radius: 1px;
        transform: rotate(45deg);
      }
      @keyframes mote-rise {
        0% { opacity: 0; transform: translate(0, 0) scale(0); }
        25% { opacity: 1; transform: translate(calc(var(--tx) * 0.4), calc(var(--ty) * 0.3)) scale(var(--s)); }
        100% { opacity: 0; transform: translate(var(--tx), var(--ty)) scale(0.2); }
      }
      .disc.drift {
        animation:
          disc-in 0.5s cubic-bezier(0.2, 1.6, 0.35, 1) both,
          drift 3s ease-in-out 0.5s 1;
      }
      @keyframes drift {
        0%, 100% { transform: translateY(0); }
        50% { transform: translateY(-3px); }
      }

      /* ── Item pop ───────────────────────────────────────────────────────── */
      .disc.pack {
        animation:
          disc-in 0.5s cubic-bezier(0.2, 1.6, 0.35, 1) both,
          pack-shake 0.4s ease 0.5s 2;
      }
      @keyframes pack-shake {
        0%, 100% { transform: translateY(0); }
        50% { transform: translateY(-4px) scale(1.04); }
      }
      .pop-icon {
        position: absolute;
        z-index: 5;
        top: 8px;
        display: flex;
        align-items: center;
        justify-content: center;
        color: color-mix(in srgb, var(--tint) 55%, #fff);
        opacity: 0;
        animation: pop-out 1.1s cubic-bezier(0.2, 1.5, 0.4, 1) 0.7s forwards;
      }
      .pop-icon mat-icon {
        font-size: 28px;
        width: 28px;
        height: 28px;
        filter: drop-shadow(0 2px 4px rgba(0, 0, 0, 0.6));
      }
      @keyframes pop-out {
        0% { opacity: 0; transform: translateY(18px) scale(0.4); }
        50% { opacity: 1; transform: translateY(-14px) scale(1.1); }
        100% { opacity: 1; transform: translateY(-18px) scale(1); }
      }

      /* ── Heal ───────────────────────────────────────────────────────────── */
      .bloom {
        position: absolute;
        z-index: 2;
        width: 70px;
        height: 70px;
        border-radius: 50%;
        background: radial-gradient(circle, color-mix(in srgb, var(--tint) 75%, #fff) 0%, transparent 68%);
        opacity: 0;
        animation: bloom 1.4s ease-out 0.1s forwards;
      }
      @keyframes bloom {
        0% { opacity: 0; transform: scale(0.3); }
        40% { opacity: 0.8; }
        100% { opacity: 0; transform: scale(1.5); }
      }
      .disc.pulse {
        animation:
          disc-in 0.5s cubic-bezier(0.2, 1.6, 0.35, 1) both,
          heart-pulse 0.85s ease-in-out 0.5s 3;
      }
      @keyframes heart-pulse {
        0%, 100% { transform: scale(1); }
        30% { transform: scale(1.14); }
        60% { transform: scale(0.98); }
      }

      /* ── Buff surge ─────────────────────────────────────────────────────── */
      .bolt-in {
        position: absolute;
        left: 50%;
        top: 50%;
        width: 4px;
        height: 16px;
        margin: -8px 0 0 -2px;
        background: color-mix(in srgb, var(--tint) 70%, #fff);
        border-radius: 2px;
        opacity: 0;
        animation: bolt-in 0.55s ease-in var(--d) forwards;
      }
      @keyframes bolt-in {
        0% { opacity: 0; transform: translate(var(--tx), var(--ty)) scale(0.4); }
        70% { opacity: 1; }
        100% { opacity: 0; transform: translate(0, 0) scale(1); }
      }
      .disc.surge {
        animation:
          disc-in 0.5s cubic-bezier(0.2, 1.6, 0.35, 1) both,
          surge 0.5s ease 0.55s 2;
      }
      @keyframes surge {
        0%, 100% {
          box-shadow:
            0 6px 18px rgba(0, 0, 0, 0.5),
            0 0 22px color-mix(in srgb, var(--tint) 55%, transparent);
        }
        50% {
          box-shadow:
            0 6px 18px rgba(0, 0, 0, 0.5),
            0 0 40px color-mix(in srgb, var(--tint) 95%, transparent);
          transform: scale(1.08);
        }
      }

      /* ── Warp swirl ─────────────────────────────────────────────────────── */
      .swirl {
        position: absolute;
        z-index: 2;
        width: 84px;
        height: 84px;
        border-radius: 50%;
        border: 3px dashed color-mix(in srgb, var(--tint) 70%, transparent);
        border-right-color: transparent;
        border-bottom-color: transparent;
        opacity: 0;
        animation: swirl 1.6s ease-in-out 0.1s forwards;
      }
      .swirl2 {
        width: 56px;
        height: 56px;
        animation-direction: reverse;
        animation-delay: 0.2s;
      }
      @keyframes swirl {
        0% { opacity: 0; transform: rotate(0) scale(1.1); }
        30% { opacity: 0.9; }
        100% { opacity: 0; transform: rotate(540deg) scale(0.4); }
      }
      .disc.blink {
        animation:
          disc-in 0.5s cubic-bezier(0.2, 1.6, 0.35, 1) both,
          blink 1.3s ease-in-out 0.5s 1;
      }
      @keyframes blink {
        0%, 100% { opacity: 1; transform: scale(1); }
        45% { opacity: 0; transform: scale(0.2) rotate(180deg); }
        55% { opacity: 0; transform: scale(0.2) rotate(200deg); }
      }

      /* ── Curse hex ──────────────────────────────────────────────────────── */
      .hex {
        position: absolute;
        z-index: 2;
        width: 92px;
        height: 92px;
        border-radius: 50%;
        border: 2px solid color-mix(in srgb, var(--tint) 75%, transparent);
        opacity: 0;
        animation: hex-in 1.3s ease-in 0.05s forwards;
      }
      .hex2 {
        width: 66px;
        height: 66px;
        border-style: dotted;
        animation-delay: 0.22s;
      }
      @keyframes hex-in {
        0% { opacity: 0; transform: scale(1.5) rotate(0); }
        60% { opacity: 0.9; }
        100% { opacity: 0.15; transform: scale(1) rotate(120deg); }
      }
      .disc.sicken {
        animation:
          disc-in 0.5s cubic-bezier(0.2, 1.6, 0.35, 1) both,
          sicken 1s ease-in-out 0.5s 2;
      }
      @keyframes sicken {
        0%, 100% { filter: none; transform: scale(1); }
        50% { filter: hue-rotate(-15deg) brightness(0.9); transform: scale(0.96); }
      }

      /* ── Hurt impact ────────────────────────────────────────────────────── */
      .crack {
        position: absolute;
        z-index: 5;
        width: 80px;
        height: 80px;
        opacity: 0;
        background:
          linear-gradient(90deg, transparent 48%, color-mix(in srgb, var(--tint) 85%, #fff) 49% 51%, transparent 52%),
          linear-gradient(35deg, transparent 48%, color-mix(in srgb, var(--tint) 85%, #fff) 49% 51%, transparent 52%);
        animation: crack 0.5s ease-out 0.2s forwards;
      }
      @keyframes crack {
        0% { opacity: 0; transform: scale(0.4); }
        40% { opacity: 1; }
        100% { opacity: 0; transform: scale(1.3); }
      }
      .disc.hit {
        animation:
          disc-in 0.5s cubic-bezier(0.2, 1.6, 0.35, 1) both,
          shake 0.45s cubic-bezier(0.36, 0.07, 0.19, 0.97) 0.5s 1;
      }
      @keyframes shake {
        0%, 100% { transform: translate(0, 0); }
        20% { transform: translate(-5px, 2px); }
        40% { transform: translate(5px, -2px); }
        60% { transform: translate(-4px, 1px); }
        80% { transform: translate(3px, -1px); }
      }
      .hurt-flash {
        animation: flash 0.4s ease-out 0.15s forwards;
      }

      /* ── Default mystery shimmer ────────────────────────────────────────── */
      .disc.shimmer {
        animation:
          disc-in 0.5s cubic-bezier(0.2, 1.6, 0.35, 1) both,
          shimmer 2.4s ease-in-out 0.5s 2;
      }
      @keyframes shimmer {
        0%, 100% {
          box-shadow:
            0 6px 18px rgba(0, 0, 0, 0.5),
            0 0 20px color-mix(in srgb, var(--tint) 45%, transparent);
        }
        50% {
          box-shadow:
            0 6px 18px rgba(0, 0, 0, 0.5),
            0 0 34px color-mix(in srgb, var(--tint) 85%, transparent);
        }
      }

      /* Respect reduced-motion: show the settled disc, drop the motion. */
      @media (prefers-reduced-motion: reduce) {
        .mfx * {
          animation: none !important;
        }
        .coins,
        .motes,
        .sparks,
        .charge,
        .ring,
        .flash,
        .swirl,
        .hex,
        .crack,
        .bloom,
        .glint,
        .pop-icon {
          display: none;
        }
        .disc {
          opacity: 1;
          transform: none;
        }
      }
    `,
  ],
})
export class MysteryFxComponent {
  private readonly _outcome = signal<string>('mystery');

  @Input({ required: true }) set outcome(v: string) {
    this._outcome.set(v || 'mystery');
  }

  /** Resolved outcome key — falls back to the neutral `mystery` scene. */
  protected readonly key = computed(() =>
    MYSTERY_SYMBOLS[this._outcome()] ? this._outcome() : 'mystery',
  );
  protected readonly sym = computed(() => MYSTERY_SYMBOLS[this.key()]);

  // Unit helpers for custom-property bindings (Angular won't append units to
  // custom props, so we pre-suffix — same pattern as the reveal reel).
  protected readonly px = px;
  protected readonly ms = ms;

  // Particle sets generated once; per-outcome scenes pick what they need.
  protected readonly coins = burst(12, 30, 62, 20);
  protected readonly sparks = burst(14, 26, 52);
  protected readonly motes = rise(14);
}
