# BGG Page Link + Imported Gallery — Design

**Date:** 2026-07-18
**Status:** Approved, pending implementation plan

## Goal

On the game detail dialog, add (1) a link to the game's BoardGameGeek page and
(2) a gallery of additional pictures imported from BGG. The site is a static
GitHub Pages Angular app with a Lambda backend; browser→BGG calls are blocked by
CORS, so imported data is **baked at build time** into `games.json`.

## Key constraint discovered during design

BGG's official XML API (`boardgamegeek.com/xmlapi2/...`) now returns
`Unauthorized` for unauthenticated requests, so it cannot be used for the
title→ID lookup. The **`api.geekdo.com`** host works without auth and covers
both needs:

- **ID lookup:** `GET https://api.geekdo.com/api/geekitems?nosession=1&objecttype=thing&subtype=boardgame&showcount=N&search=<title>`
  → `{ "search": "...", "items": [ { "objecttype", "objectid", "name" }, ... ] }`
- **Images:** `GET https://api.geekdo.com/api/images?ajax=1&gallery=game&nosession=1&objecttype=thing&objectid=<id>&pageid=1&showcount=8&size=crop100&sort=hot`
  → `{ "images": [ { "imageid", "imageurl" (100px), "imageurl@2x" (200px), "imageurl_lg" (1024px), "caption", "href" }, ... ] }`

## Components

### 1. Data model — `src/app/models/game.model.ts`

Add two optional fields to **both** `Game` and `GameJson`:

```ts
export interface BggImage {
  thumb: string;   // 200px (imageurl@2x), for the strip
  large: string;   // 1024px (imageurl_lg), for the lightbox
  caption?: string;
}

// on Game and GameJson:
bggId?: number;
bggImages?: BggImage[];
```

No mapping change needed in `GamesService.loadGamesFromJson` — it already does
`{ ...gameData, genres: ... }`, so the new fields pass through once they exist on
the interfaces.

### 2. Build-time fetch script — `scripts/fetch-bgg.mjs`

- Wired as `npm run fetch:bgg` in `package.json`. Run **manually only** — never
  in deploy/CI (`.github/workflows/deploy.yml` and the `deploy` npm script are
  untouched).
- Plain Node ESM using global `fetch` (Node 20+, already required).
- For each entry in `public/data/games.json`:
  1. **Resolve `bggId`** if missing: call the geekitems search endpoint. Choose
     the item whose `name` equals the game title case-insensitively and whose
     `objecttype` is `thing`; else fall back to the first result but record it as
     **needs-review**. Games with no result are also recorded.
  2. **Fetch images** if `bggImages` is absent (or always, under `--force`):
     call the images endpoint, keep up to 8, map each to
     `{ thumb: imageurl@2x, large: imageurl_lg, caption }`.
  3. Skip work that's already present (idempotent) unless `--force`.
- Politeness: ~250 ms delay between HTTP calls; a descriptive `User-Agent`.
- Writes `public/data/games.json` back, pretty-printed (2-space) to keep diffs
  clean.
- Prints a **summary** at the end: counts resolved/skipped/failed, plus an
  explicit list of needs-review titles (non-exact match or no match) with the
  candidate names/IDs so they can be hand-corrected in the JSON.

### 3. UI — `src/app/game-details-dialog/` (`.html`, `.ts`, `.scss`)

- **BGG link:** rendered only when `game.bggId` is set — a small
  "View on BoardGameGeek" chip/link in the meta area, `href` =
  `https://boardgamegeek.com/boardgame/{{ game.bggId }}`,
  `target="_blank"` + `rel="noopener"`.
- **Thumbnail strip:** rendered only when `game.bggImages?.length` — a
  horizontally scrollable row of `thumb` images under the cover.
- **Lightbox:** clicking a thumbnail opens a full-screen overlay within the same
  component showing the `large` image + caption, with prev/next arrows.
  - State: two signals, `lightboxOpen` and `lightboxIndex`.
  - Dismiss: backdrop click, close button, `Escape`; navigate with
    `ArrowLeft`/`ArrowRight`. No new dependency.
  - Basic a11y: focusable controls, `aria-label`s, index wraps or clamps.
- Styling reuses STYLE_GUIDE tokens (Golgari palette, spacing scale, `$mobile`
  breakpoint) — no new design tokens.

## Data flow

Build time: `npm run fetch:bgg` → geekdo APIs → `public/data/games.json`.
Runtime: `GamesService` loads `games.json` → `Game` objects carry `bggId` +
`bggImages` → dialog renders link/strip/lightbox directly. No runtime network
calls to BGG.

## Error handling

- Script: per-game try/catch so one failure never aborts the run; failures land
  in the needs-review summary. Network/HTTP errors are logged with the title.
- UI: everything is behind `@if` guards on the optional fields, so games without
  BGG data render exactly as today. Broken image URLs degrade to the browser's
  default broken-image behavior (acceptable; snapshot data).

## Testing

- No unit-test runner is wired up in this repo, so verification is:
  - Run `npm run fetch:bgg` and inspect the summary + a `git diff` of
    `games.json` (spot-check a few known IDs, e.g. Wingspan = 266192).
  - `npm run build` to confirm the app compiles with the model/UI changes.
  - Manually open a game with images and one without; verify link, strip,
    lightbox, and keyboard controls.

## Scope / non-goals

- Images are a **snapshot**, refreshed only by re-running the script.
- No local caching of image binaries; URLs point at geekdo's CDN.
- No expansions, no per-user uploads, no live proxy/Lambda route.
