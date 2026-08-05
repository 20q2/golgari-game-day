# Player Market Browse Redesign — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Make the Undercity Player Market **Buy** view browsable at game-day volume — kind-chip filtering (with counts), price/rarity sorting, an affordability filter, and a "Mine" view to manage your own listings — entirely client-side.

**Architecture:** All changes live in `PlazaTabComponent` and its template/styles, derived reactively from the existing `marketRows()` computed (which reads the `market()` array the server already sends). No backend, endpoint, or state-payload changes. The Sell view is untouched.

**Tech Stack:** Angular 20 standalone component (signals + `computed` + `effect`), SCSS, Angular Material icons.

**Design doc:** [specs/2026-08-05-undercity-market-browse-redesign-design.md](2026-08-05-undercity-market-browse-redesign-design.md)

---

## Conventions for every task

- **No frontend unit-test runner exists** (`ng test` is removed). The automated gate is a production compile: `npm run build` (from repo root) must finish with **no errors** (pre-existing warnings about `GamesHeroComponent`, `aws-test`, `statistics`, and `qrcode` are expected — ignore them).
- **Parallel WIP:** the user may have unrelated changes in other files (e.g. `board-tab.component.ts`). Only touch the files listed in each task. When committing, `git add` **exact paths** — never `git add -A`.
- **Icons only, no emoji** (project rule). Use Material ligatures / `uc-*` SVG icons.
- The dev server + how to reach the market modal live state: **run-undercity** skill.

## File structure

| File | Responsibility | Change |
|---|---|---|
| `src/app/undercity/data/items.ts` | Item data + display mirrors | **Add** `MARKET_MAX_LISTINGS = 10` mirror |
| `src/app/undercity/tabs/plaza-tab.component.ts` | Plaza logic incl. market | **Add** browse state, groups, computeds, helpers |
| `src/app/undercity/tabs/plaza-tab.component.html` | Plaza template | **Replace** the Buy sub-view's list header + loop |
| `src/app/undercity/tabs/plaza-tab.component.scss` | Plaza styles | **Add** toolbar / chip / sort / toggle / mine-head styles |

---

## Task 1: Filter state, kind chips, and the Mine view

Adds the full browse **state + logic** (filter, sort, and affordable signals are all wired into `visibleMarketRows` now) plus the **kind-chip bar**, the **Mine** header, and per-filter empty states. The sort and affordable *controls* land in Tasks 2–3; their state already works at defaults (`price-asc`, off).

**Files:**
- Modify: `src/app/undercity/data/items.ts`
- Modify: `src/app/undercity/tabs/plaza-tab.component.ts`
- Modify: `src/app/undercity/tabs/plaza-tab.component.html`
- Modify: `src/app/undercity/tabs/plaza-tab.component.scss`

- [ ] **Step 1: Add the listings-cap display mirror**

In `src/app/undercity/data/items.ts`, add near the other market-related exports (e.g. after `marketBand` / `SALVAGE_YIELD`):

```ts
// Mirror of undercity_config.MARKET_MAX_LISTINGS — active market listings a
// seller may hold. Display-only (the server enforces the cap); keep in sync
// when tuning the server value.
export const MARKET_MAX_LISTINGS = 10;
```

- [ ] **Step 2: Ensure imports in the component**

In `src/app/undercity/tabs/plaza-tab.component.ts`:
- Make the `@angular/core` import include `computed`, `effect`, and `signal`.
- Make the `../data/items` import include `MarketKind`, `Rarity`, `RarityInfo`, and `MARKET_MAX_LISTINGS`.

(Add only the missing names — do not remove existing imports.)

- [ ] **Step 3: Add module-level types + tables**

In `plaza-tab.component.ts`, at module scope (above the `@Component` decorator), add:

```ts
type MarketFilter = 'all' | 'gear' | 'consumable' | 'scroll' | 'pets' | 'mine';

// A filter chip maps to one or more stored MarketKinds. Only "Pets" bundles
// more than one (pets + eggs) — the backend still stores them as distinct
// kinds (they route into pets[] vs eggs[] on buy); this is display grouping.
const MARKET_GROUPS: { key: Exclude<MarketFilter, 'all' | 'mine'>; label: string; kinds: MarketKind[] }[] = [
  { key: 'gear', label: 'Gear', kinds: ['gear'] },
  { key: 'consumable', label: 'Consumables', kinds: ['consumable'] },
  { key: 'scroll', label: 'Scrolls', kinds: ['scroll'] },
  { key: 'pets', label: 'Pets', kinds: ['pet', 'egg'] },
];

// Rarity sort order, best first. Consumables carry no rarity (see marketView)
// and rank last (RANK 4).
const MARKET_RARITY_RANK: Record<Rarity, number> = { mythic: 0, legendary: 1, rare: 2, common: 3 };
```

- [ ] **Step 4: Add browse state + derived signals + helpers**

Inside the `PlazaTabComponent` class, add near the existing market members (`marketRows`, `buyReason`, `marketBuy`, …):

```ts
// ── Player Market browse state (design 2026-08-05) ────────────────────────
protected readonly marketFilter = signal<MarketFilter>('all');
protected readonly marketSort = signal<'price-asc' | 'price-desc' | 'rarity'>('price-asc');
protected readonly marketAffordable = signal(false);
protected readonly maxListings = MARKET_MAX_LISTINGS;

// If the active kind filter empties (last of that kind bought/cancelled), fall
// back to All so the view never strands on an empty filter. Field-initializer
// effect runs in the component's injection context.
private readonly _marketFilterGuard = effect(() => {
  const f = this.marketFilter();
  if (f === 'all' || f === 'mine') return;
  if (!this.marketChips().some((c) => c.key === f)) this.marketFilter.set('all');
});

/** Chip descriptors: All + each non-empty kind group + Mine, with live counts. */
protected readonly marketChips = computed(() => {
  const rows = this.marketRows();
  const countIn = (kinds: MarketKind[]) => rows.filter((r) => kinds.includes(r.kind)).length;
  const groups = MARKET_GROUPS
    .map((g) => ({ key: g.key as MarketFilter, label: g.label, count: countIn(g.kinds), mine: false }))
    .filter((c) => c.count > 0);
  return [
    { key: 'all' as MarketFilter, label: 'All', count: rows.length, mine: false },
    ...groups,
    { key: 'mine' as MarketFilter, label: 'Mine', count: rows.filter((r) => r.own).length, mine: true },
  ];
});

/** How many active listings are the player's own (for the Mine N / cap header). */
protected readonly mineListingCount = computed(() => this.marketRows().filter((r) => r.own).length);

/** marketRows() narrowed by the active chip + affordability, then sorted. */
protected readonly visibleMarketRows = computed(() => {
  const filter = this.marketFilter();
  const sort = this.marketSort();
  const spores = this.store.you()?.spores ?? 0;
  let rows = this.marketRows();

  if (filter === 'mine') {
    rows = rows.filter((r) => r.own);
  } else if (filter !== 'all') {
    const kinds = MARKET_GROUPS.find((g) => g.key === filter)?.kinds ?? [];
    rows = rows.filter((r) => kinds.includes(r.kind));
  }
  // Affordability is price-only and never hides your own listings; container-full
  // stays a per-row note via buyReason(). Ignored while managing (Mine).
  if (this.marketAffordable() && filter !== 'mine') {
    rows = rows.filter((r) => r.own || spores >= r.price);
  }

  const rank = (r: (typeof rows)[number]) => (r.view?.rarity ? MARKET_RARITY_RANK[r.view.rarity.key] : 4);
  const byName = (a: (typeof rows)[number], b: (typeof rows)[number]) => a.view!.name.localeCompare(b.view!.name);
  return [...rows].sort((a, b) => {
    if (sort === 'price-asc') return a.price - b.price || byName(a, b);
    if (sort === 'price-desc') return b.price - a.price || byName(a, b);
    return rank(a) - rank(b) || a.price - b.price || byName(a, b);
  });
});

protected setMarketFilter(f: MarketFilter): void {
  this.marketFilter.set(f);
}
protected setMarketSort(s: 'price-asc' | 'price-desc' | 'rarity'): void {
  this.marketSort.set(s);
}
protected toggleMarketAffordable(): void {
  this.marketAffordable.update((v) => !v);
}

/** Empty-state line tailored to the active filter. */
protected marketEmptyMessage(): string {
  const f = this.marketFilter();
  if (f === 'mine') return 'No active listings — switch to Sell to list something.';
  if (this.marketAffordable()) return 'Nothing here you can afford yet.';
  if (f === 'all') return 'The market is empty right now.';
  const label = MARKET_GROUPS.find((g) => g.key === f)?.label ?? 'items';
  return `No ${label.toLowerCase()} listed right now.`;
}
```

- [ ] **Step 5: Replace the Buy sub-view header + loop in the template**

In `src/app/undercity/tabs/plaza-tab.component.html`, find the Buy block (inside `@if (marketTab() === 'buy') {`). It currently reads:

```html
          <p class="forge-hint">Buy what other players listed for Spores.</p>
          <h4 class="forge-subhead">On the market</h4>
          @for (l of marketRows(); track l.id) {
```

…and ends with:

```html
          } @empty {
            <div class="forge-empty">No listings yet. Be the first to sell something.</div>
          }
```

Replace **from the `<h4 class="forge-subhead">On the market</h4>` line through the `@for (l of marketRows()...` opening** with the toolbar, Mine header, and the same loop bound to `visibleMarketRows()` (the sort segmented control and Affordable toggle are added in Tasks 2–3 — leave those spots as shown):

```html
          <div class="market-toolbar">
            <div class="market-chips" role="group" aria-label="Filter listings by kind">
              @for (c of marketChips(); track c.key) {
                <button
                  class="market-chip"
                  [class.mine]="c.mine"
                  [attr.aria-pressed]="marketFilter() === c.key"
                  (click)="setMarketFilter(c.key)"
                >
                  {{ c.label }}<span class="market-chip-ct">{{ c.count }}</span>
                </button>
              }
            </div>
            <!-- market-controls (sort + affordable) added in Tasks 2–3 -->
          </div>

          @if (marketFilter() === 'mine') {
            <div class="market-mine-head">
              <span class="lbl">Your listings</span>
              <span class="cnt" [class.full]="mineListingCount() >= maxListings">
                {{ mineListingCount() }} / {{ maxListings }}@if (mineListingCount() >= maxListings) {
                  · cancel one to free a slot
                }
              </span>
            </div>
          }

          @for (l of visibleMarketRows(); track l.id) {
```

Then change the loop's `@empty` block to the per-filter message:

```html
          } @empty {
            <div class="forge-empty">{{ marketEmptyMessage() }}</div>
          }
```

Leave every `forge-row` line between them **exactly as-is** (icon, name, rarity-badge, seller-chip, Buy/Cancel, block-reason). Only the header, the loop source (`marketRows()` → `visibleMarketRows()`), and the empty message change. You may keep or drop the intro `<p class="forge-hint">Buy what other players listed for Spores.</p>` — keep it.

- [ ] **Step 6: Add chip-bar + Mine-header styles**

In `src/app/undercity/tabs/plaza-tab.component.scss`, append:

```scss
// ── Player Market browse toolbar (design 2026-08-05) ─────────────────────────
.market-toolbar {
  position: sticky;
  top: 0;
  z-index: 4;
  background: #211d16;
  padding: 4px 0 8px;
}

.market-chips {
  display: flex;
  gap: 7px;
  overflow-x: auto;
  padding: 2px 2px 4px;
  scrollbar-width: none;
  -webkit-mask-image: linear-gradient(90deg, transparent 0, #000 12px, #000 calc(100% - 12px), transparent 100%);
          mask-image: linear-gradient(90deg, transparent 0, #000 12px, #000 calc(100% - 12px), transparent 100%);

  &::-webkit-scrollbar { display: none; }
}

.market-chip {
  flex: none;
  display: inline-flex;
  align-items: center;
  gap: 6px;
  padding: 6px 11px;
  border-radius: 999px;
  border: 1px solid rgba(216, 243, 220, 0.14);
  background: rgba(255, 255, 255, 0.03);
  color: #9aa79a;
  font: inherit;
  font-size: 0.78rem;
  font-weight: 700;
  white-space: nowrap;
  cursor: pointer;
  transition: background 0.15s ease, color 0.15s ease, border-color 0.15s ease;

  &:hover { color: #d8f3dc; border-color: rgba(224, 192, 120, 0.3); }

  .market-chip-ct {
    font-size: 0.68rem;
    font-weight: 800;
    padding: 0 6px;
    border-radius: 999px;
    background: rgba(0, 0, 0, 0.28);
    font-variant-numeric: tabular-nums;
  }

  &[aria-pressed='true'] {
    background: linear-gradient(180deg, #e6c078, #cba75c);
    border-color: rgba(224, 192, 120, 0.7);
    color: #17140f;

    .market-chip-ct { background: rgba(23, 20, 15, 0.22); }
  }

  &.mine[aria-pressed='true'] {
    background: linear-gradient(180deg, #6cae75, #4a7c59);
    border-color: rgba(224, 192, 120, 0.5);
    color: #0d1a12;
  }
}

.market-mine-head {
  display: flex;
  align-items: baseline;
  justify-content: space-between;
  gap: 8px;
  margin: 4px 2px 8px;
  padding-bottom: 8px;
  border-bottom: 1px solid rgba(216, 243, 220, 0.14);

  .lbl {
    font-size: 0.68rem;
    letter-spacing: 0.06em;
    text-transform: uppercase;
    color: #9aa79a;
  }
  .cnt {
    font-size: 0.82rem;
    font-weight: 800;
    color: #6cae75;
    font-variant-numeric: tabular-nums;

    &.full { color: #e6c078; }
  }
}
```

- [ ] **Step 7: Build**

Run: `npm run build`
Expected: build completes with **no errors** (only the known pre-existing warnings).

- [ ] **Step 8: Visual check (run-undercity)**

Using the **run-undercity** skill, open the Plaza → Market → Buy. With several listings across kinds plus a couple of your own, confirm: chip bar shows `All` + only non-empty kinds + `Mine`, counts correct, `Pets` includes pets and eggs; tapping a chip filters; buying the last of a kind snaps back to `All`; `Mine` shows only your listings with Cancel and a `N / 10` header. (Sort defaults to cheapest-first; Affordable is off — controls come next.)

- [ ] **Step 9: Commit**

```bash
git add src/app/undercity/data/items.ts src/app/undercity/tabs/plaza-tab.component.ts src/app/undercity/tabs/plaza-tab.component.html src/app/undercity/tabs/plaza-tab.component.scss
git commit -m "feat(undercity): market kind-chip filter + Mine view

Co-Authored-By: Claude Opus 4.8 (1M context) <noreply@anthropic.com>"
```

---

## Task 2: Sort control (Price ↑ / Price ↓ / Rarity)

The sort logic already runs in `visibleMarketRows`; this adds the segmented control that drives `marketSort`.

**Files:**
- Modify: `src/app/undercity/tabs/plaza-tab.component.html`
- Modify: `src/app/undercity/tabs/plaza-tab.component.scss`

- [ ] **Step 1: Add the sort segmented control to the toolbar**

In `plaza-tab.component.html`, replace the placeholder comment line inside `.market-toolbar`:

```html
            <!-- market-controls (sort + affordable) added in Tasks 2–3 -->
```

with:

```html
            <div class="market-controls">
              <div class="market-seg" role="group" aria-label="Sort listings">
                <button [attr.aria-pressed]="marketSort() === 'price-asc'" (click)="setMarketSort('price-asc')">Price ↑</button>
                <button [attr.aria-pressed]="marketSort() === 'price-desc'" (click)="setMarketSort('price-desc')">Price ↓</button>
                <button [attr.aria-pressed]="marketSort() === 'rarity'" (click)="setMarketSort('rarity')">Rarity</button>
              </div>
              <!-- affordable toggle added in Task 3 -->
            </div>
```

- [ ] **Step 2: Add sort-control styles**

In `plaza-tab.component.scss`, append:

```scss
.market-controls {
  display: flex;
  align-items: center;
  gap: 8px;
  flex-wrap: wrap;
  padding: 8px 2px 0;
}

.market-seg {
  display: inline-flex;
  border: 1px solid rgba(216, 243, 220, 0.14);
  border-radius: 10px;
  overflow: hidden;

  button {
    padding: 6px 10px;
    border: 0;
    border-right: 1px solid rgba(216, 243, 220, 0.14);
    background: transparent;
    color: #9aa79a;
    font: inherit;
    font-size: 0.72rem;
    font-weight: 700;
    cursor: pointer;
    transition: background 0.15s ease, color 0.15s ease;

    &:last-child { border-right: 0; }

    &[aria-pressed='true'] {
      background: rgba(224, 192, 120, 0.16);
      color: #e6c078;
    }
  }
}
```

- [ ] **Step 3: Build**

Run: `npm run build`
Expected: build completes with no errors.

- [ ] **Step 4: Visual check (run-undercity)**

In Buy view, toggle each sort: `Price ↑` cheapest first, `Price ↓` priciest first, `Rarity` mythic→legendary→rare→common with consumables sinking to the bottom.

- [ ] **Step 5: Commit**

```bash
git add src/app/undercity/tabs/plaza-tab.component.html src/app/undercity/tabs/plaza-tab.component.scss
git commit -m "feat(undercity): market sort control (price / rarity)

Co-Authored-By: Claude Opus 4.8 (1M context) <noreply@anthropic.com>"
```

---

## Task 3: Affordable filter toggle

The affordability filter already runs in `visibleMarketRows`; this adds the toggle that drives `marketAffordable`, shown only when not in the Mine view.

**Files:**
- Modify: `src/app/undercity/tabs/plaza-tab.component.html`
- Modify: `src/app/undercity/tabs/plaza-tab.component.scss`

- [ ] **Step 1: Add the toggle to the controls row**

In `plaza-tab.component.html`, replace the placeholder line inside `.market-controls`:

```html
              <!-- affordable toggle added in Task 3 -->
```

with:

```html
              <button
                class="market-toggle"
                [class.on]="marketAffordable()"
                [attr.aria-pressed]="marketAffordable()"
                (click)="toggleMarketAffordable()"
              >
                <mat-icon class="mi">{{ marketAffordable() ? 'check_box' : 'check_box_outline_blank' }}</mat-icon>
                Affordable
              </button>
```

Then hide the whole controls row while managing your own listings by wrapping it in a guard. Change the opening `<div class="market-controls">` line to:

```html
            @if (marketFilter() !== 'mine') {
            <div class="market-controls">
```

and add the matching close `}` immediately after the controls `</div>`:

```html
            </div>
            }
```

(The sort segmented control is inside this same block, so both sort and affordable hide together in the Mine view — sorting your ≤10 listings is unnecessary.)

- [ ] **Step 2: Add toggle styles**

In `plaza-tab.component.scss`, append:

```scss
.market-toggle {
  display: inline-flex;
  align-items: center;
  gap: 6px;
  padding: 6px 11px 6px 8px;
  border-radius: 10px;
  border: 1px solid rgba(216, 243, 220, 0.14);
  background: transparent;
  color: #9aa79a;
  font: inherit;
  font-size: 0.72rem;
  font-weight: 700;
  cursor: pointer;
  transition: background 0.15s ease, color 0.15s ease, border-color 0.15s ease;

  .mi {
    font-size: 1rem;
    width: 1rem;
    height: 1rem;
  }

  &.on {
    background: rgba(95, 209, 138, 0.14);
    border-color: rgba(95, 209, 138, 0.5);
    color: #5fd18a;
  }
}
```

- [ ] **Step 3: Build**

Run: `npm run build`
Expected: build completes with no errors.

- [ ] **Step 4: Visual check (run-undercity)**

In Buy view with a known Spore balance, enable `Affordable`: listings priced above your Spores disappear; a listing you can afford but have no room for stays visible with its existing block-reason note. Switch to `Mine`: the sort + Affordable row is hidden. Switch back: it returns.

- [ ] **Step 5: Commit**

```bash
git add src/app/undercity/tabs/plaza-tab.component.html src/app/undercity/tabs/plaza-tab.component.scss
git commit -m "feat(undercity): market affordable filter toggle

Co-Authored-By: Claude Opus 4.8 (1M context) <noreply@anthropic.com>"
```

---

## Final verification

- [ ] **Full build:** `npm run build` — no errors.
- [ ] **End-to-end (run-undercity):** seed a market with gear, consumables, scrolls, a pet, an egg, and 2–3 of your own listings. Walk the full flow: chips + counts (Pets = pets + eggs), all three sorts, Affordable on/off, Mine cancel + `N / 10` cap header, reset-on-empty after buying the last of a kind, and each per-filter empty state.
- [ ] Confirm the **Sell** view is unchanged and the **Umori auction auto-list** items (if present) appear and filter like any other listing.

---

## Self-review notes (author)

- **Spec coverage:** §4.1 signals → T1S4; §4.2 groups/counts/reset → T1S3–4; §4.3 filter+sort → T1S4 (logic), UI in T2/T3; §4.4 affordable → T1S4 + T3; §4.5 Mine → T1S4–5; §4.6 empty states → T1S4–5; §4.7 toolbar → T1/T2/T3; §5 files → all tasks; mirror constant → T1S1. No gap.
- **No placeholders:** every code step shows full content; the two template `<!-- … -->` markers are real lines that later tasks replace (not TODOs).
- **Type consistency:** `MarketFilter`, `marketFilter/marketSort/marketAffordable`, `marketChips`, `visibleMarketRows`, `mineListingCount`, `maxListings`, `MARKET_GROUPS`, `MARKET_RARITY_RANK` are named identically wherever referenced across tasks.
