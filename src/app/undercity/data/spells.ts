/** Spell & grimoire catalogue (mirrors SPELLS / GRIMOIRES / BIOME_SPELLS in undercity_data.py). */

export type SpellEffect =
  | 'self_buff'
  | 'self_heal'
  | 'field_curse'
  | 'field_damage'
  | 'teleport'
  | 'recall'
  | 'fate_die'
  | 'boss_strike';

export interface SpellInfo {
  id: string;
  name: string;
  category: 'buff' | 'field' | 'traversal' | 'boss';
  tier: 1 | 2 | 3;
  cooldownMin: number;
  effect: SpellEffect;
  range?: number;
  desc: string;
  /** Material Icons ligature name. */
  icon: string;
}

export const SPELLS: SpellInfo[] = [
  // Innate biome spells
  { id: 'rot_surge', name: 'Rot Surge', category: 'buff', tier: 1, cooldownMin: 30, effect: 'self_buff', desc: '+3 ATK in your next battle.', icon: 'local_fire_department' },
  { id: 'bone_chill', name: 'Bone Chill', category: 'field', tier: 1, cooldownMin: 30, effect: 'field_curse', range: 5, desc: 'Curse a rival: −2 ATK in their next battle.', icon: 'ac_unit' },
  { id: 'bog_snare', name: 'Bog Snare', category: 'field', tier: 1, cooldownMin: 30, effect: 'field_curse', range: 5, desc: 'Curse a rival: their next roll is halved.', icon: 'water_drop' },
  { id: 'glowveil', name: 'Glowveil', category: 'buff', tier: 1, cooldownMin: 30, effect: 'self_buff', desc: '+2 SPD and +15% flee chance in your next battle.', icon: 'flare' },
  { id: 'scrap_toss', name: 'Scrap Toss', category: 'field', tier: 1, cooldownMin: 30, effect: 'field_damage', range: 5, desc: 'Hurl city scrap at a rival for 8 damage.', icon: 'construction' },
  // Tier I
  { id: 'spore_bolt', name: 'Spore Bolt', category: 'field', tier: 1, cooldownMin: 20, effect: 'field_damage', range: 6, desc: 'A puff of caustic spores: 12 damage at range.', icon: 'flash_on' },
  { id: 'mend_flesh', name: 'Mend Flesh', category: 'buff', tier: 1, cooldownMin: 20, effect: 'self_heal', desc: 'Knit your wounds: restore 12 HP.', icon: 'healing' },
  { id: 'harden_shell', name: 'Harden Shell', category: 'buff', tier: 1, cooldownMin: 20, effect: 'self_buff', desc: '+2 DEF in your next battle.', icon: 'shield' },
  { id: 'skitter_step', name: 'Skitter Step', category: 'traversal', tier: 1, cooldownMin: 25, effect: 'teleport', range: 3, desc: 'Blink to any space within 3 steps.', icon: 'directions_run' },
  // Tier II
  { id: 'rot_bolt', name: 'Rot Bolt', category: 'field', tier: 2, cooldownMin: 25, effect: 'field_damage', range: 7, desc: 'A lance of concentrated rot: 20 damage at range.', icon: 'thunderstorm' },
  { id: 'weaken_hex', name: 'Weaken Hex', category: 'field', tier: 2, cooldownMin: 25, effect: 'field_curse', range: 6, desc: 'Curse a rival: −3 ATK in their next battle.', icon: 'heart_broken' },
  { id: 'mycelial_recall', name: 'Mycelial Recall', category: 'traversal', tier: 2, cooldownMin: 45, effect: 'recall', desc: 'The threads drag you home to your biome gate.', icon: 'home' },
  { id: 'fate_die', name: 'Fate Die', category: 'traversal', tier: 2, cooldownMin: 40, effect: 'fate_die', desc: 'Choose the value of your next roll (1–6).', icon: 'casino' },
  // Tier III
  { id: 'spore_burst', name: 'Spore Burst', category: 'field', tier: 3, cooldownMin: 30, effect: 'field_damage', range: 8, desc: 'A detonation of spores: 30 damage at range.', icon: 'coronavirus' },
  { id: 'deep_step', name: 'Deep Step', category: 'traversal', tier: 3, cooldownMin: 30, effect: 'teleport', range: 6, desc: 'Blink to any space within 6 steps.', icon: 'alt_route' },
  { id: 'queens_bane', name: "Queen's Bane", category: 'boss', tier: 3, cooldownMin: 60, effect: 'boss_strike', desc: 'Sear the Queen or a lair boss for 15, from anywhere.', icon: 'gavel' },
];

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

export const GRIMOIRES: GrimoireInfo[] = [
  { id: 'moldering_folio', name: 'Moldering Folio', tier: 1, cost: 25, spells: ['spore_bolt'], desc: 'A waterlogged primer of offensive sporecraft.' },
  { id: 'gardeners_primer', name: "Gardener's Primer", tier: 1, cost: 30, spells: ['mend_flesh', 'harden_shell'], desc: 'Homestead magic: mend flesh, harden shell.' },
  { id: 'vagrants_chapbook', name: "Vagrant's Chapbook", tier: 1, cost: 30, spells: ['skitter_step'], desc: 'Scrawled shortcuts through the tunnels.' },
  { id: 'warcasters_screed', name: "Warcaster's Screed", tier: 1, cost: 35, spells: ['rot_surge', 'spore_bolt'], desc: 'Aggressor liturgy: swell with rot, then loose it.' },
  { id: 'hexweavers_codex', name: "Hexweaver's Codex", tier: 1, cost: 35, spells: ['bone_chill', 'bog_snare'], desc: 'Two curses for the price of one grudge.' },
  { id: 'nightrunners_ledger', name: "Nightrunner's Ledger", tier: 1, cost: 32, spells: ['glowveil', 'skitter_step'], desc: 'Slip the light, then slip the room.' },
  { id: 'tinkers_manual', name: "Tinker's Manual", tier: 1, cost: 30, spells: ['harden_shell', 'scrap_toss'], desc: 'Brace the shell, then throw the scrap heap.' },
  { id: 'kraul_warcodex', name: 'Kraul Warcodex', tier: 2, cost: 70, spells: ['rot_bolt', 'weaken_hex'], desc: 'Battle-liturgy of the kraul warhosts.' },
  { id: 'wayfarers_atlas', name: "Wayfarer's Atlas", tier: 2, cost: 70, spells: ['mycelial_recall', 'fate_die', 'skitter_step'], desc: 'Every tunnel, and several that should not exist.' },
  { id: 'queensbane_grimoire', name: 'Queensbane Grimoire', tier: 3, cost: 150, spells: ['queens_bane', 'spore_burst'], desc: 'Heretical rites that wound what cannot be reached.' },
  { id: 'tome_of_deep_roads', name: 'Tome of the Deep Roads', tier: 3, cost: 150, spells: ['deep_step', 'fate_die', 'mycelial_recall'], desc: 'The mycelium remembers every road.' },
];

export const GRIMOIRE_MAP: Record<string, GrimoireInfo> = Object.fromEntries(
  GRIMOIRES.map((g) => [g.id, g]),
);

/** Home biome -> always-castable innate spell. */
export const BIOME_SPELLS: Record<string, string> = {
  garden: 'rot_surge',
  bone: 'bone_chill',
  bog: 'bog_snare',
  cavern: 'glowveil',
  city: 'scrap_toss',
};

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
