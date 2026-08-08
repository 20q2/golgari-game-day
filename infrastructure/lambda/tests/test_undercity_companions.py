import sys, os
from datetime import datetime, timedelta

sys.path.insert(0, os.path.join(os.path.dirname(__file__), '..'))

import undercity_db as db
import undercity_data as data
import undercity_config as config
# Shared harness (fixtures + helpers) from the DB test module.
from test_undercity_db import table, act, _player_at, _sid  # noqa: F401


def test_pet_tables_wellformed():
    # Ten species across five roles (two per role), each with name/role/kind/blurb.
    assert len(data.PET_SPECIES) == 10
    assert {sp['role'] for sp in data.PET_SPECIES.values()} == {
        'attack', 'defend', 'forage', 'scout', 'economy'}
    for sp in data.PET_SPECIES.values():
        assert sp['kind'] in ('combat-passive', 'activated', 'economy')
        assert sp['name'] and sp['blurb'] and sp['role']
    # Progression tables cover the four rarity tiers.
    assert set(data.PET_LEVEL_CAP) == {1, 2, 3, 4}
    assert data.PET_MERGE_COST.keys() == {2, 3, 4}       # cost to REACH tier 2/3/4
    assert config.PET_INCUBATE_MINUTES == 5


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
    pet = {'id': pid, 'species': 'baby_leyline_prowler', 'tier': 1, 'level': 1, 'mergeProgress': 0}
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


def _give_pet(doc, species='baby_leyline_prowler', tier=1, level=1):
    pet = {'id': db._new_id('pet-'), 'species': species, 'tier': tier,
           'level': level, 'mergeProgress': 0}
    doc.setdefault('pets', []).append(pet)
    return pet


def test_activate_pet(table):
    sid, doc = _player_at(table, 'n1')
    pet = _give_pet(doc, 'decimator_beetle')
    status, body = db._activate_pet(table, sid, doc, {'petId': pet['id']})
    assert status == 200
    assert doc['activePetId'] == pet['id']
    # Unknown pet is rejected (fresh refetch to avoid a stale-ver false 409).
    doc = db._get_player(table, sid, 'user-alex')
    status, _ = db._activate_pet(table, sid, doc, {'petId': 'nope'})
    assert status == 409


def test_merge_same_species_ranks_up(table):
    sid, doc = _player_at(table, 'n1')
    keeper = _give_pet(doc, 'baby_leyline_prowler', tier=1)
    f1 = _give_pet(doc, 'baby_leyline_prowler', tier=1)
    f2 = _give_pet(doc, 'baby_leyline_prowler', tier=1)
    status, body = db._merge_pet(table, sid, doc, {
        'targetPetId': keeper['id'], 'fodderPetIds': [f1['id'], f2['id']]})
    assert status == 200
    assert keeper['tier'] == 2
    assert keeper['mergeProgress'] == 2          # 2 same-species Commons = 4 pts − 2 (into Rare); T3 costs 3
    assert [p['id'] for p in doc['pets']] == [keeper['id']]


def test_merge_cross_species_ranks_up(table):
    sid, doc = _player_at(table, 'n1')
    keeper = _give_pet(doc, 'baby_leyline_prowler', tier=1)   # attack role
    f1 = _give_pet(doc, 'decimator_beetle', tier=1)           # defend — different species
    f2 = _give_pet(doc, 'rat', tier=1)                        # forage — different species
    status, _ = db._merge_pet(table, sid, doc, {
        'targetPetId': keeper['id'], 'fodderPetIds': [f1['id'], f2['id']]})
    assert status == 200
    assert keeper['tier'] == 2                               # 1+1 pts >= cost-to-T2 (2)
    assert keeper['species'] == 'baby_leyline_prowler'       # identity unchanged
    assert [p['id'] for p in doc['pets']] == [keeper['id']]


def test_merge_consuming_active_pet_clears_pointer(table):
    sid, doc = _player_at(table, 'n1')
    keeper = _give_pet(doc, 'baby_leyline_prowler', tier=1)
    fodder = _give_pet(doc, 'slime', tier=1)
    doc['activePetId'] = fodder['id']
    status, _ = db._merge_pet(table, sid, doc, {
        'targetPetId': keeper['id'], 'fodderPetIds': [fodder['id']]})
    assert status == 200
    assert doc['activePetId'] is None
    assert [p['id'] for p in doc['pets']] == [keeper['id']]


def test_merge_keeper_survives_as_active(table):
    sid, doc = _player_at(table, 'n1')
    keeper = _give_pet(doc, 'baby_leyline_prowler', tier=1)
    fodder = _give_pet(doc, 'slime', tier=1)
    doc['activePetId'] = keeper['id']
    status, _ = db._merge_pet(table, sid, doc, {
        'targetPetId': keeper['id'], 'fodderPetIds': [fodder['id']]})
    assert status == 200
    assert doc['activePetId'] == keeper['id']


def test_merge_partial_progress_carries(table):
    sid, doc = _player_at(table, 'n1')
    keeper = _give_pet(doc, 'baby_leyline_prowler', tier=1)
    f1 = _give_pet(doc, 'decimator_beetle', tier=1)   # off-species = 1 flat pt (no bonus)
    status, _ = db._merge_pet(table, sid, doc, {
        'targetPetId': keeper['id'], 'fodderPetIds': [f1['id']]})
    assert status == 200
    assert keeper['tier'] == 1 and keeper['mergeProgress'] == 1


def test_merge_same_species_bonus_points(table):
    # Same-species Common fodder = ceil(1*1.5) = 2 pts -> ranks a Common keeper
    # straight into Rare (cost to T2 is 2).
    sid, doc = _player_at(table, 'n1')
    k = _give_pet(doc, 'baby_leyline_prowler', tier=1)
    f = _give_pet(doc, 'baby_leyline_prowler', tier=1)
    status, _ = db._merge_pet(table, sid, doc, {'targetPetId': k['id'], 'fodderPetIds': [f['id']]})
    assert status == 200 and k['tier'] == 2 and k['mergeProgress'] == 0


def test_merge_offspecies_no_bonus(table):
    # Different-species Common fodder = 1 pt -> not enough to reach Rare (cost 2).
    sid, doc = _player_at(table, 'n1')
    k = _give_pet(doc, 'baby_leyline_prowler', tier=1)
    f = _give_pet(doc, 'decimator_beetle', tier=1)
    status, _ = db._merge_pet(table, sid, doc, {'targetPetId': k['id'], 'fodderPetIds': [f['id']]})
    assert status == 200 and k['tier'] == 1 and k['mergeProgress'] == 1


def test_level_pet_spends_materials(table):
    sid, doc = _player_at(table, 'n1')
    pet = _give_pet(doc, 'baby_leyline_prowler', tier=1, level=1)   # tier-1 level cost: 2 moltings
    doc['materials'] = {'moltings': 5, 'ichor': 0}
    status, body = db._level_pet(table, sid, doc, {'petId': pet['id']})
    assert status == 200
    assert pet['level'] == 2
    assert doc['materials']['moltings'] == 3


def test_level_pet_rejects_when_short(table):
    sid, doc = _player_at(table, 'n1')
    pet = _give_pet(doc, 'baby_leyline_prowler', tier=1, level=1)
    doc['materials'] = {'moltings': 0, 'ichor': 0}
    status, _ = db._level_pet(table, sid, doc, {'petId': pet['id']})
    assert status == 402
    assert pet['level'] == 1


def test_level_pet_rejects_at_cap(table):
    sid, doc = _player_at(table, 'n1')
    pet = _give_pet(doc, 'baby_leyline_prowler', tier=1, level=data.PET_LEVEL_CAP[1])
    doc['materials'] = {'moltings': 99, 'ichor': 99}
    status, _ = db._level_pet(table, sid, doc, {'petId': pet['id']})
    assert status == 409
    assert pet['level'] == data.PET_LEVEL_CAP[1]


def test_salvage_low_tier_gives_moltings(table):
    sid, doc = _player_at(table, 'n1')
    pet = _give_pet(doc, 'baby_leyline_prowler', tier=1, level=1)   # base 1 molting, no ichor
    doc['materials'] = {'moltings': 0, 'ichor': 0}
    status, body = db._salvage_pet(table, sid, doc, {'petId': pet['id']})
    assert status == 200
    assert doc['materials']['moltings'] == 1
    assert doc['materials']['ichor'] == 0
    assert doc['pets'] == []


def test_salvage_high_tier_gives_ichor_and_scales_with_level(table):
    sid, doc = _player_at(table, 'n1')
    pet = _give_pet(doc, 'baby_leyline_prowler', tier=3, level=3)   # base 4 + (level-1)=2 -> 6 moltings, +1 ichor
    doc['materials'] = {'moltings': 0, 'ichor': 0}
    status, _ = db._salvage_pet(table, sid, doc, {'petId': pet['id']})
    assert status == 200
    assert doc['materials']['moltings'] == 6
    assert doc['materials']['ichor'] == 1


def test_salvage_clears_active_pointer(table):
    sid, doc = _player_at(table, 'n1')
    pet = _give_pet(doc, 'baby_leyline_prowler')
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


# ── Plan 2: active-pet combat fields on the Combatant ────────────────────────

def test_active_combat_pet_flows_into_combatant(table):
    sid, doc = _player_at(table, 'n1')
    pet = _give_pet(doc, 'baby_leyline_prowler', tier=1, level=1)
    doc['activePetId'] = pet['id']
    c = db._combatant(doc)
    assert c.pet_followup_chance > 0
    assert c.pet_deflect_chance == 0
    # No active pet -> zeros.
    doc['activePetId'] = None
    assert db._combatant(doc).pet_followup_chance == 0


def test_pet_fields_survive_snapshot_roundtrip(table):
    sid, doc = _player_at(table, 'n1')
    pet = _give_pet(doc, 'decimator_beetle', tier=1, level=2)
    doc['activePetId'] = pet['id']
    c = db._combatant(doc)
    restored = db._bt_to_combatant(db._bt_snapshot(c))
    assert restored.pet_deflect_chance == c.pet_deflect_chance
    assert restored.pet_deflect_flat == c.pet_deflect_flat


# ── Plan 3: activated abilities (Bird/Mouse) + cooldowns + Grub trickle ───────

def _persist_active_pet(table, species, level=1):
    """Join a player, give+activate a pet of `species`, persist, return (sid, doc)."""
    _player_at(table, 'n1')
    sid = _sid(table)
    doc = db._get_player(table, sid, 'user-alex')
    pet = _give_pet(doc, species, tier=1, level=level)
    doc['activePetId'] = pet['id']
    db._save_or_conflict(table, doc)
    # Refetch so the returned doc's optimistic-lock ver matches storage (callers
    # that save again directly would otherwise hit a false 409).
    return sid, db._get_player(table, sid, 'user-alex')


def test_pet_ability_cooldown_shortens_with_level():
    # Scout still uses the real-time cooldown (forage now recharges by distance).
    # Cooldowns are keyed by ROLE, not species.
    lo = db._pet_ability_cooldown_min('scout', 1)
    hi = db._pet_ability_cooldown_min('scout', 4)
    assert lo == config.PET_ABILITY_COOLDOWN_MIN['scout']
    assert hi < lo
    # Never faster than the floor.
    assert db._pet_ability_cooldown_min('scout', 99) == config.PET_ABILITY_COOLDOWN_FLOOR


def test_economy_per_loot_scales_and_cap_climbs():
    # Per-loot yield and the bank cap both climb with the pet's level.
    assert db._economy_per_loot(1) == config.PET_SPORE_PER_LOOT_BASE
    assert db._economy_per_loot(3) > db._economy_per_loot(1)
    assert db._economy_spore_cap(3) > db._economy_spore_cap(1)


# A legal 2-hop walk whose INTERIOR node is a loot space: fog -> loot -> fog.
# (Derived from the live map graph; endpoints are benign so nothing else fires.)
_LOOT_PASS = ('n257', 'n258', 'n259')


def _prime_walk(table, sid, start):
    """Put user-alex on `start` with a 2-step pending move ready to commit."""
    doc = db._get_player(table, sid, 'user-alex')
    doc['position'] = start
    doc['pendingMove'] = {'value': 2, 'dests': [_LOOT_PASS[2]]}
    db._save_or_conflict(table, doc)


def test_economy_pet_banks_spores_passing_over_loot(table):
    start, loot, end = _LOOT_PASS
    assert data.MAP_NODES[loot]['type'] == 'loot'   # guard the fixture path
    sid, _ = _persist_active_pet(table, 'baby_broodspinner', level=2)   # economy role
    _prime_walk(table, sid, start)
    status, resp = act(table, 'move', to=end, path=list(_LOOT_PASS))
    assert status == 200, resp
    assert resp['scavenge'] == {
        'spores': db._economy_per_loot(2), 'bank': db._economy_per_loot(2), 'nodes': [loot]}
    doc = db._get_player(table, sid, 'user-alex')
    assert doc['petSporeBank'] == db._economy_per_loot(2)


def test_non_economy_pet_does_not_bank(table):
    start, _loot, end = _LOOT_PASS
    sid, _ = _persist_active_pet(table, 'baby_leyline_prowler')   # attack role, not economy
    _prime_walk(table, sid, start)
    status, resp = act(table, 'move', to=end, path=list(_LOOT_PASS))
    assert status == 200, resp
    assert resp['scavenge'] is None
    doc = db._get_player(table, sid, 'user-alex')
    assert 'petSporeBank' not in doc
    # Moving without ever having used forage doesn't spawn a recharge counter.
    assert 'forageRecharge' not in doc


def test_use_pet_ability_rejects_combat_pet(table):
    # A combat-passive pet has no tap ability at all.
    _persist_active_pet(table, 'baby_leyline_prowler')   # active, but combat-passive
    status, body = act(table, 'use-pet-ability')
    assert status == 409


def test_economy_redeem_pays_out_bank_and_resets(table):
    sid, doc = _persist_active_pet(table, 'baby_broodspinner', level=2)   # economy role
    doc['petSporeBank'] = 24
    doc['spores'] = 5
    db._save_or_conflict(table, doc)
    status, body = act(table, 'use-pet-ability')
    assert status == 200
    assert body['petAbility']['kind'] == 'economy'
    assert body['petAbility']['spores'] == 24
    doc = db._get_player(table, sid, 'user-alex')
    assert doc['spores'] == 5 + 24
    assert doc['petSporeBank'] == 0
    # Bank drained -> collecting again immediately yields nothing.
    status, _ = act(table, 'use-pet-ability')
    assert status == 409


def test_economy_redeem_rejects_when_bank_empty(table):
    sid, doc = _persist_active_pet(table, 'slime', level=1)   # economy role, bank untouched
    status, body = act(table, 'use-pet-ability')
    assert status == 409


# Dispatch directly (not via act) so the payload `name` key can't collide with
# act()'s own `name` kwarg (the username) — same reason the admin tests do this.
def _name_pet(table, pet_id, name):
    return db.handle_action(table, {
        'type': 'name-pet', 'userId': 'user-alex', 'username': 'Alex',
        'payload': {'petId': pet_id, 'name': name}})


def test_name_pet_sets_trims_and_clears(table):
    sid, doc = _persist_active_pet(table, 'small_bear', level=1)
    pet_id = doc['activePetId']
    # Set a nickname — surrounding whitespace is trimmed.
    status, body = _name_pet(table, pet_id, '  Rocky  ')
    assert status == 200, body
    pet = db._find_pet(db._get_player(table, sid, 'user-alex'), pet_id)
    assert pet['name'] == 'Rocky'
    # Capped at 16 chars (mirrors the creature-name rule).
    _name_pet(table, pet_id, 'abcdefghijklmnopqrstuvwxyz')
    pet = db._find_pet(db._get_player(table, sid, 'user-alex'), pet_id)
    assert pet['name'] == 'abcdefghijklmnop'   # 16
    # Empty name clears it back to the species default.
    status, _ = _name_pet(table, pet_id, '   ')
    assert status == 200
    pet = db._find_pet(db._get_player(table, sid, 'user-alex'), pet_id)
    assert 'name' not in pet


def test_name_pet_rejects_unknown_pet(table):
    _persist_active_pet(table, 'small_bear')
    status, body = _name_pet(table, 'pet-nope', 'Ghost')
    assert status == 409


def test_forage_gives_spores_and_primes_recharge(table):
    sid, doc = _persist_active_pet(table, 'rat', level=2)   # forage role
    before = doc.get('spores', 0)
    status, body = act(table, 'use-pet-ability')
    assert status == 200
    doc = db._get_player(table, sid, 'user-alex')
    assert doc['spores'] > before
    # Forage recharges by DISTANCE now — using it primes a space countdown, not a
    # real-time clock. The recharge is flat (level 2 still primes the base count).
    assert doc['forageRecharge'] == config.PET_FORAGE_RECHARGE_SPACES
    assert 'forage' not in doc.get('petCooldowns', {})
    # Still recharging -> rejected.
    status, _ = act(table, 'use-pet-ability')
    assert status == 429


def test_forage_recharge_ticks_down_as_you_walk(table):
    # One clean walk (len - 1 spaces) counts the primed countdown down by that
    # much. No follow-up action: a real landing can start a wild fight that would
    # block the next gated call, so we only read the counter here.
    sid, _ = _persist_active_pet(table, 'rat', level=1)   # forage role
    act(table, 'use-pet-ability')                          # forageRecharge = 6
    _prime_walk(table, sid, _LOOT_PASS[0])
    status, resp = act(table, 'move', to=_LOOT_PASS[-1], path=list(_LOOT_PASS))
    assert status == 200, resp
    doc = db._get_player(table, sid, 'user-alex')
    assert doc['forageRecharge'] == config.PET_FORAGE_RECHARGE_SPACES - (len(_LOOT_PASS) - 1)


def test_forage_recharge_clamps_at_zero_when_walk_overshoots(table):
    # A walk longer than the counter's remainder zeroes it, never goes negative.
    sid, doc = _persist_active_pet(table, 'rat', level=1)
    doc['forageRecharge'] = 1                              # one space shy of ready
    db._save_or_conflict(table, doc)
    _prime_walk(table, sid, _LOOT_PASS[0])                 # a 2-space walk
    status, resp = act(table, 'move', to=_LOOT_PASS[-1], path=list(_LOOT_PASS))
    assert status == 200, resp
    doc = db._get_player(table, sid, 'user-alex')
    assert doc['forageRecharge'] == 0


def test_forage_gate_opens_only_at_zero_recharge(table):
    # The readiness gate itself, driven deterministically (no movement, so no
    # wild-fight RNG): >0 rejects, 0 fires.
    sid, doc = _persist_active_pet(table, 'rat', level=1)   # forage role
    doc['forageRecharge'] = 2
    db._save_or_conflict(table, doc)
    assert act(table, 'use-pet-ability')[0] == 429          # still recharging
    doc = db._get_player(table, sid, 'user-alex')
    doc['forageRecharge'] = 0
    db._save_or_conflict(table, doc)
    assert act(table, 'use-pet-ability')[0] == 200          # recharged -> fires


def test_scout_peek_returns_biome_bazaar_stock(table):
    sid, doc = _persist_active_pet(table, 'baby_gloomshrieker', level=1)   # scout role
    doc['position'] = 'cavern_r0'  # cavern biome has a bazaar
    status, body = db._pet_scout_peek(table, sid, doc, {})
    assert status == 200
    assert body['petAbility']['kind'] == 'scout-peek'
    assert body['petAbility']['tierCap'] == 1
    assert body['petAbility']['node'] == db._biome_bazaar_node(table, sid, doc)
    assert 'stock' in body['petAbility']


def test_scout_rejects_when_no_bazaar_in_biome(table):
    sid, doc = _persist_active_pet(table, 'baby_gloomshrieker')
    nmap = db._season_map(table, sid)
    doc['position'] = next(nid for nid, n in nmap.items() if n.get('region') == 'depths')
    status, _ = db._pet_scout_peek(table, sid, doc, {})
    assert status == 409


# ── Feature: eggs stocked at the Rot Bazaar ──────────────────────────────────

def test_shop_stock_includes_eggs():
    stock = db._gen_shop_stock('city_r1', 0)
    assert 'eggs' in stock
    assert stock['eggs']  # at least one egg line
    for line in stock['eggs']:
        assert line['tier'] in data.SHOP_EGG_COST
        assert line['qty'] >= 1
        assert line['cost'] == data.SHOP_EGG_COST[line['tier']]


def test_buy_egg_from_bazaar(table):
    sid = _sid(table)
    shop = next(n for n, v in db._season_map(table, sid).items() if v.get('type') == 'shop')
    _, doc = _player_at(table, shop)
    doc['spores'] = 999
    stock = db._shop_stock(table, sid, shop)
    tier = stock['eggs'][0]['tier']
    before = len(doc.get('eggs') or [])
    status, body = db._buy(table, sid, doc, {'kind': 'egg', 'tier': tier})
    assert status == 200
    assert len(doc['eggs']) == before + 1
    assert doc['eggs'][-1]['tier'] == tier
    assert doc['spores'] == 999 - data.SHOP_EGG_COST[tier]


def test_buy_egg_rejects_when_broke(table):
    sid = _sid(table)
    shop = next(n for n, v in db._season_map(table, sid).items() if v.get('type') == 'shop')
    _, doc = _player_at(table, shop)
    doc['spores'] = 0
    tier = db._shop_stock(table, sid, shop)['eggs'][0]['tier']
    status, _ = db._buy(table, sid, doc, {'kind': 'egg', 'tier': tier})
    assert status == 409
    assert (doc.get('eggs') or []) == []
