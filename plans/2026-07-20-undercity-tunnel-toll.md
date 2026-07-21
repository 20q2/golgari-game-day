# Undercity Tunnel Toll & Free Crossing — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Turn the Undercity biome-boundary tunnels from a hard Tier-1-only gate into a paid fast path: T1 crosses free, T2/T3 pay a tier-scaled Spore toll, and landing on a tunnel carries you across the boundary for free (consequence-free teleport).

**Architecture:** All rules live server-side in the Python Lambda. A tier-scaled toll table (`undercity_config.py`) plus a precomputed exit map (`undercity_data.py`) feed two touch points in `undercity_db.py`: the movement gate `_blocked_nodes` (blocks tunnels only when an evolved unit can't afford the toll) and the `_resolve_space` tunnel branch (relocates to the far side and charges the toll on landing). The Angular client mirror stops greying tunnels for evolved units and updates the descriptive blurb.

**Tech Stack:** Python 3.11 + pytest (in-memory FakeTable suite) for the backend; Angular 20 / TypeScript for the client mirror.

**Design doc:** [specs/2026-07-20-undercity-tunnel-toll-design.md](../specs/2026-07-20-undercity-tunnel-toll-design.md)

**Test command (backend):** from `infrastructure/lambda/`, run `python -m pytest tests -q`.
**Build check (client):** from repo root, run `npm run build` (lint is known-broken in this repo — verify with the build, not lint).

---

### Task 1: Toll config + precomputed tunnel exits

**Files:**
- Modify: `infrastructure/lambda/undercity_config.py` (near `TUNNEL_TIER_MAX`, ~L58)
- Modify: `infrastructure/lambda/undercity_data.py` (near `TUNNEL_NODES`, ~L838)
- Test: `infrastructure/lambda/tests/test_undercity_engine.py`

- [ ] **Step 1: Write the failing test**

Add to `tests/test_undercity_engine.py` (after the existing `test_tunnel_tier_max_is_one`, ~L1156):

```python
def test_tunnel_toll_table():
    assert data.TUNNEL_TOLL == {2: 8, 3: 16}


def test_tunnel_exits_cover_every_tunnel_with_a_biome_node():
    # Every tunnel node maps to a non-tunnel neighbour of its paired tunnel node.
    assert set(data.TUNNEL_EXITS) == set(data.TUNNEL_NODES)
    for nid, exit_node in data.TUNNEL_EXITS.items():
        assert data.MAP_NODES[exit_node]['type'] != 'tunnel'
        pair = next(x for x in data.MAP_NODES[nid]['neighbors']
                    if data.MAP_NODES[x]['type'] == 'tunnel')
        assert exit_node in data.MAP_NODES[pair]['neighbors']
    # Spot-check one known pair.
    assert data.TUNNEL_EXITS['t_cavern_bog0'] == 'bog_r1'
    assert data.TUNNEL_EXITS['t_cavern_bog1'] == 'cavern_r9'
```

- [ ] **Step 2: Run test to verify it fails**

Run: `cd infrastructure/lambda && python -m pytest tests/test_undercity_engine.py::test_tunnel_toll_table tests/test_undercity_engine.py::test_tunnel_exits_cover_every_tunnel_with_a_biome_node -v`
Expected: FAIL with `AttributeError: module 'undercity_data' has no attribute 'TUNNEL_TOLL'` (and `TUNNEL_EXITS`).

- [ ] **Step 3: Add the config toll table**

In `undercity_config.py`, immediately after the `TUNNEL_TIER_MAX = 1` block (~L58):

```python
# Spore toll an evolved unit pays to USE a tunnel (tier -> cost). Tiers <=
# TUNNEL_TIER_MAX travel free; a unit that cannot afford its toll is blocked
# from tunnels entirely (see _blocked_nodes in undercity_db.py). The client
# tunnel blurb mirrors this rule in prose only — no number is duplicated.
TUNNEL_TOLL = {2: 8, 3: 16}
```

- [ ] **Step 4: Re-export from data + precompute exits**

`undercity_data.py` re-exports config scalars for the engine/db to read as `data.*`. Find where `TUNNEL_TIER_MAX` is imported/assigned from config (search `TUNNEL_TIER_MAX`) and add `TUNNEL_TOLL` alongside it the same way. Then, right after the existing `TUNNEL_NODES = frozenset(...)` line (~L838), add:

```python
def _tunnel_exit(nid):
    """The far-biome node a unit lands on when it crosses this tunnel: the
    non-tunnel neighbour of this node's paired tunnel node."""
    pair = next(x for x in MAP_NODES[nid]['neighbors']
                if MAP_NODES[x]['type'] == 'tunnel')
    return next(x for x in MAP_NODES[pair]['neighbors']
                if MAP_NODES[x]['type'] != 'tunnel')

TUNNEL_EXITS = {nid: _tunnel_exit(nid) for nid in TUNNEL_NODES}
```

Note: if `TUNNEL_TIER_MAX` is referenced as `data.TUNNEL_TIER_MAX` but not literally assigned in `undercity_data.py` (e.g. it's `from undercity_config import *`), then `TUNNEL_TOLL` comes across automatically — confirm by checking how `TUNNEL_TIER_MAX` reaches `data.` and match it exactly. Only add an explicit assignment if `TUNNEL_TIER_MAX` has one.

- [ ] **Step 5: Run tests to verify they pass**

Run: `cd infrastructure/lambda && python -m pytest tests/test_undercity_engine.py -q -k "tunnel"`
Expected: PASS (including the two new tests and the existing `test_tunnel_*`).

- [ ] **Step 6: Commit**

```bash
git add infrastructure/lambda/undercity_config.py infrastructure/lambda/undercity_data.py infrastructure/lambda/tests/test_undercity_engine.py
git commit -m "feat(undercity): tunnel toll table + precomputed exits"
```

---

### Task 2: Toll-aware movement gate (`_blocked_nodes`)

**Files:**
- Modify: `infrastructure/lambda/undercity_db.py:272-277` (`_blocked_nodes`)
- Test: `infrastructure/lambda/tests/test_undercity_db.py:248-262` (rewrite `test_tier2_cannot_enter_a_tunnel`)

- [ ] **Step 1: Rewrite the gate tests**

Replace `test_tier2_cannot_enter_a_tunnel` (L248-262) in `tests/test_undercity_db.py` with two tests — a broke evolved unit stays blocked, a funded one is allowed:

```python
def test_broke_tier2_is_blocked_from_tunnels(table):
    act(table, 'join', starter='pest')
    sid = _sid(table)
    doc = db._get_player(table, sid, 'user-alex')
    doc['tier'] = 2
    doc['spores'] = data.TUNNEL_TOLL[2] - 1   # can't afford the toll
    doc['position'] = 'cavern_r2'
    assert data.TUNNEL_NODES == db._blocked_nodes(doc)
    dests = engine.legal_destinations(
        data.MAP_NODES, doc['position'], 1,
        db._closed_barriers(table, sid), db._blocked_nodes(doc))
    assert 't_bone_cavern1' not in dests
    # ...and cannot route THROUGH it either.
    dests2 = engine.legal_destinations(
        data.MAP_NODES, doc['position'], 2,
        db._closed_barriers(table, sid), db._blocked_nodes(doc))
    assert 't_bone_cavern0' not in dests2


def test_funded_tier2_may_enter_a_tunnel(table):
    act(table, 'join', starter='pest')
    sid = _sid(table)
    doc = db._get_player(table, sid, 'user-alex')
    doc['tier'] = 2
    doc['spores'] = data.TUNNEL_TOLL[2]       # exactly affordable
    doc['position'] = 'cavern_r2'
    assert db._blocked_nodes(doc) == frozenset()
    dests = engine.legal_destinations(
        data.MAP_NODES, doc['position'], 1,
        db._closed_barriers(table, sid), db._blocked_nodes(doc))
    assert 't_bone_cavern1' in dests
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `cd infrastructure/lambda && python -m pytest tests/test_undercity_db.py -q -k "tier2 or tunnel"`
Expected: `test_broke_tier2_is_blocked_from_tunnels` may pass already, but `test_funded_tier2_may_enter_a_tunnel` FAILS (current gate blocks all tier>1 regardless of spores).

- [ ] **Step 3: Make the gate toll-aware**

Replace `_blocked_nodes` (`undercity_db.py:272-277`) with:

```python
def _blocked_nodes(doc):
    """Nodes this unit may not step onto. Tier-1 units are barred from nothing.
    Evolved units (tier > TUNNEL_TIER_MAX) may use tunnels only if they can
    afford the tier toll (see _resolve_space); a unit that cannot afford it is
    barred from tunnels entirely — not a destination and not a pass-through."""
    tier = doc.get('tier', 1)
    if tier > data.TUNNEL_TIER_MAX:
        toll = data.TUNNEL_TOLL.get(tier, 0)
        if doc.get('spores', 0) < toll:
            return data.TUNNEL_NODES
    return frozenset()
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `cd infrastructure/lambda && python -m pytest tests/test_undercity_db.py -q -k "tier1 or tier2 or tunnel"`
Expected: PASS (`test_tier1_can_cross_a_tunnel`, `test_broke_tier2_is_blocked_from_tunnels`, `test_funded_tier2_may_enter_a_tunnel`, `test_tier2_standing_on_a_tunnel_can_still_leave`).

- [ ] **Step 5: Commit**

```bash
git add infrastructure/lambda/undercity_db.py infrastructure/lambda/tests/test_undercity_db.py
git commit -m "feat(undercity): tunnels open to funded evolved units"
```

---

### Task 3: Landing = consequence-free free crossing + occupants fix

**Files:**
- Modify: `infrastructure/lambda/undercity_db.py:1673-1677` (`_resolve_space` tunnel branch)
- Modify: `infrastructure/lambda/undercity_db.py:1450` (`_move` occupants) and `:2811-2818` (spell teleport occupants, mirror)
- Test: `infrastructure/lambda/tests/test_undercity_db.py:221-233` (replace `test_tunnel_landing_has_no_mechanical_effect`)

- [ ] **Step 1: Replace the landing test with crossing tests**

Replace `test_tunnel_landing_has_no_mechanical_effect` (L221-233) in `tests/test_undercity_db.py` with:

```python
def test_tier1_tunnel_landing_hops_across_for_free(table):
    act(table, 'join', starter='pest')
    sid = _sid(table)
    doc = db._get_player(table, sid, 'user-alex')
    doc['tier'] = 1
    doc['position'] = 't_cavern_bog0'
    doc['spores'] = 50
    before_hp = doc['hp']
    ev = db._resolve_space(table, sid, doc, 't_cavern_bog0', 'cavern_r9')
    assert ev['type'] == 'tunnel'
    assert ev['to'] == data.TUNNEL_EXITS['t_cavern_bog0']  # 'bog_r1'
    assert doc['position'] == data.TUNNEL_EXITS['t_cavern_bog0']
    assert doc['spores'] == 50           # T1 pays no toll
    assert doc['hp'] == before_hp        # consequence-free: no battle
    assert doc.get('pendingLoot') is None


def test_tier2_tunnel_landing_charges_the_toll(table):
    act(table, 'join', starter='pest')
    sid = _sid(table)
    doc = db._get_player(table, sid, 'user-alex')
    doc['tier'] = 2
    doc['position'] = 't_cavern_bog0'
    doc['spores'] = 50
    ev = db._resolve_space(table, sid, doc, 't_cavern_bog0', 'cavern_r9')
    assert ev['type'] == 'tunnel'
    assert ev['toll'] == data.TUNNEL_TOLL[2]
    assert doc['spores'] == 50 - data.TUNNEL_TOLL[2]
    assert doc['position'] == data.TUNNEL_EXITS['t_cavern_bog0']
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `cd infrastructure/lambda && python -m pytest tests/test_undercity_db.py -q -k "tunnel_landing"`
Expected: FAIL — current branch returns no `to`/`toll` keys and does not move `doc['position']`.

- [ ] **Step 3: Rewrite the tunnel branch**

Replace the `tunnel` branch in `_resolve_space` (`undercity_db.py:1673-1677`) with:

```python
    if ntype == 'tunnel':
        # Fast path between biomes. Tier-1 crosses free; evolved units pay a
        # tier toll (the movement gate already guaranteed they can afford it).
        # Landing carries you fully across to the far biome node for FREE and
        # is CONSEQUENCE-FREE — the far node's landing effect does not resolve.
        exit_node = data.TUNNEL_EXITS[node]
        tier = doc.get('tier', 1)
        toll = 0
        if tier > data.TUNNEL_TIER_MAX:
            toll = data.TUNNEL_TOLL.get(tier, 0)
            doc['spores'] = doc.get('spores', 0) - toll
        doc['position'] = exit_node
        return {'type': 'tunnel', 'to': exit_node, 'toll': toll,
                'text': 'You slip through the tunnel and out the far side.'}
```

- [ ] **Step 4: Report occupants of the final position in `_move`**

At `undercity_db.py:1450`, the `_move` occupants call currently uses the pre-relocation `to`. Change it to the final position:

```python
    occupants = _occupants(table, sid, doc['position'], doc['userId'])
    return _ok(doc, spaceEvent=space_event, occupants=occupants)
```

Apply the same `doc['position']`-instead-of-`to` fix to the spell-teleport occupants call at `undercity_db.py:2811-2818` (the block whose comment already says "_resolve_space may relocate again … report where"). If that call already uses `doc['position']`, leave it.

- [ ] **Step 5: Run tests to verify they pass**

Run: `cd infrastructure/lambda && python -m pytest tests/test_undercity_db.py -q -k "tunnel"`
Expected: PASS.

- [ ] **Step 6: Commit**

```bash
git add infrastructure/lambda/undercity_db.py infrastructure/lambda/tests/test_undercity_db.py
git commit -m "feat(undercity): tunnel landing hops across for free, charges toll"
```

---

### Task 4: Client mirror — stop greying tunnels, update blurb

**Files:**
- Modify: `src/app/undercity/engine/board-canvas.ts:620-625` (the `ownTier > 1` tunnel-lock block in `recomputeLocked`)
- Modify: `src/app/undercity/data/items.ts:280` (`SPACE_BLURBS.tunnel`)

- [ ] **Step 1: Remove the evolved-unit tunnel lock**

In `board-canvas.ts`, delete the block at ~L620-625:

```typescript
    // Evolved units (tier > 1) can't enter tunnels — grey them so it's legible.
    if (this.ownTier > 1) {
      for (const n of this.map.nodes) {
        if (n.type === 'tunnel') locked.add(n.id);
      }
    }
```

Leave the surrounding `const locked = ...` / `this.lockedIds = locked;` lines intact. The `ownTier` field and `setTier`/`recomputeLocked` plumbing may remain (harmless); only this block is removed. Server-provided move destinations already omit tunnels a unit can't afford.

- [ ] **Step 2: Update the tunnel blurb**

In `items.ts:280`, replace the `tunnel:` entry of `SPACE_BLURBS`:

```typescript
  tunnel: 'A shortcut between biomes. Tier-1 units cross free; evolved units pay Spores to use it. Land on it to be carried across to the far side for free.',
```

- [ ] **Step 3: Verify the client builds**

Run: `npm run build`
Expected: build succeeds (exit 0), no TypeScript errors referencing `board-canvas.ts` or `items.ts`.

- [ ] **Step 4: Commit**

```bash
git add src/app/undercity/engine/board-canvas.ts src/app/undercity/data/items.ts
git commit -m "feat(undercity): client reflects usable tunnels for evolved units"
```

---

### Task 5: Full suite green + final verification

**Files:** none (verification only)

- [ ] **Step 1: Run the full backend suite**

Run: `cd infrastructure/lambda && python -m pytest tests -q`
Expected: all tests pass. In particular the no-trap invariant in `tests/test_map.py` (Wilderness keeps all biomes reachable with `blocked=TUNNEL_NODES`) and the `test_map` sync check (map.json ↔ public/data/undercity-map.json) stay green — this change touches no map data, so both should be unaffected.

- [ ] **Step 2: Confirm the client build**

Run (repo root): `npm run build`
Expected: exit 0.

- [ ] **Step 3: Final commit (only if anything is uncommitted)**

```bash
git status
# If clean, nothing to do. Otherwise commit remaining changes with a descriptive message.
```

Note: do not run `cdk deploy` — the user deploys the Lambda themselves.

---

## Self-review notes

- **Spec coverage:** config toll (Task 1); exit map (Task 1); toll-aware gate (Task 2); consequence-free free hop + toll on landing (Task 3); occupants fix (Task 3); client de-grey + blurb (Task 4); tests incl. no-trap invariant (Tasks 1-3, 5).
- **Type/name consistency:** `TUNNEL_TOLL` (dict, tier→int), `TUNNEL_EXITS` (dict, node→node), `data.TUNNEL_TIER_MAX` — same names used across all tasks. Event dict keys `type`/`to`/`toll`/`text` consistent between Task 3 code and its tests.
- **No new map data**, so `sync_map.py` and the map-sync pytest are untouched.
