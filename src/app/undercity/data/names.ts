/** Golgari-flavored name suggestions for the hatch naming step. */
export const NAME_POOL: string[] = [
  'Mulch',
  'Chitters',
  'Sporeling',
  'Wriggle',
  'Grubbles',
  'Rotwick',
  'Squelch',
  'Mossbite',
  'Fester',
  'Nibbles',
  'Bogdan',
  'Sludge',
  'Puffcap',
  'Skitter',
  'Molder',
  'Thallid',
  'Gnawbone',
  'Creeper',
  'Duskmaw',
  'Loam',
  'Grimble',
  'Vermis',
  'Snaggle',
  'Cinderslug',
  'Wormwood',
  'Blightbud',
  'Scuttle',
  'Marrowick',
  'Truffle',
  'Gristle',
  'Bramblefang',
  'Murk',
  'Tendril',
  'Pox',
  'Shamblekin',
  'Gullet',
  'Netherbite',
  'Slorp',
  'Cankerpaw',
  'Umbral',
];

/** Random suggestion; pass the current one to guarantee the reroll changes it. */
export function randomCreatureName(exclude?: string): string {
  const pool = exclude ? NAME_POOL.filter((n) => n !== exclude) : NAME_POOL;
  return pool[Math.floor(Math.random() * pool.length)];
}
