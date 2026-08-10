/** Client display copy for the stance-triangle combat (mirrors undercity_data.py). */
import { Stance, BattleStatus } from '../services/undercity-models';
import { GEAR_MAP } from './items';

export interface StanceInfo {
  id: Stance;
  label: string;
  icon: string; // Material Icons ligature
  blurb: string; // what it beats, one line
}

// Stance icons mirror the stat they lean on: Aggress↔ATK (uc-sword), Guard↔DEF
// (uc-shield), Feint↔SPD (uc-bolt). `uc-`-prefixed tokens are SVG icons ([svgIcon]).
export const STANCES: StanceInfo[] = [
  { id: 'aggress', label: 'Aggress', icon: 'uc-sword', blurb: 'Beats Feint. Loses to Guard. Damage scales with ATK.' },
  { id: 'guard', label: 'Guard', icon: 'uc-shield', blurb: 'Beats Aggress. Loses to Feint. DEF hits back and soaks incoming damage.' },
  { id: 'feint', label: 'Feint', icon: 'uc-bolt', blurb: 'Beats Guard. Loses to Aggress. A quick SPD strike — wins the read, not the slugfest.' },
];

export const STANCE_MAP: Record<Stance, StanceInfo> = Object.fromEntries(
  STANCES.map((s) => [s.id, s]),
) as Record<Stance, StanceInfo>;

/** The stance that beats `s` — a client hint only; the server is authoritative. */
export const COUNTER: Record<Stance, Stance> = {
  aggress: 'guard',
  guard: 'feint',
  feint: 'aggress',
};

/** Personality → the tell shown before a fight ("the beast looks…"). */
export const PERSONALITY_TELL: Record<string, string> = {
  brute: 'itching to lunge',
  turtle: 'hunkered down',
  trickster: 'shifting and feinting',
  balanced: 'reading you',
};

/** Telegraph verb the monster shows for its next move. */
export const TELEGRAPH_TEXT: Record<Stance, string> = {
  aggress: 'coils to strike',
  guard: 'braces to block',
  feint: 'weaves a trick',
};

/** Combat escalation: from FRENZY_START each creature's OWN swings ramp up
 *  (the arena never deals damage) so a dragging fight resolves to a real kill.
 *  Mirrors undercity_data.py FRENZY_START/FRENZY_RAMP — display only. */
export const FRENZY_START = 4;
export const FRENZY_RAMP = 0.2;

// ── Stance augments ──────────────────────────────────────────────────────────
// Equipped gear riders and stance-specific creature passives change what a stance
// does; these tables let the combat UI surface them on the matching stance button.

/** An equipped effect that augments one stance's outcome. */
export interface StanceAugment {
  stance: Stance;
  /** Short tag shown on the button, e.g. "Barbed". */
  label: string;
  /** Full effect, shown in the button tooltip. */
  blurb: string;
  source: 'gear' | 'passive';
}

/** Gear rider id → the stance it augments (mirrors GEAR_RIDERS in undercity_data.py). */
export const RIDER_AUGMENTS: Record<string, Omit<StanceAugment, 'source'>> = {
  barbed: { stance: 'aggress', label: 'Barbed', blurb: 'Aggress applies rot even on a clash or loss.' },
  deep_biter: { stance: 'aggress', label: 'Deep-biter', blurb: 'Winning exchanges hit harder.' },
  thick: { stance: 'guard', label: 'Thick', blurb: 'Guard chips even in a stall, and cuts the damage of a wrong guess.' },
  spiked: { stance: 'guard', label: 'Spiked', blurb: 'Only when you Guard: your counter throws back a multiple of the blocked blow.' },
  trickster: { stance: 'feint', label: 'Trickster', blurb: "A lost Feint isn't fully punished." },
  serrated: { stance: 'feint', label: 'Serrated', blurb: "Feint break lowers the enemy's next-round damage." },
  glint: { stance: 'feint', label: 'Glint', blurb: 'Win a Feint and you SEE the next intent outright. Small passive read bonus too.' },
  seer: { stance: 'feint', label: 'Seer', blurb: 'No trigger, no condition: a large standing boost to your read rate.' },
  // Gear expansion (2026-07-20)
  // Family blurbs stay number-free — magnitudes scale with rarity, and each
  // piece's own desc (see items.ts GEAR) carries the exact figure per tier.
  bloodfang: { stance: 'aggress', label: 'Bloodfang', blurb: 'Heal a share of your winning Aggress damage.' },
  rabid: { stance: 'aggress', label: 'Rabid', blurb: 'Each Aggress win, your Aggress hits ramp up for the fight.' },
  gutcleaver: { stance: 'aggress', label: 'Gutcleaver', blurb: 'Winning Aggress vs a foe below half HP deals bonus damage.' },
  bramble: { stance: 'guard', label: 'Bramble', blurb: 'Thorns: reflect flat damage whenever you are struck, in any stance.' },
  bulwark: { stance: 'guard', label: 'Bulwark', blurb: 'Each round you Guard, gain DEF for the fight.' },
  mossback: { stance: 'guard', label: 'Sunleaf', blurb: 'Heal each round you end in Guard.' },
  venomtrick: { stance: 'feint', label: 'Venomtrick', blurb: 'Winning a Feint applies rot.' },
  cutpurse: { stance: 'feint', label: 'Cutpurse', blurb: 'Land a winning Feint for bonus Spores after a win.' },
};

/** Properties that define a piece WITHOUT a stance rider (mirrors
 *  GEAR_PROPS_EXTRA in undercity_data.py). Every gear piece has exactly one
 *  named property, so the item card can always chip something. */
export const GEAR_PROPS_EXTRA: Record<string, { stance: null; label: string; blurb: string }> = {
  illuminating: { stance: null, label: 'Illuminating',
    blurb: 'Lights the whole dungeon floor while equipped.' },
  vital: { stance: null, label: 'Vital',
    blurb: 'Raw survivability — a deep pool of extra Max HP.' },
  hybrid: { stance: null, label: 'Hybrid',
    blurb: 'Splits its budget across two attributes, so one piece can feed two perk tracks.' },
};

/** The named property of a gear piece — its stance rider, or the off-ladder
 *  family that defines it. Mirrors undercity_data.gear_property(). */
export function gearProperty(
  gear: { rider?: string; prop?: string } | undefined,
): { label: string; blurb: string; stance: string | null } | undefined {
  const key = gear?.prop ?? gear?.rider;
  if (!key) return undefined;
  return RIDER_AUGMENTS[key] ?? GEAR_PROPS_EXTRA[key];
}

/** Creature passive id → the stance it augments. Only passives that clearly boost
 *  a single stance are listed; stance-agnostic passives (vexing, spikeshell, swarm…)
 *  are deliberately omitted so the buttons stay honest. */
export const PASSIVE_AUGMENTS: Record<string, Omit<StanceAugment, 'source'>> = {
  venom_barb: { stance: 'aggress', label: 'Venom Barb', blurb: 'Each decisive strike injects a poison stack (rot).' },
  onslaught: { stance: 'aggress', label: 'Onslaught', blurb: 'Your round-1 strike hits for double.' },
};

/** Build the stance-augment list from the player's equipped gear + passives. */
export function computeStanceAugments(
  gear: Record<string, string> | undefined,
  passives: string[] | undefined,
): StanceAugment[] {
  const out: StanceAugment[] = [];
  for (const id of Object.values(gear ?? {})) {
    const rider = GEAR_MAP[id]?.rider;
    const aug = rider ? RIDER_AUGMENTS[rider] : undefined;
    if (aug) out.push({ ...aug, source: 'gear' });
  }
  for (const p of passives ?? []) {
    const aug = PASSIVE_AUGMENTS[p];
    if (aug) out.push({ ...aug, source: 'passive' });
  }
  return out;
}

// ── In-battle status chips ────────────────────────────────────────────────────

export interface StatusInfo {
  label: string;
  icon: string; // Material Icons ligature
  tone: 'buff' | 'debuff';
  blurb: string;
}

/** Effect kind -> chip display. `rot` is included alongside the buff kinds.
 *  Icons mirror the ligatures used for these effects in spells.ts. Any kind not
 *  listed here is skipped, so a new buff shows nothing until it gets an entry. */
export const STATUS_INFO: Record<string, StatusInfo> = {
  rot: { label: 'Rot', icon: 'coronavirus', tone: 'debuff',
    blurb: 'Festering: takes damage at the end of each round. More stacks, more damage.' },
  harden_shell: { label: 'Harden Shell', icon: 'shield', tone: 'buff',
    blurb: '+2 DEF for this battle.' },
  rot_surge: { label: 'Rot Surge', icon: 'local_fire_department', tone: 'buff',
    blurb: '+3 ATK; Aggress applies rot to the foe.' },
  acorn_fury: { label: 'Acorn Fury', icon: 'park', tone: 'buff',
    blurb: '+2 ATK for this battle.' },
  glowveil: { label: 'Glowveil', icon: 'flare', tone: 'buff',
    blurb: '+2 SPD and easier to flee this battle.' },
  bone_chill: { label: 'Bone Chill', icon: 'ac_unit', tone: 'debuff',
    blurb: 'Cursed: -2 ATK this battle.' },
  grave_chill: { label: 'Grave Chill', icon: 'severe_cold', tone: 'debuff',
    blurb: 'Grave-cold: -3 ATK and -2 DEF this battle.' },
  weaken_hex: { label: 'Weaken Hex', icon: 'heart_broken', tone: 'debuff',
    blurb: 'Cursed: -3 ATK this battle.' },
  cursed_idol: { label: 'Cursed', icon: 'dangerous', tone: 'debuff',
    blurb: 'A lingering curse saps this fighter.' },
  vines: { label: 'Bog Snare', icon: 'grass', tone: 'debuff',
    blurb: 'Snared by clinging vines.' },
  savage_roar: { label: 'Savage Roar', icon: 'whatshot', tone: 'buff',
    blurb: '+5 ATK for this battle.' },
  iron_hide: { label: 'Iron Hide', icon: 'security', tone: 'buff',
    blurb: '+4 DEF for this battle.' },
  fleetfoot: { label: 'Fleetfoot', icon: 'directions_run', tone: 'buff',
    blurb: '+3 SPD for this battle.' },
  warding_dance: { label: 'Warding Dance', icon: 'sports_martial_arts', tone: 'buff',
    blurb: '+3 DEF and +3 SPD for this battle.' },
  // Sovereign's Draught runs its own kinds so it layers on top of the tonics
  // rather than overlapping them.
  sovereign_might: { label: "Sovereign's Might", icon: 'local_fire_department', tone: 'buff',
    blurb: '+4 ATK. Stacks with a Bone Whetstone.' },
  sovereign_ward: { label: "Sovereign's Ward", icon: 'shield_moon', tone: 'buff',
    blurb: '+2 DEF. Stacks with Carapace Wax.' },
  sovereign_haste: { label: "Sovereign's Haste", icon: 'bolt', tone: 'buff',
    blurb: '+2 SPD. Stacks with a Fleetfoot Tonic.' },
  sap_vigor: { label: 'Sapped', icon: 'hourglass_bottom', tone: 'debuff',
    blurb: 'Cursed: -3 SPD this battle.' },
  rust_curse: { label: 'Rust Curse', icon: 'broken_image', tone: 'debuff',
    blurb: 'Cursed: -4 DEF this battle.' },
  high_five: { label: 'High Five', icon: 'back_hand', tone: 'buff',
    blurb: '+1 ATK/DEF/SPD this battle.' },
  trophy: { label: 'Soul Trophy', icon: 'military_tech', tone: 'buff',
    blurb: 'A trophy from the slain: +[foe level] to a chosen stat this battle.' },
  // Boss-familiar signature traits (design 2026-08-04). Shown on the foe so the
  // familiar teaches the boss's trick; stacking ones carry a live ×N count.
  grave_growth: { label: 'Grave Growth', icon: 'trending_up', tone: 'debuff',
    blurb: 'The grave keeps growing: gains ATK/DEF every round it survives.' },
  doom_counters: { label: 'Doom', icon: 'change_history', tone: 'debuff',
    blurb: 'Compounds: +2 ATK/DEF/SPD each round it wins or ties. Force it to lose.' },
  dredge: { label: 'Dredge', icon: 'healing', tone: 'debuff',
    blurb: 'Knits its wounds shut a little each round. Out-pace the regrowth.' },
  swarm: { label: 'Swarm', icon: 'grain', tone: 'debuff',
    blurb: 'The brood piles on: an extra chip hit every round.' },
  web_venom: { label: 'Venom', icon: 'coronavirus', tone: 'debuff',
    blurb: 'Its winning strikes leave rot behind.' },
  venom_barb: { label: 'Venom Barb', icon: 'coronavirus', tone: 'buff',
    blurb: 'Every decisive strike injects a poison stack that gnaws each round — venom snowballs the longer the fight runs.' },
  // Gorgon abilities (design 2026-08-04).
  petrify: { label: 'Petrify', icon: 'hourglass_bottom', tone: 'debuff',
    blurb: 'Turning to stone: −SPD per stack; at 4 it freezes for a round, then resets.' },
  mimic: { label: 'Mimic', icon: 'theater_comedy', tone: 'buff',
    blurb: 'Shapeshifted to match the foe — a stat bump mirroring its fighting style.' },
};

export interface StatusChip {
  kind: string;
  count: number; // >1 shows a ×N badge (rot); buffs are always 1
  info: StatusInfo;
}

/** Ordered chips for one side: rot first (most actionable), then buffs, then
 *  debuffs. Unknown kinds are skipped. */
export function statusChips(status: BattleStatus | null | undefined): StatusChip[] {
  if (!status) return [];
  const chips: StatusChip[] = [];
  if (status.rot > 0) chips.push({ kind: 'rot', count: status.rot, info: STATUS_INFO['rot'] });
  const mapped = (status.buffs ?? [])
    .filter((k) => k !== 'rot' && STATUS_INFO[k])
    .map((k) => ({ kind: k, count: 1, info: STATUS_INFO[k] }));
  mapped.sort((a, b) => Number(a.info.tone === 'debuff') - Number(b.info.tone === 'debuff'));
  // Boss-familiar signature traits, with a live ×N badge for the stacking ones.
  const traits = (status.traits ?? [])
    .filter((k) => STATUS_INFO[k])
    .map((k) => ({ kind: k, count: status.stacks?.[k] ?? 1, info: STATUS_INFO[k] }));
  return [...chips, ...mapped, ...traits];
}
