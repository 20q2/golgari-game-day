# Undercity Turn Dial HUD Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add an opt-in second HUD skin for the Undercity board tab — a circular bottom-right "turn dial" (die icon + rolls remaining + roll-bank gauge ring) ringed by a fixed 4-slot arc of satellite buttons — leaving the existing bottom action band as the untouched default.

**Architecture:** Three additions, zero logic relocation. A root `HudSkinService` holds the `'band' | 'dial'` preference (localStorage-backed) because the toggle lives in the page header while the dial renders inside the board tab. A purely presentational `UcTurnDialComponent` renders the dial, arc, and face ring from inputs and emits events. `BoardTabComponent` wires those events to methods it already has, and two `@if`s decide which skin renders. Deleting the component and the two `@if`s restores today's build exactly.

**Tech Stack:** Angular 20 standalone components, signals, Angular Material icons, SCSS (inline styles are SCSS — `angular.json` sets `inlineStyleLanguage: scss`).

**Spec:** [specs/2026-08-13-undercity-turn-dial-hud-design.md](2026-08-13-undercity-turn-dial-hud-design.md)

---

## Read this before starting

**There is no frontend test runner.** Karma/Jasmine specs were removed and `tsconfig.spec.json` is gone. `ng test` does not work — see `CLAUDE.md`. `npm run lint` is also unreliable in this repo. **The verification gate for every task is `npm run build` plus a named manual check.** Do not write `.spec.ts` files; nothing would run them.

**This is a client-only change.** No Python, no `infrastructure/`, no balance tables. The pytest suite is untouched and does not need running.

**Where things live:**

| Thing | Path |
| --- | --- |
| Board tab template (1739 lines) | `src/app/undercity/tabs/board-tab.component.html` |
| Board tab logic (3616 lines) | `src/app/undercity/tabs/board-tab.component.ts` |
| Board tab styles | `src/app/undercity/tabs/board-tab.component.scss` |
| Page shell / HUD header | `src/app/undercity/undercity-page.component.{html,ts,scss}` |
| Custom `uc-*` SVG icons | `src/app/undercity/data/icons.ts`, registered in `src/app/app.ts:28` |

**Conventions that matter here:**

- Standalone components only. Explicit `imports:` array. No `NgModule`s.
- `.mi` (Material icon sizing) and `.uc-btn` are **not global** — every component redeclares them in its own styles. The dial component must define its own `.mi` sizing.
- Small self-contained widgets in `tabs/` use a single `.ts` with inline `template` and `styles` (see `poke-wheel.component.ts`, `hazard-wheel.component.ts`). Follow that for the dial. Larger tabs use separate `.html`/`.scss` files.
- No emoji in game UI. Use Material ligatures or `uc-*` svgIcons.
- Board panning: `board-canvas.ts:1421` excludes `button, a, input, select, textarea, [role="button"], [data-uc-panel]` from starting a pan. **`<button>` elements are already safe.** A non-button wrapper is not.

**Geometry constants** (derived, do not re-derive):

- Wrapper box 150×150, dial centre at (104, 104) within it → centre sits 46px from the scene's right and bottom edges.
- Dial 72px diameter (radius 36).
- Satellite ring radius 66, satellites 30px, at angles **180° / 210° / 240° / 270°** (180 = left of dial, 270 = directly above). 30° spacing = 34.6px between centres, so 30px buttons clear by 4.6px.
- Face ring radius 58, faces 24px, spread evenly across 150°→300° (6 faces at 30°, or 7 at 25° when the random slot shows).
- Screen coords with y down: `left = 104 + r*cos(θ)`, `top = 104 + r*sin(θ)`. At 270°, `sin = -1`, so the point is *above* centre. This is correct.

---

## File structure

| File | Action | Responsibility |
| --- | --- | --- |
| `src/app/undercity/services/hud-skin.service.ts` | Create | Holds the `'band' \| 'dial'` preference, persists to localStorage. Nothing else. |
| `src/app/undercity/tabs/turn-dial.component.ts` | Create | Renders dial + arc + face ring from inputs; emits `primary`, `pickFace`, `act`. No store, no API, no game logic. |
| `src/app/undercity/undercity-page.component.html` | Modify | Add the header toggle button. |
| `src/app/undercity/undercity-page.component.ts` | Modify | Inject `HudSkinService`. |
| `src/app/undercity/undercity-page.component.scss` | Modify | Style the header toggle. |
| `src/app/undercity/tabs/board-tab.component.ts` | Modify | Inject `HudSkinService`; add `bandHasDecision()`, `exclusiveDecision()`, `dialSatellites()`, `dialMode()`, `dialOverflow()`, `onDialAct()`, `dialNotes()`. |
| `src/app/undercity/tabs/board-tab.component.html` | Modify | Mount the dial in `.board-scene`; gate the routine `.action-row` branch, the band shell, `.bag-fab`, and `.pet-quickuse` on the skin. |
| `src/app/undercity/tabs/board-tab.component.scss` | Modify | Overflow sheet styles. |

---

## Task 1: HudSkinService

**Files:**
- Create: `src/app/undercity/services/hud-skin.service.ts`

- [ ] **Step 1: Create the service**

```ts
import { Injectable, computed, signal } from '@angular/core';

/** localStorage key for the board HUD skin preference. */
const HUD_SKIN_KEY = 'uc-hud-skin';

/** `band` = the classic bottom action bar. `dial` = the radial turn dial. */
export type HudSkin = 'band' | 'dial';

/**
 * Board HUD skin preference, remembered per device.
 *
 * A service rather than a component signal because the toggle button lives in
 * the page header (`undercity-page.component`) while the dial it controls
 * renders inside the board tab. Deliberately not a general settings framework —
 * the app has no settings UI and inventing one is out of scope.
 */
@Injectable({ providedIn: 'root' })
export class HudSkinService {
  private readonly current = signal<HudSkin>(
    localStorage.getItem(HUD_SKIN_KEY) === 'dial' ? 'dial' : 'band',
  );

  readonly skin = this.current.asReadonly();

  /** True when the radial dial replaces the board's routine action row. */
  readonly isDial = computed(() => this.current() === 'dial');

  toggle(): void {
    this.set(this.current() === 'dial' ? 'band' : 'dial');
  }

  set(skin: HudSkin): void {
    this.current.set(skin);
    localStorage.setItem(HUD_SKIN_KEY, skin);
  }
}
```

- [ ] **Step 2: Verify it compiles**

Run: `npm run build`
Expected: build succeeds. Nothing changes visually — the service has no consumer yet.

- [ ] **Step 3: Commit**

```bash
git add src/app/undercity/services/hud-skin.service.ts
git commit -m "feat(undercity): add HudSkinService for the board HUD skin preference"
```

---

## Task 2: Header toggle

The `.hud` header is `display: flex; justify-content: space-between`. Its in-flow children are `.hud-avatar-wrap` and `.hud-creature` (`flex: 1; max-width: 340px`); `.hud-purse` and `.hud-buffs` are absolutely positioned *below* the header, so a new in-flow button at the end of the row lands at the right edge and collides with nothing.

**Files:**
- Modify: `src/app/undercity/undercity-page.component.ts`
- Modify: `src/app/undercity/undercity-page.component.html` (insert after the `.hud-creature` block, before `.hud-purse`)
- Modify: `src/app/undercity/undercity-page.component.scss`

- [ ] **Step 1: Inject the service**

In `undercity-page.component.ts`, add the import beside the other service imports:

```ts
import { HudSkinService } from './services/hud-skin.service';
```

and add this field next to `protected readonly store = inject(UndercityStateService);`:

```ts
  /** Board HUD skin switch — drives the header toggle button. */
  protected readonly hudSkin = inject(HudSkinService);
```

- [ ] **Step 2: Add the button to the template**

In `undercity-page.component.html`, find the closing `</div>` of the `.hud-creature` block (immediately before the `<!-- The purse floats a row below the toolbar ... -->` comment) and insert directly after it:

```html
          <!-- HUD skin switch: flips the board's routine controls between the
               classic bottom action bar and the radial turn dial. Player
               preference, remembered per device. -->
          <button
            type="button"
            class="hud-skin-toggle"
            [class.active]="hudSkin.isDial()"
            [attr.aria-pressed]="hudSkin.isDial()"
            aria-label="Switch HUD style"
            [title]="
              hudSkin.isDial() ? 'Switch to the classic action bar' : 'Switch to the turn dial'
            "
            (click)="hudSkin.toggle()"
          >
            <mat-icon class="mi">dashboard_customize</mat-icon>
          </button>
```

- [ ] **Step 3: Style it**

Append to `undercity-page.component.scss`:

```scss
// HUD skin switch. Sits at the right end of the header row; `.hud-buffs` and
// `.hud-purse` float a row below, so nothing collides.
.hud-skin-toggle {
  flex-shrink: 0;
  width: 30px;
  height: 30px;
  display: inline-flex;
  align-items: center;
  justify-content: center;
  padding: 0;
  border-radius: 50%;
  background: rgba(74, 124, 89, 0.14);
  border: 1px solid rgba(74, 124, 89, 0.4);
  color: #9fc0a4;
  cursor: pointer;
  transition:
    background 0.12s ease,
    border-color 0.12s ease,
    color 0.12s ease;

  .mi {
    font-size: 1.05rem;
    height: 1.05rem;
    width: 1.05rem;
  }

  &.active {
    background: rgba(74, 124, 89, 0.38);
    border-color: rgba(143, 214, 162, 0.8);
    color: #eafff0;
  }
}
```

- [ ] **Step 4: Verify**

Run: `npm run build`
Expected: build succeeds.

Then run `npm start`, reach the board (see the `run-undercity` skill for getting a live game state), and confirm:
- A round icon button sits at the right end of the header on every tab.
- Tapping it visibly toggles the `.active` styling (brighter fill and border).
- Reloading the page preserves the state.
- The board's action band is still present and unchanged in both states — nothing else is wired yet.

- [ ] **Step 5: Commit**

```bash
git add src/app/undercity/undercity-page.component.ts src/app/undercity/undercity-page.component.html src/app/undercity/undercity-page.component.scss
git commit -m "feat(undercity): add HUD skin toggle to the page header"
```

---

## Task 3: UcTurnDialComponent (dial only, no arc yet)

Build the component with the dial, gauge, and face ring rendering, but pass it an empty satellite array for now. The arc is populated in Task 5.

**Note on reactivity:** inputs are plain `@Input` fields, so derived values are exposed as **methods**, not `computed()`. A `computed()` reading a plain `@Input` field never recomputes when that input changes — that trap is why `gaugeDash()`, `slotPos()` and `faces()` are methods here. They are recomputed per change-detection cycle, which is negligible at this size.

**Files:**
- Create: `src/app/undercity/tabs/turn-dial.component.ts`

- [ ] **Step 1: Create the component**

```ts
import {
  ChangeDetectionStrategy,
  Component,
  EventEmitter,
  Input,
  Output,
} from '@angular/core';
import { MatIconModule } from '@angular/material/icon';

/** Dial primary-action mode. `blink` and `pick` open the face ring; `roll` rolls. */
export type DialMode = 'roll' | 'blink' | 'pick';

/**
 * One satellite button on the arc. `slot` is a FIXED position — an unavailable
 * action leaves its slot empty rather than letting the others reflow, so icon
 * positions never move and muscle memory holds.
 */
export interface DialSatellite {
  key: string;
  /** 0 = 180deg (left of the dial) … 3 = 270deg (directly above it). */
  slot: 0 | 1 | 2 | 3;
  /** Tooltip and aria-label. */
  label: string;
  /** Material icon ligature. */
  icon?: string;
  /** Registered `uc-*` svgIcon name (see data/icons.ts). */
  svgIcon?: string;
  /** Sprite image URL — used by the pet slot. */
  spriteUrl?: string;
  /** Small corner badge, e.g. a bag count. */
  badge?: string | null;
  /** `ctx` tints the slot amber for current-space actions. */
  tone?: 'ctx';
  disabled?: boolean;
  /** Gold pulse, e.g. a pet ability that is ready. */
  ready?: boolean;
}

/** Wrapper box, and the dial centre's offset from its top-left corner. */
const BOX = 150;
const CENTRE = 104;
/** Satellite ring: radius, and the fixed angle of each slot in degrees. */
const SAT_R = 66;
const SLOT_ANGLES = [180, 210, 240, 270];
/** Face ring: radius, and the angular span the faces spread across. */
const FACE_R = 58;
const FACE_FROM = 150;
const FACE_TO = 300;
/** Gauge geometry in the 100x100 SVG viewBox. */
const GAUGE_R = 42;
const RESTED_R = 48;
const GAUGE_CIRC = 2 * Math.PI * GAUGE_R;
const RESTED_CIRC = 2 * Math.PI * RESTED_R;

/**
 * Radial turn control for the board tab — the `dial` HUD skin's replacement for
 * the routine half of the action band. Purely presentational: every input is
 * supplied by BoardTabComponent and every tap is emitted straight back out. No
 * store access, no API calls, no game rules.
 *
 * The wrapper is `pointer-events: none` with `auto` on the buttons, so the board
 * canvas still pans through the gaps in the arc. Buttons additionally never
 * start a pan — board-canvas.ts excludes them.
 */
@Component({
  selector: 'app-uc-turn-dial',
  standalone: true,
  changeDetection: ChangeDetectionStrategy.OnPush,
  imports: [MatIconModule],
  template: `
    <div class="dial-box">
      <!-- Transient notes (first-turn coach nudge, Blink recharge) stack above. -->
      @if (notes.length) {
        <div class="dial-notes">
          @for (note of notes; track note) {
            <span class="dial-note">{{ note }}</span>
          }
        </div>
      }

      <!-- Face ring: Blink (production) and dev Pick choose the die value. -->
      @if (faceRingOpen) {
        @for (f of faces(); track f.value) {
          <button
            type="button"
            class="dial-face"
            [class.random]="f.value === 0"
            [style.left.px]="f.left"
            [style.top.px]="f.top"
            [disabled]="disabled"
            [attr.aria-label]="f.value === 0 ? 'Roll at random' : 'Move ' + f.value"
            [title]="f.value === 0 ? 'Roll at random — keeps Blink ready' : 'Move ' + f.value"
            (click)="pickFace.emit(f.value)"
          >
            @if (f.value === 0) {
              <mat-icon class="mi">casino</mat-icon>
            } @else {
              {{ f.value }}
            }
          </button>
        }
      }

      <!-- Satellite arc -->
      @for (s of satellites; track s.key) {
        <button
          type="button"
          class="dial-sat"
          [class.ctx]="s.tone === 'ctx'"
          [class.ready]="!!s.ready"
          [style.left.px]="slotPos(s.slot).left"
          [style.top.px]="slotPos(s.slot).top"
          [disabled]="!!s.disabled"
          [attr.aria-label]="s.label"
          [title]="s.label"
          (click)="act.emit(s.key)"
        >
          @if (s.spriteUrl) {
            <img class="dial-sat-sprite" [src]="s.spriteUrl" alt="" />
          } @else if (s.svgIcon) {
            <mat-icon class="mi" [svgIcon]="s.svgIcon"></mat-icon>
          } @else if (s.icon) {
            <mat-icon class="mi">{{ s.icon }}</mat-icon>
          }
          @if (s.badge) {
            <span class="dial-sat-badge">{{ s.badge }}</span>
          }
        </button>
      }

      <!-- The dial itself -->
      <button
        type="button"
        class="dial"
        [class.dimmed]="dimmed"
        [disabled]="disabled || dimmed"
        [attr.aria-label]="ariaLabel()"
        [title]="ariaLabel()"
        (click)="primary.emit()"
      >
        <svg class="dial-gauge" viewBox="0 0 100 100" aria-hidden="true">
          <circle class="gauge-track" cx="50" cy="50" [attr.r]="gaugeR" />
          <circle
            class="gauge-arc"
            cx="50"
            cy="50"
            [attr.r]="gaugeR"
            [style.stroke-dasharray]="gaugeDash()"
            transform="rotate(-90 50 50)"
          />
          @if (restedFrac > 0) {
            <circle
              class="gauge-rested"
              cx="50"
              cy="50"
              [attr.r]="restedR"
              [style.stroke-dasharray]="restedDash()"
              transform="rotate(-90 50 50)"
            />
          }
        </svg>
        <span class="dial-inner">
          @if (mode === 'roll') {
            <img class="dial-die" src="undercity/icons/die.png" alt="" />
          } @else if (mode === 'blink') {
            <mat-icon class="mi dial-mode-icon">bolt</mat-icon>
          } @else {
            <mat-icon class="mi dial-mode-icon">casino</mat-icon>
          }
          <b class="dial-count" [class.rolled]="rolledValue !== null">{{ countLabel() }}</b>
          @if (countdown) {
            <span class="dial-countdown">{{ countdown }}</span>
          }
        </span>
      </button>
    </div>
  `,
  styles: [
    `
      :host {
        position: absolute;
        right: 6px;
        bottom: 6px;
        z-index: 7;
        // The board canvas still pans through the arc's gaps; only the buttons
        // themselves take taps.
        pointer-events: none;
      }

      .dial-box {
        position: relative;
        width: 150px;
        height: 150px;
      }

      button {
        pointer-events: auto;
      }

      .mi {
        font-size: 1.15rem;
        height: 1.15rem;
        width: 1.15rem;
      }

      .dial {
        position: absolute;
        left: 104px;
        top: 104px;
        transform: translate(-50%, -50%);
        width: 72px;
        height: 72px;
        padding: 0;
        border-radius: 50%;
        background: radial-gradient(circle at 35% 30%, #5d8f63, #2e4a33);
        border: 2px solid rgba(143, 214, 162, 0.9);
        box-shadow:
          0 0 14px rgba(103, 194, 128, 0.4),
          inset 0 2px 0 rgba(255, 255, 255, 0.14);
        color: #eafff0;
        cursor: pointer;
        transition:
          opacity 0.14s ease,
          transform 0.1s ease;

        &:active:not(:disabled) {
          transform: translate(-50%, -50%) scale(0.95);
        }

        &:disabled {
          opacity: 0.45;
          cursor: default;
        }

        &.dimmed {
          opacity: 0.32;
        }
      }

      .dial-gauge {
        position: absolute;
        inset: 0;
        width: 100%;
        height: 100%;
        pointer-events: none;
      }

      .gauge-track {
        fill: none;
        stroke: rgba(0, 0, 0, 0.32);
        stroke-width: 6;
      }

      .gauge-arc {
        fill: none;
        stroke: #f2a900;
        stroke-width: 6;
        stroke-linecap: round;
        transition: stroke-dasharray 0.3s ease;
      }

      .gauge-rested {
        fill: none;
        stroke: #7fb2ff;
        stroke-width: 2;
        stroke-linecap: round;
      }

      .dial-inner {
        position: relative;
        display: flex;
        flex-direction: column;
        align-items: center;
        justify-content: center;
        gap: 1px;
        line-height: 1;
      }

      .dial-die {
        width: 13px;
        height: 13px;
        image-rendering: pixelated;
      }

      .dial-mode-icon {
        font-size: 0.95rem;
        height: 0.95rem;
        width: 0.95rem;
        color: #f2c95c;
      }

      .dial-count {
        font-size: 1.15rem;
        font-weight: 800;
        font-variant-numeric: tabular-nums;

        &.rolled {
          color: #f2c95c;
        }
      }

      .dial-countdown {
        font-size: 0.42rem;
        letter-spacing: 0.3px;
        opacity: 0.8;
      }

      .dial-sat {
        position: absolute;
        transform: translate(-50%, -50%);
        width: 30px;
        height: 30px;
        padding: 0;
        border-radius: 50%;
        background: rgba(26, 24, 21, 0.9);
        border: 1px solid rgba(74, 124, 89, 0.75);
        color: #b7e4c7;
        cursor: pointer;
        backdrop-filter: blur(2px);
        display: inline-flex;
        align-items: center;
        justify-content: center;

        &:active:not(:disabled) {
          transform: translate(-50%, -50%) scale(0.92);
        }

        &:disabled {
          opacity: 0.4;
          cursor: default;
        }

        &.ctx {
          border-color: rgba(242, 169, 0, 0.8);
          color: #f2c95c;
        }

        &.ready {
          border-color: #f2a900;
          box-shadow: 0 0 8px rgba(242, 169, 0, 0.55);
        }
      }

      .dial-sat-sprite {
        width: 22px;
        height: 22px;
        image-rendering: pixelated;
      }

      .dial-sat-badge {
        position: absolute;
        top: -3px;
        right: -3px;
        min-width: 15px;
        height: 15px;
        padding: 0 3px;
        border-radius: 8px;
        background: #4a7c59;
        color: #eafff0;
        font-size: 0.6rem;
        font-weight: 700;
        line-height: 15px;
        font-variant-numeric: tabular-nums;
      }

      .dial-face {
        position: absolute;
        transform: translate(-50%, -50%);
        width: 24px;
        height: 24px;
        padding: 0;
        border-radius: 50%;
        background: #2a3324;
        border: 1px solid rgba(143, 214, 162, 0.7);
        color: #eafff0;
        font-size: 0.72rem;
        font-weight: 700;
        cursor: pointer;
        display: inline-flex;
        align-items: center;
        justify-content: center;
        animation: dial-face-in 0.14s ease;

        .mi {
          font-size: 0.8rem;
          height: 0.8rem;
          width: 0.8rem;
        }

        &.random {
          border-color: rgba(242, 169, 0, 0.8);
          color: #f2c95c;
        }
      }

      .dial-notes {
        position: absolute;
        right: 0;
        bottom: 100%;
        margin-bottom: 4px;
        display: flex;
        flex-direction: column;
        align-items: flex-end;
        gap: 3px;
      }

      .dial-note {
        pointer-events: none;
        max-width: 190px;
        padding: 3px 7px;
        border-radius: 10px;
        background: rgba(21, 23, 15, 0.92);
        border: 1px solid rgba(103, 194, 128, 0.45);
        color: #b7e4c7;
        font-size: 0.62rem;
        line-height: 1.25;
        text-align: right;
      }

      @keyframes dial-face-in {
        from {
          opacity: 0;
          transform: translate(-50%, -50%) scale(0.6);
        }
        to {
          opacity: 1;
          transform: translate(-50%, -50%) scale(1);
        }
      }
    `,
  ],
})
export class UcTurnDialComponent {
  /** Which primary action the dial currently offers. */
  @Input() mode: DialMode = 'roll';
  /** Rolls banked. Ignored for display when `infinite` is true. */
  @Input() count = 0;
  /** Server DEBUG: show an infinity glyph instead of the count. */
  @Input() infinite = false;
  /** Roll-bank gauge fill, 0..1 (`rollsBanked / ROLL_CAP`). */
  @Input() gaugeFrac = 0;
  /** Rested-roll outer arc fill, 0..1. */
  @Input() restedFrac = 0;
  /** Short countdown to the next timed roll, e.g. "4m". Null hides the line. */
  @Input() countdown: string | null = null;
  /** The value just rolled — replaces the count while a move is resolving. */
  @Input() rolledValue: number | null = null;
  /** Hard-blocked (out of rolls, pending pickups). Deliberately no reason text. */
  @Input() disabled = false;
  /** An exclusive decision is pending in the band — visible but inert. */
  @Input() dimmed = false;
  /** Face ring visibility (Blink / dev Pick). */
  @Input() faceRingOpen = false;
  /** Include the 7th "random" slot — Blink only; dev Pick has no random. */
  @Input() faceRandom = false;
  @Input() satellites: DialSatellite[] = [];
  /** Transient one-line notes stacked above the dial. */
  @Input() notes: string[] = [];

  /** Dial tapped. */
  @Output() readonly primary = new EventEmitter<void>();
  /** A die face chosen from the ring. 0 means the random slot. */
  @Output() readonly pickFace = new EventEmitter<number>();
  /** A satellite tapped, carrying its `key`. */
  @Output() readonly act = new EventEmitter<string>();

  protected readonly gaugeR = GAUGE_R;
  protected readonly restedR = RESTED_R;

  /** Fixed slot position, in px from the wrapper's top-left. */
  protected slotPos(slot: 0 | 1 | 2 | 3): { left: number; top: number } {
    return this.polar(SAT_R, SLOT_ANGLES[slot]);
  }

  /** Face ring positions. Value 0 is the random slot, rendered last. */
  protected faces(): { value: number; left: number; top: number }[] {
    const values = [1, 2, 3, 4, 5, 6];
    if (this.faceRandom) values.push(0);
    const step = (FACE_TO - FACE_FROM) / (values.length - 1);
    return values.map((value, i) => ({ value, ...this.polar(FACE_R, FACE_FROM + step * i) }));
  }

  protected countLabel(): string {
    if (this.rolledValue !== null) return String(this.rolledValue);
    return this.infinite ? '∞' : String(this.count);
  }

  protected gaugeDash(): string {
    return `${Math.max(0, Math.min(1, this.gaugeFrac)) * GAUGE_CIRC} ${GAUGE_CIRC}`;
  }

  protected restedDash(): string {
    return `${Math.max(0, Math.min(1, this.restedFrac)) * RESTED_CIRC} ${RESTED_CIRC}`;
  }

  protected ariaLabel(): string {
    if (this.mode === 'blink') return 'Blink — choose your die face';
    if (this.mode === 'pick') return 'Pick your die face';
    const left = this.infinite ? 'unlimited' : `${this.count}`;
    return `Roll (${left} rolls left)`;
  }

  /** Screen-space point on a circle about the dial centre. y grows downward, so
   *  270deg lands directly ABOVE the centre. */
  private polar(r: number, deg: number): { left: number; top: number } {
    const rad = (deg * Math.PI) / 180;
    return { left: CENTRE + r * Math.cos(rad), top: CENTRE + r * Math.sin(rad) };
  }
}
```

- [ ] **Step 2: Verify it compiles**

Run: `npm run build`
Expected: build succeeds. Still no visual change — nothing mounts it yet.

- [ ] **Step 3: Commit**

```bash
git add src/app/undercity/tabs/turn-dial.component.ts
git commit -m "feat(undercity): add UcTurnDialComponent presentational widget"
```

---

## Task 4: Mount the dial and gate the routine action row

This is the first end-to-end slice: with the dial skin on you can roll from the dial. The band shell still renders (holding its status stack); Task 6 removes it.

`ROLL_CAP` is a display mirror of `undercity_config.py:17`. Per repo convention, note that it must be updated if the server value is tuned.

**Files:**
- Modify: `src/app/undercity/tabs/board-tab.component.ts`
- Modify: `src/app/undercity/tabs/board-tab.component.html:216-255` (the `.action-row` block) and `.board-scene`

- [ ] **Step 1: Wire the service and the dial's inputs**

In `board-tab.component.ts`, add to the imports at the top:

```ts
import { HudSkinService } from '../services/hud-skin.service';
import { UcTurnDialComponent, DialMode, DialSatellite } from './turn-dial.component';
```

Add `UcTurnDialComponent` to the component's `imports:` array.

Add near the other module-level constants in that file:

```ts
/** Display mirror of ROLL_CAP in infrastructure/lambda/undercity_config.py.
 *  Update this if the server cap is tuned. */
const ROLL_CAP = 10;
```

Add these members (put them next to the existing roll signals around line 1984 so the roll logic stays together):

```ts
  /** Board HUD skin — `dial` swaps the routine action row for the turn dial. */
  protected readonly hudSkin = inject(HudSkinService);

  /** Which primary action the dial offers. Mirrors the band's Roll/Blink/Pick. */
  protected dialMode(): DialMode {
    if (this.blinkAllowed()) return 'blink';
    if (this.pickAllowed()) return 'pick';
    return 'roll';
  }

  /** Roll-bank gauge fill. Not a regen countdown: nextRollLabel() is
   *  minute-granularity and poll-refreshed, and a timed arc would read wrong
   *  while rested rolls pay a double tick. */
  protected dialGaugeFrac(): number {
    return Math.min(1, this.rollsBanked() / ROLL_CAP);
  }

  protected dialRestedFrac(): number {
    return Math.min(1, this.restedRolls() / ROLL_CAP);
  }

  /** Transient notes above the dial: the first-turn coach nudge and the Blink
   *  recharge hint, both of which live in the band under the classic skin. */
  protected dialNotes(): string[] {
    const notes: string[] = [];
    if (this.showCoach()) notes.push('New here? Tap the dial to take your first turn.');
    if (this.blinkRecharging()) notes.push('Blink recharges — ready next turn');
    if (this.restedRolls() > 0) notes.push(`${this.restedRolls()} rested — next rolls come twice as fast`);
    return notes;
  }

  /** Dial tapped: Blink and dev Pick open the face ring, plain Roll rolls. */
  protected onDialPrimary(): void {
    if (this.dialMode() === 'roll') {
      void this.roll();
      return;
    }
    this.showRollPicker.set(!this.showRollPicker());
  }

  /** A face chosen from the ring. 0 is the random slot, which rolls normally and
   *  so leaves Blink ready — same contract as the band's `.pick-random`. */
  protected onDialFace(value: number): void {
    if (value === 0) {
      void this.roll();
      return;
    }
    this.pickRoll(value);
  }
```

- [ ] **Step 2: Gate the routine action row**

In `board-tab.component.html`, find the `<div class="action-row">` opening tag (line ~216, inside the `@else` branch commented "Routine turn actions") and wrap the whole `.action-row` element in a skin check. Change:

```html
        <div class="action-row">
```

to:

```html
        @if (!hudSkin.isDial()) {
        <div class="action-row">
```

and add the matching close immediately after that div's `</div>` (the one directly before the `<!-- Extras drop onto their own line(s) below the button row -->` comment):

```html
        </div>
        }
```

Then wrap the extras block the same way, since the coach pill, blink note, and roll picker all move onto the dial. Change the extras guard from:

```html
        @if (!rolling() && !store.you()?.pendingMove) {
```

to:

```html
        @if (!hudSkin.isDial() && !rolling() && !store.you()?.pendingMove) {
```

- [ ] **Step 3: Mount the dial in the board scene**

In `board-tab.component.html`, insert immediately before the closing `</div>` of `.board-scene` (right after the `.biome-chip` block):

```html
    <!-- Radial turn dial: the `dial` HUD skin's replacement for the routine
         action row. All handlers still live on this component — the dial only
         renders state and emits taps. -->
    @if (hudSkin.isDial()) {
      <app-uc-turn-dial
        [mode]="dialMode()"
        [count]="rollsBanked()"
        [infinite]="debugMode()"
        [gaugeFrac]="dialGaugeFrac()"
        [restedFrac]="dialRestedFrac()"
        [countdown]="nextRollLabel()"
        [rolledValue]="rolling() || store.you()?.pendingMove ? rolledValue() : null"
        [disabled]="busy() || rolling() || !!store.you()?.pendingMove || rollBlocked()"
        [faceRingOpen]="showRollPicker()"
        [faceRandom]="blinkAllowed()"
        [notes]="dialNotes()"
        (primary)="onDialPrimary()"
        (pickFace)="onDialFace($event)"
      />
    }
```

- [ ] **Step 4: Verify**

Run: `npm run build`
Expected: build succeeds.

Then `npm start`, reach the board, and with the toggle **off** confirm the band looks and behaves exactly as before. Switch the toggle **on** and confirm:
- A 72px dial sits in the bottom-right of the board with an amber gauge arc and the roll count.
- Tapping it rolls, and the creature moves.
- The gauge shrinks as rolls are spent.
- At zero rolls the dial dims and is inert, and the countdown text shows beneath the count.
- Dragging *from* the dial does not pan the board; dragging in the empty space between the dial and the arc still pans.
- The band above the tab bar is now empty of routine buttons but still present.

- [ ] **Step 5: Commit**

```bash
git add src/app/undercity/tabs/board-tab.component.ts src/app/undercity/tabs/board-tab.component.html
git commit -m "feat(undercity): mount the turn dial and gate the routine action row"
```

---

## Task 5: Satellite arc

Slot assignment, with slot 3 doubling as the overflow entry point:

| Slot | Angle | Content | Empty when |
| --- | --- | --- | --- |
| 0 | 180° | Bag (`uc-pouch` + count badge) | bag empty |
| 1 | 210° | Cast (`auto_fix_high`) | no castable spells or scrolls |
| 2 | 240° | Pet (sprite, ready pulse) | no active usable pet |
| 3 | 270° | The single current-space action, **or** a `more_horiz` button when 2+ apply | nothing applies |

The spec's fifth 300° slot is dropped: five satellites across the 180°→270° quarter need 22.5° spacing, which is 24px between centres for 30px buttons — they would overlap. Four slots at 30° is the maximum that fits, so overflow collapses into slot 3.

**Files:**
- Modify: `src/app/undercity/tabs/board-tab.component.ts`
- Modify: `src/app/undercity/tabs/board-tab.component.html`
- Modify: `src/app/undercity/tabs/board-tab.component.scss`

- [ ] **Step 1: Build the space-action list and satellites**

Add to `board-tab.component.ts`, beside the members from Task 4:

```ts
  /** Current-space actions, richest first. Slot 3 shows the only entry, or a
   *  `more` button when several apply (a Grime Gorger on a Bazaar tile, or an
   *  admin anywhere). Admin Move never takes a thumb slot of its own. */
  protected spaceActions(): DialSatellite[] {
    if (this.rolling() || this.store.you()?.pendingMove) return [];
    const out: DialSatellite[] = [];
    const facility: Partial<Record<string, { icon: string; label: string }>> = {
      shop: { icon: 'storefront', label: 'Bazaar' },
      ossuary: { icon: 'casino', label: 'The Casino' },
      witch: { icon: 'auto_fix_high', label: 'The Witch' },
      trading_post: { icon: 'swap_horiz', label: 'Trading Post' },
      excavation: { icon: 'grid_view', label: 'Dig Site' },
      crystal_vein: { icon: 'diamond', label: 'Crystal Vein' },
      vault_lock: { icon: 'dialpad', label: 'Guildvault' },
    };
    const here = facility[this.nodeType() ?? ''];
    if (here) out.push({ key: this.nodeType()!, slot: 3, tone: 'ctx', ...here });
    if (this.canReclaim()) {
      out.push({ key: 'reclaim', slot: 3, tone: 'ctx', icon: 'compost', label: 'Reclaim this ground' });
    }
    if (this.isAdmin()) {
      out.push({ key: 'freemove', slot: 3, tone: 'ctx', icon: 'open_with', label: 'Admin: move anywhere' });
    }
    return out;
  }

  /** True when slot 3 is a `more` button rather than a single action. */
  protected dialOverflow(): boolean {
    return this.spaceActions().length > 1;
  }

  /** Everything the arc shows. Unavailable actions simply omit their slot — the
   *  remaining ones never reflow, so positions stay learnable. */
  protected dialSatellites(): DialSatellite[] {
    const out: DialSatellite[] = [];
    const bag = this.store.you()?.bag?.length ?? 0;
    if (bag > 0) {
      out.push({ key: 'bag', slot: 0, svgIcon: 'uc-pouch', label: 'Open your bag', badge: String(bag) });
    }
    if (this.castableSpells().length || this.castableScrolls().length) {
      out.push({
        key: 'cast',
        slot: 1,
        icon: 'auto_fix_high',
        label: 'Cast a spell',
        disabled: this.busy() || this.rolling() || !!this.store.you()?.pendingMove,
      });
    }
    const pet = this.activeUsablePet();
    if (pet) {
      const ready = this.petBoxReady(pet);
      out.push({
        key: 'pet',
        slot: 2,
        spriteUrl: this.petSpriteUrl(pet.species),
        label: `${this.petInfoOf(pet).name} — ${this.petInfoOf(pet).blurb}`,
        badge: this.petIsEconomy(pet) ? String(this.economyAccruedNow(pet)) : null,
        ready,
        disabled: this.busy() || !ready,
      });
    }
    const space = this.spaceActions();
    if (space.length === 1) {
      out.push(space[0]);
    } else if (space.length > 1) {
      out.push({
        key: 'more',
        slot: 3,
        icon: 'more_horiz',
        tone: 'ctx',
        label: 'Actions on this space',
        badge: String(space.length),
      });
    }
    return out;
  }

  /** Overflow sheet visibility for slot 3. */
  protected readonly showDialMore = signal(false);

  /** Route a satellite tap to the handler that already exists for it. */
  protected onDialAct(key: string): void {
    switch (key) {
      case 'bag':
        this.showBag.set(true);
        return;
      case 'cast':
        this.showSpells.set(true);
        return;
      case 'pet':
        this.tapBoardPet();
        return;
      case 'more':
        this.showDialMore.set(true);
        return;
      case 'reclaim':
        this.openReclaim();
        return;
      case 'freemove':
        this.toggleMoveMode();
        return;
      case 'shop':
        this.showShop.set(true);
        return;
      case 'ossuary':
        this.showOssuary.set(true);
        return;
      case 'witch':
        this.showWitch.set(true);
        return;
      case 'trading_post':
        this.openTradingPost();
        return;
      case 'excavation':
        this.openExcavation();
        return;
      case 'crystal_vein':
        this.openVein();
        return;
      case 'vault_lock':
        this.openVault();
        return;
    }
  }

  /** An overflow-sheet row tapped: close the sheet, then run the action. */
  protected onDialMorePick(key: string): void {
    this.showDialMore.set(false);
    this.onDialAct(key);
  }
```

- [ ] **Step 2: Pass the satellites in and add the overflow sheet**

In `board-tab.component.html`, add two bindings to the `<app-uc-turn-dial>` element from Task 4:

```html
        [satellites]="dialSatellites()"
        (act)="onDialAct($event)"
```

Then add the overflow sheet next to the other board dialogs — insert immediately after the `<app-pickup-modal />` line:

```html
  <!-- Slot-3 overflow: several actions apply on this space at once (e.g. a Grime
       Gorger standing on a Bazaar tile, or an admin's free move). -->
  @if (showDialMore()) {
    <div class="uc-modal-backdrop" (click)="showDialMore.set(false)">
      <div class="uc-modal dial-more" (click)="$event.stopPropagation()">
        <h3><mat-icon class="mi">more_horiz</mat-icon> This space</h3>
        <div class="choice-grid">
          @for (a of spaceActions(); track a.key) {
            <button class="uc-btn" [disabled]="busy()" (click)="onDialMorePick(a.key)">
              <mat-icon class="mi">{{ a.icon }}</mat-icon> {{ a.label }}
            </button>
          }
        </div>
        <div class="modal-actions">
          <button class="uc-btn" (click)="showDialMore.set(false)">Close</button>
        </div>
      </div>
    </div>
  }
```

- [ ] **Step 3: Hide the duplicate corner overlays under the dial skin**

`.bag-fab` and `.pet-quickuse` become arc satellites, so they must not also render standalone. In `board-tab.component.html`:

Change the pet guard from:

```html
    @if (activeUsablePet(); as pet) {
```

to:

```html
    @if (!hudSkin.isDial() && activeUsablePet(); as pet) {
```

and the bag guard from:

```html
    @if ((store.you()?.bag?.length ?? 0) > 0) {
```

to:

```html
    @if (!hudSkin.isDial() && (store.you()?.bag?.length ?? 0) > 0) {
```

- [ ] **Step 4: Style the overflow sheet**

Append to `board-tab.component.scss`:

```scss
// Slot-3 overflow sheet: a plain list, since the arc has no room for a fifth
// satellite (five across the 180-270deg quarter would overlap).
.dial-more {
  max-width: 320px;

  .choice-grid {
    display: grid;
    gap: 8px;
  }
}
```

- [ ] **Step 5: Verify**

Run: `npm run build`
Expected: build succeeds.

Then `npm start` with the dial skin on and confirm:
- Bag appears at the 9-o'clock position with its count, and opens the existing bag modal.
- With no consumables the bag slot is empty and the other satellites have **not** moved.
- Cast appears one step up when you hold a castable spell or scroll, and opens the spell menu.
- An active forage/scout pet shows its sprite with a gold pulse when ready, and firing it works.
- Landing on a Bazaar shows an amber storefront satellite directly above the dial that opens the shop; check a second facility type too.
- The old `.bag-fab` and `.pet-quickuse` boxes are gone (no duplicates in the corner).
- As an admin on a facility tile, slot 3 becomes `more_horiz` with a count badge and the sheet lists both the facility and the admin move.
- Turning the toggle off restores the standalone bag and pet boxes.

- [ ] **Step 6: Commit**

```bash
git add src/app/undercity/tabs/board-tab.component.ts src/app/undercity/tabs/board-tab.component.html src/app/undercity/tabs/board-tab.component.scss
git commit -m "feat(undercity): add the turn dial's satellite arc and overflow sheet"
```

---

## Task 6: Decision handoff

Under the dial skin the band disappears on routine turns and slides back for real decisions. **PvP does not dim the dial** — the existing code deliberately keeps Battle available alongside Roll, so a player must still be able to roll away from someone camping their space.

**Files:**
- Modify: `src/app/undercity/tabs/board-tab.component.ts`
- Modify: `src/app/undercity/tabs/board-tab.component.html:106` (the `<app-uc-action-band>` element)

- [ ] **Step 1: Add the two decision predicates**

Add to `board-tab.component.ts` beside the Task 4 members:

```ts
  /** The band still has something to say: a pending decision, or a PvP
   *  opportunity. Under the dial skin the band renders only for these. */
  protected bandHasDecision(): boolean {
    return (
      this.canReroll() ||
      !!this.pathfinderPick() ||
      this.moveMode() ||
      this.occupantsHere().length > 0 ||
      (!!this.stepping() && this.occupantsPassing().length > 0)
    );
  }

  /** Decisions that must be answered before rolling again, so the dial goes
   *  inert. PvP is NOT one: Battle sits alongside Roll on purpose, and a player
   *  has to be able to roll away from a camped space. */
  protected exclusiveDecision(): boolean {
    return this.canReroll() || !!this.pathfinderPick() || this.moveMode();
  }
```

- [ ] **Step 2: Gate the band shell**

In `board-tab.component.html`, wrap the band element. Change:

```html
  <app-uc-action-band>
```

to:

```html
  @if (!hudSkin.isDial() || bandHasDecision()) {
  <app-uc-action-band>
```

and change its closing tag:

```html
  </app-uc-action-band>
```

to:

```html
  </app-uc-action-band>
  }
```

- [ ] **Step 3: Dim the dial for exclusive decisions**

Add the `dimmed` binding to the `<app-uc-turn-dial>` element:

```html
        [dimmed]="exclusiveDecision()"
```

- [ ] **Step 4: Verify**

Run: `npm run build`
Expected: build succeeds.

Then `npm start` with the dial skin on and confirm:
- On a routine turn there is **no band at all** — the board runs to the tab bar and the dial floats over it.
- Rolling a 1 with Fleetfoot slides the band up with the reroll prompt, and the dial visibly dims and cannot be tapped. Answering it hides the band again.
- Move-mode (admin) shows its instruction band and dims the dial; cancelling restores the dial.
- Standing on the same space as another player shows the PvP row band **with the dial still bright and rollable** — verify you can roll away without touching Battle.
- With the toggle off, the band behaves exactly as it does today in all of the above.

- [ ] **Step 5: Commit**

```bash
git add src/app/undercity/tabs/board-tab.component.ts src/app/undercity/tabs/board-tab.component.html
git commit -m "feat(undercity): show the band only for decisions under the dial skin"
```

---

## Task 7: Face ring polish and full manual pass

- [ ] **Step 1: Dismiss the face ring on an outside tap**

The band's picker closed implicitly when the row re-rendered; the floating ring needs an explicit dismissal. Add to `board-tab.component.ts` beside the Task 4 members:

```ts
  /** Close the dial's face ring when the next roll resolves it elsewhere. */
  protected closeFaceRing(): void {
    this.showRollPicker.set(false);
  }
```

In `board-tab.component.html`, add a dismissal catcher inside the dial's `@if (hudSkin.isDial())` block, immediately **before** `<app-uc-turn-dial …>`:

```html
      @if (showRollPicker()) {
        <!-- data-uc-claim: a tap here only closes the ring; the board still pans
             through it but must not also tap the space underneath. -->
        <div class="dial-ring-backdrop" data-uc-claim (click)="closeFaceRing()"></div>
      }
```

Append to `board-tab.component.scss`:

```scss
// Dismissal catcher for the dial's face ring. Transparent and full-scene.
.dial-ring-backdrop {
  position: absolute;
  inset: 0;
  z-index: 6; // below the dial (7), above the canvas
}
```

- [ ] **Step 2: Verify the ring**

Run: `npm run build`
Expected: build succeeds.

Then, with a creature that owns the Blink perk (SPD-15) and the dial skin on:
- The dial reads BLINK with a bolt glyph.
- Tapping it fans six numbered faces plus an amber random slot around the dial.
- Picking a face moves exactly that many spaces.
- Picking random rolls normally and leaves Blink ready.
- Tapping the board outside the ring closes it without moving.
- After a Blink, the dial shows the "Blink recharges" note above it.

- [ ] **Step 3: Full manual sweep**

Walk every state from the spec with the dial skin on, then repeat with it off to confirm nothing regressed:

- [ ] default Roll, and the gauge shrinking as rolls are spent
- [ ] out of rolls (dial dimmed, countdown showing)
- [ ] full bag (`pendingPickups` — dial inert while the pickup sorter is up)
- [ ] Blink ready / Blink recharging
- [ ] dev Pick (server `DEBUG` **and** a local dev build — never on the deployed site)
- [ ] mid-roll and mid-move (dial holds position, dimmed, shows the rolled value)
- [ ] Fleetfoot reroll prompt (band up, dial dimmed)
- [ ] Pathfinder two-die choice (band up, dial dimmed)
- [ ] admin move-mode (band up, dial dimmed)
- [ ] a PvP occupant sharing your space (band up, **dial live**)
- [ ] empty bag, and no castable spells (slots empty, others do not move)
- [ ] each facility type reachable on your board
- [ ] Reclaim stacked on a facility → slot 3 is `more_horiz`, sheet lists both
- [ ] a live battle (the `interactive-battle` overlay covers the dial, as it does the band)
- [ ] drag from the dial does not pan; drag through an arc gap does pan
- [ ] toggling skins mid-turn leaves the game state intact

- [ ] **Step 4: Commit**

```bash
git add src/app/undercity/tabs/board-tab.component.ts src/app/undercity/tabs/board-tab.component.html src/app/undercity/tabs/board-tab.component.scss
git commit -m "feat(undercity): dismiss the dial face ring on an outside tap"
```

---

## Task 8: Update the spec and CLAUDE.md

- [ ] **Step 1: Record the two geometry corrections in the spec**

In `specs/2026-08-13-undercity-turn-dial-hud-design.md`, replace the 5-row arc table's `300° / More` row and the sentence after it so the spec matches what was built: four slots at 180/210/240/270, with slot 270 becoming a `more_horiz` button (badge = claimant count) when more than one current-space action applies. Note that five satellites across the quarter arc would need 22.5° spacing (24px between centres for 30px buttons) and would overlap.

In the same file's "Gesture claim" section, note that `board-canvas.ts:1421` already excludes `button` from starting a pan, so satellites are covered without extra attributes; the wrapper uses `pointer-events: none` with `auto` on its buttons, which also keeps the board pannable through the arc's gaps.

- [ ] **Step 2: Add a line to CLAUDE.md**

In the Undercity section of `CLAUDE.md`, add to the bullet list:

```markdown
- **HUD skins:** the board tab has two skins — the classic bottom action band and an opt-in radial turn dial (bottom-right, `tabs/turn-dial.component.ts`), switched by a header toggle backed by `services/hud-skin.service.ts`. The band stays the default and is still the only skin for the creature/plaza tabs. Design: [specs/2026-08-13-undercity-turn-dial-hud-design.md](specs/2026-08-13-undercity-turn-dial-hud-design.md). The dial mirrors `ROLL_CAP` for its gauge — update it if the server cap is tuned.
```

- [ ] **Step 3: Verify and commit**

Run: `npm run build`
Expected: build succeeds.

```bash
git add CLAUDE.md specs/2026-08-13-undercity-turn-dial-hud-design.md
git commit -m "docs(undercity): record the turn dial's final arc geometry"
```

---

## Self-review notes

**Spec coverage:** service (T1), header toggle (T2), dial component + states + gauge semantics (T3), mounting + routine-row gating + ROLL_CAP mirror (T4), arc slots + priority + overflow + duplicate-overlay removal (T5), `bandHasDecision`/`exclusiveDecision` + PvP exception (T6), face ring + status re-homing (T3/T4/T7), verification sweep (T7), doc sync (T8).

**Two deliberate deviations from the spec**, both recorded in Task 8: the arc is 4 slots with overflow folded into slot 3 (five would overlap), and the gesture-claim note is narrowed because `<button>` is already excluded from panning.

**One deviation from the writing-plans skill:** no TDD steps. This repo has no frontend test runner — Karma was removed and `ng test` does not work (`CLAUDE.md`) — so writing `.spec.ts` files would produce tests nothing executes. Each task gates on `npm run build` plus named manual checks instead. The plan is also saved to `specs/` rather than `docs/superpowers/plans/` because `docs/` is gitignored build output that every build wipes.

---

## What actually shipped, where it differs from the plan above

The task text above is preserved as the record of what was dispatched. Six
corrections emerged during execution — five of them plan bugs, not
implementation errors. The design spec has been updated to match; this list is
the audit trail.

**1. The face ring and the satellite arc collided (Task 3, caught in review).**
The plan put satellites at radius 66 on angles 180/210/240/270 and the six faces
at radius 58 across 150°→300°, i.e. sharing four angles 8px apart when a 15px
satellite and a 12px face need 27px. Fix: `UcTurnDialComponent` now hides the
satellite arc whenever `faceRingOpen` is true, so the guarantee lives in the
component rather than depending on the caller. Commit `10e82b4`.

**2. `BOX` was dead and the SCSS silently duplicated `CENTRE` (Task 3).** `BOX`
was never referenced; `.dial-box`'s 150 and `.dial`'s 104 hardcode values that
Angular's `styles` array cannot interpolate. `BOX` was removed and cross-
reference comments added at all three sites. Commit `10e82b4`.

**3. `dialOverflow()` was dead code (Task 5).** The plan specified it, but the
template distinguishes the overflow case via the `'more'` satellite key, so
nothing ever called it. Removed in commit `351aee5`.

**4. The overflow sheet's SCSS and one class name were wrong (Task 5).** The plan
used `class="modal-actions"`, which exists nowhere in the repo — the established
(unstyled) pattern in this file is `uc-modal-actions`. The plan's
`.dial-more .choice-grid { display: grid; gap: 8px }` was also ineffective:
`.choice-grid` is `grid-template-columns: 1fr 1fr`, so making the sheet
single-column required overriding the column count explicitly. Both corrected
before dispatch.

**5. Dev Pick had no random-roll path (Tasks 4-6, caught in review).** Under the
band, the dev "Pick" button sits *beside* Roll; on the dial, `dialMode()`
returns `'pick'` and the tap opens the ring *instead of* rolling — but
`faceRandom` was bound to `blinkAllowed()` only, so with `pickAllowed() &&
!blinkAllowed()` the ring showed faces 1-6 and no way to roll at random. Dev-only
(`debugMode() && isDevMode()`) but a real parity gap. Fixed by binding
`faceRandom` to `blinkAllowed() || pickAllowed()`. Commit `fcd8c5d`.

**6. `bandHasDecision()` mounted an empty band (Tasks 4-6, caught in review).**
Its PvP term was `occupantsHere().length > 0`, but the band's PvP strip is itself
gated on `!pendingMove` — so every roll away from an occupied space flashed in a
band with the routine row hidden and the strip suppressed. Each term must mirror
the guard of the branch it reveals. Fixed, plus the band's `.band-status-stack`
is now suppressed under the dial skin to stop the countdown/rested count
rendering twice. Commit `fcd8c5d`.

**Considered and declined:** moving the `ROLL_CAP` mirror into
`src/app/undercity/data/`. `CLAUDE.md` points display mirrors there, but that
directory is domain-grouped with no scalar-config home, and `POKE_COOLDOWN_MIN`
already sets the precedent of a single-consumer scalar living in its consumer
(`poke-wheel.component.ts`). A new file for one number is not worth it.

**Still outstanding:** Task 7's manual verification sweep. Every task was gated
on `npm run build` only; nothing in this feature has been exercised against a
running game, which needs a live Undercity night on the real AWS backend.
