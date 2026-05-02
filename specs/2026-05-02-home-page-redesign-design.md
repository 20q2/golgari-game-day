# Home Page Redesign — Design Spec

**Date:** 2026-05-02
**Status:** Draft, awaiting user review
**Visual reference:** `.superpowers/brainstorm/9773-1777735062/content/composition-v4.html`

## Goal

Replace the current home page — three redundant CTAs and a hard-coded "Next Game Day" — with a discovery tool that answers the actual game-night question: *"What should we play tonight?"*

A visitor should be able to set "how many of us / how long we've got / what kind of game" and immediately see the games in the collection that fit, ranked by group rating.

## Non-goals

- Real "next game day" feature (RSVPs, real dates) — out of scope; the placeholder card is removed, not rebuilt.
- Auth changes — anonymous user model stays.
- Backend changes — uses existing `DataAggregationService` data; no new endpoints.
- Photos page changes — only the redundant home-page card linking to it is removed; nav link stays.
- New filter dimensions on the `/games` page — that page keeps its existing filter UX.

## User-facing behavior

The page is a single vertical flow:

1. **Header bar** (existing navbar) — Home / Games / Photos.
2. **Filter hero** — green Golgari gradient panel with title `What shall we play tonight?` + live match count. Three rows:
   - **Players** — single-select chips: `2 / 3 / 4 / 5 / 6 / 7+`. Filter matches games where `minPlayers ≤ N ≤ maxPlayers` (with `7+` meaning `maxPlayers ≥ 7`).
   - **Time** — single-select chips: `≤30 min / ≤1 hour / ≤2 hours / Any`. Ceiling semantics: a game qualifies if its *minimum* `playTime` is ≤ the chosen ceiling.
   - **Mood** — single-select chips: `Any / Strategy / Party / Family / Co-op / Heavy / Card`. Each mood maps to one or more underlying `GameGenre`s (see Mood → Genre Clusters below). A game qualifies if any of its `genres` intersects the mood's cluster. Mobile scrolls horizontally.
3. **Results list** — ranked, one row per game. Row shows thumbnail, title, primary + secondary genre badge (color + icon), `group · clock · comment-count` metadata, and on the right: group rating (`star + 8.4`) and likes (`heart + 7`). Tap → existing `Games` detail dialog.
4. **Activity strip** — `Latest from the table` thin row at the bottom. Top 3 most recent items across comments + ratings + likes, with leading colored circular icon (yellow star / blue chat / pink heart).

### Defaults & persistence

- On first load: `Players=5, Time=≤2 hours, Mood=Any`. Picked because they roughly match a typical Saturday afternoon at the palace.
- Subsequent loads: read last-used filter from `localStorage` key `gameday-home-filter`. If parse fails, fall back to first-load defaults.
- Filter changes persist to `localStorage` as the user clicks chips.
- "Reset" link clears the stored value and re-applies first-load defaults.

### Empty state

If 0 games match: show a single neutral row in the results area — `No games fit those constraints. Try widening the time or mood filter.` — no illustration, no CTA. Activity strip remains visible below.

### Sort

Results are sorted by **group rating descending**, ties broken by **like count descending**, then **title ascending**. Games with no group rating appear after games with one. (No user-facing sort control in v1 — keep the page focused. Sort indicator is shown in the header for transparency: `14 games fit · sorted by group rating`.)

## Component decomposition

```
HomeComponent (orchestrates state, owns filter)
├── DiscoveryFilterComponent (chip rows, emits filter changes)
├── DiscoveryResultsComponent (renders ranked list)
└── ActivityStripComponent (latest comments/ratings/likes)
```

Each is a standalone Angular component (project convention). All live under `src/app/home/`.

### `HomeComponent`

- Holds the active `HomeFilter` value as a signal/`BehaviorSubject`.
- On init: reads `localStorage` filter, falls back to defaults.
- Subscribes to `GamesService.getGames()` + `DataAggregationService.getAllGamesStats()` and combines them into a `RankedGame[]` via a pure helper. Re-runs on filter changes.
- Subscribes to `DataAggregationService` raw streams for the activity strip.
- On filter change: computes new ranked list, persists filter to `localStorage`.

### `DiscoveryFilterComponent`

Pure presentational. `@Input() filter: HomeFilter`. `@Output() filterChange: EventEmitter<HomeFilter>`. Renders the three chip rows + title + match count. The match count is passed in as `@Input() matchCount: number` — component is dumb about *what* matched.

### `DiscoveryResultsComponent`

`@Input() games: RankedGame[]`. Renders the ranked list. On row click, opens existing `GameDetailsDialogComponent` (already exported from `/games`). No internal state.

### `ActivityStripComponent`

`@Input() items: ActivityItem[]`. Renders the bottom strip with type-keyed colored icon badges. `ActivityItem` is a small union: `{ type: 'rating' | 'comment' | 'like'; username: string; gameTitle: string; gameId: string; detail?: string; timestamp: Date }`. Composition lives in `HomeComponent` (or a tiny pure helper in the service); the strip just renders.

## Data shapes

```ts
// New, in src/app/home/home-filter.model.ts
export type PlayerCountFilter = 2 | 3 | 4 | 5 | 6 | 7;       // 7 represents "7+"
export type TimeBucket = 30 | 60 | 120 | null;               // null = "Any"
export type MoodFilter = 'any' | 'strategy' | 'party' | 'family' | 'coop' | 'heavy' | 'card';

export interface HomeFilter {
  players: PlayerCountFilter;
  timeMaxMinutes: TimeBucket;
  mood: MoodFilter;
}

// Existing GameStats from DataAggregationService is reused.
// New combined view-model:
export interface RankedGame {
  game: Game;
  stats: GameStats;       // group rating, comment count, like count
  primaryGenre: GameGenre; // first match used for badge color
  secondaryGenre?: GameGenre;
}
```

## Mood → Genre Clusters

A new shared mapping. Lives next to the icon dictionary (see below).

```ts
export const MOOD_TO_GENRES: Record<Exclude<MoodFilter,'any'>, GameGenre[]> = {
  strategy: [GameGenre.STRATEGY, GameGenre.EURO, GameGenre.AREA_CONTROL, GameGenre.ENGINE_BUILDING],
  party:    [GameGenre.PARTY, GameGenre.SOCIAL_DEDUCTION, GameGenre.BLUFFING, GameGenre.DRINKING, GameGenre.DEXTERITY],
  family:   [GameGenre.FAMILY, GameGenre.ABSTRACT, GameGenre.MEMORY, GameGenre.SET_COLLECTION, GameGenre.ROUTE_BUILDING, GameGenre.PUSH_YOUR_LUCK],
  coop:     [GameGenre.COOPERATIVE],
  heavy:    [GameGenre.WAR_GAME, GameGenre.MINIATURES, GameGenre.LEGACY, GameGenre.RPG, GameGenre.THEMATIC, GameGenre.ASYMMETRIC, GameGenre.ADVENTURE, GameGenre.HORROR],
  card:     [GameGenre.CARD_GAME, GameGenre.DECK_BUILDING, GameGenre.CARD_DRAFTING],
};
```

Tuneable later — start with this and adjust if specific games end up in the wrong bucket. (`negotiation` is intentionally not in any mood; it shows in `Any` only. That's fine for v1.)

A game matches a mood if any element of `game.genres` is in `MOOD_TO_GENRES[selectedMood]`. `Any` matches all games.

## `playTime` parsing

`Game.playTime` is a free-text string in the JSON: examples seen are `"40-70 minutes"`, `"30 minutes"`, `"60-9999 minutes"`, `"15 minutes"`. The time filter compares against the **lower bound** so games whose minimum-play time fits the ceiling qualify (a 60–90 game shows for `≤1 hour` users — they could finish a short one).

Parser pseudocode:

```
parseMinPlayMinutes(playTime: string): number | null
  // strip "minutes", split on "-", parse first number; fall back to whole-string parse; null on failure.
```

Games with unparsable `playTime` (or null) are included only when the filter is `Any`. Add a small unit test for the parser.

## Shared `GenreIconService` — extracting the duplicated dictionary

Currently `getGenreIcon(genre: GameGenre): string` is duplicated **verbatim** in:
- `src/app/games/games.component.ts:218-251`
- `src/app/game-details-dialog/game-details-dialog.component.ts:143-176`

`getGenreColor(genre: GameGenre): 'primary' | 'accent' | 'warn' | undefined` lives only in `games.component.ts:183-216` but is the same kind of dictionary lookup.

**Plan:** create `src/app/services/genre-icon.service.ts` exporting:

```ts
@Injectable({ providedIn: 'root' })
export class GenreIconService {
  iconFor(genre: GameGenre): string;        // existing 28-genre Material Icon map; default 'category'
  colorFor(genre: GameGenre): 'primary' | 'accent' | 'warn' | undefined;
  iconForMood(mood: MoodFilter): string;    // new — mood label icon
  // exported for callers that want plain data
  readonly genreIcons: Readonly<Record<GameGenre, string>>;
  readonly genreColors: Readonly<Record<GameGenre, ...>>;
  readonly moodIcons: Readonly<Record<MoodFilter, string>>;
  readonly moodToGenres: Readonly<typeof MOOD_TO_GENRES>;
}
```

Refactor: replace the duplicated methods in `GamesComponent` and `GameDetailsDialogComponent` with calls to `GenreIconService` (inject in constructor; templates call `iconService.iconFor(genre)` instead of `getGenreIcon(genre)`). Verify `/games` and the details dialog look identical to before — same icons, same colors. This is the explicit user request: *"if there's not a unified component/dictionary to track the genre to icon go ahead and make one too."*

### Mood label & chip icons

Reuse the existing Material Icons established for genres so the home filter visually matches the rest of the app:

| Mood | Mood-row icon | Notes |
|---|---|---|
| Strategy | `psychology` | matches `GameGenre.STRATEGY` icon |
| Party | `celebration` | matches `GameGenre.PARTY` icon |
| Family | `family_restroom` | matches `GameGenre.FAMILY` icon |
| Co-op | `groups` | matches `GameGenre.COOPERATIVE` icon |
| Heavy | `fitness_center` | new — no single genre, "weight" semantics |
| Card | `style` | matches `GameGenre.CARD_GAME` icon |
| Any | *(no icon)* | reads as the neutral default |

For result row metadata, **reuse the existing project icons** so the home page lines up with `/games` and the details dialog:

| Use | Material Icon | Existing usage |
|---|---|---|
| Players label / metadata | `group` | `games.component.html:116`, `game-details-dialog.component.html:24` |
| Time label / metadata | `schedule` | `games.component.html:122`, `game-details-dialog.component.html:28` |
| Comments | `chat_bubble_outline` | `games.component.html:140`, `game-details-dialog.component.html:140` |
| Likes (filled) | `favorite` | `games.component.html:135` |
| Likes (outline) | `favorite_border` | `games.component.html:135` |
| Group rating | `star` | `game-details-dialog.component.html:49` |
| Mood label | `auto_awesome` | new — no precedent; "vibe" connotation |
| Activity strip header | `timeline` | new |

## Activity strip composition

In `HomeComponent` (or a small pure helper):

```
buildActivityItems(comments, ratings, likes, gameById): ActivityItem[]
  - map each into a normalized ActivityItem with type, timestamp, username, gameId, gameTitle (looked up via gameById)
  - sort by timestamp descending
  - take top 3
  - drop items whose gameId isn't in the catalog (defensive — backend may have orphans)
```

Mobile shows top 2 (height-constrained); desktop shows top 3.

## Responsive behavior

- Breakpoints: existing `$mobile (480px) / $tablet (768px) / $desktop (1024px) / $large (1200px)` from `STYLE_GUIDE.md`. No new breakpoints.
- Below 768px: filter chip rows scroll horizontally if they overflow (Mood always overflows; Players + Time fit). Inline labels (60px wide) on the left of each row.
- 768px+: filter occupies full width with more breathing room; result rows show secondary genre badge and longer metadata; activity strip shows 3 items instead of 2.
- Tap targets: chips are min 32px tall on mobile, 36px on desktop. Activity icons are 18×18 (mobile) / 22×22 (desktop) inside their colored circles.

## Removed code

- `home.component.html` — entire current contents replaced.
- `home.component.scss` — replaced with new structure.
- `getGenreIcon` and `getGenreColor` private methods on `GamesComponent` and `GameDetailsDialogComponent` — removed in favor of `GenreIconService`.

## Files touched

**New:**
- `src/app/home/discovery-filter/discovery-filter.component.{ts,html,scss}`
- `src/app/home/discovery-results/discovery-results.component.{ts,html,scss}`
- `src/app/home/activity-strip/activity-strip.component.{ts,html,scss}`
- `src/app/home/home-filter.model.ts`
- `src/app/services/genre-icon.service.ts`

**Modified:**
- `src/app/home/home.component.{ts,html,scss}` — full rewrite
- `src/app/games/games.component.ts` — replace `getGenreIcon` / `getGenreColor` with `GenreIconService` calls
- `src/app/games/games.component.html` — `getGenreIcon(genre)` → `iconService.iconFor(genre)` (or equivalent)
- `src/app/game-details-dialog/game-details-dialog.component.ts` — same refactor
- `src/app/game-details-dialog/game-details-dialog.component.html` — same template update

## Testing

No test runner is wired in this project (per CLAUDE.md, Karma was removed). Plan:

- **Manual verification on `npm start`:**
  - `/home` lands with default filter, results render, match count correct.
  - Each chip row toggles correctly; only one chip active per row.
  - Empty-state copy appears when filter excludes all games.
  - `localStorage` value updates on chip click; reload preserves selection.
  - `/games` and `/games` detail dialog look identical to before the refactor (icons + colors).
  - Mobile (Chrome DevTools 375px width): filter is ≤140px tall, two result rows visible above the fold, mood row scrolls horizontally.
- **Build:** `npm run build:prod` succeeds, `npm run lint` passes, no console errors at runtime.

## Open questions

None blocking. Two minor calls left for implementation time:

1. Should `Heavy` mood include `THEMATIC` and `RPG`? Listed above — could feel too broad. Easy to tune.
2. Activity strip: include the rating value / comment text snippet on mobile, or just the "X did Y on Z" form? Listed as desktop-only above; revisit if it looks empty.
