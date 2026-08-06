# Scout Courier Reuses the Bazaar Shop UI — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Replace the bespoke Scout Courier list modal with the board's real bazaar shop modal running in a "courier mode": shopkeeper + pet header, tier-cap locks, and a Deliver→"Purchase for X Spores" one-item checkout that reuses `pet-scout-buy`.

**Architecture:** Add a `shopMode` flag and an `activeBazaar()` source-swap to the board shop modal so the same tabs/rows render for walk-in or courier trips; add a one-item cart + checkout for courier mode; remove the old courier modal from both tabs; make the creature-tab scout an informational chip. Server rules unchanged except an additive `refreshesAt` on the peek response.

**Tech Stack:** Angular 20 standalone signals component (no frontend test runner — verify with `npm run build`); Python 3.11 Lambda (pytest + in-memory `FakeTable`).

**Reference spec:** [specs/2026-08-06-undercity-scout-courier-shop-reuse-design.md](2026-08-06-undercity-scout-courier-shop-reuse-design.md)

**Backend tests from** `infrastructure/lambda/`: `python -m pytest tests -q` (≈49 pre-existing WIP failures in map/deep-dungeon/engine/spells are unrelated — keep the scout + companions suites green).

---

## File structure

| File | Responsibility | Change |
|------|----------------|--------|
| `src/app/undercity/tabs/board-tab.component.ts` | courier-mode state, cart, source-swap, remove old courier members | Modify |
| `src/app/undercity/tabs/board-tab.component.html` | courier header, tier-locked Deliver buttons, checkout bar, remove old courier modal | Modify |
| `src/app/undercity/tabs/creature-tab.component.ts` | remove courier members, clean unused imports | Modify |
| `src/app/undercity/tabs/creature-tab.component.html` | scout button → info chip, remove courier modal | Modify |
| `infrastructure/lambda/undercity_db.py` | add `refreshesAt` to `_pet_scout_peek` (optional polish) | Modify |
| `infrastructure/lambda/tests/test_undercity_scout_remote_buy.py` | assert peek `refreshesAt` | Modify |

Do Task 1 and Task 2 back-to-back (the board TS and its template reference each other); build only after Task 2.

---

## Task 1: Board-tab TS — courier mode, cart, source-swap

**Files:** Modify `src/app/undercity/tabs/board-tab.component.ts`

- [ ] **Step 1: Remove the old bespoke-courier members**

Delete this whole block (the `scoutOpen` signal through `scoutBuy`, currently ~lines 321–370):

```typescript
  // ── Scout courier: peek the biome bazaar (free), haul back one tier-capped item
  protected readonly scoutOpen = signal(false);
  protected readonly scoutView = signal<{ node: string; tierCap: number; stock: BazaarView } | null>(null);
  protected readonly gearMapRef = GEAR_MAP;

  /** True while the active scout's shared cooldown has NOT elapsed (buy-gated). */
  protected scoutOnCooldown(): boolean {
    const pet = this.activeUsablePet();
    return !!pet && petRole(pet.species) === 'scout' && !this.petAbilityReady(pet);
  }

  async openScoutCourier(): Promise<void> {
    this.scoutView.set(null);
    await this.run(async () => {
      const resp = await this.store.action('pet-scout-peek', {});
      const pa = (resp as { petAbility?: { node: string; tierCap: number; stock: BazaarView } }).petAbility;
      if (pa) {
        this.scoutView.set(pa);
        this.scoutOpen.set(true);
      } else {
        this.showToast(resp.text ?? 'Your scout finds no bazaar nearby.');
      }
    });
  }

  protected closeScoutCourier(): void {
    this.scoutOpen.set(false);
  }

  /** Gear locked because its tier exceeds the scout's ceiling. */
  protected scoutGearLocked(item: string): boolean {
    const cap = this.scoutView()?.tierCap ?? 0;
    return (GEAR_MAP[item]?.tier ?? 99) > cap;
  }
  protected scoutEggLocked(tier: number): boolean {
    return tier > (this.scoutView()?.tierCap ?? 0);
  }

  /** Haul one item back. `payload` mirrors the shop buy contract (itemId, or
   *  {kind:'egg', tier}). Re-peeks so depleted stock + the armed cooldown show. */
  async scoutBuy(payload: Record<string, unknown>): Promise<void> {
    if (this.scoutOnCooldown()) return;
    await this.run(async () => {
      const resp = await this.store.action('pet-scout-buy', payload);
      this.showToast(resp.text ?? 'Your scout hauls it back.');
    });
    const resp = await this.store.action('pet-scout-peek', {}).catch(() => null);
    const pa = (resp as { petAbility?: { node: string; tierCap: number; stock: BazaarView } } | null)?.petAbility;
    if (pa) this.scoutView.set(pa);
  }
```

- [ ] **Step 2: Add the courier-mode state + helpers**

Paste this in the same location (replacing what you deleted). It keeps `scoutView`/`scoutOnCooldown` (now reused by the shop modal) and adds `shopMode`, the cart, peek/open, tier-lock, staging, and checkout:

```typescript
  // ── Scout courier: the board shop modal runs in a 'courier' mode driven by a
  //    free peek of the biome bazaar; one staged item checks out per cooldown.
  protected readonly scoutView = signal<{ node: string; tierCap: number; stock: BazaarView } | null>(null);
  protected readonly shopMode = signal<'shop' | 'courier'>('shop');
  protected readonly cartItem = signal<CartItem | null>(null);

  /** True while the active scout's shared cooldown has NOT elapsed (buy-gated). */
  protected scoutOnCooldown(): boolean {
    const pet = this.activeUsablePet();
    return !!pet && petRole(pet.species) === 'scout' && !this.petAbilityReady(pet);
  }

  /** Open the real shop modal in courier mode: free peek → stock/tierCap, then
   *  reuse the bazaar UI. Toasts (and stays closed) when there's no reachable
   *  bazaar or no active scout. */
  async openShopCourier(): Promise<void> {
    this.scoutView.set(null);
    this.cartItem.set(null);
    await this.run(async () => {
      const resp = await this.store.action('pet-scout-peek', {});
      const pa = (resp as { petAbility?: { node: string; tierCap: number; stock: BazaarView } }).petAbility;
      if (pa) {
        this.scoutView.set(pa);
        this.shopMode.set('courier');
        this.shopTab.set('gear');
        this.showShop.set(true);
      } else {
        this.showToast(resp.text ?? 'Your scout finds no bazaar nearby.');
      }
    });
  }

  /** Display name of the active pet for the courier header line. */
  protected courierPetName(): string {
    const pet = this.activeUsablePet();
    return pet ? petInfo(pet.species).name : 'scout';
  }

  /** In courier mode, is this item tier above the scout's ceiling? (gear/eggs only) */
  protected courierTierLocked(tier: number): boolean {
    return this.shopMode() === 'courier' && tier > (this.scoutView()?.tierCap ?? 0);
  }

  /** Stage (or un-stage) a single item for courier checkout. No-op while resting. */
  protected stage(item: CartItem): void {
    if (this.scoutOnCooldown()) return;
    this.cartItem.update((cur) => (cur?.key === item.key ? null : item));
  }
  protected isStaged(key: string): boolean {
    return this.cartItem()?.key === key;
  }
  protected stageGear(info: GearInfo): void {
    this.stage({ key: `gear:${info.id}`, name: info.name, cost: info.cost, payload: { itemId: info.id } });
  }
  protected stageConsumable(info: ConsumableInfo): void {
    this.stage({ key: `consumable:${info.id}`, name: info.name, cost: info.cost, payload: { itemId: info.id } });
  }
  protected stageGrimoire(g: GrimoireInfo): void {
    this.stage({ key: `grimoire:${g.id}`, name: g.name, cost: g.cost, payload: { itemId: g.id } });
  }
  protected stageEgg(e: { tier: number; cost: number }): void {
    this.stage({ key: `egg:${e.tier}`, name: `${tierRarity(e.tier).label} Egg`, cost: e.cost, payload: { kind: 'egg', tier: e.tier } });
  }

  /** Commit the staged item via pet-scout-buy (arms the cooldown), then close. */
  async checkoutCourier(): Promise<void> {
    const item = this.cartItem();
    if (!item || this.scoutOnCooldown()) return;
    await this.run(async () => {
      const resp = await this.store.action('pet-scout-buy', item.payload);
      this.showToast(resp.text ?? 'Your scout hauls it back.');
    });
    this.closeFacilities();
  }
```

- [ ] **Step 3: Define the `CartItem` interface**

Near the top of the file, beside the other local interfaces (e.g. just above the `@Component` decorator or with the other `interface` declarations), add:

```typescript
/** One staged courier purchase (at most one at a time). `key` uniquely identifies
 *  the row for the "In cart" highlight; `payload` is the pet-scout-buy body. */
interface CartItem {
  key: string;
  name: string;
  cost: number;
  payload: Record<string, unknown>;
}
```

- [ ] **Step 4: Point the shop data source at `activeBazaar()`**

Add an `activeBazaar` computed right after the existing `currentBazaar` computed (~line 999):

```typescript
  /** The bazaar the shop modal renders: the peeked biome stock in courier mode,
   *  else the shop at the player's position. */
  protected readonly activeBazaar = computed<BazaarView | null>(() =>
    this.shopMode() === 'courier' ? (this.scoutView()?.stock ?? null) : this.currentBazaar(),
  );
```

Then change the four row getters, `bazaarRestockLabel`, and `bazaarKeeper` to read `activeBazaar()` instead of `currentBazaar()`:

- In `shopGearRows` (~1071): `(this.currentBazaar()?.gear ?? [])` → `(this.activeBazaar()?.gear ?? [])`
- In `shopConsumableRows` (~1113): `(this.currentBazaar()?.consumables ?? [])` → `(this.activeBazaar()?.consumables ?? [])`
- In `shopGrimoireRows` (~1119): `(this.currentBazaar()?.grimoires ?? [])` → `(this.activeBazaar()?.grimoires ?? [])`
- In `shopEggRows` (~1125): `(this.currentBazaar()?.eggs ?? [])` → `(this.activeBazaar()?.eggs ?? [])`
- In `bazaarRestockLabel` (~1144): `const at = this.currentBazaar()?.refreshesAt;` → `const at = this.activeBazaar()?.refreshesAt;`
- In `bazaarKeeper` (~1187): `const at = this.currentBazaar()?.refreshesAt;` → `const at = this.activeBazaar()?.refreshesAt;`

(Walk-in behavior is unchanged: when `shopMode()==='shop'`, `activeBazaar()` returns exactly `currentBazaar()`.)

- [ ] **Step 5: Route the scout box to courier mode**

In `tapBoardPet` (~310), change the scout branch call from the removed `openScoutCourier` list modal to the new shop-courier opener (the method name is the same `openShopCourier` — update the call):

```typescript
    if (petRole(pet.species) === 'scout') {
      await this.openShopCourier();
      return;
    }
```

- [ ] **Step 6: Reset courier state on close**

In `closeFacilities` (~3132), add these resets alongside `this.showShop.set(false)`:

```typescript
    this.showShop.set(false);
    this.shopMode.set('shop');
    this.cartItem.set(null);
    this.scoutView.set(null);
```

- [ ] **Step 7: Confirm imports**

`GearInfo`, `ConsumableInfo`, `GrimoireInfo` are referenced by the new stage methods — they're already imported (used by `shopGearRows`/`shopConsumableRows`/`shopGrimoireRows`). `petInfo`, `petRole`, `tierRarity`, `BazaarView`, `GEAR_MAP` are already imported. No new imports needed. `gearMapRef` was removed — grep `gearMapRef` in the board template (Task 2 replaces its only remaining use).

Do NOT build yet — the template still references removed members. Build at the end of Task 2.

---

## Task 2: Board-tab template — courier header, Deliver buttons, checkout, remove old modal

**Files:** Modify `src/app/undercity/tabs/board-tab.component.html`

- [ ] **Step 1: Courier header (shopkeeper + pet + line)**

Replace the header dialogue block (currently ~611–621):

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

with (courier branch first):

```html
        @if (shopMode() === 'courier') {
          <div class="shop-welcome courier-welcome">
            @if (activeUsablePet(); as pet) {
              <img class="pet-sprite courier-pet" [src]="petSpriteUrl(pet.species)" alt="" />
            }
            <p class="shop-welcome-line">
              Your {{ courierPetName() }} drops your coin-pouch on the counter — point it at
              <strong>one</strong> thing and it’ll haul it back (up to {{ tierRarity(scoutView()?.tierCap ?? 1).label }}).
            </p>
          </div>
        } @else if (welcomeGift(); as gift) {
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

- [ ] **Step 2: Gear tab — tier lock + Deliver/stage button**

Replace the gear row's button + reason (currently ~661–668):

```html
                <button
                  class="uc-btn shop-buy"
                  [disabled]="busy() || !canAfford(r.info.cost) || !!shopGearReason(r.info, r.qty)"
                  (click)="buy(r.info)"
                >
                  {{ r.info.cost }} <img class="rot-coin" src="undercity/icons/rot.png" alt="Spores" />
                </button>
                @if (!busy() && shopGearReason(r.info, r.qty); as reason) { <span class="block-reason">{{ reason }}</span> }
```

with:

```html
                @if (shopMode() === 'courier') {
                  <button
                    class="uc-btn shop-buy"
                    [class.staged]="isStaged('gear:' + r.info.id)"
                    [disabled]="busy() || scoutOnCooldown() || courierTierLocked(r.info.tier) || !!shopGearReason(r.info, r.qty)"
                    (click)="stageGear(r.info)"
                  >
                    {{ isStaged('gear:' + r.info.id) ? 'In cart' : 'Deliver · ' + r.info.cost }}
                  </button>
                  @if (courierTierLocked(r.info.tier)) { <span class="block-reason">Merge your scout to reach {{ tierRarity(r.info.tier).label }}</span> }
                  @else if (scoutOnCooldown()) { <span class="block-reason">Your scout is resting.</span> }
                  @else if (shopGearReason(r.info, r.qty); as reason) { <span class="block-reason">{{ reason }}</span> }
                } @else {
                  <button
                    class="uc-btn shop-buy"
                    [disabled]="busy() || !canAfford(r.info.cost) || !!shopGearReason(r.info, r.qty)"
                    (click)="buy(r.info)"
                  >
                    {{ r.info.cost }} <img class="rot-coin" src="undercity/icons/rot.png" alt="Spores" />
                  </button>
                  @if (!busy() && shopGearReason(r.info, r.qty); as reason) { <span class="block-reason">{{ reason }}</span> }
                }
```

- [ ] **Step 3: Consumables tab — Deliver/stage button**

Replace the consumable row button (currently ~684–687):

```html
                <button class="uc-btn shop-buy" [disabled]="busy() || !canAfford(r.info.cost) || !!shopConsumableReason(r.info, r.qty)" (click)="buy(r.info)">
                  {{ r.info.cost }} <img class="rot-coin" src="undercity/icons/rot.png" alt="Spores" />
                </button>
                @if (!busy() && shopConsumableReason(r.info, r.qty); as reason) { <span class="block-reason">{{ reason }}</span> }
```

with:

```html
                @if (shopMode() === 'courier') {
                  <button class="uc-btn shop-buy" [class.staged]="isStaged('consumable:' + r.info.id)"
                          [disabled]="busy() || scoutOnCooldown() || !!shopConsumableReason(r.info, r.qty)"
                          (click)="stageConsumable(r.info)">
                    {{ isStaged('consumable:' + r.info.id) ? 'In cart' : 'Deliver · ' + r.info.cost }}
                  </button>
                  @if (scoutOnCooldown()) { <span class="block-reason">Your scout is resting.</span> }
                  @else if (shopConsumableReason(r.info, r.qty); as reason) { <span class="block-reason">{{ reason }}</span> }
                } @else {
                  <button class="uc-btn shop-buy" [disabled]="busy() || !canAfford(r.info.cost) || !!shopConsumableReason(r.info, r.qty)" (click)="buy(r.info)">
                    {{ r.info.cost }} <img class="rot-coin" src="undercity/icons/rot.png" alt="Spores" />
                  </button>
                  @if (!busy() && shopConsumableReason(r.info, r.qty); as reason) { <span class="block-reason">{{ reason }}</span> }
                }
```

- [ ] **Step 4: Grimoires tab — Deliver/stage button**

Replace the grimoire row button (currently ~703–705):

```html
                <button class="uc-btn shop-buy" [disabled]="busy() || ownsGrimoire(g.id) || !canAfford(g.cost)" (click)="buy(g)">
                  {{ g.cost }} <img class="rot-coin" src="undercity/icons/rot.png" alt="Spores" />
                </button>
```

with:

```html
                @if (shopMode() === 'courier') {
                  <button class="uc-btn shop-buy" [class.staged]="isStaged('grimoire:' + g.id)"
                          [disabled]="busy() || scoutOnCooldown() || ownsGrimoire(g.id)"
                          (click)="stageGrimoire(g)">
                    {{ isStaged('grimoire:' + g.id) ? 'In cart' : (ownsGrimoire(g.id) ? 'Owned' : 'Deliver · ' + g.cost) }}
                  </button>
                  @if (scoutOnCooldown() && !ownsGrimoire(g.id)) { <span class="block-reason">Your scout is resting.</span> }
                } @else {
                  <button class="uc-btn shop-buy" [disabled]="busy() || ownsGrimoire(g.id) || !canAfford(g.cost)" (click)="buy(g)">
                    {{ g.cost }} <img class="rot-coin" src="undercity/icons/rot.png" alt="Spores" />
                  </button>
                }
```

- [ ] **Step 5: Eggs tab — tier lock + Deliver/stage button**

Replace the egg row button (currently ~722–724):

```html
                <button class="uc-btn shop-buy" [disabled]="busy() || !canAfford(e.cost)" (click)="buyEgg(e.tier)">
                  {{ e.cost }} <img class="rot-coin" src="undercity/icons/rot.png" alt="Spores" />
                </button>
```

with:

```html
                @if (shopMode() === 'courier') {
                  <button class="uc-btn shop-buy" [class.staged]="isStaged('egg:' + e.tier)"
                          [disabled]="busy() || scoutOnCooldown() || courierTierLocked(e.tier)"
                          (click)="stageEgg(e)">
                    {{ isStaged('egg:' + e.tier) ? 'In cart' : 'Deliver · ' + e.cost }}
                  </button>
                  @if (courierTierLocked(e.tier)) { <span class="block-reason">Merge your scout to reach {{ tierRarity(e.tier).label }}</span> }
                  @else if (scoutOnCooldown()) { <span class="block-reason">Your scout is resting.</span> }
                } @else {
                  <button class="uc-btn shop-buy" [disabled]="busy() || !canAfford(e.cost)" (click)="buyEgg(e.tier)">
                    {{ e.cost }} <img class="rot-coin" src="undercity/icons/rot.png" alt="Spores" />
                  </button>
                }
```

- [ ] **Step 6: Checkout bottom bar**

Replace the shop modal's bottom button (currently ~732):

```html
        <button class="uc-btn close-btn" (click)="closeFacilities()">Leave</button>
```

with:

```html
        @if (shopMode() === 'courier' && cartItem(); as ci) {
          <button class="uc-btn close-btn purchase-btn" [disabled]="busy() || scoutOnCooldown()" (click)="checkoutCourier()">
            Purchase for {{ ci.cost }} <img class="rot-coin" src="undercity/icons/rot.png" alt="Spores" />
          </button>
        } @else {
          <button class="uc-btn close-btn" (click)="closeFacilities()">Leave</button>
        }
```

- [ ] **Step 7: Remove the old bespoke courier modal**

Delete the entire `@if (scoutOpen() && scoutView(); as sv) { … }` block (currently ~1110–1171 — the `<!-- Scout courier: peek the biome bazaar … -->` comment through its closing `}`). Its members (`scoutOpen`, `scoutGearLocked`, `scoutEggLocked`, `scoutBuy`, `closeScoutCourier`, `gearMapRef`) were removed in Task 1.

- [ ] **Step 8: Build**

Run: `npm run build`
Expected: build succeeds. Angular's strict template checker fails on any leftover reference to a removed member — if it does, `git grep -n "scoutOpen\|scoutBuy\|scoutGearLocked\|scoutEggLocked\|closeScoutCourier\|gearMapRef"` in `board-tab.*` and fix.

- [ ] **Step 9: Commit**

```bash
git add src/app/undercity/tabs/board-tab.component.ts src/app/undercity/tabs/board-tab.component.html
git commit -m "feat(undercity): scout courier reuses the bazaar shop modal"
```

---

## Task 3: Creature-tab — scout info chip, remove courier

**Files:** Modify `src/app/undercity/tabs/creature-tab.component.ts` + `.html`

- [ ] **Step 1: Replace the scout ability button with an info chip**

In `creature-tab.component.html` (~212–215), replace:

```html
                      } @else if (petRoleOf(pet) === 'scout') {
                        <button type="button" class="pet-btn" [disabled]="busy()" (click)="openScoutCourier()">
                          {{ petAbilityReady(pet) ? 'Scout Courier' : 'Courier · ' + petAbilityLeftMin(pet) + ' min' }}
                        </button>
                      }
```

with:

```html
                      } @else if (petRoleOf(pet) === 'scout') {
                        <span class="pet-btn ghost" title="Use your scout from the board map">Scout from the board</span>
                      }
```

- [ ] **Step 2: Delete the courier modal markup**

In `creature-tab.component.html`, delete the entire `@if (scoutOpen() && scoutView(); as sv) { … }` block (the `<!-- Scout courier: peek the biome bazaar … -->` comment through its closing `}`, currently ~1292–1354).

- [ ] **Step 3: Delete the courier TS members**

In `creature-tab.component.ts`, delete the whole block from the `// ── Scout courier:` comment through the end of `scoutBuy` (currently ~658–712): `scoutOpen`, `scoutView`, `gearMapRef`, `canAfford`, `scoutOnCooldown`, `openScoutCourier`, `closeScoutCourier`, `scoutGearLocked`, `scoutEggLocked`, `scoutBuy`.

- [ ] **Step 4: Clean now-unused imports**

`GEAR_MAP` and `BazaarView` were added for the courier. After Step 3, check each:

Run: `git grep -n "GEAR_MAP\|BazaarView" src/app/undercity/tabs/creature-tab.component.ts`

For each that returns ONLY its import line, remove it from the import: `BazaarView` from the `../services/undercity-models` import, and `GEAR_MAP` from the `../data/items` import (or wherever it's imported). Leave any that still have other uses.

- [ ] **Step 5: Build**

Run: `npm run build`
Expected: build succeeds. Fix any dangling references / unused-import errors it reports.

- [ ] **Step 6: Commit**

```bash
git add src/app/undercity/tabs/creature-tab.component.ts src/app/undercity/tabs/creature-tab.component.html
git commit -m "feat(undercity): creature-tab scout becomes a board-map info chip"
```

---

## Task 4: Server — `refreshesAt` on peek (polish)

Gives the courier header an accurate restock timer + rotating keeper. Purely additive.

**Files:** Modify `infrastructure/lambda/undercity_db.py`; Test `infrastructure/lambda/tests/test_undercity_scout_remote_buy.py`

- [ ] **Step 1: Extend the peek test**

In `tests/test_undercity_scout_remote_buy.py`, add to `test_peek_returns_biome_stock_without_cooldown` (after the existing `assert 'gear' in pa['stock'] and 'eggs' in pa['stock']` line):

```python
    assert pa.get('refreshesAt')  # courier header restock clock
```

- [ ] **Step 2: Run it to confirm it fails**

Run: `python -m pytest tests/test_undercity_scout_remote_buy.py::test_peek_returns_biome_stock_without_cooldown -q`
Expected: FAIL (`refreshesAt` absent).

- [ ] **Step 3: Add `refreshesAt` to the peek result**

In `_pet_scout_peek` (in `undercity_db.py`), extend the `result` dict to include the shared window end (same source normal bazaars use — `_shop_window_end(_shop_window())`):

```python
    stock = _shop_stock(table, sid, node)
    result = {'kind': 'scout-peek', 'node': node,
              'tierCap': _pet_scout_tier_cap(level), 'stock': _clean(stock),
              'refreshesAt': _shop_window_end(_shop_window()),
              'text': 'Your scout ranges ahead and reports the local bazaar stock.'}
    return _ok(doc, text=result['text'], petAbility=result)
```

Note: the client reads `scoutView().stock.refreshesAt` (via `activeBazaar()`), so also fold it into the stock the client renders. Simplest: after `stock = _shop_stock(...)`, do `stock = dict(_clean(stock)); stock['refreshesAt'] = _shop_window_end(_shop_window())` and set `'stock': stock` (drop the separate `_clean` call). Use this form instead:

```python
    stock = _clean(_shop_stock(table, sid, node))
    stock['refreshesAt'] = _shop_window_end(_shop_window())
    result = {'kind': 'scout-peek', 'node': node,
              'tierCap': _pet_scout_tier_cap(level), 'stock': stock,
              'text': 'Your scout ranges ahead and reports the local bazaar stock.'}
    return _ok(doc, text=result['text'], petAbility=result)
```

- [ ] **Step 4: Run the scout suite**

Run: `python -m pytest tests/test_undercity_scout_remote_buy.py -q`
Expected: PASS (all scout tests, including the extended peek assertion).

- [ ] **Step 5: Commit**

```bash
git add infrastructure/lambda/undercity_db.py infrastructure/lambda/tests/test_undercity_scout_remote_buy.py
git commit -m "feat(undercity): scout peek returns refreshesAt for the courier header"
```

---

## Final verification

- [ ] Scout + companions suites green: `cd infrastructure/lambda && python -m pytest tests/test_undercity_scout_remote_buy.py tests/test_undercity_companions.py -q`
- [ ] Full backend suite adds no new failures beyond the known ~49 WIP ones.
- [ ] Frontend compiles: `npm run build`
- [ ] No stragglers: `git grep -n "scoutOpen\|scoutBuy\|scoutGearLocked\|scoutEggLocked\|closeScoutCourier\|openScoutCourier\|gearMapRef"` returns nothing in `src/app/undercity/tabs/`.
- [ ] Manual (optional, `run-undercity`): active scout in a bazaar biome → tap the board scout box → shop modal opens in courier mode with shopkeeper + pet header; rows above the tier cap are locked with the merge hint; tapping Deliver stages one item (button reads "In cart", bottom bar reads "Purchase for X"); checkout buys it and closes; reopening while resting shows Deliver disabled; a shopless biome toasts instead of opening; walk-in shopping (facility button) is unchanged (price buttons, immediate buy, "Leave").

**Deploy:** the user runs the deploy (`cdk deploy` for the Lambda if Task 4 is included, `npm run deploy` for the site). End with tests green and note a deploy is needed.

---

## Optional styling (only if unstyled)

The new classes `courier-welcome`, `courier-pet`, `.shop-buy.staged`, and `purchase-btn` may lack rules. If the staged state or pet portrait look off, add to `board-tab.component.scss` near the existing `.shop-*` rules, reusing STYLE_GUIDE tokens (`--accent-color`, etc.):

```scss
.courier-welcome { display: flex; align-items: center; gap: 0.5rem; }
.courier-pet { width: 40px; height: 40px; image-rendering: pixelated; }
.shop-buy.staged { outline: 2px solid var(--accent-color); }
```

Skip if the elements already inherit acceptable styling.

---

## Self-review notes

- **Spec coverage:** mode flag + entry (T1 S2/S5), data source-swap (T1 S4), shopkeeper+pet header + courier line (T2 S1), tier-cap locks gear/eggs only (T2 S2/S5; consumables/grimoires have no lock in S3/S4), Deliver→one-item cart→"Purchase for X" checkout reusing `pet-scout-buy` (T1 S2 + T2 S2–S6), on-cooldown disable + resting hint (all button steps + checkout), remove old courier from both tabs (T2 S7, T3 S2–S3), creature-tab info chip (T3 S1), optional `refreshesAt` (T4). All spec sections map to a task.
- **Type consistency:** `shopMode`/`scoutView`/`cartItem`/`CartItem{key,name,cost,payload}`, `activeBazaar()`, `courierTierLocked(tier)`, `stage/isStaged/stageGear/stageConsumable/stageGrimoire/stageEgg`, `checkoutCourier()`, `courierPetName()`, `openShopCourier()` are used consistently across TS and template. Staged keys (`gear:`/`consumable:`/`grimoire:`/`egg:`) match between the stage methods and the `isStaged(...)` template calls.
- **No placeholders:** every code step shows full before/after; the only conditional steps (T3 S4 unused-import removal, optional styling) specify exactly what to check and do.
