"""Gorgon combat abilities: Petrify (Medusa), Brittle/Shatter (Basalt), wildcard slot."""
import undercity_data as data
import undercity_db as db
import undercity_engine as engine

from tests.test_undercity_db import (  # noqa: F401
    table, act, _sid, _player_at)


def test_combatant_petrify_brittle_round_trip():
    c = engine.Combatant(name='X', hp=20, max_hp=20, atk=5, dfn=5, spd=5)
    c.petrify = 3
    c.brittle = 2
    snap = db._bt_snapshot(c)
    assert snap['petrify'] == 3 and snap['brittle'] == 2
    back = db._bt_to_combatant(snap)
    assert back.petrify == 3 and back.brittle == 2
    back.petrify = 7
    db._bt_store(back, snap)
    assert snap['petrify'] == 7


def test_petrify_scalars_and_stone_gaze_read_bonus():
    assert data.PETRIFY_SLOW == 2
    assert data.PETRIFY_FREEZE_AT == 4
    assert data.READ_PASSIVE_BONUS['stone_gaze'] == 0.15


def test_medusa_has_stone_gaze():
    assert data.TIER2['medusa_stalker']['passive'] == 'stone_gaze'


def _start_a_fight_as_gorgon(table, passives):
    """Join, force a wild fight, and stamp the battle player's passives (simulating
    an evolved Gorgon form). `_wild_battle` already persisted the battle; we stamp
    the in-memory doc only and let `_combat_round` do the next save (an extra save
    here would desync the doc version and 409 the round)."""
    act(table, 'join', starter='elf')
    sid = _sid(table)
    doc = db._get_player(table, sid, 'user-alex')
    ev = db._wild_battle(table, sid, doc, region='cavern')
    assert ev['type'] == 'battle_start'
    doc['battle']['player']['passives'] = sorted(passives)
    return sid, doc


def test_stone_gaze_read_applies_petrify(table, monkeypatch):
    sid, doc = _start_a_fight_as_gorgon(table, ['stonewright', 'stone_gaze'])
    monkeypatch.setattr(db._rng, 'random', lambda: 0.0)   # force a read to land
    start_spd = doc['battle']['npc']['spd']
    db._combat_round(table, sid, doc, {'stance': 'guard'})
    npc = db._get_player(table, sid, 'user-alex')['battle']['npc']
    assert npc['petrify'] == 1
    assert npc['spd'] == max(1, start_spd - data.PETRIFY_SLOW)


def test_no_stone_gaze_no_petrify(table, monkeypatch):
    sid, doc = _start_a_fight_as_gorgon(table, ['stonewright'])  # no gaze
    monkeypatch.setattr(db._rng, 'random', lambda: 0.0)
    db._combat_round(table, sid, doc, {'stance': 'guard'})
    npc = db._get_player(table, sid, 'user-alex')['battle']['npc']
    assert npc.get('petrify', 0) == 0


def test_petrify_threshold_freezes_and_resets(table, monkeypatch):
    sid, doc = _start_a_fight_as_gorgon(table, ['stonewright', 'stone_gaze'])
    # Neutralize enemy-selection variance (the wild foe is drawn from the module
    # rng, which advances across tests): a bulky, feeble foe survives both rounds
    # and can't kill the player, so we isolate the freeze behavior deterministically.
    doc['battle']['npc'].update({'hp': 999, 'maxHp': 999, 'atk': 1, 'def': 1, 'spd': 1})
    # Pre-load one below the freeze threshold (in-memory; _combat_round saves).
    doc['battle']['npc']['petrify'] = data.PETRIFY_FREEZE_AT - 1
    monkeypatch.setattr(db._rng, 'random', lambda: 0.0)   # reads land
    # This round's read pushes petrify up to the threshold.
    db._combat_round(table, sid, doc, {'stance': 'aggress'})
    doc = db._get_player(table, sid, 'user-alex')
    assert doc['battle']['npc']['petrify'] == data.PETRIFY_FREEZE_AT
    # The NEXT round the enemy is frozen: the player's forced win lands, the foe
    # never heals, and the freeze counter drops below the threshold.
    hp_before = doc['battle']['npc']['hp']
    db._combat_round(table, sid, doc, {'stance': 'aggress'})
    npc = db._get_player(table, sid, 'user-alex')['battle']['npc']
    assert npc['petrify'] < data.PETRIFY_FREEZE_AT       # freeze consumed the stacks
    assert npc['hp'] <= hp_before


def test_basalt_has_shatter_and_bruiser_bonus():
    b = data.TIER2['basalt_matron']
    assert b['passive'] == 'shatter'
    assert b['bonus'] == {'atk': 2, 'maxHp': 4}


def _gorgon_apex_at(table, node='city_r0'):
    sid, doc = _player_at(table, node)
    doc['passives'] = ['stonewright']     # a Gorgon…
    doc['tier'] = 3                        # …at apex
    return sid, doc


def test_tier3_gorgon_equips_wildcard(table):
    sid, doc = _gorgon_apex_at(table)
    doc['gear'] = {'fang': 'rusted_fang'}          # already wearing a fang
    doc['gearStash'] = ['rusted_fang']             # a duplicate fang to slot as wildcard
    status, body = db._equip_gear(table, sid, doc, {'index': 0, 'slot': 'wild'})
    assert status == 200
    assert doc['gear']['wild'] == 'rusted_fang'    # duplicate type allowed in wild
    assert engine.effective_stats(doc)['atk'] >= doc['atk'] + 2 * data.GEAR['rusted_fang']['atk']


def test_non_gorgon_cannot_use_wildcard(table):
    sid, doc = _player_at(table, 'city_r0')         # pest, no stonewright
    doc['tier'] = 3
    doc['gearStash'] = ['rusted_fang']
    status, _ = db._equip_gear(table, sid, doc, {'index': 0, 'slot': 'wild'})
    assert status == 409


def test_pre_apex_gorgon_cannot_use_wildcard(table):
    sid, doc = _player_at(table, 'city_r0')
    doc['passives'] = ['stonewright']; doc['tier'] = 2   # Gorgon but not apex
    doc['gearStash'] = ['rusted_fang']
    status, _ = db._equip_gear(table, sid, doc, {'index': 0, 'slot': 'wild'})
    assert status == 409


def test_wildcard_is_stats_only_no_rider(table):
    sid, doc = _gorgon_apex_at(table)
    # seer_charm: rider='seer', readBonus=0.30, spd=1.
    wild = {**doc, 'gear': {'wild': 'seer_charm'}}
    normal = {**doc, 'gear': {'charm': 'seer_charm'}}
    # Rider + readBonus are inert in the wild slot (kills the read-charm → Petrify
    # runaway), but still work in a normal slot…
    assert 'seer' not in db._riders(wild)
    assert 'seer' in db._riders(normal)
    assert 'seer' not in db._rider_mags(wild)
    assert db._read_chance(wild) == db._read_chance(normal) - data.GEAR['seer_charm']['readBonus']
    # …while the raw stat contribution counts the same as any slot.
    assert engine.effective_stats(wild)['spd'] == engine.effective_stats(normal)['spd']
