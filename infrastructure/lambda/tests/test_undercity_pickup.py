import undercity_db as db

from tests.test_undercity_db import (  # noqa: F401
    table, act, _sid, _player_at)


def _park_one(doc, kind, item_id, source='loot'):
    doc.setdefault('pendingPickups', []).append(
        {'kind': kind, 'itemId': item_id, 'source': source, 'at': db._now()})


def test_fresh_doc_has_empty_pending_pickups(table):
    _sid_val, doc = _player_at(table, 'city_r0')
    assert doc.get('pendingPickups') == []
