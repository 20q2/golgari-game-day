// Display mirror of the server enraged-monster tunables
// (infrastructure/lambda/undercity_config.py + undercity_data.py). Keep in sync
// when server numbers change — see CLAUDE.md mirror convention.

export const ENRAGED = {
  dwellMin: 90, // ENRAGED_DWELL_MIN
  killRenown: 18, // ENRAGED_KILL_RENOWN
  killXp: 30, // ENRAGED_KILL_XP
  // Roster display names, keyed by monsterId (undercity_data.ENRAGED_MONSTERS).
  names: {
    enr_brute: 'Enraged Lotleth Troll',
    enr_carapace: 'Enraged Sluiceway Scorpion',
    enr_swift: 'Enraged Leyline Prowler',
    enr_ravager: 'Enraged Golgari Rot Wurm',
  } as Record<string, string>,
  // Real enemy sprite each variant borrows, keyed by monsterId. Files live under
  // public/undercity/enemies/<sprite>.png; mirrors ENRAGED_MONSTERS['sprite'].
  sprites: {
    enr_brute: 'loleth_troll',
    enr_carapace: 'sluiceway_scorpion',
    enr_swift: 'leyline_prowler',
    enr_ravager: 'golgari_rotwurm',
  } as Record<string, string>,
};

// The roaming monster's art now resolves to a real enemy sprite via its
// server-sent spriteId (public/undercity/enemies/<spriteId>.png).
export const ENRAGED_SPRITE_DIR = 'undercity/enemies';

// The tap-to-inspect identity of a tile a roaming enraged monster squats on:
// its own space-type name + Material Icon (shown in the board popover). The
// body blurb is built dynamically (live HP + relocate countdown) in
// board-tab.buildNodeInfo. `icon` is a Material Icons ligature — swap freely.
export const MONSTER_SPACE = {
  name: 'Monster Space',
  icon: 'pets',
};
