# Undercity Dev Night (host-toggled unlimited rolls) — Design

**Date:** 2026-08-09
**Status:** Approved (brainstorm) — pending spec review
**Related:** admin surface in `2026-07-15-undercity-admin-panel-design.md`; roll
economy in `infrastructure/lambda/undercity_config.py`.

## Motivation

Testing anything on the deployed site means waiting on the roll economy: 3 rolls
every 30 minutes, cap 10. The existing escape hatch is `data.DEBUG` in
`undercity_config.py` — a module constant, so turning it on means editing code
and running `cdk deploy`, and it applies to every session forever until someone
remembers to flip it back before game night.

Dev Night makes that a per-night switch in the admin panel: the host flips it on,
**every player on the night rolls for free**, and the host flips it back off. No
deploy, no code edit, reversible mid-session.

## Scope

**In:** unlimited rolls (the roll gate and the roll decrement) for all players on
the current night, toggled on and off from the admin panel, visible to players.

**Out** (decided during brainstorm):

- Die-face picking. Stays `data.DEBUG`-only, and the client's picker is behind
  `isDevMode()` anyway.
- Free spores / HP / cooldowns. Everything except roll cost behaves exactly as in
  a real night, so what you test is what ships.
- Excluding a dev night from the archive, export, or leaderboard. `reset-all`
  already covers cleanup when a dev night made a mess.

## Where the flag lives

A `devMode` boolean on the season CONFIG doc (`UNDERCITY#{sid}` / `CONFIG`),
alongside `status`, `hostKey`, `startedAt`, and `bossPhase`. Written by a new
host-gated admin cmd.

Per-night scoping falls out for free: the flag dies with the season, so a fresh
night is never accidentally in dev mode. It survives Lambda cold starts, and it
needs no deploy.

`data.DEBUG` is untouched — it remains the local sim/test switch, and the two are
OR'd, so nothing about the simulator or the test suite changes.

**Rejected alternatives:**

- *Lambda environment variable* — still a deploy or an AWS-console trip, which is
  exactly what this design removes.
- *Per-player `devMode` on each player doc* — has to be stamped at join and
  re-applied to anyone who joins later. The ask is "all players", which is a
  property of the night, not of a creature.

## How the rules read it

Action handlers are called as `(table, sid, doc, payload)` with no `config`, and
`_roll_meta(doc)` is reached from nearly every response through `_ok`. Threading
`config` through ~70 handlers to deliver one boolean is not worth it.

Instead: a **request-scoped module global** in `undercity_db.py`.

- A module-level `_DEV_NIGHT = False`.
- `handle_action` and `handle_state` set it from the CONFIG doc immediately after
  loading the season (`_active_season`), on every request, unconditionally —
  including the paths that bail out early — so a stale value from a previous
  invocation can never leak. Lambda serves one request at a time per container,
  so there is no cross-request race.
- One helper, `_free_rolls()`, returns `data.DEBUG or _DEV_NIGHT`. Nothing else
  reads the global directly.

Three call sites change, all replacing a bare `data.DEBUG` with `_free_rolls()`:

| Site | Current | Effect when on |
| --- | --- | --- |
| `undercity_db.py:3627` | `if not data.DEBUG and not is_reroll and doc.get('rolls', 0) < 1` | An empty bank no longer 409s |
| `undercity_db.py:3699` | `if not data.DEBUG and not is_reroll: doc['rolls'] -= 1` | Rolling costs nothing |
| `undercity_db.py:2770` | `meta = {'debug': data.DEBUG}` | `you.debug` rides every response |

## Admin command

`admin` cmd `dev-night`, registered in `_ADMIN_CMDS`, host-passphrase gated by the
existing `_admin` wrapper (403 on mismatch, same as every other cmd).

- Payload: `{on: bool}`, defaulting to `True` — mirrors `grant-admin`'s shape.
- Writes `table.put_item(Item=dict(config, devMode=bool(on)))`, the same
  read-modify-write `boss-awaken` uses.
- Returns `{'ok': True, 'devMode': <bool>}`.
- Idempotent: setting it to its current value is a no-op write, not an error.
  (`boss-awaken` 409s on re-trigger because it is one-way; this is a toggle.)

Unlike `boss-awaken`, this is reversible, so there is no one-way guard.

## Visibility to players

Toggling writes an event-log line and fans out an away-event, so a live player
gets a toast and a returning one finds it in the modal:

- On: *"Dev Night engaged — roll costs are off. Go wild."*
- Off: *"Dev Night over — the roll bank is live again."*

Both go through `_event(table, sid, 'host', …)` + `_broadcast_away(…)`, the same
pair `_admin_broadcast` uses.

The persistent indicator needs no new UI: the Roll button already renders `∞`
instead of a count, and the next-roll countdown already hides itself, whenever
`you.debug` is set (`board-tab.component.html:198,207`,
`board-tab.component.ts:1814-1850`). The flag reaching `_roll_meta` flips every
player's board on their next poll.

## Client — admin panel

`handle_state` gains `devMode` in the season block (next to `startedAt` /
`bossPhase`, `undercity_db.py:2551-2555`) so the panel can render current state, and
`UndercitySeason` in `services/undercity-models.ts` gains the matching optional
field.

The admin panel ([admin/admin-panel.component.ts](../src/app/undercity/admin/admin-panel.component.ts))
gets a "Dev Night" row in its own section:

- A label explaining what it does ("Every player rolls for free. Nothing else
  changes.") and the current state read from `store.season()?.devMode`.
- One button that toggles: *Start Dev Night* when off, *End Dev Night* when on.
- Fires through the existing private `admin()` helper, which already carries the
  host key, refreshes state, and surfaces failures into `message()`.
- **No confirm gate.** It is reversible and destroys nothing, unlike `reset-all`
  and the backdated New Night, which keep their two-tap arming.

## Off-transition

Nothing to unwind. While Dev Night is on, rolls are simply never spent, so banks
regen and cap normally underneath. Turning it off resumes ordinary spending from
whatever is banked at that moment. No wipe, no refund, no rested-pool special
case.

## Testing

`infrastructure/lambda/tests/test_undercity_db.py`, following the existing
FakeTable + `monkeypatch.setattr(data, 'DEBUG', False)` style so the real roll
economy is what is under test:

1. `dev-night` with the wrong host passphrase → 403, flag unchanged.
2. Dev mode on + `rolls = 0` → `roll` returns 200 and `rolls` is still 0
   afterwards (no gate, no decrement).
3. `you.debug` is `True` in a state fetch while on, and `False` after toggling
   off.
4. Regression: with dev mode off and `rolls = 0`, `roll` still 409s.
5. The flag persists across separate requests (set it, then a fresh
   `handle_action` still rolls free) — proves it is read from CONFIG each time,
   not left over in the module global.
6. Toggling off restores decrementing: a roll with `rolls = 3` leaves 2.
7. `handle_state` reports `devMode` in the season block for the admin panel.

Run: `cd infrastructure/lambda && python -m pytest tests -q`. Client change is
verified by `npm run build` (no test runner is wired up).

## Deployment note

Requires a `cdk deploy` of the Lambda plus a frontend deploy for the admin-panel
button. The host runs both.
