/**
 * Rendering + camera for the map editor. Reuses the game's real pipeline —
 * renderTerrain (with baked under-decals), drawSpaceDisc, drawDecals — so the
 * editor is pixel-identical to the board tab, minus fog-of-war and tokens.
 *
 * The component owns all pointer semantics (what a drag means per mode); this
 * class only offers camera math, picking, and a render loop over the doc it's
 * given. Call invalidate() after any doc mutation: terrain re-renders and the
 * layer partition recomputes (region edits can create or dissolve pockets).
 */
import { BoardMap, BoardNode, MapDecal, RegionSpec } from '../engine/board-canvas';
import {
  renderTerrain,
  drawDecals,
  preloadDecalImages,
  decalImageSize,
  TerrainArt,
  FloorTextures,
  LandmarkTextures,
} from '../engine/board-terrain';
import { drawSpaceDisc, NODE_R, DISC_RY } from '../engine/board-space';
import { computeLayers, LayerSpec, OVERWORLD } from '../engine/board-layers';

export type EditorPick =
  | { kind: 'node'; id: string }
  | { kind: 'decal'; index: number }
  | null;

/** Extra state the component wants drawn this frame. */
export interface EditorOverlay {
  selectedNode?: string | null;
  selectedNodes?: ReadonlySet<string>;
  selectedDecal?: number | null;
  /** Connect mode: first endpoint already chosen. */
  connectFrom?: string | null;
  /** World-space cursor for the connect rubber band / add-node crosshair. */
  cursor?: { x: number; y: number } | null;
  showIds?: boolean;
}

const LANDMARK_SRC: Record<string, string> = {
  shrine: 'undercity/icons/shrine.png',
  boss: 'undercity/icons/temple.png',
  shop: 'undercity/icons/bazaar.png',
  warp: 'undercity/icons/teleport.png',
};

export class EditorCanvas {
  private ctx: CanvasRenderingContext2D;
  private doc!: BoardMap;
  private layers: LayerSpec[] = [];
  private terrain = new Map<string, TerrainArt>();
  private floorTex: FloorTextures = {};
  private landmarkTex: LandmarkTextures = {};
  private layerId = OVERWORLD;
  private raf = 0;
  private dirty = true;

  camX = 0;
  camY = 0;
  zoom = 0.35;

  overlay: EditorOverlay = {};

  constructor(private canvas: HTMLCanvasElement) {
    this.ctx = canvas.getContext('2d')!;
  }

  setDoc(doc: BoardMap): void {
    this.doc = doc;
    // Region backgrounds + landmark art, loaded once each; every arrival
    // repaints the cached terrain (same approach as the game board).
    for (const [rid, spec] of Object.entries(doc.regions ?? {})) {
      this.loadFloor(rid, spec);
    }
    for (const [type, src] of Object.entries(LANDMARK_SRC)) {
      if (this.landmarkTex[type]) continue;
      const img = new Image();
      img.onload = () => {
        this.landmarkTex[type] = img;
        this.invalidate();
      };
      img.src = src;
    }
    preloadDecalImages(doc, () => this.invalidate());
    this.invalidate();
    if (!this.raf) this.loop();
  }

  /** Fetch a region's floor art if we don't have it yet (new/edited regions). */
  loadFloor(rid: string, spec: RegionSpec): void {
    if (!spec.background || this.floorTex[rid]?.src.endsWith(spec.background)) return;
    const img = new Image();
    img.onload = () => {
      this.floorTex[rid] = img;
      this.invalidate();
    };
    img.src = spec.background;
  }

  destroy(): void {
    cancelAnimationFrame(this.raf);
    this.raf = 0;
  }

  /** Doc changed: rebuild the layer partition + every layer's terrain. */
  invalidate(): void {
    if (!this.doc) return;
    // New image decals may have appeared since the last preload sweep.
    preloadDecalImages(this.doc, () => this.invalidate());
    this.layers = computeLayers(this.doc);
    if (!this.layers.some((l) => l.id === this.layerId)) this.layerId = OVERWORLD;
    this.terrain.clear();
    for (const spec of this.layers) {
      this.terrain.set(spec.id, renderTerrain(this.doc, this.floorTex, this.landmarkTex, spec));
    }
    this.dirty = true;
  }

  layerIds(): string[] {
    return this.layers.map((l) => l.id);
  }

  activeLayer(): LayerSpec {
    return this.layers.find((l) => l.id === this.layerId) ?? this.layers[0];
  }

  setLayer(id: string): void {
    this.layerId = id;
    const b = this.activeLayer().bounds;
    this.camX = b.x + b.w / 2;
    this.camY = b.y + b.h / 2;
    this.zoom = Math.min(this.canvas.width / b.w, this.canvas.height / b.h) * 0.9;
    this.dirty = true;
  }

  centerOn(x: number, y: number): void {
    this.camX = x;
    this.camY = y;
    this.dirty = true;
  }

  resize(): void {
    const r = this.canvas.getBoundingClientRect();
    this.canvas.width = r.width * devicePixelRatio;
    this.canvas.height = r.height * devicePixelRatio;
    this.dirty = true;
  }

  redraw(): void {
    this.dirty = true;
  }

  toWorld(clientX: number, clientY: number): { x: number; y: number } {
    const r = this.canvas.getBoundingClientRect();
    const sx = (clientX - r.left) * devicePixelRatio;
    const sy = (clientY - r.top) * devicePixelRatio;
    return {
      x: (sx - this.canvas.width / 2) / this.zoom + this.camX,
      y: (sy - this.canvas.height / 2) / this.zoom + this.camY,
    };
  }

  panByScreen(dx: number, dy: number): void {
    this.camX -= (dx * devicePixelRatio) / this.zoom;
    this.camY -= (dy * devicePixelRatio) / this.zoom;
    this.dirty = true;
  }

  zoomAt(clientX: number, clientY: number, factor: number): void {
    const before = this.toWorld(clientX, clientY);
    this.zoom = Math.min(3, Math.max(0.08, this.zoom * factor));
    const after = this.toWorld(clientX, clientY);
    this.camX += before.x - after.x;
    this.camY += before.y - after.y;
    this.dirty = true;
  }

  /** Approximate world-space bounds of a decal, for picking + gizmos. */
  decalBounds(d: MapDecal): { x: number; y: number; w: number; h: number } {
    if (d.kind === 'image') {
      const size = decalImageSize(d.src);
      if (size) {
        const w = size.w * d.scale;
        const h = size.h * d.scale;
        return { x: d.x - w / 2, y: d.y - h, w, h };
      }
    }
    const r = 60 * d.scale; // stamps: generous editing box around the anchor
    return { x: d.x - r, y: d.y - r * 1.4, w: r * 2, h: r * 1.8 };
  }

  /** Nearest node disc first (they're the primary subject), then topmost decal. */
  pick(worldX: number, worldY: number): EditorPick {
    const layer = this.activeLayer();
    let best: BoardNode | null = null;
    let bd = Infinity;
    for (const n of this.doc.nodes) {
      if (!layer.nodeIds.has(n.id)) continue;
      const d = Math.hypot(n.x - worldX, n.y - worldY);
      if (d < bd) {
        bd = d;
        best = n;
      }
    }
    if (best && bd <= NODE_R + 8) return { kind: 'node', id: best.id };
    const decals = this.doc.decals ?? [];
    for (let i = decals.length - 1; i >= 0; i--) {
      const b = this.decalBounds(decals[i]);
      if (worldX >= b.x && worldX <= b.x + b.w && worldY >= b.y && worldY <= b.y + b.h) {
        return { kind: 'decal', index: i };
      }
    }
    return null;
  }

  private loop = (): void => {
    this.raf = requestAnimationFrame(this.loop);
    if (!this.dirty || !this.doc || !this.layers.length) return;
    this.dirty = false;
    this.frame();
  };

  private frame(): void {
    const { ctx, canvas } = this;
    const layer = this.activeLayer();
    const art = this.terrain.get(layer.id);
    ctx.setTransform(1, 0, 0, 1, 0, 0);
    ctx.fillStyle = '#0b0d0a';
    ctx.fillRect(0, 0, canvas.width, canvas.height);
    ctx.translate(canvas.width / 2, canvas.height / 2);
    ctx.scale(this.zoom, this.zoom);
    ctx.translate(-this.camX, -this.camY);

    if (art) {
      // renderTerrain pads by its margin and is cropped to the layer bounds.
      ctx.drawImage(art.canvas, layer.bounds.x - 200, layer.bounds.y - 200);
    }

    // Discs + optional id labels, y-sorted like the game.
    const nodes = this.doc.nodes
      .filter((n) => layer.nodeIds.has(n.id))
      .sort((a, b) => a.y - b.y);
    for (const n of nodes) {
      drawSpaceDisc(ctx, n, {
        selected: n.id === this.overlay.selectedNode || !!this.overlay.selectedNodes?.has(n.id),
      });
    }
    if (this.overlay.showIds) {
      ctx.font = '13px monospace';
      ctx.textAlign = 'center';
      ctx.textBaseline = 'top';
      for (const n of nodes) {
        const label = n.id;
        const w = ctx.measureText(label).width + 8;
        ctx.fillStyle = 'rgba(0, 0, 0, 0.65)';
        ctx.fillRect(n.x - w / 2, n.y + DISC_RY + 6, w, 17);
        ctx.fillStyle = '#b7e4c7';
        ctx.fillText(label, n.x, n.y + DISC_RY + 8);
      }
    }

    drawDecals(ctx, this.doc, 'over', layer);

    // Selected decal gizmo: dashed box, always on top so 'under' decals baked
    // into the terrain stay selectable.
    const di = this.overlay.selectedDecal;
    if (di !== null && di !== undefined && this.doc.decals?.[di]) {
      const b = this.decalBounds(this.doc.decals[di]);
      ctx.save();
      ctx.setLineDash([8 / this.zoom, 6 / this.zoom]);
      ctx.strokeStyle = '#fbbf24';
      ctx.lineWidth = 2 / this.zoom;
      ctx.strokeRect(b.x, b.y, b.w, b.h);
      ctx.setLineDash([]);
      ctx.restore();
    }

    // Connect-mode rubber band from the chosen endpoint to the cursor.
    if (this.overlay.connectFrom && this.overlay.cursor) {
      const from = this.doc.nodes.find((n) => n.id === this.overlay.connectFrom);
      if (from) {
        ctx.save();
        ctx.setLineDash([10 / this.zoom, 8 / this.zoom]);
        ctx.strokeStyle = '#fbbf24';
        ctx.lineWidth = 3 / this.zoom;
        ctx.beginPath();
        ctx.moveTo(from.x, from.y);
        ctx.lineTo(this.overlay.cursor.x, this.overlay.cursor.y);
        ctx.stroke();
        ctx.setLineDash([]);
        ctx.restore();
      }
    }
  }
}
