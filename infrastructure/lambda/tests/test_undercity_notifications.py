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


# ── Personal hooks (Task 5) ──────────────────────────────────────────────────

def test_board_reward_pushes_rolls_to_recipient(monkeypatch):
    t = _table()
    _join(t, 'user-sam', 'Sam')
    calls = []
    monkeypatch.setattr(db.push_db, 'send_to_user',
                        lambda table, uid, title, body, url: calls.append((uid, body)))
    db._grant_to_player(t, _sid(t), 'user-sam', is_winner=False, game_name='Catan')
    assert len(calls) == 1
    uid, body = calls[0]
    assert uid == 'user-sam'
    assert 'roll' in body.lower() and 'Catan' in body


def test_market_sale_pushes_to_seller(monkeypatch):
    t = _table()
    _join(t, 'user-sam', 'Sam')
    calls = []
    monkeypatch.setattr(db.push_db, 'send_to_user',
                        lambda table, uid, title, body, url: calls.append((uid, body)))
    entry = {'kind': 'market', 'at': db._now(),
             'text': 'Alex bought your Rusty Blade for 10 Spores.'}
    assert db._credit_market_seller(t, _sid(t), 'user-sam', 10, entry) is True
    assert calls == [('user-sam', 'Alex bought your Rusty Blade for 10 Spores.')]


def test_poke_pushes_to_target(monkeypatch):
    t = _table()
    _join(t, 'user-alex', 'Alex')
    _join(t, 'user-sam', 'Sam')
    calls = []
    monkeypatch.setattr(db.push_db, 'send_to_user',
                        lambda table, uid, title, body, url: calls.append((uid, body)))
    status, _ = act(t, 'poke', user='user-alex', name='Alex', targetUserId='user-sam')
    assert status == 200
    assert len(calls) == 1
    uid, body = calls[0]
    assert uid == 'user-sam'
    assert 'poked' in body.lower()


# ── Broadcast hooks (Task 6) ─────────────────────────────────────────────────

def _sigil_node():
    return next(iter(data.SIGIL_LAIRS))


def test_sigil_kill_broadcasts_except_slayer(monkeypatch):
    t = _table()
    _join(t, 'user-alex', 'Alex')
    _join(t, 'user-sam', 'Sam')
    sid = _sid(t)
    sent = []
    monkeypatch.setattr(db.push_db, 'broadcast',
                        lambda table, ids, title, body, url: sent.append((set(ids), body)))
    doc = db._get_player(t, sid, 'user-alex')
    node = _sigil_node()
    rec = {'kind': 'lair', 'node': node,
           'npc': {'maxHp': data.LAIR_BOSSES[node]['hp']},
           'npcMeta': {'name': data.LAIR_BOSSES[node]['name']},
           'ctx': {'slain': False, 'vestMax': data.LAIR_BOSSES[node]['hp'] // 2}}
    result = {'outcome': 'attacker', 'attackerHp': 20, 'defenderHp': 0, 'strikes': []}
    db._finish_lair(t, sid, doc, rec, result)
    sigil_pushes = [s for s in sent if 'Sigil' in s[1]]
    assert len(sigil_pushes) == 1
    ids, body = sigil_pushes[0]
    assert 'user-alex' not in ids and 'user-sam' in ids


def test_raid_spawn_broadcasts_except_actor(monkeypatch):
    t = _table()
    _join(t, 'user-alex', 'Alex')
    _join(t, 'user-sam', 'Sam')
    sid = _sid(t)
    sent = []
    monkeypatch.setattr(db.push_db, 'broadcast',
                        lambda table, ids, title, body, url: sent.append((set(ids), body)))
    db._spawn_world_event(t, sid, actor_id='user-alex')
    assert len(sent) == 1
    ids, body = sent[0]
    assert 'user-alex' not in ids and 'user-sam' in ids
    assert data.WORLD_EVENT['name'] in body


def test_raid_fall_broadcasts_except_killer(monkeypatch):
    t = _table()
    _join(t, 'u_top', 'Top')
    _join(t, 'u_minor', 'Minor')
    sid = _sid(t)
    rec = {'spawned': True, 'node': 'x', 'nodes': ['a', 'x', 'b'],
           'hp': 1, 'maxHp': 200, 'dmg': {'u_top': 150, 'u_minor': 25}, 'dead': False}
    db._set_world_event(t, sid, rec)
    sent = []
    monkeypatch.setattr(db.push_db, 'broadcast',
                        lambda table, ids, title, body, url: sent.append((set(ids), body)))
    killer = db._get_player(t, sid, 'u_top')
    db._world_event_payout(t, sid, killer)
    fall = [s for s in sent if 'fallen' in s[1].lower()]
    assert len(fall) == 1
    ids, _ = fall[0]
    assert 'u_top' not in ids and 'u_minor' in ids


def test_savra_awaken_broadcasts_to_everyone(monkeypatch):
    t = _table()
    _join(t, 'user-alex', 'Alex')
    _join(t, 'user-sam', 'Sam')
    sent = []
    monkeypatch.setattr(db.push_db, 'broadcast',
                        lambda table, ids, title, body, url: sent.append(set(ids)))
    status, _ = act(t, 'boss-awaken', hostKey='swampking')
    assert status == 200
    assert sent == [{'user-alex', 'user-sam'}]
