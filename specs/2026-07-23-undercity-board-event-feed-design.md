# Undercity — On-board recent-events feed

**Date:** 2026-07-23
**Status:** Approved, pending implementation

## Goal

While a player is on the board, surface the most recent Grapevine events as a subtle,
mobile-friendly ticker in the **bottom-left** corner. New events slide in; old ones slide
out as they age or get pushed off the stack. Purely a client-side presentation of data the
game already tracks — no backend change.

## Behavior

- Shows at most the **5 most recent** events, as small pill rows in the bottom-left of the
  board canvas.
- **Newest slides in at the bottom**; older rows sit above it. The oldest slides off the
  **top** when a 6th arrives.
- **Auto-hide when idle:** each row stays ~8s after it appears, then slides out. When the
  board is quiet the corner is empty and the board stays clean.
- Slide-in on arrival, slide-out on removal (age-out *or* pushed off the stack). Motion is
  subtle (short slide + fade from the left).
- The feed only reacts to events that arrive **while the board tab is mounted** — opening
  the board does **not** replay history (no slide-in storm on mount).

## Architecture

New isolated standalone component: `src/app/undercity/tabs/board-event-feed.component.{ts,html,scss}`.

- Injects `UndercityStateService` (mirrors the `log-tab` pattern; the store is the
  singleton other tabs already inject).
- Reads the existing `store.events()` — `GameEvent[]` (`{ type, text, ts }`), newest-first,
  server-polled. No new endpoint or state.
- Icon per event `type` reuses the same vocabulary as the log tab's `EVENT_ICONS` map
  (`hatch`→egg, `pvp`→sports_kabaddi, etc.), with the `spa` fallback.

`board-tab.component.html` drops in `<app-undercity-event-feed />` inside `.board-tab`
(bottom-left overlay), and `board-tab.component.ts` adds it to the `imports` array. No other
changes to the board component.

## Data flow / lifecycle

State inside the feed component:

- `visible`: signal of up to 5 display rows, each `{ id, type, text, state: 'in' | 'out' }`
  where `id` is a monotonically increasing local counter (stable `@for` track key).
- A "seen" watermark: the `ts` of the newest event already accounted for.
- A per-row timer map for auto-hide, plus any in-flight leave timers.

An `effect` watches `store.events()`:

1. **First run after mount:** set the watermark to the current newest event's `ts` and show
   nothing. This prevents a slide-in storm when the board tab mounts.
2. **Subsequent polls:** collect events with `ts` newer than the watermark. Because
   `store.events()` is newest-first, reverse them to **oldest→newest** so the freshest ends
   up at the bottom of the stack. For each:
   - push a row with `state: 'in'` (CSS runs the slide-in keyframe on enter);
   - schedule its auto-hide (`beginLeave(id)` after ~8s);
   - if `visible` now exceeds 5, `beginLeave()` the oldest immediately (falls off the top).
   - advance the watermark to the newest processed `ts`.

Removal is a two-phase CSS animation (dependency-free, matches the existing keyframe style —
no `provideAnimations()` wiring):

- `beginLeave(id)`: set that row's `state` to `'out'` (triggers the slide/fade-out), clear
  its auto-hide timer, then after ~260ms remove it from `visible`.

Watermark comparison uses string comparison of the ISO `ts` (server sks are `EVENT#{ts}#{x}`,
so `ts` is monotonic and lexicographically ordered). If two events share a `ts`, they are
both treated as newer than a strictly-older watermark and shown together; the watermark then
advances to that `ts`, so they are not re-shown on the next poll.

## Cleanup

All timers (auto-hide + leave) are tracked and cleared in `ngOnDestroy`, so a tab switch that
destroys the board tab cannot leak timers or fire into a dead component.

## Styling

- Container: `position: absolute; left: 10px; bottom: ~80px;` (clear of the bottom tab bar),
  `z-index` at the `board-toast` level (below modals), **`pointer-events: none`** so it never
  intercepts board taps — critical on mobile.
- Rows: small semi-transparent dark pills reusing the `board-toast` palette
  (`rgba(20,18,14,0.95)` bg, `rgba(74,124,89,0.5)` border, `#d8f3dc` text) but smaller
  (~0.78rem), left-aligned, small leading `mat-icon`.
- `max-width: min(260px, 62vw)`, text wraps (or clamps) so a long line never covers the
  board center.
- Slide-in: translateX from -12px + opacity 0→1 over ~220ms. Slide-out: reverse over ~240ms.
  `prefers-reduced-motion` collapses these to a plain fade.

## Non-goals

- No filtering by player (shows all Grapevine events, like the log tab).
- No interaction / tap targets (feed is display-only, `pointer-events: none`).
- No backend, no new event types, no changes to the log tab.

## Verification

No unit-test runner in this repo (Karma removed). Verify with:

1. `npm run build:prod` (green build / no type errors).
2. The `run-undercity` skill — drive the live board and confirm: genuinely new events slide
   in bottom-left, the stack caps at 5 (oldest falls off the top), rows auto-hide ~8s after
   appearing, opening the board tab shows no history storm, and board taps still pass through
   the feed area.
