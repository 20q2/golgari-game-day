import undercity_db as db

from tests.test_undercity_db import (  # noqa: F401
    table, act, _sid, _player_at)


def _park_one(doc, kind, item_id, source='loot'):
    doc.setdefault('pendingPickups', []).append(
        {'kind': kind, 'itemId': item_id, 'source': source, 'at': db._now()})


def test_fresh_doc_has_empty_pending_pickups(table):
    _sid_val, doc = _player_at(table, 'city_r0')
    assert doc.get('pendingPickups') == []


def test_acquire_gear_equips_empty_slot(table):
    _s, doc = _player_at(table, 'city_r0')
    doc['gear'] = {}
    r = db._acquire(doc, 'gear', 'bark_hide', 'loot')
    assert r['outcome'] == 'equipped'
    assert doc['gear'][db.data.GEAR['bark_hide']['slot']] == 'bark_hide'
    assert doc['pendingPickups'] == []


def test_acquire_gear_stashes_when_slot_filled(table):
    _s, doc = _player_at(table, 'city_r0')
    slot = db.data.GEAR['bark_hide']['slot']
    doc['gear'] = {slot: 'bark_hide'}
    doc['gearStash'] = []
    r = db._acquire(doc, 'gear', 'bark_hide', 'loot')
    assert r['outcome'] == 'stashed'
    assert doc['gearStash'] == ['bark_hide']


def test_acquire_gear_parks_when_stash_full(table):
    _s, doc = _player_at(table, 'city_r0')
    slot = db.data.GEAR['bark_hide']['slot']
    doc['gear'] = {slot: 'bark_hide'}
    doc['gearStash'] = ['bark_hide'] * db.data.GEAR_STASH_SIZE
    r = db._acquire(doc, 'gear', 'bark_hide', 'boss')
    assert r['outcome'] == 'pending'
    assert doc['pendingPickups'] == [
        {'kind': 'gear', 'itemId': 'bark_hide', 'source': 'boss',
         'at': doc['pendingPickups'][0]['at']}]
    # nothing was ground into materials
    assert doc['materials'] == {'moltings': 0, 'ichor': 0}


def test_gear_find_text_pending_mentions_full_stash(table):
    drop = {'id': 'bark_hide', 'slot': db.data.GEAR['bark_hide']['slot'],
            'tier': 2, 'outcome': 'pending'}
    text = db._gear_find_text(drop)
    assert 'bark' in text.lower() or db.data.GEAR['bark_hide']['name'] in text
    assert 'full' in text.lower()
    assert db._drop_phrase(drop) == 'set aside'


def test_give_consumable_parks_when_bag_full(table):
    _s, doc = _player_at(table, 'city_r0')
    doc['bag'] = ['healing_moss'] * db.data.BAG_SIZE
    spores_before = doc['spores']
    item = db._give_consumable(doc, 'reward')
    assert item is not None                      # item still granted (not lost)
    assert doc['spores'] == spores_before        # no silent Spore salvage
    assert doc['pendingPickups'][0]['kind'] == 'consumable'
    assert doc['pendingPickups'][0]['itemId'] == item


def test_scroll_drop_parks_when_satchel_full(table):
    _s, doc = _player_at(table, 'city_r0')
    pool = db.data.SCROLLABLE_BY_TIER.get(1) or []
    assert pool
    doc['scrolls'] = [pool[0]] * db.data.SCROLL_SATCHEL_CAP
    spores_before = doc['spores']
    parked = db._acquire(doc, 'scroll', pool[0], 'battle')
    assert parked['outcome'] == 'pending'
    assert doc['spores'] == spores_before
    assert doc['pendingPickups'][0]['kind'] == 'scroll'


def test_pickup_resolve_list_new_lists_and_pops(table):
    sid, doc = _player_at(table, 'city_r0')
    _park_one(doc, 'gear', 'bark_hide')            # band 22..90
    status, body = db._pickup_resolve(table, sid, doc, {'choice': 'list-new', 'price': 45})
    assert status == 200
    assert doc['pendingPickups'] == []
    assert body.get('listingId')


def test_pickup_resolve_list_new_rejects_out_of_band(table):
    sid, doc = _player_at(table, 'city_r0')
    _park_one(doc, 'gear', 'bark_hide')
    assert db._pickup_resolve(table, sid, doc, {'choice': 'list-new', 'price': 5})[0] == 409
    assert len(doc['pendingPickups']) == 1         # unchanged on reject


def test_pickup_resolve_empty_queue_is_error(table):
    sid, doc = _player_at(table, 'city_r0')
    assert db._pickup_resolve(table, sid, doc, {'choice': 'list-new', 'price': 45})[0] == 409
