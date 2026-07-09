/**
 * Client mirror of the v6 dungeon identity tables in undercity_data.py —
 * display copy only (names, rites, hazard blurbs, wild ids). If you tune the
 * Python tables, update these too (same duplication rule as data/items.ts).
 */
export interface DungeonInfo {
  name: string;
  rite: string; // one-line flavor card shown on first descent per session
  wild: string; // NPC id — battle art at undercity/enemies/<id>.png
  hazardName: string;
  hazardBlurb: string;
}

export const DUNGEONS: Record<string, DungeonInfo> = {
  city: {
    name: 'The Broodwarrens',
    rite: 'The Broodwarrens. The walls pulse.',
    wild: 'broodling',
    hazardName: 'Webbing',
    hazardBlurb: 'Sticky broodsilk halves your next roll.',
  },
  cavern: {
    name: 'Gloomroot Hollow',
    rite: 'Gloomroot Hollow. The light here is alive.',
    wild: 'glowmite',
    hazardName: 'Spore Cloud',
    hazardBlurb: 'A bursting cloud flings you elsewhere in the hollow.',
  },
  bog: {
    name: 'The Drownedway',
    rite: 'The Drownedway. Black water swallows your steps.',
    wild: 'mire_leech',
    hazardName: 'Sinkwater',
    hazardBlurb: 'The murk claims 15% of your carried Spores.',
  },
  bone: {
    name: 'The Marrow Pits',
    rite: 'The Marrow Pits. The dead are load-bearing.',
    wild: 'gravewight',
    hazardName: 'Bone Chill',
    hazardBlurb: 'Grave-cold: -2 ATK in your next battle.',
  },
  garden: {
    name: 'The Rotcellar',
    rite: 'The Rotcellar. Sweet decay, thick as soup.',
    wild: 'rot_grub',
    hazardName: 'Rot Bloom',
    hazardBlurb: 'Stinging pods: lose 3 HP, gain 4 Spores.',
  },
};

/** Biome key for a depths node ('city_d0' -> 'city'), else null. */
export function dungeonBiome(nodeId: string, region: string | undefined): string | null {
  if (region !== 'depths') return null;
  const biome = nodeId.split('_')[0];
  return biome in DUNGEONS ? biome : null;
}
