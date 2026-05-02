---
name: add-board-game
description: Use when the user asks to add, register, catalog, or include a board game in this site's collection — appends a new entry to public/data/games.json with details fetched from BGG / publisher pages.
---

# Add a Board Game

## Overview

The catalog is a flat JSON array at [public/data/games.json](../../public/data/games.json). Adding a game = appending one object. There's no schema validation, no migrations, no build step — the Angular app reads this file at runtime via `GamesService`.

## Workflow

1. **Pick the next free `id`** — `Grep` for `"id":` in `public/data/games.json` and use `max(existing) + 1`. Ids are string-typed but numeric-valued; gaps exist (don't backfill them).
2. **Look up the game.** BGG (`boardgamegeek.com/boardgame/<id>/<slug>`) is canonical, but BGG blocks `WebFetch` and its XML API now requires auth (returns 401). Use `WebSearch` with the title in quotes — the snippet usually surfaces player count, playtime, and rating. For box art, fall back to the publisher's own product page (Paper Fort, MOOD Publishing, Zero Strategy, etc.).
3. **Append the entry** to the JSON array, before the closing `]`. Use the field shape below exactly.
4. **Verify** by running `npm start` and confirming the card appears on `/games`. Don't touch `docs/data/games.json` — that's build output.

## Required Fields

```json
{
  "id": "59",
  "title": "Shuffle Dungeons",
  "genre": "Cooperative / Dungeon Crawl / Adventure / Fantasy",
  "minPlayers": 1,
  "maxPlayers": 4,
  "playTime": "60-90 minutes",
  "description": "A cooperative dungeon crawler ...",
  "imageUrl": "https://...",
  "bggRating": 7.5,
  "comments": []
}
```

| Field | Type | Notes |
|-------|------|-------|
| `id` | string | Numeric value as string. `max + 1`. |
| `title` | string | Match the official title, including subtitle (`Ticket to Ride: Europe`). |
| `genre` | string | ` / `-separated. Tokens are matched by `stringToGameGenres()` — see below. |
| `minPlayers` | number | |
| `maxPlayers` | number | |
| `playTime` | string | `"<min>-<max> minutes"` or `"<n> minutes"`. |
| `description` | string | 1–2 sentences. Lead with theme/mechanic, not marketing. |
| `imageUrl` | string | Full https URL. Prefer `cf.geekdo-images.com/...pic*.jpg` if obtainable; publisher CDN is an acceptable fallback. |
| `bggRating` | number | One decimal (e.g. `7.5`). If unavailable, estimate conservatively (7.0–7.5) and tell the user. |
| `comments` | array | Always `[]`. Real comments live in DynamoDB, not this file. |

## Genre Tokens (Critical)

[src/app/services/games.service.ts](../../src/app/services/games.service.ts) `stringToGameGenres()` splits the `genre` string on `/` and matches each token (case-insensitive `.includes()`) against a fixed cascade. Order matters — the most specific match wins. Unrecognized tokens fall through to `STRATEGY`.

**Hyphen gotcha:** Several keywords in the cascade use the U+2011 non-breaking hyphen (`‑`), not ASCII `-`. Some have both forms; some don't. Notably, **`co‑op` only matches the unicode form** — writing `Co-op` with an ASCII hyphen falls through to `STRATEGY`. Use **`Cooperative`** instead.

Safe tokens (all ASCII) that map cleanly:

| Use this token | Maps to |
|----------------|---------|
| `Card Drafting` | CARD_DRAFTING |
| `Set-Collection` | SET_COLLECTION |
| `Route-Building` | ROUTE_BUILDING |
| `Engine-Building` | ENGINE_BUILDING |
| `Social Deduction` / `Hidden Role` | SOCIAL_DEDUCTION |
| `Area Control` / `Territory` | AREA_CONTROL |
| `RPG` | RPG |
| `Miniatures` | MINIATURES |
| `Legacy` / `Campaign` | LEGACY |
| `Negotiation` | NEGOTIATION |
| `Deck-Building` / `Deck-Builder` | DECK_BUILDING |
| `Dungeon Crawl` / `Adventure` | ADVENTURE |
| `Dexterity` / `Action` | DEXTERITY |
| `Drinking` | DRINKING |
| `Horror` | HORROR |
| `Memory` | MEMORY |
| `Bluffing` | BLUFFING |
| `Strategy` | STRATEGY |
| `Party` / `Word Game` | PARTY |
| `Cooperative` | COOPERATIVE *(use this — NOT `Co-op`)* |
| `Card Game` / `Dice` / `Tableau` | CARD_GAME |
| `Euro` | EURO |
| `Thematic` / `Fantasy` / `Steampunk` | THEMATIC |
| `Abstract` / `Puzzle` / `Tile-Drafting` | ABSTRACT |
| `Family` / `Garden` | FAMILY |
| `Asymmetric` | ASYMMETRIC |
| `War` | WAR_GAME |

When in doubt, check the cascade — it's <70 lines.

## Common Mistakes

- **Writing `Co-op` instead of `Cooperative`.** The ASCII hyphen doesn't match; the token silently falls through to STRATEGY.
- **Editing `docs/data/games.json`.** That's the deployed build output. Edits land in `public/data/games.json`.
- **Reusing a deleted id.** Ids appear in social-data DynamoDB rows (likes, ratings, comments). Reusing `26` or `52` (gaps in the current file) could resurrect orphaned data. Always pick `max + 1`.
- **Trying to `WebFetch` BGG.** Returns 403/401. Use `WebSearch` + publisher CDN.
- **Trailing comma.** JSON. Don't.
- **Forgetting the comma after the previous entry's `}`.** When appending, change the prior `}` to `},` before adding the new object.

## Quick Reference

```bash
# Find next id
grep -E '^\s*"id":' public/data/games.json | tail -5
```

Verify with `npm start` → http://localhost:4200/games. The new card should render with image, title, player count, playtime, and BGG rating. If the genre badge looks wrong, re-check token spelling against the cascade.
