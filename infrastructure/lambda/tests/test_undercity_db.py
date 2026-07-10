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


def test_full_join_roll_move_flow(table, monkeypatch):
    monkeypatch.setattr(data, 'UNLIMITED_ROLLS', False)  # assert the real roll economy
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


def test_wild_win_surfaces_rewards(table, monkeypatch):
    # The victory popup depends on the win event carrying spores + xp (+ levels).
    act(table, 'join', starter='pest')
    sid, _ = db._active_season(table)
    doc = db._get_player(table, sid, 'user-alex')
    monkeypatch.setattr(db.engine, 'resolve_battle', lambda *a, **k: {
        'outcome': 'attacker', 'strikes': [], 'attackerHp': doc['hp'],
        'defenderHp': 0, 'smokeSporeUsed': False,
    })
    out = db._wild_battle(table, sid, doc)
    assert out['type'] == 'wild'
    assert out['spores'] >= 1                       # bounty
    assert out['xp'] == data.XP_REWARDS['wild_win']  # surfaced for the popup
    assert 'levels' not in out                       # 15 xp < first level-up cost


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


def test_buy_gear_and_consumables(table):
    act(table, 'join', starter='pest')
    sid = _sid(table)
    doc = db._get_player(table, sid, 'user-alex')
    doc['position'] = 'bog_r3'  # a Rot-Farm Bazaar (every shop stocks all tiers)
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
    assert data.MAP_NODES['bone_r1']['type'] == 'excavation'  # Ossuary Fields digs


def test_excavation_dig_reveals_and_collects(table):
    act(table, 'join', starter='pest')
    sid = _sid(table)
    # A single 1x2 relic so clearing it also exercises the reset + bonus.
    site = {'w': 5, 'h': 5, 'revealed': [],
            'items': [{'shape': '1x2', 'cells': [[0, 0], [0, 1]],
                       'loot': {'kind': 'item', 'item': 'healing_moss'},
                       'collected': False, 'by': None}]}
    doc = db._get_player(table, sid, 'user-alex')
    doc['position'] = 'bone_r1'
    doc['excavationDigsLeft'] = data.EXCAVATION_DIGS_PER_VISIT
    doc['bag'] = []
    db._put_player(table, doc)
    db._save_dig_site(table, sid, 'bone_r1', site)

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
    doc['position'] = 'bone_r1'
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
    assert gates == {'cavern_r0', 'bog_r0'}
    db._put_player(table, doc)

    status, resp = act(table, 'respawn', gate='bog_r0')
    assert status == 200
    assert resp['you']['position'] == 'bog_r0'
    assert 'pendingRespawn' not in resp['you']

    status, _ = act(table, 'respawn', gate='bog_r0')
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
    assert status == 200  # default paints: forest(130) + gold(50)
    status, resp = act(table, 'customize', paint={'body': 270})
    assert status == 409  # violet not owned


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
    monkeypatch.setattr(db.engine, 'resolve_battle', lambda *a, **k: {
        'outcome': 'attacker', 'strikes': [], 'attackerHp': doc['hp'],
        'defenderHp': 0, 'smokeSporeUsed': False,
    })
    out = db._wild_battle(table, sid, doc)
    assert out['npc']['id'] == 'broodling'
    assert out['spores'] >= data.DUNGEON_NPCS['city']['bounty']


def test_bone_chill_consumed_by_next_battle(table, monkeypatch):
    sid, doc = _player_at(table, 'city_r1', buffs=[{'kind': 'bone_chill'}])
    monkeypatch.setattr(db.engine, 'resolve_battle', lambda *a, **k: {
        'outcome': 'attacker', 'strikes': [], 'attackerHp': doc['hp'],
        'defenderHp': 0, 'smokeSporeUsed': False,
    })
    db._wild_battle(table, sid, doc)
    assert not any(b.get('kind') == 'bone_chill' for b in doc.get('buffs', []))


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
