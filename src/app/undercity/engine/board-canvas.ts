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
import { getRecolored } from './sprite-engine';
import { formSprite } from '../data/species';
import { SPACE_ICONS } from '../data/items';
import { renderTerrain, TerrainArt, TERRAIN_MARGIN } from './board-terrain';

export interface BoardNode {
  id: string;
  type: string;
  x: number;
  y: number;
  /** Chamber theme tag from the backend map: city | cavern | bog | isle. */
  region?: string;
  neighbors: string[];
}

export interface BoardMap {
  worldW: number;
  worldH: number;
  gate: string;
  boss: string;
  nodes: BoardNode[];
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

const MIN_ZOOM = 0.3;
const MAX_ZOOM = 2.5;
const DRAG_THRESHOLD = 6;
const NODE_R = 26; // disc rx, also the tap radius
const DISC_RY = 19; // squashed ellipse top face for the 2.5D read
const DISC_THICK = 7; // coin side wall visible below the top face
const MOVE_MS = 320; // token slide + camera glide duration per step

function easeInOut(t: number): number {
  return t < 0.5 ? 2 * t * t : 1 - (2 - 2 * t) ** 2 / 2;
}

interface TokenAnim {
  x: number;
  y: number;
  fromX: number;
  fromY: number;
  toX: number;
  toY: number;
  start: number;
}

const TYPE_COLORS: Record<string, string> = {
  loot: '#3f6f3f',
  wild: '#7a3030',
  mystery: '#5b4a8a',
  shop: '#8a6a2f',
  shrine: '#9a7a3a',
  hazard: '#4a5568',
  warp: '#2f7a7a',
  gate: '#4a7c59',
  boss: '#2a1a30',
  ossuary: '#6b5b4a',
};

function scaleHex(hex: string, f: number): string {
  const v = parseInt(hex.slice(1), 16);
  const ch = (n: number) => Math.round(((v >> n) & 255) * f);
  return `rgb(${ch(16)}, ${ch(8)}, ${ch(0)})`;
}

const TYPE_SIDE_COLORS: Record<string, string> = Object.fromEntries(
  Object.entries(TYPE_COLORS).map(([k, c]) => [k, scaleHex(c, 0.55)]),
);

export class BoardCanvas {
  private ctx: CanvasRenderingContext2D;
  private nodeMap = new Map<string, BoardNode>();
  private players: BoardPlayer[] = [];
  private snares = new Set<string>();
  private choices = new Set<string>();
  private backChoice: string | null = null;
  private info: NodeInfo | null = null;
  private infoShownAt = 0;
  private ownPosition: string | null = null;
  private tokenAnims = new Map<string, TokenAnim>();
  private camGlide: TokenAnim | null = null;
  private rafId: number | null = null;
  private startTime = performance.now();
  private terrain: TerrainArt;

  private camX = 0;
  private camY = 0;
  private zoom = 0.8;

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
  ) {
    this.ctx = canvas.getContext('2d')!;
    for (const n of map.nodes) this.nodeMap.set(n.id, n);
    this.terrain = renderTerrain(map);
    this.resize();
    this.initInput();
    window.addEventListener('resize', this.boundResize);
  }

  setPlayers(players: BoardPlayer[]): void {
    this.players = players;
    const own = players.find((p) => p.userId === this.ownUserId);
    this.ownPosition = own?.position ?? null;
  }

  setSnares(nodeIds: string[]): void {
    this.snares = new Set(nodeIds);
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

  centerOn(nodeId: string, animate = true): void {
    const n = this.nodeMap.get(nodeId);
    if (!n) return;
    const toX = n.x - this.canvas.width / this.zoom / 2;
    const toY = n.y - this.canvas.height / this.zoom / 2;
    if (!animate) {
      this.camGlide = null;
      this.camX = toX;
      this.camY = toY;
      this.clampCamera();
      return;
    }
    this.camGlide = {
      x: this.camX,
      y: this.camY,
      fromX: this.camX,
      fromY: this.camY,
      toX,
      toY,
      start: performance.now(),
    };
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
    const dynamicMin = Math.max(
      this.canvas.width / this.map.worldW,
      this.canvas.height / this.map.worldH,
      MIN_ZOOM,
    );
    this.zoom = Math.min(MAX_ZOOM, Math.max(Math.min(dynamicMin, 1), this.zoom));
    const vw = this.canvas.width / this.zoom;
    const vh = this.canvas.height / this.zoom;
    this.camX = Math.max(-200, Math.min(this.map.worldW + 200 - vw, this.camX));
    this.camY = Math.max(-200, Math.min(this.map.worldH + 200 - vh, this.camY));
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
      const dist = Math.hypot(n.x - wx, n.y - wy);
      if (dist < NODE_R * 1.6 && dist < bestDist) {
        best = n;
        bestDist = dist;
      }
    }
    this.onTapNode(best?.id ?? null);
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

    if (this.camGlide) {
      const g = this.camGlide;
      const t = Math.min(1, (ts - g.start) / MOVE_MS);
      const e = easeInOut(t);
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
    ctx.drawImage(this.terrain.canvas, -TERRAIN_MARGIN, -TERRAIN_MARGIN);
    this.drawGlows(elapsed);

    for (const n of this.map.nodes) this.drawSpace(n, elapsed);

    // Player tokens — grouped by logical node, drawn at eased positions so a
    // position change slides the token along instead of teleporting it.
    const byNode = new Map<string, BoardPlayer[]>();
    for (const p of this.players) {
      const list = byNode.get(p.position) ?? [];
      list.push(p);
      byNode.set(p.position, list);
    }
    const present = new Set<string>();
    const placed: { p: BoardPlayer; x: number; y: number }[] = [];
    for (const [nodeId, list] of byNode) {
      const n = this.nodeMap.get(nodeId);
      if (!n) continue;
      list.forEach((p, i) => {
        const angle = (i / Math.max(list.length, 1)) * Math.PI * 2 - Math.PI / 2;
        const off = list.length > 1 ? NODE_R * 0.9 : 0;
        const px = n.x + Math.cos(angle) * off;
        const py = n.y - DISC_RY - 6 + Math.sin(angle) * off * 0.5;
        present.add(p.userId);
        const pos = this.tokenPos(p.userId, px, py, ts);
        placed.push({ p, x: pos.x, y: pos.y });
      });
    }
    // Painter's algorithm: lower tokens draw over higher ones; labels last so
    // no sprite occludes a name.
    placed.sort((a, b) => a.y - b.y);
    for (const t of placed) this.drawToken(t.p, t.x, t.y, elapsed);
    for (const t of placed) this.drawLabel(t.p, t.x, t.y, elapsed);
    for (const id of [...this.tokenAnims.keys()]) {
      if (!present.has(id)) this.tokenAnims.delete(id);
    }

    this.drawInfo();

    ctx.restore();
  }

  /** Pulsing radial glows over the terrain's registered spots (river, flora, portals). */
  private drawGlows(elapsed: number): void {
    const ctx = this.ctx;
    const vx0 = this.camX - 60;
    const vy0 = this.camY - 60;
    const vx1 = this.camX + this.canvas.width / this.zoom + 60;
    const vy1 = this.camY + this.canvas.height / this.zoom + 60;
    for (const s of this.terrain.glowSpots) {
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

    // Ground shadow, then the coin: side wall peeking below the top face.
    ctx.beginPath();
    ctx.ellipse(n.x, n.y + 9, NODE_R + 4, DISC_RY + 2, 0, 0, Math.PI * 2);
    ctx.fillStyle = 'rgba(0,0,0,0.4)';
    ctx.fill();
    ctx.beginPath();
    ctx.ellipse(n.x, n.y + DISC_THICK, NODE_R, DISC_RY, 0, 0, Math.PI * 2);
    ctx.fillStyle = TYPE_SIDE_COLORS[n.type] ?? 'rgb(37, 37, 37)';
    ctx.fill();
    ctx.beginPath();
    ctx.ellipse(n.x, n.y, NODE_R, DISC_RY, 0, 0, Math.PI * 2);
    ctx.fillStyle = TYPE_COLORS[n.type] ?? '#444';
    ctx.fill();
    const hl = ctx.createRadialGradient(n.x - 7, n.y - 6, 0, n.x, n.y, NODE_R);
    hl.addColorStop(0, 'rgba(255,255,255,0.28)');
    hl.addColorStop(1, 'rgba(255,255,255,0)');
    ctx.fillStyle = hl;
    ctx.beginPath();
    ctx.ellipse(n.x, n.y, NODE_R, DISC_RY, 0, 0, Math.PI * 2);
    ctx.fill();
    ctx.beginPath();
    ctx.ellipse(n.x, n.y, NODE_R, DISC_RY, 0, 0, Math.PI * 2);
    ctx.strokeStyle = 'rgba(0,0,0,0.55)';
    ctx.lineWidth = 2.5;
    ctx.stroke();

    // Material Icons renders its ligature names in canvas once the font is
    // loaded (sprite-engine preloads it).
    ctx.font = "22px 'Material Icons'";
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';
    ctx.fillStyle = 'rgba(240, 253, 244, 0.92)';
    ctx.fillText(SPACE_ICONS[n.type] ?? 'circle', n.x, n.y);

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

  /** Space-info popover, drawn in world space so it pans/zooms with the board. */
  private drawInfo(): void {
    if (!this.info) return;
    const n = this.nodeMap.get(this.info.nodeId);
    if (!n) return;
    const ctx = this.ctx;
    const age = (performance.now() - this.infoShownAt) / 1000;
    const alpha = Math.min(1, age / 0.15);
    const pop = 0.92 + 0.08 * Math.min(1, age / 0.18);

    const pad = 10;
    const maxTextW = 195;
    const titleH = 18;
    const lineH = 15;

    ctx.save();
    ctx.globalAlpha = alpha;

    ctx.font = 'bold 13px sans-serif';
    const titleW = ctx.measureText(this.info.title).width;
    ctx.font = '11px sans-serif';
    const lines = this.wrapText(this.info.body, maxTextW);
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
    ctx.fillText(this.info.title, x + pad, y + pad);
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
  private tokenPos(userId: string, tx: number, ty: number, ts: number): { x: number; y: number } {
    let a = this.tokenAnims.get(userId);
    if (!a) {
      a = { x: tx, y: ty, fromX: tx, fromY: ty, toX: tx, toY: ty, start: ts - MOVE_MS };
      this.tokenAnims.set(userId, a);
    }
    if (a.toX !== tx || a.toY !== ty) {
      a.fromX = a.x;
      a.fromY = a.y;
      a.toX = tx;
      a.toY = ty;
      a.start = ts;
    }
    const t = Math.min(1, (ts - a.start) / MOVE_MS);
    const e = easeInOut(t);
    a.x = a.fromX + (a.toX - a.fromX) * e;
    a.y = a.fromY + (a.toY - a.fromY) * e;
    return a;
  }

  private drawToken(p: BoardPlayer, x: number, y: number, elapsed: number): void {
    const ctx = this.ctx;
    const spr = formSprite(p.form);
    const sprite = getRecolored(spr.sprite, p.paint || {}, spr.regions);
    const isOwn = p.userId === this.ownUserId;
    const targetH = (isOwn ? 52 : 40) * spr.scale;
    const bob = Math.sin(elapsed * 2 + x * 0.01) * 2;

    // Elliptical ground shadow at the sprite's feet (unaffected by bob so the
    // token visibly hops above it).
    ctx.save();
    ctx.beginPath();
    ctx.ellipse(x, y + targetH * 0.48, targetH * 0.42, targetH * 0.17, 0, 0, Math.PI * 2);
    ctx.fillStyle = 'rgba(0,0,0,0.35)';
    ctx.fill();
    ctx.restore();

    if (isOwn) {
      ctx.save();
      ctx.beginPath();
      ctx.arc(x, y + bob, targetH * 0.75, 0, Math.PI * 2);
      ctx.strokeStyle = 'rgba(251, 191, 36, 0.9)';
      ctx.lineWidth = 2.5;
      ctx.stroke();
      ctx.restore();
    }

    if (sprite) {
      const scale = targetH / sprite.height;
      const w = sprite.width * scale;
      ctx.save();
      ctx.imageSmoothingEnabled = false;
      ctx.drawImage(sprite, x - w / 2, y - targetH / 2 + bob, w, targetH);
      ctx.imageSmoothingEnabled = true;
      ctx.restore();
    } else {
      ctx.save();
      ctx.beginPath();
      ctx.arc(x, y + bob, 10, 0, Math.PI * 2);
      ctx.fillStyle = '#4ade80';
      ctx.fill();
      ctx.restore();
    }

    if (p.shielded) {
      ctx.save();
      ctx.beginPath();
      ctx.arc(x, y + bob, targetH * 0.8, 0, Math.PI * 2);
      ctx.strokeStyle = 'rgba(140, 220, 170, 0.8)';
      ctx.fillStyle = 'rgba(140, 220, 170, 0.12)';
      ctx.lineWidth = 1.5;
      ctx.fill();
      ctx.stroke();
      ctx.restore();
    }
  }

  /** Name pill, drawn in a separate pass so no sprite ever covers a label. */
  private drawLabel(p: BoardPlayer, x: number, y: number, elapsed: number): void {
    const ctx = this.ctx;
    const spr = formSprite(p.form);
    const isOwn = p.userId === this.ownUserId;
    const targetH = (isOwn ? 52 : 40) * spr.scale;
    const bob = Math.sin(elapsed * 2 + x * 0.01) * 2;
    ctx.save();
    ctx.font = 'bold 9px sans-serif';
    ctx.textAlign = 'center';
    ctx.textBaseline = 'top';
    ctx.fillStyle = 'rgba(0,0,0,0.65)';
    const label = p.username;
    const w = ctx.measureText(label).width + 6;
    ctx.beginPath();
    ctx.roundRect(x - w / 2, y + targetH * 0.55 + bob, w, 12, 3);
    ctx.fill();
    ctx.fillStyle = isOwn ? '#fbbf24' : '#e5f0e5';
    ctx.fillText(label, x, y + targetH * 0.55 + 2 + bob);
    ctx.restore();
  }
}
