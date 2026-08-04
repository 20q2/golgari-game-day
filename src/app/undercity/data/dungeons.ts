/**
 * Client mirror of the v6 dungeon identity tables in undercity_data.py —
 * display copy only (names, rites, hazard blurbs, wild ids). If you tune the
 * Python tables, update these too (same duplication rule as data/items.ts).
 */
export interface DungeonInfo {
  name: string;
  rite: string; // one-line flavor card shown on first descent per session
  wild: string; // NPC id — battle art at undercity/enemies/<id>.png
  wildName: string;
  lairName: string; // mirrors LAIR_BOSSES in undercity_data.py
  hazardName: string;
  hazardBlurb: string;
  /** Home biome's display name — mirrors BIOMES[<biome>].name in undercity_data.py. */
  biomeName: string;
  /** Lair boss NPC id — battle art at undercity/guardians/<id>.png. */
  lairNpcId: string;
}

export const DUNGEONS: Record<string, DungeonInfo> = {
  city: {
    name: 'The Broodwarrens',
    rite: 'The Broodwarrens. The walls pulse.',
    wild: 'broodling',
    wildName: 'Hatchery Spider',
    lairName: 'Ishkanah, Grafwidow',
    hazardName: 'Webbing',
    hazardBlurb: 'Broodsilk halves your next two rolls and bleeds 10% HP.',
    biomeName: 'The Undercity',
    lairNpcId: 'ishkanah',
  },
  cavern: {
    name: 'Gloomroot Hollow',
    rite: 'Gloomroot Hollow. The light here is alive.',
    wild: 'glowmite',
    wildName: 'Vigorspore Wurm',
    lairName: 'Sarulf, Realm Eater',
    hazardName: 'Spore Cloud',
    hazardBlurb: 'A bursting cloud flings you across the hollow and costs 15% HP.',
    biomeName: 'Mosslight Cavern',
    lairNpcId: 'sarulf',
  },
  bog: {
    name: 'The Drownedway',
    rite: 'The Drownedway. Black water swallows your steps.',
    wild: 'mire_leech',
    wildName: 'Festering Newt',
    lairName: 'the Gitrog Monster',
    hazardName: 'Sinkwater',
    hazardBlurb: 'The murk claims 25% of your Spores and drags you for 12% HP.',
    biomeName: 'The Sedgemoor',
    lairNpcId: 'gitrog_monster',
  },
  bone: {
    name: 'The Marrow Pits',
    rite: 'The Marrow Pits. The dead are load-bearing.',
    wild: 'gravewight',
    wildName: 'Wight of Precinct Six',
    lairName: 'Skullbriar, the Walking Grave',
    hazardName: 'Bone Chill',
    hazardBlurb: 'Grave-cold: −3 ATK / −2 DEF next battle, and 8 HP now.',
    biomeName: 'Ossuary Fields',
    lairNpcId: 'skullbriar',
  },
  garden: {
    name: 'The Rotcellar',
    rite: 'The Rotcellar. Sweet decay, thick as soup.',
    wild: 'rot_grub',
    wildName: 'Thallid',
    lairName: 'Slimefoot, the Stowaway',
    hazardName: 'Rot Bloom',
    hazardBlurb: 'Flaying pods: lose 15 HP, gain 12 Spores.',
    biomeName: 'The Rot-Gardens',
    lairNpcId: 'slimefoot',
  },
};

/** Familiar sprite ids whose battle art lives in public/undercity/boss_spawns/
 *  rather than undercity/enemies/. Mirrors LAIR_FAMILIAR[*].sprites in
 *  undercity_data.py (boss familiars, design 2026-08-04). */
export const BOSS_SPAWN_SPRITES = new Set<string>([
  'skullbriars_familiar',
  'slimefoots_saprolings',
  'gitrog_spawn',
  'gitrog_spawn2',
  'sarulfs_packmate',
  'ishankas_hatchling',
]);

/** Battle-art URL for an enemy sprite id, honoring the boss_spawns/ folder. */
export function enemyArtUrl(spriteId: string): string {
  const folder = BOSS_SPAWN_SPRITES.has(spriteId) ? 'boss_spawns' : 'enemies';
  return `undercity/${folder}/${spriteId}.png`;
}

/** Guild Sigils needed to unseal the island boss — mirrors SIGILS_REQUIRED. */
export const SIGILS_REQUIRED = 3;

/** Biome key for a depths node ('city_d0' -> 'city'), else null. */
export function dungeonBiome(nodeId: string, region: string | undefined): string | null {
  if (region !== 'depths') return null;
  const biome = nodeId.split('_')[0];
  return biome in DUNGEONS ? biome : null;
}
