import undercity_data as data
import undercity_db as db

from tests.test_undercity_db import (  # noqa: F401
    table, act, _sid, _player_at, _finish_started_battle)


def _doc(gear=None, spores=0):
    return {'userId': 'u1', 'username': 'U', 'gear': dict(gear or {}), 'spores': spores}


# Force the gear roll to fire and deterministically pick a tier-1 fang.
def _force_fang_drop(monkeypatch):
    monkeypatch.setattr(db._rng, 'random', lambda: 0.0)          # < any chance
    monkeypatch.setattr(db._rng, 'choice',
                        lambda seq: 'fang' if 'fang' in seq else seq[0])
    monkeypatch.setattr(db._rng, 'choices', lambda seq, weights=None, k=1: [seq[0]])


def test_drop_equips_into_empty_slot(monkeypatch):
    monkeypatch.setattr(db._rng, 'choice', lambda seq: seq[0])
    monkeypatch.setattr(db._rng, 'choices', lambda seq, weights=None, k=1: [seq[0]])
    doc = _doc(spores=0)
    res = db._roll_gear_drop(doc, {1: 1.0})
    assert res['outcome'] == 'equipped'
    assert res['displaced'] is None
    assert res['soldSpores'] == 0
    assert doc['gear'][res['slot']] == res['id']


def test_drop_equips_when_strictly_better_and_sells_old(monkeypatch):
    # Force fang slot + tier 3 (wurm_tooth), replacing an equipped tier-1 rusted_fang.
    monkeypatch.setattr(db._rng, 'choice',
                        lambda seq: 'fang' if 'fang' in seq else seq[0])
    monkeypatch.setattr(db._rng, 'choices', lambda seq, weights=None, k=1: [3])
    doc = _doc(gear={'fang': 'rusted_fang'}, spores=0)
    res = db._roll_gear_drop(doc, {3: 1.0})
    assert res['outcome'] == 'equipped'
    assert res['displaced'] == 'rusted_fang'
    # rusted_fang cost 20 * 0.5 sell-back = 10
    assert res['soldSpores'] == 10
    assert doc['spores'] == 10
    assert doc['gear']['fang'] == res['id']


def test_drop_salvages_when_equal_or_worse(monkeypatch):
    # Have a tier-3 fang, drop a tier-1 fang -> salvage, no equip change.
    monkeypatch.setattr(db._rng, 'choice',
                        lambda seq: 'fang' if 'fang' in seq else seq[0])
    monkeypatch.setattr(db._rng, 'choices', lambda seq, weights=None, k=1: [1])
    doc = _doc(gear={'fang': 'wurm_tooth'}, spores=0)
    before = doc['gear']['fang']
    res = db._roll_gear_drop(doc, {1: 1.0})
    assert res['outcome'] == 'salvaged'
    assert res['displaced'] is None
    assert doc['gear']['fang'] == before          # unchanged
    # dropped rusted_fang cost 20 * 0.5 = 10 salvage spores
    assert res['soldSpores'] == 10
    assert doc['spores'] == 10


def test_wild_win_can_drop_gear(table, monkeypatch):
    act(table, 'join', starter='pest')
    sid = _sid(table)
    doc = db._get_player(table, sid, 'user-alex')
    db._wild_battle(table, sid, doc)          # sets doc['battle'] BEFORE we patch _rng
    _force_fang_drop(monkeypatch)
    se = _finish_started_battle(table, monkeypatch, doc, 'attacker')
    assert se['type'] == 'wild'
    assert se['gear']['outcome'] in ('equipped', 'salvaged')
    assert se['gear']['slot'] == 'fang'


def test_loot_tile_can_drop_gear(table, monkeypatch):
    node = next(n for n, nd in data.MAP_NODES.items() if nd['type'] == 'loot')
    sid, doc = _player_at(table, node, spores=0)
    _force_fang_drop(monkeypatch)
    out = db._resolve_space(table, sid, doc, node, None)
    assert out['type'] == 'loot'
    assert out['gear']['slot'] == 'fang'


def test_mystery_free_item_can_be_gear(table, monkeypatch):
    node = next(n for n, nd in data.MAP_NODES.items() if nd['type'] == 'mystery')
    sid, doc = _player_at(table, node, spores=0)
    # Force roll_mystery to return an item, then force the gear branch.
    monkeypatch.setattr(db.engine, 'roll_mystery',
                        lambda *a, **k: {'roll': 7, 'text': 'x', 'spores': 0,
                                         'xp': 0, 'hpPct': 0, 'heal': False,
                                         'buff': None, 'curse': False,
                                         'teleport': False, 'item': True,
                                         'paint': False, 'hat': False})
    _force_fang_drop(monkeypatch)
    out = db._mystery(table, sid, doc)
    assert out['gear']['slot'] == 'fang'


def test_cache_first_visit_can_drop_gear(table, monkeypatch):
    sid, doc = _player_at(table, 'city_cache', spores=0)
    _force_fang_drop(monkeypatch)
    out = db._cache(table, sid, doc, 'city_cache')
    assert out['type'] == 'cache'
    assert out['gear']['slot'] == 'fang'


def test_lair_win_can_drop_gear(table, monkeypatch):
    act(table, 'join', starter='pest')
    sid = _sid(table)
    doc = db._get_player(table, sid, 'user-alex')
    doc['position'] = 'city_lair'
    db._lair(table, sid, doc, 'city_lair')     # battle_start — picks the boss
    _force_fang_drop(monkeypatch)              # patch _rng only now
    se = _finish_started_battle(table, monkeypatch, doc, 'attacker')
    assert se['type'] == 'lair'
    assert se['gear']['slot'] == 'fang'
