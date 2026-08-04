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

/** One row of the next-strike odds table — a small gacha pull where the cave-in
 *  is just another possible result alongside the rewards. */
interface Outcome {
  icon?: string;
  svgIcon?: string;
  label: string;
  value: string;
  tone: 'gem' | 'item' | 'molt' | 'risk';
  muted?: boolean;
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
        <h3><mat-icon class="mi title-i">diamond</mat-icon> Crystal Vein</h3>
        <p class="vein-sub">
          Shaft depth <strong>{{ depth }}</strong> / {{ MAX }} ·
          <strong>{{ strikesLeft }}</strong> strike{{ strikesLeft === 1 ? '' : 's' }} left · Gemstones
          this visit:
          <strong #earnedEl class="earned">{{ earnedThisVisit }}</strong>
          <mat-icon class="mi tiny ich">diamond</mat-icon>
        </p>

        <!-- The shaft IS the strike button: tap the vein to swing your pick. -->
        <div
          #shaftEl
          class="vein-stage"
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
          <div class="shaft">
            @for (lv of levels; track lv) {
              <div
                class="rung"
                [class.dug]="lv <= depth"
                [class.next]="lv === depth + 1"
                [class.heart]="lv === MAX"
              ></div>
            }
          </div>
          @if (strikesLeft > 0) {
            <div class="strike-cue">
              {{
                busy
                  ? 'Striking…'
                  : isHeartstoneNext
                    ? 'Tap to pry the Heartstone'
                    : 'Tap the vein to strike'
              }}
            </div>
          }

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

        @if (log) {
          <p class="vein-log">{{ log }}</p>
        }

        @if (strikesLeft > 0) {
          <div class="forecast" [class.heart]="isHeartstoneNext">
            <p class="forecast-title">
              Next strike · Level {{ level }}
              @if (isHeartstoneNext) {
                <span class="heart-tag"
                  ><mat-icon class="mi tiny">auto_awesome</mat-icon> The Heartstone</span
                >
              }
            </p>
            <ul class="odds-list">
              @for (o of outcomes; track o.label) {
                <li class="odds-row" [class.risk]="o.tone === 'risk'" [class.muted]="o.muted">
                  @if (o.svgIcon) {
                    <mat-icon class="mi odds-icon" [svgIcon]="o.svgIcon"></mat-icon>
                  } @else {
                    <mat-icon class="mi odds-icon ic-{{ o.tone }}">{{ o.icon }}</mat-icon>
                  }
                  <span class="odds-label">{{ o.label }}</span>
                  <span class="odds-val">{{ o.value }}</span>
                </li>
              }
            </ul>
          </div>

          @if (!isHeartstoneNext) {
            <p class="vein-hint goal">
              → Reach level {{ MAX }} for the <strong>Heartstone</strong>: +{{ HEART_ICHOR }}
              <mat-icon class="mi tiny ich">diamond</mat-icon> · a rare find
            </p>
          }
          <p class="vein-hint shared">
            Everyone digs the same shaft — your depth carries over for the next digger.
          </p>
        } @else {
          <p class="vein-hint out">Out of strikes — come back next time you land here.</p>
        }
        <button class="uc-btn close-btn" (click)="closed.emit()">Leave</button>
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
      h3 {
        margin: 0;
        color: #8fd0dd;
        display: flex;
        align-items: center;
        justify-content: center;
        gap: 6px;
      }
      .title-i {
        color: #8fd0dd;
      }
      .vein-sub {
        margin: 0;
        font-size: 0.85rem;
        color: #9aa79a;
        display: flex;
        flex-wrap: wrap;
        gap: 4px;
        align-items: center;
        justify-content: center;
      }
      .vein-sub strong {
        color: #8fd0dd;
      }
      .earned {
        color: #b6ffbf;
        display: inline-block;
      }
      .mi.tiny {
        font-size: 15px;
        width: 15px;
        height: 15px;
        vertical-align: middle;
      }
      .mi.ich {
        color: #b7e2ff;
      }
      .mi.mtl {
        color: #a9d38a;
      }
      /* The tappable shaft — the vein you strike. */
      .vein-stage {
        position: relative;
        overflow: hidden;
        display: flex;
        flex-direction: column;
        align-items: center;
        gap: 10px;
        padding: 14px 12px;
        border: 1px solid rgba(90, 150, 165, 0.28);
        border-radius: 12px;
        background: radial-gradient(120% 90% at 50% 0%, rgba(40, 62, 68, 0.55), rgba(16, 22, 24, 0.55));
        user-select: none;
        transition:
          transform 0.08s ease,
          border-color 0.15s ease,
          box-shadow 0.15s ease;
      }
      .vein-stage.tappable {
        cursor: pointer;
        border-color: rgba(143, 208, 221, 0.55);
      }
      .vein-stage.tappable:hover {
        box-shadow: 0 0 0 1px rgba(143, 208, 221, 0.35);
      }
      .vein-stage.tappable:active {
        transform: scale(0.98);
      }
      .vein-stage.heart.tappable {
        border-color: rgba(224, 192, 136, 0.7);
        box-shadow: 0 0 14px rgba(224, 192, 136, 0.25);
      }
      .shaft {
        display: flex;
        flex-direction: column-reverse;
        gap: 3px;
        width: 132px;
      }
      .rung {
        height: 12px;
        border-radius: 3px;
        background: #23282a;
        box-shadow: inset 0 2px 3px rgba(0, 0, 0, 0.6);
      }
      .rung.dug {
        background: linear-gradient(90deg, #2f6f7d 0%, #52a8ba 100%);
        box-shadow: inset 0 1px 2px rgba(255, 255, 255, 0.25);
      }
      .rung.next {
        outline: 1px dashed rgba(143, 208, 221, 0.85);
        animation: nextPulse 1.4s ease-in-out infinite;
      }
      .rung.heart {
        border: 1px solid rgba(224, 192, 136, 0.85);
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
      .strike-cue {
        font-size: 0.82rem;
        font-weight: 600;
        color: #b9e6ef;
      }
      .vein-stage.heart .strike-cue {
        color: #e7cf9c;
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
      .forecast {
        border: 1px solid rgba(90, 150, 165, 0.35);
        border-radius: 10px;
        padding: 10px 8px;
        background: rgba(20, 30, 32, 0.5);
      }
      .forecast.heart {
        border-color: rgba(224, 192, 136, 0.6);
        background: rgba(38, 30, 16, 0.5);
      }
      .forecast-title {
        margin: 0 0 8px;
        font-size: 0.85rem;
        font-weight: 600;
        color: #8fd0dd;
      }
      .heart-tag {
        color: #e0c088;
        display: inline-flex;
        align-items: center;
        gap: 3px;
      }
      /* Single gacha-style odds table: each swing's possible results, cave-in included. */
      .odds-list {
        list-style: none;
        margin: 0;
        padding: 0;
        display: flex;
        flex-direction: column;
        gap: 4px;
      }
      .odds-row {
        display: grid;
        grid-template-columns: 1.3rem 1fr auto;
        align-items: center;
        gap: 8px;
        padding: 4px 6px;
        border-radius: 6px;
        background: rgba(255, 255, 255, 0.03);
        font-size: 0.82rem;
        color: #d3ddd6;
        text-align: left;
      }
      .odds-icon {
        font-size: 18px;
        width: 18px;
        height: 18px;
      }
      .odds-icon.ic-gem {
        color: #b7e2ff;
      }
      .odds-icon.ic-molt {
        color: #a9d38a;
      }
      .odds-icon.ic-risk {
        color: #e6926f;
      }
      .odds-val {
        font-weight: 700;
        color: #b6ffbf;
        font-variant-numeric: tabular-nums;
      }
      .odds-row.risk {
        background: rgba(120, 46, 30, 0.22);
        color: #f0c3b2;
      }
      .odds-row.risk .odds-val {
        color: #ef8f6d;
      }
      .odds-row.muted {
        color: #6f7d72;
        font-style: italic;
      }
      .odds-row.muted .odds-val {
        color: #6f7d72;
      }
      .vein-hint {
        margin: 0;
        font-size: 0.78rem;
        color: #8a978a;
        display: inline-flex;
        gap: 3px;
        align-items: center;
        justify-content: center;
      }
      .vein-hint.goal {
        color: #c9b07a;
      }
      .vein-hint.goal strong {
        color: #e0c088;
      }
      .vein-hint.shared {
        color: #7f8c84;
        font-size: 0.72rem;
      }
      .vein-hint.out {
        color: #d08a6f;
      }
      .close-btn {
        margin-top: 4px;
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

  private get gemPct(): number {
    return Math.round(Math.min(1, VEIN_ICHOR_BASE + this.level * VEIN_ICHOR_PER_LEVEL) * 100);
  }

  private get riskPct(): number {
    return Math.round(this.level * VEIN_CAVE_IN_PCT_PER_LEVEL * 100);
  }

  private get caveDmg(): number {
    return this.level * VEIN_CAVE_IN_DMG_PER_LEVEL;
  }

  /** Bonus-item odds for this level, or null in the shallow band (no items). */
  private get itemChance(): { pct: number; label: string } | null {
    const l = this.level;
    if (l >= VEIN_ITEM_RARE_BAND.min) {
      return { pct: Math.round(VEIN_ITEM_RARE_BAND.chance * 100), label: 'Rare find' };
    }
    if (l >= VEIN_ITEM_CONSUMABLE_BAND.min && l <= VEIN_ITEM_CONSUMABLE_BAND.max) {
      return { pct: Math.round(VEIN_ITEM_CONSUMABLE_BAND.chance * 100), label: 'Consumable' };
    }
    return null;
  }

  /** The next swing's full result table — every possible pull, cave-in last as
   *  the "bad roll". Rewards read as a Heartstone jackpot at max depth. */
  protected get outcomes(): Outcome[] {
    const rows: Outcome[] = [];
    if (this.isHeartstoneNext) {
      rows.push({ icon: 'diamond', label: 'Gemstones', value: `+${this.HEART_ICHOR}`, tone: 'gem' });
      rows.push({ svgIcon: 'uc-pouch', label: 'Rare find', value: 'guaranteed', tone: 'item' });
      rows.push({ icon: 'grass', label: 'Molting', value: '+1', tone: 'molt' });
    } else {
      rows.push({ icon: 'diamond', label: 'Gemstone', value: `${this.gemPct}%`, tone: 'gem' });
      const item = this.itemChance;
      if (item) {
        rows.push({ svgIcon: 'uc-pouch', label: item.label, value: `${item.pct}%`, tone: 'item' });
      } else {
        rows.push({
          svgIcon: 'uc-pouch',
          label: `Finds start at L${this.CONSUMABLE_MIN}`,
          value: '—',
          tone: 'item',
          muted: true,
        });
      }
      rows.push({ icon: 'grass', label: 'Molting', value: '+1', tone: 'molt' });
    }
    rows.push({
      icon: 'warning',
      label: `Cave-in · ${this.caveDmg} dmg, visit ends`,
      value: `${this.riskPct}%`,
      tone: 'risk',
    });
    return rows;
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
