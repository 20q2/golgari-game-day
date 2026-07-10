import {
  AfterViewInit,
  Component,
  ElementRef,
  OnDestroy,
  ViewChild,
  computed,
  inject,
  signal,
} from '@angular/core';
import { CommonModule } from '@angular/common';
import { FormsModule } from '@angular/forms';
import { HttpClient } from '@angular/common/http';
import { MatIconModule } from '@angular/material/icon';
import { firstValueFrom } from 'rxjs';
import { BoardMap, BoardNode, MapDecal, RegionSpec } from '../engine/board-canvas';
import { STAMPS, drawStamp } from '../engine/board-terrain';
import { preloadAll } from '../engine/sprite-engine';
import { SPACE_ICONS, SPACE_NAMES } from '../data/items';
import { EditorCanvas, EditorPick } from './editor-canvas';
import { lintMap, LintIssue } from './map-lint';
import {
  downloadMap,
  fsAccessSupported,
  listUndercityImages,
  pickRepoRoot,
  saveMap,
} from './file-io';

type Mode = 'select' | 'add' | 'connect' | 'decal' | 'region';

/** Images offered before the repo folder is granted (can't list dirs via HTTP). */
const SEED_IMAGES = [
  'undercity/icons/rot.png',
  'undercity/icons/die.png',
  'undercity/icons/treasure_hoard.png',
  'undercity/enemies/rot_grub.png',
  'undercity/enemies/drudge_beetle.png',
  'undercity/enemies/fetid_imp.png',
  'undercity/enemies/rot_shambler.png',
  'undercity/enemies/sewer_shambler.png',
];

/**
 * Dev-only WYSIWYG board editor (/undercity/map-editor). Renders with the real
 * game pipeline and writes the checked-in map.json copies via the File System
 * Access API. See .claude/specs/2026-07-10-undercity-map-editor-design.md.
 */
@Component({
  selector: 'app-undercity-map-editor',
  standalone: true,
  imports: [CommonModule, FormsModule, MatIconModule],
  templateUrl: './map-editor.component.html',
  styleUrls: ['./map-editor.component.scss'],
})
export class MapEditorComponent implements AfterViewInit, OnDestroy {
  private readonly http = inject(HttpClient);

  @ViewChild('board') boardRef!: ElementRef<HTMLCanvasElement>;

  protected doc = signal<BoardMap | null>(null);
  protected readonly mode = signal<Mode>('select');
  protected readonly layerId = signal('overworld');
  protected readonly layerIds = signal<string[]>(['overworld']);
  protected readonly showIds = signal(false);
  protected readonly message = signal<string | null>(null);

  // Selection: one node, one decal, or (region mode) a set of nodes.
  protected readonly selNode = signal<string | null>(null);
  protected readonly selDecal = signal<number | null>(null);
  protected readonly selNodes = signal<Set<string>>(new Set());
  protected readonly connectFrom = signal<string | null>(null);

  // Palettes.
  protected readonly stampNames = Object.keys(STAMPS);
  protected stampThumbs: Record<string, string> = {};
  protected readonly images = signal<string[]>(SEED_IMAGES);
  protected readonly placingStamp = signal<string | null>(null);
  protected readonly placingImage = signal<string | null>(null);

  protected readonly typeNames = SPACE_NAMES;
  protected readonly nodeTypes = Object.keys(SPACE_ICONS).filter((t) => t !== 'boss_sealed');

  protected readonly lint = signal<LintIssue[]>([]);
  protected readonly errorCount = computed(
    () => this.lint().filter((i) => i.level === 'error').length,
  );

  protected readonly canWriteInPlace = fsAccessSupported();
  private repoRoot: Awaited<ReturnType<typeof pickRepoRoot>> = null;
  protected readonly rootPicked = signal(false);
  protected readonly dirtySinceSave = signal(false);

  private undoStack: string[] = [];
  private redoStack: string[] = [];

  private canvas!: EditorCanvas;
  private drag: {
    kind: 'node' | 'decal' | 'pan';
    id?: string;
    index?: number;
    lastX: number;
    lastY: number;
    moved: boolean;
  } | null = null;

  private readonly keyHandler = (e: KeyboardEvent) => this.onKey(e);
  private readonly resizeHandler = () => this.canvas?.resize();

  async ngAfterViewInit(): Promise<void> {
    await preloadAll(); // Material Icons font + sprites for glyph drawing
    this.canvas = new EditorCanvas(this.boardRef.nativeElement);
    this.canvas.resize();
    const doc = await firstValueFrom(this.http.get<BoardMap>('data/undercity-map.json'));
    doc.regions ??= {};
    doc.decals ??= [];
    this.doc.set(doc);
    this.canvas.setDoc(doc);
    this.canvas.setLayer('overworld');
    this.afterDocChange(false);
    this.renderStampThumbs();
    window.addEventListener('keydown', this.keyHandler);
    window.addEventListener('resize', this.resizeHandler);
  }

  ngOnDestroy(): void {
    this.canvas?.destroy();
    window.removeEventListener('keydown', this.keyHandler);
    window.removeEventListener('resize', this.resizeHandler);
  }

  // ── Doc access + undo ────────────────────────────────────────────────────

  private d(): BoardMap {
    return this.doc()!;
  }

  /** Snapshot BEFORE a mutation; call once per user gesture. */
  protected snapshot(): void {
    this.undoStack.push(JSON.stringify(this.d()));
    if (this.undoStack.length > 100) this.undoStack.shift();
    this.redoStack = [];
  }

  /** Re-render + re-lint after any doc mutation. */
  protected afterDocChange(markDirty = true): void {
    this.canvas.invalidate();
    this.layerIds.set(this.canvas.layerIds());
    this.lint.set(lintMap(this.d()));
    if (markDirty) this.dirtySinceSave.set(true);
    this.syncOverlay();
  }

  protected undo(): void {
    const prev = this.undoStack.pop();
    if (!prev) return;
    this.redoStack.push(JSON.stringify(this.d()));
    this.restore(prev);
  }

  protected redo(): void {
    const next = this.redoStack.pop();
    if (!next) return;
    this.undoStack.push(JSON.stringify(this.d()));
    this.restore(next);
  }

  private restore(json: string): void {
    const doc = JSON.parse(json) as BoardMap;
    this.doc.set(doc);
    this.canvas.setDoc(doc);
    this.clearSelection();
    this.afterDocChange();
  }

  // ── Pointer handling ─────────────────────────────────────────────────────

  onPointerDown(e: PointerEvent): void {
    (e.target as HTMLElement).setPointerCapture(e.pointerId);
    const w = this.canvas.toWorld(e.clientX, e.clientY);
    const pick = this.canvas.pick(w.x, w.y);
    const mode = this.mode();

    if (mode === 'select' && pick) {
      this.applyPick(pick);
      this.snapshot(); // gesture may become a move; harmless if it doesn't
      this.drag = {
        kind: pick.kind,
        id: pick.kind === 'node' ? pick.id : undefined,
        index: pick.kind === 'decal' ? pick.index : undefined,
        lastX: e.clientX,
        lastY: e.clientY,
        moved: false,
      };
      return;
    }
    if (mode === 'add' && !pick) {
      this.addNodeAt(w.x, w.y);
      return;
    }
    if (mode === 'connect' && pick?.kind === 'node') {
      this.handleConnect(pick.id);
      return;
    }
    if (mode === 'decal' && (this.placingStamp() || this.placingImage())) {
      this.placeDecalAt(w.x, w.y);
      return;
    }
    if (mode === 'decal' && pick?.kind === 'decal') {
      this.selDecal.set(pick.index);
      this.snapshot();
      this.drag = { kind: 'decal', index: pick.index, lastX: e.clientX, lastY: e.clientY, moved: false };
      this.syncOverlay();
      return;
    }
    if (mode === 'region' && pick?.kind === 'node') {
      const set = new Set(this.selNodes());
      if (set.has(pick.id)) set.delete(pick.id);
      else set.add(pick.id);
      this.selNodes.set(set);
      this.syncOverlay();
      return;
    }
    // Empty ground (any mode): pan.
    this.drag = { kind: 'pan', lastX: e.clientX, lastY: e.clientY, moved: false };
  }

  onPointerMove(e: PointerEvent): void {
    const w = this.canvas.toWorld(e.clientX, e.clientY);
    if (this.mode() === 'connect' || this.mode() === 'add') {
      this.canvas.overlay.cursor = w;
      this.canvas.redraw();
    }
    if (!this.drag) return;
    const dx = e.clientX - this.drag.lastX;
    const dy = e.clientY - this.drag.lastY;
    this.drag.lastX = e.clientX;
    this.drag.lastY = e.clientY;
    if (dx === 0 && dy === 0) return;
    this.drag.moved = true;

    if (this.drag.kind === 'pan') {
      this.canvas.panByScreen(-dx, -dy);
    } else if (this.drag.kind === 'node' && this.drag.id) {
      const n = this.d().nodes.find((x) => x.id === this.drag!.id);
      if (n) {
        n.x = Math.round(w.x);
        n.y = Math.round(w.y);
        this.canvas.redraw();
      }
    } else if (this.drag.kind === 'decal' && this.drag.index !== undefined) {
      const d = this.d().decals?.[this.drag.index];
      if (d) {
        d.x = Math.round(w.x);
        d.y = Math.round(w.y);
        this.canvas.redraw();
      }
    }
  }

  onPointerUp(): void {
    if (!this.drag) return;
    const wasEdit = this.drag.kind !== 'pan';
    const moved = this.drag.moved;
    this.drag = null;
    if (wasEdit) {
      if (moved) {
        this.afterDocChange(); // re-drape path ribbons under the moved thing
      } else {
        this.undoStack.pop(); // gesture was just a click — drop the snapshot
      }
    }
  }

  onWheel(e: WheelEvent): void {
    e.preventDefault();
    this.canvas.zoomAt(e.clientX, e.clientY, e.deltaY < 0 ? 1.15 : 1 / 1.15);
  }

  private applyPick(pick: EditorPick): void {
    if (pick?.kind === 'node') {
      this.selNode.set(pick.id);
      this.selDecal.set(null);
    } else if (pick?.kind === 'decal') {
      this.selDecal.set(pick.index);
      this.selNode.set(null);
    }
    this.syncOverlay();
  }

  protected clearSelection(): void {
    this.selNode.set(null);
    this.selDecal.set(null);
    this.selNodes.set(new Set());
    this.connectFrom.set(null);
    this.syncOverlay();
  }

  private syncOverlay(): void {
    if (!this.canvas) return;
    this.canvas.overlay = {
      selectedNode: this.selNode(),
      selectedNodes: this.selNodes(),
      selectedDecal: this.selDecal(),
      connectFrom: this.connectFrom(),
      cursor: this.canvas.overlay.cursor,
      showIds: this.showIds(),
    };
    this.canvas.redraw();
  }

  private onKey(e: KeyboardEvent): void {
    if ((e.target as HTMLElement).tagName === 'INPUT' || (e.target as HTMLElement).tagName === 'SELECT') {
      return;
    }
    if (e.key === 'Escape') {
      this.placingStamp.set(null);
      this.placingImage.set(null);
      this.clearSelection();
    } else if (e.key === 'Delete' || e.key === 'Backspace') {
      this.deleteSelection();
    } else if (e.ctrlKey && !e.shiftKey && e.key.toLowerCase() === 'z') {
      e.preventDefault();
      this.undo();
    } else if ((e.ctrlKey && e.shiftKey && e.key.toLowerCase() === 'z') || (e.ctrlKey && e.key.toLowerCase() === 'y')) {
      e.preventDefault();
      this.redo();
    } else if (e.ctrlKey && e.key.toLowerCase() === 's') {
      e.preventDefault();
      void this.save();
    }
  }

  // ── Modes + selection helpers ────────────────────────────────────────────

  protected setMode(m: Mode): void {
    this.mode.set(m);
    this.placingStamp.set(null);
    this.placingImage.set(null);
    this.connectFrom.set(null);
    this.canvas.overlay.cursor = null;
    this.syncOverlay();
  }

  protected setLayer(id: string): void {
    this.layerId.set(id);
    this.canvas.setLayer(id);
  }

  protected toggleIds(): void {
    this.showIds.update((v) => !v);
    this.syncOverlay();
  }

  protected selectedNode(): BoardNode | null {
    const id = this.selNode();
    return id ? (this.d().nodes.find((n) => n.id === id) ?? null) : null;
  }

  protected selectedDecal(): MapDecal | null {
    const i = this.selDecal();
    return i === null ? null : (this.d().decals?.[i] ?? null);
  }

  protected focusIssue(issue: LintIssue): void {
    if (!issue.nodeId) return;
    const n = this.d().nodes.find((x) => x.id === issue.nodeId);
    if (!n) return;
    this.selNode.set(n.id);
    this.canvas.centerOn(n.x, n.y);
    this.syncOverlay();
  }

  // ── Node editing ─────────────────────────────────────────────────────────

  private addNodeAt(x: number, y: number): void {
    this.snapshot();
    const doc = this.d();
    let i = doc.nodes.length;
    while (doc.nodes.some((n) => n.id === `n${i}`)) i++;
    // New nodes join the active layer's dominant region so they theme right.
    const layer = this.canvas.activeLayer();
    const counts = new Map<string, number>();
    for (const n of doc.nodes) {
      if (layer.nodeIds.has(n.id) && n.region) {
        counts.set(n.region, (counts.get(n.region) ?? 0) + 1);
      }
    }
    const region = [...counts.entries()].sort((a, b) => b[1] - a[1])[0]?.[0] ?? 'city';
    const node: BoardNode = {
      id: `n${i}`,
      type: 'loot',
      x: Math.round(x),
      y: Math.round(y),
      region,
      neighbors: [],
    };
    doc.nodes.push(node);
    this.selNode.set(node.id);
    this.afterDocChange();
  }

  private handleConnect(id: string): void {
    const from = this.connectFrom();
    if (!from) {
      this.connectFrom.set(id);
      this.syncOverlay();
      return;
    }
    if (from !== id) {
      this.snapshot();
      const doc = this.d();
      const a = doc.nodes.find((n) => n.id === from)!;
      const b = doc.nodes.find((n) => n.id === id)!;
      if (a.neighbors.includes(b.id)) {
        a.neighbors = a.neighbors.filter((x) => x !== b.id);
        b.neighbors = b.neighbors.filter((x) => x !== a.id);
      } else {
        a.neighbors.push(b.id);
        b.neighbors.push(a.id);
      }
      this.afterDocChange();
    }
    this.connectFrom.set(null);
    this.syncOverlay();
  }

  protected deleteSelection(): void {
    const nodeId = this.selNode();
    const decalIdx = this.selDecal();
    if (nodeId) {
      this.snapshot();
      const doc = this.d();
      doc.nodes = doc.nodes.filter((n) => n.id !== nodeId);
      for (const n of doc.nodes) n.neighbors = n.neighbors.filter((x) => x !== nodeId);
      this.selNode.set(null);
      this.afterDocChange();
    } else if (decalIdx !== null) {
      this.snapshot();
      this.d().decals!.splice(decalIdx, 1);
      this.selDecal.set(null);
      this.afterDocChange();
    }
  }

  protected renameNode(n: BoardNode, raw: string): void {
    const id = raw.trim();
    if (!id || id === n.id) return;
    const doc = this.d();
    if (doc.nodes.some((x) => x.id === id)) {
      this.message.set(`A node called "${id}" already exists.`);
      return;
    }
    this.snapshot();
    const old = n.id;
    n.id = id;
    for (const x of doc.nodes) {
      x.neighbors = x.neighbors.map((nb) => (nb === old ? id : nb));
    }
    if (doc.gate === old) doc.gate = id;
    if (doc.boss === old) doc.boss = id;
    this.selNode.set(id);
    this.afterDocChange();
  }

  protected setNodeType(n: BoardNode, type: string): void {
    this.snapshot();
    n.type = type;
    this.afterDocChange();
  }

  protected setNodeRegion(n: BoardNode, region: string): void {
    this.snapshot();
    n.region = region;
    this.afterDocChange();
  }

  // ── Decals ───────────────────────────────────────────────────────────────

  private renderStampThumbs(): void {
    for (const name of this.stampNames) {
      const c = document.createElement('canvas');
      c.width = c.height = 72;
      const ctx = c.getContext('2d')!;
      ctx.fillStyle = '#181c16';
      ctx.fillRect(0, 0, 72, 72);
      drawStamp(ctx, name, 36, 54, 0.55, 0, 7);
      this.stampThumbs[name] = c.toDataURL();
    }
  }

  protected pickStamp(name: string): void {
    this.placingStamp.set(this.placingStamp() === name ? null : name);
    this.placingImage.set(null);
  }

  protected pickImage(src: string): void {
    this.placingImage.set(this.placingImage() === src ? null : src);
    this.placingStamp.set(null);
  }

  private placeDecalAt(x: number, y: number): void {
    this.snapshot();
    const doc = this.d();
    const decal: MapDecal = this.placingStamp()
      ? {
          kind: 'stamp',
          stamp: this.placingStamp()!,
          x: Math.round(x),
          y: Math.round(y),
          scale: 1,
          rot: 0,
          layer: 'under',
          seed: Math.floor(Math.random() * 1e6),
        }
      : {
          kind: 'image',
          src: this.placingImage()!,
          x: Math.round(x),
          y: Math.round(y),
          scale: 1,
          rot: 0,
          layer: 'under',
        };
    doc.decals!.push(decal);
    this.selDecal.set(doc.decals!.length - 1);
    this.afterDocChange();
  }

  protected updateDecal(d: MapDecal, patch: Partial<MapDecal>): void {
    this.snapshot();
    Object.assign(d, patch);
    this.afterDocChange();
  }

  /** Degrees in the panel, radians in the file. */
  protected decalRotDeg(d: MapDecal): number {
    return Math.round((d.rot * 180) / Math.PI);
  }

  // ── Regions ──────────────────────────────────────────────────────────────

  protected regionIds(): string[] {
    return Object.keys(this.d().regions ?? {});
  }

  protected region(id: string): RegionSpec {
    return this.d().regions![id];
  }

  protected assignRegion(region: string): void {
    if (!this.selNodes().size) return;
    this.snapshot();
    for (const n of this.d().nodes) {
      if (this.selNodes().has(n.id)) n.region = region;
    }
    this.afterDocChange();
  }

  protected newRegion(): void {
    const id = prompt('New region id (letters/underscores, e.g. gloom_crypt):')?.trim();
    if (!id) return;
    if (!/^[a-z][a-z0-9_]*$/.test(id)) {
      this.message.set('Region ids are lowercase letters, digits, underscores.');
      return;
    }
    const doc = this.d();
    if (doc.regions![id]) {
      this.message.set(`Region "${id}" already exists.`);
      return;
    }
    this.snapshot();
    doc.regions![id] = {
      label: id.replace(/_/g, ' ').replace(/\b\w/g, (c) => c.toUpperCase()),
      background: '',
      scatter: true,
      dark: false,
    };
    if (this.selNodes().size) this.assignRegionNoSnap(id);
    this.afterDocChange();
  }

  private assignRegionNoSnap(region: string): void {
    for (const n of this.d().nodes) {
      if (this.selNodes().has(n.id)) n.region = region;
    }
  }

  protected updateRegion(id: string, patch: Partial<RegionSpec>): void {
    this.snapshot();
    Object.assign(this.d().regions![id], patch);
    if (patch.background) this.canvas.loadFloor(id, this.d().regions![id]);
    this.afterDocChange();
  }

  protected backgroundOptions(): string[] {
    return this.images().filter((i) => i.endsWith('_background.png'));
  }

  // ── Save ─────────────────────────────────────────────────────────────────

  protected async grantRepo(): Promise<void> {
    this.repoRoot = await pickRepoRoot();
    this.rootPicked.set(!!this.repoRoot);
    if (this.repoRoot) {
      this.message.set('Repo folder granted — Ctrl+S writes both map copies.');
      try {
        this.images.set(await listUndercityImages(this.repoRoot));
      } catch {
        /* keep the seed list */
      }
    } else {
      this.message.set("That folder isn't the repo root (map.json copies not found).");
    }
  }

  protected async save(): Promise<void> {
    if (this.errorCount() > 0) {
      this.message.set(`Fix ${this.errorCount()} error(s) before saving.`);
      return;
    }
    if (this.repoRoot) {
      try {
        await saveMap(this.repoRoot, this.d());
        this.dirtySinceSave.set(false);
        this.message.set('Saved both map.json copies. Reload the game tab to see it live.');
      } catch (e) {
        this.message.set(e instanceof Error ? e.message : 'Save failed');
      }
    } else {
      downloadMap(this.d());
      this.message.set(
        'Downloaded map.json — place it in infrastructure/lambda/ and run sync_map.py.',
      );
    }
  }
}
