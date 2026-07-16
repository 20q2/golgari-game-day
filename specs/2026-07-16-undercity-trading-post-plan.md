# Trading Post gear/grimoire swaps + visual polish — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Let players offer gear and grimoires (not just bag consumables) at the Trading Post, and bring the modal's visual quality up to the Bazaar's bar.

**Architecture:** The backend already stores trading-post stock as a flat list of `{item, foundBy}` — item kind (consumable/gear/grimoire) is inferable from which catalog dict (`CONSUMABLES`/`GEAR`/`GRIMOIRES`) the id belongs to, since ids are disjoint across all three. `_trade` gets kind-aware give/take branches; no wire format changes. The client builds a combined "offerable items" list (bag + equipped gear + owned grimoires) and renders it with the same `shop-row`/`shop-section` styling the Bazaar modal already uses.

**Tech Stack:** Python 3.11 Lambda (pytest FakeTable suite in `infrastructure/lambda/tests`), Angular 20 standalone components (verified via `npm run build` — no client test runner, lint is known-broken in this repo).

**Design spec:** [specs/2026-07-16-undercity-trading-post-design.md](2026-07-16-undercity-trading-post-design.md)

---

## File Structure

**Backend (`infrastructure/lambda/`):**
- `undercity_db.py` — add `_item_kind` helper; rewrite `_trade` (~line 2419) to be kind-aware on both give and take sides.
- `tests/test_undercity_db.py` — extend trading-post coverage (~line 467) with gear-swap, grimoire-swap, bag-overflow, and duplicate-grimoire cases.

**Frontend (`src/app/undercity/`):**
- `tabs/board-tab.component.ts` — add `SLOT_ICONS`, a `TradeOffer` type, `tradeOffers()` computed, and take-button pre-check helpers; extend `openTradingPost`/`trade` bookkeeping.
- `tabs/board-tab.component.html` — rewrite the Trading Post modal block (~line 410-454): add `modal-art`, group offerable items by kind, render richer "offered" rows.
- `tabs/board-tab.component.scss` — fold `.trading-modal` into the existing `.shop-modal` left-align override.

Backend tasks (1-2) land first and keep the pytest suite green; frontend tasks (3-5) build on the unchanged wire shape and are verified with `npm run build`.

---

## Task 1: Backend — kind-aware `_trade`

**Files:**
- Modify: `infrastructure/lambda/undercity_db.py:2419-2455` (the `_trade` function)
- Test: `infrastructure/lambda/tests/test_undercity_db.py`

- [ ] **Step 1: Write the failing tests**

Add these tests directly after `test_trading_post_pre_seed_and_swap` (after line 493) in `infrastructure/lambda/tests/test_undercity_db.py`:

```python
def test_trading_post_swap_gear(table):
    act(table, 'join', starter='pest')
    sid = _sid(table)
    doc = db._get_player(table, sid, 'user-alex')
    doc['position'] = 'isl_trade'
    doc['gear'] = {'fang': 'rusted_fang'}
    db._put_player(table, doc)

    # Seed the post with a gear item left behind by an earlier visitor.
    db._save_trading_post(table, sid, 'isl_trade',
                           [{'item': 'kraul_barb', 'foundBy': 'Sam'},
                            {'item': 'healing_moss', 'foundBy': 'the Swarm'},
                            {'item': 'loaded_die', 'foundBy': 'the Swarm'}])

    status, resp = act(table, 'trade', give='rusted_fang', takeIndex=0)
    assert status == 200
    you = resp['you']
    assert you['gear']['fang'] == 'kraul_barb'          # new piece equipped
    stock = resp['stock']
    assert stock[0] == {'item': 'rusted_fang', 'foundBy': 'Alex'}  # old piece left behind


def test_trading_post_swap_grimoire(table):
    act(table, 'join', starter='pest')
    sid = _sid(table)
    doc = db._get_player(table, sid, 'user-alex')
    doc['position'] = 'isl_trade'
    doc['grimoires'] = ['moldering_folio']
    doc['equippedGrimoire'] = 'moldering_folio'
    db._put_player(table, doc)

    db._save_trading_post(table, sid, 'isl_trade',
                           [{'item': 'gardeners_primer', 'foundBy': 'Sam'},
                            {'item': 'healing_moss', 'foundBy': 'the Swarm'},
                            {'item': 'loaded_die', 'foundBy': 'the Swarm'}])

    status, resp = act(table, 'trade', give='moldering_folio', takeIndex=0)
    assert status == 200
    you = resp['you']
    assert you['grimoires'] == ['gardeners_primer']
    assert you['equippedGrimoire'] == 'gardeners_primer'  # cleared, then auto-equipped from the take
    assert resp['stock'][0] == {'item': 'moldering_folio', 'foundBy': 'Alex'}


def test_trading_post_take_grimoire_auto_equips_if_none_owned(table):
    act(table, 'join', starter='pest')
    sid = _sid(table)
    doc = db._get_player(table, sid, 'user-alex')
    doc['position'] = 'isl_trade'
    doc['bag'] = ['snare']
    db._put_player(table, doc)

    db._save_trading_post(table, sid, 'isl_trade',
                           [{'item': 'gardeners_primer', 'foundBy': 'Sam'},
                            {'item': 'healing_moss', 'foundBy': 'the Swarm'},
                            {'item': 'loaded_die', 'foundBy': 'the Swarm'}])

    status, resp = act(table, 'trade', give='snare', takeIndex=0)
    assert status == 200
    you = resp['you']
    assert you['grimoires'] == ['gardeners_primer']
    assert you['equippedGrimoire'] == 'gardeners_primer'   # auto-equipped, had none


def test_trading_post_rejects_duplicate_grimoire_take(table):
    act(table, 'join', starter='pest')
    sid = _sid(table)
    doc = db._get_player(table, sid, 'user-alex')
    doc['position'] = 'isl_trade'
    doc['bag'] = ['snare']
    doc['grimoires'] = ['gardeners_primer']
    db._put_player(table, doc)

    db._save_trading_post(table, sid, 'isl_trade',
                           [{'item': 'gardeners_primer', 'foundBy': 'Sam'},
                            {'item': 'healing_moss', 'foundBy': 'the Swarm'},
                            {'item': 'loaded_die', 'foundBy': 'the Swarm'}])

    status, _ = act(table, 'trade', give='snare', takeIndex=0)
    assert status == 409  # already own that grimoire


def test_trading_post_rejects_bag_overflow_take(table):
    act(table, 'join', starter='pest')
    sid = _sid(table)
    doc = db._get_player(table, sid, 'user-alex')
    doc['position'] = 'isl_trade'
    doc['gear'] = {'fang': 'rusted_fang'}
    doc['bag'] = ['healing_moss', 'smoke_spore', 'loaded_die']  # already full
    db._put_player(table, doc)

    db._save_trading_post(table, sid, 'isl_trade',
                           [{'item': 'snare', 'foundBy': 'the Swarm'},
                            {'item': 'chitin_scrap', 'foundBy': 'the Swarm'},
                            {'item': 'moldering_folio', 'foundBy': 'the Swarm'}])

    status, _ = act(table, 'trade', give='rusted_fang', takeIndex=0)
    assert status == 409  # bag is full, can't take a consumable


def test_trading_post_rejects_give_not_owned(table):
    act(table, 'join', starter='pest')
    sid = _sid(table)
    doc = db._get_player(table, sid, 'user-alex')
    doc['position'] = 'isl_trade'
    doc['gear'] = {}
    doc['grimoires'] = []
    db._put_player(table, doc)

    status, _ = act(table, 'trade', give='rusted_fang', takeIndex=0)
    assert status == 409  # don't have that gear equipped
    status, _ = act(table, 'trade', give='moldering_folio', takeIndex=0)
    assert status == 409  # don't own that grimoire
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `cd infrastructure/lambda && python -m pytest tests/test_undercity_db.py -k trading_post -v`
Expected: the 5 new tests FAIL (gear/grimoire gives are rejected as "unknown item" or bag-only logic; `_save_trading_post` call itself will work since that helper already exists).

- [ ] **Step 3: Rewrite `_trade`**

Replace `infrastructure/lambda/undercity_db.py:2419-2455` (the whole `_trade` function) with:

```python
def _item_kind(item_id):
    if item_id in data.CONSUMABLES:
        return 'consumable'
    if item_id in data.GEAR:
        return 'gear'
    if item_id in data.GRIMOIRES:
        return 'grimoire'
    return None


def _trade(table, sid, doc, payload):
    """Swap one owned item (consumable, equipped gear, or an owned grimoire)
    for one of the post's 3 stock items. The item you leave becomes the next
    visitor's stock, tagged with your name."""
    node = doc.get('position')
    if data.MAP_NODES.get(node, {}).get('type') != 'trading_post':
        return _err('You are not at a trading post.', 409)
    give = payload.get('give')
    take_index = payload.get('takeIndex')
    give_kind = _item_kind(give)
    if give_kind is None:
        return _err('Unknown item.')

    bag = doc.get('bag') or []
    gear = doc.get('gear') or {}
    grimoires = doc.get('grimoires') or []

    if give_kind == 'consumable' and give not in bag:
        return _err("You don't have that item to trade.", 409)
    if give_kind == 'gear' and gear.get(data.GEAR[give]['slot']) != give:
        return _err("You don't have that piece equipped.", 409)
    if give_kind == 'grimoire' and give not in grimoires:
        return _err("You don't own that grimoire.", 409)

    stock = _trading_post_stock(table, sid, node)
    if not isinstance(take_index, int) or not (0 <= take_index < len(stock)):
        return _err('Pick something to take.', 409)

    taken = stock[take_index]
    take_kind = _item_kind(taken['item'])
    if take_kind == 'consumable':
        effective_bag_len = len(bag) - (1 if give_kind == 'consumable' else 0)
        if effective_bag_len >= data.BAG_SIZE:
            return _err('Your bag is full (3 slots).', 409)
    if take_kind == 'grimoire' and taken['item'] in grimoires:
        return _err('You already own that grimoire.', 409)

    # Remove the given item.
    if give_kind == 'consumable':
        bag = list(bag)
        bag.remove(give)
        doc['bag'] = bag
    elif give_kind == 'gear':
        gear = dict(gear)
        del gear[data.GEAR[give]['slot']]
        doc['gear'] = gear
    elif give_kind == 'grimoire':
        grimoires = [g for g in grimoires if g != give]
        doc['grimoires'] = grimoires
        if doc.get('equippedGrimoire') == give:
            doc['equippedGrimoire'] = None

    # Apply the taken item.
    if take_kind == 'consumable':
        doc.setdefault('bag', []).append(taken['item'])
    elif take_kind == 'gear':
        doc.setdefault('gear', {})[data.GEAR[taken['item']]['slot']] = taken['item']
    elif take_kind == 'grimoire':
        doc.setdefault('grimoires', []).append(taken['item'])
        if not doc.get('equippedGrimoire'):
            doc['equippedGrimoire'] = taken['item']

    stock = list(stock)
    stock[take_index] = {'item': give, 'foundBy': doc.get('username', 'someone')}

    conflict = _save_or_conflict(table, doc)  # guard the player write first
    if conflict:
        return conflict
    _save_trading_post(table, sid, node, stock)  # then the shared stock

    give_name = _item_name(give)
    take_name = _item_name(taken['item'])
    _event(table, sid, 'trade',
           f"{doc['username']} traded a {give_name} for {take_name} "
           f"(left by {taken['foundBy']}) at the trading post.", actor=doc['userId'])
    return _ok(doc, text=f"You leave your {give_name} and take {take_name} "
               f"(found by {taken['foundBy']}).", node=node, stock=stock)


def _item_name(item_id):
    kind = _item_kind(item_id)
    if kind == 'consumable':
        return data.CONSUMABLES[item_id]['name']
    if kind == 'gear':
        return data.GEAR[item_id]['name']
    if kind == 'grimoire':
        return data.GRIMOIRES[item_id]['name']
    return item_id
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `cd infrastructure/lambda && python -m pytest tests/test_undercity_db.py -k trading_post -v`
Expected: all 7 trading-post tests PASS (the original 2 plus the 5 new ones).

- [ ] **Step 5: Run the full suite**

Run: `cd infrastructure/lambda && python -m pytest tests -q`
Expected: all tests PASS, no regressions.

- [ ] **Step 6: Commit**

```bash
git add infrastructure/lambda/undercity_db.py infrastructure/lambda/tests/test_undercity_db.py
git commit -m "feat(undercity): trading post accepts gear and grimoires, not just bag items"
```

---

## Task 2: Frontend — combined offerable-items list

**Files:**
- Modify: `src/app/undercity/tabs/board-tab.component.ts`

- [ ] **Step 1: Add a `TradeOffer` type and `SLOT_ICONS` near the other item-display helpers**

Insert after the `ownsGrimoire`/`grimoireSpellList` block (after line 289 in `board-tab.component.ts`):

```typescript
  // ── Trading post (leave-one-take-one, any owned item) ───────────────────
  private readonly SLOT_ICONS: Record<string, string> = {
    fang: 'hardware',
    carapace: 'shield',
    charm: 'auto_awesome',
  };

  protected tradeOffers(): TradeOffer[] {
    const you = this.store.you();
    if (!you) return [];
    const offers: TradeOffer[] = [];
    for (const id of you.bag ?? []) {
      const c = CONSUMABLE_MAP[id];
      if (c) offers.push({ id, kind: 'consumable', icon: c.icon, label: c.name, sub: c.desc });
    }
    for (const [slot, id] of Object.entries(you.gear ?? {})) {
      const g = GEAR_MAP[id];
      if (g) offers.push({ id, kind: 'gear', icon: this.SLOT_ICONS[slot] ?? 'hardware', label: g.name, sub: g.desc });
    }
    for (const id of you.grimoires ?? []) {
      const g = GRIMOIRE_MAP[id];
      if (g) offers.push({ id, kind: 'grimoire', icon: 'menu_book', label: g.name, sub: this.grimoireSpellList(g) });
    }
    return offers;
  }

  protected tradeStockDetail(id: string): { icon: string; label: string; sub: string } {
    const c = CONSUMABLE_MAP[id];
    if (c) return { icon: c.icon, label: c.name, sub: c.desc };
    const g = GEAR_MAP[id];
    if (g) return { icon: this.SLOT_ICONS[g.slot] ?? 'hardware', label: g.name, sub: g.desc };
    const gr = GRIMOIRE_MAP[id];
    if (gr) return { icon: 'menu_book', label: gr.name, sub: this.grimoireSpellList(gr) };
    return { icon: 'help', label: id, sub: '' };
  }

  /** Client-side mirror of the server's take-side guards, so blocked takes read as a disabled button. */
  protected canTakeStock(item: string): boolean {
    const you = this.store.you();
    if (!you) return false;
    if (CONSUMABLE_MAP[item]) {
      const givingConsumable = !!CONSUMABLE_MAP[this.giveItem() ?? ''];
      const effectiveBagLen = (you.bag?.length ?? 0) - (givingConsumable ? 1 : 0);
      return effectiveBagLen < 3;
    }
    if (GRIMOIRE_MAP[item]) {
      return !(you.grimoires ?? []).includes(item);
    }
    return true;
  }
```

- [ ] **Step 2: Add the `TradeOffer` interface to `undercity-models.ts`**

Add to `src/app/undercity/services/undercity-models.ts` next to `TradeStockItem` (line 273):

```typescript
export interface TradeOffer {
  id: string;
  kind: 'consumable' | 'gear' | 'grimoire';
  icon: string;
  label: string;
  sub: string;
}
```

- [ ] **Step 3: Import `TradeOffer` in `board-tab.component.ts`**

In the `from '../services/undercity-models'` import block (lines 18-33), add `TradeOffer` to the named imports, keeping alphabetical order:

```typescript
  SpaceEvent,
  Stance,
  TradeOffer,
  TradeStockItem,
```

- [ ] **Step 4: Verify it compiles**

Run: `npm run build`
Expected: build succeeds (no template references `tradeOffers`/`tradeStockDetail`/`canTakeStock` yet, so this only checks the new TS is well-typed).

- [ ] **Step 5: Commit**

```bash
git add src/app/undercity/tabs/board-tab.component.ts src/app/undercity/services/undercity-models.ts
git commit -m "feat(undercity): compute combined trade-offer list (bag + gear + grimoires)"
```

---

## Task 3: Frontend — rewrite the Trading Post modal template

**Files:**
- Modify: `src/app/undercity/tabs/board-tab.component.html:410-454`

- [ ] **Step 1: Replace the Trading Post block**

Replace lines 410-454 of `src/app/undercity/tabs/board-tab.component.html` with:

```html
  <!-- Trading Post -->
  @if (showTradingPost()) {
    <div class="uc-modal-backdrop" (click)="closeFacilities()">
      <div
        class="uc-modal trading-modal"
        (click)="$event.stopPropagation()"
        [style.background-image]="regionWashBg()"
      >
        <img class="modal-art" src="undercity/icons/trading_post.png" alt="" />
        <h3><mat-icon class="mi">swap_horiz</mat-icon> Trading Post</h3>
        <p class="modal-sub">
          Leave a consumable, a piece of gear, or a grimoire — take one another player left behind.
        </p>

        <div class="shop-section">Your items — tap one to offer</div>
        @if (tradeOffers().length === 0) {
          <p class="trade-empty">You have nothing to trade yet.</p>
        } @else {
          <div class="trade-bag">
            @for (o of tradeOffers(); track o.id) {
              <button
                class="trade-chip"
                [class.selected]="giveItem() === o.id"
                (click)="giveItem.set(o.id)"
              >
                <mat-icon class="mi">{{ o.icon }}</mat-icon>
                {{ o.label }}
              </button>
            }
          </div>
        }

        <div class="shop-section">Offered — take one (leaves your selected item here)</div>
        @for (s of tradingStock(); track $index) {
          <div class="shop-row">
            <span class="shop-name">
              <mat-icon class="mi">{{ tradeStockDetail(s.item).icon }}</mat-icon>
              {{ tradeStockDetail(s.item).label }}
              <em>{{ tradeStockDetail(s.item).sub }} — found by {{ s.foundBy }}</em>
            </span>
            <button
              class="uc-btn shop-buy"
              [disabled]="busy() || !giveItem() || !canTakeStock(s.item)"
              (click)="trade($index)"
            >
              Take
            </button>
          </div>
        }
        <button class="uc-btn close-btn" (click)="closeFacilities()">Leave</button>
      </div>
    </div>
  }
```

- [ ] **Step 2: Verify it compiles**

Run: `npm run build`
Expected: build succeeds. If it fails on `regionWashBg`/`tradingStock`/`giveItem`/`trade`/`busy`/`closeFacilities` — those are pre-existing members, so a failure there means a typo was introduced; compare against the surrounding Bazaar block for the correct member names.

- [ ] **Step 3: Commit**

```bash
git add src/app/undercity/tabs/board-tab.component.html
git commit -m "feat(undercity): trading post modal shows gear/grimoire offers with shop-row detail"
```

---

## Task 4: Frontend — visual polish (SCSS)

**Files:**
- Modify: `src/app/undercity/tabs/board-tab.component.scss:541-548`

- [ ] **Step 1: Fold `.trading-modal` into the shop-modal left-align override**

Replace lines 541-548:

```scss
.shop-modal {
  text-align: left;

  h3,
  .modal-sub {
    text-align: center;
  }
}
```

with:

```scss
.shop-modal,
.trading-modal {
  text-align: left;

  h3,
  .modal-sub {
    text-align: center;
  }
}
```

- [ ] **Step 2: Verify it compiles**

Run: `npm run build`
Expected: build succeeds.

- [ ] **Step 3: Commit**

```bash
git add src/app/undercity/tabs/board-tab.component.scss
git commit -m "style(undercity): left-align trading post modal body like the bazaar"
```

---

## Task 5: Manual verification

**Files:** none (verification only)

- [ ] **Step 1: Confirm the icon asset landed**

Run: `ls public/undercity/icons/trading_post.png` (or the Windows equivalent `Test-Path`) — this file is user-supplied per the design spec. If missing, the `<img>` will just show a broken-image icon; note this to the user rather than blocking on it.

- [ ] **Step 2: Run the full backend suite one more time**

Run: `cd infrastructure/lambda && python -m pytest tests -q`
Expected: all PASS.

- [ ] **Step 3: Run the frontend build one more time**

Run: `npm run build`
Expected: succeeds with no new errors/warnings.

- [ ] **Step 4: Manual smoke test (dev server)**

Run: `npm start`, navigate to `/undercity`, get a character onto a trading-post node (`isl_trade` per the tests — use the map or dev tools to warp there if needed), open the modal, and confirm:
- Bag items, equipped gear, and owned grimoires all appear as offer chips.
- Selecting an offer and tapping "Take" on a stock row swaps correctly and updates both lists.
- Taking a consumable when the bag is full is disabled; taking a grimoire you already own is disabled.
