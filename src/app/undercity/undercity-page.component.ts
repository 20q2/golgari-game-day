import {
  Component,
  OnDestroy,
  OnInit,
  computed,
  effect,
  inject,
  signal,
} from '@angular/core';
import { CommonModule } from '@angular/common';
import { MatIconModule } from '@angular/material/icon';
import { UserService } from '../services/user.service';
import { UndercityStateService } from './services/undercity-state.service';
import { preloadAll, getRecoloredWithHatDataUrl } from './engine/sprite-engine';
import { BoardMap } from './engine/board-canvas';
import { decideMapSync, MapSyncState } from './engine/map-sync';
import { UndercityApiService } from './services/undercity-api.service';
import { formSprite } from './data/species';
import { xpToNext, formName } from './data/forms';
import { STATUS_INFO, StatusInfo } from './data/combat';
import { DUNGEONS, SIGILS_REQUIRED } from './data/dungeons';
import { HatchFlowComponent } from './hatch/hatch-flow.component';
import { BoardTabComponent } from './tabs/board-tab.component';
import { CreatureTabComponent } from './tabs/creature-tab.component';
import { PlazaTabComponent } from './tabs/plaza-tab.component';
import { LogTabComponent } from './tabs/log-tab.component';
import { HostPanelComponent } from './host/host-panel.component';
import { CeremonyComponent } from './ceremony/ceremony.component';

type Tab = 'board' | 'creature' | 'gear' | 'plaza' | 'log';

@Component({
  selector: 'app-undercity-page',
  standalone: true,
  imports: [
    CommonModule,
    MatIconModule,
    HatchFlowComponent,
    BoardTabComponent,
    CreatureTabComponent,
    PlazaTabComponent,
    LogTabComponent,
    HostPanelComponent,
    CeremonyComponent,
  ],
  templateUrl: './undercity-page.component.html',
  styleUrls: ['./undercity-page.component.scss'],
})
export class UndercityPageComponent implements OnInit, OnDestroy {
  protected readonly userService = inject(UserService);
  protected readonly store = inject(UndercityStateService);
  private readonly api = inject(UndercityApiService);

  protected readonly tab = signal<Tab>('board');
  protected readonly assetsReady = signal(false);
  protected readonly map = signal<BoardMap | null>(null);
  protected readonly formName = formName;
  /** Guild Sigils needed to unseal the Queen — for the HUD tracker. */
  protected readonly sigilsRequired = SIGILS_REQUIRED;
  /** Guild Sigils held: lair first-kills recorded in poiClaims (mirrors the
   *  count board-tab uses for the sigil-claimed celebration). */
  /** Royal Jelly on hand — dropped only by the Scouring Swarm, spent only in
   *  the bazaar's Awakening back room. Hidden until you hold some. */
  protected readonly royalJelly = computed(() => this.store.you()?.royalJelly ?? 0);

  protected readonly sigilsHeld = computed(() => {
    const claims = this.store.you()?.poiClaims ?? [];
    return Object.keys(DUNGEONS).filter((b) => claims.includes(`${b}_lair`)).length;
  });

  /** Something needs the player's attention at the incubator, so the Gear tab
   *  icon flags it with an egg. Two cases, mirroring creature-tab:
   *   1. Free incubator + eggs sitting uncooked — a nudge to go incubate one.
   *   2. An egg is slotted and has been carried far enough — tap it to hatch.
   *  Incubation is a STEP timer, so this lights up when the walk finishes, not
   *  on a clock; no nowMs() dependency is needed. */
  protected readonly eggsWaiting = computed<boolean>(() => {
    const you = this.store.you();
    if (!you) return false;
    const inc = you.incubator;
    if (!inc) return (you.eggs?.length ?? 0) > 0;
    return (inc.spacesLeft ?? 0) <= 0;
  });

  protected readonly phase = computed<
    'signin' | 'loading' | 'idle' | 'lobby' | 'hatch' | 'play' | 'ended'
  >(() => {
    if (!this.userService.isSignedIn()) return 'signin';
    const state = this.store.state();
    if (!state || !this.assetsReady() || !this.map()) return 'loading';
    const season = state.season;
    if (!season) return 'idle';
    if (season.status === 'lobby') return 'lobby';
    if (season.status === 'ended') return 'ended';
    if (season.status !== 'active') return 'idle';
    return state.you ? 'play' : 'hatch';
  });

  /** Wall-clock tick (ms) driving the lobby countdown; updated every second. */
  protected readonly nowMs = signal(Date.now());
  private lobbyTimer: ReturnType<typeof setInterval> | null = null;

  /** Human countdown to the lobby launch time, or a ready/idle string. */
  protected readonly launchCountdown = computed(() => {
    const iso = this.store.season()?.launchAt;
    if (!iso) return null;
    const target = new Date(iso).getTime();
    if (Number.isNaN(target)) return null;
    let secs = Math.floor((target - this.nowMs()) / 1000);
    if (secs <= 0) return 'ready';
    const h = Math.floor(secs / 3600);
    secs -= h * 3600;
    const m = Math.floor(secs / 60);
    const s = secs - m * 60;
    const pad = (n: number) => n.toString().padStart(2, '0');
    return h > 0 ? `${h}:${pad(m)}:${pad(s)}` : `${m}:${pad(s)}`;
  });

  protected readonly hpPct = computed(() => {
    const you = this.store.you();
    if (!you) return 0;
    return Math.round((you.hp / Math.max(1, this.effectiveMaxHp())) * 100);
  });

  protected readonly effectiveMaxHp = computed(() => {
    const you = this.store.you();
    if (!you) return 1;
    // The server already reports the effective max (base + every +Max HP gear
    // piece + the Carapace Grind perk) on both the state fetch and every action
    // response, so trust it directly. Re-deriving a single gear's bonus here
    // used to double-count Troll Hide and miss all the other maxHp sources.
    return you.maxHp;
  });

  protected readonly xpPct = computed(() => {
    const you = this.store.you();
    if (!you) return 0;
    return Math.min(100, Math.round((you.xp / xpToNext(you.level)) * 100));
  });

  protected readonly xpNext = computed(() => {
    const you = this.store.you();
    return you ? xpToNext(you.level) : 0;
  });

  /** Recolored portrait of the player's creature for the HUD avatar. */
  protected readonly youSpriteUrl = computed(() => {
    const you = this.store.you();
    if (!you) return null;
    const spr = formSprite(you.form, you.spriteVariant);
    return getRecoloredWithHatDataUrl(spr.sprite, you.paint ?? {}, spr.regions, you.hat);
  });

  /** Overworld buffs/curses carried into the next battle, mapped to HUD badges.
   * Reuses the in-battle STATUS_INFO registry so icons/blurbs stay in sync;
   * unknown kinds are skipped, buffs sort ahead of debuffs. */
  protected readonly activeBuffs = computed<{ kind: string; info: StatusInfo }[]>(() => {
    const buffs = this.store.you()?.buffs ?? [];
    const list = buffs
      .filter((b) => STATUS_INFO[b.kind])
      .map((b) => ({ kind: b.kind, info: STATUS_INFO[b.kind] }))
      .sort((a, b) => Number(a.info.tone === 'debuff') - Number(b.info.tone === 'debuff'));
    // Pending pass-through-gate heal: a client-only anticipatory buff shown while
    // the plotted route crosses a gate. The heal itself (50% of max HP) is applied
    // server-side when the move commits; this just surfaces it in the buff HUD.
    if (this.store.gateHealPending()) {
      list.unshift({
        kind: 'gate_heal',
        info: {
          label: 'Gate Blessing',
          icon: 'auto_awesome',
          tone: 'buff',
          blurb: 'Restore 50% of max HP when you finish moving.',
        },
      });
    }
    // Pending economy-companion scavenge: a client-only anticipatory buff shown
    // while the plotted route passes over a loot space with an economy pet out.
    // The Spores are banked server-side when the move commits (collect from the
    // pet's board box).
    if (this.store.petScavengePending()) {
      list.unshift({
        kind: 'pet_scavenge',
        info: {
          label: 'Scavenging',
          icon: 'grass',
          tone: 'buff',
          blurb: 'Your companion banks Spores from each loot space you pass over.',
        },
      });
    }
    return list;
  });

  /** Collapsed HUD pill caps at this many badges so a stack of buffs (e.g. a
   * Squirrel Warrior mid-spree) stays a compact chip instead of ballooning into
   * a multi-row pill over the board. The overflow rolls into a `+N` badge; the
   * tap-to-expand detail panel still lists every effect (it scrolls). */
  private static readonly MAX_HUD_BADGES = 6;

  /** Badges to render in the collapsed pill, plus how many are hidden behind the
   * `+N` overflow chip. Shows everything when it fits; otherwise reserves the
   * last slot for the counter so the pill never exceeds MAX_HUD_BADGES chips. */
  protected readonly hudBadges = computed(() => {
    const all = this.activeBuffs();
    const max = UndercityPageComponent.MAX_HUD_BADGES;
    if (all.length <= max) return { shown: all, overflow: 0 };
    return { shown: all.slice(0, max - 1), overflow: all.length - (max - 1) };
  });

  /** Whether the floating buff detail panel (tap-to-expand) is open. */
  protected readonly showBuffDetails = signal(false);

  /** Outside-tap dismissal for the buff panel, live only while it's open. It used
   *  to be a fixed, full-screen catcher div, which meant an open buff tooltip
   *  froze the board underneath: every drag went into the catcher instead of
   *  panning the map. A document listener dismisses just as reliably and leaves
   *  the board's own gestures alone. */
  private buffDismiss: ((e: PointerEvent) => void) | null = null;

  protected toggleBuffDetails(): void {
    if (this.showBuffDetails()) {
      this.closeBuffDetails();
      return;
    }
    this.showBuffDetails.set(true);
    // The badge row and the panel itself are inside .hud-buffs, so neither the
    // opening tap nor a scroll of the list counts as "outside".
    this.buffDismiss = (e: PointerEvent) => {
      if (e.target instanceof Element && e.target.closest('.hud-buffs')) return;
      this.closeBuffDetails();
    };
    document.addEventListener('pointerdown', this.buffDismiss);
  }

  private closeBuffDetails(): void {
    this.showBuffDetails.set(false);
    if (this.buffDismiss) {
      document.removeEventListener('pointerdown', this.buffDismiss);
      this.buffDismiss = null;
    }
  }

  /** True while a battle is in progress — the server tracks this independently
   * of which tab is mounted, via UndercityStateService.pendingBattle(). */
  protected readonly inBattle = computed(() => !!this.store.pendingBattle());

  /** Level-up celebration — the new level and how many levels were gained in
   * one go. Null when nothing is being celebrated. */
  protected readonly levelUpCelebration = signal<{ level: number; gained: number } | null>(null);
  /** Last level we've seen for the current creature; null before the first
   * read and whenever there's no creature (so a fresh hatch re-seeds cleanly).
   * Seeding silently on first read means reopening an existing creature never
   * fires a false celebration. */
  private prevLevel: number | null = null;
  /** Last castRequest id acted on, so the tab-switch fires once per request. */
  private lastCastReqId = 0;
  /** Levels gained but not yet celebrated — banked while a battle is in
   * progress so the fanfare pops once the victory screen closes. */
  private pendingLevels = 0;

  /** A gain this size or larger gets the gold "big win" treatment — big enough
   * to catch doubled jackpots (+60), first lair clears (+60), and fat PvP
   * steals while ordinary +20/+26/+30 pickups stay on the plain float. */
  private static readonly SPORE_BIG_GAIN = 40;

  /** Floating spore-delta shown when the wallet changes (board pickups, loot,
   * PvP steals, purchases). `amount` is signed; `big` flags a jackpot-scale
   * gain; `id` restarts the CSS float on repeated changes. Null when idle. */
  protected readonly sporeDelta = signal<{ id: number; amount: number; big: boolean } | null>(null);
  /** True for a beat after any spore change — drives the number's pop pulse. */
  protected readonly sporePulse = signal(false);
  /** True for a beat after a big gain — upgrades the number's pop to the
   * gold jackpot bump. Follows the same timing as `sporePulse`. */
  protected readonly sporeBig = signal(false);
  /** The active delta as a 0-or-1 element list so the template's keyed `@for`
   * recreates the node per `id`, restarting the float animation on rapid,
   * back-to-back wallet changes. */
  protected readonly sporeDeltaList = computed(() => {
    const d = this.sporeDelta();
    return d ? [d] : [];
  });
  /** Last wallet total we've seen; null before the first read / no creature so a
   * fresh hatch or a reopen never floats a phantom delta. */
  private prevSpores: number | null = null;
  private sporeAnimId = 0;
  private sporeDeltaTimer: ReturnType<typeof setTimeout> | null = null;
  private sporePulseTimer: ReturnType<typeof setTimeout> | null = null;

  /** Board-map staleness tracking (see engine/map-sync). `undefined` season =
   *  never fetched, so the first effect run does the initial load. */
  private mapSync: MapSyncState = { loadedSeason: undefined, posHealAttempted: false };
  private mapFetching = false;

  constructor() {
    // Central level-up watcher: `you.level` can rise from battles, board
    // spaces, or any other action, so we watch the one shared signal here in
    // the always-mounted page rather than in each source.
    effect(() => {
      const you = this.store.you();
      const inBattle = this.inBattle();
      if (!you) {
        this.prevLevel = null;
        this.pendingLevels = 0;
        return;
      }
      if (this.prevLevel === null) {
        this.prevLevel = you.level;
        return;
      }
      if (you.level > this.prevLevel) {
        this.pendingLevels += you.level - this.prevLevel;
        this.prevLevel = you.level;
      }
      // Hold the fanfare until we're clear of battle, no higher-priority
      // post-battle celebration (sigil / raid summary) is queued or showing, and
      // nothing else is already up — then flush the banked levels into one card.
      if (
        this.pendingLevels > 0 &&
        !inBattle &&
        !this.store.landingDialogHold() &&
        !this.levelUpCelebration()
      ) {
        this.levelUpCelebration.set({ level: this.prevLevel, gained: this.pendingLevels });
        this.pendingLevels = 0;
      }
    });

    // Magic-menu cast routing: when a spell aimed from the Gear menu needs board
    // context, the store bumps castRequest — switch to the Board so its targeting
    // picker (opened by the board tab's own watcher) is visible.
    effect(() => {
      const req = this.store.castRequest();
      if (req && req.id !== this.lastCastReqId) {
        this.lastCastReqId = req.id;
        this.setTab('board');
      }
    });

    // Spore-wallet watcher: the counter ticks up (pickups, loot, PvP steals) and
    // down (purchases, penalties) from many sources, so we watch the one shared
    // signal here and float a signed delta + pulse the number on any change.
    effect(() => {
      const you = this.store.you();
      if (!you) {
        this.prevSpores = null;
        return;
      }
      if (this.prevSpores === null) {
        this.prevSpores = you.spores;
        return;
      }
      const delta = you.spores - this.prevSpores;
      this.prevSpores = you.spores;
      if (delta === 0) return;

      const big = delta >= UndercityPageComponent.SPORE_BIG_GAIN;
      this.sporeDelta.set({ id: ++this.sporeAnimId, amount: delta, big });
      this.sporePulse.set(true);
      this.sporeBig.set(big);
      if (this.sporeDeltaTimer) clearTimeout(this.sporeDeltaTimer);
      if (this.sporePulseTimer) clearTimeout(this.sporePulseTimer);
      // Big wins float a touch longer so the gold flourish has room to read.
      this.sporeDeltaTimer = setTimeout(() => this.sporeDelta.set(null), big ? 1500 : 1100);
      this.sporePulseTimer = setTimeout(() => {
        this.sporePulse.set(false);
        this.sporeBig.set(false);
      }, big ? 600 : 450);
    });

    // Board-map loader + self-healer. The night's board (surface + this season's
    // procedural depths) is fetched here rather than once in ngOnInit so it can
    // re-fetch when it goes stale: on the initial load, when a fresh night rolls
    // over (seasonId changes), and — the critical fix — when the player's node
    // is missing from the loaded map. That last case is the dungeon desync bug:
    // a stale map lacks the server's current depths node, layerIndex silently
    // files it under `overworld`, and the dungeon renders fully lit and
    // unwalkable. decideMapSync guards against re-fetch loops.
    effect(() => {
      const season = this.store.season()?.seasonId ?? null;
      const position = this.store.you()?.position;
      const map = this.map();
      if (this.mapFetching) return;
      const mapNodeIds = map ? new Set(map.nodes.map((n) => n.id)) : null;
      const decision = decideMapSync(this.mapSync, { season, position, mapNodeIds });
      if (!decision.refetch) return;
      this.mapFetching = true;
      this.api
        .getMap()
        .then((m) => {
          this.mapSync = decision.next;
          this.map.set(m);
        })
        .catch(() => {
          // Leave the current map in place; a later season/state tick retries.
        })
        .finally(() => {
          this.mapFetching = false;
        });
    });
  }

  async ngOnInit(): Promise<void> {
    // Lock the document to the visible viewport for this full-screen sub-game.
    // The global `body.undercity-page` rules kill the default min-height:100lvh
    // that otherwise leaves scrollable dead space below the app on mobile.
    document.body.classList.add('undercity-page');
    void preloadAll().then(() => this.assetsReady.set(true));
    // The board map is loaded (and kept fresh) by the map-sync effect in the
    // constructor — see decideMapSync — not fetched once here.
    if (this.userService.isSignedIn()) {
      this.store.startPolling();
    }
    this.lobbyTimer = setInterval(() => this.nowMs.set(Date.now()), 1000);
  }

  ngOnDestroy(): void {
    document.body.classList.remove('undercity-page');
    this.closeBuffDetails();
    this.store.stopPolling();
    if (this.sporeDeltaTimer) clearTimeout(this.sporeDeltaTimer);
    if (this.sporePulseTimer) clearTimeout(this.sporePulseTimer);
    if (this.lobbyTimer) clearInterval(this.lobbyTimer);
  }

  async signIn(): Promise<void> {
    const ok = await this.userService.requireSignIn();
    if (ok) this.store.startPolling();
  }

  setTab(tab: Tab): void {
    if (tab !== 'board' && this.inBattle()) return;
    this.tab.set(tab);
  }

  /** Tapping the HUD portrait re-centers the board camera on your creature.
   * Only meaningful while the board is showing, so it's a no-op elsewhere. */
  focusOwnCreature(): void {
    if (this.tab() !== 'board') return;
    this.store.requestRecenter();
  }

  /** Dismiss the level-up fanfare without navigating. */
  closeLevelUp(): void {
    this.levelUpCelebration.set(null);
  }

  /** "Upgrade Stats" — close the fanfare and jump to the Creature tab, landing
   * on the Stats sub-screen (where points are spent) regardless of which
   * creature sub-tab was last open. The creature tab is recreated on switch and
   * seeds its sub-tab from this localStorage key, so writing it first pins it. */
  goUpgradeStats(): void {
    this.levelUpCelebration.set(null);
    try {
      localStorage.setItem('uc-creature-subtab', 'stats');
    } catch {
      /* storage blocked — fall back to whatever sub-tab loads */
    }
    this.tab.set('creature');
  }
}
