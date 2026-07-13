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
  /** Material Icons ligature name. */
  icon: string;
}

export const CONSUMABLES: ConsumableInfo[] = [
  { id: 'healing_moss', name: 'Healing Moss', cost: 12, desc: 'Restore 50% max HP.', icon: 'healing' },
  { id: 'smoke_spore', name: 'Smoke Spore', cost: 15, desc: 'Held: your next failed flee auto-succeeds.', icon: 'air' },
  { id: 'loaded_die', name: 'Loaded Die', cost: 25, desc: 'Choose your next roll’s value (1–6).', icon: 'casino' },
  { id: 'snare', name: 'Snare', cost: 18, desc: 'Trap your current space for the next visitor.', icon: 'gps_fixed' },
];

export const GEAR_MAP: Record<string, GearInfo> = Object.fromEntries(GEAR.map((g) => [g.id, g]));
export const CONSUMABLE_MAP: Record<string, ConsumableInfo> = Object.fromEntries(
  CONSUMABLES.map((c) => [c.id, c]),
);

/** Material Icons ligature per space type — used in templates AND drawn onto the board canvas. */
export const SPACE_ICONS: Record<string, string> = {
  loot: 'grass',
  wild: 'bug_report',
  elite: 'dangerous',
  mystery: 'help',
  shop: 'storefront',
  trading_post: 'swap_horiz',
  excavation: 'grid_view',
  crystal_vein: 'diamond',
  vault_lock: 'dialpad',
  shrine: 'local_fire_department',
  hazard: 'warning',
  warp: 'cyclone',
  gate: 'home',
  boss: 'visibility',
  ossuary: 'casino',
  barrier: 'lock',
  lair: 'skull',
  vault: 'vpn_key',
  cache: 'inventory_2',
  ladder: 'stairs',
  // Event-only types (never drawn on the board)
  wild_warp: 'cyclone',
  boss_sealed: 'visibility_off',
  snare: 'gps_fixed',
  pile: 'grain',
  barrier_open: 'lock_open',
};

/** Accent color per space/event type — mirrors the board's coin-disc colors. */
export const SPACE_TINTS: Record<string, string> = {
  loot: '#3f6f3f',
  wild: '#7a3030',
  elite: '#5c1f2e',
  mystery: '#5b4a8a',
  shop: '#8a6a2f',
  trading_post: '#5a7a5a',
  excavation: '#9a7b48',
  crystal_vein: '#3a7a8a',
  vault_lock: '#7a5a2f',
  shrine: '#9a7a3a',
  hazard: '#4a5568',
  warp: '#2f7a7a',
  gate: '#4a7c59',
  boss: '#2a1a30',
  ossuary: '#6b5b4a',
  wild_warp: '#7a3030',
  boss_sealed: '#2a1a30',
  snare: '#6b4a2f',
  pile: '#3f6f3f',
  barrier: '#8a5040',
  barrier_open: '#8a5040',
  lair: '#96304e',
  vault: '#c8a53e',
  cache: '#c8a53e',
  ladder: '#527a8a',
};

/** Material Icons ligature per wild NPC. */
export const NPC_ICONS: Record<string, string> = {
  drudge_beetle: 'bug_report',
  sewer_shambler: 'blur_on',
  myconid: 'grain',
  fetid_imp: 'whatshot',
  rot_shambler: 'coronavirus',
  // v3 guardians & mini-bosses
  rubble_hulk: 'landslide',
  bone_warden: 'security',
  gravebound_colossus: 'domain_disabled',
  broodmother: 'pest_control',
  // v6 dungeon fauna (battle art: undercity/enemies/<id>.png, icon fallback)
  broodling: 'pest_control',
  glowmite: 'flare',
  mire_leech: 'water_drop',
  gravewight: 'skull',
  rot_grub: 'compost',
};

/** One-line "what does this space do" blurbs for the board popover. */
export const SPACE_BLURBS: Record<string, string> = {
  loot: 'Forage the rot for Spores — sometimes a buried consumable.',
  wild: 'A wild creature lurks here. Beat it for XP and a Spore bounty.',
  elite: 'An elite predator claims this ground. Rich XP and Spores — but a death sentence for fresh hatchlings.',
  mystery: 'Roll the d12 mystery table — fortune, junk, or misfortune.',
  shop: 'Buy gear and consumables for Spores.',
  trading_post: 'Swap one of your consumables for one left here by another player.',
  excavation: 'A dig site — reveal grid cells to unearth buried items. 3 digs per visit.',
  crystal_vein:
    'A shared mineshaft — every strike digs the whole region deeper. Loot and cave-in risk climb together. First swing is mandatory; 3 per visit.',
  vault_lock:
    'The Guildvault: crack the hidden 3-sigil combination. Every failed pick is public intel on the wall — and fattens the pot. 3 picks per visit.',
  shrine: 'Pay 15 Spores for a blessing — or tithe your own blood for XP.',
  hazard: 'Swamp gas, grasping vines, or choking spore clouds. It will cost you.',
  warp: 'A warp mushroom — step through to another cap, if it behaves.',
  gate: 'The Gate of the Swarm. Entering mends you fully.',
  boss: 'The sealed boss lair. The Swarm stirs behind it.',
  ossuary: 'Serious Fun. Call high or low on the bone die — a win doubles your bet.',
  barrier: 'A guardian seals this passage. Beat it and the route opens for everyone.',
  lair: 'A mini-boss den. Your first kill pays a huge bounty; repeats pay small.',
  vault: 'A treasure hoard, deep behind a barrier. First visit pays big — once.',
  cache: 'A stashed treasure — a rich first-visit payout for every explorer.',
  ladder: 'A rusted ladder between the surface and the dungeon below.',
};

export const SPACE_NAMES: Record<string, string> = {
  loot: 'Loot Cache',
  wild: 'Wild Encounter',
  elite: 'Elite Encounter',
  mystery: 'Mystery',
  shop: 'Rot-Farm Bazaar',
  trading_post: 'Trading Post',
  excavation: 'Dig Site',
  crystal_vein: 'Crystal Vein',
  vault_lock: 'Guildvault Lock',
  shrine: 'Shrine',
  hazard: 'Hazard',
  warp: 'Warp Mushroom',
  gate: 'Gate of the Swarm',
  boss: 'Boss Lair',
  ossuary: 'The Ossuary',
  wild_warp: 'Wild Warp!',
  boss_sealed: 'The Sealed Lair',
  snare: 'Snare!',
  pile: 'Spilled Spores',
  barrier: 'Sealed Barrier',
  barrier_open: 'Broken Barrier',
  lair: 'Monster Lair',
  vault: 'The Sunken Vault',
  cache: 'Hidden Trove',
  ladder: 'Rusted Ladder',
};
