# Map-editor Generated-Dungeon Preview Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add a read-only "Preview dungeons" mode to the map editor that shows procedurally-generated dungeon samples (rolled from the server) instead of only the now-fallback committed depths.

**Architecture:** A `?sample=<seed>` query on `GET /game/map` returns the committed surface plus freshly generated depths for any seed (the Python generator stays the single source). The editor gains a preview toggle that fetches a sample, loads it into the existing canvas read-only, and re-rolls on demand; the committed depths stay editable.

**Tech Stack:** Python 3.11 Lambda + pytest; Angular/TypeScript editor. No TS unit runner — client tasks are gated by `npm run build`.

Design: [specs/2026-07-21-undercity-editor-dungeon-preview-design.md](2026-07-21-undercity-editor-dungeon-preview-design.md). Builds on procedural dungeons A/B/C (merged).

**Test loop:** `cd infrastructure/lambda && python -m pytest tests -q` · `npm run build`

---

## File Structure

- `infrastructure/lambda/undercity_db.py` — **modify**: `handle_map` honors `?sample=<seed>`.
- `infrastructure/lambda/tests/test_procedural_map.py` — **modify**: sample-endpoint tests.
- `src/app/undercity/services/undercity-api.service.ts` — **modify**: `getMap(sample?)`.
- `src/app/undercity/map-editor/map-editor.component.ts` — **modify**: preview mode (signal, enter/exit, roll, read-only gates).
- `src/app/undercity/map-editor/map-editor.component.html` — **modify**: preview toggle + roll button + seed label; hide edit tools/save in preview.

---

## Task 1: `?sample=<seed>` on `GET /game/map`

**Files:**
- Modify: `infrastructure/lambda/undercity_db.py` (`handle_map`)
- Modify: `infrastructure/lambda/tests/test_procedural_map.py`

- [ ] **Step 1: Write the failing tests**

Append to `tests/test_procedural_map.py`:

```python
def test_handle_map_sample_previews_generator_regardless_of_flag(table, monkeypatch):
    monkeypatch.setattr(data, 'PROCEDURAL_DUNGEONS', False)   # flag off — sample still generates
    status, doc = db.handle_map(table, {'sample': 'preview-1'})
    assert status == 200
    ids = {n['id'] for n in doc['nodes']}
    assert 'cavern_r0' in ids                                # surface present
    for biome in data.BIOMES:
        assert f'{biome}_lair' in ids and f'{biome}_esc' in ids
    depths = {n['id']: n for n in doc['nodes'] if n.get('region') == 'depths'}
    assert depths != data.COMMITTED_DEPTHS                   # generated, not committed


def test_handle_map_sample_is_deterministic_per_seed(table):
    _, a = db.handle_map(table, {'sample': 'seed-x'})
    _, b = db.handle_map(table, {'sample': 'seed-x'})
    assert a == b
    _, c = db.handle_map(table, {'sample': 'seed-y'})
    assert c != a                                            # different seed → different night


def test_handle_map_without_sample_still_works(table):
    status, doc = db.handle_map(table, {})
    assert status == 200
    assert {'worldW', 'worldH', 'gate', 'boss', 'nodes', 'regions'} <= set(doc)
```

- [ ] **Step 2: Run to verify they fail**

Run: `cd infrastructure/lambda && python -m pytest tests/test_procedural_map.py -k "sample" -q`
Expected: FAIL — `handle_map` ignores `sample`, so `test_..._previews_generator...` gets committed depths (`depths == COMMITTED_DEPTHS`) and `..._deterministic_per_seed` sees `c == a`.

- [ ] **Step 3: Honor the sample param in `handle_map`**

Replace the body of `handle_map` in `infrastructure/lambda/undercity_db.py`:

```python
def handle_map(table, query_params):
    """GET /game/map — the night's board: fixed surface + this season's depths,
    in the BoardMap shape the client renders. `?sample=<seed>` instead returns a
    preview: the surface plus freshly generated depths for that seed, ignoring the
    flag and the active season (used by the map editor to browse generator output).
    Falls back to the committed board when no season is active."""
    doc = dict(data._MAP_DOC)     # worldW/H, gate, boss, regions, decals, labels
    sample = (query_params or {}).get('sample')
    if sample:
        depths = {n['id']: n for n in mapgen.generate_all_depths(sample)}
        nodes = data.merge_map(depths)
    else:
        sid, config = _active_season(table)
        nodes = _season_map(table, sid)
    doc['nodes'] = list(nodes.values())
    return 200, doc
```

(`mapgen` is already imported at the top of `undercity_db.py` from Phase C; `data.merge_map` is from Phase A.)

- [ ] **Step 4: Run to verify they pass, then the full suite**

Run: `cd infrastructure/lambda && python -m pytest tests/test_procedural_map.py -q`
Expected: PASS.

Run: `cd infrastructure/lambda && python -m pytest tests -q`
Expected: all green (the no-sample path is unchanged).

- [ ] **Step 5: Commit**

```bash
git add infrastructure/lambda/undercity_db.py infrastructure/lambda/tests/test_procedural_map.py
git commit -m "feat(undercity): GET /game/map?sample=<seed> previews generated dungeons"
```

---

## Task 2: `getMap(sample?)` on the API service

**Files:**
- Modify: `src/app/undercity/services/undercity-api.service.ts`

- [ ] **Step 1: Add the optional sample argument**

Replace the existing `getMap()` (added in Phase C) with:

```typescript
  /** The night's board: fixed surface + this season's (possibly generated)
   *  depths. With `sample`, returns a preview of the generator for that seed
   *  (surface + freshly generated depths), ignoring flag/season. */
  async getMap(sample?: string): Promise<BoardMap> {
    const qs = sample ? `?sample=${encodeURIComponent(sample)}` : '';
    const response = await fetch(`${this.API_BASE_URL}/game/map${qs}`, {
      method: 'GET',
      mode: 'cors',
      headers: { 'Content-Type': 'application/json' },
    });
    if (!response.ok) {
      throw new UndercityApiError(`Failed to load board map (${response.status})`, response.status);
    }
    return response.json();
  }
```

- [ ] **Step 2: Build to verify it compiles**

Run: `npm run build`
Expected: build succeeds. The player view's `getMap()` call (no arg) still type-checks — `sample` is optional.

- [ ] **Step 3: Commit**

```bash
git add src/app/undercity/services/undercity-api.service.ts
git commit -m "feat(undercity): getMap accepts an optional sample seed"
```

---

## Task 3: Editor "Preview dungeons" mode

**Files:**
- Modify: `src/app/undercity/map-editor/map-editor.component.ts`
- Modify: `src/app/undercity/map-editor/map-editor.component.html`

- [ ] **Step 1: Inject the API service + add preview state**

In `map-editor.component.ts`, add the import near the other imports:

```typescript
import { UndercityApiService } from '../services/undercity-api.service';
```

Add these fields next to the other `signal(...)` fields (near `layerId`/`layerIds`, ~line 100):

```typescript
  protected readonly previewSeed = signal<string | null>(null);
  private readonly api = inject(UndercityApiService);
  private savedDoc: BoardMap | null = null;
  private previewCounter = 0;
```

- [ ] **Step 2: Add enter/exit + roll methods**

Add these methods to the component (e.g. just before `save()` ~line 1301):

```typescript
  /** Toggle read-only preview of generator output. On: stash the editable doc
   *  and load a sample. Off: restore the editable doc. */
  protected async togglePreview(): Promise<void> {
    if (this.previewSeed()) {
      this.previewSeed.set(null);
      const restore = this.savedDoc;
      this.savedDoc = null;
      if (restore) {
        this.doc.set(restore);
        this.canvas.setDoc(restore);
        this.canvas.setLayer('overworld');
        this.zoomPct.set(this.canvas.zoomPct());
        this.afterDocChange(false);
      }
      return;
    }
    this.savedDoc = this.d();
    await this.loadSample();
  }

  /** Fetch a fresh generated sample and show its first pocket read-only. */
  protected async loadSample(): Promise<void> {
    const seed = `preview-${++this.previewCounter}`;
    try {
      const board = await this.api.getMap(seed);
      board.regions ??= {};
      board.decals ??= [];
      board.labels ??= [];
      this.previewSeed.set(seed);
      this.doc.set(board);
      this.canvas.setDoc(board);
      const pocket = this.canvas.layerIds().find((id) => id !== 'overworld');
      this.canvas.setLayer(pocket ?? 'overworld');
      this.zoomPct.set(this.canvas.zoomPct());
      this.layerId.set(this.canvas.activeLayer().id);
      this.layerIds.set(this.canvas.layerIds());
    } catch {
      this.toast('Could not load a sample — deploy the /game/map endpoint first.');
      this.previewSeed.set(null);
      this.savedDoc = null;
    }
  }
```

- [ ] **Step 3: Gate the two input entry points read-only**

In `onPointerDown(e)`, immediately after the pan-drag branch's `return;` (the block that sets `this.drag = { kind: 'pan', ... }` and returns — around line 318), add a guard so panning still works but nothing mutates:

```typescript
    if (this.previewSeed()) return;   // read-only preview: view/pan only, no edits
```

At the very top of `private onKey(e: KeyboardEvent)` (line ~664), add:

```typescript
    if (this.previewSeed()) return;   // no keyboard edits while previewing samples
```

- [ ] **Step 4: Template — preview controls + hide edit tools/save in preview**

In `map-editor.component.html`, wrap the `.modes` tool group so it hides in preview. Change:

```html
    <div class="modes">
```
to:
```html
    @if (!previewSeed()) {
    <div class="modes">
```
and add a closing `}` after that div's closing `</div>` (the `</div>` on the line before the `<label class="layer-label">`).

Add a preview control row after the Zoom `mini-row` (after its closing `</div>`, before `<span class="spacer"></span>`):

```html
    <div class="mini-row" role="group" aria-label="Dungeon preview">
      <button [class.on]="previewSeed()" (click)="togglePreview()"
              matTooltip="Preview procedurally-generated dungeons (read-only)">
        <mat-icon>casino</mat-icon><span>Preview dungeons</span>
      </button>
      @if (previewSeed()) {
        <button (click)="loadSample()" matTooltip="Roll another generated sample">
          <mat-icon>refresh</mat-icon><span>Roll another</span>
        </button>
        <span class="zoom-num">{{ previewSeed() }}</span>
      }
    </div>
```

Hide the save buttons in preview: wrap the two save-related `@if` blocks (the `@if (canWriteInPlace && !rootPicked())` and `@if (rootPicked())` blocks) in an outer `@if (!previewSeed()) { ... }`.

- [ ] **Step 5: Build**

Run: `npm run build`
Expected: build succeeds, no TypeScript/template errors.

- [ ] **Step 6: Commit**

```bash
git add src/app/undercity/map-editor/map-editor.component.ts src/app/undercity/map-editor/map-editor.component.html
git commit -m "feat(undercity): map editor previews generated dungeon samples (read-only)"
```

---

## Verification (whole feature)

- [ ] `cd infrastructure/lambda && python -m pytest tests -q` — all green.
- [ ] `npm run build` — client compiles.
- [ ] Note for the user: needs a **Lambda deploy** for the sample endpoint to answer; until then the editor's Preview toggle shows the error toast. After deploy: open `/undercity/map-editor`, click **Preview dungeons**, switch pockets with the layer picker, hit **Roll another** for fresh layouts; committed depths remain editable when preview is off.

## Self-Review

**Spec coverage:**
- `?sample=<seed>` on `handle_map`, flag/season-independent, deterministic → Task 1. ✔
- `getMap(sample?)` client hook → Task 2. ✔
- Editor preview toggle, reuse layer view, roll-another, seed label → Task 3 (methods + template). ✔
- Read-only enforcement (pan/view allowed, no edits/saves) → Task 3 Step 3 (pointer + key guards) + Step 4 (hide tools/save). ✔
- Committed depths stay editable; preview non-destructive (stash/restore `savedDoc`) → Task 3 Step 2. ✔
- Error handling (fetch fails → toast, stay editable) → `loadSample` catch. ✔
- Testing: server pytest + client build → Tasks 1-3. ✔

**Placeholder scan:** none — every step is concrete code or an exact command.

**Type/name consistency:** `previewSeed`, `savedDoc`, `previewCounter`, `togglePreview`, `loadSample`, `getMap(sample?)`, `api`, and the reused `doc`/`canvas`/`layerId`/`layerIds`/`zoomPct`/`toast`/`afterDocChange`/`d()` members are used consistently. `handle_map` returns `(status, doc)` as before; `getMap` returns `BoardMap`.
