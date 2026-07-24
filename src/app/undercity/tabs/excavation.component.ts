import { Component, Input, OnChanges, Output, EventEmitter } from '@angular/core';
import { CommonModule } from '@angular/common';
import { MatIconModule } from '@angular/material/icon';
import { DigGrid, DigItemView } from '../services/undercity-models';
import { CONSUMABLE_MAP } from '../data/items';

/** One rendered dig-grid cell — precomputed from the grid so the template stays
 * declarative. */
interface CellVM {
  /** Not yet dug (still under dirt). */
  covered: boolean;
  /** A buried find's footprint includes this cell (any reveal state). */
  hasItem: boolean;
  /** The find is dug out here — render this cell's slice of the big symbol. */
  revealedFind: boolean;
  /** Material icon glyph for the find (spore cache or consumable). */
  icon: string | null;
  /** The find is a Spore cache (vs. an item). */
  spores: boolean;
  /** The find has been fully unearthed and claimed. */
  collected: boolean;
  /** Accessible label / tooltip for the find. */
  label: string;
  /** Footprint size in cells — the big symbol spans spanC×spanR cells. */
  spanC: number;
  spanR: number;
  /** This cell's position within the footprint (0-based), used to offset the
   * symbol so the cell clips to the correct slice. */
  localC: number;
  localR: number;
  /** True only on the footprint's top-left cell — anchors the single ✓. */
  anchor: boolean;
}

/**
 * The excavation dig-site modal: a grid of dirt cells you tap to dig. Buried
 * finds show through the dirt as faint icons so you can see what's down there
 * and where to spend your limited digs — scrape a find's whole footprint clean
 * to claim it. Pure presentation: the parent owns the shared grid state and the
 * `dig` action; this component renders the view and emits taps.
 */
@Component({
  selector: 'app-undercity-excavation',
  standalone: true,
  imports: [CommonModule, MatIconModule],
  template: `
    <div class="dig-overlay" (click)="closed.emit()">
      <div class="dig-card" (click)="$event.stopPropagation()" [style.background-image]="washBg">
        <h3>⛏️ Dig Site</h3>
        <p class="dig-sub">
          {{ grid.remaining }} find{{ grid.remaining === 1 ? '' : 's' }} still buried ·
          <strong>{{ digsLeft }}</strong> dig{{ digsLeft === 1 ? '' : 's' }} left this visit
        </p>

        <div class="dig-grid" [style.gridTemplateColumns]="'repeat(' + grid.w + ', 1fr)'">
          @for (row of view; track ri; let ri = $index) {
            @for (vm of row; track ci; let ci = $index) {
              <button
                type="button"
                class="cell"
                [class.covered]="vm.covered"
                [class.dug]="!vm.covered"
                [class.buried]="vm.revealedFind"
                [class.spores]="vm.spores"
                [class.collected]="vm.collected"
                [attr.title]="vm.revealedFind ? vm.label : null"
                [attr.aria-label]="vm.revealedFind ? vm.label : 'rubble'"
                [disabled]="busy || digsLeft < 1 || !vm.covered"
                (click)="onCell(ri, ci)"
              >
                @if (vm.revealedFind) {
                  <mat-icon
                    class="find"
                    [style.--span-c]="vm.spanC"
                    [style.--span-r]="vm.spanR"
                    [style.--lc]="vm.localC"
                    [style.--lr]="vm.localR"
                    >{{ vm.icon }}</mat-icon
                  >
                }
                @if (vm.collected && vm.anchor) {
                  <span class="check">✓</span>
                }
              </button>
            }
          }
        </div>

        @if (digsLeft < 1) {
          <p class="dig-hint out">Out of digs — come back next time you land here.</p>
        } @else {
          <p class="dig-hint">Dig out every cell of a find to claim it. Bigger finds cost more digs.</p>
        }
        <button class="uc-btn close-btn" (click)="closed.emit()">Leave</button>
      </div>
    </div>
  `,
  styles: [
    `
      .dig-overlay {
        position: fixed;
        inset: 0;
        z-index: 1150;
        background: rgba(8, 6, 4, 0.75);
        display: flex;
        align-items: center;
        justify-content: center;
        padding: 16px;
      }
      .dig-card {
        width: min(360px, 100%);
        background: #1a1815;
        border: 1px solid rgba(154, 123, 72, 0.55);
        border-radius: 14px;
        padding: 18px;
        display: flex;
        flex-direction: column;
        gap: 10px;
        text-align: center;
      }
      h3 {
        margin: 0;
        color: #e0c088;
      }
      .dig-sub {
        margin: 0;
        font-size: 0.85rem;
        color: #9aa79a;
      }
      .dig-sub strong {
        color: #e0c088;
      }
      .dig-grid {
        --dig-gap: 4px;
        display: grid;
        gap: var(--dig-gap);
        margin: 2px auto;
        width: 100%;
        max-width: 300px;
      }
      .cell {
        position: relative;
        aspect-ratio: 1;
        border-radius: 6px;
        border: 1px solid rgba(0, 0, 0, 0.5);
        padding: 0;
        cursor: pointer;
        display: flex;
        align-items: center;
        justify-content: center;
        overflow: hidden;
        container-type: size;
        transition: transform 0.08s ease, filter 0.12s ease;
      }
      .cell:disabled {
        cursor: default;
      }
      /* Covered = dirt on top. Diggable cells get a hover lift. */
      .cell.covered {
        background: linear-gradient(160deg, #6b5334 0%, #4a3a24 100%);
        box-shadow: inset 0 2px 2px rgba(255, 255, 255, 0.12), inset 0 -3px 4px rgba(0, 0, 0, 0.4);
      }
      .cell.covered:not(:disabled):hover {
        filter: brightness(1.2);
        transform: translateY(-1px);
      }
      /* Dug empty = an open pit. */
      .cell.dug {
        background: radial-gradient(ellipse at center, #17130d 0%, #241d13 90%);
        box-shadow: inset 0 3px 5px rgba(0, 0, 0, 0.7);
      }
      /* Dug cell that had a find = cleared soil so the icon pops. */
      .cell.dug.buried {
        background: radial-gradient(ellipse at center, #3a3120 0%, #262013 90%);
      }
      /* One symbol spans the whole footprint; each cell's overflow:hidden clips
         it to this cell's slice. Offsets shift the symbol up/left by this cell's
         position within the footprint (100% = one cell width/height + one gap). */
      /* mat-icon.find (type + class) beats Angular Material's global .mat-icon
         base rule, so our overflow/size/font-size win regardless of stylesheet
         injection order — otherwise the glyph gets clipped to a 24px box. */
      mat-icon.find {
        position: absolute;
        overflow: visible;
        width: calc(var(--span-c) * 100% + (var(--span-c) - 1) * var(--dig-gap));
        height: calc(var(--span-r) * 100% + (var(--span-r) - 1) * var(--dig-gap));
        left: calc(var(--lc) * -1 * (100% + var(--dig-gap)));
        top: calc(var(--lr) * -1 * (100% + var(--dig-gap)));
        /* Glyph fills the footprint height (cqh = cell height), +12% so corner
           slices of a diagonal shape still carry recognizable form. */
        font-size: calc(
          (var(--span-r) * 100cqh + (var(--span-r) - 1) * var(--dig-gap)) * 1.12
        );
        line-height: 1;
        display: flex;
        align-items: center;
        justify-content: center;
        color: #6fae76;
        filter: drop-shadow(0 1px 2px rgba(0, 0, 0, 0.7));
        z-index: 1;
      }
      .cell.spores .find {
        color: #e0c088;
      }
      .cell.collected {
        filter: grayscale(0.7) brightness(0.6);
      }
      .cell.collected .find {
        color: #8a978a;
      }
      .check {
        position: absolute;
        inset: 0;
        display: flex;
        align-items: center;
        justify-content: center;
        color: rgba(255, 255, 255, 0.85);
        font-weight: 900;
        font-size: 1.1rem;
        text-shadow: 0 1px 2px rgba(0, 0, 0, 0.8);
        z-index: 2;
      }
      .dig-hint {
        margin: 0;
        font-size: 0.78rem;
        color: #8a978a;
      }
      .dig-hint.out {
        color: #d08a6f;
      }
      .close-btn {
        margin-top: 4px;
      }
    `,
  ],
})
export class ExcavationModalComponent implements OnChanges {
  @Input({ required: true }) grid!: DigGrid;
  @Input() digsLeft = 0;
  @Input() busy = false;
  /** Region biome wash painted behind the card (from the board tab). */
  @Input() washBg: string | null = null;
  @Output() dig = new EventEmitter<{ r: number; c: number }>();
  @Output() closed = new EventEmitter<void>();

  private readonly COVERED = -2;

  /** Precomputed per-cell render model, rebuilt whenever the grid changes. */
  protected view: CellVM[][] = [];

  ngOnChanges(): void {
    this.view = this.buildView();
  }

  private buildView(): CellVM[][] {
    const g = this.grid;
    if (!g) return [];
    // Map each occupied cell to the find that sits there, and precompute each
    // find's footprint bounding box so one glyph can span it. All dig shapes
    // are rectangles (1x1 / 1x2 / 2x2), so the bounding box is the footprint.
    const at: (DigItemView | null)[][] = Array.from({ length: g.h }, () =>
      Array<DigItemView | null>(g.w).fill(null),
    );
    const box = new Map<
      DigItemView,
      { minR: number; minC: number; spanR: number; spanC: number }
    >();
    for (const it of g.items) {
      let minR = Infinity,
        minC = Infinity,
        maxR = -Infinity,
        maxC = -Infinity;
      for (const [r, c] of it.cells ?? []) {
        if (r >= 0 && r < g.h && c >= 0 && c < g.w) at[r][c] = it;
        if (r < minR) minR = r;
        if (c < minC) minC = c;
        if (r > maxR) maxR = r;
        if (c > maxC) maxC = c;
      }
      box.set(it, { minR, minC, spanR: maxR - minR + 1, spanC: maxC - minC + 1 });
    }
    return g.cells.map((row, r) =>
      row.map((code, c) => {
        const it = at[r][c];
        const covered = code === this.COVERED;
        const b = it ? box.get(it)! : null;
        return {
          covered,
          hasItem: !!it,
          revealedFind: !!it && !covered,
          icon: it ? this.iconFor(it) : null,
          spores: it?.kind === 'spores',
          collected: !!it?.collected,
          label: it ? this.labelFor(it) : '',
          spanC: b ? b.spanC : 1,
          spanR: b ? b.spanR : 1,
          localC: b ? c - b.minC : 0,
          localR: b ? r - b.minR : 0,
          anchor: !!b && r === b.minR && c === b.minC,
        };
      }),
    );
  }

  private iconFor(it: DigItemView): string {
    if (it.kind === 'spores') return 'grain';
    return CONSUMABLE_MAP[it.item ?? '']?.icon ?? 'backpack';
  }

  private labelFor(it: DigItemView): string {
    if (it.kind === 'spores') return `${it.spores ?? '?'} Spores`;
    return CONSUMABLE_MAP[it.item ?? '']?.name ?? 'Relic';
  }

  protected onCell(r: number, c: number): void {
    if (this.busy || this.digsLeft < 1) return;
    if (this.grid.cells[r][c] !== this.COVERED) return; // only diggable dirt
    this.dig.emit({ r, c });
  }
}
