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
    # Call the dispatcher directly (not the `act` helper) so an admin payload
    # key like `name` (the bot's name) can't collide with act()'s username kwarg.
    return db.handle_action(table, {
        'type': 'admin', 'userId': 'user-host', 'username': 'Host',
        'payload': {'cmd': cmd, 'hostKey': host, **payload}})


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


def test_bot_add_creates_public_player(table):
    status, resp = _admin(table, 'bot-add', species='saproling', home='cavern',
                          name='Mossy')
    assert status == 200
    bot = resp['bot']
    assert bot['isBot'] is True
    assert bot['species'] == 'saproling'
    assert bot['userId'].startswith('BOT#')
    assert bot['hp'] == 25 and bot['position'] == 'cavern_r0'

    # It appears in the season roster like any player.
    _, state = db.handle_state(table, {'userId': 'user-host'})
    ids = [p['userId'] for p in state['players']]
    assert bot['userId'] in ids
    assert any(p.get('isBot') for p in state['players'])


def test_bot_add_random_species_and_home(table):
    status, resp = _admin(table, 'bot-add')  # no species/home => random
    assert status == 200
    bot = resp['bot']
    assert bot['species'] in data.STARTERS
    assert bot['isBot'] is True


def test_bot_add_rejects_bad_species(table):
    status, resp = _admin(table, 'bot-add', species='dragon')
    assert status == 400


def _join_alex(table):
    status, resp = act(table, 'join', user='user-alex', name='Alex',
                       starter='pest', home='city')
    assert status == 200
    return resp['you']


def test_grant_rolls_spores_and_xp_levels_up(table):
    _join_alex(table)
    status, resp = _admin(table, 'grant', target='user-alex',
                          rolls=5, spores=10, xp=1000)
    assert status == 200 and resp['ok'] is True
    _, state = db.handle_state(table, {'userId': 'user-alex'})
    me = state['you']
    assert me['rolls'] == 3 + 5
    assert me['spores'] == 10   # City Rat now grants gear, not spores; +10 granted
    assert me['level'] > 1           # 1000 xp forces level-ups


def test_grant_unknown_target(table):
    status, resp = _admin(table, 'grant', target='nobody', rolls=1)
    assert status == 400
    assert 'no such player' in resp['error'].lower()


def test_heal_restores_full_hp(table):
    _join_alex(table)
    # Wound Alex directly, then heal.
    doc = db._get_player(table, db._active_season(table)[0], 'user-alex')
    doc['hp'] = 1
    db._put_player(table, doc)
    status, resp = _admin(table, 'heal', target='user-alex')
    assert status == 200
    healed = db._get_player(table, db._active_season(table)[0], 'user-alex')
    assert healed['hp'] == healed['maxHp']


def test_teleport_moves_to_valid_node(table):
    _join_alex(table)
    dest = next(iter(data.MAP_NODES))
    status, resp = _admin(table, 'teleport', target='user-alex', node=dest)
    assert status == 200
    moved = db._get_player(table, db._active_season(table)[0], 'user-alex')
    assert moved['position'] == dest


def test_teleport_rejects_bad_node(table):
    _join_alex(table)
    status, resp = _admin(table, 'teleport', target='user-alex', node='atlantis')
    assert status == 400


def test_kick_removes_player(table):
    _join_alex(table)
    status, resp = _admin(table, 'kick', target='user-alex')
    assert status == 200 and resp['removed'] == 'user-alex'
    _, state = db.handle_state(table, {'userId': 'user-alex'})
    ids = [p['userId'] for p in state['players']]
    assert 'user-alex' not in ids


def test_kick_bot(table):
    _, resp = _admin(table, 'bot-add', species='pest', home='city')
    bot_id = resp['bot']['userId']
    status, resp = _admin(table, 'kick', target=bot_id)
    assert status == 200
    _, state = db.handle_state(table, {'userId': 'user-host'})
    assert bot_id not in [p['userId'] for p in state['players']]


def test_bot_step_moves_bot_off_its_gate(table):
    _, resp = _admin(table, 'bot-add', species='pest', home='city')
    bot_id = resp['bot']['userId']
    start = resp['bot']['position']
    status, resp = _admin(table, 'bot-step', target=bot_id)
    assert status == 200 and resp['ok'] is True
    moved = db._get_player(table, db._active_season(table)[0], bot_id)
    assert moved['position'] != start          # it actually shifted
    assert moved['position'] in data.MAP_NODES  # to a real node


def test_bot_step_rejects_non_bot(table):
    _join_alex(table)
    status, resp = _admin(table, 'bot-step', target='user-alex')
    assert status == 400
    assert 'bot' in resp['error'].lower()
