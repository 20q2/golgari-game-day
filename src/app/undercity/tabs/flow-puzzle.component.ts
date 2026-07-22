import { Component, EventEmitter, Input, Output, computed, signal } from '@angular/core';
import { CommonModule } from '@angular/common';
import { MatIconModule } from '@angular/material/icon';
import { FlowPuzzleView, FlowReward } from '../services/undercity-models';

type Cell = [number, number];

/**
 * The Flow loot-puzzle modal: drag a single line from the start dot to the end
 * dot, filling every non-rock cell. Pure presentation — the parent owns the
 * `solve-loot-puzzle` action. Emits `solved` with the path when complete, or
 * `gaveUp` when the player bails (forfeits the reward).
 */
@Component({
  selector: 'app-undercity-flow-puzzle',
  standalone: true,
  imports: [CommonModule, MatIconModule],
  template: `
    <div class="flow-overlay" (click)="gaveUp.emit()">
      <div class="flow-card" (click)="$event.stopPropagation()" [style.background-image]="washBg">
        <h3>🌿 Overgrown Cache</h3>
        <p class="flow-sub">
          Trace one vine through every empty tile — the first prize it touches is yours.
        </p>

        <div
          class="flow-grid"
          [style.gridTemplateColumns]="'repeat(' + puzzle.w + ', 1fr)'"
          (pointerdown)="onDown($event)"
          (pointermove)="onMove($event)"
          (pointerup)="onUp()"
          (pointercancel)="onUp()"
        >
          @for (row of rows; track ri; let ri = $index) {
            @for (col of cols; track ci; let ci = $index) {
              <div
                class="cell"
                [attr.data-r]="ri"
                [attr.data-c]="ci"
                [class.rock]="isRock(ri, ci)"
                [class.start]="isStart(ri, ci)"
                [class.end]="isEnd(ri, ci)"
                [class.filled]="inPath(ri, ci)"
                [class.tip]="isTip(ri, ci)"
                [class.claimed]="isClaimed(ri, ci)"
                [class.faded]="isFaded(ri, ci)"
              >
                @if (rewardAt(ri, ci); as rw) {
                  <mat-icon class="reward-ic" [svgIcon]="iconFor(rw)"></mat-icon>
                }
              </div>
            }
          }
        </div>

        <p class="flow-hint" [class.win]="isSolved()">
          {{ isSolved() ? 'Solved! Claiming your find…' : 'Fill every tile in one line.' }}
        </p>
        <div class="flow-actions">
          <button class="uc-btn ghost" (click)="reset()" [disabled]="busy">Reset</button>
          <button class="uc-btn ghost" (click)="gaveUp.emit()" [disabled]="busy">Give up</button>
        </div>
      </div>
    </div>
  `,
  styles: [
    `
      .flow-overlay {
        position: fixed;
        inset: 0;
        z-index: 1150;
        background: rgba(8, 6, 4, 0.75);
        display: flex;
        align-items: center;
        justify-content: center;
        padding: 16px;
      }
      .flow-card {
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
      .flow-sub {
        margin: 0;
        font-size: 0.85rem;
        color: #9aa79a;
      }
      .flow-grid {
        display: grid;
        gap: 4px;
        margin: 4px auto;
        width: 100%;
        max-width: 300px;
        touch-action: none; /* let us own the drag on touch devices */
      }
      .cell {
        aspect-ratio: 1;
        border-radius: 6px;
        border: 1px solid rgba(0, 0, 0, 0.5);
        display: flex;
        align-items: center;
        justify-content: center;
        font-size: 1.1rem;
        user-select: none;
        background: radial-gradient(ellipse at center, #17130d 0%, #241d13 90%);
        box-shadow: inset 0 3px 5px rgba(0, 0, 0, 0.6);
        transition: background 0.1s ease;
      }
      .cell.filled {
        background: linear-gradient(160deg, #6fae76 0%, #3f7a54 100%);
      }
      .cell.tip {
        filter: brightness(1.25);
      }
      .cell.start {
        box-shadow: inset 0 0 0 2px #e0c088;
      }
      .cell.end {
        box-shadow: inset 0 0 0 2px #c9b26f;
      }
      .cell.rock {
        background: #2a2622;
      }
      .cell .reward-ic {
        width: 70%;
        height: 70%;
        color: #e0c088;
      }
      .cell.filled .reward-ic {
        color: #10140e;
      }
      .cell.claimed {
        box-shadow: inset 0 0 0 2px #8fd08a, 0 0 8px rgba(143, 208, 138, 0.7);
      }
      .cell.faded .reward-ic {
        opacity: 0.25;
        filter: grayscale(1);
      }
      .flow-hint {
        margin: 0;
        font-size: 0.8rem;
        color: #8a978a;
      }
      .flow-hint.win {
        color: #8fd08a;
        font-weight: 700;
      }
      .flow-actions {
        display: flex;
        gap: 8px;
        justify-content: center;
      }
    `,
  ],
})
export class FlowPuzzleModalComponent {
  @Input({ required: true }) puzzle!: FlowPuzzleView;
  @Input() busy = false;
  @Input() washBg: string | null = null;
  @Output() solved = new EventEmitter<[number, number][]>();
  @Output() gaveUp = new EventEmitter<void>();

  protected readonly path = signal<Cell[]>([]);
  private drawing = false;

  protected get rows(): number[] {
    return Array.from({ length: this.puzzle.h }, (_, i) => i);
  }
  protected get cols(): number[] {
    return Array.from({ length: this.puzzle.w }, (_, i) => i);
  }

  protected isRock(r: number, c: number): boolean {
    return this.puzzle.rocks.some(([rr, cc]) => rr === r && cc === c);
  }
  protected isStart(r: number, c: number): boolean {
    return this.puzzle.start[0] === r && this.puzzle.start[1] === c;
  }
  protected isEnd(r: number, c: number): boolean {
    return this.puzzle.end[0] === r && this.puzzle.end[1] === c;
  }
  protected inPath(r: number, c: number): boolean {
    return this.path().some(([rr, cc]) => rr === r && cc === c);
  }
  protected isTip(r: number, c: number): boolean {
    const p = this.path();
    return p.length > 0 && p[p.length - 1][0] === r && p[p.length - 1][1] === c;
  }

  /** Registry name of the SVG icon for each reward kind. */
  private readonly rewardIcon: Record<FlowReward['kind'], string> = {
    spores: 'uc-spore',
    item: 'uc-pouch',
    gear: 'uc-chest',
  };

  /** The reward at (r,c), or null. */
  protected rewardAt(r: number, c: number): FlowReward | null {
    return (this.puzzle.rewards ?? []).find((rw) => rw.cell[0] === r && rw.cell[1] === c) ?? null;
  }

  protected iconFor(rw: FlowReward): string {
    return this.rewardIcon[rw.kind];
  }

  /** The first reward cell the current path crosses, or null. */
  protected readonly claimedRewardCell = computed<[number, number] | null>(() => {
    for (const [r, c] of this.path()) {
      const rw = (this.puzzle.rewards ?? []).find((x) => x.cell[0] === r && x.cell[1] === c);
      if (rw) return [r, c];
    }
    return null;
  });

  protected isClaimed(r: number, c: number): boolean {
    const cell = this.claimedRewardCell();
    return !!cell && cell[0] === r && cell[1] === c;
  }

  /** A reward cell that is NOT the first-crossed one, once one has been claimed. */
  protected isFaded(r: number, c: number): boolean {
    const claimed = this.claimedRewardCell();
    if (!claimed) return false;
    const isReward = (this.puzzle.rewards ?? []).some((x) => x.cell[0] === r && x.cell[1] === c);
    return isReward && !(claimed[0] === r && claimed[1] === c);
  }

  protected readonly isSolved = computed(() => {
    const p = this.path();
    const total = this.puzzle.w * this.puzzle.h - this.puzzle.rocks.length;
    if (p.length !== total) return false;
    const [sr, sc] = this.puzzle.start;
    const [er, ec] = this.puzzle.end;
    return (
      p[0][0] === sr && p[0][1] === sc && p[p.length - 1][0] === er && p[p.length - 1][1] === ec
    );
  });

  protected reset(): void {
    this.path.set([]);
    this.drawing = false;
  }

  protected onDown(e: PointerEvent): void {
    const cell = this.cellFromPoint(e);
    if (!cell) return;
    // A drag must begin at the start tile (or resume from the current tip).
    if (this.isStart(cell[0], cell[1])) {
      this.path.set([cell]);
      this.drawing = true;
    } else if (this.isTip(cell[0], cell[1])) {
      this.drawing = true;
    }
    (e.target as HTMLElement).setPointerCapture?.(e.pointerId);
  }

  protected onMove(e: PointerEvent): void {
    if (!this.drawing || this.busy) return;
    const cell = this.cellFromPoint(e);
    if (!cell) return;
    this.extend(cell);
  }

  protected onUp(): void {
    this.drawing = false;
    if (this.isSolved() && !this.busy) this.emitSolved();
  }

  private emitSolved(): void {
    this.solved.emit(this.path().map(([r, c]) => [r, c] as [number, number]));
  }

  /** Extend the path to `cell` if it's an orthogonal neighbour of the tip and not
   * a rock/already used; step back if it's the previous cell (erase). */
  private extend([r, c]: Cell): void {
    if (this.isRock(r, c)) return;
    const p = this.path();
    if (p.length === 0) return;
    const [tr, tc] = p[p.length - 1];
    if (tr === r && tc === c) return; // same tile
    // Backtrack: dragging onto the second-to-last cell erases the last step.
    if (p.length >= 2) {
      const [pr, pc] = p[p.length - 2];
      if (pr === r && pc === c) {
        this.path.set(p.slice(0, -1));
        return;
      }
    }
    const adjacent = Math.abs(tr - r) + Math.abs(tc - c) === 1;
    if (!adjacent) return;
    if (p.some(([rr, cc]) => rr === r && cc === c)) return; // no revisits
    this.path.set([...p, [r, c]]);
  }

  private cellFromPoint(e: PointerEvent): Cell | null {
    const el = document.elementFromPoint(e.clientX, e.clientY) as HTMLElement | null;
    const cellEl = el?.closest('[data-r]') as HTMLElement | null;
    if (!cellEl) return null;
    const r = Number(cellEl.getAttribute('data-r'));
    const c = Number(cellEl.getAttribute('data-c'));
    if (Number.isNaN(r) || Number.isNaN(c)) return null;
    return [r, c];
  }
}
