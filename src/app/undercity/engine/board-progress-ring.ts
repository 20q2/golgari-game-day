/**
 * Completion rings for the shared progress spaces — dig sites (`excavation`) and
 * gemstone walls (`crystal_vein`). Both fill toward a payoff as players work
 * them (a dig site clears when its last find is unearthed; a vein reaches the
 * Heartstone at VEIN_MAX_DEPTH), and both are shared across the table, so the
 * board draws a thin arc hugging the coin that fills clockwise with how close
 * the space is to done — letting you spot the nearly-finished ones before you
 * spend a landing on them.
 *
 * Progress is live state (not derivable from the static map like the enemy
 * tiers), so computeProgress() is fed the season's excavation/vein records each
 * time board state syncs. Pure: state in, {nodeId -> 0..1} out.
 */
import type { BoardNode } from './board-canvas';
import type { DigGrid, VeinState } from '../services/undercity-models';
import { NODE_R, DISC_RY } from './board-space';
import { VEIN_MAX_DEPTH } from '../data/vein-vault';

/** Ramp the ring from calm teal-green (just begun) through gold to a hot coral
 *  as it nears completion, so the almost-done spaces read warm at a glance.
 *  Shares the enemy-tier palette (board-enemy-tier TIER_COLORS) for one look. */
const RING_STOPS: [number, [number, number, number]][] = [
  [0.0, [143, 214, 148]], // #8fd694
  [0.6, [244, 193, 75]], // #f4c14b
  [1.0, [255, 112, 102]], // #ff7066
];

function ringColor(p: number): string {
  for (let i = 1; i < RING_STOPS.length; i++) {
    if (p <= RING_STOPS[i][0]) {
      const [p0, c0] = RING_STOPS[i - 1];
      const [p1, c1] = RING_STOPS[i];
      const t = (p - p0) / (p1 - p0 || 1);
      const ch = (k: number) => Math.round(c0[k] + (c1[k] - c0[k]) * t);
      return `rgb(${ch(0)}, ${ch(1)}, ${ch(2)})`;
    }
  }
  const c = RING_STOPS[RING_STOPS.length - 1][1];
  return `rgb(${c[0]}, ${c[1]}, ${c[2]})`;
}

/**
 * A completion ring for a dig-site / gemstone-wall coin: a dark track ellipse
 * just outside the disc, overlaid by a coloured arc sweeping clockwise from the
 * top by fraction `p`. Drawn in world units (not counter-scaled) so it stays a
 * neat halo at any zoom.
 */
export function drawProgressRing(ctx: CanvasRenderingContext2D, n: BoardNode, p: number): void {
  const rx = NODE_R + 4;
  const ry = DISC_RY + 3;
  const start = -Math.PI / 2; // 12 o'clock
  const end = start + Math.max(0.02, Math.min(1, p)) * Math.PI * 2;

  ctx.save();
  ctx.lineCap = 'round';

  // Dark track so the coloured fill pops on any disc colour, plus a faint pale
  // inner line to lift the empty portion off the ground.
  ctx.beginPath();
  ctx.ellipse(n.x, n.y, rx, ry, 0, 0, Math.PI * 2);
  ctx.lineWidth = 5;
  ctx.strokeStyle = 'rgba(10, 8, 8, 0.55)';
  ctx.stroke();
  ctx.beginPath();
  ctx.ellipse(n.x, n.y, rx, ry, 0, 0, Math.PI * 2);
  ctx.lineWidth = 2;
  ctx.strokeStyle = 'rgba(255, 255, 255, 0.14)';
  ctx.stroke();

  // The filled progress arc, with a soft same-colour glow.
  const col = ringColor(p);
  ctx.beginPath();
  ctx.ellipse(n.x, n.y, rx, ry, 0, start, end);
  ctx.lineWidth = 4;
  ctx.strokeStyle = col;
  ctx.shadowColor = col;
  ctx.shadowBlur = 6;
  ctx.stroke();

  ctx.restore();
}

/**
 * {nodeId -> completion 0..1} for every in-progress dig site / gemstone wall.
 * Excavation progress is per-node (finds unearthed / total); vein progress is
 * shared per region (shaft depth / VEIN_MAX_DEPTH). Fully-cleared sites and
 * untouched ones are omitted — the ring only marks spaces actively worth
 * grading (0 < p < 1).
 */
export function computeProgress(
  map: { nodes: BoardNode[] },
  excavations: Record<string, DigGrid>,
  veins: Record<string, VeinState>,
): Map<string, number> {
  const out = new Map<string, number>();
  for (const n of map.nodes) {
    let p: number | null = null;
    if (n.type === 'excavation') {
      const g = excavations[n.id];
      if (g) {
        const total = g.items.length || g.remaining; // untouched: items=[] , remaining=total
        if (total > 0) p = (total - g.remaining) / total;
      }
    } else if (n.type === 'crystal_vein') {
      const v = veins[n.region ?? ''];
      if (v) p = Math.min(1, v.depth / VEIN_MAX_DEPTH);
    }
    if (p !== null && p > 0 && p < 1) out.set(n.id, p);
  }
  return out;
}
