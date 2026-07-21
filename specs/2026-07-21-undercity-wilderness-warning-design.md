# Ashen Wilds first-entry warning — design

**Date:** 2026-07-21
**Status:** Approved, pending implementation
**Area:** Undercity board client (`src/app/undercity/tabs/board-tab.component.*`)

## Goal

The first time a player walks into the Ashen Wilds (the `region: 'wilderness'`
frontier) during a game session, and only while they are under the recommended
level, show a notice warning that the Wilds are far deadlier than the home
biomes and recommend Level 5+. The player can either turn back or press on; if
they press on, the move they attempted proceeds normally.

## Trigger conditions

The warning fires from within the walk loop in `onTapNode`, at the moment the
player taps a node that would be their next step. All of the following must
hold:

1. **Crossing the border.** The current step position's region is **not**
   `wilderness` and the tapped next node's region **is** `wilderness`. (Moving
   around *within* the Wilds, or a player who respawned inside them, never
   re-triggers.)
2. **Under-leveled.** `store.you()?.level` is `< 5`. Players at Level 5+ enter
   silently — no modal.
3. **Not yet warned this season.** See persistence below.

If any condition fails, the step proceeds exactly as it does today.

## Persistence — "once per game session"

A game session is a season (`store.season()?.seasonId`). The client records
that the warning has been shown by writing a localStorage key:

```
uc-wilds-warned:<seasonId>  ->  "1"
```

- Same season across page reloads: key present → no re-show.
- New game / new season: new `seasonId` → new key → warning shows again.

This mirrors the app's existing anonymous-localStorage identity model (no
server round-trip, no new backend state). If `seasonId` is unavailable the
guard treats the player as un-warned (fails open to showing the notice, which
is the safe/informative default).

## UI

Reuses the existing `uc-modal-backdrop` / `uc-modal` markup already used by the
respawn and warp modals in `board-tab.component.html`. No new styling system.

- **Title:** "The Ashen Wilds"
- **Body:** Warns that the frontier's predators are far deadlier than surface
  fauna and recommends reaching Level 5 before venturing in.
- **Buttons:**
  - **Turn back** — dismiss; leave the walk (`stepping`) untouched so the
    player keeps their remaining steps and can move elsewhere.
  - **Press on** — write the localStorage key, dismiss, and perform the exact
    step that was held.

Unlike the tappable-backdrop event modal, the backdrop here does **not**
dismiss on outside click — this is a decision prompt, so the player must pick
Turn back or Press on explicitly.

## Component changes (`board-tab.component.ts`)

- New signal `wildsPrompt = signal<string | null>(null)` holding the node id of
  the held step (null when no prompt is up).
- Factor the step-advance body currently inside `onTapNode` (the block that
  sets `stepping`, centers the camera, and handles the sealed-barrier /
  last-step auto-commit) into a private `commitStep(nodeId)` helper.
- In `onTapNode`, before advancing: if the trigger conditions hold, set
  `wildsPrompt(nodeId)` and return instead of stepping.
- `pressOn()` — mark the season warned, clear `wildsPrompt`, and call
  `commitStep(pendingId)` so the direct-tap and press-on paths run identical
  stepping logic.
- `turnBack()` — clear `wildsPrompt`; do nothing else.
- Small helpers: `hasBeenWarned()` / `markWarned()` reading and writing the
  localStorage key from `store.season()?.seasonId`.

## Non-goals (YAGNI)

- **Teleport into the Wilds** (`castTeleport`) is not gated. It is a rare edge
  case; entering by walking is the normal path. Can be layered on later if it
  proves necessary.
- No server-side tracking, no per-account persistence beyond the browser.
- No change to enemy difficulty, the existing per-space `buildNodeInfo`
  blurbs, or any balance number.

## Testing

No automated frontend test runner is wired up in this repo. Verification is a
production build (`npm run build`) plus a manual walk-through in the board tab:
under level 5 warns on first border crossing, honors Turn back / Press on, does
not re-show after Press on within the same season, and stays silent at level 5+.
