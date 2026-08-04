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
  drift: 'Endless Ranks',
  undying: 'Undying',
  vexing: 'Vexing',
  venom_barb: 'Venom Barb',
  reach: 'Reach',
  spikeshell: 'Spiked Shell',
  skitter: 'Skitter',
  outpace: 'Outpace',
  flurry: 'Flurry',
  rootwall: 'Rootwall',
  dredge: 'Dredge',
  doubling_rot: 'Doubling Rot',
  soul_trophy: 'Soul Trophy',
  deathtouch_stomp: 'Deathtouch Stomp',
  drain_life: 'Drain Life',
  rot_breath: 'Rot Breath',
  swarm: 'Swarm',
  spell_haste: 'Spell Haste',
  spell_warrior: 'Spell Warrior',
  spell_mage: 'Spell Mage',
  wish: 'Wish',
  stonewright: 'Stonewright',
  stone_gaze: 'Stone Gaze',
  shatter: 'Shatter',
  mimicry: 'Mimicry',
};

export const PASSIVE_BLURBS: Record<string, string> = {
  scrounger: '+25% Spores from all loot & bounties, and scrounge Spores even from fights you lose or flee.',
  first_bite: 'Always strikes first in round 1.',
  regrowth: 'Heal 20% max HP after any battle.',
  drift: '+15% flee chance; bad mystery events reroll once.',
  undying: 'First compost each hour: revive at 50% HP instead.',
  vexing: '25% chance enemy strikes miss.',
  venom_barb: 'Your first strike each battle deals +3.',
  reach: "Round 1: the enemy's decisive blow misses — you strike from out of range.",
  spikeshell: 'Retaliate for 2 damage whenever a foe’s blow lands.',
  skitter: '25% chance enemy strikes miss.',
  outpace: "Round 1: the enemy's decisive blow misses — you strike from out of range.",
  flurry: '25% chance for a bonus strike each round.',
  rootwall: 'Regrowth improves to 35%.',
  dredge: 'Reclaim your snare after it triggers.',
  doubling_rot: 'Mystery-event Spore payouts doubled.',
  soul_trophy: 'After any won fight, choose a stat — gain +[foe level] to it for your next battle.',
  deathtouch_stomp: 'Your strikes ignore 3 of the enemy’s DEF.',
  drain_life: 'Heal for 50% of damage you deal.',
  rot_breath: 'Round-1 strike hits for double.',
  swarm: 'One extra strike every battle round.',
  spell_haste: 'Your spell cooldowns are halved — cast twice as often.',
  spell_warrior: 'Buffs and heals you cast on yourself are doubled.',
  spell_mage: 'Your damaging spells deal +50% and are twice as likely to land.',
  wish: 'Learn Wish: cast any spell in the world, from any list.',
  stonewright: 'Upgrades she forges come out hardened (Gear+); her active pet fights a step above its level.',
  stone_gaze: 'Reads come easily; each read petrifies the foe — stacking slow that ends in a one-round freeze.',
  shatter: 'A winning Aggress cracks the foe (Brittle); your blows then hit the cracks for extra.',
  mimicry: 'At the first blow it takes the shape of its prey — a stat bump matching how the foe fights.',
};

export const STARTERS: FormInfo[] = [
  {
    id: 'pest', name: 'Pest', tier: 1, passive: 'scrounger', passiveName: 'Scrounger',
    blurb: 'A balanced sewer rat. Never hungry, never broke.',
    stats: { hp: 25, atk: 5, def: 5, spd: 5 },
  },
  {
    id: 'kraul', name: 'Kraul Grub', tier: 1, passive: 'first_bite', passiveName: 'First Bite',
    blurb: 'A glass-cannon insect. Bites first, asks never.',
    stats: { hp: 25, atk: 6, def: 3, spd: 5 },
  },
  {
    id: 'saproling', name: 'Saproling', tier: 1, passive: 'drift', passiveName: 'Endless Ranks',
    blurb: 'A quick, expendable plant token — the swarm made flesh.',
    stats: { hp: 25, atk: 5, def: 5, spd: 6 },
  },
  {
    id: 'zombie', name: 'Zombie', tier: 1, passive: 'regrowth', passiveName: 'Regrowth',
    blurb: "Was somebody once; dead now, and it doesn't stay down.",
    stats: { hp: 25, atk: 5, def: 6, spd: 3 },
  },
  {
    id: 'squirrel', name: 'Squirrel', tier: 1, passive: 'spell_haste', passiveName: 'Spell Haste',
    blurb: 'A twitchy little caster — spells recharge twice as fast.',
    stats: { hp: 25, atk: 5, def: 4, spd: 7 },
  },
  {
    id: 'elf', name: 'Elf', tier: 1, passive: 'stonewright', passiveName: 'Stonewright',
    blurb: 'Ancient and long-lived — born gifted, slow to grow; her power is in her works.',
    stats: { hp: 25, atk: 6, def: 6, spd: 4 },
  },
];

export const TIER2: FormInfo[] = [
  { id: 'brackish_trudge', name: 'Brackish Trudge', tier: 2, line: 'pest', passive: 'undying', passiveName: 'Undying', bonus: { maxHp: 6, atk: 2 }, blurb: 'Bruiser (+HP/+ATK).' },
  { id: 'vexing_pest', name: 'Vexing Pest', tier: 2, line: 'pest', passive: 'vexing', passiveName: 'Vexing', bonus: { spd: 2, atk: 2 }, blurb: 'Speedster (+SPD/+ATK).' },
  { id: 'kraul_warrior', name: 'Grave Scarab', tier: 2, line: 'kraul', passive: 'venom_barb', passiveName: 'Venom Barb', bonus: { atk: 4 }, blurb: 'Striker (+ATK).' },
  { id: 'golgari_longlegs', name: 'Golgari Longlegs', tier: 2, line: 'kraul', passive: 'reach', passiveName: 'Reach', bonus: { spd: 4 }, blurb: 'Skirmisher (+SPD).' },
  { id: 'slitherhead', name: 'Slitherhead', tier: 2, line: 'saproling', passive: 'skitter', passiveName: 'Skitter', bonus: { spd: 4 }, blurb: 'Darter (+SPD).' },
  { id: 'woodwraith_strangler', name: 'Sporeback Skirmisher', tier: 2, line: 'saproling', passive: 'outpace', passiveName: 'Outpace', bonus: { spd: 2, maxHp: 4 }, blurb: 'Skirmisher (+SPD/+HP).' },
  { id: 'corpsejack_menace', name: 'Jungle Creeper', tier: 2, line: 'saproling', passive: 'flurry', passiveName: 'Flurry', bonus: { spd: 2, atk: 2 }, blurb: 'Whirlwind (+SPD/+ATK).' },
  { id: 'shambling_shell', name: 'Shambling Shell', tier: 2, line: 'zombie', passive: 'spikeshell', passiveName: 'Spiked Shell', bonus: { maxHp: 6, def: 2 }, blurb: 'Thorned bulwark (+HP/+DEF).' },
  { id: 'deathrite_shaman', name: 'Deathrite Shaman', tier: 2, line: 'zombie', passive: 'soul_trophy', passiveName: 'Soul Trophy', bonus: { maxHp: 6, def: 2 }, blurb: 'Grave ritualist (+HP/+DEF).' },
  { id: 'underrealm_lich', name: 'Underrealm Lich', tier: 2, line: 'zombie', passive: 'rootwall', passiveName: 'Rootwall', bonus: { maxHp: 6, atk: 2 }, blurb: 'Regenerating necromancer — 35% regrow + innate Mend Flesh (+HP/+ATK).' },
  { id: 'squirrel_warrior', name: 'Vinereap Mentor', tier: 2, line: 'squirrel', passive: 'spell_warrior', passiveName: 'Spell Warrior', bonus: { maxHp: 6, atk: 2 }, blurb: 'Spellblade — self-buffs doubled (+HP/+ATK).' },
  { id: 'squirrel_mage', name: 'Squirrel Mage', tier: 2, line: 'squirrel', passive: 'spell_mage', passiveName: 'Spell Mage', bonus: { maxHp: 4, spd: 2 }, blurb: 'Battlemage — +50% spell damage (+HP/+SPD).' },
  { id: 'wood_lurker', name: 'Wood Lurker', tier: 2, line: 'elf', passive: 'mimicry', passiveName: 'Mimicry', bonus: { maxHp: 6 }, blurb: 'Ambush shapeshifter (+HP).' },
  { id: 'gorgon', name: 'Gorgon', tier: 2, line: 'elf', passive: 'stone_gaze', passiveName: 'Stone Gaze', bonus: { spd: 2, atk: 2 }, blurb: 'Gaze-hunter (+SPD/+ATK).' },
];

export const APEX: (FormInfo & { from: string[] })[] = [
  { id: 'grave_titan', name: 'Grave Titan', tier: 3, passive: 'deathtouch_stomp', passiveName: 'Deathtouch Stomp', bonus: { maxHp: 6, def: 2 }, blurb: 'HP/DEF colossus.', from: ['brackish_trudge', 'shambling_shell', 'deathrite_shaman', 'underrealm_lich', 'wood_lurker'] },
  { id: 'golgari_lich_lord', name: 'Golgari Lich Lord', tier: 3, passive: 'drain_life', passiveName: 'Drain Life', bonus: { atk: 2, maxHp: 6 }, blurb: 'ATK/HP sovereign of rot.', from: ['brackish_trudge', 'kraul_warrior', 'shambling_shell', 'deathrite_shaman', 'underrealm_lich', 'wood_lurker'] },
  { id: 'swamp_dragon', name: 'Swamp Dragon', tier: 3, passive: 'rot_breath', passiveName: 'Rot Breath', bonus: { atk: 2, spd: 2 }, blurb: 'ATK/SPD terror of the deep tunnels.', from: ['vexing_pest', 'kraul_warrior', 'golgari_longlegs', 'slitherhead', 'woodwraith_strangler', 'corpsejack_menace', 'squirrel_warrior', 'gorgon'] },
  { id: 'izoni', name: 'Daemogoth Titan', tier: 3, passive: 'swarm', passiveName: 'Swarm', bonus: { spd: 4 }, blurb: 'SPD incarnate — strikes from the shadows, faster than the eye can track.', from: ['vexing_pest', 'golgari_longlegs', 'slitherhead', 'woodwraith_strangler', 'corpsejack_menace', 'squirrel_mage', 'gorgon'] },
  { id: 'calamity_beast', name: 'Calamity Beast', tier: 3, passive: 'wish', passiveName: 'Wish', bonus: { maxHp: 6, spd: 2 }, blurb: 'Learns Wish — cast ANY spell in the world.', from: ['squirrel_warrior', 'squirrel_mage', 'deathrite_shaman', 'vexing_pest', 'corpsejack_menace'] },
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
