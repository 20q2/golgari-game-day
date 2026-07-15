import { Component, OnDestroy, OnInit, inject, signal } from '@angular/core';
import { CommonModule } from '@angular/common';
import { FormsModule } from '@angular/forms';
import { HttpClient } from '@angular/common/http';
import { firstValueFrom } from 'rxjs';
import { MatIconModule } from '@angular/material/icon';
import { UndercityStateService } from '../services/undercity-state.service';
import { UndercityApiService, UndercityApiError } from '../services/undercity-api.service';
import { HostPanelComponent } from '../host/host-panel.component';

const HOST_KEY_STORAGE = 'undercity-host-key';

interface MapNode {
  id: string;
  region?: string;
  type?: string;
}

/**
 * Host admin surface (dev/host only, reached by URL): create puppet bots and
 * manage the live roster — grant/heal/teleport/kick — plus broadcast messages.
 * Gated by the same host passphrase as the host panel; every request carries it
 * and the server 403s on mismatch. Talks to the API directly (not
 * store.action) so admin edits to other players never clobber the host's own
 * `you` doc; a refresh reconciles the roster after each command.
 */
@Component({
  selector: 'app-undercity-admin-panel',
  standalone: true,
  imports: [CommonModule, FormsModule, MatIconModule, HostPanelComponent],
  templateUrl: './admin-panel.component.html',
  styleUrls: ['./admin-panel.component.scss'],
})
export class AdminPanelComponent implements OnInit, OnDestroy {
  protected readonly store = inject(UndercityStateService);
  private readonly api = inject(UndercityApiService);
  private readonly http = inject(HttpClient);

  protected hostKey = localStorage.getItem(HOST_KEY_STORAGE) ?? '';
  protected readonly busy = signal(false);
  protected readonly message = signal<string | null>(null);
  protected readonly nodes = signal<MapNode[]>([]);

  // Add-bot form state.
  protected readonly speciesList = ['random', 'pest', 'kraul', 'saproling', 'zombie'];
  protected readonly biomeList = ['random', 'city', 'cavern', 'bog', 'garden', 'bone'];
  protected botName = '';
  protected botSpecies = 'random';
  protected botHome = 'random';

  // Grant form state.
  protected grantResource: 'rolls' | 'xp' | 'spores' = 'rolls';
  protected grantAmount = 3;

  // Broadcast state.
  protected broadcastText = '';

  async ngOnInit(): Promise<void> {
    this.store.startPolling();
    void this.store.refresh();
    try {
      const doc = await firstValueFrom(
        this.http.get<{ nodes: MapNode[] }>('data/undercity-map.json'),
      );
      this.nodes.set(doc.nodes ?? []);
    } catch {
      this.nodes.set([]);
    }
  }

  ngOnDestroy(): void {
    this.store.stopPolling();
  }

  protected rememberKey(): void {
    localStorage.setItem(HOST_KEY_STORAGE, this.hostKey);
  }

  /** Fire one admin command, then refresh the roster. */
  private async admin(cmd: string, extra: Record<string, unknown>): Promise<void> {
    if (this.busy() || !this.hostKey.trim()) return;
    this.busy.set(true);
    this.message.set(null);
    try {
      this.rememberKey();
      await this.api.action('admin', { hostKey: this.hostKey, cmd, ...extra });
      await this.store.refresh();
    } catch (e) {
      this.message.set(
        e instanceof UndercityApiError ? e.message : 'Admin action failed',
      );
    } finally {
      this.busy.set(false);
    }
  }

  protected addBot(): void {
    void this.admin('bot-add', {
      name: this.botName.trim(),
      species: this.botSpecies,
      home: this.botHome,
    }).then(() => {
      this.botName = '';
    });
  }

  protected grant(userId: string): void {
    void this.admin('grant', { target: userId, [this.grantResource]: this.grantAmount });
  }

  protected heal(userId: string): void {
    void this.admin('heal', { target: userId });
  }

  protected teleport(userId: string, node: string): void {
    if (!node) return;
    void this.admin('teleport', { target: userId, node });
  }

  protected kick(userId: string): void {
    void this.admin('kick', { target: userId });
  }

  /** Take one bot's turn: a short random wander off its current node. */
  protected botStep(userId: string): void {
    void this.admin('bot-step', { target: userId });
  }

  /** Walk every bot a step — handy for clearing the starting gates at once. */
  protected async stepAllBots(): Promise<void> {
    for (const p of this.store.players()) {
      if (p.isBot) await this.admin('bot-step', { target: p.userId });
    }
  }

  protected broadcast(): void {
    const text = this.broadcastText.trim();
    if (!text) return;
    void this.admin('broadcast', { text }).then(() => {
      this.broadcastText = '';
    });
  }
}
