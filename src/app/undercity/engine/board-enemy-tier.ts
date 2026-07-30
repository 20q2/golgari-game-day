/**
 * Enemy-space difficulty tier (T1/T2/T3) for the board badges. Mirrors the
 * server's enemy-pool resolution (undercity_db._wild_battle → data.region_tier):
 * difficulty is WHERE you are, not how deep you dig — each region maps flatly to
 * a tier (design 2026-07-26-region-tier), and an `elite` space draws the tougher
 * members of that SAME tier (elites never jump a tier). So the badge is just the
 * region's tier for any wild/elite coin. Pure: map in, {nodeId -> tier} out.
 * Keep REGION_TIER below in sync with undercity_data.REGION_TIER.
 */
import type { BoardMap, BoardNode } from './board-canvas';

export type EnemyTier = 1 | 2 | 3;

/** Region -> difficulty tier. Mirror of undercity_data.REGION_TIER; unknown/None
 *  falls back to tier 1 (safe), matching data.region_tier. */
const REGION_TIER: Record<string, EnemyTier> = {
  city: 1,
  garden: 1,
  bone: 1,
  cavern: 1,
  bog: 1,
  ruin: 2,
  depths: 2,
  wilderness: 3,
  isle: 3,
};

/** Danger grade colours for the enemy-space T1/T2/T3 badge (calm -> lethal). */
export const TIER_COLORS: Record<EnemyTier, string> = {
  1: '#8fd694',
  2: '#f4c14b',
  3: '#ff7066',
};

/**
 * The "T1/T2/T3" difficulty tag for a wild/elite coin, drawn as a small crisp
 * superscript pinned to the UPPER-RIGHT of the centre enemy glyph (like an
 * exponent), so the difficulty reads at a glance without a floating pill or a
 * muddy stamp across the coin. A dark outline keeps it legible on the red coin.
 *
 * Sized in world units (like the glyph itself, not counter-scaled), so it always
 * reads as a neat half-size superscript relative to the coin at any zoom. Shared
 * by the game board and the map editor so both render it identically.
 */
export function drawTierBadge(
  ctx: CanvasRenderingContext2D,
  n: BoardNode,
  tier: EnemyTier,
  _zoom = 1,
): void {
  const label = `T${tier}`;
  const cx = n.x + 9; // just right of the glyph…
  const cy = n.y - 9; // …and up, so it sits like a superscript

  ctx.save();
  ctx.font = "800 15px 'Segoe UI', system-ui, sans-serif";
  ctx.textAlign = 'left';
  ctx.textBaseline = 'middle';
  ctx.lineJoin = 'round';
  ctx.lineWidth = 3;
  ctx.strokeStyle = 'rgba(10, 6, 6, 0.9)';
  ctx.strokeText(label, cx, cy);
  ctx.fillStyle = '#ffffff';
  ctx.fillText(label, cx, cy);
  ctx.restore();
}

/** Tier of a single wild/elite space, or null if it isn't an enemy space. */
function tierOf(node: BoardNode): EnemyTier | null {
  if (node.type !== 'wild' && node.type !== 'elite') return null;
  return REGION_TIER[node.region ?? ''] ?? 1;
}

/** {enemy node id -> T1/T2/T3}. Non-enemy nodes are absent from the map. */
export function computeEnemyTiers(map: BoardMap): Map<string, EnemyTier> {
  const out = new Map<string, EnemyTier>();
  for (const n of map.nodes) {
    const t = tierOf(n);
    if (t) out.set(n.id, t);
  }
  return out;
}
