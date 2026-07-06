import { Injectable, computed, inject, signal } from '@angular/core';
import { UserService } from '../../services/user.service';
import { UndercityApiService, UndercityApiError } from './undercity-api.service';
import { ActionResponse, GameState, PublicPlayer, YouDoc } from './undercity-models';

const POLL_INTERVAL_MS = 10_000;

export interface RosterDiff {
  arrived: string[];
  departed: string[];
  restyled: string[];
}

/**
 * Signal store for the Undercity. One 10-second poll (only while the page is
 * mounted and the tab is visible) feeds every tab; own actions apply their
 * response optimistically and the next poll reconciles.
 */
@Injectable({ providedIn: 'root' })
export class UndercityStateService {
  private readonly api = inject(UndercityApiService);
  private readonly userService = inject(UserService);

  private readonly _state = signal<GameState | null>(null);
  private readonly _loading = signal(false);
  private readonly _error = signal<string | null>(null);
  private readonly _diff = signal<RosterDiff>({ arrived: [], departed: [], restyled: [] });

  readonly state = this._state.asReadonly();
  readonly loading = this._loading.asReadonly();
  readonly error = this._error.asReadonly();
  readonly rosterDiff = this._diff.asReadonly();

  readonly season = computed(() => this._state()?.season ?? null);
  readonly you = computed(() => this._state()?.you ?? null);
  readonly players = computed(() => this._state()?.players ?? []);
  readonly events = computed(() => this._state()?.events ?? []);
  readonly snares = computed(() => this._state()?.snares ?? []);
  readonly wardrobe = computed(() => this._state()?.wardrobe ?? null);
  readonly result = computed(() => this._state()?.result ?? null);
  readonly hallOfFame = computed(() => this._state()?.hallOfFame ?? []);

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
      this.computeDiff(this._state()?.players ?? [], next.players ?? []);
      this._state.set(next);
      this._error.set(null);
    } catch (e) {
      this._error.set(e instanceof Error ? e.message : 'Network error');
    } finally {
      this._loading.set(false);
    }
  }

  /**
   * Run a server action. The returned `you` doc is applied optimistically;
   * anything that affects other players triggers a full refresh.
   */
  async action(type: string, payload: Record<string, unknown> = {}): Promise<ActionResponse> {
    try {
      const resp = await this.api.action(type, payload);
      if (resp.you) this.patchYou(resp.you);
      void this.refresh();
      return resp;
    } catch (e) {
      if (e instanceof UndercityApiError && e.status === 409) {
        // Stale local state — reconcile and surface the message.
        void this.refresh();
      }
      throw e;
    }
  }

  private patchYou(you: YouDoc): void {
    const cur = this._state();
    if (!cur) return;
    this._state.set({ ...cur, you });
  }

  private computeDiff(prev: PublicPlayer[], next: PublicPlayer[]): void {
    if (!prev.length && !next.length) return;
    const prevMap = new Map(prev.map((p) => [p.userId, p]));
    const nextMap = new Map(next.map((p) => [p.userId, p]));
    const arrived: string[] = [];
    const departed: string[] = [];
    const restyled: string[] = [];
    for (const p of next) {
      const old = prevMap.get(p.userId);
      if (!old) {
        arrived.push(p.userId);
      } else if (
        old.form !== p.form ||
        old.hat !== p.hat ||
        JSON.stringify(old.paint) !== JSON.stringify(p.paint)
      ) {
        restyled.push(p.userId);
      }
    }
    for (const p of prev) {
      if (!nextMap.has(p.userId)) departed.push(p.userId);
    }
    if (arrived.length || departed.length || restyled.length) {
      this._diff.set({ arrived, departed, restyled });
    }
  }

  get ownUserId(): string | null {
    return this.userService.userId();
  }
}
