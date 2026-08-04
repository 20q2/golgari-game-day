"""Gorgon ("Stonewright") species: start bonus, slow leveling, Gear+ minting."""
import undercity_data as data
import undercity_db as db

from tests.test_undercity_db import (  # noqa: F401
    table, act, _sid, _player_at)


def test_gorgon_scalars_defined():
    assert data.GORGON_START_POINTS == 5
    assert data.GORGON_STAT_POINTS_PER_LEVEL == 1
    assert data.GORGON_PET_LEVEL_BONUS == 1


def test_gorgon_starter_defined():
    g = data.STARTERS['gorgon']
    assert g['passive'] == 'stonewright'
    assert (g['hp'], g['atk'], g['def'], g['spd']) == (25, 6, 6, 4)


def test_gorgon_evolution_line():
    assert set(data.tier2_options('gorgon')) == {'basalt_matron', 'medusa_stalker'}
    # Each gorgon tier-2 form has two apex options grafted onto existing apexes.
    assert 'grave_titan' in data.apex_options('basalt_matron')
    assert 'golgari_lich_lord' in data.apex_options('basalt_matron')
    assert 'swamp_dragon' in data.apex_options('medusa_stalker')
    assert 'izoni' in data.apex_options('medusa_stalker')
