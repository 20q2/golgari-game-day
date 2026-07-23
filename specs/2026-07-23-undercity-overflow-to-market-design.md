# Undercity — overflow items go to the Player Market

**Date:** 2026-07-23
**Status:** Approved, ready for implementation plan

## Problem

When loot outgrows the player's carrying capacity, the item is destroyed for a
pittance:

- A **gear drop with a full gear stash** is auto-ground into crafting materials
  (`_roll_gear_drop` → `_grind_materials`, surfaced as the "stash full →
  materials" reward chip).
- A **consumable drop with a full bag** is salvaged into a flat 5 Spores
  (`_give_consumable`).

Both feel like the game is trashing a find you earned. The backend already ships
a full **Player Market** (`_market_list` / `_market_buy` / `_market_cancel`,
`_MARKET_KINDS` covering gear/consumable/scroll, price bands, a per-seller
listing cap). This change reroutes the two overflow paths into that market
instead of destroying the item.

## Behavior

On overflow, instead of destroying the item, **auto-list it on the Player
Market**:

- **Price:** the band floor — 50% of the item's base cost
  (`MARKET_PRICE_MIN_PCT`, already `0.5`). Same floor the manual list path
  enforces as its minimum.
- **Listing cap:** auto-listings **bypass** the `MARKET_MAX_LISTINGS` (5) cap. A
  player who never clears inventory can accrue more than 5 active listings via
  overflow. (Manual listing still enforces the cap, and every listing — auto or
  manual — counts toward the manual-list gate.)
- **Recoverable, not force-sold:** the item becomes one of the player's own
  market listings. They can cancel it at the Plaza (it returns to inventory once
  there's room) or let it sell for Spores. Nothing is lost.

Scope (confirmed): **gear** (stash-full drops) and **consumables** (bag-full
drops). Out of scope:

- **Scrolls** — the satchel-full path still converts to Spores
  (`SCROLL_OVERFLOW_SPORES`). The market already supports the `scroll` kind, so
  this is a trivial follow-up if wanted.
- **Salvage Yard "grind"** — a deliberate player choice, not trashing;
  unchanged.

### Known tradeoff

Floor price + cap bypass means a player who never visits the Plaza can quietly
flood the shared season market with cheap listings. This is the accepted design;
noted so it isn't a surprise.

## Backend design (`infrastructure/lambda/undercity_db.py`)

The overflow happens deep inside roll/loot helpers (`_roll_gear_drop`,
`_give_consumable`) that only mutate `doc`; the player doc is committed later by
the caller via `_save_or_conflict`. A market listing is a **separate**
`MARKET#<id>` row. If we minted that row inline and the later player-doc write
lost an optimistic-lock race (409), the listing would persist for a drop the
player never actually banked — an orphan/duplicate on retry.

So listings are **deferred**: queued on the doc, minted only after the player
doc commits.

### Queue on the doc

A transient `doc['_autoList']` list of `{'kind', 'itemId'}` entries:

- `_roll_gear_drop`: when `len(stash) >= GEAR_STASH_SIZE`, append
  `{'kind': 'gear', 'itemId': gid}` instead of calling `_grind_materials`. The
  returned drop dict gets `outcome: 'listed'` and carries `listPrice` (the
  computed floor) in place of `materials`.
- `_give_consumable`: when `len(bag) >= BAG_SIZE`, append
  `{'kind': 'consumable', 'itemId': item}` instead of crediting 5 Spores, and
  return a signal that lets callers report "listed" rather than "+5 Spores"
  (e.g. return the item id with an out-of-band flag, or a small result object —
  chosen during implementation to keep all existing callers correct: lines
  ~1574 `_grant_to_player`, ~2489 `_award_item`, ~2800, ~3311).

A tiny helper keeps the two call sites uniform:

```python
def _queue_autolist(doc, kind, item_id):
    """Queue an overflow item to be listed on the Player Market after the
    player doc commits. Returns the floor list price."""
    price = _market_price_band(kind, item_id)[0]
    doc.setdefault('_autoList', []).append({'kind': kind, 'itemId': item_id})
    return price
```

### Flush after commit

```python
def _flush_autolist(table, sid, doc):
    """Mint a MARKET# listing for each queued overflow item, at the floor price,
    bypassing the per-seller listing cap. Called only after the player doc has
    committed. Best-effort per entry; clears the queue."""
    pending = doc.pop('_autoList', None)
    if not pending:
        return
    pk = _season_pk(sid)
    for entry in pending:
        kind, item_id = entry['kind'], entry['itemId']
        spec = _MARKET_KINDS.get(kind)
        if not spec:
            continue
        price = _market_price_band(kind, item_id)[0]
        listing_id = '%08x' % _rng.getrandbits(32)
        table.put_item(Item={
            'pk': pk, 'sk': f'MARKET#{listing_id}', 'id': listing_id,
            'sellerId': doc['userId'], 'sellerName': doc.get('username', '?'),
            'kind': kind, 'itemId': item_id, 'price': price,
            'createdAt': _now(), 'auto': True})
```

`_save_or_conflict` gains an optional `sid` and flushes on success:

```python
def _save_or_conflict(table, doc, sid=None):
    if not _put_player(table, doc):
        return _err('Someone moved your creature first — refreshing.', 409)
    if sid is not None:
        _flush_autolist(table, sid, doc)
    return None
```

`sid` is passed at the save sites that follow a drop/loot/space resolution
(move, teleport-fold, combat resolution, trove, cache, and any other path that
can roll a drop). The board-reward path `_grant_to_player` uses its own
`_put_player` loop rather than `_save_or_conflict`, so it calls `_flush_autolist`
explicitly after a successful write.

### Never persist / never leak

- `_put_player` copies the doc (`dict(doc)`) before writing; add
  `doc.pop('_autoList', None)` to that copy so the transient key is never
  written to DynamoDB even on a save site that doesn't flush (worst case the
  queue is silently dropped rather than corrupting state — caught by tests).
- `_ok` builds `you` from `doc.items()` minus `pk`/`sk`; add `_autoList` to that
  exclusion. (`_public_player` uses an explicit allowlist, so it's already
  safe.)

### Client-facing summary contract

`_gear_award_summary` currently returns `ground: outcome == 'stash-full'`.
Replace with:

```python
return {'id': ..., 'name': ..., 'tier': ...,
        'listed': drop['outcome'] == 'listed',
        'listPrice': drop.get('listPrice')}
```

Consumable overflow: `_award_item` (and the other `_give_consumable` callers)
report text like `"Your bag was full — listed on the Market for N Spores."`
instead of `"Your bag was full — you salvage 5 Spores."`, and surface
`listed`/`listPrice` in the reward payload.

## Client design (Angular, `src/app/undercity/`)

- **Types** (`services/undercity-models.ts`): gear-drop / reward shapes gain
  `listed: boolean` and `listPrice: number` (replacing the `ground` boolean).
- **Combat rewards** (`tabs/interactive-battle.component.html:350`): the gear
  reward chip's `r.gearStashed ? 'to stash' : 'stash full → materials'` becomes
  `... : 'stash full → listed on Market (' + price + ')'`; the component field
  feeding it updates accordingly.
- **Board loot** (`tabs/board-tab.component.*`): the loot/gear-drop display
  string for the full-stash and full-bag cases changes to the "listed on Market"
  wording, showing the Spore price.
- No new market UI: auto-listings appear in the existing Player Market listings
  (own listings, cancellable) at the Plaza with no extra work.

## Config

No new tunables. Reuse `MARKET_PRICE_MIN_PCT` (0.5) as the floor and
`MARKET_MAX_LISTINGS` (5, bypassed for auto-listings). If a distinct auto-list
price is ever wanted, introduce `AUTO_LIST_PRICE_PCT` then; not now.

## Tests (`infrastructure/lambda/tests/`)

Extend the in-memory `FakeTable` suite (keep it green):

1. **Gear overflow lists:** fill the gear stash, force a gear drop → exactly one
   new `MARKET#` row for that seller at the floor price; `materials` unchanged;
   drop summary reports `listed: true` with `listPrice`.
2. **Consumable overflow lists:** fill the bag, force a consumable loot → one
   `MARKET#` row at floor price; no 5-Spore credit; reward text says "listed".
3. **Cap bypass:** with 5 active listings already, an overflow drop still creates
   a 6th listing.
4. **No leak / no persist:** after any overflow action, `_autoList` is absent
   from both the persisted doc and the `you` response payload.
5. **Round-trip:** a second player can `market-buy` an auto-listed item and
   receive it; the seller is credited the floor price.

## Files touched

- `infrastructure/lambda/undercity_db.py` — queue/flush, `_save_or_conflict`
  signature, `_put_player`/`_ok` stripping, `_roll_gear_drop`,
  `_give_consumable` + its callers, `_gear_award_summary`, `_grant_to_player`.
- `infrastructure/lambda/tests/test_undercity_market.py` (or a sibling) — new
  cases above.
- `src/app/undercity/services/undercity-models.ts` — type changes.
- `src/app/undercity/tabs/interactive-battle.component.html` (+ `.ts` field) —
  reward chip wording.
- `src/app/undercity/tabs/board-tab.component.*` — loot wording.

## Out of scope / deferred

- Scroll satchel overflow (still → Spores).
- Salvage Yard grind (unchanged).
- Any auto-pricing smarter than the flat floor.
