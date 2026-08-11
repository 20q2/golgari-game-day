"""The consumable bag is per-creature: the Grime Gorger's Gorge passive doubles
it to 10. Every other form keeps the normal 5."""
import sys, os

sys.path.insert(0, os.path.join(os.path.dirname(__file__), '..'))

import undercity_db as db
import undercity_data as data
import undercity_config as config


def test_bag_cap_by_passive():
    assert db.bag_cap({'passives': ['gorge', 'reclaim']}) == config.GORGE_BAG_SIZE
    assert db.bag_cap({'passives': ['scrounger']}) == data.BAG_SIZE
    assert db.bag_cap({}) == data.BAG_SIZE


def test_kind_cap_routes_consumables_through_bag_cap():
    gorger = {'passives': ['gorge']}
    plain = {'passives': []}
    assert db._kind_cap(gorger, 'consumable') == 10
    assert db._kind_cap(plain, 'consumable') == 5
    # Other kinds are flat for everyone.
    assert db._kind_cap(gorger, 'gear') == data.GEAR_STASH_SIZE
    assert db._kind_cap(gorger, 'scroll') == data.SCROLL_SATCHEL_CAP


def test_gorger_bag_accepts_ten_consumables():
    doc = {'passives': ['gorge'], 'bag': ['healing_moss'] * 9}
    assert db._pickup_fits(doc, 'consumable', 'healing_moss') is True
    doc['bag'] = ['healing_moss'] * 10
    assert db._pickup_fits(doc, 'consumable', 'healing_moss') is False


def test_normal_creature_still_caps_at_five():
    doc = {'passives': [], 'bag': ['healing_moss'] * 4}
    assert db._pickup_fits(doc, 'consumable', 'healing_moss') is True
    doc['bag'] = ['healing_moss'] * 5
    assert db._pickup_fits(doc, 'consumable', 'healing_moss') is False


def test_gorger_acquires_a_sixth_consumable_instead_of_parking_it():
    """End-to-end through the grant pipeline: at 5 items a normal creature parks
    the find in the pickup queue, while a Gorger simply takes it."""
    plain = {'passives': [], 'bag': ['healing_moss'] * 5}
    got = db._acquire(plain, 'consumable', 'healing_moss')
    assert got['outcome'] == 'pending'
    assert len(plain['bag']) == 5

    gorger = {'passives': ['gorge'], 'bag': ['healing_moss'] * 5}
    got = db._acquire(gorger, 'consumable', 'healing_moss')
    assert got['outcome'] != 'pending'
    assert len(gorger['bag']) == 6
