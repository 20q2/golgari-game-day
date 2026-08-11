/** Shared shapes for the /game/state and /game/action payloads. */
import { Pet, Egg } from '../data/pets';

export interface Season {
  seasonId: string;
  status: 'lobby' | 'active' | 'ended';
  startedAt?: string;
  /** Countdown target (ISO-8601) while status is 'lobby'. */
  launchAt?: string;
  bossPhase: boolean;
  /** Host-toggled Dev Night: every player rolls for free. */
  devMode?: boolean;
  /** Sticky: this night ran with Dev Night at some point, so its results can
   * never be banked — ending it always discards. */
  devEverOn?: boolean;
  /** Every standing Grime Gorger claim, keyed by node id. Shipped to the whole
   * table so every client renders the same board. */
  reclaimed?: Record<string, ReclaimedNode>;
}

/** A board space a Grime Gorger has rewritten with Reclaim. `origType` is what
 *  it reverts to when the claim is released. */
export interface ReclaimedNode {
  type: string;
  origType: string;
  by: string;
  byName: string;
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
  /** True while this creature's poke timer is running (poked recently by anyone),
   *  so nobody can poke them yet. Server-computed each state fetch. */
  pokedRecently?: boolean;
  /** The poke timer itself (UTC ISO, no tz suffix) — present only while it's
   *  running, so the client can draw a live countdown wheel. */
  pokeCooldownUntil?: string | null;
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
      // 'composted' stays for any queued legacy events; new clone duels emit
      // 'beaten' (you lost but your creature survived).
      outcome: 'composted' | 'beaten' | 'defended' | 'fled' | 'timeout';
      spores?: number;
      at: string;
    }
  | { kind: 'reward'; game?: string | null; rolls: number; items: number; at: string }
  | { kind: 'boss'; by: string; name: string; at: string }
  | {
      kind: 'world_kill';
      name: string;
      bracket: 'vanquisher' | 'major' | 'minor' | 'participant';
      spores: number;
      xp: number;
      renown: number;
      gear?: { id: string; name: string; tier: number; ground?: boolean; equipped?: boolean } | null;
      leveledTo?: number | null;
      roster: { name: string; bracket: string }[];
      at: string;
    }
  | { kind: 'world_fallen'; name: string; at: string }
  | { kind: 'high_five'; from: string; fromId: string; at: string }
  | { kind: 'market'; text: string; at: string }
  | { kind: 'host'; text: string; at: string };

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
  /** For a Wish cast: the spell id the player wished into being. */
  wished?: string;
}

/** One item that overflowed a full inventory, awaiting the pickup modal
 * (mirrors undercity_db._park_pickup). */
export interface PendingPickup {
  kind: 'gear' | 'consumable' | 'scroll';
  itemId: string;
  /** Short origin tag for the modal's flavor line (battle | loot | boss | dig | scavenge | reward). */
  source: string;
  at: string;
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
  /** In-game Admin role (host-granted). Unlocks the free Move action. Owner-only
   * — never present on the public/spectator player view. */
  isAdmin?: boolean;
  /** ISO time the next timed roll banks; absent while at the roll cap. */
  nextRollAt?: string;
  /** True when the next timed tick will pay a rested bonus (double rolls) —
   * i.e. you're below the roll cap with rested banked. Client shows a hint. */
  nextRollBoosted?: boolean;
  rollRegenAt?: string;
  /** Rested rolls (in rolls, not "stacks"): overflow banked past the roll cap.
   * While > 0 and the bank has room, each timed tick pays DOUBLE and draws this
   * down. Server-owned; the client only displays it. */
  rested?: number;
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
  /** Items that overflowed a full inventory, awaiting the pickup modal (FIFO). */
  pendingPickups?: PendingPickup[];
  /** Forge economy: capped hold for found gear you aren't wearing. */
  gearStash?: string[];
  /** Forge economy: crafting-material counters. */
  materials?: { moltings: number; ichor: number };
  /** Grime Gorger: junk devoured into board-editing fuel. */
  mulch?: number;
  /** Effective consumable-bag ceiling — 10 for a Grime Gorger, else 5. Always
   * prefer this over restating the constant client-side. */
  bagCap?: number;
  /** Grime Gorger: node ids currently held as reclaimed ground (max 3). */
  claims?: string[];
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
  /** Per-player mutable book contents (spells inscribed at the Sedgemoor Witch),
   *  keyed by grimoire id. Falls back to the static bundle when absent. */
  grimoireSpells?: Record<string, string[]>;
  /** Held spell scrolls (spell ids) — cast one-shot or inscribe at the witch. */
  scrolls?: string[];
  /** ISO time the open grimoire was last changed; opening another is gated. */
  lastGrimoireSwap?: string | null;
  /** spellId -> ISO time it comes off cooldown (server clock, no trailing Z). */
  spellCooldowns?: Record<string, string>;
  /** Companions (animal pets) — owned roster incl. the active one; eggs carried;
   *  the single incubator slot; and per-species activated-ability cooldowns. */
  pets?: Pet[];
  activePetId?: string | null;
  eggs?: Egg[];
  /** The single incubator slot. `spacesLeft` is the step countdown to hatching
   *  (0 = ready); `startedAt` is retained for display only and gates nothing. */
  incubator?: {
    eggId: string;
    startedAt: string;
    tier: number;
    spacesLeft?: number;
  } | null;
  /** role -> board spaces still to walk before that activated ability recharges
   *  (0/absent = ready). Distance, not a clock — see PET_SCOUT_RECHARGE_SPACES. */
  petRecharge?: Record<string, number>;
  /** Spores an active economy pet has scavenged from loot spaces passed over,
   *  waiting to be collected from its board box. Server-authoritative. */
  petSporeBank?: number;
  /** Board spaces still to walk before forage recharges (0/absent = ready).
   *  Forage recharges by DISTANCE, not a clock — see PET_FORAGE_RECHARGE_SPACES. */
  forageRecharge?: number;
  /** @deprecated Legacy real-time accrual clock — economy pets now bank on move. */
  petSporeSince?: string | null;
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
  /** Per-player ruin-lair cycle (mirrors undercity_db doc['ruinLairs']): a live
   *  respawnAt means the lair is abandoned (scavenge once) until it passes. */
  ruinLairs?: Record<string, { respawnAt: string; scavenged: boolean }>;
  paint: Record<string, number>;
  hat: string | null;
  /** Chosen cosmetic starter look (alt sprite key); absent = base look. */
  spriteVariant?: string | null;
  /** Animated special paint — an overlay drawn over the creature's silhouette. */
  effect?: string | null;
  evolvedAt?: string;
  ver: number;
}

/** One plaza-chat message (mirrors the server's CHAT# items). `ts` is an ISO
 * millisecond timestamp (UTC, no suffix) — lexicographic order is time order. */
export interface ChatMessage {
  id: string;
  userId: string;
  username: string;
  text: string;
  ts: string;
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
  /** The night was thrown away: standings stand, but nothing was banked. */
  discarded?: boolean;
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
  /** Absent on legacy rows written before kinds existed → treat as 'gear'. */
  kind?: 'gear' | 'consumable' | 'scroll' | 'pet' | 'egg';
  /** Absent on legacy rows → fall back to `gearId`. For pet/egg it's a display name. */
  itemId?: string;
  /** Legacy field, still emitted by old rows. */
  gearId?: string;
  price: number;
  /** Instance payload for pet/egg listings (the sold object). */
  payload?: { species?: string; tier: number; level?: number; mergeProgress?: number };
}

export interface GameState {
  season: Season | null;
  you: YouDoc | null;
  players: PublicPlayer[];
  /** Trading post node id -> its 3 shared stock slots. */
  tradingPosts?: Record<string, TradeStockItem[]>;
  /** Umori the collector's sealed auction for the current wander window. `reserves`
   *  keys are ranks ("1"|"2"|"3") → the min winning bid to unlock that box's rich
   *  table. `yourBid` is the requesting player's live escrowed bid this window (0 if
   *  none). `reveal` appears on the ONE state read that settles a just-closed
   *  auction the player bid in. */
  umori?: {
    node: string;
    movesAt: string;
    minBid: number;
    reserves: Record<string, number>;
    yourBid: number;
    reveal?: UmoriReveal;
  };
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
  /** Landmark node id -> its season-global first conqueror.
   *  `kind` is 'lair' | 'boss' | 'trove' | 'cache' | 'vault'. */
  firsts?: Record<string, { by: string; at?: string; kind: string }>;
  /** Ashen Fog node id -> the space type it permanently revealed to (season-global). */
  fogReveals?: Record<string, string>;
  /** The wilderness World Event ("Great Beast"), or null if it never spawned. */
  worldEvent?: WorldEventState | null;
  /** Barrier/lair node id -> its live guardian HP pool (field-spell targets). */
  guardians?: Record<string, GuardianPool>;
  /** The wilderness enraged monster — a periodic shared, spell-targetable terror,
   *  or a dead-with-countdown stub while this window's monster is down. */
  enraged?: EnragedMonster | null;
  events: GameEvent[];
  /** Plaza chat — the newest 50 messages, oldest first. */
  chat?: ChatMessage[];
  result: SeasonResult | null;
  wardrobe?: Wardrobe;
  hallOfFame?: HallOfFameNight[];
  /** A pending interactive battle to resume after a reload (null if none). */
  battle?: BattleResume | null;
}

/** The wilderness World Event ("The Great Beast"): a season-shared co-op boss
 * squatting on 3 wilderness nodes, its sprite centered on `center`. */
/** Grothoma, the wilderness world boss. A DAMAGE CHECK (design 2026-08-09): it
 *  has no HP pool and cannot be felled. The hunt runs until `endsAt`, every blow
 *  is banked against your name, and the spoils are dealt out by damage bracket
 *  when the clock expires — so there is a countdown and a tally here, no HP bar. */
export interface WorldEventState {
  nodes: string[];
  center: string;
  /** ISO (UTC, no suffix) deadline; when it passes the hunt settles and pays out. */
  endsAt: string;
  /** Damage banked by everyone so far, and by the current leader. */
  totalDamage: number;
  topDamage: number;
  /** Per-player tallies keyed by userId — the public leaderboard. Join against
   *  `players` for names rather than expecting them here. */
  dmg: Record<string, number>;
  name: string;
  spriteId: string;
  dead: boolean;
}

/** The wilderness enraged monster: one shared creature squatting on a single
 *  wilderness node, relocating every ENRAGED_DWELL_MIN. `movesAt` is the ISO
 *  (UTC, no suffix) relocate clock. When `dead`, only `dead`+`movesAt` are set. */
export interface EnragedMonster {
  dead: boolean;
  movesAt: string;
  node?: string;
  monsterId?: string;
  name?: string;
  spriteId?: string;
  hp?: number;
  maxHp?: number;
  buffs?: string[];
}

export interface BattleResult {
  outcome: 'attacker' | 'defender' | 'timeout' | 'fled';
  // The engine emits a rich combat log (round headers, decisive blows, rot
  // ticks, heals, …) — the same `CombatEntry` shape the interactive PvE battle
  // consumes, not a flat list of damage strikes. Playback must skip the
  // non-strike entries (see BattlePlaybackComponent.applyStrike).
  strikes: CombatEntry[];
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
  /** Companion trigger tag by role: 'attack' (a follow-up hit, carries `dmg`) or
   *  'defend' (a deflect, carries `deflect`). Lets playback badge the pet's action. */
  pet?: 'attack' | 'defend';
  /** Points a defend companion shrugged off the decisive hit (with pet:'defend'). */
  deflect?: number;
  /** Legacy environmental "collapse" damage — no longer emitted by the engine
   *  (combat now escalates via each creature's own swings). Kept for playback of
   *  old battle records; `by` is the side TAKING it (like `rot`). */
  frenzy?: boolean;
}

/** A fighter's standing conditions during a battle. */
export interface BattleStatus {
  rot: number; // rot stack count (0 = none); drives the DoT
  buffs: string[]; // active buff/debuff effect kinds
  /** Net temporary stat swing from those buffs/curses (server-computed): +N from
   *  self-buffs, -N from curses. Drives the ±N annotation beside each stat. */
  delta?: { atk: number; def: number; spd: number };
  /** Signature enemy trait kinds (boss familiars) -> STATUS_INFO chips. */
  traits?: string[];
  /** Live stack counts for stacking traits (grave_growth / doom_counters). */
  stacks?: Record<string, number>;
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
  /** On a FAILED flee the fleer scrambles into a random stance and the server
   *  resolves a full round against the enemy's telegraphed action — returning its
   *  playback (unless someone dropped, in which case the outcome arrives as a
   *  spaceEvent instead). A lucky stance can win the exchange. */
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
  kind: 'wild' | 'elite' | 'barrier' | 'lair' | 'boss' | 'world' | 'pvp';
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
    /** Art id under undercity/enemies/ when the foe's sprite differs from its
     *  logical id (e.g. an enraged wilderness monster borrowing enemy art). */
    spriteId?: string;
    name: string;
    hp: number;
    maxHp: number;
    atk?: number;
    def?: number;
    spd?: number;
    /** Derived opponent power level shown in the battle screen. */
    level?: number;
    personality?: string;
    /** Size tier (1-3) for relative arena sprite scaling (server-stamped). */
    tier?: number;
  };
}

/** One slot of a trading post's shared stock.
 * @deprecated Umori's give-junk-get-legendary barter is gone (replaced by the
 * sealed-bid auction — see UmoriBoxReward/UmoriReveal); kept only because
 * `GameState.tradingPosts`/`SpaceEvent.stock`/`ActionResponse.stock` still carry
 * the shape for any other trading-post consumer. */
export interface TradeStockItem {
  item: string;
  foundBy: string;
}

/** One reward pulled from an auction box. */
export interface UmoriBoxReward {
  kind: 'gear' | 'grimoire' | 'egg' | 'consumable' | 'materials';
  item?: string;
  tier?: number;
  ichor?: number;
  moltings?: number;
  outcome?: 'equipped' | 'stashed' | 'stored' | 'pending';
}

/** The settlement of a closed auction the player bid in. `placed` is their rank
 *  (1-3) or null when they were outbid (4th+) and refunded. */
export interface UmoriReveal {
  window: number;
  placed: number | null;
  boxName?: string;
  reward?: UmoriBoxReward;
  refund?: number;
}

/** One stocked line in a bazaar tab (grimoires carry no qty). */
export interface ShopStockItem {
  item: string;
  qty: number;
  /** True only for a biome bazaar's rare "black-market" T3 line. */
  blackMarket?: boolean;
}

/** One stocked companion egg (the Eggs tab). */
export interface EggStockItem {
  tier: number;
  qty: number;
  cost: number;
}

/** A bazaar node's current shared stock + when it restocks. */
export interface BazaarView {
  gear: ShopStockItem[];
  consumables: ShopStockItem[];
  grimoires: string[];
  /** Companion eggs stocked this window (the Eggs tab). */
  eggs?: EggStockItem[];
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
  kind: 'spores' | 'item' | 'listed';
  spores?: number;
  item?: string;
  bagFull?: boolean;
  /** For `listed`: the Spore price the full-bag find was auto-listed at. */
  price?: number;
}

/** A reward symbol placed on a loot-puzzle cell. The first one the drawn path
 * crosses is what the player keeps; the server decides which — this is only
 * used for rendering. Values are never sent to the client. */
export interface FlowReward {
  kind: 'spores' | 'item' | 'gear' | 'molting';
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

/** The Rot-Farm Bazaar's first-visit handout (mirrors undercity_db._maybe_bazaar_welcome):
 *  a random consumable, or a Molting when the bag was full. */
export interface WelcomeGift {
  kind: 'consumable' | 'material';
  /** Consumable id (present only when kind === 'consumable'). */
  item?: string;
  /** Display name — the consumable's name, or "Molting". */
  name: string;
  /** Quantity for the material case (1). */
  amount?: number;
}

export interface SpaceEvent {
  type: string;
  text: string;
  /** Set only on the FIRST landing of an Ashen Fog tile: the space type the fog
   *  just revealed (also `type`). Drives the "the fog parts" reveal beat. */
  fogReveal?: string;
  spores?: number;
  item?: string;
  /** A spell-scroll drop (mirrors undercity_db._roll_scroll_drop): the spell id. */
  scroll?: string;
  /** A gear drop from a loot source (mirrors undercity_db._roll_gear_drop).
   * Found gear routes to the stash; if the stash was full it is auto-ground
   * into materials ('stash-full'). */
  gear?: {
    id: string;
    slot: string;
    tier: number;
    outcome: 'equipped' | 'stashed' | 'stash-full';
    materials?: { moltings: number; ichor: number };
  };
  /** Companion egg dropped by this event (Monster Nest scavenge, cache, loot…). */
  egg?: { tier: number };
  /** Crafting materials gained from this space (e.g. an Overgrown Cache molting
   *  pickup). Mirrors the server event's `materials`. */
  materials?: { moltings: number; ichor: number };
  /** Present only on a first-visit bazaar landing where the shopkeeper gifts a
   *  broke newcomer (mirrors undercity_db shop branch). Drives the panel callout. */
  welcomeGift?: WelcomeGift;
  xp?: number;
  levels?: number;
  /** Renown this fight earned (marginal compute_renown delta): +wild win, +POI
   * first-kill, +boss damage. Absent/0 when the fight moved no renown stat. */
  renownGained?: number;
  hp?: number;
  roll?: number;
  /** Mystery-space canonical outcome (mirrors undercity_db._mystery →
   *  engine.mystery_outcome): drives which reel face the lottery machine lands
   *  on. One of jackpot|gear|grimoire|item|heal|buff|curse|warp|hurt|theft|
   *  spores|xp|mystery. */
  outcome?: string;
  /** Dungeon signature-hazard id (mirrors undercity_db._dungeon_hazard):
   *  webbing|spore_cloud|sinkwater|bone_chill|rot_bloom. */
  hazardId?: string;
  /** Surface-hazard rolled effect (mirrors undercity_db._hazard):
   *  swamp_gas|vines|spore_cloud. Drives which face the hazard wheel lands on. */
  hazardOutcome?: string;
  /** Dungeon-hazard pocket biome (mirrors undercity_db._dungeon_hazard) — lets
   *  the hazard wheel pick this lair's boss silhouette. */
  biome?: string;
  /** How the hazard did no harm, when it didn't (mirrors undercity_db._hazard /
   *  _dungeon_hazard). 'lucky' = the baseline luck fizzle any creature can hit;
   *  'resist' = Thick Hide turned it aside. Absent when the hazard landed. Drives
   *  which no-harm wedge the wheel lands on. */
  hazardAvoid?: 'lucky' | 'resist';
  /** Present (true) only when the creature has Thick Hide — set whether or not the
   *  hazard was avoided, so the wheel paints the extra "resist" tease wedges. */
  hazardPerk?: boolean;
  paint?: string;
  hat?: string;
  duplicate?: boolean;
  to?: string;
  /** ladder: the post-boss escape climb (one-way to the surface) vs a two-way
   *  descent pair. Used only to flavour the ladder crossing modal. */
  oneWay?: boolean;
  options?: string[];
  node?: string;
  stock?: TradeStockItem[];
  /** trading_post: true when this space is Umori's sealed-bid auction (the only
   *  producer of the 'trading_post' event type — see the umori/minBid/reserves/
   *  yourBid fields below). */
  umori?: boolean;
  minBid?: number;
  reserves?: Record<string, number>;
  yourBid?: number;
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
    /** Art id under undercity/enemies/ when the foe's sprite differs from its
     *  logical id (e.g. an enraged wilderness monster borrowing enemy art). */
    spriteId?: string;
    name: string;
    hp: number;
    maxHp?: number;
    atk?: number;
    def?: number;
    spd?: number;
    /** Derived opponent power level shown in the battle screen. */
    level?: number;
    /** Size tier (1-3) for relative arena sprite scaling (server-stamped). */
    tier?: number;
    bounty?: number;
    personality?: string;
    /** PvP clone-duel only: sprite descriptor so the client can draw the
     * target's own creature as the foe. */
    form?: string;
    paint?: Record<string, number>;
    hat?: string | null;
    spriteVariant?: string | null;
  };
  battle?: BattleResult;
  sporesLost?: number;
  /** Soul Trophy (Deathrite Shaman): a won fight offers +amount to a chosen stat
   * next battle. Present only on wins for that form. */
  trophy?: { amount: number };
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
  reward?: {
    bracket: string;
    spores: number;
    renown: number;
    xp: number;
    gear?: { id: string; name: string; tier: number; ground?: boolean; equipped?: boolean } | null;
    leveledTo?: number | null;
  };
  /** world_event finish: the shared raid summary (present when worldKill). */
  raid?: { name: string; roster: { name: string; bracket: string }[] };
  // battle_start (interactive PvE, Plan 2; PvP clone duel, 2026-07-27)
  kind?: 'wild' | 'elite' | 'barrier' | 'lair' | 'boss' | 'world' | 'pvp';
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
  /** An economy companion's scavenge from the last move: Spores banked from loot
   *  spaces passed over, the new bank total, and which loot nodes to poof. */
  scavenge?: { spores: number; bank: number; nodes: string[] } | null;
  battle?: BattleResult;
  combat?: CombatRound | CombatFlee;
  peek?: CombatPeek;
  cast?: CastResult;
  /** The message a `chat` action just created, echoed for instant local append. */
  chat?: ChatMessage;
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
  spores?: number;
  /** Crafting materials gained on a vein strike (mining pays no Spores). */
  ichor?: number;
  moltings?: number;
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
