# Genre Chip Icons (App-Wide) Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add Material icon prefixes to genre chips in the two remaining surfaces — the game-details dialog and the games hero card — using `GenreIconService` as the single icon source.

**Architecture:** Identical pattern to the filter sheet and genre strip already shipped: inject `GenreIconService` into each component, render `<mat-icon>` before the genre label inside each chip's template, switch the chip element to `inline-flex` for alignment, and add a sized `chip-icon` / `pill-icon` rule. Icon size scales with chip text size — 14px for the dialog (12px text), 12px for the hero (10–11px text).

**Tech Stack:** Angular 20 standalone components, Angular Material `mat-icon`, SCSS using the `--games-*` design tokens.

**Spec:** [plans/2026-05-03-genre-chips-app-wide-spec.md](./2026-05-03-genre-chips-app-wide-spec.md)

---

## File Structure

**Game details dialog (Task 1, one commit):**
- `src/app/game-details-dialog/game-details-dialog.component.ts`
- `src/app/game-details-dialog/game-details-dialog.component.html`
- `src/app/game-details-dialog/game-details-dialog.component.scss`

**Games hero (Task 2, one commit):**
- `src/app/games/games-hero/games-hero.component.ts`
- `src/app/games/games-hero/games-hero.component.html`
- `src/app/games/games-hero/games-hero.component.scss`

---

### Task 1: Add icons to game-details-dialog genre chips

**Files:**
- Modify: `src/app/game-details-dialog/game-details-dialog.component.ts`
- Modify: `src/app/game-details-dialog/game-details-dialog.component.html`
- Modify: `src/app/game-details-dialog/game-details-dialog.component.scss`

- [ ] **Step 1: Inject `GenreIconService`**

In `src/app/game-details-dialog/game-details-dialog.component.ts`, add the service import below the existing relative imports:

```ts
import { GenreIconService } from '../services/genre-icon.service';
```

Then update the component's constructor to take `GenreIconService` as a public param. The current constructor signature is:

```ts
  constructor(
    @Inject(MAT_DIALOG_DATA) public game: Game,
    private dialogRef: MatDialogRef<GameDetailsDialogComponent>,
    private gamesService: GamesService,
    private userService: UserService,
  ) {}
```

(If the actual signature differs from the snippet above, leave the existing parameters intact and prepend the new one.) Update it to:

```ts
  constructor(
    public iconService: GenreIconService,
    @Inject(MAT_DIALOG_DATA) public game: Game,
    private dialogRef: MatDialogRef<GameDetailsDialogComponent>,
    private gamesService: GamesService,
    private userService: UserService,
  ) {}
```

The `iconService` field is `public` so the template can read it.

- [ ] **Step 2: Update the chip markup**

In `src/app/game-details-dialog/game-details-dialog.component.html`, find this block (lines 31-37):

```html
      @if (game.genres.length) {
        <div class="genre-chips">
          @for (genre of game.genres; track genre) {
            <span class="genre-chip">{{ genre }}</span>
          }
        </div>
      }
```

Replace it with:

```html
      @if (game.genres.length) {
        <div class="genre-chips">
          @for (genre of game.genres; track genre) {
            <span class="genre-chip">
              <mat-icon class="chip-icon">{{ iconService.iconFor(genre) }}</mat-icon>
              <span class="chip-label">{{ genre }}</span>
            </span>
          }
        </div>
      }
```

- [ ] **Step 3: Update the chip styles**

In `src/app/game-details-dialog/game-details-dialog.component.scss`, find the `.genre-chip` rule (lines 146-154):

```scss
.genre-chip {
  background: var(--games-surface);
  color: var(--games-text-secondary);
  border: 1px solid var(--games-surface-border);
  border-radius: 999px;
  padding: 4px 10px;
  font-size: 12px;
  font-weight: 500;
}
```

Replace it with:

```scss
.genre-chip {
  display: inline-flex;
  align-items: center;
  gap: 4px;
  background: var(--games-surface);
  color: var(--games-text-secondary);
  border: 1px solid var(--games-surface-border);
  border-radius: 999px;
  padding: 4px 10px;
  font-size: 12px;
  font-weight: 500;

  .chip-icon {
    font-size: 14px;
    width: 14px;
    height: 14px;
    line-height: 1;
  }
}
```

- [ ] **Step 4: Verify TypeScript and template type-check are clean**

```bash
npx tsc --noEmit -p tsconfig.app.json
```

Expected: clean exit.

- [ ] **Step 5: Commit**

```bash
git add src/app/game-details-dialog/game-details-dialog.component.ts src/app/game-details-dialog/game-details-dialog.component.html src/app/game-details-dialog/game-details-dialog.component.scss
git commit -m "feat(game-details-dialog): add icons to genre chips"
```

---

### Task 2: Add icons to games-hero genre pills

**Files:**
- Modify: `src/app/games/games-hero/games-hero.component.ts`
- Modify: `src/app/games/games-hero/games-hero.component.html`
- Modify: `src/app/games/games-hero/games-hero.component.scss`

- [ ] **Step 1: Add `MatIconModule`, inject `GenreIconService`, and tighten `genresShown` typing**

Replace the entire contents of `src/app/games/games-hero/games-hero.component.ts` with:

```ts
import { Component, EventEmitter, Input, Output } from '@angular/core';
import { CommonModule } from '@angular/common';
import { MatIconModule } from '@angular/material/icon';
import { Game, GameGenre } from '../../models/game.model';
import { HeroVariant } from '../games.utils';
import { GenreIconService } from '../../services/genre-icon.service';

@Component({
  selector: 'app-games-hero',
  standalone: true,
  imports: [CommonModule, MatIconModule],
  templateUrl: './games-hero.component.html',
  styleUrls: ['./games-hero.component.scss'],
})
export class GamesHeroComponent {
  @Input({ required: true }) game!: Game;
  @Input() variant: HeroVariant = 'top-rated';
  @Input() likeCount = 0;

  @Output() open = new EventEmitter<Game>();

  constructor(public iconService: GenreIconService) {}

  onClick(): void {
    this.open.emit(this.game);
  }

  onKey(event: KeyboardEvent): void {
    if (event.key === 'Enter' || event.key === ' ') {
      event.preventDefault();
      this.open.emit(this.game);
    }
  }

  get badgeText(): string {
    if (this.variant === 'most-loved') {
      return this.likeCount === 1 ? 'MOST LOVED · 1 LIKE' : `MOST LOVED · ${this.likeCount} LIKES`;
    }
    return 'TOP RATED';
  }

  get badgeIcon(): '♥' | '★' {
    return this.variant === 'most-loved' ? '♥' : '★';
  }

  get genresShown(): GameGenre[] {
    return this.game.genres.slice(0, 3);
  }

  get playerLabel(): string {
    const { minPlayers, maxPlayers } = this.game;
    return minPlayers === maxPlayers ? `${minPlayers} players` : `${minPlayers}–${maxPlayers} players`;
  }
}
```

Three meaningful changes vs. the prior file:
- `MatIconModule` added to imports.
- Constructor injects `GenreIconService` as a public field.
- `genresShown` return type is now `GameGenre[]` (was widened to `string[]` because `slice` doesn't preserve the narrow element type — fixing it lets `iconFor(g)` accept `g` directly without a cast).
- `GameGenre` added to the model import.

- [ ] **Step 2: Update the pill markup**

In `src/app/games/games-hero/games-hero.component.html`, find this block (lines 25-27):

```html
    <div class="genres">
      <span *ngFor="let g of genresShown" class="genre-pill">{{ g }}</span>
    </div>
```

Replace it with:

```html
    <div class="genres">
      <span *ngFor="let g of genresShown" class="genre-pill">
        <mat-icon class="pill-icon">{{ iconService.iconFor(g) }}</mat-icon>
        <span class="pill-label">{{ g }}</span>
      </span>
    </div>
```

- [ ] **Step 3: Update the pill styles**

In `src/app/games/games-hero/games-hero.component.scss`, find the `.genre-pill` rule (lines 149-159):

```scss
  .genre-pill {
    background: rgba(255, 255, 255, 0.2);
    padding: 2px 7px;
    border-radius: 4px;
    font-size: 10px;

    @media (min-width: 768px) {
      padding: 3px 8px;
      font-size: 11px;
    }
  }
```

Replace it with:

```scss
  .genre-pill {
    display: inline-flex;
    align-items: center;
    gap: 3px;
    background: rgba(255, 255, 255, 0.2);
    padding: 2px 7px;
    border-radius: 4px;
    font-size: 10px;

    @media (min-width: 768px) {
      padding: 3px 8px;
      font-size: 11px;
    }

    .pill-icon {
      font-size: 12px;
      width: 12px;
      height: 12px;
      line-height: 1;
    }
  }
```

The 12px icon is intentionally smaller than the dialog's 14px — the hero pills' text is 10–11px, and a 14px icon would dominate. 12px keeps the icon a complement to the label.

- [ ] **Step 4: Verify TypeScript and template type-check are clean**

```bash
npx tsc --noEmit -p tsconfig.app.json
```

Expected: clean exit.

- [ ] **Step 5: Commit**

```bash
git add src/app/games/games-hero/games-hero.component.ts src/app/games/games-hero/games-hero.component.html src/app/games/games-hero/games-hero.component.scss
git commit -m "feat(games-hero): add icons to genre pills"
```

---

### Task 3: Production build verification

**Files:**
- None (verification only).

- [ ] **Step 1: Run the production build**

```bash
npm run build:prod
```

Expected: completes without errors.

- [ ] **Step 2: No commit**

`docs/` build artifact is `.gitignore`d.

---

## Verification checklist (final)

- [ ] `npx tsc --noEmit -p tsconfig.app.json` is clean.
- [ ] `npm run build:prod` succeeds.
- [ ] `git log --oneline -3` shows the two feature commits from Tasks 1–2 in order on top of the prior head.

## Manual verification (operator)

1. `npm start` → visit `/`. The hero cards (most-loved / top-rated) show pills with a 12px icon next to each genre name.
2. Click any game tile/row → details dialog opens with `.genre-chip` items showing 14px icons matching the filter-sheet treatment.
3. The icon and label remain readable at the hero's smaller pill size (10–11px text); no layout shift on hover/click.
