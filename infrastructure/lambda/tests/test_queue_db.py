"""Integration tests for the game-night queue against an in-memory table."""
import sys
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parents[1]))

import push
import queue_db as q
from test_undercity_db import FakeTable, act as uc_act


def start_night(table, host_key='swampking'):
    status, resp = uc_act(table, 'season-start', hostKey=host_key)
    assert status == 200
    return resp['seasonId']


def test_state_with_no_active_season():
    t = FakeTable()
    status, body = q.handle_state(t, {})
    assert status == 200
    assert body == {'seasonId': None, 'entries': []}


def test_join_creates_entry_and_auto_joins_adder():
    t = FakeTable()
    sid = start_night(t)
    status, body = q.handle_action(t, {
        'type': 'join', 'userId': 'user-alex', 'username': 'Alex',
        'payload': {'gameId': 'catan', 'gameTitle': 'Catan'},
    })
    assert status == 200
    entry = body['entry']
    assert entry['gameId'] == 'catan'
    assert entry['gameTitle'] == 'Catan'
    assert entry['addedBy'] == 'user-alex'
    assert entry['joined'] == [{'userId': 'user-alex', 'username': 'Alex'}]

    status, body = q.handle_state(t, {})
    assert status == 200
    assert body['seasonId'] == sid
    assert len(body['entries']) == 1
    assert body['entries'][0]['gameId'] == 'catan'


def test_second_join_merges_into_existing_entry():
    t = FakeTable()
    start_night(t)
    q.handle_action(t, {'type': 'join', 'userId': 'user-alex', 'username': 'Alex',
                         'payload': {'gameId': 'catan', 'gameTitle': 'Catan'}})
    status, body = q.handle_action(t, {'type': 'join', 'userId': 'user-sam', 'username': 'Sam',
                                        'payload': {'gameId': 'catan'}})
    assert status == 200
    joined_ids = {m['userId'] for m in body['entry']['joined']}
    assert joined_ids == {'user-alex', 'user-sam'}
    # gameTitle set on creation is preserved even though the second join omitted it.
    assert body['entry']['gameTitle'] == 'Catan'

    status, body = q.handle_state(t, {})
    assert len(body['entries']) == 1  # still one entry, not two


def test_rejoin_is_idempotent():
    t = FakeTable()
    start_night(t)
    q.handle_action(t, {'type': 'join', 'userId': 'user-alex', 'username': 'Alex',
                         'payload': {'gameId': 'catan', 'gameTitle': 'Catan'}})
    status, body = q.handle_action(t, {'type': 'join', 'userId': 'user-alex', 'username': 'Alex',
                                        'payload': {'gameId': 'catan'}})
    assert status == 200
    assert len(body['entry']['joined']) == 1


def test_leave_removes_member_but_keeps_entry():
    t = FakeTable()
    start_night(t)
    q.handle_action(t, {'type': 'join', 'userId': 'user-alex', 'username': 'Alex',
                         'payload': {'gameId': 'catan', 'gameTitle': 'Catan'}})
    q.handle_action(t, {'type': 'join', 'userId': 'user-sam', 'username': 'Sam',
                         'payload': {'gameId': 'catan'}})
    status, body = q.handle_action(t, {'type': 'leave', 'userId': 'user-sam', 'username': 'Sam',
                                        'payload': {'gameId': 'catan'}})
    assert status == 200
    assert [m['userId'] for m in body['entry']['joined']] == ['user-alex']


def test_leave_by_last_member_deletes_entry():
    t = FakeTable()
    start_night(t)
    q.handle_action(t, {'type': 'join', 'userId': 'user-alex', 'username': 'Alex',
                         'payload': {'gameId': 'catan', 'gameTitle': 'Catan'}})
    status, body = q.handle_action(t, {'type': 'leave', 'userId': 'user-alex', 'username': 'Alex',
                                        'payload': {'gameId': 'catan'}})
    assert status == 200
    assert body['entry'] is None

    status, body = q.handle_state(t, {})
    assert body['entries'] == []


def test_actions_rejected_with_no_active_season():
    t = FakeTable()
    status, body = q.handle_action(t, {'type': 'join', 'userId': 'user-alex', 'username': 'Alex',
                                        'payload': {'gameId': 'catan', 'gameTitle': 'Catan'}})
    assert status == 409
    assert 'error' in body


def test_leave_unknown_entry_is_404():
    t = FakeTable()
    start_night(t)
    status, body = q.handle_action(t, {'type': 'leave', 'userId': 'user-alex', 'username': 'Alex',
                                        'payload': {'gameId': 'nope'}})
    assert status == 404


def test_missing_game_id_is_400():
    t = FakeTable()
    start_night(t)
    status, body = q.handle_action(t, {'type': 'join', 'userId': 'user-alex', 'username': 'Alex',
                                        'payload': {}})
    assert status == 400


def test_unknown_action_type():
    t = FakeTable()
    start_night(t)
    status, body = q.handle_action(t, {'type': 'nonsense', 'userId': 'user-alex',
                                        'username': 'Alex', 'payload': {}})
    assert status == 400


def _subscription(endpoint='https://push.example/abc123'):
    return {
        'endpoint': endpoint,
        'keys': {'p256dh': 'fake-p256dh', 'auth': 'fake-auth'},
    }


def test_push_subscribe_stores_subscription():
    t = FakeTable()
    status, body = q.handle_push_subscribe(t, {
        'userId': 'user-alex', 'subscription': _subscription(),
    })
    assert status == 200 and body['ok']

    subs = q._subscriptions_for(t, 'user-alex')
    assert len(subs) == 1
    assert subs[0]['endpoint'] == 'https://push.example/abc123'
    assert subs[0]['keys']['p256dh'] == 'fake-p256dh'


def test_push_subscribe_rejects_incomplete_subscription():
    t = FakeTable()
    status, body = q.handle_push_subscribe(t, {
        'userId': 'user-alex', 'subscription': {'endpoint': 'https://push.example/abc123'},
    })
    assert status == 400


def test_push_unsubscribe_removes_subscription():
    t = FakeTable()
    q.handle_push_subscribe(t, {'userId': 'user-alex', 'subscription': _subscription()})
    status, body = q.handle_push_unsubscribe(t, {
        'userId': 'user-alex', 'endpoint': 'https://push.example/abc123',
    })
    assert status == 200
    assert q._subscriptions_for(t, 'user-alex') == []


def test_join_notifies_other_lobby_members(monkeypatch):
    sent = []
    monkeypatch.setattr(push, 'send', lambda sub, message, game_id: sent.append(
        (sub['endpoint'], message, game_id)))

    t = FakeTable()
    start_night(t)
    q.handle_action(t, {'type': 'join', 'userId': 'user-alex', 'username': 'Alex',
                         'payload': {'gameId': 'catan', 'gameTitle': 'Catan'}})
    q.handle_push_subscribe(t, {'userId': 'user-alex', 'subscription': _subscription()})

    assert sent == []  # first join: no one else in the lobby yet

    status, body = q.handle_action(t, {'type': 'join', 'userId': 'user-sam', 'username': 'Sam',
                                        'payload': {'gameId': 'catan'}})
    assert status == 200
    assert len(sent) == 1
    endpoint, message, game_id = sent[0]
    assert endpoint == 'https://push.example/abc123'  # sent to Alex, not the joiner (Sam)
    assert 'Sam' in message and 'Catan' in message
    assert game_id == 'catan'


def test_rejoin_does_not_renotify(monkeypatch):
    sent = []
    monkeypatch.setattr(push, 'send', lambda sub, message, game_id: sent.append(1))

    t = FakeTable()
    start_night(t)
    q.handle_action(t, {'type': 'join', 'userId': 'user-alex', 'username': 'Alex',
                         'payload': {'gameId': 'catan', 'gameTitle': 'Catan'}})
    q.handle_push_subscribe(t, {'userId': 'user-alex', 'subscription': _subscription()})
    q.handle_action(t, {'type': 'join', 'userId': 'user-sam', 'username': 'Sam',
                         'payload': {'gameId': 'catan'}})
    assert len(sent) == 1

    q.handle_action(t, {'type': 'join', 'userId': 'user-sam', 'username': 'Sam',
                         'payload': {'gameId': 'catan'}})
    assert len(sent) == 1  # re-join is a no-op, no second push


def test_dead_subscription_is_deleted_on_push_failure(monkeypatch):
    def fake_send(sub, message, game_id):
        raise push.PushGone()
    monkeypatch.setattr(push, 'send', fake_send)

    t = FakeTable()
    start_night(t)
    q.handle_action(t, {'type': 'join', 'userId': 'user-alex', 'username': 'Alex',
                         'payload': {'gameId': 'catan', 'gameTitle': 'Catan'}})
    q.handle_push_subscribe(t, {'userId': 'user-alex', 'subscription': _subscription()})

    status, body = q.handle_action(t, {'type': 'join', 'userId': 'user-sam', 'username': 'Sam',
                                        'payload': {'gameId': 'catan'}})
    assert status == 200  # the join itself still succeeds
    assert q._subscriptions_for(t, 'user-alex') == []  # but the dead subscription is gone


def test_join_survives_broken_push_send(monkeypatch):
    """A web-push send that raises an unexpected error (bad VAPID key, network
    failure, etc.) must not fail the join — notifications are best-effort."""
    def fake_send(sub, message, game_id):
        raise RuntimeError('boom')
    monkeypatch.setattr(push, 'send', fake_send)

    t = FakeTable()
    start_night(t)
    q.handle_action(t, {'type': 'join', 'userId': 'user-alex', 'username': 'Alex',
                         'payload': {'gameId': 'catan', 'gameTitle': 'Catan'}})
    q.handle_push_subscribe(t, {'userId': 'user-alex', 'subscription': _subscription()})

    status, body = q.handle_action(t, {'type': 'join', 'userId': 'user-sam', 'username': 'Sam',
                                        'payload': {'gameId': 'catan'}})
    assert status == 200  # join succeeds despite the send blowing up
    # The still-valid subscription is left alone (only PushGone deletes it).
    assert len(q._subscriptions_for(t, 'user-alex')) == 1


def test_new_entry_is_lobby_status():
    t = FakeTable()
    start_night(t)
    _, body = q.handle_action(t, {'type': 'join', 'userId': 'user-alex', 'username': 'Alex',
                                   'payload': {'gameId': 'catan', 'gameTitle': 'Catan'}})
    assert body['entry']['status'] == 'lobby'


def test_start_flips_to_active():
    t = FakeTable()
    start_night(t)
    q.handle_action(t, {'type': 'join', 'userId': 'user-alex', 'username': 'Alex',
                         'payload': {'gameId': 'catan', 'gameTitle': 'Catan'}})
    status, body = q.handle_action(t, {'type': 'start', 'userId': 'user-alex',
                                        'username': 'Alex', 'payload': {'gameId': 'catan'}})
    assert status == 200
    assert body['entry']['status'] == 'active'

    # Idempotent: starting again is a no-op that still reports active.
    status, body = q.handle_action(t, {'type': 'start', 'userId': 'user-alex',
                                        'username': 'Alex', 'payload': {'gameId': 'catan'}})
    assert status == 200 and body['entry']['status'] == 'active'


def test_start_requires_membership():
    t = FakeTable()
    start_night(t)
    q.handle_action(t, {'type': 'join', 'userId': 'user-alex', 'username': 'Alex',
                         'payload': {'gameId': 'catan', 'gameTitle': 'Catan'}})
    status, body = q.handle_action(t, {'type': 'start', 'userId': 'user-outsider',
                                        'username': 'Nope', 'payload': {'gameId': 'catan'}})
    assert status == 403


def test_join_rejected_once_active():
    t = FakeTable()
    start_night(t)
    q.handle_action(t, {'type': 'join', 'userId': 'user-alex', 'username': 'Alex',
                         'payload': {'gameId': 'catan', 'gameTitle': 'Catan'}})
    q.handle_action(t, {'type': 'start', 'userId': 'user-alex', 'username': 'Alex',
                         'payload': {'gameId': 'catan'}})
    status, body = q.handle_action(t, {'type': 'join', 'userId': 'user-sam', 'username': 'Sam',
                                        'payload': {'gameId': 'catan'}})
    assert status == 409


def test_start_unknown_entry_404():
    t = FakeTable()
    start_night(t)
    status, body = q.handle_action(t, {'type': 'start', 'userId': 'user-alex',
                                        'username': 'Alex', 'payload': {'gameId': 'nope'}})
    assert status == 404
