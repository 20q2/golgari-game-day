// Display mirror of the server World Event tunables
// (infrastructure/lambda/undercity_config.py + undercity_data.py). Keep in sync
// when server numbers change — see CLAUDE.md mirror convention.

export const WORLD_EVENT = {
  id: 'grothoma',
  name: 'Grothoma',
  spriteId: 'Grothoma',
  roundCap: 6,
  rewards: {
    vanquisher: { spores: 120, renown: 5, xp: 60 },
    major: { spores: 80, renown: 3, xp: 40 },
    minor: { spores: 45, renown: 2, xp: 25 },
    participant: { spores: 20, renown: 0, xp: 15 },
  } as Record<string, { spores: number; renown: number; xp: number }>,
};

// Damage check (design 2026-08-09): Grothoma has NO kill pool and cannot be
// felled. The hunt runs for `durationMin` from spawn; every blow is banked
// against your name, and when the clock expires the spoils are dealt out by
// bracket. Brackets are ABSOLUTE cumulative damage — what you earn depends only
// on what you dealt, never on how many others turned up — plus a Vanquisher
// crown for the single top dealer.
//
// The server drives all of this; these mirror values exist so the UI can show
// the bracket you are working toward. State carries `endsAt` (countdown),
// `totalDamage`, and `topDamage` in place of the old hp/maxHp bar.
export const WORLD_EVENT_DURATION_MIN = 90;
export const WORLD_EVENT_MAJOR_DAMAGE = 150;
export const WORLD_EVENT_MINOR_DAMAGE = 60;

/** Bracket a given cumulative damage total earns (ignoring the top-dealer crown). */
export function worldEventBracket(dealt: number): string {
  if (dealt >= WORLD_EVENT_MAJOR_DAMAGE) return 'major';
  if (dealt >= WORLD_EVENT_MINOR_DAMAGE) return 'minor';
  return 'participant';
}

// Path (relative to the app base href) of the beast sprite (head + neck, drawn
// on the footprint's center tile).
export const WORLD_EVENT_SPRITE = 'undercity/sigil_boss/Grothoma.png';

// A single serpent-body hump, drawn on each non-center footprint tile so the
// beast reads as one long body arcing across the run.
export const WORLD_EVENT_PIECE_SPRITE = 'undercity/sigil_boss/Grothoma_segment.png';
