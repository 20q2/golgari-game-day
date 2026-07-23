"""Hybrid gear line: two-stat, no-rider, off-ladder (design 2026-07-23)."""
import sys
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parents[1]))

import pytest  # noqa: E402

import undercity_data as data  # noqa: E402
import undercity_engine as engine  # noqa: E402

HYBRIDS = ('duelist_fang', 'warbrand_plate', 'wardens_charm')

# Expected stat blocks — the two-stat split per the design table.
EXPECTED = {
    'duelist_fang':  {'slot': 'fang',     'atk': 3, 'spd': 2},
    'warbrand_plate':{'slot': 'carapace', 'def': 3, 'atk': 2},
    'wardens_charm': {'slot': 'charm',    'spd': 2, 'def': 2},
}


@pytest.mark.parametrize('gid', HYBRIDS)
def test_hybrid_piece_exists_tier2_no_rider(gid):
    g = data.GEAR[gid]
    assert g['tier'] == 2
    assert g['cost'] == 46
    assert 'rider' not in g          # the whole point: no rider
    assert g['slot'] == EXPECTED[gid]['slot']


@pytest.mark.parametrize('gid', HYBRIDS)
def test_hybrid_piece_has_exactly_two_perk_stats(gid):
    g = data.GEAR[gid]
    present = [s for s in ('atk', 'def', 'spd') if g.get(s, 0) > 0]
    assert len(present) == 2, f'{gid} should carry exactly two perk stats'
    for stat in present:
        assert g[stat] == EXPECTED[gid][stat]


@pytest.mark.parametrize('gid', HYBRIDS)
def test_hybrid_not_in_gear_family(gid):
    # No rider => absent from every rider family => not forge/Mythic upgradable.
    for rider, rungs in data.GEAR_FAMILY.items():
        assert gid not in rungs.values()


def test_hybrid_bridges_two_perk_tracks():
    # A creature just under two thresholds: base atk 9, base def 11.
    # warbrand_plate (def 3, atk 2) lifts def to 14 (>=12 -> carapace_grind)
    # while atk 11 stays short of 12 (no menace). perk_stat sums base+gear.
    player = {'atk': 9, 'def': 11, 'spd': 1,
              'gear': {'carapace': 'warbrand_plate'}}
    assert engine.perk_stat(player, 'def') == 14
    assert engine.perk_stat(player, 'atk') == 11
    perks = engine.attribute_perks(player)
    assert 'carapace_grind' in perks       # DEF-12 lit by base+gear
    assert 'menace' not in perks           # ATK still short of 12


def test_hybrid_can_light_two_nodes_at_once():
    # base atk 10 / def 10 + warbrand_plate (def 3, atk 2) -> atk 12, def 13.
    player = {'atk': 10, 'def': 10, 'spd': 1,
              'gear': {'carapace': 'warbrand_plate'}}
    perks = engine.attribute_perks(player)
    assert 'menace' in perks               # ATK 12
    assert 'carapace_grind' in perks       # DEF 13
