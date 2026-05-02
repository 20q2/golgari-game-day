# Name-based Sign-In Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Prompt new visitors for a chosen name (saved to localStorage), gate likes/ratings/comments behind a name being set, and derive `userId` from the name so the same identity works across devices.

**Architecture:** A new `UserService` (`providedIn: 'root'`) owns identity in localStorage and exposes signals for `userId`, `username`, and `isSignedIn`. A new `SignInDialogComponent` (Material dialog) is opened via `UserService.requireSignIn()` — called from the navbar (explicit sign-in) and from action handlers (just-in-time gating). `AwsApiService` and `GamesService` are refactored to read identity from `UserService`. Random-name / random-id fallbacks are removed only after all gates are in place, so behavior is never broken mid-plan.

**Tech Stack:** Angular 20 standalone components, Angular signals (`signal`, `computed`), Angular Material (`MatDialog`, `MatFormField`, `MatInput`, `MatButton`, `MatIcon`), `FormsModule`, localStorage. No test runner is wired in this project (Karma was removed) — verification is manual via `npm start` plus `npm run build` and `npm run lint`. TDD-style steps are adapted to "write code, then build/lint/visually verify."

**Spec:** [`specs/2026-05-02-name-sign-in-design.md`](../specs/2026-05-02-name-sign-in-design.md)

---

## File Structure

**New:**

- `src/app/services/user.service.ts` — identity signals + `setUsername` + `requireSignIn`
- `src/app/components/sign-in-dialog/sign-in-dialog.component.ts` — Material dialog
- `src/app/components/sign-in-dialog/sign-in-dialog.component.html`
- `src/app/components/sign-in-dialog/sign-in-dialog.component.scss`

**Modified:**

- `src/app/services/aws-api.service.ts` — inject `UserService`; route internal identity reads through it; (in final task) drop random fallbacks in `generateUserId()` / `getUserName()`.
- `src/app/services/games.service.ts` — replace `awsApi.generateUserId()` / `awsApi.getUserName()` calls in `addComment`, `addRating`, `toggleLike` with `userService` reads.
- `src/app/navbar/navbar.component.ts` — inject `UserService`.
- `src/app/navbar/navbar.component.html` — add right-side sign-in slot.
- `src/app/navbar/navbar.component.scss` — minor styling for the slot.
- `src/app/game-details-dialog/game-details-dialog.component.ts` — gate `addComment` behind `requireSignIn`.
- `src/app/games/games.component.ts` — gate `toggleLike` behind `requireSignIn`.

**Unchanged:**

- All Lambda / Python / CDK code under `infrastructure/`.
- `aws-test.component.ts` (debug-only component, not in any route).
- All other components, the routing, the games JSON catalog.

---

## Task 1: Create UserService

**Files:**

- Create: `src/app/services/user.service.ts`

- [ ] **Step 1: Create the service file with the full contents below**

```ts
import { Injectable, computed, signal } from '@angular/core';
import { MatDialog } from '@angular/material/dialog';

const USERNAME_STORAGE_KEY = 'gameday-username';
const USER_ID_STORAGE_KEY = 'gameday-user-id';

/** Lowercase, hyphen-separated; non-alphanumeric characters collapsed to single hyphens. */
function slugify(name: string): string {
  return name
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '');
}

@Injectable({ providedIn: 'root' })
export class UserService {
  private readonly _userId = signal<string | null>(null);
  private readonly _username = signal<string | null>(null);

  readonly userId = this._userId.asReadonly();
  readonly username = this._username.asReadonly();
  readonly isSignedIn = computed(() => this._username() !== null);

  constructor(private dialog: MatDialog) {
    this._userId.set(localStorage.getItem(USER_ID_STORAGE_KEY));
    this._username.set(localStorage.getItem(USERNAME_STORAGE_KEY));
  }

  /** One-shot. No-op if already signed in. */
  setUsername(rawName: string): void {
    if (this.isSignedIn()) {
      return;
    }
    const name = rawName.trim();
    if (name.length === 0) {
      return;
    }
    const slug = slugify(name);
    if (slug.length === 0) {
      return;
    }
    const userId = `user-${slug}`;
    localStorage.setItem(USERNAME_STORAGE_KEY, name);
    localStorage.setItem(USER_ID_STORAGE_KEY, userId);
    this._username.set(name);
    this._userId.set(userId);
  }

  /**
   * Resolves true if the user is signed in. STUB: the body is filled in at the end
   * of Task 2, after SignInDialogComponent exists. For now we just reflect current
   * state so callers compile and behave correctly when already signed in.
   */
  async requireSignIn(): Promise<boolean> {
    return this.isSignedIn();
  }
}
```

Notes:
- `MatDialog` is injected up-front so the constructor signature won't churn in Task 2.
- `requireSignIn` is a stub in this task — it returns true only if the user is already signed in. No dialog yet, so an unsigned user gets `false`. That's fine because the navbar (Task 3) and the gated action handlers (Tasks 6 & 7) aren't wired yet either.
- Task 2 fills in the real body, which dynamically imports `SignInDialogComponent` to avoid a circular import (the dialog component itself injects `UserService`).

- [ ] **Step 2: Build**

Run: `npm run build`
Expected: succeeds.

- [ ] **Step 3: Lint**

Run: `npm run lint`
Expected: zero errors.

- [ ] **Step 4: Commit**

```bash
git add src/app/services/user.service.ts
git commit -m "feat(user): add UserService for name-based identity"
```

---

## Task 2: Create SignInDialogComponent

**Files:**

- Create: `src/app/components/sign-in-dialog/sign-in-dialog.component.ts`
- Create: `src/app/components/sign-in-dialog/sign-in-dialog.component.html`
- Create: `src/app/components/sign-in-dialog/sign-in-dialog.component.scss`

- [ ] **Step 1: Create the component TypeScript**

`src/app/components/sign-in-dialog/sign-in-dialog.component.ts`:

```ts
import { Component } from '@angular/core';
import { CommonModule } from '@angular/common';
import { FormsModule } from '@angular/forms';
import { MatButtonModule } from '@angular/material/button';
import { MatDialogModule, MatDialogRef } from '@angular/material/dialog';
import { MatFormFieldModule } from '@angular/material/form-field';
import { MatIconModule } from '@angular/material/icon';
import { MatInputModule } from '@angular/material/input';
import { UserService } from '../../services/user.service';

@Component({
  selector: 'app-sign-in-dialog',
  standalone: true,
  imports: [
    CommonModule,
    FormsModule,
    MatButtonModule,
    MatDialogModule,
    MatFormFieldModule,
    MatIconModule,
    MatInputModule,
  ],
  templateUrl: './sign-in-dialog.component.html',
  styleUrls: ['./sign-in-dialog.component.scss'],
})
export class SignInDialogComponent {
  name = '';
  readonly maxLength = 32;

  constructor(
    private dialogRef: MatDialogRef<SignInDialogComponent, string | null>,
    private userService: UserService
  ) {}

  get trimmed(): string {
    return this.name.trim();
  }

  get isValid(): boolean {
    return this.trimmed.length >= 1 && this.trimmed.length <= this.maxLength;
  }

  save(): void {
    if (!this.isValid) return;
    this.userService.setUsername(this.trimmed);
    this.dialogRef.close(this.trimmed);
  }

  cancel(): void {
    this.dialogRef.close(null);
  }
}
```

- [ ] **Step 2: Create the component HTML**

`src/app/components/sign-in-dialog/sign-in-dialog.component.html`:

```html
<h2 mat-dialog-title>
  <mat-icon class="title-icon">person</mat-icon>
  Who are you?
</h2>

<mat-dialog-content>
  <p class="hint">
    Pick the name your friends know you by. We'll attach it to anything you like, rate, or comment on.
  </p>

  <mat-form-field appearance="outline" class="name-field">
    <mat-label>Your name</mat-label>
    <input
      matInput
      type="text"
      [(ngModel)]="name"
      [maxlength]="maxLength"
      autocomplete="given-name"
      autofocus
      (keydown.enter)="save()"
    />
    <mat-hint align="end">{{ trimmed.length }}/{{ maxLength }}</mat-hint>
  </mat-form-field>
</mat-dialog-content>

<mat-dialog-actions align="end">
  <button mat-button type="button" (click)="cancel()">Cancel</button>
  <button
    mat-flat-button
    color="primary"
    type="button"
    [disabled]="!isValid"
    (click)="save()"
  >
    Save
  </button>
</mat-dialog-actions>
```

- [ ] **Step 3: Create the component SCSS**

`src/app/components/sign-in-dialog/sign-in-dialog.component.scss`:

```scss
:host {
  display: block;
}

h2[mat-dialog-title] {
  display: flex;
  align-items: center;
  gap: var(--spacing-sm);
  margin: 0;

  .title-icon {
    color: var(--primary-color, #4a7c59);
  }
}

.hint {
  margin: 0 0 var(--spacing-md);
  color: rgba(0, 0, 0, 0.7);
  font-size: 0.9rem;
  line-height: 1.4;
}

.name-field {
  width: 100%;
}
```

- [ ] **Step 4: Fill in `UserService.requireSignIn` body**

Open `src/app/services/user.service.ts`. Replace the stubbed body:

```ts
  async requireSignIn(): Promise<boolean> {
    return this.isSignedIn();
  }
```

with the real implementation that opens the dialog:

```ts
  async requireSignIn(): Promise<boolean> {
    if (this.isSignedIn()) {
      return true;
    }
    const { SignInDialogComponent } = await import(
      '../components/sign-in-dialog/sign-in-dialog.component'
    );
    const result = await this.dialog
      .open<SignInDialogComponent, void, string | null>(SignInDialogComponent, {
        width: '320px',
        disableClose: false,
      })
      .afterClosed()
      .toPromise();
    return result != null && this.isSignedIn();
  }
```

The dynamic `import()` is intentional: `SignInDialogComponent` injects `UserService`, so a static top-level import would be a true circular reference. The dynamic import is resolved at runtime when `requireSignIn` is first called, breaking the cycle.

- [ ] **Step 5: Build**

Run: `npm run build`
Expected: succeeds. The bundler will emit a small lazy chunk for `sign-in-dialog.component`.

- [ ] **Step 6: Lint**

Run: `npm run lint`
Expected: zero errors.

- [ ] **Step 7: Commit**

```bash
git add src/app/components/sign-in-dialog/ src/app/services/user.service.ts
git commit -m "feat(sign-in): add SignInDialogComponent and wire requireSignIn"
```

---

## Task 3: Add navbar sign-in slot

**Files:**

- Modify: `src/app/navbar/navbar.component.ts`
- Modify: `src/app/navbar/navbar.component.html`
- Modify: `src/app/navbar/navbar.component.scss`

- [ ] **Step 1: Inject UserService into the navbar component**

Replace the entire contents of `src/app/navbar/navbar.component.ts` with:

```ts
import { Component, inject } from '@angular/core';
import { CommonModule } from '@angular/common';
import { RouterModule } from '@angular/router';
import { MatToolbarModule } from '@angular/material/toolbar';
import { MatButtonModule } from '@angular/material/button';
import { MatIconModule } from '@angular/material/icon';
import { UserService } from '../services/user.service';

@Component({
  selector: 'app-navbar',
  standalone: true,
  imports: [
    CommonModule,
    RouterModule,
    MatToolbarModule,
    MatButtonModule,
    MatIconModule
  ],
  templateUrl: './navbar.component.html',
  styleUrls: ['./navbar.component.scss']
})
export class NavbarComponent {
  protected readonly userService = inject(UserService);

  async openSignIn(): Promise<void> {
    await this.userService.requireSignIn();
  }
}
```

- [ ] **Step 2: Add the sign-in slot to the navbar HTML**

Replace `src/app/navbar/navbar.component.html` with:

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

    @if (userService.isSignedIn()) {
      <span class="user-chip" [attr.title]="userService.username()">
        <mat-icon>person</mat-icon>
        <span class="user-name">{{ userService.username() }}</span>
      </span>
    } @else {
      <button mat-button class="nav-link sign-in-button" (click)="openSignIn()">
        <mat-icon>person_outline</mat-icon>
        <span class="nav-text">Sign in</span>
      </button>
    }
  </div>
</mat-toolbar>

<div class="content">
  <ng-content></ng-content>
</div>
```

- [ ] **Step 3: Add SCSS for the new slot**

Append to `src/app/navbar/navbar.component.scss`:

```scss
.user-chip {
  display: flex;
  align-items: center;
  gap: var(--spacing-xs);
  color: white;
  padding: var(--spacing-xs) var(--spacing-sm);
  border-radius: var(--border-radius-sm);
  background-color: rgba(74, 124, 89, 0.25);
  min-height: 36px;
  max-width: 180px;

  mat-icon {
    font-size: 1.1rem;
    width: 1.1rem;
    height: 1.1rem;
    flex-shrink: 0;
  }

  .user-name {
    font-size: 0.875rem;
    font-weight: 500;
    white-space: nowrap;
    overflow: hidden;
    text-overflow: ellipsis;
  }
}

.sign-in-button {
  // Inherits .nav-link styles. Nothing extra needed unless we want to differentiate.
}

@media (max-width: 768px) {
  .user-chip {
    max-width: 110px;
    padding: var(--spacing-xs);
    .user-name {
      font-size: 0.8rem;
    }
  }
}

@media (max-width: 480px) {
  .user-chip {
    .user-name {
      display: none; // icon-only on very small screens, like the route nav-text
    }
  }
}
```

- [ ] **Step 4: Build**

Run: `npm run build`
Expected: succeeds.

- [ ] **Step 5: Lint**

Run: `npm run lint`
Expected: zero errors.

- [ ] **Step 6: Manual smoke test (sign-in flow only)**

Run: `npm start`. Open `http://localhost:4200/`.

- Open dev tools → Application → Local Storage → `http://localhost:4200`. Note any pre-existing `gameday-username` / `gameday-user-id` values.
- **If both keys already exist** (legacy state): the navbar should show your existing name in a chip. No "Sign in" button. Skip the next bullet.
- **If neither key exists, or only `gameday-user-id` exists:** delete both keys via dev tools, refresh. Navbar should show a "Sign in" button.
  - Click "Sign in". Dialog opens with "Who are you?" title and an empty input.
  - Save button is disabled until you type. After typing "Andrew", Save enables.
  - Click Save. Dialog closes; navbar updates to show "Andrew" in a chip with the person icon.
  - Application tab → Local Storage now has `gameday-username = Andrew` and `gameday-user-id = user-andrew`.
  - Refresh the page. Chip persists.
  - Test cancel: delete localStorage keys, refresh, click "Sign in", click Cancel (or press ESC). Dialog closes; navbar still shows "Sign in". localStorage unchanged.

Stop dev server.

- [ ] **Step 7: Commit**

```bash
git add src/app/navbar/navbar.component.ts src/app/navbar/navbar.component.html src/app/navbar/navbar.component.scss
git commit -m "feat(navbar): add sign-in slot wired to UserService"
```

---

## Task 4: Route GamesService identity through UserService

**Files:**

- Modify: `src/app/services/games.service.ts`

- [ ] **Step 1: Inspect current callers**

Open `src/app/services/games.service.ts`. The methods `addComment` (~line 82), `addRating` (~line 115), and `toggleLike` (~line 185) each currently start with:

```ts
const userId = this.awsApi.generateUserId();
const username = this.awsApi.getUserName();
```

We will replace each block with reads from `UserService`. Gating happens in the calling components (Tasks 6 and 7) — by the time these service methods run, the user must already be signed in.

- [ ] **Step 2: Inject UserService into GamesService**

In `games.service.ts`, find the constructor. Add the `UserService` import at the top and inject it. The exact diff: locate the existing import block and add:

```ts
import { UserService } from './user.service';
```

Then in the constructor parameter list, add `private userService: UserService` alongside the existing injections (the constructor is in the class body — find it by searching for `constructor(`).

- [ ] **Step 3: Replace identity reads in `addComment`**

Find the body of `addComment` (around line 82). Replace:

```ts
const userId = this.awsApi.generateUserId();
// Use provided username or generate one
const username = comment.username.trim() || this.awsApi.getUserName();
```

with:

```ts
const userId = this.userService.userId();
const username = this.userService.username();
if (!userId || !username) {
  throw new Error('addComment called without a signed-in user');
}
```

This throw is a defensive guard — production code should never hit it because `addComment` is only called by gated handlers. The guard makes a regression loud instead of silent.

- [ ] **Step 4: Replace identity reads in `addRating`**

Find the body of `addRating` (around line 115). Replace:

```ts
const userId = this.awsApi.generateUserId();
const username = this.awsApi.getUserName();
```

with:

```ts
const userId = this.userService.userId();
const username = this.userService.username();
if (!userId || !username) {
  throw new Error('addRating called without a signed-in user');
}
```

- [ ] **Step 5: Replace identity reads in `toggleLike`**

Find the body of `toggleLike` (around line 185). It reads identity twice — once for the `addLike` cache update and once for the `removeLike` call. Replace the block:

```ts
const userId = this.awsApi.generateUserId();
const username = this.awsApi.getUserName();
```

with:

```ts
const userId = this.userService.userId();
const username = this.userService.username();
if (!userId || !username) {
  throw new Error('toggleLike called without a signed-in user');
}
```

The downstream `this.dataAggregation.addLike(...)` and `this.dataAggregation.removeLike(gameId, userId)` calls already use those locals — leave them.

- [ ] **Step 6: Build**

Run: `npm run build`
Expected: succeeds.

- [ ] **Step 7: Lint**

Run: `npm run lint`
Expected: zero errors.

- [ ] **Step 8: Commit**

```bash
git add src/app/services/games.service.ts
git commit -m "refactor(games-service): read identity from UserService"
```

---

## Task 5: Route AwsApiService internal identity reads through UserService

**Files:**

- Modify: `src/app/services/aws-api.service.ts`

`AwsApiService` calls `this.generateUserId()` / `this.getUserName()` internally in `getLikes` (line ~240), `toggleLike` (lines ~279–280), and `getAllLikes` (line ~367). For *read* paths (`getLikes`, `getAllLikes`), userId is needed even when the user is not signed in — to compute `isLikedByCurrentUser`. We pass an empty string in that case and rely on the server to return `false`. For the *write* path (`toggleLike`), the action is gated upstream so identity must be set; we throw if not.

In this task we keep the public `generateUserId()` / `getUserName()` methods intact (random fallback still in place) so any external caller we missed continues to work. Task 8 removes those fallbacks at the end.

- [ ] **Step 1: Inject UserService**

In `src/app/services/aws-api.service.ts`, add the import:

```ts
import { UserService } from './user.service';
```

Replace the constructor:

```ts
constructor() {}
```

with:

```ts
constructor(private userService: UserService) {}
```

- [ ] **Step 2: Update `getLikes` to read userId from UserService**

Find the line (around 240):

```ts
const response = await fetch(`${this.API_BASE_URL}/likes/${gameId}?userId=${this.generateUserId()}`, {
```

Replace with:

```ts
const userId = this.userService.userId() ?? '';
const response = await fetch(`${this.API_BASE_URL}/likes/${gameId}?userId=${encodeURIComponent(userId)}`, {
```

- [ ] **Step 3: Update `toggleLike` body**

Find lines 278–281 (the body inside `body: JSON.stringify({...})`):

```ts
body: JSON.stringify({
  userId: this.generateUserId(),
  username: this.getUserName()
}),
```

Replace with:

```ts
body: JSON.stringify({
  userId: this.userService.userId(),
  username: this.userService.username(),
}),
```

`toggleLike` is a write operation — by the time it reaches here the user is signed in (gated in `GamesComponent`), so both signals are non-null.

- [ ] **Step 4: Update `getAllLikes`**

Find the line (around 367):

```ts
const response = await fetch(`${this.API_BASE_URL}/all-likes?userId=${this.generateUserId()}`, {
```

Replace with:

```ts
const userId = this.userService.userId() ?? '';
const response = await fetch(`${this.API_BASE_URL}/all-likes?userId=${encodeURIComponent(userId)}`, {
```

- [ ] **Step 5: Build**

Run: `npm run build`
Expected: succeeds.

- [ ] **Step 6: Lint**

Run: `npm run lint`
Expected: zero errors.

- [ ] **Step 7: Manual smoke test (likes still work for signed-in users)**

Run: `npm start`. Sign in (or use legacy name). Navigate to `/games`, click the heart on a game, verify the count updates. Refresh, verify the heart is still filled (server roundtrip). Open another game card, verify it loads without console errors.

Verify in dev tools Network tab that requests to `/likes/...` and `/all-likes` include `userId=user-yourname` (or your legacy id) in the query string.

Stop dev server.

- [ ] **Step 8: Commit**

```bash
git add src/app/services/aws-api.service.ts
git commit -m "refactor(aws-api): read identity from UserService internally"
```

---

## Task 6: Gate addComment in GameDetailsDialogComponent

**Files:**

- Modify: `src/app/game-details-dialog/game-details-dialog.component.ts`

The `newComment.username` field on the dialog form is no longer needed — username comes from `UserService`. We leave the field in the local form interface (for now) but stop passing it; `GamesService.addComment` reads from `UserService`. The field is kept to minimize churn; cleaning it up is out of scope.

- [ ] **Step 1: Inject UserService**

Open `src/app/game-details-dialog/game-details-dialog.component.ts`. Add the import:

```ts
import { UserService } from '../services/user.service';
```

Add a constructor param. The constructor currently looks like:

```ts
constructor(
  public dialogRef: MatDialogRef<GameDetailsDialogComponent>,
  @Inject(MAT_DIALOG_DATA) public game: Game,
  private gamesService: GamesService,
  public iconService: GenreIconService
) {}
```

Add `private userService: UserService` as the last parameter:

```ts
constructor(
  public dialogRef: MatDialogRef<GameDetailsDialogComponent>,
  @Inject(MAT_DIALOG_DATA) public game: Game,
  private gamesService: GamesService,
  public iconService: GenreIconService,
  private userService: UserService
) {}
```

- [ ] **Step 2: Gate `addComment`**

Find the `addComment` method (around line 97). Insert a sign-in gate at the top of the method, after the empty-comment guard. Current method begins:

```ts
async addComment(): Promise<void> {
  if (!this.newComment.comment.trim()) {
    return;
  }

  this.isSubmitting = true;
  try {
    await this.gamesService.addComment(this.game.id, {
      ...
```

Modified:

```ts
async addComment(): Promise<void> {
  if (!this.newComment.comment.trim()) {
    return;
  }

  if (!(await this.userService.requireSignIn())) {
    return;
  }

  this.isSubmitting = true;
  try {
    await this.gamesService.addComment(this.game.id, {
      ...
```

The `username` field of the payload is now ignored by `GamesService` (which reads from `UserService`), but we leave the form binding in place — removing it would touch the template and is out of scope here.

- [ ] **Step 3: Build**

Run: `npm run build`
Expected: succeeds.

- [ ] **Step 4: Lint**

Run: `npm run lint`
Expected: zero errors.

- [ ] **Step 5: Manual smoke test (gated comment)**

Run: `npm start`. Clear localStorage (`gameday-username` and `gameday-user-id`). Refresh.

- Navigate to `/games`, click a game card to open the dialog.
- Type a comment in the comment box. Pick a rating. Click "Add Comment" (or whatever the submit button says).
- The sign-in dialog should open over the game-details dialog.
- Type "Andrew" → Save. Sign-in dialog closes, comment submission proceeds. Verify the comment appears in the list.
- Cancel path: remove localStorage again, refresh, open a game, type a comment, submit, hit Cancel on sign-in dialog. The comment is *not* posted; the typed text is still in the input.

Stop dev server.

- [ ] **Step 6: Commit**

```bash
git add src/app/game-details-dialog/game-details-dialog.component.ts
git commit -m "feat(comments): gate comment submission behind sign-in"
```

---

## Task 7: Gate toggleLike in GamesComponent

**Files:**

- Modify: `src/app/games/games.component.ts`

- [ ] **Step 1: Inject UserService**

Open `src/app/games/games.component.ts`. Add the import alongside the other service imports near the top of the file:

```ts
import { UserService } from '../services/user.service';
```

The component uses constructor-injection style. Find the existing constructor (lines 58–66) and add `private userService: UserService` as the last parameter. Final shape:

```ts
constructor(
  private gamesService: GamesService,
  private dialog: MatDialog,
  private dataAggregation: DataAggregationService,
  public iconService: GenreIconService,
  private userService: UserService,
) {
  // Get the reactive games observable that responds to all filter/sort changes
  this.games$ = this.gamesService.getGames();
}
```

- [ ] **Step 2: Gate `toggleLike`**

Find the `toggleLike` method (line 173):

```ts
async toggleLike(game: Game, event: Event): Promise<void> {
  event.stopPropagation(); // Prevent card click
  
  try {
    await this.gamesService.toggleLike(game.id);
    console.log(`✅ Like toggled for game ${game.id}`);
  } catch (error) {
    console.error('❌ Failed to toggle like:', error);
  }
}
```

Replace with:

```ts
async toggleLike(game: Game, event: Event): Promise<void> {
  event.stopPropagation(); // Prevent card click

  if (!(await this.userService.requireSignIn())) {
    return;
  }

  try {
    await this.gamesService.toggleLike(game.id);
    console.log(`✅ Like toggled for game ${game.id}`);
  } catch (error) {
    console.error('❌ Failed to toggle like:', error);
  }
}
```

- [ ] **Step 3: Build**

Run: `npm run build`
Expected: succeeds.

- [ ] **Step 4: Lint**

Run: `npm run lint`
Expected: zero errors.

- [ ] **Step 5: Manual smoke test (gated like)**

Run: `npm start`. Clear localStorage, refresh. Navigate to `/games`.

- Click the heart on a game card. Sign-in dialog opens.
- Save as "Andrew". Dialog closes; like fires immediately; heart fills; count increments.
- Click the same heart again — no dialog (already signed in); like toggles off.
- Test cancel: clear localStorage, refresh, click a heart, hit Cancel on the dialog. No like is recorded; navbar still shows "Sign in".

Stop dev server.

- [ ] **Step 6: Commit**

```bash
git add src/app/games/games.component.ts
git commit -m "feat(likes): gate like toggle behind sign-in"
```

---

## Task 8: Remove random fallbacks from AwsApiService

By this point, every write path is gated behind `requireSignIn()` and every internal read of identity routes through `UserService`. The legacy random-name and random-id fallbacks in `AwsApiService.generateUserId()` / `getUserName()` are no longer reachable from any active code path *unless* a caller outside the service still uses them. We verify the call sites and then remove the fallbacks.

**Files:**

- Modify: `src/app/services/aws-api.service.ts`

- [ ] **Step 1: Verify external callers**

Run: `grep -rn "awsApi\.generateUserId\|awsApi\.getUserName" src/app/`
Expected callers (only acceptable hits):
- `src/app/components/aws-test/aws-test.component.ts` — debug component, not in any route. Acceptable to leave broken; it isn't compiled into the production bundle's runtime path.

If any *other* file appears in the grep output, stop and route it through `UserService` first (mirror the Task 4 pattern). Do not proceed until the grep is clean except for `aws-test`.

- [ ] **Step 2: Remove the random fallbacks**

In `src/app/services/aws-api.service.ts`, find `generateUserId()` (around line 396) and `getUserName()` (around line 406). Replace both methods:

```ts
generateUserId(): string {
  // Simple user ID generation - in real app you'd use proper auth
  let userId = localStorage.getItem('gameday-user-id');
  if (!userId) {
    userId = 'user-' + Math.random().toString(36).substr(2, 9);
    localStorage.setItem('gameday-user-id', userId);
  }
  return userId;
}

getUserName(): string {
  // Simple username - in real app you'd use proper auth
  let username = localStorage.getItem('gameday-username');
  if (!username) {
    const randomNames = ['GameMaster', 'BoardGameFan', 'DiceRoller', 'CardShark', 'MeepleCollector'];
    username = randomNames[Math.floor(Math.random() * randomNames.length)] + Math.floor(Math.random() * 1000);
    localStorage.setItem('gameday-username', username);
  }
  return username;
}
```

with:

```ts
/** @deprecated Use UserService.userId() instead. Returns the current id or empty string. */
generateUserId(): string {
  return this.userService.userId() ?? '';
}

/** @deprecated Use UserService.username() instead. Returns the current name or empty string. */
getUserName(): string {
  return this.userService.username() ?? '';
}
```

We keep the methods as thin pass-throughs (rather than deleting them) only because `aws-test.component.ts` still calls them. Marking them `@deprecated` documents intent without breaking that debug component.

- [ ] **Step 3: Build**

Run: `npm run build`
Expected: succeeds.

- [ ] **Step 4: Lint**

Run: `npm run lint`
Expected: zero errors. (Deprecation warnings on internal `aws-test` callers are tolerable; if lint config flags them as errors, suppress with a single-line `// eslint-disable-next-line @typescript-eslint/no-deprecated` above each call inside `aws-test.component.ts`.)

- [ ] **Step 5: Commit**

```bash
git add src/app/services/aws-api.service.ts
git commit -m "refactor(aws-api): drop random-name fallbacks; pass-through to UserService"
```

---

## Task 9: Final smoke test, lint, build

**Files:** none new

- [ ] **Step 1: Search for stale references**

Run: `grep -rn "MeepleCollector\|GameMaster\|BoardGameFan\|DiceRoller\|CardShark" src/app/`
Expected: empty. (All references to the random-name array should be gone.)

Run: `grep -rn "Math.random().toString(36)" src/app/services/`
Expected: empty. (The random-id fallback should be gone.)

- [ ] **Step 2: Production build**

Run: `npm run build:prod`
Expected: build succeeds, `docs/index.html` exists at the top level (the `flatten-build` post-step ran).

- [ ] **Step 3: Lint**

Run: `npm run lint`
Expected: zero errors.

- [ ] **Step 4: End-to-end manual smoke test**

Run: `npm start`.

**Fresh visitor flow (clear localStorage first):**
- Open `http://localhost:4200/`. Navbar shows "Sign in".
- Click a game on `/games`. Open the details dialog.
- Try to comment without signing in → sign-in dialog opens → cancel → no comment posted, typed text preserved.
- Try to like a game card → sign-in dialog opens → save as "Andrew" → like fires, heart fills, navbar updates to show "Andrew".
- Comment on the dialog → comment posts under "Andrew".
- Refresh the page. Identity persists. Like state persists.

**Returning user on a "new device" (clear localStorage, sign in with same name):**
- Clear localStorage. Refresh. Sign in as "Andrew" again.
- The heart on the game you previously liked should be filled (server returned `isLikedByCurrentUser: true` for `userId = user-andrew`).

**Legacy user simulation:**
- In dev tools, set `gameday-user-id = user-legacy123` and `gameday-username = MeepleCollector42`. Refresh.
- Navbar shows "MeepleCollector42" in a chip. Like/comment work without further prompting.

**Two-tab consistency check (optional but useful):**
- Open the site in two tabs. Sign in on tab 1. Refresh tab 2. Tab 2 shows the signed-in chip (localStorage is shared per-origin).

Stop dev server.

- [ ] **Step 5: Bump version & patch notes**

The `bump-version` skill exists in this project for end-of-task version bumps. If the user wants a deploy-ready commit, run that skill (or manually bump `package.json` version + add a patch-notes entry). Otherwise skip.

- [ ] **Step 6: Verify final git state**

Run: `git status && git log --oneline -10`
Expected: working tree clean. The recent commits should include all 8 task commits in order:

1. `feat(user): add UserService for name-based identity`
2. `feat(sign-in): add SignInDialogComponent and wire requireSignIn`
3. `feat(navbar): add sign-in slot wired to UserService`
4. `refactor(games-service): read identity from UserService`
5. `refactor(aws-api): read identity from UserService internally`
6. `feat(comments): gate comment submission behind sign-in`
7. `feat(likes): gate like toggle behind sign-in`
8. `refactor(aws-api): drop random-name fallbacks; pass-through to UserService`

---

## Self-review notes

**Spec coverage check:**

- Goal 1 ("New visitors are prompted before liking/rating/commenting") — Tasks 6 & 7 (gating).
- Goal 2 ("Once signed in, the user's chosen name appears") — Tasks 4 & 5 (identity routes through UserService, which holds the chosen name).
- Goal 3 ("Same name on a new device restores prior likes/comments") — Task 1 (`setUsername` derives `userId = 'user-' + slug(username)`); verified in Task 9 smoke test.
- Goal 4 ("Existing users with both keys treated as already signed in") — Task 1 (constructor seeds signals from localStorage); verified in Task 9 smoke test (legacy user simulation).
- Backward-compat case "only `gameday-user-id` exists" — Task 1 (`setUsername` always writes both keys, overwriting the old id); verified in Task 9 fresh-visitor flow if you delete only the username key.
- Sign-in dialog spec (1–32 char trimmed, save disabled until valid, cancel returns null, ESC works) — Task 2.
- Navbar slot (sign-in button when out / static name chip when in, not clickable) — Task 3 (button binds `(click)`, chip is a `<span>` with no handler).
- AwsApiService cleanup — Tasks 5 and 8.
- "If `userId()` is null, pass empty string" for read paths — Task 5, Steps 2 and 4 (`?? ''` plus `encodeURIComponent`).

**Type / symbol consistency:**

- `userId` and `username` are `Signal<string | null>`. Every consumer either narrows with a guard (Task 4 throws), defaults with `??` (Task 5), or reads inside an `@if (isSignedIn())` block (Task 3).
- `requireSignIn(): Promise<boolean>` is the only async sign-in API; called identically in the navbar (Task 3), GameDetailsDialog (Task 6), and GamesComponent (Task 7).
- `setUsername(rawName: string): void` is called only from inside the dialog (Task 2). It is idempotent (no-op if already signed in) so an accidental second call cannot rotate the userId.

**Risk re-check:**

- The dynamic `import()` in `requireSignIn` is the one nontrivial mechanic. If the Angular CLI has any trouble with it on this version, Task 1 Step 2 documents the temporary workaround and Task 2 Step 4 documents how to restore the body. Both fail loudly at build time, not silently.
- Order of side effects on startup (`DataAggregationService` triggers a bulk fetch on first `getGames()`): the bulk fetch's `userId` query param is now sourced from `UserService.userId()`. The signal is seeded synchronously in the `UserService` constructor, before any `inject(UserService)` consumer runs — so no race.
- `aws-test.component.ts` (debug-only) still calls the deprecated pass-throughs after Task 8. Acceptable; out of scope to delete.
