/**
 * Rendering + camera for the map editor. Reuses the game's real pipeline —
 * renderTerrain (with baked under-decals), drawSpaceDisc, drawDecals — so the
 * editor is pixel-identical to the board tab, minus fog-of-war and tokens.
 *
 * The component owns all pointer semantics (what a drag means per mode); this
 * class only offers camera math, picking, and a render loop over the doc it's
 * given. Call invalidate() after any doc mutation: terrain re-renders and the
 * layer partition recomputes (region edits can create or dissolve pockets).
 * Labels and the hover/selection dressing draw live every frame, so they
 * animate and track drags without terrain rebakes.
 */
import { BoardMap, BoardNode, MapDecal, MapLabel, RegionSpec } from '../engine/board-canvas';
import {
  renderTerrain,
  drawDecals,
  drawMapLabels,
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
  | { kind: 'label'; index: number }
  | null;

/** Extra state the component wants drawn this frame. */
export interface EditorOverlay {
  selectedNode?: string | null;
  selectedNodes?: ReadonlySet<string>;
  selectedDecal?: number | null;
  selectedLabel?: number | null;
  /** Pointer-hover pick, for the "this is clickable" ring/outline. */
  hover?: EditorPick;
  /** Connect mode: first endpoint already chosen. */
  connectFrom?: string | null;
  /** Connect mode: node under the cursor (band snaps + colors to it). */
  connectTarget?: string | null;
  /** True when the pending connect click would REMOVE an existing edge. */
  connectRemoves?: boolean;
  /** World-space cursor for the connect rubber band / add-node crosshair. */
  cursor?: { x: number; y: number } | null;
  showIds?: boolean;
  /** Draw a snap grid of this spacing (0/undefined = off). */
  grid?: number;
  /** Small cursor-anchored info chip. */
  tooltip?: { x: number; y: number; lines: string[] } | null;
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
  private dragNode: string | null = null;

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
    if (!this.raf) this.loop(0);
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
    this.dragNode = null;
    // New image decals may have appeared since the last preload sweep.
    preloadDecalImages(this.doc, () => this.invalidate());
    this.layers = computeLayers(this.doc);
    if (!this.layers.some((l) => l.id === this.layerId)) this.layerId = OVERWORLD;
    this.terrain.clear();
    for (const spec of this.layers) {
      // Labels stay out of the baked art — drawn live every frame instead.
      this.terrain.set(
        spec.id,
        renderTerrain(this.doc, this.floorTex, this.landmarkTex, spec, { omitLabels: true }),
      );
    }
  }

  /**
   * A node drag is starting: bake the active layer's terrain once WITHOUT
   * that node's path ribbons, then track its edges as live lines each frame —
   * paths stay attached to the disc instead of ghosting at the old spot.
   * invalidate() (called on drop via the component) restores full ribbons.
   */
  beginNodeDrag(id: string): void {
    this.dragNode = id;
    const layer = this.activeLayer();
    this.terrain.set(
      layer.id,
      renderTerrain(this.doc, this.floorTex, this.landmarkTex, layer, {
        omitEdgesOf: id,
        omitLabels: true,
      }),
    );
  }

  layerIds(): string[] {
    return this.layers.map((l) => l.id);
  }

  /** Which layer holds this node? Pocket ids shift as connectivity changes. */
  layerContaining(nodeId: string): string | null {
    return this.layers.find((l) => l.nodeIds.has(nodeId))?.id ?? null;
  }

  /** Underground pocket layers (everything but the overworld), id + members. */
  pocketLayers(): { id: string; nodeIds: string[] }[] {
    return this.layers
      .filter((l) => l.id !== OVERWORLD)
      .map((l) => ({ id: l.id, nodeIds: [...l.nodeIds] }));
  }

  activeLayer(): LayerSpec {
    return this.layers.find((l) => l.id === this.layerId) ?? this.layers[0];
  }

  setLayer(id: string): void {
    this.layerId = id;
    this.fitView();
  }

  /** Fit + center the whole active layer in the viewport. */
  fitView(): void {
    const b = this.activeLayer().bounds;
    this.camX = b.x + b.w / 2;
    this.camY = b.y + b.h / 2;
    this.zoom = Math.min(this.canvas.width / b.w, this.canvas.height / b.h) * 0.92;
  }

  centerOn(x: number, y: number): void {
    this.camX = x;
    this.camY = y;
  }

  resize(): void {
    const r = this.canvas.getBoundingClientRect();
    this.canvas.width = r.width * devicePixelRatio;
    this.canvas.height = r.height * devicePixelRatio;
  }

  /** Kept for API compatibility — the loop renders every frame now. */
  redraw(): void {
    /* animated loop, nothing to mark */
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
  }

  zoomAt(clientX: number, clientY: number, factor: number): void {
    const before = this.toWorld(clientX, clientY);
    this.zoom = Math.min(3, Math.max(0.08, this.zoom * factor));
    const after = this.toWorld(clientX, clientY);
    this.camX += before.x - after.x;
    this.camY += before.y - after.y;
  }

  /** Zoom around the viewport center (toolbar +/− buttons, keyboard). */
  zoomBy(factor: number): void {
    const r = this.canvas.getBoundingClientRect();
    this.zoomAt(r.left + r.width / 2, r.top + r.height / 2, factor);
  }

  zoomPct(): number {
    return Math.round(this.zoom * 100);
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

  /** World-space box of a label, measured with its real font. */
  labelBounds(l: MapLabel): { x: number; y: number; w: number; h: number } {
    this.ctx.save();
    this.ctx.font = `italic 600 ${l.size}px Georgia, "Times New Roman", serif`;
    const w = Math.max(this.ctx.measureText(l.text).width, l.size);
    this.ctx.restore();
    const h = l.size * 1.2;
    return { x: l.x - w / 2, y: l.y - h / 2, w, h };
  }

  /** Does this decal/label belong to the active layer (nearest-node rule)? */
  private inActiveLayer(x: number, y: number): boolean {
    const layer = this.activeLayer();
    let best: BoardNode | null = null;
    let bd = Infinity;
    for (const n of this.doc.nodes) {
      const d = (n.x - x) ** 2 + (n.y - y) ** 2;
      if (d < bd) {
        bd = d;
        best = n;
      }
    }
    return !!best && layer.nodeIds.has(best.id);
  }

  /** Nearest node disc first, then topmost label, then topmost decal. */
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
    const labels = this.doc.labels ?? [];
    for (let i = labels.length - 1; i >= 0; i--) {
      const b = this.labelBounds(labels[i]);
      if (
        worldX >= b.x &&
        worldX <= b.x + b.w &&
        worldY >= b.y &&
        worldY <= b.y + b.h &&
        this.inActiveLayer(labels[i].x, labels[i].y)
      ) {
        return { kind: 'label', index: i };
      }
    }
    const decals = this.doc.decals ?? [];
    for (let i = decals.length - 1; i >= 0; i--) {
      const b = this.decalBounds(decals[i]);
      if (
        worldX >= b.x &&
        worldX <= b.x + b.w &&
        worldY >= b.y &&
        worldY <= b.y + b.h &&
        this.inActiveLayer(decals[i].x, decals[i].y)
      ) {
        return { kind: 'decal', index: i };
      }
    }
    return null;
  }

  private loop = (ts: number): void => {
    this.raf = requestAnimationFrame(this.loop);
    if (!this.doc || !this.layers.length) return;
    this.frame(ts);
  };

  private frame(ts: number): void {
    const { ctx, canvas } = this;
    const layer = this.activeLayer();
    const art = this.terrain.get(layer.id);
    const o = this.overlay;
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

    // Snap grid, faint and dotted, clipped to the layer's neighborhood.
    if (o.grid) {
      const g = o.grid;
      const b = layer.bounds;
      ctx.save();
      ctx.strokeStyle = 'rgba(183, 228, 199, 0.07)';
      ctx.lineWidth = 1 / this.zoom;
      ctx.setLineDash([2 / this.zoom, 6 / this.zoom]);
      for (let x = Math.floor(b.x / g) * g; x <= b.x + b.w; x += g) {
        ctx.beginPath();
        ctx.moveTo(x, b.y);
        ctx.lineTo(x, b.y + b.h);
        ctx.stroke();
      }
      for (let y = Math.floor(b.y / g) * g; y <= b.y + b.h; y += g) {
        ctx.beginPath();
        ctx.moveTo(b.x, y);
        ctx.lineTo(b.x + b.w, y);
        ctx.stroke();
      }
      ctx.setLineDash([]);
      ctx.restore();
    }

    // Labels live on their own pass (omitted from the baked terrain) so
    // moving one updates instantly without a terrain rebake.
    drawMapLabels(ctx, this.doc, layer);

    // Live path lines for a mid-drag node (its baked ribbons are omitted).
    if (this.dragNode) {
      const n = this.doc.nodes.find((x) => x.id === this.dragNode);
      if (n) {
        ctx.save();
        ctx.lineCap = 'round';
        for (const nb of n.neighbors) {
          const other = this.doc.nodes.find((x) => x.id === nb);
          if (!other) continue;
          ctx.beginPath();
          ctx.moveTo(n.x, n.y);
          ctx.lineTo(other.x, other.y);
          ctx.strokeStyle = 'rgba(88, 96, 82, 0.85)';
          ctx.lineWidth = 24;
          ctx.stroke();
          ctx.beginPath();
          ctx.moveTo(n.x, n.y);
          ctx.lineTo(other.x, other.y);
          ctx.setLineDash([3, 30]);
          ctx.strokeStyle = 'rgba(222, 230, 210, 0.7)';
          ctx.lineWidth = 5;
          ctx.stroke();
          ctx.setLineDash([]);
        }
        ctx.restore();
      }
    }

    // Hover ring first (under the discs' own selection ring).
    if (o.hover?.kind === 'node' && o.hover.id !== o.selectedNode) {
      const n = this.doc.nodes.find((x) => x.id === (o.hover as { id: string }).id);
      if (n) {
        ctx.beginPath();
        ctx.ellipse(n.x, n.y, NODE_R + 7, DISC_RY + 5, 0, 0, Math.PI * 2);
        ctx.strokeStyle = 'rgba(235, 255, 240, 0.5)';
        ctx.lineWidth = 2.5;
        ctx.stroke();
      }
    }

    // Discs + optional id labels, y-sorted like the game.
    const nodes = this.doc.nodes
      .filter((n) => layer.nodeIds.has(n.id))
      .sort((a, b) => a.y - b.y);
    for (const n of nodes) {
      drawSpaceDisc(ctx, n, {
        selected: n.id === o.selectedNode || !!o.selectedNodes?.has(n.id),
      });
    }
    // Pulse on the primary selection: a soft gold breath over the ring.
    if (o.selectedNode) {
      const n = this.doc.nodes.find((x) => x.id === o.selectedNode);
      if (n) {
        const pulse = 0.35 + 0.3 * Math.sin(ts * 0.005);
        ctx.beginPath();
        ctx.ellipse(n.x, n.y, NODE_R + 13, DISC_RY + 10, 0, 0, Math.PI * 2);
        ctx.strokeStyle = `rgba(251, 191, 36, ${pulse})`;
        ctx.lineWidth = 2;
        ctx.stroke();
      }
    }
    if (o.showIds) {
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

    // Gizmos: marching-ants boxes on the selected (and hovered) decal/label.
    const ants = (b: { x: number; y: number; w: number; h: number }, strong: boolean) => {
      ctx.save();
      ctx.setLineDash([8 / this.zoom, 6 / this.zoom]);
      ctx.lineDashOffset = -ts / 40 / this.zoom;
      ctx.strokeStyle = strong ? '#fbbf24' : 'rgba(235, 255, 240, 0.45)';
      ctx.lineWidth = (strong ? 2 : 1.5) / this.zoom;
      ctx.strokeRect(b.x, b.y, b.w, b.h);
      ctx.setLineDash([]);
      ctx.restore();
    };
    const di = o.selectedDecal;
    if (di !== null && di !== undefined && this.doc.decals?.[di]) {
      ants(this.decalBounds(this.doc.decals[di]), true);
    }
    const li = o.selectedLabel;
    if (li !== null && li !== undefined && this.doc.labels?.[li]) {
      ants(this.labelBounds(this.doc.labels[li]), true);
    }
    if (o.hover?.kind === 'decal' && o.hover.index !== di && this.doc.decals?.[o.hover.index]) {
      ants(this.decalBounds(this.doc.decals[o.hover.index]), false);
    }
    if (o.hover?.kind === 'label' && o.hover.index !== li && this.doc.labels?.[o.hover.index]) {
      ants(this.labelBounds(this.doc.labels[o.hover.index]), false);
    }

    // Connect-mode rubber band: snaps to the hovered node and shows whether
    // the click would add (green) or remove (red) the edge.
    if (o.connectFrom && (o.cursor || o.connectTarget)) {
      const from = this.doc.nodes.find((n) => n.id === o.connectFrom);
      const target = o.connectTarget
        ? this.doc.nodes.find((n) => n.id === o.connectTarget)
        : null;
      const end = target ?? o.cursor;
      if (from && end) {
        const color = target ? (o.connectRemoves ? '#f87171' : '#6ee7a0') : '#fbbf24';
        ctx.save();
        ctx.setLineDash([10 / this.zoom, 8 / this.zoom]);
        ctx.lineDashOffset = -ts / 30 / this.zoom;
        ctx.strokeStyle = color;
        ctx.lineWidth = 3 / this.zoom;
        ctx.beginPath();
        ctx.moveTo(from.x, from.y);
        ctx.lineTo(end.x, end.y);
        ctx.stroke();
        ctx.setLineDash([]);
        // Anchor ring on the from-node so chains read clearly.
        ctx.beginPath();
        ctx.ellipse(from.x, from.y, NODE_R + 10, DISC_RY + 8, 0, 0, Math.PI * 2);
        ctx.strokeStyle = color;
        ctx.lineWidth = 2.5 / this.zoom;
        ctx.stroke();
        ctx.restore();
      }
    }

    // Cursor tooltip chip — constant screen size, so scale by 1/zoom.
    if (o.tooltip) {
      const t = o.tooltip;
      ctx.save();
      ctx.translate(t.x, t.y);
      ctx.scale(1 / this.zoom, 1 / this.zoom);
      ctx.font = '600 13px monospace';
      const w = Math.max(...t.lines.map((l) => ctx.measureText(l).width)) + 16;
      const h = t.lines.length * 17 + 10;
      ctx.translate(16, 16);
      ctx.fillStyle = 'rgba(10, 12, 9, 0.88)';
      ctx.strokeStyle = 'rgba(74, 124, 89, 0.6)';
      ctx.lineWidth = 1;
      ctx.beginPath();
      ctx.roundRect(0, 0, w, h, 5);
      ctx.fill();
      ctx.stroke();
      ctx.textAlign = 'left';
      ctx.textBaseline = 'top';
      t.lines.forEach((line, i) => {
        ctx.fillStyle = i === 0 ? '#d8f3dc' : '#8a978a';
        ctx.fillText(line, 8, 6 + i * 17);
      });
      ctx.restore();
    }
  }
}
