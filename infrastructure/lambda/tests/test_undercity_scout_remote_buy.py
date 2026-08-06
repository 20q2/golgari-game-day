import sys, os
from datetime import datetime, timedelta

sys.path.insert(0, os.path.join(os.path.dirname(__file__), '..'))

import undercity_db as db
import undercity_data as data
import undercity_config as config
from test_undercity_db import table, act, _player_at, _sid  # noqa: F401


def _scout(level=1, tier=1):
    """A scout pet dict at a given level/tier (Gloomshrieker is a scout)."""
    return {'id': 'pet-scout', 'species': 'baby_gloomshrieker',
            'tier': tier, 'level': level, 'mergeProgress': 0}


def test_scout_tier_cap_by_level():
    # 1-2 -> T1, 3-4 -> T2, 5-6 -> T3, 7-9 -> T4.
    assert [db._pet_scout_tier_cap(l) for l in range(1, 10)] == [1, 1, 2, 2, 3, 3, 4, 4, 4]
    # Never exceeds the top gear tier even if a level somehow runs high.
    assert db._pet_scout_tier_cap(99) == 4


def test_biome_bazaar_lookup(table):
    sid, doc = _player_at(table, 'n1')
    # Start position is cavern_r0 (a gate in the 'cavern' biome). Its bazaar is
    # the single shop node in that region.
    doc['position'] = 'cavern_r0'
    node = db._biome_bazaar_node(table, sid, doc)
    assert node is not None
    nmap = db._season_map(table, sid)
    assert nmap[node]['type'] == 'shop'
    assert nmap[node]['region'] == 'cavern'

    # The deep biomes have no bazaar -> None.
    depths = next(nid for nid, n in nmap.items() if n.get('region') == 'depths')
    doc['position'] = depths
    assert db._biome_bazaar_node(table, sid, doc) is None


def test_peek_returns_biome_stock_without_cooldown(table):
    sid, doc = _player_at(table, 'n1')
    doc['position'] = 'cavern_r0'
    doc['pets'] = [_scout()]
    doc['activePetId'] = 'pet-scout'
    status, body = db._pet_scout_peek(table, sid, doc, {})
    assert status == 200
    pa = body['petAbility']
    assert pa['kind'] == 'scout-peek'
    assert pa['tierCap'] == 1
    assert 'gear' in pa['stock'] and 'eggs' in pa['stock']
    assert pa['stock'].get('refreshesAt')  # courier header restock clock
    # Peeking never arms the cooldown.
    assert doc.get('petCooldowns', {}).get('scout') is None
    # Peeking again is fine (still free).
    status2, _ = db._pet_scout_peek(table, sid, doc, {})
    assert status2 == 200


def test_peek_no_bazaar_in_biome(table):
    sid, doc = _player_at(table, 'n1')
    nmap = db._season_map(table, sid)
    doc['position'] = next(nid for nid, n in nmap.items() if n.get('region') == 'depths')
    doc['pets'] = [_scout()]
    doc['activePetId'] = 'pet-scout'
    status, body = db._pet_scout_peek(table, sid, doc, {})
    assert status == 409


def test_peek_requires_active_scout(table):
    sid, doc = _player_at(table, 'n1')
    doc['position'] = 'cavern_r0'
    doc['pets'] = []
    doc['activePetId'] = None
    status, _ = db._pet_scout_peek(table, sid, doc, {})
    assert status == 409


def test_remote_buy_gear_charges_and_depletes(table):
    sid, doc = _player_at(table, 'n1')
    doc['position'] = 'cavern_r0'
    doc['pets'] = [_scout(level=5, tier=2)]  # tierCap 3 -> can buy any biome gear
    doc['activePetId'] = 'pet-scout'
    doc['spores'] = 9999
    node = db._biome_bazaar_node(table, sid, doc)
    stock = db._shop_stock(table, sid, node)
    gear_line = next(g for g in stock['gear'] if g['qty'] > 0)
    gid = gear_line['item']
    before = doc['spores']
    status, body = db._pet_scout_buy(table, sid, doc, {'itemId': gid})
    assert status == 200
    assert doc['spores'] == before - data.GEAR[gid]['cost']         # full price
    assert doc['petCooldowns']['scout']                             # cooldown armed on buy
    after = db._shop_stock(table, sid, node)
    got = next(g for g in after['gear'] if g['item'] == gid)
    assert got['qty'] == gear_line['qty'] - 1                       # depleted by one


def test_remote_buy_tier_gate_blocks_then_allows(table):
    sid, doc = _player_at(table, 'n1')
    doc['position'] = 'cavern_r0'
    doc['activePetId'] = 'pet-scout'
    doc['spores'] = 9999
    node = db._biome_bazaar_node(table, sid, doc)
    stock = db._shop_stock(table, sid, node)
    # Find a gear line whose tier is >= 2 (biome bazaars stock T1/T2 + rare T3).
    hi = next((g for g in stock['gear']
               if g['qty'] > 0 and data.GEAR[g['item']]['tier'] >= 2), None)
    if hi is None:
        return  # this window happens to stock only T1 gear; nothing to gate
    tier = data.GEAR[hi['item']]['tier']
    # A level-1 scout (tierCap 1) is blocked.
    doc['pets'] = [_scout(level=1, tier=1)]
    status, _ = db._pet_scout_buy(table, sid, doc, {'itemId': hi['item']})
    assert status == 409
    assert doc.get('petCooldowns', {}).get('scout') is None  # blocked buy arms nothing
    # A scout leveled past the item's tier can buy it.
    lvl = {2: 3, 3: 5, 4: 7}[tier]
    doc['pets'] = [_scout(level=lvl, tier=4)]
    status2, _ = db._pet_scout_buy(table, sid, doc, {'itemId': hi['item']})
    assert status2 == 200


def test_remote_buy_respects_cooldown(table):
    sid, doc = _player_at(table, 'n1')
    doc['position'] = 'cavern_r0'
    doc['pets'] = [_scout(level=1, tier=1)]
    doc['activePetId'] = 'pet-scout'
    doc['spores'] = 9999
    node = db._biome_bazaar_node(table, sid, doc)
    stock = db._shop_stock(table, sid, node)
    # A guaranteed-affordable, always-tier-1 consumable.
    cid = stock['consumables'][0]['item']
    status, _ = db._pet_scout_buy(table, sid, doc, {'itemId': cid})
    assert status == 200
    # Second buy before the cooldown elapses is rejected.
    status2, _ = db._pet_scout_buy(table, sid, doc, {'itemId': cid})
    assert status2 == 429


def test_remote_buy_insufficient_spores(table):
    sid, doc = _player_at(table, 'n1')
    doc['position'] = 'cavern_r0'
    doc['pets'] = [_scout(level=1, tier=1)]
    doc['activePetId'] = 'pet-scout'
    doc['spores'] = 0
    node = db._biome_bazaar_node(table, sid, doc)
    stock = db._shop_stock(table, sid, node)
    cid = stock['consumables'][0]['item']
    status, _ = db._pet_scout_buy(table, sid, doc, {'itemId': cid})
    assert status == 409
    assert doc.get('petCooldowns', {}).get('scout') is None
