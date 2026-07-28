# The Undercity — Sim: whole-game play + player directives

**Status:** design · 2026-07-26
**Companion:** `infrastructure/lambda/sim/README.md` + `FINDINGS.md` (update when this lands)
**Origin:** the balance sim drives real board games but only *resolves* combat, loot
puzzles, respawns, and shops — every other interactive space is walked past — and its bots
are combat archetypes, not goal-driven players. We want the sim to (a) actually play the
interactive spaces so their economy/risk lands, and (b) run distinct player *directives*
(rush the boss, farm mobs, shop, explore) so balance work reflects how real players fare.

## 1. Problem

`sim/driver.py::Driver.run()` already rolls, moves, and processes the `spaceEvent` — but only
for a subset. Battles (`_drive_battle`), loot puzzles + respawns (`_settle`), and shops
(`_shop`) are driven. Auto-resolving spaces (mystery, cache, trove, rest, gate, hazard)
already land because the server mutates the doc during `move`. But every **interactive**
space — whose payoff needs a follow-up action — is silently skipped:

`shrine`, `ossuary` (gamble), `vault_lock`, `excavation` (dig), `crystal_vein` (strike),
`witch`, `warp`, `ladder` (cross).

So a sim player never gambles, digs, prays at a shrine, cracks a vault, mines a vein, or
buys a scroll — a big slice of the economy and risk/reward surface is invisible to balance
runs. Separately, the bots (`Rusher`/`Tank`/`Speedster`/`Farmer`) fuse *how you fight* with
*where you go* (`seek`), so we can't ask "how does a boss-rush strategy fare vs farming?"
independent of build.

## 2. Goals / Non-goals

**Goals**
- Drive all 8 interactive spaces so their rewards/costs affect the sim.
- Split the policy into two composable axes: **CombatProfile** (how you fight/grow) ×
  **Directive** (where you go + economy choices).
- Real navigation: directives pathfind toward a goal over the night's actual graph.
- A `directive_sweep` that reports how each build × directive fares (the "how players fare"
  dashboard, doubling as a strategy-balance check).

**Non-goals**
- **No game-code changes.** This is sim tooling only — it drives the existing action
  dispatcher. Nothing ships to players; no `cdk deploy`.
- **No optimal play.** Directive hooks make *plausible* choices (bet a fixed fraction, dig
  greedily), not game-theoretic-optimal ones. Realistic, not perfect.
- Not modelling PvP, poke, high-five, or trading between sims (single-player trajectories,
  as today).

## 3. Architecture

Split the current `Policy` into two objects the `Driver` composes:

- **CombatProfile** — the existing archetypes minus navigation/economy: `combat()`,
  `spend_stat()`, `choose_evolution()`, `pref_stance`, `flee_below`, `stat_priority`.
  `Rusher`/`Tank`/`Speedster`/`Farmer` become CombatProfiles (their `seek`/`shop_buys`
  move to Directives).
- **Directive** — navigation + economy. Supplies a `seek` map, a `target(sim, graph)` goal,
  and the interactive-space hooks (§4). New subclasses: `RushBoss`, `FarmMobs`, `Shopper`,
  `Explorer`, `Balanced`.
- **`Driver(build, combat, directive, seed)`** — combat/growth from `combat`; movement and
  interactive spaces from `directive`. Sim = **build × combat × directive**.

`sim/bots.py` keeps back-compat shims (e.g. `ALL_BOTS`) so `arena.py`/`sweep.py` still import;
the combat methods they use are unchanged.

## 4. Part A — interactive space resolution

New `Driver._resolve_space(sim, space_event)`, called after `_settle`, dispatches the
follow-up action per `space_event['type']`, each gated by a Directive hook. Confirmed
action contracts (from `undercity_db` handlers):

| Space | Action + payload | Directive hook → decision |
|---|---|---|
| shrine | `shrine` `{choice: atk\|def\|spd\|heal}` | `shrine_take(doc)` → a choice or None |
| ossuary | `gamble` `{bet, call}` ×`ossuaryRollsLeft` | `gamble_bet(spores)` → (bet, call) or None |
| vault_lock | `vault-guess` `{guess:[…VAULT_SLOTS]}` ×`vaultPicksLeft` | `vault_play(view)` → a guess or None |
| excavation | `dig` `{r, c}` ×`excavationDigsLeft` | `dig_play(grid)` → cells (greedy: all) |
| crystal_vein | `strike` `{}` ×`veinStrikesLeft` | `vein_play(depth)` → how many strikes (cave-in risk) |
| witch | `witch-buy-scroll` `{spellId}` | `witch_play(stock, spores)` → a scroll or None |
| warp | `warp` `{to}` | `warp_take(options, target)` → a node or None |
| ladder | `ladder-cross` `{}` | `ladder_take(to, target)` → bool |

Each hook has a sensible base default so a Directive only overrides what it cares about
(e.g. `Explorer` gambles/digs/cracks vaults; `RushBoss` only crosses ladders that move it
toward the boss). `warp_take`/`ladder_take` receive the directive's current pathfinding
target so they serve navigation.

## 5. Part B — directives + navigation

Directives pathfind. Each turn the driver builds the night's graph once (adjacency +
node-type from `db._season_map(table, sid)` — **not** the committed `MAP_NODES` the driver
reads today, which misses procedural depths) and:

1. `directive.target(sim, graph)` → a goal node id (or None for pure greedy).
2. `choose_destination` picks the roll dest with **min BFS hop-distance to the target**;
   ties broken by `seek` weight, then random.

Directive goals:
- **RushBoss** — target = nearest lair with an unclaimed sigil; once 3 sigils, the boss node.
  Crosses ladders toward it; ignores economy detours.
- **FarmMobs** — descend (ladders down) for tougher/better-loot mobs; seek wild/elite/lair;
  buy gear; skip vault/gamble.
- **Shopper** — target = nearest shop; hoard then spend spores on gear/consumables;
  conservative gamble/dig.
- **Explorer** — target = nearest unused mystery/cache/trove/vault/excavation/vein; plays
  every interactive space; low combat appetite (flees more via its CombatProfile pairing).
- **Balanced** — no hard target; greedy `seek` across everything (≈ today's behavior),
  light economy play.

BFS is over ≤~300 nodes, recomputed per turn against a single cached target — negligible.

## 6. Part C — reporting (`sim/directive_sweep.py`)

A runnable module (`python -m sim.directive_sweep`) that sweeps **directives as the primary
axis**, each paired with a couple of representative CombatProfile+build lenses (e.g. a
glass-cannon and a tank) so we see strategy effects without a full 3-axis blowup — N seeds
per cell. Prints a comparison, plus writes a CSV to `sim/out/`. Per cell, medians of:
**Renown** (`data.compute_renown` on the final doc), level/tier reached, boss kills, deaths,
spores earned/spent, sigils, POI claims, turns-to-first-evolve. Reading: is any directive
dominant or a dead end? does the interactive economy pull its weight?

## 7. Testing

Sim is tooling, but add a light `tests/test_sim_directives.py`:
- Each directive completes a seeded game without raising and returns a `GameResult`.
- The interactive hooks actually fire: across a seeded multi-game run, assert ≥1 each of
  gamble / dig / shrine / vault / ladder-cross was dispatched (guards against silent skips).
- Back-compat: `arena.py` + `sweep.py` still import and run (CombatProfile split is clean).
- Full backend suite stays green (`python -m pytest tests -q`).

## 8. Risks / open questions

- **Action-contract drift** — the hooks encode payload shapes (§4). A smoke test that each
  fires guards against a handler signature changing under us.
- **Pathfinding vs. movement rules** — a roll's `destinations` already respect tolls/blocks;
  BFS is only for *ranking* those legal dests by closeness to the goal, so it can't pick an
  illegal move. If no dest makes progress, fall back to `seek`.
- **Directive starvation** — a directive whose target is unreachable this night (e.g. no
  open lair yet) must fall back to greedy `seek` rather than stall; `target()` returns None
  in that case.

## 9. Rollout

Sim-only; no Lambda change, no deploy. Done when the smoke test passes, the backend suite is
green, and `directive_sweep` prints a clean build × directive dashboard.

## 10. Results (2026-07-26)

`python -m sim.directive_sweep` (16 seeds/cell, 200 turns). Medians:

| lens | directive | renown | sigils | boss% | deaths | spores | plays |
|---|---|---|---|---|---|---|---|
| glass | balanced | 304 | 0 | 0% | 16 | 2516 | shop |
| glass | rush_boss | 252 | 3 | **94%** | 9 | 904 | ladder, shrine, warp |
| glass | farm_mobs | 236 | 0 | 0% | 20 | 2446 | ladder, shop |
| glass | shopper | 144 | 0 | 0% | 6 | 1030 | shop, dig |
| glass | explorer | 194 | 0 | 0% | 6 | 1256 | dig, vein, vault, witch, warp |
| tank | balanced | 330 | 0 | 0% | 13 | 3000 | shop |
| tank | rush_boss | 226 | 3 | **100%** | 19 | 649 | ladder, shrine |
| tank | farm_mobs | **380** | 0 | 0% | 21 | **5352** | ladder, shop |
| tank | shopper | 104 | 0 | 0% | 10 | 529 | shop, dig |
| tank | explorer | 179 | 0 | 11 | 7 | 992 | dig, vein, vault, witch, gamble |

Reads well and surfaces real signal: RushBoss reliably clears 3 sigils and kills the boss
(94–100%); every interactive space (dig/vein/vault/witch/gamble/warp/shrine/ladder) actually
fires. Two balance flags for later: **Shopper is a renown dead-end** (going to shops doesn't
score), and **FarmMobs is the richest + highest-renown strategy** — but that is partly the
sim's **free-rolls** assumption (grind-heavy directives get unlimited fights; a roll-budget
overlay would temper them). Absolute deaths are inflated for the same reason (200 free turns).
