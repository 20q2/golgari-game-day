"""Enraged wilderness monster tests (specs/2026-07-30-undercity-enraged-monsters-design.md)."""
import sys
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parents[1]))

import pytest

import undercity_data as data
import undercity_db as db

from test_undercity_db import FakeTable, act


@pytest.fixture
def table():
    t = FakeTable()
    status, _ = act(t, 'season-start', hostKey='swampking')
    assert status == 200
    return t


def _sid(table):
    sid, _ = db._active_season(table)
    return sid


def test_roster_shape():
    assert len(data.ENRAGED_MONSTERS) == 4
    assert data.ENRAGED_ORDER == sorted(data.ENRAGED_MONSTERS)
    for mid, m in data.ENRAGED_MONSTERS.items():
        assert m['id'] == mid
        assert 36 <= m['hp'] <= 44, mid
        assert 15 <= m['bounty'] <= 20, mid
        assert m['xp'] >= 25
        for stat in ('atk', 'def', 'spd'):
            assert m[stat] >= 1
    assert 'enraged' in data.GEAR_DROP


def test_window_and_pick_are_deterministic():
    from datetime import datetime
    now = datetime(2026, 7, 30, 12, 0, 0)
    win = db._enraged_window(now)
    # Same window -> identical node + monster, every call, every client.
    assert db._enraged_node(win) == db._enraged_node(win)
    assert db._enraged_monster(win) == db._enraged_monster(win)
    # The pick is a real wilderness node and a real roster id.
    assert db._enraged_node(win) in data.UMORI_NODES
    assert db._enraged_monster(win) in data.ENRAGED_MONSTERS


def test_enraged_node_avoids_umori():
    # For any window, the enraged node never collides with Umori's node computed
    # for the umori-window that contains this enraged window's start.
    for win in range(0, 200):
        umori_win = (win * data.ENRAGED_DWELL_MIN) // data.UMORI_DWELL_MIN
        assert db._enraged_node(win) != db._umori_node(umori_win), win


def test_window_advances_with_time():
    from datetime import datetime, timedelta
    now = datetime(2026, 7, 30, 12, 0, 0)
    win = db._enraged_window(now)
    later = now + timedelta(minutes=data.ENRAGED_DWELL_MIN)
    assert db._enraged_window(later) == win + 1


def test_state_spawns_fresh_and_persists_in_window(table):
    sid = _sid(table)
    rec = db._enraged_state(table, sid)
    assert rec['monsterId'] in data.ENRAGED_MONSTERS
    spec = data.ENRAGED_MONSTERS[rec['monsterId']]
    assert rec['hp'] == spec['hp'] == rec['maxHp']
    assert rec['dead'] is False
    assert rec['node'] == db._enraged_node(rec['window'])
    # A second read in the same window returns the SAME record, not a re-roll.
    rec2 = db._enraged_state(table, sid)
    assert rec2['window'] == rec['window'] and rec2['node'] == rec['node']


def test_dead_stays_dead_until_window_rolls(table):
    sid = _sid(table)
    rec = db._enraged_state(table, sid)
    rec['dead'] = True
    rec['hp'] = 0
    db._set_enraged_state(table, sid, rec)
    # Same window -> still dead (spot stays empty).
    assert db._enraged_state(table, sid)['dead'] is True


def test_stale_window_rolls_over_to_fresh_spawn(table):
    sid = _sid(table)
    rec = db._enraged_state(table, sid)
    # Force a stale, wounded, dead record from a prior window.
    rec['window'] -= 1
    rec['hp'] = 0
    rec['dead'] = True
    db._set_enraged_state(table, sid, rec)
    fresh = db._enraged_state(table, sid)
    assert fresh['window'] == db._enraged_window()
    assert fresh['dead'] is False
    spec = data.ENRAGED_MONSTERS[fresh['monsterId']]
    assert fresh['hp'] == spec['hp']
