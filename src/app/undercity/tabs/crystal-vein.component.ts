import {
  Component,
  EventEmitter,
  Input,
  Output,
  ViewChild,
  ElementRef,
  OnChanges,
  SimpleChanges,
  SimpleChange,
  signal,
  WritableSignal,
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
  VEIN_RARE_ITEM_PREVIEW,
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
            <h3>Crystal Vein</h3>
          </div>
          <div class="hud">
            <div #gemTally class="tally gem" title="Gemstones you hold">
              <mat-icon class="mi">diamond</mat-icon>
              <b>{{ gemstones }}</b>
              @if (gemPop()) {
                <span class="tally-pop">{{ gemPop() }}</span>
              }
            </div>
            <div #moltTally class="tally molt" title="Moltings you hold">
              <mat-icon class="mi">grass</mat-icon>
              <b>{{ moltings }}</b>
              @if (moltPop()) {
                <span class="tally-pop">{{ moltPop() }}</span>
              }
            </div>
          </div>
        </header>

        <div class="shaft-region">
          <!-- The shaft IS the strike control: tap the vein to swing your pick.
               Depth reads off the lit strata + the Heartstone at the bottom. -->
          <div
            #shaftEl
            class="shaft-stage"
            [class.tappable]="canStrike"
            [class.heart]="isHeartstoneNext"
            role="button"
            [attr.aria-label]="canStrike ? 'Strike the crystal vein' : null"
            [attr.aria-disabled]="!canStrike"
            [attr.tabindex]="canStrike ? 0 : -1"
            (click)="onStrike($event)"
            (keydown.enter)="onStrike()"
            (keydown.space)="onStrike(); $event.preventDefault()"
          >
            @if (canStrike || busy) {
              <div class="tap-cue">
                {{
                  busy
                    ? 'Striking…'
                    : isHeartstoneNext
                      ? 'Tap to pry the Heartstone'
                      : 'Tap the vein to strike'
                }}
              </div>
            }
            <div class="shaft">
              @for (lv of levels; track lv) {
                <div
                  class="band"
                  [class.lit]="lv <= depth"
                  [class.next]="lv === depth + 1"
                  [class.loot]="lv >= CONSUMABLE_MIN && lv < MAX"
                  [class.heart]="lv === MAX"
                  [attr.title]="
                    lv >= CONSUMABLE_MIN && lv < MAX ? 'Deep enough for a bonus find' : null
                  "
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

          <!-- Cave-in tension meter: one rising ember bar instead of an odds table.
               Stays visible even out of swings so the shaft's danger is always legible. -->
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
        </div>

        <div class="shaft-foot">
          <span>Depth <b>{{ depth }}</b><em>/{{ MAX }}</em></span>
        </div>

        @if (strikesLeft > 0) {
          <!-- Odds while digging; at the Heartstone these become guaranteed rewards. -->
          <div class="odds-divider">
            <span>{{ isHeartstoneNext ? 'Heartstone reward' : 'Odds of finding' }}</span>
          </div>
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

          @if (isHeartstoneNext) {
            <!-- Name the guaranteed rare prize so the finish isn't a mystery. -->
            <div class="prize">
              <span class="prize-lab">Plus a guaranteed rare — one of</span>
              <div class="prize-items">
                @for (p of RARE_PRIZES; track p.name) {
                  <span class="prize-item">
                    <mat-icon class="mi">{{ p.icon }}</mat-icon>
                    {{ p.name }}
                  </span>
                }
              </div>
            </div>
          }

          <!-- Swings remaining as depleting pips. -->
          <div class="pips">
            <span class="lab">Swings</span>
            @for (p of pips; track $index) {
              <span class="pip" [class.spent]="!p"></span>
            }
          </div>

          <!-- Flavor / last-result note, in the space the strike button used to hold. -->
          @if (log) {
            <p class="vein-note">{{ log }}</p>
          }

          <p class="vc-foot">
            <mat-icon class="mi">groups</mat-icon>
            Depth carries over — everyone digs the same shaft
          </p>
        } @else {
          @if (log) {
            <p class="vein-note">{{ log }}</p>
          }
          <p class="vein-hint out">A hard day of work - come back next time you land here.</p>
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
        background: #17191a;
        border: 1px solid rgba(74, 124, 89, 0.4);
        border-radius: 16px;
        padding: 18px;
        display: flex;
        flex-direction: column;
        gap: 10px;
        text-align: left;
        overflow: hidden;
        box-shadow:
          0 24px 60px rgba(0, 0, 0, 0.6),
          inset 0 1px 0 rgba(183, 228, 199, 0.07);
        animation: veinIn 0.26s cubic-bezier(0.2, 1.2, 0.4, 1);
      }
      @keyframes veinIn {
        from {
          opacity: 0;
          transform: translateY(12px) scale(0.96);
        }
        to {
          opacity: 1;
          transform: none;
        }
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
        border-radius: 16px;
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
      }
      h3 {
        margin: 0;
        color: #d7ecef;
        font-size: 1.2rem;
        font-weight: 800;
        line-height: 1;
      }
      /* ── Corner HUD: current Gemstone + Molting totals ────────────────────── */
      .hud {
        display: flex;
        gap: 6px;
      }
      .tally {
        position: relative;
        display: flex;
        align-items: center;
        gap: 4px;
        padding: 4px 9px 4px 7px;
        background: rgba(255, 255, 255, 0.03);
        border: 1px solid rgba(90, 150, 165, 0.35);
        border-radius: 999px;
        font-variant-numeric: tabular-nums;
      }
      .tally b {
        font-size: 0.95rem;
        font-weight: 800;
      }
      .tally .mi {
        width: 15px;
        height: 15px;
        font-size: 15px;
      }
      .tally.gem {
        border-color: rgba(143, 208, 221, 0.4);
      }
      .tally.gem .mi,
      .tally.gem b {
        color: #9fd2df;
      }
      .tally.molt {
        border-color: rgba(169, 211, 138, 0.4);
      }
      .tally.molt .mi,
      .tally.molt b {
        color: #a9d38a;
      }
      /* the "+N" that floats up off a tally when its total climbs */
      .tally-pop {
        position: absolute;
        top: -4px;
        right: 4px;
        font-size: 0.72rem;
        font-weight: 800;
        pointer-events: none;
        animation: tallyPop 0.9s ease-out forwards;
      }
      .tally.gem .tally-pop {
        color: #b7e2ff;
      }
      .tally.molt .tally-pop {
        color: #bfe6a3;
      }
      @keyframes tallyPop {
        0% {
          opacity: 0;
          transform: translateY(2px) scale(0.8);
        }
        25% {
          opacity: 1;
          transform: translateY(-4px) scale(1.05);
        }
        100% {
          opacity: 0;
          transform: translateY(-18px) scale(1);
        }
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
      /* subtle "you tap this" affordance now that the button is gone */
      .tap-cue {
        position: absolute;
        top: 8px;
        left: 50%;
        transform: translateX(-50%);
        z-index: 3;
        padding: 3px 11px;
        border-radius: 999px;
        background: rgba(6, 10, 10, 0.62);
        border: 1px solid rgba(143, 208, 221, 0.3);
        font-size: 0.66rem;
        font-weight: 600;
        color: #b9e6ef;
        white-space: nowrap;
        pointer-events: none;
      }
      .shaft-stage.heart .tap-cue {
        color: #e7cf9c;
        border-color: rgba(224, 192, 136, 0.4);
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
      /* Strata deep enough to drop a bonus find (level >= the consumable band)
         run warmer than the barren shallow rock — same gold the find chips use,
         kept muted so the Heartstone below still reads as the prize. */
      .band.loot {
        background: linear-gradient(180deg, #2b2820 0%, #1f1c15 100%);
        border-color: rgba(224, 192, 136, 0.2);
      }
      .band.loot.lit {
        background: linear-gradient(180deg, rgba(186, 154, 92, 0.5) 0%, rgba(126, 98, 48, 0.38) 100%);
        border-color: rgba(224, 192, 136, 0.35);
        box-shadow: inset 0 0 8px rgba(224, 192, 136, 0.2);
      }
      .band.loot.lit::after {
        background: linear-gradient(90deg, transparent, rgba(255, 233, 180, 0.5), transparent);
      }
      .band.loot.next {
        outline-color: rgba(224, 192, 136, 0.85);
        animation-name: nextPulseLoot;
      }
      @keyframes nextPulseLoot {
        0%,
        100% {
          outline-color: rgba(224, 192, 136, 0.35);
        }
        50% {
          outline-color: rgba(224, 192, 136, 1);
        }
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
        border: 1px solid rgba(224, 192, 136, 0.45);
        box-shadow: inset 0 0 14px rgba(224, 192, 136, 0.2);
      }
      .heart-gem {
        color: #e0c088;
        width: 28px;
        height: 28px;
        font-size: 28px;
        filter: drop-shadow(0 0 4px rgba(224, 192, 136, 0.5));
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
        color: #d08a6f;
        width: 16px;
        height: 16px;
        font-size: 16px;
      }
      .risk-cap .pct {
        font-size: 0.88rem;
        font-weight: 800;
        color: #d08a6f;
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
        background: linear-gradient(180deg, #d98a6a 0%, #b45a3c 55%, #6e3320 100%);
        transition: height 0.5s cubic-bezier(0.4, 0, 0.2, 1);
      }
      .risk.high .risk-fill {
        background: linear-gradient(180deg, #e09068 0%, #c05633 55%, #6e3320 100%);
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
      /* icon sizing (Material font renders at 24px by default) */
      .title-i {
        width: 22px;
        height: 22px;
        font-size: 22px;
      }
      /* ── Odds section ─────────────────────────────────────────────────────── */
      .odds-divider {
        display: flex;
        align-items: center;
        gap: 8px;
        margin-top: 2px;
        font-size: 0.56rem;
        font-weight: 700;
        letter-spacing: 0.16em;
        text-transform: uppercase;
        color: #6d827d;
      }
      .odds-divider::before,
      .odds-divider::after {
        content: '';
        flex: 1;
        height: 1px;
        background: rgba(143, 208, 221, 0.16);
      }
      /* flavor / last-result note, sitting where the strike button used to be */
      .vein-note {
        margin: 0;
        padding: 8px 12px;
        border-radius: 10px;
        background: rgba(255, 255, 255, 0.03);
        border: 1px solid rgba(90, 150, 165, 0.2);
        font-size: 0.8rem;
        font-style: italic;
        color: #b7c7b7;
        text-align: center;
      }
      /* ── Heartstone prize: name the guaranteed rare ───────────────────────── */
      .prize {
        display: flex;
        flex-direction: column;
        align-items: center;
        gap: 6px;
        padding: 9px 10px;
        border-radius: 10px;
        background: rgba(224, 192, 136, 0.07);
        border: 1px solid rgba(224, 192, 136, 0.3);
      }
      .prize-lab {
        font-size: 0.56rem;
        font-weight: 700;
        letter-spacing: 0.12em;
        text-transform: uppercase;
        color: #c9b07a;
      }
      .prize-items {
        display: flex;
        flex-wrap: wrap;
        justify-content: center;
        gap: 7px;
      }
      .prize-item {
        display: inline-flex;
        align-items: center;
        gap: 5px;
        padding: 5px 10px;
        border-radius: 8px;
        background: rgba(0, 0, 0, 0.25);
        border: 1px solid rgba(224, 192, 136, 0.35);
        font-size: 0.78rem;
        font-weight: 600;
        color: #e7d3a4;
      }
      .prize-item .mi {
        width: 16px;
        height: 16px;
        font-size: 16px;
        color: #e0c088;
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
        border-color: rgba(143, 208, 221, 0.3);
      }
      .chip.gem .mi,
      .chip.gem .amt {
        color: #9fd2df;
      }
      .chip.rare {
        border-color: rgba(224, 192, 136, 0.4);
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
        width: 14px;
        height: 14px;
        transform: rotate(45deg);
        border-radius: 3px;
        background: linear-gradient(135deg, #5aa2b0, #2f6f7d);
        border: 1px solid rgba(143, 208, 221, 0.3);
        transition: all 0.3s ease;
      }
      .pip.spent {
        background: #23282a;
        border-color: rgba(255, 255, 255, 0.06);
        opacity: 0.5;
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
  /** Gemstones (ichor) the player currently holds — the corner HUD total. */
  @Input() gemstones = 0;
  /** Moltings the player currently holds — the corner HUD total. */
  @Input() moltings = 0;
  /** Region biome wash painted behind the card (from the board tab). */
  @Input() washBg: string | null = null;
  /** The swing the parent just resolved — drives the tap-spot popups. */
  @Input() fx: VeinStrikeFx | null = null;
  @Output() strike = new EventEmitter<void>();
  @Output() closed = new EventEmitter<void>();

  @ViewChild('gemTally') private gemTallyRef?: ElementRef<HTMLElement>;
  @ViewChild('moltTally') private moltTallyRef?: ElementRef<HTMLElement>;
  @ViewChild('shaftEl') private shaftRef?: ElementRef<HTMLElement>;

  /** Transient "+N" that pops off a corner tally when its total climbs. */
  protected readonly gemPop = signal<string | null>(null);
  protected readonly moltPop = signal<string | null>(null);

  protected readonly MAX = VEIN_MAX_DEPTH;
  protected readonly levels = Array.from({ length: VEIN_MAX_DEPTH }, (_, i) => i + 1);
  protected readonly HEART_ICHOR = VEIN_HEARTSTONE_ICHOR;
  protected readonly CONSUMABLE_MIN = VEIN_ITEM_CONSUMABLE_BAND.min;
  protected readonly STRIKES_TOTAL = VEIN_STRIKES_PER_VISIT;
  /** The Heartstone's guaranteed-rare pool, named so the prize isn't a mystery. */
  protected readonly RARE_PRIZES = VEIN_RARE_ITEM_PREVIEW;

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
    this.onTallyGain(ch['gemstones'], this.gemTallyRef, this.gemPop);
    this.onTallyGain(ch['moltings'], this.moltTallyRef, this.moltPop);
    if (ch['fx'] && this.fx && this.fx.seq !== this.lastSeq) {
      this.lastSeq = this.fx.seq;
      this.playResult(this.fx);
    }
  }

  /** When a corner total climbs, bump the pill and float a "+N" off it. */
  private onTallyGain(
    change: SimpleChange | undefined,
    ref: ElementRef<HTMLElement> | undefined,
    pop: WritableSignal<string | null>,
  ): void {
    if (!change || change.firstChange) return;
    const delta = change.currentValue - change.previousValue;
    if (delta <= 0) return;
    ref?.nativeElement.animate(
      [{ transform: 'scale(1)' }, { transform: 'scale(1.35)' }, { transform: 'scale(1)' }],
      { duration: 420, easing: 'ease-out' },
    );
    pop.set(`+${delta}`);
    setTimeout(() => pop.set(null), 900);
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
}
