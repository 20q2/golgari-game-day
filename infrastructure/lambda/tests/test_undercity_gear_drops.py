import undercity_data as data
import undercity_db as db

from tests.test_undercity_db import (  # noqa: F401
    table, act, _sid, _player_at, _finish_started_battle)


def _doc(gear=None, spores=0):
    return {'userId': 'u1', 'username': 'U', 'gear': dict(gear or {}), 'spores': spores}


# Force the gear roll to fire and deterministically pick a tier-1 fang.
def _force_fang_drop(monkeypatch):
    monkeypatch.setattr(db._rng, 'random', lambda: 0.0)          # < any chance
    monkeypatch.setattr(db._rng, 'choice',
                        lambda seq: 'fang' if 'fang' in seq else seq[0])
    monkeypatch.setattr(db._rng, 'choices', lambda seq, weights=None, k=1: [seq[0]])


def test_drop_goes_to_stash(monkeypatch):
    monkeypatch.setattr(db._rng, 'choice', lambda seq: seq[0])
    monkeypatch.setattr(db._rng, 'choices', lambda seq, weights=None, k=1: [seq[0]])
    doc = _doc(spores=0)
    res = db._roll_gear_drop(doc, {1: 1.0})
    assert res['outcome'] == 'stashed'
    assert doc['gearStash'] == [res['id']]
    assert doc.get('gear') == {}          # never auto-equipped


def test_drop_never_auto_equips_or_mulches(monkeypatch):
    # Even a strictly-better-tier drop just stashes — no auto-equip, no spore income.
    monkeypatch.setattr(db._rng, 'choice',
                        lambda seq: 'fang' if 'fang' in seq else seq[0])
    monkeypatch.setattr(db._rng, 'choices', lambda seq, weights=None, k=1: [3])
    doc = _doc(gear={'fang': 'rusted_fang'}, spores=0)
    res = db._roll_gear_drop(doc, {3: 1.0})
    assert res['outcome'] == 'stashed'
    assert doc['gear']['fang'] == 'rusted_fang'   # equipped slot untouched
    assert doc['gearStash'] == [res['id']]
    assert doc['spores'] == 0                      # no auto-salvage income


def test_stash_full_auto_grinds_to_materials(monkeypatch):
    monkeypatch.setattr(db._rng, 'choice',
                        lambda seq: 'fang' if 'fang' in seq else seq[0])
    monkeypatch.setattr(db._rng, 'choices', lambda seq, weights=None, k=1: [1])
    doc = _doc(spores=0)
    doc['gearStash'] = ['rusted_fang'] * data.GEAR_STASH_SIZE
    res = db._roll_gear_drop(doc, {1: 1.0})
    assert res['outcome'] == 'stash-full'
    assert res['materials']['moltings'] == data.SALVAGE_MOLTINGS[1]
    assert len(doc['gearStash']) == data.GEAR_STASH_SIZE          # unchanged (full)
    assert doc['materials']['moltings'] == data.SALVAGE_MOLTINGS[1]


def test_wild_win_can_drop_gear(table, monkeypatch):
    act(table, 'join', starter='pest')
    sid = _sid(table)
    doc = db._get_player(table, sid, 'user-alex')
    db._wild_battle(table, sid, doc)          # sets doc['battle'] BEFORE we patch _rng
    _force_fang_drop(monkeypatch)
    se = _finish_started_battle(table, monkeypatch, doc, 'attacker')
    assert se['type'] == 'wild'
    assert se['gear']['outcome'] in ('stashed', 'stash-full')
    assert se['gear']['slot'] == 'fang'


def test_loot_tile_can_drop_gear(table, monkeypatch):
    # Loot is gated by a Flow puzzle: landing scatters reward symbols; the value
    # of whichever the path reaches first rolls in _solve_loot_puzzle. Force gear
    # onto the solution's first step so the canonical solution claims gear first.
    from tests.test_undercity_db import _land_loot_with
    sid, doc, puzzle = _land_loot_with(
        table, monkeypatch,
        lambda pz: [{'kind': 'gear', 'cell': pz['solution'][1]}])
    _force_fang_drop(monkeypatch)
    status, body = db._solve_loot_puzzle(table, sid, doc, {'path': puzzle['solution']})
    assert status == 200
    out = body['spaceEvent']
    assert out['type'] == 'loot'
    assert out['gear']['slot'] == 'fang'


def test_mystery_free_item_can_be_gear(table, monkeypatch):
    node = next(n for n, nd in data.MAP_NODES.items() if nd['type'] == 'mystery')
    sid, doc = _player_at(table, node, spores=0)
    # Force roll_mystery to return an item, then force the gear branch.
    monkeypatch.setattr(db.engine, 'roll_mystery',
                        lambda *a, **k: {'roll': 7, 'text': 'x', 'spores': 0,
                                         'xp': 0, 'hpPct': 0, 'heal': False,
                                         'buff': None, 'curse': False,
                                         'teleport': False, 'item': True,
                                         'paint': False, 'hat': False})
    _force_fang_drop(monkeypatch)
    out = db._mystery(table, sid, doc)
    assert out['gear']['slot'] == 'fang'


def test_cache_first_visit_can_drop_gear(table, monkeypatch):
    sid, doc = _player_at(table, 'city_cache', spores=0)
    _force_fang_drop(monkeypatch)
    out = db._cache(table, sid, doc, 'city_cache')
    assert out['type'] == 'cache'
    assert out['gear']['slot'] == 'fang'


def test_lair_win_can_drop_gear(table, monkeypatch):
    act(table, 'join', starter='pest')
    sid = _sid(table)
    doc = db._get_player(table, sid, 'user-alex')
    doc['position'] = 'city_lair'
    db._lair(table, sid, doc, 'city_lair')     # battle_start — picks the boss
    _force_fang_drop(monkeypatch)              # patch _rng only now
    se = _finish_started_battle(table, monkeypatch, doc, 'attacker')
    assert se['type'] == 'lair'
    assert se['gear']['slot'] == 'fang'


# ── Salvage Yard ─────────────────────────────────────────────────────────────

def test_salvage_grind_yields_moltings(table):
    sid, doc = _player_at(table, 'city_r0', spores=0)
    doc['gearStash'] = ['bramble_hide']        # tier-1 carapace
    doc['materials'] = {'moltings': 0, 'ichor': 0}
    status, body = db._salvage_gear(table, sid, doc, {'index': 0, 'mode': 'grind'})
    assert status == 200
    assert doc['gearStash'] == []
    assert doc['materials']['moltings'] == data.SALVAGE_MOLTINGS[1]
    assert doc['materials']['ichor'] == 0


def test_salvage_grind_legendary_yields_ichor(table):
    sid, doc = _player_at(table, 'city_r0', spores=0)
    doc['gearStash'] = ['bramble_aegis']       # tier-3 carapace
    doc['materials'] = {'moltings': 0, 'ichor': 0}
    status, body = db._salvage_gear(table, sid, doc, {'index': 0, 'mode': 'grind'})
    assert status == 200
    assert doc['materials']['moltings'] == data.SALVAGE_MOLTINGS[3]
    assert doc['materials']['ichor'] == data.SALVAGE_ICHOR


def test_salvage_sell_yields_spores(table):
    sid, doc = _player_at(table, 'city_r0', spores=0)
    doc['gearStash'] = ['bark_hide']           # tier-2, cost 45
    status, body = db._salvage_gear(table, sid, doc, {'index': 0, 'mode': 'sell'})
    assert status == 200
    assert doc['spores'] == int(data.GEAR['bark_hide']['cost'] * data.GEAR_SELL_BACK)
    assert doc['gearStash'] == []


def test_salvage_bad_index_errors(table):
    sid, doc = _player_at(table, 'city_r0')
    doc['gearStash'] = []
    status, body = db._salvage_gear(table, sid, doc, {'index': 0, 'mode': 'grind'})
    assert status == 409


# ── Blacksmith (upgrade) ─────────────────────────────────────────────────────

def test_upgrade_equipped_climbs_a_rung(table):
    sid, doc = _player_at(table, 'city_r0', spores=100)
    doc['gear'] = {'carapace': 'bramble_hide'}          # tier-1 bramble
    doc['materials'] = {'moltings': 10, 'ichor': 0}
    status, body = db._upgrade_gear(
        table, sid, doc, {'target': {'where': 'equipped', 'slot': 'carapace'}})
    assert status == 200
    assert doc['gear']['carapace'] == data.GEAR_FAMILY['bramble'][2]
    assert doc['spores'] == 100 - data.UPGRADE_SPORES[2]
    assert doc['materials']['moltings'] == 10 - data.UPGRADE_MOLTINGS[2]


def test_upgrade_rare_to_legendary_needs_ichor(table):
    sid, doc = _player_at(table, 'city_r0', spores=100)
    doc['gear'] = {'carapace': 'bramble_carapace'}      # tier-2
    doc['materials'] = {'moltings': 10, 'ichor': 0}     # no ichor yet
    status, _ = db._upgrade_gear(
        table, sid, doc, {'target': {'where': 'equipped', 'slot': 'carapace'}})
    assert status == 409                                 # gated by ichor
    doc['materials']['ichor'] = data.UPGRADE_ICHOR[3]
    status, _ = db._upgrade_gear(
        table, sid, doc, {'target': {'where': 'equipped', 'slot': 'carapace'}})
    assert status == 200
    assert doc['gear']['carapace'] == data.GEAR_FAMILY['bramble'][3]
    assert doc['materials']['ichor'] == 0


def test_upgrade_legendary_is_max(table):
    sid, doc = _player_at(table, 'city_r0', spores=100)
    doc['gear'] = {'carapace': 'bramble_aegis'}         # tier-3, top rung
    doc['materials'] = {'moltings': 99, 'ichor': 99}
    status, _ = db._upgrade_gear(
        table, sid, doc, {'target': {'where': 'equipped', 'slot': 'carapace'}})
    assert status == 409


def test_upgrade_stash_piece(table):
    sid, doc = _player_at(table, 'city_r0', spores=100)
    doc['gearStash'] = ['bramble_hide']
    doc['materials'] = {'moltings': 10, 'ichor': 0}
    status, _ = db._upgrade_gear(
        table, sid, doc, {'target': {'where': 'stash', 'index': 0}})
    assert status == 200
    assert doc['gearStash'][0] == data.GEAR_FAMILY['bramble'][2]


def test_equip_from_stash_into_empty_slot(table):
    sid, doc = _player_at(table, 'city_r0')
    doc['gear'] = {}
    doc['gearStash'] = ['bramble_hide']
    status, _ = db._equip_gear(table, sid, doc, {'index': 0})
    assert status == 200
    assert doc['gear']['carapace'] == 'bramble_hide'
    assert doc['gearStash'] == []                       # consumed the slot


def test_equip_from_stash_swaps_worn_piece_back(table):
    sid, doc = _player_at(table, 'city_r0')
    doc['gear'] = {'carapace': 'chitin_scrap'}
    doc['gearStash'] = ['bramble_hide']
    status, _ = db._equip_gear(table, sid, doc, {'index': 0})
    assert status == 200
    assert doc['gear']['carapace'] == 'bramble_hide'
    assert doc['gearStash'] == ['chitin_scrap']          # worn piece returned to stash


def test_equip_bad_index_errors(table):
    sid, doc = _player_at(table, 'city_r0')
    doc['gearStash'] = []
    status, _ = db._equip_gear(table, sid, doc, {'index': 0})
    assert status == 409


def test_upgrade_insufficient_spores_errors(table):
    sid, doc = _player_at(table, 'city_r0', spores=0)
    doc['gear'] = {'carapace': 'bramble_hide'}
    doc['materials'] = {'moltings': 10, 'ichor': 0}
    status, _ = db._upgrade_gear(
        table, sid, doc, {'target': {'where': 'equipped', 'slot': 'carapace'}})
    assert status == 409
