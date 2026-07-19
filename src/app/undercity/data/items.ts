/** Shop catalogue (mirrors GEAR / CONSUMABLES in undercity_data.py). */

export interface GearInfo {
  id: string;
  name: string;
  slot: 'fang' | 'carapace' | 'charm';
  tier: 1 | 2 | 3;
  cost: number;
  desc: string;
  /** Stance-rider tag (mirrors GEAR_RIDERS); undefined for plain stat gear. */
  rider?: string;
  /** Flat stat modifiers granted while equipped (mirror GEAR[*] in
   * undercity_data.py — the backend's effective_stats() sums these). */
  atk?: number;
  def?: number;
  spd?: number;
  maxHp?: number;
}

export const GEAR: GearInfo[] = [
  { id: 'rusted_fang', name: 'Rusted Fang', slot: 'fang', tier: 1, cost: 20, rider: 'barbed', atk: 2,
    desc: '+2 ATK · Barbed: Aggress applies rot even on a loss.' },
  { id: 'kraul_barb', name: 'Kraul Barb', slot: 'fang', tier: 2, cost: 45, rider: 'deep_biter', atk: 4,
    desc: '+4 ATK · Deep-biter: winning hits hit harder.' },
  { id: 'wurm_tooth', name: 'Wurm Tooth', slot: 'fang', tier: 3, cost: 80, rider: 'deep_biter', atk: 6, spd: 1,
    desc: '+6 ATK, +1 SPD · Deep-biter: winning hits hit harder.' },
  { id: 'chitin_scrap', name: 'Chitin Scrap', slot: 'carapace', tier: 1, cost: 20, rider: 'thick', def: 2,
    desc: '+2 DEF · Thick: Guard chips in a stall, softer when wrong.' },
  { id: 'bark_hide', name: 'Bark Hide', slot: 'carapace', tier: 2, cost: 45, rider: 'spiked', def: 4,
    desc: '+4 DEF · Spiked: Guard counter reflects extra.' },
  { id: 'troll_hide', name: 'Troll Hide', slot: 'carapace', tier: 3, cost: 80, rider: 'spiked', def: 5, maxHp: 6,
    desc: '+5 DEF, +6 max HP · Spiked: Guard counter reflects extra.' },
  { id: 'quartz_charm', name: 'Quartz Charm', slot: 'charm', tier: 1, cost: 20, rider: 'trickster', spd: 1,
    desc: '+1 SPD · Trickster: a lost Feint isn’t fully punished.' },
  { id: 'serrated_charm', name: 'Serrated Charm', slot: 'charm', tier: 2, cost: 45, rider: 'serrated', spd: 1,
    desc: '+1 SPD · Serrated: Feint break saps the enemy next round.' },
  { id: 'seer_charm', name: 'Seer Charm', slot: 'charm', tier: 2, cost: 50, rider: 'seer', spd: 1,
    desc: '+1 SPD · Seer: sharply raises how often you read the foe’s intent.' },
  { id: 'glint_charm', name: 'Glint Charm', slot: 'charm', tier: 3, cost: 80, rider: 'glint', spd: 2,
    desc: '+2 SPD · Glint: winning a Feint reveals the true next intent; +read rate.' },
];

export interface ConsumableInfo {
  id: string;
  name: string;
  cost: number;
  desc: string;
  /** Material Icons ligature name. */
  icon: string;
  /** Usable during a battle (Plan 2 combat consumables). */
  inBattle?: boolean;
  /** Combat effect kind (reveal | double_punish | negate | auto_win). */
  effect?: string;
}

export const CONSUMABLES: ConsumableInfo[] = [
  { id: 'healing_moss', name: 'Healing Moss', cost: 12, desc: 'Restore 50% max HP.', icon: 'healing' },
  { id: 'smoke_spore', name: 'Smoke Spore', cost: 15, desc: 'Held: your next failed flee auto-succeeds.', icon: 'air' },
  { id: 'loaded_die', name: 'Loaded Die', cost: 25, desc: 'Choose your next roll’s value (1–6).', icon: 'casino' },
  { id: 'snare', name: 'Snare', cost: 18, desc: 'Trap your current space for the next visitor.', icon: 'gps_fixed' },
  { id: 'scrying_spore', name: 'Scrying Spore', cost: 20, icon: 'visibility', inBattle: true,
    effect: 'reveal', desc: 'In battle: reveal the enemy’s true intent this round.' },
  { id: 'rot_bomb', name: 'Rot Bomb', cost: 22, icon: 'coronavirus', inBattle: true,
    effect: 'double_punish', desc: 'In battle: double your damage if you win this round.' },
  { id: 'chitin_ward', name: 'Chitin Ward', cost: 22, icon: 'security', inBattle: true,
    effect: 'negate', desc: 'In battle: cancel the punish from one wrong guess.' },
  { id: 'ambush_musk', name: 'Ambush Musk', cost: 25, icon: 'bolt', inBattle: true,
    effect: 'auto_win', desc: 'In battle: win one exchange regardless of choices.' },
];

export const GEAR_MAP: Record<string, GearInfo> = Object.fromEntries(GEAR.map((g) => [g.id, g]));
export const CONSUMABLE_MAP: Record<string, ConsumableInfo> = Object.fromEntries(
  CONSUMABLES.map((c) => [c.id, c]),
);

/** Pre-spawn Renown shop starter kit (mirrors RENOWN_SHOP_ITEMS in
 * undercity_data.py). One-night items granted into the fresh player at spawn. */
export interface RenownShopItem {
  id: string;
  kind: 'consumable' | 'gear' | 'spores';
  /** Renown cost. */
  cost: number;
  name: string;
  desc: string;
  /** Material Icons ligature. */
  icon: string;
}

export const RENOWN_SHOP_ITEMS: RenownShopItem[] = [
  { id: 'healing_moss', kind: 'consumable', cost: 20, name: 'Healing Moss',
    desc: 'Spawn holding a heal (50% max HP).', icon: 'healing' },
  { id: 'rusted_fang', kind: 'gear', cost: 25, name: 'Rusted Fang',
    desc: 'Spawn with a +2 ATK fang equipped.', icon: 'colorize' },
  { id: 'chitin_scrap', kind: 'gear', cost: 25, name: 'Chitin Scrap',
    desc: 'Spawn with a +2 DEF carapace equipped.', icon: 'shield' },
  { id: 'spore_pouch', kind: 'spores', cost: 15, name: 'Spore Pouch',
    desc: 'Spawn with +15 Spores.', icon: 'grain' },
];

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
  gate: '#ffffff',
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
  golgari_grave_troll: 'landslide',
  wight_of_the_reliquary: 'security',
  gravebound_colossus: 'domain_disabled',
  ishkanah: 'pest_control',
  // v6 dungeon fauna (battle art: undercity/enemies/<id>.png, icon fallback)
  broodling: 'pest_control',
  glowmite: 'flare',
  mire_leech: 'water_drop',
  gravewight: 'skull',
  rot_grub: 'compost',
};

/**
 * Which guardian creature blocks each barrier space — mirrors the backend
 * BARRIER_GUARDIANS ids (undercity_data.py). The board draws this creature
 * standing on a still-sealed barrier (it vanishes once the route is broken).
 * Real art lives at `undercity/guardians/<id>.png` (transparent); if a future
 * guardian ships without art yet, a placeholder token sprite stands in
 * (GUARDIAN_PLACEHOLDER_SPRITE).
 */
export const BARRIER_GUARDIANS: Record<string, string> = {
  bar_e: 'golgari_grave_troll',
  bar_s: 'wight_of_the_reliquary',
};

/** Guardian shown when a barrier node isn't in the map above. */
export const DEFAULT_GUARDIAN = 'golgari_grave_troll';

/**
 * Placeholder token sprite per guardian (keys index FORM_SPRITES sprite assets,
 * already preloaded) until real transparent guardian art is dropped in.
 */
export const GUARDIAN_PLACEHOLDER_SPRITE: Record<string, string> = {
  golgari_grave_troll: 'godzilla',
  wight_of_the_reliquary: 'pachy',
};

/** Fallback placeholder sprite for any guardian without a specific mapping. */
export const DEFAULT_GUARDIAN_SPRITE = 'godzilla';

/** One-line "what does this space do" blurbs for the board popover. */
export const SPACE_BLURBS: Record<string, string> = {
  loot: 'Rustle through the tall grass for Spores — sometimes a buried consumable.',
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
  loot: 'Spore Mound',
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
