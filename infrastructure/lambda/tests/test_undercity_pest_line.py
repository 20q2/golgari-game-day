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


def test_bog_forager_scrounges_bigger_consolation():
    rec = {'kind': 'wild', 'npcMeta': {'bounty': 20}}
    plain = {'passives': ['scrounger'], 'spores': 0}
    bog = {'passives': ['scrounger', 'bog_forager'], 'spores': 0}
    db._scrounge_consolation(plain, rec)
    db._scrounge_consolation(bog, rec)
    assert plain['spores'] == round(20 * data.SCROUNGER_LOSS_FRACTION)   # 6
    assert bog['spores'] == round(20 * data.BOG_FORAGER_LOSS_FRACTION)   # 10
    assert bog['spores'] > plain['spores']


def test_bog_forager_rerolls_mystery_like_drift(monkeypatch):
    # With an all-falsy roll and _season_map stubbed, _mystery never touches the
    # table — so no fixture is needed. We only assert the reroll flag is set True
    # for a bog forager (same channel as Drift).
    captured = {}

    def fake_roll(rng, has_drift, has_doubling_rot, biome=None):
        captured['has_drift'] = has_drift
        return {'roll': 5, 'spores': 0, 'xp': 0, 'hpPct': 0, 'item': None,
                'heal': False, 'buff': None, 'teleport': False, 'curse': False,
                'text': 'nothing'}

    monkeypatch.setattr(db.engine, 'roll_mystery', fake_roll)
    monkeypatch.setattr(db, '_season_map', lambda t, s: {})
    doc = {'userId': 'u1', 'username': 'x', 'position': 'n1', 'hp': 20,
           'atk': 5, 'def': 5, 'spd': 5, 'maxHp': 25,
           'passives': ['scrounger', 'bog_forager'], 'spores': 0, 'buffs': []}
    db._mystery(None, 'season', doc)
    assert captured['has_drift'] is True


def test_brackish_trudge_spec_is_bog_forager():
    spec = data.TIER2['brackish_trudge']
    assert spec['passive'] == 'bog_forager'
