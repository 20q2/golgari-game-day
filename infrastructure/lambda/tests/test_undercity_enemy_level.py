"""Derived opponent level shown in the battle UI (data.enemy_level).

Enemies carry no stored level; the number is derived from the stat block and
must stay calibrated against the enemy tables + the design's recommended-level
notes. These tests lock that calibration so a future stat tweak that shifts a
tier's level is a deliberate, visible change.
"""
import sys
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parents[1]))

import undercity_data as data


def _lvl(npc):
    return data.enemy_level(npc['atk'], npc['def'], npc['spd'],
                            npc.get('maxHp', npc['hp']))


def test_never_below_one():
    # The weakest fodder (a bare starter still beats it) still reads Lv 1.
    assert _lvl({'atk': 6, 'def': 2, 'spd': 5, 'hp': 22}) == 1


def _region(region, elite=False):
    return data.region_npcs(region, elite)


def _all(region):
    return _region(region, False) + _region(region, True)


HOMES = ('city', 'garden', 'bone', 'cavern', 'bog')


def test_home_regions_have_a_readable_entry():
    # Per-biome pools mix stat levels for flavor, but every surface home must
    # still field at least one low-level (Lv<=2) wild so a fresh starter has
    # readable fodder to cut its teeth on.
    for region in HOMES:
        levels = [_lvl(n) for n in _region(region, elite=False)]
        assert min(levels) <= 2, (region, levels)


def test_isle_is_endgame_high_level():
    # Sigil Isle (T3) is the endgame — every creature there reads high.
    for n in _all('isle'):
        assert _lvl(n) >= 7, (n['name'], _lvl(n))


def test_region_ramp_home_below_wilderness_below_isle():
    # The difficulty ramp is cross-region now: the toughest home creature is
    # below the toughest Wilderness (T2) creature, which is below the Isle (T3).
    home_max = max(_lvl(n) for r in HOMES for n in _all(r))
    wild_max = max(_lvl(n) for n in _all('wilderness'))
    isle_max = max(_lvl(n) for n in _all('isle'))
    assert home_max < wild_max < isle_max, (home_max, wild_max, isle_max)


def test_monotonic_with_stats():
    weak = data.enemy_level(6, 2, 5, 22)
    strong = data.enemy_level(18, 7, 12, 60)
    assert strong > weak


def test_tier3_isle_outrewards_wilderness_by_xp():
    # The T3 endgame (Isle) must out-reward the T2 Wilderness on XP.
    wild_max = max(n['xp'] for n in _all('wilderness'))
    isle_min = min(n['xp'] for n in _all('isle'))
    assert isle_min > wild_max


def test_shared_pool_boss_hp_is_capped():
    # Savra's huge SHARED persistent pool must not inflate her per-fight level;
    # capped, her stat block reads as a strong single-digit finale, not Lv 25+.
    s = data.ROT_SOVEREIGN
    savra = data.enemy_level(s['atk'], s['def'], s['spd'], s['hp'])
    assert savra == data.enemy_level(s['atk'], s['def'], s['spd'], data.ENEMY_LEVEL_HP_CAP)
    assert savra <= 10
