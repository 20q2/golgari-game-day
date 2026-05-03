# Home Page Becomes Games Page — Design Spec

## Goal

Replace the current home page (a discovery filter with mood/players/time inputs and an activity strip) with the games-page UI (search + genre strip + hero + list). Keep `/home` as the canonical URL and remove the `/games` route.

## User flow

1. Visitor opens the site root.
2. `''` redirects to `/home` (unchanged).
3. `/home` renders the games-browse surface: sticky search bar, genre strip, hero card (when no filters active), and the responsive games list.
4. The Games link in the navbar is gone; users navigate to the catalog by hitting Home.

## Scope

In scope:
- Re-point `/home` to `GamesComponent`.
- Remove the `/games` route.
- Remove the Games link from the navbar.
- Delete the entire `src/app/home/` directory (the old discovery-tool component plus its sub-components and helpers).
- Remove the `body.home-page` block from `src/styles.scss`.

Out of scope (deferred):
- Renaming `GamesComponent` to `HomeComponent`, the `src/app/games/` folder to `home/`, or any of the `Games*` sub-components (`GamesSearchBar`, `GamesGenreStrip`, `GamesHero`, `GamesList`, `GamesFilterSheet`). The component is a games browser; the URL is `/home`. These names describe different concerns, and the rename cascade is cosmetic-only churn.
- Renaming the localStorage key `gameday-games-filter`.
- Migrating users' old `gameday-home-filter` localStorage entries — they become orphan data, which is harmless.
- Removing `src/assets/image1.png` (the image used by the old home-page background). Leave it; if it turns out unused elsewhere later, prune in a separate cleanup.
- New home-specific landing affordances. The games-browse surface *is* the new home page.

## Architecture

### Modified files

- `src/app/app.routes.ts` — change the `/home` entry to `GamesComponent`; delete the `/games` entry; remove the `HomeComponent` import; keep `''` and `**` redirects pointing at `/home`.
- `src/app/navbar/navbar.component.html` — delete the Games `<a mat-button>` block. Final order inside `.nav-links`: Home → TV (desktop-only) → sign-in `@if` block.
- `src/styles.scss` — delete the `&.home-page { ... }` rule (lines ~104–106). Keep the `&.games-page { ... }` block; `GamesComponent` sets that class on `document.body` regardless of URL.

### Deleted files

The entire `src/app/home/` tree:
- `src/app/home/home.component.ts`
- `src/app/home/home.component.html`
- `src/app/home/home.component.scss`
- `src/app/home/home-filter.model.ts`
- `src/app/home/home-filter.helpers.ts`
- `src/app/home/discovery-filter/` (component dir, all files)
- `src/app/home/discovery-results/` (component dir, all files)
- `src/app/home/activity-strip/` (component dir, all files)

A grep across `*.ts` confirms `HomeComponent`, `DiscoveryFilter*`, `DiscoveryResults*`, `ActivityStrip*`, `HomeFilter*` are referenced only inside `src/app/home/` and in `app.routes.ts`. After the route change, deleting the directory leaves no dangling imports.

### Unchanged

- `GamesComponent`, all `Games*` sub-components, and the `src/app/games/` folder structure stay as they are.
- `GamesComponent.ngOnInit()` still sets `document.body.className = 'games-page'`. The dark Golgari gradient and `--games-*` tokens scoped under `body.games-page` in `src/styles.scss` apply at `/home` exactly because the body class is keyed off the component, not the URL.
- The `gameday-games-filter` localStorage key continues to persist filter/sort across sessions. Users who previously had an entry under the old `gameday-home-filter` key keep that entry as harmless dead data.
- `/tv` route and the navbar's TV link are untouched.

## Edge cases & non-concerns

- **Service worker cache**: After deploy, the PWA serves the previous bundle until a hard refresh — same caveat as every other code change. No special handling.
- **Body class semantic mismatch**: At `/home`, `document.body` carries `games-page`. This is internal-only (no user-visible impact) and matches the component's identity, not the URL's. Acceptable.
- **Orphan asset**: `src/assets/image1.png` was the old home-page background. Leaving it in place avoids a wider sweep; it's not referenced after the styles edit.
- **Lint**: `npm run lint` is currently broken on a pre-existing ESLint v9 config issue, unrelated to this work. Not in scope to fix here.

## Verification

The project has no test runner wired up. Manual verification on the dev server:

1. `npm start` and visit `http://localhost:4200/`. Expect a redirect to `/home` and the dark games-browse surface.
2. Confirm the navbar shows brand · Home · TV (desktop only) · Sign-in/user-chip — no Games link.
3. Visit `http://localhost:4200/games` directly. Expect the wildcard route to redirect to `/home`.
4. Confirm filtering, search, hero, genre strip, and the filter sheet all work the same as the old `/games` page.
5. `npx tsc --noEmit -p tsconfig.app.json` is clean.
6. `npm run build:prod` succeeds.
