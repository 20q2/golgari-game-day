import { ChangeDetectionStrategy, Component, Input } from '@angular/core';
import { MatIconModule } from '@angular/material/icon';

/** Visual weight of a wedge. `danger` is reserved for Battle. */
export type FanKind = 'primary' | 'normal' | 'danger';

/** One wedge in a fan. The board tab owns every handler; this is presentation. */
export interface FanItem {
  id: string;
  label: string;
  /** Material icon ligature name. */
  icon?: string;
  /** Registered `uc-*` SVG icon name (wins over `icon`). */
  svgIcon?: string;
  /** Bitmap icon, e.g. `undercity/icons/die.png` (wins over both). */
  imgSrc?: string;
  kind?: FanKind;
  disabled?: boolean;
  /** Tooltip / aria-label. Falls back to `label`. */
  title?: string;
  run: () => void;
}

/** The wedge above a fan naming its owner, or announcing a prompt. */
export interface FanHeader {
  text: string;
  /** `warn` is the amber prompt treatment; `name` is the plain reversed wedge. */
  tone: 'name' | 'warn';
  /** Material icon shown before the text (e.g. a shield on a shielded rival). */
  icon?: string;
}

/** Host classes the positioner toggles. @see UcActionFanComponent */
export const FAN_MIRROR = 'uc-fan-mirror';
export const FAN_HIDDEN = 'uc-fan-hidden';

/** Widest arc one wing will open to, and how far apart spokes sit within it. */
const ARC_MAX = 84;
const ARC_STEP = 34;
/**
 * Swing the whole fan downward. The wedges aim at the creature but hang *below*
 * it, the way Persona's commands sit around a crouching character — a shallower
 * bias put them at eye level, slicing the sprite in half horizontally.
 */
const ARC_BIAS = 22;

/**
 * Spoke angles for one wing, in degrees, top-first. 0 points straight out from
 * the creature; positive is downward.
 *
 * Exported because the board tab needs the same numbers to work out how much
 * room a fan will occupy before it decides which side to open on — the geometry
 * has to agree in both places or the fit check lies.
 */
export function fanAngles(n: number): number[] {
  if (n <= 0) return [];
  if (n === 1) return [ARC_BIAS];
  const total = Math.min((n - 1) * ARC_STEP, ARC_MAX);
  const start = -total / 2 + ARC_BIAS;
  const step = total / (n - 1);
  return Array.from({ length: n }, (_, i) => start + i * step);
}

/**
 * How many wedges go on the leading wing; the rest go on the far one.
 *
 * Splits on *width*, not count. Halving by count lets both long labels land on
 * one side and both short ones on the other, which looks lopsided even though
 * the counts match. Items stay in order, so the primary action always leads.
 */
export function fanSplit(items: { label: string }[]): number {
  const n = items.length;
  if (n <= 1) return n;
  const w = items.map((it) => Math.max(4, it.label.length) + 3); // +3 ≈ the icon
  const total = w.reduce((acc, x) => acc + x, 0);
  let best = 1;
  let bestDiff = Infinity;
  let run = 0;
  for (let k = 1; k < n; k++) {
    run += w[k - 1];
    const diff = Math.abs(run - (total - run));
    if (diff < bestDiff) {
      bestDiff = diff;
      best = k;
    }
  }
  return best;
}

/**
 * Persona-style action fan: jagged tapered wedges radiating from a creature
 * token, each tilted along its own spoke so their spikes converge on the
 * creature they belong to.
 *
 * Wedges split across **both** sides of the token, as Persona's command list
 * does. That's not only truer to the reference — stacking everything into one
 * wing makes the wedges overlap near the convergence point, where they're
 * closest together.
 *
 * Purely presentational, and deliberately split down the middle:
 *
 * - **Contents** (`items`, `header`, `compact`) are normal inputs. They change
 *   about once a turn.
 * - **Geometry** is not. The board tab positions this element by writing
 *   `style.transform` on the host from the board canvas's per-frame anchor feed,
 *   picks which side leads via the `FAN_MIRROR` host class (plus `FAN_HIDDEN` to
 *   fade out), and sets `--uc-fan-r` / `--uc-fan-bias` to clear the sprite and
 *   keep the arc on screen. Those are 60fps decisions — routing them through
 *   bindings would run change detection every frame.
 *
 * The host's transform sits on the *token centre*: every wedge is placed along a
 * rotated spoke radiating from there, so the convergence point is the creature.
 */
@Component({
  selector: 'app-uc-action-fan',
  standalone: true,
  changeDetection: ChangeDetectionStrategy.OnPush,
  imports: [MatIconModule],
  template: `
    <div class="fan" [class.compact]="compact">
      @if (header) {
        <span class="spoke" [style.--a]="headerAngle()">
          <div class="hdr" [class.warn]="header.tone === 'warn'">
            <span class="plate"></span>
            <span class="face">
              @if (header.icon) {
                <mat-icon class="mi hdr-mi">{{ header.icon }}</mat-icon>
              }
              {{ header.text }}
            </span>
          </div>
        </span>
      }
      @for (it of items; track it.id; let i = $index) {
        <span class="spoke" [class.alt]="isAlt(i)" [style.--a]="angleAt(i)">
          <button
            type="button"
            class="slab"
            [class.primary]="it.kind === 'primary'"
            [class.danger]="it.kind === 'danger'"
            [disabled]="it.disabled"
            [title]="it.title || it.label"
            [attr.aria-label]="it.title || it.label"
            (click)="it.run()"
          >
            <!-- Layered rather than pseudo-elements: clip-path clips its own
                 descendants, so the offset shard has to be a sibling of the
                 plate to survive outside its silhouette. Paint order is DOM
                 order — shard, plate, body, face. -->
            <span class="shard"></span>
            <span class="plate"></span>
            <span class="body"></span>
            <span class="face">
              @if (it.imgSrc) {
                <img class="slab-img" [src]="it.imgSrc" alt="" />
              } @else if (it.svgIcon) {
                <mat-icon class="mi" [svgIcon]="it.svgIcon"></mat-icon>
              } @else if (it.icon) {
                <mat-icon class="mi">{{ it.icon }}</mat-icon>
              }
              @if (!compact) {
                <span class="slab-label">{{ it.label }}</span>
              }
            </span>
          </button>
        </span>
      }
    </div>
  `,
  styles: [
    `
      /* Positioned by the board tab (transform, per frame) onto the token
         centre. It must never eat pans on empty space, so only the wedges take
         pointer events. */
      :host {
        position: absolute;
        left: 0;
        top: 0;
        z-index: 4;
        pointer-events: none;
        will-change: transform;
        /* Length of the spike each wedge tapers to. */
        --tip: 18px;
        /* Depth of each tooth on the torn outer edge. Two big teeth read at
           board scale; three small ones just looked like a straight edge. */
        --zag: 13px;
        /* Shared silhouette: spike at the inner end, zigzag at the outer. */
        --shape: polygon(
          0 50%,
          var(--tip) 7%,
          calc(100% - var(--zag)) 0,
          100% 30%,
          calc(100% - var(--zag)) 55%,
          100% 100%,
          var(--tip) 93%
        );
      }

      /* A zero-size origin: every spoke pivots about this exact point, which is
         what makes the spikes converge on the creature. */
      .fan {
        position: relative;
        width: 0;
        height: 0;
        transition: opacity 0.14s ease;
      }
      :host(.uc-fan-hidden) .fan {
        opacity: 0;
        pointer-events: none;
      }

      /* --flip reflects a wing to the far side. It's a plain scaleX, so the
         wedges mirror (spikes swap to the outer edge) for free and only the text
         needs flipping back — see .face. The four rules below are ordered so the
         mirror pair wins on equal specificity: leading/far wing XOR mirrored. */
      .spoke {
        position: absolute;
        left: 0;
        top: 0;
        width: 0;
        height: 0;
        --flip: 1;
        transform: scaleX(var(--flip)) rotate(calc(var(--a, 0deg) + var(--uc-fan-bias, 0deg)));
      }
      .spoke.alt {
        --flip: -1;
      }
      :host(.uc-fan-mirror) .spoke {
        --flip: -1;
      }
      :host(.uc-fan-mirror) .spoke.alt {
        --flip: 1;
      }

      .slab,
      .hdr {
        position: absolute;
        left: var(--uc-fan-r, 30px);
        top: 0;
        transform: translateY(-50%);
      }

      /* ── Wedges ──────────────────────────────────────────────────────────
         Torn pennants, spike-first toward the creature. clip-path slices a CSS
         border clean off, so the rim is a stacked layer rather than a border
         property, and the drop shadow is a filter for the same reason. */
      .slab {
        pointer-events: auto;
        display: block;
        white-space: nowrap;
        font: inherit;
        font-size: 13px;
        /* Heavy uppercase. Title case read as an ordinary web button; the
           reference leans on weight and caps for its punch. */
        font-weight: 800;
        text-transform: uppercase;
        letter-spacing: 0.7px;
        /* A floor on length so a short label like CAST doesn't sit between two
           long wedges as a stub — they should read as one set. */
        min-width: 132px;
        padding: 11px calc(var(--zag) + 9px) 11px calc(var(--tip) + 10px);
        border: 0;
        border-radius: 0;
        background: none;
        cursor: pointer;
        color: #e8f5dd;
        filter: drop-shadow(0 3px 7px rgba(0, 0, 0, 0.7));
      }

      .shard,
      .plate,
      .body {
        position: absolute;
        clip-path: var(--shape);
      }
      /* Offset accent shape behind each wedge — the trick that gives Persona's
         panels their punch. Committed rather than hinted: a small offset just
         read as a bevel artifact. Violet by default so it sits in the Golgari
         palette instead of fighting the teal board; the primary gets the loud
         crimson, which doubles as the hierarchy cue. */
      .shard {
        inset: 0;
        background: #6a3a8a;
        transform: translate(9px, 9px) rotate(-3deg);
      }
      .plate {
        inset: 0;
        background: rgba(103, 194, 128, 0.6);
      }
      .body {
        inset: 1px;
        background: rgba(11, 14, 8, 0.95);
      }

      .face {
        position: relative;
        z-index: 1;
        display: flex;
        align-items: center;
        gap: 6px;
        transform: scaleX(var(--flip, 1));
      }

      .slab:active:not(:disabled) .body {
        background: rgba(30, 44, 22, 0.97);
      }
      .slab:disabled {
        opacity: 0.45;
        cursor: default;
      }

      /* ── 6. The primary is the button pressed ~90% of turns; it should not
         be a near-tie with Cast. Bigger text, brighter plate, its own glow. */
      .slab.primary {
        font-size: 18px;
        min-width: 168px;
        padding-top: 15px;
        padding-bottom: 15px;
        color: #fff;
        filter: drop-shadow(0 3px 7px rgba(0, 0, 0, 0.7))
          drop-shadow(0 0 7px rgba(143, 224, 160, 0.45));
      }
      .slab.primary .shard {
        background: #b0304c;
      }
      .slab.primary .plate {
        background: #b6f0c2;
      }
      .slab.primary .body {
        background: linear-gradient(#356139, #24462a);
      }
      .slab.danger {
        color: #ffe9e9;
      }
      .slab.danger .shard {
        background: #7d1f2b;
      }
      .slab.danger .plate {
        background: #e08585;
      }
      .slab.danger .body {
        background: rgba(80, 26, 26, 0.96);
      }

      .mi {
        font-size: 17px;
        width: 17px;
        height: 17px;
        line-height: 17px;
        flex: none;
      }
      .slab-img {
        width: 17px;
        height: 17px;
        flex: none;
        image-rendering: pixelated;
      }
      /* Icon-only wedges on a crowded space: the length floor exists to stop
         short *labels* looking like stubs, so drop it when there's no label. */
      .fan.compact .slab {
        min-width: 0;
        padding-right: calc(var(--zag) + 6px);
      }

      /* Owner name / prompt banner: reversed wedge so it reads as a caption
         rather than another tappable action. No offset shard — it shouldn't
         compete with the actions. */
      .hdr {
        padding: 5px calc(var(--zag) + 7px) 5px calc(var(--tip) + 8px);
        font-size: 11px;
        font-weight: 800;
        text-transform: uppercase;
        letter-spacing: 0.6px;
        white-space: nowrap;
        color: #11150c;
        filter: drop-shadow(0 2px 6px rgba(0, 0, 0, 0.6));
        max-width: 58vw;
        overflow: hidden;
      }
      .hdr .plate {
        background: #dcecce;
      }
      .hdr.warn .plate {
        background: #e2bd4a;
      }
      .hdr-mi {
        font-size: 13px;
        width: 13px;
        height: 13px;
        line-height: 13px;
      }

      /* Phones: shorter spikes and teeth, tighter text, so a wing still fits
         beside a centred creature. */
      @media (max-width: 480px) {
        :host {
          --tip: 14px;
          --zag: 10px;
        }
        .slab {
          font-size: 12px;
          min-width: 112px;
          padding: 9px calc(var(--zag) + 8px) 9px calc(var(--tip) + 8px);
        }
        .slab.primary {
          font-size: 15px;
          min-width: 142px;
        }
      }
    `,
  ],
})
export class UcActionFanComponent {
  @Input() items: FanItem[] = [];
  @Input() header: FanHeader | null = null;
  /** Drop labels, keeping icons only — used for far fans on a crowded space. */
  @Input() compact = false;

  /** Wedges past the leading wing hang off the creature's other side. */
  protected isAlt(i: number): boolean {
    return i >= fanSplit(this.items);
  }

  protected angleAt(i: number): string {
    const lead = fanSplit(this.items);
    const wing = i < lead ? fanAngles(lead) : fanAngles(this.items.length - lead);
    return `${wing[i < lead ? i : i - lead] ?? 0}deg`;
  }

  /** The header sits one step above the leading wing's topmost action. */
  protected headerAngle(): string {
    const first = fanAngles(fanSplit(this.items))[0] ?? ARC_BIAS;
    return `${first - ARC_STEP}deg`;
  }
}
