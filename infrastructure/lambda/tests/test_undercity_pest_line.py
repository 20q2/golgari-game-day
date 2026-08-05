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
