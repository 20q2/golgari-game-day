import sys, os
from datetime import datetime, timedelta

sys.path.insert(0, os.path.join(os.path.dirname(__file__), '..'))

import undercity_db as db
import undercity_data as data
import undercity_config as config
# Shared harness (fixtures + helpers) from the DB test module.
from test_undercity_db import table, act, _player_at, _sid  # noqa: F401


def test_pet_tables_wellformed():
    # Five species, each with a name/kind/blurb.
    assert set(data.PET_SPECIES) == {'fox', 'turtle', 'bird', 'mouse', 'grub'}
    for sp in data.PET_SPECIES.values():
        assert sp['kind'] in ('combat-passive', 'activated', 'economy')
        assert sp['name'] and sp['blurb']
    # Progression tables cover the four rarity tiers.
    assert set(data.PET_LEVEL_CAP) == {1, 2, 3, 4}
    assert data.PET_MERGE_COST.keys() == {2, 3, 4}       # cost to REACH tier 2/3/4
    assert config.PET_INCUBATE_MINUTES == 15


def test_new_player_has_empty_companion_state(table):
    sid, doc = _player_at(table, 'n1')
    assert doc['pets'] == []
    assert doc['eggs'] == []
    assert doc['incubator'] is None
    assert doc['activePetId'] is None
    assert doc['petCooldowns'] == {}


def test_pet_helpers(table):
    sid, doc = _player_at(table, 'n1')
    pid = db._new_id('pet-')
    assert pid.startswith('pet-') and len(pid) > 4
    pet = {'id': pid, 'species': 'fox', 'tier': 1, 'level': 1, 'mergeProgress': 0}
    doc['pets'] = [pet]
    assert db._find_pet(doc, pid) is pet
    assert db._find_pet(doc, 'missing') is None
