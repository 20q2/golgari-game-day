# Undercity balance simulator

Headless, reproducible simulation of Undercity for balance analysis. Drives the
real server-side rules (`undercity_db.handle_action` / `undercity_engine`)
against an in-memory table — nothing is re-implemented, so conclusions transfer.

Design: `specs/2026-07-20-undercity-balance-sim-design.md`.
Findings: [FINDINGS.md](FINDINGS.md).

## Run

From `infrastructure/lambda/`:

```bash
python -m sim.sweep          # progression curves + OFAT build sweeps -> sim/out/results.md
```

Ad-hoc:

```python
from sim.driver import play_game, Build
from sim.bots import Rusher
r = play_game(Build('kraul', 'city'), Rusher, seed=1)   # one full game
print(r.milestones, r.deaths, r.outcome)

from sim.arena import make_leveled_doc, winrate, enemy_registry
doc = make_leveled_doc(Build('saproling','garden'), Rusher(), level=10, seed=1)
print(winrate(doc, enemy_registry()['rot_sovereign'][1], Rusher(), kind='boss'))
```

## Pieces

- `harness.py` — FakeTable + `GameSim`; seeds both RNGs; free-roll (`DEBUG`) mode.
- `bots.py` — `Policy` + Rusher / Farmer / Speedster / Tank strategy bots.
- `driver.py` — plays one full game (roll→move→fight→level→evolve→shop), records
  a per-turn trajectory + milestones; solves loot flow-puzzles.
- `arena.py` — builds a creature at a controlled level/gear and runs the faithful
  interactive fight vs any enemy tier incl. the boss; `winrate(...)`.
- `sweep.py` — progression + OFAT build comparisons; writes `out/results.md`.

Reproducible: every game/fight is seeded. The engine is never mutated — the
pytest suite (`python -m pytest tests -q`) stays green.
