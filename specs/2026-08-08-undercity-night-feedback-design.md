# Undercity — End-of-Night Player Feedback

**Date:** 2026-08-08
**Status:** Approved, ready for planning

## Goal

Give players a quick way to tell the host what they loved and hated about a
night, captured right when the night ends and they're still thinking about it.
The host reviews the collected feedback offline via the existing session-data
export — no new review screen.

## User decisions

- **Review surface:** JSON export only. Feedback rides along in the Admin
  panel's existing **Export session data** download. No new admin UI section.
- **Attribution:** Each entry records who submitted it — username plus their
  creature (name/form) — so the host knows who said what. Nothing is shown to
  other players.
- **Persistence:** Per-night. Feedback lives under the season partition and is
  archived with the rest of the night on "Reset + start fresh night."

## Where it appears

The end-of-night screen is the `ended` phase, which renders the
`CeremonyComponent` inside the `ended` case of
[undercity-page.component.html](../src/app/undercity/undercity-page.component.html)
(lines ~73–77). The new feedback panel sits directly **below the ceremony,
above the host panel** in that same `ended` case.

`phase() === 'ended'` corresponds to season `config.status === 'ended'` (set by
`_season_end`, [undercity_db.py](../infrastructure/lambda/undercity_db.py)
~3227).

## Component design — `EndNightFeedbackComponent`

A new standalone component (`src/app/undercity/ceremony/end-night-feedback.component.ts`
+ `.html` + `.scss`). Kept separate from `CeremonyComponent` because the
ceremony is purely presentational (inputs only), whereas this component injects
`UndercityStateService` and calls an action.

Layout (all Material icons, **no emoji** — the game has a strict symbol-language
rule):

- Heading: e.g. "Tell me about tonight".
- **Loved box** — `sentiment_very_satisfied` icon (positive/green token),
  label *"Something you loved…"*, a `<textarea>` (`maxlength=500`).
- **Hated box** — `sentiment_very_dissatisfied` icon (rust/red token), label
  *"…and something you hated"*, a `<textarea>` (`maxlength=500`).
- **Send feedback** button below both boxes.

Styling reuses the Golgari/undercity design tokens (`--primary-color`,
`--accent-color`, MTG Golgari palette, `$mobile/$tablet/$desktop` breakpoints)
already used across the feature. Phone-first, single column.

Behavior:

- Button is disabled while a submit is in flight, and disabled when **both**
  boxes are empty (either one alone is enough to send).
- On success: clear both fields and show a transient confirmation
  (e.g. *"Thanks — the swarm heard you."*). The form stays visible so a player
  can add another point of feedback.
- On error: surface the server message inline near the button; leave the typed
  text in place so nothing is lost.
- Submit calls `store.action('feedback', { loved, hated })` — where `store` is
  the injected `UndercityStateService`. `action()` already attaches `userId`
  and `username` (see `UndercityApiService.action`).

## Backend design

### New action: `feedback`

Handled in `handle_action` ([undercity_db.py](../infrastructure/lambda/undercity_db.py)
~2562). At end-of-night the season status is `ended`, so like the existing
read-only `export` exception, `feedback` must be routed **before** the
`status != 'active'` gate:

```python
if atype == 'feedback':
    if not sid or not config:
        return _err('No season to give feedback on yet.', 409)
    return _feedback(table, sid, user_id, username, payload)
```

Requires a season to exist (any status); works in both `active` and `ended`.

### `_feedback(table, sid, user_id, username, payload)`

- Reads `loved` and `hated` from payload; trims each and caps length
  (server-side clamp to 500 chars, matching the client `maxlength`).
- Rejects with a 400 if **both** are empty after trimming.
- Looks up the player doc via `_get_player(table, sid, user_id)` to fill
  `creatureName`/`formName`. If there's no player doc (e.g. a spectator who
  never hatched), those fall back to empty and only `username` is stored.
- Writes **one item per submission**:

  | field | value |
  |-------|-------|
  | `pk` | `_season_pk(sid)` (the season partition) |
  | `sk` | `FEEDBACK#{now_ms}#{userId}` |
  | `userId` | submitter id |
  | `username` | submitter name |
  | `creatureName` | creature name if known, else `''` |
  | `formName` | creature form if known, else `''` |
  | `loved` | trimmed text (may be `''`) |
  | `hated` | trimmed text (may be `''`) |
  | `at` | `_now()` ISO timestamp |

- Returns a small success payload (e.g. `{'ok': True}`). It does **not** need to
  return a `you` doc — nothing in game state changes.

Multiple submissions from the same player create multiple `FEEDBACK#` items
(each keyed by `now_ms`), which is intended — a player can send more than one
point of feedback.

### Export

`_admin_export` ([undercity_db.py](../infrastructure/lambda/undercity_db.py)
~3155) gains one line:

```python
'feedback': _all('FEEDBACK#'),
```

so feedback is included in the existing **Export session data** download
alongside `players`, `events`, `chat`, `firsts`, `fogReveals`. No admin
passphrase change, no new endpoint.

## Client types

If the action-type union or API surface is typed, add `feedback` there. No
balance numbers are involved, so no `src/app/undercity/data/*.ts` mirror is
needed.

## Testing

Extend the pytest integration suite
(`infrastructure/lambda/tests`, FakeTable-backed):

1. Start a season, end it (status `ended`), submit `feedback` with both fields
   → assert a `FEEDBACK#` item is stored with `loved`, `hated`, `username`, and
   creature attribution.
2. Submit `feedback` with **both** fields empty → assert 400 and nothing stored.
3. Call the `export` admin cmd → assert the submitted feedback appears under the
   `feedback` key of the export payload.
4. Confirm feedback also works during an `active` season (the pre-`ended` path),
   so the routing exception doesn't only cover one status.

Keep the suite green: `cd infrastructure/lambda && python -m pytest tests -q`.
Front-end sanity via `npm run build` (lint is known-broken in this repo).

## Out of scope (YAGNI)

- No on-screen admin review list (export-only, per decision).
- No cross-night/permanent feedback store (per-night, per decision).
- No rating scale, categories, or per-feature tagging — just free-text
  loved/hated.
- No edit/delete of submitted feedback.
