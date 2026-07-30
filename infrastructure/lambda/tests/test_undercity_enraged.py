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
