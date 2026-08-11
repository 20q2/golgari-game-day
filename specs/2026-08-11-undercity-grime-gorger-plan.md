# Grime Gorger Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add the Grime Gorger — a tier-3 Undercity apex that devours gear and consumables into a new currency (Mulch) and spends it, standing on a board space, to rewrite what that space is.

**Architecture:** All rules are server-side Python. Reclaimed spaces are season-scoped DynamoDB records (`RECLAIM#<node>`) read through an *override layer* — the node graph itself is never mutated, because `_season_map()` hands back the module-level `data.MAP_NODES` object. The client is a display mirror plus two new UI surfaces.

**Tech Stack:** Python 3.11 Lambda (no boto3 in the rules layer), pytest with an in-memory `FakeTable`, Angular 20 standalone components, SCSS.

**Spec:** [specs/2026-08-10-undercity-grime-gorger-design.md](2026-08-10-undercity-grime-gorger-design.md)

---

## Orientation for the implementer

Things about this codebase that will bite you if nobody tells you:

- **Run the server tests with** `cd infrastructure/lambda && python -m pytest tests -q`. Keep them green; the suite is the safety net for the whole game.
- **There is no frontend test runner.** Karma/Jasmine were removed and `tsconfig.spec.json` is gone. Do not try `ng test`. Verify client work with `npm run build` from the repo root.
- **`npm run lint` is unreliable in this repo.** Use the build as your gate.
- **Never mutate the node graph.** `db._season_map(table, sid)` returns `data.MAP_NODES` *by reference* when `PROCEDURAL_DUNGEONS` is off (which is the default in tests). Mutating it corrupts every later test in the same process and would corrupt live state across Lambda invocations.
- **Balance scalars live in `undercity_config.py`; weighted tables live in `undercity_data.py`.** `undercity_data` does `from undercity_config import *`, so a scalar defined in config is reachable as `data.NAME`. Follow that convention.
- **Client mirrors are hand-maintained.** `src/app/undercity/data/*.ts` duplicates server numbers for display. If you change a server number, change the mirror.
- **No emoji in game UI.** This project uses `uc-*` and Material icons deliberately. Emoji break the symbol language.
- **The user commits and deploys.** Commit your work; never run `cdk deploy`.
- **The working tree has unrelated work in progress.** Only `git add` the exact files each task names. Never `git add -A` or `git commit -a`.

---

## File Structure

**Server (`infrastructure/lambda/`)**

| File | Responsibility for this feature |
| --- | --- |
| `undercity_config.py` | New scalars: bag size, Mulch yields, claim cap, price list, surface-only set |
| `undercity_data.py` | `APEX['grime_gorger']` entry; `RECLAIM_SOURCES` frozenset |
| `undercity_db.py` | `bag_cap()`, `_kind_cap()`, `_effective_type()`, `_reclaimed()`, `_gorge()`, `_reclaim()`, `_evolve` multi-passive fix, state exposure |
| `tests/test_undercity_grime_gorger.py` | **New.** Every behaviour of this feature |
| `tests/test_undercity_bag_cap.py` | **New.** The bag-cap refactor, isolated from the Gorger |

**Client (`src/app/undercity/`)**

| File | Responsibility for this feature |
| --- | --- |
| `data/forms.ts` | Apex mirror entry, passive names + blurbs |
| `data/species.ts` | Sprite manifest entry |
| `data/reclaim.ts` | **New.** Price-list mirror + eligible-source set, so components share one source |
| `services/undercity-models.ts` | `mulch`, `bagCap`, `claims`, `reclaimed` types |
| `tabs/creature-tab.component.*` | Mulch counter + Gorge feeding UI |
| `tabs/board-tab.component.*` | Reclaim modal |
| `engine/board-canvas.ts` | Cultivated-node rendering |
| `tabs/plaza-tab.component.ts` | Replace the hardcoded bag cap |

---

## Task 1: Config scalars and data tables

**Files:**
- Modify: `infrastructure/lambda/undercity_config.py`
- Modify: `infrastructure/lambda/undercity_data.py`
- Test: `infrastructure/lambda/tests/test_undercity_grime_gorger.py` (create)

- [ ] **Step 1: Write the failing test**

Create `infrastructure/lambda/tests/test_undercity_grime_gorger.py`:

```python
"""Grime Gorger: Gorge (items -> Mulch) and Reclaim (Mulch -> board edits).
Design: specs/2026-08-10-undercity-grime-gorger-design.md"""
import sys, os

sys.path.insert(0, os.path.join(os.path.dirname(__file__), '..'))

import undercity_db as db
import undercity_data as data
import undercity_config as config


def test_apex_entry_is_wired():
    apex = data.APEX['grime_gorger']
    assert apex['name'] == 'Grime Gorger'
    assert apex['passives'] == ['gorge', 'reclaim']
    assert apex['bonus'] == {'maxHp': 8, 'def': 2}
    assert sorted(apex['from']) == ['brackish_trudge', 'shambling_shell',
                                    'woodwraith_strangler']


def test_reclaim_price_list_and_sources():
    # hazard is a legal source but never a target: the Gorger eats filth,
    # it does not spread it.
    assert 'hazard' in data.RECLAIM_SOURCES
    assert 'hazard' not in config.RECLAIM_PRICES
    # Dig sites / veins / shops are the reverse: creatable, never overwritable.
    for t in ('crystal_vein', 'excavation', 'shop'):
        assert t in config.RECLAIM_PRICES
        assert t not in data.RECLAIM_SOURCES
    # Topology and unique landmarks are neither.
    for t in ('gate', 'warp', 'ladder', 'tunnel', 'barrier',
              'vault', 'vault_lock', 'shrine', 'witch', 'ossuary', 'boss'):
        assert t not in config.RECLAIM_PRICES
        assert t not in data.RECLAIM_SOURCES
    assert config.RECLAIM_SURFACE_ONLY == ('rest', 'shop')
    assert config.RECLAIM_MAX_CLAIMS == 3


def test_every_price_list_target_is_a_real_node_type():
    """A typo in the price list would sell a space type the resolver cannot
    handle, stranding the buyer on a dead tile."""
    real = {n['type'] for n in data.MAP_NODES.values()}
    assert set(config.RECLAIM_PRICES) <= real


def test_mulch_yields():
    assert config.GORGE_MULCH_CONSUMABLE == {1: 1, 2: 2, 3: 3, 4: 4}
    assert config.GORGE_MULCH_GEAR == {1: 2, 2: 4, 3: 6, 4: 8}
    assert config.GORGE_BAG_SIZE == 10
```

- [ ] **Step 2: Run test to verify it fails**

Run: `cd infrastructure/lambda && python -m pytest tests/test_undercity_grime_gorger.py -q`
Expected: FAIL — `KeyError: 'grime_gorger'`.

- [ ] **Step 3: Add the config scalars**

Append to `infrastructure/lambda/undercity_config.py`:

```python
# ── Grime Gorger (design 2026-08-10) ─────────────────────────────────────────
# The apex that edits the board. Gorge turns junk into Mulch; Reclaim spends
# Mulch, standing on a space, to rewrite what that space is.
GORGE_BAG_SIZE = 10           # its consumable bag; every other form keeps BAG_SIZE 5
# Yields by item rarity (the shared 1-4 Common/Rare/Legendary/Mythic ladder).
# Gear is worth double a consumable of the same rarity, matching the real price
# tables (gear 23/47/82/150 vs consumables 12/25/45/80). Deliberately slightly
# WORSE per forgone Spore at high rarity, so Commons are the efficient fuel and
# the Gorger buys the table's junk instead of eating its own best gear.
GORGE_MULCH_CONSUMABLE = {1: 1, 2: 2, 3: 3, 4: 4}
GORGE_MULCH_GEAR       = {1: 2, 2: 4, 3: 6, 4: 8}

# Price of creating each space type. Cheap spaces buy XP, expensive spaces buy
# wealth — that tension is the point of the spread. `shop` at 60 is the number
# least trusted here; revisit it after a real session.
RECLAIM_PRICES = {'wild': 4, 'mystery': 6, 'loot': 10, 'elite': 12,
                  'cache': 14, 'rest': 18, 'crystal_vein': 24,
                  'excavation': 24, 'trove': 30, 'shop': 60}
# `restsUsed` is tracked PER NODE, not as a per-descent count, so a creatable
# rest node in the depths manufactures extra full heals and dissolves descent
# attrition. A created shop is the same failure in economic form: a descent's
# tension is committing without resupply. Both are free to build on the surface.
RECLAIM_SURFACE_ONLY = ('rest', 'shop')
RECLAIM_MAX_CLAIMS = 3        # standing claims per player; a 4th collapses the oldest
```

- [ ] **Step 4: Add the data tables**

In `infrastructure/lambda/undercity_data.py`, add to the `APEX` dict (after the
`grave_reaver` entry, before the closing brace):

```python
    'grime_gorger': {
        'name': 'Grime Gorger', 'bonus': {'maxHp': 8, 'def': 2},
        'passive': 'gorge', 'passives': ['gorge', 'reclaim'],
        # non-signature shared apex #2 (like the Lich Lord): the scavengers and
        # composters — bog brute, shell-hoarder, fungal thallid.
        'from': ['brackish_trudge', 'shambling_shell', 'woodwraith_strangler'],
        'blurb': 'Gorge: a ten-slot gut that devours gear and consumables into '
                 'Mulch. Reclaim: standing on a space, spend Mulch to rewrite '
                 'what that space is — the only creature that edits the map.',
    },
```

Then, immediately after the `APEX` dict's closing brace, add:

```python
# Space types the Grime Gorger may OVERWRITE. Deliberately not the same set as
# the RECLAIM_PRICES targets it may CREATE:
#   hazard is a source but not a target — it eats filth, it does not spread it;
#     creating a hazard could only ever be aimed at other players, and a hazard
#     on your own claim is useless to you.
#   crystal_vein / excavation / shop are targets but not sources — you can make
#     one, you cannot unmake one. That also protects a dig site's uncollected
#     SITE# loot from being erased.
# Topology (gate/warp/ladder/tunnel/barrier) and unique landmarks (vault/
# vault_lock/shrine/witch/ossuary/boss) are neither: a player may change what a
# space DOES, never what the map IS.
RECLAIM_SOURCES = frozenset({
    'wild', 'hazard', 'fog', 'loot', 'mystery', 'cache', 'trove', 'rest', 'elite',
})
```

- [ ] **Step 5: Run tests to verify they pass**

Run: `cd infrastructure/lambda && python -m pytest tests/test_undercity_grime_gorger.py tests/test_undercity_signatures.py -q`
Expected: PASS — 4 new tests plus the 5 evolution-graph invariants, which must
stay green *without modification*. If `test_every_tier2_form_has_two_or_three_options`
fails, a `from` entry landed on a form that already had 3 options; re-read the spec.

- [ ] **Step 6: Commit**

```bash
git add infrastructure/lambda/undercity_config.py infrastructure/lambda/undercity_data.py infrastructure/lambda/tests/test_undercity_grime_gorger.py
git commit -m "feat(undercity): Grime Gorger apex tables and Reclaim scalars"
```

---

## Task 2: Teach `_evolve` to grant multi-passive forms

`_evolve` currently appends `spec['passive']` — singular. The `passives` list is
honoured only on the join/starter path (that is how Elf gets two). Without this,
a Grime Gorger would evolve with `gorge` and never get `reclaim`.

**Files:**
- Modify: `infrastructure/lambda/undercity_db.py:7153`
- Test: `infrastructure/lambda/tests/test_undercity_grime_gorger.py`

- [ ] **Step 1: Write the failing test**

Append to `tests/test_undercity_grime_gorger.py`:

```python
from test_undercity_db import table, act, _player_at, _sid  # noqa: F401


def _gorger(table, node='cavern_r2'):
    """A joined player at `node`, evolved all the way to Grime Gorger.
    Returns (sid, doc). The doc is NOT saved; callers pass it to handlers."""
    sid, doc = _player_at(table, node)
    doc['species'] = 'pest'
    doc['form'] = 'grime_gorger'
    doc['tier'] = 3
    doc['level'] = 10
    doc['passives'] = ['gorge', 'reclaim']
    doc['mulch'] = 0
    return sid, doc


def test_evolving_into_the_gorger_grants_both_passives(table):
    sid, doc = _player_at(table, 'cavern_r2')
    doc['species'] = 'pest'
    doc['form'] = 'brackish_trudge'
    doc['tier'] = 2
    doc['level'] = 10
    doc['passives'] = ['bog_forager']
    db._put_player(table, doc)
    status, body = act(table, 'evolve', form='grime_gorger')
    assert status == 200, body
    assert body['you']['passives'] == ['bog_forager', 'gorge', 'reclaim']
    assert body['you']['tier'] == 3


def test_single_passive_forms_are_unchanged_by_the_list_support(table):
    sid, doc = _player_at(table, 'cavern_r2')
    doc['species'] = 'zombie'
    doc['form'] = 'shambling_shell'
    doc['tier'] = 2
    doc['level'] = 10
    doc['passives'] = ['spikeshell']
    db._put_player(table, doc)
    status, body = act(table, 'evolve', form='grave_titan')
    assert status == 200, body
    assert body['you']['passives'] == ['spikeshell', 'colossus']
```

- [ ] **Step 2: Run test to verify it fails**

Run: `cd infrastructure/lambda && python -m pytest tests/test_undercity_grime_gorger.py -q -k evolv`
Expected: FAIL — passives come back as `['bog_forager', 'gorge']`, missing `reclaim`.

- [ ] **Step 3: Write the implementation**

In `infrastructure/lambda/undercity_db.py`, replace line 7153:

```python
    doc.setdefault('passives', []).append(spec['passive'])
```

with:

```python
    # Forms may carry more than one innate passive (`passives`); the singular
    # `passive` is the display headline and the fallback for the other forms.
    for _p in (spec.get('passives') or [spec['passive']]):
        if _p not in doc.setdefault('passives', []):
            doc['passives'].append(_p)
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `cd infrastructure/lambda && python -m pytest tests -q`
Expected: PASS — the whole suite. This touches a shared path, so run all of it.

- [ ] **Step 5: Commit**

```bash
git add infrastructure/lambda/undercity_db.py infrastructure/lambda/tests/test_undercity_grime_gorger.py
git commit -m "fix(undercity): grant every passive on multi-passive evolutions"
```

---

## Task 3: Per-creature bag cap

Seven sites read `data.BAG_SIZE`. Two of them (`_ACQUIRE_KINDS` line 1593,
`_MARKET_KINDS` line 1924) are module-level dicts that bake the value in at
import time, so they cannot call a per-doc function — their four `spec['cap']`
readers must go through a lookup instead.

**Files:**
- Modify: `infrastructure/lambda/undercity_db.py` (lines 1593, 1630, 1648, 1924, 2309, 2345, 3664, 4395, 5164, 7331, 7526)
- Test: `infrastructure/lambda/tests/test_undercity_bag_cap.py` (create)

- [ ] **Step 1: Write the failing test**

Create `infrastructure/lambda/tests/test_undercity_bag_cap.py`:

```python
"""The consumable bag is per-creature: the Grime Gorger's Gorge passive doubles
it to 10. Every other form keeps the normal 5."""
import sys, os

sys.path.insert(0, os.path.join(os.path.dirname(__file__), '..'))

import undercity_db as db
import undercity_data as data
import undercity_config as config


def test_bag_cap_by_passive():
    assert db.bag_cap({'passives': ['gorge', 'reclaim']}) == config.GORGE_BAG_SIZE
    assert db.bag_cap({'passives': ['scrounger']}) == data.BAG_SIZE
    assert db.bag_cap({}) == data.BAG_SIZE


def test_kind_cap_routes_consumables_through_bag_cap():
    gorger = {'passives': ['gorge']}
    plain = {'passives': []}
    assert db._kind_cap(gorger, 'consumable') == 10
    assert db._kind_cap(plain, 'consumable') == 5
    # Other kinds are flat for everyone.
    assert db._kind_cap(gorger, 'gear') == data.GEAR_STASH_SIZE
    assert db._kind_cap(gorger, 'scroll') == data.SCROLL_SATCHEL_CAP


def test_gorger_bag_accepts_ten_consumables():
    doc = {'passives': ['gorge'], 'bag': ['healing_moss'] * 9}
    assert db._has_room(doc, 'consumable') is True
    doc['bag'] = ['healing_moss'] * 10
    assert db._has_room(doc, 'consumable') is False


def test_normal_creature_still_caps_at_five():
    doc = {'passives': [], 'bag': ['healing_moss'] * 4}
    assert db._has_room(doc, 'consumable') is True
    doc['bag'] = ['healing_moss'] * 5
    assert db._has_room(doc, 'consumable') is False
```

- [ ] **Step 2: Run test to verify it fails**

Run: `cd infrastructure/lambda && python -m pytest tests/test_undercity_bag_cap.py -q`
Expected: FAIL — `AttributeError: module 'undercity_db' has no attribute 'bag_cap'`.

Note `_has_room` already exists at line 1647; the test asserts its new per-doc behaviour.

- [ ] **Step 3: Add the helpers**

In `infrastructure/lambda/undercity_db.py`, immediately **above** the
`_ACQUIRE_KINDS` dict (line 1593), insert:

```python
def bag_cap(doc):
    """Consumable-bag ceiling for this creature. The Grime Gorger's Gorge
    passive doubles it — the mechanical spine of a hauler that carries junk
    around to feed the ground."""
    if 'gorge' in (doc.get('passives') or []):
        return config.GORGE_BAG_SIZE
    return data.BAG_SIZE


# Capacity per inventory kind, resolved PER DOC. _ACQUIRE_KINDS/_MARKET_KINDS
# are module-level dicts built at import time, so they cannot hold a cap that
# varies by creature — this lookup is the single place caps come from.
_KIND_CAPS = {
    'gear':       lambda doc: data.GEAR_STASH_SIZE,
    'consumable': bag_cap,
    'scroll':     lambda doc: data.SCROLL_SATCHEL_CAP,
}


def _kind_cap(doc, kind):
    return _KIND_CAPS[kind](doc)
```

- [ ] **Step 4: Remove the baked-in caps and route the readers**

In `_ACQUIRE_KINDS` (line 1593) delete the three `'cap': ...` entries so it reads:

```python
_ACQUIRE_KINDS = {
    'gear':       {'field': 'gearStash'},
    'consumable': {'field': 'bag'},
    'scroll':     {'field': 'scrolls'},
}
```

In `_MARKET_KINDS` (line 1924) delete the `'cap': ...` entry from the `gear` and
`consumable` sub-dicts, leaving their `field`, `cost` and `name` keys untouched.

Then replace the four `spec['cap']` readers. At line 1630:

```python
    if len(inv) < _kind_cap(doc, kind):
```

At line 1648 (inside `_has_room`):

```python
    return len(doc.get(spec['field']) or []) < _kind_cap(doc, kind)
```

At lines 2309 and 2345 (both inside market handlers, where `kind` is in scope):

```python
    if len(doc.get(spec['field']) or []) >= _kind_cap(doc, kind):
```

- [ ] **Step 5: Route the five direct `data.BAG_SIZE` readers**

Replace `data.BAG_SIZE` with `bag_cap(doc)` at each of these, keeping the rest of
each line as-is:

- line 3664: `if len(doc.get('bag') or []) + n_bag > bag_cap(doc):`
- line 4395: `if len(doc.get('bag', [])) < bag_cap(doc):`
- line 5164: `if len(doc.get('bag') or []) >= bag_cap(doc):`
- line 7331: `if len(doc.get('bag') or []) >= bag_cap(doc):`
- line 7526: `if len(doc.get('bag') or []) >= bag_cap(doc):`

While you are at line 7332, fix the stale message beneath it — it currently says
`'Your bag is full (3 slots).'` but the cap has been 5 for a long time and is now
per-creature:

```python
            return _err(f'Your bag is full ({bag_cap(doc)} slots).', 409)
```

- [ ] **Step 6: Run tests to verify they pass**

Run: `cd infrastructure/lambda && python -m pytest tests -q`
Expected: PASS — the whole suite. Several existing tests fill a bag to
`data.BAG_SIZE` and assert it is full; they still pass because those docs have no
`gorge` passive.

- [ ] **Step 7: Commit**

```bash
git add infrastructure/lambda/undercity_db.py infrastructure/lambda/tests/test_undercity_bag_cap.py
git commit -m "feat(undercity): per-creature consumable bag cap"
```

---

## Task 4: Mulch and the `gorge` action

**Files:**
- Modify: `infrastructure/lambda/undercity_db.py` (new handler + dispatcher entry ~line 2840)
- Test: `infrastructure/lambda/tests/test_undercity_grime_gorger.py`

- [ ] **Step 1: Write the failing test**

Append to `tests/test_undercity_grime_gorger.py`:

```python
def _first_gear_of_tier(tier):
    return next(gid for gid, g in data.GEAR.items() if g['tier'] == tier)


def _first_consumable_of_tier(tier):
    return next(cid for cid, c in data.CONSUMABLES.items() if c['tier'] == tier)


def test_gorge_gear_credits_mulch_by_rarity(table):
    for tier, expected in config.GORGE_MULCH_GEAR.items():
        sid, doc = _gorger(table)
        doc['gearStash'] = [_first_gear_of_tier(tier)]
        status, body = db._gorge(table, sid, doc, {'kind': 'gear', 'index': 0})
        assert status == 200, body
        assert body['you']['mulch'] == expected, tier
        assert body['you']['gearStash'] == []


def test_gorge_consumable_credits_mulch_by_rarity(table):
    for tier, expected in config.GORGE_MULCH_CONSUMABLE.items():
        sid, doc = _gorger(table)
        doc['bag'] = [_first_consumable_of_tier(tier)]
        status, body = db._gorge(table, sid, doc, {'kind': 'consumable', 'index': 0})
        assert status == 200, body
        assert body['you']['mulch'] == expected, tier
        assert body['you']['bag'] == []


def test_gorge_accumulates(table):
    sid, doc = _gorger(table)
    doc['gearStash'] = [_first_gear_of_tier(1), _first_gear_of_tier(1)]
    db._gorge(table, sid, doc, {'kind': 'gear', 'index': 0})
    status, body = db._gorge(table, sid, doc, {'kind': 'gear', 'index': 0})
    assert body['you']['mulch'] == 4


def test_gorge_rejects_non_gorgers(table):
    sid, doc = _player_at(table, 'cavern_r2')
    doc['gearStash'] = [_first_gear_of_tier(1)]
    status, body = db._gorge(table, sid, doc, {'kind': 'gear', 'index': 0})
    assert status == 400
    assert doc['gearStash'] == [_first_gear_of_tier(1)]  # item untouched


def test_gorge_rejects_bad_slot(table):
    sid, doc = _gorger(table)
    doc['gearStash'] = []
    status, body = db._gorge(table, sid, doc, {'kind': 'gear', 'index': 0})
    assert status == 409
    status, body = db._gorge(table, sid, doc, {'kind': 'pets', 'index': 0})
    assert status == 400


def test_gorge_is_registered_as_an_action(table):
    sid, doc = _gorger(table)
    doc['gearStash'] = [_first_gear_of_tier(2)]
    db._put_player(table, doc)
    status, body = act(table, 'gorge', kind='gear', index=0)
    assert status == 200, body
    assert body['you']['mulch'] == 4
```

- [ ] **Step 2: Run test to verify it fails**

Run: `cd infrastructure/lambda && python -m pytest tests/test_undercity_grime_gorger.py -q -k gorge`
Expected: FAIL — `AttributeError: module 'undercity_db' has no attribute '_gorge'`.

- [ ] **Step 3: Write the implementation**

In `infrastructure/lambda/undercity_db.py`, add above `_evolve` (line 7131):

```python
# ── Grime Gorger ─────────────────────────────────────────────────────────────

_GORGE_KINDS = {
    'gear':       ('gearStash', lambda i: data.GEAR[i]['tier'],
                   lambda i: data.GEAR[i]['name'], config.GORGE_MULCH_GEAR),
    'consumable': ('bag', lambda i: data.CONSUMABLES[i]['tier'],
                   lambda i: data.CONSUMABLES[i]['name'],
                   config.GORGE_MULCH_CONSUMABLE),
}


def _gorge(table, sid, doc, payload):
    """Devour a stashed gear piece or a bagged consumable into Mulch. A third
    fate for an item alongside Salvage (-> materials) and the Market (-> Spores),
    so 'what do I do with this junk' is a real fork."""
    if 'gorge' not in (doc.get('passives') or []):
        return _err('Only a Grime Gorger can stomach that.')
    kind = payload.get('kind')
    spec = _GORGE_KINDS.get(kind)
    if not spec:
        return _err('You can only devour gear and consumables.')
    field, tier_of, name_of, yields = spec
    inv = doc.get(field) or []
    try:
        index = int(payload.get('index'))
    except (TypeError, ValueError):
        return _err('Pick something to devour.')
    if index < 0 or index >= len(inv):
        return _err('That slot is empty.', 409)
    item_id = inv.pop(index)
    doc[field] = inv
    gained = yields[tier_of(item_id)]
    doc['mulch'] = doc.get('mulch', 0) + gained
    conflict = _save_or_conflict(table, doc)
    if conflict:
        return conflict
    return _ok(doc, text=f"You devour the {name_of(item_id)} — {gained} Mulch.",
               gorge={'mulch': gained, 'total': doc['mulch']})
```

Then register it in the `handlers` dict (~line 2840), on the line after
`'salvage-gear': _salvage_gear, 'upgrade-gear': _upgrade_gear,`. Only `gorge`
exists so far — Task 6 adds `reclaim` to this same line:

```python
        'gorge': _gorge,
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `cd infrastructure/lambda && python -m pytest tests/test_undercity_grime_gorger.py -q`
Expected: PASS — all gorge tests plus the Task 1/2 tests.

- [ ] **Step 5: Commit**

```bash
git add infrastructure/lambda/undercity_db.py infrastructure/lambda/tests/test_undercity_grime_gorger.py
git commit -m "feat(undercity): Gorge — devour gear and consumables into Mulch"
```

---

## Task 5: The effective-type override layer

Reclaimed spaces must change what a landing *does* without touching the node
graph. `_season_map()` returns `data.MAP_NODES` by reference, so mutation is not
an option.

**Files:**
- Modify: `infrastructure/lambda/undercity_db.py` (new helpers; `_resolve_space` line 4405)
- Test: `infrastructure/lambda/tests/test_undercity_grime_gorger.py`

- [ ] **Step 1: Write the failing test**

Append to `tests/test_undercity_grime_gorger.py`:

```python
def _write_claim(table, sid, node, ntype, orig, by='user-alex'):
    table.put_item(Item={'pk': db._season_pk(sid), 'sk': f'RECLAIM#{node}',
                         'node': node, 'type': ntype, 'origType': orig,
                         'price': 10, 'by': by, 'byName': 'Alex'})


def test_effective_type_falls_back_to_the_map(table):
    sid, _ = _player_at(table, 'cavern_r2')
    nodes = db._season_map(table, sid)
    assert db._effective_type(table, sid, 'cavern_r2') == nodes['cavern_r2']['type']


def test_effective_type_honours_a_claim(table):
    sid, _ = _player_at(table, 'cavern_r2')
    _write_claim(table, sid, 'cavern_r2', 'loot', 'wild')
    assert db._effective_type(table, sid, 'cavern_r2') == 'loot'


def test_claim_does_not_mutate_the_shared_node_graph(table):
    """Regression guard: _season_map returns data.MAP_NODES by reference when
    PROCEDURAL_DUNGEONS is off, so writing a claim must never touch it."""
    sid, _ = _player_at(table, 'cavern_r2')
    before = data.MAP_NODES['cavern_r2']['type']
    _write_claim(table, sid, 'cavern_r2', 'loot', before)
    assert data.MAP_NODES['cavern_r2']['type'] == before


def test_landing_resolves_as_the_claimed_type(table):
    sid, doc = _player_at(table, 'cavern_r2')   # 'wild' in the committed map
    _write_claim(table, sid, 'cavern_r2', 'loot', 'wild')
    ev = db._resolve_space(table, sid, doc, 'cavern_r2', 'cavern_r1')
    assert ev['type'] in ('loot', 'loot_puzzle')  # never a wild battle
```

- [ ] **Step 2: Run test to verify it fails**

Run: `cd infrastructure/lambda && python -m pytest tests/test_undercity_grime_gorger.py -q -k "effective or claimed or mutate"`
Expected: FAIL — `AttributeError: module 'undercity_db' has no attribute '_effective_type'`.

- [ ] **Step 3: Write the implementation**

In `infrastructure/lambda/undercity_db.py`, add just below `_season_map`
(after line 317):

```python
def _reclaimed(table, sid):
    """Every standing Grime Gorger claim this season, keyed by node id.

    Claims are an OVERRIDE LAYER, never a mutation: `_season_map` hands back the
    module-level `data.MAP_NODES` object when PROCEDURAL_DUNGEONS is off, so
    editing the graph in place would corrupt state across Lambda invocations."""
    pk = _season_pk(sid)
    resp = table.query(
        KeyConditionExpression='pk = :pk AND begins_with(sk, :sk)',
        ExpressionAttributeValues={':pk': pk, ':sk': 'RECLAIM#'})
    return {it['node']: it for it in resp.get('Items', [])}


def _effective_type(table, sid, node):
    """What landing on `node` actually does right now — the reclaimed override
    if one stands, else the season map's own type."""
    claim = _reclaimed(table, sid).get(node)
    if claim:
        return claim['type']
    return _season_map(table, sid)[node]['type']
```

In `_resolve_space` (line 4405), replace:

```python
    ntype = nodes[node]['type']
```

with:

```python
    # Read through the Grime Gorger override layer, so a reclaimed space
    # resolves — and reports its metric — as what it has become.
    ntype = _effective_type(table, sid, node)
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `cd infrastructure/lambda && python -m pytest tests -q`
Expected: PASS — the whole suite. `_resolve_space` is the hottest path in the
game; if anything regressed it shows up here.

- [ ] **Step 5: Commit**

```bash
git add infrastructure/lambda/undercity_db.py infrastructure/lambda/tests/test_undercity_grime_gorger.py
git commit -m "feat(undercity): reclaimed-space override layer for landings"
```

---

## Task 6: The `reclaim` action and its validation

**Files:**
- Modify: `infrastructure/lambda/undercity_db.py` (new handler; dispatcher entry)
- Test: `infrastructure/lambda/tests/test_undercity_grime_gorger.py`

- [ ] **Step 1: Write the failing test**

Append to `tests/test_undercity_grime_gorger.py`:

```python
def _node_of_type(table, sid, ntype, region=None):
    nodes = db._season_map(table, sid)
    return next(nid for nid, n in nodes.items()
                if n['type'] == ntype and (region is None or n['region'] == region))


def test_reclaim_rewrites_a_space_and_charges_the_price(table):
    sid, doc = _gorger(table)
    node = _node_of_type(table, sid, 'wild')
    doc['position'] = node
    doc['mulch'] = 50
    status, body = db._reclaim(table, sid, doc, {'target': 'loot'})
    assert status == 200, body
    assert body['you']['mulch'] == 50 - config.RECLAIM_PRICES['loot']
    assert db._effective_type(table, sid, node) == 'loot'


def test_reclaim_rejects_non_gorgers(table):
    sid, doc = _player_at(table, _node_of_type(table, _sid(table), 'wild'))
    doc['mulch'] = 99
    status, _ = db._reclaim(table, sid, doc, {'target': 'loot'})
    assert status == 400


def test_reclaim_refuses_topology_and_landmarks_as_sources(table):
    sid, doc = _gorger(table)
    doc['mulch'] = 999
    for protected in ('gate', 'shop', 'ladder', 'barrier'):
        doc['position'] = _node_of_type(table, sid, protected)
        status, body = db._reclaim(table, sid, doc, {'target': 'loot'})
        assert status == 409, (protected, body)


def test_hazard_is_a_source_but_never_a_target(table):
    sid, doc = _gorger(table)
    doc['mulch'] = 999
    # Overwriting a hazard is the whole fantasy: it eats filth.
    doc['position'] = _node_of_type(table, sid, 'hazard')
    status, _ = db._reclaim(table, sid, doc, {'target': 'loot'})
    assert status == 200
    # Creating one is refused: it could only ever be aimed at other players.
    doc['position'] = _node_of_type(table, sid, 'wild')
    status, _ = db._reclaim(table, sid, doc, {'target': 'hazard'})
    assert status == 400


def test_dig_sites_are_creatable_but_not_overwritable(table):
    sid, doc = _gorger(table)
    doc['mulch'] = 999
    doc['position'] = _node_of_type(table, sid, 'excavation')
    status, _ = db._reclaim(table, sid, doc, {'target': 'loot'})
    assert status == 409
    doc['position'] = _node_of_type(table, sid, 'wild')
    status, _ = db._reclaim(table, sid, doc, {'target': 'excavation'})
    assert status == 200


def test_rest_and_shop_are_surface_only(table):
    sid, doc = _gorger(table)
    doc['mulch'] = 999
    deep = _node_of_type(table, sid, 'wild', region='depths')
    surface = _node_of_type(table, sid, 'wild', region='cavern')
    for target in ('rest', 'shop'):
        doc['position'] = deep
        status, body = db._reclaim(table, sid, doc, {'target': target})
        assert status == 409, (target, body)
        doc['position'] = surface
        status, body = db._reclaim(table, sid, doc, {'target': target})
        assert status == 200, (target, body)
        table.delete_item(Key={'pk': db._season_pk(sid), 'sk': f'RECLAIM#{surface}'})
        doc['claims'] = []


def test_reclaim_refuses_an_unrevealed_fog_node(table):
    sid, doc = _gorger(table)
    doc['mulch'] = 999
    doc['position'] = _node_of_type(table, sid, 'fog')
    status, _ = db._reclaim(table, sid, doc, {'target': 'loot'})
    assert status == 409
    table.put_item(Item={'pk': db._season_pk(sid),
                         'sk': f"FOG#{doc['position']}", 'revealed': True})
    status, _ = db._reclaim(table, sid, doc, {'target': 'loot'})
    assert status == 200


def test_reclaim_refuses_a_no_op_target(table):
    sid, doc = _gorger(table)
    doc['mulch'] = 999
    doc['position'] = _node_of_type(table, sid, 'trove')
    status, _ = db._reclaim(table, sid, doc, {'target': 'trove'})
    assert status == 400


def test_reclaim_refuses_another_players_claim(table):
    sid, doc = _gorger(table)
    doc['mulch'] = 999
    node = _node_of_type(table, sid, 'wild')
    _write_claim(table, sid, node, 'loot', 'wild', by='user-someone-else')
    doc['position'] = node
    status, _ = db._reclaim(table, sid, doc, {'target': 'cache'})
    assert status == 409


def test_a_created_shop_serves_stock(table):
    """`_gen_shop_stock` is keyed per node, so a bought Bazaar Post should stock
    itself with no extra plumbing. If this fails, the buyer is stranded on a
    shop tile with nothing for sale."""
    sid, doc = _gorger(table)
    doc['mulch'] = 999
    node = _node_of_type(table, sid, 'wild', region='cavern')
    doc['position'] = node
    assert db._reclaim(table, sid, doc, {'target': 'shop'})[0] == 200
    ev = db._resolve_space(table, sid, doc, node, None)
    assert ev['type'] == 'shop'
    stock = ev.get('stock') or ev.get('bazaar') or {}
    assert stock.get('gear') or stock.get('consumables')


def test_insufficient_mulch_changes_nothing(table):
    sid, doc = _gorger(table)
    node = _node_of_type(table, sid, 'wild')
    doc['position'] = node
    doc['mulch'] = 3
    status, _ = db._reclaim(table, sid, doc, {'target': 'loot'})
    assert status == 409
    assert doc['mulch'] == 3
    assert db._effective_type(table, sid, node) == 'wild'
```

- [ ] **Step 2: Run test to verify it fails**

Run: `cd infrastructure/lambda && python -m pytest tests/test_undercity_grime_gorger.py -q -k reclaim`
Expected: FAIL — `AttributeError: module 'undercity_db' has no attribute '_reclaim'`.

- [ ] **Step 3: Write the implementation**

In `infrastructure/lambda/undercity_db.py`, add directly below `_gorge`:

```python
def _reclaim(table, sid, doc, payload):
    """Spend Mulch, standing on a space, to rewrite what that space is.

    The governing rule: a player may change what a space DOES, never what the
    map IS. Topology and unique landmarks are therefore absent from both
    RECLAIM_SOURCES and RECLAIM_PRICES."""
    if 'reclaim' not in (doc.get('passives') or []):
        return _err('Only a Grime Gorger can work the ground like that.')
    target = payload.get('target')
    price = config.RECLAIM_PRICES.get(target)
    if price is None:
        return _err('You cannot grow that here.')
    node = doc.get('position')
    nodes = _season_map(table, sid)
    if node not in nodes:
        return _err('You are nowhere the ground will take.', 409)

    claims = _reclaimed(table, sid)
    standing = claims.get(node)
    if standing and standing['by'] != doc['userId']:
        return _err('Another Gorger has already worked this ground.', 409)

    current = standing['type'] if standing else nodes[node]['type']
    if current == target:
        return _err('This ground is already exactly that.')
    # Your own claim may be re-landscaped; otherwise the underlying space must
    # be soft ground. `origType` is preserved so a released claim reverts.
    if not standing and current not in data.RECLAIM_SOURCES:
        return _err('This ground will not take a change.', 409)
    if current == 'fog' and not (_get(table, _season_pk(sid), f'FOG#{node}') or {}).get('revealed'):
        return _err('You cannot re-landscape ground you have not seen.', 409)
    if target in config.RECLAIM_SURFACE_ONLY and nodes[node].get('region') == 'depths':
        return _err('The deep dark will not hold that — build it on the surface.', 409)
    if doc.get('mulch', 0) < price:
        return _err(f'Not enough Mulch — that costs {price}.', 409)

    doc['mulch'] = doc.get('mulch', 0) - price
    item = {'pk': _season_pk(sid), 'sk': f'RECLAIM#{node}', 'node': node,
            'type': target, 'price': price,
            'origType': standing['origType'] if standing else current,
            'by': doc['userId'], 'byName': doc.get('username', 'Someone'),
            'at': _now()}
    table.put_item(Item=item)
    doc['claims'] = [n for n in (doc.get('claims') or []) if n != node] + [node]
    conflict = _save_or_conflict(table, doc)
    if conflict:
        return conflict
    _event(table, sid, 'reclaim',
           f"{doc.get('username', 'Someone')}'s Grime Gorger works the ground — "
           f"a {target.replace('_', ' ')} rises from the filth.",
           actor=doc['userId'])
    return _ok(doc, text=f"The ground churns and settles: a {target.replace('_', ' ')}.",
               reclaim={'node': node, 'type': target, 'price': price})
```

Now extend the dispatcher line added in Task 4 to its final form:

```python
        'gorge': _gorge, 'reclaim': _reclaim,
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `cd infrastructure/lambda && python -m pytest tests/test_undercity_grime_gorger.py -q`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add infrastructure/lambda/undercity_db.py infrastructure/lambda/tests/test_undercity_grime_gorger.py
git commit -m "feat(undercity): Reclaim — spend Mulch to rewrite a board space"
```

---

## Task 7: The three-claim cap and release flow

**Files:**
- Modify: `infrastructure/lambda/undercity_db.py` (`_reclaim`)
- Test: `infrastructure/lambda/tests/test_undercity_grime_gorger.py`

- [ ] **Step 1: Write the failing test**

Append to `tests/test_undercity_grime_gorger.py`:

```python
def _wilds(table, sid, n):
    nodes = db._season_map(table, sid)
    return [nid for nid, x in nodes.items() if x['type'] == 'wild'][:n]


def test_fourth_claim_is_refused_with_the_claim_list(table):
    sid, doc = _gorger(table)
    doc['mulch'] = 999
    a, b, c, d = _wilds(table, sid, 4)
    for node in (a, b, c):
        doc['position'] = node
        assert db._reclaim(table, sid, doc, {'target': 'loot'})[0] == 200
    doc['position'] = d
    status, body = db._reclaim(table, sid, doc, {'target': 'loot'})
    assert status == 409
    assert sorted(body['claims']) == sorted([a, b, c])


def test_releasing_a_claim_frees_the_slot_and_reverts_the_ground(table):
    sid, doc = _gorger(table)
    doc['mulch'] = 999
    a, b, c, d = _wilds(table, sid, 4)
    for node in (a, b, c):
        doc['position'] = node
        db._reclaim(table, sid, doc, {'target': 'loot'})
    doc['position'] = d
    status, body = db._reclaim(table, sid, doc, {'target': 'loot', 'release': a})
    assert status == 200, body
    assert db._effective_type(table, sid, a) == 'wild'   # reverted
    assert db._effective_type(table, sid, d) == 'loot'
    assert sorted(doc['claims']) == sorted([b, c, d])


def test_release_must_name_one_of_your_own_claims(table):
    sid, doc = _gorger(table)
    doc['mulch'] = 999
    a, b, c, d = _wilds(table, sid, 4)
    for node in (a, b, c):
        doc['position'] = node
        db._reclaim(table, sid, doc, {'target': 'loot'})
    doc['position'] = d
    status, _ = db._reclaim(table, sid, doc, {'target': 'loot', 'release': d})
    assert status == 409


def test_relandscaping_your_own_claim_is_not_a_new_claim(table):
    """Re-working ground you already hold costs the new type's FULL price but
    does not consume a fresh slot."""
    sid, doc = _gorger(table)
    doc['mulch'] = 999
    a, b, c = _wilds(table, sid, 3)
    for node in (a, b, c):
        doc['position'] = node
        db._reclaim(table, sid, doc, {'target': 'loot'})
    before = doc['mulch']
    doc['position'] = a
    status, body = db._reclaim(table, sid, doc, {'target': 'trove'})
    assert status == 200, body
    assert doc['mulch'] == before - config.RECLAIM_PRICES['trove']  # full price
    assert len(doc['claims']) == 3
    assert db._effective_type(table, sid, a) == 'trove'


def test_released_claim_reverts_to_its_original_type_not_the_previous_one(table):
    sid, doc = _gorger(table)
    doc['mulch'] = 999
    node = _node_of_type(table, sid, 'hazard')
    doc['position'] = node
    db._reclaim(table, sid, doc, {'target': 'loot'})
    db._reclaim(table, sid, doc, {'target': 'trove'})   # re-landscape
    a, b, c = _wilds(table, sid, 3)
    for n in (a, b):
        doc['position'] = n
        db._reclaim(table, sid, doc, {'target': 'loot'})
    doc['position'] = c
    db._reclaim(table, sid, doc, {'target': 'loot', 'release': node})
    assert db._effective_type(table, sid, node) == 'hazard'   # the ORIGINAL
```

- [ ] **Step 2: Run test to verify it fails**

Run: `cd infrastructure/lambda && python -m pytest tests/test_undercity_grime_gorger.py -q -k "claim or release or relandscap"`
Expected: FAIL — a fourth claim currently succeeds.

- [ ] **Step 3: Write the implementation**

In `_reclaim`, insert this block immediately **after** the `if doc.get('mulch', 0) < price:`
check and **before** `doc['mulch'] = doc.get('mulch', 0) - price`:

```python
    # Three standing claims, ever. Under this price list that cap is the only
    # thing between a wealthy hoarder and a rebuilt biome — the decision is
    # always WHERE, never how many. Re-landscaping ground you already hold does
    # not consume a fresh slot.
    held = [n for n in (doc.get('claims') or []) if n in claims]
    if not standing and len(held) >= config.RECLAIM_MAX_CLAIMS:
        release = payload.get('release')
        if release not in held:
            return _err('You already hold three claims — release one first.',
                        409, claims=held)
        table.delete_item(Key={'pk': _season_pk(sid), 'sk': f'RECLAIM#{release}'})
        doc['claims'] = [n for n in held if n != release]
```

`_err` does not take extra fields yet. Change its definition (line 241) from:

```python
def _err(msg, code=400):
    return code, {'error': msg}
```

to:

```python
def _err(msg, code=400, **extra):
    return code, {'error': msg, **extra}
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `cd infrastructure/lambda && python -m pytest tests -q`
Expected: PASS — the whole suite. `_err` is used everywhere, so run all of it.

- [ ] **Step 5: Commit**

```bash
git add infrastructure/lambda/undercity_db.py infrastructure/lambda/tests/test_undercity_grime_gorger.py
git commit -m "feat(undercity): three-claim cap with explicit release"
```

---

## Task 8: Expose Mulch, claims and reclaimed ground in state

**Files:**
- Modify: `infrastructure/lambda/undercity_db.py` (the state assembly, ~lines 2630-2680)
- Test: `infrastructure/lambda/tests/test_undercity_grime_gorger.py`

- [ ] **Step 1: Write the failing test**

Append to `tests/test_undercity_grime_gorger.py`:

```python
def test_state_exposes_bag_cap_and_mulch(table):
    sid, doc = _gorger(table)
    doc['mulch'] = 7
    db._put_player(table, doc)
    status, body = act(table, 'state')
    assert status == 200
    assert body['you']['mulch'] == 7
    assert body['you']['bagCap'] == 10


def test_state_bag_cap_is_five_for_everyone_else(table):
    _player_at(table, 'cavern_r2')
    status, body = act(table, 'state')
    assert body['you']['bagCap'] == 5


def test_reclaimed_ground_is_visible_to_other_players(table):
    sid, doc = _gorger(table)
    doc['mulch'] = 99
    node = _node_of_type(table, sid, 'wild')
    doc['position'] = node
    db._reclaim(table, sid, doc, {'target': 'loot'})
    # A DIFFERENT player's state fetch must see the changed ground, or the
    # table renders two different boards.
    status, body = act(table, 'state', user='user-blair', name='Blair')
    assert status == 200
    claim = body['season']['reclaimed'][node]
    assert claim['type'] == 'loot'
    assert claim['byName'] == 'Alex'
```

- [ ] **Step 2: Run test to verify it fails**

Run: `cd infrastructure/lambda && python -m pytest tests/test_undercity_grime_gorger.py -q -k "state or visible"`
Expected: FAIL — `KeyError: 'bagCap'`.

- [ ] **Step 3: Write the implementation**

In the state assembly, alongside the existing `excavations = {...}` line (~2633), add:

```python
    # Grime Gorger claims — every client renders the same board, so this ships
    # to everyone, not just the owner.
    reclaimed = {nid: {'type': c['type'], 'origType': c['origType'],
                       'by': c['by'], 'byName': c['byName']}
                 for nid, c in _reclaimed(table, sid).items()}
```

In the `out = {'season': {...}}` dict, add `'reclaimed': reclaimed,` to the
`season` sub-dict, after the `'devEverOn': ...` entry.

Then find where the `you` payload is built for the state response and add the
effective bag cap next to the other derived fields:

```python
    you['bagCap'] = bag_cap(doc)
```

Do the same in `_ok` (line 2904), after the existing `you['maxHp'] = ...` line, so
every action response carries it too:

```python
    you['bagCap'] = bag_cap(doc)
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `cd infrastructure/lambda && python -m pytest tests -q`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add infrastructure/lambda/undercity_db.py infrastructure/lambda/tests/test_undercity_grime_gorger.py
git commit -m "feat(undercity): ship Mulch, claims and reclaimed ground in state"
```

---

## Task 9: Client data mirrors

**Files:**
- Modify: `src/app/undercity/data/forms.ts`
- Modify: `src/app/undercity/data/species.ts`
- Create: `src/app/undercity/data/reclaim.ts`
- Modify: `src/app/undercity/services/undercity-models.ts`

- [ ] **Step 1: Add the form mirror**

In `src/app/undercity/data/forms.ts`, add to `PASSIVE_NAMES`:

```typescript
  gorge: 'Gorge',
  reclaim: 'Reclaim',
```

Add to `PASSIVE_BLURBS`:

```typescript
  gorge: 'A ten-slot gut: devour any gear or consumable for Mulch, richer the rarer it was.',
  reclaim: 'Standing on a space, spend Mulch to rewrite what that space is — up to three claims at once.',
```

Add to the `APEX` array:

```typescript
  { id: 'grime_gorger', name: 'Grime Gorger', tier: 3, passive: 'gorge', passiveName: 'Gorge',
    passives: ['gorge', 'reclaim'], bonus: { maxHp: 8, def: 2 },
    blurb: 'A refuse-elemental that eats junk and grows ground worth walking on — the only creature that edits the map.',
    from: ['brackish_trudge', 'shambling_shell', 'woodwraith_strangler'] },
```

- [ ] **Step 2: Add the sprite mapping**

In `src/app/undercity/data/species.ts`, add to `FORM_SPRITES` beside the other apexes:

```typescript
  grime_gorger: { sprite: 'grime_gorger', regions: MASK_REGIONS, scale: 1.3 },
```

- [ ] **Step 3: Create the reclaim mirror**

Create `src/app/undercity/data/reclaim.ts`:

```typescript
/**
 * Display mirror of the Grime Gorger's Reclaim tables (undercity_config.py is
 * the source of truth). The governing rule: a player may change what a space
 * DOES, never what the map IS — so topology (gates, warps, ladders, tunnels,
 * barriers) and unique landmarks (vault, shrine, witch, ossuary, boss) appear
 * in neither list.
 */

/** Mulch price of creating each space type. */
export const RECLAIM_PRICES: Record<string, number> = {
  wild: 4, mystery: 6, loot: 10, elite: 12, cache: 14,
  rest: 18, crystal_vein: 24, excavation: 24, trove: 30, shop: 60,
};

/** Space types that may be overwritten. `hazard` is here but NOT in the price
 *  list: the Gorger eats filth, it does not spread it. */
export const RECLAIM_SOURCES: ReadonlySet<string> = new Set([
  'wild', 'hazard', 'fog', 'loot', 'mystery', 'cache', 'trove', 'rest', 'elite',
]);

/** Buildable only outside the depths — a descent's tension is committing
 *  without resupply, and rest nodes are one full heal each per descent. */
export const RECLAIM_SURFACE_ONLY: ReadonlySet<string> = new Set(['rest', 'shop']);

export const RECLAIM_MAX_CLAIMS = 3;

export const RECLAIM_LABELS: Record<string, string> = {
  wild: 'Vermin Den', mystery: 'Strange Ground', loot: 'Forage Ground',
  elite: 'Predator Ground', cache: 'Hollow Cache', rest: 'Rest Alcove',
  crystal_vein: 'Crystal Vein', excavation: 'Dig Site', trove: 'Hidden Trove',
  shop: 'Bazaar Post',
};

/** Mulch yielded by devouring an item, by kind and rarity tier (1-4). */
export const GORGE_MULCH: Record<'gear' | 'consumable', Record<number, number>> = {
  gear: { 1: 2, 2: 4, 3: 6, 4: 8 },
  consumable: { 1: 1, 2: 2, 3: 3, 4: 4 },
};
```

- [ ] **Step 4: Extend the models**

In `src/app/undercity/services/undercity-models.ts`, add these fields to the
player/`you` interface (the one carrying `spores`, `bag`, `gearStash`):

```typescript
  /** Grime Gorger currency — junk devoured into board-editing fuel. */
  mulch?: number;
  /** Effective consumable-bag ceiling; 10 for a Grime Gorger, else 5. */
  bagCap?: number;
  /** Node ids this player currently holds as reclaimed ground (max 3). */
  claims?: string[];
```

Add a claim interface and hang it off the season state interface:

```typescript
export interface ReclaimedNode {
  type: string;
  origType: string;
  by: string;
  byName: string;
}
```

```typescript
  /** Every standing Grime Gorger claim, keyed by node id — the whole table
   *  renders the same board. */
  reclaimed?: Record<string, ReclaimedNode>;
}
```

- [ ] **Step 5: Verify the build**

Run: `npm run build`
Expected: build succeeds with no TypeScript errors.

- [ ] **Step 6: Commit**

```bash
git add src/app/undercity/data/forms.ts src/app/undercity/data/species.ts src/app/undercity/data/reclaim.ts src/app/undercity/services/undercity-models.ts
git commit -m "feat(undercity): client mirrors for the Grime Gorger"
```

---

## Task 10: Gorge UI on the creature tab

**Files:**
- Modify: `src/app/undercity/tabs/creature-tab.component.ts`
- Modify: `src/app/undercity/tabs/creature-tab.component.html`
- Modify: `src/app/undercity/tabs/creature-tab.component.scss`

**Idiom note — this codebase does NOT use `this.you` or RxJS in these components.**
Player state is a signal read as `this.store.you()`, and actions are awaited:
`const resp = await this.store.action('gorge', {...})`. Derived values are
`protected readonly x = computed(() => ...)`. Follow that or the build fails.

- [ ] **Step 1: Add the component logic**

In `creature-tab.component.ts`, add the import:

```typescript
import { GORGE_MULCH } from '../data/reclaim';
```

Then add these members alongside the other `computed` members (near the pet
getters around line 300):

```typescript
  /** True when this creature can devour items at all. */
  protected readonly canGorge = computed(() =>
    (this.store.you()?.passives ?? []).includes('gorge'));

  protected readonly mulch = computed(() => this.store.you()?.mulch ?? 0);
  protected readonly gorgeGear = computed(() => this.store.you()?.gearStash ?? []);
  protected readonly gorgeBag = computed(() => this.store.you()?.bag ?? []);

  /** Mulch a given stash/bag slot would yield if devoured. */
  protected gorgeYield(kind: 'gear' | 'consumable', itemId: string): number {
    const tier = kind === 'gear'
      ? (GEAR[itemId]?.tier ?? 1)
      : (CONSUMABLES[itemId]?.tier ?? 1);
    return GORGE_MULCH[kind][tier] ?? 0;
  }

  protected async gorge(kind: 'gear' | 'consumable', index: number): Promise<void> {
    await this.store.action('gorge', { kind, index });
  }
```

`GEAR` and `CONSUMABLES` are already imported by this component for item display
— reuse those imports rather than adding a second source. If the component reads
item names through a helper instead, use that helper in Step 2's template.

- [ ] **Step 2: Add the template**

In `creature-tab.component.html`, add this block inside the inventory section,
guarded so it is invisible to every other form:

```html
@if (canGorge()) {
  <section class="gorge">
    <h3>
      <span class="uc-icon">compost</span> Gorge
      <span class="mulch">{{ mulch() }} Mulch</span>
    </h3>
    <p class="hint">Devour junk for Mulch, then spend it on the board to rewrite a space.</p>
    @for (gid of gorgeGear(); track $index) {
      <button class="gorge-row" (click)="gorge('gear', $index)">
        <span>{{ GEAR[gid].name }}</span>
        <span class="yield">+{{ gorgeYield('gear', gid) }}</span>
      </button>
    }
    @for (cid of gorgeBag(); track $index) {
      <button class="gorge-row" (click)="gorge('consumable', $index)">
        <span>{{ CONSUMABLES[cid].name }}</span>
        <span class="yield">+{{ gorgeYield('consumable', cid) }}</span>
      </button>
    }
  </section>
}
```

For `GEAR[gid].name` to bind, the component must expose those tables to the
template (`protected readonly GEAR = GEAR;`). If it already exposes name helpers
instead, call those and skip the exposure.

- [ ] **Step 3: Style it**

In `creature-tab.component.scss`, add styles using the existing design tokens
from `STYLE_GUIDE.md` — reuse `--primary-color` / `--accent-color` and the
established breakpoint scale; do not invent new colours:

```scss
.gorge {
  .mulch { color: var(--accent-color); font-weight: 600; margin-left: auto; }
  .hint { opacity: 0.75; font-size: 0.85rem; }
  .gorge-row {
    display: flex; justify-content: space-between; width: 100%;
    .yield { color: var(--accent-color); }
  }
}
```

- [ ] **Step 4: Verify the build**

Run: `npm run build`
Expected: build succeeds.

- [ ] **Step 5: Commit**

```bash
git add src/app/undercity/tabs/creature-tab.component.ts src/app/undercity/tabs/creature-tab.component.html src/app/undercity/tabs/creature-tab.component.scss
git commit -m "feat(undercity): Gorge feeding UI on the creature tab"
```

---

## Task 11: Reclaim modal on the board tab

**Files:**
- Modify: `src/app/undercity/tabs/board-tab.component.ts`
- Modify: `src/app/undercity/tabs/board-tab.component.html`

**Idiom note.** `board-tab.component.ts` already has
`protected readonly nodeType = computed(...)` at line 1438, which resolves the
type of **the player's current position** (not an arbitrary node id) via
`this.map?.nodes.find((n) => n.id === pos)?.type`. Reuse it; do not add a
`nodeType(nodeId)` overload. Actions are awaited through `this.store.action(...)`,
and signals are read with call syntax (`this.store.you()`).

- [ ] **Step 1: Add the component logic**

In `board-tab.component.ts`, add the import:

```typescript
import {
  RECLAIM_PRICES, RECLAIM_SOURCES, RECLAIM_SURFACE_ONLY,
  RECLAIM_LABELS, RECLAIM_MAX_CLAIMS,
} from '../data/reclaim';
```

Then add these members near the other modal state:

```typescript
  protected readonly reclaimOpen = signal(false);
  protected readonly pendingRelease = signal<string | null>(null);

  protected readonly reclaimTargets = Object.keys(RECLAIM_PRICES);
  protected readonly priceOf = (t: string) => RECLAIM_PRICES[t];
  protected readonly labelOf = (t: string) => RECLAIM_LABELS[t] ?? t;

  protected readonly canReclaim = computed(() =>
    (this.store.you()?.passives ?? []).includes('reclaim'));

  protected readonly mulch = computed(() => this.store.you()?.mulch ?? 0);
  protected readonly myClaims = computed(() => this.store.you()?.claims ?? []);

  /** What the space under this player currently does — the claim override if one
   *  stands, else the map's own type (nodeType already resolves the position). */
  protected readonly standingType = computed(() => {
    const pos = this.store.you()?.position ?? '';
    return this.store.season()?.reclaimed?.[pos]?.type ?? this.nodeType() ?? '';
  });

  /** True once three claims stand and this space is not one of them — the server
   *  409s and asks which to release, so the UI collects that choice up front. */
  protected readonly needsRelease = computed(() => {
    const held = this.myClaims();
    return held.length >= RECLAIM_MAX_CLAIMS
      && !held.includes(this.store.you()?.position ?? '');
  });

  /** Null when this target is buildable here; otherwise the reason it is not.
   *  Mirrors the server's validation order so the UI never offers a doomed buy. */
  protected reclaimBlocker(target: string): string | null {
    const you = this.store.you();
    const pos = you?.position ?? '';
    const claim = this.store.season()?.reclaimed?.[pos];
    const standing = this.standingType();
    if (claim && claim.by !== you?.userId) return 'Another Gorger holds this ground';
    if (!claim && !RECLAIM_SOURCES.has(standing)) return 'This ground will not take a change';
    if (target === standing) return 'Already exactly that';
    if (RECLAIM_SURFACE_ONLY.has(target)
        && this.map?.nodes.find((n) => n.id === pos)?.region === 'depths') {
      return 'Surface only';
    }
    if (this.mulch() < RECLAIM_PRICES[target]) return 'Not enough Mulch';
    return null;
  }

  protected async reclaim(target: string): Promise<void> {
    const release = this.pendingRelease();
    await this.store.action('reclaim', release ? { target, release } : { target });
    this.reclaimOpen.set(false);
    this.pendingRelease.set(null);
  }
```

`signal` and `computed` are already imported in this file; if `signal` is not,
add it to the existing `@angular/core` import.

- [ ] **Step 2: Add the template**

In `board-tab.component.html`, add the trigger where the space's other actions
live, plus the modal:

```html
@if (canReclaim()) {
  <button class="action reclaim-open" (click)="reclaimOpen.set(true)">
    <span class="uc-icon">compost</span> Reclaim this ground
    <span class="mulch">{{ mulch() }} Mulch</span>
  </button>
}

@if (reclaimOpen()) {
  <div class="modal reclaim-modal">
    <h2>Work the ground</h2>
    <p class="standing">Currently: {{ labelOf(standingType()) }}</p>
    @if (needsRelease()) {
      <p class="warn">You hold three claims. Choose one to let collapse:</p>
      @for (node of myClaims(); track node) {
        <button class="release-row" (click)="pendingRelease.set(node)">
          {{ node }}
          @if (pendingRelease() === node) { <span class="uc-icon">check</span> }
        </button>
      }
    }
    @for (t of reclaimTargets; track t) {
      <button class="reclaim-row"
              [disabled]="!!reclaimBlocker(t) || (needsRelease() && !pendingRelease())"
              (click)="reclaim(t)">
        <span>{{ labelOf(t) }}</span>
        <span class="price">{{ priceOf(t) }} Mulch</span>
        @if (reclaimBlocker(t)) { <span class="why">{{ reclaimBlocker(t) }}</span> }
      </button>
    }
    <button class="close" (click)="reclaimOpen.set(false)">Close</button>
  </div>
}
```

- [ ] **Step 3: Verify the build**

Run: `npm run build`
Expected: build succeeds.

- [ ] **Step 4: Commit**

```bash
git add src/app/undercity/tabs/board-tab.component.ts src/app/undercity/tabs/board-tab.component.html
git commit -m "feat(undercity): Reclaim modal on the board tab"
```

---

## Task 12: Render reclaimed ground on the board

**Files:**
- Modify: `src/app/undercity/engine/board-canvas.ts`

- [ ] **Step 1: Draw claims as their effective type**

Find where `board-canvas.ts` picks a node's icon/colour from `node.type`. Route
that through the claim override, and add a cultivated marker so the change is
legible to the whole table:

```typescript
  /** A reclaimed node draws as what it has BECOME, plus a cultivated ring so
   *  everyone can see the Gorger has worked it. */
  private effectiveType(node: { id: string; type: string }): string {
    return this.reclaimed?.[node.id]?.type ?? node.type;
  }
```

Add a `reclaimed: Record<string, { type: string; byName: string }> = {}` input
alongside the canvas's other state, set from `season.reclaimed`, and use
`this.effectiveType(node)` everywhere the renderer currently reads `node.type`.

After the node is drawn, stroke the marker using the existing palette:

```typescript
    if (this.reclaimed?.[node.id]) {
      ctx.save();
      ctx.strokeStyle = 'rgba(154, 205, 50, 0.9)';   // Golgari green, per STYLE_GUIDE
      ctx.lineWidth = 2;
      ctx.setLineDash([3, 3]);
      ctx.beginPath();
      ctx.arc(x, y, radius + 4, 0, Math.PI * 2);
      ctx.stroke();
      ctx.restore();
    }
```

- [ ] **Step 2: Show the owner in the tooltip**

Where the canvas builds a node tooltip/label, append the owner when a claim
stands:

```typescript
    const claim = this.reclaimed?.[node.id];
    if (claim) label += ` · reclaimed by ${claim.byName}`;
```

- [ ] **Step 3: Verify the build**

Run: `npm run build`
Expected: build succeeds.

- [ ] **Step 4: Commit**

```bash
git add src/app/undercity/engine/board-canvas.ts
git commit -m "feat(undercity): render reclaimed ground on the board canvas"
```

---

## Task 13: Retire the hardcoded bag cap

**Files:**
- Modify: `src/app/undercity/tabs/plaza-tab.component.ts:356`

- [ ] **Step 1: Use the server's cap**

Replace:

```typescript
    const cap = l.kind === 'consumable' ? 5 : 6; // BAG_SIZE=5; gearStash/scrolls=6
```

with:

```typescript
    // Bag capacity is per-creature now (a Grime Gorger's Gorge doubles it), so
    // take it from the server rather than restating a constant here.
    const cap = l.kind === 'consumable' ? (this.store.you()?.bagCap ?? 5) : 6;
```

Player state in these components is the `this.store.you()` signal, not a plain
field — read it with call syntax as above.

- [ ] **Step 2: Verify the build**

Run: `npm run build`
Expected: build succeeds.

- [ ] **Step 3: Run the full server suite one last time**

Run: `cd infrastructure/lambda && python -m pytest tests -q`
Expected: PASS — everything, including the untouched
`tests/test_undercity_signatures.py` invariants.

- [ ] **Step 4: Commit**

```bash
git add src/app/undercity/tabs/plaza-tab.component.ts
git commit -m "feat(undercity): read the bag cap from the server"
```

---

## Done criteria

- `cd infrastructure/lambda && python -m pytest tests -q` is green, including
  `test_undercity_signatures.py` unchanged.
- `npm run build` succeeds.
- A tier-2 `brackish_trudge` at level 10 can evolve into the Grime Gorger and
  comes out with both `gorge` and `reclaim`.
- That Gorger can devour junk, see Mulch rise, stand on a wild space, buy a
  Forage Ground, and a second player's state fetch shows the changed board.
- A deploy is required for any of this to reach the live game; the user runs it.
