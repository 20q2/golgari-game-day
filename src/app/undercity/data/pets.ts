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
 * client only displays previews and gates buttons. A pet's ROLE (not its species
 * name) drives its ability, so each role has two collectible species that share
 * one ability. Real pixel-art sprites live at
 * public/undercity/pets/<role>/<species>.png.
 */
import { Rarity, tierRarity } from './items';

/** A companion species id — equals its sprite filename (no extension). */
export type PetSpecies = string;

/** The five ability roles; two species share each. */
export type PetRole = 'attack' | 'defend' | 'forage' | 'scout' | 'economy';

/** How a companion acts: passive combat trigger, activated ability, or a
 *  passive board/economy trickle. */
export type PetKind = 'combat-passive' | 'activated' | 'economy';

export interface PetRoleInfo {
  kind: PetKind;
  /** One-line player-facing ability description (mirrors PET_ROLES blurb). */
  blurb: string;
  /** Material icon fallback (used where a sprite isn't rendered, e.g. hub tile). */
  icon: string;
}

/** Mirror of undercity_data.PET_ROLES. */
export const PET_ROLES: Record<PetRole, PetRoleInfo> = {
  attack: { kind: 'combat-passive', blurb: 'Chance to strike a follow-up hit in battle.', icon: 'pets' },
  defend: { kind: 'combat-passive', blurb: 'Chance to deflect a few points of damage.', icon: 'shield' },
  forage: { kind: 'activated', blurb: 'Scavenges a small cache of loot.', icon: 'savings' },
  scout: { kind: 'activated', blurb: "Scouts a bazaar's stock before you arrive.", icon: 'visibility' },
  economy: { kind: 'economy', blurb: 'Scavenges Spores from loot spaces you pass — tap to collect.', icon: 'grass' },
};

export interface PetSpeciesInfo {
  species: PetSpecies;
  name: string;
  role: PetRole;
  kind: PetKind;
  blurb: string;
  icon: string;
}

/** species id (== sprite filename) -> [display name, role]. Mirror of
 *  undercity_data._PET_ROSTER. Two species per role. */
const PET_ROSTER: Record<string, [string, PetRole]> = {
  baby_leyline_prowler: ['Leyline Prowler', 'attack'],
  baby_moldering_karock: ['Moldering Karock', 'attack'],
  decimator_beetle: ['Decimator Beetle', 'defend'],
  small_bear: ['Bear Cub', 'defend'],
  baby_broodspinner: ['Broodspinner', 'economy'],
  slime: ['Slime', 'economy'],
  baby_darkheart_sliver: ['Darkheart Sliver', 'forage'],
  rat: ['Rat', 'forage'],
  baby_gloomshrieker: ['Gloomshrieker', 'scout'],
  baby_winding_constrictor: ['Winding Constrictor', 'scout'],
};

export const PET_SPECIES: Record<string, PetSpeciesInfo> = Object.fromEntries(
  Object.entries(PET_ROSTER).map(([species, [name, role]]) => [
    species,
    { species, name, role, kind: PET_ROLES[role].kind, blurb: PET_ROLES[role].blurb, icon: PET_ROLES[role].icon },
  ]),
);

export const PET_SPECIES_LIST: PetSpeciesInfo[] = Object.values(PET_SPECIES);

/** Role of a species (defaults to 'attack' for an unknown id — never crashes). */
export function petRole(species: PetSpecies): PetRole {
  return PET_SPECIES[species]?.role ?? 'attack';
}

/** Public URL of a species' pixel-art sprite. */
export function petSpriteUrl(species: PetSpecies): string {
  return `undercity/pets/${petRole(species)}/${species}.png`;
}

// Egg art files are named for the gear rarity scale, so tier maps 1:1 to a file.
const EGG_SPRITE_BY_TIER: Record<number, string> = {
  1: 'common_egg',
  2: 'rare_egg',
  3: 'legendary_egg',
  4: 'mythic_egg',
};

/** Public URL of an egg's pixel-art sprite for a given tier. */
export function eggSpriteUrl(tier: number): string {
  return `undercity/pets/eggs/${EGG_SPRITE_BY_TIER[tier] ?? EGG_SPRITE_BY_TIER[1]}.png`;
}

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

export const PET_INCUBATE_MINUTES = 5;

/** Activated-ability base cooldowns (minutes), keyed by ROLE, shortened as the
 *  pet levels. */
export const PET_ABILITY_COOLDOWN_MIN: Partial<Record<PetRole, number>> = {
  scout: 30, forage: 20,
};
export const PET_ABILITY_COOLDOWN_PER_LVL = 2;
export const PET_ABILITY_COOLDOWN_FLOOR = 5;

// Economy companion (mirror undercity_config PET_SPORE_*). An active economy pet
// scavenges Spores as you MOVE: each loot space you pass OVER banks a few onto
// the pet (server-authoritative, stored on `you.petSporeBank`), up to a
// level-scaled cap, which the player taps to redeem via its board quick-use box.
export const PET_SPORE_PER_LOOT_BASE = 6;
export const PET_SPORE_PER_LOOT_PER_LVL = 2;
export const PET_SPORE_CAP_BASE = 60;
export const PET_SPORE_CAP_PER_LVL = 30;

/** Spores banked per loot space passed over, by the pet's level (preview only). */
export function economyPerLoot(level: number): number {
  return PET_SPORE_PER_LOOT_BASE + PET_SPORE_PER_LOOT_PER_LVL * (level - 1);
}
/** The most Spores an economy pet can bank before you must collect. */
export function economySporeCap(level: number): number {
  return Math.floor(PET_SPORE_CAP_BASE + PET_SPORE_CAP_PER_LVL * (level - 1));
}

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
  return (
    PET_SPECIES[species] ?? {
      species,
      name: species,
      role: 'attack',
      kind: PET_ROLES.attack.kind,
      blurb: PET_ROLES.attack.blurb,
      icon: PET_ROLES.attack.icon,
    }
  );
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

/** Real-time ability cooldown (minutes) for a role at a level. */
export function abilityCooldownMin(role: PetRole, level: number): number {
  const base = PET_ABILITY_COOLDOWN_MIN[role] ?? 0;
  return Math.max(PET_ABILITY_COOLDOWN_FLOOR, base - PET_ABILITY_COOLDOWN_PER_LVL * (level - 1));
}

/** True if an activated pet's shared cooldown (keyed by ROLE) has elapsed
 *  (server clock, ISO without trailing Z — same convention as spellCooldowns). */
export function abilityReady(petCooldowns: Record<string, string> | undefined, role: PetRole): boolean {
  const readyAt = petCooldowns?.[role];
  if (!readyAt) return true;
  return new Date(readyAt + 'Z').getTime() <= Date.now();
}

/** Minutes left on an activated pet's cooldown (0 when ready). */
export function abilityCooldownLeftMin(petCooldowns: Record<string, string> | undefined, role: PetRole): number {
  const readyAt = petCooldowns?.[role];
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
