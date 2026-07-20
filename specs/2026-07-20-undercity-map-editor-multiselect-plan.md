# Map Editor Multi-select Tool Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add a dedicated `multi` mode to the Undercity map editor that marquee/click-selects many nodes and moves them as a group.

**Architecture:** Reuse the existing `selNodes: Set<string>` signal (already rendered by `EditorCanvas.overlay.selectedNodes`). The component gains a new mode with marquee + click selection and group drag/nudge; `EditorCanvas` gains marquee rendering and set-based mid-drag path lines; `renderTerrain`'s `omitEdgesOf` is generalized from a single id to a set.

**Tech Stack:** Angular 20 standalone component, signals, HTML canvas 2D. Spec: `specs/2026-07-20-undercity-map-editor-multiselect-design.md`.

**Testing note:** This repo has **no frontend test runner** (CLAUDE.md: Karma/Jasmine removed, no `ng test`). Each task is verified by `npm run build` (dev build, must stay green) plus the manual checklist in Task 6. Commit after each task.

---

## File Structure

- `src/app/undercity/engine/board-terrain.ts` — `renderTerrain` opts: `omitEdgesOf` accepts `string | ReadonlySet<string>`.
- `src/app/undercity/map-editor/editor-canvas.ts` — set-based drag omit (`dragNodes` + `beginGroupDrag`), `nodesInRect`, `marquee` overlay field + draw.
- `src/app/undercity/map-editor/map-editor.component.ts` — `multi` mode, drag-state union, pointer handling, group move, `nudge` extension, cursor.
- `src/app/undercity/map-editor/map-editor.component.html` — toolbar button + panel section.

---

## Task 1: Generalize `renderTerrain` edge-omit to a set

**Files:**
- Modify: `src/app/undercity/engine/board-terrain.ts` (the `renderTerrain` signature + edge filter, around lines 681–714)

- [ ] **Step 1: Widen the `omitEdgesOf` option type**

In the `renderTerrain` signature, change the opts type:

```ts
export function renderTerrain(
  map: BoardMap,
  floors?: FloorTextures,
  landmarkArt?: LandmarkTextures,
  layer?: LayerSpec,
  opts?: { cleared?: boolean; omitEdgesOf?: string | ReadonlySet<string>; omitLabels?: boolean },
): TerrainArt {
```

- [ ] **Step 2: Update the edge filter to handle both string and set**

Replace the existing `omit` block (currently):

```ts
  const omit = opts?.omitEdgesOf;
  const curves = allCurves.filter(
    (c) => inLayer(c.a) && inLayer(c.b) && c.a.id !== omit && c.b.id !== omit,
  );
```

with:

```ts
  // omitEdgesOf: the map editor bakes terrain without a mid-drag node's (or a
  // dragged group's) ribbons and draws live lines instead, so paths never
  // detach from discs. Accepts a single id or a set of ids.
  const omit = opts?.omitEdgesOf;
  const omitted =
    typeof omit === 'string'
      ? (id: string) => id === omit
      : omit
        ? (id: string) => omit.has(id)
        : () => false;
  const curves = allCurves.filter(
    (c) => inLayer(c.a) && inLayer(c.b) && !omitted(c.a.id) && !omitted(c.b.id),
  );
```

- [ ] **Step 3: Build to verify no type errors**

Run: `npm run build`
Expected: build succeeds (no TS errors). Existing callers pass a `string`, which still type-checks.

- [ ] **Step 4: Commit**

```bash
git add src/app/undercity/engine/board-terrain.ts
git commit -m "refactor(undercity): renderTerrain omitEdgesOf accepts a node set"
```

---

## Task 2: EditorCanvas — set-based drag, rect query, marquee draw

**Files:**
- Modify: `src/app/undercity/map-editor/editor-canvas.ts`

- [ ] **Step 1: Add the `marquee` overlay field**

In the `EditorOverlay` interface, add after the `grid` field:

```ts
  /** Multi-select marquee rectangle (world-space), drawn while dragging. */
  marquee?: { x: number; y: number; w: number; h: number } | null;
```

- [ ] **Step 2: Replace the single `dragNode` with a set**

Change the field declaration (currently `private dragNode: string | null = null;`) to:

```ts
  private dragNodes: ReadonlySet<string> = new Set();
```

- [ ] **Step 3: Reset the set in `invalidate()`**

In `invalidate()`, change `this.dragNode = null;` to:

```ts
    this.dragNodes = new Set();
```

- [ ] **Step 4: Generalize `beginNodeDrag` and add `beginGroupDrag`**

Replace the whole `beginNodeDrag` method with:

```ts
  /**
   * A node drag is starting: bake the active layer's terrain once WITHOUT the
   * dragged node's path ribbons, then track its edges as live lines each frame
   * so paths stay attached to the disc. invalidate() (on drop) restores them.
   */
  beginNodeDrag(id: string): void {
    this.beginGroupDrag(new Set([id]));
  }

  /** Same as beginNodeDrag, but for a whole moving group of nodes. */
  beginGroupDrag(ids: ReadonlySet<string>): void {
    this.dragNodes = ids;
    const layer = this.activeLayer();
    this.terrain.set(
      layer.id,
      renderTerrain(this.doc, this.floorTex, this.landmarkTex, layer, {
        omitEdgesOf: ids,
        omitLabels: true,
      }),
    );
  }
```

- [ ] **Step 5: Add `nodesInRect` for marquee hit-testing**

Add this method near `pick()`:

```ts
  /** Active-layer node ids whose center falls inside a world-space rectangle. */
  nodesInRect(r: { x: number; y: number; w: number; h: number }): string[] {
    const layer = this.activeLayer();
    return this.doc.nodes
      .filter(
        (n) =>
          layer.nodeIds.has(n.id) &&
          n.x >= r.x &&
          n.x <= r.x + r.w &&
          n.y >= r.y &&
          n.y <= r.y + r.h,
      )
      .map((n) => n.id);
  }
```

- [ ] **Step 6: Generalize the live-line pass to the set**

In `frame()`, replace the single-node live-line block (currently `if (this.dragNode) { const n = ...; ... }`) with:

```ts
    // Live path lines for mid-drag nodes (their baked ribbons are omitted).
    if (this.dragNodes.size) {
      ctx.save();
      ctx.lineCap = 'round';
      for (const id of this.dragNodes) {
        const n = this.doc.nodes.find((x) => x.id === id);
        if (!n) continue;
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
      }
      ctx.restore();
    }
```

- [ ] **Step 7: Draw the marquee rectangle**

In `frame()`, immediately before the closing `}` of the method (after the tooltip block), add:

```ts
    // Multi-select marquee.
    if (o.marquee) {
      const m = o.marquee;
      ctx.save();
      ctx.fillStyle = 'rgba(251, 191, 36, 0.10)';
      ctx.strokeStyle = 'rgba(251, 191, 36, 0.9)';
      ctx.lineWidth = 1.5 / this.zoom;
      ctx.setLineDash([6 / this.zoom, 4 / this.zoom]);
      ctx.fillRect(m.x, m.y, m.w, m.h);
      ctx.strokeRect(m.x, m.y, m.w, m.h);
      ctx.setLineDash([]);
      ctx.restore();
    }
```

- [ ] **Step 8: Build to verify**

Run: `npm run build`
Expected: build succeeds.

- [ ] **Step 9: Commit**

```bash
git add src/app/undercity/map-editor/editor-canvas.ts
git commit -m "feat(undercity): editor canvas supports group drag + marquee draw"
```

---

## Task 3: Component — `multi` mode, pointer handling, group move

**Files:**
- Modify: `src/app/undercity/map-editor/map-editor.component.ts`

- [ ] **Step 1: Add `multi` to the mode type, keys, and hints**

Change the `Mode` type:

```ts
type Mode = 'select' | 'add' | 'connect' | 'decal' | 'label' | 'region' | 'multi';
```

Add to `MODE_KEYS`:

```ts
  m: 'multi',
```

Add to `MODE_HINTS`:

```ts
  multi: 'drag a box to grab spaces · click a space to toggle · drag a picked space to move the group',
```

- [ ] **Step 2: Extend the drag-state type**

Replace the `private drag: {...} | null = null;` declaration with:

```ts
  private drag: {
    kind: 'node' | 'decal' | 'label' | 'pan' | 'group' | 'marquee';
    id?: string;
    index?: number;
    lastX: number;
    lastY: number;
    moved: boolean;
    /** Middle-mouse pan: exclusively camera — never deselects on release. */
    camera?: boolean;
    /** group: was the pressed node already selected? (click toggles it off) */
    wasSelected?: boolean;
    /** group/marquee: Shift held — union instead of replace. */
    additive?: boolean;
    /** group: world-space anchor + per-node origin, for drift-free moves. */
    startWX?: number;
    startWY?: number;
    origin?: Map<string, { x: number; y: number }>;
  } | null = null;
```

- [ ] **Step 3: Add the `multi` branch to `onPointerDown`**

Insert this block in `onPointerDown`, immediately before the final `// Empty ground (any mode): pan.` comment:

```ts
    if (mode === 'multi') {
      if (pick?.kind === 'node') {
        this.snapshot(); // gesture may become a group move; dropped if a click
        this.drag = {
          kind: 'group',
          id: pick.id,
          wasSelected: this.selNodes().has(pick.id),
          additive: e.shiftKey,
          startWX: w.x,
          startWY: w.y,
          lastX: e.clientX,
          lastY: e.clientY,
          moved: false,
        };
        return;
      }
      // Empty ground: start a marquee (Shift = add to the current set).
      this.drag = {
        kind: 'marquee',
        additive: e.shiftKey,
        startWX: w.x,
        startWY: w.y,
        lastX: e.clientX,
        lastY: e.clientY,
        moved: false,
      };
      return;
    }
```

- [ ] **Step 4: Add group + marquee handling to `onPointerMove`**

In `onPointerMove`, after the `this.drag.moved = true;` line and before the `if (this.drag.kind === 'pan')` chain, add:

```ts
    if (this.drag.kind === 'marquee') {
      const x0 = this.drag.startWX!;
      const y0 = this.drag.startWY!;
      this.canvas.overlay.marquee = {
        x: Math.min(x0, w.x),
        y: Math.min(y0, w.y),
        w: Math.abs(w.x - x0),
        h: Math.abs(w.y - y0),
      };
      return;
    }
    if (this.drag.kind === 'group') {
      if (firstMove) {
        // First movement locks in the moving set. Grabbing an unpicked node
        // replaces the selection (or adds it with Shift); grabbing a picked
        // one keeps the whole current group.
        if (!this.drag.wasSelected) {
          const set = this.drag.additive ? new Set(this.selNodes()) : new Set<string>();
          set.add(this.drag.id!);
          this.selNodes.set(set);
        }
        this.selNode.set(null);
        const origin = new Map<string, { x: number; y: number }>();
        for (const n of this.d().nodes) {
          if (this.selNodes().has(n.id)) origin.set(n.id, { x: n.x, y: n.y });
        }
        this.drag.origin = origin;
        this.canvas.beginGroupDrag(this.selNodes());
        this.syncOverlay();
      }
      const totalDx = w.x - this.drag.startWX!;
      const totalDy = w.y - this.drag.startWY!;
      for (const n of this.d().nodes) {
        const o = this.drag.origin!.get(n.id);
        if (!o) continue;
        n.x = this.applySnap(o.x + totalDx);
        n.y = this.applySnap(o.y + totalDy);
      }
      return;
    }
```

- [ ] **Step 5: Handle group + marquee release in `onPointerUp`**

At the very top of `onPointerUp()`, after the `if (!this.drag) return;` guard, add:

```ts
    if (this.drag.kind === 'marquee') {
      const moved = this.drag.moved;
      const additive = this.drag.additive === true;
      const box = this.canvas.overlay.marquee;
      this.drag = null;
      this.canvas.overlay.marquee = null;
      if (moved && box) {
        const set = additive ? new Set(this.selNodes()) : new Set<string>();
        for (const id of this.canvas.nodesInRect(box)) set.add(id);
        this.selNodes.set(set);
        this.selNode.set(null);
      } else {
        // A plain click on empty ground clears the multi-selection.
        this.selNodes.set(new Set());
      }
      this.syncOverlay();
      return;
    }
    if (this.drag.kind === 'group') {
      const moved = this.drag.moved;
      const id = this.drag.id!;
      const wasSelected = this.drag.wasSelected === true;
      this.drag = null;
      if (moved) {
        this.afterDocChange(); // re-drape ribbons for the whole group
      } else {
        this.undoStack.pop(); // gesture was a click — drop the snapshot
        const set = new Set(this.selNodes());
        if (wasSelected) set.delete(id);
        else set.add(id);
        this.selNodes.set(set);
        this.selNode.set(null);
        this.syncOverlay();
      }
      return;
    }
```

- [ ] **Step 6: Give `multi` mode a cursor affordance**

In `cursorFor`, add before the final `return 'grab';`:

```ts
    if (mode === 'multi') return pick?.kind === 'node' ? 'move' : 'crosshair';
```

- [ ] **Step 7: Build to verify**

Run: `npm run build`
Expected: build succeeds.

- [ ] **Step 8: Commit**

```bash
git add src/app/undercity/map-editor/map-editor.component.ts
git commit -m "feat(undercity): multi-select mode with marquee + group move"
```

---

## Task 4: Component — group arrow-key nudge

**Files:**
- Modify: `src/app/undercity/map-editor/map-editor.component.ts` (the `nudge` method)

- [ ] **Step 1: Add a multi-group branch to `nudge`**

Replace the whole `nudge` method with:

```ts
  /** Arrow keys move the selection; Shift = coarse. Bursts share one undo. */
  private nudge(e: KeyboardEvent): void {
    const step = e.shiftKey ? 20 : 2;
    const dx = e.key === 'ArrowLeft' ? -step : e.key === 'ArrowRight' ? step : 0;
    const dy = e.key === 'ArrowUp' ? -step : e.key === 'ArrowDown' ? step : 0;
    if (!dx && !dy) return;

    // Multi mode with a group: shift every selected space together.
    if (this.mode() === 'multi' && this.selNodes().size) {
      e.preventDefault();
      const now = Date.now();
      if (now - this.lastNudgeAt > 800) this.snapshot();
      this.lastNudgeAt = now;
      const sel = this.selNodes();
      for (const n of this.d().nodes) {
        if (sel.has(n.id)) {
          n.x += dx;
          n.y += dy;
        }
      }
      this.afterDocChange();
      return;
    }

    const target: { x: number; y: number } | undefined | null = this.selNode()
      ? this.d().nodes.find((n) => n.id === this.selNode())
      : this.selDecal() !== null
        ? this.d().decals?.[this.selDecal()!]
        : this.selLabel() !== null
          ? this.d().labels?.[this.selLabel()!]
          : null;
    if (!target) return;
    e.preventDefault();
    const now = Date.now();
    if (now - this.lastNudgeAt > 800) this.snapshot();
    this.lastNudgeAt = now;
    target.x += dx;
    target.y += dy;
    this.afterDocChange();
  }
```

- [ ] **Step 2: Build to verify**

Run: `npm run build`
Expected: build succeeds.

- [ ] **Step 3: Commit**

```bash
git add src/app/undercity/map-editor/map-editor.component.ts
git commit -m "feat(undercity): arrow-key nudge moves the multi-select group"
```

---

## Task 5: HTML — toolbar button + panel section

**Files:**
- Modify: `src/app/undercity/map-editor/map-editor.component.html`

- [ ] **Step 1: Add the Multi toolbar button**

In the `.modes` div, add after the Region button (`</button>` closing the region one, before the closing `</div>` of `.modes`):

```html
      <button [class.on]="mode() === 'multi'" (click)="setMode('multi')" matTooltip="Marquee-select spaces and move them as a group">
        <mat-icon>select_all</mat-icon><span>Multi</span><kbd>M</kbd>
      </button>
```

- [ ] **Step 2: Add the multi-select panel section**

In the `<aside class="panel">`, add before the `<!-- ── Lint ── -->` comment:

```html
      <!-- ── Multi-select tool ── -->
      @if (mode() === 'multi') {
        <section>
          <h3><mat-icon class="mi">select_all</mat-icon> Multi-select</h3>
          <p class="hint">
            Drag a box to grab spaces (Shift-drag adds). Click a space to toggle it.
            Drag a selected space — or use the arrow keys — to move the whole group.
          </p>
          <p class="hint center"><b>{{ selNodes().size }}</b> space(s) selected</p>
          <button (click)="clearSelection()" [disabled]="!selNodes().size">
            <mat-icon class="mi">deselect</mat-icon> Clear selection
          </button>
        </section>
      }
```

- [ ] **Step 3: Build to verify**

Run: `npm run build`
Expected: build succeeds.

- [ ] **Step 4: Commit**

```bash
git add src/app/undercity/map-editor/map-editor.component.html
git commit -m "feat(undercity): multi-select toolbar button + panel"
```

---

## Task 6: Manual verification

**Files:** none (verification only)

- [ ] **Step 1: Production-parity build stays green**

Run: `npm run build`
Expected: succeeds with no errors.

- [ ] **Step 2: Drive the editor**

Run `npm start`, open `http://localhost:4200/undercity/map-editor`, and confirm each:

1. Press `M` (or click **Multi**) — the tool activates; status hint shows the multi hint.
2. Drag a rectangle over a cluster of spaces on empty ground — a dashed gold box appears; on release the enclosed spaces highlight and the panel shows the correct count.
3. Shift-drag another box — the new spaces are added to the set (previous stay selected).
4. Click a highlighted space — it drops out of the set (count decrements); click an unselected space — it joins.
5. Drag any selected space — the whole group moves together; path ribbons stay attached to every moved disc and re-drape correctly on release.
6. Drag an unselected space — selection collapses to just it, then it moves (Shift-drag keeps the set and adds it).
7. Arrow keys nudge the whole group (Shift = coarse); Ctrl+Z restores positions in one step per burst.
8. Click empty ground — selection clears; **Clear selection** button also clears it.
9. Switch to Select mode and back to Multi — single-node drag, connect, add, decals, and labels all still behave as before.
10. Save (Ctrl+S with repo granted, or Download) writes without lint errors introduced by the move.

- [ ] **Step 3: Final commit if any tweaks were needed**

```bash
git add -A
git commit -m "chore(undercity): multi-select verification tweaks"
```

(Skip if nothing changed.)

---

## Self-review notes

- **Spec coverage:** mode + hotkey (Task 3.1), marquee + Shift union + click toggle (Task 3.3/3.4/3.5), group drag with drift-free origin capture (Task 3.4), group live ribbons via set-based omit (Tasks 1 & 2), arrow nudge (Task 4), panel count + Clear (Task 5), marquee draw (Task 2.7). All spec sections map to a task.
- **Type consistency:** `beginGroupDrag(ids: ReadonlySet<string>)`, `dragNodes: ReadonlySet<string>`, `nodesInRect(r)`, and `overlay.marquee` names match across canvas + component. `omitEdgesOf: string | ReadonlySet<string>` is consumed only by the canvas (set) and existing callers (string).
- **Invariants:** `selNode` is nulled on group ops so `afterDocChange`'s layer-follow never yanks the view; Region-mode gather and single-node drag paths are untouched.
