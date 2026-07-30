// Display mirror of the server enraged-monster tunables
// (infrastructure/lambda/undercity_config.py + undercity_data.py). Keep in sync
// when server numbers change — see CLAUDE.md mirror convention.

export const ENRAGED = {
  dwellMin: 90, // ENRAGED_DWELL_MIN
  killRenown: 18, // ENRAGED_KILL_RENOWN
  killXp: 30, // ENRAGED_KILL_XP
  // Roster display names, keyed by monsterId (undercity_data.ENRAGED_MONSTERS).
  names: {
    enr_brute: 'Enraged Bloodhulk',
    enr_carapace: 'Enraged Shellback',
    enr_swift: 'Enraged Fenstalker',
    enr_ravager: 'Enraged Ravager',
  } as Record<string, string>,
};

// Placeholder art path: the board's guardian sprite loader falls back to a
// generic token until real PNGs land under public/undercity/enraged/<id>.png.
export const ENRAGED_SPRITE_DIR = 'undercity/enraged';
