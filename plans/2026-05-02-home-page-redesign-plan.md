# Home Page Redesign Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Replace the current home page with a discovery tool ("What shall we play tonight?"), and extract the duplicated genre→icon dictionary into a shared service used by `/home`, `/games`, and the game-details dialog.

**Architecture:** Standalone Angular components under `src/app/home/` (filter / results / activity-strip), orchestrated by a rewritten `HomeComponent`. A new `GenreIconService` centralizes the icon + color + mood-cluster maps. Pure helpers in `home-filter.helpers.ts` handle `playTime` parsing, filter matching, ranking, and activity composition.

**Tech Stack:** Angular 20 standalone components, Angular Material (MatIcon, MatChip, MatCard, MatButton), RxJS observables (combineLatest, map), localStorage for filter persistence. No test runner is wired in this project (Karma was removed) — verification is manual via `npm start` plus build/lint checks. TDD-style steps are adapted to "write code, then build/lint/visually verify."

**Spec:** [`specs/2026-05-02-home-page-redesign-design.md`](../specs/2026-05-02-home-page-redesign-design.md)

**Visual reference:** `.superpowers/brainstorm/9773-1777735062/content/composition-v4.html`

---

## File Structure

**New:**
- `src/app/home/home-filter.model.ts` — types and constants (`HomeFilter`, `MoodFilter`, `MOOD_TO_GENRES`, defaults)
- `src/app/home/home-filter.helpers.ts` — pure functions (`parseMinPlayMinutes`, `gameMatchesFilter`, `rankGames`, `buildActivityItems`)
- `src/app/services/genre-icon.service.ts` — shared icon/color/mood dictionary
- `src/app/home/discovery-filter/discovery-filter.component.{ts,html,scss}` — presentational chip-row filter
- `src/app/home/discovery-results/discovery-results.component.{ts,html,scss}` — presentational ranked list
- `src/app/home/activity-strip/activity-strip.component.{ts,html,scss}` — presentational latest-activity strip

**Modified:**
- `src/app/home/home.component.{ts,html,scss}` — full rewrite
- `src/app/games/games.component.ts` — remove duplicated `getGenreIcon` / `getGenreColor`, inject `GenreIconService`
- `src/app/games/games.component.html` — call `iconService.iconFor(genre)` / `iconService.colorFor(genre)`
- `src/app/game-details-dialog/game-details-dialog.component.ts` — remove duplicated `getGenreIcon`, inject service
- `src/app/game-details-dialog/game-details-dialog.component.html` — call `iconService.iconFor(genre)`

---

## Task 1: Filter model & mood clusters

**Files:**
- Create: `src/app/home/home-filter.model.ts`

- [ ] **Step 1: Create the filter model file**

```ts
import { GameGenre } from '../models/game.model';

/** Players selected. 7 represents "7+" (match games where maxPlayers >= 7). */
export type PlayerCountFilter = 2 | 3 | 4 | 5 | 6 | 7;

/** Time ceiling in minutes; null means "Any length". */
export type TimeBucket = 30 | 60 | 120 | null;

export type MoodFilter = 'any' | 'strategy' | 'party' | 'family' | 'coop' | 'heavy' | 'card';

export interface HomeFilter {
  players: PlayerCountFilter;
  timeMaxMinutes: TimeBucket;
  mood: MoodFilter;
}

export const DEFAULT_HOME_FILTER: HomeFilter = {
  players: 5,
  timeMaxMinutes: 120,
  mood: 'any',
};

export const HOME_FILTER_STORAGE_KEY = 'gameday-home-filter';

/** Maps each mood (except 'any') to a cluster of underlying GameGenre values.
 *  A game matches a mood if any of its genres is in the cluster. */
export const MOOD_TO_GENRES: Record<Exclude<MoodFilter, 'any'>, GameGenre[]> = {
  strategy: [
    GameGenre.STRATEGY,
    GameGenre.EURO,
    GameGenre.AREA_CONTROL,
    GameGenre.ENGINE_BUILDING,
  ],
  party: [
    GameGenre.PARTY,
    GameGenre.SOCIAL_DEDUCTION,
    GameGenre.BLUFFING,
    GameGenre.DRINKING,
    GameGenre.DEXTERITY,
  ],
  family: [
    GameGenre.FAMILY,
    GameGenre.ABSTRACT,
    GameGenre.MEMORY,
    GameGenre.SET_COLLECTION,
    GameGenre.ROUTE_BUILDING,
    GameGenre.PUSH_YOUR_LUCK,
  ],
  coop: [GameGenre.COOPERATIVE],
  heavy: [
    GameGenre.WAR_GAME,
    GameGenre.MINIATURES,
    GameGenre.LEGACY,
    GameGenre.RPG,
    GameGenre.THEMATIC,
    GameGenre.ASYMMETRIC,
    GameGenre.ADVENTURE,
    GameGenre.HORROR,
  ],
  card: [GameGenre.CARD_GAME, GameGenre.DECK_BUILDING, GameGenre.CARD_DRAFTING],
};

export const PLAYER_OPTIONS: { value: PlayerCountFilter; label: string }[] = [
  { value: 2, label: '2' },
  { value: 3, label: '3' },
  { value: 4, label: '4' },
  { value: 5, label: '5' },
  { value: 6, label: '6' },
  { value: 7, label: '7+' },
];

export const TIME_OPTIONS: { value: TimeBucket; label: string; mobileLabel: string }[] = [
  { value: 30, label: '≤30 min', mobileLabel: '≤30m' },
  { value: 60, label: '≤1 hour', mobileLabel: '≤1h' },
  { value: 120, label: '≤2 hours', mobileLabel: '≤2h' },
  { value: null, label: 'Any', mobileLabel: 'Any' },
];

export const MOOD_OPTIONS: { value: MoodFilter; label: string }[] = [
  { value: 'any', label: 'Any' },
  { value: 'strategy', label: 'Strategy' },
  { value: 'party', label: 'Party' },
  { value: 'family', label: 'Family' },
  { value: 'coop', label: 'Co-op' },
  { value: 'heavy', label: 'Heavy' },
  { value: 'card', label: 'Card' },
];
```

- [ ] **Step 2: Verify build**

Run: `npm run build`
Expected: Build succeeds. (No code uses these types yet, but the file should compile.)

- [ ] **Step 3: Commit**

```bash
git add src/app/home/home-filter.model.ts
git commit -m "feat(home): add home-filter model and mood-to-genre clusters"
```

---

## Task 2: GenreIconService

**Files:**
- Create: `src/app/services/genre-icon.service.ts`

- [ ] **Step 1: Create the service**

```ts
import { Injectable } from '@angular/core';
import { GameGenre } from '../models/game.model';
import { MoodFilter } from '../home/home-filter.model';

export type GenreColor = 'primary' | 'accent' | 'warn' | undefined;

/**
 * Single source of truth for genre icons + colors used across the app.
 * Replaces duplicated getGenreIcon / getGenreColor maps that previously
 * lived in GamesComponent and GameDetailsDialogComponent.
 */
@Injectable({ providedIn: 'root' })
export class GenreIconService {
  readonly genreIcons: Readonly<Record<GameGenre, string>> = {
    [GameGenre.STRATEGY]: 'psychology',
    [GameGenre.PARTY]: 'celebration',
    [GameGenre.COOPERATIVE]: 'groups',
    [GameGenre.CARD_GAME]: 'style',
    [GameGenre.DECK_BUILDING]: 'layers',
    [GameGenre.EURO]: 'account_balance',
    [GameGenre.THEMATIC]: 'auto_stories',
    [GameGenre.ABSTRACT]: 'blur_on',
    [GameGenre.FAMILY]: 'family_restroom',
    [GameGenre.WAR_GAME]: 'gps_fixed',
    [GameGenre.DRINKING]: 'local_bar',
    [GameGenre.ENGINE_BUILDING]: 'settings',
    [GameGenre.DEXTERITY]: 'sports_esports',
    [GameGenre.SOCIAL_DEDUCTION]: 'group_work',
    [GameGenre.BLUFFING]: 'theater_comedy',
    [GameGenre.MEMORY]: 'psychology_alt',
    [GameGenre.ADVENTURE]: 'explore',
    [GameGenre.HORROR]: 'dark_mode',
    [GameGenre.AREA_CONTROL]: 'map',
    [GameGenre.RPG]: 'badge',
    [GameGenre.CARD_DRAFTING]: 'view_carousel',
    [GameGenre.MINIATURES]: 'toys',
    [GameGenre.LEGACY]: 'history_edu',
    [GameGenre.NEGOTIATION]: 'handshake',
    [GameGenre.ROUTE_BUILDING]: 'route',
    [GameGenre.SET_COLLECTION]: 'collections',
    [GameGenre.PUSH_YOUR_LUCK]: 'casino',
    [GameGenre.ASYMMETRIC]: 'balance',
  };

  readonly genreColors: Readonly<Record<GameGenre, GenreColor>> = {
    [GameGenre.STRATEGY]: 'primary',
    [GameGenre.PARTY]: 'accent',
    [GameGenre.COOPERATIVE]: 'primary',
    [GameGenre.CARD_GAME]: undefined,
    [GameGenre.DECK_BUILDING]: 'accent',
    [GameGenre.EURO]: 'primary',
    [GameGenre.THEMATIC]: 'warn',
    [GameGenre.ABSTRACT]: undefined,
    [GameGenre.FAMILY]: undefined,
    [GameGenre.WAR_GAME]: 'warn',
    [GameGenre.DRINKING]: 'accent',
    [GameGenre.ENGINE_BUILDING]: 'primary',
    [GameGenre.DEXTERITY]: 'accent',
    [GameGenre.SOCIAL_DEDUCTION]: 'warn',
    [GameGenre.BLUFFING]: 'warn',
    [GameGenre.MEMORY]: undefined,
    [GameGenre.ADVENTURE]: 'warn',
    [GameGenre.HORROR]: 'warn',
    [GameGenre.AREA_CONTROL]: 'primary',
    [GameGenre.RPG]: 'warn',
    [GameGenre.CARD_DRAFTING]: 'accent',
    [GameGenre.MINIATURES]: 'warn',
    [GameGenre.LEGACY]: 'warn',
    [GameGenre.NEGOTIATION]: 'accent',
    [GameGenre.ROUTE_BUILDING]: 'primary',
    [GameGenre.SET_COLLECTION]: 'primary',
    [GameGenre.PUSH_YOUR_LUCK]: undefined,
    [GameGenre.ASYMMETRIC]: 'primary',
  };

  readonly moodIcons: Readonly<Record<MoodFilter, string>> = {
    any: '',
    strategy: 'psychology',
    party: 'celebration',
    family: 'family_restroom',
    coop: 'groups',
    heavy: 'fitness_center',
    card: 'style',
  };

  iconFor(genre: GameGenre): string {
    return this.genreIcons[genre] ?? 'category';
  }

  colorFor(genre: GameGenre): GenreColor {
    return this.genreColors[genre];
  }

  iconForMood(mood: MoodFilter): string {
    return this.moodIcons[mood] ?? '';
  }
}
```

- [ ] **Step 2: Verify build**

Run: `npm run build`
Expected: Build succeeds.

- [ ] **Step 3: Commit**

```bash
git add src/app/services/genre-icon.service.ts
git commit -m "feat: add GenreIconService as single source of truth for genre icons/colors"
```

---

## Task 3: Refactor GamesComponent to use GenreIconService

**Files:**
- Modify: `src/app/games/games.component.ts:183-251` (remove `getGenreColor` and `getGenreIcon`)
- Modify: `src/app/games/games.component.html:101,106` (call service methods)

- [ ] **Step 1: Inject service in GamesComponent**

In `src/app/games/games.component.ts`, add the import near the existing imports:

```ts
import { GenreIconService } from '../services/genre-icon.service';
```

Update the constructor (currently injects `GamesService`, `MatDialog`, `AwsApiService`, `DataAggregationService`):

```ts
constructor(
  private gamesService: GamesService,
  private dialog: MatDialog,
  private awsApi: AwsApiService,
  private dataAggregation: DataAggregationService,
  public iconService: GenreIconService,
) {}
```

`public` is intentional — the template needs to call it.

- [ ] **Step 2: Delete `getGenreColor` and `getGenreIcon` methods**

Delete the entire block at `src/app/games/games.component.ts:183-251` (both methods). Leave the `trackByGameId`, `onGenreChipClick`, and `onDurationClick` methods that follow.

- [ ] **Step 3: Update template to call the service**

In `src/app/games/games.component.html`, replace `getGenreColor(genre)` and `getGenreIcon(genre)` with `iconService.colorFor(genre)` and `iconService.iconFor(genre)`. There are two occurrences of `getGenreIcon` (lines ~45 and ~106) and one of `getGenreColor` (line ~101).

```html
<mat-chip *ngFor="let genre of game.genres"
          [color]="iconService.colorFor(genre)"
          variant="outlined"
          (click)="onGenreChipClick($event, genre)"
          class="clickable-chip"
          [class.selected-filter]="isGenreSelected(genre)">
  <mat-icon matChipAvatar>{{ iconService.iconFor(genre) }}</mat-icon>
  {{ genre }}
</mat-chip>
```

And the genre-filter chip-set higher up:

```html
<mat-chip *ngFor="let genre of genres"
          [color]="iconService.colorFor(genre)"
          ...>
  <mat-icon matChipAvatar>{{ iconService.iconFor(genre) }}</mat-icon>
  {{ genre }}
</mat-chip>
```

(Use Grep to find every `getGenreIcon`/`getGenreColor` callsite — there should be no remaining references in `games.component.html` after this step.)

- [ ] **Step 4: Verify nothing references the removed methods**

Run: `grep -rn "getGenreIcon\|getGenreColor" src/app/games/`
Expected: empty output.

- [ ] **Step 5: Build and lint**

Run: `npm run build && npm run lint`
Expected: both succeed, no TS errors, no lint errors.

- [ ] **Step 6: Manual verification**

Run: `npm start`
Open http://localhost:4200/games. Visually confirm:
- Genre chips on each game card show the correct icon (e.g. `psychology` brain icon for Strategy, `celebration` for Party).
- Genre chip color theming (primary blue / accent pink / warn red) matches what was on screen before.
- Genre filter row at top of page renders identically.

Stop the dev server when done.

- [ ] **Step 7: Commit**

```bash
git add src/app/games/games.component.ts src/app/games/games.component.html
git commit -m "refactor(games): use GenreIconService instead of inline maps"
```

---

## Task 4: Refactor GameDetailsDialogComponent to use GenreIconService

**Files:**
- Modify: `src/app/game-details-dialog/game-details-dialog.component.ts:143-176` (remove `getGenreIcon`)
- Modify: `src/app/game-details-dialog/game-details-dialog.component.html:17` (call service)

- [ ] **Step 1: Inject service**

Add import near existing imports in `game-details-dialog.component.ts`:

```ts
import { GenreIconService } from '../services/genre-icon.service';
```

Update the constructor (it currently injects `MatDialogRef`, `MAT_DIALOG_DATA`, etc.) to add `public iconService: GenreIconService`.

- [ ] **Step 2: Delete `getGenreIcon` method**

Delete the entire `getGenreIcon` method body at lines 143-176.

- [ ] **Step 3: Update template**

In `game-details-dialog.component.html` line 17, replace:

```html
<mat-icon matChipAvatar>{{ getGenreIcon(genre) }}</mat-icon>
```

with:

```html
<mat-icon matChipAvatar>{{ iconService.iconFor(genre) }}</mat-icon>
```

- [ ] **Step 4: Verify no stale references**

Run: `grep -rn "getGenreIcon" src/app/game-details-dialog/`
Expected: empty output.

- [ ] **Step 5: Build and lint**

Run: `npm run build && npm run lint`
Expected: both succeed.

- [ ] **Step 6: Manual verification**

Run: `npm start`. Open `/games`, click a game card to open the details dialog. Confirm genre chips inside the dialog show the same icons as before. Stop dev server.

- [ ] **Step 7: Commit**

```bash
git add src/app/game-details-dialog/game-details-dialog.component.ts src/app/game-details-dialog/game-details-dialog.component.html
git commit -m "refactor(game-details-dialog): use GenreIconService"
```

---

## Task 5: Pure helpers (parsing, matching, ranking, activity)

**Files:**
- Create: `src/app/home/home-filter.helpers.ts`

- [ ] **Step 1: Create the helpers file**

```ts
import { Game, GameGenre } from '../models/game.model';
import { Comment, Like, Rating } from '../services/aws-api.service';
import {
  HomeFilter,
  MoodFilter,
  MOOD_TO_GENRES,
  PlayerCountFilter,
} from './home-filter.model';

export interface GameLiveStats {
  averageRating: number | null;
  totalRatings: number;
  totalComments: number;
  totalLikes: number;
}

export interface RankedGame {
  game: Game;
  stats: GameLiveStats;
  primaryGenre: GameGenre | null;
  secondaryGenre: GameGenre | null;
}

export type ActivityType = 'comment' | 'rating' | 'like';

export interface ActivityItem {
  type: ActivityType;
  username: string;
  gameId: string;
  gameTitle: string;
  detail?: string;       // comment text snippet, rating value, or undefined for likes
  timestamp: Date;
}

/** Parse the lower bound (in minutes) from a free-text playTime string.
 *  Examples: "40-70 minutes" -> 40, "30 minutes" -> 30, "60-9999 minutes" -> 60.
 *  Returns null if it can't extract a number. */
export function parseMinPlayMinutes(playTime: string | undefined | null): number | null {
  if (!playTime) return null;
  const match = playTime.match(/\d+/);
  if (!match) return null;
  const value = parseInt(match[0], 10);
  return Number.isFinite(value) ? value : null;
}

/** True if the game's player range supports the requested player count.
 *  PlayerCountFilter=7 means "7+" — match games with maxPlayers >= 7. */
export function gameSupportsPlayers(game: Game, players: PlayerCountFilter): boolean {
  if (players === 7) {
    return game.maxPlayers >= 7;
  }
  return game.minPlayers <= players && game.maxPlayers >= players;
}

/** True if the game fits within the time ceiling (lower-bound semantics).
 *  null ceiling = "Any". Games with unparsable playTime only match null. */
export function gameFitsTime(game: Game, timeMaxMinutes: number | null): boolean {
  if (timeMaxMinutes === null) return true;
  const minMinutes = parseMinPlayMinutes(game.playTime);
  if (minMinutes === null) return false;
  return minMinutes <= timeMaxMinutes;
}

/** True if the game's genres intersect the mood's cluster. 'any' matches all. */
export function gameMatchesMood(game: Game, mood: MoodFilter): boolean {
  if (mood === 'any') return true;
  const cluster = MOOD_TO_GENRES[mood];
  return game.genres.some((g) => cluster.includes(g));
}

export function gameMatchesFilter(game: Game, filter: HomeFilter): boolean {
  return (
    gameSupportsPlayers(game, filter.players) &&
    gameFitsTime(game, filter.timeMaxMinutes) &&
    gameMatchesMood(game, filter.mood)
  );
}

/** For a mood selection, return which of a game's genres caused the match
 *  (so the result row badges can show the relevant genre, not just the first). */
export function pickPrimarySecondaryGenre(
  game: Game,
  mood: MoodFilter,
): { primary: GameGenre | null; secondary: GameGenre | null } {
  if (game.genres.length === 0) return { primary: null, secondary: null };
  if (mood !== 'any') {
    const cluster = MOOD_TO_GENRES[mood];
    const matches = game.genres.filter((g) => cluster.includes(g));
    if (matches.length > 0) {
      return { primary: matches[0], secondary: matches[1] ?? game.genres.find((g) => g !== matches[0]) ?? null };
    }
  }
  return { primary: game.genres[0], secondary: game.genres[1] ?? null };
}

/** Compute live stats for a single game from raw streams. */
export function computeStatsForGame(
  gameId: string,
  comments: Comment[],
  ratings: Rating[],
  likes: Like[],
): GameLiveStats {
  const gameRatings = ratings.filter((r) => r.gameId === gameId);
  const totalRatings = gameRatings.length;
  const averageRating =
    totalRatings > 0
      ? Math.round((gameRatings.reduce((sum, r) => sum + r.rating, 0) / totalRatings) * 10) / 10
      : null;
  return {
    averageRating,
    totalRatings,
    totalComments: comments.filter((c) => c.gameId === gameId).length,
    totalLikes: likes.filter((l) => l.gameId === gameId).length,
  };
}

/** Filter + rank.
 *  Sort: averageRating desc (nulls last), then totalLikes desc, then title asc. */
export function rankGames(
  games: Game[],
  filter: HomeFilter,
  comments: Comment[],
  ratings: Rating[],
  likes: Like[],
): RankedGame[] {
  return games
    .filter((game) => gameMatchesFilter(game, filter))
    .map((game) => {
      const stats = computeStatsForGame(game.id, comments, ratings, likes);
      const { primary, secondary } = pickPrimarySecondaryGenre(game, filter.mood);
      return { game, stats, primaryGenre: primary, secondaryGenre: secondary };
    })
    .sort((a, b) => {
      const ar = a.stats.averageRating;
      const br = b.stats.averageRating;
      if (ar === null && br !== null) return 1;
      if (ar !== null && br === null) return -1;
      if (ar !== null && br !== null && ar !== br) return br - ar;
      if (a.stats.totalLikes !== b.stats.totalLikes) return b.stats.totalLikes - a.stats.totalLikes;
      return a.game.title.localeCompare(b.game.title);
    });
}

/** Build top-N most recent activity items, dropping any whose game isn't in the catalog. */
export function buildActivityItems(
  comments: Comment[],
  ratings: Rating[],
  likes: Like[],
  gameById: Map<string, Game>,
  limit: number,
): ActivityItem[] {
  const items: ActivityItem[] = [];

  for (const c of comments) {
    const game = gameById.get(c.gameId);
    if (!game) continue;
    items.push({
      type: 'comment',
      username: c.username,
      gameId: c.gameId,
      gameTitle: game.title,
      detail: c.comment,
      timestamp: new Date(c.timestamp),
    });
  }
  for (const r of ratings) {
    const game = gameById.get(r.gameId);
    if (!game) continue;
    items.push({
      type: 'rating',
      username: r.username,
      gameId: r.gameId,
      gameTitle: game.title,
      detail: `${r.rating}/10`,
      timestamp: new Date(r.timestamp),
    });
  }
  for (const l of likes) {
    const game = gameById.get(l.gameId);
    if (!game) continue;
    items.push({
      type: 'like',
      username: l.username,
      gameId: l.gameId,
      gameTitle: game.title,
      timestamp: new Date(l.timestamp),
    });
  }

  return items.sort((a, b) => b.timestamp.getTime() - a.timestamp.getTime()).slice(0, limit);
}
```

- [ ] **Step 2: Verify build**

Run: `npm run build`
Expected: succeeds.

- [ ] **Step 3: Commit**

```bash
git add src/app/home/home-filter.helpers.ts
git commit -m "feat(home): add filter/ranking/activity pure helpers"
```

---

## Task 6: DiscoveryFilterComponent

**Files:**
- Create: `src/app/home/discovery-filter/discovery-filter.component.ts`
- Create: `src/app/home/discovery-filter/discovery-filter.component.html`
- Create: `src/app/home/discovery-filter/discovery-filter.component.scss`

- [ ] **Step 1: Component class**

`src/app/home/discovery-filter/discovery-filter.component.ts`:

```ts
import { CommonModule } from '@angular/common';
import { Component, EventEmitter, Input, Output } from '@angular/core';
import { MatIconModule } from '@angular/material/icon';
import { GenreIconService } from '../../services/genre-icon.service';
import {
  DEFAULT_HOME_FILTER,
  HomeFilter,
  MOOD_OPTIONS,
  MoodFilter,
  PLAYER_OPTIONS,
  PlayerCountFilter,
  TIME_OPTIONS,
  TimeBucket,
} from '../home-filter.model';

@Component({
  selector: 'app-discovery-filter',
  standalone: true,
  imports: [CommonModule, MatIconModule],
  templateUrl: './discovery-filter.component.html',
  styleUrls: ['./discovery-filter.component.scss'],
})
export class DiscoveryFilterComponent {
  @Input() filter: HomeFilter = DEFAULT_HOME_FILTER;
  @Input() matchCount = 0;
  @Output() filterChange = new EventEmitter<HomeFilter>();
  @Output() resetClicked = new EventEmitter<void>();

  readonly playerOptions = PLAYER_OPTIONS;
  readonly timeOptions = TIME_OPTIONS;
  readonly moodOptions = MOOD_OPTIONS;

  constructor(public iconService: GenreIconService) {}

  selectPlayers(value: PlayerCountFilter): void {
    if (this.filter.players === value) return;
    this.filterChange.emit({ ...this.filter, players: value });
  }

  selectTime(value: TimeBucket): void {
    if (this.filter.timeMaxMinutes === value) return;
    this.filterChange.emit({ ...this.filter, timeMaxMinutes: value });
  }

  selectMood(value: MoodFilter): void {
    if (this.filter.mood === value) return;
    this.filterChange.emit({ ...this.filter, mood: value });
  }

  onReset(): void {
    this.resetClicked.emit();
  }
}
```

- [ ] **Step 2: Template**

`src/app/home/discovery-filter/discovery-filter.component.html`:

```html
<section class="hero-filter">
  <h1 class="filter-title">
    <span>What shall we play tonight?</span>
    <span class="match-count">
      <b>{{ matchCount }}</b> {{ matchCount === 1 ? 'game' : 'games' }} fit
      <span class="reset-link" (click)="onReset()">reset</span>
    </span>
  </h1>

  <div class="filter-line">
    <span class="filter-label">
      <mat-icon>group</mat-icon>
      <span>Players</span>
    </span>
    <div class="chip-row">
      <button
        type="button"
        class="chip"
        *ngFor="let opt of playerOptions"
        [class.active]="filter.players === opt.value"
        (click)="selectPlayers(opt.value)"
      >
        {{ opt.label }}
      </button>
    </div>
  </div>

  <div class="filter-line">
    <span class="filter-label">
      <mat-icon>schedule</mat-icon>
      <span>Time</span>
    </span>
    <div class="chip-row">
      <button
        type="button"
        class="chip"
        *ngFor="let opt of timeOptions"
        [class.active]="filter.timeMaxMinutes === opt.value"
        (click)="selectTime(opt.value)"
      >
        <span class="desktop-only">{{ opt.label }}</span>
        <span class="mobile-only">{{ opt.mobileLabel }}</span>
      </button>
    </div>
  </div>

  <div class="filter-line">
    <span class="filter-label">
      <mat-icon>auto_awesome</mat-icon>
      <span>Mood</span>
    </span>
    <div class="chip-row chip-row-scroll">
      <button
        type="button"
        class="chip"
        *ngFor="let opt of moodOptions"
        [class.active]="filter.mood === opt.value"
        (click)="selectMood(opt.value)"
      >
        <mat-icon *ngIf="iconService.iconForMood(opt.value)">{{ iconService.iconForMood(opt.value) }}</mat-icon>
        <span>{{ opt.label }}</span>
      </button>
    </div>
  </div>
</section>
```

- [ ] **Step 3: Styles**

`src/app/home/discovery-filter/discovery-filter.component.scss`:

```scss
.hero-filter {
  background: linear-gradient(135deg, var(--golgari-green, #006442) 0%, #1a3a2e 100%);
  color: #fff;
  padding: 18px 24px 16px;
  position: relative;
  overflow: hidden;

  &::before {
    content: '';
    position: absolute;
    inset: 0;
    background: radial-gradient(circle at 80% 20%, rgba(121, 194, 163, 0.22), transparent 50%);
    pointer-events: none;
  }

  @media (max-width: 768px) {
    padding: 14px 14px 12px;
  }
}

.filter-title {
  font-size: 22px;
  font-weight: 700;
  margin: 0 0 14px;
  letter-spacing: -0.2px;
  display: flex;
  align-items: baseline;
  justify-content: space-between;
  gap: 12px;
  flex-wrap: wrap;

  @media (max-width: 768px) {
    font-size: 16px;
    margin-bottom: 10px;
  }

  .match-count {
    font-size: 12px;
    font-weight: 500;
    opacity: 0.85;
    letter-spacing: 0;

    @media (max-width: 768px) {
      font-size: 10px;
    }

    b {
      font-weight: 700;
    }

    .reset-link {
      margin-left: 10px;
      text-decoration: underline;
      cursor: pointer;
      opacity: 0.7;

      &:hover {
        opacity: 1;
      }
    }
  }
}

.filter-line {
  display: flex;
  align-items: center;
  gap: 12px;
  margin-bottom: 8px;
  position: relative;

  &:last-of-type {
    margin-bottom: 0;
  }

  @media (max-width: 768px) {
    gap: 8px;
    margin-bottom: 6px;
  }
}

.filter-label {
  font-size: 10px;
  text-transform: uppercase;
  letter-spacing: 0.6px;
  opacity: 0.75;
  flex: 0 0 80px;
  font-weight: 600;
  display: flex;
  align-items: center;
  gap: 4px;

  mat-icon {
    font-size: 14px;
    width: 14px;
    height: 14px;
  }

  @media (max-width: 768px) {
    flex-basis: 60px;
    font-size: 9px;

    mat-icon {
      font-size: 12px;
      width: 12px;
      height: 12px;
    }
  }
}

.chip-row {
  display: flex;
  gap: 6px;
  flex: 1;
  flex-wrap: wrap;

  &.chip-row-scroll {
    flex-wrap: nowrap;
    overflow-x: auto;
    scrollbar-width: none;
    padding-bottom: 2px;

    &::-webkit-scrollbar {
      display: none;
    }
  }

  @media (max-width: 768px) {
    flex-wrap: nowrap;
    overflow-x: auto;
    scrollbar-width: none;
    gap: 4px;

    &::-webkit-scrollbar {
      display: none;
    }
  }
}

.chip {
  background: rgba(255, 255, 255, 0.10);
  border: 1px solid rgba(255, 255, 255, 0.18);
  border-radius: 14px;
  padding: 5px 12px;
  font-size: 12px;
  font-weight: 500;
  white-space: nowrap;
  color: #fff;
  cursor: pointer;
  display: inline-flex;
  align-items: center;
  gap: 4px;
  font-family: inherit;
  min-height: 32px;
  transition: background 0.15s ease, color 0.15s ease;

  &:hover {
    background: rgba(255, 255, 255, 0.18);
  }

  &.active {
    background: #fff;
    color: var(--golgari-green, #006442);
    border-color: #fff;
    font-weight: 700;
  }

  mat-icon {
    font-size: 13px;
    width: 13px;
    height: 13px;
  }

  @media (max-width: 768px) {
    font-size: 10.5px;
    padding: 4px 9px;
    min-height: 28px;

    mat-icon {
      font-size: 11px;
      width: 11px;
      height: 11px;
    }
  }
}

.desktop-only {
  display: inline;

  @media (max-width: 768px) {
    display: none;
  }
}

.mobile-only {
  display: none;

  @media (max-width: 768px) {
    display: inline;
  }
}
```

- [ ] **Step 4: Build**

Run: `npm run build`
Expected: succeeds.

- [ ] **Step 5: Commit**

```bash
git add src/app/home/discovery-filter/
git commit -m "feat(home): add DiscoveryFilterComponent (chip-row filter)"
```

---

## Task 7: DiscoveryResultsComponent

**Files:**
- Create: `src/app/home/discovery-results/discovery-results.component.ts`
- Create: `src/app/home/discovery-results/discovery-results.component.html`
- Create: `src/app/home/discovery-results/discovery-results.component.scss`

- [ ] **Step 1: Component class**

`src/app/home/discovery-results/discovery-results.component.ts`:

```ts
import { CommonModule } from '@angular/common';
import { Component, EventEmitter, Input, Output } from '@angular/core';
import { MatIconModule } from '@angular/material/icon';
import { GameGenre } from '../../models/game.model';
import { GenreIconService } from '../../services/genre-icon.service';
import { RankedGame } from '../home-filter.helpers';

@Component({
  selector: 'app-discovery-results',
  standalone: true,
  imports: [CommonModule, MatIconModule],
  templateUrl: './discovery-results.component.html',
  styleUrls: ['./discovery-results.component.scss'],
})
export class DiscoveryResultsComponent {
  @Input() rankedGames: RankedGame[] = [];
  @Output() gameSelected = new EventEmitter<string>();

  constructor(public iconService: GenreIconService) {}

  badgeClassFor(genre: GameGenre): string {
    const color = this.iconService.colorFor(genre);
    if (color === 'primary') return 'gb-primary';
    if (color === 'accent') return 'gb-accent';
    if (color === 'warn') return 'gb-warn';
    return 'gb-default';
  }

  trackById(_index: number, item: RankedGame): string {
    return item.game.id;
  }

  onSelect(gameId: string): void {
    this.gameSelected.emit(gameId);
  }
}
```

- [ ] **Step 2: Template**

`src/app/home/discovery-results/discovery-results.component.html`:

```html
<section class="results">
  <ng-container *ngIf="rankedGames.length > 0; else emptyState">
    <button
      type="button"
      class="game-row"
      *ngFor="let item of rankedGames; trackBy: trackById"
      (click)="onSelect(item.game.id)"
    >
      <div class="thumb" [style.backgroundImage]="item.game.imageUrl ? 'url(' + item.game.imageUrl + ')' : null">
        <mat-icon *ngIf="!item.game.imageUrl && item.primaryGenre">
          {{ iconService.iconFor(item.primaryGenre) }}
        </mat-icon>
      </div>

      <div class="meta">
        <div class="meta-top">
          <span class="title">{{ item.game.title }}</span>
          <span
            *ngIf="item.primaryGenre"
            class="genre-badge"
            [ngClass]="badgeClassFor(item.primaryGenre)"
          >
            <mat-icon>{{ iconService.iconFor(item.primaryGenre) }}</mat-icon>
            {{ item.primaryGenre }}
          </span>
          <span
            *ngIf="item.secondaryGenre"
            class="genre-badge secondary"
            [ngClass]="badgeClassFor(item.secondaryGenre)"
          >
            <mat-icon>{{ iconService.iconFor(item.secondaryGenre) }}</mat-icon>
            {{ item.secondaryGenre }}
          </span>
        </div>
        <div class="meta-bottom">
          <span class="meta-item">
            <mat-icon>group</mat-icon>
            {{ item.game.minPlayers }}–{{ item.game.maxPlayers }}
          </span>
          <span class="meta-item">
            <mat-icon>schedule</mat-icon>
            {{ item.game.playTime }}
          </span>
          <span class="meta-item" *ngIf="item.stats.totalComments > 0">
            <mat-icon>chat_bubble_outline</mat-icon>
            {{ item.stats.totalComments }}
          </span>
        </div>
      </div>

      <div class="right">
        <div class="rating">
          <mat-icon>star</mat-icon>
          <span *ngIf="item.stats.averageRating !== null">{{ item.stats.averageRating }}</span>
          <span *ngIf="item.stats.averageRating === null" class="no-rating">—</span>
        </div>
        <div class="like-count" *ngIf="item.stats.totalLikes > 0">
          <mat-icon>favorite</mat-icon>
          {{ item.stats.totalLikes }}
        </div>
      </div>
    </button>
  </ng-container>

  <ng-template #emptyState>
    <div class="empty-state">
      <mat-icon>search_off</mat-icon>
      <p>No games fit those constraints. Try widening the time or mood filter.</p>
    </div>
  </ng-template>
</section>
```

- [ ] **Step 3: Styles**

`src/app/home/discovery-results/discovery-results.component.scss`:

```scss
.results {
  padding: 14px 24px;

  @media (max-width: 768px) {
    padding: 10px 12px 8px;
  }
}

.game-row {
  background: #fff;
  border: 0;
  border-radius: 10px;
  padding: 11px 16px;
  display: flex;
  gap: 14px;
  margin-bottom: 6px;
  box-shadow: 0 1px 2px rgba(0, 0, 0, 0.05);
  align-items: center;
  width: 100%;
  cursor: pointer;
  text-align: left;
  font-family: inherit;
  transition: transform 0.15s ease, box-shadow 0.15s ease;

  &:hover {
    transform: translateY(-1px);
    box-shadow: 0 4px 10px rgba(0, 0, 0, 0.10);
  }

  &:focus-visible {
    outline: 2px solid var(--golgari-green, #006442);
    outline-offset: 2px;
  }

  @media (max-width: 768px) {
    padding: 8px 10px;
    gap: 10px;
  }
}

.thumb {
  width: 56px;
  height: 56px;
  border-radius: 6px;
  flex: 0 0 56px;
  background-color: #1a3a2e;
  background-size: cover;
  background-position: center;
  display: flex;
  align-items: center;
  justify-content: center;
  color: rgba(255, 255, 255, 0.85);

  mat-icon {
    font-size: 26px;
    width: 26px;
    height: 26px;
  }

  @media (max-width: 768px) {
    width: 44px;
    height: 44px;
    flex-basis: 44px;

    mat-icon {
      font-size: 22px;
      width: 22px;
      height: 22px;
    }
  }
}

.meta {
  flex: 1;
  min-width: 0;
}

.meta-top {
  display: flex;
  align-items: center;
  gap: 6px;
  flex-wrap: wrap;
}

.title {
  font-weight: 700;
  font-size: 14px;
  color: var(--text-primary, rgba(0, 0, 0, 0.87));

  @media (max-width: 768px) {
    font-size: 11px;
  }
}

.genre-badge {
  display: inline-flex;
  align-items: center;
  gap: 3px;
  font-size: 10px;
  font-weight: 700;
  padding: 3px 8px;
  border-radius: 10px;
  text-transform: uppercase;
  letter-spacing: 0.4px;
  flex-shrink: 0;

  &.secondary {
    opacity: 0.7;

    @media (max-width: 768px) {
      display: none;
    }
  }

  &.gb-primary {
    background: rgba(0, 100, 66, 0.15);
    color: #006442;
  }
  &.gb-accent {
    background: rgba(194, 24, 91, 0.15);
    color: #c2185b;
  }
  &.gb-warn {
    background: rgba(255, 152, 0, 0.18);
    color: #b66400;
  }
  &.gb-default {
    background: rgba(45, 45, 45, 0.10);
    color: #2d2d2d;
  }

  mat-icon {
    font-size: 11px;
    width: 11px;
    height: 11px;
  }

  @media (max-width: 768px) {
    font-size: 8.5px;
    padding: 2px 6px;

    mat-icon {
      font-size: 9px;
      width: 9px;
      height: 9px;
    }
  }
}

.meta-bottom {
  display: flex;
  align-items: center;
  gap: 12px;
  margin-top: 4px;
  font-size: 11px;
  color: var(--text-secondary, rgba(0, 0, 0, 0.54));

  @media (max-width: 768px) {
    font-size: 9.5px;
    gap: 8px;
  }
}

.meta-item {
  display: inline-flex;
  align-items: center;
  gap: 3px;

  mat-icon {
    font-size: 12px;
    width: 12px;
    height: 12px;
    opacity: 0.7;

    @media (max-width: 768px) {
      font-size: 10px;
      width: 10px;
      height: 10px;
    }
  }
}

.right {
  text-align: right;
  flex: 0 0 auto;
  display: flex;
  flex-direction: column;
  align-items: flex-end;
  gap: 3px;
}

.rating {
  font-weight: 700;
  font-size: 18px;
  color: var(--golgari-green, #006442);
  line-height: 1;
  display: inline-flex;
  align-items: center;
  gap: 3px;

  mat-icon {
    font-size: 16px;
    width: 16px;
    height: 16px;
    color: #ffd700;
  }

  .no-rating {
    color: rgba(0, 0, 0, 0.38);
    font-weight: 500;
    font-size: 14px;
  }

  @media (max-width: 768px) {
    font-size: 14px;

    mat-icon {
      font-size: 12px;
      width: 12px;
      height: 12px;
    }
  }
}

.like-count {
  font-size: 11px;
  color: #c2185b;
  display: inline-flex;
  align-items: center;
  gap: 3px;

  mat-icon {
    font-size: 12px;
    width: 12px;
    height: 12px;
  }

  @media (max-width: 768px) {
    font-size: 10px;
  }
}

.empty-state {
  text-align: center;
  padding: 32px 16px;
  color: var(--text-secondary, rgba(0, 0, 0, 0.54));

  mat-icon {
    font-size: 32px;
    width: 32px;
    height: 32px;
    opacity: 0.5;
    margin-bottom: 8px;
  }

  p {
    margin: 0;
    font-size: 14px;
  }
}
```

- [ ] **Step 4: Build**

Run: `npm run build`
Expected: succeeds.

- [ ] **Step 5: Commit**

```bash
git add src/app/home/discovery-results/
git commit -m "feat(home): add DiscoveryResultsComponent (ranked game list)"
```

---

## Task 8: ActivityStripComponent

**Files:**
- Create: `src/app/home/activity-strip/activity-strip.component.ts`
- Create: `src/app/home/activity-strip/activity-strip.component.html`
- Create: `src/app/home/activity-strip/activity-strip.component.scss`

- [ ] **Step 1: Component class**

`src/app/home/activity-strip/activity-strip.component.ts`:

```ts
import { CommonModule } from '@angular/common';
import { Component, EventEmitter, Input, Output } from '@angular/core';
import { MatIconModule } from '@angular/material/icon';
import { ActivityItem, ActivityType } from '../home-filter.helpers';

@Component({
  selector: 'app-activity-strip',
  standalone: true,
  imports: [CommonModule, MatIconModule],
  templateUrl: './activity-strip.component.html',
  styleUrls: ['./activity-strip.component.scss'],
})
export class ActivityStripComponent {
  @Input() items: ActivityItem[] = [];
  @Output() gameSelected = new EventEmitter<string>();

  iconFor(type: ActivityType): string {
    switch (type) {
      case 'rating':
        return 'star';
      case 'comment':
        return 'chat_bubble_outline';
      case 'like':
        return 'favorite';
    }
  }

  verbFor(type: ActivityType): string {
    switch (type) {
      case 'rating':
        return 'rated';
      case 'comment':
        return 'commented on';
      case 'like':
        return 'liked';
    }
  }

  trackByIndex(i: number): number {
    return i;
  }

  onSelect(gameId: string): void {
    this.gameSelected.emit(gameId);
  }
}
```

- [ ] **Step 2: Template**

`src/app/home/activity-strip/activity-strip.component.html`:

```html
<section class="activity-strip" *ngIf="items.length > 0">
  <div class="strip-title">
    <mat-icon>timeline</mat-icon>
    <span>Latest from the table</span>
  </div>

  <button
    type="button"
    class="activity-item"
    *ngFor="let item of items; trackBy: trackByIndex"
    (click)="onSelect(item.gameId)"
  >
    <span class="ic" [ngClass]="'ic-' + item.type">
      <mat-icon>{{ iconFor(item.type) }}</mat-icon>
    </span>
    <span class="text">
      <b>{{ item.username }}</b>
      {{ verbFor(item.type) }}
      <b>{{ item.gameTitle }}</b>
      <span *ngIf="item.detail" class="detail"> — {{ item.detail }}</span>
    </span>
  </button>
</section>
```

- [ ] **Step 3: Styles**

`src/app/home/activity-strip/activity-strip.component.scss`:

```scss
.activity-strip {
  background: #fff;
  border-top: 1px solid rgba(0, 0, 0, 0.08);
  padding: 12px 24px;

  @media (max-width: 768px) {
    padding: 9px 12px;
  }
}

.strip-title {
  font-size: 10px;
  text-transform: uppercase;
  letter-spacing: 0.6px;
  color: var(--text-secondary, rgba(0, 0, 0, 0.54));
  font-weight: 600;
  margin-bottom: 6px;
  display: flex;
  align-items: center;
  gap: 4px;

  mat-icon {
    font-size: 12px;
    width: 12px;
    height: 12px;
  }
}

.activity-item {
  background: transparent;
  border: 0;
  padding: 4px 0;
  width: 100%;
  display: flex;
  align-items: center;
  gap: 8px;
  cursor: pointer;
  font-family: inherit;
  text-align: left;
  font-size: 11.5px;
  color: var(--text-primary, rgba(0, 0, 0, 0.87));
  line-height: 1.4;

  &:hover {
    .text { text-decoration: underline; text-decoration-color: rgba(0, 100, 66, 0.3); }
  }

  &:focus-visible {
    outline: 2px solid var(--golgari-green, #006442);
    outline-offset: 2px;
    border-radius: 4px;
  }

  @media (max-width: 768px) {
    font-size: 10px;
    gap: 6px;
  }
}

.ic {
  width: 22px;
  height: 22px;
  border-radius: 50%;
  display: flex;
  align-items: center;
  justify-content: center;
  flex-shrink: 0;
  color: #fff;

  mat-icon {
    font-size: 12px;
    width: 12px;
    height: 12px;
  }

  @media (max-width: 768px) {
    width: 18px;
    height: 18px;

    mat-icon {
      font-size: 10px;
      width: 10px;
      height: 10px;
    }
  }
}

.ic-rating { background: #ffb300; }
.ic-comment { background: #1976d2; }
.ic-like { background: #c2185b; }

.text {
  flex: 1;
  min-width: 0;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;

  b {
    color: var(--golgari-green, #006442);
    font-weight: 700;
  }

  .detail {
    color: var(--text-secondary, rgba(0, 0, 0, 0.54));
    font-style: italic;
  }
}
```

- [ ] **Step 4: Build**

Run: `npm run build`
Expected: succeeds.

- [ ] **Step 5: Commit**

```bash
git add src/app/home/activity-strip/
git commit -m "feat(home): add ActivityStripComponent"
```

---

## Task 9: Rewrite HomeComponent

**Files:**
- Modify: `src/app/home/home.component.ts`
- Modify: `src/app/home/home.component.html`
- Modify: `src/app/home/home.component.scss`

- [ ] **Step 1: Rewrite `home.component.ts`**

Replace the entire contents of `src/app/home/home.component.ts` with:

```ts
import { CommonModule } from '@angular/common';
import { Component, OnDestroy, OnInit } from '@angular/core';
import { Router } from '@angular/router';
import { MatDialog } from '@angular/material/dialog';
import { BehaviorSubject, combineLatest, Subscription } from 'rxjs';
import { map } from 'rxjs/operators';
import { GameDetailsDialogComponent } from '../game-details-dialog/game-details-dialog.component';
import { Game } from '../models/game.model';
import { DataAggregationService } from '../services/data-aggregation.service';
import { GamesService } from '../services/games.service';
import { ActivityStripComponent } from './activity-strip/activity-strip.component';
import { DiscoveryFilterComponent } from './discovery-filter/discovery-filter.component';
import { DiscoveryResultsComponent } from './discovery-results/discovery-results.component';
import {
  ActivityItem,
  buildActivityItems,
  rankGames,
  RankedGame,
} from './home-filter.helpers';
import {
  DEFAULT_HOME_FILTER,
  HOME_FILTER_STORAGE_KEY,
  HomeFilter,
} from './home-filter.model';

@Component({
  selector: 'app-home',
  standalone: true,
  imports: [
    CommonModule,
    DiscoveryFilterComponent,
    DiscoveryResultsComponent,
    ActivityStripComponent,
  ],
  templateUrl: './home.component.html',
  styleUrls: ['./home.component.scss'],
})
export class HomeComponent implements OnInit, OnDestroy {
  private readonly filterSubject = new BehaviorSubject<HomeFilter>(this.loadInitialFilter());

  filter: HomeFilter = this.filterSubject.value;
  rankedGames: RankedGame[] = [];
  activityItems: ActivityItem[] = [];

  private subscriptions = new Subscription();

  constructor(
    private gamesService: GamesService,
    private dataAggregation: DataAggregationService,
    private dialog: MatDialog,
    private router: Router,
  ) {}

  ngOnInit(): void {
    document.body.className = 'home-page';

    const dataSub = combineLatest([
      this.gamesService.getGames(),
      this.dataAggregation.allComments$,
      this.dataAggregation.allRatings$,
      this.dataAggregation.allLikes$,
      this.filterSubject,
    ])
      .pipe(
        map(([games, comments, ratings, likes, filter]) => {
          const ranked = rankGames(games, filter, comments, ratings, likes);
          const gameById = new Map<string, Game>(games.map((g) => [g.id, g]));
          const limit = window.matchMedia('(max-width: 768px)').matches ? 2 : 3;
          const activity = buildActivityItems(comments, ratings, likes, gameById, limit);
          return { ranked, activity };
        }),
      )
      .subscribe(({ ranked, activity }) => {
        this.rankedGames = ranked;
        this.activityItems = activity;
      });

    this.subscriptions.add(dataSub);
  }

  ngOnDestroy(): void {
    document.body.className = '';
    this.subscriptions.unsubscribe();
  }

  onFilterChange(filter: HomeFilter): void {
    this.filter = filter;
    this.filterSubject.next(filter);
    this.persistFilter(filter);
  }

  onResetFilter(): void {
    this.onFilterChange(DEFAULT_HOME_FILTER);
  }

  onGameSelected(gameId: string): void {
    const game = this.rankedGames.find((r) => r.game.id === gameId)?.game
      ?? this.gamesService.getGameById(gameId);
    if (!game) return;
    this.dialog.open(GameDetailsDialogComponent, {
      data: game,
      width: '900px',
      maxWidth: '95vw',
    });
  }

  private loadInitialFilter(): HomeFilter {
    try {
      const raw = localStorage.getItem(HOME_FILTER_STORAGE_KEY);
      if (!raw) return DEFAULT_HOME_FILTER;
      const parsed = JSON.parse(raw) as HomeFilter;
      if (
        typeof parsed.players === 'number' &&
        (parsed.timeMaxMinutes === null || typeof parsed.timeMaxMinutes === 'number') &&
        typeof parsed.mood === 'string'
      ) {
        return parsed;
      }
      return DEFAULT_HOME_FILTER;
    } catch {
      return DEFAULT_HOME_FILTER;
    }
  }

  private persistFilter(filter: HomeFilter): void {
    try {
      localStorage.setItem(HOME_FILTER_STORAGE_KEY, JSON.stringify(filter));
    } catch {
      // Storage unavailable (private mode etc.) — silently ignore.
    }
  }
}
```

Note: `dialog.open(...)` arguments above match the existing usage at `src/app/games/games.component.ts:127-130` — `data: game` (the Game object, not wrapped), `width: '900px'`, `maxWidth: '95vw'`.

- [ ] **Step 2: (Removed — dialog args already match existing callsite.)**

- [ ] **Step 3: Rewrite `home.component.html`**

Replace the entire contents of `src/app/home/home.component.html` with:

```html
<div class="home-container">
  <app-discovery-filter
    [filter]="filter"
    [matchCount]="rankedGames.length"
    (filterChange)="onFilterChange($event)"
    (resetClicked)="onResetFilter()"
  ></app-discovery-filter>

  <app-discovery-results
    [rankedGames]="rankedGames"
    (gameSelected)="onGameSelected($event)"
  ></app-discovery-results>

  <app-activity-strip
    [items]="activityItems"
    (gameSelected)="onGameSelected($event)"
  ></app-activity-strip>
</div>
```

- [ ] **Step 4: Rewrite `home.component.scss`**

Replace the entire contents of `src/app/home/home.component.scss` with:

```scss
.home-container {
  max-width: 1200px;
  margin: 0 auto;
  background: var(--background-primary, #fafafa);
  min-height: calc(100vh - var(--navbar-height, 64px));
  display: flex;
  flex-direction: column;
}
```

- [ ] **Step 5: Build and lint**

Run: `npm run build && npm run lint`
Expected: both succeed.

- [ ] **Step 6: Manual verification**

Run: `npm start`. Open http://localhost:4200/home. Verify:
- Filter hero shows with default selections (5 / ≤2 hours / Any).
- Match count in title matches the number of result rows.
- Each filter chip toggles single-selected; clicking another option in the same row deselects the previous.
- Reset link returns to defaults `5 / ≤2h / Any`.
- Refresh page — last-used filter persists.
- Result rows show genre badge with correct icon and color, and the rating/likes/comments numbers match the stats.
- Clicking a result row opens the existing game-details dialog.
- Activity strip shows 2-3 latest items, each clickable into the dialog.
- Empty state appears when filter excludes all games (e.g., set Players=7+, Time=≤30m, Mood=Heavy).
- Mobile view (Chrome DevTools, 375px width): filter header is compact (~140px), Mood chip row scrolls horizontally, secondary genre badges hidden, two activity items shown.
- `/games` and details dialog still look identical to before.

Stop dev server.

- [ ] **Step 7: Commit**

```bash
git add src/app/home/home.component.ts src/app/home/home.component.html src/app/home/home.component.scss
git commit -m "feat(home): rewrite home page as discovery tool"
```

---

## Task 10: Final verification & cleanup

**Files:** none new

- [ ] **Step 1: Search for stale references**

Run: `grep -rn "getGenreIcon\|getGenreColor\|Welcome to the Golgari" src/`
Expected: empty output. (The greeting copy and the duplicated methods should all be gone.)

- [ ] **Step 2: Production build**

Run: `npm run build:prod`
Expected: build succeeds, `docs/` is populated, `index.html` exists at `docs/index.html` (flatten step ran).

- [ ] **Step 3: Lint**

Run: `npm run lint`
Expected: zero errors.

- [ ] **Step 4: Cross-page smoke test**

Run: `npm start`. Visit `/home`, `/games`, click a game card to open the dialog, close it, navigate between routes via the navbar. No console errors. All three icon contexts (home filter, home result rows, /games chips, dialog chips) render Material Icons consistently.

Stop dev server.

- [ ] **Step 5: Bump version & patch notes**

The `bump-version` skill exists in this project for end-of-task version bumps. If the user wants a deploy-ready commit, run that skill (or manually bump `package.json` version + add a patch-notes entry). Otherwise leave the version untouched.

- [ ] **Step 6: Verify final git state**

Run: `git status && git log --oneline -10`
Expected: working tree clean, recent commits include all 10 task commits in order.

---

## Self-review notes

- All 28 `GameGenre` values are present in both `GenreIconService.genreIcons` and `GenreIconService.genreColors` (Task 2). The keyed-by-enum `Record<GameGenre, ...>` type forces exhaustive coverage.
- Every method/symbol referenced across tasks is defined in an earlier task: `GenreIconService.iconFor/colorFor/iconForMood` (Task 2) used in Tasks 3, 4, 6, 7; `RankedGame` and `ActivityItem` (Task 5) used in Tasks 7, 8, 9; `HOME_FILTER_STORAGE_KEY` and `DEFAULT_HOME_FILTER` (Task 1) used in Task 9.
- Spec coverage check:
  - Filter inputs (Players/Time/Mood) — Task 6 component + Task 1 model
  - Smart defaults + localStorage persistence — Task 9
  - Live match count — passed as `matchCount` input from Task 9 to Task 6
  - Sort order (rating desc → likes desc → title asc) — `rankGames` in Task 5
  - Empty state — Task 7 template
  - `playTime` parser — Task 5 (`parseMinPlayMinutes`)
  - Mood→Genre clusters — Task 1 (`MOOD_TO_GENRES`)
  - Activity strip composition — Task 5 (`buildActivityItems`) + Task 8
  - Mobile responsive — SCSS in Tasks 6, 7, 8
  - Removed code — old home template/styles in Task 9, duplicate methods in Tasks 3 & 4
  - Shared GenreIconService — Task 2, with Tasks 3 & 4 proving consumption
- Open spec items deferred (per spec's "Open questions"): mood cluster fine-tuning, mobile activity-item detail snippet — neither blocks this plan.
