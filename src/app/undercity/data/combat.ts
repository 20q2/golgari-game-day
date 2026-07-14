/** Client display copy for the stance-triangle combat (mirrors undercity_data.py). */
import { Stance } from '../services/undercity-models';

export interface StanceInfo {
  id: Stance;
  label: string;
  icon: string; // Material Icons ligature
  blurb: string; // what it beats, one line
}

export const STANCES: StanceInfo[] = [
  { id: 'aggress', label: 'Aggress', icon: 'sports_mma', blurb: 'Beats Feint. Loses to Guard.' },
  { id: 'guard', label: 'Guard', icon: 'shield', blurb: 'Beats Aggress. Loses to Feint.' },
  { id: 'feint', label: 'Feint', icon: 'theater_comedy', blurb: 'Beats Guard. Loses to Aggress.' },
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
