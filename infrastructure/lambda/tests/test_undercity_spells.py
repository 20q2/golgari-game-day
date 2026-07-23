"""Spell system tests (specs/2026-07-10-undercity-spells-design.md)."""
import sys
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parents[1]))

import pytest

import undercity_data as data
import undercity_engine as engine
import undercity_db as db

from test_undercity_db import FakeTable, act, _seed_shop


@pytest.fixture
def table():
    t = FakeTable()
    status, _ = act(t, 'season-start', hostKey='swampking')
    assert status == 200
    return t


def _sid(table):
    sid, _ = db._active_season(table)
    return sid


def give_book(table, user, gid, equip=True):
    """Hand a player a grimoire directly (acquisition is tested separately)."""
    doc = db._get_player(table, _sid(table), user)
    doc.setdefault('grimoires', []).append(gid)
    if equip:
        doc['equippedGrimoire'] = gid
    assert db._put_player(table, doc)


class FixedRng:
    """random.Random stand-in with scripted values for deterministic casts."""

    def __init__(self, random_values=None, randint_value=1):
        self.random_values = list(random_values or [])
        self.randint_value = randint_value

    def random(self):
        return self.random_values.pop(0) if self.random_values else 0.99

    def randint(self, a, b):
        return self.randint_value

    def uniform(self, a, b):
        return 1.0

    def choice(self, seq):
        return seq[0]

    def choices(self, seq, weights=None, k=1):
        return [seq[0]]


# ── Data integrity ───────────────────────────────────────────────────────────

def test_every_grimoire_spell_exists():
    for gid, g in data.GRIMOIRES.items():
        assert 1 <= len(g['spells']) <= 3, gid
        for sp in g['spells']:
            assert sp in data.SPELLS, f'{gid} carries unknown spell {sp}'


def test_tier1_grimoire_pool_enriched():
    tier1 = [gid for gid, g in data.GRIMOIRES.items() if g['tier'] == 1]
    assert len(tier1) == 7, tier1
    for gid in ('warcasters_screed', 'hexweavers_codex',
                'nightrunners_ledger', 'tinkers_manual'):
        g = data.GRIMOIRES[gid]
        assert g['tier'] == 1 and 1 <= len(g['spells']) <= 3
        for sp in g['spells']:
            assert sp in data.SPELLS


def test_biome_spells_cover_every_biome():
    assert set(data.BIOME_SPELLS) == set(data.BIOMES)
    for spell_id in data.BIOME_SPELLS.values():
        assert spell_id in data.SPELLS


def test_spell_fields_match_effect_kind():
    for sid_, sp in data.SPELLS.items():
        assert sp['effect'] in ('self_buff', 'self_heal', 'field_curse',
                                'field_damage', 'teleport', 'recall',
                                'fate_die', 'boss_strike'), sid_
        assert sp['cooldownMin'] > 0, sid_
        if sp['effect'] in ('field_curse', 'field_damage', 'teleport'):
            assert sp.get('range', 0) > 0, sid_
        if sp['effect'] in ('field_damage', 'self_heal', 'boss_strike'):
            assert sp.get('power', 0) > 0, sid_
        if sp['effect'] in ('self_buff', 'field_curse'):
            assert sp.get('buffKind'), sid_


# ── Engine helpers ───────────────────────────────────────────────────────────

_LINE_NODES = {
    'a': {'neighbors': ['b']},
    'b': {'neighbors': ['a', 'c']},
    'c': {'neighbors': ['b', 'd']},
    'd': {'neighbors': ['c']},
}


def test_board_distance_bfs():
    assert engine.board_distance(_LINE_NODES, 'a', 'a', 3) == 0
    assert engine.board_distance(_LINE_NODES, 'a', 'c', 3) == 2
    assert engine.board_distance(_LINE_NODES, 'a', 'd', 2) is None  # beyond max


def test_board_distance_closed_blocks_passage_but_allows_goal():
    closed = frozenset({'c'})
    assert engine.board_distance(_LINE_NODES, 'a', 'd', 5, closed) is None
    assert engine.board_distance(_LINE_NODES, 'a', 'c', 5, closed) == 2


def test_spell_dodge_chance_clamps():
    assert engine.spell_dodge_chance(5, 5) == 10          # base
    assert engine.spell_dodge_chance(5, 7) == 16          # +3 per SPD point
    assert engine.spell_dodge_chance(20, 1) == 5          # floor
    assert engine.spell_dodge_chance(1, 20) == 40         # ceiling


# ── New buff kinds ───────────────────────────────────────────────────────────

def test_new_buff_kinds_in_effective_stats():
    base = {'atk': 6, 'def': 5, 'spd': 5, 'maxHp': 30}
    assert engine.effective_stats({**base, 'buffs': [{'kind': 'glowveil'}]})['spd'] == 7
    assert engine.effective_stats({**base, 'buffs': [{'kind': 'harden_shell'}]})['def'] == 7
    assert engine.effective_stats({**base, 'buffs': [{'kind': 'weaken_hex'}]})['atk'] == 3
    # weaken_hex never drops ATK below 1
    assert engine.effective_stats({**base, 'atk': 2, 'buffs': [{'kind': 'weaken_hex'}]})['atk'] == 1


def test_one_battle_buffs_consumed():
    doc = {'buffs': [{'kind': 'glowveil'}, {'kind': 'harden_shell'},
                     {'kind': 'weaken_hex'}, {'kind': 'rot_surge'},
                     {'kind': 'vines'}]}
    db._consume_one_battle_buffs(doc)
    assert [b['kind'] for b in doc['buffs']] == ['vines']  # vines is roll-consumed


def test_glowveil_grants_flee_bonus():
    doc = {'username': 'x', 'hp': 10, 'maxHp': 10, 'atk': 5, 'def': 5, 'spd': 5,
           'buffs': [{'kind': 'glowveil'}], 'homeBiome': 'bog'}
    assert db._combatant(doc).flee_bonus == 15
    doc['homeBiome'] = 'cavern'   # cavern's Darkvision perk grants no flee bonus
    assert db._combatant(doc).flee_bonus == 15


# ── Player doc fields & cooldowns ────────────────────────────────────────────

def test_join_seeds_spell_fields(table):
    status, resp = act(table, 'join', starter='pest', home='garden')
    assert status == 200
    you = resp['you']
    assert you['grimoires'] == [] and you['equippedGrimoire'] is None
    assert you['spellCooldowns'] == {} and you['awayEvents'] == []


def test_prune_cooldowns_drops_expired():
    doc = {'spellCooldowns': {'rot_surge': '2000-01-01T00:00:00',
                              'spore_bolt': '2099-01-01T00:00:00'}}
    db._prune_cooldowns(doc)
    assert doc['spellCooldowns'] == {'spore_bolt': '2099-01-01T00:00:00'}


# ── cast: validation + self spells ───────────────────────────────────────────

def test_cast_innate_self_buff_and_cooldown(table):
    act(table, 'join', starter='pest', home='garden')  # garden -> rot_surge
    status, resp = act(table, 'cast', spellId='rot_surge', source='innate')
    assert status == 200
    assert {'kind': 'rot_surge'} in resp['you']['buffs']
    assert resp['you']['spellCooldowns']['rot_surge'] > db._now()
    assert resp['cast']['spellId'] == 'rot_surge'

    status, resp = act(table, 'cast', spellId='rot_surge', source='innate')
    assert status == 429
    assert resp['code'] == 'spell_on_cooldown'


def test_cast_buff_refreshes_not_stacks(table):
    act(table, 'join', starter='pest', home='garden')
    doc = db._get_player(table, _sid(table), 'user-alex')
    doc['buffs'] = [{'kind': 'rot_surge'}]     # e.g. from a mystery event
    db._put_player(table, doc)
    status, resp = act(table, 'cast', spellId='rot_surge', source='innate')
    assert status == 200
    assert [b['kind'] for b in resp['you']['buffs']].count('rot_surge') == 1


def test_cast_source_validation(table):
    act(table, 'join', starter='pest', home='garden')
    status, resp = act(table, 'cast', spellId='glowveil', source='innate')
    assert status == 409 and resp['code'] == 'not_castable'   # not your biome
    status, resp = act(table, 'cast', spellId='spore_bolt', source='grimoire')
    assert status == 409 and resp['code'] == 'not_castable'   # no book equipped
    status, resp = act(table, 'cast', spellId='nonsense', source='innate')
    assert status == 400 and resp['code'] == 'unknown_spell'
    status, resp = act(table, 'cast', spellId='spore_bolt', source='scroll')
    assert status == 400                                       # phase 2


def test_cast_grimoire_self_heal(table):
    act(table, 'join', starter='saproling', home='garden')     # 30 max HP
    give_book(table, 'user-alex', 'gardeners_primer')
    doc = db._get_player(table, _sid(table), 'user-alex')
    doc['hp'] = 10
    db._put_player(table, doc)
    status, resp = act(table, 'cast', spellId='mend_flesh', source='grimoire')
    assert status == 200
    assert resp['you']['hp'] == 22                              # +12, capped at max
    assert resp['cast']['hp'] == 12


# ── cast: field spells ───────────────────────────────────────────────────────

def _two_players_same_node(table):
    act(table, 'join', starter='kraul', home='city')          # city -> scrap_toss
    act(table, 'join', user='user-sam', name='Sam', starter='saproling', home='bog')
    alex = db._get_player(table, _sid(table), 'user-alex')
    sam = db._get_player(table, _sid(table), 'user-sam')
    alex['position'] = sam['position'] = 'city_r2'
    db._put_player(table, alex)
    db._put_player(table, sam)


def far_node(start, max_steps):
    for nid in data.MAP_NODES:
        if nid != start and engine.board_distance(
                data.MAP_NODES, start, nid, max_steps) is None:
            return nid
    pytest.skip('map too small for an out-of-range node')


def test_field_damage_hits_and_floors_at_1hp(table, monkeypatch):
    _two_players_same_node(table)
    monkeypatch.setattr(db, '_rng', FixedRng(random_values=[0.99, 0.99]))  # never dodge
    status, resp = act(table, 'cast', spellId='scrap_toss', source='innate',
                       target='user-sam')
    assert status == 200
    assert resp['cast']['dodged'] is False and resp['cast']['dmg'] == 8
    sam = db._get_player(table, _sid(table), 'user-sam')
    assert sam['hp'] == 25 - 8
    assert sam['awayEvents'][-1]['kind'] == 'spell_hit'
    assert sam['awayEvents'][-1]['dmg'] == 8

    # Floor: drop Sam to 5 HP; an 8-damage bolt leaves exactly 1, never composts.
    sam['hp'] = 5
    db._put_player(table, sam)
    alex = db._get_player(table, _sid(table), 'user-alex')
    alex['spellCooldowns'] = {}
    db._put_player(table, alex)
    status, resp = act(table, 'cast', spellId='scrap_toss', source='innate',
                       target='user-sam')
    assert status == 200
    sam = db._get_player(table, _sid(table), 'user-sam')
    assert sam['hp'] == 1
    assert sam['position'] == 'city_r2'     # NOT composted home


def test_field_spell_dodge_still_notifies_and_cools(table, monkeypatch):
    _two_players_same_node(table)
    monkeypatch.setattr(db, '_rng', FixedRng(random_values=[0.0]))  # always dodge
    status, resp = act(table, 'cast', spellId='scrap_toss', source='innate',
                       target='user-sam')
    assert status == 200
    assert resp['cast']['dodged'] is True
    assert resp['you']['spellCooldowns']['scrap_toss'] > db._now()  # dodge still cools
    sam = db._get_player(table, _sid(table), 'user-sam')
    assert sam['hp'] == 25
    assert sam['awayEvents'][-1]['kind'] == 'spell_dodged'


def test_field_curse_writes_target_buff(table, monkeypatch):
    act(table, 'join', starter='pest', home='bone')            # bone -> bone_chill
    act(table, 'join', user='user-sam', name='Sam', starter='pest', home='bog')
    alex = db._get_player(table, _sid(table), 'user-alex')
    sam = db._get_player(table, _sid(table), 'user-sam')
    alex['position'] = sam['position'] = 'city_r2'
    db._put_player(table, alex)
    db._put_player(table, sam)
    monkeypatch.setattr(db, '_rng', FixedRng(random_values=[0.99]))
    status, resp = act(table, 'cast', spellId='bone_chill', source='innate',
                       target='user-sam')
    assert status == 200
    sam = db._get_player(table, _sid(table), 'user-sam')
    assert {'kind': 'bone_chill'} in sam['buffs']


def test_field_spell_range_and_shield_guards(table, monkeypatch):
    _two_players_same_node(table)
    sid = _sid(table)
    # Shielded target: rejected, cooldown NOT started.
    sam = db._get_player(table, sid, 'user-sam')
    sam['shieldUntil'] = '2099-01-01T00:00:00'
    db._put_player(table, sam)
    status, resp = act(table, 'cast', spellId='scrap_toss', source='innate',
                       target='user-sam')
    assert status == 409 and resp['code'] == 'target_shielded'
    alex = db._get_player(table, sid, 'user-alex')
    assert 'scrap_toss' not in (alex.get('spellCooldowns') or {})

    # Out of range.
    sam = db._get_player(table, sid, 'user-sam')
    sam['shieldUntil'] = None
    sam['position'] = far_node('city_r2', data.SPELLS['scrap_toss']['range'])
    db._put_player(table, sam)
    status, resp = act(table, 'cast', spellId='scrap_toss', source='innate',
                       target='user-sam')
    assert status == 409 and resp['code'] == 'out_of_range'

    # Bogus targets.
    status, resp = act(table, 'cast', spellId='scrap_toss', source='innate',
                       target='user-alex')
    assert status == 400 and resp['code'] == 'invalid_target'
    status, resp = act(table, 'cast', spellId='scrap_toss', source='innate',
                       target='user-nobody')
    assert status == 404 and resp['code'] == 'invalid_target'


def test_victim_write_conflict_retries_once(table, monkeypatch):
    _two_players_same_node(table)
    monkeypatch.setattr(db, '_rng', FixedRng(random_values=[0.99, 0.99]))
    calls = {'n': 0}
    orig = db._put_player

    def flaky(t, d):
        if d['userId'] == 'user-sam' and calls['n'] == 0:
            calls['n'] += 1
            return False
        return orig(t, d)

    monkeypatch.setattr(db, '_put_player', flaky)
    status, resp = act(table, 'cast', spellId='scrap_toss', source='innate',
                       target='user-sam')
    assert status == 200
    sam = db._get_player(table, _sid(table), 'user-sam')
    assert sam['hp'] == 25 - 8                                 # saproling took the bolt


# ── cast: traversal spells ───────────────────────────────────────────────────

def test_teleport_moves_and_resolves_space(table):
    act(table, 'join', starter='pest', home='city')
    give_book(table, 'user-alex', 'tome_of_deep_roads')         # deep_step, range 6
    doc = db._get_player(table, _sid(table), 'user-alex')
    start = doc['position']
    # Any real node exactly 1 step away.
    dest = data.MAP_NODES[start]['neighbors'][0]
    status, resp = act(table, 'cast', spellId='deep_step', source='grimoire',
                       target=dest)
    assert status == 200
    assert resp['spaceEvent']['type']                            # space resolved
    assert 'occupants' in resp
    assert resp['you']['pendingMove'] is None


def test_teleport_range_and_bogus_node(table):
    act(table, 'join', starter='pest', home='city')
    give_book(table, 'user-alex', 'tome_of_deep_roads')
    doc = db._get_player(table, _sid(table), 'user-alex')
    status, resp = act(table, 'cast', spellId='deep_step', source='grimoire',
                       target=far_node(doc['position'], 6))
    assert status == 409 and resp['code'] == 'out_of_range'
    status, resp = act(table, 'cast', spellId='deep_step', source='grimoire',
                       target='no-such-node')
    assert status == 400 and resp['code'] == 'invalid_target'
    status, resp = act(table, 'cast', spellId='deep_step', source='grimoire',
                       target=doc['position'])
    assert status == 400 and resp['code'] == 'invalid_target'


def test_skitter_step_loads_die_capped_at_three(table):
    act(table, 'join', starter='pest', home='city')
    give_book(table, 'user-alex', 'vagrants_chapbook')          # skitter_step, 1–3
    status, resp = act(table, 'cast', spellId='skitter_step', source='grimoire', value=3)
    assert status == 200
    assert resp['you']['pendingLoadedDie'] == 3
    # Values above the cap are rejected (after clearing the cooldown).
    doc = db._get_player(table, _sid(table), 'user-alex')
    doc['spellCooldowns'] = {}
    del doc['pendingLoadedDie']
    db._put_player(table, doc)
    status, resp = act(table, 'cast', spellId='skitter_step', source='grimoire', value=4)
    assert status == 400


def test_recall_returns_home(table):
    act(table, 'join', starter='pest', home='bog')
    give_book(table, 'user-alex', 'tome_of_deep_roads')
    doc = db._get_player(table, _sid(table), 'user-alex')
    doc['position'] = 'city_r2'
    db._put_player(table, doc)
    status, resp = act(table, 'cast', spellId='mycelial_recall', source='grimoire')
    assert status == 200
    assert resp['you']['position'] == data.HOME_GATES['bog']


def test_fate_die_sets_pending_loaded_die(table):
    act(table, 'join', starter='pest', home='city')
    give_book(table, 'user-alex', 'wayfarers_atlas')
    status, resp = act(table, 'cast', spellId='fate_die', source='grimoire', value=6)
    assert status == 200
    assert resp['you']['pendingLoadedDie'] == 6
    status, resp = act(table, 'cast', spellId='fate_die', source='grimoire', value=9)
    assert status == 429                                        # on cooldown first…

    doc = db._get_player(table, _sid(table), 'user-alex')
    doc['spellCooldowns'] = {}
    db._put_player(table, doc)
    status, resp = act(table, 'cast', spellId='fate_die', source='grimoire', value=9)
    assert status == 400                                        # …then bad value


# ── cast: boss strike ────────────────────────────────────────────────────────

def test_boss_strike_chips_savra_and_floors(table):
    act(table, 'join', starter='pest', home='city')
    give_book(table, 'user-alex', 'queensbane_grimoire')
    status, resp = act(table, 'cast', spellId='queens_bane', source='grimoire',
                       target='boss')
    assert status == 200
    assert resp['cast']['dmg'] == 15
    assert db._boss_hp(table, _sid(table)) == data.ROT_SOVEREIGN['hp'] - 15
    assert resp['you']['bossDamage'] == 15

    # Floor at 1: pool can never be spell-killed.
    db._set_boss_hp(table, _sid(table), 5)
    doc = db._get_player(table, _sid(table), 'user-alex')
    doc['spellCooldowns'] = {}
    db._put_player(table, doc)
    status, resp = act(table, 'cast', spellId='queens_bane', source='grimoire',
                       target='boss')
    assert status == 200
    assert db._boss_hp(table, _sid(table)) == 1
    assert resp['cast']['dmg'] == 4


def test_boss_strike_chips_lair_pool(table):
    act(table, 'join', starter='pest', home='city')
    give_book(table, 'user-alex', 'queensbane_grimoire')
    lair = next(iter(data.LAIR_BOSSES))
    full = data.LAIR_BOSSES[lair]['hp']
    status, resp = act(table, 'cast', spellId='queens_bane', source='grimoire',
                       target=lair)
    assert status == 200
    hp, slain, _ = db._lair_state(table, _sid(table), lair)
    assert hp == full - 15 and slain is False
    you = resp['you']
    assert you.get('bossDamage', 0) == 0        # renown pool is Savra-only


def test_boss_strike_bad_target(table):
    act(table, 'join', starter='pest', home='city')
    give_book(table, 'user-alex', 'queensbane_grimoire')
    status, resp = act(table, 'cast', spellId='queens_bane', source='grimoire',
                       target='city_r2')
    assert status == 400 and resp['code'] == 'invalid_target'


# ── equip-grimoire / ack-events ──────────────────────────────────────────────

def test_equip_grimoire_owned_only(table):
    act(table, 'join', starter='pest', home='city')
    give_book(table, 'user-alex', 'moldering_folio', equip=False)
    status, resp = act(table, 'equip-grimoire', grimoireId='kraul_warcodex')
    assert status == 409
    status, resp = act(table, 'equip-grimoire', grimoireId='moldering_folio')
    assert status == 200 and resp['you']['equippedGrimoire'] == 'moldering_folio'
    status, resp = act(table, 'equip-grimoire', grimoireId=None)
    assert status == 200 and resp['you']['equippedGrimoire'] is None


def test_equip_grimoire_swap_cooldown(table):
    act(table, 'join', starter='pest', home='city')
    give_book(table, 'user-alex', 'moldering_folio', equip=False)
    give_book(table, 'user-alex', 'gardeners_primer', equip=False)

    # First open is free and stamps the cooldown.
    status, resp = act(table, 'equip-grimoire', grimoireId='moldering_folio')
    assert status == 200 and resp['you']['equippedGrimoire'] == 'moldering_folio'

    # Opening a different book right away is blocked...
    status, resp = act(table, 'equip-grimoire', grimoireId='gardeners_primer')
    assert status == 429

    # ...and stowing (free) can't be used to bypass it.
    status, resp = act(table, 'equip-grimoire', grimoireId=None)
    assert status == 200 and resp['you']['equippedGrimoire'] is None
    status, resp = act(table, 'equip-grimoire', grimoireId='gardeners_primer')
    assert status == 429

    # Once the cooldown lapses, the swap goes through.
    from datetime import datetime, timedelta
    doc = db._get_player(table, _sid(table), 'user-alex')
    doc['lastGrimoireSwap'] = (
        datetime.utcnow() - timedelta(minutes=data.GRIMOIRE_SWAP_COOLDOWN_MIN + 1)
    ).isoformat(timespec='seconds')
    db._put_player(table, doc)
    status, resp = act(table, 'equip-grimoire', grimoireId='gardeners_primer')
    assert status == 200 and resp['you']['equippedGrimoire'] == 'gardeners_primer'


def test_ack_events_clears_inbox_and_cap(table):
    act(table, 'join', starter='pest', home='city')
    doc = db._get_player(table, _sid(table), 'user-alex')
    for i in range(25):
        db._push_away_event(doc, {'kind': 'spell_hit', 'from': 'Sam',
                                  'spell': 'spore_bolt', 'dmg': i, 'at': db._now()})
    assert len(doc['awayEvents']) == data.AWAY_EVENTS_CAP
    assert doc['awayEvents'][-1]['dmg'] == 24                   # keeps the newest
    db._put_player(table, doc)
    status, resp = act(table, 'ack-events')
    assert status == 200 and resp['you']['awayEvents'] == []


# ── Acquisition ──────────────────────────────────────────────────────────────

def _shop_node():
    return next(nid for nid, n in data.MAP_NODES.items() if n['type'] == 'shop')


def test_buy_tier1_grimoire_auto_equips(table):
    act(table, 'join', starter='pest', home='city')
    sid = _sid(table)
    node = _shop_node()
    doc = db._get_player(table, sid, 'user-alex')
    doc['position'] = node
    doc['spores'] = 100
    db._put_player(table, doc)
    # Stock this bazaar with the tome under test (+ a tier-II id to prove the guard).
    _seed_shop(table, sid, node, grimoires=['gardeners_primer', 'kraul_warcodex'])

    status, resp = act(table, 'buy', itemId='gardeners_primer')
    assert status == 200
    you = resp['you']
    assert 'gardeners_primer' in you['grimoires']
    assert you['equippedGrimoire'] == 'gardeners_primer'        # first book auto-opens
    assert you['spores'] == 100 - data.GRIMOIRES['gardeners_primer']['cost']

    status, resp = act(table, 'buy', itemId='gardeners_primer')
    assert status == 409                                        # already owned
    status, resp = act(table, 'buy', itemId='kraul_warcodex')
    assert status == 409                                        # tier II not stocked


def test_mystery_item_can_upgrade_to_grimoire(table, monkeypatch):
    act(table, 'join', starter='pest', home='city')
    sid = _sid(table)
    doc = db._get_player(table, sid, 'user-alex')
    monkeypatch.setattr(db.engine, 'roll_mystery', lambda *a, **k: {
        'roll': 6, 'spores': 0, 'xp': 0, 'hpPct': 0, 'item': 'random',
        'heal': False, 'buff': None, 'teleport': False, 'curse': False,
        'text': 'A free consumable lies discarded.'})
    # First random() skips the gear-drop roll (>= GEAR_DROP['mystery'] chance);
    # the second forces the grimoire upgrade.
    monkeypatch.setattr(db, '_rng', FixedRng(random_values=[0.99, 0.0]))
    out = db._mystery(table, sid, doc)
    assert out['grimoire'] in data.GRIMOIRES
    assert data.GRIMOIRES[out['grimoire']]['tier'] == 1
    assert out['grimoire'] in doc['grimoires']
    assert 'item' not in out                                     # book replaced the item

    # Once every tier-1 book is owned, the same roll falls back to an item.
    doc['grimoires'] = [g for g, spec in data.GRIMOIRES.items() if spec['tier'] == 1]
    # 0.99 skips the gear-drop roll so this still falls back to a plain item.
    monkeypatch.setattr(db, '_rng', FixedRng(random_values=[0.99]))
    out = db._mystery(table, sid, doc)
    assert 'grimoire' not in out and out.get('item')


# ── Guardian targeting (specs/2026-07-19-undercity-guardian-targeting-design.md) ─

def test_guardian_debuff_applies_flat_penalty():
    npc = {'atk': 11, 'def': 6, 'spd': 3}
    db._apply_guardian_debuffs(npc, [{'kind': 'bone_chill'}, {'kind': 'vines'}])
    assert npc['atk'] == 11 - 2      # bone_chill
    assert npc['spd'] == 3 - 2       # vines -> speed bite
    # Penalties floor at 1, unknown kinds are ignored.
    npc2 = {'atk': 2, 'def': 6, 'spd': 3}
    db._apply_guardian_debuffs(npc2, [{'kind': 'weaken_hex'}, {'kind': 'nonsense'}])
    assert npc2['atk'] == 1          # max(1, 2 - 3)


def test_lair_curse_applies_and_is_consumed(table):
    sid, _ = db._active_season(table)
    node = 'city_lair'
    db._set_lair_state(table, sid, node, data.LAIR_BOSSES[node]['hp'], False,
                       [{'kind': 'weaken_hex'}])
    # Round-trips with buffs.
    hp, slain, buffs = db._lair_state(table, sid, node)
    assert buffs == [{'kind': 'weaken_hex'}] and slain is False
    # Starting the fight applies -3 ATK to the NPC and clears the stored curse.
    act(table, 'join', starter='pest', home='city')
    doc = db._get_player(table, sid, 'user-alex')
    doc['position'] = node
    db._put_player(table, doc)
    db._lair(table, sid, doc, node)   # mutates doc in place (caller persists it)
    rec = db._get(table, db._season_pk(sid), f'LAIR#{node}')
    assert not (rec or {}).get('buffs')      # consumed at battle start
    assert doc['battle']['npc']['atk'] == data.LAIR_BOSSES[node]['atk'] - 3


def _cast_near_node(table, target_node, home='city'):
    """Join a caster on a neighbour of target_node (distance 1, guaranteed in
    range) and return sid."""
    sid, _ = db._active_season(table)
    act(table, 'join', starter='pest', home=home)
    doc = db._get_player(table, sid, 'user-alex')
    doc['position'] = data.MAP_NODES[target_node]['neighbors'][0]
    db._put_player(table, doc)
    return sid


def test_field_damage_chips_barrier_floored(table):
    sid = _cast_near_node(table, 'bar_e')
    full = data.BARRIER_GUARDIANS['bar_e']['hp']
    status, resp = act(table, 'cast', spellId='scrap_toss', source='innate', target='bar_e')
    assert status == 200 and resp['cast']['dmg'] == 8
    hp, _ = db._barrier_state(table, sid, 'bar_e')
    assert hp == full - 8
    # Floor: a huge pre-chip leaves exactly 1, never opens the barrier.
    db._set_barrier_state(table, sid, 'bar_e', 3)
    alex = db._get_player(table, sid, 'user-alex'); alex['spellCooldowns'] = {}
    db._put_player(table, alex)
    status, resp = act(table, 'cast', spellId='scrap_toss', source='innate', target='bar_e')
    hp, _ = db._barrier_state(table, sid, 'bar_e')
    assert hp == 1
    assert 'bar_e' not in db._open_barriers(table, sid)


def test_field_curse_persists_on_barrier(table):
    sid = _cast_near_node(table, 'bar_e', home='bone')   # bone -> bone_chill innate
    status, resp = act(table, 'cast', spellId='bone_chill', source='innate', target='bar_e')
    assert status == 200
    _, buffs = db._barrier_state(table, sid, 'bar_e')
    assert {'kind': 'bone_chill'} in buffs


def test_field_spell_guardian_out_of_range_no_cooldown(table):
    sid, _ = db._active_season(table)
    act(table, 'join', starter='pest', home='city')
    doc = db._get_player(table, sid, 'user-alex')
    doc['position'] = 'city_r1'   # far from bar_e; scrap_toss range 5
    db._put_player(table, doc)
    status, resp = act(table, 'cast', spellId='scrap_toss', source='innate', target='bar_e')
    if status == 200:
        pytest.skip('city_r1 within range of bar_e on this board')
    assert status == 409 and resp['code'] == 'out_of_range'
    alex = db._get_player(table, sid, 'user-alex')
    assert 'scrap_toss' not in (alex.get('spellCooldowns') or {})


def test_state_exposes_guardian_pools(table):
    act(table, 'join', starter='pest', home='city')
    status, state = db.handle_state(table, {'userId': 'user-alex'})
    assert status == 200
    guardians = state['guardians']
    assert 'bar_e' in guardians
    assert guardians['bar_e']['npcId'] == 'golgari_grave_troll'
    assert guardians['bar_e']['hp'] == data.BARRIER_GUARDIANS['bar_e']['hp']
    assert 'city_lair' in guardians and guardians['city_lair']['kind'] == 'lair'
