---
name: run-undercity
description: Use when you need to launch and drive the Undercity board sub-game in a real browser to verify a UI/board change — covers the dev server, the live-AWS-backend reality, the creature/game state prerequisites, and how to reach a specific board state (e.g. a modal).
---

# Run the Undercity Board

## Overview

The Undercity is a phone-first board sub-game at the `/undercity` route (lazy-loaded
Angular standalone feature in `src/app/undercity/`). "Running it" means launching the
dev server and driving a browser to the board, then interacting the way a player would
(roll, walk, land on a space).

The single most important fact: **there is no local backend.** `AwsApiService`
hardcodes the deployed Lambda Function URL as `API_BASE_URL`, so a locally-served
frontend talks to the **live AWS game state**. All game rules live server-side
(`infrastructure/lambda/`), so the client cannot fabricate game state on its own —
whatever season/creature exists on the deployed Lambda is what you get.

## Launch

```bash
npm start &                      # ng serve — NOTE: port 4242, not 4200
echo $! > /tmp/uc-dev.pid
timeout 60 bash -c 'until curl -sf http://localhost:4242/ >/dev/null; do sleep 1; done'
```

- Dev serve is **`http://localhost:4242`**, base href `/` (the `/golgari-game-day/`
  base href only applies to the prod build). The board is at
  **`http://localhost:4242/undercity`**.
- First paint / route compile can take 10s+ — poll, don't `sleep`.
- Stop with `kill $(cat /tmp/uc-dev.pid)` (or `pkill -f 'ng serve'`) before relaunching,
  or the next start hits `EADDRINUSE`.
- npm is invoked through the Bash tool in this repo (see project memory).

## The state wall (read before promising a screenshot)

Identity is anonymous: a random user id + name is minted into `localStorage` on first
use (`generateUserId()` / `getUserName()`). A **fresh browser = empty localStorage =
brand-new user with no creature**, so the board redirects into the hatch/onboarding
flow, not the map. To reach the actual board you must either:

- **Reuse a real logged-in-ish session** — copy the `localStorage` keys (the minted
  user id, plus any creature) from a browser that already has a creature in the current
  season, or
- **Drive the full onboarding** — hatch a creature, then roll/walk — against the live
  Lambda. Slow and stateful; only worth it if you have no existing session.

Reaching a *specific* board state (a particular space's modal, a level threshold, a
region) additionally depends on where that creature is and what level it is. You cannot
assume it; you either already have it or you walk/level it there.

## Drive (headless)

No browser-automation tooling ships in this repo (no Playwright/Puppeteer/chromium-cli
in `package.json` or `node_modules/.bin`), and the user's Chrome is personal — never
drive or kill it (project memory: kill only your own headless PID). If `chromium-cli`
is available in the environment, the loop is:

```bash
chromium-cli --session uc <<'EOF'
nav http://localhost:4242/undercity
wait-for text=Roll        # or the hatch screen, if no creature
screenshot
console --errors           # a shell can render while /game/state fails
EOF
```

Otherwise you must install an automation dep first (heavy) — flag that cost to the user
before doing it rather than installing silently.

## Reaching the Ashen Wilds first-entry warning (worked example)

The warning modal (added 2026-07-21; see `specs/2026-07-21-undercity-wilderness-warning-design.md`)
appears when a walking creature **under level 5** first crosses from a home biome into a
`region: 'wilderness'` node, once per season (persisted as `localStorage`
`uc-wilds-warned:<seasonId>`). To see it live you need an under-5 creature standing next
to a border. The real border edges in the shipped map (verified from
`public/data/undercity-map.json`) are:

```
cavern_r0 → wild_cav1 · bog_r6 → wild_bog1 · garden_r0 → wild_gar1
city_r9  → wild_cit1 · bone_r1 → wild_bon1 · isl_warp → cw5
```

Walk toward any of those from the home-biome side, roll, and step across. **Turn back**
leaves the walk intact (steps preserved); **Press on** commits the held step and sets
the season flag so it won't re-appear. To re-test the first-entry case, delete the
`uc-wilds-warned:<seasonId>` key in devtools (simulates a fresh game/season).

## Gotchas that recur

- **Wrong port.** It's 4242, not the Angular default 4200.
- **Long-poll state.** The board polls `/game/state`; `wait-idle` never settles —
  `wait-for` the concrete element you need.
- **Service worker.** Only enabled in production builds, so dev is fine, but after a
  real deploy hard-refresh to bypass the cached `ngsw-worker.js`.
- **No test runner.** Karma/Jasmine were removed; `ng test` does not work. Build
  (`npm run build`) + this browser run are the verification path.
