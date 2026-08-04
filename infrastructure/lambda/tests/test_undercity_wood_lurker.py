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
