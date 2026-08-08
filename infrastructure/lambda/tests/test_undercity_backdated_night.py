"""Host recovery tool: start a fresh night stamped with a backdated startedAt,
so a fresh character seeds its roll bank as if the night had begun then.

See specs/2026-08-08-undercity-backdated-night-design.md.
"""
import sys
from datetime import datetime, timedelta
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parents[1]))

import pytest

import undercity_data as data
import undercity_db as db
from test_undercity_db import FakeTable, act


def _iso_ago(minutes):
    return (datetime.utcnow() - timedelta(minutes=minutes)).isoformat(timespec='seconds')


@pytest.fixture
def table():
    t = FakeTable()
    assert act(t, 'season-start', hostKey='swampking')[0] == 200
    return t


def test_backdated_start_stamps_config(table):
    started = _iso_ago(120)
    status, resp = act(table, 'season-start', hostKey='swampking', startedAt=started)
    assert status == 200
    _, config = db._active_season(table)
    assert config['startedAt'] == started


def test_fresh_char_seeded_to_cap_on_two_hour_backdate(table):
    # Night backdated 2h → a fresh joiner accrues past ROLL_CAP and lands at the cap.
    act(table, 'season-start', hostKey='swampking', startedAt=_iso_ago(120))
    status, resp = act(table, 'join', user='user-alex', name='Alex',
                       starter='pest', home='city')
    assert status == 200
    assert resp['you']['rolls'] == data.ROLL_CAP


def test_fresh_char_seeded_partially_on_small_backdate(table):
    # 40 min back = one full 30-min regen tick over JOIN_ROLLS: 3 + 3 = 6, under cap.
    act(table, 'season-start', hostKey='swampking', startedAt=_iso_ago(40))
    status, resp = act(table, 'join', user='user-bea', name='Bea',
                       starter='pest', home='city')
    assert status == 200
    rolls = resp['you']['rolls']
    assert rolls == data.JOIN_ROLLS + data.ROLLS_PER_REGEN
    assert rolls < data.ROLL_CAP


def test_omitting_started_at_preserves_join_rolls(table):
    # No backdate → night starts now → fresh char gets only JOIN_ROLLS.
    act(table, 'season-start', hostKey='swampking')
    status, resp = act(table, 'join', user='user-cy', name='Cy',
                       starter='pest', home='city')
    assert status == 200
    assert resp['you']['rolls'] == data.JOIN_ROLLS


def test_future_started_at_rejected(table):
    future = (datetime.utcnow() + timedelta(hours=1)).isoformat(timespec='seconds')
    status, resp = act(table, 'season-start', hostKey='swampking', startedAt=future)
    assert status == 400
    assert 'future' in resp['error'].lower()


def test_non_iso_started_at_rejected(table):
    status, resp = act(table, 'season-start', hostKey='swampking', startedAt='sometime')
    assert status == 400
    assert 'iso' in resp['error'].lower()


def test_started_at_with_z_suffix_normalized(table):
    # The client sends new Date(...).toISOString() -> trailing Z + millis; it must
    # be normalized to the naive-seconds form _now() uses, and still seed to cap.
    z = (datetime.utcnow() - timedelta(minutes=120)).isoformat(timespec='milliseconds') + 'Z'
    status, _ = act(table, 'season-start', hostKey='swampking', startedAt=z)
    assert status == 200
    _, config = db._active_season(table)
    assert 'Z' not in config['startedAt'] and '.' not in config['startedAt']
    status, resp = act(table, 'join', user='user-dee', name='Dee',
                       starter='pest', home='city')
    assert resp['you']['rolls'] == data.ROLL_CAP
