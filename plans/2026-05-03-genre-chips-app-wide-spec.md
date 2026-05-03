# Genre Chip Icons (App-Wide) — Design Spec

## Goal

Extend the genre-icon-on-chip pattern (already shipped on the filter sheet and the top-of-page genre strip) to the remaining two chip surfaces in the app: the game-details dialog and the hero card.

## Surfaces in scope

1. **Game details dialog** — `.genre-chip` `<span>` rendered for each entry in `game.genres` ([src/app/game-details-dialog/game-details-dialog.component.html:32-36](../src/app/game-details-dialog/game-details-dialog.component.html#L32-L36)). Display-only chips (no selected/hover state).
2. **Games hero** — `.genre-pill` `<span>` rendered for each entry in `genresShown` ([src/app/games/games-hero/games-hero.component.html:25-27](../src/app/games/games-hero/games-hero.component.html#L25-L27)). Smaller pills overlaid on a hero image; also display-only.

## Out of scope (call out, not silently skip)

- **Games list `.genres`** ([src/app/games/games-list/games-list.component.html:22](../src/app/games/games-list/games-list.component.html#L22)) renders genres as a single comma-separated text string, not chips. Restructuring it into per-genre icon-prefixed chips would either crowd the dense list row or require a layout rework. Different change, different decision — left for a separate spec if/when the user wants it.
- The "All", "Multiple genres", and "+N more" chips on the genre strip stay text-only (already settled in the prior spec — they're not genre-typed).
- Action chips and selection chips that aren't genre-typed (none currently in the app, just calling it out).

## Icon source

`GenreIconService.iconFor(genre: GameGenre): string` ([src/app/services/genre-icon.service.ts](../src/app/services/genre-icon.service.ts)) — the same canonical mapping used by the filter sheet and genre strip.

## Architecture

### Modified files

**Game details dialog** (one commit):
- `src/app/game-details-dialog/game-details-dialog.component.ts` — inject `GenreIconService` as a public field (`MatIconModule` is already imported).
- `src/app/game-details-dialog/game-details-dialog.component.html` — update the `.genre-chip` span to render `<mat-icon class="chip-icon">…</mat-icon>` followed by the label.
- `src/app/game-details-dialog/game-details-dialog.component.scss` — change `.genre-chip` to `display: inline-flex; align-items: center; gap: 4px` and add a `.chip-icon { font-size: 14px; width: 14px; height: 14px; line-height: 1; }` rule.

**Games hero** (one commit):
- `src/app/games/games-hero/games-hero.component.ts` — add `MatIconModule` to the standalone component's `imports`; inject `GenreIconService`.
- `src/app/games/games-hero/games-hero.component.html` — update the `.genre-pill` span to render `<mat-icon class="pill-icon">…</mat-icon>` followed by the label.
- `src/app/games/games-hero/games-hero.component.scss` — change `.genre-pill` to `display: inline-flex; align-items: center; gap: 3px` and add a `.pill-icon { font-size: 12px; width: 12px; height: 12px; line-height: 1; }` rule. Smaller than the 14px used elsewhere because the hero's pill text is 10–11px.

### Unchanged

- `GenreIconService` itself — no changes; it just gains two more callers.
- The "Sort"/"Duration"/"Players"/"Genres" section labels in the filter sheet (already received their own leading icons in a manual edit; not touched here).
- Any other surface in the app not listed above.

## Sizing rationale

- **Dialog**: chip text is 12px (`game-details-dialog.component.scss:152`). Match the filter sheet's 14px icon — proportional and visually consistent with the other "compact" chip surfaces.
- **Hero**: pill text is 10px on mobile / 11px on desktop. A 14px icon would be ~40% taller than the label and would dominate the small pill. 12px icon is still ~10–20% larger than the text but reads as a complement, not a takeover.

## Edge cases & non-concerns

- **Hover/selected state**: neither dialog chips nor hero pills have one. No state-flip color rules to add. (Filter-sheet/genre-strip patterns already handle that for their toggleable variants.)
- **Material Icons font**: already loaded globally (used by the navbar, dialogs, and the surfaces we shipped earlier).
- **Hero pill background opacity**: hero pills use `rgba(255, 255, 255, 0.2)` background and inherit white-ish text. `<mat-icon>` inherits color, so the icon will read white-on-translucent the same way the label does.

## Verification

No unit-test runner. Manual verification on the dev server:

1. `npm start` → visit `/`. Each hero card (most-loved / top-rated) shows pills with a 12px icon prefix (e.g. Strategy → `psychology`, Cooperative → `groups`).
2. Click any game tile/row → the details dialog opens with `.genre-chip` items showing 14px icons matching the filter-sheet style.
3. `npx tsc --noEmit -p tsconfig.app.json` is clean.
4. `npm run build:prod` succeeds.
