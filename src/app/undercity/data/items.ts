/** Shop catalogue (mirrors GEAR / CONSUMABLES in undercity_data.py). */

export interface GearInfo {
  id: string;
  name: string;
  slot: 'fang' | 'carapace';
  tier: 1 | 2 | 3;
  cost: number;
  desc: string;
}

export const GEAR: GearInfo[] = [
  { id: 'rusted_fang', name: 'Rusted Fang', slot: 'fang', tier: 1, cost: 20, desc: '+2 ATK' },
  { id: 'kraul_barb', name: 'Kraul Barb', slot: 'fang', tier: 2, cost: 45, desc: '+4 ATK' },
  { id: 'wurm_tooth', name: 'Wurm Tooth', slot: 'fang', tier: 3, cost: 80, desc: '+6 ATK, +1 SPD' },
  { id: 'chitin_scrap', name: 'Chitin Scrap', slot: 'carapace', tier: 1, cost: 20, desc: '+2 DEF' },
  { id: 'bark_hide', name: 'Bark Hide', slot: 'carapace', tier: 2, cost: 45, desc: '+4 DEF' },
  { id: 'troll_hide', name: 'Troll Hide', slot: 'carapace', tier: 3, cost: 80, desc: '+5 DEF, +6 max HP' },
];

export interface ConsumableInfo {
  id: string;
  name: string;
  cost: number;
  desc: string;
  emoji: string;
}

export const CONSUMABLES: ConsumableInfo[] = [
  { id: 'healing_moss', name: 'Healing Moss', cost: 12, desc: 'Restore 50% max HP.', emoji: '🌿' },
  { id: 'smoke_spore', name: 'Smoke Spore', cost: 15, desc: 'Held: your next failed flee auto-succeeds.', emoji: '💨' },
  { id: 'loaded_die', name: 'Loaded Die', cost: 25, desc: 'Choose your next roll’s value (1–6).', emoji: '🎲' },
  { id: 'snare', name: 'Snare', cost: 18, desc: 'Trap your current space for the next visitor.', emoji: '🪤' },
];

export const GEAR_MAP: Record<string, GearInfo> = Object.fromEntries(GEAR.map((g) => [g.id, g]));
export const CONSUMABLE_MAP: Record<string, ConsumableInfo> = Object.fromEntries(
  CONSUMABLES.map((c) => [c.id, c]),
);

export const SPACE_GLYPHS: Record<string, string> = {
  loot: '🍄',
  wild: '⚔️',
  mystery: '❓',
  shop: '🏪',
  shrine: '🕯️',
  hazard: '☠️',
  warp: '🌀',
  gate: '🐌',
  boss: '👁️',
  ossuary: '🎲',
};

export const SPACE_NAMES: Record<string, string> = {
  loot: 'Loot Cache',
  wild: 'Wild Encounter',
  mystery: 'Mystery',
  shop: 'Rot-Farm Bazaar',
  shrine: 'Shrine',
  hazard: 'Hazard',
  warp: 'Warp Mushroom',
  gate: 'Gate of the Swarm',
  boss: 'Boss Lair',
  ossuary: 'The Ossuary',
};
