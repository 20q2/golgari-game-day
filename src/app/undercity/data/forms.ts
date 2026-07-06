/**
 * Display copies of the backend creature tables (undercity_data.py is the
 * source of truth for numbers — these drive choice screens and tooltips).
 */
export interface FormInfo {
  id: string;
  name: string;
  tier: 1 | 2 | 3;
  line?: string;
  blurb: string;
  passive: string;
  passiveName: string;
  stats?: { hp: number; atk: number; def: number; spd: number };
  bonus?: Record<string, number>;
}

export const PASSIVE_NAMES: Record<string, string> = {
  scrounger: 'Scrounger',
  first_bite: 'First Bite',
  regrowth: 'Regrowth',
  drift: 'Drift',
  undying: 'Undying',
  flyby: 'Flyby',
  venom_barb: 'Venom Barb',
  deathrite: 'Deathrite',
  scavenge: 'Scavenge',
  rootwall: 'Rootwall',
  dredge: 'Dredge',
  doubling_rot: 'Doubling Rot',
  deathtouch_stomp: 'Deathtouch Stomp',
  drain_life: 'Drain Life',
  rot_breath: 'Rot Breath',
  swarm: 'Swarm',
};

export const PASSIVE_BLURBS: Record<string, string> = {
  scrounger: '+2 Spores from every loot source.',
  first_bite: 'Always strikes first in round 1.',
  regrowth: 'Heal 20% max HP after any battle.',
  drift: '+15% flee chance; bad mystery events reroll once.',
  undying: 'First compost each hour: revive at 50% HP instead.',
  flyby: '25% chance enemy strikes miss.',
  venom_barb: 'Your first strike each battle deals +3.',
  deathrite: '+50% Spores stolen on PvP wins.',
  scavenge: 'Retaliate for 2 damage whenever struck.',
  rootwall: 'Regrowth improves to 35%.',
  dredge: 'Reclaim your snare after it triggers.',
  doubling_rot: 'Mystery-event Spore payouts doubled.',
  deathtouch_stomp: 'Your strikes ignore 3 of the enemy’s DEF.',
  drain_life: 'Heal for 50% of damage you deal.',
  rot_breath: 'Round-1 strike hits for double.',
  swarm: 'One extra strike every battle round.',
};

export const STARTERS: FormInfo[] = [
  {
    id: 'pest', name: 'Pest', tier: 1, passive: 'scrounger', passiveName: 'Scrounger',
    blurb: 'A balanced sewer rat. Never hungry, never broke.',
    stats: { hp: 30, atk: 6, def: 5, spd: 5 },
  },
  {
    id: 'kraul', name: 'Kraul Grub', tier: 1, passive: 'first_bite', passiveName: 'First Bite',
    blurb: 'A glass-cannon insect. Bites first, asks never.',
    stats: { hp: 24, atk: 8, def: 3, spd: 7 },
  },
  {
    id: 'saproling', name: 'Saproling', tier: 1, passive: 'regrowth', passiveName: 'Regrowth',
    blurb: 'A tanky plant token. What is pruned grows back.',
    stats: { hp: 38, atk: 5, def: 7, spd: 3 },
  },
  {
    id: 'spore', name: 'Spore', tier: 1, passive: 'drift', passiveName: 'Drift',
    blurb: 'A trickster fungus. Hard to pin down, luckier than it looks.',
    stats: { hp: 27, atk: 5, def: 5, spd: 6 },
  },
];

export const TIER2: FormInfo[] = [
  { id: 'brackish_trudge', name: 'Brackish Trudge', tier: 2, line: 'pest', passive: 'undying', passiveName: 'Undying', bonus: { maxHp: 6, atk: 2 }, blurb: 'Bruiser (+HP/+ATK).' },
  { id: 'stinkweed_imp', name: 'Stinkweed Imp', tier: 2, line: 'pest', passive: 'flyby', passiveName: 'Flyby', bonus: { spd: 2, atk: 2 }, blurb: 'Speedster (+SPD/+ATK).' },
  { id: 'kraul_warrior', name: 'Kraul Warrior', tier: 2, line: 'kraul', passive: 'venom_barb', passiveName: 'Venom Barb', bonus: { atk: 4 }, blurb: 'Striker (+ATK).' },
  { id: 'kraul_forager', name: 'Kraul Forager', tier: 2, line: 'kraul', passive: 'deathrite', passiveName: 'Deathrite', bonus: { def: 4 }, blurb: 'Raider (+DEF).' },
  { id: 'slitherhead', name: 'Slitherhead', tier: 2, line: 'saproling', passive: 'scavenge', passiveName: 'Scavenge', bonus: { atk: 2, maxHp: 6 }, blurb: 'Counterpuncher (+ATK/+HP).' },
  { id: 'woodwraith_strangler', name: 'Woodwraith Strangler', tier: 2, line: 'saproling', passive: 'rootwall', passiveName: 'Rootwall', bonus: { def: 2, maxHp: 6 }, blurb: 'Fortress (+DEF/+HP).' },
  { id: 'shambling_shell', name: 'Shambling Shell', tier: 2, line: 'spore', passive: 'dredge', passiveName: 'Dredge', bonus: { maxHp: 6, def: 2 }, blurb: 'Durable trickster (+HP/+DEF).' },
  { id: 'corpsejack_menace', name: 'Corpsejack Menace', tier: 2, line: 'spore', passive: 'doubling_rot', passiveName: 'Doubling Rot', bonus: { atk: 4 }, blurb: 'Fungal tycoon (+ATK).' },
];

export const APEX: (FormInfo & { from: string[] })[] = [
  { id: 'grave_titan', name: 'Grave Titan', tier: 3, passive: 'deathtouch_stomp', passiveName: 'Deathtouch Stomp', bonus: { maxHp: 6, def: 2 }, blurb: 'HP/DEF colossus.', from: ['brackish_trudge', 'kraul_forager', 'woodwraith_strangler', 'shambling_shell'] },
  { id: 'golgari_lich_lord', name: 'Golgari Lich Lord', tier: 3, passive: 'drain_life', passiveName: 'Drain Life', bonus: { atk: 2, maxHp: 6 }, blurb: 'ATK/HP sovereign of rot.', from: ['kraul_forager', 'slitherhead', 'woodwraith_strangler', 'corpsejack_menace'] },
  { id: 'swamp_dragon', name: 'Swamp Dragon', tier: 3, passive: 'rot_breath', passiveName: 'Rot Breath', bonus: { atk: 2, spd: 2 }, blurb: 'ATK/SPD terror of the deep tunnels.', from: ['brackish_trudge', 'stinkweed_imp', 'kraul_warrior'] },
  { id: 'izoni', name: 'Izoni, Thousand-Eyed', tier: 3, passive: 'swarm', passiveName: 'Swarm', bonus: { spd: 4 }, blurb: 'SPD incarnate — the swarm given a name.', from: ['stinkweed_imp', 'kraul_warrior', 'slitherhead', 'shambling_shell', 'corpsejack_menace'] },
];

export const ALL_FORMS: Record<string, FormInfo> = Object.fromEntries(
  [...STARTERS, ...TIER2, ...APEX].map((f) => [f.id, f]),
);

export function evolutionOptions(tier: number, species: string, form: string): FormInfo[] {
  if (tier === 1) return TIER2.filter((f) => f.line === species);
  if (tier === 2) return APEX.filter((f) => f.from.includes(form));
  return [];
}

export function formName(form: string | undefined): string {
  return ALL_FORMS[form ?? '']?.name ?? 'Creature';
}

export function xpToNext(level: number): number {
  return 20 + 5 * level;
}
