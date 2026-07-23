# First-Conqueror Name-Plates & Plundered Treasure — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Show the season-global first conqueror of each Undercity lair (at its gate), Savra (at the boss node), and each treasure tile (trove/cache/vault), and give looted treasure tiles a "plundered" sprite plus a reduced haul for later players.

**Architecture:** A new per-landmark season record (`FIRST#<node>`) is stamped once via a race-safe conditional put, delivered to the client as `state.firsts`. The board renders name-plates and swaps the `treasure_hoard` sprite for its `_plundered` variant off that data. Treasure loot is scaled by a single `PLUNDERED_LOOT_MULT` for non-first visitors.

**Tech Stack:** Python 3.11 Lambda (`infrastructure/lambda/`), pytest (in-memory FakeTable), Angular 20 standalone + canvas board engine (`src/app/undercity/`).

Spec: [specs/2026-07-23-undercity-first-conqueror-plates-design.md](2026-07-23-undercity-first-conqueror-plates-design.md)

---

## File structure

**Server (`infrastructure/lambda/`):**
- `undercity_config.py` — add `PLUNDERED_LOOT_MULT` scalar.
- `undercity_db.py` — add `_claim_first`; scale-aware `_append_treasure_gear`; rewrite `_trove`/`_cache`/`_vault`; hook `_finish_lair`/`_finish_boss`; add `FIRST#` query + `out['firsts']` in `handle_state`; pass `node` to `_vault`.
- `tests/test_first_conqueror.py` — new test module.

**Client (`src/app/undercity/`):**
- `services/undercity-models.ts` — add `firsts` to `GameState`.
- `services/undercity-state.service.ts` — add `firsts` computed signal.
- `engine/board-canvas.ts` — load treasure sprites, `setFirsts`, `drawTreasureHoard`, `drawNamePlate`, wire into `drawSpace`.
- `engine/board-terrain.ts` — drop `vault`/`cache` from `LANDMARK_TYPES`.
- `tabs/board-tab.component.ts` — call `this.board.setFirsts(...)` in the board sync.

---

## Task 1: Add the loot multiplier config

**Files:**
- Modify: `infrastructure/lambda/undercity_config.py`

- [ ] **Step 1: Add the constant**

Add near the other economy scalars (e.g. just after the roll/HP block, around line 46):

```python
# A treasure tile (trove/cache/vault) already plundered by its season-global
# first conqueror yields this fraction of spores/XP — and half its gear CHANCE —
# to every later first-time visitor. The first conqueror always gets the full haul.
PLUNDERED_LOOT_MULT = 0.5
```

- [ ] **Step 2: Verify it imports**

Run: `cd infrastructure/lambda && python -c "import undercity_config as c; print(c.PLUNDERED_LOOT_MULT)"`
Expected: `0.5`

- [ ] **Step 3: Commit**

```bash
git add infrastructure/lambda/undercity_config.py
git commit -m "feat(undercity): PLUNDERED_LOOT_MULT tunable"
```

---

## Task 2: `_claim_first` helper (race-safe first-conqueror record)

**Files:**
- Modify: `infrastructure/lambda/undercity_db.py` (add helper near `_event`, ~line 217)
- Test: `infrastructure/lambda/tests/test_first_conqueror.py` (new)

- [ ] **Step 1: Write the failing test**

Create `infrastructure/lambda/tests/test_first_conqueror.py`:

```python
import undercity_data as data
import undercity_db as db

from tests.test_undercity_db import table  # noqa: F401  (pytest fixture)


def test_claim_first_is_idempotent(table):
    sid = 'S'
    alice = {'userId': 'u1', 'username': 'Alice'}
    bob = {'userId': 'u2', 'username': 'Bob'}
    assert db._claim_first(table, sid, 'city_lair', 'lair', alice) is True
    assert db._claim_first(table, sid, 'city_lair', 'lair', bob) is False
    rec = db._get(table, db._season_pk(sid), 'FIRST#city_lair')
    assert rec['by'] == 'Alice'
    assert rec['uid'] == 'u1'
    assert rec['kind'] == 'lair'
```

- [ ] **Step 2: Run test to verify it fails**

Run: `cd infrastructure/lambda && python -m pytest tests/test_first_conqueror.py -q`
Expected: FAIL with `AttributeError: module 'undercity_db' has no attribute '_claim_first'`

- [ ] **Step 3: Implement the helper**

Add to `undercity_db.py` immediately after the `_event` function (after ~line 217):

```python
def _claim_first(table, sid, node, kind, doc):
    """Idempotently stamp the season-global first conqueror of a landmark.
    Returns True iff THIS call won the race (this player is the global first).
    Race-safe: the conditional put lets exactly one concurrent writer win."""
    try:
        table.put_item(
            Item={'pk': _season_pk(sid), 'sk': f'FIRST#{node}',
                  'by': doc['username'], 'uid': doc['userId'],
                  'at': _now(), 'kind': kind},
            ConditionExpression='attribute_not_exists(sk)')
        return True
    except ClientError as e:
        if e.response['Error']['Code'] == 'ConditionalCheckFailedException':
            return False
        raise
```

- [ ] **Step 4: Run test to verify it passes**

Run: `cd infrastructure/lambda && python -m pytest tests/test_first_conqueror.py -q`
Expected: PASS

- [ ] **Step 5: Commit**

```bash
git add infrastructure/lambda/undercity_db.py infrastructure/lambda/tests/test_first_conqueror.py
git commit -m "feat(undercity): _claim_first race-safe landmark first-conqueror record"
```

---

## Task 3: Scale-aware treasure gear helper

**Files:**
- Modify: `infrastructure/lambda/undercity_db.py` (`_append_treasure_gear`, ~line 3335)

- [ ] **Step 1: Add a chance multiplier parameter**

Replace the existing `_append_treasure_gear`:

```python
def _append_treasure_gear(doc, out, chance_mult=1.0):
    """Big-ticket treasure spaces roll for a high-tier gear drop.
    `chance_mult` thins the roll for already-plundered tiles."""
    chance, tiers = data.GEAR_DROP['treasure']
    if _rng.random() < chance * chance_mult:
        drop = _roll_gear_drop(doc, tiers)
        if drop:
            out['gear'] = drop
            out['text'] += (' A piece of gear gleams among the hoard — '
                            + _drop_phrase(drop) + '.')
```

- [ ] **Step 2: Verify existing callers still pass (default is unchanged behavior)**

Run: `cd infrastructure/lambda && python -m pytest tests -q`
Expected: PASS (the default `chance_mult=1.0` preserves current behavior; `_cache`/`_vault` still call it positionally)

- [ ] **Step 3: Commit**

```bash
git add infrastructure/lambda/undercity_db.py
git commit -m "feat(undercity): _append_treasure_gear accepts a chance multiplier"
```

---

## Task 4: Trove — first-conqueror + plundered haul

**Files:**
- Modify: `infrastructure/lambda/undercity_db.py` (`_trove`, ~line 3450)
- Test: `infrastructure/lambda/tests/test_first_conqueror.py`

- [ ] **Step 1: Write the failing test**

Append to `tests/test_first_conqueror.py`:

```python
def _no_gear(monkeypatch):
    # random() high => no plundered-tile gear coin-flip; choices/choice unused here.
    monkeypatch.setattr(db._rng, 'random', lambda: 0.99)
    monkeypatch.setattr(db._rng, 'choices', lambda seq, weights=None, k=1: [seq[0]])
    monkeypatch.setattr(db._rng, 'choice', lambda seq: seq[0])


def test_trove_first_full_later_reduced_then_empty(table, monkeypatch):
    _no_gear(monkeypatch)
    sid = 'S'
    alice = {'userId': 'u1', 'username': 'Alice', 'spores': 0}
    bob = {'userId': 'u2', 'username': 'Bob', 'spores': 0}
    full = data.TROVE_REWARD['spores']

    r1 = db._trove(table, sid, alice, 'city_trove')
    assert r1['spores'] == full                                   # first: full

    r2 = db._trove(table, sid, bob, 'city_trove')
    assert r2['spores'] == int(full * data.PLUNDERED_LOOT_MULT)   # later: half

    r3 = db._trove(table, sid, alice, 'city_trove')
    assert 'spores' not in r3                                     # repeat: nothing

    rec = db._get(table, db._season_pk(sid), 'FIRST#city_trove')
    assert rec['by'] == 'Alice' and rec['kind'] == 'trove'
```

- [ ] **Step 2: Run test to verify it fails**

Run: `cd infrastructure/lambda && python -m pytest tests/test_first_conqueror.py::test_trove_first_full_later_reduced_then_empty -q`
Expected: FAIL (later player currently also gets full `spores`, and no `FIRST#city_trove` record exists)

- [ ] **Step 3: Rewrite `_trove`**

Replace the existing `_trove`:

```python
def _trove(table, sid, doc, node):
    """Hidden dungeon strongroom: fat spores + XP + a guaranteed gear drop for the
    season-global first conqueror; later first-time visitors pick through a
    plundered strongroom for a reduced haul. First visit per player."""
    claims = doc.setdefault('poiClaims', [])
    key = f'trove:{node}'
    if key in claims:
        return {'type': 'trove',
                'text': 'The strongroom hangs open and empty — your work, last time.'}
    claims.append(key)
    is_first = _claim_first(table, sid, node, 'trove', doc)
    mult = 1.0 if is_first else data.PLUNDERED_LOOT_MULT
    r = data.TROVE_REWARD
    spores = int(r['spores'] * mult)
    doc['spores'] = doc.get('spores', 0) + spores
    _grant_xp(table, sid, doc, int(r['xp'] * mult))
    if is_first:
        text = f"A sealed strongroom cracks open — +{spores} Spores!"
    else:
        text = f"You pick through a plundered strongroom — +{spores} Spores."
    out = {'type': 'trove', 'spores': spores, 'text': text}
    # First conqueror: guaranteed relic. Later players: a coin-flip at the mult.
    if is_first or _rng.random() < data.PLUNDERED_LOOT_MULT:
        drop = _roll_gear_drop(doc, data.TROVE_GEAR_TIERS)
        if drop:
            out['gear'] = drop
            out['text'] += f" A glimmering relic within — {_drop_phrase(drop)}!"
    if is_first:
        _event(table, sid, 'trove',
               f"{doc['username']} was first to crack a hidden trove in the deep dark!",
               actor=doc['userId'])
    return out
```

- [ ] **Step 4: Run test to verify it passes**

Run: `cd infrastructure/lambda && python -m pytest tests/test_first_conqueror.py -q`
Expected: PASS

- [ ] **Step 5: Commit**

```bash
git add infrastructure/lambda/undercity_db.py infrastructure/lambda/tests/test_first_conqueror.py
git commit -m "feat(undercity): trove first-conqueror record + plundered haul"
```

---

## Task 5: Cache — first-conqueror + plundered haul

**Files:**
- Modify: `infrastructure/lambda/undercity_db.py` (`_cache`, ~line 3491)
- Test: `infrastructure/lambda/tests/test_first_conqueror.py`

- [ ] **Step 1: Write the failing test**

Append to `tests/test_first_conqueror.py`:

```python
def test_cache_first_full_later_reduced(table, monkeypatch):
    _no_gear(monkeypatch)
    sid = 'S'
    alice = {'userId': 'u1', 'username': 'Alice', 'spores': 0}
    bob = {'userId': 'u2', 'username': 'Bob', 'spores': 0}
    full = data.CACHE_REWARD['spores']

    r1 = db._cache(table, sid, alice, 'city_cache')
    assert r1['spores'] == full

    r2 = db._cache(table, sid, bob, 'city_cache')
    assert r2['spores'] == int(full * data.PLUNDERED_LOOT_MULT)

    rec = db._get(table, db._season_pk(sid), 'FIRST#city_cache')
    assert rec['by'] == 'Alice' and rec['kind'] == 'cache'
```

- [ ] **Step 2: Run test to verify it fails**

Run: `cd infrastructure/lambda && python -m pytest tests/test_first_conqueror.py::test_cache_first_full_later_reduced -q`
Expected: FAIL (later player gets full spores; no `FIRST#city_cache`)

- [ ] **Step 3: Rewrite `_cache`**

Replace the existing `_cache`:

```python
def _cache(table, sid, doc, node):
    """One treasure per dungeon, first visit per player (mini-vault). The
    season-global first conqueror gets the full haul; later players get a
    plundered fraction."""
    claims = doc.setdefault('poiClaims', [])
    key = f'cache:{node}'
    if key in claims:
        return {'type': 'cache', 'text': 'The hollow stands empty — you plundered it already.'}
    claims.append(key)
    is_first = _claim_first(table, sid, node, 'cache', doc)
    mult = 1.0 if is_first else data.PLUNDERED_LOOT_MULT
    r = data.CACHE_REWARD
    spores = int(r['spores'] * mult)
    doc['spores'] = doc.get('spores', 0) + spores
    _grant_xp(table, sid, doc, int(r['xp'] * mult))
    biome = data.dungeon_biome(node)
    dname = data.DUNGEONS[biome]['name'] if biome else 'the depths'
    if is_first:
        _event(table, sid, 'cache',
               f"{doc['username']} was first to plunder the treasure of {dname}!",
               actor=doc['userId'])
        text = f"A hidden trove! +{spores} Spores."
    else:
        text = f"Picked-over spoils remain — +{spores} Spores."
    out = {'type': 'cache', 'spores': spores, 'text': text}
    _append_treasure_gear(doc, out, mult)
    return out
```

- [ ] **Step 4: Run test to verify it passes**

Run: `cd infrastructure/lambda && python -m pytest tests/test_first_conqueror.py -q`
Expected: PASS

- [ ] **Step 5: Commit**

```bash
git add infrastructure/lambda/undercity_db.py infrastructure/lambda/tests/test_first_conqueror.py
git commit -m "feat(undercity): cache first-conqueror record + plundered haul"
```

---

## Task 6: Vault — first-conqueror + plundered haul + node param

**Files:**
- Modify: `infrastructure/lambda/undercity_db.py` (`_vault` ~line 3433, and its dispatch ~line 2483)
- Test: `infrastructure/lambda/tests/test_first_conqueror.py`

- [ ] **Step 1: Write the failing test**

Append to `tests/test_first_conqueror.py`:

```python
def test_vault_first_full_later_reduced(table, monkeypatch):
    _no_gear(monkeypatch)
    sid = 'S'
    alice = {'userId': 'u1', 'username': 'Alice', 'spores': 0}
    bob = {'userId': 'u2', 'username': 'Bob', 'spores': 0}
    full = data.VAULT_REWARD['spores']

    r1 = db._vault(table, sid, alice, 'vault')
    assert r1['spores'] == full

    r2 = db._vault(table, sid, bob, 'vault')
    assert r2['spores'] == int(full * data.PLUNDERED_LOOT_MULT)

    rec = db._get(table, db._season_pk(sid), 'FIRST#vault')
    assert rec['by'] == 'Alice' and rec['kind'] == 'vault'
```

- [ ] **Step 2: Run test to verify it fails**

Run: `cd infrastructure/lambda && python -m pytest tests/test_first_conqueror.py::test_vault_first_full_later_reduced -q`
Expected: FAIL with `TypeError: _vault() takes 3 positional arguments but 4 were given`

- [ ] **Step 3: Rewrite `_vault` and update its dispatch**

Replace the existing `_vault`:

```python
def _vault(table, sid, doc, node):
    claims = doc.setdefault('poiClaims', [])
    if 'vault' in claims:
        return {'type': 'vault',
                'text': 'The vault stands looted bare — by you, last time.'}
    claims.append('vault')
    is_first = _claim_first(table, sid, node, 'vault', doc)
    mult = 1.0 if is_first else data.PLUNDERED_LOOT_MULT
    r = data.VAULT_REWARD
    spores = int(r['spores'] * mult)
    doc['spores'] = doc.get('spores', 0) + spores
    _grant_xp(table, sid, doc, int(r['xp'] * mult))
    if is_first:
        _event(table, sid, 'vault',
               f"{doc['username']} was first to plunder the Sunken Vault!",
               actor=doc['userId'])
        text = f"The hoard of the Erstwhile! +{spores} Spores."
    else:
        text = f"You glean the dregs of the Sunken Vault — +{spores} Spores."
    out = {'type': 'vault', 'spores': spores, 'text': text}
    _append_treasure_gear(doc, out, mult)
    return out
```

Then update the landing dispatch (currently `return _vault(table, sid, doc)` at ~line 2483):

```python
    if ntype == 'vault':
        return _vault(table, sid, doc, node)
```

- [ ] **Step 4: Run test to verify it passes**

Run: `cd infrastructure/lambda && python -m pytest tests/test_first_conqueror.py -q`
Expected: PASS

- [ ] **Step 5: Commit**

```bash
git add infrastructure/lambda/undercity_db.py infrastructure/lambda/tests/test_first_conqueror.py
git commit -m "feat(undercity): vault first-conqueror record + plundered haul"
```

---

## Task 7: Lair & Savra first-kill records

**Files:**
- Modify: `infrastructure/lambda/undercity_db.py` (`_finish_lair` ~line 3188, `_finish_boss` ~line 3358)

Loot for lairs/Savra is unchanged; we only stamp the plate record.

- [ ] **Step 1: Hook the lair first-kill**

In `_finish_lair`, inside the `if not slain:` block (right after the
`_spawn_world_event(table, sid, actor_id=doc['userId'])` call), add:

```python
            # Season-global first kill of THIS lair — stamp the gate name-plate.
            _claim_first(table, sid, node, 'lair', doc)
```

- [ ] **Step 2: Hook the Savra first-kill**

In `_finish_boss`, inside the `if result['outcome'] == 'attacker':` block (right
after `_set_boss_hp(table, sid, boss['hp'])`), add:

```python
        _claim_first(table, sid, node, 'boss', doc)
```

- [ ] **Step 3: Write the test**

Append to `tests/test_first_conqueror.py`:

```python
def test_finish_lair_stamps_first(table, monkeypatch):
    monkeypatch.setattr(db._rng, 'random', lambda: 0.99)  # suppress lair gear roll
    monkeypatch.setattr(db._rng, 'choices', lambda seq, weights=None, k=1: [seq[0]])
    monkeypatch.setattr(db._rng, 'choice', lambda seq: seq[0])
    sid = 'S'
    doc = {'userId': 'u1', 'username': 'Alice', 'spores': 0, 'poiClaims': []}
    rec_battle = {'node': 'city_lair', 'ctx': {'slain': False, 'vestMax': 10},
                  'npcMeta': {'name': 'Ishkanah, Grafwidow'}, 'npc': {'maxHp': 40}}
    result = {'outcome': 'attacker', 'defenderHp': 0}
    db._finish_lair(table, sid, doc, rec_battle, result)
    rec = db._get(table, db._season_pk(sid), 'FIRST#city_lair')
    assert rec['by'] == 'Alice' and rec['kind'] == 'lair'
```

- [ ] **Step 4: Run the test to verify it passes**

Run: `cd infrastructure/lambda && python -m pytest tests/test_first_conqueror.py -q`
Expected: PASS

(If `_finish_lair` needs additional `ctx`/`npcMeta` keys that this stub omits, read
`_finish_lair` at `undercity_db.py:3178` and add the missing keys to `rec_battle` so
it reaches the `if not slain:` branch — do NOT change production code to fit the test.)

- [ ] **Step 5: Commit**

```bash
git add infrastructure/lambda/undercity_db.py infrastructure/lambda/tests/test_first_conqueror.py
git commit -m "feat(undercity): stamp first-conqueror on lair & Savra kills"
```

---

## Task 8: Deliver `firsts` in `handle_state`

**Files:**
- Modify: `infrastructure/lambda/undercity_db.py` (`handle_state`, add query ~after line 1127; add to `out` ~line 1219)
- Test: `infrastructure/lambda/tests/test_first_conqueror.py`

- [ ] **Step 1: Add the `FIRST#` query**

In `handle_state`, after the `market` query/parse block (ends ~line 1127, before
`players, you, snares, ... = ...`), add:

```python
    fr = table.query(
        KeyConditionExpression='pk = :pk AND begins_with(sk, :sk)',
        ExpressionAttributeValues={':pk': pk, ':sk': 'FIRST#'})
    firsts = {i['sk'].replace('FIRST#', ''):
              {'by': i.get('by'), 'at': i.get('at'), 'kind': i.get('kind')}
              for i in (_clean(x) for x in fr['Items'])}
```

- [ ] **Step 2: Surface it in the response**

In the `out = { ... }` dict (~line 1204), add a `firsts` key alongside `boss`:

```python
        'firsts': firsts,
```

- [ ] **Step 3: Write the test**

Append to `tests/test_first_conqueror.py`:

```python
def test_firsts_surfaced_in_state(table):
    act(table, 'join', starter='pest')          # creates an active season + player
    sid = _sid(table)
    doc = {'userId': 'x', 'username': 'Zed'}
    db._claim_first(table, sid, 'bog_lair', 'lair', doc)
    status, out = db.handle_state(table, {'userId': 'user-alex'})
    assert status == 200
    assert out['firsts']['bog_lair']['by'] == 'Zed'
    assert out['firsts']['bog_lair']['kind'] == 'lair'
```

Add `act, _sid` to the imports at the top of the test file:

```python
from tests.test_undercity_db import table, act, _sid  # noqa: F401
```

- [ ] **Step 4: Run the full suite to verify green**

Run: `cd infrastructure/lambda && python -m pytest tests -q`
Expected: PASS (all tests, including the map-sync guard)

- [ ] **Step 5: Commit**

```bash
git add infrastructure/lambda/undercity_db.py infrastructure/lambda/tests/test_first_conqueror.py
git commit -m "feat(undercity): deliver firsts map in game state"
```

---

## Task 9: Client model + store signal for `firsts`

**Files:**
- Modify: `src/app/undercity/services/undercity-models.ts` (`GameState`, ~line 261)
- Modify: `src/app/undercity/services/undercity-state.service.ts` (~line 71)

- [ ] **Step 1: Add the field to `GameState`**

In `undercity-models.ts`, inside `interface GameState`, add after the `boss` field
(~line 261):

```typescript
  /** Landmark node id -> its season-global first conqueror.
   *  `kind` is 'lair' | 'boss' | 'trove' | 'cache' | 'vault'. */
  firsts?: Record<string, { by: string; at?: string; kind: string }>;
```

- [ ] **Step 2: Add the store signal**

In `undercity-state.service.ts`, after the `guardians` computed (~line 71), add:

```typescript
  readonly firsts = computed(() => this._state()?.firsts ?? {});
```

- [ ] **Step 3: Verify it type-checks**

Run: `npm run build`
Expected: build succeeds (no TS errors from the new field/signal)

- [ ] **Step 4: Commit**

```bash
git add src/app/undercity/services/undercity-models.ts src/app/undercity/services/undercity-state.service.ts
git commit -m "feat(undercity): firsts on GameState + store signal"
```

---

## Task 10: Treasure sprites on the board (hoard → plundered)

**Files:**
- Modify: `src/app/undercity/engine/board-terrain.ts` (`LANDMARK_TYPES`, ~line 39)
- Modify: `src/app/undercity/engine/board-canvas.ts` (fields, image load ~line 545, `setFirsts`, `drawSpace` ~line 1330, new `drawTreasureHoard`)

- [ ] **Step 1: Stop baking the old cache/vault procedural art**

In `board-terrain.ts`, change `LANDMARK_TYPES` to drop `'vault'` and `'cache'`:

```typescript
export const LANDMARK_TYPES = ['boss', 'gate', 'shop', 'shrine', 'warp',
  'ossuary', 'lair', 'ladder'];
```

(The `case 'vault'` / `case 'cache'` blocks in the landmark switch become unreachable
and can stay as-is; they no longer draw because these types are filtered out at
`board-terrain.ts:1138`.)

- [ ] **Step 2: Add sprite fields + `firsts` cache to `BoardCanvas`**

In `board-canvas.ts`, near the other texture fields (e.g. by `landmarkTex` ~line 356),
add:

```typescript
  private treasureTex: HTMLImageElement | null = null;
  private treasurePlunderedTex: HTMLImageElement | null = null;
  private firsts: Record<string, { by: string; kind: string }> = {};
```

- [ ] **Step 3: Load both treasure sprites**

In the constructor, after the `landmarkSrc` load loop (~line 552, before
`preloadDecalImages`), add:

```typescript
    const hoard = new Image();
    hoard.onload = () => (this.treasureTex = hoard);
    hoard.src = 'undercity/icons/treasure_hoard.png';
    const plundered = new Image();
    plundered.onload = () => (this.treasurePlunderedTex = plundered);
    plundered.src = 'undercity/icons/treasure_hoard_plundered.png';
```

- [ ] **Step 4: Add the `setFirsts` setter**

Near `setClearedDungeons` (~line 417) add:

```typescript
  /** Season-global first-conqueror plates + plundered-treasure state. */
  setFirsts(firsts: Record<string, { by: string; kind: string }>): void {
    this.firsts = firsts ?? {};
  }
```

- [ ] **Step 5: Draw the hoard sprite in `drawSpace`**

In `drawSpace` (~line 1297), after the `if (n.type === 'lair') this.drawLairBoss(...)`
line, add:

```typescript
    // Treasure tiles wear the hoard sprite, swapping to a plundered variant once
    // their season-global first conqueror has cracked them open.
    if (n.type === 'trove' || n.type === 'cache' || n.type === 'vault') {
      this.drawTreasureHoard(n);
    }
```

- [ ] **Step 6: Implement `drawTreasureHoard`**

Add this method next to `drawSpace` (after it, ~line 1355):

```typescript
  private drawTreasureHoard(n: BoardNode): void {
    const img = this.firsts[n.id] ? this.treasurePlunderedTex : this.treasureTex;
    if (!img) return;
    const ctx = this.ctx;
    const h = 46; // world px
    const w = (img.width / img.height) * h;
    ctx.drawImage(img, n.x - w / 2, n.y - h + DISC_RY * 0.3, w, h);
  }
```

(`DISC_RY` is already imported/defined in this file — it's used in `drawSpace`.)

- [ ] **Step 7: Verify the build**

Run: `npm run build`
Expected: build succeeds.

- [ ] **Step 8: Commit**

```bash
git add src/app/undercity/engine/board-terrain.ts src/app/undercity/engine/board-canvas.ts
git commit -m "feat(undercity): treasure_hoard sprite with plundered swap"
```

---

## Task 11: First-conqueror name-plates

**Files:**
- Modify: `src/app/undercity/engine/board-canvas.ts` (`drawSpace` ~line 1330, new `drawNamePlate`)

- [ ] **Step 1: Draw plates in `drawSpace`**

In `drawSpace`, right after the treasure-hoard block added in Task 10, add:

```typescript
    // First-conqueror name-plates: lairs show at their biome GATE (the dungeon
    // entrance); Savra at the boss node; treasure at the tile itself.
    if (n.type === 'gate') {
      const lair = this.firsts[`${n.id.split('_')[0]}_lair`];
      if (lair) this.drawNamePlate(n.x, n.y + 8, `First cleared by ${lair.by}`);
    } else if (n.type === 'boss') {
      const b = this.firsts[n.id];
      if (b) this.drawNamePlate(n.x, n.y + 8, `First to fell the Queen: ${b.by}`);
    } else if (
      this.firsts[n.id] &&
      (n.type === 'trove' || n.type === 'cache' || n.type === 'vault')
    ) {
      this.drawNamePlate(n.x, n.y + 8, `Plundered by ${this.firsts[n.id].by}`);
    }
```

- [ ] **Step 2: Implement `drawNamePlate`**

Add this method after `drawTreasureHoard` (styling mirrors the player name banner
in `drawLabel`, ~line 2090):

```typescript
  /** A gilded name banner planted below a landmark, styled like the token name
   *  pill so the board reads as one system. */
  private drawNamePlate(x: number, y: number, text: string): void {
    const ctx = this.ctx;
    ctx.save();
    ctx.font = 'bold 12px sans-serif';
    ctx.textAlign = 'center';
    ctx.textBaseline = 'top';
    const w = ctx.measureText(text).width + 14;
    ctx.beginPath();
    ctx.roundRect(x - w / 2, y, w, 18, 5);
    ctx.fillStyle = 'rgba(12, 10, 8, 0.82)';
    ctx.fill();
    ctx.strokeStyle = 'rgba(251, 191, 36, 0.8)';
    ctx.lineWidth = 1.5;
    ctx.stroke();
    ctx.fillStyle = '#fbbf24';
    ctx.fillText(text, x, y + 4);
    ctx.restore();
  }
```

- [ ] **Step 3: Verify the build**

Run: `npm run build`
Expected: build succeeds.

- [ ] **Step 4: Commit**

```bash
git add src/app/undercity/engine/board-canvas.ts
git commit -m "feat(undercity): first-conqueror name-plates on gates/boss/treasure"
```

---

## Task 12: Wire `firsts` from the component into the board

**Files:**
- Modify: `src/app/undercity/tabs/board-tab.component.ts` (board sync, ~line 1435)

- [ ] **Step 1: Push `firsts` to the board each sync**

In the method that ends with the `setClearedDungeons(...)` call (~line 1435), add
right after it:

```typescript
    this.board.setFirsts(this.store.firsts());
```

- [ ] **Step 2: Verify the build**

Run: `npm run build`
Expected: build succeeds.

- [ ] **Step 3: Manual verification (optional but recommended)**

Use the `run-undercity` skill to launch the app against the live backend, reach a
biome gate whose lair has been cleared (or a plundered trove), and confirm the
name-plate renders and the trove sprite shows the plundered variant. Note: this
needs real game state where a landmark has a `FIRST#` record.

- [ ] **Step 4: Commit**

```bash
git add src/app/undercity/tabs/board-tab.component.ts
git commit -m "feat(undercity): feed firsts to the board canvas"
```

---

## Final verification

- [ ] **Server suite green:** `cd infrastructure/lambda && python -m pytest tests -q` → all pass.
- [ ] **Client builds:** `npm run build` → succeeds.
- [ ] **Balance mirror check:** `PLUNDERED_LOOT_MULT` lives only server-side; no client mirror is needed because the client renders server-supplied reward text. (If any client copy later needs the number, mirror it per the `src/app/undercity/data/*.ts` rule.)
- [ ] Deploy is the user's responsibility (server changes require a Lambda deploy to take effect).

---

## Self-review notes (author)

- **Spec coverage:** loot model (Tasks 1,3,4,5,6) · `FIRST#` record + race safety (Task 2) · lair/boss/treasure write triggers (Tasks 4–7) · state delivery via dedicated query (Task 8) · client model (9) · sprites + plundered swap (10) · name-plates at gate/boss/treasure (11) · component wiring (12). All spec sections map to a task.
- **Type consistency:** `firsts` shape `{by, at?, kind}` is identical across the model (Task 9), the store signal, and the board `setFirsts` (which narrows to `{by, kind}` — a compatible structural subset). `_claim_first(table, sid, node, kind, doc)` signature is used identically in Tasks 4–7. `_append_treasure_gear(doc, out, chance_mult=1.0)` is backward-compatible with existing positional callers.
- **Gate→lair mapping:** gate node ids are `<biome>_rN`; lair ids are `<biome>_lair` (mirrors `SIGIL_LAIRS`), so `n.id.split('_')[0] + '_lair'` resolves correctly for all five biomes.
