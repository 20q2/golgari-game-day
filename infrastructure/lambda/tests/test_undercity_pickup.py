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


def test_salvage_owned_gear_frees_slot_and_places_parked(table):
    sid, doc = _player_at(table, 'city_r0')
    slot = db.data.GEAR['bark_hide']['slot']
    doc['gear'] = {slot: 'bark_hide'}
    doc['gearStash'] = ['bark_hide'] * db.data.GEAR_STASH_SIZE
    _park_one(doc, 'gear', 'bark_hide', 'boss')
    status, _ = db._pickup_resolve(table, sid, doc, {'choice': 'salvage-owned', 'index': 0})
    assert status == 200
    assert doc['pendingPickups'] == []
    assert len(doc['gearStash']) == db.data.GEAR_STASH_SIZE      # one out, parked one in
    assert doc['materials']['moltings'] > 0                       # ground the salvaged piece


def test_salvage_owned_consumable_gives_spores(table):
    sid, doc = _player_at(table, 'city_r0')
    cons = list(db.data.CONSUMABLES)[0]
    doc['bag'] = [cons] * db.data.BAG_SIZE
    _park_one(doc, 'consumable', cons)
    spores_before = doc['spores']
    status, _ = db._pickup_resolve(table, sid, doc, {'choice': 'salvage-owned', 'index': 0})
    assert status == 200
    assert doc['spores'] == spores_before + 5
    assert doc['pendingPickups'] == []
    assert len(doc['bag']) == db.data.BAG_SIZE                    # one salvaged, parked one placed


def test_salvage_new_consumable_gives_spores_without_placing(table):
    sid, doc = _player_at(table, 'city_r0')
    cons = list(db.data.CONSUMABLES)[0]
    doc['bag'] = [cons] * db.data.BAG_SIZE
    _park_one(doc, 'consumable', cons)
    spores_before = doc['spores']
    status, _ = db._pickup_resolve(table, sid, doc, {'choice': 'salvage-new'})
    assert status == 200
    assert doc['spores'] == spores_before + 5
    assert doc['pendingPickups'] == []
    assert len(doc['bag']) == db.data.BAG_SIZE        # incoming item never entered the bag


def test_salvage_new_gear_grinds_to_materials_without_placing(table):
    sid, doc = _player_at(table, 'city_r0')
    slot = db.data.GEAR['bark_hide']['slot']
    doc['gear'] = {slot: 'bark_hide'}
    doc['gearStash'] = ['bark_hide'] * db.data.GEAR_STASH_SIZE
    _park_one(doc, 'gear', 'bark_hide', 'boss')
    status, _ = db._pickup_resolve(table, sid, doc, {'choice': 'salvage-new'})
    assert status == 200
    assert doc['pendingPickups'] == []
    assert doc['materials']['moltings'] > 0                       # ground the parked piece
    assert len(doc['gearStash']) == db.data.GEAR_STASH_SIZE       # stash untouched, nothing placed


def test_salvage_owned_escapes_full_market(table):
    """The guaranteed escape: even at the 5-listing cap, salvage-owned resolves."""
    sid, doc = _player_at(table, 'city_r0')
    slot = db.data.GEAR['bark_hide']['slot']
    doc['gear'] = {slot: 'bark_hide'}
    doc['gearStash'] = ['bark_hide'] * db.data.GEAR_STASH_SIZE
    for _ in range(db.data.MARKET_MAX_LISTINGS):
        db._create_market_listing(table, sid, doc, 'gear', 'bark_hide', 45)
    _park_one(doc, 'gear', 'bark_hide')
    assert db._pickup_resolve(table, sid, doc, {'choice': 'salvage-owned', 'index': 0})[0] == 200
    assert doc['pendingPickups'] == []


def test_list_owned_lists_piece_and_places_parked(table):
    sid, doc = _player_at(table, 'city_r0')
    slot = db.data.GEAR['bark_hide']['slot']
    doc['gear'] = {slot: 'bark_hide'}
    doc['gearStash'] = ['bark_hide'] * db.data.GEAR_STASH_SIZE
    _park_one(doc, 'gear', 'bark_hide')
    status, body = db._pickup_resolve(
        table, sid, doc, {'choice': 'list-owned', 'index': 0, 'price': 45})
    assert status == 200
    assert body.get('listingId')
    assert doc['pendingPickups'] == []
    assert len(doc['gearStash']) == db.data.GEAR_STASH_SIZE   # one listed, parked one placed


def test_list_owned_rejects_at_listing_cap(table):
    sid, doc = _player_at(table, 'city_r0')
    slot = db.data.GEAR['bark_hide']['slot']
    doc['gear'] = {slot: 'bark_hide'}
    doc['gearStash'] = ['bark_hide'] * db.data.GEAR_STASH_SIZE
    for _ in range(db.data.MARKET_MAX_LISTINGS):
        db._create_market_listing(table, sid, doc, 'gear', 'bark_hide', 45)
    _park_one(doc, 'gear', 'bark_hide')
    assert db._pickup_resolve(
        table, sid, doc, {'choice': 'list-owned', 'index': 0, 'price': 45})[0] == 409
    assert len(doc['pendingPickups']) == 1                    # unchanged on reject


# ── Auto-place on room (a slot freed elsewhere, e.g. at the Plaza) ────────────

def test_flush_places_consumable_when_slot_freed(table):
    _s, doc = _player_at(table, 'city_r0')
    cons = list(db.data.CONSUMABLES)[0]
    doc['bag'] = [cons] * (db.data.BAG_SIZE - 1)   # a slot opened up (sold at the Plaza)
    _park_one(doc, 'consumable', cons)
    assert db._flush_pickups(doc) == 1
    assert doc['pendingPickups'] == []
    assert len(doc['bag']) == db.data.BAG_SIZE     # parked item dropped straight in


def test_flush_noop_when_container_still_full(table):
    _s, doc = _player_at(table, 'city_r0')
    cons = list(db.data.CONSUMABLES)[0]
    doc['bag'] = [cons] * db.data.BAG_SIZE         # still full — no room opened
    _park_one(doc, 'consumable', cons)
    assert db._flush_pickups(doc) == 0
    assert len(doc['pendingPickups']) == 1         # stays parked
    assert len(doc['bag']) == db.data.BAG_SIZE


def test_flush_gear_equips_empty_slot(table):
    _s, doc = _player_at(table, 'city_r0')
    slot = db.data.GEAR['bark_hide']['slot']
    doc['gear'] = {}                                # slot empty
    doc['gearStash'] = ['bark_hide'] * db.data.GEAR_STASH_SIZE  # stash full
    _park_one(doc, 'gear', 'bark_hide')
    assert db._flush_pickups(doc) == 1
    assert doc['gear'][slot] == 'bark_hide'         # auto-equipped, not stashed
    assert doc['pendingPickups'] == []


def test_flush_gear_stashes_when_stash_has_room(table):
    _s, doc = _player_at(table, 'city_r0')
    slot = db.data.GEAR['bark_hide']['slot']
    doc['gear'] = {slot: 'bark_hide'}               # slot filled
    doc['gearStash'] = []                           # but the stash has room
    _park_one(doc, 'gear', 'bark_hide')
    assert db._flush_pickups(doc) == 1
    assert doc['gearStash'] == ['bark_hide']
    assert doc['pendingPickups'] == []


def test_flush_places_only_fitting_kinds(table):
    """A mixed queue: the kind with room places; the still-full kind stays parked."""
    _s, doc = _player_at(table, 'city_r0')
    cons = list(db.data.CONSUMABLES)[0]
    scroll = (db.data.SCROLLABLE_BY_TIER.get(1) or [None])[0]
    assert scroll
    doc['bag'] = [cons] * (db.data.BAG_SIZE - 1)    # bag has a free slot
    doc['scrolls'] = [scroll] * db.data.SCROLL_SATCHEL_CAP  # satchel full
    _park_one(doc, 'consumable', cons)
    _park_one(doc, 'scroll', scroll)
    assert db._flush_pickups(doc) == 1
    assert [p['kind'] for p in doc['pendingPickups']] == ['scroll']  # scroll stays
    assert len(doc['bag']) == db.data.BAG_SIZE


def test_state_read_auto_places_freed_pickup(table):
    """Display path: a poll after a slot frees shows the item placed + queue empty,
    so the pickup dialogue closes without a manual resolve."""
    sid, doc = _player_at(table, 'city_r0')
    cons = list(db.data.CONSUMABLES)[0]
    doc['bag'] = [cons] * (db.data.BAG_SIZE - 1)
    _park_one(doc, 'consumable', cons)
    db._put_player(table, doc)
    _, state = db.handle_state(table, {'userId': 'user-alex'})
    assert state['you']['pendingPickups'] == []
    assert len(state['you']['bag']) == db.data.BAG_SIZE


def test_action_persists_auto_placed_pickup(table):
    """Persist path: the next action's preprocess flushes and the handler's save
    commits it, so the placement survives in the stored doc."""
    sid, doc = _player_at(table, 'city_r0')
    cons = list(db.data.CONSUMABLES)[0]
    doc['bag'] = [cons] * (db.data.BAG_SIZE - 1)
    _park_one(doc, 'consumable', cons)
    db._put_player(table, doc)
    status, _ = act(table, 'set-status', status='sorting')
    assert status == 200
    after = db._get_player(table, sid, 'user-alex')
    assert after.get('pendingPickups') == []
    assert len(after['bag']) == db.data.BAG_SIZE


def test_board_game_reward_parks_when_bag_full(table):
    sid, doc = _player_at(table, 'city_r0')
    cons = list(db.data.CONSUMABLES)[0]
    doc['bag'] = [cons] * db.data.BAG_SIZE
    db._put_player(table, doc)
    db.grant_board_game_rewards(table, sid, [doc['userId']], [doc['userId']], 'Wingspan')
    after = db._get_player(table, sid, doc['userId'])
    assert any(p['kind'] == 'consumable' for p in (after.get('pendingPickups') or []))
