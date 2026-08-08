import { Component, Input, computed, signal } from '@angular/core';
import { CommonModule } from '@angular/common';
import { MatIconModule } from '@angular/material/icon';
import { MYSTERY_SYMBOLS } from '../data/mystery-symbols';

/** Per-outcome casting: the actor sprite (if any). Actors are plain PNGs under
 *  public/undercity/; solo outcomes have none. */
interface SkitSpec {
  actor: string | null;
}

const SKITS: Record<string, SkitSpec> = {
  theft: { actor: 'enemies/fetid_imp' },
  hurt: { actor: 'enemies/dreg_mangler' },
  curse: { actor: 'enemies/acolyte_of_affliction' },
  item: { actor: 'map_events/shopkeeper1' },
  grimoire: { actor: 'enemies/hag_hedgemage' },
  heal: { actor: 'enemies/myconid' },
  jackpot: { actor: null },
  spores: { actor: null },
  xp: { actor: null },
  gear: { actor: null },
  buff: { actor: null },
  warp: { actor: null },
  mystery: { actor: null },
};

interface Bit {
  x: number; // horizontal offset px from center
  d: number; // delay ms
  s: number; // scale
}

const rnd = (a: number, b: number) => a + Math.random() * (b - a);
const bits = (n: number, spread: number): Bit[] =>
  Array.from({ length: n }, () => ({
    x: Math.round(rnd(-spread, spread)),
    d: Math.round(rnd(0, 700)),
    s: +rnd(0.6, 1.1).toFixed(2),
  }));

const pxv = (n: number) => `${n}px`;
const msv = (n: number) => `${n}ms`;

/**
 * Mystery-event payoff **skit** — a short scripted scene starring the player's
 * actual recolored creature. An outcome-specific actor (imp, shopkeeper, hag…)
 * enters and plays out the flavor while the creature reacts.
 *
 * Expressiveness rests on animation-principle fundamentals rather than extra
 * art (the sprites are single-pose):
 *   • squash & stretch — the img scales from a bottom anchor (anticipate, leap,
 *     land) while the slot handles the vertical arc, so motion has weight;
 *   • ground shadow — an ellipse that shrinks/fades as the creature rises;
 *   • anticipation + follow-through + hit-stop — brief holds and overshoots;
 *   • screen shake on impacts;
 *   • living emotes — a Material glyph that pops in with a shake.
 *
 * The stage is a transparent DOM layer sized to fill the event-card banner; the
 * card's background image shows through. Horizontal positions are center-
 * anchored (left: 50%), so the choreography holds at any card width up to the
 * stage max. ~4.5s of scripted beats, then the creature settles into a gentle
 * idle bob — non-blocking; the card text reads underneath. Falls back to the
 * abstract MysteryFxComponent (in the card template) when no creature art is
 * available.
 */
@Component({
  selector: 'app-undercity-mystery-skit',
  standalone: true,
  imports: [CommonModule, MatIconModule],
  template: `
    <div class="skit" [attr.data-fx]="key()" [style.--tint]="sym().color">
      <div class="stage">
        <!-- Actor (imp / shopkeeper / hag …) enters and acts. -->
        @if (spec().actor) {
          <img class="actor" [src]="'undercity/' + spec().actor + '.png'" alt="" />
        }

        <!-- Outcome-specific props / particles. -->
        @switch (key()) {
          @case ('theft') {
            <img class="coin steal-coin" src="undercity/icons/rot.png" alt="" />
            <span class="dust"></span>
          }
          @case ('jackpot') {
            @for (b of rain; track $index) {
              <img class="coin rain" src="undercity/icons/rot.png" alt=""
                [style.--x]="px(b.x)" [style.--d]="ms(b.d)" [style.--s]="b.s" />
            }
            <span class="rays"></span>
            <span class="dust"></span>
          }
          @case ('spores') {
            @for (b of motes; track $index) {
              <span class="mote in" [style.--x]="px(b.x)" [style.--d]="ms(b.d)" [style.--s]="b.s"></span>
            }
          }
          @case ('heal') {
            <span class="bloom"></span>
            @for (b of motes; track $index) {
              <span class="mote fall heal" [style.--x]="px(b.x)" [style.--d]="ms(b.d)" [style.--s]="b.s"></span>
            }
          }
          @case ('xp') {
            <span class="beam"></span>
            <span class="ring lvl"></span>
            @for (b of motes; track $index) {
              <span class="mote spiral" [style.--x]="px(b.x)" [style.--d]="ms(b.d)" [style.--s]="b.s"></span>
            }
          }
          @case ('buff') {
            @for (b of motes; track $index) {
              <span class="bolt-in" [style.--x]="px(b.x)" [style.--d]="ms(b.d)"></span>
            }
            <span class="ring"></span>
            <span class="aura"></span>
          }
          @case ('gear') {
            <span class="drop-icon"><mat-icon>shield</mat-icon></span>
            <span class="ring slam"></span>
            <span class="glint"></span>
          }
          @case ('grimoire') {
            <span class="float-icon"><mat-icon>menu_book</mat-icon></span>
          }
          @case ('item') {
            <span class="hand-icon"><mat-icon>backpack</mat-icon></span>
            <span class="starburst"></span>
          }
          @case ('curse') {
            <span class="hex"></span>
            <span class="hex hex2"></span>
            <span class="sweat"></span>
          }
          @case ('warp') {
            <span class="swirl"></span>
            <span class="swirl swirl2"></span>
          }
          @case ('hurt') {
            <span class="slash"></span>
          }
          @default {
            <span class="q-orb"><mat-icon>help</mat-icon></span>
            <span class="q-orb q2"><mat-icon>help</mat-icon></span>
          }
        }

        <!-- Ground shadow (grounds the creature; shrinks as it rises). -->
        <span class="shadow"></span>

        <!-- The star: the player's real recolored creature. -->
        <div class="creature-slot">
          @if (creatureUrl) {
            <img class="creature" [src]="creatureUrl" alt="" />
          }
        </div>
      </div>
    </div>
  `,
  styles: [
    `
      :host { display: block; width: 100%; }
      .skit { width: 100%; display: flex; justify-content: center; }
      /* Transparent stage that fills the banner; the card bg shows through.
         Center-anchored coordinate system, capped so choreography stays sane. */
      .stage {
        position: relative;
        width: 100%;
        max-width: 380px;
        height: 176px;
        overflow: hidden;
      }

      /* ── Creature + ground shadow ───────────────────────────────────────── */
      .creature-slot {
        position: absolute;
        left: 50%;
        bottom: 18px;
        width: 118px;
        margin-left: -59px;
        height: 118px;
        display: flex;
        align-items: flex-end;
        justify-content: center;
        animation: idle-bob 2.6s ease-in-out infinite;
        z-index: 3;
      }
      .creature {
        max-width: 100%;
        max-height: 118px;
        image-rendering: pixelated;
        transform-origin: 50% 100%; /* squash/stretch keeps feet planted */
        filter: drop-shadow(0 4px 3px rgba(0, 0, 0, 0.4));
      }
      @keyframes idle-bob {
        0%, 100% { transform: translateY(0); }
        50% { transform: translateY(-4px); }
      }
      .shadow {
        position: absolute;
        left: 50%;
        bottom: 13px;
        width: 96px;
        height: 18px;
        margin-left: -48px;
        border-radius: 50%;
        background: radial-gradient(circle, rgba(0, 0, 0, 0.42), transparent 72%);
        z-index: 2;
        animation: shadow-bob 2.6s ease-in-out infinite;
      }
      @keyframes shadow-bob {
        0%, 100% { transform: scale(1); opacity: 0.9; }
        50% { transform: scale(0.9); opacity: 0.75; }
      }

      /* ── Actor (center-anchored; enters from off-stage ±260px) ──────────── */
      .actor {
        position: absolute;
        left: 50%;
        bottom: 34px;
        margin-left: -46px;
        height: 92px;
        image-rendering: pixelated;
        filter: drop-shadow(0 4px 3px rgba(0, 0, 0, 0.45));
        z-index: 4;
        opacity: 0;
      }

      /* ── Coins / motes / shared props ───────────────────────────────────── */
      .coin { position: absolute; width: 24px; height: 24px; image-rendering: pixelated; z-index: 5; }
      .mote {
        position: absolute;
        left: 50%;
        bottom: 34px;
        width: 9px;
        height: 9px;
        border-radius: 50%;
        background: color-mix(in srgb, var(--tint) 70%, #fff);
        box-shadow: 0 0 6px color-mix(in srgb, var(--tint) 80%, transparent);
        opacity: 0;
        z-index: 2;
      }
      .ring, .bloom, .aura, .beam, .rays {
        position: absolute;
        left: 50%;
        bottom: 46px;
        transform: translate(-50%, 50%);
        z-index: 2;
        opacity: 0;
        pointer-events: none;
      }
      .ring {
        width: 92px; height: 92px; border-radius: 50%;
        border: 2px solid color-mix(in srgb, var(--tint) 70%, transparent);
        animation: ring-out 1s ease-out 0.3s 2;
      }
      .bloom {
        width: 124px; height: 124px; border-radius: 50%;
        background: radial-gradient(circle, rgba(150, 230, 160, 0.7) 0%, transparent 68%);
        animation: bloom 1.8s ease-out 0.4s forwards;
      }
      @keyframes ring-out {
        0% { opacity: 0.8; transform: translate(-50%, 50%) scale(0.3); }
        100% { opacity: 0; transform: translate(-50%, 50%) scale(1.5); }
      }
      @keyframes bloom {
        0% { opacity: 0; transform: translate(-50%, 50%) scale(0.3); }
        40% { opacity: 0.7; }
        100% { opacity: 0; transform: translate(-50%, 50%) scale(1.3); }
      }

      /* Prop icons. */
      .drop-icon, .float-icon, .hand-icon, .q-orb {
        position: absolute; z-index: 5;
        display: flex; align-items: center; justify-content: center;
        color: color-mix(in srgb, var(--tint) 55%, #fff);
      }
      .drop-icon mat-icon, .float-icon mat-icon, .hand-icon mat-icon, .q-orb mat-icon {
        font-size: 38px; width: 38px; height: 38px;
        filter: drop-shadow(0 2px 4px rgba(0, 0, 0, 0.6));
      }

      /* Landing dust puff. */
      .dust {
        position: absolute; left: 50%; bottom: 14px; margin-left: -30px;
        width: 60px; height: 15px; border-radius: 50%;
        background: radial-gradient(circle, rgba(220, 210, 190, 0.5), transparent 70%);
        opacity: 0; z-index: 2;
      }

      /* ════════ Per-outcome choreography ═══════════════════════════════════ */

      /* THEFT — creature idles facing left; imp swoops from the right with a
         wind-up, snatches a coin (parabola), flees; creature anticipates, leaps
         + turns around with squash-land, then droops (pats empty pocket). */
      .skit[data-fx='theft'] .creature { animation: theft-react 2.6s ease-in-out 1.05s both; }
      @keyframes theft-react {
        0% { transform: scaleX(-1) scaleY(1); }
        14% { transform: scale(-1, 0.82); }
        26% { transform: scale(-1, 1.16); }
        34% { transform: scale(1, 1.12); }
        50% { transform: scale(1, 0.86); }
        62% { transform: scale(1, 1.03); }
        74% { transform: scale(1, 1) rotate(0); }
        100% { transform: scale(1, 0.97) rotate(4deg); }
      }
      .skit[data-fx='theft'] .creature-slot {
        animation: idle-bob 2.6s ease-in-out infinite, theft-hop 1s cubic-bezier(0.3, 1.2, 0.4, 1) 1.2s 1;
      }
      @keyframes theft-hop {
        0%, 100% { transform: translateY(0); }
        30% { transform: translateY(-22px); }
        55% { transform: translateY(-2px); }
      }
      .skit[data-fx='theft'] .shadow { animation: shadow-bob 2.6s ease-in-out infinite, jump-shadow 1s ease 1.2s 1; }
      .skit[data-fx='theft'] .actor { bottom: 74px; animation: imp-raid 2.6s ease-in-out 0.35s forwards; }
      @keyframes imp-raid {
        0% { opacity: 0; transform: translateX(260px) scaleX(-1); }
        20% { opacity: 1; transform: translateX(78px) scaleX(-1); }
        30% { transform: translateX(88px) scaleX(-1) rotate(6deg); }
        42% { transform: translateX(56px) scaleX(-1) rotate(-4deg); }
        100% { opacity: 0; transform: translateX(300px) translateY(-70px) scaleX(-1) rotate(8deg); }
      }
      .skit[data-fx='theft'] .steal-coin {
        left: 50%; bottom: 56px; margin-left: -12px;
        animation: coin-snatch 2.6s cubic-bezier(0.4, 0, 0.7, 1) 0.35s forwards;
        filter: drop-shadow(0 0 5px rgba(224, 192, 105, 0.85));
      }
      @keyframes coin-snatch {
        0%, 38% { opacity: 0; transform: translate(0, 0) scale(0.8); }
        44% { opacity: 1; transform: translate(30px, -6px) scale(1); }
        70% { transform: translate(130px, -60px) scale(0.9); }
        100% { opacity: 0; transform: translate(250px, -28px) scale(0.7); }
      }
      .skit[data-fx='theft'] .dust { animation: puff 0.5s ease-out 1.55s forwards; }

      /* HURT — enemy telegraphs then lunges with stretch; creature hit-stops,
         red-flashes, gets knocked back, recovers. Screen shakes. */
      .skit[data-fx='hurt'] .stage { animation: stage-shake 0.4s ease 1.32s 1; }
      .skit[data-fx='hurt'] .actor { bottom: 46px; animation: swipe-in 1.8s ease-in-out 0.35s forwards; }
      @keyframes swipe-in {
        0% { opacity: 0; transform: translateX(-260px); }
        24% { opacity: 1; transform: translateX(-84px); }
        34% { transform: translateX(-102px) scaleX(0.9); }
        44% { transform: translateX(-44px) scaleX(1.15); }
        100% { opacity: 0; transform: translateX(-260px); }
      }
      .skit[data-fx='hurt'] .creature { animation: hurt-react 1.4s ease-out 1.3s both; }
      @keyframes hurt-react {
        0% { transform: translateX(0) scale(1); filter: none; }
        6% { transform: translateX(0) scale(1.04, 0.92); filter: brightness(3) sepia(1) hue-rotate(-30deg) saturate(6); }
        14% { transform: translateX(22px) scale(0.94, 1.06); filter: none; }
        30% { transform: translateX(-5px) scale(1); }
        45% { transform: translateX(3px); }
        100% { transform: translateX(0) scale(1); }
      }
      .skit[data-fx='hurt'] .slash {
        position: absolute; left: 50%; bottom: 62px; margin-left: -32px;
        width: 64px; height: 64px; z-index: 5; opacity: 0;
        background: linear-gradient(60deg, transparent 45%, #ff6b6b 47% 53%, transparent 55%);
        animation: slash 0.45s ease-out 1.28s forwards;
      }
      @keyframes slash {
        0% { opacity: 0; transform: scale(0.4) rotate(-10deg); }
        40% { opacity: 1; }
        100% { opacity: 0; transform: scale(1.4) rotate(8deg); }
      }

      /* CURSE — acolyte enters, charges, casts a tightening hex; creature wilts
         (desaturates, sinks) with a sweat-drop. */
      .skit[data-fx='curse'] .actor { bottom: 40px; animation: cast-in 2.6s ease-in-out 0.3s forwards; }
      @keyframes cast-in {
        0% { opacity: 0; transform: translateX(-260px); }
        26% { opacity: 1; transform: translateX(-92px); }
        40% { transform: translateX(-92px) translateY(-5px); }
        70% { opacity: 1; transform: translateX(-92px); }
        100% { opacity: 0; transform: translateX(-260px); }
      }
      .skit[data-fx='curse'] .creature { animation: wilt 2s ease-in-out 1.2s both; }
      @keyframes wilt {
        0% { transform: scale(1); filter: none; }
        20% { transform: translateX(5px) scale(1.02, 0.96); }
        55% { transform: scale(0.96, 0.9); filter: hue-rotate(-40deg) saturate(1.7) brightness(0.8); }
        100% { transform: scale(0.98, 0.94); filter: hue-rotate(-24deg) saturate(1.4) brightness(0.86); }
      }
      .hex {
        position: absolute; left: 50%; bottom: 46px;
        width: 112px; height: 112px; margin-left: -56px;
        border-radius: 50%;
        border: 2px solid color-mix(in srgb, var(--tint) 78%, transparent);
        transform: translateY(50%); opacity: 0; z-index: 2;
        animation: hex-in 1.7s ease-in 1.05s forwards;
      }
      .hex2 { width: 72px; height: 72px; margin-left: -36px; border-style: dotted; animation-delay: 1.2s; }
      @keyframes hex-in {
        0% { opacity: 0; transform: translateY(50%) scale(1.7) rotate(0); }
        50% { opacity: 0.9; }
        100% { opacity: 0.12; transform: translateY(50%) scale(1) rotate(150deg); }
      }
      .sweat {
        position: absolute; left: 56%; top: 40px;
        width: 7px; height: 11px; border-radius: 0 50% 50% 50%;
        background: #bfe0ff; transform: rotate(45deg); opacity: 0; z-index: 6;
        animation: sweat 1s ease-in 1.6s forwards;
      }
      @keyframes sweat {
        0% { opacity: 0; transform: rotate(45deg) translateY(-4px); }
        30% { opacity: 0.9; }
        100% { opacity: 0; transform: rotate(45deg) translateY(16px); }
      }

      /* ITEM / GRIMOIRE — vendor walks in (2-step bob), hands over; creature
         leans in eager, receives with a pop. */
      .skit[data-fx='item'] .actor { bottom: 30px; animation: vendor-walk 2.9s ease-in-out 0.3s forwards; }
      .skit[data-fx='grimoire'] .actor { bottom: 32px; animation: vendor-walk 2.9s ease-in-out 0.3s forwards; }
      @keyframes vendor-walk {
        0% { opacity: 0; transform: translateX(-260px) translateY(0); }
        8% { opacity: 1; }
        10% { transform: translateX(-224px) translateY(-3px); }
        16% { transform: translateX(-188px) translateY(0); }
        22% { transform: translateX(-152px) translateY(-3px); }
        27% { transform: translateX(-116px) translateY(0); }
        73% { opacity: 1; transform: translateX(-116px) translateY(0); }
        80% { transform: translateX(-150px) translateY(-3px); }
        100% { opacity: 0; transform: translateX(-260px) translateY(0); }
      }
      .skit[data-fx='item'] .creature,
      .skit[data-fx='grimoire'] .creature { animation: eager 2.2s ease-out 1.05s both; }
      @keyframes eager {
        0% { transform: rotate(0) scale(1); }
        20% { transform: rotate(-6deg) scale(1.02); }
        44% { transform: rotate(0) scale(1.08, 0.96); }
        58% { transform: scale(0.98, 1.03); }
        75% { transform: rotate(4deg) scale(1); }
        100% { transform: rotate(0) scale(1); }
      }
      .hand-icon {
        left: 50%; bottom: 70px; margin-left: -19px; opacity: 0;
        animation: handover 1.6s cubic-bezier(0.2, 1.5, 0.4, 1) 1.1s forwards;
      }
      @keyframes handover {
        0% { opacity: 0; transform: translate(-40px, 6px) scale(0.5); }
        50% { opacity: 1; transform: translate(0, -8px) scale(1.15); }
        100% { opacity: 1; transform: translate(26px, 0) scale(1); }
      }
      .float-icon {
        left: 50%; bottom: 74px; margin-left: -19px; opacity: 0;
        animation: float-book 2.1s ease-in-out 1.1s forwards;
      }
      @keyframes float-book {
        0% { opacity: 0; transform: translate(-34px, 4px) scale(0.6); }
        45% { opacity: 1; transform: translate(0, -8px) scale(1.12) rotate(-5deg); }
        70% { transform: translate(0, -10px) scale(1) rotate(5deg); }
        100% { opacity: 1; transform: translate(0, -6px) scale(1) rotate(0); }
      }
      .starburst {
        position: absolute; left: 50%; bottom: 78px; margin-left: -26px;
        width: 52px; height: 52px; z-index: 4; opacity: 0;
        background:
          conic-gradient(from 0deg, transparent 0 8%, rgba(255, 255, 255, 0.85) 9% 11%, transparent 12% 100%),
          conic-gradient(from 45deg, transparent 0 8%, rgba(255, 255, 255, 0.7) 9% 11%, transparent 12% 100%);
        border-radius: 50%;
        animation: starburst 0.8s ease-out 1.6s forwards;
      }
      @keyframes starburst {
        0% { opacity: 0; transform: scale(0.2) rotate(0); }
        40% { opacity: 1; transform: scale(1) rotate(30deg); }
        100% { opacity: 0; transform: scale(1.4) rotate(60deg); }
      }

      /* HEAL — myconid sprinkles; creature starts droopy then straightens as
         green motes fall onto it. */
      .skit[data-fx='heal'] .actor { bottom: 34px; margin-left: -140px; animation: helper-in 2.9s ease-in-out 0.3s forwards; }
      @keyframes helper-in {
        0% { opacity: 0; transform: translateX(-120px); }
        26% { opacity: 1; transform: translateX(0); }
        40% { transform: translateX(0) rotate(-6deg); }
        52% { transform: translateX(0) rotate(6deg); }
        74% { opacity: 1; transform: translateX(0); }
        100% { opacity: 0; transform: translateX(-120px); }
      }
      .skit[data-fx='heal'] .creature { animation: wilt-bloom 2.6s ease-in-out 0.8s both; }
      @keyframes wilt-bloom {
        0% { transform: scale(0.97, 0.9) rotate(3deg); filter: brightness(0.9) saturate(0.8); }
        45% { transform: scale(0.97, 0.9) rotate(3deg); }
        70% { transform: scale(1.04, 1.02) rotate(0); filter: none; }
        100% { transform: scale(1) rotate(0); filter: none; }
      }
      .mote.fall { top: 10px; bottom: auto; animation: mote-fall 1.8s ease-in var(--d) forwards; }
      @keyframes mote-fall {
        0% { opacity: 0; transform: translate(var(--x), -6px) scale(var(--s)); }
        20% { opacity: 1; }
        100% { opacity: 0; transform: translate(calc(var(--x) * 0.3), 120px) scale(0.3); }
      }
      .mote.heal { background: #9be89b; box-shadow: 0 0 6px rgba(120, 220, 120, 0.85); }

      /* JACKPOT — anticipation squash → big stretch jump w/ spin → bounce land +
         dust; coins rain and bounce; gold rays. */
      .coin.rain { left: 50%; top: -24px; margin-left: -12px; animation: coin-fall 1.5s cubic-bezier(0.5, 0, 0.9, 0.4) var(--d) forwards; }
      @keyframes coin-fall {
        0% { opacity: 0; transform: translate(var(--x), 0) scale(var(--s)); }
        12% { opacity: 1; }
        60% { transform: translate(var(--x), 128px) scale(var(--s)) rotate(200deg); }
        72% { transform: translate(var(--x), 114px) scale(var(--s)) rotate(230deg); }
        100% { opacity: 0; transform: translate(var(--x), 132px) scale(var(--s)) rotate(300deg); }
      }
      .rays {
        width: 260px; height: 260px;
        background: repeating-conic-gradient(from 0deg, rgba(255, 220, 130, 0.16) 0 8deg, transparent 8deg 20deg);
        border-radius: 50%;
        animation: rays 3s linear 0.5s 1;
      }
      @keyframes rays {
        0% { opacity: 0; transform: translate(-50%, 50%) rotate(0) scale(0.6); }
        25% { opacity: 1; }
        100% { opacity: 0; transform: translate(-50%, 50%) rotate(60deg) scale(1); }
      }
      .skit[data-fx='jackpot'] .stage { animation: stage-shake 0.35s ease 1.5s 1; }
      .skit[data-fx='jackpot'] .creature { animation: joy-squash 1.9s ease-out 0.6s both; }
      @keyframes joy-squash {
        0% { transform: scale(1); }
        12% { transform: scale(1.12, 0.82); }
        26% { transform: scale(0.9, 1.18); }
        45% { transform: scale(1, 1) rotate(360deg); }
        58% { transform: scale(1.18, 0.8); }
        70% { transform: scale(0.95, 1.06); }
        82% { transform: scale(1.05, 0.97); }
        100% { transform: scale(1); }
      }
      .skit[data-fx='jackpot'] .creature-slot { animation: idle-bob 2.6s ease-in-out infinite, joy-jump 1.9s ease-out 0.6s 1; }
      @keyframes joy-jump {
        0%, 58%, 100% { transform: translateY(0); }
        30% { transform: translateY(-40px); }
        44% { transform: translateY(-46px); }
      }
      .skit[data-fx='jackpot'] .shadow { animation: shadow-bob 2.6s ease-in-out infinite, jump-shadow-big 1.9s ease 0.6s 1; }
      .skit[data-fx='jackpot'] .dust { animation: puff 0.5s ease-out 1.5s forwards; }

      /* SPORES — motes spiral inward and get absorbed; creature nuzzles happily */
      .mote.in { animation: mote-in 1.8s ease-in var(--d) forwards; }
      @keyframes mote-in {
        0% { opacity: 0; transform: translate(var(--x), -50px) scale(var(--s)); }
        25% { opacity: 1; }
        100% { opacity: 0; transform: translate(0, 6px) scale(0.2); }
      }
      .skit[data-fx='spores'] .creature { animation: nuzzle 2.4s ease-in-out 0.8s both; }
      @keyframes nuzzle {
        0%, 100% { transform: rotate(0) scale(1); }
        30% { transform: rotate(-5deg) scale(1.03, 0.98); }
        50% { transform: rotate(5deg) scale(1.05, 0.97); }
        70% { transform: rotate(-3deg) scale(1); }
      }

      /* XP — creature rises on a light column; a level ring pulses; sparkles */
      .beam {
        width: 78px; height: 168px; bottom: 12px;
        background: linear-gradient(0deg, rgba(143, 208, 255, 0.5), transparent 85%);
        transform: translate(-50%, 0);
        animation: beam 2.2s ease-out 0.7s forwards;
      }
      @keyframes beam {
        0% { opacity: 0; transform: translate(-50%, 0) scaleY(0.4); }
        30% { opacity: 1; }
        100% { opacity: 0; transform: translate(-50%, 0) scaleY(1); }
      }
      .ring.lvl { animation: ring-out 1.2s ease-out 1.1s 1; }
      .skit[data-fx='xp'] .creature {
        filter: drop-shadow(0 0 8px color-mix(in srgb, var(--tint) 80%, transparent));
        animation: rise-tall 2.4s ease-out 0.9s both;
      }
      @keyframes rise-tall {
        0% { transform: translateY(0) scale(1); }
        40% { transform: translateY(-10px) scale(0.98, 1.08); }
        70% { transform: translateY(-4px) scale(1.02, 1.04); }
        100% { transform: translateY(0) scale(1); }
      }
      .mote.spiral { border-radius: 1px; bottom: 30px; animation: mote-spiral 2.1s ease-out var(--d) forwards; }
      @keyframes mote-spiral {
        0% { opacity: 0; transform: translate(var(--x), 0) scale(0) rotate(45deg); }
        25% { opacity: 1; }
        100% { opacity: 0; transform: translate(calc(var(--x) * -0.5), -74px) scale(var(--s)) rotate(405deg); }
      }

      /* GEAR — shield hovers then slams; impact ring; creature braces + chest-puff */
      .drop-icon { left: 50%; top: 6px; margin-left: -19px; opacity: 0; animation: gear-slam 1.7s ease-in 0.6s forwards; }
      @keyframes gear-slam {
        0% { opacity: 0; transform: translateY(-28px) scale(0.6); }
        25% { opacity: 1; transform: translateY(-8px) scale(1); }
        40% { transform: translateY(-14px) scale(1); }
        52% { transform: translateY(52px) scale(1.05); }
        60% { transform: translateY(48px) scale(1); }
        100% { opacity: 1; transform: translateY(48px) scale(1); }
      }
      .ring.slam { animation: ring-out 0.8s ease-out 1.12s 1; }
      .skit[data-fx='gear'] .stage { animation: stage-shake 0.3s ease 1.12s 1; }
      .skit[data-fx='gear'] .creature { animation: brace-puff 2s ease-out 1.05s both; }
      @keyframes brace-puff {
        0% { transform: scale(1); }
        12% { transform: scale(1.06, 0.9); }
        30% { transform: scale(0.97, 1.05); }
        55% { transform: scale(1.08, 1.02); }
        100% { transform: scale(1); }
      }
      .glint {
        position: absolute; left: 50%; bottom: 54px; margin-left: -40px;
        width: 80px; height: 80px; border-radius: 50%; overflow: hidden; z-index: 5; pointer-events: none;
      }
      .glint::after {
        content: ''; position: absolute; top: -20%; left: -60%; width: 40%; height: 140%;
        background: linear-gradient(90deg, transparent, rgba(255, 255, 255, 0.9), transparent);
        transform: rotate(18deg);
        animation: glint-sweep 0.9s ease-in-out 1.5s 2;
      }
      @keyframes glint-sweep { 0% { left: -60%; } 100% { left: 130%; } }

      /* BUFF — bolts converge during a trembling crouch, then burst + aura */
      .bolt-in {
        position: absolute; left: 50%; bottom: 60px; width: 5px; height: 20px; margin-left: -2px; border-radius: 2px;
        background: color-mix(in srgb, var(--tint) 70%, #fff); opacity: 0; z-index: 2;
        animation: bolt-conv 0.7s ease-in var(--d) forwards;
      }
      @keyframes bolt-conv {
        0% { opacity: 0; transform: translate(var(--x), -14px) scale(0.4); }
        70% { opacity: 1; }
        100% { opacity: 0; transform: translate(0, 0) scale(1); }
      }
      .aura {
        width: 108px; height: 108px; border-radius: 50%;
        background: radial-gradient(circle, color-mix(in srgb, var(--tint) 70%, #fff) 0%, transparent 65%);
        animation: aura 0.7s ease-out 1.4s forwards;
      }
      @keyframes aura {
        0% { opacity: 0; transform: translate(-50%, 50%) scale(0.4); }
        40% { opacity: 0.85; }
        100% { opacity: 0; transform: translate(-50%, 50%) scale(1.5); }
      }
      .skit[data-fx='buff'] .creature { animation: charge-burst 2.2s ease-out 0.7s both; }
      @keyframes charge-burst {
        0% { transform: translate(0, 0) scale(1); }
        20% { transform: translate(-1px, 2px) scale(1.04, 0.94); }
        35% { transform: translate(1px, 2px) scale(1.04, 0.94); }
        45% { transform: translate(-1px, 2px) scale(1.04, 0.94); }
        58% { transform: translate(0, -8px) scale(0.94, 1.12); }
        75% { transform: translate(0, 0) scale(1.04); }
        100% { transform: scale(1); }
      }

      /* WARP — creature is sucked into the vortex, pops out dizzy */
      .swirl {
        position: absolute; left: 50%; bottom: 48px; width: 114px; height: 114px; margin-left: -57px;
        border-radius: 50%;
        border: 3px dashed color-mix(in srgb, var(--tint) 70%, transparent);
        border-right-color: transparent; border-bottom-color: transparent;
        transform: translateY(50%); opacity: 0; z-index: 2;
        animation: swirl 2s ease-in-out 0.3s forwards;
      }
      .swirl2 { width: 72px; height: 72px; margin-left: -36px; animation-direction: reverse; animation-delay: 0.5s; }
      @keyframes swirl {
        0% { opacity: 0; transform: translateY(50%) rotate(0) scale(1.1); }
        30% { opacity: 0.9; }
        100% { opacity: 0; transform: translateY(50%) rotate(600deg) scale(0.4); }
      }
      .skit[data-fx='warp'] .creature { animation: warp-suck 2.4s ease-in-out 0.7s both; }
      @keyframes warp-suck {
        0% { transform: scale(1) rotate(0); }
        30% { transform: scale(0.7, 1.3) rotate(120deg); }
        42% { opacity: 0; transform: scale(0.15) rotate(260deg); }
        56% { opacity: 0; transform: scale(0.15) rotate(300deg); }
        66% { opacity: 1; transform: scale(1.12) rotate(360deg); }
        78% { transform: rotate(354deg); }
        88% { transform: rotate(366deg); }
        100% { transform: scale(1) rotate(360deg); }
      }

      /* MYSTERY — creature tilts its head both ways; ? orbs bob and multiply */
      .q-orb {
        left: 54%; top: 26px; width: 38px; height: 38px; border-radius: 50%;
        background: rgba(20, 16, 26, 0.85);
        border: 1px solid color-mix(in srgb, var(--tint) 60%, transparent);
        opacity: 0; animation: float-q 2.6s ease-in-out 0.6s forwards;
      }
      .q-orb.q2 { left: 38%; top: 16px; transform: scale(0.7); animation-delay: 1.1s; }
      @keyframes float-q {
        0% { opacity: 0; transform: translateY(8px) scale(0.5); }
        30% { opacity: 1; transform: translateY(-5px) scale(1); }
        70% { opacity: 1; transform: translateY(3px) scale(1); }
        100% { opacity: 0.9; transform: translateY(-3px) scale(1); }
      }
      .skit[data-fx='mystery'] .creature { animation: head-tilt 2.4s ease-in-out 0.7s both; }
      @keyframes head-tilt {
        0%, 100% { transform: rotate(0); }
        25% { transform: rotate(-8deg); }
        55% { transform: rotate(9deg); }
        80% { transform: rotate(-3deg); }
      }

      /* ── Shared motion helpers ──────────────────────────────────────────── */
      @keyframes jump-shadow {
        0%, 100% { transform: scale(1); opacity: 0.9; }
        30% { transform: scale(0.55); opacity: 0.4; }
      }
      @keyframes jump-shadow-big {
        0%, 58%, 100% { transform: scale(1); opacity: 0.9; }
        38% { transform: scale(0.4); opacity: 0.3; }
      }
      @keyframes puff {
        0% { opacity: 0; transform: scaleX(0.4); }
        30% { opacity: 0.7; }
        100% { opacity: 0; transform: scaleX(1.5); }
      }
      @keyframes stage-shake {
        0%, 100% { transform: translate(0, 0); }
        20% { transform: translate(-5px, 2px); }
        40% { transform: translate(6px, -2px); }
        60% { transform: translate(-4px, 1px); }
        80% { transform: translate(3px, -1px); }
      }

      /* Reduced motion: freeze to a static staged frame. */
      @media (prefers-reduced-motion: reduce) {
        .stage * { animation: none !important; }
        .actor, .creature-slot, .creature, .shadow, .hand-icon, .float-icon,
        .drop-icon, .q-orb { opacity: 1 !important; transform: none !important; }
        .coin, .mote, .ring, .bloom, .hex, .swirl, .slash, .bolt-in, .glint, .aura,
        .beam, .rays, .dust, .sweat, .starburst { display: none; }
        .creature { filter: none !important; }
      }
    `,
  ],
})
export class MysterySkitComponent {
  private readonly _outcome = signal<string>('mystery');

  @Input({ required: true }) set outcome(v: string) {
    this._outcome.set(v || 'mystery');
  }
  /** Recolored player-creature data URL (from getRecoloredWithHatDataUrl). */
  @Input() creatureUrl: string | null = null;

  protected readonly key = computed(() => (SKITS[this._outcome()] ? this._outcome() : 'mystery'));
  protected readonly spec = computed(() => SKITS[this.key()]);
  protected readonly sym = computed(() => MYSTERY_SYMBOLS[this.key()] ?? MYSTERY_SYMBOLS['mystery']);

  protected readonly px = pxv;
  protected readonly ms = msv;

  // Particle sets generated once.
  protected readonly rain = bits(11, 130);
  protected readonly motes = bits(11, 52);
}
