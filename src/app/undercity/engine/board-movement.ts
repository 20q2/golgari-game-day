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
    // Sealed barriers mirror the server bonk rule: reaching one is always a
    // valid stop (you march up and halt at the wall), and never a corridor.
    if (closed.has(node)) return destSet.has(node);
    if (remaining === 0) return destSet.has(node);
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

/**
 * Shortest hop count start→goal (plain BFS — no exact-count or no-backtrack
 * rule), or null past maxSteps. Mirrors undercity_engine.board_distance:
 * sealed barriers block passage but may be the goal itself.
 */
export function boardDistance(
  map: BoardMap,
  start: string,
  goal: string,
  maxSteps: number,
  closedBarriers: readonly string[] = [],
): number | null {
  if (start === goal) return 0;
  const neighbors = new Map(map.nodes.map((n) => [n.id, n.neighbors]));
  const closed = new Set(closedBarriers);
  let frontier = new Set([start]);
  const seen = new Set([start]);
  for (let dist = 1; dist <= maxSteps; dist++) {
    const next = new Set<string>();
    for (const node of frontier) {
      if (node !== start && closed.has(node)) continue;
      for (const nb of neighbors.get(node) ?? []) {
        if (seen.has(nb)) continue;
        if (nb === goal) return dist;
        seen.add(nb);
        next.add(nb);
      }
    }
    frontier = next;
    if (!frontier.size) break;
  }
  return null;
}

/** Every node within maxSteps of start (start excluded) — teleport targets. */
export function nodesWithin(
  map: BoardMap,
  start: string,
  maxSteps: number,
  closedBarriers: readonly string[] = [],
): string[] {
  const neighbors = new Map(map.nodes.map((n) => [n.id, n.neighbors]));
  const closed = new Set(closedBarriers);
  let frontier = new Set([start]);
  const seen = new Set([start]);
  const out: string[] = [];
  for (let dist = 1; dist <= maxSteps; dist++) {
    const next = new Set<string>();
    for (const node of frontier) {
      if (node !== start && closed.has(node)) continue;
      for (const nb of neighbors.get(node) ?? []) {
        if (seen.has(nb)) continue;
        seen.add(nb);
        next.add(nb);
        out.push(nb);
      }
    }
    frontier = next;
    if (!frontier.size) break;
  }
  return out;
}
