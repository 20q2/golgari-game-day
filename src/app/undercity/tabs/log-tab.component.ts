import { Component, computed, inject, signal } from '@angular/core';
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

  protected readonly busy = signal(false);
  protected readonly toast = signal<string | null>(null);
  protected readonly wonToggle = signal(false);

  eventIcon(type: string): string {
    return EVENT_ICONS[type] ?? 'spa';
  }

  protected readonly leaderboard = computed(() =>
    [...this.store.players()].sort((a, b) => b.renown - a.renown),
  );

  protected readonly finishedCooldownLeft = computed(() => {
    const last = this.store.you()?.lastFinishedClaim;
    if (!last) return 0;
    const elapsedMin = (Date.now() - new Date(last + 'Z').getTime()) / 60000;
    return Math.max(0, Math.ceil(15 - elapsedMin));
  });

  protected readonly taughtLeft = computed(() => 2 - (this.store.you()?.taughtClaims ?? 0));

  async claimFinished(): Promise<void> {
    await this.run(async () => {
      const kind = this.wonToggle() ? 'finished_won' : 'finished';
      const resp = await this.store.action('claim', { kind });
      const lost = resp.lostToCap ? ` (${resp.lostToCap} lost to the 6-roll cap!)` : '';
      this.showToast(`+${resp.granted} rolls${lost}`);
      this.wonToggle.set(false);
    });
  }

  async claimTaught(): Promise<void> {
    await this.run(async () => {
      const resp = await this.store.action('claim', { kind: 'taught' });
      this.showToast(`+${resp.granted} roll, +5 XP. Spreading the hobby!`);
    });
  }

  timeAgo(ts: string): string {
    const secs = Math.max(0, (Date.now() - new Date(ts + 'Z').getTime()) / 1000);
    if (secs < 60) return 'now';
    if (secs < 3600) return `${Math.floor(secs / 60)}m`;
    return `${Math.floor(secs / 3600)}h`;
  }

  private async run(fn: () => Promise<void>): Promise<void> {
    if (this.busy()) return;
    this.busy.set(true);
    try {
      await fn();
    } catch (e) {
      this.showToast(e instanceof Error ? e.message : 'Something went wrong');
    } finally {
      this.busy.set(false);
    }
  }

  private showToast(text: string): void {
    this.toast.set(text);
    setTimeout(() => {
      if (this.toast() === text) this.toast.set(null);
    }, 3500);
  }
}
