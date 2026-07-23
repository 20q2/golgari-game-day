/** Shop catalogue (mirrors GEAR / CONSUMABLES in undercity_data.py). */

import { SPELL_MAP } from './spells';

export interface GearInfo {
  id: string;
  name: string;
  slot: 'fang' | 'carapace' | 'charm';
  tier: 1 | 2 | 3 | 4;
  cost: number;
  desc: string;
  /** Stance-rider tag (mirrors GEAR_RIDERS); undefined for plain stat gear. */
  rider?: string;
  /** Illuminating gear: 'full' reveals the whole dungeon while equipped
   * (mirrors GEAR[*].light). The fog reveal is derived client-side. */
  light?: 'full';
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
  { id: 'bloodfang', name: 'Bloodfang', slot: 'fang', tier: 1, cost: 25, rider: 'bloodfang', atk: 2,
    desc: '+2 ATK · Bloodfang: heal 40% of your winning Aggress damage.' },
  { id: 'kraul_barb', name: 'Kraul Barb', slot: 'fang', tier: 2, cost: 45, rider: 'deep_biter', atk: 4,
    desc: '+4 ATK · Deep-biter: winning hits hit harder.' },
  { id: 'rabid_fang', name: 'Rabid Fang', slot: 'fang', tier: 2, cost: 48, rider: 'rabid', atk: 3, spd: 1,
    desc: '+3 ATK, +1 SPD · Rabid: each Aggress win, your Aggress hits gain +2 for the fight.' },
  { id: 'gutcleaver', name: 'Gutcleaver', slot: 'fang', tier: 2, cost: 50, rider: 'gutcleaver', atk: 4,
    desc: '+4 ATK · Gutcleaver: winning Aggress vs a foe below 30% HP deals +50%.' },
  { id: 'wurm_tooth', name: 'Wurm Tooth', slot: 'fang', tier: 3, cost: 80, rider: 'deep_biter', atk: 6, spd: 1,
    desc: '+6 ATK, +1 SPD · Deep-biter: winning hits hit harder.' },
  { id: 'ravening_maw', name: 'Ravening Maw', slot: 'fang', tier: 3, cost: 85, rider: 'rabid', atk: 5, spd: 1,
    desc: '+5 ATK, +1 SPD · Rabid: each Aggress win, your Aggress hits gain +3 for the fight.' },
  // Fang — new rarity rungs (complete the barbed/bloodfang/deep_biter/rabid/gutcleaver ladders)
  { id: 'cutter_fang', name: 'Cutter Fang', slot: 'fang', tier: 1, cost: 22, rider: 'deep_biter', atk: 2,
    desc: '+2 ATK · Deep-biter: winning hits hit harder.' },
  { id: 'feral_nip', name: 'Feral Nip', slot: 'fang', tier: 1, cost: 23, rider: 'rabid', atk: 2,
    desc: '+2 ATK · Rabid: each Aggress win, your Aggress hits gain +1 for the fight.' },
  { id: 'notched_cleaver', name: 'Notched Cleaver', slot: 'fang', tier: 1, cost: 24, rider: 'gutcleaver', atk: 2,
    desc: '+2 ATK · Gutcleaver: winning Aggress vs a foe below 30% HP deals +35%.' },
  { id: 'serpent_fang', name: 'Serpent Fang', slot: 'fang', tier: 2, cost: 46, rider: 'barbed', atk: 4,
    desc: '+4 ATK · Barbed: Aggress applies rot even on a loss.' },
  { id: 'sanguine_fang', name: 'Sanguine Fang', slot: 'fang', tier: 2, cost: 47, rider: 'bloodfang', atk: 4,
    desc: '+4 ATK · Bloodfang: heal 50% of your winning Aggress damage.' },
  { id: 'wyrm_venomtooth', name: 'Wyrm Venomtooth', slot: 'fang', tier: 3, cost: 82, rider: 'barbed', atk: 6, spd: 1,
    desc: '+6 ATK, +1 SPD · Barbed: Aggress applies rot even on a loss.' },
  { id: 'vampiric_maw', name: 'Vampiric Maw', slot: 'fang', tier: 3, cost: 83, rider: 'bloodfang', atk: 6, spd: 1,
    desc: '+6 ATK, +1 SPD · Bloodfang: heal 60% of your winning Aggress damage.' },
  { id: 'gravecleaver', name: 'Gravecleaver', slot: 'fang', tier: 3, cost: 84, rider: 'gutcleaver', atk: 6,
    desc: '+6 ATK · Gutcleaver: winning Aggress vs a foe below 30% HP deals +70%.' },
  { id: 'chitin_scrap', name: 'Chitin Scrap', slot: 'carapace', tier: 1, cost: 20, rider: 'thick', def: 2,
    desc: '+2 DEF · Thick: Guard chips in a stall, softer when wrong.' },
  { id: 'bramble_hide', name: 'Bramble Hide', slot: 'carapace', tier: 1, cost: 25, rider: 'bramble', def: 2,
    desc: '+2 DEF · Bramble: reflect 2 damage whenever you are struck.' },
  { id: 'bark_hide', name: 'Bark Hide', slot: 'carapace', tier: 2, cost: 45, rider: 'spiked', def: 4,
    desc: '+4 DEF · Spiked: Guard counter hits +50% harder.' },
  { id: 'bulwark_plate', name: 'Bulwark Plate', slot: 'carapace', tier: 2, cost: 48, rider: 'bulwark', def: 3, maxHp: 3,
    desc: '+3 DEF, +3 max HP · Bulwark: each round you Guard, +1 DEF for the fight.' },
  { id: 'mossback', name: 'Mossback', slot: 'carapace', tier: 2, cost: 50, rider: 'mossback', def: 3,
    desc: '+3 DEF · Mossback: heal 3 each round you end in Guard.' },
  { id: 'troll_hide', name: 'Troll Hide', slot: 'carapace', tier: 3, cost: 80, rider: 'spiked', def: 5, maxHp: 6,
    desc: '+5 DEF, +6 max HP · Spiked: Guard counter hits +80% harder.' },
  { id: 'ironshell_bulwark', name: 'Ironshell Bulwark', slot: 'carapace', tier: 3, cost: 85, rider: 'bulwark', def: 5, maxHp: 6,
    desc: '+5 DEF, +6 max HP · Bulwark: each round you Guard, +2 DEF for the fight.' },
  // Carapace — new rarity rungs (complete the thick/bramble/spiked/bulwark/mossback ladders)
  { id: 'thornscrap_hide', name: 'Thornscrap Hide', slot: 'carapace', tier: 1, cost: 22, rider: 'spiked', def: 2,
    desc: '+2 DEF · Spiked: Guard counter hits +30% harder.' },
  { id: 'barricade_shell', name: 'Barricade Shell', slot: 'carapace', tier: 1, cost: 23, rider: 'bulwark', def: 2,
    desc: '+2 DEF · Bulwark: each round you Guard, +1 DEF for the fight.' },
  { id: 'mossling_hide', name: 'Mossling Hide', slot: 'carapace', tier: 1, cost: 24, rider: 'mossback', def: 2,
    desc: '+2 DEF · Mossback: heal 2 each round you end in Guard.' },
  { id: 'ridged_carapace', name: 'Ridged Carapace', slot: 'carapace', tier: 2, cost: 46, rider: 'thick', def: 4,
    desc: '+4 DEF · Thick: Guard chips in a stall, softer when wrong.' },
  { id: 'bramble_carapace', name: 'Bramble Carapace', slot: 'carapace', tier: 2, cost: 47, rider: 'bramble', def: 4,
    desc: '+4 DEF · Bramble: reflect 3 damage whenever you are struck.' },
  { id: 'colossus_shell', name: 'Colossus Shell', slot: 'carapace', tier: 3, cost: 82, rider: 'thick', def: 5, maxHp: 6,
    desc: '+5 DEF, +6 max HP · Thick: Guard chips in a stall, softer when wrong.' },
  { id: 'bramble_aegis', name: 'Bramble Aegis', slot: 'carapace', tier: 3, cost: 83, rider: 'bramble', def: 5, maxHp: 6,
    desc: '+5 DEF, +6 max HP · Bramble: reflect 4 damage whenever you are struck.' },
  { id: 'overgrown_bulwark', name: 'Overgrown Bulwark', slot: 'carapace', tier: 3, cost: 84, rider: 'mossback', def: 5, maxHp: 6,
    desc: '+5 DEF, +6 max HP · Mossback: heal 4 each round you end in Guard.' },
  { id: 'bloatsac_plate', name: 'Bloatsac Plate', slot: 'carapace', tier: 1, cost: 22, maxHp: 6,
    desc: '+6 max HP.' },
  { id: 'engorged_carapace', name: 'Engorged Carapace', slot: 'carapace', tier: 2, cost: 46, maxHp: 12, def: 1,
    desc: '+12 max HP, +1 DEF.' },
  { id: 'leviathan_hide', name: 'Leviathan Hide', slot: 'carapace', tier: 3, cost: 82, maxHp: 20, def: 2,
    desc: '+20 max HP, +2 DEF.' },
  { id: 'quartz_charm', name: 'Quartz Charm', slot: 'charm', tier: 1, cost: 20, rider: 'trickster', spd: 1,
    desc: '+1 SPD · Trickster: a lost Feint punishes 50% less.' },
  { id: 'venom_charm', name: 'Venom Charm', slot: 'charm', tier: 1, cost: 25, rider: 'venomtrick', spd: 1,
    desc: '+1 SPD · Venomtrick: winning a Feint applies 1 rot.' },
  { id: 'serrated_charm', name: 'Serrated Charm', slot: 'charm', tier: 2, cost: 45, rider: 'serrated', spd: 1,
    desc: '+1 SPD · Serrated: a winning Feint saps 2 from the foe’s next-round damage.' },
  { id: 'seer_charm', name: 'Seer Charm', slot: 'charm', tier: 2, cost: 50, rider: 'seer', spd: 1,
    desc: '+1 SPD · Seer: sharply raises how often you read the foe’s intent.' },
  { id: 'cutpurse_charm', name: 'Cutpurse Charm', slot: 'charm', tier: 2, cost: 48, rider: 'cutpurse', spd: 1,
    desc: '+1 SPD · Cutpurse: land a winning Feint for +6 Spores after a win.' },
  { id: 'glint_charm', name: 'Glint Charm', slot: 'charm', tier: 3, cost: 80, rider: 'glint', spd: 2,
    desc: '+2 SPD · Glint: winning a Feint reveals the true next intent; +read rate.' },
  // Charm — new rarity rungs (complete the trickster/venomtrick/serrated/seer/cutpurse/glint ladders)
  { id: 'chipped_charm', name: 'Chipped Charm', slot: 'charm', tier: 1, cost: 22, rider: 'serrated', spd: 1,
    desc: '+1 SPD · Serrated: a winning Feint saps 1 from the foe’s next-round damage.' },
  { id: 'pickpocket_charm', name: 'Pickpocket Charm', slot: 'charm', tier: 1, cost: 23, rider: 'cutpurse', spd: 1,
    desc: '+1 SPD · Cutpurse: land a winning Feint for +4 Spores after a win.' },
  { id: 'glass_eye', name: 'Glass Eye', slot: 'charm', tier: 1, cost: 24, rider: 'seer', spd: 1,
    desc: '+1 SPD · Seer: raises how often you read the foe’s intent.' },
  { id: 'glimmer_charm', name: 'Glimmer Charm', slot: 'charm', tier: 1, cost: 24, rider: 'glint', spd: 1,
    desc: '+1 SPD · Glint: winning a Feint reveals the true next intent; +read rate.' },
  { id: 'jesters_charm', name: 'Jester’s Charm', slot: 'charm', tier: 2, cost: 46, rider: 'trickster', spd: 1,
    desc: '+1 SPD · Trickster: a lost Feint punishes 60% less.' },
  { id: 'toxin_charm', name: 'Toxin Charm', slot: 'charm', tier: 2, cost: 47, rider: 'venomtrick', spd: 1,
    desc: '+1 SPD · Venomtrick: winning a Feint applies 2 rot.' },
  { id: 'gleam_charm', name: 'Gleam Charm', slot: 'charm', tier: 2, cost: 50, rider: 'glint', spd: 1,
    desc: '+1 SPD · Glint: winning a Feint reveals the true next intent; +read rate.' },
  { id: 'tricksters_idol', name: 'Trickster’s Idol', slot: 'charm', tier: 3, cost: 82, rider: 'trickster', spd: 2,
    desc: '+2 SPD · Trickster: a lost Feint punishes 70% less.' },
  { id: 'toxin_idol', name: 'Plaguebloom Idol', slot: 'charm', tier: 3, cost: 83, rider: 'venomtrick', spd: 2,
    desc: '+2 SPD · Venomtrick: winning a Feint applies 3 rot.' },
  { id: 'lacerating_idol', name: 'Lacerating Idol', slot: 'charm', tier: 3, cost: 82, rider: 'serrated', spd: 2,
    desc: '+2 SPD · Serrated: a winning Feint saps 3 from the foe’s next-round damage.' },
  { id: 'oracles_idol', name: 'Oracle’s Idol', slot: 'charm', tier: 3, cost: 82, rider: 'seer', spd: 2,
    desc: '+2 SPD · Seer: sharply raises how often you read the foe’s intent.' },
  { id: 'brigands_idol', name: 'Brigand’s Idol', slot: 'charm', tier: 3, cost: 82, rider: 'cutpurse', spd: 2,
    desc: '+2 SPD · Cutpurse: land a winning Feint for +9 Spores after a win.' },
  // Illuminating gear — light OR power. Reveals the whole dungeon while equipped,
  // but carries almost no combat: a gear slot spent on total information.
  { id: 'torchfang', name: 'Torchfang', slot: 'fang', tier: 1, cost: 30, atk: 1, light: 'full',
    desc: '+1 ATK · Illuminated: reveals the entire dungeon while equipped.' },
  { id: 'glowspore_charm', name: 'Glowspore Charm', slot: 'charm', tier: 1, cost: 30, light: 'full',
    desc: 'Bioluminescent: reveals the entire dungeon while equipped.' },
  // Mythic (tier 4) — craft-only; forge a Legendary at the Blacksmith for 3 Chrysalis Ichor.
  { id: 'wyrm_godtooth', name: 'Wyrm Godtooth', slot: 'fang', tier: 4, cost: 150, rider: 'barbed', atk: 8, spd: 1,
    desc: '+8 ATK, +1 SPD · Barbed: Aggress applies rot even on a loss.' },
  { id: 'sanguine_leviathan', name: 'Sanguine Leviathan', slot: 'fang', tier: 4, cost: 150, rider: 'bloodfang', atk: 8, spd: 1,
    desc: '+8 ATK, +1 SPD · Bloodfang: heal 70% of your winning Aggress damage.' },
  { id: 'worldrender_maw', name: 'Worldrender Maw', slot: 'fang', tier: 4, cost: 150, rider: 'deep_biter', atk: 8, spd: 1,
    desc: '+8 ATK, +1 SPD · Deep-biter: winning hits hit much harder.' },
  { id: 'apex_ravener', name: 'Apex Ravener', slot: 'fang', tier: 4, cost: 150, rider: 'rabid', atk: 7, spd: 2,
    desc: '+7 ATK, +2 SPD · Rabid: each Aggress win, your Aggress hits gain +4 for the fight.' },
  { id: 'worldcleaver', name: 'Worldcleaver', slot: 'fang', tier: 4, cost: 150, rider: 'gutcleaver', atk: 8,
    desc: '+8 ATK · Gutcleaver: winning Aggress vs a foe below 30% HP deals +90%.' },
  { id: 'titan_carapace', name: 'Titan Carapace', slot: 'carapace', tier: 4, cost: 150, rider: 'thick', def: 6, maxHp: 8,
    desc: '+6 DEF, +8 max HP · Thick: Guard chips in a stall, softer when wrong.' },
  { id: 'thornlord_aegis', name: 'Thornlord Aegis', slot: 'carapace', tier: 4, cost: 150, rider: 'bramble', def: 6, maxHp: 8,
    desc: '+6 DEF, +8 max HP · Bramble: reflect 5 damage whenever you are struck.' },
  { id: 'wyrmscale_wall', name: 'Wyrmscale Wall', slot: 'carapace', tier: 4, cost: 150, rider: 'spiked', def: 6, maxHp: 8,
    desc: '+6 DEF, +8 max HP · Spiked: Guard counter hits +100% harder.' },
  { id: 'adamant_bulwark', name: 'Adamant Bulwark', slot: 'carapace', tier: 4, cost: 150, rider: 'bulwark', def: 6, maxHp: 8,
    desc: '+6 DEF, +8 max HP · Bulwark: each round you Guard, +3 DEF for the fight.' },
  { id: 'ancient_grove_shell', name: 'Ancient Grove Shell', slot: 'carapace', tier: 4, cost: 150, rider: 'mossback', def: 6, maxHp: 8,
    desc: '+6 DEF, +8 max HP · Mossback: heal 5 each round you end in Guard.' },
  { id: 'godtrickster_idol', name: 'Godtrickster’s Idol', slot: 'charm', tier: 4, cost: 150, rider: 'trickster', spd: 3,
    desc: '+3 SPD · Trickster: a lost Feint punishes 80% less.' },
  { id: 'plaguelord_idol', name: 'Plaguelord Idol', slot: 'charm', tier: 4, cost: 150, rider: 'venomtrick', spd: 2,
    desc: '+2 SPD · Venomtrick: winning a Feint applies 4 rot.' },
  { id: 'eviscerator_idol', name: 'Eviscerator Idol', slot: 'charm', tier: 4, cost: 150, rider: 'serrated', spd: 2,
    desc: '+2 SPD · Serrated: a winning Feint saps 4 from the foe’s next-round damage.' },
  { id: 'allseeing_idol', name: 'All-Seeing Idol', slot: 'charm', tier: 4, cost: 150, rider: 'seer', spd: 2,
    desc: '+2 SPD · Seer: overwhelmingly raises how often you read the foe’s intent.' },
  { id: 'kingpin_idol', name: 'Kingpin Idol', slot: 'charm', tier: 4, cost: 150, rider: 'cutpurse', spd: 3,
    desc: '+3 SPD · Cutpurse: land a winning Feint for +12 Spores after a win.' },
  { id: 'prism_idol', name: 'Prism Idol', slot: 'charm', tier: 4, cost: 150, rider: 'glint', spd: 2,
    desc: '+2 SPD · Glint: winning a Feint reveals the true next intent; ++read rate.' },
];

/** Gear rarity, derived from tier (mirrors the server: tier IS the rarity). */
export type Rarity = 'common' | 'rare' | 'legendary' | 'mythic';

export interface RarityInfo {
  key: Rarity;
  label: string;
}

const RARITY_BY_TIER: Record<number, RarityInfo> = {
  1: { key: 'common', label: 'Common' },
  2: { key: 'rare', label: 'Rare' },
  3: { key: 'legendary', label: 'Legendary' },
  4: { key: 'mythic', label: 'Mythic' },
};

/** Map a gear tier (1/2/3) to its rarity name/key. Defaults to Common. */
export function tierRarity(tier: number): RarityInfo {
  return RARITY_BY_TIER[tier] ?? RARITY_BY_TIER[1];
}

// ── Forge economy mirrors (undercity_data.GEAR_FAMILY + undercity_config knobs) ──

/** Effect-family rungs: rider -> { tier: gearId }. Mirrors GEAR_FAMILY. */
export const GEAR_FAMILY: Record<string, Record<number, string>> = (() => {
  const fam: Record<string, Record<number, string>> = {};
  for (const g of GEAR) {
    if (g.rider) (fam[g.rider] ??= {})[g.tier] = g.id;
  }
  return fam;
})();

/** The next rarity rung up for a gear id, or null if Legendary / unupgradeable. */
export function nextRung(id: string): string | null {
  const g = GEAR.find((x) => x.id === id);
  if (!g || !g.rider) return null;
  return GEAR_FAMILY[g.rider]?.[g.tier + 1] ?? null;
}

/** Blacksmith upgrade cost to reach a tier (mirrors UPGRADE_SPORES/MOLTINGS/ICHOR). */
export const UPGRADE_COST: Record<number, { spores: number; moltings: number; ichor: number }> = {
  2: { spores: 40, moltings: 3, ichor: 0 },
  3: { spores: 80, moltings: 6, ichor: 1 },
  4: { spores: 150, moltings: 0, ichor: 3 },
};

/** Salvage Yard grind yield by rarity (mirrors SALVAGE_MOLTINGS / SALVAGE_ICHOR). */
export const SALVAGE_YIELD: Record<number, { moltings: number; ichor: number }> = {
  1: { moltings: 1, ichor: 0 },
  2: { moltings: 2, ichor: 0 },
  3: { moltings: 4, ichor: 1 },
  4: { moltings: 6, ichor: 1 },
};

/** Player Market price band for a gear id (mirrors MARKET_PRICE_MIN/MAX_PCT). */
export const MARKET_PRICE_MIN_PCT = 0.5;
export const MARKET_PRICE_MAX_PCT = 2.0;
export function marketPriceBand(gid: string): { lo: number; hi: number } {
  const cost = GEAR.find((x) => x.id === gid)?.cost ?? 0;
  const lo = Math.max(1, Math.floor(cost * MARKET_PRICE_MIN_PCT));
  const hi = Math.max(lo, Math.floor(cost * MARKET_PRICE_MAX_PCT));
  return { lo, hi };
}

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
  // Listed in the battle item tray, but `effect: 'reveal'` makes it act on tap
  // (fires the `combat-peek` action) instead of arming for the next stance like
  // the three below — the battle component special-cases it.
  { id: 'scrying_spore', name: 'Scrying Spore', cost: 20, icon: 'visibility',
    effect: 'reveal', inBattle: true, desc: 'In battle: reveal the enemy’s true intent this round.' },
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

/** Scroll base cost by spell tier (mirrors INSCRIBE_COST in undercity_config.py). */
export const INSCRIBE_COST: Record<number, number> = { 1: 10, 2: 20, 3: 30 };

export type MarketKind = 'gear' | 'consumable' | 'scroll';

/** Base cost a market price band is derived from, per kind (mirrors _MARKET_KINDS). */
export function marketItemCost(kind: MarketKind, id: string): number {
  if (kind === 'consumable') return CONSUMABLE_MAP[id]?.cost ?? 0;
  if (kind === 'scroll') return INSCRIBE_COST[SPELL_MAP[id]?.tier ?? 1] ?? 0;
  return GEAR_MAP[id]?.cost ?? 0;
}

/** Allowed Spore price band for any listable item (mirrors _market_price_band). */
export function marketBand(kind: MarketKind, id: string): { lo: number; hi: number } {
  const cost = marketItemCost(kind, id);
  const lo = Math.max(1, Math.floor(cost * MARKET_PRICE_MIN_PCT));
  const hi = Math.max(lo, Math.floor(cost * MARKET_PRICE_MAX_PCT));
  return { lo, hi };
}

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
  witch: 'auto_fix_high',
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
  rest: 'hotel',
  trove: 'auto_awesome',
  tunnel: 'route',
  world_event: 'pest_control_rodent',
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
  witch: '#5c2a5c',
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
  rest: '#c0703a',
  trove: '#d8b24a',
  tunnel: '#6b5836',
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

/**
 * Which boss lurks behind each lair space — mirrors LAIR_BOSSES ids
 * (undercity_data.py). Drawn pacing behind the lair; art at
 * undercity/guardians/<id>.png with the same placeholder fallback as barriers.
 */
export const LAIR_GUARDIANS: Record<string, string> = {
  lair_titan: 'gravebound_colossus',
  city_lair: 'ishkanah',
  cavern_lair: 'sarulf',
  bog_lair: 'gitrog_monster',
  bone_lair: 'skullbriar',
  garden_lair: 'slimefoot',
};

/** One-line "what does this space do" blurbs for the board popover. */
export const SPACE_BLURBS: Record<string, string> = {
  loot: 'Rustle through the tall grass for Spores — sometimes a buried consumable.',
  wild: 'A wild creature lurks here. Beat it for XP and a Spore bounty. Beatable from Level 1+.',
  elite: 'An elite predator claims this ground. Rich XP and Spores — but a death sentence for fresh hatchlings. We recommend Level 3+ before you fight one.',
  mystery: 'Roll the d12 mystery table — fortune, junk, or misfortune.',
  shop: 'Buy gear and consumables for Spores.',
  trading_post: 'Swap one of your consumables for one left here by another player.',
  excavation: 'A dig site — buried finds show through the dirt; dig out each one to claim it. 4 digs per visit.',
  crystal_vein:
    'A shared mineshaft — every strike digs the whole region deeper. Loot and cave-in risk climb together. First swing is mandatory; 3 per visit.',
  vault_lock:
    'The Guildvault: crack the hidden 3-sigil combination. Every failed pick is public intel on the wall — and fattens the pot. 3 picks per visit.',
  shrine: 'Spend 15 Spores for a lasting blessing: +1 ATK, DEF, or SPD, or a full heal.',
  witch: 'The Sedgemoor Witch inscribes scrolls into your grimoire — and sells tier-I scrolls for Spores.',
  hazard: 'Swamp gas, grasping vines, or choking spore clouds. It will cost you.',
  warp: 'A warp mushroom — step through to another cap, if it behaves.',
  gate: 'The Gate of the Swarm. Entering mends you fully.',
  boss: 'The sealed boss lair. The Swarm stirs behind it. Savra is a brutal fight — be Level 10+ before you take her on.',
  ossuary: 'Serious Fun. Call high or low on the bone die — a win doubles your bet.',
  barrier: 'A guardian seals this passage. Beat it and the route opens for everyone.',
  lair: 'A mini-boss den. Your first kill pays a huge bounty; repeats pay small. Come at Level 5+.',
  vault: 'A treasure hoard, deep behind a barrier. First visit pays big — once.',
  cache: 'A stashed treasure — a rich first-visit payout for every explorer.',
  ladder: 'A rusted ladder between the surface and the dungeon below.',
  tunnel: 'A shortcut between biomes. Tier-1 units cross free; evolved units pay Spores to use it. Land on it to be carried across to the far side for free.',
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
  witch: 'The Sedgemoor Witch',
  hazard: 'Hazard',
  warp: 'Warp Mushroom',
  gate: 'Gate of the Swarm',
  boss: 'Boss Lair',
  ossuary: 'The Casino',
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
  tunnel: 'Tunnel',
  world_event: 'The Great Beast',
};
