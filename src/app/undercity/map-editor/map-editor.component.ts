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
import { MAT_TOOLTIP_DEFAULT_OPTIONS, MatTooltipModule } from '@angular/material/tooltip';
import { firstValueFrom } from 'rxjs';
import { BoardMap, BoardNode, MapDecal, MapLabel, RegionSpec } from '../engine/board-canvas';
import { STAMPS, drawStamp } from '../engine/board-terrain';
import { preloadAll } from '../engine/sprite-engine';
import { SPACE_ICONS, SPACE_NAMES } from '../data/items';
import { EditorCanvas, EditorPick } from './editor-canvas';
import { OVERWORLD } from '../engine/board-layers';
import { bossNode, defaultGate, lintMap, LintIssue } from './map-lint';
import {
  downloadMap,
  fsAccessSupported,
  listUndercityImages,
  pickRepoRoot,
  saveDecalImage,
  saveMap,
  serializeMap,
} from './file-io';

type Mode = 'select' | 'add' | 'connect' | 'decal' | 'label' | 'region';

const MODE_KEYS: Record<string, Mode> = {
  v: 'select',
  a: 'add',
  c: 'connect',
  d: 'decal',
  l: 'label',
  r: 'region',
};

const MODE_HINTS: Record<Mode, string> = {
  select: 'drag spaces, decals and labels · click to inspect',
  add: 'click empty ground to add a space — auto-links to the selected one',
  connect: 'click two spaces to toggle their path · switch layers mid-link to bridge ladders · Esc ends',
  decal: 'pick from the palette, then click to place · click a decal to edit',
  label: 'click empty ground to place a ghost title · drag to move',
  region: 'click spaces to gather them, then assign a region',
};

const SNAP = 25;
const DRAFT_KEY = 'undercity-map-editor-draft';

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
  imports: [CommonModule, FormsModule, MatIconModule, MatTooltipModule],
  providers: [
    {
      provide: MAT_TOOLTIP_DEFAULT_OPTIONS,
      // Snappy: the native title delay is what we're escaping.
      useValue: { showDelay: 80, hideDelay: 0, touchendHideDelay: 0, position: 'right' },
    },
  ],
  templateUrl: './map-editor.component.html',
  styleUrls: ['./map-editor.component.scss'],
})
export class MapEditorComponent implements AfterViewInit, OnDestroy {
  private readonly http = inject(HttpClient);

  @ViewChild('board') boardRef!: ElementRef<HTMLCanvasElement>;

  protected doc = signal<BoardMap | null>(null);
  protected readonly mode = signal<Mode>('select');
  protected readonly modeHints = MODE_HINTS;
  protected readonly layerId = signal('overworld');
  protected readonly layerIds = signal<string[]>(['overworld']);
  protected readonly showIds = signal(false);
  protected readonly snap = signal(false);
  protected readonly autoLink = signal(true);
  protected readonly message = signal<string | null>(null);
  private toastTimer: ReturnType<typeof setTimeout> | null = null;

  // Status bar readouts.
  protected readonly cursor = signal<{ x: number; y: number } | null>(null);
  protected readonly zoomPct = signal(100);
  protected readonly counts = computed(() => {
    const d = this.doc();
    if (!d) return null;
    return {
      nodes: d.nodes.length,
      decals: d.decals?.length ?? 0,
      labels: d.labels?.length ?? 0,
      regions: Object.keys(d.regions ?? {}).length,
    };
  });

  // Selection: one node, one decal, one label, or (region mode) a node set.
  protected readonly selNode = signal<string | null>(null);
  protected readonly selDecal = signal<number | null>(null);
  protected readonly selLabel = signal<number | null>(null);
  protected readonly selNodes = signal<Set<string>>(new Set());
  protected readonly connectFrom = signal<string | null>(null);

  // Palettes.
  protected readonly stampNames = Object.keys(STAMPS);
  protected stampThumbs: Record<string, string> = {};
  protected readonly images = signal<string[]>(SEED_IMAGES);
  protected readonly placingStamp = signal<string | null>(null);
  protected readonly placingImage = signal<string | null>(null);

  protected readonly typeNames = SPACE_NAMES;
  protected readonly typeIcons = SPACE_ICONS;
  protected readonly nodeTypes = Object.keys(SPACE_ICONS).filter((t) => t !== 'boss_sealed');

  protected readonly lint = signal<LintIssue[]>([]);
  protected readonly errorCount = computed(
    () => this.lint().filter((i) => i.level === 'error').length,
  );

  protected readonly canWriteInPlace = fsAccessSupported();
  private repoRoot: Awaited<ReturnType<typeof pickRepoRoot>> = null;
  protected readonly rootPicked = signal(false);
  protected readonly dirtySinceSave = signal(false);
  protected readonly draftAvailable = signal(false);

  private undoStack: string[] = [];
  private redoStack: string[] = [];
  private lastNudgeAt = 0;

  private canvas!: EditorCanvas;
  private drag: {
    kind: 'node' | 'decal' | 'label' | 'pan';
    id?: string;
    index?: number;
    lastX: number;
    lastY: number;
    moved: boolean;
    /** Middle-mouse pan: exclusively camera — never deselects on release. */
    camera?: boolean;
  } | null = null;

  protected readonly cursorStyle = signal('grab');

  /** Status-bar hint; while a link is pending it names the anchor space. */
  protected readonly statusHint = computed(() => {
    const from = this.connectFrom();
    if (this.mode() === 'connect' && from) {
      return `linking from "${from}" — click a space on any layer · Esc cancels`;
    }
    return MODE_HINTS[this.mode()];
  });

  private readonly keyHandler = (e: KeyboardEvent) => this.onKey(e);
  private readonly resizeHandler = () => this.canvas?.resize();
  private readonly unloadHandler = (e: BeforeUnloadEvent) => {
    if (this.dirtySinceSave()) e.preventDefault();
  };

  async ngAfterViewInit(): Promise<void> {
    await preloadAll(); // Material Icons font + sprites for glyph drawing
    this.canvas = new EditorCanvas(this.boardRef.nativeElement);
    this.canvas.resize();
    const doc = await firstValueFrom(this.http.get<BoardMap>('data/undercity-map.json'));
    doc.regions ??= {};
    doc.decals ??= [];
    doc.labels ??= [];
    this.doc.set(doc);
    this.canvas.setDoc(doc);
    this.canvas.setLayer('overworld');
    this.zoomPct.set(this.canvas.zoomPct());
    this.afterDocChange(false);
    this.renderStampThumbs();
    // A draft newer than the file survives reloads — offer it back.
    const draft = localStorage.getItem(DRAFT_KEY);
    this.draftAvailable.set(!!draft && draft !== serializeMap(doc));
    window.addEventListener('keydown', this.keyHandler);
    window.addEventListener('resize', this.resizeHandler);
    window.addEventListener('beforeunload', this.unloadHandler);
  }

  ngOnDestroy(): void {
    this.canvas?.destroy();
    window.removeEventListener('keydown', this.keyHandler);
    window.removeEventListener('resize', this.resizeHandler);
    window.removeEventListener('beforeunload', this.unloadHandler);
  }

  // ── Doc access + undo + drafts ───────────────────────────────────────────

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
    // The top-level gate/boss fields follow the typed nodes (gates are found
    // by type per region) — move or retype them freely and the file keeps up.
    const d = this.d();
    const gate = defaultGate(d);
    if (gate) d.gate = gate.id;
    const boss = bossNode(d);
    if (boss) d.boss = boss.id;
    this.canvas.invalidate();
    // Pocket layer ids shift with connectivity (they're named after a root
    // node). Follow the selected node's layer so an edit that creates or
    // renames a pocket never strands the view; otherwise stay put.
    const sel = this.selNode();
    const target = sel ? this.canvas.layerContaining(sel) : null;
    if (target && target !== this.canvas.activeLayer().id) {
      this.canvas.setLayer(target);
      this.zoomPct.set(this.canvas.zoomPct());
    }
    this.layerId.set(this.canvas.activeLayer().id);
    this.layerIds.set(this.canvas.layerIds());
    this.lint.set(lintMap(this.d()));
    if (markDirty) {
      this.dirtySinceSave.set(true);
      localStorage.setItem(DRAFT_KEY, serializeMap(this.d()));
    }
    this.syncOverlay();
  }

  protected restoreDraft(): void {
    const draft = localStorage.getItem(DRAFT_KEY);
    if (!draft) return;
    this.snapshot();
    this.restore(draft);
    this.dirtySinceSave.set(true);
    this.draftAvailable.set(false);
    this.toast('Draft restored — unsaved edits from your last session are back.');
  }

  protected discardDraft(): void {
    localStorage.removeItem(DRAFT_KEY);
    this.draftAvailable.set(false);
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

  private toast(text: string): void {
    this.message.set(text);
    if (this.toastTimer) clearTimeout(this.toastTimer);
    this.toastTimer = setTimeout(() => this.message.set(null), 4500);
  }

  // ── Pointer handling ─────────────────────────────────────────────────────

  private applySnap(v: number): number {
    return this.snap() ? Math.round(v / SNAP) * SNAP : Math.round(v);
  }

  onPointerDown(e: PointerEvent): void {
    (e.target as HTMLElement).setPointerCapture(e.pointerId);
    // Middle mouse is always the camera — never grabs, places, or connects.
    if (e.button === 1) {
      e.preventDefault(); // no browser autoscroll
      this.drag = { kind: 'pan', lastX: e.clientX, lastY: e.clientY, moved: false, camera: true };
      return;
    }
    const w = this.canvas.toWorld(e.clientX, e.clientY);
    const pick = this.canvas.pick(w.x, w.y);
    const mode = this.mode();

    if (mode === 'select' && pick) {
      this.applyPick(pick);
      this.snapshot(); // gesture may become a move; harmless if it doesn't
      this.drag = {
        kind: pick.kind,
        id: pick.kind === 'node' ? pick.id : undefined,
        index: pick.kind === 'decal' || pick.kind === 'label' ? pick.index : undefined,
        lastX: e.clientX,
        lastY: e.clientY,
        moved: false,
      };
      return;
    }
    if (mode === 'label') {
      if (pick?.kind === 'label') {
        this.applyPick(pick);
        this.snapshot();
        this.drag = {
          kind: 'label',
          index: pick.index,
          lastX: e.clientX,
          lastY: e.clientY,
          moved: false,
        };
      } else if (!pick) {
        this.placeLabelAt(w.x, w.y);
      }
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
      this.drag = {
        kind: 'decal',
        index: pick.index,
        lastX: e.clientX,
        lastY: e.clientY,
        moved: false,
      };
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
    this.cursor.set({ x: Math.round(w.x), y: Math.round(w.y) });

    if (!this.drag) {
      // Hover feedback: ring/outline + tooltip + cursor affordance.
      const pick = this.canvas.pick(w.x, w.y);
      this.canvas.overlay.hover = pick;
      this.canvas.overlay.cursor = w;
      this.canvas.overlay.tooltip = this.tooltipFor(pick);
      if (this.mode() === 'connect') {
        const from = this.connectFrom();
        this.canvas.overlay.connectTarget =
          pick?.kind === 'node' && pick.id !== from ? pick.id : null;
        if (from && pick?.kind === 'node') {
          const a = this.d().nodes.find((n) => n.id === from);
          this.canvas.overlay.connectRemoves = !!a?.neighbors.includes(pick.id);
        }
      }
      this.cursorStyle.set(this.cursorFor(pick));
      return;
    }

    const dx = e.clientX - this.drag.lastX;
    const dy = e.clientY - this.drag.lastY;
    this.drag.lastX = e.clientX;
    this.drag.lastY = e.clientY;
    if (dx === 0 && dy === 0) return;
    const firstMove = !this.drag.moved;
    this.drag.moved = true;

    if (this.drag.kind === 'pan') {
      // Grab-the-map: the world follows the cursor.
      this.canvas.panByScreen(dx, dy);
    } else if (this.drag.kind === 'node' && this.drag.id) {
      if (firstMove) this.canvas.beginNodeDrag(this.drag.id);
      const n = this.d().nodes.find((x) => x.id === this.drag!.id);
      if (n) {
        n.x = this.applySnap(w.x);
        n.y = this.applySnap(w.y);
      }
    } else if (this.drag.kind === 'decal' && this.drag.index !== undefined) {
      const d = this.d().decals?.[this.drag.index];
      if (d) {
        d.x = this.applySnap(w.x);
        d.y = this.applySnap(w.y);
      }
    } else if (this.drag.kind === 'label' && this.drag.index !== undefined) {
      const l = this.d().labels?.[this.drag.index];
      if (l) {
        l.x = this.applySnap(w.x);
        l.y = this.applySnap(w.y);
      }
    }
  }

  onPointerUp(): void {
    if (!this.drag) return;
    const wasEdit = this.drag.kind !== 'pan';
    const moved = this.drag.moved;
    const cameraOnly = this.drag.camera === true;
    this.drag = null;
    if (wasEdit) {
      if (moved) {
        this.afterDocChange(); // re-drape path ribbons under the moved thing
      } else {
        this.undoStack.pop(); // gesture was just a click — drop the snapshot
      }
    } else if (!moved && !cameraOnly) {
      // A plain click on empty ground (no pan) deselects; region mode keeps
      // its gathered set so a stray click can't nuke a multi-pick.
      this.selNode.set(null);
      this.selDecal.set(null);
      this.selLabel.set(null);
      this.connectFrom.set(null);
      this.syncOverlay();
    }
  }

  onPointerLeave(): void {
    this.cursor.set(null);
    this.canvas.overlay.hover = null;
    this.canvas.overlay.tooltip = null;
  }

  onWheel(e: WheelEvent): void {
    e.preventDefault();
    this.canvas.zoomAt(e.clientX, e.clientY, e.deltaY < 0 ? 1.15 : 1 / 1.15);
    this.zoomPct.set(this.canvas.zoomPct());
  }

  private tooltipFor(pick: EditorPick): { x: number; y: number; lines: string[] } | null {
    if (!pick) return null;
    const w = this.cursor();
    if (!w) return null;
    if (pick.kind === 'node') {
      const n = this.d().nodes.find((x) => x.id === pick.id);
      if (!n) return null;
      return {
        x: w.x,
        y: w.y,
        lines: [n.id, `${this.typeNames[n.type] || n.type} · ${n.region ?? '—'}`],
      };
    }
    if (pick.kind === 'label') {
      const l = this.d().labels?.[pick.index];
      return l ? { x: w.x, y: w.y, lines: [`“${l.text}”`, 'label'] } : null;
    }
    const d = this.d().decals?.[pick.index];
    if (!d) return null;
    return {
      x: w.x,
      y: w.y,
      lines: [d.kind === 'stamp' ? (d.stamp ?? 'stamp') : (d.src ?? 'image'), `decal · ${d.layer}`],
    };
  }

  private cursorFor(pick: EditorPick): string {
    const mode = this.mode();
    if (mode === 'add' || (mode === 'decal' && (this.placingStamp() || this.placingImage()))) {
      return 'crosshair';
    }
    if (mode === 'label' && !pick) return 'crosshair';
    if (pick) return mode === 'connect' && pick.kind !== 'node' ? 'grab' : 'pointer';
    return 'grab';
  }

  private applyPick(pick: EditorPick): void {
    if (pick?.kind === 'node') {
      this.selNode.set(pick.id);
      this.selDecal.set(null);
      this.selLabel.set(null);
    } else if (pick?.kind === 'decal') {
      this.selDecal.set(pick.index);
      this.selNode.set(null);
      this.selLabel.set(null);
    } else if (pick?.kind === 'label') {
      this.selLabel.set(pick.index);
      this.selNode.set(null);
      this.selDecal.set(null);
    }
    this.syncOverlay();
  }

  protected clearSelection(): void {
    this.selNode.set(null);
    this.selDecal.set(null);
    this.selLabel.set(null);
    this.selNodes.set(new Set());
    this.connectFrom.set(null);
    this.syncOverlay();
  }

  private syncOverlay(): void {
    if (!this.canvas) return;
    const prev = this.canvas.overlay;
    this.canvas.overlay = {
      ...prev,
      selectedNode: this.selNode(),
      selectedNodes: this.selNodes(),
      selectedDecal: this.selDecal(),
      selectedLabel: this.selLabel(),
      connectFrom: this.connectFrom(),
      showIds: this.showIds(),
      grid: this.snap() ? 100 : 0,
    };
  }

  private onKey(e: KeyboardEvent): void {
    const tag = (e.target as HTMLElement).tagName;
    if (tag === 'INPUT' || tag === 'SELECT' || tag === 'TEXTAREA') return;

    const key = e.key.toLowerCase();
    if (!e.ctrlKey && !e.metaKey && !e.altKey && MODE_KEYS[key]) {
      this.setMode(MODE_KEYS[key]);
      return;
    }
    if (e.key === 'Escape') {
      this.placingStamp.set(null);
      this.placingImage.set(null);
      this.clearSelection();
    } else if (e.key === 'Delete' || e.key === 'Backspace') {
      this.deleteSelection();
    } else if (e.key.startsWith('Arrow')) {
      this.nudge(e);
    } else if (!e.ctrlKey && (e.key === '+' || e.key === '=')) {
      this.zoomIn();
    } else if (!e.ctrlKey && e.key === '-') {
      this.zoomOut();
    } else if (key === 'f' || e.key === '0') {
      this.fitView();
    } else if (key === 'g') {
      this.toggleSnap();
    } else if (key === 'i') {
      this.toggleIds();
    } else if (e.ctrlKey && !e.shiftKey && key === 'z') {
      e.preventDefault();
      this.undo();
    } else if ((e.ctrlKey && e.shiftKey && key === 'z') || (e.ctrlKey && key === 'y')) {
      e.preventDefault();
      this.redo();
    } else if (e.ctrlKey && key === 's') {
      e.preventDefault();
      void this.save();
    } else if (e.ctrlKey && key === 'd') {
      e.preventDefault();
      this.duplicateSelection();
    }
  }

  /** Arrow keys move the selection; Shift = coarse. Bursts share one undo. */
  private nudge(e: KeyboardEvent): void {
    const step = e.shiftKey ? 20 : 2;
    const dx = e.key === 'ArrowLeft' ? -step : e.key === 'ArrowRight' ? step : 0;
    const dy = e.key === 'ArrowUp' ? -step : e.key === 'ArrowDown' ? step : 0;
    const target: { x: number; y: number } | undefined | null = this.selNode()
      ? this.d().nodes.find((n) => n.id === this.selNode())
      : this.selDecal() !== null
        ? this.d().decals?.[this.selDecal()!]
        : this.selLabel() !== null
          ? this.d().labels?.[this.selLabel()!]
          : null;
    if (!target || (!dx && !dy)) return;
    e.preventDefault();
    const now = Date.now();
    if (now - this.lastNudgeAt > 800) this.snapshot();
    this.lastNudgeAt = now;
    target.x += dx;
    target.y += dy;
    this.afterDocChange();
  }

  private duplicateSelection(): void {
    if (this.selDecal() !== null) {
      const src = this.d().decals?.[this.selDecal()!];
      if (!src) return;
      this.snapshot();
      const copy: MapDecal = { ...src, x: src.x + 40, y: src.y + 30 };
      if (copy.kind === 'stamp') copy.seed = Math.floor(Math.random() * 1e6);
      this.d().decals!.push(copy);
      this.selDecal.set(this.d().decals!.length - 1);
      this.afterDocChange();
    } else if (this.selLabel() !== null) {
      const src = this.d().labels?.[this.selLabel()!];
      if (!src) return;
      this.snapshot();
      this.d().labels!.push({ ...src, x: src.x + 40, y: src.y + 30 });
      this.selLabel.set(this.d().labels!.length - 1);
      this.afterDocChange();
    }
  }

  // ── Modes + view helpers ─────────────────────────────────────────────────

  protected setMode(m: Mode): void {
    this.mode.set(m);
    this.placingStamp.set(null);
    this.placingImage.set(null);
    this.connectFrom.set(null);
    this.canvas.overlay.cursor = null;
    this.canvas.overlay.connectTarget = null;
    this.syncOverlay();
  }

  protected setLayer(id: string): void {
    this.layerId.set(id);
    this.canvas.setLayer(id);
    this.zoomPct.set(this.canvas.zoomPct());
  }

  protected toggleIds(): void {
    this.showIds.update((v) => !v);
    this.syncOverlay();
  }

  protected toggleSnap(): void {
    this.snap.update((v) => !v);
    this.syncOverlay();
  }

  protected toggleAutoLink(): void {
    this.autoLink.update((v) => !v);
  }

  protected zoomIn(): void {
    this.canvas.zoomBy(1.25);
    this.zoomPct.set(this.canvas.zoomPct());
  }

  protected zoomOut(): void {
    this.canvas.zoomBy(1 / 1.25);
    this.zoomPct.set(this.canvas.zoomPct());
  }

  protected fitView(): void {
    this.canvas.fitView();
    this.zoomPct.set(this.canvas.zoomPct());
  }

  protected selectedNode(): BoardNode | null {
    const id = this.selNode();
    return id ? (this.d().nodes.find((n) => n.id === id) ?? null) : null;
  }

  protected selectedDecal(): MapDecal | null {
    const i = this.selDecal();
    return i === null ? null : (this.d().decals?.[i] ?? null);
  }

  protected selectedLabel(): MapLabel | null {
    const i = this.selLabel();
    return i === null ? null : (this.d().labels?.[i] ?? null);
  }

  protected focusIssue(issue: LintIssue): void {
    if (!issue.nodeId) return;
    this.jumpToNode(issue.nodeId);
  }

  /** Select a node and glide the camera to it (also used by neighbor chips). */
  protected jumpToNode(id: string): void {
    const n = this.d().nodes.find((x) => x.id === id);
    if (!n) return;
    // A ladder's partner (or a lint hit) may live on another layer — follow.
    const layer = this.canvas.layerContaining(id);
    if (layer && layer !== this.canvas.activeLayer().id) {
      this.canvas.setLayer(layer);
      this.layerId.set(layer);
      this.zoomPct.set(this.canvas.zoomPct());
    }
    this.selNode.set(n.id);
    this.selDecal.set(null);
    this.selLabel.set(null);
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
      x: this.applySnap(x),
      y: this.applySnap(y),
      region,
      neighbors: [],
    };
    // Chain building: link the fresh space to the current selection so
    // clicking along a route lays a connected path in one pass.
    const prev = this.autoLink() ? this.selectedNode() : null;
    if (prev && layer.nodeIds.has(prev.id)) {
      node.neighbors.push(prev.id);
      prev.neighbors.push(node.id);
    } else if (layer.id !== OVERWORLD) {
      // Pockets are defined by connectivity — an unlinked space would become
      // its own invisible layer. Tether it to the nearest space here instead.
      let best: BoardNode | null = null;
      let bd = Infinity;
      for (const n of doc.nodes) {
        if (!layer.nodeIds.has(n.id)) continue;
        const dist = (n.x - node.x) ** 2 + (n.y - node.y) ** 2;
        if (dist < bd) {
          bd = dist;
          best = n;
        }
      }
      if (best) {
        node.neighbors.push(best.id);
        best.neighbors.push(node.id);
      }
    }
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
      // Chain: the node just clicked becomes the next path's start.
      this.connectFrom.set(id);
    } else {
      this.connectFrom.set(null);
    }
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
    } else if (this.selLabel() !== null) {
      this.snapshot();
      this.d().labels!.splice(this.selLabel()!, 1);
      this.selLabel.set(null);
      this.afterDocChange();
    }
  }

  protected renameNode(n: BoardNode, raw: string): void {
    const id = raw.trim();
    if (!id || id === n.id) return;
    const doc = this.d();
    if (doc.nodes.some((x) => x.id === id)) {
      this.toast(`A node called "${id}" already exists.`);
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

  protected unlink(n: BoardNode, nb: string): void {
    this.snapshot();
    n.neighbors = n.neighbors.filter((x) => x !== nb);
    const other = this.d().nodes.find((x) => x.id === nb);
    if (other) other.neighbors = other.neighbors.filter((x) => x !== n.id);
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
      drawStamp(ctx, name, 36, 58, 0.6, 0, 7);
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

  /**
   * Upload art straight into the repo: each file is written to
   * public/undercity/decals/ via the granted folder handle, joins the
   * palette, and the first one is armed for placement.
   */
  protected async onUpload(input: HTMLInputElement): Promise<void> {
    const files = [...(input.files ?? [])];
    input.value = '';
    if (!files.length) return;
    if (!this.repoRoot) {
      this.toast('Grant the repo folder first — uploads save into public/undercity/decals/.');
      return;
    }
    const added: string[] = [];
    for (const f of files) {
      try {
        added.push(await saveDecalImage(this.repoRoot, f));
      } catch (e) {
        this.toast(`Couldn't save ${f.name}: ${e instanceof Error ? e.message : 'write failed'}`);
      }
    }
    if (added.length) {
      this.images.update((list) => [...new Set([...list, ...added])].sort());
      this.placingImage.set(added[0]);
      this.placingStamp.set(null);
      this.toast(
        `Saved ${added.length === 1 ? added[0] : added.length + ' images'} — click the board to place.`,
      );
    }
  }

  private placeDecalAt(x: number, y: number): void {
    this.snapshot();
    const doc = this.d();
    const decal: MapDecal = this.placingStamp()
      ? {
          kind: 'stamp',
          stamp: this.placingStamp()!,
          x: this.applySnap(x),
          y: this.applySnap(y),
          scale: 1,
          rot: 0,
          layer: 'under',
          seed: Math.floor(Math.random() * 1e6),
        }
      : {
          kind: 'image',
          src: this.placingImage()!,
          x: this.applySnap(x),
          y: this.applySnap(y),
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

  // ── Labels ───────────────────────────────────────────────────────────────

  private placeLabelAt(x: number, y: number): void {
    this.snapshot();
    const label: MapLabel = {
      text: 'New Label',
      x: this.applySnap(x),
      y: this.applySnap(y),
      size: 46,
      rot: 0,
      alpha: 0.16,
    };
    this.d().labels!.push(label);
    this.selLabel.set(this.d().labels!.length - 1);
    this.afterDocChange();
  }

  protected updateLabel(l: MapLabel, patch: Partial<MapLabel>): void {
    this.snapshot();
    Object.assign(l, patch);
    this.afterDocChange();
  }

  protected labelRotDeg(l: MapLabel): number {
    return Math.round((l.rot * 180) / Math.PI);
  }

  // ── Regions ──────────────────────────────────────────────────────────────

  protected regionIds(): string[] {
    return Object.keys(this.d().regions ?? {});
  }

  /** Regions split into surface (overworld) and underground (dark pockets). */
  protected surfaceRegions(): string[] {
    return this.regionIds().filter((r) => !this.region(r).dark);
  }

  protected undergroundRegions(): string[] {
    return this.regionIds().filter((r) => this.region(r).dark);
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
      this.toast('Region ids are lowercase letters, digits, underscores.');
      return;
    }
    const doc = this.d();
    if (doc.regions![id]) {
      this.toast(`Region "${id}" already exists.`);
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
      this.toast('Repo folder granted — Ctrl+S writes both map copies.');
      try {
        this.images.set(await listUndercityImages(this.repoRoot));
      } catch {
        /* keep the seed list */
      }
    } else {
      this.toast("That folder isn't the repo root (map.json copies not found).");
    }
  }

  /** Ctrl+S: overwrite the repo copies when granted, else fall back to download. */
  protected async save(): Promise<void> {
    if (this.repoRoot) await this.saveToRepo();
    else this.download();
  }

  /** Overwrite both checked-in map.json copies in place. Lint-gated. */
  protected async saveToRepo(): Promise<void> {
    if (this.errorCount() > 0) {
      this.toast(`Fix ${this.errorCount()} error(s) before saving.`);
      return;
    }
    if (!this.repoRoot) return;
    try {
      await saveMap(this.repoRoot, this.d());
      this.dirtySinceSave.set(false);
      localStorage.removeItem(DRAFT_KEY);
      this.toast('Saved both map.json copies. Reload the game tab to see it live.');
    } catch (e) {
      this.toast(e instanceof Error ? e.message : 'Save failed');
    }
  }

  /** Export a map.json copy — always available, even mid-lint-errors. */
  protected download(): void {
    downloadMap(this.d());
    this.toast(
      this.rootPicked()
        ? 'Downloaded a map.json copy (the repo files are untouched).'
        : 'Downloaded map.json — place it in infrastructure/lambda/ and run sync_map.py.',
    );
  }
}
