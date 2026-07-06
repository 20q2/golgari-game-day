/**
 * The Undercity Crawl board — pan/zoom node-graph renderer.
 *
 * Camera/input handling mirrors PlazaCanvas (drag, pinch, wheel, tap). Draws
 * tunnel edges, typed spaces with emoji glyphs, snare "disturbed ground"
 * tells, player tokens (recolored mini sprites) stacked per node, and pulsing
 * highlights over legal destinations while a move choice is pending.
 */
import { getRecolored } from './sprite-engine';
import { formSprite } from '../data/species';
import { SPACE_GLYPHS } from '../data/items';

export interface BoardNode {
  id: string;
  type: string;
  x: number;
  y: number;
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

const MIN_ZOOM = 0.3;
const MAX_ZOOM = 2.5;
const DRAG_THRESHOLD = 6;
const NODE_R = 26;

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

export class BoardCanvas {
  private ctx: CanvasRenderingContext2D;
  private nodeMap = new Map<string, BoardNode>();
  private players: BoardPlayer[] = [];
  private snares = new Set<string>();
  private choices = new Set<string>();
  private ownPosition: string | null = null;
  private rafId: number | null = null;
  private startTime = performance.now();

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
    private onTapNode: (nodeId: string) => void,
    private ownUserId: string | null,
  ) {
    this.ctx = canvas.getContext('2d')!;
    for (const n of map.nodes) this.nodeMap.set(n.id, n);
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

  centerOn(nodeId: string): void {
    const n = this.nodeMap.get(nodeId);
    if (!n) return;
    this.camX = n.x - this.canvas.width / this.zoom / 2;
    this.camY = n.y - this.canvas.height / this.zoom / 2;
    this.clampCamera();
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
    let best: BoardNode | null = null;
    let bestDist = Infinity;
    for (const n of this.map.nodes) {
      const dist = Math.hypot(n.x - wx, n.y - wy);
      if (dist < NODE_R * 1.6 && dist < bestDist) {
        best = n;
        bestDist = dist;
      }
    }
    if (best) this.onTapNode(best.id);
  }

  // ── Lifecycle ──────────────────────────────────────────────────────────────

  start(): void {
    const own = this.players.find((p) => p.userId === this.ownUserId);
    this.centerOn(own?.position ?? this.map.gate);
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
    ctx.fillStyle = '#12100e';
    ctx.fillRect(0, 0, this.canvas.width, this.canvas.height);

    ctx.save();
    ctx.scale(this.zoom, this.zoom);
    ctx.translate(-this.camX, -this.camY);

    // Edges
    ctx.strokeStyle = 'rgba(120, 140, 100, 0.35)';
    ctx.lineWidth = 6;
    ctx.lineCap = 'round';
    const drawn = new Set<string>();
    for (const n of this.map.nodes) {
      for (const nb of n.neighbors) {
        const key = n.id < nb ? `${n.id}|${nb}` : `${nb}|${n.id}`;
        if (drawn.has(key)) continue;
        drawn.add(key);
        const m = this.nodeMap.get(nb);
        if (!m) continue;
        ctx.beginPath();
        ctx.moveTo(n.x, n.y);
        ctx.lineTo(m.x, m.y);
        ctx.stroke();
      }
    }

    // Nodes
    for (const n of this.map.nodes) {
      const isChoice = this.choices.has(n.id);
      ctx.save();
      if (isChoice) {
        const pulse = 0.55 + 0.35 * Math.sin(elapsed * 5);
        ctx.beginPath();
        ctx.arc(n.x, n.y, NODE_R + 10, 0, Math.PI * 2);
        ctx.fillStyle = `rgba(250, 220, 90, ${pulse * 0.35})`;
        ctx.fill();
        ctx.strokeStyle = `rgba(250, 220, 90, ${pulse})`;
        ctx.lineWidth = 3;
        ctx.stroke();
      }
      ctx.beginPath();
      ctx.arc(n.x, n.y, NODE_R, 0, Math.PI * 2);
      ctx.fillStyle = TYPE_COLORS[n.type] ?? '#444';
      ctx.fill();
      ctx.strokeStyle = 'rgba(0,0,0,0.6)';
      ctx.lineWidth = 3;
      ctx.stroke();

      ctx.font = '24px serif';
      ctx.textAlign = 'center';
      ctx.textBaseline = 'middle';
      ctx.fillText(SPACE_GLYPHS[n.type] ?? '·', n.x, n.y + 1);

      // Disturbed ground — the only tell that a snare lurks here.
      if (this.snares.has(n.id)) {
        ctx.beginPath();
        ctx.setLineDash([3, 5]);
        ctx.arc(n.x, n.y, NODE_R + 4, 0, Math.PI * 2);
        ctx.strokeStyle = 'rgba(160, 120, 70, 0.7)';
        ctx.lineWidth = 2;
        ctx.stroke();
        ctx.setLineDash([]);
      }
      ctx.restore();
    }

    // Player tokens
    const byNode = new Map<string, BoardPlayer[]>();
    for (const p of this.players) {
      const list = byNode.get(p.position) ?? [];
      list.push(p);
      byNode.set(p.position, list);
    }
    for (const [nodeId, list] of byNode) {
      const n = this.nodeMap.get(nodeId);
      if (!n) continue;
      list.forEach((p, i) => {
        const angle = (i / Math.max(list.length, 1)) * Math.PI * 2 - Math.PI / 2;
        const off = list.length > 1 ? NODE_R * 0.9 : 0;
        const px = n.x + Math.cos(angle) * off;
        const py = n.y - NODE_R * 0.9 + Math.sin(angle) * off * 0.5;
        this.drawToken(p, px, py, elapsed);
      });
    }

    ctx.restore();
  }

  private drawToken(p: BoardPlayer, x: number, y: number, elapsed: number): void {
    const ctx = this.ctx;
    const spr = formSprite(p.form);
    const sprite = getRecolored(spr.sprite, p.paint || {}, spr.regions);
    const isOwn = p.userId === this.ownUserId;
    const targetH = (isOwn ? 34 : 26) * spr.scale;
    const bob = Math.sin(elapsed * 2 + x * 0.01) * 2;

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
