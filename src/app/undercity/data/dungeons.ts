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
    hazardBlurb: 'Sticky broodsilk halves your next roll.',
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
    hazardBlurb: 'A bursting cloud flings you elsewhere in the hollow.',
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
    hazardBlurb: 'The murk claims 15% of your carried Spores.',
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
    hazardBlurb: 'Grave-cold: -2 ATK in your next battle.',
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
    hazardBlurb: 'Stinging pods: lose 3 HP, gain 4 Spores.',
    biomeName: 'The Rot-Gardens',
    lairNpcId: 'slimefoot',
  },
};

/** Guild Sigils needed to unseal the island boss — mirrors SIGILS_REQUIRED. */
export const SIGILS_REQUIRED = 3;

/** Biome key for a depths node ('city_d0' -> 'city'), else null. */
export function dungeonBiome(nodeId: string, region: string | undefined): string | null {
  if (region !== 'depths') return null;
  const biome = nodeId.split('_')[0];
  return biome in DUNGEONS ? biome : null;
}
