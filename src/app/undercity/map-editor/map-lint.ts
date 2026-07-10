/**
 * Map validation — the client-side mirror of tests/test_map.py's invariants.
 * Errors block saving; warnings are advisory.
 */
import { BoardMap } from '../engine/board-canvas';

export interface LintIssue {
  level: 'error' | 'warn';
  text: string;
  nodeId?: string;
}

export function lintMap(doc: BoardMap): LintIssue[] {
  const issues: LintIssue[] = [];
  const err = (text: string, nodeId?: string) => issues.push({ level: 'error', text, nodeId });
  const warn = (text: string, nodeId?: string) => issues.push({ level: 'warn', text, nodeId });

  const byId = new Map(doc.nodes.map((n) => [n.id, n]));
  if (byId.size !== doc.nodes.length) {
    const seen = new Set<string>();
    for (const n of doc.nodes) {
      if (seen.has(n.id)) err(`Duplicate node id "${n.id}"`, n.id);
      seen.add(n.id);
    }
  }

  // Neighbor symmetry + unknown references.
  for (const n of doc.nodes) {
    for (const nb of n.neighbors) {
      const other = byId.get(nb);
      if (!other) err(`"${n.id}" links to unknown node "${nb}"`, n.id);
      else if (!other.neighbors.includes(n.id)) {
        err(`Asymmetric edge: "${n.id}" → "${nb}" has no return link`, n.id);
      }
    }
    if (new Set(n.neighbors).size !== n.neighbors.length) {
      err(`"${n.id}" lists a neighbor twice`, n.id);
    }
  }

  // Entry points.
  const gate = byId.get(doc.gate);
  if (!gate) err(`Gate node "${doc.gate}" does not exist`);
  else if (gate.type !== 'gate') err(`Gate node "${doc.gate}" has type "${gate.type}"`, gate.id);
  const boss = byId.get(doc.boss);
  if (!boss) err(`Boss node "${doc.boss}" does not exist`);
  else if (boss.type !== 'boss') err(`Boss node "${doc.boss}" has type "${boss.type}"`, boss.id);

  // Everything reachable from the gate — walking edges plus warp teleports
  // (the floating island's only route in), mirroring the server's test.
  if (gate) {
    const warps = doc.nodes.filter((n) => n.type === 'warp').map((n) => n.id);
    const seen = new Set([gate.id]);
    const queue = [gate.id];
    while (queue.length) {
      const cur = byId.get(queue.pop()!)!;
      const nbs = [...cur.neighbors];
      if (cur.type === 'warp') nbs.push(...warps.filter((w) => w !== cur.id));
      for (const nb of nbs) {
        if (byId.has(nb) && !seen.has(nb)) {
          seen.add(nb);
          queue.push(nb);
        }
      }
    }
    for (const n of doc.nodes) {
      if (!seen.has(n.id)) err(`"${n.id}" is unreachable from the gate (walk + warps)`, n.id);
    }
  }

  // Ladders come in pairs: each must have exactly one ladder neighbor.
  for (const n of doc.nodes) {
    if (n.type !== 'ladder') continue;
    const partners = n.neighbors.filter((nb) => byId.get(nb)?.type === 'ladder');
    if (partners.length !== 1) {
      err(`Ladder "${n.id}" has ${partners.length} ladder partners (needs exactly 1)`, n.id);
    }
  }

  // Regions.
  const regions = doc.regions ?? {};
  for (const n of doc.nodes) {
    if (!n.region) warn(`"${n.id}" has no region`, n.id);
    else if (!regions[n.region]) err(`"${n.id}" uses undefined region "${n.region}"`, n.id);
  }

  // Bounds are advisory with the terrain's own 200px margin of grace — the
  // renderer pads for rings that outgrew the declared world; only flag nodes
  // clearly adrift.
  const PAD = 200;
  for (const n of doc.nodes) {
    if (n.x < -PAD || n.x > doc.worldW + PAD || n.y < -PAD || n.y > doc.worldH + PAD) {
      warn(`"${n.id}" sits far outside the ${doc.worldW}×${doc.worldH} world`, n.id);
    }
  }

  // Isolated barrier is legal (dead-end treasure gate) but usually a mistake.
  for (const n of doc.nodes) {
    if (n.type === 'barrier' && n.neighbors.length < 2) {
      warn(`Barrier "${n.id}" doesn't gate a route (fewer than 2 links)`, n.id);
    }
  }

  return issues;
}
