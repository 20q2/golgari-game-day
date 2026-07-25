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
