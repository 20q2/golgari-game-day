import { Component, EventEmitter, Input, Output } from '@angular/core';
import { CommonModule } from '@angular/common';
import { DigGrid } from '../services/undercity-models';

/**
 * The excavation dig-site modal: a grid of covered cells you tap to reveal.
 * Pure presentation — the parent owns the shared grid state and the `dig`
 * action; this component only renders the masked view and emits taps. Covered
 * cells (-2) are diggable rubble; -1 is revealed rubble; >=0 is a revealed
 * item cell tinted by its item index.
 */
@Component({
  selector: 'app-undercity-excavation',
  standalone: true,
  imports: [CommonModule],
  template: `
    <div class="dig-overlay" (click)="closed.emit()">
      <div class="dig-card" (click)="$event.stopPropagation()">
        <h3>⛏️ Dig Site</h3>
        <p class="dig-sub">
          {{ grid.remaining }} find{{ grid.remaining === 1 ? '' : 's' }} still buried ·
          <strong>{{ digsLeft }}</strong> dig{{ digsLeft === 1 ? '' : 's' }} left this visit
        </p>

        <div class="dig-grid" [style.gridTemplateColumns]="'repeat(' + grid.w + ', 1fr)'">
          @for (row of grid.cells; track ri; let ri = $index) {
            @for (v of row; track ci; let ci = $index) {
              <button
                type="button"
                class="cell"
                [class.covered]="v === COVERED"
                [class.empty]="v === EMPTY"
                [class.item]="v >= 0"
                [class.collected]="v >= 0 && isCollected(v)"
                [attr.data-item]="v >= 0 ? v % 6 : null"
                [disabled]="busy || digsLeft < 1 || v !== COVERED"
                (click)="onCell(ri, ci)"
              >
                @if (v >= 0 && isCollected(v)) {
                  <span class="check">✓</span>
                }
              </button>
            }
          }
        </div>

        @if (digsLeft < 1) {
          <p class="dig-hint out">Out of digs — come back next time you land here.</p>
        } @else {
          <p class="dig-hint">Tap rubble to dig. Uncover every cell of a find to claim it.</p>
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
        display: grid;
        gap: 4px;
        margin: 2px auto;
        width: 100%;
        max-width: 300px;
      }
      .cell {
        aspect-ratio: 1;
        border-radius: 6px;
        border: 1px solid rgba(0, 0, 0, 0.5);
        padding: 0;
        cursor: pointer;
        display: flex;
        align-items: center;
        justify-content: center;
        font-size: 1rem;
        transition: transform 0.08s ease, filter 0.12s ease;
      }
      .cell:disabled {
        cursor: default;
      }
      .cell.covered {
        background: linear-gradient(160deg, #6b5334 0%, #4a3a24 100%);
        box-shadow: inset 0 2px 2px rgba(255, 255, 255, 0.12), inset 0 -3px 4px rgba(0, 0, 0, 0.4);
      }
      .cell.covered:not(:disabled):hover {
        filter: brightness(1.2);
        transform: translateY(-1px);
      }
      .cell.empty {
        background: radial-gradient(ellipse at center, #17130d 0%, #241d13 90%);
        box-shadow: inset 0 3px 5px rgba(0, 0, 0, 0.7);
      }
      .cell.item {
        box-shadow: inset 0 2px 3px rgba(255, 255, 255, 0.18);
      }
      .cell.item[data-item='0'] { background: #c98b3e; }
      .cell.item[data-item='1'] { background: #6fae76; }
      .cell.item[data-item='2'] { background: #7a9ad0; }
      .cell.item[data-item='3'] { background: #b56fae; }
      .cell.item[data-item='4'] { background: #d0776f; }
      .cell.item[data-item='5'] { background: #c9b26f; }
      .cell.collected {
        filter: grayscale(0.5) brightness(0.7);
      }
      .check {
        color: rgba(0, 0, 0, 0.65);
        font-weight: 900;
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
export class ExcavationModalComponent {
  @Input({ required: true }) grid!: DigGrid;
  @Input() digsLeft = 0;
  @Input() busy = false;
  @Output() dig = new EventEmitter<{ r: number; c: number }>();
  @Output() closed = new EventEmitter<void>();

  protected readonly COVERED = -2;
  protected readonly EMPTY = -1;

  protected isCollected(idx: number): boolean {
    return !!this.grid.items.find((i) => i.idx === idx)?.collected;
  }

  protected onCell(r: number, c: number): void {
    if (this.busy || this.digsLeft < 1) return;
    if (this.grid.cells[r][c] !== this.COVERED) return; // only diggable rubble
    this.dig.emit({ r, c });
  }
}
