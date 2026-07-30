"""Enraged wilderness monster tests (specs/2026-07-30-undercity-enraged-monsters-design.md)."""
import sys
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parents[1]))

import pytest

import undercity_data as data
import undercity_db as db

from test_undercity_db import FakeTable, act


@pytest.fixture
def table():
    t = FakeTable()
    status, _ = act(t, 'season-start', hostKey='swampking')
    assert status == 200
    return t


def _sid(table):
    sid, _ = db._active_season(table)
    return sid


def test_roster_shape():
    assert len(data.ENRAGED_MONSTERS) == 4
    assert data.ENRAGED_ORDER == sorted(data.ENRAGED_MONSTERS)
    for mid, m in data.ENRAGED_MONSTERS.items():
        assert m['id'] == mid
        assert 36 <= m['hp'] <= 44, mid
        assert 15 <= m['bounty'] <= 20, mid
        assert m['xp'] >= 25
        for stat in ('atk', 'def', 'spd'):
            assert m[stat] >= 1
    assert 'enraged' in data.GEAR_DROP


def test_window_and_pick_are_deterministic():
    from datetime import datetime
    now = datetime(2026, 7, 30, 12, 0, 0)
    win = db._enraged_window(now)
    # Same window -> identical node + monster, every call, every client.
    assert db._enraged_node(win) == db._enraged_node(win)
    assert db._enraged_monster(win) == db._enraged_monster(win)
    # The pick is a real wilderness node and a real roster id.
    assert db._enraged_node(win) in data.UMORI_NODES
    assert db._enraged_monster(win) in data.ENRAGED_MONSTERS


def test_enraged_node_avoids_umori():
    # For any window, the enraged node never collides with Umori's node computed
    # for the umori-window that contains this enraged window's start.
    for win in range(0, 200):
        umori_win = (win * data.ENRAGED_DWELL_MIN) // data.UMORI_DWELL_MIN
        assert db._enraged_node(win) != db._umori_node(umori_win), win


def test_window_advances_with_time():
    from datetime import datetime, timedelta
    now = datetime(2026, 7, 30, 12, 0, 0)
    win = db._enraged_window(now)
    later = now + timedelta(minutes=data.ENRAGED_DWELL_MIN)
    assert db._enraged_window(later) == win + 1


def test_state_spawns_fresh_and_persists_in_window(table):
    sid = _sid(table)
    rec = db._enraged_state(table, sid)
    assert rec['monsterId'] in data.ENRAGED_MONSTERS
    spec = data.ENRAGED_MONSTERS[rec['monsterId']]
    assert rec['hp'] == spec['hp'] == rec['maxHp']
    assert rec['dead'] is False
    assert rec['node'] == db._enraged_node(rec['window'])
    # A second read in the same window returns the SAME record, not a re-roll.
    rec2 = db._enraged_state(table, sid)
    assert rec2['window'] == rec['window'] and rec2['node'] == rec['node']


def test_dead_stays_dead_until_window_rolls(table):
    sid = _sid(table)
    rec = db._enraged_state(table, sid)
    rec['dead'] = True
    rec['hp'] = 0
    db._set_enraged_state(table, sid, rec)
    # Same window -> still dead (spot stays empty).
    assert db._enraged_state(table, sid)['dead'] is True


def test_stale_window_rolls_over_to_fresh_spawn(table):
    sid = _sid(table)
    rec = db._enraged_state(table, sid)
    # Force a stale, wounded, dead record from a prior window.
    rec['window'] -= 1
    rec['hp'] = 0
    rec['dead'] = True
    db._set_enraged_state(table, sid, rec)
    fresh = db._enraged_state(table, sid)
    assert fresh['window'] == db._enraged_window()
    assert fresh['dead'] is False
    spec = data.ENRAGED_MONSTERS[fresh['monsterId']]
    assert fresh['hp'] == spec['hp']


def test_state_payload_includes_enraged(table):
    act(table, 'join', starter='pest', home='city')
    status, state = db.handle_state(table, {'userId': 'user-alex'})
    assert status == 200, state
    er = state['enraged']
    assert er['dead'] is False
    assert er['node'] in data.UMORI_NODES
    assert er['maxHp'] == data.ENRAGED_MONSTERS[er['monsterId']]['hp']
    assert 'movesAt' in er


def _engage_here(table, sid, uid='user-alex'):
    """Move the player onto the live enraged node and return (doc, rec)."""
    rec = db._enraged_state(table, sid)
    doc = db._get_player(table, sid, uid)
    doc['position'] = rec['node']
    db._put_player(table, doc)
    return db._get_player(table, sid, uid), rec


def test_landing_starts_enraged_battle(table):
    act(table, 'join', starter='pest', home='city')
    sid = _sid(table)
    doc, rec = _engage_here(table, sid)
    ev = db._resolve_space(table, sid, doc, rec['node'], rec['node'])
    assert ev['type'] == 'battle_start'
    assert doc['battle']['kind'] == 'enraged'
    assert doc['battle']['npc']['maxHp'] == data.ENRAGED_MONSTERS[rec['monsterId']]['hp']


def test_enraged_kill_pays_renown_xp_and_marks_dead(table):
    act(table, 'join', starter='pest', home='city')
    sid = _sid(table)
    doc, rec = _engage_here(table, sid)
    perm_before = db._get_perm(table, 'user-alex').get('renown', 0)
    db._start_battle(table, sid, doc, 'enraged',
                     dict(data.ENRAGED_MONSTERS[rec['monsterId']],
                          hp=rec['hp'], maxHp=rec['maxHp']),
                     node=rec['node'],
                     ctx={'poolStart': rec['hp'], 'monsterId': rec['monsterId']})
    result = {'outcome': 'attacker', 'strikes': [],
              'attackerHp': 20, 'defenderHp': 0}
    out = db._finish_enraged(table, sid, doc, doc['battle'], result)
    assert out['type'] == 'enraged'
    assert out['renown'] == data.ENRAGED_KILL_RENOWN
    assert out['xp'] == data.ENRAGED_KILL_XP
    assert db._get_perm(table, 'user-alex')['renown'] == perm_before + data.ENRAGED_KILL_RENOWN
    assert db._enraged_state(table, sid)['dead'] is True


def test_enraged_loss_leaves_wounded_shared_pool(table):
    act(table, 'join', starter='pest', home='city')
    sid = _sid(table)
    doc, rec = _engage_here(table, sid)
    db._start_battle(table, sid, doc, 'enraged',
                     dict(data.ENRAGED_MONSTERS[rec['monsterId']],
                          hp=rec['hp'], maxHp=rec['maxHp']),
                     node=rec['node'],
                     ctx={'poolStart': rec['hp'], 'monsterId': rec['monsterId']})
    result = {'outcome': 'defender', 'strikes': [],
              'attackerHp': 0, 'defenderHp': rec['hp'] - 12}
    db._finish_enraged(table, sid, doc, doc['battle'], result)
    live = db._enraged_state(table, sid)
    assert live['dead'] is False
    assert live['hp'] == rec['hp'] - 12   # wound lingers for the next challenger


def _give_book(table, user, gid):
    doc = db._get_player(table, _sid(table), user)
    doc.setdefault('grimoires', []).append(gid)
    doc['equippedGrimoire'] = gid
    db._put_player(table, doc)


def test_field_damage_softens_enraged_floored_at_one(table):
    act(table, 'join', starter='pest', home='city')
    sid = _sid(table)
    # Stand the caster on the enraged node so any spell range reaches (dist 0).
    rec = db._enraged_state(table, sid)
    doc = db._get_player(table, sid, 'user-alex')
    doc['position'] = rec['node']
    db._put_player(table, doc)
    # Find a grimoire holding a ranged field_damage spell.
    cand = None
    for gid, g in data.GRIMOIRES.items():
        for s in g['spells']:
            sp = data.SPELLS[s]
            if sp['effect'] == 'field_damage' and sp.get('range'):
                cand = (gid, s); break
        if cand: break
    assert cand, 'expected at least one ranged field_damage spell'
    gid, spell_id = cand
    _give_book(table, 'user-alex', gid)
    # Drive the pool low, then confirm a field-damage cast floors at 1 (no kill).
    rec['hp'] = 3
    db._set_enraged_state(table, sid, rec)
    status, resp = act(table, 'cast', spellId=spell_id, source='grimoire', target=rec['node'])
    assert status == 200, resp
    live = db._enraged_state(table, sid)
    assert live['hp'] == 1 and live['dead'] is False
    assert resp['cast']['targetName'] == data.ENRAGED_MONSTERS[rec['monsterId']]['name']


def test_field_curse_persists_and_bites_on_engage(table):
    act(table, 'join', starter='pest', home='city')
    sid = _sid(table)
    rec = db._enraged_state(table, sid)
    doc = db._get_player(table, sid, 'user-alex')
    doc['position'] = rec['node']
    db._put_player(table, doc)
    # Find any grimoire holding a field_curse whose buffKind is in GUARDIAN_DEBUFF.
    cand = None
    for gid, g in data.GRIMOIRES.items():
        for s in g['spells']:
            sp = data.SPELLS[s]
            if sp['effect'] == 'field_curse' and sp.get('buffKind') in data.GUARDIAN_DEBUFF:
                cand = (gid, s, sp['buffKind']); break
        if cand: break
    assert cand, 'expected at least one field_curse in GUARDIAN_DEBUFF'
    gid, spell_id, kind = cand
    _give_book(table, 'user-alex', gid)
    status, _ = act(table, 'cast', spellId=spell_id, source='grimoire', target=rec['node'])
    assert status == 200
    stored = db._enraged_state(table, sid)
    assert any(b['kind'] == kind for b in stored['buffs'])
