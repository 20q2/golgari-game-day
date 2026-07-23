/** Spell & grimoire catalogue. The data arrays (SPELLS / GRIMOIRES / BIOME_SPELLS)
 *  are GENERATED from the Python source of truth (undercity_data.py) into
 *  spells.generated.ts — do not hand-edit them; run `python
 *  infrastructure/lambda/sync_spells.py`. This file holds the types + helpers. */

import { SPELLS, GRIMOIRES, BIOME_SPELLS } from './spells.generated';
export { SPELLS, GRIMOIRES, BIOME_SPELLS };

export type SpellEffect =
  | 'self_buff'
  | 'self_heal'
  | 'field_curse'
  | 'field_damage'
  | 'teleport'
  | 'recall'
  | 'fate_die'
  | 'boss_strike'
  | 'wish';

export interface SpellInfo {
  id: string;
  name: string;
  category: 'buff' | 'field' | 'traversal' | 'boss';
  tier: 1 | 2 | 3;
  cooldownMin: number;
  effect: SpellEffect;
  range?: number;
  /** fate_die: highest face the value-picker offers (defaults to 6). */
  maxValue?: number;
  /** Base magnitude for damage/heal/boss spells (mirrors undercity_data power).
   *  Omitted for buff/curse/traversal spells. Displayed value is spellPower(). */
  power?: number;
  desc: string;
  /** Material Icons ligature name. */
  icon: string;
}

export const SPELL_MAP: Record<string, SpellInfo> = Object.fromEntries(
  SPELLS.map((s) => [s.id, s]),
);

export interface GrimoireInfo {
  id: string;
  name: string;
  tier: 1 | 2 | 3;
  cost: number;
  spells: string[];
  desc: string;
}

export const GRIMOIRE_MAP: Record<string, GrimoireInfo> = Object.fromEntries(
  GRIMOIRES.map((g) => [g.id, g]),
);

/** Whole minutes until a spell is ready again (0 = ready now). */
export function cooldownLeftMin(
  cooldowns: Record<string, string> | undefined,
  spellId: string,
): number {
  const readyAt = cooldowns?.[spellId];
  if (!readyAt) return 0;
  const ms = new Date(readyAt + 'Z').getTime() - Date.now();
  return ms > 0 ? Math.ceil(ms / 60_000) : 0;
}

/** Mirror of GRIMOIRE_SWAP_COOLDOWN_MIN in infrastructure/lambda/undercity_config.py. */
export const GRIMOIRE_SWAP_COOLDOWN_MIN = 30;

/** Whole minutes until a different grimoire can be opened (0 = ready now). */
export function grimoireSwapLeftMin(lastSwap: string | null | undefined): number {
  if (!lastSwap) return 0;
  const readyMs = new Date(lastSwap + 'Z').getTime() + GRIMOIRE_SWAP_COOLDOWN_MIN * 60_000;
  const ms = readyMs - Date.now();
  return ms > 0 ? Math.ceil(ms / 60_000) : 0;
}

/** Mirror of GRIMOIRE_CAPACITY / WITCH_SCROLL_STOCK in undercity_config.py /
 *  undercity_data.py — spells a book holds by tier, and the witch's tier-I stock. */
export const GRIMOIRE_CAPACITY: Record<number, number> = { 1: 2, 2: 3, 3: 4 };
export const WITCH_SCROLL_STOCK = ['spore_bolt', 'mend_flesh', 'harden_shell', 'scrap_toss'];

/** Category → semantic color + short kind label (design §7 second color axis).
 *  Kept separate from the rarity (tier) palette so the two axes read distinctly. */
export function spellCategoryStyle(spell: SpellInfo): { color: string; kind: string } {
  switch (spell.effect) {
    case 'field_damage': return { color: 'var(--error, #f44336)', kind: 'Damage' };
    case 'self_heal': return { color: 'var(--success, #4caf50)', kind: 'Heal' };
    case 'self_buff': return { color: 'var(--info, #2196f3)', kind: 'Buff' };
    case 'field_curse': return { color: 'var(--accent-color, #e91e63)', kind: 'Curse' };
    case 'boss_strike':
    case 'wish': return { color: 'var(--rating-gold, #ffd700)', kind: 'Boss' };
    default: return { color: 'var(--warning, #ff9800)', kind: 'Mobility' };
  }
}

/** Client mirror of engine.spell_power — MUST match undercity_config
 *  SPELL_POWER_PER_LEVEL (1.0). Returns the level-scaled magnitude. */
export const SPELL_POWER_PER_LEVEL = 1.0;

export function spellPower(base: number | undefined, level: number): number {
  if (!base) return 0;
  return base + Math.round(SPELL_POWER_PER_LEVEL * (Math.max(1, level) - 1));
}

/** Short label for a spell's current effect at the player's level, e.g.
 *  "18 dmg", "17 HP", or '' for non-power spells. */
export function spellPowerLabel(spell: SpellInfo, level: number): string {
  if (!spell.power) return '';
  const v = spellPower(spell.power, level);
  if (spell.effect === 'self_heal') return `${v} HP`;
  return `${v} dmg`;
}
