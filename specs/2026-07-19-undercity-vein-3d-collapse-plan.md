# Undercity Crystal Vein — agency + 3D boulders Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Stop the Crystal Vein from auto-swinging the pick on landing, and replace its flat CSS shaft with a three.js mine-wall that drops boulders on each strike and cascades on a cave-in.

**Architecture:** Part A is a small server change in the Lambda's space-resolver plus a rewritten test. Part B adds `three` as a lazily-imported dependency, a framework-free `VeinCanvas` engine class (mirrors the existing `board-canvas.ts` pattern), and wires it into the `CrystalVeinModalComponent` with a one-way `effect` input driven by the parent's strike response. A CSS fallback keeps the modal working without WebGL.

**Tech Stack:** Python 3.11 Lambda + pytest (server); Angular 20 standalone components + three.js (client). Repo has no JS test runner — client verification is `npm run build` + manual. Run `npm`/`pytest` via the Bash tool on this Windows repo.

**Design:** `specs/2026-07-19-undercity-vein-3d-collapse-design.md`

---

## Task 1: Server — landing opens the shaft without swinging

**Files:**
- Modify: `infrastructure/lambda/undercity_db.py:1506-1513` (the `crystal_vein` branch of `_resolve_space`)
- Modify: `infrastructure/lambda/undercity_db.py` — `_strike` docstring (~line 3200; search `Optional strikes 2-3`)
- Test: `infrastructure/lambda/tests/test_undercity_db.py:1070-1083` (`test_vein_landing_forces_first_strike`)

- [ ] **Step 1: Rewrite the landing test to assert no auto-strike**

Replace `test_vein_landing_forces_first_strike` (lines 1070-1083) with:

```python
def test_vein_landing_opens_without_striking(table, monkeypatch):
    act(table, 'join', starter='pest')
    sid = _sid(table)
    doc = db._get_player(table, sid, 'user-alex')
    doc['position'] = 'cavern_r3'
    db._put_player(table, doc)
    spores_before = doc.get('spores', 0)
    ev = db._resolve_space(table, sid, doc, 'cavern_r3', 'cavern_r2')
    assert ev['type'] == 'crystal_vein'
    assert ev['depth'] == 0                                 # fresh shaft, surface
    assert ev['strikesLeft'] == data.VEIN_STRIKES_PER_VISIT # all swings are the player's
    assert 'collapsed' not in ev                            # no cave-in on arrival
    assert doc['spores'] == spores_before                   # nothing awarded yet
    assert doc['veinStrikesLeft'] == data.VEIN_STRIKES_PER_VISIT
    rec = db._get(table, db._season_pk(sid), 'VEIN#cavern')
    assert rec is None                                      # nothing persisted on landing
```

- [ ] **Step 2: Run the test to verify it fails**

Run: `cd infrastructure/lambda && python -m pytest tests/test_undercity_db.py::test_vein_landing_opens_without_striking -q`
Expected: FAIL — landing still spends a strike, so `strikesLeft` is `VEIN_STRIKES_PER_VISIT - 1` and `spores` increased.

- [ ] **Step 3: Change the landing branch to open-only**

Replace lines 1506-1513 (the `if ntype == 'crystal_vein':` block) with:

```python
    if ntype == 'crystal_vein':
        # Landing just opens the shaft — every swing is a deliberate Strike so
        # the player keeps full agency (no auto-swing, no arrival cave-in).
        doc['veinStrikesLeft'] = data.VEIN_STRIKES_PER_VISIT
        region = data.MAP_NODES[node]['region']
        depth = _vein_rec(table, sid, region)['depth']
        return {'type': 'crystal_vein', 'node': node,
                'strikesLeft': data.VEIN_STRIKES_PER_VISIT, 'depth': depth,
                'text': 'You reach the crystal vein — ready your pick.'}
```

- [ ] **Step 4: Update the `_strike` docstring**

Find the `_strike` function (search `def _strike(table, sid, doc, payload):`) and change its docstring from:

```python
    """Optional strikes 2-3 at the vein (the first happens on landing)."""
```

to:

```python
    """A deliberate swing at the vein. All strikes this visit are optional —
    landing no longer auto-swings."""
```

- [ ] **Step 5: Run the full vein suite to verify green**

Run: `cd infrastructure/lambda && python -m pytest tests/test_undercity_db.py -q -k vein`
Expected: PASS — the new landing test plus `test_vein_strike_action_and_guards`, `test_vein_cave_in_hurts_and_resets`, `test_vein_heartstone_pays_and_resets` (those drive `strike` directly with explicit `veinStrikesLeft`, so they are unaffected).

- [ ] **Step 6: Run the whole Lambda suite**

Run: `cd infrastructure/lambda && python -m pytest tests -q`
Expected: PASS — no other test depended on the auto-strike.

- [ ] **Step 7: Update the stale client comment**

In `src/app/undercity/tabs/board-tab.component.ts`, find the doc comment above the `veinStrikesLeft` computed (search `first is spent on landing`) and change it from:

```ts
  /** Crystal-vein strikes remaining this visit (the first is spent on landing). */
```

to:

```ts
  /** Crystal-vein strikes remaining this visit. */
```

Leave the computed's code unchanged.

- [ ] **Step 8: Commit**

```bash
git add infrastructure/lambda/undercity_db.py infrastructure/lambda/tests/test_undercity_db.py src/app/undercity/tabs/board-tab.component.ts
git commit -m "feat(undercity): vein no longer auto-swings on landing"
```

---

## Task 2: Add three.js as a lazily-imported dependency

**Files:**
- Modify: `package.json` (dependencies + devDependencies)

- [ ] **Step 1: Install three + its types**

Run (via Bash):
```bash
npm install three
npm install -D @types/three
```
Expected: `three` appears under `dependencies` and `@types/three` under `devDependencies` in `package.json`; `package-lock.json` updates.

- [ ] **Step 2: Verify the baseline build still passes**

Run: `npm run build`
Expected: build succeeds. `three` is not imported anywhere yet, so it should NOT appear in any emitted chunk. (If the build emits a bundle-budget warning later, it will be for the lazy vein chunk, which is acceptable.)

- [ ] **Step 3: Commit**

```bash
git add package.json package-lock.json
git commit -m "chore: add three.js dependency for the vein renderer"
```

---

## Task 3: The `VeinCanvas` engine module

**Files:**
- Create: `src/app/undercity/engine/vein-canvas.ts`

No automated test (no JS runner); verified by build + the manual pass in Task 6.

- [ ] **Step 1: Create the engine class**

Create `src/app/undercity/engine/vein-canvas.ts` with exactly:

```ts
/**
 * 3D mine-wall renderer for the Crystal Vein modal. Framework-free; owns its
 * own requestAnimationFrame loop and every three.js resource, mirroring the
 * board-canvas.ts pattern. three.js is loaded via dynamic import() so it ships
 * as a separate lazy chunk that only downloads when a player opens a vein.
 *
 * The component drives it: setDepth() reflects the shared shaft depth, and
 * playStrike()/playCaveIn()/playHeartstone() run scripted boulder animations.
 * No physics engine — all motion is deterministic time-based tweens.
 */
import type * as TN from 'three';

type ThreeModule = typeof import('three');

interface FallingRock {
  mesh: TN.Mesh;
  vy: number;
  vx: number;
  spin: TN.Vector3;
  life: number;
}

export class VeinCanvas {
  private three!: ThreeModule;
  private renderer!: TN.WebGLRenderer;
  private scene!: TN.Scene;
  private camera!: TN.PerspectiveCamera;
  private wall!: TN.Group;
  private crystals: TN.Mesh[] = [];
  private rocks: FallingRock[] = [];
  private rockGeo!: TN.IcosahedronGeometry;
  private rockMat!: TN.MeshStandardMaterial;
  private canvas!: HTMLCanvasElement;
  private raf = 0;
  private lastT = 0;
  private shake = 0;
  private disposed = false;

  /** Lazy-load three, build the scene, start the loop. Returns false if WebGL
   *  or the three import is unavailable so the caller can fall back to CSS. */
  async mount(canvas: HTMLCanvasElement): Promise<boolean> {
    try {
      this.three = await import('three');
    } catch {
      return false;
    }
    if (this.disposed) return false;
    const T = this.three;
    this.canvas = canvas;
    try {
      this.renderer = new T.WebGLRenderer({ canvas, antialias: true, alpha: true });
    } catch {
      return false;
    }
    this.renderer.setPixelRatio(Math.min(window.devicePixelRatio || 1, 2));

    this.scene = new T.Scene();
    this.camera = new T.PerspectiveCamera(50, 1.5, 0.1, 100);
    this.camera.position.set(0, 0, 7);

    this.scene.add(new T.AmbientLight(0x6b7a80, 0.9));
    const key = new T.DirectionalLight(0xffffff, 0.8);
    key.position.set(3, 5, 4);
    this.scene.add(key);
    const glow = new T.PointLight(0x8fd0dd, 1.4, 24);
    glow.position.set(0, -1, 3);
    this.scene.add(glow);

    this.rockGeo = this.makeRockGeo();
    this.rockMat = new T.MeshStandardMaterial({
      color: 0x5a4a36, flatShading: true, roughness: 1,
    });

    this.wall = new T.Group();
    this.scene.add(this.wall);
    this.buildWall();

    this.resize();
    this.lastT = performance.now();
    this.loop();
    return true;
  }

  private makeRockGeo(): TN.IcosahedronGeometry {
    const geo = new this.three.IcosahedronGeometry(0.5, 0);
    const pos = geo.attributes['position'];
    for (let i = 0; i < pos.count; i++) {
      const j = 0.85 + Math.random() * 0.3;
      pos.setXYZ(i, pos.getX(i) * j, pos.getY(i) * j, pos.getZ(i) * j);
    }
    geo.computeVertexNormals();
    return geo;
  }

  private buildWall(): void {
    const T = this.three;
    const back = new T.Mesh(
      new T.PlaneGeometry(14, 10),
      new T.MeshStandardMaterial({ color: 0x2a2018, flatShading: true, roughness: 1 }),
    );
    back.position.z = -1.5;
    this.wall.add(back);

    for (let gx = -3; gx <= 3; gx++) {
      for (let gy = -2; gy <= 2; gy++) {
        const m = new T.Mesh(this.rockGeo, this.rockMat);
        m.position.set(
          gx * 1.2 + (Math.random() - 0.5) * 0.4,
          gy * 1.2 + (Math.random() - 0.5) * 0.4,
          0,
        );
        m.scale.setScalar(0.8 + Math.random() * 0.7);
        m.rotation.set(Math.random() * 6, Math.random() * 6, Math.random() * 6);
        this.wall.add(m);
      }
    }

    const cMat = new T.MeshStandardMaterial({
      color: 0x8fd0dd, emissive: 0x2f6f7d, flatShading: true,
      transparent: true, opacity: 0.92,
    });
    for (let i = 0; i < 8; i++) {
      const c = new T.Mesh(new T.OctahedronGeometry(0.35, 0), cMat.clone());
      c.position.set((Math.random() - 0.5) * 8, (Math.random() - 0.5) * 6, 0.5);
      c.scale.y = 1.8;
      c.visible = false;
      this.crystals.push(c);
      this.wall.add(c);
    }
  }

  /** Reveal a fraction of the crystals proportional to shared shaft depth. */
  setDepth(depth: number, max: number): void {
    if (this.disposed || !this.crystals.length) return;
    const show = Math.round((Math.max(0, depth) / max) * this.crystals.length);
    this.crystals.forEach((c, i) => (c.visible = i < show));
  }

  /** A normal swing: light shake, a few boulders dislodge. */
  playStrike(): void {
    if (this.disposed) return;
    this.shake = Math.max(this.shake, 0.25);
    for (let i = 0; i < 4; i++) this.spawnRock((Math.random() - 0.5) * 3, 2 + Math.random());
  }

  /** A cave-in: hard shake, heavy cascade from the top. */
  playCaveIn(): void {
    if (this.disposed) return;
    this.shake = Math.max(this.shake, 0.7);
    for (let i = 0; i < 22; i++) {
      this.spawnRock((Math.random() - 0.5) * 9, 4 + Math.random() * 3, 0.7 + Math.random() * 0.8);
    }
  }

  /** Max-depth reward: light all crystals and a small shimmer shake. */
  playHeartstone(): void {
    if (this.disposed) return;
    this.crystals.forEach((c) => (c.visible = true));
    this.shake = Math.max(this.shake, 0.3);
  }

  private spawnRock(x: number, y: number, scale = 0.6 + Math.random() * 0.6): void {
    const T = this.three;
    const m = new T.Mesh(this.rockGeo, this.rockMat);
    m.position.set(x, y, 0.6);
    m.scale.setScalar(scale);
    this.wall.add(m);
    this.rocks.push({
      mesh: m,
      vy: -(1 + Math.random()),
      vx: (Math.random() - 0.5) * 1.2,
      spin: new T.Vector3(Math.random() * 4, Math.random() * 4, Math.random() * 4),
      life: 0,
    });
  }

  resize(): void {
    if (this.disposed || !this.renderer) return;
    const w = this.canvas.clientWidth || 300;
    const h = this.canvas.clientHeight || 180;
    this.renderer.setSize(w, h, false);
    this.camera.aspect = w / h;
    this.camera.updateProjectionMatrix();
  }

  private loop = (): void => {
    if (this.disposed) return;
    const now = performance.now();
    const dt = Math.min(0.05, (now - this.lastT) / 1000);
    this.lastT = now;
    this.step(dt);
    this.renderer.render(this.scene, this.camera);
    this.raf = requestAnimationFrame(this.loop);
  };

  private step(dt: number): void {
    const g = 9;
    for (let i = this.rocks.length - 1; i >= 0; i--) {
      const r = this.rocks[i];
      r.vy -= g * dt;
      r.mesh.position.x += r.vx * dt;
      r.mesh.position.y += r.vy * dt;
      r.mesh.rotation.x += r.spin.x * dt;
      r.mesh.rotation.y += r.spin.y * dt;
      r.life += dt;
      if (r.mesh.position.y < -6 || r.life > 4) {
        this.wall.remove(r.mesh);
        this.rocks.splice(i, 1);
      }
    }
    if (this.shake > 0) {
      this.shake = Math.max(0, this.shake - dt);
      this.camera.position.x = (Math.random() - 0.5) * this.shake;
      this.camera.position.y = (Math.random() - 0.5) * this.shake;
    } else if (this.camera) {
      this.camera.position.x = 0;
      this.camera.position.y = 0;
    }
    for (const c of this.crystals) if (c.visible) c.rotation.y += dt * 0.6;
  }

  dispose(): void {
    this.disposed = true;
    if (this.raf) cancelAnimationFrame(this.raf);
    this.rocks = [];
    if (this.scene) {
      this.scene.traverse((o: TN.Object3D) => {
        const mesh = o as TN.Mesh;
        if (mesh.geometry) mesh.geometry.dispose();
        const mat = mesh.material;
        if (mat) {
          const mats = Array.isArray(mat) ? mat : [mat];
          mats.forEach((m) => m.dispose());
        }
      });
    }
    if (this.renderer) this.renderer.dispose();
  }
}
```

- [ ] **Step 2: Verify it compiles**

Run: `npm run build`
Expected: build succeeds and now emits an additional lazy chunk containing three.js (visible in the build output as a separate `chunk-*.js`). Nothing imports `VeinCanvas` yet, so it is tree-shaken; the goal of this step is only that the file type-checks.

- [ ] **Step 3: Commit**

```bash
git add src/app/undercity/engine/vein-canvas.ts
git commit -m "feat(undercity): add VeinCanvas three.js mine-wall renderer"
```

---

## Task 4: Wire the canvas into the Crystal Vein modal

**Files:**
- Modify: `src/app/undercity/tabs/crystal-vein.component.ts`

- [ ] **Step 1: Add imports, the `VeinEffect` type, and lifecycle hooks**

At the top of `crystal-vein.component.ts`, change the Angular import line to include the lifecycle/query symbols:

```ts
import {
  Component,
  EventEmitter,
  Input,
  Output,
  ViewChild,
  ElementRef,
  AfterViewInit,
  OnChanges,
  OnDestroy,
  SimpleChanges,
} from '@angular/core';
import { CommonModule } from '@angular/common';
import { VEIN_CAVE_IN_PCT_PER_LEVEL, VEIN_MAX_DEPTH } from '../data/vein-vault';
import { VeinCanvas } from '../engine/vein-canvas';

/** Which scripted animation the 3D wall should play, with a monotonic `seq`
 *  so repeat kinds (two strikes in a row) still retrigger via ngOnChanges. */
export interface VeinEffect {
  kind: 'strike' | 'cave-in' | 'heartstone';
  seq: number;
}
```

- [ ] **Step 2: Replace the `.shaft` block in the template with the canvas + fallback**

In the template, replace the existing shaft block:

```html
        <div class="shaft">
          @for (lv of levels; track lv) {
            <div
              class="rung"
              [class.dug]="lv <= depth"
              [class.next]="lv === depth + 1"
              [class.heart]="lv === MAX"
            ></div>
          }
        </div>
```

with:

```html
        <div class="vein-stage">
          @if (!failed) {
            <canvas #veinCanvas class="vein-canvas" [class.hidden]="!ready"></canvas>
          }
          @if (failed) {
            <div class="shaft">
              @for (lv of levels; track lv) {
                <div
                  class="rung"
                  [class.dug]="lv <= depth"
                  [class.next]="lv === depth + 1"
                  [class.heart]="lv === MAX"
                ></div>
              }
            </div>
          }
        </div>
```

- [ ] **Step 3: Add stage/canvas styles**

In the component `styles` array, add these rules (keep the existing `.shaft` / `.rung` rules for the fallback):

```css
      .vein-stage {
        position: relative;
        width: 100%;
        height: 180px;
        margin: 2px auto;
      }
      .vein-canvas {
        width: 100%;
        height: 100%;
        display: block;
        border-radius: 10px;
      }
      .vein-canvas.hidden {
        visibility: hidden;
      }
```

- [ ] **Step 4: Implement the component lifecycle**

Change the class declaration and add members/hooks. Replace:

```ts
export class CrystalVeinModalComponent {
  @Input() depth = 0;
  @Input() strikesLeft = 0;
  @Input() busy = false;
  @Input() log: string | null = null;
  /** Region biome wash painted behind the card (from the board tab). */
  @Input() washBg: string | null = null;
  @Output() strike = new EventEmitter<void>();
  @Output() closed = new EventEmitter<void>();

  protected readonly MAX = VEIN_MAX_DEPTH;
  protected readonly levels = Array.from({ length: VEIN_MAX_DEPTH }, (_, i) => i + 1);

  protected get riskPct(): number {
    return Math.round((this.depth + 1) * VEIN_CAVE_IN_PCT_PER_LEVEL * 100);
  }
}
```

with:

```ts
export class CrystalVeinModalComponent implements AfterViewInit, OnChanges, OnDestroy {
  @Input() depth = 0;
  @Input() strikesLeft = 0;
  @Input() busy = false;
  @Input() log: string | null = null;
  /** Region biome wash painted behind the card (from the board tab). */
  @Input() washBg: string | null = null;
  /** Set by the parent after each strike response to trigger a wall animation. */
  @Input() effect: VeinEffect | null = null;
  @Output() strike = new EventEmitter<void>();
  @Output() closed = new EventEmitter<void>();

  @ViewChild('veinCanvas') private canvasRef?: ElementRef<HTMLCanvasElement>;

  protected readonly MAX = VEIN_MAX_DEPTH;
  protected readonly levels = Array.from({ length: VEIN_MAX_DEPTH }, (_, i) => i + 1);
  protected ready = false;
  protected failed = false;

  private readonly vein = new VeinCanvas();
  private lastSeq = -1;
  private resizeObs?: ResizeObserver;

  protected get riskPct(): number {
    return Math.round((this.depth + 1) * VEIN_CAVE_IN_PCT_PER_LEVEL * 100);
  }

  async ngAfterViewInit(): Promise<void> {
    const el = this.canvasRef?.nativeElement;
    if (!el) {
      this.failed = true;
      return;
    }
    const ok = await this.vein.mount(el);
    if (!ok) {
      this.failed = true;
      return;
    }
    this.ready = true;
    this.vein.setDepth(this.depth, this.MAX);
    this.resizeObs = new ResizeObserver(() => this.vein.resize());
    this.resizeObs.observe(el);
  }

  ngOnChanges(ch: SimpleChanges): void {
    if (ch['depth'] && this.ready) this.vein.setDepth(this.depth, this.MAX);
    if (ch['effect'] && this.ready && this.effect && this.effect.seq !== this.lastSeq) {
      this.lastSeq = this.effect.seq;
      if (this.effect.kind === 'cave-in') this.vein.playCaveIn();
      else if (this.effect.kind === 'heartstone') this.vein.playHeartstone();
      else this.vein.playStrike();
    }
  }

  ngOnDestroy(): void {
    this.resizeObs?.disconnect();
    this.vein.dispose();
  }
}
```

- [ ] **Step 5: Verify the build**

Run: `npm run build`
Expected: build succeeds. The Undercity feature now references `VeinCanvas`, so the three.js lazy chunk is retained.

- [ ] **Step 6: Commit**

```bash
git add src/app/undercity/tabs/crystal-vein.component.ts
git commit -m "feat(undercity): render the vein shaft in 3D with a CSS fallback"
```

---

## Task 5: Parent drives the animation from the strike response

**Files:**
- Modify: `src/app/undercity/tabs/board-tab.component.ts` (`strike()`, `openVein()`, imports, a new signal)
- Modify: `src/app/undercity/tabs/board-tab.component.html:510-518`

- [ ] **Step 1: Import `VeinEffect` and add a signal**

In `board-tab.component.ts`, add to the crystal-vein import line:

```ts
import { CrystalVeinModalComponent, VeinEffect } from './crystal-vein.component';
```

Near the other vein signals (search `veinDepth = signal`), add:

```ts
  /** Latest vein animation cue for the 3D wall; seq bumps so repeats retrigger. */
  protected readonly veinEffect = signal<VeinEffect | null>(null);
```

- [ ] **Step 2: Reset the cue when the modal opens**

In `openVein(...)` (search `openVein(ev?: SpaceEvent)`), add as the first line of the body:

```ts
    this.veinEffect.set(null);
```

This prevents a stale cue from the previous visit replaying when the modal reopens.

- [ ] **Step 3: Emit a cue from `strike()`**

Replace the body of `strike()` with:

```ts
  async strike(): Promise<void> {
    await this.run(async () => {
      const resp = await this.store.action('strike');
      if (resp.depth !== undefined) this.veinDepth.set(resp.depth);
      this.veinLog.set(resp.text ?? null);
      const kind: VeinEffect['kind'] = resp.collapsed
        ? 'cave-in'
        : resp.heartstone
          ? 'heartstone'
          : 'strike';
      this.veinEffect.set({ kind, seq: (this.veinEffect()?.seq ?? 0) + 1 });
      if (resp.collapsed || resp.heartstone) this.showToast(resp.text ?? '');
    });
  }
```

- [ ] **Step 4: Bind the new input in the template**

In `board-tab.component.html`, add the `[effect]` binding to the `<app-undercity-crystal-vein>` element (lines 510-518):

```html
  @if (showVein()) {
    <app-undercity-crystal-vein
      [depth]="veinDepth()"
      [strikesLeft]="veinStrikesLeft()"
      [busy]="busy()"
      [log]="veinLog()"
      [washBg]="regionWashBg()"
      [effect]="veinEffect()"
      (strike)="strike()"
      (closed)="closeFacilities()"
    />
  }
```

- [ ] **Step 5: Verify the build**

Run: `npm run build`
Expected: build succeeds with no type errors.

- [ ] **Step 6: Commit**

```bash
git add src/app/undercity/tabs/board-tab.component.ts src/app/undercity/tabs/board-tab.component.html
git commit -m "feat(undercity): cue vein wall animations from the strike response"
```

---

## Task 6: End-to-end verification

**Files:** none (verification only)

- [ ] **Step 1: Full Lambda test suite**

Run: `cd infrastructure/lambda && python -m pytest tests -q`
Expected: PASS.

- [ ] **Step 2: Production build**

Run: `npm run build`
Expected: PASS. Note whether the vein/three chunk trips an Angular bundle-budget warning; a warning on the lazy chunk is acceptable, an error is not (if it errors, raise the `anyComponentStyle`/`initial` budget is unrelated — the lazy chunk does not count against the initial budget, so investigate the specific message).

- [ ] **Step 3: Manual play-through**

Run: `npm start`, open http://localhost:4200/undercity, join a session, and move a token onto a `cavern` crystal-vein node. Confirm:
- Landing shows "You reach the crystal vein — ready your pick." and **does not** spend a strike (strikes-left reads 3, no spores gained, no cave-in).
- Tapping ⛏️ Strike shakes the wall and drops a few boulders each time; depth crystals appear as the shaft deepens.
- Forcing a deep shaft (via the admin panel or repeated strikes) and triggering a cave-in plays the heavy cascade and resets the wall.

- [ ] **Step 4: Fallback check**

In the browser devtools, disable WebGL (or run in a context without it) and reopen the vein. Confirm the CSS rung shaft renders and the Strike/Leave buttons still work.

- [ ] **Step 5: Final commit (if any verification fixups were needed)**

```bash
git add -A
git commit -m "chore(undercity): verification fixups for vein 3D"
```
(Skip if nothing changed.)
