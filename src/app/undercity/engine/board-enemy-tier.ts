/**
 * Enemy-space difficulty tier (T1/T2/T3) for the board badges. Mirrors the
 * server's enemy-pool resolution (undercity_db._wild_battle / _depths_enemy):
 * what actually spawns on a `wild`/`elite` space depends on its region and, in
 * the depths, how deep the pocket runs (hop-distance from the biome mouth). We
 * bucket the server's rungs onto three tiers by the pool that spawns:
 *   T1  surface / home wilds + shallow depths (d1-4) fodder
 *   T2  mid + deep depths (d5-15) + wilderness
 *   T3  abyss (depths d16+) + the isle / boss approach
 * An `elite` space spikes one rung up (server behaviour), so an elite reads as
 * the tier of its spiked pool. Pure: map in, {nodeId -> tier} out. Keep in sync
 * with the Python if the ladder ever changes.
 */
import type { BoardMap, BoardNode } from './board-canvas';
import { DISC_RY } from './board-space';
import { DUNGEONS } from '../data/dungeons';

export type EnemyTier = 1 | 2 | 3;

/** Danger grade colours for the enemy-space T1/T2/T3 badge (calm -> lethal). */
export const TIER_COLORS: Record<EnemyTier, string> = {
  1: '#8fd694',
  2: '#f4c14b',
  3: '#ff7066',
};

/**
 * The "T1/T2/T3" difficulty label stamped in white directly onto the lower face
 * of a wild/elite coin (below its centre enemy glyph), so the difficulty of a
 * red space reads at a glance without a floating pill. A dark outline keeps the
 * letters legible against the red coin. Shared by the game board and the map
 * editor so both render it identically.
 *
 * The caller's canvas is scaled by `zoom` (world -> screen), so we counter-scale
 * the text by `1/zoom`: it holds a constant *on-screen* size and stays legible
 * whether you're zoomed into your token in-game or looking at the whole board in
 * the editor. Its position stays pinned in world space to the disc.
 */
export function drawTierBadge(
  ctx: CanvasRenderingContext2D,
  n: BoardNode,
  tier: EnemyTier,
  zoom = 1,
): void {
  const label = `T${tier}`;
  const k = 1 / zoom; // world units per on-screen px at the current zoom
  const cx = n.x;
  const cy = n.y + DISC_RY * 0.5; // lower face of the coin, clear of the centre glyph

  ctx.save();
  ctx.globalAlpha = 0.5; // half-strength so the letters read as a subtle stamp
  ctx.font = `900 ${13 * k}px sans-serif`;
  ctx.textAlign = 'center';
  ctx.textBaseline = 'middle';
  ctx.lineJoin = 'round';
  ctx.lineWidth = 3 * k;
  ctx.strokeStyle = 'rgba(12, 8, 8, 0.85)';
  ctx.strokeText(label, cx, cy);
  ctx.fillStyle = '#ffffff';
  ctx.fillText(label, cx, cy);
  ctx.restore();
}

/** BFS hop-distance of every depths node from its biome's ladder mouth
 *  (`<biome>_lb`) — a direct port of undercity_db._season_depth_map. */
function depthMap(map: BoardMap): Map<string, number> {
  const byId = new Map(map.nodes.map((n) => [n.id, n]));
  const depth = new Map<string, number>();
  for (const biome of Object.keys(DUNGEONS)) {
    const mouth = `${biome}_lb`;
    if (!byId.has(mouth)) continue;
    depth.set(mouth, 0);
    const queue = [mouth];
    for (let i = 0; i < queue.length; i++) {
      const cur = byId.get(queue[i])!;
      for (const nb of cur.neighbors) {
        const n = byId.get(nb);
        if (n && n.region === 'depths' && !depth.has(nb)) {
          depth.set(nb, depth.get(queue[i])! + 1);
          queue.push(nb);
        }
      }
    }
  }
  return depth;
}

/** Tier of a single wild/elite space, or null if it isn't an enemy space. */
function tierOf(node: BoardNode, depth: Map<string, number>): EnemyTier | null {
  if (node.type !== 'wild' && node.type !== 'elite') return null;
  const elite = node.type === 'elite';
  const region = node.region;
  if (region === 'isle') return 3;
  if (region === 'wilderness') return 2;
  if (region === 'depths') {
    const d = depth.get(node.id) ?? 0;
    let rung = d <= 4 ? 1 : d <= 9 ? 2 : d <= 15 ? 3 : 4;
    if (elite) rung += 1; // elite = spike one rung up (capped implicitly at rung 5)
    return rung <= 1 ? 1 : rung <= 3 ? 2 : 3; // rung1->T1, rung2/3->T2, rung4/5->T3
  }
  return 1; // surface / home biome pockets (NPCS / ELITE_NPCS — the fodder band)
}

/** {enemy node id -> T1/T2/T3}. Non-enemy nodes are absent from the map. */
export function computeEnemyTiers(map: BoardMap): Map<string, EnemyTier> {
  const depth = depthMap(map);
  const out = new Map<string, EnemyTier>();
  for (const n of map.nodes) {
    const t = tierOf(n, depth);
    if (t) out.set(n.id, t);
  }
  return out;
}
