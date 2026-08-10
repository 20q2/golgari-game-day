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
  protected readonly confirmDiscard = signal(false);
  protected readonly confirmAwaken = signal(false);
  protected readonly confirmBackdate = signal(false);
  protected hostKey = localStorage.getItem(HOST_KEY_STORAGE) ?? '';

  protected readonly seasonActive = computed(() => this.store.season()?.status === 'active');
  protected readonly bossAwake = computed(() => this.store.season()?.bossPhase === true);
  protected readonly inLobby = computed(() => this.store.season()?.status === 'lobby');
  /** This night ran with Dev Night, so the server discards it however it ends —
   *  the panel drops the banking button rather than offering a lie. */
  protected readonly mustDiscard = computed(() => this.store.season()?.devEverOn === true);
  /** Bound to the <input type="datetime-local"> — a local wall-clock string. */
  protected launchLocal = '';
  /** Backdated New Night start — prefilled to two hours ago for bug recovery. */
  protected backdateLocal = HostPanelComponent.toLocalInput(new Date(Date.now() - 2 * 3600_000));

  /** Format a Date as the `YYYY-MM-DDTHH:mm` local-wall-clock string a
   * <input type="datetime-local"> expects (no timezone suffix). */
  private static toLocalInput(d: Date): string {
    const pad = (n: number) => String(n).padStart(2, '0');
    return (
      `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}` +
      `T${pad(d.getHours())}:${pad(d.getMinutes())}`
    );
  }

  async startNight(): Promise<void> {
    await this.run(async () => {
      localStorage.setItem(HOST_KEY_STORAGE, this.hostKey);
      await this.store.action('season-start', { hostKey: this.hostKey });
      this.message.set('A new night begins. Send everyone the link!');
    });
  }

  /** Open (or re-time) the pre-game lobby with a countdown to a target clock time. */
  async openLobby(): Promise<void> {
    if (!this.launchLocal) {
      this.message.set('Pick a start time first.');
      return;
    }
    // datetime-local has no timezone; interpret it as local, send UTC ISO.
    const launchAt = new Date(this.launchLocal).toISOString();
    await this.run(async () => {
      localStorage.setItem(HOST_KEY_STORAGE, this.hostKey);
      await this.store.action('season-lobby', { hostKey: this.hostKey, launchAt });
      this.message.set('Lobby open — players see the countdown. Press New Night to begin.');
    });
  }

  /**
   * Bug-recovery restart: archive the running night and open a fresh one stamped
   * with a chosen *past* start time, so every new character seeds its roll bank
   * as if the night had begun then. Two-tap confirm — it archives the live night.
   */
  async startBackdatedNight(): Promise<void> {
    if (!this.backdateLocal) {
      this.message.set('Pick a start time first.');
      return;
    }
    if (!this.confirmBackdate()) {
      this.confirmBackdate.set(true);
      return;
    }
    // datetime-local has no timezone; interpret it as local, send UTC ISO.
    const startedAt = new Date(this.backdateLocal).toISOString();
    await this.run(async () => {
      localStorage.setItem(HOST_KEY_STORAGE, this.hostKey);
      await this.store.action('season-start', { hostKey: this.hostKey, startedAt });
      this.message.set('Fresh night started — new characters spawn with their accrued rolls.');
      this.confirmBackdate.set(false);
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
      this.message.set(
        this.mustDiscard()
          ? 'The night has ended. Results discarded — this night had Dev Night on.'
          : 'The night has ended. Ceremony time.',
      );
      this.confirmEnd.set(false);
    });
  }

  /**
   * End the night and throw the results away: no Renown banked, no Hall of Fame
   * entry, no lifetime counters, and every Renown the night paid out mid-run is
   * handed back. Standings still show so the ceremony is reviewable. Two-tap like
   * endNight — it's irreversible either way.
   */
  async discardNight(): Promise<void> {
    if (!this.confirmDiscard()) {
      this.confirmDiscard.set(true);
      return;
    }
    await this.run(async () => {
      localStorage.setItem(HOST_KEY_STORAGE, this.hostKey);
      await this.store.action('season-end', { hostKey: this.hostKey, discard: true });
      this.message.set('Night discarded — nothing was saved.');
      this.confirmDiscard.set(false);
    });
  }

  /** Admin cheat: top up your own banked rolls by 3. */
  async grantRolls(): Promise<void> {
    const me = this.store.ownUserId;
    if (!me) {
      this.message.set('No player to grant rolls to — join the night first.');
      return;
    }
    await this.run(async () => {
      localStorage.setItem(HOST_KEY_STORAGE, this.hostKey);
      await this.store.action('admin', {
        hostKey: this.hostKey,
        cmd: 'grant',
        target: me,
        rolls: 3,
      });
      this.message.set('+3 rolls banked.');
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
