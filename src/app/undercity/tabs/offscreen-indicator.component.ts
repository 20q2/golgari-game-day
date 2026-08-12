import { ChangeDetectionStrategy, Component, EventEmitter, Input, Output } from '@angular/core';
import { MatIconModule } from '@angular/material/icon';

/**
 * Smash-Bros-style off-screen marker for your own creature: a sprite badge that
 * rides the screen edge at the true bearing to your token, with an arrow chip on
 * its outer rim. Tap it to glide the camera home.
 *
 * Shown only once the token has fully left the viewport, so it never competes
 * with the action fan (which hides in that same state — actions shouldn't float
 * detached from the creature they belong to).
 *
 * Both the badge position and the arrow bearing change every frame while the
 * player pans, so the board tab drives them by writing three CSS custom
 * properties on this host rather than through bindings — a signal write per
 * frame would run change detection at 60fps:
 *
 * - `--uc-ind-x` / `--uc-ind-y` — badge centre, in px, within the board scene
 * - `--uc-ind-a` — bearing to the creature as a CSS angle, 0deg = straight up,
 *   growing clockwise
 */
@Component({
  selector: 'app-uc-offscreen-indicator',
  standalone: true,
  changeDetection: ChangeDetectionStrategy.OnPush,
  imports: [MatIconModule],
  template: `
    <button
      type="button"
      class="badge"
      title="Snap the camera back to your creature"
      aria-label="Snap the camera back to your creature"
      (click)="tap.emit()"
    >
      <span class="ring">
        @if (spriteUrl) {
          <img class="mini" [src]="spriteUrl" alt="" />
        } @else {
          <mat-icon class="mi">person</mat-icon>
        }
      </span>
      <!-- Rotating the whole rim swings the chip around the badge while the
           sprite inside stays upright. -->
      <span class="aim"><span class="tip"></span></span>
    </button>
  `,
  styles: [
    `
      :host {
        position: absolute;
        left: 0;
        top: 0;
        z-index: 6;
        transform: translate3d(
          calc(var(--uc-ind-x, 0px) - 22px),
          calc(var(--uc-ind-y, 0px) - 22px),
          0
        );
        will-change: transform;
        animation: uc-ind-in 0.18s ease;
      }
      @keyframes uc-ind-in {
        from {
          opacity: 0;
        }
        to {
          opacity: 1;
        }
      }

      .badge {
        position: relative;
        width: 44px;
        height: 44px;
        padding: 0;
        border: 0;
        background: none;
        cursor: pointer;
        display: block;
      }

      .ring {
        position: absolute;
        inset: 0;
        border-radius: 50%;
        overflow: hidden;
        display: flex;
        align-items: flex-end;
        justify-content: center;
        background: radial-gradient(circle at 50% 35%, #2b3b21, #0f140a);
        border: 2px solid #8fe0a0;
        box-shadow:
          0 0 0 1px rgba(0, 0, 0, 0.7),
          0 0 14px rgba(103, 194, 128, 0.4);
        /* Reads as live rather than as static furniture. */
        animation: uc-ind-pulse 1.6s ease-in-out infinite;
      }
      @keyframes uc-ind-pulse {
        0%,
        100% {
          transform: scale(1);
        }
        50% {
          transform: scale(1.07);
        }
      }

      .mini {
        width: 30px;
        height: 30px;
        object-fit: contain;
        object-position: bottom center;
        margin-bottom: 3px;
        image-rendering: pixelated;
      }
      .mi {
        font-size: 24px;
        width: 24px;
        height: 24px;
        line-height: 24px;
        color: #cfe6bd;
        margin-bottom: 4px;
      }

      .aim {
        position: absolute;
        inset: 0;
        transform: rotate(var(--uc-ind-a, 0deg));
        pointer-events: none;
      }
      /* Drawn pointing up; the .aim rotation carries it to the true bearing. */
      .tip {
        position: absolute;
        left: 50%;
        top: -10px;
        margin-left: -7px;
        width: 0;
        height: 0;
        border: 7px solid transparent;
        border-bottom-color: #8fe0a0;
        filter: drop-shadow(0 -1px 2px rgba(0, 0, 0, 0.8));
      }
    `,
  ],
})
export class UcOffscreenIndicatorComponent {
  /** Your recoloured creature sprite; falls back to a generic person glyph. */
  @Input() spriteUrl: string | null = null;
  @Output() tap = new EventEmitter<void>();
}
