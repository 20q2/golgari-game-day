# Undercity Push Notifications — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Make the Undercity sub-game fire real browser push notifications for seven game moments (reward rolls, market sale, poke, sigil-boss kill, raid-boss spawn/fall, Savra awakening), reusing — and fixing — the existing web-push pipe.

**Architecture:** Extract the subscription store + fan-out into a self-contained `push_db.py` that both `queue_db` and `undercity_db` import (no cycle). Fix `push.send` to emit the ngsw `notification`-wrapped payload so notifications actually render and clicks route. Hook `push_db` into the seven event sites in `undercity_db`. Subscribe Undercity players client-side once they have a creature.

**Tech Stack:** Python 3.11 Lambda (pytest + in-memory `FakeTable`), Angular 20 standalone (`SwPush`), Web Push / VAPID via `pywebpush`.

Design: [specs/2026-07-25-undercity-notifications-design.md](2026-07-25-undercity-notifications-design.md)

Run the backend suite from `infrastructure/lambda`: `python -m pytest tests -q`.

---

### Task 1: Reshape `push.send` to the ngsw notification payload

Angular's stock `ngsw-worker.js` only calls `showNotification` when the push
payload has a top-level `notification` key, and only routes taps when
`notification.data.onActionClick.default` is present. `push.send` currently
sends a flat `{title, body, gameId}`, so nothing displays. Change the wire
format and the signature `send(sub, title, body, url)`.

**Files:**
- Modify: `infrastructure/lambda/push.py`
- Test: `infrastructure/lambda/tests/test_push.py`

- [ ] **Step 1: Rewrite the tests for the new signature + payload shape**

Replace the three existing tests in `tests/test_push.py` (keep the imports,
`FakeResponse`, and `SUB` constant) and add `import json` at the top:

```python
import json

def test_send_wraps_notification_and_click_url(monkeypatch):
    calls = []
    monkeypatch.setattr(push, 'webpush', lambda **kwargs: calls.append(kwargs))
    push.send(SUB, 'The Undercity', 'A raid boss appeared!',
              '/golgari-game-day/undercity')

    assert len(calls) == 1
    assert calls[0]['subscription_info']['endpoint'] == SUB['endpoint']
    assert calls[0]['subscription_info']['keys'] == SUB['keys']
    payload = json.loads(calls[0]['data'])
    note = payload['notification']
    assert note['title'] == 'The Undercity'
    assert note['body'] == 'A raid boss appeared!'
    click = note['data']['onActionClick']['default']
    assert click['operation'] == 'focusLastFocusedOrOpen'
    assert click['url'] == '/golgari-game-day/undercity'


def test_send_raises_push_gone_on_410(monkeypatch):
    def fake_webpush(**kwargs):
        raise WebPushException('gone', response=FakeResponse(410))
    monkeypatch.setattr(push, 'webpush', fake_webpush)

    with pytest.raises(push.PushGone):
        push.send(SUB, 'Title', 'body', '/golgari-game-day/undercity')


def test_send_reraises_other_webpush_errors(monkeypatch):
    def fake_webpush(**kwargs):
        raise WebPushException('server error', response=FakeResponse(500))
    monkeypatch.setattr(push, 'webpush', fake_webpush)

    with pytest.raises(WebPushException):
        push.send(SUB, 'Title', 'body', '/golgari-game-day/undercity')
```

- [ ] **Step 2: Run the tests — verify they FAIL**

Run: `python -m pytest tests/test_push.py -q`
Expected: FAIL (`send()` still takes `(sub, message, game_id)`; payload has no `notification` key).

- [ ] **Step 3: Rewrite `push.send`**

Replace the `send` function body in `push.py`:

```python
def send(sub, title, body, url):
    """Deliver one Web Push. The payload is the shape Angular's ngsw-worker
    expects: a top-level `notification` object (so the SW auto-displays it) whose
    `data.onActionClick.default` routes a tap to `url`."""
    subscription_info = {
        'endpoint': sub['endpoint'],
        'keys': {'p256dh': sub['keys']['p256dh'], 'auth': sub['keys']['auth']},
    }
    payload = {
        'notification': {
            'title': title,
            'body': body,
            'data': {
                'onActionClick': {
                    'default': {'operation': 'focusLastFocusedOrOpen', 'url': url},
                },
            },
        },
    }
    try:
        webpush(
            subscription_info=subscription_info,
            data=json.dumps(payload),
            vapid_private_key=VAPID_PRIVATE_KEY,
            vapid_claims={'sub': VAPID_SUBJECT},
        )
    except WebPushException as exc:
        status = exc.response.status_code if exc.response is not None else None
        if status in (404, 410):
            raise PushGone() from exc
        raise
```

- [ ] **Step 4: Run the tests — verify they PASS**

Run: `python -m pytest tests/test_push.py -q`
Expected: PASS (3 tests).

- [ ] **Step 5: Commit**

```bash
git add infrastructure/lambda/push.py infrastructure/lambda/tests/test_push.py
git commit -m "fix(push): emit ngsw notification payload so pushes actually display

Co-Authored-By: Claude Opus 4.8 (1M context) <noreply@anthropic.com>"
```

---

### Task 2: Extract `push_db.py` — subscription store + fan-out

Create a self-contained module that owns the `PUSHSUB#{userId}` rows and turns a
user id (or a list) into delivered notifications. It imports neither `queue_db`
nor `undercity_db`, so both can import it without a cycle. `pywebpush` is only
reached lazily through `push.send`, so a broken dependency degrades to a no-op.

**Files:**
- Create: `infrastructure/lambda/push_db.py`
- Test: `infrastructure/lambda/tests/test_push_db.py`

- [ ] **Step 1: Write the tests**

Create `tests/test_push_db.py`:

```python
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
```

- [ ] **Step 2: Run the tests — verify they FAIL**

Run: `python -m pytest tests/test_push_db.py -q`
Expected: FAIL with `ModuleNotFoundError: No module named 'push_db'`.

- [ ] **Step 3: Create `push_db.py`**

```python
"""
Shared Web-Push subscription store + fan-out, used by both the game-night queue
and the Undercity sub-game.

Owns the DynamoDB rows:
  PUSHSUB#{userId} / SUB#{endpointHash}   one browser push subscription

Self-contained on purpose: it depends only on the table and the raw sender in
`push.py`, never on `queue_db` or `undercity_db`, so either of those can import
it without an import cycle. `pywebpush` is imported lazily inside `push.send`, so
a broken/absent web-push dependency only degrades notifications — it never
crashes Lambda init.
"""
import hashlib
import json
import time


def _pushsub_pk(user_id):
    return f'PUSHSUB#{user_id}'


def _endpoint_hash(endpoint):
    return hashlib.sha256(endpoint.encode('utf-8')).hexdigest()[:16]


def _now_ts():
    return int(time.time())


def _err(msg, code=400):
    return code, {'error': msg}


def _ok(**extra):
    return 200, {'ok': True, **extra}


def _subscriptions_for(table, user_id):
    resp = table.query(
        KeyConditionExpression='pk = :pk AND begins_with(sk, :sk)',
        ExpressionAttributeValues={':pk': _pushsub_pk(user_id), ':sk': 'SUB#'},
    )
    return resp.get('Items', [])


def send_to_user(table, user_id, title, body, url):
    """Push to every one of a user's subscriptions; delete any the push service
    reports dead (404/410). Best-effort: a broken/absent web-push dependency, a
    bad key, or a network error degrades to a no-op — it never raises."""
    try:
        import push
    except Exception:
        return
    for sub in _subscriptions_for(table, user_id):
        try:
            push.send(sub, title, body, url)
        except push.PushGone:
            table.delete_item(Key={'pk': sub['pk'], 'sk': sub['sk']})
        except Exception:
            # Any other send error — notifications are optional.
            pass


def broadcast(table, user_ids, title, body, url):
    """send_to_user for each id in an already-filtered recipient list."""
    for user_id in user_ids:
        send_to_user(table, user_id, title, body, url)


def handle_push_subscribe(table, body):
    try:
        req = json.loads(body) if isinstance(body, str) else body
    except (json.JSONDecodeError, TypeError):
        return _err('Invalid JSON')
    user_id = req.get('userId')
    subscription = req.get('subscription') or {}
    endpoint = subscription.get('endpoint')
    keys = subscription.get('keys') or {}
    if not user_id or not endpoint or not keys.get('p256dh') or not keys.get('auth'):
        return _err('userId and a valid subscription are required')

    table.put_item(Item={
        'pk': _pushsub_pk(user_id),
        'sk': f'SUB#{_endpoint_hash(endpoint)}',
        'userId': user_id,
        'endpoint': endpoint,
        'keys': {'p256dh': keys['p256dh'], 'auth': keys['auth']},
        'createdAt': _now_ts(),
    })
    return _ok()


def handle_push_unsubscribe(table, body):
    try:
        req = json.loads(body) if isinstance(body, str) else body
    except (json.JSONDecodeError, TypeError):
        return _err('Invalid JSON')
    user_id = req.get('userId')
    endpoint = req.get('endpoint')
    if not user_id or not endpoint:
        return _err('userId and endpoint are required')

    table.delete_item(Key={'pk': _pushsub_pk(user_id), 'sk': f'SUB#{_endpoint_hash(endpoint)}'})
    return _ok()
```

- [ ] **Step 4: Run the tests — verify they PASS**

Run: `python -m pytest tests/test_push_db.py -q`
Expected: PASS (7 tests).

- [ ] **Step 5: Commit**

```bash
git add infrastructure/lambda/push_db.py infrastructure/lambda/tests/test_push_db.py
git commit -m "feat(push): add shared push_db subscription store + fan-out

Co-Authored-By: Claude Opus 4.8 (1M context) <noreply@anthropic.com>"
```

---

### Task 3: Rewire `queue_db` + `lambda_function` onto `push_db`

Delete the subscription code that now lives in `push_db` from `queue_db`, make
`_notify_others` delegate to `push_db.send_to_user` (with the new title/url), and
route the two HTTP endpoints to `push_db`. Update `test_queue_db.py`.

**Files:**
- Modify: `infrastructure/lambda/queue_db.py`
- Modify: `infrastructure/lambda/lambda_function.py`
- Test: `infrastructure/lambda/tests/test_queue_db.py`

- [ ] **Step 1: Update the queue tests for the new seam**

In `tests/test_queue_db.py`:

Change the module reference in the four push-subscription helpers/tests from `q`
to `push_db`. Add `import push_db` near the existing `import push`. Specifically:
- `q.handle_push_subscribe(...)` → `push_db.handle_push_subscribe(...)` (every call)
- `q.handle_push_unsubscribe(...)` → `push_db.handle_push_unsubscribe(...)`
- `q._subscriptions_for(...)` → `push_db._subscriptions_for(...)` (every call)

Then update the four `push.send` monkeypatches to the new signature and drop the
dead `gameId` assertion. Replace `test_join_notifies_other_lobby_members` and the
three that follow it with:

```python
def test_join_notifies_other_lobby_members(monkeypatch):
    sent = []
    monkeypatch.setattr(push, 'send', lambda sub, title, body, url: sent.append(
        (sub['endpoint'], title, body, url)))

    t = FakeTable()
    start_night(t)
    q.handle_action(t, {'type': 'join', 'userId': 'user-alex', 'username': 'Alex',
                        'payload': {'gameId': 'catan', 'gameTitle': 'Catan'}})
    push_db.handle_push_subscribe(t, {'userId': 'user-alex', 'subscription': _subscription()})

    assert sent == []  # first join: no one else in the lobby yet

    status, body = q.handle_action(t, {'type': 'join', 'userId': 'user-sam', 'username': 'Sam',
                                       'payload': {'gameId': 'catan'}})
    assert status == 200
    assert len(sent) == 1
    endpoint, title, message, url = sent[0]
    assert endpoint == 'https://push.example/abc123'  # sent to Alex, not the joiner (Sam)
    assert 'Sam' in message and 'Catan' in message
    assert url == '/golgari-game-day/'  # tapping opens the app


def test_rejoin_does_not_renotify(monkeypatch):
    sent = []
    monkeypatch.setattr(push, 'send', lambda sub, title, body, url: sent.append(1))

    t = FakeTable()
    start_night(t)
    q.handle_action(t, {'type': 'join', 'userId': 'user-alex', 'username': 'Alex',
                        'payload': {'gameId': 'catan', 'gameTitle': 'Catan'}})
    push_db.handle_push_subscribe(t, {'userId': 'user-alex', 'subscription': _subscription()})
    q.handle_action(t, {'type': 'join', 'userId': 'user-sam', 'username': 'Sam',
                        'payload': {'gameId': 'catan'}})
    assert len(sent) == 1

    q.handle_action(t, {'type': 'join', 'userId': 'user-sam', 'username': 'Sam',
                        'payload': {'gameId': 'catan'}})
    assert len(sent) == 1  # re-join is a no-op, no second push


def test_dead_subscription_is_deleted_on_push_failure(monkeypatch):
    def fake_send(sub, title, body, url):
        raise push.PushGone()
    monkeypatch.setattr(push, 'send', fake_send)

    t = FakeTable()
    start_night(t)
    q.handle_action(t, {'type': 'join', 'userId': 'user-alex', 'username': 'Alex',
                        'payload': {'gameId': 'catan', 'gameTitle': 'Catan'}})
    push_db.handle_push_subscribe(t, {'userId': 'user-alex', 'subscription': _subscription()})

    status, body = q.handle_action(t, {'type': 'join', 'userId': 'user-sam', 'username': 'Sam',
                                       'payload': {'gameId': 'catan'}})
    assert status == 200  # the join itself still succeeds
    assert push_db._subscriptions_for(t, 'user-alex') == []  # dead subscription gone


def test_join_survives_broken_push_send(monkeypatch):
    """A web-push send that raises an unexpected error must not fail the join."""
    def fake_send(sub, title, body, url):
        raise RuntimeError('boom')
    monkeypatch.setattr(push, 'send', fake_send)

    t = FakeTable()
    start_night(t)
    q.handle_action(t, {'type': 'join', 'userId': 'user-alex', 'username': 'Alex',
                        'payload': {'gameId': 'catan', 'gameTitle': 'Catan'}})
    push_db.handle_push_subscribe(t, {'userId': 'user-alex', 'subscription': _subscription()})

    status, body = q.handle_action(t, {'type': 'join', 'userId': 'user-sam', 'username': 'Sam',
                                       'payload': {'gameId': 'catan'}})
    assert status == 200  # join succeeds despite the send blowing up
    assert len(push_db._subscriptions_for(t, 'user-alex')) == 1  # live sub untouched
```

Also update the two subscribe/unsubscribe unit tests (`test_push_subscribe_stores_subscription`,
`test_push_subscribe_rejects_incomplete_subscription`, `test_push_unsubscribe_removes_subscription`)
to call `push_db.*` instead of `q.*` as noted above.

- [ ] **Step 2: Run the queue tests — verify they FAIL**

Run: `python -m pytest tests/test_queue_db.py -q`
Expected: FAIL (`push_db` not imported by queue tests yet / `queue_db` still owns the old code with the old `push.send(sub, message, game_id)` call).

- [ ] **Step 3: Edit `queue_db.py`**

At the top of `queue_db.py`, add `import push_db` beside `import undercity_db`,
and update the module docstring note about lazy `push` import to point at
`push_db`. Add a queue-URL constant near the top:

```python
_QUEUE_URL = '/golgari-game-day/'  # tapping a queue push focuses/opens the app
```

Replace `_notify_others` with the delegating version:

```python
def _notify_others(table, entry, joiner_id, joiner_name):
    others = [m['userId'] for m in entry['joined'] if m['userId'] != joiner_id]
    if not others:
        return
    who = joiner_name or joiner_id
    body = f'{who} wants to play {entry["gameTitle"]} too'
    for user_id in others:
        push_db.send_to_user(table, user_id, 'Game Queue', body, _QUEUE_URL)
```

Delete these now-moved definitions from `queue_db.py`: `_pushsub_pk`,
`_endpoint_hash`, `_subscriptions_for`, `handle_push_subscribe`,
`handle_push_unsubscribe`.

- [ ] **Step 4: Edit `lambda_function.py` routing**

Add `import push_db` near the other imports. In `handle_queue`, change the two
push handlers:

```python
        if push_sub == 'subscribe':
            status, payload = push_db.handle_push_subscribe(table, body)
            return create_response(status, payload)
        if push_sub == 'unsubscribe':
            status, payload = push_db.handle_push_unsubscribe(table, body)
            return create_response(status, payload)
```

- [ ] **Step 5: Run the full backend suite — verify PASS**

Run: `python -m pytest tests -q`
Expected: PASS. If `tests/test_lambda_routing.py` references
`queue_db.handle_push_*`, repoint it to `push_db.handle_push_*` (grep:
`grep -rn "handle_push_" tests/`).

- [ ] **Step 6: Commit**

```bash
git add infrastructure/lambda/queue_db.py infrastructure/lambda/lambda_function.py infrastructure/lambda/tests/test_queue_db.py
git commit -m "refactor(push): route queue notifications through push_db

Co-Authored-By: Claude Opus 4.8 (1M context) <noreply@anthropic.com>"
```

---

### Task 4: Undercity push wrappers + constants

Add two thin helpers to `undercity_db.py` so the seven hooks read cleanly and the
Undercity title/URL live in one place.

**Files:**
- Modify: `infrastructure/lambda/undercity_db.py`
- Test: `infrastructure/lambda/tests/test_undercity_notifications.py` (new)

- [ ] **Step 1: Write the wrapper tests**

Create `tests/test_undercity_notifications.py`:

```python
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
```

- [ ] **Step 2: Run — verify FAIL**

Run: `python -m pytest tests/test_undercity_notifications.py -q`
Expected: FAIL (`db.push_db` / `db._push_user` / `db._push_broadcast` undefined).

- [ ] **Step 3: Add the import, constants, and wrappers**

At the top of `undercity_db.py`, add `import push_db` beside the other imports.
Add the wrappers next to `_broadcast_away` (search for `def _broadcast_away`):

```python
_UNDERCITY_TITLE = 'The Undercity'
_UNDERCITY_URL = '/golgari-game-day/undercity'  # tapping a push opens the game


def _push_user(table, user_id, body):
    """Personal browser push to one player. Best-effort (see push_db)."""
    push_db.send_to_user(table, user_id, _UNDERCITY_TITLE, body, _UNDERCITY_URL)


def _push_broadcast(table, sid, body, exclude_user_id=None):
    """Browser push to every creature in the season, optionally excluding one
    (usually the actor who already knows). Mirrors _broadcast_away's targeting."""
    ids = [p['userId'] for p in _season_players(table, sid)
           if p.get('userId') and p['userId'] != exclude_user_id]
    push_db.broadcast(table, ids, _UNDERCITY_TITLE, body, _UNDERCITY_URL)
```

- [ ] **Step 4: Run — verify PASS**

Run: `python -m pytest tests/test_undercity_notifications.py -q`
Expected: PASS (3 tests).

- [ ] **Step 5: Commit**

```bash
git add infrastructure/lambda/undercity_db.py infrastructure/lambda/tests/test_undercity_notifications.py
git commit -m "feat(undercity): push wrappers for personal + broadcast notifications

Co-Authored-By: Claude Opus 4.8 (1M context) <noreply@anthropic.com>"
```

---

### Task 5: Personal hooks — reward rolls, market sale, poke

Wire `_push_user` into the three personal events. All three fire from functions
that retry past the optimistic-lock guard, so the push must go **after** the
successful `_put_player`, exactly once.

**Files:**
- Modify: `infrastructure/lambda/undercity_db.py`
- Test: `infrastructure/lambda/tests/test_undercity_notifications.py`

- [ ] **Step 1: Add the three hook tests**

Append to `tests/test_undercity_notifications.py`:

```python
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
```

- [ ] **Step 2: Run — verify the three new tests FAIL**

Run: `python -m pytest tests/test_undercity_notifications.py -q`
Expected: FAIL (no push emitted from the hooks yet).

- [ ] **Step 3a: Reward hook in `_grant_to_player`**

Find the reward `_push_away_event` block and add the push on success:

```python
        _push_away_event(doc, {'kind': 'reward', 'game': game_name,
                               'rolls': rolls, 'items': items, 'at': _now()})
        if _put_player(table, doc):
            from_game = f' from {game_name}' if game_name else ''
            _push_user(table, user_id, f'+{rolls} rolls{from_game} — come spend them!')
            return True
    return False
```

- [ ] **Step 3b: Market hook in `_credit_market_seller`**

```python
def _credit_market_seller(table, sid, seller_id, amount, entry):
    """Add sale proceeds to a (possibly offline) seller's doc + notify them,
    retrying past the optimistic-lock conflict. Returns True if credited."""
    for _ in range(5):
        seller = _get_player(table, sid, seller_id)
        if not seller:
            return False
        seller['spores'] = seller.get('spores', 0) + amount
        _push_away_event(seller, entry)
        if _put_player(table, seller):
            _push_user(table, seller_id, entry.get('text', 'One of your listings sold!'))
            return True
    return False
```

- [ ] **Step 3c: Poke hook in `_poke`**

After the target `_put_player` succeeds and the actor doc is saved (right before
or after the `_event(table, sid, 'poke', ...)` call), add:

```python
    poke_body = f"{doc['username']} poked your {_creature_label(target)}!"
    if granted:
        poke_body += f' (+{granted} roll!)'
    _push_user(table, target_id, poke_body)
```

(`granted`, `target`, `target_id`, and `_creature_label` are all already in
scope in `_poke`.)

- [ ] **Step 4: Run — verify PASS**

Run: `python -m pytest tests/test_undercity_notifications.py -q`
Expected: PASS (6 tests).

- [ ] **Step 5: Commit**

```bash
git add infrastructure/lambda/undercity_db.py infrastructure/lambda/tests/test_undercity_notifications.py
git commit -m "feat(undercity): push on reward rolls, market sale, and poke

Co-Authored-By: Claude Opus 4.8 (1M context) <noreply@anthropic.com>"
```

---

### Task 6: Broadcast hooks — sigil kill, raid spawn, raid fall, Savra

Wire `_push_broadcast` into the four world/boss events, each next to its existing
`_broadcast_away` / `_event('boss', ...)` line and using the same exclusion.

**Files:**
- Modify: `infrastructure/lambda/undercity_db.py`
- Test: `infrastructure/lambda/tests/test_undercity_notifications.py`

- [ ] **Step 1: Add the four broadcast hook tests**

Append to `tests/test_undercity_notifications.py`:

```python
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
```

- [ ] **Step 2: Run — verify the four new tests FAIL**

Run: `python -m pytest tests/test_undercity_notifications.py -q`
Expected: FAIL (no broadcast emitted from these hooks yet).

- [ ] **Step 3a: Sigil hook in `_finish_lair`**

In the sigil-claim branch, right after the `_broadcast_away(...)` that carries
`{'kind': 'boss', 'by': doc['username'], 'name': display, ...}` in the
`if personal_first and sigil_biome:` block, add:

```python
            _push_broadcast(table, sid,
                            f"{doc['username']} cleared the {biome_name} dungeon "
                            f"and claimed a Guild Sigil!",
                            exclude_user_id=doc['userId'])
```

(`biome_name` and `doc` are in scope in that branch.)

- [ ] **Step 3b: Raid-spawn hook in `_spawn_world_event`**

After the closing `_broadcast_away(...)` call at the end of the function, add:

```python
    _push_broadcast(table, sid,
                    f"A {data.WORLD_EVENT['name']} has emerged in the wilderness — "
                    "rally and bring it down!",
                    exclude_user_id=actor_id)
```

- [ ] **Step 3c: Raid-fall hook in `_world_event_payout`**

There are two exit points that announce the fall. Add a broadcast at both.

In the `if not dmg:` early-return branch (right after
`_event(table, sid, 'boss', f"The {data.WORLD_EVENT['name']} has fallen!")`):

```python
        _push_broadcast(table, sid, f"The {data.WORLD_EVENT['name']} has fallen!",
                        exclude_user_id=killer_uid)
        return []
```

And in the main path, right after the
`_event(table, sid, 'boss', f"The {data.WORLD_EVENT['name']} has fallen! ...")`
and its `_broadcast_away(... 'world_fallen' ...)`:

```python
    _push_broadcast(table, sid,
                    f"The {data.WORLD_EVENT['name']} has fallen! The wilderness quiets.",
                    exclude_user_id=killer_uid)
```

- [ ] **Step 3d: Savra hook in `_boss_awaken`**

After the `_event(table, sid, 'boss', 'THE ROT-WARDS FALL! ...')` line, add
(no exclusion — everyone gets the finale call):

```python
    _push_broadcast(table, sid,
                    'THE ROT-WARDS FALL — Savra, Queen of the Golgari, stirs. Storm her lair!')
```

- [ ] **Step 4: Run — verify PASS**

Run: `python -m pytest tests/test_undercity_notifications.py -q`
Expected: PASS (10 tests).

- [ ] **Step 5: Run the full backend suite — verify PASS**

Run: `python -m pytest tests -q`
Expected: PASS (whole suite green).

- [ ] **Step 6: Commit**

```bash
git add infrastructure/lambda/undercity_db.py infrastructure/lambda/tests/test_undercity_notifications.py
git commit -m "feat(undercity): broadcast push on sigil kill, raid spawn/fall, Savra

Co-Authored-By: Claude Opus 4.8 (1M context) <noreply@anthropic.com>"
```

---

### Task 7: Client — generalize the push service + subscribe Undercity players

Rename `QueuePushService` → `PushService` (it is not queue-specific), and have
`UndercityStateService` subscribe a player to push once they have a creature.
Preserve the existing `localStorage` opt-out key so prior declines still hold.

**Files:**
- Rename + modify: `src/app/services/queue-push.service.ts` → `src/app/services/push.service.ts`
- Modify: `src/app/services/queue.service.ts`
- Modify: `src/app/undercity/services/undercity-state.service.ts`

There is no frontend test runner (see CLAUDE.md); verify with a build.

- [ ] **Step 1: Rename the service file + class**

Rename `src/app/services/queue-push.service.ts` to
`src/app/services/push.service.ts`. In it, rename the class and update the
doc-comment; keep `OPT_OUT_STORAGE_KEY = 'gameday-queue-push-opt-out'` unchanged
(preserves existing opt-outs) and keep everything else identical:

```typescript
/**
 * Wraps SwPush so callers don't need to know about subscription bookkeeping.
 * Subscribing triggers the browser's native permission prompt — that prompt IS
 * the user-facing "get notified?" ask, no custom UI needed. Shared by the queue
 * and the Undercity sub-game.
 */
@Injectable({ providedIn: 'root' })
export class PushService {
```

- [ ] **Step 2: Update the queue importer**

In `src/app/services/queue.service.ts`:
- change the import to `import { PushService } from './push.service';`
- change the field to `private readonly push = inject(PushService);`

(The `void this.push.ensureSubscribed();` call in `join()` is unchanged.)

- [ ] **Step 3: Subscribe Undercity players once they have a creature**

In `src/app/undercity/services/undercity-state.service.ts`:

Add the import and injected field:

```typescript
import { PushService } from '../../services/push.service';
```

```typescript
  private readonly push = inject(PushService);
  private pushPrompted = false;
```

In `refresh()`, right after `this._state.set(next);`, add:

```typescript
      if (next.you && !this.pushPrompted) {
        // Once the player has a creature they're committed to tonight — ask to
        // enable notifications (no-op if already subscribed or opted out). This
        // covers both the post-hatch case and reopening with a creature.
        this.pushPrompted = true;
        void this.push.ensureSubscribed();
      }
```

- [ ] **Step 4: Build to verify the frontend compiles**

Run: `npm run build`
Expected: build succeeds (Angular compiles, no unresolved `PushService` import).

- [ ] **Step 5: Commit**

```bash
git add src/app/services/push.service.ts src/app/services/queue.service.ts src/app/undercity/services/undercity-state.service.ts
git commit -m "feat(undercity): subscribe players to push once they have a creature

Co-Authored-By: Claude Opus 4.8 (1M context) <noreply@anthropic.com>"
```

> Note: `git add` won't record the delete of the old filename automatically here.
> After the rename, also run `git rm src/app/services/queue-push.service.ts` (or
> `git add -A src/app/services/`) so the removal is staged.

---

## Deployment (user runs this)

Per project convention the user runs deploys. After all tasks are green:
- Backend: `cd infrastructure && cdk deploy` (ships `push_db.py`, the reshaped
  `push.py`, and the hooks). `VAPID_PRIVATE_KEY` / `VAPID_SUBJECT` env vars are
  already set from the queue feature — no new secrets.
- Frontend: `npm run deploy`, then hard-refresh to bypass the cached
  `ngsw-worker.js`.
- Smoke test on a phone: hatch a creature (accept the notification prompt), then
  from a second device poke that creature and confirm the buzz + that tapping it
  opens `/undercity`.

## Self-review notes

- **Spec coverage:** payload fix (Task 1), shared seam (Task 2–3), all seven
  hooks (Tasks 5–6), client subscribe-on-hatch (Task 7), tests throughout.
- **No cron:** roll notifications limited to *granted* rolls (Task 5 reward
  hook), matching the design's constraint. Regen refill deliberately omitted.
- **Type/name consistency:** `send_to_user(table, user_id, title, body, url)` and
  `broadcast(table, user_ids, title, body, url)` used identically in push_db,
  queue_db, undercity_db wrappers, and every test monkeypatch signature.
- **Best-effort invariant:** every send path swallows non-`PushGone` errors so a
  broken push never fails a game action (verified by
  `test_join_survives_broken_push_send` and `test_send_to_user_swallows_other_errors`).
