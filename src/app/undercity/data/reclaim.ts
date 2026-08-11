/**
 * Display mirror of the Grime Gorger's Gorge/Reclaim tables (undercity_config.py
 * is the source of truth). The governing rule: a player may change what a space
 * DOES, never what the map IS — so topology (gates, warps, ladders, tunnels,
 * barriers) and unique landmarks (vault, shrine, witch, ossuary, boss) appear in
 * neither list below.
 */

/** Mulch price of creating each space type. */
export const RECLAIM_PRICES: Record<string, number> = {
  wild: 4,
  mystery: 6,
  loot: 10,
  elite: 12,
  cache: 14,
  rest: 18,
  crystal_vein: 24,
  excavation: 24,
  trove: 30,
  shop: 60,
};

/** Space types that may be overwritten. `hazard` is here but NOT in the price
 *  list: the Gorger eats filth, it does not spread it. `crystal_vein`,
 *  `excavation` and `shop` are the reverse — creatable, never overwritable. */
export const RECLAIM_SOURCES: ReadonlySet<string> = new Set([
  'wild',
  'hazard',
  'fog',
  'loot',
  'mystery',
  'cache',
  'trove',
  'rest',
  'elite',
]);

/** Buildable only outside the depths — a descent's tension is committing without
 *  resupply, and each rest node is one full heal per descent. */
export const RECLAIM_SURFACE_ONLY: ReadonlySet<string> = new Set(['rest', 'shop']);

export const RECLAIM_MAX_CLAIMS = 3;

export const RECLAIM_LABELS: Record<string, string> = {
  wild: 'Vermin Den',
  mystery: 'Strange Ground',
  loot: 'Forage Ground',
  elite: 'Predator Ground',
  cache: 'Hollow Cache',
  rest: 'Rest Alcove',
  crystal_vein: 'Crystal Vein',
  excavation: 'Dig Site',
  trove: 'Hidden Trove',
  shop: 'Bazaar Post',
};

/** Mulch yielded by devouring an item, by kind and rarity tier (1-4). Gear is
 *  worth double a consumable of the same rarity, matching the price tables. */
export const GORGE_MULCH: Record<'gear' | 'consumable', Record<number, number>> = {
  gear: { 1: 2, 2: 4, 3: 6, 4: 8 },
  consumable: { 1: 1, 2: 2, 3: 3, 4: 4 },
};
