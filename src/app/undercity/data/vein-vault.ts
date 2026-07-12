/**
 * Display mirrors of the VEIN_* / VAULT_* balance constants in
 * infrastructure/lambda/undercity_data.py — keep in sync when tuning.
 */
export const VEIN_STRIKES_PER_VISIT = 3;
export const VEIN_MAX_DEPTH = 12;
export const VEIN_CAVE_IN_PCT_PER_LEVEL = 0.04;
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
