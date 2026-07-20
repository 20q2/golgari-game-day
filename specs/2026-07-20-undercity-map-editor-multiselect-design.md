# Undercity Map Editor — Multi-select tool

**Date:** 2026-07-20
**Status:** Approved, ready for implementation plan

## Problem

The map editor (`/undercity/map-editor`) can only move one node at a time. Relocating a whole region or dungeon means dragging each space individually. We want a dedicated tool to select many nodes at once and move them as a group.

## Approach

Add a new editor mode `'multi'` that reuses the existing `selNodes: Set<string>` signal (today only Region mode gathers into it) and its existing render support — `EditorCanvas` already highlights every disc in `overlay.selectedNodes`. No new selection data model is required; the work is a new mode, its pointer semantics, marquee rendering, and generalizing the mid-drag ribbon logic to a set of nodes.

Selection method: **marquee + click** (chosen). Group extras: **arrow-key nudge** and a **panel count readout** (chosen). Group delete is explicitly out of scope.

## Behavior

### Mode entry
- Toolbar button in the `.modes` group (icon `select_all`, label "Multi", hotkey `M`). `MODE_KEYS['m'] = 'multi'`, plus a `MODE_HINTS` entry.
- Entering `multi` mode does not clear `selNodes` (so you can switch in from Region mode and keep a gathered set). `setMode` keeps its existing resets otherwise.

### Selecting (in `multi` mode)
- **Drag on empty ground** → rubber-band marquee rectangle. On release, every node on the active layer whose center is inside the rectangle **replaces** `selNodes`. **Shift-drag** unions with the current set instead of replacing.
- **Click a node** (press + release, no movement) → toggles that node in/out of `selNodes` (same feel as Region mode's gather click).
- **Click empty ground** (no movement, no marquee drag distance) → clears `selNodes`.

### Moving the group
- **Drag starting on a node already in `selNodes`** → moves the whole group. Every selected node's `x/y` shifts by the same world-space delta, snap-aware via `applySnap` (snap is applied per-node to its own coordinate, matching single-node drag).
- **Drag starting on a node not in `selNodes`** → replaces the set with just that node (or, with Shift, adds it) and drags the group (which is that one node). This keeps press-then-drag intuitive when you grab an unpicked space.
- One `snapshot()` per move gesture; on drop, `afterDocChange()` re-drapes path ribbons. A gesture that never moves drops its snapshot (mirrors the existing single-node click cleanup).

### Arrow-key nudge
- Extend `nudge()`: when `mode() === 'multi'` and `selNodes` is non-empty, arrows move every selected node by the step (Shift = coarse 20px, else 2px), sharing one undo across a burst via the existing `lastNudgeAt` window. Single-selection nudge behavior for other modes is unchanged.

### Panel readout
- A sidebar `<section>` shown only in `multi` mode: "N spaces selected" with a **Clear** button (calls `clearSelection()`), plus a one-line hint describing marquee/click/drag.

## Rendering changes

### Marquee rectangle (`editor-canvas.ts`)
- New `EditorOverlay` field `marquee?: { x: number; y: number; w: number; h: number } | null` (world-space). Drawn in `frame()` as a dashed rectangle with a faint fill so it reads over terrain. The component sets it live during a marquee drag and clears it on release.

### Group mid-drag ribbons
- Today `beginNodeDrag(id)` bakes the active-layer terrain omitting one node's edges and live-draws them each frame so paths stay attached. For a group move, all selected nodes' edges (internal and external) must be omitted from the bake and live-drawn.
- Generalize `renderTerrain`'s `opts.omitEdgesOf?: string` to `string | ReadonlySet<string>`; the edge filter drops a curve if either endpoint is in the omit set.
- Generalize `EditorCanvas`: track `dragNodes: ReadonlySet<string>` (single-node drag becomes a one-element set), bake with the set, and in the live-line pass draw edges for every dragging node. Keep `beginNodeDrag(id)` working (wrap the id in a set) and add a `beginGroupDrag(ids)` entry point.

## Files touched

- `src/app/undercity/map-editor/map-editor.component.ts` — `Mode` union + `MODE_KEYS`/`MODE_HINTS`, marquee drag state, `multi` branches in `onPointerDown`/`onPointerMove`/`onPointerUp`, group move + `nudge()` extension, panel helpers.
- `src/app/undercity/map-editor/map-editor.component.html` — toolbar button, panel section.
- `src/app/undercity/map-editor/editor-canvas.ts` — `marquee` overlay draw, `dragNodes` set + `beginGroupDrag`, group live-lines.
- `src/app/undercity/engine/board-terrain.ts` — `omitEdgesOf` accepts a `ReadonlySet<string>`.
- `src/app/undercity/map-editor/map-editor.component.scss` — minor styling for the panel section if needed.

## Testing / verification

No test runner is wired up for the frontend. Verify with `npm run build` (dev build) staying green, then manually drive `/undercity/map-editor`: marquee-select a cluster, drag it, confirm paths stay attached and re-drape on drop; Shift-drag unions; click toggles; arrows nudge the group; the panel count updates; undo/redo restores positions. The `board-terrain.ts` signature change must not regress the game board render or the existing single-node drag.

## Invariants preserved

- Region-mode gather click and its `selNodes` usage are untouched (both modes share the set, which is fine — switching modes doesn't wipe it).
- Single-node drag, decal/label drag, connect, add, and nudge for non-multi modes behave exactly as before.
- `afterDocChange`'s layer-follow keys off `selNode` (the single selection), so group moves don't yank the view; group operations leave `selNode` null.
