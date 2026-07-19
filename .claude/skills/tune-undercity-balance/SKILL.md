---
name: tune-undercity-balance
description: Use when adjusting/tuning any Undercity balance or economy number — roll regen/cap, starting rolls, HP regen, spores, PvP steal, facility costs (shop/shrine/ossuary/snare), drop rates, evolution/loot/mystery weights, renown-shop prices and starter kit, or item costs. Covers where each number lives, the client mirror, the engine coupling, and the test/deploy loop.
---

# Tune Undercity Balance

## Overview

Undercity balance numbers live in two Python files, and some are **mirrored** into the Angular client for display. The Python Lambda is authoritative — the client never computes balance, it only shows it. Change the server number, update any display mirror, keep the tests green, then the host deploys.

**Two homes for numbers:**
- **Scalars** (single values) → [`infrastructure/lambda/undercity_config.py`](../../../infrastructure/lambda/undercity_config.py). Re-exported via `from undercity_config import *` in `undercity_data.py`, so all code reads them as `data.X`.
- **Weighted tables / structured data** (dicts, lists, per-item costs) → [`infrastructure/lambda/undercity_data.py`](../../../infrastructure/lambda/undercity_data.py) (loot, shop stock, mystery, evolution, gear drops, renown prices, `GEAR`/`CONSUMABLES` cost fields).

## The loop (every change)

1. Edit the number in `undercity_config.py` (scalar) or `undercity_data.py` (table).
2. **Mirror it** if the client displays it — see table below. Not everything is mirrored.
3. **Update any test** that asserts the old value (grep the number/constant under `infrastructure/lambda/tests/`).
4. Backend green: `cd infrastructure/lambda && python -m pytest tests -q`
5. If you touched a `.ts` mirror: `npm run build` (from repo root).
6. Config only takes effect after a `cdk deploy` — **the host runs deploys, not you.** End with tests green and say a deploy is needed.

## Where common tunables live

| Want to change | File | Symbol |
|---|---|---|
| Roll cap / starting rolls | config | `ROLL_CAP`, `JOIN_ROLLS`, `SEAL_BONUS_CAP` |
| Roll regen rate | config | `ROLL_REGEN_MINUTES`, `ROLLS_PER_REGEN` |
| HP regen / respawn | config | `HP_REGEN_PCT`, `HP_REGEN_INTERVAL_MIN`, `COMPOST_*` |
| PvP steal | config | `PVP_SPORE_STEAL*`, `DEATHRITE_STEAL_MULT` |
| Facility knobs | config | `SHOP_REFRESH_MIN`, `SHOP_*_SLOTS/QTY`, `SHRINE_*`, `OSSUARY_*`, `SNARE_SPILL_PCT` |
| Renown shop | config + data | `SHOP_START_RENOWN` (config); `HAT_PRICES`, `PAINT_PRICE`, `RENOWN_SHOP_ITEMS` (data) |
| Renown leaderboard weights | data | `RENOWN` (+ `compute_renown`) |
| Gear/consumable prices & stats | data | `GEAR`, `CONSUMABLES` (`cost`, `atk`/`def`/…) |
| Drop rates | data | `GEAR_DROP`, loot/mystery chances in `undercity_db.py` |
| Evolution / XP | data | `TIER2`, `APEX`, `XP_REWARDS`, `xp_to_next()` |
| DEBUG (free rolls, pick-your-die) | config | `DEBUG` — **set False before game night** |

## Client display mirrors

Only mirror what the UI shows. Server-computed values sent in the state payload (e.g. `nextRollAt`, per-game renown) need **no** mirror.

| Server number | Client mirror |
|---|---|
| `GEAR`, `CONSUMABLES` (name/cost/desc) | [`src/app/undercity/data/items.ts`](../../../src/app/undercity/data/items.ts) |
| `HATS`, `PAINTS`, `HAT_PRICES`, `PAINT_PRICE` | [`src/app/undercity/data/cosmetics.ts`](../../../src/app/undercity/data/cosmetics.ts) |
| `RENOWN_SHOP_ITEMS` | `items.ts` (`RENOWN_SHOP_ITEMS`) |
| Roll regen minutes / cap | none — client reads `nextRollAt` from state |

## Gotcha: unparameterized mechanics

If the behavior you want isn't a knob yet, adding a scalar is not enough — the engine may hardcode it. Add the scalar **and** wire it in.

Example (regen was `+1` per tick): added `ROLLS_PER_REGEN` to config, then changed `undercity_engine.py::regen_rolls` from `+ intervals` to `+ intervals * data.ROLLS_PER_REGEN`, and updated the engine test. Rule of thumb: after editing a scalar, grep the codebase for it — if nothing reads it, you also need the code change.

## Common mistakes

- **Editing only the server number** when the value is shown in the UI → client shows the old price/stat. Update the mirror.
- **Leaving a test red** — tests assert concrete numbers (e.g. `assert you['rolls'] == 3`). Update them to the new expected value; don't loosen the assertion.
- **Assuming it's live** — nothing changes for players until the host `cdk deploy`s the Lambda.
- **Shipping with `DEBUG = True`** — that disables the roll economy entirely.
