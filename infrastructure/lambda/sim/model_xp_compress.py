"""Ad-hoc model: compress the enemy-XP ladder + reflatten the level curve.

Run:  python -m sim.model_xp_compress

Measures median milestone turns (level10 / level12 / evolves) for the aggressive
rusher and a farmer, under (A) the current numbers and (B) a proposed
compression, so we can see the before/after pace and the per-tier XP ratios.

Nothing is written to the real config — all changes are in-memory monkeypatches
on `undercity_data`, restored between scenarios.
"""
import copy
import statistics as stats

import undercity_data as data
from sim.sweep import progression
from sim.bots import Rusher, Farmer

SEEDS = list(range(24))
BUILD_BOTS = [(Rusher, 'pest', 'city'), (Farmer, 'saproling', 'cavern')]

# The wild/elite pools whose 'xp' we treat as the farmable ladder.
POOL_NAMES = ['NPCS', 'ELITE_NPCS', 'DEPTHS_MID', 'WILDERNESS_NPCS',
              'DEPTHS_DEEP', 'WILDERNESS_ELITE_NPCS', 'DEPTHS_ABYSS', 'ISLE_APEX']


def snapshot():
    """Capture the numbers we mutate so we can restore exactly."""
    snap = {'pools': {n: [dict(s) for s in getattr(data, n)] for n in POOL_NAMES},
            'familiar': copy.deepcopy(data.LAIR_FAMILIAR),
            'curve': (data.XP_CURVE_BASE, data.XP_CURVE_LINEAR,
                      data.XP_CURVE_RAMP, data.XP_CURVE_RAMP_FROM)}
    return snap


def restore(snap):
    for n in POOL_NAMES:
        for spec, orig in zip(getattr(data, n), snap['pools'][n]):
            spec.update(orig)
    for k, orig in snap['familiar'].items():
        data.LAIR_FAMILIAR[k].update(orig)
    (data.XP_CURVE_BASE, data.XP_CURVE_LINEAR,
     data.XP_CURVE_RAMP, data.XP_CURVE_RAMP_FROM) = snap['curve']


ANCHOR = 25          # tier-1 elite XP — the value we anchor the compression to


def compress_xp(factor):
    """Shrink every enemy-XP value's distance ABOVE the tier-1-elite anchor by
    `factor`. Tier-1 wild(10)/elite(25) are left alone; the deeper the tier, the
    more its reward is pulled down toward the anchor. Keeps monotonic ordering."""
    def new(old):
        if old <= ANCHOR:
            return old
        return round(ANCHOR + (old - ANCHOR) * factor)
    for n in POOL_NAMES:
        for spec in getattr(data, n):
            spec['xp'] = new(spec['xp'])
    for spec in data.LAIR_FAMILIAR.values():
        spec['xp'] = new(spec['xp'])


def set_curve(base, linear, ramp, ramp_from):
    data.XP_CURVE_BASE = base
    data.XP_CURVE_LINEAR = linear
    data.XP_CURVE_RAMP = ramp
    data.XP_CURVE_RAMP_FROM = ramp_from


def cumulative():
    tot, out = 0, {}
    for lvl in range(1, data.LEVEL_CAP):
        tot += data.xp_to_next(lvl)
        out[lvl + 1] = tot
    return out


def pool_xp_table():
    reps = {
        'T1 wild':   data.NPCS[1]['xp'],
        'T1 elite':  data.ELITE_NPCS[2]['xp'],
        'familiar':  data.LAIR_FAMILIAR['gitrog_spawn']['xp'],
        'T2 wild':   data.DEPTHS_MID[0]['xp'],
        'T2 elite':  data.WILDERNESS_NPCS[3]['xp'],
        'T3 wild':   data.DEPTHS_DEEP[1]['xp'],
        'T3 elite':  data.DEPTHS_ABYSS[1]['xp'],
        'isle apex': data.ISLE_APEX[1]['xp'],
    }
    return reps


def run_scenario(label):
    print(f'\n=== {label} ===')
    reps = pool_xp_table()
    t1e = reps['T1 elite']
    print('per-fight XP (rep enemy) | ratio vs T1 elite:')
    for k, v in reps.items():
        print(f'  {k:10} {v:4}   {v / t1e:.2f}x')
    cum = cumulative()
    print(f'curve: BASE={data.XP_CURVE_BASE} LIN={data.XP_CURVE_LINEAR} '
          f'RAMP={data.XP_CURVE_RAMP} FROM={data.XP_CURVE_RAMP_FROM}  '
          f'| cum to L10={cum[10]} L12(cap)={cum[12]}')
    rows = {}
    for bot, starter, home in BUILD_BOTS:
        from sim.driver import Build
        p = progression(Build(starter, home), bot, SEEDS)
        ms = p['milestones']
        rows[bot.name] = (ms, p['deaths_median'])
        keys = ('level5', 'evolve_t2', 'level8', 'level10', 'evolve_t3', 'level12')
        print(f'  {bot.name:9} deaths~{p["deaths_median"]:2}  ' +
              '  '.join(f'{k}={ms.get(k)}' for k in keys))
    return rows


if __name__ == '__main__':
    snap = snapshot()
    try:
        run_scenario('A. CURRENT (baseline)')

        # Calibration grid: compress the ratio, then find the curve that keeps the
        # rusher's L12 near the baseline (~45 turns). Curve unchanged first, as the
        # reference point, then progressively gentler cuts.
        curves = [
            ('curve UNCHANGED (677)',      (15, 5, 2, 5)),
            ('curve RAMP 2->1 only (535)', (15, 5, 1, 5)),
            ('curve LIN 5->4 only (587)',  (15, 4, 2, 5)),
        ]
        for label, cv in curves:
            restore(snap)
            compress_xp(0.5)
            set_curve(*cv)
            run_scenario(f'B[0.5]. compress 0.5 + {label}')
    finally:
        restore(snap)
        # sanity: numbers restored
        assert data.DEPTHS_MID[0]['xp'] == snap['pools']['DEPTHS_MID'][0]['xp']
        assert (data.XP_CURVE_RAMP, data.XP_CURVE_LINEAR) == (snap['curve'][2], snap['curve'][1])
        print('\n[restored original numbers]')
