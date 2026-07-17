import { Injectable, computed, inject, signal } from '@angular/core';
import { UserService } from './user.service';
import { QueueApiService } from './queue-api.service';
import { QueuePushService } from './queue-push.service';
import { QueueEntry, QueueState } from './queue-models';

const POLL_INTERVAL_MS = 20_000;

/**
 * Signal store for tonight's queue. Polls while mounted and the tab is
 * visible; join/leave apply their response optimistically and the next poll
 * reconciles. Real-time "someone joined" awareness comes from push
 * notifications (QueuePushService), not from tight polling.
 */
@Injectable({ providedIn: 'root' })
export class QueueService {
  private readonly api = inject(QueueApiService);
  private readonly userService = inject(UserService);
  private readonly push = inject(QueuePushService);

  private readonly _state = signal<QueueState>({ seasonId: null, entries: [] });
  private readonly _loading = signal(false);
  private readonly _error = signal<string | null>(null);

  readonly seasonId = computed(() => this._state().seasonId);
  readonly entries = computed(() => this._state().entries);
  readonly isNightActive = computed(() => this._state().seasonId !== null);
  readonly loading = this._loading.asReadonly();
  readonly error = this._error.asReadonly();

  private pollTimer: ReturnType<typeof setInterval> | null = null;
  private visibilityHandler = () => {
    if (document.visibilityState === 'visible') void this.refresh();
  };

  startPolling(): void {
    if (this.pollTimer) return;
    void this.refresh();
    this.pollTimer = setInterval(() => {
      if (document.visibilityState === 'visible') void this.refresh();
    }, POLL_INTERVAL_MS);
    document.addEventListener('visibilitychange', this.visibilityHandler);
  }

  stopPolling(): void {
    if (this.pollTimer) {
      clearInterval(this.pollTimer);
      this.pollTimer = null;
    }
    document.removeEventListener('visibilitychange', this.visibilityHandler);
  }

  async refresh(): Promise<void> {
    if (this._loading()) return;
    this._loading.set(true);
    try {
      const next = await this.api.getState();
      this._state.set(next);
      this._error.set(null);
    } catch (e) {
      this._error.set(e instanceof Error ? e.message : 'Network error');
    } finally {
      this._loading.set(false);
    }
  }

  entryFor(gameId: string): QueueEntry | undefined {
    return this.entries().find((e) => e.gameId === gameId);
  }

  isJoined(gameId: string): boolean {
    const uid = this.userService.userId();
    if (!uid) return false;
    return this.entryFor(gameId)?.joined.some((m) => m.userId === uid) ?? false;
  }

  async join(gameId: string, gameTitle: string): Promise<void> {
    try {
      const resp = await this.api.join(gameId, gameTitle);
      this.applyEntry(gameId, resp.entry);
      this._error.set(null);
      void this.push.ensureSubscribed();
    } catch (e) {
      this._error.set(e instanceof Error ? e.message : 'Could not join the queue.');
      throw e;
    }
  }

  async leave(gameId: string): Promise<void> {
    try {
      const resp = await this.api.leave(gameId);
      this.applyEntry(gameId, resp.entry);
      this._error.set(null);
    } catch (e) {
      this._error.set(e instanceof Error ? e.message : 'Could not leave the queue.');
      throw e;
    }
  }

  private applyEntry(gameId: string, entry: QueueEntry | null): void {
    const cur = this._state();
    const rest = cur.entries.filter((e) => e.gameId !== gameId);
    this._state.set({
      ...cur,
      entries: entry ? [...rest, entry] : rest,
    });
  }
}
