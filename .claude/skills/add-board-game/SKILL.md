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
  "genres": ["Cooperative", "Adventure"],
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

The list is intentionally short (13 tags). It's organised as **vibe → style → mechanic** — pick the one or two from each tier that genuinely apply, not every tier.

| Value | Tier | Use for |
|-------|------|---------|
| `Strategy` | vibe | Heavy thinky games, long planning horizon |
| `Family` | vibe | Light, accessible, all-ages |
| `Party` | vibe | Large group, fast, social, loud |
| `Adventure` | vibe | Dungeon crawl, story/campaign, RPG, monster-hunting, exploration |
| `Drinking` | vibe | Drinking-mechanic games (adult silly) |
| `Cooperative` | style | Players win or lose together |
| `Social` | style | Bluffing / hidden role / deduction / negotiation as a core mechanic |
| `Asymmetric` | style | Players have different abilities, roles, or win conditions |
| `Deck Builder` | mechanic | Build a deck during play (Clank!, Slay the Spire) |
| `Engine Builder` | mechanic | Build a scoring engine over time (Wingspan, Wyrmspan) |
| `Card Drafting` | mechanic | Drafting cards from a shared pool (7 Wonders, Sushi Go) |
| `Card Game` | mechanic | Card-driven games whose primary identity is "a card game" (Munchkin, Here to Slay, BoI: Four Souls). Use only when the format is the dominant feature — not as a fallback for every game with cards. |
| `Dice Rolling` | mechanic | Dice-driven games where rolling is core (Dice Forge, Megaland, Catharsis). |

**Use multiple values.** Most games warrant 2–3 tags spread across tiers. A drinking party deck-builder is `["Party", "Drinking", "Deck Builder"]`. A co-op fantasy dungeon crawler is `["Adventure", "Cooperative"]`. A tactical campaign with unique party roles is `["Adventure", "Cooperative", "Asymmetric"]`.

**Don't force a tag if nothing fits.** A pure mechanics-driven Euro that isn't an engine builder can just be `["Strategy"]`. Avoid the old habit of over-tagging with `Thematic` (no longer a tag) — tags should distinguish, not just describe.

## Common Mistakes

- **Wrong casing or typos in genre values.** The strings must match exactly — `"Deck-Building"` won't work, it has to be `"Deck Building"`. `"Co-op"` won't work, it has to be `"Cooperative"`.
- **Using a value not in the table.** There's no `Fantasy`, `Survival`, `Western`, `Thematic`, `Euro`, `RPG`, or `Dungeon Crawl` genre. Map to the closest tag in the table — Western/Steampunk theme on a hidden-role game is `Social`; a Fantasy dungeon crawl is `Adventure`; a Euro engine game is `Strategy` + `Engine Builder` if it has an engine, just `Strategy` otherwise.
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
