import undercity_db as db

from tests.test_undercity_db import (  # noqa: F401
    table, act, _sid, _player_at)


def _two_players(table):
    """Alex (seller, via _player_at) + Bob (buyer, joined + persisted)."""
    sid, seller = _player_at(table, 'city_r0', spores=0)
    act(table, 'join', user='user-bob', name='Bob', starter='pest')
    buyer = db._get_player(table, sid, 'user-bob')
    return sid, seller, buyer


def _listing_gone(table, sid, lid):
    return db._get(table, db._season_pk(sid), f'MARKET#{lid}') is None


def test_market_list_and_buy_flow(table):
    sid, seller, buyer = _two_players(table)
    seller['gearStash'] = ['bark_hide']            # tier-2 carapace, cost 45
    status, body = db._market_list(table, sid, seller, {'index': 0, 'price': 45})
    assert status == 200
    lid = body['listingId']
    assert seller['gearStash'] == []

    buyer['spores'] = 100
    buyer['gearStash'] = []
    status, _ = db._market_buy(table, sid, buyer, {'listingId': lid})
    assert status == 200
    assert buyer['spores'] == 55                   # 100 - 45
    assert buyer['gearStash'] == ['bark_hide']

    seller_after = db._get_player(table, sid, 'user-alex')
    assert seller_after['spores'] == 45            # credited (started at 0)
    assert any(e.get('kind') == 'market' for e in (seller_after.get('awayEvents') or []))
    assert _listing_gone(table, sid, lid)


def test_market_list_rejects_out_of_band_price(table):
    sid, seller = _player_at(table, 'city_r0')
    seller['gearStash'] = ['bark_hide']            # band 22..90
    assert db._market_list(table, sid, seller, {'index': 0, 'price': 5})[0] == 409
    assert db._market_list(table, sid, seller, {'index': 0, 'price': 999})[0] == 409
    assert seller['gearStash'] == ['bark_hide']    # unchanged on reject


def test_market_cannot_buy_own_listing(table):
    sid, seller = _player_at(table, 'city_r0', spores=100)
    seller['gearStash'] = ['bark_hide']
    _, body = db._market_list(table, sid, seller, {'index': 0, 'price': 45})
    assert db._market_buy(table, sid, seller, {'listingId': body['listingId']})[0] == 409


def test_market_cancel_returns_gear(table):
    sid, seller = _player_at(table, 'city_r0')
    seller['gearStash'] = ['bark_hide']
    _, body = db._market_list(table, sid, seller, {'index': 0, 'price': 45})
    lid = body['listingId']
    assert seller['gearStash'] == []
    # A real action re-fetches the doc (fresh optimistic-lock version).
    seller = db._get_player(table, sid, 'user-alex')
    status, _ = db._market_cancel(table, sid, seller, {'listingId': lid})
    assert status == 200
    assert seller['gearStash'] == ['bark_hide']
    assert _listing_gone(table, sid, lid)


def test_market_listing_sold_only_once(table):
    sid, seller, buyer = _two_players(table)
    seller['gearStash'] = ['bark_hide']
    _, body = db._market_list(table, sid, seller, {'index': 0, 'price': 45})
    lid = body['listingId']
    buyer['spores'] = 100
    assert db._market_buy(table, sid, buyer, {'listingId': lid})[0] == 200
    buyer2 = db._get_player(table, sid, 'user-bob')
    buyer2['spores'] = 100
    assert db._market_buy(table, sid, buyer2, {'listingId': lid})[0] == 409   # already claimed


def test_market_buy_requires_spores(table):
    sid, seller, buyer = _two_players(table)
    seller['gearStash'] = ['bark_hide']
    _, body = db._market_list(table, sid, seller, {'index': 0, 'price': 45})
    buyer['spores'] = 10
    assert db._market_buy(table, sid, buyer, {'listingId': body['listingId']})[0] == 409


def test_market_listing_appears_in_state(table):
    sid, seller = _player_at(table, 'city_r0')
    seller['gearStash'] = ['bark_hide']
    db._market_list(table, sid, seller, {'index': 0, 'price': 45})
    status, state = db.handle_state(table, {'userId': 'user-alex'})
    assert status == 200
    assert any(l['gearId'] == 'bark_hide' and l['price'] == 45 for l in state['market'])


def test_market_price_band_by_kind():
    assert db._market_price_band('gear', 'bark_hide') == (22, 90)          # cost 45
    assert db._market_price_band('consumable', 'healing_moss') == (6, 24)  # cost 12
    assert db._market_price_band('scroll', 'spore_bolt') == (5, 20)        # INSCRIBE_COST[1]=10


def test_market_list_consumable(table):
    sid, seller = _player_at(table, 'city_r0')
    seller['bag'] = ['healing_moss']                       # cost 12, band 6..24
    status, body = db._market_list(table, sid, seller, {'kind': 'consumable', 'index': 0, 'price': 12})
    assert status == 200
    assert seller['bag'] == []
    listing = db._get(table, db._season_pk(sid), f"MARKET#{body['listingId']}")
    assert listing['kind'] == 'consumable' and listing['itemId'] == 'healing_moss'


def test_market_list_scroll(table):
    sid, seller = _player_at(table, 'city_r0')
    seller['scrolls'] = ['spore_bolt']                     # INSCRIBE_COST[1]=10, band 5..20
    status, body = db._market_list(table, sid, seller, {'kind': 'scroll', 'index': 0, 'price': 15})
    assert status == 200
    assert seller['scrolls'] == []


def test_market_list_consumable_rejects_out_of_band(table):
    sid, seller = _player_at(table, 'city_r0')
    seller['bag'] = ['healing_moss']
    assert db._market_list(table, sid, seller, {'kind': 'consumable', 'index': 0, 'price': 1})[0] == 409
    assert db._market_list(table, sid, seller, {'kind': 'consumable', 'index': 0, 'price': 999})[0] == 409
    assert seller['bag'] == ['healing_moss']               # unchanged on reject


def test_market_list_rejects_unknown_kind(table):
    sid, seller = _player_at(table, 'city_r0')
    seller['gearStash'] = ['bark_hide']
    assert db._market_list(table, sid, seller, {'kind': 'grimoire', 'index': 0, 'price': 45})[0] == 400
