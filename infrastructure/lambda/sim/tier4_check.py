"""Tier-4 attribute perk measurement (design 2026-09-07).

Isolates each 24-node's contribution by subtracting it from attribute_perks at
identical stats — so the delta is the PERK, not the six points of raw stat that
came with reaching 24 — and sweeps GRINDSTONE_CHIP_COEFF to pick the shipping
value.

Note sim/proto_fix.py is NOT the tool for this: it prototypes rules by
monkeypatching the engine precisely so the engine need not be edited, and these
perks ship in the engine itself.

From infrastructure/lambda/:
    python -m sim.tier4_check
"""
import undercity_data as data
import undercity_engine as engine

from sim.arena import enemy_registry, make_leveled_doc, winrate
from sim.bots import Rusher, Speedster, Tank
from sim.driver import Build

TRIALS = 300
BOSS = enemy_registry()['rot_sovereign'][1]

# Each case: label, build, bot policy, the stat it maxes, its tier-4 perk id.
CASES = [
    ('mono-ATK / Aggress', Build('kraul', 'city'),      Rusher,    'atk', 'shellsplitter'),
    ('mono-DEF / Guard',   Build('zombie', 'bone'),     Tank,      'def', 'grindstone'),
    ('mono-SPD / Feint',   Build('squirrel', 'garden'), Speedster, 'spd', 'longstride'),
]

_real_perks = engine.attribute_perks


def _suppress(perk_id):
    """Patch attribute_perks to drop one perk, so the same build can be measured
    with and without it at identical stats."""
    def patched(player):
        return _real_perks(player) - {perk_id}
    engine.attribute_perks = patched


def _restore():
    engine.attribute_perks = _real_perks


def build_doc(build, policy, stat, value):
    """A level-12 doc forced to `value` in `stat` and 5 elsewhere, at full HP."""
    doc = make_leveled_doc(build, policy(), level=12, seed=1)
    for s in ('atk', 'def', 'spd'):
        doc[s] = value if s == stat else 5
    doc['hp'] = engine.effective_stats(doc)['maxHp']
    return doc


def measure(label, build, policy, stat, perk_id):
    _restore()
    doc_on = build_doc(build, policy, stat, 24)
    on = winrate(doc_on, BOSS, policy(), trials=TRIALS, base_seed=7, kind='boss')

    _suppress(perk_id)
    doc_off = build_doc(build, policy, stat, 24)   # rebuild: maxHp depends on perks
    off = winrate(doc_off, BOSS, policy(), trials=TRIALS, base_seed=7, kind='boss')
    _restore()

    delta = (on['mean_dmg'] / off['mean_dmg'] - 1) * 100 if off['mean_dmg'] else 0.0
    print(f"{label:22s} dmg {off['mean_dmg']:7.1f} -> {on['mean_dmg']:7.1f} "
          f"({delta:+6.1f}%)  win {off['winrate']:.0%} -> {on['winrate']:.0%}  "
          f"maxHp {doc_off['hp']} -> {doc_on['hp']}")
    return on, off


def main():
    print(f"Savra: {BOSS['hp']} HP / atk {BOSS['atk']} / def {BOSS['def']}  "
          f"({TRIALS} trials, GRINDSTONE_CHIP_COEFF={data.GRINDSTONE_CHIP_COEFF})\n")
    print('== tier-4 perk contribution at stat 24 (perk on vs perk suppressed) ==')
    for case in CASES:
        measure(*case)

    print('\n== GRINDSTONE_CHIP_COEFF sweep (mono-DEF / Guard) ==')
    label, build, policy, stat, _ = CASES[1]
    original = data.GRINDSTONE_CHIP_COEFF
    for coeff in (0.5, 0.6, 0.7, 0.8, 1.0):
        data.GRINDSTONE_CHIP_COEFF = coeff
        doc = build_doc(build, policy, stat, 24)
        r = winrate(doc, BOSS, policy(), trials=TRIALS, base_seed=7, kind='boss')
        print(f"  coeff {coeff:.2f}  mean dmg {r['mean_dmg']:7.1f}  win {r['winrate']:.0%}")
    data.GRINDSTONE_CHIP_COEFF = original


if __name__ == '__main__':
    main()
