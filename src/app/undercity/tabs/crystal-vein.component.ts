import {
  Component,
  EventEmitter,
  Input,
  Output,
  ViewChild,
  ElementRef,
  OnChanges,
  SimpleChanges,
  signal,
} from '@angular/core';
import { CommonModule } from '@angular/common';
import { MatIconModule } from '@angular/material/icon';
import {
  VEIN_CAVE_IN_PCT_PER_LEVEL,
  VEIN_CAVE_IN_DMG_PER_LEVEL,
  VEIN_ICHOR_BASE,
  VEIN_ICHOR_PER_LEVEL,
  VEIN_HEARTSTONE_ICHOR,
  VEIN_ITEM_CONSUMABLE_BAND,
  VEIN_ITEM_RARE_BAND,
  VEIN_MAX_DEPTH,
  VEIN_STRIKES_PER_VISIT,
} from '../data/vein-vault';

/** The result of the swing the parent just resolved, so the modal can pop the
 *  loot (or cave-in) out of the tap spot. `seq` bumps to retrigger on repeats. */
export interface VeinStrikeFx {
  seq: number;
  collapsed?: boolean;
  heartstone?: boolean;
  ichor?: number;
  moltings?: number;
  /** An item dropped into the bag this swing. */
  found?: boolean;
}

/** A floating "damage-number" style popup that rises out of the tap spot. */
interface Floater {
  id: number;
  cls: string;
  icon?: string;
  svgIcon?: string;
  text: string;
  x: number;
  y: number;
}

/** A single falling rock spawned by a cave-in. */
interface Rock {
  id: number;
  x: number;
  size: number;
  fall: number;
  dur: number;
  delay: number;
  rot: number;
}

/**
 * The crystal-vein modal: a shared shaft everyone digs deeper. You strike by
 * tapping the shaft itself; whatever you find pops out of the tap spot like a
 * damage number, and a cave-in rains rock and flashes the card red.
 */
@Component({
  selector: 'app-undercity-crystal-vein',
  standalone: true,
  imports: [CommonModule, MatIconModule],
  template: `
    <div class="vein-overlay" (click)="closed.emit()">
      <div
        class="vein-card"
        [class.damaging]="damaging()"
        (click)="$event.stopPropagation()"
        [style.background-image]="washBg"
      >
        @if (damaging()) {
          <div class="dmg-flash"></div>
        }

        <header class="vc-head">
          <div class="vc-title">
            <mat-icon class="mi title-i">diamond</mat-icon>
            <div>
              <span class="eyebrow">Shared shaft</span>
              <h3>Crystal Vein</h3>
            </div>
          </div>
          <div class="gem-tally" title="Gemstones banked this visit">
            <mat-icon class="mi">diamond</mat-icon>
            <b #earnedEl class="earned">{{ earnedThisVisit }}</b>
          </div>
        </header>

        <div class="shaft-region">
          <!-- The shaft is the tappable delighter; the button below is the accessible
               primary. Depth reads off the lit strata + the Heartstone at the bottom. -->
          <div
            #shaftEl
            class="shaft-stage"
            [class.tappable]="canStrike"
            [class.heart]="isHeartstoneNext"
            (click)="onStrike($event)"
          >
            <div class="shaft">
              @for (lv of levels; track lv) {
                <div
                  class="band"
                  [class.lit]="lv <= depth"
                  [class.next]="lv === depth + 1"
                  [class.heart]="lv === MAX"
                >
                  @if (lv === MAX) {
                    <mat-icon class="mi heart-gem">diamond</mat-icon>
                  }
                </div>
              }
            </div>

            <!-- Tap-spot popups + cave-in rubble (absolutely placed within the stage) -->
            @for (f of floaters(); track f.id) {
              <span class="floater {{ f.cls }}" [style.left.px]="f.x" [style.top.px]="f.y">
                @if (f.svgIcon) {
                  <mat-icon class="fi" [svgIcon]="f.svgIcon"></mat-icon>
                } @else if (f.icon) {
                  <mat-icon class="fi">{{ f.icon }}</mat-icon>
                }
                {{ f.text }}
              </span>
            }
            @for (r of rocks(); track r.id) {
              <span
                class="rock"
                [style.left.px]="r.x"
                [style.width.px]="r.size"
                [style.height.px]="r.size"
                [style.animation-duration.ms]="r.dur"
                [style.animation-delay.ms]="r.delay"
                [style.--fall.px]="r.fall"
                [style.--rot.deg]="r.rot"
              ></span>
            }
          </div>

          <!-- Cave-in tension meter: one rising ember bar instead of an odds table. -->
          @if (strikesLeft > 0) {
            <div class="risk" [class.high]="riskPct >= 24">
              <div class="risk-cap">
                <mat-icon class="mi">warning</mat-icon>
                <span class="pct">{{ riskPct }}%</span>
              </div>
              <div class="risk-track">
                <span class="tick" style="top: 33%"></span>
                <span class="tick" style="top: 66%"></span>
                <div class="risk-fill" [style.height.%]="riskPct"></div>
              </div>
              <div class="risk-label">Cave-in<br />{{ caveDmg }} dmg</div>
            </div>
          }
        </div>

        <div class="shaft-foot">
          <span>Depth <b>{{ depth }}</b><em>/{{ MAX }}</em></span>
          @if (strikesLeft > 0) {
            <span class="to-heart">
              @if (isHeartstoneNext) {
                Heartstone next
              } @else {
                {{ MAX - depth }} to the Heartstone
              }
            </span>
          }
        </div>

        @if (log) {
          <p class="vein-log">{{ log }}</p>
        }

        @if (strikesLeft > 0) {
          <!-- What this swing can turn up — a glance, not a spreadsheet. -->
          <div class="loot">
            <div class="chip gem">
              <mat-icon class="mi">diamond</mat-icon>
              <span class="amt">{{ isHeartstoneNext ? '+' + HEART_ICHOR : gemPct + '%' }}</span>
              <span class="cap">Gemstone{{ isHeartstoneNext ? 's' : '' }}</span>
            </div>
            <div class="chip rare" [class.muted]="!isHeartstoneNext && !itemChance">
              <mat-icon class="mi" svgIcon="uc-pouch"></mat-icon>
              @if (isHeartstoneNext) {
                <span class="amt">Rare</span>
                <span class="cap">Guaranteed</span>
              } @else if (itemChance) {
                <span class="amt">{{ itemChance.pct }}%</span>
                <span class="cap">{{ itemChance.label }}</span>
              } @else {
                <span class="amt">—</span>
                <span class="cap">Finds at L{{ CONSUMABLE_MIN }}</span>
              }
            </div>
            <div class="chip molt">
              <mat-icon class="mi">grass</mat-icon>
              <span class="amt">+1</span>
              <span class="cap">Molting</span>
            </div>
          </div>

          <!-- Swings as depleting pips + the one juicy primary action. -->
          <div class="pips">
            <span class="lab">Swings</span>
            @for (p of pips; track $index) {
              <span class="pip" [class.spent]="!p"></span>
            }
          </div>
          <button
            class="strike-btn"
            [class.heart]="isHeartstoneNext"
            [disabled]="busy"
            (click)="onStrike()"
          >
            @if (isHeartstoneNext) {
              <mat-icon class="mi">auto_awesome</mat-icon>
            }
            {{ busy ? 'Striking…' : isHeartstoneNext ? 'Pry the Heartstone' : 'Strike the vein' }}
          </button>

          <p class="vc-foot">
            <mat-icon class="mi">groups</mat-icon>
            Depth carries over — everyone digs the same shaft
          </p>
        } @else {
          <p class="vein-hint out">Out of strikes — come back next time you land here.</p>
        }
        <button class="uc-btn close-btn ghost" (click)="closed.emit()">Leave</button>
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
        position: relative;
        width: min(360px, 100%);
        background: #151a1c;
        border: 1px solid rgba(90, 150, 165, 0.55);
        border-radius: 14px;
        padding: 18px;
        display: flex;
        flex-direction: column;
        gap: 10px;
        text-align: center;
        overflow: hidden;
      }
      .vein-card {
        text-align: left;
      }
      .vein-card.damaging {
        animation: cardBump 0.42s ease-out;
      }
      @keyframes cardBump {
        0% {
          transform: translate(0, 0);
        }
        20% {
          transform: translate(-3px, 2px);
        }
        40% {
          transform: translate(3px, -1px);
        }
        60% {
          transform: translate(-2px, 1px);
        }
        100% {
          transform: translate(0, 0);
        }
      }
      /* Full-card red bump that flags "you took damage". */
      .dmg-flash {
        position: absolute;
        inset: 0;
        z-index: 5;
        pointer-events: none;
        border-radius: 14px;
        background: radial-gradient(120% 120% at 50% 50%, rgba(210, 40, 30, 0.45), rgba(210, 40, 30, 0.12));
        box-shadow: inset 0 0 0 2px rgba(230, 70, 55, 0.75);
        animation: redBump 0.5s ease-out forwards;
      }
      @keyframes redBump {
        0% {
          opacity: 0;
        }
        15% {
          opacity: 1;
        }
        100% {
          opacity: 0;
        }
      }
      /* ── Header: title + gems-this-visit HUD chip ─────────────────────────── */
      .vc-head {
        display: flex;
        align-items: center;
        justify-content: space-between;
        gap: 10px;
      }
      .vc-title {
        display: flex;
        align-items: center;
        gap: 9px;
      }
      .vc-title .title-i {
        color: #8fd0dd;
        filter: drop-shadow(0 0 6px rgba(143, 208, 221, 0.55));
      }
      .vc-title .eyebrow {
        display: block;
        font-size: 0.58rem;
        font-weight: 700;
        letter-spacing: 0.18em;
        text-transform: uppercase;
        color: #6d827d;
        margin-bottom: 2px;
      }
      h3 {
        margin: 0;
        color: #d7ecef;
        font-size: 1.2rem;
        font-weight: 800;
        line-height: 1;
      }
      .gem-tally {
        display: flex;
        align-items: center;
        gap: 5px;
        padding: 5px 10px 5px 8px;
        background: rgba(143, 208, 221, 0.1);
        border: 1px solid rgba(90, 150, 165, 0.55);
        border-radius: 999px;
        font-variant-numeric: tabular-nums;
      }
      .gem-tally .mi {
        color: #8fd0dd;
      }
      .earned {
        color: #b6ffbf;
        font-size: 1rem;
        font-weight: 800;
      }
      /* ── Shaft region: hero shaft + cave-in meter ─────────────────────────── */
      .shaft-region {
        display: flex;
        gap: 12px;
      }
      .shaft-stage {
        position: relative;
        flex: 1;
        overflow: hidden;
        padding: 7px;
        border: 1px solid rgba(90, 150, 165, 0.28);
        border-radius: 12px;
        background:
          radial-gradient(90% 120% at 50% 120%, rgba(143, 208, 221, 0.14), transparent 60%),
          linear-gradient(180deg, #0c1211 0%, #0a0f0e 100%);
        box-shadow: inset 0 2px 14px rgba(0, 0, 0, 0.7);
        user-select: none;
        transition:
          transform 0.08s ease,
          border-color 0.15s ease,
          box-shadow 0.15s ease;
      }
      .shaft-stage.tappable {
        cursor: pointer;
        border-color: rgba(143, 208, 221, 0.5);
      }
      .shaft-stage.tappable:hover {
        box-shadow:
          inset 0 2px 14px rgba(0, 0, 0, 0.7),
          0 0 0 1px rgba(143, 208, 221, 0.4);
      }
      .shaft-stage.tappable:active {
        transform: scale(0.99);
      }
      .shaft-stage.heart.tappable {
        border-color: rgba(224, 192, 136, 0.7);
        box-shadow:
          inset 0 2px 14px rgba(0, 0, 0, 0.7),
          0 0 16px rgba(224, 192, 136, 0.22);
      }
      .shaft {
        display: flex;
        flex-direction: column;
        gap: 3px;
        height: 262px;
      }
      /* an excavated / cleared crystal stratum */
      .band {
        flex: 1;
        border-radius: 3px;
        position: relative;
        background: linear-gradient(180deg, #202a28 0%, #171f1d 100%);
        border: 1px solid rgba(0, 0, 0, 0.35);
      }
      .band.lit {
        background: linear-gradient(180deg, rgba(82, 168, 186, 0.55) 0%, rgba(47, 111, 125, 0.4) 100%);
        border-color: rgba(143, 208, 221, 0.3);
        box-shadow: inset 0 0 8px rgba(143, 208, 221, 0.22);
      }
      .band.lit::after {
        content: '';
        position: absolute;
        left: 6px;
        right: 6px;
        top: 50%;
        height: 1px;
        background: linear-gradient(90deg, transparent, rgba(190, 245, 255, 0.5), transparent);
      }
      .band.next {
        outline: 1px dashed rgba(143, 208, 221, 0.85);
        outline-offset: -1px;
        animation: nextPulse 1.4s ease-in-out infinite;
        z-index: 2;
      }
      /* the Heartstone stratum at the very bottom */
      .band.heart {
        flex: 1.9;
        display: flex;
        align-items: center;
        justify-content: center;
        background: radial-gradient(
          70% 130% at 50% 50%,
          rgba(224, 192, 136, 0.3),
          rgba(184, 134, 42, 0.1) 70%,
          transparent
        );
        border: 1px solid rgba(224, 192, 136, 0.5);
        box-shadow: inset 0 0 18px rgba(224, 192, 136, 0.28);
        animation: heartGlow 2.6s ease-in-out infinite;
      }
      .heart-gem {
        color: #f0c24b;
        width: 30px;
        height: 30px;
        font-size: 30px;
        filter: drop-shadow(0 0 10px rgba(240, 194, 75, 0.8));
      }
      @keyframes heartGlow {
        0%,
        100% {
          box-shadow: inset 0 0 14px rgba(224, 192, 136, 0.2);
        }
        50% {
          box-shadow: inset 0 0 26px rgba(224, 192, 136, 0.5);
        }
      }
      @keyframes nextPulse {
        0%,
        100% {
          outline-color: rgba(143, 208, 221, 0.35);
        }
        50% {
          outline-color: rgba(143, 208, 221, 1);
        }
      }
      /* ── Cave-in tension meter ────────────────────────────────────────────── */
      .risk {
        width: 52px;
        flex: 0 0 auto;
        display: flex;
        flex-direction: column;
        align-items: center;
        text-align: center;
      }
      .risk-cap {
        display: flex;
        flex-direction: column;
        align-items: center;
        gap: 1px;
        margin-bottom: 5px;
      }
      .risk-cap .mi {
        color: #ef5f3a;
        width: 16px;
        height: 16px;
        font-size: 16px;
      }
      .risk-cap .pct {
        font-size: 0.88rem;
        font-weight: 800;
        color: #ef5f3a;
        font-variant-numeric: tabular-nums;
      }
      .risk-track {
        position: relative;
        flex: 1;
        width: 16px;
        border-radius: 10px;
        background: linear-gradient(180deg, #1a2220, #101615);
        border: 1px solid rgba(90, 150, 165, 0.28);
        overflow: hidden;
        box-shadow: inset 0 2px 8px rgba(0, 0, 0, 0.6);
      }
      .risk-track .tick {
        position: absolute;
        left: 0;
        right: 0;
        height: 1px;
        background: rgba(255, 255, 255, 0.06);
      }
      .risk-fill {
        position: absolute;
        left: 0;
        right: 0;
        bottom: 0;
        background: linear-gradient(180deg, #ffb079 0%, #ef5f3a 45%, #7a2c1c 100%);
        box-shadow: 0 0 12px rgba(239, 95, 58, 0.7);
        transition: height 0.5s cubic-bezier(0.4, 0, 0.2, 1);
      }
      .risk.high .risk-fill {
        animation: riskPulse 1.4s ease-in-out infinite;
      }
      @keyframes riskPulse {
        0%,
        100% {
          filter: brightness(1);
        }
        50% {
          filter: brightness(1.3);
        }
      }
      .risk-label {
        margin-top: 6px;
        font-size: 0.5rem;
        font-weight: 700;
        letter-spacing: 0.08em;
        text-transform: uppercase;
        color: #6d827d;
        line-height: 1.25;
      }
      /* depth read-out under the shaft */
      .shaft-foot {
        display: flex;
        align-items: baseline;
        justify-content: center;
        gap: 8px;
        font-size: 0.66rem;
        letter-spacing: 0.12em;
        text-transform: uppercase;
        color: #6d827d;
      }
      .shaft-foot b {
        color: #8fd0dd;
        font-size: 0.9rem;
        letter-spacing: 0;
        font-variant-numeric: tabular-nums;
      }
      .shaft-foot em {
        font-style: normal;
      }
      .shaft-foot .to-heart {
        color: #e0c088;
      }
      /* Tap-spot floaters — rise + fade like a damage number. */
      .floater {
        position: absolute;
        z-index: 6;
        transform: translate(-50%, -50%);
        display: inline-flex;
        align-items: center;
        gap: 3px;
        font-weight: 800;
        font-size: 0.9rem;
        white-space: nowrap;
        pointer-events: none;
        text-shadow: 0 1px 3px rgba(0, 0, 0, 0.8);
        animation: floatUp 0.95s ease-out forwards;
      }
      .floater .fi {
        font-size: 17px;
        width: 17px;
        height: 17px;
      }
      .floater.gem {
        color: #b7e2ff;
      }
      .floater.molt {
        color: #a9d38a;
      }
      .floater.find {
        color: #e0c088;
      }
      .floater.dmg {
        color: #ff8f70;
      }
      .floater.word {
        font-size: 1.35rem;
        letter-spacing: 0.03em;
        color: #f3ede0;
        animation: popWord 0.85s ease-out forwards;
      }
      .floater.word.bad {
        color: #ff7a5c;
      }
      .floater.word.jackpot {
        color: #ffd98a;
        font-size: 1.5rem;
      }
      @keyframes floatUp {
        0% {
          opacity: 0;
          transform: translate(-50%, -30%) scale(0.8);
        }
        20% {
          opacity: 1;
          transform: translate(-50%, -55%) scale(1);
        }
        100% {
          opacity: 0;
          transform: translate(-50%, -170%) scale(1);
        }
      }
      @keyframes popWord {
        0% {
          opacity: 0;
          transform: translate(-50%, -50%) scale(0.5) rotate(-4deg);
        }
        25% {
          opacity: 1;
          transform: translate(-50%, -70%) scale(1.15) rotate(-3deg);
        }
        100% {
          opacity: 0;
          transform: translate(-50%, -120%) scale(1) rotate(-3deg);
        }
      }
      /* Cave-in rubble. */
      .rock {
        position: absolute;
        top: -8px;
        z-index: 4;
        background: #6a5c4d;
        border-radius: 3px 4px 2px 3px;
        box-shadow: inset 0 1px 1px rgba(255, 255, 255, 0.15);
        pointer-events: none;
        animation-name: rockFall;
        animation-timing-function: cubic-bezier(0.4, 0.1, 0.7, 1);
        animation-fill-mode: forwards;
      }
      @keyframes rockFall {
        0% {
          opacity: 0;
          transform: translateY(0) rotate(0);
        }
        10% {
          opacity: 1;
        }
        100% {
          opacity: 0.25;
          transform: translateY(var(--fall)) rotate(var(--rot));
        }
      }
      .vein-log {
        margin: 0;
        font-size: 0.82rem;
        color: #cbd5ce;
      }
      /* icon sizing (Material font renders at 24px by default) */
      .title-i {
        width: 22px;
        height: 22px;
        font-size: 22px;
      }
      .gem-tally .mi {
        width: 15px;
        height: 15px;
        font-size: 15px;
      }
      /* ── Loot preview chips ───────────────────────────────────────────────── */
      .loot {
        display: flex;
        gap: 7px;
      }
      .chip {
        flex: 1;
        display: flex;
        flex-direction: column;
        align-items: center;
        gap: 3px;
        padding: 8px 4px 7px;
        border-radius: 11px;
        background: rgba(255, 255, 255, 0.02);
        border: 1px solid rgba(90, 150, 165, 0.28);
        text-align: center;
      }
      .chip .mi {
        width: 20px;
        height: 20px;
        font-size: 20px;
      }
      .chip .amt {
        font-size: 0.82rem;
        font-weight: 800;
        font-variant-numeric: tabular-nums;
      }
      .chip .cap {
        font-size: 0.5rem;
        letter-spacing: 0.08em;
        text-transform: uppercase;
        color: #6d827d;
      }
      .chip.gem {
        border-color: rgba(143, 208, 221, 0.4);
        box-shadow: 0 0 14px -6px rgba(143, 208, 221, 0.5);
      }
      .chip.gem .mi,
      .chip.gem .amt {
        color: #b7e2ff;
      }
      .chip.rare {
        border-color: rgba(224, 192, 136, 0.5);
        box-shadow: 0 0 16px -6px rgba(224, 192, 136, 0.5);
      }
      .chip.rare .mi,
      .chip.rare .amt {
        color: #e0c088;
      }
      .chip.molt .mi,
      .chip.molt .amt {
        color: #a9d38a;
      }
      .chip.muted {
        opacity: 0.55;
        box-shadow: none;
        border-color: rgba(90, 150, 165, 0.2);
      }
      .chip.muted .mi,
      .chip.muted .amt {
        color: #6f7d72;
      }
      /* ── Swing pips + the one primary action ──────────────────────────────── */
      .pips {
        display: flex;
        align-items: center;
        justify-content: center;
        gap: 8px;
      }
      .pips .lab {
        font-size: 0.56rem;
        letter-spacing: 0.16em;
        text-transform: uppercase;
        color: #6d827d;
        margin-right: 2px;
      }
      .pip {
        width: 15px;
        height: 15px;
        transform: rotate(45deg);
        border-radius: 3px;
        background: linear-gradient(135deg, #6fd0e0, #2f6f7d);
        box-shadow: 0 0 8px rgba(143, 208, 221, 0.5);
        transition: all 0.3s ease;
      }
      .pip.spent {
        background: #23282a;
        box-shadow: none;
        opacity: 0.5;
      }
      .strike-btn {
        width: 100%;
        padding: 14px;
        border: none;
        border-radius: 12px;
        font: inherit;
        font-size: 0.98rem;
        font-weight: 800;
        letter-spacing: 0.04em;
        text-transform: uppercase;
        cursor: pointer;
        color: #04211f;
        background: linear-gradient(180deg, #8fe6f2 0%, #4bb6c8 55%, #2c7f8e 100%);
        box-shadow:
          0 5px 0 -1px #235e69,
          0 10px 22px -8px rgba(75, 182, 200, 0.7);
        display: flex;
        align-items: center;
        justify-content: center;
        gap: 8px;
        transition:
          transform 0.08s ease,
          box-shadow 0.08s ease;
      }
      .strike-btn .mi {
        width: 19px;
        height: 19px;
        font-size: 19px;
      }
      .strike-btn.heart {
        color: #2a1e05;
        background: linear-gradient(180deg, #ffdd7a 0%, #f0c24b 55%, #b8862a 100%);
        box-shadow:
          0 5px 0 -1px #8a6420,
          0 10px 22px -8px rgba(240, 194, 75, 0.7);
        animation: breathe 2.4s ease-in-out infinite;
      }
      .strike-btn:active {
        transform: translateY(4px);
        box-shadow: 0 1px 0 -1px #235e69;
      }
      .strike-btn.heart:active {
        box-shadow: 0 1px 0 -1px #8a6420;
      }
      .strike-btn:disabled {
        filter: grayscale(0.5) brightness(0.8);
        cursor: default;
        animation: none;
      }
      @keyframes breathe {
        0%,
        100% {
          box-shadow:
            0 5px 0 -1px #8a6420,
            0 10px 22px -8px rgba(240, 194, 75, 0.55);
        }
        50% {
          box-shadow:
            0 5px 0 -1px #8a6420,
            0 12px 30px -6px rgba(240, 194, 75, 0.95);
        }
      }
      .vc-foot {
        margin: 0;
        display: flex;
        align-items: center;
        justify-content: center;
        gap: 6px;
        font-size: 0.62rem;
        color: #7f8c84;
      }
      .vc-foot .mi {
        width: 13px;
        height: 13px;
        font-size: 13px;
      }
      .vein-hint {
        margin: 0;
        font-size: 0.78rem;
        color: #8a978a;
        display: flex;
        gap: 3px;
        align-items: center;
        justify-content: center;
      }
      .vein-hint.out {
        color: #d08a6f;
      }
      .close-btn {
        margin-top: 2px;
      }
      .close-btn.ghost {
        background: none;
        border: none;
        color: #8a978a;
        font-size: 0.72rem;
        letter-spacing: 0.12em;
        text-transform: uppercase;
        cursor: pointer;
        padding: 6px;
      }
      .close-btn.ghost:hover {
        color: #d7ecef;
      }
    `,
  ],
})
export class CrystalVeinModalComponent implements OnChanges {
  @Input() depth = 0;
  @Input() strikesLeft = 0;
  @Input() busy = false;
  @Input() log: string | null = null;
  /** Gemstones banked from strikes so far this visit (parent-owned). */
  @Input() earnedThisVisit = 0;
  /** Region biome wash painted behind the card (from the board tab). */
  @Input() washBg: string | null = null;
  /** The swing the parent just resolved — drives the tap-spot popups. */
  @Input() fx: VeinStrikeFx | null = null;
  @Output() strike = new EventEmitter<void>();
  @Output() closed = new EventEmitter<void>();

  @ViewChild('earnedEl') private earnedRef?: ElementRef<HTMLElement>;
  @ViewChild('shaftEl') private shaftRef?: ElementRef<HTMLElement>;

  protected readonly MAX = VEIN_MAX_DEPTH;
  protected readonly levels = Array.from({ length: VEIN_MAX_DEPTH }, (_, i) => i + 1);
  protected readonly HEART_ICHOR = VEIN_HEARTSTONE_ICHOR;
  protected readonly CONSUMABLE_MIN = VEIN_ITEM_CONSUMABLE_BAND.min;
  protected readonly STRIKES_TOTAL = VEIN_STRIKES_PER_VISIT;

  protected readonly floaters = signal<Floater[]>([]);
  protected readonly rocks = signal<Rock[]>([]);
  protected readonly damaging = signal(false);

  private fxId = 0;
  private lastSeq = -1;
  /** Where the last tap landed (stage-relative); seeds every popup. */
  private tap = { x: 66, y: 60 };

  private readonly HIT_WORDS = ['CHUNK', 'CRUNCH', 'BAM', 'CRACK', 'WHACK', 'THUNK', 'SMASH'];

  /** The level this next swing enters (shared depth + 1). */
  protected get level(): number {
    return this.depth + 1;
  }

  /** This swing pries the Heartstone (reaches VEIN_MAX_DEPTH). */
  protected get isHeartstoneNext(): boolean {
    return this.level >= this.MAX;
  }

  /** A swing is available (has strikes, not mid-request). */
  protected get canStrike(): boolean {
    return this.strikesLeft > 0 && !this.busy;
  }

  protected get gemPct(): number {
    return Math.round(Math.min(1, VEIN_ICHOR_BASE + this.level * VEIN_ICHOR_PER_LEVEL) * 100);
  }

  protected get riskPct(): number {
    return Math.round(this.level * VEIN_CAVE_IN_PCT_PER_LEVEL * 100);
  }

  protected get caveDmg(): number {
    return this.level * VEIN_CAVE_IN_DMG_PER_LEVEL;
  }

  /** Bonus-item odds for this level, or null in the shallow band (no items). */
  protected get itemChance(): { pct: number; label: string } | null {
    const l = this.level;
    if (l >= VEIN_ITEM_RARE_BAND.min) {
      return { pct: Math.round(VEIN_ITEM_RARE_BAND.chance * 100), label: 'Rare find' };
    }
    if (l >= VEIN_ITEM_CONSUMABLE_BAND.min && l <= VEIN_ITEM_CONSUMABLE_BAND.max) {
      return { pct: Math.round(VEIN_ITEM_CONSUMABLE_BAND.chance * 100), label: 'Consumable' };
    }
    return null;
  }

  /** Swings this visit as fill/spent flags for the pip row — filled = remaining. */
  protected get pips(): boolean[] {
    return Array.from({ length: this.STRIKES_TOTAL }, (_, i) => i < this.strikesLeft);
  }

  /** Tap-the-vein handler: record the tap spot, pop a hit word + pick-shake,
   *  then emit the swing (the parent resolves it and feeds back `fx`). */
  protected onStrike(evt?: MouseEvent): void {
    if (!this.canStrike) return;
    this.rememberTap(evt);
    this.spawnFloater({
      cls: 'word',
      text: this.HIT_WORDS[Math.floor(Math.random() * this.HIT_WORDS.length)],
    });
    this.shaftRef?.nativeElement.animate(
      [
        { transform: 'translateX(0) scale(1)' },
        { transform: 'translateX(-4px) scale(1.01)' },
        { transform: 'translateX(4px) scale(1.01)' },
        { transform: 'translateX(0) scale(1)' },
      ],
      { duration: 220, easing: 'ease-in-out' },
    );
    this.strike.emit();
  }

  ngOnChanges(ch: SimpleChanges): void {
    if (
      ch['earnedThisVisit'] &&
      !ch['earnedThisVisit'].firstChange &&
      ch['earnedThisVisit'].currentValue > ch['earnedThisVisit'].previousValue
    ) {
      this.pulseEarned();
    }
    if (ch['fx'] && this.fx && this.fx.seq !== this.lastSeq) {
      this.lastSeq = this.fx.seq;
      this.playResult(this.fx);
    }
  }

  /** Pop the loot (or cave-in) out of the tap spot once the swing resolves. */
  private playResult(fx: VeinStrikeFx): void {
    if (fx.collapsed) {
      this.caveIn();
      return;
    }
    let n = 0;
    if (fx.heartstone) {
      this.spawnFloater({ cls: 'word jackpot', text: 'HEARTSTONE!' }, n++);
    }
    if (fx.ichor) {
      this.spawnFloater({ cls: 'gem', icon: 'diamond', text: `+${fx.ichor}` }, n++);
    }
    if (fx.moltings) {
      this.spawnFloater({ cls: 'molt', icon: 'grass', text: `+${fx.moltings}` }, n++);
    }
    if (fx.found) {
      this.spawnFloater({ cls: 'find', svgIcon: 'uc-pouch', text: 'Find!' }, n++);
    }
  }

  /** Cave-in: rain rubble, flash the card red, and pop the damage number. */
  private caveIn(): void {
    const el = this.shaftRef?.nativeElement;
    const w = el?.clientWidth ?? 156;
    const h = el?.clientHeight ?? 120;
    const batch: Rock[] = [];
    for (let i = 0; i < 16; i++) {
      batch.push({
        id: this.fxId++,
        x: Math.round(Math.random() * w),
        size: 4 + Math.round(Math.random() * 7),
        fall: h + 16,
        dur: 500 + Math.round(Math.random() * 500),
        delay: Math.round(Math.random() * 220),
        rot: Math.round((Math.random() - 0.5) * 220),
      });
    }
    this.rocks.update((rs) => [...rs, ...batch]);
    const ids = new Set(batch.map((r) => r.id));
    setTimeout(() => this.rocks.update((rs) => rs.filter((r) => !ids.has(r.id))), 1300);

    this.damaging.set(true);
    setTimeout(() => this.damaging.set(false), 520);

    this.spawnFloater({ cls: 'word bad', text: 'CAVE-IN!' }, 0);
    this.spawnFloater({ cls: 'dmg', text: `-${this.caveDmg} HP` }, 1);
  }

  /** Record where the swing landed so popups spawn there. Keyboard strikes fall
   *  back to the shaft centre. */
  private rememberTap(evt?: MouseEvent): void {
    const el = this.shaftRef?.nativeElement;
    if (evt && el) {
      const r = el.getBoundingClientRect();
      this.tap = { x: evt.clientX - r.left, y: evt.clientY - r.top };
    } else if (el) {
      this.tap = { x: el.clientWidth / 2, y: el.clientHeight / 2 };
    }
  }

  /** Push a floater at the tap spot (with a small per-item offset so a stack of
   *  loot fans out instead of overlapping), and clear it when it finishes. */
  private spawnFloater(f: Omit<Floater, 'id' | 'x' | 'y'>, index = 0): void {
    const id = this.fxId++;
    const x = this.tap.x + (index ? (index % 2 ? 1 : -1) * (10 + index * 4) : 0);
    const y = this.tap.y - index * 16;
    this.floaters.update((fs) => [...fs, { ...f, id, x, y }]);
    setTimeout(() => this.floaters.update((fs) => fs.filter((it) => it.id !== id)), 1000);
  }

  /** Scale + colour flash on the tally each time it climbs — the "Gemstone
   *  gained" cue. */
  private pulseEarned(): void {
    this.earnedRef?.nativeElement.animate(
      [
        { transform: 'scale(1)', color: '#b6ffbf' },
        { transform: 'scale(1.55)', color: '#ffffff' },
        { transform: 'scale(1)', color: '#b6ffbf' },
      ],
      { duration: 420, easing: 'ease-out' },
    );
  }
}
