# Games Page Redesign Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Replace the `/games` page with a Netflix-style discovery surface — sticky search/filter bar, single-select genre strip, "Most Loved" hero card, and a layout that flips between mobile list rows and desktop tile grid. Page adopts a contained dark Golgari theme.

**Architecture:** Existing `GamesComponent` becomes a thin orchestrator that hosts five new standalone presentational children (`GamesSearchBarComponent`, `GamesGenreStripComponent`, `GamesHeroComponent`, `GamesListComponent`, `GamesFilterSheetComponent`). Pure helpers in `games.utils.ts` handle hero selection, top-genre counting, and active-filter counting. The dark theme is gated by the existing `body.games-page` className hook so the rest of the site is unaffected.

**Tech Stack:** Angular 20 standalone components, Angular Material (`MatBottomSheet`, `MatDialog`, `MatIcon`, `MatFormField`, `MatSelect`, `MatInput`, `MatButton`), Angular CDK `BreakpointObserver`, RxJS observables (`combineLatest`, `map`), localStorage for filter persistence. No test runner is wired in this project (Karma was removed) — verification is `npm run build` + `npm run lint` + manual `npm start` browser checks.

**Spec:** [`specs/2026-05-02-games-page-redesign-design.md`](../specs/2026-05-02-games-page-redesign-design.md)

**Visual reference:** `.superpowers/brainstorm/31705-1777737356/content/design-mockup-v2.html`

---

## File Structure

**New:**
- `src/app/games/games.utils.ts` — pure helpers (`pickHero`, `topGenres`, `countActiveFilters`)
- `src/app/games/games-search-bar/games-search-bar.component.{ts,html,scss}` — sticky search + filter button
- `src/app/games/games-genre-strip/games-genre-strip.component.{ts,html,scss}` — horizontal chip row, single-select
- `src/app/games/games-hero/games-hero.component.{ts,html,scss}` — most-loved / top-rated hero card
- `src/app/games/games-list/games-list.component.{ts,html,scss}` — responsive rows-or-tiles list
- `src/app/games/games-filter-sheet/games-filter-sheet.component.{ts,html,scss}` — sort/duration/players/full-genre sheet content

**Modified:**
- `src/app/games/games.component.{ts,html,scss}` — full rewrite to host the new children
- `src/app/services/games.service.ts` — adds a small `getCatalog()` accessor for the unfiltered list (so the genre strip and `42 games` count can be derived once, independent of the active filter)
- `src/styles.scss` — adds `--games-*` tokens and dark gradient background scoped under `body.games-page`

**Untouched:** services (`GamesService`, `DataAggregationService`, `GenreIconService`), the `Game` model, `GameDetailsDialogComponent`, the home page, the navbar.

---

## Task 1: Theme tokens & dark gradient on /games

**Files:**
- Modify: `src/styles.scss` (around `body.games-page` block, line ~107)

- [ ] **Step 1: Replace the games-page body background and add dark theme tokens**

Find this block in `src/styles.scss`:

```scss
&.games-page {
  background: url('/golgari-game-day/images/image2.png') center/cover fixed;
}
```

Replace it with:

```scss
&.games-page {
  // Dark Golgari gradient — replaces the photo background to give the
  // games page a distinct identity (Netflix-style browse surface).
  background: linear-gradient(180deg, #0a1410 0%, #131c16 60%, #1a2a20 100%) fixed;

  // Page-scoped tokens. Used by the new games components and their children.
  --games-bg: linear-gradient(180deg, #0a1410 0%, #131c16 60%, #1a2a20 100%);
  --games-surface: rgba(255, 255, 255, 0.04);
  --games-surface-hover: rgba(255, 255, 255, 0.07);
  --games-surface-border: rgba(255, 255, 255, 0.06);
  --games-text-primary: #e0e8e2;
  --games-text-secondary: #8aa898;
  --games-text-muted: #6a8a7a;
  --games-accent: #4a8a6a;
  --games-action: #006442;
  --games-action-hover: #008055;
  --games-search-border: rgba(74, 138, 106, 0.4);
  --games-badge-bg: #ffd700;
  --games-badge-text: #000000;
  --games-heart: #ff6090;
  --games-star: #ffd700;

  // Override the default light-overlay ::before so the dark gradient
  // shows through cleanly.
  &::before {
    background: transparent;
  }
}
```

- [ ] **Step 2: Verify build**

Run: `npm run build`
Expected: Build succeeds with no SCSS errors.

- [ ] **Step 3: Visual smoke check**

Run: `npm start` (then open http://localhost:4200/golgari-game-day/games)
Expected: The existing games page now renders against a dark green gradient instead of the palace photo. The white Material cards still show (they'll be replaced in later tasks). Stop the dev server when done (Ctrl+C).

- [ ] **Step 4: Commit**

```bash
git add src/styles.scss
git commit -m "style(games): swap photo bg for dark Golgari gradient and add page-scoped theme tokens"
```

---

## Task 2: Pure helper utilities + unfiltered catalog accessor

**Files:**
- Create: `src/app/games/games.utils.ts`
- Modify: `src/app/services/games.service.ts` (add `getCatalog()` method)

- [ ] **Step 1: Add `getCatalog()` to GamesService**

Open `src/app/services/games.service.ts`. After the existing `getGames()` method (it ends at the line `return this.getFilteredAndSortedGames();` followed by `}`), add a new method. Also import `of` from rxjs if not already imported (the existing file does import `of` per line 3 — confirm before editing):

```ts
/**
 * Returns the unfiltered, unsorted catalog. Loads JSON on first call and
 * caches in-memory; subsequent calls emit synchronously from cache.
 *
 * Used by callers that need stable catalog-wide derivations (counts,
 * top-genre lists) that should not change when the active filter narrows
 * the list. Distinct from getGames(), which always reflects the live filter.
 */
getCatalog(): Observable<Game[]> {
  if (this.gamesLoaded) {
    return of([...this.games]);
  }
  return this.loadGamesFromJson().pipe(
    tap(() => {
      if (!this.awsDataLoaded) {
        this.loadAwsDataOnStartup();
      }
    }),
    map(() => [...this.games])
  );
}
```

`tap`, `map`, and `of` are already imported at the top of the file (line 4 imports the operators; line 3 imports `of`). No import changes needed.

- [ ] **Step 2: Create the utility file**

```ts
import { Game, GameFilter, GameGenre } from '../models/game.model';
import { GameStats } from '../services/data-aggregation.service';

export type HeroVariant = 'most-loved' | 'top-rated';

export interface HeroSelection {
  game: Game;
  variant: HeroVariant;
  likeCount: number;
}

export interface GenreCount {
  genre: GameGenre;
  count: number;
}

/**
 * Pick the hero game for the page header.
 * - If any game has at least one like, return the most-liked
 *   (ties broken by BGG rating desc, then title asc).
 * - Otherwise fall back to the highest BGG-rated game with the
 *   'top-rated' variant. Designed so the hero looks intentional
 *   even before any social activity has accumulated.
 */
export function pickHero(games: Game[], stats: GameStats[]): HeroSelection | null {
  if (games.length === 0) return null;

  const likesByGame = new Map<string, number>();
  for (const s of stats) {
    if (s.totalLikes > 0) likesByGame.set(s.gameId, s.totalLikes);
  }

  if (likesByGame.size > 0) {
    const ranked = games
      .map(g => ({ game: g, likes: likesByGame.get(g.id) ?? 0 }))
      .filter(x => x.likes > 0)
      .sort((a, b) =>
        b.likes - a.likes ||
        (b.game.bggRating ?? 0) - (a.game.bggRating ?? 0) ||
        a.game.title.localeCompare(b.game.title)
      );
    if (ranked.length > 0) {
      return { game: ranked[0].game, variant: 'most-loved', likeCount: ranked[0].likes };
    }
  }

  const sorted = [...games].sort((a, b) =>
    (b.bggRating ?? 0) - (a.bggRating ?? 0) ||
    a.title.localeCompare(b.title)
  );
  return { game: sorted[0], variant: 'top-rated', likeCount: 0 };
}

/**
 * Count how many distinct games carry each genre across the catalog,
 * return the top N sorted by count desc (ties broken alphabetically).
 */
export function topGenres(games: Game[], n: number): GenreCount[] {
  const counts = new Map<GameGenre, number>();
  for (const game of games) {
    for (const genre of game.genres) {
      counts.set(genre, (counts.get(genre) ?? 0) + 1);
    }
  }
  return Array.from(counts.entries())
    .map(([genre, count]) => ({ genre, count }))
    .sort((a, b) => b.count - a.count || a.genre.localeCompare(b.genre))
    .slice(0, n);
}

/**
 * Count active hidden filters for the gear-button badge.
 * Search text is excluded — the search input is itself visible in the
 * sticky bar, so the badge only signals filters hidden inside the sheet.
 */
export function countActiveFilters(filter: GameFilter): number {
  let n = 0;
  if (filter.genres && filter.genres.length > 0) n += 1;
  if (filter.duration) n += 1;
  if (filter.supportedPlayers != null) n += 1;
  return n;
}
```

- [ ] **Step 3: Verify build**

Run: `npm run build`
Expected: Build succeeds. Nothing imports the helpers or `getCatalog()` yet, but everything should compile cleanly.

- [ ] **Step 4: Commit**

```bash
git add src/app/games/games.utils.ts src/app/services/games.service.ts
git commit -m "feat(games): add helpers and unfiltered getCatalog() for hero/genre derivation"
```

---

## Task 3: GamesSearchBarComponent

**Files:**
- Create: `src/app/games/games-search-bar/games-search-bar.component.ts`
- Create: `src/app/games/games-search-bar/games-search-bar.component.html`
- Create: `src/app/games/games-search-bar/games-search-bar.component.scss`

- [ ] **Step 1: Create the component class**

`src/app/games/games-search-bar/games-search-bar.component.ts`:

```ts
import { Component, EventEmitter, Input, Output } from '@angular/core';
import { CommonModule } from '@angular/common';
import { FormsModule } from '@angular/forms';
import { MatIconModule } from '@angular/material/icon';

@Component({
  selector: 'app-games-search-bar',
  standalone: true,
  imports: [CommonModule, FormsModule, MatIconModule],
  templateUrl: './games-search-bar.component.html',
  styleUrls: ['./games-search-bar.component.scss'],
})
export class GamesSearchBarComponent {
  @Input() searchText = '';
  @Input() activeFilterCount = 0;

  @Output() searchTextChange = new EventEmitter<string>();
  @Output() openFilters = new EventEmitter<void>();

  onInput(value: string): void {
    this.searchText = value;
    this.searchTextChange.emit(value);
  }

  onClear(): void {
    if (!this.searchText) return;
    this.searchText = '';
    this.searchTextChange.emit('');
  }
}
```

- [ ] **Step 2: Create the template**

`src/app/games/games-search-bar/games-search-bar.component.html`:

```html
<div class="games-search-bar">
  <label class="search-input">
    <mat-icon class="search-icon" aria-hidden="true">search</mat-icon>
    <input
      type="text"
      [value]="searchText"
      (input)="onInput($any($event.target).value)"
      placeholder="Search games…"
      aria-label="Search games"
    />
    <button
      *ngIf="searchText"
      type="button"
      class="clear-btn"
      (click)="onClear()"
      aria-label="Clear search"
    >
      <mat-icon>close</mat-icon>
    </button>
  </label>

  <button type="button" class="filter-btn" (click)="openFilters.emit()" aria-label="Open filters">
    <mat-icon>tune</mat-icon>
    <span class="filter-label">Filter</span>
    <span class="filter-badge" *ngIf="activeFilterCount > 0">{{ activeFilterCount }}</span>
  </button>
</div>
```

- [ ] **Step 3: Create the styles**

`src/app/games/games-search-bar/games-search-bar.component.scss`:

```scss
:host {
  display: block;
  position: sticky;
  top: 0;
  z-index: 10;
  padding: 12px 0 8px;
  background: rgba(10, 20, 16, 0.85);
  backdrop-filter: blur(10px);
  -webkit-backdrop-filter: blur(10px);
}

.games-search-bar {
  display: flex;
  gap: 10px;
  align-items: stretch;
}

.search-input {
  flex: 1;
  display: flex;
  align-items: center;
  gap: 10px;
  background: var(--games-surface);
  border: 1px solid var(--games-search-border);
  border-radius: 12px;
  padding: 10px 14px;
  transition: border-color 0.2s ease;

  &:focus-within {
    border-color: var(--games-action-hover);
  }

  .search-icon {
    color: var(--games-accent);
    font-size: 20px;
    width: 20px;
    height: 20px;
  }

  input {
    flex: 1;
    background: transparent;
    border: none;
    outline: none;
    color: var(--games-text-primary);
    font-size: 14px;
    font-family: inherit;

    &::placeholder {
      color: var(--games-text-muted);
    }
  }

  .clear-btn {
    background: transparent;
    border: none;
    color: var(--games-text-muted);
    cursor: pointer;
    padding: 0;
    display: flex;
    align-items: center;

    mat-icon {
      font-size: 18px;
      width: 18px;
      height: 18px;
    }

    &:hover {
      color: var(--games-text-primary);
    }
  }
}

.filter-btn {
  display: flex;
  align-items: center;
  gap: 6px;
  background: var(--games-action);
  color: white;
  border: none;
  border-radius: 12px;
  padding: 0 16px;
  font-size: 13px;
  font-weight: 600;
  cursor: pointer;
  transition: background 0.2s ease;

  &:hover {
    background: var(--games-action-hover);
  }

  mat-icon {
    font-size: 18px;
    width: 18px;
    height: 18px;
  }

  .filter-label {
    @media (max-width: 480px) {
      display: none;
    }
  }

  .filter-badge {
    background: var(--games-badge-bg);
    color: var(--games-badge-text);
    border-radius: 999px;
    padding: 1px 7px;
    font-size: 11px;
    font-weight: 700;
    line-height: 1.4;
  }
}
```

- [ ] **Step 4: Verify build & lint**

Run: `npm run build && npm run lint`
Expected: Both succeed. The component compiles even though it isn't wired into a parent yet.

- [ ] **Step 5: Commit**

```bash
git add src/app/games/games-search-bar/
git commit -m "feat(games): add sticky GamesSearchBarComponent with filter button + badge"
```

---

## Task 4: GamesGenreStripComponent

**Files:**
- Create: `src/app/games/games-genre-strip/games-genre-strip.component.ts`
- Create: `src/app/games/games-genre-strip/games-genre-strip.component.html`
- Create: `src/app/games/games-genre-strip/games-genre-strip.component.scss`

- [ ] **Step 1: Create the component class**

`src/app/games/games-genre-strip/games-genre-strip.component.ts`:

```ts
import { Component, EventEmitter, Input, Output } from '@angular/core';
import { CommonModule } from '@angular/common';
import { GameGenre } from '../../models/game.model';
import { GenreCount } from '../games.utils';

@Component({
  selector: 'app-games-genre-strip',
  standalone: true,
  imports: [CommonModule],
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

- [ ] **Step 2: Create the template**

`src/app/games/games-genre-strip/games-genre-strip.component.html`:

```html
<div class="genre-strip" role="toolbar" aria-label="Genre filter">
  <button
    type="button"
    class="chip"
    [class.active]="selectedGenre === null && !multipleSelected"
    (click)="onChipClick(null)"
  >
    All <span class="chip-count">{{ totalCount }}</span>
  </button>

  <button
    *ngIf="multipleSelected"
    type="button"
    class="chip multi"
    (click)="openFilters.emit()"
  >
    Multiple genres
  </button>

  <button
    *ngFor="let g of topGenres"
    type="button"
    class="chip"
    [class.active]="!multipleSelected && selectedGenre === g.genre"
    (click)="onChipClick(g.genre)"
  >
    {{ g.genre }} <span class="chip-count">{{ g.count }}</span>
  </button>

  <button
    *ngIf="remainingCount > 0"
    type="button"
    class="chip more"
    (click)="openFilters.emit()"
  >
    +{{ remainingCount }} more
  </button>
</div>
```

- [ ] **Step 3: Create the styles**

`src/app/games/games-genre-strip/games-genre-strip.component.scss`:

```scss
:host {
  display: block;
  margin-bottom: 14px;
}

.genre-strip {
  display: flex;
  gap: 6px;
  overflow-x: auto;
  scrollbar-width: none;
  -ms-overflow-style: none;
  padding-bottom: 2px;

  &::-webkit-scrollbar {
    display: none;
  }

  @media (min-width: 1024px) {
    flex-wrap: wrap;
    overflow-x: visible;
  }
}

.chip {
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

- [ ] **Step 4: Verify build & lint**

Run: `npm run build && npm run lint`
Expected: Both succeed.

- [ ] **Step 5: Commit**

```bash
git add src/app/games/games-genre-strip/
git commit -m "feat(games): add GamesGenreStripComponent with single-select + counts"
```

---

## Task 5: GamesHeroComponent

**Files:**
- Create: `src/app/games/games-hero/games-hero.component.ts`
- Create: `src/app/games/games-hero/games-hero.component.html`
- Create: `src/app/games/games-hero/games-hero.component.scss`

- [ ] **Step 1: Create the component class**

`src/app/games/games-hero/games-hero.component.ts`:

```ts
import { Component, EventEmitter, Input, Output } from '@angular/core';
import { CommonModule } from '@angular/common';
import { Game } from '../../models/game.model';
import { HeroVariant } from '../games.utils';

@Component({
  selector: 'app-games-hero',
  standalone: true,
  imports: [CommonModule],
  templateUrl: './games-hero.component.html',
  styleUrls: ['./games-hero.component.scss'],
})
export class GamesHeroComponent {
  @Input({ required: true }) game!: Game;
  @Input() variant: HeroVariant = 'top-rated';
  @Input() likeCount = 0;

  @Output() open = new EventEmitter<Game>();

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

  get genresShown(): string[] {
    return this.game.genres.slice(0, 3);
  }

  get playerLabel(): string {
    const { minPlayers, maxPlayers } = this.game;
    return minPlayers === maxPlayers ? `${minPlayers} players` : `${minPlayers}–${maxPlayers} players`;
  }
}
```

- [ ] **Step 2: Create the template**

`src/app/games/games-hero/games-hero.component.html`:

```html
<button
  type="button"
  class="hero"
  [class.most-loved]="variant === 'most-loved'"
  [class.top-rated]="variant === 'top-rated'"
  (click)="onClick()"
  (keydown)="onKey($event)"
  [attr.aria-label]="'Open ' + game.title + ' details'"
>
  <img *ngIf="game.imageUrl" [src]="game.imageUrl" [alt]="game.title" loading="lazy" />
  <div class="overlay"></div>

  <div class="badge">
    <span class="badge-icon" [class.heart]="variant === 'most-loved'" [class.star]="variant === 'top-rated'">{{ badgeIcon }}</span>
    {{ badgeText }}
  </div>

  <div class="meta">
    <h2 class="title">{{ game.title }}</h2>
    <div class="stats">
      <span *ngIf="game.bggRating">★ {{ game.bggRating }}</span>
      <span>{{ playerLabel }}</span>
      <span>{{ game.playTime }}</span>
    </div>
    <div class="genres">
      <span *ngFor="let g of genresShown" class="genre-pill">{{ g }}</span>
    </div>
  </div>
</button>
```

- [ ] **Step 3: Create the styles**

`src/app/games/games-hero/games-hero.component.scss`:

```scss
:host {
  display: block;
  margin-bottom: 16px;

  @media (min-width: 1024px) {
    margin-bottom: 22px;
  }
}

.hero {
  position: relative;
  display: block;
  width: 100%;
  border: none;
  padding: 0;
  cursor: pointer;
  border-radius: 12px;
  overflow: hidden;
  aspect-ratio: 16 / 10;
  background: var(--games-surface);
  box-shadow: 0 8px 24px rgba(0, 0, 0, 0.4);
  transition: transform 0.2s ease, box-shadow 0.2s ease;

  @media (min-width: 768px) {
    aspect-ratio: 21 / 9;
    border-radius: 14px;
  }

  &:hover {
    transform: translateY(-2px);
    box-shadow: 0 12px 40px rgba(0, 0, 0, 0.5);
  }

  &:focus-visible {
    outline: 2px solid var(--games-action-hover);
    outline-offset: 2px;
  }

  img {
    position: absolute;
    inset: 0;
    width: 100%;
    height: 100%;
    object-fit: cover;
    object-position: center 30%;
  }
}

.overlay {
  position: absolute;
  inset: 0;
  background: linear-gradient(
    180deg,
    rgba(0, 0, 0, 0.1) 0%,
    rgba(0, 0, 0, 0.85) 100%
  );

  @media (min-width: 768px) {
    background: linear-gradient(
      90deg,
      rgba(0, 0, 0, 0.85) 0%,
      rgba(0, 0, 0, 0.5) 50%,
      rgba(0, 0, 0, 0.2) 100%
    );
  }
}

.badge {
  position: absolute;
  top: 10px;
  left: 10px;
  background: linear-gradient(135deg, var(--games-action), var(--games-action-hover));
  color: white;
  padding: 4px 9px;
  border-radius: 999px;
  font-size: 10px;
  font-weight: 700;
  letter-spacing: 0.5px;
  display: flex;
  align-items: center;
  gap: 5px;

  @media (min-width: 768px) {
    top: 14px;
    left: 14px;
    font-size: 11px;
    padding: 5px 11px;
  }

  .badge-icon {
    &.heart { color: var(--games-heart); }
    &.star  { color: var(--games-star); }
  }
}

.meta {
  position: absolute;
  bottom: 12px;
  left: 12px;
  right: 12px;
  text-align: left;
  color: white;

  @media (min-width: 768px) {
    bottom: 18px;
    left: 18px;
    right: auto;
    max-width: 50%;
  }

  .title {
    font-size: 22px;
    font-weight: 700;
    letter-spacing: -0.3px;
    line-height: 1;
    margin: 0;

    @media (min-width: 768px) {
      font-size: 32px;
      letter-spacing: -0.5px;
    }
  }

  .stats {
    display: flex;
    gap: 10px;
    font-size: 12px;
    opacity: 0.95;
    margin-top: 4px;

    @media (min-width: 768px) {
      gap: 14px;
      font-size: 13px;
      margin-top: 6px;
    }
  }

  .genres {
    display: flex;
    gap: 6px;
    margin-top: 6px;
    flex-wrap: wrap;

    @media (min-width: 768px) {
      margin-top: 8px;
    }
  }

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
}
```

- [ ] **Step 4: Verify build & lint**

Run: `npm run build && npm run lint`
Expected: Both succeed.

- [ ] **Step 5: Commit**

```bash
git add src/app/games/games-hero/
git commit -m "feat(games): add GamesHeroComponent with most-loved/top-rated variants"
```

---

## Task 6: GamesListComponent

**Files:**
- Create: `src/app/games/games-list/games-list.component.ts`
- Create: `src/app/games/games-list/games-list.component.html`
- Create: `src/app/games/games-list/games-list.component.scss`

- [ ] **Step 1: Create the component class**

`src/app/games/games-list/games-list.component.ts`:

```ts
import { Component, EventEmitter, Input, Output } from '@angular/core';
import { CommonModule } from '@angular/common';
import { Game } from '../../models/game.model';
import { GameStats } from '../../services/data-aggregation.service';

@Component({
  selector: 'app-games-list',
  standalone: true,
  imports: [CommonModule],
  templateUrl: './games-list.component.html',
  styleUrls: ['./games-list.component.scss'],
})
export class GamesListComponent {
  @Input() games: Game[] = [];
  /** gameId → stats. Missing entries treated as zero-likes/zero-comments. */
  @Input() statsById: Record<string, GameStats> = {};

  @Output() open = new EventEmitter<Game>();

  trackById(_index: number, g: Game): string {
    return g.id;
  }

  playerLabel(g: Game): string {
    return g.minPlayers === g.maxPlayers ? `${g.minPlayers}` : `${g.minPlayers}–${g.maxPlayers}`;
  }

  topGenres(g: Game): string {
    return g.genres.slice(0, 2).join(' · ');
  }

  likes(g: Game): number {
    return this.statsById[g.id]?.totalLikes ?? 0;
  }

  comments(g: Game): number {
    return this.statsById[g.id]?.totalComments ?? 0;
  }
}
```

- [ ] **Step 2: Create the template**

`src/app/games/games-list/games-list.component.html`:

```html
<ul class="games-list" role="list">
  <li
    *ngFor="let g of games; trackBy: trackById"
    class="games-list-item"
    (click)="open.emit(g)"
    (keydown.enter)="open.emit(g)"
    (keydown.space)="$event.preventDefault(); open.emit(g)"
    tabindex="0"
    role="button"
    [attr.aria-label]="'Open ' + g.title + ' details'"
  >
    <img
      *ngIf="g.imageUrl"
      class="thumb"
      [src]="g.imageUrl"
      [alt]="g.title"
      loading="lazy"
    />

    <div class="primary">
      <div class="title">{{ g.title }}</div>
      <div class="genres">{{ topGenres(g) }}</div>
      <div class="meta">{{ playerLabel(g) }} · {{ g.playTime }}</div>
    </div>

    <div class="trailing">
      <div class="rating" *ngIf="g.bggRating">★ {{ g.bggRating }}</div>
      <div class="social" *ngIf="likes(g) || comments(g)">
        <span *ngIf="likes(g)" class="social-item heart">♥ {{ likes(g) }}</span>
        <span *ngIf="comments(g)" class="social-item">💬 {{ comments(g) }}</span>
      </div>
    </div>
  </li>
</ul>
```

- [ ] **Step 3: Create the styles**

`src/app/games/games-list/games-list.component.scss`:

```scss
:host {
  display: block;
}

.games-list {
  list-style: none;
  padding: 0;
  margin: 0;

  // Mobile: vertical list of rows
  display: flex;
  flex-direction: column;
  gap: 8px;

  // Tablet: 3-col tile grid
  @media (min-width: 768px) {
    display: grid;
    grid-template-columns: repeat(3, 1fr);
    gap: 12px;
  }

  // Desktop: 5-col tile grid
  @media (min-width: 1024px) {
    grid-template-columns: repeat(5, 1fr);
  }
}

.games-list-item {
  cursor: pointer;
  transition: background 0.2s ease, transform 0.2s ease;
  background: var(--games-surface);
  border: 1px solid var(--games-surface-border);
  border-radius: 10px;

  &:hover {
    background: var(--games-surface-hover);
  }

  &:focus-visible {
    outline: 2px solid var(--games-action-hover);
    outline-offset: 2px;
  }

  // Mobile row layout
  display: flex;
  gap: 12px;
  align-items: center;
  padding: 10px;

  .thumb {
    width: 56px;
    height: 72px;
    border-radius: 6px;
    object-fit: cover;
    flex-shrink: 0;
  }

  .primary {
    flex: 1;
    min-width: 0;

    .title {
      color: var(--games-text-primary);
      font-weight: 600;
      font-size: 14px;
      line-height: 1.2;
      overflow: hidden;
      text-overflow: ellipsis;
      white-space: nowrap;
    }

    .genres {
      color: var(--games-text-secondary);
      font-size: 11px;
      margin-top: 2px;
      overflow: hidden;
      text-overflow: ellipsis;
      white-space: nowrap;
    }

    .meta {
      color: var(--games-text-muted);
      font-size: 11px;
      margin-top: 3px;
    }
  }

  .trailing {
    text-align: right;
    flex-shrink: 0;

    .rating {
      color: var(--games-star);
      font-size: 13px;
      font-weight: 700;
    }

    .social {
      color: var(--games-text-muted);
      font-size: 10px;
      margin-top: 4px;
      display: flex;
      gap: 6px;
      justify-content: flex-end;
    }

    .social-item.heart {
      color: var(--games-heart);
    }
  }

  // Tablet+: switch to overlay-on-image tile
  @media (min-width: 768px) {
    display: block;
    position: relative;
    aspect-ratio: 3 / 4;
    padding: 0;
    overflow: hidden;
    border-radius: 8px;

    .thumb {
      width: 100%;
      height: 100%;
      border-radius: 0;
    }

    // Hide the row text blocks, replace with overlay-only content
    .primary {
      position: absolute;
      inset: 0;
      display: flex;
      flex-direction: column;
      justify-content: flex-end;
      padding: 8px;
      color: white;
      background: linear-gradient(180deg, transparent 55%, rgba(0, 0, 0, 0.9) 100%);

      .title {
        color: white;
        font-size: 12px;
        font-weight: 700;
      }

      .genres {
        display: none;
      }

      .meta {
        display: none;
      }
    }

    .trailing {
      position: absolute;
      bottom: 8px;
      right: 8px;
      text-align: right;

      .rating {
        font-size: 10px;
        background: rgba(0, 0, 0, 0.6);
        padding: 1px 6px;
        border-radius: 999px;
      }

      .social {
        display: none;
      }
    }
  }
}
```

Note: on tile layout, the title is in `.primary` and the rating sits in `.trailing` overlaid bottom-right. The mobile-row genres/meta and social numbers are hidden — they belong to the row layout only.

- [ ] **Step 4: Verify build & lint**

Run: `npm run build && npm run lint`
Expected: Both succeed.

- [ ] **Step 5: Commit**

```bash
git add src/app/games/games-list/
git commit -m "feat(games): add GamesListComponent with mobile-row / desktop-tile responsive layout"
```

---

## Task 7: GamesFilterSheetComponent

**Files:**
- Create: `src/app/games/games-filter-sheet/games-filter-sheet.component.ts`
- Create: `src/app/games/games-filter-sheet/games-filter-sheet.component.html`
- Create: `src/app/games/games-filter-sheet/games-filter-sheet.component.scss`

This component is host-agnostic: it can be opened by either `MatBottomSheet` (mobile) or `MatDialog` (desktop). The orchestrator decides which based on viewport.

- [ ] **Step 1: Create the component class**

`src/app/games/games-filter-sheet/games-filter-sheet.component.ts`:

```ts
import { Component, Inject, Optional } from '@angular/core';
import { CommonModule } from '@angular/common';
import { FormsModule } from '@angular/forms';
import { MatFormFieldModule } from '@angular/material/form-field';
import { MatSelectModule } from '@angular/material/select';
import { MatInputModule } from '@angular/material/input';
import { MatIconModule } from '@angular/material/icon';
import {
  MatBottomSheetRef,
  MAT_BOTTOM_SHEET_DATA,
} from '@angular/material/bottom-sheet';
import { MatDialogRef, MAT_DIALOG_DATA } from '@angular/material/dialog';
import {
  GameDuration,
  GameFilter,
  GameGenre,
  SortOrder,
} from '../../models/game.model';
import { GenreCount, topGenres } from '../games.utils';

export interface FilterSheetData {
  filter: GameFilter;
  sort: SortOrder;
  genreCounts: GenreCount[]; // all genres, with counts
}

export interface FilterSheetResult {
  filter: GameFilter;
  sort: SortOrder;
}

@Component({
  selector: 'app-games-filter-sheet',
  standalone: true,
  imports: [
    CommonModule,
    FormsModule,
    MatFormFieldModule,
    MatSelectModule,
    MatInputModule,
    MatIconModule,
  ],
  templateUrl: './games-filter-sheet.component.html',
  styleUrls: ['./games-filter-sheet.component.scss'],
})
export class GamesFilterSheetComponent {
  filter: GameFilter;
  sort: SortOrder;
  genreCounts: GenreCount[];

  durations = Object.values(GameDuration);
  sortOptions = [
    { value: SortOrder.TITLE_ASC, label: 'Title A–Z' },
    { value: SortOrder.TITLE_DESC, label: 'Title Z–A' },
    { value: SortOrder.RATING_DESC, label: 'Rating high → low' },
    { value: SortOrder.RATING_ASC, label: 'Rating low → high' },
    { value: SortOrder.PLAYERS_ASC, label: 'Players low → high' },
    { value: SortOrder.PLAYERS_DESC, label: 'Players high → low' },
  ];

  constructor(
    @Optional() private bottomSheetRef: MatBottomSheetRef<GamesFilterSheetComponent, FilterSheetResult>,
    @Optional() private dialogRef: MatDialogRef<GamesFilterSheetComponent, FilterSheetResult>,
    @Optional() @Inject(MAT_BOTTOM_SHEET_DATA) bottomSheetData: FilterSheetData,
    @Optional() @Inject(MAT_DIALOG_DATA) dialogData: FilterSheetData,
  ) {
    const data = bottomSheetData ?? dialogData;
    // Clone arrays so the sheet can mutate freely without leaking back via reference.
    this.filter = {
      genres: data.filter.genres ? [...data.filter.genres] : undefined,
      duration: data.filter.duration,
      supportedPlayers: data.filter.supportedPlayers,
      searchText: data.filter.searchText,
    };
    this.sort = data.sort;
    this.genreCounts = data.genreCounts;
  }

  toggleGenre(genre: GameGenre): void {
    const current = this.filter.genres ?? [];
    const i = current.indexOf(genre);
    if (i >= 0) {
      const next = [...current];
      next.splice(i, 1);
      this.filter.genres = next.length ? next : undefined;
    } else {
      this.filter.genres = [...current, genre];
    }
  }

  isSelected(genre: GameGenre): boolean {
    return !!this.filter.genres && this.filter.genres.includes(genre);
  }

  clearAll(): void {
    this.filter = { searchText: this.filter.searchText };
    this.sort = SortOrder.TITLE_ASC;
  }

  done(): void {
    const result: FilterSheetResult = { filter: this.filter, sort: this.sort };
    this.bottomSheetRef?.dismiss(result);
    this.dialogRef?.close(result);
  }

  cancel(): void {
    this.bottomSheetRef?.dismiss();
    this.dialogRef?.close();
  }
}
```

- [ ] **Step 2: Create the template**

`src/app/games/games-filter-sheet/games-filter-sheet.component.html`:

```html
<div class="sheet">
  <header class="sheet-header">
    <h3>Filters</h3>
    <button type="button" class="close" (click)="cancel()" aria-label="Close filters">
      <mat-icon>close</mat-icon>
    </button>
  </header>

  <section class="row">
    <label class="row-label">Sort</label>
    <mat-form-field appearance="outline" class="full">
      <mat-select [(ngModel)]="sort">
        <mat-option *ngFor="let o of sortOptions" [value]="o.value">{{ o.label }}</mat-option>
      </mat-select>
    </mat-form-field>
  </section>

  <section class="row">
    <label class="row-label">Duration</label>
    <mat-form-field appearance="outline" class="full">
      <mat-select [(ngModel)]="filter.duration" placeholder="Any">
        <mat-option [value]="undefined">Any</mat-option>
        <mat-option *ngFor="let d of durations" [value]="d">{{ d }}</mat-option>
      </mat-select>
    </mat-form-field>
  </section>

  <section class="row">
    <label class="row-label">Players</label>
    <mat-form-field appearance="outline" class="full">
      <input
        matInput
        type="number"
        min="1"
        max="12"
        [(ngModel)]="filter.supportedPlayers"
        placeholder="Any"
      />
    </mat-form-field>
  </section>

  <section class="row">
    <label class="row-label">Genres</label>
    <div class="genre-grid">
      <button
        *ngFor="let g of genreCounts"
        type="button"
        class="genre-chip"
        [class.selected]="isSelected(g.genre)"
        (click)="toggleGenre(g.genre)"
      >
        {{ g.genre }} <span class="count">{{ g.count }}</span>
      </button>
    </div>
  </section>

  <footer class="sheet-footer">
    <button type="button" class="secondary" (click)="clearAll()">Clear all</button>
    <button type="button" class="primary" (click)="done()">Done</button>
  </footer>
</div>
```

- [ ] **Step 3: Create the styles**

`src/app/games/games-filter-sheet/games-filter-sheet.component.scss`:

```scss
:host {
  display: block;
  background: #131c16;
  color: var(--games-text-primary, #e0e8e2);
  --games-surface: rgba(255, 255, 255, 0.04);
  --games-surface-border: rgba(255, 255, 255, 0.08);
  --games-text-secondary: #8aa898;
  --games-text-muted: #6a8a7a;
  --games-action: #006442;
  --games-action-hover: #008055;
}

.sheet {
  padding: 16px 18px 24px;
  max-height: 85vh;
  overflow-y: auto;
}

.sheet-header {
  display: flex;
  align-items: center;
  justify-content: space-between;
  margin-bottom: 12px;

  h3 {
    margin: 0;
    font-size: 18px;
    font-weight: 700;
  }

  .close {
    background: transparent;
    border: none;
    color: var(--games-text-muted);
    cursor: pointer;
    padding: 4px;
    display: flex;
    align-items: center;

    &:hover { color: var(--games-text-primary, #e0e8e2); }
  }
}

.row {
  margin-bottom: 14px;

  .row-label {
    display: block;
    font-size: 11px;
    font-weight: 600;
    letter-spacing: 1px;
    text-transform: uppercase;
    color: var(--games-text-muted);
    margin-bottom: 6px;
  }

  .full {
    width: 100%;
  }
}

.genre-grid {
  display: flex;
  flex-wrap: wrap;
  gap: 6px;
}

.genre-chip {
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

  .count {
    opacity: 0.6;
    margin-left: 2px;
    font-weight: 400;
  }

  &.selected .count { opacity: 0.85; }
}

.sheet-footer {
  display: flex;
  gap: 10px;
  margin-top: 16px;
  padding-top: 14px;
  border-top: 1px solid var(--games-surface-border);

  button {
    flex: 1;
    padding: 12px 16px;
    border-radius: 10px;
    border: none;
    font-size: 14px;
    font-weight: 600;
    cursor: pointer;
    font-family: inherit;
  }

  .secondary {
    background: var(--games-surface);
    color: var(--games-text-primary, #e0e8e2);
    border: 1px solid var(--games-surface-border);

    &:hover { background: rgba(255, 255, 255, 0.07); }
  }

  .primary {
    background: var(--games-action);
    color: white;

    &:hover { background: var(--games-action-hover); }
  }
}
```

- [ ] **Step 4: Verify build & lint**

Run: `npm run build && npm run lint`
Expected: Both succeed.

- [ ] **Step 5: Commit**

```bash
git add src/app/games/games-filter-sheet/
git commit -m "feat(games): add GamesFilterSheetComponent (sort/duration/players/genres) for sheet or dialog host"
```

---

## Task 8: Rewrite GamesComponent (orchestration)

**Files:**
- Modify: `src/app/games/games.component.ts` (full rewrite)
- Modify: `src/app/games/games.component.html` (full rewrite)
- Modify: `src/app/games/games.component.scss` (full rewrite)

This task is the biggest. It replaces the old template/styles top-to-bottom and re-wires `GamesComponent` as an orchestrator. Take it carefully.

- [ ] **Step 1: Rewrite the component class**

Replace the entire contents of `src/app/games/games.component.ts` with:

```ts
import { Component, OnDestroy, OnInit } from '@angular/core';
import { CommonModule } from '@angular/common';
import { MatDialog } from '@angular/material/dialog';
import { MatBottomSheet } from '@angular/material/bottom-sheet';
import { BreakpointObserver, Breakpoints } from '@angular/cdk/layout';
import { combineLatest, Observable, Subject } from 'rxjs';
import { map, takeUntil } from 'rxjs/operators';

import { GamesService } from '../services/games.service';
import { DataAggregationService, GameStats } from '../services/data-aggregation.service';
import {
  Game,
  GameDuration,
  GameFilter,
  GameGenre,
  SortOrder,
} from '../models/game.model';
import { GameDetailsDialogComponent } from '../game-details-dialog/game-details-dialog.component';

import {
  GamesFilterSheetComponent,
  FilterSheetData,
  FilterSheetResult,
} from './games-filter-sheet/games-filter-sheet.component';
import { GamesSearchBarComponent } from './games-search-bar/games-search-bar.component';
import { GamesGenreStripComponent } from './games-genre-strip/games-genre-strip.component';
import { GamesHeroComponent } from './games-hero/games-hero.component';
import { GamesListComponent } from './games-list/games-list.component';

import {
  countActiveFilters,
  GenreCount,
  HeroSelection,
  pickHero,
  topGenres as topGenresUtil,
} from './games.utils';

interface PersistedFilter {
  genres?: GameGenre[];
  duration?: GameDuration;
  supportedPlayers?: number;
  sort: SortOrder;
}

const STORAGE_KEY = 'gameday-games-filter';
const SURFACE_GENRE_COUNT = 6;

@Component({
  selector: 'app-games',
  standalone: true,
  imports: [
    CommonModule,
    GamesSearchBarComponent,
    GamesGenreStripComponent,
    GamesHeroComponent,
    GamesListComponent,
  ],
  templateUrl: './games.component.html',
  styleUrls: ['./games.component.scss'],
})
export class GamesComponent implements OnInit, OnDestroy {
  // Reactive state
  filteredGames$: Observable<Game[]>;
  hero$: Observable<HeroSelection | null>;
  statsById$: Observable<Record<string, GameStats>>;

  // Mutable filter state (mirrored to GamesService and persisted)
  filter: GameFilter = {};
  sort: SortOrder = SortOrder.TITLE_ASC;
  searchText = '';

  // Catalog-derived (set on first emission, not reactive to filters)
  totalCount = 0;
  topGenresList: GenreCount[] = [];
  allGenreCounts: GenreCount[] = [];
  remainingCount = 0;

  // Whether any filter beyond search hides the hero
  get isFiltered(): boolean {
    return (
      !!this.searchText ||
      (!!this.filter.genres && this.filter.genres.length > 0) ||
      !!this.filter.duration ||
      this.filter.supportedPlayers != null
    );
  }

  get activeFilterCount(): number {
    return countActiveFilters(this.filter);
  }

  /** Surface row's selected genre. null = all. Multi-select reflected via multipleSelected flag. */
  get selectedGenre(): GameGenre | null {
    if (!this.filter.genres || this.filter.genres.length === 0) return null;
    if (this.filter.genres.length === 1) return this.filter.genres[0];
    return null;
  }

  get multipleGenresSelected(): boolean {
    return !!this.filter.genres && this.filter.genres.length > 1;
  }

  private destroy$ = new Subject<void>();

  constructor(
    private gamesService: GamesService,
    private dataAggregation: DataAggregationService,
    private dialog: MatDialog,
    private bottomSheet: MatBottomSheet,
    private breakpoints: BreakpointObserver,
  ) {
    this.filteredGames$ = this.gamesService.getGames();

    this.statsById$ = this.dataAggregation.getAllGamesStats().pipe(
      map(arr => {
        const out: Record<string, GameStats> = {};
        for (const s of arr) out[s.gameId] = s;
        return out;
      }),
    );

    // Hero is computed from the unfiltered catalog so it represents
    // "the most-loved game across the whole collection," not "most-loved
    // among current results." (The hero is also hidden when filters are
    // active, but using the catalog keeps the badge stable when the user
    // clears filters.)
    this.hero$ = combineLatest([
      this.gamesService.getCatalog(),
      this.dataAggregation.getAllGamesStats(),
    ]).pipe(map(([games, stats]) => pickHero(games, stats)));
  }

  ngOnInit(): void {
    document.body.className = 'games-page';

    // Restore persisted filter (excluding searchText)
    const persisted = this.readPersisted();
    if (persisted) {
      this.filter = {
        genres: persisted.genres,
        duration: persisted.duration,
        supportedPlayers: persisted.supportedPlayers,
      };
      this.sort = persisted.sort;
    }
    // Derive catalog-wide counts once from the unfiltered catalog.
    // getCatalog() emits the full list independent of the active filter, so
    // these numbers stay stable as the user narrows results.
    this.gamesService.getCatalog()
      .pipe(takeUntil(this.destroy$))
      .subscribe(catalog => {
        this.totalCount = catalog.length;
        this.allGenreCounts = topGenresUtil(catalog, Number.POSITIVE_INFINITY);
        this.topGenresList = this.allGenreCounts.slice(0, SURFACE_GENRE_COUNT);
        this.remainingCount = Math.max(0, this.allGenreCounts.length - this.topGenresList.length);
      });

    this.gamesService.setFilter({ ...this.filter });
    this.gamesService.setSort(this.sort);
  }

  ngOnDestroy(): void {
    document.body.className = '';
    this.destroy$.next();
    this.destroy$.complete();
  }

  // ---- Search ----

  onSearchTextChange(value: string): void {
    this.searchText = value;
    this.filter.searchText = value || undefined;
    this.gamesService.setFilter({ ...this.filter });
  }

  // ---- Genre strip (single-select) ----

  onSelectGenre(genre: GameGenre | null): void {
    this.filter.genres = genre ? [genre] : undefined;
    this.gamesService.setFilter({ ...this.filter });
    this.persist();
  }

  // ---- Hero ----

  onOpenGame(game: Game): void {
    this.dialog.open(GameDetailsDialogComponent, {
      data: game,
      width: '900px',
      maxWidth: '95vw',
      maxHeight: '95vh',
      panelClass: 'game-details-dialog',
    });
  }

  // ---- Filter sheet ----

  openFilters(): void {
    const data: FilterSheetData = {
      filter: { ...this.filter },
      sort: this.sort,
      genreCounts: this.allGenreCounts,
    };

    const isMobile = this.breakpoints.isMatched(Breakpoints.HandsetPortrait)
      || this.breakpoints.isMatched(Breakpoints.HandsetLandscape);

    if (isMobile) {
      const ref = this.bottomSheet.open<GamesFilterSheetComponent, FilterSheetData, FilterSheetResult>(
        GamesFilterSheetComponent,
        { data, panelClass: 'games-filter-sheet-panel' },
      );
      ref.afterDismissed().subscribe(result => this.applySheetResult(result ?? null));
    } else {
      const ref = this.dialog.open<GamesFilterSheetComponent, FilterSheetData, FilterSheetResult>(
        GamesFilterSheetComponent,
        {
          data,
          width: '480px',
          maxWidth: '90vw',
          panelClass: 'games-filter-sheet-panel',
        },
      );
      ref.afterClosed().subscribe(result => this.applySheetResult(result ?? null));
    }
  }

  private applySheetResult(result: FilterSheetResult | null): void {
    if (!result) return;
    this.filter = { ...result.filter, searchText: this.searchText || undefined };
    this.sort = result.sort;
    this.gamesService.setFilter({ ...this.filter });
    this.gamesService.setSort(this.sort);
    this.persist();
  }

  // ---- Persistence ----

  private readPersisted(): PersistedFilter | null {
    try {
      const raw = localStorage.getItem(STORAGE_KEY);
      if (!raw) return null;
      const parsed = JSON.parse(raw) as PersistedFilter;
      if (!parsed.sort) return null;
      return parsed;
    } catch {
      return null;
    }
  }

  private persist(): void {
    const payload: PersistedFilter = {
      genres: this.filter.genres,
      duration: this.filter.duration,
      supportedPlayers: this.filter.supportedPlayers,
      sort: this.sort,
    };
    try {
      localStorage.setItem(STORAGE_KEY, JSON.stringify(payload));
    } catch {
      // localStorage may be unavailable (private mode); silently ignore.
    }
  }
}
```

- [ ] **Step 2: Rewrite the template**

Replace the entire contents of `src/app/games/games.component.html` with:

```html
<div class="games-page-shell">
  <header class="page-header">
    <div class="title-block">
      <div class="eyebrow">Golgari Palace</div>
      <h1>The Collection</h1>
    </div>
    <div class="count" *ngIf="totalCount > 0">{{ totalCount }} games</div>
  </header>

  <app-games-search-bar
    [searchText]="searchText"
    [activeFilterCount]="activeFilterCount"
    (searchTextChange)="onSearchTextChange($event)"
    (openFilters)="openFilters()"
  ></app-games-search-bar>

  <app-games-genre-strip
    [topGenres]="topGenresList"
    [totalCount]="totalCount"
    [remainingCount]="remainingCount"
    [selectedGenre]="selectedGenre"
    [multipleSelected]="multipleGenresSelected"
    (selectGenre)="onSelectGenre($event)"
    (openFilters)="openFilters()"
  ></app-games-genre-strip>

  <ng-container *ngIf="!isFiltered && (hero$ | async) as hero">
    <app-games-hero
      [game]="hero.game"
      [variant]="hero.variant"
      [likeCount]="hero.likeCount"
      (open)="onOpenGame($event)"
    ></app-games-hero>
  </ng-container>

  <ng-container *ngIf="(filteredGames$ | async) as games">
    <div class="section-label">{{ isFiltered ? 'Results · ' + games.length : 'All games' }}</div>

    <app-games-list
      *ngIf="games.length > 0; else empty"
      [games]="games"
      [statsById]="(statsById$ | async) ?? {}"
      (open)="onOpenGame($event)"
    ></app-games-list>

    <ng-template #empty>
      <div class="empty-row">
        <span *ngIf="isFiltered; else emptyCatalog">No games match those filters.</span>
        <ng-template #emptyCatalog>The collection is empty.</ng-template>
        <button *ngIf="isFiltered" type="button" class="link-btn" (click)="openFilters()">Adjust filters</button>
      </div>
    </ng-template>
  </ng-container>
</div>
```

- [ ] **Step 3: Rewrite the styles**

Replace the entire contents of `src/app/games/games.component.scss` with:

```scss
.games-page-shell {
  max-width: 1200px;
  margin: 0 auto;
  padding: 16px 14px 32px;
  color: var(--games-text-primary, #e0e8e2);

  @media (min-width: 768px) {
    padding: 20px 20px 40px;
  }

  @media (min-width: 1024px) {
    padding: 24px 24px 48px;
  }
}

.page-header {
  display: flex;
  align-items: baseline;
  justify-content: space-between;
  margin-bottom: 12px;

  .title-block {
    .eyebrow {
      color: var(--games-accent);
      font-size: 11px;
      font-weight: 600;
      letter-spacing: 1.5px;
      text-transform: uppercase;
    }

    h1 {
      color: var(--games-text-primary);
      font-size: 22px;
      font-weight: 700;
      letter-spacing: -0.5px;
      margin: 0;

      @media (min-width: 768px) {
        font-size: 26px;
      }

      @media (min-width: 1024px) {
        font-size: 28px;
      }
    }
  }

  .count {
    color: var(--games-text-muted);
    font-size: 11px;

    @media (min-width: 768px) {
      font-size: 12px;
    }
  }
}

.section-label {
  color: var(--games-text-muted);
  font-size: 11px;
  font-weight: 600;
  letter-spacing: 1px;
  text-transform: uppercase;
  margin: 4px 0 10px;

  @media (min-width: 1024px) {
    font-size: 12px;
    margin: 4px 0 12px;
  }
}

.empty-row {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 12px;
  padding: 18px;
  background: var(--games-surface);
  border: 1px solid var(--games-surface-border);
  border-radius: 10px;
  color: var(--games-text-secondary);
  font-size: 14px;

  .link-btn {
    background: transparent;
    border: none;
    color: var(--games-action-hover);
    font-size: 14px;
    font-weight: 600;
    cursor: pointer;
    text-decoration: underline;
    font-family: inherit;
    padding: 0;
  }
}

// Override Material's white panel for the filter sheet/dialog so it matches the dark theme.
::ng-deep .games-filter-sheet-panel {
  .mat-mdc-dialog-surface,
  .mat-bottom-sheet-container {
    background: #131c16;
    color: var(--games-text-primary, #e0e8e2);
    border-radius: 16px 16px 0 0;
    padding: 0;
  }
}
```

- [ ] **Step 4: Verify build & lint**

Run: `npm run build && npm run lint`
Expected: Both succeed. Several Material modules previously imported by `GamesComponent` are no longer needed (form field, select, input, chips, card, button, icon) — make sure the new imports list contains only what the template uses (CommonModule + the five new child components).

- [ ] **Step 5: Visual smoke check**

Run: `npm start` then open `http://localhost:4200/golgari-game-day/games` in a desktop browser, then resize the window down to ~375px wide.

Verify:
- Dark green gradient background
- Page header `GOLGARI PALACE` / `The Collection` / `42 games`
- Sticky search bar with filter button
- Genre strip with ~6 genres + counts + a `+N more` chip
- Hero card showing one game with `★ TOP RATED` badge (likes are sparse today, fallback path is expected)
- Below hero: at narrow widths a vertical list of rows; at wide widths a 5-column tile grid; tablet sizes show 3 columns
- Tap a row/tile/hero → existing details dialog opens
- Tap a chip in the strip → list filters to that genre, hero hides, section label flips to `RESULTS · N`
- Tap "All N" → filter clears, hero comes back
- Tap the gear button → bottom sheet opens on mobile, side dialog on desktop; pick a duration, hit Done; chip badge increments

Stop the dev server when done.

- [ ] **Step 6: Commit**

```bash
git add src/app/games/games.component.ts src/app/games/games.component.html src/app/games/games.component.scss
git commit -m "feat(games): rewrite games page as Netflix-style discovery surface"
```

---

## Task 9: Final verification

**Files:** none (verification only)

- [ ] **Step 1: Production build**

Run: `npm run build:prod`
Expected: Build succeeds. The `flatten-build` script lifts `docs/browser/*` to `docs/`. No new ESLint/TS errors.

- [ ] **Step 2: Lint**

Run: `npm run lint`
Expected: Zero errors. Warnings unchanged from before this branch.

- [ ] **Step 3: Final visual pass**

Run: `npm start`. With browser dev tools open, walk through:
- **Mobile (375px)**: list rows, sticky search behaves on scroll, bottom sheet opens, dark theme reads well, hero looks intentional even with no likes
- **Tablet (768px)**: tile grid 3 across, hero adopts cinematic 21:9 aspect
- **Desktop (1280px)**: tile grid 5 across, side-dialog filter, search bar feels relaxed
- **Persistence**: pick a genre + duration, refresh — surface chip and gear badge restore. Search box does not (intentional).
- **Filter clearing**: open sheet → "Clear all" → Done → strip back to "All N", hero returns.
- **Empty state**: type a search that matches nothing — empty row appears with "Adjust filters" link.

- [ ] **Step 4: Commit anything fix-up**

If the visual pass turned up small fixes, commit them as their own commits with `fix(games): …` messages. Do not amend earlier commits.

---

## Done criteria

- All checkboxes ticked.
- `/games` page on desktop and mobile matches the v2 mockup at [`design-mockup-v2.html`](../.superpowers/brainstorm/31705-1777737356/content/design-mockup-v2.html) within reason (real game art differs from placeholder boxes; that's fine).
- No regressions in `/home`, `/photos`, or the navbar.
- `GameDetailsDialogComponent` opens from card click on every layout.
- `npm run build:prod` and `npm run lint` both clean.
