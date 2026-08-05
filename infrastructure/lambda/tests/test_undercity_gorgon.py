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
    g = data.STARTERS['elf']
    assert g['passive'] == 'stonewright'
    assert (g['hp'], g['atk'], g['def'], g['spd']) == (25, 6, 6, 4)


def test_gorgon_evolution_line():
    assert set(data.tier2_options('elf')) == {'gorgon', 'wood_lurker'}
    # Each elf tier-2 form has two apex options grafted onto existing apexes.
    assert 'grave_titan' in data.apex_options('wood_lurker')
    assert 'golgari_lich_lord' in data.apex_options('wood_lurker')
    assert 'swamp_dragon' in data.apex_options('gorgon')
    assert 'daemogoth' in data.apex_options('gorgon')


def test_gorgon_starts_with_five_banked_points(table):
    act(table, 'join', starter='elf')
    sid = _sid(table)
    doc = db._get_player(table, sid, 'user-alex')
    assert doc['species'] == 'elf'
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


def test_gorgon_upgrade_mints_plus(table):
    sid, doc = _player_at(table, 'city_r0', spores=100)
    doc['passives'] = ['stonewright']                    # act as a Gorgon
    doc['gear'] = {'carapace': 'bramble_hide'}           # tier-1 bramble
    doc['materials'] = {'moltings': 10, 'ichor': 0}
    status, _ = db._upgrade_gear(
        table, sid, doc, {'target': {'where': 'equipped', 'slot': 'carapace'}})
    assert status == 200
    base_next = data.GEAR_FAMILY['bramble'][2]
    assert doc['gear']['carapace'] == base_next + '+'
    got = data.GEAR[doc['gear']['carapace']]
    assert got['plus'] is True
    assert got['def'] == data.GEAR[base_next]['def'] + data.GEAR_PLUS_BUMP


def test_non_gorgon_upgrade_stays_plain(table):
    sid, doc = _player_at(table, 'city_r0', spores=100)   # joined as pest (no stonewright)
    doc['gear'] = {'carapace': 'bramble_hide'}
    doc['materials'] = {'moltings': 10, 'ichor': 0}
    status, _ = db._upgrade_gear(
        table, sid, doc, {'target': {'where': 'equipped', 'slot': 'carapace'}})
    assert status == 200
    assert doc['gear']['carapace'] == data.GEAR_FAMILY['bramble'][2]   # no "+"


def test_plus_stamp_survives_non_gorgon_upgrade(table):
    sid, doc = _player_at(table, 'city_r0', spores=100)   # a pest, not a Gorgon
    doc['gear'] = {'carapace': data.GEAR_FAMILY['bramble'][2] + '+'}   # a forged tier-2+
    doc['materials'] = {'moltings': 10, 'ichor': data.UPGRADE_ICHOR[3]}
    status, _ = db._upgrade_gear(
        table, sid, doc, {'target': {'where': 'equipped', 'slot': 'carapace'}})
    assert status == 200
    assert doc['gear']['carapace'] == data.GEAR_FAMILY['bramble'][3] + '+'  # "+" preserved


def test_plus_gear_resolves_name_and_cost():
    # Market/name lookups (data.GEAR[i]['name'/'cost']) must resolve "+" ids.
    pid = data.GEAR_FAMILY['bramble'][2] + '+'
    assert data.GEAR[pid]['name'].endswith(' +')
    assert isinstance(data.GEAR[pid]['cost'], int)


def test_plus_gear_contributes_stats_when_equipped():
    import undercity_engine as engine
    base = data.GEAR_FAMILY['bramble'][2]
    plain = {'gear': {'carapace': base}, 'atk': 5, 'def': 5, 'spd': 5, 'maxHp': 25}
    forged = {'gear': {'carapace': base + '+'}, 'atk': 5, 'def': 5, 'spd': 5, 'maxHp': 25}
    assert engine.effective_stats(forged)['def'] == engine.effective_stats(plain)['def'] + data.GEAR_PLUS_BUMP
