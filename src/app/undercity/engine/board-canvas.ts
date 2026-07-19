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
import { getRecolored, getRawImage } from './sprite-engine';
import { formSprite } from '../data/species';
import {
  BARRIER_GUARDIANS,
  DEFAULT_GUARDIAN,
  GUARDIAN_PLACEHOLDER_SPRITE,
  DEFAULT_GUARDIAN_SPRITE,
} from '../data/items';
import { drawSpaceDisc, NODE_R, DISC_RY } from './board-space';
import { BoardAmbient } from './board-ambient';
import {
  renderTerrain,
  drawDecals,
  preloadDecalImages,
  FloorTextures,
  LandmarkTextures,
  TerrainArt,
  TERRAIN_MARGIN,
} from './board-terrain';
import { computeLayers, layerIndex, OVERWORLD, LayerSpec } from './board-layers';

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
}

/** In-world popover anchored above a node — what the space does. */
export interface NodeInfo {
  nodeId: string;
  title: string;
  body: string;
}

/** Floor paintings for map files that predate the editable regions{} section. */
const LEGACY_FLOOR_SRC: Record<string, string> = {
  city: 'undercity/undercity_background.png',
  cavern: 'undercity/cavern_background.png',
  bog: 'undercity/swamp_background.png',
  isle: 'undercity/palace_background.png',
  ruin: 'undercity/palace_background.png',
  bone: 'undercity/palace_background.png',
  garden: 'undercity/swamp_background.png',
  depths: 'undercity/cavern_background.png',
};

const MIN_ZOOM = 0.15; // floor for tiny screens; larger screens stop at whole-map fit
const MAX_ZOOM = 2.5;
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

// Movement/idle animation of the creature tokens.
const HOP_COUNT = 2; // footfalls per node-to-node move
const HOP_HEIGHT = 10; // px the sprite lifts at the peak of a hop
const BREATH_SPEED = 2.2; // idle breathing rate
const BREATH_AMT = 0.04; // idle vertical scale wobble (±4%)

// A barrier guardian stands its ground and hops "ever so slightly" to read as
// actively blocking the way — a shallow, slow bob with a touch of side sway.
const GUARDIAN_H = 64; // draw height, a shade bigger than a player token
const GUARDIAN_HOP_SPEED = 3.0; // bob cadence
const GUARDIAN_HOP_HEIGHT = 5; // px lift at the peak — deliberately small
const GUARDIAN_SWAY = 3; // px side-to-side pacing

/** One render/view layer: its node subset + world bounds, and its terrain. */
interface Layer {
  spec: LayerSpec;
  terrain: TerrainArt;
}

export class BoardCanvas {
  private ctx: CanvasRenderingContext2D;
  private nodeMap = new Map<string, BoardNode>();
  private ladderPartner = new Map<string, string>();
  private players: BoardPlayer[] = [];
  private snares = new Set<string>();
  private barriersOpen = new Set<string>();
  private diceMarkers = new Set<string>();
  /** Nodes sealed behind an unbroken barrier — rendered greyed. */
  private lockedIds = new Set<string>();
  // Real transparent guardian art, lazily loaded from undercity/guardians/<id>.png.
  // Missing files (the folder is a placeholder for now) fall back to a token sprite.
  private guardianTex = new Map<string, HTMLImageElement>();
  private guardianMiss = new Set<string>();
  private guardianLoading = new Set<string>();
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
  private lastTs = performance.now();
  private rafId: number | null = null;
  private startTime = performance.now();
  private layerSpecs: LayerSpec[];
  private layers = new Map<string, Layer>();
  private layerOf = new Map<string, string>();
  private activeLayerId: string = OVERWORLD;
  private explored = new Map<string, Set<string>>(); // layerId -> lit node ids
  private static readonly EXPLORED_KEY = 'undercity-explored-v1';
  private floorTex: FloorTextures = {};
  private landmarkTex: LandmarkTextures = {};
  private clearedDungeons = new Set<string>(); // biome keys with your sigil
  private onEnterDungeonCb: ((biome: string) => void) | null = null;
  private ambient: BoardAmbient;

  private get active(): Layer {
    return this.layers.get(this.activeLayerId) ?? this.layers.get(OVERWORLD)!;
  }

  /** Re-render every layer's terrain with the current art + cleared flags. */
  private rebuildLayers(): void {
    for (const spec of this.layerSpecs) {
      const biome = spec.id.startsWith('pocket:')
        ? (this.map.nodes.find((n) => spec.nodeIds.has(n.id))?.id.split('_')[0] ?? null)
        : null;
      this.layers.set(spec.id, {
        spec,
        terrain: renderTerrain(this.map, this.floorTex, this.landmarkTex, spec, {
          cleared: !!biome && this.clearedDungeons.has(biome),
        }),
      });
    }
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
    this.clearedDungeons = next;
    this.rebuildLayers();
  }

  /** Fires once per layer-swap into a dungeon (component shows the rite card). */
  setOnEnterDungeon(cb: (biome: string) => void): void {
    this.onEnterDungeonCb = cb;
  }

  private camX = 0;
  private camY = 0;
  private zoom = 0.8;
  /** Read-only broadcast mode: no input wired, dungeons fully revealed. */
  private interactive = true;
  private revealAll = false;

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
    // A ladder node's partner is its neighbor that is also a ladder — its
    // twin on the other layer, tapped to descend/ascend.
    for (const n of map.nodes) {
      if (n.type !== 'ladder') continue;
      const partner = n.neighbors.find((nb) => this.nodeMap.get(nb)?.type === 'ladder');
      if (partner) this.ladderPartner.set(n.id, partner);
    }
    this.layerSpecs = computeLayers(map);
    this.layerOf = layerIndex(this.layerSpecs);
    for (const spec of this.layerSpecs) {
      this.layers.set(spec.id, { spec, terrain: renderTerrain(map, undefined, undefined, spec) });
    }
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
    };
    // Re-render with whatever art has arrived; draw() reads this.active.terrain
    // fresh each frame, so each successful load pops in seamlessly.
    for (const [region, src] of Object.entries(floorSrc)) {
      const img = new Image();
      img.onload = () => {
        this.floorTex[region] = img;
        this.rebuildLayers();
      };
      img.src = src;
    }
    for (const [type, src] of Object.entries(landmarkSrc)) {
      const img = new Image();
      img.onload = () => {
        this.landmarkTex[type] = img;
        this.rebuildLayers();
      };
      img.src = src;
    }
    // Image decals paint into the prerendered terrain; re-render as each lands.
    preloadDecalImages(map, () => this.rebuildLayers());
    this.resize();
    if (this.interactive) this.initInput();
    window.addEventListener('resize', this.boundResize);
  }

  setPlayers(players: BoardPlayer[]): void {
    this.players = players;
    const own = players.find((p) => p.userId === this.ownUserId);
    this.ownPosition = own?.position ?? null;
    // Spectator (no own token) drives layers itself via showLayerOf(); skip the
    // auto-follow so a repeated poll can't yank the view back to the overworld.
    if (!this.ownUserId) return;
    // The visible layer follows your own token: descend a ladder and the view
    // swaps to that dungeon pocket; climb out and it returns to the overworld.
    const target = this.ownPosition ? this.layerOf.get(this.ownPosition) ?? OVERWORLD : OVERWORLD;
    if (target !== this.activeLayerId) {
      this.activeLayerId = target;
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

  /** A dungeon node is lit if explored or adjacent to your current position. */
  private isLit(nodeId: string): boolean {
    if (this.activeLayerId === OVERWORLD) return true;
    if (this.revealAll) return true; // broadcast: no fog-of-war on the TV
    if (this.explored.get(this.activeLayerId)?.has(nodeId)) return true;
    if (!this.ownPosition) return false;
    if (nodeId === this.ownPosition) return true;
    return this.nodeMap.get(this.ownPosition)?.neighbors.includes(nodeId) ?? false;
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
    this.lockedIds = new Set(
      this.map.nodes.filter((n) => !reached.has(n.id)).map((n) => n.id),
    );
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

  centerOn(nodeId: string, animate = true): void {
    this.focusOn(nodeId, undefined, animate);
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
    const toX = n.x - this.canvas.width / toZoom / 2;
    const toY = n.y - this.canvas.height / toZoom / 2;
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
    this.clampCamera();
    const b = this.active.spec.bounds;
    this.ambient.setContext(target === OVERWORLD ? 'overworld' : nodeId.split('_')[0], {
      x: b.x,
      y: b.y,
      w: b.w,
      h: b.h,
    });
  }

  // ── Camera / input (same interaction model as the plaza) ───────────────────

  private resize(): void {
    const parent = this.canvas.parentElement;
    if (!parent) return;
    this.canvas.width = parent.clientWidth || window.innerWidth;
    this.canvas.height = parent.clientHeight || window.innerHeight;
    this.clampCamera();
  }

  private clampCamera(): void {
    // Min zoom fits the active layer's world-space bounds (whole overworld, or
    // just the current dungeon pocket); the letterboxed void matches the wall
    // color so it reads as more cave.
    const M = TERRAIN_MARGIN;
    const b = this.active.spec.bounds;
    const fit = Math.min(
      this.canvas.width / (b.w + 2 * M),
      this.canvas.height / (b.h + 2 * M),
    );
    const minZoom = Math.max(Math.min(fit, 1), MIN_ZOOM);
    this.zoom = Math.min(MAX_ZOOM, Math.max(minZoom, this.zoom));
    // Spectator broadcast: let the camera roam past the world edge so it can
    // center any biome dead-on (edge regions included) instead of stopping at
    // an invisible wall — that wall-stop is what made the camera "bounce".
    // The letterboxed void matches the wall colour, so it just reads as cave.
    if (!this.interactive) return;
    const vw = this.canvas.width / this.zoom;
    const vh = this.canvas.height / this.zoom;
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
    let best: BoardNode | null = null;
    let bestDist = Infinity;
    for (const n of this.map.nodes) {
      if (!this.inActive(n.id)) continue; // hidden-layer nodes aren't tappable
      const dist = Math.hypot(n.x - wx, n.y - wy);
      if (dist < NODE_R * 1.6 && dist < bestDist) {
        best = n;
        bestDist = dist;
      }
    }
    let tappedId = best?.id ?? null;
    // If the tapped space is a ladder whose hidden-layer partner is a current
    // move choice, treat the tap as choosing to cross (descend/ascend).
    if (tappedId) {
      const partner = this.ladderPartner.get(tappedId);
      if (partner && this.choices.has(partner) && !this.choices.has(tappedId)) {
        tappedId = partner;
      }
    }
    this.onTapNode(tappedId);
  }

  // ── Lifecycle ──────────────────────────────────────────────────────────────

  start(): void {
    const own = this.players.find((p) => p.userId === this.ownUserId);
    this.centerOn(own?.position ?? this.map.gate, false);
    const loop = (ts: number) => {
      this.draw(ts);
      this.rafId = requestAnimationFrame(loop);
    };
    this.rafId = requestAnimationFrame(loop);
  }

  stop(): void {
    if (this.rafId) {
      cancelAnimationFrame(this.rafId);
      this.rafId = null;
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
    this.updateDust(dt);

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

    ctx.fillStyle = '#0a0908';
    ctx.fillRect(0, 0, this.canvas.width, this.canvas.height);

    ctx.save();
    ctx.scale(this.zoom, this.zoom);
    ctx.translate(-this.camX, -this.camY);

    // Static world (terrain, paths, landmarks) + its animated glow accents.
    // Blit the active layer's terrain at its world origin.
    const L = this.active;
    ctx.drawImage(
      L.terrain.canvas,
      L.spec.bounds.x - TERRAIN_MARGIN,
      L.spec.bounds.y - TERRAIN_MARGIN,
    );
    this.drawGlows(elapsed);

    // Dungeon darkness: unexplored gloom with light holes at lit nodes.
    if (this.activeLayerId !== OVERWORLD) this.drawGloomVeil();

    for (const n of this.map.nodes) {
      if (!this.inActive(n.id) || !this.isLit(n.id)) continue;
      this.drawSpace(n, elapsed);
    }

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
        const spr = formSprite(p.form);
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
        placed.push({ p, x: a.x, y: a.y, hopY, breath });
      });
    }
    // Dust settles under the tokens.
    this.drawDust();
    // Painter's algorithm: lower tokens draw over higher ones; labels last so
    // no sprite occludes a name.
    placed.sort((a, b) => a.y - b.y);
    for (const t of placed) this.drawToken(t.p, t.x, t.y, t.hopY, t.breath);
    for (const t of placed) this.drawLabel(t.p, t.x, t.y);
    // 🎲 badge over anyone seated at an active board-game table.
    if (this.diceMarkers.size) {
      for (const t of placed) {
        if (!this.diceMarkers.has(t.p.userId)) continue;
        const targetH = this.tokenHeight(t.p.userId === this.ownUserId) * formSprite(t.p.form).scale;
        this.drawDiceBadge(t.x, t.y - targetH + t.hopY, ts);
      }
    }
    // Hand-placed over-layer decals cover tokens (foreground dressing).
    drawDecals(ctx, this.map, 'over', this.active.spec);
    // Steps-left die floats above your head (Mario Party style), above tokens.
    const ownT = placed.find((t) => t.p.userId === this.ownUserId);
    if (this.stepDie !== null && ownT) {
      const targetH = 72 * formSprite(ownT.p.form).scale;
      this.drawStepDie(ownT.x, ownT.y - targetH / 2 + ownT.hopY, this.stepDie, ts);
    }
    for (const id of [...this.tokenAnims.keys()]) {
      if (!present.has(id)) this.tokenAnims.delete(id);
    }

    // Drifting spores + bat flights over everything but the info popover.
    this.ambient.drawAtmosphere(ctx, ts, {
      x0: this.camX,
      y0: this.camY,
      x1: this.camX + this.canvas.width / this.zoom,
      y1: this.camY + this.canvas.height / this.zoom,
    });

    this.drawInfo();

    ctx.restore();
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
    if (v.width !== this.canvas.width || v.height !== this.canvas.height) {
      v.width = this.canvas.width;
      v.height = this.canvas.height;
    }
    const vc = v.getContext('2d')!;
    vc.clearRect(0, 0, v.width, v.height);
    vc.fillStyle = 'rgba(4, 3, 6, 0.82)';
    vc.fillRect(0, 0, v.width, v.height);
    vc.globalCompositeOperation = 'destination-out';
    for (const n of this.map.nodes) {
      if (!this.inActive(n.id) || !this.isLit(n.id)) continue;
      const own = n.id === this.ownPosition;
      const r = (own ? 230 : 150) * this.zoom;
      const sx = (n.x - this.camX) * this.zoom;
      const sy = (n.y - this.camY) * this.zoom;
      if (sx < -r || sx > v.width + r || sy < -r || sy > v.height + r) continue;
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

  /** Pulsing radial glows over the terrain's registered spots (river, flora, portals). */
  private drawGlows(elapsed: number): void {
    const ctx = this.ctx;
    const vx0 = this.camX - 60;
    const vy0 = this.camY - 60;
    const vx1 = this.camX + this.canvas.width / this.zoom + 60;
    const vy1 = this.camY + this.canvas.height / this.zoom + 60;
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
    // A ladder whose hidden-layer partner is a live choice lights up the
    // visible ladder disc so you can tap it to descend/ascend.
    const partner = this.ladderPartner.get(n.id);
    const isChoice =
      this.choices.has(n.id) ||
      (!!partner && this.choices.has(partner) && !this.inActive(partner));
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
    drawSpaceDisc(ctx, n, { sealed, locked: this.lockedIds.has(n.id) });

    // A sealed barrier is held by the area's guardian creature, standing across
    // the route; it's drawn no more the moment someone breaks the barrier.
    if (sealed) this.drawGuardian(n, elapsed);

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

    ctx.font = 'bold 13px sans-serif';
    const titleW = ctx.measureText(info.title).width;
    ctx.font = '11px sans-serif';
    const lines = this.wrapText(info.body, maxTextW);
    let widest = titleW;
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
    ctx.fillStyle = '#b7e4c7';
    ctx.font = 'bold 13px sans-serif';
    ctx.fillText(info.title, x + pad, y + pad);
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

  private spawnDust(x: number, footY: number): void {
    const count = 5 + Math.floor(Math.random() * 3);
    for (let i = 0; i < count; i++) {
      const angle = Math.PI + (Math.random() - 0.5) * Math.PI * 0.9; // kick sideways/back
      const speed = 20 + Math.random() * 26;
      const ttl = 0.3 + Math.random() * 0.22;
      this.dust.push({
        x: x + (Math.random() - 0.5) * 10,
        y: footY,
        vx: Math.cos(angle) * speed * (Math.random() < 0.5 ? -1 : 1),
        vy: -8 - Math.random() * 14,
        life: ttl,
        maxLife: ttl,
        size: 2.5 + Math.random() * 3,
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

  /**
   * @param hopY   vertical lift while hopping between spaces (0 when idle)
   * @param breath idle vertical-scale wobble (1 while hopping)
   */
  /**
   * Base draw height for a token. Your own token is largest; on the read-only
   * spectator board (no own token) everyone is bumped up a little so creatures
   * stay legible on a TV even when the camera is pulled back.
   */
  private tokenHeight(isOwn: boolean): number {
    if (isOwn) return 72;
    return this.interactive ? 56 : 68;
  }

  private drawToken(
    p: BoardPlayer,
    x: number,
    y: number,
    hopY: number,
    breath: number,
  ): void {
    const ctx = this.ctx;
    const spr = formSprite(p.form);
    const sprite = getRecolored(spr.sprite, p.paint || {}, spr.regions);
    const isOwn = p.userId === this.ownUserId;
    const targetH = this.tokenHeight(isOwn) * spr.scale;
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
    const spr = formSprite(p.form);
    const isOwn = p.userId === this.ownUserId;
    const targetH = this.tokenHeight(isOwn) * spr.scale;
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
