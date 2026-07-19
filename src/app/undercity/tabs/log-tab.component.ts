import { Component, computed, inject, signal } from '@angular/core';
import { CommonModule } from '@angular/common';
import { MatIconModule } from '@angular/material/icon';
import { UndercityStateService } from '../services/undercity-state.service';
import { HostPanelComponent } from '../host/host-panel.component';
import { formSprite } from '../data/species';
import { getRecoloredWithHatDataUrl, preloadAll } from '../engine/sprite-engine';

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

@Component({
  selector: 'app-undercity-log-tab',
  standalone: true,
  imports: [CommonModule, MatIconModule, HostPanelComponent],
  templateUrl: './log-tab.component.html',
  styleUrls: ['./log-tab.component.scss'],
})
export class LogTabComponent {
  protected readonly store = inject(UndercityStateService);

  /** Flips true once sprite/hat art is resident, so the leaderboard recolors
   * recompute (getRecoloredWithHatDataUrl returns null until art loads). */
  private readonly assetsReady = signal(false);

  constructor() {
    void preloadAll().then(() => this.assetsReady.set(true));
  }

  eventIcon(type: string): string {
    return EVENT_ICONS[type] ?? 'spa';
  }

  /** Players ranked by renown, each carrying its recolored + hatted portrait. */
  protected readonly leaderboard = computed(() => {
    this.assetsReady(); // re-run once art loads
    return [...this.store.players()]
      .sort((a, b) => b.renown - a.renown)
      .map((p) => {
        const spr = formSprite(p.form);
        return {
          ...p,
          spriteUrl: getRecoloredWithHatDataUrl(spr.sprite, p.paint ?? {}, spr.regions, p.hat),
        };
      });
  });

  timeAgo(ts: string): string {
    const secs = Math.max(0, (Date.now() - new Date(ts + 'Z').getTime()) / 1000);
    if (secs < 60) return 'now';
    if (secs < 3600) return `${Math.floor(secs / 60)}m`;
    return `${Math.floor(secs / 3600)}h`;
  }
}
