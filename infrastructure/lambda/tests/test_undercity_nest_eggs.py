import undercity_data as data
import undercity_db as db

from tests.test_undercity_db import (  # noqa: F401
    table, act, _sid, _player_at, _finish_started_battle)


def test_egg_drop_table_has_nest_sources_and_no_dead_lair():
    assert data.EGG_DROP['ruin_lair'] == (1.0, {3: 1.0})
    assert data.EGG_DROP['ruin_scavenge'] == (1.0, {1: 0.7, 2: 0.3})
    assert data.EGG_DROP['cache'] == (0.10, {1: 0.4, 2: 0.4, 3: 0.2})
    assert 'lair' not in data.EGG_DROP          # dead entry removed


def test_nest_guardian_kill_grants_guaranteed_t3_egg(table, monkeypatch):
    act(table, 'join', starter='pest')
    sid = _sid(table)
    doc = db._get_player(table, sid, 'user-alex')
    doc['position'] = 'lair_titan'                 # a RESPAWN_LAIR (Lord of Extinction)
    db._lair(table, sid, doc, 'lair_titan')        # starts a fresh respawn-lair fight
    # Force a deterministic win + drops (guaranteed egg is tier-independent of rng).
    monkeypatch.setattr(db._rng, 'choice', lambda seq: seq[0])
    monkeypatch.setattr(db._rng, 'choices', lambda seq, weights=None, k=1: [seq[0]])
    se = _finish_started_battle(table, monkeypatch, doc, 'attacker')
    assert se['type'] == 'lair'
    assert se['egg'] == {'tier': 3}
    # The battle finisher mutates + persists a freshly-loaded doc; re-fetch it.
    saved = db._get_player(table, sid, 'user-alex')
    assert saved['eggs'][-1]['tier'] == 3


def test_nest_scavenge_first_visit_gives_egg_and_spores(monkeypatch):
    # random()=0.99 → above the 18% consumable chance (no item), still < 1.0 so
    # the guaranteed egg drops; randint pinned to the low end of the spore range.
    monkeypatch.setattr(db._rng, 'random', lambda: 0.99)
    monkeypatch.setattr(db._rng, 'randint', lambda a, b: a)
    doc = {'userId': 'u1', 'username': 'U', 'spores': 0, 'eggs': []}
    entry = {'respawnAt': '2999-01-01T00:00:00', 'scavenged': False}
    out = db._lair_scavenge(doc, 'lair_titan', entry)
    assert out['type'] == 'lairAbandoned'
    assert out['egg']['tier'] in (1, 2)
    assert out['spores'] == data.LAIR_SCAVENGE_SPORES[0]
    assert len(doc['eggs']) == 1
    assert entry['scavenged'] is True


def test_nest_scavenge_repeat_still_gives_egg_but_no_spores():
    doc = {'userId': 'u1', 'username': 'U', 'spores': 5, 'eggs': []}
    entry = {'respawnAt': '2999-01-01T00:00:00', 'scavenged': True}
    out = db._lair_scavenge(doc, 'lair_titan', entry)
    assert out['egg']['tier'] in (1, 2)     # clutch still yields an egg
    assert 'spores' not in out              # picked clean — no spore grant
    assert doc['spores'] == 5               # unchanged
    assert len(doc['eggs']) == 1


def test_cache_can_drop_an_egg(table, monkeypatch):
    sid, doc = _player_at(table, 'city_cache', spores=0)
    monkeypatch.setattr(db._rng, 'random', lambda: 0.0)          # under every chance
    monkeypatch.setattr(db._rng, 'choice', lambda seq: seq[0])
    out = db._cache(table, sid, doc, 'city_cache')
    assert out['type'] == 'cache'
    assert out['egg']['tier'] in (1, 2, 3)
    assert doc['eggs']


def test_cache_no_egg_when_roll_misses(table, monkeypatch):
    sid, doc = _player_at(table, 'city_cache', spores=0)
    monkeypatch.setattr(db._rng, 'random', lambda: 0.99)         # above cache egg 0.10
    out = db._cache(table, sid, doc, 'city_cache')
    assert 'egg' not in out
    assert not doc.get('eggs')
