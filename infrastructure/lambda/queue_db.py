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

import push_db
import undercity_db

from botocore.exceptions import ClientError

# Push subscription storage + delivery live in `push_db` (shared with Undercity).
# push_db keeps its pywebpush/cryptography dependency behind a lazy import so a
# broken or missing web-push dependency only degrades notifications — it never
# crashes Lambda init and takes down the core game endpoints that share this
# handler.

_QUEUE_URL = '/golgari-game-day/'  # tapping a queue push focuses/opens the app


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
        'status': item.get('status', 'lobby'),
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
    entries = [_public_entry(item) for item in resp.get('Items', [])
               if item.get('status', 'lobby') != 'closed']
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
    if atype == 'start':
        return _start(table, sid, user_id, payload)
    if atype == 'close':
        return _close(table, sid, user_id, payload)
    return _err(f'Unknown action: {atype}')


def _join(table, sid, user_id, username, payload):
    game_id = str(payload.get('gameId') or '').strip()
    if not game_id:
        return _err('gameId is required')
    game_title = str(payload.get('gameTitle') or game_id).strip()

    pk, sk = _queue_pk(sid), _game_sk(game_id)
    entry = _get(table, pk, sk)
    if entry and entry.get('status', 'lobby') != 'lobby':
        return _err('That game has already started.', 409)
    if not entry:
        entry = {
            'pk': pk, 'sk': sk,
            'gameId': game_id,
            'gameTitle': game_title,
            'addedBy': user_id,
            'addedByName': username,
            'addedAt': _now_ts(),
            'status': 'lobby',
            'ver': 0,
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
    body = f'{who} wants to play {entry["gameTitle"]} too'
    # Best-effort delivery (dead-subscription cleanup + error swallowing) lives in
    # push_db — a web-push problem must never fail the join that triggered it.
    for user_id in others:
        push_db.send_to_user(table, user_id, 'Game Queue', body, _QUEUE_URL)


def _leave(table, sid, user_id, payload):
    game_id = str(payload.get('gameId') or '').strip()
    if not game_id:
        return _err('gameId is required')

    pk, sk = _queue_pk(sid), _game_sk(game_id)
    entry = _get(table, pk, sk)
    if not entry:
        return _err('Not in queue.', 404)
    if entry.get('status', 'lobby') != 'lobby':
        return _err('That game has already started.', 409)

    entry['joined'] = [m for m in entry['joined'] if m['userId'] != user_id]
    if not entry['joined']:
        table.delete_item(Key={'pk': pk, 'sk': sk})
        return _ok(entry=None)

    table.put_item(Item=entry)
    return _ok(entry=_public_entry(entry))


def _put_entry(table, entry):
    """Optimistic write guarded on `ver` (mirrors the player-doc pattern). The
    entry must already exist. Returns False if another writer got there first."""
    expected = entry.get('ver', 0)
    entry = dict(entry)
    entry['ver'] = expected + 1
    try:
        table.put_item(Item=entry, ConditionExpression='ver = :v',
                       ExpressionAttributeValues={':v': expected})
    except ClientError as e:
        if e.response['Error']['Code'] == 'ConditionalCheckFailedException':
            return False
        raise
    return True


def _is_member(entry, user_id):
    return any(m['userId'] == user_id for m in entry.get('joined', []))


def _start(table, sid, user_id, payload):
    game_id = str(payload.get('gameId') or '').strip()
    if not game_id:
        return _err('gameId is required')
    pk, sk = _queue_pk(sid), _game_sk(game_id)
    entry = _get(table, pk, sk)
    if not entry:
        return _err('That game is no longer in the queue.', 404)
    if not _is_member(entry, user_id):
        return _err('Only players in the lobby can start the game.', 403)
    if entry.get('status', 'lobby') != 'lobby':
        return _ok(entry=_public_entry(entry))          # already started — idempotent
    entry['status'] = 'active'
    entry['startedAt'] = _now_ts()
    if not _put_entry(table, entry):
        entry = _get(table, pk, sk)                      # lost the race; report current
    return _ok(entry=_public_entry(entry))


def _close_event_text(game_title, had_winner, winner_type, winner_names):
    if not had_winner:
        return f'"{game_title}" wrapped up at the table — everyone earned rolls.'
    if winner_type == 'group':
        return (f'"{game_title}" ended in a group victory — the whole table earned '
                f'rolls and spoils!')
    who = winner_names[0] if winner_names else 'The winner'
    return f'"{game_title}" ended — {who} won! Everyone earned rolls; {who} took the spoils.'


def _close(table, sid, user_id, payload):
    game_id = str(payload.get('gameId') or '').strip()
    if not game_id:
        return _err('gameId is required')
    pk, sk = _queue_pk(sid), _game_sk(game_id)
    entry = _get(table, pk, sk)
    if not entry:
        return _err('That game is no longer in the queue.', 404)
    if not _is_member(entry, user_id):
        return _err('Only players in the game can close it out.', 403)
    if entry.get('status', 'lobby') != 'active':
        return _err('Start the game before closing it out.', 409)

    roster = entry['joined']
    participant_ids = [m['userId'] for m in roster]
    names = {m['userId']: m['username'] for m in roster}

    had_winner = bool(payload.get('hadWinner'))
    winner_type = payload.get('winnerType')
    winner_ids = []
    if had_winner:
        if winner_type == 'group':
            winner_ids = list(participant_ids)
        elif winner_type == 'single':
            winner_id = payload.get('winnerId')
            if winner_id not in participant_ids:
                return _err('Winner must be one of the players in the game.', 400)
            winner_ids = [winner_id]
        else:
            return _err("winnerType must be 'single' or 'group'.", 400)

    # Claim the close by flipping to 'closed' under the ver guard. Whoever wins
    # this race owns the reward grant; a stale second close loses and no-ops.
    entry['status'] = 'closed'
    if not _put_entry(table, entry):
        return _ok(closed=True, alreadyClosed=True)

    summary = undercity_db.grant_board_game_rewards(
        table, sid, participant_ids, winner_ids, entry['gameTitle'])
    winner_names = [names.get(w, w) for w in winner_ids]
    undercity_db.post_event(table, sid, 'claim',
                            _close_event_text(entry['gameTitle'], had_winner,
                                              winner_type, winner_names))
    table.delete_item(Key={'pk': pk, 'sk': sk})
    return _ok(closed=True, granted=len(summary['granted']), banked=len(summary['banked']))
