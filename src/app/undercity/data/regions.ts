/**
 * Per-region flavor for the 5 surface biomes — name, backdrop art, hatch perk,
 * lore, and the signature "what you can do here" feature. Single source shared
 * by the hatch home-picker, the board tunnel signposts, and the Nyx Weaver
 * tunnel-crossing dialogue. Only the 5 tunnel-connected surface biomes are
 * defined; regionInfo() returns undefined for others (isle/ruin/depths/wilderness).
 */
export interface RegionInfo {
  id: string;
  name: string;
  bg: string; // 'undercity/<x>_background.webp'
  tint: string;
  perk: string;
  blurb: string;
  lore: string;
  feature: { name: string; desc: string };
}

export const REGION_LIST: RegionInfo[] = [
  { id: 'city', name: 'The Undercity', bg: 'undercity/undercity_background.webp', tint: 'rgba(38, 120, 110, 0.35)',
    perk: 'City Rat', blurb: 'Hatch with a random Tier-1 item, equipped.',
    lore: 'A warren of crooked tunnels and black-market stalls beneath the palace. ' +
      'If it can be bought, stolen, or pried loose, it changes hands down here.',
    feature: { name: 'The Guildvault', desc: 'Crack the tumbler lock — read the sigils right to walk off with a fat prize.' } },
  { id: 'cavern', name: 'Mosslight Cavern', bg: 'undercity/cavern_background.webp', tint: 'rgba(70, 96, 190, 0.35)',
    perk: 'Darkvision', blurb: 'See 2 spaces away in dungeons.',
    lore: 'Deep galleries lit by glowing moss and seams of raw crystal. ' +
      'The dark keeps few secrets from those born to it.',
    feature: { name: 'Crystal Veins', desc: 'Mine glittering gems straight from the cavern walls.' } },
  { id: 'bog', name: 'The Sedgemoor', bg: 'undercity/swamp_background.webp', tint: 'rgba(52, 110, 60, 0.32)',
    perk: 'Mirefoot', blurb: 'Hazards cost you half, and rival spells more often miss you.',
    lore: 'A drowned expanse of reeking sedge and sunken paths, presided over by an old ' +
      'witch who trades in stranger currencies than Spores.',
    feature: { name: 'The Sedgemoor Witch', desc: 'Buy spell scrolls, or inscribe them into a grimoire of your own.' } },
  { id: 'bone', name: 'Ossuary Fields', bg: 'undercity/ossuary_field.webp', tint: 'rgba(150, 150, 130, 0.30)',
    perk: 'Marrowborn', blurb: '+8 Max HP.',
    lore: 'Endless drifts of bleached bone — the palace’s dead, and older things beneath them. ' +
      'Good digging, if you’re not squeamish.',
    feature: { name: 'Excavation Sites', desc: 'Dig through buried plots to unearth long-lost gear.' } },
  { id: 'garden', name: 'The Rot-Gardens', bg: 'undercity/rot_gardens.webp', tint: 'rgba(140, 170, 40, 0.34)',
    perk: 'Composter', blurb: '+2 Spores from every loot space.',
    lore: 'Terraced beds of glorious decay where the Golgari cycle turns fastest — ' +
      'death feeding growth feeding death.',
    feature: { name: 'The Spore Shrine', desc: 'Offer your Spores to permanently raise an attribute.' } },
];

export const REGIONS: Record<string, RegionInfo> = Object.fromEntries(
  REGION_LIST.map((r) => [r.id, r]),
);

export function regionInfo(id: string | undefined): RegionInfo | undefined {
  return REGIONS[id ?? ''];
}

/** Minimal node shape tunnelDest needs (structural — no board-canvas import). */
interface GraphNode {
  id: string;
  region?: string;
  neighbors: string[];
}

/** A tunnel joins two regions; its destination is the neighbor region that
 *  differs from the tunnel's own side. Returns null if it doesn't bridge two. */
export function tunnelDest(nodes: GraphNode[], node: GraphNode): string | null {
  const byId = new Map(nodes.map((n) => [n.id, n]));
  for (const nb of node.neighbors) {
    const r = byId.get(nb)?.region;
    if (r && r !== node.region) return r;
  }
  return null;
}
