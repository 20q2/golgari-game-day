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
  bag: string[];
  gear: Record<string, string>;
  stance: string;
  shieldUntil?: string | null;
  pendingMove?: PendingMove | null;
  pendingLoadedDie?: number;
  buffs: { kind: string; until?: string }[];
  taughtClaims: number;
  lastFinishedClaim?: string | null;
  pokesReceived: number;
  pvpWins: number;
  wildWins: number;
  composts: number;
  bossDamage: number;
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

export interface SpaceEvent {
  type: string;
  text: string;
  spores?: number;
  item?: string;
  hp?: number;
  roll?: number;
  paint?: string;
  hat?: string;
  duplicate?: boolean;
  to?: string;
  options?: string[];
  shopTier?: number;
  npc?: { id: string; name: string; hp: number; atk: number; def: number; spd: number; bounty: number };
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
  text?: string;
  granted?: number;
  lostToCap?: number;
  gamble?: { die: number; won: boolean };
  result?: SeasonResult;
  seasonId?: string;
}

export function isShielded(p: { shieldUntil?: string | null }): boolean {
  return !!p.shieldUntil && new Date(p.shieldUntil + 'Z').getTime() > Date.now();
}

export function evolveGlowActive(p: { evolvedAt?: string }): boolean {
  return !!p.evolvedAt && Date.now() - new Date(p.evolvedAt + 'Z').getTime() < 60_000;
}
