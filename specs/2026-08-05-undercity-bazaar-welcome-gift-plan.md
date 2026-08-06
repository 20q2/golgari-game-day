# Rot-Farm Bazaar First-Visit Welcome Gift — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** The first time in a run that a player lands on a bazaar unable to afford anything, the shopkeeper hands them a free random consumable (or a Molting if their bag is full).

**Architecture:** Server-authoritative — the gift is granted inside the `shop` branch of `_resolve_space` (the single landing event that opens the bazaar panel), so no new action or round-trip. Eligibility is a per-doc boolean flag (`bazaarWelcomeGift`) that resets naturally each night because the doc factory doesn't set it. The client reads a `welcomeGift` field on the shop `SpaceEvent` and renders a dialogue callout in the bazaar panel.

**Tech Stack:** Python 3.11 Lambda (`infrastructure/lambda/`), pytest (in-memory FakeTable suite). Angular 20 standalone component (`src/app/undercity/`). No frontend test runner — client tasks verify with `npm run build`.

**Design spec:** [specs/2026-08-05-undercity-bazaar-welcome-gift-design.md](2026-08-05-undercity-bazaar-welcome-gift-design.md)

**Note on commits:** There is unrelated uncommitted WIP in the repo (`hatch-flow.*`). Every commit step below uses **explicit file paths** — never `git add -A`/`git add .` — so the player's parallel work is never swept in. Confirm with the user before running commit steps if unsure.

---

### Task 1: Server — grant the welcome gift on shop landing (Python, TDD)

**Files:**
- Create: `infrastructure/lambda/tests/test_undercity_bazaar_welcome.py`
- Modify: `infrastructure/lambda/undercity_db.py` (add two helpers before `def _resolve_space` at line 3831; edit the `ntype == 'shop'` branch at lines 3944-3945)

Run all commands from `infrastructure/lambda/`.

- [ ] **Step 1: Write the failing tests**

Create `infrastructure/lambda/tests/test_undercity_bazaar_welcome.py`:

```python
import undercity_db as db

from tests.test_undercity_db import (  # noqa: F401
    table, act, _sid, _at_shop, _seed_shop)

data = db.data


def _land_broke(table, spores=0, bag=None):
    """Join, stand at a bazaar with a known cheap stock (cheapest line is
    healing_moss @ 12), set the purse/bag in-memory, and clear the first-visit
    flag so the next landing is a genuine first visit. Returns (sid, node, doc)."""
    sid, node = _at_shop(table, spores=spores)
    _seed_shop(table, sid, node)                 # gear rusted_fang@20, healing_moss@12, grimoire@25
    doc = db._get_player(table, sid, 'user-alex')
    doc['spores'] = spores
    if bag is not None:
        doc['bag'] = list(bag)
    doc.pop('bazaarWelcomeGift', None)
    return sid, node, doc


def test_broke_first_visit_gifts_a_consumable(table):
    sid, node, doc = _land_broke(table, spores=0, bag=[])
    ev = db._resolve_space(table, sid, doc, node, node)
    assert ev['type'] == 'shop'
    assert ev['welcomeGift']['kind'] == 'consumable'
    assert ev['welcomeGift']['item'] in data.CONSUMABLES
    assert ev['welcomeGift']['name'] == data.CONSUMABLES[ev['welcomeGift']['item']]['name']
    assert doc['bag'] == [ev['welcomeGift']['item']]   # the gift landed in the bag
    assert doc['bazaarWelcomeGift'] is True


def test_broke_first_visit_full_bag_gifts_a_molting(table):
    full = ['healing_moss'] * data.BAG_SIZE
    sid, node, doc = _land_broke(table, spores=0, bag=full)
    ev = db._resolve_space(table, sid, doc, node, node)
    assert ev['welcomeGift']['kind'] == 'material'
    assert ev['welcomeGift']['name'] == 'Molting'
    assert ev['welcomeGift']['amount'] == 1
    assert doc['materials']['moltings'] == 1
    assert len(doc['bag']) == data.BAG_SIZE            # bag untouched
    assert doc['bazaarWelcomeGift'] is True


def test_can_afford_cheapest_gets_no_gift(table):
    # 12 Spores buys the seeded Healing Moss -> not "can't buy anything".
    sid, node, doc = _land_broke(table, spores=12, bag=[])
    ev = db._resolve_space(table, sid, doc, node, node)
    assert 'welcomeGift' not in ev
    assert ev['text'] == 'The Rot-Farm Bazaar creaks open.'
    assert 'bazaarWelcomeGift' not in doc
    assert doc['bag'] == []


def test_second_visit_same_run_grants_nothing_new(table):
    sid, node, doc = _land_broke(table, spores=0, bag=[])
    db._resolve_space(table, sid, doc, node, node)     # first visit grants
    assert doc['bazaarWelcomeGift'] is True
    doc['bag'] = []                                    # pretend the bag emptied
    ev = db._resolve_space(table, sid, doc, node, node)  # second landing this run
    assert 'welcomeGift' not in ev
    assert doc['bag'] == []                            # nothing new granted
```

- [ ] **Step 2: Run the tests to verify they fail**

Run: `python -m pytest tests/test_undercity_bazaar_welcome.py -q`
Expected: FAIL — the shop event has no `welcomeGift` key (`KeyError`) because the feature isn't implemented yet.

- [ ] **Step 3: Add the two server helpers**

In `infrastructure/lambda/undercity_db.py`, insert immediately **before** `def _resolve_space(table, sid, doc, node, prev):` (line 3831):

```python
def _cheapest_stock_cost(stock):
    """Lowest price of anything currently buyable at this bazaar stock, across
    every category. Grimoires never deplete and are always stocked, so the
    result is effectively never None for a real bazaar."""
    costs = []
    for line in stock.get('gear', []):
        if line.get('qty', 0) > 0 and line['item'] in data.GEAR:
            costs.append(data.GEAR[line['item']]['cost'])
    for line in stock.get('consumables', []):
        if line.get('qty', 0) > 0 and line['item'] in data.CONSUMABLES:
            costs.append(data.CONSUMABLES[line['item']]['cost'])
    for gid in stock.get('grimoires', []):
        if gid in data.GRIMOIRES:
            costs.append(data.GRIMOIRES[gid]['cost'])
    for line in stock.get('eggs', []):
        if line.get('qty', 0) > 0 and 'cost' in line:
            costs.append(int(line['cost']))
    return min(costs) if costs else None


def _maybe_bazaar_welcome(doc, stock):
    """First-visit-in-a-run pity gift: a broke newcomer who can't afford the
    cheapest thing on the shelf gets one handout on the house. Once per run — the
    `bazaarWelcomeGift` flag is absent on each fresh night's doc, so it self-resets.
    A random consumable if the bag has room, otherwise a single Molting so the
    player always leaves with something. Mutates doc; returns the welcomeGift
    payload to fold into the shop event, or None when nothing is granted."""
    if doc.get('bazaarWelcomeGift'):
        return None
    cheapest = _cheapest_stock_cost(stock)
    if cheapest is None or doc.get('spores', 0) >= cheapest:
        return None
    doc['bazaarWelcomeGift'] = True
    if len(doc.get('bag', [])) < data.BAG_SIZE:
        item = _rng.choice(list(data.CONSUMABLES.keys()))
        doc.setdefault('bag', []).append(item)
        return {'kind': 'consumable', 'item': item,
                'name': data.CONSUMABLES[item]['name']}
    _mine_materials(doc, moltings=1)
    return {'kind': 'material', 'name': 'Molting', 'amount': 1}
```

- [ ] **Step 4: Wire the helper into the shop landing branch**

In `infrastructure/lambda/undercity_db.py`, replace the `ntype == 'shop'` branch (lines 3944-3945):

```python
    if ntype == 'shop':
        return {'type': 'shop', 'text': 'The Rot-Farm Bazaar creaks open.'}
```

with:

```python
    if ntype == 'shop':
        gift = _maybe_bazaar_welcome(doc, _shop_stock(table, sid, node))
        if gift:
            if gift['kind'] == 'material':
                text = ("New face — and not a spore to your name? The Rot-Farm "
                        "doesn't send anyone off empty-handed. Your satchel's "
                        "stuffed, so take a fresh Molting from the scrap bin instead.")
            else:
                text = ("New face — and not a spore to your name? The Rot-Farm "
                        f"doesn't send anyone off empty-handed. Here, a {gift['name']}, "
                        "on the house. Come back when your purse rattles.")
            return {'type': 'shop', 'text': text, 'welcomeGift': gift}
        return {'type': 'shop', 'text': 'The Rot-Farm Bazaar creaks open.'}
```

- [ ] **Step 5: Run the new tests to verify they pass**

Run: `python -m pytest tests/test_undercity_bazaar_welcome.py -q`
Expected: PASS — all 4 tests green.

- [ ] **Step 6: Run the full Lambda suite (no regressions)**

Run: `python -m pytest tests -q`
Expected: PASS — the whole suite stays green.

- [ ] **Step 7: Commit**

```bash
git add infrastructure/lambda/undercity_db.py infrastructure/lambda/tests/test_undercity_bazaar_welcome.py
git commit -m "feat(undercity): first-visit welcome gift at the Rot-Farm Bazaar"
```

---

### Task 2: Client — type, signal, and event wiring (TypeScript)

**Files:**
- Modify: `src/app/undercity/services/undercity-models.ts` (add `WelcomeGift` interface + `welcomeGift?` on `SpaceEvent`)
- Modify: `src/app/undercity/tabs/board-tab.component.ts` (signal, icon helper, set in shop branch, clear on close)

Run build commands from the repo root.

- [ ] **Step 1: Add the `WelcomeGift` type and the `SpaceEvent` field**

In `src/app/undercity/services/undercity-models.ts`, add this interface immediately above `export interface SpaceEvent {` (line 656):

```typescript
/** The Rot-Farm Bazaar's first-visit handout (mirrors undercity_db._maybe_bazaar_welcome):
 *  a random consumable, or a Molting when the bag was full. */
export interface WelcomeGift {
  kind: 'consumable' | 'material';
  /** Consumable id (present only when kind === 'consumable'). */
  item?: string;
  /** Display name — the consumable's name, or "Molting". */
  name: string;
  /** Quantity for the material case (1). */
  amount?: number;
}
```

Then, inside the `SpaceEvent` interface, add the field (place it right after the `materials?:` field at line 678):

```typescript
  /** Present only on a first-visit bazaar landing where the shopkeeper gifts a
   *  broke newcomer (mirrors undercity_db shop branch). Drives the panel callout. */
  welcomeGift?: WelcomeGift;
```

- [ ] **Step 2: Add the signal and icon helper on the component**

In `src/app/undercity/tabs/board-tab.component.ts`, ensure `WelcomeGift` is imported from the models module (add it to the existing `undercity-models` import group). Then, next to the other shop signals (near `showShop`/`shopTab` at lines 353-357), add:

```typescript
  /** The current bazaar's first-visit gift dialogue, carried from the shop
   *  SpaceEvent (`line` = the shopkeeper's text). Null when no gift was given.
   *  Cleared when the shop closes. */
  protected readonly welcomeGift = signal<(WelcomeGift & { line: string }) | null>(null);

  /** Material icon for the welcome-gift callout: the consumable's icon, or grass
   *  for the Molting fallback (matches the game's molting symbol). */
  protected welcomeGiftIcon(): string {
    const g = this.welcomeGift();
    if (!g) return '';
    return g.kind === 'material' ? 'grass' : (CONSUMABLE_MAP[g.item ?? '']?.icon ?? 'redeem');
  }
```

(`CONSUMABLE_MAP` and `signal` are already imported in this file.)

- [ ] **Step 3: Populate the signal in the shop landing branch**

In `src/app/undercity/tabs/board-tab.component.ts`, in `routeSpaceEvent`, replace the `ev.type === 'shop'` branch (lines 2351-2354):

```typescript
    } else if (ev.type === 'shop') {
      this.shopTab.set('gear');
      this.showShop.set(true);
      this.store.openFacility.set({ kind: 'shop', shopTab: 'gear' });
```

with:

```typescript
    } else if (ev.type === 'shop') {
      this.shopTab.set('gear');
      this.welcomeGift.set(ev.welcomeGift ? { ...ev.welcomeGift, line: ev.text } : null);
      this.showShop.set(true);
      this.store.openFacility.set({ kind: 'shop', shopTab: 'gear' });
```

- [ ] **Step 4: Clear the signal when facilities close**

In `src/app/undercity/tabs/board-tab.component.ts`, in `closeFacilities()` (line 3077), add a clear line right after `this.showShop.set(false);` (line 3078):

```typescript
  closeFacilities(): void {
    this.showShop.set(false);
    this.welcomeGift.set(null);
    this.showShrine.set(false);
```

- [ ] **Step 5: Build to verify the TypeScript compiles**

Run: `npm run build`
Expected: build succeeds with no TypeScript errors. (The `welcomeGift` signal is set but not yet read by a template — that's fine; it's rendered in Task 3.)

- [ ] **Step 6: Commit**

```bash
git add src/app/undercity/services/undercity-models.ts src/app/undercity/tabs/board-tab.component.ts
git commit -m "feat(undercity): carry bazaar welcome gift into the shop panel state"
```

---

### Task 3: Client — render the shopkeeper dialogue callout (HTML + SCSS)

**Files:**
- Modify: `src/app/undercity/tabs/board-tab.component.html` (callout under the keeper quote, ~line 598)
- Modify: `src/app/undercity/tabs/board-tab.component.scss` (callout styles)

- [ ] **Step 1: Replace the keeper quote with the gift callout when a gift is present**

In `src/app/undercity/tabs/board-tab.component.html`, replace the single quote line (line 598):

```html
        <p class="shop-quote">“{{ bazaarKeeper().quote }}”</p>
```

with:

```html
        @if (welcomeGift(); as gift) {
          <div class="shop-welcome">
            <p class="shop-welcome-line">“{{ gift.line }}”</p>
            <span class="shop-welcome-item">
              <mat-icon class="mi">{{ welcomeGiftIcon() }}</mat-icon>
              <strong>{{ gift.name }}</strong>@if (gift.kind === 'material') { <span>×{{ gift.amount ?? 1 }}</span> }
            </span>
          </div>
        } @else {
          <p class="shop-quote">“{{ bazaarKeeper().quote }}”</p>
        }
```

- [ ] **Step 2: Add the callout styles**

In `src/app/undercity/tabs/board-tab.component.scss`, add (near the existing `.shop-quote` rule, so bazaar styles stay together):

```scss
.shop-welcome {
  margin: 0 0 0.6rem;
  padding: 0.55rem 0.75rem;
  border-radius: 8px;
  background: rgba(154, 205, 50, 0.12);        // molting-green tint, on-brand
  border: 1px solid rgba(154, 205, 50, 0.4);
  text-align: center;

  .shop-welcome-line {
    margin: 0 0 0.4rem;
    font-style: italic;
    opacity: 0.92;
  }

  .shop-welcome-item {
    display: inline-flex;
    align-items: center;
    gap: 0.3rem;
    font-size: 0.95rem;

    .mi {
      font-size: 1.15rem;
    }
  }
}
```

- [ ] **Step 3: Build to verify the template compiles**

Run: `npm run build`
Expected: build succeeds — no Angular template or SCSS errors.

- [ ] **Step 4: Manual verification (optional but recommended)**

Use the `run-undercity` skill to drive the game in a browser. Reach a bazaar with 0 Spores on a fresh creature and confirm: the panel shows the shopkeeper's "on the house" line + the gifted item chip, and the item appears in the bag (or, with a full bag, moltings increment on the creature). See [.claude/skills/run-undercity](../.claude/skills/run-undercity/SKILL.md) for reaching a shop landing on the live AWS backend.

- [ ] **Step 5: Commit**

```bash
git add src/app/undercity/tabs/board-tab.component.html src/app/undercity/tabs/board-tab.component.scss
git commit -m "feat(undercity): shopkeeper welcome-gift dialogue callout in the bazaar panel"
```

---

## Self-Review

**Spec coverage:**
- Server-authoritative in the shop landing branch → Task 1, Steps 3-4. ✓
- Two-gate eligibility (flag unset + can't afford cheapest in-stock) → `_maybe_bazaar_welcome` + `_cheapest_stock_cost`, Step 3. ✓
- Per-run flag that self-resets each night (doc factory never sets `bazaarWelcomeGift`) → covered; nothing to add to the factory. ✓
- Random consumable from all `CONSUMABLES`, not from stock, no stock depletion → Step 3 (`_rng.choice(list(data.CONSUMABLES.keys()))`, no stock write). ✓
- Bag-full fallback → 1 Molting via `_mine_materials` → Step 3. ✓
- `welcomeGift` payload shape (`{kind, item, name}` / `{kind, name, amount}`) → Step 3 returns; mirrored by `WelcomeGift` type in Task 2 Step 1. ✓
- Special shopkeeper dialogue (consumable + molting variants, no emoji) → Step 4. ✓
- Client stores gift + clears on close; renders callout with correct icon (consumable icon / grass) → Task 2 Steps 2-4, Task 3 Steps 1-2. ✓
- Tests: broke+room, broke+full-bag, can-afford, second-visit → Task 1 Step 1. ✓
- No balance-number or client data-mirror changes → none in the plan. ✓

**Placeholder scan:** No TBD/TODO/"handle edge cases" — every code step is complete. ✓

**Type consistency:** `WelcomeGift` (`kind`/`item`/`name`/`amount`) matches the server payload keys and the `welcomeGiftIcon()` reads (`g.kind`, `g.item`). The signal type `WelcomeGift & { line: string }` matches the setter `{ ...ev.welcomeGift, line: ev.text }`. Helper names `_cheapest_stock_cost` / `_maybe_bazaar_welcome` are used consistently in Steps 3-4 and referenced by the tests only through `_resolve_space`. ✓
