# Featured Trio Carousel — Design Spec

## Goal

Replace the games page's single hero card with a 3-slot featured carousel surfacing **Most Loved**, **Highest Community Rating**, and **Recently Applauded** (a "what's hot" recent-activity signal). One card visible at a time, swipeable on touch, with dot indicators beneath.

## User flow

1. Visitor lands on `/home` (the games-browse surface).
2. Above the genre strip, a single full-width hero card appears with a "MOST LOVED" badge and the most-liked game.
3. Swipe left (or scroll/drag) to reveal the "HIGHEST RATED" card showing the game with the highest community average rating.
4. Swipe again to reveal "WHAT'S HOT" — the game with the most recent activity in the past 14 days.
5. Three dots beneath the card track position; tapping a dot jumps to that slot.
6. When the user opens any filter (search, genre, duration, etc.), the carousel hides — same rule as the current single hero.
7. Cold-start fallbacks: if a slot has no qualifying game, that card is silently omitted (carousel may render with 1 or 2 cards, or nothing at all).

## Surfaces in scope

- `src/app/games/games.component.html` (replace the single `<app-games-hero>` block with the new carousel component).
- `src/app/games/games.component.ts` (replace `hero$: Observable<HeroSelection | null>` with `featured$: Observable<HeroSelection[]>` and adjust the source operator).
- `src/app/games/games.utils.ts` (add `pickFeaturedTrio`; deprecate/remove `pickHero` since nothing else calls it; update `HeroVariant` to the new union).
- `src/app/games/games-hero/games-hero.component.ts` (update `HeroVariant` typing, badge text/icon getters for the new variants).
- `src/app/games/games-hero/games-hero.component.scss` (only if needed for the new variant's badge color — see below).
- New component: `src/app/games/games-featured-carousel/games-featured-carousel.component.{ts,html,scss}`.

## Out of scope

- Carousel libraries (ngx-owl-carousel, swiper.js, etc.). Plain CSS scroll-snap is sufficient.
- Auto-advance / autoplay.
- Left/right arrow buttons (dots + native scroll cover navigation; arrows can be added later if requested).
- Time-decay weighting on the 14-day recent-activity score (a like 13 days ago counts the same as a like 1 day ago).
- A configurable window length — 14 days is hardcoded.
- Surfacing "Recently Applauded" anywhere else (e.g. on a game card, in the dialog).
- BGG-rating-based hero (the old `'top-rated'` variant). Removed.

## Architecture

### `pickFeaturedTrio` (in `src/app/games/games.utils.ts`)

Replace the existing `pickHero(games, stats)` function with:

```ts
export function pickFeaturedTrio(
  games: Game[],
  stats: GameStats[],
  now: Date,
): HeroSelection[];
```

The `now` parameter exists so callers (and tests, if added later) can pin the recent-window calculation; production callers pass `new Date()`.

Behavior:
1. **Most Loved slot**: same logic as today's `pickHero` "most-loved" branch — pick the game with the highest `totalLikes`, tiebreak by `bggRating` desc, then `title` asc. If no game has any likes, omit the slot.
2. **Highest Community Rating slot**: among games whose `stats.totalRatings > 0` and `stats.averageRating != null`, pick the highest `averageRating` (tiebreak by `totalRatings` desc, then `title` asc). Skip the game already chosen for Most Loved. If none qualify after the skip, omit the slot.
3. **Recently Applauded slot**: for each game, sum `comments.length + ratings.length + likes.length` restricted to entries whose `timestamp` is within the past 14 days from `now`. Pick the game with the highest count (tiebreak by the most recent timestamp desc, then `title` asc). Skip games already chosen for Most Loved or Highest Community Rating. If no game has any activity in the past 14 days after the skip, omit the slot.

Return the slots in fixed order: `[Most Loved, Highest Community Rating, Recently Applauded]`. Omitted slots are simply absent from the array.

### `HeroVariant` (in `src/app/games/games.utils.ts`)

Change from:

```ts
export type HeroVariant = 'most-loved' | 'top-rated';
```

To:

```ts
export type HeroVariant = 'most-loved' | 'highest-rated' | 'recently-hot';
```

The `'top-rated'` variant was BGG-driven; it's removed because BGG rating is no longer surfaced as a featured slot.

### `GamesHeroComponent` updates

In `src/app/games/games-hero/games-hero.component.ts`:

- Update `badgeText` and `badgeIcon` getters to handle all three variants.
- Add an input or derive from variant: the **rating value** to display in the "HIGHEST RATED" badge (e.g. "HIGHEST RATED · 8.4"). Pass it as a new optional `@Input() ratingValue?: number` so the parent can supply `stats.averageRating`. The badge text concatenates accordingly.
- The variant–color mapping in SCSS gets a third entry (`.recently-hot`); keep the existing `.most-loved` styling and rename `.top-rated` SCSS rule to `.highest-rated`. The 🔥 / "WHAT'S HOT" badge gets a warm orange tone (`#ff8a3d` or similar — same vibe as `--accent-color`).

Badge content per variant:
- `most-loved`: `♥` + `MOST LOVED · N LIKES` (or `1 LIKE`). Unchanged.
- `highest-rated`: `★` + `HIGHEST RATED · X.X` (e.g. "HIGHEST RATED · 8.4").
- `recently-hot`: `🔥` + `WHAT'S HOT`.

The `likeCount` input keeps its current meaning (used only by `most-loved`). Add `ratingValue?: number` for `highest-rated`.

### New `GamesFeaturedCarouselComponent`

Files:
- `src/app/games/games-featured-carousel/games-featured-carousel.component.ts`
- `src/app/games/games-featured-carousel/games-featured-carousel.component.html`
- `src/app/games/games-featured-carousel/games-featured-carousel.component.scss`

Standalone Angular component, signature:

```ts
@Input({ required: true }) selections: HeroSelection[] = [];
@Output() open = new EventEmitter<Game>();
```

The component:
- Renders nothing when `selections.length === 0`.
- Otherwise renders one `<app-games-hero>` per selection inside a horizontal scroll container, plus a `<nav class="dots">` row beneath with one button per selection.
- Tracks the current index in a local field updated by an `IntersectionObserver` (one observer watching all card elements with `threshold: 0.6`); whichever card has ≥ 60% intersection becomes active. The dots toggle a `.active` class on the matching index.
- Tapping a dot calls `scrollIntoView({ behavior: 'smooth', inline: 'start' })` on the corresponding card element (use `@ViewChildren` on the card wrapper).
- Forwards `(open)` events from each `<app-games-hero>` upward.

Template skeleton (illustrative — exact attributes go in the plan):

```html
<div class="featured" *ngIf="selections.length > 0">
  <div class="track" #track>
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
  <nav class="dots" *ngIf="selections.length > 1">
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

SCSS approach:
- `.track` is `display: flex; overflow-x: auto; scroll-snap-type: x mandatory; scrollbar-width: none;` plus `&::-webkit-scrollbar { display: none }` (matches the genre strip's existing pattern).
- `.slide` is `flex: 0 0 100%; scroll-snap-align: start;`.
- `.dots` is centered, `display: flex; gap: 6px;` with each `.dot` a 8px circle, semi-transparent on idle and accent-colored when `.active`.

### `HeroSelection` type update

Add an optional `ratingValue` field:

```ts
export interface HeroSelection {
  game: Game;
  variant: HeroVariant;
  likeCount: number;
  ratingValue?: number;
}
```

Used by the `'highest-rated'` slot to display the average in the badge.

### `games.component.ts` / `games.component.html` updates

In `games.component.ts`:
- Replace `hero$: Observable<HeroSelection | null>` with `featured$: Observable<HeroSelection[]>`.
- The constructor's `combineLatest([catalog, stats])` block calls `pickFeaturedTrio(games, stats, new Date())` instead of `pickHero(games, stats)`.

In `games.component.html`, replace lines 27–34 (the existing `<ng-container *ngIf="!isFiltered && (hero$ | async) as hero">` block) with:

```html
<ng-container *ngIf="!isFiltered && (featured$ | async) as featured">
  <app-games-featured-carousel
    *ngIf="featured.length > 0"
    [selections]="featured"
    (open)="onOpenGame($event)"
  ></app-games-featured-carousel>
</ng-container>
```

The `*ngIf="featured.length > 0"` ensures we don't render an empty wrapper when all three slots are omitted.

## Edge cases & non-concerns

- **All three slots omitted (cold start with zero activity)**: `featured$` emits `[]` and the carousel renders nothing. Same end state as today's filter-active hide.
- **Only one slot filled** (e.g. a single like on a single game): carousel renders one card, no dots. This is just a regular hero — no UX surprise.
- **Two slots filled**: two cards, two dots, swipe between them.
- **Active index drift on resize**: `IntersectionObserver` re-fires on layout changes, so the active dot stays correct.
- **PWA service worker**: no impact (component is in-bundle).
- **Performance**: 3 hero cards × 1 image each = 3 image requests. Same network footprint as today's single hero in steady state (the other two images are loaded eagerly when the carousel mounts; could be lazy-loaded via `loading="lazy"` if they prove costly, but the existing `<app-games-hero>` already uses `loading="lazy"` so we're fine).
- **Accessibility**: the dots have `aria-label="Go to slide N of M"`. The cards themselves remain focusable via tab — the existing `<app-games-hero>` is a `<button>`. Swipe is the primary discovery; keyboard users get the dots and tabbable cards.

## Verification

No test runner. Manual verification on the dev server:

1. `npm start` → visit `/home`.
2. Above the genre strip, a single full-width card renders with the `MOST LOVED` badge.
3. Swipe / drag / scroll horizontally — the card snaps to the next slot (`HIGHEST RATED`). Snap again to `WHAT'S HOT`. Three dots beneath update to reflect the active slot.
4. Tap each dot — the carousel jumps to the matching slot smoothly.
5. Open a filter (e.g. type into search). The whole carousel disappears.
6. With zero likes / ratings / 14-day activity in your data, confirm the carousel is hidden (or shows fewer cards if some signals exist).
7. `npx tsc --noEmit -p tsconfig.app.json` is clean.
8. `npm run build:prod` succeeds.
