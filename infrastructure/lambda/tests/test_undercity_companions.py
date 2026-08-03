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


def _incubating_since(minutes_ago):
    return (datetime.utcnow() - timedelta(minutes=minutes_ago)).isoformat(timespec='seconds')


def test_grant_incubate_hatch_flow(table):
    sid, doc = _player_at(table, 'n1')
    db._grant_egg(doc, 2)
    assert len(doc['eggs']) == 1 and doc['eggs'][0]['tier'] == 2
    egg_id = doc['eggs'][0]['id']

    status, body = db._incubate_egg(table, sid, doc, {'eggId': egg_id})
    assert status == 200
    assert doc['eggs'] == []
    assert doc['incubator']['eggId'] == egg_id

    # Re-fetch for a fresh optimistic-lock version (one save per request; the
    # client refetches between actions — mirrors test_undercity_market).
    doc = db._get_player(table, sid, 'user-alex')
    status, _ = db._hatch_egg(table, sid, doc, {})
    assert status == 429

    doc['incubator']['startedAt'] = _incubating_since(config.PET_INCUBATE_MINUTES + 1)
    status, body = db._hatch_egg(table, sid, doc, {})
    assert status == 200
    assert doc['incubator'] is None
    assert len(doc['pets']) == 1
    pet = doc['pets'][0]
    assert pet['species'] in data.PET_SPECIES
    assert pet['tier'] == 2 and pet['level'] == 1 and pet['mergeProgress'] == 0
    assert body['you']['pets'][0]['id'] == pet['id']


def test_incubate_rejects_when_slot_busy(table):
    sid, doc = _player_at(table, 'n1')
    db._grant_egg(doc, 1); db._grant_egg(doc, 1)
    first = doc['eggs'][0]['id']; second = doc['eggs'][1]['id']
    db._incubate_egg(table, sid, doc, {'eggId': first})
    status, _ = db._incubate_egg(table, sid, doc, {'eggId': second})
    assert status == 409


def _give_pet(doc, species='fox', tier=1, level=1):
    pet = {'id': db._new_id('pet-'), 'species': species, 'tier': tier,
           'level': level, 'mergeProgress': 0}
    doc.setdefault('pets', []).append(pet)
    return pet


def test_activate_pet(table):
    sid, doc = _player_at(table, 'n1')
    pet = _give_pet(doc, 'turtle')
    status, body = db._activate_pet(table, sid, doc, {'petId': pet['id']})
    assert status == 200
    assert doc['activePetId'] == pet['id']
    # Unknown pet is rejected (fresh refetch to avoid a stale-ver false 409).
    doc = db._get_player(table, sid, 'user-alex')
    status, _ = db._activate_pet(table, sid, doc, {'petId': 'nope'})
    assert status == 409


def test_merge_same_species_ranks_up(table):
    sid, doc = _player_at(table, 'n1')
    keeper = _give_pet(doc, 'fox', tier=1)
    f1 = _give_pet(doc, 'fox', tier=1)
    f2 = _give_pet(doc, 'fox', tier=1)
    status, body = db._merge_pet(table, sid, doc, {
        'targetPetId': keeper['id'], 'fodderPetIds': [f1['id'], f2['id']]})
    assert status == 200
    assert keeper['tier'] == 2
    assert keeper['mergeProgress'] == 0
    assert [p['id'] for p in doc['pets']] == [keeper['id']]


def test_merge_rejects_cross_species(table):
    sid, doc = _player_at(table, 'n1')
    keeper = _give_pet(doc, 'fox')
    fodder = _give_pet(doc, 'turtle')
    status, _ = db._merge_pet(table, sid, doc, {
        'targetPetId': keeper['id'], 'fodderPetIds': [fodder['id']]})
    assert status == 409
    assert len(doc['pets']) == 2


def test_merge_partial_progress_carries(table):
    sid, doc = _player_at(table, 'n1')
    keeper = _give_pet(doc, 'fox', tier=1)
    f1 = _give_pet(doc, 'fox', tier=1)
    status, _ = db._merge_pet(table, sid, doc, {
        'targetPetId': keeper['id'], 'fodderPetIds': [f1['id']]})
    assert status == 200
    assert keeper['tier'] == 1 and keeper['mergeProgress'] == 1


def test_level_pet_spends_materials(table):
    sid, doc = _player_at(table, 'n1')
    pet = _give_pet(doc, 'fox', tier=1, level=1)   # tier-1 level cost: 2 moltings
    doc['materials'] = {'moltings': 5, 'ichor': 0}
    status, body = db._level_pet(table, sid, doc, {'petId': pet['id']})
    assert status == 200
    assert pet['level'] == 2
    assert doc['materials']['moltings'] == 3


def test_level_pet_rejects_when_short(table):
    sid, doc = _player_at(table, 'n1')
    pet = _give_pet(doc, 'fox', tier=1, level=1)
    doc['materials'] = {'moltings': 0, 'ichor': 0}
    status, _ = db._level_pet(table, sid, doc, {'petId': pet['id']})
    assert status == 402
    assert pet['level'] == 1


def test_level_pet_rejects_at_cap(table):
    sid, doc = _player_at(table, 'n1')
    pet = _give_pet(doc, 'fox', tier=1, level=data.PET_LEVEL_CAP[1])
    doc['materials'] = {'moltings': 99, 'ichor': 99}
    status, _ = db._level_pet(table, sid, doc, {'petId': pet['id']})
    assert status == 409
    assert pet['level'] == data.PET_LEVEL_CAP[1]


def test_salvage_low_tier_gives_moltings(table):
    sid, doc = _player_at(table, 'n1')
    pet = _give_pet(doc, 'fox', tier=1, level=1)   # base 1 molting, no ichor
    doc['materials'] = {'moltings': 0, 'ichor': 0}
    status, body = db._salvage_pet(table, sid, doc, {'petId': pet['id']})
    assert status == 200
    assert doc['materials']['moltings'] == 1
    assert doc['materials']['ichor'] == 0
    assert doc['pets'] == []


def test_salvage_high_tier_gives_ichor_and_scales_with_level(table):
    sid, doc = _player_at(table, 'n1')
    pet = _give_pet(doc, 'fox', tier=3, level=3)   # base 4 + (level-1)=2 -> 6 moltings, +1 ichor
    doc['materials'] = {'moltings': 0, 'ichor': 0}
    status, _ = db._salvage_pet(table, sid, doc, {'petId': pet['id']})
    assert status == 200
    assert doc['materials']['moltings'] == 6
    assert doc['materials']['ichor'] == 1


def test_salvage_clears_active_pointer(table):
    sid, doc = _player_at(table, 'n1')
    pet = _give_pet(doc, 'fox')
    doc['activePetId'] = pet['id']
    db._salvage_pet(table, sid, doc, {'petId': pet['id']})
    assert doc['activePetId'] is None


def test_actions_routed_through_dispatch(table):
    _player_at(table, 'n1')   # ensures a season + a joined player 'user-alex'
    doc = db._get_player(table, _sid(table), 'user-alex')
    db._grant_egg(doc, 1)
    db._save_or_conflict(table, doc)
    egg_id = doc['eggs'][0]['id']
    status, body = act(table, 'incubate-egg', eggId=egg_id)
    assert status == 200
    assert body['you']['incubator']['eggId'] == egg_id

    status, body = act(table, 'activate-pet', petId='nope')
    assert status == 409


# ── Plan 2: egg drops from play ──────────────────────────────────────────────

class _SeqRng:
    """Deterministic rng: random() replays a script, then returns 0.99."""
    def __init__(self, randoms=None):
        self.randoms = list(randoms or [])
    def random(self):
        return self.randoms.pop(0) if self.randoms else 0.99


def test_maybe_drop_egg_drops_on_low_roll(table):
    sid, doc = _player_at(table, 'n1')
    # chance for 'loot' is EGG_DROP['loot'][0]; a roll below it drops an egg.
    chance = data.EGG_DROP['loot'][0]
    rng = _SeqRng([chance - 0.001, 0.0])   # 1st: pass gate, 2nd: pick tier
    egg = db._maybe_drop_egg(doc, 'loot', rng)
    assert egg is not None
    assert doc['eggs'] and doc['eggs'][0]['id'] == egg['id']
    assert egg['tier'] in data.EGG_DROP['loot'][1]


def test_maybe_drop_egg_noop_on_high_roll(table):
    sid, doc = _player_at(table, 'n1')
    rng = _SeqRng([0.999])
    egg = db._maybe_drop_egg(doc, 'loot', rng)
    assert egg is None
    assert doc['eggs'] == []


def test_maybe_drop_egg_unknown_source_noop(table):
    sid, doc = _player_at(table, 'n1')
    assert db._maybe_drop_egg(doc, 'nope', _SeqRng([0.0])) is None


def test_mystery_can_drop_egg(table, monkeypatch):
    sid, doc = _player_at(table, 'n1')
    # Force the mystery egg roll to always succeed, tier 1.
    monkeypatch.setitem(db.data.EGG_DROP, 'mystery', (1.0, {1: 1.0}))
    before = len(doc.get('eggs') or [])
    db._mystery(table, sid, doc)
    assert len(doc['eggs']) == before + 1
    assert doc['eggs'][-1]['tier'] == 1
