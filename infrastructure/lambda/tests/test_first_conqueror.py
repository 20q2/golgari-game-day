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


def _treasure_doc(uid, name):
    # level == LEVEL_CAP so an XP grant never triggers the maxHp/hp level-up path;
    # keeps treasure tests focused on the spore haul.
    return {'userId': uid, 'username': name, 'spores': 0,
            'level': data.LEVEL_CAP, 'xp': 0}


def _no_gear(monkeypatch):
    # random() high => no plundered-tile gear coin-flip; choices/choice unused here.
    monkeypatch.setattr(db._rng, 'random', lambda: 0.99)
    monkeypatch.setattr(db._rng, 'choices', lambda seq, weights=None, k=1: [seq[0]])
    monkeypatch.setattr(db._rng, 'choice', lambda seq: seq[0])


def test_trove_first_full_later_reduced_then_empty(table, monkeypatch):
    _no_gear(monkeypatch)
    sid = 'S'
    alice = _treasure_doc('u1', 'Alice')
    bob = _treasure_doc('u2', 'Bob')
    full = data.TROVE_REWARD['spores']

    r1 = db._trove(table, sid, alice, 'city_trove')
    assert r1['spores'] == full                                   # first: full

    r2 = db._trove(table, sid, bob, 'city_trove')
    assert r2['spores'] == int(full * data.PLUNDERED_LOOT_MULT)   # later: half

    r3 = db._trove(table, sid, alice, 'city_trove')
    assert 'spores' not in r3                                     # repeat: nothing

    rec = db._get(table, db._season_pk(sid), 'FIRST#city_trove')
    assert rec['by'] == 'Alice' and rec['kind'] == 'trove'


def test_cache_first_full_later_reduced(table, monkeypatch):
    _no_gear(monkeypatch)
    sid = 'S'
    alice = _treasure_doc('u1', 'Alice')
    bob = _treasure_doc('u2', 'Bob')
    full = data.CACHE_REWARD['spores']

    r1 = db._cache(table, sid, alice, 'city_cache')
    assert r1['spores'] == full

    r2 = db._cache(table, sid, bob, 'city_cache')
    assert r2['spores'] == int(full * data.PLUNDERED_LOOT_MULT)

    rec = db._get(table, db._season_pk(sid), 'FIRST#city_cache')
    assert rec['by'] == 'Alice' and rec['kind'] == 'cache'


def test_vault_first_full_later_reduced(table, monkeypatch):
    _no_gear(monkeypatch)
    sid = 'S'
    alice = _treasure_doc('u1', 'Alice')
    bob = _treasure_doc('u2', 'Bob')
    full = data.VAULT_REWARD['spores']

    r1 = db._vault(table, sid, alice, 'vault')
    assert r1['spores'] == full

    r2 = db._vault(table, sid, bob, 'vault')
    assert r2['spores'] == int(full * data.PLUNDERED_LOOT_MULT)

    rec = db._get(table, db._season_pk(sid), 'FIRST#vault')
    assert rec['by'] == 'Alice' and rec['kind'] == 'vault'
