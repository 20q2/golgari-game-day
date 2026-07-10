/** Shared shapes for the /game/state and /game/action payloads. */

export interface Season {
  seasonId: string;
  status: 'active' | 'ended';
  startedAt?: string;
  bossPhase: boolean;
}

export interface PublicPlayer {
  userId: string;
  username: string;
  species: string;
  form: string;
  formName: string;
  tier: number;
  level: number;
  hp: number;
  maxHp: number;
  position: string;
  stance: string;
  shieldUntil?: string | null;
  spores: number;
  rolls: number;
  pvpWins: number;
  wildWins: number;
  composts: number;
  paint: Record<string, number>;
  hat: string | null;
  renown: number;
}

export interface PendingMove {
  value: number;
  dests: string[];
}

export interface YouDoc {
  userId: string;
  username: string;
  species: string;
  form: string;
  tier: number;
  passives: string[];
  level: number;
  xp: number;
  statPoints: number;
  spentThisLevel: Record<string, number>;
  hp: number;
  maxHp: number;
  atk: number;
  def: number;
  spd: number;
  position: string;
  rolls: number;
  spores: number;
  /** Ossuary gambles left this visit; refills to 3 when you land there again. */
  ossuaryRollsLeft?: number;
  /** Excavation digs left this visit; refills to 3 when you land on a dig site. */
  excavationDigsLeft?: number;
  bag: string[];
  gear: Record<string, string>;
  stance: string;
  shieldUntil?: string | null;
  pendingMove?: PendingMove | null;
  pendingLoadedDie?: number;
  /** After a compost, the gate options to respawn at (home + last biome). */
  pendingRespawn?: { options: { gate: string; label: string }[] } | null;
  buffs: { kind: string; until?: string }[];
  taughtClaims: number;
  lastFinishedClaim?: string | null;
  pokesReceived: number;
  pvpWins: number;
  wildWins: number;
  composts: number;
  bossDamage: number;
  /** Barriers broken / lair first-kills / vault finds already claimed. */
  poiClaims?: string[];
  paint: Record<string, number>;
  hat: string | null;
  evolvedAt?: string;
  ver: number;
}

export interface GameEvent {
  type: string;
  text: string;
  ts: string;
  actor?: string;
}

export interface Standing {
  userId: string;
  username: string;
  renown: number;
  level: number;
  form: string;
  formName: string;
  species: string;
  pvpWins: number;
  wildWins: number;
  spores: number;
  paint: Record<string, number>;
  hat: string | null;
}

export interface SeasonResult {
  standings: Standing[];
  champion: Standing | null;
  endedAt: string;
}

export interface HallOfFameNight {
  seasonId: string;
  endedAt: string;
  champion: Standing;
  podium: Standing[];
}

export interface Wardrobe {
  hats: string[];
  paints: string[];
  seals: number;
  nights: number;
}

export interface GameState {
  season: Season | null;
  you: YouDoc | null;
  players: PublicPlayer[];
  snares: string[];
  /** Trading post node id -> its 3 shared stock slots. */
  tradingPosts?: Record<string, TradeStockItem[]>;
  /** Excavation node id -> its masked dig-site grid. */
  excavations?: Record<string, DigGrid>;
  /** Barrier node ids broken open this season (shared by all players). */
  barriersOpen?: string[];
  events: GameEvent[];
  result: SeasonResult | null;
  wardrobe?: Wardrobe;
  hallOfFame?: HallOfFameNight[];
}

export interface BattleStrike {
  round: number;
  by: 'attacker' | 'defender';
  dmg: number;
  miss?: boolean;
  heal?: number;
  retaliation?: boolean;
}

export interface BattleResult {
  outcome: 'attacker' | 'defender' | 'timeout' | 'fled';
  strikes: BattleStrike[];
  attackerHp: number;
  defenderHp: number;
  smokeSporeUsed?: boolean;
}

/** One slot of a trading post's shared stock. */
export interface TradeStockItem {
  item: string;
  foundBy: string;
}

/** Masked view of a shared excavation dig site. */
export interface DigItemView {
  idx: number;
  shape: string;
  collected: boolean;
  by: string | null;
}

export interface DigGrid {
  w: number;
  h: number;
  /** Row-major: -2 covered, -1 revealed rubble, >=0 revealed item index. */
  cells: number[][];
  items: DigItemView[];
  remaining: number;
}

/** What a dig turned up (mirrors the server's `_award_dig_loot`). */
export interface DigFound {
  kind: 'spores' | 'item';
  spores?: number;
  item?: string;
  bagFull?: boolean;
}

export interface SpaceEvent {
  type: string;
  text: string;
  spores?: number;
  item?: string;
  xp?: number;
  levels?: number;
  hp?: number;
  roll?: number;
  paint?: string;
  hat?: string;
  duplicate?: boolean;
  to?: string;
  options?: string[];
  node?: string;
  stock?: TradeStockItem[];
  grid?: DigGrid;
  digsLeft?: number;
  /** maxHp only differs from hp for the island boss (persistent HP pool). */
  npc?: {
    id: string;
    name: string;
    hp: number;
    maxHp?: number;
    atk: number;
    def: number;
    spd: number;
    bounty: number;
  };
  battle?: BattleResult;
  sporesLost?: number;
}

export interface Occupant {
  userId: string;
  username: string;
  formName: string;
  level: number;
  shielded: boolean;
  stance: string;
}

export interface ActionResponse {
  ok?: boolean;
  error?: string;
  you?: YouDoc;
  roll?: { value: number; destinations: string[] };
  spaceEvent?: SpaceEvent;
  occupants?: Occupant[];
  battle?: BattleResult;
  target?: { userId: string; username: string; formName: string };
  winner?: string;
  stolen?: number;
  xp?: number;
  levels?: number;
  node?: string;
  stock?: TradeStockItem[];
  grid?: DigGrid;
  digsLeft?: number;
  found?: DigFound | null;
  cleared?: boolean;
  bonus?: number | null;
  text?: string;
  granted?: number;
  lostToCap?: number;
  gamble?: { die: number; won: boolean; rollsLeft?: number };
  result?: SeasonResult;
  seasonId?: string;
}

export function isShielded(p: { shieldUntil?: string | null }): boolean {
  return !!p.shieldUntil && new Date(p.shieldUntil + 'Z').getTime() > Date.now();
}

export function evolveGlowActive(p: { evolvedAt?: string }): boolean {
  return !!p.evolvedAt && Date.now() - new Date(p.evolvedAt + 'Z').getTime() < 60_000;
}
