import { Injectable, computed, inject, signal } from '@angular/core';
import { UserService } from '../../services/user.service';
import { PushService } from '../../services/push.service';
import { UndercityApiService, UndercityApiError } from './undercity-api.service';
import { ActionResponse, ChatMessage, GameState, PublicPlayer, YouDoc } from './undercity-models';

const POLL_INTERVAL_MS = 10_000;

const CHAT_READ_KEY = 'uc-chat-read';
/** Mirror of the server's CHAT_STATE_LIMIT (undercity_db.py). */
const CHAT_KEEP = 50;

function readChatLastRead(): string {
  try {
    return localStorage.getItem(CHAT_READ_KEY) ?? '';
  } catch {
    return '';
  }
}

/** Union of known + incoming messages by id, in time order, newest CHAT_KEEP.
 * ISO timestamps compare lexicographically, so plain string sort is time sort. */
function mergeChat(known: ChatMessage[], incoming: ChatMessage[]): ChatMessage[] {
  const ids = new Set(incoming.map((m) => m.id));
  const merged = [...incoming, ...known.filter((m) => !ids.has(m.id))];
  merged.sort((a, b) => (a.ts < b.ts ? -1 : a.ts > b.ts ? 1 : 0));
  return merged.slice(-CHAT_KEEP);
}

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
  | 'warp'
  | 'flowPuzzle';

export interface OpenFacility {
  kind: FacilityKind;
  /** Only 'shop' uses this, to restore the selected Bazaar sub-tab. */
  shopTab?: 'gear' | 'consumables' | 'grimoires' | 'eggs';
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
  private readonly push = inject(PushService);
  private pushPrompted = false;

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
  readonly umori = computed(() => this._state()?.umori ?? null);
  readonly bazaars = computed(() => this._state()?.bazaars ?? {});
  readonly market = computed(() => this._state()?.market ?? []);
  readonly excavations = computed(() => this._state()?.excavations ?? {});
  readonly veins = computed(() => this._state()?.veins ?? {});
  readonly vaults = computed(() => this._state()?.vaults ?? {});
  readonly barriersOpen = computed(() => this._state()?.barriersOpen ?? []);
  readonly guardians = computed(() => this._state()?.guardians ?? {});
  readonly firsts = computed(() => this._state()?.firsts ?? {});
  readonly fogReveals = computed(() => this._state()?.fogReveals ?? {});
  readonly worldEvent = computed(() => this._state()?.worldEvent ?? null);
  readonly enraged = computed(() => this._state()?.enraged ?? null);
  readonly wardrobe = computed(() => this._state()?.wardrobe ?? null);
  readonly result = computed(() => this._state()?.result ?? null);
  readonly hallOfFame = computed(() => this._state()?.hallOfFame ?? []);
  readonly chat = computed(() => this._state()?.chat ?? []);

  /** ISO ts of the newest chat message the player has seen (panel open =
   * seen). Persisted so a reload doesn't re-badge the whole backlog. */
  private readonly chatLastRead = signal<string>(readChatLastRead());

  /** Unread badge count: others' messages newer than the last-read mark. */
  readonly chatUnread = computed(() => {
    const last = this.chatLastRead();
    const own = this.userService.userId();
    return this.chat().filter((m) => m.ts > last && m.userId !== own).length;
  });

  /** Advance the last-read mark to the newest message (chat panel is open). */
  markChatRead(): void {
    const msgs = this.chat();
    if (!msgs.length) return;
    const newest = msgs[msgs.length - 1].ts;
    if (newest <= this.chatLastRead()) return;
    this.chatLastRead.set(newest);
    try {
      localStorage.setItem(CHAT_READ_KEY, newest);
    } catch {
      /* storage blocked — badge resets on reload, harmless */
    }
  }

  /** Post a chat message; the server echoes it back and it's appended locally
   * so the sender sees it immediately instead of after the next poll. */
  async sendChat(text: string): Promise<void> {
    const resp = await this.action('chat', { text });
    if (resp.chat) this.appendChat(resp.chat);
  }

  private appendChat(msg: ChatMessage): void {
    const cur = this._state();
    if (!cur || (cur.chat ?? []).some((m) => m.id === msg.id)) return;
    this._state.set({ ...cur, chat: [...(cur.chat ?? []), msg] });
  }

  /** Which facility/decision modal is open, if any — survives BoardTabComponent
   * being torn down and rebuilt when the player switches tabs. */
  readonly openFacility = signal<OpenFacility | null>(null);

  /** Last board camera zoom, remembered so it's restored when the player leaves
   * the Board tab and comes back (the board tab is destroyed on tab switch).
   * Null until the board has been shown once. */
  readonly boardZoom = signal<number | null>(null);

  /** Held true by the board tab while a higher-priority post-battle celebration
   * (Guild Sigil fanfare, world-boss raid summary) is queued or showing, so the
   * always-mounted page defers its level-up fanfare until those are dismissed.
   * A store signal so it survives BoardTabComponent teardown. */
  readonly levelUpHold = signal(false);

  /** Held true by the board tab while the plotted/walked route crosses a gate,
   * so the always-mounted page's buff HUD can show the pending gate-pass heal
   * (restore 50% of max HP when the move ends) as a buff badge. Client-only:
   * the heal itself is applied server-side when the move commits. */
  readonly gateHealPending = signal(false);

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
      // Chat merges by id instead of being replaced wholesale: a poll racing
      // DynamoDB's eventually-consistent CHAT# query would otherwise briefly
      // drop a just-sent message that was appended optimistically.
      next.chat = mergeChat(cur?.chat ?? [], next.chat ?? []);
      this._state.set(next);
      if (next.you && !this.pushPrompted) {
        // Once the player has a creature they're committed to tonight — ask to
        // enable notifications (no-op if already subscribed or opted out). This
        // covers both the post-hatch case and reopening with a creature.
        this.pushPrompted = true;
        void this.push.ensureSubscribed();
      }
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

  /** Set the status-bubble text (server trims/caps; '' clears it). */
  async setStatus(text: string): Promise<void> {
    await this.action('set-status', { status: text });
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
