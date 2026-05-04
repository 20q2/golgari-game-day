# Genre Taxonomy Streamline — Spec

**Date:** 2026-05-03
**Status:** Approved (design phase)

## Goal

Reduce the genre tag list from 27 mixed-concept tags to **11 user-facing tags** that real visitors browse by. The current list mixes domain (Strategy/Family), mechanics (Deck Building/Card Drafting), and theme/format (Card Game/Miniatures); 10 of 27 tags are used 1–2× across 56 games. Browsing should answer questions like "co-op tonight?" or "big group party?", which the current taxonomy obscures.

Inspired by BGG's split between *Domain* (broad bucket) and *Mechanism* (how it plays), but flattened back to a single list because the audience is casual.

## The 11 tags

**Vibe** — what kind of evening
1. Strategy
2. Family
3. Party
4. Adventure
5. Drinking

**Style** — how players interact
6. Cooperative
7. Social *(bluffing / hidden role / deduction / negotiation)*
8. Asymmetric

**Mechanic** — recognizable mechanics with real volume
9. Deck Builder
10. Engine Builder
11. Card Drafting

## Old → new mapping

| New tag | Absorbs (old tags) |
|---|---|
| Strategy | Strategy, Euro |
| Family | Family |
| Party | Party |
| Adventure | Adventure, RPG, Thematic, Legacy, Miniatures, Horror |
| Drinking | Drinking |
| Cooperative | Cooperative |
| Social | Social Deduction, Bluffing, Negotiation |
| Asymmetric | Asymmetric |
| Deck Builder | Deck Building |
| Engine Builder | Engine Building |
| Card Drafting | Card Drafting |
| *(dropped)* | Card Game, Abstract, Area Control, Dexterity, Memory, Push Your Luck, Route Building, Set Collection |

Notes on the mapping:
- *Thematic / Legacy / Miniatures* are not literal synonyms for Adventure, but in this catalog they appear almost exclusively on adventure-flavored games (Gloomhaven, Frosthaven, Primal, V&V), so they collapse cleanly to Adventure rather than warranting their own tag.
- *Card Game* is dropped — it's a format, not a vibe; players don't search by "card-vs-board".
- *Abstract* (2 games), *Area Control* (2), *Dexterity* (2), *Memory* (1), *Push Your Luck* (1), *Route Building* (1), *Set Collection* (1) — cut as long-tail noise. Affected games keep whatever vibe/style tags still apply (e.g., a Set Collection game tagged Strategy stays Strategy).

## Migration approach

**Hand-edit `public/data/games.json` directly.** Every entry's `genres` array gets rewritten to use only the 11 new tags. The file has 56 games; the rewrite is mechanical given the mapping table.

This is preferred over keeping the runtime cascade in `GamesService.stringToGameGenres()` doing fuzzy mapping, because:
- The data becomes the source of truth (less code, no surprise mappings).
- Adding new games is simpler: pick from a closed set of 11.
- The `stringToGameGenres()` keyword cascade can be simplified to an exact-match lookup (still useful for guarding against typos at load time).

## Files affected

| File | Change |
|---|---|
| `src/app/models/game.model.ts` | Trim `GameGenre` enum to 11 values. |
| `public/data/games.json` | Rewrite each entry's `genres` array using new tags. |
| `src/app/services/games.service.ts` | Simplify `stringToGameGenres()` — replace keyword cascade with strict enum lookup; silently drop unknown tags so a stale `games.json` entry doesn't crash load. |
| `src/app/services/genre-icon.service.ts` | Trim icon map to the 11 tags; remove entries for dropped genres. |

The chip components (genre strip, filter sheet) read the enum dynamically and don't need code changes — they automatically reflect the trimmed list.

## What stays as-is

- Filter UI (genre strip + filter sheet's chip grid) — unchanged behavior, just fewer chips.
- Player count / duration filters — separate axes, not affected.
- Sort options — unrelated.
- Hero/featured carousel logic — pulls genres from games but doesn't care about specific values.
- Existing comments/likes/ratings — untouched.

## Out of scope

- BGG API integration to auto-tag games (interesting but separate project).
- Two-axis filter UI (Domain × Mechanic). Considered but rejected for casual audience.
- Adding new games to the catalog.
- Renaming the chip styling — visual presentation stays the same.

## Acceptance

- All 56 games in `games.json` use only the 11 new tags.
- `GameGenre` enum has exactly 11 values.
- `lint` and production build both pass.
- Browsing the live page shows: a shorter genre strip, every chip is meaningful (no 1-game-only filters), and every game still has at least one tag.
