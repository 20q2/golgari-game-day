# Undercity Crystal Vein — reachable Heartstone + per-hit spore feedback

**Date:** 2026-07-24
**Status:** Design — approved for planning
**Area:** `infrastructure/lambda/undercity_db.py` (+ test), `src/app/undercity/tabs/crystal-vein.component.ts`, `src/app/undercity/tabs/board-tab.component.ts`, `src/app/undercity/engine/vein-canvas.ts`

## Summary

Two coupled changes to the shared Crystal Vein sub-game:

1. **A cave-in no longer resets the shared shaft to the surface.** It still hurts
   the digger (HP) and ends their strikes for the visit, but the depth holds, so
   the shaft ratchets upward across visits/players until someone reaches level 12
   and claims the Heartstone. Today the Heartstone is effectively unreachable.
2. **Make the per-hit Spore reward legible.** Spores are already awarded and
   banked on every successful strike, but the only feedback is a text log line.
   Add a "earned this visit" tally, a 3D spore-particle burst on each strike, and
   a one-line explanation of the whole press-your-luck loop.

## Why the Heartstone is unreachable today

To reach level 12 you must land clean strikes into levels 1→12. Each strike into
level `L` survives with probability `1 - 0.04·L`, so a clean 0→12 run is
`0.96·0.92·…·0.52 ≈ 2.2%`. Because **any** cave-in at **any** level currently
resets the shared shaft to 0 (`_save_vein(..., 0)`), the community's accumulated
depth keeps getting wiped before it can climb. The jackpot almost never fires.

## Current behaviour (confirmed)

- `_vein_strike_once` (`undercity_db.py`): `level = depth + 1`. On success it adds
  `spores = 1 + level` to the player immediately, may drop an item, saves the new
  depth, and at `level >= VEIN_MAX_DEPTH` (12) awards `VEIN_HEARTSTONE_SPORES`
  (40) + a rare item and refills the shaft to 0.
- On cave-in (`rng < level · 0.04`): deals `level · 2` HP, sets
  `veinStrikesLeft = 0`, **saves depth 0**, emits a "shaft collapses to the
  surface" event, returns `{collapsed: True, depth: 0, ...}`.
- Spores earned before a cave-in are **kept** (banked immediately). The risk model
  is "HP + shared reset", not "lose your Spores".
- Client (`crystal-vein.component.ts`): shows depth/strikes, a WebGL wall
  (`vein-canvas.ts`) with `playStrike/playCaveIn/playHeartstone`, a text log, the
  next-strike odds, Strike button, and a hint that says a cave-in "collapses the
  shaft for everyone".
- `resp.spores` is sent to the client but currently unused (`board-tab.strike()`
  reads only `depth`, `text`, and the effect kind).

## Design

### A. Cave-in holds the shaft (`undercity_db.py` `_vein_strike_once`)

In the cave-in branch:

- **Remove** the `_save_vein(table, sid, region, 0)` call. The shared `VEIN#`
  record keeps its prior depth (the failed strike simply doesn't advance it).
- **Keep** `doc['hp'] = max(1, hp - level · VEIN_CAVE_IN_DMG_PER_LEVEL)` and
  `doc['veinStrikesLeft'] = 0`.
- Change the return depth from `0` to `level - 1` (the unchanged shared depth).
  Keep `collapsed: True`.
- Reword the feed event and result text — no "collapses to the surface" /
  "slumps back to the surface". New tone: a rockfall batters the digger but the
  tunnel holds. Example result text: `"CAVE-IN at level {level}! A rockfall hits
  you for {dmg} damage — but the shaft holds."` Example event: `"{username}
  triggered a cave-in at level {level} of the crystal vein — battered by the
  rockfall, but the shaft holds."`

The Heartstone branch is unchanged (it still refills to 0 — that reset is the
reward). No balance constants change.

**`resp.spores` for the tally:** in the Heartstone branch, return
`spores: spores + VEIN_HEARTSTONE_SPORES` (currently returns just `spores`). This
makes `resp.spores` equal the total Spores gained on every successful strike, so
the client tally needs no mirrored constant. `resp.spores` is unused elsewhere,
so this is safe.

### B. "Earned this visit" tally (`crystal-vein.component.ts` + `board-tab.component.ts`)

- `crystal-vein.component.ts`: new `@Input() earnedThisVisit = 0`. Render it in
  the `.vein-sub` line: `Shaft depth {{depth}}/{{MAX}} · {{strikesLeft}} strikes
  left · earned this visit: {{earnedThisVisit}} 🍄`.
- `board-tab.component.ts`: add `veinEarned = signal(0)`. Reset to 0 at the start
  of a fresh visit inside `openVein()` (a landing event / full strikes). In
  `strike()`, on a non-collapse response add `resp.spores` to `veinEarned`. Bind
  `[earnedThisVisit]="veinEarned()"` on the modal.
- A cave-in adds nothing to the tally (no Spores that strike); the prior banked
  total stays visible, reinforcing "you kept these".

### C. 3D spore-particle burst (`vein-canvas.ts` + wiring)

- Extend `VeinEffect` (in `crystal-vein.component.ts`) with an optional
  `spores?: number`, set by `board-tab.strike()` from `resp.spores` for the
  `strike` and `heartstone` kinds.
- `vein-canvas.ts`: `playStrike(spores?: number)` (and the heartstone path) spawns
  glowing spore motes from the currently-lit crystal positions that rise and fade.
  Model after the existing `FallingRock`: a `SporeMote { mesh, vy>0, vx, life }`
  list, spawned with a count scaled to `spores` (clamped, e.g. `min(spores, 12)`),
  animated in `step()` (rise, drift, fade opacity over ~1s, remove when done),
  freed in `dispose()`. Use a small emissive sprite/octahedron in the vein's
  Spore palette.
- `crystal-vein.component.ts` `ngOnChanges` passes `this.effect.spores` into
  `playStrike`/`playHeartstone`.
- **Canvas-failed fallback:** when `failed` is true (no WebGL), show a transient
  DOM `+N 🍄` float in the modal on each gain (driven by the same
  `earnedThisVisit` delta), so feedback survives without the 3D scene. The tally
  itself always renders regardless of canvas state.
- `playCaveIn` keeps its rockfall/shake (represents the hit). Since depth no
  longer resets, `setDepth` won't drop the crystals — no change required there.

### D. "How it works" framing (`crystal-vein.component.ts`)

Replace the current hint ("A cave-in hurts you and collapses the shaft for
everyone…") with a concise loop explanation, e.g.:

> Every strike's Spores are yours to keep. Go deeper for bigger hits and the
> Heartstone at level 12 — a cave-in costs HP and ends your dig here, but the
> shaft holds.

Keep the "Walking away leaves the depth for the next digger" idea folded in or
adjacent. The next-strike odds line is unchanged (shows `+Spores` and cave-in %);
the HP cost is intentionally not added (out of scope per brainstorming).

## Non-goals

- No change to the risk model beyond the cave-in reset: Spores stay banked and
  safe per hit (explicitly chosen). No "pot at risk" / claw-back.
- No balance-number changes (cave-in odds/damage, Heartstone payout, strikes per
  visit all unchanged).
- Not adding the cave-in HP cost to the odds line, nor a separate floating pop for
  the healthy-canvas case (the 3D burst covers it).

## Testing / deploy

- **Backend:** update `test_vein_cave_in_hurts_and_resets`
  ([test_undercity_db.py:1722](infrastructure/lambda/tests/test_undercity_db.py#L1722))
  — rename to reflect the new rule and assert the shaft depth is **unchanged**
  (stays 9), HP dropped, `veinStrikesLeft == 0`, and `resp['depth'] == 9`. The
  Heartstone test at line 1766 should stay green (its assertion on
  `resp['you']['spores']` is unaffected by returning the bonus inside
  `resp['spores']`; add/adjust an assertion if it checks `resp['spores']`). Run
  `cd infrastructure/lambda && python -m pytest tests -q`.
- **Client:** `npm run build` succeeds; eyeball via the `run-undercity` skill —
  strike a vein, confirm the tally climbs and spore motes burst, trigger a cave-in
  and confirm the shaft depth **holds** (crystals don't drop) while you take HP.
- **Deploy (user runs):** the cave-in rule is server-side, so a **Lambda deploy**
  (`cdk deploy` from `infrastructure/`) is required for it to take effect; the
  client changes ship with a normal frontend deploy. A frontend-only deploy would
  show the new copy/animation but keep the old reset behaviour live.

## Files touched

- `infrastructure/lambda/undercity_db.py` — `_vein_strike_once` cave-in branch +
  Heartstone `resp.spores`.
- `infrastructure/lambda/tests/test_undercity_db.py` — cave-in test.
- `src/app/undercity/tabs/crystal-vein.component.ts` — `earnedThisVisit` input,
  `VeinEffect.spores`, sub-line tally, fallback float, framing copy, canvas wiring.
- `src/app/undercity/tabs/board-tab.component.ts` — `veinEarned` signal + strike
  wiring.
- `src/app/undercity/engine/vein-canvas.ts` — spore-mote particle burst.
