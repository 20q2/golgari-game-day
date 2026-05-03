# Legacy Identity Migration — Design Spec

## Goal

Treat returning visitors who only have an auto-generated random name (from the pre-rewrite identity scheme) as fresh users: clear their stale localStorage, leave them in the signed-out state, and surface the standard sign-in dialog automatically once on their next visit so they can pick a real name.

## Background

Before [commit e52f08a](https://github.com/anthropics/golgari-game-day/commit/e52f08a), the app's `AwsApiService` stored an auto-generated identity in `localStorage` under the keys `gameday-username` and `gameday-user-id`. The username was randomly assembled from one of five hard-coded prefixes plus a random integer:

```
const randomNames = ['GameMaster', 'BoardGameFan', 'DiceRoller', 'CardShark', 'MeepleCollector'];
username = randomNames[Math.floor(Math.random() * randomNames.length)] + Math.floor(Math.random() * 1000);
```

The current `UserService` ([src/app/services/user.service.ts](../src/app/services/user.service.ts)) reads those same keys verbatim on construction. As a result, any returning visitor who hasn't manually set a name in the new system appears signed-in under their stale random name and never sees the new sign-in prompt.

## User flow

1. Returning visitor with stale `gameday-username = "GameMaster742"` opens the site.
2. `UserService` constructor reads localStorage, recognizes the auto-generated pattern, and clears both keys. Signals stay `null` so `isSignedIn() === false`.
3. The constructor sets an in-memory `legacyIdentityCleared` signal to `true` (transient, not persisted).
4. After bootstrap, the root `App` component's `ngOnInit` reads the flag once and calls `userService.requireSignIn()` to open the standard sign-in dialog automatically.
5. The user either:
   - Picks a name → `setUsername` populates the signals, dialog closes. Migration done.
   - Dismisses the dialog → stays signed-out. The navbar's existing "Sign in" button is their fallback affordance. No re-prompt on later reloads (the legacy data was already cleared in step 2).

## Scope

In scope:
- Detection of legacy auto-generated usernames in `UserService`.
- Clearing of legacy `gameday-username` / `gameday-user-id` on detection.
- A transient `legacyIdentityCleared` signal exposed by `UserService` (read by `App`).
- Auto-opening the sign-in dialog from `App.ngOnInit` when the flag is set.

Out of scope (deferred):
- Migrating the legacy user's backend comments / ratings / likes to a new identity. They stay attached to the old `userId` on the server. The user starts a fresh social slate.
- Tightening the detection regex (e.g. requiring exactly 1–4 digits). The 5-prefix pattern is already narrow enough.
- Adding migration-specific copy ("Your old random name is being retired") to the sign-in dialog. The standard "Pick a name" copy is sufficient for now.
- Detecting legacy users by `userId` shape (`user-<9 base36 chars>`). Risk of false positives: a real name like "Mister123" slugifies to `user-mister123` which matches the legacy 9-char alnum format. Name-pattern detection only.
- A persisted "migrated" flag — unnecessary since clearing legacy data is already self-idempotent.

## Architecture

### Detection in `UserService` constructor

Add a regex constant at module scope:

```ts
const LEGACY_USERNAME_PATTERN =
  /^(GameMaster|BoardGameFan|DiceRoller|CardShark|MeepleCollector)\d+$/;
```

Replace the constructor body so it inspects the existing `gameday-username` value before populating the signals. If the value matches `LEGACY_USERNAME_PATTERN`, remove both `gameday-username` and `gameday-user-id` from `localStorage`, leave the signals `null`, and set a new transient flag.

Add a new private signal `_legacyIdentityCleared = signal(false)` and expose it as `legacyIdentityCleared = this._legacyIdentityCleared.asReadonly()`.

### Triggering the prompt in `App`

`src/app/app.ts` currently has no `ngOnInit`. Update it to:

- Implement `OnInit`.
- Inject `UserService`.
- In `ngOnInit`, if `userService.legacyIdentityCleared()` is `true`, fire-and-forget `userService.requireSignIn()` (we don't await — bootstrap doesn't need to block on user input).

The dialog is opened exactly once per app load — the flag is in-memory, so a refresh resets it, but a refresh also re-runs the constructor which won't find the legacy data again (already cleared). Net effect: one prompt per legacy user, total.

### Files touched

- `src/app/services/user.service.ts` — add regex, add `_legacyIdentityCleared` signal, modify constructor.
- `src/app/app.ts` — implement `OnInit`, inject `UserService`, fire prompt when flag set.

### Files unchanged

- `SignInDialogComponent` — no copy or behavior changes.
- `Navbar` — already shows "Sign in" when not signed-in; that affordance handles the dismiss-then-decide-later case.
- `setUsername` — no changes; once a real name is set, future reloads skip the migration path naturally.

## Edge cases & non-concerns

- **Real human types literally `"GameMaster42"`** as their name through the dialog: would re-trigger detection on next reload and get cleared. Acceptable trade-off — extremely unlikely.
- **localStorage unavailable** (private mode etc.): `UserService` constructor would throw if it doesn't already. The detection/clear code uses the same `localStorage.removeItem` calls as `signOut()` — if the platform supported `getItem`, it supports `removeItem`. No new failure mode.
- **User dismisses the auto-prompt** without entering a name: signed-out state, navbar shows "Sign in", no further auto-prompts. Working as intended.
- **User opens the site in a second tab during the migration**: each tab independently runs the constructor. The first tab clears localStorage; the second tab also runs detection but finds nothing legacy (already cleared) and skips. Either tab might open the dialog; both opening is harmless because the second sees `isSignedIn()` and `requireSignIn()` short-circuits if a name was entered in the first.
- **PWA service worker**: bundles the new `UserService` code; users on cached old bundles still get the old constructor and remain "signed in" with junk names until they hard-refresh. Same caveat as every code change here.

## Verification

No test runner. Manual verification on the dev server:

1. Open dev tools → Application → Local Storage. Manually set `gameday-username = "GameMaster742"` and `gameday-user-id = "user-abc123def"` (mimicking a returning legacy visitor).
2. Reload the page.
3. Confirm both keys are gone from localStorage immediately after load.
4. Confirm the navbar shows "Sign in" (not the user chip).
5. Confirm the sign-in dialog opens automatically.
6. Pick a name "Alice". Confirm the dialog closes, the navbar now shows the user chip with "Alice", and `gameday-username = "Alice"` / `gameday-user-id = "user-alice"` are persisted.
7. Reload again. Confirm no auto-prompt fires this time (flag is gone, identity is real).
8. Repeat steps 1–2 but dismiss the dialog instead of entering a name. Confirm navbar shows "Sign in", localStorage stays empty, no re-prompt on next reload.
9. `npx tsc --noEmit -p tsconfig.app.json` is clean.
10. `npm run build:prod` succeeds.
