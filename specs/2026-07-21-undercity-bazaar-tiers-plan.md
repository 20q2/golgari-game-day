# Tier-Gated Bazaars & Island Endgame Bazaar — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Stop T3 gear from being sold freely at every bazaar — gate gear tiers so biome bazaars stock T1/T2 (with a rare "black-market" T3 event) and a new central-island bazaar (`isl_bg1`) stocks mostly T2 / some T3, fronted by the Witch.

**Architecture:** The server shop generator (`_gen_shop_stock` in `undercity_db.py`) is deterministic per `(node, window)`. We change gear selection from a uniform pick across all tiers to a **tier-first** pick driven by per-bazaar-class tier tables. A single map node type flip (`isl_bg1`: `mystery` → `shop`) creates the island bazaar. The Angular client mirrors the new `blackMarket` line flag and assigns keepers by node.

**Tech Stack:** Python 3.11 Lambda (pure functions + in-memory FakeTable pytest suite), Angular 20 standalone components, single `map.json` source of truth synced to a client copy.

Design: [specs/2026-07-21-undercity-bazaar-tiers-design.md](2026-07-21-undercity-bazaar-tiers-design.md)

**Convention note (from CLAUDE.md):** weighted tables live in `undercity_data.py`; scalar knobs live in `undercity_config.py`. `undercity_data.py` does `from undercity_config import *`, so **every** new constant is reachable as `data.<NAME>` from `undercity_db.py`. In `undercity_db.py` the bare name `config` is a season-config dict, **not** the module — always reference tunables via `data.`.

---

## Task 1: Map — turn `isl_bg1` into the island bazaar

**Files:**
- Modify: `infrastructure/lambda/map.json:989-990`
- Regenerate: `public/data/undercity-map.json` (via `sync_map.py`)
- Test: `infrastructure/lambda/tests/test_map_file.py` (copies-match — already exists, must stay green)

- [ ] **Step 1: Flip the node type**

Edit `infrastructure/lambda/map.json`. The `isl_bg1` node object begins at line 989. Change only its `type`:

```
   "id": "isl_bg1",
   "type": "mystery",
```
becomes
```
   "id": "isl_bg1",
   "type": "shop",
```

Leave `x`, `y`, `region`, and `neighbors` (`isl_ossuary`, `boss`) untouched. Do **not** touch `isl_bg2` or `isl_trade`.

- [ ] **Step 2: Sync the client copy**

Run: `cd infrastructure/lambda && python sync_map.py`
Expected: prints `.../map.json -> .../public/data/undercity-map.json`.

- [ ] **Step 3: Verify the map tests pass**

Run: `cd infrastructure/lambda && python -m pytest tests/test_map_file.py tests/test_map.py -q`
Expected: PASS. (Copies now match; `isl_bg1` is a valid `shop` node wired into the isle.)

- [ ] **Step 4: Confirm the bazaar surfaces without breaking the existing shop suite**

Run: `cd infrastructure/lambda && python -m pytest tests/test_undercity_db.py -k shop_or_bazaar -q` — if no tests match that filter, run `-k "shop or bazaar"` instead.
Expected: PASS. `test_state_surfaces_bazaars` now includes `isl_bg1` among `bazaars` (its assertions read `shop_nodes[0]`, a biome node, so they still hold). At this point `isl_bg1` generates stock with the *old* uniform-tier logic — that's fine; Task 2 gates it.

- [ ] **Step 5: Commit**

```bash
git add infrastructure/lambda/map.json public/data/undercity-map.json
git commit -m "feat(undercity): add island bazaar node (isl_bg1: mystery -> shop)"
```

---

## Task 2: Backend — tier-gated gear selection

**Files:**
- Modify: `infrastructure/lambda/undercity_config.py` (add `BAZAAR_BLACKMARKET_CHANCE`)
- Modify: `infrastructure/lambda/undercity_data.py` (add `BAZAAR_GEAR_TIERS`, `ISLAND_BAZAAR_GEAR_TIERS`, `ISLAND_BAZAAR_NODES`)
- Modify: `infrastructure/lambda/undercity_db.py:65-94` (`_gen_shop_stock`) + add `_weighted_tier` helper
- Test: `infrastructure/lambda/tests/test_undercity_db.py` (update one test, add two)

- [ ] **Step 1: Add the scalar knob to `undercity_config.py`**

Add near the other `SHOP_*` facility knobs (after `SHOP_CONSUMABLE_QTY`, ~line 140):

```python
# Per-(node, window) chance a biome bazaar rolls a rare "black-market" event
# that forces ONE of its gear slots to a T3 piece. 30-min windows -> roughly one
# sighting per bazaar every ~10 hours. Island bazaars ignore this (they stock T3
# directly). Endgame T3 gear should be a treat, never a shortcut.
BAZAAR_BLACKMARKET_CHANCE = 0.05
```

- [ ] **Step 2: Add the tier tables + island-node set to `undercity_data.py`**

Add near the shop/loot tables (just after the `SHOP_*` comment block that references `undercity_config.py`, ~line 524):

```python
# ── Bazaar gear tiers ────────────────────────────────────────────────────────
# Standard (biome) bazaars stock these tiers only (uniform pick among all pieces
# of these tiers within the chosen slot). T3 reaches biome shops solely via the
# rare BAZAAR_BLACKMARKET_CHANCE event (see undercity_db._gen_shop_stock).
BAZAAR_GEAR_TIERS = {1, 2}

# Island bazaars pick a tier by weight (then a random piece of it). ~70% T2 /
# ~30% T3 -> "mostly T2, some T3".
ISLAND_BAZAAR_GEAR_TIERS = {2: 7, 3: 3}

# Bazaar nodes that use ISLAND_BAZAAR_GEAR_TIERS instead of the biome table.
ISLAND_BAZAAR_NODES = {'isl_bg1'}
```

- [ ] **Step 3: Write the failing tests**

In `tests/test_undercity_db.py`, **replace** the tier portion of `test_gen_shop_stock_shape_and_determinism` and **add** two new tests. First, update the node pick + gear-tier assertion in the existing test:

Change the node selection line from:
```python
    node = next(n for n, v in data.MAP_NODES.items() if v['type'] == 'shop')
```
to:
```python
    node = next(n for n, v in data.MAP_NODES.items()
                if v['type'] == 'shop' and n not in data.ISLAND_BAZAAR_NODES)
```
and, immediately after the existing `assert all(e['qty'] == data.SHOP_GEAR_QTY ...)` gear line, insert:
```python
    # Biome bazaars: every gear line is T1/T2, except a rare black-market T3.
    for e in stock['gear']:
        t = data.GEAR[e['item']]['tier']
        if e.get('blackMarket'):
            assert t == 3
        else:
            assert t in data.BAZAAR_GEAR_TIERS
```

Then add these two tests just below `test_gen_shop_stock_shape_and_determinism`:
```python
def test_island_bazaar_stocks_only_t2_t3():
    node = next(iter(data.ISLAND_BAZAAR_NODES))
    for w in range(100, 160):
        stock = db._gen_shop_stock(node, w)
        for e in stock['gear']:
            assert data.GEAR[e['item']]['tier'] in (2, 3)
            assert not e.get('blackMarket')          # island never uses black market
    # Mostly T2, some T3 — both tiers show up across many windows.
    tiers = [data.GEAR[e['item']]['tier']
             for w in range(100, 300) for e in db._gen_shop_stock(node, w)['gear']]
    assert 2 in tiers and 3 in tiers


def test_biome_black_market_is_rare_and_deterministic():
    node = next(n for n, v in data.MAP_NODES.items()
                if v['type'] == 'shop' and n not in data.ISLAND_BAZAAR_NODES)
    windows = list(range(0, 2000))
    hits = [w for w in windows
            if any(e.get('blackMarket') for e in db._gen_shop_stock(node, w)['gear'])]
    assert 0 < len(hits) < len(windows) * 0.2        # happens, but rare
    for w in hits:                                    # every black-market line is T3
        bm = [e for e in db._gen_shop_stock(node, w)['gear'] if e.get('blackMarket')]
        assert bm and all(data.GEAR[e['item']]['tier'] == 3 for e in bm)
    assert db._gen_shop_stock(node, hits[0]) == db._gen_shop_stock(node, hits[0])
```

- [ ] **Step 4: Run the tests to verify they fail**

Run: `cd infrastructure/lambda && python -m pytest tests/test_undercity_db.py -k "shop_stock or island_bazaar or black_market" -q`
Expected: FAIL — `AttributeError: module 'undercity_data' has no attribute 'ISLAND_BAZAAR_NODES'` won't happen (added in Step 2), but `test_island_bazaar_stocks_only_t2_t3` and `test_biome_black_market...` FAIL because `_gen_shop_stock` still picks any tier and never sets `blackMarket`.

- [ ] **Step 5: Rewrite `_gen_shop_stock` and add `_weighted_tier`**

In `undercity_db.py`, add this helper just above `_gen_shop_stock` (after `_shop_window_end`):

```python
def _weighted_tier(rng, weights):
    """Deterministic weighted pick from {tier: weight}. Sorted for stability."""
    total = sum(weights.values())
    roll = rng.random() * total
    for tier in sorted(weights):
        roll -= weights[tier]
        if roll < 0:
            return tier
    return max(weights)
```

Replace the gear block of `_gen_shop_stock` (the lines that build `by_slot`, shuffle `slots`, and the `gear = [...]` comprehension) with:

```python
    # Gear: one piece per distinct slot. Tier is chosen per bazaar class.
    by_slot = {}
    for gid, g in data.GEAR.items():
        by_slot.setdefault(g['slot'], []).append(gid)
    slots = list(by_slot)
    rng.shuffle(slots)
    chosen = slots[:data.SHOP_GEAR_SLOTS]

    is_island = node in data.ISLAND_BAZAAR_NODES

    # Biome bazaars: a rare window forces ONE chosen slot to a "black-market" T3.
    black_slot = None
    if not is_island and rng.random() < data.BAZAAR_BLACKMARKET_CHANCE:
        black_slot = rng.choice(chosen)

    gear = []
    for s in chosen:
        by_tier = {}
        for gid in by_slot[s]:
            by_tier.setdefault(data.GEAR[gid]['tier'], []).append(gid)
        if is_island:
            weights = {t: w for t, w in data.ISLAND_BAZAAR_GEAR_TIERS.items() if t in by_tier}
            gid = rng.choice(by_tier[_weighted_tier(rng, weights)])
            gear.append({'item': gid, 'qty': data.SHOP_GEAR_QTY})
        elif s == black_slot and 3 in by_tier:
            gid = rng.choice(by_tier[3])
            gear.append({'item': gid, 'qty': data.SHOP_GEAR_QTY, 'blackMarket': True})
        else:
            pool = [gid for gid in by_slot[s] if data.GEAR[gid]['tier'] in data.BAZAAR_GEAR_TIERS]
            gid = rng.choice(pool)
            gear.append({'item': gid, 'qty': data.SHOP_GEAR_QTY})
```

Leave the consumables and grimoires blocks and the `return {...}` unchanged.

- [ ] **Step 6: Run the tests to verify they pass**

Run: `cd infrastructure/lambda && python -m pytest tests/test_undercity_db.py -k "shop_stock or island_bazaar or black_market" -q`
Expected: PASS (all shop/island/black-market tests green).

- [ ] **Step 7: Run the full backend suite**

Run: `cd infrastructure/lambda && python -m pytest tests -q`
Expected: PASS. (Determinism and `test_state_surfaces_bazaars` unaffected; trading-post tests untouched.)

- [ ] **Step 8: Commit**

```bash
git add infrastructure/lambda/undercity_config.py infrastructure/lambda/undercity_data.py infrastructure/lambda/undercity_db.py infrastructure/lambda/tests/test_undercity_db.py
git commit -m "feat(undercity): tier-gate bazaar gear (biome T1/T2 + rare T3, island T2/T3)"
```

---

## Task 3: Client — black-market flag, node-aware keeper, island heading

**Files:**
- Modify: `src/app/undercity/services/undercity-models.ts:361-364` (`ShopStockItem`)
- Modify: `src/app/undercity/tabs/board-tab.component.ts` (`BAZAAR_KEEPERS`, `bazaarKeeper()`, add `islandBazaar()`, `bazaarTitle()`, extend `shopGearRows()`)
- Modify: `src/app/undercity/tabs/board-tab.component.html:313-345` (heading + black-market badge)

No test runner is wired for the frontend (see CLAUDE.md); verification is the production build in Task 4.

- [ ] **Step 1: Add the `blackMarket` flag to the stock model**

In `undercity-models.ts`, extend `ShopStockItem`:

```typescript
/** One stocked line in a bazaar tab (grimoires carry no qty). */
export interface ShopStockItem {
  item: string;
  qty: number;
  /** True only for a biome bazaar's rare "black-market" T3 line. */
  blackMarket?: boolean;
}
```

- [ ] **Step 2: Split biome keepers from the island Witch**

In `board-tab.component.ts`, replace the three-entry `BAZAAR_KEEPERS` array (currently `shopkeeper1`, `shopkeeper2`, `shopkeeper4`) with the biome pair only, and add the Witch as a fixed island keeper plus the island-node set:

```typescript
  /** Node ids whose bazaar is the central-island endgame vendor (mirror of
   * undercity_data.ISLAND_BAZAAR_NODES). */
  private readonly ISLAND_BAZAAR_NODES = new Set(['isl_bg1']);

  /** Biome bazaar vendors, in rotation order. Which one is "on shift" alternates
   * with the shared restock window (mirrors data.SHOP_REFRESH_MIN = 30
   * server-side) so every player sees the same vendor until the next restock. */
  private readonly BAZAAR_KEEPERS: { art: string; quote: string }[] = [
    {
      art: 'undercity/map_events/shopkeeper1.png',
      quote: 'Spare a few spores, friend? Good honest wares — I swear it on me turnips.',
    },
    {
      art: 'undercity/map_events/shopkeeper2.png',
      quote: 'I hawked turnips at this very stall, once. One little bargain later… the stock improved, and so did the terms.',
    },
  ];

  /** The island bazaar's fixed vendor — the Witch (keeper 4). */
  private readonly islandKeeper = {
    art: 'undercity/map_events/shopkeeper4.png',
    quote: 'Come closer, morsel. Baba has cauldrons to fill and coin to make. Buy something, hmm?',
  };
```

(Leave `tradingKeeper` (`shopkeeper3.png`, the ooze) exactly as it is — that persona is reserved for Umori's future wandering trading post.)

- [ ] **Step 3: Make keeper + heading node-aware**

In `board-tab.component.ts`, add an `islandBazaar()` helper and a `bazaarTitle()`, and rewrite `bazaarKeeper()` to branch on the node. Place `islandBazaar()` next to `currentBazaar` (~line 433):

```typescript
  protected islandBazaar(): boolean {
    const pos = this.store.you()?.position;
    return !!pos && this.ISLAND_BAZAAR_NODES.has(pos);
  }

  protected bazaarTitle(): string {
    return this.islandBazaar() ? "The Witch's Cauldron" : 'Rot-Farm Bazaar';
  }
```

Replace `bazaarKeeper()` (~line 487) with:

```typescript
  protected bazaarKeeper(): { art: string; quote: string } {
    if (this.islandBazaar()) return this.islandKeeper;
    const at = this.currentBazaar()?.refreshesAt;
    const windowEndMs = at ? new Date(at + 'Z').getTime() : Date.now();
    const windowIdx = Math.round(windowEndMs / (30 * 60_000));
    return this.BAZAAR_KEEPERS[windowIdx % this.BAZAAR_KEEPERS.length];
  }
```

- [ ] **Step 4: Carry `blackMarket` into the gear rows**

In `board-tab.component.ts`, extend `shopGearRows()` (~line 435) to surface the flag:

```typescript
  protected shopGearRows(): { info: GearInfo; qty: number; blackMarket: boolean }[] {
    return (this.currentBazaar()?.gear ?? [])
      .map((s) => ({ info: GEAR_MAP[s.item], qty: s.qty, blackMarket: !!s.blackMarket }))
      .filter((r) => !!r.info);
  }
```

- [ ] **Step 5: Show the island heading and a black-market badge**

In `board-tab.component.html`, change the shop-modal heading (line 314) from the hardcoded name to the node-aware title:

```html
        <h3><mat-icon class="mi">storefront</mat-icon> {{ bazaarTitle() }}</h3>
```

Then, in the gear-row loop (the `@for (r of shopGearRows(); ...)` block, ~line 330-334), add a badge after the name span. The row currently reads:

```html
              <div class="shop-row" [attr.data-rarity]="tierRarity(r.info.tier).key">
                <span class="shop-name">{{ r.info.name }}
```
Insert the badge immediately after `{{ r.info.name }}` (inside the `shop-name` span, before its closing tag):

```html
                  @if (r.blackMarket) {
                    <span class="black-market-tag">Black Market</span>
                  }
```

- [ ] **Step 6: Style the badge**

In `src/app/undercity/tabs/board-tab.component.scss`, add a small rule (reuse existing palette tokens — a violet/gold accent to read as illicit-but-premium):

```scss
.black-market-tag {
  margin-left: 6px;
  padding: 1px 6px;
  border-radius: 6px;
  font-size: 0.68rem;
  font-weight: 700;
  letter-spacing: 0.02em;
  text-transform: uppercase;
  color: #f4e6c0;
  background: rgba(120, 40, 120, 0.55);
  border: 1px solid rgba(210, 160, 90, 0.6);
}
```

- [ ] **Step 7: Commit**

```bash
git add src/app/undercity/services/undercity-models.ts src/app/undercity/tabs/board-tab.component.ts src/app/undercity/tabs/board-tab.component.html src/app/undercity/tabs/board-tab.component.scss
git commit -m "feat(undercity): island Witch keeper + black-market gear badge"
```

---

## Task 4: Verify end-to-end

**Files:** none (verification only)

- [ ] **Step 1: Full backend suite green**

Run: `cd infrastructure/lambda && python -m pytest tests -q`
Expected: PASS (0 failures).

- [ ] **Step 2: Production build compiles (frontend has no unit runner)**

Run: `npm run build:prod`
Expected: build succeeds; no TypeScript errors from the `ShopStockItem`, `shopGearRows`, or template changes.

- [ ] **Step 3: (Optional) drive it in a browser**

Use the `run-undercity` skill to reach a bazaar modal: confirm a biome bazaar shows only T1/T2 gear (keeper 1 or 2), and that landing a unit on `isl_bg1` shows the Witch and T2/T3 stock. The rare black-market line is hard to force live (5% per window); the badge/rendering is covered by the code path.

- [ ] **Step 4: Note for the user**

Deployment is the user's job (per project norms). End here with: backend tests green, prod build clean, and a note that a `cdk deploy` (Lambda) plus a frontend deploy are needed to ship, since balance lives server-side.

---

## Self-review notes

- **Spec coverage:** tier-first pick (Task 2), island bazaar on `isl_bg1` (Task 1), biome T1/T2 + rare black-market T3 (Task 2), island mostly-T2/some-T3 (Task 2), gear-only scope — grimoires/consumables blocks untouched (Task 2 Step 5), keeper roster 1&2 biome / Witch island (Task 3), black-market badge (Task 3), trading post untouched (no task modifies `isl_trade` or trading-post code/tests). ✅
- **Determinism:** all new `rng` calls (`rng.random()` for black-market, `_weighted_tier`'s `rng.random()`, per-slot `rng.choice`) occur in a fixed order inside the crc32-seeded generator, preserving "identical stock per `(node, window)` for all players." A mid-window redeploy can reshuffle the current window's freshly-generated stock once; it self-heals at the next 30-min boundary — acceptable, not worth guarding.
- **Type consistency:** `blackMarket` optional bool flows server (`{'item','qty','blackMarket'}`) → `ShopStockItem.blackMarket?` → `shopGearRows().blackMarket` → template `r.blackMarket`. `ISLAND_BAZAAR_NODES` mirrored as a `Set<string>` client-side.
