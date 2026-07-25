"""Roll-refill re-engagement nudge: the lastActionAt idle stamp + the sweep."""
from datetime import datetime, timedelta

import undercity_db as db
import undercity_data as data
import undercity_engine as engine
from test_undercity_db import FakeTable, act, _sid


def _table():
    t = FakeTable()
    assert act(t, 'season-start', hostKey='swampking')[0] == 200
    return t


def _join(t, user, name, starter='saproling'):
    assert act(t, 'join', user=user, name=name, starter=starter)[0] == 200


def _set(t, sid, uid, **fields):
    doc = db._get_player(t, sid, uid)
    doc.update(fields)
    db._put_player(t, doc)


def _iso_min_ago(minutes):
    return (datetime.utcnow() - timedelta(minutes=minutes)).strftime(engine._ISO)


# ── Idle stamp ───────────────────────────────────────────────────────────────

def test_action_stamps_last_action_at():
    t = _table()
    _join(t, 'user-alex', 'Alex')
    sid = _sid(t)
    # A post-join player action stamps lastActionAt (join itself returns before
    # the shared pre-dispatch block, so it doesn't).
    act(t, 'set-status', user='user-alex', name='Alex', status='hi')
    assert db._get_player(t, sid, 'user-alex').get('lastActionAt')


# ── Sweep ────────────────────────────────────────────────────────────────────

def test_sweep_nudges_idle_player_at_threshold(monkeypatch):
    t = _table()
    _join(t, 'user-sam', 'Sam')
    sid = _sid(t)
    # Idle for an hour, sitting at threshold rolls.
    _set(t, sid, 'user-sam', rolls=data.ROLL_NUDGE_THRESHOLD,
         rollNudged=False, lastActionAt=_iso_min_ago(60),
         rollRegenAt=_iso_min_ago(60))
    calls = []
    monkeypatch.setattr(db, '_push_user',
                        lambda table, uid, body: calls.append((uid, body)))
    db.sweep_roll_refills(t)
    assert len(calls) == 1 and calls[0][0] == 'user-sam'
    assert db._get_player(t, sid, 'user-sam')['rollNudged'] is True


def test_sweep_skips_recently_active_player(monkeypatch):
    t = _table()
    _join(t, 'user-sam', 'Sam')
    sid = _sid(t)
    _set(t, sid, 'user-sam', rolls=data.ROLL_NUDGE_THRESHOLD,
         rollNudged=False, lastActionAt=_iso_min_ago(1))  # acted 1 min ago
    calls = []
    monkeypatch.setattr(db, '_push_user',
                        lambda table, uid, body: calls.append(uid))
    db.sweep_roll_refills(t)
    assert calls == []
    assert db._get_player(t, sid, 'user-sam').get('rollNudged') in (False, None)


def test_sweep_does_not_double_notify(monkeypatch):
    t = _table()
    _join(t, 'user-sam', 'Sam')
    sid = _sid(t)
    _set(t, sid, 'user-sam', rolls=data.ROLL_NUDGE_THRESHOLD,
         rollNudged=True, lastActionAt=_iso_min_ago(60))  # already nudged
    calls = []
    monkeypatch.setattr(db, '_push_user',
                        lambda table, uid, body: calls.append(uid))
    db.sweep_roll_refills(t)
    assert calls == []


def test_sweep_rearms_flag_below_threshold(monkeypatch):
    t = _table()
    _join(t, 'user-sam', 'Sam')
    sid = _sid(t)
    _set(t, sid, 'user-sam', rolls=0, rollNudged=True,
         lastActionAt=_iso_min_ago(60), rollRegenAt=_iso_min_ago(1))
    monkeypatch.setattr(db, '_push_user', lambda table, uid, body: None)
    db.sweep_roll_refills(t)
    assert db._get_player(t, sid, 'user-sam')['rollNudged'] is False


def test_sweep_noop_without_active_season(monkeypatch):
    t = FakeTable()  # no season started
    calls = []
    monkeypatch.setattr(db, '_push_user', lambda table, uid, body: calls.append(uid))
    db.sweep_roll_refills(t)  # must not raise
    assert calls == []


def test_sweep_no_write_when_nothing_changes(monkeypatch):
    t = _table()
    _join(t, 'user-sam', 'Sam')
    sid = _sid(t)
    # Below threshold, not nudged, idle: nothing to do — no push, no flag write.
    _set(t, sid, 'user-sam', rolls=0, rollNudged=False,
         lastActionAt=_iso_min_ago(60), rollRegenAt=_iso_min_ago(1))
    writes = []
    real_put = db._put_player
    monkeypatch.setattr(db, '_put_player',
                        lambda table, doc: (writes.append(doc['userId']), real_put(table, doc))[1])
    monkeypatch.setattr(db, '_push_user', lambda table, uid, body: None)
    db.sweep_roll_refills(t)
    assert writes == []
