import { Component, computed, inject, signal } from '@angular/core';
import { CommonModule } from '@angular/common';
import { MatIconModule } from '@angular/material/icon';
import { UndercityStateService } from '../services/undercity-state.service';
import { PendingPickup } from '../services/undercity-models';
import { GEAR_MAP, CONSUMABLE_MAP, MarketKind, marketBand } from '../data/items';
import { SPELL_MAP } from '../data/spells';

interface OwnedRow {
  index: number;
  itemId: string;
  name: string;
}

/** Blocking modal that drains the player's pendingPickups queue one item at a
 * time. Every item gained through the server's _acquire pipeline that overflows
 * a full inventory lands here; the player either lists the new item on the
 * market or frees a slot (salvage / list an owned same-kind piece) so the new
 * item can be kept. Self-hides when the queue is empty. */
@Component({
  selector: 'app-pickup-modal',
  standalone: true,
  imports: [CommonModule, MatIconModule],
  template: `
    @if (head(); as p) {
      <div class="pu-backdrop" role="dialog" aria-modal="true" aria-live="assertive">
        <div class="pu-card">
          <span class="pu-eyebrow">{{ sourceLine(p) }}</span>
          <h3>{{ itemName(p.kind, p.itemId) }}</h3>
          <p class="pu-sub">{{ fullLine(p) }}</p>

          @if (queueCount() > 1) {
            <span class="pu-count">{{ queueCount() - 1 }} more waiting</span>
          }

          @if (mode() === 'root') {
            <div class="pu-price">
              <label [attr.for]="'pu-price-new'">Sell price (Spores)</label>
              <input
                id="pu-price-new"
                type="number"
                [min]="band(p).lo"
                [max]="band(p).hi"
                [value]="price()"
                (input)="setPrice($event)"
              />
              <small>{{ band(p).lo }}–{{ band(p).hi }} Spores</small>
            </div>
            <button class="uc-btn uc-btn-primary" [disabled]="busy()" (click)="listNew()">
              <mat-icon class="mi">sell</mat-icon> List on Market
            </button>
            <button class="uc-btn" [disabled]="busy()" (click)="mode.set('manage')">
              <mat-icon class="mi">inventory_2</mat-icon> Manage Inventory
            </button>
          } @else {
            <p class="pu-sub">Free a slot — salvage or list one you already own:</p>
            <ul class="pu-owned">
              @for (row of owned(p); track row.index) {
                <li>
                  <span class="pu-owned-name">{{ row.name }}</span>
                  <button class="uc-btn uc-btn-sm" [disabled]="busy()" (click)="salvageOwned(row)">
                    Salvage
                  </button>
                  <button class="uc-btn uc-btn-sm" [disabled]="busy()" (click)="listOwned(row)">
                    List
                  </button>
                </li>
              }
            </ul>
            <button class="uc-btn uc-btn-ghost" [disabled]="busy()" (click)="mode.set('root')">
              Back
            </button>
          }

          @if (error()) {
            <p class="pu-error">{{ error() }}</p>
          }
        </div>
      </div>
    }
  `,
  styleUrls: ['./pickup-modal.component.scss'],
})
export class PickupModalComponent {
  private readonly store = inject(UndercityStateService);

  protected readonly mode = signal<'root' | 'manage'>('root');
  protected readonly busy = signal(false);
  protected readonly error = signal('');
  protected readonly price = signal(0);

  protected readonly head = computed<PendingPickup | null>(
    () => this.store.you()?.pendingPickups?.[0] ?? null,
  );
  protected readonly queueCount = computed(() => this.store.you()?.pendingPickups?.length ?? 0);

  protected itemName(kind: MarketKind, itemId: string): string {
    if (kind === 'gear') return GEAR_MAP[itemId]?.name ?? itemId;
    if (kind === 'consumable') return CONSUMABLE_MAP[itemId]?.name ?? itemId;
    return SPELL_MAP[itemId]?.name ?? itemId;
  }

  protected band(p: PendingPickup): { lo: number; hi: number } {
    const b = marketBand(p.kind, p.itemId);
    if (this.price() < b.lo || this.price() > b.hi) this.price.set(b.lo);
    return b;
  }

  protected sourceLine(p: PendingPickup): string {
    const bySource: Record<string, string> = {
      battle: 'Battle spoils',
      boss: 'The Queen falls',
      loot: 'You found',
      dig: 'Unearthed',
      scavenge: 'Scavenged',
      reward: 'Game-day reward',
    };
    return bySource[p.source] ?? 'You found';
  }

  protected fullLine(p: PendingPickup): string {
    const where =
      p.kind === 'gear' ? 'gear stash' : p.kind === 'consumable' ? 'bag' : 'scroll satchel';
    return `Your ${where} is full. Sell it, or make room to keep it.`;
  }

  protected owned(p: PendingPickup): OwnedRow[] {
    const you = this.store.you();
    if (!you) return [];
    const list =
      p.kind === 'gear'
        ? (you.gearStash ?? [])
        : p.kind === 'consumable'
          ? you.bag
          : (you.scrolls ?? []);
    return list.map((itemId, index) => ({
      index,
      itemId,
      name: this.itemName(p.kind, itemId),
    }));
  }

  protected setPrice(e: Event): void {
    this.price.set(Number((e.target as HTMLInputElement).value) || 0);
  }

  private async resolve(payload: Record<string, unknown>): Promise<void> {
    this.busy.set(true);
    this.error.set('');
    try {
      await this.store.action('pickup-resolve', payload);
      this.mode.set('root'); // re-render for the next queued item, if any
    } catch (e) {
      this.error.set(e instanceof Error ? e.message : 'Could not resolve — try again.');
    } finally {
      this.busy.set(false);
    }
  }

  protected listNew(): void {
    void this.resolve({ choice: 'list-new', price: this.price() });
  }

  protected salvageOwned(row: OwnedRow): void {
    void this.resolve({ choice: 'salvage-owned', index: row.index });
  }

  protected listOwned(row: OwnedRow): void {
    void this.resolve({ choice: 'list-owned', index: row.index, price: this.price() });
  }
}
