import { Component, OnDestroy, OnInit, computed, inject, signal } from '@angular/core';
import { CommonModule } from '@angular/common';
import { FormsModule } from '@angular/forms';
import { HttpClient } from '@angular/common/http';
import { firstValueFrom } from 'rxjs';
import { MatIconModule } from '@angular/material/icon';
import { UndercityStateService } from '../services/undercity-state.service';
import { UndercityApiService, UndercityApiError } from '../services/undercity-api.service';
import { HostPanelComponent } from '../host/host-panel.component';
import { PET_SPECIES_LIST } from '../data/pets';

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
  /** Two-tap guard for the destructive full reset. */
  protected readonly confirmReset = signal(false);
  /** Server-reported Dev Night state for the running night. */
  protected readonly devMode = computed(() => this.store.season()?.devMode === true);

  /** User ids granted Admin this session (local — the public roster omits the
   *  flag, so we track what we've toggled to label the button). */
  protected readonly adminIds = signal<Set<string>>(new Set());

  // Add-bot form state.
  protected readonly speciesList = ['random', 'pest', 'kraul', 'saproling', 'zombie'];
  protected readonly biomeList = ['random', 'city', 'cavern', 'bog', 'garden', 'bone'];
  protected botName = '';
  protected botSpecies = 'random';
  protected botHome = 'random';

  // Grant form state.
  protected grantResource: 'rolls' | 'xp' | 'spores' = 'rolls';
  protected grantAmount = 3;

  // Give-pet form state. Species options are labeled by role so you can force an
  // attack/defend pet to test the combat companion; 'random' picks from the roster.
  protected readonly petTiers = [1, 2, 3, 4];
  protected readonly petSpeciesOptions = PET_SPECIES_LIST.slice()
    .sort((a, b) => a.role.localeCompare(b.role) || a.name.localeCompare(b.name))
    .map((p) => ({ id: p.species, label: `${p.name} — ${p.role}` }));
  protected givePetSpecies = 'random';
  protected givePetTier = 1;
  protected givePetLevel = 1;

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

  /** Drop a companion into a player's roster (species/tier/level from the form).
   *  Never auto-activates — it joins their pets like a freshly hatched egg. */
  protected givePet(userId: string): void {
    void this.admin('give-pet', {
      target: userId,
      species: this.givePetSpecies,
      tier: this.givePetTier,
      level: this.givePetLevel,
    });
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

  protected isAdminUser(userId: string): boolean {
    return this.adminIds().has(userId);
  }

  protected toggleAdmin(userId: string): void {
    const on = !this.isAdminUser(userId);
    void this.admin('grant-admin', { target: userId, on }).then(() => {
      if (this.message()) return; // command failed — leave local state untouched
      const next = new Set(this.adminIds());
      if (on) next.add(userId);
      else next.delete(userId);
      this.adminIds.set(next);
    });
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

  /**
   * Destructive full reset (all players): first tap arms it, second tap fires.
   * Deletes every creature this night, clears first-clears, and resets every
   * player's Renown + profile to a blank slate. The server verifies the
   * passphrase and the admin() helper reports any failure.
   */
  protected resetAll(): void {
    if (!this.confirmReset()) {
      this.confirmReset.set(true);
      return;
    }
    this.confirmReset.set(false);
    void this.admin('reset-all', {}).then(() => {
      if (!this.message()) this.message.set('Reset done — a fresh night has begun.');
    });
  }

  /**
   * Dev Night: unlimited rolls for every player on the running night. Reversible
   * and destroys nothing, so — unlike resetAll — there's no two-tap arming. The
   * label follows server state, which admin() refreshes on success.
   */
  protected toggleDevNight(): void {
    void this.admin('dev-night', { on: !this.devMode() });
  }

  /**
   * Download the full session dataset as JSON — every player's end-state + per-
   * player metric counters, plus the complete event log — for offline balance
   * analysis. Read-only; talks to the API directly to keep the raw payload.
   */
  protected async exportData(): Promise<void> {
    if (this.busy() || !this.hostKey.trim()) return;
    this.busy.set(true);
    this.message.set(null);
    try {
      this.rememberKey();
      const data = (await this.api.action('admin', {
        hostKey: this.hostKey,
        cmd: 'export',
      })) as unknown as { season?: string; players?: unknown[]; events?: unknown[] };
      const blob = new Blob([JSON.stringify(data, null, 2)], { type: 'application/json' });
      const url = URL.createObjectURL(blob);
      const a = document.createElement('a');
      a.href = url;
      a.download = `undercity-session-${data.season ?? 'export'}.json`;
      a.click();
      URL.revokeObjectURL(url);
      this.message.set(
        `Exported ${data.players?.length ?? 0} players, ${data.events?.length ?? 0} events.`,
      );
    } catch (e) {
      this.message.set(e instanceof UndercityApiError ? e.message : 'Export failed');
    } finally {
      this.busy.set(false);
    }
  }
}
