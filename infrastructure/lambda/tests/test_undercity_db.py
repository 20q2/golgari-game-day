"""Integration tests for the action dispatcher against an in-memory table."""
import random
import sys
import time
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

    def scan(self, FilterExpression=None, ExpressionAttributeValues=None):
        """Subset used by the reset-all admin cmd: filter on sk == a literal and
        begins_with(pk, prefix). Pattern-matches the expression like query()."""
        vals = ExpressionAttributeValues or {}
        out = []
        for (ipk, isk), item in self.items.items():
            if FilterExpression:
                if 'begins_with(pk' in FilterExpression and not ipk.startswith(vals.get(':u', '')):
                    continue
                if 'sk = :meta' in FilterExpression and isk != vals.get(':meta'):
                    continue
            out.append(item)
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
    assert you['hp'] == 25 and you['position'] == 'cavern_r0' and you['rolls'] == 3
    assert you['homeBiome'] == 'cavern'
    assert you['passives'] == ['drift']

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


def test_marrowborn_home_grants_max_hp(table):
    # Ossuary Fields (bone) home: Marrowborn hatches you with +MARROWBORN_MAXHP,
    # at full HP.
    status, resp = act(table, 'join', starter='pest', home='bone')
    assert status == 200
    you = resp['you']
    assert you['maxHp'] == 25 + data.MARROWBORN_MAXHP
    assert you['hp'] == you['maxHp']


def test_city_rat_home_grants_random_t1_gear(table):
    # The Undercity (city) home: City Rat hatches with a random T1 piece, which
    # now auto-equips into its (empty) slot, and grants no starting Spores.
    status, resp = act(table, 'join', starter='pest', home='city')
    assert status == 200
    you = resp['you']
    assert you['spores'] == 0
    assert not you.get('gearStash')                    # auto-equipped, nothing stashed
    gear = you.get('gear') or {}
    assert len(gear) == 1
    gid = next(iter(gear.values()))
    assert data.GEAR[gid]['tier'] == 1


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
    assert se['renownGained'] == data.RENOWN['per_wild_win']  # a composted wild = +renown


def test_elite_battle_pulls_from_elite_pool(table, monkeypatch):
    act(table, 'join', starter='pest')
    sid = _sid(table)
    doc = db._get_player(table, sid, 'user-alex')
    ev = db._wild_battle(table, sid, doc, elite=True)
    assert ev['type'] == 'battle_start'
    assert ev['npc']['id'] in {n['id'] for n in data.ELITE_NPCS}
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
    assert ev['npc']['id'] in {n['id'] for n in data.ELITE_NPCS}


def test_non_wilderness_battle_still_uses_base_pools(table):
    act(table, 'join', starter='pest')
    sid = _sid(table)
    doc = db._get_player(table, sid, 'user-alex')
    doc['position'] = 'cavern_r2'  # a surface, non-dungeon, non-wilderness node
    ev = db._wild_battle(table, sid, doc, elite=False, region='cavern')
    assert ev['npc']['id'] in {n['id'] for n in data.NPCS}


def test_boss_area_signature_spawns_themed_minion(table, monkeypatch):
    # In a boss's depths pocket, a hit signature roll spawns its bespoke familiar.
    act(table, 'join', starter='pest')
    sid = _sid(table)
    doc = db._get_player(table, sid, 'user-alex')
    doc['position'] = 'bone_d0'                       # Skullbriar's ossuary pocket
    monkeypatch.setattr(db._rng, 'random', lambda: 0.0)   # under the chance -> familiar
    ev = db._wild_battle(table, sid, doc, elite=False, region='depths')
    assert ev['npc']['id'] == data.LAIR_SIGNATURE['bone'] == 'skullbriars_familiar'
    assert ev['npc']['spriteId'] == 'skullbriars_familiar'
    # The familiar's trait rides into the battle record (client reads it via npcStatus).
    assert 'grave_growth' in (doc['battle']['npc'].get('passives') or [])


def test_gitrog_spawn_rotates_sprite(table, monkeypatch):
    # The Gitrog familiar randomly shows one of its two sprite variants.
    act(table, 'join', starter='pest')
    sid = _sid(table)
    doc = db._get_player(table, sid, 'user-alex')
    doc['position'] = 'bog_d0'
    monkeypatch.setattr(db._rng, 'random', lambda: 0.0)
    seen = set()
    for choice in ('gitrog_spawn', 'gitrog_spawn2'):
        monkeypatch.setattr(db._rng, 'choice', lambda seq, c=choice: c)
        ev = db._wild_battle(table, sid, doc, elite=False, region='depths')
        seen.add(ev['npc']['spriteId'])
    assert seen == {'gitrog_spawn', 'gitrog_spawn2'}


def test_boss_area_signature_missed_roll_uses_flat_pool(table, monkeypatch):
    # A missed roll falls back to the flat tier-2 wild pool (variety preserved).
    act(table, 'join', starter='pest')
    sid = _sid(table)
    doc = db._get_player(table, sid, 'user-alex')
    doc['position'] = 'bone_d0'
    monkeypatch.setattr(db._rng, 'random', lambda: 0.99)  # over the chance -> flat pool
    ev = db._wild_battle(table, sid, doc, elite=False, region='depths')
    assert ev['npc']['id'] in {n['id'] for n in data.DEPTHS_MID}


def test_boss_area_signature_never_on_elite_spaces(table, monkeypatch):
    # Elite spaces keep the full tier pool even on a would-be-hit signature roll.
    act(table, 'join', starter='pest')
    sid = _sid(table)
    doc = db._get_player(table, sid, 'user-alex')
    doc['position'] = 'bone_d0'
    monkeypatch.setattr(db._rng, 'random', lambda: 0.0)
    ev = db._wild_battle(table, sid, doc, elite=True, region='depths')
    assert ev['npc']['id'] in {n['id'] for n in data.WILDERNESS_NPCS}


def test_wilderness_monsters_are_tougher_than_base_elites(table):
    base_max_hp = max(n['hp'] for n in data.ELITE_NPCS)
    assert min(n['hp'] for n in data.WILDERNESS_NPCS) > max(n['hp'] for n in data.NPCS)
    assert min(n['hp'] for n in data.WILDERNESS_ELITE_NPCS) >= base_max_hp


# ── Depths difficulty ladder (design 2026-07-26) ─────────────────────────────

def test_depths_ladder_hp_is_monotonic():
    """Each rung of the ladder is strictly tougher than the last — no cliffs, no
    inversions (the malformed roster this change fixes)."""
    rungs = [max(n['hp'] for n in data.DUNGEON_NPCS.values()),
             min(n['hp'] for n in data.DEPTHS_MID),
             min(n['hp'] for n in data.DEPTHS_DEEP),
             min(n['hp'] for n in data.DEPTHS_ABYSS),
             min(n['hp'] for n in data.ISLE_APEX)]
    assert rungs == sorted(rungs) and len(set(rungs)) == len(rungs), rungs
    # every rung fields all four AI personalities' worth of variety (≥3 distinct)
    for pool in (data.DEPTHS_MID, data.DEPTHS_DEEP):
        assert len({n['personality'] for n in pool}) >= 3


def test_node_depth_zero_at_mouth_and_grows_inward(table):
    sid = _sid(table)
    dm = db._season_depth_map(table, sid)
    assert dm['city_lb'] == 0                       # the mouth is depth 0
    assert max(dm.values()) >= 10                   # the dungeon runs genuinely deep
    assert db._node_depth(table, sid, 'wild_core_n') == 0   # non-depths → 0


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


def test_funded_tier2_can_commit_a_bonk_stop_onto_a_bridge(table):
    # Regression: a funded T2 that rolls MORE than the distance to a bridge
    # mouth bonk-stops on the mouth (spending the rest of the roll). _roll
    # offers the mouth as a destination (via _stop_nodes), so the move must
    # also validate — the walk validator has to treat the bridge as a stop.
    act(table, 'join', starter='pest')
    sid = _sid(table)
    doc = db._get_player(table, sid, 'user-alex')
    doc['tier'] = 2
    doc['spores'] = data.TUNNEL_TOLL[2]
    doc['position'] = 'cavern_r2'
    # A roll of 3 reaches the adjacent bridge mouth in 1 hop → a bonk stop.
    closed = db._stop_nodes(table, sid, doc)
    blocked = db._blocked_nodes(doc)
    dests = engine.legal_destinations(data.MAP_NODES, 'cavern_r2', 3, closed, blocked)
    assert 't_bone_cavern1' in dests   # offered by the roll
    doc['pendingMove'] = {'value': 3, 'dests': sorted(dests)}
    doc['rolls'] = 3
    db._put_player(table, doc)
    # Committing the 1-hop bonk walk to the mouth must succeed (it crosses,
    # charging the toll, via _resolve_space on landing).
    status, resp = act(table, 'move', to='t_bone_cavern1',
                       path=['cavern_r2', 't_bone_cavern1'])
    assert status == 200, resp


def test_tier1_stops_on_a_bridge_not_through_it(table):
    # Tier-1 now halts on a bridge mouth (a bonk stop) and is carried across on
    # landing, the same as an evolved unit — it no longer corridors through the
    # spur into the far biome under its own steam.
    act(table, 'join', starter='pest')
    sid = _sid(table)
    doc = db._get_player(table, sid, 'user-alex')
    doc['tier'] = 1
    doc['position'] = 'cavern_r2'
    closed = db._stop_nodes(table, sid, doc)   # Tier-1: bridges now added
    blocked = db._blocked_nodes(doc)
    # The near mouth is a valid STOP with a 2-roll (bonk)...
    assert 't_bone_cavern1' in engine.legal_destinations(
        data.MAP_NODES, doc['position'], 2, closed, blocked)
    # ...but the roll cannot corridor THROUGH it to its paired mouth.
    assert 't_bone_cavern0' not in engine.legal_destinations(
        data.MAP_NODES, doc['position'], 2, closed, blocked)


def test_crossing_a_bridge_banks_the_leftover_roll(table):
    # Cross-then-keep-walking: landing on a bridge with roll to spare carries you
    # across for free AND resumes the unused steps on the far side (like a
    # ladder), so a crossing no longer eats the rest of your move.
    act(table, 'join', starter='pest')
    sid = _sid(table)
    doc = db._get_player(table, sid, 'user-alex')
    doc['tier'] = 1
    doc['position'] = 'cavern_r2'
    closed = db._stop_nodes(table, sid, doc)
    blocked = db._blocked_nodes(doc)
    dests = engine.legal_destinations(data.MAP_NODES, 'cavern_r2', 3, closed, blocked)
    assert 't_bone_cavern1' in dests          # near mouth offered as a bonk stop
    doc['pendingMove'] = {'value': 3, 'dests': sorted(dests)}
    doc['rolls'] = 3
    db._put_player(table, doc)
    # A 1-hop bonk walk onto the mouth: crosses for free, 2 steps to spare.
    status, resp = act(table, 'move', to='t_bone_cavern1',
                       path=['cavern_r2', 't_bone_cavern1'])
    assert status == 200, resp
    exit_node = data.TUNNEL_EXITS['t_bone_cavern1']
    you = resp['you']
    assert you['position'] == exit_node       # carried across for free
    # 3-roll − 1 hop to the mouth → 2 steps resume on the far side, and the
    # banked destinations are measured from the far node.
    assert you['pendingMove'] is not None
    assert you['pendingMove']['value'] == 2
    assert set(you['pendingMove']['dests']) == set(engine.legal_destinations(
        data.MAP_NODES, exit_node, 2, closed, blocked))


def test_landing_exactly_on_a_bridge_ends_the_move(table):
    # No leftover → no banked pendingMove; the crossing simply ends the turn.
    act(table, 'join', starter='pest')
    sid = _sid(table)
    doc = db._get_player(table, sid, 'user-alex')
    doc['tier'] = 1
    doc['position'] = 'cavern_r2'
    closed = db._stop_nodes(table, sid, doc)
    blocked = db._blocked_nodes(doc)
    dests = engine.legal_destinations(data.MAP_NODES, 'cavern_r2', 1, closed, blocked)
    doc['pendingMove'] = {'value': 1, 'dests': sorted(dests)}
    doc['rolls'] = 3
    db._put_player(table, doc)
    status, resp = act(table, 'move', to='t_bone_cavern1',
                       path=['cavern_r2', 't_bone_cavern1'])
    assert status == 200, resp
    assert resp['you']['position'] == data.TUNNEL_EXITS['t_bone_cavern1']
    assert resp['you'].get('pendingMove') is None


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


def test_shiny_hatch(table, monkeypatch):
    # Forced shiny: the stored doc carries the flag and it surfaces publicly.
    monkeypatch.setattr(data, 'SHINY_HATCH_CHANCE', 1.0)
    act(table, 'join', starter='pest')
    doc = db._get_player(table, _sid(table), 'user-alex')
    assert doc['shiny'] is True
    assert db._public_player(doc)['shiny'] is True

    # Forced non-shiny: flag is present and false (never omitted for a fresh hatch).
    monkeypatch.setattr(data, 'SHINY_HATCH_CHANCE', 0.0)
    act(table, 'join', user='user-dull', name='Dull', starter='pest')
    dull = db._get_player(table, _sid(table), 'user-dull')
    assert dull['shiny'] is False
    assert db._public_player(dull)['shiny'] is False


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


def test_get_state_you_reports_effective_maxhp(table):
    """Regression: getState's `you` must echo the EFFECTIVE maxHp (base + gear +
    perks) just like the action response (`_ok`) and `_public_player`. When it
    echoed the raw base maxHp instead, a routine poll landed right after an action
    and yanked the client's max HP down — below current hp when gear/perks are on
    (worst right after a level-up heal to full)."""
    act(table, 'join', starter='saproling', home='cavern')
    sid = _sid(table)
    doc = db._get_player(table, sid, 'user-alex')
    doc['gear'] = {'carapace': 'troll_hide'}          # +6 maxHp over base
    eff_max = engine.effective_stats(doc)['maxHp']
    assert eff_max > doc['maxHp']                       # gear really lifts the max
    doc['hp'] = eff_max                                 # hp healed/clamped to eff max
    db._put_player(table, doc)

    status, state = db.handle_state(table, {'userId': 'user-alex'})
    assert status == 200, state
    you = state['you']
    assert you['maxHp'] == eff_max                      # effective, not raw base
    assert you['maxHp'] >= you['hp']                    # max never below current hp


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


def test_pvp_duel_win_steals_but_leaves_target_alive(table, monkeypatch):
    # New model (design 2026-07-27): PvP is an interactive duel vs a full-HP AI
    # clone. Winning steals spores from the LIVE target but never composts them
    # or touches their HP.
    act(table, 'join', starter='kraul', home='cavern')
    act(table, 'join', user='user-sam', name='Sam', starter='saproling', home='cavern')
    alex = db._get_player(table, _sid(table), 'user-alex')
    sam = db._get_player(table, _sid(table), 'user-sam')
    alex['position'] = sam['position'] = 'city_r2'
    alex['atk'] = 50
    sam['spores'] = 100
    sam_hp_before = sam['hp']
    db._put_player(table, alex)
    db._put_player(table, sam)

    status, resp = act(table, 'battle', targetUserId='user-sam')
    assert status == 200
    assert resp['spaceEvent']['kind'] == 'pvp'
    alex = db._get_player(table, _sid(table), 'user-alex')
    se = _finish_started_battle(table, monkeypatch, alex, 'attacker')
    assert se['type'] == 'pvp'
    assert se['spores'] == 25                 # 25% of Sam's 100

    alex = db._get_player(table, _sid(table), 'user-alex')
    sam = db._get_player(table, _sid(table), 'user-sam')
    assert alex['spores'] == 25 and alex['pvpWins'] == 1
    assert sam['spores'] == 75                # lost the stolen spores
    assert sam['hp'] == sam_hp_before         # HP untouched
    assert sam['position'] == 'city_r2'       # NOT composted to the gate
    assert not sam.get('shieldUntil')         # no compost shield — was never killed


def test_pvp_cannot_start_a_second_fight_while_in_one(table):
    # You can't open a duel while already mid-battle.
    act(table, 'join', starter='kraul', home='cavern')
    act(table, 'join', user='user-sam', name='Sam', starter='saproling', home='cavern')
    alex = db._get_player(table, _sid(table), 'user-alex')
    sam = db._get_player(table, _sid(table), 'user-sam')
    alex['position'] = sam['position'] = 'city_r2'
    db._put_player(table, alex)
    db._put_player(table, sam)
    status, _ = act(table, 'battle', targetUserId='user-sam')
    assert status == 200
    status, _ = act(table, 'battle', targetUserId='user-sam')
    assert status == 409


def test_pvp_notifies_the_victim(table, monkeypatch):
    """A beaten player gets a welcome-back note naming the attacker and the loot
    — and it makes clear the creature survived (outcome 'beaten', not composted)."""
    act(table, 'join', starter='kraul', home='cavern')
    act(table, 'join', user='user-sam', name='Sam', starter='saproling', home='cavern')
    alex = db._get_player(table, _sid(table), 'user-alex')
    sam = db._get_player(table, _sid(table), 'user-sam')
    alex['position'] = sam['position'] = 'city_r2'
    alex['atk'] = 50
    sam['spores'] = 100
    db._put_player(table, alex)
    db._put_player(table, sam)

    act(table, 'battle', targetUserId='user-sam')
    alex = db._get_player(table, _sid(table), 'user-alex')
    _finish_started_battle(table, monkeypatch, alex, 'attacker')

    sam = db._get_player(table, _sid(table), 'user-sam')
    note = sam['awayEvents'][-1]
    assert note['kind'] == 'pvp'
    assert note['outcome'] == 'beaten'
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
    doc = db._get_player(table, sid, 'user-alex')
    doc['gear'] = {}                                       # ignore any City Rat starter gear
    db._put_player(table, doc)
    # First fang → empty slot → auto-equipped (not stashed).
    status, resp = act(table, 'buy', itemId='rusted_fang')
    assert status == 200
    assert (resp['you'].get('gear') or {}).get('fang') == 'rusted_fang'
    assert 'rusted_fang' not in (resp['you'].get('gearStash') or [])
    assert resp['you']['spores'] == 180
    # Second fang → slot now filled → stashed (never trades in the worn piece).
    status, resp = act(table, 'buy', itemId='wurm_tooth')
    assert resp['you']['spores'] == 180 - 80
    assert 'wurm_tooth' in resp['you']['gearStash']
    status, resp = act(table, 'buy', itemId='healing_moss')
    assert status == 200 and 'healing_moss' in resp['you']['bag']


def test_gain_gear_equips_empty_stashes_filled_grinds_when_full():
    doc = {'gear': {}, 'gearStash': [], 'materials': {'moltings': 0, 'ichor': 0}}
    # Empty slot → auto-equip, nothing stashed.
    r = db._gain_gear(doc, 'rusted_fang')
    assert r['outcome'] == 'equipped' and doc['gear']['fang'] == 'rusted_fang'
    assert doc['gearStash'] == []
    # Filled slot, room in stash → stash; never displaces the worn piece.
    r = db._gain_gear(doc, 'bloodfang')
    assert r['outcome'] == 'stashed' and 'bloodfang' in doc['gearStash']
    assert doc['gear']['fang'] == 'rusted_fang'
    # Filled slot, full stash → parked for the pickup modal (piece never lost).
    doc['gearStash'] = ['bloodfang'] * data.GEAR_STASH_SIZE
    r = db._gain_gear(doc, 'gutcleaver')
    assert r['outcome'] == 'pending'
    assert 'gutcleaver' not in doc['gearStash']
    assert doc['pendingPickups'][0]['itemId'] == 'gutcleaver'


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
    assert you['tier'] == 2 and you['maxHp'] == 25 and you['spd'] == 6 + 4
    assert you['hp'] == you['maxHp']
    assert 'skitter' in you['passives'] and 'drift' in you['passives']

    doc = db._get_player(table, sid, 'user-alex')
    doc['level'] = 10
    db._put_player(table, doc)
    status, resp = act(table, 'evolve', form='grave_titan')
    assert status == 400  # slitherhead (speed) can't be a tank titan
    status, resp = act(table, 'evolve', form='izoni')
    assert status == 200 and resp['you']['tier'] == 3


def test_poke_grants_roll_and_starts_target_timer(table):
    act(table, 'join', starter='pest')  # poker = user-alex
    act(table, 'join', user='user-sam', name='Sam', starter='zombie')
    sid = _sid(table)
    doc = db._get_player(table, sid, 'user-sam')
    doc['rolls'] = 0
    db._put_player(table, doc)
    status, resp = act(table, 'poke', targetUserId='user-sam')
    assert status == 200 and resp['granted'] == 1
    sam = db._get_player(table, sid, 'user-sam')
    assert sam['rolls'] == 1
    assert sam.get('pokeCooldownUntil')  # the timer now lives on the target


def test_target_timer_blocks_every_poker(table):
    # The cooldown is on the TARGET: once Sam is poked, nobody (not even a
    # different player) can poke him until it expires.
    act(table, 'join', starter='pest')  # user-alex
    act(table, 'join', user='user-sam', name='Sam', starter='zombie')
    act(table, 'join', user='user-bo', name='Bo', starter='pest')
    status, _ = act(table, 'poke', user='user-alex', name='Alex', targetUserId='user-sam')
    assert status == 200
    status, resp = act(table, 'poke', user='user-bo', name='Bo', targetUserId='user-sam')
    assert status == 429
    assert 'min left' in resp['error']


def test_poke_still_capped_at_roll_cap(table):
    act(table, 'join', starter='pest')  # user-alex
    act(table, 'join', user='user-sam', name='Sam', starter='zombie')
    sid = _sid(table)
    doc = db._get_player(table, sid, 'user-sam')
    doc['rolls'] = data.ROLL_CAP  # already full
    db._put_player(table, doc)
    status, resp = act(table, 'poke', targetUserId='user-sam')
    assert status == 200
    sam = db._get_player(table, sid, 'user-sam')
    assert sam['rolls'] == data.ROLL_CAP  # a poke can't push past the cap


def test_public_player_exposes_poke_timer(table):
    act(table, 'join', starter='pest')  # user-alex
    act(table, 'join', user='user-sam', name='Sam', starter='zombie')
    status, state = db.handle_state(table, {'userId': 'user-alex'})
    sam = next(p for p in state['players'] if p['userId'] == 'user-sam')
    assert sam['pokedRecently'] is False
    assert sam['pokeCooldownUntil'] is None
    act(table, 'poke', targetUserId='user-sam')
    status, state = db.handle_state(table, {'userId': 'user-alex'})
    sam = next(p for p in state['players'] if p['userId'] == 'user-sam')
    assert sam['pokedRecently'] is True
    # The raw timestamp is surfaced while running so the client can render
    # a countdown wheel on the poke button.
    assert sam['pokeCooldownUntil'] > datetime.utcnow().isoformat(timespec='seconds')


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


def _stand_on_umori(table):
    """Join and move the player onto the current Umori node. Returns (sid, doc,
    node); doc is re-fetched so its optimistic `ver` is current for a later put."""
    act(table, 'join', starter='pest')
    sid = _sid(table)
    doc = db._get_player(table, sid, 'user-alex')
    node = db._umori_node(db._umori_window())
    doc['position'] = node
    db._put_player(table, doc)
    return sid, db._get_player(table, sid, 'user-alex'), node


def _t3_fang():
    return next(g for g, v in data.GEAR.items() if v['tier'] == 3 and v['slot'] == 'fang')


def _t3_tome():
    return next(g for g, v in data.GRIMOIRES.items() if v['tier'] == 3)


def _t3_carapace():
    return next(g for g, v in data.GEAR.items() if v['tier'] == 3 and v['slot'] == 'carapace')


def test_umori_pre_seeds_t3_stock(table):
    sid, doc, node = _stand_on_umori(table)
    ev = db._resolve_space(table, sid, doc, node, 'somewhere')
    assert ev['type'] == 'trading_post' and ev['umori'] is True
    assert all(s['foundBy'] == 'the Swarm' for s in ev['stock'])
    for s in ev['stock']:
        defn = data.GEAR.get(s['item']) or data.GRIMOIRES[s['item']]
        assert defn['tier'] == 3


def test_umori_swap_gear(table):
    sid, doc, node = _stand_on_umori(table)
    win = db._umori_window()
    take = _t3_fang()
    table.put_item(Item={'pk': db._season_pk(sid), 'sk': f'POST#UMORI#{win}',
                         'stock': [{'item': take, 'foundBy': 'the Swarm'}]})
    doc['gear'] = {'fang': 'rusted_fang'}
    db._put_player(table, doc)
    status, resp = act(table, 'trade', give='rusted_fang', takeIndex=0)
    assert status == 200
    assert resp['you']['gear']['fang'] == take                 # gave worn fang → slot empty → auto-equipped
    assert take not in (resp['you'].get('gearStash') or [])
    assert resp['stock'][0] == {'item': 'rusted_fang', 'foundBy': 'Alex'}  # old piece left


def test_umori_swap_grimoire_auto_equips(table):
    sid, doc, node = _stand_on_umori(table)
    win = db._umori_window()
    take = _t3_tome()
    table.put_item(Item={'pk': db._season_pk(sid), 'sk': f'POST#UMORI#{win}',
                         'stock': [{'item': take, 'foundBy': 'the Swarm'}]})
    doc['grimoires'] = ['moldering_folio']
    doc['equippedGrimoire'] = 'moldering_folio'
    db._put_player(table, doc)
    status, resp = act(table, 'trade', give='moldering_folio', takeIndex=0)
    assert status == 200
    assert resp['you']['grimoires'] == [take]
    assert resp['you']['equippedGrimoire'] == take
    assert resp['stock'][0] == {'item': 'moldering_folio', 'foundBy': 'Alex'}


def test_umori_rejects_consumable_give(table):
    sid, doc, node = _stand_on_umori(table)
    doc['bag'] = ['healing_moss']
    db._put_player(table, doc)
    status, resp = act(table, 'trade', give='healing_moss', takeIndex=0)
    assert status == 409 and 'gear and grimoires' in resp['error']


def test_umori_rejects_trade_when_not_on_node(table):
    act(table, 'join', starter='pest')
    sid = _sid(table)
    doc = db._get_player(table, sid, 'user-alex')
    other = next(n for n in data.UMORI_NODES if n != db._umori_node(db._umori_window()))
    doc['position'] = other
    doc['gear'] = {'fang': 'rusted_fang'}
    db._put_player(table, doc)
    status, resp = act(table, 'trade', give='rusted_fang', takeIndex=0)
    assert status == 409 and 'Umori is not here' in resp['error']


def test_umori_rejects_out_of_range_take(table):
    sid, doc, node = _stand_on_umori(table)
    doc['gear'] = {'fang': 'rusted_fang'}
    db._put_player(table, doc)
    status, _ = act(table, 'trade', give='rusted_fang', takeIndex=9)
    assert status == 409  # take index out of range


def test_umori_rejects_cross_slot_gear(table):
    sid, doc, node = _stand_on_umori(table)
    win = db._umori_window()
    take = _t3_carapace()
    table.put_item(Item={'pk': db._season_pk(sid), 'sk': f'POST#UMORI#{win}',
                         'stock': [{'item': take, 'foundBy': 'the Swarm'}]})
    doc['gear'] = {'fang': 'rusted_fang'}                       # a fang, not a carapace
    db._put_player(table, doc)
    status, resp = act(table, 'trade', give='rusted_fang', takeIndex=0)
    assert status == 409 and 'same slot' in resp['error']


def test_umori_rejects_cross_kind(table):
    sid, doc, node = _stand_on_umori(table)
    win = db._umori_window()
    take = _t3_tome()                                          # a grimoire line
    table.put_item(Item={'pk': db._season_pk(sid), 'sk': f'POST#UMORI#{win}',
                         'stock': [{'item': take, 'foundBy': 'the Swarm'}]})
    doc['gear'] = {'fang': 'rusted_fang'}                      # offering gear for a grimoire
    db._put_player(table, doc)
    status, resp = act(table, 'trade', give='rusted_fang', takeIndex=0)
    assert status == 409 and 'grimoire' in resp['error']


def test_umori_gives_from_stash(table):
    sid, doc, node = _stand_on_umori(table)
    win = db._umori_window()
    take = _t3_fang()
    table.put_item(Item={'pk': db._season_pk(sid), 'sk': f'POST#UMORI#{win}',
                         'stock': [{'item': take, 'foundBy': 'the Swarm'}]})
    doc['gear'] = {}                                           # nothing equipped
    doc['gearStash'] = ['rusted_fang']                         # a stashed fang qualifies
    db._put_player(table, doc)
    status, resp = act(table, 'trade', give='rusted_fang', takeIndex=0)
    assert status == 200
    assert 'rusted_fang' not in (resp['you'].get('gearStash') or [])  # removed from stash
    assert resp['you']['gear']['fang'] == take                 # fang slot was empty → auto-equipped
    assert resp['stock'][0] == {'item': 'rusted_fang', 'foundBy': 'Alex'}


def test_state_reports_umori_traded_flag(table):
    sid, doc, node = _stand_on_umori(table)
    win = db._umori_window()
    # Before trading: traded is False.
    _, state = db.handle_state(table, {'userId': 'user-alex'})
    assert state['umori']['traded'] is False
    # After marking this window traded: True.
    doc = db._get_player(table, sid, 'user-alex')
    doc['umoriTradedWindow'] = win
    db._put_player(table, doc)
    _, state = db.handle_state(table, {'userId': 'user-alex'})
    assert state['umori']['traded'] is True


def test_umori_one_barter_per_rotation(table):
    sid, doc, node = _stand_on_umori(table)
    win = db._umori_window()
    take = _t3_fang()
    table.put_item(Item={'pk': db._season_pk(sid), 'sk': f'POST#UMORI#{win}',
                         'stock': [{'item': take, 'foundBy': 'the Swarm'}]})
    doc['gear'] = {'fang': 'rusted_fang'}
    db._put_player(table, doc)
    status, _ = act(table, 'trade', give='rusted_fang', takeIndex=0)
    assert status == 200
    # second trade this window is blocked
    d2 = db._get_player(table, sid, 'user-alex')
    d2['gear'] = {'fang': 'bloodfang'}
    db._put_player(table, d2)
    status, resp = act(table, 'trade', give='bloodfang', takeIndex=0)
    assert status == 409 and 'already bartered' in resp['error']
    # a later window lets them barter again
    d3 = db._get_player(table, sid, 'user-alex')
    d3['umoriTradedWindow'] = win - 1                          # simulate an older stop
    d3['gear'] = {'fang': 'bloodfang'}
    db._put_player(table, d3)
    status, _ = act(table, 'trade', give='bloodfang', takeIndex=0)
    assert status == 200


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
    # Clearing a dig site pays a crafting-material cache (the ichor/molting tap).
    assert resp['materials'] == {'ichor': data.EXCAVATION_CLEAR_ICHOR,
                                 'moltings': data.EXCAVATION_CLEAR_MOLTINGS}
    assert resp['you']['materials']['ichor'] >= data.EXCAVATION_CLEAR_ICHOR


def test_excavation_full_bag_auto_lists_find(table):
    act(table, 'join', starter='pest')
    sid = _sid(table)
    site = {'w': 5, 'h': 5, 'revealed': [],
            'items': [{'shape': '1x2', 'cells': [[0, 0], [0, 1]],
                       'loot': {'kind': 'item', 'item': 'healing_moss'},
                       'collected': False, 'by': None}]}
    doc = db._get_player(table, sid, 'user-alex')
    doc['position'] = 'bone_i0'
    doc['excavationDigsLeft'] = data.EXCAVATION_DIGS_PER_VISIT
    doc['bag'] = ['snare', 'snare', 'snare']          # BAG_SIZE = 3 → full
    db._put_player(table, doc)
    db._save_dig_site(table, sid, 'bone_i0', site)

    act(table, 'dig', r=0, c=0)                        # partial
    status, resp = act(table, 'dig', r=0, c=1)         # completes → bag full
    assert status == 200
    # The find is auto-listed, not dropped into the (full) bag.
    assert resp['found']['kind'] == 'listed'
    assert resp['found']['item'] == 'healing_moss'
    assert resp['found']['price'] == data.CONSUMABLES['healing_moss']['cost']  # mid = base cost
    assert resp['you']['bag'] == ['snare', 'snare', 'snare']  # bag untouched
    assert db._market_listing_count(table, sid, 'user-alex') == 1


def test_excavation_full_bag_salvages_when_market_full(table):
    act(table, 'join', starter='pest')
    sid = _sid(table)
    site = {'w': 5, 'h': 5, 'revealed': [],
            'items': [{'shape': '1x2', 'cells': [[0, 0], [0, 1]],
                       'loot': {'kind': 'item', 'item': 'healing_moss'},
                       'collected': False, 'by': None}]}
    doc = db._get_player(table, sid, 'user-alex')
    doc['position'] = 'bone_i0'
    doc['excavationDigsLeft'] = data.EXCAVATION_DIGS_PER_VISIT
    doc['bag'] = ['snare', 'snare', 'snare']
    db._put_player(table, doc)
    db._save_dig_site(table, sid, 'bone_i0', site)
    for _ in range(data.MARKET_MAX_LISTINGS):          # no market room left
        db._create_market_listing(table, sid, doc, 'consumable', 'snare', 5)

    act(table, 'dig', r=0, c=0)
    status, resp = act(table, 'dig', r=0, c=1)
    assert status == 200
    assert resp['found']['kind'] == 'spores' and resp['found']['bagFull'] is True


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


def test_customize_allows_keeping_an_unowned_worn_hue(table):
    # Simulate a player already wearing an un-owned shell hue (an old veteran who
    # hatched via the ungated shell picker): body/stripes = violet(270), which is
    # NOT in their owned paints (defaults forest+gold only).
    act(table, 'join', starter='pest')
    sid = _sid(table)
    doc = db._get_player(table, sid, 'user-alex')
    doc['paint'] = {'body': 270, 'belly': 50, 'stripes': 270}
    table.put_item(Item=doc)

    # Recolor body to an OWNED color; stripes stays 270 (unchanged) — must succeed.
    status, resp = act(table, 'customize',
                       paint={'body': 130, 'belly': 50, 'stripes': 270})
    assert status == 200
    assert resp['you']['paint']['body'] == 130
    assert resp['you']['paint']['stripes'] == 270

    # Switching a region TO a new un-owned color is still rejected.
    status, resp = act(table, 'customize',
                       paint={'body': 0, 'belly': 50, 'stripes': 270})
    assert status == 409


def test_join_grants_veteran_rolled_shell_color_as_owned(table):
    # A veteran (1+ seals) hatches with a rolled shell hue; that catalog color is
    # granted as an owned paint, so they can recolor to/from it freely.
    perm = db._get_perm(table, 'user-vet')
    perm['seals'] = 2
    table.put_item(Item=perm)

    status, resp = act(table, 'join', user='user-vet', name='Vet',
                       starter='zombie', eggHue=270)  # 270 = violet
    assert status == 200
    assert resp['you']['paint']['body'] == 270

    perm2 = db._get_perm(table, 'user-vet')
    assert 'violet' in perm2['paints']  # rolled color now owned

    # And they can recolor stripes to that owned violet.
    status, resp = act(table, 'customize', user='user-vet', name='Vet',
                       paint={'body': 270, 'belly': 50, 'stripes': 270})
    assert status == 200
    assert resp['you']['paint']['stripes'] == 270


def test_join_non_veteran_grants_no_shell_color(table):
    # A first-time player hatches forest(130, a default) and gets no extra grant.
    act(table, 'join', user='user-new', name='New', starter='pest', eggHue=270)
    perm = db._get_perm(table, 'user-new')
    # Only the defaults — the eggHue was ignored for a non-veteran, no bonus paint.
    assert set(perm['paints']) == set(data.DEFAULT_PAINTS)


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


def test_join_stores_and_exposes_valid_sprite_variant(table):
    status, resp = act(table, 'join', starter='pest', home='city', spriteVariant='pest_2')
    assert status == 200
    assert resp['you']['spriteVariant'] == 'pest_2'
    _, state = db.handle_state(table, {'userId': 'user-alex'})
    pub = {p['userId']: p for p in state['players']}['user-alex']
    assert pub['spriteVariant'] == 'pest_2'


def test_join_rejects_unknown_sprite_variant(table):
    # A variant that isn't this starter's alt falls back to the base look:
    # the field is not stored.
    status, resp = act(table, 'join', starter='zombie', spriteVariant='pest_2')
    assert status == 200
    assert resp['you'].get('spriteVariant') is None


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


# ── Status bubble ────────────────────────────────────────────────────────────

def test_set_status_persists_normalized(table):
    act(table, 'join', starter='saproling', home='cavern')
    status, resp = act(table, 'set-status', status='Farming spores')
    assert status == 200
    assert resp['you']['status'] == 'Farming spores'
    # Survives a state read.
    _, state = db.handle_state(table, {'userId': 'user-alex'})
    assert state['you']['status'] == 'Farming spores'


def test_set_status_truncates_and_collapses_whitespace(table):
    act(table, 'join', starter='saproling', home='cavern')
    status, resp = act(table, 'set-status',
                       status='  hello\n\tworld   this is way too long to fit  ')
    assert status == 200
    saved = resp['you']['status']
    # Collapsed to single spaces + trimmed = "hello world this is way too long to fit",
    # then capped at 24 chars -> "hello world this is way " (trailing space, len 24).
    assert saved == 'hello world this is way '
    assert len(saved) == 24
    assert '\n' not in saved and '\t' not in saved


def test_set_status_empty_clears(table):
    act(table, 'join', starter='saproling', home='cavern')
    act(table, 'set-status', status='temp')
    status, resp = act(table, 'set-status', status='   ')
    assert status == 200
    assert resp['you']['status'] == ''


def test_status_visible_in_peer_roster(table):
    # Alex and Bea both join; Bea sees Alex's status in the players roster.
    act(table, 'join', user='user-alex', name='Alex', starter='saproling', home='cavern')
    act(table, 'join', user='user-bea', name='Bea', starter='pest', home='bone')
    act(table, 'set-status', user='user-alex', name='Alex', status='Come fight me')
    _, state = db.handle_state(table, {'userId': 'user-bea'})
    alex = next(p for p in state['players'] if p['userId'] == 'user-alex')
    assert alex['status'] == 'Come fight me'


# ── Plaza chat ───────────────────────────────────────────────────────────────

def test_chat_posts_and_reads_back(table):
    act(table, 'join', user='user-alex', name='Alex', starter='saproling', home='cavern')
    act(table, 'join', user='user-bea', name='Bea', starter='pest', home='bone')
    status, resp = act(table, 'chat', text='hello swamp')
    assert status == 200
    msg = resp['chat']
    assert msg['text'] == 'hello swamp'
    assert msg['userId'] == 'user-alex' and msg['username'] == 'Alex'
    assert msg['id'] and msg['ts']
    # Bea sees it in her state fetch.
    _, state = db.handle_state(table, {'userId': 'user-bea'})
    assert [m['text'] for m in state['chat']] == ['hello swamp']
    assert state['chat'][0]['username'] == 'Alex'
    assert 'pk' not in state['chat'][0] and 'sk' not in state['chat'][0]


def test_chat_mirrors_into_grapevine(table):
    # Every chat message also lands in the EVENT# log, so it shows up in the
    # board event feed / log tab alongside the other game notifications.
    act(table, 'join', starter='saproling', home='cavern')
    act(table, 'chat', text='hello swamp')
    _, state = db.handle_state(table, {'userId': 'user-alex'})
    ev = next(e for e in state['events'] if e['type'] == 'chat')
    assert ev['text'] == 'Alex: hello swamp'
    assert ev['actor'] == 'user-alex'


def test_chat_normalizes_and_caps(table):
    act(table, 'join', starter='saproling', home='cavern')
    status, resp = act(table, 'chat', text='  a\n\t b  ' + 'x' * 300)
    assert status == 200
    saved = resp['chat']['text']
    assert saved.startswith('a b')
    assert len(saved) == db.CHAT_MAX_LEN
    assert '\n' not in saved and '\t' not in saved


def test_chat_rejects_empty(table):
    act(table, 'join', starter='saproling', home='cavern')
    status, _ = act(table, 'chat', text='   \n ')
    assert status == 400


def test_chat_requires_join(table):
    status, _ = act(table, 'chat', text='hi')
    assert status == 409


def test_chat_allowed_during_battle(table):
    # Chat is a meta action like set-status: a pending fight must not gag you.
    act(table, 'join', starter='saproling', home='cavern')
    sid = _sid(table)
    doc = db._get_player(table, sid, 'user-alex')
    doc['battle'] = {'kind': 'wild'}
    db._put_player(table, doc)
    status, _ = act(table, 'chat', text='send help')
    assert status == 200


def test_chat_state_caps_at_newest_50_chronological(table):
    act(table, 'join', starter='saproling', home='cavern')
    pk = db._season_pk(_sid(table))
    # Seed 55 messages directly with ISO-ms timestamps (the real writer's
    # format) so string-ordered sks match chronological order.
    for i in range(55):
        ts = f'2026-07-31T00:00:00.{i:03d}'
        table.put_item(Item={'pk': pk, 'sk': f'CHAT#{ts}#{i:06x}',
                             'id': f'{ts}#{i:06x}', 'userId': 'user-alex',
                             'username': 'Alex', 'text': f'm{i}', 'ts': ts})
    _, state = db.handle_state(table, {'userId': 'user-alex'})
    texts = [m['text'] for m in state['chat']]
    assert len(texts) == 50
    # Oldest 5 dropped; the rest arrive oldest-first for straight rendering.
    assert texts[0] == 'm5' and texts[-1] == 'm54'


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


def test_depths_wild_is_tier2(table, monkeypatch):
    sid, doc = _player_at(table, 'city_d1')  # a depths (dungeon) wild space
    # Force a signature MISS so this exercises the flat tier-2 pool (the boss
    # familiar path is covered by test_boss_area_signature_spawns_themed_minion).
    monkeypatch.setattr(db._rng, 'random', lambda: 0.99)
    ev = db._wild_battle(table, sid, doc)
    assert ev['type'] == 'battle_start'
    assert ev['npc']['id'] in {n['id'] for n in data.DEPTHS_MID}
    se = _finish_started_battle(table, monkeypatch, doc, 'attacker')
    assert se['spores'] >= min(n['bounty'] for n in data.DEPTHS_MID)


def test_bone_chill_consumed_by_next_battle(table, monkeypatch):
    sid, doc = _player_at(table, 'city_r1', buffs=[{'kind': 'bone_chill'}])
    db._wild_battle(table, sid, doc)                 # start (buff frozen into rec)
    _finish_started_battle(table, monkeypatch, doc, 'attacker')
    fresh = db._get_player(table, sid, 'user-alex')
    assert not any(b.get('kind') == 'bone_chill' for b in fresh.get('buffs', []))


def test_webbing_snares_two_rolls_and_bleeds(table):
    sid, doc = _player_at(table, 'city_d1')          # pest hp 25
    out = db._hazard(table, sid, doc, 'city_d1')
    assert out['hazardId'] == 'webbing'
    vines = [b for b in doc['buffs'] if b.get('kind') == 'vines']
    assert vines and vines[0].get('turns') == 2      # a two-roll snare
    assert doc['hp'] == 25 - 2                        # round(25*0.10) = 2 HP bleed
    assert out['hp'] == -2


def test_spore_cloud_teleports_and_bleeds(table):
    sid, doc = _player_at(table, 'cavern_a1')         # pest hp 25
    out = db._hazard(table, sid, doc, 'cavern_a1')
    assert out['hazardId'] == 'spore_cloud'
    assert doc['position'] != 'cavern_a1'
    assert data.MAP_NODES[doc['position']].get('region') == 'depths'
    assert doc['position'].startswith('cavern_')
    assert doc['hp'] == 25 - 4                         # round(25*0.15) = 4 HP burst
    assert out['hp'] == -4


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
    monkeypatch.setattr(db._rng, 'random', lambda: 0.99)  # miss the ambient 10%
    out = db._resolve_space(table, sid, doc, other, other)
    assert out['type'] == 'warp'
    assert 'options' in out and out['options']
    assert doc['position'] == other


def test_sinkwater_takes_25_pct_spores_and_hp(table):
    sid, doc = _player_at(table, 'bog_m1', spores=100)   # pest hp 25
    out = db._hazard(table, sid, doc, 'bog_m1')
    assert out['hazardId'] == 'sinkwater'
    assert doc['spores'] == 75                            # ceil(100*0.25) = 25 lost
    assert doc['hp'] == 25 - 3                            # round(25*0.12) = 3 HP


def test_sinkwater_mirefoot_halved(table):
    sid, doc = _player_at(table, 'bog_m1', spores=100, homeBiome='bog')
    db._hazard(table, sid, doc, 'bog_m1')
    assert doc['spores'] == 88   # ceil(100*0.25)=25, Mirefoot halves -> 12 lost
    assert doc['hp'] == 25 - 2   # round(25*0.06)=2 (Mirefoot halves the HP too)


def test_bone_chill_applies_grave_chill(table):
    sid, doc = _player_at(table, 'bone_g11')             # pest hp 25
    out = db._hazard(table, sid, doc, 'bone_g11')
    assert out['hazardId'] == 'bone_chill'
    assert any(b.get('kind') == 'grave_chill' for b in doc['buffs'])
    assert doc['hp'] == 25 - 8                            # 8 HP grave-cold


def test_rot_bloom_trades_hp_for_spores(table):
    sid, doc = _player_at(table, 'garden_m2', spores=10)
    hp_before = doc['hp']
    out = db._hazard(table, sid, doc, 'garden_m2')
    assert out['hazardId'] == 'rot_bloom'
    # pest base DEF 5 is below the DEF-6 Thick Hide node, so it takes full HP loss.
    assert doc['hp'] == hp_before - 15
    assert doc['spores'] == 22


def test_rot_bloom_never_kills(table):
    sid, doc = _player_at(table, 'garden_m2', hp=2)
    db._hazard(table, sid, doc, 'garden_m2')
    assert doc['hp'] == 1


def test_surface_hazard_unchanged(table, monkeypatch):
    # A ring hazard still rolls the generic table (no hazardId key). Miss the
    # lucky slice so the generic effect actually resolves.
    sid, doc = _player_at(table, 'city_r4')
    monkeypatch.setattr(db._rng, 'random', lambda: 0.99)
    out = db._hazard(table, sid, doc, 'city_r4')
    assert out['type'] == 'hazard' and 'hazardId' not in out


def test_surface_hazard_stamps_outcome(table, monkeypatch):
    # Each generic surface hazard reports which effect rolled, so the client
    # wheel can land on it truthfully. Miss the lucky slice first (random 0.99).
    monkeypatch.setattr(db._rng, 'random', lambda: 0.99)
    for kind in ('swamp_gas', 'vines', 'spore_cloud'):
        sid, doc = _player_at(table, 'city_r4', spores=50)
        monkeypatch.setattr(db._rng, 'choice', lambda seq, k=kind: k)
        out = db._hazard(table, sid, doc, 'city_r4')
        assert out['hazardOutcome'] == kind


def test_dungeon_hazard_stamps_biome(table):
    # Signature hazards report their pocket's biome so the wheel picks the right
    # lair-boss silhouette (position may be mutated by spore_cloud).
    for biome, node in (('city', 'city_d1'), ('cavern', 'cavern_a1'),
                        ('bog', 'bog_m1'), ('bone', 'bone_g11'),
                        ('garden', 'garden_m2')):
        sid, doc = _player_at(table, node, spores=50)
        out = db._hazard(table, sid, doc, node)
        assert out['biome'] == biome
        assert 'hazardOutcome' not in out


def test_surface_hazard_lucky_avoid(table, monkeypatch):
    # random()=0.0 < HAZARD_LUCKY_AVOID -> the baseline lucky fizzle fires for
    # ANYONE (this pest has no Thick Hide), no harm, flavoured 'lucky'.
    sid, doc = _player_at(table, 'city_r4', spores=50)
    doc['hp'] = 25
    monkeypatch.setattr(db._rng, 'random', lambda: 0.0)
    out = db._hazard(table, sid, doc, 'city_r4')
    assert out['hazardAvoid'] == 'lucky'
    assert out['hazardOutcome'] == 'safe'
    assert 'hazardPerk' not in out                       # pest: no resist teases
    assert doc['hp'] == 25 and doc['spores'] == 50       # nothing applied
    assert not doc.get('buffs')


def test_surface_hazard_resisted_by_thick_hide(table, monkeypatch):
    # def 8 -> thick_hide. random()=0.10 misses the lucky slice (0.08) but lands
    # inside the stacked resist band (0.08 + 0.19), so Thick Hide turns it aside.
    sid, doc = _player_at(table, 'city_r4')
    doc['def'] = 8
    doc['hp'] = 25
    doc['spores'] = 50
    monkeypatch.setattr(db._rng, 'random', lambda: 0.10)
    out = db._hazard(table, sid, doc, 'city_r4')
    assert out['hazardAvoid'] == 'resist'
    assert out['hazardPerk'] is True
    assert out['hazardOutcome'] == 'safe'
    assert doc['hp'] == 25 and doc['spores'] == 50      # nothing applied
    assert not doc.get('buffs')                          # no vines etc.


def test_surface_hazard_hit_flags_perk_for_teases(table, monkeypatch):
    # Same creature, but both avoids miss (0.99): today's effect lands AND the
    # event carries hazardPerk so the wheel still shows the resist tease wedges.
    sid, doc = _player_at(table, 'city_r4')
    doc['def'] = 8
    monkeypatch.setattr(db._rng, 'random', lambda: 0.99)
    monkeypatch.setattr(db._rng, 'choice', lambda seq: 'spore_cloud')
    out = db._hazard(table, sid, doc, 'city_r4')
    assert out['hazardPerk'] is True
    assert 'hazardAvoid' not in out
    assert out['hazardOutcome'] == 'spore_cloud'
    assert out['hp'] < 0                                 # HP was actually lost


def test_surface_hazard_no_perk_no_perk_field(table, monkeypatch):
    # Pest (def 5): missing the lucky slice leaves a plain hazard, no perk flag.
    sid, doc = _player_at(table, 'city_r4')
    monkeypatch.setattr(db._rng, 'random', lambda: 0.99)   # miss the lucky slice
    monkeypatch.setattr(db._rng, 'choice', lambda seq: 'vines')
    out = db._hazard(table, sid, doc, 'city_r4')
    assert 'hazardPerk' not in out
    assert 'hazardAvoid' not in out
    assert out['hazardOutcome'] == 'vines'


def test_dungeon_hazard_resisted_by_thick_hide(table, monkeypatch):
    # def 8 -> thick_hide; dungeon chance 0.095, random()=0.0 always resists.
    sid, doc = _player_at(table, 'city_d1')   # webbing lair hazard
    doc['def'] = 8
    doc['hp'] = 25
    monkeypatch.setattr(db._rng, 'random', lambda: 0.0)
    out = db._hazard(table, sid, doc, 'city_d1')
    assert out['hazardAvoid'] == 'resist'
    assert out['hazardPerk'] is True
    assert out['biome'] == 'city'
    assert doc['hp'] == 25                     # no bleed
    assert not any(b.get('kind') == 'vines' for b in doc.get('buffs', []))


def test_dungeon_has_no_lucky_avoid(table, monkeypatch):
    # The depths carry NO baseline lucky fizzle: a pest that would trip the lucky
    # slice on the surface still eats the full lair hazard here.
    sid, doc = _player_at(table, 'city_d1')    # pest, def 5
    monkeypatch.setattr(db._rng, 'random', lambda: 0.0)
    out = db._hazard(table, sid, doc, 'city_d1')
    assert 'hazardAvoid' not in out
    assert out['hazardId'] == 'webbing'


def test_dungeon_resist_uses_reduced_chance(table, monkeypatch):
    # random()=0.15 would resist at the surface chance (0.19) but NOT the dungeon
    # chance (0.095) — proving the dungeon halving is applied.
    sid, doc = _player_at(table, 'city_d1')
    doc['def'] = 8
    doc['hp'] = 25
    monkeypatch.setattr(db._rng, 'random', lambda: 0.15)
    out = db._hazard(table, sid, doc, 'city_d1')
    assert 'hazardAvoid' not in out            # not resisted in the depths
    assert out['hazardPerk'] is True           # perk present -> tease flag
    assert out['hazardId'] == 'webbing'        # today's effect landed


def test_dungeon_hazard_no_perk_no_perk_field(table):
    sid, doc = _player_at(table, 'city_d1')    # pest, def 5
    out = db._hazard(table, sid, doc, 'city_d1')
    assert 'hazardPerk' not in out
    assert 'hazardAvoid' not in out
    assert out['hazardId'] == 'webbing'


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


def test_vein_cave_in_hurts_but_shaft_holds(table, monkeypatch):
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
    assert resp['depth'] == 9                              # shaft holds at its prior depth
    doc = db._get_player(table, sid, 'user-alex')
    assert doc['hp'] == max(1, hp_before - 10 * data.VEIN_CAVE_IN_DMG_PER_LEVEL)
    assert doc['veinStrikesLeft'] == 0                     # the visit still ends
    rec = db._get(table, db._season_pk(sid), 'VEIN#cavern')
    assert rec['depth'] == 9                               # NOT reset — progress is kept


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
    spores_before = db._get_player(table, sid, 'user-alex').get('spores', 0)
    monkeypatch.setattr(db._rng, 'random', lambda: 1.0)     # never cave in
    status, resp = act(table, 'strike')
    assert status == 200
    assert resp['depth'] == 4 and resp['strikesLeft'] == 1
    # Mining pays NO Spores — materials only. Nothing is added and no 'spores' key.
    assert resp['you']['spores'] == spores_before and 'spores' not in resp
    # Every strike pays Moltings; ichor is a roll (random()==1.0 here → none).
    assert resp['moltings'] == data.VEIN_MOLTINGS_PER_STRIKE and resp['ichor'] == 0
    assert db._materials(db._get_player(table, sid, 'user-alex'))['moltings'] >= 1

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
    # Mining pays NO Spores — even the Heartstone is materials + a rare find only.
    assert resp['you']['spores'] == spores_before and 'spores' not in resp
    assert resp['you']['bag'] and resp['you']['bag'][0] in data.VEIN_RARE_ITEMS
    # The Heartstone pays its Ichor jackpot (random()==1.0 → strike roll adds 0).
    assert resp['ichor'] == data.VEIN_HEARTSTONE_ICHOR
    assert db._materials(db._get_player(table, sid, 'user-alex'))['ichor'] >= data.VEIN_HEARTSTONE_ICHOR
    rec = db._get(table, db._season_pk(sid), 'VEIN#cavern')
    assert rec['depth'] == 0


def test_vein_strike_rolls_ichor_on_a_hit(table, monkeypatch):
    """A surviving strike rolls a Gemstone (internal key 'ichor'), scaling with depth. Entering
    level 6 the cave-in threshold is 0.24 and the ichor threshold 0.38, so a
    constant random()==0.3 both survives the shaft and grants the ichor."""
    act(table, 'join', starter='pest')
    sid = _sid(table)
    doc = db._get_player(table, sid, 'user-alex')
    doc['position'] = 'cavern_r3'
    doc['veinStrikesLeft'] = 1
    db._put_player(table, doc)
    db._save_vein(table, sid, 'cavern', 5)                 # entering level 6
    monkeypatch.setattr(db._rng, 'random', lambda: 0.3)
    status, resp = act(table, 'strike')
    assert status == 200 and not resp.get('collapsed')
    assert resp['ichor'] == 1 and resp['moltings'] == data.VEIN_MOLTINGS_PER_STRIKE
    assert db._materials(db._get_player(table, sid, 'user-alex'))['ichor'] >= 1


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


def test_buy_charm_auto_equips_empty_slot(table):
    sid, node = _at_shop(table, spores=500)
    _seed_shop(table, sid, node, gear=[{'item': 'quartz_charm', 'qty': 2}])
    doc = db._get_player(table, sid, 'user-alex')
    doc['gear'] = {}                                    # ensure the charm slot is empty
    db._put_player(table, doc)
    status, resp = act(table, 'buy', itemId='quartz_charm')
    assert status == 200, resp
    doc = db._get_player(table, sid, 'user-alex')
    assert (doc.get('gear') or {}).get('charm') == 'quartz_charm'
    assert 'quartz_charm' not in (doc.get('gearStash') or [])


def test_buy_gear_stalls_when_stash_full(table):
    sid, node = _at_shop(table, spores=500)
    _seed_shop(table, sid, node, gear=[{'item': 'rusted_fang', 'qty': 2}])
    doc = db._get_player(table, sid, 'user-alex')
    doc['gear'] = {'fang': 'bloodfang'}                 # fang slot filled → buy must stash
    doc['gearStash'] = ['rusted_fang'] * data.GEAR_STASH_SIZE
    db._put_player(table, doc)
    before = db._get_player(table, sid, 'user-alex')['spores']
    status, resp = act(table, 'buy', itemId='rusted_fang')
    assert status == 409 and 'stash is full' in resp['error'].lower()
    # Stalled: no Spores spent, stock not depleted.
    assert db._get_player(table, sid, 'user-alex')['spores'] == before


def test_buy_gear_auto_equips_empty_slot_even_with_full_stash(table):
    sid, node = _at_shop(table, spores=500)
    _seed_shop(table, sid, node, gear=[{'item': 'quartz_charm', 'qty': 2}])
    doc = db._get_player(table, sid, 'user-alex')
    doc['gear'] = {}                                    # charm slot empty…
    doc['gearStash'] = ['rusted_fang'] * data.GEAR_STASH_SIZE  # …but stash full
    db._put_player(table, doc)
    status, resp = act(table, 'buy', itemId='quartz_charm')
    assert status == 200
    assert (resp['you'].get('gear') or {}).get('charm') == 'quartz_charm'


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
    side = {'rot_stacks': 3, 'buffs': ['harden_shell', 'weaken_hex'],
            'statDelta': {'atk': -3, 'def': 2, 'spd': 0}}
    assert db._battle_status(side) == {
        'rot': 3, 'buffs': ['harden_shell', 'weaken_hex'],
        'delta': {'atk': -3, 'def': 2, 'spd': 0}}


def test_battle_status_defaults_empty():
    assert db._battle_status({}) == {
        'rot': 0, 'buffs': [], 'delta': {'atk': 0, 'def': 0, 'spd': 0}}


def test_high_five_buff_adds_one_to_three_stats():
    doc = {'atk': 5, 'def': 4, 'spd': 3, 'maxHp': 20, 'gear': {},
           'buffs': [{'kind': 'high_five'}]}
    eff = engine.effective_stats(doc)
    base = engine.effective_stats({**doc, 'buffs': []})
    assert eff['atk'] - base['atk'] == 1
    assert eff['def'] - base['def'] == 1
    assert eff['spd'] - base['spd'] == 1


def test_high_five_is_consumed_after_one_battle():
    doc = {'buffs': [{'kind': 'high_five'}, {'kind': 'cursed_idol'}]}
    db._consume_one_battle_buffs(doc)
    kinds = [b['kind'] for b in doc['buffs']]
    assert 'high_five' not in kinds
    assert 'cursed_idol' in kinds  # timed curse survives; only one-battle buffs clear


def _colocate(table, sid, host='user-alex', guest='user-sam'):
    """Move `guest` onto `host`'s node and return that node id."""
    h = db._get_player(table, sid, host)
    g = db._get_player(table, sid, guest)
    g['position'] = h['position']
    db._put_player(table, g)
    return h['position']


def test_high_five_grants_buff_same_space(table):
    act(table, 'join', starter='pest')                      # user-alex
    act(table, 'join', user='user-sam', name='Sam', starter='zombie')
    sid = _sid(table)
    _colocate(table, sid)
    status, resp = act(table, 'high-five', targetUserId='user-sam')
    assert status == 200
    sam = db._get_player(table, sid, 'user-sam')
    assert any(b['kind'] == 'high_five' for b in sam['buffs'])
    assert any(e['kind'] == 'high_five' and e['fromId'] == 'user-alex'
               for e in sam['awayEvents'])


def test_high_five_off_space_rejected(table):
    act(table, 'join', starter='pest')
    act(table, 'join', user='user-sam', name='Sam', starter='zombie')
    sid = _sid(table)
    sam = db._get_player(table, sid, 'user-sam')
    sam['position'] = 'NOWHERE'   # any node != the giver's exercises the reject path
    db._put_player(table, sam)
    status, resp = act(table, 'high-five', targetUserId='user-sam')
    assert status == 400
    assert 'space' in resp['error']


def test_high_five_same_target_on_cooldown(table):
    act(table, 'join', starter='pest')
    act(table, 'join', user='user-sam', name='Sam', starter='zombie')
    sid = _sid(table)
    _colocate(table, sid)
    status, _ = act(table, 'high-five', targetUserId='user-sam')
    assert status == 200
    status, resp = act(table, 'high-five', targetUserId='user-sam')
    assert status == 429
    assert 'min left' in resp['error']


def _set_pending_move(table, sid, value, user='user-alex'):
    """Give the giver a mid-walk pending move of `value` steps."""
    doc = db._get_player(table, sid, user)
    doc['pendingMove'] = {'value': value, 'dests': []}
    db._put_player(table, doc)


def _place(table, sid, node, user='user-sam'):
    p = db._get_player(table, sid, user)
    p['position'] = node
    db._put_player(table, p)


def test_high_five_mid_walk_at_node(table):
    """Passing a creature mid-walk: an atNode within the roll grants the buff even
    though the giver's server position lags at the walk origin."""
    act(table, 'join', starter='pest')
    act(table, 'join', user='user-sam', name='Sam', starter='zombie')
    sid = _sid(table)
    alex = db._get_player(table, sid, 'user-alex')
    origin = alex['position']
    nodes = db._season_map(table, sid)
    neighbor = nodes[origin]['neighbors'][0]
    _place(table, sid, neighbor)            # Sam is one step up the walk
    _set_pending_move(table, sid, 2)        # Alex is mid-roll, can reach it
    status, resp = act(table, 'high-five', targetUserId='user-sam', atNode=neighbor)
    assert status == 200
    sam = db._get_player(table, sid, 'user-sam')
    assert any(b['kind'] == 'high_five' for b in sam['buffs'])


def test_high_five_at_node_target_not_there_rejected(table):
    """atNode names a node the target isn't standing on → rejected."""
    act(table, 'join', starter='pest')
    act(table, 'join', user='user-sam', name='Sam', starter='zombie')
    sid = _sid(table)
    alex = db._get_player(table, sid, 'user-alex')
    origin = alex['position']
    nodes = db._season_map(table, sid)
    neighbor = nodes[origin]['neighbors'][0]
    # Sam stays put at origin; we claim to be passing `neighbor`.
    _place(table, sid, origin)
    _set_pending_move(table, sid, 2)
    status, resp = act(table, 'high-five', targetUserId='user-sam', atNode=neighbor)
    assert status == 400
    assert 'space' in resp['error']


def test_high_five_at_node_out_of_reach_rejected(table):
    """atNode beyond the roll's reach → rejected even if the target is on it."""
    act(table, 'join', starter='pest')
    act(table, 'join', user='user-sam', name='Sam', starter='zombie')
    sid = _sid(table)
    alex = db._get_player(table, sid, 'user-alex')
    origin = alex['position']
    nodes = db._season_map(table, sid)
    # Find a node at least 3 hops away, then hand out a 1-step roll.
    far = next(
        nid for nid in nodes
        if (d := engine.board_distance(nodes, origin, nid, 6)) is not None and d >= 3
    )
    _place(table, sid, far)
    _set_pending_move(table, sid, 1)
    status, resp = act(table, 'high-five', targetUserId='user-sam', atNode=far)
    assert status == 400
    assert 'space' in resp['error']


def test_start_battle_includes_status(table, monkeypatch):
    monkeypatch.setattr(db, '_rng', _ZeroRng())
    act(table, 'join', starter='kraul')
    sid = _sid(table)
    ev = _begin(table, sid)
    zero = {'atk': 0, 'def': 0, 'spd': 0}
    assert ev['playerStatus'] == {'rot': 0, 'buffs': [], 'delta': zero}
    assert ev['npcStatus'] == {'rot': 0, 'buffs': [], 'delta': zero}


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
        + list(data.WILDERNESS_NPCS) + list(data.WILDERNESS_ELITE_NPCS) \
        + list(data.DEPTHS_MID) + list(data.DEPTHS_DEEP) + list(data.DEPTHS_ABYSS) \
        + list(data.ISLE_APEX) \
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


def test_reads_no_longer_monopolised_by_spd():
    # A high-SPD build reads better but nowhere near the old ~48% at SPD 15, and
    # the cap holds below the old 0.90.
    base = {'atk': 6, 'def': 6, 'spd': 15}
    chance = db._read_chance(base)
    assert chance == data.READ_BASE + data.READ_SPD_COEFF * 15      # 0.25 + 0.12 = 0.37
    assert chance < 0.40
    # Nothing can exceed the tightened cap.
    assert db._read_chance({'atk': 0, 'def': 0, 'spd': 999}) == data.READ_MAX == 0.80


def test_bosses_and_guardians_bluff_enough_to_resist_feint_spam():
    # A telegraphing turtle can't be blindly hard-countered every round.
    for spec in data.LAIR_BOSSES.values():
        assert spec['bluff'] >= 0.35, spec['name']
    for spec in data.BARRIER_GUARDIANS.values():
        assert spec['bluff'] >= 0.30, spec['name']


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
    node = next(n for n, v in data.MAP_NODES.items()
                if v['type'] == 'shop' and n not in data.ISLAND_BAZAAR_NODES)
    stock = db._gen_shop_stock(node, 100)

    # Gear: SHOP_GEAR_SLOTS lines, all valid, spread across distinct slots.
    assert len(stock['gear']) == data.SHOP_GEAR_SLOTS
    slots = [data.GEAR[e['item']]['slot'] for e in stock['gear']]
    assert len(set(slots)) == len(slots)
    assert all(e['qty'] == data.SHOP_GEAR_QTY for e in stock['gear'])
    # Biome bazaars: every gear line is T1/T2, except a rare black-market T3.
    for e in stock['gear']:
        t = data.GEAR[e['item']]['tier']
        if e.get('blackMarket'):
            assert t == 3
        else:
            assert t in data.BAZAAR_GEAR_TIERS

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


def test_island_bazaar_stocks_only_t2_t3():
    node = next(iter(data.ISLAND_BAZAAR_NODES))
    for w in range(100, 160):
        stock = db._gen_shop_stock(node, w)
        for e in stock['gear']:
            assert data.GEAR[e['item']]['tier'] in (2, 3)
            assert not e.get('blackMarket')          # island never uses black market
    # Mostly T2, some T3 — both tiers show up across many windows.
    tiers = [data.GEAR[e['item']]['tier']
             for w in range(100, 300) for e in db._gen_shop_stock(node, w)['gear']]
    assert 2 in tiers and 3 in tiers


def test_biome_black_market_is_rare_and_deterministic():
    node = next(n for n, v in data.MAP_NODES.items()
                if v['type'] == 'shop' and n not in data.ISLAND_BAZAAR_NODES)
    windows = list(range(0, 2000))
    hits = [w for w in windows
            if any(e.get('blackMarket') for e in db._gen_shop_stock(node, w)['gear'])]
    assert 0 < len(hits) < len(windows) * 0.2        # happens, but rare
    for w in hits:                                    # every black-market line is T3
        bm = [e for e in db._gen_shop_stock(node, w)['gear'] if e.get('blackMarket')]
        assert bm and all(data.GEAR[e['item']]['tier'] == 3 for e in bm)
    assert db._gen_shop_stock(node, hits[0]) == db._gen_shop_stock(node, hits[0])


# ── Umori: the wandering trading post ────────────────────────────────────────

def test_umori_window_math():
    base = datetime(2026, 7, 21, 12, 0, 0)
    w = db._umori_window(base)
    assert db._umori_window(base + timedelta(minutes=90)) == w          # same 2h window
    assert db._umori_window(base + timedelta(minutes=121)) == w + 1      # next window
    assert db._umori_window_end(w) > base.isoformat(timespec='seconds')


def test_umori_node_is_deterministic_wilderness():
    for w in range(0, 50):
        node = db._umori_node(w)
        assert node in data.UMORI_NODES
        assert data.MAP_NODES[node]['region'] == 'wilderness'
        assert db._umori_node(w) == node                                # stable per window
    # It actually wanders (not pinned to one node across windows).
    assert len({db._umori_node(w) for w in range(0, 50)}) > 1


def test_umori_stock_is_all_t3_and_deterministic():
    for w in range(0, 30):
        stock = db._umori_stock(w)
        assert len(stock) == (
            len(data.UMORI_GEAR_SLOTS) * data.UMORI_STOCK_SPEC['gear_per_slot']
            + data.UMORI_STOCK_SPEC['grimoire']
        )
        gears = [s['item'] for s in stock if s['item'] in data.GEAR]
        tomes = [s['item'] for s in stock if s['item'] in data.GRIMOIRES]
        # one gear per slot, covering every slot exactly once
        assert sorted(data.GEAR[g]['slot'] for g in gears) == sorted(data.UMORI_GEAR_SLOTS)
        assert len(tomes) == data.UMORI_STOCK_SPEC['grimoire']
        assert all(data.GEAR[g]['tier'] == 3 for g in gears)
        assert all(data.GRIMOIRES[t]['tier'] == 3 for t in tomes)
    assert db._umori_stock(5) == db._umori_stock(5)


def test_resolve_on_umori_node_opens_a_trading_post(table):
    act(table, 'join', starter='pest')
    sid = _sid(table)
    doc = db._get_player(table, sid, 'user-alex')
    win = db._umori_window()
    node = db._umori_node(win)
    ev = db._resolve_space(table, sid, doc, node, doc.get('position'))
    assert ev['type'] == 'trading_post' and ev['umori'] is True
    assert ev['node'] == node
    assert ev['movesAt'] == db._umori_window_end(win)
    # Stock is the T3 seed for this window.
    assert [s['item'] for s in ev['stock']] == [s['item'] for s in db._umori_stock(win)]


def test_state_surfaces_umori(table):
    act(table, 'join', starter='pest')
    _, state = db.handle_state(table, {'userId': 'user-alex'})
    win = db._umori_window()
    assert state['umori']['node'] == db._umori_node(win)
    assert state['umori']['movesAt'] == db._umori_window_end(win)
    # Display stock is seeded for the current Umori node.
    assert state['tradingPosts'][db._umori_node(win)]


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


def test_failed_flee_lets_enemy_perform_its_action(table, monkeypatch):
    """A failed flee is not a free retry: the enemy takes its telegraphed action
    for free, the player takes the hit, and the fight continues at the next round."""
    act(table, 'join', starter='pest')
    sid = _sid(table)
    doc = db._get_player(table, sid, 'user-alex')
    doc['spd'] = 1        # low SPD => low flee chance
    doc['hp'] = 500       # beefy enough to survive one clean hit
    db._put_player(table, doc)
    _begin(table, sid, npc=dict(_FODDER, atk=8, spd=1))
    doc = db._get_player(table, sid, 'user-alex')
    rec = doc['battle']
    rec['round'] = 2               # past the first-round flee gate
    rec['npcActual'] = 'aggress'   # the enemy will swing this round
    start_hp = rec['player']['hp']
    db._put_player(table, doc)
    monkeypatch.setattr(db._rng, 'random', lambda: 0.99)  # flee roll fails
    status, resp = act(table, 'combat-flee')
    assert status == 200
    c = resp['combat']
    assert c['fled'] is False
    assert c['entries']                       # a round actually resolved
    assert c['playerHp'] < start_hp           # the enemy performed its action
    assert c['round'] == 3                     # fight continues at the next round
    assert db._get_player(table, sid, 'user-alex').get('battle') is not None


def test_failed_flee_can_be_lethal(table, monkeypatch):
    """The enemy's free swing on a failed flee can drop the player — the fight
    ends in defeat rather than silently continuing."""
    act(table, 'join', starter='pest')
    sid = _sid(table)
    doc = db._get_player(table, sid, 'user-alex')
    doc['spd'] = 1
    doc['hp'] = 1         # one clean hit ends it
    db._put_player(table, doc)
    _begin(table, sid, npc=dict(_FODDER, atk=20, spd=1))
    doc = db._get_player(table, sid, 'user-alex')
    rec = doc['battle']
    rec['round'] = 2
    rec['npcActual'] = 'aggress'
    doc['lastStandUsed'] = True   # don't let the Last Stand perk save the KO
    db._put_player(table, doc)
    monkeypatch.setattr(db._rng, 'random', lambda: 0.99)  # flee fails
    status, resp = act(table, 'combat-flee')
    assert status == 200
    assert resp['spaceEvent']['battle']['outcome'] == 'defender'
    assert db._get_player(table, sid, 'user-alex').get('battle') is None


def test_battle_start_reports_flee_chance(table):
    """The battle_start event carries the SPD-based escape %, so the flee button
    can show the odds without the client re-deriving the formula."""
    act(table, 'join', starter='pest')
    sid = _sid(table)
    ev = _begin(table, sid, npc=dict(_FODDER, spd=4))
    rec = db._get_player(table, sid, 'user-alex')['battle']
    expected = min(95, db.engine.flee_chance(rec['player']['spd'], rec['npc']['spd'])
                   + rec['player'].get('flee_bonus', 0))
    assert ev['fleeChance'] == expected


def test_flee_chance_is_100_when_holding_a_smoke_spore(table):
    """A held Smoke Spore auto-succeeds a failed flee, so the odds read 100%."""
    act(table, 'join', starter='pest')
    sid = _sid(table)
    doc = db._get_player(table, sid, 'user-alex')
    doc['bag'] = ['smoke_spore']
    db._put_player(table, doc)
    ev = _begin(table, sid)
    assert ev['fleeChance'] == 100


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
    # Seed lets a brand-new player buy two common hats, or a common hat + a plain color.
    assert data.SHOP_START_RENOWN == 100
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
    # Seed (SHOP_START_RENOWN) + this night's earned renown (6).
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
    # A wallet of 80 can't cover a common hat (50) AND a paint (40) = 90.
    _fund(table, 'user-alex', 80)
    status, resp = act(table, 'join', starter='pest', home='city',
                       buyHats=['party_hat'], buyPaints=['crimson'])
    assert status == 409
    assert 'Renown' in resp['error']
    # No player doc, no perm mutation: a retry must still see the full wallet.
    perm = db._get_perm(table, 'user-alex')
    assert perm['renown'] == 80
    assert perm['hats'] == [] and 'crimson' not in perm['paints']


def test_join_grants_one_night_starter_items(table):
    _fund(table, 'user-alex', 100)  # kit is 20 + 25 + 15 = 60, over the 50 seed
    status, resp = act(table, 'join', starter='pest', home='city',
                       buyItems=['healing_moss', 'rusted_fang', 'spore_pouch'])
    assert status == 200, resp
    you = resp['you']
    assert 'healing_moss' in you['bag']
    # Starter gear (and the City Rat piece) now auto-equip into empty slots.
    # rusted_fang is a fang; it equips unless the City Rat's random T1 piece
    # already claimed the fang slot, in which case it stashes — so assert it is
    # owned and the fang slot ends filled either way.
    owned = set((you.get('gear') or {}).values()) | set(you.get('gearStash') or [])
    assert 'rusted_fang' in owned
    assert (you.get('gear') or {}).get('fang')
    assert you['spores'] == 15  # City Rat now grants gear, not spores; +15 from spore pouch
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


def test_new_perm_has_effects_and_creature_effect_defaults(table):
    status, resp = act(table, 'join', starter='pest', home='city')
    assert status == 200
    assert resp['you']['effect'] is None
    assert db._get_perm(table, 'user-alex')['effects'] == []


def test_buy_and_equip_special_paint_via_shop(table):
    _fund(table, 'user-alex', 600)
    status, resp = act(table, 'join', starter='pest', home='city',
                       buyEffects=['metallic'], equipEffect='metallic')
    assert status == 200, resp
    assert resp['you']['effect'] == 'metallic'
    perm = db._get_perm(table, 'user-alex')
    assert 'metallic' in perm['effects']
    assert perm['renown'] == 600 - data.SPECIAL_PAINT_PRICE


def test_buy_special_paint_insufficient_renown_rejected(table):
    _fund(table, 'user-alex', 300)  # under the 500 price
    status, resp = act(table, 'join', starter='pest', home='city',
                       buyEffects=['starry'])
    assert status == 409
    assert 'Renown' in resp['error']
    perm = db._get_perm(table, 'user-alex')
    assert perm['renown'] == 300 and perm['effects'] == []


def test_buy_unknown_special_paint_rejected(table):
    _fund(table, 'user-alex', 600)
    status, resp = act(table, 'join', starter='pest', home='city',
                       buyEffects=['nope'])
    assert status == 400
    assert db._get_perm(table, 'user-alex')['effects'] == []


def test_join_rejects_equipping_unowned_special_paint(table):
    _fund(table, 'user-alex', 600)
    status, resp = act(table, 'join', starter='pest', home='city',
                       equipEffect='rainbow')  # never bought
    assert status == 409
    assert 'own' in resp['error']


def test_customize_equip_and_clear_special_paint(table):
    act(table, 'join', starter='pest', home='city')
    perm = db._get_perm(table, 'user-alex')
    perm['effects'] = ['prismatic']
    table.put_item(Item=perm)
    status, resp = act(table, 'customize', effect='prismatic', hat='')
    assert status == 200, resp
    assert resp['you']['effect'] == 'prismatic'
    status, resp = act(table, 'customize', effect='', hat='')
    assert status == 200
    assert resp['you']['effect'] is None


def test_customize_equip_unowned_special_paint_rejected(table):
    act(table, 'join', starter='pest', home='city')
    status, resp = act(table, 'customize', effect='rainbow', hat='')
    assert status == 409
    assert 'own' in resp['error']


def test_effect_surfaced_in_state_and_wardrobe(table):
    _fund(table, 'user-alex', 600)
    act(table, 'join', starter='pest', home='city',
        buyEffects=['rainbow'], equipEffect='rainbow')
    status, state = db.handle_state(table, {'userId': 'user-alex'})
    assert status == 200
    assert state['you']['effect'] == 'rainbow'
    assert 'rainbow' in state['wardrobe']['effects']


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


def test_flow_spore_tunables_present():
    assert data.FLOW_SPORE_PER_CELL == 0.5
    assert data.FLOW_SPORE_CAP == 10


# ── Multi-solution loot rewards ──────────────────────────────────────────────

def test_place_loot_rewards_distinct_valid_cells():
    puzzle = data.flow_puzzle('p02')   # 4x4, start [0,3], end [3,0], rock [1,1]
    rng = random.Random(1)
    rewards = db._place_loot_rewards(puzzle, ['spores', 'item', 'gear'], rng)
    kinds = [r['kind'] for r in rewards]
    assert kinds == ['spores', 'item', 'gear']
    cells = [tuple(r['cell']) for r in rewards]
    assert len(set(cells)) == 3                       # distinct
    rocks = {tuple(c) for c in puzzle['rocks']}
    start, end = tuple(puzzle['start']), tuple(puzzle['end'])
    for cell in cells:
        assert cell not in rocks and cell != start and cell != end


def test_place_loot_rewards_gear_not_adjacent_to_start():
    puzzle = data.flow_puzzle('p02')
    start = tuple(puzzle['start'])
    for seed in range(30):
        rewards = db._place_loot_rewards(
            puzzle, ['spores', 'gear'], random.Random(seed))
        gear = next(tuple(r['cell']) for r in rewards if r['kind'] == 'gear')
        assert abs(gear[0] - start[0]) + abs(gear[1] - start[1]) != 1


def test_award_spores_credits_forage_amount(monkeypatch):
    monkeypatch.setattr(db._rng, 'choice', lambda seq: seq[0])   # picks 8
    doc = {'userId': 'u', 'spores': 0}
    ev = db._award_spores(doc)
    assert ev['type'] == 'loot' and ev['spores'] == 8
    assert doc['spores'] == 8


def test_award_item_puts_consumable_in_bag(monkeypatch):
    monkeypatch.setattr(db._rng, 'choice',
                        lambda seq: list(data.CONSUMABLES.keys())[0])
    doc = {'userId': 'u', 'spores': 0, 'bag': []}
    ev = db._award_item(doc)
    assert ev['type'] == 'loot' and ev['item'] == list(data.CONSUMABLES.keys())[0]
    assert doc['bag'] == [ev['item']]


def test_award_gear_rolls_a_drop(monkeypatch):
    monkeypatch.setattr(db._rng, 'choice',
                        lambda seq: 'fang' if 'fang' in seq else seq[0])
    monkeypatch.setattr(db._rng, 'choices', lambda seq, weights=None, k=1: [seq[0]])
    doc = {'userId': 'u', 'spores': 0, 'gear': {}}
    ev = db._award_gear(doc)
    assert ev['type'] == 'loot' and ev['gear']['slot'] == 'fang'


def test_loot_landing_places_pouch_and_molting_no_gear(table, monkeypatch):
    node = _first_loot_node()
    sid, doc = _player_at(table, node, spores=0)
    monkeypatch.setattr(db._rng, 'random', lambda: 0.99)   # gear roll misses
    ev = db._resolve_space(table, sid, doc, node, None)
    assert ev['type'] == 'loot_puzzle'
    kinds = [r['kind'] for r in ev['puzzle']['rewards']]
    assert kinds == ['item', 'molting']                    # one pouch + a molting pile
    assert doc['spores'] == 0                              # not credited yet
    assert doc['pendingLoot']['rewards'] == ev['puzzle']['rewards']


def test_loot_landing_appends_gear_on_rare_roll(table, monkeypatch):
    node = _first_loot_node()
    sid, doc = _player_at(table, node, spores=0)
    monkeypatch.setattr(db._rng, 'random', lambda: 0.0)    # gear roll fires
    ev = db._resolve_space(table, sid, doc, node, None)
    kinds = [r['kind'] for r in ev['puzzle']['rewards']]
    assert kinds == ['item', 'molting', 'gear']


def _land_loot_with(table, monkeypatch, placement):
    """Land on a loot node with a forced reward placement; return (sid, doc, puzzle)."""
    node = _first_loot_node()
    sid, doc = _player_at(table, node, spores=0, bag=[], gear={})
    monkeypatch.setattr(db, '_place_loot_rewards',
                        lambda puzzle, kinds, rng: placement(puzzle))
    monkeypatch.setattr(db._rng, 'random', lambda: 0.0)   # ensure item+gear present
    db._resolve_space(table, sid, doc, node, None)
    return sid, doc, data.flow_puzzle(doc['pendingLoot']['puzzleId'])


def test_solve_awards_gear_hit_first_plus_movement_spores(table, monkeypatch):
    # Gear one step after start → crossed first. Movement spores stack on top.
    sid, doc, puzzle = _land_loot_with(
        table, monkeypatch,
        lambda pz: [{'kind': 'gear', 'cell': pz['solution'][1]},
                    {'kind': 'item', 'cell': pz['solution'][-2]}])
    monkeypatch.setattr(db._rng, 'choice',
                        lambda seq: 'fang' if 'fang' in seq else seq[0])
    monkeypatch.setattr(db._rng, 'choices', lambda seq, weights=None, k=1: [seq[0]])
    sol = puzzle['solution']
    status, body = db._solve_loot_puzzle(table, sid, doc, {'path': sol})
    assert status == 200
    ev = body['spaceEvent']
    assert ev['gear']['slot'] == 'fang'
    # Movement spores: floor(len * 0.5) capped at 10, then Scrounger-scaled.
    base = min(int(len(sol) * data.FLOW_SPORE_PER_CELL), data.FLOW_SPORE_CAP)
    assert ev['spores'] == round(base * data.SCROUNGER_MULT)
    assert doc.get('pendingLoot') is None


def test_solve_no_item_crossed_awards_spores_only(table, monkeypatch):
    # Both pickups sit off a straight connecting path → nothing crossed.
    node = _first_loot_node()
    sid, doc = _player_at(table, node, spores=0, bag=[], gear={})
    # Force a board + placement we control: use p02 (4x4, start[0,3] end[3,0]).
    monkeypatch.setattr(db._rng, 'choice', lambda seq: 'p02')
    monkeypatch.setattr(db._rng, 'random', lambda: 0.99)          # no gear
    monkeypatch.setattr(db, '_place_loot_rewards',
                        lambda pz, kinds, rng: [{'kind': 'item', 'cell': [0, 0]},
                                                {'kind': 'item', 'cell': [1, 1]}])
    db._resolve_space(table, sid, doc, node, None)
    # A path down the right edge then along the bottom row misses [0,0] and [1,1].
    path = [[0, 3], [1, 3], [2, 3], [3, 3], [3, 2], [3, 1], [3, 0]]
    status, body = db._solve_loot_puzzle(table, sid, doc, {'path': path})
    assert status == 200
    ev = body['spaceEvent']
    assert 'item' not in ev and 'gear' not in ev
    base = min(int(len(path) * data.FLOW_SPORE_PER_CELL), data.FLOW_SPORE_CAP)
    assert ev['spores'] == round(base * data.SCROUNGER_MULT)


def test_solve_accepts_short_connecting_path(table, monkeypatch):
    # The new rule: a partial path that still reaches the end is valid.
    node = _first_loot_node()
    sid, doc = _player_at(table, node, spores=0, bag=[], gear={})
    monkeypatch.setattr(db._rng, 'choice', lambda seq: 'p02')
    monkeypatch.setattr(db._rng, 'random', lambda: 0.99)
    monkeypatch.setattr(db, '_place_loot_rewards',
                        lambda pz, kinds, rng: [{'kind': 'item', 'cell': [0, 0]}])
    db._resolve_space(table, sid, doc, node, None)
    path = [[0, 3], [1, 3], [2, 3], [3, 3], [3, 2], [3, 1], [3, 0]]  # right+bottom edge
    status, body = db._solve_loot_puzzle(table, sid, doc, {'path': path})
    assert status == 200
    assert doc.get('pendingLoot') is None


def test_solve_rejects_disconnected_path(table, monkeypatch):
    sid, doc, puzzle = _land_loot_with(
        table, monkeypatch,
        lambda pz: [{'kind': 'item', 'cell': pz['solution'][1]}])
    # Prefix that does NOT reach the end tile → rejected.
    status, body = db._solve_loot_puzzle(
        table, sid, doc, {'path': puzzle['solution'][:3]})
    assert status == 409
    assert doc['pendingLoot'] is not None


def test_ok_reports_effective_maxhp_not_base():
    # Regression: hp is always healed/clamped to the EFFECTIVE max (base + gear
    # + perks), but action responses (_ok) used to echo the raw base maxHp. Any
    # +maxHp gear then made a full-HP creature read as "hp over max" after every
    # action — the reported over-max bug. _ok must agree with the state endpoint
    # (_public_player), which reports effective maxHp.
    doc = {'atk': 1, 'def': 1, 'spd': 1, 'maxHp': 30, 'hp': 50, 'level': 1,
           'username': 'Alex', 'userId': 'user-alex',
           'gear': {'carapace': 'leviathan_hide'}}   # +20 Max HP
    eff = engine.effective_stats(doc)['maxHp']
    assert eff == 50                                 # 30 base + 20 gear; hp is full
    you = db._ok(doc)[1]['you']
    assert you['maxHp'] == eff                        # not the base 30
    assert you['hp'] <= you['maxHp']                  # no phantom over-max


def test_squirrel_line_and_calamity_beast_wired():
    import undercity_data as data
    assert data.STARTERS['squirrel']['passive'] == 'spell_haste'
    assert set(data.tier2_options('squirrel')) == {'squirrel_warrior', 'squirrel_mage'}
    # Calamity Beast reachable from both squirrel T2s AND several other lines.
    assert 'calamity_beast' in data.apex_options('squirrel_warrior')
    assert 'calamity_beast' in data.apex_options('squirrel_mage')
    assert 'calamity_beast' in data.apex_options('deathrite_shaman')
    assert 'calamity_beast' in data.apex_options('vexing_pest')
    assert data.APEX['calamity_beast']['passive'] == 'wish'
    assert data.SPELLS['wish']['effect'] == 'wish'


def test_underrealm_lich_handoff_wired():
    import undercity_data as data
    # The Underrealm Lich took over the Shambling Shell's regrow+spell kit; the
    # Shell now runs the spikeshell thorns passive instead.
    assert data.TIER2['underrealm_lich']['line'] == 'zombie'
    assert data.TIER2['underrealm_lich']['passive'] == 'rootwall'
    assert data.TIER2['shambling_shell']['passive'] == 'spikeshell'
    # rootwall grants Mend Flesh, so it follows the passive to the Lich.
    assert data.FORM_SPELLS['rootwall'] == 'mend_flesh'
    # Lich reaches both zombie apexes (satisfies the >=2 apex invariant).
    assert set(data.apex_options('underrealm_lich')) == {'grave_titan', 'golgari_lich_lord'}


def test_admin_reset_all_opens_fresh_night_and_wipes_profiles(table):
    """reset-all archives the running night, opens a fresh one (new seasonId,
    empty roster, fresh first-clears), and wipes every permanent profile
    (renown / perks) to defaults. The finished night's creature is preserved
    (archived under its old seasonId), not deleted."""
    act(table, 'join', starter='saproling', home='cavern')
    old_sid = db._active_season(table)[0]
    perm = db._get_perm(table, 'user-alex')
    perm['renown'] = 999
    table.put_item(Item=perm)

    # Wrong passphrase is refused — no reset, no new night.
    status, _ = act(table, 'admin', hostKey='nope', cmd='reset-all')
    assert status == 403
    assert db._active_season(table)[0] == old_sid

    # seasonId is a whole-second timestamp; wait a beat so the fresh night gets a
    # distinct id from the fixture's (real hosts never reset within one second).
    time.sleep(1.1)
    status, resp = act(table, 'admin', hostKey='swampking', cmd='reset-all')
    assert status == 200 and resp['ok']

    # A fresh night is active (new seasonId), empty of players.
    new_sid = db._active_season(table)[0]
    assert new_sid != old_sid and resp['seasonId'] == new_sid
    assert not db._get_player(table, new_sid, 'user-alex')

    # Renown reset to the default; the old night's creature is preserved.
    assert db._get_perm(table, 'user-alex')['renown'] == data.SHOP_START_RENOWN
    assert db._get_player(table, old_sid, 'user-alex')  # archived, not deleted


def test_metrics_recorded_and_exported(table):
    """Rolling + moving records per-player metric counters, and the export admin
    cmd returns the full dataset (players with metrics + the event log)."""
    act(table, 'join', starter='saproling', home='cavern')
    sid = db._active_season(table)[0]

    _, resp = act(table, 'roll')
    act(table, 'move', to=resp['roll']['destinations'][0])

    doc = db._get_player(table, sid, 'user-alex')
    assert doc['metrics']['rolls'] >= 1
    assert doc['metrics']['spaces'] >= 1
    assert any(k.startswith('space.') for k in doc['metrics'])

    # Export dumps every player (with metrics) plus the append-only event log.
    status, out = act(table, 'admin', hostKey='swampking', cmd='export')
    assert status == 200 and out['ok'] and out['season'] == sid
    assert isinstance(out['events'], list)
    exp = next(p for p in out['players'] if p['userId'] == 'user-alex')
    assert exp['metrics']['rolls'] >= 1

    # Wrong passphrase exports nothing.
    assert act(table, 'admin', hostKey='nope', cmd='export')[0] == 403


def test_export_works_after_the_night_ends(table):
    """The read-only host export must still run once the night is over — reviewing
    the finished night's data is exactly when the host wants it. Every other admin
    cmd stays gated behind an active season."""
    act(table, 'join', starter='saproling', home='cavern')
    sid = db._active_season(table)[0]

    status, _ = act(table, 'season-end', hostKey='swampking')
    assert status == 200
    assert db._active_season(table)[1]['status'] == 'ended'

    # Export still returns the finished night's dataset.
    status, out = act(table, 'admin', hostKey='swampking', cmd='export')
    assert status == 200 and out['ok'] and out['season'] == sid
    assert any(p['userId'] == 'user-alex' for p in out['players'])

    # A mutating admin cmd is still refused once the night is over.
    status, _ = act(table, 'admin', hostKey='swampking', cmd='broadcast', text='hi')
    assert status == 409



# ── Soul Trophy (Deathrite Shaman): post-win stat-choice buff ─────────────────

def _make_deathrite(table, user='user-alex'):
    doc = db._get_player(table, _sid(table), user)
    doc['form'] = 'deathrite_shaman'
    doc['tier'] = 2
    doc['passives'] = ['regrowth', 'soul_trophy']
    assert db._put_player(table, doc)
    return db._get_player(table, _sid(table), user)


def test_soul_trophy_win_offers_menu(table, monkeypatch):
    act(table, 'join', starter='zombie')
    doc = _make_deathrite(table)
    db._wild_battle(table, _sid(table), doc)          # mutates doc in place
    npc = doc['battle']['npc']
    expected = data.enemy_level(npc['atk'], npc['dfn'], npc['spd'], npc['maxHp'])
    se = _finish_started_battle(table, monkeypatch, doc, 'attacker')
    assert se['trophy'] == {'amount': expected}
    assert db._get_player(table, _sid(table), 'user-alex')['pendingTrophy'] == {'amount': expected}


def test_trophy_choose_applies_one_battle_buff(table, monkeypatch):
    act(table, 'join', starter='zombie')
    doc = _make_deathrite(table)
    db._wild_battle(table, _sid(table), doc)
    npc = doc['battle']['npc']
    amount = data.enemy_level(npc['atk'], npc['dfn'], npc['spd'], npc['maxHp'])
    _finish_started_battle(table, monkeypatch, doc, 'attacker')

    status, resp = act(table, 'trophy-choose', stat='atk')
    assert status == 200, resp
    doc = db._get_player(table, _sid(table), 'user-alex')
    assert {'kind': 'trophy', 'stat': 'atk', 'amount': amount} in doc['buffs']
    assert not doc.get('pendingTrophy')
    base = engine.effective_stats({**doc, 'buffs': []})['atk']
    assert engine.effective_stats(doc)['atk'] == base + amount


def test_trophy_buff_consumed_after_next_fight(table, monkeypatch):
    act(table, 'join', starter='zombie')
    doc = _make_deathrite(table)
    db._wild_battle(table, _sid(table), doc)
    _finish_started_battle(table, monkeypatch, doc, 'attacker')
    act(table, 'trophy-choose', stat='spd')
    doc = db._get_player(table, _sid(table), 'user-alex')
    assert any(b.get('kind') == 'trophy' for b in doc['buffs'])
    # Fight again: the trophy buff should be consumed as a one-battle buff.
    db._wild_battle(table, _sid(table), doc)
    _finish_started_battle(table, monkeypatch, doc, 'attacker')
    doc = db._get_player(table, _sid(table), 'user-alex')
    assert not any(b.get('kind') == 'trophy' for b in doc['buffs'])


def test_trophy_choose_rejects_without_pending(table):
    act(table, 'join', starter='zombie')
    _make_deathrite(table)
    status, resp = act(table, 'trophy-choose', stat='atk')
    assert status == 409, resp


def test_trophy_choose_rejects_bad_stat(table, monkeypatch):
    act(table, 'join', starter='zombie')
    doc = _make_deathrite(table)
    db._wild_battle(table, _sid(table), doc)
    _finish_started_battle(table, monkeypatch, doc, 'attacker')
    status, resp = act(table, 'trophy-choose', stat='maxHp')
    assert status == 400, resp


def test_non_deathrite_win_offers_no_trophy(table, monkeypatch):
    act(table, 'join', starter='pest')
    sid = _sid(table)
    doc = db._get_player(table, sid, 'user-alex')
    db._wild_battle(table, sid, doc)
    se = _finish_started_battle(table, monkeypatch, doc, 'attacker')
    assert 'trophy' not in se
    assert not db._get_player(table, sid, 'user-alex').get('pendingTrophy')


# ── Region-gated enemy tiers (design 2026-07-26-region-tier) ──────────────────

def test_region_tier_mapping():
    assert data.region_tier('city') == 1
    assert data.region_tier('garden') == 1 and data.region_tier('bog') == 1
    assert data.region_tier('ruin') == 2 and data.region_tier('depths') == 2
    assert data.region_tier('wilderness') == 3 and data.region_tier('isle') == 3
    assert data.region_tier('anything_else') == 1   # safe default
    assert data.region_tier(None) == 1


def test_tier_pools_compose_existing_rosters():
    t = data.TIER_NPCS
    assert t[1]['wild'] is data.NPCS and t[1]['elite'] is data.ELITE_NPCS
    assert t[2]['wild'] is data.DEPTHS_MID and t[2]['elite'] is data.WILDERNESS_NPCS
    assert {n['id'] for n in t[3]['wild']} == (
        {n['id'] for n in data.DEPTHS_DEEP} | {n['id'] for n in data.WILDERNESS_ELITE_NPCS})
    assert {n['id'] for n in t[3]['elite']} == (
        {n['id'] for n in data.DEPTHS_ABYSS} | {n['id'] for n in data.ISLE_APEX})


def test_tier_wild_hp_ceilings_ascend():
    hp = lambda pool: max(n['hp'] for n in pool)
    assert hp(data.TIER_NPCS[1]['wild']) < hp(data.TIER_NPCS[2]['wild']) < hp(data.TIER_NPCS[3]['wild'])


def test_city_wild_and_elite_use_tier1(table):
    act(table, 'join', starter='pest')
    sid = _sid(table)
    doc = db._get_player(table, sid, 'user-alex')
    wild = db._wild_battle(table, sid, doc, region='city')
    assert wild['npc']['id'] in {n['id'] for n in data.NPCS}
    elite = db._wild_battle(table, sid, doc, region='city', elite=True)
    assert elite['npc']['id'] in {n['id'] for n in data.ELITE_NPCS}


def test_ruin_is_tier2_not_tier1(table):
    """The bug this fixes: the Ruinways used to fall through to tier-1 NPCS."""
    act(table, 'join', starter='pest')
    sid = _sid(table)
    doc = db._get_player(table, sid, 'user-alex')
    ev = db._wild_battle(table, sid, doc, region='ruin')
    assert ev['npc']['id'] in {n['id'] for n in data.DEPTHS_MID}
    assert ev['npc']['id'] not in {n['id'] for n in data.NPCS}


def test_depths_is_flat_tier2_regardless_of_depth(table):
    """No more depth ladder: a shallow AND a deep depths node both pull tier 2 —
    the flat DEPTHS_MID pool plus that biome's signature minion (design 2026-08-02)."""
    sid = _sid(table)
    mid_ids = {n['id'] for n in data.DEPTHS_MID}
    for node in ('city_lb', 'city_d1'):           # both region='depths', biome 'city'
        sig = data.LAIR_SIGNATURE.get(data.dungeon_biome(node) or node.split('_')[0])
        allowed = mid_ids | ({sig} if sig else set())
        _, doc = _player_at(table, node)
        ids = {db._wild_battle(table, sid, doc)['npc']['id'] for _ in range(20)}
        assert ids and ids <= allowed, (node, ids)


def test_wilderness_and_isle_use_tier3(table):
    act(table, 'join', starter='pest')
    sid = _sid(table)
    doc = db._get_player(table, sid, 'user-alex')
    t3_wild = {n['id'] for n in data.DEPTHS_DEEP} | {n['id'] for n in data.WILDERNESS_ELITE_NPCS}
    t3_elite = {n['id'] for n in data.DEPTHS_ABYSS} | {n['id'] for n in data.ISLE_APEX}
    for region in ('wilderness', 'isle'):
        w = {db._wild_battle(table, sid, doc, region=region)['npc']['id'] for _ in range(30)}
        assert w and w <= t3_wild, (region, w)
        e = {db._wild_battle(table, sid, doc, region=region, elite=True)['npc']['id'] for _ in range(30)}
        assert e and e <= t3_elite, (region, e)


# ── Ashen Fog (fog-of-war tile) ──────────────────────────────────────────────

def test_ashen_fog_first_lander_reveals_and_locks(table, monkeypatch):
    act(table, 'join', starter='pest')
    sid = _sid(table)
    doc = db._get_player(table, sid, 'user-alex')
    nodes = db._season_map(table, sid)
    node = 'wild_fog_test'

    # First lander: force a 'mystery' reveal.
    monkeypatch.setattr(db.engine, 'roll_fog', lambda rng: 'mystery')
    first = db._ashen_fog(table, sid, doc, node, 'wilderness', nodes, None)
    assert first['type'] == 'mystery'
    assert first.get('fogReveal') == 'mystery'   # first lander sees the fog part
    assert 'fog' in first['text'].lower()        # the reveal beat is fronted
    rec = db._get(table, db._season_pk(sid), f'FOG#{node}')
    assert rec and rec['revealed'] == 'mystery'  # locked season-global

    # A later lander (even rolling something else) resolves as the LOCKED type,
    # with no re-roll and no fog beat.
    monkeypatch.setattr(db.engine, 'roll_fog', lambda rng: 'cache')
    again = db._ashen_fog(table, sid, doc, node, 'wilderness', nodes, None)
    assert again['type'] == 'mystery'            # locked, not the new 'cache' roll
    assert 'fogReveal' not in again              # already revealed → no beat

    # State surfaces the reveal to every client.
    _, state = db.handle_state(table, {'userId': 'user-alex'})
    assert state['fogReveals'].get(node) == 'mystery'


def test_ashen_fog_cache_reveal_claims_once(table, monkeypatch):
    act(table, 'join', starter='pest')
    sid = _sid(table)
    doc = db._get_player(table, sid, 'user-alex')
    nodes = db._season_map(table, sid)
    node = 'wild_fog_cache'

    monkeypatch.setattr(db.engine, 'roll_fog', lambda rng: 'cache')
    first = db._ashen_fog(table, sid, doc, node, 'wilderness', nodes, None)
    assert first['type'] == 'cache' and first.get('fogReveal') == 'cache'
    assert first.get('spores', 0) > 0            # the jackpot pays out on reveal

    # Second landing on the now-cache tile: claimed → no more spores.
    again = db._ashen_fog(table, sid, doc, node, 'wilderness', nodes, None)
    assert again['type'] == 'cache'
    assert not again.get('spores')               # already plundered


# ── Overgrown Cache moltings (2026-07-29) ────────────────────────────────────

def test_award_molting_grants_configured_amount():
    doc = {'materials': {'moltings': 0, 'ichor': 0}}
    ev = db._award_molting(doc)
    assert doc['materials']['moltings'] == data.FLOW_MOLTING_REWARD
    assert ev['materials']['moltings'] == data.FLOW_MOLTING_REWARD
    assert ev['type'] == 'loot'
    assert 'Molting' in ev['text']


def test_loot_puzzle_pool_has_molting_not_second_pouch():
    doc = {'materials': {'moltings': 0, 'ichor': 0}}
    ev = db._loot_puzzle(None, 'S1', doc, 'n1')
    kinds = [r['kind'] for r in ev['puzzle']['rewards']]
    assert kinds.count('item') == 1          # one pouch, not two
    assert 'molting' in kinds                 # replaced by a molting pile


def test_place_loot_rewards_only_uses_routable_cells():
    # Every rocked puzzle, every reward: the chosen cell must be on some route.
    for p in [q for q in data.FLOW_PUZZLES if q['rocks']]:
        rng = random.Random(1234)
        rewards = db._place_loot_rewards(p, ['item', 'molting', 'gear'], rng)
        for rw in rewards:
            assert engine.cell_on_some_route(p, rw['cell']) is True, (p['id'], rw)


def test_place_loot_rewards_avoids_boxed_in_pocket():
    # [0,3] is a dead-end pocket walled by rocks [0,2] and [1,3] — no through-route
    # crosses it, so a reward there would be uncollectible. Across many seeds,
    # placement must never choose it.
    puzzle = {'w': 4, 'h': 4, 'start': [0, 0], 'end': [3, 3],
              'rocks': [[0, 2], [1, 3]]}
    for seed in range(80):
        rng = random.Random(seed)
        rewards = db._place_loot_rewards(puzzle, ['item', 'molting'], rng)
        for rw in rewards:
            assert list(rw['cell']) != [0, 3], seed


def test_gear_find_text_equipped_and_stashed_are_celebratory():
    gid = next(iter(data.GEAR))
    name = data.GEAR[gid]['name']
    equipped = db._gear_find_text({'id': gid, 'outcome': 'equipped'})
    stashed = db._gear_find_text({'id': gid, 'outcome': 'stashed'})
    assert name in equipped and 'slot it on' in equipped
    assert stashed == f'You unearth {name}!'
    # No storage-logistics wording for the happy cases.
    assert 'stash' not in equipped.lower() and 'stash' not in stashed.lower()


def test_gear_find_text_pending_is_honest():
    gid = next(iter(data.GEAR))
    name = data.GEAR[gid]['name']
    txt = db._gear_find_text({'id': gid, 'outcome': 'pending'})
    assert name in txt and 'full' in txt.lower()


# ── Mystery reel outcome field (2026-07-29) ──────────────────────────────────

def _first_mystery_node():
    return next(n for n, d in data.MAP_NODES.items() if d['type'] == 'mystery')


def test_mystery_event_always_carries_a_valid_outcome(table, monkeypatch):
    valid = {'jackpot', 'gear', 'grimoire', 'item', 'heal', 'buff', 'curse',
             'warp', 'hurt', 'theft', 'spores', 'xp', 'mystery'}
    node = _first_mystery_node()
    sid, doc = _player_at(table, node, spores=50)
    seen = set()
    for r in range(1, 13):
        # Force the d12 roll; _mystery calls engine.roll_mystery(db._rng, ...).
        monkeypatch.setattr(db._rng, 'randint', lambda a, b, _r=r: _r)
        ev = db._mystery(table, sid, doc)
        assert ev['type'] == 'mystery'
        assert ev.get('outcome') in valid, (r, ev.get('outcome'))
        seen.add(ev['outcome'])
    # Across the whole d12 we should see clearly more than one face.
    assert len(seen) >= 5


def test_compute_renown_uses_pvp_renown_wins():
    base = data.compute_renown({'pvpWins': 0, 'pvpRenownWins': 0})
    gated = data.compute_renown({'pvpWins': 5, 'pvpRenownWins': 2})
    assert gated - base == 2 * data.RENOWN['per_pvp_win']


def test_compute_renown_grandfathers_legacy_pvp_wins():
    # A player from before the split (no pvpRenownWins key) keeps renown for
    # their existing pvpWins.
    legacy = data.compute_renown({'pvpWins': 3})
    assert legacy == 3 * data.RENOWN['per_pvp_win']


def test_npc_combatant_carries_perks_and_riders():
    npc = {'name': 'Clone', 'hp': 40, 'maxHp': 40, 'atk': 10, 'def': 5, 'spd': 6,
           'passives': ['deathrite'], 'perks': ['carapace_grind'],
           'riders': ['bramble'], 'rider_mag': {'bramble': 3.0}}
    c = db._npc_combatant(npc)
    assert 'carapace_grind' in c.perks
    assert 'bramble' in c.riders
    assert c.rider_mag.get('bramble') == 3.0


def test_npc_combatant_defaults_empty_for_plain_monsters():
    c = db._npc_combatant({'name': 'Grub', 'hp': 20, 'atk': 5, 'def': 2, 'spd': 3})
    assert c.perks == frozenset()
    assert c.riders == frozenset()


def test_pvp_starts_interactive_clone_battle(table):
    act(table, 'join', starter='kraul', home='cavern')
    act(table, 'join', user='user-sam', name='Sam', starter='saproling', home='cavern')
    sid = _sid(table)
    alex = db._get_player(table, sid, 'user-alex')
    sam = db._get_player(table, sid, 'user-sam')
    alex['position'] = sam['position'] = 'city_r2'
    sam['maxHp'] = 40
    sam['hp'] = 15          # PvE-damaged; clone should still fight at full HP
    sam['spores'] = 100
    db._put_player(table, alex)
    db._put_player(table, sam)

    status, resp = act(table, 'battle', targetUserId='user-sam')
    assert status == 200, resp
    ev = resp['spaceEvent']
    assert ev['type'] == 'battle_start'
    assert ev['kind'] == 'pvp'
    assert ev['npc']['hp'] == 40                       # full HP, not current 15
    assert resp['you']['battle']['kind'] == 'pvp'      # attacker is mid-fight now

    # The real target was NOT touched by starting the duel.
    sam = db._get_player(table, sid, 'user-sam')
    assert sam['hp'] == 15
    assert sam['spores'] == 100
    assert not sam.get('battle')


def _seed_pvp_pair(table, atk_fields=None, tgt_fields=None):
    """Two players on the same node, ready for a duel. Returns (sid, alex, sam)."""
    act(table, 'join', starter='kraul', home='cavern')
    act(table, 'join', user='user-sam', name='Sam', starter='saproling', home='cavern')
    sid = _sid(table)
    alex = db._get_player(table, sid, 'user-alex')
    sam = db._get_player(table, sid, 'user-sam')
    alex['position'] = sam['position'] = 'city_r2'
    alex.update(atk_fields or {})
    sam.update(tgt_fields or {})
    db._put_player(table, alex)
    db._put_player(table, sam)
    return sid, alex, sam


def test_pvp_win_grants_renown_when_target_equal_or_higher_level(table, monkeypatch):
    sid, _, _ = _seed_pvp_pair(table,
                               atk_fields={'level': 3, 'atk': 50, 'spores': 0},
                               tgt_fields={'level': 5, 'spores': 100})
    act(table, 'battle', targetUserId='user-sam')
    alex = db._get_player(table, sid, 'user-alex')
    _finish_started_battle(table, monkeypatch, alex, 'attacker')
    alex = db._get_player(table, sid, 'user-alex')
    assert alex['pvpWins'] == 1
    assert alex['pvpRenownWins'] == 1                  # target level >= attacker


def test_pvp_win_against_lower_level_grants_no_renown(table, monkeypatch):
    sid, _, _ = _seed_pvp_pair(table,
                               atk_fields={'level': 8, 'atk': 50, 'spores': 0},
                               tgt_fields={'level': 2, 'spores': 100})
    act(table, 'battle', targetUserId='user-sam')
    alex = db._get_player(table, sid, 'user-alex')
    _finish_started_battle(table, monkeypatch, alex, 'attacker')
    alex = db._get_player(table, sid, 'user-alex')
    assert alex['pvpWins'] == 1
    assert alex.get('pvpRenownWins', 0) == 0           # gank -> no renown


def test_pvp_loss_composts_attacker_and_leaves_target_intact(table, monkeypatch):
    sid, _, sam0 = _seed_pvp_pair(
        table,
        atk_fields={'level': 3, 'spores': 50},
        tgt_fields={'level': 3, 'spores': 100})
    sam_hp = sam0['hp']
    act(table, 'battle', targetUserId='user-sam')
    alex = db._get_player(table, sid, 'user-alex')
    _finish_started_battle(table, monkeypatch, alex, 'defender', defender_hp=99)
    alex = db._get_player(table, sid, 'user-alex')
    sam = db._get_player(table, sid, 'user-sam')
    assert alex['spores'] == 50                         # NO spore transfer on loss
    assert alex['position'] == 'cavern_r0'              # composted to the home gate
    assert sam['spores'] == 100 and sam['hp'] == sam_hp  # target fully intact
    assert sam['awayEvents'][-1]['outcome'] == 'defended'


# ── Respawning ruin lairs (design 2026-08-02) ────────────────────────────────

def test_respawn_lair_constants_are_well_formed():
    # The two ruin lairs are a subset of the lair-boss roster.
    assert data.RESPAWN_LAIRS == {'lair_titan', 'n288'}
    assert data.RESPAWN_LAIRS <= set(data.LAIR_BOSSES)
    # Every respawn lair has abandoned-lair flavour.
    for node in data.RESPAWN_LAIRS:
        assert data.LAIR_ABANDONED_DIALOGUE.get(node)
    # Scavenge items are real consumables; the spore range is sane.
    assert set(data.LAIR_SCAVENGE_ITEMS) <= set(data.CONSUMABLES)
    lo, hi = data.LAIR_SCAVENGE_SPORES
    assert 0 < lo <= hi
    assert 0 < data.LAIR_SCAVENGE_ITEM_CHANCE < 1
    assert data.LAIR_RESPAWN_MINUTES == 60


def _land_ruin_lair(table, sid, user='user-alex'):
    """Land the player on the Lord of Extinction's lair and return the event."""
    doc = db._get_player(table, sid, user)
    doc['position'] = 'lair_titan'
    ev = db._lair(table, sid, doc, 'lair_titan')
    db._put_player(table, doc)
    return doc, ev


def test_fresh_ruin_lair_starts_a_full_hp_fight(table):
    act(table, 'join', starter='pest')
    sid, _ = db._active_season(table)
    _, ev = _land_ruin_lair(table, sid)
    b = data.LAIR_BOSSES['lair_titan']
    assert ev['type'] == 'battle_start' and ev['kind'] == 'lair'
    assert ev['npc']['name'] == b['name']          # not a Vestige
    assert ev['npc']['hp'] == b['hp'] and ev['npc']['maxHp'] == b['hp']


def test_abandoned_ruin_lair_scavenges_once(table, monkeypatch):
    act(table, 'join', starter='pest')
    sid, _ = db._active_season(table)
    doc = db._get_player(table, sid, 'user-alex')
    # Stamp a live abandonment window by hand (Task 3 produces this for real).
    future = (db.datetime.utcnow() + db.timedelta(minutes=30)).isoformat(timespec='seconds')
    doc['ruinLairs'] = {'lair_titan': {'respawnAt': future, 'scavenged': False}}
    doc['spores'] = 100
    db._put_player(table, doc)
    monkeypatch.setattr(db._rng, 'randint', lambda a, b: 7)
    monkeypatch.setattr(db._rng, 'random', lambda: 0.99)  # no item this time

    doc = db._get_player(table, sid, 'user-alex')
    doc['position'] = 'lair_titan'
    ev = db._lair(table, sid, doc, 'lair_titan')
    assert ev['type'] == 'lairAbandoned'
    assert ev['spores'] == 7
    assert doc['spores'] == 107
    assert doc['ruinLairs']['lair_titan']['scavenged'] is True

    # Second visit in the same window: picked clean, no further spores.
    ev2 = db._lair(table, sid, doc, 'lair_titan')
    assert ev2['type'] == 'lairAbandoned'
    assert 'spores' not in ev2
    assert doc['spores'] == 107


def test_abandoned_ruin_lair_can_yield_an_item(table, monkeypatch):
    act(table, 'join', starter='pest')
    sid, _ = db._active_season(table)
    doc = db._get_player(table, sid, 'user-alex')
    future = (db.datetime.utcnow() + db.timedelta(minutes=30)).isoformat(timespec='seconds')
    doc['ruinLairs'] = {'lair_titan': {'respawnAt': future, 'scavenged': False}}
    doc['bag'] = []
    db._put_player(table, doc)
    monkeypatch.setattr(db._rng, 'randint', lambda a, b: 5)
    monkeypatch.setattr(db._rng, 'random', lambda: 0.0)   # hit the item roll
    monkeypatch.setattr(db._rng, 'choice', lambda seq: seq[0])

    doc = db._get_player(table, sid, 'user-alex')
    doc['position'] = 'lair_titan'
    ev = db._lair(table, sid, doc, 'lair_titan')
    assert ev['item'] == data.LAIR_SCAVENGE_ITEMS[0]
    assert data.LAIR_SCAVENGE_ITEMS[0] in doc['bag']


def _ruin_lair_fight(table, sid, user, outcome, defender_hp, monkeypatch):
    """Start + resolve one ruin-lair fight, returning (doc, merged-out)."""
    doc = db._get_player(table, sid, user)
    doc['position'] = 'lair_titan'
    ev = db._lair(table, sid, doc, 'lair_titan')          # battle_start (full HP)
    se = _finish_started_battle(table, monkeypatch, doc, outcome, defender_hp,
                                user=user, name=user)
    out = dict(se)
    out['npc'] = {**ev.get('npc', {}), **se.get('npc', {})}
    return db._get_player(table, sid, user), out


def test_ruin_lair_kill_stamps_respawn_no_vestige_no_worldevent(table, monkeypatch):
    act(table, 'join', starter='pest')
    sid, _ = db._active_season(table)
    b = data.LAIR_BOSSES['lair_titan']

    doc, out = _ruin_lair_fight(table, sid, 'user-alex', 'attacker', 0, monkeypatch)
    # First-ever kill pays the `first` tier.
    assert out['spores'] == b['first']['spores']
    # Abandonment stamped, not yet scavenged.
    entry = doc['ruinLairs']['lair_titan']
    assert entry['respawnAt'] > db._now() and entry['scavenged'] is False
    # No Vestige reform: the shared LAIR# pool was never written.
    assert db._get(table, db._season_pk(sid), 'LAIR#lair_titan') is None
    # No world-event wake, no first-conqueror stamp.
    assert db._get(table, db._season_pk(sid), 'WORLDEVENT') is None
    assert db._get(table, db._season_pk(sid), 'FIRST#lair_titan') is None
    # First personal kill still claims the POI (renown), once.
    assert doc['poiClaims'].count('lair_titan') == 1


def test_ruin_lair_repeat_kill_pays_repeat_tier(table, monkeypatch):
    act(table, 'join', starter='pest')
    sid, _ = db._active_season(table)
    b = data.LAIR_BOSSES['lair_titan']
    # First kill (first tier), then force the window elapsed so it's fightable.
    doc, _ = _ruin_lair_fight(table, sid, 'user-alex', 'attacker', 0, monkeypatch)
    doc['ruinLairs']['lair_titan']['respawnAt'] = '2000-01-01T00:00:00'
    db._put_player(table, doc)
    # Second kill pays repeat and does NOT double-claim the POI.
    doc2, out2 = _ruin_lair_fight(table, sid, 'user-alex', 'attacker', 0, monkeypatch)
    assert out2['spores'] == b['repeat']['spores']
    assert doc2['poiClaims'].count('lair_titan') == 1


def test_sigil_lair_still_reforms_a_vestige(table, monkeypatch):
    # Guard: the change must not touch the five sigil lairs.
    act(table, 'join', starter='pest')
    sid, _ = db._active_season(table)
    _, out = _lair_fight(table, sid, 'user-alex', 'attacker', 0, monkeypatch)  # existing helper
    _, out2 = _lair_fight(table, sid, 'user-alex', 'attacker', 0, monkeypatch)
    assert out2['npc']['name'].startswith('Vestige of ')


def test_ruin_lair_respawns_after_the_window(table, monkeypatch):
    act(table, 'join', starter='pest')
    sid, _ = db._active_season(table)
    b = data.LAIR_BOSSES['lair_titan']
    # Kill it, then age the window into the past.
    doc, _ = _ruin_lair_fight(table, sid, 'user-alex', 'attacker', 0, monkeypatch)
    doc['ruinLairs']['lair_titan']['respawnAt'] = '2000-01-01T00:00:00'
    db._put_player(table, doc)
    # Landing now starts a fresh full-HP fight again (not a scavenge).
    doc['position'] = 'lair_titan'
    ev = db._lair(table, sid, doc, 'lair_titan')
    assert ev['type'] == 'battle_start'
    assert ev['npc']['hp'] == b['hp'] and ev['npc']['name'] == b['name']


def test_respawn_lairs_are_not_field_spell_targets(table):
    act(table, 'join', starter='pest')
    sid, _ = db._active_season(table)
    pools = db._guardian_pools(table, sid)
    assert 'lair_titan' not in pools and 'n288' not in pools
    # The five sigil lairs are still rooted pools.
    assert 'city_lair' in pools


def test_field_spell_rejects_a_respawn_lair_target(table):
    act(table, 'join', starter='pest')
    sid, _ = db._active_season(table)
    doc = db._get_player(table, sid, 'user-alex')
    # The RESPAWN_LAIRS guard is the first line of _cast_field and returns before
    # the spell dict is read, so a minimal stub spell is enough to exercise it.
    res = db._cast_field(table, sid, doc, 'stub', {'effect': 'damage'}, 'lair_titan')
    # Error tuple (status int, body) — the caster's cooldown is left unstarted.
    assert isinstance(res[0], int) and res[0] >= 400


# ── Boss familiars (design 2026-08-04) ───────────────────────────────────────

def test_lair_familiar_registry_shape():
    fam = data.LAIR_FAMILIAR
    assert set(fam) == {'skullbriars_familiar', 'slimefoots_saprolings',
                        'gitrog_spawn', 'sarulfs_packmate', 'ishkanahs_hatchling'}
    for fid, spec in fam.items():
        assert spec['id'] == fid
        assert spec['passives'] and isinstance(spec['passives'], list)
        assert spec['sprites'] and isinstance(spec['sprites'], list)
        # Mini-elite HP band: below the bosses (40-48) and depths wilds (42-56).
        assert 28 <= spec['hp'] <= 36
    # The five biomes now point at familiars; ruin stays a pool enemy.
    for biome in ('bone', 'garden', 'bog', 'cavern', 'city'):
        assert data.LAIR_SIGNATURE[biome] in fam
    assert data.LAIR_SIGNATURE['ruin'] == 'moldering_karock'
    # Familiars are EXCLUSIVE — never in a general wild/elite pool.
    assert not (set(fam) & set(data.ENEMY_SPECS_BY_ID))
