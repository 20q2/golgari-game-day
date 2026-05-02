---
name: add-board-game
description: Use when the user asks to add, register, catalog, or include a board game in this site's collection — appends a new entry to public/data/games.json with details fetched from BGG / publisher pages.
---

# Add a Board Game

## Overview

The catalog is a flat JSON array at [public/data/games.json](../../../public/data/games.json). Adding a game = appending one object. There's no schema validation, no migrations, no build step — the Angular app reads this file at runtime via `GamesService`.

## Workflow

1. **Pick the next free `id`** — `Grep` for `"id":` in `public/data/games.json` and use `max(existing) + 1`. Ids are string-typed but numeric-valued; gaps exist (don't backfill them).
2. **Look up the game.** BGG (`boardgamegeek.com/boardgame/<id>/<slug>`) is canonical, but BGG blocks `WebFetch` and its XML API now requires auth (returns 401). Use `WebSearch` with the title in quotes — the snippet usually surfaces player count, playtime, and rating. For box art, fall back to the publisher's own product page (Paper Fort, MOOD Publishing, Zero Strategy, etc.).
3. **Append the entry** to the JSON array, before the closing `]`. Use the field shape below exactly.
4. **Verify** by running `npm start` and confirming the card appears on `/games`. Don't touch `docs/data/games.json` — that's build output.

## Required Fields

```json
{
  "id": "62",
  "title": "Shuffle Dungeons",
  "genres": ["Cooperative", "Adventure", "Thematic"],
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
| `genres` | string[] | Array of `GameGenre` enum values. Must use the exact strings from the table below — TypeScript validates them at load time. |
| `minPlayers` | number | |
| `maxPlayers` | number | |
| `playTime` | string | `"<min>-<max> minutes"` or `"<n> minutes"`. |
| `description` | string | 1–2 sentences. Lead with theme/mechanic, not marketing. |
| `imageUrl` | string | Full https URL. Prefer `cf.geekdo-images.com/...pic*.jpg` if obtainable; publisher CDN is an acceptable fallback. |
| `bggRating` | number | One decimal (e.g. `7.5`). If unavailable, estimate conservatively (7.0–7.5) and tell the user. |
| `comments` | array | Always `[]`. Real comments live in DynamoDB, not this file. |

## Genre Values (Critical)

The `genres` field is a typed array — each entry must be one of the exact strings below. These are the values of the `GameGenre` enum in [src/app/models/game.model.ts](../../../src/app/models/game.model.ts). Anything else won't render correctly.

| Value | Use for |
|-------|---------|
| `Strategy` | Strategy-forward games that don't fit a more specific bucket |
| `Party` | Large-group / quick-play / loud games |
| `Cooperative` | Players win or lose together |
| `Card Game` | Card-driven games without a stronger mechanic tag |
| `Deck Building` | Build a deck during play (e.g. Clank!, Slay the Spire) |
| `Euro` | Euro-style worker placement / point salads |
| `Thematic` | Heavy theme — Fantasy, Steampunk, Horror-adjacent |
| `Abstract` | Pure-puzzle, tile-laying, no theme |
| `Family` | Light, accessible, all-ages |
| `War Game` | Wargames / heavy combat sims |
| `Drinking` | Drinking-mechanic games |
| `Engine Building` | Build a scoring engine over time (Wingspan, Wyrmspan) |
| `Dexterity` | Physical skill required (flicking, balancing) |
| `Social Deduction` | Hidden roles, identify the traitor |
| `Bluffing` | Lying mechanics central |
| `Memory` | Memory mechanics central |
| `Adventure` | Dungeon crawl / quest / exploration |
| `Horror` | Horror theme |
| `Area Control` | Territory / map control |
| `RPG` | Role-playing / character progression |
| `Card Drafting` | Drafting cards from shared pool (7 Wonders, Sushi Go) |
| `Miniatures` | Miniature-driven combat / arena |
| `Legacy` | Legacy / persistent campaign |
| `Negotiation` | Trading / bargaining central |
| `Route Building` | Build connected routes (Ticket to Ride) |
| `Set Collection` | Collect matching sets |
| `Push Your Luck` | Risk-vs-reward mechanic |
| `Asymmetric` | Players have different abilities / win conditions |

**Use multiple values.** Most games warrant 2–4 tags. A drinking party deck-builder is `["Drinking", "Party", "Deck Building"]`. A co-op fantasy dungeon crawler is `["Cooperative", "Adventure", "Thematic"]`.

## Common Mistakes

- **Wrong casing or typos in genre values.** The strings must match exactly — `"Deck-Building"` won't work, it has to be `"Deck Building"`. `"Co-op"` won't work, it has to be `"Cooperative"`.
- **Using a value not in the table.** There's no `Fantasy`, `Survival`, `Western`, or `Dungeon Crawl` genre — map to `Thematic`, `Adventure`, etc. as appropriate.
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

Verify with `npm start` → http://localhost:4200/games. The new card should render with image, title, player count, playtime, BGG rating, and the right genre chips. If a genre chip is missing, re-check the spelling against the table.
