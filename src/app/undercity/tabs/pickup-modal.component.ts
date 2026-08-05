import { Component, computed, inject, signal } from '@angular/core';
import { CommonModule } from '@angular/common';
import { MatIconModule } from '@angular/material/icon';
import { UndercityStateService } from '../services/undercity-state.service';
import { PendingPickup } from '../services/undercity-models';
import {
  GEAR_MAP,
  CONSUMABLE_MAP,
  MarketKind,
  marketBand,
  SALVAGE_YIELD,
  tierRarity,
  Rarity,
} from '../data/items';
import { SPELL_MAP } from '../data/spells';

// Flat salvage refund for a non-gear item, mirroring the constants used in
// undercity_db._salvage_owned_for_pickup (consumable = 5, scroll =
// SCROLL_OVERFLOW_SPORES = 12).
const CONSUMABLE_SALVAGE_SPORES = 5;
const SCROLL_SALVAGE_SPORES = 12;

interface OwnedRow {
  index: number;
  itemId: string;
  name: string;
}

/** Which item's inline Sell price-editor is open: the incoming item ('new'),
 * an owned row (its index), or none (null). */
type SellTarget = 'new' | number | null;

/** Board-scoped dialogue that drains the player's pendingPickups queue one item
 * at a time. Every item gained through the server's _acquire pipeline that
 * overflows a full inventory lands here. A single panel shows the incoming item on
 * top and the player's existing same-kind inventory below; the player either sells
 * the incoming item, or frees a slot by salvaging/selling an owned piece (the
 * incoming item then drops in). It is NOT a hard modal — it dims only the board and
 * leaves navigation free, so the player can pop over to the Plaza to sort things
 * out instead; only rolling is locked (board-tab's rollBlocked) until the queue
 * clears. Rendered inside the board tab, so it self-hides on other tabs and when
 * the queue is empty. */
@Component({
  selector: 'app-pickup-modal',
  standalone: true,
  imports: [CommonModule, MatIconModule],
  template: `
    @if (head(); as p) {
      <!-- Non-blocking board dialogue: dims only the board, leaves the tab bar
           free (visit the Plaza to make room), and locks rolling until resolved.
           Always resolvable in place too — salvaging the incoming item clears it. -->
      <div class="pu-backdrop" role="dialog" aria-live="assertive">
        <div class="pu-card">
          <header class="pu-head">
            <div class="pu-head-titles">
              <span class="pu-eyebrow">{{ fullLine(p) }}</span>
              @if (queueCount() > 1) {
                <span class="pu-count">+{{ queueCount() - 1 }} more waiting</span>
              }
            </div>
          </header>

          <!-- Incoming item — the highlighted "prize" -->
          <div class="pu-newcomer">
            <div class="pu-row-main">
              <span class="pu-icon pu-icon-new">
                @if (p.kind === 'gear') {
                  <mat-icon [svgIcon]="slotIcon(p.itemId)"></mat-icon>
                } @else {
                  <mat-icon>{{ ligIcon(p.kind, p.itemId) }}</mat-icon>
                }
              </span>
              <span class="pu-name pu-name-lg">{{ itemName(p.kind, p.itemId) }}</span>
              <span class="pu-badge">NEW</span>
            </div>
            <p class="pu-hint">{{ sourceLine(p) }} — clear a slot below to keep it, or:</p>
            @if (sellTarget() === 'new') {
              <ng-container
                *ngTemplateOutlet="priceEditor; context: { $implicit: p.kind, id: p.itemId }"
              ></ng-container>
            } @else {
              <div class="pu-new-actions">
                <button class="uc-btn uc-btn-sm" [disabled]="busy()" (click)="salvageNew()">
                  Salvage ·
                  <ng-container
                    *ngTemplateOutlet="salvageAmt; context: { $implicit: p.kind, id: p.itemId }"
                  ></ng-container>
                </button>
                <button class="uc-btn uc-btn-ghost" [disabled]="busy()" (click)="openSell('new')">
                  <mat-icon class="mi">sell</mat-icon> Sell
                </button>
              </div>
            }
          </div>

          <div class="pu-divider">
            <span>Your {{ whereLabel(p.kind) }} — clear a slot to keep it</span>
          </div>

          <!-- Existing same-kind inventory -->
          <ul class="pu-owned">
            @for (row of owned(p); track row.index) {
              <li [attr.data-rarity]="rarityFor(p.kind, row.itemId)">
                <span class="pu-icon">
                  @if (p.kind === 'gear') {
                    <mat-icon [svgIcon]="slotIcon(row.itemId)"></mat-icon>
                  } @else {
                    <mat-icon>{{ ligIcon(p.kind, row.itemId) }}</mat-icon>
                  }
                </span>
                <div class="pu-owned-body">
                  <span class="pu-name">{{ row.name }}</span>
                  @if (sellTarget() === row.index) {
                    <ng-container
                      *ngTemplateOutlet="priceEditor; context: { $implicit: p.kind, id: row.itemId }"
                    ></ng-container>
                  } @else {
                    <div class="pu-row-actions">
                      <button
                        class="uc-btn uc-btn-sm"
                        [disabled]="busy()"
                        (click)="salvageOwned(row)"
                      >
                        Salvage ·
                        <ng-container
                          *ngTemplateOutlet="salvageAmt; context: { $implicit: p.kind, id: row.itemId }"
                        ></ng-container>
                      </button>
                      <button
                        class="uc-btn uc-btn-sm"
                        [disabled]="busy()"
                        (click)="openSell(row.index)"
                      >
                        Sell ▸
                      </button>
                    </div>
                  }
                </div>
              </li>
            }
          </ul>

          @if (error()) {
            <p class="pu-error">{{ error() }}</p>
          }
        </div>
      </div>

      <!-- Salvage yield, reused by the newcomer and every owned row: gear grinds
           into materials (text); consumables/scrolls refund Spores (icon). -->
      <ng-template #salvageAmt let-kind let-id="id">
        @if (kind === 'gear') {
          {{ salvageMaterials(id) }}
        } @else {
          {{ salvageSpores(kind)
          }}<img class="pu-spore" src="undercity/icons/rot.png" alt="Spores" />
        }
      </ng-template>

      <!-- Inline price editor, reused by the newcomer and every owned row. -->
      <ng-template #priceEditor let-kind let-id="id">
        <div class="pu-sell">
          <label>Sell price (Spores)</label>
          <div class="pu-sell-controls">
            <input
              type="number"
              [min]="bandFor(kind, id).lo"
              [max]="bandFor(kind, id).hi"
              [value]="price()"
              (input)="setPrice($event)"
            />
            <button class="uc-btn uc-btn-sm uc-btn-primary" [disabled]="busy()" (click)="confirmSell()">
              List
            </button>
            <button class="uc-btn uc-btn-sm uc-btn-ghost" [disabled]="busy()" (click)="cancelSell()">
              Cancel
            </button>
          </div>
          <small>{{ bandFor(kind, id).lo }}–{{ bandFor(kind, id).hi }} Spores</small>
        </div>
      </ng-template>
    }
  `,
  styleUrls: ['./pickup-modal.component.scss'],
})
export class PickupModalComponent {
  private readonly store = inject(UndercityStateService);

  protected readonly busy = signal(false);
  protected readonly error = signal('');
  protected readonly price = signal(0);
  protected readonly sellTarget = signal<SellTarget>(null);

  protected readonly head = computed<PendingPickup | null>(() => {
    // Queue behind any landing/battle/reward card: the "bag is full" modal opens
    // only once that dialog is dismissed, so it never paints over the loot,
    // battle, or cache reveal that produced the overflow in the first place.
    if (this.store.landingDialogHold()) return null;
    return this.store.you()?.pendingPickups?.[0] ?? null;
  });
  protected readonly queueCount = computed(() => this.store.you()?.pendingPickups?.length ?? 0);

  protected itemName(kind: MarketKind, itemId: string): string {
    if (kind === 'gear') return GEAR_MAP[itemId]?.name ?? itemId;
    if (kind === 'consumable') return CONSUMABLE_MAP[itemId]?.name ?? itemId;
    return SPELL_MAP[itemId]?.name ?? itemId;
  }

  /** Registered `uc-<slot>` SVG icon for a gear piece's chip (fang/carapace/
   * charm), matching the gear stash and board loot rows. */
  protected slotIcon(itemId: string): string {
    return `uc-${GEAR_MAP[itemId]?.slot ?? 'charm'}`;
  }

  /** Material ligature icon for a consumable or scroll chip (both data maps
   * carry an `icon` field). Gear uses {@link slotIcon} instead. */
  protected ligIcon(kind: MarketKind, itemId: string): string {
    if (kind === 'consumable') return CONSUMABLE_MAP[itemId]?.icon ?? 'category';
    return SPELL_MAP[itemId]?.icon ?? 'auto_stories';
  }

  /** Rarity key that tints an item's icon chip. Gear derives it from tier
   * (mirrors the gear stash); consumables/scrolls have no tier, so they use a
   * neutral chip. */
  protected rarityFor(kind: MarketKind, itemId: string): Rarity | 'neutral' {
    if (kind !== 'gear') return 'neutral';
    return tierRarity(GEAR_MAP[itemId]?.tier ?? 1).key;
  }

  /** Flat Spore refund from salvaging a consumable/scroll (mirrors the server
   * salvage rates). Gear yields materials instead — see {@link salvageMaterials}. */
  protected salvageSpores(kind: MarketKind): number {
    return kind === 'consumable' ? CONSUMABLE_SALVAGE_SPORES : SCROLL_SALVAGE_SPORES;
  }

  /** Human-readable material yield from grinding a gear piece (mirrors the
   * server's SALVAGE_YIELD table). */
  protected salvageMaterials(itemId: string): string {
    const tier = GEAR_MAP[itemId]?.tier ?? 1;
    const y = SALVAGE_YIELD[tier] ?? { moltings: 1, ichor: 0 };
    const parts = [`${y.moltings} Molting${y.moltings === 1 ? '' : 's'}`];
    if (y.ichor) parts.push(`${y.ichor} Gemstone${y.ichor === 1 ? '' : 's'}`);
    return parts.join(' + ');
  }

  protected bandFor(kind: MarketKind, itemId: string): { lo: number; hi: number } {
    return marketBand(kind, itemId);
  }

  protected sourceLine(p: PendingPickup): string {
    const bySource: Record<string, string> = {
      battle: 'Battle spoils',
      boss: "The Queen's hoard",
      loot: 'A fresh find',
      dig: 'Unearthed',
      scavenge: 'Scavenged',
      reward: 'A game-day reward',
    };
    return bySource[p.source] ?? 'A fresh find';
  }

  protected whereLabel(kind: MarketKind): string {
    return kind === 'gear' ? 'gear stash' : kind === 'consumable' ? 'bag' : 'scroll satchel';
  }

  protected fullLine(p: PendingPickup): string {
    return `Your ${this.whereLabel(p.kind)} is full!`;
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

  /** Open the inline price editor for a target, seeding a valid default price. */
  protected openSell(target: 'new' | number): void {
    const p = this.head();
    if (!p) return;
    const itemId = target === 'new' ? p.itemId : this.owned(p)[target]?.itemId;
    if (!itemId) return;
    this.price.set(marketBand(p.kind, itemId).lo);
    this.error.set('');
    this.sellTarget.set(target);
  }

  protected cancelSell(): void {
    this.sellTarget.set(null);
  }

  private async resolve(payload: Record<string, unknown>): Promise<void> {
    this.busy.set(true);
    this.error.set('');
    try {
      await this.store.action('pickup-resolve', payload);
      this.sellTarget.set(null); // re-render for the next queued item, if any
    } catch (e) {
      this.error.set(e instanceof Error ? e.message : 'Could not resolve — try again.');
    } finally {
      this.busy.set(false);
    }
  }

  protected confirmSell(): void {
    const target = this.sellTarget();
    if (target === 'new') {
      void this.resolve({ choice: 'list-new', price: this.price() });
    } else if (typeof target === 'number') {
      void this.resolve({ choice: 'list-owned', index: target, price: this.price() });
    }
  }

  protected salvageOwned(row: OwnedRow): void {
    void this.resolve({ choice: 'salvage-owned', index: row.index });
  }

  /** Salvage the incoming item outright — it never enters the bag; the player
   * takes its materials/Spores instead of listing it or clearing a slot. */
  protected salvageNew(): void {
    void this.resolve({ choice: 'salvage-new' });
  }
}
