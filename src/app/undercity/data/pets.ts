/**
 * Client mirror of the Undercity companion tables in
 * infrastructure/lambda/undercity_data.py + undercity_config.py.
 *
 * A companion is a small, characterful ability that lives BESIDE your creature
 * (never a stat stick). Pets share the gear rarity scale (tier 1..4 =
 * Common..Mythic — see tierRarity in items.ts): merging same-species dupes
 * raises a pet's tier/rarity, leveling with moltings/gemstones fills the cap.
 *
 * Keep these numbers in sync with the server — the server is authoritative; the
 * client only displays previews and gates buttons. Placeholder art: each species
 * shows a Material icon until real sprites land in public/undercity/ (wire the
 * sprite key in PET_SPECIES.sprite, mirroring data/species.ts).
 */
import { Rarity, tierRarity } from './items';

export type PetSpecies = 'fox' | 'turtle' | 'bird' | 'mouse' | 'grub';

/** How a companion acts: passive combat trigger, activated ability, or a
 *  passive board/economy trickle. */
export type PetKind = 'combat-passive' | 'activated' | 'economy';

export interface PetSpeciesInfo {
  species: PetSpecies;
  name: string;
  kind: PetKind;
  /** One-line player-facing ability description (mirrors PET_SPECIES.blurb). */
  blurb: string;
  /** Material icon shown as placeholder art until a real sprite exists. */
  icon: string;
  /** Intended sprite asset key (undercity/sprites/${sprite}.png); art TBD. */
  sprite: string;
}

/** Mirror of undercity_data.PET_SPECIES (+ client-only icon/sprite hints). */
export const PET_SPECIES: Record<PetSpecies, PetSpeciesInfo> = {
  fox: {
    species: 'fox', name: 'Fox', kind: 'combat-passive',
    blurb: 'Chance to strike a follow-up hit in battle.',
    icon: 'pets', sprite: 'pet_fox',
  },
  turtle: {
    species: 'turtle', name: 'Turtle', kind: 'combat-passive',
    blurb: 'Chance to deflect a few points of damage.',
    icon: 'shield', sprite: 'pet_turtle',
  },
  bird: {
    species: 'bird', name: 'Bird', kind: 'activated',
    blurb: "Scouts a bazaar's stock before you arrive.",
    icon: 'visibility', sprite: 'pet_bird',
  },
  mouse: {
    species: 'mouse', name: 'Mouse', kind: 'activated',
    blurb: 'Scavenges a small cache of loot.',
    icon: 'savings', sprite: 'pet_mouse',
  },
  grub: {
    species: 'grub', name: 'Grub', kind: 'economy',
    blurb: 'Trickles moltings as you travel.',
    icon: 'grass', sprite: 'pet_grub',
  },
};

export const PET_SPECIES_LIST: PetSpeciesInfo[] = Object.values(PET_SPECIES);

// ── Progression (mirror undercity_data) ──────────────────────────────────────

/** Level cap per tier — merging raises tier, leveling fills to the cap. */
export const PET_LEVEL_CAP: Record<number, number> = { 1: 3, 2: 5, 3: 7, 4: 9 };

/** Merge fuel: points a fodder pet contributes, by ITS tier. */
export const PET_MERGE_POINTS: Record<number, number> = { 1: 1, 2: 3, 3: 7, 4: 15 };
/** Points required to advance a target INTO tier 2 / 3 / 4. */
export const PET_MERGE_COST: Record<number, number> = { 2: 2, 3: 3, 4: 4 };

/** Per-level upgrade cost by the pet's current tier. */
export const PET_LEVEL_MOLTINGS: Record<number, number> = { 1: 2, 2: 3, 3: 5, 4: 8 };
export const PET_LEVEL_ICHOR: Record<number, number> = { 1: 0, 2: 0, 3: 1, 4: 1 };

/** Salvage yield: moltings = base[tier] + (level - 1); ichor if tier >= threshold. */
export const PET_SALVAGE_MOLTINGS: Record<number, number> = { 1: 1, 2: 2, 3: 4, 4: 6 };
export const PET_SALVAGE_ICHOR_MIN_TIER = 3;

// ── Timers / activated-ability cadence (mirror undercity_config) ─────────────

export const PET_INCUBATE_MINUTES = 15;

/** Activated-ability base cooldowns (minutes), shortened as the pet levels. */
export const PET_ABILITY_COOLDOWN_MIN: Partial<Record<PetSpecies, number>> = {
  bird: 30, mouse: 20,
};
export const PET_ABILITY_COOLDOWN_PER_LVL = 2;
export const PET_ABILITY_COOLDOWN_FLOOR = 5;

// ── Player-market resale (mirror undercity_config PET/EGG_MARKET_*) ───────────

export const PET_MARKET_VALUE: Record<number, number> = { 1: 20, 2: 55, 3: 120, 4: 240 };
export const PET_MARKET_PER_LEVEL = 6;
export const EGG_MARKET_VALUE: Record<number, number> = { 1: 25, 2: 60, 3: 130, 4: 250 };

// Same band percentages the server uses (MARKET_PRICE_MIN/MAX_PCT).
const MARKET_PRICE_MIN_PCT = 0.5;
const MARKET_PRICE_MAX_PCT = 2.0;

function band(base: number): { lo: number; hi: number } {
  const lo = Math.max(1, Math.floor(base * MARKET_PRICE_MIN_PCT));
  return { lo, hi: Math.max(lo, Math.floor(base * MARKET_PRICE_MAX_PCT)) };
}

// ── Instance shape (mirror the server pet dict) ──────────────────────────────

export interface Pet {
  id: string;
  species: PetSpecies;
  /** Rarity tier 1..4, shared with the gear rarity scale. */
  tier: number;
  level: number;
  /** Accumulated merge fuel toward the next tier. */
  mergeProgress: number;
}

export interface Egg {
  id: string;
  /** Biases the hatch outcome + becomes the hatched pet's starting tier. */
  tier: number;
}

// ── Derived display helpers ──────────────────────────────────────────────────

export function petInfo(species: PetSpecies): PetSpeciesInfo {
  return PET_SPECIES[species];
}

export function petRarity(pet: Pet): Rarity {
  return tierRarity(pet.tier).key;
}

export function levelCap(tier: number): number {
  return PET_LEVEL_CAP[tier] ?? PET_LEVEL_CAP[1];
}

export function atLevelCap(pet: Pet): boolean {
  return pet.level >= levelCap(pet.tier);
}

export function atMaxTier(pet: Pet): boolean {
  return pet.tier >= 4;
}

/** Material cost to raise this pet one level (by its current tier). */
export function levelCost(pet: Pet): { moltings: number; ichor: number } {
  return {
    moltings: PET_LEVEL_MOLTINGS[pet.tier] ?? 0,
    ichor: PET_LEVEL_ICHOR[pet.tier] ?? 0,
  };
}

/** Salvage preview for a pet, matching the server yield formula. */
export function salvageYield(pet: Pet): { moltings: number; ichor: number } {
  return {
    moltings: (PET_SALVAGE_MOLTINGS[pet.tier] ?? 1) + (pet.level - 1),
    ichor: pet.tier >= PET_SALVAGE_ICHOR_MIN_TIER ? 1 : 0,
  };
}

/** Merge fuel currently sitting in the target, plus the target's own carry. */
export function mergePointsFor(fodder: Pet[]): number {
  return fodder.reduce((sum, f) => sum + (PET_MERGE_POINTS[f.tier] ?? 0), 0);
}

/** Would feeding `fodder` into `target` complete the next tier? */
export function mergeWouldRankUp(target: Pet, fodder: Pet[]): boolean {
  if (atMaxTier(target)) return false;
  const need = PET_MERGE_COST[target.tier + 1] ?? Infinity;
  return target.mergeProgress + mergePointsFor(fodder) >= need;
}

/** Real-time ability cooldown (minutes) for a species at a level. */
export function abilityCooldownMin(species: PetSpecies, level: number): number {
  const base = PET_ABILITY_COOLDOWN_MIN[species] ?? 0;
  return Math.max(PET_ABILITY_COOLDOWN_FLOOR, base - PET_ABILITY_COOLDOWN_PER_LVL * (level - 1));
}

/** True if an activated pet's shared cooldown has elapsed (server clock, ISO
 *  without trailing Z — same convention as spellCooldowns). */
export function abilityReady(petCooldowns: Record<string, string> | undefined, species: PetSpecies): boolean {
  const readyAt = petCooldowns?.[species];
  if (!readyAt) return true;
  return new Date(readyAt + 'Z').getTime() <= Date.now();
}

/** Minutes left on an activated pet's cooldown (0 when ready). */
export function abilityCooldownLeftMin(petCooldowns: Record<string, string> | undefined, species: PetSpecies): number {
  const readyAt = petCooldowns?.[species];
  if (!readyAt) return 0;
  const ms = new Date(readyAt + 'Z').getTime() - Date.now();
  return ms <= 0 ? 0 : Math.ceil(ms / 60000);
}

/** Allowed Spore price band for selling a companion (scales with level). */
export function petMarketBand(pet: Pet): { lo: number; hi: number } {
  return band((PET_MARKET_VALUE[pet.tier] ?? 20) + PET_MARKET_PER_LEVEL * (pet.level - 1));
}

/** Allowed Spore price band for selling an egg (by tier). */
export function eggMarketBand(tier: number): { lo: number; hi: number } {
  return band(EGG_MARKET_VALUE[tier] ?? 25);
}
