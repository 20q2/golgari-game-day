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
    assert 'Alex wants to play Catan too' in calls[0]['data']  # message passed through verbatim
    assert '"gameId": "catan"' in calls[0]['data']


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
