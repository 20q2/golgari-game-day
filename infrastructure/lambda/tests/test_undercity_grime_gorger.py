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
