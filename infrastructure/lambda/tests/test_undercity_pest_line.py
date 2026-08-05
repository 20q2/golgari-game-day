"""Pest-line & Grave Titan ability rework (design 2026-08-04)."""
import sys
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parents[1]))

import undercity_db as db
import undercity_data as data


def test_migrate_passives_renames_reworked_keys():
    out = db._migrate_passives(
        ['scrounger', 'flyby', 'vexing', 'undying', 'deathtouch_stomp'])
    assert out == ['scrounger', 'improvise', 'improvise', 'bog_forager', 'colossus']


def test_migrate_passives_passes_through_unknowns():
    assert db._migrate_passives(['scrounger', 'spikeshell']) == ['scrounger', 'spikeshell']
    assert db._migrate_passives(None) is None
    assert db._migrate_passives([]) == []


def test_grave_titan_spec_is_colossus():
    spec = data.APEX['grave_titan']
    assert spec['passive'] == 'colossus'
    assert spec['bonus'] == {'maxHp': 12, 'def': 4}


def test_apply_improvise_targets_lowest_stat():
    doc = {'atk': 8, 'def': 3, 'spd': 6, 'maxHp': 30,
           'passives': ['improvise'], 'buffs': []}
    db._apply_improvise(doc)
    assert {'kind': 'improvise', 'stat': 'def', 'amount': data.IMPROVISE_BONUS} in doc['buffs']


def test_apply_improvise_is_idempotent():
    doc = {'atk': 8, 'def': 3, 'spd': 6, 'maxHp': 30,
           'passives': ['improvise'], 'buffs': []}
    db._apply_improvise(doc)
    db._apply_improvise(doc)   # second call must not stack a second improvise buff
    improvise = [b for b in doc['buffs'] if b.get('kind') == 'improvise']
    assert len(improvise) == 1


def test_apply_improvise_tie_break_prefers_atk():
    doc = {'atk': 4, 'def': 4, 'spd': 9, 'maxHp': 30,
           'passives': ['improvise'], 'buffs': []}
    db._apply_improvise(doc)
    picked = [b['stat'] for b in doc['buffs'] if b.get('kind') == 'improvise']
    assert picked == ['atk']


def test_vexing_pest_spec_is_improvise():
    spec = data.TIER2['vexing_pest']
    assert spec['passive'] == 'improvise'
    assert spec['bonus'] == {'maxHp': 6, 'atk': 1, 'def': 1, 'spd': 1}
