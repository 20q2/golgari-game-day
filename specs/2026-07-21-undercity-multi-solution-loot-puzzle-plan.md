# Multi-Solution Loot Puzzle Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Rework the Undercity Flow loot puzzle so the player's route picks the prize — scatter spore/item/gear reward symbols on the board and award the first one the vine crosses, resolved server-side.

**Architecture:** The full-fill Hamiltonian trace is unchanged. On landing, the Lambda rolls *presence* of each reward (spores always, item ~10%, gear rare) and places each on a distinct cell, stashing the placement on `pendingLoot`. On solve, the server derives the first reward cell the submitted path enters and rolls that category's value. The Angular modal renders reward cells as `uc-*` SVG icons and highlights the first-crossed one while fading the rest (cosmetic only).

**Tech Stack:** Python 3.11 Lambda (pure engine functions + DynamoDB dispatcher, pytest), Angular 20 standalone components (SCSS, Angular Material `MatIcon`).

Spec: [2026-07-21-undercity-multi-solution-loot-puzzle-design.md](2026-07-21-undercity-multi-solution-loot-puzzle-design.md)

---

## File Structure

- `infrastructure/lambda/undercity_engine.py` — add pure `first_reward_on_path` beside `validate_flow_solution`.
- `infrastructure/lambda/undercity_db.py` — add `_place_loot_rewards`; refactor `_award_loot` into `_award_spores` / `_award_item` / `_award_gear`; roll presence + place in the `loot` branch of `_resolve_space`; rework `_solve_loot_puzzle`.
- `infrastructure/lambda/tests/test_undercity_engine.py` — unit tests for `first_reward_on_path`.
- `infrastructure/lambda/tests/test_undercity_db.py` — unit tests for `_place_loot_rewards`; integration tests for roll-the-cache + first-hit claim.
- `infrastructure/lambda/tests/test_undercity_gear_drops.py` — update `test_loot_tile_can_drop_gear` to the new claim flow.
- `src/app/undercity/services/undercity-models.ts` — add `rewards` to `FlowPuzzleView`.
- `src/app/undercity/data/icons.ts` — add `uc-spore`, `uc-pouch`, `uc-chest`.
- `src/app/undercity/tabs/flow-puzzle.component.ts` — render reward icons, first-hit highlight/fade, drop emoji markers.

**Test commands:**
- Backend: `cd infrastructure/lambda && python -m pytest tests -q`
- Frontend (no test runner — verify with a build): from repo root `npm run build`

---

### Task 1: `first_reward_on_path` engine helper

**Files:**
- Modify: `infrastructure/lambda/undercity_engine.py` (add after `validate_flow_solution`, ~line 852)
- Test: `infrastructure/lambda/tests/test_undercity_engine.py`

- [ ] **Step 1: Write the failing tests**

Add to `infrastructure/lambda/tests/test_undercity_engine.py`:

```python
def test_first_reward_on_path_picks_earliest():
    rewards = [{'kind': 'spores', 'cell': [0, 2]},
               {'kind': 'gear', 'cell': [0, 1]}]
    path = [[0, 0], [0, 1], [0, 2], [0, 3]]
    # gear cell [0,1] is entered before spores cell [0,2]
    assert engine.first_reward_on_path(rewards, path) == 'gear'


def test_first_reward_on_path_respects_later_order():
    rewards = [{'kind': 'gear', 'cell': [0, 3]},
               {'kind': 'spores', 'cell': [0, 1]}]
    path = [[0, 0], [0, 1], [0, 2], [0, 3]]
    # spores cell [0,1] comes first along the path
    assert engine.first_reward_on_path(rewards, path) == 'spores'


def test_first_reward_on_path_none_when_no_reward_on_path():
    rewards = [{'kind': 'gear', 'cell': [5, 5]}]
    path = [[0, 0], [0, 1]]
    assert engine.first_reward_on_path(rewards, path) is None


def test_first_reward_on_path_empty_rewards():
    assert engine.first_reward_on_path([], [[0, 0], [0, 1]]) is None
```

(`import undercity_engine as engine` already exists at the top of this test file. Verify it's present; if not, add it.)

- [ ] **Step 2: Run tests to verify they fail**

Run: `cd infrastructure/lambda && python -m pytest tests/test_undercity_engine.py -q -k first_reward_on_path`
Expected: FAIL with `AttributeError: module 'undercity_engine' has no attribute 'first_reward_on_path'`

- [ ] **Step 3: Implement the helper**

Add to `infrastructure/lambda/undercity_engine.py`, immediately after `validate_flow_solution`:

```python
def first_reward_on_path(rewards, path):
    """Return the `kind` of the first reward cell the path enters, or None.

    `rewards` is [{'kind': str, 'cell': [r, c]}, ...]; `path` is [[r, c], ...] in
    draw order. One cell holds at most one reward, so there are no ties — the
    first path cell that matches any reward cell wins.
    """
    by_cell = {tuple(rw['cell']): rw['kind'] for rw in rewards}
    for cell in path:
        kind = by_cell.get(tuple(cell))
        if kind is not None:
            return kind
    return None
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `cd infrastructure/lambda && python -m pytest tests/test_undercity_engine.py -q -k first_reward_on_path`
Expected: PASS (4 passed)

- [ ] **Step 5: Commit**

```bash
git add infrastructure/lambda/undercity_engine.py infrastructure/lambda/tests/test_undercity_engine.py
git commit -m "feat(undercity): first_reward_on_path engine helper"
```

---

### Task 2: `_place_loot_rewards` placement helper

**Files:**
- Modify: `infrastructure/lambda/undercity_db.py` (add near `_flow_puzzle_view`, ~line 2050)
- Test: `infrastructure/lambda/tests/test_undercity_db.py`

- [ ] **Step 1: Write the failing tests**

Add to `infrastructure/lambda/tests/test_undercity_db.py` (this file already imports `undercity_db as db` and `undercity_data as data`):

```python
def test_place_loot_rewards_distinct_valid_cells():
    puzzle = data.flow_puzzle('p02')   # 4x4, start [0,3], end [3,0], rock [1,1]
    rng = random.Random(1)
    rewards = db._place_loot_rewards(puzzle, ['spores', 'item', 'gear'], rng)
    kinds = [r['kind'] for r in rewards]
    assert kinds == ['spores', 'item', 'gear']
    cells = [tuple(r['cell']) for r in rewards]
    assert len(set(cells)) == 3                       # distinct
    rocks = {tuple(c) for c in puzzle['rocks']}
    start, end = tuple(puzzle['start']), tuple(puzzle['end'])
    for cell in cells:
        assert cell not in rocks and cell != start and cell != end


def test_place_loot_rewards_gear_not_adjacent_to_start():
    puzzle = data.flow_puzzle('p02')
    start = tuple(puzzle['start'])
    for seed in range(30):
        rewards = db._place_loot_rewards(
            puzzle, ['spores', 'gear'], random.Random(seed))
        gear = next(tuple(r['cell']) for r in rewards if r['kind'] == 'gear')
        assert abs(gear[0] - start[0]) + abs(gear[1] - start[1]) != 1
```

Ensure `import random` is present at the top of the test file (it is used elsewhere; add it if missing).

- [ ] **Step 2: Run tests to verify they fail**

Run: `cd infrastructure/lambda && python -m pytest tests/test_undercity_db.py -q -k place_loot_rewards`
Expected: FAIL with `AttributeError: module 'undercity_db' has no attribute '_place_loot_rewards'`

- [ ] **Step 3: Implement the helper**

Add to `infrastructure/lambda/undercity_db.py`, directly below `_flow_puzzle_view`:

```python
def _place_loot_rewards(puzzle, kinds, rng):
    """Place one reward per kind on a distinct non-rock, non-start, non-end cell.
    The gear cell is never orthogonally adjacent to the start (no step-one grabs).
    Returns [{'kind': str, 'cell': [r, c]}, ...] in the order of `kinds`. Placement
    is a cosmetic overlay — it never blocks a cell, so the puzzle stays solvable."""
    w, h = puzzle['w'], puzzle['h']
    rocks = {tuple(c) for c in puzzle['rocks']}
    start, end = tuple(puzzle['start']), tuple(puzzle['end'])
    cells = [[r, c] for r in range(h) for c in range(w)
             if (r, c) not in rocks and (r, c) != start and (r, c) != end]
    rng.shuffle(cells)

    def adjacent_to_start(cell):
        return abs(cell[0] - start[0]) + abs(cell[1] - start[1]) == 1

    rewards, used = [], set()
    for kind in kinds:
        for cell in cells:
            t = (cell[0], cell[1])
            if t in used:
                continue
            if kind == 'gear' and adjacent_to_start(cell):
                continue
            rewards.append({'kind': kind, 'cell': [cell[0], cell[1]]})
            used.add(t)
            break
    return rewards
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `cd infrastructure/lambda && python -m pytest tests/test_undercity_db.py -q -k place_loot_rewards`
Expected: PASS (2 passed)

- [ ] **Step 5: Commit**

```bash
git add infrastructure/lambda/undercity_db.py infrastructure/lambda/tests/test_undercity_db.py
git commit -m "feat(undercity): loot reward placement helper"
```

---

### Task 3: Refactor `_award_loot` into per-category award helpers

**Files:**
- Modify: `infrastructure/lambda/undercity_db.py:2077-2097` (`_award_loot`)
- Test: `infrastructure/lambda/tests/test_undercity_db.py`

- [ ] **Step 1: Write the failing tests**

Add to `infrastructure/lambda/tests/test_undercity_db.py`:

```python
def test_award_spores_credits_forage_amount(monkeypatch):
    monkeypatch.setattr(db._rng, 'choice', lambda seq: seq[0])   # picks 8
    doc = {'userId': 'u', 'spores': 0}
    ev = db._award_spores(doc)
    assert ev['type'] == 'loot' and ev['spores'] == 8
    assert doc['spores'] == 8


def test_award_item_puts_consumable_in_bag(monkeypatch):
    monkeypatch.setattr(db._rng, 'choice',
                        lambda seq: list(data.CONSUMABLES.keys())[0])
    doc = {'userId': 'u', 'spores': 0, 'bag': []}
    ev = db._award_item(doc)
    assert ev['type'] == 'loot' and ev['item'] == list(data.CONSUMABLES.keys())[0]
    assert doc['bag'] == [ev['item']]


def test_award_gear_rolls_a_drop(monkeypatch):
    monkeypatch.setattr(db._rng, 'choice',
                        lambda seq: 'fang' if 'fang' in seq else seq[0])
    monkeypatch.setattr(db._rng, 'choices', lambda seq, weights=None, k=1: [seq[0]])
    doc = {'userId': 'u', 'spores': 0, 'gear': {}}
    ev = db._award_gear(doc)
    assert ev['type'] == 'loot' and ev['gear']['slot'] == 'fang'
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `cd infrastructure/lambda && python -m pytest tests/test_undercity_db.py -q -k "award_spores or award_item or award_gear"`
Expected: FAIL with `AttributeError` for `_award_spores` / `_award_item` / `_award_gear`

- [ ] **Step 3: Replace `_award_loot` with the three helpers**

In `infrastructure/lambda/undercity_db.py`, replace the entire `_award_loot` function (lines 2077-2097) with:

```python
def _award_spores(doc):
    """Forage-spore loot reward (the always-present floor)."""
    amount = _scrounge(doc, _rng.choice([8, 8, 9, 9, 10, 10, 11, 12, 13, 15]))
    if doc.get('homeBiome') == 'garden':
        amount += 2  # Composter hatch perk
    doc['spores'] = doc.get('spores', 0) + amount
    return {'type': 'loot', 'text': f'You forage {amount} Spores from the rot.',
            'spores': amount}


def _award_item(doc):
    """Consumable loot reward; a full bag salvages to Spores (via _give_consumable)."""
    item = _give_consumable(doc)
    if item:
        return {'type': 'loot',
                'text': f'You unearth a {data.CONSUMABLES[item]["name"]}!',
                'item': item}
    # Bag was full — _give_consumable already credited 5 Spores.
    return {'type': 'loot', 'text': 'Your bag was full — you salvage 5 Spores.',
            'spores': 5}


def _award_gear(doc):
    """Gear loot reward; falls back to Spores if a drop somehow fails to roll."""
    drop = _roll_gear_drop(doc, data.GEAR_DROP['loot'][1])
    if drop:
        return {'type': 'loot',
                'text': f'You unearth a piece of gear — {_drop_phrase(drop)}!',
                'gear': drop}
    return _award_spores(doc)


_LOOT_AWARDERS = {'spores': _award_spores, 'item': _award_item, 'gear': _award_gear}
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `cd infrastructure/lambda && python -m pytest tests/test_undercity_db.py -q -k "award_spores or award_item or award_gear"`
Expected: PASS (3 passed)

- [ ] **Step 5: Commit**

```bash
git add infrastructure/lambda/undercity_db.py infrastructure/lambda/tests/test_undercity_db.py
git commit -m "refactor(undercity): split _award_loot into per-category awarders"
```

---

### Task 4: Roll-the-cache in the `loot` branch of `_resolve_space`

**Files:**
- Modify: `infrastructure/lambda/undercity_db.py:2130-2138` (`loot` branch of `_resolve_space`)
- Test: `infrastructure/lambda/tests/test_undercity_db.py`

- [ ] **Step 1: Write the failing tests**

Add to `infrastructure/lambda/tests/test_undercity_db.py`:

```python
def test_loot_landing_always_has_spores_reward(table, monkeypatch):
    node = next(n for n, nd in data.MAP_NODES.items() if nd['type'] == 'loot')
    sid, doc = _player_at(table, node, spores=0)
    monkeypatch.setattr(db._rng, 'random', lambda: 0.99)   # no item, no gear
    ev = db._resolve_space(table, sid, doc, node, None)
    assert ev['type'] == 'loot_puzzle'
    kinds = [r['kind'] for r in ev['puzzle']['rewards']]
    assert kinds == ['spores']
    assert doc['spores'] == 0                              # not credited yet
    assert doc['pendingLoot']['rewards'] == ev['puzzle']['rewards']


def test_loot_landing_can_roll_all_three(table, monkeypatch):
    node = next(n for n, nd in data.MAP_NODES.items() if nd['type'] == 'loot')
    sid, doc = _player_at(table, node, spores=0)
    monkeypatch.setattr(db._rng, 'random', lambda: 0.0)    # item + gear both fire
    ev = db._resolve_space(table, sid, doc, node, None)
    kinds = {r['kind'] for r in ev['puzzle']['rewards']}
    assert kinds == {'spores', 'item', 'gear'}
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `cd infrastructure/lambda && python -m pytest tests/test_undercity_db.py -q -k "loot_landing"`
Expected: FAIL — `ev['puzzle']` has no `'rewards'` key (KeyError) / `pendingLoot` has no `'rewards'`.

- [ ] **Step 3: Update the `loot` branch**

In `infrastructure/lambda/undercity_db.py`, replace the `loot` branch of `_resolve_space` (currently lines 2130-2138):

```python
    if ntype == 'loot':
        # Gate the reward behind a Flow puzzle: stash the pick + masked view on
        # the doc (survives a refresh) and defer the roll to _solve_loot_puzzle.
        # Only pick puzzles with at least one rock — a clear (rockless) board
        # traces trivially and feels like an empty reward.
        pid = _rng.choice([p['id'] for p in data.FLOW_PUZZLES if p['rocks']])
        doc['pendingLoot'] = {'puzzleId': pid, 'view': _flow_puzzle_view(pid)}
        return {'type': 'loot_puzzle', 'node': node,
                'puzzle': doc['pendingLoot']['view']}
```

with:

```python
    if ntype == 'loot':
        # Gate the reward behind a Flow puzzle and scatter reward symbols on it:
        # roll each category's PRESENCE now (spores always, item ~10%, gear rare),
        # place them, and stash the placement. The VALUE of whichever reward the
        # player traces to first is rolled later in _solve_loot_puzzle. Only pick
        # puzzles with at least one rock — a clear board traces trivially.
        pid = _rng.choice([p['id'] for p in data.FLOW_PUZZLES if p['rocks']])
        puzzle = data.flow_puzzle(pid)
        kinds = ['spores']
        if _rng.random() < 0.10:
            kinds.append('item')
        if _rng.random() < data.GEAR_DROP['loot'][0]:
            kinds.append('gear')
        rewards = _place_loot_rewards(puzzle, kinds, _rng)
        view = _flow_puzzle_view(pid)
        view['rewards'] = rewards
        doc['pendingLoot'] = {'puzzleId': pid, 'view': view, 'rewards': rewards}
        return {'type': 'loot_puzzle', 'node': node, 'puzzle': view}
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `cd infrastructure/lambda && python -m pytest tests/test_undercity_db.py -q -k "loot_landing"`
Expected: PASS (2 passed)

- [ ] **Step 5: Commit**

```bash
git add infrastructure/lambda/undercity_db.py infrastructure/lambda/tests/test_undercity_db.py
git commit -m "feat(undercity): roll + place loot rewards on the Flow board"
```

---

### Task 5: Rework `_solve_loot_puzzle` to award the first-hit reward

**Files:**
- Modify: `infrastructure/lambda/undercity_db.py:4006-4024` (`_solve_loot_puzzle`)
- Test: `infrastructure/lambda/tests/test_undercity_db.py`
- Test (update existing): `infrastructure/lambda/tests/test_undercity_gear_drops.py:68-78`

- [ ] **Step 1: Write the failing tests**

Add to `infrastructure/lambda/tests/test_undercity_db.py`:

```python
def _land_loot_with(table, monkeypatch, placement):
    """Land on a loot node with a forced reward placement; return (sid, doc, puzzle)."""
    node = next(n for n, nd in data.MAP_NODES.items() if nd['type'] == 'loot')
    sid, doc = _player_at(table, node, spores=0, bag=[], gear={})
    monkeypatch.setattr(db, '_place_loot_rewards',
                        lambda puzzle, kinds, rng: placement(puzzle))
    monkeypatch.setattr(db._rng, 'random', lambda: 0.0)   # ensure item+gear present
    ev = db._resolve_space(table, sid, doc, node, None)
    return sid, doc, data.flow_puzzle(doc['pendingLoot']['puzzleId'])


def test_solve_awards_gear_when_hit_first(table, monkeypatch):
    # Gear on the first step after start, spores on the last step before end →
    # the canonical solution reaches gear first.
    sid, doc, puzzle = _land_loot_with(
        table, monkeypatch,
        lambda pz: [{'kind': 'gear', 'cell': pz['solution'][1]},
                    {'kind': 'spores', 'cell': pz['solution'][-2]}])
    monkeypatch.setattr(db._rng, 'choice',
                        lambda seq: 'fang' if 'fang' in seq else seq[0])
    monkeypatch.setattr(db._rng, 'choices', lambda seq, weights=None, k=1: [seq[0]])
    status, body = db._solve_loot_puzzle(table, sid, doc, {'path': puzzle['solution']})
    assert status == 200
    assert body['spaceEvent']['gear']['slot'] == 'fang'
    assert doc.get('pendingLoot') is None


def test_solve_awards_spores_when_hit_first(table, monkeypatch):
    sid, doc, puzzle = _land_loot_with(
        table, monkeypatch,
        lambda pz: [{'kind': 'spores', 'cell': pz['solution'][1]},
                    {'kind': 'gear', 'cell': pz['solution'][-2]}])
    monkeypatch.setattr(db._rng, 'choice', lambda seq: seq[0])   # forage picks 8
    status, body = db._solve_loot_puzzle(table, sid, doc, {'path': puzzle['solution']})
    assert status == 200
    assert body['spaceEvent']['spores'] == 8
    assert 'gear' not in body['spaceEvent']


def test_solve_rejects_incomplete_path(table, monkeypatch):
    sid, doc, puzzle = _land_loot_with(
        table, monkeypatch,
        lambda pz: [{'kind': 'spores', 'cell': pz['solution'][1]}])
    status, body = db._solve_loot_puzzle(
        table, sid, doc, {'path': puzzle['solution'][:3]})
    assert status == 409
    assert doc['pendingLoot'] is not None
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `cd infrastructure/lambda && python -m pytest tests/test_undercity_db.py -q -k "solve_awards or solve_rejects"`
Expected: FAIL — current `_solve_loot_puzzle` calls `_award_loot` (now removed), raising `AttributeError`, or awards a random category rather than the placed one.

- [ ] **Step 3: Rework the handler**

In `infrastructure/lambda/undercity_db.py`, replace the body of `_solve_loot_puzzle` (lines 4006-4024) with:

```python
def _solve_loot_puzzle(table, sid, doc, payload):
    """Validate the drawn Flow path; award the FIRST reward the path crosses."""
    pending = doc.get('pendingLoot')
    if not pending:
        return _err('No loot puzzle to solve.', 409)
    puzzle = data.flow_puzzle(pending.get('puzzleId'))
    if not puzzle:
        doc.pop('pendingLoot', None)  # pack changed under us — drop the stale gate
        _save_or_conflict(table, doc)
        return _err('That puzzle is no longer available.', 409)
    path = payload.get('path') or []
    if not engine.validate_flow_solution(puzzle, path):
        return _err("That path isn't a full solution.", 409)
    kind = engine.first_reward_on_path(pending.get('rewards') or [], path)
    doc.pop('pendingLoot', None)
    awarder = _LOOT_AWARDERS.get(kind, _award_spores)  # None → spores fallback
    event = awarder(doc)
    conflict = _save_or_conflict(table, doc)
    if conflict:
        return conflict
    return _ok(doc, spaceEvent=event)
```

- [ ] **Step 4: Update the existing gear-drop test**

In `infrastructure/lambda/tests/test_undercity_gear_drops.py`, replace `test_loot_tile_can_drop_gear` (lines 68-78) with:

```python
def test_loot_tile_can_drop_gear(table, monkeypatch):
    from tests.test_undercity_db import _land_loot_with
    sid, doc, puzzle = _land_loot_with(
        table, monkeypatch,
        lambda pz: [{'kind': 'gear', 'cell': pz['solution'][1]}])
    _force_fang_drop(monkeypatch)
    status, body = db._solve_loot_puzzle(table, sid, doc, {'path': puzzle['solution']})
    assert status == 200
    out = body['spaceEvent']
    assert out['type'] == 'loot'
    assert out['gear']['slot'] == 'fang'
```

- [ ] **Step 5: Run the full backend suite**

Run: `cd infrastructure/lambda && python -m pytest tests -q`
Expected: PASS — all tests green (new solve tests + the updated gear-drop test + the untouched `test_flow_puzzles_all_solvable`).

- [ ] **Step 6: Commit**

```bash
git add infrastructure/lambda/undercity_db.py infrastructure/lambda/tests/test_undercity_db.py infrastructure/lambda/tests/test_undercity_gear_drops.py
git commit -m "feat(undercity): award first-hit reward on loot puzzle solve"
```

---

### Task 6: Add `rewards` to the client `FlowPuzzleView`

**Files:**
- Modify: `src/app/undercity/services/undercity-models.ts:432-439`

- [ ] **Step 1: Extend the interface**

In `src/app/undercity/services/undercity-models.ts`, replace the `FlowPuzzleView` interface (lines 432-439) with:

```typescript
/** A reward symbol placed on a loot-puzzle cell. The first one the drawn path
 * crosses is what the player keeps; the server decides which — this is only
 * used for rendering. Values are never sent to the client. */
export interface FlowReward {
  kind: 'spores' | 'item' | 'gear';
  cell: [number, number];
}

/** Masked Flow puzzle sent to the client — layout only, never the solution. */
export interface FlowPuzzleView {
  id: string;
  w: number;
  h: number;
  start: [number, number];
  end: [number, number];
  rocks: [number, number][];
  /** Reward symbols scattered on the board (first-crossed wins). */
  rewards: FlowReward[];
}
```

- [ ] **Step 2: Verify the build compiles**

Run (repo root): `npm run build`
Expected: build succeeds (the new optional consumers come in Task 8; adding the field alone must not break compilation).

- [ ] **Step 3: Commit**

```bash
git add src/app/undercity/services/undercity-models.ts
git commit -m "feat(undercity): rewards field on FlowPuzzleView"
```

---

### Task 7: Add reward SVG icons

**Files:**
- Modify: `src/app/undercity/data/icons.ts`

- [ ] **Step 1: Add the three icons**

In `src/app/undercity/data/icons.ts`, add these three constants after `UC_BOLT_SVG` (before the `UC_SVG_ICONS` map):

```typescript
/** Spore pod — the spores loot reward. A round cap on a short stalk. */
export const UC_SPORE_SVG =
  '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" fill="currentColor">' +
  '<path d="M12 3 C6.8 3 3.4 6.4 3.4 10.2 C3.4 11.4 4.4 12 6 12 L18 12 ' +
  'C19.6 12 20.6 11.4 20.6 10.2 C20.6 6.4 17.2 3 12 3 Z"/>' +
  '<rect x="10.8" y="12" width="2.4" height="7.2" rx="1.1"/>' +
  '<circle cx="8.2" cy="8.2" r="1.1"/><circle cx="12" cy="6.8" r="1.2"/>' +
  '<circle cx="15.6" cy="8.6" r="1"/>' +
  '</svg>';

/** Pouch — the consumable-item loot reward. A drawstring bag. */
export const UC_POUCH_SVG =
  '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" fill="currentColor">' +
  '<path d="M8 6 L16 6 L15 8.4 C18 9.8 20 12.6 20 15.6 C20 19 16.4 21.4 12 21.4 ' +
  'C7.6 21.4 4 19 4 15.6 C4 12.6 6 9.8 9 8.4 Z"/>' +
  '<path d="M8.4 4 L15.6 4 A0.9 0.9 0 0 1 15.6 6.4 L8.4 6.4 A0.9 0.9 0 0 1 8.4 4 Z"/>' +
  '</svg>';

/** Chest — the gear loot reward. A banded treasure chest with a latch. */
export const UC_CHEST_SVG =
  '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" fill="currentColor" fill-rule="evenodd">' +
  '<path d="M3.4 9 C3.4 6.4 6.6 4.4 12 4.4 C17.4 4.4 20.6 6.4 20.6 9 L20.6 10.4 ' +
  'L3.4 10.4 Z"/>' +
  '<path d="M3.4 12 L20.6 12 L20.6 18.2 A1.4 1.4 0 0 1 19.2 19.6 L4.8 19.6 ' +
  'A1.4 1.4 0 0 1 3.4 18.2 Z M10.8 12 h2.4 v3.2 h-2.4 Z"/>' +
  '</svg>';
```

Then add them to the `UC_SVG_ICONS` map:

```typescript
export const UC_SVG_ICONS: Record<string, string> = {
  'uc-sword': UC_SWORD_SVG,
  'uc-fang': UC_FANG_SVG,
  'uc-carapace': UC_CARAPACE_SVG,
  'uc-charm': UC_CHARM_SVG,
  'uc-shield': UC_SHIELD_SVG,
  'uc-bolt': UC_BOLT_SVG,
  'uc-spore': UC_SPORE_SVG,
  'uc-pouch': UC_POUCH_SVG,
  'uc-chest': UC_CHEST_SVG,
};
```

- [ ] **Step 2: Verify the build compiles**

Run (repo root): `npm run build`
Expected: build succeeds.

- [ ] **Step 3: Commit**

```bash
git add src/app/undercity/data/icons.ts
git commit -m "feat(undercity): spore/pouch/chest loot reward icons"
```

---

### Task 8: Render rewards + first-hit highlight in the puzzle modal

**Files:**
- Modify: `src/app/undercity/tabs/flow-puzzle.component.ts`

- [ ] **Step 1: Import `MatIconModule` and `FlowReward`**

In `src/app/undercity/tabs/flow-puzzle.component.ts`:

- Change the model import (line 3) to:
  ```typescript
  import { FlowPuzzleView, FlowReward } from '../services/undercity-models';
  ```
- Add the Material icon import near the top:
  ```typescript
  import { MatIconModule } from '@angular/material/icon';
  ```
- Add `MatIconModule` to the component's `imports` array (currently `[CommonModule]`):
  ```typescript
  imports: [CommonModule, MatIconModule],
  ```

- [ ] **Step 2: Add reward lookup + first-hit computation to the class**

Add these members to `FlowPuzzleModalComponent` (near the other `protected` helpers):

```typescript
  /** Registry name of the SVG icon for each reward kind. */
  private readonly rewardIcon: Record<FlowReward['kind'], string> = {
    spores: 'uc-spore',
    item: 'uc-pouch',
    gear: 'uc-chest',
  };

  /** The reward at (r,c), or null. */
  protected rewardAt(r: number, c: number): FlowReward | null {
    return (this.puzzle.rewards ?? []).find((rw) => rw.cell[0] === r && rw.cell[1] === c) ?? null;
  }

  protected iconFor(rw: FlowReward): string {
    return this.rewardIcon[rw.kind];
  }

  /** Index in the current path where the first reward is crossed, or -1. */
  protected readonly claimedRewardCell = computed<[number, number] | null>(() => {
    const p = this.path();
    for (const [r, c] of p) {
      const rw = (this.puzzle.rewards ?? []).find((x) => x.cell[0] === r && x.cell[1] === c);
      if (rw) return [r, c];
    }
    return null;
  });

  protected isClaimed(r: number, c: number): boolean {
    const cell = this.claimedRewardCell();
    return !!cell && cell[0] === r && cell[1] === c;
  }

  /** A reward cell that is NOT the first-crossed one, once one has been claimed. */
  protected isFaded(r: number, c: number): boolean {
    const claimed = this.claimedRewardCell();
    if (!claimed) return false;
    const isReward = (this.puzzle.rewards ?? []).some((x) => x.cell[0] === r && x.cell[1] === c);
    return isReward && !(claimed[0] === r && claimed[1] === c);
  }
```

(`computed` and `signal` are already imported in this component; no import change needed for `claimedRewardCell`.)

- [ ] **Step 3: Render reward icons + fade classes in the template**

In the cell `@for` body, add `.claimed` / `.faded` classes and render the reward icon. Replace the cell block (template lines ~33-50) with:

```html
              <div
                class="cell"
                [attr.data-r]="ri"
                [attr.data-c]="ci"
                [class.rock]="isRock(ri, ci)"
                [class.start]="isStart(ri, ci)"
                [class.end]="isEnd(ri, ci)"
                [class.filled]="inPath(ri, ci)"
                [class.tip]="isTip(ri, ci)"
                [class.claimed]="isClaimed(ri, ci)"
                [class.faded]="isFaded(ri, ci)"
              >
                @if (rewardAt(ri, ci); as rw) {
                  <mat-icon class="reward-ic" [svgIcon]="iconFor(rw)"></mat-icon>
                }
              </div>
```

This drops the emoji `<span>`s for start/end/rock — those now read from their existing ring/background styles alone.

- [ ] **Step 4: Update copy and add styles**

In the template, change the sub-line (`<p class="flow-sub">…`) to:

```html
        <p class="flow-sub">Trace one vine through every empty tile — the first prize it touches is yours.</p>
```

Add to the component `styles` (inside the existing style string, after the `.cell.rock` rule):

```css
      .cell .reward-ic {
        width: 70%;
        height: 70%;
        color: #e0c088;
      }
      .cell.filled .reward-ic {
        color: #10140e;
      }
      .cell.claimed {
        box-shadow: inset 0 0 0 2px #8fd08a, 0 0 8px rgba(143, 208, 138, 0.7);
      }
      .cell.faded .reward-ic {
        opacity: 0.25;
        filter: grayscale(1);
      }
```

- [ ] **Step 5: Verify the build compiles**

Run (repo root): `npm run build`
Expected: build succeeds with no template/type errors.

- [ ] **Step 6: Manually verify in the app**

Use the `run-undercity` skill to launch the game against the live backend, reach a loot tile, and confirm: reward icons render on cells; dragging the vine over the first reward highlights it green and fades the others; solving awards the reward you crossed first. (No emoji anywhere in the modal.)

- [ ] **Step 7: Commit**

```bash
git add src/app/undercity/tabs/flow-puzzle.component.ts
git commit -m "feat(undercity): render loot rewards + first-hit highlight in Flow puzzle"
```

---

## Self-Review Notes

- **Spec coverage:** full-fill unchanged (Task 5 keeps `validate_flow_solution`); roll-the-cache presence (Task 4); procedural placement with gear-not-adjacent guard (Task 2); first-hit server-side (Tasks 1, 5); values rolled at claim (Task 3, 5); SVG icons + emoji removal (Tasks 7, 8); `rewards` contract (Tasks 4, 6); balance note lives in the spec (no numeric change here — presence odds kept at 0.10 / `GEAR_DROP['loot']`, so no client mirror edit needed). Testing section covered by Tasks 1-5.
- **`None` fallback:** `_solve_loot_puzzle` maps a `None` first-hit (impossible under full-fill, but defensive) to `_award_spores` via `_LOOT_AWARDERS.get(kind, _award_spores)`.
- **Type consistency:** `first_reward_on_path(rewards, path)`, `_place_loot_rewards(puzzle, kinds, rng)`, `_LOOT_AWARDERS` keyed by `'spores'|'item'|'gear'`, and the client `FlowReward.kind` union all use the same three kind strings.
- **No client mirror / board-tab change:** `openFlowPuzzle` already forwards `ev.puzzle` and `pendingLoot.view` straight to the component input, so `rewards` flows through without board-tab edits.
