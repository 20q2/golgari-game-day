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
