"""Integration tests for the host admin command surface."""
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


def _admin(table, cmd, host='swampking', **payload):
    return act(table, 'admin', user='user-host', name='Host',
               cmd=cmd, hostKey=host, **payload)


def test_admin_rejects_wrong_hostkey(table):
    status, resp = _admin(table, 'broadcast', host='nope', text='hi')
    assert status == 403
    assert 'passphrase' in resp['error'].lower()


def test_broadcast_posts_event(table):
    status, resp = _admin(table, 'broadcast', text='The swarm gathers.')
    assert status == 200 and resp['ok'] is True
    _, state = db.handle_state(table, {'userId': 'user-host'})
    assert any(e['text'] == 'The swarm gathers.' for e in state['events'])


def test_broadcast_requires_text(table):
    status, resp = _admin(table, 'broadcast', text='   ')
    assert status == 400


def test_unknown_admin_cmd(table):
    status, resp = _admin(table, 'frobnicate')
    assert status == 400
