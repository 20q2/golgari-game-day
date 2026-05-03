# Genre Chip Icons Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add a small Material icon to each genre chip in the games-filter sheet/dialog and the top-of-page genre strip, sourced from the existing `GenreIconService`.

**Architecture:** Inject `GenreIconService` into both chip-rendering components, prepend `<mat-icon>` inside each per-genre chip, and tweak each component's SCSS to lay out icon + label + count on a single inline-flex row. No service changes; no new components.

**Tech Stack:** Angular 20 standalone components, Angular Material `mat-icon`, SCSS with the project's `--games-*` design tokens.

**Spec:** [plans/2026-05-03-genre-chip-icons-spec.md](./2026-05-03-genre-chip-icons-spec.md)

---

## File Structure

**Modified files (filter sheet, one commit):**
- `src/app/games/games-filter-sheet/games-filter-sheet.component.ts` — inject `GenreIconService`.
- `src/app/games/games-filter-sheet/games-filter-sheet.component.html` — chip body change.
- `src/app/games/games-filter-sheet/games-filter-sheet.component.scss` — `.genre-chip` flex layout + `.chip-icon` size.

**Modified files (genre strip, one commit):**
- `src/app/games/games-genre-strip/games-genre-strip.component.ts` — add `MatIconModule` import + inject `GenreIconService`.
- `src/app/games/games-genre-strip/games-genre-strip.component.html` — chip body change on the per-genre `*ngFor` only.
- `src/app/games/games-genre-strip/games-genre-strip.component.scss` — `.chip` flex layout + `.chip-icon` size.

---

### Task 1: Add icons to filter-sheet genre chips

**Files:**
- Modify: `src/app/games/games-filter-sheet/games-filter-sheet.component.ts`
- Modify: `src/app/games/games-filter-sheet/games-filter-sheet.component.html`
- Modify: `src/app/games/games-filter-sheet/games-filter-sheet.component.scss`

- [ ] **Step 1: Inject `GenreIconService` into the component**

In `src/app/games/games-filter-sheet/games-filter-sheet.component.ts`:

Add the service import below the existing imports (above the component's `interface` declarations):

```ts
import { GenreIconService } from '../../services/genre-icon.service';
```

In the constructor parameter list (currently has 4 `@Optional()` params), add a new public parameter ahead of them so the template can read the service. The constructor signature becomes:

```ts
  constructor(
    public iconService: GenreIconService,
    @Optional() private bottomSheetRef: MatBottomSheetRef<GamesFilterSheetComponent, FilterSheetResult>,
    @Optional() private dialogRef: MatDialogRef<GamesFilterSheetComponent, FilterSheetResult>,
    @Optional() @Inject(MAT_BOTTOM_SHEET_DATA) bottomSheetData: FilterSheetData,
    @Optional() @Inject(MAT_DIALOG_DATA) dialogData: FilterSheetData,
  ) {
```

Leave the constructor body unchanged.

- [ ] **Step 2: Update the chip markup**

In `src/app/games/games-filter-sheet/games-filter-sheet.component.html`, find the existing genre chip block (lines 45-53):

```html
      <button
        *ngFor="let g of genreCounts"
        type="button"
        class="genre-chip"
        [class.selected]="isSelected(g.genre)"
        (click)="toggleGenre(g.genre)"
      >
        {{ g.genre }} <span class="count">{{ g.count }}</span>
      </button>
```

Replace the **content** between the opening and closing `<button>` tags so the body becomes an icon + label + count. The full block should now read:

```html
      <button
        *ngFor="let g of genreCounts"
        type="button"
        class="genre-chip"
        [class.selected]="isSelected(g.genre)"
        (click)="toggleGenre(g.genre)"
      >
        <mat-icon class="chip-icon">{{ iconService.iconFor(g.genre) }}</mat-icon>
        <span class="chip-label">{{ g.genre }}</span>
        <span class="count">{{ g.count }}</span>
      </button>
```

- [ ] **Step 3: Update the chip styles**

In `src/app/games/games-filter-sheet/games-filter-sheet.component.scss`, find the existing `.genre-chip` rule (lines 68-97). Replace the rule's first three CSS declarations (`background`, `color`, `border`) with a flex-row layout that keeps those three properties intact, then add a new `.chip-icon` child rule. The full updated `.genre-chip` block:

```scss
.genre-chip {
  display: inline-flex;
  align-items: center;
  gap: 4px;
  background: var(--games-surface);
  color: var(--games-text-secondary);
  border: 1px solid var(--games-surface-border);
  border-radius: 999px;
  padding: 6px 12px;
  font-size: 12px;
  cursor: pointer;
  font-family: inherit;
  transition: background 0.2s ease, color 0.2s ease, border-color 0.2s ease;

  &:hover {
    color: var(--games-text-primary, #e0e8e2);
  }

  &.selected {
    background: var(--games-action);
    color: white;
    border-color: var(--games-action);
    font-weight: 600;
  }

  .chip-icon {
    font-size: 14px;
    width: 14px;
    height: 14px;
    line-height: 1;
  }

  .count {
    opacity: 0.6;
    margin-left: 2px;
    font-weight: 400;
  }

  &.selected .count { opacity: 0.85; }
}
```

The only meaningful additions are the first three properties (`display`, `align-items`, `gap`) and the new `.chip-icon` child rule. Everything else is unchanged.

- [ ] **Step 4: Verify the type-checker is clean**

```bash
npx tsc --noEmit -p tsconfig.app.json
```

Expected: clean exit. (Template type-checking is enabled via `strictTemplates: true`; a typo in `iconService.iconFor` would surface here.)

- [ ] **Step 5: Commit**

```bash
git add src/app/games/games-filter-sheet/games-filter-sheet.component.ts src/app/games/games-filter-sheet/games-filter-sheet.component.html src/app/games/games-filter-sheet/games-filter-sheet.component.scss
git commit -m "feat(games-filter-sheet): add icons to genre chips"
```

---

### Task 2: Add icons to top genre-strip chips

**Files:**
- Modify: `src/app/games/games-genre-strip/games-genre-strip.component.ts`
- Modify: `src/app/games/games-genre-strip/games-genre-strip.component.html`
- Modify: `src/app/games/games-genre-strip/games-genre-strip.component.scss`

- [ ] **Step 1: Add `MatIconModule` and inject `GenreIconService`**

Replace the entire contents of `src/app/games/games-genre-strip/games-genre-strip.component.ts` with:

```ts
import { Component, EventEmitter, Input, Output } from '@angular/core';
import { CommonModule } from '@angular/common';
import { MatIconModule } from '@angular/material/icon';
import { GameGenre } from '../../models/game.model';
import { GenreCount } from '../games.utils';
import { GenreIconService } from '../../services/genre-icon.service';

@Component({
  selector: 'app-games-genre-strip',
  standalone: true,
  imports: [CommonModule, MatIconModule],
  templateUrl: './games-genre-strip.component.html',
  styleUrls: ['./games-genre-strip.component.scss'],
})
export class GamesGenreStripComponent {
  /** Top genres (already sliced) shown in the surface row. */
  @Input() topGenres: GenreCount[] = [];
  /** Total games in the catalog (for the "All N" chip). */
  @Input() totalCount = 0;
  /** Number of additional genres available behind "+N more". 0 hides the chip. */
  @Input() remainingCount = 0;
  /** Currently selected genre on the surface row. null = "All". */
  @Input() selectedGenre: GameGenre | null = null;
  /** True when more than one genre is selected in the sheet — surface row shows a "Multiple" pill instead. */
  @Input() multipleSelected = false;

  /** Emit a single genre to scope to. null = clear (return to "All"). */
  @Output() selectGenre = new EventEmitter<GameGenre | null>();
  /** Open the filter sheet (used by the "+N more" chip). */
  @Output() openFilters = new EventEmitter<void>();

  constructor(public iconService: GenreIconService) {}

  onChipClick(genre: GameGenre | null): void {
    if (this.multipleSelected) {
      // Tapping a chip while sheet has multi-select replaces with single.
      this.selectGenre.emit(genre);
      return;
    }
    if (genre !== null && this.selectedGenre === genre) {
      // Toggle off — return to "All".
      this.selectGenre.emit(null);
      return;
    }
    this.selectGenre.emit(genre);
  }
}
```

The two new pieces vs. the prior file: `MatIconModule` is in the imports list, and the constructor injects `GenreIconService` as a public field.

- [ ] **Step 2: Update the per-genre chip markup**

In `src/app/games/games-genre-strip/games-genre-strip.component.html`, find the `*ngFor` chip block (lines 20-28):

```html
  <button
    *ngFor="let g of topGenres"
    type="button"
    class="chip"
    [class.active]="!multipleSelected && selectedGenre === g.genre"
    (click)="onChipClick(g.genre)"
  >
    {{ g.genre }} <span class="chip-count">{{ g.count }}</span>
  </button>
```

Replace the **content** between the opening and closing `<button>` tags so the body becomes icon + label + count. The full block:

```html
  <button
    *ngFor="let g of topGenres"
    type="button"
    class="chip"
    [class.active]="!multipleSelected && selectedGenre === g.genre"
    (click)="onChipClick(g.genre)"
  >
    <mat-icon class="chip-icon">{{ iconService.iconFor(g.genre) }}</mat-icon>
    <span class="chip-label">{{ g.genre }}</span>
    <span class="chip-count">{{ g.count }}</span>
  </button>
```

Do **not** touch the "All" button (lines 2-9), the "Multiple genres" button (lines 11-18), or the "+N more" button (lines 30-37). Those stay text-only because they're not genre-typed.

- [ ] **Step 3: Update the chip styles**

In `src/app/games/games-genre-strip/games-genre-strip.component.scss`, find the `.chip` rule (lines 24-75). Add three flex declarations at the top of the rule and a new `.chip-icon` child rule. The full updated `.chip` block:

```scss
.chip {
  display: inline-flex;
  align-items: center;
  gap: 4px;
  flex-shrink: 0;
  background: var(--games-surface);
  color: var(--games-text-secondary);
  border: 1px solid var(--games-surface-border);
  border-radius: 999px;
  padding: 6px 13px;
  font-size: 12px;
  font-weight: 500;
  cursor: pointer;
  transition: background 0.2s ease, color 0.2s ease, border-color 0.2s ease;
  white-space: nowrap;
  font-family: inherit;

  @media (min-width: 1024px) {
    font-size: 13px;
    padding: 7px 14px;
  }

  &:hover {
    background: var(--games-surface-hover);
    color: var(--games-text-primary);
  }

  &.active {
    background: var(--games-action);
    color: white;
    border-color: var(--games-action);
    font-weight: 600;
  }

  &.multi {
    background: var(--games-action-hover);
    color: white;
    border-color: var(--games-action-hover);
    font-weight: 600;
  }

  &.more {
    color: var(--games-text-muted);
  }

  .chip-icon {
    font-size: 14px;
    width: 14px;
    height: 14px;
    line-height: 1;
  }

  .chip-count {
    opacity: 0.6;
    margin-left: 2px;
    font-weight: 400;
  }

  &.active .chip-count {
    opacity: 0.85;
  }
}
```

Only two additions vs. the prior rule: the three new top-of-block flex properties and the `.chip-icon` child rule. The "All" / "Multiple" / "+N more" chips don't have a `<mat-icon>` child, so the rule is harmless on those buttons.

- [ ] **Step 4: Verify the type-checker is clean**

```bash
npx tsc --noEmit -p tsconfig.app.json
```

Expected: clean exit.

- [ ] **Step 5: Commit**

```bash
git add src/app/games/games-genre-strip/games-genre-strip.component.ts src/app/games/games-genre-strip/games-genre-strip.component.html src/app/games/games-genre-strip/games-genre-strip.component.scss
git commit -m "feat(games-genre-strip): add icons to genre chips"
```

---

### Task 3: Production build verification

**Files:**
- None (verification only).

- [ ] **Step 1: Run the production build**

```bash
npm run build:prod
```

Expected: completes without errors. Note: the previously-emitted `Warning: ... genre-icon.service.ts is part of the TypeScript compilation but it's unused` should now be **gone**, because the two components import it.

- [ ] **Step 2: No commit**

This task produces only the `docs/` build artifact, which is `.gitignore`d.

---

## Verification checklist (final)

Before marking the feature complete:

- [ ] `npx tsc --noEmit -p tsconfig.app.json` is clean.
- [ ] `npm run build:prod` succeeds and no longer warns about `genre-icon.service.ts` being unused.
- [ ] `git log --oneline -3` shows the two feature commits from Tasks 1–2 in order on top of the prior head.

## Manual verification (operator)

1. `npm start` → visit `/`. The dark games-browse surface renders.
2. Top genre strip: each per-genre chip shows a small Material icon to the left of the label (e.g. Thematic shows `auto_stories`, Strategy shows `psychology`). The "All", "Multiple genres", and "+N more" chips remain text-only.
3. Click a genre chip — both the icon and label flip to white on the green active background, no layout shift.
4. Open the filter sheet (mobile) or filter dialog (desktop). Every chip in the genres grid has the same icon prefix; selected chips show the icon in white on green.
