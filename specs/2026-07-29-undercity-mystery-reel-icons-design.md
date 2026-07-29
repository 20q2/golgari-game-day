# Mystery Reel: a distinct icon per outcome

**Date:** 2026-07-29
**Status:** Approved, ready for implementation plan

## Problem

The mystery-space "lottery machine" (`mystery-reel.component.ts`) slams to a stop
on a symbol that teases the outcome the server rolled. Today it has only six
faces (`spores, item, heal, hurt, warp, mystery`), and the client maps an outcome
to a face by *sniffing event fields* in `board-tab.component.ts#mysterySymbol`:

```ts
if (ev.item) return 'item';
if (ev.to) return 'warp';
if ((ev.hp ?? 0) > 0) return 'heal';
if ((ev.hp ?? 0) < 0 || ev.sporesLost) return 'hurt';
if (ev.spores) return 'spores';
return 'mystery';
```

But the server's mystery event (`undercity_db.py#_mystery`) only ever carries
`item` / `gear` / `grimoire` / `to`. It never sends the spore/xp/hp deltas or the
`heal` / `buff` / `curse` flags. So the great majority of outcomes fail every
`if` and fall through to `mystery` — the generic `help` (?) icon. Every
XP / buff / curse / heal / spore-gain / spore-loss / jackpot roll shows the same
question mark.

## The d12 outcome table (source of truth: `engine.roll_mystery`)

| Roll(s) | What happens | `outcome` key | Icon |
|---|---|---|---|
| 1 | Spore stash (gain) | `spores` | `grain` |
| 2, 3 | Insight (+10 XP) | `xp` | `auto_awesome` |
| 4, 6 (consumable) | Free consumable | `item` | `backpack` |
| 4/6/12 → gear | Gear find | `gear` | `shield` |
| 4/6/12 → grimoire | Grimoire find | `grimoire` | `menu_book` |
| 5 | Full heal + cleanse | `heal` | `favorite` |
| 7 | Combat buff (next battle) | `buff` | `bolt` |
| 8 | Pickpocket imp (−Spores) | `theft` | `money_off` |
| 9 | Bad mushrooms (−HP) | `hurt` | `heart_broken` |
| 10 | Cave-in (teleport) | `warp` | `cyclone` |
| 11 | Cursed idol (−ATK) | `curse` | `dangerous` |
| 12 | Jackpot (Spores+XP+item) | `jackpot` | `casino` |

Icons reuse the app's existing iconography where a concept already has one:
grimoire = `menu_book` (`board-tab` reward list), curse = `dangerous`
(`combat.ts` cursed_idol), jackpot/luck = `casino` (ossuary / Loaded Die).
`mystery`/`help` is kept only as a defensive fallback that should never render.

## Design

### Server: stamp a canonical `outcome` on the mystery event

`undercity_db.py#_mystery` already knows exactly what it did (it holds `res` and
sets `out['gear'] / out['grimoire'] / out['item'] / out['to']`). Add one field,
`out['outcome']`, set once near the end of `_mystery` after the item/gear/grimoire
resolution, by priority:

1. `res['roll'] == 12` → `jackpot`
2. `out.get('gear')` → `gear`
3. `out.get('grimoire')` → `grimoire`
4. `out.get('item')` → `item`
5. `res['heal']` → `heal`
6. `res['buff']` → `buff`
7. `res['curse']` → `curse`
8. `res['teleport']` → `warp`
9. `res['hpPct'] < 0` → `hurt`
10. `res['spores'] < 0` → `theft`
11. `res['spores'] > 0` → `spores`
12. `res['xp'] > 0` → `xp`
13. else → `mystery`

Extract this priority ladder into a small pure helper
`engine.mystery_outcome(res, out)` so it is unit-testable without DynamoDB and so
the mapping lives beside `roll_mystery`. `_mystery` calls it and assigns the
result to `out['outcome']`.

### Client: map `outcome` → reel face; expand the face set

- `undercity-models.ts`: add `outcome?: string` to `SpaceEvent`.
- `mystery-reel.component.ts`: expand the `SYMBOLS` record to one entry per
  outcome key above (icon + color), keeping `mystery` as the fallback. Colors
  follow the existing palette feel: gains warm/gold-green, losses red, warp teal,
  curse purple-red, jackpot gold, xp/buff bright accent.
- `board-tab.component.ts#mysterySymbol`: replace the field-sniffing body with
  `return ev.outcome || 'mystery';` — trust the server's `outcome`. No knowledge
  of the reel's face set is needed here: the reel component already guards unknown
  keys (`this.symbols[this.target] ? this.target : 'mystery'` in
  `ngAfterViewInit`), so a stale client that receives a face it doesn't know
  simply shows the fallback rather than crashing.

The reel builds its random spin strip from `KEYS = Object.keys(SYMBOLS)`, so
expanding `SYMBOLS` automatically enriches the decoy faces too — the machine now
spins through the full variety before landing.

## Testing

- **Engine unit tests** (`tests/test_undercity_engine.py`): `mystery_outcome`
  returns the expected key for each branch — jackpot priority over its own
  spores/xp/item, gear vs grimoire vs consumable, heal, buff, curse, warp, hurt,
  theft, spores, xp, and the defensive `mystery` fallback.
- **DB integration** (`tests/test_undercity_db.py`): a `_mystery` result always
  carries a non-empty `outcome` that is one of the known keys, across many seeded
  rolls.
- **Client:** `npm run build` (lint is known-broken in this repo — verify via
  build). The reel is pure presentation; no client test runner exists.

## Out of scope

- Surfacing spore/xp/hp deltas as chips on the mystery *result card* (the reel
  fix does not require it). Can be a follow-up.
- Any change to the mystery odds or rewards (`roll_mystery` numbers untouched).
- Reel animation/timing/particles.
