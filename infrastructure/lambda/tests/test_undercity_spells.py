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


# ── Player doc fields & cooldowns ────────────────────────────────────────────

def test_join_seeds_spell_fields(table):
    status, resp = act(table, 'join', starter='pest', home='garden')
    assert status == 200
    you = resp['you']
    assert you['grimoires'] == [] and you['equippedGrimoire'] is None
    assert you['spellCooldowns'] == {} and you['awayEvents'] == []


def test_prune_cooldowns_drops_expired():
    doc = {'spellCooldowns': {'rot_surge': '2000-01-01T00:00:00',
                              'spore_bolt': '2099-01-01T00:00:00'}}
    db._prune_cooldowns(doc)
    assert doc['spellCooldowns'] == {'spore_bolt': '2099-01-01T00:00:00'}


# ── cast: validation + self spells ───────────────────────────────────────────

def test_cast_innate_self_buff_and_cooldown(table):
    act(table, 'join', starter='pest', home='garden')  # garden -> rot_surge
    status, resp = act(table, 'cast', spellId='rot_surge', source='innate')
    assert status == 200
    assert {'kind': 'rot_surge'} in resp['you']['buffs']
    assert resp['you']['spellCooldowns']['rot_surge'] > db._now()
    assert resp['cast']['spellId'] == 'rot_surge'

    status, resp = act(table, 'cast', spellId='rot_surge', source='innate')
    assert status == 429
    assert resp['code'] == 'spell_on_cooldown'


def test_cast_buff_refreshes_not_stacks(table):
    act(table, 'join', starter='pest', home='garden')
    doc = db._get_player(table, _sid(table), 'user-alex')
    doc['buffs'] = [{'kind': 'rot_surge'}]     # e.g. from a mystery event
    db._put_player(table, doc)
    status, resp = act(table, 'cast', spellId='rot_surge', source='innate')
    assert status == 200
    assert [b['kind'] for b in resp['you']['buffs']].count('rot_surge') == 1


def test_cast_source_validation(table):
    act(table, 'join', starter='pest', home='garden')
    status, resp = act(table, 'cast', spellId='glowveil', source='innate')
    assert status == 409 and resp['code'] == 'not_castable'   # not your biome
    status, resp = act(table, 'cast', spellId='spore_bolt', source='grimoire')
    assert status == 409 and resp['code'] == 'not_castable'   # no book equipped
    status, resp = act(table, 'cast', spellId='nonsense', source='innate')
    assert status == 400 and resp['code'] == 'unknown_spell'
    status, resp = act(table, 'cast', spellId='spore_bolt', source='scroll')
    assert status == 400                                       # phase 2


def test_cast_grimoire_self_heal(table):
    act(table, 'join', starter='saproling', home='garden')     # 38 max HP
    give_book(table, 'user-alex', 'gardeners_primer')
    doc = db._get_player(table, _sid(table), 'user-alex')
    doc['hp'] = 10
    db._put_player(table, doc)
    status, resp = act(table, 'cast', spellId='mend_flesh', source='grimoire')
    assert status == 200
    assert resp['you']['hp'] == 22                              # +12, capped at max
    assert resp['cast']['hp'] == 12


# ── cast: field spells ───────────────────────────────────────────────────────

def _two_players_same_node(table):
    act(table, 'join', starter='kraul', home='city')          # city -> scrap_toss
    act(table, 'join', user='user-sam', name='Sam', starter='saproling', home='bog')
    alex = db._get_player(table, _sid(table), 'user-alex')
    sam = db._get_player(table, _sid(table), 'user-sam')
    alex['position'] = sam['position'] = 'city_r2'
    db._put_player(table, alex)
    db._put_player(table, sam)


def far_node(start, max_steps):
    for nid in data.MAP_NODES:
        if nid != start and engine.board_distance(
                data.MAP_NODES, start, nid, max_steps) is None:
            return nid
    pytest.skip('map too small for an out-of-range node')


def test_field_damage_hits_and_floors_at_1hp(table, monkeypatch):
    _two_players_same_node(table)
    monkeypatch.setattr(db, '_rng', FixedRng(random_values=[0.99, 0.99]))  # never dodge
    status, resp = act(table, 'cast', spellId='scrap_toss', source='innate',
                       target='user-sam')
    assert status == 200
    assert resp['cast']['dodged'] is False and resp['cast']['dmg'] == 8
    sam = db._get_player(table, _sid(table), 'user-sam')
    assert sam['hp'] == 38 - 8
    assert sam['awayEvents'][-1]['kind'] == 'spell_hit'
    assert sam['awayEvents'][-1]['dmg'] == 8

    # Floor: drop Sam to 5 HP; an 8-damage bolt leaves exactly 1, never composts.
    sam['hp'] = 5
    db._put_player(table, sam)
    alex = db._get_player(table, _sid(table), 'user-alex')
    alex['spellCooldowns'] = {}
    db._put_player(table, alex)
    status, resp = act(table, 'cast', spellId='scrap_toss', source='innate',
                       target='user-sam')
    assert status == 200
    sam = db._get_player(table, _sid(table), 'user-sam')
    assert sam['hp'] == 1
    assert sam['position'] == 'city_r2'     # NOT composted home


def test_field_spell_dodge_still_notifies_and_cools(table, monkeypatch):
    _two_players_same_node(table)
    monkeypatch.setattr(db, '_rng', FixedRng(random_values=[0.0]))  # always dodge
    status, resp = act(table, 'cast', spellId='scrap_toss', source='innate',
                       target='user-sam')
    assert status == 200
    assert resp['cast']['dodged'] is True
    assert resp['you']['spellCooldowns']['scrap_toss'] > db._now()  # dodge still cools
    sam = db._get_player(table, _sid(table), 'user-sam')
    assert sam['hp'] == 38
    assert sam['awayEvents'][-1]['kind'] == 'spell_dodged'


def test_field_curse_writes_target_buff(table, monkeypatch):
    act(table, 'join', starter='pest', home='bone')            # bone -> bone_chill
    act(table, 'join', user='user-sam', name='Sam', starter='pest', home='bog')
    alex = db._get_player(table, _sid(table), 'user-alex')
    sam = db._get_player(table, _sid(table), 'user-sam')
    alex['position'] = sam['position'] = 'city_r2'
    db._put_player(table, alex)
    db._put_player(table, sam)
    monkeypatch.setattr(db, '_rng', FixedRng(random_values=[0.99]))
    status, resp = act(table, 'cast', spellId='bone_chill', source='innate',
                       target='user-sam')
    assert status == 200
    sam = db._get_player(table, _sid(table), 'user-sam')
    assert {'kind': 'bone_chill'} in sam['buffs']


def test_field_spell_range_and_shield_guards(table, monkeypatch):
    _two_players_same_node(table)
    sid = _sid(table)
    # Shielded target: rejected, cooldown NOT started.
    sam = db._get_player(table, sid, 'user-sam')
    sam['shieldUntil'] = '2099-01-01T00:00:00'
    db._put_player(table, sam)
    status, resp = act(table, 'cast', spellId='scrap_toss', source='innate',
                       target='user-sam')
    assert status == 409 and resp['code'] == 'target_shielded'
    alex = db._get_player(table, sid, 'user-alex')
    assert 'scrap_toss' not in (alex.get('spellCooldowns') or {})

    # Out of range.
    sam = db._get_player(table, sid, 'user-sam')
    sam['shieldUntil'] = None
    sam['position'] = far_node('city_r2', data.SPELLS['scrap_toss']['range'])
    db._put_player(table, sam)
    status, resp = act(table, 'cast', spellId='scrap_toss', source='innate',
                       target='user-sam')
    assert status == 409 and resp['code'] == 'out_of_range'

    # Bogus targets.
    status, resp = act(table, 'cast', spellId='scrap_toss', source='innate',
                       target='user-alex')
    assert status == 400 and resp['code'] == 'invalid_target'
    status, resp = act(table, 'cast', spellId='scrap_toss', source='innate',
                       target='user-nobody')
    assert status == 404 and resp['code'] == 'invalid_target'


def test_victim_write_conflict_retries_once(table, monkeypatch):
    _two_players_same_node(table)
    monkeypatch.setattr(db, '_rng', FixedRng(random_values=[0.99, 0.99]))
    calls = {'n': 0}
    orig = db._put_player

    def flaky(t, d):
        if d['userId'] == 'user-sam' and calls['n'] == 0:
            calls['n'] += 1
            return False
        return orig(t, d)

    monkeypatch.setattr(db, '_put_player', flaky)
    status, resp = act(table, 'cast', spellId='scrap_toss', source='innate',
                       target='user-sam')
    assert status == 200
    sam = db._get_player(table, _sid(table), 'user-sam')
    assert sam['hp'] == 38 - 8                                 # saproling took the bolt


# ── cast: traversal spells ───────────────────────────────────────────────────

def test_teleport_moves_and_resolves_space(table):
    act(table, 'join', starter='pest', home='city')
    give_book(table, 'user-alex', 'vagrants_chapbook')          # skitter_step, range 3
    doc = db._get_player(table, _sid(table), 'user-alex')
    start = doc['position']
    # Any real node exactly 1 step away.
    dest = data.MAP_NODES[start]['neighbors'][0]
    status, resp = act(table, 'cast', spellId='skitter_step', source='grimoire',
                       target=dest)
    assert status == 200
    assert resp['spaceEvent']['type']                            # space resolved
    assert 'occupants' in resp
    assert resp['you']['pendingMove'] is None


def test_teleport_range_and_bogus_node(table):
    act(table, 'join', starter='pest', home='city')
    give_book(table, 'user-alex', 'vagrants_chapbook')
    doc = db._get_player(table, _sid(table), 'user-alex')
    status, resp = act(table, 'cast', spellId='skitter_step', source='grimoire',
                       target=far_node(doc['position'], 3))
    assert status == 409 and resp['code'] == 'out_of_range'
    status, resp = act(table, 'cast', spellId='skitter_step', source='grimoire',
                       target='no-such-node')
    assert status == 400 and resp['code'] == 'invalid_target'
    status, resp = act(table, 'cast', spellId='skitter_step', source='grimoire',
                       target=doc['position'])
    assert status == 400 and resp['code'] == 'invalid_target'


def test_recall_returns_home(table):
    act(table, 'join', starter='pest', home='bog')
    give_book(table, 'user-alex', 'tome_of_deep_roads')
    doc = db._get_player(table, _sid(table), 'user-alex')
    doc['position'] = 'city_r2'
    db._put_player(table, doc)
    status, resp = act(table, 'cast', spellId='mycelial_recall', source='grimoire')
    assert status == 200
    assert resp['you']['position'] == data.HOME_GATES['bog']


def test_fate_die_sets_pending_loaded_die(table):
    act(table, 'join', starter='pest', home='city')
    give_book(table, 'user-alex', 'wayfarers_atlas')
    status, resp = act(table, 'cast', spellId='fate_die', source='grimoire', value=6)
    assert status == 200
    assert resp['you']['pendingLoadedDie'] == 6
    status, resp = act(table, 'cast', spellId='fate_die', source='grimoire', value=9)
    assert status == 429                                        # on cooldown first…

    doc = db._get_player(table, _sid(table), 'user-alex')
    doc['spellCooldowns'] = {}
    db._put_player(table, doc)
    status, resp = act(table, 'cast', spellId='fate_die', source='grimoire', value=9)
    assert status == 400                                        # …then bad value
