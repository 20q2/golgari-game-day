"""Integration tests for the wilderness World Event ("The Great Beast").

Uses the same in-memory FakeTable + `act` dispatcher helper as
test_undercity_db.py, and the real season/state entrypoints.
"""
import undercity_db as db
import undercity_data as data
from test_undercity_db import FakeTable, act


def _started_table():
    t = FakeTable()
    status, _ = act(t, 'season-start', hostKey='swampking')
    assert status == 200
    return t


def _sid(table):
    sid, _ = db._active_season(table)
    return sid


def _join(table, user, name, home='cavern', starter='saproling'):
    status, resp = act(table, 'join', user=user, name=name, home=home, starter=starter)
    assert status == 200, resp
    return resp['you']


def _place_live_event(table, sid):
    """Spawn the event off the real map and return its record (real node ids)."""
    db._spawn_world_event(table, sid)
    return db._world_event(table, sid)


# ── Task 3: helpers + footprint picker ───────────────────────────────────────

def test_pick_world_event_run_is_connected_wilderness_triple():
    nodes = data.MAP_NODES
    run = db._pick_world_event_run(nodes)
    assert run is not None and len(run) == 3
    a, center, c = run
    for nid in run:
        assert nodes[nid]['region'] == 'wilderness'
    assert a in nodes[center]['neighbors']
    assert c in nodes[center]['neighbors']
    assert a != c


def test_world_event_state_round_trip():
    table = _started_table()
    sid = _sid(table)
    assert db._world_event(table, sid) is None
    rec = {'spawned': True, 'node': 'x', 'nodes': ['a', 'x', 'b'],
           'hp': 200, 'maxHp': 200, 'dmg': {}, 'dead': False}
    db._set_world_event(table, sid, rec)
    got = db._world_event(table, sid)
    assert got['hp'] == 200 and got['nodes'] == ['a', 'x', 'b']
