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

/** The 8 popups that represent a real decision point — these remember
 * whether they're open across a tab switch, since BoardTabComponent (where
 * they live) is destroyed/recreated every time the active tab changes. */
export type FacilityKind =
  | 'shop'
  | 'shrine'
  | 'ossuary'
  | 'tradingPost'
  | 'excavation'
  | 'vein'
  | 'vault'
  | 'warp';

export interface OpenFacility {
  kind: FacilityKind;
  /** Only 'shop' uses this, to restore the selected Bazaar sub-tab. */
  shopTab?: 'gear' | 'consumables' | 'grimoires';
  /** Only 'warp' uses this — the destination list isn't derivable from any
   * other store signal, so it's carried directly. */
  warpOptions?: string[];
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
  readonly pendingBattle = computed(() => this._state()?.battle ?? null);
  readonly events = computed(() => this._state()?.events ?? []);
  readonly snares = computed(() => this._state()?.snares ?? []);
  readonly tradingPosts = computed(() => this._state()?.tradingPosts ?? {});
  readonly bazaars = computed(() => this._state()?.bazaars ?? {});
  readonly excavations = computed(() => this._state()?.excavations ?? {});
  readonly veins = computed(() => this._state()?.veins ?? {});
  readonly vaults = computed(() => this._state()?.vaults ?? {});
  readonly barriersOpen = computed(() => this._state()?.barriersOpen ?? []);
  readonly guardians = computed(() => this._state()?.guardians ?? {});
  readonly wardrobe = computed(() => this._state()?.wardrobe ?? null);
  readonly result = computed(() => this._state()?.result ?? null);
  readonly hallOfFame = computed(() => this._state()?.hallOfFame ?? []);

  /** Which facility/decision modal is open, if any — survives BoardTabComponent
   * being torn down and rebuilt when the player switches tabs. */
  readonly openFacility = signal<OpenFacility | null>(null);

  /** Monotonic pulse asking the mounted board canvas to re-center on the
   * player's own creature (e.g. tapping the HUD portrait). Bumped, not toggled,
   * so repeat taps keep firing. */
  readonly recenterRequest = signal(0);
  requestRecenter(): void {
    this.recenterRequest.update((n) => n + 1);
  }

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
      const cur = this._state();
      // A poll that started before a just-applied action can land late with a
      // stale `you` (old position, pendingMove still set) and yank the token
      // back. `ver` increments on every server write, so keep our newer
      // optimistic doc whenever the snapshot is older.
      if (
        cur?.you &&
        next.you &&
        typeof cur.you.ver === 'number' &&
        typeof next.you.ver === 'number' &&
        next.you.ver < cur.you.ver
      ) {
        next.you = cur.you;
      }
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
