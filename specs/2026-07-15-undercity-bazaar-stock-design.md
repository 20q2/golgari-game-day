# Undercity — Rot-Farm Bazaar: tabs + rotating limited stock

**Date:** 2026-07-15
**Status:** Approved, ready for planning
**Area:** Undercity sub-game — shop (`shop` space type / Rot-Farm Bazaar)

## Problem

The bazaar modal ([board-tab.component.html:199](../src/app/undercity/tabs/board-tab.component.html#L199))
dumps the *entire* catalogue on one screen: all 9 gear pieces, all 8 consumables,
and every tier-1 grimoire, in three stacked sections. It's overwhelming and there
is no scarcity — anything is always available for its flat price.

## Goals

1. Split the bazaar into three tabs: **Gear**, **Consumables**, **Grimoires**.
2. Each visit offers only a **few** items per tab (not the full catalogue).
3. Stock **refreshes on a timer**: the selection re-rolls and quantities reset
   every 30 minutes of wall-clock time.
4. Buying **depletes** shared stock — grab it before another player does.

## Decisions (from brainstorming)

| Question | Decision |
|---|---|
| Stock scope | **Shared per bazaar node** — everyone at that node sees the same stock (reuses the trading-post per-node/per-season persistence pattern). |
| Depletion | **Buying depletes it.** Each gear/consumable line has a quantity; at 0 it shows "Sold out" until the refresh. |
| Stock size | **3 gear / 3 consumables / 2 grimoires** per refresh. |
| Grimoires | **Do not deplete** — stay buyable by everyone until refresh (blocked only if you already own it). Protects build variety. |
| Refresh timer | **30 minutes**, anchored to a fixed wall-clock window shared by all players. |
| Selection | **Spread-guaranteed random** — gear across distinct slots, consumables biased to ≥1 in-battle, grimoires 2 distinct tier-1. |
| Per-line qty | **2** — a line survives one purchase before selling out. |

## Architecture

All shop rules already live server-side (`infrastructure/lambda/undercity_db.py` +
`undercity_data.py`); the client renders and calls `POST /game/action` with
`{action:'buy', itemId}`. This design keeps that split: the server owns stock
generation, windowing, and depletion; the client only renders the delivered stock.

### 1. Balance constants — `undercity_data.py`

```python
# Rot-Farm Bazaar limited stock
SHOP_REFRESH_MIN     = 30   # wall-clock window length (minutes)
SHOP_GEAR_SLOTS      = 3    # gear lines offered per refresh (distinct slots)
SHOP_CONSUMABLE_SLOTS = 3   # consumable lines offered per refresh (>=1 in-battle)
SHOP_GRIMOIRE_SLOTS  = 2    # tier-1 grimoires offered per refresh (never deplete)
SHOP_GEAR_QTY        = 2    # units per stocked gear line
SHOP_CONSUMABLE_QTY  = 2    # units per stocked consumable line
```

### 2. Stock record — `SHOP#<node>`

Season-scoped DynamoDB item, mirroring the trading post's `POST#<node>`:

```
{ pk: <season_pk>, sk: 'SHOP#<node>',
  window: <int>,                 # which 30-min window this stock belongs to
  gear:        [{item, qty}],    # SHOP_GEAR_SLOTS entries
  consumables: [{item, qty}],    # SHOP_CONSUMABLE_SLOTS entries
  grimoires:   [item, item] }    # SHOP_GRIMOIRE_SLOTS ids, no qty
```

### 3. Windowing

- `_shop_window(now=None) -> int`: `floor(utc_epoch_seconds / (SHOP_REFRESH_MIN*60))`.
  A single overridable helper (tests monkeypatch it to force a window). Uses
  `datetime.utcnow()` to match the module's existing time convention (`_now`).
- `_shop_window_end(window) -> str`: ISO timestamp of the *next* window boundary,
  shipped to the client as `refreshesAt` for the "Restocks in Xm" countdown. The
  client needs no mirror of `SHOP_REFRESH_MIN`.

### 4. Deterministic generation — `_gen_shop_stock(node, window)`

The selection must be **identical for every player** in the same window without a
coordinated write (display-seeded on read; persisted only when a purchase depletes
it). Therefore generation is deterministic in `(node, window)`.

> ⚠️ **Correctness requirement:** seed with a **stable** hash
> (`zlib.crc32(f'{node}:{window}'.encode())` or `hashlib`), **not** Python's builtin
> `hash()`. Builtin `hash()` on strings is salted per process (`PYTHONHASHSEED`), so
> two Lambda invocations would otherwise generate *different* stock for the same
> window. Use a private `random.Random(seed)` instance, not the module `db._rng`.

Selection rules (using the seeded local RNG):
- **Gear:** group `GEAR` by slot; for each of the 3 slots (fang / carapace / charm)
  pick one piece at random (any tier). `qty = SHOP_GEAR_QTY`. With 3 slots this
  yields one per slot — always a real build spread.
- **Consumables:** guarantee ≥1 in-battle item — pick 1 from the `inBattle` pool,
  then fill the remaining slots from the rest, no duplicates. `qty = SHOP_CONSUMABLE_QTY`.
- **Grimoires:** sample `SHOP_GRIMOIRE_SLOTS` distinct ids from the tier-1 grimoires
  (7 exist after §4a → offers 2 of 7, a genuine rotation). No qty.

### 4a. New tier-1 grimoires — enrich the pool

The tab was thin (only 3 tier-1 tomes existed). Add **4 more**, taking the tier-1 pool
to **7**, so stocking 2 per refresh is a real rotating selection. Every new tome
bundles **existing** tier-1 spells → **no engine code**, only data rows in
`undercity_data.py` `GRIMOIRES` plus the display mirror in
`src/app/undercity/data/spells.ts`. (Reusing existing/innate spell ids in a book is
the established pattern — Wayfarer's Atlas already reuses `skitter_step`. The only
integrity rule is 1–3 existing spells per grimoire,
[test_undercity_spells.py:63](../infrastructure/lambda/tests/test_undercity_spells.py#L63).)

The original 3 stay as the "pure" single-lane tomes; the 4 new ones are two-lane
combos, each a distinct build archetype (per the build-diversity bar):

| id | name | spells | archetype | cost |
|---|---|---|---|---|
| `warcasters_screed` | Warcaster's Screed | `rot_surge`, `spore_bolt` | Aggro caster — buff ATK, then nuke | 35 |
| `hexweavers_codex` | Hexweaver's Codex | `bone_chill`, `bog_snare` | Control/hexer — two rival curses | 35 |
| `nightrunners_ledger` | Nightrunner's Ledger | `glowveil`, `skitter_step` | Skirmisher — +SPD/flee, then blink | 32 |
| `tinkers_manual` | Tinker's Manual | `harden_shell`, `scrap_toss` | Bruiser — harden, then chuck scrap | 30 |

Notes:
- `spore_bolt` intentionally appears in both Moldering Folio and Warcaster's Screed
  (the latter adds the `rot_surge` self-buff on top). Overlap is fine.
- The new tomes reuse innate biome spells (`rot_surge`, `bone_chill`, `bog_snare`,
  `glowveil`, `scrap_toss`); a player whose home biome already grants one just gets a
  redundant lane in that book — acceptable, not a blocker.
- Each new `GRIMOIRES` entry needs a `blurb`; mirror name/cost/spells/blurb into
  `spells.ts`. Existing tier-1 spell rows are unchanged.

### 5. Lazy read — `_shop_stock(table, sid, node)`

Load `SHOP#<node>`. If missing **or** `record['window'] != _shop_window()`, return a
freshly generated (full-qty) stock for the current window — **no write on read**,
matching how posts/veins/vaults are display-seeded ([undercity_db.py:470-486](../infrastructure/lambda/undercity_db.py#L470-L486)).
A stale-window persisted record is simply ignored, which is how the 30-minute reset
happens: the old depleted stock is discarded and regenerated at full quantity.

### 6. `_buy` changes — [undercity_db.py:2015](../infrastructure/lambda/undercity_db.py#L2015)

After the existing "are you at a shop?" guard, resolve `stock = _shop_stock(...)`.

- **Gear** (`item_id in data.GEAR`): find the matching entry in `stock['gear']` with
  `qty > 0`; else `409 "The bazaar isn't stocking that."` / `409 "Sold out — check back after the restock."`.
  Then the existing cost / trade-in-refund / spore check / equip logic runs.
  On success, decrement that line's qty.
- **Consumables** (`item_id in data.CONSUMABLES`): same in-stock + qty>0 check, then
  the existing bag-full + cost logic, then decrement.
- **Grimoires** (`item_id in data.GRIMOIRES`): require `item_id in stock['grimoires']`
  (the existing `tier != 1` guard and own-check stay). **No qty check, no decrement.**
- Persist ordering mirrors `_trade` ([undercity_db.py:2103-2106](../infrastructure/lambda/undercity_db.py#L2103-L2106)):
  guard the player write with `_save_or_conflict` first; only if it succeeds and a
  gear/consumable line was depleted, `put_item` the `SHOP#<node>` record (tagged with
  the current `window`). Last-writer-wins — the last-unit double-buy race is accepted,
  identical to the trading post's shared-stock race.

### 7. State snapshot — [undercity_db.py:437-504](../infrastructure/lambda/undercity_db.py#L437-L504)

Alongside `posts`/`sites`/`veins`/`vaults`, build a `bazaars` dict. For every
`shop` node, produce a view from the current-window stock (persisted if present and
current, else generated):

```
bazaars[node] = {
  'gear':        [{item, qty}, ...],
  'consumables': [{item, qty}, ...],
  'grimoires':   [item, ...],
  'refreshesAt': <ISO next-window boundary>,
}
```

Display-seed untouched/stale shop nodes the same way posts are
([undercity_db.py:472-474](../infrastructure/lambda/undercity_db.py#L472-L474)).
Add `'bazaars': bazaars` to the `out` payload.

## Client (Angular)

### Model — `src/app/undercity/services/undercity-models.ts`

```ts
export interface ShopStockItem { item: string; qty: number; }
export interface BazaarView {
  gear: ShopStockItem[];
  consumables: ShopStockItem[];
  grimoires: string[];
  refreshesAt: string; // ISO
}
// on UndercityState:
bazaars?: Record<string, BazaarView>;
```

### State service — `undercity-state.service.ts`

```ts
readonly bazaars = computed(() => this._state()?.bazaars ?? {});
```

### `board-tab.component.ts`

- `shopTab = signal<'gear' | 'consumables' | 'grimoires'>('gear')`.
- `currentBazaar = computed(() => this.store.bazaars()[this.store.you()?.position ?? ''] ?? null)`.
- `bazaarRestockLabel = computed(...)` → minutes remaining from `currentBazaar()?.refreshesAt`
  (recomputes when state polls, same cadence as the existing `cooldownLabel`).
- `buy()` is unchanged. Buy buttons disable when a line's `qty === 0`.
- Item display info is looked up from the existing `GEAR_MAP` / `CONSUMABLE_MAP` /
  `GRIMOIRE_MAP` — the stock carries only ids, so **no data duplication** is added.
- The old `gear` / `consumables` / `shopGrimoires` full-catalogue fields are no longer
  used by the shop modal (keep or remove per what else references them).

### `board-tab.component.html` — shop modal

Replace the three stacked `.shop-section` blocks with:
- a 3-button tab bar bound to `shopTab`,
- a panel per tab rendering only `currentBazaar()` items for that category,
- a qty badge / "Sold out" state on each row (grimoires show "Owned" as today; no qty),
- "Restocks in {{ bazaarRestockLabel() }}" in the modal header.

The "Leave" button and modal chrome are unchanged.

### `board-tab.component.scss`

Add `.shop-tabs` / `.shop-tab` (+ active state), a qty badge, and sold-out styling,
reusing STYLE_GUIDE design tokens (`--primary-color`, `--accent-color`, breakpoints).

## Testing — `infrastructure/lambda/tests/test_undercity_db.py`

- **Update `test_buy_gear_and_consumables`:** its "every shop stocks all tiers"
  assumption is gone. Seed a known `SHOP#<node>` record directly (or monkeypatch
  `_gen_shop_stock`/`_shop_window`) so specific items are in stock, then buy them.
- **New tests:**
  - Stock shape: 3 gear across distinct slots, 3 consumables incl. ≥1 in-battle,
    2 distinct tier-1 grimoires.
  - Depletion: buying a `qty 2` line twice leaves qty 0; a third buy → `409` sold out.
  - Grimoire non-depletion: a stocked grimoire does not decrement; a second player
    can still buy it; the same player's repeat is blocked by the own-check.
  - Window rollover: advance `_shop_window`, stock regenerates at full qty.
  - Determinism: two `_gen_shop_stock(node, window)` calls yield the same selection
    (stable hash, not builtin `hash()`).
  - Grimoire pool: 7 tier-1 tomes exist; each new tome's spells all resolve in
    `SPELLS` (the existing `test_every_grimoire_spell_exists` already enforces this —
    just add the rows and it must stay green).
- `test_shop_shrine_gamble_guards` stays valid (not-at-shop guard runs first).

Run: `cd infrastructure/lambda && python -m pytest tests -q`.

## Non-goals / accepted trade-offs

- Last-unit double-buy race is accepted (last-writer-wins, matching the trading post).
- No per-player stock, no tier-climb-over-time progression (both considered, rejected).
- Grimoire scarcity is intentionally soft (never depletes) to protect build variety.
