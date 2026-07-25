"""Unit tests for the Web Push send wrapper — no network calls, webpush() is mocked."""
import json
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
