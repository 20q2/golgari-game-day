// Display mirror of the server World Event tunables
// (infrastructure/lambda/undercity_config.py + undercity_data.py). Keep in sync
// when server numbers change — see CLAUDE.md mirror convention.

export const WORLD_EVENT = {
  id: 'moor_wyrm',
  name: 'The Moor-Wyrm',
  spriteId: 'moor_wyrm',
  roundCap: 6,
  rewards: {
    vanquisher: { spores: 120, renown: 5 },
    major: { spores: 80, renown: 3 },
    minor: { spores: 45, renown: 2 },
    participant: { spores: 20, renown: 0 },
  } as Record<string, { spores: number; renown: number }>,
};

// Path (relative to the app base href) of the beast sprite.
export const WORLD_EVENT_SPRITE = 'undercity/sigil_boss/moor_wyrm.png';
