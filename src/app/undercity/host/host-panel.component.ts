import { Component, computed, inject, signal } from '@angular/core';
import { CommonModule } from '@angular/common';
import { FormsModule } from '@angular/forms';
import { MatIconModule } from '@angular/material/icon';
import { UndercityStateService } from '../services/undercity-state.service';

const HOST_KEY_STORAGE = 'undercity-host-key';

/**
 * Host controls: New Night / End Night / Awaken the Queen, gated by a
 * passphrase remembered in localStorage (same trust level as the rest of the
 * site — no real auth).
 */
@Component({
  selector: 'app-undercity-host-panel',
  standalone: true,
  imports: [CommonModule, FormsModule, MatIconModule],
  templateUrl: './host-panel.component.html',
  styleUrls: ['./host-panel.component.scss'],
})
export class HostPanelComponent {
  protected readonly store = inject(UndercityStateService);

  protected readonly open = signal(false);
  protected readonly busy = signal(false);
  protected readonly message = signal<string | null>(null);
  protected readonly confirmEnd = signal(false);
  protected readonly confirmAwaken = signal(false);
  protected hostKey = localStorage.getItem(HOST_KEY_STORAGE) ?? '';

  protected readonly seasonActive = computed(() => this.store.season()?.status === 'active');
  protected readonly bossAwake = computed(() => this.store.season()?.bossPhase === true);

  async startNight(): Promise<void> {
    await this.run(async () => {
      localStorage.setItem(HOST_KEY_STORAGE, this.hostKey);
      await this.store.action('season-start', { hostKey: this.hostKey });
      this.message.set('A new night begins. Send everyone the link!');
    });
  }

  async endNight(): Promise<void> {
    if (!this.confirmEnd()) {
      this.confirmEnd.set(true);
      return;
    }
    await this.run(async () => {
      localStorage.setItem(HOST_KEY_STORAGE, this.hostKey);
      await this.store.action('season-end', { hostKey: this.hostKey });
      this.message.set('The night has ended. Ceremony time.');
      this.confirmEnd.set(false);
    });
  }

  /** One-way finale: drop the sigil wards so everyone can storm the Queen. */
  async awaken(): Promise<void> {
    if (!this.confirmAwaken()) {
      this.confirmAwaken.set(true);
      return;
    }
    await this.run(async () => {
      localStorage.setItem(HOST_KEY_STORAGE, this.hostKey);
      await this.store.action('boss-awaken', { hostKey: this.hostKey });
      this.message.set('The rot-wards fall. The Queen is awake!');
      this.confirmAwaken.set(false);
    });
  }

  private async run(fn: () => Promise<void>): Promise<void> {
    if (this.busy()) return;
    this.busy.set(true);
    this.message.set(null);
    try {
      await fn();
    } catch (e) {
      this.message.set(e instanceof Error ? e.message : 'Host action failed');
    } finally {
      this.busy.set(false);
    }
  }
}
