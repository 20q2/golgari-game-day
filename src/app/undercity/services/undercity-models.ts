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
  /** Chosen cosmetic starter look (alt sprite key); absent = base look. */
  spriteVariant?: string | null;
  /** Animated special paint — an overlay drawn over the creature's silhouette. */
  effect?: string | null;
  /** Cosmetic-only shiny (5% at hatch): draws a gold sparkle over the sprite. */
  shiny?: boolean;
  /** Free-text status bubble shown above the creature; '' or absent = none. */
  status?: string;
  renown: number;
  /** Attribute-threshold perks (server-derived); public for the spectator card. */
  perks?: string[];
  isBot?: boolean;
}

export interface PendingMove {
  value: number;
  dests: string[];
  /** Pathfinder (SPD-10): both rolled faces when the move came from an advantage roll. */
  values?: number[];
}

/** Something that hit you (or missed) while your phone was down. */
/** A single "while you were away" note. Discriminated on `kind`; the server
 * mirror is undercity_db._push_away_event entries. */
export type AwayEvent =
  | { kind: 'spell_hit' | 'spell_dodged'; from: string; spell: string; dmg?: number; at: string }
  | {
      kind: 'pvp';
      from: string;
      outcome: 'composted' | 'defended' | 'fled' | 'timeout';
      spores?: number;
      at: string;
    }
  | { kind: 'reward'; game?: string | null; rolls: number; items: number; at: string }
  | { kind: 'boss'; by: string; name: string; at: string }
  | { kind: 'market'; text: string; at: string };

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
  /** Free-text status bubble shown above your creature; '' or absent = none. */
  status?: string;
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
  /** Attribute-threshold perks unlocked by invested atk/def/spd (server-derived). */
  perks?: string[];
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
  /** Forge economy: capped hold for found gear you aren't wearing. */
  gearStash?: string[];
  /** Forge economy: crafting-material counters. */
  materials?: { moltings: number; ichor: number };
  stance: string;
  shieldUntil?: string | null;
  pendingMove?: PendingMove | null;
  pendingLoadedDie?: number;
  /** Blink (SPD-15): ordinary rolls still owed before Blink can be used again. */
  blinkCooldown?: number;
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
  /** Chosen cosmetic starter look (alt sprite key); absent = base look. */
  spriteVariant?: string | null;
  /** Animated special paint — an overlay drawn over the creature's silhouette. */
  effect?: string | null;
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
  /** Chosen cosmetic starter look (alt sprite key); absent = base look. */
  spriteVariant?: string | null;
  effect?: string | null;
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
  effects: string[];
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

/** One priced gear listing on the Player Market. */
export interface MarketListing {
  id: string;
  sellerId: string;
  sellerName: string;
  gearId: string;
  price: number;
}

export interface GameState {
  season: Season | null;
  you: YouDoc | null;
  players: PublicPlayer[];
  snares: string[];
  /** Trading post node id -> its 3 shared stock slots. */
  tradingPosts?: Record<string, TradeStockItem[]>;
  /** The wandering trading post's current node + when it next hops (ISO, UTC no suffix).
   *  `traded` is true once the requesting player has spent this rotation's one barter. */
  umori?: { node: string; movesAt: string; traded?: boolean };
  /** Shop node id -> its current shared stock and restock clock. */
  bazaars?: Record<string, BazaarView>;
  /** Player Market — priced gear listings (mirrors undercity_db MARKET# records). */
  market?: MarketListing[];
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
  /** The wilderness World Event ("Great Beast"), or null if it never spawned. */
  worldEvent?: WorldEventState | null;
  /** Barrier/lair node id -> its live guardian HP pool (field-spell targets). */
  guardians?: Record<string, GuardianPool>;
  events: GameEvent[];
  result: SeasonResult | null;
  wardrobe?: Wardrobe;
  hallOfFame?: HallOfFameNight[];
  /** A pending interactive battle to resume after a reload (null if none). */
  battle?: BattleResume | null;
}

/** The wilderness World Event ("The Great Beast"): a season-shared co-op boss
 * squatting on 3 wilderness nodes, its sprite centered on `center`. */
export interface WorldEventState {
  nodes: string[];
  center: string;
  hp: number;
  maxHp: number;
  name: string;
  spriteId: string;
  dead: boolean;
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
  /** Guard's decisive counter-blow (winner guarded). */
  counter?: boolean;
  /** The aggressor's hit soaked by a winning Guard. */
  mitigated?: boolean;
  /** Chip damage a Guard leaks through on a stalled exchange. */
  guardChip?: boolean;
  rotApplied?: number;
  /** Legacy environmental "collapse" damage — no longer emitted by the engine
   *  (combat now escalates via each creature's own swings). Kept for playback of
   *  old battle records; `by` is the side TAKING it (like `rot`). */
  frenzy?: boolean;
}

/** A fighter's standing conditions during a battle. */
export interface BattleStatus {
  rot: number; // rot stack count (0 = none); drives the DoT
  buffs: string[]; // active buff/debuff effect kinds
}

export interface CombatRound {
  round: number;
  entries: CombatEntry[];
  /** The foe's predicted stance — null when no read procced this round. */
  telegraph: Stance | null;
  /** Round the escalation ramp begins for this fight, or null for boss/lair. */
  frenzyFrom?: number | null;
  playerHp: number;
  npcHp: number;
  playerStatus?: BattleStatus;
  npcStatus?: BattleStatus;
  revealNext: boolean;
}

export interface CombatFlee {
  fled: boolean;
  smokeSporeUsed?: boolean;
  round?: number;
  telegraph?: Stance | null;
  /** On a FAILED flee the enemy takes its telegraphed action for free — the
   *  server resolves a full round and returns its playback (unless the blow was
   *  lethal, in which case the outcome arrives as a spaceEvent instead). */
  entries?: CombatEntry[];
  frenzyFrom?: number | null;
  playerHp?: number;
  npcHp?: number;
  playerStatus?: BattleStatus;
  npcStatus?: BattleStatus;
  revealNext?: boolean;
}

export interface CombatPeek {
  trueIntent: Stance;
  round: number;
}

/** Client-safe snapshot of a pending battle, so a refresh can reopen it. */
export interface BattleResume {
  kind: 'wild' | 'elite' | 'barrier' | 'lair' | 'boss' | 'world';
  round: number;
  telegraph: Stance | null;
  frenzyFrom?: number | null;
  /** SPD-based escape % shown on the flee button (100 with a held Smoke Spore). */
  fleeChance?: number;
  playerHp: number;
  playerStatus?: BattleStatus;
  npcStatus?: BattleStatus;
  revealed: Stance | null;
  npc: {
    id?: string;
    name: string;
    hp: number;
    maxHp: number;
    atk?: number;
    def?: number;
    spd?: number;
    /** Derived opponent power level shown in the battle screen. */
    level?: number;
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
  /** Gear slot ('fang'|'carapace'|'charm') -> the 'uc-<slot>' svg icon. */
  slot?: string;
  /** Rarity key ('common'|'rare'|'legendary') for coloring + the badge. */
  rarity?: string;
  rarityLabel?: string;
  label: string;
  sub: string;
  /** For a same-slot gear offer: this is the piece currently worn (badged in UI). */
  equipped?: boolean;
}

/** One stocked line in a bazaar tab (grimoires carry no qty). */
export interface ShopStockItem {
  item: string;
  qty: number;
  /** True only for a biome bazaar's rare "black-market" T3 line. */
  blackMarket?: boolean;
}

/** A bazaar node's current shared stock + when it restocks. */
export interface BazaarView {
  gear: ShopStockItem[];
  consumables: ShopStockItem[];
  grimoires: string[];
  /** ISO timestamp (UTC, no suffix) of the next restock. */
  refreshesAt: string;
}

/** A buried find in a shared excavation dig site — footprint + loot are visible
 * so players can see what's down there and where to spend their digs. */
export interface DigItemView {
  idx: number;
  shape: string;
  /** Footprint cells [row, col] this find occupies. */
  cells: [number, number][];
  /** 'spores' | 'item' — what the find pays out. */
  kind: 'spores' | 'item' | null;
  /** Consumable id when kind === 'item'. */
  item: string | null;
  /** Spore amount when kind === 'spores'. */
  spores: number | null;
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

/** A reward symbol placed on a loot-puzzle cell. The first one the drawn path
 * crosses is what the player keeps; the server decides which — this is only
 * used for rendering. Values are never sent to the client. */
export interface FlowReward {
  kind: 'spores' | 'item' | 'gear';
  cell: [number, number];
}

/** Masked Flow puzzle sent to the client — layout only, never the solution. */
export interface FlowPuzzleView {
  id: string;
  w: number;
  h: number;
  start: [number, number];
  end: [number, number];
  rocks: [number, number][];
  /** Reward symbols scattered on the board (first-crossed wins). */
  rewards: FlowReward[];
}

export interface SpaceEvent {
  type: string;
  text: string;
  spores?: number;
  item?: string;
  /** A gear drop from a loot source (mirrors undercity_db._roll_gear_drop).
   * Found gear routes to the stash; if the stash was full it is auto-ground
   * into materials ('stash-full'). */
  gear?: {
    id: string;
    slot: string;
    tier: number;
    outcome: 'stashed' | 'stash-full';
    materials?: { moltings: number; ichor: number };
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
    /** Derived opponent power level shown in the battle screen. */
    level?: number;
    bounty?: number;
    personality?: string;
  };
  battle?: BattleResult;
  sporesLost?: number;
  /** Biome key of a Guild Sigil just claimed by clearing its lair boss (first
   * kill only). Drives the sigil-claimed celebration overlay. */
  sigil?: string;
  /** world_event: the beast's footprint + live shared pool (landing / engage). */
  center?: string;
  nodes?: string[];
  spriteId?: string;
  /** world_event finish echo: damage this skirmish dealt to the shared pool. */
  dealt?: number;
  /** world_event finish echo: this blow felled the beast (triggers payout). */
  worldKill?: boolean;
  /** world_event finish echo: this player's bracket payout. */
  reward?: { bracket: string; spores: number; renown: number };
  // battle_start (interactive PvE, Plan 2)
  kind?: 'wild' | 'elite' | 'barrier' | 'lair' | 'boss' | 'world';
  telegraph?: Stance;
  round?: number;
  frenzyFrom?: number | null;
  /** SPD-based escape % shown on the flee button (100 with a held Smoke Spore). */
  fleeChance?: number;
  playerStatus?: BattleStatus;
  npcStatus?: BattleStatus;
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
  roll?: {
    value: number;
    destinations: string[];
    /** Pathfinder (SPD-10): the two rolled faces; destinations are their union. */
    values?: number[];
    /** Blink (SPD-15): the value was chosen, not rolled. */
    blink?: boolean;
    /** Fleetfoot (SPD-5): this rolled 1 may be rerolled once. */
    canReroll?: boolean;
  };
  spaceEvent?: SpaceEvent;
  occupants?: Occupant[];
  /** A gate heal from the last move: passing through (50%) or landing (100%). */
  heal?: { amount: number; hp: number; kind: 'gate_pass' | 'gate_land' } | null;
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
