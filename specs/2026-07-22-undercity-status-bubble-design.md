# Undercity — Player Status Bubble

**Date:** 2026-07-22
**Status:** Design approved, pending spec review

## Summary

Let a player set a short free-text **status** that renders as a speech bubble
above their creature. The status is persisted server-side on the player record,
shown above the player's own creature everywhere (Plaza + board view), and above
other players' creatures in the Plaza where everyone is gathered.

## Requirements (from brainstorming)

- **Visibility:** Above me everywhere. Shows above my own creature in both the
  Plaza and the board view. Shared to others in the Plaza (persisted server-side).
- **Input:** Free text, short. ~24 char cap. No moderation (small trusted group);
  emoji allowed.
- **Entry points:** Both — the Creature tab, and tapping my own creature in the Plaza.
- **Duration:** Sticky. Stays until I change or clear it. No expiry.

## Non-goals

- No moderation / profanity filtering.
- No expiry timer or auto-clear.
- No status history or notifications when someone changes their status.
- Not shown above *other* players on the board (board is effectively single-occupant
  for the viewer; only the Plaza gathers everyone). Others' statuses render in the
  Plaza only.

## Architecture

### Data model

Add an optional `status` string to the player document (server) and to
`PlayerState` (client model). Absent/empty means "no status".

- Server: `doc['status']` on the DynamoDB player doc. Not present on new-player
  docs by default (treated as empty).
- Client: `status?: string` on `PlayerState` in
  `src/app/undercity/services/undercity-models.ts`.

### Server: `set-status` action

New action routed through the existing `handle_action` dispatcher in
`infrastructure/lambda/undercity_db.py`.

- Payload: `{ status: string }`.
- Validation/normalization (server is source of truth):
  - Coerce to string; strip leading/trailing whitespace.
  - Collapse any newline/tab runs to a single space.
  - Truncate to **24 characters** (count after trimming).
  - Empty result clears the field (store `''` or remove the key).
- Persist onto the player doc and return the updated self view so the client
  can confirm.
- No event/broadcast is emitted (status changes are quiet — see non-goals).

### Server: propagate to roster

The Plaza roster summary that other clients consume must include `status` so
peers can render it. Add `status` to the player-summary dicts built alongside
the existing `username` / `formName` / `creatureName` / `level` fields (the
roster/all-players summary builder used by the Plaza), and include `status` in
the player's own `/game/state` self doc.

### Client: setting the status

- `AwsApiService` gains a method that POSTs the `set-status` action.
- The store gains a `setStatus(text)` that calls the API and **optimistically**
  updates the local `you()` player's `status` (mirrors the existing
  optimistic-update-then-no-refetch pattern used by comments/ratings/likes and
  other actions). Trim/cap is applied client-side too for immediate feedback,
  but the server value is authoritative.

### Client: editor UI (two entry points)

1. **Creature tab** (`creature-tab.component`): a "Status" text field with a
   small live character counter (`n/24`) and a clear affordance, placed near the
   creature name/identity area. Commits on blur/enter.
2. **Plaza** (`plaza-tab.component`): tapping **your own** creature opens a small
   status editor (inline popover or lightweight modal) with the same field.
   Tapping *other* creatures keeps the current poke behavior; the self-tap path
   is what changes.

### Client: rendering the bubble

Draw a rounded speech bubble containing the status text, positioned just **above
the nameplate** so name and status stack cleanly.

- **`PlazaCanvas`** (`engine/plaza-canvas.ts`): the `PlazaCreature`/`Dino` data
  carries `status`; when non-empty, `drawNameplate` (or an adjacent
  `drawStatusBubble`) renders the bubble above the pill. Renders for all
  creatures (self + peers). Coexists with the transient sniff/startle emote
  glyphs already drawn above creatures — it does not replace them.
- **`BoardCanvas`** (`engine/board-canvas.ts`): the viewer's own creature carries
  its `status`; render the same bubble above its nameplate. Peers' statuses are
  not required on the board.
- Bubble styling: reuse nameplate palette/tokens (own-creature amber accent vs.
  peer green, matching the existing `isOwn` treatment). Text uses the same
  truncation the server enforced, so no extra client clipping is expected, but
  the bubble width should still lay out from measured text.

## Data flow

```
Creature tab / Plaza self-tap editor
  -> store.setStatus(text)               (trim+cap client-side)
     -> AwsApiService POST /game/action { type: 'set-status', status }
        -> Lambda handle_action -> normalize + persist doc['status']
        -> returns updated self doc
     -> store optimistically sets you().status
  -> PlazaCanvas / BoardCanvas redraw bubble
Peers: next roster poll includes status -> their PlazaCanvas draws my bubble
```

## Error handling

- Network/API failure on `setStatus`: revert the optimistic local value and
  surface the existing error-toast/snackbar path used by other store actions.
- Server treats any malformed/oversized payload defensively via
  normalization+truncation rather than rejecting.

## Testing

- **Server (pytest, `infrastructure/lambda/tests`):** add cases to the in-memory
  FakeTable suite —
  - `set-status` stores a normalized/truncated value on the doc.
  - Over-long input is truncated to 24 chars; whitespace/newlines collapsed.
  - Empty/whitespace input clears the status.
  - `status` appears in the self `/game/state` doc and in the roster summary.
  Keep the suite green (`python -m pytest tests -q`).
- **Client:** no test runner is wired up; verify via `npm run build` and by
  driving the app (`run-undercity` skill) to set a status and confirm the bubble
  renders in the Creature tab flow, the Plaza self-tap flow, and above the
  creature on the board.

## Files touched (anticipated)

- `infrastructure/lambda/undercity_db.py` — `set-status` action, roster + self
  doc `status` field.
- `infrastructure/lambda/tests/` — new pytest cases.
- `src/app/undercity/services/undercity-models.ts` — `status?` on `PlayerState`.
- `src/app/undercity/services/aws-api.service.ts` — set-status POST.
- store service — `setStatus()` optimistic update.
- `src/app/undercity/tabs/creature-tab.component.{ts,html,scss}` — status field.
- `src/app/undercity/tabs/plaza-tab.component.{ts,html,scss}` — self-tap editor.
- `src/app/undercity/engine/plaza-canvas.ts` — carry + draw status bubble.
- `src/app/undercity/engine/board-canvas.ts` — carry + draw own status bubble.
