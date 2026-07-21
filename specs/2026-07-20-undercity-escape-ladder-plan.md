# Undercity Post-Boss Escape Ladder — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** After a player personally clears a biome's sigil lair, a rusty escape ladder appears beside that lair and, when landed on, teleports the player one-way out to the biome's surface mouth.

**Architecture:** Add one degree-1 "ladder" spur node per sigil lair (`<biome>_esc`) that neighbors only its lair. It is barred from movement (server) and hidden from render (client) until the lair is in the player's `poiClaims`. Landing on it relocates the player to `<biome>_lt` — the teleport-on-land pattern warp mushrooms already use — so it can never be walked *into* the lair.

**Tech Stack:** Python 3.11 Lambda engine (`infrastructure/lambda/`), pytest (in-memory FakeTable suite), Angular/TypeScript canvas client (`src/app/undercity/`).

Design: [specs/2026-07-20-undercity-escape-ladder-design.md](2026-07-20-undercity-escape-ladder-design.md).

**Test loop:** `cd infrastructure/lambda && python -m pytest tests -q`
**Client build:** `npm run build` (no TS test runner in this repo — build is the gate).

---

## File Structure

- `infrastructure/lambda/map.json` — **modify**: add 5 escape nodes, add reciprocal neighbor to each of the 5 sigil lairs.
- `public/data/undercity-map.json` — **regenerated** via `sync_map.py` (never hand-edited).
- `infrastructure/lambda/undercity_data.py` — **modify**: add `ESCAPE_LADDERS` constant; fix `dungeon_entrance()`.
- `infrastructure/lambda/undercity_db.py` — **modify**: `_blocked_nodes()` gating; `_wild_warp_dest()` exclusion; `_resolve_space()` ladder branch (exit teleport).
- `infrastructure/lambda/tests/test_deep_dungeons.py` — **modify**: add escape-ladder behavior tests.
- `infrastructure/lambda/tests/test_map.py` — **modify**: node count 267→272, ladder type count 10→15.
- `infrastructure/lambda/tests/test_map_file.py` — **modify**: node count 267→272.
- `infrastructure/lambda/tests/test_undercity_db.py` — **modify**: `test_broke_tier2_is_blocked_from_tunnels` blocked-set assertion.
- `src/app/undercity/engine/board-canvas.ts` — **modify**: hide escape nodes until the biome is cleared (3 render/hit-test loops).

---

## Task 1: Map nodes + data constant + entrance fix

**Files:**
- Modify: `infrastructure/lambda/map.json`
- Regenerate: `public/data/undercity-map.json`
- Modify: `infrastructure/lambda/undercity_data.py:747-754` (`dungeon_entrance`), and after `:841` (`SIGIL_LAIRS`)
- Modify: `infrastructure/lambda/tests/test_map.py:33` and `:50-56`
- Modify: `infrastructure/lambda/tests/test_map_file.py:20`
- Test: `infrastructure/lambda/tests/test_deep_dungeons.py`

- [ ] **Step 1: Add the `ESCAPE_LADDERS` constant**

In `undercity_data.py`, immediately after the `SIGIL_LAIRS` / `SIGILS_REQUIRED` block (around line 841-842), add:

```python
# Post-boss escape ladders: one dead-end 'ladder' spur off each sigil lair,
# revealed per-player once you hold that lair's claim (its node in poiClaims).
# Maps escape-node id -> its lair-node id. Landing on one teleports you one-way
# up to the biome's surface mouth (<biome>_lt); there is no edge back down, so it
# can never be used to skip into the lair. See specs/2026-07-20-undercity-escape-ladder-*.
ESCAPE_LADDERS = {b + '_esc': b + '_lair' for b in BIOMES}
```

- [ ] **Step 2: Fix `dungeon_entrance()` to always return the maze mouth**

There are now two depths ladders per pocket (the entrance mouth `<biome>_lb` and the escape spur `<biome>_esc`), so the old "first depths ladder found" scan is ambiguous. Replace `undercity_data.py:747-754`:

```python
def dungeon_entrance(biome):
    """The depths-side ladder MOUTH of a dungeon (`<biome>_lb`) — the respawn
    point for a death in that biome's dark. The post-boss escape ladder
    (`<biome>_esc`) is also a depths ladder, so match the mouth by name rather
    than by type."""
    mouth = biome + '_lb'
    return mouth if mouth in MAP_NODES else None
```

- [ ] **Step 3: Write the failing data test**

Add to the end of `infrastructure/lambda/tests/test_deep_dungeons.py`:

```python
@pytest.mark.parametrize('biome', sorted(data.BIOMES))
def test_escape_ladder_adjacent_to_each_sigil_lair(biome):
    esc, lair = biome + '_esc', biome + '_lair'
    assert data.ESCAPE_LADDERS[esc] == lair
    node = data.MAP_NODES[esc]
    assert node['type'] == 'ladder'
    assert node['region'] == 'depths'
    assert node['neighbors'] == [lair]          # degree-1 spur, only the lair
    assert esc in data.MAP_NODES[lair]['neighbors']  # reciprocal edge


@pytest.mark.parametrize('biome', sorted(data.BIOMES))
def test_dungeon_entrance_ignores_escape_ladder(biome):
    # The mouth (respawn point) is <biome>_lb, never the escape spur.
    assert data.dungeon_entrance(biome) == biome + '_lb'
```

- [ ] **Step 4: Run the tests to verify they fail**

Run: `cd infrastructure/lambda && python -m pytest tests/test_deep_dungeons.py -k "escape_ladder_adjacent or entrance_ignores" -q`
Expected: `test_dungeon_entrance_ignores_escape_ladder` PASSES (mouth already named `_lb`); `test_escape_ladder_adjacent_to_each_sigil_lair` FAILS with `KeyError: 'city_esc'` (the nodes don't exist yet).

- [ ] **Step 5: Add the 5 escape nodes to `map.json` and sync**

Do NOT hand-edit the 2500-line JSON. Run this deterministic, idempotent mutator from the repo root, then sync:

```bash
cd infrastructure/lambda && python - <<'PY'
import json
from pathlib import Path
p = Path('map.json')
doc = json.loads(p.read_text(encoding='utf-8'))
by_id = {n['id']: n for n in doc['nodes']}
# Escape spur placed just off each lair (world is 4200x2800; all in-bounds).
SPURS = {
    'city_esc':   (1720, 2660),
    'cavern_esc': ( 540, 1400),
    'bog_esc':    (3390,  700),
    'bone_esc':   ( 850, 2200),
    'garden_esc': (3230, 2310),
}
for esc, (x, y) in SPURS.items():
    biome = esc.split('_')[0]
    lair = biome + '_lair'
    assert lair in by_id, lair
    if esc not in by_id:  # idempotent
        doc['nodes'].append({'id': esc, 'type': 'ladder', 'x': x, 'y': y,
                             'region': 'depths', 'neighbors': [lair]})
    if esc not in by_id[lair]['neighbors']:
        by_id[lair]['neighbors'].append(esc)
# Match the existing file exactly: 1-space indent, LF, no trailing newline.
p.write_text(json.dumps(doc, indent=1, ensure_ascii=False),
             encoding='utf-8', newline='\n')
print('nodes:', len(doc['nodes']))
PY
python sync_map.py
```

- [ ] **Step 6: Sanity-check the diff is small**

Run: `cd infrastructure/lambda && git diff --stat map.json`
Expected: a handful of inserted/changed lines (5 new node blocks + 5 lair neighbor edits) — **not** the whole file. If every line shows changed, the dump formatting or newline style drifted; re-run Step 5 with the exact `indent=1` / `newline='\n'` args above before continuing.

- [ ] **Step 7: Update the map-count invariant tests**

In `tests/test_map.py`, bump `test_node_count` (line ~33). Add a version note and change the assertion:

```python
    # v13 (2026-07-20 escape ladders): +5 post-boss escape spurs, one dead-end
    # 'ladder' node off each sigil lair. See
    # specs/2026-07-20-undercity-escape-ladder-design.md.
    assert len(MAP_NODES) == 272
```

In `test_space_type_distribution` (the dict around line 50-56), change the `ladder` count from `10` to `15`:

```python
        'hazard': 45, 'warp': 5, 'shrine': 1, 'ladder': 15, 'lair': 6,
```

In `tests/test_map_file.py::test_map_file_exists_with_v2_sections` (line ~20), change:

```python
    assert len(doc['nodes']) == 272
```

- [ ] **Step 8: Run the full map + data test suites to verify green**

Run: `cd infrastructure/lambda && python -m pytest tests/test_map.py tests/test_map_file.py tests/test_deep_dungeons.py -q`
Expected: PASS. In particular `test_escape_ladder_adjacent_to_each_sigil_lair`, `test_dungeon_entrance_ignores_escape_ladder`, `test_client_copy_matches_source`, `test_node_count`, `test_space_type_distribution` all pass, and the existing `test_maze_is_large_dark_and_complete` (which asserts `types['ladder'] >= 1` per maze) still passes with two ladders per pocket.

- [ ] **Step 9: Commit**

```bash
git add infrastructure/lambda/map.json public/data/undercity-map.json \
        infrastructure/lambda/undercity_data.py \
        infrastructure/lambda/tests/test_map.py \
        infrastructure/lambda/tests/test_map_file.py \
        infrastructure/lambda/tests/test_deep_dungeons.py
git commit -m "feat(undercity): add post-boss escape ladder nodes + entrance fix"
```

---

## Task 2: Per-player movement gating

Bar the escape node from movement until the player holds the matching lair's claim.

**Files:**
- Modify: `infrastructure/lambda/undercity_db.py:272-277` (`_blocked_nodes`)
- Modify: `infrastructure/lambda/tests/test_undercity_db.py:264-279` (`test_broke_tier2_is_blocked_from_tunnels`)
- Test: `infrastructure/lambda/tests/test_deep_dungeons.py`

- [ ] **Step 1: Write the failing gating tests**

Add to `tests/test_deep_dungeons.py`:

```python
def test_escape_ladder_blocked_until_claimed(table):
    doc = _join(table)                       # fresh join: poiClaims empty
    assert set(data.ESCAPE_LADDERS) <= db._blocked_nodes(doc)
    doc['position'] = 'city_lair'
    dests = engine.legal_destinations(
        data.MAP_NODES, 'city_lair', 1,
        db._closed_barriers(table, _sid(table)), db._blocked_nodes(doc))
    assert 'city_esc' not in dests           # not reachable while unclaimed


def test_escape_ladder_reachable_once_claimed(table):
    doc = _join(table)
    doc['poiClaims'] = ['city_lair']         # you personally cleared this lair
    assert 'city_esc' not in db._blocked_nodes(doc)
    dests = engine.legal_destinations(
        data.MAP_NODES, 'city_lair', 1,
        db._closed_barriers(table, _sid(table)), db._blocked_nodes(doc))
    assert 'city_esc' in dests               # one hop off the lair
    # A lair you have NOT claimed stays barred even for a claimed player.
    assert 'bog_esc' in db._blocked_nodes(doc)
```

- [ ] **Step 2: Run to verify they fail**

Run: `cd infrastructure/lambda && python -m pytest tests/test_deep_dungeons.py -k escape_ladder_blocked -q` and `-k escape_ladder_reachable`
Expected: FAIL — `set(data.ESCAPE_LADDERS)` is not a subset of the current `_blocked_nodes` (which only returns tunnels/empty), so `city_esc` is wrongly reachable.

- [ ] **Step 3: Implement the gating in `_blocked_nodes`**

Replace `undercity_db.py:272-277`:

```python
def _blocked_nodes(doc):
    """Nodes this unit may not step ONTO (never a destination, never a corridor).
    Evolved units (tier > TUNNEL_TIER_MAX) are barred from tunnels. Post-boss
    escape ladders stay barred until you have personally cleared the matching
    sigil lair (its node in poiClaims) — that per-player gate is what makes the
    ladder 'appear' only for a player who beat the boss."""
    blocked = set()
    if doc.get('tier', 1) > data.TUNNEL_TIER_MAX:
        blocked |= data.TUNNEL_NODES
    claims = doc.get('poiClaims') or []
    for esc, lair in data.ESCAPE_LADDERS.items():
        if lair not in claims:
            blocked.add(esc)
    return frozenset(blocked)
```

- [ ] **Step 4: Fix the existing tunnel-block test that now also sees escape nodes**

`test_broke_tier2_is_blocked_from_tunnels` (a fresh player, no claims) now gets tunnels **and** all escape nodes blocked. Change its equality assertion at `tests/test_undercity_db.py:271`:

```python
    assert db._blocked_nodes(doc) == data.TUNNEL_NODES | set(data.ESCAPE_LADDERS)
```

(The two `legal_destinations` assertions below it about `t_bone_cavern1` are unaffected.)

- [ ] **Step 5: Run the affected tests to verify green**

Run: `cd infrastructure/lambda && python -m pytest tests/test_deep_dungeons.py tests/test_undercity_db.py -k "escape_ladder or tunnel or blocked" -q`
Expected: PASS.

- [ ] **Step 6: Commit**

```bash
git add infrastructure/lambda/undercity_db.py \
        infrastructure/lambda/tests/test_deep_dungeons.py \
        infrastructure/lambda/tests/test_undercity_db.py
git commit -m "feat(undercity): gate escape ladder behind personal lair claim"
```

---

## Task 3: Landing on the escape ladder exits to the surface

**Files:**
- Modify: `infrastructure/lambda/undercity_db.py:1661-1671` (`_resolve_space` ladder branch)
- Test: `infrastructure/lambda/tests/test_deep_dungeons.py`

- [ ] **Step 1: Write the failing exit test**

Add to `tests/test_deep_dungeons.py`:

```python
def test_landing_escape_ladder_exits_to_surface_mouth(table):
    doc = _join(table)
    doc['poiClaims'] = ['city_lair']
    doc['position'] = 'city_esc'
    doc['restsUsed'] = ['some_rest']         # left over from the descent
    ev = db._resolve_space(table, _sid(table), doc, 'city_esc', 'city_lair')
    assert ev['type'] == 'ladder'
    assert doc['position'] == 'city_lt'      # teleported up to the surface mouth
    assert doc['restsUsed'] == []            # leaving the depths resets rest


def test_landing_normal_entrance_ladder_does_not_teleport(table):
    doc = _join(table)
    doc['position'] = 'city_lb'              # the maze mouth, a normal ladder
    ev = db._resolve_space(table, _sid(table), doc, 'city_lb', None)
    assert ev['type'] == 'ladder'
    assert doc['position'] == 'city_lb'      # normal ladders don't relocate
```

- [ ] **Step 2: Run to verify it fails**

Run: `cd infrastructure/lambda && python -m pytest tests/test_deep_dungeons.py -k "landing_escape or landing_normal" -q`
Expected: `test_landing_escape_ladder_exits_to_surface_mouth` FAILS (`position` stays `city_esc`); `test_landing_normal_entrance_ladder_does_not_teleport` PASSES.

- [ ] **Step 3: Add the escape branch to `_resolve_space`**

Replace the `ladder` branch at `undercity_db.py:1661-1671`:

```python
    if ntype == 'ladder':
        if node in data.ESCAPE_LADDERS:
            # Post-boss shortcut: haul up to the surface mouth, one-way. No edge
            # back down exists, so this can never be used to skip into the lair.
            biome = data.dungeon_biome(node)
            doc['position'] = biome + '_lt'
            doc['restsUsed'] = []            # you're on the surface now
            return {'type': 'ladder',
                    'text': 'You haul yourself up the rusty escape ladder and '
                            'out of the depths, back to the surface.'}
        biome = data.dungeon_biome(node)
        if biome:
            where = 'back up to the surface'
        else:
            b = node.split('_')[0]
            dname = data.DUNGEONS.get(b, {}).get('name', 'the depths')
            where = f'down into {dname}'
        return {'type': 'ladder',
                'text': f'A rusted ladder bolted into the rock leads {where}. '
                        'Your next roll can carry you through.'}
```

- [ ] **Step 4: Run to verify green**

Run: `cd infrastructure/lambda && python -m pytest tests/test_deep_dungeons.py -k "landing_escape or landing_normal" -q`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add infrastructure/lambda/undercity_db.py infrastructure/lambda/tests/test_deep_dungeons.py
git commit -m "feat(undercity): escape ladder teleports one-way to surface mouth"
```

---

## Task 4: Keep wild warps off the escape ladders

A random ("wild") warp fling picks any non-POI node and does not consult `_blocked_nodes`; exclude escape spurs so an unclaimed player can't be flung onto one.

**Files:**
- Modify: `infrastructure/lambda/undercity_db.py:183-189` (`_wild_warp_dest`)
- Test: `infrastructure/lambda/tests/test_deep_dungeons.py`

- [ ] **Step 1: Write the failing exclusion test**

Add to `tests/test_deep_dungeons.py`:

```python
def test_wild_warp_never_targets_escape_ladder(monkeypatch):
    captured = {}

    class _Stub:
        def choice(self, seq):
            captured['opts'] = list(seq)
            return captured['opts'][0]

    monkeypatch.setattr(db, '_rng', _Stub())
    db._wild_warp_dest('cavern_r0')
    assert not (set(captured['opts']) & set(data.ESCAPE_LADDERS))
```

- [ ] **Step 2: Run to verify it fails**

Run: `cd infrastructure/lambda && python -m pytest tests/test_deep_dungeons.py -k wild_warp_never -q`
Expected: FAIL — the candidate list still contains the `_esc` nodes (type `ladder`, not in the `no_go` type set).

- [ ] **Step 3: Exclude escape nodes in `_wild_warp_dest`**

Replace `undercity_db.py:183-189`:

```python
def _wild_warp_dest(node):
    """A random legal node to be flung to — never into a POI, past a barrier, or
    onto a post-boss escape ladder (those are earned, per-player exits)."""
    no_go = {'boss', 'barrier', 'lair', 'vault'}
    options = [n for n, nd in data.MAP_NODES.items()
               if n != node and nd['type'] not in no_go
               and nd.get('region') != 'ruin'
               and n not in data.ESCAPE_LADDERS]
    return _rng.choice(options)
```

- [ ] **Step 4: Run to verify green**

Run: `cd infrastructure/lambda && python -m pytest tests/test_deep_dungeons.py -k wild_warp_never -q`
Expected: PASS.

- [ ] **Step 5: Run the whole Lambda suite**

Run: `cd infrastructure/lambda && python -m pytest tests -q`
Expected: all green (no regressions in `test_undercity_db`, `test_undercity_spells`, `test_map*`, etc.).

- [ ] **Step 6: Commit**

```bash
git add infrastructure/lambda/undercity_db.py infrastructure/lambda/tests/test_deep_dungeons.py
git commit -m "feat(undercity): exclude escape ladders from wild-warp destinations"
```

---

## Task 5: Client — hide the escape ladder until the dungeon is cleared

The board client already tracks `clearedDungeons` (biome keys you hold the sigil for) and locks/hides nodes per-player. Escape spurs are reachable from the lair, so BFS-based locking won't hide them — add an explicit "hidden until cleared" gate. Server already withholds the node from move choices for unclaimed players, so this is purely visual/consistency.

**Files:**
- Modify: `src/app/undercity/engine/board-canvas.ts` (add helper near line 308; three loops at ~874, ~971, ~1093)

- [ ] **Step 1: Add the `isHiddenEscape` helper**

In `board-canvas.ts`, just after the `clearedDungeons` field / its getter block (around line 308-314), add:

```typescript
  /**
   * A post-boss escape ladder (`<biome>_esc`) stays hidden until you hold that
   * dungeon's sigil — this is the "appears once you beat the boss" moment. The
   * server independently withholds it from move choices while unclaimed.
   */
  private isHiddenEscape(nodeId: string): boolean {
    if (!nodeId.endsWith('_esc')) return false;
    return !this.clearedDungeons.has(nodeId.split('_')[0]);
  }
```

- [ ] **Step 2: Gate the tap hit-test loop**

At `board-canvas.ts:874`, change:

```typescript
      if (!this.inActive(n.id)) continue; // hidden-layer nodes aren't tappable
```
to:
```typescript
      if (!this.inActive(n.id) || this.isHiddenEscape(n.id)) continue; // hidden-layer / unclaimed-escape nodes aren't tappable
```

- [ ] **Step 3: Gate the space-render loop**

At `board-canvas.ts:971`, change:

```typescript
      if (!this.inActive(n.id) || !this.isLit(n.id)) continue;
      this.drawSpace(n, elapsed);
```
to:
```typescript
      if (!this.inActive(n.id) || !this.isLit(n.id) || this.isHiddenEscape(n.id)) continue;
      this.drawSpace(n, elapsed);
```

- [ ] **Step 4: Gate the fog-reveal loop**

At `board-canvas.ts:1093` (inside the fog `destination-out` loop), change:

```typescript
      if (!this.inActive(n.id) || !this.isLit(n.id)) continue;
```
to:
```typescript
      if (!this.inActive(n.id) || !this.isLit(n.id) || this.isHiddenEscape(n.id)) continue;
```

- [ ] **Step 5: Build the client to verify it compiles**

Run: `npm run build`
Expected: build succeeds with no TypeScript errors. (There is no TS unit-test runner in this repo — the production build is the compile-time gate.)

- [ ] **Step 6: Commit**

```bash
git add src/app/undercity/engine/board-canvas.ts
git commit -m "feat(undercity): reveal escape ladder on board only once dungeon is cleared"
```

---

## Verification (whole feature)

- [ ] `cd infrastructure/lambda && python -m pytest tests -q` — all green.
- [ ] `npm run build` — client compiles.
- [ ] `git diff --stat` on `map.json` shows only the intended small change (5 nodes + 5 neighbor edits), and `public/data/undercity-map.json` is byte-identical to the source (guarded by `test_client_copy_matches_source`).
- [ ] Note for the user: a Lambda + client deploy is required to see this live (the user runs deploys themselves).

## Self-Review

**Spec coverage:**
- Map: 5 `<biome>_esc` nodes + reciprocal lair neighbors → Task 1. ✔
- `ESCAPE_LADDERS` constant + `dungeon_entrance` fix → Task 1. ✔
- Per-player gating via `_blocked_nodes`/`poiClaims` → Task 2. ✔
- `_wild_warp_dest` exclusion → Task 4. ✔
- Teleport-on-land to `<biome>_lt` in `_resolve_space` → Task 3. ✔
- Client hide-until-claimed → Task 5. ✔
- Test updates (node count 272, ladder 15, tier2 blocked-set) → Tasks 1, 2. ✔
- New behavioral tests (adjacency, blocked/reachable, teleport, entrance, wild-warp) → Tasks 1-4. ✔

**Placeholder scan:** none — every code/step block is concrete.

**Type/name consistency:** `ESCAPE_LADDERS` (dict esc→lair), `_blocked_nodes`, `_wild_warp_dest`, `_resolve_space`, `dungeon_entrance`, `dungeon_biome`, `isHiddenEscape`, node ids `<biome>_esc` / `<biome>_lb` / `<biome>_lt` used identically across all tasks. Escape node type is `'ladder'` throughout. Surface destination is `biome + '_lt'` in both design and Task 3.
