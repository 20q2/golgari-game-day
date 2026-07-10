# Undercity Map Editor Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** A dev-only WYSIWYG map editor at `/undercity/map-editor` that edits a single checked-in `map.json` (nodes, edges, regions, decals) consumed by both the Python Lambda and the Angular client.

**Architecture:** The procedural `_build_map()` runs one last time as a seed script, then `undercity_data.py` loads `infrastructure/lambda/map.json` (source of truth; `public/data/undercity-map.json` is a byte-identical client copy, drift caught by a pytest). The game renderer gains data-driven region backgrounds, a decal pass, and a shared stamp registry. The editor reuses `renderTerrain` + shared node-disc drawing for pixel-identical output and saves via the File System Access API.

**Tech Stack:** Angular 20 standalone components, canvas 2D, Python 3.11 + pytest, File System Access API (Chromium).

**Spec:** `.claude/specs/2026-07-10-undercity-map-editor-design.md`

**Verification reality check:** there is NO frontend test runner in this repo (no Karma/Jest — don't try `ng test`). Frontend tasks verify with `npm run build` + manual steps against `npm start`. Python tasks are strict TDD with pytest (run from `infrastructure/lambda`: `python -m pytest tests -q`).

---

### Task 1: Seed `map.json` from the procedural generator

**Files:**
- Create: `infrastructure/lambda/map_bootstrap.py` (moved procedural code + seed `__main__`)
- Create: `infrastructure/lambda/map.json` (generated)
- Create: `public/data/undercity-map.json` v2 (regenerated, gains `regions` + `decals`)
- Test: `infrastructure/lambda/tests/test_map_file.py`

- [ ] **Step 1: Write the failing test**

```python
"""Tests for the checked-in map file (source of truth for the board)."""
import json
import sys
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parents[1]))

LAMBDA_DIR = Path(__file__).resolve().parents[1]
REPO_ROOT = LAMBDA_DIR.parents[1]


def _load(p):
    return json.loads(p.read_text(encoding='utf-8'))


def test_map_file_exists_with_v2_sections():
    doc = _load(LAMBDA_DIR / 'map.json')
    assert {'worldW', 'worldH', 'gate', 'boss', 'nodes', 'regions', 'decals'} <= set(doc)
    assert len(doc['nodes']) == 124
    assert isinstance(doc['decals'], list)
    # every node's region is described
    for n in doc['nodes']:
        assert n['region'] in doc['regions'], n['id']


def test_client_copy_matches_source():
    src = (LAMBDA_DIR / 'map.json').read_text(encoding='utf-8')
    pub = (REPO_ROOT / 'public' / 'data' / 'undercity-map.json').read_text(encoding='utf-8')
    assert src == pub, 'run: python infrastructure/lambda/sync_map.py'
```

- [ ] **Step 2: Run it — expect FAIL** (`map.json` missing).

- [ ] **Step 3: Create `map_bootstrap.py`**

Move (cut, don't copy) from `undercity_data.py`: `_ring_point`, `_build_map`, and the
ring/ladder/dungeon geometry constants used only by them (`_RING_TYPES`, dungeon pocket
literals inside `_build_map`, `ISLAND_XY`). Keep `BIOMES`, `WORLD_W/H`, `GATE_NODE`,
`HOME_GATES`, `DEFAULT_BIOME`, `BOSS_NODE` in `undercity_data.py` (perks and constants are
used at runtime). `map_bootstrap.py` imports those from `undercity_data`. Add:

```python
REGION_BACKGROUNDS = {          # seeded from board-canvas.ts floorSrc
    'city': 'undercity/undercity_background.png',
    'cavern': 'undercity/cavern_background.png',
    'bog': 'undercity/swamp_background.png',
    'isle': 'undercity/palace_background.png',
    'ruin': 'undercity/palace_background.png',
    'bone': 'undercity/palace_background.png',
    'garden': 'undercity/swamp_background.png',
    'depths': 'undercity/cavern_background.png',
}

def seed(out_path):
    nodes = _build_map()
    region_ids = sorted({n['region'] for n in nodes.values()})
    regions = {}
    for rid in region_ids:
        biome = data.BIOMES.get(rid)
        regions[rid] = {
            'label': biome['name'] if biome else rid.replace('_', ' ').title(),
            'background': REGION_BACKGROUNDS.get(rid, ''),
            'scatter': True,
            'dark': rid in ('depths',) or rid.endswith('_pocket'),  # match computeLayers pockets
        }
    doc = {'worldW': data.WORLD_W, 'worldH': data.WORLD_H,
           'gate': data.GATE_NODE, 'boss': data.BOSS_NODE,
           'nodes': list(nodes.values()), 'regions': regions, 'decals': []}
    Path(out_path).write_text(json.dumps(doc, indent=1), encoding='utf-8')

if __name__ == '__main__':
    seed(Path(__file__).with_name('map.json'))
```

Before writing the `dark` line, check `src/app/undercity/engine/board-layers.ts` for how
dungeon-pocket regions are actually identified and mirror that predicate exactly.

- [ ] **Step 4: Run the seed + copy to public**

```
python infrastructure/lambda/map_bootstrap.py
cp infrastructure/lambda/map.json public/data/undercity-map.json
```

- [ ] **Step 5: Tests pass; whole suite still green** (`python -m pytest tests -q` → 100+ passed; the client still ignores extra JSON keys). Commit: `feat(undercity): seed map.json v2 — board frozen to editable data`

### Task 2: `undercity_data.py` loads the JSON

**Files:**
- Modify: `infrastructure/lambda/undercity_data.py` (replace `MAP_NODES = _build_map()`)
- Test: extend `infrastructure/lambda/tests/test_map_file.py`

- [ ] **Step 1: Failing test**

```python
def test_data_module_loads_from_map_json():
    import undercity_data as data
    doc = _load(LAMBDA_DIR / 'map.json')
    assert set(data.MAP_NODES) == {n['id'] for n in doc['nodes']}
    assert not hasattr(data, '_build_map')  # procedural build fully retired
```

- [ ] **Step 2: Implement.** In `undercity_data.py`, replace the moved block with:

```python
_MAP_DOC = json.loads((Path(__file__).with_name('map.json')).read_text(encoding='utf-8'))
MAP_NODES = {n['id']: n for n in _MAP_DOC['nodes']}
```

(`import json`, `from pathlib import Path` at top.) `WORLD_W/H` stay as literals and a test
asserts they equal `_MAP_DOC['worldW'/'worldH']` — the file wins if they ever diverge, so
just read them from `_MAP_DOC` instead of keeping literals. Derived constants
(`WARP_NODES`, `SIGIL_LAIRS`) already comprehend over `MAP_NODES` — untouched.

- [ ] **Step 3: Full pytest suite green** (map invariants in `test_map.py` now validate the file). Commit: `refactor(undercity): MAP_NODES loads from map.json`

### Task 3: `sync_map.py` replaces `generate_map_json.py`

**Files:**
- Create: `infrastructure/lambda/sync_map.py`
- Delete: `infrastructure/lambda/generate_map_json.py`
- Modify: `CLAUDE.md` (board-map bullet: source of truth is now `infrastructure/lambda/map.json`; after hand-editing run `python infrastructure/lambda/sync_map.py`)

- [ ] **Step 1: Implement**

```python
"""Copy the map source of truth to the client bundle. Run after hand edits."""
import shutil
from pathlib import Path

src = Path(__file__).with_name('map.json')
dst = Path(__file__).resolve().parents[2] / 'public' / 'data' / 'undercity-map.json'
shutil.copyfile(src, dst)
print(f'{src} -> {dst}')
```

- [ ] **Step 2: Run it; `test_client_copy_matches_source` still green; commit.** `chore(undercity): sync_map.py replaces generate_map_json.py`

### Task 4: Client schema + data-driven region backgrounds

**Files:**
- Modify: `src/app/undercity/engine/board-canvas.ts` (BoardMap type ~line 34; `floorSrc` block ~line 284)

- [ ] **Step 1: Extend types**

```ts
export interface RegionSpec {
  label: string;
  background: string; // path under the app base, '' = flat dark floor
  scatter: boolean;   // procedural ambient decoration on/off
  dark: boolean;      // fog-of-war dungeon pocket
}
export interface MapDecal {
  kind: 'stamp' | 'image';
  stamp?: string;     // registry key when kind === 'stamp'
  src?: string;       // image path when kind === 'image'
  x: number; y: number;
  scale: number; rot: number; // radians
  layer: 'under' | 'over';
  seed?: number;
}
export interface BoardMap {
  worldW: number; worldH: number; gate: string; boss: string;
  nodes: BoardNode[];
  regions?: Record<string, RegionSpec>;
  decals?: MapDecal[];
}
```

- [ ] **Step 2: Backgrounds from data.** Replace the hardcoded `floorSrc` literal with:

```ts
const floorSrc: Record<string, string> = {};
for (const [rid, spec] of Object.entries(map.regions ?? {})) {
  if (spec.background) floorSrc[rid] = spec.background;
}
if (!map.regions) Object.assign(floorSrc, LEGACY_FLOOR_SRC); // keep old literal as fallback const
```

- [ ] **Step 3: `npm run build` green; `npm start` → board renders identically.** Commit: `feat(undercity): region backgrounds read from map.json`

### Task 5: Stamp registry + scatter gate

**Files:**
- Create: `src/app/undercity/engine/board-stamps.ts`
- Modify: `src/app/undercity/engine/board-terrain.ts`

- [ ] **Step 1: Registry.** Move these terrain draw functions into `board-stamps.ts`, normalized to one signature, and re-import them in `board-terrain.ts` (their existing call sites just add the wrapper args): `drawGiantMushroom`, `drawArchRuin`, `drawBoneMound`, `drawMushrooms`, `drawCrystal`, `drawPillar`, `drawRuinBlock`, `drawSkullPile`, `drawPool`, `drawReeds`, `drawBogTree`, `drawCompostHeap`, `drawEggCluster`.

```ts
export type StampFn = (ctx: CanvasRenderingContext2D, x: number, y: number,
                       scale: number, rand: () => number) => void;
export const STAMPS: Record<string, StampFn> = { mushroom: ..., giant_mushroom: ..., ... };
export function drawStamp(ctx, name, x, y, scale, rot, seed): void {
  const fn = STAMPS[name]; if (!fn) return;
  ctx.save(); ctx.translate(x, y); ctx.rotate(rot); ctx.scale(scale, scale);
  fn(ctx, 0, 0, 1, mulberry32(seed ?? 1)); ctx.restore();
}
```

Functions whose current signatures take extra params (radii, palette) get sensible fixed
defaults inside the wrapper; keep the originals exported for terrain's internal callers.
Move `mulberry32`/`hashStr` into `board-stamps.ts` and re-export from `board-terrain.ts`.

- [ ] **Step 2: Scatter gate.** In `renderTerrain`, wherever ambient scatter loops run per region (mushroom fields, reeds, skulls — find the loops that iterate `regionPts`), skip a region when `map.regions?.[rid]?.scatter === false`.

- [ ] **Step 3: Build green + board visually unchanged; commit.** `refactor(undercity): set-piece stamp registry + per-region scatter flag`

### Task 6: Decal render pass

**Files:**
- Modify: `src/app/undercity/engine/board-terrain.ts` (under-decals at the end of `renderTerrain`, before the return)
- Modify: `src/app/undercity/engine/board-canvas.ts` (over-decals after tokens in `draw()`; image cache)

- [ ] **Step 1: Under pass in `renderTerrain`** — only decals inside this layer's bounds:

```ts
for (const d of map.decals ?? []) {
  if (d.layer !== 'under') continue;
  if (layer && !(d.x >= bx && d.x <= bx + bw && d.y >= by && d.y <= by + bh)) continue;
  if (d.kind === 'stamp') drawStamp(ctx, d.stamp!, d.x, d.y, d.scale, d.rot, d.seed);
  else drawDecalImage(ctx, d);       // draws from a module-level Image cache;
}                                     // onload triggers rebuildLayers() like floorTex does
```

Image decal draws centered: `ctx.drawImage(img, d.x - w/2, d.y - h, w, h)` under
rotation/scale transform (feet-at-point like sprites; `w` from natural size × scale).

- [ ] **Step 2: Over pass** — in `BoardCanvas.draw()` immediately after the token loop, same filter with `layer === 'over'` and the active layer's bounds; stamps + images drawn under the camera transform.

- [ ] **Step 3: Manual verify** — hand-add one stamp + one image decal to `map.json`, run `sync_map.py`, see both on the board (under hides behind tokens, over covers them). Remove them, sync, commit. `feat(undercity): decal layers rendered from map.json`

### Task 7: Shared node-disc drawing

**Files:**
- Create: `src/app/undercity/engine/board-space.ts`
- Modify: `src/app/undercity/engine/board-canvas.ts`

- [ ] Extract the space-disc painting (the ellipse + type color + `SPACE_ICONS` glyph, currently a private method in `BoardCanvas`) into `export function drawSpaceDisc(ctx, node, opts: { dim?: boolean; selected?: boolean })` and call it from `BoardCanvas`. `selected` draws a gold ring (`#fbbf24`, 3px) — game never passes it; the editor will. Build green, board unchanged, commit. `refactor(undercity): shared node-disc renderer`

### Task 8: Editor scaffold — route, canvas, load, pan/zoom, layer switch

**Files:**
- Create: `src/app/undercity/map-editor/map-editor.component.ts|html|scss`
- Create: `src/app/undercity/map-editor/editor-canvas.ts`
- Modify: `src/app/app.routes.ts`, `src/app/navbar/navbar.component.html` (dev-gated link, pattern-match the color-test entries exactly)

- [ ] **Step 1: `EditorCanvas`.** A lean sibling of `BoardCanvas` (not a subclass): holds camera (copy the pan/zoom/wheel/pinch handlers from `BoardCanvas` — they're self-contained), a `TerrainArt` per layer via `renderTerrain(map, floorTex, landmarkArt, layerSpec)`, and a `draw()` that blits terrain, draws edges (`edgeCurves`), node discs (`drawSpaceDisc`, selected ring), decal gizmos (dashed bounding box + rotate/scale handles on selection), and a crosshair for pending adds. Exposes `pick(x, y): { node?: string; decal?: number }` (nearest disc within 26px world units, else topmost decal whose bounds contain the point), `invalidateTerrain()` (re-runs `renderTerrain` after data edits — this is what makes the editor WYSIWYG), and `setLayer(id)`.
- [ ] **Step 2: Component shell.** Signals: `doc` (the whole map JSON object), `mode: 'select'|'add'|'connect'|'decal'|'region'`, `selection`, `layerId`. Loads `data/undercity-map.json` on init like `undercity-page.component.ts:96` does. Toolbar (top), properties panel (right), canvas (fill). Route + navbar link `map` icon, `isDev`-gated.
- [ ] **Step 3: `npm start` → editor shows the real board, pans/zooms, layer dropdown switches to dungeon pockets.** Commit: `feat(undercity): map editor scaffold — renders live board data`

### Task 9: Select / move / properties

**Files:** modify `map-editor.component.*`, `editor-canvas.ts`

- [ ] Pointer flow in select mode: down on disc → drag moves node (`node.x/y = world coords`, edges follow since they render from data); down on decal → drag moves decal; drag on empty → pan (reuse camera drag). On drop: `invalidateTerrain()`. Properties panel binds the selection: node → id (rename updates all `neighbors` references + `gate`/`boss` fields), type (`<select>` of the 17 types from `SPACE_ICONS` keys), region (`<select>` of `Object.keys(doc.regions)`); decal → scale/rot/layer/seed inputs. Manual verify: drag a ring node, see paths re-drape. Commit: `feat(undercity): node/decal move + properties editing`

### Task 10: Add / delete / connect

**Files:** modify `map-editor.component.*`

- [ ] Add mode: click empty ground → create `{ id: 'n' + Date.now().toString(36), type: 'loot', region: <current layer's dominant region>, x, y, neighbors: [] }`, select it (rename in panel). Delete key: remove node + strip it from every `neighbors` list (decals: remove selected decal). Connect mode: click node A then node B → toggle the A↔B edge symmetrically. Escape cancels. `invalidateTerrain()` after each. Manual verify: build a 4-node loop, connect it to a ring node. Commit: `feat(undercity): add/delete/connect nodes`

### Task 11: Decal placement palettes

**Files:** modify `map-editor.component.*`; small `image-manifest` helper in the component

- [ ] Decal mode side panel, two tabs. **Stamps:** buttons for each `Object.keys(STAMPS)` — thumbnails by rendering each stamp once to a 64px offscreen canvas. **Images:** enumerated from the saved directory handle (`public/undercity/**/*.png`, recursive walk) when one is granted; before that, a static seed list of known art folders + a free-text path input. Click palette entry → place-at-click; new decal `{ scale: 1, rot: 0, layer: 'under', seed: randInt }`. Selection handles: corner drag = scale, top handle = rotate, panel toggle = under/over. Commit: `feat(undercity): stamp + image decal palettes`

### Task 12: Region tool

**Files:** modify `map-editor.component.*`

- [ ] Region mode: click nodes to build a selection set (shift keeps adding); panel shows region assign dropdown + "new region…" (id prompt → creates `{ label, background: '', scatter: true, dark: false }` entry). Region list editor: label text, background `<select>` of the image manifest filtered to `*_background.png`, `dark`/`scatter` checkboxes. Assigning writes `node.region`; `invalidateTerrain()` re-themes. Manual verify: carve a 5-node pocket, mark region dark, watch it join the fog-of-war layer set. Commit: `feat(undercity): region tool — dungeon layout authoring`

### Task 13: Validation lint panel

**Files:**
- Create: `src/app/undercity/map-editor/map-lint.ts`
- Modify: `map-editor.component.*`

- [ ] **Step 1: Pure function** (mirrors `tests/test_map.py` invariants):

```ts
export interface LintIssue { level: 'error' | 'warn'; text: string; nodeId?: string }
export function lintMap(doc: BoardMap): LintIssue[]
```

Checks (all `error` unless noted): duplicate ids; neighbor symmetry + unknown neighbor ids;
all nodes reachable from `doc.gate` (BFS); exactly one node of type `gate` per home biome
is NOT required — but `doc.gate` and `doc.boss` must exist and have the right types;
ladder nodes have exactly one ladder partner; barrier nodes appear in pairs (warn);
every `node.region` in `doc.regions`; coordinates within `[0, worldW/H]` (warn).

- [ ] **Step 2: Panel** lists issues (click → select + center camera on the node); Save button disabled while any `error` exists. Manual verify: disconnect a node → error appears, reconnect → clears. Commit: `feat(undercity): map lint panel gates saving`

### Task 14: Undo/redo + save

**Files:** modify `map-editor.component.*`; create `src/app/undercity/map-editor/file-io.ts`

- [ ] **Step 1: Undo/redo.** Every mutation goes through `commit(label)` which pushes `structuredClone(doc)` onto a 100-deep stack; Ctrl+Z / Ctrl+Shift+Z restore + `invalidateTerrain()`.
- [ ] **Step 2: Save.** `file-io.ts`:

```ts
export async function pickRepoRoot(): Promise<FileSystemDirectoryHandle>   // showDirectoryPicker({ mode: 'readwrite' })
export async function saveMap(root: FileSystemDirectoryHandle, doc: BoardMap): Promise<void>
// resolves infrastructure/lambda/map.json and public/data/undercity-map.json via
// getDirectoryHandle(..., { create: false }) chains, writes identical JSON.stringify(doc, null, 1)
export function downloadMap(doc: BoardMap): void  // Blob + <a download="map.json"> fallback
```

Handle persisted for the session only (re-pick after reload — IndexedDB persistence is YAGNI). Ctrl+S = save; guard: lint errors block, non-Chromium → `downloadMap` + a note to run `sync_map.py` after placing the file.
- [ ] **Step 3: End-to-end manual test:** move a node + add a decal → Save → `git diff` shows both files changed identically → `python -m pytest tests -q` green (invariants + copies-match) → `npm start` game board shows the edit. Commit: `feat(undercity): editor save via File System Access + undo/redo`

### Task 15: Docs + final verification

- [ ] Update `CLAUDE.md` Undercity section: map source of truth = `infrastructure/lambda/map.json`, edited via `/undercity/map-editor` (dev) or by hand + `sync_map.py`; `map_bootstrap.py` regenerates a fresh procedural board.
- [ ] Full check: `python -m pytest tests -q` green, `npm run build` green, manual pass over every editor mode on `npm start`.
- [ ] Commit: `docs: map editor workflow`

## Self-review notes

- Spec coverage: data model (T1–3), backgrounds (T4), stamps+scatter (T5), decal passes (T6), editor with all five modes (T8–12), validation (T13), save/undo (T14), docs (T15). ✔
- The `dark` predicate in T1 must match `board-layers.ts` reality — flagged as an explicit check, not an assumption.
- `Date.now()`-based ids are fine here (browser editor, not a workflow script).
