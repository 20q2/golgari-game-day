# The Undercity — Enemy Difficulty Ladder (roster spread · depth-gated selection · floor + ceiling)

**Status:** design · 2026-07-26
**Companion:** [undercity-combat.md](undercity-combat.md) (the living reference — update it when this lands)
**Origin:** balance review of real session `20260725-151118` (8 players). Combat difficulty
runs *backwards* — a hard wall for low-level creatures, trivial for leaders — and the enemy
roster itself is malformed. This is change #1 of the review's prioritized list.

## 1. Problem

The session showed combat is a brick wall when you are weak and free once you are strong:

- **Floor.** A fresh L1 (ATK 4 — squirrel/saproling base) **cannot win any fight.** Against
  even the weakest enemy (Drudge Beetle, 22 HP) it needs ~6.6 rounds to kill, and combat
  hard-caps at `MAX_ROUNDS_COMBAT = 6` → timeout, then compost. Every wild loss and most
  deaths clustered on the low-level players, who then quit.
- **Ceiling.** Leaders went **93% wild, 36–0 elite**, soloed the boss, dealt 4.4× the damage
  they took. Nothing static (top enemy = 70 HP / ATK 16) threatens a maxed creature.

Root cause is the roster shape, not the combat math (which was tuned in the 2026-07-21 pass).
All 17 wild/elite enemies plotted by HP:

```
HP 22-34  ████████████ (12 enemies)  ← base + dungeon fauna + "elite" all piled here
HP 35-45  ·············· (ZERO)       ← the cliff
HP 46-70  ██████ (5 enemies)          ← wilderness
HP 71+    ·············· (ZERO)       ← no apex
```

Three structural holes:

1. **A cliff at 34→46 HP.** Enemies pile into the trash band, then jump to wilderness with
   nothing between. Mid-game (L5–9) facerolls everything until the wilderness step.
2. **The "elite" tier is fake.** `ELITE_NPCS` are 30–32 HP — *inside* the trash band. An
   elite space is a reskin, not a spike. This is the 36–0 record.
3. **No apex.** The toughest enemy is 70 HP / ATK 16; a maxed creature beats it every time.

And the deepest structural miss: **the depths never use depth for enemy choice.** The board's
139-node underworld runs up to ~21 levels deep, but `_wild_battle` picks `DUNGEON_NPCS[biome]`
(one themed 22–28 HP fodder) regardless of how deep you are. A 20-floor dungeon has one rung's
worth of difficulty on it — the single biggest cause of both the flat ceiling and wasted
board.

## 2. Goals / Non-goals

**Goals**
- Fix the floor: a fresh hatchling can win its earliest fights.
- Fill the cliff and add a genuine apex so difficulty is a smooth gradient L1 → endgame.
- Fix the fake-elite inversion: an elite space is a real spike.
- Add enemy *diversity* — more specimens, personalities spread across every rung.
- Preserve the power fantasy: shallow/early enemies stay weak in absolute terms; you outgrow
  them and descend into danger deliberately.

**Non-goals** (explicitly out of scope for change #1)
- **No enemy-to-player stat scaling.** Consistent with the 2026-07-21 spec §1.4 — difficulty
  is zone/depth-gated, never rubber-banded to the player. Leveling must *feel* like power.
- **No combat-math changes** — mitigation, stance triangle, frenzy, reads, `MAX_ROUNDS_COMBAT`
  all unchanged. We reshape the roster, not the resolution.
- **No new AI behaviors** — reuse the existing 4 personalities (brute/turtle/trickster/
  balanced); just distribute them across every rung.
- **No PvP, economy, board-layout, lair, or barrier changes.** Lair bosses and barrier
  guardians are separate encounters and stay as-is.

## 3. Design

### 3.1 Difficulty model — zone + dungeon depth

Enemy difficulty follows *where you are*, not who you are. The board already gates this by
region (home biomes = safe, wilderness = tough, isle = endgame); we add the missing axis —
**dungeon depth** — and hang a proper ladder on it. As a creature grows it chooses to travel
outward/downward into higher rungs; a strong creature revisiting a shallow floor still trivially
crushes it (power fantasy intact).

### 3.2 The ladder

Six rungs. Target win rate is for a creature at the **expected level** for that rung (roughly
where a player naturally is when they reach that zone); an underleveled creature that wanders
too deep should struggle and retreat, an overleveled one should dominate.

| Rung | Zone | HP | ATK | DEF | Expected Lv | Target win% | Fixes |
|---|---|---|---|---|---|---|---|
| **R0 Trash** | home biomes / surface pockets | 12–20 | 4–7 | 1–3 | L1–2 | ~80% | **Floor** |
| **R1 Low** | depths d1–4 | 24–36 | 7–10 | 2–4 | L2–4 | ~78% | (today's base pool) |
| **R2 Mid** | depths d5–9 | 42–56 | 11–14 | 4–6 | L4–7 | ~75% | **the cliff** |
| **R3 High** | depths d10–15 · wilderness | 62–80 | 14–17 | 6–9 | L7–10 | ~72% | steady threat |
| **R4 Tough** | depths d16+ | 90–110 | 18–22 | 7–10 | L10–12 | ~65% | **Ceiling** |
| **R5 Apex** | isle / boss approach | 120–150 | 22–28 | 8–12 | maxed | ~55% | endgame gate |

Design notes:
- **Threat comes from HP + ATK, not DEF walls.** High enemy DEF + the 6-round cap produces
  frustrating timeouts, not fights. Deep enemies are dangerous because a leader *can't burst
  them before round 4*, at which point `FRENZY` (+20%/round) ramps their swings into real
  lethality — the existing escalation carries the ceiling, exactly as intended (no flat %-HP
  damage; see the no-environmental-damage rule).
- **Elite spike:** an `elite` space draws from **one rung above** the node's local rung (capped
  at R5). An elite in the shallow depths is an R2 spike; in the deep, an R5 mini-boss.
- **Personality spread:** every rung carries a mix of the 4 personalities (no more all-turtle
  trash tier), themed to the biome where sensible.

### 3.3 Enemy selection (`undercity_db.py::_wild_battle`)

Replace the biome-only branch with a rung resolver:

```
def _enemy_rung(node, region, elite):
    if region == 'isle':                     rung = R5
    elif region == 'wilderness':             rung = R3
    elif region == 'depths':
        d = _node_depth(node)                # parse _d<N>; fallback: hops from biome mouth
        rung = R1 if d <= 4 else R2 if d <= 9 else R3 if d <= 15 else R4
    elif region in BIOMES:                   rung = R0     # surface home pockets
    else:                                    rung = R1     # safe default
    if elite: rung = min(R5, rung + 1)       # elite = spike one rung up
    return rung

spec = _rng.choice(ROSTER[rung].for_biome(biome))
```

`_node_depth` parses the `_d<N>` suffix (committed + procedural depth nodes use it); if a
procedural node lacks it, fall back to graph hop-distance from the biome's ladder mouth
(`<biome>_lb`). **Implementation must confirm mapgen's depth-node naming** — this is the one
open risk (see §6).

### 3.4 Floor — player-side half

Per the "both" decision, alongside the R0 enemy trim we raise the two ATK-4 starters so no
creature begins unable to fight: **squirrel and saproling base ATK 4 → 5** (`STARTERS`). This
is the smallest player-side nudge; it closes the L1 gap together with R0 without shifting the
mid/late curve. Check for a client display mirror in `src/app/undercity/data/species.ts`.

### 3.5 Roster composition

~22–26 specs total. To avoid a 6×5 biome explosion: R0–R1 stay biome-themed (each home/shallow
pocket keeps its fauna identity); R2–R5 are mostly shared cross-biome pools (deep horrors,
wilderness beasts, apex mini-bosses) with light thematic naming. Each rung ≥3 specimens and
≥3 distinct personalities. Existing enemies are re-slotted into rungs rather than deleted
(e.g. Drudge Beetle → R0/R1, wilderness pool → R3, wilderness-elite → R3-elite/R4).

## 4. Data / code changes

- **`undercity_data.py`** — reorganize enemy pools into the six rungs (a `ROSTER`/rung-keyed
  structure + biome theming helper). Retire the flat `NPCS`/`ELITE_NPCS`/`WILDERNESS_*`/
  `DUNGEON_NPCS` shape (or keep them as the R0/R1/R3 seed contents).
- **`undercity_db.py::_wild_battle`** — depth/region rung resolver + elite spike (§3.3);
  add `_node_depth` helper.
- **`undercity_data.STARTERS`** — squirrel/saproling ATK 4 → 5.
- **Tests** — see §5.

No client mirror for enemy stats (server-sent in the battle payload). Starter-stat mirror only
if `species.ts` displays base ATK.

## 5. Testing

- **Keep green:** existing battle + `tests/test_undercity_enemy_level.py` suites (re-slot, don't
  break, `enemy_level` labeling).
- **New unit tests:** `_node_depth` parsing + fallback; rung mapping per region/depth; elite =
  rung+1 (capped); every rung non-empty and biome-resolvable.
- **Balance sim** (`infrastructure/lambda/sim/`): validate win-rate targets in §3.2 across
  representative statlines — expected-level ~70–80%; underleveled (≈−2 rungs of level) <35%
  ("go back up"); overleveled (≈+2) >95% (power fantasy). Tune HP/ATK bands until met.
- Backend: `cd infrastructure/lambda && python -m pytest tests -q`.

## 6. Risks / open questions

- **Depth derivation for procedural depths** — the whole ladder hinges on knowing a node's
  depth. Confirm mapgen names wild depth nodes with a parseable `_d<N>` (or wire the
  hop-distance fallback). Verify first thing in implementation.
- **Depth vs. expected level correlation** — the rung→depth bands assume players are roughly a
  given level when they reach a given depth. The sim validates the statline targets; live
  correlation (are players actually L10 at d15?) is a next-session observation, not a blocker.

## 7. Rollout

Backend-only (Lambda). Ends with pytest green + sim targets met; **the host runs `cdk deploy`.**
Nothing changes for players until deployed.

## 8. Results (sim, 2026-07-26)

Arena sweep (`sim.arena.winrate`, 500 trials, reasonable-read policy), win% by player
level vs a representative foe per rung. Two archetype lenses bracket the range.

**Floor** — a bare, just-hatched L1 (no gear) after the ATK 4→5 bump: Drudge 100%,
Sewer 90–96%, Myconid 85–94% (glass) / 69% (slow tank). A real-but-fair fight, matching
the 2026-07-19 intent — **so the NPCS trim was dropped; the ATK bump alone fixes the floor.**

| Rung (glass / tank) | L1 | L3 | L5 | L8 | L11 | L12 |
|---|---|---|---|---|---|---|
| R2 mid   | 43/8  | 76/23 | 98/99 | 100/100 | 100/100 | 100/100 |
| R3 deep  | 11/1  | 34/6  | 78/93 | 96/100  | 100/100 | 100/100 |
| R4 abyss | 0/0   | 0/0   | 5/9   | 30/41   | 63/95   | 72/97   |
| R5 apex  | 0/0   | 0/0   | 1/0   | 11/11   | 46/71   | 50/76   |

The ladder is a smooth gradient: underleveled = a real wall ("go back up"), at-level =
winnable, overleveled = trivial (L12 clears R0/R1 at 100% — power fantasy intact). The
floor and the flat-difficulty problem are fixed.

**Known residual (separate change):** DEF tanks over-perform at the deep end (abyss L12
97% vs glass 72%; apex 76% vs 50%). This is the DEF-tank dominance the balance review
already flagged — a build-balance issue that must NOT be papered over by tuning rungs
(that would crater glass). Tracked for a later change.

## 9. Consequence: the solo-boss route is intentionally harder now (decision 2026-07-27)

The five Guild-Sigil lairs sit **deep** — measured at depth 10–21 hops from the biome mouth
(city_lair 21, bog/bone 17, garden 15, cavern 10). So the mandatory route to unseal Savra now
descends through the DEEP/ABYSS tiers this ladder added, where the pre-ladder game had flat
22–28 HP fodder the whole way down. A clean sim comparison (same competent RushBoss bot, only
the deep-enemy difficulty swapped) quantifies the effect:

| budget | laddered deep (now) | flat deep (pre-ladder) |
|---|---|---|
| 60 rolls | 0/16 | 0/16 |
| 80 | 0/16 | 6/16 |
| 100 | 3/16 | 11/16 |
| 150 | 8/16 | 14/16 |

A dedicated solo-Savra run that took ~60–80 rolls before now takes ~120–150. **This is
DELIBERATE — the host chose (2026-07-27) to keep it hard: soloing the Queen should be a rare
epic, not a routine finish.** Do NOT "fix" the harder boss route by softening the deep tiers;
it is working as intended. (Softening deep/abyss, or dropping the R4 tier, were the rejected
alternatives.) The DEF-tank residual above is still open; this boss-difficulty item is closed.
