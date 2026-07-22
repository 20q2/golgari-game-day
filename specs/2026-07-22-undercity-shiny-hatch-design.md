# Undercity — Shiny Hatch

**Date:** 2026-07-22
**Status:** Design approved

## Summary

When a creature hatches, there is a **5% chance** it is *shiny*. Shiny has **no
gameplay effect** — it is purely cosmetic. A shiny creature:

1. Is called out once in the hatch event log.
2. Emits a steady twinkle of **gold star particles** over its sprite in both the
   overworld board and the Plaza.

Shiny is a permanent property of the creature: it is rolled once at hatch and
persists through evolutions and tier changes (those mutate the same player doc).

## Server (Python Lambda)

### Config
- `infrastructure/lambda/undercity_config.py`: add `SHINY_HATCH_CHANCE = 0.05`.

### Roll & storage
- `_new_player_doc` (`undercity_db.py`): set
  `doc['shiny'] = _rng.random() < config.SHINY_HATCH_CHANCE`.
  - Rolled for both human joins and bot adds (same path). Bots may be shiny —
    harmless and keeps the code path single.
  - Because the flag lives on the player doc, evolution/tier changes preserve it
    with no extra work.

### Public projection
- `_public_player` (`undercity_db.py`): add `'shiny': p.get('shiny', False)` so
  every client (own view, spectator, board, plaza) can see it.

### Announce
- In the `_join` hatch event text, append `" ✨ It hatched SHINY!"` when
  `doc['shiny']` is true. Only the human hatch path is announced.

### Tests
- Extend the in-memory pytest suite: with `SHINY_HATCH_CHANCE` forced to `1.0`
  (monkeypatch / seeded `_rng`), a freshly joined player doc has `shiny == True`
  and `_public_player` surfaces it; with `0.0`, `shiny == False`. Keep the suite
  green (`cd infrastructure/lambda && python -m pytest tests -q`).

## Client (Angular)

### Models
- `src/app/undercity/services/undercity-models.ts`: add `shiny?: boolean` to
  `PublicPlayer` (default undefined/false).

### Threading into the canvas inputs
- `PlazaCreature` (plaza-canvas.ts): add `shiny?: boolean`.
- `BoardPlayer` (board-canvas.ts): add `shiny?: boolean`.
- In `undercity-page.component.ts` (wherever players/occupants are mapped into
  the plaza and board canvas inputs), copy `shiny` through.

### Sparkle effect — board / overworld
The board canvas already has a full sparkle particle system
(`spawnSparkle(x, y, color, glow)`, `updateHealFx`, `drawSparkles`) used for the
green gate-heal twinkle.

- When the players list is set, record the set of shiny userIds.
- In the FX update, for each token whose userId is shiny, periodically emit
  `spawnSparkle(token.x, token.y, '#ffe27a', '#f2a900')` (gold — distinct from
  the green heal twinkle). Reuse the existing sparkle update + draw untouched.

### Sparkle effect — plaza
The plaza canvas has a `Particle` system used only for walk-dust.

- Add a lightweight gold twinkle emitter: for each `Dino` whose partner is shiny,
  periodically spawn a gold sparkle particle above the sprite, and draw it with a
  soft glow (mirror the board's look — gold fill `#ffe27a`, glow `#f2a900`,
  twinkling alpha). Implemented either by tagging particles with an optional
  color/glow/twinkle or a small dedicated sparkle array, whichever is cleaner
  against the existing plaza particle code.

## Non-goals
- No stat, drop, or any other gameplay difference for shiny.
- No shiny-specific palette recolor of the sprite (particles only).
- No wardrobe / persistence beyond the season player doc.
