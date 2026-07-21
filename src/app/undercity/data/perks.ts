// Mirror of infrastructure/lambda/undercity_data.py PERKS / PERK_TRACKS.
// Perks derive from the INVESTED base stat (species base + level spends +
// evolution bonuses), never gear/buffs. Nodes at 5/10/15; base stats can
// already light the tier-1 node. Keep in sync with the server.
export type PerkTrack = 'atk' | 'def' | 'spd';

export interface Perk {
  id: string;
  name: string;
  track: PerkTrack;
  threshold: 5 | 10 | 15;
  blurb: string;
}

export const PERK_TRACKS: Record<PerkTrack, { threshold: 5 | 10 | 15; id: string }[]> = {
  atk: [
    { threshold: 5, id: 'rend' },
    { threshold: 10, id: 'menace' },
    { threshold: 15, id: 'deathdrive' },
  ],
  def: [
    { threshold: 5, id: 'thick_hide' },
    { threshold: 10, id: 'carapace_grind' },
    { threshold: 15, id: 'last_stand' },
  ],
  spd: [
    { threshold: 5, id: 'fleetfoot' },
    { threshold: 10, id: 'pathfinder' },
    { threshold: 15, id: 'blink' },
  ],
};

export const PERKS: Record<string, Perk> = {
  rend: { id: 'rend', name: 'Rend', track: 'atk', threshold: 5, blurb: 'A winning Aggress always applies 1 rot.' },
  menace: { id: 'menace', name: 'Menace', track: 'atk', threshold: 10, blurb: 'Enemies bluff you less often.' },
  deathdrive: { id: 'deathdrive', name: 'Deathdrive', track: 'atk', threshold: 15, blurb: 'Below half HP, your Aggress swings hit harder.' },
  thick_hide: { id: 'thick_hide', name: 'Thick Hide', track: 'def', threshold: 5, blurb: 'Halve HP lost to hazards and bad mystery rolls.' },
  carapace_grind: { id: 'carapace_grind', name: 'Carapace Grind', track: 'def', threshold: 10, blurb: 'Holding Guard grinds the foe down even when you don’t win the exchange.' },
  last_stand: { id: 'last_stand', name: 'Last Stand', track: 'def', threshold: 15, blurb: 'Survive one lethal blow per descent at 1 HP.' },
  fleetfoot: { id: 'fleetfoot', name: 'Fleetfoot', track: 'spd', threshold: 5, blurb: 'You may reroll a die that shows 1.' },
  pathfinder: { id: 'pathfinder', name: 'Pathfinder', track: 'spd', threshold: 10, blurb: 'Roll with advantage — roll two dice, keep either.' },
  blink: { id: 'blink', name: 'Blink', track: 'spd', threshold: 15, blurb: 'Once per turn, choose your die value.' },
};

/** The perks unlocked at a given invested stat value on one track. */
export function unlockedOnTrack(track: PerkTrack, value: number): string[] {
  return PERK_TRACKS[track].filter((n) => value >= n.threshold).map((n) => n.id);
}
