# Home Becomes Games Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Replace the home page (a discovery filter UI) with the games-page UI by re-pointing the `/home` route at `GamesComponent`, removing the `/games` route, removing the Games navbar link, and deleting the now-unused `src/app/home/` tree.

**Architecture:** Pure refactor — no new components or behaviors. Sequence tasks so each commit leaves the project building: change routing first (which removes the only reference to `HomeComponent`), then prune the navbar and CSS, then delete the orphaned folder. `GamesComponent` already sets `document.body.className = 'games-page'`, so the existing dark Golgari styling continues to apply at `/home`.

**Tech Stack:** Angular 20 standalone components, SCSS, no test runner (per project's CLAUDE.md — Karma/Jasmine specs are removed). Verification is via `tsc --noEmit` and the production build.

**Spec:** [plans/2026-05-03-home-becomes-games-spec.md](./2026-05-03-home-becomes-games-spec.md)

---

## File Structure

**Modified files:**
- `src/app/app.routes.ts` — re-point `/home` at `GamesComponent`; delete the `/games` entry; drop the `HomeComponent` import.
- `src/app/navbar/navbar.component.html` — delete the Games `<a mat-button>` link.
- `src/styles.scss` — delete the `body.home-page { ... }` background rule.

**Deleted files (entire directory tree):**
- `src/app/home/` — `home.component.{ts,html,scss}`, `home-filter.helpers.ts`, `home-filter.model.ts`, plus the `discovery-filter/`, `discovery-results/`, and `activity-strip/` sub-component directories.

**Untouched:**
- `src/app/games/` and all its sub-components.
- `src/app/tv/` and the `/tv` route.
- The `body.games-page` block in `src/styles.scss`.
- `src/assets/image1.png` (orphan asset, leave for separate cleanup).

---

### Task 1: Re-point `/home` and remove `/games` from the route table

**Files:**
- Modify: `src/app/app.routes.ts`

- [ ] **Step 1: Confirm current routes match expectations**

Open `src/app/app.routes.ts`. The file should currently be:

```ts
import { Routes } from '@angular/router';
import { HomeComponent } from './home/home.component';
import { GamesComponent } from './games/games.component';
import { TvComponent } from './tv/tv.component';

export const routes: Routes = [
  { path: '', redirectTo: '/home', pathMatch: 'full' },
  { path: 'home', component: HomeComponent },
  { path: 'games', component: GamesComponent },
  { path: 'tv', component: TvComponent },
  { path: '**', redirectTo: '/home' }
];
```

If the file looks substantially different, stop and report.

- [ ] **Step 2: Replace the file contents**

Replace the entire contents of `src/app/app.routes.ts` with:

```ts
import { Routes } from '@angular/router';
import { GamesComponent } from './games/games.component';
import { TvComponent } from './tv/tv.component';

export const routes: Routes = [
  { path: '', redirectTo: '/home', pathMatch: 'full' },
  { path: 'home', component: GamesComponent },
  { path: 'tv', component: TvComponent },
  { path: '**', redirectTo: '/home' }
];
```

The `HomeComponent` import is gone. `/home` now renders `GamesComponent`. The `/games` route is removed; any visit to `/games` falls through to the `**` wildcard and redirects to `/home`.

- [ ] **Step 3: Verify TypeScript compiles**

```bash
npx tsc --noEmit -p tsconfig.app.json
```

Expected: clean exit (no output). The `src/app/home/` tree still exists on disk but has no entry points; deleting it is a later task. There should be no errors at this point because nothing in the active build graph imports from `src/app/home/` anymore.

- [ ] **Step 4: Commit**

```bash
git add src/app/app.routes.ts
git commit -m "refactor(routes): point /home at GamesComponent and drop /games"
```

---

### Task 2: Remove the Games link from the navbar

**Files:**
- Modify: `src/app/navbar/navbar.component.html`

- [ ] **Step 1: Delete the Games anchor block**

In `src/app/navbar/navbar.component.html`, find this exact block (lines 13–16 at time of writing):

```html
    <a mat-button routerLink="/games" routerLinkActive="active" class="nav-link">
      <mat-icon>sports_esports</mat-icon>
      <span class="nav-text">Games</span>
    </a>
```

Delete those four lines (and the trailing blank line if one is left between the Home link and the TV link). The result should be that the `.nav-links` container goes directly from the Home link to the TV link:

```html
  <div class="nav-links">
    <a mat-button routerLink="/home" routerLinkActive="active" class="nav-link">
      <mat-icon>home</mat-icon>
      <span class="nav-text">Home</span>
    </a>
    <a mat-button routerLink="/tv" routerLinkActive="active" class="nav-link desktop-only">
      <mat-icon>qr_code_2</mat-icon>
      <span class="nav-text">TV</span>
    </a>

    @if (userService.isSignedIn()) {
```

Do not change the `.brand` link, the TV link, the sign-in `@if` block, or anything outside `.nav-links`.

- [ ] **Step 2: Verify TypeScript template compilation**

```bash
npx tsc --noEmit -p tsconfig.app.json
```

Expected: clean exit. Template type-checking is enabled (`strictTemplates: true`), so a malformed edit will surface here.

- [ ] **Step 3: Commit**

```bash
git add src/app/navbar/navbar.component.html
git commit -m "refactor(navbar): remove Games link"
```

---

### Task 3: Remove the `.home-page` body-class rule from global styles

**Files:**
- Modify: `src/styles.scss`

- [ ] **Step 1: Delete the rule**

In `src/styles.scss`, find this block (lines ~104–106 at time of writing, immediately before `&.games-page`):

```scss
  &.home-page {
    background: url('./assets/image1.png') center/cover fixed;
  }
```

Delete those three lines. Keep the surrounding comment block (lines 101–103, "Page-specific backgrounds...") and the `&.games-page { ... }` rule untouched. The result should be the comment immediately followed by `&.games-page { ... }`:

```scss
  // Page-specific backgrounds. Reference src/assets/ so Angular bundles the
  // images and rewrites the URL — works on both dev (root) and GitHub Pages
  // (under /golgari-game-day/) without shell-specific path quirks.
  &.games-page {
    // Dark Golgari gradient — replaces the photo background to give the
    // games page a distinct identity (Netflix-style browse surface).
```

- [ ] **Step 2: Commit**

```bash
git add src/styles.scss
git commit -m "refactor(styles): drop unused body.home-page background rule"
```

---

### Task 4: Delete the `src/app/home/` directory

**Files:**
- Delete: `src/app/home/` (entire directory and all contents)

- [ ] **Step 1: Confirm nothing in the build graph still imports from `src/app/home/`**

Run:

```bash
grep -rn "from .*['\"].*app/home" src/app/ --include='*.ts'
```

Expected: no matches. (`HomeComponent`, `HomeFilter`, `DiscoveryFilter`, `DiscoveryResults`, and `ActivityStrip` were only referenced inside `src/app/home/` itself plus `app.routes.ts`, which Task 1 cleaned.)

If there is any match outside `src/app/home/`, stop and report — there's an unexpected import that needs to be untangled before the directory can be deleted.

- [ ] **Step 2: Remove the directory from git and disk**

```bash
git rm -rf src/app/home
```

Expected: git stages the deletion of `home.component.ts`, `home.component.html`, `home.component.scss`, `home-filter.helpers.ts`, `home-filter.model.ts`, plus everything under `discovery-filter/`, `discovery-results/`, and `activity-strip/`.

- [ ] **Step 3: Verify TypeScript compiles**

```bash
npx tsc --noEmit -p tsconfig.app.json
```

Expected: clean exit. If there's an unresolved import error, restore with `git restore --staged --worktree src/app/home` and investigate.

- [ ] **Step 4: Commit**

```bash
git commit -m "refactor(home): delete unused home page tree"
```

---

### Task 5: Production build verification

**Files:**
- None (verification only).

- [ ] **Step 1: Run the production build**

```bash
npm run build:prod
```

Expected: completes without errors. The `flatten-build` step copies `docs/browser/*` up to `docs/`. Pre-existing warnings (budget, unused `aws-test`/`statistics` files, qrcode CommonJS optimization bailout) are acceptable; new errors are not.

- [ ] **Step 2: Confirm no stale `home/` references in the bundle**

```bash
grep -c "discovery-filter\|discovery-results\|activity-strip\|home-filter" docs/main*.js
```

Expected: `0`. If non-zero, the deletion didn't take effect or a stray import survived.

- [ ] **Step 3: No commit**

This task produces only the `docs/` build artifact, which is `.gitignore`d.

---

## Verification checklist (final)

Before marking the feature complete, confirm:

- [ ] `npx tsc --noEmit -p tsconfig.app.json` is clean.
- [ ] `npm run build:prod` succeeds with no new errors.
- [ ] `git log --oneline -6` shows the four refactor commits from Tasks 1–4 in order on top of the previous head.
- [ ] `src/app/home/` no longer exists.
- [ ] `src/app/app.routes.ts` has three routes: `''` redirect, `home` → `GamesComponent`, `tv` → `TvComponent`, plus the `**` wildcard.
- [ ] The navbar markup has Home, TV, and the sign-in `@if` — no Games link.
- [ ] The `body.home-page` block is gone from `src/styles.scss`; the `body.games-page` block is unchanged.

## Manual verification (operator, not subagent)

After the implementation completes:

1. `npm start` → visit `http://localhost:4200/`. Expect a redirect to `/home` rendering the dark games-browse surface (search bar, genre strip, hero, list).
2. Confirm the navbar shows brand · Home · TV (desktop only) · Sign-in/user-chip.
3. Visit `http://localhost:4200/games` directly. Expect the wildcard to redirect to `/home`.
4. Confirm filtering, search, hero, genre strip, and the filter sheet all behave the same way they did at the old `/games` URL.
