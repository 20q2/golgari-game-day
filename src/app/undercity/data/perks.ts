// Mirror of infrastructure/lambda/undercity_data.py PERKS / PERK_TRACKS.
// Perks derive from base stat (species base + level spends + evolution bonuses)
// PLUS equipped gear — gear can bridge a creature up to a threshold, so swapping
// gear may light/dim a perk. Temporary buffs still never count. Nodes at 6/12/18;
// base stats can already light the tier-1 node. Keep in sync with the server.
export type PerkTrack = 'atk' | 'def' | 'spd';

export interface Perk {
  id: string;
  name: string;
  track: PerkTrack;
  threshold: 6 | 12 | 18;
  blurb: string;
}

export const PERK_TRACKS: Record<PerkTrack, { threshold: 6 | 12 | 18; id: string }[]> = {
  atk: [
    { threshold: 6, id: 'rend' },
    { threshold: 12, id: 'menace' },
    { threshold: 18, id: 'deathdrive' },
  ],
  def: [
    { threshold: 6, id: 'thick_hide' },
    { threshold: 12, id: 'carapace_grind' },
    { threshold: 18, id: 'last_stand' },
  ],
  spd: [
    { threshold: 6, id: 'fleetfoot' },
    { threshold: 12, id: 'pathfinder' },
    { threshold: 18, id: 'blink' },
  ],
};

export const PERKS: Record<string, Perk> = {
  rend: { id: 'rend', name: 'Rend', track: 'atk', threshold: 6, blurb: 'A winning Aggress always applies 1 rot.' },
  menace: { id: 'menace', name: 'Menace', track: 'atk', threshold: 12, blurb: 'Enemies bluff you less often.' },
  deathdrive: { id: 'deathdrive', name: 'Deathdrive', track: 'atk', threshold: 18, blurb: 'Below half HP, your Aggress swings hit harder.' },
  thick_hide: { id: 'thick_hide', name: 'Thick Hide', track: 'def', threshold: 6, blurb: 'Halve HP lost to hazards and bad mystery rolls.' },
  carapace_grind: { id: 'carapace_grind', name: 'Carapace Grind', track: 'def', threshold: 12, blurb: '+15 Max HP, and holding Guard grinds the foe down even when you don’t win the exchange.' },
  last_stand: { id: 'last_stand', name: 'Last Stand', track: 'def', threshold: 18, blurb: 'Survive one lethal blow per descent at 1 HP.' },
  fleetfoot: { id: 'fleetfoot', name: 'Fleetfoot', track: 'spd', threshold: 6, blurb: 'You may reroll a die that shows 1.' },
  pathfinder: { id: 'pathfinder', name: 'Pathfinder', track: 'spd', threshold: 12, blurb: 'Roll with advantage — roll two dice, keep either.' },
  blink: { id: 'blink', name: 'Blink', track: 'spd', threshold: 18, blurb: 'Choose your die value — then recharges for one roll.' },
};

/** The perks unlocked at a given invested stat value on one track. */
export function unlockedOnTrack(track: PerkTrack, value: number): string[] {
  return PERK_TRACKS[track].filter((n) => value >= n.threshold).map((n) => n.id);
}
