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
  thick: { stance: 'guard', label: 'Thick', blurb: 'Guard chips in a stall; softer when wrong.' },
  spiked: { stance: 'guard', label: 'Spiked', blurb: 'Guard counter reflects part of the blocked hit.' },
  trickster: { stance: 'feint', label: 'Trickster', blurb: "A lost Feint isn't fully punished." },
  serrated: { stance: 'feint', label: 'Serrated', blurb: "Feint break lowers the enemy's next-round damage." },
  glint: { stance: 'feint', label: 'Glint', blurb: 'Winning a Feint reveals the true next intent; +read rate.' },
  seer: { stance: 'feint', label: 'Seer', blurb: "Sharply raises how often you read the enemy's intent." },
  // Gear expansion (2026-07-20)
  bloodfang: { stance: 'aggress', label: 'Bloodfang', blurb: 'Heal 40% of your winning Aggress damage.' },
  rabid: { stance: 'aggress', label: 'Rabid', blurb: 'Each Aggress win, your Aggress hits gain +2 for the fight.' },
  gutcleaver: { stance: 'aggress', label: 'Gutcleaver', blurb: 'Winning Aggress vs a foe below 30% HP deals +50%.' },
  bramble: { stance: 'guard', label: 'Bramble', blurb: 'Reflect 2 damage whenever you are struck.' },
  bulwark: { stance: 'guard', label: 'Bulwark', blurb: 'Each round you Guard, +1 DEF for the fight.' },
  mossback: { stance: 'guard', label: 'Mossback', blurb: 'Heal 3 each round you end in Guard.' },
  venomtrick: { stance: 'feint', label: 'Venomtrick', blurb: 'Winning a Feint applies 1 rot.' },
  cutpurse: { stance: 'feint', label: 'Cutpurse', blurb: 'Land a winning Feint for +6 Spores after a win.' },
};

/** Creature passive id → the stance it augments. Only passives that clearly boost
 *  a single stance are listed; stance-agnostic passives (vexing, scavenge, swarm…)
 *  are deliberately omitted so the buttons stay honest. */
export const PASSIVE_AUGMENTS: Record<string, Omit<StanceAugment, 'source'>> = {
  venom_barb: { stance: 'aggress', label: 'Venom Barb', blurb: 'Your first strike each battle deals +3.' },
  deathtouch_stomp: { stance: 'aggress', label: 'Deathtouch Stomp', blurb: "Your strikes ignore 3 of the enemy's DEF." },
  rot_breath: { stance: 'aggress', label: 'Rot Breath', blurb: 'Your round-1 strike hits for double.' },
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
  glowveil: { label: 'Glowveil', icon: 'flare', tone: 'buff',
    blurb: '+2 SPD and easier to flee this battle.' },
  bone_chill: { label: 'Bone Chill', icon: 'ac_unit', tone: 'debuff',
    blurb: 'Cursed: -2 ATK this battle.' },
  weaken_hex: { label: 'Weaken Hex', icon: 'heart_broken', tone: 'debuff',
    blurb: 'Cursed: -3 ATK this battle.' },
  cursed_idol: { label: 'Cursed', icon: 'dangerous', tone: 'debuff',
    blurb: 'A lingering curse saps this fighter.' },
  vines: { label: 'Bog Snare', icon: 'grass', tone: 'debuff',
    blurb: 'Snared by clinging vines.' },
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
  return [...chips, ...mapped];
}
