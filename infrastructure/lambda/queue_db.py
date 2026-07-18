"""
DynamoDB orchestration for the game-night Queue.

Item layout (existing single table, pk/sk strings):
  QUEUE#{sid}          / GAME#{gameId}      queued game + who's joined
  PUSHSUB#{userId}     / SUB#{endpointHash} browser push subscription

Queue entries are keyed to the currently active Undercity season (via
undercity_db.get_active_season), so a fresh night starts with an empty
queue and there is no separate queue lifecycle to manage.
"""
import hashlib
import json
import time

import undercity_db

# NOTE: `push` (and its pywebpush/cryptography dependency) is imported lazily
# inside _notify_others, never at module load. A broken or missing web-push
# dependency must only degrade notifications — it must never crash Lambda init
# and take down the core game/comments/likes endpoints that share this handler.


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
        _notify_others(table, entry, joiner_id=user_id, joiner_name=username)

    return _ok(entry=_public_entry(entry))


def _notify_others(table, entry, joiner_id, joiner_name):
    others = [m['userId'] for m in entry['joined'] if m['userId'] != joiner_id]
    if not others:
        return
    # Best-effort: a web-push problem (missing dependency, bad VAPID key,
    # network error) must never fail the join that triggered it. Import lazily
    # so a broken pywebpush only affects this path, not module load.
    try:
        import push
    except Exception:
        return
    who = joiner_name or joiner_id
    message = f'{who} wants to play {entry["gameTitle"]} too'
    for user_id in others:
        for sub in _subscriptions_for(table, user_id):
            try:
                push.send(sub, message, entry['gameId'])
            except push.PushGone:
                table.delete_item(Key={'pk': sub['pk'], 'sk': sub['sk']})
            except Exception:
                # Swallow any other send error — notifications are optional.
                pass


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
