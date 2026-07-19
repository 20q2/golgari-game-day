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
  creatureName?: string;
  tier: number;
  level: number;
  hp: number;
  maxHp: number;
  /** Effective combat stats (base + gear + buffs); public for the TV broadcast. */
  atk?: number;
  def?: number;
  spd?: number;
  /** slot -> gear item id; public so the spectator hero card can show a build. */
  gear?: Record<string, string>;
  position: string;
  stance: string;
  shieldUntil?: string | null;
  spores: number;
  rolls: number;
  pvpWins: number;
  wildWins: number;
  composts: number;
  /** Guild Sigils claimed (lair first-kills) — count of poiClaims in SIGIL_LAIRS. */
  sigils: number;
  paint: Record<string, number>;
  hat: string | null;
  renown: number;
  isBot?: boolean;
}

export interface PendingMove {
  value: number;
  dests: string[];
}

/** Something that hit you (or missed) while your phone was down. */
export interface AwayEvent {
  kind: 'spell_hit' | 'spell_dodged';
  from: string;
  spell: string;
  dmg?: number;
  at: string;
}

/** Result payload of a `cast` action (mirrors undercity_db._cast). */
export interface CastResult {
  spellId: string;
  effect: string;
  text: string;
  dodged?: boolean;
  dmg?: number;
  hp?: number;
  targetName?: string;
  to?: string;
}

export interface YouDoc {
  userId: string;
  username: string;
  creatureName?: string;
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
  /** Server DEBUG flag — when true the client shows dev tools (pick-your-roll, ∞ rolls). */
  debug?: boolean;
  /** ISO time the next timed roll banks; absent while at the roll cap. */
  nextRollAt?: string;
  rollRegenAt?: string;
  spores: number;
  /** Ossuary gambles left this visit; refills to 3 when you land there again. */
  ossuaryRollsLeft?: number;
  /** Excavation digs left this visit; refills to 3 when you land on a dig site. */
  excavationDigsLeft?: number;
  /** Crystal-vein strikes left this visit; the first is spent on landing. */
  veinStrikesLeft?: number;
  /** Guildvault pick attempts left this visit; refills to 3 on landing. */
  vaultPicksLeft?: number;
  /** A loot puzzle awaiting a solve; carries the masked view so a reopened tab
   * can restore the modal. Cleared on solve or give-up. */
  pendingLoot?: { puzzleId: string; view: FlowPuzzleView } | null;
  bag: string[];
  gear: Record<string, string>;
  stance: string;
  shieldUntil?: string | null;
  pendingMove?: PendingMove | null;
  pendingLoadedDie?: number;
  /** After a compost, the gate options to respawn at (home + last biome). */
  pendingRespawn?: { options: { gate: string; label: string }[] } | null;
  buffs: { kind: string; until?: string }[];
  homeBiome?: string;
  /** Grimoires ever found — a permanent collection; one may be open at a time. */
  grimoires?: string[];
  equippedGrimoire?: string | null;
  /** ISO time the open grimoire was last changed; opening another is gated. */
  lastGrimoireSwap?: string | null;
  /** spellId -> ISO time it comes off cooldown (server clock, no trailing Z). */
  spellCooldowns?: Record<string, string>;
  awayEvents?: AwayEvent[];
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
  creatureName?: string;
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
  /** Spendable renown balance for the pre-spawn shop. */
  renown: number;
}

export interface GuardianPool {
  kind: 'barrier' | 'lair';
  name: string;
  npcId: string;
  hp: number;
  maxHp: number;
  buffs: string[];
}

export interface GameState {
  season: Season | null;
  you: YouDoc | null;
  players: PublicPlayer[];
  snares: string[];
  /** Trading post node id -> its 3 shared stock slots. */
  tradingPosts?: Record<string, TradeStockItem[]>;
  /** Shop node id -> its current shared stock and restock clock. */
  bazaars?: Record<string, BazaarView>;
  /** Excavation node id -> its masked dig-site grid. */
  excavations?: Record<string, DigGrid>;
  /** Region -> shared crystal-vein depth. */
  veins?: Record<string, VeinState>;
  /** Region -> shared Guildvault pot + public guess ledger. */
  vaults?: Record<string, VaultView>;
  /** Barrier node ids broken open this season (shared by all players). */
  barriersOpen?: string[];
  /** Island-boss (Savra) persistent HP pool. */
  boss?: { hp: number; maxHp: number };
  /** Barrier/lair node id -> its live guardian HP pool (field-spell targets). */
  guardians?: Record<string, GuardianPool>;
  events: GameEvent[];
  result: SeasonResult | null;
  wardrobe?: Wardrobe;
  hallOfFame?: HallOfFameNight[];
  /** A pending interactive battle to resume after a reload (null if none). */
  battle?: BattleResume | null;
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

// ── Interactive PvE combat (Plan 2/3) ────────────────────────────────────────

export type Stance = 'aggress' | 'guard' | 'feint';

export interface CombatEntry {
  round: number;
  by?: 'attacker' | 'defender';
  winner?: 'attacker' | 'defender' | 'clash' | 'stall' | 'whiff';
  aStance?: Stance;
  dStance?: Stance;
  dmg?: number;
  heal?: number;
  miss?: boolean;
  negated?: boolean;
  rot?: boolean;
  swarm?: boolean;
  retaliation?: boolean;
  rotApplied?: number;
  /** Environmental "collapse" damage (spec 2026-07-19). `by` is the side TAKING
   *  it (like `rot`), not the dealer. */
  frenzy?: boolean;
}

export interface CombatRound {
  round: number;
  entries: CombatEntry[];
  /** The foe's predicted stance — null when no read procced this round. */
  telegraph: Stance | null;
  /** Round the collapse begins for this fight, or null for boss/lair. */
  frenzyFrom?: number | null;
  playerHp: number;
  npcHp: number;
  revealNext: boolean;
}

export interface CombatFlee {
  fled: boolean;
  smokeSporeUsed?: boolean;
  round?: number;
  telegraph?: Stance;
}

export interface CombatPeek {
  trueIntent: Stance;
  round: number;
}

/** Client-safe snapshot of a pending battle, so a refresh can reopen it. */
export interface BattleResume {
  kind: 'wild' | 'elite' | 'barrier' | 'lair' | 'boss';
  round: number;
  telegraph: Stance | null;
  frenzyFrom?: number | null;
  playerHp: number;
  revealed: Stance | null;
  npc: {
    id?: string;
    name: string;
    hp: number;
    maxHp: number;
    atk?: number;
    def?: number;
    spd?: number;
    personality?: string;
  };
}

/** One slot of a trading post's shared stock. */
export interface TradeStockItem {
  item: string;
  foundBy: string;
}

/** Something the player can offer at a trading post: a bag item, an equipped
 * gear piece, or an owned grimoire. */
export interface TradeOffer {
  id: string;
  kind: 'consumable' | 'gear' | 'grimoire';
  icon: string;
  label: string;
  sub: string;
}

/** One stocked line in a bazaar tab (grimoires carry no qty). */
export interface ShopStockItem {
  item: string;
  qty: number;
}

/** A bazaar node's current shared stock + when it restocks. */
export interface BazaarView {
  gear: ShopStockItem[];
  consumables: ShopStockItem[];
  grimoires: string[];
  /** ISO timestamp (UTC, no suffix) of the next restock. */
  refreshesAt: string;
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

/** Shared crystal-vein state — one per region holding vein spaces. */
export interface VeinState {
  depth: number;
}

/** One public entry in the Guildvault's guess ledger. */
export interface VaultGuessRecord {
  user: string;
  guess: string[];
  exact: number;
  near: number;
  at?: string;
}

/** Public view of a region's shared Guildvault (the combo never leaves the server). */
export interface VaultView {
  pot: number;
  history: VaultGuessRecord[];
}

/** What a dig turned up (mirrors the server's `_award_dig_loot`). */
export interface DigFound {
  kind: 'spores' | 'item';
  spores?: number;
  item?: string;
  bagFull?: boolean;
}

/** Masked Flow puzzle sent to the client — layout only, never the solution. */
export interface FlowPuzzleView {
  id: string;
  w: number;
  h: number;
  start: [number, number];
  end: [number, number];
  rocks: [number, number][];
}

export interface SpaceEvent {
  type: string;
  text: string;
  spores?: number;
  item?: string;
  /** A gear drop from a loot source (mirrors undercity_db._roll_gear_drop). */
  gear?: {
    id: string;
    slot: string;
    outcome: 'equipped' | 'salvaged';
    soldSpores: number;
    displaced?: string | null;
  };
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
  /** loot_puzzle: the masked Flow puzzle to solve for the deferred loot. */
  puzzle?: FlowPuzzleView;
  digsLeft?: number;
  depth?: number;
  collapsed?: boolean;
  heartstone?: boolean;
  strikesLeft?: number;
  vault?: VaultView;
  picksLeft?: number;
  /** maxHp only differs from hp for the island boss (persistent HP pool). */
  npc?: {
    id: string;
    name: string;
    hp: number;
    maxHp?: number;
    atk?: number;
    def?: number;
    spd?: number;
    bounty?: number;
    personality?: string;
  };
  battle?: BattleResult;
  sporesLost?: number;
  // battle_start (interactive PvE, Plan 2)
  kind?: 'wild' | 'elite' | 'barrier' | 'lair' | 'boss';
  telegraph?: Stance;
  round?: number;
  frenzyFrom?: number | null;
}

export interface Occupant {
  userId: string;
  username: string;
  formName: string;
  creatureName?: string;
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
  combat?: CombatRound | CombatFlee;
  peek?: CombatPeek;
  cast?: CastResult;
  target?: { userId: string; username: string; formName: string; creatureName?: string };
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
  depth?: number;
  collapsed?: boolean;
  heartstone?: boolean;
  strikesLeft?: number;
  vault?: VaultView;
  picksLeft?: number;
  guess?: { exact: number; near: number; cracked: boolean; pot: number; found?: DigFound | null };
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
