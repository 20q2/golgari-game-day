# Auto-equip Gear Into Empty Slots — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** When a player acquires a gear piece and its slot is empty, auto-equip it instead of stashing it; a filled slot still sends the piece to the stash (no auto-swap).

**Architecture:** One shared `_gain_gear(doc, gid)` helper in the Python Lambda decides equip-vs-stash-vs-grind; every acquisition path (found drops, starter gear, shop buy, Umori barter) routes through it. The client shows "equipped" wording, mostly via existing server-generated text.

**Tech Stack:** Python 3.11 Lambda + pytest (in-memory FakeTable); Angular 20. Frontend verified with `npm run build`.

Spec: [specs/2026-07-24-undercity-auto-equip-gear-design.md](2026-07-24-undercity-auto-equip-gear-design.md)

Gear facts used below: `rusted_fang`/`bloodfang`/`wurm_tooth` are **fang** slot; `quartz_charm` is **charm** slot. Equipped gear = `doc['gear']` (`slot -> gid`); stash = `doc['gearStash']` (list, cap `GEAR_STASH_SIZE`).

---

### Task 1: `_gain_gear` helper + route found drops

**Files:**
- Modify: `infrastructure/lambda/undercity_db.py` (`_roll_gear_drop` ~803, `_drop_phrase` ~780, `_gear_drop_view` ~3522; add `_gain_gear`)
- Modify: `infrastructure/lambda/tests/test_undercity_db.py`

- [ ] **Step 1: Write the failing unit test for `_gain_gear`**

Add to `test_undercity_db.py` (near the other gear tests, e.g. after `test_buy_gear_and_consumables`):

```python
def test_gain_gear_equips_empty_stashes_filled_grinds_when_full():
    doc = {'gear': {}, 'gearStash': [], 'materials': {'moltings': 0, 'ichor': 0}}
    # Empty slot → auto-equip, nothing stashed.
    r = db._gain_gear(doc, 'rusted_fang')
    assert r['outcome'] == 'equipped' and doc['gear']['fang'] == 'rusted_fang'
    assert doc['gearStash'] == []
    # Filled slot, room in stash → stash; never displaces the worn piece.
    r = db._gain_gear(doc, 'bloodfang')
    assert r['outcome'] == 'stashed' and 'bloodfang' in doc['gearStash']
    assert doc['gear']['fang'] == 'rusted_fang'
    # Filled slot, full stash → ground into materials (piece never lost).
    doc['gearStash'] = ['bloodfang'] * data.GEAR_STASH_SIZE
    r = db._gain_gear(doc, 'gutcleaver')
    assert r['outcome'] == 'stash-full' and 'materials' in r
    assert 'gutcleaver' not in doc['gearStash']
```

- [ ] **Step 2: Run it to verify it fails**

Run: `cd infrastructure/lambda && python -m pytest tests/test_undercity_db.py -k gain_gear -q`
Expected: FAIL — `AttributeError: module 'undercity_db' has no attribute '_gain_gear'`.

- [ ] **Step 3: Add `_gain_gear` and route `_roll_gear_drop` through it**

In `undercity_db.py`, add the helper directly above `_roll_gear_drop`:

```python
def _gain_gear(doc, gid):
    """Route a newly-acquired gear piece. Auto-equip it when its slot is empty
    (fills the slot; never displaces an equipped piece); otherwise stash it, and
    if the stash is full grind it into materials so the piece is never lost.
    Returns {'id','slot','tier','outcome',...} where outcome is 'equipped',
    'stashed', or 'stash-full' (the latter carries 'materials')."""
    g = data.GEAR[gid]
    slot, tier = g['slot'], g['tier']
    gear = doc.setdefault('gear', {})
    if not gear.get(slot):
        gear[slot] = gid
        return {'id': gid, 'slot': slot, 'tier': tier, 'outcome': 'equipped'}
    stash = doc.setdefault('gearStash', [])
    if len(stash) < data.GEAR_STASH_SIZE:
        stash.append(gid)
        return {'id': gid, 'slot': slot, 'tier': tier, 'outcome': 'stashed'}
    gained = _grind_materials(doc, gid)
    return {'id': gid, 'slot': slot, 'tier': tier,
            'outcome': 'stash-full', 'materials': gained}
```

Then replace the body of `_roll_gear_drop` (currently rolls, then stashes/grinds
inline) with a roll that delegates disposal. Replace:

```python
    gid = _rng.choice(pool)
    stash = doc.setdefault('gearStash', [])
    if len(stash) < data.GEAR_STASH_SIZE:
        stash.append(gid)
        return {'id': gid, 'slot': slot, 'tier': tier, 'outcome': 'stashed'}
    gained = _grind_materials(doc, gid)
    return {'id': gid, 'slot': slot, 'tier': tier,
            'outcome': 'stash-full', 'materials': gained}
```

with:

```python
    return _gain_gear(doc, _rng.choice(pool))
```

Also update the `_roll_gear_drop` docstring's "no auto-equip" line to: "found gear
auto-equips into an empty slot, else stashes (or grinds if the stash is full)."

- [ ] **Step 4: Add the `equipped` outcome to the display helpers**

Replace `_drop_phrase`:

```python
def _drop_phrase(drop):
    """Past-tense phrase for how a fresh gear drop was disposed of."""
    return 'stashed' if drop['outcome'] == 'stashed' else 'ground into materials'
```

with:

```python
def _drop_phrase(drop):
    """Past-tense phrase for how a fresh gear drop was disposed of."""
    if drop['outcome'] == 'equipped':
        return 'equipped'
    return 'stashed' if drop['outcome'] == 'stashed' else 'ground into materials'
```

In `_gear_drop_view`, add an `equipped` flag. Replace:

```python
    return {'id': drop['id'], 'name': g.get('name', drop['id']),
            'tier': drop['tier'], 'ground': drop['outcome'] == 'stash-full'}
```

with:

```python
    return {'id': drop['id'], 'name': g.get('name', drop['id']),
            'tier': drop['tier'], 'ground': drop['outcome'] == 'stash-full',
            'equipped': drop['outcome'] == 'equipped'}
```

- [ ] **Step 5: Run the gear/loot suite + full suite**

Run: `cd infrastructure/lambda && python -m pytest tests -q`
Expected: all green. (Existing found-drop tests — `test_award_gear_rolls_a_drop`, the loot-solve tests — assert `ev['gear']['slot']`, which `_gain_gear` still returns, so they pass unchanged.)

- [ ] **Step 6: Commit**

```bash
git add infrastructure/lambda/undercity_db.py infrastructure/lambda/tests/test_undercity_db.py
git commit -m "feat(undercity): _gain_gear helper — found gear auto-equips into empty slots"
```

---

### Task 2: Route starter gear through `_gain_gear`

**Files:**
- Modify: `infrastructure/lambda/undercity_db.py` (City Rat ~1957, renown kit ~2048)
- Modify: `infrastructure/lambda/tests/test_undercity_db.py` (`test_city_rat_home_grants_random_t1_gear` ~140, `test_join_grants_one_night_starter_items` ~2845)

- [ ] **Step 1: Update the two starter-gear tests to expect auto-equip**

Replace `test_city_rat_home_grants_random_t1_gear` (~140-150) with:

```python
def test_city_rat_home_grants_random_t1_gear(table):
    # The Undercity (city) home: City Rat hatches with a random T1 piece, which
    # now auto-equips into its (empty) slot, and grants no starting Spores.
    status, resp = act(table, 'join', starter='pest', home='city')
    assert status == 200
    you = resp['you']
    assert you['spores'] == 0
    assert not you.get('gearStash')                    # auto-equipped, nothing stashed
    gear = you.get('gear') or {}
    assert len(gear) == 1
    gid = next(iter(gear.values()))
    assert data.GEAR[gid]['tier'] == 1
```

In `test_join_grants_one_night_starter_items` (~2845), replace the three
assertions at the "# Starter gear …" comment (lines ~2852-2854):

```python
    # Starter gear (and the City Rat piece) now auto-equip into empty slots.
    # rusted_fang is a fang; it equips unless the City Rat's random T1 piece
    # already claimed the fang slot, in which case it stashes — so assert it is
    # owned and the fang slot ends filled either way.
    owned = set((you.get('gear') or {}).values()) | set(you.get('gearStash') or [])
    assert 'rusted_fang' in owned
    assert (you.get('gear') or {}).get('fang')
```

(Leave the `you['spores'] == 15` and renown assertions below unchanged.)

- [ ] **Step 2: Run to verify the tests fail**

Run: `cd infrastructure/lambda && python -m pytest tests/test_undercity_db.py -k "city_rat_home or one_night_starter" -q`
Expected: FAIL — City Rat gear still lands in the stash, so `not you.get('gearStash')` and `gear` assertions fail.

- [ ] **Step 3: Route City Rat starter gear**

In `undercity_db.py` (~1950-1957), replace:

```python
        # City Rat: hatch with a random Tier-1 piece of gear in the stash — no
        # auto-equip; the player equips it at the Plaza. Seeded on the player id
        # so the pick is stable (varies per player, but deterministic — no test
        # flakiness, no re-roll on recompute).
        t1 = sorted(gid for gid, g in data.GEAR.items() if g.get('tier') == 1)
        if t1:
            gid = random.Random(zlib.crc32(f'cityrat:{user_id}'.encode())).choice(t1)
            doc.setdefault('gearStash', []).append(gid)
```

with:

```python
        # City Rat: hatch with a random Tier-1 piece of gear, auto-equipped into
        # its empty slot. Seeded on the player id so the pick is stable (varies
        # per player, but deterministic — no test flakiness, no re-roll on
        # recompute).
        t1 = sorted(gid for gid, g in data.GEAR.items() if g.get('tier') == 1)
        if t1:
            gid = random.Random(zlib.crc32(f'cityrat:{user_id}'.encode())).choice(t1)
            _gain_gear(doc, gid)
```

- [ ] **Step 4: Route the renown starter-kit gear**

In `undercity_db.py` (~2046-2048), replace:

```python
        elif it['kind'] == 'gear':
            # No auto-equip: starter gear goes to the stash to equip at the Plaza.
            doc.setdefault('gearStash', []).append(it['id'])
```

with:

```python
        elif it['kind'] == 'gear':
            # Starter gear auto-equips into an empty slot, else stashes.
            _gain_gear(doc, it['id'])
```

- [ ] **Step 5: Run the full suite**

Run: `cd infrastructure/lambda && python -m pytest tests -q`
Expected: all green.

- [ ] **Step 6: Commit**

```bash
git add infrastructure/lambda/undercity_db.py infrastructure/lambda/tests/test_undercity_db.py
git commit -m "feat(undercity): starter gear (City Rat + renown kit) auto-equips into empty slots"
```

---

### Task 3: Route purchases (shop buy + Umori barter)

**Files:**
- Modify: `infrastructure/lambda/undercity_db.py` (shop buy ~4545-4564, `_trade` ~4712-4757)
- Modify: `infrastructure/lambda/tests/test_undercity_db.py` (buy/barter tests ~831, ~986, ~1069, ~1908, ~1918)

- [ ] **Step 1: Update the affected purchase/barter tests + add new coverage**

In `test_buy_gear_and_consumables` (~831), replace the two `rusted_fang`/`wurm_tooth`
assertion groups (lines ~838-844) with:

```python
    # First fang → empty slot → auto-equipped (not stashed).
    status, resp = act(table, 'buy', itemId='rusted_fang')
    assert status == 200
    assert (resp['you'].get('gear') or {}).get('fang') == 'rusted_fang'
    assert 'rusted_fang' not in (resp['you'].get('gearStash') or [])
    assert resp['you']['spores'] == 180
    # Second fang → slot now filled → stashed.
    status, resp = act(table, 'buy', itemId='wurm_tooth')
    assert resp['you']['spores'] == 180 - 80
    assert 'wurm_tooth' in resp['you']['gearStash']
```

In `test_umori_swap_gear` (~986), replace the two assertions at lines ~996-997:

```python
    assert resp['you']['gear']['fang'] == take          # gave the worn fang → slot empty → auto-equipped
    assert take not in (resp['you'].get('gearStash') or [])
```

In `test_umori_gives_from_stash` (~1069), replace the assertion at line ~1081:

```python
    assert resp['you']['gear']['fang'] == take          # fang slot was empty → auto-equipped
```

Replace `test_buy_charm_stashes_not_equips` (~1908-1915) with:

```python
def test_buy_charm_auto_equips_empty_slot(table):
    sid, node = _at_shop(table, spores=500)
    _seed_shop(table, sid, node, gear=[{'item': 'quartz_charm', 'qty': 2}])
    status, resp = act(table, 'buy', itemId='quartz_charm')
    assert status == 200, resp
    doc = db._get_player(table, sid, 'user-alex')
    assert (doc.get('gear') or {}).get('charm') == 'quartz_charm'
    assert 'quartz_charm' not in (doc.get('gearStash') or [])
```

Replace `test_buy_gear_stalls_when_stash_full` (~1918-1928) with a version that
fills the slot (so the buy must stash), plus a new test proving an empty slot
bypasses a full stash:

```python
def test_buy_gear_stalls_when_stash_full(table):
    sid, node = _at_shop(table, spores=500)
    _seed_shop(table, sid, node, gear=[{'item': 'rusted_fang', 'qty': 2}])
    doc = db._get_player(table, sid, 'user-alex')
    doc['gear'] = {'fang': 'bloodfang'}                 # fang slot filled → buy must stash
    doc['gearStash'] = ['rusted_fang'] * data.GEAR_STASH_SIZE
    db._put_player(table, doc)
    before = db._get_player(table, sid, 'user-alex')['spores']
    status, resp = act(table, 'buy', itemId='rusted_fang')
    assert status == 409 and 'stash is full' in resp['error'].lower()
    assert db._get_player(table, sid, 'user-alex')['spores'] == before


def test_buy_gear_auto_equips_empty_slot_even_with_full_stash(table):
    sid, node = _at_shop(table, spores=500)
    _seed_shop(table, sid, node, gear=[{'item': 'quartz_charm', 'qty': 2}])
    doc = db._get_player(table, sid, 'user-alex')
    doc['gear'] = {}                                    # charm slot empty…
    doc['gearStash'] = ['rusted_fang'] * data.GEAR_STASH_SIZE  # …but stash full
    db._put_player(table, doc)
    status, resp = act(table, 'buy', itemId='quartz_charm')
    assert status == 200
    assert (resp['you'].get('gear') or {}).get('charm') == 'quartz_charm'
```

- [ ] **Step 2: Run to verify failures**

Run: `cd infrastructure/lambda && python -m pytest tests/test_undercity_db.py -k "buy_gear or buy_charm or umori_swap_gear or gives_from_stash" -q`
Expected: FAIL — purchases/barter still stash into empty slots.

- [ ] **Step 3: Route the shop gear buy through `_gain_gear`**

In `undercity_db.py`, replace the gear branch of the buy handler
(currently ~4555-4564):

```python
        # No auto-equip: purchased gear lands in the stash; equip it at the Plaza.
        # If the stash is full we stall the sale rather than grinding the piece —
        # the player clears room by salvaging at the Plaza first.
        stash = doc.setdefault('gearStash', [])
        if len(stash) >= data.GEAR_STASH_SIZE:
            return _err('Your gear stash is full — salvage a piece at the Plaza first.', 409)
        doc['spores'] = doc.get('spores', 0) - cost
        stash.append(item_id)
        deplete = line
        text = f"Bought {g['name']} — stashed. Equip it at the Plaza."
```

with:

```python
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
```

- [ ] **Step 4: Route the Umori barter take-side through `_gain_gear`**

In `_trade`, replace the take-side stash guard (currently ~4712-4715):

```python
    if take_kind == 'gear':
        effective_stash = len(stash) - (1 if give_from_stash else 0)
        if effective_stash >= data.GEAR_STASH_SIZE:
            return _err('Your gear stash is full — salvage a piece at the Plaza first.', 409)
```

with (only guard when the taken piece will NOT auto-equip):

```python
    if take_kind == 'gear':
        take_slot = data.GEAR[taken['item']]['slot']
        # After the give, the taken piece auto-equips iff its slot is empty:
        # true when we gave the worn piece of that slot, or the slot was empty.
        taken_will_equip = (not give_from_stash) or not gear.get(take_slot)
        if not taken_will_equip:
            effective_stash = len(stash) - (1 if give_from_stash else 0)
            if effective_stash >= data.GEAR_STASH_SIZE:
                return _err('Your gear stash is full — salvage a piece at the Plaza first.', 409)
```

Then replace the take-side apply for gear (currently ~4733-4734):

```python
    if take_kind == 'gear':
        doc.setdefault('gearStash', []).append(taken['item'])
```

with (the give-side removal above has already updated `doc['gear']`/`doc['gearStash']`,
so `_gain_gear` sees the post-give state):

```python
    if take_kind == 'gear':
        got = _gain_gear(doc, taken['item'])
```

Finally, make the success text reflect an auto-equip. Replace the return
(currently ~4757-4758):

```python
    return _ok(doc, text=f"You hand over your {give_name} and take {take_name}.",
               node=node, stock=stock)
```

with:

```python
    if take_kind == 'gear' and got['outcome'] == 'equipped':
        take_text = f"You hand over your {give_name} and equip {take_name}."
    else:
        take_text = f"You hand over your {give_name} and take {take_name}."
    return _ok(doc, text=take_text, node=node, stock=stock)
```

- [ ] **Step 5: Run the full suite**

Run: `cd infrastructure/lambda && python -m pytest tests -q`
Expected: all green.

- [ ] **Step 6: Commit**

```bash
git add infrastructure/lambda/undercity_db.py infrastructure/lambda/tests/test_undercity_db.py
git commit -m "feat(undercity): shop buy + Umori barter auto-equip gear into empty slots"
```

---

### Task 4: Client "equipped" wording

Most drop surfaces show server-generated text (`_drop_phrase`, now "equipped"), so
they need no client change. The one place the client renders a gear-drop object's
disposition field-by-field is the world-kill away-event summary.

**Files:**
- Modify: `src/app/undercity/services/undercity-models.ts` (two gear-drop object types)
- Modify: `src/app/undercity/tabs/board-tab.component.html` (~941)

- [ ] **Step 1: Add `equipped?` to the gear-drop view-model types**

In `undercity-models.ts`, the `world_kill` AwayEvent member (~81) has:

```ts
      gear?: { id: string; name: string; tier: number; ground?: boolean } | null;
```

Change it to:

```ts
      gear?: { id: string; name: string; tier: number; ground?: boolean; equipped?: boolean } | null;
```

And `SpaceEvent.reward.gear` (~621) has:

```ts
    gear?: { id: string; name: string; tier: number; ground?: boolean } | null;
```

Change it to:

```ts
    gear?: { id: string; name: string; tier: number; ground?: boolean; equipped?: boolean } | null;
```

- [ ] **Step 2: Show "equipped" in the world-kill summary**

In `board-tab.component.html` (~941), replace:

```html
                        · {{ e.gear.name }} (T{{ e.gear.tier }}){{ e.gear.ground ? ' — salvaged' : '' }}
```

with:

```html
                        · {{ e.gear.name }} (T{{ e.gear.tier }}){{ e.gear.equipped ? ' — equipped' : e.gear.ground ? ' — salvaged' : '' }}
```

- [ ] **Step 3: Build**

Run: `npm run build`
Expected: build succeeds, no TypeScript/template errors.

- [ ] **Step 4: Commit**

```bash
git add src/app/undercity/services/undercity-models.ts src/app/undercity/tabs/board-tab.component.html
git commit -m "feat(undercity): show 'equipped' for auto-equipped gear drops in the world-kill summary"
```

---

### Task 5: Verify in the real app

**Files:** none (verification only)

- [ ] **Step 1: Drive it**

Invoke the `run-undercity` skill. With a creature that has an empty gear slot,
acquire a piece for that slot (buy at a shop, or find one) and confirm it reads as
**equipped** immediately (the drop/buy text says "equipped", and the Plaza shows it
worn). Then acquire a second piece for the same slot and confirm it goes to the
**stash** (no auto-swap).

Note: this is a server-side rule — verifying live requires the updated Lambda. If
it is not deployed yet, rely on the pytest suite + `npm run build` and flag that a
backend deploy is pending.

---

## Notes / deferred (from spec)

- No change to manual equip/swap, salvage, or upgrade; no auto-swap of filled slots.
- No balance-number changes.
- **Deploy (user runs):** server-side rule → needs a **Lambda deploy** (`cdk deploy`
  from `infrastructure/`); the client wording ships with the frontend deploy.
