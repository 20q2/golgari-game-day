import { Component, computed, inject } from '@angular/core';
import { CommonModule } from '@angular/common';
import { MatIconModule } from '@angular/material/icon';
import { UndercityStateService } from '../services/undercity-state.service';
import { HostPanelComponent } from '../host/host-panel.component';

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

  eventIcon(type: string): string {
    return EVENT_ICONS[type] ?? 'spa';
  }

  protected readonly leaderboard = computed(() =>
    [...this.store.players()].sort((a, b) => b.renown - a.renown),
  );

  timeAgo(ts: string): string {
    const secs = Math.max(0, (Date.now() - new Date(ts + 'Z').getTime()) / 1000);
    if (secs < 60) return 'now';
    if (secs < 3600) return `${Math.floor(secs / 60)}m`;
    return `${Math.floor(secs / 3600)}h`;
  }
}
