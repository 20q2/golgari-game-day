# Game Night Queue Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Let signed-in users add a catalog game to tonight's shared queue, join other games' lobbies, and get a real push notification when someone joins a lobby they're in.

**Architecture:** New DynamoDB item types (`QUEUE#{sid}`/`GAME#{gameId}` queue entries, `PUSHSUB#{userId}`/`SUB#{hash}` push subscriptions) added to the existing single table. A new `queue_db.py` Lambda module mirrors `undercity_db.py`'s dispatch pattern and is wired into `lambda_function.py` via new `/queue/state`, `/queue/action`, `/queue/push/subscribe`, `/queue/push/unsubscribe` routes. Queue entries are keyed to the Undercity season returned by a new `undercity_db.get_active_season()` helper, so the queue is empty whenever no Undercity night is running. Push delivery uses standard Web Push (VAPID) sent synchronously from the Lambda via `pywebpush`, received client-side through Angular's `SwPush` (which requires wiring up the Angular service worker for the first time in this repo). Frontend adds a `QueueApiService`/`QueueService` pair (mirroring `UndercityApiService`/`UndercityStateService`'s signal-store pattern) and two new UI pieces: a "Tonight's Queue" panel on `/home` and a per-card badge in the existing games list.

**Tech Stack:** Python 3.11 Lambda + boto3 + pywebpush (new dependency), AWS CDK (TypeScript) with Docker asset bundling (new for this repo), Angular 20 standalone components + signals + `@angular/service-worker`.

---

## Backend

### Task 1: Expose a public "active season" lookup from `undercity_db.py`

**Files:**
- Modify: `infrastructure/lambda/undercity_db.py:147-153`
- Test: `infrastructure/lambda/tests/test_undercity_db.py`

`undercity_db.py` already has a private `_active_season(table)` helper. The Queue module needs the same lookup but lives in a different file, so add a one-line public wrapper next to it.

- [ ] **Step 1: Write the failing test**

Add to the bottom of `infrastructure/lambda/tests/test_undercity_db.py`:

```python
def test_get_active_season_public_wrapper():
    t = FakeTable()
    assert db.get_active_season(t) == (None, None)

    act(t, 'season-start', hostKey='swampking')
    sid, config = db.get_active_season(t)
    assert sid is not None
    assert config['status'] == 'active'
    assert config['hostKey'] == 'swampking'
```

- [ ] **Step 2: Run test to verify it fails**

Run: `cd infrastructure/lambda && python -m pytest tests/test_undercity_db.py::test_get_active_season_public_wrapper -v`
Expected: FAIL with `AttributeError: module 'undercity_db' has no attribute 'get_active_season'`

- [ ] **Step 3: Add the wrapper**

In `infrastructure/lambda/undercity_db.py`, immediately after the existing `_active_season` function (line 153):

```python
def get_active_season(table):
    """Public lookup for other Lambda modules (e.g. queue_db) that need to
    key their own data off whichever Undercity night is currently running."""
    return _active_season(table)
```

- [ ] **Step 4: Run test to verify it passes**

Run: `cd infrastructure/lambda && python -m pytest tests/test_undercity_db.py::test_get_active_season_public_wrapper -v`
Expected: PASS

- [ ] **Step 5: Commit**

```bash
git add infrastructure/lambda/undercity_db.py infrastructure/lambda/tests/test_undercity_db.py
git commit -m "feat(undercity): expose get_active_season for cross-module reuse"
```

---

### Task 2: Queue core — state, join, leave

**Files:**
- Create: `infrastructure/lambda/queue_db.py`
- Create: `infrastructure/lambda/tests/test_queue_db.py`

- [ ] **Step 1: Write the failing tests**

Create `infrastructure/lambda/tests/test_queue_db.py`:

```python
"""Integration tests for the game-night queue against an in-memory table."""
import sys
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parents[1]))

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
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `cd infrastructure/lambda && python -m pytest tests/test_queue_db.py -v`
Expected: FAIL with `ModuleNotFoundError: No module named 'queue_db'`

- [ ] **Step 3: Implement `queue_db.py`**

Create `infrastructure/lambda/queue_db.py`:

```python
"""
DynamoDB orchestration for the game-night Queue.

Item layout (existing single table, pk/sk strings):
  QUEUE#{sid}          / GAME#{gameId}      queued game + who's joined
  PUSHSUB#{userId}     / SUB#{endpointHash} browser push subscription

Queue entries are keyed to the currently active Undercity season (via
undercity_db.get_active_season), so a fresh night starts with an empty
queue and there is no separate queue lifecycle to manage.
"""
import json
import time

import undercity_db


def _queue_pk(sid):
    return f'QUEUE#{sid}'


def _game_sk(game_id):
    return f'GAME#{game_id}'


def _now_ts():
    return int(time.time())


def _get(table, pk, sk):
    resp = table.get_item(Key={'pk': pk, 'sk': sk})
    return resp.get('Item')


def _err(msg, code=400):
    return code, {'error': msg}


def _ok(**extra):
    return 200, {'ok': True, **extra}


def _public_entry(item):
    return {
        'gameId': item['gameId'],
        'gameTitle': item['gameTitle'],
        'addedBy': item['addedBy'],
        'addedByName': item['addedByName'],
        'addedAt': item['addedAt'],
        'joined': item['joined'],
    }


def handle_state(table, query_params):
    sid, config = undercity_db.get_active_season(table)
    if not sid or not config or config.get('status') != 'active':
        return 200, {'seasonId': None, 'entries': []}
    resp = table.query(
        KeyConditionExpression='pk = :pk AND begins_with(sk, :sk)',
        ExpressionAttributeValues={':pk': _queue_pk(sid), ':sk': 'GAME#'},
    )
    entries = [_public_entry(item) for item in resp.get('Items', [])]
    return 200, {'seasonId': sid, 'entries': entries}


def handle_action(table, body):
    try:
        req = json.loads(body) if isinstance(body, str) else body
    except (json.JSONDecodeError, TypeError):
        return _err('Invalid JSON')
    atype = req.get('type')
    user_id = req.get('userId')
    username = req.get('username', '')
    payload = req.get('payload') or {}
    if not atype or not user_id:
        return _err('type and userId are required')

    sid, config = undercity_db.get_active_season(table)
    if not sid or not config or config.get('status') != 'active':
        return _err('No active season. Ask the host to start the night.', 409)

    if atype in ('add', 'join'):
        return _join(table, sid, user_id, username, payload)
    if atype == 'leave':
        return _leave(table, sid, user_id, payload)
    return _err(f'Unknown action: {atype}')


def _join(table, sid, user_id, username, payload):
    game_id = str(payload.get('gameId') or '').strip()
    if not game_id:
        return _err('gameId is required')
    game_title = str(payload.get('gameTitle') or game_id).strip()

    pk, sk = _queue_pk(sid), _game_sk(game_id)
    entry = _get(table, pk, sk)
    if not entry:
        entry = {
            'pk': pk, 'sk': sk,
            'gameId': game_id,
            'gameTitle': game_title,
            'addedBy': user_id,
            'addedByName': username,
            'addedAt': _now_ts(),
            'joined': [],
        }

    already_in = any(m['userId'] == user_id for m in entry['joined'])
    if not already_in:
        entry['joined'].append({'userId': user_id, 'username': username})
        table.put_item(Item=entry)

    return _ok(entry=_public_entry(entry))


def _leave(table, sid, user_id, payload):
    game_id = str(payload.get('gameId') or '').strip()
    if not game_id:
        return _err('gameId is required')

    pk, sk = _queue_pk(sid), _game_sk(game_id)
    entry = _get(table, pk, sk)
    if not entry:
        return _err('Not in queue.', 404)

    entry['joined'] = [m for m in entry['joined'] if m['userId'] != user_id]
    if not entry['joined']:
        table.delete_item(Key={'pk': pk, 'sk': sk})
        return _ok(entry=None)

    table.put_item(Item=entry)
    return _ok(entry=_public_entry(entry))
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `cd infrastructure/lambda && python -m pytest tests/test_queue_db.py -v`
Expected: PASS (10 tests)

- [ ] **Step 5: Commit**

```bash
git add infrastructure/lambda/queue_db.py infrastructure/lambda/tests/test_queue_db.py
git commit -m "feat(queue): add queue_db module for tonight's game queue"
```

---

### Task 3: Wire `/queue/state` and `/queue/action` into `lambda_function.py`

**Files:**
- Modify: `infrastructure/lambda/lambda_function.py:9` (import), `:60-75` (dispatch), after `:217` (new handler)
- Test: `infrastructure/lambda/tests/test_lambda_routing.py`

- [ ] **Step 1: Write the failing test**

Add to `infrastructure/lambda/tests/test_lambda_routing.py`:

```python
def test_queue_endpoints_through_handler(monkeypatch):
    fake = FakeTable()
    monkeypatch.setattr(lambda_function, 'table', fake)

    status, body = _call('GET', '/queue/state')
    assert status == 200
    assert body == {'seasonId': None, 'entries': []}

    status, body = _call('POST', '/game/action',
                         body={'type': 'season-start', 'userId': 'host',
                               'username': 'Host', 'payload': {'hostKey': 'k'}})
    assert status == 200 and body['ok']

    status, body = _call('POST', '/queue/action',
                         body={'type': 'join', 'userId': 'user-alex', 'username': 'Alex',
                               'payload': {'gameId': 'catan', 'gameTitle': 'Catan'}})
    assert status == 200
    assert body['entry']['gameId'] == 'catan'

    status, body = _call('GET', '/queue/state')
    assert status == 200
    assert body['entries'][0]['gameId'] == 'catan'

    status, body = _call('GET', '/queue/nope')
    assert status == 404
```

- [ ] **Step 2: Run test to verify it fails**

Run: `cd infrastructure/lambda && python -m pytest tests/test_lambda_routing.py::test_queue_endpoints_through_handler -v`
Expected: FAIL with 404 on `/queue/state` (endpoint not routed yet)

- [ ] **Step 3: Wire the routes**

In `infrastructure/lambda/lambda_function.py`, add the import at line 9:

```python
import undercity_db
import queue_db
```

Add the dispatch branch inside `lambda_handler` (after the existing `elif endpoint == 'game':` branch, around line 68-69):

```python
        elif endpoint == 'game':
            return handle_game(http_method, path_parts, body, query_params)
        elif endpoint == 'queue':
            return handle_queue(http_method, path_parts, body, query_params)
        else:
```

Add the handler function right after `handle_game` (after line 217):

```python
def handle_queue(method: str, path_parts: List[str], body: str, query_params: Dict[str, Any]) -> Dict[str, Any]:
    """Route /queue/state, /queue/action, and /queue/push/* to the queue module."""
    sub = path_parts[1] if len(path_parts) > 1 else ''
    if sub == 'state' and method == 'GET':
        status, payload = queue_db.handle_state(table, query_params)
        return create_response(status, payload)
    if sub == 'action' and method == 'POST':
        status, payload = queue_db.handle_action(table, body)
        return create_response(status, payload)
    if sub == 'push' and len(path_parts) > 2 and method == 'POST':
        push_sub = path_parts[2]
        if push_sub == 'subscribe':
            status, payload = queue_db.handle_push_subscribe(table, body)
            return create_response(status, payload)
        if push_sub == 'unsubscribe':
            status, payload = queue_db.handle_push_unsubscribe(table, body)
            return create_response(status, payload)
    return create_response(404, {'error': 'Unknown queue endpoint'})
```

Note: `handle_push_subscribe`/`handle_push_unsubscribe` don't exist yet — they're added in Task 4. Python resolves the reference at call time, not at module load, so this file is valid as soon as Task 4 lands; it does mean this task's test only exercises `state`/`action`, not `push`.

- [ ] **Step 4: Run tests to verify they pass**

Run: `cd infrastructure/lambda && python -m pytest tests/test_lambda_routing.py -v`
Expected: PASS (both routing tests)

- [ ] **Step 5: Commit**

```bash
git add infrastructure/lambda/lambda_function.py infrastructure/lambda/tests/test_lambda_routing.py
git commit -m "feat(queue): route /queue/state and /queue/action through the Lambda"
```

---

### Task 4: Push subscription storage (subscribe / unsubscribe)

**Files:**
- Modify: `infrastructure/lambda/queue_db.py`
- Modify: `infrastructure/lambda/tests/test_queue_db.py`

- [ ] **Step 1: Write the failing tests**

Append to `infrastructure/lambda/tests/test_queue_db.py`:

```python
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
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `cd infrastructure/lambda && python -m pytest tests/test_queue_db.py -k push -v`
Expected: FAIL with `AttributeError: module 'queue_db' has no attribute 'handle_push_subscribe'`

- [ ] **Step 3: Implement subscription storage**

In `infrastructure/lambda/queue_db.py`, add `hashlib` to the imports at the top:

```python
import hashlib
import json
import time

import undercity_db
```

Add these helpers and handlers at the end of the file:

```python
def _pushsub_pk(user_id):
    return f'PUSHSUB#{user_id}'


def _endpoint_hash(endpoint):
    return hashlib.sha256(endpoint.encode('utf-8')).hexdigest()[:16]


def _subscriptions_for(table, user_id):
    resp = table.query(
        KeyConditionExpression='pk = :pk AND begins_with(sk, :sk)',
        ExpressionAttributeValues={':pk': _pushsub_pk(user_id), ':sk': 'SUB#'},
    )
    return resp.get('Items', [])


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

- [ ] **Step 4: Run tests to verify they pass**

Run: `cd infrastructure/lambda && python -m pytest tests/test_queue_db.py -v`
Expected: PASS (13 tests)

- [ ] **Step 5: Also run the routing test now that both push handlers exist**

Run: `cd infrastructure/lambda && python -m pytest tests/test_lambda_routing.py -v`
Expected: PASS

- [ ] **Step 6: Commit**

```bash
git add infrastructure/lambda/queue_db.py infrastructure/lambda/tests/test_queue_db.py
git commit -m "feat(queue): store and remove browser push subscriptions"
```

---

### Task 5: Send a Web Push on every successful join

**Files:**
- Create: `infrastructure/lambda/push.py`
- Create: `infrastructure/lambda/tests/test_push.py`
- Modify: `infrastructure/lambda/queue_db.py`
- Modify: `infrastructure/lambda/requirements.txt`
- Modify: `infrastructure/lambda/tests/test_queue_db.py`

- [ ] **Step 1: Install the new dependency locally so tests can import it**

Add to `infrastructure/lambda/requirements.txt`:

```
boto3>=1.26.0
pywebpush>=2.0.0
```

Run: `cd infrastructure/lambda && pip install -r requirements.txt`
Expected: `pywebpush` (and its `cryptography`/`py-vapid` dependencies) installs successfully.

- [ ] **Step 2: Write the failing test for `push.py`**

Create `infrastructure/lambda/tests/test_push.py`:

```python
"""Unit tests for the Web Push send wrapper — no network calls, webpush() is mocked."""
import sys
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parents[1]))

import pytest
from pywebpush import WebPushException

import push


class FakeResponse:
    def __init__(self, status_code):
        self.status_code = status_code


SUB = {
    'pk': 'PUSHSUB#user-alex', 'sk': 'SUB#abc123',
    'endpoint': 'https://push.example/abc123',
    'keys': {'p256dh': 'fake-p256dh', 'auth': 'fake-auth'},
}


def test_send_calls_webpush_with_subscription_and_message(monkeypatch):
    calls = []
    monkeypatch.setattr(push, 'webpush', lambda **kwargs: calls.append(kwargs))
    push.send(SUB, 'Alex wants to play Catan too', 'catan')

    assert len(calls) == 1
    assert calls[0]['subscription_info']['endpoint'] == SUB['endpoint']
    assert calls[0]['subscription_info']['keys'] == SUB['keys']
    assert 'Catan' not in calls[0]['data']  # message text is passed through verbatim, not templated here
    assert 'Alex wants to play Catan too' in calls[0]['data']


def test_send_raises_push_gone_on_410(monkeypatch):
    def fake_webpush(**kwargs):
        raise WebPushException('gone', response=FakeResponse(410))
    monkeypatch.setattr(push, 'webpush', fake_webpush)

    with pytest.raises(push.PushGone):
        push.send(SUB, 'hello', 'catan')


def test_send_reraises_other_webpush_errors(monkeypatch):
    def fake_webpush(**kwargs):
        raise WebPushException('server error', response=FakeResponse(500))
    monkeypatch.setattr(push, 'webpush', fake_webpush)

    with pytest.raises(WebPushException):
        push.send(SUB, 'hello', 'catan')
```

- [ ] **Step 3: Run test to verify it fails**

Run: `cd infrastructure/lambda && python -m pytest tests/test_push.py -v`
Expected: FAIL with `ModuleNotFoundError: No module named 'push'`

- [ ] **Step 4: Implement `push.py`**

Create `infrastructure/lambda/push.py`:

```python
"""
Web Push delivery via VAPID (RFC 8291), using pywebpush.

Kept as its own module so the pywebpush/cryptography dependency (a
C-extension, unlike everything else this Lambda uses) is only imported by
code paths that actually send a push.
"""
import json
import os

from pywebpush import webpush, WebPushException

VAPID_PRIVATE_KEY = os.environ.get('VAPID_PRIVATE_KEY')
VAPID_SUBJECT = os.environ.get('VAPID_SUBJECT', 'mailto:admin@example.com')


class PushGone(Exception):
    """Raised when the push service reports the subscription is dead (404/410)."""


def send(sub, message, game_id):
    subscription_info = {
        'endpoint': sub['endpoint'],
        'keys': {'p256dh': sub['keys']['p256dh'], 'auth': sub['keys']['auth']},
    }
    try:
        webpush(
            subscription_info=subscription_info,
            data=json.dumps({'title': 'Game Queue', 'body': message, 'gameId': game_id}),
            vapid_private_key=VAPID_PRIVATE_KEY,
            vapid_claims={'sub': VAPID_SUBJECT},
        )
    except WebPushException as exc:
        status = exc.response.status_code if exc.response is not None else None
        if status in (404, 410):
            raise PushGone() from exc
        raise
```

- [ ] **Step 5: Run test to verify it passes**

Run: `cd infrastructure/lambda && python -m pytest tests/test_push.py -v`
Expected: PASS (3 tests)

- [ ] **Step 6: Write the failing test for notify-on-join**

Append to `infrastructure/lambda/tests/test_queue_db.py`:

```python
def test_join_notifies_other_lobby_members(monkeypatch):
    sent = []
    monkeypatch.setattr(q.push, 'send', lambda sub, message, game_id: sent.append(
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
    monkeypatch.setattr(q.push, 'send', lambda sub, message, game_id: sent.append(1))

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
        raise q.push.PushGone()
    monkeypatch.setattr(q.push, 'send', fake_send)

    t = FakeTable()
    start_night(t)
    q.handle_action(t, {'type': 'join', 'userId': 'user-alex', 'username': 'Alex',
                         'payload': {'gameId': 'catan', 'gameTitle': 'Catan'}})
    q.handle_push_subscribe(t, {'userId': 'user-alex', 'subscription': _subscription()})

    status, body = q.handle_action(t, {'type': 'join', 'userId': 'user-sam', 'username': 'Sam',
                                        'payload': {'gameId': 'catan'}})
    assert status == 200  # the join itself still succeeds
    assert q._subscriptions_for(t, 'user-alex') == []  # but the dead subscription is gone
```

Also add the import at the top of `infrastructure/lambda/tests/test_queue_db.py`:

```python
import queue_db as q
from test_undercity_db import FakeTable, act as uc_act
```
(unchanged — `q.push` is reached via `queue_db`'s own `import push`, added next.)

- [ ] **Step 7: Run tests to verify they fail**

Run: `cd infrastructure/lambda && python -m pytest tests/test_queue_db.py -k notif -v`
Expected: FAIL — `q.push` doesn't exist yet, and no push is sent on join.

- [ ] **Step 8: Wire notification sending into `_join`**

In `infrastructure/lambda/queue_db.py`, add the import at the top:

```python
import hashlib
import json
import time

import push
import undercity_db
```

Replace the `_join` function's body to send notifications after a genuine (non-duplicate) join:

```python
def _join(table, sid, user_id, username, payload):
    game_id = str(payload.get('gameId') or '').strip()
    if not game_id:
        return _err('gameId is required')
    game_title = str(payload.get('gameTitle') or game_id).strip()

    pk, sk = _queue_pk(sid), _game_sk(game_id)
    entry = _get(table, pk, sk)
    if not entry:
        entry = {
            'pk': pk, 'sk': sk,
            'gameId': game_id,
            'gameTitle': game_title,
            'addedBy': user_id,
            'addedByName': username,
            'addedAt': _now_ts(),
            'joined': [],
        }

    already_in = any(m['userId'] == user_id for m in entry['joined'])
    if not already_in:
        entry['joined'].append({'userId': user_id, 'username': username})
        table.put_item(Item=entry)
        _notify_others(table, entry, joiner_id=user_id, joiner_name=username)

    return _ok(entry=_public_entry(entry))


def _notify_others(table, entry, joiner_id, joiner_name):
    others = [m['userId'] for m in entry['joined'] if m['userId'] != joiner_id]
    if not others:
        return
    who = joiner_name or joiner_id
    message = f'{who} wants to play {entry["gameTitle"]} too'
    for user_id in others:
        for sub in _subscriptions_for(table, user_id):
            try:
                push.send(sub, message, entry['gameId'])
            except push.PushGone:
                table.delete_item(Key={'pk': sub['pk'], 'sk': sub['sk']})
```

- [ ] **Step 9: Run tests to verify they pass**

Run: `cd infrastructure/lambda && python -m pytest tests/test_queue_db.py -v`
Expected: PASS (16 tests)

- [ ] **Step 10: Run the full suite**

Run: `cd infrastructure/lambda && python -m pytest tests -q`
Expected: All tests pass, none broken by the new import.

- [ ] **Step 11: Commit**

```bash
git add infrastructure/lambda/push.py infrastructure/lambda/queue_db.py \
        infrastructure/lambda/requirements.txt infrastructure/lambda/tests/test_push.py \
        infrastructure/lambda/tests/test_queue_db.py
git commit -m "feat(queue): send a Web Push to lobby members on every new join"
```

---

### Task 6: CDK — package pywebpush, add VAPID env vars

**Files:**
- Modify: `infrastructure/lib/game-day-backend-stack.ts:51-66`

`Code.fromAsset` currently zips `infrastructure/lambda/` verbatim with no dependency install step — fine while `boto3` was the only dependency (it ships with the runtime). `pywebpush` depends on `cryptography`, a compiled wheel that must be built for the Lambda's Linux/glibc target, so this task switches to CDK's Docker-based asset bundling, which runs `pip install` inside a Lambda-compatible container image at `cdk synth`/`cdk deploy` time. **This requires Docker Desktop running locally when the user deploys** — call this out, don't attempt to deploy yourself.

- [ ] **Step 1: Update the Lambda `code`/`environment` in the stack**

In `infrastructure/lib/game-day-backend-stack.ts`, replace lines 51-66:

```typescript
    // 🚀 LAMBDA FUNCTION - Single function handles everything (PYTHON)
    const gameDayApi = new lambda.Function(this, 'GameDayApi', {
      functionName: 'game-day-api',
      runtime: lambda.Runtime.PYTHON_3_11,
      // Docker-bundled so pywebpush's cryptography wheel is built for Lambda's
      // Linux target, not whatever platform `cdk deploy` runs on. Requires
      // Docker to be running locally at deploy time.
      code: lambda.Code.fromAsset(join(__dirname, '../lambda'), {
        bundling: {
          image: lambda.Runtime.PYTHON_3_11.bundlingImage,
          command: [
            'bash', '-c',
            'pip install -r requirements.txt -t /asset-output && cp -au . /asset-output',
          ],
        },
      }),
      handler: 'lambda_function.lambda_handler',

      // Optimize for free tier
      memorySize: 128, // Minimum = maximize free tier seconds
      timeout: cdk.Duration.seconds(30), // Reasonable timeout

      // Environment variables
      environment: {
        TABLE_NAME: gameDayTable.tableName,
        USER_INDEX_NAME: 'user-index',
        // Generated once via the script in Task 7; set VAPID_PRIVATE_KEY in
        // your shell before `cdk deploy` — never commit the private key.
        VAPID_PRIVATE_KEY: process.env.VAPID_PRIVATE_KEY ?? '',
        VAPID_SUBJECT: 'mailto:admin@golgaripalace.example',
      },
    });
```

- [ ] **Step 2: Verify the stack still synthesizes**

Run: `cd infrastructure && npx cdk synth > /dev/null && echo OK`
Expected: `OK` (requires Docker running — if it's not running locally right now, note that in your report instead of forcing it; this step just proves the TypeScript/CDK construct is valid, the actual bundling will be exercised at real deploy time).

- [ ] **Step 3: Commit**

```bash
git add infrastructure/lib/game-day-backend-stack.ts
git commit -m "feat(queue): bundle pywebpush into the Lambda deploy and add VAPID env vars"
```

Do **not** run `cdk deploy` — deploys are run by the user. Note this explicitly when handing off.

---

## Frontend

### Task 7: Generate the VAPID keypair

**Files:**
- Create: `infrastructure/lambda/scripts/generate_vapid_keys.py` (one-time utility, not imported by app code)

- [ ] **Step 1: Write the key-generation script**

Create `infrastructure/lambda/scripts/generate_vapid_keys.py`:

```python
"""
One-time utility: generate a VAPID keypair for Web Push.

Run: python infrastructure/lambda/scripts/generate_vapid_keys.py

Prints two values:
  VAPID_PRIVATE_KEY — set as the Lambda's env var (via `VAPID_PRIVATE_KEY=... cdk deploy`),
                       never commit this.
  VAPID_PUBLIC_KEY  — safe to commit; paste into
                       src/app/services/queue-push.service.ts.
"""
import base64

from cryptography.hazmat.primitives import serialization
from cryptography.hazmat.primitives.asymmetric import ec


def b64url(raw: bytes) -> str:
    return base64.urlsafe_b64encode(raw).rstrip(b'=').decode()


def main():
    private_key = ec.generate_private_key(ec.SECP256R1())
    public_key = private_key.public_key()

    private_raw = private_key.private_numbers().private_value.to_bytes(32, 'big')
    public_raw = public_key.public_bytes(
        serialization.Encoding.X962,
        serialization.PublicFormat.UncompressedPoint,
    )

    print(f'VAPID_PRIVATE_KEY={b64url(private_raw)}')
    print(f'VAPID_PUBLIC_KEY={b64url(public_raw)}')


if __name__ == '__main__':
    main()
```

- [ ] **Step 2: Run it and record the output**

Run: `cd infrastructure/lambda && pip install -r requirements.txt && python scripts/generate_vapid_keys.py`
Expected: Two lines printed, `VAPID_PRIVATE_KEY=...` and `VAPID_PUBLIC_KEY=...`. Save both somewhere private (e.g. a password manager) — the private key goes in your shell environment before `cdk deploy` (Task 6), never into git. The public key is pasted into `queue-push.service.ts` in Task 12.

- [ ] **Step 3: Commit the script (not the generated keys)**

```bash
git add infrastructure/lambda/scripts/generate_vapid_keys.py
git commit -m "chore(queue): add VAPID keypair generation script"
```

---

### Task 8: `QueueApiService` — fetch wrapper for the new endpoints

**Files:**
- Create: `src/app/services/queue-models.ts`
- Create: `src/app/services/queue-api.service.ts`

- [ ] **Step 1: Define the shared types**

Create `src/app/services/queue-models.ts`:

```typescript
export interface QueueMember {
  userId: string;
  username: string;
}

export interface QueueEntry {
  gameId: string;
  gameTitle: string;
  addedBy: string;
  addedByName: string;
  addedAt: number;
  joined: QueueMember[];
}

export interface QueueState {
  seasonId: string | null;
  entries: QueueEntry[];
}

export interface QueueActionResponse {
  ok: boolean;
  entry: QueueEntry | null;
}
```

- [ ] **Step 2: Implement the API service**

Create `src/app/services/queue-api.service.ts`, following the exact fetch pattern already used by `UndercityApiService` (`src/app/undercity/services/undercity-api.service.ts`):

```typescript
import { Injectable, inject } from '@angular/core';
import { UserService } from './user.service';
import { QueueActionResponse, QueueState } from './queue-models';

/** Raised for non-2xx queue responses so callers can show the server's text. */
export class QueueApiError extends Error {
  constructor(
    message: string,
    public status: number,
  ) {
    super(message);
  }
}

@Injectable({ providedIn: 'root' })
export class QueueApiService {
  // Same Lambda Function URL the rest of the site talks to (AwsApiService).
  private readonly API_BASE_URL =
    'https://en53hl67hhzmm5n4ydc26qxeru0doggy.lambda-url.us-east-1.on.aws';

  private readonly userService = inject(UserService);

  async getState(): Promise<QueueState> {
    const response = await fetch(`${this.API_BASE_URL}/queue/state`, {
      method: 'GET',
      mode: 'cors',
      headers: { 'Content-Type': 'application/json' },
    });
    if (!response.ok) {
      throw new QueueApiError(`Failed to load queue (${response.status})`, response.status);
    }
    return response.json();
  }

  join(gameId: string, gameTitle: string): Promise<QueueActionResponse> {
    return this.action('join', { gameId, gameTitle });
  }

  leave(gameId: string): Promise<QueueActionResponse> {
    return this.action('leave', { gameId });
  }

  async subscribePush(subscription: unknown): Promise<void> {
    const response = await fetch(`${this.API_BASE_URL}/queue/push/subscribe`, {
      method: 'POST',
      mode: 'cors',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ userId: this.userService.userId(), subscription }),
    });
    if (!response.ok) {
      throw new QueueApiError(`Failed to subscribe to push (${response.status})`, response.status);
    }
  }

  async unsubscribePush(endpoint: string): Promise<void> {
    const response = await fetch(`${this.API_BASE_URL}/queue/push/unsubscribe`, {
      method: 'POST',
      mode: 'cors',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ userId: this.userService.userId(), endpoint }),
    });
    if (!response.ok) {
      throw new QueueApiError(`Failed to unsubscribe from push (${response.status})`, response.status);
    }
  }

  private async action(
    type: string,
    payload: Record<string, unknown>,
  ): Promise<QueueActionResponse> {
    const response = await fetch(`${this.API_BASE_URL}/queue/action`, {
      method: 'POST',
      mode: 'cors',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        type,
        userId: this.userService.userId(),
        username: this.userService.username(),
        payload,
      }),
    });
    const body = (await response.json()) as QueueActionResponse & { error?: string };
    if (!response.ok) {
      throw new QueueApiError(body?.error ?? `Action failed (${response.status})`, response.status);
    }
    return body;
  }
}
```

- [ ] **Step 3: Verify the project still builds**

Run: `npm run build`
Expected: Build succeeds (no consumers reference these files yet, so this just checks for TypeScript syntax errors).

- [ ] **Step 4: Commit**

```bash
git add src/app/services/queue-models.ts src/app/services/queue-api.service.ts
git commit -m "feat(queue): add QueueApiService for the new /queue endpoints"
```

---

### Task 9: `QueueService` — signal store

**Files:**
- Create: `src/app/services/queue.service.ts`

- [ ] **Step 1: Implement the store**

Create `src/app/services/queue.service.ts`, mirroring `UndercityStateService`'s poll/signal pattern (`src/app/undercity/services/undercity-state.service.ts`):

```typescript
import { Injectable, computed, inject, signal } from '@angular/core';
import { UserService } from './user.service';
import { QueueApiService } from './queue-api.service';
import { QueueEntry, QueueState } from './queue-models';

const POLL_INTERVAL_MS = 20_000;

/**
 * Signal store for tonight's queue. Polls while mounted and the tab is
 * visible; join/leave apply their response optimistically and the next poll
 * reconciles. Real-time "someone joined" awareness comes from push
 * notifications (QueuePushService), not from tight polling.
 */
@Injectable({ providedIn: 'root' })
export class QueueService {
  private readonly api = inject(QueueApiService);
  private readonly userService = inject(UserService);

  private readonly _state = signal<QueueState>({ seasonId: null, entries: [] });
  private readonly _loading = signal(false);
  private readonly _error = signal<string | null>(null);

  readonly seasonId = computed(() => this._state().seasonId);
  readonly entries = computed(() => this._state().entries);
  readonly isNightActive = computed(() => this._state().seasonId !== null);
  readonly loading = this._loading.asReadonly();
  readonly error = this._error.asReadonly();

  private pollTimer: ReturnType<typeof setInterval> | null = null;
  private visibilityHandler = () => {
    if (document.visibilityState === 'visible') void this.refresh();
  };

  startPolling(): void {
    if (this.pollTimer) return;
    void this.refresh();
    this.pollTimer = setInterval(() => {
      if (document.visibilityState === 'visible') void this.refresh();
    }, POLL_INTERVAL_MS);
    document.addEventListener('visibilitychange', this.visibilityHandler);
  }

  stopPolling(): void {
    if (this.pollTimer) {
      clearInterval(this.pollTimer);
      this.pollTimer = null;
    }
    document.removeEventListener('visibilitychange', this.visibilityHandler);
  }

  async refresh(): Promise<void> {
    if (this._loading()) return;
    this._loading.set(true);
    try {
      const next = await this.api.getState();
      this._state.set(next);
      this._error.set(null);
    } catch (e) {
      this._error.set(e instanceof Error ? e.message : 'Network error');
    } finally {
      this._loading.set(false);
    }
  }

  entryFor(gameId: string): QueueEntry | undefined {
    return this.entries().find((e) => e.gameId === gameId);
  }

  isJoined(gameId: string): boolean {
    const uid = this.userService.userId();
    if (!uid) return false;
    return this.entryFor(gameId)?.joined.some((m) => m.userId === uid) ?? false;
  }

  async join(gameId: string, gameTitle: string): Promise<void> {
    try {
      const resp = await this.api.join(gameId, gameTitle);
      this.applyEntry(gameId, resp.entry);
      this._error.set(null);
    } catch (e) {
      this._error.set(e instanceof Error ? e.message : 'Could not join the queue.');
      throw e;
    }
  }

  async leave(gameId: string): Promise<void> {
    try {
      const resp = await this.api.leave(gameId);
      this.applyEntry(gameId, resp.entry);
      this._error.set(null);
    } catch (e) {
      this._error.set(e instanceof Error ? e.message : 'Could not leave the queue.');
      throw e;
    }
  }

  private applyEntry(gameId: string, entry: QueueEntry | null): void {
    const cur = this._state();
    const rest = cur.entries.filter((e) => e.gameId !== gameId);
    this._state.set({
      ...cur,
      entries: entry ? [...rest, entry] : rest,
    });
  }
}
```

- [ ] **Step 2: Verify the project still builds**

Run: `npm run build`
Expected: Build succeeds.

- [ ] **Step 3: Commit**

```bash
git add src/app/services/queue.service.ts
git commit -m "feat(queue): add QueueService signal store"
```

---

### Task 10: Enable the Angular service worker

**Files:**
- Modify: `angular.json:15-40` (build options)
- Modify: `src/app/app.config.ts`

The package (`@angular/service-worker`) and a config file (`ngsw-config.json`, at repo root) already exist but nothing registers the worker — confirmed by grepping the whole `src/app` tree for `SwPush`/`ngsw`/`serviceWorker`, all empty. This task wires it up for the first time; it's a prerequisite for push notifications (Task 12), not a queue-specific feature on its own.

- [ ] **Step 1: Point the build at the ngsw config**

In `angular.json`, inside `projects.golgari-palace-gameday.architect.build.options` (the object starting at line 17), add two keys alongside the existing ones:

```json
          "options": {
            "outputPath": "docs",
            "index": "src/index.html",
            "main": "src/main.ts",
            "polyfills": ["zone.js"],
            "tsConfig": "tsconfig.app.json",
            "inlineStyleLanguage": "scss",
            "serviceWorker": true,
            "ngswConfigPath": "ngsw-config.json",
            "assets": [
```

- [ ] **Step 2: Register the worker in app bootstrap**

In `src/app/app.config.ts`, replace the full contents:

```typescript
import { ApplicationConfig, isDevMode, provideBrowserGlobalErrorListeners, provideZoneChangeDetection } from '@angular/core';
import { provideRouter } from '@angular/router';
import { provideHttpClient } from '@angular/common/http';
import { provideServiceWorker } from '@angular/service-worker';

import { routes } from './app.routes';

export const appConfig: ApplicationConfig = {
  providers: [
    provideBrowserGlobalErrorListeners(),
    provideZoneChangeDetection({ eventCoalescing: true }),
    provideRouter(routes),
    provideHttpClient(),
    provideServiceWorker('ngsw-worker.js', {
      enabled: !isDevMode(),
      registrationStrategy: 'registerWhenStable:30000',
    }),
  ]
};
```

- [ ] **Step 3: Verify a production build generates the worker**

Run: `npm run build:prod`
Expected: Build succeeds and `docs/ngsw-worker.js` + `docs/ngsw.json` exist afterward (confirm with `ls docs/ngsw-worker.js docs/ngsw.json` on macOS/Linux or `Test-Path docs/ngsw-worker.js` on PowerShell).

- [ ] **Step 4: Commit**

```bash
git add angular.json src/app/app.config.ts
git commit -m "feat(queue): enable the Angular service worker (prerequisite for push)"
```

Note: `docs/` is gitignored build output — don't `git add` it.

---

### Task 11: `QueuePushService` — subscribe/unsubscribe via `SwPush`

**Files:**
- Create: `src/app/services/queue-push.service.ts`

- [ ] **Step 1: Implement the service**

Create `src/app/services/queue-push.service.ts`. Replace `<PASTE_VAPID_PUBLIC_KEY_HERE>` with the `VAPID_PUBLIC_KEY` value printed by Task 7's script:

```typescript
import { Injectable, inject } from '@angular/core';
import { SwPush } from '@angular/service-worker';
import { firstValueFrom } from 'rxjs';
import { take } from 'rxjs/operators';
import { QueueApiService } from './queue-api.service';

// Paired with VAPID_PRIVATE_KEY on the Lambda (infrastructure/lambda/push.py).
// Public by design — regenerate both together via
// infrastructure/lambda/scripts/generate_vapid_keys.py if this ever changes.
const VAPID_PUBLIC_KEY = '<PASTE_VAPID_PUBLIC_KEY_HERE>';

const OPT_OUT_STORAGE_KEY = 'gameday-queue-push-opt-out';

/**
 * Wraps SwPush so QueueService doesn't need to know about subscription
 * bookkeeping. Subscribing triggers the browser's native permission prompt —
 * that prompt IS the user-facing "get notified?" ask, no custom UI needed.
 */
@Injectable({ providedIn: 'root' })
export class QueuePushService {
  private readonly swPush = inject(SwPush);
  private readonly api = inject(QueueApiService);

  get isSupported(): boolean {
    return this.swPush.isEnabled;
  }

  get hasOptedOut(): boolean {
    return localStorage.getItem(OPT_OUT_STORAGE_KEY) === 'true';
  }

  /** No-op if unsupported, already subscribed, or the user previously declined/dismissed. */
  async ensureSubscribed(): Promise<void> {
    if (!this.isSupported || this.hasOptedOut) return;

    const existing = await firstValueFrom(this.swPush.subscription.pipe(take(1)));
    if (existing) return;

    try {
      const sub = await this.swPush.requestSubscription({ serverPublicKey: VAPID_PUBLIC_KEY });
      await this.api.subscribePush(sub.toJSON());
    } catch {
      // Permission denied, dismissed, or the request failed — remember so we
      // don't re-prompt every time the user joins a lobby.
      localStorage.setItem(OPT_OUT_STORAGE_KEY, 'true');
    }
  }
}
```

- [ ] **Step 2: Verify the project still builds**

Run: `npm run build`
Expected: Build succeeds.

- [ ] **Step 3: Commit**

```bash
git add src/app/services/queue-push.service.ts
git commit -m "feat(queue): add QueuePushService wrapping SwPush subscription"
```

---

### Task 12: Wire push opt-in into `QueueService.join()`

**Files:**
- Modify: `src/app/services/queue.service.ts`

- [ ] **Step 1: Call `ensureSubscribed()` after a successful join**

In `src/app/services/queue.service.ts`, add the import:

```typescript
import { QueuePushService } from './queue-push.service';
```

Add the injection alongside the existing ones:

```typescript
  private readonly api = inject(QueueApiService);
  private readonly userService = inject(UserService);
  private readonly push = inject(QueuePushService);
```

Update `join()`:

```typescript
  async join(gameId: string, gameTitle: string): Promise<void> {
    try {
      const resp = await this.api.join(gameId, gameTitle);
      this.applyEntry(gameId, resp.entry);
      this._error.set(null);
      void this.push.ensureSubscribed();
    } catch (e) {
      this._error.set(e instanceof Error ? e.message : 'Could not join the queue.');
      throw e;
    }
  }
```

- [ ] **Step 2: Verify the project still builds**

Run: `npm run build`
Expected: Build succeeds.

- [ ] **Step 3: Commit**

```bash
git add src/app/services/queue.service.ts
git commit -m "feat(queue): prompt for push notifications on first lobby join"
```

---

### Task 13: "Tonight's Queue" panel on the home page

**Files:**
- Create: `src/app/games/queue-panel/queue-panel.component.ts`
- Create: `src/app/games/queue-panel/queue-panel.component.html`
- Create: `src/app/games/queue-panel/queue-panel.component.scss`
- Modify: `src/app/games/games.component.ts`
- Modify: `src/app/games/games.component.html`

- [ ] **Step 1: Implement the panel component**

Create `src/app/games/queue-panel/queue-panel.component.ts`:

```typescript
import { Component, OnDestroy, OnInit, inject } from '@angular/core';
import { CommonModule } from '@angular/common';
import { MatIconModule } from '@angular/material/icon';
import { QueueService } from '../../services/queue.service';
import { UserService } from '../../services/user.service';

@Component({
  selector: 'app-queue-panel',
  standalone: true,
  imports: [CommonModule, MatIconModule],
  templateUrl: './queue-panel.component.html',
  styleUrls: ['./queue-panel.component.scss'],
})
export class QueuePanelComponent implements OnInit, OnDestroy {
  readonly queue = inject(QueueService);
  private readonly userService = inject(UserService);

  ngOnInit(): void {
    this.queue.startPolling();
  }

  ngOnDestroy(): void {
    this.queue.stopPolling();
  }

  memberNames(gameId: string): string {
    const entry = this.queue.entryFor(gameId);
    if (!entry) return '';
    return entry.joined.map((m) => m.username || m.userId).join(', ');
  }

  async toggle(gameId: string, gameTitle: string): Promise<void> {
    if (!(await this.userService.requireSignIn())) return;
    if (this.queue.isJoined(gameId)) {
      await this.queue.leave(gameId);
    } else {
      await this.queue.join(gameId, gameTitle);
    }
  }
}
```

- [ ] **Step 2: Implement the template**

Create `src/app/games/queue-panel/queue-panel.component.html`:

```html
<section class="queue-panel" *ngIf="queue.isNightActive() && queue.entries().length > 0">
  <div class="queue-panel-header">
    <mat-icon class="queue-icon">casino</mat-icon>
    <span class="queue-title">Tonight's Queue</span>
  </div>

  <ul class="queue-list" role="list">
    <li *ngFor="let entry of queue.entries()" class="queue-entry">
      <div class="queue-entry-main">
        <span class="queue-game-title">{{ entry.gameTitle }}</span>
        <span class="queue-members">{{ memberNames(entry.gameId) }}</span>
      </div>
      <button
        type="button"
        class="queue-join-btn"
        [class.joined]="queue.isJoined(entry.gameId)"
        (click)="toggle(entry.gameId, entry.gameTitle)"
      >
        {{ queue.isJoined(entry.gameId) ? 'Leave' : 'Join' }}
      </button>
    </li>
  </ul>

  <p class="queue-error" *ngIf="queue.error() as err">{{ err }}</p>
</section>
```

- [ ] **Step 3: Implement styles**

Create `src/app/games/queue-panel/queue-panel.component.scss`:

```scss
:host {
  display: block;
}

.queue-panel {
  background: var(--games-surface);
  border: 1px solid var(--games-surface-border);
  border-radius: 8px;
  padding: 10px 12px;
  margin: 10px 0;
}

.queue-panel-header {
  display: flex;
  align-items: center;
  gap: 6px;
  font-weight: 700;
  font-size: 13px;
  margin-bottom: 8px;

  .queue-icon {
    color: var(--accent-color);
    font-size: 18px;
    width: 18px;
    height: 18px;
  }
}

.queue-list {
  list-style: none;
  padding: 0;
  margin: 0;
  display: flex;
  flex-direction: column;
  gap: 6px;
}

.queue-entry {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 10px;
}

.queue-entry-main {
  display: flex;
  flex-direction: column;
  min-width: 0;
}

.queue-game-title {
  font-weight: 600;
  font-size: 13px;
}

.queue-members {
  font-size: 11px;
  color: var(--games-text-secondary);
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}

.queue-join-btn {
  flex-shrink: 0;
  border: 1px solid var(--accent-color);
  background: transparent;
  color: var(--accent-color);
  border-radius: 999px;
  padding: 4px 12px;
  font-size: 12px;
  font-weight: 600;
  cursor: pointer;

  &.joined {
    background: var(--accent-color);
    color: white;
  }
}

.queue-error {
  color: #c0392b;
  font-size: 11px;
  margin: 8px 0 0;
}
```

- [ ] **Step 4: Mount the panel on the home page**

In `src/app/games/games.component.ts`, add the import:

```typescript
import { QueuePanelComponent } from './queue-panel/queue-panel.component';
```

Add it to the `imports` array (after `GamesFeaturedCarouselComponent`):

```typescript
  imports: [
    CommonModule,
    FormsModule,
    MatIconModule,
    GamesSearchBarComponent,
    GamesGenreStripComponent,
    GamesHeroComponent,
    GamesListComponent,
    GamesFeaturedCarouselComponent,
    QueuePanelComponent,
  ],
```

In `src/app/games/games.component.html`, add the panel right after the featured-carousel block (after line 33, before the `filteredGames$` container on line 35):

```html
  <ng-container *ngIf="!isFiltered && (featured$ | async) as featured">
    <app-games-featured-carousel
      *ngIf="featured.length > 0"
      [selections]="featured"
      (open)="onOpenGame($event)"
    ></app-games-featured-carousel>
  </ng-container>

  <app-queue-panel></app-queue-panel>

  <ng-container *ngIf="(filteredGames$ | async) as games">
```

- [ ] **Step 5: Manually verify in the browser**

Run: `npm start`, open http://localhost:4200/home. With no Undercity night active, the panel should not render (empty entries). This is a UI feature — full interaction (joining a lobby, seeing a second browser tab's push notification) is verified end-to-end in Task 15, once a real season can be started via `/undercity`.

- [ ] **Step 6: Commit**

```bash
git add src/app/games/queue-panel/ src/app/games/games.component.ts src/app/games/games.component.html
git commit -m "feat(queue): add Tonight's Queue panel to the home page"
```

---

### Task 14: Per-card queue badge in the games list

**Files:**
- Modify: `src/app/games/games-list/games-list.component.ts`
- Modify: `src/app/games/games-list/games-list.component.html`
- Modify: `src/app/games/games-list/games-list.component.scss`
- Modify: `src/app/games/games.component.html`

- [ ] **Step 1: Inject `QueueService` into the list component**

In `src/app/games/games-list/games-list.component.ts`, add the import and injection, plus a helper for the badge count and a join/leave handler:

```typescript
import { Component, EventEmitter, Input, Output, inject } from '@angular/core';
import { CommonModule } from '@angular/common';
import { MatIconModule } from '@angular/material/icon';
import { Game, GameGenre } from '../../models/game.model';
import { GameStats } from '../../services/data-aggregation.service';
import { GenreIconService } from '../../services/genre-icon.service';
import { QueueService } from '../../services/queue.service';
import { UserService } from '../../services/user.service';

@Component({
  selector: 'app-games-list',
  standalone: true,
  imports: [CommonModule, MatIconModule],
  templateUrl: './games-list.component.html',
  styleUrls: ['./games-list.component.scss'],
})
export class GamesListComponent {
  @Input() games: Game[] = [];
  /** gameId → stats. Missing entries treated as zero-likes/zero-comments. */
  @Input() statsById: Record<string, GameStats> = {};

  @Output() open = new EventEmitter<Game>();

  readonly queue = inject(QueueService);
  private readonly userService = inject(UserService);

  constructor(public iconService: GenreIconService) {}

  trackById(_index: number, g: Game): string {
    return g.id;
  }

  playerLabel(g: Game): string {
    return g.minPlayers === g.maxPlayers ? `${g.minPlayers}` : `${g.minPlayers}–${g.maxPlayers}`;
  }

  topGenres(g: Game): GameGenre[] {
    return g.genres.slice(0, 2);
  }

  extraGenresCount(g: Game): number {
    return Math.max(0, g.genres.length - 2);
  }

  likes(g: Game): number {
    return this.statsById[g.id]?.totalLikes ?? 0;
  }

  comments(g: Game): number {
    return this.statsById[g.id]?.totalComments ?? 0;
  }

  queuedCount(g: Game): number {
    return this.queue.entryFor(g.id)?.joined.length ?? 0;
  }

  async toggleQueue(event: Event, g: Game): Promise<void> {
    event.stopPropagation(); // don't also open the game details dialog
    if (!(await this.userService.requireSignIn())) return;
    if (this.queue.isJoined(g.id)) {
      await this.queue.leave(g.id);
    } else {
      await this.queue.join(g.id, g.title);
    }
  }
}
```

- [ ] **Step 2: Add the badge to the template**

In `src/app/games/games-list/games-list.component.html`, add a queue badge block after the existing `.social` block (after line 46):

```html
    <div class="social" *ngIf="likes(g) || comments(g)">
      <span *ngIf="likes(g)" class="social-item heart">
        <mat-icon class="social-icon">favorite</mat-icon>{{ likes(g) }}
      </span>
      <span *ngIf="comments(g)" class="social-item">
        <mat-icon class="social-icon">mode_comment</mat-icon>{{ comments(g) }}
      </span>
    </div>

    <button
      *ngIf="queue.isNightActive()"
      type="button"
      class="queue-badge"
      [class.joined]="queue.isJoined(g.id)"
      (click)="toggleQueue($event, g)"
    >
      <mat-icon class="queue-badge-icon">casino</mat-icon>
      <span *ngIf="queuedCount(g) > 0">{{ queuedCount(g) }} queued</span>
      <span *ngIf="queuedCount(g) === 0">Queue</span>
    </button>
```

- [ ] **Step 3: Style the badge**

In `src/app/games/games-list/games-list.component.scss`, add after the `.social` block (after line 178, before the closing `}` of `.games-list-item`):

```scss
  .queue-badge {
    position: absolute;
    bottom: 8px;
    right: 8px;
    display: inline-flex;
    align-items: center;
    gap: 3px;
    background: rgba(0, 0, 0, 0.75);
    border: 1px solid var(--accent-color);
    color: var(--accent-color);
    padding: 2px 8px;
    border-radius: 999px;
    font-size: 10px;
    font-weight: 700;
    line-height: 1.6;
    cursor: pointer;

    &.joined {
      background: var(--accent-color);
      color: white;
    }

    .queue-badge-icon {
      font-size: 11px;
      width: 11px;
      height: 11px;
    }
  }
```

- [ ] **Step 4: Start polling once from the page, not the list**

`QueuePanelComponent` (Task 13) already calls `queue.startPolling()`/`stopPolling()` from `games.component.html`, and `GamesListComponent` is only ever rendered as a child of `GamesComponent`, so no separate polling lifecycle is needed here — it reads the same shared `QueueService` singleton.

- [ ] **Step 5: Manually verify in the browser**

Run: `npm start`, open http://localhost:4200/home. Confirm the page still builds and renders with no badges when no Undercity night is active (matches Task 13's manual check).

- [ ] **Step 6: Commit**

```bash
git add src/app/games/games-list/
git commit -m "feat(queue): add per-card queue badge and join/leave to the games list"
```

---

### Task 15: End-to-end manual verification

**Files:** none (manual verification only)

- [ ] **Step 1: Run the full backend test suite**

Run: `cd infrastructure/lambda && python -m pytest tests -q`
Expected: All tests pass (existing Undercity suite + all new queue/push tests).

- [ ] **Step 2: Run a production build**

Run: `npm run build:prod`
Expected: Builds cleanly, `docs/ngsw-worker.js` present.

- [ ] **Step 3: Manual browser walkthrough**

Run: `npm start`, then in two separate browser profiles/tabs (so each gets its own anonymous identity via `localStorage`):
1. Sign in as two different names.
2. In one tab, go to `/undercity` and start a night (host key).
3. Back on `/home`, confirm the queue panel now can accept an add — join a game from a card badge in Tab A. Grant the browser's notification permission prompt when it appears.
4. In Tab B, join the same game. Tab A should receive a system push notification (even if the `/home` tab isn't focused, as long as the browser is running) saying Tab B's user wants to play too.
5. Confirm both tabs show both users under that game's queue entry (allow up to 20s for polling, or refresh).
6. Leave the lobby from Tab B; confirm the entry drops to one member in both tabs after the next poll.
7. Leave from Tab A too; confirm the entry disappears from the panel and badge in both tabs.

- [ ] **Step 4: Report results, don't deploy**

Summarize pass/fail for each sub-step above. Per project convention, do not run `cdk deploy` or `npm run deploy` — hand off to the user with a note that both a backend deploy (with `VAPID_PRIVATE_KEY` set in the shell and Docker running) and a frontend deploy are needed to go live.
