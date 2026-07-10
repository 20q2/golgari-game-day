"""Spell system tests (specs/2026-07-10-undercity-spells-design.md)."""
import sys
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parents[1]))

import pytest

import undercity_data as data
import undercity_engine as engine
import undercity_db as db

from test_undercity_db import FakeTable, act


@pytest.fixture
def table():
    t = FakeTable()
    status, _ = act(t, 'season-start', hostKey='swampking')
    assert status == 200
    return t


def _sid(table):
    sid, _ = db._active_season(table)
    return sid


def give_book(table, user, gid, equip=True):
    """Hand a player a grimoire directly (acquisition is tested separately)."""
    doc = db._get_player(table, _sid(table), user)
    doc.setdefault('grimoires', []).append(gid)
    if equip:
        doc['equippedGrimoire'] = gid
    assert db._put_player(table, doc)


class FixedRng:
    """random.Random stand-in with scripted values for deterministic casts."""

    def __init__(self, random_values=None, randint_value=1):
        self.random_values = list(random_values or [])
        self.randint_value = randint_value

    def random(self):
        return self.random_values.pop(0) if self.random_values else 0.99

    def randint(self, a, b):
        return self.randint_value

    def uniform(self, a, b):
        return 1.0

    def choice(self, seq):
        return seq[0]

    def choices(self, seq, weights=None, k=1):
        return [seq[0]]


# ── Data integrity ───────────────────────────────────────────────────────────

def test_every_grimoire_spell_exists():
    for gid, g in data.GRIMOIRES.items():
        assert 1 <= len(g['spells']) <= 3, gid
        for sp in g['spells']:
            assert sp in data.SPELLS, f'{gid} carries unknown spell {sp}'


def test_biome_spells_cover_every_biome():
    assert set(data.BIOME_SPELLS) == set(data.BIOMES)
    for spell_id in data.BIOME_SPELLS.values():
        assert spell_id in data.SPELLS


def test_spell_fields_match_effect_kind():
    for sid_, sp in data.SPELLS.items():
        assert sp['effect'] in ('self_buff', 'self_heal', 'field_curse',
                                'field_damage', 'teleport', 'recall',
                                'fate_die', 'boss_strike'), sid_
        assert sp['cooldownMin'] > 0, sid_
        if sp['effect'] in ('field_curse', 'field_damage', 'teleport'):
            assert sp.get('range', 0) > 0, sid_
        if sp['effect'] in ('field_damage', 'self_heal', 'boss_strike'):
            assert sp.get('power', 0) > 0, sid_
        if sp['effect'] in ('self_buff', 'field_curse'):
            assert sp.get('buffKind'), sid_


# ── Engine helpers ───────────────────────────────────────────────────────────

_LINE_NODES = {
    'a': {'neighbors': ['b']},
    'b': {'neighbors': ['a', 'c']},
    'c': {'neighbors': ['b', 'd']},
    'd': {'neighbors': ['c']},
}


def test_board_distance_bfs():
    assert engine.board_distance(_LINE_NODES, 'a', 'a', 3) == 0
    assert engine.board_distance(_LINE_NODES, 'a', 'c', 3) == 2
    assert engine.board_distance(_LINE_NODES, 'a', 'd', 2) is None  # beyond max


def test_board_distance_closed_blocks_passage_but_allows_goal():
    closed = frozenset({'c'})
    assert engine.board_distance(_LINE_NODES, 'a', 'd', 5, closed) is None
    assert engine.board_distance(_LINE_NODES, 'a', 'c', 5, closed) == 2


def test_spell_dodge_chance_clamps():
    assert engine.spell_dodge_chance(5, 5) == 10          # base
    assert engine.spell_dodge_chance(5, 7) == 16          # +3 per SPD point
    assert engine.spell_dodge_chance(20, 1) == 5          # floor
    assert engine.spell_dodge_chance(1, 20) == 40         # ceiling


# ── New buff kinds ───────────────────────────────────────────────────────────

def test_new_buff_kinds_in_effective_stats():
    base = {'atk': 6, 'def': 5, 'spd': 5, 'maxHp': 30}
    assert engine.effective_stats({**base, 'buffs': [{'kind': 'glowveil'}]})['spd'] == 7
    assert engine.effective_stats({**base, 'buffs': [{'kind': 'harden_shell'}]})['def'] == 7
    assert engine.effective_stats({**base, 'buffs': [{'kind': 'weaken_hex'}]})['atk'] == 3
    # weaken_hex never drops ATK below 1
    assert engine.effective_stats({**base, 'atk': 2, 'buffs': [{'kind': 'weaken_hex'}]})['atk'] == 1


def test_one_battle_buffs_consumed():
    doc = {'buffs': [{'kind': 'glowveil'}, {'kind': 'harden_shell'},
                     {'kind': 'weaken_hex'}, {'kind': 'rot_surge'},
                     {'kind': 'vines'}]}
    db._consume_one_battle_buffs(doc)
    assert [b['kind'] for b in doc['buffs']] == ['vines']  # vines is roll-consumed


def test_glowveil_grants_flee_bonus():
    doc = {'username': 'x', 'hp': 10, 'maxHp': 10, 'atk': 5, 'def': 5, 'spd': 5,
           'buffs': [{'kind': 'glowveil'}], 'homeBiome': 'bog'}
    assert db._combatant(doc).flee_bonus == 15
    doc['homeBiome'] = 'cavern'   # stacks with the Glowblessed hatch perk
    assert db._combatant(doc).flee_bonus == 25
