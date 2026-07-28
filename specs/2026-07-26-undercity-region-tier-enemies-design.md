# The Undercity — Region-Gated Enemy Tiers

**Status:** design · 2026-07-26 (approved for planning)
**Companion:** [undercity-combat.md](undercity-combat.md) (living reference — update when this lands)
**Supersedes (partially):** [2026-07-26-undercity-enemy-ladder-design.md](2026-07-26-undercity-enemy-ladder-design.md) — that design made dungeon difficulty *depth-gated* (tier 1→apex by hop-distance). This replaces the **selection model** with a flat, region-gated one. The enemy roster it built (MID / DEEP / ABYSS / ISLE pools) is kept and reused; only *how a foe is chosen* changes.

## 1. Problem

After labelling every spawn zone, the observed difficulty doesn't match the region labels:

- **Ruinways (`ruin`)** has no enemy pool of its own, so it falls through to the base `NPCS` → reads as **tier 1**, when it should be a mid step.
- **The Depths (`depths`)** scales tier 1→3+ by how deep the node sits (`_depths_enemy`), so a single dungeon spans the whole difficulty range instead of being a coherent mid-tier zone.
- The intended mental model — **city = tier 1, dungeons = tier 2 (mid-level accessible), wilderness = tier 3** — isn't what the map delivers.

## 2. Goal

Difficulty is decided by **which region you're in**, not how deep you dig. Region → tier → enemy pool, flat within a region. Travelling into a tougher region is the deliberate difficulty step.

**Non-goals:** no change to combat math, XP/bounty economy, the map graph, or monster stat blocks (only their *grouping* into tiers changes). No new monsters.

## 3. Region → tier map

| Tier | Regions |
| --- | --- |
| **1** | `city`, `garden`, `bone`, `cavern`, `bog` (the Undercity + four biome surfaces) |
| **2** | `ruin` (Ruinways), `depths` (The Depths) |
| **3** | `wilderness` (Ashen Wilds), `isle` (Floating Isle) |

Any region not listed defaults to **tier 1** (safe fallback).

## 4. Tier → enemy pools

The existing ~20 monsters are re-bucketed by HP into a monotonic 3-tier curve. **Wild** = the tier's baseline; **elite** = the tougher members of the *same* tier (elites do NOT jump a tier — per decision). Every existing list is reused by *reference* (composition), so `sim/arena.py` and the roster-integrity tests keep working; no monster is deleted.

| Tier | Wild pool | Elite pool |
| --- | --- | --- |
| **1** | `NPCS` (Drudge Beetle 22, Sewer Shambler 30, Myconid 34) | `ELITE_NPCS` (Fetid Imp 30, Rot Shambler 32) |
| **2** | `DEPTHS_MID` (Glutton Maw 44, Chittering 42, Rotwing 48, Bonemortar 56) | `WILDERNESS_NPCS` (Ashen Stalker 48, Cinder Wolf 46, Wastes Marauder 52, Bramble Horror 58) |
| **3** | `DEPTHS_DEEP` + `WILDERNESS_ELITE_NPCS` (60–80 HP, 7 foes) | `DEPTHS_ABYSS` + `ISLE_APEX` (104–150 HP, 6 foes) |

HP bands ascend cleanly: T1 22–34 → T2 wild 42–56 / elite 46–58 → T3 wild 60–80 / elite 104–150. The 150-HP ceiling survives, so a maxed leader still faces a real fight in tier 3 (the ceiling the ladder design added is preserved — it just lives in the wilderness/isle, not deep floors).

## 5. Implementation

### Data — `infrastructure/lambda/undercity_data.py`
Keep every existing pool list as-is. Add two tables near the enemy pools:

```python
# Region -> difficulty tier. Difficulty is where you ARE, not how deep you dig
# (design 2026-07-26-region-tier). Unlisted regions default to tier 1.
REGION_TIER = {
    'city': 1, 'garden': 1, 'bone': 1, 'cavern': 1, 'bog': 1,
    'ruin': 2, 'depths': 2,
    'wilderness': 3, 'isle': 3,
}

# Tier -> (wild, elite) foe pools. Wild = the tier's baseline; elite = the
# tougher members of the SAME tier (elites never jump a tier). Composed from the
# existing rosters (reused by reference, nothing deleted).
TIER_NPCS = {
    1: {'wild': NPCS,        'elite': ELITE_NPCS},
    2: {'wild': DEPTHS_MID,  'elite': WILDERNESS_NPCS},
    3: {'wild': DEPTHS_DEEP + WILDERNESS_ELITE_NPCS,
        'elite': DEPTHS_ABYSS + ISLE_APEX},
}
```

Add a tiny resolver so the rule lives with the data:

```python
def region_tier(region):
    return REGION_TIER.get(region or '', 1)
```

### Selection — `infrastructure/lambda/undercity_db.py`
Rewrite the region dispatch in `_wild_battle`. Resolve region exactly as today (season-map node region, else the `depths` fallback via `dungeon_biome`), then pick from the tier pool:

```python
    node = _season_map(table, sid).get(position)
    node_region = region or (node.get('region') if node else None)
    if node_region is None and data.dungeon_biome(position):
        node_region = 'depths'
    tier = data.region_tier(node_region)
    pool = data.TIER_NPCS[tier]['elite' if elite else 'wild']
    spec = _rng.choice(pool)
    npc = engine.npc_from_spec(spec)
```

- **Delete `_depths_enemy`** (the depth-gated ladder) and its only call site.
- **Keep `_node_depth`** — it becomes unused by combat but is a tested helper and harmless; leave it and its test in place. (Flag if a later pass wants to prune it.)
- `DUNGEON_NPCS` stays defined and unchanged: the map's per-dungeon `wild` field references its ids and `test_map.py` asserts that contract. It's simply no longer used for combat selection.

### Client
No client change required — enemy selection is server-only and the foe arrives with each battle payload (name/stats/derived level). No mirror to update.

## 6. Testing (`infrastructure/lambda/tests`)

**New — region→tier selection (`test_undercity_db.py`):**
- A `city` (tier-1) wild fight draws from `NPCS`; a `city` elite draws from `ELITE_NPCS`.
- A `ruin` wild fight draws from `DEPTHS_MID` (tier 2), not `NPCS` — the bug this fixes.
- A `depths` wild fight draws from `DEPTHS_MID` **regardless of depth** — assert a shallow node and a deep node both pull the tier-2 pool (proves the ladder is gone).
- A `wilderness` wild fight draws from `DEPTHS_DEEP ∪ WILDERNESS_ELITE_NPCS`; a `wilderness`/`isle` elite draws from `DEPTHS_ABYSS ∪ ISLE_APEX`.
- `data.region_tier('unknown')` → 1.
- Monotonic-ceiling sanity: `max hp` of tier N wild ≤ `max hp` of tier N+1 wild.

**Update / remove — depth-ladder tests:**
- The `_depths_enemy` rung-selection tests (shallow→themed fauna, mid/deep/abyss by depth, elite-spikes-a-rung) assert behaviour being deleted — replace them with the flat-depths assertion above.
- The test expecting a depths `city` fight to pay `DUNGEON_NPCS['city']['bounty']` must change to a `DEPTHS_MID` bounty (depths is tier 2 now).
- Roster-ordering / integrity tests that only read the raw lists (e.g. `min(WILDERNESS_NPCS) > max(NPCS)`, the all-pools iteration, enemy-level calibration) keep passing — the lists are unchanged.

**Green bar:** `cd infrastructure/lambda && python -m pytest tests -q`.

## 7. Accepted tradeoffs
- **Supersedes the depth-ladder selection.** Endgame challenge is region-gated (go to wilderness/isle) rather than depth-gated. Ceiling (150 HP) preserved.
- **Theme drift:** wilderness-named foes (Ashen Stalker, Cinder Wolf) now populate tier-2 `ruin`/`depths`, and depths-named foes appear in tier-3 `wilderness`/`isle`. Difficulty reads correctly; names may feel slightly off-region. Optional future rename — not in scope.
- **`_node_depth` / `DUNGEON_NPCS`** are retained as unused-by-combat (tests + map contract depend on them); not pruned here.

## 8. Out of scope
- Renaming monsters to match their new home regions.
- Re-tuning individual stat blocks (only regrouping).
- Any map-graph, economy, or combat-math change.
