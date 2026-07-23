# Undercity — Sell Bag Items & Scrolls on the Market — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Let players list bag consumables and spell scrolls (in addition to gear) on the Plaza Player Market, and tag equipped rows in the Blacksmith.

**Architecture:** Generalize the existing three market functions in `undercity_db.py` with a `kind` discriminator (`gear` | `consumable` | `scroll`) driven by a small per-kind registry (inventory field, capacity, base-cost fn, name fn). Legacy listings (`gearId`, no `kind`) fall back to gear. The Angular Plaza tab enriches listings by kind and offers three "sell from" groups. All numbers reuse existing market band knobs.

**Tech Stack:** Python 3.11 Lambda (pytest, in-memory FakeTable), Angular 20 standalone component (SCSS), no frontend test runner (verify via `npm run build`).

**Design spec:** [specs/2026-07-23-undercity-market-sell-items-design.md](2026-07-23-undercity-market-sell-items-design.md)

---

## File Structure

- **Modify** `infrastructure/lambda/undercity_db.py` — add `_MARKET_KINDS` registry + helpers; generalize `_market_price_band`, `_market_list`, `_market_buy`, `_market_cancel`; update the `market` block in `handle_state`.
- **Modify** `infrastructure/lambda/tests/test_undercity_market.py` — add consumable/scroll/legacy/cap tests.
- **Modify** `src/app/undercity/data/items.ts` — add `INSCRIBE_COST` mirror, `MarketKind`, `marketItemCost`, `marketBand` (after the `*_MAP` consts).
- **Modify** `src/app/undercity/services/undercity-models.ts` — extend `MarketListing` with `kind?` + `itemId?` (keep `gearId?` legacy).
- **Modify** `src/app/undercity/tabs/plaza-tab.component.ts` — kind-aware `marketRows`, `canBuy`, `marketList`, plus `bagRows`/`scrollRows` and a `marketView` helper.
- **Modify** `src/app/undercity/tabs/plaza-tab.component.html` — render market rows by kind; three sell groups; Blacksmith equipped tag.

Server constants already re-exported via `data.*`: `GEAR_STASH_SIZE`(6), `BAG_SIZE`(3), `SCROLL_SATCHEL_CAP`(6), `MARKET_PRICE_MIN_PCT`(0.5), `MARKET_PRICE_MAX_PCT`(2.0), `MARKET_MAX_LISTINGS`(5), `INSCRIBE_COST`({1:10,2:20,3:30}), `GEAR`, `CONSUMABLES`, `SPELLS`.

---

## Task 1: Server — kind registry + generalized price band

**Files:**
- Modify: `infrastructure/lambda/undercity_db.py` (the `_market_price_band` at ~line 929)
- Test: `infrastructure/lambda/tests/test_undercity_market.py`

- [ ] **Step 1: Write the failing test**

Add to `test_undercity_market.py`:

```python
def test_market_price_band_by_kind():
    assert db._market_price_band('gear', 'bark_hide') == (22, 90)        # cost 45
    assert db._market_price_band('consumable', 'healing_moss') == (6, 24)  # cost 12
    assert db._market_price_band('scroll', 'spore_bolt') == (5, 20)        # INSCRIBE_COST[1]=10
```

- [ ] **Step 2: Run test to verify it fails**

Run: `cd infrastructure/lambda && python -m pytest tests/test_undercity_market.py::test_market_price_band_by_kind -q`
Expected: FAIL — `_market_price_band()` takes 1 arg / TypeError.

- [ ] **Step 3: Write minimal implementation**

Replace the existing `_market_price_band(gid)` (~lines 929-934) with the registry + kind-aware band + a legacy resolver:

```python
# Per-kind inventory routing for market listings. Each entry says which player-doc
# field holds that kind, its capacity, and how to derive a base cost / display name.
_MARKET_KINDS = {
    'gear': {
        'field': 'gearStash', 'cap': data.GEAR_STASH_SIZE,
        'cost': lambda i: data.GEAR[i]['cost'],
        'name': lambda i: data.GEAR[i]['name'],
    },
    'consumable': {
        'field': 'bag', 'cap': data.BAG_SIZE,
        'cost': lambda i: data.CONSUMABLES[i]['cost'],
        'name': lambda i: data.CONSUMABLES[i]['name'],
    },
    'scroll': {
        'field': 'scrolls', 'cap': data.SCROLL_SATCHEL_CAP,
        'cost': lambda i: data.INSCRIBE_COST[data.SPELLS[i]['tier']],
        'name': lambda i: data.SPELLS[i]['name'],
    },
}

# Player-doc field label for "your X is full" errors.
_MARKET_FULL_LABEL = {'gear': 'stash', 'consumable': 'bag', 'scroll': 'scroll satchel'}


def _market_kind(listing):
    """Resolve (kind, itemId) for a listing. Legacy rows carry only `gearId`/no
    `kind`, so default to gear."""
    kind = listing.get('kind', 'gear')
    item_id = listing.get('itemId') or listing.get('gearId')
    return kind, item_id


def _market_price_band(kind, item_id):
    """(min, max) Spore price allowed for an item, bounded around its base cost."""
    cost = _MARKET_KINDS[kind]['cost'](item_id)
    lo = max(1, int(cost * data.MARKET_PRICE_MIN_PCT))
    hi = max(lo, int(cost * data.MARKET_PRICE_MAX_PCT))
    return lo, hi
```

- [ ] **Step 4: Run test to verify it passes**

Run: `cd infrastructure/lambda && python -m pytest tests/test_undercity_market.py::test_market_price_band_by_kind -q`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add infrastructure/lambda/undercity_db.py infrastructure/lambda/tests/test_undercity_market.py
git commit -m "feat(undercity): market kind registry + kind-aware price band"
```

---

## Task 2: Server — generalize `_market_list` to accept `kind`

**Files:**
- Modify: `infrastructure/lambda/undercity_db.py` (`_market_list`, ~line 951)
- Test: `infrastructure/lambda/tests/test_undercity_market.py`

- [ ] **Step 1: Write the failing test**

```python
def test_market_list_consumable(table):
    sid, seller = _player_at(table, 'city_r0')
    seller['bag'] = ['healing_moss']                       # cost 12, band 6..24
    status, body = db._market_list(table, sid, seller, {'kind': 'consumable', 'index': 0, 'price': 12})
    assert status == 200
    assert seller['bag'] == []
    listing = db._get(table, db._season_pk(sid), f"MARKET#{body['listingId']}")
    assert listing['kind'] == 'consumable' and listing['itemId'] == 'healing_moss'


def test_market_list_scroll(table):
    sid, seller = _player_at(table, 'city_r0')
    seller['scrolls'] = ['spore_bolt']                     # INSCRIBE_COST[1]=10, band 5..20
    status, body = db._market_list(table, sid, seller, {'kind': 'scroll', 'index': 0, 'price': 15})
    assert status == 200
    assert seller['scrolls'] == []


def test_market_list_consumable_rejects_out_of_band(table):
    sid, seller = _player_at(table, 'city_r0')
    seller['bag'] = ['healing_moss']
    assert db._market_list(table, sid, seller, {'kind': 'consumable', 'index': 0, 'price': 1})[0] == 409
    assert db._market_list(table, sid, seller, {'kind': 'consumable', 'index': 0, 'price': 999})[0] == 409
    assert seller['bag'] == ['healing_moss']               # unchanged on reject


def test_market_list_rejects_unknown_kind(table):
    sid, seller = _player_at(table, 'city_r0')
    seller['gearStash'] = ['bark_hide']
    assert db._market_list(table, sid, seller, {'kind': 'grimoire', 'index': 0, 'price': 45})[0] == 400
```

Note: `_err` default status is 400 (see existing `_market_list` "Pick a stash piece" path). Confirm the unknown-kind branch returns a 400.

- [ ] **Step 2: Run to verify it fails**

Run: `cd infrastructure/lambda && python -m pytest tests/test_undercity_market.py -q -k "list_consumable or list_scroll or unknown_kind"`
Expected: FAIL — kind ignored / KeyError.

- [ ] **Step 3: Write minimal implementation**

Replace `_market_list` body (~lines 951-982) with:

```python
def _market_list(table, sid, doc, payload):
    """List an inventory item (gear / bag consumable / spell scroll) on the Player
    Market at a bounded Spore price."""
    kind = payload.get('kind', 'gear')
    spec = _MARKET_KINDS.get(kind)
    if not spec:
        return _err('You cannot sell that.')
    inv = doc.get(spec['field']) or []
    try:
        index = int(payload.get('index'))
        price = int(payload.get('price'))
    except (TypeError, ValueError):
        return _err('Pick an item and a price.')
    if index < 0 or index >= len(inv):
        return _err('That slot is empty.', 409)
    item_id = inv[index]
    lo, hi = _market_price_band(kind, item_id)
    if price < lo or price > hi:
        return _err(f'Price must be {lo}–{hi} Spores for that item.', 409)
    pk = _season_pk(sid)
    active = table.query(
        KeyConditionExpression='pk = :pk AND begins_with(sk, :sk)',
        ExpressionAttributeValues={':pk': pk, ':sk': 'MARKET#'})['Items']
    if sum(1 for m in active if m.get('sellerId') == doc['userId']) >= data.MARKET_MAX_LISTINGS:
        return _err(f'You already have {data.MARKET_MAX_LISTINGS} listings — cancel one first.', 409)
    listing_id = '%08x' % _rng.getrandbits(32)
    inv.pop(index)
    doc[spec['field']] = inv
    conflict = _save_or_conflict(table, doc)
    if conflict:
        return conflict
    table.put_item(Item={
        'pk': pk, 'sk': f'MARKET#{listing_id}', 'id': listing_id,
        'sellerId': doc['userId'], 'sellerName': doc.get('username', '?'),
        'kind': kind, 'itemId': item_id, 'price': price, 'createdAt': _now()})
    return _ok(doc, text=f"Listed {spec['name'](item_id)} for {price} Spores.",
               listingId=listing_id)
```

- [ ] **Step 4: Run to verify it passes (plus the existing gear list tests)**

Run: `cd infrastructure/lambda && python -m pytest tests/test_undercity_market.py -q`
Expected: new list tests PASS; `test_market_list_rejects_out_of_band_price` still PASS (gear default kind).

Note: `test_market_listing_appears_in_state` will still assert `l['gearId']` and now FAIL — it is fixed in Task 4. If running the whole file, expect that one red until Task 4.

- [ ] **Step 5: Commit**

```bash
git add infrastructure/lambda/undercity_db.py infrastructure/lambda/tests/test_undercity_market.py
git commit -m "feat(undercity): list bag consumables & scrolls on the market"
```

---

## Task 3: Server — generalize `_market_buy` + `_market_cancel`

**Files:**
- Modify: `infrastructure/lambda/undercity_db.py` (`_market_buy` ~985, `_market_cancel` ~1020)
- Test: `infrastructure/lambda/tests/test_undercity_market.py`

- [ ] **Step 1: Write the failing tests**

```python
def test_market_buy_consumable_to_bag(table):
    sid, seller, buyer = _two_players(table)
    seller['bag'] = ['healing_moss']
    _, body = db._market_list(table, sid, seller, {'kind': 'consumable', 'index': 0, 'price': 12})
    buyer['spores'] = 50
    buyer['bag'] = []
    status, _ = db._market_buy(table, sid, buyer, {'listingId': body['listingId']})
    assert status == 200
    assert buyer['bag'] == ['healing_moss'] and buyer['spores'] == 38
    assert db._get_player(table, sid, 'user-alex')['spores'] == 12


def test_market_buy_scroll_to_satchel(table):
    sid, seller, buyer = _two_players(table)
    seller['scrolls'] = ['spore_bolt']
    _, body = db._market_list(table, sid, seller, {'kind': 'scroll', 'index': 0, 'price': 15})
    buyer['spores'] = 50
    buyer['scrolls'] = []
    status, _ = db._market_buy(table, sid, buyer, {'listingId': body['listingId']})
    assert status == 200
    assert buyer['scrolls'] == ['spore_bolt']


def test_market_buy_rejects_full_bag(table):
    sid, seller, buyer = _two_players(table)
    seller['bag'] = ['healing_moss']
    _, body = db._market_list(table, sid, seller, {'kind': 'consumable', 'index': 0, 'price': 12})
    buyer['spores'] = 50
    buyer['bag'] = ['loaded_die', 'smoke_spore', 'snare']   # BAG_SIZE = 3, full
    status, _ = db._market_buy(table, sid, buyer, {'listingId': body['listingId']})
    assert status == 409


def test_market_cancel_returns_consumable(table):
    sid, seller = _player_at(table, 'city_r0')
    seller['bag'] = ['healing_moss']
    _, body = db._market_list(table, sid, seller, {'kind': 'consumable', 'index': 0, 'price': 12})
    seller = db._get_player(table, sid, 'user-alex')       # fresh optimistic-lock version
    status, _ = db._market_cancel(table, sid, seller, {'listingId': body['listingId']})
    assert status == 200
    assert seller['bag'] == ['healing_moss']


def test_market_buy_legacy_gear_row(table):
    """A pre-existing listing written before `kind` existed (gearId only) still buys."""
    sid, seller, buyer = _two_players(table)
    pk = db._season_pk(sid)
    table.put_item(Item={'pk': pk, 'sk': 'MARKET#legacy01', 'id': 'legacy01',
                         'sellerId': 'user-alex', 'sellerName': 'Alex',
                         'gearId': 'bark_hide', 'price': 45, 'createdAt': db._now()})
    buyer['spores'] = 100
    buyer['gearStash'] = []
    status, _ = db._market_buy(table, sid, buyer, {'listingId': 'legacy01'})
    assert status == 200
    assert buyer['gearStash'] == ['bark_hide']
```

- [ ] **Step 2: Run to verify they fail**

Run: `cd infrastructure/lambda && python -m pytest tests/test_undercity_market.py -q -k "buy_consumable or buy_scroll or full_bag or cancel_returns_consumable or legacy_gear"`
Expected: FAIL — buy/cancel still hard-code `gearId`/`gearStash`.

- [ ] **Step 3: Write minimal implementation**

Replace `_market_buy` body (~lines 985-1017):

```python
def _market_buy(table, sid, doc, payload):
    """Buy a listing: claim it (conditional delete so two buyers can't both take
    it), pay the seller, and receive the item into the matching inventory."""
    listing_id = payload.get('listingId')
    pk = _season_pk(sid)
    listing = _get(table, pk, f'MARKET#{listing_id}')
    if not listing:
        return _err('That listing is gone.', 409)
    if listing['sellerId'] == doc['userId']:
        return _err('That is your own listing — cancel it instead.', 409)
    kind, item_id = _market_kind(listing)
    spec = _MARKET_KINDS.get(kind)
    if not spec:
        return _err('That listing is gone.', 409)
    price = int(listing['price'])
    if doc.get('spores', 0) < price:
        return _err('Not enough Spores.', 409)
    if len(doc.get(spec['field']) or []) >= spec['cap']:
        return _err(f"Your {_MARKET_FULL_LABEL[kind]} is full — make room first.", 409)
    try:
        table.delete_item(Key={'pk': pk, 'sk': f'MARKET#{listing_id}'},
                          ConditionExpression='attribute_exists(sk)')
    except ClientError as e:
        if e.response['Error']['Code'] == 'ConditionalCheckFailedException':
            return _err('That listing just sold.', 409)
        raise
    doc['spores'] = doc.get('spores', 0) - price
    doc.setdefault(spec['field'], []).append(item_id)
    conflict = _save_or_conflict(table, doc)
    if conflict:
        return conflict
    _credit_market_seller(table, sid, listing['sellerId'], price, {
        'kind': 'market', 'at': _now(),
        'text': f"{doc.get('username', 'Someone')} bought your "
                f"{spec['name'](item_id)} for {price} Spores."})
    return _ok(doc, text=f"Bought {spec['name'](item_id)} for {price} Spores.")
```

Replace `_market_cancel` body (~lines 1020-1042):

```python
def _market_cancel(table, sid, doc, payload):
    """Reclaim your own listing back into the matching inventory."""
    listing_id = payload.get('listingId')
    pk = _season_pk(sid)
    listing = _get(table, pk, f'MARKET#{listing_id}')
    if not listing:
        return _err('That listing is gone.', 409)
    if listing['sellerId'] != doc['userId']:
        return _err('That is not your listing.', 409)
    kind, item_id = _market_kind(listing)
    spec = _MARKET_KINDS.get(kind)
    if not spec:
        return _err('That listing is gone.', 409)
    if len(doc.get(spec['field']) or []) >= spec['cap']:
        return _err(f"Your {_MARKET_FULL_LABEL[kind]} is full — make room first.", 409)
    try:
        table.delete_item(Key={'pk': pk, 'sk': f'MARKET#{listing_id}'},
                          ConditionExpression='attribute_exists(sk)')
    except ClientError as e:
        if e.response['Error']['Code'] == 'ConditionalCheckFailedException':
            return _err('That listing just sold.', 409)
        raise
    doc.setdefault(spec['field'], []).append(item_id)
    conflict = _save_or_conflict(table, doc)
    if conflict:
        return conflict
    return _ok(doc, text=f"Reclaimed {spec['name'](item_id)}.")
```

- [ ] **Step 4: Run to verify they pass**

Run: `cd infrastructure/lambda && python -m pytest tests/test_undercity_market.py -q -k "buy or cancel or legacy"`
Expected: new tests PASS; existing gear buy/cancel tests still PASS.

- [ ] **Step 5: Commit**

```bash
git add infrastructure/lambda/undercity_db.py infrastructure/lambda/tests/test_undercity_market.py
git commit -m "feat(undercity): buy/cancel market listings route by kind (+legacy fallback)"
```

---

## Task 4: Server — `handle_state` emits `kind` + `itemId`

**Files:**
- Modify: `infrastructure/lambda/undercity_db.py` (the `market = [...]` block, ~lines 1200-1203)
- Test: `infrastructure/lambda/tests/test_undercity_market.py`

- [ ] **Step 1: Update the existing state test + add a legacy one**

Change `test_market_listing_appears_in_state` to assert the new shape, and add a legacy-row test:

```python
def test_market_listing_appears_in_state(table):
    sid, seller = _player_at(table, 'city_r0')
    seller['bag'] = ['healing_moss']
    db._market_list(table, sid, seller, {'kind': 'consumable', 'index': 0, 'price': 12})
    status, state = db.handle_state(table, {'userId': 'user-alex'})
    assert status == 200
    assert any(l['kind'] == 'consumable' and l['itemId'] == 'healing_moss' and l['price'] == 12
               for l in state['market'])


def test_market_legacy_row_in_state_defaults_gear(table):
    sid, seller = _player_at(table, 'city_r0')
    pk = db._season_pk(sid)
    table.put_item(Item={'pk': pk, 'sk': 'MARKET#legacy01', 'id': 'legacy01',
                         'sellerId': 'user-alex', 'sellerName': 'Alex',
                         'gearId': 'bark_hide', 'price': 45, 'createdAt': db._now()})
    _, state = db.handle_state(table, {'userId': 'user-alex'})
    row = next(l for l in state['market'] if l['id'] == 'legacy01')
    assert row['kind'] == 'gear' and row['itemId'] == 'bark_hide'
```

- [ ] **Step 2: Run to verify they fail**

Run: `cd infrastructure/lambda && python -m pytest tests/test_undercity_market.py -q -k "appears_in_state or legacy_row_in_state"`
Expected: FAIL — state still emits `gearId`, no `kind`.

- [ ] **Step 3: Write minimal implementation**

Replace the `market = [...]` comprehension (~lines 1200-1203) with:

```python
    market = []
    for m in (_clean(i) for i in mk['Items']):
        kind, item_id = _market_kind(m)
        market.append({'id': m['id'], 'sellerId': m['sellerId'],
                       'sellerName': m.get('sellerName', ''),
                       'kind': kind, 'itemId': item_id, 'price': int(m['price'])})
```

- [ ] **Step 4: Run the full market suite**

Run: `cd infrastructure/lambda && python -m pytest tests/test_undercity_market.py -q`
Expected: ALL PASS.

- [ ] **Step 5: Run the whole lambda suite (nothing else depended on `gearId` in state)**

Run: `cd infrastructure/lambda && python -m pytest tests -q`
Expected: ALL PASS. If another test asserts `state['market'][*]['gearId']`, update it to `itemId`.

- [ ] **Step 6: Commit**

```bash
git add infrastructure/lambda/undercity_db.py infrastructure/lambda/tests/test_undercity_market.py
git commit -m "feat(undercity): market state emits kind + itemId (legacy gearId fallback)"
```

---

## Task 5: Client — price-band mirror in `items.ts`

**Files:**
- Modify: `src/app/undercity/data/items.ts`

- [ ] **Step 1: Add the imports and mirror helpers**

At the top of `items.ts`, add an import for the spell map (after the file's existing top comment; there are currently no imports):

```ts
import { SPELL_MAP } from './spells';
```

At the **end** of `items.ts` (after `GEAR_MAP` / `CONSUMABLE_MAP` are defined, ~line 231) add:

```ts
/** Scroll base cost by spell tier (mirrors INSCRIBE_COST in undercity_config.py). */
export const INSCRIBE_COST: Record<number, number> = { 1: 10, 2: 20, 3: 30 };

export type MarketKind = 'gear' | 'consumable' | 'scroll';

/** Base cost a market price band is derived from, per kind (mirrors _MARKET_KINDS). */
export function marketItemCost(kind: MarketKind, id: string): number {
  if (kind === 'consumable') return CONSUMABLE_MAP[id]?.cost ?? 0;
  if (kind === 'scroll') return INSCRIBE_COST[SPELL_MAP[id]?.tier ?? 1] ?? 0;
  return GEAR_MAP[id]?.cost ?? 0;
}

/** Allowed Spore price band for any listable item (mirrors _market_price_band). */
export function marketBand(kind: MarketKind, id: string): { lo: number; hi: number } {
  const cost = marketItemCost(kind, id);
  const lo = Math.max(1, Math.floor(cost * MARKET_PRICE_MIN_PCT));
  const hi = Math.max(lo, Math.floor(cost * MARKET_PRICE_MAX_PCT));
  return { lo, hi };
}
```

(Leave the existing gear-only `marketPriceBand` in place; it is superseded in the component in Task 7 but harmless.)

- [ ] **Step 2: Verify it compiles**

Run: `npm run build`
Expected: build succeeds (no TS errors). If `spells.ts` importing `items.ts` created a cycle, it did not previously — confirm the build stays green.

- [ ] **Step 3: Commit**

```bash
git add src/app/undercity/data/items.ts
git commit -m "feat(undercity): client market price-band mirror for all kinds"
```

---

## Task 6: Client — extend `MarketListing` model

**Files:**
- Modify: `src/app/undercity/services/undercity-models.ts` (~line 237)

- [ ] **Step 1: Edit the interface**

Replace the `MarketListing` interface (~lines 237-243) with:

```ts
export interface MarketListing {
  id: string;
  sellerId: string;
  sellerName: string;
  /** Absent on legacy rows written before kinds existed → treat as 'gear'. */
  kind?: 'gear' | 'consumable' | 'scroll';
  /** Absent on legacy rows → fall back to `gearId`. */
  itemId?: string;
  /** Legacy field, still emitted by old rows. */
  gearId?: string;
  price: number;
}
```

- [ ] **Step 2: Verify it compiles**

Run: `npm run build`
Expected: build succeeds.

- [ ] **Step 3: Commit**

```bash
git add src/app/undercity/services/undercity-models.ts
git commit -m "feat(undercity): MarketListing model gains kind + itemId"
```

---

## Task 7: Client — kind-aware component logic (`plaza-tab.component.ts`)

**Files:**
- Modify: `src/app/undercity/tabs/plaza-tab.component.ts`

- [ ] **Step 1: Update imports**

Change the `../data/items` import block (~lines 18-26) to add the new helpers and types, and add a spells import below it:

```ts
import {
  GEAR_MAP,
  CONSUMABLE_MAP,
  tierRarity,
  nextRung,
  UPGRADE_COST,
  SALVAGE_YIELD,
  marketBand,
  MarketKind,
  RarityInfo,
  GearInfo,
} from '../data/items';
import { SPELL_MAP } from '../data/spells';
```

- [ ] **Step 2: Add a `MarketView` interface**

After the `UpgradeRow` interface (~line 47) add:

```ts
/** Normalized display fields for a market listing, resolved from its kind. */
interface MarketView {
  name: string;
  desc: string;
  icon?: string; // material-icon ligature (consumable / scroll)
  svgIcon?: string; // gear slot svg id, e.g. 'uc-fang'
  rarity?: RarityInfo; // gear / scroll tier rarity; undefined for consumables
}
```

- [ ] **Step 3: Add the `marketView` resolver + kind-aware rows**

Replace the existing `marketRows` computed (~lines 192-197) and `canBuy` (~lines 199-204) with:

```ts
  private marketView(kind: MarketKind, id: string): MarketView | null {
    if (kind === 'gear') {
      const g = GEAR_MAP[id];
      if (!g) return null;
      return { name: g.name, desc: g.desc, svgIcon: 'uc-' + g.slot, rarity: tierRarity(g.tier) };
    }
    if (kind === 'consumable') {
      const c = CONSUMABLE_MAP[id];
      if (!c) return null;
      return { name: c.name, desc: c.desc, icon: c.icon };
    }
    const s = SPELL_MAP[id];
    if (!s) return null;
    return { name: s.name, desc: s.desc, icon: s.icon, rarity: tierRarity(s.tier) };
  }

  // Player Market listings, normalized by kind + own-listing flag.
  protected readonly marketRows = computed(() =>
    this.store
      .market()
      .map((l) => {
        const kind = (l.kind ?? 'gear') as MarketKind;
        const itemId = l.itemId ?? l.gearId ?? '';
        return {
          id: l.id,
          price: l.price,
          sellerName: l.sellerName,
          kind,
          view: this.marketView(kind, itemId),
          own: l.sellerId === this.store.ownUserId,
        };
      })
      .filter((r) => !!r.view),
  );

  protected canBuy(l: { price: number; own: boolean; kind: MarketKind }): boolean {
    const you = this.store.you();
    if (!you || l.own) return false;
    const held =
      l.kind === 'consumable' ? you.bag : l.kind === 'scroll' ? you.scrolls : you.gearStash;
    const cap = l.kind === 'consumable' ? 3 : 6; // BAG_SIZE=3; gearStash/scrolls=6
    const full = (held?.length ?? 0) >= cap;
    return you.spores >= l.price && !full;
  }

  protected readonly marketBand = marketBand;
```

(Remove the old `protected readonly priceBand = marketPriceBand;` line ~143 and the `marketPriceBand` import — `marketBand` replaces it.)

- [ ] **Step 4: Add `bagRows` / `scrollRows` and update `marketList`**

After `stashRows` (~line 153) add:

```ts
  protected readonly bagRows = computed(() =>
    (this.store.you()?.bag ?? [])
      .map((id, index) => ({ index, info: CONSUMABLE_MAP[id] }))
      .filter((r) => !!r.info),
  );

  protected readonly scrollRows = computed(() =>
    (this.store.you()?.scrolls ?? [])
      .map((id, index) => ({ index, info: SPELL_MAP[id] }))
      .filter((r) => !!r.info),
  );
```

Replace `marketList` (~lines 226-237) to pass the kind:

```ts
  async marketList(kind: MarketKind, index: number, price: number): Promise<void> {
    if (this.busy() || !Number.isFinite(price)) return;
    this.busy.set(true);
    try {
      const resp = await this.store.action('market-list', {
        kind,
        index,
        price: Math.round(price),
      });
      this.showToast(resp.text ?? 'Listed.');
    } catch (e) {
      this.showToast(e instanceof Error ? e.message : 'Listing failed');
    } finally {
      this.busy.set(false);
    }
  }
```

- [ ] **Step 5: Verify it compiles**

Run: `npm run build`
Expected: build FAILS in `plaza-tab.component.html` (template still uses `l.info`, old `priceBand`, `marketList(row.index, ...)`). That is fixed in Task 8 — if building TS-only is not possible, proceed to Task 8 then build once.

- [ ] **Step 6: Commit**

```bash
git add src/app/undercity/tabs/plaza-tab.component.ts
git commit -m "feat(undercity): plaza market component logic is kind-aware"
```

---

## Task 8: Client — market + sell UI (`plaza-tab.component.html`)

**Files:**
- Modify: `src/app/undercity/tabs/plaza-tab.component.html` (the `b === 'market'` block, ~lines 120-158)

- [ ] **Step 1: Replace the market building block**

Replace the whole `@else { ... }` market block (~lines 120-158) with:

```html
        } @else {
          <p class="forge-hint">Buy what other players listed, or list your own gear, bag items, or scrolls for Spores.</p>
          <h4 class="forge-subhead">On the market</h4>
          @for (l of marketRows(); track l.id) {
            <div class="forge-row" [attr.data-rarity]="l.view!.rarity?.key ?? 'common'">
              @if (l.view!.svgIcon) {
                <mat-icon class="mi slot-mi" [svgIcon]="l.view!.svgIcon"></mat-icon>
              } @else {
                <mat-icon class="mi slot-mi">{{ l.view!.icon }}</mat-icon>
              }
              <span class="forge-name">{{ l.view!.name }}
                @if (l.view!.rarity) {
                  <span class="rarity-badge {{ l.view!.rarity!.key }}">{{ l.view!.rarity!.label }}</span>
                }
                <em>by {{ l.sellerName }} · {{ l.view!.desc }}</em>
              </span>
              @if (l.own) {
                <button class="uc-btn" [disabled]="busy()" (click)="marketCancel(l.id)">Cancel</button>
              } @else {
                <button class="uc-btn forge-upgrade" [disabled]="busy() || !canBuy(l)" (click)="marketBuy(l.id)">
                  {{ l.price }}<img class="rot-coin" src="undercity/icons/rot.png" alt="Spores" />
                </button>
              }
            </div>
          } @empty {
            <div class="forge-empty">No listings yet. Be the first to sell something.</div>
          }

          <h4 class="forge-subhead">Sell gear</h4>
          @for (row of stashRows(); track row.index) {
            <div class="forge-row" [attr.data-rarity]="tierRarity(row.info.tier).key">
              <mat-icon class="mi slot-mi" [svgIcon]="'uc-' + row.info.slot"></mat-icon>
              <span class="forge-name">{{ row.info.name }}
                <span class="rarity-badge {{ tierRarity(row.info.tier).key }}">{{ tierRarity(row.info.tier).label }}</span>
                <em>{{ marketBand('gear', row.info.id).lo }}–{{ marketBand('gear', row.info.id).hi }} Spores</em>
              </span>
              <span class="forge-actions">
                <input #gp type="number" class="price-input" [value]="row.info.cost"
                       [min]="marketBand('gear', row.info.id).lo" [max]="marketBand('gear', row.info.id).hi" />
                <button class="uc-btn" [disabled]="busy()" (click)="marketList('gear', row.index, gp.valueAsNumber)">List</button>
              </span>
            </div>
          } @empty {
            <div class="forge-empty">No gear in your stash to sell.</div>
          }

          <h4 class="forge-subhead">Sell bag items</h4>
          @for (row of bagRows(); track row.index) {
            <div class="forge-row">
              <mat-icon class="mi slot-mi">{{ row.info.icon }}</mat-icon>
              <span class="forge-name">{{ row.info.name }}
                <em>{{ marketBand('consumable', row.info.id).lo }}–{{ marketBand('consumable', row.info.id).hi }} Spores</em>
              </span>
              <span class="forge-actions">
                <input #cp type="number" class="price-input" [value]="row.info.cost"
                       [min]="marketBand('consumable', row.info.id).lo" [max]="marketBand('consumable', row.info.id).hi" />
                <button class="uc-btn" [disabled]="busy()" (click)="marketList('consumable', row.index, cp.valueAsNumber)">List</button>
              </span>
            </div>
          } @empty {
            <div class="forge-empty">Your bag is empty.</div>
          }

          <h4 class="forge-subhead">Sell scrolls</h4>
          @for (row of scrollRows(); track row.index) {
            <div class="forge-row" [attr.data-rarity]="tierRarity(row.info.tier).key">
              <mat-icon class="mi slot-mi">{{ row.info.icon }}</mat-icon>
              <span class="forge-name">{{ row.info.name }}
                <span class="rarity-badge {{ tierRarity(row.info.tier).key }}">{{ tierRarity(row.info.tier).label }}</span>
                <em>{{ marketBand('scroll', row.info.id).lo }}–{{ marketBand('scroll', row.info.id).hi }} Spores</em>
              </span>
              <span class="forge-actions">
                <input #sp type="number" class="price-input" [value]="marketBand('scroll', row.info.id).lo"
                       [min]="marketBand('scroll', row.info.id).lo" [max]="marketBand('scroll', row.info.id).hi" />
                <button class="uc-btn" [disabled]="busy()" (click)="marketList('scroll', row.index, sp.valueAsNumber)">List</button>
              </span>
            </div>
          } @empty {
            <div class="forge-empty">No scrolls in your satchel.</div>
          }
        }
```

Note: scroll default price uses the band low (spells have no `cost` field); gear/consumable default to the item's shop `cost`.

- [ ] **Step 2: Verify it compiles and renders**

Run: `npm run build`
Expected: build succeeds.

- [ ] **Step 3: Commit**

```bash
git add src/app/undercity/tabs/plaza-tab.component.html
git commit -m "feat(undercity): market UI lists gear, bag items & scrolls"
```

---

## Task 9: Client — Blacksmith equipped-row tag

**Files:**
- Modify: `src/app/undercity/tabs/plaza-tab.component.html` (Blacksmith block, ~line 109)

- [ ] **Step 1: Add the equipped tag next to the stash tag**

Find (in the `b === 'blacksmith'` block, ~line 109):

```html
                @if (row.where === 'stash') { <span class="forge-tag">stash</span> }
```

Add immediately after it:

```html
                @if (row.where === 'equipped') { <span class="forge-tag">equipped</span> }
```

- [ ] **Step 2: Verify it compiles**

Run: `npm run build`
Expected: build succeeds; opening the Blacksmith shows an "equipped" tag on equipped upgrade rows.

- [ ] **Step 3: Commit**

```bash
git add src/app/undercity/tabs/plaza-tab.component.html
git commit -m "feat(undercity): tag equipped rows in the Blacksmith"
```

---

## Final verification

- [ ] Backend: `cd infrastructure/lambda && python -m pytest tests -q` — all green.
- [ ] Frontend: `npm run build` — succeeds.
- [ ] Manual (optional, uses the run-undercity skill / live AWS backend): open Plaza → Market, confirm three sell groups (gear / bag / scrolls) list and buy back; open Blacksmith, confirm "equipped" tag. Deploy is the user's responsibility.

## Spec coverage check

- Sell bag consumables — Tasks 2,3,7,8 ✅
- Sell spell scrolls — Tasks 2,3,7,8 ✅
- Gear unchanged (default kind) — Tasks 1-4 preserve gear path ✅
- 0.5x–2x band per kind — Tasks 1,5 ✅
- Legacy `gearId` rows keep working — Tasks 3,4 (`_market_kind` fallback) ✅
- Shared `MARKET_MAX_LISTINGS` — unchanged in Task 2 ✅
- Destination-cap checks (bag=3) — Task 3 ✅
- State emits kind+itemId — Task 4 ✅
- Client mirrors (INSCRIBE_COST + band) — Task 5 ✅
- Blacksmith equipped tag — Task 9 ✅
