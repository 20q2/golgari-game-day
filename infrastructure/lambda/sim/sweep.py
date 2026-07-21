"""Balance sweeps: progression curves + OFAT build comparisons.

Run:  python -m sim.sweep            (prints a markdown report, writes CSVs)

OFAT = one factor at a time: to isolate an axis we hold the other three at a
baseline and vary only that axis, so any difference in the numbers is
attributable to the axis under test.
"""
import csv
import statistics as stats
from collections import defaultdict
from pathlib import Path

from sim.driver import play_game, Build
from sim.arena import make_leveled_doc, winrate, enemy_registry
from sim.bots import Policy, Rusher, Farmer, Speedster, Tank, ALL_BOTS
import undercity_data as data
import undercity_engine as engine

OUT = Path(__file__).resolve().parent / 'out'
OUT.mkdir(exist_ok=True)

REG = enemy_registry()
# A representative enemy ladder, weakest -> strongest, for arena tables.
LADDER = ['drudge_beetle', 'myconid', 'fetid_imp', 'rot_shambler',
          'cinder_wolf', 'bramble_horror', 'embermaw_alpha', 'thornclad_revenant',
          'rot_sovereign']


def custom_policy(pref_stance='guard', stat_priority=('atk', 'def', 'spd'),
                  flee_below=0.25, name='custom'):
    """A neutral, reasonable-skill policy with tunable stance + stat spread —
    used to isolate the stat-allocation and equipment axes."""
    p = Policy()
    p.name = name
    p.pref_stance = pref_stance
    p.stat_priority = stat_priority
    p.flee_below = flee_below
    return p


# ── Progression (full-game driver) ────────────────────────────────────────────

def progression(build, bot_cls, seeds, max_turns=250):
    runs = [play_game(build, bot_cls, s, max_turns) for s in seeds]
    # median milestone turns
    def med(key):
        vals = [r.milestones[key] for r in runs if key in r.milestones]
        return round(stats.median(vals)) if vals else None
    milestones = {k: med(k) for k in
                  ('level2', 'level3', 'level5', 'evolve_t2', 'level8',
                   'level10', 'evolve_t3', 'level12')}
    # win rate vs kind, bucketed by player level
    buckets = defaultdict(lambda: defaultdict(lambda: [0, 0]))  # kind -> lvlbucket -> [w,n]
    deaths = [r.deaths for r in runs]
    for r in runs:
        for f in r.fights:
            if f['won'] is None:
                continue
            lb = '1-4' if f['level'] < 5 else '5-9' if f['level'] < 10 else '10-12'
            b = buckets[f['kind']][lb]
            b[0] += 1 if f['won'] else 0
            b[1] += 1
    # median power curve at fixed turn checkpoints
    checkpoints = [10, 25, 50, 100, 150, 200]
    power_curve = {}
    for cp in checkpoints:
        vals = [next((row['power'] for row in r.trajectory if row['turn'] >= cp), None)
                for r in runs]
        vals = [v for v in vals if v is not None]
        if vals:
            power_curve[cp] = round(stats.median(vals))
    return {
        'build': build.name(), 'bot': bot_cls.name if isinstance(bot_cls, type) else bot_cls.name,
        'runs': len(runs), 'milestones': milestones,
        'deaths_median': round(stats.median(deaths)), 'deaths_max': max(deaths),
        'winrate': {k: {lb: (v[0] / v[1] if v[1] else None, v[1])
                        for lb, v in lbs.items()} for k, lbs in buckets.items()},
        'power_curve': power_curve,
    }


# ── Arena matrix ────────────────────────────────────────────────────────────

def arena_row(doc, policy, trials=300, base_seed=0):
    out = {}
    for eid in LADDER:
        kind, spec = REG[eid]
        w = winrate(doc, spec, policy, trials=trials, base_seed=base_seed, kind=kind)
        out[eid] = w
    return out


def fmt_pct(x):
    return f'{x*100:4.0f}%' if x is not None else '  - '


def arena_table(title, variants, trials=300):
    """variants: list of (label, doc, policy). Prints a winrate table over the
    enemy ladder; boss column shows dmg/attempt instead of winrate."""
    lines = [f'\n### {title}\n']
    header = '| build | ' + ' | '.join(
        (e if e != 'rot_sovereign' else 'Savra dmg/att') for e in LADDER) + ' |'
    lines.append(header)
    lines.append('|' + '---|' * (len(LADDER) + 1))
    for label, doc, policy in variants:
        row = arena_row(doc, policy, trials=trials)
        cells = []
        for e in LADDER:
            r = row[e]
            if e == 'rot_sovereign':
                cells.append(f"{r['mean_dmg']:.0f}/{r['npc_max']} ({r['winrate']*100:.0f}%)")
            else:
                cells.append(fmt_pct(r['winrate']))
        lines.append(f'| {label} | ' + ' | '.join(cells) + ' |')
    return '\n'.join(lines), None


# ── Main ──────────────────────────────────────────────────────────────────────

def main():
    md = ['# Undercity balance simulation — results\n']
    seeds = list(range(24))

    # 1. Progression curves per bot (baseline build pest/city).
    md.append('## 1. Progression (full-game driver, 24 seeds each)\n')
    md.append('Turns are per roll+move; rolls are free in-sim so this is the raw '
              'power curve, independent of roll income. See the economy overlay note below.\n')
    for bot in (Rusher, Farmer, Speedster, Tank):
        for build in (Build('pest', 'city'), Build('saproling', 'cavern')):
            p = progression(build, bot, seeds)
            md.append(f'\n**{build.name()} — {bot.name}**  '
                      f"(median deaths {p['deaths_median']}, max {p['deaths_max']})")
            ms = p['milestones']
            md.append('- milestone turns: ' + ', '.join(
                f'{k}={ms[k]}' for k in ms if ms[k] is not None))
            md.append('- power@turn: ' + ', '.join(
                f'{cp}:{v}' for cp, v in p['power_curve'].items()))
            wr = []
            for kind in ('wild', 'elite'):
                for lb in ('1-4', '5-9', '10-12'):
                    cell = p['winrate'].get(kind, {}).get(lb)
                    if cell and cell[0] is not None:
                        wr.append(f'{kind}[{lb}]={cell[0]*100:.0f}%(n{cell[1]})')
            md.append('- winrate: ' + ', '.join(wr))

    # 2. Starter axis (arena; hold bot=neutral guard/balanced, no gear).
    pol = custom_policy(name='neutral')
    md.append('\n## 2. Starter × level (arena, 300 fights/cell, neutral skilled player)\n')
    for lvl in (1, 5, 10):
        variants = [(f'{s}', make_leveled_doc(Build(s, 'city'), pol, lvl, seed=1), pol)
                    for s in data.STARTERS]
        tbl, _ = arena_table(f'Level {lvl}', variants)
        md.append(tbl)

    # 3. Stat-allocation axis (arena; fixed starter pest, level 10, no gear).
    md.append('\n## 3. Stat allocation (arena, pest L10, no gear)\n')
    spreads = [('pure-ATK', ('atk',)), ('pure-DEF', ('def',)), ('pure-SPD', ('spd',)),
               ('balanced', ('atk', 'def', 'spd')), ('ATK/SPD', ('atk', 'spd')),
               ('DEF/ATK', ('def', 'atk'))]
    variants = []
    for label, pri in spreads:
        sp = custom_policy(pref_stance='aggress' if pri[0] == 'atk' else
                           'guard' if pri[0] == 'def' else 'feint',
                           stat_priority=pri, name=label)
        doc = make_leveled_doc(Build('pest', 'city'), sp, 10, seed=1)
        eff = engine.effective_stats(doc)
        variants.append((f'{label} (a{eff["atk"]}/d{eff["def"]}/s{eff["spd"]})', doc, sp))
    tbl, _ = arena_table('pest L10 stat spreads', variants)
    md.append(tbl)

    # 4. Equipment archetype (arena; fixed pest L10 balanced + one gear set).
    md.append('\n## 4. Equipment archetype (arena, pest L10 balanced stats)\n')
    loadouts = {
        'none': {},
        'T1 fang (aggro)': {'fang': 'bloodfang'},
        'T3 fang (aggro)': {'fang': 'wurm_tooth'},
        'T3 carapace (tank)': {'carapace': 'troll_hide'},
        'T3 charm (feint)': {'charm': 'glint_charm'},
        'T3 full mixed': {'fang': 'wurm_tooth', 'carapace': 'troll_hide', 'charm': 'glint_charm'},
    }
    base = custom_policy(name='balanced')
    variants = []
    for label, gear in loadouts.items():
        b = Build('pest', 'city', gear=gear, label=label)
        doc = make_leveled_doc(b, base, 10, seed=1)
        variants.append((label, doc, base))
    tbl, _ = arena_table('pest L10 loadouts', variants)
    md.append(tbl)

    # 5. Evolution path (arena; saproling has the most branches).
    md.append('\n## 5. Evolution path (arena, saproling L12, balanced stats)\n')
    # Force each tier2->apex line by a policy that picks a named form.
    lines = ['\n### saproling apex lines\n',
             '| line | ' + ' | '.join(e if e != 'rot_sovereign' else 'Savra dmg/att'
                                      for e in LADDER) + ' |',
             '|' + '---|' * (len(LADDER) + 1)]
    for t2 in data.tier2_options('saproling'):
        apexes = data.apex_options(t2) or [None]
        for apex in apexes:
            pol2 = _forced_evo_policy(t2, apex)
            doc = make_leveled_doc(Build('saproling', 'garden'), pol2, 12, seed=1)
            label = f'{data.TIER2[t2]["name"]}→{data.APEX[apex]["name"] if apex else "-"}'
            row = arena_row(doc, pol2, trials=250)
            cells = []
            for e in LADDER:
                r = row[e]
                cells.append(f"{r['mean_dmg']:.0f}/{r['npc_max']}({r['winrate']*100:.0f}%)"
                             if e == 'rot_sovereign' else fmt_pct(r['winrate']))
            lines.append(f'| {label} | ' + ' | '.join(cells) + ' |')
    md.append('\n'.join(lines))

    report = '\n'.join(md)
    (OUT / 'results.md').write_text(report, encoding='utf-8')
    print(f'[written to {OUT / "results.md"}]')


def _forced_evo_policy(t2_form, apex_form):
    p = custom_policy(name='evo')
    p._t2, p._apex = t2_form, apex_form

    def choose(options_specs):
        if t2_form in options_specs:
            return t2_form
        if apex_form and apex_form in options_specs:
            return apex_form
        return next(iter(options_specs))
    p.choose_evolution = choose
    return p


if __name__ == '__main__':
    main()
