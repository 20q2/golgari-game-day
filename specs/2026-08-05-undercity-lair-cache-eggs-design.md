# Undercity — Lair & Cache Egg Drops

**Date:** 2026-08-05
**Status:** Design approved, pending spec review → implementation plan

## Summary

Make the two **Ruin lairs** (Lord of Extinction, Doomgape) the game's dedicated
place to farm companions: they **always** hand out an egg — a strong one for
beating the boss, a lesser one for scavenging the lair while the boss is down,
*every* time you visit, not just once per cycle. Treasure caches gain a chance
egg like other loot, and dropped eggs are surfaced in the UI (they are currently
granted silently). Sigil lairs and the existing loot/mystery/combat egg drops
are unchanged. This also cleans up two dead `EGG_DROP` entries found during the
egg-source audit. To match, the two Ruin lairs are re-themed in the UI as
**Monster Nests** — a powerful guardian standing over the egg clutches within.

## Background

Companion eggs are minted by `_grant_egg(doc, tier)` and hatch (via the
incubator, 5 min) into pets. Today eggs come from:

| Source | Mechanism | Rate |
|---|---|---|
| Loot tiles | `_maybe_drop_egg(doc, 'loot')` | 6%, {T1:70, T2:30} |
| Mystery tiles | `_maybe_drop_egg(doc, 'mystery')` | 8%, {T1:50, T2:40, T3:10} |
| Combat compost | `_maybe_drop_egg(doc, 'combat')` | 5%, {T1:60, T2:40} |
| Bazaar "Eggs" tab | bought with Spores | n/a (purchase) |
| Mystery / Umori box | `kind:'egg'` reward | fixed tier |
| Player market | instance listing transfer | n/a |

The audit found `EGG_DROP` also defined `'cache'` (10%) and `'lair'` (25%, up to
T4) entries that **nothing ever called** — dead config. This design wires
`'cache'` in and deletes `'lair'`.

### The two lair systems (only Ruin lairs are in scope)

- **Sigil lairs** (6, one per biome — `<biome>_lair`): one season-shared HP
  pool. First global kill slays the true boss (big reward), then it reforms
  permanently as a half-HP **Vestige** (small reward). No refill timer.
  **Out of scope — these stay eggless.**
- **Ruin lairs** (2, `lair_titan` = Lord of Extinction, `n288` = Doomgape;
  `data.RESPAWN_LAIRS`): per-player **kill → abandoned (`LAIR_RESPAWN_MINUTES`
  = 60) → respawn** cycle. Visiting while abandoned yields a once-per-cycle
  scavenge (Spores + `LAIR_SCAVENGE_ITEM_CHANCE` = 18% consumable). These are
  the "signature egg" spaces.

## Goals

- Make Ruin lairs the reliable pet-farm destination: a strong egg for beating
  the boss, and a lesser egg on **every** scavenge visit while the lair is down.
- Treasure caches occasionally drop an egg like other loot.
- Players actually *see* an egg drop when it happens.

## Non-goals

- No change to Sigil lairs, the Vestige mechanic, sigil claims, or the world
  event trigger.
- No change to loot/mystery/combat egg rates, the bazaar Eggs tab, boxes, or the
  player market.
- No new incubation / hatching / pet-balance changes.

## Design

### 1. Ruin lair — boss kill (guaranteed strong egg)

In `_award_respawn_lair_kill` (`undercity_db.py`), after the existing
spores/XP/gear/scroll rewards, grant a **guaranteed tier-3 egg on every clear**
(first-ever and repeats alike; rate-limited only by the 60-min respawn):

```python
egg = _maybe_drop_egg(doc, 'ruin_lair')      # (1.0, {3: 1.0}) → always a T3
if egg:
    out['egg'] = {'tier': egg['tier']}
```

Fold a mention into `out['text']` (e.g. `"… A clutch of eggs lies in the
nest — you take a Legendary egg!"`).

### 2. Ruin lair — scavenge while abandoned (lesser egg, every visit)

In `_lair_scavenge`, grant a **guaranteed egg weighted {T1:70%, T2:30%}** on
**every** scavenge visit — this is the pet-farm loop, so it is deliberately
*not* gated by `entry['scavenged']`:

```python
egg = _maybe_drop_egg(doc, 'ruin_scavenge')  # (1.0, {1: 0.7, 2: 0.3})
if egg:
    out['egg'] = {'tier': egg['tier']}
```

The Spores payout and the 18% consumable chance stay gated to the first scavenge
per abandonment (the `entry['scavenged']` "picked it clean" path); only the egg
is ungated. Restructure `_lair_scavenge` so the early "already picked it clean"
return still rolls and surfaces the egg before returning, e.g.:

- First scavenge this cycle: Spores (+ maybe consumable) **and** an egg.
- Repeat scavenge this cycle: no Spores/consumable ("picked clean"), but still an
  egg from the nest.

Egg throughput is paced by the roll economy (you must keep landing on the tile)
and the single 5-min incubator slot, so an ungated egg is a steady farm rather
than an instant flood. Update the scavenge text for both the first-grab and
picked-clean cases to mention the egg.

### 3. Treasure caches — chance egg (like other loot)

In `_cache`, after `_append_treasure_gear` / `_append_scroll`, roll the (now
wired) cache egg — flat chance, matching the other `_maybe_drop_egg` sources
(caches already pay out once per player per node via `poiClaims`, so no extra
throttle is needed):

```python
egg = _maybe_drop_egg(doc, 'cache')          # (0.10, {1: 0.4, 2: 0.4, 3: 0.2})
if egg:
    out['egg'] = {'tier': egg['tier']}
```

### 4. Data / config changes — `undercity_data.py` `EGG_DROP`

```python
EGG_DROP = {
    'loot':          (0.06, {1: 0.7, 2: 0.3}),
    'mystery':       (0.08, {1: 0.5, 2: 0.4, 3: 0.1}),
    'combat':        (0.05, {1: 0.6, 2: 0.4}),
    'cache':         (0.10, {1: 0.4, 2: 0.4, 3: 0.2}),   # now WIRED (was dead)
    'ruin_lair':     (1.0,  {3: 1.0}),                   # NEW — guaranteed T3 on kill
    'ruin_scavenge': (1.0,  {1: 0.7, 2: 0.3}),           # NEW — guaranteed lesser on scavenge
    # 'lair' entry DELETED (never called; Sigil lairs stay eggless)
}
```

All values live in `undercity_data.py` (weighted tables), consistent with the
tune-undercity-balance convention. No `undercity_config.py` scalar is needed.

### 5. Client — surface dropped eggs (display only)

Dropped eggs currently land in `doc['eggs']` with **no** modal feedback — the
`SpaceEvent` model has no `egg` field and the board modal never renders one.

- `src/app/undercity/services/undercity-models.ts`: add `egg?: { tier: number }`
  to `SpaceEvent`.
- `src/app/undercity/tabs/board-tab.component.html`: render an egg chip mirroring
  the existing gear chip (~line 531), using the existing `eggSpriteUrl(tier)` and
  `tierRarity(tier)` helpers. Place it in the shared reward-chip block so it shows
  for every event that sets `out['egg']` — Ruin kill, scavenge, cache, and (as a
  bonus fix) loot / mystery / combat.
- Verify the combat-finish and `lairAbandoned` events route through the same
  reward-chip display; if not, add the chip to those views too.

No balance mirror is required — drop odds are server-authoritative and never
computed on the client.

### 6. Copy — reframe the two Ruin lairs as "Monster Nests"

The player-facing name and tooltip change from a generic lair to a **Monster
Nest**: a powerful guardian standing over the egg clutches within. This is
copy-only and scoped to the two Ruin nodes — internal identifiers
(`RESPAWN_LAIRS`, `lair_titan`/`n288`, `LAIR_BOSSES`) are unchanged, and the 6
Sigil lairs keep their existing "den / Guild Sigil" copy.

Space-info card in `board-tab.component.ts` (the `RUIN_LAIRS.has(nodeId)` branch,
~lines 2062–2076). Guardian present:

- title: `Monster Nest`
- body: `A clutch of eggs lies within, watched over by ${name}, a powerful
  guardian. Land here to fight — beat ${name} to seize a prize egg. A fresh
  challenge each time; win and the nest falls quiet for an hour.`

Guardian slain (unguarded / refilling) — now that **every** scavenge yields an
egg, both sub-cases advertise an egg:

- title: `Monster Nest — Unguarded`
- not yet scavenged: `${name} lies slain and its nest is unguarded — land here to
  raid the egg clutch and scrounge what's left. ${name} returns in ~${minsLeft}m.`
- already scavenged: `You've picked this nest clean of loot, but the clutch still
  holds eggs — land here to take another. ${name} returns in ~${minsLeft}m.`

For thematic consistency, the server drop-text (§1–§3) uses the same
nest/clutch/guardian language. Also check the `lairAbandoned` event modal and any
board legend/label for a stray "Lair" on these two nodes and rename to "Nest".

## Resulting egg-source table (post-change)

| Source | Rate | Tiers |
|---|---|---|
| Ruin boss kill | **guaranteed** | T3 |
| Ruin scavenge (every visit) | **guaranteed** | {T1:70, T2:30} |
| Cache | 10% | {T1:40, T2:40, T3:20} |
| Loot / Mystery / Combat | 6 / 8 / 5% | unchanged |
| Sigil lairs | — | none (unchanged) |

Ruin lairs are the only guaranteed and highest-value source; caches add board-wide
variety. Throughput (~2 guaranteed T3/hour across both Ruin lairs over a 6–8h
session, 5-min incubation) is accepted.

## Testing

Backend (`infrastructure/lambda/tests/`, in-memory FakeTable suite):

- Ruin-boss kill grants a T3 egg: assert `out['egg']['tier'] == 3` and a new egg
  in `doc['eggs']`, on both first-ever and repeat kills.
- Ruin scavenge grants an egg on **every** visit: assert `out['egg']` present
  with tier ∈ {1, 2} on the first scavenge, and that a **repeat** scavenge in the
  same abandonment window still returns an egg but no Spores ("picked clean").
- Cache egg fires from the `'cache'` table (force `_rng` under the chance) and
  is absent when the roll misses.
- Existing companion / egg tests stay green.

Run: `cd infrastructure/lambda && python -m pytest tests -q`.

> Note: ~50 pre-existing failures in `test_map.py` / `test_deep_dungeons.py` /
> `test_undercity_spells.py` already fail at clean HEAD (commit 43414e2) and are
> unrelated to this change.

Client: `npm run build` from repo root after the model + template edits.

## Files touched

- `infrastructure/lambda/undercity_data.py` — `EGG_DROP` (add `ruin_lair`,
  `ruin_scavenge`; wire `cache`; delete `lair`).
- `infrastructure/lambda/undercity_db.py` — `_award_respawn_lair_kill`,
  `_lair_scavenge`, `_cache` (grant + surface egg).
- `infrastructure/lambda/tests/test_undercity_companions.py` (or a lair-focused
  test module) — new coverage.
- `src/app/undercity/services/undercity-models.ts` — `SpaceEvent.egg`.
- `src/app/undercity/tabs/board-tab.component.html` — egg reward chip.
- `src/app/undercity/tabs/board-tab.component.ts` — "Monster Nest" space-info
  copy for the two Ruin nodes (`RUIN_LAIRS` branch).

## Deploy

Server changes take effect only after `cdk deploy` — run by the host, not the
agent. Finish with tests green and note a deploy is needed.
