"""Directive comparison sweep — how do different player *strategies* fare?

Runs the directive matrix (each directive through a glass-cannon and a tank lens)
over N seeds and prints a dashboard: Renown, level/tier, boss kills, deaths, spore
flow, sigils, and which interactive spaces each strategy actually played. Doubles
as a strategy-balance check — is any directive dominant or a dead end?

Run:  python -m sim.directive_sweep        (from infrastructure/lambda)
"""
import csv
import statistics as stats
from collections import Counter
from pathlib import Path

from sim.driver import play_game, Build
from sim.bots import Rusher, Tank, Balanced, RushBoss, FarmMobs, Shopper, Explorer

OUT = Path(__file__).resolve().parent / 'out'
OUT.mkdir(exist_ok=True)

SEEDS = list(range(16))
# A realistic night's roll budget, NOT the free-roll cap. A player makes about
# 6 rolls/hour (natural regen = ROLLS_PER_REGEN 3 / 30 min) plus a few from
# pokes/claims/bravery, so ~50 movements over an 8-hour event — matched against
# the real session export (engaged players averaged exactly 50 rolls). Scale as
# EVENT_HOURS * 6 for other night lengths.
EVENT_HOURS = 8
MAX_TURNS = EVENT_HOURS * 6 + 2      # ~50 rolls
# (label, CombatProfile, Build) — two lenses bracket build/skill.
LENSES = [
    ('glass', Rusher, Build('squirrel', 'city')),
    ('tank', Tank, Build('zombie', 'city')),
]
DIRECTIVES = [Balanced, RushBoss, FarmMobs, Shopper, Explorer]


def _med(xs):
    return round(stats.median(xs)) if xs else 0


def run_cell(combat, build, directive):
    rows = []
    spaces = Counter()
    for s in SEEDS:
        r = play_game(build, combat, s, max_turns=MAX_TURNS, directive=directive)
        last = r.trajectory[-1] if r.trajectory else {}
        rows.append({
            'renown': r.renown,
            'level': last.get('level', 1),
            'tier': last.get('tier', 1),
            'spores': last.get('spores', 0),
            'sigils': last.get('sigils', 0),
            'deaths': r.deaths,
            'boss': 1 if r.outcome == 'boss_slain' else 0,
        })
        spaces.update(r.spaces)
    agg = {k: _med([row[k] for row in rows]) for k in
           ('renown', 'level', 'tier', 'spores', 'sigils', 'deaths')}
    agg['boss_rate'] = sum(row['boss'] for row in rows) / len(rows)
    agg['spaces'] = {k: round(v / len(SEEDS), 1) for k, v in spaces.most_common()}
    return agg


def main():
    all_rows = []
    print(f'\nDirective sweep — {len(SEEDS)} seeds/cell, {MAX_TURNS} turns max '
          '(free rolls, so turns are decoupled from roll income).\n')
    for lens, combat, build in LENSES:
        print(f'=== {lens.upper()} lens ({build.starter}, {combat.name} combat) ===')
        hdr = (f'{"directive":<10}{"renown":>7}{"lvl":>4}{"T":>2}{"sigils":>7}'
               f'{"boss%":>6}{"deaths":>7}{"spores":>7}   interactive spaces/game')
        print(hdr)
        for D in DIRECTIVES:
            a = run_cell(combat, build, D)
            sp = ', '.join(f'{k}:{v}' for k, v in a['spaces'].items()) or '—'
            print(f'{D.name:<10}{a["renown"]:>7}{a["level"]:>4}{a["tier"]:>2}'
                  f'{a["sigils"]:>7}{a["boss_rate"]*100:>5.0f}%{a["deaths"]:>7}'
                  f'{a["spores"]:>7}   {sp}')
            all_rows.append({'lens': lens, 'directive': D.name, **{k: v for k, v in a.items() if k != 'spaces'},
                             'spaces': sp})
        print()
    csv_path = OUT / 'directive_sweep.csv'
    with open(csv_path, 'w', newline='', encoding='utf-8') as f:
        w = csv.DictWriter(f, fieldnames=list(all_rows[0].keys()))
        w.writeheader()
        w.writerows(all_rows)
    print(f'wrote {csv_path}')


if __name__ == '__main__':
    main()
