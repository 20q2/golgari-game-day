"""Balance gate for the boss familiars (design 2026-08-04).

Familiars are *teachers*, not walls: a ~level-5 creature powering through the
dungeon must clear them reliably. This runs each familiar (with its signature
trait live, via db._npc_combatant) against a level-5 evolved creature under the
four archetype policies and asserts a good-play winrate floor.

Run: cd infrastructure/lambda && python -m sim.sim_boss_familiars
"""
import sys

import undercity_data as data
from sim.arena import make_leveled_doc, winrate
from sim.driver import Build
from sim.bots import Rusher, Farmer, Speedster, Tank

# Good play at level 5 should clear a mini-elite familiar at least this often
# (comparable to beating a tier-1 elite). Below this, the numbers come down.
THRESHOLD = 0.70
LEVEL = 5
TRIALS = 300
POLICIES = [Rusher(), Farmer(), Speedster(), Tank()]


def run():
    # A representative level-5 creature per policy (its own stat/evolution path).
    docs = {pol.name: make_leveled_doc(Build(starter='pest', home='city'), pol,
                                       LEVEL, seed=7) for pol in POLICIES}
    print(f'Boss-familiar balance gate — level {LEVEL}, {TRIALS} trials, '
          f'floor {THRESHOLD:.0%}\n')
    header = f'{"familiar":24s} | ' + ' '.join(f'{p.name:>9s}' for p in POLICIES) + ' |  mean'
    print(header)
    print('-' * len(header))

    worst = 1.0
    worst_label = ''
    for fid, spec in data.LAIR_FAMILIAR.items():
        wrs = []
        for pol in POLICIES:
            r = winrate(docs[pol.name], spec, pol, trials=TRIALS,
                        base_seed=11, kind='wild')
            wrs.append(r['winrate'])
        mean = sum(wrs) / len(wrs)
        cells = ' '.join(f'{w*100:8.0f}%' for w in wrs)
        flag = '  <-- BELOW FLOOR' if mean < THRESHOLD else ''
        print(f'{fid:24s} | {cells} | {mean*100:4.0f}%{flag}')
        if mean < worst:
            worst, worst_label = mean, fid

    print()
    if worst < THRESHOLD:
        print(f'FAIL: {worst_label} mean winrate {worst:.0%} < floor {THRESHOLD:.0%}. '
              f'Lower its atk/hp (LAIR_FAMILIAR) or the trait caps (undercity_config).')
        return 1
    print(f'PASS: every familiar clears the {THRESHOLD:.0%} good-play floor '
          f'(worst: {worst_label} at {worst:.0%}).')
    return 0


if __name__ == '__main__':
    sys.exit(run())
