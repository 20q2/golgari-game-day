# Featured Trio Carousel Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Replace the games-page single hero with a 3-slot featured carousel — Most Loved, Highest Community Rating, Recently Applauded — using CSS scroll-snap, dot indicators, and the existing `<app-games-hero>` rendered three times.

**Architecture:** Extend `HeroVariant` and `HeroSelection`, add a `pickFeaturedTrio` selector, teach `GamesHeroComponent` two new badge variants, drop the new `GamesFeaturedCarouselComponent` between the genre strip and the list, then wire `GamesComponent` to a `featured$` array. Sequenced so each commit leaves the project building.

**Tech Stack:** Angular 20 standalone components, RxJS observables, CSS scroll-snap (no carousel library), `IntersectionObserver` for active-dot tracking.

**Spec:** [plans/2026-05-03-featured-trio-carousel-spec.md](./2026-05-03-featured-trio-carousel-spec.md)

---

## File Structure

**Modified:**
- `src/app/games/games.utils.ts` — add `pickFeaturedTrio`, extend `HeroSelection`, narrow `HeroVariant` (final state).
- `src/app/games/games-hero/games-hero.component.ts` — handle three variants, accept `ratingValue` input.
- `src/app/games/games-hero/games-hero.component.html` — bind new variant class.
- `src/app/games/games-hero/games-hero.component.scss` — add `.fire` icon color rule.
- `src/app/games/games.component.ts` — switch `hero$` → `featured$`.
- `src/app/games/games.component.html` — replace single-hero block with carousel.

**Created:**
- `src/app/games/games-featured-carousel/games-featured-carousel.component.ts`
- `src/app/games/games-featured-carousel/games-featured-carousel.component.html`
- `src/app/games/games-featured-carousel/games-featured-carousel.component.scss`

---

### Task 1: Teach `GamesHeroComponent` the new variants (superset)

This task adds support for the new variants without removing the old `'top-rated'` variant. After this commit, `GamesHeroComponent` accepts both old and new — letting later tasks swap the data source without breaking the build.

**Files:**
- Modify: `src/app/games/games-hero/games-hero.component.ts`
- Modify: `src/app/games/games-hero/games-hero.component.html`
- Modify: `src/app/games/games-hero/games-hero.component.scss`

- [ ] **Step 1: Update the component class**

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
  @Input() ratingValue?: number;

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
    switch (this.variant) {
      case 'most-loved':
        return this.likeCount === 1 ? 'MOST LOVED · 1 LIKE' : `MOST LOVED · ${this.likeCount} LIKES`;
      case 'highest-rated':
        return this.ratingValue != null ? `HIGHEST RATED · ${this.ratingValue.toFixed(1)}` : 'HIGHEST RATED';
      case 'recently-hot':
        return "WHAT'S HOT";
      case 'top-rated':
      default:
        return 'TOP RATED';
    }
  }

  get badgeIcon(): string {
    switch (this.variant) {
      case 'most-loved':
        return '♥';
      case 'highest-rated':
      case 'top-rated':
        return '★';
      case 'recently-hot':
        return '🔥';
      default:
        return '★';
    }
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

The default for `variant` stays `'top-rated'` so existing call sites are unaffected. `'top-rated'` will be removed from the union in Task 4, at which point the default will be re-pointed to `'most-loved'`.

- [ ] **Step 2: Update the template**

Replace the entire contents of `src/app/games/games-hero/games-hero.component.html` with:

```html
<button
  type="button"
  class="hero"
  [class.most-loved]="variant === 'most-loved'"
  [class.top-rated]="variant === 'top-rated'"
  [class.highest-rated]="variant === 'highest-rated'"
  [class.recently-hot]="variant === 'recently-hot'"
  (click)="onClick()"
  (keydown)="onKey($event)"
  [attr.aria-label]="'Open ' + game.title + ' details'"
>
  <img *ngIf="game.imageUrl" [src]="game.imageUrl" [alt]="game.title" loading="lazy" />
  <div class="overlay"></div>

  <div class="badge">
    <span
      class="badge-icon"
      [class.heart]="variant === 'most-loved'"
      [class.star]="variant === 'top-rated' || variant === 'highest-rated'"
      [class.fire]="variant === 'recently-hot'"
    >{{ badgeIcon }}</span>
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
      <span *ngFor="let g of genresShown" class="genre-pill">
        <mat-icon class="pill-icon">{{ iconService.iconFor(g) }}</mat-icon>
        <span class="pill-label">{{ g }}</span>
      </span>
    </div>
  </div>
</button>
```

The added bindings: `[class.highest-rated]`, `[class.recently-hot]`, and the `[class.fire]` on `.badge-icon`. Everything else is unchanged from the file's prior state.

- [ ] **Step 3: Add the fire icon color rule**

In `src/app/games/games-hero/games-hero.component.scss`, find the existing `.badge-icon` rules (lines 90-93):

```scss
  .badge-icon {
    &.heart { color: var(--games-heart); }
    &.star  { color: var(--games-star); }
  }
```

Replace with:

```scss
  .badge-icon {
    &.heart { color: var(--games-heart); }
    &.star  { color: var(--games-star); }
    &.fire  { color: #ff8a3d; }
  }
```

The `#ff8a3d` is a warm orange — readable on the dark badge gradient. Hardcoded rather than tokenized because it's used in exactly one place.

- [ ] **Step 4: Verify TypeScript and template type-check are clean**

```bash
npx tsc --noEmit -p tsconfig.app.json
```

Expected: clean exit.

- [ ] **Step 5: Commit**

```bash
git add src/app/games/games-hero/games-hero.component.ts src/app/games/games-hero/games-hero.component.html src/app/games/games-hero/games-hero.component.scss
git commit -m "feat(games-hero): add highest-rated and recently-hot variants"
```

---

### Task 2: Add `pickFeaturedTrio` and extend `HeroSelection`

This task augments `games.utils.ts` additively — `pickHero` still works. The `HeroVariant` union temporarily includes both the old `'top-rated'` and the new variants (superset). Cleanup happens in Task 4.

**Files:**
- Modify: `src/app/games/games.utils.ts`

- [ ] **Step 1: Replace the file contents**

Replace the entire contents of `src/app/games/games.utils.ts` with:

```ts
import { Game, GameFilter, GameGenre } from '../models/game.model';
import { GameStats } from '../services/data-aggregation.service';

/**
 * Variants used by the featured-trio carousel and the legacy single hero.
 *
 * - 'most-loved'    : top game by lifetime likes.
 * - 'highest-rated' : top game by community average rating.
 * - 'recently-hot'  : top game by activity (likes + comments + ratings) in the past 14 days.
 * - 'top-rated'     : DEPRECATED — BGG-rating fallback used by the legacy single hero. Removed in Task 4.
 */
export type HeroVariant = 'most-loved' | 'top-rated' | 'highest-rated' | 'recently-hot';

export interface HeroSelection {
  game: Game;
  variant: HeroVariant;
  likeCount: number;
  /** Community average rating; populated for the 'highest-rated' variant. */
  ratingValue?: number;
}

export interface GenreCount {
  genre: GameGenre;
  count: number;
}

const RECENT_WINDOW_MS = 14 * 24 * 60 * 60 * 1000;

/**
 * Pick the hero game for the page header (legacy single-hero API).
 * - If any game has at least one like, return the most-liked
 *   (ties broken by BGG rating desc, then title asc).
 * - Otherwise fall back to the highest BGG-rated game with the
 *   'top-rated' variant. Designed so the hero looks intentional
 *   even before any social activity has accumulated.
 *
 * Retired in Task 4 in favor of `pickFeaturedTrio`.
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
 * Pick up to three featured games for the carousel:
 *   1. Most Loved              — highest lifetime likes.
 *   2. Highest Community Rating — top community average among games with ≥1 rating.
 *   3. Recently Applauded       — most activity (likes+comments+ratings) in the past 14 days.
 *
 * Slots are de-duplicated: a game already chosen for an earlier slot is skipped
 * in later slots' rankings. A slot whose ranking is empty after the skip is omitted
 * (the returned array can have 0–3 entries, in fixed order).
 *
 * @param now used to compute the 14-day recent window; pass `new Date()` in production.
 */
export function pickFeaturedTrio(
  games: Game[],
  stats: GameStats[],
  now: Date,
): HeroSelection[] {
  if (games.length === 0) return [];

  const gameById = new Map<string, Game>(games.map(g => [g.id, g]));
  const statsById = new Map<string, GameStats>(stats.map(s => [s.gameId, s]));

  const cutoffMs = now.getTime() - RECENT_WINDOW_MS;
  const result: HeroSelection[] = [];
  const used = new Set<string>();

  // Slot 1: Most Loved
  const mostLoved = stats
    .filter(s => s.totalLikes > 0 && gameById.has(s.gameId))
    .sort((a, b) => {
      const ga = gameById.get(a.gameId)!;
      const gb = gameById.get(b.gameId)!;
      return (
        b.totalLikes - a.totalLikes ||
        (gb.bggRating ?? 0) - (ga.bggRating ?? 0) ||
        ga.title.localeCompare(gb.title)
      );
    })[0];
  if (mostLoved) {
    const game = gameById.get(mostLoved.gameId)!;
    result.push({ game, variant: 'most-loved', likeCount: mostLoved.totalLikes });
    used.add(game.id);
  }

  // Slot 2: Highest Community Rating
  const highestRated = stats
    .filter(s =>
      s.averageRating != null &&
      s.totalRatings > 0 &&
      gameById.has(s.gameId) &&
      !used.has(s.gameId),
    )
    .sort((a, b) => {
      const ga = gameById.get(a.gameId)!;
      const gb = gameById.get(b.gameId)!;
      return (
        (b.averageRating ?? 0) - (a.averageRating ?? 0) ||
        b.totalRatings - a.totalRatings ||
        ga.title.localeCompare(gb.title)
      );
    })[0];
  if (highestRated) {
    const game = gameById.get(highestRated.gameId)!;
    result.push({
      game,
      variant: 'highest-rated',
      likeCount: highestRated.totalLikes,
      ratingValue: highestRated.averageRating ?? undefined,
    });
    used.add(game.id);
  }

  // Slot 3: Recently Applauded
  type RecentRow = { gameId: string; count: number; latestMs: number };
  const recentRows: RecentRow[] = [];
  for (const s of stats) {
    if (!gameById.has(s.gameId) || used.has(s.gameId)) continue;
    let count = 0;
    let latestMs = 0;
    const accumulate = (ts: string | Date | undefined) => {
      if (ts == null) return;
      const ms = ts instanceof Date ? ts.getTime() : new Date(ts).getTime();
      if (Number.isNaN(ms)) return;
      if (ms >= cutoffMs) {
        count += 1;
        if (ms > latestMs) latestMs = ms;
      }
    };
    for (const c of s.comments) accumulate(c.timestamp);
    for (const r of s.ratings) accumulate(r.timestamp);
    for (const l of s.likes) accumulate(l.timestamp);
    if (count > 0) recentRows.push({ gameId: s.gameId, count, latestMs });
  }
  recentRows.sort((a, b) => {
    const ga = gameById.get(a.gameId)!;
    const gb = gameById.get(b.gameId)!;
    return (
      b.count - a.count ||
      b.latestMs - a.latestMs ||
      ga.title.localeCompare(gb.title)
    );
  });
  const hot = recentRows[0];
  if (hot) {
    const game = gameById.get(hot.gameId)!;
    const stat = statsById.get(hot.gameId);
    result.push({
      game,
      variant: 'recently-hot',
      likeCount: stat?.totalLikes ?? 0,
    });
    used.add(game.id);
  }

  return result;
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

Key changes vs. the prior file:
- `HeroVariant` widened to include `'highest-rated' | 'recently-hot'` (still includes `'top-rated'`).
- `HeroSelection` gains optional `ratingValue`.
- New `pickFeaturedTrio` function alongside the unchanged `pickHero`.
- `RECENT_WINDOW_MS` constant for the 14-day cutoff.
- `topGenres` and `countActiveFilters` are unchanged.

The `Comment` / `Rating` / `Like` types from `aws-api.service` (re-exported through `data-aggregation.service`) all expose a `timestamp` field. The `accumulate` helper handles both `string` and `Date` shapes defensively.

- [ ] **Step 2: Verify TypeScript is clean**

```bash
npx tsc --noEmit -p tsconfig.app.json
```

Expected: clean exit.

- [ ] **Step 3: Commit**

```bash
git add src/app/games/games.utils.ts
git commit -m "feat(games): add pickFeaturedTrio selector and ratingValue selection field"
```

---

### Task 3: Create `GamesFeaturedCarouselComponent`

New standalone component that renders the carousel + dot indicators. No consumer changes yet.

**Files:**
- Create: `src/app/games/games-featured-carousel/games-featured-carousel.component.ts`
- Create: `src/app/games/games-featured-carousel/games-featured-carousel.component.html`
- Create: `src/app/games/games-featured-carousel/games-featured-carousel.component.scss`

- [ ] **Step 1: Create the component class**

Create `src/app/games/games-featured-carousel/games-featured-carousel.component.ts` with:

```ts
import {
  AfterViewInit,
  Component,
  ElementRef,
  EventEmitter,
  Input,
  OnDestroy,
  Output,
  QueryList,
  ViewChildren,
} from '@angular/core';
import { CommonModule } from '@angular/common';
import { GamesHeroComponent } from '../games-hero/games-hero.component';
import { Game } from '../../models/game.model';
import { HeroSelection } from '../games.utils';

@Component({
  selector: 'app-games-featured-carousel',
  standalone: true,
  imports: [CommonModule, GamesHeroComponent],
  templateUrl: './games-featured-carousel.component.html',
  styleUrls: ['./games-featured-carousel.component.scss'],
})
export class GamesFeaturedCarouselComponent implements AfterViewInit, OnDestroy {
  @Input({ required: true }) selections: HeroSelection[] = [];
  @Output() open = new EventEmitter<Game>();

  @ViewChildren('slide') slideRefs!: QueryList<ElementRef<HTMLElement>>;

  activeIndex = 0;
  private observer?: IntersectionObserver;

  ngAfterViewInit(): void {
    this.observer = new IntersectionObserver(
      (entries) => {
        for (const entry of entries) {
          if (entry.isIntersecting && entry.intersectionRatio >= 0.6) {
            const idx = this.slideRefs.toArray().findIndex(ref => ref.nativeElement === entry.target);
            if (idx >= 0) this.activeIndex = idx;
          }
        }
      },
      { threshold: [0.6] },
    );
    this.slideRefs.forEach(ref => this.observer!.observe(ref.nativeElement));
  }

  ngOnDestroy(): void {
    this.observer?.disconnect();
  }

  scrollTo(index: number): void {
    const ref = this.slideRefs.get(index);
    ref?.nativeElement.scrollIntoView({ behavior: 'smooth', inline: 'start', block: 'nearest' });
  }
}
```

- [ ] **Step 2: Create the template**

Create `src/app/games/games-featured-carousel/games-featured-carousel.component.html` with:

```html
<div class="featured" *ngIf="selections.length > 0">
  <div class="track">
    <div *ngFor="let s of selections; let i = index" class="slide" #slide>
      <app-games-hero
        [game]="s.game"
        [variant]="s.variant"
        [likeCount]="s.likeCount"
        [ratingValue]="s.ratingValue"
        (open)="open.emit($event)"
      ></app-games-hero>
    </div>
  </div>
  <nav class="dots" *ngIf="selections.length > 1" aria-label="Featured carousel pagination">
    <button
      *ngFor="let s of selections; let i = index"
      type="button"
      class="dot"
      [class.active]="i === activeIndex"
      [attr.aria-label]="'Go to slide ' + (i + 1) + ' of ' + selections.length"
      (click)="scrollTo(i)"
    ></button>
  </nav>
</div>
```

- [ ] **Step 3: Create the stylesheet**

Create `src/app/games/games-featured-carousel/games-featured-carousel.component.scss` with:

```scss
:host {
  display: block;
}

.featured {
  display: flex;
  flex-direction: column;
  gap: 8px;
  margin-bottom: 16px;

  @media (min-width: 1024px) {
    margin-bottom: 22px;
  }
}

.track {
  display: flex;
  overflow-x: auto;
  scroll-snap-type: x mandatory;
  scrollbar-width: none;
  -ms-overflow-style: none;

  &::-webkit-scrollbar {
    display: none;
  }
}

.slide {
  flex: 0 0 100%;
  scroll-snap-align: start;
  // Override the hero's :host margin so we control gutter via the track.
  > app-games-hero {
    display: block;
    margin-bottom: 0;
  }
}

.dots {
  display: flex;
  justify-content: center;
  gap: 8px;
  padding: 4px 0;
}

.dot {
  width: 8px;
  height: 8px;
  border-radius: 999px;
  border: none;
  padding: 0;
  background: var(--games-surface-border);
  cursor: pointer;
  transition: background 0.2s ease, transform 0.2s ease;

  &:hover {
    background: var(--games-surface-hover);
  }

  &.active {
    background: var(--games-action);
    transform: scale(1.15);
  }

  &:focus-visible {
    outline: 2px solid var(--games-action-hover);
    outline-offset: 2px;
  }
}
```

The `> app-games-hero { margin-bottom: 0 }` override is needed because the existing `GamesHeroComponent` `:host` has `margin-bottom: 16px;` baked in, and we want the carousel to control its own bottom spacing.

- [ ] **Step 4: Verify TypeScript and template type-check are clean**

```bash
npx tsc --noEmit -p tsconfig.app.json
```

Expected: clean exit.

- [ ] **Step 5: Commit**

```bash
git add src/app/games/games-featured-carousel/games-featured-carousel.component.ts src/app/games/games-featured-carousel/games-featured-carousel.component.html src/app/games/games-featured-carousel/games-featured-carousel.component.scss
git commit -m "feat(games): add GamesFeaturedCarouselComponent"
```

---

### Task 4: Wire the carousel into `GamesComponent` and retire `pickHero`

**Files:**
- Modify: `src/app/games/games.component.ts`
- Modify: `src/app/games/games.component.html`
- Modify: `src/app/games/games.utils.ts`

- [ ] **Step 1: Update `GamesComponent` to use `featured$`**

In `src/app/games/games.component.ts`, the constructor currently builds `hero$` (around lines 122-131). Find this block:

```ts
    // Hero is computed from the unfiltered catalog so it represents
    // "the most-loved game across the whole collection," not "most-loved
    // among current results." (The hero is also hidden when filters are
    // active, but using the catalog keeps the badge stable when the user
    // clears filters.)
    this.hero$ = combineLatest([
      this.gamesService.getCatalog(),
      this.dataAggregation.getAllGamesStats(),
    ]).pipe(map(([games, stats]) => pickHero(games, stats)));
```

Replace with:

```ts
    // Featured trio is computed from the unfiltered catalog so the slots
    // represent "the standouts across the whole collection," not "the
    // standouts among current results." The carousel is also hidden when
    // filters are active, but using the catalog keeps each slot stable
    // when the user clears filters.
    this.featured$ = combineLatest([
      this.gamesService.getCatalog(),
      this.dataAggregation.getAllGamesStats(),
    ]).pipe(map(([games, stats]) => pickFeaturedTrio(games, stats, new Date())));
```

In the same file, find the field declaration:

```ts
  hero$: Observable<HeroSelection | null>;
```

Replace with:

```ts
  featured$: Observable<HeroSelection[]>;
```

In the imports near the top, change:

```ts
import {
  countActiveFilters,
  GenreCount,
  HeroSelection,
  pickHero,
  topGenres as topGenresUtil,
} from './games.utils';
```

to:

```ts
import {
  countActiveFilters,
  GenreCount,
  HeroSelection,
  pickFeaturedTrio,
  topGenres as topGenresUtil,
} from './games.utils';
```

(`HeroSelection` may no longer be referenced after the swap; if `tsc` warns about it being unused later, drop it from the import. Keep it for now to avoid an extra mid-task edit.)

- [ ] **Step 2: Update the games template**

In `src/app/games/games.component.html`, find lines 27-34:

```html
  <ng-container *ngIf="!isFiltered && (hero$ | async) as hero">
    <app-games-hero
      [game]="hero.game"
      [variant]="hero.variant"
      [likeCount]="hero.likeCount"
      (open)="onOpenGame($event)"
    ></app-games-hero>
  </ng-container>
```

Replace with:

```html
  <ng-container *ngIf="!isFiltered && (featured$ | async) as featured">
    <app-games-featured-carousel
      *ngIf="featured.length > 0"
      [selections]="featured"
      (open)="onOpenGame($event)"
    ></app-games-featured-carousel>
  </ng-container>
```

- [ ] **Step 3: Wire the new carousel component into `GamesComponent`'s imports**

In `src/app/games/games.component.ts`, find the existing component-imports block (around lines 26-29):

```ts
import { GamesHeroComponent } from './games-hero/games-hero.component';
import { GamesListComponent } from './games-list/games-list.component';
```

Add a new import line for the carousel:

```ts
import { GamesFeaturedCarouselComponent } from './games-featured-carousel/games-featured-carousel.component';
```

Then find the `imports:` array inside the `@Component({ ... })` decorator (around lines 50-57):

```ts
  imports: [
    CommonModule,
    GamesSearchBarComponent,
    GamesGenreStripComponent,
    GamesHeroComponent,
    GamesListComponent,
  ],
```

Replace with:

```ts
  imports: [
    CommonModule,
    GamesSearchBarComponent,
    GamesGenreStripComponent,
    GamesHeroComponent,
    GamesListComponent,
    GamesFeaturedCarouselComponent,
  ],
```

`GamesHeroComponent` stays in the imports because the carousel is its consumer; Angular's standalone import system doesn't transitively grant the parent access to the child's selector, and even though `GamesComponent`'s template no longer renders `<app-games-hero>` directly, leaving the import doesn't hurt the bundle. (If a future task removes `GamesHeroComponent` from the parent's imports, that's a clean follow-up and not required here.)

- [ ] **Step 4: Retire `pickHero` and narrow `HeroVariant`**

Now that `GamesComponent` no longer calls `pickHero` and never produces a `'top-rated'` selection, both can be removed. Open `src/app/games/games.utils.ts`.

Delete the `pickHero` function entirely (the JSDoc comment block + the function body — the block introduced as "Pick the hero game for the page header (legacy single-hero API)").

In the same file, find the `HeroVariant` declaration:

```ts
export type HeroVariant = 'most-loved' | 'top-rated' | 'highest-rated' | 'recently-hot';
```

Replace with:

```ts
export type HeroVariant = 'most-loved' | 'highest-rated' | 'recently-hot';
```

The JSDoc above it should also have its `'top-rated'` bullet removed. Replace the entire JSDoc + type block with:

```ts
/**
 * Variants used by the featured-trio carousel.
 *
 * - 'most-loved'    : top game by lifetime likes.
 * - 'highest-rated' : top game by community average rating.
 * - 'recently-hot'  : top game by activity (likes + comments + ratings) in the past 14 days.
 */
export type HeroVariant = 'most-loved' | 'highest-rated' | 'recently-hot';
```

- [ ] **Step 5: Update `GamesHeroComponent`'s default variant**

The component's `@Input() variant: HeroVariant = 'top-rated';` no longer compiles because `'top-rated'` was removed from the union. Open `src/app/games/games-hero/games-hero.component.ts` and change that line to:

```ts
  @Input() variant: HeroVariant = 'most-loved';
```

Also remove the obsolete `case 'top-rated':` branch in `badgeText` and the `'top-rated'` arm in `badgeIcon`. The updated getters should read:

```ts
  get badgeText(): string {
    switch (this.variant) {
      case 'most-loved':
        return this.likeCount === 1 ? 'MOST LOVED · 1 LIKE' : `MOST LOVED · ${this.likeCount} LIKES`;
      case 'highest-rated':
        return this.ratingValue != null ? `HIGHEST RATED · ${this.ratingValue.toFixed(1)}` : 'HIGHEST RATED';
      case 'recently-hot':
        return "WHAT'S HOT";
    }
  }

  get badgeIcon(): string {
    switch (this.variant) {
      case 'most-loved':
        return '♥';
      case 'highest-rated':
        return '★';
      case 'recently-hot':
        return '🔥';
    }
  }
```

(The `default` arms are gone; an exhaustive `switch` over a narrow union type compiles.)

In `src/app/games/games-hero/games-hero.component.html`, also drop the obsolete `[class.top-rated]` binding and the `'top-rated'` arm of `[class.star]`:

Find:

```html
  [class.top-rated]="variant === 'top-rated'"
  [class.highest-rated]="variant === 'highest-rated'"
```

Replace with:

```html
  [class.highest-rated]="variant === 'highest-rated'"
```

And find:

```html
      [class.star]="variant === 'top-rated' || variant === 'highest-rated'"
```

Replace with:

```html
      [class.star]="variant === 'highest-rated'"
```

- [ ] **Step 6: Verify TypeScript and template type-check are clean**

```bash
npx tsc --noEmit -p tsconfig.app.json
```

Expected: clean exit.

- [ ] **Step 7: Commit**

```bash
git add src/app/games/games.component.ts src/app/games/games.component.html src/app/games/games.utils.ts src/app/games/games-hero/games-hero.component.ts src/app/games/games-hero/games-hero.component.html
git commit -m "feat(games): replace single hero with featured trio carousel"
```

---

### Task 5: Production build verification

**Files:**
- None (verification only).

- [ ] **Step 1: Run the production build**

```bash
npm run build:prod
```

Expected: completes without errors.

- [ ] **Step 2: No commit**

`docs/` is `.gitignore`d.

---

## Verification checklist (final)

- [ ] `npx tsc --noEmit -p tsconfig.app.json` is clean.
- [ ] `npm run build:prod` succeeds.
- [ ] `git log --oneline -4` shows the four feature commits in order.

## Manual verification (operator)

1. `npm start` → visit `/home`. Above the genre strip, a single card renders with the `MOST LOVED` badge (assuming any likes exist).
2. Swipe / drag the card horizontally. It snaps to the next slot (`HIGHEST RATED · X.X`). Three small dots beneath update to track position.
3. Swipe again to `WHAT'S HOT 🔥`. Dots show position 3 of 3.
4. Tap the first dot. Carousel scrolls back smoothly to slot 1.
5. Type into the search bar. The whole carousel hides; the list filters.
6. Clear the search. Carousel reappears in its prior state.
7. With no community ratings or no recent activity in your data, confirm the relevant slot is silently omitted (carousel may show 1 or 2 cards) — the dots row mirrors the actual count.
