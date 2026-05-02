# TV / QR Display Page Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add a `/tv` route with a desktop-only navbar link that shows a large QR code encoding the deployed site URL, intended for display on a TV during game day.

**Architecture:** New standalone Angular component renders a QR code into a `<canvas>` using the `qrcode` npm package. The encoded URL is computed at runtime as `window.location.origin + '/golgari-game-day/'` so dev and prod both Just Work. Navbar gets a third link gated by a new `.desktop-only` class that hides it below 1024px.

**Tech Stack:** Angular 20 standalone components, Angular Material (existing nav styling), `qrcode` npm package (^1.5.x) for client-side generation, SCSS with the project's existing design-token variables.

**Testing note:** This project has no unit-test runner wired up (per `CLAUDE.md` — `tsconfig.spec.json` is gone, Karma/Jasmine specs removed). TDD steps are replaced with explicit manual verification using the dev server. Do not run `ng test`.

**Spec:** [plans/2026-05-02-tv-qr-page-spec.md](./2026-05-02-tv-qr-page-spec.md)

---

## File Structure

**New files:**
- `src/app/tv/tv.component.ts` — standalone component class with QR rendering.
- `src/app/tv/tv.component.html` — heading, canvas, URL caption.
- `src/app/tv/tv.component.scss` — full-viewport dark layout, centered column.

**Modified files:**
- `package.json` / `package-lock.json` — `qrcode` + `@types/qrcode` added.
- `src/app/app.routes.ts` — register `/tv` route.
- `src/app/navbar/navbar.component.html` — add third nav link.
- `src/app/navbar/navbar.component.scss` — add `.desktop-only` utility class.

---

### Task 1: Install qrcode dependency

**Files:**
- Modify: `package.json`
- Modify: `package-lock.json` (auto-updated by npm)

- [ ] **Step 1: Install runtime and types packages**

Run from repo root:

```bash
npm install qrcode@^1.5.4
npm install --save-dev @types/qrcode@^1.5.5
```

- [ ] **Step 2: Verify package.json reflects the new entries**

Open `package.json` and confirm:
- `dependencies` includes a line for `"qrcode"` with a `^1.5.x` version.
- `devDependencies` includes a line for `"@types/qrcode"`.

- [ ] **Step 3: Verify the import resolves**

Run:

```bash
node -e "console.log(typeof require('qrcode').toCanvas)"
```

Expected output: `function`

- [ ] **Step 4: Commit**

```bash
git add package.json package-lock.json
git commit -m "chore(deps): add qrcode for TV display page"
```

---

### Task 2: Create the TvComponent skeleton (TypeScript)

**Files:**
- Create: `src/app/tv/tv.component.ts`

- [ ] **Step 1: Create the component file**

Create `src/app/tv/tv.component.ts` with this exact content:

```ts
import { AfterViewInit, Component, ElementRef, ViewChild } from '@angular/core';
import { CommonModule } from '@angular/common';
import * as QRCode from 'qrcode';

@Component({
  selector: 'app-tv',
  standalone: true,
  imports: [CommonModule],
  templateUrl: './tv.component.html',
  styleUrls: ['./tv.component.scss']
})
export class TvComponent implements AfterViewInit {
  @ViewChild('qrCanvas', { static: true }) canvasRef!: ElementRef<HTMLCanvasElement>;

  readonly url = window.location.origin + '/golgari-game-day/';

  ngAfterViewInit(): void {
    QRCode.toCanvas(this.canvasRef.nativeElement, this.url, {
      width: 480,
      margin: 2
    }).catch((err: unknown) => {
      console.error('Failed to render QR code:', err);
    });
  }
}
```

Notes:
- `static: true` is required because we read `canvasRef` in `ngAfterViewInit` and the canvas is unconditionally rendered (no `*ngIf`); Angular allows static queries for stable references.
- `import * as QRCode` is correct for the `qrcode` package's CommonJS export shape; `@types/qrcode` types will validate `toCanvas`.
- The `url` field is `readonly` and computed at construction time — fine because Angular instantiates the component on route activation, by which point `window.location` is populated.

- [ ] **Step 2: Verify TypeScript compiles (no errors)**

Run:

```bash
npx tsc --noEmit -p tsconfig.app.json
```

Expected: no output (clean exit). If you see errors mentioning `qrcode`, double-check Task 1 installed `@types/qrcode`.

- [ ] **Step 3: Commit**

```bash
git add src/app/tv/tv.component.ts
git commit -m "feat(tv): add TvComponent class skeleton"
```

---

### Task 3: Add the TvComponent template

**Files:**
- Create: `src/app/tv/tv.component.html`

- [ ] **Step 1: Create the template file**

Create `src/app/tv/tv.component.html` with this exact content:

```html
<div class="tv-page">
  <h1 class="tv-heading">Scan to join Game Day</h1>
  <canvas #qrCanvas class="tv-qr"></canvas>
  <p class="tv-url">{{ url }}</p>
</div>
```

- [ ] **Step 2: Commit**

```bash
git add src/app/tv/tv.component.html
git commit -m "feat(tv): add TvComponent template"
```

---

### Task 4: Add the TvComponent styles

**Files:**
- Create: `src/app/tv/tv.component.scss`

- [ ] **Step 1: Create the stylesheet**

Create `src/app/tv/tv.component.scss` with this exact content:

```scss
:host {
  display: block;
}

.tv-page {
  background-color: var(--golgari-black, #2d2d2d);
  min-height: calc(100vh - 64px);
  display: flex;
  flex-direction: column;
  align-items: center;
  justify-content: center;
  gap: var(--spacing-lg, 24px);
  padding: var(--spacing-lg, 24px);
  box-sizing: border-box;
}

.tv-heading {
  color: white;
  font-size: 2.5rem;
  font-weight: 600;
  margin: 0;
  text-align: center;
}

.tv-qr {
  display: block;
  // Width/height are set by the qrcode library on the canvas element itself (480px).
  // Keep this rule for layout predictability.
  width: 480px;
  height: 480px;
  max-width: 90vw;
  max-height: 60vh;
}

.tv-url {
  color: var(--rating-gold, #ffd700);
  font-family: ui-monospace, SFMono-Regular, Menlo, Consolas, monospace;
  font-size: 1.25rem;
  letter-spacing: 0.05em;
  margin: 0;
  text-align: center;
  word-break: break-all;
}
```

Notes:
- `var(--golgari-black, #2d2d2d)` and the other variables include fallback values so the page still renders if the design tokens haven't loaded for any reason.
- `min-height: calc(100vh - 64px)` accounts for the sticky 64px navbar above.
- `max-width: 90vw` on the canvas keeps things sane if someone opens `/tv` on a phone (out of scope but not catastrophic).

- [ ] **Step 2: Commit**

```bash
git add src/app/tv/tv.component.scss
git commit -m "feat(tv): add TvComponent styles"
```

---

### Task 5: Register the /tv route

**Files:**
- Modify: `src/app/app.routes.ts`

- [ ] **Step 1: Update the routes file**

Replace the entire contents of `src/app/app.routes.ts` with:

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

Note: the `/tv` route is placed before the wildcard so it is matched correctly.

- [ ] **Step 2: Verify TypeScript compiles**

Run:

```bash
npx tsc --noEmit -p tsconfig.app.json
```

Expected: no output (clean exit).

- [ ] **Step 3: Commit**

```bash
git add src/app/app.routes.ts
git commit -m "feat(tv): register /tv route"
```

---

### Task 6: Add the desktop-only navbar link

**Files:**
- Modify: `src/app/navbar/navbar.component.html`
- Modify: `src/app/navbar/navbar.component.scss`

- [ ] **Step 1: Update the navbar template**

Replace the entire contents of `src/app/navbar/navbar.component.html` with:

```html
<mat-toolbar color="primary" class="navbar">
  <span class="title">🏰 Golgari Palace Game Day</span>
  <span class="spacer"></span>

  <div class="nav-links">
    <a mat-button routerLink="/home" routerLinkActive="active" class="nav-link">
      <mat-icon>home</mat-icon>
      <span class="nav-text">Home</span>
    </a>
    <a mat-button routerLink="/games" routerLinkActive="active" class="nav-link">
      <mat-icon>sports_esports</mat-icon>
      <span class="nav-text">Games</span>
    </a>
    <a mat-button routerLink="/tv" routerLinkActive="active" class="nav-link desktop-only">
      <mat-icon>qr_code_2</mat-icon>
      <span class="nav-text">TV</span>
    </a>
  </div>
</mat-toolbar>

<div class="content">
  <ng-content></ng-content>
</div>
```

- [ ] **Step 2: Add the desktop-only utility to the navbar styles**

Append the following block to the **end** of `src/app/navbar/navbar.component.scss` (after the existing `@media (max-width: 480px)` block):

```scss
.desktop-only {
  @media (max-width: 1023px) {
    display: none !important;
  }
}
```

The `!important` is required to override Angular Material's default `display` on `mat-button`-styled anchors (the existing `.nav-link` rule already uses `!important` for the same reason).

- [ ] **Step 3: Commit**

```bash
git add src/app/navbar/navbar.component.html src/app/navbar/navbar.component.scss
git commit -m "feat(navbar): add desktop-only TV link"
```

---

### Task 7: Manual verification — dev server

**Files:**
- None (read-only verification)

- [ ] **Step 1: Start the dev server**

Run:

```bash
npm start
```

Wait for the "Local: http://localhost:4200/" message.

- [ ] **Step 2: Verify the navbar at desktop width**

In a browser at viewport ≥ 1024px wide, open `http://localhost:4200/`. Confirm:
- Three nav links appear: Home, Games, **TV** (with `qr_code_2` icon).
- Clicking **TV** navigates to `/tv`.

- [ ] **Step 3: Verify the TV page renders**

On `/tv`, confirm:
- Dark background fills the area below the toolbar.
- Heading "Scan to join Game Day" is visible in white.
- A 480px QR code renders below the heading.
- The URL `http://localhost:4200/golgari-game-day/` is shown in monospace below the QR.

- [ ] **Step 4: Verify the QR code scans**

Use a phone camera or QR-reader app to scan the QR on screen. Expected: the phone offers to open `http://localhost:4200/golgari-game-day/` (or whatever the dev URL is). The link won't actually load on the phone unless it's on the same network — that's fine; we're only confirming the QR encodes the right URL.

- [ ] **Step 5: Verify the navbar link hides on tablet/mobile**

In the browser dev tools, switch to a responsive viewport ≤ 1023px wide (e.g., 768px). Confirm:
- The **TV** link disappears from the navbar.
- Home and Games links remain (Games shrinks to icon-only at ≤ 768px, which is existing behavior — unchanged).

- [ ] **Step 6: Stop the dev server**

`Ctrl+C` in the terminal running `npm start`.

---

### Task 8: Production build verification

**Files:**
- None (read-only verification)

- [ ] **Step 1: Run the production build**

Run:

```bash
npm run build:prod
```

Expected: completes without errors. The `flatten-build` step copies `docs/browser/*` up to `docs/`.

- [ ] **Step 2: Confirm the bundle includes qrcode**

Run:

```bash
grep -l "qrcode" docs/main*.js
```

Expected: at least one matching file path. (The literal string `qrcode` should appear in the bundled output because the package's source contains it.)

- [ ] **Step 3: No commit**

This task produces only the `docs/` build artifact, which is `.gitignore`d. Nothing to commit.

---

## Verification checklist (final)

Before marking the feature complete, confirm:

- [ ] `npm start` runs without errors and the TV link is visible on desktop (≥ 1024px).
- [ ] The TV link is hidden on viewports < 1024px.
- [ ] The `/tv` page shows a scannable QR encoding `<origin>/golgari-game-day/`.
- [ ] `npx tsc --noEmit -p tsconfig.app.json` is clean.
- [ ] `npm run lint` is clean (run it once at the end).
- [ ] `npm run build:prod` succeeds.
- [ ] All commits from Tasks 1–6 are on the branch in order.
