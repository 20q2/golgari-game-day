import { Component, EventEmitter, Input, Output, computed, signal } from '@angular/core';
import { CommonModule } from '@angular/common';
import { MatIconModule } from '@angular/material/icon';
import { FlowPuzzleView, FlowReward } from '../services/undercity-models';

/** Mirror of undercity_config.FLOW_SPORE_PER_CELL / FLOW_SPORE_CAP. Keep in sync
 * if the server tunables change. */
const FLOW_SPORE_PER_CELL = 0.5;
const FLOW_SPORE_CAP = 10;

type Cell = [number, number];

/**
 * The Overgrown Cache modal: drag a single line from the green start to the amber
 * goal. Coverage is NOT required — any connecting route works. Every tile crossed
 * is spores (shown live); the first item/gear pickup the route touches is redeemed.
 * Pure presentation — the parent owns the `solve-loot-puzzle` action. Emits
 * `solved` with the path on Claim. There is no bail-out: the route must be
 * completed (Reset restarts a botched attempt).
 */
@Component({
  selector: 'app-undercity-flow-puzzle',
  standalone: true,
  imports: [CommonModule, MatIconModule],
  template: `
    <div class="flow-overlay">
      <div class="flow-card" [style.background-image]="washBg">
        <h3>🌿 Overgrown Cache</h3>
        <p class="flow-sub">
          Trace a vine from the <b class="lbl-start">green start</b> to the
          <b class="lbl-end">amber goal</b>. Every tile is spores — the longer the
          route, the more you gather — and the first treasure you cross is yours.
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
                @if (armsFor(ri, ci); as arms) {
                  <span class="trail-hub"></span>
                  @if (arms.up) {
                    <span class="trail-arm up"></span>
                  }
                  @if (arms.down) {
                    <span class="trail-arm down"></span>
                  }
                  @if (arms.left) {
                    <span class="trail-arm left"></span>
                  }
                  @if (arms.right) {
                    <span class="trail-arm right"></span>
                  }
                }
                @if (rewardAt(ri, ci); as rw) {
                  <mat-icon class="reward-ic" [svgIcon]="iconFor(rw)"></mat-icon>
                }
              </div>
            }
          }
        </div>

        <p class="flow-hint" [class.win]="isConnected()">
          <span class="spore-tally">🌱 Spores: {{ sporesSoFar() }} / {{ sporeCap }}</span>
          {{ isConnected() ? '— route complete, claim your find!' : '— connect 🌱 to 🌾.' }}
        </p>
        <div class="flow-actions">
          <button class="uc-btn ghost" (click)="reset()" [disabled]="busy">Reset</button>
          <button class="uc-btn" (click)="claim()" [disabled]="busy || !isConnected()">
            Claim
          </button>
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
      .flow-sub .lbl-start {
        color: #7cfc6b;
      }
      .flow-sub .lbl-end {
        color: #f2b04a;
      }
      .flow-grid {
        --flow-gap: 4px;
        display: grid;
        gap: var(--flow-gap);
        margin: 4px auto;
        width: 100%;
        max-width: 300px;
        touch-action: none; /* let us own the drag on touch devices */
      }
      .cell {
        position: relative;
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
      /* Connecting vine drawn through the route so the path is traceable. Arms
       * reach half the grid gap past each edge to meet the neighbour's arm. */
      .trail-hub,
      .trail-arm {
        position: absolute;
        pointer-events: none;
        z-index: 2;
        background: #cdf7a6;
        box-shadow: 0 0 6px rgba(124, 252, 107, 0.75), 0 0 0 1.5px rgba(8, 20, 8, 0.5);
      }
      .trail-hub {
        top: 50%;
        left: 50%;
        width: 36%;
        height: 36%;
        transform: translate(-50%, -50%);
        border-radius: 4px;
      }
      .trail-arm.up,
      .trail-arm.down {
        left: 50%;
        width: 36%;
        transform: translateX(-50%);
      }
      .trail-arm.left,
      .trail-arm.right {
        top: 50%;
        height: 36%;
        transform: translateY(-50%);
      }
      .trail-arm.up {
        top: calc(var(--flow-gap) / -2);
        bottom: 50%;
      }
      .trail-arm.down {
        top: 50%;
        bottom: calc(var(--flow-gap) / -2);
      }
      .trail-arm.left {
        left: calc(var(--flow-gap) / -2);
        right: 50%;
      }
      .trail-arm.right {
        left: 50%;
        right: calc(var(--flow-gap) / -2);
      }
      /* Brighten the leading tile so the current head of the vine stands out. */
      .cell.tip .trail-hub {
        background: #eaffd4;
        transform: translate(-50%, -50%) scale(1.15);
        box-shadow: 0 0 10px rgba(180, 255, 140, 0.95), 0 0 0 1.5px rgba(8, 20, 8, 0.5);
      }
      /* Start — vivid green, gently pulsing, with a solid centre pip. */
      .cell.start {
        box-shadow: inset 0 0 0 3px #7cfc6b, 0 0 10px rgba(124, 252, 107, 0.55);
        animation: flow-start-pulse 1.6s ease-in-out infinite;
      }
      .cell.start:not(.filled) {
        background: radial-gradient(ellipse at center, #274d2b 0%, #16241a 90%);
      }
      /* End — warm amber goal, with a hollow target ring. */
      .cell.end {
        box-shadow: inset 0 0 0 3px #f2b04a, 0 0 10px rgba(242, 176, 74, 0.55);
      }
      .cell.end:not(.filled) {
        background: radial-gradient(ellipse at center, #4a3a1a 0%, #2c2210 90%);
      }
      .cell.start::after,
      .cell.end::after {
        content: '';
        position: absolute;
        top: 50%;
        left: 50%;
        transform: translate(-50%, -50%);
        width: 32%;
        height: 32%;
        border-radius: 50%;
        pointer-events: none;
      }
      .cell.start::after {
        background: #7cfc6b;
        box-shadow: 0 0 6px rgba(124, 252, 107, 0.9);
      }
      .cell.end::after {
        border: 3px solid #f2b04a;
        box-shadow: 0 0 6px rgba(242, 176, 74, 0.7);
      }
      @keyframes flow-start-pulse {
        0%,
        100% {
          box-shadow: inset 0 0 0 3px #7cfc6b, 0 0 6px rgba(124, 252, 107, 0.4);
        }
        50% {
          box-shadow: inset 0 0 0 3px #7cfc6b, 0 0 14px rgba(124, 252, 107, 0.85);
        }
      }
      .cell.rock {
        background: #2a2622;
      }
      .cell .reward-ic {
        position: relative;
        z-index: 3;
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

  /** For each path cell, which orthogonal directions link to its route
   * neighbours (previous/next step). Drives the connecting trail line so the
   * player can trace the vine back to where they came from. */
  private readonly trailMap = computed(() => {
    const p = this.path();
    const m = new Map<string, { up: boolean; down: boolean; left: boolean; right: boolean }>();
    for (let i = 0; i < p.length; i++) {
      const [r, c] = p[i];
      const arms = { up: false, down: false, left: false, right: false };
      for (const n of [p[i - 1], p[i + 1]]) {
        if (!n) continue;
        const [nr, nc] = n;
        if (nr === r - 1 && nc === c) arms.up = true;
        else if (nr === r + 1 && nc === c) arms.down = true;
        else if (nr === r && nc === c - 1) arms.left = true;
        else if (nr === r && nc === c + 1) arms.right = true;
      }
      m.set(`${r},${c}`, arms);
    }
    return m;
  });

  /** Trail arms for (r,c), or null when the cell is not on the route. */
  protected armsFor(
    r: number,
    c: number,
  ): { up: boolean; down: boolean; left: boolean; right: boolean } | null {
    return this.trailMap().get(`${r},${c}`) ?? null;
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

  /** The route is claimable once it connects start → end (coverage not required). */
  protected readonly isConnected = computed(() => {
    const p = this.path();
    if (p.length < 2) return false;
    const [sr, sc] = this.puzzle.start;
    const [er, ec] = this.puzzle.end;
    return (
      p[0][0] === sr && p[0][1] === sc && p[p.length - 1][0] === er && p[p.length - 1][1] === ec
    );
  });

  /** Live movement-spore tally shown while drawing (matches the server award). */
  protected readonly sporesSoFar = computed(() =>
    Math.min(Math.floor(this.path().length * FLOW_SPORE_PER_CELL), FLOW_SPORE_CAP),
  );
  protected readonly sporeCap = FLOW_SPORE_CAP;

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
  }

  protected claim(): void {
    if (!this.isConnected() || this.busy) return;
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
