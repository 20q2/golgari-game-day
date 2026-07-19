# Renown Shop (pre-spawn) Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add a skippable pre-spawn Renown Shop to the Undercity hatch flow that spends a persistent, per-player renown balance on permanent hats/colors and one-night starter items.

**Architecture:** Renown is a new spendable int on the permanent doc (`UNDERCITYUSER#{uid}/META`), seeded small and banked from each night's `compute_renown` at close-out. The shop is a client-side cart that is one more step in the existing hatch flow; all purchases are committed atomically inside the existing `join` action, which validates and debits server-side (client prices are never trusted).

**Tech Stack:** Python 3.11 Lambda (pytest, in-memory FakeTable suite) + Angular 20 standalone components (no test runner — verify with `npm run build`).

Design spec: [specs/2026-07-18-renown-shop-design.md](2026-07-18-renown-shop-design.md)

---

## File map

**Backend (`infrastructure/lambda/`)**
- `undercity_config.py` — add `SHOP_START_RENOWN` scalar.
- `undercity_data.py` — add `HAT_PRICES`, `PAINT_PRICE`, `HAT_MAP`, `PAINT_MAP`, `RENOWN_SHOP_ITEMS`, `RENOWN_SHOP_ITEMS_MAP`.
- `undercity_db.py` — seed `renown` in `_get_perm`; surface it in the wardrobe payload (`_build_state`); bank it in `_archive_season`; add `_apply_shop_purchases` and wire it into `_join`.
- `tests/test_undercity_db.py` — new tests for seeding, banking, and the join-with-purchases paths.

**Frontend (`src/app/undercity/`)**
- `data/cosmetics.ts` — add `HAT_PRICES`, `PAINT_PRICE`.
- `data/items.ts` — add `RenownShopItem` + `RENOWN_SHOP_ITEMS`.
- `services/undercity-models.ts` — add `renown` to `Wardrobe`.
- `hatch/hatch-flow.component.ts` — shop step state, cart logic, extended `hatch()` payload.
- `hatch/hatch-flow.component.html` — the shop step markup.
- `hatch/hatch-flow.component.scss` — shop step styles.

---

## Task 1: Server price tables + tunables

**Files:**
- Modify: `infrastructure/lambda/undercity_config.py`
- Modify: `infrastructure/lambda/undercity_data.py:452-484` (near HATS/PAINTS)
- Test: `infrastructure/lambda/tests/test_undercity_db.py`

- [ ] **Step 1: Write the failing test**

Append to `tests/test_undercity_db.py`:

```python
def test_renown_shop_price_tables_are_sane():
    # Seed lets a brand-new player buy exactly one common hat OR one plain color.
    assert data.SHOP_START_RENOWN == 50
    assert data.HAT_PRICES == {'common': 50, 'uncommon': 120, 'legendary': 300}
    assert data.PAINT_PRICE == 40
    # Every hat/paint id resolves through the new maps.
    assert data.HAT_MAP['party_hat']['rarity'] == 'common'
    assert data.PAINT_MAP['crimson']['hue'] == 0
    # Starter kit: real item ids (or the synthetic spore pouch), each with a cost.
    ids = {i['id'] for i in data.RENOWN_SHOP_ITEMS}
    assert ids == {'healing_moss', 'rusted_fang', 'chitin_scrap', 'spore_pouch'}
    for it in data.RENOWN_SHOP_ITEMS:
        assert it['cost'] > 0 and it['kind'] in ('consumable', 'gear', 'spores')
    assert data.RENOWN_SHOP_ITEMS_MAP['spore_pouch']['amount'] == 15
```

- [ ] **Step 2: Run test to verify it fails**

Run: `cd infrastructure/lambda && python -m pytest tests/test_undercity_db.py::test_renown_shop_price_tables_are_sane -q`
Expected: FAIL with `AttributeError: module 'undercity_data' has no attribute 'SHOP_START_RENOWN'`.

- [ ] **Step 3: Add the config scalar**

In `undercity_config.py`, under the `# ── Facilities ──` section (near the other shop scalars, after line 46):

```python
# ── Renown shop (pre-spawn) ──────────────────────────────────────────────────
SHOP_START_RENOWN = 50       # seed for a brand-new player: one common hat OR one plain color
```

- [ ] **Step 4: Add the data tables**

In `undercity_data.py`, immediately after the `PAINTS`/`DEFAULT_PAINTS` block (after line 484):

```python
HAT_MAP = {h['id']: h for h in HATS}
PAINT_MAP = {p['id']: p for p in PAINTS}

# ── Renown shop (pre-spawn) prices ───────────────────────────────────────────
HAT_PRICES = {'common': 50, 'uncommon': 120, 'legendary': 300}
PAINT_PRICE = 40  # any non-default color

# Fixed one-night starter kit. Real ids grant from GEAR/CONSUMABLES; the
# synthetic 'spore_pouch' just adds `amount` Spores. Costs are in Renown.
RENOWN_SHOP_ITEMS = [
    {'id': 'healing_moss', 'kind': 'consumable', 'cost': 20},
    {'id': 'rusted_fang',  'kind': 'gear',       'cost': 25},
    {'id': 'chitin_scrap', 'kind': 'gear',       'cost': 25},
    {'id': 'spore_pouch',  'kind': 'spores', 'amount': 15, 'cost': 15},
]
RENOWN_SHOP_ITEMS_MAP = {i['id']: i for i in RENOWN_SHOP_ITEMS}
```

- [ ] **Step 5: Run test to verify it passes**

Run: `cd infrastructure/lambda && python -m pytest tests/test_undercity_db.py::test_renown_shop_price_tables_are_sane -q`
Expected: PASS.

- [ ] **Step 6: Commit**

```bash
git add infrastructure/lambda/undercity_config.py infrastructure/lambda/undercity_data.py infrastructure/lambda/tests/test_undercity_db.py
git commit -m "feat(undercity): renown-shop price tables + seed tunable"
```

---

## Task 2: Seed & surface the spendable renown balance

**Files:**
- Modify: `infrastructure/lambda/undercity_db.py:224-233` (`_get_perm`)
- Modify: `infrastructure/lambda/undercity_db.py:618-621` (wardrobe payload in `_build_state`)
- Test: `infrastructure/lambda/tests/test_undercity_db.py`

- [ ] **Step 1: Write the failing test**

```python
def test_new_player_is_seeded_with_renown_and_it_is_surfaced(table):
    act(table, 'join', starter='pest', home='city')
    status, state = db.handle_state(table, {'userId': 'user-alex'})
    assert status == 200
    assert state['wardrobe']['renown'] == data.SHOP_START_RENOWN
```

- [ ] **Step 2: Run test to verify it fails**

Run: `cd infrastructure/lambda && python -m pytest tests/test_undercity_db.py::test_new_player_is_seeded_with_renown_and_it_is_surfaced -q`
Expected: FAIL with `KeyError: 'renown'`.

- [ ] **Step 3: Seed renown in `_get_perm`**

Replace the default-doc block in `_get_perm` (lines 226-232) with:

```python
    if not doc:
        doc = {'pk': f'UNDERCITYUSER#{user_id}', 'sk': 'META',
               'seals': 0, 'hats': [], 'paints': list(data.DEFAULT_PAINTS),
               'nights': 0, 'lifetimePvpWins': 0, 'apexReached': 0,
               'renown': data.SHOP_START_RENOWN}
    doc.setdefault('renown', data.SHOP_START_RENOWN)  # backfill existing perm docs
    for p in data.DEFAULT_PAINTS:
        if p not in doc['paints']:
            doc['paints'].append(p)
```

- [ ] **Step 4: Surface renown in the wardrobe payload**

Replace the wardrobe block in `_build_state` (lines 619-621) with:

```python
        perm = _get_perm(table, user_id)
        out['wardrobe'] = {'hats': perm['hats'], 'paints': perm['paints'],
                           'seals': perm['seals'], 'nights': perm.get('nights', 0),
                           'renown': perm.get('renown', 0)}
```

- [ ] **Step 5: Run test to verify it passes**

Run: `cd infrastructure/lambda && python -m pytest tests/test_undercity_db.py::test_new_player_is_seeded_with_renown_and_it_is_surfaced -q`
Expected: PASS.

- [ ] **Step 6: Commit**

```bash
git add infrastructure/lambda/undercity_db.py infrastructure/lambda/tests/test_undercity_db.py
git commit -m "feat(undercity): seed + surface spendable renown balance"
```

---

## Task 3: Bank renown at night close-out

**Files:**
- Modify: `infrastructure/lambda/undercity_db.py:1057-1062` (`_archive_season` lifetime-stats block)
- Test: `infrastructure/lambda/tests/test_undercity_db.py`

- [ ] **Step 1: Write the failing test**

```python
def test_archive_banks_each_players_renown(table):
    # Fresh level-1 pest in cavern: compute_renown = 10*1 + 0 spores//5 = 10.
    act(table, 'join', starter='pest', home='cavern')
    status, resp = act(table, 'season-end', hostKey='swampking')
    assert status == 200
    perm = db._get_perm(table, 'user-alex')
    # Seed (50) + this night's earned renown (10).
    assert perm['renown'] == data.SHOP_START_RENOWN + 10
```

- [ ] **Step 2: Run test to verify it fails**

Run: `cd infrastructure/lambda && python -m pytest tests/test_undercity_db.py::test_archive_banks_each_players_renown -q`
Expected: FAIL — `perm['renown']` is still `50`, not `60`.

- [ ] **Step 3: Bank renown in `_archive_season`**

In `_archive_season`, inside the `for raw in resp['Items']:` loop, replace the lifetime-stats block (lines 1057-1062) with:

```python
        # Lifetime stats onto the permanent doc.
        perm = _get_perm(table, p['userId'])
        perm['lifetimePvpWins'] = perm.get('lifetimePvpWins', 0) + p.get('pvpWins', 0)
        if p.get('tier') == 3:
            perm['apexReached'] = perm.get('apexReached', 0) + 1
        # Bank this night's earned Renown for the pre-spawn shop.
        perm['renown'] = perm.get('renown', 0) + data.compute_renown(p)
        table.put_item(Item=perm)
```

- [ ] **Step 4: Run test to verify it passes**

Run: `cd infrastructure/lambda && python -m pytest tests/test_undercity_db.py::test_archive_banks_each_players_renown -q`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add infrastructure/lambda/undercity_db.py infrastructure/lambda/tests/test_undercity_db.py
git commit -m "feat(undercity): bank each night's renown at close-out"
```

---

## Task 4: Spend renown at join (the shop transaction)

**Files:**
- Modify: `infrastructure/lambda/undercity_db.py` — add `_apply_shop_purchases` just above `_join` (before line 1122); edit `_join` (lines 1134-1149).
- Test: `infrastructure/lambda/tests/test_undercity_db.py`

- [ ] **Step 1: Write the failing tests**

```python
def _fund(table, user, renown):
    """Give a not-yet-hatched player a fatter Renown wallet for a test."""
    perm = db._get_perm(table, user)
    perm['renown'] = renown
    table.put_item(Item=perm)


def test_join_buys_and_equips_permanent_cosmetics(table):
    _fund(table, 'user-alex', 200)  # afford a common hat (50) + a color (40)
    status, resp = act(table, 'join', starter='pest', home='city',
                       buyHats=['party_hat'], buyPaints=['crimson'],
                       equipHat='party_hat', equipPaint='crimson')
    assert status == 200, resp
    you = resp['you']
    assert you['hat'] == 'party_hat'
    assert you['paint']['body'] == 0 and you['paint']['stripes'] == 0  # crimson hue
    perm = db._get_perm(table, 'user-alex')
    assert 'party_hat' in perm['hats'] and 'crimson' in perm['paints']
    assert perm['renown'] == 200 - data.HAT_PRICES['common'] - data.PAINT_PRICE


def test_join_rejects_unaffordable_cart_without_charging(table):
    # Seed 50 can't cover a common hat (50) AND a paint (40) = 90.
    status, resp = act(table, 'join', starter='pest', home='city',
                       buyHats=['party_hat'], buyPaints=['crimson'])
    assert status == 409
    assert 'Renown' in resp['error']
    # No player doc, no perm mutation: a retry must still see the full seed.
    perm = db._get_perm(table, 'user-alex')
    assert perm['renown'] == data.SHOP_START_RENOWN
    assert perm['hats'] == [] and 'crimson' not in perm['paints']


def test_join_grants_one_night_starter_items(table):
    status, resp = act(table, 'join', starter='pest', home='city',
                       buyItems=['healing_moss', 'rusted_fang', 'spore_pouch'])
    assert status == 200, resp
    you = resp['you']
    assert 'healing_moss' in you['bag']
    assert you['gear']['fang'] == 'rusted_fang'
    assert you['spores'] == 15 + 15  # City Rat perk + spore pouch
    perm = db._get_perm(table, 'user-alex')
    assert perm['renown'] == data.SHOP_START_RENOWN - 20 - 25 - 15


def test_join_rejects_equipping_unowned_cosmetic(table):
    status, resp = act(table, 'join', starter='pest', home='city',
                       equipHat='crown')  # never bought
    assert status == 409
    assert 'own' in resp['error']


def test_join_with_no_purchases_is_unchanged(table):
    status, resp = act(table, 'join', starter='pest', home='city')
    assert status == 200
    assert resp['you']['hat'] is None
    assert db._get_perm(table, 'user-alex')['renown'] == data.SHOP_START_RENOWN


def test_rejoin_does_not_double_charge(table):
    act(table, 'join', starter='pest', home='city', buyHats=['party_hat'])
    before = db._get_perm(table, 'user-alex')['renown']
    # Idempotent re-join with a fresh cart must not spend again.
    status, resp = act(table, 'join', starter='pest', home='city', buyHats=['top_hat'])
    assert status == 200
    assert db._get_perm(table, 'user-alex')['renown'] == before
    assert 'top_hat' not in db._get_perm(table, 'user-alex')['hats']
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `cd infrastructure/lambda && python -m pytest tests/test_undercity_db.py -q -k "join_buys or unaffordable or starter_items or unowned_cosmetic or no_purchases or double_charge"`
Expected: FAIL (purchases ignored: no hat equipped, renown never debited).

- [ ] **Step 3: Add the `_apply_shop_purchases` helper**

Insert immediately above `def _join(` (before line 1122):

```python
def _apply_shop_purchases(perm, doc, payload):
    """Spend banked Renown at the pre-spawn shop, then equip chosen cosmetics.
    Validates the FULL cart before mutating anything, so a bad request leaves
    `perm` and `doc` untouched and costs the player nothing. Mutates both in
    place on success; returns an (status, body) error tuple on failure, else None."""
    buy_hats = list(dict.fromkeys(payload.get('buyHats') or []))
    buy_paints = list(dict.fromkeys(payload.get('buyPaints') or []))
    buy_items = list(payload.get('buyItems') or [])
    equip_hat = payload.get('equipHat') or None
    equip_paint = payload.get('equipPaint') or None

    total = 0
    for hid in buy_hats:
        h = data.HAT_MAP.get(hid)
        if not h:
            return _err(f'Unknown hat: {hid}')
        if hid in perm['hats']:
            return _err('You already own that hat.')
        total += data.HAT_PRICES[h['rarity']]
    for pid in buy_paints:
        if pid not in data.PAINT_MAP:
            return _err(f'Unknown color: {pid}')
        if pid in perm['paints']:
            return _err('You already own that color.')
        total += data.PAINT_PRICE
    grants = []
    for iid in buy_items:
        it = data.RENOWN_SHOP_ITEMS_MAP.get(iid)
        if not it:
            return _err(f'Unknown item: {iid}')
        total += it['cost']
        grants.append(it)

    if total > perm.get('renown', 0):
        return _err('Not enough Renown for that.', 409)

    n_bag = sum(1 for it in grants if it['kind'] == 'consumable')
    if len(doc.get('bag') or []) + n_bag > data.BAG_SIZE:
        return _err('Your bag can’t hold that many starter items.', 409)

    owned_hats = set(perm['hats']) | set(buy_hats)
    owned_paints = set(perm['paints']) | set(buy_paints)
    if equip_hat and equip_hat not in owned_hats:
        return _err('You do not own that hat.', 409)
    if equip_paint and equip_paint not in owned_paints:
        return _err('You do not own that color.', 409)

    # ── All validated — commit. ──────────────────────────────────────────────
    perm['renown'] = perm.get('renown', 0) - total
    perm['hats'] = perm['hats'] + buy_hats
    perm['paints'] = perm['paints'] + buy_paints
    for it in grants:
        if it['kind'] == 'consumable':
            doc['bag'].append(it['id'])
        elif it['kind'] == 'gear':
            doc['gear'][data.GEAR[it['id']]['slot']] = it['id']
        elif it['kind'] == 'spores':
            doc['spores'] = doc.get('spores', 0) + it['amount']
    if equip_hat:
        doc['hat'] = equip_hat
    if equip_paint:
        hue = data.PAINT_MAP[equip_paint]['hue']
        doc['paint'] = {'body': hue, 'belly': doc['paint'].get('belly', 50), 'stripes': hue}
    return None
```

- [ ] **Step 4: Wire it into `_join`**

In `_join`, replace the block from `perm = _get_perm(table, user_id)` through the `apply_banked_rewards(...)` call (lines 1134-1148) with:

```python
    perm = _get_perm(table, user_id)
    seals_before = perm.get('seals', 0)
    perm['seals'] = seals_before + 1
    perm['nights'] = perm.get('nights', 0) + 1

    s = data.STARTERS[starter]
    doc = _new_player_doc(
        sid, user_id, username, starter, home,
        seals_before=seals_before, egg_hue=payload.get('eggHue'),
        creature_name=creature_name,
    )
    # Spend banked Renown at the pre-spawn shop before we write anything: on any
    # validation failure this returns an error and no doc/perm is persisted.
    err = _apply_shop_purchases(perm, doc, payload)
    if err:
        return err
    table.put_item(Item=perm)

    # Deliver any board-game rewards banked while this player hadn't hatched yet
    # (mutates doc's rolls/bag, deletes the bank record, posts an event).
    apply_banked_rewards(table, sid, user_id, doc)
```

Note: the idempotent early return at the top of `_join` (existing player → `_ok(existing)`) already runs *before* this block, so a re-join never re-charges.

- [ ] **Step 5: Run the tests to verify they pass**

Run: `cd infrastructure/lambda && python -m pytest tests/test_undercity_db.py -q -k "join_buys or unaffordable or starter_items or unowned_cosmetic or no_purchases or double_charge"`
Expected: PASS.

- [ ] **Step 6: Run the whole backend suite (no regressions)**

Run: `cd infrastructure/lambda && python -m pytest tests -q`
Expected: PASS (all green).

- [ ] **Step 7: Commit**

```bash
git add infrastructure/lambda/undercity_db.py infrastructure/lambda/tests/test_undercity_db.py
git commit -m "feat(undercity): spend renown on cosmetics + starter items at join"
```

---

## Task 5: Client mirrors (prices, items, model)

**Files:**
- Modify: `src/app/undercity/data/cosmetics.ts`
- Modify: `src/app/undercity/data/items.ts`
- Modify: `src/app/undercity/services/undercity-models.ts:167-172` (`Wardrobe`)

- [ ] **Step 1: Add hat/paint prices to `cosmetics.ts`**

Append to `src/app/undercity/data/cosmetics.ts`:

```typescript
/** Renown prices (mirror HAT_PRICES / PAINT_PRICE in undercity_data.py). */
export const HAT_PRICES: Record<HatInfo['rarity'], number> = {
  common: 50,
  uncommon: 120,
  legendary: 300,
};
export const PAINT_PRICE = 40;
```

- [ ] **Step 2: Add the starter-kit mirror to `items.ts`**

Append to `src/app/undercity/data/items.ts`:

```typescript
/** Pre-spawn Renown shop starter kit (mirrors RENOWN_SHOP_ITEMS in
 * undercity_data.py). One-night items granted into the fresh player at spawn. */
export interface RenownShopItem {
  id: string;
  kind: 'consumable' | 'gear' | 'spores';
  /** Renown cost. */
  cost: number;
  name: string;
  desc: string;
  /** Material Icons ligature. */
  icon: string;
}

export const RENOWN_SHOP_ITEMS: RenownShopItem[] = [
  { id: 'healing_moss', kind: 'consumable', cost: 20, name: 'Healing Moss',
    desc: 'Spawn holding a heal (50% max HP).', icon: 'healing' },
  { id: 'rusted_fang', kind: 'gear', cost: 25, name: 'Rusted Fang',
    desc: 'Spawn with a +2 ATK fang equipped.', icon: 'colorize' },
  { id: 'chitin_scrap', kind: 'gear', cost: 25, name: 'Chitin Scrap',
    desc: 'Spawn with a +2 DEF carapace equipped.', icon: 'shield' },
  { id: 'spore_pouch', kind: 'spores', cost: 15, name: 'Spore Pouch',
    desc: 'Spawn with +15 Spores.', icon: 'grain' },
];
```

- [ ] **Step 3: Add `renown` to the `Wardrobe` model**

In `src/app/undercity/services/undercity-models.ts`, edit the `Wardrobe` interface (lines 167-172):

```typescript
export interface Wardrobe {
  hats: string[];
  paints: string[];
  seals: number;
  nights: number;
  /** Spendable renown balance for the pre-spawn shop. */
  renown: number;
}
```

- [ ] **Step 4: Verify the build compiles**

Run: `npm run build`
Expected: build succeeds (no TS errors).

- [ ] **Step 5: Commit**

```bash
git add src/app/undercity/data/cosmetics.ts src/app/undercity/data/items.ts src/app/undercity/services/undercity-models.ts
git commit -m "feat(undercity): client mirrors for renown shop prices + items"
```

---

## Task 6: Hatch component — shop step state, cart, extended join

**Files:**
- Modify: `src/app/undercity/hatch/hatch-flow.component.ts`

- [ ] **Step 1: Add imports**

In `hatch-flow.component.ts`, extend the existing cosmetics/items imports (lines 5-6 area):

```typescript
import { PAINTS, PAINT_MAP, HATS, HAT_MAP, HAT_PRICES, PAINT_PRICE } from '../data/cosmetics';
import { RENOWN_SHOP_ITEMS, RenownShopItem } from '../data/items';
```

- [ ] **Step 2: Add shop-step state + derived signals**

Inside the `HatchFlowComponent` class, after the existing `creatureName`/`nameValid` signals (after line 42), add:

```typescript
  /** True once the player has confirmed a name and entered the Renown shop. */
  protected readonly inShop = signal(false);

  protected readonly allHats = HATS;
  protected readonly hatPrices = HAT_PRICES;
  protected readonly paintPrice = PAINT_PRICE;
  protected readonly shopItems = RENOWN_SHOP_ITEMS;

  /** Cart: ids the player intends to buy this visit. */
  protected readonly cartHats = signal<string[]>([]);
  protected readonly cartPaints = signal<string[]>([]);
  protected readonly cartItems = signal<string[]>([]);
  /** Which owned/bought cosmetic to spawn wearing (null = none). */
  protected readonly equipHat = signal<string | null>(null);
  protected readonly equipPaint = signal<string | null>(null);

  protected readonly balance = computed(() => this.store.wardrobe()?.renown ?? 0);

  private hatPrice(id: string): number {
    return this.hatPrices[HAT_MAP[id].rarity];
  }

  /** Renown committed by the current cart. */
  protected readonly cartCost = computed(() => {
    let sum = 0;
    for (const h of this.cartHats()) sum += this.hatPrice(h);
    sum += this.cartPaints().length * this.paintPrice;
    for (const i of this.cartItems()) {
      const it = this.shopItems.find((s) => s.id === i);
      if (it) sum += it.cost;
    }
    return sum;
  });

  protected readonly remaining = computed(() => this.balance() - this.cartCost());

  private owned(list: string[] | undefined, id: string, cart: string[]): boolean {
    return !!list?.includes(id) || cart.includes(id);
  }

  protected ownsHat(id: string): boolean {
    return this.owned(this.store.wardrobe()?.hats, id, this.cartHats());
  }
  protected ownsPaint(id: string): boolean {
    return this.owned(this.store.wardrobe()?.paints, id, this.cartPaints());
  }

  /** Consumable slots the starter kit would use, guarded against BAG_SIZE (3). */
  private cartBagCount(): number {
    return this.cartItems().filter(
      (i) => this.shopItems.find((s) => s.id === i)?.kind === 'consumable',
    ).length;
  }
```

- [ ] **Step 3: Add cart toggle handlers**

Add these methods to the class (after `chooseBiome`, near line 97):

```typescript
  /** Advance from naming into the Renown shop. */
  enterShop(): void {
    if (!this.nameValid()) return;
    this.inShop.set(true);
  }

  private canAfford(delta: number): boolean {
    return this.remaining() - delta >= 0;
  }

  toggleHat(id: string): void {
    const cart = this.cartHats();
    if (cart.includes(id)) {
      this.cartHats.set(cart.filter((h) => h !== id));
      if (this.equipHat() === id && !this.store.wardrobe()?.hats?.includes(id)) {
        this.equipHat.set(null);
      }
    } else if (!this.ownsHat(id) && this.canAfford(this.hatPrice(id))) {
      this.cartHats.set([...cart, id]);
    }
  }

  togglePaint(id: string): void {
    const cart = this.cartPaints();
    if (cart.includes(id)) {
      this.cartPaints.set(cart.filter((p) => p !== id));
      if (this.equipPaint() === id && !this.store.wardrobe()?.paints?.includes(id)) {
        this.equipPaint.set(null);
      }
    } else if (!this.ownsPaint(id) && this.canAfford(this.paintPrice)) {
      this.cartPaints.set([...cart, id]);
    }
  }

  toggleItem(item: RenownShopItem): void {
    const cart = this.cartItems();
    if (cart.includes(item.id)) {
      this.cartItems.set(cart.filter((i) => i !== item.id));
    } else if (this.canAfford(item.cost)) {
      if (item.kind === 'consumable' && this.cartBagCount() >= 3) return;
      this.cartItems.set([...cart, item.id]);
    }
  }

  wearHat(id: string | null): void {
    this.equipHat.set(this.equipHat() === id ? null : id);
  }
  wearPaint(id: string | null): void {
    this.equipPaint.set(this.equipPaint() === id ? null : id);
  }
```

- [ ] **Step 4: Extend `hatch()` to send the cart**

Replace the `await this.store.action('join', {...})` call in `hatch()` (lines 111-116) with:

```typescript
      await this.store.action('join', {
        starter: starter.id,
        home: biome,
        eggHue: this.eggHue(),
        creatureName: this.creatureName().trim(),
        buyHats: this.cartHats(),
        buyPaints: this.cartPaints(),
        buyItems: this.cartItems(),
        equipHat: this.equipHat(),
        equipPaint: this.equipPaint(),
      });
```

- [ ] **Step 5: Verify the build compiles**

Run: `npm run build`
Expected: build succeeds. (The template changes come in Task 7; the added members are already referenced there, so an unused-member warning is acceptable but there should be no errors.)

- [ ] **Step 6: Commit**

```bash
git add src/app/undercity/hatch/hatch-flow.component.ts
git commit -m "feat(undercity): hatch-flow renown shop step state + cart"
```

---

## Task 7: Hatch component — shop step markup + styles

**Files:**
- Modify: `src/app/undercity/hatch/hatch-flow.component.html:46-75` (the name step)
- Modify: `src/app/undercity/hatch/hatch-flow.component.scss`

- [ ] **Step 1: Gate the name step on `!inShop()` and change its button**

In `hatch-flow.component.html`, change the name-step condition (line 46) from:

```html
  } @else if (chosenStarter() && chosenBiome()) {
```

to:

```html
  } @else if (inShop()) {
    <h1>The Renown Shop</h1>
    <p class="choose-hint">Spend banked Renown before you spawn. Hats &amp; colors are yours forever; items last one night.</p>
    <p class="renown-bal">
      <mat-icon class="mi">military_tech</mat-icon>
      {{ remaining() }} Renown
      @if (cartCost() > 0) { <span class="renown-spent">(−{{ cartCost() }})</span> }
    </p>
    @if (error(); as err) {
      <p class="error-text">{{ err }}</p>
    }

    <h2 class="shop-head">Hats <span class="shop-sub">permanent</span></h2>
    <div class="shop-grid">
      @for (hat of allHats; track hat.id) {
        <button
          class="shop-card"
          [class.owned]="ownsHat(hat.id)"
          [class.carted]="cartHats().includes(hat.id)"
          [class.worn]="equipHat() === hat.id"
          (click)="ownsHat(hat.id) ? wearHat(hat.id) : toggleHat(hat.id)"
        >
          <span class="shop-name">{{ hat.name }}</span>
          @if (ownsHat(hat.id)) {
            <span class="shop-tag">{{ equipHat() === hat.id ? 'wearing' : 'wear' }}</span>
          } @else {
            <span class="shop-cost">{{ hatPrices[hat.rarity] }}</span>
          }
        </button>
      }
    </div>

    <h2 class="shop-head">Colors <span class="shop-sub">permanent</span></h2>
    <div class="shop-grid">
      @for (paint of paints; track paint.id) {
        <button
          class="shop-card swatch-card"
          [class.owned]="ownsPaint(paint.id)"
          [class.carted]="cartPaints().includes(paint.id)"
          [class.worn]="equipPaint() === paint.id"
          (click)="ownsPaint(paint.id) ? wearPaint(paint.id) : togglePaint(paint.id)"
        >
          <span class="swatch" [style.background]="'hsl(' + paint.hue + ', 60%, 45%)'"></span>
          <span class="shop-name">{{ paint.name }}</span>
          @if (ownsPaint(paint.id)) {
            <span class="shop-tag">{{ equipPaint() === paint.id ? 'wearing' : 'wear' }}</span>
          } @else {
            <span class="shop-cost">{{ paintPrice }}</span>
          }
        </button>
      }
    </div>

    <h2 class="shop-head">Starter items <span class="shop-sub">one night</span></h2>
    <div class="shop-grid">
      @for (item of shopItems; track item.id) {
        <button
          class="shop-card"
          [class.carted]="cartItems().includes(item.id)"
          (click)="toggleItem(item)"
        >
          <mat-icon class="mi shop-item-icon">{{ item.icon }}</mat-icon>
          <span class="shop-name">{{ item.name }}</span>
          <span class="shop-desc">{{ item.desc }}</span>
          <span class="shop-cost">{{ item.cost }}</span>
        </button>
      }
    </div>

    <button class="hatch-btn" (click)="hatch()" [disabled]="joining()">
      Spawn into the world →
    </button>
    <button class="biome-back" (click)="inShop.set(false)" [disabled]="joining()">
      ← back to naming
    </button>
  } @else if (chosenStarter() && chosenBiome()) {
```

- [ ] **Step 2: Change the name-step "Hatch!" button to enter the shop**

Within the (now second) name-step block, replace the hatch button (lines 69-71) with:

```html
      <button class="hatch-btn" (click)="enterShop()" [disabled]="joining() || !nameValid()">
        Next: Renown Shop →
      </button>
```

- [ ] **Step 3: Add shop styles**

Append to `hatch-flow.component.scss` (reuse existing tokens/breakpoints per STYLE_GUIDE.md):

```scss
.renown-bal {
  display: inline-flex;
  align-items: center;
  gap: 0.35rem;
  font-weight: 700;
  font-size: 1.15rem;
  color: var(--accent-color);

  .renown-spent {
    color: #c98a8a;
    font-weight: 600;
  }
}

.shop-head {
  margin: 1.1rem 0 0.4rem;
  font-size: 0.95rem;
  text-transform: uppercase;
  letter-spacing: 0.06em;
  opacity: 0.85;

  .shop-sub {
    font-size: 0.7rem;
    opacity: 0.6;
    margin-left: 0.35rem;
  }
}

.shop-grid {
  display: grid;
  grid-template-columns: repeat(auto-fill, minmax(6.5rem, 1fr));
  gap: 0.5rem;
  width: min(560px, 92vw);
}

.shop-card {
  display: flex;
  flex-direction: column;
  align-items: center;
  gap: 0.25rem;
  padding: 0.5rem 0.4rem;
  border: 1px solid rgba(255, 255, 255, 0.15);
  border-radius: 0.6rem;
  background: rgba(20, 20, 24, 0.6);
  color: inherit;
  cursor: pointer;
  transition: border-color 0.15s, background 0.15s;

  &.carted {
    border-color: var(--accent-color);
    background: rgba(120, 90, 40, 0.35);
  }
  &.owned {
    opacity: 0.9;
  }
  &.worn {
    border-color: var(--primary-color);
    box-shadow: 0 0 0 1px var(--primary-color) inset;
  }

  .shop-name { font-size: 0.8rem; font-weight: 600; text-align: center; }
  .shop-desc { font-size: 0.68rem; opacity: 0.75; text-align: center; }
  .shop-cost { font-size: 0.78rem; font-weight: 700; color: var(--accent-color); }
  .shop-tag { font-size: 0.7rem; opacity: 0.8; }
  .shop-item-icon { font-size: 1.4rem; height: 1.4rem; width: 1.4rem; }
}

.swatch-card .swatch {
  width: 1.6rem;
  height: 1.6rem;
  border-radius: 50%;
  border: 1px solid rgba(255, 255, 255, 0.3);
}
```

- [ ] **Step 4: Verify the build**

Run: `npm run build`
Expected: build succeeds.

- [ ] **Step 5: Manual smoke test**

Run: `npm start`, open http://localhost:4200, enter the Undercity (click the navbar logo), and walk the hatch flow: tap egg → pick species → pick biome → name → **Next: Renown Shop**. Confirm:
- Balance shows 50 Renown.
- Buying a common hat (50) zeroes the remaining balance and blocks buying a color.
- A bought item shows as carted; toggling it off restores the balance.
- "Spawn into the world" places you on the board wearing any equipped hat/color, and the HUD renown reflects the debit after the next poll.

- [ ] **Step 6: Commit**

```bash
git add src/app/undercity/hatch/hatch-flow.component.html src/app/undercity/hatch/hatch-flow.component.scss
git commit -m "feat(undercity): renown shop step UI in the hatch flow"
```

---

## Self-review notes

- **Spec coverage:** balance on perm doc (Task 2) ✓; bank at close-out (Task 3) ✓; seed = 50 = one common hat or one color (Task 1) ✓; hats/colors permanent + items one-night (Task 4) ✓; shop every night, skippable (Tasks 6–7, always-enabled spawn button) ✓; fixed starter kit (Task 1/5) ✓; equip at spawn (Task 4/6) ✓; server-authoritative pricing (Task 1/4) ✓; tests (Tasks 2–4) ✓.
- **Prices consistent** across server (`undercity_data.py`) and client (`cosmetics.ts`/`items.ts`): hat 50/120/300, paint 40, items 20/25/25/15, seed 50.
- **Method-name consistency:** `_apply_shop_purchases` (server) referenced only in `_join`; client `toggleHat/togglePaint/toggleItem/wearHat/wearPaint/enterShop/hatch` all defined in Task 6 and used in Task 7.
- **Known limitation (acceptable, matches existing flow):** the cart is client-only until spawn; a mid-hatch refresh discards it, exactly as species/biome/name are discarded today.
```
