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
    act(table, 'join', starter='gorgon')
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
