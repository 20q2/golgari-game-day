# Undercity — Admin Role + In-Game Free Move

**Date:** 2026-08-06
**Status:** Design approved, ready for implementation plan

## Problem

Hosting a live Undercity session sometimes needs a trusted player to reposition
their own creature freely — to demo a space, reach a facility, or set up a
situation — without waiting on the roll economy. Today the only movement override
is the host-driven `teleport` admin command (fired from the admin panel against a
target); there is no player-facing "let me walk where I want" capability, and no
per-user notion of who is allowed to.

## Goal

1. Let a hostKey-holder grant a persistent **Admin** role to a chosen active player
   from the admin panel (and revoke it).
2. Give an Admin player an in-game **Move** action — a free, step-by-step walk of
   the board that resolves as a real landing when committed.

## Non-goals

- Cross-night persistence of the Admin flag (per-night is fine for v1; see Scope).
- Any change to normal roll-driven movement.
- Exposing Admin status on the public/spectator view.

## Design

### 1. The Admin role

A new boolean `isAdmin` on the player doc.

- **Granting:** a new hostKey-gated admin command `grant-admin` with a `target`
  userId and a boolean `on` (or a toggle). It sets/clears `doc['isAdmin']` on the
  target and persists. Gated identically to every other admin command (the server
  403s on hostKey mismatch), so only a hostKey-holder can confer it.
- **Surfacing:** `isAdmin` rides the `you` payload (already spread wholesale from
  the doc in `_ok`), so the owning client sees it. It is **not** added to the
  `_public_player` whitelist, so it never reaches the TV/spectator broadcast.
- **Admin-panel UI:** in the roster, each active **human** player (skip bots) gets
  a **Make admin / Revoke admin** toggle button beside the existing
  Heal / Teleport / Kick controls, showing current state. Wired through the same
  `admin(cmd, extra)` helper as the other roster actions.

**Scope:** the flag lives on the per-night player doc, so it is re-granted each
night — the simplest data model and consistent with the creature doc being
per-season. Persisting across nights would require writing to the durable profile
record; deferred as an easy future extension.

### 2. In-game free Move (server)

A new `freemove` action (routed by the action dispatcher, like `move`/`roll`).

- **Hard gate:** the handler first checks `doc.get('isAdmin')`. A non-admin caller
  gets a 403 — the capability is server-authoritative, never trust the client.
- **Input:** the client sends the `path` it walked (ordered node ids, current
  position first, landing last) — identical shape to a normal `move`'s `path`.
- **Validation:** reuse the walk rules **minus the roll-distance limit**. Concretely
  a new engine validator `validate_free_walk(nodes, path, closed, blocked)` that
  keeps every rule from `validate_walk` except the exact-hop-count check:
  - each step must be edge-adjacent (`cur in nodes[prev]['neighbors']`);
  - never step **onto** a `blocked` node;
  - never step onto/through a **`closed`** barrier except as the final landing
    (you may walk up to a sealed gate and stop, but not cross it — "respect
    barriers");
  - **no distance cap** and **backtracking allowed** (it is a free stroll, not a
    dice move — the no-immediate-backtrack rule from `validate_walk` is dropped).
  - `closed` / `blocked` are computed exactly as `_move` does today
    (`_stop_nodes(table, sid, doc)` and `_blocked_nodes(doc)`), so evolved-unit
    tunnel blocks and sealed sigil gates behave consistently.
- **No cost:** no roll spent, no cooldown, no `pendingMove` required (unlike
  `_move`, which demands a pending roll). An empty/degenerate path (length < 2) is
  a no-op that stays put.

### 3. Landing resolution

On commit the handler sets `doc['position']` to the final node and calls the **same
`_resolve_space(table, sid, doc, node, prev)`** every normal landing uses. This is
a full real landing: facilities/shops open, gates full-heal, loot drops, hazards
bite, and enemy spaces **start a fight**. Walking onto a monster starts combat,
exactly as a rolled landing would. The `freemove` response carries the same
space-event / heal payload shape as `_move` so the client reacts identically
(opens the relevant modal, floats heal numbers, enters battle, etc.).

Ladder/tunnel mid-walk mechanics that `_move` handles (banking leftover roll) do
**not** apply — a free move has no leftover roll; whatever node the admin commits
on is simply the landing. If that node is a ladder/tunnel, `_resolve_space`
relocates as usual and the walk is over.

### 4. Client move-mode UX

- **Button:** when `store.you()?.isAdmin`, render a third action-band button
  **Move** next to Cast, gated like Roll (visible/enabled only when idle — not
  rolling, no `pendingMove`, no pending pickup/decision).
- **Entering move mode:** a local `moveMode` signal. On enter, the board canvas
  highlights the current node's legal neighbors (adjacent, not `blocked`, and a
  sealed node only as a stop). Each tap steps the pending walk to that node and
  re-derives highlights from the new node; the accumulating `path` is held
  client-side.
- **Committing / cancelling:** two controls while in move mode —
  **Move here** (send `freemove` with the built `path`, then resolve the response
  like a normal move result) and **Cancel** (drop the path, exit move mode, stay
  put). Reuses the existing board-canvas node-tap plumbing and the map's
  `neighbors` data already loaded on the client.
- **Model:** add `isAdmin?: boolean` to the `YouDoc` interface.

## Testing

Server (`tests/test_undercity_admin_move.py`, FakeTable style):

1. `grant-admin` sets `isAdmin` on the target; a wrong/blank hostKey 403s; a
   revoke toggle clears it.
2. `freemove` from a non-admin doc → 403 / rejected.
3. `freemove` with a legal adjacent multi-step path (longer than any single roll)
   moves the admin to the final node.
4. `freemove` rejects a non-adjacent jump, a step onto a `blocked` tunnel node, and
   a path that crosses a sealed `closed` barrier (barrier may only be the landing).
5. Backtracking path is accepted (unlike a dice move).
6. Landing resolution fires: a `freemove` ending on a facility/loot/enemy space
   triggers the same `_resolve_space` outcome a rolled landing would (assert the
   space event, e.g. a shop open or a battle start).
7. `isAdmin` is present in the `you` view but absent from `_public_player`.

Client: verified by `npm run build` (Angular template + type check).

Run the Python suite from `infrastructure/lambda`: `python -m pytest tests -q`.

## Out of scope

- Cross-night Admin persistence (profile-record storage).
- Admin move for **other** players (this is a self-move; host repositioning of
  others stays the existing `teleport` command).
- Any leftover-roll / ladder-banking behaviour during a free walk.
