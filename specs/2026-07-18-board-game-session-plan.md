# Board-Game Session & Close-Out Rewards — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add a session lifecycle to the game-night queue (lobby → active → closed) where any participant closes out a game, reporting the winner, and everyone at the table earns Undercity dice rolls (winners also get a bonus roll + a random item), banked for players who haven't hatched a creature yet.

**Architecture:** Queue entries gain `status`/`ver` fields and two new actions (`start`, `close`) in `queue_db.py`. All player-doc mutation and reward banking live in `undercity_db.py`, exposed as three public functions (`grant_board_game_rewards`, `apply_banked_rewards`, `post_event`) that `queue_db` calls — no circular import (`queue_db` already imports `undercity_db`). Reward amounts reuse the existing self-claim constants (`CLAIM_FINISHED_ROLLS=2`, `CLAIM_WON_BONUS_ROLLS=1`). Frontend adds session states to the queue card and a small close-out dialog.

**Tech Stack:** Python 3.11 Lambda + boto3, in-memory `FakeTable` pytest suite, Angular 20 standalone components + signals + Angular Material dialog.

---

## Backend

### Task 1: Undercity reward grant, bank, and event helpers

**Files:**
- Modify: `infrastructure/lambda/undercity_db.py` (add helpers after `_save_or_conflict`, line ~747)
- Test: `infrastructure/lambda/tests/test_undercity_db.py`

- [ ] **Step 1: Write the failing tests**

Add to the bottom of `infrastructure/lambda/tests/test_undercity_db.py`:

```python
def test_grant_board_game_rewards_applies_rolls_and_item(monkeypatch):
    t = FakeTable()
    act(t, 'season-start', hostKey='swampking')
    act(t, 'join', user='user-alex', name='Alex', starter='pest')
    act(t, 'join', user='user-sam', name='Sam', starter='pest')
    # Zero out banked rolls so the +2 / +3 grants are deterministic.
    for uid in ('user-alex', 'user-sam'):
        d = db._get_player(t, _sid(t), uid)
        d['rolls'] = 0
        db._put_player(t, d)

    summary = db.grant_board_game_rewards(
        t, _sid(t), ['user-alex', 'user-sam'], ['user-sam'])

    assert set(summary['granted']) == {'user-alex', 'user-sam'}
    assert summary['banked'] == []
    alex = db._get_player(t, _sid(t), 'user-alex')
    sam = db._get_player(t, _sid(t), 'user-sam')
    assert alex['rolls'] == data.CLAIM_FINISHED_ROLLS            # participation only
    assert sam['rolls'] == data.CLAIM_FINISHED_ROLLS + data.CLAIM_WON_BONUS_ROLLS
    assert len(sam['bag']) == 1                                  # winner got an item
    assert alex['bag'] == []


def test_grant_board_game_rewards_banks_for_absent_player():
    t = FakeTable()
    act(t, 'season-start', hostKey='swampking')
    # user-ghost never joined Undercity this night.
    summary = db.grant_board_game_rewards(t, _sid(t), ['user-ghost'], ['user-ghost'])
    assert summary['granted'] == []
    assert summary['banked'] == ['user-ghost']

    rec = db._get(t, db._reward_pk(_sid(t)), 'USER#user-ghost')
    assert rec['rolls'] == data.CLAIM_FINISHED_ROLLS + data.CLAIM_WON_BONUS_ROLLS
    assert len(rec['items']) == 1


def test_bank_merges_on_repeat():
    t = FakeTable()
    act(t, 'season-start', hostKey='swampking')
    db.grant_board_game_rewards(t, _sid(t), ['user-ghost'], [])            # participation
    db.grant_board_game_rewards(t, _sid(t), ['user-ghost'], ['user-ghost'])  # winner
    rec = db._get(t, db._reward_pk(_sid(t)), 'USER#user-ghost')
    assert rec['rolls'] == data.CLAIM_FINISHED_ROLLS * 2 + data.CLAIM_WON_BONUS_ROLLS
    assert len(rec['items']) == 1


def test_post_event_writes_to_feed():
    t = FakeTable()
    act(t, 'season-start', hostKey='swampking')
    db.post_event(t, _sid(t), 'claim', 'Catan wrapped up at the table.')
    _, state = db.handle_state(t, {'userId': 'user-alex'})
    assert any(e['text'] == 'Catan wrapped up at the table.' for e in state['events'])
```

Note: `_sid` is an existing helper in this test file (returns the active season id); `act(..., user=, name=)` is the existing action helper.

- [ ] **Step 2: Run the tests to verify they fail**

Run: `cd infrastructure/lambda && python -m pytest tests/test_undercity_db.py -k "grant_board_game or bank_merges or post_event" -v`
Expected: FAIL with `AttributeError: module 'undercity_db' has no attribute 'grant_board_game_rewards'`

- [ ] **Step 3: Implement the helpers**

In `infrastructure/lambda/undercity_db.py`, immediately after `_save_or_conflict` (ends line ~747), add:

```python
# ── Board-game session rewards (called by queue_db) ──────────────────────────

def _reward_pk(sid):
    return f'QUEUEREWARD#{sid}'


def _reward_sk(user_id):
    return f'USER#{user_id}'


def _grant_to_player(table, sid, user_id, is_winner):
    """Apply a board-game reward to a live player doc, retrying on the optimistic
    version guard (the player might be mid-action). Best-effort: returns True if
    applied, False if the doc vanished or every retry lost the race."""
    for _ in range(4):
        doc = _get_player(table, sid, user_id)
        if not doc:
            return False
        _add_rolls(doc, data.CLAIM_FINISHED_ROLLS)
        if is_winner:
            _add_rolls(doc, data.CLAIM_WON_BONUS_ROLLS)
            _give_consumable(doc)
        if _put_player(table, doc):
            return True
    return False


def _bank_reward(table, sid, user_id, is_winner):
    """Store a reward for a user who has no creature yet; merged on repeats."""
    rec = _get(table, _reward_pk(sid), _reward_sk(user_id)) or {
        'pk': _reward_pk(sid), 'sk': _reward_sk(user_id),
        'userId': user_id, 'rolls': 0, 'items': [],
    }
    rec['rolls'] = rec.get('rolls', 0) + data.CLAIM_FINISHED_ROLLS + (
        data.CLAIM_WON_BONUS_ROLLS if is_winner else 0)
    if is_winner:
        rec.setdefault('items', []).append(_rng.choice(list(data.CONSUMABLES.keys())))
    table.put_item(Item=rec)


def grant_board_game_rewards(table, sid, participant_ids, winner_ids):
    """Public entry point for queue_db. Grants participation rolls to every
    participant and a bonus roll + item to each winner; banks the reward for
    anyone who hasn't hatched a creature this night. Returns a summary."""
    winners = set(winner_ids)
    granted, banked = [], []
    for uid in participant_ids:
        is_winner = uid in winners
        if _grant_to_player(table, sid, uid, is_winner):
            granted.append(uid)
        else:
            _bank_reward(table, sid, uid, is_winner)
            banked.append(uid)
    return {'granted': granted, 'banked': banked}


def apply_banked_rewards(table, sid, user_id, doc):
    """Apply any banked board-game rewards onto a freshly hatched doc (mutates
    it in place), then delete the bank record and announce it. No-op if none."""
    rec = _get(table, _reward_pk(sid), _reward_sk(user_id))
    if not rec:
        return
    rolls = int(rec.get('rolls', 0))
    if rolls:
        _add_rolls(doc, rolls)
    items = rec.get('items') or []
    for item in items:
        if len(doc.get('bag') or []) >= data.BAG_SIZE:
            doc['spores'] = doc.get('spores', 0) + 5
        else:
            doc.setdefault('bag', []).append(item)
    table.delete_item(Key={'pk': _reward_pk(sid), 'sk': _reward_sk(user_id)})
    extra = f", {len(items)} item(s)" if items else ''
    _event(table, sid, 'claim',
           f"{doc['username']} collected banked rewards from tonight's games "
           f"(+{rolls} rolls{extra})", actor=user_id)


def post_event(table, sid, etype, text):
    """Public wrapper so queue_db can post to the Grapevine feed."""
    _event(table, sid, etype, text)
```

- [ ] **Step 4: Run the tests to verify they pass**

Run: `cd infrastructure/lambda && python -m pytest tests/test_undercity_db.py -k "grant_board_game or bank_merges or post_event" -v`
Expected: PASS (4 tests)

- [ ] **Step 5: Commit**

```bash
git add infrastructure/lambda/undercity_db.py infrastructure/lambda/tests/test_undercity_db.py
git commit -m "feat(undercity): board-game reward grant/bank/event helpers for queue sessions"
```

---

### Task 2: Apply banked rewards when a player hatches

**Files:**
- Modify: `infrastructure/lambda/undercity_db.py` — `_join` (line ~1039)
- Test: `infrastructure/lambda/tests/test_undercity_db.py`

- [ ] **Step 1: Write the failing test**

Add to `infrastructure/lambda/tests/test_undercity_db.py`:

```python
def test_banked_rewards_applied_on_join():
    t = FakeTable()
    act(t, 'season-start', hostKey='swampking')
    # Bank a winner reward for someone who hasn't hatched.
    db.grant_board_game_rewards(t, _sid(t), ['user-late'], ['user-late'])
    assert db._get(t, db._reward_pk(_sid(t)), 'USER#user-late') is not None

    status, resp = act(t, 'join', user='user-late', name='Late', starter='pest')
    assert status == 200
    you = resp['you']
    # JOIN_ROLLS=3 + banked (2 participation + 1 winner) = 6, capped at ROLL_CAP=6.
    assert you['rolls'] == min(data.ROLL_CAP,
                               data.JOIN_ROLLS + data.CLAIM_FINISHED_ROLLS + data.CLAIM_WON_BONUS_ROLLS)
    assert len(you['bag']) == 1                       # banked item delivered
    # Bank record consumed.
    assert db._get(t, db._reward_pk(_sid(t)), 'USER#user-late') is None
```

- [ ] **Step 2: Run the test to verify it fails**

Run: `cd infrastructure/lambda && python -m pytest tests/test_undercity_db.py::test_banked_rewards_applied_on_join -v`
Expected: FAIL — the joined creature has `bag == []` and only `JOIN_ROLLS` rolls (banked reward not applied).

- [ ] **Step 3: Hook the apply into `_join`**

In `infrastructure/lambda/undercity_db.py`, in `_join`, locate the block that builds `doc` and saves it (lines ~1057-1065):

```python
    s = data.STARTERS[starter]
    doc = _new_player_doc(
        sid, user_id, username, starter, home,
        seals_before=seals_before, egg_hue=payload.get('eggHue'),
        creature_name=creature_name,
    )
    conflict = _save_or_conflict(table, doc)
    if conflict:
        return conflict
```

Insert the `apply_banked_rewards` call between building `doc` and saving it:

```python
    s = data.STARTERS[starter]
    doc = _new_player_doc(
        sid, user_id, username, starter, home,
        seals_before=seals_before, egg_hue=payload.get('eggHue'),
        creature_name=creature_name,
    )
    # Deliver any board-game rewards banked while this player hadn't hatched yet
    # (mutates doc's rolls/bag, deletes the bank record, posts an event).
    apply_banked_rewards(table, sid, user_id, doc)
    conflict = _save_or_conflict(table, doc)
    if conflict:
        return conflict
```

- [ ] **Step 4: Run the test to verify it passes**

Run: `cd infrastructure/lambda && python -m pytest tests/test_undercity_db.py::test_banked_rewards_applied_on_join -v`
Expected: PASS

- [ ] **Step 5: Run the full undercity suite (guard against regressions)**

Run: `cd infrastructure/lambda && python -m pytest tests/test_undercity_db.py -q`
Expected: PASS (all)

- [ ] **Step 6: Commit**

```bash
git add infrastructure/lambda/undercity_db.py infrastructure/lambda/tests/test_undercity_db.py
git commit -m "feat(undercity): deliver banked board-game rewards when a creature hatches"
```

---

### Task 3: Queue entry status/ver + start action

**Files:**
- Modify: `infrastructure/lambda/queue_db.py`
- Test: `infrastructure/lambda/tests/test_queue_db.py`

- [ ] **Step 1: Write the failing tests**

Append to `infrastructure/lambda/tests/test_queue_db.py`:

```python
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
```

- [ ] **Step 2: Run the tests to verify they fail**

Run: `cd infrastructure/lambda && python -m pytest tests/test_queue_db.py -k "lobby_status or start_flips or start_requires or rejected_once_active or start_unknown" -v`
Expected: FAIL — `status` key missing / `Unknown action: start`.

- [ ] **Step 3: Add status/ver, the optimistic entry write, membership helper, and the start action**

In `infrastructure/lambda/queue_db.py`:

(a) Add the botocore import under the existing imports (after `import undercity_db`, line ~16):

```python
import undercity_db

from botocore.exceptions import ClientError
```

(b) Replace `_public_entry` (lines ~49-57) to expose `status`:

```python
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
```

(c) In `handle_state` (lines ~60-69), skip transient `closed` rows:

```python
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
```

(d) In `handle_action` (lines ~88-92), reject mutations on active entries and route the new actions:

```python
    if atype in ('add', 'join'):
        return _join(table, sid, user_id, username, payload)
    if atype == 'leave':
        return _leave(table, sid, user_id, payload)
    if atype == 'start':
        return _start(table, sid, user_id, payload)
    if atype == 'close':
        return _close(table, sid, user_id, payload)
    return _err(f'Unknown action: {atype}')
```

(e) In `_join` (lines ~95-120), set the new fields on creation and reject joining an active session. Replace the function body:

```python
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
```

(f) In `_leave` (lines ~147-163), reject leaving an active session — add the guard right after the `if not entry` check:

```python
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
```

(g) Add the optimistic entry write, a membership helper, and `_start` just before the push helpers (before `_pushsub_pk`, line ~166):

```python
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
```

- [ ] **Step 4: Run the tests to verify they pass**

Run: `cd infrastructure/lambda && python -m pytest tests/test_queue_db.py -k "lobby_status or start_flips or start_requires or rejected_once_active or start_unknown" -v`
Expected: PASS (5 tests). Also run the whole queue file to confirm the earlier tests still pass:
Run: `cd infrastructure/lambda && python -m pytest tests/test_queue_db.py -q`
Expected: PASS (all)

- [ ] **Step 5: Commit**

```bash
git add infrastructure/lambda/queue_db.py infrastructure/lambda/tests/test_queue_db.py
git commit -m "feat(queue): session status + start action (roster locks on start)"
```

---

### Task 4: Close-out action (grant rewards, announce, delete)

**Files:**
- Modify: `infrastructure/lambda/queue_db.py`
- Test: `infrastructure/lambda/tests/test_queue_db.py`

- [ ] **Step 1: Write the failing tests**

Append to `infrastructure/lambda/tests/test_queue_db.py` (add `import undercity_db as ucdb` at the top of the file if not present):

```python
def _start_active_game(t, members):
    """Season already started. members = [(uid, name), ...]; first is the host."""
    for i, (uid, name) in enumerate(members):
        payload = {'gameId': 'catan'}
        if i == 0:
            payload['gameTitle'] = 'Catan'
        q.handle_action(t, {'type': 'join', 'userId': uid, 'username': name, 'payload': payload})
    q.handle_action(t, {'type': 'start', 'userId': members[0][0], 'username': members[0][1],
                         'payload': {'gameId': 'catan'}})


def test_close_no_winner_grants_participation_and_deletes(monkeypatch):
    import undercity_db as ucdb
    t = FakeTable()
    start_night(t)
    ucdb.handle_action(t, {'type': 'join', 'userId': 'user-alex', 'username': 'Alex',
                            'payload': {'starter': 'pest'}})
    ucdb.handle_action(t, {'type': 'join', 'userId': 'user-sam', 'username': 'Sam',
                            'payload': {'starter': 'pest'}})
    _start_active_game(t, [('user-alex', 'Alex'), ('user-sam', 'Sam')])

    status, body = q.handle_action(t, {'type': 'close', 'userId': 'user-alex', 'username': 'Alex',
                                        'payload': {'gameId': 'catan', 'hadWinner': False}})
    assert status == 200 and body['closed'] is True

    # Entry gone from state.
    _, state = q.handle_state(t, {})
    assert state['entries'] == []
    # Everyone got participation rolls, nobody got an item.
    for uid in ('user-alex', 'user-sam'):
        d = ucdb._get_player(t, _sid(t), uid)
        assert d['bag'] == []


def test_close_single_winner_gives_item(monkeypatch):
    import undercity_db as ucdb
    t = FakeTable()
    start_night(t)
    ucdb.handle_action(t, {'type': 'join', 'userId': 'user-alex', 'username': 'Alex',
                            'payload': {'starter': 'pest'}})
    ucdb.handle_action(t, {'type': 'join', 'userId': 'user-sam', 'username': 'Sam',
                            'payload': {'starter': 'pest'}})
    _start_active_game(t, [('user-alex', 'Alex'), ('user-sam', 'Sam')])

    status, body = q.handle_action(t, {'type': 'close', 'userId': 'user-alex', 'username': 'Alex',
                                        'payload': {'gameId': 'catan', 'hadWinner': True,
                                                    'winnerType': 'single', 'winnerId': 'user-sam'}})
    assert status == 200
    assert len(ucdb._get_player(t, _sid(t), 'user-sam')['bag']) == 1     # winner
    assert ucdb._get_player(t, _sid(t), 'user-alex')['bag'] == []        # not the winner


def test_close_group_victory_gives_everyone_item(monkeypatch):
    import undercity_db as ucdb
    t = FakeTable()
    start_night(t)
    ucdb.handle_action(t, {'type': 'join', 'userId': 'user-alex', 'username': 'Alex',
                            'payload': {'starter': 'pest'}})
    ucdb.handle_action(t, {'type': 'join', 'userId': 'user-sam', 'username': 'Sam',
                            'payload': {'starter': 'pest'}})
    _start_active_game(t, [('user-alex', 'Alex'), ('user-sam', 'Sam')])

    q.handle_action(t, {'type': 'close', 'userId': 'user-alex', 'username': 'Alex',
                         'payload': {'gameId': 'catan', 'hadWinner': True, 'winnerType': 'group'}})
    for uid in ('user-alex', 'user-sam'):
        assert len(ucdb._get_player(t, _sid(t), uid)['bag']) == 1


def test_close_banks_for_non_undercity_participant(monkeypatch):
    import undercity_db as ucdb
    t = FakeTable()
    start_night(t)
    ucdb.handle_action(t, {'type': 'join', 'userId': 'user-alex', 'username': 'Alex',
                            'payload': {'starter': 'pest'}})
    # user-ghost is in the board-game lobby but never hatched a creature.
    _start_active_game(t, [('user-alex', 'Alex'), ('user-ghost', 'Ghost')])

    q.handle_action(t, {'type': 'close', 'userId': 'user-alex', 'username': 'Alex',
                         'payload': {'gameId': 'catan', 'hadWinner': True,
                                     'winnerType': 'single', 'winnerId': 'user-ghost'}})
    rec = ucdb._get(t, ucdb._reward_pk(_sid(t)), 'USER#user-ghost')
    assert rec is not None and len(rec['items']) == 1


def test_close_on_lobby_is_409():
    t = FakeTable()
    start_night(t)
    q.handle_action(t, {'type': 'join', 'userId': 'user-alex', 'username': 'Alex',
                         'payload': {'gameId': 'catan', 'gameTitle': 'Catan'}})
    status, body = q.handle_action(t, {'type': 'close', 'userId': 'user-alex', 'username': 'Alex',
                                        'payload': {'gameId': 'catan', 'hadWinner': False}})
    assert status == 409


def test_close_bad_winner_id_is_400():
    t = FakeTable()
    start_night(t)
    q.handle_action(t, {'type': 'join', 'userId': 'user-alex', 'username': 'Alex',
                         'payload': {'gameId': 'catan', 'gameTitle': 'Catan'}})
    q.handle_action(t, {'type': 'start', 'userId': 'user-alex', 'username': 'Alex',
                         'payload': {'gameId': 'catan'}})
    status, body = q.handle_action(t, {'type': 'close', 'userId': 'user-alex', 'username': 'Alex',
                                        'payload': {'gameId': 'catan', 'hadWinner': True,
                                                    'winnerType': 'single', 'winnerId': 'nobody'}})
    assert status == 400


def test_second_close_is_404_and_no_double_grant():
    import undercity_db as ucdb
    t = FakeTable()
    start_night(t)
    ucdb.handle_action(t, {'type': 'join', 'userId': 'user-alex', 'username': 'Alex',
                            'payload': {'starter': 'pest'}})
    d = ucdb._get_player(t, _sid(t), 'user-alex'); d['rolls'] = 0; ucdb._put_player(t, d)
    _start_active_game(t, [('user-alex', 'Alex')])

    status, _ = q.handle_action(t, {'type': 'close', 'userId': 'user-alex', 'username': 'Alex',
                                     'payload': {'gameId': 'catan', 'hadWinner': False}})
    assert status == 200
    rolls_after = ucdb._get_player(t, _sid(t), 'user-alex')['rolls']
    assert rolls_after == ucdb.data.CLAIM_FINISHED_ROLLS

    # Close-out deletes the entry, so a second close finds nothing → 404 and no
    # further grant. (Truly-concurrent closers are serialized by the `ver` guard
    # in _put_entry: the loser gets `alreadyClosed` without granting.)
    status, _ = q.handle_action(t, {'type': 'close', 'userId': 'user-alex', 'username': 'Alex',
                                     'payload': {'gameId': 'catan', 'hadWinner': False}})
    assert status == 404
    assert ucdb._get_player(t, _sid(t), 'user-alex')['rolls'] == rolls_after
```

- [ ] **Step 2: Run the tests to verify they fail**

Run: `cd infrastructure/lambda && python -m pytest tests/test_queue_db.py -k "close_" -v`
Expected: FAIL — `Unknown action: close`.

- [ ] **Step 3: Implement `_close`**

In `infrastructure/lambda/queue_db.py`, add `_close` and a small event-text helper right after `_start`:

```python
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

    summary = undercity_db.grant_board_game_rewards(table, sid, participant_ids, winner_ids)
    winner_names = [names.get(w, w) for w in winner_ids]
    undercity_db.post_event(table, sid, 'claim',
                            _close_event_text(entry['gameTitle'], had_winner,
                                              winner_type, winner_names))
    table.delete_item(Key={'pk': pk, 'sk': sk})
    return _ok(closed=True, granted=len(summary['granted']), banked=len(summary['banked']))
```

- [ ] **Step 4: Run the tests to verify they pass**

Run: `cd infrastructure/lambda && python -m pytest tests/test_queue_db.py -k "close_" -v`
Expected: PASS (7 tests)

- [ ] **Step 5: Run the whole backend suite**

Run: `cd infrastructure/lambda && python -m pytest tests -q`
Expected: PASS (all)

- [ ] **Step 6: Commit**

```bash
git add infrastructure/lambda/queue_db.py infrastructure/lambda/tests/test_queue_db.py
git commit -m "feat(queue): close-out action grants rewards, announces, and clears the entry"
```

---

## Frontend

### Task 5: Queue models + service methods for start/close

**Files:**
- Modify: `src/app/services/queue-models.ts`
- Modify: `src/app/services/queue-api.service.ts`
- Modify: `src/app/services/queue.service.ts`

- [ ] **Step 1: Add `status` and the close-result types**

In `src/app/services/queue-models.ts`, add `status` to `QueueEntry` and a result type. Replace the file:

```typescript
export interface QueueMember {
  userId: string;
  username: string;
}

export type QueueStatus = 'lobby' | 'active';

export interface QueueEntry {
  gameId: string;
  gameTitle: string;
  addedBy: string;
  addedByName: string;
  addedAt: number;
  status: QueueStatus;
  joined: QueueMember[];
}

export interface QueueState {
  seasonId: string | null;
  entries: QueueEntry[];
}

export interface QueueActionResponse {
  ok: boolean;
  entry?: QueueEntry | null;
  closed?: boolean;
  granted?: number;
  banked?: number;
}

/** Result the close-out dialog returns. */
export interface CloseResult {
  hadWinner: boolean;
  winnerType?: 'single' | 'group';
  winnerId?: string;
}
```

- [ ] **Step 2: Add `start`/`close` to the API service**

In `src/app/services/queue-api.service.ts`, add two methods after `leave` (line ~41), and import `CloseResult`:

Change the import line at the top from:
```typescript
import { QueueActionResponse, QueueState } from './queue-models';
```
to:
```typescript
import { CloseResult, QueueActionResponse, QueueState } from './queue-models';
```

Then add after the `leave` method:
```typescript
  start(gameId: string): Promise<QueueActionResponse> {
    return this.action('start', { gameId });
  }

  close(gameId: string, result: CloseResult): Promise<QueueActionResponse> {
    return this.action('close', { gameId, ...result });
  }
```

- [ ] **Step 3: Add `start`/`close`/`statusOf` and a reward banner to the store**

In `src/app/services/queue.service.ts`:

Change the models import to include `CloseResult` and `QueueStatus`:
```typescript
import { CloseResult, QueueEntry, QueueState } from './queue-models';
```

Add a reward-message signal next to the other private signals (after `_error`, line ~21):
```typescript
  private readonly _reward = signal<string | null>(null);
```
and expose it after `readonly error` (line ~26):
```typescript
  readonly reward = this._reward.asReadonly();
```

Because `QueueActionResponse.entry` is now optional (`QueueEntry | null | undefined`),
update the two existing callers so they never pass `undefined` to `applyEntry`.
In `join` change `this.applyEntry(gameId, resp.entry);` to:
```typescript
      this.applyEntry(gameId, resp.entry ?? null);
```
and make the identical change in `leave`.

Add these methods after `leave` (line ~98):
```typescript
  statusOf(gameId: string): 'lobby' | 'active' {
    return this.entryFor(gameId)?.status ?? 'lobby';
  }

  async start(gameId: string): Promise<void> {
    try {
      const resp = await this.api.start(gameId);
      this.applyEntry(gameId, resp.entry ?? null);
      this._error.set(null);
    } catch (e) {
      this._error.set(e instanceof Error ? e.message : 'Could not start the game.');
      throw e;
    }
  }

  async close(gameId: string, result: CloseResult): Promise<void> {
    try {
      const resp = await this.api.close(gameId, result);
      this.applyEntry(gameId, null); // entry is deleted server-side on close
      const banked = resp.banked ? ` (${resp.banked} banked)` : '';
      this._reward.set(`Everyone earned rolls 🎲${result.hadWinner ? ' — winner grabbed an item!' : ''}${banked}`);
      this._error.set(null);
      setTimeout(() => this._reward.set(null), 6000);
    } catch (e) {
      this._error.set(e instanceof Error ? e.message : 'Could not close out the game.');
      throw e;
    }
  }
```

- [ ] **Step 4: Verify the project builds**

Run: `npm run build`
Expected: Build succeeds (only the pre-existing `GamesHeroComponent`/unused-file warnings).

- [ ] **Step 5: Commit**

```bash
git add src/app/services/queue-models.ts src/app/services/queue-api.service.ts src/app/services/queue.service.ts
git commit -m "feat(queue): client start/close actions, status, and reward banner state"
```

---

### Task 6: Close-out dialog component

**Files:**
- Create: `src/app/games/queue-panel/close-out-dialog.component.ts`

- [ ] **Step 1: Implement the dialog**

Create `src/app/games/queue-panel/close-out-dialog.component.ts` (single-file component with inline template/styles, following the `SignInDialogComponent` MatDialog pattern):

```typescript
import { Component, Inject } from '@angular/core';
import { CommonModule } from '@angular/common';
import { MatButtonModule } from '@angular/material/button';
import { MAT_DIALOG_DATA, MatDialogModule, MatDialogRef } from '@angular/material/dialog';
import { QueueMember, CloseResult } from '../../services/queue-models';

export interface CloseOutData {
  gameTitle: string;
  roster: QueueMember[];
}

@Component({
  selector: 'app-close-out-dialog',
  standalone: true,
  imports: [CommonModule, MatButtonModule, MatDialogModule],
  template: `
    <h2 class="title">Close out {{ data.gameTitle }}</h2>

    <ng-container *ngIf="step === 'winner?'">
      <p class="q">Did the game have a winner?</p>
      <div class="row">
        <button mat-stroked-button (click)="chooseHadWinner(true)">Yes</button>
        <button mat-stroked-button (click)="chooseHadWinner(false)">No</button>
      </div>
    </ng-container>

    <ng-container *ngIf="step === 'who?'">
      <p class="q">Who won?</p>
      <div class="mode">
        <button mat-stroked-button [class.sel]="mode === 'single'" (click)="mode = 'single'">Single winner</button>
        <button mat-stroked-button [class.sel]="mode === 'group'" (click)="mode = 'group'">Group victory (coop)</button>
      </div>
      <ul class="players" *ngIf="mode === 'single'">
        <li *ngFor="let m of data.roster">
          <button mat-stroked-button [class.sel]="winnerId === m.userId" (click)="winnerId = m.userId">
            {{ m.username || m.userId }}
          </button>
        </li>
      </ul>
      <div class="row end">
        <button mat-button (click)="step = 'winner?'">Back</button>
        <button mat-flat-button color="primary" [disabled]="!canConfirm()" (click)="confirm()">Confirm</button>
      </div>
    </ng-container>
  `,
  styles: [`
    .title { font-size: 18px; margin: 0 0 8px; }
    .q { font-weight: 600; margin: 12px 0 8px; }
    .row { display: flex; gap: 10px; }
    .row.end { justify-content: flex-end; margin-top: 16px; }
    .mode { display: flex; gap: 8px; flex-wrap: wrap; }
    .players { list-style: none; padding: 0; margin: 10px 0 0; display: flex; flex-direction: column; gap: 6px; }
    .sel { background: var(--accent-color); color: #fff; }
  `],
})
export class CloseOutDialogComponent {
  step: 'winner?' | 'who?' = 'winner?';
  mode: 'single' | 'group' = 'single';
  winnerId: string | null = null;

  constructor(
    private dialogRef: MatDialogRef<CloseOutDialogComponent, CloseResult | null>,
    @Inject(MAT_DIALOG_DATA) public data: CloseOutData,
  ) {}

  chooseHadWinner(had: boolean): void {
    if (!had) {
      this.dialogRef.close({ hadWinner: false });
      return;
    }
    this.step = 'who?';
  }

  canConfirm(): boolean {
    return this.mode === 'group' || this.winnerId !== null;
  }

  confirm(): void {
    if (this.mode === 'group') {
      this.dialogRef.close({ hadWinner: true, winnerType: 'group' });
    } else if (this.winnerId) {
      this.dialogRef.close({ hadWinner: true, winnerType: 'single', winnerId: this.winnerId });
    }
  }
}
```

- [ ] **Step 2: Verify the project builds**

Run: `npm run build`
Expected: Build succeeds (component compiles; not yet referenced).

- [ ] **Step 3: Commit**

```bash
git add src/app/games/queue-panel/close-out-dialog.component.ts
git commit -m "feat(queue): close-out dialog (winner? -> who won?) flow"
```

---

### Task 7: Wire Start / Close out into the queue card

**Files:**
- Modify: `src/app/games/queue-panel/queue-panel.component.ts`
- Modify: `src/app/games/queue-panel/queue-panel.component.html`
- Modify: `src/app/games/queue-panel/queue-panel.component.scss`

- [ ] **Step 1: Add dialog wiring + start/close handlers to the component**

In `src/app/games/queue-panel/queue-panel.component.ts`, add the imports (top of file):

```typescript
import { MatDialog } from '@angular/material/dialog';
import { CloseOutDialogComponent, CloseOutData } from './close-out-dialog.component';
import { CloseResult } from '../../services/queue-models';
```

Inject `MatDialog` alongside the existing injects (after `gamesService`, line ~30):

```typescript
  private readonly dialog = inject(MatDialog);
```

Add these methods after `toggle` (the existing join/leave handler):

```typescript
  isActive(gameId: string): boolean {
    return this.queue.statusOf(gameId) === 'active';
  }

  async start(gameId: string): Promise<void> {
    if (!(await this.userService.requireSignIn())) return;
    await this.queue.start(gameId);
  }

  async closeOut(entryGameId: string, gameTitle: string): Promise<void> {
    if (!(await this.userService.requireSignIn())) return;
    const entry = this.queue.entryFor(entryGameId);
    if (!entry) return;
    const data: CloseOutData = { gameTitle, roster: entry.joined };
    const result: CloseResult | null | undefined = await this.dialog
      .open(CloseOutDialogComponent, { data, width: '320px' })
      .afterClosed()
      .toPromise();
    if (result) {
      await this.queue.close(entryGameId, result);
    }
  }
```

- [ ] **Step 2: Add the Start / Close buttons and reward banner to the template**

In `src/app/games/queue-panel/queue-panel.component.html`, replace the single Join/Leave button block (the `<button ... class="queue-join-btn">...</button>` inside `.queue-card-body`) with status-aware controls:

```html
        <ng-container *ngIf="!isActive(entry.gameId); else activeControls">
          <button
            type="button"
            class="queue-join-btn"
            [class.joined]="queue.isJoined(entry.gameId)"
            (click)="toggle(entry.gameId, entry.gameTitle)"
          >
            {{ queue.isJoined(entry.gameId) ? 'Leave' : 'Join' }}
          </button>
          <button
            type="button"
            class="queue-start-btn"
            *ngIf="queue.isJoined(entry.gameId)"
            (click)="start(entry.gameId)"
          >
            Start playing
          </button>
        </ng-container>

        <ng-template #activeControls>
          <span class="in-progress"><mat-icon class="ip-icon">sports_esports</mat-icon> In progress</span>
          <button
            type="button"
            class="queue-close-btn"
            *ngIf="queue.isJoined(entry.gameId)"
            (click)="closeOut(entry.gameId, entry.gameTitle)"
          >
            Close out
          </button>
        </ng-template>
```

Then add a reward banner just below the header (after the `.queue-panel-header` div, before `<ul class="queue-cards">`):

```html
  <p class="reward-banner" *ngIf="queue.reward() as msg">{{ msg }}</p>
```

- [ ] **Step 3: Style the new controls**

In `src/app/games/queue-panel/queue-panel.component.scss`, add before the closing of the file:

```scss
.reward-banner {
  margin: 0 0 10px;
  padding: 6px 10px;
  border-radius: 8px;
  background: var(--accent-color);
  color: #fff;
  font-size: 12px;
  font-weight: 600;
  text-align: center;
}

.queue-start-btn,
.queue-close-btn {
  width: 100%;
  margin-top: 6px;
  border-radius: 999px;
  padding: 5px 12px;
  font-size: 12px;
  font-weight: 700;
  cursor: pointer;
  border: 1px solid var(--accent-color);
  background: var(--accent-color);
  color: #fff;
}

.queue-close-btn {
  background: #c0392b;
  border-color: #c0392b;
}

.in-progress {
  display: inline-flex;
  align-items: center;
  gap: 4px;
  font-size: 11px;
  font-weight: 700;
  color: var(--accent-color);

  .ip-icon {
    font-size: 14px;
    width: 14px;
    height: 14px;
  }
}
```

- [ ] **Step 4: Verify the project builds**

Run: `npm run build`
Expected: Build succeeds.

- [ ] **Step 5: Commit**

```bash
git add src/app/games/queue-panel/
git commit -m "feat(queue): Start playing + Close out controls and reward banner on cards"
```

---

### Task 8: End-to-end verification

**Files:** none (verification only)

- [ ] **Step 1: Run the full backend suite**

Run: `cd infrastructure/lambda && python -m pytest tests -q`
Expected: All pass (existing + new session/reward tests).

- [ ] **Step 2: Build the frontend**

Run: `npm run build`
Expected: Succeeds with only the pre-existing warnings.

- [ ] **Step 3: Manual walkthrough** (requires the backend redeployed and an Undercity night started)

Run `npm start`, then in two browser profiles (two anonymous identities):
1. Both sign in; both go to `/undercity` and hatch a creature this night; note each one's roll count.
2. On `/home`, both Join the same game's lobby; one taps **Start playing** — the card flips to **In progress** for both after a poll.
3. One taps **Close out** → dialog: "Did the game have a winner?" → **Yes** → **Single winner** → pick the other player → **Confirm**.
4. The reward banner shows; the card disappears on the next poll.
5. Back in `/undercity`, confirm **both** players' roll counts rose (+2 each, capped at 6) and the **winner** has a new bag item; check the Grapevine feed for the close-out message.
6. Repeat with **Group victory (coop)** and confirm both players get an item; and with **No** winner and confirm rolls-only.
7. Bank path: have a third identity Join + get included in a close-out **before** hatching a creature; then hatch on `/undercity` and confirm the banked rolls/item arrive with a "collected banked rewards" event.

- [ ] **Step 4: Report results; do not deploy**

Summarize pass/fail per sub-step. Per project convention, do not run `cdk deploy` / `npm run deploy` — note that a backend redeploy is required for the new actions to work live.
```
