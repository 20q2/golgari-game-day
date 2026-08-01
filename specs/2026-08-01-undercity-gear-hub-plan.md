# Undercity Gear Landing Hub — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Replace the Creature tab's single scrolling **Gear** sub-tab with a three-tile landing hub (Equipment+Stash / Magic / Bag) whose tiles show live status and drill into each system.

**Architecture:** A new `gearSection` signal (`'home' | 'equip' | 'magic' | 'bag'`, persisted to localStorage like the existing `subTab`) drives an inner `@switch` inside the existing `@case ('gear')` block. `home` renders a 2×2 tile grid (three tiles, bottom-right empty); the other three render the **existing** Equipment / Stash / Bag / Grimoire card markup moved verbatim behind a `‹ Gear` back button, with Stash relocated under Equipment. No game logic, item data, or service changes.

**Tech Stack:** Angular 20 standalone component, signals + `@switch`/`@if` control flow, `mat-icon` (Material + registered `uc-*` svg icons), SCSS with the file's existing literal-hex Golgari palette. No test runner exists (see Verification).

---

## Verification approach (read first)

This repo has **no frontend unit-test runner** — CLAUDE.md states specs were removed and "Don't try `ng test`." Per the superpowers instruction-priority rule, that user instruction overrides the skill's default TDD-with-unit-tests loop. Every task is therefore verified by:

1. **Build:** `npm run build` from the repo root (run via the Bash tool). This runs the Angular compiler, which **type-checks the component and templates** — it catches missing signals, bad bindings, and template syntax errors. Expected: `Application bundle generation complete`, no errors.
2. **Visual (final task only):** drive the real app with the **run-undercity** skill (dev server + live AWS backend) and confirm behavior in the browser.

Commit after each task so the history stays bisectable.

## File structure

All changes are confined to the existing Creature-tab component — no new files:

- `src/app/undercity/tabs/creature-tab.component.ts` — new `GearSection` type + localStorage helpers, `gearSection` signal + persistence effect, `selectGear()` / `selectGearTab()` methods, and three tile-summary computeds (`wornCount`, `gearModLabel`, `spellsReadyCount`).
- `src/app/undercity/tabs/creature-tab.component.html` — restructure the `@case ('gear')` block into `@switch (gearSection())`; change the bottom Gear sub-tab button to `selectGearTab()`.
- `src/app/undercity/tabs/creature-tab.component.scss` — hub grid, tile, and back-button styles.

## Non-goals / explicit decisions

- **Hardware/browser Back is NOT intercepted.** No other internal navigation in this app (tabs, sub-tabs, modals) pushes browser history, so gear sections won't either — Back exits the game exactly as it does from any sub-tab today. The two in-app ways home are the `‹ Gear` back button and re-tapping the active **Gear** sub-tab (Task 5).
- No fourth tile — the grid intentionally leaves the bottom-right cell empty.
- Wardrobe and Sigils stay as their own sub-tabs; not folded in.

---

### Task 1: Gear-section state, persistence, and tile-summary computeds (TS)

**Files:**
- Modify: `src/app/undercity/tabs/creature-tab.component.ts`

- [ ] **Step 1: Add the `GearSection` type + localStorage helpers**

Directly below the existing `SUBTAB_KEY` / `loadSubTab()` block (`creature-tab.component.ts:44-59`), add:

```typescript
type GearSection = 'home' | 'equip' | 'magic' | 'bag';

/** localStorage key remembering which gear section (hub or a drilled-in
 *  panel) was last open, so returning to the Gear tab restores it. */
const GEAR_SECTION_KEY = 'uc-gear-section';
const GEAR_SECTIONS: readonly GearSection[] = ['home', 'equip', 'magic', 'bag'];

function loadGearSection(): GearSection {
  try {
    const v = localStorage.getItem(GEAR_SECTION_KEY) as GearSection | null;
    if (v && GEAR_SECTIONS.includes(v)) return v;
  } catch {
    /* storage blocked — fall back to the hub */
  }
  return 'home';
}
```

- [ ] **Step 2: Add the `gearSection` signal next to `subTab`**

After the `subTab` signal declaration (`creature-tab.component.ts:107`), add:

```typescript
  /** Which gear section is showing: the hub grid ('home') or a drilled-in
   *  panel. Seeded from and persisted to localStorage so the last-open
   *  section is restored when the player returns to the Gear tab. */
  protected readonly gearSection = signal<GearSection>(loadGearSection());
```

- [ ] **Step 3: Persist `gearSection` in the constructor**

Inside the existing `constructor()` (`creature-tab.component.ts:109-118`), add a second `effect` after the `subTab` one:

```typescript
    effect(() => {
      const section = this.gearSection();
      try {
        localStorage.setItem(GEAR_SECTION_KEY, section);
      } catch {
        /* storage full/blocked — stay session-only */
      }
    });
```

- [ ] **Step 4: Add the `selectGear()` setter**

Add a method (e.g. right after `selectStat()` at `creature-tab.component.ts:147-149`):

```typescript
  /** Open a gear section from the hub, or return to the hub with 'home'. */
  selectGear(section: GearSection): void {
    this.gearSection.set(section);
  }
```

- [ ] **Step 5: Add the three tile-summary computeds**

Add near the other gear computeds (after `stashRows` at `creature-tab.component.ts:187-191`). These reuse only existing signals/methods (`gearMods`, `innateSpells`, `equippedBook`, `bookSpells`, `cooldownLabel`) — no new game state:

```typescript
  /** How many of the three gear slots are filled — the Equipment tile count. */
  protected readonly wornCount = computed(() => {
    const gear = this.store.you()?.gear ?? {};
    return (['fang', 'carapace', 'charm'] as const).filter((s) => gear[s]).length;
  });

  /** Compact "ATK +2 · DEF +1" summary of equipped gear's stat bonuses, or ''
   *  when gear adds nothing — the Equipment tile pill. */
  protected readonly gearModLabel = computed(() => {
    const m = this.gearMods();
    const parts: string[] = [];
    if (m['atk']) parts.push(`ATK +${m['atk']}`);
    if (m['def']) parts.push(`DEF +${m['def']}`);
    if (m['spd']) parts.push(`SPD +${m['spd']}`);
    if (m['maxHp']) parts.push(`+${m['maxHp']} HP`);
    return parts.join(' · ');
  });

  /** Innate + open-book spells currently off cooldown — the Magic tile pill. */
  protected readonly spellsReadyCount = computed(() => {
    const you = this.store.you();
    if (!you) return 0;
    let n = this.innateSpells().filter((sp) => this.cooldownLabel(sp.id) === 'Ready').length;
    const book = this.equippedBook();
    if (book) n += this.bookSpells(book).filter((sp) => this.cooldownLabel(sp.id) === 'Ready').length;
    return n;
  });
```

- [ ] **Step 6: Build**

Run: `npm run build`
Expected: `Application bundle generation complete`, no errors. (The new `gearSection`/computeds aren't referenced by any template yet — this step confirms the TS compiles.)

- [ ] **Step 7: Commit**

```bash
git add src/app/undercity/tabs/creature-tab.component.ts
git commit -m "feat(undercity): gear-section state + tile-summary computeds"
```

---

### Task 2: Restructure the Gear case into a hub + sections (HTML)

**Files:**
- Modify: `src/app/undercity/tabs/creature-tab.component.html` (the `@case ('gear')` block, currently lines 204-445)

This task replaces the four stacked `<section class="card">` blocks inside `@case ('gear') { … }` with an `@switch (gearSection())`. The Equipment, Stash, Bag, and Grimoire card bodies are **moved verbatim** — do not rewrite their internals. `you` is already in scope from the outer `@if (store.you(); as you)` at line 2.

- [ ] **Step 1: Replace the entire `@case ('gear')` body**

Replace everything from `@case ('gear') {` (line 204) through its closing `}` (line 445) with the structure below. Where a comment says **MOVE**, paste the existing card markup from the noted current line range unchanged.

```html
          @case ('gear') {
            @switch (gearSection()) {
              @case ('home') {
                <!-- Gear hub: three live-status tiles; bottom-right cell left empty. -->
                <section class="gear-hub">
                  <button type="button" class="gear-tile" (click)="selectGear('equip')">
                    <span class="gear-tile-count">{{ wornCount() }}/3</span>
                    <span class="gear-tile-ico"><mat-icon class="mi" svgIcon="uc-carapace"></mat-icon></span>
                    <span class="gear-tile-title">Equipment</span>
                    <span class="gear-tile-status">{{ wornCount() }} worn · stash {{ stashRows().length }}/{{ stashCap }}</span>
                    @if (gearModLabel(); as m) {
                      <span class="gear-tile-pill">{{ m }}</span>
                    }
                  </button>

                  <button type="button" class="gear-tile magic" (click)="selectGear('magic')">
                    <span class="gear-tile-count">{{ (you.grimoires ?? []).length }} books</span>
                    <span class="gear-tile-ico"><mat-icon class="mi">menu_book</mat-icon></span>
                    <span class="gear-tile-title">Magic</span>
                    <span class="gear-tile-status">{{ equippedBook() ? equippedBook()!.name : 'No book open' }}</span>
                    <span class="gear-tile-pill">{{ spellsReadyCount() }} ready</span>
                  </button>

                  <button type="button" class="gear-tile" (click)="selectGear('bag')">
                    <span class="gear-tile-count">{{ you.bag.length }}/3</span>
                    <span class="gear-tile-ico"><mat-icon class="mi" svgIcon="uc-duffel"></mat-icon></span>
                    <span class="gear-tile-title">Bag</span>
                    <span class="gear-tile-status">{{ you.bag.length ? you.bag.length + ' carried' : 'Empty' }}</span>
                    @if (you.bag.length >= 3) {
                      <span class="gear-tile-pill">full</span>
                    }
                  </button>
                </section>
              }

              @case ('equip') {
                <button type="button" class="gear-back" (click)="selectGear('home')">
                  <mat-icon class="mi">chevron_left</mat-icon> Gear
                </button>
                <!-- MOVE: existing Equipment <section class="card">…</section> (current lines 206-275) verbatim here -->
                <!-- MOVE: existing Stash <section class="card">…</section> (current lines 279-300) verbatim here -->
              }

              @case ('magic') {
                <button type="button" class="gear-back" (click)="selectGear('home')">
                  <mat-icon class="mi">chevron_left</mat-icon> Gear
                </button>
                <!-- MOVE: existing Grimoire <section class="card">…</section> (current lines 338-444) verbatim here -->
              }

              @case ('bag') {
                <button type="button" class="gear-back" (click)="selectGear('home')">
                  <mat-icon class="mi">chevron_left</mat-icon> Gear
                </button>
                <!-- MOVE: existing Bag <section class="card">…</section> (current lines 303-335) verbatim here -->
              }
            }
          }
```

- [ ] **Step 2: Confirm each card was moved exactly once**

Check that the Equipment, Stash, Bag, and Grimoire `<section class="card">` blocks now each appear exactly once, inside the correct `@case`, and that no stray `<section>` remains directly under the old `@case ('gear')`. Equipment and Stash are both under `@case ('equip')`, in that order.

- [ ] **Step 3: Build**

Run: `npm run build`
Expected: `Application bundle generation complete`, no errors. A template error here usually means a moved card's closing tag was dropped or a binding lost `you` scope — recheck Step 1.

- [ ] **Step 4: Commit**

```bash
git add src/app/undercity/tabs/creature-tab.component.html
git commit -m "feat(undercity): gear hub grid + drill-in sections, stash under equipment"
```

---

### Task 3: Hub, tile, and back-button styles (SCSS)

**Files:**
- Modify: `src/app/undercity/tabs/creature-tab.component.scss`

- [ ] **Step 1: Append the gear-hub styles**

Add at the end of the file (values match the file's existing literal-hex Golgari palette — moss `#9ac26e`, magic `#a78bfa`, card gradient `#121810→#0d130b`):

```scss
// ── Gear landing hub ──────────────────────────────────────────────────────
.gear-hub {
  display: grid;
  grid-template-columns: 1fr 1fr;
  gap: 12px;
}

.gear-tile {
  position: relative;
  display: flex;
  flex-direction: column;
  min-height: 150px;
  padding: 15px 14px;
  text-align: left;
  color: #dfe7df;
  background: linear-gradient(165deg, #121810 0%, #0d130b 100%);
  border: 1px solid #22301d;
  border-radius: 16px;
  cursor: pointer;
  transition: border-color 0.16s, transform 0.09s;

  &:hover { border-color: #3a5030; transform: translateY(-2px); }
  &:active { transform: translateY(0); }
}

.gear-tile-ico {
  display: grid;
  place-items: center;
  width: 46px;
  height: 46px;
  margin-bottom: auto;
  color: #9ac26e;
  background: #0e160b;
  border: 1px solid #26331f;
  border-radius: 13px;

  .mi { font-size: 26px; width: 26px; height: 26px; }
}

.gear-tile-count {
  position: absolute;
  top: 15px;
  right: 15px;
  font-size: 11px;
  font-weight: 700;
  color: #8a9a8a;
  font-variant-numeric: tabular-nums;
}

.gear-tile-title { margin-top: 12px; font-size: 17px; font-weight: 700; }
.gear-tile-status { margin-top: 3px; font-size: 12px; line-height: 1.35; color: #8a9a8a; }

.gear-tile-pill {
  align-self: flex-start;
  margin-top: 9px;
  padding: 3px 9px;
  font-size: 10px;
  font-weight: 700;
  letter-spacing: 0.04em;
  color: #b7e4c7;
  background: rgba(107, 174, 117, 0.12);
  border: 1px solid #2a3f24;
  border-radius: 999px;
}

.gear-tile.magic {
  border-color: #2c2547;

  &:hover { border-color: #4a3d75; }
  .gear-tile-ico { color: #a78bfa; background: #150f26; border-color: #382c5c; }
  .gear-tile-pill { color: #c4b5fd; background: rgba(167, 139, 250, 0.1); border-color: #382c5c; }
}

.gear-back {
  display: inline-flex;
  align-items: center;
  gap: 4px;
  margin-bottom: 12px;
  padding: 7px 12px 7px 8px;
  font-size: 13px;
  font-weight: 600;
  color: #9ac26e;
  background: transparent;
  border: 1px solid #263223;
  border-radius: 10px;
  cursor: pointer;

  &:hover { background: #17200f; border-color: #33472b; }
  .mi { font-size: 18px; width: 18px; height: 18px; }
}
```

- [ ] **Step 2: Build**

Run: `npm run build`
Expected: `Application bundle generation complete`, no errors.

- [ ] **Step 3: Commit**

```bash
git add src/app/undercity/tabs/creature-tab.component.scss
git commit -m "style(undercity): gear hub tiles + back button"
```

---

### Task 4: Re-tap Gear sub-tab returns to the hub (TS + HTML)

**Files:**
- Modify: `src/app/undercity/tabs/creature-tab.component.ts`
- Modify: `src/app/undercity/tabs/creature-tab.component.html:558`

- [ ] **Step 1: Add the `selectGearTab()` method**

In `creature-tab.component.ts`, add near `selectGear()` (from Task 1):

```typescript
  /** Bottom-bar Gear button: entering the tab restores the remembered section;
   *  tapping it again while already on Gear pops back to the hub. */
  selectGearTab(): void {
    if (this.subTab() === 'gear') {
      this.gearSection.set('home');
    } else {
      this.subTab.set('gear');
    }
  }
```

- [ ] **Step 2: Point the Gear sub-tab button at it**

In `creature-tab.component.html`, change the Gear sub-tab button (line 558):

```html
        <button type="button" [class.active]="subTab() === 'gear'" (click)="selectGearTab()">
```

(Only the `(click)` handler changes, from `subTab.set('gear')` to `selectGearTab()`.)

- [ ] **Step 3: Build**

Run: `npm run build`
Expected: `Application bundle generation complete`, no errors.

- [ ] **Step 4: Commit**

```bash
git add src/app/undercity/tabs/creature-tab.component.ts src/app/undercity/tabs/creature-tab.component.html
git commit -m "feat(undercity): re-tap Gear sub-tab returns to hub"
```

---

### Task 5: End-to-end visual verification in the real app

**Files:** none (verification only)

- [ ] **Step 1: Launch and reach the Gear tab**

Use the **run-undercity** skill to start the dev server and drive a browser to a creature that has gear (a worn Fang/Carapace, at least one grimoire, a non-empty Bag). Open the Creature tab, then the **Gear** sub-tab.

- [ ] **Step 2: Verify the hub**

Confirm the hub shows a 2×2 grid with three tiles — **Equipment**, **Magic** (purple accent), **Bag** — and the bottom-right cell empty. Each tile shows its count (`x/3`, `n books`, `x/3`), a status line, and (where applicable) a pill (`ATK +2`, `n ready`, `full`). No emoji anywhere — icons are `mat-icon` glyphs.

- [ ] **Step 3: Verify drill-in / back / stash placement**

Tap **Equipment** → confirm the stat preview + worn slots render, **and the Stash card appears directly below them**. Tap `‹ Gear` → back to the hub. Repeat for **Magic** (grimoire + spells) and **Bag** (consumables). Confirm tapping an item still opens the item-detail popup (equip/use/market unchanged).

- [ ] **Step 4: Verify remembered section + re-tap**

Drill into **Magic**, switch to the **Stats** sub-tab, then back to **Gear** → it reopens **Magic** (remembered). While in a section, tap the bottom **Gear** sub-tab button again → returns to the hub.

- [ ] **Step 5: Final build gate**

Run: `npm run build`
Expected: `Application bundle generation complete`, no errors.

- [ ] **Step 6: Note for the user**

The feature is complete and builds clean. Deploying is the user's step (per project convention) — do not run `npm run deploy`.

---

## Self-review

- **Spec coverage:** hub + three tiles (Task 2), Stash under Equipment (Task 2), live-status tiles via reused signals (Task 1 computeds + Task 2 bindings), Magic purple accent (Task 3), remembered section (Task 1 persistence), re-tap-to-hub + explicit no-hardware-back decision (Task 4 / Non-goals), no-emoji `mat-icon` (Task 2), item interactions unchanged/verbatim (Task 2), build+visual verification (Verification + Task 5). All spec sections map to a task.
- **Placeholders:** none — every code step shows complete content; `MOVE` markers reference exact current line ranges of existing verbatim markup rather than re-pasting ~240 lines.
- **Type consistency:** `GearSection`, `gearSection`, `selectGear`, `selectGearTab`, `wornCount`, `gearModLabel`, `spellsReadyCount`, `GEAR_SECTION_KEY` are named identically across TS and HTML tasks; all reused methods (`gearMods`, `stashRows`, `stashCap`, `innateSpells`, `equippedBook`, `bookSpells`, `cooldownLabel`) match their definitions in the component.
