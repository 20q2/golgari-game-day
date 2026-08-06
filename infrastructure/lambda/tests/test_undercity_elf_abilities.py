"""Elf innate abilities split (design 2026-08-05): the old single 'stonewright'
passive becomes two — Natural Enchanter (id 'stonewright', keeps Gear+/pet) and
Gift of the Fair Folk (id 'gift_of_fair_folk', the 5-start / 1-per-level stat
economy). No balance change; the numbers are identical to before the split."""
from datetime import datetime, timedelta

import undercity_db as db
import undercity_data as data
import undercity_config as config
from undercity_engine import apply_level_ups

from tests.test_undercity_db import (  # noqa: F401
    table, act, _sid, _player_at)


def test_elf_hatches_with_both_passives(table):
    act(table, 'join', starter='elf')
    sid = _sid(table)
    doc = db._get_player(table, sid, 'user-alex')
    assert doc['passives'] == ['stonewright', 'gift_of_fair_folk']
    # Gift of the Fair Folk still grants the 5 banked starting points.
    assert doc['statPoints'] == 5


def test_fair_folk_banks_one_point_per_level():
    # The slow-leveling half now keys off Gift of the Fair Folk, not Stonewright.
    p = {'level': 1, 'xp': 20, 'maxHp': 30, 'hp': 10, 'statPoints': 0,
         'passives': ['gift_of_fair_folk'], 'spentThisLevel': {}}
    assert apply_level_ups(p) == 1
    assert p['statPoints'] == 1


def test_stonewright_alone_levels_normally():
    # Natural Enchanter (id kept as 'stonewright') no longer touches the per-level
    # rate — a creature with only it banks the usual 2.
    p = {'level': 1, 'xp': 20, 'maxHp': 30, 'hp': 10, 'statPoints': 0,
         'passives': ['stonewright'], 'spentThisLevel': {}}
    assert apply_level_ups(p) == 1
    assert p['statPoints'] == 2


def test_legacy_elf_gains_gift_on_load(table):
    # A creature stored before the split (only 'stonewright') picks up the Gift
    # sibling on load, so its 1-per-level rate persists.
    act(table, 'join', starter='elf')
    sid = _sid(table)
    doc = db._get_player(table, sid, 'user-alex')
    doc['passives'] = ['stonewright']            # simulate a pre-split save
    db._put_player(table, doc)
    reloaded = db._get_player(table, sid, 'user-alex')
    assert 'stonewright' in reloaded['passives']
    assert 'gift_of_fair_folk' in reloaded['passives']


def _incubating_since(minutes_ago):
    return (datetime.utcnow() - timedelta(minutes=minutes_ago)).isoformat(timespec='seconds')


def _hatch_tier(table, egg_tier, passives):
    """Grant a tier `egg_tier` egg, incubate, force-ready, hatch — return the
    hatched pet's tier."""
    sid, doc = _player_at(table, 'n1')
    doc['passives'] = passives
    db._grant_egg(doc, egg_tier)
    egg_id = doc['eggs'][0]['id']
    db._incubate_egg(table, sid, doc, {'eggId': egg_id})
    doc = db._get_player(table, sid, 'user-alex')
    doc['incubator']['startedAt'] = _incubating_since(config.PET_INCUBATE_MINUTES + 1)
    status, _ = db._hatch_egg(table, sid, doc, {})
    assert status == 200
    return doc['pets'][-1]['tier']


def test_natural_enchanter_hatches_one_rarity_above(table):
    # Natural Enchanter (id 'stonewright'): a tier-2 egg hatches a tier-3 pet.
    assert _hatch_tier(table, 2, ['stonewright', 'gift_of_fair_folk']) == 3


def test_without_natural_enchanter_hatches_at_egg_tier(table):
    # A creature without the perk hatches at the egg's own tier.
    assert _hatch_tier(table, 2, []) == 2


def test_natural_enchanter_bump_caps_at_max_tier(table):
    # A top-rarity (tier-4) egg can't exceed the ceiling even with the perk.
    assert _hatch_tier(table, 4, ['stonewright']) == max(data.PET_HATCH)
