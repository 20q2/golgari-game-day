# Dig Site Reveal-As-You-Dig Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Render each buried find in the Undercity dig site as one large symbol spanning its whole footprint, hidden under the dirt and uncovered slice-by-slice as you dig, instead of the same icon tiled once per cell.

**Architecture:** Pure client change in one component. Reuse the existing Material glyph, sized to the find's footprint bounding box and absolutely positioned so each cell's existing `overflow: hidden` clips it to a slice. Covered cells render nothing (plain dirt). Slice geometry is computed per cell in `buildView()` and passed to CSS via inline custom properties. No backend, service, or model changes.

**Tech Stack:** Angular 20 standalone component, Angular Material `mat-icon`, SCSS with CSS custom properties + container-query units. No frontend test runner (verify via `npm run build` + the `run-undercity` skill).

Spec: [specs/2026-07-24-undercity-dig-reveal-design.md](2026-07-24-undercity-dig-reveal-design.md)

---

### Task 1: Rework the excavation grid to a single spanning symbol

**Files:**
- Modify: `src/app/undercity/tabs/excavation.component.ts` (`CellVM` interface, `buildView()`, template block, `styles`)

All four steps edit the same file and are one coherent change; build + commit once at the end.

- [ ] **Step 1: Extend the `CellVM` interface**

Replace the `CellVM` interface (currently around lines 9-22) with:

```ts
/** One rendered dig-grid cell — precomputed from the grid so the template stays
 * declarative. */
interface CellVM {
  /** Not yet dug (still under dirt). */
  covered: boolean;
  /** A buried find's footprint includes this cell (any reveal state). */
  hasItem: boolean;
  /** The find is dug out here — render this cell's slice of the big symbol. */
  revealedFind: boolean;
  /** Material icon glyph for the find (spore cache or consumable). */
  icon: string | null;
  /** The find is a Spore cache (vs. an item). */
  spores: boolean;
  /** The find has been fully unearthed and claimed. */
  collected: boolean;
  /** Accessible label / tooltip for the find. */
  label: string;
  /** Footprint size in cells — the big symbol spans spanC×spanR cells. */
  spanC: number;
  spanR: number;
  /** This cell's position within the footprint (0-based), used to offset the
   * symbol so the cell clips to the correct slice. */
  localC: number;
  localR: number;
  /** True only on the footprint's top-left cell — anchors the single ✓. */
  anchor: boolean;
}
```

- [ ] **Step 2: Rewrite `buildView()` to compute footprint bounding boxes**

Replace the whole `buildView()` method (currently around lines 235-260) with:

```ts
  private buildView(): CellVM[][] {
    const g = this.grid;
    if (!g) return [];
    // Map each occupied cell to the find that sits there, and precompute each
    // find's footprint bounding box so one glyph can span it. All dig shapes
    // are rectangles (1x1 / 1x2 / 2x2), so the bounding box is the footprint.
    const at: (DigItemView | null)[][] = Array.from({ length: g.h }, () =>
      Array<DigItemView | null>(g.w).fill(null),
    );
    const box = new Map<
      DigItemView,
      { minR: number; minC: number; spanR: number; spanC: number }
    >();
    for (const it of g.items) {
      let minR = Infinity,
        minC = Infinity,
        maxR = -Infinity,
        maxC = -Infinity;
      for (const [r, c] of it.cells ?? []) {
        if (r >= 0 && r < g.h && c >= 0 && c < g.w) at[r][c] = it;
        if (r < minR) minR = r;
        if (c < minC) minC = c;
        if (r > maxR) maxR = r;
        if (c > maxC) maxC = c;
      }
      box.set(it, { minR, minC, spanR: maxR - minR + 1, spanC: maxC - minC + 1 });
    }
    return g.cells.map((row, r) =>
      row.map((code, c) => {
        const it = at[r][c];
        const covered = code === this.COVERED;
        const b = it ? box.get(it)! : null;
        return {
          covered,
          hasItem: !!it,
          revealedFind: !!it && !covered,
          icon: it ? this.iconFor(it) : null,
          spores: it?.kind === 'spores',
          collected: !!it?.collected,
          label: it ? this.labelFor(it) : '',
          spanC: b ? b.spanC : 1,
          spanR: b ? b.spanR : 1,
          localC: b ? c - b.minC : 0,
          localR: b ? r - b.minR : 0,
          anchor: !!b && r === b.minR && c === b.minC,
        };
      }),
    );
  }
```

- [ ] **Step 3: Update the template cell block**

Replace the `<button ...>` block (currently lines 47-66) with the version below. Changes: `buried` follows `revealedFind` (so covered find-cells look like plain dirt); `title`/`aria-label` only reveal on dug cells (no leak); the glyph renders only when `revealedFind` and carries the slice geometry as CSS custom properties; a single `✓` renders on the anchor cell of a claimed find.

```html
              <button
                type="button"
                class="cell"
                [class.covered]="vm.covered"
                [class.dug]="!vm.covered"
                [class.buried]="vm.revealedFind"
                [class.spores]="vm.spores"
                [class.collected]="vm.collected"
                [attr.title]="vm.revealedFind ? vm.label : null"
                [attr.aria-label]="vm.revealedFind ? vm.label : 'rubble'"
                [disabled]="busy || digsLeft < 1 || !vm.covered"
                (click)="onCell(ri, ci)"
              >
                @if (vm.revealedFind) {
                  <mat-icon
                    class="find"
                    [style.--span-c]="vm.spanC"
                    [style.--span-r]="vm.spanR"
                    [style.--lc]="vm.localC"
                    [style.--lr]="vm.localR"
                    >{{ vm.icon }}</mat-icon
                  >
                }
                @if (vm.collected && vm.anchor) {
                  <span class="check">✓</span>
                }
              </button>
```

- [ ] **Step 4: Update the styles**

(a) Add the shared gap variable to `.dig-grid` (currently around lines 115-121). Replace the `.dig-grid` rule with:

```css
      .dig-grid {
        --dig-gap: 4px;
        display: grid;
        gap: var(--dig-gap);
        margin: 2px auto;
        width: 100%;
        max-width: 300px;
      }
```

(b) Make each cell a size container so the glyph can scale to the cell. In the `.cell` rule (currently around lines 122-134), add `container-type: size;` — e.g. right after `overflow: hidden;`:

```css
        overflow: hidden;
        container-type: size;
```

(c) Replace the `.find` rule and the three reveal-state rules that follow it (currently the block from `.find { ... }` through `.cell.dug.buried.spores .find { ... }`, around lines 156-184 — i.e. `.cell.spores.buried .find`, `.find`, `.cell.covered .find`, `.cell.dug.buried .find`, `.cell.dug.buried.spores .find`) with:

```css
      /* One symbol spans the whole footprint; each cell's overflow:hidden clips
         it to this cell's slice. Offsets shift the symbol up/left by this cell's
         position within the footprint (100% = one cell width/height + one gap). */
      .find {
        position: absolute;
        overflow: visible;
        width: calc(var(--span-c) * 100% + (var(--span-c) - 1) * var(--dig-gap));
        height: calc(var(--span-r) * 100% + (var(--span-r) - 1) * var(--dig-gap));
        left: calc(var(--lc) * -1 * (100% + var(--dig-gap)));
        top: calc(var(--lr) * -1 * (100% + var(--dig-gap)));
        /* Glyph fills the footprint height (cqh = cell height), +12% so corner
           slices of a diagonal shape still carry recognizable form. */
        font-size: calc(
          (var(--span-r) * 100cqh + (var(--span-r) - 1) * var(--dig-gap)) * 1.12
        );
        line-height: 1;
        display: flex;
        align-items: center;
        justify-content: center;
        color: #6fae76;
        filter: drop-shadow(0 1px 2px rgba(0, 0, 0, 0.7));
        z-index: 1;
      }
      .cell.spores .find {
        color: #e0c088;
      }
```

Note: the old `.cell.covered .find` (faint show-through) rule is intentionally dropped — covered cells no longer render `.find` at all. The existing `.cell.collected` grey filter and `.cell.collected .find { color: #8a978a }` rules stay as they are.

- [ ] **Step 5: Build**

Run: `npm run build`
Expected: build succeeds with no TypeScript/template errors. (Lint is unreliable in this repo — use the build as the gate.)

- [ ] **Step 6: Commit**

```bash
git add src/app/undercity/tabs/excavation.component.ts
git commit -m "feat(undercity): dig finds render as one spanning symbol, revealed slice-by-slice"
```

Note: `src/app/undercity/data/icons.ts` and `src/app/undercity/tabs/creature-tab.component.html` have unrelated in-progress edits — do **not** stage them; commit only the excavation component.

---

### Task 2: Verify in the real app and tune corner legibility

**Files:**
- Possibly modify: `src/app/undercity/tabs/excavation.component.ts` (the `1.12` font-size factor only)

- [ ] **Step 1: Launch and reach a dig site**

Invoke the `run-undercity` skill to start the dev server and drive a browser to an excavation node's Dig Site modal (it covers the AWS-backed state prerequisites and how to reach a specific board state).

- [ ] **Step 2: Confirm the behaviour**

Verify each of these by eye:
- The grid starts as uniform dirt — no find icons or hints show through covered cells.
- Digging one corner of the 2×2 find shows a single connected fragment of one big glyph (not a whole small icon), and its shape points toward the rest of the footprint.
- Digging the remaining cells builds up one continuous symbol broken only by the grid gaps.
- Claiming the find greys the symbol and shows exactly one `✓` (not one per cell).
- 1×1 and 1×2 finds still read correctly (whole glyph in one cell / split across two).
- Spore caches render gold; item finds render green.

- [ ] **Step 3: Tune if corners read poorly**

If corner slices of the 2×2 look empty or unrecognizable, raise the `1.12` factor in the `.find` `font-size` calc (try `1.25`); if the glyph spills too far and looks cropped, lower it toward `1.0`. Re-run `npm run build`, re-check in the browser, then:

```bash
git add src/app/undercity/tabs/excavation.component.ts
git commit -m "tune(undercity): dig symbol glyph scale for corner legibility"
```

Skip this commit if no change was needed.

---

## Notes / deferred (from spec)

- **Layout leak:** the Lambda still sends the full find layout up front; this plan hides it client-side only. Server-side withholding is a separate follow-up (touches `_dig_view` + `test_undercity_db.py` and needs a deploy).
- **Balance:** blind digging changes risk/reward; loot tables and `EXCAVATION_DIGS_PER_VISIT` are intentionally left unchanged pending playtest.
- **Deploy:** the user runs deploys. End with the build green; note that a deploy publishes the change.
