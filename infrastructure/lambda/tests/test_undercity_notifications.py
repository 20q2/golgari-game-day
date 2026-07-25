"""The seven Undercity push-notification hooks + wrappers.

Each test patches the push_db seam (send_to_user / broadcast) and drives the
real game code, asserting who would be notified and with what copy.
"""
import undercity_db as db
import undercity_data as data
from test_undercity_db import FakeTable, act, _sid


def _table():
    t = FakeTable()
    assert act(t, 'season-start', hostKey='swampking')[0] == 200
    return t


def _join(t, user, name, starter='saproling'):
    assert act(t, 'join', user=user, name=name, starter=starter)[0] == 200


def test_push_user_uses_undercity_title_and_url(monkeypatch):
    t = _table()
    calls = []
    monkeypatch.setattr(db.push_db, 'send_to_user',
                        lambda table, uid, title, body, url: calls.append((uid, title, body, url)))
    db._push_user(t, 'user-sam', 'hello')
    assert calls == [('user-sam', 'The Undercity', 'hello', '/golgari-game-day/undercity')]


def test_push_broadcast_reaches_all_players_except_excluded(monkeypatch):
    t = _table()
    _join(t, 'user-alex', 'Alex')
    _join(t, 'user-sam', 'Sam')
    _join(t, 'user-pat', 'Pat')
    sent = []
    monkeypatch.setattr(db.push_db, 'broadcast',
                        lambda table, ids, title, body, url: sent.append(set(ids)))
    db._push_broadcast(t, _sid(t), 'to arms', exclude_user_id='user-alex')
    assert sent == [{'user-sam', 'user-pat'}]


def test_push_broadcast_none_reaches_everyone(monkeypatch):
    t = _table()
    _join(t, 'user-alex', 'Alex')
    _join(t, 'user-sam', 'Sam')
    sent = []
    monkeypatch.setattr(db.push_db, 'broadcast',
                        lambda table, ids, title, body, url: sent.append(set(ids)))
    db._push_broadcast(t, _sid(t), 'everyone')
    assert sent == [{'user-alex', 'user-sam'}]
