"""End-to-end routing test: Function-URL event → lambda_handler → game module."""
import json
import sys
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parents[1]))

import lambda_function
from tests.test_undercity_db import FakeTable


def _event(method, path, body=None, query=None):
    return {
        'requestContext': {'http': {'method': method, 'path': path}},
        'body': json.dumps(body) if body is not None else '',
        'queryStringParameters': query or {},
    }


def _call(method, path, body=None, query=None):
    resp = lambda_function.lambda_handler(_event(method, path, body, query), None)
    return resp['statusCode'], json.loads(resp['body']) if resp['body'] else None


def test_game_endpoints_through_handler(monkeypatch):
    fake = FakeTable()
    monkeypatch.setattr(lambda_function, 'table', fake)

    status, body = _call('GET', '/game/state', query={'userId': 'user-alex'})
    assert status == 200
    assert body['season'] is None  # no night yet

    status, body = _call('POST', '/game/action',
                         body={'type': 'season-start', 'userId': 'host',
                               'username': 'Host', 'payload': {'hostKey': 'k'}})
    assert status == 200 and body['ok']

    status, body = _call('POST', '/game/action',
                         body={'type': 'join', 'userId': 'user-alex',
                               'username': 'Alex', 'payload': {'starter': 'spore'}})
    assert status == 200
    assert body['you']['species'] == 'spore'

    status, body = _call('GET', '/game/state', query={'userId': 'user-alex'})
    assert status == 200
    assert body['season']['status'] == 'active'
    assert body['you']['userId'] == 'user-alex'
    assert len(body['players']) == 1

    # Errors surface with proper status codes through the handler.
    status, body = _call('POST', '/game/action',
                         body={'type': 'move', 'userId': 'user-alex',
                               'username': 'Alex', 'payload': {'to': 'n1'}})
    assert status == 409

    status, body = _call('GET', '/game/nope')
    assert status == 404

    # OPTIONS preflight still handled globally.
    resp = lambda_function.lambda_handler(_event('OPTIONS', '/game/action'), None)
    assert resp['statusCode'] == 200
    assert resp['headers']['Access-Control-Allow-Origin'] == '*'
