"""In-memory harness that drives the real Undercity action dispatcher.

`GameSim` wraps a FakeTable (a minimal boto3-Table stand-in, lifted from the
pytest suite) plus one player identity. Every decision the game asks for is
routed through `undercity_db.handle_action`, so the rules exercised here are the
shipped rules — nothing is re-implemented.

Reproducibility: `seed_all(seed)` seeds BOTH random sources the engine uses
(the module-level `db._rng` and the bare `random` module). Combat/telegraph RNG
flows through `db._rng`; a handful of movement/starter fallbacks use `random`.

Economy: by default we run with `data.DEBUG = True`, which makes rolling free
(no banked-roll cost, still a random 1-6 face). That deliberately removes the
roll-income constraint so the *core progression curve* is measured per turn,
independent of how many board games a player finishes on a given night. The
night-length / roll-economy overlay is applied analytically in report.py.
"""
import sys
import random
from contextlib import contextmanager
from pathlib import Path

# The sim package lives under infrastructure/lambda/sim; the engine modules sit
# one directory up. Put that on the path so `import undercity_db` resolves.
sys.path.insert(0, str(Path(__file__).resolve().parents[1]))

from botocore.exceptions import ClientError  # noqa: E402

import undercity_data as data   # noqa: E402
import undercity_db as db       # noqa: E402
import undercity_engine as engine  # noqa: E402


def _ddb_copy(obj, reject_float=False):
    """Deep-copy the way boto3's DynamoDB resource treats values: floats are
    unsupported (must be Decimal). Mirrors the pytest helper so the sim hits the
    same float-persistence guard the real table would."""
    if isinstance(obj, bool):
        return obj
    if isinstance(obj, float):
        if reject_float:
            raise TypeError('Float types are not supported. Use Decimal types instead.')
        return obj
    if isinstance(obj, dict):
        return {k: _ddb_copy(v, reject_float) for k, v in obj.items()}
    if isinstance(obj, list):
        return [_ddb_copy(v, reject_float) for v in obj]
    return obj


class FakeTable:
    """Minimal in-memory stand-in for a boto3 Table (the subset db.py uses).

    Copied from tests/test_undercity_db.py — kept in sync by the invariant
    checks in the sim's own smoke test."""

    def __init__(self):
        self.items = {}

    def _key(self, item_or_key):
        return (item_or_key['pk'], item_or_key['sk'])

    def put_item(self, Item, ConditionExpression=None, ExpressionAttributeValues=None):
        key = self._key(Item)
        if ConditionExpression == 'attribute_not_exists(pk)' and key in self.items:
            raise ClientError({'Error': {'Code': 'ConditionalCheckFailedException'}}, 'PutItem')
        if ConditionExpression == 'ver = :v':
            existing = self.items.get(key)
            if not existing or existing.get('ver') != ExpressionAttributeValues[':v']:
                raise ClientError({'Error': {'Code': 'ConditionalCheckFailedException'}}, 'PutItem')
        self.items[key] = _ddb_copy(Item, reject_float=True)
        return {}

    def get_item(self, Key):
        item = self.items.get(self._key(Key))
        return {'Item': _ddb_copy(item)} if item else {}

    def delete_item(self, Key):
        self.items.pop(self._key(Key), None)
        return {}

    def query(self, KeyConditionExpression, ExpressionAttributeValues,
              ScanIndexForward=True, Limit=None):
        pk = ExpressionAttributeValues[':pk']
        sk = ExpressionAttributeValues.get(':sk')
        out = []
        for (ipk, isk), item in self.items.items():
            if ipk != pk:
                continue
            if 'begins_with' in KeyConditionExpression and not isk.startswith(sk):
                continue
            if 'sk >= :sk' in KeyConditionExpression and not isk >= sk:
                continue
            out.append(item)
        out.sort(key=lambda i: i['sk'], reverse=not ScanIndexForward)
        if Limit:
            out = out[:Limit]
        return {'Items': _ddb_copy(out)}


def seed_all(seed):
    """Seed every RNG the engine reads from, for a reproducible playthrough."""
    random.seed(seed)
    db._rng.seed(seed)


@contextmanager
def debug_rolls(enabled=True):
    """Temporarily flip data.DEBUG (free rolls). Restores the prior value."""
    prev = data.DEBUG
    data.DEBUG = enabled
    try:
        yield
    finally:
        data.DEBUG = prev


class ActionError(Exception):
    """A non-200 action response, surfaced so the driver can react or log."""

    def __init__(self, atype, status, resp):
        self.atype = atype
        self.status = status
        self.resp = resp
        msg = resp.get('error') if isinstance(resp, dict) else resp
        super().__init__(f'{atype} -> {status}: {msg}')


class GameSim:
    """One season + one player, driven through the real dispatcher."""

    def __init__(self, user_id='sim-user', username='Sim', host_key='swampking'):
        self.table = FakeTable()
        self.user_id = user_id
        self.username = username
        status, resp = self.raw('season-start', hostKey=host_key)
        if status != 200:
            raise ActionError('season-start', status, resp)
        self.sid = db._active_season(self.table)[0]

    # ── raw plumbing ─────────────────────────────────────────────────────────
    def raw(self, atype, **payload):
        """Fire an action; return (status, resp) without raising."""
        return db.handle_action(self.table, {
            'type': atype, 'userId': self.user_id,
            'username': self.username, 'payload': payload})

    def act(self, atype, **payload):
        """Fire an action; raise ActionError on non-200. Returns resp dict."""
        status, resp = self.raw(atype, **payload)
        if status != 200:
            raise ActionError(atype, status, resp)
        return resp

    # ── state accessors ──────────────────────────────────────────────────────
    def doc(self):
        """The live player doc straight from the table (raw, incl. battle)."""
        return db._get_player(self.table, self.sid, self.user_id)

    def state(self):
        """Full GET /game/state view for this player."""
        return db.handle_state(self.table, {'userId': self.user_id})[1]

    def eff(self):
        """Effective stats (base + gear + buffs) for the current doc."""
        return engine.effective_stats(self.doc())
