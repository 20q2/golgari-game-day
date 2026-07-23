/**
 * The Grave Plaza — TypeScript port of Dino Party's PlazaCanvas.js.
 *
 * A canvas world where every joined player's creature wanders with waypoint
 * AI (walk/sprint/idle), sniffs neighbours, startles at sprinters, and can be
 * tapped for a poke. Kept from the original: pan/zoom/pinch camera, dust
 * particles, drop-in / fade-out transitions, boing, nameplates. Adapted:
 * WebSocket events → poll-delta driven (updatePartners diffing), owner photos
 * and play-together removed, Compost-Shield bubbles and evolution glow added.
 */
import { getRecolored, getPlazaBackground, hatPlacement, drawCreatureEffect } from './sprite-engine';
import { formSprite } from '../data/species';
import { ALL_FORMS } from '../data/forms';

export interface PlazaCreature {
  userId: string;
  username: string;
  form: string;
  /** Cosmetic starter look; picks the alt sprite in formSprite(). */
  spriteVariant?: string | null;
  formName: string;
  creatureName?: string;
  level: number;
  paint: Record<string, number>;
  hat: string | null;
  /** Cosmetic-only shiny — draws a steady gold sparkle over the sprite. */
  shiny?: boolean;
  /** Animated special paint — an overlay drawn over the sprite's silhouette. */
  effect?: string | null;
  shielded: boolean;
  evolveGlow: boolean;
  /** Status-bubble text; '' or absent = no bubble. */
  status?: string;
}

const BASE_SPRITE_SCALE = 1.25;
const SCALE_MIN = 0.7;
const SCALE_MAX = 1.6;
const MAX_LEVEL = 12;

// Source art ranges from 64px to 1024px, so raw pixel dimensions — not creature
// tier — used to dictate on-screen size. Normalize every sprite's native height
// to this baseline first (the native height cancels against the pixel dims used
// at draw time, so a 1024px dragon and a 64px imp render at one height), then let
// tier set the real hierarchy. 90px keeps a T1 starter at its previous size.
const NORMALIZED_SPRITE_PX = 90;
// Intended size hierarchy: each tier is 50% larger than the one below.
const TIER_SCALE: Record<number, number> = { 1: 1, 2: 1.5, 3: 2.25 };

const WORLD_W = 1800;
const WORLD_H = 1200;
const MIN_ZOOM = 0.4;
const MAX_ZOOM = 2.5;
const DRAG_THRESHOLD = 6;
const MARGIN = 150;

const WALK_SPEED_MIN = 30;
const WALK_SPEED_MAX = 60;
const SPRINT_SPEED_MIN = 90;
const SPRINT_SPEED_MAX = 130;
const WALK_DIST_MIN = 50;
const WALK_DIST_MAX = 150;
const SPRINT_DIST_MIN = 150;
const SPRINT_DIST_MAX = 300;
const IDLE_TIME_MIN = 1.0;
const IDLE_TIME_MAX = 3.0;
const SPRINT_CHANCE = 0.05;
const HEADING_LERP = 3.0;
const ARRIVE_DIST = 5;

const FOLLOW_CHANCE = 0.08;
const FOLLOW_RADIUS = 350;
const FOLLOW_OFFSET = 40;
const SNIFF_RADIUS = 80;
const SNIFF_DURATION = 1.5;
const SNIFF_COOLDOWN = 8;
const STARTLE_RADIUS = 80;
const STARTLE_DURATION = 0.8;
const STARTLE_COOLDOWN = 4;
const STARTLE_HOP = 0.4;
const STARTLE_HOP_HEIGHT = 10;

const FADE_OUT_DURATION = 0.5;
const DROP_IN_DURATION = 0.7;
const DROP_IN_HEIGHT = 400;

function easeInQuad(t: number): number {
  return t * t;
}

interface Particle {
  x: number;
  y: number;
  vx: number;
  vy: number;
  life: number;
  maxLife: number;
  size: number;
}

/** Gold twinkle drifting up off a shiny creature — cosmetic only. */
interface Sparkle {
  x: number;
  y: number;
  vy: number;
  life: number;
  maxLife: number;
  size: number;
}

interface Dino {
  partner: PlazaCreature;
  scale: number;
  spriteCanvas: HTMLCanvasElement | null;
  state: 'idling' | 'walking' | 'sprinting';
  targetX: number;
  targetY: number;
  speed: number;
  heading: number;
  facingLeft: boolean;
  idleTimer: number;
  hopPhase: number;
  hopSpeed: number;
  worldX: number;
  worldY: number;
  tapJump: number;
  tapJumpHeight: number;
  nameplateScale: number;
  nameplateBig: number;
  sniffTimer: number;
  sniffPartnerId: string | null;
  sniffCooldown: number;
  startleTimer: number;
  startleCooldown: number;
  fadeOut: number;
  dropIn: number;
  dropInTotal: number;
  squish: number;
}

export class PlazaCanvas {
  private ctx: CanvasRenderingContext2D;
  private dinos: Dino[] = [];
  private departingDinos: Dino[] = [];
  private pendingDropIns = new Set<string>();
  private particles: Particle[] = [];
  private sparkles: Sparkle[] = [];
  private shinyAccum = 0; // time since last shiny twinkle emission
  private effectClock = 0; // ms, monotonic; drives special-paint overlays
  private rafId: number | null = null;
  private startTime = performance.now();
  private lastTs = this.startTime;

  private camX = 0;
  private camY = 0;
  private zoom = 1;
  /** Logical (CSS-pixel) viewport size; the backing store is this × `dpr`. */
  private viewW = 0;
  private viewH = 0;
  /** Device-pixel ratio the backing store is rendered at, capped at 2 so a
   *  DPR-3 phone pays ~4× fill for retina crispness instead of 9×. */
  private dpr = 1;

  private tremorActive = false;
  private tremorGapTimer = 0;
  private tremorBurstTimer = 0;
  private tremorBurstDuration = 1;
  private tremorAmplitude = 0;
  private tremorShakeX = 0;
  private tremorShakeY = 0;

  private boundResize = () => this.resize();
  private pointerHandlers: {
    onDown: (e: PointerEvent) => void;
    onMove: (e: PointerEvent) => void;
    onUp: (e: PointerEvent) => void;
  } | null = null;
  private onWheelHandler: ((e: WheelEvent) => void) | null = null;

  constructor(
    private canvas: HTMLCanvasElement,
    private partners: PlazaCreature[],
    private onSelect: (p: PlazaCreature | null) => void,
    private ownUserId: string | null = null,
  ) {
    this.ctx = canvas.getContext('2d')!;
    this.dinos = partners.map((p) => this.buildDinoData(p, null));
    this.resize();
    this.centerCamera();
    this.initInput();
    window.addEventListener('resize', this.boundResize);
  }

  // ── Data ───────────────────────────────────────────────────────────────────

  private buildDinoData(partner: PlazaCreature, reuse: Dino | null): Dino {
    const level = partner.level || 1;
    const spr = formSprite(partner.form, partner.spriteVariant);
    const spriteCanvas = getRecolored(spr.sprite, partner.paint || {}, spr.regions);
    const levelScale =
      SCALE_MIN + ((Math.min(level, MAX_LEVEL) - 1) / (MAX_LEVEL - 1)) * (SCALE_MAX - SCALE_MIN);
    const tier = ALL_FORMS[partner.form]?.tier ?? 1;
    // Fit native height to the shared baseline, then scale by tier and level.
    const nativeH = spriteCanvas?.height || NORMALIZED_SPRITE_PX;
    const scale = (NORMALIZED_SPRITE_PX / nativeH) * (TIER_SCALE[tier] ?? 1) * levelScale;

    const anim: Dino = reuse ?? {
      partner,
      scale,
      spriteCanvas,
      state: 'idling',
      targetX: 0,
      targetY: 0,
      speed: 60,
      heading: Math.random() * Math.PI * 2,
      facingLeft: false,
      idleTimer: Math.random() * 1.5 + 0.5,
      hopPhase: Math.random() * Math.PI * 2,
      hopSpeed: 1.5 + Math.random(),
      worldX: MARGIN + Math.random() * (WORLD_W - MARGIN * 2),
      worldY: MARGIN + Math.random() * (WORLD_H - MARGIN * 2),
      tapJump: 0,
      tapJumpHeight: 0,
      nameplateScale: 1,
      nameplateBig: 0,
      sniffTimer: 0,
      sniffPartnerId: null,
      sniffCooldown: 0,
      startleTimer: 0,
      startleCooldown: 0,
      fadeOut: 0,
      dropIn: 0,
      dropInTotal: 0,
      squish: 0,
    };

    let dropIn = reuse && reuse.dropIn > 0 ? reuse.dropIn : 0;
    let dropInTotal = reuse && reuse.dropInTotal > 0 ? reuse.dropInTotal : 0;
    if (this.pendingDropIns.has(partner.userId)) {
      dropIn = DROP_IN_DURATION;
      dropInTotal = DROP_IN_DURATION;
      this.pendingDropIns.delete(partner.userId);
    }

    return { ...anim, partner, scale, spriteCanvas, fadeOut: 0, dropIn, dropInTotal };
  }

  /** Poll-delta entry point: rebuild the roster, reusing animation state. */
  updatePartners(partners: PlazaCreature[]): void {
    this.partners = partners;
    const existing = new Map<string, Dino>();
    this.dinos.forEach((d) => existing.set(d.partner.userId, d));
    this.departingDinos.forEach((d) => {
      if (!existing.has(d.partner.userId)) existing.set(d.partner.userId, d);
    });
    this.dinos = partners.map((p) => this.buildDinoData(p, existing.get(p.userId) ?? null));
  }

  fadeOutDino(userId: string): void {
    const idx = this.dinos.findIndex((d) => d.partner.userId === userId);
    if (idx === -1) return;
    const d = this.dinos.splice(idx, 1)[0];
    d.fadeOut = FADE_OUT_DURATION;
    this.departingDinos.push(d);
  }

  dropInDino(userId: string): void {
    this.pendingDropIns.add(userId);
    const d = this.dinos.find((x) => x.partner.userId === userId);
    if (d && !(d.dropIn > 0)) {
      d.dropIn = DROP_IN_DURATION;
      d.dropInTotal = DROP_IN_DURATION;
      this.pendingDropIns.delete(userId);
    }
  }

  boingDino(userId: string): void {
    const d = this.dinos.find((x) => x.partner.userId === userId);
    if (d) {
      d.tapJump = 0.45;
      d.tapJumpHeight = 20 + Math.random() * 16;
    }
  }

  /** Update a creature's status text in place so the bubble reflects a local
   * edit immediately, before the next roster poll arrives. */
  setStatus(userId: string, status: string): void {
    const d = this.dinos.find((x) => x.partner.userId === userId);
    if (d) d.partner.status = status;
  }

  setTremorPhase(active: boolean): void {
    this.tremorActive = active;
    if (active) {
      this.tremorGapTimer = 3.0 + Math.random() * 4.0;
      this.tremorBurstTimer = 0;
      this.tremorAmplitude = 0;
    } else {
      this.tremorGapTimer = 0;
      this.tremorBurstTimer = 0;
      this.tremorAmplitude = 0;
      this.tremorShakeX = 0;
      this.tremorShakeY = 0;
    }
  }

  // ── Camera / input ─────────────────────────────────────────────────────────

  private resize(): void {
    const parent = this.canvas.parentElement;
    if (!parent) return;
    this.dpr = Math.min(window.devicePixelRatio || 1, 2);
    this.viewW = parent.clientWidth || window.innerWidth;
    this.viewH = parent.clientHeight || window.innerHeight;
    // Backing store in device pixels so canvas-drawn text/sprites resolve at
    // the panel's true resolution; the CSS box stays the logical size (100%).
    this.canvas.width = Math.round(this.viewW * this.dpr);
    this.canvas.height = Math.round(this.viewH * this.dpr);
    this.clampCamera();
  }

  private centerCamera(): void {
    const vw = this.viewW / this.zoom;
    const vh = this.viewH / this.zoom;
    this.camX = (WORLD_W - vw) / 2;
    this.camY = (WORLD_H - vh) / 2;
    this.clampCamera();
  }

  private clampCamera(): void {
    const dynamicMin = Math.max(
      this.viewW / WORLD_W,
      this.viewH / WORLD_H,
      MIN_ZOOM,
    );
    this.zoom = Math.min(MAX_ZOOM, Math.max(dynamicMin, this.zoom));
    const vw = this.viewW / this.zoom;
    const vh = this.viewH / this.zoom;
    this.camX = Math.max(0, Math.min(WORLD_W - vw, this.camX));
    this.camY = Math.max(0, Math.min(WORLD_H - vh, this.camY));
  }

  private initInput(): void {
    this.canvas.style.touchAction = 'none';
    const pointers = new Map<number, { x: number; y: number }>();
    let dragStart: { x: number; y: number; camX: number; camY: number } | null = null;
    let didDrag = false;
    let lastPinchDist = 0;

    const onDown = (e: PointerEvent) => {
      e.preventDefault();
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
    for (let i = this.dinos.length - 1; i >= 0; i--) {
      const d = this.dinos[i];
      const spriteW = (d.spriteCanvas?.width || 32) * BASE_SPRITE_SCALE * d.scale;
      const spriteH = (d.spriteCanvas?.height || 32) * BASE_SPRITE_SCALE * d.scale;
      if (
        wx >= d.worldX - spriteW / 2 &&
        wx <= d.worldX + spriteW / 2 &&
        wy >= d.worldY - spriteH / 2 &&
        wy <= d.worldY + spriteH / 2
      ) {
        d.tapJump = 0.45;
        d.tapJumpHeight = 14 + Math.random() * 22;
        d.state = 'idling';
        d.idleTimer = 3.5 + Math.random() * 2.0;
        d.nameplateBig = 3;
        this.onSelect(d.partner);
        return;
      }
    }
    this.onSelect(null);
  }

  // ── AI ─────────────────────────────────────────────────────────────────────

  private pickFollowTarget(d: Dino): Dino | null {
    const moving: Dino[] = [];
    const idle: Dino[] = [];
    for (const other of this.dinos) {
      if (other === d || other.dropIn > 0) continue;
      const dist = Math.hypot(other.worldX - d.worldX, other.worldY - d.worldY);
      if (dist > FOLLOW_RADIUS || dist < ARRIVE_DIST) continue;
      if (other.state === 'walking' || other.state === 'sprinting') moving.push(other);
      else if (other.state === 'idling') idle.push(other);
    }
    const pool = moving.length > 0 ? moving : idle;
    return pool.length ? pool[Math.floor(Math.random() * pool.length)] : null;
  }

  private broadcastStartle(source: Dino): void {
    for (const other of this.dinos) {
      if (other === source || other.startleCooldown > 0 || other.dropIn > 0) continue;
      if (Math.hypot(other.worldX - source.worldX, other.worldY - source.worldY) > STARTLE_RADIUS)
        continue;
      if (other.sniffTimer > 0) {
        other.sniffTimer = 0;
        other.sniffPartnerId = null;
        other.sniffCooldown = SNIFF_COOLDOWN;
      }
      other.tapJump = STARTLE_HOP;
      other.tapJumpHeight = STARTLE_HOP_HEIGHT;
      other.startleTimer = STARTLE_DURATION;
      other.startleCooldown = STARTLE_COOLDOWN;
    }
  }

  private pickWaypoint(d: Dino, sprint: boolean): void {
    const minDist = sprint ? SPRINT_DIST_MIN : WALK_DIST_MIN;
    const maxDist = sprint ? SPRINT_DIST_MAX : WALK_DIST_MAX;
    const angle = Math.random() * Math.PI * 2;
    const dist = minDist + Math.random() * (maxDist - minDist);
    d.targetX = Math.max(MARGIN, Math.min(WORLD_W - MARGIN, d.worldX + Math.cos(angle) * dist));
    d.targetY = Math.max(MARGIN, Math.min(WORLD_H - MARGIN, d.worldY + Math.sin(angle) * dist));
    d.speed = sprint
      ? SPRINT_SPEED_MIN + Math.random() * (SPRINT_SPEED_MAX - SPRINT_SPEED_MIN)
      : WALK_SPEED_MIN + Math.random() * (WALK_SPEED_MAX - WALK_SPEED_MIN);
    d.state = sprint ? 'sprinting' : 'walking';
  }

  private spawnLandingPoof(d: Dino): void {
    const footY =
      d.worldY + (d.spriteCanvas ? d.spriteCanvas.height * BASE_SPRITE_SCALE * d.scale * 0.38 : 12);
    const count = 8 + Math.floor(Math.random() * 5);
    for (let i = 0; i < count; i++) {
      const angle = (i / count) * Math.PI * 2 + Math.random() * 0.4;
      const speed = 28 + Math.random() * 36;
      const ttl = 0.35 + Math.random() * 0.25;
      this.particles.push({
        x: d.worldX + (Math.random() - 0.5) * 8,
        y: footY,
        vx: Math.cos(angle) * speed * 4.0,
        vy: Math.sin(angle) * speed * 0.3 - 18,
        life: ttl,
        maxLife: ttl,
        size: 4 + Math.random() * 5,
      });
    }
  }

  private updateDino(d: Dino, dt: number): void {
    if (d.dropIn > 0) {
      d.dropIn = Math.max(0, d.dropIn - dt);
      if (d.dropIn === 0) {
        this.spawnLandingPoof(d);
        d.squish = 0.15;
      }
      return;
    }

    d.startleCooldown = Math.max(0, d.startleCooldown - dt);
    d.startleTimer = Math.max(0, d.startleTimer - dt);
    d.sniffCooldown = Math.max(0, d.sniffCooldown - dt);

    if (d.sniffTimer > 0) {
      d.sniffTimer = Math.max(0, d.sniffTimer - dt);
      if (d.sniffTimer === 0) {
        d.sniffPartnerId = null;
        d.sniffCooldown = SNIFF_COOLDOWN;
        d.tapJump = 0.35;
        d.tapJumpHeight = 8;
      } else {
        const partner = this.dinos.find((o) => o.partner.userId === d.sniffPartnerId);
        if (partner) d.facingLeft = partner.worldX < d.worldX;
        return;
      }
    }

    if (d.squish > 0) d.squish = Math.max(0, d.squish - dt * 0.6);
    if (d.tapJump > 0) {
      d.tapJump = Math.max(0, d.tapJump - dt);
      if (d.tapJump === 0) this.spawnLandingPoof(d);
    }

    if (d.nameplateBig > 0) d.nameplateBig = Math.max(0, d.nameplateBig - dt);
    const targetNpScale = d.nameplateBig > 0 ? 1.6 : 1;
    d.nameplateScale += (targetNpScale - d.nameplateScale) * Math.min(1, dt * 5);

    switch (d.state) {
      case 'idling': {
        if (d.sniffCooldown === 0 && d.sniffPartnerId === null) {
          for (const other of this.dinos) {
            if (other === d || other.state !== 'idling') continue;
            if (other.sniffCooldown !== 0 || other.sniffPartnerId !== null || other.dropIn > 0)
              continue;
            if (Math.hypot(other.worldX - d.worldX, other.worldY - d.worldY) > SNIFF_RADIUS)
              continue;
            d.sniffPartnerId = other.partner.userId;
            d.sniffTimer = SNIFF_DURATION;
            other.sniffPartnerId = d.partner.userId;
            other.sniffTimer = SNIFF_DURATION;
            break;
          }
        }
        d.idleTimer -= dt;
        if (d.idleTimer <= 0) {
          if (Math.random() < FOLLOW_CHANCE) {
            const leader = this.pickFollowTarget(d);
            if (leader) {
              const ox = (Math.random() - 0.5) * FOLLOW_OFFSET * 2;
              const oy = (Math.random() - 0.5) * FOLLOW_OFFSET * 2;
              d.targetX = Math.max(MARGIN, Math.min(WORLD_W - MARGIN, leader.worldX + ox));
              d.targetY = Math.max(MARGIN, Math.min(WORLD_H - MARGIN, leader.worldY + oy));
              d.speed = WALK_SPEED_MIN + Math.random() * (WALK_SPEED_MAX - WALK_SPEED_MIN);
              d.state = 'walking';
              break;
            }
          }
          this.pickWaypoint(d, Math.random() < SPRINT_CHANCE);
        }
        break;
      }
      case 'walking':
      case 'sprinting': {
        const dx = d.targetX - d.worldX;
        const dy = d.targetY - d.worldY;
        const dist = Math.hypot(dx, dy);
        if (dist < ARRIVE_DIST) {
          d.state = 'idling';
          d.idleTimer = IDLE_TIME_MIN + Math.random() * (IDLE_TIME_MAX - IDLE_TIME_MIN);
          break;
        }
        const targetHeading = Math.atan2(dy, dx);
        let diff = targetHeading - d.heading;
        while (diff > Math.PI) diff -= Math.PI * 2;
        while (diff < -Math.PI) diff += Math.PI * 2;
        d.heading += diff * Math.min(1, HEADING_LERP * dt);
        const step = d.speed * dt;
        d.worldX += Math.cos(d.heading) * step;
        d.worldY += Math.sin(d.heading) * step;
        d.worldX = Math.max(MARGIN, Math.min(WORLD_W - MARGIN, d.worldX));
        d.worldY = Math.max(MARGIN, Math.min(WORLD_H - MARGIN, d.worldY));
        d.facingLeft = Math.cos(d.heading) < 0;

        const isSprint = d.state === 'sprinting';
        if (Math.random() < (isSprint ? 0.55 : 0.3)) {
          const footY =
            d.worldY +
            (d.spriteCanvas ? d.spriteCanvas.height * BASE_SPRITE_SCALE * d.scale * 0.35 : 10);
          const backAngle = d.heading + Math.PI + (Math.random() - 0.5) * 2.4;
          const offsetDist = 8 + Math.random() * 14;
          const ttl = 0.4 + Math.random() * 0.4;
          this.particles.push({
            x: d.worldX + Math.cos(backAngle) * offsetDist,
            y: footY + Math.sin(backAngle) * offsetDist * 0.5,
            vx: Math.cos(backAngle) * (18 + Math.random() * 25),
            vy: -(2 + Math.random() * 10),
            life: ttl,
            maxLife: ttl,
            size: isSprint ? 5 + Math.random() * 4 : 3 + Math.random() * 3,
          });
        }
        break;
      }
    }
  }

  private updateParticles(dt: number): void {
    for (let i = this.particles.length - 1; i >= 0; i--) {
      const p = this.particles[i];
      p.life -= dt;
      if (p.life <= 0) {
        this.particles.splice(i, 1);
        continue;
      }
      p.x += p.vx * dt;
      p.y += p.vy * dt;
      p.vx *= 0.92;
      p.vy *= 0.92;
    }
  }

  /** Emit a steady gold twinkle over every shiny creature, then age the pool.
   *  Cosmetic only — mirrors the board canvas's shiny sparkle. */
  private updateSparkles(dt: number): void {
    this.effectClock += dt * 1000; // drives special-paint overlays
    this.shinyAccum += dt;
    while (this.shinyAccum > 0.16) {
      this.shinyAccum -= 0.16;
      for (const d of this.dinos) {
        if (!d.partner.shiny || d.dropIn > 0) continue;
        const spriteH = (d.spriteCanvas?.height || 32) * BASE_SPRITE_SCALE * d.scale;
        const ttl = 0.5 + Math.random() * 0.4;
        this.sparkles.push({
          x: d.worldX + (Math.random() - 0.5) * spriteH * 0.5,
          y: d.worldY - spriteH * (0.2 + Math.random() * 0.5),
          vy: -10 - Math.random() * 12,
          life: ttl,
          maxLife: ttl,
          size: 1.5 + Math.random() * 2,
        });
      }
    }
    for (let i = this.sparkles.length - 1; i >= 0; i--) {
      const s = this.sparkles[i];
      s.life -= dt;
      if (s.life <= 0) {
        this.sparkles.splice(i, 1);
        continue;
      }
      s.y += s.vy * dt;
    }
  }

  // ── Lifecycle ──────────────────────────────────────────────────────────────

  start(): void {
    this.lastTs = performance.now();
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
    const dt = Math.min((ts - this.lastTs) / 1000, 0.1);
    this.lastTs = ts;

    // Base transform: 1 logical unit = `dpr` device px, so every downstream
    // draw works in logical coords while filling the device-pixel backing store.
    ctx.setTransform(this.dpr, 0, 0, this.dpr, 0, 0);
    ctx.clearRect(0, 0, this.viewW, this.viewH);

    if (this.tremorActive) {
      if (this.tremorBurstTimer > 0) {
        this.tremorBurstTimer -= dt;
        if (this.tremorBurstTimer <= 0) {
          this.tremorBurstTimer = 0;
          this.tremorAmplitude = 0;
          this.tremorShakeX = 0;
          this.tremorShakeY = 0;
          this.tremorGapTimer = 7.0 + Math.random() * 6.0;
        } else {
          const falloff = Math.max(0, this.tremorBurstTimer / this.tremorBurstDuration);
          const amp = this.tremorAmplitude * falloff;
          this.tremorShakeX = (Math.random() * 2 - 1) * amp;
          this.tremorShakeY = (Math.random() * 2 - 1) * amp * 0.6;
        }
      } else {
        this.tremorGapTimer -= dt;
        if (this.tremorGapTimer <= 0) {
          this.tremorBurstDuration = 0.6 + Math.random() * 0.7;
          this.tremorBurstTimer = this.tremorBurstDuration;
          this.tremorAmplitude = 6 + Math.random() * 6;
        }
      }
    }

    ctx.save();
    ctx.scale(this.zoom, this.zoom);
    ctx.translate(-this.camX + this.tremorShakeX, -this.camY + this.tremorShakeY);

    const bg = getPlazaBackground();
    if (bg) {
      ctx.drawImage(bg, 0, 0, WORLD_W, WORLD_H);
    } else {
      ctx.fillStyle = '#1a2e1a';
      ctx.fillRect(0, 0, WORLD_W, WORLD_H);
    }
    // Undercity mood: a permanent dusk over the dino-party lawn.
    ctx.fillStyle = 'rgba(20, 12, 36, 0.35)';
    ctx.fillRect(0, 0, WORLD_W, WORLD_H);

    this.dinos.forEach((d) => this.updateDino(d, dt));
    for (const d of this.dinos) {
      if (d.state === 'sprinting') this.broadcastStartle(d);
    }
    for (let i = this.departingDinos.length - 1; i >= 0; i--) {
      const d = this.departingDinos[i];
      d.fadeOut -= dt;
      if (d.fadeOut <= 0) this.departingDinos.splice(i, 1);
    }
    this.updateParticles(dt);
    this.updateSparkles(dt);

    const allDinos = [...this.dinos, ...this.departingDinos];
    allDinos.sort((a, b) => a.worldY - b.worldY);

    for (const p of this.particles) {
      ctx.save();
      ctx.globalAlpha = (p.life / p.maxLife) * 0.6;
      ctx.fillStyle = '#b5b0a8';
      ctx.beginPath();
      ctx.arc(p.x, p.y, p.size, 0, Math.PI * 2);
      ctx.fill();
      ctx.restore();
    }

    allDinos.forEach((d) => this.drawDino(d, elapsed));

    // Shiny twinkles ride above the sprites — gold with a soft glow.
    for (const s of this.sparkles) {
      const a = s.life / s.maxLife;
      ctx.save();
      ctx.globalAlpha = Math.sin(a * Math.PI) * 0.9; // twinkle in and out
      ctx.fillStyle = '#ffe27a';
      ctx.shadowColor = '#f2a900';
      ctx.shadowBlur = 6;
      ctx.beginPath();
      ctx.arc(s.x, s.y, s.size, 0, Math.PI * 2);
      ctx.fill();
      ctx.restore();
    }
    ctx.restore();
  }

  private drawDino(d: Dino, elapsed: number): void {
    const ctx = this.ctx;
    const x = d.worldX;
    const y = d.worldY;
    if (!d.spriteCanvas) return;

    let dinoAlpha = 1;
    if (d.fadeOut > 0) dinoAlpha = d.fadeOut / FADE_OUT_DURATION;

    let dropOffsetY = 0;
    if (d.dropIn > 0) {
      const t = 1 - d.dropIn / d.dropInTotal;
      dropOffsetY = -(1 - easeInQuad(t)) * DROP_IN_HEIGHT;
      dinoAlpha = Math.min(1, t * 2.5);
    }
    if (dinoAlpha <= 0.001) return;

    const drawScale = BASE_SPRITE_SCALE * d.scale;
    const spriteW = d.spriteCanvas.width * drawScale;
    const spriteH = d.spriteCanvas.height * drawScale;
    const halfW = spriteW / 2;
    const halfH = spriteH / 2;

    let hopY = 0;
    if (d.state === 'walking') hopY = -Math.abs(Math.sin(elapsed * d.hopSpeed * 3 + d.hopPhase)) * 5;
    else if (d.state === 'sprinting')
      hopY = -Math.abs(Math.sin(elapsed * d.hopSpeed * 4.5 + d.hopPhase)) * 7;
    else hopY = Math.sin(elapsed * 1.0 + d.hopPhase) * 1;

    if (d.tapJump > 0) {
      const t = 1 - d.tapJump / 0.45;
      hopY -= Math.sin(t * Math.PI) * (d.tapJumpHeight || 10);
    }

    const squishScaleX = 1 + d.squish * 0.2;
    const squishScaleY = 1 - d.squish * 0.3;

    // Ground shadow
    if (dropOffsetY > -80) {
      ctx.save();
      ctx.globalAlpha = 0.2 * dinoAlpha * Math.max(0, 1 + dropOffsetY / 80);
      ctx.fillStyle = '#000';
      ctx.beginPath();
      ctx.ellipse(x, y + halfH * 0.85, halfW * 0.7, halfH * 0.15, 0, 0, Math.PI * 2);
      ctx.fill();
      ctx.restore();
    }

    // Evolution glow — soft radial pulse behind the sprite.
    if (d.partner.evolveGlow) {
      const pulse = 0.35 + 0.15 * Math.sin(elapsed * 3 + d.hopPhase);
      const grad = ctx.createRadialGradient(x, y + hopY, 4, x, y + hopY, halfW * 1.4);
      grad.addColorStop(0, `rgba(190, 255, 130, ${pulse})`);
      grad.addColorStop(1, 'rgba(190, 255, 130, 0)');
      ctx.save();
      ctx.fillStyle = grad;
      ctx.beginPath();
      ctx.arc(x, y + hopY, halfW * 1.4, 0, Math.PI * 2);
      ctx.fill();
      ctx.restore();
    }

    // Sprite
    ctx.save();
    ctx.globalAlpha = dinoAlpha;
    ctx.imageSmoothingEnabled = false;
    ctx.translate(x, y + hopY + dropOffsetY);
    ctx.scale(d.facingLeft ? squishScaleX : -squishScaleX, squishScaleY);
    ctx.drawImage(d.spriteCanvas, -halfW, -halfH, spriteW, spriteH);
    // Animated special paint over the silhouette, in the same transformed space.
    if (d.partner.effect) {
      drawCreatureEffect(
        ctx,
        formSprite(d.partner.form, d.partner.spriteVariant).sprite,
        d.partner.effect,
        -halfW,
        -halfH,
        spriteW,
        spriteH,
        this.effectClock,
      );
    }
    ctx.imageSmoothingEnabled = true;
    ctx.restore();

    // Hat
    if (d.partner.hat) {
      const spr = formSprite(d.partner.form, d.partner.spriteVariant);
      // Placement is in sprite-pixel space; drawScale maps it to screen exactly
      // like the sprite body above (native origin sits at -halfW/-halfH).
      const rect = hatPlacement(spr.sprite, d.partner.hat);
      if (rect) {
        const hatW = rect.sw * drawScale;
        const hatH = rect.sh * drawScale;
        const hatX = rect.sx * drawScale;
        const hatY = rect.sy * drawScale;
        ctx.save();
        ctx.globalAlpha = dinoAlpha;
        ctx.imageSmoothingEnabled = false;
        if (!d.facingLeft) {
          ctx.translate(x, y + hopY + dropOffsetY);
          ctx.scale(-1, 1);
          ctx.drawImage(rect.img, -halfW + hatX, -halfH + hatY, hatW, hatH);
        } else {
          ctx.drawImage(
            rect.img,
            x - halfW + hatX,
            y - halfH + hopY + dropOffsetY + hatY,
            hatW,
            hatH,
          );
        }
        ctx.restore();
      }
    }

    // Compost-Shield bubble
    if (d.partner.shielded) {
      const r = Math.max(halfW, halfH) * 1.15;
      const wobble = 1 + 0.03 * Math.sin(elapsed * 2.2 + d.hopPhase);
      ctx.save();
      ctx.globalAlpha = 0.5 * dinoAlpha;
      ctx.strokeStyle = 'rgba(140, 220, 170, 0.9)';
      ctx.fillStyle = 'rgba(140, 220, 170, 0.12)';
      ctx.lineWidth = 1.5;
      ctx.beginPath();
      ctx.arc(x, y + hopY, r * wobble, 0, Math.PI * 2);
      ctx.fill();
      ctx.stroke();
      ctx.restore();
    }

    if (d.fadeOut > 0 || d.dropIn > 0) {
      this.drawNameplate(d, x, y + halfH * 0.85 + 10 + dropOffsetY, d.nameplateScale, dinoAlpha);
      return;
    }

    // Startle / sniff emojis
    if (d.startleTimer > 0) {
      const emojiY = y - halfH + hopY - (d.partner.hat ? 14 : 6);
      const floatY = Math.sin(elapsed * 4 + d.hopPhase) * 2;
      ctx.save();
      ctx.globalAlpha = Math.min(1, d.startleTimer / (STARTLE_DURATION * 0.5));
      ctx.font = `${Math.round(11 * d.scale)}px 'Material Icons'`;
      ctx.textAlign = 'center';
      ctx.textBaseline = 'bottom';
      ctx.fillStyle = '#fbbf24';
      ctx.fillText('priority_high', x, emojiY + floatY);
      ctx.restore();
    } else if (d.sniffTimer > 0) {
      const emojiY = y - halfH + hopY - (d.partner.hat ? 14 : 6);
      const floatY = Math.sin(elapsed * 2.5 + d.hopPhase) * 3;
      ctx.save();
      ctx.globalAlpha = 0.7 + 0.3 * Math.sin(elapsed * 3 + d.hopPhase);
      ctx.font = `${Math.round(10 * d.scale)}px 'Material Icons'`;
      ctx.textAlign = 'center';
      ctx.textBaseline = 'bottom';
      ctx.fillStyle = '#e5f0e5';
      ctx.fillText('chat_bubble', x, emojiY + floatY);
      ctx.restore();
    }

    if (d.partner.status && d.fadeOut === 0 && d.dropIn === 0) {
      const isOwnDino =
        this.ownUserId !== null && d.partner.userId === this.ownUserId;
      const headTop = y - halfH + hopY - (d.partner.hat ? 16 : 8);
      this.drawStatusBubble(x, headTop, d.partner.status, d.scale, isOwnDino);
    }

    this.drawNameplate(d, x, y + halfH * 0.85 + 10, d.nameplateScale);
  }

  private drawStatusBubble(
    cx: number,
    bottomY: number,
    text: string,
    scale: number,
    isOwn: boolean,
  ): void {
    const ctx = this.ctx;
    const fontSize = Math.round(6 * scale);
    ctx.font = `600 ${fontSize}px sans-serif`;
    const padX = 5 * scale;
    const padY = 3 * scale;
    const bubbleW = ctx.measureText(text).width + padX * 2;
    const bubbleH = fontSize + padY * 2;
    const bx = cx - bubbleW / 2;
    // Lift the bubble so the trailing thought-dots have room between it and the head.
    const trailGap = 6 * scale;
    const by = bottomY - trailGap - bubbleH;
    ctx.save();
    const fill = 'rgba(248,250,248,0.95)';
    const stroke = isOwn ? 'rgba(251,191,36,0.85)' : 'rgba(74,222,128,0.6)';
    ctx.fillStyle = fill;
    ctx.strokeStyle = stroke;
    ctx.lineWidth = 0.6 * scale;
    // White cloud bubble.
    ctx.beginPath();
    ctx.roundRect(bx, by, bubbleW, bubbleH, 4 * scale);
    ctx.fill();
    ctx.stroke();
    // Trail of shrinking thought-dots dropping toward the creature's head.
    const dots = [
      { r: 1.7 * scale, t: 0.28 },
      { r: 1.1 * scale, t: 0.62 },
      { r: 0.7 * scale, t: 0.95 },
    ];
    for (const dot of dots) {
      const dy = by + bubbleH + trailGap * dot.t;
      ctx.beginPath();
      ctx.arc(cx, dy, dot.r, 0, Math.PI * 2);
      ctx.fill();
      ctx.stroke();
    }
    // Dark text for contrast against the white bubble.
    ctx.fillStyle = '#1a2e1a';
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';
    ctx.fillText(text, cx, by + bubbleH / 2);
    ctx.restore();
  }

  private drawNameplate(d: Dino, cx: number, topY: number, scale = 1, alpha = 1): void {
    const ctx = this.ctx;
    if (alpha < 0.01) return;
    if (alpha < 1) {
      ctx.save();
      ctx.globalAlpha = alpha;
    }
    const p = d.partner;

    const padH = 5 * scale;
    const line1 = `${p.creatureName || p.formName} · L${p.level}`;
    const line2 = p.username;

    const fontSize1 = Math.round(6 * scale);
    const fontSize2 = Math.round(5 * scale);
    ctx.font = `bold ${fontSize1}px sans-serif`;
    const line1W = ctx.measureText(line1).width;
    ctx.font = `${fontSize2}px sans-serif`;
    const line2W = ctx.measureText(line2).width;

    const textW = Math.max(line1W, line2W);
    const pillW = textW + padH * 2;
    const pillH = 16 * scale;
    const pillX = cx - pillW / 2;

    const isOwn = this.ownUserId !== null && p.userId === this.ownUserId;
    ctx.fillStyle = isOwn ? 'rgba(40,30,10,0.65)' : 'rgba(0,0,0,0.65)';
    ctx.beginPath();
    ctx.roundRect(pillX, topY, pillW, pillH, 4 * scale);
    ctx.fill();
    ctx.strokeStyle = isOwn ? 'rgba(251, 191, 36, 0.55)' : 'rgba(74,222,128,0.3)';
    ctx.lineWidth = (isOwn ? 0.6 : 0.5) * scale;
    ctx.stroke();

    ctx.font = `bold ${fontSize1}px sans-serif`;
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';
    ctx.fillStyle = '#f0fdf4';
    ctx.fillText(line1, cx, topY + 6 * scale);
    ctx.font = `${fontSize2}px sans-serif`;
    ctx.fillStyle = '#86efac';
    ctx.fillText(line2, cx, topY + 12 * scale);
    if (alpha < 1) ctx.restore();
  }
}
