# Umori Sealed-Auction Rework — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Replace Umori's give-junk-get-legendary barter with a shared sealed-bid Spore auction whose top 3 bidders each pull a ranked, variance-based mystery box — closing the early-game exploit while keeping the "fun stories" feel.

**Architecture:** All rules stay server-side in the Python Lambda (`undercity_db.py` + `undercity_data.py` + `undercity_config.py`), pure/deterministic, resolved lazily on read (no server tick). Each 2h→75min wander window is one auction; sealed bids are stored as per-user records, ranked deterministically, and outcomes are a pure function of the stored bids so any request recomputes them identically. The Angular client swaps the barter modal for a bid panel + a reveal modal.

**Tech Stack:** Python 3.11 Lambda (pytest in-memory `FakeTable` suite), Angular 20 standalone components (no frontend test runner — verified via `npm run build:prod` + the run-undercity skill).

**Design doc:** [specs/2026-08-05-undercity-umori-auction-design.md](2026-08-05-undercity-umori-auction-design.md)

**Test command (backend):** from repo root, `cd infrastructure/lambda && python -m pytest tests -q`
**Single test:** `python -m pytest tests/test_undercity_db.py::TESTNAME -v`

---

## File map

| File | Change |
|---|---|
| `infrastructure/lambda/undercity_config.py` | Add auction scalars (`UMORI_MIN_BID`, `UMORI_WINNERS`, `UMORI_RESERVES`); shorten `UMORI_DWELL_MIN`; remove `UMORI_STOCK_SPEC`, `UMORI_GEAR_SLOTS` |
| `infrastructure/lambda/undercity_data.py` | Add `UMORI_BOX_TABLES`, `UMORI_BOX_CONSOLATION`, `UMORI_BOX_NAMES` |
| `infrastructure/lambda/undercity_db.py` | Remove `_trade`, `_umori_stock`, `_umori_barter_stock`; add `_roll_umori_box`, `_umori_bids`, `_rank_bids`, `_umori_results`, `_grant_umori_box`, `_collect_umori`, `_umori_bid`; rewire dispatcher, land event, state block, posts loop |
| `infrastructure/lambda/tests/test_undercity_db.py` | Delete 11 barter tests; update 2 kept tests; add auction tests |
| `infrastructure/lambda/tests/test_world_event.py` | Update `test_world_event_overrides_umori_on_shared_node` (no more `stock`) |
| `src/app/undercity/services/undercity-models.ts` | Replace `umori` shape; add box/reveal types; remove barter-only types if unused |
| `src/app/undercity/tabs/board-tab.component.ts` | Replace trade methods with bid + reveal state/methods |
| `src/app/undercity/tabs/board-tab.component.html` | Replace barter modal with bid panel; add reveal modal |
| `src/app/undercity/data/*.ts` | Mirror `UMORI_BOX_NAMES` / min-bid if referenced client-side |

**Field/shape contract (used across tasks — keep names identical):**
- Player doc: `umoriBidWindow: int`, `umoriBidAmount: int`, `umoriCollectedWindow: int`. (The old `umoriTradedWindow` is removed.)
- Per-bid record: `pk=<season>`, `sk=f'POST#UMORI#{win}#BID#{userId}'`, fields `amount:int`, `username:str`, `ts:str`.
- Box dict: `{'kind': 'gear'|'grimoire'|'egg'|'consumable'|'materials', 'item'?:str, 'tier'?:int, 'ichor'?:int, 'moltings'?:int}`.
- Reveal dict (from `_collect_umori`): `{'window':int, 'placed':int|None, 'boxName'?:str, 'reward'?:dict, 'refund'?:int}`.
- State `umori` block: `{'node', 'movesAt', 'minBid', 'reserves':{rank:int}, 'yourBid':int, 'reveal'?:dict}`.

---

## Task 1: Auction config scalars + shorter dwell

**Files:**
- Modify: `infrastructure/lambda/undercity_config.py` (near line 246-249, the `UMORI_DWELL_MIN` block)
- Test: `infrastructure/lambda/tests/test_undercity_db.py`

- [ ] **Step 1: Write the failing test** — append to `test_undercity_db.py`:

```python
def test_umori_auction_config_present():
    # The auction is tuned by scalars in undercity_config (surfaced via data's
    # `from undercity_config import *`).
    assert data.UMORI_MIN_BID >= 1
    assert data.UMORI_WINNERS == 3
    assert set(data.UMORI_RESERVES) == {1, 2, 3}
    # Reserves must strictly descend so 1st place is the hardest box to unlock.
    assert data.UMORI_RESERVES[1] > data.UMORI_RESERVES[2] > data.UMORI_RESERVES[3]
    # Dwell shortened so a 6-8h event gets several auctions (see design §4.1).
    assert data.UMORI_DWELL_MIN <= 90
```

- [ ] **Step 2: Run test to verify it fails**

Run: `python -m pytest tests/test_undercity_db.py::test_umori_auction_config_present -v`
Expected: FAIL with `AttributeError: module 'undercity_data' has no attribute 'UMORI_MIN_BID'`

- [ ] **Step 3: Edit `undercity_config.py`** — replace the existing dwell block (currently `UMORI_DWELL_MIN = 120` with its comment) and remove the barter spec. Find:

```python
UMORI_DWELL_MIN = 120
```

Replace with:

```python
# Umori, the wandering collector: minutes he dwells at one wilderness node before
# hopping. Each window is ONE sealed-bid auction. Shortened from 120 so a 6-8h
# game-day event gets ~5-8 auction beats rather than 3-4 (see the auction design).
UMORI_DWELL_MIN = 75
# Sealed-bid auction (design 2026-08-05). Bids are Spores; the top UMORI_WINNERS
# bidders each pull a ranked mystery box. A rank whose winning bid is below its
# reserve rolls the consolation table instead of its rich table — the anti-exploit
# floor that stops a lone cheap bid from cracking the best box.
UMORI_MIN_BID = 5
UMORI_WINNERS = 3
UMORI_RESERVES = {1: 80, 2: 40, 3: 15}
```

- [ ] **Step 4: Remove the now-dead barter spec** in `undercity_data.py`. Find and delete these lines (near 865-871):

```python
# Umori barter seed per move: one T3 gear piece for EACH gear slot + this many T3
# grimoires (all tier 3 — the endgame payoff for reaching the wandering post).
UMORI_STOCK_SPEC = {'gear_per_slot': 1, 'grimoire': 1}

# Fixed slot order for Umori's gear lines (keeps takeIndex + the UI stable).
UMORI_GEAR_SLOTS = ['fang', 'carapace', 'charm']
```

(These are removed now to fail loudly if anything still references them; the code that reads them is deleted in Task 4.)

- [ ] **Step 5: Run test to verify it passes**

Run: `python -m pytest tests/test_undercity_db.py::test_umori_auction_config_present -v`
Expected: PASS

- [ ] **Step 6: Commit**

```bash
git add infrastructure/lambda/undercity_config.py infrastructure/lambda/undercity_data.py infrastructure/lambda/tests/test_undercity_db.py
git commit -m "feat(undercity): add Umori auction config, shorten dwell to 75m"
```

---

## Task 2: Mystery-box loot tables

**Files:**
- Modify: `infrastructure/lambda/undercity_data.py` (add after the removed barter-spec area, near the other reward tables)
- Test: `infrastructure/lambda/tests/test_undercity_db.py`

- [ ] **Step 1: Write the failing test**:

```python
def test_umori_box_tables_shape():
    # Three ranked box tables + a consolation table; every reward spec is one of
    # the five allowed kinds, and no table references a nonexistent item pool.
    assert set(data.UMORI_BOX_TABLES) == {1, 2, 3}
    assert set(data.UMORI_BOX_NAMES) == {1, 2, 3}
    tables = list(data.UMORI_BOX_TABLES.values()) + [data.UMORI_BOX_CONSOLATION]
    for tbl in tables:
        assert tbl, 'box table must be non-empty'
        for spec, weight in tbl.items():
            assert weight > 0
            kind = spec[0]
            assert kind in {'gear', 'grimoire', 'egg', 'consumable', 'materials'}
            if kind == 'gear':
                assert any(g['tier'] == spec[1] for g in data.GEAR.values())
            elif kind == 'grimoire':
                assert any(g['tier'] == spec[1] for g in data.GRIMOIRES.values())
```

- [ ] **Step 2: Run test to verify it fails**

Run: `python -m pytest tests/test_undercity_db.py::test_umori_box_tables_shape -v`
Expected: FAIL with `AttributeError: ... 'UMORI_BOX_TABLES'`

- [ ] **Step 3: Add the tables** to `undercity_data.py` (place them just after the `ISLAND_BAZAAR_NODES` block near line 863, where Umori's constants used to live):

```python
# ── Umori's sealed auction — ranked mystery boxes (design 2026-08-05) ─────────
# Each rank rolls ONE reward from its weighted table (a treat, never a guaranteed
# endgame piece — the fix for the give-junk-get-legendary exploit). Reward specs:
#   ('gear', tier)                  a random gear piece of that tier
#   ('grimoire', tier)              a random grimoire of that tier
#   ('egg', tier)                   a companion egg of that tier
#   ('consumable',)                 a random consumable
#   ('materials', ichor, moltings)  crafting materials (ichor == Gemstones)
# Higher ranks skew toward the rare end; the materials entries are the "never a
# total whiff" floor. A rank whose winning bid is under its reserve
# (UMORI_RESERVES) rolls UMORI_BOX_CONSOLATION instead of its own table. Weights
# are tunable (tune-undercity-balance skill); client mirror in data/undercity-*.ts.
UMORI_BOX_TABLES = {
    1: {  # Gilded Coffer
        ('gear', 3): 3,
        ('grimoire', 3): 2,
        ('egg', 3): 2,
        ('gear', 2): 3,
        ('materials', 3, 4): 5,
    },
    2: {  # Curio Box
        ('gear', 2): 4,
        ('grimoire', 2): 2,
        ('egg', 2): 2,
        ('consumable',): 2,
        ('materials', 1, 3): 5,
    },
    3: {  # Trinket Pouch
        ('consumable',): 4,
        ('egg', 1): 2,
        ('materials', 0, 2): 6,
    },
}

# Rolled by any rank whose winning bid fell short of its reserve.
UMORI_BOX_CONSOLATION = {
    ('consumable',): 3,
    ('materials', 0, 2): 6,
    ('egg', 1): 1,
}

# Display names per rank (client mirror in data/undercity-*.ts).
UMORI_BOX_NAMES = {1: 'Gilded Coffer', 2: 'Curio Box', 3: 'Trinket Pouch'}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `python -m pytest tests/test_undercity_db.py::test_umori_box_tables_shape -v`
Expected: PASS

- [ ] **Step 5: Commit**

```bash
git add infrastructure/lambda/undercity_data.py infrastructure/lambda/tests/test_undercity_db.py
git commit -m "feat(undercity): add Umori mystery-box loot tables"
```

---

## Task 3: Deterministic box roll

**Files:**
- Modify: `infrastructure/lambda/undercity_db.py` (add `_roll_umori_box` just after `_roll_gear_drop`, ~line 1441 — where `_pick_weighted` (line 1024) and the module-level `random`/`zlib`/`data` are all in scope)
- Test: `infrastructure/lambda/tests/test_undercity_db.py`

- [ ] **Step 1: Write the failing test**:

```python
def test_roll_umori_box_is_deterministic_and_valid():
    # Same (window, rank) → identical contents for every caller (no coordination).
    a = db._roll_umori_box(1000, 1, under_reserve=False)
    b = db._roll_umori_box(1000, 1, under_reserve=False)
    assert a == b
    assert a['kind'] in {'gear', 'grimoire', 'egg', 'consumable', 'materials'}
    if a['kind'] == 'gear':
        assert a['item'] in data.GEAR
    if a['kind'] == 'grimoire':
        assert a['item'] in data.GRIMOIRES
    if a['kind'] == 'consumable':
        assert a['item'] in data.CONSUMABLES
    if a['kind'] == 'materials':
        assert a['ichor'] >= 0 and a['moltings'] >= 0


def test_roll_umori_box_under_reserve_uses_consolation():
    # Under reserve, rank 1 must draw only from the consolation table's kinds
    # (no ('gear',3)/('grimoire',3)/('egg',3) jackpot lines).
    allowed = {spec[0] for spec in data.UMORI_BOX_CONSOLATION}
    seen = {db._roll_umori_box(w, 1, under_reserve=True)['kind'] for w in range(200)}
    assert seen <= allowed
```

- [ ] **Step 2: Run test to verify it fails**

Run: `python -m pytest tests/test_undercity_db.py::test_roll_umori_box_is_deterministic_and_valid -v`
Expected: FAIL with `AttributeError: module 'undercity_db' has no attribute '_roll_umori_box'`

- [ ] **Step 3: Add `_roll_umori_box`** to `undercity_db.py` (immediately after `_roll_gear_drop`, ~line 1441):

```python
def _roll_umori_box(window, rank, under_reserve):
    """Deterministic single-reward roll for an auction box, seeded by
    (window, rank) so every request computes the identical contents with no
    coordination. under_reserve swaps the rank's rich table for the consolation
    table (the reserve-price anti-exploit floor). Returns a box dict (see the
    field contract in the plan header)."""
    rng = random.Random(zlib.crc32(f'umori-box:{window}:{rank}'.encode()))
    table = data.UMORI_BOX_CONSOLATION if under_reserve else data.UMORI_BOX_TABLES[rank]
    spec = _pick_weighted(rng, table)
    kind = spec[0]
    if kind == 'gear':
        pool = sorted(gid for gid, g in data.GEAR.items() if g['tier'] == spec[1])
        return {'kind': 'gear', 'item': rng.choice(pool)}
    if kind == 'grimoire':
        pool = sorted(gid for gid, g in data.GRIMOIRES.items() if g['tier'] == spec[1])
        return {'kind': 'grimoire', 'item': rng.choice(pool)}
    if kind == 'egg':
        return {'kind': 'egg', 'tier': int(spec[1])}
    if kind == 'consumable':
        return {'kind': 'consumable', 'item': rng.choice(sorted(data.CONSUMABLES))}
    return {'kind': 'materials', 'ichor': int(spec[1]), 'moltings': int(spec[2])}
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `python -m pytest tests/test_undercity_db.py -k roll_umori_box -v`
Expected: 2 PASS

- [ ] **Step 5: Commit**

```bash
git add infrastructure/lambda/undercity_db.py infrastructure/lambda/tests/test_undercity_db.py
git commit -m "feat(undercity): deterministic Umori box roll with reserve gating"
```

---

## Task 4: Remove the barter path; make Umori a bare auction node

Rip out the old give/take trade so nothing references the deleted config, and turn the land event + state block into a minimal auction descriptor (no bidding yet — that arrives in Tasks 5-9). This keeps the suite green between the two halves.

**Files:**
- Modify: `infrastructure/lambda/undercity_db.py` (delete `_trade` ~6547-6660, `_umori_stock` ~118-134, `_umori_barter_stock` ~6483-6489; dispatcher line ~2424; land event ~3786-3791; state seed ~2246-2250; state block ~2286-2287; posts loop ~2218-2219)
- Modify: `infrastructure/lambda/tests/test_undercity_db.py` (delete barter tests; update 2 kept tests)
- Modify: `infrastructure/lambda/tests/test_world_event.py` (update umori-override test)

- [ ] **Step 1: Delete the dead barter tests.** In `test_undercity_db.py` remove these functions entirely (and their `_stand_on_umori` / `_t3_fang` / `_t3_tome` / `_t3_carapace` helpers ONLY if no remaining test uses them — grep first): `test_umori_pre_seeds_t3_stock`, `test_umori_swap_gear`, `test_umori_swap_grimoire_auto_equips`, `test_umori_rejects_consumable_give`, `test_umori_rejects_trade_when_not_on_node`, `test_umori_rejects_out_of_range_take`, `test_umori_rejects_cross_slot_gear`, `test_umori_rejects_cross_kind`, `test_umori_gives_from_stash`, `test_state_reports_umori_traded_flag`, `test_umori_one_barter_per_rotation`, `test_umori_stock_is_all_t3_and_deterministic`.

Keep `_stand_on_umori` (Tasks 6-9 reuse it). Delete `_t3_fang`/`_t3_tome`/`_t3_carapace` if grep shows no other users:

Run: `grep -rn "_t3_fang\|_t3_tome\|_t3_carapace" tests/`

- [ ] **Step 2: Update the 2 kept structural tests.** Replace `test_resolve_on_umori_node_opens_a_trading_post` and `test_state_surfaces_umori` with:

```python
def test_resolve_on_umori_node_opens_the_auction(table):
    sid, doc, node = _stand_on_umori(table)
    win = db._umori_window()
    ev = db._resolve_space(table, sid, doc, node, 'somewhere')
    assert ev['type'] == 'trading_post' and ev['umori'] is True
    assert ev['movesAt'] == db._umori_window_end(win)
    assert ev['minBid'] == data.UMORI_MIN_BID
    assert 'stock' not in ev            # barter is gone


def test_state_surfaces_umori_auction(table):
    sid, doc, node = _stand_on_umori(table)
    win = db._umori_window()
    _, state = db.handle_state(table, {'userId': 'user-alex'})
    u = state['umori']
    assert u['node'] == db._umori_node(win)
    assert u['movesAt'] == db._umori_window_end(win)
    assert u['minBid'] == data.UMORI_MIN_BID
    assert u['yourBid'] == 0
```

- [ ] **Step 3: Run the kept tests to verify they fail**

Run: `python -m pytest tests/test_undercity_db.py -k "umori_auction or surfaces_umori_auction" -v`
Expected: FAIL (ev still has `stock`; state block still has `traded`, no `minBid`)

- [ ] **Step 4: Delete `_umori_stock`** (`undercity_db.py` ~118-134) and **`_umori_barter_stock`** (~6483-6489) and **`_trade`** (~6547 through its `return _ok(...)`, ~6655). Grep to confirm no stragglers:

Run: `grep -n "_umori_stock\|_umori_barter_stock\|_trade\b\|umoriTradedWindow\|UMORI_STOCK_SPEC\|UMORI_GEAR_SLOTS" undercity_db.py`
Expected after edits: only the dispatcher line (fixed next) — everything else gone.

- [ ] **Step 5: Remove the dispatcher entry.** In `undercity_db.py` ~line 2424 change:

```python
        'trade': _trade, 'dig': _dig, 'strike': _strike,
```
to:
```python
        'dig': _dig, 'strike': _strike,
```

- [ ] **Step 6: Rewrite the land event.** Replace the umori branch in `_resolve_space` (~3783-3791):

```python
    # Umori the wandering collector pacifies whatever wilderness space it sits on
    # this window and opens a sealed-bid auction (overrides the node's normal
    # event). Runs after snare/pile so player traps still fire.
    _uwin = _umori_window()
    if node == _umori_node(_uwin):
        return {'type': 'trading_post', 'node': node, 'umori': True,
                'movesAt': _umori_window_end(_uwin),
                'minBid': data.UMORI_MIN_BID,
                'reserves': data.UMORI_RESERVES,
                'yourBid': (doc.get('umoriBidAmount', 0)
                            if doc.get('umoriBidWindow') == _uwin else 0),
                'text': 'Umori the collector oozes up a crooked stall. Seal a Spore '
                        'bid — when it wanders on, the top three bidders each pull a '
                        'mystery box.'}
```

- [ ] **Step 7: Remove the display-seed of barter stock.** In `handle_state` delete the block (~2246-2250):

```python
    # Umori the wandering post: its current node + display-seeded T3 stock so the
    # board can render it anywhere and the exchange opens from turn one.
    umori_win = _umori_window()
    umori_node = _umori_node(umori_win)
    posts[umori_node] = _umori_barter_stock(table, sid, umori_win)
```

Replace with (we still need `umori_win`/`umori_node` for the state block):

```python
    # Umori the wandering collector: just its current node/window for the auction
    # block below (no display stock — the auction is bid-driven, not barter).
    umori_win = _umori_window()
    umori_node = _umori_node(umori_win)
```

- [ ] **Step 8: Rewrite the state block.** Replace (~2286-2287):

```python
        'umori': {'node': umori_node, 'movesAt': _umori_window_end(umori_win),
                  'traded': bool(you and you.get('umoriTradedWindow') == umori_win)},
```
with:
```python
        'umori': {'node': umori_node, 'movesAt': _umori_window_end(umori_win),
                  'minBid': data.UMORI_MIN_BID, 'reserves': data.UMORI_RESERVES,
                  'yourBid': (you.get('umoriBidAmount', 0)
                              if you and you.get('umoriBidWindow') == umori_win else 0)},
```

- [ ] **Step 9: Skip auction bid records in the posts loop.** In `handle_state` (~2218-2219), change:

```python
        elif item['sk'].startswith('POST#'):
            posts[item['sk'].replace('POST#', '')] = item.get('stock') or []
```
to:
```python
        elif item['sk'].startswith('POST#UMORI#'):
            pass  # auction bid records, not a rendered trading post
        elif item['sk'].startswith('POST#'):
            posts[item['sk'].replace('POST#', '')] = item.get('stock') or []
```

- [ ] **Step 10: Update the world-event override test.** In `test_world_event.py`, `test_world_event_overrides_umori_on_shared_node` — remove any assertion referencing `ev['stock']` or barter; assert only that the world-event beast event wins on the shared node (its `type` is the beast event, not `trading_post`). Read the test and adjust its final assertions to drop `stock`.

- [ ] **Step 11: Run the whole suite**

Run: `python -m pytest tests -q`
Expected: PASS (barter gone, kept tests green). If any test still references `_trade`/`stock`/`traded`, fix it.

- [ ] **Step 12: Commit**

```bash
git add infrastructure/lambda/undercity_db.py infrastructure/lambda/tests/
git commit -m "refactor(undercity): remove Umori barter; auction node scaffold"
```

---

## Task 5: Read sealed bids (records + ranking)

**Files:**
- Modify: `infrastructure/lambda/undercity_db.py` (add helpers near `_roll_umori_box`)
- Test: `infrastructure/lambda/tests/test_undercity_db.py`

- [ ] **Step 1: Write the failing test**:

```python
def _seed_bid(table, sid, win, uid, amount, name, ts):
    table.put_item(Item={'pk': db._season_pk(sid),
                         'sk': f'POST#UMORI#{win}#BID#{uid}',
                         'amount': amount, 'username': name, 'ts': ts})


def test_umori_bids_and_ranking(table):
    sid = _sid(table)
    win = db._umori_window()
    _seed_bid(table, sid, win, 'user-a', 40, 'A', '2026-01-01T00:00:00.000')
    _seed_bid(table, sid, win, 'user-b', 70, 'B', '2026-01-01T00:00:01.000')
    _seed_bid(table, sid, win, 'user-c', 70, 'C', '2026-01-01T00:00:00.500')  # earlier tie
    bids = db._umori_bids(table, sid, win)
    assert bids['user-b']['amount'] == 70
    ranked = db._rank_bids(bids)
    # 70s outrank 40; the earlier-ts 70 (C) beats the later-ts 70 (B).
    assert [uid for uid, _ in ranked] == ['user-c', 'user-b', 'user-a']
```

- [ ] **Step 2: Run test to verify it fails**

Run: `python -m pytest tests/test_undercity_db.py::test_umori_bids_and_ranking -v`
Expected: FAIL with `AttributeError: ... '_umori_bids'`

- [ ] **Step 3: Add the helpers** (`undercity_db.py`, just below `_roll_umori_box`):

```python
def _umori_bids(table, sid, window):
    """Every sealed bid for a window, read from the per-user POST#UMORI#{w}#BID#
    records (separate items so concurrent bidders never clobber each other).
    Returns {userId: {'amount': int, 'username': str, 'ts': str}}."""
    prefix = f'POST#UMORI#{window}#BID#'
    rows = table.query(
        KeyConditionExpression='pk = :pk AND begins_with(sk, :sk)',
        ExpressionAttributeValues={':pk': _season_pk(sid), ':sk': prefix})['Items']
    out = {}
    for r in (_clean(x) for x in rows):
        uid = r['sk'].split('#BID#', 1)[1]
        out[uid] = {'amount': int(r['amount']),
                    'username': r.get('username', 'someone'), 'ts': r.get('ts', '')}
    return out


def _rank_bids(bids):
    """Bidders ranked best-first: highest amount, ties broken by earliest ts."""
    return sorted(bids.items(), key=lambda kv: (-kv[1]['amount'], kv[1]['ts']))
```

- [ ] **Step 4: Run test to verify it passes**

Run: `python -m pytest tests/test_undercity_db.py::test_umori_bids_and_ranking -v`
Expected: PASS

- [ ] **Step 5: Commit**

```bash
git add infrastructure/lambda/undercity_db.py infrastructure/lambda/tests/test_undercity_db.py
git commit -m "feat(undercity): read + rank Umori sealed bids"
```

---

## Task 6: The `umori-bid` action (presence, min-bid, raise-only, escrow)

**Files:**
- Modify: `infrastructure/lambda/undercity_db.py` (add `_umori_bid`; dispatcher entry)
- Test: `infrastructure/lambda/tests/test_undercity_db.py`

- [ ] **Step 1: Write the failing tests**:

```python
def _join_on_umori(table, user, name):
    """Join `user` and stand them on the current Umori node. Returns (sid, node)."""
    act(table, 'join', starter='pest', user=user, name=name)
    sid = _sid(table)
    doc = db._get_player(table, sid, user)
    node = db._umori_node(db._umori_window())
    doc['position'] = node
    doc['spores'] = 500
    db._put_player(table, doc)
    return sid, node


def test_umori_bid_escrows_spores(table):
    sid, node = _join_on_umori(table, 'user-alex', 'Alex')
    status, resp = act(table, 'umori-bid', amount=40)
    assert status == 200
    assert resp['you']['spores'] == 460                 # 500 - 40 escrowed
    assert resp['you']['umoriBidAmount'] == 40
    win = db._umori_window()
    assert db._umori_bids(table, sid, win)['user-alex']['amount'] == 40


def test_umori_bid_requires_presence(table):
    act(table, 'join', starter='pest')
    sid = _sid(table)
    doc = db._get_player(table, sid, 'user-alex')
    doc['position'] = next(n for n in data.UMORI_NODES
                           if n != db._umori_node(db._umori_window()))
    doc['spores'] = 500
    db._put_player(table, doc)
    status, resp = act(table, 'umori-bid', amount=40)
    assert status == 409 and 'not here' in resp['error']


def test_umori_bid_enforces_min(table):
    _join_on_umori(table, 'user-alex', 'Alex')
    status, resp = act(table, 'umori-bid', amount=data.UMORI_MIN_BID - 1)
    assert status == 409 and 'start at' in resp['error']


def test_umori_bid_is_raise_only_and_escrows_delta(table):
    sid, node = _join_on_umori(table, 'user-alex', 'Alex')
    act(table, 'umori-bid', amount=40)
    status, resp = act(table, 'umori-bid', amount=30)          # lower → rejected
    assert status == 409 and 'raise' in resp['error']
    status, resp = act(table, 'umori-bid', amount=60)          # raise by 20
    assert status == 200
    assert resp['you']['spores'] == 440                        # 500 - 60 total escrow
    assert resp['you']['umoriBidAmount'] == 60


def test_umori_bid_rejects_when_broke(table):
    sid, node = _join_on_umori(table, 'user-alex', 'Alex')
    doc = db._get_player(table, sid, 'user-alex')
    doc['spores'] = 10
    db._put_player(table, doc)
    status, resp = act(table, 'umori-bid', amount=40)
    assert status == 409 and 'Not enough' in resp['error']
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `python -m pytest tests/test_undercity_db.py -k umori_bid -v`
Expected: FAIL with `Unknown action: umori-bid`

- [ ] **Step 3: Add `_umori_bid`** to `undercity_db.py` (place it where `_trade` was removed, ~line 6547). Note it calls `_collect_umori` with `persist=False`; that helper is added in Task 8, so add a temporary stub now and remove it in Task 8:

```python
def _collect_umori(table, sid, doc, persist=True):  # TEMP stub — replaced in Task 8
    return None


def _umori_bid(table, sid, doc, payload):
    """Drop or raise a sealed Spore bid at Umori's auction. Presence-gated to his
    current tile; raise-only; the bid (or raise delta) is escrowed immediately
    and refunded at close if the player doesn't place top-3."""
    win = _umori_window()
    if doc.get('position') != _umori_node(win):
        return _err('Umori is not here.', 409)
    try:
        amount = int(payload.get('amount'))
    except (TypeError, ValueError):
        return _err('Enter a bid amount.')
    if amount < data.UMORI_MIN_BID:
        return _err(f'Bids start at {data.UMORI_MIN_BID} Spores.', 409)

    _collect_umori(table, sid, doc, persist=False)   # settle any stale window first

    prev = doc.get('umoriBidAmount', 0) if doc.get('umoriBidWindow') == win else 0
    if amount <= prev:
        return _err(f'You must raise above your current bid of {prev} Spores.', 409)
    delta = amount - prev
    if doc.get('spores', 0) < delta:
        return _err('Not enough Spores.', 409)
    doc['spores'] -= delta
    doc['umoriBidWindow'] = win
    doc['umoriBidAmount'] = amount

    conflict = _save_or_conflict(table, doc)         # guard the player write first
    if conflict:
        return conflict
    # Then the per-user sealed-bid record (own sk → no cross-bidder clobber).
    table.put_item(Item={'pk': _season_pk(sid),
                         'sk': f'POST#UMORI#{win}#BID#{doc["userId"]}',
                         'amount': amount, 'username': doc.get('username', 'someone'),
                         'ts': _now_ms()})
    _event(table, sid, 'umori-bid',
           f"{doc['username']} sealed a bid at Umori's auction.", actor=doc['userId'])
    return _ok(doc, text=f'Sealed bid: {amount} Spores.',
               umoriBid=amount, movesAt=_umori_window_end(win))
```

- [ ] **Step 4: Register the action.** In the dispatcher (~line 2424, where `'dig': _dig` now sits) add `'umori-bid': _umori_bid`:

```python
        'umori-bid': _umori_bid, 'dig': _dig, 'strike': _strike,
```

- [ ] **Step 5: Run tests to verify they pass**

Run: `python -m pytest tests/test_undercity_db.py -k umori_bid -v`
Expected: 5 PASS

- [ ] **Step 6: Commit**

```bash
git add infrastructure/lambda/undercity_db.py infrastructure/lambda/tests/test_undercity_db.py
git commit -m "feat(undercity): umori-bid action with escrow + raise-only"
```

---

## Task 7: Auction results (ranking → reserve → box)

**Files:**
- Modify: `infrastructure/lambda/undercity_db.py` (add `_umori_results`)
- Test: `infrastructure/lambda/tests/test_undercity_db.py`

- [ ] **Step 1: Write the failing test**:

```python
def test_umori_results_ranks_and_reserve_gates(table):
    sid = _sid(table)
    win = db._umori_window()
    _seed_bid(table, sid, win, 'user-a', data.UMORI_RESERVES[1] + 5, 'A',
              '2026-01-01T00:00:00.000')                       # clears rank-1 reserve
    _seed_bid(table, sid, win, 'user-b', data.UMORI_RESERVES[2] - 1, 'B',
              '2026-01-01T00:00:01.000')                       # UNDER rank-2 reserve
    results = db._umori_results(table, sid, win)
    assert [r['userId'] for r in results] == ['user-a', 'user-b']
    assert results[0]['rank'] == 1 and results[0]['underReserve'] is False
    assert results[1]['rank'] == 2 and results[1]['underReserve'] is True
    for r in results:
        assert r['box']['kind'] in {'gear', 'grimoire', 'egg', 'consumable', 'materials'}


def test_umori_results_caps_at_winners(table):
    sid = _sid(table)
    win = db._umori_window()
    for i in range(5):
        _seed_bid(table, sid, win, f'user-{i}', 100 - i, f'P{i}',
                  f'2026-01-01T00:00:0{i}.000')
    results = db._umori_results(table, sid, win)
    assert len(results) == data.UMORI_WINNERS      # only the top 3 place
```

- [ ] **Step 2: Run test to verify it fails**

Run: `python -m pytest tests/test_undercity_db.py -k umori_results -v`
Expected: FAIL with `AttributeError: ... '_umori_results'`

- [ ] **Step 3: Add `_umori_results`** (`undercity_db.py`, just below `_rank_bids`):

```python
def _umori_results(table, sid, window):
    """Deterministic auction outcome for a window: the ranked top-UMORI_WINNERS
    bidders and their rolled boxes, a pure function of the stored bids (safe to
    recompute any number of times — no writes). Each result:
    {'userId','username','rank','amount','underReserve','box'}."""
    ranked = _rank_bids(_umori_bids(table, sid, window))
    results = []
    for i, (uid, info) in enumerate(ranked[:data.UMORI_WINNERS]):
        rank = i + 1
        under = info['amount'] < data.UMORI_RESERVES[rank]
        results.append({'userId': uid, 'username': info['username'], 'rank': rank,
                        'amount': info['amount'], 'underReserve': under,
                        'box': _roll_umori_box(window, rank, under)})
    return results
```

- [ ] **Step 4: Run test to verify it passes**

Run: `python -m pytest tests/test_undercity_db.py -k umori_results -v`
Expected: 2 PASS

- [ ] **Step 5: Commit**

```bash
git add infrastructure/lambda/undercity_db.py infrastructure/lambda/tests/test_undercity_db.py
git commit -m "feat(undercity): deterministic Umori auction results"
```

---

## Task 8: Grant boxes + collect/refund (pull model)

**Files:**
- Modify: `infrastructure/lambda/undercity_db.py` (add `_grant_umori_box`; replace the Task-6 `_collect_umori` stub with the real one)
- Test: `infrastructure/lambda/tests/test_undercity_db.py`

- [ ] **Step 1: Write the failing tests**:

```python
def test_collect_umori_grants_winner_box(table, monkeypatch):
    sid, node = _join_on_umori(table, 'user-alex', 'Alex')
    win = db._umori_window()
    # Alex bids and clears rank-1 reserve; force the box roll to a known egg.
    act(table, 'umori-bid', amount=data.UMORI_RESERVES[1] + 10)
    monkeypatch.setattr(db, '_roll_umori_box',
                        lambda w, r, under_reserve: {'kind': 'egg', 'tier': 2})
    # Advance past the window so the auction is closed.
    doc = db._get_player(table, sid, 'user-alex')
    doc['umoriBidWindow'] = win - 1                 # pretend the bid was last window
    # (re-point the bid record to the prior window too)
    db._put_player(table, doc)
    table.put_item(Item={'pk': db._season_pk(sid),
                         'sk': f'POST#UMORI#{win - 1}#BID#user-alex',
                         'amount': data.UMORI_RESERVES[1] + 10, 'username': 'Alex',
                         'ts': '2026-01-01T00:00:00.000'})
    doc = db._get_player(table, sid, 'user-alex')
    before = len(doc.get('eggs') or [])
    reveal = db._collect_umori(table, sid, doc)
    assert reveal['placed'] == 1
    assert reveal['reward']['kind'] == 'egg'
    doc2 = db._get_player(table, sid, 'user-alex')
    assert len(doc2.get('eggs') or []) == before + 1
    assert doc2['umoriCollectedWindow'] == win - 1
    assert 'umoriBidWindow' not in doc2             # bid fields cleared


def test_collect_umori_refunds_non_winner(table):
    sid, node = _join_on_umori(table, 'user-alex', 'Alex')
    win = db._umori_window()
    # Alex bid last window but 3 others outbid him → 4th place → full refund.
    doc = db._get_player(table, sid, 'user-alex')
    doc['spores'] = 100
    doc['umoriBidWindow'] = win - 1
    doc['umoriBidAmount'] = 20
    db._put_player(table, doc)
    for i in range(3):
        table.put_item(Item={'pk': db._season_pk(sid),
                             'sk': f'POST#UMORI#{win - 1}#BID#rich-{i}',
                             'amount': 200 + i, 'username': f'R{i}',
                             'ts': f'2026-01-01T00:00:0{i}.000'})
    table.put_item(Item={'pk': db._season_pk(sid),
                         'sk': f'POST#UMORI#{win - 1}#BID#user-alex',
                         'amount': 20, 'username': 'Alex',
                         'ts': '2026-01-01T00:00:09.000'})
    doc = db._get_player(table, sid, 'user-alex')
    reveal = db._collect_umori(table, sid, doc)
    assert reveal['placed'] is None and reveal['refund'] == 20
    doc2 = db._get_player(table, sid, 'user-alex')
    assert doc2['spores'] == 120                    # 100 + 20 refunded
    assert doc2['umoriCollectedWindow'] == win - 1


def test_collect_umori_is_idempotent(table):
    sid, node = _join_on_umori(table, 'user-alex', 'Alex')
    win = db._umori_window()
    doc = db._get_player(table, sid, 'user-alex')
    doc['spores'] = 100
    doc['umoriBidWindow'] = win - 1
    doc['umoriBidAmount'] = 20
    db._put_player(table, doc)
    table.put_item(Item={'pk': db._season_pk(sid),
                         'sk': f'POST#UMORI#{win - 1}#BID#user-alex',
                         'amount': 20, 'username': 'Alex', 'ts': '2026-01-01T00:00:00.000'})
    doc = db._get_player(table, sid, 'user-alex')
    db._collect_umori(table, sid, doc)              # first pull refunds
    doc2 = db._get_player(table, sid, 'user-alex')
    assert db._collect_umori(table, sid, doc2) is None   # second pull is a no-op
    doc3 = db._get_player(table, sid, 'user-alex')
    assert doc3['spores'] == 120                    # not double-refunded
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `python -m pytest tests/test_undercity_db.py -k collect_umori -v`
Expected: FAIL (stub `_collect_umori` returns None; no `_grant_umori_box`)

- [ ] **Step 3: Delete the Task-6 stub** `_collect_umori` and add the real helpers (`undercity_db.py`, above `_umori_bid`):

```python
def _grant_umori_box(doc, box):
    """Apply one rolled box reward to the player doc via the standard grant paths
    (gear/consumable overflow auto-parks to the pickup modal). Returns a reveal
    dict for the client."""
    kind = box['kind']
    if kind == 'gear':
        r = _gain_gear(doc, box['item'])
        return {'kind': 'gear', 'item': box['item'], 'outcome': r['outcome']}
    if kind == 'grimoire':
        gid = box['item']
        if gid not in (doc.get('grimoires') or []):
            doc.setdefault('grimoires', []).append(gid)
            if not doc.get('equippedGrimoire'):
                doc['equippedGrimoire'] = gid
        return {'kind': 'grimoire', 'item': gid}
    if kind == 'egg':
        egg = _grant_egg(doc, box['tier'])
        return {'kind': 'egg', 'tier': int(box['tier']), 'eggId': egg['id']}
    if kind == 'consumable':
        r = _acquire(doc, 'consumable', box['item'])
        return {'kind': 'consumable', 'item': box['item'], 'outcome': r['outcome']}
    _mine_materials(doc, ichor=box.get('ichor', 0), moltings=box.get('moltings', 0))
    return {'kind': 'materials', 'ichor': box.get('ichor', 0),
            'moltings': box.get('moltings', 0)}


def _collect_umori(table, sid, doc, persist=True):
    """Pull-model settlement: if the player has an un-collected bid in a CLOSED
    window, grant their box (top-3) or refund their escrow (else). Mutates doc;
    self-persists when persist=True (best-effort — a version conflict just leaves
    it for the next read). Returns a reveal dict, or None if nothing to settle."""
    win = doc.get('umoriBidWindow')
    if win is None or win >= _umori_window():          # no bid, or still open
        return None
    if doc.get('umoriCollectedWindow') == win:
        return None                                     # already settled
    amount = doc.get('umoriBidAmount', 0)
    doc['umoriCollectedWindow'] = win
    doc.pop('umoriBidWindow', None)
    doc.pop('umoriBidAmount', None)

    mine = next((r for r in _umori_results(table, sid, win)
                 if r['userId'] == doc.get('userId')), None)
    if mine:
        reward = _grant_umori_box(doc, mine['box'])
        reveal = {'window': win, 'placed': mine['rank'],
                  'boxName': data.UMORI_BOX_NAMES[mine['rank']], 'reward': reward}
    else:
        doc['spores'] = doc.get('spores', 0) + amount   # 4th+ → full refund
        reveal = {'window': win, 'placed': None, 'refund': amount}

    if persist and not _put_player(table, doc):
        return None                                     # lost the race; retry next read
    return reveal
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `python -m pytest tests/test_undercity_db.py -k collect_umori -v`
Expected: 3 PASS

- [ ] **Step 5: Run the whole suite** (guards against the stub removal breaking Task 6):

Run: `python -m pytest tests -q`
Expected: PASS

- [ ] **Step 6: Commit**

```bash
git add infrastructure/lambda/undercity_db.py infrastructure/lambda/tests/test_undercity_db.py
git commit -m "feat(undercity): grant boxes + pull-model collect/refund"
```

---

## Task 9: Wire collection into state load + surface the reveal

**Files:**
- Modify: `infrastructure/lambda/undercity_db.py` (`handle_state` player-loop; state `umori` block)
- Test: `infrastructure/lambda/tests/test_undercity_db.py`

- [ ] **Step 1: Write the failing test**:

```python
def test_state_settles_closed_auction_and_reveals(table, monkeypatch):
    sid, node = _join_on_umori(table, 'user-alex', 'Alex')
    win = db._umori_window()
    monkeypatch.setattr(db, '_roll_umori_box',
                        lambda w, r, under_reserve: {'kind': 'materials',
                                                     'ichor': 1, 'moltings': 2})
    # Alex has an un-collected winning bid in the PRIOR (closed) window.
    doc = db._get_player(table, sid, 'user-alex')
    doc['spores'] = 100
    doc['umoriBidWindow'] = win - 1
    doc['umoriBidAmount'] = data.UMORI_RESERVES[1] + 5
    db._put_player(table, doc)
    table.put_item(Item={'pk': db._season_pk(sid),
                         'sk': f'POST#UMORI#{win - 1}#BID#user-alex',
                         'amount': data.UMORI_RESERVES[1] + 5, 'username': 'Alex',
                         'ts': '2026-01-01T00:00:00.000'})
    _, state = db.handle_state(table, {'userId': 'user-alex'})
    assert state['umori']['reveal']['placed'] == 1
    assert state['umori']['reveal']['reward']['kind'] == 'materials'
    # Durable: the materials landed and the window is marked collected.
    doc2 = db._get_player(table, sid, 'user-alex')
    assert doc2['materials']['ichor'] >= 1
    assert doc2['umoriCollectedWindow'] == win - 1
    # A second state read does not re-reveal.
    _, state2 = db.handle_state(table, {'userId': 'user-alex'})
    assert 'reveal' not in state2['umori']
```

- [ ] **Step 2: Run test to verify it fails**

Run: `python -m pytest tests/test_undercity_db.py::test_state_settles_closed_auction_and_reveals -v`
Expected: FAIL (`KeyError: 'reveal'`)

- [ ] **Step 3: Collect in the player loop.** In `handle_state`, the requesting player's branch (~2209-2211) currently reads:

```python
            if item['userId'] == user_id:
                you = {k: v for k, v in item.items() if k not in ('pk', 'sk')}
                you.update(_roll_meta(item))
```
Insert the collect call so it mutates+persists the real `item` BEFORE `you` is built from it, and stash the reveal:

```python
            if item['userId'] == user_id:
                umori_reveal = _collect_umori(table, sid, item)  # settle closed auctions
                you = {k: v for k, v in item.items() if k not in ('pk', 'sk')}
                you.update(_roll_meta(item))
```

Initialize `umori_reveal = None` alongside the other accumulators (~line 2199, where `players, you, ... = ...` is set):

```python
    players, you, snares, result, posts, sites = [], None, [], None, {}, {}
    veins, vaults, shops = {}, {}, {}
    umori_reveal = None
    now = _now()
```

- [ ] **Step 4: Attach the reveal to the umori block.** Change the block written in Task 4 Step 8 to append the reveal when present:

```python
        'umori': {'node': umori_node, 'movesAt': _umori_window_end(umori_win),
                  'minBid': data.UMORI_MIN_BID, 'reserves': data.UMORI_RESERVES,
                  'yourBid': (you.get('umoriBidAmount', 0)
                              if you and you.get('umoriBidWindow') == umori_win else 0),
                  **({'reveal': umori_reveal} if umori_reveal else {})},
```

- [ ] **Step 5: Run test to verify it passes**

Run: `python -m pytest tests/test_undercity_db.py::test_state_settles_closed_auction_and_reveals -v`
Expected: PASS

- [ ] **Step 6: Full suite + confirm the enraged-overlap regression still holds**

Run: `python -m pytest tests -q`
Expected: PASS (including `test_enraged_node_avoids_umori` after the dwell change)

- [ ] **Step 7: Commit**

```bash
git add infrastructure/lambda/undercity_db.py infrastructure/lambda/tests/test_undercity_db.py
git commit -m "feat(undercity): settle closed auctions on state read + reveal"
```

---

## Task 10: Client models

No frontend test runner exists — client tasks verify via `npm run build:prod` (from repo root) and the run-undercity skill.

**Files:**
- Modify: `src/app/undercity/services/undercity-models.ts`

- [ ] **Step 1: Replace the `umori` state shape** (~line 322-323). Find:

```typescript
  /** ... `traded` is true once the requesting player has spent this rotation's one barter. */
  umori?: { node: string; movesAt: string; traded?: boolean };
```
Replace with:

```typescript
  /** Umori the collector's sealed auction for the current wander window. `reserves`
   *  keys are ranks ("1"|"2"|"3") → the min winning bid to unlock that box's rich
   *  table. `yourBid` is the requesting player's live escrowed bid this window (0 if
   *  none). `reveal` appears on the ONE state read that settles a just-closed
   *  auction the player bid in. */
  umori?: {
    node: string;
    movesAt: string;
    minBid: number;
    reserves: Record<string, number>;
    yourBid: number;
    reveal?: UmoriReveal;
  };
```

- [ ] **Step 2: Add the box/reveal types** near the other Umori types (after the old `TradeStockItem`/`TradeOffer` interfaces, ~line 522):

```typescript
/** One reward pulled from an auction box. */
export interface UmoriBoxReward {
  kind: 'gear' | 'grimoire' | 'egg' | 'consumable' | 'materials';
  item?: string;
  tier?: number;
  ichor?: number;
  moltings?: number;
  outcome?: 'equipped' | 'stashed' | 'stored' | 'pending';
}

/** The settlement of a closed auction the player bid in. `placed` is their rank
 *  (1-3) or null when they were outbid (4th+) and refunded. */
export interface UmoriReveal {
  window: number;
  placed: number | null;
  boxName?: string;
  reward?: UmoriBoxReward;
  refund?: number;
}
```

- [ ] **Step 3: Update the space-event payload.** The land-event object (`SpaceEvent`) previously carried `stock?: TradeStockItem[]` for Umori (~line 700 and ~817). Add the auction fields alongside (leave `stock?` — other trading posts may still use it; grep to confirm) :

```typescript
  umori?: boolean;
  minBid?: number;
  reserves?: Record<string, number>;
  yourBid?: number;
```

Run: `grep -rn "TradeStockItem\|TradeOffer\|\.stock" src/app/undercity` — if Umori was the only consumer, mark the barter types `@deprecated` but leave them to avoid ripple; if genuinely unused elsewhere, delete them.

- [ ] **Step 4: Build to verify types compile**

Run (repo root): `npm run build:prod`
Expected: build succeeds (no TS errors from the model change).

- [ ] **Step 5: Commit**

```bash
git add src/app/undercity/services/undercity-models.ts
git commit -m "feat(undercity): client models for Umori auction + reveal"
```

---

## Task 11: Client bid panel (replace the barter modal)

**Files:**
- Modify: `src/app/undercity/tabs/board-tab.component.ts`
- Modify: `src/app/undercity/tabs/board-tab.component.html`

- [ ] **Step 1: Replace the trade computed/methods in the TS.** Find `umoriTraded` (~line 373) and the trade helpers (`qualifyingGiveOffers`, `tradeStockDetail`, `tradeReason`, `canTradeFor`, `canUseGive`, `trade`, and the `tradingStock`/`giveOpenFor` signals ~368-372, ~974+). Replace the block with an auction bid model:

```typescript
  /** Umori auction: the player's chosen bid amount in the modal input. */
  protected readonly bidAmount = signal<number>(0);
  /** Live auction snapshot from the store (null when Umori isn't this tile). */
  protected readonly umoriAuction = computed(() => this.store.umori());
  /** The player's current escrowed bid this window (0 if none). */
  protected readonly yourBid = computed(() => this.umoriAuction()?.yourBid ?? 0);
  /** Reserve rows for the modal, rank 1→3 with their unlock thresholds. */
  protected reserveRows(): { rank: number; name: string; reserve: number }[] {
    const res = this.umoriAuction()?.reserves ?? {};
    const names: Record<number, string> = { 1: 'Gilded Coffer', 2: 'Curio Box', 3: 'Trinket Pouch' };
    return [1, 2, 3].map((r) => ({ rank: r, name: names[r], reserve: Number(res[r] ?? 0) }));
  }
  /** Why the bid button is blocked (mirrors the server guards), or null when live. */
  protected bidReason(): string | null {
    const a = this.umoriAuction();
    if (!a) return 'Umori is not here';
    const amt = this.bidAmount();
    if (amt < a.minBid) return `Bids start at ${a.minBid} Spores`;
    if (amt <= this.yourBid()) return `Raise above your current ${this.yourBid()} Spores`;
    const delta = amt - this.yourBid();
    if ((this.store.you()?.spores ?? 0) < delta) return 'Not enough Spores';
    return null;
  }
  protected canBid(): boolean {
    return !this.busy() && this.bidReason() === null;
  }
  /** Seal (or raise) the bid. */
  protected async placeBid(): Promise<void> {
    if (!this.canBid()) return;
    await this.run(async () => {
      const resp = await this.store.action('umori-bid', { amount: this.bidAmount() });
      this.showToast(resp.text ?? 'Bid sealed.');
    });
  }
```

Notes for the implementer: `this.run(async () => …)` is the component's existing busy-wrapper (see `tapBoardPet`/`use-pet-ability` at ~line 308); `busy` (signal, line 241), `showToast`, and `store.you()`/`store.action()` all already exist. Remove the now-dead `TradeOffer`/`TradeStockItem` imports (~line 37-38) if nothing else references them.

- [ ] **Step 2: Replace the barter modal HTML.** In `board-tab.component.html`, find the Umori section (the `@if (umoriTraded())` block through the give-picker + `confirm-trade` button, ~842-915). Replace with a bid panel:

```html
        <div class="shop-section">Umori's sealed auction</div>
        <p class="umori-blurb">
          Seal a Spore bid. When Umori wanders on, the top three bidders each pull a
          ranked mystery box — you never know quite what the collector hoards.
        </p>
        <ul class="umori-reserves">
          @for (row of reserveRows(); track row.rank) {
            <li><span class="rank">#{{ row.rank }}</span> {{ row.name }}
              <span class="reserve">unlocks at {{ row.reserve }}</span></li>
          }
        </ul>
        @if (yourBid() > 0) {
          <p class="umori-yourbid">Your sealed bid: <strong>{{ yourBid() }}</strong> Spores</p>
        }
        <div class="umori-bid-row">
          <input type="number" class="umori-bid-input" [min]="umoriAuction()?.minBid ?? 0"
                 [value]="bidAmount()"
                 (input)="bidAmount.set(+$any($event.target).value)"
                 [disabled]="busy()" aria-label="Bid amount in Spores" />
          <button class="uc-btn shop-buy" [disabled]="!canBid()" (click)="placeBid()">
            {{ yourBid() > 0 ? 'Raise bid' : 'Seal bid' }}
          </button>
        </div>
        @if (!busy() && bidReason(); as r) { <span class="block-reason">{{ r }}</span> }
```

This uses a plain `[value]`/`(input)` binding (no `FormsModule`/`ngModel` dependency to add).

- [ ] **Step 3: Build to verify it compiles**

Run (repo root): `npm run build:prod`
Expected: build succeeds.

- [ ] **Step 4: Manual verify with the run-undercity skill.** Launch the app, reach Umori's tile (dev/admin can teleport), open the modal, place a bid, confirm Spores drop and the button flips to "Raise bid."

- [ ] **Step 5: Commit**

```bash
git add src/app/undercity/tabs/board-tab.component.ts src/app/undercity/tabs/board-tab.component.html
git commit -m "feat(undercity): Umori bid panel replaces barter modal"
```

---

## Task 12: Client reveal modal

**Files:**
- Modify: `src/app/undercity/tabs/board-tab.component.ts`
- Modify: `src/app/undercity/tabs/board-tab.component.html`

- [ ] **Step 1: Add reveal state + an effect that pops it from state.** In the TS, add:

```typescript
  /** The auction settlement to celebrate (null when nothing to show). */
  protected readonly umoriReveal = signal<UmoriReveal | null>(null);

  /** Human phrase for what a reveal reward was. */
  protected revealRewardText(rev: UmoriReveal): string {
    if (rev.placed === null) return `Outbid — ${rev.refund} Spores refunded.`;
    const rw = rev.reward;
    if (!rw) return 'An empty box?';
    if (rw.kind === 'materials') {
      const parts: string[] = [];
      if (rw.ichor) parts.push(`${rw.ichor} Gemstones`);
      if (rw.moltings) parts.push(`${rw.moltings} Moltings`);
      return parts.join(' + ') || 'a puff of dust';
    }
    if (rw.kind === 'egg') return `a tier-${rw.tier} companion egg`;
    if (rw.kind === 'gear') return `${GEAR_MAP[rw.item!]?.name ?? rw.item} (gear)`;
    if (rw.kind === 'grimoire') return `${rw.item} (grimoire)`;
    return `a ${rw.item}`;
  }
  protected closeReveal(): void { this.umoriReveal.set(null); }
```

Then **register the reveal effect in the constructor**, alongside the existing `effect(() => …)` blocks (~line 1405+) — not as a class-field initializer:

```typescript
    // Surface the one-shot auction reveal the server attaches when a closed
    // auction settles on a state read.
    effect(() => {
      const rev = this.store.umori()?.reveal;
      if (rev) this.umoriReveal.set(rev);
    });
```

`effect` is already imported from `@angular/core` (line 9). Add `UmoriReveal` to the model-type import at the top of the file. `GEAR_MAP` is already imported (used by bird-scout / `gearMapRef`).

- [ ] **Step 2: Add the reveal modal HTML** near the other modals (e.g., after the space modal block):

```html
@if (umoriReveal(); as rev) {
  <div class="uc-modal-backdrop" (click)="closeReveal()">
    <div class="uc-modal umori-reveal" (click)="$event.stopPropagation()">
      <h3>Umori's auction closed</h3>
      @if (rev.placed === null) {
        <p>You were outbid. <strong>{{ rev.refund }}</strong> Spores refunded.</p>
      } @else {
        <p>You placed <strong>#{{ rev.placed }}</strong> — {{ rev.boxName }}!</p>
        <p class="reveal-reward">Inside: {{ revealRewardText(rev) }}</p>
      }
      <button class="uc-btn" (click)="closeReveal()">Nice</button>
    </div>
  </div>
}
```

(Reuse existing `uc-modal-backdrop`/`uc-modal` classes for styling consistency.)

- [ ] **Step 3: Build**

Run (repo root): `npm run build:prod`
Expected: build succeeds.

- [ ] **Step 4: Manual verify.** Simulate a closed-window win (admin bid + advance) and confirm the reveal modal appears once and dismisses.

- [ ] **Step 5: Commit**

```bash
git add src/app/undercity/tabs/board-tab.component.ts src/app/undercity/tabs/board-tab.component.html
git commit -m "feat(undercity): Umori auction reveal modal"
```

---

## Task 13: Full verification

- [ ] **Step 1: Backend suite green**

Run: `cd infrastructure/lambda && python -m pytest tests -q`
Expected: all PASS (no `_trade`/barter references remain).

- [ ] **Step 2: Grep for dead references**

Run: `grep -rn "umoriTraded\|_umori_stock\|_umori_barter_stock\|UMORI_STOCK_SPEC\|UMORI_GEAR_SLOTS\|takeIndex" infrastructure/lambda src/app/undercity`
Expected: no matches (all removed/replaced).

- [ ] **Step 3: Production build**

Run (repo root): `npm run build:prod`
Expected: build succeeds; `docs/` regenerated.

- [ ] **Step 4: Commit any final cleanup**

```bash
git add -A
git commit -m "chore(undercity): finalize Umori auction rework"
```

---

## Notes & deferred

- **Refinement vs spec — resolution:** the design doc (§4.4) described persisting `results` under a conditional write so concurrent resolvers converge. The plan instead recomputes results as a **pure function of the stored bids** (`_umori_results`) — no results record, no conditional write. Because ranking and box rolls are fully deterministic, every caller gets the identical outcome, so this is idempotent by construction and simpler. Nothing is persisted at resolution except each player's own settled doc (on their pull).
- **Refinement vs spec — stash overflow:** the design (§4.8/§6) said full-stash gear "auto-lists on the Player Market." The plan instead routes box gear through the standard `_gain_gear`/`_acquire` path, which **parks overflow to `pendingPickups`** (the existing pickup modal) — consistent with every other gear grant in the game, and resolvable from anywhere. Same "never lost" guarantee, one fewer bespoke path.
- **Benign early-persist:** in Task 9 the state-read collect calls `_put_player` only when an auction actually settles (else it returns early). On that rare read it also persists the display-only HP/roll regen a hair early — harmless (regen is a legitimate state), noted so it isn't mistaken for a bug.
- **Bid-record cleanup:** old-window `POST#UMORI#{w}#BID#*` items are never deleted. They're tiny and bounded (players × windows); a season reset clears them. Sweeping them is deferred.
- **Duplicate grimoire in a box:** if a winner already owns the rolled grimoire, they keep their copy and the reveal still shows the grimoire but no new item lands (minor dead-reward edge). Acceptable for v1; revisit if it feels bad.
- **Reveal is best-effort:** the celebratory popup rides one state response; the reward/refund is durable regardless. A missed popup (rare race) loses only the animation, not the loot.
- **Balance pass:** all numbers (dwell, reserves, box weights, materials amounts) are starting points — dial with the tune-undercity-balance skill after playtest. Update the client `data/undercity-*.ts` mirrors if any of these move into a client-read constant.
- **Client mirrors:** box display names are duplicated in `reserveRows()`; if they drift, centralize into `src/app/undercity/data/*.ts` mirroring `UMORI_BOX_NAMES`.
