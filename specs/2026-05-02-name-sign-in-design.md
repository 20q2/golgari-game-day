# Name-based Sign-In

**Date:** 2026-05-02
**Status:** Approved (awaiting written-spec review)

## Problem

Today, identity in the Angular app is fully implicit. `AwsApiService.generateUserId()` mints a random `user-xxxxxxxxx` ID into localStorage on first read, and `getUserName()` mints a random "MeepleCollector427"-style display name the same way. Users never see or choose their name. The result:

- Comments and ratings appear under arbitrary auto-generated names.
- A user has no way to "be themselves" across devices or after clearing localStorage.
- There is no notion of being "signed in" — every visitor can already like, rate, and comment.

We want a minimal sign-in: ask for a name, store it locally, gate participation on having one set, and let a user re-claim their identity on a new device by typing the same name.

This is a local-friends site. There is no auth. The trade-off — anyone who knows your name can pose as you — is explicitly accepted.

## Goals

1. New visitors are prompted for a name before they can like, rate, or comment.
2. Once signed in, the user's chosen name appears in comments/ratings/likes (no more "MeepleCollector427").
3. Signing in with the same name on a different device or after clearing localStorage restores the user's prior likes/comments/ratings.
4. Existing users who have already interacted under an auto-generated name keep their identity unchanged and are treated as already signed in.

## Non-Goals

- No password, email, verification, or account recovery.
- No "rename" / edit-username flow once signed in. Username is fixed after first sign-in (preserves single visible identity across the user's history; users who want a different identity can clear localStorage themselves).
- No "sign out" UI. Same reasoning as above; can be added later if needed.
- No backend / Lambda / DynamoDB changes. The server already accepts whatever `userId` and `username` the client sends.
- No retroactive renaming of past comments/ratings/likes when the identity scheme changes for a given user.

## Architecture

### Identity model

Two pieces of state live in `localStorage`:

| Key | Lifecycle | Purpose |
|---|---|---|
| `gameday-user-id` | Written on sign-in (derived from name) or pre-existing for legacy users; stable until localStorage is cleared | Server-side primary key for likes, comments, ratings |
| `gameday-username` | Written on sign-in only; absence means "not signed in" | Display name shown on comments/ratings/likes |

**Derivation rule for new sign-ins:** `userId = 'user-' + slug(username)` where `slug` is `trim().toLowerCase().replace(/[^a-z0-9]+/g, '-')`. So "Andrew" → `user-andrew`. Same name on any device → same userId → same identity. Whitespace and punctuation collapse: " Andrew! " and "andrew" both produce `user-andrew`.

**Backward compatibility.** The only legacy state worth preserving is the case where a user has *both* keys set — these are users who actually interacted (liked/rated/commented under their auto-generated name) and we don't want to disturb that identity. Three startup cases:

- **Both keys present** → treat as already signed in. Do not modify either key. The user keeps their (possibly auto-generated) name. Goal 4 holds.
- **Only `gameday-user-id` present** (the user loaded the site but never interacted — `getAllLikes` writes the id without ever writing a name) → treat as not signed in. The lingering id has no associated data on the server, so when the user signs in, `setUsername` derives a new id from their chosen name and overwrites the old one. No data loss because there was no data.
- **Neither present** → fresh visitor, not signed in.

`setUsername` always writes *both* keys (deriving the id from the name). It never reads or preserves the existing `gameday-user-id`.

**Implication of derivation:** two users picking the same name collide on the server. Acceptable for a known-small local group; the second person can pick a different name.

### `UserService` (new)

`src/app/services/user.service.ts`. The single source of truth for identity. Replaces the inline localStorage poking in `AwsApiService`.

Public surface:

```ts
@Injectable({ providedIn: 'root' })
export class UserService {
  // null only for fresh visitors who haven't signed in yet.
  // Non-null for legacy users (their pre-existing id) and for anyone post-sign-in.
  readonly userId: Signal<string | null>;
  readonly username: Signal<string | null>;
  readonly isSignedIn: Signal<boolean>;  // computed: username() !== null

  // One-shot. No-op if already signed in.
  setUsername(name: string): void;

  // Returns true if signed in (already or after the dialog closed with a name).
  // Returns false if the user cancels the dialog.
  requireSignIn(): Promise<boolean>;
}
```

On construction, the service reads both keys from localStorage and seeds the signals per the three cases above.

`requireSignIn()` injects `MatDialog`, opens `SignInDialogComponent`, and resolves to the result. It is the *only* way the dialog gets opened from action handlers — components don't import `MatDialog` themselves for this.

### `SignInDialogComponent` (new)

`src/app/components/sign-in-dialog/sign-in-dialog.component.{ts,html,scss}`. Material dialog, standalone component.

- One text input, label: "Your name".
- Save and Cancel buttons.
- Validation: trimmed length 1–32, otherwise Save is disabled.
- On Save: calls `userService.setUsername(value)` and closes with the trimmed name.
- On Cancel (or backdrop click / ESC): closes with `null`. State is unchanged; the user remains not signed in.

### Navbar update

`src/app/navbar/navbar.component.{ts,html,scss}` gains a top-right slot:

- **Not signed in** → `<button mat-button>` with `person_outline` icon and label "Sign in". Click → `userService.requireSignIn()`.
- **Signed in** → static display of the username with a `person` icon. Not clickable. (No edit flow per Non-Goals.)

The navbar template branches on `userService.isSignedIn()`. No other navbar logic changes.

### Action gating

Three call sites currently mutate identity-bearing data: like, rate, comment. They live in:

- `src/app/game-details-dialog/game-details-dialog.component.ts` — like, rate, comment.
- `src/app/games/games.component.ts` — like (card-level, if present there; verify during implementation).
- `src/app/services/data-aggregation.service.ts` — wraps the AWS calls; investigate during implementation to confirm gating belongs at the component layer (preferred) and not in the service.

The pattern at every gated handler:

```ts
async onLikeClick() {
  if (!await this.userService.requireSignIn()) return;
  // existing toggleLike flow
}
```

For comments: the typed comment text lives in the form / template state and is not consumed before the gate. The dialog opening and closing does not clear it. Submission proceeds with the original text after sign-in.

Buttons stay visually enabled regardless of sign-in state — a click either fires the action or opens the dialog. No tooltips, no greyed-out state. (Choice rationale: tooltips don't work well on mobile/touch; "click and resume" is the simplest mental model.)

### `AwsApiService` cleanup

`src/app/services/aws-api.service.ts`:

- Inject `UserService`.
- Remove the random-name fallback inside `getUserName()` and the random-id fallback inside `generateUserId()`.
- Replace internal calls to `this.generateUserId()` / `this.getUserName()` (currently in `getLikes`, `toggleLike`, `getAllLikes`) with reads from `UserService`.
- For read-only paths that need a userId (`getLikes`, `getAllLikes` — they pass `?userId=` to compute `isLikedByCurrentUser`): if `userId()` is null (not signed in, no legacy id either), pass empty string or omit the param. Result: an unsigned visitor sees `isLikedByCurrentUser: false` everywhere, which is correct.

The public `generateUserId()` and `getUserName()` methods can be removed if no caller outside the service uses them; otherwise they become thin pass-throughs to `UserService`. Verify call sites during implementation.

## Data flow

### Fresh visitor signs in

1. User opens site → navbar shows "Sign in".
2. User clicks "Sign in" → `requireSignIn()` opens dialog.
3. User types "Andrew" → Save → `setUsername("Andrew")`.
4. localStorage now has `gameday-username = "Andrew"`, `gameday-user-id = "user-andrew"`.
5. Navbar re-renders to show "Andrew" with the person icon. All like/rate/comment buttons now succeed without further prompting.

### Fresh visitor clicks Like before signing in

1. User clicks heart on a game card.
2. Handler calls `requireSignIn()`.
3. Dialog opens; user types "Andrew" → Save.
4. Dialog resolves true; the original `toggleLike` call proceeds.
5. The like is recorded under `userId = user-andrew`.

### Fresh visitor cancels the dialog

1. User clicks Like → dialog opens → user hits Cancel.
2. Dialog resolves false. `requireSignIn()` returns false. Handler returns early. No like, no toast, no error. Navbar still shows "Sign in".

### Returning user on a new device

1. User opens site on phone (no localStorage) → navbar shows "Sign in".
2. User signs in as "Andrew" → `userId = user-andrew`.
3. App reads existing likes/comments/ratings; anything previously posted under `user-andrew` is now correctly attributed to this session.

### Legacy user (already has random ID + auto name)

1. User opens site → `gameday-user-id` and `gameday-username` already exist.
2. `UserService` seeds with both → `isSignedIn === true`.
3. Navbar shows their auto-generated name (e.g., "MeepleCollector427").
4. They can like/rate/comment normally. They cannot rename without manually clearing localStorage.

### Legacy passive visitor (only userId, no username)

1. User had previously loaded the site but never liked/rated/commented. localStorage has only `gameday-user-id`.
2. `UserService` seeds → not signed in. Navbar shows "Sign in".
3. User signs in as "Andrew". `setUsername` writes both keys; the old id is overwritten with `user-andrew`. No data was tied to the old id, so nothing is lost.

## Validation rules

- Trimmed name length must be 1–32 characters.
- No other restrictions on input characters. The slug for `userId` strips anything non-alphanumeric, so emoji or punctuation in the display name is fine — they just don't affect the userId.
- An all-whitespace input is rejected (trim collapses to empty).

## Files touched

**New:**

- `src/app/services/user.service.ts`
- `src/app/components/sign-in-dialog/sign-in-dialog.component.ts`
- `src/app/components/sign-in-dialog/sign-in-dialog.component.html`
- `src/app/components/sign-in-dialog/sign-in-dialog.component.scss`

**Modified:**

- `src/app/services/aws-api.service.ts` — inject UserService, drop random fallbacks, route identity through UserService.
- `src/app/navbar/navbar.component.ts` — inject UserService, conditionally render sign-in button vs. name display.
- `src/app/navbar/navbar.component.html` — add the new slot.
- `src/app/navbar/navbar.component.scss` — minor styling for the slot if needed.
- `src/app/game-details-dialog/game-details-dialog.component.ts` — gate like, rate, comment handlers behind `requireSignIn()`.
- `src/app/games/games.component.ts` — gate like handler if it exists at this level; verify during implementation.
- `src/app/services/data-aggregation.service.ts` — verify whether any gating belongs here; likely no changes beyond the identity refactor in `AwsApiService`.

**Unchanged:**

- All Lambda / Python / CDK code under `infrastructure/`.
- All other components, the routing, the games JSON catalog.

## Risks

- **`AwsApiService` legacy callers.** `generateUserId()` and `getUserName()` are public. If anything outside `AwsApiService` calls them, those call sites need updating. Verify with a grep during implementation.
- **Order of side effects on app startup.** `DataAggregationService` triggers a bulk fetch as a side effect of the first `getGames()` call, and that bulk fetch passes `userId` for the like-checked flag. `UserService` must be initialized before that fetch fires. Since `UserService` is `providedIn: 'root'` and reads localStorage synchronously in the constructor, Angular's DI graph guarantees this — but worth confirming in the implementation.
- **Two users with the same name.** Documented and accepted. Not a defect.

## Open questions

None at design-approval time. Any remaining ambiguity (e.g., where exactly the navbar slot sits visually, exact button styling) is left to implementation judgment, which is what the implementation plan will address.
