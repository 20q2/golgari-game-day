import {
  ChangeDetectionStrategy,
  Component,
  DestroyRef,
  Input,
  computed,
  inject,
  signal,
} from '@angular/core';

/** Mirror of POKE_COOLDOWN_MIN in infrastructure/lambda/undercity_config.py. */
export const POKE_COOLDOWN_MIN = 15;

const RADIUS = 12.5;
const CIRC = 2 * Math.PI * RADIUS;

/**
 * Small countdown wheel shown in place of the poke button while a creature's
 * poke timer is running. The ring drains as the cooldown elapses and the
 * center shows the time left (minutes, or seconds under a minute).
 */
@Component({
  selector: 'app-uc-poke-wheel',
  standalone: true,
  changeDetection: ChangeDetectionStrategy.OnPush,
  template: `
    <svg viewBox="0 0 30 30" [attr.aria-label]="title()" role="img">
      <title>{{ title() }}</title>
      <circle class="track" cx="15" cy="15" [attr.r]="radius" />
      <circle
        class="arc"
        cx="15"
        cy="15"
        [attr.r]="radius"
        [style.stroke-dasharray]="dash()"
        transform="rotate(-90 15 15)"
      />
      <text x="15" y="15.5" text-anchor="middle" dominant-baseline="central">
        {{ label() }}
      </text>
    </svg>
  `,
  styles: [
    `
      :host {
        display: inline-flex;
        width: 30px;
        height: 30px;
        flex-shrink: 0;
      }

      svg {
        width: 100%;
        height: 100%;
      }

      .track {
        fill: none;
        stroke: rgba(242, 169, 0, 0.18);
        stroke-width: 2.5;
      }

      .arc {
        fill: none;
        stroke: #f2a900;
        stroke-width: 2.5;
        stroke-linecap: round;
        opacity: 0.85;
        transition: stroke-dasharray 1s linear;
      }

      text {
        fill: #f2a900;
        font-size: 8.5px;
        font-weight: 700;
      }
    `,
  ],
})
export class PokeWheelComponent {
  /** Server pokeCooldownUntil — UTC ISO string without a tz suffix. */
  @Input({ required: true }) set until(value: string) {
    this.untilMs.set(new Date(value + 'Z').getTime());
  }

  protected readonly radius = RADIUS;
  private readonly untilMs = signal(0);
  private readonly now = signal(Date.now());

  constructor() {
    const id = setInterval(() => this.now.set(Date.now()), 1000);
    inject(DestroyRef).onDestroy(() => clearInterval(id));
  }

  private readonly remainingMs = computed(() => Math.max(0, this.untilMs() - this.now()));

  /** Fraction of the cooldown still left — the filled part of the ring. */
  private readonly frac = computed(() =>
    Math.min(1, this.remainingMs() / (POKE_COOLDOWN_MIN * 60_000)),
  );

  protected readonly dash = computed(() => `${this.frac() * CIRC} ${CIRC}`);

  protected readonly label = computed(() => {
    const secs = Math.ceil(this.remainingMs() / 1000);
    return secs >= 60 ? `${Math.ceil(secs / 60)}m` : `${secs}s`;
  });

  protected readonly title = computed(() => `Poked recently — ready in ${this.label()}`);
}
