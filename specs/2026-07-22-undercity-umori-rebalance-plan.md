# Umori Rebalance Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Turn Umori's stop from a free three-legendary dump into a single same-slot upgrade, once per 2-hour rotation.

**Architecture:** Server changes are localized to the Umori stock generator and the `_trade` action in `undercity_db.py` (plus one constant in `undercity_data.py` and one line in the state view). The client reworks the trading-post modal to a take-first flow: tap a stock line, then pick a qualifying trade-in. No new persistence, node type, or movement logic.

**Tech Stack:** Python 3.11 Lambda (pytest), Angular 20 standalone components (SCSS), DynamoDB single-table.

Design: [specs/2026-07-22-undercity-umori-rebalance-design.md](2026-07-22-undercity-umori-rebalance-design.md)

Test command (server): `cd infrastructure/lambda && python -m pytest tests -q`
Build command (client, via Bash): `npm run build`

---

## File Structure

- Modify `infrastructure/lambda/undercity_data.py` — `UMORI_STOCK_SPEC`, new `UMORI_GEAR_SLOTS`.
- Modify `infrastructure/lambda/undercity_db.py` — `_umori_stock`, `_trade`, `handle_state` umori view.
- Modify `infrastructure/lambda/tests/test_undercity_db.py` — stock-composition test + new trade tests.
- Modify `src/app/undercity/services/undercity-models.ts` — `umori.traded`, `TradeOffer.equipped`.
- Modify `src/app/undercity/tabs/board-tab.component.ts` — helpers + flow methods.
- Modify `src/app/undercity/tabs/board-tab.component.html` — take-first modal.
- Modify `src/app/undercity/tabs/board-tab.component.scss` — picker + equipped badge styles.

---

## Task 1: Server — one-T3-per-slot stock

**Files:**
- Modify: `infrastructure/lambda/undercity_data.py` (`UMORI_STOCK_SPEC` ~line 555)
- Modify: `infrastructure/lambda/undercity_db.py` (`_umori_stock` ~lines 85-98)
- Test: `infrastructure/lambda/tests/test_undercity_db.py` (`test_umori_stock_is_all_t3_and_deterministic` ~line 2141)

- [ ] **Step 1: Update the stock spec + add the slot order constant**

In `undercity_data.py`, replace the `UMORI_STOCK_SPEC` line (the comment above it can stay, but update it):

```python
# Umori barter seed per move: one T3 gear piece for EACH gear slot + this many T3
# grimoires (all tier 3 — the endgame payoff for reaching the wandering post).
UMORI_STOCK_SPEC = {'gear_per_slot': 1, 'grimoire': 1}

# Fixed slot order for Umori's gear lines (keeps takeIndex + the UI stable).
UMORI_GEAR_SLOTS = ['fang', 'carapace', 'charm']
```

- [ ] **Step 2: Update the failing test to the new composition**

In `tests/test_undercity_db.py`, replace the body of `test_umori_stock_is_all_t3_and_deterministic`:

```python
def test_umori_stock_is_all_t3_and_deterministic():
    for w in range(0, 5):
        stock = db._umori_stock(w)
        assert len(stock) == (
            len(data.UMORI_GEAR_SLOTS) * data.UMORI_STOCK_SPEC['gear_per_slot']
            + data.UMORI_STOCK_SPEC['grimoire']
        )
        gears = [s['item'] for s in stock if s['item'] in data.GEAR]
        tomes = [s['item'] for s in stock if s['item'] in data.GRIMOIRES]
        # one gear per slot, covering every slot exactly once
        assert sorted(data.GEAR[g]['slot'] for g in gears) == sorted(data.UMORI_GEAR_SLOTS)
        assert all(data.GEAR[g]['tier'] == 3 for g in gears)
        assert len(tomes) == data.UMORI_STOCK_SPEC['grimoire']
        assert all(data.GRIMOIRES[t]['tier'] == 3 for t in tomes)
    # deterministic per window
    assert db._umori_stock(5) == db._umori_stock(5)
```

- [ ] **Step 3: Run the test to verify it fails**

Run: `cd infrastructure/lambda && python -m pytest tests/test_undercity_db.py::test_umori_stock_is_all_t3_and_deterministic -q`
Expected: FAIL (old `_umori_stock` produces 2 gear + 1 grimoire, and `UMORI_STOCK_SPEC['gear']` no longer exists).

- [ ] **Step 4: Rewrite `_umori_stock`**

In `undercity_db.py`, replace the whole `_umori_stock` function:

```python
def _umori_stock(window):
    """Fresh T3 barter seed for a window: one T3 gear per slot (fixed order) +
    UMORI_STOCK_SPEC['grimoire'] T3 grimoires. Deterministic per window."""
    rng = random.Random(zlib.crc32(f'umori-stock:{window}'.encode()))
    by_slot = {}
    for gid, g in data.GEAR.items():
        if g['tier'] == 3:
            by_slot.setdefault(g['slot'], []).append(gid)
    picks = []
    for slot in data.UMORI_GEAR_SLOTS:
        pool = sorted(by_slot.get(slot, []))
        if pool:
            picks.append(rng.choice(pool))
    tomes = sorted(gid for gid, gr in data.GRIMOIRES.items() if gr['tier'] == 3)
    rng.shuffle(tomes)
    picks += tomes[:data.UMORI_STOCK_SPEC['grimoire']]
    return [{'item': i, 'foundBy': 'the Swarm'} for i in picks]
```

- [ ] **Step 5: Run the full suite to verify green**

Run: `cd infrastructure/lambda && python -m pytest tests -q`
Expected: PASS. (`test_umori_pre_seeds_t3_stock` and `test_resolve_on_umori_node_opens_a_trading_post` still pass — all lines T3, deterministic.)

- [ ] **Step 6: Commit**

```bash
git add infrastructure/lambda/undercity_data.py infrastructure/lambda/undercity_db.py infrastructure/lambda/tests/test_undercity_db.py
git commit -m "feat(undercity): Umori stocks one T3 gear per slot + a grimoire"
```

---

## Task 2: Server — same-slot / same-kind trade, give-from-stash, once-per-rotation

**Files:**
- Modify: `infrastructure/lambda/undercity_db.py` (`_trade` ~lines 4121-4204)
- Test: `infrastructure/lambda/tests/test_undercity_db.py`

- [ ] **Step 1: Write the failing tests**

Add these to `tests/test_undercity_db.py` (near the existing `test_umori_swap_*` tests; they reuse `_stand_on_umori`, `_t3_fang`, `_t3_tome` already defined in the file). Helper `_t3_carapace` is new:

```python
def _t3_carapace():
    return next(g for g, v in data.GEAR.items() if v['tier'] == 3 and v['slot'] == 'carapace')


def test_umori_rejects_cross_slot_gear(table):
    sid, doc, node = _stand_on_umori(table)
    win = db._umori_window()
    take = _t3_carapace()
    table.put_item(Item={'pk': db._season_pk(sid), 'sk': f'POST#UMORI#{win}',
                         'stock': [{'item': take, 'foundBy': 'the Swarm'}]})
    doc['gear'] = {'fang': 'rusted_fang'}                       # a fang, not a carapace
    db._put_player(table, doc)
    status, resp = act(table, 'trade', give='rusted_fang', takeIndex=0)
    assert status == 409 and 'same slot' in resp['error']


def test_umori_rejects_cross_kind(table):
    sid, doc, node = _stand_on_umori(table)
    win = db._umori_window()
    take = _t3_tome()                                          # a grimoire line
    table.put_item(Item={'pk': db._season_pk(sid), 'sk': f'POST#UMORI#{win}',
                         'stock': [{'item': take, 'foundBy': 'the Swarm'}]})
    doc['gear'] = {'fang': 'rusted_fang'}                      # offering gear for a grimoire
    db._put_player(table, doc)
    status, resp = act(table, 'trade', give='rusted_fang', takeIndex=0)
    assert status == 409 and 'grimoire' in resp['error']


def test_umori_gives_from_stash(table):
    sid, doc, node = _stand_on_umori(table)
    win = db._umori_window()
    take = _t3_fang()
    table.put_item(Item={'pk': db._season_pk(sid), 'sk': f'POST#UMORI#{win}',
                         'stock': [{'item': take, 'foundBy': 'the Swarm'}]})
    doc['gear'] = {}                                           # nothing equipped
    doc['gearStash'] = ['rusted_fang']                         # a stashed fang qualifies
    db._put_player(table, doc)
    status, resp = act(table, 'trade', give='rusted_fang', takeIndex=0)
    assert status == 200
    assert 'rusted_fang' not in (resp['you'].get('gearStash') or [])  # removed from stash
    assert take in resp['you']['gearStash']                    # legendary stashed
    assert resp['stock'][0] == {'item': 'rusted_fang', 'foundBy': 'Alex'}


def test_umori_one_barter_per_rotation(table):
    sid, doc, node = _stand_on_umori(table)
    win = db._umori_window()
    take = _t3_fang()
    table.put_item(Item={'pk': db._season_pk(sid), 'sk': f'POST#UMORI#{win}',
                         'stock': [{'item': take, 'foundBy': 'the Swarm'}]})
    doc['gear'] = {'fang': 'rusted_fang'}
    db._put_player(table, doc)
    status, _ = act(table, 'trade', give='rusted_fang', takeIndex=0)
    assert status == 200
    # second trade this window is blocked
    d2 = db._get_player(table, sid, 'user-alex')
    d2['gear'] = {'fang': 'bloodfang'}
    db._put_player(table, d2)
    status, resp = act(table, 'trade', give='bloodfang', takeIndex=0)
    assert status == 409 and 'already bartered' in resp['error']
    # a later window lets them barter again
    d3 = db._get_player(table, sid, 'user-alex')
    d3['umoriTradedWindow'] = win - 1                          # simulate an older stop
    d3['gear'] = {'fang': 'bloodfang'}
    db._put_player(table, d3)
    status, _ = act(table, 'trade', give='bloodfang', takeIndex=0)
    assert status == 200
```

- [ ] **Step 2: Run the new tests to verify they fail**

Run: `cd infrastructure/lambda && python -m pytest tests/test_undercity_db.py -q -k "cross_slot or cross_kind or gives_from_stash or one_barter"`
Expected: FAIL (current `_trade` has no slot/kind match, no stash-give path, no per-rotation guard — e.g. cross-slot currently succeeds).

- [ ] **Step 3: Rewrite `_trade`**

In `undercity_db.py`, replace the entire `_trade` function with:

```python
def _trade(table, sid, doc, payload):
    """Barter one owned item for one of Umori's stock lines. Match rule: a gear
    line wants a gear piece of the *same slot* (equipped or stashed); the grimoire
    line wants a grimoire. One barter per rotation. The item you leave fills that
    stock slot for the rest of the window; the taken gear lands in your stash."""
    node = doc.get('position')
    win = _umori_window()
    if node != _umori_node(win):
        return _err('Umori is not here.', 409)
    if doc.get('umoriTradedWindow') == win:
        return _err("You've already bartered with Umori this stop — "
                    'catch it after it wanders on.', 409)

    give = payload.get('give')
    take_index = payload.get('takeIndex')
    give_kind = _item_kind(give)
    if give_kind is None:
        return _err('Unknown item.')
    if give_kind == 'consumable':
        return _err('Umori only trades in gear and grimoires.', 409)

    stock = _umori_barter_stock(table, sid, win)
    if not isinstance(take_index, int) or not (0 <= take_index < len(stock)):
        return _err('Pick something to take.', 409)
    taken = stock[take_index]
    take_kind = _item_kind(taken['item'])

    # Match rule — one slot at a time.
    if take_kind == 'gear':
        if give_kind != 'gear' or data.GEAR[give]['slot'] != data.GEAR[taken['item']]['slot']:
            slot = data.GEAR[taken['item']]['slot']
            return _err(f'Umori wants the same slot — offer a {slot} for that {slot}.', 409)
    elif take_kind == 'grimoire':
        if give_kind != 'grimoire':
            return _err('Umori wants a grimoire for that grimoire.', 409)

    gear = doc.get('gear') or {}
    grimoires = doc.get('grimoires') or []
    stash = doc.get('gearStash') or []

    # Give-side ownership: gear may come from the equipped slot OR the stash.
    give_from_stash = False
    if give_kind == 'gear':
        slot = data.GEAR[give]['slot']
        if gear.get(slot) == give:
            give_from_stash = False
        elif give in stash:
            give_from_stash = True
        else:
            return _err("You don't have that piece to trade.", 409)
    elif give_kind == 'grimoire' and give not in grimoires:
        return _err("You don't own that grimoire.", 409)

    # Take-side guards.
    if take_kind == 'grimoire' and taken['item'] in grimoires:
        return _err('You already own that grimoire.', 409)
    if take_kind == 'gear':
        effective_stash = len(stash) - (1 if give_from_stash else 0)
        if effective_stash >= data.GEAR_STASH_SIZE:
            return _err('Your gear stash is full — salvage a piece at the Plaza first.', 409)

    # Remove the given item from wherever it lives.
    if give_kind == 'gear':
        if give_from_stash:
            stash = list(stash)
            stash.remove(give)
            doc['gearStash'] = stash
        else:
            gear = dict(gear)
            del gear[data.GEAR[give]['slot']]
            doc['gear'] = gear
    elif give_kind == 'grimoire':
        doc['grimoires'] = [g for g in grimoires if g != give]
        if doc.get('equippedGrimoire') == give:
            doc['equippedGrimoire'] = None

    # Apply the taken item.
    if take_kind == 'gear':
        doc.setdefault('gearStash', []).append(taken['item'])
    elif take_kind == 'grimoire':
        doc.setdefault('grimoires', []).append(taken['item'])
        if not doc.get('equippedGrimoire'):
            doc['equippedGrimoire'] = taken['item']

    # Leave the given piece in that stock slot for the rest of the window.
    stock = list(stock)
    stock[take_index] = {'item': give, 'foundBy': doc.get('username', 'someone')}

    doc['umoriTradedWindow'] = win                       # spend the rotation's barter

    conflict = _save_or_conflict(table, doc)             # guard the player write first
    if conflict:
        return conflict
    table.put_item(Item={'pk': _season_pk(sid),          # then the shared window stock
                         'sk': f'POST#UMORI#{win}', 'stock': stock})

    give_name = _item_name(give)
    take_name = _item_name(taken['item'])
    _event(table, sid, 'trade',
           f"{doc['username']} bartered a {give_name} for {take_name} at Umori's stall.",
           actor=doc['userId'])
    return _ok(doc, text=f"You hand over your {give_name} and take {take_name}.",
               node=node, stock=stock)
```

- [ ] **Step 4: Run the whole suite to verify green**

Run: `cd infrastructure/lambda && python -m pytest tests -q`
Expected: PASS. New tests pass; existing `test_umori_swap_gear` (T1 fang→T3 fang, same slot), `test_umori_swap_grimoire_auto_equips`, `test_umori_rejects_consumable_give`, `test_umori_rejects_trade_when_not_on_node`, `test_umori_rejects_out_of_range_take` still pass.

- [ ] **Step 5: Commit**

```bash
git add infrastructure/lambda/undercity_db.py infrastructure/lambda/tests/test_undercity_db.py
git commit -m "feat(undercity): Umori same-slot upgrade, give-from-stash, one barter per rotation"
```

---

## Task 3: Server — expose `umori.traded` in state

**Files:**
- Modify: `infrastructure/lambda/undercity_db.py` (`handle_state`, the `'umori': {...}` line ~1189)
- Test: `infrastructure/lambda/tests/test_undercity_db.py`

- [ ] **Step 1: Write the failing test**

Add to `tests/test_undercity_db.py`:

```python
def test_state_reports_umori_traded_flag(table):
    sid, doc, node = _stand_on_umori(table)
    win = db._umori_window()
    # Before trading: traded is False.
    _, state = db.handle_state(table, {'userId': 'user-alex'})
    assert state['umori']['traded'] is False
    # After marking this window traded: True.
    doc = db._get_player(table, sid, 'user-alex')
    doc['umoriTradedWindow'] = win
    db._put_player(table, doc)
    _, state = db.handle_state(table, {'userId': 'user-alex'})
    assert state['umori']['traded'] is True
```

Note: `handle_state(table, query_params)` returns `(status, state)` — this matches the existing state tests (e.g. `_, state = db.handle_state(table, {'userId': 'user-alex'})`).

- [ ] **Step 2: Run it to verify it fails**

Run: `cd infrastructure/lambda && python -m pytest tests/test_undercity_db.py::test_state_reports_umori_traded_flag -q`
Expected: FAIL (`KeyError: 'traded'`).

- [ ] **Step 3: Add the flag to the state view**

In `undercity_db.py`, replace the umori line in the `out = { ... }` dict:

```python
        'umori': {'node': umori_node, 'movesAt': _umori_window_end(umori_win),
                  'traded': bool(you and you.get('umoriTradedWindow') == umori_win)},
```

- [ ] **Step 4: Run to verify green**

Run: `cd infrastructure/lambda && python -m pytest tests -q`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add infrastructure/lambda/undercity_db.py infrastructure/lambda/tests/test_undercity_db.py
git commit -m "feat(undercity): expose umori.traded in game state"
```

---

## Task 4: Client — take-first trading modal

No unit runner on the client — verify with `npm run build` (via the Bash tool).

**Files:**
- Modify: `src/app/undercity/services/undercity-models.ts`
- Modify: `src/app/undercity/tabs/board-tab.component.ts`
- Modify: `src/app/undercity/tabs/board-tab.component.html`
- Modify: `src/app/undercity/tabs/board-tab.component.scss`

- [ ] **Step 1: Extend the models**

In `undercity-models.ts`, update the `umori` field (currently `umori?: { node: string; movesAt: string };`):

```typescript
  umori?: { node: string; movesAt: string; traded?: boolean };
```

And add an `equipped` flag to `TradeOffer` (after the `sub: string;` field):

```typescript
  /** For a same-slot gear offer: this is the piece currently worn (badged in UI). */
  equipped?: boolean;
```

- [ ] **Step 2: Add component state + helpers**

In `board-tab.component.ts`, next to the existing trading signals (`showTradingPost`, `tradingStock`, `giveItem` ~lines 177-179) add:

```typescript
  /** Index of the stock line whose trade-in picker is open (take-first flow). */
  protected readonly selectedStock = signal<number | null>(null);
  /** True once the player has spent this rotation's single barter. */
  protected readonly umoriTraded = computed(() => !!this.store.umori()?.traded);
```

Replace the `tradeOffers()` method and the `canTakeStock()` method (they are superseded) with these three helpers. Keep `tradeStockDetail()` as-is.

```typescript
  /** Owned items that qualify as a trade-in for a given stock line — same-slot
   *  gear (equipped + stashed, equipped flagged) or, for the grimoire line, owned
   *  grimoires. Mirror of the server match rule. */
  protected qualifyingGiveOffers(stockItem: string): TradeOffer[] {
    const you = this.store.you();
    if (!you) return [];
    const gear = GEAR_MAP[stockItem];
    if (gear) {
      const slot = gear.slot;
      const offers: TradeOffer[] = [];
      const equippedId = (you.gear ?? {})[slot];
      if (equippedId && GEAR_MAP[equippedId]) {
        const g = GEAR_MAP[equippedId];
        const r = tierRarity(g.tier);
        offers.push({ id: equippedId, kind: 'gear', icon: '', slot, rarity: r.key,
                      rarityLabel: r.label, label: g.name, sub: g.desc, equipped: true });
      }
      for (const id of you.gearStash ?? []) {
        const g = GEAR_MAP[id];
        if (g && g.slot === slot) {
          const r = tierRarity(g.tier);
          offers.push({ id, kind: 'gear', icon: '', slot, rarity: r.key,
                        rarityLabel: r.label, label: g.name, sub: g.desc });
        }
      }
      return offers;
    }
    const gr = GRIMOIRE_MAP[stockItem];
    if (gr) {
      return (you.grimoires ?? []).map((id) => {
        const t = GRIMOIRE_MAP[id];
        return { id, kind: 'grimoire' as const, icon: 'menu_book',
                 label: t?.name ?? id, sub: t ? this.grimoireSpellList(t) : '' };
      });
    }
    return [];
  }

  /** Whether a stock line's "Trade for this" button is live — mirrors the three
   *  server disable conditions. */
  protected canTradeFor(stockItem: string): boolean {
    if (this.umoriTraded()) return false;
    const gives = this.qualifyingGiveOffers(stockItem);
    if (gives.length === 0) return false;
    // Taking gear grows the stash by one; if it's full and the only trade-in is the
    // equipped piece (also net +1), there's no room. A stashed give is net-zero.
    if (GEAR_MAP[stockItem] && this.stashFull() && !gives.some((o) => !o.equipped)) {
      return false;
    }
    const you = this.store.you();
    if (GRIMOIRE_MAP[stockItem] && (you?.grimoires ?? []).includes(stockItem)) return false;
    return true;
  }

  /** Within the picker, whether this specific trade-in can be handed over: an
   *  equipped gear give overflows a full stash (net +1); a stashed give is net-zero. */
  protected canUseGive(stockItem: string, give: TradeOffer): boolean {
    if (GEAR_MAP[stockItem] && give.equipped && this.stashFull()) return false;
    return true;
  }

  /** Tap a stock line: open its trade-in picker (clear any prior selection). */
  protected pickStock(index: number): void {
    this.selectedStock.set(index);
    this.giveItem.set(null);
  }
```

- [ ] **Step 3: Update `openTradingPost`, `trade`, and `closeFacilities` to manage `selectedStock`**

In `openTradingPost()`, after `this.giveItem.set(null);` add:

```typescript
    this.selectedStock.set(null);
```

Replace the `trade()` method body with (resets the picker on success):

```typescript
  /** Hand over the selected give item for stock slot `takeIndex`. */
  async trade(takeIndex: number): Promise<void> {
    const give = this.giveItem();
    if (!give) return;
    await this.run(async () => {
      const resp = await this.store.action('trade', { give, takeIndex });
      if (resp.stock) this.tradingStock.set(resp.stock);
      this.giveItem.set(null);
      this.selectedStock.set(null);
      this.showToast(resp.text ?? 'Traded.');
    });
  }
```

In `closeFacilities()`, next to `this.giveItem.set(null);` add:

```typescript
    this.selectedStock.set(null);
```

- [ ] **Step 4: Replace the trading-post modal markup**

In `board-tab.component.html`, replace the whole `@if (showTradingPost()) { ... }` block (currently ~lines 633-701) with:

```html
  @if (showTradingPost()) {
    <div class="uc-modal-backdrop" (click)="closeFacilities()">
      <div
        class="uc-modal trading-modal"
        (click)="$event.stopPropagation()"
        [style.background-image]="regionWashBg()"
      >
        <img class="modal-art" [src]="tradingKeeper.art" alt="" />
        <h3><mat-icon class="mi">swap_horiz</mat-icon> Trading Post</h3>
        <p class="shop-quote">“{{ tradingKeeper.quote }}”</p>
        @if (umoriTraded()) {
          <p class="modal-sub">
            You've already bartered with Umori this stop. Come back after it wanders on for another slot.
          </p>
        } @else {
          <p class="modal-sub">
            One upgrade per stop — pick a piece, then hand over one of yours of the same slot.
          </p>
        }

        <div class="shop-section">Umori is offering</div>
        @for (s of tradingStock(); track $index) {
          @let d = tradeStockDetail(s.item);
          <div class="shop-row" [attr.data-rarity]="d.rarity">
            <span class="shop-name">
              @if (d.kind === 'gear') {
                <mat-icon class="mi slot-mi" [svgIcon]="'uc-' + d.slot"></mat-icon>
              } @else {
                <mat-icon class="mi">{{ d.icon }}</mat-icon>
              }
              {{ d.label }}
              @if (d.rarity) {
                <span class="rarity-badge {{ d.rarity }}">{{ d.rarityLabel }}</span>
              }
              <em>{{ d.sub }}</em>
            </span>
            <button
              class="uc-btn shop-buy"
              [disabled]="busy() || !canTradeFor(s.item)"
              (click)="pickStock($index)"
            >
              Trade for this
            </button>
          </div>

          @if (selectedStock() === $index) {
            @let gives = qualifyingGiveOffers(s.item);
            <div class="trade-give-picker">
              <div class="shop-section">Hand over one — tap to select</div>
              @if (gives.length === 0) {
                <p class="trade-empty">You have nothing of that slot to trade.</p>
              } @else {
                <div class="trade-bag">
                  @for (o of gives; track $index) {
                    <button
                      class="trade-chip"
                      [class.selected]="giveItem() === o.id"
                      [attr.data-rarity]="o.rarity"
                      [disabled]="!canUseGive(s.item, o)"
                      (click)="giveItem.set(o.id)"
                    >
                      @if (o.kind === 'gear') {
                        <mat-icon class="mi slot-mi" [svgIcon]="'uc-' + o.slot"></mat-icon>
                      } @else {
                        <mat-icon class="mi">{{ o.icon }}</mat-icon>
                      }
                      {{ o.label }}
                      @if (o.equipped) {
                        <span class="rarity-badge equipped">Equipped</span>
                      }
                      @if (o.rarity) {
                        <span class="rarity-badge {{ o.rarity }}">{{ o.rarityLabel }}</span>
                      }
                    </button>
                  }
                </div>
                <button
                  class="uc-btn shop-buy confirm-trade"
                  [disabled]="busy() || !giveItem()"
                  (click)="trade($index)"
                >
                  Hand it over
                </button>
              }
            </div>
          }
        }
        <button class="uc-btn close-btn" (click)="closeFacilities()">Leave</button>
      </div>
    </div>
  }
```

- [ ] **Step 5: Add SCSS for the picker + equipped badge**

In `board-tab.component.scss`, add an `equipped` variant inside the existing `.rarity-badge { ... }` block (next to `&.legendary`):

```scss
  &.equipped { color: #7fd0ff; }
```

And add these new rules after the `.trade-empty` rule (~line 1101):

```scss
.trade-give-picker {
  margin: 4px 0 12px;
  padding-left: 10px;
  border-left: 2px solid rgba(255, 255, 255, 0.12);
}

.confirm-trade {
  margin-top: 8px;
}
```

- [ ] **Step 6: Build to verify it compiles**

Run (Bash tool): `npm run build`
Expected: build succeeds with no template/TS errors. (Confirm no leftover references to the removed `tradeOffers`/`canTakeStock` — grep the html/ts if the build complains.)

- [ ] **Step 7: Commit**

```bash
git add src/app/undercity/services/undercity-models.ts src/app/undercity/tabs/board-tab.component.ts src/app/undercity/tabs/board-tab.component.html src/app/undercity/tabs/board-tab.component.scss
git commit -m "feat(undercity): take-first Umori trade modal with same-slot trade-in picker"
```

---

## Task 5: Full verification

- [ ] **Step 1: Server suite green**

Run: `cd infrastructure/lambda && python -m pytest tests -q`
Expected: PASS (all Umori tests + the rest of the suite).

- [ ] **Step 2: Client build green**

Run (Bash tool): `npm run build`
Expected: build succeeds.

- [ ] **Step 3: Manual smoke (optional, needs live AWS backend)**

Per the `run-undercity` skill: `npm start`, enter Undercity, reach Umori's node. Verify: 4 stock lines (fang/carapace/charm + grimoire); "Trade for this" opens a picker of same-slot pieces with the worn one badged "Equipped"; a successful trade disables further barter this rotation and shows the "already bartered" note.

Deploy is the user's to run (backend `_trade`/state changes require `cdk deploy`). End with tests green and note the deploy is needed.

---

## Self-Review Notes

- **Spec coverage:** stock one-per-slot+grimoire (Task 1); same-slot/same-kind match, give-from-stash, once-per-rotation (Task 2); `umori.traded` (Task 3); take-first modal, equipped badge, disable mirrors (Task 4); verification (Task 5). All design sections mapped.
- **Type consistency:** `UMORI_STOCK_SPEC` keys `gear_per_slot`/`grimoire` and `UMORI_GEAR_SLOTS` used identically in data, `_umori_stock`, and the test. `umoriTradedWindow` set in `_trade` and read in `handle_state` + the once-per-rotation test. Client `TradeOffer.equipped` and `umori.traded` added in Task 4 step 1 before use.
- **No placeholders:** every code step is complete; the one lookup note (Task 3 `handle_state` call form) points at an existing test to copy, not a TODO.
