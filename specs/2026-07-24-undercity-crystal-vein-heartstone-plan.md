# Crystal Vein — Reachable Heartstone + Per-Hit Spore Feedback Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** A cave-in stops resetting the shared crystal-vein shaft (so the Heartstone at level 12 is actually reachable), and each successful strike's Spores become visible via a running "earned this visit" tally, a 3D spore-particle burst, and clearer copy.

**Architecture:** One server-side rule change in the Python Lambda engine (`_vein_strike_once`) plus its test; the rest is client presentation in the Angular vein modal, its parent board tab, and the WebGL vein canvas. No new data model, no balance-number changes.

**Tech Stack:** Python 3.11 Lambda + pytest (in-memory FakeTable suite); Angular 20 standalone components + signals; three.js (dynamic-imported) for the vein canvas. Frontend has no test runner — verify with `npm run build` + the run-undercity skill.

Spec: [specs/2026-07-24-undercity-crystal-vein-heartstone-design.md](2026-07-24-undercity-crystal-vein-heartstone-design.md)

---

### Task 1: Cave-in holds the shaft (backend + tests)

**Files:**
- Modify: `infrastructure/lambda/undercity_db.py` (`_vein_strike_once`, ~lines 5050-5082)
- Modify: `infrastructure/lambda/tests/test_undercity_db.py` (cave-in test ~1722, heartstone test ~1766)

- [ ] **Step 1: Update the tests to the new behaviour (they will fail first)**

Replace `test_vein_cave_in_hurts_and_resets` (lines 1722-1739) with:

```python
def test_vein_cave_in_hurts_but_shaft_holds(table, monkeypatch):
    act(table, 'join', starter='pest')
    sid = _sid(table)
    db._save_vein(table, sid, 'cavern', 9)                 # deep, dangerous shaft
    doc = db._get_player(table, sid, 'user-alex')
    doc['position'] = 'cavern_r3'
    doc['veinStrikesLeft'] = data.VEIN_STRIKES_PER_VISIT   # landed, ready to swing
    hp_before = doc['hp']
    db._put_player(table, doc)
    monkeypatch.setattr(db._rng, 'random', lambda: 0.0)    # guaranteed cave-in
    status, resp = act(table, 'strike')                    # the swing triggers the collapse
    assert status == 200
    assert resp['collapsed'] is True
    assert resp['depth'] == 9                              # shaft holds at its prior depth
    doc = db._get_player(table, sid, 'user-alex')
    assert doc['hp'] == max(1, hp_before - 10 * data.VEIN_CAVE_IN_DMG_PER_LEVEL)
    assert doc['veinStrikesLeft'] == 0                     # the visit still ends
    rec = db._get(table, db._season_pk(sid), 'VEIN#cavern')
    assert rec['depth'] == 9                               # NOT reset — progress is kept
```

In `test_vein_heartstone_pays_and_resets`, add one assertion after line 1782
(`assert resp['you']['spores'] == ...`) to lock the new `resp['spores']` total:

```python
    assert resp['spores'] == 13 + data.VEIN_HEARTSTONE_SPORES   # level spores + bonus
```

- [ ] **Step 2: Run the tests to verify they fail**

Run: `cd infrastructure/lambda && python -m pytest tests/test_undercity_db.py -k "vein_cave_in or heartstone_pays" -q`
Expected: FAIL — `test_vein_cave_in_hurts_but_shaft_holds` fails on `resp['depth'] == 9` (gets 0) and `rec['depth'] == 9` (gets 0); the heartstone test fails on the new `resp['spores']` assertion (gets 13, not 53).

- [ ] **Step 3: Make the cave-in hold the shaft and include the Heartstone bonus in `resp['spores']`**

In `infrastructure/lambda/undercity_db.py`, replace the cave-in branch of
`_vein_strike_once` (currently):

```python
    if _rng.random() < level * data.VEIN_CAVE_IN_PCT_PER_LEVEL:
        dmg = level * data.VEIN_CAVE_IN_DMG_PER_LEVEL
        doc['hp'] = max(1, doc['hp'] - dmg)
        doc['veinStrikesLeft'] = 0
        _save_vein(table, sid, region, 0)
        _event(table, sid, 'vein',
               f"{doc['username']} triggered a cave-in at level {level} of the "
               'crystal vein — the shaft collapses to the surface!',
               actor=doc['userId'])
        return {'collapsed': True, 'hp': -dmg, 'depth': 0,
                'text': f'CAVE-IN at level {level}! You take {dmg} damage and '
                        'the shaft slumps back to the surface.'}
```

with:

```python
    if _rng.random() < level * data.VEIN_CAVE_IN_PCT_PER_LEVEL:
        dmg = level * data.VEIN_CAVE_IN_DMG_PER_LEVEL
        doc['hp'] = max(1, doc['hp'] - dmg)
        doc['veinStrikesLeft'] = 0
        # The shaft HOLDS: a cave-in batters the digger and ends their visit, but
        # no longer wipes the shared depth — so the vein ratchets up to the
        # Heartstone over many visits instead of resetting to 0 every cave-in.
        held = level - 1                                   # unchanged shared depth
        _event(table, sid, 'vein',
               f"{doc['username']} triggered a cave-in at level {level} of the "
               'crystal vein — battered by the rockfall, but the shaft holds.',
               actor=doc['userId'])
        return {'collapsed': True, 'hp': -dmg, 'depth': held,
                'text': f'CAVE-IN at level {level}! A rockfall hits you for {dmg} '
                        'damage — but the shaft holds.'}
```

Then in the Heartstone branch, change the return's `spores` from `spores` to
include the bonus. Replace:

```python
        return {'depth': 0, 'heartstone': True, 'spores': spores, 'found': heart,
```

with:

```python
        return {'depth': 0, 'heartstone': True,
                'spores': spores + data.VEIN_HEARTSTONE_SPORES, 'found': heart,
```

(This only changes the reported total; `doc['spores']` was already incremented by
both amounts above, so the player's balance is unchanged.)

- [ ] **Step 4: Run the tests to verify they pass**

Run: `cd infrastructure/lambda && python -m pytest tests/test_undercity_db.py -k "vein_cave_in or heartstone_pays" -q`
Expected: PASS (2 passed)

- [ ] **Step 5: Run the full engine suite to confirm nothing else broke**

Run: `cd infrastructure/lambda && python -m pytest tests -q`
Expected: all green.

- [ ] **Step 6: Commit**

```bash
git add infrastructure/lambda/undercity_db.py infrastructure/lambda/tests/test_undercity_db.py
git commit -m "feat(undercity): crystal-vein cave-in holds the shaft so the Heartstone is reachable"
```

---

### Task 2: Client wiring — tally, response plumbing, framing copy

**Files:**
- Modify: `src/app/undercity/services/undercity-models.ts` (`ActionResponse`, ~line 681)
- Modify: `src/app/undercity/tabs/crystal-vein.component.ts` (`VeinEffect`, template sub-line + hint, `@Input`)
- Modify: `src/app/undercity/tabs/board-tab.component.ts` (`veinEarned` signal, `openVein`, `strike`)
- Modify: `src/app/undercity/tabs/board-tab.component.html` (modal binding, ~line 827)

- [ ] **Step 1: Add `spores` to `ActionResponse`**

In `undercity-models.ts`, inside `interface ActionResponse`, add a field next to
the vein fields. Change:

```ts
  depth?: number;
  collapsed?: boolean;
  heartstone?: boolean;
  strikesLeft?: number;
```

to:

```ts
  depth?: number;
  collapsed?: boolean;
  heartstone?: boolean;
  /** Spores gained on a vein strike (includes the Heartstone bonus). */
  spores?: number;
  strikesLeft?: number;
```

- [ ] **Step 2: Extend `VeinEffect` and add the `earnedThisVisit` input**

In `crystal-vein.component.ts`, change the `VeinEffect` interface:

```ts
export interface VeinEffect {
  kind: 'strike' | 'cave-in' | 'heartstone';
  seq: number;
  /** Spores gained on this strike — drives the particle-burst count. */
  spores?: number;
}
```

And add the input alongside the other `@Input()`s (after `log`):

```ts
  /** Spores banked from strikes so far this visit (parent-owned). */
  @Input() earnedThisVisit = 0;
```

- [ ] **Step 3: Render the tally and replace the hint copy**

In the `crystal-vein.component.ts` template, replace the `.vein-sub` paragraph:

```html
        <p class="vein-sub">
          Shaft depth <strong>{{ depth }}</strong> / {{ MAX }} ·
          <strong>{{ strikesLeft }}</strong> strike{{ strikesLeft === 1 ? '' : 's' }} left this
          visit
        </p>
```

with:

```html
        <p class="vein-sub">
          Shaft depth <strong>{{ depth }}</strong> / {{ MAX }} ·
          <strong>{{ strikesLeft }}</strong> strike{{ strikesLeft === 1 ? '' : 's' }} left ·
          earned this visit: <strong #earnedEl class="earned">{{ earnedThisVisit }}</strong> 🍄
        </p>
```

Then replace the strike hint paragraph:

```html
          <p class="vein-hint">
            A cave-in hurts you and collapses the shaft for everyone. Walking away leaves the
            depth for the next digger.
          </p>
```

with:

```html
          <p class="vein-hint">
            Every strike's Spores are yours to keep. Go deeper for bigger hits and the
            Heartstone at level {{ MAX }} — a cave-in costs HP and ends your dig here, but
            the shaft holds. Walking away leaves the depth for the next digger.
          </p>
```

Add an `.earned` style inside the component `styles` array (next to `.vein-sub strong`):

```css
      .earned {
        color: #b6ffbf;
        display: inline-block;
      }
```

- [ ] **Step 4: Wire `veinEarned` in the board tab**

In `board-tab.component.ts`, add the signal after `veinLog` (line ~256):

```ts
  protected readonly veinEarned = signal(0);
```

In `openVein(ev?: SpaceEvent)`, reset the tally at the start of a fresh visit
(a landing carries `ev`; a tab-switch restore calls `openVein()` with none).
Add this line right after `this.veinEffect.set(null);`:

```ts
    if (ev) this.veinEarned.set(0); // fresh visit — start the tally over
```

Replace the body of `strike()` with (adds accumulation + passes `spores` to the effect):

```ts
  async strike(): Promise<void> {
    await this.run(async () => {
      const resp = await this.store.action('strike');
      if (resp.depth !== undefined) this.veinDepth.set(resp.depth);
      this.veinLog.set(resp.text ?? null);
      if (!resp.collapsed && resp.spores) this.veinEarned.update((n) => n + resp.spores!);
      const kind: VeinEffect['kind'] = resp.collapsed
        ? 'cave-in'
        : resp.heartstone
          ? 'heartstone'
          : 'strike';
      this.veinEffect.set({
        kind,
        seq: (this.veinEffect()?.seq ?? 0) + 1,
        spores: resp.spores,
      });
      if (resp.collapsed || resp.heartstone) this.showToast(resp.text ?? '');
    });
  }
```

- [ ] **Step 5: Bind the input on the modal**

In `board-tab.component.html`, add the binding to `<app-undercity-crystal-vein>`
(after `[log]="veinLog()"`, line ~831):

```html
      [earnedThisVisit]="veinEarned()"
```

- [ ] **Step 6: Build**

Run: `npm run build`
Expected: build succeeds, no TypeScript/template errors.

- [ ] **Step 7: Commit**

```bash
git add src/app/undercity/services/undercity-models.ts src/app/undercity/tabs/crystal-vein.component.ts src/app/undercity/tabs/board-tab.component.ts src/app/undercity/tabs/board-tab.component.html
git commit -m "feat(undercity): crystal-vein earned-this-visit tally + clearer press-your-luck copy"
```

---

### Task 3: 3D spore-particle burst + tally pulse

**Files:**
- Modify: `src/app/undercity/engine/vein-canvas.ts` (spore motes)
- Modify: `src/app/undercity/tabs/crystal-vein.component.ts` (pass `spores` to canvas; pulse the tally)

The tally pulse (via the Web Animations API) is the universal feedback and also
serves as the no-WebGL fallback, since it runs whether or not the canvas mounted.

- [ ] **Step 1: Add the spore-mote type and fields to the canvas**

In `vein-canvas.ts`, after the `FallingRock` interface add:

```ts
interface SporeMote {
  mesh: TN.Mesh;
  vy: number;
  vx: number;
  life: number;
  ttl: number;
}
```

Add fields to the class next to `private rocks: FallingRock[] = [];`:

```ts
  private motes: SporeMote[] = [];
  private sporeGeo!: TN.OctahedronGeometry;
```

- [ ] **Step 2: Build the spore geometry in `mount`**

In `mount()`, right after `this.rockGeo = this.makeRockGeo();`, add:

```ts
    this.sporeGeo = new T.OctahedronGeometry(1, 0);
```

- [ ] **Step 3: Add the spore-spawn helper**

In `vein-canvas.ts`, add this method (e.g. after `spawnRock`):

```ts
  /** Emit glowing spore motes from the lit crystals that rise and fade — the
   *  visible "you earned Spores" burst. Count scales with the payout. */
  private spawnSpores(count: number): void {
    const T = this.three;
    const lit = this.crystals.filter((c) => c.visible);
    const from = lit.length ? lit : this.crystals;
    for (let i = 0; i < count; i++) {
      const src = from[Math.floor(Math.random() * from.length)];
      const mat = new T.MeshStandardMaterial({
        color: 0x9be7a0,
        emissive: 0x3f8f5a,
        flatShading: true,
        transparent: true,
        opacity: 1,
      });
      const m = new T.Mesh(this.sporeGeo, mat);
      const base = src ? src.position : { x: 0, y: 0 };
      m.position.set(base.x + (Math.random() - 0.5) * 0.6, base.y + (Math.random() - 0.5) * 0.6, 0.9);
      m.scale.setScalar(0.12 + Math.random() * 0.1);
      this.wall.add(m);
      this.motes.push({
        mesh: m,
        vy: 1.2 + Math.random() * 1.0,
        vx: (Math.random() - 0.5) * 0.8,
        life: 0,
        ttl: 0.9 + Math.random() * 0.5,
      });
    }
  }
```

- [ ] **Step 4: Fire spores from `playStrike` / `playHeartstone`**

Replace `playStrike()`:

```ts
  /** A normal swing: light shake, a few boulders dislodge. */
  playStrike(): void {
    if (this.disposed) return;
    this.shake = Math.max(this.shake, 0.25);
    for (let i = 0; i < 4; i++) this.spawnRock((Math.random() - 0.5) * 3, 2 + Math.random());
  }
```

with:

```ts
  /** A normal swing: light shake, a few boulders dislodge, spores burst free. */
  playStrike(spores = 0): void {
    if (this.disposed) return;
    this.shake = Math.max(this.shake, 0.25);
    for (let i = 0; i < 4; i++) this.spawnRock((Math.random() - 0.5) * 3, 2 + Math.random());
    this.spawnSpores(Math.min(Math.max(spores, 3), 14));
  }
```

Replace `playHeartstone()`:

```ts
  /** Max-depth reward: light all crystals and a small shimmer shake. */
  playHeartstone(): void {
    if (this.disposed) return;
    this.crystals.forEach((c) => (c.visible = true));
    this.shake = Math.max(this.shake, 0.3);
  }
```

with:

```ts
  /** Max-depth reward: light all crystals, a shimmer shake, a big spore burst. */
  playHeartstone(spores = 0): void {
    if (this.disposed) return;
    this.crystals.forEach((c) => (c.visible = true));
    this.shake = Math.max(this.shake, 0.3);
    this.spawnSpores(Math.min(Math.max(spores, 12), 24));
  }
```

- [ ] **Step 5: Animate and retire motes in `step`**

In `step(dt)`, after the falling-rock loop (right before the `if (this.shake > 0)` block), add:

```ts
    for (let i = this.motes.length - 1; i >= 0; i--) {
      const p = this.motes[i];
      p.life += dt;
      p.vy -= 1.5 * dt; // gentle gravity so they arc up then settle
      p.mesh.position.x += p.vx * dt;
      p.mesh.position.y += p.vy * dt;
      p.mesh.rotation.y += dt * 2;
      const mat = p.mesh.material as TN.MeshStandardMaterial;
      mat.opacity = Math.max(0, 1 - p.life / p.ttl);
      if (p.life >= p.ttl) {
        this.wall.remove(p.mesh);
        mat.dispose();
        this.motes.splice(i, 1);
      }
    }
```

- [ ] **Step 6: Clear motes on dispose**

In `dispose()`, next to `this.rocks = [];` add:

```ts
    this.motes = [];
```

(Live motes still parented to `this.wall` are freed by the existing
`scene.traverse(... dispose ...)` below; the shared `sporeGeo` is disposed there too.)

- [ ] **Step 7: Pass `spores` from the component and pulse the tally**

`ViewChild` and `ElementRef` are already imported in this component (used for
`veinCanvas`) — no import change is needed. Add the tally ref next to the
existing `@ViewChild('veinCanvas')`:

```ts
  @ViewChild('earnedEl') private earnedRef?: ElementRef<HTMLElement>;
```

Replace the `ngOnChanges` body:

```ts
  ngOnChanges(ch: SimpleChanges): void {
    if (ch['depth'] && this.ready) this.vein.setDepth(this.depth, this.MAX);
    if (
      ch['earnedThisVisit'] &&
      !ch['earnedThisVisit'].firstChange &&
      ch['earnedThisVisit'].currentValue > ch['earnedThisVisit'].previousValue
    ) {
      this.pulseEarned();
    }
    if (ch['effect'] && this.ready && this.effect && this.effect.seq !== this.lastSeq) {
      this.lastSeq = this.effect.seq;
      if (this.effect.kind === 'cave-in') this.vein.playCaveIn();
      else if (this.effect.kind === 'heartstone') this.vein.playHeartstone(this.effect.spores);
      else this.vein.playStrike(this.effect.spores);
    }
  }

  /** Scale + colour flash on the tally each time it climbs — the universal
   *  "Spores gained" cue that also covers the no-WebGL fallback. */
  private pulseEarned(): void {
    this.earnedRef?.nativeElement.animate(
      [
        { transform: 'scale(1)', color: '#b6ffbf' },
        { transform: 'scale(1.55)', color: '#ffffff' },
        { transform: 'scale(1)', color: '#b6ffbf' },
      ],
      { duration: 420, easing: 'ease-out' },
    );
  }
```

- [ ] **Step 8: Build**

Run: `npm run build`
Expected: build succeeds, no TypeScript/template errors.

- [ ] **Step 9: Commit**

```bash
git add src/app/undercity/engine/vein-canvas.ts src/app/undercity/tabs/crystal-vein.component.ts
git commit -m "feat(undercity): crystal-vein 3D spore-burst on strike + tally pulse feedback"
```

---

### Task 4: Verify in the real app

**Files:** none (verification only)

- [ ] **Step 1: Drive a vein**

Invoke the `run-undercity` skill to launch the dev server and reach a Crystal Vein
modal against the live backend.

- [ ] **Step 2: Confirm behaviour**

- Striking climbs the "earned this visit: N 🍄" tally, which pulses on each gain, and spore motes burst off the crystals.
- The odds line and depth update as before.
- Trigger a cave-in (strike a deep shaft): you take HP damage and your strikes end, but the shaft depth **holds** (the crystals do not drop back to empty) and the log says the shaft holds — no "collapses to the surface".
- Reaching level 12 fires the Heartstone (big spore burst, +40 bonus in the tally) and refills the shaft to 0.

Note: the cave-in rule is server-side — verifying the "shaft holds" behaviour requires the updated Lambda. If it is not yet deployed, confirm the client build and the pytest suite instead, and flag that the backend deploy is pending.

---

## Notes / deferred (from spec)

- No risk-model change beyond the cave-in reset: Spores stay banked-safe per hit.
- No balance-number changes (cave-in odds/damage, Heartstone payout, strikes/visit).
- **Deploy (user runs):** the cave-in change needs a **Lambda deploy** (`cdk deploy` from `infrastructure/`) to take effect; the client changes ship with the normal frontend deploy. A frontend-only deploy would show the new copy/animation but keep the old reset behaviour live.
