import undercity_data as data
import undercity_db as db

from tests.test_undercity_db import table  # noqa: F401  (pytest fixture)


def test_claim_first_is_idempotent(table):
    sid = 'S'
    alice = {'userId': 'u1', 'username': 'Alice'}
    bob = {'userId': 'u2', 'username': 'Bob'}
    assert db._claim_first(table, sid, 'city_lair', 'lair', alice) is True
    assert db._claim_first(table, sid, 'city_lair', 'lair', bob) is False
    rec = db._get(table, db._season_pk(sid), 'FIRST#city_lair')
    assert rec['by'] == 'Alice'
    assert rec['uid'] == 'u1'
    assert rec['kind'] == 'lair'
