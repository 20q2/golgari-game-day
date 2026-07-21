"""Attribute perk tracks + Guard/DEF fix (design 2026-07-21)."""
import sys
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parents[1]))

import pytest  # noqa: E402

import undercity_data as data  # noqa: E402
import undercity_db as db  # noqa: E402
import undercity_engine as engine  # noqa: E402

from tests.test_undercity_db import act, _sid, FakeTable, _finish_started_battle  # noqa: E402,F401


def _doc(atk=1, dfn=1, spd=1):
    return {'atk': atk, 'def': dfn, 'spd': spd}


# ── Task 1: attribute_perks ──────────────────────────────────────────────────

def test_no_perks_below_first_threshold():
    assert engine.attribute_perks(_doc(4, 4, 4)) == frozenset()


def test_thresholds_unlock_in_order():
    assert engine.attribute_perks(_doc(atk=5)) == frozenset({'rend'})
    assert engine.attribute_perks(_doc(atk=10)) == frozenset({'rend', 'menace'})
    assert engine.attribute_perks(_doc(atk=15)) == frozenset({'rend', 'menace', 'deathdrive'})


def test_base_stat_lights_tier1_across_tracks():
    assert 'thick_hide' in engine.attribute_perks(_doc(dfn=7))
    assert 'rend' in engine.attribute_perks(_doc(atk=8))
    assert 'fleetfoot' in engine.attribute_perks(_doc(spd=7))


def test_all_three_tracks_independent():
    perks = engine.attribute_perks(_doc(atk=10, dfn=15, spd=5))
    assert perks == frozenset({'rend', 'menace', 'thick_hide', 'carapace_grind',
                               'last_stand', 'fleetfoot'})


# ── Task 2: Combatant carries perks ──────────────────────────────────────────

def test_combatant_carries_perks_and_survives_serde():
    doc = {'username': 'x', 'hp': 30, 'maxHp': 30, 'atk': 15, 'def': 5, 'spd': 5,
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
