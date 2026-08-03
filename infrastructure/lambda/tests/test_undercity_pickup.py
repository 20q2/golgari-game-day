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
