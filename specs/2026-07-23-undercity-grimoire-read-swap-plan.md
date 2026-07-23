# Grimoire Read-First + Swap-Confirm UI — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Let players read any owned grimoire's spell list before opening it, and guard the swap behind an explicit "locks swapping for 30 min" confirm step.

**Architecture:** Frontend-only change to the Grimoire `.card` in the creature tab. Two new component signals drive an expandable, readable shelf and an inline confirm prompt (reusing the bag's drop-confirm idiom). No backend, config, or cooldown-value changes — the existing `equip-grimoire` action and `grimoireSwapLeft()` computed are reused as-is.

**Tech Stack:** Angular 20 standalone component (signals, `@if`/`@for` control flow), SCSS. No frontend test runner exists (Karma removed) — verification is `npm run build` (via Bash/`npm`) plus manual driving of the creature tab.

**Spec:** [2026-07-23-undercity-grimoire-read-swap-design.md](2026-07-23-undercity-grimoire-read-swap-design.md)

---

## File Structure

- Modify `src/app/undercity/tabs/creature-tab.component.ts` — add `expandedBook` + `confirmOpen` signals and `toggleBook`/`askOpen`/`cancelOpen` handlers; clear both signals after a successful `equipBook`.
- Modify `src/app/undercity/tabs/creature-tab.component.html` — replace the `.book-list` block (currently lines ~413-442) with an expandable, readable shelf + always-on cost line.
- Modify `src/app/undercity/tabs/creature-tab.component.scss` — add styles for `.book-item`, `.book-detail`, `.book-actions`, `.book-confirm`, the chevron badge, and `.grimoire-cost`.

No new files. The open-loadout top panel (`.open-book-head` + `.spell-rows`, lines ~374-412) is unchanged.

---

### Task 1: Component state + handlers

**Files:**
- Modify: `src/app/undercity/tabs/creature-tab.component.ts:431` (near the existing `dropConfirm` UI-state signal) and `:340-352` (`equipBook`)

- [ ] **Step 1: Add the two UI-state signals and their handlers**

Insert immediately after the `dropConfirm` block (the `cancelDrop()` method around line 439), matching the surrounding style:

```ts
/** Which owned grimoire's spell list is expanded for reading (null = none). */
protected readonly expandedBook = signal<string | null>(null);
/** Which grimoire has its "locks swapping for 30 min" confirm prompt live. */
protected readonly confirmOpen = signal<string | null>(null);

/** Expand/collapse a book for reading. The open book is never expandable —
 *  its spells already render in the top loadout panel. */
toggleBook(id: string): void {
  if (this.store.you()?.equippedGrimoire === id) return;
  this.confirmOpen.set(null);
  this.expandedBook.set(this.expandedBook() === id ? null : id);
}

/** Show the swap-confirm prompt for a book. */
askOpen(id: string): void {
  this.confirmOpen.set(id);
}

/** Back out of the swap-confirm prompt, leaving the book expanded to read. */
cancelOpen(): void {
  this.confirmOpen.set(null);
}
```

- [ ] **Step 2: Clear both signals after a successful swap**

In `equipBook` (lines ~340-352), add the resets after the `await this.run(...)` call so the shelf collapses back once the new book is open. The final method reads:

```ts
async equipBook(id: string): Promise<void> {
  // Clicking the already-open book is a no-op — never stow to no-book (that
  // silently strips every spell and confuses players). Opening a *different*
  // book is what the swap cooldown gates.
  if (this.store.you()?.equippedGrimoire === id) {
    this.showToast('Already open.');
    return;
  }
  await this.run(async () => {
    const resp = await this.store.action('equip-grimoire', { grimoireId: id });
    this.showToast(resp.text ?? 'Done.');
  });
  this.confirmOpen.set(null);
  this.expandedBook.set(null);
}
```

- [ ] **Step 3: Build to verify TS compiles**

Run: `npm run build`
Expected: build succeeds (no TS errors). The signals are unused by the template until Task 2 — that's fine, Angular does not error on unused component members.

- [ ] **Step 4: Commit**

```bash
git add src/app/undercity/tabs/creature-tab.component.ts
git commit -m "feat(undercity): grimoire read/confirm state on creature tab"
```

---

### Task 2: Readable shelf + confirm template

**Files:**
- Modify: `src/app/undercity/tabs/creature-tab.component.html:413-442` (the `@if ((you.grimoires ?? []).length) { <div class="book-list"> ... }` block)

- [ ] **Step 1: Replace the whole `book-list` block**

Replace the existing block (from `@if ((you.grimoires ?? []).length) {` through its closing `}`, i.e. the `.book-list` div and the trailing cooldown `<p>`) with:

```html
@if ((you.grimoires ?? []).length) {
  <div class="book-list">
    @for (g of ownedBooks(); track g.id) {
      @let isOpen = you.equippedGrimoire === g.id;
      @let expanded = expandedBook() === g.id && !isOpen;
      <div class="book-item" [class.selected]="isOpen" [class.expanded]="expanded">
        <button
          type="button"
          class="uc-btn book-chip"
          [class.selected]="isOpen"
          [disabled]="busy()"
          (click)="toggleBook(g.id)"
        >
          <span class="chip-title"><mat-icon class="mi">menu_book</mat-icon> {{ g.name }}</span>
          @if (isOpen) {
            <span class="chip-badge open">✓ OPEN</span>
          } @else {
            <span class="chip-badge chev">{{ expanded ? '▾' : '▸' }}</span>
          }
        </button>

        @if (expanded) {
          <div class="book-detail">
            <div class="spell-rows">
              @for (sp of bookSpells(g); track sp.id) {
                <div class="spell-row">
                  <span class="spell-name">
                    <mat-icon class="mi">{{ sp.icon }}</mat-icon>
                    {{ sp.name }} <em>{{ sp.desc }}</em>
                  </span>
                </div>
              }
            </div>
            <div class="book-actions">
              @if (grimoireSwapLeft() > 0) {
                <span class="locked-note">🔒 Locked · {{ grimoireSwapLeft() }}m</span>
              } @else if (confirmOpen() === g.id) {
                <span class="book-confirm">
                  <span class="confirm-q">Opening locks swapping for 30 min. Open <strong>{{ g.name }}</strong>?</span>
                  <button class="uc-btn use-btn" [disabled]="busy()" (click)="equipBook(g.id)">Open</button>
                  <button class="uc-btn use-btn ghost" [disabled]="busy()" (click)="cancelOpen()">Cancel</button>
                </span>
              } @else {
                <button class="uc-btn use-btn" [disabled]="busy()" (click)="askOpen(g.id)">Open this book</button>
              }
            </div>
          </div>
        }
      </div>
    }
  </div>

  <p class="muted bag-empty grimoire-cost">
    One loadout at a time — opening a different book locks swapping for 30 min.
    @if (grimoireSwapLeft() > 0) {
      {{ grimoireSwapLeft() }} min until you can open a different book.
    }
  </p>
}
```

Notes for the implementer:
- `ownedBooks()`, `bookSpells(g)`, `grimoireSwapLeft()`, `equipBook`, `busy()` all already exist on the component. Only `expandedBook`, `confirmOpen`, `toggleBook`, `askOpen`, `cancelOpen` are new (Task 1).
- `toggleBook` self-guards the open book, so the open book's chip click is a safe no-op — no need to disable it in the template.
- The old per-chip `locked`/`disabled` gating is intentionally gone: reading must work during a cooldown. Only the `Open` control is gated (the `grimoireSwapLeft() > 0` branch).

- [ ] **Step 2: Build to verify the template compiles**

Run: `npm run build`
Expected: build succeeds. Angular's template type-checker resolves every binding (all referenced members exist after Task 1).

- [ ] **Step 3: Commit**

```bash
git add src/app/undercity/tabs/creature-tab.component.html
git commit -m "feat(undercity): expandable readable grimoire shelf + swap confirm"
```

---

### Task 3: Styles for the readable shelf

**Files:**
- Modify: `src/app/undercity/tabs/creature-tab.component.scss` — extend the existing `.book-list` block (ends line ~1286) and reuse `.use-btn`/`.ghost` (defined ~832-847) and `.spell-rows`/`.spell-row` (defined ~1177-1216).

- [ ] **Step 1: Add styles for the new elements**

Inside the existing `.book-list { ... }` rule (append after the `.book-chip` rule, before `.book-list`'s closing brace), add the chevron badge state and the item/detail wrappers:

```scss
  .book-item {
    display: flex;
    flex-direction: column;
    gap: 0.4rem;

    &.expanded .book-chip {
      border-color: var(--accent-color, #9ac26e);
    }
  }

  .book-chip .chip-badge.chev {
    opacity: 0.6;
    font-weight: 700;
  }

  .book-detail {
    padding: 0.1rem 0.2rem 0.4rem 0.6rem;
    border-left: 2px solid var(--accent-color, #9ac26e);

    .spell-rows {
      margin-bottom: 0.5rem;
    }
  }

  .book-actions {
    display: flex;
    align-items: center;
    flex-wrap: wrap;
    gap: 0.4rem;

    .locked-note {
      font-size: 0.8rem;
      opacity: 0.7;
    }
  }

  .book-confirm {
    display: flex;
    align-items: center;
    flex-wrap: wrap;
    gap: 0.4rem;

    .confirm-q {
      font-size: 0.82rem;
      opacity: 0.85;
    }
  }
```

Then, after the `.book-list { ... }` rule closes, add the cost line style:

```scss
.grimoire-cost {
  margin-top: 0.6rem;
}
```

- [ ] **Step 2: Build to verify SCSS compiles and the bundle is produced**

Run: `npm run build`
Expected: build succeeds with no SCSS errors and no budget-exceeded failures.

- [ ] **Step 3: Commit**

```bash
git add src/app/undercity/tabs/creature-tab.component.scss
git commit -m "style(undercity): grimoire shelf expand/confirm styling"
```

---

### Task 4: Manual verification

No frontend test runner exists, so this feature is verified by driving the creature tab in a browser. See the `run-undercity` skill for launching against the live AWS backend.

- [ ] **Step 1: Final build**

Run: `npm run build`
Expected: PASS (clean build).

- [ ] **Step 2: Drive the creature tab → Gear sub-tab → Grimoire card** and confirm each spec acceptance point:
  - Expand a non-open book → its spell list (icon + name + description) renders under the chip with an accent left-border.
  - With a swap cooldown active (open a different book once, then reopen the tab): every non-open book still **expands and reads**, and its action row shows `🔒 Locked · Nm` instead of an Open button.
  - With no cooldown: tap `Open this book` → the row shows *"Opening locks swapping for 30 min. Open X?"* with **Open**/**Cancel**; no swap fires until **Open** is tapped; **Cancel** leaves the book expanded.
  - The cost line under the shelf is **always** present; once a swap is on cooldown it appends *"N min until you can open a different book."*
  - Tapping the open book's chip does nothing (no expand, no stow).

- [ ] **Step 3: Note for the user that a deploy is needed** (the user runs deploys themselves — do not run `npm run deploy`).

---

## Self-Review

- **Spec coverage:** Read-any-book (Task 2 expand + `bookSpells`), reading works during cooldown (Task 2 `@if (expanded)` is independent of `grimoireSwapLeft`), confirm step (Task 2 `confirmOpen` branch), always-on cost line with appended countdown (Task 2 `.grimoire-cost`), open book non-expandable (Task 1 `toggleBook` guard + Task 2 `expanded = … && !isOpen`), no backend/config/cooldown change (only three frontend files touched). All covered.
- **Placeholder scan:** No TBD/TODO; every code step shows full code.
- **Type consistency:** Signal names (`expandedBook`, `confirmOpen`) and method names (`toggleBook`, `askOpen`, `cancelOpen`, `equipBook`, `bookSpells`, `ownedBooks`, `grimoireSwapLeft`, `busy`) are used identically across Tasks 1–2. SCSS class names (`book-item`, `book-detail`, `book-actions`, `book-confirm`, `chip-badge.chev`, `locked-note`, `grimoire-cost`) match the template in Task 2.
