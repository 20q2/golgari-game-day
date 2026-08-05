# Undercity — Player Market Browse Redesign

**Date:** 2026-08-05
**Status:** Design approved (interactive sample reviewed); ready for implementation plan
**Area:** Undercity sub-game — Plaza Player Market (client Buy view)

## 1. Problem

The Player Market's **Buy** view renders every active listing as **one flat, unsorted,
unfiltered list** ([`plaza-tab.component.html`](../src/app/undercity/tabs/plaza-tab.component.html)
`@for (l of marketRows())`). That is fine for a handful of listings and unusable at
game-day volume. Three forces push volume up on a 6-8h session:

- More players, each now allowed **10** active listings (`MARKET_MAX_LISTINGS`, raised from 5).
- The **Umori sealed auction** ([`specs/2026-08-05-undercity-umori-auction-design.md`](2026-08-05-undercity-umori-auction-design.md))
  **auto-lists won gear that won't fit** a full stash — and auto-listings bypass the per-seller cap.
- Pickup-overflow auto-lists from the full-bag flow.

At 150-200 listings the buyer cannot find a specific item, and a seller cannot find or
manage their own listings among everyone else's. Both were the concrete pains raised.

## 2. Summary

A **client-only** overhaul of the Buy view: a sticky toolbar with a **kind-chip bar**
(live counts), a **Price ↑ / Price ↓ / Rarity** sort, an **Affordable** filter, and a
**Mine** chip that isolates the player's own listings with Cancel and a `N / 10` cap
readout. Everything derives reactively from the `market()` array the game already sends —
**no backend, no state-payload, no new endpoints**. The **Sell** view is untouched.

## 3. Locked decisions

| Question | Decision |
|---|---|
| Scope | **Client-side browsing overhaul only.** No server/payload/pagination changes. |
| Layout | **Chips toolbar + one sorted list** (chosen over segmented tabs / grouped sections). |
| Browse axes | **Kind** (chips), **Rarity & price** (sort), **Affordability** (toggle). |
| Kind chips | `All` · `Gear` · `Consumables` · `Scrolls` · `Pets` · `Mine`. **Pets bundles hatched pets *and* eggs** (one shopping intent); rows keep their own paw/egg icon. |
| Affordable meaning | **Price-only**: `you.spores >= price`. "Bag full / stash full" stays a per-row note via the existing `buyReason()`. |
| Manage own listings | A **Mine** chip (not a separate button), showing only your listings with **Cancel** and a `N / 10` header. |
| Out of scope | Name search, build/slot-fit filter, anti-snipe/fairness, server-side trimming. |

## 4. Detailed design

All changes live in [`PlazaTabComponent`](../src/app/undercity/tabs/plaza-tab.component.ts)
and its template/styles. The data source is the existing
`marketRows()` computed (each row: `{ id, price, sellerName, kind, view, own }`,
where `view` carries `name/desc/icon/svgIcon/imgUrl/rarity?`).

### 4.1 UI state (three signals)

```ts
type MarketFilter = 'all' | 'gear' | 'consumable' | 'scroll' | 'pets' | 'mine';
marketFilter    = signal<MarketFilter>('all');
marketSort      = signal<'price-asc' | 'price-desc' | 'rarity'>('price-asc');
marketAffordable = signal(false);
```

These are pure view state; nothing is fetched or persisted.

### 4.2 Chip groups + counts

A chip maps to one or more stored `MarketKind`s. Only **Pets** bundles more than one —
this is a display grouping, the backend still stores `kind: 'pet'` and `kind: 'egg'`
distinctly (they route into `pets[]` vs `eggs[]` on purchase):

```ts
const MARKET_GROUPS = [
  { key: 'gear',       label: 'Gear',        kinds: ['gear'] },
  { key: 'consumable', label: 'Consumables', kinds: ['consumable'] },
  { key: 'scroll',     label: 'Scrolls',     kinds: ['scroll'] },
  { key: 'pets',       label: 'Pets',        kinds: ['pet', 'egg'] },
] as const;
```

`marketCounts` (computed) returns `{ all, gear, consumable, scroll, pets, mine }` counted
off `marketRows()`. The chip bar always shows **All** and **Mine**; a group chip renders
only when its count `> 0`, so an empty category never clutters the bar. Each chip shows its
count (e.g. `Gear 23`).

**Reset-on-empty guard:** if the active group's count reaches 0 (the last listing of that
kind is bought/cancelled), `marketFilter` falls back to `'all'` so the view never strands
on an empty filter. `all` and `mine` are never auto-reset.

### 4.3 `visibleMarketRows` (computed): filter → sort

1. **Filter by chip:** `mine` → `row.own`; a group → `row.kind ∈ group.kinds`; `all` → all rows.
2. **Affordable filter** (skipped when filter is `mine`): when `marketAffordable()`, keep
   rows where `row.own || you.spores >= row.price`. Own rows are never hidden by affordability.
3. **Sort:**
   - `price-asc` / `price-desc` — by `row.price`.
   - `rarity` — by rarity rank, **high → low**, using the four real tiers
     (`tierRarity`: `common | rare | legendary | mythic`). Rows with **no** rarity
     (consumables — `marketView` returns no `rarity` for them) rank last.
   - Tie-break for every sort: price ascending, then `view.name` locale compare (stable, deterministic).

```ts
const RARITY_RANK: Record<Rarity, number> = { mythic: 0, legendary: 1, rare: 2, common: 3 };
const rankOf = (r?: RarityInfo) => (r ? RARITY_RANK[r.key] : 4); // no-rarity (consumables) last
```

### 4.4 Affordable semantics

Deliberately **price-only** (`you.spores >= price`) to match the plain reading of "hide what
I can't afford." Destination-full ("Bag full", "Stash full", "Scroll satchel full") is a
*different* blocker and is already surfaced by the existing per-row `buyReason()` note — a
listing you can afford but have no room for stays **visible** with its reason, rather than
silently vanishing. The Affordable toggle is **hidden** while the filter is `mine`
(you're managing, not buying).

### 4.5 Mine view — manage your own listings

Selecting **Mine** filters to `row.own`. Each row keeps the existing **Cancel** button
(`marketCancel(l.id)`), under a header:

> **Your listings — `4 / 10`**

The cap is `MARKET_MAX_LISTINGS` (10). At the cap the header appends "· cancel one to free a
slot" and tints gold. Empty state: "No active listings — switch to **Sell** to list
something." Because the client has no mirror of `MARKET_MAX_LISTINGS` today, add one
constant `MARKET_MAX_LISTINGS = 10` in [`data/items.ts`](../src/app/undercity/data/items.ts)
with a comment pointing at `undercity_config.py` (per the display-mirror convention).

### 4.6 Empty states (per filter)

Instead of the single generic "No listings yet", the message reflects the active filter:
`mine` → the switch-to-Sell line above; affordable-on with no matches → "Nothing here you
can afford yet."; a group → "No gear listed right now."; `all` → "The market is empty right now."

### 4.7 Toolbar markup & placement

The toolbar replaces the current `On the market` sub-heading inside the
`@if (marketTab() === 'buy')` block; the Buy `@for` iterates `visibleMarketRows()` instead
of `marketRows()`. Structure:

- **Row 1 — kind chips:** a horizontally scrollable flex row (`overflow-x: auto`,
  scrollbar hidden, edge mask-fade), each chip a `<button>` with `aria-pressed`.
- **Row 2 — sort + affordable:** a 3-button segmented control (`aria-pressed` per option)
  and an Affordable toggle button (`aria-pressed`, a check box glyph). Wraps on narrow widths.
- **Mine header** (only when filter is `mine`) sits between the toolbar and the list.

Row markup (`forge-row`, rarity chip, `seller-chip`, Buy/Cancel, `block-reason`) is reused
unchanged — only the *set* and *order* of rendered rows changes.

## 5. Files touched (client only)

- [`plaza-tab.component.ts`](../src/app/undercity/tabs/plaza-tab.component.ts) — three
  signals, `MARKET_GROUPS`, `marketCounts` + `visibleMarketRows` computeds, `rankOf` helper,
  setters (`setMarketFilter` / `setMarketSort` / `toggleMarketAffordable`), reset-on-empty guard.
- [`plaza-tab.component.html`](../src/app/undercity/tabs/plaza-tab.component.html) — toolbar,
  Mine header, Buy loop → `visibleMarketRows()`, per-filter empty states.
- [`plaza-tab.component.scss`](../src/app/undercity/tabs/plaza-tab.component.scss) — chip bar
  (scroll + mask + active states), sort segmented control, Affordable toggle, Mine header.
  Reuse Golgari tokens and the existing `rarity-badge` colors. Material / `uc-*` icons only,
  **no emoji** (project rule).
- [`data/items.ts`](../src/app/undercity/data/items.ts) — add the `MARKET_MAX_LISTINGS = 10`
  display mirror.

## 6. What stays the same

- **Backend:** `market()` still ships the full array each state fetch; `_market_buy` /
  `_market_cancel` / `_market_list` and the `MARKET#` schema are untouched.
- **Sell view:** listing gear / bag items / scrolls from inventory is unchanged.
- **Per-row buy gating:** `buyReason()` (afford + destination-capacity) still decides whether
  a Buy button is enabled and what note shows.

## 7. Testing & verification

There is no frontend test runner in this repo (Karma/Jasmine were removed), so:

1. `npm run build` green (the whole change is template + component logic + styles).
2. Drive the live market with the **run-undercity** skill: seed several listings across
   gear/consumable/scroll/pet/egg plus a few of your own, then verify:
   - Chip set matches non-empty kinds; counts are correct; `Pets` shows pets **and** eggs.
   - All three sorts order correctly; consumables sink to the bottom under **Rarity**.
   - Affordable hides only price-unaffordable listings; full-container ones stay with a note.
   - **Mine** shows only your listings, Cancel works, header reads `N / 10` and flags the cap.
   - Buying the last item of a filtered kind falls the view back to **All**.

## 8. Deferred / out of scope

- **Server-side trimming / pagination** of the market payload (explicitly out of scope; the
  full array is still delivered). Revisit only if payload size becomes a felt problem.
- **Name search**, **build/slot-fit** filter ("gear I can equip"), and **anti-snipe /
  fairness** ordering — considered and dropped for this pass.
