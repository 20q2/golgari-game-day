# Undercity Balance Simulation Harness — Design

**Date:** 2026-07-20
**Status:** Approved (brainstorm)
**Goal:** A headless, reproducible simulator that plays out full Undercity games to draw conclusions about (1) progression pacing and (2) build strength/weakness.

## Motivation

Live playtesting with friends surfaced balance concerns but can't cheaply answer
questions like "does power outrun content?", "is any starter a trap?", or "which
equipment archetype dominates?". The engine is pure Python (`undercity_engine.py`
+ `undercity_data.py` + `undercity_db.py`) and already driven headless by the
pytest `FakeTable`, so we can play thousands of games in-memory.

## Approach

Full-game bot driver on the **real action dispatcher** (`db.handle_action`), not a
reimplemented loop — so conclusions transfer to the shipped game. A thin combat
"arena" mode is available for spot-checking specific matchups but is secondary.

Rejected: combat-arena-only (no pacing signal); closed-form curve model (drifts
from real rules, misses emergent/RNG effects).

## Components

Everything under `infrastructure/lambda/sim/` (imports engine directly; read-only
against engine code; existing pytest stays green).

1. **`harness.py`** — in-memory `FakeTable` (lifted from the test suite) + `act()`
   wrapper. Per game: seed `random` **and** `db._rng`; monkeypatch `db._now`/
   `_now_ms` to a **virtual clock** the driver advances each turn, so timestamp-
   driven regen (HP/rolls) and shop windows are deterministic and fights aren't
   gated on wall-time.
2. **`bots.py`** — a `Policy` base class with one method per decision point:
   `choose_destination`, `choose_stance`, `should_flee`, `spend_stat`,
   `should_evolve`, `shop`. Fixed strategy bots:
   - **Rusher** — aggressive stance bias, boss-rush pathing, minimal farming,
     evolve ASAP, points into ATK.
   - **Farmer** — cautious, farms wild/elite for xp+loot, flees when low, buys
     gear before the boss, balanced stats.
   - **Speedster** — SPD-heavy, flee-heavy, avoids fights, races objectives.
   - **Tank** — HP/guard bias, out-sustains fights.
   These also serve as the archetype lenses for build comparison.
3. **`driver.py`** — runs one game to termination (boss slain / died-out / turn
   cap), recording a per-turn trajectory.
4. **`sweep.py`** — runs `build × bot × N seeds`. Uses **OFAT** (one factor at a
   time): hold three build axes at a baseline, vary the fourth, so any delta is
   attributable to that axis. Plus a short list of hand-picked archetype combos.
   Build axes: starter species + home biome, evolution path, equipment archetype,
   stat allocation.
5. **`report.py`** — aggregates runs to markdown + CSV summary tables.

## Metrics

**Progression (primary):** turn# at each level / seal / sigil-gate / boss-reached
/ boss-slain; power curve (effective-stat total & HP vs turn); survivability
(min-HP fraction per fight, near-deaths, deaths/respawns); win rate vs
wild/elite/barrier/lair/boss bucketed by turn; economy (spores & rolls earned vs
spent, roll-starvation events, gear-by-tier over time); termination cause.

**Build balance:** same metrics compared across each swept axis — surfaces
dominant/dead starters, evolution dead-ends, oppressive or useless equipment
archetypes, and stat-spread winners.

## Output

Markdown + CSV tables first (fast, greppable). Optional follow-up: an HTML report
with charts (dataviz skill) on request.

## Scope guards

- Single-player PvE only (PvP is shelved — prove the core loop first).
- No config UI; runs from the CLI.
- Deterministic and reproducible via per-game seeds.
- The sim never mutates engine/balance code; it only reads it.

## Validation

- Sanity assertions against known invariants (e.g. saproling starts HP 38,
  position `cavern_r0`, 3 rolls).
- `python -m pytest tests -q` stays green (sim imports engine, doesn't touch it).
