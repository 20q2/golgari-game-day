# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Project

Golgari Palace Game Day — an Angular 20 PWA for browsing a board game collection with photos, ratings, comments, and likes. Hosted on GitHub Pages at base href `/golgari-game-day/`. Backend is a serverless AWS stack (Lambda Function URL + single DynamoDB table) deployed via CDK from `infrastructure/`.

Requires Node.js 20+.

## Commands

Frontend (run from repo root):
- `npm start` — dev server at http://localhost:4200
- `npm run build` — development build to `docs/`
- `npm run build:prod` — production build, then runs `flatten-build` to lift `docs/browser/*` up to `docs/` (GitHub Pages serves from `docs/` root, but Angular's browser builder nests output under `browser/`)
- `npm run deploy` — production build + `gh-pages -d docs`
- `npm run lint` — eslint over `.ts` and `.html`
- `npm run format` — prettier write
- No test runner is wired up (Karma/Jasmine specs were removed; `tsconfig.spec.json` is gone). Don't try `ng test`.

Infrastructure (run from `infrastructure/`):
- `npm install` then `cdk bootstrap` (first time only)
- `cdk diff` / `cdk deploy` / `cdk destroy` / `cdk synth`
- Lambda handler is **Python** (`lambda/lambda_function.py`), not the `index.js` that's also in that folder — the CDK stack wires `lambda_function.lambda_handler` with `Runtime.PYTHON_3_11`. Edit the `.py` file.

## Architecture

### Frontend data flow
The app is a standalone-component Angular app (no NgModules). Routes live in [src/app/app.routes.ts](src/app/app.routes.ts): `/home`, `/games`, `/photos`.

Two layers of state for game social data:

1. **Static catalog**: `GamesService` loads `public/data/games.json` once on first `getGames()` call. The JSON has a single `genre: string` field; the service splits/maps it into a `GameGenre[]` enum array via a long keyword cascade in `stringToGameGenres()` ([src/app/services/games.service.ts](src/app/services/games.service.ts)). When adding new genre keywords, order matters — most specific match wins, and unmatched strings fall back to `STRATEGY`.

2. **Dynamic social data** (comments/ratings/likes): `DataAggregationService` does a one-shot bulk fetch of `/all-comments`, `/all-ratings`, `/all-likes` from the Lambda on app startup (triggered as a side-effect of the first `getGames()`). All per-game stats are derived from these in-memory arrays via observables. Mutations (`addComment`, `addRating`, `toggleLike`) call AWS via `AwsApiService` then optimistically update the local cache — they don't refetch.

`AwsApiService` hardcodes the Lambda Function URL as `API_BASE_URL`. Identity is anonymous: `generateUserId()` / `getUserName()` lazily mint a random ID + meeple-themed name into `localStorage`. There is no real auth.

### Backend
Single-table DynamoDB design (`pk`/`sk` strings, `user-index` GSI on `userId`+`timestamp`), all behind one Python Lambda exposed via Function URL with permissive CORS (`*`). Routes the Angular client uses:
- `GET/POST/PUT/DELETE /comments/{gameId}[/{commentId}]`
- `GET/POST /ratings/{gameId}`
- `GET/POST /likes/{gameId}` (toggle on POST)
- `GET /all-comments`, `/all-ratings`, `/all-likes` (bulk endpoints the frontend depends on for startup)

Stack and free-tier rationale documented in [infrastructure/README.md](infrastructure/README.md). Table `removalPolicy` is RETAIN — `cdk destroy` will not delete user data.

### Build output quirk
`angular.json` sets `outputPath: docs` so deploys land in the GitHub Pages source folder. Angular's modern browser builder writes to `docs/browser/`, so `npm run build:prod` chains a Node one-liner (`flatten-build` in [package.json](package.json)) that copies everything up one level and removes `browser/`. If you change the output structure, update both that script and any GitHub Actions workflow expecting flat `docs/`. Note: [.github/workflows/deploy.yml](.github/workflows/deploy.yml) currently runs `npm run build` (development config) and uploads from `dist/golgari-palace-gameday` — that path doesn't match the current Angular config and the workflow targets `main` while the active branch is `master`. The working deploy path is the local `npm run deploy` script.

### The Undercity sub-game

A phone-first board sub-game at `/undercity` (lazy-loaded standalone feature in `src/app/undercity/`), entered by clicking the navbar logo. Design doc: `docs/superpowers/plans/2026-07-06-undercity.md` (plan) and the GDD it references.

- **Backend:** all game rules live server-side in `infrastructure/lambda/undercity_engine.py` (pure functions, no boto3) + `undercity_data.py` (balance tables + board graph) + `undercity_db.py` (DynamoDB I/O, action dispatcher). `lambda_function.py` routes `GET /game/state` and `POST /game/action` to it. Tests: `cd infrastructure/lambda && python -m pytest tests -q` (53 tests, includes an in-memory FakeTable integration suite — keep it green).
- **Board map:** `undercity_data.MAP_NODES` is the source of truth. After changing it, regenerate the client copy: `python infrastructure/lambda/generate_map_json.py` → `public/data/undercity-map.json`.
- **Sprites:** Dino Party placeholder art in `public/undercity/`; the form→sprite mapping lives in `src/app/undercity/data/species.ts` (swap art there). The canvas engines (`engine/sprite-engine.ts`, `plaza-canvas.ts`, `board-canvas.ts`) are TS ports of `a:\Coding\AlexBirthdayDinos` frontend code.
- **Balance numbers** (stats, XP, costs, evolution tables) are duplicated for display in `src/app/undercity/data/*.ts` — if you tune `undercity_data.py`, update those mirrors.
- Boss finale, revenge buffs, achievements, and seal-milestone hats are deliberately stubbed (GDD §14 deferred list).

## Adding a board game

See [.claude/skills/add-board-game/SKILL.md](.claude/skills/add-board-game/SKILL.md) — covers the JSON shape, the genre-token cascade in `GamesService.stringToGameGenres()`, and the BGG-lookup workaround.

## Conventions

- Angular standalone components only (`standalone: true`, explicit `imports:` arrays). No `NgModule`s.
- SCSS for component styles; design tokens (colors, spacing, breakpoints) defined in [STYLE_GUIDE.md](STYLE_GUIDE.md) — reuse the `--primary-color`, `--accent-color`, MTG Golgari palette, and the `$mobile/$tablet/$desktop/$large` breakpoint scale rather than inventing new ones.
- Service worker is enabled in production only (see [src/app/app.config.ts](src/app/app.config.ts)); after deploying, hard-refresh to bypass the cached `ngsw-worker.js`.
