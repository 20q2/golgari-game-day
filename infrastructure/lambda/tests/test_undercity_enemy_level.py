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


def test_basic_wilds_are_low_level():
    for npc in data.NPCS:
        assert 1 <= _lvl(npc) <= 2, (npc['name'], _lvl(npc))


def test_elites_outrank_basic_wilds():
    for npc in data.ELITE_NPCS:
        assert 2 <= _lvl(npc) <= 3, (npc['name'], _lvl(npc))


def test_wilderness_wilds_are_mid_level():
    for npc in data.WILDERNESS_NPCS:
        assert 5 <= _lvl(npc) <= 6, (npc['name'], _lvl(npc))


def test_wilderness_elites_are_high_level():
    for npc in data.WILDERNESS_ELITE_NPCS:
        assert 7 <= _lvl(npc) <= 8, (npc['name'], _lvl(npc))


def test_monotonic_with_stats():
    weak = data.enemy_level(6, 2, 5, 22)
    strong = data.enemy_level(18, 7, 12, 60)
    assert strong > weak


def test_shared_pool_boss_hp_is_capped():
    # Savra's 400-HP SHARED persistent pool must not inflate her per-fight level;
    # capped, her stat block reads as a strong single-digit finale, not Lv 25+.
    savra = data.enemy_level(14, 11, 6, 400)
    assert savra == data.enemy_level(14, 11, 6, data.ENEMY_LEVEL_HP_CAP)
    assert savra <= 10
