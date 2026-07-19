# Spectator: camera-jitter fix + games/queue scene

Date: 2026-07-19

## Part 1 — Camera jitter (bug)

**Symptom:** In `/undercity` spectator (`/tv`) the camera is jittery while gliding
between scenes; it smooths out once it settles.

**Root cause:** The app uses `provideZoneChangeDetection` (Zone.js). The board's
`requestAnimationFrame` loop in `board-canvas.ts` (`start()`) is scheduled from
inside the Angular zone, so Zone.js runs full change detection on every frame.
Each CD re-evaluates the template's `portrait()` → `getRecoloredDataUrl()` →
`canvas.toDataURL()` for each leaderboard/rail row (uncached), which is expensive.
That per-frame work starves the animation loop, producing uneven frames that read
as jitter during motion.

**Fix:**
1. Inject `NgZone` in `SpectatorComponent` and start the board loop inside
   `ngZone.runOutsideAngular(...)`. rAF re-schedules itself from within that
   callback, so the whole loop stays outside the zone — no per-frame CD.
2. Memoize `portrait()` results per `sprite + paint` key in the component so the
   CD passes that legitimately run (polls, mouse move, scene cuts) stay cheap.

## Part 2 — Games/Queue scene + dice markers (feature)

Reuse the existing root `QueueService` (already polls `/queue/state`). Entry shape:
`{ gameId, gameTitle, status: 'lobby' | 'active', joined: [{ userId, username }] }`.

**Director:** add scene kind `'queue'` to `SpectatorDirector`, inserted into
`BASE_ROTATION` after `leaderboard`. Camera = slow flyover (reuse flyover
zoom/glide). The director skips the queue slot when there are no lobby/active
entries (mirrors the sleeping-boss skip). The component feeds entries into the
director each poll via `SpectatorState`.

**Card overlay:** shown only for `scene().kind === 'queue'`. Two columns —
**Now Playing** (status `active`, with player names) and **Waiting for Players**
(status `lobby`, with the joined roster / count). Styled to match existing
broadcast chrome (`.spotlight` / `.rail`).

**Dice markers (persistent, all scenes):** the component computes the set of
`userId`s that appear in any `active` entry and pushes it to the board via a new
`BoardCanvas.setDiceMarkers(userIds)`. The canvas draws a small 🎲 badge above
each matching token every frame. Empty set → no markers.

**Files:** `spectator.component.ts/.html/.scss`, `spectator-director.ts`,
`board-canvas.ts`. No backend changes.

## Verification

No frontend test runner is wired up; verify with `npm run build:prod` (green) and
a visual pass of `/undercity` → spectator.
