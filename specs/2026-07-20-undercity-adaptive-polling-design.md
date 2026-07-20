# Undercity — Adaptive Polling & Live Movement

**Date:** 2026-07-20
**Status:** Approved design, pending implementation plan

## Problem

Undercity syncs all game state through a single fixed 10-second poll
(`UndercityStateService`, `POLL_INTERVAL_MS = 10_000`), shared by both the
board tab and the spectator view. Two consequences:

- **Stale rival positions.** A rival's move is only reflected on your board up
  to ~10s later. When opening the spell cast flow, the "rivals in range" list is
  computed from that possibly-stale snapshot, producing the "I saw them a few
  spaces away but they weren't targetable / the cast whiffed" surprise. (The
  server is authoritative and re-checks range on cast — this is a *perceived
  liveness* problem, not a correctness bug.)
- **Spectator feels laggy.** The same 10s cadence drives the spectate camera,
  and rival tokens *snap* to their new node each poll rather than moving.

## Goals

1. Make active play and spectating feel near-live without abandoning the
   serverless / free-tier polling model or adding backend infrastructure.
2. Keep idle cost at or below today's baseline.
3. Directly shrink the cast-targeting staleness window.
4. Make other players' movement read as motion, not teleportation, in both the
   board tab and spectator (they share one canvas engine).

## Non-goals

- No WebSockets / SSE / API Gateway changes. Push-based real-time is explicitly
  deferred; the server stays a stateless single Lambda + Function URL.
- No change to the authoritative server-side range/cast validation.
- No delta/patch responses — full-state fetch is retained (fine at game-day
  scale).

## Design

Three independent, composable parts.

### Part 1 — Adaptive activity-decay polling (`UndercityStateService`)

Replace the fixed `setInterval(10s)` with a **self-scheduling `setTimeout`
loop** whose delay is chosen from a tier ladder:

```
POLL_TIERS_MS = [3_000, 6_000, 10_000]   // FAST, MID, SLOW
```

- After each completed poll, choose the next delay:
  - **Change detected → snap to FAST** (index 0).
  - **No change → step down one tier** (`index = min(index + 1, last)`).
  - Yields `3,3,3…` during activity and `3 → 6 → 10 → 10` as things go quiet.
- **"Change detected"** is computed in one place (alongside the existing
  `computeDiff` roster comparison) and is true when any of:
  - the roster diff is non-empty (arrived / departed / restyled), **or**
  - any player's `position` changed between snapshots, **or**
  - `events` changed (new event) or `season` status changed.
  A private boolean/flag is set during reconciliation and read by the loop.
- **Reset to FAST also on:** a local `action()` call (you did something) and the
  tab returning to `visible`.
- **Hidden tab:** skip the fetch (as today) but keep the loop scheduling at SLOW
  so it resumes cleanly on return — no network cost while hidden.
- Self-scheduling (schedule next only after the current poll resolves) means
  polls never overlap; the `_loading` guard remains for the manual
  `refresh()` / `action()` paths.

**Cost:** idle cadence is unchanged (decays to 10s), so idle cost matches today;
only active play/spectate polls faster.

### Part 2 — Force-refresh when opening the cast flow (`board-tab`)

When the Cast spell picker opens, fire a single fire-and-forget
`void this.store.refresh()`. Because `spellTargets()` (and the guardian/boss
target getters) read store signals, the target list **re-renders reactively**
when the fresh snapshot lands (~1s later) — no blocking spinner. This shrinks
the targeting staleness window and, via the shared refresh path, also nudges the
poller toward FAST.

### Part 3 — Animate other players' moves (`BoardCanvas`)

`BoardCanvas` is shared by the board tab and the spectator, and already runs a
continuous `requestAnimationFrame` `draw(ts)` loop — so this is one change that
covers both views.

- Maintain `renderPos: Map<userId, {x, y}>` of on-screen positions.
- In `setPlayers`, for each rival whose target node changed, start a short tween
  (~350ms, ease-out) from the current on-screen position to the new node's
  `(x, y)`; `draw(ts)` advances the tween and draws the sprite at the
  interpolated position.
- **Snap (no glide) when the jump is large:** teleport/recall, a layer change,
  or a straight-line distance beyond ~2 node spacings. Single-hop moves (the
  common case at a 3s cadence) glide along the tunnel.
- **Own token is excluded** from tweening — it already animates via the
  component's step-by-step `stepping` walk; it snaps to its node here.

**Fidelity choice:** straight-line lerp with a snap-if-far cap, *not* BFS
path-following. Far less code, and at a 3s cadence a rival move is usually a
single hop where the straight line *is* the tunnel. Path-following can be added
later if multi-hop glides look wrong.

## Testing

No automated frontend test runner exists in this repo (per CLAUDE.md), so
verification is manual + build:

- `npm run build` stays green (type-checks the store/canvas/component changes).
- Manual: with two clients, confirm a rival's move appears within ~3s and glides
  (not snaps); confirm the poll cadence decays visibly to ~10s when the board is
  left idle (observable via network activity); confirm opening the cast picker
  refreshes the rival list; confirm the spectator view shows gliding movement.
- The existing Python engine test suite is unaffected (no backend change) and
  should remain green.

## Files touched

- `src/app/undercity/services/undercity-state.service.ts` — adaptive loop +
  change detection.
- `src/app/undercity/tabs/board-tab.component.ts` — refresh on cast-flow open.
- `src/app/undercity/engine/board-canvas.ts` — rival move tweening.

## Risks / edge cases

- **Battery/data on mobile:** 3s polling only while foreground + active; decays
  when idle, pauses when hidden. Acceptable for a phone-first game-day app.
- **Tween vs. own step-walk:** excluding `ownUserId` prevents double-animation.
- **Large/teleport jumps:** snap-if-far cap prevents sprites sliding across walls
  or between layers.
