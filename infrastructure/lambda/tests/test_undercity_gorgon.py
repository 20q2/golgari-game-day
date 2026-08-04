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


def test_gorgon_starts_with_five_banked_points(table):
    act(table, 'join', starter='gorgon')
    sid = _sid(table)
    doc = db._get_player(table, sid, 'user-alex')
    assert doc['species'] == 'gorgon'
    assert 'stonewright' in doc['passives']
    assert doc['statPoints'] == 5


def test_non_gorgon_starts_with_zero_points(table):
    act(table, 'join', starter='pest')
    sid = _sid(table)
    doc = db._get_player(table, sid, 'user-alex')
    assert doc['statPoints'] == 0


def test_gear_plus_variants_generated():
    base = 'bramble_hide'                 # tier-1 rider gear (primary stat: def)
    pid = base + '+'
    assert pid in data.GEAR
    assert data.GEAR[pid]['plus'] is True
    assert data.GEAR[pid]['name'] == data.GEAR[base]['name'] + ' +'
    assert data.GEAR[pid]['def'] == data.GEAR[base]['def'] + data.GEAR_PLUS_BUMP
    assert data.GEAR[pid]['tier'] == data.GEAR[base]['tier']
    assert data.GEAR[pid]['rider'] == data.GEAR[base]['rider']


def test_gear_plus_mythic_bump_is_larger():
    mythic = data.GEAR_FAMILY['bramble'][4]
    assert data.GEAR[mythic + '+']['def'] == data.GEAR[mythic]['def'] + data.GEAR_PLUS_MYTHIC_BUMP


def test_gear_family_never_contains_plus_ids():
    # "+" is a within-tier bonus, not an upgrade rung — it must not leak into the path.
    for rider, tiers in data.GEAR_FAMILY.items():
        for tier, gid in tiers.items():
            assert not gid.endswith('+')
