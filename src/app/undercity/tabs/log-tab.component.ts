import { Component, computed, inject, signal } from '@angular/core';
import { CommonModule } from '@angular/common';
import { MatIconModule } from '@angular/material/icon';
import { UndercityStateService } from '../services/undercity-state.service';
import { HostPanelComponent } from '../host/host-panel.component';
import { PokeWheelComponent } from './poke-wheel.component';
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
  chat: 'chat_bubble',
};

@Component({
  selector: 'app-undercity-log-tab',
  standalone: true,
  imports: [CommonModule, MatIconModule, HostPanelComponent, PokeWheelComponent],
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

  protected readonly busy = signal(false);
  protected readonly toast = signal<string | null>(null);

  /** "How is renown earned?" explainer — a pop-up dialog off the leaderboard. */
  protected readonly renownInfoOpen = signal(false);

  /** Display mirror of the server renown weights (undercity_data.RENOWN /
   * RENOWN_WIN). Descriptive-with-numbers for curious players; keep in sync if
   * the server weights are retuned. */
  protected readonly renownFights = [
    { icon: 'bug_report', label: 'Beat a normal enemy', value: '2–4', note: 'tougher zones pay more' },
    { icon: 'local_fire_department', label: 'Beat an elite', value: '3–6', note: '' },
    { icon: 'fort', label: 'Slay a lair boss', value: '8', note: '' },
    { icon: 'shield', label: 'Beat a lair guardian (barrier)', value: '—', note: 'renown comes from the first-clear below' },
    { icon: 'sports_kabaddi', label: 'Win a duel — vs an equal or stronger foe', value: '15', note: '' },
    { icon: 'whatshot', label: 'Chip the Queen (Savra)', value: '1 / 10 dmg', note: '' },
  ];

  /** First-time landmark clears — the per-player +25 (poiClaims). */
  protected readonly renownFirstClears = [
    { icon: 'shield', label: 'Break a lair guardian (barrier)', value: '25', note: '' },
    { icon: 'fort', label: 'Slay a lair boss — first time', value: '25', note: 'stacks with the +8 fight' },
    { icon: 'inventory_2', label: 'Crack a vault, trove, or cache', value: '25', note: '' },
  ];

  protected readonly renownFirstNote =
    'Once per landmark, per player — later visitors still earn the full 25.';

  protected readonly renownFootnote =
    'Your leaderboard score is this total. Cosmetic renown for the pre-hatch shop is a ' +
    'separate wallet — your night’s score plus roaming-beast and world-event kills.';

  eventIcon(type: string): string {
    return EVENT_ICONS[type] ?? 'spa';
  }

  /** Poke a player straight from the leaderboard — same gift-a-roll action as
   *  the plaza, no need to find their creature on the canvas first. */
  async poke(userId: string, username: string): Promise<void> {
    if (this.busy() || userId === this.store.ownUserId) return;
    this.busy.set(true);
    try {
      const resp = await this.store.action('poke', { targetUserId: userId });
      this.showToast(
        resp.granted ? `You poked ${username} — they gained a roll!` : `You poked ${username}.`,
      );
    } catch (e) {
      this.showToast(e instanceof Error ? e.message : 'Poke failed');
    } finally {
      this.busy.set(false);
    }
  }

  private showToast(text: string): void {
    this.toast.set(text);
    setTimeout(() => {
      if (this.toast() === text) this.toast.set(null);
    }, 3000);
  }

  /** Players ranked by renown, each carrying its recolored + hatted portrait. */
  protected readonly leaderboard = computed(() => {
    this.assetsReady(); // re-run once art loads
    return [...this.store.players()]
      .sort((a, b) => b.renown - a.renown)
      .map((p) => {
        const spr = formSprite(p.form, p.spriteVariant);
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
