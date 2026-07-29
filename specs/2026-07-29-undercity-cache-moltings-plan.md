# Overgrown Cache: Moltings Reward, Reachability, Friendly Pickup — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Make moltings a claimable reward in the Overgrown Cache loot mini-game (replacing one pouch, 1 per grab), guarantee every placed reward is on a routable path, and reword the gear pickup message to celebrate the find instead of reporting storage.

**Architecture:** Server-authoritative. Rules live in `infrastructure/lambda/undercity_{config,engine,db}.py`; the Angular client mirrors the reward vocabulary and renders the result. Reward placement gains a pure engine reachability helper; the cache reward pool swaps one `item` for a new `molting` kind; the gear find text is rebuilt per outcome. Tests are the in-memory pytest suite (engine unit + db FakeTable integration); the client is verified via `npm run build`.

**Tech Stack:** Python 3.11 Lambda (pytest), Angular 20 standalone components (Material Icons).

Spec: [specs/2026-07-29-undercity-cache-moltings-design.md](2026-07-29-undercity-cache-moltings-design.md)

Run all server tests from `infrastructure/lambda`:
```
python -m pytest tests -q
```

---

## File Structure

**Server (`infrastructure/lambda/`):**
- `undercity_config.py` — add `FLOW_MOLTING_REWARD` scalar.
- `undercity_engine.py` — add pure `cell_on_some_route(puzzle, cell)`.
- `undercity_db.py` — add `_award_molting`, `_gear_find_text`; wire molting into `_LOOT_AWARDERS`, `_award_flow_reward`, `_loot_puzzle`; add reachability filter to `_place_loot_rewards`; reword `_award_gear` text.
- `tests/test_undercity_engine.py` — `cell_on_some_route` unit tests.
- `tests/test_undercity_db.py` — molting placement/reachability + award + gear-text tests.

**Client (`src/app/undercity/`):**
- `services/undercity-models.ts` — extend `FlowReward['kind']`, `SpaceEvent.gear.outcome`, add `SpaceEvent.materials`.
- `tabs/flow-puzzle.component.ts` — render molting with the `grass` ligature.
- `tabs/board-tab.component.ts` — `eventHasChips` counts materials.
- `tabs/board-tab.component.html` — molting chip + reworded gear chip.

---

## Task 1: Config scalar for the molting reward amount

**Files:**
- Modify: `infrastructure/lambda/undercity_config.py` (after the `FLOW_SPORE_CAP` line, ~line 45)

- [ ] **Step 1: Add the scalar**

In `undercity_config.py`, immediately after:
```python
FLOW_SPORE_CAP = 10          # hard ceiling on a single cache's movement spores
```
add:
```python
FLOW_MOLTING_REWARD = 1      # Moltings granted per Overgrown Cache molting pickup
```

- [ ] **Step 2: Verify it re-exports through `undercity_data`**

Run:
```
cd infrastructure/lambda && python -c "import undercity_data as d; print(d.FLOW_MOLTING_REWARD)"
```
Expected: prints `1` (confirms the `from undercity_config import *` re-export in `undercity_data.py`).

- [ ] **Step 3: Commit**

```bash
git add infrastructure/lambda/undercity_config.py
git commit -m "feat(undercity): add FLOW_MOLTING_REWARD config scalar"
```

---

## Task 2: Engine reachability helper `cell_on_some_route`

A reward cell is only collectible if some valid start→end route (same rules as `validate_flow_path`: orthogonal single line, no revisits, no rocks) passes through it. Add a pure DFS helper.

**Files:**
- Modify: `infrastructure/lambda/undercity_engine.py` (add after `first_reward_on_path`, ~line 985)
- Test: `infrastructure/lambda/tests/test_undercity_engine.py`

- [ ] **Step 1: Write the failing tests**

Append to `tests/test_undercity_engine.py`:
```python
def test_cell_on_some_route_open_board_center():
    # 4x4 open, start [0,0] end [3,0]; a mid cell is trivially routable.
    p = {'w': 4, 'h': 4, 'start': [0, 0], 'end': [3, 0], 'rocks': []}
    assert _eng_flow.cell_on_some_route(p, [1, 2]) is True


def test_cell_on_some_route_rejects_boxed_in_cell():
    # [0,0] start, [3,3] end. Cell [0,3] is walled off by rocks at [0,2] and
    # [1,3], leaving it a dead-end pocket no through-route can cross.
    p = {'w': 4, 'h': 4, 'start': [0, 0], 'end': [3, 3],
         'rocks': [[0, 2], [1, 3]]}
    assert _eng_flow.cell_on_some_route(p, [0, 3]) is False


def test_cell_on_some_route_rejects_start_and_end():
    p = {'w': 4, 'h': 4, 'start': [0, 0], 'end': [3, 0], 'rocks': []}
    assert _eng_flow.cell_on_some_route(p, [0, 0]) is False
    assert _eng_flow.cell_on_some_route(p, [3, 0]) is False


def test_cell_on_some_route_rejects_rock_and_oob():
    p = {'w': 4, 'h': 4, 'start': [0, 0], 'end': [3, 0], 'rocks': [[1, 1]]}
    assert _eng_flow.cell_on_some_route(p, [1, 1]) is False
    assert _eng_flow.cell_on_some_route(p, [9, 9]) is False


def test_cell_on_some_route_all_puzzle_solution_cells_route():
    # Every non-endpoint cell on a real puzzle's canonical solution is, by
    # definition, on a valid route.
    for p in data.FLOW_PUZZLES:
        sol = p['solution']
        for cell in sol[1:-1]:
            assert _eng_flow.cell_on_some_route(p, list(cell)) is True, (p['id'], cell)
```

- [ ] **Step 2: Run tests to verify they fail**

Run:
```
cd infrastructure/lambda && python -m pytest tests/test_undercity_engine.py -k cell_on_some_route -q
```
Expected: FAIL — `AttributeError: module 'undercity_engine' has no attribute 'cell_on_some_route'`.

- [ ] **Step 3: Implement the helper**

In `undercity_engine.py`, add after `first_reward_on_path` (~line 985):
```python
def cell_on_some_route(puzzle, cell):
    """True iff some valid start->end route (per validate_flow_path rules) passes
    through `cell`: a simple orthogonal line, no revisits, avoiding rocks and the
    board edge. Used to guarantee a placed cache reward is actually collectible —
    a cell boxed in by rocks (or otherwise on no through-route) is rejected.

    Boards are tiny (<=5x5, <=2 rocks), so an early-exit DFS that greedily heads
    for the target waypoint then the goal resolves immediately in practice.
    """
    w, h = puzzle['w'], puzzle['h']
    rocks = {tuple(c) for c in puzzle['rocks']}
    start, end = tuple(puzzle['start']), tuple(puzzle['end'])
    target = (cell[0], cell[1])
    if not (0 <= target[0] < h and 0 <= target[1] < w):
        return False
    if target in rocks or target == start or target == end:
        return False

    def neighbours(r, c, toward):
        opts = []
        for dr, dc in ((-1, 0), (1, 0), (0, -1), (0, 1)):
            nr, nc = r + dr, c + dc
            if 0 <= nr < h and 0 <= nc < w and (nr, nc) not in rocks:
                opts.append((nr, nc))
        # Greedy: try cells closest to the current waypoint first for a fast hit.
        opts.sort(key=lambda p: abs(p[0] - toward[0]) + abs(p[1] - toward[1]))
        return opts

    # Two legs: start -> target, then target -> end, sharing only `target`.
    def dfs(cur, goal, visited):
        if cur == goal:
            return True
        for nxt in neighbours(cur[0], cur[1], goal):
            if nxt in visited:
                continue
            visited.add(nxt)
            if dfs(nxt, goal, visited):
                return True
            visited.remove(nxt)
        return False

    leg1 = {start, target}
    if not dfs(start, target, leg1):
        return False
    # Second leg may reuse any cell except those consumed by the first leg
    # (minus the shared target, which the route passes through once).
    leg2 = set(leg1)
    leg2.discard(end)
    return dfs(target, end, leg2)
```

- [ ] **Step 4: Run tests to verify they pass**

Run:
```
cd infrastructure/lambda && python -m pytest tests/test_undercity_engine.py -k cell_on_some_route -q
```
Expected: PASS (5 tests).

Note: the two-leg split is a sufficient, conservative check — if it finds two vertex-disjoint legs it has found a real simple route; if it can't, the cell is treated as unroutable and simply won't be chosen for a reward (Task 4 falls back gracefully). That conservatism is safe for a "never unreachable" guarantee.

- [ ] **Step 5: Commit**

```bash
git add infrastructure/lambda/undercity_engine.py infrastructure/lambda/tests/test_undercity_engine.py
git commit -m "feat(undercity): add cell_on_some_route reachability helper for cache rewards"
```

---

## Task 3: `_award_molting` awarder + molting in the reward pool

**Files:**
- Modify: `infrastructure/lambda/undercity_db.py` (`_award_molting` after `_award_gear` ~line 2723; `_LOOT_AWARDERS` ~line 2725; `_loot_puzzle` ~line 2734; `_award_flow_reward` ~line 5425)
- Test: `infrastructure/lambda/tests/test_undercity_db.py`

- [ ] **Step 1: Write the failing tests**

Find how other db tests build a player doc (search `def test` + `_new_creature`/`_fresh_doc` fixtures in `tests/test_undercity_db.py`) and match that style. Append:
```python
def test_award_molting_grants_configured_amount():
    import undercity_db as db, undercity_data as data
    doc = {'materials': {'moltings': 0, 'ichor': 0}}
    ev = db._award_molting(doc)
    assert doc['materials']['moltings'] == data.FLOW_MOLTING_REWARD
    assert ev['materials']['moltings'] == data.FLOW_MOLTING_REWARD
    assert ev['type'] == 'loot'
    assert 'Molting' in ev['text']


def test_loot_puzzle_pool_has_molting_not_second_pouch():
    import undercity_db as db
    doc = {'materials': {'moltings': 0, 'ichor': 0}}
    ev = db._loot_puzzle(None, 'S1', doc, 'n1')
    kinds = [r['kind'] for r in ev['puzzle']['rewards']]
    assert kinds.count('item') == 1          # one pouch, not two
    assert 'molting' in kinds                 # replaced by a molting pile
```

- [ ] **Step 2: Run to verify failure**

Run:
```
cd infrastructure/lambda && python -m pytest tests/test_undercity_db.py -k "molting or loot_puzzle_pool" -q
```
Expected: FAIL — `AttributeError: ... '_award_molting'` and the pool assertion (`item` count is 2, no `molting`).

- [ ] **Step 3: Implement**

In `undercity_db.py`, add after `_award_gear` (before the `_LOOT_AWARDERS` line ~2725):
```python
def _award_molting(doc):
    """Cache molting reward: mine a small amount of moltings straight into the
    material counters (the same path salvage/mining use)."""
    gained = _mine_materials(doc, moltings=data.FLOW_MOLTING_REWARD)
    n = gained['moltings']
    return {'type': 'loot',
            'text': f'You pry {n} Molting{"s" if n != 1 else ""} loose from the cache!',
            'materials': gained}
```

Change the `_LOOT_AWARDERS` line to include molting:
```python
_LOOT_AWARDERS = {'spores': _award_spores, 'item': _award_item,
                  'gear': _award_gear, 'molting': _award_molting}
```

In `_loot_puzzle`, change:
```python
    kinds = ['item', 'item']
```
to:
```python
    kinds = ['item', 'molting']
```

In `_award_flow_reward`, extend the kind dispatch. Change:
```python
    kind = engine.first_reward_on_path(rewards or [], path)
    event = {'type': 'loot', 'spores': move_spores}
    if kind == 'gear':
        sub = _award_gear(doc)
    elif kind == 'item':
        sub = _award_item(doc)
    else:
        event['text'] = f'You forage {move_spores} Spores routing through the cache.'
        return event

    # Merge the item/gear award onto the movement-spore event.
    event['spores'] = move_spores + sub.get('spores', 0)
    for key in ('item', 'gear'):
        if key in sub:
            event[key] = sub[key]
    event['text'] = f"{sub['text']} (+{move_spores} Spores foraged on the way.)"
    return event
```
to:
```python
    kind = engine.first_reward_on_path(rewards or [], path)
    event = {'type': 'loot', 'spores': move_spores}
    if kind in ('gear', 'item', 'molting'):
        sub = _LOOT_AWARDERS[kind](doc)
    else:
        event['text'] = f'You forage {move_spores} Spores routing through the cache.'
        return event

    # Merge the item/gear/molting award onto the movement-spore event.
    event['spores'] = move_spores + sub.get('spores', 0)
    for key in ('item', 'gear', 'materials'):
        if key in sub:
            event[key] = sub[key]
    event['text'] = f"{sub['text']} (+{move_spores} Spores foraged on the way.)"
    return event
```

- [ ] **Step 4: Run to verify pass**

Run:
```
cd infrastructure/lambda && python -m pytest tests/test_undercity_db.py -k "molting or loot_puzzle_pool" -q
```
Expected: PASS (2 tests).

- [ ] **Step 5: Commit**

```bash
git add infrastructure/lambda/undercity_db.py infrastructure/lambda/tests/test_undercity_db.py
git commit -m "feat(undercity): moltings replace one pouch in the Overgrown Cache pool"
```

---

## Task 4: Reachability guarantee in `_place_loot_rewards`

**Files:**
- Modify: `infrastructure/lambda/undercity_db.py` (`_place_loot_rewards`, ~line 2639)
- Test: `infrastructure/lambda/tests/test_undercity_db.py`

- [ ] **Step 1: Write the failing test**

Append to `tests/test_undercity_db.py`:
```python
def test_place_loot_rewards_only_uses_routable_cells():
    import undercity_db as db, undercity_data as data
    import undercity_engine as engine
    import random
    # Every rocked puzzle, every reward: the chosen cell must be on some route.
    for p in [q for q in data.FLOW_PUZZLES if q['rocks']]:
        rng = random.Random(1234)
        rewards = db._place_loot_rewards(p, ['item', 'molting', 'gear'], rng)
        for rw in rewards:
            assert engine.cell_on_some_route(p, rw['cell']) is True, (p['id'], rw)
```

- [ ] **Step 2: Run to verify it fails (or is not yet guaranteed)**

Run:
```
cd infrastructure/lambda && python -m pytest tests/test_undercity_db.py -k place_loot_rewards_only_uses_routable -q
```
Expected: Likely FAIL on at least one puzzle/seed where a reward lands on a non-routable cell. (If it passes by luck, the guarantee below still hardens it against future puzzle/seed changes.)

- [ ] **Step 3: Implement the filter**

In `_place_loot_rewards`, the inner loop currently is:
```python
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
Replace it with a routable-first pass that falls back to any free cell so a cache never fails to place:
```python
    # A cell is only offered if some valid route can cross it (never box a reward
    # in behind rocks). If nothing routable is free for a kind, fall back to any
    # free cell so a cache never errors out on a pathological board.
    routable = [c for c in cells if engine.cell_on_some_route(puzzle, c)]

    rewards, used = [], set()
    for kind in kinds:
        chosen = None
        for pool in (routable, cells):  # prefer routable; fall back to any free
            for cell in pool:
                t = (cell[0], cell[1])
                if t in used:
                    continue
                if kind == 'gear' and adjacent_to_start(cell):
                    continue
                chosen = cell
                break
            if chosen is not None:
                break
        if chosen is not None:
            rewards.append({'kind': kind, 'cell': [chosen[0], chosen[1]]})
            used.add((chosen[0], chosen[1]))
    return rewards
```
Confirm `import undercity_engine as engine` is already present at the top of `undercity_db.py` (it is — `_award_flow_reward` calls `engine.first_reward_on_path`). No new import needed.

- [ ] **Step 4: Run to verify pass**

Run:
```
cd infrastructure/lambda && python -m pytest tests/test_undercity_db.py -k place_loot_rewards -q
```
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add infrastructure/lambda/undercity_db.py infrastructure/lambda/tests/test_undercity_db.py
git commit -m "fix(undercity): guarantee cache rewards land on a routable cell"
```

---

## Task 5: Friendly gear pickup text (`_gear_find_text`)

**Files:**
- Modify: `infrastructure/lambda/undercity_db.py` (add `_gear_find_text` near `_drop_phrase` ~line 849; use it in `_award_gear` ~line 2715)
- Test: `infrastructure/lambda/tests/test_undercity_db.py`

- [ ] **Step 1: Write the failing tests**

Append to `tests/test_undercity_db.py`:
```python
def test_gear_find_text_equipped_and_stashed_are_celebratory():
    import undercity_db as db, undercity_data as data
    gid = next(iter(data.GEAR))
    name = data.GEAR[gid]['name']
    equipped = db._gear_find_text({'id': gid, 'outcome': 'equipped'})
    stashed = db._gear_find_text({'id': gid, 'outcome': 'stashed'})
    assert name in equipped and 'slot it on' in equipped
    assert stashed == f'You unearth {name}!'
    # No storage-logistics wording for the happy cases.
    assert 'stash' not in equipped.lower() and 'stash' not in stashed.lower()


def test_gear_find_text_stash_full_is_honest():
    import undercity_db as db, undercity_data as data
    gid = next(iter(data.GEAR))
    name = data.GEAR[gid]['name']
    txt = db._gear_find_text({'id': gid, 'outcome': 'stash-full'})
    assert name in txt and 'materials' in txt
```

- [ ] **Step 2: Run to verify failure**

Run:
```
cd infrastructure/lambda && python -m pytest tests/test_undercity_db.py -k gear_find_text -q
```
Expected: FAIL — `AttributeError: ... '_gear_find_text'`.

- [ ] **Step 3: Implement**

In `undercity_db.py`, add after `_drop_phrase` (~line 853):
```python
def _gear_find_text(drop):
    """Celebratory one-liner for a fresh gear find, keyed by how it was routed.
    equipped/stashed read as a plain win (the piece is yours, no logistics
    noise); only stash-full is spelled out because you got materials, not the
    gear."""
    name = data.GEAR[drop['id']]['name']
    if drop['outcome'] == 'stash-full':
        return f'Your gear stash was full, so you grind {name} into materials.'
    if drop['outcome'] == 'equipped':
        return f'You unearth {name} and slot it on!'
    return f'You unearth {name}!'
```

Change `_award_gear` — replace:
```python
    if drop:
        return {'type': 'loot',
                'text': f'You unearth a piece of gear — {_drop_phrase(drop)}!',
                'gear': drop}
```
with:
```python
    if drop:
        return {'type': 'loot', 'text': _gear_find_text(drop), 'gear': drop}
```

- [ ] **Step 4: Run to verify pass**

Run:
```
cd infrastructure/lambda && python -m pytest tests/test_undercity_db.py -k gear_find_text -q
```
Expected: PASS (2 tests).

- [ ] **Step 5: Run the full server suite (nothing regressed)**

Run:
```
cd infrastructure/lambda && python -m pytest tests -q
```
Expected: all green. (If a pre-existing test asserted the old `"— stashed!"` gear-find wording, update it to match `_gear_find_text`.)

- [ ] **Step 6: Commit**

```bash
git add infrastructure/lambda/undercity_db.py infrastructure/lambda/tests/test_undercity_db.py
git commit -m "feat(undercity): reword gear cache pickup to celebrate the find"
```

---

## Task 6: Client model vocabulary

**Files:**
- Modify: `src/app/undercity/services/undercity-models.ts` (`FlowReward` ~line 533; `SpaceEvent.gear.outcome` ~line 566; add `SpaceEvent.materials`)

- [ ] **Step 1: Extend `FlowReward['kind']`**

Change:
```typescript
export interface FlowReward {
  kind: 'spores' | 'item' | 'gear';
  cell: [number, number];
}
```
to:
```typescript
export interface FlowReward {
  kind: 'spores' | 'item' | 'gear' | 'molting';
  cell: [number, number];
}
```

- [ ] **Step 2: Extend the gear outcome + add materials on `SpaceEvent`**

Change the `gear` block:
```typescript
  gear?: {
    id: string;
    slot: string;
    tier: number;
    outcome: 'stashed' | 'stash-full';
    materials?: { moltings: number; ichor: number };
  };
```
to:
```typescript
  gear?: {
    id: string;
    slot: string;
    tier: number;
    outcome: 'equipped' | 'stashed' | 'stash-full';
    materials?: { moltings: number; ichor: number };
  };
  /** Crafting materials gained from this space (e.g. an Overgrown Cache molting
   *  pickup). Mirrors the server event's `materials`. */
  materials?: { moltings: number; ichor: number };
```

- [ ] **Step 3: Typecheck via build (run after Task 8; no standalone test)**

Deferred to Task 8's `npm run build`.

- [ ] **Step 4: Commit**

```bash
git add src/app/undercity/services/undercity-models.ts
git commit -m "feat(undercity): add molting reward + equipped/materials to client models"
```

---

## Task 7: Render the molting reward in the flow puzzle

**Files:**
- Modify: `src/app/undercity/tabs/flow-puzzle.component.ts` (`rewardIcon` ~line 357; `iconFor`/template ~line 72, 368)

- [ ] **Step 1: Distinguish ligature vs svg icons**

The other reward kinds use custom `svgIcon`s; moltings should use the Material `grass` ligature (the glyph the Plaza uses for moltings). Change the `rewardIcon` map and add a helper. Replace:
```typescript
  /** Registry name of the SVG icon for each reward kind. */
  private readonly rewardIcon: Record<FlowReward['kind'], string> = {
    spores: 'uc-spore',
    item: 'uc-pouch',
    gear: 'uc-chest',
  };
```
with:
```typescript
  /** Registry name of the SVG icon for each SVG-backed reward kind. Moltings use
   * the Material `grass` ligature instead (see `isLigatureReward`/template). */
  private readonly rewardIcon: Record<'spores' | 'item' | 'gear', string> = {
    spores: 'uc-spore',
    item: 'uc-pouch',
    gear: 'uc-chest',
  };

  /** Moltings render as a Material Icons ligature, not a registered SVG. */
  protected isLigatureReward(rw: FlowReward): boolean {
    return rw.kind === 'molting';
  }
```

Change `iconFor`:
```typescript
  protected iconFor(rw: FlowReward): string {
    return this.rewardIcon[rw.kind];
  }
```
to:
```typescript
  protected iconFor(rw: FlowReward): string {
    return rw.kind === 'molting' ? 'grass' : this.rewardIcon[rw.kind];
  }
```

- [ ] **Step 2: Update the template cell to branch on ligature vs svg**

In the component template, replace:
```html
                @if (rewardAt(ri, ci); as rw) {
                  <mat-icon class="reward-ic" [svgIcon]="iconFor(rw)"></mat-icon>
                }
```
with:
```html
                @if (rewardAt(ri, ci); as rw) {
                  @if (isLigatureReward(rw)) {
                    <mat-icon class="reward-ic">{{ iconFor(rw) }}</mat-icon>
                  } @else {
                    <mat-icon class="reward-ic" [svgIcon]="iconFor(rw)"></mat-icon>
                  }
                }
```

- [ ] **Step 3: Verify via build (Task 8).** No standalone test runner exists for the frontend.

- [ ] **Step 4: Commit**

```bash
git add src/app/undercity/tabs/flow-puzzle.component.ts
git commit -m "feat(undercity): render molting cache reward with the grass ligature"
```

---

## Task 8: Space-event modal — molting chip + reworded gear chip

**Files:**
- Modify: `src/app/undercity/tabs/board-tab.component.ts` (`eventHasChips` ~line 1083)
- Modify: `src/app/undercity/tabs/board-tab.component.html` (gear chip ~line 494-502)

- [ ] **Step 1: Count materials in `eventHasChips`**

Change:
```typescript
    const spores = ev.spores && ev.type !== 'loot';
    return !!(spores || ev.sporesLost || ev.hp || ev.item || ev.gear);
```
to:
```typescript
    const spores = ev.spores && ev.type !== 'loot';
    return !!(spores || ev.sporesLost || ev.hp || ev.item || ev.gear || ev.materials?.moltings);
```

- [ ] **Step 2: Rework the gear chip and add the molting chip**

In `board-tab.component.html`, replace the gear chip block:
```html
            @if (ev.gear && gearInfo(ev.gear.id); as g) {
              <span class="chip item">
                <mat-icon class="mi">{{ slotIcon(ev.gear.slot) }}</mat-icon>
                {{ g.name }}
                <span class="rarity-badge {{ tierRarity(g.tier).key }}">{{ tierRarity(g.tier).label }}</span>
                —
                {{ ev.gear.outcome === 'stashed' ? 'to stash' : 'stash full → materials' }}
              </span>
            }
```
with:
```html
            @if (ev.gear && gearInfo(ev.gear.id); as g) {
              <span class="chip item">
                <mat-icon class="mi">{{ slotIcon(ev.gear.slot) }}</mat-icon>
                {{ g.name }}
                <span class="rarity-badge {{ tierRarity(g.tier).key }}">{{ tierRarity(g.tier).label }}</span>
                @if (ev.gear.outcome === 'equipped') {
                  — equipped
                } @else if (ev.gear.outcome === 'stash-full') {
                  — → materials
                }
              </span>
            }
            @if (ev.materials?.moltings; as m) {
              <span class="chip gain"><mat-icon class="mi">grass</mat-icon> +{{ m }}</span>
            }
```

- [ ] **Step 3: Build the frontend (typecheck + template check)**

Run (from repo root):
```
npm run build
```
Expected: build succeeds with no TS/template errors. (Lint is known-broken in this repo — verify via build, not lint.)

- [ ] **Step 4: Commit**

```bash
git add src/app/undercity/tabs/board-tab.component.ts src/app/undercity/tabs/board-tab.component.html
git commit -m "feat(undercity): molting chip + friendly gear outcome in space-event modal"
```

---

## Task 9: Full verification

- [ ] **Step 1: Server suite green**

Run:
```
cd infrastructure/lambda && python -m pytest tests -q
```
Expected: all pass.

- [ ] **Step 2: Frontend build green**

Run (repo root):
```
npm run build
```
Expected: success.

- [ ] **Step 3: Manual smoke (optional, uses live AWS backend)**

Per the `run-undercity` skill: `npm start`, enter the Undercity, reach a loot tile, and confirm the cache shows a pouch + a `grass` molting pile (+ maybe a chest), that routing to the molting awards +1 molting with a `grass +1` chip, and that a gear grab reads "You unearth {name}…!" without the old "to stash" logistics.

- [ ] **Step 4: Note for the user**

Server changes require a `cdk deploy` (the user runs deploys). End here with tests + build green and flag the deploy.

---

## Self-Review Notes

- **Spec coverage:** Part A (moltings replace one pouch, 1/grab) → Tasks 1, 3, 6, 7, 8. Part B (reachability) → Tasks 2, 4. Part C (friendly message) → Tasks 5, 6 (type), 8 (chip). All covered.
- **Type consistency:** `FLOW_MOLTING_REWARD` (config→data), `cell_on_some_route(puzzle, cell)`, `_award_molting(doc)`, `_gear_find_text(drop)`, `FlowReward.kind` includes `'molting'`, `gear.outcome` includes `'equipped'`, `SpaceEvent.materials` — names used identically across server and client tasks.
- **No placeholders:** every code step shows full before/after.
- **Known coupling:** if any existing server test asserts the old `"— stashed!"` gear-find text, Task 5 Step 5 updates it.
