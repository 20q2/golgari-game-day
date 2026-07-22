# Umori, the Wandering Trading Post — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Turn the fixed trading post into Umori, an ooze NPC that wanders the wilderness on a 2-hour clock, is drawn on the board with a hop animation + move-countdown, and opens a T3 gear/grimoire barter when landed on.

**Architecture:** Umori's location and stock are pure functions of a wall-clock window (mirrors the bazaar `_shop_window` pattern) — no server tick. Space resolution overlays a trading post onto the current window's wilderness node; the static `isl_trade` post is retired. The client draws Umori on the live canvas layer (not the static terrain prerender).

**Tech Stack:** Python 3.11 Lambda + in-memory FakeTable pytest suite; Angular 20 standalone components; a canvas board engine (`board-canvas.ts`).

Design: [specs/2026-07-21-undercity-umori-wandering-post-design.md](2026-07-21-undercity-umori-wandering-post-design.md)

**Convention note (from CLAUDE.md):** `undercity_data.py` does `from undercity_config import *`, so config scalars are reachable as `data.<NAME>` from `undercity_db.py`. In `undercity_db.py`, the bare name `config` is a season-config dict, not the module — reference tunables via `data.`.

**Parallel-WIP note:** these files may have concurrent uncommitted edits. Before each commit, `git status` and stage only this task's hunks (use `git apply --cached` on a filtered diff if a file is entangled). Do not sweep unrelated WIP into a commit; do not "fix" failures in files this plan doesn't touch.

---

## Task 1: Config, data tables, and the pure window/node/stock helpers

**Files:**
- Modify: `infrastructure/lambda/undercity_config.py`
- Modify: `infrastructure/lambda/undercity_data.py`
- Modify: `infrastructure/lambda/undercity_db.py` (add helpers near `_shop_window`)
- Test: `infrastructure/lambda/tests/test_undercity_db.py`

- [ ] **Step 1: Add the dwell knob to `undercity_config.py`**

After `BAZAAR_BLACKMARKET_CHANCE` (near the `SHOP_*` block):

```python
# Umori, the wandering trading post: minutes it dwells at one wilderness node
# before hopping to a new random one. Location/stock are pure functions of this
# window (see undercity_db._umori_window) — no server tick.
UMORI_DWELL_MIN = 120
```

- [ ] **Step 2: Add the node pool + stock spec to `undercity_data.py`**

Near the bazaar-tier block (after `ISLAND_BAZAAR_NODES`):

```python
# Umori barter seed per move: this many distinct-slot T3 gear pieces + this many
# T3 grimoires (all tier 3 — the endgame payoff for reaching the wandering post).
UMORI_STOCK_SPEC = {'gear': 2, 'grimoire': 1}
```

Then, immediately after the `MAP_NODES = {...}` line (so the map is loaded):

```python
# Wilderness nodes Umori can wander to (stable insertion order from map.json →
# deterministic picks). Recomputed from the map, so it tracks edits.
UMORI_NODES = [nid for nid, n in MAP_NODES.items() if n.get('region') == 'wilderness']
```

- [ ] **Step 3: Write the failing tests**

Add to `tests/test_undercity_db.py`, just below the bazaar tests:

```python
# ── Umori: the wandering trading post ────────────────────────────────────────

def test_umori_window_math():
    base = datetime(2026, 7, 21, 12, 0, 0)
    w = db._umori_window(base)
    assert db._umori_window(base + timedelta(minutes=90)) == w          # same 2h window
    assert db._umori_window(base + timedelta(minutes=121)) == w + 1      # next window
    assert db._umori_window_end(w) > base.isoformat(timespec='seconds')


def test_umori_node_is_deterministic_wilderness():
    for w in range(0, 50):
        node = db._umori_node(w)
        assert node in data.UMORI_NODES
        assert data.MAP_NODES[node]['region'] == 'wilderness'
        assert db._umori_node(w) == node                                # stable per window
    # It actually wanders (not pinned to one node across windows).
    assert len({db._umori_node(w) for w in range(0, 50)}) > 1


def test_umori_stock_is_all_t3_and_deterministic():
    for w in range(0, 30):
        stock = db._umori_stock(w)
        assert len(stock) == data.UMORI_STOCK_SPEC['gear'] + data.UMORI_STOCK_SPEC['grimoire']
        gears = [s['item'] for s in stock if s['item'] in data.GEAR]
        tomes = [s['item'] for s in stock if s['item'] in data.GRIMOIRES]
        assert len(gears) == data.UMORI_STOCK_SPEC['gear']
        assert len(tomes) == data.UMORI_STOCK_SPEC['grimoire']
        assert all(data.GEAR[g]['tier'] == 3 for g in gears)
        assert all(data.GRIMOIRES[t]['tier'] == 3 for t in tomes)
        assert len({data.GEAR[g]['slot'] for g in gears}) == len(gears)  # distinct slots
    assert db._umori_stock(5) == db._umori_stock(5)
```

- [ ] **Step 4: Run the tests to verify they fail**

Run: `cd infrastructure/lambda && python -m pytest tests/test_undercity_db.py -k umori -q`
Expected: FAIL — `AttributeError: module 'undercity_db' has no attribute '_umori_window'`.

- [ ] **Step 5: Add the helpers to `undercity_db.py`**

Right after `_shop_window_end` (before `_gen_shop_stock`):

```python
def _umori_window(now=None):
    """Which 2-hour window Umori's location/stock belong to. Pure function of the
    wall clock — every client computes the same value (no server tick)."""
    now = now or datetime.utcnow()
    secs = int((now - _EPOCH).total_seconds())
    return secs // (data.UMORI_DWELL_MIN * 60)


def _umori_window_end(window):
    """ISO timestamp Umori next hops (the client's countdown target)."""
    end = _EPOCH + timedelta(seconds=(window + 1) * data.UMORI_DWELL_MIN * 60)
    return end.isoformat(timespec='seconds')


def _umori_node(window):
    """Deterministic wilderness node Umori occupies this window (stable hash)."""
    rng = random.Random(zlib.crc32(f'umori:{window}'.encode()))
    return rng.choice(data.UMORI_NODES)


def _umori_stock(window):
    """Fresh T3 barter seed for a window: distinct-slot T3 gear + T3 grimoires."""
    rng = random.Random(zlib.crc32(f'umori-stock:{window}'.encode()))
    by_slot = {}
    for gid, g in data.GEAR.items():
        if g['tier'] == 3:
            by_slot.setdefault(g['slot'], []).append(gid)
    slots = list(by_slot)
    rng.shuffle(slots)
    picks = [rng.choice(by_slot[s]) for s in slots[:data.UMORI_STOCK_SPEC['gear']]]
    tomes = [gid for gid, gr in data.GRIMOIRES.items() if gr['tier'] == 3]
    rng.shuffle(tomes)
    picks += tomes[:data.UMORI_STOCK_SPEC['grimoire']]
    return [{'item': i, 'foundBy': 'the Swarm'} for i in picks]
```

- [ ] **Step 6: Run the tests to verify they pass**

Run: `cd infrastructure/lambda && python -m pytest tests/test_undercity_db.py -k umori -q`
Expected: PASS (3 tests).

- [ ] **Step 7: Full suite stays green**

Run: `cd infrastructure/lambda && python -m pytest tests -q`
Expected: PASS (additive change; nothing else affected).

- [ ] **Step 8: Commit**

```bash
git add infrastructure/lambda/undercity_config.py infrastructure/lambda/undercity_data.py infrastructure/lambda/undercity_db.py infrastructure/lambda/tests/test_undercity_db.py
git commit -m "feat(undercity): Umori window/node/stock helpers (clock-derived)"
```

---

## Task 2: Space resolution overlay + state exposure (additive)

**Files:**
- Modify: `infrastructure/lambda/undercity_db.py` (`_resolve_space` ~2100, `handle_state` ~1139, add `_umori_barter_stock`)
- Test: `infrastructure/lambda/tests/test_undercity_db.py`

This task is additive: the static `isl_trade` post still works, so existing trading-post tests stay green. Task 3 flips the switch.

- [ ] **Step 1: Write the failing tests**

Add to the Umori section of `tests/test_undercity_db.py`:

```python
def test_resolve_on_umori_node_opens_a_trading_post(table):
    act(table, 'join', starter='pest')
    sid = _sid(table)
    doc = db._get_player(table, sid, 'user-alex')
    win = db._umori_window()
    node = db._umori_node(win)
    ev = db._resolve_space(table, sid, doc, node, doc.get('position'))
    assert ev['type'] == 'trading_post' and ev['umori'] is True
    assert ev['node'] == node
    assert ev['movesAt'] == db._umori_window_end(win)
    # Stock is the T3 seed for this window.
    assert [s['item'] for s in ev['stock']] == [s['item'] for s in db._umori_stock(win)]


def test_state_surfaces_umori(table):
    act(table, 'join', starter='pest')
    _, state = db.handle_state(table, {'userId': 'user-alex'})
    win = db._umori_window()
    assert state['umori']['node'] == db._umori_node(win)
    assert state['umori']['movesAt'] == db._umori_window_end(win)
    # Display stock is seeded for the current Umori node.
    assert state['tradingPosts'][db._umori_node(win)]
```

- [ ] **Step 2: Run the tests to verify they fail**

Run: `cd infrastructure/lambda && python -m pytest tests/test_undercity_db.py -k "umori_node_opens or surfaces_umori" -q`
Expected: FAIL — `KeyError: 'umori'` / `ev['type']` is the node's normal type.

- [ ] **Step 3: Add `_umori_barter_stock` to `undercity_db.py`**

Next to `_trading_post_stock` (~3706):

```python
def _umori_barter_stock(table, sid, window):
    """Intra-window barter state for Umori (POST#UMORI#<window>); a fresh T3 seed
    when nobody has traded yet this window. A stale window is ignored → reset."""
    rec = _get(table, _season_pk(sid), f'POST#UMORI#{window}')
    if rec and rec.get('stock'):
        return rec['stock']
    return _umori_stock(window)
```

- [ ] **Step 4: Overlay the trading post in `_resolve_space`**

In `_resolve_space`, right after the `lastBiome` block (after line ~2110, before the type dispatch):

```python
    # Umori the wandering ooze pacifies whatever wilderness space it sits on this
    # window and opens a T3 barter (overrides the node's normal event).
    _uwin = _umori_window()
    if node == _umori_node(_uwin):
        return {'type': 'trading_post', 'node': node, 'umori': True,
                'movesAt': _umori_window_end(_uwin),
                'text': 'Umori the ooze has oozed up a crooked stall here. Leave one, take one.',
                'stock': _umori_barter_stock(table, sid, _uwin)}
```

- [ ] **Step 5: Expose `umori` + seed display stock in `handle_state`**

In `handle_state`, just before the big return dict (near the seed loops ~1107), add:

```python
    umori_win = _umori_window()
    umori_node = _umori_node(umori_win)
    posts[umori_node] = _umori_barter_stock(table, sid, umori_win)  # display-seed
```

Then add one key to the returned dict (after `'tradingPosts': posts,`):

```python
        'umori': {'node': umori_node, 'movesAt': _umori_window_end(umori_win)},
```

- [ ] **Step 6: Run the tests to verify they pass**

Run: `cd infrastructure/lambda && python -m pytest tests/test_undercity_db.py -k "umori_node_opens or surfaces_umori" -q`
Expected: PASS.

- [ ] **Step 7: Full suite stays green**

Run: `cd infrastructure/lambda && python -m pytest tests -q`
Expected: PASS (static `isl_trade` still resolves as before for the existing trading-post tests).

- [ ] **Step 8: Commit**

```bash
git add infrastructure/lambda/undercity_db.py infrastructure/lambda/tests/test_undercity_db.py
git commit -m "feat(undercity): overlay Umori trading post on the board + surface in state"
```

---

## Task 3: Barter on the Umori node, retire `isl_trade`, migrate tests

**Files:**
- Modify: `infrastructure/lambda/undercity_db.py` (`_trade` ~3738, remove dead static `trading_post` branch ~2185)
- Modify: `infrastructure/lambda/map.json` (retype `isl_trade`)
- Regenerate: `public/data/undercity-map.json`
- Modify: `infrastructure/lambda/tests/test_map.py` (distribution), `tests/test_undercity_db.py` (replace `test_trading_post_*`)

- [ ] **Step 1: Point `_trade` at the Umori node + give-side rule**

In `_trade`, replace the location guard:

```python
    nodes = _season_map(table, sid)
    node = doc.get('position')
    if nodes.get(node, {}).get('type') != 'trading_post':
        return _err('You are not at a trading post.', 409)
```
with:
```python
    node = doc.get('position')
    win = _umori_window()
    if node != _umori_node(win):
        return _err('Umori is not here.', 409)
```

Immediately after `give_kind = _item_kind(give)` and its `None` guard, add the give-side rule:

```python
    if give_kind == 'consumable':
        return _err('Umori only trades in gear and grimoires.', 409)
```

Change the stock read from:
```python
    stock = _trading_post_stock(table, sid, node)
```
to:
```python
    stock = _umori_barter_stock(table, sid, win)
```

Change the save near the end from:
```python
    _save_trading_post(table, sid, node, stock)  # then the shared stock
```
to:
```python
    table.put_item(Item={'pk': _season_pk(sid), 'sk': f'POST#UMORI#{win}', 'stock': stock})
```

- [ ] **Step 2: Remove the dead static branch in `_resolve_space`**

Delete the now-unreachable static block (no node is type `trading_post` after Step 4):

```python
    if ntype == 'trading_post':
        return {'type': 'trading_post', 'node': node,
                'text': 'A crooked stall of swapped oddments. Leave one, take one.',
                'stock': _trading_post_stock(table, sid, node)}
```

- [ ] **Step 3: Retype `isl_trade` in `map.json` + sync**

In `infrastructure/lambda/map.json`, find the `isl_trade` node and change its type:
```
   "id": "isl_trade",
   "type": "trading_post",
```
to
```
   "id": "isl_trade",
   "type": "mystery",
```
Then run: `cd infrastructure/lambda && python sync_map.py`
Expected: prints the copy line.

- [ ] **Step 4: Update the map distribution test**

In `tests/test_map.py::test_space_type_distribution`, add a `v15` comment line and change the counts: `mystery` 11→12 and remove the `trading_post` entry:

```python
    # v15 (2026-07-21 Umori): isl_trade retyped trading_post->mystery; the trading
    # post is now the wandering Umori (no static node). mystery 11->12, trading_post
    # removed. See specs/2026-07-21-undercity-umori-wandering-post-design.md.
    assert counts == {
        'gate': 5, 'loot': 44, 'wild': 66, 'elite': 28, 'shop': 6, 'mystery': 12,
        'hazard': 45, 'warp': 5, 'shrine': 1, 'ladder': 15, 'lair': 6,
        'ossuary': 1, 'boss': 1, 'barrier': 2, 'vault': 1,
        'excavation': 4, 'cache': 6, 'crystal_vein': 4, 'vault_lock': 1,
        'rest': 5, 'trove': 5, 'tunnel': 10,
    }
```

- [ ] **Step 5: Replace the `test_trading_post_*` suite with Umori barter tests**

In `tests/test_undercity_db.py`, delete all `test_trading_post_*` functions (they place a unit on `isl_trade` and use consumable-seed stock, both obsolete) and add this focused suite in the Umori section. Helper first:

```python
def _stand_on_umori(table):
    """Join and move the player onto the current Umori node. Returns (sid, doc, node)."""
    act(table, 'join', starter='pest')
    sid = _sid(table)
    doc = db._get_player(table, sid, 'user-alex')
    node = db._umori_node(db._umori_window())
    doc['position'] = node
    db._put_player(table, doc)
    return sid, doc, node


def test_umori_pre_seeds_t3_stock(table):
    sid, doc, node = _stand_on_umori(table)
    ev = db._resolve_space(table, sid, doc, node, 'somewhere')
    assert ev['type'] == 'trading_post' and ev['umori'] is True
    for s in ev['stock']:
        defn = data.GEAR.get(s['item']) or data.GRIMOIRES[s['item']]
        assert defn['tier'] == 3


def test_umori_swap_gear(table):
    sid, doc, node = _stand_on_umori(table)
    win = db._umori_window()
    # Seed a known stock line and give a piece of gear the player owns.
    take_gear = next(g for g in data.GEAR if data.GEAR[g]['tier'] == 3)
    table.put_item(Item={'pk': db._season_pk(sid), 'sk': f'POST#UMORI#{win}',
                         'stock': [{'item': take_gear, 'foundBy': 'the Swarm'}]})
    give = next(g for g, v in data.GEAR.items() if v['slot'] == data.GEAR[take_gear]['slot'])
    doc['gear'] = {data.GEAR[give]['slot']: give}
    db._put_player(table, doc)
    status, resp = act(table, 'trade', give=give, takeIndex=0)
    assert status == 200
    assert resp['you']['gear'][data.GEAR[take_gear]['slot']] == take_gear


def test_umori_rejects_consumable_give(table):
    sid, doc, node = _stand_on_umori(table)
    doc['bag'] = ['healing_moss']
    db._put_player(table, doc)
    status, resp = act(table, 'trade', give='healing_moss', takeIndex=0)
    assert status == 409 and 'gear and grimoires' in resp['error']


def test_umori_rejects_trade_when_not_on_node(table):
    act(table, 'join', starter='pest')
    sid = _sid(table)
    doc = db._get_player(table, sid, 'user-alex')
    # Force the player onto a node that is NOT the Umori node.
    other = next(n for n in data.UMORI_NODES if n != db._umori_node(db._umori_window()))
    doc['position'] = other
    db._put_player(table, doc)
    status, resp = act(table, 'trade', give='rusted_fang', takeIndex=0)
    assert status == 409 and 'Umori is not here' in resp['error']
```

- [ ] **Step 6: Run the Umori + map tests**

Run: `cd infrastructure/lambda && python -m pytest tests/test_undercity_db.py -k umori tests/test_map.py -q`
Expected: PASS.

- [ ] **Step 7: Full suite stays green**

Run: `cd infrastructure/lambda && python -m pytest tests -q`
Expected: PASS (0 failures). If `_trading_post_stock`/`_seed_stock`/`_save_trading_post` are now unreferenced, that is fine — leave them (harmless dead code) to keep the diff focused.

- [ ] **Step 8: Commit**

```bash
git add infrastructure/lambda/undercity_db.py infrastructure/lambda/map.json public/data/undercity-map.json infrastructure/lambda/tests/test_map.py infrastructure/lambda/tests/test_undercity_db.py
git commit -m "feat(undercity): barter at wandering Umori; retire static isl_trade post"
```

---

## Task 4: Client state plumbing + "Find Umori" button

**Files:**
- Modify: `src/app/undercity/services/undercity-models.ts` (game-state model)
- Modify: `src/app/undercity/services/undercity-state.service.ts` (add `umori` signal — mirror `bazaars`)
- Modify: `src/app/undercity/tabs/board-tab.component.ts` and `.html` (pass to board; Find-Umori button)

Frontend has no unit runner; verification is the prod build in Task 6.

- [ ] **Step 1: Add `umori` to the state model**

In `undercity-models.ts`, add to the top-level game-state interface (next to `bazaars`/`tradingPosts`):

```typescript
  /** The wandering trading post's current node + when it next hops (ISO, UTC no suffix). */
  umori?: { node: string; movesAt: string };
```

- [ ] **Step 2: Expose a `umori` signal on the store**

In `undercity-state.service.ts`, find the `bazaars` signal and its assignment in the state-ingest path, and add a parallel `umori` signal set from `state.umori ?? null`. Follow the exact pattern used for `bazaars` (same signal declaration style and the same place it is updated on each poll).

- [ ] **Step 3: Feed Umori to the board canvas**

In `board-tab.component.ts`, find where the board is updated each poll (where `this.board?.setPlayers(...)` is called) and add alongside it:

```typescript
    this.board?.setUmori(this.store.umori());
```

(The `setUmori` method is added in Task 5, Step 1. TypeScript will error until then — that is expected; the two tasks compile together at Task 6.)

- [ ] **Step 4: Add the "Find Umori" button**

In `board-tab.component.html`, near the existing board controls, add a button shown only when Umori is known:

```html
  @if (store.umori(); as u) {
    <button class="uc-map-btn find-umori" (click)="findUmori()" title="Center on Umori">
      <mat-icon class="mi">travel_explore</mat-icon>
    </button>
  }
```

In `board-tab.component.ts`, add the handler (uses the existing `centerOn` camera API):

```typescript
  protected findUmori(): void {
    const u = this.store.umori();
    if (u) this.board?.centerOn(u.node);
  }
```

- [ ] **Step 5: Commit**

```bash
git add src/app/undercity/services/undercity-models.ts src/app/undercity/services/undercity-state.service.ts src/app/undercity/tabs/board-tab.component.ts src/app/undercity/tabs/board-tab.component.html
git commit -m "feat(undercity): plumb Umori into client state + Find Umori button"
```

---

## Task 5: Draw Umori on the board (hop + countdown + tap tooltip)

**Files:**
- Modify: `src/app/undercity/engine/board-canvas.ts`

- [ ] **Step 1: Add the `umori` field + `setUmori` setter**

Near the `setPlayers` method (~525) add a field and setter (place the field with the other private state near the top of the class):

```typescript
  private umori: { node: string; movesAt: string } | null = null;

  setUmori(umori: { node: string; movesAt: string } | null): void {
    this.umori = umori;
  }
```

- [ ] **Step 2: Draw Umori each frame**

Add a `drawUmori(ts: number)` method modeled on `drawGuardian` (the lazy-sprite + `nodeMap` lookup pattern at ~1354) and the player hop (`HOP_HEIGHT`, `this.startTime`). It: looks up `this.nodeMap.get(this.umori.node)`; skips if absent or the node isn't in the active layer; loads `undercity/map_events/shopkeeper3.png` via the existing raw-image loader (`getRawImage`); draws it bobbing (`Math.abs(Math.sin((ts - this.startTime) / 300)) * HOP_HEIGHT`) above the node seat; and draws a countdown string above its head using the same remaining-time math as the client's restock label:

```typescript
  private umoriCountdown(): string {
    if (!this.umori) return '';
    const ms = new Date(this.umori.movesAt + 'Z').getTime() - Date.now();
    const min = Math.max(0, Math.ceil(ms / 60_000));
    if (min >= 60) return `${Math.floor(min / 60)}h ${min % 60}m`;
    return `${min}m`;
  }
```

Call it from `draw(ts)` in the same pass that draws players/guardians (after the player loop ~1021, before `this.drawInfo()` at ~1118) so it composits above terrain but below the tooltip layer:

```typescript
    if (this.umori) this.drawUmori(ts);
```

- [ ] **Step 3: Tap tooltip on the Umori node**

The tap path is `handleTap` → `onTapNode(id)` (the component callback, ~445/932) and tooltips render via `setInfo(NodeInfo)` (~678) → `drawInfo` (~1468). In `board-tab.component.ts`, in the `onTapNode` handler, when the tapped id equals `store.umori()?.node` and it is not a current move choice, show the tooltip:

```typescript
    const u = this.store.umori();
    if (u && tappedId === u.node) {
      this.board?.setInfo({ nodeId: u.node, title: 'Umori', body: `Moves on soon — hurry!` });
      return;
    }
```

(The always-on countdown over Umori's head from Step 2 is the live timer; this tap tooltip is the requested confirming affordance.)

- [ ] **Step 4: Commit**

```bash
git add src/app/undercity/engine/board-canvas.ts src/app/undercity/tabs/board-tab.component.ts
git commit -m "feat(undercity): draw Umori on the board — hop, countdown, tap tooltip"
```

---

## Task 6: Verify end-to-end

**Files:** none (verification only)

- [ ] **Step 1: Full backend suite green**

Run: `cd infrastructure/lambda && python -m pytest tests -q`
Expected: PASS (0 failures).

- [ ] **Step 2: Production build compiles**

Run: `npm run build:prod`
Expected: build succeeds; no TypeScript errors from `setUmori`, the `umori` model/signal, `findUmori`, or the canvas changes.

- [ ] **Step 3: (Optional) drive it in a browser**

Use the `run-undercity` skill: confirm the board shows Umori (hopping shopkeeper-3) on a wilderness node with a countdown, "Find Umori" recenters the camera, tapping shows the tooltip, and landing on that node opens a T3 gear/grimoire barter that rejects giving a consumable.

- [ ] **Step 4: Note for the user**

Deployment is the user's job. End with backend tests green and the prod build clean, and note that a Lambda `cdk deploy` (server-side location/stock) plus a frontend deploy are needed to ship.

---

## Self-review notes

- **Spec coverage:** clock-derived window (Task 1), wilderness-only wander (Task 1 `UMORI_NODES`), space transform/pacify (Task 2), state exposure for board rendering (Task 2), T3 gear+grimoire seed reset per move (Task 1/2), barter on the node + give-side gear/grimoire-only rule (Task 3), retire `isl_trade` (Task 3), board telegraph = hop + countdown + tap tooltip (Task 5), Find-Umori camera button (Task 4). ✅
- **No server tick / no HUD:** honored — position is `_umori_window`-derived; all telegraph is on the board. ✅
- **Determinism:** `_umori_node`/`_umori_stock` are crc32-seeded pure functions; barter mutations persist under `POST#UMORI#<window>` and reset when the window rolls (stale record ignored, mirroring `_shop_stock`). ✅
- **Type consistency:** `umori: { node, movesAt }` is identical across the state dict (Py), the model (TS), the store signal, `setUmori`, and `drawUmori`. `POST#UMORI#<window>` is the single record key used by `_umori_barter_stock`, the `_trade` save, and the display-seed.
- **Green-per-task:** Task 2 is additive (static post still works); Task 3 flips the static→wandering switch and migrates the map/tests in the same commit so the suite is green at each task boundary.
