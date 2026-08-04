"""Wood Lurker: Mimicry (mirror the foe's fighting style at battle start)."""
import undercity_data as data
import undercity_db as db
import undercity_engine as engine

from tests.test_undercity_db import (  # noqa: F401
    table, act, _sid, _player_at)


def _doc(**kw):
    # Player docs use 'def' (not 'dfn'); build via a literal since def is a keyword.
    base = {'atk': 5, 'def': 5, 'spd': 5, 'maxHp': 25, 'hp': 25,
            'gear': {}, 'buffs': [], 'passives': ['stonewright', 'mimicry']}
    base.update(kw)
    return base


def test_config_scalars_defined():
    assert data.MIMIC_MIRROR == 3
    assert data.MIMIC_BALANCED == 1


def test_effective_stats_reads_mimic_buff():
    d = _doc(buffs=[{'kind': 'mimic', 'stat': 'atk', 'amount': data.MIMIC_MIRROR}])
    assert engine.effective_stats(d)['atk'] == 5 + data.MIMIC_MIRROR


def test_apply_mimicry_by_personality():
    for personality, stat in (('brute', 'atk'), ('turtle', 'def'), ('trickster', 'spd')):
        d = _doc()
        db._apply_mimicry(d, {'personality': personality})
        assert {'kind': 'mimic', 'stat': stat, 'amount': data.MIMIC_MIRROR} in d['buffs']
        assert engine.effective_stats(d)[stat] == 5 + data.MIMIC_MIRROR


def test_apply_mimicry_balanced_boosts_all():
    d = _doc()
    db._apply_mimicry(d, {'personality': 'balanced'})
    eff = engine.effective_stats(d)
    assert eff['atk'] == 5 + data.MIMIC_BALANCED
    assert eff['def'] == 5 + data.MIMIC_BALANCED
    assert eff['spd'] == 5 + data.MIMIC_BALANCED


def test_apply_mimicry_is_idempotent():
    d = _doc()
    db._apply_mimicry(d, {'personality': 'brute'})
    db._apply_mimicry(d, {'personality': 'turtle'})   # re-entry replaces, never stacks
    mimic = [b for b in d['buffs'] if b['kind'] == 'mimic']
    assert mimic == [{'kind': 'mimic', 'stat': 'def', 'amount': data.MIMIC_MIRROR}]


def test_mimic_is_a_one_battle_buff():
    assert 'mimic' in db.ONE_BATTLE_BUFFS


def test_start_battle_applies_mimicry(table):
    act(table, 'join', starter='elf')
    sid = _sid(table)
    doc = db._get_player(table, sid, 'user-alex')
    doc['passives'] = ['stonewright', 'mimicry']
    ev = db._wild_battle(table, sid, doc, region='cavern')
    assert ev['type'] == 'battle_start'
    # The hook applied a mimic buff to the doc, matching whatever wild was drawn.
    assert any(b.get('kind') == 'mimic' for b in (doc.get('buffs') or []))
