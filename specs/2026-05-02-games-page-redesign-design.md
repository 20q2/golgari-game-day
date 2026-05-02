# Games Page Redesign — Design Spec

**Date:** 2026-05-02
**Status:** Draft, awaiting user review
**Visual reference:** `.superpowers/brainstorm/31705-1777737356/content/design-mockup-v2.html`

## Goal

Replace the current `/games` page — a wall of filters above a grid of busy Material cards — with a discovery surface that feels like a destination. The job of this page is *finding a game in the collection*, not driving discussion (discussion lives in the home page activity hub and the per-game detail dialog).

A visitor should be able to land on the page, immediately see something visually compelling (the most-loved game), and either type to find a specific title or tap a single chip to filter by genre. Heavier filters are one tap away in a sheet, not always in your face.

## Non-goals

- No backend changes. The page reads `GamesService.getGames()` and `DataAggregationService.getAllGamesStats()` exactly as today.
- No auth / identity changes — anonymous user model stays.
- No new sort dimensions. The existing sort options stay, but the dropdown moves into the filter sheet (search + genre is enough on the surface).
- No changes to `GameDetailsDialogComponent` (the per-game modal). Card click still opens it.
- The home page redesign (separate spec) is not modified.
- No infinite scroll / pagination. The collection is small (~40 games); render them all.

## User-facing behavior

The page is a single vertical flow on every viewport:

1. **Title block** — small uppercase eyebrow `GOLGARI PALACE` + h1 `The Collection` + a count: `42 games`. Replaces "🎯 Game Inventory".
2. **Sticky search/filter bar** — sticks to the top of the viewport once the user scrolls past the title. Always reachable.
3. **Genre chip row** — horizontally scrolling on mobile, wrapping on desktop. The first chip is `All N`. Then the top 6 most-populated genres (ranked by how many games carry that genre tag in the catalog), each showing its count. A trailing `+N more` chip opens the filter sheet to the full genre list.
4. **Hero card** — the "most-loved" game (highest `totalLikes` from `getAllGamesStats()`, ties broken by BGG rating descending, then alphabetical). Tap → opens `GameDetailsDialogComponent`. If no game has any likes yet, fall back to the highest-BGG-rated game; the badge label changes accordingly (see Empty / sparse states).
5. **Section label** — small uppercase `ALL GAMES` (or `RESULTS` when filters are active — see Filtered behavior).
6. **Game list / grid** — the layout flips by viewport (see Responsive behavior). Tap a row/tile → opens the dialog.

### Search and filter interaction

- **Search** is a controlled input bound to the existing `searchText` filter on `GamesService`. Types → list updates as today.
- **Genre chips** in the surface row are single-select for now (tap one to scope to that genre, tap again to clear, tap another to switch). This is a deliberate simplification from the current multi-select chip cloud — multi-select is still available in the filter sheet for power users. *Confirm during review whether single-select is acceptable; if not, the surface chips become multi-select.*
- **Filter sheet** opens from the gear button next to search. On mobile it's a bottom sheet (Material `MatBottomSheet`); on desktop it's a side panel (Material `MatDialog` with `panelClass: 'filter-sheet'`). The sheet contains:
  - Sort (the existing `SortOrder` dropdown)
  - Duration (the existing `GameDuration` dropdown)
  - Player count (the existing `supportedPlayers` numeric input)
  - Full genre multi-select (all 28 genres with counts; `selected` state syncs with the surface chip)
  - "Clear all filters" button
  - "Done" button to close
- **Filter count badge** — the gear button shows a yellow badge with the number of active non-search filters (genre + duration + player count). Hidden when zero. Search is intentionally excluded from the count because the search input itself is visible in the bar — the count is a hint that *hidden* filters are active.
- **Active genre chip** is highlighted in solid Golgari green; the `All N` chip is also highlighted when no genre is selected. State is mutually exclusive among the surface chips; it stays in sync with the sheet's multi-select. When the sheet has multiple genres selected, the surface row shows a generic "Multiple genres" pill in the slot where a single chip would highlight.

### Persistence

- Filter state (genres, duration, player count, sort) persists to `localStorage` key `gameday-games-filter` on every change. This mirrors the home page's pattern (`gameday-home-filter`).
- Search text does **not** persist. Landing on the page with a stale search applied feels broken. It resets each visit.
- On load: read the saved filter, parse-and-fall-back-to-empty on failure.

### Filtered behavior

"Filtered" here means the user has narrowed the catalog by *any* signal — search text, genre, duration, or player count. (This is broader than the gear-button badge, which counts hidden filters only.) When filtered:

- The hero card is **hidden**. Featuring "most-loved" is irrelevant once the user has narrowed scope.
- Section label changes to `RESULTS` and shows the count: `7 results`.
- Empty results: a single neutral row — `No games match those filters.` — and a `Clear filters` link button. No illustration.

### Empty / sparse states

- **No games at all** (catalog empty): unlikely in practice but render `The collection is empty.` in the section. No hero.
- **No likes anywhere yet**: hero falls back to highest-BGG-rated game. Badge text changes from `♥ MOST LOVED` to `★ TOP RATED`. (No likes data is the realistic state today, so this needs to look intentional.)
- **Stats not yet loaded** (initial render before `DataAggregationService` finishes its bulk fetch): hero shows the highest-BGG-rated game with the `★ TOP RATED` badge. Once stats arrive, the hero swaps to the most-loved game if a winner exists. Brief flicker is acceptable; do not block render on the bulk fetch.

## Responsive behavior

The component renders the same data in two layouts based on viewport, decided at the CSS-grid level:

- **Mobile (< 768px)** — `LIST ROWS` below the hero. Each row: 56×72 box-art thumb, title (truncates to one line), genres (e.g. `Strategy · Engine Building`, max two genres shown), `min–max · time`, and on the right column: rating (★ 8.1) and a small `♥ likes · 💬 comments` line. Comment / like counts hidden when zero.
- **Tablet (768–1023px)** — 3-column `TILE GRID`. Each tile: 3:4 box art with a bottom gradient overlay containing title and `★ rating · min–max`.
- **Desktop (≥ 1024px)** — 5-column `TILE GRID`, same tile shape as tablet.

The decision is purely CSS — the same Angular component renders both, with a `<ul class="games-list">` whose children adapt via media queries on the `.games-list-item` class. No `*ngIf` on viewport. The hero card uses an `aspect-ratio` that flexes from `16/10` on mobile to `21/9` on desktop.

## Visual identity

The page adopts a dark Golgari theme even though the rest of the site is light. This is contained — only `/games` flips. Implementation: the existing `body.games-page` className hook (set in `GamesComponent.ngOnInit`) gates the dark theme via global SCSS rules, so the navbar adapts but other routes are unaffected.

Tokens (added to global theme alongside existing `--golgari-green` etc.):

- `--games-bg`: `linear-gradient(180deg, #0a1410 0%, #131c16 60%, #1a2a20 100%)`
- `--games-surface`: `rgba(255, 255, 255, 0.04)` (cards, list rows)
- `--games-surface-border`: `rgba(255, 255, 255, 0.06)`
- `--games-text-primary`: `#e0e8e2`
- `--games-text-secondary`: `#8aa898`
- `--games-text-muted`: `#6a8a7a`
- `--games-accent`: `#4a8a6a` (icons, eyebrow, search border at rest)
- `--games-action`: `#006442` (primary green — `golgari-green`, reused)
- `--games-action-hover`: `#008055`

The hero badge uses a green→teal gradient (`#006442 → #008055`) with a pink heart glyph (`#ff6090`) for "MOST LOVED" or a gold star (`#ffd700`) for "TOP RATED" fallback.

## Component decomposition

The current page is one big `GamesComponent` with all template logic inline. The redesign keeps a single root component but extracts focused presentational children:

```
GamesComponent (orchestrates state, owns filter, hosts hero/list)
├── GamesSearchBarComponent (sticky bar — search input + filter button + active count badge)
├── GamesGenreStripComponent (horizontal chip row — top genres + +N more)
├── GamesHeroComponent (most-loved / top-rated card)
├── GamesListComponent (renders rows on mobile, tiles on tablet/desktop)
└── GamesFilterSheetComponent (bottom sheet on mobile / side panel on desktop)
```

All standalone Angular components, all under `src/app/games/`. The current `games.component.{html,scss,ts}` becomes the orchestration shell; the existing `GameDetailsDialogComponent` is unchanged.

### `GamesComponent` (host)

- Owns the active `GameFilter`, `searchText`, `selectedGenres: GameGenre[]`, `selectedDuration`, `currentSort`.
- Subscribes to `gamesService.getGames()` (already reactive to filter changes) and feeds the result to `GamesListComponent`.
- Subscribes to `DataAggregationService.getAllGamesStats()` once for hero selection (combineLatest with the catalog).
- Computes `topGenres: { genre: GameGenre; count: number }[]` from the unfiltered catalog (taken at startup; doesn't react to filters). `count` is the number of distinct games whose `genres` array contains that genre. Top 6 by count, ties broken alphabetically. Used by the strip; the sheet's full multi-select shows all 28 with the same counts.
- Reads/writes the filter to `localStorage` key `gameday-games-filter` (mirrors home's pattern). Excludes `searchText` (see Persistence above).
- On filter mutation: updates `GamesService.setFilter(...)`; the `games$` observable emits and the list re-renders.
- Opens the dialog via `MatDialog.open(GameDetailsDialogComponent, ...)` — same call site as today, factored into a single method that all child clicks bubble up to.

### `GamesSearchBarComponent`

`@Input() searchText`, `@Input() activeFilterCount: number`, `@Output() searchChange`, `@Output() openFilters`. Pure presentation. Sticky positioning is its own concern — `position: sticky; top: 0;` with a backdrop-blurred translucent background so content scrolls behind it.

### `GamesGenreStripComponent`

`@Input() topGenres: { genre: GameGenre; count: number }[]`, `@Input() totalCount: number`, `@Input() selectedGenre: GameGenre | null`, `@Output() selectGenre: EventEmitter<GameGenre | null>` (null = "All"), `@Output() openFilters`. Click on `+N more` emits `openFilters`. No internal state.

### `GamesHeroComponent`

`@Input() game: Game | null`, `@Input() variant: 'most-loved' | 'top-rated'`, `@Input() likeCount: number`, `@Output() open: EventEmitter<Game>`. Hidden by `*ngIf="game && !filtered"` from the parent.

### `GamesListComponent`

`@Input() games: Game[]`, `@Input() statsById: Record<string, GameStats>` (so it can render likes/comments without re-deriving), `@Output() open: EventEmitter<Game>`. Renders the same `<li>` elements; CSS decides if they're rows or tiles. Uses `trackBy: game.id`.

### `GamesFilterSheetComponent`

Opened imperatively by the host via `MatBottomSheet` (mobile) or `MatDialog` (desktop) — the host picks the right service based on a `BreakpointObserver` check at click time. Receives the current filter state as data, returns a new filter on close (or `null` if dismissed unchanged). Contains: sort, duration, player count, full genre multi-select, "Clear all", "Done". The decision to use `MatBottomSheet` vs `MatDialog` is purely about animation/positioning; the inner content component is the same.

## Data shapes

No new model types. Existing `Game`, `GameFilter`, `SortOrder`, `GameDuration`, `GameStats` cover everything. The host component derives:

```ts
interface HeroSelection {
  game: Game;
  variant: 'most-loved' | 'top-rated';
  likeCount: number; // 0 in 'top-rated' variant
}

interface GenreCount {
  genre: GameGenre;
  count: number; // # of games carrying that genre
}
```

Both are local to `GamesComponent` (or a small pure helper file `games.utils.ts` next to the component). They do not enter `GamesService`.

## Out-of-scope changes that this design depends on

None. Every piece of data this design needs already exists in `GamesService` and `DataAggregationService`.

## Risks and tradeoffs

- **Single-select genre on the surface row** is a deliberate simplification that may surprise users who currently rely on multi-select. Mitigation: the filter sheet still supports multi-select; the surface chip reflects the most recently selected genre when the sheet has multiple. If review feedback rejects this, the surface chips become multi-select with a different "selected" treatment (the all-or-one model is just visually cleaner).
- **Two layouts in one component** (rows vs tiles) means duplicated markup paths or CSS that hides/shows different children. Going with CSS-only switching keeps the JS simple; cost is slightly more SCSS. Acceptable.
- **Dark theme on one route** — relies on a body className gate. Already an established pattern (`body.games-page` is set today). Theming tokens are scoped under `body.games-page` selectors so they don't bleed.
- **Hero falls back to "top rated"** when likes are sparse, which describes today's reality. The badge change makes the fallback feel intentional rather than buggy. Once likes accumulate the page transitions to "most loved" silently.

## Open question for review

- Single-select vs multi-select for the surface genre chip row. Default in this spec is single-select (cleaner). Confirm or override.

## Files anticipated to change

- `src/app/games/games.component.ts` — orchestration shell, hero selection logic, filter persistence, sheet opening.
- `src/app/games/games.component.html` — replaced top-to-bottom with the new layout.
- `src/app/games/games.component.scss` — replaced; introduces `body.games-page` dark theme and responsive list/tile/hero layout.
- `src/app/games/games-search-bar/` — new standalone component (3 files).
- `src/app/games/games-genre-strip/` — new (3 files).
- `src/app/games/games-hero/` — new (3 files).
- `src/app/games/games-list/` — new (3 files).
- `src/app/games/games-filter-sheet/` — new (3 files).
- `src/app/games/games.utils.ts` — pure helpers for `pickHero(games, stats)` and `topGenres(games, n)`.
- `src/styles.scss` (or wherever theme tokens live) — adds the `--games-*` tokens scoped under `body.games-page`.
- No changes to services, models, or the dialog component.
