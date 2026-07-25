"""Unit tests for the shared push subscription store + fan-out."""
import sys
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parents[1]))

import push  # noqa: E402
import push_db  # noqa: E402
from test_undercity_db import FakeTable  # noqa: E402


def _sub(endpoint):
    return {'endpoint': endpoint, 'keys': {'p256dh': 'fake-p256dh', 'auth': 'fake-auth'}}


def test_subscribe_and_lookup():
    t = FakeTable()
    status, body = push_db.handle_push_subscribe(
        t, {'userId': 'u', 'subscription': _sub('https://push.example/a')})
    assert status == 200 and body['ok']
    subs = push_db._subscriptions_for(t, 'u')
    assert len(subs) == 1 and subs[0]['endpoint'] == 'https://push.example/a'


def test_subscribe_rejects_incomplete():
    t = FakeTable()
    status, _ = push_db.handle_push_subscribe(
        t, {'userId': 'u', 'subscription': {'endpoint': 'https://push.example/a'}})
    assert status == 400


def test_unsubscribe_removes():
    t = FakeTable()
    push_db.handle_push_subscribe(t, {'userId': 'u', 'subscription': _sub('https://push.example/a')})
    status, _ = push_db.handle_push_unsubscribe(t, {'userId': 'u', 'endpoint': 'https://push.example/a'})
    assert status == 200
    assert push_db._subscriptions_for(t, 'u') == []


def test_send_to_user_fans_to_all_subscriptions(monkeypatch):
    t = FakeTable()
    push_db.handle_push_subscribe(t, {'userId': 'u', 'subscription': _sub('https://a')})
    push_db.handle_push_subscribe(t, {'userId': 'u', 'subscription': _sub('https://b')})
    sent = []
    monkeypatch.setattr(push, 'send', lambda sub, title, body, url: sent.append(sub['endpoint']))
    push_db.send_to_user(t, 'u', 'T', 'B', '/u')
    assert set(sent) == {'https://a', 'https://b'}


def test_send_to_user_deletes_dead_subscription(monkeypatch):
    t = FakeTable()
    push_db.handle_push_subscribe(t, {'userId': 'u', 'subscription': _sub('https://a')})

    def fake_send(sub, title, body, url):
        raise push.PushGone()
    monkeypatch.setattr(push, 'send', fake_send)
    push_db.send_to_user(t, 'u', 'T', 'B', '/u')
    assert push_db._subscriptions_for(t, 'u') == []


def test_send_to_user_swallows_other_errors(monkeypatch):
    t = FakeTable()
    push_db.handle_push_subscribe(t, {'userId': 'u', 'subscription': _sub('https://a')})

    def fake_send(sub, title, body, url):
        raise RuntimeError('boom')
    monkeypatch.setattr(push, 'send', fake_send)
    push_db.send_to_user(t, 'u', 'T', 'B', '/u')  # must not raise
    assert len(push_db._subscriptions_for(t, 'u')) == 1  # live sub untouched


def test_broadcast_hits_each_recipient(monkeypatch):
    t = FakeTable()
    hits = []
    monkeypatch.setattr(push_db, 'send_to_user',
                        lambda table, uid, title, body, url: hits.append(uid))
    push_db.broadcast(t, ['a', 'b', 'c'], 'T', 'B', '/u')
    assert hits == ['a', 'b', 'c']
