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

// The tap-to-inspect identity of a tile a roaming enraged monster squats on:
// its own space-type name + Material Icon (shown in the board popover). The
// body blurb is built dynamically (live HP + relocate countdown) in
// board-tab.buildNodeInfo. `icon` is a Material Icons ligature — swap freely.
export const MONSTER_SPACE = {
  name: 'Monster Space',
  icon: 'pets',
};
