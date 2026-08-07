"""Admin role + in-game free move."""
import undercity_data as data
import undercity_db as db
import undercity_engine as engine

from tests.test_undercity_db import table, act, _sid  # noqa: F401


# A tiny synthetic graph: a—b—c—d in a line, plus a barrier `x` off c and a
# blocked tunnel `t` off b.
_NODES = {
    'a': {'neighbors': ['b']},
    'b': {'neighbors': ['a', 'c', 't']},
    'c': {'neighbors': ['b', 'd', 'x']},
    'd': {'neighbors': ['c']},
    'x': {'neighbors': ['c']},   # a sealed barrier
    't': {'neighbors': ['b']},   # a blocked tunnel
}


def test_free_walk_accepts_any_length_adjacent_path():
    assert engine.validate_free_walk(_NODES, ['a', 'b', 'c', 'd']) is True


def test_free_walk_allows_backtracking():
    # a→b→a→b is illegal for a dice move (immediate backtrack) but fine here.
    assert engine.validate_free_walk(_NODES, ['a', 'b', 'a', 'b']) is True


def test_free_walk_rejects_non_adjacent_jump():
    assert engine.validate_free_walk(_NODES, ['a', 'c']) is False


def test_free_walk_rejects_stepping_onto_blocked():
    assert engine.validate_free_walk(
        _NODES, ['a', 'b', 't'], blocked=frozenset({'t'})) is False


def test_free_walk_barrier_may_be_landing_but_not_corridor():
    closed = frozenset({'x'})
    # landing ON the barrier is allowed (bonk stop)
    assert engine.validate_free_walk(_NODES, ['a', 'b', 'c', 'x'], closed=closed) is True
    # but you can never corridor THROUGH it
    nodes = dict(_NODES)
    nodes['x'] = {'neighbors': ['c', 'd']}
    assert engine.validate_free_walk(nodes, ['a', 'b', 'c', 'x', 'd'], closed=closed) is False


def test_free_walk_rejects_degenerate_path():
    assert engine.validate_free_walk(_NODES, ['a']) is False
    assert engine.validate_free_walk(_NODES, []) is False


def _start_with_host(t, host='swampking'):
    act(t, 'season-start', hostKey=host)
    act(t, 'join', starter='pest')          # user-alex
    return _sid(t)


def test_grant_admin_sets_flag_and_is_hostkey_gated(table):
    sid = _start_with_host(table)
    # wrong passphrase → 403, flag untouched
    status, _ = act(table, 'admin', hostKey='nope', cmd='grant-admin',
                    target='user-alex', on=True)
    assert status == 403
    assert not db._get_player(table, sid, 'user-alex').get('isAdmin')

    # correct passphrase → flag set
    status, resp = act(table, 'admin', hostKey='swampking', cmd='grant-admin',
                       target='user-alex', on=True)
    assert status == 200 and resp['isAdmin'] is True
    assert db._get_player(table, sid, 'user-alex')['isAdmin'] is True


def test_grant_admin_can_revoke(table):
    sid = _start_with_host(table)
    act(table, 'admin', hostKey='swampking', cmd='grant-admin',
        target='user-alex', on=True)
    status, resp = act(table, 'admin', hostKey='swampking', cmd='grant-admin',
                       target='user-alex', on=False)
    assert status == 200 and resp['isAdmin'] is False
    assert db._get_player(table, sid, 'user-alex')['isAdmin'] is False


def _two_step_path(nodes, start):
    """Build a legal [start, n1, n2] adjacent path from the real season map."""
    n1 = nodes[start]['neighbors'][0]
    n2 = next(x for x in nodes[n1]['neighbors'] if x != start)
    return [start, n1, n2]


def test_freemove_rejected_for_non_admin(table):
    sid = _start_with_host(table)
    doc = db._get_player(table, sid, 'user-alex')
    nodes = db._season_map(table, sid)
    path = _two_step_path(nodes, doc['position'])
    status, resp = act(table, 'freemove', to=path[-1], path=path)
    assert status == 403


def test_freemove_walks_multi_step_and_resolves_landing(table):
    sid = _start_with_host(table)
    doc = db._get_player(table, sid, 'user-alex')
    doc['isAdmin'] = True
    db._put_player(table, doc)
    nodes = db._season_map(table, sid)
    path = _two_step_path(nodes, doc['position'])

    status, resp = act(table, 'freemove', to=path[-1], path=path)
    assert status == 200
    assert resp['you']['position'] == path[-1]
    # the landing resolved — a space event is always attached (may be a plain
    # 'nothing' tile, a facility, or a fight)
    assert 'spaceEvent' in resp


def test_freemove_rejects_illegal_route(table):
    sid = _start_with_host(table)
    doc = db._get_player(table, sid, 'user-alex')
    doc['isAdmin'] = True
    db._put_player(table, doc)
    nodes = db._season_map(table, sid)
    start = doc['position']
    # a non-adjacent 2-hop jump sent as a 2-node path
    far = _two_step_path(nodes, start)[-1]
    status, resp = act(table, 'freemove', to=far, path=[start, far])
    assert status == 409


def test_freemove_requires_path_ending_at_to(table):
    sid = _start_with_host(table)
    doc = db._get_player(table, sid, 'user-alex')
    doc['isAdmin'] = True
    db._put_player(table, doc)
    nodes = db._season_map(table, sid)
    path = _two_step_path(nodes, doc['position'])
    status, _ = act(table, 'freemove', to=path[1], path=path)   # to != path[-1]
    assert status == 409


def test_isadmin_in_you_view_but_not_public(table):
    sid = _start_with_host(table)
    act(table, 'admin', hostKey='swampking', cmd='grant-admin',
        target='user-alex', on=True)
    # owner's own view carries the flag
    status, resp = act(table, 'set-status', text='hi')   # returns a `you` envelope
    assert resp['you'].get('isAdmin') is True
    # the public projection never exposes it
    doc = db._get_player(table, sid, 'user-alex')
    assert 'isAdmin' not in db._public_player(doc)
