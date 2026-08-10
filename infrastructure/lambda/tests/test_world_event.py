"""Integration tests for the wilderness World Event ("The Great Beast").

Uses the same in-memory FakeTable + `act` dispatcher helper as
test_undercity_db.py, and the real season/state entrypoints.
"""
import undercity_db as db
import undercity_data as data
from test_undercity_db import FakeTable, act


def _started_table():
    t = FakeTable()
    status, _ = act(t, 'season-start', hostKey='swampking')
    assert status == 200
    return t


def _sid(table):
    sid, _ = db._active_season(table)
    return sid


def _join(table, user, name, home='cavern', starter='saproling'):
    status, resp = act(table, 'join', user=user, name=name, home=home, starter=starter)
    assert status == 200, resp
    return resp['you']


def _place_live_event(table, sid):
    """Spawn the event off the real map and return its record (real node ids)."""
    db._spawn_world_event(table, sid)
    return db._world_event(table, sid)


# ── Task 3: helpers + footprint picker ───────────────────────────────────────

def test_pick_world_event_run_is_connected_wilderness_triple():
    nodes = data.MAP_NODES
    run = db._pick_world_event_run(nodes)
    assert run is not None and len(run) == 3
    a, center, c = run
    for nid in run:
        assert nodes[nid]['region'] == 'wilderness'
    assert a in nodes[center]['neighbors']
    assert c in nodes[center]['neighbors']
    assert a != c


def test_world_event_state_round_trip():
    table = _started_table()
    sid = _sid(table)
    assert db._world_event(table, sid) is None
    rec = {'spawned': True, 'node': 'x', 'nodes': ['a', 'x', 'b'],
           'hp': 200, 'maxHp': 200, 'dmg': {}, 'dead': False}
    db._set_world_event(table, sid, rec)
    got = db._world_event(table, sid)
    assert got['hp'] == 200 and got['nodes'] == ['a', 'x', 'b']


# ── Task 4: spawn on first sigil-lair kill ────────────────────────────────────

def test_spawn_world_event_shape_and_idempotent():
    table = _started_table()
    sid = _sid(table)
    assert db._world_event(table, sid) is None

    db._spawn_world_event(table, sid)
    ev = db._world_event(table, sid)
    assert ev is not None
    assert ev['spawned'] is True and ev['dead'] is False
    assert ev['node'] in ev['nodes'] and len(ev['nodes']) == 3
    # Damage check: no kill pool at all, just a deadline to bleed it before.
    assert 'hp' not in ev and 'maxHp' not in ev
    assert ev['endsAt'] > db._now()
    assert ev['dmg'] == {}

    # Idempotent: a second spawn call does not reset or move it.
    ev['dmg'] = {'u': 50}
    db._set_world_event(table, sid, ev)
    db._spawn_world_event(table, sid)
    again = db._world_event(table, sid)
    assert again['dmg'] == {'u': 50} and again['nodes'] == ev['nodes']


def test_finish_lair_first_kill_spawns_event():
    """The _finish_lair 'attacker + not slain' path must spawn the beast."""
    table = _started_table()
    sid = _sid(table)
    _join(table, 'user-alex', 'Alex')
    doc = db._get_player(table, sid, 'user-alex')
    node = next(iter(data.LAIR_BOSSES))
    rec = {'kind': 'lair', 'node': node,
           'npc': {'maxHp': data.LAIR_BOSSES[node]['hp']},
           'npcMeta': {'name': data.LAIR_BOSSES[node]['name']},
           'ctx': {'slain': False, 'vestMax': data.LAIR_BOSSES[node]['hp'] // 2}}
    result = {'outcome': 'attacker', 'attackerHp': 20, 'defenderHp': 0, 'strikes': []}
    db._finish_lair(table, sid, doc, rec, result)
    assert db._world_event(table, sid) is not None


# ── Task 5: resolve-space overlay + engage action ────────────────────────────

def test_landing_on_event_node_returns_world_event_space():
    table = _started_table()
    sid = _sid(table)
    _join(table, 'user-alex', 'Alex')
    we = _place_live_event(table, sid)
    doc = db._get_player(table, sid, 'user-alex')
    ev = db._resolve_space(table, sid, doc, we['node'], prev=None)
    assert ev['type'] == 'world_event'
    assert ev['endsAt'] == we['endsAt'] and ev['dmg'] == 0
    assert ev['name'] == data.WORLD_EVENT['name']
    assert ev['nodes'] == we['nodes']


def test_world_engage_starts_world_battle():
    table = _started_table()
    sid = _sid(table)
    _join(table, 'user-alex', 'Alex')
    we = _place_live_event(table, sid)
    doc = db._get_player(table, sid, 'user-alex')
    doc['position'] = we['nodes'][0]
    db._put_player(table, doc)
    status, resp = act(table, 'world-engage', user='user-alex', name='Alex')
    assert status == 200, resp
    assert resp['spaceEvent']['type'] == 'battle_start'
    assert resp['spaceEvent']['kind'] == 'world'


def test_world_event_overrides_umori_on_shared_node():
    """The beast physically occupies the tile, so it must win over Umori's
    wandering stall when both land on the same wilderness node."""
    table = _started_table()
    sid = _sid(table)
    _join(table, 'user-alex', 'Alex')
    umori = db._umori_node(db._umori_window())
    rec = {'spawned': True, 'node': umori, 'nodes': [umori, umori, umori],
           'endsAt': db._iso_in_minutes(60), 'dmg': {}, 'dead': False}
    db._set_world_event(table, sid, rec)
    doc = db._get_player(table, sid, 'user-alex')
    ev = db._resolve_space(table, sid, doc, umori, prev=None)
    assert ev['type'] == 'world_event'


def test_world_engage_requires_standing_on_beast():
    table = _started_table()
    sid = _sid(table)
    _join(table, 'user-alex', 'Alex')
    _place_live_event(table, sid)  # player is at home gate, not on the beast
    status, resp = act(table, 'world-engage', user='user-alex', name='Alex')
    assert status == 409


# ── Task 6: 6-round skirmish cap ─────────────────────────────────────────────

def test_world_skirmish_caps_at_six_rounds(monkeypatch):
    table = _started_table()
    sid = _sid(table)
    _join(table, 'user-alex', 'Alex')
    we = _place_live_event(table, sid)
    doc = db._get_player(table, sid, 'user-alex')
    doc['position'] = we['nodes'][0]
    db._put_player(table, doc)
    act(table, 'world-engage', user='user-alex', name='Alex')

    # Neither side deals damage -> only the round cap can end the fight.
    def _stub(att, dfn, *a, **k):
        return [{'round': 1, 'by': 'attacker', 'dmg': 0, 'winner': 'draw'}]
    monkeypatch.setattr(db.engine, 'resolve_round', _stub)

    rounds, last = 0, None
    for _ in range(12):  # more than the cap
        status, resp = act(table, 'combat-round', user='user-alex', name='Alex',
                           stance='guard')
        assert status == 200, resp
        rounds += 1
        last = resp
        if not db._get_player(table, sid, 'user-alex').get('battle'):
            break

    assert db._get_player(table, sid, 'user-alex').get('battle') is None
    assert rounds <= data.WORLD_EVENT_ROUND_CAP
    assert 'spaceEvent' in last


# ── World-boss reward table shape ────────────────────────────────────────────

def test_reward_brackets_carry_xp_and_gear_tiers():
    for key in ('vanquisher', 'major', 'minor', 'participant'):
        r = data.WORLD_EVENT_REWARDS[key]
        assert r['xp'] > 0, f'{key} missing xp'
        assert r['tiers'] and all(isinstance(t, int) for t in r['tiers']), \
            f'{key} missing/invalid gear tiers'
    # Better brackets trend toward better gear: vanquisher can roll T3, participant cannot.
    assert 3 in data.WORLD_EVENT_REWARDS['vanquisher']['tiers']
    assert 3 not in data.WORLD_EVENT_REWARDS['participant']['tiers']


# ── Task 7: damage banking + tiered payout ───────────────────────────────────

def test_skirmish_banks_damage_to_pool_and_dmg_map(monkeypatch):
    table = _started_table()
    sid = _sid(table)
    _join(table, 'user-alex', 'Alex')
    we = _place_live_event(table, sid)
    doc = db._get_player(table, sid, 'user-alex')
    doc['position'] = we['nodes'][0]
    db._put_player(table, doc)
    act(table, 'world-engage', user='user-alex', name='Alex')

    # Chip 3 per round. The beast is never felled — the round cap ends the
    # skirmish and the damage is banked against Alex's name.
    def _stub(att, dfn, *a, **k):
        dfn.hp -= 3
        return [{'round': 1, 'by': 'attacker', 'dmg': 3, 'winner': 'attacker'}]
    monkeypatch.setattr(db.engine, 'resolve_round', _stub)
    for _ in range(12):
        act(table, 'combat-round', user='user-alex', name='Alex', stance='aggress')
        if not db._get_player(table, sid, 'user-alex').get('battle'):
            break

    we = db._world_event(table, sid)
    assert we['dmg'].get('user-alex') == 3 * data.WORLD_EVENT_ROUND_CAP
    assert we['dead'] is False          # still hunting; only the clock ends it


def test_pool_depletion_pays_contributors_by_bracket():
    table = _started_table()
    sid = _sid(table)
    _join(table, 'u_top', 'Top')
    _join(table, 'u_minor', 'Minor')
    top_before = db._get_player(table, sid, 'u_top')['spores']
    minor_before = db._get_player(table, sid, 'u_minor')['spores']

    rec = {'spawned': True, 'node': 'x', 'nodes': ['a', 'x', 'b'],
           'endsAt': db._iso_in_minutes(60), 'dead': False,
           # Brackets are ABSOLUTE damage now: 200 tops the board, 80 clears
           # WORLD_EVENT_MINOR_DAMAGE (60) but not MAJOR (150).
           'dmg': {'u_top': 200, 'u_minor': 80}}
    db._set_world_event(table, sid, rec)

    top = db._get_player(table, sid, 'u_top')  # the killer doc (mutated in place)
    results = db._world_event_payout(table, sid, top)

    assert db._world_event(table, sid)['dead'] is True
    brackets = {r['userId']: r['bracket'] for r in results}
    assert brackets['u_top'] == 'vanquisher'
    assert brackets['u_minor'] == 'minor'

    # Killer: credited in place on the passed doc (caller persists it), not to the
    # stored doc.
    assert top['spores'] == top_before + data.WORLD_EVENT_REWARDS['vanquisher']['spores']
    # Non-killer: credited to the stored doc + an away-event line.
    minor_doc = db._get_player(table, sid, 'u_minor')
    assert minor_doc['spores'] == minor_before + data.WORLD_EVENT_REWARDS['minor']['spores']
    assert any(e.get('kind') == 'world_kill' for e in minor_doc.get('awayEvents', []))
    # Renown to perm for both.
    assert db._get_perm(table, 'u_top')['renown'] >= data.WORLD_EVENT_REWARDS['vanquisher']['renown']
    assert db._get_perm(table, 'u_minor')['renown'] >= data.WORLD_EVENT_REWARDS['minor']['renown']

    # Idempotent: already dead -> no second payout.
    assert db._world_event_payout(table, sid, top) == []


def test_payout_grants_xp_gear_and_roster_to_all():
    table = _started_table()
    sid = _sid(table)
    _join(table, 'u_top', 'Top')
    _join(table, 'u_minor', 'Minor')
    top0 = db._get_player(table, sid, 'u_top')
    minor0 = db._get_player(table, sid, 'u_minor')
    top_prog0 = (top0['level'], top0['xp'])
    minor_prog0 = (minor0['level'], minor0['xp'])
    top_owned0 = len(top0.get('gear') or {}) + len(top0.get('gearStash') or [])
    minor_owned0 = len(minor0.get('gear') or {}) + len(minor0.get('gearStash') or [])

    rec = {'spawned': True, 'node': 'x', 'nodes': ['a', 'x', 'b'],
           'endsAt': db._iso_in_minutes(60), 'dead': False,
           # Brackets are ABSOLUTE damage now: 200 tops the board, 80 clears
           # WORLD_EVENT_MINOR_DAMAGE (60) but not MAJOR (150).
           'dmg': {'u_top': 200, 'u_minor': 80}}
    db._set_world_event(table, sid, rec)

    top = db._get_player(table, sid, 'u_top')  # killer doc, mutated in place
    results = db._world_event_payout(table, sid, top)

    by_uid = {r['userId']: r for r in results}
    # XP bonus banked for both brackets (may convert into level-ups, so assert
    # forward progress in (level, xp) rather than a raw xp sum).
    assert by_uid['u_top']['xp'] == data.WORLD_EVENT_REWARDS['vanquisher']['xp']
    assert by_uid['u_minor']['xp'] == data.WORLD_EVENT_REWARDS['minor']['xp']
    minor_doc = db._get_player(table, sid, 'u_minor')
    assert (top['level'], top['xp']) > top_prog0
    assert (minor_doc['level'], minor_doc['xp']) > minor_prog0
    # One guaranteed gear piece each — auto-equipped into an empty slot or stashed,
    # so assert total owned gear (equipped + stash) grew by 1.
    assert len(top.get('gear') or {}) + len(top.get('gearStash') or []) == top_owned0 + 1
    assert len(minor_doc.get('gear') or {}) + len(minor_doc.get('gearStash') or []) == minor_owned0 + 1
    # Result rows carry the new fields + a full roster.
    assert by_uid['u_top']['gear'] is not None and by_uid['u_top']['xp'] > 0
    roster = by_uid['u_top']['roster']
    assert [r['name'] for r in roster] == ['Top', 'Minor']  # ranked by damage
    assert {r['bracket'] for r in roster} == {'vanquisher', 'minor'}
    # Away-event for the non-killer carries bracket + xp + gear + roster.
    ev = next(e for e in minor_doc['awayEvents'] if e['kind'] == 'world_kill')
    assert ev['bracket'] == 'minor' and ev['xp'] > 0
    assert 'gear' in ev and len(ev['roster']) == 2


def test_expiry_settles_the_hunt_and_pays_inline(monkeypatch):
    """The beast can't be killed — the clock ends the hunt. A skirmish that runs
    past the deadline settles it and hands the striker their bracket inline."""
    table = _started_table()
    sid = _sid(table)
    _join(table, 'user-alex', 'Alex')
    we = _place_live_event(table, sid)
    doc = db._get_player(table, sid, 'user-alex')
    doc['position'] = we['nodes'][0]
    db._put_player(table, doc)
    before = db._get_player(table, sid, 'user-alex')['spores']
    act(table, 'world-engage', user='user-alex', name='Alex')

    def _stub(att, dfn, *a, **k):
        dfn.hp -= 99
        return [{'round': 1, 'by': 'attacker', 'dmg': 99, 'winner': 'attacker'}]
    monkeypatch.setattr(db.engine, 'resolve_round', _stub)
    # The clock runs out mid-skirmish: the blows still land and still count.
    we = db._world_event(table, sid)
    we['endsAt'] = db._iso_in_minutes(-1)
    db._set_world_event(table, sid, we)
    # Nothing can fell the beast, so the fight ends on the round cap.
    for _ in range(data.WORLD_EVENT_ROUND_CAP + 2):
        status, resp = act(table, 'combat-round', user='user-alex', name='Alex',
                           stance='aggress')
        assert status == 200, resp
        if 'spaceEvent' in resp:
            break

    ev = resp['spaceEvent']
    assert ev['type'] == 'world_event'
    assert ev['worldKill'] is True
    assert ev['reward']['bracket'] == 'vanquisher'   # sole striker tops the board
    assert ev['reward']['xp'] > 0 and 'gear' in ev['reward']
    assert ev['raid']['name'] == data.WORLD_EVENT['name']
    assert any(r['name'] == 'Alex' for r in ev['raid']['roster'])
    assert db._world_event(table, sid)['dead'] is True
    after = db._get_player(table, sid, 'user-alex')['spores']
    assert after == before + ev['reward']['spores']


def test_expired_beast_cannot_be_engaged_and_settles_once():
    """Walking up to a beast whose clock has run out settles the hunt rather than
    starting a fight, and the payout guard makes that idempotent."""
    table = _started_table()
    sid = _sid(table)
    _join(table, 'u_top', 'Top')
    _join(table, 'u_minor', 'Minor')
    we = _place_live_event(table, sid)
    we['endsAt'] = db._iso_in_minutes(-1)
    we['dmg'] = {'u_top': 200, 'u_minor': 80}
    db._set_world_event(table, sid, we)
    top_before = db._get_player(table, sid, 'u_top')['spores']

    doc = db._get_player(table, sid, 'u_top')
    doc['position'] = we['nodes'][0]
    db._put_player(table, doc)
    status, resp = act(table, 'world-engage', user='u_top', name='Top')
    assert status == 409                       # nothing left to fight
    assert db._world_event(table, sid)['dead'] is True
    # Both contributors were paid on the way through, by absolute damage bracket.
    assert db._get_player(table, sid, 'u_top')['spores'] > top_before
    minor = db._get_player(table, sid, 'u_minor')
    ev = next(e for e in minor['awayEvents'] if e['kind'] == 'world_kill')
    assert ev['bracket'] == 'minor'
    # Settling again is a no-op — no double pay.
    assert db._resolve_world_event(table, sid) == []


def test_bracket_is_absolute_damage_not_a_share_of_the_group():
    """Your bracket depends only on what YOU dealt, so a big turnout never
    dilutes anyone (and a small one never inflates them)."""
    major = data.WORLD_EVENT_MAJOR_DAMAGE
    minor = data.WORLD_EVENT_MINOR_DAMAGE
    assert data.world_event_reward(major, False)[0] == 'major'
    assert data.world_event_reward(minor, False)[0] == 'minor'
    assert data.world_event_reward(minor - 1, False)[0] == 'participant'
    # Identical damage grades identically no matter what anyone else did.
    assert data.world_event_reward(major, False)[0] ==            data.world_event_reward(major, False)[0]
    # The single top dealer takes the crown regardless of how little they dealt.
    assert data.world_event_reward(1, True)[0] == 'vanquisher'


# ── Task 8: state payload ────────────────────────────────────────────────────

def test_state_exposes_world_event_block():
    table = _started_table()
    sid = _sid(table)
    _join(table, 'user-alex', 'Alex')
    we = _place_live_event(table, sid)
    status, state = db.handle_state(table, {'userId': 'user-alex'})
    assert status == 200
    block = state['worldEvent']
    assert block['nodes'] == we['nodes']
    assert block['center'] == we['node']
    assert block['dead'] is False
    assert block['spriteId'] == data.WORLD_EVENT['spriteId']
    # Countdown + tally replace the HP bar.
    assert block['endsAt'] == we['endsAt']
    assert block['totalDamage'] == 0 and block['topDamage'] == 0
    assert 'hp' not in block and 'maxHp' not in block


def test_state_world_event_absent_before_spawn():
    table = _started_table()
    _join(table, 'user-alex', 'Alex')
    status, state = db.handle_state(table, {'userId': 'user-alex'})
    assert status == 200
    assert state['worldEvent'] is None
