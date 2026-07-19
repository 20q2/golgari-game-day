# The Undercity — Gear Drops

Design doc. Make equipment (gear) something you find through play, not only
something you buy at the shop.

Origin: player request — "getting a piece of equipment should happen with slight
frequency; mystery events, shops, battles with monsters, and treasure troves
should all be sources for it."

## Problem

Today gear is **shop-only** and **swap-in-place**. There are 10 pieces across 3
slots (fang / carapace / charm), tiers 1–3, cost 20 / 45 / 80
([undercity_data.py `GEAR`](../infrastructure/lambda/undercity_data.py)). You
never *own* unequipped gear: buying a piece equips it immediately and auto-sells
whatever was in that slot for 50% of its cost (`GEAR_SELL_BACK`, `_buy` at
`undercity_db.py:2459`).

The existing loot sources — battle wins, mystery events, loot tiles, dungeon
treasure — already hand out spores, consumables, and grimoires, but **never
gear**. This design lets those sources occasionally drop a piece of gear.

## Decisions (locked)

1. **Drop handling: auto-equip only if it's a strict upgrade, else spores.**
   No gear inventory is introduced. This reuses the swap-and-sell-back economics
   `_buy` already uses and the "convert to spores when unusable" pattern from
   grimoire duplicates / full bags.
2. **Frequency: "noticeable" (~8–12%)** for the common sources.
3. **Drop tier scales with the source's difficulty** — weak sources drop low
   tiers, hard/one-time spaces drop high tiers.
4. **Sources: all four named** — wild & elite battles, mystery events, loot
   tiles, and dungeon treasure + lair/boss. (Shops already sell gear directly.)

## Mechanic — one shared helper

New helper in `undercity_db.py`:

```python
def _roll_gear_drop(doc, tier_weights):
    """Drop a gear piece per the given tier profile.
    - pick a random slot (fang/carapace/charm)
    - pick a tier from tier_weights, then a GEAR id in that slot+tier
    - strict upgrade (dropped tier > equipped tier, or slot empty):
        equip it; displaced piece sells for int(cost * GEAR_SELL_BACK) spores
    - equal or worse tier:
        salvage — add int(dropped cost * GEAR_SELL_BACK) spores, leave gear as-is
    returns {'id', 'slot', 'outcome': 'equipped'|'salvaged',
             'soldSpores', 'displaced'} or None
    """
```

Notes:
- Tier comparison is by the `tier` field. Equal tier → salvage (keeps the
  player's chosen build; e.g. a tier-2 Seer Charm won't be auto-replaced by a
  dropped tier-2 Serrated Charm).
- Because only a *strict* upgrade equips, a geared-up player increasingly just
  gets salvage spores. The mechanic self-limits and never fully displaces the
  shop.
- Callers roll the source's drop chance first; on a hit they call the helper and
  surface the returned dict on their result as `out['gear']`.

## Per-source wiring

Chance + tier profile live in a new `GEAR_DROP` table in `undercity_data.py`
(the numbers are the tuning surface):

| Source | Chance | Tier profile | Injection point |
|---|---|---|---|
| Wild win | ~10% | t1 | `_finish_wild` — roll gear before the existing `itemChance` consumable roll |
| Elite win | ~12% | t1–t2 | `_finish_wild` (`elite` branch) |
| Loot tile | ~10% | t1 | `_loot` branch of `_resolve_space` |
| Mystery (free-item) | ~12% | t1–t2 | inside `_mystery`, in the `res['item']` branch, ahead of the grimoire upgrade |
| Dungeon treasure (`_cache` / `_vault`) | ~50% | t2–t3 | `_cache` / `_vault` finishers (first-visit POIs) |
| Lair / boss | ~35% | t2–t3 | `_finish_lair` / `_finish_boss`, on an `attacker` (win) outcome only |

Rationale for the elevated big-ticket chances: `_cache`/`_vault` are once-per-
player POIs and lair/boss are hard fights, so a ~10% chance would make them
almost never drop — a poor "treasure" feel. These three numbers are the ones
most worth tuning and are isolated in `GEAR_DROP`.

Guard rails:
- Battle drops only on a win (`result['outcome'] == 'attacker'`), never on a
  loss or a neutral timeout (combat invariant: no reward on timeout).
- A drop on top of the existing consumable roll is fine (they're independent
  rolls); order gear first so a gear hit is the headline result.

## Client

`src/app/undercity/services/undercity-models.ts`: add an optional `gear` field
to the space-result / event model, carrying `{ id, outcome, soldSpores,
displaced }`.

Rendering (reuses the already-imported `GEAR_MAP` + slot icons in
`board-tab.component.ts`):
- Space-result modal chip ([board-tab.component.html:186](../src/app/undercity/tabs/board-tab.component.html#L186)),
  alongside the existing `item` / `paint` / `hat` chips:
  - equipped: `🗡 Wurm Tooth — equipped!` (slot icon)
  - salvaged: `Chitin Scrap — salvaged (+10)`
- Battle-result view surfaces the same `gear` field (mirror how `item` is shown
  in the wild/elite result).

No `data/*.ts` balance mirror is required: drop chances/tier weights are
server-only logic, not displayed constants (per the mirror invariant, only
*displayed* balance numbers must be mirrored).

## Tests (`infrastructure/lambda/tests`)

- `_roll_gear_drop`: equips when strictly better; salvages (adds spores, no
  equip) when equal or worse; equips into an empty slot; sells the displaced
  piece for the right amount.
- Flow: a wild win with a forced gear roll surfaces `out['gear']`; same for a
  mystery free-item and a `_cache` visit.
- Keep the existing suite green, including
  `test_balance_good_play_beats_fodder`.

## Out of scope (YAGNI)

- No gear inventory / stash / equip-from-bag UI.
- No new gear pieces, slots, or riders — this only changes *how you obtain* the
  existing 10.
- No player choice modal on a drop (auto-resolve keeps the turn flowing).
