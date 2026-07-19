import { Component, OnDestroy, OnInit, computed, inject, signal } from '@angular/core';
import { CommonModule } from '@angular/common';
import { HttpClient } from '@angular/common/http';
import { MatIconModule } from '@angular/material/icon';
import { firstValueFrom } from 'rxjs';
import { UserService } from '../services/user.service';
import { UndercityStateService } from './services/undercity-state.service';
import { preloadAll, getRecoloredWithHatDataUrl } from './engine/sprite-engine';
import { BoardMap } from './engine/board-canvas';
import { formSprite } from './data/species';
import { xpToNext, formName } from './data/forms';
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
  private readonly http = inject(HttpClient);

  protected readonly tab = signal<Tab>('board');
  protected readonly assetsReady = signal(false);
  protected readonly map = signal<BoardMap | null>(null);
  protected readonly formName = formName;

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
    // Troll Hide is the only gear that raises max HP.
    return you.maxHp + (you.gear?.['carapace'] === 'troll_hide' ? 6 : 0);
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
    const spr = formSprite(you.form);
    return getRecoloredWithHatDataUrl(spr.sprite, you.paint ?? {}, spr.regions, you.hat);
  });

  /** True while a battle is in progress — the server tracks this independently
   * of which tab is mounted, via UndercityStateService.pendingBattle(). */
  protected readonly inBattle = computed(() => !!this.store.pendingBattle());

  async ngOnInit(): Promise<void> {
    // Lock the document to the visible viewport for this full-screen sub-game.
    // The global `body.undercity-page` rules kill the default min-height:100lvh
    // that otherwise leaves scrollable dead space below the app on mobile.
    document.body.classList.add('undercity-page');
    void preloadAll().then(() => this.assetsReady.set(true));
    void firstValueFrom(this.http.get<BoardMap>('data/undercity-map.json')).then((m) =>
      this.map.set(m),
    );
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
}
