# Undercity — Per-Biome Spawn Pools

**Date:** 2026-08-07
**Status:** Design (awaiting implementation plan)

## Goal

Give every region its **own** flavored enemy spawn pool instead of the current
shared-per-tier pools. When you fight in the Rot-Gardens you should see Gardens
creatures; the Ossuary Fields should field bone-things; the Undercity its own
vermin. Flavor is the point — stats stay roughly tier-appropriate, but the
*creatures* differ per environment.

This also wires in the real-MTG art dropped into `public/undercity/enemies/`
(the 17 new sprites that currently have art but no enemy spec), replacing the
13 hallucinated no-art enemies removed on 2026-08-07.

## Non-goals

- **No new map regions.** "The Ashlands" was a misspeak for the existing
  Wilderness — no new area is added.
- **No stat scaling.** The core rule holds: *"when you see a beetle you know
  exactly what a beetle is."* A creature has one fixed stat block everywhere it
  spawns. Difficulty comes from *which* creatures a region fields, not from
  scaling a shared creature up.
- **Boss familiars, lair bosses, barrier guardians, enraged roamers, the world
  event, and Savra are untouched.** The 75% Depths signature-familiar overlay
  stays exactly as-is.

## Difficulty model

Keep the region → tier ramp for balance/XP calibration and sprite scaling, but
selection is now per-region:

| Tier | Regions |
|------|---------|
| 1 | city, garden, bone, cavern, bog (the surface homes) |
| 2 | depths, ruin, wilderness |
| 3 | isle (Sigil Isle — endgame) |

`REGION_TIER` is retained (drives `npc['tier']` for client sprite scaling and
informs stat-block calibration). What changes is the *pool lookup*.

## Architecture change

Today `undercity_db._wild_battle` picks a pool via
`data.TIER_NPCS[tier][ 'wild' | 'elite' ]` — shared across every region of that
tier. Replace that with a per-region map:

```python
# undercity_data.py
REGION_NPCS = {
    'city':       {'wild': [...], 'elite': [...]},
    'garden':     {'wild': [...], 'elite': [...]},
    'bone':       {'wild': [...], 'elite': []},          # no elite spaces on the map
    'cavern':     {'wild': [...], 'elite': [...]},
    'bog':        {'wild': [...], 'elite': [...]},
    'depths':     {'wild': [...], 'elite': [...]},
    'ruin':       {'wild': [...], 'elite': [...]},        # shares the Depths dwellers
    'wilderness': {'wild': [...], 'elite': [...]},
    'isle':       {'wild': [...], 'elite': [...]},
}

def region_npcs(region, elite):
    """Flavored pool for a region; unknown/None region -> city (safe home)."""
    r = REGION_NPCS.get(region or '', REGION_NPCS['city'])
    key = 'elite' if elite else 'wild'
    return r[key] or r['wild']   # empty elite pool falls back to wild (never crash)
```

`_wild_battle` calls `data.region_npcs(node_region, elite)` in place of the
`TIER_NPCS` lookup. Everything else in `_wild_battle` (the signature-familiar
override, `npc_from_spec`, `tier` stamping) is unchanged. `npc['tier']` is still
`region_tier(node_region)`.

`TIER_NPCS` and the old tier rosters (`NPCS`, `ELITE_NPCS`, `DEPTHS_MID`,
`WILDERNESS_NPCS`, `DEPTHS_DEEP`) are removed as *selection* structures; their
surviving stat blocks are re-homed into `REGION_NPCS`. `ENEMY_SPECS_BY_ID` is
rebuilt from `REGION_NPCS` (still needed so signature lookups can resolve).

**Keep `DUNGEON_NPCS` (revised during implementation).** It looked like dead
code, but its ids back the live `DUNGEONS[biome]['wild']` references (and
`test_map` asserts they match), and `DUNGEONS`/`DUNGEON_HAZARDS` are live
(depths biome names, respawn text, hazard behavior). Untangling it is a separate
cleanup out of scope here, so it is left untouched. Consequence: `rot_grub`
(the `DUNGEON_NPCS['garden']` creature, displayed as "Thallid") stays a
dungeon-rite flavor id and is NOT added to `REGION_NPCS`; the Depths/Ruin wild
pool is **Rendclaw Troll + Teacher's Pest**. (Rot Shambler, Fetid Imp, and
Myconid were retired 2026-08-07 as OBE art — their PNGs are now unused orphans.)

## The mapping (locked)

All 31 asset-backed creatures. **Bold** = new stat block needed; the rest reuse
their existing (sim-balanced) block.

| Region (tier) | Wild pool | Elite pool |
|---|---|---|
| **Undercity** / city (T1) | **Acolyte of Affliction**, Sewer Shambler | **Attendant of Vraska**, **Obelisk Spider** |
| **Rot-Gardens** / garden (T1) | **Thallid**, **Thallid Shell-Dweller**, Ravenous Squirrel, **Canker Abomination** | **Rotwood Elemental** |
| **Ossuary Fields** / bone (T1) | **Boneyard Lurker**, Fiend Artisan, Mosspit Skeleton | *(none — no elite spaces)* |
| **Mosslight Cavern** / cavern (T1) | **Duskwood Watcher**, Leyline Prowler, Lotleth Troll | Large Bear |
| **The Sedgemoor** / bog (T1) | **Bogwater Lumarent**, **Hag Hedgemage**, Drudge Beetle | Golgari Rotwurm |
| **The Depths** / depths (T2) *+75% boss familiars* | **Rendclaw Troll**, **Teacher's Pest** | Moldering Karock, **Catacomb Shifter** |
| **The Ruinways** / ruin (T2) | **Rendclaw Troll**, **Teacher's Pest** *(shared w/ Depths)* | Moldering Karock, **Catacomb Shifter** *(shared)* |
| **The Wilderness** / wilderness (T2) | Infested Thrinax, Poison-Tip Archer, Sluiceway Scorpion | Vulturous Zombie |
| **Sigil Isle** / isle (T3) | **Molderhulk**, **Putrid Leech** | **Deity of Scars**, **Molderhulk** |

### Region facts that shaped the split (from `map.json`, 305 nodes)

- **bone**: 2 wild spaces, **0 elite spaces** → wild-only pool. Catacomb Shifter
  (which flavor-wise "belongs" to the bone catacombs) lives in the Depths/Ruin
  elite pool instead — the bone *depths pocket* is literally catacombs, so it
  still reads on-theme.
- **wilderness**: 3 elite spaces + **40 `fog` ("Ashen Fog") tiles**. The fog
  tiles are the "ash blocks" — they resolve to wild encounters on reveal, so the
  wilderness genuinely consumes both a wild pool and an elite pool.
- **depths**: 43 wild + 10 elite spaces (the main crawl); 75% of wild encounters
  are the biome's signature familiar, so the shared dweller pool only fills the
  remaining ~25%.
- **isle**: 3 wild + 6 elite spaces; T3 endgame, intentionally a small
  high-threat roster (Molderhulk appears in both wild and elite as a mini-boss
  presence).

## New stat blocks (17) — starting numbers

Calibrated to each creature's region tier using the existing balanced bands
(T1 wild ≈ old `NPCS`; T1 elite ≈ old `ELITE_NPCS`; T2 elite ≈ old
`WILDERNESS_NPCS`; T3 ≈ the removed `DEPTHS_ABYSS`/`ISLE_APEX` bands). These are
**pre-sim starting values** — run `sim/` (see the tune-undercity-balance skill)
and adjust before deploy.

| id | region / role | hp | atk | def | spd | bounty | xp | itemChance | personality | bluff |
|---|---|---|---|---|---|---|---|---|---|---|
| acolyte_of_affliction | city / wild (T1) | 26 | 8 | 3 | 5 | 8 | 10 | 0.0 | trickster | 0.0 |
| attendant_of_vraska | city / elite (T1) | 30 | 11 | 5 | 8 | 18 | 25 | 0.28 | trickster | 0.15 |
| obelisk_spider | city / elite (T1) | 32 | 10 | 6 | 6 | 18 | 25 | 0.28 | balanced | 0.12 |
| canker_abomination | garden / wild (T1) | 34 | 8 | 4 | 3 | 9 | 10 | 0.0 | brute | 0.0 |
| thallid | garden / wild (T1) | 32 | 7 | 4 | 3 | 8 | 10 | 0.0 | balanced | 0.0 |
| thallid_shell_dweller | garden / wild (T1) | 34 | 6 | 6 | 2 | 9 | 10 | 0.0 | turtle | 0.0 |
| rotwood_elemental | garden / elite (T1) | 32 | 10 | 6 | 5 | 18 | 25 | 0.28 | turtle | 0.10 |
| boneyard_lurker | bone / wild (T1) | 30 | 8 | 4 | 4 | 9 | 10 | 0.0 | balanced | 0.0 |
| duskwood_watcher | cavern / wild (T1) | 28 | 7 | 4 | 5 | 8 | 10 | 0.0 | balanced | 0.0 |
| bogwater_lumarent | bog / wild (T1) | 28 | 7 | 3 | 6 | 8 | 10 | 0.0 | trickster | 0.0 |
| hag_hedgemage | bog / wild (T1) | 30 | 8 | 3 | 5 | 9 | 10 | 0.0 | trickster | 0.0 |
| rendclaw_troll | depths+ruin / wild (T2) | 46 | 13 | 5 | 5 | 24 | 42 | 0.20 | brute | 0.10 |
| teachers_pest | depths+ruin / wild (T2) | 38 | 11 | 4 | 8 | 22 | 40 | 0.20 | trickster | 0.15 |
| catacomb_shifter | depths+ruin / elite (T2) | 54 | 15 | 7 | 8 | 28 | 48 | 0.25 | trickster | 0.18 |
| putrid_leech | isle / wild (T3) | 100 | 20 | 6 | 7 | 50 | 70 | 0.40 | brute | 0.15 |
| molderhulk | isle / wild+elite (T3) | 120 | 22 | 9 | 4 | 60 | 85 | 0.45 | brute | 0.20 |
| deity_of_scars | isle / elite (T3) | 140 | 25 | 10 | 6 | 70 | 95 | 0.50 | turtle | 0.25 |

Every `personality` must be in `STANCE_PERSONALITIES`; `bluff` in `[0,1]`
(enforced by `test_all_battle_specs_have_valid_personality`).

**T1-wild re-stat (2026-08-07).** Four creatures reused from the old T2 pools
were placed as T1-home *wilds* but kept their T2 stat blocks, reading Lv4–5 —
too strong for a non-elite starter-tier wild. They were re-statted down into the
T1-wild band (Lv1–2) with T1 rewards, keeping their flavor shape: Fiend Artisan
(30/8/5/4), Mosspit Skeleton (34/8/5/5), Leyline Prowler (30/8/3/7, fast-glass),
Lotleth Troll (36/7/6/3, tanky). Elites may still spike (Large Bear stays Lv6).

## Client & tooling touch points

- **No client stat mirror exists** — enemy stats arrive with the `battle_start`
  payload, and `spriteId` (= id) resolves to `undercity/enemies/<id>.png` via
  `enemyArtUrl`. So no per-enemy client change is needed for stats/art.
- `src/app/undercity/map-editor/map-editor.component.ts` has a hardcoded
  enemy-sprite palette (lines ~73-82) listing only the tier-1 art. Extend it to
  all 30 sprites so the dev editor previews them. (Cosmetic, editor-only.)
- Verify no client mirror of `REGION_TIER`/pool composition exists; if one does,
  update it. (Server-authoritative today.)

## Tests

Update the tests that encoded the old shared-tier model, and add per-region
coverage:

- **Replace** `test_tier_pools_compose_existing_rosters` and
  `test_wilderness_and_isle_use_tier3` with `REGION_NPCS`-based assertions.
- **Add** `test_every_region_has_a_wild_pool` (each region's `wild` non-empty;
  `elite` may be empty only for `bone`).
- **Add** `test_region_pools_are_flavor_distinct` — no creature appears in two
  *different biomes'* pools, except the deliberately-shared Depths↔Ruin dwellers
  and Molderhulk's intra-isle wild+elite overlap.
- **Add** `test_every_placed_creature_has_art` — every id in `REGION_NPCS`
  (and every signature/boss sprite) maps to an existing PNG under
  `public/undercity/enemies/` or `boss_spawns/`. This is the invariant that
  started this whole change; lock it in so a no-art enemy can never re-appear.
- **Add/keep** a per-region monotonic-ish HP sanity check: max wild HP of a T1
  home < max wild HP of a T2 region < isle. (Looser than the old 4-rung ladder;
  the ramp is now cross-region, not cross-depth.)
- Keep `test_all_battle_specs_have_valid_personality` (extend its spec list to
  iterate `REGION_NPCS`).
- The 17 new stat blocks should pass `enemy_level` band checks appropriate to
  their tier (T1 ≈ Lv1-3, T2 elite ≈ Lv5-8, T3 ≈ high).

## Open item for implementation

The 50 pre-existing suite failures (map node-count 305 vs 273, witch-spell,
barrier tests) are unrelated parallel WIP on `map.json`/engine — **not** in
scope here. Implementation should leave them as-is and only guarantee the
enemy/pool tests are green.
