import undercity_db as db

from tests.test_undercity_db import (  # noqa: F401
    table, act, _sid, _at_shop, _seed_shop)

data = db.data


def _land_broke(table, spores=0, bag=None):
    """Join, stand at a bazaar with a known cheap stock (cheapest line is
    healing_moss @ 12), set the purse/bag in-memory, and clear the first-visit
    flag so the next landing is a genuine first visit. Returns (sid, node, doc)."""
    sid, node = _at_shop(table, spores=spores)
    _seed_shop(table, sid, node)                 # gear rusted_fang@20, healing_moss@12, grimoire@25
    doc = db._get_player(table, sid, 'user-alex')
    doc['spores'] = spores
    if bag is not None:
        doc['bag'] = list(bag)
    doc.pop('bazaarWelcomeGift', None)
    return sid, node, doc


def test_broke_first_visit_gifts_a_consumable(table):
    sid, node, doc = _land_broke(table, spores=0, bag=[])
    ev = db._resolve_space(table, sid, doc, node, node)
    assert ev['type'] == 'shop'
    assert ev['welcomeGift']['kind'] == 'consumable'
    assert ev['welcomeGift']['item'] in data.CONSUMABLES
    assert ev['welcomeGift']['name'] == data.CONSUMABLES[ev['welcomeGift']['item']]['name']
    assert doc['bag'] == [ev['welcomeGift']['item']]   # the gift landed in the bag
    assert doc['bazaarWelcomeGift'] is True


def test_broke_first_visit_full_bag_gifts_a_molting(table):
    full = ['healing_moss'] * data.BAG_SIZE
    sid, node, doc = _land_broke(table, spores=0, bag=full)
    ev = db._resolve_space(table, sid, doc, node, node)
    assert ev['welcomeGift']['kind'] == 'material'
    assert ev['welcomeGift']['name'] == 'Molting'
    assert ev['welcomeGift']['amount'] == 1
    assert doc['materials']['moltings'] == 1
    assert len(doc['bag']) == data.BAG_SIZE            # bag untouched
    assert doc['bazaarWelcomeGift'] is True


def test_can_afford_cheapest_gets_no_gift(table):
    # 12 Spores buys the seeded Healing Moss -> not "can't buy anything".
    sid, node, doc = _land_broke(table, spores=12, bag=[])
    ev = db._resolve_space(table, sid, doc, node, node)
    assert 'welcomeGift' not in ev
    assert ev['text'] == 'The Rot-Farm Bazaar creaks open.'
    assert 'bazaarWelcomeGift' not in doc
    assert doc['bag'] == []


def test_second_visit_same_run_grants_nothing_new(table):
    sid, node, doc = _land_broke(table, spores=0, bag=[])
    db._resolve_space(table, sid, doc, node, node)     # first visit grants
    assert doc['bazaarWelcomeGift'] is True
    doc['bag'] = []                                    # pretend the bag emptied
    ev = db._resolve_space(table, sid, doc, node, node)  # second landing this run
    assert 'welcomeGift' not in ev
    assert doc['bag'] == []                            # nothing new granted
