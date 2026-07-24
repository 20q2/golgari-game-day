# Disabled-Action Reason Lines Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Every meaningful greyed-out action in Undercity shows a short line saying *why* it's disabled (can't afford, container full, cooldown, already owned, …), while the button keeps its price/label.

**Architecture:** A shared pure helper (`block-reasons.ts`) phrases the common blockers. Each surface gains a `*Reason(...)` method returning `string | null` (null = enabled). Templates disable on `busy() || !!reason(...)` and render a muted `.block-reason` line below the row when a reason is present. No backend changes.

**Tech Stack:** Angular 20 standalone components, TypeScript, SCSS. **No frontend test runner exists** (per CLAUDE.md — do not run `ng test`). Verification is `npm run build` (from repo root, via Bash) plus a Node sanity check for the pure helper.

---

## Reference: spec

`specs/2026-07-23-undercity-disabled-reason-lines-design.md`

## File Structure

- **Create** `src/app/undercity/data/block-reasons.ts` — pure reason-string helpers, no Angular deps.
- **Modify** `src/app/undercity/tabs/plaza-tab.component.ts` — `buyReason`, `upgradeReason`.
- **Modify** `src/app/undercity/tabs/plaza-tab.component.html` — market buy + blacksmith upgrade reason lines.
- **Modify** `src/app/undercity/tabs/plaza-tab.component.scss` — `.block-reason` rule.
- **Modify** `src/app/undercity/tabs/board-tab.component.ts` — shop/shrine/trade/inscribe/blink/spell reason methods.
- **Modify** `src/app/undercity/tabs/board-tab.component.html` — reason lines at each covered button.
- **Modify** `src/app/undercity/tabs/board-tab.component.scss` — `.block-reason` rule.

Each task produces a self-contained, buildable change and its own commit.

---

## Task 1: Shared reason helper

**Files:**
- Create: `src/app/undercity/data/block-reasons.ts`

- [ ] **Step 1: Write the helper**

```ts
// src/app/undercity/data/block-reasons.ts
//
// Pure "why is this greyed out?" reason strings, shared by the board and plaza
// tabs so identical blockers read identically everywhere. Each function returns
// null when the action is ALLOWED, or a short human reason when it is BLOCKED.
// No Angular / no signals here — just data in, string out.

/** Spore price you can't cover. Returns null when affordable. */
export function affordReason(have: number, cost: number): string | null {
  return have >= cost ? null : `Not enough Spores (you have ${have})`;
}

/** A destination inventory is full. `label` is the container's display name,
 *  e.g. 'Stash', 'Bag', 'Scroll satchel'. Returns null when there's room. */
export function containerFullReason(len: number, cap: number, label: string): string | null {
  return len >= cap ? `${label} full — make room first` : null;
}

/** A minute-granularity cooldown. `verb` e.g. 'On cooldown' | 'Recharging'.
 *  Returns null when ready (minsLeft <= 0). */
export function cooldownReason(minsLeft: number, verb: string): string | null {
  return minsLeft > 0 ? `${verb} (${minsLeft}m)` : null;
}

/** Crafting-material shortfall (Blacksmith). Itemizes what's missing.
 *  Returns null when both materials are covered. */
export function materialReason(
  haveMoltings: number,
  haveIchor: number,
  needMoltings: number,
  needIchor: number,
): string | null {
  const short: string[] = [];
  if (haveMoltings < needMoltings) short.push(`${needMoltings - haveMoltings} moltings`);
  if (haveIchor < needIchor) short.push(`${needIchor - haveIchor} ichor`);
  return short.length ? `Need ${short.join(', ')}` : null;
}
```

- [ ] **Step 2: Sanity-check the pure functions**

Create a throwaway check (delete after):

```bash
cat > /tmp/br-check.mjs <<'EOF'
import { affordReason, containerFullReason, cooldownReason, materialReason }
  from './src/app/undercity/data/block-reasons.ts';
EOF
```

Since Node can't import `.ts` directly, instead verify by eye against these expected results and rely on the Task-2 build for compilation:
- `affordReason(80, 120)` → `'Not enough Spores (you have 80)'`
- `affordReason(200, 120)` → `null`
- `containerFullReason(6, 6, 'Stash')` → `'Stash full — make room first'`
- `containerFullReason(2, 3, 'Bag')` → `null`
- `cooldownReason(2, 'Recharging')` → `'Recharging (2m)'`
- `materialReason(0, 1, 0, 2)` → `'Need 1 ichor'`
- `materialReason(5, 5, 0, 0)` → `null`

Remove the throwaway: `rm -f /tmp/br-check.mjs`

- [ ] **Step 3: Commit**

```bash
git add src/app/undercity/data/block-reasons.ts
git commit -m "feat(undercity): shared block-reason string helpers"
```

---

## Task 2: Plaza Market buy + Blacksmith upgrade reasons

**Files:**
- Modify: `src/app/undercity/tabs/plaza-tab.component.ts`
- Modify: `src/app/undercity/tabs/plaza-tab.component.html`
- Modify: `src/app/undercity/tabs/plaza-tab.component.scss`

- [ ] **Step 1: Import the helpers**

In `plaza-tab.component.ts`, add to the existing `../data/items` import block a new import line near the other data imports:

```ts
import {
  affordReason,
  containerFullReason,
  materialReason,
} from '../data/block-reasons';
```

- [ ] **Step 2: Replace `canBuy` with a reason function**

Find (`plaza-tab.component.ts`, ~line 251):

```ts
  protected canBuy(l: { price: number; own: boolean; kind: MarketKind }): boolean {
    const you = this.store.you();
    if (!you || l.own) return false;
    const held =
      l.kind === 'consumable' ? you.bag : l.kind === 'scroll' ? you.scrolls : you.gearStash;
    const cap = l.kind === 'consumable' ? 3 : 6; // BAG_SIZE=3; gearStash/scrolls=6
    const full = (held?.length ?? 0) >= cap;
    return you.spores >= l.price && !full;
  }
```

Replace with:

```ts
  /** Why a market Buy is blocked (destination-full first, then affordability),
   *  or null when it can be bought. Own listings never reach here (Cancel shows
   *  instead). */
  protected buyReason(l: { price: number; own: boolean; kind: MarketKind }): string | null {
    const you = this.store.you();
    if (!you || l.own) return 'Unavailable';
    const held =
      l.kind === 'consumable' ? you.bag : l.kind === 'scroll' ? you.scrolls : you.gearStash;
    const cap = l.kind === 'consumable' ? 3 : 6; // BAG_SIZE=3; gearStash/scrolls=6
    const label =
      l.kind === 'consumable' ? 'Bag' : l.kind === 'scroll' ? 'Scroll satchel' : 'Stash';
    return (
      containerFullReason(held?.length ?? 0, cap, label) ?? affordReason(you.spores, l.price)
    );
  }
```

- [ ] **Step 3: Replace `canAfford` (upgrade) with `upgradeReason`**

Find (`plaza-tab.component.ts`, ~line 210):

```ts
  protected canAfford(cost: { spores: number; moltings: number; ichor: number }): boolean {
    const you = this.store.you();
    const m = this.materials();
    return !!you && you.spores >= cost.spores && m.moltings >= cost.moltings && m.ichor >= cost.ichor;
  }
```

Replace with:

```ts
  /** Why a Blacksmith upgrade is blocked (Spores first, then materials), or null
   *  when it can be forged. */
  protected upgradeReason(cost: { spores: number; moltings: number; ichor: number }): string | null {
    const you = this.store.you();
    if (!you) return 'Unavailable';
    const m = this.materials();
    return (
      affordReason(you.spores, cost.spores) ??
      materialReason(m.moltings, m.ichor, cost.moltings, cost.ichor)
    );
  }
```

- [ ] **Step 4: Update the market Buy button + add reason line**

In `plaza-tab.component.html`, find (~line 140):

```html
                <button class="uc-btn forge-upgrade" [disabled]="busy() || !canBuy(l)" (click)="marketBuy(l.id)">
                  {{ l.price }}<img class="rot-coin" src="undercity/icons/rot.png" alt="Spores" />
                </button>
```

Replace with:

```html
                <button class="uc-btn forge-upgrade" [disabled]="busy() || !!buyReason(l)" (click)="marketBuy(l.id)">
                  {{ l.price }}<img class="rot-coin" src="undercity/icons/rot.png" alt="Spores" />
                </button>
                @if (!busy() && buyReason(l); as r) { <span class="block-reason">{{ r }}</span> }
```

- [ ] **Step 5: Update the Blacksmith upgrade button + add reason line**

In `plaza-tab.component.html`, find (~line 113):

```html
              <button class="uc-btn forge-upgrade" [disabled]="busy() || !canAfford(row.cost)" (click)="upgrade(row)">
```

Replace the `[disabled]` expression and add a reason line after the button's closing tag. The button opens at ~line 113 and closes a few lines later; locate its `</button>` and insert the reason line immediately after it:

```html
              <button class="uc-btn forge-upgrade" [disabled]="busy() || !!upgradeReason(row.cost)" (click)="upgrade(row)">
```

Reason line to add after that button's `</button>`:

```html
              @if (!busy() && upgradeReason(row.cost); as r) { <span class="block-reason">{{ r }}</span> }
```

- [ ] **Step 6: Add the `.block-reason` style**

Append to `plaza-tab.component.scss`:

```scss
// Muted "why is this greyed out?" line under a disabled action. Mirrors the
// board tab's .shop-warn treatment so blockers read the same across the game.
.block-reason {
  display: block;
  width: 100%;
  margin-top: 4px;
  font-size: 0.75rem;
  color: var(--text-secondary, #9a8fa6);
}
```

- [ ] **Step 7: Build**

Run: `npm run build`
Expected: build succeeds with no TypeScript errors (any leftover `canBuy`/`canAfford` reference in the template would fail here).

- [ ] **Step 8: Commit**

```bash
git add src/app/undercity/data/block-reasons.ts src/app/undercity/tabs/plaza-tab.component.ts src/app/undercity/tabs/plaza-tab.component.html src/app/undercity/tabs/plaza-tab.component.scss
git commit -m "feat(undercity): market buy & blacksmith upgrade show why greyed"
```

---

## Task 3: Board shop (gear / consumable / grimoire) reasons

**Files:**
- Modify: `src/app/undercity/tabs/board-tab.component.ts`
- Modify: `src/app/undercity/tabs/board-tab.component.html`
- Modify: `src/app/undercity/tabs/board-tab.component.scss`

- [ ] **Step 1: Import helpers**

In `board-tab.component.ts`, add near the other `../data/*` imports:

```ts
import {
  affordReason,
  containerFullReason,
  cooldownReason,
} from '../data/block-reasons';
```

(We add only what board uses; `materialReason` is plaza-only.)

- [ ] **Step 2: Add shop reason methods**

In `board-tab.component.ts`, add just after `canAfford` (~line 823):

```ts
  /** Why a shop GEAR line can't be bought (out of stock → stash full → price),
   *  or null when buyable. */
  protected shopGearReason(info: GearInfo, qty: number): string | null {
    if (qty <= 0) return 'Out of stock';
    if (this.stashFull()) return containerFullReason(this.GEAR_STASH_SIZE, this.GEAR_STASH_SIZE, 'Stash');
    return affordReason(this.store.you()?.spores ?? 0, info.cost);
  }

  /** Why a shop CONSUMABLE line can't be bought (out of stock → price). */
  protected shopConsumableReason(info: ConsumableInfo, qty: number): string | null {
    if (qty <= 0) return 'Out of stock';
    return affordReason(this.store.you()?.spores ?? 0, info.cost);
  }

  /** Why a GRIMOIRE line can't be bought (already owned → price). */
  protected shopGrimoireReason(g: GrimoireInfo): string | null {
    if (this.ownsGrimoire(g.id)) return 'Already owned';
    return affordReason(this.store.you()?.spores ?? 0, g.cost);
  }
```

- [ ] **Step 3: Update the gear buy button + reason line**

In `board-tab.component.html`, find (~line 441-443):

```html
                  class="uc-btn shop-buy"
                  [disabled]="busy() || r.qty <= 0 || stashFull() || !canAfford(r.info.cost)"
                  (click)="buy(r.info)"
```

Change the `[disabled]` line to:

```html
                  [disabled]="busy() || !!shopGearReason(r.info, r.qty)"
```

Then, immediately after this button's closing `</button>`, add:

```html
                @if (!busy() && shopGearReason(r.info, r.qty); as reason) { <span class="block-reason">{{ reason }}</span> }
```

- [ ] **Step 4: Update the consumable buy button + reason line**

In `board-tab.component.html`, find (~line 465):

```html
                <button class="uc-btn shop-buy" [disabled]="busy() || r.qty <= 0 || !canAfford(r.info.cost)" (click)="buy(r.info)">
```

Replace the `[disabled]` expression:

```html
                <button class="uc-btn shop-buy" [disabled]="busy() || !!shopConsumableReason(r.info, r.qty)" (click)="buy(r.info)">
```

After its `</button>`, add:

```html
                @if (!busy() && shopConsumableReason(r.info, r.qty); as reason) { <span class="block-reason">{{ reason }}</span> }
```

- [ ] **Step 5: Update the grimoire buy button + reason line**

In `board-tab.component.html`, find (~line 484):

```html
                <button class="uc-btn shop-buy" [disabled]="busy() || ownsGrimoire(g.id) || !canAfford(g.cost)" (click)="buy(g)">
```

Replace the `[disabled]` expression:

```html
                <button class="uc-btn shop-buy" [disabled]="busy() || !!shopGrimoireReason(g)" (click)="buy(g)">
```

After its `</button>`, add:

```html
                @if (!busy() && shopGrimoireReason(g); as reason) { <span class="block-reason">{{ reason }}</span> }
```

- [ ] **Step 6: Add the `.block-reason` style**

Append to `board-tab.component.scss` (identical rule to the plaza tab):

```scss
// Muted "why is this greyed out?" line under a disabled action. Mirrors .shop-warn.
.block-reason {
  display: block;
  width: 100%;
  margin-top: 4px;
  font-size: 0.75rem;
  color: var(--text-secondary, #9a8fa6);
}
```

- [ ] **Step 7: Build**

Run: `npm run build`
Expected: build succeeds. `canAfford` is still defined (used elsewhere), so no unused-symbol break; the template no longer references `stashFull()`/`ownsGrimoire()` directly on these buttons but both remain used elsewhere.

- [ ] **Step 8: Commit**

```bash
git add src/app/undercity/tabs/board-tab.component.ts src/app/undercity/tabs/board-tab.component.html src/app/undercity/tabs/board-tab.component.scss
git commit -m "feat(undercity): bazaar gear/consumable/grimoire show why greyed"
```

---

## Task 4: Shrine + Roll + Blink reasons

**Files:**
- Modify: `src/app/undercity/tabs/board-tab.component.ts`
- Modify: `src/app/undercity/tabs/board-tab.component.html`

- [ ] **Step 1: Add shrine + blink reason methods**

In `board-tab.component.ts`, add near `canBless` (~line 1863) and the blink computeds (~line 1239):

```ts
  /** Why a shrine blessing is blocked (can't afford SHRINE_COST), or null. */
  protected shrineReason(): string | null {
    return affordReason(this.store.you()?.spores ?? 0, this.SHRINE_COST);
  }

  /** Why the roll button is blocked, or null. Debug builds roll freely. */
  protected rollReason(): string | null {
    if (this.debugMode()) return null;
    return this.rollsBanked() < 1 ? 'No rolls left' : null;
  }

  /** Why Blink is blocked. blinkCooldown is measured in ROLLS owed (not minutes),
   *  so this reports rolls, not a cooldownReason minute string. */
  protected blinkReason(): string | null {
    if (!this.hasBlink()) return 'Blink not unlocked';
    const n = this.blinkCooldown();
    return n > 0 ? `Recharging (${n} more roll${n === 1 ? '' : 's'})` : null;
  }
```

- [ ] **Step 2: Update the roll button + reason line**

In `board-tab.component.html`, find (~line 40):

```html
        [disabled]="busy() || (!debugMode() && rollsBanked() < 1)"
```

Replace with:

```html
        [disabled]="busy() || !!rollReason()"
```

After that button's `</button>`, add:

```html
      @if (!busy() && rollReason(); as r) { <span class="block-reason">{{ r }}</span> }
```

- [ ] **Step 3: Update the blink button + reason line**

In `board-tab.component.html`, find the blink control (~line 58):

```html
          [disabled]="busy() || blinkRecharging()"
```

Replace with:

```html
          [disabled]="busy() || !!blinkReason()"
```

After that button's `</button>`, add:

```html
        @if (!busy() && blinkReason(); as r) { <span class="block-reason">{{ r }}</span> }
```

- [ ] **Step 4: Update the shrine cards + one shared reason line**

In `board-tab.component.html`, the four shrine cards (~lines 522-537) each read `[disabled]="busy() || !canBless()"`. Replace each `!canBless()` with `!!shrineReason()`:

```html
          <button class="shrine-card atk" [disabled]="busy() || !!shrineReason()" (click)="shrine('atk')">
```
```html
          <button class="shrine-card def" [disabled]="busy() || !!shrineReason()" (click)="shrine('def')">
```
```html
          <button class="shrine-card spd" [disabled]="busy() || !!shrineReason()" (click)="shrine('spd')">
```
```html
          <button class="shrine-card heal" [disabled]="busy() || !!shrineReason()" (click)="shrine('heal')">
```

The shrine already shows a hint when broke (~line 545: "You need {{ SHRINE_COST }} spores…"). To avoid a duplicate line, do **not** add a per-card reason line; instead confirm the existing hint block remains. If that hint block is conditional on `!canBless()`, update its condition to `!!shrineReason()`. Find (~line 544):

```html
          <p class="shrine-note">You need {{ SHRINE_COST }} spores to receive a blessing.</p>
```

If it is wrapped in `@if (!canBless())`, change that to `@if (shrineReason())`. If it is unconditional, leave it.

- [ ] **Step 5: Build**

Run: `npm run build`
Expected: build succeeds.

- [ ] **Step 6: Commit**

```bash
git add src/app/undercity/tabs/board-tab.component.ts src/app/undercity/tabs/board-tab.component.html
git commit -m "feat(undercity): shrine, roll & blink show why greyed"
```

---

## Task 5: Trade + Witch inscribe reasons

**Files:**
- Modify: `src/app/undercity/tabs/board-tab.component.ts`
- Modify: `src/app/undercity/tabs/board-tab.component.html`

- [ ] **Step 1: Add trade + inscribe reason methods**

In `board-tab.component.ts`, add next to `canTradeFor` (~line 711) and `canInscribe` (~line 605):

```ts
  /** Why "Trade for this" is blocked, or null. Mirrors canTradeFor's conditions
   *  with prose. */
  protected tradeReason(stockItem: string): string | null {
    if (this.umoriTraded()) return 'Already traded here';
    if (this.qualifyingGiveOffers(stockItem).length === 0) return 'Nothing to trade for this';
    if (
      GEAR_MAP[stockItem] &&
      this.stashFull() &&
      !this.qualifyingGiveOffers(stockItem).some((o) => !o.equipped)
    ) {
      return containerFullReason(this.GEAR_STASH_SIZE, this.GEAR_STASH_SIZE, 'Stash');
    }
    if (GRIMOIRE_MAP[stockItem] && (this.store.you()?.grimoires ?? []).includes(stockItem)) {
      return 'Already owned';
    }
    return null;
  }

  /** Why the inscribe confirm is blocked (pick both → duplicate → book full), or
   *  null when ready. */
  protected inscribeReason(): string | null {
    const s = this.pickedScroll();
    const b = this.pickedBook();
    if (!s || !b) return 'Pick a scroll and a book';
    if (this.bookSpells(b).includes(s)) return 'Already in this book';
    if (this.bookFull(b) && !this.burnTarget()) return 'Book full — pick one to overwrite';
    return null;
  }
```

- [ ] **Step 2: Point `canTradeFor`/`canInscribe` at the reason methods**

To keep the guards (`canTradeFor` used at ~line 706 picker; `canInscribe` used in `inscribe()` at ~615) in lock-step with the display, redefine them as the null-check of the reason methods. Replace the body of `canTradeFor` (~line 711):

```ts
  protected canTradeFor(stockItem: string): boolean {
    return this.tradeReason(stockItem) === null;
  }
```

Replace the body of `canInscribe` (~line 605):

```ts
  protected canInscribe(): boolean {
    return this.inscribeReason() === null;
  }
```

(Leave `canUseGive` as-is — it is a per-give picker gate, not a primary blocked action, and shows no reason line.)

- [ ] **Step 3: Add the trade reason line**

In `board-tab.component.html`, find the trade button (~line 685-686):

```html
              class="uc-btn shop-buy"
              [disabled]="busy() || !canTradeFor(s.item)"
```

Leave `[disabled]` as-is (it already delegates to `canTradeFor`). After that button's `</button>`, add:

```html
            @if (!busy() && tradeReason(s.item); as r) { <span class="block-reason">{{ r }}</span> }
```

- [ ] **Step 4: Add the inscribe reason line**

In `board-tab.component.html`, find the inscribe confirm (~line 1056):

```html
            <button class="uc-btn uc-btn-primary witch-confirm" [disabled]="busy() || !canInscribe()" (click)="inscribe()">
```

Leave `[disabled]` as-is. After its `</button>`, add:

```html
            @if (!busy() && inscribeReason(); as r) { <span class="block-reason">{{ r }}</span> }
```

- [ ] **Step 5: Build**

Run: `npm run build`
Expected: build succeeds.

- [ ] **Step 6: Commit**

```bash
git add src/app/undercity/tabs/board-tab.component.ts src/app/undercity/tabs/board-tab.component.html
git commit -m "feat(undercity): trade & witch inscribe show why greyed"
```

---

## Task 6: Spell-cast cooldown reasons

**Files:**
- Modify: `src/app/undercity/tabs/board-tab.component.ts`
- Modify: `src/app/undercity/tabs/board-tab.component.html`

- [ ] **Step 1: Add a spell-cast reason method**

In `board-tab.component.ts`, add next to `spellReady` (~line 361):

```ts
  /** Why a spell can't be cast right now (cooldown), or null when ready. Uses the
   *  same minute-granularity cooldown the button already gates on. */
  protected spellReason(spellId: string): string | null {
    return cooldownReason(cooldownLeftMin(this.store.you()?.spellCooldowns, spellId), 'On cooldown');
  }
```

(`cooldownLeftMin` is already imported — it's used by `spellReady`. If a lint error says otherwise, add it to the existing spell-data import.)

- [ ] **Step 2: Add the reason line to the spellbook list**

In `board-tab.component.html`, find the spellbook cast button (~line 936-937):

```html
              class="uc-btn shop-buy"
              [disabled]="busy() || !spellReady(sp.id)"
```

Leave `[disabled]` as-is (delegates to `spellReady`). After that button's `</button>`, add:

```html
            @if (!busy() && spellReason(sp.id); as r) { <span class="block-reason">{{ r }}</span> }
```

- [ ] **Step 3: Build**

Run: `npm run build`
Expected: build succeeds.

- [ ] **Step 4: Commit**

```bash
git add src/app/undercity/tabs/board-tab.component.ts src/app/undercity/tabs/board-tab.component.html
git commit -m "feat(undercity): spellbook casts show cooldown reason when greyed"
```

---

## Task 7: Full build + manual smoke

**Files:** none (verification only)

- [ ] **Step 1: Production build**

Run: `npm run build`
Expected: succeeds, no errors.

- [ ] **Step 2: Manual smoke via the run-undercity skill**

Invoke the `run-undercity` skill to launch the game against the live backend, then verify by eye:
- Plaza → Market: a listing you can't afford shows "Not enough Spores (you have N)"; with a full stash, a gear listing shows "Stash full — make room first". The **price stays on the button**.
- Bazaar shop: an unaffordable gear line shows a reason; a full stash greys all gear with the stash reason; an owned grimoire shows "Already owned".
- Shrine while broke: cards greyed with the existing spores hint (no duplicate line).
- A spell on cooldown in the spellbook shows "On cooldown (Nm)".

- [ ] **Step 3: Note for the user**

Report build-green + which surfaces were manually confirmed. Deployment is the user's to run (do not deploy).

---

## Self-Review

**Spec coverage:** market buy ✓ (T2), blacksmith upgrade ✓ (T2), shop gear/consumable/grimoire ✓ (T3), shrine ✓ (T4), roll ✓ (T4), blink ✓ (T4, rolls-based deviation noted), trade ✓ (T5), inscribe ✓ (T5), spell cast ✓ (T6), shared helper ✓ (T1), `.block-reason` style ✓ (T2/T3), price stays on button ✓ (all edits keep button label), `busy()` silent ✓ (all reason lines guard on `!busy()`), no backend changes ✓.

**Deviation from spec:** the spec's `cooldownReason` was described as covering blink; blink's cooldown is in rolls, not minutes, so Task 4 uses a rolls-worded string instead. Documented in Task 4 Step 1.

**Type consistency:** helper names (`affordReason`, `containerFullReason`, `cooldownReason`, `materialReason`) are used identically across T1–T6. Reason methods return `string | null` and every template guard uses `!!x`/`; as r`. `canTradeFor`/`canInscribe` remain `boolean` (now delegating), so their existing call sites are unchanged.

**Placeholder scan:** no TBD/TODO; every code step shows full code; every template edit shows the exact existing anchor and the exact replacement/addition.
