"""Grime Gorger: Gorge (items -> Mulch) and Reclaim (Mulch -> board edits).
Design: specs/2026-08-10-undercity-grime-gorger-design.md"""
import sys, os

sys.path.insert(0, os.path.join(os.path.dirname(__file__), '..'))

import undercity_db as db
import undercity_data as data
import undercity_config as config


def test_apex_entry_is_wired():
    apex = data.APEX['grime_gorger']
    assert apex['name'] == 'Grime Gorger'
    assert apex['passives'] == ['gorge', 'reclaim']
    assert apex['bonus'] == {'maxHp': 8, 'def': 2}
    assert sorted(apex['from']) == ['brackish_trudge', 'shambling_shell',
                                    'woodwraith_strangler']


def test_reclaim_price_list_and_sources():
    # hazard is a legal source but never a target: the Gorger eats filth,
    # it does not spread it.
    assert 'hazard' in data.RECLAIM_SOURCES
    assert 'hazard' not in config.RECLAIM_PRICES
    # Dig sites / veins / shops are the reverse: creatable, never overwritable.
    for t in ('crystal_vein', 'excavation', 'shop'):
        assert t in config.RECLAIM_PRICES
        assert t not in data.RECLAIM_SOURCES
    # Topology and unique landmarks are neither.
    for t in ('gate', 'warp', 'ladder', 'tunnel', 'barrier',
              'vault', 'vault_lock', 'shrine', 'witch', 'ossuary', 'boss'):
        assert t not in config.RECLAIM_PRICES
        assert t not in data.RECLAIM_SOURCES
    assert config.RECLAIM_SURFACE_ONLY == ('rest', 'shop')
    assert config.RECLAIM_MAX_CLAIMS == 3


def test_every_price_list_target_is_a_real_node_type():
    """A typo in the price list would sell a space type the resolver cannot
    handle, stranding the buyer on a dead tile."""
    real = {n['type'] for n in data.MAP_NODES.values()}
    assert set(config.RECLAIM_PRICES) <= real


def test_mulch_yields():
    assert config.GORGE_MULCH_CONSUMABLE == {1: 1, 2: 2, 3: 3, 4: 4}
    assert config.GORGE_MULCH_GEAR == {1: 2, 2: 4, 3: 6, 4: 8}
    assert config.GORGE_BAG_SIZE == 10


from test_undercity_db import table, act, _player_at, _sid  # noqa: F401,E402


def _gorger(table, node='cavern_r2'):
    """A joined player at `node`, evolved all the way to Grime Gorger.
    Returns (sid, doc). The doc is NOT saved; callers pass it to handlers."""
    sid, doc = _player_at(table, node)
    doc['species'] = 'pest'
    doc['form'] = 'grime_gorger'
    doc['tier'] = 3
    doc['level'] = 10
    doc['passives'] = ['gorge', 'reclaim']
    doc['mulch'] = 0
    return sid, doc


def test_evolving_into_the_gorger_grants_both_passives(table):
    sid, doc = _player_at(table, 'cavern_r2')
    doc['species'] = 'pest'
    doc['form'] = 'brackish_trudge'
    doc['tier'] = 2
    doc['level'] = 10
    doc['passives'] = ['bog_forager']
    db._put_player(table, doc)
    status, body = act(table, 'evolve', form='grime_gorger')
    assert status == 200, body
    assert body['you']['passives'] == ['bog_forager', 'gorge', 'reclaim']
    assert body['you']['tier'] == 3


def test_single_passive_forms_are_unchanged_by_the_list_support(table):
    sid, doc = _player_at(table, 'cavern_r2')
    doc['species'] = 'zombie'
    doc['form'] = 'shambling_shell'
    doc['tier'] = 2
    doc['level'] = 10
    doc['passives'] = ['spikeshell']
    db._put_player(table, doc)
    status, body = act(table, 'evolve', form='grave_titan')
    assert status == 200, body
    assert body['you']['passives'] == ['spikeshell', 'colossus']
