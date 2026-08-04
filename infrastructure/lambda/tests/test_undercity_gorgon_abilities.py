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
