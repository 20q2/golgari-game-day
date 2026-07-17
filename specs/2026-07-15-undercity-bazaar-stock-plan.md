# Rot-Farm Bazaar: tabs + rotating limited stock — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Give the Undercity bazaar three tabs (Gear / Consumables / Grimoires) that each offer only a few items, drawn from a shared per-node stock that re-rolls and restocks every 30 minutes and depletes as players buy.

**Architecture:** The server owns everything — a per-node `SHOP#<node>` DynamoDB record holds the current window's stock; a deterministic `(node, window)`-seeded generator means every player computes the identical selection with no write on read (mirroring how trading posts / veins / vaults are display-seeded). Buying gear/consumables decrements a quantity and persists the record; grimoires never deplete. The client renders whatever `handle_state` ships in a new `bazaars` block. Plus: 4 new tier-1 grimoires (built from existing spells → no engine code) to make the Grimoires tab a real rotation.

**Tech Stack:** Python 3.11 Lambda (pytest FakeTable suite), Angular 20 standalone components (verified via `npm run build` — there is no client test runner and lint is known-broken in this repo).

**Design spec:** [specs/2026-07-15-undercity-bazaar-stock-design.md](2026-07-15-undercity-bazaar-stock-design.md)

**Pre-existing failure this plan fixes:** `test_buy_gear_and_consumables` is currently RED — the uncommitted `map.json` moved shops off `bog_r3` (real shop nodes are `cavern_r1, bog_r6, garden_r3, city_r3, bone_r2`). Task 6 rewrites that test to look up a shop node dynamically, which both fixes the staleness and adapts it to limited stock.

---

## File Structure

**Backend (`infrastructure/lambda/`):**
- `undercity_data.py` — add 4 tier-1 `GRIMOIRES` rows + `SHOP_*` balance constants.
- `undercity_db.py` — add `import zlib`; add `_shop_window`, `_shop_window_end`, `_gen_shop_stock`, `_shop_stock`; rewrite `_buy`; add a `bazaars` block to `handle_state`.
- `tests/test_undercity_db.py` — rewrite `test_buy_gear_and_consumables`; add shop-stock tests.
- `tests/test_undercity_spells.py` — add a tier-1-pool count assertion.

**Frontend (`src/app/undercity/`):**
- `data/spells.ts` — mirror the 4 new grimoires.
- `services/undercity-models.ts` — `ShopStockItem`, `BazaarView`, `bazaars?` on `GameState`.
- `services/undercity-state.service.ts` — `bazaars` computed.
- `tabs/board-tab.component.ts` — `shopTab` signal, `currentBazaar`, stocked-row getters, restock label.
- `tabs/board-tab.component.html` — tabbed shop modal.
- `tabs/board-tab.component.scss` — tab + qty + empty-state styles.

Backend tasks (1–6) land first and keep the pytest suite green; frontend tasks (7–10) build on the shipped state shape and are verified with `npm run build`.

---

## Task 1: Four new tier-1 grimoires (data)

**Files:**
- Modify: `infrastructure/lambda/undercity_data.py` (the tier-1 block of `GRIMOIRES`, ~line 328)
- Test: `infrastructure/lambda/tests/test_undercity_spells.py`

- [ ] **Step 1: Write the failing test**

Add to `tests/test_undercity_spells.py` (after `test_every_grimoire_spell_exists`):

```python
def test_tier1_grimoire_pool_enriched():
    tier1 = [gid for gid, g in data.GRIMOIRES.items() if g['tier'] == 1]
    assert len(tier1) == 7, tier1
    for gid in ('warcasters_screed', 'hexweavers_codex',
                'nightrunners_ledger', 'tinkers_manual'):
        g = data.GRIMOIRES[gid]
        assert g['tier'] == 1 and 1 <= len(g['spells']) <= 3
        for sp in g['spells']:
            assert sp in data.SPELLS
```

- [ ] **Step 2: Run test to verify it fails**

Run: `cd infrastructure/lambda && python -m pytest tests/test_undercity_spells.py::test_tier1_grimoire_pool_enriched -q`
Expected: FAIL with `KeyError: 'warcasters_screed'`.

- [ ] **Step 3: Add the four grimoires**

In `undercity_data.py`, inside `GRIMOIRES`, immediately after the `vagrants_chapbook` entry and before the `# Tier II` comment, insert:

```python
    'warcasters_screed': {'name': "Warcaster's Screed", 'tier': 1, 'cost': 35,
                          'spells': ['rot_surge', 'spore_bolt'],
                          'blurb': 'Aggressor liturgy: swell with rot, then loose it.'},
    'hexweavers_codex':  {'name': "Hexweaver's Codex", 'tier': 1, 'cost': 35,
                          'spells': ['bone_chill', 'bog_snare'],
                          'blurb': 'Two curses for the price of one grudge.'},
    'nightrunners_ledger': {'name': "Nightrunner's Ledger", 'tier': 1, 'cost': 32,
                            'spells': ['glowveil', 'skitter_step'],
                            'blurb': 'Slip the light, then slip the room.'},
    'tinkers_manual':    {'name': "Tinker's Manual", 'tier': 1, 'cost': 30,
                          'spells': ['harden_shell', 'scrap_toss'],
                          'blurb': 'Brace the shell, then throw the scrap heap.'},
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `cd infrastructure/lambda && python -m pytest tests/test_undercity_spells.py -q`
Expected: PASS (including the existing `test_every_grimoire_spell_exists`).

- [ ] **Step 5: Commit**

```bash
git add infrastructure/lambda/undercity_data.py infrastructure/lambda/tests/test_undercity_spells.py
git commit -m "feat(undercity): four new tier-1 grimoires (built from existing spells)"
```

---

## Task 2: Shop balance constants + window helpers

**Files:**
- Modify: `infrastructure/lambda/undercity_data.py` (after `TRADING_POST_SEED`, ~line 345)
- Modify: `infrastructure/lambda/undercity_db.py` (imports line 19-22; new helpers near `_now`, ~line 44)
- Test: `infrastructure/lambda/tests/test_undercity_db.py`

- [ ] **Step 1: Write the failing test**

Add to `tests/test_undercity_db.py` (near the other unit-ish tests):

```python
from datetime import datetime, timedelta  # add to the imports at the top if absent


def test_shop_window_math():
    base = datetime(2026, 7, 15, 12, 0, 0)
    w = db._shop_window(base)
    # Same 30-min window a few minutes later; next window after the boundary.
    assert db._shop_window(base + timedelta(minutes=5)) == w
    assert db._shop_window(base + timedelta(minutes=31)) == w + 1
    # The window-end ISO is strictly after the window's own start instant.
    assert db._shop_window_end(w) > base.isoformat(timespec='seconds')
```

- [ ] **Step 2: Run test to verify it fails**

Run: `cd infrastructure/lambda && python -m pytest tests/test_undercity_db.py::test_shop_window_math -q`
Expected: FAIL with `AttributeError: module 'undercity_db' has no attribute '_shop_window'`.

- [ ] **Step 3a: Add balance constants**

In `undercity_data.py`, after the `TRADING_POST_SEED = [...]` line, add:

```python
# ── Rot-Farm Bazaar limited stock ────────────────────────────────────────────
SHOP_REFRESH_MIN = 30       # wall-clock window length (minutes)
SHOP_GEAR_SLOTS = 3         # gear lines offered per refresh (distinct slots)
SHOP_CONSUMABLE_SLOTS = 3   # consumable lines per refresh (>=1 in-battle)
SHOP_GRIMOIRE_SLOTS = 2     # tier-1 grimoires per refresh (never deplete)
SHOP_GEAR_QTY = 2           # units per stocked gear line
SHOP_CONSUMABLE_QTY = 2     # units per stocked consumable line
```

- [ ] **Step 3b: Add the `zlib` import and window helpers**

In `undercity_db.py`, add `import zlib` to the import block (after `import uuid`, line 21).

Then, just after `_now_ms()` (~line 44), add:

```python
_EPOCH = datetime(1970, 1, 1)


def _shop_window(now=None):
    """Which fixed wall-clock window the bazaar stock belongs to (shared by all
    players). Advancing a window rerolls the selection and resets quantities."""
    now = now or datetime.utcnow()
    secs = int((now - _EPOCH).total_seconds())
    return secs // (data.SHOP_REFRESH_MIN * 60)


def _shop_window_end(window):
    """ISO timestamp of the next window boundary — the client's restock clock."""
    end = _EPOCH + timedelta(seconds=(window + 1) * data.SHOP_REFRESH_MIN * 60)
    return end.isoformat(timespec='seconds')
```

- [ ] **Step 4: Run test to verify it passes**

Run: `cd infrastructure/lambda && python -m pytest tests/test_undercity_db.py::test_shop_window_math -q`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add infrastructure/lambda/undercity_data.py infrastructure/lambda/undercity_db.py infrastructure/lambda/tests/test_undercity_db.py
git commit -m "feat(undercity): bazaar stock constants + wall-clock window helpers"
```

---

## Task 3: Deterministic stock generation `_gen_shop_stock`

**Files:**
- Modify: `infrastructure/lambda/undercity_db.py` (new helper after `_shop_window_end`)
- Test: `infrastructure/lambda/tests/test_undercity_db.py`

- [ ] **Step 1: Write the failing test**

Add to `tests/test_undercity_db.py`:

```python
def test_gen_shop_stock_shape_and_determinism():
    node = next(n for n, v in data.MAP_NODES.items() if v['type'] == 'shop')
    stock = db._gen_shop_stock(node, 100)

    # Gear: SHOP_GEAR_SLOTS lines, all valid, spread across distinct slots.
    assert len(stock['gear']) == data.SHOP_GEAR_SLOTS
    slots = [data.GEAR[e['item']]['slot'] for e in stock['gear']]
    assert len(set(slots)) == len(slots)
    assert all(e['qty'] == data.SHOP_GEAR_QTY for e in stock['gear'])

    # Consumables: SHOP_CONSUMABLE_SLOTS distinct lines, >=1 in-battle ('combat').
    assert len(stock['consumables']) == data.SHOP_CONSUMABLE_SLOTS
    cids = [e['item'] for e in stock['consumables']]
    assert len(set(cids)) == len(cids)
    assert any(data.CONSUMABLES[cid].get('combat') for cid in cids)
    assert all(e['qty'] == data.SHOP_CONSUMABLE_QTY for e in stock['consumables'])

    # Grimoires: SHOP_GRIMOIRE_SLOTS distinct tier-1 ids, no qty.
    assert len(stock['grimoires']) == data.SHOP_GRIMOIRE_SLOTS
    assert len(set(stock['grimoires'])) == len(stock['grimoires'])
    assert all(data.GRIMOIRES[g]['tier'] == 1 for g in stock['grimoires'])

    # Deterministic per (node, window); different window differs.
    assert db._gen_shop_stock(node, 100) == stock
    assert db._gen_shop_stock(node, 101) != stock
    assert stock['window'] == 100
```

- [ ] **Step 2: Run test to verify it fails**

Run: `cd infrastructure/lambda && python -m pytest tests/test_undercity_db.py::test_gen_shop_stock_shape_and_determinism -q`
Expected: FAIL with `AttributeError: ... '_gen_shop_stock'`.

- [ ] **Step 3: Implement the generator**

In `undercity_db.py`, after `_shop_window_end`, add:

```python
def _gen_shop_stock(node, window):
    """Deterministic per (node, window) so every player computes the identical
    stock with no coordinated write. MUST use a stable hash — Python's builtin
    hash() is per-process salted (PYTHONHASHSEED) and would desync players."""
    rng = random.Random(zlib.crc32(f'{node}:{window}'.encode()))

    # Gear: one piece per distinct slot (fang/carapace/charm), random tier within.
    by_slot = {}
    for gid, g in data.GEAR.items():
        by_slot.setdefault(g['slot'], []).append(gid)
    slots = list(by_slot)
    rng.shuffle(slots)
    gear = [{'item': rng.choice(by_slot[s]), 'qty': data.SHOP_GEAR_QTY}
            for s in slots[:data.SHOP_GEAR_SLOTS]]

    # Consumables: guarantee >=1 in-battle ('combat') item, no duplicates.
    combat = [cid for cid, c in data.CONSUMABLES.items() if c.get('combat')]
    first = rng.choice(combat)
    pool = [cid for cid in data.CONSUMABLES if cid != first]
    rng.shuffle(pool)
    picks = [first] + pool[:data.SHOP_CONSUMABLE_SLOTS - 1]
    consumables = [{'item': cid, 'qty': data.SHOP_CONSUMABLE_QTY} for cid in picks]

    # Grimoires: distinct tier-1 tomes, no qty (never deplete).
    tier1 = [gid for gid, g in data.GRIMOIRES.items() if g['tier'] == 1]
    rng.shuffle(tier1)
    grimoires = tier1[:data.SHOP_GRIMOIRE_SLOTS]

    return {'window': window, 'gear': gear,
            'consumables': consumables, 'grimoires': grimoires}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `cd infrastructure/lambda && python -m pytest tests/test_undercity_db.py::test_gen_shop_stock_shape_and_determinism -q`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add infrastructure/lambda/undercity_db.py infrastructure/lambda/tests/test_undercity_db.py
git commit -m "feat(undercity): deterministic spread-guaranteed bazaar stock generator"
```

---

## Task 4: Lazy current-window read `_shop_stock`

**Files:**
- Modify: `infrastructure/lambda/undercity_db.py` (new helper after `_gen_shop_stock`)
- Test: `infrastructure/lambda/tests/test_undercity_db.py`

- [ ] **Step 1: Write the failing test**

Add to `tests/test_undercity_db.py`:

```python
def test_shop_stock_reads_current_regenerates_stale(table):
    sid = _sid(table)
    node = next(n for n, v in data.MAP_NODES.items() if v['type'] == 'shop')
    window = db._shop_window()

    # No record yet -> fresh full-quantity stock for the current window.
    fresh = db._shop_stock(table, sid, node)
    assert fresh['window'] == window
    assert fresh['gear'][0]['qty'] == data.SHOP_GEAR_QTY

    # A persisted record for the CURRENT window is returned verbatim (depleted).
    depleted = db._gen_shop_stock(node, window)
    depleted['gear'][0]['qty'] = 0
    table.put_item(Item={'pk': db._season_pk(sid), 'sk': f'SHOP#{node}', **depleted})
    got = db._shop_stock(table, sid, node)
    assert got['gear'][0]['qty'] == 0

    # A persisted record from a STALE window is ignored -> regenerated full.
    stale = db._gen_shop_stock(node, window - 5)
    stale['gear'][0]['qty'] = 0
    table.put_item(Item={'pk': db._season_pk(sid), 'sk': f'SHOP#{node}', **stale})
    got = db._shop_stock(table, sid, node)
    assert got['window'] == window
    assert got['gear'][0]['qty'] == data.SHOP_GEAR_QTY
```

- [ ] **Step 2: Run test to verify it fails**

Run: `cd infrastructure/lambda && python -m pytest tests/test_undercity_db.py::test_shop_stock_reads_current_regenerates_stale -q`
Expected: FAIL with `AttributeError: ... '_shop_stock'`.

- [ ] **Step 3: Implement the reader**

In `undercity_db.py`, after `_gen_shop_stock`, add:

```python
def _shop_stock(table, sid, node):
    """Current-window stock for a bazaar node: the persisted record if it exists
    AND belongs to the current window (possibly depleted), else a freshly
    generated full-quantity stock — NO write on read. A stale-window record is
    ignored, which is how the 30-minute reset happens."""
    window = _shop_window()
    rec = _get(table, _season_pk(sid), f'SHOP#{node}')
    if rec and rec.get('window') == window:
        return rec
    return _gen_shop_stock(node, window)
```

- [ ] **Step 4: Run test to verify it passes**

Run: `cd infrastructure/lambda && python -m pytest tests/test_undercity_db.py::test_shop_stock_reads_current_regenerates_stale -q`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add infrastructure/lambda/undercity_db.py infrastructure/lambda/tests/test_undercity_db.py
git commit -m "feat(undercity): lazy current-window bazaar stock read"
```

---

## Task 5: `_buy` — depletion, sold-out, grimoire membership

**Files:**
- Modify: `infrastructure/lambda/undercity_db.py` (`_buy`, ~line 2015)
- Test: `infrastructure/lambda/tests/test_undercity_db.py`

- [ ] **Step 1: Write the failing tests**

Add to `tests/test_undercity_db.py`. These place the player at a shop and seed a **known** `SHOP#` record so specific items are in stock:

```python
def _seed_shop(table, sid, node, gear=None, consumables=None, grimoires=None):
    """Write a deterministic bazaar stock for the current window."""
    rec = {
        'window': db._shop_window(),
        'gear': gear if gear is not None else [{'item': 'rusted_fang', 'qty': 2}],
        'consumables': (consumables if consumables is not None
                        else [{'item': 'healing_moss', 'qty': 2}]),
        'grimoires': grimoires if grimoires is not None else ['moldering_folio'],
    }
    table.put_item(Item={'pk': db._season_pk(sid), 'sk': f'SHOP#{node}', **rec})
    return node


def _at_shop(table, spores=200):
    act(table, 'join', starter='pest')
    sid = _sid(table)
    node = next(n for n, v in data.MAP_NODES.items() if v['type'] == 'shop')
    doc = db._get_player(table, sid, 'user-alex')
    doc['position'] = node
    doc['spores'] = spores
    db._put_player(table, doc)
    return sid, node


def test_buy_depletes_stock_then_sold_out(table):
    sid, node = _at_shop(table)
    _seed_shop(table, sid, node, consumables=[{'item': 'healing_moss', 'qty': 2}])
    # Two units in stock -> two buys succeed, third is sold out.
    for _ in range(2):
        status, resp = act(table, 'buy', itemId='healing_moss')
        assert status == 200
    status, resp = act(table, 'buy', itemId='healing_moss')
    assert status == 409 and 'Sold out' in resp['error']


def test_buy_rejects_unstocked_item(table):
    sid, node = _at_shop(table)
    _seed_shop(table, sid, node, gear=[{'item': 'rusted_fang', 'qty': 2}])
    status, resp = act(table, 'buy', itemId='wurm_tooth')  # not in the seeded stock
    assert status == 409 and "stocking" in resp['error']


def test_buy_grimoire_requires_stock_but_never_depletes(table):
    sid, node = _at_shop(table)
    _seed_shop(table, sid, node, grimoires=['moldering_folio'])
    # Not stocked -> refused.
    status, resp = act(table, 'buy', itemId='gardeners_primer')
    assert status == 409
    # Stocked -> alex buys; the stock is NOT decremented (no qty on grimoires).
    status, resp = act(table, 'buy', itemId='moldering_folio')
    assert status == 200 and 'moldering_folio' in resp['you']['grimoires']
    rec = db._get(table, db._season_pk(sid), f'SHOP#{node}')
    assert rec['grimoires'] == ['moldering_folio']
    # A second player can still buy the same tome this window (no depletion).
    act(table, 'join', user='user-bea', name='Bea', starter='grub')
    bea = db._get_player(table, sid, 'user-bea')
    bea['position'] = node
    bea['spores'] = 200
    db._put_player(table, bea)
    status, resp = act(table, 'buy', user='user-bea', name='Bea', itemId='moldering_folio')
    assert status == 200 and 'moldering_folio' in resp['you']['grimoires']


def test_buy_gear_and_consumables(table):   # REWRITE of the stale existing test
    sid, node = _at_shop(table)
    _seed_shop(table, sid, node,
               gear=[{'item': 'rusted_fang', 'qty': 2}, {'item': 'wurm_tooth', 'qty': 2}],
               consumables=[{'item': 'healing_moss', 'qty': 2}])
    status, resp = act(table, 'buy', itemId='rusted_fang')
    assert status == 200 and resp['you']['gear']['fang'] == 'rusted_fang'
    assert resp['you']['spores'] == 180
    status, resp = act(table, 'buy', itemId='wurm_tooth')  # trade-in refunds 10
    assert resp['you']['spores'] == 180 - 80 + 10
    assert resp['you']['gear']['fang'] == 'wurm_tooth'
    status, resp = act(table, 'buy', itemId='healing_moss')
    assert status == 200 and 'healing_moss' in resp['you']['bag']
```

Delete the **old** `test_buy_gear_and_consumables` body (the one positioned at `bog_r3`) — it is replaced above. (`_err` returns `{'error': msg}`, so `resp['error']` is the message — confirmed at `undercity_db.py:58`.)

- [ ] **Step 2: Run tests to verify they fail**

Run: `cd infrastructure/lambda && python -m pytest tests/test_undercity_db.py -k buy -q`
Expected: FAIL — the new sold-out / not-stocked messages don't exist yet; `_buy` still ignores stock.

- [ ] **Step 3: Rewrite `_buy`**

Replace the entire body of `_buy` (`undercity_db.py` ~line 2015) with:

```python
def _buy(table, sid, doc, payload):
    node = doc.get('position')
    if data.MAP_NODES.get(node, {}).get('type') != 'shop':
        return _err('You are not at a shop.', 409)
    item_id = payload.get('itemId')
    stock = _shop_stock(table, sid, node)
    deplete = None  # the stock line to decrement on a successful gear/consumable buy

    if item_id in data.GEAR:
        line = next((e for e in stock['gear'] if e['item'] == item_id), None)
        if not line:
            return _err("The bazaar isn't stocking that right now.", 409)
        if line['qty'] <= 0:
            return _err('Sold out — check back after the restock.', 409)
        g = data.GEAR[item_id]
        cost = g['cost']
        old_id = (doc.get('gear') or {}).get(g['slot'])
        refund = int(data.GEAR[old_id]['cost'] * data.GEAR_SELL_BACK) if old_id else 0
        if doc.get('spores', 0) + refund < cost:
            return _err('Not enough Spores.', 409)
        doc['spores'] = doc.get('spores', 0) + refund - cost
        doc.setdefault('gear', {})[g['slot']] = item_id
        deplete = line
        text = f"Bought {g['name']}" + (f' (traded in for {refund})' if refund else '')
    elif item_id in data.CONSUMABLES:
        line = next((e for e in stock['consumables'] if e['item'] == item_id), None)
        if not line:
            return _err("The bazaar isn't stocking that right now.", 409)
        if line['qty'] <= 0:
            return _err('Sold out — check back after the restock.', 409)
        c = data.CONSUMABLES[item_id]
        if len(doc.get('bag') or []) >= data.BAG_SIZE:
            return _err('Your bag is full (3 slots).', 409)
        if doc.get('spores', 0) < c['cost']:
            return _err('Not enough Spores.', 409)
        doc['spores'] -= c['cost']
        doc.setdefault('bag', []).append(item_id)
        deplete = line
        text = f"Bought {c['name']}"
    elif item_id in data.GRIMOIRES:
        g = data.GRIMOIRES[item_id]
        if g['tier'] != 1:
            return _err('The bazaar does not stock that tome.', 409)
        if item_id not in stock['grimoires']:
            return _err("The bazaar isn't stocking that tome right now.", 409)
        if item_id in (doc.get('grimoires') or []):
            return _err('You already own that grimoire.', 409)
        if doc.get('spores', 0) < g['cost']:
            return _err('Not enough Spores.', 409)
        doc['spores'] -= g['cost']
        _grant_grimoire(doc, item_id)
        text = f"Bought {g['name']}"
    else:
        return _err('Unknown item.')

    conflict = _save_or_conflict(table, doc)  # guard the player write first
    if conflict:
        return conflict
    if deplete is not None:                    # then the shared stock (last-writer-wins)
        deplete['qty'] -= 1
        table.put_item(Item={
            'pk': _season_pk(sid), 'sk': f'SHOP#{node}',
            'window': stock['window'], 'gear': stock['gear'],
            'consumables': stock['consumables'], 'grimoires': stock['grimoires']})
    return _ok(doc, text=text)
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `cd infrastructure/lambda && python -m pytest tests/test_undercity_db.py -k buy -q`
Expected: PASS (all four buy tests).

- [ ] **Step 5: Commit**

```bash
git add infrastructure/lambda/undercity_db.py infrastructure/lambda/tests/test_undercity_db.py
git commit -m "feat(undercity): bazaar buys deplete shared stock; grimoires never deplete"
```

---

## Task 6: `handle_state` — the `bazaars` block

**Files:**
- Modify: `infrastructure/lambda/undercity_db.py` (`handle_state`, ~line 444-538)
- Test: `infrastructure/lambda/tests/test_undercity_db.py`

- [ ] **Step 1: Write the failing test**

Add to `tests/test_undercity_db.py`:

```python
def test_state_surfaces_bazaars(table):
    act(table, 'join', starter='pest')
    sid = _sid(table)
    _, state = db.handle_state(table, {'userId': 'user-alex'})

    shop_nodes = [n for n, v in data.MAP_NODES.items() if v['type'] == 'shop']
    assert set(state['bazaars']) == set(shop_nodes)      # one view per shop node
    view = state['bazaars'][shop_nodes[0]]
    assert len(view['gear']) == data.SHOP_GEAR_SLOTS
    assert len(view['consumables']) == data.SHOP_CONSUMABLE_SLOTS
    assert len(view['grimoires']) == data.SHOP_GRIMOIRE_SLOTS
    assert view['refreshesAt'] == db._shop_window_end(db._shop_window())

    # A depleted persisted record is reflected in the view.
    node = shop_nodes[0]
    depleted = db._gen_shop_stock(node, db._shop_window())
    depleted['consumables'][0]['qty'] = 0
    table.put_item(Item={'pk': db._season_pk(sid), 'sk': f'SHOP#{node}', **depleted})
    _, state = db.handle_state(table, {'userId': 'user-alex'})
    assert state['bazaars'][node]['consumables'][0]['qty'] == 0
```

- [ ] **Step 2: Run test to verify it fails**

Run: `cd infrastructure/lambda && python -m pytest tests/test_undercity_db.py::test_state_surfaces_bazaars -q`
Expected: FAIL with `KeyError: 'bazaars'`.

- [ ] **Step 3a: Collect persisted `SHOP#` records in the query loop**

In `handle_state`, add `shops = {}` to the initializer at ~line 464:

```python
    players, you, snares, result, posts, sites = [], None, [], None, {}, {}
    veins, vaults, shops = {}, {}, {}
```

And add a branch to the `for item in items:` loop (after the `VAULT#` branch, ~line 484):

```python
        elif item['sk'].startswith('SHOP#'):
            shops[item['sk'].replace('SHOP#', '')] = item
```

- [ ] **Step 3b: Build the `bazaars` dict**

After the vein/vault display-seed block (~line 513, just before `out = {`), add:

```python
    # Bazaar stock per shop node — the current-window persisted record (possibly
    # depleted) or a freshly generated full stock. Display-seeded like posts.
    shop_window = _shop_window()
    refreshes_at = _shop_window_end(shop_window)
    bazaars = {}
    for nid, n in data.MAP_NODES.items():
        if n['type'] != 'shop':
            continue
        rec = shops.get(nid)
        st = rec if rec and rec.get('window') == shop_window else _gen_shop_stock(nid, shop_window)
        bazaars[nid] = {'gear': st['gear'], 'consumables': st['consumables'],
                        'grimoires': st['grimoires'], 'refreshesAt': refreshes_at}
```

- [ ] **Step 3c: Add `bazaars` to the payload**

In the `out = {...}` dict, after the `'tradingPosts': posts,` line (~line 522), add:

```python
        'bazaars': bazaars,
```

- [ ] **Step 4: Run test to verify it passes**

Run: `cd infrastructure/lambda && python -m pytest tests/test_undercity_db.py::test_state_surfaces_bazaars -q`
Expected: PASS.

- [ ] **Step 5: Run the FULL backend suite (must stay green)**

Run: `cd infrastructure/lambda && python -m pytest tests -q`
Expected: PASS — all tests, including the rewritten `test_buy_gear_and_consumables` and the previously-red case.

- [ ] **Step 6: Commit**

```bash
git add infrastructure/lambda/undercity_db.py infrastructure/lambda/tests/test_undercity_db.py
git commit -m "feat(undercity): ship per-node bazaar stock + restock clock in game state"
```

---

## Task 7: Client models + state accessor

**Files:**
- Modify: `src/app/undercity/services/undercity-models.ts`
- Modify: `src/app/undercity/services/undercity-state.service.ts`

- [ ] **Step 1: Add the model interfaces**

In `undercity-models.ts`, add near the other shared shapes (e.g. after the `TradeStockItem` definition):

```ts
export interface ShopStockItem {
  item: string;
  qty: number;
}

/** A bazaar node's current shared stock + when it restocks. */
export interface BazaarView {
  gear: ShopStockItem[];
  consumables: ShopStockItem[];
  grimoires: string[];
  /** ISO timestamp (UTC, no suffix) of the next restock. */
  refreshesAt: string;
}
```

Then add to the `GameState` interface, right after the `tradingPosts?` line:

```ts
  /** Shop node id -> its current shared stock and restock clock. */
  bazaars?: Record<string, BazaarView>;
```

- [ ] **Step 2: Add the state accessor**

In `undercity-state.service.ts`, after the `tradingPosts` computed (~line 39), add:

```ts
  readonly bazaars = computed(() => this._state()?.bazaars ?? {});
```

- [ ] **Step 3: Verify the build**

Run: `npm run build`
Expected: build succeeds (no TS errors). Nothing consumes `bazaars` yet — this just wires the types.

- [ ] **Step 4: Commit**

```bash
git add src/app/undercity/services/undercity-models.ts src/app/undercity/services/undercity-state.service.ts
git commit -m "feat(undercity/client): bazaar stock model + state accessor"
```

---

## Task 8: Client grimoire mirror

**Files:**
- Modify: `src/app/undercity/data/spells.ts` (the `GRIMOIRES` array, ~line 62)

- [ ] **Step 1: Mirror the four grimoires**

In `spells.ts`, in the `GRIMOIRES` array, after the `vagrants_chapbook` entry, add:

```ts
  { id: 'warcasters_screed', name: "Warcaster's Screed", tier: 1, cost: 35, spells: ['rot_surge', 'spore_bolt'], desc: 'Aggressor liturgy: swell with rot, then loose it.' },
  { id: 'hexweavers_codex', name: "Hexweaver's Codex", tier: 1, cost: 35, spells: ['bone_chill', 'bog_snare'], desc: 'Two curses for the price of one grudge.' },
  { id: 'nightrunners_ledger', name: "Nightrunner's Ledger", tier: 1, cost: 32, spells: ['glowveil', 'skitter_step'], desc: 'Slip the light, then slip the room.' },
  { id: 'tinkers_manual', name: "Tinker's Manual", tier: 1, cost: 30, spells: ['harden_shell', 'scrap_toss'], desc: 'Brace the shell, then throw the scrap heap.' },
```

- [ ] **Step 2: Verify the build**

Run: `npm run build`
Expected: build succeeds. (`GRIMOIRE_MAP` picks up the new entries automatically.)

- [ ] **Step 3: Commit**

```bash
git add src/app/undercity/data/spells.ts
git commit -m "feat(undercity/client): mirror the four new tier-1 grimoires"
```

---

## Task 9: Client board-tab logic — tabs, current bazaar, stocked rows

**Files:**
- Modify: `src/app/undercity/tabs/board-tab.component.ts`

- [ ] **Step 1: Import `BazaarView` and `GEAR_MAP`**

In `board-tab.component.ts`, add `BazaarView` to the `undercity-models` import list (line 18-32) and `GEAR_MAP` to the `../data/items` import list (line 43-54).

- [ ] **Step 2: Add the shop signals + getters**

Just after the `showShop` signal (line 134), add:

```ts
  protected readonly shopTab = signal<'gear' | 'consumables' | 'grimoires'>('gear');
```

Then, near the other shop helpers (`ownsGrimoire` / `grimoireSpellList`, ~line 285), add:

```ts
  protected readonly currentBazaar = computed<BazaarView | null>(() => {
    const pos = this.store.you()?.position;
    return pos ? (this.store.bazaars()[pos] ?? null) : null;
  });

  protected shopGearRows(): { info: GearInfo; qty: number }[] {
    return (this.currentBazaar()?.gear ?? [])
      .map((s) => ({ info: GEAR_MAP[s.item], qty: s.qty }))
      .filter((r) => !!r.info);
  }

  protected shopConsumableRows(): { info: ConsumableInfo; qty: number }[] {
    return (this.currentBazaar()?.consumables ?? [])
      .map((s) => ({ info: CONSUMABLE_MAP[s.item], qty: s.qty }))
      .filter((r) => !!r.info);
  }

  protected shopGrimoireRows(): GrimoireInfo[] {
    return (this.currentBazaar()?.grimoires ?? [])
      .map((id) => GRIMOIRE_MAP[id])
      .filter((g): g is GrimoireInfo => !!g);
  }

  protected bazaarRestockLabel(): string {
    const at = this.currentBazaar()?.refreshesAt;
    if (!at) return '—';
    const ms = new Date(at + 'Z').getTime() - Date.now();
    const min = Math.max(0, Math.ceil(ms / 60_000));
    return min <= 1 ? 'under a minute' : `${min} min`;
  }
```

- [ ] **Step 3: Reset the tab when the shop opens**

Find where `showShop.set(true)` is called (~line 710, the `ev.type === 'shop'` branch) and add `this.shopTab.set('gear');` alongside it, so every visit opens on the Gear tab:

```ts
    } else if (ev.type === 'shop') {
      this.shopTab.set('gear');
      this.showShop.set(true);
```

- [ ] **Step 4: Remove now-dead shop fields (optional cleanup)**

The old `protected readonly shopGrimoires = GRIMOIRES.filter((g) => g.tier === 1);` (line 185) is no longer referenced once Task 10 lands. Leave it until Task 10, then delete it there. The `gear = GEAR` / `consumables = CONSUMABLES` fields (lines 182-183) may still be used by the interactive-battle item picker — grep before removing; if referenced elsewhere, keep them.

- [ ] **Step 5: Verify the build**

Run: `npm run build`
Expected: build succeeds.

- [ ] **Step 6: Commit**

```bash
git add src/app/undercity/tabs/board-tab.component.ts
git commit -m "feat(undercity/client): bazaar tab state + stocked-row getters"
```

---

## Task 10: Client shop modal — tabbed template + styles

**Files:**
- Modify: `src/app/undercity/tabs/board-tab.component.html` (shop modal, lines 199-262)
- Modify: `src/app/undercity/tabs/board-tab.component.scss` (after `.shop-section`, ~line 557)
- Modify: `src/app/undercity/tabs/board-tab.component.ts` (delete the dead `shopGrimoires` field)

- [ ] **Step 1: Replace the shop modal markup**

Replace the whole `<!-- Shop -->` block (`board-tab.component.html` lines 199-262) with:

```html
  <!-- Shop -->
  @if (showShop()) {
    <div class="uc-modal-backdrop" (click)="closeFacilities()">
      <div
        class="uc-modal shop-modal"
        (click)="$event.stopPropagation()"
        [style.background-image]="regionWashBg()"
      >
        <img class="modal-art" src="undercity/icons/bazaar.png" alt="" />
        <h3><mat-icon class="mi">storefront</mat-icon> Rot-Farm Bazaar</h3>
        <p class="modal-sub">
          You carry <img class="rot-coin" src="undercity/icons/rot.png" alt="Spores" /> {{ store.you()?.spores }}
          · Restocks in {{ bazaarRestockLabel() }}
        </p>

        <div class="shop-tabs" role="tablist">
          <button class="shop-tab" [class.active]="shopTab() === 'gear'" (click)="shopTab.set('gear')">Gear</button>
          <button class="shop-tab" [class.active]="shopTab() === 'consumables'" (click)="shopTab.set('consumables')">Consumables</button>
          <button class="shop-tab" [class.active]="shopTab() === 'grimoires'" (click)="shopTab.set('grimoires')">Grimoires</button>
        </div>

        @switch (shopTab()) {
          @case ('gear') {
            <div class="shop-hint">Auto-equips; old piece trades in at 50%.</div>
            @for (r of shopGearRows(); track r.info.id) {
              <div class="shop-row">
                <span class="shop-name">{{ r.info.name }} <em>{{ r.info.desc }}</em></span>
                <button
                  class="uc-btn shop-buy"
                  [disabled]="busy() || r.qty <= 0 || store.you()?.gear?.[r.info.slot] === r.info.id"
                  (click)="buy(r.info)"
                >
                  @if (store.you()?.gear?.[r.info.slot] === r.info.id) {
                    Equipped
                  } @else if (r.qty <= 0) {
                    Sold out
                  } @else {
                    {{ r.info.cost }} <img class="rot-coin" src="undercity/icons/rot.png" alt="Spores" /> <span class="shop-qty">×{{ r.qty }}</span>
                  }
                </button>
              </div>
            } @empty {
              <div class="shop-empty">The gear racks are bare. Check back after the restock.</div>
            }
          }
          @case ('consumables') {
            <div class="shop-hint">Bag {{ store.you()?.bag?.length ?? 0 }}/3.</div>
            @for (r of shopConsumableRows(); track r.info.id) {
              <div class="shop-row">
                <span class="shop-name">
                  <mat-icon class="mi">{{ r.info.icon }}</mat-icon> {{ r.info.name }} <em>{{ r.info.desc }}</em>
                </span>
                <button class="uc-btn shop-buy" [disabled]="busy() || r.qty <= 0" (click)="buy(r.info)">
                  @if (r.qty <= 0) {
                    Sold out
                  } @else {
                    {{ r.info.cost }} <img class="rot-coin" src="undercity/icons/rot.png" alt="Spores" /> <span class="shop-qty">×{{ r.qty }}</span>
                  }
                </button>
              </div>
            } @empty {
              <div class="shop-empty">No consumables in stock. Check back after the restock.</div>
            }
          }
          @case ('grimoires') {
            <div class="shop-hint">Yours forever; open one from the Creature tab.</div>
            @for (g of shopGrimoireRows(); track g.id) {
              <div class="shop-row">
                <span class="shop-name">
                  <mat-icon class="mi">menu_book</mat-icon> {{ g.name }} <em>{{ grimoireSpellList(g) }}</em>
                </span>
                <button class="uc-btn shop-buy" [disabled]="busy() || ownsGrimoire(g.id)" (click)="buy(g)">
                  @if (ownsGrimoire(g.id)) {
                    Owned
                  } @else {
                    {{ g.cost }} <img class="rot-coin" src="undercity/icons/rot.png" alt="Spores" />
                  }
                </button>
              </div>
            } @empty {
              <div class="shop-empty">No tomes on the shelf right now.</div>
            }
          }
        }

        <button class="uc-btn close-btn" (click)="closeFacilities()">Leave</button>
      </div>
    </div>
  }
```

- [ ] **Step 2: Add the styles**

In `board-tab.component.scss`, after the `.shop-section { ... }` rule (~line 557), add:

```scss
.shop-tabs {
  display: flex;
  gap: 6px;
  margin: 8px 0 4px;
}

.shop-tab {
  flex: 1;
  padding: 6px 4px;
  font-size: 0.8rem;
  font-weight: 700;
  color: #9aa79a;
  background: rgba(0, 0, 0, 0.28);
  border: 1px solid transparent;
  border-radius: 8px;
  cursor: pointer;

  &.active {
    color: #d8f3dc;
    border-color: var(--accent-color);
    background: rgba(0, 0, 0, 0.42);
  }
}

.shop-hint {
  font-size: 0.75rem;
  color: #8a978a;
  margin: 4px 0 2px;
}

.shop-qty {
  font-size: 0.72rem;
  color: #9aa79a;
  margin-left: 2px;
}

.shop-empty {
  font-size: 0.82rem;
  color: #9aa79a;
  font-style: italic;
  text-align: center;
  padding: 12px 4px;
}
```

- [ ] **Step 3: Delete the dead field**

In `board-tab.component.ts`, remove the now-unused line:

```ts
  protected readonly shopGrimoires = GRIMOIRES.filter((g) => g.tier === 1);
```

If `GRIMOIRES` is no longer referenced anywhere else in the file after this, also drop it from the `../data/spells` import to avoid an unused-import build warning (grep first).

- [ ] **Step 4: Verify the build**

Run: `npm run build`
Expected: build succeeds.

- [ ] **Step 5: Manual verification (dev server)**

Run: `npm start`, open http://localhost:4200, enter the Undercity, and land on a Rot-Farm Bazaar (or use the map editor / a seeded position). Confirm:
- Three tabs render; only a few items per tab; header shows "Restocks in N min".
- Buying a consumable/gear decrements its ×N badge; at 0 it reads "Sold out" and is disabled.
- Grimoire tab shows 2 tomes; buying one flips it to "Owned" and does not remove it.

- [ ] **Step 6: Commit**

```bash
git add src/app/undercity/tabs/board-tab.component.html src/app/undercity/tabs/board-tab.component.scss src/app/undercity/tabs/board-tab.component.ts
git commit -m "feat(undercity/client): tabbed bazaar modal with rotating limited stock"
```

---

## Final verification

- [ ] Backend suite green: `cd infrastructure/lambda && python -m pytest tests -q`
- [ ] Client builds: `npm run build`
- [ ] `map.json` ⇄ `public/data/undercity-map.json` unaffected (no map edits in this plan — the map-copy pytest should stay green).

## Deploy note

Backend changes require a `cdk deploy` before the live client can use them (per the spells checklist). **The user runs deploys** — end with tests green and flag that a deploy is needed; do not deploy.
