/**
 * Client-side step legality for walking a roll one space at a time.
 *
 * Mirrors the server's Dokapon exact-count movement (undercity_engine.
 * legal_destinations): every step must keep a continuation alive — exactly
 * `left - 1` further edges, never immediately reversing the edge just walked,
 * ending on one of the server-approved destinations. The server only ever
 * sees the final node, so `pendingMove.dests` remains the source of truth.
 */
import { BoardMap } from './board-canvas';

export function legalSteps(
  map: BoardMap,
  pos: string,
  prev: string | null,
  left: number,
  dests: readonly string[],
  closedBarriers: readonly string[] = [],
): string[] {
  if (left < 1) return [];
  const neighbors = new Map(map.nodes.map((n) => [n.id, n.neighbors]));
  const destSet = new Set(dests);
  const closed = new Set(closedBarriers);
  const memo = new Map<string, boolean>();

  const canFinish = (node: string, from: string, remaining: number): boolean => {
    if (remaining === 0) return destSet.has(node);
    // Sealed barriers mirror the server: a valid final stop, never a corridor.
    if (closed.has(node)) return false;
    const key = `${node}|${from}|${remaining}`;
    const hit = memo.get(key);
    if (hit !== undefined) return hit;
    const ok = (neighbors.get(node) ?? []).some(
      (nb) => nb !== from && canFinish(nb, node, remaining - 1),
    );
    memo.set(key, ok);
    return ok;
  };

  return (neighbors.get(pos) ?? []).filter((nb) => nb !== prev && canFinish(nb, pos, left - 1));
}
