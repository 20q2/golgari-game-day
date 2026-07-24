# Rolled Egg Color + Recolor Fix Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Let players change colors again (fix the "you do not own that paint" lock), and replace the veteran shell-color picker with a single locked color-wheel spin whose result is granted as an owned paint.

**Architecture:** Three coordinated changes — (1) server `_customize` never blocks a paint region whose hue is unchanged (recovers already-stuck players, no migration); (2) server grants a veteran's rolled shell color as an owned paint at hatch; (3) client hatch flow replaces the shell swatch grid with a locked spin. The rolled color is resolved server-side from the hatched body hue via a new `HUE_TO_PAINT` reverse map, so no new join payload field is needed.

**Tech Stack:** Python 3.11 Lambda engine (pytest suite), Angular 20 standalone client (no frontend test runner — verify via `npm run build`).

**Reference spec:** `specs/2026-07-23-undercity-rolled-egg-color-design.md`

---

## File Structure

- **Modify** `infrastructure/lambda/undercity_db.py` — `_customize` (unchanged-region rule); `_join` (grant rolled shell paint).
- **Modify** `infrastructure/lambda/undercity_data.py` — add `HUE_TO_PAINT` reverse map.
- **Modify** `infrastructure/lambda/tests/test_undercity_db.py` — recovery + grant tests.
- **Modify** `src/app/undercity/hatch/hatch-flow.component.ts` — spin logic replacing `pickShell`.
- **Modify** `src/app/undercity/hatch/hatch-flow.component.html` — wheel + spin button replacing the swatch grid.
- **Modify** `src/app/undercity/hatch/hatch-flow.component.scss` — spin button / result styling.

Test command (server): `cd infrastructure/lambda && python -m pytest tests -q`
Build command (client, repo root): `npm run build`

---

## Task 1: Server — recolor never blocks an unchanged region (§3)

This is the critical unblock. It recovers every already-stuck player with no migration.

**Files:**
- Modify: `infrastructure/lambda/undercity_db.py` (`_customize`, ~lines 5341-5349)
- Test: `infrastructure/lambda/tests/test_undercity_db.py`

- [ ] **Step 1: Write the failing test**

Add to `test_undercity_db.py` (after `test_customize_validates_wardrobe`, ~line 1187):

```python
def test_customize_allows_keeping_an_unowned_worn_hue(table):
    # Simulate a player already wearing an un-owned shell hue (an old veteran who
    # hatched via the ungated shell picker): body/stripes = violet(270), which is
    # NOT in their owned paints (defaults forest+gold only).
    act(table, 'join', starter='pest')
    sid = _sid(table)
    doc = db._get_player(table, sid, 'user-alex')
    doc['paint'] = {'body': 270, 'belly': 50, 'stripes': 270}
    table.put_item(Item=doc)

    # Recolor body to an OWNED color; stripes stays 270 (unchanged) — must succeed.
    status, resp = act(table, 'customize',
                       paint={'body': 130, 'belly': 50, 'stripes': 270})
    assert status == 200
    assert resp['you']['paint']['body'] == 130
    assert resp['you']['paint']['stripes'] == 270

    # Switching a region TO a new un-owned color is still rejected.
    status, resp = act(table, 'customize',
                       paint={'body': 0, 'belly': 50, 'stripes': 270})
    assert status == 409
```

- [ ] **Step 2: Run it and watch it fail**

Run: `cd infrastructure/lambda && python -m pytest tests/test_undercity_db.py::test_customize_allows_keeping_an_unowned_worn_hue -q`
Expected: FAIL — the first customize returns 409 (`stripes` 270 not owned) instead of 200.

- [ ] **Step 3: Implement the unchanged-region rule**

In `undercity_db.py` `_customize`, replace the paint-validation block:

```python
    paint = payload.get('paint')
    if paint:
        owned_hues = {p['hue'] for p in data.PAINTS if p['id'] in perm['paints']}
        for region in ('body', 'belly', 'stripes'):
            hue = paint.get(region)
            if hue is not None and int(hue) not in owned_hues:
                return _err('You do not own that paint.', 409)
        doc['paint'] = {r: int(paint.get(r, doc['paint'].get(r, 130)))
                        for r in ('body', 'belly', 'stripes')}
```

with:

```python
    paint = payload.get('paint')
    if paint:
        owned_hues = {p['hue'] for p in data.PAINTS if p['id'] in perm['paints']}
        cur = doc.get('paint') or {}
        for region in ('body', 'belly', 'stripes'):
            hue = paint.get(region)
            if hue is None:
                continue
            # You can always keep the color you're already wearing; only a change
            # TO a new hue must be owned. This unblocks players whose hatch-assigned
            # shell hue isn't in their owned set.
            if int(hue) == int(cur.get(region, -999)):
                continue
            if int(hue) not in owned_hues:
                return _err('You do not own that paint.', 409)
        doc['paint'] = {r: int(paint.get(r, doc['paint'].get(r, 130)))
                        for r in ('body', 'belly', 'stripes')}
```

- [ ] **Step 4: Run the new test + the existing customize test**

Run: `cd infrastructure/lambda && python -m pytest tests/test_undercity_db.py::test_customize_allows_keeping_an_unowned_worn_hue tests/test_undercity_db.py::test_customize_validates_wardrobe -q`
Expected: PASS (both). The existing test still passes because a fresh hatch wears body=130, so `body:270` is a real change to an un-owned hue → 409.

- [ ] **Step 5: Commit**

```bash
git add infrastructure/lambda/undercity_db.py infrastructure/lambda/tests/test_undercity_db.py
git commit -m "fix(undercity): recolor never blocks a paint region you already wear"
```

---

## Task 2: Server — grant a veteran's rolled shell color as owned (§2)

**Files:**
- Modify: `infrastructure/lambda/undercity_data.py` (add `HUE_TO_PAINT`, near `PAINT_MAP` ~line 922)
- Modify: `infrastructure/lambda/undercity_db.py` (`_join`, ~lines 2084-2102)
- Test: `infrastructure/lambda/tests/test_undercity_db.py`

- [ ] **Step 1: Write the failing test**

Add to `test_undercity_db.py` (after the test from Task 1):

```python
def test_join_grants_veteran_rolled_shell_color_as_owned(table):
    # A veteran (1+ seals) hatches with a rolled shell hue; that catalog color is
    # granted as an owned paint, so they can recolor to/from it freely.
    perm = db._get_perm(table, 'user-vet')
    perm['seals'] = 2
    table.put_item(Item=perm)

    status, resp = act(table, 'join', user='user-vet', name='Vet',
                       starter='zombie', eggHue=270)  # 270 = violet
    assert status == 200
    assert resp['you']['paint']['body'] == 270

    perm2 = db._get_perm(table, 'user-vet')
    assert 'violet' in perm2['paints']  # rolled color now owned

    # And they can recolor stripes to that owned violet.
    status, resp = act(table, 'customize', user='user-vet', name='Vet',
                       paint={'body': 270, 'belly': 50, 'stripes': 270})
    assert status == 200
    assert resp['you']['paint']['stripes'] == 270


def test_join_non_veteran_grants_no_shell_color(table):
    # A first-time player hatches forest(130, a default) and gets no extra grant.
    act(table, 'join', user='user-new', name='New', starter='pest', eggHue=270)
    perm = db._get_perm(table, 'user-new')
    # Only the defaults — the eggHue was ignored for a non-veteran, no bonus paint.
    assert set(perm['paints']) == set(data.DEFAULT_PAINTS)
```

- [ ] **Step 2: Run and watch them fail**

Run: `cd infrastructure/lambda && python -m pytest tests/test_undercity_db.py::test_join_grants_veteran_rolled_shell_color_as_owned tests/test_undercity_db.py::test_join_non_veteran_grants_no_shell_color -q`
Expected: `test_join_grants_veteran_rolled_shell_color_as_owned` FAILS (`'violet' not in perm2['paints']`); the non-veteran test PASSES already (documents current correct behavior).

- [ ] **Step 3: Add the hue→paint reverse map**

In `undercity_data.py`, immediately after `PAINT_MAP = {p['id']: p for p in PAINTS}` (~line 922):

```python
# Reverse lookup for granting a rolled shell color as an owned paint (hues are
# unique across PAINTS, so this is unambiguous). Mirror: undercity_db._join.
HUE_TO_PAINT = {p['hue']: p['id'] for p in PAINTS}
```

- [ ] **Step 4: Grant the rolled color in `_join`**

In `undercity_db.py` `_join`, right after the `doc = _new_player_doc(...)` call (~line 2088) and before the `_seed_night_rolls` line, insert:

```python
    # A veteran's rolled shell color is theirs to keep — grant it as an owned
    # paint so they can recolor to/from it without hitting the ownership gate.
    # Resolved from the hatched body hue (a catalog hue for any rolled color).
    if seals_before >= 1:
        shell_pid = data.HUE_TO_PAINT.get(int(doc['paint'].get('body', 130)))
        if shell_pid and shell_pid not in perm['paints']:
            perm['paints'] = perm['paints'] + [shell_pid]
```

(`perm` is persisted by the existing `table.put_item(Item=perm)` at ~line 2102.)

- [ ] **Step 5: Run the tests**

Run: `cd infrastructure/lambda && python -m pytest tests/test_undercity_db.py::test_join_grants_veteran_rolled_shell_color_as_owned tests/test_undercity_db.py::test_join_non_veteran_grants_no_shell_color tests/test_undercity_db.py::test_join_is_idempotent_and_veteran_egg_color -q`
Expected: PASS (all three — the existing veteran-egg test still passes).

- [ ] **Step 6: Commit**

```bash
git add infrastructure/lambda/undercity_data.py infrastructure/lambda/undercity_db.py infrastructure/lambda/tests/test_undercity_db.py
git commit -m "feat(undercity): grant a veteran's rolled shell color as an owned paint"
```

---

## Task 3: Client — locked color-wheel spin replaces the shell picker (§1)

**Files:**
- Modify: `src/app/undercity/hatch/hatch-flow.component.ts` (~lines 71, 232-234)
- Modify: `src/app/undercity/hatch/hatch-flow.component.html` (~lines 10-23)
- Modify: `src/app/undercity/hatch/hatch-flow.component.scss`

- [ ] **Step 1: Add spin state + method to the component**

In `hatch-flow.component.ts`, just after the `eggHue` signal (~line 71):

```ts
  /** Veteran shell-color roll: one locked spin lands on a catalog color. */
  protected readonly spinning = signal(false);
  protected readonly shellLocked = signal(false);
  protected readonly spinHighlight = signal<number>(-1);
  protected readonly rolledPaint = signal<PaintInfo | null>(null);
```

Then replace `pickShell` (~lines 232-234):

```ts
  pickShell(hue: number): void {
    this.eggHue.set(hue);
  }
```

with:

```ts
  /** One locked spin: cycle the highlight with an ease-out cadence, land on a
   *  random catalog color, set the egg hue, and lock. No re-spins. */
  spinShell(): void {
    if (this.shellLocked() || this.spinning()) return;
    this.spinning.set(true);
    const n = this.paints.length;
    const finalIdx = Math.floor(Math.random() * n);
    const total = 28; // ticks before landing
    let tick = 0;
    const step = (): void => {
      if (tick >= total) {
        const paint = this.paints[finalIdx];
        this.spinHighlight.set(finalIdx);
        this.rolledPaint.set(paint);
        this.eggHue.set(paint.hue);
        this.shellLocked.set(true);
        this.spinning.set(false);
        return;
      }
      this.spinHighlight.set((this.spinHighlight() + 1 + n) % n);
      tick++;
      const delay = 40 + Math.round((tick / total) ** 2 * 220); // ease-out 40→260ms
      setTimeout(step, delay);
    };
    step();
  }
```

Confirm `PaintInfo` is imported. It comes from the same cosmetics/data module as `PAINTS`; if the TS compiler flags it as missing, add `PaintInfo` to the existing import that brings in `PAINTS` (check the top-of-file import from `../data/cosmetics`).

- [ ] **Step 2: Replace the swatch grid in the template**

In `hatch-flow.component.html`, replace the `@if (canPickShell()) { … }` block (~lines 10-23):

```html
    @if (canPickShell()) {
      <p class="shell-hint">Guild Seal perk: choose your shell color</p>
      <div class="shell-row">
        @for (paint of paints; track paint.id) {
          <button
            class="shell-swatch"
            [class.selected]="eggHue() === paint.hue"
            [style.background]="swatchCss(paint.hue)"
            [title]="paint.name"
            (click)="pickShell(paint.hue)"
          ></button>
        }
      </div>
    }
```

with:

```html
    @if (canPickShell()) {
      <p class="shell-hint">Guild Seal perk: spin for your shell color</p>
      <div class="shell-row">
        @for (paint of paints; track paint.id; let i = $index) {
          <span
            class="shell-swatch"
            [class.highlight]="spinHighlight() === i"
            [class.locked]="shellLocked() && rolledPaint()?.id === paint.id"
            [style.background]="swatchCss(paint.hue)"
            [title]="paint.name"
          ></span>
        }
      </div>
      @if (shellLocked()) {
        <p class="shell-result">Your shell: <strong>{{ rolledPaint()?.name }}</strong></p>
      } @else {
        <button class="uc-btn shell-spin" [disabled]="spinning()" (click)="spinShell()">
          {{ spinning() ? 'Spinning…' : 'Spin the wheel' }}
        </button>
      }
    }
```

(The swatches are now display-only; the spin drives the selection.)

- [ ] **Step 3: Style the spin control**

Append to `hatch-flow.component.scss`:

```scss
// Veteran shell-color spin: highlighted swatch during the spin, locked result.
.shell-swatch.highlight {
  outline: 3px solid #fff;
  transform: scale(1.25);
}
.shell-swatch.locked {
  outline: 3px solid var(--accent-color, #a3e635);
  transform: scale(1.2);
}
.shell-spin {
  margin-top: 8px;
}
.shell-result {
  margin-top: 8px;
  font-size: 0.9rem;
}
```

If `.shell-swatch` has an existing `transition`, this reuses it; if not, add `transition: transform 120ms ease;` to the base `.shell-swatch` rule so the highlight animates.

- [ ] **Step 4: Build**

Run (repo root): `npm run build`
Expected: build succeeds. A missing `PaintInfo` import or a template typo would fail here.

- [ ] **Step 5: Commit**

```bash
git add src/app/undercity/hatch/hatch-flow.component.ts src/app/undercity/hatch/hatch-flow.component.html src/app/undercity/hatch/hatch-flow.component.scss
git commit -m "feat(undercity): veteran shell color is a locked wheel spin, not a free pick"
```

---

## Task 4: Full verification

**Files:** none (verification only)

- [ ] **Step 1: Run the whole server suite**

Run: `cd infrastructure/lambda && python -m pytest tests -q`
Expected: all pass (keep the suite green per CLAUDE.md).

- [ ] **Step 2: Production client build**

Run (repo root): `npm run build`
Expected: succeeds, no errors.

- [ ] **Step 3: Manual smoke via run-undercity skill**

Invoke `run-undercity` and verify by eye:
- As a veteran (seals ≥ 1), the hatch shows "Spin the wheel"; one spin lands on a color and locks (no re-spin); the egg preview recolors to it.
- After hatching, open the Creature tab wardrobe and change body/stripes colors — the change saves (no "you do not own that paint"). The rolled color shows as owned/wearable.
- A brand-new player (no seal) still hatches forest with no spin control.

- [ ] **Step 4: Report**

Report suite-green + build-green + which manual checks passed. Deployment is the user's to run (Lambda + client both need deploying).

---

## Self-Review

**Spec coverage:** §1 roll UX → Task 3 ✓; §2 grant rolled color as owned → Task 2 (`HUE_TO_PAINT` + `_join` grant) ✓; §3 unchanged-region recolor fix → Task 1 ✓; existing-player recovery (no migration) → Task 1 (self-heals on next recolor) ✓; testing plan → Tasks 1-2 tests + Task 4 ✓.

**Client-rolls decision:** the client picks the random color (Task 3 `spinShell`) and sends `eggHue` (existing field); the server grants from the hatched body hue (Task 2), so no new join payload field is introduced — simpler than the spec's optional `eggPaint` hint, same result. Documented here as the chosen realization.

**Placeholder scan:** no TBD/TODO; every code step shows full before/after; the one conditional instruction (`PaintInfo` import, `.shell-swatch` transition) names the exact file/symbol to check.

**Type consistency:** `spinShell`, `shellLocked`, `spinning`, `spinHighlight`, `rolledPaint` are defined in Task 3 Step 1 and used consistently in Step 2's template. `HUE_TO_PAINT` is defined in Task 2 Step 3 and used in Step 4. Server `_customize`/`_join` edits match the anchors read from the current file.
