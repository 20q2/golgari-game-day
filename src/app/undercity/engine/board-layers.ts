/**
 * Partition the board graph into render/view "layers": one `overworld` layer
 * (every node whose region isn't `depths`) plus one layer per `depths`
 * connected component — the ladder-down dungeon pockets. Each `depths`
 * component touches the overworld only through its ladder pair, so a union-
 * find over depths-only edges yields one layer per pocket. Pure: graph in,
 * descriptors out.
 */
import type { BoardMap } from './board-canvas';

export const OVERWORLD = 'overworld';

export interface LayerBounds {
  /** World-space top-left and size covering this layer's nodes. */
  x: number;
  y: number;
  w: number;
  h: number;
}

export interface LayerSpec {
  id: string;
  nodeIds: Set<string>;
  bounds: LayerBounds;
}

/** Padding (world px) added around a dungeon pocket's node bbox. */
const POCKET_PAD = 260;

function boundsOf(map: BoardMap, ids: Set<string>, full: boolean): LayerBounds {
  let minX = Infinity,
    minY = Infinity,
    maxX = -Infinity,
    maxY = -Infinity;
  for (const n of map.nodes) {
    if (!ids.has(n.id)) continue;
    minX = Math.min(minX, n.x);
    minY = Math.min(minY, n.y);
    maxX = Math.max(maxX, n.x);
    maxY = Math.max(maxY, n.y);
  }
  if (full) {
    // The declared world size can lag behind the actual node layout (rings
    // have grown past worldW/H), so take the union of both plus breathing
    // room for discs + landmarks hanging off the outermost nodes.
    const pad = 120;
    const x = Math.min(0, minX - pad);
    const y = Math.min(0, minY - pad);
    return {
      x,
      y,
      w: Math.max(map.worldW, maxX + pad) - x,
      h: Math.max(map.worldH, maxY + pad) - y,
    };
  }
  return {
    x: minX - POCKET_PAD,
    y: minY - POCKET_PAD,
    w: maxX - minX + POCKET_PAD * 2,
    h: maxY - minY + POCKET_PAD * 2,
  };
}

/** All layers, `overworld` first. */
export function computeLayers(map: BoardMap): LayerSpec[] {
  const isDepths = new Map(map.nodes.map((n) => [n.id, n.region === 'depths']));
  const overworld = new Set(map.nodes.filter((n) => !isDepths.get(n.id)).map((n) => n.id));

  // Union-find over depths-only edges → one component per pocket.
  const parent = new Map<string, string>();
  const depths = map.nodes.filter((n) => isDepths.get(n.id)).map((n) => n.id);
  for (const id of depths) parent.set(id, id);
  const find = (x: string): string => {
    let r = x;
    while (parent.get(r) !== r) r = parent.get(r)!;
    while (parent.get(x) !== r) {
      const next = parent.get(x)!;
      parent.set(x, r);
      x = next;
    }
    return r;
  };
  const byId = new Map(map.nodes.map((n) => [n.id, n]));
  for (const id of depths) {
    for (const nb of byId.get(id)!.neighbors) {
      if (isDepths.get(nb)) parent.set(find(id), find(nb));
    }
  }
  const pockets = new Map<string, Set<string>>();
  for (const id of depths) {
    const root = find(id);
    (pockets.get(root) ?? pockets.set(root, new Set()).get(root)!).add(id);
  }

  const layers: LayerSpec[] = [
    { id: OVERWORLD, nodeIds: overworld, bounds: boundsOf(map, overworld, true) },
  ];
  // Deterministic order: sort pockets by their root id so ids are stable.
  for (const root of [...pockets.keys()].sort()) {
    const ids = pockets.get(root)!;
    layers.push({ id: `pocket:${root}`, nodeIds: ids, bounds: boundsOf(map, ids, false) });
  }
  return layers;
}

/** Map node id → layer id. Nodes not found map to `overworld`. */
export function layerIndex(layers: LayerSpec[]): Map<string, string> {
  const idx = new Map<string, string>();
  for (const l of layers) for (const id of l.nodeIds) idx.set(id, l.id);
  return idx;
}
