import { ChangeDetectionStrategy, Component, Input } from '@angular/core';
import { MatIconModule } from '@angular/material/icon';
import { DISC_RY, NODE_R } from '../engine/board-space';

/**
 * How much the board flattens its ground plane: the space discs are drawn as
 * `NODE_R × DISC_RY` ellipses for the 2.5D read. Derived from those constants
 * rather than eyeballed, so retuning the board's projection carries the fan with
 * it automatically.
 *
 * The board's projection is **orthographic** — a space's ellipse has the same
 * `ry/rx` wherever it sits on screen, with no vanishing point. So the matching
 * transform is a plain vertical squash, and CSS `perspective()` / `rotateX` would
 * be *wrong*: real perspective would make the fan disagree with the tile it
 * stands on, and it blurs text into the bargain.
 */
export const PROJECTION = DISC_RY / NODE_R;

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
  /**
   * Which side of the creature this action lives on: 0 = leading wing, 1 = far.
   * Declared per action and never derived, so a given button is always in the
   * same place — see the class docs for why that matters.
   */
  wing?: 0 | 1;
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

/**
 * Vertical gap between neighbouring chips on a wing, in px, and how far the whole
 * stack hangs below the space's centre.
 *
 * **Spacing is vertical and in pixels — not angular.** A radial fan cannot work
 * here: with the spikes near the disc rim there simply aren't enough pixels for
 * an angle to separate fixed-height chips, so the only way to stop them
 * colliding was to fling them far out from the creature. Stepping by a fixed
 * vertical distance separates them at *any* radius and at any zoom, which lets
 * the chips sit right against the base where they belong.
 *
 * Must stay above a chip's own height, or neighbours touch.
 */
const V_STEP = 46;
const V_BIAS = 8;

/**
 * Nominal horizontal distance from the space's centre to a chip's spike, in px.
 *
 * Exported so the positioner floors the real radius at the same value: `tiltAt()`
 * derives each chip's angle from this, so the two have to agree or the spikes
 * stop aiming at the space.
 */
export const FAN_RADIUS = 44;

/** How many wedges sit on each side, given their declared wings. */
export function fanWings(items: { wing?: 0 | 1 }[]): { lead: number; far: number } {
  const lead = items.filter((it) => (it.wing ?? 0) === 0).length;
  return { lead, far: items.length - lead };
}

/**
 * Persona-style action fan: jagged tapered chips standing up around a creature,
 * arranged on the board's ground plane with their spikes pointing back at the
 * space they belong to.
 *
 * **Ground plane for placement, upright for the chips.** Each spoke is offset by
 * `(cos θ, sin θ × PROJECTION)`, so the ring of chips traces the ellipse of the
 * space beneath them; then the whole fan is lifted by `--uc-fan-lift` and each
 * chip is drawn facing the camera. Only the *shadow* stays flattened onto the
 * floor, which is what sells the height. An earlier pass squashed the chips
 * themselves — geometrically truer, but it laid the type face-up on the floor
 * where it was hard to read.
 *
 * Wedges split across **both** sides of the token, as Persona's command list
 * does. That's not only truer to the reference — stacking everything into one
 * wing makes the chips overlap near the convergence point, where they're closest
 * together.
 *
 * **Which side an action sits on is fixed by `FanItem.wing`, never derived.** An
 * earlier pass balanced the wings by label width, so adding or removing an
 * unrelated action could shuffle a button to the creature's other side between
 * turns; the fan as a whole also used to swap sides to stay inside the viewport.
 * Both traded muscle memory for tidier packing, and muscle memory wins. Only a
 * rival's fan mirrors, and only to lean away from your own creature.
 *
 * Purely presentational, and deliberately split down the middle:
 *
 * - **Contents** (`items`, `header`, `compact`) are normal inputs. They change
 *   about once a turn.
 * - **Geometry** is not. The board tab positions this element by writing
 *   `style.transform` on the host from the board canvas's per-frame anchor feed,
 *   picks which side leads via the `FAN_MIRROR` host class (plus `FAN_HIDDEN` to
 *   fade out), and sets `--uc-fan-r` / `--uc-fan-lift`. Those
 *   are 60fps decisions — routing them through bindings would run change
 *   detection every frame.
 */
@Component({
  selector: 'app-uc-action-fan',
  standalone: true,
  changeDetection: ChangeDetectionStrategy.OnPush,
  imports: [MatIconModule],
  template: `
    <div class="fan" [class.compact]="compact" [style.--proj]="projection">
      @if (header) {
        <span class="spoke" [style.--sy]="headerSy()" [style.--tilt]="headerTilt()">
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
        <span
          class="spoke"
          [class.alt]="isAlt(i)"
          [style.--sy]="syAt(i)"
          [style.--tilt]="tiltAt(i)"
        >
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
                 descendants, so the shadow has to be a sibling of the plate to
                 survive outside its silhouette. Paint order is DOM order —
                 shadow, plate, body, face. -->
            <span class="shadow"></span>
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
      /* Positioned by the board tab (transform, per frame) onto the centre of the
         disc the creature stands on. It must never eat pans on empty space, so
         only the chips take pointer events. */
      :host {
        position: absolute;
        left: 0;
        top: 0;
        z-index: 4;
        pointer-events: none;
        will-change: transform;
        /* Length of the spike each chip tapers to. */
        --tip: 18px;
        /* Depth of each tooth on the torn outer edge. Two big teeth read at board
           scale; three small ones just looked like a straight edge. */
        --zag: 13px;
        /* Spike at the inner end, zigzag at the outer. --shape-r is its exact
           mirror, for the wing that opens the other way. */
        --shape: polygon(
          0 50%,
          var(--tip) 7%,
          calc(100% - var(--zag)) 0,
          100% 30%,
          calc(100% - var(--zag)) 55%,
          100% 100%,
          var(--tip) 93%
        );
        --shape-r: polygon(
          100% 50%,
          calc(100% - var(--tip)) 7%,
          var(--zag) 0,
          0 30%,
          var(--zag) 55%,
          0 100%,
          calc(100% - var(--tip)) 93%
        );
      }

      /* A zero-size origin: every spoke is offset from this exact point, which is
         what makes the chips' spikes converge on the space. */
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

      /* Out to the side of the space, then stepped vertically. The radius is the
         positioner's (it tracks the disc); the step is a fixed pixel constant,
         which is what keeps neighbours apart at every zoom. */
      .spoke {
        position: absolute;
        left: 0;
        top: 0;
        width: 0;
        height: 0;
        --flip: 1;
        --shp: var(--shape);
        --ox: 0%;
        --pl: calc(var(--tip) + 10px);
        --pr: calc(var(--zag) + 9px);
        transform: translate(calc(var(--uc-fan-r, 44px) * var(--flip)), var(--sy, 0px));
      }
      /* Leading-vs-far and mirrored-vs-not combine as an XOR. Ordered so the
         mirror pair wins on equal specificity. */
      .spoke.alt,
      :host(.uc-fan-mirror) .spoke {
        --flip: -1;
        --shp: var(--shape-r);
        --ox: 100%;
        --pl: calc(var(--zag) + 9px);
        --pr: calc(var(--tip) + 10px);
      }
      :host(.uc-fan-mirror) .spoke.alt {
        --flip: 1;
        --shp: var(--shape);
        --ox: 0%;
        --pl: calc(var(--tip) + 10px);
        --pr: calc(var(--zag) + 9px);
      }

      /* The chip hangs off its stack point, extending away from the creature:
         --flip of 1 puts its left edge there, -1 its right edge.

         transform-origin sits on that same edge, so the rotation swings the body
         while the *spike stays pinned* to the point it was placed at. Rotating
         about the chip's centre instead would drag the tip off its aim. */
      .slab,
      .hdr {
        position: absolute;
        left: 0;
        top: 0;
        transform-origin: var(--ox, 0%) 50%;
        transform: translate(calc((var(--flip) - 1) * 50%), -50%) rotate(var(--tilt, 0deg));
      }

      /* ── Chips ───────────────────────────────────────────────────────────
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
           long chips as a stub — they should read as one set. */
        min-width: 132px;
        padding: 11px var(--pr) 11px var(--pl);
        border: 0;
        border-radius: 0;
        background: none;
        cursor: pointer;
        color: #e8f5dd;
        /* Light touch: the cast shadow below is doing the depth work, so a heavy
           filter on top only muddies the edge. */
        filter: drop-shadow(0 2px 4px rgba(0, 0, 0, 0.5));
      }

      .shadow,
      .plate,
      .body {
        position: absolute;
        clip-path: var(--shp);
      }
      /* The chip's shadow, left behind on the floor: dropped by the same lift
         that raised the chip, and squashed onto the ground plane. This is what
         sells the height — without it a raised chip just looks like it's sitting
         further away. Translucent black rather than a colour, so it picks up
         whatever terrain is under it instead of fighting the teal board. */
      .shadow {
        inset: 0;
        background: rgba(0, 0, 0, 0.42);
        transform: translate(6px, 9px) scaleY(var(--proj, 0.72));
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
      }

      .slab:active:not(:disabled) .body {
        background: rgba(30, 44, 22, 0.97);
      }
      .slab:disabled {
        opacity: 0.45;
        cursor: default;
      }

      /* The primary is the button pressed ~90% of turns; it should not be a
         near-tie with Cast. Bigger text, brighter plate, its own glow. Every
         chip's shadow stays the same neutral black — hierarchy comes from the
         plate, and a shadow that changes colour stops reading as a shadow. */
      .slab.primary {
        font-size: 16px;
        min-width: 168px;
        padding-top: 14px;
        padding-bottom: 14px;
        color: #fff;
        filter: drop-shadow(0 2px 4px rgba(0, 0, 0, 0.5))
          drop-shadow(0 0 7px rgba(143, 224, 160, 0.45));
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
      /* Icon-only chips on a crowded space: the length floor exists to stop short
         *labels* looking like stubs, so drop it when there's no label. */
      .fan.compact .slab {
        min-width: 0;
      }

      /* Owner name / prompt banner: reversed chip so it reads as a caption rather
         than another tappable action. No cast shadow — it shouldn't compete with
         the actions. */
      .hdr {
        padding: 5px var(--pr) 5px var(--pl);
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
          padding-top: 9px;
          padding-bottom: 9px;
        }
        .slab.primary {
          font-size: 14px;
          min-width: 142px;
          padding-top: 12px;
          padding-bottom: 12px;
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

  /** Exposed to the template so the squash factor has one definition. */
  protected readonly projection = PROJECTION;

  /** Wedges on the far wing hang off the creature's other side. */
  protected isAlt(i: number): boolean {
    return (this.items[i]?.wing ?? 0) === 1;
  }

  protected syAt(i: number): string {
    return `${this.rawY(i)}px`;
  }
  protected tiltAt(i: number): string {
    return tilt(this.rawY(i));
  }

  protected headerSy(): string {
    return `${this.rawHeaderY()}px`;
  }
  protected headerTilt(): string {
    return tilt(this.rawHeaderY());
  }

  /**
   * The chip's height on its wing: its slot among the actions sharing that side,
   * centred on the stack. Losing a neighbour still slides the survivors, but
   * that's a far gentler change than a button hopping to the creature's other
   * side.
   */
  private rawY(i: number): number {
    const it = this.items[i];
    if (!it) return V_BIAS;
    const peers = this.items.filter((x) => (x.wing ?? 0) === (it.wing ?? 0));
    const n = peers.length;
    return (peers.indexOf(it) - (n - 1) / 2) * V_STEP + V_BIAS;
  }

  /** The header sits one step above the leading wing's topmost action. */
  private rawHeaderY(): number {
    const { lead } = fanWings(this.items);
    return (0 - (lead - 1) / 2) * V_STEP + V_BIAS - V_STEP;
  }
}

/**
 * The chip's own rotation: the angle from where its spike sits back to the centre
 * of the space.
 *
 * This is the whole point of the layout, so it's worth stating plainly. Rotating
 * a chip to anything else — its own stack angle, or a flat cosmetic tilt — aims
 * its spike past the disc, and since the sprite stands directly above the disc
 * that reads unmistakably as "the menu is pointing at my creature" rather than at
 * the space. Deriving the angle from the chip's own offset keeps every spike on
 * the tile.
 *
 * The far wing's chip extends leftward, so it takes the mirrored angle; without
 * the sign flip it would be rotated a half-turn and its text would read upside
 * down.
 */
function tilt(y: number): string {
  const a = (Math.atan2(y, FAN_RADIUS) * 180) / Math.PI;
  return `calc(${a.toFixed(1)}deg * var(--flip, 1))`;
}
