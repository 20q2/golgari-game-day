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
import undercity_engine as engine


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

    def delete_item(self, Key, ConditionExpression=None):
        key = self._key(Key)
        if ConditionExpression == 'attribute_exists(sk)' and key not in self.items:
            raise ClientError({'Error': {'Code': 'ConditionalCheckFailedException'}}, 'DeleteItem')
        self.items.pop(key, None)
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


def _finish_started_battle(table, monkeypatch, doc, outcome='attacker',
                           defender_hp=0, user='user-alex', name='Alex'):
    """Given a doc with a freshly started battle, persist it, stub resolve_round
    to reach `outcome` in one exchange, submit one combat-round, and return its
    spaceEvent. `outcome='attacker'` slays the foe; anything else is a player
    death that leaves the foe lingering at `defender_hp` (sudden death — a
    non-kill only ever happens because the player fell)."""
    def _stub(att, dfn, *a, **k):
        if outcome == 'attacker':
            dfn.hp = 0
            return [{'round': 1, 'by': 'attacker', 'dmg': 99, 'winner': 'attacker'}]
        att.hp = 0
        dfn.hp = defender_hp
        return [{'round': 1, 'by': 'defender', 'dmg': 99, 'winner': 'defender'}]
    monkeypatch.setattr(db.engine, 'resolve_round', _stub)
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


def test_wilderness_wild_space_uses_wilderness_pool(table):
    act(table, 'join', starter='pest')
    sid = _sid(table)
    doc = db._get_player(table, sid, 'user-alex')
    ids = {n['id'] for n in data.WILDERNESS_NPCS}
    ev = db._wild_battle(table, sid, doc, elite=False, region='wilderness')
    assert ev['type'] == 'battle_start'
    assert ev['npc']['id'] in ids


def test_wilderness_elite_space_uses_wilderness_elite_pool(table):
    act(table, 'join', starter='pest')
    sid = _sid(table)
    doc = db._get_player(table, sid, 'user-alex')
    ids = {n['id'] for n in data.WILDERNESS_ELITE_NPCS}
    ev = db._wild_battle(table, sid, doc, elite=True, region='wilderness')
    assert ev['npc']['id'] in ids


def test_non_wilderness_battle_still_uses_base_pools(table):
    act(table, 'join', starter='pest')
    sid = _sid(table)
    doc = db._get_player(table, sid, 'user-alex')
    doc['position'] = 'cavern_r2'  # a surface, non-dungeon, non-wilderness node
    ev = db._wild_battle(table, sid, doc, elite=False, region='cavern')
    assert ev['npc']['id'] in {n['id'] for n in data.NPCS}


def test_wilderness_monsters_are_tougher_than_base_elites(table):
    base_max_hp = max(n['hp'] for n in data.ELITE_NPCS)
    assert min(n['hp'] for n in data.WILDERNESS_NPCS) > max(n['hp'] for n in data.NPCS)
    assert min(n['hp'] for n in data.WILDERNESS_ELITE_NPCS) >= base_max_hp


def test_tier1_tunnel_landing_hops_across_for_free(table):
    act(table, 'join', starter='pest')
    sid = _sid(table)
    doc = db._get_player(table, sid, 'user-alex')
    doc['tier'] = 1
    doc['position'] = 't_cavern_bog0'
    doc['spores'] = 50
    before_hp = doc['hp']
    ev = db._resolve_space(table, sid, doc, 't_cavern_bog0', 'cavern_r9')
    assert ev['type'] == 'tunnel'
    assert ev['to'] == data.TUNNEL_EXITS['t_cavern_bog0']  # 'bog_r1'
    assert doc['position'] == data.TUNNEL_EXITS['t_cavern_bog0']
    assert doc['spores'] == 50           # T1 pays no toll
    assert doc['hp'] == before_hp        # consequence-free: no battle
    assert doc.get('pendingLoot') is None


def test_tier2_tunnel_landing_charges_the_toll(table):
    act(table, 'join', starter='pest')
    sid = _sid(table)
    doc = db._get_player(table, sid, 'user-alex')
    doc['tier'] = 2
    doc['position'] = 't_cavern_bog0'
    doc['spores'] = 50
    ev = db._resolve_space(table, sid, doc, 't_cavern_bog0', 'cavern_r9')
    assert ev['type'] == 'tunnel'
    assert ev['toll'] == data.TUNNEL_TOLL[2]
    assert doc['spores'] == 50 - data.TUNNEL_TOLL[2]
    assert doc['position'] == data.TUNNEL_EXITS['t_cavern_bog0']


def test_tier1_can_cross_a_tunnel(table):
    act(table, 'join', starter='pest')
    sid = _sid(table)
    doc = db._get_player(table, sid, 'user-alex')
    doc['tier'] = 1
    doc['position'] = 'cavern_r2'
    dests = engine.legal_destinations(
        data.MAP_NODES, doc['position'], 1,
        db._closed_barriers(table, sid), db._blocked_nodes(doc))
    assert 't_bone_cavern1' in dests


def test_broke_tier2_is_blocked_from_tunnels(table):
    act(table, 'join', starter='pest')
    sid = _sid(table)
    doc = db._get_player(table, sid, 'user-alex')
    doc['tier'] = 2
    doc['spores'] = data.TUNNEL_TOLL[2] - 1   # can't afford the toll
    doc['position'] = 'cavern_r2'
    # No sigils claimed yet, so the per-player escape ladders are blocked too.
    assert db._blocked_nodes(doc) == data.TUNNEL_NODES | set(data.ESCAPE_LADDERS)
    dests = engine.legal_destinations(
        data.MAP_NODES, doc['position'], 1,
        db._closed_barriers(table, sid), db._blocked_nodes(doc))
    assert 't_bone_cavern1' not in dests
    # ...and cannot route THROUGH it to the far side in two hops.
    dests2 = engine.legal_destinations(
        data.MAP_NODES, doc['position'], 2,
        db._closed_barriers(table, sid), db._blocked_nodes(doc))
    assert 't_bone_cavern0' not in dests2


def test_funded_tier2_may_enter_a_tunnel(table):
    act(table, 'join', starter='pest')
    sid = _sid(table)
    doc = db._get_player(table, sid, 'user-alex')
    doc['tier'] = 2
    doc['spores'] = data.TUNNEL_TOLL[2]       # exactly affordable
    doc['position'] = 'cavern_r2'
    # Tunnels are open (toll paid); only the unclaimed escape ladders remain blocked.
    assert db._blocked_nodes(doc) == frozenset(data.ESCAPE_LADDERS)
    dests = engine.legal_destinations(
        data.MAP_NODES, doc['position'], 1,
        db._closed_barriers(table, sid), db._blocked_nodes(doc))
    assert 't_bone_cavern1' in dests


def test_tier2_standing_on_a_tunnel_can_still_leave(table):
    act(table, 'join', starter='pest')
    sid = _sid(table)
    doc = db._get_player(table, sid, 'user-alex')
    doc['tier'] = 2
    doc['position'] = 't_bone_cavern1'   # evolved while mid-tunnel
    dests = engine.legal_destinations(
        data.MAP_NODES, doc['position'], 1,
        db._closed_barriers(table, sid), db._blocked_nodes(doc))
    assert 'cavern_r2' in dests


def test_tier3_is_too_large_for_bridges(table):
    act(table, 'join', starter='pest')
    sid = _sid(table)
    doc = db._get_player(table, sid, 'user-alex')
    doc['tier'] = 3
    doc['spores'] = 9999          # can trivially afford any toll — irrelevant
    # Every bridge node is blocked outright for an apex unit.
    assert data.TUNNEL_NODES <= db._blocked_nodes(doc)
    doc['position'] = 'cavern_r2'
    dests = engine.legal_destinations(
        data.MAP_NODES, doc['position'], 1,
        db._closed_barriers(table, sid), db._blocked_nodes(doc))
    assert 't_bone_cavern1' not in dests


def test_funded_tier2_stops_on_a_bridge_not_through_it(table):
    act(table, 'join', starter='pest')
    sid = _sid(table)
    doc = db._get_player(table, sid, 'user-alex')
    doc['tier'] = 2
    doc['spores'] = data.TUNNEL_TOLL[2]      # funded, so allowed onto bridges
    doc['position'] = 'cavern_r2'
    closed = db._stop_nodes(table, sid, doc)
    blocked = db._blocked_nodes(doc)
    # The near mouth is a valid STOP with a 1-roll...
    assert 't_bone_cavern1' in engine.legal_destinations(
        data.MAP_NODES, doc['position'], 1, closed, blocked)
    # ...but a 2-roll cannot corridor THROUGH it to its paired mouth.
    assert 't_bone_cavern0' not in engine.legal_destinations(
        data.MAP_NODES, doc['position'], 2, closed, blocked)


def test_tier1_passes_through_a_bridge_freely(table):
    act(table, 'join', starter='pest')
    sid = _sid(table)
    doc = db._get_player(table, sid, 'user-alex')
    doc['tier'] = 1
    doc['position'] = 'cavern_r2'
    closed = db._stop_nodes(table, sid, doc)   # Tier-1: bridges NOT added
    blocked = db._blocked_nodes(doc)
    # A 2-roll walks straight through the spur to the paired mouth.
    assert 't_bone_cavern0' in engine.legal_destinations(
        data.MAP_NODES, doc['position'], 2, closed, blocked)


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


def test_join_is_idempotent_and_veteran_egg_color(table):
    act(table, 'join', starter='pest')
    status, resp = act(table, 'join', starter='kraul')
    assert status == 200
    assert resp['you']['species'] == 'pest'  # second join ignored

    # Everyone starts with the same JOIN_ROLLS — seals no longer grant rolls.
    assert resp['you']['rolls'] == data.JOIN_ROLLS

    # A non-veteran's egg-color pick is ignored (default body hue).
    status, resp = act(table, 'join', user='user-rookie', name='Rookie',
                       starter='zombie', eggHue=270)
    assert resp['you']['rolls'] == data.JOIN_ROLLS
    assert resp['you']['paint']['body'] == 130

    # A veteran (1+ seals) may pick their egg's shell color at the start.
    perm = db._get_perm(table, 'user-vet')
    perm['seals'] = 2
    table.put_item(Item=perm)
    status, resp = act(table, 'join', user='user-vet', name='Vet',
                       starter='zombie', eggHue=270)
    assert resp['you']['rolls'] == data.JOIN_ROLLS
    assert resp['you']['paint']['body'] == 270


def test_join_bravery_grants_bonus_roll(table):
    # Bravery join grants JOIN_ROLLS + BRAVERY_BONUS_ROLLS (capped at ROLL_CAP).
    status, resp = act(table, 'join', starter='kraul', bravery=True)
    assert status == 200
    expected = min(data.ROLL_CAP, data.JOIN_ROLLS + data.BRAVERY_BONUS_ROLLS)
    assert resp['you']['rolls'] == expected

    # A normal join still gets exactly JOIN_ROLLS — no bonus leaks in.
    status, resp = act(table, 'join', user='user-normal', name='Normal',
                       starter='pest')
    assert resp['you']['rolls'] == data.JOIN_ROLLS


def _rewind_night(table, minutes):
    """Backdate the running season's start so `minutes` have elapsed."""
    sid = _sid(table)
    cfg = db._get(table, db._season_pk(sid), 'CONFIG')
    cfg['startedAt'] = (datetime.utcnow()
                        - timedelta(minutes=minutes)).strftime('%Y-%m-%dT%H:%M:%S')
    table.put_item(Item=cfg)


def test_join_grants_rolls_for_time_since_night_started(table):
    # ~40 min into the night → one full regen tick on top of JOIN_ROLLS.
    _rewind_night(table, 40)
    _, resp = act(table, 'join', starter='pest')
    assert resp['you']['rolls'] == data.JOIN_ROLLS + data.ROLLS_PER_REGEN


def test_join_late_in_the_night_caps_at_roll_cap(table):
    # Hours in → the natural bank fills to the cap, not beyond.
    _rewind_night(table, 10 * 60)
    _, resp = act(table, 'join', starter='pest')
    assert resp['you']['rolls'] == data.ROLL_CAP


def test_join_at_night_start_still_gets_join_rolls(table):
    # No time elapsed → the baseline is unchanged.
    _, resp = act(table, 'join', starter='pest')
    assert resp['you']['rolls'] == data.JOIN_ROLLS


def test_move_requires_matching_pending(table):
    act(table, 'join', starter='pest')
    status, resp = act(table, 'move', to='n3')
    assert status == 409
    act(table, 'roll')
    status, resp = act(table, 'move', to='not-a-node')
    assert status == 409


# ── Gate pass-by heal (50%) vs landing (100%) ────────────────────────────────

def _prime_move(table, position, value, dests, hp=None):
    """Put user-alex at `position` with a hand-made pendingMove so a specific
    walk can be exercised deterministically."""
    sid = _sid(table)
    doc = db._get_player(table, sid, 'user-alex')
    doc['position'] = position
    doc['pendingMove'] = {'value': value, 'dests': list(dests)}
    if hp is not None:
        doc['hp'] = hp
    db._put_player(table, doc)
    return doc


def test_pass_through_gate_heals_half(table):
    act(table, 'join', starter='saproling', home='cavern')
    doc = _prime_move(table, 'city_r1', 2, ['city_r9'], hp=1)
    max_hp = engine.effective_stats(doc)['maxHp']
    status, resp = act(table, 'move', to='city_r9',
                       path=['city_r1', 'city_r0', 'city_r9'])
    assert status == 200, resp
    assert resp['heal'] == {'amount': round(0.5 * max_hp), 'hp': 1 + round(0.5 * max_hp),
                            'kind': 'gate_pass'}
    assert resp['you']['hp'] == 1 + round(0.5 * max_hp)


def test_pass_through_gate_caps_at_max(table):
    act(table, 'join', starter='saproling', home='cavern')
    doc = _prime_move(table, 'city_r1', 2, ['city_r9'])  # hp already full
    max_hp = engine.effective_stats(doc)['maxHp']
    status, resp = act(table, 'move', to='city_r9',
                       path=['city_r1', 'city_r0', 'city_r9'])
    assert status == 200, resp
    assert resp['heal'] is None            # already full → no heal, no number
    assert resp['you']['hp'] == max_hp


def test_landing_on_gate_heals_full(table):
    act(table, 'join', starter='saproling', home='cavern')
    doc = _prime_move(table, 'city_r1', 1, ['city_r0'], hp=1)
    max_hp = engine.effective_stats(doc)['maxHp']
    status, resp = act(table, 'move', to='city_r0', path=['city_r1', 'city_r0'])
    assert status == 200, resp
    assert resp['heal'] == {'amount': max_hp - 1, 'hp': max_hp, 'kind': 'gate_land'}
    assert resp['you']['hp'] == max_hp


def test_start_on_gate_does_not_heal(table):
    act(table, 'join', starter='saproling', home='cavern')
    _prime_move(table, 'city_r0', 1, ['city_r1'], hp=5)
    status, resp = act(table, 'move', to='city_r1', path=['city_r0', 'city_r1'])
    assert status == 200, resp
    assert resp['heal'] is None
    assert resp['you']['hp'] == 5


def test_illegal_path_rejected(table):
    act(table, 'join', starter='saproling', home='cavern')
    _prime_move(table, 'city_r1', 2, ['city_r9'], hp=1)
    # Non-adjacent jump city_r1 -> city_r9.
    status, resp = act(table, 'move', to='city_r9', path=['city_r1', 'city_r9'])
    assert status == 409, resp


def test_move_without_path_still_works(table):
    # Stale client that never sends `path`: destination-only behavior, no heal.
    act(table, 'join', starter='saproling', home='cavern')
    _prime_move(table, 'city_r1', 2, ['city_r9'], hp=1)
    status, resp = act(table, 'move', to='city_r9')
    assert status == 200, resp
    assert resp.get('heal') is None
    assert resp['you']['hp'] == 1        # no pass-heal without a path


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


def test_pvp_notifies_the_victim(table):
    """The loser gets a welcome-back note naming the attacker and the loot."""
    act(table, 'join', starter='kraul', home='cavern')
    act(table, 'join', user='user-sam', name='Sam', starter='saproling', home='cavern')
    alex = db._get_player(table, _sid(table), 'user-alex')
    sam = db._get_player(table, _sid(table), 'user-sam')
    alex['position'] = sam['position'] = 'city_r2'
    alex['atk'] = 50
    sam['hp'] = 5
    sam['spores'] = 100
    db._put_player(table, alex)
    db._put_player(table, sam)

    act(table, 'battle', targetUserId='user-sam')

    sam = db._get_player(table, _sid(table), 'user-sam')
    note = sam['awayEvents'][-1]
    assert note['kind'] == 'pvp'
    assert note['outcome'] == 'composted'
    assert note['from'] == 'Alex'
    assert note['spores'] == 25
    # The attacker isn't spammed with a note about their own assault.
    alex = db._get_player(table, _sid(table), 'user-alex')
    assert not any(e.get('kind') == 'pvp' for e in (alex.get('awayEvents') or []))


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
    act(table, 'join', user='user-sam', name='Sam', starter='zombie')
    sid = _sid(table)
    doc = db._get_player(table, sid, 'user-sam')
    doc['rolls'] = 0
    db._put_player(table, doc)
    # Four DIFFERENT pokers each poke Sam once (per-target cooldown blocks
    # repeat pokes from the same person). Only the first 3 grant a roll.
    for i in range(4):
        act(table, 'join', user=f'user-p{i}', name=f'P{i}', starter='pest')
        status, resp = act(table, 'poke', user=f'user-p{i}', targetUserId='user-sam')
        assert status == 200
    sam = db._get_player(table, sid, 'user-sam')
    assert sam['rolls'] == 3  # only first 3 pokes grant rolls
    assert sam['pokesReceived'] == 4


def test_poke_same_target_on_cooldown(table):
    act(table, 'join', starter='pest')
    act(table, 'join', user='user-sam', name='Sam', starter='zombie')
    status, _ = act(table, 'poke', targetUserId='user-sam')
    assert status == 200
    # Immediate re-poke of the same creature is blocked by the cooldown.
    status, resp = act(table, 'poke', targetUserId='user-sam')
    assert status == 429
    assert 'min left' in resp['error']


def test_drop_item_removes_one(table):
    act(table, 'join', starter='pest')
    sid = _sid(table)
    alex = db._get_player(table, sid, 'user-alex')
    alex['bag'] = ['healing_moss', 'healing_moss', 'rot_bomb']
    db._put_player(table, alex)
    status, resp = act(table, 'drop-item', item='healing_moss')
    assert status == 200
    assert resp['you']['bag'] == ['healing_moss', 'rot_bomb']  # only one removed
    # Dropping something you don't hold is rejected.
    status, _ = act(table, 'drop-item', item='snare')
    assert status == 409


def test_use_combat_item_out_of_battle_is_rejected(table):
    act(table, 'join', starter='pest')
    sid = _sid(table)
    alex = db._get_player(table, sid, 'user-alex')
    alex['bag'] = ['rot_bomb']
    db._put_player(table, alex)
    # Combat consumables must not fall through to "Unknown item."
    status, resp = act(table, 'use-item', item='rot_bomb')
    assert status == 409
    assert 'Unknown item' not in resp['error']
    # And it stays in the bag.
    assert db._get_player(table, sid, 'user-alex')['bag'] == ['rot_bomb']


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
    assert standings[0]['userId'] == 'user-sam'  # 30 renown (2 pvp wins) beats 0

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
    sid, doc = _player_at(table, 'city_d1')  # a Broodwarrens wild space
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
    sid, doc = _player_at(table, 'cavern_a1')
    out = db._hazard(table, sid, doc, 'cavern_a1')
    assert out['hazardId'] == 'spore_cloud'
    assert doc['position'] != 'cavern_a1'
    assert data.MAP_NODES[doc['position']].get('region') == 'depths'
    assert doc['position'].startswith('cavern_')


def test_wild_warp_node_always_relocates(table, monkeypatch):
    warp = data.WARP_NODES[0]
    sid, doc = _player_at(table, warp)
    db._set_wild_warp_node(table, sid, warp)
    # random() >= 0.20 would NOT trigger the ambient 20% — proves the designated
    # wild warp fires unconditionally, not via the roll.
    monkeypatch.setattr(db._rng, 'random', lambda: 0.99)
    monkeypatch.setattr(db._rng, 'choice', lambda seq: seq[0])
    out = db._resolve_space(table, sid, doc, warp, warp)
    assert out['type'] == 'wild_warp'
    assert 'options' not in out
    assert doc['position'] != warp
    dest = data.MAP_NODES[doc['position']]
    assert dest['type'] not in ('boss', 'barrier', 'lair', 'vault')
    assert dest.get('region') != 'ruin'


def test_wild_warp_rotates_after_firing(table, monkeypatch):
    warp = data.WARP_NODES[0]
    sid, doc = _player_at(table, warp)
    db._set_wild_warp_node(table, sid, warp)
    monkeypatch.setattr(db._rng, 'random', lambda: 0.99)
    monkeypatch.setattr(db._rng, 'choice', lambda seq: seq[0])
    db._resolve_space(table, sid, doc, warp, warp)
    # The wildness must have hopped to a different warp mushroom.
    assert db._wild_warp_node(table, sid) != warp
    assert db._wild_warp_node(table, sid) in data.WARP_NODES


def test_normal_warp_still_shows_picker(table, monkeypatch):
    wild = data.WARP_NODES[0]
    other = data.WARP_NODES[1]
    sid, doc = _player_at(table, other)
    db._set_wild_warp_node(table, sid, wild)
    monkeypatch.setattr(db._rng, 'random', lambda: 0.99)  # miss the ambient 20%
    out = db._resolve_space(table, sid, doc, other, other)
    assert out['type'] == 'warp'
    assert 'options' in out and out['options']
    assert doc['position'] == other


def test_sinkwater_takes_15_pct_spores(table):
    sid, doc = _player_at(table, 'bog_m1', spores=100)
    out = db._hazard(table, sid, doc, 'bog_m1')
    assert out['hazardId'] == 'sinkwater'
    assert doc['spores'] == 85


def test_sinkwater_mirefoot_halved(table):
    sid, doc = _player_at(table, 'bog_m1', spores=100, homeBiome='bog')
    db._hazard(table, sid, doc, 'bog_m1')
    assert doc['spores'] == 93   # ceil(100*0.15)=15, Mirefoot halves -> 7 lost


def test_bone_chill_applies_debuff(table):
    sid, doc = _player_at(table, 'bone_g11')
    out = db._hazard(table, sid, doc, 'bone_g11')
    assert out['hazardId'] == 'bone_chill'
    assert any(b.get('kind') == 'bone_chill' for b in doc['buffs'])


def test_rot_bloom_trades_hp_for_spores(table):
    sid, doc = _player_at(table, 'garden_m2', spores=10)
    hp_before = doc['hp']
    out = db._hazard(table, sid, doc, 'garden_m2')
    assert out['hazardId'] == 'rot_bloom'
    # pest base DEF 5 is below the DEF-6 Thick Hide node, so it takes full HP loss.
    assert doc['hp'] == hp_before - 3
    assert doc['spores'] == 14


def test_rot_bloom_never_kills(table):
    sid, doc = _player_at(table, 'garden_m2', hp=2)
    db._hazard(table, sid, doc, 'garden_m2')
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


def test_scrounger_scales_loot_and_bounty_by_mult():
    # The Pest's Scrounger passive is a % multiplier (not a flat +2) so it stays
    # meaningful as bounties scale. Penalties are never amplified.
    pest = {'passives': ['scrounger']}
    plain = {'passives': []}
    assert db._scrounge(pest, 20) == round(20 * data.SCROUNGER_MULT)
    assert db._scrounge(pest, 20) > db._scrounge(plain, 20) == 20
    assert db._scrounge(pest, -10) == -10


def test_scrounger_consolation_on_lost_or_fled_grind_fight():
    # A scrounger pest pockets a fraction of the bounty even on a lost/fled
    # wild/elite fight; a non-scrounger gets nothing, and it never applies to
    # non-grind fights (barrier/boss/lair).
    pest = {'passives': ['scrounger'], 'spores': 0}
    plain = {'passives': [], 'spores': 0}
    elite_rec = {'kind': 'elite', 'npcMeta': {'bounty': 20}}
    assert db._scrounge_consolation(pest, elite_rec) == round(20 * data.SCROUNGER_LOSS_FRACTION)
    assert pest['spores'] == round(20 * data.SCROUNGER_LOSS_FRACTION)
    assert db._scrounge_consolation(plain, elite_rec) == 0
    assert db._scrounge_consolation(pest, {'kind': 'boss', 'npcMeta': {'bounty': 120}}) == 0


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
    # First challenger wounds her to 20 but falls — the pool lingers, not slain.
    _, out = _lair_fight(table, sid, 'user-alex', 'defender', 20, monkeypatch)
    assert out['npc']['hp'] == boss_hp        # entered at full
    assert out['npc']['maxHp'] == boss_hp
    # Next challenger meets her at 20 HP.
    act(table, 'join', user='user-bea', name='Bea', starter='kraul')
    _, out2 = _lair_fight(table, sid, 'user-bea', 'defender', 12, monkeypatch)
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
    _, out = _lair_fight(table, sid, 'user-alex', 'defender', 9, monkeypatch)
    assert out['npc']['name'] == f"Vestige of {b['name']}"
    _, out2 = _lair_fight(table, sid, 'user-alex', 'defender', 5, monkeypatch)
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


def test_vein_landing_opens_without_striking(table, monkeypatch):
    act(table, 'join', starter='pest')
    sid = _sid(table)
    doc = db._get_player(table, sid, 'user-alex')
    doc['position'] = 'cavern_r3'
    db._put_player(table, doc)
    spores_before = doc.get('spores', 0)
    ev = db._resolve_space(table, sid, doc, 'cavern_r3', 'cavern_r2')
    assert ev['type'] == 'crystal_vein'
    assert ev['depth'] == 0                                # fresh shaft, surface
    assert ev['strikesLeft'] == data.VEIN_STRIKES_PER_VISIT # all swings are the player's
    assert 'collapsed' not in ev                           # no cave-in on arrival
    assert doc['spores'] == spores_before                  # nothing awarded yet
    assert doc['veinStrikesLeft'] == data.VEIN_STRIKES_PER_VISIT
    rec = db._get(table, db._season_pk(sid), 'VEIN#cavern')
    assert rec is None                                     # nothing persisted on landing


def test_vein_cave_in_hurts_and_resets(table, monkeypatch):
    act(table, 'join', starter='pest')
    sid = _sid(table)
    db._save_vein(table, sid, 'cavern', 9)                 # deep, dangerous shaft
    doc = db._get_player(table, sid, 'user-alex')
    doc['position'] = 'cavern_r3'
    doc['veinStrikesLeft'] = data.VEIN_STRIKES_PER_VISIT   # landed, ready to swing
    hp_before = doc['hp']
    db._put_player(table, doc)
    monkeypatch.setattr(db._rng, 'random', lambda: 0.0)    # guaranteed cave-in
    status, resp = act(table, 'strike')                    # the swing triggers the collapse
    assert status == 200
    assert resp['collapsed'] is True
    doc = db._get_player(table, sid, 'user-alex')
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


def test_battle_status_reads_rot_and_buffs():
    side = {'rot_stacks': 3, 'buffs': ['harden_shell', 'weaken_hex']}
    assert db._battle_status(side) == {'rot': 3, 'buffs': ['harden_shell', 'weaken_hex']}


def test_battle_status_defaults_empty():
    assert db._battle_status({}) == {'rot': 0, 'buffs': []}


def test_start_battle_includes_status(table, monkeypatch):
    monkeypatch.setattr(db, '_rng', _ZeroRng())
    act(table, 'join', starter='kraul')
    sid = _sid(table)
    ev = _begin(table, sid)
    assert ev['playerStatus'] == {'rot': 0, 'buffs': []}
    assert ev['npcStatus'] == {'rot': 0, 'buffs': []}


def test_start_battle_reports_opponent_level(table, monkeypatch):
    """The battle_start payload carries the derived opponent level for the UI."""
    monkeypatch.setattr(db, '_rng', _ZeroRng())
    act(table, 'join', starter='kraul')
    sid = _sid(table)
    npc = dict(_FODDER)
    ev = _begin(table, sid, npc=npc)
    assert ev['npc']['level'] == data.enemy_level(
        npc['atk'], npc['def'], npc['spd'], npc.get('maxHp', npc['hp']))
    assert ev['npc']['level'] >= 1


def test_combat_round_reports_status(table, monkeypatch):
    monkeypatch.setattr(db, '_rng', _ZeroRng())
    act(table, 'join', starter='kraul')
    sid = _sid(table)
    _begin(table, sid)
    # Seed a standing status on each side, then resolve a no-op round.
    doc = db._get_player(table, sid, 'user-alex')
    doc['battle']['npc']['rot_stacks'] = 3
    doc['battle']['player']['buffs'] = ['harden_shell']
    db._put_player(table, doc)
    monkeypatch.setattr(db.engine, 'resolve_round', lambda *a, **k: [])
    status, resp = act(table, 'combat-round', stance='aggress')
    assert status == 200
    assert resp['combat']['npcStatus']['rot'] == 3
    assert resp['combat']['playerStatus']['buffs'] == ['harden_shell']


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
    act(table, 'join', starter='pest')              # JOIN_ROLLS (3) < cap of 6
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


def test_grant_board_game_rewards_applies_rolls_and_item(monkeypatch):
    t = FakeTable()
    act(t, 'season-start', hostKey='swampking')
    act(t, 'join', user='user-alex', name='Alex', starter='pest')
    act(t, 'join', user='user-sam', name='Sam', starter='pest')
    # Zero out banked rolls so the +2 / +3 grants are deterministic.
    for uid in ('user-alex', 'user-sam'):
        d = db._get_player(t, _sid(t), uid)
        d['rolls'] = 0
        db._put_player(t, d)

    summary = db.grant_board_game_rewards(
        t, _sid(t), ['user-alex', 'user-sam'], ['user-sam'])

    assert set(summary['granted']) == {'user-alex', 'user-sam'}
    assert summary['banked'] == []
    alex = db._get_player(t, _sid(t), 'user-alex')
    sam = db._get_player(t, _sid(t), 'user-sam')
    assert alex['rolls'] == data.CLAIM_FINISHED_ROLLS            # participation only
    assert sam['rolls'] == data.CLAIM_FINISHED_ROLLS + data.CLAIM_WON_BONUS_ROLLS
    assert len(sam['bag']) == 1                                  # winner got an item
    assert alex['bag'] == []


def test_board_game_reward_notifies_with_game_name(monkeypatch):
    """A live player who closed out a game gets a welcome-back note naming it."""
    t = FakeTable()
    act(t, 'season-start', hostKey='swampking')
    act(t, 'join', user='user-alex', name='Alex', starter='pest')

    db.grant_board_game_rewards(
        t, _sid(t), ['user-alex'], ['user-alex'], game_name='Wingspan')

    alex = db._get_player(t, _sid(t), 'user-alex')
    note = next(e for e in alex['awayEvents'] if e['kind'] == 'reward')
    assert note['game'] == 'Wingspan'
    assert note['rolls'] == data.CLAIM_FINISHED_ROLLS + data.CLAIM_WON_BONUS_ROLLS
    assert note['items'] == 1


def test_banked_reward_notifies_on_hatch():
    """A player who hadn't hatched yet learns of the game reward when they join."""
    t = FakeTable()
    act(t, 'season-start', hostKey='swampking')
    db.grant_board_game_rewards(t, _sid(t), ['user-late'], [], game_name='Catan')

    _, resp = act(t, 'join', user='user-late', name='Late', starter='pest')
    note = next(e for e in resp['you']['awayEvents'] if e['kind'] == 'reward')
    assert note['game'] == 'Catan'
    assert note['rolls'] == data.CLAIM_FINISHED_ROLLS


def test_broadcast_away_reaches_others_not_actor(table):
    """A slain-boss news line fans out to every player but the slayer."""
    act(table, 'join', user='user-alex', name='Alex', starter='pest')
    act(table, 'join', user='user-sam', name='Sam', starter='pest')

    db._broadcast_away(table, _sid(table),
                       {'kind': 'boss', 'by': 'Alex', 'name': 'The Bog Warden',
                        'at': db._now()}, exclude_user_id='user-alex')

    sam = db._get_player(table, _sid(table), 'user-sam')
    assert sam['awayEvents'][-1] == {
        'kind': 'boss', 'by': 'Alex', 'name': 'The Bog Warden',
        'at': sam['awayEvents'][-1]['at']}
    alex = db._get_player(table, _sid(table), 'user-alex')
    assert not any(e.get('kind') == 'boss' for e in (alex.get('awayEvents') or []))


def test_grant_board_game_rewards_banks_for_absent_player():
    t = FakeTable()
    act(t, 'season-start', hostKey='swampking')
    # user-ghost never joined Undercity this night.
    summary = db.grant_board_game_rewards(t, _sid(t), ['user-ghost'], ['user-ghost'])
    assert summary['granted'] == []
    assert summary['banked'] == ['user-ghost']

    rec = db._get(t, db._reward_pk(_sid(t)), 'USER#user-ghost')
    assert rec['rolls'] == data.CLAIM_FINISHED_ROLLS + data.CLAIM_WON_BONUS_ROLLS
    assert len(rec['items']) == 1


def test_bank_merges_on_repeat():
    t = FakeTable()
    act(t, 'season-start', hostKey='swampking')
    db.grant_board_game_rewards(t, _sid(t), ['user-ghost'], [])            # participation
    db.grant_board_game_rewards(t, _sid(t), ['user-ghost'], ['user-ghost'])  # winner
    rec = db._get(t, db._reward_pk(_sid(t)), 'USER#user-ghost')
    assert rec['rolls'] == data.CLAIM_FINISHED_ROLLS * 2 + data.CLAIM_WON_BONUS_ROLLS
    assert len(rec['items']) == 1


def test_post_event_writes_to_feed():
    t = FakeTable()
    act(t, 'season-start', hostKey='swampking')
    db.post_event(t, _sid(t), 'claim', 'Catan wrapped up at the table.')
    _, state = db.handle_state(t, {'userId': 'user-alex'})
    assert any(e['text'] == 'Catan wrapped up at the table.' for e in state['events'])


def test_banked_rewards_applied_on_join():
    t = FakeTable()
    act(t, 'season-start', hostKey='swampking')
    # Bank a winner reward for someone who hasn't hatched.
    db.grant_board_game_rewards(t, _sid(t), ['user-late'], ['user-late'])
    assert db._get(t, db._reward_pk(_sid(t)), 'USER#user-late') is not None

    status, resp = act(t, 'join', user='user-late', name='Late', starter='pest')
    assert status == 200
    you = resp['you']
    # JOIN_ROLLS=3 + banked (2 participation + 1 winner) = 6, capped at ROLL_CAP.
    assert you['rolls'] == min(data.ROLL_CAP,
                               data.JOIN_ROLLS + data.CLAIM_FINISHED_ROLLS + data.CLAIM_WON_BONUS_ROLLS)
    assert len(you['bag']) == 1                       # banked item delivered
    # Bank record consumed.
    assert db._get(t, db._reward_pk(_sid(t)), 'USER#user-late') is None


# ── Renown shop (pre-spawn) ──────────────────────────────────────────────────

def test_renown_shop_price_tables_are_sane():
    # Seed lets a brand-new player buy exactly one common hat OR one plain color.
    assert data.SHOP_START_RENOWN == 50
    assert data.HAT_PRICES == {'common': 50, 'uncommon': 120, 'legendary': 300}
    assert data.PAINT_PRICE == 40
    # Every hat/paint id resolves through the new maps.
    assert data.HAT_MAP['party_hat']['rarity'] == 'common'
    assert data.PAINT_MAP['crimson']['hue'] == 0
    # Starter kit: real item ids (or the synthetic spore pouch), each with a cost.
    ids = {i['id'] for i in data.RENOWN_SHOP_ITEMS}
    assert ids == {'healing_moss', 'rusted_fang', 'chitin_scrap', 'spore_pouch'}
    for it in data.RENOWN_SHOP_ITEMS:
        assert it['cost'] > 0 and it['kind'] in ('consumable', 'gear', 'spores')
    assert data.RENOWN_SHOP_ITEMS_MAP['spore_pouch']['amount'] == 15


def test_new_player_is_seeded_with_renown_and_it_is_surfaced(table):
    act(table, 'join', starter='pest', home='city')
    status, state = db.handle_state(table, {'userId': 'user-alex'})
    assert status == 200
    assert state['wardrobe']['renown'] == data.SHOP_START_RENOWN


def test_archive_banks_each_players_renown(table):
    # Renown is combat/firsts only, so give the pest a couple of wild wins:
    # compute_renown = 3 * 2 wildWins = 6 (level & spores no longer count).
    act(table, 'join', starter='pest', home='cavern')
    sid = _sid(table)
    doc = db._get_player(table, sid, 'user-alex')
    doc['wildWins'] = 2
    db._put_player(table, doc)
    status, resp = act(table, 'season-end', hostKey='swampking')
    assert status == 200
    perm = db._get_perm(table, 'user-alex')
    # Seed (50) + this night's earned renown (6).
    assert perm['renown'] == data.SHOP_START_RENOWN + 6


def _fund(table, user, renown):
    """Give a not-yet-hatched player a fatter Renown wallet for a test."""
    perm = db._get_perm(table, user)
    perm['renown'] = renown
    table.put_item(Item=perm)


def test_join_buys_and_equips_permanent_cosmetics(table):
    _fund(table, 'user-alex', 200)  # afford a common hat (50) + a color (40)
    status, resp = act(table, 'join', starter='pest', home='city',
                       buyHats=['party_hat'], buyPaints=['crimson'],
                       equipHat='party_hat', equipPaint='crimson')
    assert status == 200, resp
    you = resp['you']
    assert you['hat'] == 'party_hat'
    assert you['paint']['body'] == 0 and you['paint']['stripes'] == 0  # crimson hue
    perm = db._get_perm(table, 'user-alex')
    assert 'party_hat' in perm['hats'] and 'crimson' in perm['paints']
    assert perm['renown'] == 200 - data.HAT_PRICES['common'] - data.PAINT_PRICE


def test_join_rejects_unaffordable_cart_without_charging(table):
    # Seed 50 can't cover a common hat (50) AND a paint (40) = 90.
    status, resp = act(table, 'join', starter='pest', home='city',
                       buyHats=['party_hat'], buyPaints=['crimson'])
    assert status == 409
    assert 'Renown' in resp['error']
    # No player doc, no perm mutation: a retry must still see the full seed.
    perm = db._get_perm(table, 'user-alex')
    assert perm['renown'] == data.SHOP_START_RENOWN
    assert perm['hats'] == [] and 'crimson' not in perm['paints']


def test_join_grants_one_night_starter_items(table):
    _fund(table, 'user-alex', 100)  # kit is 20 + 25 + 15 = 60, over the 50 seed
    status, resp = act(table, 'join', starter='pest', home='city',
                       buyItems=['healing_moss', 'rusted_fang', 'spore_pouch'])
    assert status == 200, resp
    you = resp['you']
    assert 'healing_moss' in you['bag']
    assert you['gear']['fang'] == 'rusted_fang'
    assert you['spores'] == 15 + 15  # City Rat perk + spore pouch
    perm = db._get_perm(table, 'user-alex')
    assert perm['renown'] == 100 - 20 - 25 - 15


def test_join_rejects_equipping_unowned_cosmetic(table):
    status, resp = act(table, 'join', starter='pest', home='city',
                       equipHat='crown')  # never bought
    assert status == 409
    assert 'own' in resp['error']


def test_join_with_no_purchases_is_unchanged(table):
    status, resp = act(table, 'join', starter='pest', home='city')
    assert status == 200
    assert resp['you']['hat'] is None
    assert db._get_perm(table, 'user-alex')['renown'] == data.SHOP_START_RENOWN


def test_rejoin_does_not_double_charge(table):
    act(table, 'join', starter='pest', home='city', buyHats=['party_hat'])
    before = db._get_perm(table, 'user-alex')['renown']
    # Idempotent re-join with a fresh cart must not spend again.
    status, resp = act(table, 'join', starter='pest', home='city', buyHats=['top_hat'])
    assert status == 200
    assert db._get_perm(table, 'user-alex')['renown'] == before
    assert 'top_hat' not in db._get_perm(table, 'user-alex')['hats']


def test_collapse_enabled_for_every_fight_kind(table, monkeypatch):
    # Sudden death: the collapse is on for EVERY kind, including the persistent-
    # pool lair/boss (they linger on a player loss, not on a timeout).
    act(table, 'join', starter='pest')
    sid = _sid(table)
    seen = {}

    def _spy(att, dfn, a_st, d_st, rnd, rng, **kw):
        seen['frenzy_from'] = kw.get('frenzy_from')
        dfn.hp = 0   # end the fight so the battle record clears
        return [{'round': rnd, 'by': 'attacker', 'dmg': 99, 'winner': 'attacker'}]

    monkeypatch.setattr(db.engine, 'resolve_round', _spy)

    doc = db._get_player(table, sid, 'user-alex')
    db._wild_battle(table, sid, doc)
    db._put_player(table, doc)
    act(table, 'combat-round', user='user-alex', name='Alex', stance='aggress')
    assert seen['frenzy_from'] == data.FRENZY_START

    seen.clear()
    doc = db._get_player(table, sid, 'user-alex')
    doc['position'] = 'city_lair'
    db._lair(table, sid, doc, 'city_lair')
    db._put_player(table, doc)
    act(table, 'combat-round', user='user-alex', name='Alex', stance='aggress')
    assert seen['frenzy_from'] == data.FRENZY_START


def test_battle_start_reports_frenzy_from(table):
    act(table, 'join', starter='pest')
    sid = _sid(table)
    doc = db._get_player(table, sid, 'user-alex')
    ev = db._wild_battle(table, sid, doc)
    assert ev['frenzyFrom'] == data.FRENZY_START


# ── Guardian pools (specs/2026-07-19-undercity-guardian-targeting-design.md) ────

def test_barrier_pool_lingers_and_reads_back(table):
    sid, _ = db._active_season(table)
    # No record yet -> full HP, no buffs.
    hp, buffs = db._barrier_state(table, sid, 'bar_e')
    assert hp == data.BARRIER_GUARDIANS['bar_e']['hp'] and buffs == []
    # A wounded pool + a stored curse round-trip.
    db._set_barrier_state(table, sid, 'bar_e', 20, [{'kind': 'bone_chill'}])
    hp, buffs = db._barrier_state(table, sid, 'bar_e')
    assert hp == 20 and buffs == [{'kind': 'bone_chill'}]


# ── Flow loot puzzle ─────────────────────────────────────────────────────────

def _first_loot_node():
    return next(n for n, d in data.MAP_NODES.items() if d['type'] == 'loot')


def test_landing_on_loot_offers_puzzle_and_defers_reward(table):
    act(table, 'join', starter='pest')
    sid = _sid(table)
    node = _first_loot_node()
    doc = db._get_player(table, sid, 'user-alex')
    doc['position'] = node
    doc['spores'] = 100
    before = doc['spores']
    ev = db._resolve_space(table, sid, doc, node, node)
    assert ev['type'] == 'loot_puzzle'
    assert ev['puzzle']['id'] == doc['pendingLoot']['puzzleId']
    assert 'solution' not in ev['puzzle']       # never leak the answer
    assert doc['spores'] == before              # reward NOT applied yet


def test_solve_loot_puzzle_awards_and_clears(table):
    act(table, 'join', starter='pest')
    sid = _sid(table)
    node = _first_loot_node()
    doc = db._get_player(table, sid, 'user-alex')
    doc['position'] = node
    db._resolve_space(table, sid, doc, node, node)  # sets pendingLoot
    db._put_player(table, doc)
    pid = doc['pendingLoot']['puzzleId']
    sol = data.flow_puzzle(pid)['solution']
    status, resp = act(table, 'solve-loot-puzzle', path=sol)
    assert status == 200, resp
    assert resp['spaceEvent']['type'] == 'loot'
    assert not resp['you'].get('pendingLoot')


def test_solve_loot_puzzle_rejects_bad_path(table):
    act(table, 'join', starter='pest')
    sid = _sid(table)
    node = _first_loot_node()
    doc = db._get_player(table, sid, 'user-alex')
    doc['position'] = node
    db._resolve_space(table, sid, doc, node, node)
    db._put_player(table, doc)
    status, resp = act(table, 'solve-loot-puzzle', path=[[0, 0]])
    assert status == 409
    doc2 = db._get_player(table, sid, 'user-alex')
    assert doc2.get('pendingLoot')              # still pending, can retry


def test_cancel_loot_puzzle_forfeits(table):
    act(table, 'join', starter='pest')
    sid = _sid(table)
    node = _first_loot_node()
    doc = db._get_player(table, sid, 'user-alex')
    doc['position'] = node
    doc['spores'] = 0
    db._resolve_space(table, sid, doc, node, node)
    db._put_player(table, doc)
    status, resp = act(table, 'cancel-loot-puzzle')
    assert status == 200
    assert not resp['you'].get('pendingLoot')
    assert resp['you']['spores'] == 0           # nothing awarded
