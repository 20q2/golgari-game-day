import {
  Component,
  EventEmitter,
  Input,
  OnDestroy,
  OnInit,
  Output,
  computed,
  signal,
} from '@angular/core';

// Pip positions on a 3×3 grid (indices 0–8, row-major) per die face.
const PIPS: Record<number, number[]> = {
  1: [4],
  2: [2, 6],
  3: [2, 4, 6],
  4: [0, 2, 6, 8],
  5: [0, 2, 4, 6, 8],
  6: [0, 2, 3, 5, 6, 8],
};

const TUMBLE_MS = 90;
const MIN_TUMBLE_MS = 700;
const SETTLE_HOLD_MS = 900;

/**
 * A single d6 that tumbles through random faces until `value` arrives, then
 * settles on it with a landing pop and emits `settled`. Pure presentation —
 * the actual roll happens server-side; setting `value` back to null restarts
 * the tumble (e.g. a second Ossuary bet). Size via `--dice-size`.
 */
@Component({
  selector: 'app-undercity-dice-roll',
  standalone: true,
  templateUrl: './dice-roll.component.html',
  styleUrls: ['./dice-roll.component.scss'],
})
export class DiceRollComponent implements OnInit, OnDestroy {
  @Output() settled = new EventEmitter<void>();

  protected readonly face = signal(1);
  protected readonly state = signal<'tumbling' | 'settled'>('tumbling');
  protected readonly pips = computed(() => {
    const on = PIPS[this.face()] ?? [];
    return Array.from({ length: 9 }, (_, i) => on.includes(i));
  });

  private finalValue: number | null = null;
  private startedAt = 0;
  private tumbleTimer: ReturnType<typeof setInterval> | null = null;
  private settleTimer: ReturnType<typeof setTimeout> | null = null;
  private holdTimer: ReturnType<typeof setTimeout> | null = null;
  private initialized = false;
  private readonly reducedMotion =
    typeof matchMedia === 'function' && matchMedia('(prefers-reduced-motion: reduce)').matches;

  /** Final face 1–6, or null while the server roll is still unknown. */
  @Input() set value(v: number | null | undefined) {
    this.finalValue = v ?? null;
    if (!this.initialized) return;
    if (this.finalValue === null) this.startTumble();
    else this.scheduleSettle();
  }

  ngOnInit(): void {
    this.initialized = true;
    this.startTumble();
    if (this.finalValue !== null) this.scheduleSettle();
  }

  ngOnDestroy(): void {
    this.clearTimers();
  }

  private startTumble(): void {
    this.clearTimers();
    this.state.set('tumbling');
    this.startedAt = Date.now();
    if (this.reducedMotion) return;
    this.tumbleTimer = setInterval(() => {
      let next = 1 + Math.floor(Math.random() * 6);
      if (next === this.face()) next = (next % 6) + 1;
      this.face.set(next);
    }, TUMBLE_MS);
  }

  private scheduleSettle(): void {
    if (this.settleTimer) clearTimeout(this.settleTimer);
    const elapsed = Date.now() - this.startedAt;
    const wait = this.reducedMotion ? 0 : Math.max(0, MIN_TUMBLE_MS - elapsed);
    this.settleTimer = setTimeout(() => this.settle(), wait);
  }

  private settle(): void {
    if (this.tumbleTimer) {
      clearInterval(this.tumbleTimer);
      this.tumbleTimer = null;
    }
    if (this.finalValue === null) return;
    this.face.set(this.finalValue);
    this.state.set('settled');
    this.holdTimer = setTimeout(() => this.settled.emit(), SETTLE_HOLD_MS);
  }

  private clearTimers(): void {
    if (this.tumbleTimer) clearInterval(this.tumbleTimer);
    if (this.settleTimer) clearTimeout(this.settleTimer);
    if (this.holdTimer) clearTimeout(this.holdTimer);
    this.tumbleTimer = null;
    this.settleTimer = null;
    this.holdTimer = null;
  }
}
