# Scout Pet → Biome Bazaar Delivery — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Turn the near-useless scout pet into a biome bazaar courier: it peeks at the one bazaar in the player's current biome for free and hauls back one item (full price) whose max tier scales with the pet's level.

**Architecture:** All rules live server-side in the Python Lambda. A tier-ceiling scalar table (config, mirrored to the client) gates what the scout can fetch. `_buy`'s purchase body is extracted into a shared `_apply_purchase` used by both the at-shop path and two new pet actions (`pet-scout-peek`, read-only; `pet-scout-buy`, mutating + cooldown-on-buy). The Angular client replaces the old "pick any bazaar" scout picker with a biome courier modal.

**Tech Stack:** Python 3.11 Lambda (pure functions + DynamoDB I/O, pytest with an in-memory `FakeTable`), Angular 20 standalone components (no frontend test runner — verify with `npm run build`).

**Reference spec:** [specs/2026-08-05-undercity-scout-remote-buy-design.md](2026-08-05-undercity-scout-remote-buy-design.md)

**Run all backend tests from** `infrastructure/lambda/`:
```bash
python -m pytest tests -q
```

---

## File structure

| File | Responsibility | Change |
|------|----------------|--------|
| `infrastructure/lambda/undercity_config.py` | Scalar tunable: tier-ceiling-by-level table | Modify |
| `infrastructure/lambda/undercity_db.py` | Tier-cap helper, biome bazaar lookup, `_apply_purchase` refactor, two scout actions, dispatcher wiring | Modify |
| `infrastructure/lambda/tests/test_undercity_scout_remote_buy.py` | Full behavior coverage for the new feature | Create |
| `src/app/undercity/data/pets.ts` | Client mirror: tier-ceiling table + scout ability stat line | Modify |
| `src/app/undercity/tabs/board-tab.component.ts` | Biome courier modal: peek on open, tier-locked buy | Modify |
| `src/app/undercity/tabs/board-tab.component.html` | Courier modal markup (replaces bird-scout picker) | Modify |

---

## Task 1: Tier-ceiling tunable + server helper

**Files:**
- Modify: `infrastructure/lambda/undercity_config.py` (Companions section, after line 355)
- Modify: `infrastructure/lambda/undercity_db.py` (near the other pet helpers, after `_pet_ability_cooldown_min` ~line 1209)
- Test: `infrastructure/lambda/tests/test_undercity_scout_remote_buy.py`

- [ ] **Step 1: Write the failing test**

Create `infrastructure/lambda/tests/test_undercity_scout_remote_buy.py`:

```python
import sys, os
from datetime import datetime, timedelta

sys.path.insert(0, os.path.join(os.path.dirname(__file__), '..'))

import undercity_db as db
import undercity_data as data
import undercity_config as config
from test_undercity_db import table, act, _player_at, _sid  # noqa: F401


def _scout(level=1, tier=1):
    """A scout pet dict at a given level/tier (Gloomshrieker is a scout)."""
    return {'id': 'pet-scout', 'species': 'baby_gloomshrieker',
            'tier': tier, 'level': level, 'mergeProgress': 0}


def test_scout_tier_cap_by_level():
    # 1-2 -> T1, 3-4 -> T2, 5-6 -> T3, 7-9 -> T4.
    assert [db._pet_scout_tier_cap(l) for l in range(1, 10)] == [1, 1, 2, 2, 3, 3, 4, 4, 4]
    # Never exceeds the top gear tier even if a level somehow runs high.
    assert db._pet_scout_tier_cap(99) == 4
```

- [ ] **Step 2: Run test to verify it fails**

Run: `python -m pytest tests/test_undercity_scout_remote_buy.py::test_scout_tier_cap_by_level -v`
Expected: FAIL — `AttributeError: module 'undercity_db' has no attribute '_pet_scout_tier_cap'`

- [ ] **Step 3: Add the config table**

In `undercity_config.py`, after the `PET_ABILITY_COOLDOWN_FLOOR` line (~355), add:

```python
# Scout courier: the max ITEM tier a scout can haul back from its biome bazaar,
# indexed by the pet's level - 1 (clamped). Merging up a scout (raising its level
# cap via tier) is what unlocks the rare T3 black-market gear and T3/T4 eggs.
# Levels 1-2 -> T1, 3-4 -> T2, 5-6 -> T3, 7-9 -> T4.
PET_SCOUT_TIER_BY_LEVEL = [1, 1, 2, 2, 3, 3, 4, 4, 4]
```

- [ ] **Step 4: Add the server helper**

In `undercity_db.py`, immediately after `_pet_ability_cooldown_min` (~line 1209), add:

```python
def _pet_scout_tier_cap(level):
    """Max item tier a scout of this level can haul back from its biome bazaar."""
    idx = max(0, min(int(level), len(config.PET_SCOUT_TIER_BY_LEVEL)) - 1)
    return config.PET_SCOUT_TIER_BY_LEVEL[idx]
```

Confirm `undercity_db.py` already imports config as `config` (it references `config.*` elsewhere). If it imports `undercity_config` under a different name, match that name instead.

- [ ] **Step 5: Run test to verify it passes**

Run: `python -m pytest tests/test_undercity_scout_remote_buy.py::test_scout_tier_cap_by_level -v`
Expected: PASS

- [ ] **Step 6: Commit**

```bash
git add infrastructure/lambda/undercity_config.py infrastructure/lambda/undercity_db.py infrastructure/lambda/tests/test_undercity_scout_remote_buy.py
git commit -m "feat(undercity): scout courier tier-ceiling table + helper"
```

---

## Task 2: Biome bazaar lookup

Find the one bazaar node in the player's current biome (`region` of `doc['position']`), or `None` when the biome has no bazaar.

**Files:**
- Modify: `infrastructure/lambda/undercity_db.py` (after `_pet_scout_tier_cap`)
- Test: `infrastructure/lambda/tests/test_undercity_scout_remote_buy.py`

- [ ] **Step 1: Write the failing test**

Append to the test file:

```python
def test_biome_bazaar_lookup(table):
    sid, doc = _player_at(table, 'n1')
    # Start position is cavern_r0 (a gate in the 'cavern' biome). Its bazaar is
    # the single shop node in that region.
    doc['position'] = 'cavern_r0'
    node = db._biome_bazaar_node(table, sid, doc)
    assert node is not None
    nmap = db._season_map(table, sid)
    assert nmap[node]['type'] == 'shop'
    assert nmap[node]['region'] == 'cavern'

    # The deep biomes have no bazaar -> None.
    depths = next(nid for nid, n in nmap.items() if n.get('region') == 'depths')
    doc['position'] = depths
    assert db._biome_bazaar_node(table, sid, doc) is None
```

- [ ] **Step 2: Run test to verify it fails**

Run: `python -m pytest tests/test_undercity_scout_remote_buy.py::test_biome_bazaar_lookup -v`
Expected: FAIL — `AttributeError: ... '_biome_bazaar_node'`

- [ ] **Step 3: Implement the lookup**

In `undercity_db.py`, after `_pet_scout_tier_cap`, add:

```python
def _biome_bazaar_node(table, sid, doc):
    """The single bazaar node in the player's current biome, or None if that
    biome has no shop (depths / ruin / wilderness). Server-authoritative: the
    scout can only reach the shop co-located in the region it currently stands
    in."""
    nmap = _season_map(table, sid)
    here = nmap.get(doc.get('position'))
    if not here:
        return None
    region = here.get('region')
    for nid, n in nmap.items():
        if n.get('type') == 'shop' and n.get('region') == region:
            return nid
    return None
```

- [ ] **Step 4: Run test to verify it passes**

Run: `python -m pytest tests/test_undercity_scout_remote_buy.py::test_biome_bazaar_lookup -v`
Expected: PASS

- [ ] **Step 5: Commit**

```bash
git add infrastructure/lambda/undercity_db.py infrastructure/lambda/tests/test_undercity_scout_remote_buy.py
git commit -m "feat(undercity): biome bazaar lookup for scout courier"
```

---

## Task 3: Extract `_apply_purchase` from `_buy` (with optional tier cap)

Refactor so the purchase body is shared. This task must NOT change normal-buy behavior — the existing suite stays green.

**Files:**
- Modify: `infrastructure/lambda/undercity_db.py` (`_buy`, lines ~6667–6754)
- Test: existing `tests/test_undercity_db.py` shop-buy tests (regression) + new coverage in Task 5

- [ ] **Step 1: Run the existing buy tests to capture the green baseline**

Run: `python -m pytest tests -q -k "buy or shop"`
Expected: PASS (record the count — it must not drop after the refactor).

- [ ] **Step 2: Replace `_buy` with a thin wrapper + shared `_apply_purchase`**

Replace the whole `_buy` function (lines ~6667–6754) with:

```python
def _buy(table, sid, doc, payload):
    nodes = _season_map(table, sid)
    node = doc.get('position')
    if nodes.get(node, {}).get('type') != 'shop':
        return _err('You are not at a shop.', 409)
    return _apply_purchase(table, sid, doc, node, payload)


def _apply_purchase(table, sid, doc, node, payload, tier_cap=None, ok_extra=None):
    """Shared purchase core for both the at-shop buy and the scout courier.

    `node` is an already-resolved shop node. `tier_cap`, when set, blocks buying
    gear/eggs whose tier exceeds it (consumables/grimoires are never tier-gated).
    `ok_extra` is merged into the success response (e.g. the courier's petAbility
    slice). Mutates `doc`; persists player-then-stock exactly as before."""
    item_id = payload.get('itemId')
    stock = _shop_stock(table, sid, node)
    deplete = None  # the stock line to decrement on a successful gear/consumable buy

    if payload.get('kind') == 'egg':
        try:
            tier = int(payload.get('tier'))
        except (TypeError, ValueError):
            return _err('Pick an egg.')
        if tier_cap is not None and tier > tier_cap:
            return _err('Your scout can only carry a lower-tier egg — merge it to reach this one.', 409)
        line = next((e for e in stock.get('eggs', []) if e['tier'] == tier), None)
        if not line:
            return _err("The bazaar isn't stocking that egg right now.", 409)
        if line['qty'] <= 0:
            return _err('Sold out — check back after the restock.', 409)
        cost = int(line.get('cost', data.SHOP_EGG_COST.get(tier, 99999)))
        if doc.get('spores', 0) < cost:
            return _err('Not enough Spores.', 409)
        doc['spores'] = doc.get('spores', 0) - cost
        _grant_egg(doc, tier)
        deplete = line
        text = f'Bought a tier-{tier} egg! It waits in your incubator queue.'
    elif item_id in data.GEAR:
        line = next((e for e in stock['gear'] if e['item'] == item_id), None)
        if not line:
            return _err("The bazaar isn't stocking that right now.", 409)
        if line['qty'] <= 0:
            return _err('Sold out — check back after the restock.', 409)
        g = data.GEAR[item_id]
        if tier_cap is not None and g['tier'] > tier_cap:
            return _err('Your scout can only haul lower-tier gear — merge it to reach this one.', 409)
        cost = g['cost']
        if doc.get('spores', 0) < cost:
            return _err('Not enough Spores.', 409)
        # Auto-equip into an empty slot; otherwise it needs stash room. We stall a
        # sale that would overflow a full stash rather than grinding a paid piece.
        slot_filled = bool((doc.get('gear') or {}).get(g['slot']))
        if slot_filled and len(doc.get('gearStash') or []) >= data.GEAR_STASH_SIZE:
            return _err('Your gear stash is full — salvage a piece at the Plaza first.', 409)
        doc['spores'] = doc.get('spores', 0) - cost
        got = _gain_gear(doc, item_id)
        deplete = line
        text = (f"Bought {g['name']} — equipped!" if got['outcome'] == 'equipped'
                else f"Bought {g['name']} — stashed. Equip it at the Plaza.")
    elif item_id in data.CONSUMABLES:
        line = next((e for e in stock['consumables'] if e['item'] == item_id), None)
        if not line:
            return _err("The bazaar isn't stocking that right now.", 409)
        if line['qty'] <= 0:
            return _err('Sold out — check back after the restock.', 409)
        c = data.CONSUMABLES[item_id]
        if len(doc.get('bag') or []) >= data.BAG_SIZE:
            return _err('Your bag is full (3 slots).', 409)
        if doc.get('spores', 0) < c['cost']:
            return _err('Not enough Spores.', 409)
        doc['spores'] -= c['cost']
        doc.setdefault('bag', []).append(item_id)
        deplete = line
        text = f"Bought {c['name']}"
    elif item_id in data.GRIMOIRES:
        g = data.GRIMOIRES[item_id]
        if g['tier'] != 1:
            return _err('The bazaar does not stock that tome.', 409)
        if item_id not in stock['grimoires']:
            return _err("The bazaar isn't stocking that tome right now.", 409)
        if item_id in (doc.get('grimoires') or []):
            return _err('You already own that grimoire.', 409)
        if doc.get('spores', 0) < g['cost']:
            return _err('Not enough Spores.', 409)
        doc['spores'] -= g['cost']
        _grant_grimoire(doc, item_id)
        text = f"Bought {g['name']}"
    else:
        return _err('Unknown item.')

    conflict = _save_or_conflict(table, doc)  # guard the player write first
    if conflict:
        return conflict
    if deplete is not None:                    # then the shared stock (last-writer-wins)
        deplete['qty'] -= 1
        table.put_item(Item={
            'pk': _season_pk(sid), 'sk': f'SHOP#{node}',
            'window': stock['window'], 'gear': stock['gear'],
            'consumables': stock['consumables'], 'grimoires': stock['grimoires'],
            'eggs': stock.get('eggs', [])})
    return _ok(doc, text=text, **(ok_extra or {}))
```

Note: this is the original body verbatim, with three additions — the `_buy` wrapper, the `tier_cap`/`ok_extra` parameters, and the two tier-gate checks (egg + gear). Nothing else changes.

- [ ] **Step 3: Run the regression tests**

Run: `python -m pytest tests -q -k "buy or shop"`
Expected: PASS with the same count as Step 1 (behavior unchanged for normal buys — `tier_cap` defaults to `None`).

- [ ] **Step 4: Run the full suite**

Run: `python -m pytest tests -q`
Expected: PASS (all green).

- [ ] **Step 5: Commit**

```bash
git add infrastructure/lambda/undercity_db.py
git commit -m "refactor(undercity): extract _apply_purchase from _buy (no behavior change)"
```

---

## Task 4: Scout courier actions (`pet-scout-peek`, `pet-scout-buy`)

**Files:**
- Modify: `infrastructure/lambda/undercity_db.py` — add two handlers; wire the dispatcher; drop the scout branch from `_use_pet_ability`; remove the obsolete `_pet_scout`
- Test: `infrastructure/lambda/tests/test_undercity_scout_remote_buy.py`

- [ ] **Step 1: Write the failing tests**

Append to the test file:

```python
def _put_scout_at_cavern(table, level=1, tier=1, spores=5000):
    """Seed a player with an active scout standing in the cavern biome, holding
    plenty of Spores. Returns (sid, user_id, doc)."""
    sid, doc = _player_at(table, 'n1')
    doc['position'] = 'cavern_r0'
    doc['pets'] = [_scout(level=level, tier=tier)]
    doc['activePetId'] = 'pet-scout'
    doc['spores'] = spores
    doc['petCooldowns'] = {}
    db._save_player(doc)  # if the harness lacks this, use table.put_item via _save_or_conflict
    return sid, doc


def test_peek_returns_biome_stock_without_cooldown(table):
    sid, doc = _player_at(table, 'n1')
    doc['position'] = 'cavern_r0'
    doc['pets'] = [_scout()]
    doc['activePetId'] = 'pet-scout'
    status, body = db._pet_scout_peek(table, sid, doc, {})
    assert status == 200
    pa = body['petAbility']
    assert pa['kind'] == 'scout-peek'
    assert pa['tierCap'] == 1
    assert 'gear' in pa['stock'] and 'eggs' in pa['stock']
    # Peeking never arms the cooldown.
    assert doc.get('petCooldowns', {}).get('scout') is None
    # Peeking again is fine (still free).
    status2, _ = db._pet_scout_peek(table, sid, doc, {})
    assert status2 == 200


def test_peek_no_bazaar_in_biome(table):
    sid, doc = _player_at(table, 'n1')
    nmap = db._season_map(table, sid)
    doc['position'] = next(nid for nid, n in nmap.items() if n.get('region') == 'depths')
    doc['pets'] = [_scout()]
    doc['activePetId'] = 'pet-scout'
    status, body = db._pet_scout_peek(table, sid, doc, {})
    assert status == 409


def test_peek_requires_active_scout(table):
    sid, doc = _player_at(table, 'n1')
    doc['position'] = 'cavern_r0'
    doc['pets'] = []
    doc['activePetId'] = None
    status, _ = db._pet_scout_peek(table, sid, doc, {})
    assert status == 409


def test_remote_buy_gear_charges_and_depletes(table):
    sid, doc = _player_at(table, 'n1')
    doc['position'] = 'cavern_r0'
    doc['pets'] = [_scout(level=5, tier=2)]  # tierCap 3 -> can buy any biome gear
    doc['activePetId'] = 'pet-scout'
    doc['spores'] = 9999
    node = db._biome_bazaar_node(table, sid, doc)
    stock = db._shop_stock(table, sid, node)
    gear_line = next(g for g in stock['gear'] if g['qty'] > 0)
    gid = gear_line['item']
    before = doc['spores']
    status, body = db._pet_scout_buy(table, sid, doc, {'itemId': gid})
    assert status == 200
    assert doc['spores'] == before - data.GEAR[gid]['cost']         # full price
    assert doc['petCooldowns']['scout']                             # cooldown armed on buy
    after = db._shop_stock(table, sid, node)
    got = next(g for g in after['gear'] if g['item'] == gid)
    assert got['qty'] == gear_line['qty'] - 1                       # depleted by one


def test_remote_buy_tier_gate_blocks_then_allows(table):
    sid, doc = _player_at(table, 'n1')
    doc['position'] = 'cavern_r0'
    doc['activePetId'] = 'pet-scout'
    doc['spores'] = 9999
    node = db._biome_bazaar_node(table, sid, doc)
    stock = db._shop_stock(table, sid, node)
    # Find a gear line whose tier is >= 2 (biome bazaars stock T1/T2 + rare T3).
    hi = next((g for g in stock['gear']
               if g['qty'] > 0 and data.GEAR[g['item']]['tier'] >= 2), None)
    if hi is None:
        return  # this window happens to stock only T1 gear; nothing to gate
    tier = data.GEAR[hi['item']]['tier']
    # A level-1 scout (tierCap 1) is blocked.
    doc['pets'] = [_scout(level=1, tier=1)]
    status, _ = db._pet_scout_buy(table, sid, doc, {'itemId': hi['item']})
    assert status == 409
    assert doc.get('petCooldowns', {}).get('scout') is None  # blocked buy arms nothing
    # A scout leveled past the item's tier can buy it.
    lvl = {2: 3, 3: 5, 4: 7}[tier]
    doc['pets'] = [_scout(level=lvl, tier=4)]
    status2, _ = db._pet_scout_buy(table, sid, doc, {'itemId': hi['item']})
    assert status2 == 200


def test_remote_buy_respects_cooldown(table):
    sid, doc = _player_at(table, 'n1')
    doc['position'] = 'cavern_r0'
    doc['pets'] = [_scout(level=1, tier=1)]
    doc['activePetId'] = 'pet-scout'
    doc['spores'] = 9999
    node = db._biome_bazaar_node(table, sid, doc)
    stock = db._shop_stock(table, sid, node)
    # A guaranteed-affordable, always-tier-1 consumable.
    cid = stock['consumables'][0]['item']
    status, _ = db._pet_scout_buy(table, sid, doc, {'itemId': cid})
    assert status == 200
    # Second buy before the cooldown elapses is rejected.
    status2, _ = db._pet_scout_buy(table, sid, doc, {'itemId': cid})
    assert status2 == 429


def test_remote_buy_insufficient_spores(table):
    sid, doc = _player_at(table, 'n1')
    doc['position'] = 'cavern_r0'
    doc['pets'] = [_scout(level=1, tier=1)]
    doc['activePetId'] = 'pet-scout'
    doc['spores'] = 0
    node = db._biome_bazaar_node(table, sid, doc)
    stock = db._shop_stock(table, sid, node)
    cid = stock['consumables'][0]['item']
    status, _ = db._pet_scout_buy(table, sid, doc, {'itemId': cid})
    assert status == 409
    assert doc.get('petCooldowns', {}).get('scout') is None
```

Note: the `_put_scout_at_cavern` helper is optional scaffolding — the tests above seed the doc inline, so remove the helper if your harness has no `_save_player`. Keep tests self-contained.

- [ ] **Step 2: Run tests to verify they fail**

Run: `python -m pytest tests/test_undercity_scout_remote_buy.py -v`
Expected: the peek/buy tests FAIL — `AttributeError: ... '_pet_scout_peek'` / `'_pet_scout_buy'`

- [ ] **Step 3: Add the two handlers**

In `undercity_db.py`, replace the obsolete `_pet_scout` function (lines ~1252–1261) with these two handlers:

```python
def _active_scout(doc):
    """Return (pet, level) if the player's active pet is a scout, else (None, 0)."""
    pet = _find_pet(doc, doc.get('activePetId'))
    if not pet or data.pet_role(pet.get('species')) != 'scout':
        return None, 0
    return pet, int(pet.get('level', 1))


def _pet_scout_peek(table, sid, doc, payload):
    """Read-only: reveal the current-window stock of the bazaar in the player's
    biome plus the scout's tier ceiling. No cooldown, no mutation."""
    pet, level = _active_scout(doc)
    if not pet:
        return _err('You have no active scout companion.', 409)
    node = _biome_bazaar_node(table, sid, doc)
    if not node:
        return _err('No bazaar in this biome for your scout to reach.', 409)
    stock = _shop_stock(table, sid, node)
    result = {'kind': 'scout-peek', 'node': node,
              'tierCap': _pet_scout_tier_cap(level), 'stock': _clean(stock),
              'text': 'Your scout ranges ahead and reports the local bazaar stock.'}
    return _ok(doc, text=result['text'], petAbility=result)


def _pet_scout_buy(table, sid, doc, payload):
    """Haul one item back from the biome bazaar at full price, gated by the
    scout's tier ceiling. Arms the shared scout cooldown ONLY on success."""
    pet, level = _active_scout(doc)
    if not pet:
        return _err('You have no active scout companion.', 409)
    if not _pet_cd_ready(doc, 'scout'):
        return _err('Your scout is still resting.', 429)
    node = _biome_bazaar_node(table, sid, doc)
    if not node:
        return _err('No bazaar in this biome for your scout to reach.', 409)
    cap = _pet_scout_tier_cap(level)
    # Arm the cooldown in-memory BEFORE the purchase; _apply_purchase persists the
    # doc only on success, so a rejected buy never commits the cooldown.
    _start_pet_cooldown(doc, 'scout', level)
    ability = {'kind': 'scout-buy', 'node': node, 'tierCap': cap}
    return _apply_purchase(table, sid, doc, node, payload,
                           tier_cap=cap, ok_extra={'petAbility': ability})
```

- [ ] **Step 4: Wire the dispatcher and drop the old scout activation path**

In `undercity_db.py`, in the `handlers` dict (~line 2540), add next to `'use-pet-ability': _use_pet_ability,`:

```python
        'use-pet-ability': _use_pet_ability,
        'pet-scout-peek': _pet_scout_peek, 'pet-scout-buy': _pet_scout_buy,
```

Then in `_use_pet_ability` (~line 1292), remove the scout branch so scouts no longer route through the generic activator (they use the two dedicated actions). Change:

```python
    if role == 'forage':
        result = _pet_forage(doc, level)
    elif role == 'scout':
        result = _pet_scout(table, sid, doc, payload)
    else:
        return _err('That companion has no ability to activate.', 409)
```

to:

```python
    if role == 'forage':
        result = _pet_forage(doc, level)
    else:
        # Scouts use the dedicated pet-scout-peek / pet-scout-buy actions.
        return _err('That companion has no ability to activate here.', 409)
```

- [ ] **Step 5: Run the new tests**

Run: `python -m pytest tests/test_undercity_scout_remote_buy.py -v`
Expected: PASS (all scout tests green).

- [ ] **Step 6: Run the full suite**

Run: `python -m pytest tests -q`
Expected: PASS. If a pre-existing test asserted the old `use-pet-ability` scout reveal (search `test_*` for `scout` + `use-pet-ability` / `targetNode`), update it to call `pet-scout-peek` / `pet-scout-buy` instead — the old reveal-only path is gone by design.

- [ ] **Step 7: Commit**

```bash
git add infrastructure/lambda/undercity_db.py infrastructure/lambda/tests/test_undercity_scout_remote_buy.py
git commit -m "feat(undercity): scout courier peek + remote-buy actions"
```

---

## Task 5: Client mirror in `pets.ts`

**Files:**
- Modify: `src/app/undercity/data/pets.ts`

- [ ] **Step 1: Add the tier-ceiling mirror + helper**

In `pets.ts`, in the "Timers / activated-ability cadence" region (after `PET_ABILITY_COOLDOWN_FLOOR`, ~line 129), add:

```typescript
/** Mirror of undercity_config.PET_SCOUT_TIER_BY_LEVEL: the max ITEM tier a scout
 *  can haul back from its biome bazaar, indexed by level - 1 (clamped). */
export const PET_SCOUT_TIER_BY_LEVEL = [1, 1, 2, 2, 3, 3, 4, 4, 4];

/** Max item tier a scout of this level can deliver. */
export function scoutTierCap(level: number): number {
  const i = Math.max(0, Math.min(level, PET_SCOUT_TIER_BY_LEVEL.length) - 1);
  return PET_SCOUT_TIER_BY_LEVEL[i];
}
```

- [ ] **Step 2: Give the scout a level-scaled ability stat line**

In `petAbilityStats` (~line 229), replace the scout case:

```typescript
    case 'scout':
      return [{ label: 'Cooldown', value: `${abilityCooldownMin('scout', lvl)} min` }];
```

with:

```typescript
    case 'scout':
      return [
        { label: 'Delivers up to', value: `${tierRarity(scoutTierCap(lvl)).label} gear` },
        { label: 'Cooldown', value: `${abilityCooldownMin('scout', lvl)} min` },
      ];
```

`tierRarity` is already imported at the top of `pets.ts`. Verify `tierRarity(n)` returns an object with a `.label` (e.g. "Common"/"Rare"); if the field is named differently (e.g. `.name`), use that.

- [ ] **Step 3: Update the scout role blurb**

In `PET_ROLES` (~line 41), change the scout blurb so it reflects the new power:

```typescript
  scout: { kind: 'activated', blurb: "Delivers gear from your local bazaar without a visit.", icon: 'visibility' },
```

Mirror the same blurb text in `undercity_data.py`'s `PET_ROLES['scout']['blurb']` so server and client agree (find it near line 1791).

- [ ] **Step 4: Verify it compiles**

Run: `npm run build`
Expected: build succeeds (no TS errors). If `tierRarity`'s label field differs, fix per Step 2's note and rebuild.

- [ ] **Step 5: Commit**

```bash
git add src/app/undercity/data/pets.ts infrastructure/lambda/undercity_data.py
git commit -m "feat(undercity): client mirror for scout courier tier ceiling"
```

---

## Task 6: Biome courier modal in the board tab

Replace the old "pick any bazaar" scout picker with a courier modal that peeks on open and buys tier-gated items.

**Files:**
- Modify: `src/app/undercity/tabs/board-tab.component.ts` (lines ~300–344)
- Modify: `src/app/undercity/tabs/board-tab.component.html` (the bird-scout modal block)

- [ ] **Step 1: Replace the scout TS logic**

In `board-tab.component.ts`, replace `tapBoardPet`'s scout branch and the entire "Bird scout" region (lines ~300–344) with:

```typescript
  /** Tap the board pet box — forage scavenges immediately; scout opens the biome
   *  courier modal; economy collects its gathered Spores. No-op while busy. */
  async tapBoardPet(): Promise<void> {
    const pet = this.activeUsablePet();
    if (!pet || this.busy()) return;
    if (petRole(pet.species) === 'scout') {
      await this.openScoutCourier();
      return;
    }
    if (!this.petBoxReady(pet)) return;
    await this.run(async () => {
      const resp = await this.store.action('use-pet-ability', {});
      this.showToast(resp.text ?? 'Your companion goes to work.');
    });
  }

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
   *  {kind:'egg', tier}). Refreshes the peek so depleted stock/cooldown show. */
  async scoutBuy(payload: Record<string, unknown>): Promise<void> {
    if (this.scoutOnCooldown()) return;
    await this.run(async () => {
      const resp = await this.store.action('pet-scout-buy', payload);
      this.showToast(resp.text ?? 'Your scout hauls it back.');
    });
    // Re-peek to reflect the depleted line; the buy armed the cooldown so buttons
    // now read as resting until it elapses.
    const resp = await this.store.action('pet-scout-peek', {}).catch(() => null);
    const pa = (resp as { petAbility?: { node: string; tierCap: number; stock: BazaarView } } | null)?.petAbility;
    if (pa) this.scoutView.set(pa);
  }
```

Keep the existing `BazaarView` and `GEAR_MAP` imports (already present). Remove the now-dead `birdScoutOpen`, `birdScoutResult`, `bazaarNodes`, `bazaarEggs`, `bazaarGearCount`, `openBirdScout`, `closeBirdScout`, and `scoutBazaar` members and any references to them. If `gearMapRef` was only used by the old picker template, keep it — the new template uses it too.

- [ ] **Step 2: Replace the modal markup**

In `board-tab.component.html`, find the bird-scout modal (search for `birdScoutOpen`) and replace that block with a courier modal. Model the item rows on the existing shop modal (search for `currentBazaar` / the shop buy list) so styling is reused. Structure:

```html
@if (scoutOpen() && scoutView(); as sv) {
  <div class="uc-modal-backdrop" (click)="closeScoutCourier()">
    <div class="uc-modal scout-courier" (click)="$event.stopPropagation()">
      <header>
        <h3>Scout Courier</h3>
        <button class="uc-icon-btn" (click)="closeScoutCourier()"><span class="material-icons">close</span></button>
      </header>
      <p class="hint">
        Your scout hauls back one item from your biome's bazaar — up to
        <strong>{{ tierRarity(sv.tierCap).label }}</strong>.
        @if (scoutOnCooldown()) { <span class="resting">Resting — one delivery per cooldown.</span> }
      </p>

      <section>
        <h4>Gear</h4>
        @for (g of sv.stock.gear; track g.item) {
          @if (g.qty > 0) {
            <div class="row" [class.locked]="scoutGearLocked(g.item)">
              <span class="name">{{ gearMapRef[g.item]?.name ?? g.item }}</span>
              <span class="cost">{{ gearMapRef[g.item]?.cost }}</span>
              @if (scoutGearLocked(g.item)) {
                <span class="lock">Merge your scout to reach {{ tierRarity(gearMapRef[g.item]?.tier ?? 1).label }}</span>
              } @else {
                <button (click)="scoutBuy({ itemId: g.item })"
                        [disabled]="scoutOnCooldown() || !canAfford(gearMapRef[g.item]?.cost)">Deliver</button>
              }
            </div>
          }
        }
      </section>

      <section>
        <h4>Eggs</h4>
        @for (e of sv.stock.eggs ?? []; track e.tier) {
          @if (e.qty > 0) {
            <div class="row" [class.locked]="scoutEggLocked(e.tier)">
              <span class="name">{{ tierRarity(e.tier).label }} Egg</span>
              <span class="cost">{{ e.cost }}</span>
              @if (scoutEggLocked(e.tier)) {
                <span class="lock">Merge your scout to reach {{ tierRarity(e.tier).label }}</span>
              } @else {
                <button (click)="scoutBuy({ kind: 'egg', tier: e.tier })"
                        [disabled]="scoutOnCooldown() || !canAfford(e.cost)">Deliver</button>
              }
            </div>
          }
        }
      </section>

      <section>
        <h4>Consumables</h4>
        @for (c of sv.stock.consumables; track c.item) {
          @if (c.qty > 0) {
            <div class="row">
              <span class="name">{{ consumableName(c.item) }}</span>
              <button (click)="scoutBuy({ itemId: c.item })"
                      [disabled]="scoutOnCooldown()">Deliver</button>
            </div>
          }
        }
      </section>
    </div>
  </div>
}
```

Adapt class names / helpers to the existing shop modal's conventions. Reuse whatever affordability helper the shop list uses (Task 5 references `canAfford`; the board tab already has an affordability predicate around line 1061 — use that exact method name). Reuse the consumable-name lookup the shop modal uses (`CONSUMABLE_MAP` is already imported). `tierRarity` is imported in this component (line ~67).

- [ ] **Step 3: Verify it compiles**

Run: `npm run build`
Expected: build succeeds. Fix any references to removed members (old bird-scout methods) the template still points at.

- [ ] **Step 4: Manual smoke test (optional but recommended)**

Use the `run-undercity` skill to launch the game against the live backend, get a creature with an active scout pet standing in a bazaar biome, tap the scout board box, and confirm: the courier modal opens (free), items above the tier cap are locked, buying an in-cap affordable item delivers it and arms the cooldown, and standing in a deep biome shows the "no bazaar" toast.

- [ ] **Step 5: Commit**

```bash
git add src/app/undercity/tabs/board-tab.component.ts src/app/undercity/tabs/board-tab.component.html
git commit -m "feat(undercity): scout biome courier modal (peek + tier-gated remote buy)"
```

---

## Final verification

- [ ] Backend suite green: `cd infrastructure/lambda && python -m pytest tests -q`
- [ ] Frontend compiles: `npm run build`
- [ ] Grep for stragglers: `git grep -n "_pet_scout\b\|birdScout\|scoutBazaar"` returns no live references (only the new `_pet_scout_peek`/`_pet_scout_buy`/`_pet_scout_tier_cap`).
- [ ] Server/client mirror check: `PET_SCOUT_TIER_BY_LEVEL` identical in `undercity_config.py` and `pets.ts`; scout blurb identical in `undercity_data.py` and `pets.ts`.

**Deploy:** the user runs the deploy (`cdk deploy` for the Lambda, `npm run deploy` for the site). End with tests green and note a deploy is needed for both the backend and frontend.

---

## Self-review notes

- **Spec coverage:** biome-local lookup (Task 2), full-price/no-markup + shared purchase (Task 3), tier ceiling table + merge-gated payoff (Tasks 1/5), free-peek-cooldown-on-buy (Task 4), client modal with locked items (Tasks 5/6), test matrix (Tasks 1/2/4). All spec sections map to a task.
- **Type consistency:** `_pet_scout_tier_cap` / `scoutTierCap`, `_biome_bazaar_node`, `_apply_purchase(..., tier_cap, ok_extra)`, `_pet_scout_peek` / `_pet_scout_buy`, action ids `pet-scout-peek` / `pet-scout-buy`, and `petAbility.kind` values `scout-peek` / `scout-buy` are used consistently across server, tests, and client.
- **Known verify-on-implement points (flagged in-step, not placeholders):** the exact field name on `tierRarity(...)` (`.label` vs `.name`), the board tab's existing affordability helper name, and whether any pre-existing test asserted the old `use-pet-ability` scout reveal. Each step says what to check and what to do.
