import { Component, OnDestroy, effect, inject, signal, untracked } from '@angular/core';
import { MatIconModule } from '@angular/material/icon';
import { UndercityStateService } from '../services/undercity-state.service';

/** Material-icon per event type — mirrors log-tab.component's EVENT_ICONS. */
const EVENT_ICONS: Record<string, string> = {
  hatch: 'egg',
  claim: 'casino',
  level: 'trending_up',
  evolve: 'auto_awesome',
  compost: 'compost',
  undying: 'autorenew',
  pvp: 'sports_kabaddi',
  poke: 'touch_app',
  snare: 'gps_fixed',
  jackpot: 'paid',
  season: 'nightlight',
  boss: 'whatshot',
};

/** How long a row lingers on screen before it auto-hides (ms). */
const LINGER_MS = 8000;
/** Slide-out duration; the row is dropped from the list after this (ms). */
const LEAVE_MS = 260;
/** Max rows on screen at once. */
const MAX_ROWS = 5;

interface FeedRow {
  id: number;
  icon: string;
  text: string;
  leaving: boolean;
}

/**
 * Bottom-left board ticker: surfaces genuinely-new Grapevine events while the
 * board tab is mounted. Newest slides in at the bottom; rows auto-hide after a
 * linger or get shoved off the top when a 6th arrives. Display-only overlay
 * (see the SCSS: pointer-events:none, so it never blocks board taps).
 */
@Component({
  selector: 'app-undercity-event-feed',
  standalone: true,
  imports: [MatIconModule],
  templateUrl: './board-event-feed.component.html',
  styleUrls: ['./board-event-feed.component.scss'],
})
export class BoardEventFeedComponent implements OnDestroy {
  private readonly store = inject(UndercityStateService);

  protected readonly rows = signal<FeedRow[]>([]);

  private nextId = 0;
  /** ts of the newest event already accounted for; null until the first
   * non-empty poll settles (prevents a slide-in storm on mount / cold start). */
  private watermark: string | null = null;
  private readonly timers = new Set<ReturnType<typeof setTimeout>>();

  constructor() {
    effect(() => {
      const events = this.store.events(); // newest-first (server ScanIndexForward=False)
      untracked(() => {
        if (this.watermark === null) {
          if (!events.length) return; // not loaded yet — stay unsettled
          this.watermark = events[0].ts; // adopt current head, show nothing
          return;
        }
        // Genuinely-new events (ts strictly greater than the watermark),
        // reversed to oldest-first so the freshest lands at the bottom.
        const fresh = events.filter((e) => e.ts > this.watermark!).reverse();
        if (!fresh.length) return;
        this.watermark = events[0].ts;
        for (const e of fresh) this.push(e.type, e.text);
      });
    });
  }

  private push(type: string, text: string): void {
    const id = this.nextId++;
    this.rows.update((rs) => [
      ...rs,
      { id, icon: EVENT_ICONS[type] ?? 'spa', text, leaving: false },
    ]);
    // Auto-hide after a linger.
    this.schedule(() => this.beginLeave(id), LINGER_MS);
    // Overflow: shove the oldest non-leaving rows off the top.
    const active = this.rows().filter((r) => !r.leaving);
    const over = active.length - MAX_ROWS;
    if (over > 0) for (const r of active.slice(0, over)) this.beginLeave(r.id);
  }

  private beginLeave(id: number): void {
    let found = false;
    this.rows.update((rs) =>
      rs.map((r) => {
        if (r.id === id && !r.leaving) {
          found = true;
          return { ...r, leaving: true };
        }
        return r;
      }),
    );
    if (!found) return; // already leaving / gone
    this.schedule(() => this.rows.update((rs) => rs.filter((r) => r.id !== id)), LEAVE_MS);
  }

  private schedule(fn: () => void, ms: number): void {
    const t = setTimeout(() => {
      this.timers.delete(t);
      fn();
    }, ms);
    this.timers.add(t);
  }

  ngOnDestroy(): void {
    for (const t of this.timers) clearTimeout(t);
    this.timers.clear();
  }
}
