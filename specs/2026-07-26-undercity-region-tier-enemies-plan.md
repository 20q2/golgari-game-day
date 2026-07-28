# Region-Gated Enemy Tiers — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Make Undercity enemy difficulty depend on *which region* a space is in (city=T1, ruin/depths=T2, wilderness/isle=T3), replacing the depth-gated dungeon ladder.

**Architecture:** Add a `REGION_TIER` map + `TIER_NPCS` pools (composed from the existing rosters, nothing deleted) + a `region_tier()` resolver in `undercity_data.py`; rewrite `_wild_battle`'s region dispatch in `undercity_db.py` to `region → tier → pool[wild|elite]` and delete the depth-gated `_depths_enemy`. Server-only; no client change.

**Tech Stack:** Python 3.11 + pytest (in-memory FakeTable suite).

**Spec:** [specs/2026-07-26-undercity-region-tier-enemies-design.md](2026-07-26-undercity-region-tier-enemies-design.md)

**Test command (from `infrastructure/lambda`):** `python -m pytest tests -q`

> **Commit note:** the user keeps parallel WIP in `undercity_data.py`, `undercity_db.py`, `test_undercity_db.py`, and `map.json`. The `git commit` steps below are the plan's default; during inline execution, leave staging/committing to the user (make edits + get tests green, don't commit).

---

## File Structure
- `infrastructure/lambda/undercity_data.py` — add `REGION_TIER`, `TIER_NPCS`, `region_tier()` near the enemy pools (all existing pool lists stay).
- `infrastructure/lambda/undercity_db.py` — rewrite the region dispatch in `_wild_battle`; delete `_depths_enemy`.
- `infrastructure/lambda/tests/test_undercity_db.py` — add region→tier selection tests; replace the depth-ladder tests that assert deleted behavior.

Untouched (verified dependencies): `sim/arena.py` and the roster-integrity / enemy-level tests read the raw pool lists, which are unchanged. `DUNGEON_NPCS` and `_node_depth` stay defined (map contract + a passing test depend on them); they simply go unused by combat.

---

## Task 1: Data tables — `REGION_TIER`, `TIER_NPCS`, `region_tier()`

**Files:**
- Modify: `infrastructure/lambda/undercity_data.py` (after the `ISLE_APEX` list, ~line 943)
- Test: `infrastructure/lambda/tests/test_undercity_db.py`

- [ ] **Step 1: Write the failing test**

Append to `infrastructure/lambda/tests/test_undercity_db.py`:

```python
# ── Region-gated enemy tiers (design 2026-07-26-region-tier) ──────────────────

def test_region_tier_mapping():
    assert data.region_tier('city') == 1
    assert data.region_tier('garden') == 1 and data.region_tier('bog') == 1
    assert data.region_tier('ruin') == 2 and data.region_tier('depths') == 2
    assert data.region_tier('wilderness') == 3 and data.region_tier('isle') == 3
    assert data.region_tier('anything_else') == 1   # safe default
    assert data.region_tier(None) == 1


def test_tier_pools_compose_existing_rosters():
    t = data.TIER_NPCS
    assert t[1]['wild'] is data.NPCS and t[1]['elite'] is data.ELITE_NPCS
    assert t[2]['wild'] is data.DEPTHS_MID and t[2]['elite'] is data.WILDERNESS_NPCS
    assert {n['id'] for n in t[3]['wild']} == (
        {n['id'] for n in data.DEPTHS_DEEP} | {n['id'] for n in data.WILDERNESS_ELITE_NPCS})
    assert {n['id'] for n in t[3]['elite']} == (
        {n['id'] for n in data.DEPTHS_ABYSS} | {n['id'] for n in data.ISLE_APEX})


def test_tier_wild_hp_ceilings_ascend():
    hp = lambda pool: max(n['hp'] for n in pool)
    assert hp(data.TIER_NPCS[1]['wild']) < hp(data.TIER_NPCS[2]['wild']) < hp(data.TIER_NPCS[3]['wild'])
```

- [ ] **Step 2: Run to verify it fails**

Run: `python -m pytest tests/test_undercity_db.py -k "region_tier or tier_pools or tier_wild" -q`
Expected: FAIL — `AttributeError: module 'undercity_data' has no attribute 'region_tier'` / `TIER_NPCS`.

- [ ] **Step 3: Add the tables + resolver**

In `infrastructure/lambda/undercity_data.py`, immediately after the `ISLE_APEX = [ ... ]` list (before the `enemy_level` section), add:

```python
# ── Region-gated enemy tiers (design 2026-07-26-region-tier) ─────────────────
# Difficulty is WHERE you are, not how deep you dig. Region -> tier -> (wild,
# elite) pool. Wild = the tier's baseline; elite = the tougher members of the
# SAME tier (elites never jump a tier). Pools are composed from the existing
# rosters by reference — nothing is deleted, so sim/ and roster tests are intact.
REGION_TIER = {
    'city': 1, 'garden': 1, 'bone': 1, 'cavern': 1, 'bog': 1,
    'ruin': 2, 'depths': 2,
    'wilderness': 3, 'isle': 3,
}

TIER_NPCS = {
    1: {'wild': NPCS,       'elite': ELITE_NPCS},
    2: {'wild': DEPTHS_MID, 'elite': WILDERNESS_NPCS},
    3: {'wild': DEPTHS_DEEP + WILDERNESS_ELITE_NPCS,
        'elite': DEPTHS_ABYSS + ISLE_APEX},
}


def region_tier(region):
    """Difficulty tier (1-3) for a board region; unknown/None -> 1 (safe)."""
    return REGION_TIER.get(region or '', 1)
```

- [ ] **Step 4: Run to verify it passes**

Run: `python -m pytest tests/test_undercity_db.py -k "region_tier or tier_pools or tier_wild" -q`
Expected: PASS (3 tests).

- [ ] **Step 5: Commit** (see Commit note — skip during inline execution)

```bash
git add infrastructure/lambda/undercity_data.py infrastructure/lambda/tests/test_undercity_db.py
git commit -m "feat(undercity): region->tier enemy pools (REGION_TIER, TIER_NPCS)"
```

---

## Task 2: Rewrite `_wild_battle` selection + delete `_depths_enemy`

**Files:**
- Modify: `infrastructure/lambda/undercity_db.py` — `_wild_battle` region block (~lines 3099-3113) and delete `_depths_enemy` (~lines 3072-3083)
- Test: `infrastructure/lambda/tests/test_undercity_db.py`

- [ ] **Step 1: Write the failing tests**

Append to `infrastructure/lambda/tests/test_undercity_db.py`:

```python
def test_city_wild_and_elite_use_tier1(table):
    act(table, 'join', starter='pest')
    sid = _sid(table)
    doc = db._get_player(table, sid, 'user-alex')
    wild = db._wild_battle(table, sid, doc, region='city')
    assert wild['npc']['id'] in {n['id'] for n in data.NPCS}
    elite = db._wild_battle(table, sid, doc, region='city', elite=True)
    assert elite['npc']['id'] in {n['id'] for n in data.ELITE_NPCS}


def test_ruin_is_tier2_not_tier1(table):
    """The bug this fixes: the Ruinways used to fall through to tier-1 NPCS."""
    act(table, 'join', starter='pest')
    sid = _sid(table)
    doc = db._get_player(table, sid, 'user-alex')
    ev = db._wild_battle(table, sid, doc, region='ruin')
    assert ev['npc']['id'] in {n['id'] for n in data.DEPTHS_MID}
    assert ev['npc']['id'] not in {n['id'] for n in data.NPCS}


def test_depths_is_flat_tier2_regardless_of_depth(table):
    """No more depth ladder: a shallow AND a deep depths node both pull tier 2."""
    sid = _sid(table)
    mid_ids = {n['id'] for n in data.DEPTHS_MID}
    for node in ('city_lb', 'city_d1'):           # both region='depths'
        _, doc = _player_at(table, node)
        ids = {db._wild_battle(table, sid, doc)['npc']['id'] for _ in range(20)}
        assert ids and ids <= mid_ids, (node, ids)


def test_wilderness_and_isle_use_tier3(table):
    act(table, 'join', starter='pest')
    sid = _sid(table)
    doc = db._get_player(table, sid, 'user-alex')
    t3_wild = {n['id'] for n in data.DEPTHS_DEEP} | {n['id'] for n in data.WILDERNESS_ELITE_NPCS}
    t3_elite = {n['id'] for n in data.DEPTHS_ABYSS} | {n['id'] for n in data.ISLE_APEX}
    for region in ('wilderness', 'isle'):
        w = {db._wild_battle(table, sid, doc, region=region)['npc']['id'] for _ in range(30)}
        assert w and w <= t3_wild, (region, w)
        e = {db._wild_battle(table, sid, doc, region=region, elite=True)['npc']['id'] for _ in range(30)}
        assert e and e <= t3_elite, (region, e)
```

- [ ] **Step 2: Run to verify they fail**

Run: `python -m pytest tests/test_undercity_db.py -k "ruin_is_tier2 or flat_tier2 or wilderness_and_isle or city_wild_and_elite" -q`
Expected: FAIL — `ruin` still returns tier-1 NPCS; `depths`/`wilderness`/`isle` still use the old ladder/pools.

- [ ] **Step 3: Rewrite the `_wild_battle` region dispatch**

In `infrastructure/lambda/undercity_db.py`, replace the region-selection block in `_wild_battle` (from `node = _season_map(...)` through the `spec = ...` assignments, currently ~lines 3099-3113):

```python
    node = _season_map(table, sid).get(position)
    node_region = region or (node.get('region') if node else None)
    if node_region is None and data.dungeon_biome(position):
        node_region = 'depths'
    if node_region == 'depths':
        biome = position.split('_')[0]
        if biome not in data.BIOMES:
            biome = data.DEFAULT_BIOME
        spec = _depths_enemy(biome, _node_depth(table, sid, position), elite)
    elif node_region == 'wilderness':
        spec = _rng.choice(data.WILDERNESS_ELITE_NPCS if elite else data.WILDERNESS_NPCS)
    elif node_region == 'isle':
        spec = _rng.choice(data.ISLE_APEX)       # the boss approach is apex ground
    else:
        spec = _rng.choice(data.ELITE_NPCS if elite else data.NPCS)
    npc = engine.npc_from_spec(spec)
```

with:

```python
    node = _season_map(table, sid).get(position)
    node_region = region or (node.get('region') if node else None)
    if node_region is None and data.dungeon_biome(position):
        node_region = 'depths'
    # Difficulty is region-gated: region -> tier -> (wild|elite) pool. Flat within
    # a region — no depth scaling (design 2026-07-26-region-tier).
    tier = data.region_tier(node_region)
    pool = data.TIER_NPCS[tier]['elite' if elite else 'wild']
    spec = _rng.choice(pool)
    npc = engine.npc_from_spec(spec)
```

- [ ] **Step 4: Delete the dead `_depths_enemy`**

In `infrastructure/lambda/undercity_db.py`, remove the entire `_depths_enemy` function (its docstring + body, ~lines 3072-3083). Leave `_node_depth` in place (still tested, harmless).

- [ ] **Step 5: Run the new tests to verify they pass**

Run: `python -m pytest tests/test_undercity_db.py -k "ruin_is_tier2 or flat_tier2 or wilderness_and_isle or city_wild_and_elite" -q`
Expected: PASS (4 tests).

- [ ] **Step 6: Commit** (skip during inline execution)

```bash
git add infrastructure/lambda/undercity_db.py infrastructure/lambda/tests/test_undercity_db.py
git commit -m "feat(undercity): region-gated enemy selection; remove depth ladder"
```

---

## Task 3: Fix the tests that asserted deleted (depth-ladder) behavior

Running the full suite now fails on the old depth-ladder tests. Update each to the new model.

**Files:**
- Modify: `infrastructure/lambda/tests/test_undercity_db.py`

- [ ] **Step 1: Run the full suite to see exactly what breaks**

Run: `python -m pytest tests -q`
Expected: FAIL in `test_undercity_db.py` on: `test_wilderness_wild_space_uses_wilderness_pool`, `test_wilderness_elite_space_uses_wilderness_elite_pool`, `test_depths_rung_scales_with_depth`, `test_depths_elite_spikes_one_rung`, `test_isle_battles_are_apex`, `test_dungeon_wild_is_the_biome_fauna`.

- [ ] **Step 2: Replace `test_wilderness_wild_space_uses_wilderness_pool` and `test_wilderness_elite_space_uses_wilderness_elite_pool`**

These now duplicate `test_wilderness_and_isle_use_tier3` (Task 2). Delete both — the Task-2 test covers wilderness wild + elite against the tier-3 pools.

- [ ] **Step 3: Delete the depth-ladder tests and their helper**

Delete `test_depths_rung_scales_with_depth`, `test_depths_elite_spikes_one_rung`, and `test_isle_battles_are_apex` (all assert the deleted ladder / old isle-apex-wild). Also delete the now-unused `_depths_node_at` helper (only those tests used it). The flat-depths behavior is covered by `test_depths_is_flat_tier2_regardless_of_depth` (Task 2).

Keep `test_depths_ladder_hp_is_monotonic` (pure roster-HP ordering — still valid, the lists are unchanged) and `test_node_depth_zero_at_mouth_and_grows_inward` (`_node_depth` retained).

- [ ] **Step 4: Rewrite `test_dungeon_wild_is_the_biome_fauna`**

`city_d1` is region `depths` → now tier 2. Replace the test body:

```python
def test_depths_wild_is_tier2(table, monkeypatch):
    sid, doc = _player_at(table, 'city_d1')  # a depths (dungeon) wild space
    ev = db._wild_battle(table, sid, doc)
    assert ev['type'] == 'battle_start'
    assert ev['npc']['id'] in {n['id'] for n in data.DEPTHS_MID}
    se = _finish_started_battle(table, monkeypatch, doc, 'attacker')
    assert se['spores'] >= min(n['bounty'] for n in data.DEPTHS_MID)
```

- [ ] **Step 5: Run the full suite to verify green**

Run: `python -m pytest tests -q`
Expected: PASS (all tests).

- [ ] **Step 6: Commit** (skip during inline execution)

```bash
git add infrastructure/lambda/tests/test_undercity_db.py
git commit -m "test(undercity): update enemy-selection tests to the region-tier model"
```

---

## Task 4: Update the combat reference doc

**Files:**
- Modify: `specs/undercity-combat.md`

- [ ] **Step 1: Update the tuning-knobs / enemy-selection material**

In `specs/undercity-combat.md`, find the section describing enemy selection / the depths ladder (search for `depths` / `_depths_enemy` / "difficulty"). Replace the depth-ladder description with the region-tier model: enemies are chosen by `region → data.region_tier() → data.TIER_NPCS[tier]['wild'|'elite']` in `_wild_battle`; city+surfaces = T1, ruin+depths = T2, wilderness+isle = T3; flat within a region; elites are the same tier's tougher pool. Note the depth ladder (`_depths_enemy`) was removed and reference the design doc `2026-07-26-undercity-region-tier-enemies-design.md`.

- [ ] **Step 2: Commit** (skip during inline execution)

```bash
git add specs/undercity-combat.md
git commit -m "docs(undercity): document region-gated enemy tiers"
```

---

## Final verification
- [ ] `python -m pytest tests -q` (from `infrastructure/lambda`) → all green.
- [ ] `grep -rn "_depths_enemy" infrastructure/lambda` → only the design/combat docs mention it (no code refs).
- [ ] Note for the user: this is a backend change — a `cdk deploy` is needed before the live game reflects it.

## Notes / gotchas
- **Compose, don't delete:** `TIER_NPCS` references the existing lists. `sim/arena.py`, `test_undercity_enemy_level.py`, and the roster-integrity tests all read the raw lists and must keep passing.
- **`DUNGEON_NPCS` stays:** the map's per-dungeon `wild` field references its ids and `test_map.py` asserts that contract; it's just unused by combat now.
- **`_node_depth` stays:** now unused by combat but still covered by `test_node_depth_zero_at_mouth_and_grows_inward`. Leave it.
- **Theme drift is intentional and accepted** (wilderness-named foes in tier-2 ruin/depths) — see spec §7. Do not rename monsters in this plan.
