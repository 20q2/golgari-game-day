/**
 * The Undercity Crawl board — Dokapon-style 2.5D pan/zoom renderer.
 *
 * Camera/input handling mirrors PlazaCanvas (drag, pinch, wheel, tap). All
 * static art (cavern terrain, moss plateaus, river, path ribbons, landmark
 * buildings) is prerendered once by board-terrain.ts and blitted under the
 * camera transform; each frame this class adds the dynamic layer: pulsing
 * glow spots, elliptical "coin disc" spaces with icon glyphs, snare
 * "disturbed ground" tells, pulsing move-choice highlights, and y-sorted
 * player tokens (recolored mini sprites) with ground shadows.
 */
import {
  getRecolored,
  getRawImage,
  hatPlacement,
  drawCreatureEffect,
  clearSpriteCanvasCaches,
} from './sprite-engine';
import { formSprite } from '../data/species';
import type { TemperamentProfile } from '../data/pets';
import {
  BARRIER_GUARDIANS,
  LAIR_GUARDIANS,
  DEFAULT_GUARDIAN,
  GUARDIAN_PLACEHOLDER_SPRITE,
  DEFAULT_GUARDIAN_SPRITE,
  SPACE_ICONS,
} from '../data/items';
import { drawSpaceDisc, drawSkull, NODE_R, DISC_RY } from './board-space';
import { BoardAmbient } from './board-ambient';
import {
  renderTerrain,
  drawDecals,
  drawFlora,
  drawPathMotifs,
  preloadDecalImages,
  FloorTextures,
  LandmarkTextures,
  TerrainArt,
  TERRAIN_MARGIN,
  TERRAIN_RES,
} from './board-terrain';
import { computeLayers, layerIndex, OVERWORLD, LayerSpec } from './board-layers';
import { computeEnemyTiers, drawTierBadge, EnemyTier } from './board-enemy-tier';
import { computeProgress, drawProgressRing } from './board-progress-ring';
import { WORLD_EVENT_SPRITE, WORLD_EVENT_PIECE_SPRITE } from '../data/world-event';
import { MONSTER_SPACE } from '../data/enraged';
import { enemyArtUrl } from '../data/dungeons';
import { drawTunnelSignpost } from './board-signpost';
import { DigGrid, EnragedMonster, VeinState, WorldEventState } from '../services/undercity-models';

export interface BoardNode {
  id: string;
  type: string;
  x: number;
  y: number;
  /** Chamber theme tag from the backend map: city | cavern | bog | isle. */
  region?: string;
  neighbors: string[];
  /**
   * Editor-only: suppress the auto landmark sprite (and its glow) this space's
   * type would otherwise draw — e.g. hide a warp's portal art. Display-only;
   * the backend ignores it. Absent/false = sprite shown.
   */
  hideSprite?: boolean;
  /**
   * Editor-only: place the landmark sprite around the SPACE CENTRE for a more
   * natural look. `spriteAngle` is the direction in degrees (0 = straight up,
   * clockwise); `spriteDist` is the distance from the centre in px. Absent →
   * angle 0 and the usual seat gap (SPRITE_SEAT), i.e. the default straight-up
   * placement. Display-only; the backend ignores them.
   */
  spriteAngle?: number;
  spriteDist?: number;
}

/** Editable chamber metadata from map.json (regions{} section). */
export interface RegionSpec {
  label: string;
  /** Floor painting path under the app base; '' = flat dark floor. */
  background: string;
  /** Procedural ambient decoration on/off for this chamber. */
  scatter: boolean;
  /** Fog-of-war dungeon pocket rendered as its own layer. */
  dark: boolean;
}

/** Hand-placed decoration from map.json (decals[] section). */
export interface MapDecal {
  kind: 'stamp' | 'image';
  /** Stamp-registry key when kind === 'stamp'. */
  stamp?: string;
  /** Image path under the app base when kind === 'image'. */
  src?: string;
  x: number;
  y: number;
  scale: number;
  /** Radians. */
  rot: number;
  layer: 'under' | 'over';
  seed?: number;
}

/** Free-floating ghosted title text, styled like the region labels. */
export interface MapLabel {
  text: string;
  x: number;
  y: number;
  /** Font size in world px (region labels are 46). */
  size: number;
  /** Radians. */
  rot: number;
  /** Ink opacity — region labels use 0.16. */
  alpha: number;
}

export interface BoardMap {
  worldW: number;
  worldH: number;
  gate: string;
  boss: string;
  nodes: BoardNode[];
  regions?: Record<string, RegionSpec>;
  decals?: MapDecal[];
  labels?: MapLabel[];
}

export interface BoardPlayer {
  userId: string;
  username: string;
  form: string;
  level: number;
  paint: Record<string, number>;
  position: string;
  shielded: boolean;
  /** Equipped hat id, if any — drawn on the head via the sprite's hat guide. */
  hat?: string | null;
  /** Cosmetic starter look; picks the alt sprite in formSprite(). */
  spriteVariant?: string | null;
  /** Cosmetic-only shiny — draws a steady gold sparkle over the token. */
  shiny?: boolean;
  /** Animated special paint — an overlay drawn over the token's silhouette. */
  effect?: string | null;
  /** Own token only: illuminating gear equipped — reveals the whole dungeon. */
  illuminated?: boolean;
  /** Own token only: Mosslight Cavern's Darkvision perk — light radius 2 not 1. */
  darkvision?: boolean;
  /** Evolution tier (1/2/3). Own token's tier greys out Tier-1-only tunnels. */
  tier?: number;
  /** Status-bubble text; '' or absent = no bubble. */
  status?: string;
}

/** In-world popover anchored above a node — what the space does. */
export interface NodeInfo {
  nodeId: string;
  title: string;
  body: string;
  /** Optional Material Icons ligature drawn to the left of the title. */
  icon?: string;
}

/** Floor paintings for map files that predate the editable regions{} section. */
const LEGACY_FLOOR_SRC: Record<string, string> = {
  city: 'undercity/undercity_background.webp',
  cavern: 'undercity/cavern_background.webp',
  bog: 'undercity/swamp_background.webp',
  isle: 'undercity/palace_background.webp',
  ruin: 'undercity/palace_background.webp',
  bone: 'undercity/ossuary_field.webp',
  garden: 'undercity/rot_gardens.webp',
  depths: 'undercity/cavern_background.webp',
};

const MIN_ZOOM = 0.15; // floor for tiny screens; larger screens stop at whole-map fit
const MAX_ZOOM = 2.5;
// Enemy T1/T2/T3 labels appear once zoomed in past ~a fifth of MAX_ZOOM — below
// this the letters are too small to read and just clutter the coins.
const TIER_LABEL_MIN_ZOOM = MAX_ZOOM * 0.2;
const DRAG_THRESHOLD = 6;
const MOVE_MS = 320; // token slide + camera glide duration per step

function easeInOut(t: number): number {
  return t < 0.5 ? 2 * t * t : 1 - (2 - 2 * t) ** 2 / 2;
}

// Smootherstep (Ken Perlin): zero velocity AND zero acceleration at both ends,
// so the spectator camera eases in and out with no perceptible jerk. Used only
// for the cinematic camera glide, not token hops.
function easeCam(t: number): number {
  return t * t * t * (t * (t * 6 - 15) + 10);
}

/**
 * Popover entrance: given the popover's age in seconds, returns [alpha, scale].
 * Scale springs from 0 up through a slight overshoot to 1 (easeOutBack) while
 * alpha fades in quickly, so tooltips pop into place instead of blinking on.
 */
function popIn(age: number): [number, number] {
  const dur = 0.26;
  const t = Math.min(1, Math.max(0, age / dur));
  const c1 = 1.70158;
  const c3 = c1 + 1;
  const scale = 1 + c3 * (t - 1) ** 3 + c1 * (t - 1) ** 2; // easeOutBack, 0→1 w/ overshoot
  const alpha = Math.min(1, age / 0.12);
  return [alpha, scale];
}

/** FNV-1a — used only to give each token a stable breathing phase offset. */
function hashStr(s: string): number {
  let h = 2166136261;
  for (let i = 0; i < s.length; i++) {
    h ^= s.charCodeAt(i);
    h = Math.imul(h, 16777619);
  }
  return h >>> 0;
}

interface TokenAnim {
  x: number;
  y: number;
  fromX: number;
  fromY: number;
  toX: number;
  toY: number;
  start: number;
  hopIndex: number; // last footfall already dusted this move
  phase: number; // per-token breathing desync
  hitLife?: number; // seconds left of a spell-hit flash/shake reaction
  hitMax?: number;
}

/** An in-flight two-creature high-five (ready → jump → clap → settle). */
interface HighFiveAnim {
  aId: string; // giver
  bId: string; // recipient
  start: number; // ts (ms) of the first frame; -1 until stamped by the draw loop
  clapped: boolean; // impact burst fired once at the peak
}

/** An in-flight camera pan (+ optional zoom) tween. */
interface CamGlide {
  fromX: number;
  fromY: number;
  toX: number;
  toY: number;
  fromZoom: number;
  toZoom: number;
  start: number;
  durationMs: number;
}

/** Construction options. `interactive: false` builds a read-only board (the
 *  spectator/TV broadcast) — no pointer/pinch/wheel input, and dungeon pockets
 *  render fully revealed since there is no own token to light the way. */
export interface BoardCanvasOpts {
  interactive?: boolean;
}

/** Kicked-up dust mote (world space), ported from the plaza's poof system. */
interface DustMote {
  x: number;
  y: number;
  vx: number;
  vy: number;
  life: number;
  maxLife: number;
  size: number;
}

/** Twinkle around a token — gate heal (green) or a self-buff cast (tinted). */
interface Sparkle {
  x: number;
  y: number;
  vx?: number; // horizontal drift (impact/implode bursts; absent = pure rise)
  vy: number;
  life: number;
  maxLife: number;
  size: number;
  color: string; // fill
  glow: string; // shadow/blur tint
}

/** Floating combat number that rises and fades off a token (world space).
 *  `color` tints it — green heals, red damage; a plain 'miss'/'ward' word. */
interface HealNumber {
  x: number;
  y: number;
  life: number;
  maxLife: number;
  text: string;
  color?: string;
}

/** A traveling spell mote (world space) that fires an impact on arrival. */
interface Bolt {
  fromX: number;
  fromY: number;
  toX: number;
  toY: number;
  t: number; // 0..1 progress
  dur: number; // seconds
  color: string;
  glow: string;
  size: number;
  hitUser?: string; // token to shake/flash on impact
  dmg?: number; // draws -dmg over the target (absent/0 = none)
  dodged?: boolean; // draws "miss" instead of an impact
  done: boolean;
}

/** A queued spell-cast effect, resolved to live token/node positions in draw(). */
export interface SpellCastFx {
  shape: 'buff' | 'heal' | 'damage' | 'curse' | 'teleport' | 'recall' | 'fate' | 'boss' | 'wish';
  casterId: string;
  /** Another player's token the spell lands on. */
  targetId?: string;
  /** A node the spell targets (teleport destination or the boss lair). */
  targetNode?: string;
  color: string;
  glow: string;
  dmg?: number;
  dodged?: boolean;
}

/** A queued "you got hit" reaction on a single token (spell landed on you). */
export interface SpellHitFx {
  targetId: string;
  dmg?: number;
  dodged?: boolean;
}

// Movement/idle animation of the creature tokens.
const HOP_COUNT = 2; // footfalls per node-to-node move
const HOP_HEIGHT = 10; // px the sprite lifts at the peak of a hop
const HIGH_FIVE_MS = 1000; // full ready→jump→clap→settle high-five
const BREATH_SPEED = 2.2; // idle breathing rate
const BREATH_AMT = 0.04; // idle vertical scale wobble (±4%)

// Roaming enraged monster idle: it skitters side-to-side rather than bobbing in
// place. A slow drift sets which way it's leaning (and which way it faces); a
// small vertical bob at twice that rate sells the busy footwork. Both derive
// from elapsed time each frame — no particles, no per-frame allocation.
const SCUTTLE_SPEED = 1.6; // side-to-side drift cadence
const SCUTTLE_AMT = 9; // px it skitters left/right of its tile centre
const SCUTTLE_BOB = 4; // px it lifts at the busiest part of a scuttle

// Active-companion follower: hops after its owner between spaces (arriving a
// beat late), then pokes around the space when idle.
const PET_DRAW_H = 30; // on-board display height (px); sprites scaled to this
// Sprites sit ~15px up from the bottom of their 128px frame, so the visible feet
// (the contact point used for depth sorting) are inset from the drawn image's
// bottom edge by this fraction of the draw height.
const SPRITE_FOOT_INSET = 15 / 128;
const PET_HOP_DUR = 150; // ms per follower hop (2× follow speed)
const PET_HOP_HEIGHT = 7; // px lift at a hop's peak
const PET_HOP_STEP = 34; // max px one hop advances toward the target (far = chain hops)
const PET_DUST_SCALE = 0.55; // little critter → smaller, wispier landing puff than a token
const PET_REST_DIST = 5; // within this of the target the pet is "at rest"
const PET_FOLLOW_DX = -20; // resting offset from the owner's feet (lower-left)
const PET_FOLLOW_DY = 7;
const PET_EXPLORE_MIN = 2600; // ms at rest before it may wander
const PET_EXPLORE_MAX = 6000;
const PET_EXPLORE_RADIUS = 30; // px it wanders around the space
const PET_EXPLORE_DWELL = 2200; // ms it pokes around before settling back
// Fallback feel when a pet has no temperament (matches the historical profile).
const DEFAULT_PET_PROFILE: TemperamentProfile = {
  name: 'Default',
  exploreMin: PET_EXPLORE_MIN,
  exploreMax: PET_EXPLORE_MAX,
  exploreRadius: PET_EXPLORE_RADIUS,
  exploreDwell: PET_EXPLORE_DWELL,
  hopDur: PET_HOP_DUR,
  hopHeight: PET_HOP_HEIGHT,
  hopStep: PET_HOP_STEP,
  breathAmp: 0.6,
};

// A barrier guardian stands its ground and hops "ever so slightly" to read as
// actively blocking the way — a shallow, slow bob with a touch of side sway.
const GUARDIAN_H = 64; // draw height, a shade bigger than a player token
const GUARDIAN_HOP_SPEED = 3.0; // bob cadence
const GUARDIAN_HOP_HEIGHT = 5; // px lift at the peak — deliberately small
const GUARDIAN_SWAY = 3; // px side-to-side pacing

// A lair boss paces behind its gate: heavier/slower breathing than a token and
// an occasional lunge — mostly stationary, reads as a caged beast.
const LAIR_H = 116; // bigger than a barrier guardian — it's a boss
const LAIR_BREATH_SPEED = 1.3; // slow, deep breathing
const LAIR_BREATH_AMT = 0.07; // ±7% vertical wobble
const LAIR_LUNGE_PERIOD = 5.0; // seconds between lunges
const LAIR_LUNGE_AMT = 12; // px forward dip at the lunge peak
const LAIR_BACK_OFFSET = 26; // px north — sits behind the lair space
// Once you hold a lair's sigil the boss lingers only as a vestige of itself:
// darker, drained of colour, softly blurred and see-through so it reads as a
// weakened echo rather than the living threat it used to be.
const VESTIGE_FILTER = 'brightness(0.42) saturate(0.35) blur(0.7px)';
const VESTIGE_ALPHA = 0.55; // translucent — you can see the floor through it
// Depths hazard tiles wear a shadow of their dungeon's sigil boss instead of the
// generic warning triangle, so each lair's hazards read as its own cursed turf.
const HAZARD_OMEN_H = 40; // silhouette draw height — sits within the ~52px coin
const HAZARD_OMEN_FILTER = 'brightness(0) saturate(0)'; // flatten to a pure shadow
const HAZARD_OMEN_ALPHA = 0.72; // dark, but the hazard disc colour still frames it
// The wilderness World Event beast — larger than a lair boss, since it straddles
// a 3-tile footprint and is the biggest thing on the overworld.
const WORLD_EVENT_H = 150;
// A body hump on each flank tile — shorter than the reared head+neck.
const WORLD_EVENT_PIECE_H = 96;
// Cap the body-line tilt (radians) so a near-vertical flank→center run never
// lays a hump flat on its side.
const WORLD_EVENT_PIECE_TILT_MAX = 1.0;

/** One render/view layer: its node subset + world bounds, and its terrain. */
interface Layer {
  spec: LayerSpec;
  terrain: TerrainArt;
}

export class BoardCanvas {
  private ctx: CanvasRenderingContext2D;
  private nodeMap = new Map<string, BoardNode>();
  private players: BoardPlayer[] = [];
  private snares = new Set<string>();
  private barriersOpen = new Set<string>();
  private diceMarkers = new Set<string>();
  /** Barrier/lair node id -> its shared guardian HP pool, so the overworld can
   *  draw a boss-style health bar above each guardian as players chip it down. */
  private guardianPools: Record<string, { hp: number; maxHp: number }> = {};
  /** Ruin-lair node ids currently abandoned for this player (drawn faded). */
  private abandonedLairs = new Set<string>();
  /** Nodes sealed behind an unbroken barrier (or tunnels, for evolved units) —
   *  rendered greyed. */
  private lockedIds = new Set<string>();
  /** Own token's evolution tier; > 1 greys out the Tier-1-only tunnels. */
  private ownTier = 1;
  /** {wild/elite node id -> difficulty tier} for the T1/T2/T3 space badges. */
  private enemyTiers = new Map<string, EnemyTier>();
  /** {dig-site/gemstone-wall node id -> completion 0..1} for the progress ring. */
  private nodeProgress = new Map<string, number>();
  // Real transparent guardian art, lazily loaded from undercity/guardians/<id>.png.
  // Missing files (the folder is a placeholder for now) fall back to a token sprite.
  private guardianTex = new Map<string, HTMLImageElement>();
  private guardianMiss = new Set<string>();
  private guardianLoading = new Set<string>();
  // Real transparent enemy art (undercity/enemies/<id>.png), lazily loaded for
  // the roaming enraged monster so it shows its actual creature sprite.
  private enemyTex = new Map<string, HTMLImageElement>();
  private enemyMiss = new Set<string>();
  private enemyLoading = new Set<string>();
  /** The live wilderness World Event ("Great Beast"), or null. Its sprite is
   *  drawn straddling its 3-node footprint, centered on `center`. */
  private worldEvent: WorldEventState | null = null;
  private worldEventTex: HTMLImageElement | null = null;
  private worldEventLoading = false;
  private worldEventMiss = false;
  // Serpent-body hump drawn on the footprint's flank tiles (see loadWorldEvent).
  private worldEventPieceTex: HTMLImageElement | null = null;
  private worldEventPieceLoading = false;
  private worldEventPieceMiss = false;
  /** The live wilderness enraged monster (spell-targetable, relocates hourly),
   *  or null when it's dead this window / never fed. */
  private enraged: EnragedMonster | null = null;
  private choices = new Set<string>();
  private backChoice: string | null = null;
  private info: NodeInfo | null = null;
  private infoShownAt = 0;
  // Popovers shown on every legal destination while a move is in progress.
  private choiceInfos: NodeInfo[] = [];
  // Per-destination appear timestamp so each popover pops in when it arrives.
  private choiceShownAt = new Map<string, number>();
  // Steps left in the current turn, shown as a die over your own token.
  private stepDie: number | null = null;
  private ownPosition: string | null = null;
  private tokenAnims = new Map<string, TokenAnim>();
  private camGlide: CamGlide | null = null;
  private dust: DustMote[] = [];
  private sparkles: Sparkle[] = [];
  private heals: HealNumber[] = [];
  private bolts: Bolt[] = [];
  // Spell effects queued from a cast/hit, resolved to live positions in draw().
  private pendingCast: SpellCastFx[] = [];
  private pendingHit: SpellHitFx[] = [];
  private highFive: HighFiveAnim | null = null;
  private healPending = false;
  private sparkleAccum = 0; // time since last sparkle emission
  private shinyAccum = 0; // time since last shiny twinkle emission
  private effectClock = 0; // ms, monotonic; drives special-paint overlays
  private pendingHealPops: { userId: string; amount: number }[] = [];
  private lastTs = performance.now();
  /** Timestamp of the last terrain backing-store integrity probe (see draw). */
  private lastIntegrityTs = 0;
  private rafId: number | null = null;
  private startTime = performance.now();
  private layerSpecs: LayerSpec[];
  private layers = new Map<string, Layer>();
  /** All layer specs by id, for lazy terrain baking (see layerFor). */
  private specById = new Map<string, LayerSpec>();
  private layerOf = new Map<string, string>();
  private activeLayerId: string = OVERWORLD;
  /** The layer your *own* token currently sits on. Distinct from
   * activeLayerId: the focus picker can point the view at another layer
   * (spectateOn) while your token stays put — the auto-follow only kicks in
   * when this value changes, i.e. you actually crossed layers yourself. */
  private ownLayer: string = OVERWORLD;
  private explored = new Map<string, Set<string>>(); // layerId -> lit node ids
  private static readonly EXPLORED_KEY = 'undercity-explored-v1';
  private floorTex: FloorTextures = {};
  private landmarkTex: LandmarkTextures = {};
  private treasureTex: HTMLImageElement | null = null;
  private treasurePlunderedTex: HTMLImageElement | null = null;
  private firsts: Record<string, { by: string; kind: string }> = {};
  /** Ashen Fog node id -> the space type it permanently revealed to. */
  private fogReveals: Record<string, string> = {};
  private clearedDungeons = new Set<string>(); // biome keys with your sigil
  private onEnterDungeonCb: ((biome: string) => void) | null = null;
  private ambient: BoardAmbient;

  private get active(): Layer {
    return this.layerFor(this.activeLayerId) ?? this.layerFor(OVERWORLD)!;
  }

  /**
   * Fetch a layer's baked terrain, baking it on first access. Terrain is baked
   * lazily — only the layer you're actually looking at gets a backing store —
   * because eagerly baking all ~6 layers (each with per-zone floor-painting
   * compositing) on construction cost seconds of black screen on every board-
   * tab entry. The overworld bakes in the constructor so first paint is instant;
   * dungeon pockets bake the moment your token (or the spectator view) enters
   * them, by which point the floor/landmark art has loaded, so they bake once,
   * with art, and never need the startup art-load rebuild.
   */
  private layerFor(id: string): Layer | undefined {
    const cached = this.layers.get(id);
    if (cached) return cached;
    const spec = this.specById.get(id);
    if (!spec) return undefined;
    const layer = this.bakeLayer(spec);
    this.layers.set(id, layer);
    return layer;
  }

  /** Bake one layer's terrain with the art + cleared state available right now. */
  private bakeLayer(spec: LayerSpec): Layer {
    const biome = spec.id.startsWith('pocket:')
      ? (this.map.nodes.find((n) => spec.nodeIds.has(n.id))?.id.split('_')[0] ?? null)
      : null;
    return {
      spec,
      terrain: renderTerrain(this.map, this.floorTex, this.landmarkTex, spec, {
        cleared: !!biome && this.clearedDungeons.has(biome),
        resolution: TERRAIN_RES,
        animateFlora: true,
        animatePaths: true,
      }),
    };
  }

  /**
   * A post-boss escape ladder (`<biome>_esc`) stays hidden until you hold that
   * dungeon's sigil — this is the "appears once you beat the boss" moment. The
   * server independently withholds it from move choices while unclaimed.
   */
  private isHiddenEscape(nodeId: string): boolean {
    if (!nodeId.endsWith('_esc')) return false;
    return !this.clearedDungeons.has(nodeId.split('_')[0]);
  }

  /** Region -> its barrier gate node ids, computed once (barriers never move).
   *  A region with barrier gates keeps its lair bosses concealed until one of
   *  those gates is broken. */
  private _regionBarriers: Map<string, string[]> | null = null;
  private regionBarriers(region: string): string[] {
    if (!this._regionBarriers) {
      const m = new Map<string, string[]>();
      for (const x of this.map.nodes) {
        if (x.type === 'barrier' && x.region) {
          const list = m.get(x.region) ?? [];
          list.push(x.id);
          m.set(x.region, list);
        }
      }
      this._regionBarriers = m;
    }
    return this._regionBarriers.get(region) ?? [];
  }

  /** A lair inside a still-sealed region hides its occupant: if the lair's
   *  region has barrier gates and none are broken yet, we don't reveal which
   *  monster resides there. Breaking any one gate breaches the region (shared
   *  season state) and reveals its lairs for everyone. The ruins' Lord of
   *  Extinction and Doomgape stay unknown until a ruin guardian falls; biome
   *  lairs live in barrier-less dungeon pockets, so they're never concealed. */
  private isConcealedLair(n: BoardNode): boolean {
    if (!n.region) return false;
    const gates = this.regionBarriers(n.region);
    if (gates.length === 0) return false;
    return !gates.some((id) => this.barriersOpen.has(id));
  }

  /**
   * Re-render terrain for layers that are ALREADY baked, with the current art +
   * cleared flags. Only touches layers with a live backing store (lazy baking
   * means unvisited pockets have none — they'll bake fresh, with whatever art
   * has loaded, on first entry, so re-baking them here would be wasted work and
   * would defeat the lazy scheme). Pass `onlyLayerIds` to narrow further (e.g.
   * the one pocket whose cleared flag toggled). The outgoing canvas's backing
   * store is freed immediately (width/height → 0) because iOS WebKit reclaims
   * large canvases lazily, and a pile of orphaned ones is what tips the tab over
   * its memory ceiling.
   */
  private rebuildLayers(onlyLayerIds?: ReadonlySet<string>): void {
    for (const spec of this.layerSpecs) {
      if (onlyLayerIds && !onlyLayerIds.has(spec.id)) continue;
      const old = this.layers.get(spec.id);
      if (!old) continue; // not baked yet — leave it lazy
      // Free the old backing store BEFORE allocating the replacement: baking
      // into a second ~29 MB canvas while the old one is still resident doubles
      // peak terrain memory for the duration of the bake, and that transient
      // spike is exactly what tips a memory-constrained tab into eviction. The
      // rebuild is synchronous (no frame draws between these lines), and the
      // integrity probe re-bakes if a bake ever left the layer blank.
      old.terrain.canvas.width = 0;
      old.terrain.canvas.height = 0;
      this.layers.set(spec.id, this.bakeLayer(spec));
    }
  }

  /**
   * Free the backing store of any baked dungeon-pocket terrain that isn't the
   * layer currently on screen. Called whenever the visible layer changes: the
   * overworld hub is kept resident (re-baking its ~29 MB canvas on every dungeon
   * exit would stutter), but pockets are small and re-bake lazily on re-entry,
   * so dropping the ones you've left bounds resident terrain to hub + current
   * pocket — otherwise a session of dungeon-diving piles up a canvas per pocket
   * visited, and that accumulation is a prime eviction trigger.
   */
  private freeOffscreenLayers(): void {
    for (const [id, layer] of [...this.layers]) {
      if (id === OVERWORLD || id === this.activeLayerId) continue;
      layer.terrain.canvas.width = 0;
      layer.terrain.canvas.height = 0;
      this.layers.delete(id); // dropped from the cache → layerFor re-bakes on re-entry
    }
  }

  /** Coalesce the burst of startup art-load rebuilds (9 floors + 5 landmarks +
   *  decals each trigger one) into a single trailing rebuild. Per-frame rAF
   *  coalescing still let the burst cost several full all-layer rebuilds when
   *  cached images decoded across a few frames — a visible tab-entry stall.
   *  A short trailing debounce makes the whole burst cost exactly one rebuild;
   *  on a cold cache a straggler image just schedules one more. */
  private rebuildTimer: ReturnType<typeof setTimeout> | null = null;
  private scheduleRebuild(): void {
    if (this.rebuildTimer !== null) clearTimeout(this.rebuildTimer);
    this.rebuildTimer = setTimeout(() => {
      this.rebuildTimer = null;
      this.rebuildLayers();
    }, 150);
  }

  /**
   * Detect (and heal) a lost canvas backing store. Android Chrome — and iOS
   * WebKit — can discard the backing store of large, idle offscreen canvases
   * under memory pressure: the canvas element stays alive but blits as fully
   * transparent, so the baked terrain and the recolored player sprites silently
   * vanish while the vector-drawn discs (which are re-issued every frame) stay
   * put, and nothing ever repaints them because they're baked exactly once — the
   * board sits blank until a reload. We can't prevent the eviction, but we can
   * notice it: renderTerrain fills the whole canvas edge-to-edge with an opaque
   * wall colour, so a single transparent pixel means the store was dropped.
   * Probed at most every ~2s; one 1×1 readback is cheap.
   */
  private checkTerrainIntact(ts: number): void {
    if (ts - this.lastIntegrityTs < 2000) return;
    this.lastIntegrityTs = ts;
    const cv = this.active.terrain.canvas;
    let lost = cv.width === 0 || cv.height === 0;
    if (!lost) {
      try {
        // Intact terrain is opaque everywhere (the #141110 base fill), so alpha 0
        // at (0,0) means the backing store was reclaimed out from under us.
        lost = cv.getContext('2d')!.getImageData(0, 0, 1, 1).data[3] === 0;
      } catch {
        lost = true; // a context/readback failure is itself a lost store
      }
    }
    if (lost) this.recoverLostCanvases();
  }

  /**
   * Re-bake every live terrain layer and drop the sprite-engine's canvas caches
   * after a detected eviction, so the board and tokens repaint on the next frame
   * instead of staying blank until reload. Backing stores are usually reclaimed
   * as a group under memory pressure, so we rebuild all baked layers, not just
   * the visible one.
   */
  private recoverLostCanvases(): void {
    console.warn('[undercity] canvas backing store evicted — rebuilding board terrain');
    for (const [id, layer] of [...this.layers]) {
      const spec = this.specById.get(id);
      if (!spec) continue;
      this.layers.set(id, this.bakeLayer(spec));
      layer.terrain.canvas.width = 0;
      layer.terrain.canvas.height = 0;
    }
    clearSpriteCanvasCaches();
  }

  /** Season-global first-conqueror plates + plundered-treasure state. */
  setFirsts(firsts: Record<string, { by: string; kind: string }>): void {
    this.firsts = firsts ?? {};
  }

  /** Live dig-site / gemstone-wall completion, for the coin progress rings. */
  setProgress(excavations: Record<string, DigGrid>, veins: Record<string, VeinState>): void {
    this.nodeProgress = computeProgress(this.map, excavations ?? {}, veins ?? {});
  }

  /** Season-global Ashen Fog reveals: node id -> the type the fog locked to. */
  setFogReveals(fogReveals: Record<string, string>): void {
    this.fogReveals = fogReveals ?? {};
  }

  /** Dungeons YOU hold the sigil for render as 'cleared' (banner, calm glow). */
  setClearedDungeons(biomes: string[]): void {
    const next = new Set(biomes);
    if (
      next.size === this.clearedDungeons.size &&
      [...next].every((b) => this.clearedDungeons.has(b))
    ) {
      return; // no change — don't rebuild terrain
    }
    // Only the pocket layers for biomes whose cleared flag toggled need
    // re-baking — the overworld terrain is independent of cleared state, so
    // never reallocate its ~59 MB canvas here.
    const changed = new Set<string>();
    for (const b of next) if (!this.clearedDungeons.has(b)) changed.add(b);
    for (const b of this.clearedDungeons) if (!next.has(b)) changed.add(b);
    this.clearedDungeons = next;
    const affected = new Set(
      this.layerSpecs
        .filter((spec) => {
          if (!spec.id.startsWith('pocket:')) return false;
          const biome = this.map.nodes.find((n) => spec.nodeIds.has(n.id))?.id.split('_')[0];
          return !!biome && changed.has(biome);
        })
        .map((spec) => spec.id),
    );
    if (affected.size) this.rebuildLayers(affected);
  }

  /** Fires once per layer-swap into a dungeon (component shows the rite card). */
  setOnEnterDungeon(cb: (biome: string) => void): void {
    this.onEnterDungeonCb = cb;
  }

  private camX = 0;
  private camY = 0;
  private zoom = 0.8;
  /** Logical (CSS-pixel) viewport size. The canvas backing store is this ×
   *  `dpr`; all camera/viewport math stays in these logical units. */
  private viewW = 0;
  private viewH = 0;
  /** Device-pixel ratio the backing store is rendered at, capped at 2 so a
   *  DPR-3 phone pays ~4× fill for retina crispness instead of 9×. */
  private dpr = 1;
  /** Read-only broadcast mode: no input wired, dungeons fully revealed. */
  private interactive = true;
  private revealAll = false;

  /** Own illumination state: illuminating gear reveals the whole dungeon. */
  private ownIlluminated = false;

  /** Darkvision (Mosslight Cavern hatch perk): dungeon light radius 2, not 1. */
  private ownDarkvision = false;

  private boundResize = () => this.resize();
  private pointerHandlers: {
    onDown: (e: PointerEvent) => void;
    onMove: (e: PointerEvent) => void;
    onUp: (e: PointerEvent) => void;
  } | null = null;
  private onWheelHandler: ((e: WheelEvent) => void) | null = null;

  constructor(
    private canvas: HTMLCanvasElement,
    private map: BoardMap,
    private onTapNode: (nodeId: string | null) => void,
    private ownUserId: string | null,
    opts: BoardCanvasOpts = {},
  ) {
    this.interactive = opts.interactive !== false;
    this.revealAll = !this.interactive;
    this.ctx = canvas.getContext('2d')!;
    for (const n of map.nodes) this.nodeMap.set(n.id, n);
    this.enemyTiers = computeEnemyTiers(map);
    this.layerSpecs = computeLayers(map);
    this.layerOf = layerIndex(this.layerSpecs);
    for (const spec of this.layerSpecs) this.specById.set(spec.id, spec);
    // Bake only the layer you open on (the overworld) so first paint is instant;
    // every other layer bakes lazily on first entry (see layerFor). Baking all
    // ~6 layers up front cost seconds of black screen on each board-tab entry.
    // This first bake is artless (floor/landmark images load async right below);
    // the debounced art-load rebuild re-bakes it once the art arrives.
    const initial = this.specById.get(this.activeLayerId) ?? this.layerSpecs[0];
    this.layers.set(initial.id, {
      spec: initial,
      terrain: renderTerrain(map, undefined, undefined, initial, {
        resolution: TERRAIN_RES,
        animateFlora: true,
        animatePaths: true,
      }),
    });
    // Dungeon fog-of-war: nodes you've stood on stay lit across sessions.
    try {
      const raw = JSON.parse(localStorage.getItem(BoardCanvas.EXPLORED_KEY) ?? '{}');
      for (const [layerId, ids] of Object.entries(raw)) {
        this.explored.set(layerId, new Set(ids as string[]));
      }
    } catch {
      /* corrupt state = start dark */
    }
    this.ambient = new BoardAmbient(map);
    // Rebuild every layer's terrain once the per-biome floor paintings arrive —
    // they replace the flat black with ghosted scenery that cross-fades between
    // chambers. draw() reads this.active.terrain fresh each frame, so the swap
    // is seamless; a failed load just leaves that biome's floor dark.
    const floorSrc: Record<string, string> = {};
    if (map.regions) {
      for (const [rid, spec] of Object.entries(map.regions)) {
        if (spec.background) floorSrc[rid] = spec.background;
      }
    } else {
      // Pre-v2 map file without regions{} — the old hardcoded assignments.
      Object.assign(floorSrc, LEGACY_FLOOR_SRC);
    }
    // Landmark buildings: the shrine and boss lair are pixel-art sprites
    // (the temple art stands in as the ominous boss lair); every other
    // landmark stays procedural. Keyed by node type.
    const landmarkSrc: Record<string, string> = {
      shrine: 'undercity/icons/shrine.png',
      boss: 'undercity/icons/temple.png',
      shop: 'undercity/icons/bazaar.png',
      warp: 'undercity/icons/teleport.png',
      witch: 'undercity/icons/bog_witch_hut.png',
    };
    // Re-render with whatever art has arrived; draw() reads this.active.terrain
    // fresh each frame, so each successful load pops in seamlessly.
    for (const [region, src] of Object.entries(floorSrc)) {
      const img = new Image();
      img.onload = () => {
        this.floorTex[region] = img;
        this.scheduleRebuild();
      };
      img.src = src;
    }
    for (const [type, src] of Object.entries(landmarkSrc)) {
      const img = new Image();
      img.onload = () => {
        this.landmarkTex[type] = img;
        this.scheduleRebuild();
      };
      img.src = src;
    }
    // Treasure hoard set-piece (+ its plundered variant), drawn dynamically per
    // frame in drawSpace so the plundered swap needs no terrain rebuild.
    const hoard = new Image();
    hoard.onload = () => (this.treasureTex = hoard);
    hoard.src = 'undercity/icons/treasure_hoard.png';
    const plundered = new Image();
    plundered.onload = () => (this.treasurePlunderedTex = plundered);
    plundered.src = 'undercity/icons/treasure_hoard_plundered.png';
    // Image decals paint into the prerendered terrain; re-render as each lands.
    preloadDecalImages(map, () => this.scheduleRebuild());
    this.resize();
    if (this.interactive) this.initInput();
    window.addEventListener('resize', this.boundResize);
  }

  /** The wandering trading post's current node + move time (null when unknown). */
  private umori: { node: string; movesAt: string } | null = null;
  private umoriImg: HTMLImageElement | null = null;
  private umoriLoading = false;

  setUmori(umori: { node: string; movesAt: string } | null): void {
    this.umori = umori;
  }

  // ── Active companion follower ──────────────────────────────────────────────
  private activePetSprite: string | null = null;
  private petImg: HTMLImageElement | null = null;
  /** Temperament driving the follower's idle/wander/hop feel; null → defaults. */
  private petProfile: TemperamentProfile | null = null;
  private pet: {
    x: number;
    y: number;
    hopStart: number;
    hopFrom: { x: number; y: number };
    hopTo: { x: number; y: number };
    hopping: boolean;
    facing: number;
    exploring: boolean;
    exploreUntil: number;
    nextExplore: number;
    explore: { x: number; y: number };
  } | null = null;

  /** Set (or clear) the sprite of the owner's active companion, drawn trailing
   *  the own token on the board. Pass null to hide it. `temperament` reshapes
   *  its idle/wander/hop feel (null falls back to the default lively profile). */
  setActivePet(spriteUrl: string | null, temperament: TemperamentProfile | null = null): void {
    this.petProfile = temperament;
    if (spriteUrl === this.activePetSprite) return;
    this.activePetSprite = spriteUrl;
    this.pet = null; // re-seed beside the owner on the next frame
    if (!spriteUrl) {
      this.petImg = null;
      return;
    }
    const img = new Image();
    img.src = spriteUrl;
    this.petImg = img;
  }

  setPlayers(players: BoardPlayer[]): void {
    this.players = players;
    const own = players.find((p) => p.userId === this.ownUserId);
    this.ownPosition = own?.position ?? null;
    this.ownIlluminated = !!own?.illuminated;
    this.ownDarkvision = !!own?.darkvision;
    const tier = own?.tier ?? 1;
    if (tier !== this.ownTier) {
      this.ownTier = tier;
      this.recomputeLocked(); // tunnels grey in/out as you evolve
    }
    // Spectator (no own token) drives layers itself via showLayerOf(); skip the
    // auto-follow so a repeated poll can't yank the view back to the overworld.
    if (!this.ownUserId) return;
    // The visible layer follows your own token: descend a ladder and the view
    // swaps to that dungeon pocket; climb out and it returns to the overworld.
    // Guard on ownLayer *changing* rather than "differs from active" so a
    // repeated poll can't yank the view back while you're spectating another
    // player's layer via the focus picker (spectateOn) — that only ends when
    // your own token crosses layers or you recenter on yourself.
    const target = this.ownPosition ? this.layerOf.get(this.ownPosition) ?? OVERWORLD : OVERWORLD;
    if (target !== this.ownLayer) {
      this.ownLayer = target;
      this.activeLayerId = target;
      this.freeOffscreenLayers(); // drop the pocket we just left
      this.clampCamera();
      if (this.ownPosition) this.centerOn(this.ownPosition, false);
      const b = this.active.spec.bounds;
      this.ambient.setContext(
        target === OVERWORLD ? 'overworld' : (this.ownPosition?.split('_')[0] ?? 'overworld'),
        { x: b.x, y: b.y, w: b.w, h: b.h },
      );
      if (target !== OVERWORLD && this.ownPosition) {
        this.onEnterDungeonCb?.(this.ownPosition.split('_')[0]);
      }
    }
    if (this.ownPosition && this.activeLayerId !== OVERWORLD) {
      this.markExplored(this.activeLayerId, this.ownPosition);
    }
  }

  /** Record own presence on a dungeon node; persists across sessions. */
  private markExplored(layerId: string, nodeId: string): void {
    const set = this.explored.get(layerId) ?? new Set<string>();
    if (set.has(nodeId)) return;
    set.add(nodeId);
    this.explored.set(layerId, set);
    try {
      const obj: Record<string, string[]> = {};
      for (const [k, v] of this.explored) obj[k] = [...v];
      localStorage.setItem(BoardCanvas.EXPLORED_KEY, JSON.stringify(obj));
    } catch {
      /* storage full/blocked — stay session-only */
    }
  }

  /** A dungeon node is lit if explored or within your light radius — 1 hop
   *  normally, 2 with the Mosslight Cavern Darkvision perk. Illuminating gear
   *  reveals the whole dungeon layer — power for information. */
  private isLit(nodeId: string): boolean {
    if (this.activeLayerId === OVERWORLD) return true;
    if (this.revealAll) return true; // broadcast: no fog-of-war on the TV
    if (this.ownIlluminated) return true; // illuminating gear: whole dungeon lit
    if (this.explored.get(this.activeLayerId)?.has(nodeId)) return true;
    if (!this.ownPosition) return false;
    return this.hopsWithin(this.ownPosition, nodeId, this.ownDarkvision ? 2 : 1);
  }

  /** True if `goal` is within `maxHops` graph steps of `start`. */
  private hopsWithin(start: string, goal: string, maxHops: number): boolean {
    if (start === goal) return true;
    const seen = new Set([start]);
    let frontier = [start];
    for (let d = 0; d < maxHops; d++) {
      const next: string[] = [];
      for (const id of frontier) {
        for (const nb of this.nodeMap.get(id)?.neighbors ?? []) {
          if (nb === goal) return true;
          if (!seen.has(nb)) {
            seen.add(nb);
            next.push(nb);
          }
        }
      }
      frontier = next;
    }
    return false;
  }

  setSnares(nodeIds: string[]): void {
    this.snares = new Set(nodeIds);
  }

  /**
   * User ids currently seated at an active board-game table (from the queue).
   * Their token wears a floating 🎲 badge so spectators can tell who's mid-game.
   */
  setDiceMarkers(userIds: string[]): void {
    this.diceMarkers = new Set(userIds);
  }

  /** Barrier nodes broken open this season — sealed ones wear rubble. */
  setBarriersOpen(nodeIds: string[]): void {
    this.barriersOpen = new Set(nodeIds);
    this.recomputeLocked();
  }

  /** Live guardian HP pools (barrier + lair), keyed by node id, for the
   *  overworld health bars drawn above each guardian/sigil boss. */
  setGuardianPools(pools: Record<string, { hp: number; maxHp: number }>): void {
    this.guardianPools = pools;
  }

  /** Ruin-lair node ids currently abandoned for this player (drawn faded). */
  setAbandonedLairs(nodeIds: string[]): void {
    this.abandonedLairs = new Set(nodeIds);
  }

  /** The live wilderness World Event, or null to clear it (killed / never
   *  spawned). Kicks off the sprite load the first time one appears. */
  setWorldEvent(we: WorldEventState | null): void {
    this.worldEvent = we && !we.dead ? we : null;
    if (this.worldEvent) this.loadWorldEvent();
  }

  /** The live wilderness enraged monster, or null to clear it (dead / never
   *  spawned). Kicks off its real enemy-art load the first time one appears. */
  setEnraged(er: EnragedMonster | null): void {
    this.enraged = er && !er.dead && er.node ? er : null;
    if (this.enraged) this.loadEnemy(this.enraged.spriteId ?? '');
  }

  private loadWorldEvent(): void {
    if (!(this.worldEventTex || this.worldEventLoading || this.worldEventMiss)) {
      this.worldEventLoading = true;
      const img = new Image();
      img.onload = () => {
        this.worldEventTex = img;
        this.worldEventLoading = false;
      };
      img.onerror = () => {
        this.worldEventMiss = true;
        this.worldEventLoading = false;
      };
      img.src = WORLD_EVENT_SPRITE;
    }
    if (!(this.worldEventPieceTex || this.worldEventPieceLoading || this.worldEventPieceMiss)) {
      this.worldEventPieceLoading = true;
      const piece = new Image();
      piece.onload = () => {
        this.worldEventPieceTex = piece;
        this.worldEventPieceLoading = false;
      };
      piece.onerror = () => {
        this.worldEventPieceMiss = true;
        this.worldEventPieceLoading = false;
      };
      piece.src = WORLD_EVENT_PIECE_SPRITE;
    }
  }

  /**
   * Nodes sealed behind a still-closed barrier: reachable from the gate only
   * by passing through a barrier that hasn't been broken yet. They render
   * greyed so it's clear they can't be visited. The barrier space itself is
   * NOT locked — you must be able to reach it to fight the guardian.
   */
  private recomputeLocked(): void {
    const byId = new Map(this.map.nodes.map((n) => [n.id, n]));
    const sealed = (id: string) =>
      byId.get(id)?.type === 'barrier' && !this.barriersOpen.has(id);
    // Warp mushrooms teleport between each other — mirror that here (as the
    // game's reachability does) so the warp-in-only island isn't mislabelled
    // locked. Only true behind-a-barrier pockets should grey out.
    const warps = this.map.nodes.filter((n) => n.type === 'warp').map((n) => n.id);
    const start = this.map.gate;
    const reached = new Set<string>([start]);
    const queue = [start];
    while (queue.length) {
      const cur = queue.shift()!;
      // A sealed barrier is reachable, but you can't walk THROUGH it.
      if (cur !== start && sealed(cur)) continue;
      const nbs = [...(byId.get(cur)?.neighbors ?? [])];
      if (byId.get(cur)?.type === 'warp') nbs.push(...warps.filter((w) => w !== cur));
      for (const nb of nbs) {
        if (!reached.has(nb)) {
          reached.add(nb);
          queue.push(nb);
        }
      }
    }
    const locked = new Set(
      this.map.nodes.filter((n) => !reached.has(n.id)).map((n) => n.id),
    );
    // Tunnels are usable by every tier now (evolved units pay a Spore toll on
    // landing) — no tier-based greying. The server omits tunnels a unit can't
    // afford from its move options, so unreachable ones already grey out above.
    this.lockedIds = locked;
  }

  setChoices(nodeIds: string[] | null): void {
    this.choices = new Set(nodeIds ?? []);
  }

  /** The space behind you while walking a roll — tappable to step back. */
  setBackChoice(nodeId: string | null): void {
    this.backChoice = nodeId;
  }

  setInfo(info: NodeInfo | null): void {
    this.info = info;
    this.infoShownAt = performance.now();
  }

  /** Popovers to keep pinned on the legal destinations during a move. */
  setChoiceInfos(infos: NodeInfo[]): void {
    const now = performance.now();
    const next = new Set(infos.map((i) => i.nodeId));
    // Stamp each newly-appeared popover so it pops in; forget ones that left.
    for (const i of infos) {
      if (!this.choiceShownAt.has(i.nodeId)) this.choiceShownAt.set(i.nodeId, now);
    }
    for (const id of [...this.choiceShownAt.keys()]) {
      if (!next.has(id)) this.choiceShownAt.delete(id);
    }
    this.choiceInfos = infos;
  }

  /** Steps left this turn, floated as a die over your token (null = hidden). */
  setStepDie(n: number | null): void {
    this.stepDie = n;
  }

  /** Lit while the walk-so-far will heal at a gate — draws a green sparkle
   *  aura on your own token until the move commits (or you retrace off it). */
  setSelfHealPending(on: boolean): void {
    this.healPending = on;
  }

  /** Pop a green "+amount" number off a token (fired when a gate heal lands). */
  popHealNumber(userId: string, amount: number): void {
    if (amount > 0) this.pendingHealPops.push({ userId, amount });
  }

  /** A green "poof of grass" burst over a board node — fired when an economy
   *  companion scavenges Spores from a loot space you passed over. A dense double
   *  burst plus a floating "+N" reads clearly against the busy board; pass the
   *  node's Spore share to pop the number. */
  poofAtNode(nodeId: string, spores = 0): void {
    const n = this.nodeMap.get(nodeId);
    if (!n) return;
    // Inner tuft implodes then an outer burst throws grass up — twice the
    // particles of a plain effect so the grab is unmissable.
    this.puffAt(n.x, n.y, '#c8f36b', '#5aa832', 'implode', 14);
    this.puffAt(n.x, n.y, '#8fe36b', '#43a047', 'burst', 24);
    if (spores > 0) this.floatNumber(n.x, n.y - 18, `+${spores}`, '#d8f77a');
  }

  centerOn(nodeId: string, animate = true): void {
    this.focusOn(nodeId, undefined, animate);
  }

  /** Current camera zoom — persisted by the board tab so it survives a tab
   *  switch (the tab, and this canvas, are destroyed while away). */
  getZoom(): number {
    return this.zoom;
  }

  /** Seed the zoom before `start()`'s initial focus runs, so returning to the
   *  Board tab re-centers on your creature at the zoom you left. Clamped on the
   *  next `centerOn`/`clampCamera`, so an out-of-range value self-corrects. */
  restoreZoom(zoom: number): void {
    this.zoom = Math.min(MAX_ZOOM, Math.max(MIN_ZOOM, zoom));
  }

  /**
   * Pan — and optionally zoom — the camera to center a node. The spectator
   * broadcast drives this between scenes: a hero beat pushes in with a high
   * `targetZoom`, a flyover pulls out with a low one. The camera destination
   * is computed at the final zoom so the node lands centered, and `durationMs`
   * lets a slow flyover glide take longer than a snappy scene cut.
   */
  focusOn(nodeId: string, targetZoom?: number, animate = true, durationMs = MOVE_MS): void {
    const n = this.nodeMap.get(nodeId);
    if (!n) return;
    const toZoom =
      targetZoom != null ? Math.min(MAX_ZOOM, Math.max(MIN_ZOOM, targetZoom)) : this.zoom;
    const toX = n.x - this.viewW / toZoom / 2;
    const toY = n.y - this.viewH / toZoom / 2;
    if (!animate) {
      this.camGlide = null;
      this.zoom = toZoom;
      this.camX = toX;
      this.camY = toY;
      this.clampCamera();
      return;
    }
    this.camGlide = {
      fromX: this.camX,
      fromY: this.camY,
      toX,
      toY,
      fromZoom: this.zoom,
      toZoom,
      start: performance.now(),
      durationMs,
    };
  }

  /**
   * Switch the visible layer to whichever one holds `nodeId` (overworld or a
   * dungeon pocket). The spectator calls this explicitly because, with no own
   * token, setPlayers() keeps the view locked to the overworld — this lets a
   * hero/hotspot beat dive into the pocket where the action is.
   */
  showLayerOf(nodeId: string): void {
    const target = this.layerOf.get(nodeId) ?? OVERWORLD;
    if (target === this.activeLayerId) return;
    this.activeLayerId = target;
    this.freeOffscreenLayers(); // drop the pocket the spectator left
    this.clampCamera();
    const b = this.active.spec.bounds;
    this.ambient.setContext(target === OVERWORLD ? 'overworld' : nodeId.split('_')[0], {
      x: b.x,
      y: b.y,
      w: b.w,
      h: b.h,
    });
  }

  /**
   * Focus-picker action: reveal whatever layer holds `nodeId` — the overworld,
   * a dungeon pocket, or a lair — and center the camera on it. Unlike the
   * own-token auto-follow this sticks: a repeated poll won't drag the view back
   * to your own creature until your token crosses layers or you recenter on
   * yourself. Snaps (no glide) when crossing layers, glides within one.
   */
  spectateOn(nodeId: string): void {
    if (!this.nodeMap.has(nodeId)) return;
    const switching = (this.layerOf.get(nodeId) ?? OVERWORLD) !== this.activeLayerId;
    this.showLayerOf(nodeId);
    this.centerOn(nodeId, !switching);
  }

  // ── Camera / input (same interaction model as the plaza) ───────────────────

  private resize(): void {
    const parent = this.canvas.parentElement;
    if (!parent) return;
    // Preserve the world point currently at the viewport centre across the
    // resize. Without this, a resize re-clamps the top-left corner only, so a
    // viewport change — notably the mobile URL bar hiding, which shifts 100dvh
    // moments after load — slides the camera off whatever it was framing
    // (your own creature on first entry). Skip on the very first sizing, when
    // there's no prior centre to keep.
    const hadSize = this.viewW > 0 && this.viewH > 0;
    const cx = this.camX + this.viewW / this.zoom / 2;
    const cy = this.camY + this.viewH / this.zoom / 2;
    this.dpr = Math.min(window.devicePixelRatio || 1, 2);
    this.viewW = parent.clientWidth || window.innerWidth;
    this.viewH = parent.clientHeight || window.innerHeight;
    // Backing store in device pixels so canvas-drawn text/sprites resolve at
    // the panel's true resolution; the CSS box stays the logical size (100%).
    this.canvas.width = Math.round(this.viewW * this.dpr);
    this.canvas.height = Math.round(this.viewH * this.dpr);
    if (hadSize) {
      this.camX = cx - this.viewW / this.zoom / 2;
      this.camY = cy - this.viewH / this.zoom / 2;
    }
    this.clampCamera();
  }

  private clampCamera(): void {
    // Min zoom fits the active layer's world-space bounds (whole overworld, or
    // just the current dungeon pocket); the letterboxed void matches the wall
    // color so it reads as more cave.
    const M = TERRAIN_MARGIN;
    const b = this.active.spec.bounds;
    const fit = Math.min(
      this.viewW / (b.w + 2 * M),
      this.viewH / (b.h + 2 * M),
    );
    const minZoom = Math.max(Math.min(fit, 1), MIN_ZOOM);
    this.zoom = Math.min(MAX_ZOOM, Math.max(minZoom, this.zoom));
    // Spectator broadcast: let the camera roam past the world edge so it can
    // center any biome dead-on (edge regions included) instead of stopping at
    // an invisible wall — that wall-stop is what made the camera "bounce".
    // The letterboxed void matches the wall colour, so it just reads as cave.
    if (!this.interactive) return;
    const vw = this.viewW / this.zoom;
    const vh = this.viewH / this.zoom;
    // Center any axis whose view is wider than the layer; clamp the rest.
    this.camX =
      vw >= b.w + 2 * M
        ? b.x + (b.w - vw) / 2
        : Math.max(b.x - M, Math.min(b.x + b.w + M - vw, this.camX));
    this.camY =
      vh >= b.h + 2 * M
        ? b.y + (b.h - vh) / 2
        : Math.max(b.y - M, Math.min(b.y + b.h + M - vh, this.camY));
  }

  private initInput(): void {
    this.canvas.style.touchAction = 'none';
    const pointers = new Map<number, { x: number; y: number }>();
    let dragStart: { x: number; y: number; camX: number; camY: number } | null = null;
    let didDrag = false;
    let lastPinchDist = 0;

    const onDown = (e: PointerEvent) => {
      e.preventDefault();
      this.camGlide = null; // manual panning wins over an in-flight glide
      pointers.set(e.pointerId, { x: e.clientX, y: e.clientY });
      this.canvas.setPointerCapture(e.pointerId);
      if (pointers.size === 1) {
        dragStart = { x: e.clientX, y: e.clientY, camX: this.camX, camY: this.camY };
        didDrag = false;
      } else if (pointers.size === 2) {
        const pts = [...pointers.values()];
        lastPinchDist = Math.hypot(pts[1].x - pts[0].x, pts[1].y - pts[0].y);
        dragStart = null;
        didDrag = true;
      }
    };

    const onMove = (e: PointerEvent) => {
      e.preventDefault();
      if (!pointers.has(e.pointerId)) return;
      pointers.set(e.pointerId, { x: e.clientX, y: e.clientY });
      if (pointers.size === 1 && dragStart) {
        const dx = e.clientX - dragStart.x;
        const dy = e.clientY - dragStart.y;
        if (!didDrag && (Math.abs(dx) > DRAG_THRESHOLD || Math.abs(dy) > DRAG_THRESHOLD)) {
          didDrag = true;
        }
        if (didDrag) {
          this.camX = dragStart.camX - dx / this.zoom;
          this.camY = dragStart.camY - dy / this.zoom;
          this.clampCamera();
        }
      } else if (pointers.size === 2) {
        const pts = [...pointers.values()];
        const dist = Math.hypot(pts[1].x - pts[0].x, pts[1].y - pts[0].y);
        const centerX = (pts[0].x + pts[1].x) / 2;
        const centerY = (pts[0].y + pts[1].y) / 2;
        if (lastPinchDist > 0) {
          const rect = this.canvas.getBoundingClientRect();
          const cx = centerX - rect.left;
          const cy = centerY - rect.top;
          const wx = this.camX + cx / this.zoom;
          const wy = this.camY + cy / this.zoom;
          this.zoom *= dist / lastPinchDist;
          this.clampCamera();
          this.camX = wx - cx / this.zoom;
          this.camY = wy - cy / this.zoom;
          this.clampCamera();
        }
        lastPinchDist = dist;
      }
    };

    const onUp = (e: PointerEvent) => {
      pointers.delete(e.pointerId);
      if (pointers.size === 0) {
        if (!didDrag && dragStart) {
          const rect = this.canvas.getBoundingClientRect();
          this.handleTap(e.clientX - rect.left, e.clientY - rect.top);
        }
        dragStart = null;
        lastPinchDist = 0;
      } else if (pointers.size === 1) {
        const remaining = [...pointers.values()][0];
        dragStart = { x: remaining.x, y: remaining.y, camX: this.camX, camY: this.camY };
        lastPinchDist = 0;
      }
    };

    this.canvas.addEventListener('pointerdown', onDown);
    this.canvas.addEventListener('pointermove', onMove);
    this.canvas.addEventListener('pointerup', onUp);
    this.canvas.addEventListener('pointercancel', onUp);
    this.pointerHandlers = { onDown, onMove, onUp };

    const onWheel = (e: WheelEvent) => {
      e.preventDefault();
      this.camGlide = null;
      const rect = this.canvas.getBoundingClientRect();
      const mx = e.clientX - rect.left;
      const my = e.clientY - rect.top;
      const wx = this.camX + mx / this.zoom;
      const wy = this.camY + my / this.zoom;
      this.zoom *= e.deltaY > 0 ? 0.9 : 1.1;
      this.clampCamera();
      this.camX = wx - mx / this.zoom;
      this.camY = wy - my / this.zoom;
      this.clampCamera();
    };
    this.canvas.addEventListener('wheel', onWheel, { passive: false });
    this.onWheelHandler = onWheel;
  }

  private handleTap(screenX: number, screenY: number): void {
    const wx = this.camX + screenX / this.zoom;
    const wy = this.camY + screenY / this.zoom;
    // Catch radius in world units, but floored to a finger-sized target on
    // screen. NODE_R * 1.6 is ~9 px at MIN_ZOOM, so zoomed-out spaces become
    // un-tappable without this floor.
    const MIN_TAP_PX = 24;
    const catchR = Math.max(NODE_R * 1.6, MIN_TAP_PX / this.zoom);
    let best: BoardNode | null = null;
    let bestDist = Infinity;
    for (const n of this.map.nodes) {
      if (!this.inActive(n.id) || this.isHiddenEscape(n.id)) continue; // hidden-layer / unclaimed-escape nodes aren't tappable
      const dist = Math.hypot(n.x - wx, n.y - wy);
      if (dist < catchR && dist < bestDist) {
        best = n;
        bestDist = dist;
      }
    }
    const tappedId = best?.id ?? null;
    this.onTapNode(tappedId);
  }

  // ── Lifecycle ──────────────────────────────────────────────────────────────

  start(): void {
    const own = this.players.find((p) => p.userId === this.ownUserId);
    const focus = own?.position ?? this.map.gate;
    // Defer the initial focus to the first animation frame: at start() time
    // (AfterViewInit, mid-change-detection) the canvas can still report stale
    // dimensions, which lands the camera off your creature. By the first frame
    // the tab is laid out, so a fresh resize() + centre puts your own token
    // dead-centre on entry.
    let didInitialFocus = false;
    const loop = (ts: number) => {
      if (!didInitialFocus) {
        this.resize();
        this.centerOn(focus, false);
        didInitialFocus = true;
      }
      this.draw(ts);
      this.rafId = requestAnimationFrame(loop);
    };
    this.rafId = requestAnimationFrame(loop);
  }

  /** Pause the render loop without tearing anything down — the baked terrain,
   *  textures, camera, and input listeners all stay live so `resume()` is
   *  instant. Used when the Board tab is hidden behind another tab so an
   *  off-screen canvas doesn't burn frames/battery. */
  pause(): void {
    if (this.rafId) {
      cancelAnimationFrame(this.rafId);
      this.rafId = null;
    }
  }

  /** Restart the render loop after a `pause()`. The canvas was likely sized 0×0
   *  while hidden, so `start()`'s deferred first-frame resize + recentre-on-own-
   *  token runs again, landing the camera correctly on return. No-op if already
   *  running. */
  resume(): void {
    if (this.rafId != null) return;
    this.start();
  }

  stop(): void {
    if (this.rafId) {
      cancelAnimationFrame(this.rafId);
      this.rafId = null;
    }
    if (this.rebuildTimer !== null) {
      clearTimeout(this.rebuildTimer);
      this.rebuildTimer = null;
    }
    window.removeEventListener('resize', this.boundResize);
    if (this.pointerHandlers) {
      this.canvas.removeEventListener('pointerdown', this.pointerHandlers.onDown);
      this.canvas.removeEventListener('pointermove', this.pointerHandlers.onMove);
      this.canvas.removeEventListener('pointerup', this.pointerHandlers.onUp);
      this.canvas.removeEventListener('pointercancel', this.pointerHandlers.onUp);
    }
    if (this.onWheelHandler) this.canvas.removeEventListener('wheel', this.onWheelHandler);
  }

  // ── Drawing ────────────────────────────────────────────────────────────────

  private draw(ts: number): void {
    const ctx = this.ctx;
    const elapsed = (ts - this.startTime) / 1000;
    const dt = Math.min(0.05, (ts - this.lastTs) / 1000);
    this.lastTs = ts;
    this.checkTerrainIntact(ts);
    this.updateDust(dt);
    this.updateHealFx(dt);

    if (this.camGlide) {
      const g = this.camGlide;
      const t = Math.min(1, (ts - g.start) / g.durationMs);
      const e = easeCam(t);
      this.zoom = g.fromZoom + (g.toZoom - g.fromZoom) * e;
      this.camX = g.fromX + (g.toX - g.fromX) * e;
      this.camY = g.fromY + (g.toY - g.fromY) * e;
      this.clampCamera();
      if (t >= 1) this.camGlide = null;
    }

    // Pure black outside the world so the off-map area matches the canvas edge
    // (notably while spectating, where the whole world sits framed in view).
    // Base transform: 1 logical unit = `dpr` device px, so every downstream
    // draw works in logical coords while filling the device-pixel backing store.
    ctx.setTransform(this.dpr, 0, 0, this.dpr, 0, 0);
    ctx.fillStyle = '#000000';
    ctx.fillRect(0, 0, this.viewW, this.viewH);

    ctx.save();
    ctx.scale(this.zoom, this.zoom);
    ctx.translate(-this.camX, -this.camY);

    // Static world (terrain, paths, landmarks) + its animated glow accents.
    // Blit the active layer's terrain at its world origin.
    const L = this.active;
    // Terrain is baked at L.terrain.resolution (< 1 on the game board to keep
    // the offscreen backing store small); scale the blit back up to world size.
    ctx.drawImage(
      L.terrain.canvas,
      L.spec.bounds.x - TERRAIN_MARGIN,
      L.spec.bounds.y - TERRAIN_MARGIN,
      L.terrain.canvas.width / L.terrain.resolution,
      L.terrain.canvas.height / L.terrain.resolution,
    );
    // Path motifs are lifted out of the soft bake and redrawn crisp here, at
    // full res, culled to the view — so the fine detail survives (the demo was
    // sharp because it was full-res; the baked terrain is TERRAIN_RES soft).
    const motifView = {
      x0: this.camX,
      y0: this.camY,
      x1: this.camX + this.viewW / this.zoom,
      y1: this.camY + this.viewH / this.zoom,
    };
    drawPathMotifs(ctx, L.terrain.pathMotifs, motifView);
    this.drawGlows(elapsed);

    // Soft flora (mushrooms, reeds, bog trees) lifted out of the static bake so
    // they sway with an idle breeze — drawn here so they sit under discs/tokens.
    drawFlora(ctx, L.terrain.flora, elapsed, {
      x0: this.camX,
      y0: this.camY,
      x1: this.camX + this.viewW / this.zoom,
      y1: this.camY + this.viewH / this.zoom,
    });

    // Dungeon darkness: unexplored gloom with light holes at lit nodes.
    if (this.activeLayerId !== OVERWORLD) this.drawGloomVeil();

    for (const n of this.map.nodes) {
      if (!this.inActive(n.id) || !this.isLit(n.id) || this.isHiddenEscape(n.id)) continue;
      this.drawSpace(n, elapsed);
    }

    // Signposts beside tunnel mouths preview where the shortcut leads.
    this.drawSignposts();

    // Player tokens — grouped by logical node, drawn at eased positions so a
    // position change slides the token along instead of teleporting it.
    const byNode = new Map<string, BoardPlayer[]>();
    for (const p of this.players) {
      const list = byNode.get(p.position) ?? [];
      list.push(p);
      byNode.set(p.position, list);
    }
    const present = new Set<string>();
    const placed: { p: BoardPlayer; x: number; y: number; hopY: number; breath: number }[] = [];
    for (const [nodeId, list] of byNode) {
      const n = this.nodeMap.get(nodeId);
      if (!n || !this.inActive(nodeId)) continue;
      // In the dark, other players only appear inside your light.
      const anyOwn = list.some((p) => p.userId === this.ownUserId);
      if (!anyOwn && !this.isLit(nodeId)) continue;
      list.forEach((p, i) => {
        const angle = (i / Math.max(list.length, 1)) * Math.PI * 2 - Math.PI / 2;
        const off = list.length > 1 ? NODE_R * 0.9 : 0;
        const px = n.x + Math.cos(angle) * off;
        const py = n.y - DISC_RY - 6 + Math.sin(angle) * off * 0.5;
        present.add(p.userId);
        const a = this.tokenPos(p.userId, px, py, ts);

        const t = Math.min(1, (ts - a.start) / MOVE_MS);
        const moving = t < 1;
        const spr = formSprite(p.form, p.spriteVariant);
        const targetH = this.tokenHeight(p.userId === this.ownUserId) * spr.scale;
        const footY = a.y + targetH * 0.48;

        let hopY = 0;
        let breath = 1;
        if (moving) {
          // Dino-style hop: full |sin| arcs, one per footfall across the move.
          hopY = -Math.abs(Math.sin(t * Math.PI * HOP_COUNT)) * HOP_HEIGHT;
          // Kick up dust as each mid-move foot lands.
          const idx = Math.floor(t * HOP_COUNT + 1e-6);
          if (idx > a.hopIndex && idx < HOP_COUNT) {
            this.spawnDust(a.x, footY);
            a.hopIndex = idx;
          }
        } else {
          // Just arrived → one last landing puff, then settle into breathing.
          if (a.hopIndex !== 0) {
            this.spawnDust(a.x, footY);
            a.hopIndex = 0;
          }
          breath = 1 + Math.sin(elapsed * BREATH_SPEED + a.phase) * BREATH_AMT;
        }

        // High-five override: converge the two participants, arc them up, squash
        // on the wind-up and stretch at the peak, then settle back apart. Applied
        // as a per-frame render offset (hfDx) so the tokens return home on their
        // own once the animation ends.
        let hfDx = 0;
        const hf = this.highFive;
        if (hf && (p.userId === hf.aId || p.userId === hf.bId)) {
          if (hf.start < 0) hf.start = ts;
          const ht = Math.min(1, (ts - hf.start) / HIGH_FIVE_MS);
          const other = list.find(
            (q) => q.userId === (p.userId === hf.aId ? hf.bId : hf.aId),
          );
          const oa = other ? this.tokenAnims.get(other.userId) : undefined;
          if (oa) {
            const mid = (a.x + oa.x) / 2;
            const dir = a.x <= mid ? 1 : -1; // toward the midpoint
            const gap = NODE_R * 0.35; // near-touching at the clap
            const reach = Math.abs(a.x - mid);
            if (ht < 0.25) {
              const k = ht / 0.25; // ready: lean apart + crouch
              hfDx = -6 * k;
              breath = 1 - 0.15 * k;
            } else if (ht < 0.55) {
              const k = (ht - 0.25) / 0.3; // jump: converge, rise, stretch
              hfDx = (reach - gap) * k;
              hopY += -Math.sin(k * Math.PI) * HOP_HEIGHT * 1.8;
              breath = 1 + 0.18 * Math.sin(k * Math.PI);
            } else {
              const k = (ht - 0.55) / 0.45; // settle: bounce back apart
              hfDx = (reach - gap) * (1 - k);
              hopY += -Math.abs(Math.sin((1 - k) * Math.PI * 0.5)) * HOP_HEIGHT * 0.4;
            }
            hfDx *= dir;
            // Clap: one impact burst + dust at the peak (fired once).
            if (!hf.clapped && ht >= 0.55) {
              hf.clapped = true;
              const cy = a.y - 6;
              for (let s = 0; s < 18; s++) {
                const ttl = 0.5 + Math.random() * 0.4;
                const ang = Math.random() * Math.PI * 2;
                this.sparkles.push({
                  x: mid,
                  y: cy,
                  vx: Math.cos(ang) * (30 + Math.random() * 40),
                  vy: Math.sin(ang) * (30 + Math.random() * 40) - 10,
                  life: ttl,
                  maxLife: ttl,
                  size: 1.8 + Math.random() * 2.2,
                  color: '#ffe27a',
                  glow: '#f2a900',
                });
              }
              this.spawnDust(mid, footY);
            }
          }
          if (ht >= 1) this.highFive = null;
        }
        placed.push({ p, x: a.x + hfDx, y: a.y, hopY, breath });
      });
    }
    // Dust settles under the tokens; the gate-heal sparkle rides just above it.
    this.drawDust();
    this.drawSparkles();
    // Painter's algorithm: lower tokens draw over higher ones; labels last so
    // no sprite occludes a name.
    placed.sort((a, b) => a.y - b.y);
    // Active companion trails its owner. Fold it into the painter's order by its
    // foot (bottom-pixel) y so it draws behind tokens whose feet are lower on the
    // board and in front of those whose feet are higher — matching the depth cue
    // the tokens use among themselves.
    const petDraw = this.updatePet(ts, elapsed, placed);
    const drawables: { footY: number; draw: () => void }[] = placed.map((t) => {
      // t.y is the token's anchor; its planted feet sit targetH/2 below that,
      // less the frame's bottom inset — this is the true contact point.
      const spr = formSprite(t.p.form, t.p.spriteVariant);
      const targetH = this.tokenHeight(t.p.userId === this.ownUserId, t.p.tier) * spr.scale;
      const footY = t.y + targetH / 2 - SPRITE_FOOT_INSET * targetH;
      return { footY, draw: () => this.drawToken(t.p, t.x, t.y, t.hopY, t.breath) };
    });
    if (petDraw) drawables.push(petDraw);
    drawables.sort((a, b) => a.footY - b.footY);
    for (const d of drawables) d.draw();
    for (const t of placed) this.drawLabel(t.p, t.x, t.y);
    // Pop any queued heal numbers at their token's current position.
    if (this.pendingHealPops.length) {
      for (const t of placed) {
        const idx = this.pendingHealPops.findIndex((h) => h.userId === t.p.userId);
        if (idx < 0) continue;
        const targetH =
          this.tokenHeight(t.p.userId === this.ownUserId) * formSprite(t.p.form, t.p.spriteVariant).scale;
        this.spawnHealNumber(t.x, t.y - targetH + t.hopY, this.pendingHealPops[idx].amount);
        this.pendingHealPops.splice(idx, 1);
      }
    }
    // Spell FX: resolve queued casts/hits now that this frame's tokens are placed
    // (positions live in tokenAnims, before the absent-token sweep below).
    if (this.pendingCast.length) {
      for (const fx of this.pendingCast) this.spawnCastFx(fx);
      this.pendingCast = [];
    }
    if (this.pendingHit.length) {
      for (const fx of this.pendingHit) this.spawnHitFx(fx);
      this.pendingHit = [];
    }
    // 🎲 badge over anyone seated at an active board-game table.
    if (this.diceMarkers.size) {
      for (const t of placed) {
        if (!this.diceMarkers.has(t.p.userId)) continue;
        const targetH =
          this.tokenHeight(t.p.userId === this.ownUserId) * formSprite(t.p.form, t.p.spriteVariant).scale;
        this.drawDiceBadge(t.x, t.y - targetH + t.hopY, ts);
      }
    }
    // Hand-placed over-layer decals cover tokens (foreground dressing).
    drawDecals(ctx, this.map, 'over', this.active.spec);
    // Steps-left die floats above your head (Mario Party style), above tokens.
    const ownT = placed.find((t) => t.p.userId === this.ownUserId);
    if (this.stepDie !== null && ownT) {
      const targetH = 72 * formSprite(ownT.p.form, ownT.p.spriteVariant).scale;
      this.drawStepDie(ownT.x, ownT.y - targetH / 2 + ownT.hopY, this.stepDie, ts);
    }
    for (const id of [...this.tokenAnims.keys()]) {
      if (!present.has(id)) this.tokenAnims.delete(id);
    }

    // Drifting spores + bat flights over everything but the info popover.
    this.ambient.drawAtmosphere(ctx, ts, {
      x0: this.camX,
      y0: this.camY,
      x1: this.camX + this.viewW / this.zoom,
      y1: this.camY + this.viewH / this.zoom,
    });

    this.drawBolts();
    this.drawHealNumbers();

    if (this.umori) this.drawUmori(ts);
    this.drawEnraged(ts);

    this.drawInfo();

    ctx.restore();

    // Screen-space vignette over the whole scene (transform is the dpr base).
    this.drawVignette();
  }

  /** True when a node belongs to the layer currently on screen. */
  private inActive(nodeId: string): boolean {
    return (this.layerOf.get(nodeId) ?? OVERWORLD) === this.activeLayerId;
  }

  private veil: HTMLCanvasElement | null = null;

  /**
   * Unexplored gloom over a dungeon: a dark wash with soft light holes at lit
   * nodes. Composited on a scratch canvas (in screen space) so cutting the
   * holes erases only the veil — never the terrain underneath — then blitted
   * over the frame at identity transform.
   */
  private drawGloomVeil(): void {
    if (!this.veil) this.veil = document.createElement('canvas');
    const v = this.veil;
    const dw = Math.round(this.viewW * this.dpr);
    const dh = Math.round(this.viewH * this.dpr);
    if (v.width !== dw || v.height !== dh) {
      v.width = dw;
      v.height = dh;
    }
    const vc = v.getContext('2d')!;
    // Draw the veil in logical coords (the blit below is device-pixel 1:1).
    vc.setTransform(this.dpr, 0, 0, this.dpr, 0, 0);
    vc.clearRect(0, 0, this.viewW, this.viewH);
    vc.fillStyle = 'rgba(4, 3, 6, 0.82)';
    vc.fillRect(0, 0, this.viewW, this.viewH);
    vc.globalCompositeOperation = 'destination-out';
    for (const n of this.map.nodes) {
      if (!this.inActive(n.id) || !this.isLit(n.id) || this.isHiddenEscape(n.id)) continue;
      const own = n.id === this.ownPosition;
      const r = (own ? 230 : 150) * this.zoom;
      const sx = (n.x - this.camX) * this.zoom;
      const sy = (n.y - this.camY) * this.zoom;
      if (sx < -r || sx > this.viewW + r || sy < -r || sy > this.viewH + r) continue;
      const g = vc.createRadialGradient(sx, sy, 0, sx, sy, r);
      g.addColorStop(0, 'rgba(0,0,0,1)');
      g.addColorStop(0.6, 'rgba(0,0,0,0.85)');
      g.addColorStop(1, 'rgba(0,0,0,0)');
      vc.fillStyle = g;
      vc.fillRect(sx - r, sy - r, r * 2, r * 2);
    }
    vc.globalCompositeOperation = 'source-over';
    const ctx = this.ctx;
    ctx.save();
    ctx.setTransform(1, 0, 0, 1, 0, 0);
    ctx.drawImage(v, 0, 0);
    ctx.restore();
  }

  /** Soft screen-space vignette so the cave darkens away from the action.
   *  Gradient is cached per viewport size — one fillRect per frame. */
  private vignetteCache: { grad: CanvasGradient; w: number; h: number } | null = null;
  private drawVignette(): void {
    const ctx = this.ctx;
    if (
      !this.vignetteCache ||
      this.vignetteCache.w !== this.viewW ||
      this.vignetteCache.h !== this.viewH
    ) {
      const cx = this.viewW / 2;
      const cy = this.viewH / 2;
      const g = ctx.createRadialGradient(cx, cy, Math.min(cx, cy) * 0.9, cx, cy, Math.hypot(cx, cy) * 1.05);
      g.addColorStop(0, 'rgba(4, 3, 6, 0)');
      g.addColorStop(1, 'rgba(4, 3, 6, 0.32)');
      this.vignetteCache = { grad: g, w: this.viewW, h: this.viewH };
    }
    ctx.fillStyle = this.vignetteCache.grad;
    ctx.fillRect(0, 0, this.viewW, this.viewH);
  }

  /** Pulsing radial glows over the terrain's registered spots (river, flora, portals). */
  private drawGlows(elapsed: number): void {
    const ctx = this.ctx;
    const vx0 = this.camX - 60;
    const vy0 = this.camY - 60;
    const vx1 = this.camX + this.viewW / this.zoom + 60;
    const vy1 = this.camY + this.viewH / this.zoom + 60;
    for (const s of this.active.terrain.glowSpots) {
      if (s.x < vx0 || s.x > vx1 || s.y < vy0 || s.y > vy1) continue;
      const a = 0.05 + 0.05 * (1 + Math.sin(elapsed * 1.6 + s.phase)) * 0.5;
      const g = ctx.createRadialGradient(s.x, s.y, 0, s.x, s.y, s.r);
      g.addColorStop(0, `rgba(${s.color}, ${a})`);
      g.addColorStop(1, 'rgba(0,0,0,0)');
      ctx.fillStyle = g;
      ctx.fillRect(s.x - s.r, s.y - s.r, s.r * 2, s.r * 2);
    }
  }

  /** One board space as a 3D "coin disc": side wall, lit top face, glyph, tells. */
  private drawSpace(n: BoardNode, elapsed: number): void {
    const ctx = this.ctx;
    const isChoice = this.choices.has(n.id);
    const isBack = n.id === this.backChoice;
    ctx.save();
    if (isChoice || isBack) {
      // Forward steps pulse gold; the space behind you pulses cool blue.
      const pulse = 0.55 + 0.35 * Math.sin(elapsed * 5);
      const rgb = isBack ? '110, 190, 250' : '250, 220, 90';
      ctx.beginPath();
      ctx.ellipse(n.x, n.y, NODE_R + 10, DISC_RY + 8, 0, 0, Math.PI * 2);
      ctx.fillStyle = `rgba(${rgb}, ${pulse * 0.35})`;
      ctx.fill();
      ctx.strokeStyle = `rgba(${rgb}, ${pulse})`;
      ctx.lineWidth = 3;
      ctx.stroke();
    }

    // The coin itself is shared with the map editor (board-space.ts). Spaces
    // sealed behind an unbroken barrier render grey so it's clear they can't
    // be visited yet — a colour change, not a dimming veil.
    const sealed = n.type === 'barrier' && !this.barriersOpen.has(n.id);
    // A live raid boss claims its footprint: corrupt those tiles' colour + glyph.
    const bossHere = !!this.worldEvent && this.worldEvent.nodes.includes(n.id);
    // Ashen Fog: unrevealed tiles get a swirling ashen aura + the foggy disc;
    // once the first lander reveals it, the tile wears the revealed type's disc.
    const fogReveal = n.type === 'fog' ? this.fogReveals[n.id] : undefined;
    if (n.type === 'fog' && !fogReveal) {
      const pulse = 0.4 + 0.3 * Math.sin(elapsed * 2.2 + n.x * 0.03);
      ctx.beginPath();
      ctx.ellipse(n.x, n.y, NODE_R + 8, DISC_RY + 6, 0, 0, Math.PI * 2);
      ctx.fillStyle = `rgba(150, 150, 165, ${0.12 + pulse * 0.14})`;
      ctx.fill();
    }
    const discNode = fogReveal ? { ...n, type: fogReveal } : n;
    // Depths hazard tiles hide the generic warning glyph — the dungeon boss's
    // silhouette (drawn below) is their emblem instead.
    const dungeonHazard = n.type === 'hazard' && n.region === 'depths';
    // A roaming enraged monster squatting here stamps a paw print over the tile
    // (its live sprite + HP bar draw above it in drawEnraged).
    const monsterHere = this.enraged?.node === n.id;
    // Umori the wandering post overlays whatever tile it squats on with the
    // trading-post glyph (its live sprite draws above it in drawUmori). A live
    // raid boss or roaming monster on the same tile wins its own emblem.
    const umoriHere = !bossHere && !monsterHere && this.umori?.node === n.id;
    drawSpaceDisc(ctx, discNode, {
      sealed,
      locked: this.lockedIds.has(n.id),
      corrupted: bossHere,
      hideGlyph: dungeonHazard,
      glyph: monsterHere ? MONSTER_SPACE.icon : umoriHere ? SPACE_ICONS['trading_post'] : undefined,
    });

    // A sealed barrier is held by the area's guardian creature, standing across
    // the route; it's drawn no more the moment someone breaks the barrier.
    if (sealed) this.drawGuardian(n, elapsed);

    // Sigil bosses pace behind their lair spaces.
    if (n.type === 'lair') this.drawLairBoss(n, elapsed);

    // A depths hazard wears the shadow of its dungeon's sigil boss.
    if (dungeonHazard) this.drawHazardOmen(n, elapsed);

    // Treasure tiles wear the hoard sprite, swapping to a plundered variant once
    // their season-global first conqueror has cracked them open.
    if (n.type === 'trove' || n.type === 'cache' || n.type === 'vault' || fogReveal === 'cache') {
      this.drawTreasureHoard(n);
    }

    // First-conqueror name-plates: lairs show at their dungeon LADDER (the den
    // entrance); Savra at the boss node; treasure at the tile itself.
    if (n.type === 'ladder') {
      const lair = this.firsts[`${n.id.split('_')[0]}_lair`];
      if (lair) this.drawNamePlate(n.x, n.y + 8, `First cleared by ${lair.by}`);
    } else if (n.type === 'boss') {
      const b = this.firsts[n.id];
      if (b) this.drawNamePlate(n.x, n.y + 8, `First to fell the Queen: ${b.by}`);
    } else if (
      this.firsts[n.id] &&
      (n.type === 'trove' || n.type === 'cache' || n.type === 'vault')
    ) {
      this.drawNamePlate(n.x, n.y + 8, `Plundered by ${this.firsts[n.id].by}`);
    }

    // The wilderness World Event beast squats across its 3-node footprint.
    if (this.worldEvent && this.worldEvent.nodes.includes(n.id)) {
      this.drawWorldEventTile(n, elapsed);
    }

    // A rusty ladder whose dungeon boss has already fallen wears a small skull
    // badge — the den below holds nothing now but the boss's vestige.
    if (n.type === 'ladder' && this.clearedDungeons.has(n.id.split('_')[0])) {
      this.drawVestigeBadge(n, elapsed);
    }

    // Disturbed ground — the only tell that a snare lurks here.
    if (this.snares.has(n.id)) {
      ctx.beginPath();
      ctx.setLineDash([3, 5]);
      ctx.ellipse(n.x, n.y, NODE_R + 5, DISC_RY + 4, 0, 0, Math.PI * 2);
      ctx.strokeStyle = 'rgba(160, 120, 70, 0.7)';
      ctx.lineWidth = 2;
      ctx.stroke();
      ctx.setLineDash([]);
    }

    // Enemy spaces wear a small T1/T2/T3 label grading how tough a foe spawns
    // here (mirrors the server enemy-pool ladder — see board-enemy-tier.ts).
    // Only once you've zoomed in past halfway (~50% of MAX_ZOOM) — zoomed out,
    // the tiny letters just clutter the coins.
    const tier = this.enemyTiers.get(n.id);
    if (tier && this.zoom >= TIER_LABEL_MIN_ZOOM && !sealed && !this.lockedIds.has(n.id)) {
      drawTierBadge(ctx, n, tier, this.zoom);
    }

    // Dig sites + gemstone walls wear a ring that fills toward completion, so you
    // can spot the nearly-worked-out ones before spending a landing (see
    // board-progress-ring.ts). Shown at any zoom — the arc reads even small.
    const progress = this.nodeProgress.get(n.id);
    if (progress !== undefined && !this.lockedIds.has(n.id)) {
      drawProgressRing(ctx, n, progress);
    }

    ctx.restore();
  }

  /** Planted signposts beside overworld tunnel mouths, previewing the
   *  destination region's backdrop + name (shared with the map editor via
   *  board-signpost). Overworld only — tunnels are surface. */
  private drawSignposts(): void {
    if (this.activeLayerId !== OVERWORLD) return;
    for (const n of this.map.nodes) {
      if (n.type !== 'tunnel' || !this.inActive(n.id) || !this.isLit(n.id)) continue;
      drawTunnelSignpost(this.ctx, n, this.map.nodes, this.floorTex);
    }
  }

  /** Treasure set-piece for trove/cache/vault; plundered variant once claimed. */
  private drawTreasureHoard(n: BoardNode): void {
    const img = this.firsts[n.id] ? this.treasurePlunderedTex : this.treasureTex;
    if (!img) return;
    const ctx = this.ctx;
    const h = 46; // world px
    const w = (img.width / img.height) * h;
    ctx.drawImage(img, n.x - w / 2, n.y - h + DISC_RY * 0.3, w, h);
  }

  /** A gilded name banner planted below a landmark, styled like the token name
   *  pill (see drawLabel) so the board reads as one system. */
  private drawNamePlate(x: number, y: number, text: string): void {
    const ctx = this.ctx;
    ctx.save();
    ctx.font = 'bold 12px sans-serif';
    ctx.textAlign = 'center';
    ctx.textBaseline = 'top';
    const w = ctx.measureText(text).width + 14;
    ctx.beginPath();
    ctx.roundRect(x - w / 2, y, w, 18, 5);
    ctx.fillStyle = 'rgba(12, 10, 8, 0.82)';
    ctx.fill();
    ctx.strokeStyle = 'rgba(251, 191, 36, 0.8)';
    ctx.lineWidth = 1.5;
    ctx.stroke();
    ctx.fillStyle = '#fbbf24';
    ctx.fillText(text, x, y + 4);
    ctx.restore();
  }

  /**
   * The area's guardian creature planted on a sealed barrier, hopping "ever so
   * slightly" in place so it reads as actively barring the route. Uses real
   * transparent art (undercity/guardians/<id>.png) once present; a preloaded
   * token sprite stands in until then. A faint menacing pulse rings its feet.
   */
  private drawGuardian(n: BoardNode, elapsed: number): void {
    const ctx = this.ctx;
    const guardianId = BARRIER_GUARDIANS[n.id] ?? DEFAULT_GUARDIAN;
    const art = this.guardianArt(guardianId);

    // Desync each barrier so multiple guardians don't bob in lockstep.
    const phase = ((hashStr(n.id) % 1000) / 1000) * Math.PI * 2;
    const hop = Math.abs(Math.sin(elapsed * GUARDIAN_HOP_SPEED + phase));
    const hopY = -hop * GUARDIAN_HOP_HEIGHT;
    const breath = 1 + Math.sin(elapsed * BREATH_SPEED + phase) * BREATH_AMT;
    const sway = Math.sin(elapsed * GUARDIAN_HOP_SPEED * 0.5 + phase) * GUARDIAN_SWAY;

    const cx = n.x + sway;
    const footAnchor = n.y + 8; // planted on the coin's near edge

    ctx.save();

    // Ground shadow at the planted feet, shrinking a touch at the hop's peak.
    const shadowShrink = 1 - Math.min(0.3, hop / 3);
    ctx.beginPath();
    ctx.ellipse(cx, footAnchor, GUARDIAN_H * 0.4 * shadowShrink, GUARDIAN_H * 0.16 * shadowShrink, 0, 0, Math.PI * 2);
    ctx.fillStyle = 'rgba(0,0,0,0.4)';
    ctx.fill();

    // Slow warning pulse so the seal still reads as "deal with me".
    const pulse = 0.25 + 0.15 * Math.sin(elapsed * 2.2);
    ctx.beginPath();
    ctx.ellipse(n.x, footAnchor, 44, 22, 0, 0, Math.PI * 2);
    ctx.strokeStyle = `rgba(230, 120, 80, ${pulse})`;
    ctx.lineWidth = 3;
    ctx.stroke();

    if (art) {
      const drawH = GUARDIAN_H * breath;
      const w = art.img.width * (GUARDIAN_H / art.img.height);
      const top = footAnchor - drawH + hopY;
      ctx.imageSmoothingEnabled = !art.pixelArt;
      ctx.drawImage(art.img, cx - w / 2, top, w, drawH);
      ctx.imageSmoothingEnabled = true;
    }

    // Boss-style health bar above its head so its remaining HP reads at a glance.
    const pool = this.guardianPools[n.id];
    if (pool) {
      const headTop = footAnchor - GUARDIAN_H * breath + hopY;
      this.drawGuardianHp(cx, headTop - 5, pool.hp, pool.maxHp, 42);
    }

    ctx.restore();
  }

  /**
   * A compact health bar centred at `cx` with its base at `bottomY`, mirroring
   * the battle screen's green/amber/red thresholds so a guardian's remaining HP
   * reads the same on the overworld as it does mid-fight.
   */
  private drawGuardianHp(
    cx: number,
    bottomY: number,
    hp: number,
    maxHp: number,
    width: number,
  ): void {
    if (maxHp <= 0) return;
    const ctx = this.ctx;
    const frac = Math.max(0, Math.min(1, hp / maxHp));
    const h = 6;
    const x = cx - width / 2;
    const y = bottomY - h;

    ctx.save();
    // Track
    ctx.beginPath();
    ctx.roundRect(x, y, width, h, 3);
    ctx.fillStyle = 'rgba(0, 0, 0, 0.55)';
    ctx.fill();
    ctx.strokeStyle = 'rgba(255, 255, 255, 0.12)';
    ctx.lineWidth = 1;
    ctx.stroke();

    // Fill — same palette as interactive-battle's HP plate.
    const fw = (width - 2) * frac;
    if (fw > 0.5) {
      const [c0, c1] =
        frac <= 0.25
          ? ['#a34040', '#d86060']
          : frac <= 0.5
            ? ['#b9903a', '#e0b34e']
            : ['#6cae75', '#99d98c'];
      const grad = ctx.createLinearGradient(x + 1, 0, x + 1 + fw, 0);
      grad.addColorStop(0, c0);
      grad.addColorStop(1, c1);
      ctx.beginPath();
      ctx.roundRect(x + 1, y + 1, fw, h - 2, 2);
      ctx.fillStyle = grad;
      ctx.fill();
    }
    ctx.restore();
  }

  /**
   * The sigil boss lurking behind its lair space: a slow, deep breathing idle
   * with an occasional forward lunge, drawn north of the coin so the lair
   * building reads as standing in front of it. Reuses the barrier guardian's
   * lazy art loader (undercity/guardians/<id>.png; placeholder sprite until).
   */
  private drawLairBoss(n: BoardNode, elapsed: number): void {
    // Concealed until the region is breached: don't reveal which monster resides
    // in a lair whose region is still sealed behind unbroken barrier guardians.
    if (this.isConcealedLair(n)) return;
    const ctx = this.ctx;
    const bossId = LAIR_GUARDIANS[n.id] ?? DEFAULT_GUARDIAN;
    const art = this.guardianArt(bossId);
    if (!art) return;

    const phase = ((hashStr(n.id) % 1000) / 1000) * Math.PI * 2;
    const breath = 1 + Math.sin(elapsed * LAIR_BREATH_SPEED + phase) * LAIR_BREATH_AMT;
    // A lunge every ~LAIR_LUNGE_PERIOD s: a brief forward dip, else it settles.
    const t = (elapsed + phase) % LAIR_LUNGE_PERIOD;
    const lunge = t < 0.6 ? Math.sin((t / 0.6) * Math.PI) * LAIR_LUNGE_AMT : 0;

    const cx = n.x;
    const footAnchor = n.y - LAIR_BACK_OFFSET + lunge; // behind the space, dips on lunge

    // Beaten boss (its sigil is claimed) → render the weakened vestige.
    const vestige = n.id.endsWith('_lair') && this.clearedDungeons.has(n.id.split('_')[0]);
    // A ruin lair this player has cleared sits abandoned (respawn timer live).
    const abandoned = this.abandonedLairs.has(n.id);

    ctx.save();
    if (vestige) {
      ctx.filter = VESTIGE_FILTER;
      ctx.globalAlpha = VESTIGE_ALPHA;
    } else if (abandoned) {
      ctx.globalAlpha = 0.35;
    }
    const drawH = LAIR_H * breath;
    const w = art.img.width * (LAIR_H / art.img.height);
    const top = footAnchor - drawH;
    ctx.imageSmoothingEnabled = !art.pixelArt;
    ctx.drawImage(art.img, cx - w / 2, top, w, drawH);
    ctx.imageSmoothingEnabled = true;

    // Boss-style health bar above the living sigil boss (a beaten vestige has
    // no fight left in it, so it wears none).
    const pool = this.guardianPools[n.id];
    if (pool && !vestige) {
      this.drawGuardianHp(cx, top - 6, pool.hp, pool.maxHp, 56);
    }
    ctx.restore();
  }

  /**
   * A depths hazard tile's emblem: the flattened shadow of that dungeon's sigil
   * boss, centered on the coin so its hazards read as the lair's own cursed turf
   * (and distinct from surface hazards). Reuses the lazy guardian art loader
   * (undercity/guardians/<id>.png; placeholder sprite until it arrives) and adds
   * a faint bob so the omen feels alive rather than stamped on.
   */
  private drawHazardOmen(n: BoardNode, elapsed: number): void {
    const bossId = LAIR_GUARDIANS[`${n.id.split('_')[0]}_lair`];
    if (!bossId) return;
    const art = this.guardianArt(bossId);
    if (!art) return;
    const ctx = this.ctx;
    const phase = ((hashStr(n.id) % 1000) / 1000) * Math.PI * 2;
    const bob = Math.sin(elapsed * 1.8 + phase) * 1.5;
    const h = HAZARD_OMEN_H;
    const w = art.img.width * (h / art.img.height);
    ctx.save();
    ctx.globalAlpha = HAZARD_OMEN_ALPHA;
    ctx.filter = HAZARD_OMEN_FILTER;
    ctx.imageSmoothingEnabled = !art.pixelArt;
    ctx.drawImage(art.img, n.x - w / 2, n.y - h / 2 + bob, w, h);
    ctx.restore();
  }

  /**
   * The wilderness World Event beast. Every occupied tile gets a pulsing red
   * highlight ring so players see where to land; the center tile also draws the
   * big beast sprite (straddling the run) with a shared HP bar above it.
   */
  private drawWorldEventTile(n: BoardNode, elapsed: number): void {
    const ctx = this.ctx;
    const we = this.worldEvent!;

    // Pulsing highlight ring on each of the 3 occupied tiles.
    const pulse = 0.5 + 0.3 * Math.sin(elapsed * 3);
    ctx.save();
    ctx.beginPath();
    ctx.ellipse(n.x, n.y, NODE_R + 8, DISC_RY + 6, 0, 0, Math.PI * 2);
    ctx.strokeStyle = `rgba(198, 47, 63, ${pulse})`;
    ctx.lineWidth = 3;
    ctx.stroke();
    ctx.restore();

    // Flank tiles carry a body hump aligned along the run toward the head.
    if (n.id !== we.center) {
      this.drawWorldEventPiece(n, elapsed);
      return;
    }

    // The beast itself, centered on the middle tile and drawn on top.
    const art = this.worldEventTex;
    const breath = 1 + Math.sin(elapsed * 1.4) * 0.03;
    const footAnchor = n.y + 6;
    ctx.save();
    // Ground shadow under the whole footprint.
    ctx.beginPath();
    ctx.ellipse(n.x, footAnchor, 92, 26, 0, 0, Math.PI * 2);
    ctx.fillStyle = 'rgba(0,0,0,0.38)';
    ctx.fill();
    if (art) {
      const drawH = WORLD_EVENT_H * breath;
      const w = art.width * (drawH / art.height);
      ctx.drawImage(art, n.x - w / 2, footAnchor - drawH, w, drawH);
    }
    // Shared HP bar above the beast.
    this.drawGuardianHp(n.x, footAnchor - WORLD_EVENT_H * breath - 4, we.hp, we.maxHp, 72);
    ctx.restore();
  }

  /**
   * A serpent-body hump on one flank tile of the World Event footprint. The
   * beast's head+neck sits on the center tile; each hump is planted upright on
   * its own tile and rotated along the flank→center line so the tapered end
   * points toward the head — the run reads as one long body arcing across the
   * three spaces. The tilt is clamped so a near-vertical run never lays the
   * hump flat, and a horizontal flip keeps it upright regardless of side.
   */
  private drawWorldEventPiece(n: BoardNode, elapsed: number): void {
    const art = this.worldEventPieceTex;
    if (!art) return;
    const c = this.nodeMap.get(this.worldEvent!.center);
    if (!c) return;

    const dx = c.x - n.x;
    const dy = c.y - n.y;
    // Mirror so the thick/forward end faces the head; tilt along the body slope.
    const flipX = dx > 0;
    const tilt = Math.max(
      -WORLD_EVENT_PIECE_TILT_MAX,
      Math.min(WORLD_EVENT_PIECE_TILT_MAX, Math.atan2(-dy, Math.abs(dx))),
    );

    const breath = 1 + Math.sin(elapsed * 1.4 + 1.1) * 0.03;
    const footAnchor = n.y + 6;
    const drawH = WORLD_EVENT_PIECE_H * breath;
    const w = art.width * (drawH / art.height);

    const ctx = this.ctx;
    ctx.save();
    // Ground shadow stays flat on the tile (drawn before the body transform).
    ctx.beginPath();
    ctx.ellipse(n.x, footAnchor, w * 0.42, 18, 0, 0, Math.PI * 2);
    ctx.fillStyle = 'rgba(0,0,0,0.34)';
    ctx.fill();
    ctx.translate(n.x, footAnchor);
    ctx.scale(flipX ? -1 : 1, 1);
    ctx.rotate(tilt);
    ctx.drawImage(art, -w / 2, -drawH, w, drawH);
    ctx.restore();
  }

  /**
   * A small skull badge pinned to the top-right of a ladder coin once its
   * dungeon boss is dead: the passage still leads down, but only the boss's
   * vestige lingers below. A faint ghostly halo pulses so it reads as spent.
   */
  private drawVestigeBadge(n: BoardNode, elapsed: number): void {
    const ctx = this.ctx;
    const bx = n.x + NODE_R * 0.72;
    const by = n.y - DISC_RY - 2;
    const pulse = 0.5 + 0.5 * Math.sin(elapsed * 2.4 + hashStr(n.id));

    ctx.save();
    // Ghostly halo behind the badge.
    const halo = ctx.createRadialGradient(bx, by, 0, bx, by, 13);
    halo.addColorStop(0, `rgba(150, 190, 175, ${0.28 + 0.18 * pulse})`);
    halo.addColorStop(1, 'rgba(150, 190, 175, 0)');
    ctx.fillStyle = halo;
    ctx.fillRect(bx - 13, by - 13, 26, 26);

    // Dark disc badge so the pale skull reads on any floor.
    ctx.beginPath();
    ctx.arc(bx, by, 8.5, 0, Math.PI * 2);
    ctx.fillStyle = 'rgba(18, 22, 20, 0.82)';
    ctx.fill();
    ctx.lineWidth = 1.2;
    ctx.strokeStyle = `rgba(170, 205, 190, ${0.55 + 0.3 * pulse})`;
    ctx.stroke();

    // The existing bone skull, shrunk to fit the badge and slightly ghosted.
    ctx.translate(bx, by + 1);
    ctx.scale(0.62, 0.62);
    ctx.globalAlpha = 0.9;
    drawSkull(ctx, 0, 0);
    ctx.restore();
  }

  /**
   * Guardian art for the barrier: real transparent PNG if it has loaded, else
   * a preloaded placeholder token sprite (pixel art). Kicks off the lazy load
   * on first request. Returns null only until the placeholder sprite resolves.
   */
  private guardianArt(guardianId: string): { img: CanvasImageSource & { width: number; height: number }; pixelArt: boolean } | null {
    const real = this.guardianTex.get(guardianId);
    if (real) return { img: real, pixelArt: false };
    this.loadGuardian(guardianId);
    const key = GUARDIAN_PLACEHOLDER_SPRITE[guardianId] ?? DEFAULT_GUARDIAN_SPRITE;
    const ph = getRawImage(key);
    return ph ? { img: ph, pixelArt: true } : null;
  }

  /** Umori the wandering ooze, hopping above its current wilderness node with a
   * move-countdown over its head. Drawn on the live layer (the static terrain
   * prerender can't animate or re-place it every 2h). */
  private drawUmori(ts: number): void {
    if (!this.umori) return;
    const n = this.nodeMap.get(this.umori.node);
    if (!n || !this.inActive(n.id)) return;
    const ctx = this.ctx;
    const elapsed = (ts - this.startTime) / 1000;
    const hop = Math.abs(Math.sin(elapsed * 3)) * HOP_HEIGHT; // lively bob
    const cx = n.x;
    const footAnchor = n.y - 6; // sit just above the space coin

    const img = this.umoriSprite();
    if (img) {
      const h = 52;
      const w = img.width * (h / img.height);
      ctx.imageSmoothingEnabled = true;
      ctx.drawImage(img, cx - w / 2, footAnchor - h - hop, w, h);
    }

    // Countdown label above Umori's head (recomputed each frame — always honest).
    const label = this.umoriCountdown();
    ctx.save();
    ctx.font = 'bold 11px sans-serif';
    ctx.textAlign = 'center';
    ctx.textBaseline = 'alphabetic';
    const tw = ctx.measureText(label).width;
    const ty = footAnchor - 64 - hop;
    ctx.fillStyle = 'rgba(20,14,28,0.82)';
    ctx.beginPath();
    ctx.roundRect(cx - tw / 2 - 6, ty - 11, tw + 12, 16, 6);
    ctx.fill();
    ctx.fillStyle = '#f4e6c0';
    ctx.fillText(label, cx, ty + 1);
    ctx.restore();
  }

  /** Remaining time until Umori hops, formatted like the bazaar restock label. */
  private umoriCountdown(): string {
    if (!this.umori) return '';
    const ms = new Date(this.umori.movesAt + 'Z').getTime() - Date.now();
    const min = Math.max(0, Math.ceil(ms / 60_000));
    return min >= 60 ? `${Math.floor(min / 60)}h ${min % 60}m` : `${min}m`;
  }

  /** The wilderness enraged monster: its sprite hopping above its node with an
   *  HP bar and a relocate-countdown over its head. Drawn on the live layer (the
   *  static terrain prerender can't animate or re-place it each window). */
  private drawEnraged(ts: number): void {
    const er = this.enraged;
    if (!er || !er.node) return;
    const n = this.nodeMap.get(er.node);
    if (!n || !this.inActive(n.id)) return;
    const ctx = this.ctx;
    const elapsed = (ts - this.startTime) / 1000;
    // Skitter: horizontal drift, a bob at twice the rate, and a facing flip that
    // turns at each end (velocity ~0 there, so the turn reads naturally).
    const scuttle = Math.sin(elapsed * SCUTTLE_SPEED);
    const cx = n.x + scuttle * SCUTTLE_AMT;
    const hop = Math.abs(Math.sin(elapsed * SCUTTLE_SPEED * 2)) * SCUTTLE_BOB;
    const facing = Math.cos(elapsed * SCUTTLE_SPEED) >= 0 ? 1 : -1;
    const cy = n.y - 6;

    // Warning pulse ring so it reads as "deal with me" on the overworld. Stays
    // pinned to the tile centre while the sprite skitters over it.
    const pulse = 0.3 + 0.2 * Math.sin(elapsed * 2.4);
    ctx.save();
    ctx.beginPath();
    ctx.ellipse(n.x, n.y + 4, 40, 20, 0, 0, Math.PI * 2);
    ctx.strokeStyle = `rgba(230, 90, 70, ${pulse})`;
    ctx.lineWidth = 3;
    ctx.stroke();
    ctx.restore();

    const art = this.enemyArt(er.spriteId ?? '');
    if (art) {
      const h = 58;
      const w = art.width * (h / art.height);
      ctx.save();
      ctx.translate(cx, cy - hop);
      ctx.scale(facing, 1); // face the way it's scuttling
      // Slight red outline so the roaming threat stays legible over any terrain.
      // A zero-offset red shadow is a cheap silhouette halo — no offscreen canvas.
      ctx.shadowColor = 'rgba(224, 66, 52, 0.95)';
      ctx.shadowBlur = 5;
      ctx.drawImage(art, -w / 2, -h, w, h);
      ctx.restore();
    }

    // HP bar (same palette as the interactive battle / guardians). Pinned to the
    // tile centre so it stays steady while the sprite skitters beneath it.
    if (typeof er.hp === 'number' && typeof er.maxHp === 'number') {
      this.drawGuardianHp(n.x, cy - 58 - SCUTTLE_BOB - 4, er.hp, er.maxHp, 44);
    }

    // Relocate-countdown label above its head.
    const label = this.enragedCountdown();
    ctx.save();
    ctx.font = 'bold 11px sans-serif';
    ctx.textAlign = 'center';
    ctx.textBaseline = 'alphabetic';
    const tw = ctx.measureText(label).width;
    const ty = cy - 74 - SCUTTLE_BOB;
    ctx.fillStyle = 'rgba(28,12,12,0.82)';
    ctx.beginPath();
    ctx.roundRect(n.x - tw / 2 - 6, ty - 11, tw + 12, 16, 6);
    ctx.fill();
    ctx.fillStyle = '#ffd9c2';
    ctx.fillText(label, n.x, ty + 1);
    ctx.restore();
  }

  /** Remaining time until the monster relocates, formatted like Umori's clock. */
  private enragedCountdown(): string {
    if (!this.enraged) return '';
    const ms = new Date(this.enraged.movesAt + 'Z').getTime() - Date.now();
    const min = Math.max(0, Math.ceil(ms / 60_000));
    return min >= 60 ? `${Math.floor(min / 60)}h ${min % 60}m` : `${min}m`;
  }

  /** Lazily fetch Umori's sprite (the collector ooze, shopkeeper3). */
  private umoriSprite(): HTMLImageElement | null {
    if (this.umoriImg) return this.umoriImg;
    if (!this.umoriLoading) {
      this.umoriLoading = true;
      const img = new Image();
      img.onload = () => {
        this.umoriImg = img;
      };
      img.src = 'undercity/map_events/shopkeeper3.png';
    }
    return null;
  }

  /** Lazily fetch undercity/guardians/<id>.png; a 404 stays on the placeholder. */
  private loadGuardian(guardianId: string): void {
    if (
      this.guardianTex.has(guardianId) ||
      this.guardianMiss.has(guardianId) ||
      this.guardianLoading.has(guardianId)
    ) {
      return;
    }
    this.guardianLoading.add(guardianId);
    const img = new Image();
    img.onload = () => {
      this.guardianTex.set(guardianId, img);
      this.guardianLoading.delete(guardianId);
    };
    img.onerror = () => {
      this.guardianMiss.add(guardianId);
      this.guardianLoading.delete(guardianId);
    };
    img.src = `undercity/guardians/${guardianId}.png`;
  }

  /** Real transparent enemy art if loaded (undercity/enemies/<id>.png), else null
   *  while it loads. Used by the roaming enraged monster so it shows its actual
   *  creature sprite over its tile. */
  private enemyArt(enemyId: string): HTMLImageElement | null {
    return this.enemyTex.get(enemyId) ?? null;
  }

  private loadEnemy(enemyId: string): void {
    if (
      !enemyId ||
      this.enemyTex.has(enemyId) ||
      this.enemyMiss.has(enemyId) ||
      this.enemyLoading.has(enemyId)
    ) {
      return;
    }
    this.enemyLoading.add(enemyId);
    const img = new Image();
    img.onload = () => {
      this.enemyTex.set(enemyId, img);
      this.enemyLoading.delete(enemyId);
    };
    img.onerror = () => {
      this.enemyMiss.add(enemyId);
      this.enemyLoading.delete(enemyId);
    };
    img.src = enemyArtUrl(enemyId);   // boss familiars resolve to boss_spawns/
  }

  /** Space-info popover, drawn in world space so it pans/zooms with the board. */
  private drawInfo(): void {
    const now = performance.now();
    // Destination popovers first (so a tapped popover sits on top of them).
    for (const ci of this.choiceInfos) {
      const born = this.choiceShownAt.get(ci.nodeId) ?? now;
      const [alpha, scale] = popIn((now - born) / 1000);
      this.drawPopover(ci, alpha, scale);
    }
    if (this.info) {
      const [alpha, scale] = popIn((now - this.infoShownAt) / 1000);
      this.drawPopover(this.info, alpha, scale);
    }
  }

  /** One space-info popover anchored above its node. */
  private drawPopover(info: NodeInfo, alpha: number, pop: number): void {
    const n = this.nodeMap.get(info.nodeId);
    if (!n) return;
    const ctx = this.ctx;

    const pad = 10;
    const maxTextW = 195;
    const titleH = 18;
    const lineH = 15;

    ctx.save();
    ctx.globalAlpha = alpha;

    const iconW = info.icon ? 20 : 0; // 16px glyph + a little gap
    ctx.font = 'bold 13px sans-serif';
    const titleW = ctx.measureText(info.title).width;
    ctx.font = '11px sans-serif';
    const lines = this.wrapText(info.body, maxTextW);
    let widest = titleW + iconW;
    for (const l of lines) widest = Math.max(widest, ctx.measureText(l).width);

    const w = Math.min(maxTextW, widest) + pad * 2;
    const h = pad * 2 + titleH + lines.length * lineH;
    const anchorY = n.y - NODE_R - 12;
    const x = n.x - w / 2;
    const y = anchorY - h;

    // Grow out of the anchor point as it appears.
    ctx.translate(n.x, anchorY);
    ctx.scale(pop, pop);
    ctx.translate(-n.x, -anchorY);

    ctx.beginPath();
    ctx.roundRect(x, y, w, h, 8);
    ctx.fillStyle = 'rgba(20, 18, 14, 0.94)';
    ctx.fill();
    ctx.strokeStyle = 'rgba(74, 124, 89, 0.65)';
    ctx.lineWidth = 1.5;
    ctx.stroke();

    // Pointer triangle down to the node; overdraw hides the box border seam.
    ctx.beginPath();
    ctx.moveTo(n.x - 7, y + h - 1.5);
    ctx.lineTo(n.x, y + h + 8);
    ctx.lineTo(n.x + 7, y + h - 1.5);
    ctx.fillStyle = 'rgba(20, 18, 14, 0.94)';
    ctx.fill();
    ctx.beginPath();
    ctx.moveTo(n.x - 7, y + h - 1);
    ctx.lineTo(n.x, y + h + 8);
    ctx.lineTo(n.x + 7, y + h - 1);
    ctx.strokeStyle = 'rgba(74, 124, 89, 0.65)';
    ctx.stroke();

    ctx.textAlign = 'left';
    ctx.textBaseline = 'top';
    let titleX = x + pad;
    if (info.icon) {
      ctx.fillStyle = '#e0b34e'; // amber glyph so the space type reads at a glance
      ctx.font = "16px 'Material Icons'";
      ctx.fillText(info.icon, titleX, y + pad - 1);
      titleX += iconW;
    }
    ctx.fillStyle = '#b7e4c7';
    ctx.font = 'bold 13px sans-serif';
    ctx.fillText(info.title, titleX, y + pad);
    ctx.fillStyle = '#b7c7b7';
    ctx.font = '11px sans-serif';
    lines.forEach((l, i) => ctx.fillText(l, x + pad, y + pad + titleH + i * lineH));
    ctx.restore();
  }

  /** Greedy word wrap using the current ctx font. */
  private wrapText(text: string, maxW: number): string[] {
    const words = text.split(/\s+/);
    const lines: string[] = [];
    let cur = '';
    for (const wd of words) {
      const candidate = cur ? `${cur} ${wd}` : wd;
      if (cur && this.ctx.measureText(candidate).width > maxW) {
        lines.push(cur);
        cur = wd;
      } else {
        cur = candidate;
      }
    }
    if (cur) lines.push(cur);
    return lines;
  }

  /** Eased render position for a token whose target is (tx, ty). */
  private tokenPos(userId: string, tx: number, ty: number, ts: number): TokenAnim {
    let a = this.tokenAnims.get(userId);
    if (!a) {
      a = {
        x: tx,
        y: ty,
        fromX: tx,
        fromY: ty,
        toX: tx,
        toY: ty,
        start: ts - MOVE_MS,
        hopIndex: 0,
        // Seeded off the userId so creatures don't breathe in lockstep.
        phase: (hashStr(userId) % 628) / 100,
      };
      this.tokenAnims.set(userId, a);
    }
    if (a.toX !== tx || a.toY !== ty) {
      a.fromX = a.x;
      a.fromY = a.y;
      a.toX = tx;
      a.toY = ty;
      a.start = ts;
      a.hopIndex = 0;
    }
    const t = Math.min(1, (ts - a.start) / MOVE_MS);
    const e = easeInOut(t);
    a.x = a.fromX + (a.toX - a.fromX) * e;
    a.y = a.fromY + (a.toY - a.fromY) * e;
    return a;
  }

  private spawnDust(x: number, footY: number, scale = 1): void {
    const count = Math.max(2, Math.round((5 + Math.floor(Math.random() * 3)) * scale));
    for (let i = 0; i < count; i++) {
      const angle = Math.PI + (Math.random() - 0.5) * Math.PI * 0.9; // kick sideways/back
      const speed = (20 + Math.random() * 26) * scale;
      const ttl = 0.3 + Math.random() * 0.22;
      this.dust.push({
        x: x + (Math.random() - 0.5) * 10 * scale,
        y: footY,
        vx: Math.cos(angle) * speed * (Math.random() < 0.5 ? -1 : 1),
        vy: (-8 - Math.random() * 14) * scale,
        life: ttl,
        maxLife: ttl,
        size: (2.5 + Math.random() * 3) * scale,
      });
    }
  }

  private updateDust(dt: number): void {
    for (let i = this.dust.length - 1; i >= 0; i--) {
      const d = this.dust[i];
      d.life -= dt;
      if (d.life <= 0) {
        this.dust.splice(i, 1);
        continue;
      }
      d.x += d.vx * dt;
      d.y += d.vy * dt;
      d.vx *= 0.9;
      d.vy = d.vy * 0.9 + 12 * dt; // settle back down
    }
  }

  private drawDust(): void {
    const ctx = this.ctx;
    for (const d of this.dust) {
      ctx.save();
      ctx.globalAlpha = (d.life / d.maxLife) * 0.55;
      ctx.fillStyle = '#8f8a7e';
      ctx.beginPath();
      ctx.arc(d.x, d.y, d.size, 0, Math.PI * 2);
      ctx.fill();
      ctx.restore();
    }
  }

  private spawnSparkle(x: number, y: number, color = '#8fe6a0', glow = '#4fd08a'): void {
    const ttl = 0.5 + Math.random() * 0.4;
    this.sparkles.push({
      x: x + (Math.random() - 0.5) * 34,
      y: y - Math.random() * 30,
      vy: -10 - Math.random() * 12,
      life: ttl,
      maxLife: ttl,
      size: 1.5 + Math.random() * 2,
      color,
      glow,
    });
  }

  /**
   * One-shot celebratory sparkle burst around the own token — fired when a
   * self-buff spell lands. Colour is tinted per buff (ATK/DEF/SPD) so each
   * reads distinctly, versus the gate heal's steady green twinkle. A brighter,
   * faster pop than the sustained heal emitter.
   */
  /** Register a two-creature high-five. Both tokens must be co-located (the
   *  caller guarantees this); the placement loop overrides their x/hop/squash
   *  for HIGH_FIVE_MS and fires an impact burst at the clap. `start` is stamped
   *  from the first frame's `ts` so it shares the token-animation clock. */
  playHighFive(giverId: string, recipientId: string): void {
    this.highFive = { aId: giverId, bId: recipientId, start: -1, clapped: false };
  }

  burstBuff(color = '#ffd76a', glow = '#f2a900'): void {
    const own = this.ownUserId ? this.tokenAnims.get(this.ownUserId) : undefined;
    if (!own) return;
    for (let i = 0; i < 22; i++) {
      const ttl = 0.6 + Math.random() * 0.5;
      const ang = Math.random() * Math.PI * 2;
      const spread = Math.random() * 26;
      this.sparkles.push({
        x: own.x + Math.cos(ang) * spread,
        y: own.y - 6 - Math.random() * 36,
        vy: -18 - Math.random() * 22,
        life: ttl,
        maxLife: ttl,
        size: 1.8 + Math.random() * 2.4,
        color,
        glow,
      });
    }
  }

  private spawnHealNumber(x: number, y: number, amount: number): void {
    this.heals.push({ x, y, life: 1.1, maxLife: 1.1, text: `+${amount}`, color: '#7fe6a0' });
  }

  // ── Spell FX ─────────────────────────────────────────────────────────────────
  // A cast/hit only needs userIds; the actual particles are spawned in draw()
  // once this frame's live token positions are known (mirrors pendingHealPops).

  /** Queue a spell-cast effect (per-category bolt/puff/impact). */
  playSpellCast(fx: SpellCastFx): void {
    this.pendingCast.push(fx);
  }

  /** Queue a "spell landed on this token" reaction (flash + shake + number). */
  playSpellHit(fx: SpellHitFx): void {
    this.pendingHit.push(fx);
  }

  /** Mid-body world point of a token, or null if it isn't on-screen this frame. */
  private tokenPoint(userId?: string): { x: number; y: number } | null {
    if (!userId) return null;
    const a = this.tokenAnims.get(userId);
    return a ? { x: a.x, y: a.y - 22 } : null;
  }

  /** World point just above a node's disc (used for teleport / boss targets). */
  private nodePoint(nodeId?: string): { x: number; y: number } | null {
    if (!nodeId) return null;
    const n = this.nodeMap.get(nodeId);
    return n ? { x: n.x, y: n.y - DISC_RY - 22 } : null;
  }

  /** Resolve a queued cast into the right primitives at live positions. */
  private spawnCastFx(fx: SpellCastFx): void {
    const from = this.tokenPoint(fx.casterId);
    if (!from) return;
    const target = this.tokenPoint(fx.targetId) ?? this.nodePoint(fx.targetNode);
    switch (fx.shape) {
      case 'buff':
      case 'heal':
      case 'fate':
      case 'wish':
        this.puffAt(from.x, from.y, fx.color, fx.glow, 'burst');
        break;
      case 'recall':
        this.puffAt(from.x, from.y, fx.color, fx.glow, 'implode');
        break;
      case 'teleport':
        this.puffAt(from.x, from.y, fx.color, fx.glow, 'implode');
        if (target) this.puffAt(target.x, target.y, fx.color, fx.glow, 'burst');
        break;
      case 'damage':
      case 'curse':
      case 'boss':
        this.spawnBolt(from, target ?? from, fx);
        break;
    }
  }

  /** Resolve a queued hit into an impact + flash on one token. */
  private spawnHitFx(fx: SpellHitFx): void {
    const p = this.tokenPoint(fx.targetId);
    if (!p) return;
    if (fx.dodged) {
      this.puffAt(p.x, p.y, '#cfe8ff', '#6fb7ff', 'burst', 8);
      this.floatNumber(p.x, p.y, 'miss', '#cfe8ff');
      return;
    }
    this.impactAt(p.x, p.y, '#ff5a3c', '#ff8a4a');
    if (fx.dmg) this.floatNumber(p.x, p.y, `-${fx.dmg}`, '#ff6b5a');
    this.hitToken(fx.targetId);
  }

  private spawnBolt(from: { x: number; y: number }, to: { x: number; y: number }, fx: SpellCastFx): void {
    const dist = Math.hypot(to.x - from.x, to.y - from.y);
    this.bolts.push({
      fromX: from.x,
      fromY: from.y,
      toX: to.x,
      toY: to.y,
      t: 0,
      dur: Math.min(0.55, 0.12 + dist / 900),
      color: fx.color,
      glow: fx.glow,
      size: fx.shape === 'boss' ? 6 : 4,
      hitUser: fx.targetId,
      dmg: fx.dodged ? undefined : fx.dmg,
      dodged: fx.dodged,
      done: false,
    });
  }

  private boltImpact(b: Bolt): void {
    if (b.dodged) {
      this.puffAt(b.toX, b.toY, '#cfe8ff', '#6fb7ff', 'burst', 8);
      this.floatNumber(b.toX, b.toY, 'miss', '#cfe8ff');
      return;
    }
    this.impactAt(b.toX, b.toY, b.color, b.glow);
    if (b.dmg) this.floatNumber(b.toX, b.toY, `-${b.dmg}`, '#ff6b5a');
    if (b.hitUser) this.hitToken(b.hitUser);
  }

  /** Kick off a token's flash/shake reaction. */
  private hitToken(userId: string): void {
    const a = this.tokenAnims.get(userId);
    if (!a) return;
    a.hitLife = 0.4;
    a.hitMax = 0.4;
  }

  /** A sparkle pop: `burst` throws motes outward, `implode` drags a ring inward. */
  private puffAt(
    x: number,
    y: number,
    color: string,
    glow: string,
    mode: 'burst' | 'implode',
    count = 18,
  ): void {
    for (let i = 0; i < count; i++) {
      const ttl = 0.5 + Math.random() * 0.5;
      const ang = Math.random() * Math.PI * 2;
      if (mode === 'implode') {
        const r = 20 + Math.random() * 22;
        this.sparkles.push({
          x: x + Math.cos(ang) * r,
          y: y + Math.sin(ang) * r,
          vx: -Math.cos(ang) * r * 1.6,
          vy: -Math.sin(ang) * r * 1.6,
          life: ttl,
          maxLife: ttl,
          size: 1.6 + Math.random() * 2,
          color,
          glow,
        });
      } else {
        const spread = Math.random() * 24;
        this.sparkles.push({
          x: x + Math.cos(ang) * spread,
          y: y - Math.random() * 20,
          vx: Math.cos(ang) * 30,
          vy: -18 - Math.random() * 22,
          life: ttl,
          maxLife: ttl,
          size: 1.8 + Math.random() * 2.2,
          color,
          glow,
        });
      }
    }
  }

  /** A tight radial spark burst where a blow lands. */
  private impactAt(x: number, y: number, color: string, glow: string): void {
    for (let i = 0; i < 16; i++) {
      const ttl = 0.35 + Math.random() * 0.3;
      const ang = Math.random() * Math.PI * 2;
      const sp = 60 + Math.random() * 90;
      this.sparkles.push({
        x,
        y,
        vx: Math.cos(ang) * sp,
        vy: Math.sin(ang) * sp,
        life: ttl,
        maxLife: ttl,
        size: 1.6 + Math.random() * 2.2,
        color,
        glow,
      });
    }
  }

  private floatNumber(x: number, y: number, text: string, color: string): void {
    this.heals.push({ x, y, life: 1.1, maxLife: 1.1, text, color });
  }

  private drawBolts(): void {
    const ctx = this.ctx;
    for (const b of this.bolts) {
      const e = easeInOut(Math.min(1, b.t));
      const x = b.fromX + (b.toX - b.fromX) * e;
      const y = b.fromY + (b.toY - b.fromY) * e;
      // A short trail behind the head reads as motion.
      const te = easeInOut(Math.max(0, b.t - 0.14));
      const tx = b.fromX + (b.toX - b.fromX) * te;
      const ty = b.fromY + (b.toY - b.fromY) * te;
      ctx.save();
      ctx.globalAlpha = 0.5;
      ctx.strokeStyle = b.glow;
      ctx.lineWidth = b.size * 0.9;
      ctx.lineCap = 'round';
      ctx.beginPath();
      ctx.moveTo(tx, ty);
      ctx.lineTo(x, y);
      ctx.stroke();
      ctx.globalAlpha = 1;
      ctx.fillStyle = b.color;
      ctx.shadowColor = b.glow;
      ctx.shadowBlur = 10;
      ctx.beginPath();
      ctx.arc(x, y, b.size, 0, Math.PI * 2);
      ctx.fill();
      ctx.restore();
    }
  }

  private updateHealFx(dt: number): void {
    // Emit sparkles around the own token while a heal is promised.
    if (this.healPending) {
      this.sparkleAccum += dt;
      const own = this.ownUserId ? this.tokenAnims.get(this.ownUserId) : undefined;
      while (this.sparkleAccum > 0.06) {
        this.sparkleAccum -= 0.06;
        if (own) this.spawnSparkle(own.x, own.y);
      }
    } else {
      this.sparkleAccum = 0;
    }
    this.effectClock += dt * 1000; // drives special-paint overlays
    // Shiny creatures twinkle gold — a steady, gentler emitter over every shiny
    // token on-screen (distinct from the green gate-heal sparkle above).
    this.shinyAccum += dt;
    while (this.shinyAccum > 0.16) {
      this.shinyAccum -= 0.16;
      for (const p of this.players) {
        if (!p.shiny) continue;
        const tok = this.tokenAnims.get(p.userId);
        if (tok) this.spawnSparkle(tok.x, tok.y, '#ffe27a', '#f2a900');
      }
    }
    for (let i = this.sparkles.length - 1; i >= 0; i--) {
      const s = this.sparkles[i];
      s.life -= dt;
      if (s.life <= 0) {
        this.sparkles.splice(i, 1);
        continue;
      }
      if (s.vx) s.x += s.vx * dt;
      s.y += s.vy * dt;
    }
    // Advance spell bolts; fire the impact once as each lands.
    for (let i = this.bolts.length - 1; i >= 0; i--) {
      const b = this.bolts[i];
      b.t += dt / b.dur;
      if (b.t >= 1) {
        if (!b.done) {
          b.done = true;
          this.boltImpact(b);
        }
        this.bolts.splice(i, 1);
      }
    }
    // Decay per-token spell-hit reactions.
    for (const a of this.tokenAnims.values()) {
      if (a.hitLife != null) {
        a.hitLife -= dt;
        if (a.hitLife <= 0) {
          a.hitLife = undefined;
          a.hitMax = undefined;
        }
      }
    }
    for (let i = this.heals.length - 1; i >= 0; i--) {
      const h = this.heals[i];
      h.life -= dt;
      if (h.life <= 0) {
        this.heals.splice(i, 1);
        continue;
      }
      h.y -= 34 * dt; // float upward
    }
  }

  private drawSparkles(): void {
    const ctx = this.ctx;
    for (const s of this.sparkles) {
      const a = s.life / s.maxLife;
      ctx.save();
      ctx.globalAlpha = Math.sin(a * Math.PI) * 0.9; // twinkle in and out
      ctx.fillStyle = s.color;
      ctx.shadowColor = s.glow;
      ctx.shadowBlur = 6;
      ctx.beginPath();
      ctx.arc(s.x, s.y, s.size, 0, Math.PI * 2);
      ctx.fill();
      ctx.restore();
    }
  }

  private drawHealNumbers(): void {
    const ctx = this.ctx;
    for (const h of this.heals) {
      const a = Math.min(1, h.life / (h.maxLife * 0.5)); // hold, then fade
      ctx.save();
      ctx.globalAlpha = a;
      ctx.font = 'bold 20px system-ui, sans-serif';
      ctx.textAlign = 'center';
      ctx.lineWidth = 3;
      ctx.strokeStyle = 'rgba(0,0,0,0.65)';
      ctx.fillStyle = h.color ?? '#7fe6a0';
      ctx.strokeText(h.text, h.x, h.y);
      ctx.fillText(h.text, h.x, h.y);
      ctx.restore();
    }
  }

  /**
   * @param hopY   vertical lift while hopping between spaces (0 when idle)
   * @param breath idle vertical-scale wobble (1 while hopping)
   */
  /**
   * Base draw height for a token. Your own token is largest; on the read-only
   * spectator board (no own token) everyone is bumped up a little so creatures
   * stay legible on a TV even when the camera is pulled back.
   */
  private tokenHeight(isOwn: boolean, tier = 1): number {
    const base = isOwn ? 72 : this.interactive ? 56 : 68;
    // Evolved units (Tier 2+) loom larger on the board so their upgrade
    // reads at a glance.
    return tier >= 2 ? base * 1.35 : base;
  }

  /** Update + draw the owner's active companion: it hops after the own token
   *  between spaces (arriving a beat late) and pokes around the space when idle. */
  private updatePet(
    ts: number,
    elapsed: number,
    placed: { p: BoardPlayer; x: number; y: number; hopY: number; breath: number }[],
  ): { footY: number; draw: () => void } | null {
    const img = this.petImg;
    if (!this.activePetSprite || !img || !img.complete || !img.naturalWidth) return null;
    const ownT = placed.find((t) => t.p.userId === this.ownUserId);
    if (!ownT) return null; // own token not on this layer / not visible

    const prof = this.petProfile ?? DEFAULT_PET_PROFILE;

    const ownSpr = formSprite(ownT.p.form, ownT.p.spriteVariant);
    const ownH = this.tokenHeight(true, ownT.p.tier) * ownSpr.scale;
    const ownFootY = ownT.y + ownH * 0.48;
    const baseX = ownT.x + PET_FOLLOW_DX;
    const baseY = ownFootY + PET_FOLLOW_DY;

    const oa = this.ownUserId ? this.tokenAnims.get(this.ownUserId) : undefined;
    const ownMoving = !!oa && ts - oa.start < MOVE_MS;

    const node = this.ownPosition ? this.nodeMap.get(this.ownPosition) : undefined;
    const nodeCx = node ? node.x : ownT.x;
    const nodeTopY = node ? node.y - DISC_RY : ownFootY;

    const rollNext = () =>
      ts + prof.exploreMin + Math.random() * (prof.exploreMax - prof.exploreMin);

    let s = this.pet;
    if (!s) {
      s = {
        x: baseX,
        y: baseY,
        hopStart: -1,
        hopFrom: { x: baseX, y: baseY },
        hopTo: { x: baseX, y: baseY },
        hopping: false,
        facing: 1,
        exploring: false,
        exploreUntil: 0,
        nextExplore: rollNext(),
        explore: { x: baseX, y: baseY },
      };
      this.pet = s;
    }

    // Where does it want to be this frame?
    if (ownMoving) {
      s.exploring = false;
      s.nextExplore = rollNext();
    } else if (s.exploring && ts > s.exploreUntil) {
      s.exploring = false;
    }
    const tx = s.exploring ? s.explore.x : baseX;
    const ty = s.exploring ? s.explore.y : baseY;

    // Advance an in-flight hop; when landed, decide the next move.
    let hopY = 0;
    if (s.hopping) {
      const pr = (ts - s.hopStart) / prof.hopDur;
      if (pr >= 1) {
        s.x = s.hopTo.x;
        s.y = s.hopTo.y;
        s.hopping = false;
        this.spawnDust(s.x, s.y, PET_DUST_SCALE); // little puff as the follower lands
      } else {
        const e = easeInOut(pr);
        s.x = s.hopFrom.x + (s.hopTo.x - s.hopFrom.x) * e;
        s.y = s.hopFrom.y + (s.hopTo.y - s.hopFrom.y) * e;
        hopY = -Math.sin(pr * Math.PI) * prof.hopHeight;
      }
    }
    if (!s.hopping) {
      const dx = tx - s.x;
      const dy = ty - s.y;
      const dist = Math.hypot(dx, dy);
      if (dist > PET_REST_DIST) {
        const step = Math.min(dist, prof.hopStep);
        s.hopFrom = { x: s.x, y: s.y };
        s.hopTo = { x: s.x + (dx / dist) * step, y: s.y + (dy / dist) * step };
        s.hopStart = ts;
        s.hopping = true;
        if (Math.abs(dx) > 1) s.facing = dx < 0 ? -1 : 1;
      } else if (!ownMoving) {
        // Resting by its owner → occasionally wander, hopping spot to spot.
        if (!s.exploring && ts >= s.nextExplore) {
          s.exploring = true;
          s.exploreUntil = ts + prof.exploreDwell;
          s.nextExplore = rollNext();
        }
        if (s.exploring) {
          s.explore = {
            x: nodeCx + (Math.random() - 0.5) * 2 * prof.exploreRadius,
            y: nodeTopY + (Math.random() - 0.5) * prof.exploreRadius,
          };
        }
      }
    }

    // Subtle idle breath so a resting pet isn't frozen.
    if (!s.hopping) hopY += Math.sin(elapsed * BREATH_SPEED * 0.8) * prof.breathAmp;

    const drawH = PET_DRAW_H;
    const drawW = img.naturalWidth * (drawH / img.naturalHeight);
    const top = s.y - drawH + hopY;
    const ctx = this.ctx;

    // Snapshot the resolved position; the closure draws later, once the pet has
    // been sorted into the token painter's order by its foot y. s.y is the image
    // bottom; inset it to the visible feet so it matches the token contact point.
    const px = s.x;
    const footY = s.y - SPRITE_FOOT_INSET * drawH;
    const facing = s.facing;
    const shadowShrink = 1 - Math.min(0.3, -hopY / prof.hopHeight / 3);
    const draw = () => {
      // Ground shadow (shrinks a touch at a hop's peak to sell the height).
      ctx.save();
      ctx.beginPath();
      ctx.ellipse(px, footY, drawH * 0.34 * shadowShrink, drawH * 0.14 * shadowShrink, 0, 0, Math.PI * 2);
      ctx.fillStyle = 'rgba(0,0,0,0.3)';
      ctx.fill();
      ctx.restore();

      ctx.save();
      ctx.imageSmoothingEnabled = false;
      if (facing < 0) {
        ctx.translate(px, 0);
        ctx.scale(-1, 1);
        ctx.drawImage(img, -drawW / 2, top, drawW, drawH);
      } else {
        ctx.drawImage(img, px - drawW / 2, top, drawW, drawH);
      }
      ctx.restore();
    };
    return { footY, draw };
  }

  private drawToken(
    p: BoardPlayer,
    x: number,
    y: number,
    hopY: number,
    breath: number,
  ): void {
    const ctx = this.ctx;
    // Spell-hit reaction: jitter the sprite sideways for the flash's duration.
    const anim = this.tokenAnims.get(p.userId);
    const hit = anim?.hitLife && anim.hitMax ? anim.hitLife / anim.hitMax : 0;
    if (hit > 0) x += Math.sin(this.effectClock / 18) * 4 * hit;
    const spr = formSprite(p.form, p.spriteVariant);
    const sprite = getRecolored(spr.sprite, p.paint || {}, spr.regions);
    const isOwn = p.userId === this.ownUserId;
    const targetH = this.tokenHeight(isOwn, p.tier) * spr.scale;
    // Feet stay planted (breathing stretches upward from here); hopY lifts the
    // whole body off the ground.
    const footAnchor = y + targetH / 2;
    const drawH = targetH * breath;
    const spriteW = sprite ? sprite.width * (targetH / sprite.height) : 20;
    const top = footAnchor - drawH + hopY;
    const centerY = top + drawH / 2;

    // Elliptical ground shadow at the feet — planted, so the hop reads as air.
    // It also shrinks a touch at the peak of a hop for a sense of height.
    const shadowShrink = 1 - Math.min(0.35, -hopY / HOP_HEIGHT / 3);
    ctx.save();
    ctx.beginPath();
    ctx.ellipse(
      x,
      footAnchor,
      targetH * 0.42 * shadowShrink,
      targetH * 0.17 * shadowShrink,
      0,
      0,
      Math.PI * 2,
    );
    ctx.fillStyle = 'rgba(0,0,0,0.35)';
    ctx.fill();
    ctx.restore();

    if (isOwn) {
      ctx.save();
      ctx.beginPath();
      ctx.arc(x, centerY, targetH * 0.75, 0, Math.PI * 2);
      ctx.strokeStyle = 'rgba(251, 191, 36, 0.9)';
      ctx.lineWidth = 2.5;
      ctx.stroke();
      ctx.restore();
    }

    if (sprite) {
      ctx.save();
      ctx.imageSmoothingEnabled = false;
      ctx.drawImage(sprite, x - spriteW / 2, top, spriteW, drawH);
      // Animated special paint over the silhouette (under the hat, which stays crisp).
      if (p.effect) {
        drawCreatureEffect(ctx, spr.sprite, p.effect, x - spriteW / 2, top, spriteW, drawH, this.effectClock);
      }
      // Hat, placed in sprite-pixel space then scaled to the token's draw box
      // (scaleY carries the breath stretch so the hat rides with the head).
      const rect = hatPlacement(spr.sprite, p.hat);
      if (rect) {
        const sx = spriteW / sprite.width;
        const sy = drawH / sprite.height;
        ctx.drawImage(
          rect.img,
          x - spriteW / 2 + rect.sx * sx,
          top + rect.sy * sy,
          rect.sw * sx,
          rect.sh * sy,
        );
      }
      ctx.imageSmoothingEnabled = true;
      ctx.restore();
    } else {
      ctx.save();
      ctx.beginPath();
      ctx.arc(x, centerY, 10, 0, Math.PI * 2);
      ctx.fillStyle = '#4ade80';
      ctx.fill();
      ctx.restore();
    }

    if (hit > 0) {
      // Additive red bloom over the struck token — no per-pixel sprite tint.
      ctx.save();
      ctx.globalCompositeOperation = 'lighter';
      const r = targetH * 0.7;
      const g = ctx.createRadialGradient(x, centerY, 0, x, centerY, r);
      g.addColorStop(0, `rgba(255,80,60,${0.5 * hit})`);
      g.addColorStop(1, 'rgba(255,80,60,0)');
      ctx.fillStyle = g;
      ctx.beginPath();
      ctx.arc(x, centerY, r, 0, Math.PI * 2);
      ctx.fill();
      ctx.restore();
    }

    if (p.shielded) {
      ctx.save();
      ctx.beginPath();
      ctx.arc(x, centerY, targetH * 0.8, 0, Math.PI * 2);
      ctx.strokeStyle = 'rgba(140, 220, 170, 0.8)';
      ctx.fillStyle = 'rgba(140, 220, 170, 0.12)';
      ctx.lineWidth = 1.5;
      ctx.fill();
      ctx.stroke();
      ctx.restore();
    }
  }

  /** Name pill, drawn in a separate pass so no sprite ever covers a label. */
  private drawLabel(p: BoardPlayer, x: number, y: number): void {
    const ctx = this.ctx;
    const spr = formSprite(p.form, p.spriteVariant);
    const isOwn = p.userId === this.ownUserId;
    const targetH = this.tokenHeight(isOwn, p.tier) * spr.scale;
    ctx.save();
    // Dokapon-style name banner: bigger type, bordered plate. Planted below the
    // feet so it stays steady while the creature breathes and hops.
    ctx.font = 'bold 12px sans-serif';
    ctx.textAlign = 'center';
    ctx.textBaseline = 'top';
    const label = p.username;
    const w = ctx.measureText(label).width + 12;
    const by = y + targetH * 0.55;
    ctx.beginPath();
    ctx.roundRect(x - w / 2, by, w, 17, 5);
    ctx.fillStyle = 'rgba(12, 10, 8, 0.78)';
    ctx.fill();
    ctx.strokeStyle = isOwn ? 'rgba(251, 191, 36, 0.85)' : 'rgba(190, 210, 190, 0.4)';
    ctx.lineWidth = 1.5;
    ctx.stroke();
    ctx.fillStyle = isOwn ? '#fbbf24' : '#e5f0e5';
    ctx.fillText(label, x, by + 3);

    if (p.status) {
      const headTop = y - targetH * 0.55;
      const fontSize = 11;
      ctx.font = `600 ${fontSize}px sans-serif`;
      const padX = 7;
      const padY = 4;
      const bw = ctx.measureText(p.status).width + padX * 2;
      const bh = fontSize + padY * 2;
      const bx = x - bw / 2;
      const bboxY = headTop - bh - 6;
      ctx.beginPath();
      ctx.roundRect(bx, bboxY, bw, bh, 5);
      ctx.fillStyle = isOwn ? 'rgba(40,30,10,0.85)' : 'rgba(12,10,8,0.82)';
      ctx.fill();
      ctx.strokeStyle = isOwn ? 'rgba(251,191,36,0.85)' : 'rgba(190,210,190,0.4)';
      ctx.lineWidth = 1.5;
      ctx.stroke();
      ctx.beginPath();
      ctx.moveTo(x - 4, bboxY + bh - 1);
      ctx.lineTo(x, bboxY + bh + 5);
      ctx.lineTo(x + 4, bboxY + bh - 1);
      ctx.closePath();
      ctx.fill();
      ctx.fillStyle = isOwn ? '#fbbf24' : '#e5f0e5';
      ctx.fillText(p.status, x, bboxY + padY + 1);
    }
    ctx.restore();
  }

  /**
   * Mario-Party-style steps-left die, floating and bobbing above your head with
   * the remaining count on its face.
   */
  private drawStepDie(cx: number, headTop: number, value: number, ts: number): void {
    const ctx = this.ctx;
    const bob = Math.sin(ts * 0.004) * 3;
    const tilt = Math.sin(ts * 0.0022) * 0.1;
    const size = 30;
    const r = size / 2;
    const cy = headTop - 24 + bob; // hover a little above the head

    ctx.save();
    ctx.translate(cx, cy);
    ctx.rotate(tilt);

    // Die body with a soft drop shadow so it floats off the board.
    ctx.beginPath();
    ctx.roundRect(-r, -r, size, size, 7);
    ctx.shadowColor = 'rgba(0, 0, 0, 0.55)';
    ctx.shadowBlur = 8;
    ctx.shadowOffsetY = 3;
    ctx.fillStyle = '#f2eee2';
    ctx.fill();
    ctx.shadowColor = 'transparent';
    ctx.shadowBlur = 0;
    ctx.shadowOffsetY = 0;

    // Top sheen + bevel border.
    ctx.beginPath();
    ctx.roundRect(-r + 3, -r + 3, size - 6, (size - 6) * 0.42, 4);
    ctx.fillStyle = 'rgba(255, 255, 255, 0.35)';
    ctx.fill();
    ctx.beginPath();
    ctx.roundRect(-r, -r, size, size, 7);
    ctx.strokeStyle = 'rgba(30, 26, 18, 0.7)';
    ctx.lineWidth = 2;
    ctx.stroke();

    // The remaining-step count.
    ctx.fillStyle = '#241f18';
    ctx.font = 'bold 19px sans-serif';
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';
    ctx.fillText(String(value), 0, 1);
    ctx.restore();
  }

  /**
   * Floating 🎲 badge over a token whose owner is mid-game at a physical table
   * (spectator broadcast only). Bobs gently so it reads as an alive status pip.
   */
  private drawDiceBadge(cx: number, headTop: number, ts: number): void {
    const ctx = this.ctx;
    const bob = Math.sin(ts * 0.004 + cx) * 3;
    const cy = headTop - 20 + bob; // hover just above the creature's head
    ctx.save();
    ctx.font = '22px sans-serif';
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';
    ctx.shadowColor = 'rgba(0, 0, 0, 0.6)';
    ctx.shadowBlur = 6;
    ctx.shadowOffsetY = 2;
    ctx.fillText('🎲', cx, cy);
    ctx.restore();
  }
}
