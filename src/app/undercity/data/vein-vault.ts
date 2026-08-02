/**
 * Display mirrors of the VEIN_* / VAULT_* balance constants in
 * infrastructure/lambda/undercity_data.py — keep in sync when tuning.
 */
export const VEIN_STRIKES_PER_VISIT = 3;
export const VEIN_MAX_DEPTH = 12;
export const VEIN_CAVE_IN_PCT_PER_LEVEL = 0.04;
export const VEIN_CAVE_IN_DMG_PER_LEVEL = 2;
// Mining pays crafting materials only — NO Spores. Gemstone (Ichor) drop chance
// per strike = min(1, BASE + level * PER_LEVEL).
export const VEIN_ICHOR_BASE = 0.2;
export const VEIN_ICHOR_PER_LEVEL = 0.03;
// Prying the Heartstone at VEIN_MAX_DEPTH: bonus Gemstones on top of the strike's
// own yield, plus a guaranteed rare find; the shaft then refills to 0.
export const VEIN_HEARTSTONE_ICHOR = 2;
// Bonus-item bands (undercity_db._vein_item): a consumable in the mid shaft, a
// rare find in the deep band. [minLevel, maxLevel, chance, label].
export const VEIN_ITEM_CONSUMABLE_BAND = { min: 5, max: 8, chance: 0.15 };
export const VEIN_ITEM_RARE_BAND = { min: 9, chance: 0.2 };
export const VAULT_SLOTS = 3;
export const VAULT_PICKS_PER_VISIT = 3;
export const VAULT_POT_SEED = 30;

export interface SigilInfo {
  id: string;
  emoji: string;
  name: string;
}

/** Order matches VAULT_SIGILS server-side. */
export const VAULT_SIGILS: SigilInfo[] = [
  { id: 'spore', emoji: '🍄', name: 'Spore' },
  { id: 'bone', emoji: '🦴', name: 'Bone' },
  { id: 'web', emoji: '🕸️', name: 'Web' },
  { id: 'moss', emoji: '🌿', name: 'Moss' },
  { id: 'skull', emoji: '💀', name: 'Skull' },
  { id: 'beetle', emoji: '🪲', name: 'Beetle' },
];
