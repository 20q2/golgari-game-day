# Genre Chip Icons — Design Spec

## Goal

Add a small Material icon to each genre chip in two surfaces — the games-filter sheet/dialog and the top-of-page genre strip — so a chip's genre is recognizable at a glance, not just by label text.

## Surfaces in scope

1. **Filter sheet** ([src/app/games/games-filter-sheet/games-filter-sheet.component.html:45-53](../src/app/games/games-filter-sheet/games-filter-sheet.component.html#L45-L53)): every per-genre chip inside `.genre-grid`.
2. **Genre strip** ([src/app/games/games-genre-strip/games-genre-strip.component.html:20-28](../src/app/games/games-genre-strip/games-genre-strip.component.html#L20-L28)): only the per-genre `*ngFor` chip. The non-genre chips ("All", "Multiple genres", "+N more") stay text-only because they're not genre-typed.

## Icon source

`GenreIconService.iconFor(genre: GameGenre): string` ([src/app/services/genre-icon.service.ts](../src/app/services/genre-icon.service.ts)) already exposes a complete `Record<GameGenre, string>` mapping of Material icon names (e.g. `STRATEGY → psychology`, `PARTY → celebration`). The service is currently unused since the home page was deleted; this work resurrects it as the canonical source.

## Architecture

### Modified files

- `src/app/games/games-filter-sheet/games-filter-sheet.component.ts` — inject `GenreIconService` as a public field (so the template can read it) via the constructor.
- `src/app/games/games-filter-sheet/games-filter-sheet.component.html` — update the `*ngFor` chip body to render `<mat-icon class="chip-icon">{{ iconService.iconFor(g.genre) }}</mat-icon>`, then a `<span class="chip-label">{{ g.genre }}</span>`, then the existing count span.
- `src/app/games/games-filter-sheet/games-filter-sheet.component.scss` — change `.genre-chip` from a static-padding block to `display: inline-flex; align-items: center; gap: 4px` and add a `.chip-icon` rule that sizes the icon to match the chip's text (`font-size: 14px; width: 14px; height: 14px; line-height: 1`).
- `src/app/games/games-genre-strip/games-genre-strip.component.ts` — add `MatIconModule` to the standalone component's `imports`; inject `GenreIconService` as a public field.
- `src/app/games/games-genre-strip/games-genre-strip.component.html` — apply the same icon + label + count change to **only** the per-genre `*ngFor` chip (the "All", "Multiple genres", and "+N more" chips are unchanged).
- `src/app/games/games-genre-strip/games-genre-strip.component.scss` — make `.chip` `inline-flex; align-items: center; gap: 4px` and add a `.chip-icon` rule sized to the chip's text.

### Untouched

- `GenreIconService` itself — no changes; we just gain two callers.
- The "All", "Multiple genres", "+N more" chip variants in the genre strip — text only.
- Other chip surfaces in the app (game-details dialog, hero card, etc.) — outside this spec's scope.
- `GameFilter`, `GamesComponent` orchestration, persistence, sort/duration/players controls — none of those are touched.

### Selected / active state

Both stylesheets' selected (`.genre-chip.selected`) and active (`.chip.active`) variants already flip the chip's background and use `color: white` for the text. `<mat-icon>` inherits color, so the icon recolors automatically; no extra rules required.

## Edge cases & non-concerns

- **Missing icon mapping**: `GenreIconService.iconFor` already has a `?? 'category'` fallback. Every existing `GameGenre` enum value is in the map, so the fallback won't fire today, but it keeps future genres safe.
- **Material Icons font**: already loaded globally (used by the navbar, the close button in the filter sheet, etc.). No new asset request.
- **Build warning side effect**: the production build currently emits "GenreIconService is part of the TypeScript compilation but it's unused". Once two components import it, the warning goes away. Bonus, not the goal.

## Verification

No test runner. Manual verification on the dev server:

1. `npm start` and visit `/home`.
2. Confirm each genre chip in the top genre strip now has a small leading icon (e.g. Thematic → `auto_stories`, Strategy → `psychology`).
3. Tap a chip and confirm the active state recolors both label and icon white without layout shift.
4. Open the filter sheet (mobile) or filter dialog (desktop) and confirm the same icon-prefixed treatment for every chip in the grid.
5. Confirm the "All" / "Multiple genres" / "+N more" chips remain text-only.
6. `npx tsc --noEmit -p tsconfig.app.json` is clean.
7. `npm run build:prod` succeeds; the previously-emitted "`GenreIconService` … unused" warning is gone.
