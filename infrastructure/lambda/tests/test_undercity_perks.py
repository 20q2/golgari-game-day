"""Attribute perk tracks + Guard/DEF fix (design 2026-07-21)."""
import sys
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parents[1]))

import pytest  # noqa: E402

import undercity_data as data  # noqa: E402
import undercity_db as db  # noqa: E402
import undercity_engine as engine  # noqa: E402

from tests.test_undercity_db import act, _sid, FakeTable, _finish_started_battle  # noqa: E402,F401


@pytest.fixture
def table():
    t = FakeTable()
    status, resp = act(t, 'season-start', hostKey='swampking')
    assert status == 200
    return t


def _doc(atk=1, dfn=1, spd=1):
    return {'atk': atk, 'def': dfn, 'spd': spd}


# ── Task 1: attribute_perks ──────────────────────────────────────────────────

def test_no_perks_below_first_threshold():
    assert engine.attribute_perks(_doc(5, 5, 5)) == frozenset()


def test_thresholds_unlock_in_order():
    assert engine.attribute_perks(_doc(atk=6)) == frozenset({'rend'})
    assert engine.attribute_perks(_doc(atk=12)) == frozenset({'rend', 'menace'})
    assert engine.attribute_perks(_doc(atk=18)) == frozenset({'rend', 'menace', 'deathdrive'})


def test_base_stat_lights_tier1_across_tracks():
    assert 'thick_hide' in engine.attribute_perks(_doc(dfn=7))
    assert 'rend' in engine.attribute_perks(_doc(atk=8))
    assert 'fleetfoot' in engine.attribute_perks(_doc(spd=7))


def test_all_three_tracks_independent():
    perks = engine.attribute_perks(_doc(atk=12, dfn=18, spd=6))
    assert perks == frozenset({'rend', 'menace', 'thick_hide', 'carapace_grind',
                               'last_stand', 'fleetfoot'})


# ── Task 2: Combatant carries perks ──────────────────────────────────────────

def test_combatant_carries_perks_and_survives_serde():
    doc = {'username': 'x', 'hp': 30, 'maxHp': 30, 'atk': 18, 'def': 5, 'spd': 5,
           'stance': 'fight'}
    c = db._combatant(doc)
    assert c.has_perk('rend') and c.has_perk('deathdrive')
    assert not c.has_perk('carapace_grind')
    snap = db._bt_snapshot(c)
    c2 = db._bt_to_combatant(snap)
    assert c2.has_perk('rend') and c2.has_perk('deathdrive')


# ── Task 3: Carapace Grind (Guard/DEF fix) ───────────────────────────────────

def test_carapace_grind_chips_on_lost_guard_only_for_holders():
    import random
    tank = engine.Combatant(name='t', hp=60, max_hp=60, atk=5, dfn=25, spd=5,
                            perks=frozenset({'carapace_grind'}))
    foe = engine.Combatant(name='f', hp=200, max_hp=200, atk=6, dfn=6, spd=6)
    # tank Guards, foe Feints -> foe wins the exchange; grind still chips the foe.
    before = foe.hp
    entries = engine.resolve_round(tank, foe, 'guard', 'feint', 1, random.Random(1))
    assert foe.hp < before
    assert any(e.get('guardChip') for e in entries)


def test_carapace_grind_absent_without_perk():
    import random
    plain = engine.Combatant(name='p', hp=60, max_hp=60, atk=5, dfn=25, spd=5)
    foe = engine.Combatant(name='f', hp=200, max_hp=200, atk=6, dfn=6, spd=6)
    entries = engine.resolve_round(plain, foe, 'guard', 'feint', 1, random.Random(1))
    assert not any(e.get('guardChip') for e in entries)


# ── Task 5: Rend ─────────────────────────────────────────────────────────────

def test_rend_applies_rot_on_winning_aggress():
    import random
    me = engine.Combatant(name='m', hp=40, max_hp=40, atk=12, dfn=5, spd=6,
                          perks=frozenset({'rend'}))
    foe = engine.Combatant(name='f', hp=60, max_hp=60, atk=5, dfn=3, spd=3)
    engine.resolve_round(me, foe, 'aggress', 'feint', 1, random.Random(3))  # aggress>feint
    assert foe.rot_stacks >= 1


def test_rend_no_rot_without_perk():
    import random
    me = engine.Combatant(name='m', hp=40, max_hp=40, atk=12, dfn=5, spd=6)
    foe = engine.Combatant(name='f', hp=60, max_hp=60, atk=5, dfn=3, spd=3)
    engine.resolve_round(me, foe, 'aggress', 'feint', 1, random.Random(3))
    assert foe.rot_stacks == 0


# ── Task 6: Deathdrive ───────────────────────────────────────────────────────

def test_deathdrive_boosts_aggress_only_when_low():
    low = engine.Combatant(name='l', hp=10, max_hp=40, atk=10, dfn=5, spd=5,
                           perks=frozenset({'deathdrive'}))
    high = engine.Combatant(name='h', hp=40, max_hp=40, atk=10, dfn=5, spd=5,
                            perks=frozenset({'deathdrive'}))
    assert engine._swing_base(low, 'aggress') > engine._swing_base(high, 'aggress')
    assert engine._swing_base(low, 'guard') == engine._swing_base(high, 'guard')


def test_deathdrive_noop_without_perk():
    low = engine.Combatant(name='l', hp=10, max_hp=40, atk=10, dfn=5, spd=5)
    high = engine.Combatant(name='h', hp=40, max_hp=40, atk=10, dfn=5, spd=5)
    assert engine._swing_base(low, 'aggress') == engine._swing_base(high, 'aggress')


# ── Task 7: Menace ───────────────────────────────────────────────────────────

def _telegraph_truthful(perks):
    rec = {'round': 1,
           'player': {'perks': perks, 'reveal_next': False},
           'npc': {'personality': 'balanced', 'bluff': 1.0},  # always bluffs
           'readChance': 0.0}
    db._telegraph_next(rec)
    return rec['npcShown'] == rec['npcActual']


def test_menace_lowers_effective_bluff():
    db._rng.seed(0)
    truth_plain = sum(_telegraph_truthful([]) for _ in range(400))
    db._rng.seed(0)
    truth_menace = sum(_telegraph_truthful(['menace']) for _ in range(400))
    assert truth_menace > truth_plain


# ── Task 8: Thick Hide ───────────────────────────────────────────────────────

def test_thick_hide_halves_hp_loss():
    doc = {'atk': 1, 'def': 7, 'spd': 1, 'hp': 30, 'maxHp': 30}   # def 7 -> thick_hide
    assert db._apply_hp_loss(doc, 10) == 5
    assert doc['hp'] == 25


def test_hp_loss_full_without_perk():
    doc = {'atk': 1, 'def': 1, 'spd': 1, 'hp': 30, 'maxHp': 30}
    assert db._apply_hp_loss(doc, 10) == 10
    assert doc['hp'] == 20


def test_hp_loss_floors_at_one():
    doc = {'atk': 1, 'def': 1, 'spd': 1, 'hp': 5, 'maxHp': 30}
    db._apply_hp_loss(doc, 100)
    assert doc['hp'] == 1   # hazards never compost


# ── Task 9: Last Stand ───────────────────────────────────────────────────────

def test_last_stand_survives_once_per_descent(table, monkeypatch):
    act(table, 'join', starter='pest')
    sid = _sid(table)
    doc = db._get_player(table, sid, 'user-alex')
    doc['def'] = 18   # unlock last_stand
    doc['hp'] = 20
    db._put_player(table, doc)
    doc = db._get_player(table, sid, 'user-alex')
    db._wild_battle(table, sid, doc)
    _finish_started_battle(table, monkeypatch, doc, outcome='defender', defender_hp=5)
    you = db._get_player(table, sid, 'user-alex')
    assert you['hp'] == 1               # survived the lethal blow
    assert you.get('lastStandUsed') is True
    assert not you.get('battle')        # fight is over, not composted mid-fight


def test_last_stand_not_triggered_without_perk(table, monkeypatch):
    act(table, 'join', starter='pest')  # base def 5, no last_stand
    sid = _sid(table)
    doc = db._get_player(table, sid, 'user-alex')
    db._wild_battle(table, sid, doc)
    _finish_started_battle(table, monkeypatch, doc, outcome='defender', defender_hp=5)
    you = db._get_player(table, sid, 'user-alex')
    assert not you.get('lastStandUsed')


# ── Task 10: Blink ───────────────────────────────────────────────────────────

def test_blink_lets_spd18_choose_value(table):
    act(table, 'join', starter='pest')
    sid = _sid(table)
    doc = db._get_player(table, sid, 'user-alex'); doc['spd'] = 18
    db._put_player(table, doc)
    status, resp = act(table, 'roll', blink=True, value=6)
    assert status == 200 and resp['roll']['value'] == 6 and resp['roll'].get('blink') is True


def test_blink_ignored_without_perk(table):
    act(table, 'join', starter='pest')
    sid = _sid(table)
    doc = db._get_player(table, sid, 'user-alex'); doc['spd'] = 1
    db._put_player(table, doc)
    status, resp = act(table, 'roll', blink=True, value=6)
    assert status == 200 and not resp['roll'].get('blink')


# ── Task 11: Pathfinder ──────────────────────────────────────────────────────

def test_pathfinder_rolls_two_and_unions_destinations(table, monkeypatch):
    act(table, 'join', starter='pest')
    sid = _sid(table)
    doc = db._get_player(table, sid, 'user-alex'); doc['spd'] = 12  # pathfinder
    db._put_player(table, doc)
    vals = iter([2, 5])
    monkeypatch.setattr(db._rng, 'randint', lambda a, b: next(vals))
    status, resp = act(table, 'roll')
    assert status == 200
    assert sorted(resp['roll']['values']) == [2, 5]
    pos = db._get_player(table, sid, 'user-alex')['position']
    d2 = engine.legal_destinations(data.MAP_NODES, pos, 2, set(), set())
    d5 = engine.legal_destinations(data.MAP_NODES, pos, 5, set(), set())
    assert set(resp['roll']['destinations']) == set(d2) | set(d5)


def test_no_pathfinder_single_value(table, monkeypatch):
    act(table, 'join', starter='pest')
    sid = _sid(table)
    doc = db._get_player(table, sid, 'user-alex'); doc['spd'] = 1  # no pathfinder
    db._put_player(table, doc)
    monkeypatch.setattr(db._rng, 'randint', lambda a, b: 3)
    status, resp = act(table, 'roll')
    assert 'values' not in resp['roll'] and resp['roll']['value'] == 3


# ── Task 12: Fleetfoot ───────────────────────────────────────────────────────

def test_fleetfoot_offers_optional_reroll_of_a_one(table, monkeypatch):
    act(table, 'join', starter='pest')
    sid = _sid(table)
    doc = db._get_player(table, sid, 'user-alex'); doc['spd'] = 6  # fleetfoot, no pathfinder
    db._put_player(table, doc)
    monkeypatch.setattr(db._rng, 'randint', lambda a, b: 1)
    status, resp = act(table, 'roll')
    assert resp['roll']['value'] == 1 and resp['roll'].get('canReroll') is True
    rolls_after_first = db._get_player(table, sid, 'user-alex')['rolls']
    monkeypatch.setattr(db._rng, 'randint', lambda a, b: 4)
    status, resp = act(table, 'roll', reroll=True)
    assert status == 200 and resp['roll']['value'] == 4
    # a reroll does not spend another banked roll
    assert db._get_player(table, sid, 'user-alex')['rolls'] == rolls_after_first
    assert not resp['roll'].get('canReroll')   # only one reroll offered


def test_blink_chosen_one_offers_no_reroll(table):
    # A Blink user (SPD-18, also has Fleetfoot) who deliberately picks 1 must NOT
    # be nagged to reroll it — the reroll is only for random 1s.
    act(table, 'join', starter='pest')
    sid = _sid(table)
    doc = db._get_player(table, sid, 'user-alex'); doc['spd'] = 18
    db._put_player(table, doc)
    status, resp = act(table, 'roll', blink=True, value=1)
    assert status == 200 and resp['roll']['value'] == 1
    assert not resp['roll'].get('canReroll')


def test_fleetfoot_no_reroll_without_perk(table, monkeypatch):
    act(table, 'join', starter='pest')
    sid = _sid(table)
    doc = db._get_player(table, sid, 'user-alex'); doc['spd'] = 1  # no fleetfoot
    db._put_player(table, doc)
    monkeypatch.setattr(db._rng, 'randint', lambda a, b: 1)
    status, resp = act(table, 'roll')
    assert resp['roll']['value'] == 1 and not resp['roll'].get('canReroll')


# ── Task 13: state surfaces perks ────────────────────────────────────────────

def test_state_surfaces_perks(table):
    act(table, 'join', starter='saproling', home='cavern')  # def 7 -> thick_hide
    status, state = db.handle_state(table, {'userId': 'user-alex'})
    assert status == 200
    assert 'thick_hide' in state['you']['perks']
