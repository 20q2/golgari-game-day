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

type Tab = 'board' | 'creature' | 'plaza' | 'log';

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
  protected readonly sigilsHeld = computed(() => {
    const claims = this.store.you()?.poiClaims ?? [];
    return Object.keys(DUNGEONS).filter((b) => claims.includes(`${b}_lair`)).length;
  });

  protected readonly phase = computed<'signin' | 'loading' | 'idle' | 'hatch' | 'play' | 'ended'>(
    () => {
      if (!this.userService.isSignedIn()) return 'signin';
      const state = this.store.state();
      if (!state || !this.assetsReady() || !this.map()) return 'loading';
      const season = state.season;
      if (!season) return 'idle';
      if (season.status === 'ended') return 'ended';
      if (season.status !== 'active') return 'idle';
      return state.you ? 'play' : 'hatch';
    },
  );

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
    return buffs
      .filter((b) => STATUS_INFO[b.kind])
      .map((b) => ({ kind: b.kind, info: STATUS_INFO[b.kind] }))
      .sort((a, b) => Number(a.info.tone === 'debuff') - Number(b.info.tone === 'debuff'));
  });

  /** Whether the floating buff detail panel (tap-to-expand) is open. */
  protected readonly showBuffDetails = signal(false);

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
  /** Levels gained but not yet celebrated — banked while a battle is in
   * progress so the fanfare pops once the victory screen closes. */
  private pendingLevels = 0;

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
        !this.store.levelUpHold() &&
        !this.levelUpCelebration()
      ) {
        this.levelUpCelebration.set({ level: this.prevLevel, gained: this.pendingLevels });
        this.pendingLevels = 0;
      }
    });
  }

  async ngOnInit(): Promise<void> {
    // Lock the document to the visible viewport for this full-screen sub-game.
    // The global `body.undercity-page` rules kill the default min-height:100lvh
    // that otherwise leaves scrollable dead space below the app on mobile.
    document.body.classList.add('undercity-page');
    void preloadAll().then(() => this.assetsReady.set(true));
    void this.api.getMap().then((m) => this.map.set(m));
    if (this.userService.isSignedIn()) {
      this.store.startPolling();
    }
  }

  ngOnDestroy(): void {
    document.body.classList.remove('undercity-page');
    this.store.stopPolling();
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

  /** "Upgrade Stats" — close the fanfare and jump to the Creature tab, where
   * stat points are spent. */
  goUpgradeStats(): void {
    this.levelUpCelebration.set(null);
    this.tab.set('creature');
  }
}
