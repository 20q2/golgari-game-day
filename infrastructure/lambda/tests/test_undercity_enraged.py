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
