# The Undercity — Ashen Fog space (fog-of-war tile)

**Status:** implemented · server tests green (5 new) · client build green · needs deploy + node placement · 2026-07-29
**Origin:** host feature request — a board space themed to the Ashen Wilds that hides its
contents until you land on it, resolving into a wild mix of outcomes. A fog-of-war tile.

## 1. Concept

A new board node `type: 'fog'` ("Ashen Fog"). It renders as a swirling ashen cloud that
hides what it holds. The **first** player to land on it (season-global) rolls a d20; the fog
parts and the space **becomes** that outcome type permanently, for everyone, for the rest of
the season. After the reveal it behaves as an ordinary space of the revealed type.

Landing = stopping on the tile (resolve-on-landing, like every other space). Passing over
without stopping does not reveal it.

## 2. Outcome table (d20)

The six outcomes are all **existing space types**, so there is no new outcome logic — the
fog space is a *router* into the machinery that already exists.

| Roll | Outcome | Resolves as | Notes |
| --- | --- | --- | --- |
| 1–5  | Enemy | `wild` | interactive battle, region-gated foe |
| 6–9  | Mystery | `mystery` | the d12 mystery table |
| 10–13 | Hazard | `hazard` | overworld hazard |
| 14–16 | Loot | `loot` | Overgrown Cache flow-puzzle (items/gear) |
| 17–19 | Elite enemy | `elite` | harder region-gated battle |
| 20 | Cache | `cache` | claim-once spore treasure (the uncommon jackpot) |

Combat = 8/20 (40%), fitting the Wilds as the dangerous T2+ frontier. The breakpoints live in
`undercity_config.py` as `FOG_TABLE` — an ordered list of `(hi, type)` d20 cutoffs, e.g.
`[(5,'wild'), (9,'mystery'), (13,'hazard'), (16,'loot'), (19,'elite'), (20,'cache')]` —
tunable via the balance flow; a display mirror ships in `src/app/undercity/data/*.ts` if the
client needs to show odds.

## 3. Reveal is permanent + season-global

Reuses the existing season-global claim rail (`_claim_first`, surfaced to clients as the
`firsts` map that already drives plundered-treasure visuals):

- A `FOG#<node>` season record stores `{revealed: <type>}`.
- The `/game/state` payload gains `fogReveals: { <nodeId>: <type> }` so **every** client
  renders revealed fog tiles as their outcome type (unrevealed ones stay foggy).

The map itself is never mutated — the node stays `type: 'fog'`; the reveal is dynamic season
state. The server dispatcher always routes a fog node through `_ashen_fog`, which branches on
whether the record exists yet.

## 4. Server

`undercity_engine.py` (pure, unit-testable):
- `roll_fog(rng) -> str` — rolls the d20 and maps it to an outcome type via `FOG_TABLE`.

`undercity_db.py`:
- Dispatcher: `if ntype == 'fog': return _ashen_fog(table, sid, doc, node, region, nodes, prev)`.
- `_ashen_fog(...)`:
  - Read the `FOG#<node>` record.
  - **Unrevealed:** `t = roll_fog(_rng)`; persist `{revealed: t}` (first-lander locks it);
    delegate to that type's resolver (`_wild_battle`, `_wild_battle(elite=True)`, `_mystery`,
    `_hazard`, the `loot` branch, or `_cache`); tag the returned result `fogReveal: t` so the
    client can play the "fog parts" beat.
  - **Already revealed:** delegate straight to the stored type's resolver — no re-roll, no fog
    beat.
- The `loot` resolution currently lives inline in the dispatcher; extract it to a small helper
  (`_loot_puzzle(...)`) so `_ashen_fog` can call it without duplication.
- Add `node`/`region` to the resolver calls as each already expects.

## 5. Client

`board-canvas.ts` + models + resolution modal:
- Add `'fog'` to the space-type union / models and the map-editor palette (so the host can
  place them; per host's call, no map.json seeding).
- **Unrevealed** fog tile: a swirling ashen-grey cloud disc with an "unknown" glyph, drawn
  dynamically per frame from `fogReveals` (same mechanism as the treasure→plundered swap in
  `drawSpace`). Ashen palette (charcoal + faint ember) to match the Wilds.
- **Revealed** fog tile: render as the revealed type's normal disc/icon.
- Modal: when a resolution result carries `fogReveal`, show a brief "The ashen fog parts,
  revealing…" beat, then the **existing** modal for the resolved outcome (battle intro /
  mystery / hazard / loot puzzle / cache). No new modals.

## 6. Placement

The host places `fog` tiles via the map editor. **No placement restriction** — `fog` is a
general space type allowed in any region (its art is ashen/Wilds-themed, but the host
confirmed it can go anywhere). No map-lint rule.

## 7. Edge cases

- Revealing `wild`/`elite` locks the *type*, not the specific enemy — each future battle
  still rolls a fresh region-gated foe.
- `cache` reveal claims once (via `_claim_first` keyed on the fog node); later landings on the
  now-`cache` tile read "already plundered", exactly like a normal cache.
- `loot` reveal regenerates its puzzle each visit, like a normal loot tile.
- Fog resolves only on landing; walking through does not reveal it.

## 8. Testing

FakeTable pytest (`infrastructure/lambda/tests`):
- First landing on a fog node rolls, persists a `FOG#<node>` reveal, and resolves as that type.
- A second landing (same or different player) resolves as the locked type with **no re-roll**
  and no fog beat.
- `roll_fog` maps each d20 band to the right outcome (boundaries: 5/6, 9/10, 13/14, 16/17,
  19/20); `cache` only on 20.
- A revealed-`cache` fog node claims once (second landing = plundered).
- `fogReveals` appears in the state payload for revealed nodes only.

Client: `npm run build` green.

## 9. Files

- `infrastructure/lambda/undercity_config.py` — `FOG_TABLE` (d20 breakpoints).
- `infrastructure/lambda/undercity_engine.py` — `roll_fog`.
- `infrastructure/lambda/undercity_db.py` — `_ashen_fog`, dispatcher branch, `_loot_puzzle`
  extraction, `fogReveals` in the state payload.
- `infrastructure/lambda/tests/` — fog tests.
- `src/app/undercity/engine/board-canvas.ts` — fog tile rendering (foggy + revealed).
- `src/app/undercity/services/undercity-models.ts` — `'fog'` in the space-type union +
  `fogReveals` on the state model.
- resolution modal component — the "fog parts" reveal beat.
- `src/app/undercity/map-editor/` — palette entry.
- `src/app/undercity/data/*.ts` — display mirror of the odds if surfaced.

## 10. Non-goals

- No per-player fog-of-war visibility (reveal is global, per host's call).
- No new outcome types beyond the six existing ones.
- No changes to the resolved types' own balance/behaviour.
