# Undercity Item-Detail Popup + Send-to-Market Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** On the Undercity creature tab, make every inventory item tappable to open a bottom-sheet popup that explains it (stat + ability chips), and replace the throw-away "Drop"/trash path with a "send to market" listing that defaults to the cheapest allowed price.

**Architecture:** A single signal-driven overlay lives inside `CreatureTabComponent` (no new component, no MatDialog), matching the component's existing inline-overlay pattern. Tapping an equipped tile, a stash tile, or a bag row opens the popup. The popup owns all actions (Equip / Use / Plant / Send-to-market); the inline row buttons and the trash icon are removed. "Send to market" reuses the already-shipped `market-list` action and `marketBand` price helper — **no backend changes**.

**Tech Stack:** Angular 20 standalone component, signals, SCSS. Chip ability copy comes from `RIDER_AUGMENTS` in `src/app/undercity/data/combat.ts`; gear stat/`light` fields from `GEAR_MAP` in `src/app/undercity/data/items.ts`.

**Verification note (read first):** This repo has **no frontend test runner** (Karma/Jasmine removed; `ng test` is unavailable — see CLAUDE.md). The established verification path is `npm run build` (must succeed with no errors) plus driving the app in a browser (see the `run-undercity` skill). Every task therefore ends with a build check instead of a unit test; the final task drives the real UI. The backend is untouched, so the Python market suite only needs a single confirming run.

---

## File Structure

- **Modify** `src/app/undercity/tabs/creature-tab.component.ts` — add the popup state (`selectedItem`, `expandedChip`, `listOpen`, `listPrice`), the `selectItem`/`closeItem`/`toggleChip`/`beginList`/`sendToMarket` methods, chip builders (`statChips`, `abilityChips`), and imports for `RIDER_AUGMENTS`, `marketBand`, `MarketKind`. Remove `dropConfirm`/`askDrop`/`cancelDrop`/`confirmDrop`.
- **Modify** `src/app/undercity/tabs/creature-tab.component.html` — make the three equipped tiles, the stash tiles, and the bag rows tappable; remove inline Equip/Use/Plant buttons and the trash button + drop-confirm block; add the item-detail overlay markup.
- **Modify** `src/app/undercity/tabs/creature-tab.component.scss` — bottom-sheet overlay, chip, and price-control styles.

No other files change.

---

### Task 1: Component state, chip builders, and market method (TS)

**Files:**
- Modify: `src/app/undercity/tabs/creature-tab.component.ts`

- [ ] **Step 1: Add imports for market helpers and rider ability copy**

In the existing import block, extend the items import and add a combat import.

Change line 14 from:

```ts
import { GEAR_MAP, CONSUMABLE_MAP, tierRarity } from '../data/items';
```

to:

```ts
import { GEAR_MAP, CONSUMABLE_MAP, tierRarity, marketBand, MarketKind } from '../data/items';
import { RIDER_AUGMENTS } from '../data/combat';
```

(Importing `RIDER_AUGMENTS` here is safe: `combat.ts` imports from `items.ts`, but the component importing both creates no cycle. Do **not** add the chip helper to `items.ts` — that would make `items.ts` import `combat.ts` while `combat.ts` imports `items.ts`, a circular dependency.)

- [ ] **Step 2: Add the popup types and signals**

Add near the other `protected readonly ... = signal(...)` fields (e.g. just after `loadedDiePick` around line 72):

```ts
/** Which inventory item's detail popup is open (null = none). */
protected readonly selectedItem = signal<SelectedItem | null>(null);
/** Which ability chip inside the popup is expanded to show its blurb. */
protected readonly expandedChip = signal<number | null>(null);
/** Whether the popup's send-to-market price control is revealed. */
protected readonly listOpen = signal(false);
/** Current price typed into the send-to-market control (Spores). */
protected readonly listPrice = signal(0);
```

And add these type/interface declarations just above the `@Component` decorator (after the `SUBTABS`/`loadSubTab` helpers, around line 57):

```ts
type ItemSource = 'equipped' | 'stash' | 'bag';

/** A chip rendered in the item-detail popup. Stat chips have no blurb;
 *  ability chips carry an expandable blurb explaining what they do. */
interface ItemChip {
  label: string;
  blurb?: string;
}

/** The inventory item whose detail popup is open. `index` is the array index
 *  used by market-list / equip-gear (stash or bag); -1 for equipped gear,
 *  which is info-only (no unequip action exists). */
interface SelectedItem {
  source: ItemSource;
  kind: MarketKind; // 'gear' for equipped/stash, 'consumable' for bag
  id: string;
  index: number;
  slotLabel: string; // 'Fang' | 'Carapace' | 'Charm' | item type — header sub-label
}
```

- [ ] **Step 3: Add open/close/select methods**

Add as protected methods on the class (e.g. after `equipFromStash`, around line 169):

```ts
/** Open the item-detail popup for an inventory item. */
protected selectItem(source: ItemSource, id: string, index: number, slotLabel: string): void {
  if (!id) return;
  const kind: MarketKind = source === 'bag' ? 'consumable' : 'gear';
  this.expandedChip.set(null);
  this.listOpen.set(false);
  this.selectedItem.set({ source, kind, id, index, slotLabel });
}

/** Close the popup and reset its transient state. */
protected closeItem(): void {
  this.selectedItem.set(null);
  this.expandedChip.set(null);
  this.listOpen.set(false);
}

/** Toggle an ability chip's blurb open/closed. */
protected toggleChip(i: number): void {
  this.expandedChip.update((cur) => (cur === i ? null : i));
}
```

- [ ] **Step 4: Add the chip builders**

Add as protected methods:

```ts
/** Stat chips (+2 ATK, +1 SPD, +3 max HP) for a gear item; empty for others. */
protected statChips(item: SelectedItem): ItemChip[] {
  if (item.kind !== 'gear') return [];
  const g = GEAR_MAP[item.id];
  if (!g) return [];
  const chips: ItemChip[] = [];
  if (g.atk) chips.push({ label: `+${g.atk} ATK` });
  if (g.def) chips.push({ label: `+${g.def} DEF` });
  if (g.spd) chips.push({ label: `+${g.spd} SPD` });
  if (g.maxHp) chips.push({ label: `+${g.maxHp} max HP` });
  return chips;
}

/** Expandable ability chips: gear rider + illumination, or a consumable's effect. */
protected abilityChips(item: SelectedItem): ItemChip[] {
  if (item.kind === 'consumable') {
    const c = CONSUMABLE_MAP[item.id];
    return c ? [{ label: 'Effect', blurb: c.desc }] : [];
  }
  const g = GEAR_MAP[item.id];
  if (!g) return [];
  const chips: ItemChip[] = [];
  if (g.rider) {
    const aug = RIDER_AUGMENTS[g.rider];
    if (aug) chips.push({ label: aug.label, blurb: aug.blurb });
  }
  if (g.light === 'full') {
    chips.push({ label: 'Illuminating', blurb: 'Reveals the whole dungeon while equipped.' });
  }
  return chips;
}
```

- [ ] **Step 5: Add the market band accessor and send-to-market methods**

Add as protected members (the band accessor mirrors `plaza-tab.component.ts`):

```ts
protected readonly marketBand = marketBand;

/** Reveal the price control, seeding the cheapest allowed price. */
protected beginList(item: SelectedItem): void {
  this.listPrice.set(this.marketBand(item.kind, item.id).lo);
  this.listOpen.set(true);
}

/** List the selected item on the Player Market at the typed price.
 *  Reuses the shipped `market-list` action; band + listing-cap errors come
 *  back as descriptive text and surface via the toast. */
protected async sendToMarket(item: SelectedItem, price: number): Promise<void> {
  if (!Number.isFinite(price)) return;
  await this.run(async () => {
    const resp = await this.store.action('market-list', {
      kind: item.kind,
      index: item.index,
      price: Math.round(price),
    });
    this.showToast(resp.text ?? 'Listed on the market.');
    this.closeItem();
  });
}
```

- [ ] **Step 6: Equip / Use from within the popup**

The popup calls the existing `equipFromStash(index)` and `useItem(item)` methods directly. Add two thin wrappers that also close the popup, placed after `sendToMarket`:

```ts
/** Equip a stash piece from the popup, then close it. */
protected async equipFromPopup(item: SelectedItem): Promise<void> {
  await this.equipFromStash(item.index);
  this.closeItem();
}

/** Use/plant a bag consumable from the popup, then close it.
 *  loaded_die keeps its picker flow (useItem returns early), so only close
 *  when the popup isn't handing off to the die picker. */
protected async useFromPopup(item: SelectedItem): Promise<void> {
  await this.useItem(item.id);
  if (item.id !== 'loaded_die') this.closeItem();
}
```

- [ ] **Step 7: Build to verify the TS compiles**

Run: `npm run build`
Expected: build completes with no errors. (Nothing renders the new members yet; this just confirms types/imports are valid. `selectItem`, `useFromPopup`, etc. will be flagged as unused by TS only if `noUnusedLocals` is on for methods — it is not for class members, so the build passes.)

- [ ] **Step 8: Commit**

```bash
git add src/app/undercity/tabs/creature-tab.component.ts
git commit -m "feat(undercity): creature-tab item-popup state + send-to-market method"
```

---

### Task 2: Make tiles/rows tappable and add the overlay markup (HTML)

**Files:**
- Modify: `src/app/undercity/tabs/creature-tab.component.html`

- [ ] **Step 1: Make the three equipped-gear tiles open the popup**

Each equipped tile is a `<div class="gear-tile" ...>` with a `@if (you.gear['<slot>']; as g)` body (fang ~line 216, carapace ~230, charm ~244). Add a click handler to each tile's opening `<div>` that opens the popup only when a piece is equipped. For the **fang** tile, change its opening `<div class="gear-tile" ...>` to include:

```html
(click)="you.gear['fang'] && selectItem('equipped', you.gear['fang']!, -1, 'Fang')"
```

For **carapace** add:

```html
(click)="you.gear['carapace'] && selectItem('equipped', you.gear['carapace']!, -1, 'Carapace')"
```

For **charm** add:

```html
(click)="you.gear['charm'] && selectItem('equipped', you.gear['charm']!, -1, 'Charm')"
```

Leave the tile inner markup (icon, name, rarity badge, `gear-tile-desc`) unchanged.

- [ ] **Step 2: Make stash tiles open the popup and remove the inline Equip button**

In the Stash section (`@for (row of stashRows(); ...)`, ~line 269), add a click handler to the `<div class="gear-tile" [attr.data-rarity]=...>` opening tag:

```html
(click)="selectItem('stash', row.info.id, row.index, row.info.slot)"
```

Then **delete** the inline equip button block (currently lines ~279-285):

```html
<button
  class="uc-btn use-btn stash-equip"
  [disabled]="busy()"
  (click)="equipFromStash(row.index)"
>
  Equip
</button>
```

- [ ] **Step 3: Rewrite the bag rows to be tappable and drop-free**

Replace the entire bag-rows `@for` block (currently ~lines 298-345, from `@for (item of you.bag; track $index) {` through its closing `}`) with:

```html
@for (item of you.bag; track $index) {
  <div class="bag-row bag-row--tap" (click)="selectItem('bag', item, $index, 'Bag item')">
    <span class="bag-item">
      <mat-icon class="mi">{{ consumableMap[item].icon }}</mat-icon>
      {{ consumableMap[item].name }}
    </span>
    <span class="bag-actions">
      @switch (itemAction(item)) {
        @case ('passive') {
          <span class="bag-tag">Auto</span>
        }
        @case ('battle') {
          <span class="bag-tag">Battle</span>
        }
      }
      <mat-icon class="mi bag-chevron">chevron_right</mat-icon>
    </span>
  </div>
}
```

(The Use/Plant actions now live in the popup. The Auto/Battle tags stay as at-a-glance hints. The trash button and the `dropConfirm` confirm block are gone.)

- [ ] **Step 4: Add the item-detail overlay markup**

Add this block at the very end of the template, after the last closing tag of the component's root content (append to end of file). It renders only when `selectedItem()` is set:

```html
@if (selectedItem(); as item) {
  <div class="item-sheet-backdrop" (click)="closeItem()">
    <div class="item-sheet" (click)="$event.stopPropagation()">
      <button class="item-sheet-close" (click)="closeItem()" aria-label="Close">
        <mat-icon class="mi">close</mat-icon>
      </button>

      <header class="item-sheet-head">
        @if (item.kind === 'gear') {
          <mat-icon class="mi slot-mi" [svgIcon]="'uc-' + gearMap[item.id].slot"></mat-icon>
          <div class="item-sheet-title">
            <span class="item-sheet-name">{{ gearMap[item.id].name }}
              <span class="rarity-badge {{ tierRarity(gearMap[item.id].tier).key }}">{{ tierRarity(gearMap[item.id].tier).label }}</span>
            </span>
            <span class="item-sheet-sub">{{ item.slotLabel }}</span>
          </div>
        } @else {
          <mat-icon class="mi slot-mi">{{ consumableMap[item.id].icon }}</mat-icon>
          <div class="item-sheet-title">
            <span class="item-sheet-name">{{ consumableMap[item.id].name }}</span>
            <span class="item-sheet-sub">Bag item</span>
          </div>
        }
      </header>

      @if (statChips(item).length) {
        <div class="chip-row">
          @for (chip of statChips(item); track chip.label) {
            <span class="chip chip--stat">{{ chip.label }}</span>
          }
        </div>
      }

      @if (abilityChips(item).length) {
        <div class="chip-row">
          @for (chip of abilityChips(item); track chip.label; let i = $index) {
            <button class="chip chip--ability" [class.open]="expandedChip() === i" (click)="toggleChip(i)">
              {{ chip.label }}
              <mat-icon class="mi chip-caret">{{ expandedChip() === i ? 'expand_less' : 'expand_more' }}</mat-icon>
            </button>
          }
        </div>
        @if (expandedChip() !== null && abilityChips(item)[expandedChip()!]; as chip) {
          <p class="chip-blurb">{{ chip.blurb }}</p>
        }
      }

      <div class="item-sheet-actions">
        @switch (item.source) {
          @case ('stash') {
            <button class="uc-btn" [disabled]="busy()" (click)="equipFromPopup(item)">Equip</button>
          }
          @case ('bag') {
            @if (itemAction(item.id) === 'plant') {
              <button class="uc-btn" [disabled]="busy()" (click)="useFromPopup(item)">Plant here</button>
            } @else if (itemAction(item.id) === 'use') {
              <button class="uc-btn" [disabled]="busy()" (click)="useFromPopup(item)">Use</button>
            }
          }
          @case ('equipped') {
            <span class="item-sheet-hint muted">Equipped. To sell it, equip another piece first.</span>
          }
        }
      </div>

      @if (item.source !== 'equipped') {
        <div class="item-sheet-market">
          @if (!listOpen()) {
            <button class="uc-btn ghost" [disabled]="busy()" (click)="beginList(item)">
              <mat-icon class="mi">storefront</mat-icon> Send to market
            </button>
          } @else {
            <div class="market-price">
              <label>Price (Spores)</label>
              <input
                #mp
                type="number"
                class="price-input"
                [value]="listPrice()"
                [min]="marketBand(item.kind, item.id).lo"
                [max]="marketBand(item.kind, item.id).hi"
              />
              <span class="band-note muted">
                {{ marketBand(item.kind, item.id).lo }}–{{ marketBand(item.kind, item.id).hi }}
              </span>
              <button class="uc-btn" [disabled]="busy()" (click)="sendToMarket(item, mp.valueAsNumber)">List</button>
            </div>
          }
        </div>
      }
    </div>
  </div>
}
```

- [ ] **Step 2 sanity — confirm the `loaded-note` block still works**

The Bag section's `@if (you.pendingLoadedDie)` note (~line 347) sits *after* the bag-rows `@for` and is untouched — leave it in place.

- [ ] **Step 5: Build to verify the template compiles**

Run: `npm run build`
Expected: build completes with no errors. (If Angular reports an unused method or a missing member, cross-check the names against Task 1.)

- [ ] **Step 6: Commit**

```bash
git add src/app/undercity/tabs/creature-tab.component.html
git commit -m "feat(undercity): tappable inventory rows + item-detail popup markup"
```

---

### Task 3: Overlay, chip, and price-control styles (SCSS)

**Files:**
- Modify: `src/app/undercity/tabs/creature-tab.component.scss`

- [ ] **Step 1: Append the styles**

Add at the end of the file. Uses the repo's design tokens per STYLE_GUIDE.md (`--accent-color`, surface/border vars already used elsewhere in this stylesheet — match the existing `.card`/`.uc-btn` look; if a token name differs, reuse whatever the file already references for card backgrounds and borders).

```scss
// ── Item-detail popup (bottom sheet) ────────────────────────────────────────
.item-sheet-backdrop {
  position: fixed;
  inset: 0;
  z-index: 50;
  display: flex;
  align-items: flex-end;
  justify-content: center;
  background: rgba(0, 0, 0, 0.55);
}

.item-sheet {
  position: relative;
  width: 100%;
  max-width: 480px;
  background: var(--surface-color, #1c211d);
  border: 1px solid var(--border-color, #33403a);
  border-bottom: none;
  border-radius: 16px 16px 0 0;
  padding: 1.25rem 1rem calc(1rem + env(safe-area-inset-bottom));
  box-shadow: 0 -8px 24px rgba(0, 0, 0, 0.4);
  animation: item-sheet-up 160ms ease-out;
}

@keyframes item-sheet-up {
  from { transform: translateY(100%); }
  to { transform: translateY(0); }
}

.item-sheet-close {
  position: absolute;
  top: 0.5rem;
  right: 0.5rem;
  background: none;
  border: none;
  color: inherit;
  cursor: pointer;
  padding: 0.25rem;
}

.item-sheet-head {
  display: flex;
  align-items: center;
  gap: 0.75rem;
  margin-bottom: 0.75rem;

  .slot-mi { width: 32px; height: 32px; }
}

.item-sheet-title { display: flex; flex-direction: column; gap: 0.15rem; }
.item-sheet-name { font-weight: 600; }
.item-sheet-sub { font-size: 0.8rem; opacity: 0.7; text-transform: capitalize; }

.chip-row {
  display: flex;
  flex-wrap: wrap;
  gap: 0.4rem;
  margin-bottom: 0.5rem;
}

.chip {
  display: inline-flex;
  align-items: center;
  gap: 0.2rem;
  padding: 0.2rem 0.55rem;
  border-radius: 999px;
  font-size: 0.8rem;
  line-height: 1.4;
  border: 1px solid var(--border-color, #33403a);
}

.chip--stat { background: rgba(255, 255, 255, 0.06); }

.chip--ability {
  cursor: pointer;
  color: inherit;
  background: rgba(95, 209, 138, 0.12);
  border-color: var(--accent-color, #5fd18a);
  &.open { background: rgba(95, 209, 138, 0.22); }
  .chip-caret { font-size: 1rem; width: 1rem; height: 1rem; }
}

.chip-blurb {
  margin: 0 0 0.75rem;
  font-size: 0.85rem;
  opacity: 0.85;
}

.item-sheet-actions {
  display: flex;
  gap: 0.5rem;
  margin: 0.5rem 0;
}

.item-sheet-hint { font-size: 0.85rem; }

.item-sheet-market {
  margin-top: 0.5rem;
  padding-top: 0.75rem;
  border-top: 1px solid var(--border-color, #33403a);
}

.market-price {
  display: flex;
  align-items: center;
  flex-wrap: wrap;
  gap: 0.5rem;

  label { font-size: 0.8rem; opacity: 0.8; }
  .price-input { width: 5rem; }
  .band-note { font-size: 0.8rem; }
}

// Bag row is now a tap target into the popup.
.bag-row--tap { cursor: pointer; }
.bag-chevron { opacity: 0.5; }
```

- [ ] **Step 2: Build to verify styles compile**

Run: `npm run build`
Expected: build completes with no errors.

- [ ] **Step 3: Commit**

```bash
git add src/app/undercity/tabs/creature-tab.component.scss
git commit -m "style(undercity): item-detail popup + chip + price-control styles"
```

---

### Task 4: Remove the dead drop-item code (TS)

**Files:**
- Modify: `src/app/undercity/tabs/creature-tab.component.ts`

- [ ] **Step 1: Delete the drop signal and handlers**

Remove these members (currently ~lines 456-473):

```ts
/** Index of the bag row awaiting drop confirmation (null = none). */
protected readonly dropConfirm = signal<number | null>(null);

protected askDrop(index: number): void {
  this.dropConfirm.set(index);
}

protected cancelDrop(): void {
  this.dropConfirm.set(null);
}

async confirmDrop(item: string): Promise<void> {
  await this.run(async () => {
    const resp = await this.store.action('drop-item', { item });
    this.dropConfirm.set(null);
    this.showToast(resp.text ?? 'Dropped.');
  });
}
```

- [ ] **Step 2: Grep to confirm no remaining references**

Run: `grep -rn "dropConfirm\|askDrop\|cancelDrop\|confirmDrop\|drop-item" src/app/undercity`
Expected: no matches in `creature-tab.component.*`. (A match inside the Python backend or tests is fine — the `drop-item` server handler stays; it's simply no longer called from the client.)

- [ ] **Step 3: Build to verify**

Run: `npm run build`
Expected: build completes with no errors.

- [ ] **Step 4: Commit**

```bash
git add src/app/undercity/tabs/creature-tab.component.ts
git commit -m "refactor(undercity): drop the throw-away drop-item UI path"
```

---

### Task 5: End-to-end verification

**Files:** none (verification only)

- [ ] **Step 1: Confirm the backend market suite is still green**

The backend was not modified, but run it once to prove nothing coupled to the removed UI path:

Run: `cd infrastructure/lambda && python -m pytest tests/test_undercity_market.py -q`
Expected: all tests pass.

- [ ] **Step 2: Production build**

Run: `npm run build`
Expected: completes with no errors.

- [ ] **Step 3: Drive the creature tab in a browser**

Use the `run-undercity` skill to launch the dev server against the live AWS backend and reach the creature → Gear sub-tab with a creature that has equipped gear, a stash piece, and at least one bag consumable. Verify:
- Tapping an **equipped** gear tile opens the popup showing stat chips + an ability chip; tapping the ability chip expands its blurb; no market/equip action, only the "equip another piece first" hint.
- Tapping a **stash** tile opens the popup; **Equip** works and closes the popup.
- Tapping a **bag** row opens the popup; **Use/Plant** works; there is **no trash icon** anywhere in the Bag.
- **Send to market** on a stash or bag item reveals a price input pre-filled with the band's low value; **List** succeeds and the item appears in the Plaza → Market listings.
- Listing an item when already at the per-seller cap surfaces the server's error text via the toast and leaves the popup open.

- [ ] **Step 4: Final commit (if any verification tweaks were needed)**

```bash
git add -A
git commit -m "chore(undercity): verify item-popup + send-to-market end-to-end"
```

---

## Self-Review

**Spec coverage:**
- Tap item → popup with description → Tasks 1 (chip builders, selectItem) + 2 (overlay). ✓
- Abilities as chips, expandable → `abilityChips` + chip markup + `toggleChip`. ✓
- Stat values as chips → `statChips`. ✓
- All inventory (equipped, stash, bag) → Task 2 Steps 1-3. ✓
- Popup owns actions (Equip/Use/Plant moved in, inline buttons removed) → Task 2 Steps 2-3 + overlay actions. ✓
- Send-to-market with editable price defaulting to cheapest → `beginList`/`sendToMarket` + market markup. ✓
- Drop/trash path eliminated from UI → Task 2 Step 3 + Task 4. ✓
- No backend changes → confirmed; Task 5 Step 1 only re-runs the suite. ✓
- Scrolls out of scope (Plaza handles them) → not touched. ✓

**Placeholder scan:** No TBD/TODO; every code step shows full code. ✓

**Type consistency:** `SelectedItem` fields (`source`, `kind`, `id`, `index`, `slotLabel`) are used identically across `selectItem`, `statChips`, `abilityChips`, `beginList`, `sendToMarket`, and the template. `MarketKind` matches the items.ts export. `marketBand(kind, id)` signature matches items.ts. `store.action(type, payload)` returns `ActionResponse` with `.text`, matching existing usage. ✓
