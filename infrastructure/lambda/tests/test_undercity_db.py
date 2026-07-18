"""Integration tests for the action dispatcher against an in-memory table."""
import sys
from datetime import datetime, timedelta
from decimal import Decimal
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parents[1]))

import pytest
from botocore.exceptions import ClientError

import undercity_data as data
import undercity_db as db


def _ddb_copy(obj, reject_float=False):
    """Deep-copy a value the way boto3's DynamoDB resource treats it: Python
    floats are UNSUPPORTED (must be Decimal) — mirror that so the suite catches
    float-persistence bugs. Decimals pass through (as real DynamoDB stores them)."""
    if isinstance(obj, bool):
        return obj
    if isinstance(obj, float):
        if reject_float:
            raise TypeError('Float types are not supported. Use Decimal types instead.')
        return obj
    if isinstance(obj, dict):
        return {k: _ddb_copy(v, reject_float) for k, v in obj.items()}
    if isinstance(obj, list):
        return [_ddb_copy(v, reject_float) for v in obj]
    return obj


class FakeTable:
    """Minimal in-memory stand-in for a boto3 Table (the subset db.py uses)."""

    def __init__(self):
        self.items = {}

    def _key(self, item_or_key):
        return (item_or_key['pk'], item_or_key['sk'])

    def put_item(self, Item, ConditionExpression=None, ExpressionAttributeValues=None):
        key = self._key(Item)
        if ConditionExpression == 'attribute_not_exists(pk)' and key in self.items:
            raise ClientError({'Error': {'Code': 'ConditionalCheckFailedException'}}, 'PutItem')
        if ConditionExpression == 'ver = :v':
            existing = self.items.get(key)
            if not existing or existing.get('ver') != ExpressionAttributeValues[':v']:
                raise ClientError({'Error': {'Code': 'ConditionalCheckFailedException'}}, 'PutItem')
        # Real DynamoDB rejects float; the write path must convert to Decimal.
        self.items[key] = _ddb_copy(Item, reject_float=True)
        return {}

    def get_item(self, Key):
        item = self.items.get(self._key(Key))
        return {'Item': _ddb_copy(item)} if item else {}

    def delete_item(self, Key):
        self.items.pop(self._key(Key), None)
        return {}

    def query(self, KeyConditionExpression, ExpressionAttributeValues,
              ScanIndexForward=True, Limit=None):
        pk = ExpressionAttributeValues[':pk']
        sk = ExpressionAttributeValues.get(':sk')
        out = []
        for (ipk, isk), item in self.items.items():
            if ipk != pk:
                continue
            if 'begins_with' in KeyConditionExpression and not isk.startswith(sk):
                continue
            if 'sk >= :sk' in KeyConditionExpression and not isk >= sk:
                continue
            out.append(item)
        out.sort(key=lambda i: i['sk'], reverse=not ScanIndexForward)
        if Limit:
            out = out[:Limit]
        return {'Items': _ddb_copy(out)}


def act(table, atype, user='user-alex', name='Alex', **payload):
    status, resp = db.handle_action(table, {
        'type': atype, 'userId': user, 'username': name, 'payload': payload})
    return status, resp


@pytest.fixture
def table():
    t = FakeTable()
    status, resp = act(t, 'season-start', hostKey='swampking')
    assert status == 200
    return t


def test_full_join_roll_move_flow(table, monkeypatch):
    monkeypatch.setattr(data, 'DEBUG', False)  # assert the real roll economy
    status, resp = act(table, 'join', starter='saproling', home='cavern')
    assert status == 200
    you = resp['you']
    assert you['hp'] == 38 and you['position'] == 'cavern_r0' and you['rolls'] == 3
    assert you['homeBiome'] == 'cavern'
    assert you['passives'] == ['regrowth']

    status, resp = act(table, 'roll')
    assert status == 200
    roll = resp['roll']
    assert 1 <= roll['value'] <= 6 and roll['destinations']

    dest = roll['destinations'][0]
    status, resp = act(table, 'move', to=dest)
    assert status == 200
    assert resp['you']['position'] in data.MAP_NODES  # warp/teleport may relocate
    assert resp['you']['rolls'] == 2
    assert resp['spaceEvent']['type']

    # State reflects it all.
    status, state = db.handle_state(table, {'userId': 'user-alex'})
    assert status == 200
    assert state['season']['status'] == 'active'
    assert state['you']['userId'] == 'user-alex'
    assert any(e['type'] == 'hatch' for e in state['events'])
    assert state['wardrobe']['seals'] == 1


# ── Interactive-battle test helpers (Plan 2) ─────────────────────────────────

_COUNTER = {'aggress': 'guard', 'guard': 'feint', 'feint': 'aggress'}


def _kill_npc(att, dfn, *a, **k):
    dfn.hp = 0
    return [{'round': 1, 'by': 'attacker', 'dmg': 99, 'winner': 'attacker'}]


def _kill_player(att, dfn, *a, **k):
    att.hp = 0
    return [{'round': 1, 'by': 'defender', 'dmg': 99, 'winner': 'defender'}]


def _finish_started_battle(table, monkeypatch, doc, outcome='attacker',
                           defender_hp=0, user='user-alex', name='Alex'):
    """Given a doc with a freshly started battle, persist it, stub resolve_round
    to reach `outcome`, submit one combat-round, and return its spaceEvent."""
    if outcome == 'timeout':
        doc['battle']['round'] = data.MAX_ROUNDS_COMBAT   # end on this call

        def _stub(att, dfn, *a, **k):
            dfn.hp = defender_hp
            return []
        monkeypatch.setattr(db.engine, 'resolve_round', _stub)
    else:
        monkeypatch.setattr(db.engine, 'resolve_round',
                            _kill_npc if outcome == 'attacker' else _kill_player)
    db._put_player(table, doc)
    status, resp = act(table, 'combat-round', user=user, name=name, stance='aggress')
    assert status == 200, resp
    return resp.get('spaceEvent', resp)


def test_wild_win_surfaces_rewards(table, monkeypatch):
    # The victory popup depends on the win event carrying spores + xp (+ levels).
    act(table, 'join', starter='pest')
    sid = _sid(table)
    doc = db._get_player(table, sid, 'user-alex')
    ev = db._wild_battle(table, sid, doc)
    assert ev['type'] == 'battle_start'
    se = _finish_started_battle(table, monkeypatch, doc, 'attacker')
    assert se['type'] == 'wild'
    assert se['spores'] >= 1                        # bounty
    assert se['xp'] == 10                           # per-NPC xp (normal tier)
    assert 'levels' not in se                       # 10 xp < first level-up cost


def test_elite_battle_pulls_from_elite_pool(table, monkeypatch):
    act(table, 'join', starter='pest')
    sid = _sid(table)
    doc = db._get_player(table, sid, 'user-alex')
    ev = db._wild_battle(table, sid, doc, elite=True)
    assert ev['type'] == 'battle_start' and ev['npc']['id'] in {'fetid_imp', 'rot_shambler'}
    se = _finish_started_battle(table, monkeypatch, doc, 'attacker')
    assert se['type'] == 'elite'
    assert se['xp'] == 25


def test_elite_space_resolves_to_elite_battle(table, monkeypatch):
    act(table, 'join', starter='pest')
    sid = _sid(table)
    doc = db._get_player(table, sid, 'user-alex')
    assert data.MAP_NODES['city_i1']['type'] == 'elite'
    ev = db._resolve_space(table, sid, doc, 'city_i1', None)
    assert ev['type'] == 'battle_start'
    assert ev['npc']['id'] in {'fetid_imp', 'rot_shambler'}


def test_roll_picks_exact_face_in_debug(table, monkeypatch):
    monkeypatch.setattr(data, 'DEBUG', True)
    act(table, 'join', starter='saproling', home='cavern')
    status, resp = act(table, 'roll', value=4)
    assert status == 200
    assert resp['roll']['value'] == 4


def test_roll_pick_ignored_when_debug_off(table, monkeypatch):
    monkeypatch.setattr(data, 'DEBUG', False)
    monkeypatch.setattr(db._rng, 'randint', lambda a, b: 2)
    act(table, 'join', starter='saproling', home='cavern')
    # A picked value must not bypass the real random roll economy.
    status, resp = act(table, 'roll', value=6)
    assert status == 200
    assert resp['roll']['value'] == 2


def test_join_is_idempotent_and_seal_rolls(table):
    act(table, 'join', starter='pest')
    status, resp = act(table, 'join', starter='kraul')
    assert status == 200
    assert resp['you']['species'] == 'pest'  # second join ignored

    # A veteran with 2 seals starts with +2 rolls.
    perm = db._get_perm(table, 'user-vet')
    perm['seals'] = 2
    table.put_item(Item=perm)
    status, resp = act(table, 'join', user='user-vet', name='Vet', starter='zombie')
    assert resp['you']['rolls'] == 5


def test_move_requires_matching_pending(table):
    act(table, 'join', starter='pest')
    status, resp = act(table, 'move', to='n3')
    assert status == 409
    act(table, 'roll')
    status, resp = act(table, 'move', to='not-a-node')
    assert status == 409


def test_claims_and_cooldowns(table):
    act(table, 'join', starter='pest', home='cavern')
    status, resp = act(table, 'claim', kind='finished_won')
    assert status == 200
    assert resp['you']['rolls'] == 6 and resp['you']['spores'] == 10
    status, resp = act(table, 'claim', kind='finished')
    assert status == 429  # 15-min cooldown

    status, resp = act(table, 'claim', kind='taught')
    assert status == 200 and resp['you']['xp'] == 5
    act(table, 'claim', kind='taught')
    status, resp = act(table, 'claim', kind='taught')
    assert status == 429  # 2× per night


def test_roll_cap_reports_lost(table):
    act(table, 'join', starter='pest', home='cavern')
    status, resp = act(table, 'claim', kind='finished_won')  # 3 + 3 = 6 (cap)
    assert resp['you']['rolls'] == 6
    assert resp['granted'] == 3 and resp['lostToCap'] == 0


def test_pvp_battle_and_compost(table):
    act(table, 'join', starter='kraul', home='cavern')
    act(table, 'join', user='user-sam', name='Sam', starter='saproling', home='cavern')
    # Put both on the same node and make Sam nearly dead.
    alex = db._get_player(table, _sid(table), 'user-alex')
    sam = db._get_player(table, _sid(table), 'user-sam')
    alex['position'] = sam['position'] = 'city_r2'
    alex['atk'] = 50
    sam['hp'] = 5
    sam['spores'] = 100
    db._put_player(table, alex)
    db._put_player(table, sam)

    status, resp = act(table, 'battle', targetUserId='user-sam')
    assert status == 200
    assert resp['winner'] == 'user-alex'
    assert resp['stolen'] == 25
    assert resp['you']['spores'] == 25
    assert resp['you']['pvpWins'] == 1

    sam = db._get_player(table, _sid(table), 'user-sam')
    assert sam['position'] == 'cavern_r0'    # composted → home gate
    assert sam['shieldUntil'] > db._now()    # compost shield
    assert sam['spores'] == 75

    # Shielded player can't be attacked again.
    alex = db._get_player(table, _sid(table), 'user-alex')
    alex['position'] = 'city_r2'
    db._put_player(table, alex)
    status, resp = act(table, 'battle', targetUserId='user-sam')
    assert status == 409


def test_shop_shrine_gamble_guards(table):
    act(table, 'join', starter='pest')
    status, resp = act(table, 'buy', itemId='rusted_fang')
    assert status == 409  # not at a shop
    status, resp = act(table, 'shrine', choice='atk')
    assert status == 409
    status, resp = act(table, 'gamble', bet=5, call='high')
    assert status == 409


def test_ossuary_three_rolls_then_locked(table):
    act(table, 'join', starter='pest')
    sid = _sid(table)
    oss = next(n for n, v in data.MAP_NODES.items() if v['type'] == 'ossuary')
    doc = db._get_player(table, sid, 'user-alex')
    doc['position'] = oss
    doc['spores'] = 500
    doc['ossuaryRollsLeft'] = data.OSSUARY_ROLLS_PER_VISIT
    db._put_player(table, doc)

    for expect_left in (2, 1, 0):
        status, resp = act(table, 'gamble', bet=5, call='high')
        assert status == 200
        assert resp['gamble']['rollsLeft'] == expect_left

    # Fourth attempt is refused until you land here again.
    status, resp = act(table, 'gamble', bet=5, call='high')
    assert status == 409

    # Landing on the Ossuary refills the visit.
    doc = db._get_player(table, sid, 'user-alex')
    ev = db._resolve_space(table, sid, doc, oss, oss)
    assert ev['type'] == 'ossuary'
    assert doc['ossuaryRollsLeft'] == data.OSSUARY_ROLLS_PER_VISIT


def _seed_shop(table, sid, node, gear=None, consumables=None, grimoires=None):
    """Write a deterministic bazaar stock for the current window."""
    rec = {
        'window': db._shop_window(),
        'gear': gear if gear is not None else [{'item': 'rusted_fang', 'qty': 2}],
        'consumables': (consumables if consumables is not None
                        else [{'item': 'healing_moss', 'qty': 2}]),
        'grimoires': grimoires if grimoires is not None else ['moldering_folio'],
    }
    table.put_item(Item={'pk': db._season_pk(sid), 'sk': f'SHOP#{node}', **rec})
    return node


def _at_shop(table, spores=200):
    act(table, 'join', starter='pest')
    sid = _sid(table)
    node = next(n for n, v in data.MAP_NODES.items() if v['type'] == 'shop')
    doc = db._get_player(table, sid, 'user-alex')
    doc['position'] = node
    doc['spores'] = spores
    db._put_player(table, doc)
    return sid, node


def test_buy_depletes_stock_then_sold_out(table):
    sid, node = _at_shop(table)
    _seed_shop(table, sid, node, consumables=[{'item': 'healing_moss', 'qty': 2}])
    # Two units in stock -> two buys succeed, third is sold out.
    for _ in range(2):
        status, resp = act(table, 'buy', itemId='healing_moss')
        assert status == 200
    status, resp = act(table, 'buy', itemId='healing_moss')
    assert status == 409 and 'Sold out' in resp['error']


def test_buy_rejects_unstocked_item(table):
    sid, node = _at_shop(table)
    _seed_shop(table, sid, node, gear=[{'item': 'rusted_fang', 'qty': 2}])
    status, resp = act(table, 'buy', itemId='wurm_tooth')  # not in the seeded stock
    assert status == 409 and 'stocking' in resp['error']


def test_buy_grimoire_requires_stock_but_never_depletes(table):
    sid, node = _at_shop(table)
    _seed_shop(table, sid, node, grimoires=['moldering_folio'])
    # Not stocked -> refused.
    status, resp = act(table, 'buy', itemId='gardeners_primer')
    assert status == 409
    # Stocked -> alex buys; the stock is NOT decremented (no qty on grimoires).
    status, resp = act(table, 'buy', itemId='moldering_folio')
    assert status == 200 and 'moldering_folio' in resp['you']['grimoires']
    rec = db._get(table, db._season_pk(sid), f'SHOP#{node}')
    assert rec['grimoires'] == ['moldering_folio']
    # A second player can still buy the same tome this window (no depletion).
    act(table, 'join', user='user-bea', name='Bea', starter='kraul')
    bea = db._get_player(table, sid, 'user-bea')
    bea['position'] = node
    bea['spores'] = 200
    db._put_player(table, bea)
    status, resp = act(table, 'buy', user='user-bea', name='Bea', itemId='moldering_folio')
    assert status == 200 and 'moldering_folio' in resp['you']['grimoires']


def test_buy_gear_and_consumables(table):
    sid, node = _at_shop(table)
    _seed_shop(table, sid, node,
               gear=[{'item': 'rusted_fang', 'qty': 2}, {'item': 'wurm_tooth', 'qty': 2}],
               consumables=[{'item': 'healing_moss', 'qty': 2}])
    status, resp = act(table, 'buy', itemId='rusted_fang')
    assert status == 200 and resp['you']['gear']['fang'] == 'rusted_fang'
    assert resp['you']['spores'] == 180
    status, resp = act(table, 'buy', itemId='wurm_tooth')  # trade-in refunds 10
    assert resp['you']['spores'] == 180 - 80 + 10
    assert resp['you']['gear']['fang'] == 'wurm_tooth'
    status, resp = act(table, 'buy', itemId='healing_moss')
    assert status == 200 and 'healing_moss' in resp['you']['bag']


def test_evolution_gates_and_bonuses(table):
    act(table, 'join', starter='saproling')
    status, resp = act(table, 'evolve', form='slitherhead')
    assert status == 409  # level 5 required
    sid = _sid(table)
    doc = db._get_player(table, sid, 'user-alex')
    doc['level'] = 5
    db._put_player(table, doc)
    status, resp = act(table, 'evolve', form='kraul_warrior')
    assert status == 400  # wrong line
    status, resp = act(table, 'evolve', form='slitherhead')
    assert status == 200
    you = resp['you']
    assert you['tier'] == 2 and you['maxHp'] == 38 + 6 and you['atk'] == 5 + 2
    assert you['hp'] == you['maxHp']
    assert 'scavenge' in you['passives'] and 'regrowth' in you['passives']

    doc = db._get_player(table, sid, 'user-alex')
    doc['level'] = 10
    db._put_player(table, doc)
    status, resp = act(table, 'evolve', form='swamp_dragon')
    assert status == 400  # slitherhead can't be a dragon
    status, resp = act(table, 'evolve', form='izoni')
    assert status == 200 and resp['you']['tier'] == 3


def test_poke_grants_rolls_capped(table):
    act(table, 'join', starter='pest')
    act(table, 'join', user='user-sam', name='Sam', starter='zombie')
    sid = _sid(table)
    doc = db._get_player(table, sid, 'user-sam')
    doc['rolls'] = 0
    db._put_player(table, doc)
    for i in range(4):
        status, resp = act(table, 'poke', targetUserId='user-sam')
        assert status == 200
    sam = db._get_player(table, sid, 'user-sam')
    assert sam['rolls'] == 3  # only first 3 pokes grant rolls
    assert sam['pokesReceived'] == 4


def test_snare_plant_and_trigger(table):
    act(table, 'join', starter='pest')
    act(table, 'join', user='user-sam', name='Sam', starter='zombie')
    sid = _sid(table)
    alex = db._get_player(table, sid, 'user-alex')
    alex['bag'] = ['snare']
    alex['position'] = 'city_r1'  # loot space
    db._put_player(table, alex)
    status, resp = act(table, 'use-item', item='snare')
    assert status == 200

    sam = db._get_player(table, sid, 'user-sam')
    sam['spores'] = 100
    db._put_player(table, sam)
    event = db._resolve_space(table, sid, sam, 'city_r1', 'city_r0')
    assert event['type'] == 'snare'
    assert sam['spores'] == 90  # spilled 20, grabbed 10 back
    pile = db._get(table, db._season_pk(sid), 'SPACE#city_r1')
    assert pile['pile'] == 10 and not pile.get('ownerId')


def test_trading_post_pre_seed_and_swap(table):
    act(table, 'join', starter='pest')
    sid = _sid(table)
    doc = db._get_player(table, sid, 'user-alex')
    doc['position'] = 'isl_trade'
    doc['bag'] = ['snare']
    db._put_player(table, doc)

    # Landing shows the 3 house items, all tagged "the Swarm".
    ev = db._resolve_space(table, sid, doc, 'isl_trade', 'isl_warp')
    assert ev['type'] == 'trading_post'
    assert [s['item'] for s in ev['stock']] == data.TRADING_POST_SEED
    assert all(s['foundBy'] == 'the Swarm' for s in ev['stock'])

    # Swap our Snare for stock slot 0 (healing_moss).
    status, resp = act(table, 'trade', give='snare', takeIndex=0)
    assert status == 200
    you = resp['you']
    assert 'snare' not in you['bag'] and 'healing_moss' in you['bag']
    assert len(you['bag']) == 1                              # net bag size unchanged
    stock = resp['stock']
    assert len(stock) == data.TRADING_POST_SIZE              # stock stays at 3
    assert stock[0] == {'item': 'snare', 'foundBy': 'Alex'}  # tagged with our name

    # A later visitor sees what we left behind.
    ev2 = db._resolve_space(table, sid, doc, 'isl_trade', 'isl_warp')
    assert ev2['stock'][0] == {'item': 'snare', 'foundBy': 'Alex'}


def test_trading_post_swap_gear(table):
    act(table, 'join', starter='pest')
    sid = _sid(table)
    doc = db._get_player(table, sid, 'user-alex')
    doc['position'] = 'isl_trade'
    doc['gear'] = {'fang': 'rusted_fang'}
    db._put_player(table, doc)

    # Seed the post with a gear item left behind by an earlier visitor.
    db._save_trading_post(table, sid, 'isl_trade',
                           [{'item': 'kraul_barb', 'foundBy': 'Sam'},
                            {'item': 'healing_moss', 'foundBy': 'the Swarm'},
                            {'item': 'loaded_die', 'foundBy': 'the Swarm'}])

    status, resp = act(table, 'trade', give='rusted_fang', takeIndex=0)
    assert status == 200
    you = resp['you']
    assert you['gear']['fang'] == 'kraul_barb'          # new piece equipped
    stock = resp['stock']
    assert stock[0] == {'item': 'rusted_fang', 'foundBy': 'Alex'}  # old piece left behind


def test_trading_post_swap_grimoire(table):
    act(table, 'join', starter='pest')
    sid = _sid(table)
    doc = db._get_player(table, sid, 'user-alex')
    doc['position'] = 'isl_trade'
    doc['grimoires'] = ['moldering_folio']
    doc['equippedGrimoire'] = 'moldering_folio'
    db._put_player(table, doc)

    db._save_trading_post(table, sid, 'isl_trade',
                           [{'item': 'gardeners_primer', 'foundBy': 'Sam'},
                            {'item': 'healing_moss', 'foundBy': 'the Swarm'},
                            {'item': 'loaded_die', 'foundBy': 'the Swarm'}])

    status, resp = act(table, 'trade', give='moldering_folio', takeIndex=0)
    assert status == 200
    you = resp['you']
    assert you['grimoires'] == ['gardeners_primer']
    assert you['equippedGrimoire'] == 'gardeners_primer'  # cleared, then auto-equipped from the take
    assert resp['stock'][0] == {'item': 'moldering_folio', 'foundBy': 'Alex'}


def test_trading_post_take_grimoire_auto_equips_if_none_owned(table):
    act(table, 'join', starter='pest')
    sid = _sid(table)
    doc = db._get_player(table, sid, 'user-alex')
    doc['position'] = 'isl_trade'
    doc['bag'] = ['snare']
    db._put_player(table, doc)

    db._save_trading_post(table, sid, 'isl_trade',
                           [{'item': 'gardeners_primer', 'foundBy': 'Sam'},
                            {'item': 'healing_moss', 'foundBy': 'the Swarm'},
                            {'item': 'loaded_die', 'foundBy': 'the Swarm'}])

    status, resp = act(table, 'trade', give='snare', takeIndex=0)
    assert status == 200
    you = resp['you']
    assert you['grimoires'] == ['gardeners_primer']
    assert you['equippedGrimoire'] == 'gardeners_primer'   # auto-equipped, had none


def test_trading_post_rejects_duplicate_grimoire_take(table):
    act(table, 'join', starter='pest')
    sid = _sid(table)
    doc = db._get_player(table, sid, 'user-alex')
    doc['position'] = 'isl_trade'
    doc['bag'] = ['snare']
    doc['grimoires'] = ['gardeners_primer']
    db._put_player(table, doc)

    db._save_trading_post(table, sid, 'isl_trade',
                           [{'item': 'gardeners_primer', 'foundBy': 'Sam'},
                            {'item': 'healing_moss', 'foundBy': 'the Swarm'},
                            {'item': 'loaded_die', 'foundBy': 'the Swarm'}])

    status, _ = act(table, 'trade', give='snare', takeIndex=0)
    assert status == 409  # already own that grimoire


def test_trading_post_rejects_bag_overflow_take(table):
    act(table, 'join', starter='pest')
    sid = _sid(table)
    doc = db._get_player(table, sid, 'user-alex')
    doc['position'] = 'isl_trade'
    doc['gear'] = {'fang': 'rusted_fang'}
    doc['bag'] = ['healing_moss', 'smoke_spore', 'loaded_die']  # already full
    db._put_player(table, doc)

    db._save_trading_post(table, sid, 'isl_trade',
                           [{'item': 'snare', 'foundBy': 'the Swarm'},
                            {'item': 'chitin_scrap', 'foundBy': 'the Swarm'},
                            {'item': 'moldering_folio', 'foundBy': 'the Swarm'}])

    status, _ = act(table, 'trade', give='rusted_fang', takeIndex=0)
    assert status == 409  # bag is full, can't take a consumable


def test_trading_post_rejects_give_not_owned(table):
    act(table, 'join', starter='pest')
    sid = _sid(table)
    doc = db._get_player(table, sid, 'user-alex')
    doc['position'] = 'isl_trade'
    doc['gear'] = {}
    doc['grimoires'] = []
    db._put_player(table, doc)

    status, _ = act(table, 'trade', give='rusted_fang', takeIndex=0)
    assert status == 409  # don't have that gear equipped
    status, _ = act(table, 'trade', give='moldering_folio', takeIndex=0)
    assert status == 409  # don't own that grimoire


def test_trading_post_guards(table):
    act(table, 'join', starter='pest')
    sid = _sid(table)
    status, _ = act(table, 'trade', give='snare', takeIndex=0)
    assert status == 409  # not standing at a trading post

    doc = db._get_player(table, sid, 'user-alex')
    doc['position'] = 'isl_trade'
    doc['bag'] = ['snare']
    db._put_player(table, doc)
    status, _ = act(table, 'trade', give='loaded_die', takeIndex=0)
    assert status == 409  # you don't own that item
    status, _ = act(table, 'trade', give='snare', takeIndex=9)
    assert status == 409  # take index out of range


def test_dig_grid_generation():
    grid = db._gen_dig_grid()
    assert [it['shape'] for it in grid['items']] == data.EXCAVATION_ITEMS
    w, h = grid['w'], grid['h']
    seen = set()
    for it in grid['items']:
        for r, c in it['cells']:
            assert 0 <= r < h and 0 <= c < w          # in bounds
            assert (r, c) not in seen                 # non-overlapping
            seen.add((r, c))
    assert data.MAP_NODES['bone_i0']['type'] == 'excavation'  # Ossuary Fields digs


def test_excavation_dig_reveals_and_collects(table):
    act(table, 'join', starter='pest')
    sid = _sid(table)
    # A single 1x2 relic so clearing it also exercises the reset + bonus.
    site = {'w': 5, 'h': 5, 'revealed': [],
            'items': [{'shape': '1x2', 'cells': [[0, 0], [0, 1]],
                       'loot': {'kind': 'item', 'item': 'healing_moss'},
                       'collected': False, 'by': None}]}
    doc = db._get_player(table, sid, 'user-alex')
    doc['position'] = 'bone_i0'
    doc['excavationDigsLeft'] = data.EXCAVATION_DIGS_PER_VISIT
    doc['bag'] = []
    db._put_player(table, doc)
    db._save_dig_site(table, sid, 'bone_i0', site)

    status, resp = act(table, 'dig', r=0, c=0)       # first cell — partial
    assert status == 200 and resp['found'] is None
    assert resp['digsLeft'] == data.EXCAVATION_DIGS_PER_VISIT - 1

    status, resp = act(table, 'dig', r=0, c=1)       # completes the relic
    assert status == 200
    assert resp['found'] == {'kind': 'item', 'item': 'healing_moss'}
    assert 'healing_moss' in resp['you']['bag']
    assert resp['cleared'] is True                    # last item → reset + bonus
    assert resp['you']['spores'] >= data.EXCAVATION_CLEAR_BONUS


def test_excavation_guards(table):
    act(table, 'join', starter='pest')
    sid = _sid(table)
    status, _ = act(table, 'dig', r=0, c=0)
    assert status == 409  # not at a dig site

    doc = db._get_player(table, sid, 'user-alex')
    doc['position'] = 'bone_i0'
    doc['excavationDigsLeft'] = 0
    db._put_player(table, doc)
    status, _ = act(table, 'dig', r=0, c=0)
    assert status == 409  # out of digs this visit


def test_death_offers_respawn_choice_and_respawn(table):
    act(table, 'join', starter='pest', home='cavern')
    sid = _sid(table)
    doc = db._get_player(table, sid, 'user-alex')
    doc['lastBiome'] = 'bog'  # last home biome you stood in before dying
    db._compost(table, sid, doc, 'test death')
    # Provisional wake at home; a choice is offered between home + last biome.
    assert doc['position'] == 'cavern_r0'
    gates = {o['gate'] for o in doc['pendingRespawn']['options']}
    assert gates == {'cavern_r0', 'bog_r4'}
    db._put_player(table, doc)

    status, resp = act(table, 'respawn', gate='bog_r4')
    assert status == 200
    assert resp['you']['position'] == 'bog_r4'
    assert 'pendingRespawn' not in resp['you']

    status, _ = act(table, 'respawn', gate='bog_r4')
    assert status == 409  # nothing pending anymore


def test_death_in_home_biome_skips_choice(table):
    act(table, 'join', starter='pest', home='cavern')
    sid = _sid(table)
    doc = db._get_player(table, sid, 'user-alex')
    doc['lastBiome'] = 'cavern'  # died in your own biome — both gates identical
    db._compost(table, sid, doc, 'test death')
    assert doc['position'] == 'cavern_r0'
    assert 'pendingRespawn' not in doc


def test_season_end_produces_standings(table):
    act(table, 'join', starter='pest')
    act(table, 'join', user='user-sam', name='Sam', starter='kraul')
    sid = _sid(table)
    doc = db._get_player(table, sid, 'user-sam')
    doc['level'] = 5
    doc['pvpWins'] = 2
    db._put_player(table, doc)

    status, resp = act(table, 'season-end', hostKey='wrong')
    assert status == 403
    status, resp = act(table, 'season-end', hostKey='swampking')
    assert status == 200
    standings = resp['result']['standings']
    assert standings[0]['userId'] == 'user-sam'  # 50+30 renown beats 10

    status, state = db.handle_state(table, {'userId': 'user-alex'})
    assert state['season']['status'] == 'ended'
    assert state['result']['champion']['username'] == 'Sam'
    assert state['hallOfFame'][0]['champion']['username'] == 'Sam'

    # Actions are frozen after end.
    status, resp = act(table, 'roll')
    assert status == 409


def test_customize_validates_wardrobe(table):
    act(table, 'join', starter='pest')
    status, resp = act(table, 'customize', hat='crown')
    assert status == 409  # not owned
    status, resp = act(table, 'customize',
                       paint={'body': 130, 'belly': 50, 'stripes': 50})
    assert status == 200  # default paints: forest(130) + gold(50)
    status, resp = act(table, 'customize', paint={'body': 270})
    assert status == 409  # violet not owned


def test_join_stores_creature_name(table):
    status, resp = act(table, 'join', starter='pest', creatureName='  Mulch  ')
    assert status == 200
    assert resp['you']['creatureName'] == 'Mulch'  # trimmed
    _, state = db.handle_state(table, {'userId': 'user-alex'})
    hatch = next(e for e in state['events'] if e['type'] == 'hatch')
    assert 'named Mulch' in hatch['text']


def test_join_clamps_long_creature_name(table):
    status, resp = act(table, 'join', starter='pest',
                       creatureName='Grubblesworth von Sporington III')
    assert status == 200
    assert len(resp['you']['creatureName']) == 16


def test_join_without_name_falls_back_to_form_name(table):
    status, resp = act(table, 'join', starter='pest')
    assert status == 200
    assert resp['you']['creatureName'] == 'Pest'
    _, state = db.handle_state(table, {'userId': 'user-alex'})
    hatch = next(e for e in state['events'] if e['type'] == 'hatch')
    assert 'named' not in hatch['text']  # no silly "a Pest named Pest"


def test_creature_label_prefers_custom_name():
    assert db._creature_label({'creatureName': 'Mulch', 'form': 'pest'}) == 'Mulch'
    assert db._creature_label({'form': 'pest'}) == 'Pest'  # old docs fall back


def test_state_payloads_carry_creature_name(table):
    act(table, 'join', starter='pest', creatureName='Mulch')
    act(table, 'join', user='user-sam', name='Sam', starter='zombie', creatureName='Puffcap')
    _, state = db.handle_state(table, {'userId': 'user-alex'})
    by_id = {p['userId']: p for p in state['players']}
    assert by_id['user-alex']['creatureName'] == 'Mulch'
    assert by_id['user-sam']['creatureName'] == 'Puffcap'


def test_public_player_exposes_gear_and_effective_stats(table):
    """The spectator/TV broadcast reads gear + atk/def/spd from public state."""
    act(table, 'join', starter='pest')
    sid = _sid(table)
    doc = db._get_player(table, sid, 'user-alex')
    # Equip a fang directly (independent of the shop flow) so the projection has
    # gear to surface and a stat bonus to fold into the effective numbers.
    fang = next(iter(data.GEAR))
    doc['gear'] = {'fang': fang}
    db._put_player(table, doc)

    _, state = db.handle_state(table, {'userId': 'user-alex'})
    pub = {p['userId']: p for p in state['players']}['user-alex']
    assert pub['gear'].get('fang') == fang
    # Effective stats mirror engine.effective_stats (base + gear bonuses).
    eff = db.engine.effective_stats(db._get_player(table, sid, 'user-alex'))
    for stat in ('atk', 'def', 'spd'):
        assert pub[stat] == eff[stat]


def _sid(table):
    return db._get(table, db.META_PK, 'CURRENT')['seasonId']


# ── Unique dungeons (v6) ─────────────────────────────────────────────────────

def _player_at(table, node, **fields):
    act(table, 'join', starter='pest')
    sid, _ = db._active_season(table)
    doc = db._get_player(table, sid, 'user-alex')
    doc['position'] = node
    doc.update(fields)
    return sid, doc


def test_dungeon_wild_is_the_biome_fauna(table, monkeypatch):
    sid, doc = _player_at(table, 'city_d0')  # a Broodwarrens wild space
    ev = db._wild_battle(table, sid, doc)
    assert ev['type'] == 'battle_start' and ev['npc']['id'] == 'broodling'
    se = _finish_started_battle(table, monkeypatch, doc, 'attacker')
    assert se['spores'] >= data.DUNGEON_NPCS['city']['bounty']


def test_bone_chill_consumed_by_next_battle(table, monkeypatch):
    sid, doc = _player_at(table, 'city_r1', buffs=[{'kind': 'bone_chill'}])
    db._wild_battle(table, sid, doc)                 # start (buff frozen into rec)
    _finish_started_battle(table, monkeypatch, doc, 'attacker')
    fresh = db._get_player(table, sid, 'user-alex')
    assert not any(b.get('kind') == 'bone_chill' for b in fresh.get('buffs', []))


def test_webbing_halves_next_roll(table):
    sid, doc = _player_at(table, 'city_d1')
    out = db._hazard(table, sid, doc, 'city_d1')
    assert out['hazardId'] == 'webbing'
    assert any(b.get('kind') == 'vines' for b in doc['buffs'])


def test_spore_cloud_teleports_within_pocket(table):
    sid, doc = _player_at(table, 'cavern_d1')
    out = db._hazard(table, sid, doc, 'cavern_d1')
    assert out['hazardId'] == 'spore_cloud'
    assert doc['position'] != 'cavern_d1'
    assert data.MAP_NODES[doc['position']].get('region') == 'depths'
    assert doc['position'].startswith('cavern_')


def test_sinkwater_takes_15_pct_spores(table):
    sid, doc = _player_at(table, 'bog_d1', spores=100)
    out = db._hazard(table, sid, doc, 'bog_d1')
    assert out['hazardId'] == 'sinkwater'
    assert doc['spores'] == 85


def test_sinkwater_mirefoot_halved(table):
    sid, doc = _player_at(table, 'bog_d1', spores=100, homeBiome='bog')
    db._hazard(table, sid, doc, 'bog_d1')
    assert doc['spores'] == 93   # ceil(100*0.15)=15, Mirefoot halves -> 7 lost


def test_bone_chill_applies_debuff(table):
    sid, doc = _player_at(table, 'bone_d1')
    out = db._hazard(table, sid, doc, 'bone_d1')
    assert out['hazardId'] == 'bone_chill'
    assert any(b.get('kind') == 'bone_chill' for b in doc['buffs'])


def test_rot_bloom_trades_hp_for_spores(table):
    sid, doc = _player_at(table, 'garden_d2', spores=10)
    hp_before = doc['hp']
    out = db._hazard(table, sid, doc, 'garden_d2')
    assert out['hazardId'] == 'rot_bloom'
    assert doc['hp'] == hp_before - 3
    assert doc['spores'] == 14


def test_rot_bloom_never_kills(table):
    sid, doc = _player_at(table, 'garden_d2', hp=2)
    db._hazard(table, sid, doc, 'garden_d2')
    assert doc['hp'] == 1


def test_surface_hazard_unchanged(table):
    # A ring hazard still rolls the generic table (no hazardId key).
    sid, doc = _player_at(table, 'city_r4')
    out = db._hazard(table, sid, doc, 'city_r4')
    assert out['type'] == 'hazard' and 'hazardId' not in out


def test_cache_pays_once_per_player(table):
    sid, doc = _player_at(table, 'city_cache', spores=0)
    out = db._resolve_space(table, sid, doc, 'city_cache', 'city_lair')
    assert out['type'] == 'cache'
    assert doc['spores'] == data.CACHE_REWARD['spores']
    assert 'cache:city_cache' in doc['poiClaims']

    out2 = db._resolve_space(table, sid, doc, 'city_cache', 'city_lair')
    assert out2['type'] == 'cache'
    assert doc['spores'] == data.CACHE_REWARD['spores']  # unchanged


def test_ladder_blurb_names_the_dungeon(table):
    sid, doc = _player_at(table, 'city_lt')
    out = db._resolve_space(table, sid, doc, 'city_lt', 'city_r5')
    assert out['type'] == 'ladder'
    assert 'Broodwarrens' in out['text']


# ── Persistent lair pools + Vestiges ────────────────────────────────────────

def _lair_fight(table, sid, user, outcome, defender_hp, monkeypatch):
    """Start + resolve one lair fight for `user` with a scripted end state.
    Returns (doc, merged-out) where merged-out carries both the entering npc
    (hp/maxHp/name, from battle_start) and the finish rewards (spores/sigil)."""
    doc = db._get_player(table, sid, user)
    doc['position'] = 'city_lair'
    ev = db._lair(table, sid, doc, 'city_lair')          # battle_start
    se = _finish_started_battle(table, monkeypatch, doc, outcome, defender_hp,
                                user=user, name=user)
    out = dict(se)
    out['npc'] = {**ev.get('npc', {}), **se.get('npc', {})}  # entering hp + name
    return db._get_player(table, sid, user), out


def test_lair_hp_lingers_between_challengers(table, monkeypatch):
    act(table, 'join', starter='pest')
    sid, _ = db._active_season(table)
    boss_hp = data.LAIR_BOSSES['city_lair']['hp']
    # First challenger wounds her to 20 and times out.
    _, out = _lair_fight(table, sid, 'user-alex', 'timeout', 20, monkeypatch)
    assert out['npc']['hp'] == boss_hp        # entered at full
    assert out['npc']['maxHp'] == boss_hp
    # Next challenger meets her at 20 HP.
    act(table, 'join', user='user-bea', name='Bea', starter='kraul')
    _, out2 = _lair_fight(table, sid, 'user-bea', 'timeout', 12, monkeypatch)
    assert out2['npc']['hp'] == 20
    assert out2['npc']['maxHp'] == boss_hp


def test_global_first_kill_pays_major_then_vestige_pays_minor_with_sigil(table, monkeypatch):
    act(table, 'join', starter='pest')
    act(table, 'join', user='user-bea', name='Bea', starter='kraul')
    sid, _ = db._active_season(table)
    b = data.LAIR_BOSSES['city_lair']

    # Alex lands the global first kill: major reward + sigil.
    alex, out = _lair_fight(table, sid, 'user-alex', 'attacker', 0, monkeypatch)
    assert out['spores'] == b['first']['spores']
    assert out['sigil'] == 'city'
    assert 'city_lair' in alex['poiClaims']

    # Bea now faces the Vestige — reformed at HALF strength; her kill pays
    # minor but still sigils.
    bea, out2 = _lair_fight(table, sid, 'user-bea', 'attacker', 0, monkeypatch)
    assert out2['npc']['name'].startswith('Vestige of ')
    assert out2['npc']['hp'] == b['hp'] // 2
    assert out2['npc']['maxHp'] == b['hp'] // 2
    assert out2['spores'] == b['repeat']['spores']
    assert out2['sigil'] == 'city'
    assert 'city_lair' in bea['poiClaims']

    # Alex again: vestige, minor reward, no second sigil.
    _, out3 = _lair_fight(table, sid, 'user-alex', 'attacker', 0, monkeypatch)
    assert out3['spores'] == b['repeat']['spores']
    assert 'sigil' not in out3


def test_vestige_hp_also_lingers(table, monkeypatch):
    act(table, 'join', starter='pest')
    sid, _ = db._active_season(table)
    b = data.LAIR_BOSSES['city_lair']
    _lair_fight(table, sid, 'user-alex', 'attacker', 0, monkeypatch)   # slain -> Vestige
    _, out = _lair_fight(table, sid, 'user-alex', 'timeout', 9, monkeypatch)
    assert out['npc']['name'] == f"Vestige of {b['name']}"
    _, out2 = _lair_fight(table, sid, 'user-alex', 'timeout', 5, monkeypatch)
    assert out2['npc']['hp'] == 9


# ── Awaken the Queen (host boss-phase trigger) ───────────────────────────────

def test_boss_awaken_requires_the_host_key(table):
    status, _ = act(table, 'boss-awaken', hostKey='wrong')
    assert status == 403
    _, state = db.handle_state(table, {})
    assert state['season']['bossPhase'] is False


def test_boss_awaken_flips_boss_phase_once(table):
    status, _ = act(table, 'boss-awaken', hostKey='swampking')
    assert status == 200
    _, state = db.handle_state(table, {})
    assert state['season']['bossPhase'] is True
    assert any(e['type'] == 'boss' for e in state['events'])  # feed announces it
    # A second awaken is refused — she's already up.
    status, _ = act(table, 'boss-awaken', hostKey='swampking')
    assert status == 409


def test_boss_awaken_needs_an_active_season(table):
    act(table, 'season-end', hostKey='swampking')
    status, _ = act(table, 'boss-awaken', hostKey='swampking')
    assert status == 409


def test_boss_phase_drops_the_sigil_gate(table, monkeypatch):
    act(table, 'join', starter='pest')
    sid, _ = db._active_season(table)
    doc = db._get_player(table, sid, 'user-alex')
    doc['position'] = 'boss'

    # The rot-wards hold while the player has no sigils.
    out = db._boss(table, sid, doc, 'boss', 'isl_ossuary')
    assert out['type'] == 'boss_sealed'

    # The host awakens her: the same sigil-less player now gets the fight.
    act(table, 'boss-awaken', hostKey='swampking')
    doc['position'] = 'boss'
    out = db._boss(table, sid, doc, 'boss', 'isl_ossuary')
    assert out['type'] == 'battle_start' and out['kind'] == 'boss'


def test_vein_landing_forces_first_strike(table, monkeypatch):
    act(table, 'join', starter='pest')
    sid = _sid(table)
    doc = db._get_player(table, sid, 'user-alex')
    doc['position'] = 'cavern_r3'
    monkeypatch.setattr(db._rng, 'random', lambda: 1.0)   # never cave in, no bonus items
    spores_before = doc.get('spores', 0)
    ev = db._resolve_space(table, sid, doc, 'cavern_r3', 'cavern_r2')
    assert ev['type'] == 'crystal_vein'
    assert ev['depth'] == 1                                # surface -> level 1
    assert ev['strikesLeft'] == data.VEIN_STRIKES_PER_VISIT - 1
    assert doc['spores'] == spores_before + 2              # 1 + level
    rec = db._get(table, db._season_pk(sid), 'VEIN#cavern')
    assert rec['depth'] == 1                               # shared depth persisted


def test_vein_cave_in_hurts_and_resets(table, monkeypatch):
    act(table, 'join', starter='pest')
    sid = _sid(table)
    db._save_vein(table, sid, 'cavern', 9)                 # deep, dangerous shaft
    doc = db._get_player(table, sid, 'user-alex')
    doc['position'] = 'cavern_r3'
    hp_before = doc['hp']
    monkeypatch.setattr(db._rng, 'random', lambda: 0.0)    # guaranteed cave-in
    ev = db._resolve_space(table, sid, doc, 'cavern_r3', 'cavern_r2')
    assert ev['collapsed'] is True
    assert doc['hp'] == max(1, hp_before - 10 * data.VEIN_CAVE_IN_DMG_PER_LEVEL)
    assert doc['veinStrikesLeft'] == 0                     # the visit ends under rubble
    rec = db._get(table, db._season_pk(sid), 'VEIN#cavern')
    assert rec['depth'] == 0                               # collapsed for everyone


def test_vein_strike_action_and_guards(table, monkeypatch):
    act(table, 'join', starter='pest')
    sid = _sid(table)
    status, _ = act(table, 'strike')
    assert status == 409                                    # not at a vein

    doc = db._get_player(table, sid, 'user-alex')
    doc['position'] = 'cavern_r3'
    doc['veinStrikesLeft'] = 2
    db._put_player(table, doc)
    db._save_vein(table, sid, 'cavern', 3)
    monkeypatch.setattr(db._rng, 'random', lambda: 1.0)     # never cave in
    status, resp = act(table, 'strike')
    assert status == 200
    assert resp['depth'] == 4 and resp['strikesLeft'] == 1
    assert resp['you']['spores'] >= 5                       # 1 + level 4

    doc = db._get_player(table, sid, 'user-alex')
    doc['veinStrikesLeft'] = 0
    db._put_player(table, doc)
    status, _ = act(table, 'strike')
    assert status == 409                                    # out of strikes


def test_vein_heartstone_pays_and_resets(table, monkeypatch):
    act(table, 'join', starter='pest')
    sid = _sid(table)
    doc = db._get_player(table, sid, 'user-alex')
    doc['position'] = 'cavern_r3'
    doc['veinStrikesLeft'] = 1
    doc['bag'] = []
    db._put_player(table, doc)
    db._save_vein(table, sid, 'cavern', data.VEIN_MAX_DEPTH - 1)
    monkeypatch.setattr(db._rng, 'random', lambda: 1.0)     # survive the last strike
    spores_before = doc.get('spores', 0)
    status, resp = act(table, 'strike')
    assert status == 200
    assert resp['heartstone'] is True
    assert resp['depth'] == 0                               # shaft refilled
    # 1 + level 12, plus the Heartstone bonus; the rare item goes to the bag.
    assert resp['you']['spores'] == spores_before + 13 + data.VEIN_HEARTSTONE_SPORES
    assert resp['you']['bag'] and resp['you']['bag'][0] in data.VEIN_RARE_ITEMS
    rec = db._get(table, db._season_pk(sid), 'VEIN#cavern')
    assert rec['depth'] == 0


def test_vault_landing_refills_picks_and_hides_combo(table):
    act(table, 'join', starter='pest')
    sid = _sid(table)
    doc = db._get_player(table, sid, 'user-alex')
    doc['position'] = 'n128'
    ev = db._resolve_space(table, sid, doc, 'n128', 'city_r2')
    assert ev['type'] == 'vault_lock'
    assert ev['picksLeft'] == data.VAULT_PICKS_PER_VISIT
    assert doc['vaultPicksLeft'] == data.VAULT_PICKS_PER_VISIT
    assert ev['vault'] == {'pot': data.VAULT_POT_SEED, 'history': []}
    assert 'combo' not in ev['vault']                       # never leaks


def _park_at_vault(table, picks=3):
    sid = _sid(table)
    doc = db._get_player(table, sid, 'user-alex')
    doc['position'] = 'n128'
    doc['vaultPicksLeft'] = picks
    doc['bag'] = []
    db._put_player(table, doc)
    db._save_vault(table, sid, 'city',
                   {'combo': ['spore', 'bone', 'web'], 'pot': data.VAULT_POT_SEED,
                    'history': []})
    return sid


def test_vault_guess_feedback_and_pot(table):
    act(table, 'join', starter='pest')
    sid = _park_at_vault(table)
    # spore right slot; web right sigil wrong slot; moss a miss.
    status, resp = act(table, 'vault-guess', guess=['spore', 'web', 'moss'])
    assert status == 200
    assert resp['guess'] == {'exact': 1, 'near': 1, 'cracked': False,
                             'pot': data.VAULT_POT_SEED + data.VAULT_POT_PER_FAIL,
                             'found': None}
    assert resp['picksLeft'] == 2
    assert len(resp['vault']['history']) == 1
    assert resp['vault']['history'][0]['guess'] == ['spore', 'web', 'moss']
    assert 'combo' not in resp['vault']


def test_vault_guess_guards(table):
    act(table, 'join', starter='pest')
    status, _ = act(table, 'vault-guess', guess=['spore', 'bone', 'web'])
    assert status == 409                                    # not at the vault
    _park_at_vault(table, picks=0)
    status, _ = act(table, 'vault-guess', guess=['spore', 'bone', 'web'])
    assert status == 409                                    # out of picks
    _park_at_vault(table, picks=3)
    status, _ = act(table, 'vault-guess', guess=['spore', 'spore', 'web'])
    assert status == 400                                    # repeats rejected
    status, _ = act(table, 'vault-guess', guess=['spore', 'bone', 'dragon'])
    assert status == 400                                    # unknown sigil


def test_vault_crack_pays_and_resets(table):
    act(table, 'join', starter='pest')
    sid = _park_at_vault(table)
    doc = db._get_player(table, sid, 'user-alex')
    spores_before = doc.get('spores', 0)
    status, resp = act(table, 'vault-guess', guess=['spore', 'bone', 'web'])
    assert status == 200
    assert resp['guess']['cracked'] is True
    assert resp['you']['spores'] == spores_before + data.VAULT_POT_SEED
    assert resp['you']['bag'] and resp['you']['bag'][0] in data.VEIN_RARE_ITEMS
    assert resp['vault'] == {'pot': data.VAULT_POT_SEED, 'history': []}
    rec = db._get(table, db._season_pk(sid), 'VAULT#city')
    # Fresh lock: wiped ledger, reseeded pot, a new 3-distinct-sigil combo
    # (rerolling the same combo by chance is legal).
    assert rec['history'] == [] and rec['pot'] == data.VAULT_POT_SEED
    assert len(set(rec['combo'])) == data.VAULT_SLOTS
    assert all(s in data.VAULT_SIGILS for s in rec['combo'])


def test_state_surfaces_veins_and_vaults(table):
    act(table, 'join', starter='pest')
    sid = _sid(table)
    _, state = db.handle_state(table, {'userId': 'user-alex'})
    assert state['veins'] == {'cavern': {'depth': 0}}       # display-seeded default
    assert state['vaults'] == {'city': {'pot': data.VAULT_POT_SEED, 'history': []}}

    db._save_vein(table, sid, 'cavern', 7)
    db._save_vault(table, sid, 'city',
                   {'combo': ['spore', 'bone', 'web'], 'pot': 44,
                    'history': [{'user': 'Alex', 'guess': ['moss', 'web', 'skull'],
                                 'exact': 0, 'near': 1, 'at': 'x'}]})
    _, state = db.handle_state(table, {'userId': 'user-alex'})
    assert state['veins']['cavern'] == {'depth': 7}
    assert state['vaults']['city']['pot'] == 44
    assert len(state['vaults']['city']['history']) == 1
    assert 'combo' not in state['vaults']['city']           # never leaks


def test_legacy_spore_species_normalizes_to_zombie(table):
    """Saves written before the spore->zombie rename must still load."""
    act(table, 'join', starter='zombie')
    sid, _ = db._active_season(table)
    key = (db._season_pk(sid), 'PLAYER#user-alex')
    table.items[key]['species'] = 'spore'
    table.items[key]['form'] = 'spore'
    doc = db._get_player(table, sid, 'user-alex')
    assert doc['species'] == 'zombie'
    assert doc['form'] == 'zombie'


# ── Combat wiring (Plan 2) ───────────────────────────────────────────────────

def test_combatant_carries_riders_and_buffs_from_gear(table):
    act(table, 'join', starter='saproling')
    sid = _sid(table)
    doc = db._get_player(table, sid, 'user-alex')
    doc['gear'] = {'fang': 'kraul_barb', 'charm': 'glint_charm'}
    doc['buffs'] = [{'kind': 'harden_shell'}]
    c = db._combatant(doc)
    assert 'deep_biter' in c.riders and 'glint' in c.riders
    assert 'harden_shell' in c.buffs


def test_buy_charm_equips_into_charm_slot(table):
    sid, node = _at_shop(table, spores=500)
    _seed_shop(table, sid, node, gear=[{'item': 'quartz_charm', 'qty': 2}])
    status, resp = act(table, 'buy', itemId='quartz_charm')
    assert status == 200, resp
    doc = db._get_player(table, sid, 'user-alex')
    assert doc['gear'].get('charm') == 'quartz_charm'


def test_battle_combatant_roundtrips_through_dict(table):
    c = db.engine.Combatant(name='X', hp=25, max_hp=40, atk=8, dfn=5, spd=6,
                            passives=frozenset({'swarm'}), riders=frozenset({'barbed'}),
                            buffs=frozenset({'rot_surge'}))
    c.rot_stacks = 2; c.first_win_used = True; c.dmg_penalty = 1
    snap = db._bt_snapshot(c)
    assert isinstance(snap['passives'], list) and snap['hp'] == 25
    c2 = db._bt_to_combatant(snap)
    assert c2.hp == 25 and c2.rot_stacks == 2 and c2.first_win_used
    assert 'barbed' in c2.riders and 'rot_surge' in c2.buffs and 'swarm' in c2.passives


class _ZeroRng:
    """Deterministic rng for read tests: random()=0 → the read always procs and
    the (bluffable) telegraph shows the true stance."""
    def random(self):
        return 0.0
    def randint(self, a, b):
        return a
    def choice(self, seq):
        return seq[0]
    def uniform(self, a, b):
        return 1.0


def test_start_battle_persists_record_with_first_telegraph(table, monkeypatch):
    monkeypatch.setattr(db, '_rng', _ZeroRng())   # force a read this round
    act(table, 'join', starter='kraul')
    sid = _sid(table)
    doc = db._get_player(table, sid, 'user-alex')
    npc = {'id': 'drudge_beetle', 'name': 'Drudge Beetle', 'hp': 16, 'atk': 4,
           'def': 1, 'spd': 4, 'bounty': 6, 'xp': 10, 'itemChance': 0.0,
           'personality': 'brute', 'bluff': 0.0}
    ev = db._start_battle(table, sid, doc, 'wild', npc, node=doc['position'])
    assert ev['type'] == 'battle_start'
    rec = doc['battle']
    assert rec['kind'] == 'wild' and rec['round'] == 1
    assert rec['npcShown'] in data.STANCES and rec['npcActual'] in data.STANCES
    assert ev['telegraph'] == rec['npcShown']
    assert rec['player']['hp'] == doc['hp']


# ── Interactive combat flow (Plan 2) ─────────────────────────────────────────

_FODDER = {'id': 'drudge_beetle', 'name': 'Drudge Beetle', 'hp': 30, 'atk': 3,
           'def': 0, 'spd': 1, 'bounty': 6, 'xp': 10, 'itemChance': 0.0,
           'personality': 'brute', 'bluff': 0.0}


def _begin(table, sid, kind='wild', npc=None, ctx=None, user='user-alex'):
    doc = db._get_player(table, sid, user)
    ev = db._start_battle(table, sid, doc, kind, dict(npc or _FODDER),
                          node=doc.get('position'), ctx=ctx)
    db._put_player(table, doc)
    return ev


def test_wild_battle_start_then_round_continues(table, monkeypatch):
    monkeypatch.setattr(db, '_rng', _ZeroRng())   # force reads so telegraph shows
    act(table, 'join', starter='kraul')
    sid = _sid(table)
    ev = _begin(table, sid)
    assert ev['type'] == 'battle_start' and ev['telegraph'] in data.STANCES
    monkeypatch.setattr(db.engine, 'resolve_round', lambda *a, **k: [])  # nobody dies
    status, resp = act(table, 'combat-round', stance='aggress')
    assert status == 200
    assert resp['combat']['round'] == 2 and resp['combat']['telegraph'] in data.STANCES


def test_battle_blocks_roll_and_move(table):
    act(table, 'join', starter='pest')
    sid = _sid(table)
    _begin(table, sid)
    status, _ = act(table, 'roll')
    assert status == 409
    status, _ = act(table, 'move', to='anywhere')
    assert status == 409


def test_combat_peek_reveals_true_intent_and_spends_item(table):
    act(table, 'join', starter='pest')
    sid = _sid(table)
    doc = db._get_player(table, sid, 'user-alex')
    doc['bag'] = ['scrying_spore']
    db._put_player(table, doc)
    _begin(table, sid)
    status, resp = act(table, 'combat-peek')
    assert status == 200
    fresh = db._get_player(table, sid, 'user-alex')
    assert resp['peek']['trueIntent'] == fresh['battle']['npcActual']
    assert 'scrying_spore' not in fresh['bag']


def test_combat_flee_escapes_and_clears_battle(table, monkeypatch):
    act(table, 'join', starter='pest')
    sid = _sid(table)
    doc = db._get_player(table, sid, 'user-alex')
    doc['spd'] = 20
    db._put_player(table, doc)
    _begin(table, sid)
    monkeypatch.setattr(db.engine, 'resolve_round', lambda *a, **k: [])
    act(table, 'combat-round', stance='guard')             # must act before fleeing
    monkeypatch.setattr(db._rng, 'random', lambda: 0.01)   # flee succeeds
    status, resp = act(table, 'combat-flee')
    assert status == 200 and resp['combat']['fled'] is True
    assert db._get_player(table, sid, 'user-alex').get('battle') is None


def test_combat_consumable_auto_win(table, monkeypatch):
    act(table, 'join', starter='pest')
    sid = _sid(table)
    doc = db._get_player(table, sid, 'user-alex')
    doc['bag'] = ['ambush_musk']
    db._put_player(table, doc)
    # a beefy foe the player could not out-trade normally
    _begin(table, sid, npc=dict(_FODDER, hp=4, atk=1))
    status, resp = act(table, 'combat-round', stance='guard', item='ambush_musk')
    assert status == 200
    fresh = db._get_player(table, sid, 'user-alex')
    assert 'ambush_musk' not in (fresh.get('bag') or [])   # item consumed


def test_all_battle_specs_have_valid_personality():
    specs = list(data.NPCS) + list(data.ELITE_NPCS) + list(data.DUNGEON_NPCS.values()) \
        + list(data.BARRIER_GUARDIANS.values()) + list(data.LAIR_BOSSES.values()) \
        + [data.ROT_SOVEREIGN]
    for s in specs:
        p = s.get('personality', data.NPC_DEFAULT_PERSONALITY)
        assert p in data.STANCE_PERSONALITIES, s.get('name')
        assert 0.0 <= s.get('bluff', data.NPC_DEFAULT_BLUFF) <= 1.0


def test_balance_good_play_beats_fodder(monkeypatch):
    """Perfect reads (counter every non-bluffing tell) should reliably compost
    tier-appropriate fodder — the floor that guards balance tuning."""
    import random
    fodder = data.NPCS[0]            # Drudge Beetle, brute, bluff 0
    wins = 0
    for seed in range(20):
        t = FakeTable()
        act(t, 'season-start', hostKey='swampking')
        monkeypatch.setattr(db, '_rng', random.Random(seed))
        act(t, 'join', starter='kraul')
        sid = _sid(t)
        doc = db._get_player(t, sid, 'user-alex')
        db._start_battle(t, sid, doc, 'wild', dict(fodder), node=doc.get('position'))
        db._put_player(t, doc)
        outcome = None
        for _ in range(data.MAX_ROUNDS_COMBAT):
            shown = db._get_player(t, sid, 'user-alex')['battle']['npcShown']
            status, resp = act(t, 'combat-round', stance=_COUNTER[shown])
            assert status == 200, resp
            if 'spaceEvent' in resp:
                outcome = resp['spaceEvent']['battle']['outcome']
                break
        wins += 1 if outcome == 'attacker' else 0
    assert wins >= 18, f'only {wins}/20 wins with perfect play'


def test_started_battle_persists_without_floats(table):
    """Regression: doc['battle'] must contain no Python float — real DynamoDB
    rejects float (needs Decimal). A wild start persists bluff/itemChance, which
    _put_player must convert to Decimal (else a 500 on every combat landing)."""
    from decimal import Decimal
    act(table, 'join', starter='pest')
    sid = _sid(table)
    doc = db._get_player(table, sid, 'user-alex')
    db._start_battle(table, sid, doc, 'wild', dict(_FODDER, bluff=0.15), node=doc.get('position'))
    assert db._put_player(table, doc) is True   # would raise TypeError pre-fix
    stored = table.items[(db._season_pk(sid), 'PLAYER#user-alex')]['battle']

    def has_float(o):
        if isinstance(o, bool):
            return False
        if isinstance(o, float):
            return True
        if isinstance(o, dict):
            return any(has_float(v) for v in o.values())
        if isinstance(o, list):
            return any(has_float(v) for v in o)
        return False

    assert not has_float(stored)
    # bluff survives the round-trip as a usable number for the telegraph.
    assert isinstance(stored['npc']['bluff'], Decimal)


def test_state_exposes_sanitized_battle_resume(table, monkeypatch):
    """A refreshed player must be able to reopen a pending fight — and must NOT
    receive npcActual (the hidden intent) in either `you` or the resume."""
    monkeypatch.setattr(db, '_rng', _ZeroRng())   # force a read so telegraph shows
    act(table, 'join', starter='kraul')
    sid = _sid(table)
    doc = db._get_player(table, sid, 'user-alex')
    db._start_battle(table, sid, doc, 'wild', dict(_FODDER, bluff=0.0), node=doc.get('position'))
    db._put_player(table, doc)

    status, state = db.handle_state(table, {'userId': 'user-alex'})
    assert status == 200
    assert 'battle' not in state['you']                     # raw record stripped
    b = state['battle']
    assert b and b['kind'] == 'wild' and b['telegraph'] in data.STANCES
    assert b['npc']['name'] == _FODDER['name']
    assert b['playerHp'] == state['you']['hp']
    assert 'npcActual' not in b and b['revealed'] is None    # no leak, not scried


def test_state_battle_resume_reveals_only_after_scry(table):
    act(table, 'join', starter='kraul')
    sid = _sid(table)
    doc = db._get_player(table, sid, 'user-alex')
    doc['bag'] = ['scrying_spore']
    db._start_battle(table, sid, doc, 'wild', dict(_FODDER, bluff=0.5), node=doc.get('position'))
    db._put_player(table, doc)
    act(table, 'combat-peek')                                # scry this round
    _, state = db.handle_state(table, {'userId': 'user-alex'})
    true_intent = db._get_player(table, sid, 'user-alex')['battle']['npcActual']
    assert state['battle']['revealed'] == true_intent        # scried => shown


class _HiRng:
    """random()=0.99 → a read never procs at ordinary chances."""
    def random(self):
        return 0.99
    def randint(self, a, b):
        return a
    def choice(self, seq):
        return seq[0]
    def uniform(self, a, b):
        return 1.0


def test_no_read_hides_the_telegraph(table, monkeypatch):
    monkeypatch.setattr(db, '_rng', _HiRng())
    act(table, 'join', starter='saproling')       # slow, no reader passive
    sid = _sid(table)
    doc = db._get_player(table, sid, 'user-alex')
    ev = db._start_battle(table, sid, doc, 'wild', dict(_FODDER), node=doc.get('position'))
    assert ev['telegraph'] is None                # no read → nothing predicted
    assert doc['battle']['npcActual'] in data.STANCES  # still tracked server-side


def test_reveal_next_forces_a_true_read(monkeypatch):
    monkeypatch.setattr(db, '_rng', _HiRng())     # base read would NOT proc
    rec = {'npc': {'personality': 'brute', 'bluff': 0.0},
           'player': {'reveal_next': True}, 'readChance': 0.0}
    shown = db._telegraph_next(rec)
    assert rec['read'] is True and rec['readTrue'] is True
    assert shown == rec['npcActual']              # true intent, not a bluff
    assert rec['player']['reveal_next'] is False  # consumed


def test_read_chance_rises_with_reader_passive_and_gear():
    base = {'level': 1, 'hp': 30, 'maxHp': 30, 'atk': 6, 'def': 5, 'spd': 5,
            'passives': [], 'gear': {}, 'buffs': []}
    plain = db._read_chance(dict(base))
    assert abs(plain - (data.READ_BASE + data.READ_SPD_COEFF * 5)) < 1e-9
    assert db._read_chance(dict(base, passives=['first_bite'])) > plain
    assert db._read_chance(dict(base, gear={'charm': 'seer_charm'})) > plain
    assert db._read_chance(dict(base, gear={'charm': 'glint_charm'})) > plain


# ── Rot-Farm Bazaar: rotating limited stock ──────────────────────────────────

def test_shop_window_math():
    base = datetime(2026, 7, 15, 12, 0, 0)
    w = db._shop_window(base)
    # Same 30-min window a few minutes later; next window after the boundary.
    assert db._shop_window(base + timedelta(minutes=5)) == w
    assert db._shop_window(base + timedelta(minutes=31)) == w + 1
    # The window-end ISO is strictly after the window's own start instant.
    assert db._shop_window_end(w) > base.isoformat(timespec='seconds')


def test_gen_shop_stock_shape_and_determinism():
    node = next(n for n, v in data.MAP_NODES.items() if v['type'] == 'shop')
    stock = db._gen_shop_stock(node, 100)

    # Gear: SHOP_GEAR_SLOTS lines, all valid, spread across distinct slots.
    assert len(stock['gear']) == data.SHOP_GEAR_SLOTS
    slots = [data.GEAR[e['item']]['slot'] for e in stock['gear']]
    assert len(set(slots)) == len(slots)
    assert all(e['qty'] == data.SHOP_GEAR_QTY for e in stock['gear'])

    # Consumables: SHOP_CONSUMABLE_SLOTS distinct lines, >=1 in-battle ('combat').
    assert len(stock['consumables']) == data.SHOP_CONSUMABLE_SLOTS
    cids = [e['item'] for e in stock['consumables']]
    assert len(set(cids)) == len(cids)
    assert any(data.CONSUMABLES[cid].get('combat') for cid in cids)
    assert all(e['qty'] == data.SHOP_CONSUMABLE_QTY for e in stock['consumables'])

    # Grimoires: SHOP_GRIMOIRE_SLOTS distinct tier-1 ids, no qty.
    assert len(stock['grimoires']) == data.SHOP_GRIMOIRE_SLOTS
    assert len(set(stock['grimoires'])) == len(stock['grimoires'])
    assert all(data.GRIMOIRES[g]['tier'] == 1 for g in stock['grimoires'])

    # Deterministic per (node, window); a different window always differs (window field).
    assert db._gen_shop_stock(node, 100) == stock
    assert db._gen_shop_stock(node, 101) != stock
    assert stock['window'] == 100


def test_shop_stock_reads_current_regenerates_stale(table):
    sid = _sid(table)
    node = next(n for n, v in data.MAP_NODES.items() if v['type'] == 'shop')
    window = db._shop_window()

    # No record yet -> fresh full-quantity stock for the current window.
    fresh = db._shop_stock(table, sid, node)
    assert fresh['window'] == window
    assert fresh['gear'][0]['qty'] == data.SHOP_GEAR_QTY

    # A persisted record for the CURRENT window is returned verbatim (depleted).
    depleted = db._gen_shop_stock(node, window)
    depleted['gear'][0]['qty'] = 0
    table.put_item(Item={'pk': db._season_pk(sid), 'sk': f'SHOP#{node}', **depleted})
    got = db._shop_stock(table, sid, node)
    assert got['gear'][0]['qty'] == 0

    # A persisted record from a STALE window is ignored -> regenerated full.
    stale = db._gen_shop_stock(node, window - 5)
    stale['gear'][0]['qty'] = 0
    table.put_item(Item={'pk': db._season_pk(sid), 'sk': f'SHOP#{node}', **stale})
    got = db._shop_stock(table, sid, node)
    assert got['window'] == window
    assert got['gear'][0]['qty'] == data.SHOP_GEAR_QTY


def test_state_surfaces_bazaars(table):
    act(table, 'join', starter='pest')
    sid = _sid(table)
    _, state = db.handle_state(table, {'userId': 'user-alex'})

    shop_nodes = [n for n, v in data.MAP_NODES.items() if v['type'] == 'shop']
    assert set(state['bazaars']) == set(shop_nodes)      # one view per shop node
    view = state['bazaars'][shop_nodes[0]]
    assert len(view['gear']) == data.SHOP_GEAR_SLOTS
    assert len(view['consumables']) == data.SHOP_CONSUMABLE_SLOTS
    assert len(view['grimoires']) == data.SHOP_GRIMOIRE_SLOTS
    assert view['refreshesAt'] == db._shop_window_end(db._shop_window())

    # A depleted persisted record is reflected in the view.
    node = shop_nodes[0]
    depleted = db._gen_shop_stock(node, db._shop_window())
    depleted['consumables'][0]['qty'] = 0
    table.put_item(Item={'pk': db._season_pk(sid), 'sk': f'SHOP#{node}', **depleted})
    _, state = db.handle_state(table, {'userId': 'user-alex'})
    assert state['bazaars'][node]['consumables'][0]['qty'] == 0


def test_cannot_flee_before_acting(table, monkeypatch):
    act(table, 'join', starter='pest')
    sid = _sid(table)
    doc = db._get_player(table, sid, 'user-alex')
    doc['spd'] = 20
    db._put_player(table, doc)
    _begin(table, sid)                                  # round 1, no action yet
    status, resp = act(table, 'combat-flee')
    assert status == 409 and 'move' in resp['error'].lower()
    # after one resolved round, fleeing is allowed
    monkeypatch.setattr(db.engine, 'resolve_round', lambda *a, **k: [])
    act(table, 'combat-round', stance='guard')          # round advances to 2
    monkeypatch.setattr(db._rng, 'random', lambda: 0.01)  # flee succeeds
    status, resp = act(table, 'combat-flee')
    assert status == 200 and resp['combat']['fled'] is True


def test_get_active_season_public_wrapper():
    t = FakeTable()
    assert db.get_active_season(t) == (None, None)

    act(t, 'season-start', hostKey='swampking')
    sid, config = db.get_active_season(t)
    assert sid is not None
    assert config['status'] == 'active'
    assert config['hostKey'] == 'swampking'


# ── Roll regen & debug reporting ─────────────────────────────────────────────

def test_roll_regen_grants_via_action_path(table, monkeypatch):
    monkeypatch.setattr(data, 'DEBUG', False)
    act(table, 'join', starter='pest')
    sid = _sid(table)
    doc = db._get_player(table, sid, 'user-alex')
    doc['rolls'] = 0
    doc['rollRegenAt'] = '2020-01-01T00:00:00'      # ages ago -> regen to cap
    db._put_player(table, doc)
    status, resp = act(table, 'roll')               # would 409 without regen
    assert status == 200
    assert resp['you']['rolls'] == data.ROLL_CAP - 1


def test_state_reports_debug_and_next_roll(table, monkeypatch):
    monkeypatch.setattr(data, 'DEBUG', False)
    act(table, 'join', starter='pest')              # 3+1 seal rolls < cap of 6
    status, state = db.handle_state(table, {'userId': 'user-alex'})
    assert status == 200
    assert state['you']['debug'] is False
    assert state['you']['nextRollAt'] > state['you']['rollRegenAt']


def test_next_roll_hidden_at_cap(table, monkeypatch):
    monkeypatch.setattr(data, 'DEBUG', False)
    act(table, 'join', starter='pest')
    sid = _sid(table)
    doc = db._get_player(table, sid, 'user-alex')
    doc['rolls'] = data.ROLL_CAP
    db._put_player(table, doc)
    status, state = db.handle_state(table, {'userId': 'user-alex'})
    assert 'nextRollAt' not in state['you']


def test_action_response_carries_debug_flag(table, monkeypatch):
    monkeypatch.setattr(data, 'DEBUG', True)
    status, resp = act(table, 'join', starter='pest')
    assert status == 200
    assert resp['you']['debug'] is True
