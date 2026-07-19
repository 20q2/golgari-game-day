# Undercity Gear Drops — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Let existing loot sources (battle wins, mystery events, loot tiles, dungeon treasure, lair/boss) occasionally drop a piece of gear that auto-equips when it's a strict upgrade and otherwise salvages into spores.

**Architecture:** One shared server helper `_roll_gear_drop(doc, tier_weights)` in `undercity_db.py` does the equip-or-salvage logic (reusing the swap-and-sell-back economics `_buy` already uses). A `GEAR_DROP` config table in `undercity_data.py` holds each source's chance + tier profile. Each source's finisher rolls its chance and, on a hit, calls the helper and surfaces the result on `out['gear']`. The Angular client renders a chip in the space-result modal and the battle victory popup.

**Tech Stack:** Python 3.11 Lambda (pure functions + DynamoDB I/O, pytest); Angular 20 standalone components (SCSS, no test runner — verify with `npm run build`).

> **Design:** [2026-07-18-undercity-gear-drops-design.md](2026-07-18-undercity-gear-drops-design.md)
> **Note on locations:** plans/specs live in git-tracked `specs/` (the repo's `docs/` is build output, wiped every build). Backend tests: `cd infrastructure/lambda && python -m pytest tests -q`. Commits are grouped per task below, but this repo's owner runs his own commits/deploys — treat commit steps as optional checkpoints unless he asks you to commit.

---

## File map

- `infrastructure/lambda/undercity_data.py` — add `GEAR_SLOTS` tuple + `GEAR_DROP` config table.
- `infrastructure/lambda/undercity_db.py` — add `_roll_gear_drop` helper; wire it into `_finish_wild`, `_loot` (in `_resolve_space`), `_mystery`, `_cache`, `_vault`, `_finish_lair`, `_finish_boss`.
- `infrastructure/lambda/tests/test_undercity_gear_drops.py` — new test module for the helper + each source.
- `src/app/undercity/services/undercity-models.ts` — add `gear` to `SpaceEvent`.
- `src/app/undercity/tabs/board-tab.component.html` — space-result modal gear chip.
- `src/app/undercity/tabs/board-tab.component.ts` — include gear in `hasSpoils`; map gear in `buildRewards`.
- `src/app/undercity/tabs/battle-playback.component.ts` — extend `BattleRewards`.
- `src/app/undercity/tabs/interactive-battle.component.html` + `battle-playback.component.html` — render gear in the victory popup.

---

## Task 1: `GEAR_DROP` config + `_roll_gear_drop` helper

**Files:**
- Modify: `infrastructure/lambda/undercity_data.py` (add after the `GEAR` dict / `GEAR_SELL_BACK`, ~line 200)
- Modify: `infrastructure/lambda/undercity_db.py` (add helper next to `_give_consumable`, ~line 460)
- Test: `infrastructure/lambda/tests/test_undercity_gear_drops.py` (new)

- [ ] **Step 1: Add the config to `undercity_data.py`**

Add near the `GEAR` block (after `GEAR_SELL_BACK = 0.5` at line 200):

```python
GEAR_SLOTS = ('fang', 'carapace', 'charm')

# Gear drops from loot sources. Each entry: (chance, {tier: weight}).
# Common sources sit at ~0.10; one-time/hard POIs are elevated so a "treasure"
# actually feels like one. Chances/weights are the tuning surface.
GEAR_DROP = {
    'wild':     (0.10, {1: 1.0}),
    'elite':    (0.12, {1: 0.6, 2: 0.4}),
    'loot':     (0.10, {1: 1.0}),
    'mystery':  (0.12, {1: 0.6, 2: 0.4}),
    'treasure': (0.50, {2: 0.6, 3: 0.4}),
    'lair':     (0.35, {2: 0.5, 3: 0.5}),
    'boss':     (0.35, {2: 0.4, 3: 0.6}),
}
```

- [ ] **Step 2: Write the failing tests**

Create `infrastructure/lambda/tests/test_undercity_gear_drops.py`:

```python
import undercity_data as data
import undercity_db as db


def _doc(gear=None, spores=0):
    return {'userId': 'u1', 'username': 'U', 'gear': dict(gear or {}), 'spores': spores}


def test_drop_equips_into_empty_slot(monkeypatch):
    monkeypatch.setattr(db._rng, 'choice', lambda seq: seq[0])
    monkeypatch.setattr(db._rng, 'choices', lambda seq, weights=None, k=1: [seq[0]])
    doc = _doc(spores=0)
    res = db._roll_gear_drop(doc, {1: 1.0})
    assert res['outcome'] == 'equipped'
    assert res['displaced'] is None
    assert res['soldSpores'] == 0
    assert doc['gear'][res['slot']] == res['id']


def test_drop_equips_when_strictly_better_and_sells_old(monkeypatch):
    # Force fang slot + tier 3 (wurm_tooth), replacing an equipped tier-1 rusted_fang.
    monkeypatch.setattr(db._rng, 'choice',
                        lambda seq: 'fang' if 'fang' in seq else seq[0])
    monkeypatch.setattr(db._rng, 'choices', lambda seq, weights=None, k=1: [3])
    doc = _doc(gear={'fang': 'rusted_fang'}, spores=0)
    res = db._roll_gear_drop(doc, {3: 1.0})
    assert res['outcome'] == 'equipped'
    assert res['displaced'] == 'rusted_fang'
    # rusted_fang cost 20 * 0.5 sell-back = 10
    assert res['soldSpores'] == 10
    assert doc['spores'] == 10
    assert doc['gear']['fang'] == res['id']


def test_drop_salvages_when_equal_or_worse(monkeypatch):
    # Have a tier-3 fang, drop a tier-1 fang -> salvage, no equip change.
    monkeypatch.setattr(db._rng, 'choice',
                        lambda seq: 'fang' if 'fang' in seq else seq[0])
    monkeypatch.setattr(db._rng, 'choices', lambda seq, weights=None, k=1: [1])
    doc = _doc(gear={'fang': 'wurm_tooth'}, spores=0)
    before = doc['gear']['fang']
    res = db._roll_gear_drop(doc, {1: 1.0})
    assert res['outcome'] == 'salvaged'
    assert res['displaced'] is None
    assert doc['gear']['fang'] == before          # unchanged
    # dropped rusted_fang cost 20 * 0.5 = 10 salvage spores
    assert res['soldSpores'] == 10
    assert doc['spores'] == 10
```

- [ ] **Step 3: Run the tests to verify they fail**

Run: `cd infrastructure/lambda && python -m pytest tests/test_undercity_gear_drops.py -q`
Expected: FAIL — `AttributeError: module 'undercity_db' has no attribute '_roll_gear_drop'`.

- [ ] **Step 4: Implement `_roll_gear_drop`**

In `undercity_db.py`, add directly after `_give_consumable` (ends ~line 459):

```python
def _roll_gear_drop(doc, tier_weights):
    """Drop a gear piece per the tier profile. A strict upgrade auto-equips
    (displaced piece sells for GEAR_SELL_BACK of its cost); equal/worse tier
    salvages into spores and leaves the equipped slot alone.
    Returns {'id','slot','outcome','soldSpores','displaced'} or None."""
    slot = _rng.choice(data.GEAR_SLOTS)
    tiers = list(tier_weights)
    tier = _rng.choices(tiers, weights=[tier_weights[t] for t in tiers])[0]
    pool = [gid for gid, g in data.GEAR.items()
            if g['slot'] == slot and g['tier'] == tier]
    if not pool:
        return None
    gid = _rng.choice(pool)
    g = data.GEAR[gid]
    cur = (doc.get('gear') or {}).get(slot)
    cur_tier = data.GEAR[cur]['tier'] if cur else 0
    if g['tier'] > cur_tier:
        sold = int(data.GEAR[cur]['cost'] * data.GEAR_SELL_BACK) if cur else 0
        if sold:
            doc['spores'] = doc.get('spores', 0) + sold
        doc.setdefault('gear', {})[slot] = gid
        return {'id': gid, 'slot': slot, 'outcome': 'equipped',
                'soldSpores': sold, 'displaced': cur}
    salvage = int(g['cost'] * data.GEAR_SELL_BACK)
    doc['spores'] = doc.get('spores', 0) + salvage
    return {'id': gid, 'slot': slot, 'outcome': 'salvaged',
            'soldSpores': salvage, 'displaced': None}
```

- [ ] **Step 5: Run the tests to verify they pass**

Run: `cd infrastructure/lambda && python -m pytest tests/test_undercity_gear_drops.py -q`
Expected: PASS (3 passed).

- [ ] **Step 6: Commit (optional checkpoint)**

```bash
git add infrastructure/lambda/undercity_data.py infrastructure/lambda/undercity_db.py infrastructure/lambda/tests/test_undercity_gear_drops.py
git commit -m "feat(undercity): gear-drop config + _roll_gear_drop helper"
```

---

## Task 2: Wire wild & elite battle drops

**Files:**
- Modify: `infrastructure/lambda/undercity_db.py` — `_finish_wild` (~line 1819)
- Test: `infrastructure/lambda/tests/test_undercity_gear_drops.py`

- [ ] **Step 1: Write the failing flow test**

Append to `test_undercity_gear_drops.py`. Reuse the existing DB test harness (verified symbols in `tests/test_undercity_db.py`): the `table` fixture (line 88), `act` (81), `_sid` (808), `_player_at(table, node, spores=…)` → `(sid, doc)`, and `_finish_started_battle` (140). Add these imports at the top of the file:

```python
from tests.test_undercity_db import (  # noqa: F401
    table, act, _sid, _player_at, _finish_started_battle)


# Force the gear roll to fire and deterministically pick a tier-1 fang.
def _force_fang_drop(monkeypatch):
    monkeypatch.setattr(db._rng, 'random', lambda: 0.0)          # < any chance
    monkeypatch.setattr(db._rng, 'choice',
                        lambda seq: 'fang' if 'fang' in seq else seq[0])
    monkeypatch.setattr(db._rng, 'choices', lambda seq, weights=None, k=1: [seq[0]])


def test_wild_win_can_drop_gear(table, monkeypatch):
    act(table, 'join', starter='pest')
    sid = _sid(table)
    doc = db._get_player(table, sid, 'user-alex')
    db._wild_battle(table, sid, doc)          # sets doc['battle'] BEFORE we patch _rng
    _force_fang_drop(monkeypatch)
    se = _finish_started_battle(table, monkeypatch, doc, 'attacker')
    assert se['type'] == 'wild'
    assert se['gear']['outcome'] in ('equipped', 'salvaged')
    assert se['gear']['slot'] == 'fang'
```

> Patch `_rng` **after** `_wild_battle` so the NPC pick isn't skewed by the stub. `_finish_started_battle` stubs `resolve_round` separately (via `_kill_npc`), so combat randomness is already neutralised.

- [ ] **Step 2: Run it to verify it fails**

Run: `cd infrastructure/lambda && python -m pytest tests/test_undercity_gear_drops.py::test_wild_win_can_drop_gear -q`
Expected: FAIL — `KeyError: 'gear'` (no gear on the result yet).

- [ ] **Step 3: Wire the drop into `_finish_wild`**

In `_finish_wild`, inside the `if result['outcome'] == 'attacker':` block, replace the existing item roll:

```python
        if npc['itemChance'] and _rng.random() < npc['itemChance']:
            item = _give_consumable(doc)
            if item:
                out['item'] = item
```

with a gear-first version:

```python
        source = 'elite' if elite else 'wild'
        chance, tiers = data.GEAR_DROP[source]
        if _rng.random() < chance:
            drop = _roll_gear_drop(doc, tiers)
            if drop:
                out['gear'] = drop
        elif npc['itemChance'] and _rng.random() < npc['itemChance']:
            item = _give_consumable(doc)
            if item:
                out['item'] = item
```

- [ ] **Step 4: Run it to verify it passes**

Run: `cd infrastructure/lambda && python -m pytest tests/test_undercity_gear_drops.py::test_wild_win_can_drop_gear -q`
Expected: PASS.

- [ ] **Step 5: Commit (optional checkpoint)**

```bash
git add infrastructure/lambda/undercity_db.py infrastructure/lambda/tests/test_undercity_gear_drops.py
git commit -m "feat(undercity): gear drops from wild & elite wins"
```

---

## Task 3: Wire loot tiles + mystery events

**Files:**
- Modify: `infrastructure/lambda/undercity_db.py` — `_loot` branch of `_resolve_space` (~line 1316) and `_mystery` (~line 1490)
- Test: `infrastructure/lambda/tests/test_undercity_gear_drops.py`

- [ ] **Step 1: Write the failing tests**

Append to `test_undercity_gear_drops.py`. The loot logic lives inline in `_resolve_space` under `if ntype == 'loot':`, so drive the test through `_resolve_space` at a real loot node (no need to extract a helper):

```python
def test_loot_tile_can_drop_gear(table, monkeypatch):
    node = next(n for n, nd in data.MAP_NODES.items() if nd['type'] == 'loot')
    sid, doc = _player_at(table, node, spores=0)
    _force_fang_drop(monkeypatch)
    out = db._resolve_space(table, sid, doc, node, None)
    assert out['type'] == 'loot'
    assert out['gear']['slot'] == 'fang'


def test_mystery_free_item_can_be_gear(table, monkeypatch):
    node = next(n for n, nd in data.MAP_NODES.items() if nd['type'] == 'mystery')
    sid, doc = _player_at(table, node, spores=0)
    # Force roll_mystery to return an item, then force the gear branch.
    monkeypatch.setattr(db.engine, 'roll_mystery',
                        lambda *a, **k: {'roll': 7, 'text': 'x', 'spores': 0,
                                         'xp': 0, 'hpPct': 0, 'heal': False,
                                         'buff': None, 'curse': False,
                                         'teleport': False, 'item': True,
                                         'paint': False, 'hat': False})
    _force_fang_drop(monkeypatch)
    out = db._mystery(table, sid, doc)
    assert out['gear']['slot'] == 'fang'
```

> Confirm the `roll_mystery` stub dict carries every key `_mystery` reads (`spores/xp/hpPct/heal/buff/curse/teleport/item/paint/hat/roll/text`). If `_mystery` reads a key not listed here, add it to the stub — a `KeyError` there is a test bug, not a product bug.

- [ ] **Step 2: Run to verify they fail**

Run: `cd infrastructure/lambda && python -m pytest tests/test_undercity_gear_drops.py -k "loot_tile or mystery_free" -q`
Expected: FAIL (`KeyError`/`AttributeError`).

- [ ] **Step 3a: Loot tile — add the gear roll**

In `_resolve_space`, replace the `if ntype == 'loot':` block (lines 1316–1328):

```python
    if ntype == 'loot':
        if _rng.random() < 0.10:
            item = _give_consumable(doc)
            if item:
                return {'type': 'loot', 'text': f'You unearth a {data.CONSUMABLES[item]["name"]}!',
                        'item': item}
        amount = _rng.choice([8, 8, 9, 9, 10, 10, 11, 12, 13, 15])
        ...
```

with a gear-first variant (keep the spore/consumable tail intact):

```python
    if ntype == 'loot':
        chance, tiers = data.GEAR_DROP['loot']
        if _rng.random() < chance:
            drop = _roll_gear_drop(doc, tiers)
            if drop:
                verb = 'equip' if drop['outcome'] == 'equipped' else 'salvage'
                return {'type': 'loot',
                        'text': f'You unearth a piece of gear and {verb} it!',
                        'gear': drop}
        if _rng.random() < 0.10:
            item = _give_consumable(doc)
            if item:
                return {'type': 'loot', 'text': f'You unearth a {data.CONSUMABLES[item]["name"]}!',
                        'item': item}
        amount = _rng.choice([8, 8, 9, 9, 10, 10, 11, 12, 13, 15])
        if 'scrounger' in _passives(doc):
            amount += 2
        if doc.get('homeBiome') == 'garden':
            amount += 2  # Composter hatch perk
        doc['spores'] = doc.get('spores', 0) + amount
        return {'type': 'loot', 'text': f'You forage {amount} Spores from the rot.', 'spores': amount}
```

- [ ] **Step 3b: Mystery — add the gear branch**

In `_mystery`, the `res['item']` block (lines 1490–1501) currently upgrades to a grimoire or gives a consumable. Insert a gear roll at the front of that block:

```python
    if res['item']:
        chance, tiers = data.GEAR_DROP['mystery']
        drop = _roll_gear_drop(doc, tiers) if _rng.random() < chance else None
        if drop:
            out['gear'] = drop
            verb = 'equip it' if drop['outcome'] == 'equipped' else 'salvage it'
            out['text'] += f" It's a piece of gear — you {verb}!"
        else:
            unowned = [g for g, spec in data.GRIMOIRES.items()
                       if spec['tier'] == 1 and g not in (doc.get('grimoires') or [])]
            if unowned and _rng.random() < data.MYSTERY_GRIMOIRE_CHANCE:
                gid = _rng.choice(unowned)
                _grant_grimoire(doc, gid)
                out['grimoire'] = gid
                out['text'] += f" It's a grimoire — the {data.GRIMOIRES[gid]['name']}!"
            else:
                item = _give_consumable(doc)
                if item:
                    out['item'] = item
```

- [ ] **Step 4: Run to verify they pass**

Run: `cd infrastructure/lambda && python -m pytest tests/test_undercity_gear_drops.py -k "loot_tile or mystery_free" -q`
Expected: PASS.

- [ ] **Step 5: Commit (optional checkpoint)**

```bash
git add infrastructure/lambda/undercity_db.py infrastructure/lambda/tests/test_undercity_gear_drops.py
git commit -m "feat(undercity): gear drops from loot tiles & mystery events"
```

---

## Task 4: Wire dungeon treasure + lair/boss

**Files:**
- Modify: `infrastructure/lambda/undercity_db.py` — `_cache` (~line 2026), `_vault` (~line 2011), `_finish_lair` (~line 1892), `_finish_boss` (~line 1948)
- Test: `infrastructure/lambda/tests/test_undercity_gear_drops.py`

- [ ] **Step 1: Write the failing tests**

Append to `test_undercity_gear_drops.py`. `test_cache_pays_once_per_player` (line 897) uses the `city_cache` node; drive `_cache` directly. For the lair, replicate `_lair_fight` (line 918) inline so `_rng` is patched only after `_lair` picks the boss:

```python
def test_cache_first_visit_can_drop_gear(table, monkeypatch):
    sid, doc = _player_at(table, 'city_cache', spores=0)
    _force_fang_drop(monkeypatch)
    out = db._cache(table, sid, doc, 'city_cache')
    assert out['type'] == 'cache'
    assert out['gear']['slot'] == 'fang'


def test_lair_win_can_drop_gear(table, monkeypatch):
    act(table, 'join', starter='pest')
    sid = _sid(table)
    doc = db._get_player(table, sid, 'user-alex')
    doc['position'] = 'city_lair'
    db._lair(table, sid, doc, 'city_lair')     # battle_start — picks the boss
    _force_fang_drop(monkeypatch)              # patch _rng only now
    se = _finish_started_battle(table, monkeypatch, doc, 'attacker')
    assert se['type'] == 'lair'
    assert se['gear']['slot'] == 'fang'
```

> `city_lair` / `city_cache` are the node ids the existing lair/cache tests use. If the map changes, pick any node whose `MAP_NODES[...]['type']` is `'lair'` / `'cache'`. A boss-drop test is optional — the boss finisher mirrors the lair one exactly; if you add it, drive the boss via `db._boss(...)` the way the lair test drives `db._lair(...)`.

- [ ] **Step 2: Run to verify they fail**

Run: `cd infrastructure/lambda && python -m pytest tests/test_undercity_gear_drops.py -k "cache_first or lair_win" -q`
Expected: FAIL (`KeyError: 'gear'`).

- [ ] **Step 3a: `_cache` — add a gear roll before the return**

In `_cache`, after `_grant_xp(...)` and before building `out`, add:

```python
    out = {'type': 'cache', 'spores': r['spores'],
           'text': f"A hidden trove! +{r['spores']} Spores."}
    chance, tiers = data.GEAR_DROP['treasure']
    if _rng.random() < chance:
        drop = _roll_gear_drop(doc, tiers)
        if drop:
            out['gear'] = drop
            out['text'] += (' A piece of gear gleams among the hoard — '
                            + ('equipped!' if drop['outcome'] == 'equipped' else 'salvaged.'))
    return out
```

(Replace the existing single-line `return {'type': 'cache', ...}`.)

- [ ] **Step 3b: `_vault` — same treatment**

In `_vault`, replace the final `return {'type': 'vault', 'spores': r['spores'], ...}` with the same pattern, using `data.GEAR_DROP['treasure']` and a `'type': 'vault'` out dict.

- [ ] **Step 3c: `_finish_lair` — gear on a win**

In `_finish_lair`, inside `if result['outcome'] == 'attacker':`, after the `out['xp']`/`out['spores']` are set and before the sigil/text branch, add:

```python
        chance, tiers = data.GEAR_DROP['lair']
        if _rng.random() < chance:
            drop = _roll_gear_drop(doc, tiers)
            if drop:
                out['gear'] = drop
```

- [ ] **Step 3d: `_finish_boss` — gear on a win**

In `_finish_boss`, inside `if result['outcome'] == 'attacker':`, after `out['spores']`/`out['xp']` are set, add the same block using `data.GEAR_DROP['boss']`.

- [ ] **Step 4: Run to verify they pass, then the whole suite**

Run: `cd infrastructure/lambda && python -m pytest tests/test_undercity_gear_drops.py -q`
Expected: PASS.
Run: `cd infrastructure/lambda && python -m pytest tests -q`
Expected: PASS (whole suite green, including `test_balance_good_play_beats_fodder` and the map-sync check).

- [ ] **Step 5: Commit (optional checkpoint)**

```bash
git add infrastructure/lambda/undercity_db.py infrastructure/lambda/tests/test_undercity_gear_drops.py
git commit -m "feat(undercity): gear drops from treasure, lairs & the boss"
```

---

## Task 5: Client — model + space-result chip

**Files:**
- Modify: `src/app/undercity/services/undercity-models.ts` (`SpaceEvent`, ~line 353)
- Modify: `src/app/undercity/tabs/board-tab.component.html` (space modal chips, ~line 186; add after the `item` chip)
- Modify: `src/app/undercity/tabs/board-tab.component.ts` (`hasSpoils`, ~line 487)

- [ ] **Step 1: Add the `gear` field to `SpaceEvent`**

In `undercity-models.ts`, add to the `SpaceEvent` interface (near the `item?: string;` field):

```typescript
  /** A gear drop from a loot source (mirrors undercity_db._roll_gear_drop). */
  gear?: {
    id: string;
    slot: string;
    outcome: 'equipped' | 'salvaged';
    soldSpores: number;
    displaced?: string | null;
  };
```

- [ ] **Step 2: Render the chip in the space-result modal**

In `board-tab.component.html`, after the `@if (ev.item && itemInfo(ev.item); as info)` block (ends line 188), add:

```html
            @if (ev.gear && gearInfo(ev.gear.id); as g) {
              <span class="chip item">
                <mat-icon class="mi">{{ slotIcon(ev.gear.slot) }}</mat-icon>
                {{ g.name }} —
                {{ ev.gear.outcome === 'equipped' ? 'equipped!' : 'salvaged (+' + ev.gear.soldSpores + ')' }}
              </span>
            }
```

- [ ] **Step 3: Add the `gearInfo` + `slotIcon` helpers and include gear in `hasSpoils`**

In `board-tab.component.ts`, `SLOT_ICONS` already exists (line 298). Add two small helpers near `itemInfo` (line 479) — note `GEAR_MAP` and `GearInfo` are already imported (lines 46/53):

```typescript
  protected gearInfo(id: string): GearInfo | null {
    return GEAR_MAP[id] ?? null;
  }

  protected slotIcon(slot: string): string {
    return this.SLOT_ICONS[slot] ?? 'hardware';
  }
```

Then extend `hasSpoils` (line 487) to include gear:

```typescript
    return !!(spores || ev.sporesLost || ev.hp || ev.item || ev.gear || ev.paint || ev.hat);
```

- [ ] **Step 4: Verify the build**

Run: `npm run build`
Expected: build succeeds with no TypeScript errors. (There is no unit-test runner; the build is the check.)

- [ ] **Step 5: Commit (optional checkpoint)**

```bash
git add src/app/undercity/services/undercity-models.ts src/app/undercity/tabs/board-tab.component.html src/app/undercity/tabs/board-tab.component.ts
git commit -m "feat(undercity): render gear drops in the space-result modal"
```

---

## Task 6: Client — battle victory popup

**Files:**
- Modify: `src/app/undercity/tabs/battle-playback.component.ts` (`BattleRewards`, ~line 25)
- Modify: `src/app/undercity/tabs/board-tab.component.ts` (`buildRewards`, ~line 1136; guards at lines 335/68)
- Modify: `src/app/undercity/tabs/interactive-battle.component.html` (~line 248) and `battle-playback.component.html` (~line 108)

- [ ] **Step 1: Extend `BattleRewards`**

In `battle-playback.component.ts`, add to the `BattleRewards` interface (after `itemIcon?: string;`):

```typescript
  gearName?: string;
  gearIcon?: string;
  gearEquipped?: boolean;
  gearSpores?: number;
```

- [ ] **Step 2: Map gear in `buildRewards`**

In `board-tab.component.ts`, extend the `buildRewards` `src` param type and body (line 1136):

```typescript
  private buildRewards(src: {
    spores?: number;
    xp?: number;
    levels?: number;
    item?: string;
    gear?: SpaceEvent['gear'];
  }): BattleRewards {
    const rewards: BattleRewards = { spores: src.spores, xp: src.xp, levels: src.levels };
    if (src.item) {
      const info = CONSUMABLE_MAP[src.item];
      rewards.itemName = info?.name ?? src.item;
      rewards.itemIcon = info?.icon;
    }
    if (src.gear) {
      const g = GEAR_MAP[src.gear.id];
      rewards.gearName = g?.name ?? src.gear.id;
      rewards.gearIcon = this.SLOT_ICONS[src.gear.slot] ?? 'hardware';
      rewards.gearEquipped = src.gear.outcome === 'equipped';
      rewards.gearSpores = src.gear.soldSpores;
    }
    return rewards;
  }
```

- [ ] **Step 3: Include gear in the "has spoils" guards**

In `board-tab.component.ts` line 335 and `battle-playback.component.ts` line 68, add `|| !!r.gearName` to the existing `hasSpoils()`/guard expressions, e.g.:

```typescript
    return this.outcome() === 'attacker' && !!r && (!!r.spores || !!r.xp || !!r.levels || !!r.itemName || !!r.gearName);
```

- [ ] **Step 4: Render the gear chip in both victory templates**

In `interactive-battle.component.html`, after the `@if (r.itemName)` chip (line 248):

```html
          @if (r.gearName) { <span class="reward-chip item"><mat-icon class="mi">{{ r.gearIcon ?? 'hardware' }}</mat-icon> {{ r.gearName }} — {{ r.gearEquipped ? 'equipped!' : 'salvaged (+' + r.gearSpores + ')' }}</span> }
```

In `battle-playback.component.html`, after the `@if (r.itemName)` block (line 108):

```html
          @if (r.gearName) {
            <span class="spoil item">
              <mat-icon class="mi">{{ r.gearIcon ?? 'hardware' }}</mat-icon>
              {{ r.gearName }} — {{ r.gearEquipped ? 'equipped!' : 'salvaged (+' + r.gearSpores + ')' }}
            </span>
          }
```

> Match the exact wrapper element/class the neighbouring `itemName` chip uses in each file (`reward-chip` vs `spoil`) — copy its markup so the styling lands.

- [ ] **Step 5: Verify the build**

Run: `npm run build`
Expected: build succeeds, no TypeScript errors.

- [ ] **Step 6: Manual smoke (optional, via `/run` or dev server)**

Start `npm start`, enter `/undercity`, and (with server `DEBUG`/tunable chances temporarily raised if needed) win a wild battle or hit a loot tile to confirm the gear chip renders as "equipped!" or "salvaged (+N)".

- [ ] **Step 7: Commit (optional checkpoint)**

```bash
git add src/app/undercity/tabs/battle-playback.component.ts src/app/undercity/tabs/board-tab.component.ts src/app/undercity/tabs/interactive-battle.component.html src/app/undercity/tabs/battle-playback.component.html
git commit -m "feat(undercity): render gear drops in the battle victory popup"
```

---

## Final verification

- [ ] Backend suite green: `cd infrastructure/lambda && python -m pytest tests -q`
- [ ] Frontend builds: `npm run build`
- [ ] Spot-check the design's source table matches the shipped `GEAR_DROP` chances/tiers.
- [ ] Confirm no gear is awarded on a battle **loss** or **timeout** (drops are inside the `attacker` branch only) — combat invariant.
