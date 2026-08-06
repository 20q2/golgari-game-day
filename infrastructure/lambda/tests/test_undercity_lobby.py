"""Integration tests for the 'Waiting to launch' lobby season state."""
import sys
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parents[1]))

import undercity_db as db
from test_undercity_db import FakeTable, act  # noqa: E402

LAUNCH = '2026-08-06T19:30:00Z'


def test_season_lobby_creates_lobby_and_reports_launch_at():
    t = FakeTable()
    status, resp = act(t, 'season-lobby', hostKey='swampking', launchAt=LAUNCH)
    assert status == 200
    assert resp['ok'] is True and resp['launchAt'] == LAUNCH
    sid, config = db._active_season(t)
    assert config['status'] == 'lobby'
    # State exposes the countdown target to the client.
    status, state = db.handle_state(t, {'userId': 'user-alex'})
    assert status == 200
    assert state['season']['status'] == 'lobby'
    assert state['season']['launchAt'] == LAUNCH


def test_lobby_blocks_gameplay_actions():
    t = FakeTable()
    act(t, 'season-lobby', hostKey='swampking', launchAt=LAUNCH)
    status, resp = act(t, 'join', starter='saproling', home='cavern')
    assert status == 409
    status, resp = act(t, 'roll')
    assert status == 409


def test_season_lobby_refused_while_night_active():
    t = FakeTable()
    act(t, 'season-start', hostKey='swampking')  # night is live
    status, resp = act(t, 'season-lobby', hostKey='swampking', launchAt=LAUNCH)
    assert status == 409
    # The active night is untouched.
    _, config = db._active_season(t)
    assert config['status'] == 'active'


def test_season_lobby_resubmit_updates_time_same_season():
    t = FakeTable()
    act(t, 'season-lobby', hostKey='swampking', launchAt=LAUNCH)
    sid1, _ = db._active_season(t)
    later = '2026-08-06T20:15:00Z'
    status, resp = act(t, 'season-lobby', hostKey='swampking', launchAt=later)
    assert status == 200
    sid2, config = db._active_season(t)
    assert sid2 == sid1  # same lobby, pushed back
    assert config['launchAt'] == later


def test_season_lobby_wrong_passphrase_is_403():
    t = FakeTable()
    act(t, 'season-lobby', hostKey='swampking', launchAt=LAUNCH)
    status, resp = act(t, 'season-lobby', hostKey='intruder', launchAt=LAUNCH)
    assert status == 403


def test_season_lobby_requires_valid_launch_at():
    t = FakeTable()
    status, resp = act(t, 'season-lobby', hostKey='swampking', launchAt='not-a-date')
    assert status == 400
    status, resp = act(t, 'season-lobby', hostKey='swampking')
    assert status == 400


def test_season_start_promotes_lobby_in_place():
    t = FakeTable()
    act(t, 'season-lobby', hostKey='swampking', launchAt=LAUNCH)
    sid_lobby, _ = db._active_season(t)
    status, resp = act(t, 'season-start', hostKey='swampking')
    assert status == 200
    sid_active, config = db._active_season(t)
    assert sid_active == sid_lobby          # same season, promoted in place
    assert config['status'] == 'active'
    assert config.get('startedAt')          # start time stamped
    # In-place promotion carries the lobby config forward (a fresh mint would
    # drop launchAt) — proves it wasn't just a same-second sid collision.
    assert config.get('launchAt') == LAUNCH
    # A player can now actually join the promoted night.
    status, resp = act(t, 'join', starter='saproling', home='cavern')
    assert status == 200
