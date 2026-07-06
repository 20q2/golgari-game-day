"""Integration tests for the action dispatcher against an in-memory table."""
import json
import sys
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parents[1]))

import pytest
from botocore.exceptions import ClientError

import undercity_data as data
import undercity_db as db


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
        self.items[key] = json.loads(json.dumps(Item))
        return {}

    def get_item(self, Key):
        item = self.items.get(self._key(Key))
        return {'Item': json.loads(json.dumps(item))} if item else {}

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
        return {'Items': json.loads(json.dumps(out))}


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


def test_full_join_roll_move_flow(table):
    status, resp = act(table, 'join', starter='saproling')
    assert status == 200
    you = resp['you']
    assert you['hp'] == 38 and you['position'] == 'n0' and you['rolls'] == 3
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


def test_join_is_idempotent_and_seal_rolls(table):
    act(table, 'join', starter='pest')
    status, resp = act(table, 'join', starter='kraul')
    assert status == 200
    assert resp['you']['species'] == 'pest'  # second join ignored

    # A veteran with 2 seals starts with +2 rolls.
    perm = db._get_perm(table, 'user-vet')
    perm['seals'] = 2
    table.put_item(Item=perm)
    status, resp = act(table, 'join', user='user-vet', name='Vet', starter='spore')
    assert resp['you']['rolls'] == 5


def test_move_requires_matching_pending(table):
    act(table, 'join', starter='pest')
    status, resp = act(table, 'move', to='n3')
    assert status == 409
    act(table, 'roll')
    status, resp = act(table, 'move', to='not-a-node')
    assert status == 409


def test_claims_and_cooldowns(table):
    act(table, 'join', starter='pest')
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
    act(table, 'join', starter='pest')
    status, resp = act(table, 'claim', kind='finished_won')  # 3 + 3 = 6 (cap)
    assert resp['you']['rolls'] == 6
    assert resp['granted'] == 3 and resp['lostToCap'] == 0


def test_pvp_battle_and_compost(table):
    act(table, 'join', starter='kraul')
    act(table, 'join', user='user-sam', name='Sam', starter='saproling')
    # Put both on the same node and make Sam nearly dead.
    alex = db._get_player(table, _sid(table), 'user-alex')
    sam = db._get_player(table, _sid(table), 'user-sam')
    alex['position'] = sam['position'] = 'n5'
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
    assert sam['position'] == 'n0'           # composted → gate
    assert sam['shieldUntil'] > db._now()    # compost shield
    assert sam['spores'] == 75

    # Shielded player can't be attacked again.
    alex = db._get_player(table, _sid(table), 'user-alex')
    alex['position'] = 'n0'
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


def test_buy_gear_and_consumables(table):
    act(table, 'join', starter='pest')
    sid = _sid(table)
    doc = db._get_player(table, sid, 'user-alex')
    doc['position'] = 'a2'  # tier-3 bazaar
    doc['spores'] = 200
    db._put_player(table, doc)

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
    act(table, 'join', user='user-sam', name='Sam', starter='spore')
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
    act(table, 'join', user='user-sam', name='Sam', starter='spore')
    sid = _sid(table)
    alex = db._get_player(table, sid, 'user-alex')
    alex['bag'] = ['snare']
    alex['position'] = 'n13'  # loot space
    db._put_player(table, alex)
    status, resp = act(table, 'use-item', item='snare')
    assert status == 200

    sam = db._get_player(table, sid, 'user-sam')
    sam['spores'] = 100
    db._put_player(table, sam)
    event = db._resolve_space(table, sid, sam, 'n13', 'n12')
    assert event['type'] == 'snare'
    assert sam['spores'] == 90  # spilled 20, grabbed 10 back
    pile = db._get(table, db._season_pk(sid), 'SPACE#n13')
    assert pile['pile'] == 10 and not pile.get('ownerId')


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


def _sid(table):
    return db._get(table, db.META_PK, 'CURRENT')['seasonId']
