"""Grime Gorger: Gorge (items -> Mulch) and Reclaim (Mulch -> board edits).
Design: specs/2026-08-10-undercity-grime-gorger-design.md"""
import sys, os

sys.path.insert(0, os.path.join(os.path.dirname(__file__), '..'))

import undercity_db as db
import undercity_data as data
import undercity_config as config


def test_apex_entry_is_wired():
    apex = data.APEX['grime_gorger']
    assert apex['name'] == 'Grime Gorger'
    assert apex['passives'] == ['gorge', 'reclaim']
    assert apex['bonus'] == {'maxHp': 8, 'def': 2}
    assert sorted(apex['from']) == ['brackish_trudge', 'shambling_shell',
                                    'woodwraith_strangler']


def test_reclaim_price_list_and_sources():
    # hazard is a legal source but never a target: the Gorger eats filth,
    # it does not spread it.
    assert 'hazard' in data.RECLAIM_SOURCES
    assert 'hazard' not in config.RECLAIM_PRICES
    # Dig sites / veins / shops are the reverse: creatable, never overwritable.
    for t in ('crystal_vein', 'excavation', 'shop'):
        assert t in config.RECLAIM_PRICES
        assert t not in data.RECLAIM_SOURCES
    # Topology and unique landmarks are neither.
    for t in ('gate', 'warp', 'ladder', 'tunnel', 'barrier',
              'vault', 'vault_lock', 'shrine', 'witch', 'ossuary', 'boss'):
        assert t not in config.RECLAIM_PRICES
        assert t not in data.RECLAIM_SOURCES
    assert config.RECLAIM_SURFACE_ONLY == ('rest', 'shop')
    assert config.RECLAIM_MAX_CLAIMS == 3


def test_every_price_list_target_is_a_real_node_type():
    """A typo in the price list would sell a space type the resolver cannot
    handle, stranding the buyer on a dead tile."""
    real = {n['type'] for n in data.MAP_NODES.values()}
    assert set(config.RECLAIM_PRICES) <= real


def test_mulch_yields():
    assert config.GORGE_MULCH_CONSUMABLE == {1: 1, 2: 2, 3: 3, 4: 4}
    assert config.GORGE_MULCH_GEAR == {1: 2, 2: 4, 3: 6, 4: 8}
    assert config.GORGE_BAG_SIZE == 10


from test_undercity_db import table, act, _player_at, _sid  # noqa: F401,E402


def _gorger(table, node='cavern_r2'):
    """A joined player at `node`, evolved all the way to Grime Gorger.
    Returns (sid, doc). The doc is NOT saved; callers pass it to handlers."""
    sid, doc = _player_at(table, node)
    doc['species'] = 'pest'
    doc['form'] = 'grime_gorger'
    doc['tier'] = 3
    doc['level'] = 10
    doc['passives'] = ['gorge', 'reclaim']
    doc['mulch'] = 0
    return sid, doc


def test_evolving_into_the_gorger_grants_both_passives(table):
    sid, doc = _player_at(table, 'cavern_r2')
    doc['species'] = 'pest'
    doc['form'] = 'brackish_trudge'
    doc['tier'] = 2
    doc['level'] = 10
    doc['passives'] = ['bog_forager']
    db._put_player(table, doc)
    status, body = act(table, 'evolve', form='grime_gorger')
    assert status == 200, body
    assert body['you']['passives'] == ['bog_forager', 'gorge', 'reclaim']
    assert body['you']['tier'] == 3


def test_single_passive_forms_are_unchanged_by_the_list_support(table):
    sid, doc = _player_at(table, 'cavern_r2')
    doc['species'] = 'zombie'
    doc['form'] = 'shambling_shell'
    doc['tier'] = 2
    doc['level'] = 10
    doc['passives'] = ['spikeshell']
    db._put_player(table, doc)
    status, body = act(table, 'evolve', form='grave_titan')
    assert status == 200, body
    assert body['you']['passives'] == ['spikeshell', 'colossus']


# ── Gorge: items -> Mulch ────────────────────────────────────────────────────

def _first_gear_of_tier(tier):
    return next(gid for gid, g in data.GEAR.items() if g['tier'] == tier)


def _first_consumable_of_tier(tier):
    return next(cid for cid, c in data.CONSUMABLES.items() if c['tier'] == tier)


def test_gorge_gear_credits_mulch_by_rarity(table):
    for tier, expected in config.GORGE_MULCH_GEAR.items():
        sid, doc = _gorger(table)
        doc['gearStash'] = [_first_gear_of_tier(tier)]
        status, body = db._gorge(table, sid, doc, {'kind': 'gear', 'index': 0})
        assert status == 200, body
        assert body['you']['mulch'] == expected, tier
        assert body['you']['gearStash'] == []


def test_gorge_consumable_credits_mulch_by_rarity(table):
    for tier, expected in config.GORGE_MULCH_CONSUMABLE.items():
        sid, doc = _gorger(table)
        doc['bag'] = [_first_consumable_of_tier(tier)]
        status, body = db._gorge(table, sid, doc, {'kind': 'consumable', 'index': 0})
        assert status == 200, body
        assert body['you']['mulch'] == expected, tier
        assert body['you']['bag'] == []


def test_gorge_accumulates(table):
    """Two devours in a row through the real action path — which re-reads the
    doc each time, so this also proves the save is not tripping the optimistic
    `ver` guard between turns."""
    sid, doc = _gorger(table)
    doc['gearStash'] = [_first_gear_of_tier(1), _first_gear_of_tier(1)]
    db._put_player(table, doc)
    assert act(table, 'gorge', kind='gear', index=0)[0] == 200
    status, body = act(table, 'gorge', kind='gear', index=0)
    assert status == 200, body
    assert body['you']['mulch'] == 4
    assert body['you']['gearStash'] == []


def test_gorge_rejects_non_gorgers(table):
    sid, doc = _player_at(table, 'cavern_r2')
    doc['gearStash'] = [_first_gear_of_tier(1)]
    status, body = db._gorge(table, sid, doc, {'kind': 'gear', 'index': 0})
    assert status == 400
    assert doc['gearStash'] == [_first_gear_of_tier(1)]  # item untouched


def test_gorge_rejects_bad_slot(table):
    sid, doc = _gorger(table)
    doc['gearStash'] = []
    status, body = db._gorge(table, sid, doc, {'kind': 'gear', 'index': 0})
    assert status == 409
    status, body = db._gorge(table, sid, doc, {'kind': 'pets', 'index': 0})
    assert status == 400


def test_gorge_is_registered_as_an_action(table):
    sid, doc = _gorger(table)
    doc['gearStash'] = [_first_gear_of_tier(2)]
    db._put_player(table, doc)
    status, body = act(table, 'gorge', kind='gear', index=0)
    assert status == 200, body
    assert body['you']['mulch'] == 4


# ── The reclaimed-space override layer ───────────────────────────────────────

def _write_claim(table, sid, node, ntype, orig, by='user-alex'):
    table.put_item(Item={'pk': db._season_pk(sid), 'sk': f'RECLAIM#{node}',
                         'node': node, 'type': ntype, 'origType': orig,
                         'price': 10, 'by': by, 'byName': 'Alex'})


def test_effective_type_falls_back_to_the_map(table):
    sid, _ = _player_at(table, 'cavern_r2')
    nodes = db._season_map(table, sid)
    assert db._effective_type(table, sid, 'cavern_r2') == nodes['cavern_r2']['type']


def test_effective_type_honours_a_claim(table):
    sid, _ = _player_at(table, 'cavern_r2')
    _write_claim(table, sid, 'cavern_r2', 'loot', 'wild')
    assert db._effective_type(table, sid, 'cavern_r2') == 'loot'


def test_claim_does_not_mutate_the_shared_node_graph(table):
    """Regression guard: _season_map returns data.MAP_NODES by reference when
    PROCEDURAL_DUNGEONS is off, so writing a claim must never touch it."""
    sid, _ = _player_at(table, 'cavern_r2')
    before = data.MAP_NODES['cavern_r2']['type']
    _write_claim(table, sid, 'cavern_r2', 'loot', before)
    assert data.MAP_NODES['cavern_r2']['type'] == before


def test_landing_resolves_as_the_claimed_type(table):
    sid, doc = _player_at(table, 'cavern_r2')   # 'wild' in the committed map
    _write_claim(table, sid, 'cavern_r2', 'loot', 'wild')
    ev = db._resolve_space(table, sid, doc, 'cavern_r2', 'cavern_r1')
    assert ev['type'] in ('loot', 'loot_puzzle')  # never a wild battle


# ── Reclaim: Mulch -> board edits ────────────────────────────────────────────

def _node_of_type(table, sid, ntype, region=None):
    nodes = db._season_map(table, sid)
    return next(nid for nid, n in nodes.items()
                if n['type'] == ntype and (region is None or n['region'] == region))


def test_reclaim_rewrites_a_space_and_charges_the_price(table):
    sid, doc = _gorger(table)
    node = _node_of_type(table, sid, 'wild')
    doc['position'] = node
    doc['mulch'] = 50
    status, body = db._reclaim(table, sid, doc, {'target': 'loot'})
    assert status == 200, body
    assert body['you']['mulch'] == 50 - config.RECLAIM_PRICES['loot']
    assert db._effective_type(table, sid, node) == 'loot'


def test_reclaim_rejects_non_gorgers(table):
    sid, doc = _player_at(table, 'cavern_r2')
    doc['position'] = _node_of_type(table, sid, 'wild')
    doc['mulch'] = 99
    status, _ = db._reclaim(table, sid, doc, {'target': 'loot'})
    assert status == 400


def test_reclaim_refuses_topology_and_landmarks_as_sources(table):
    sid, doc = _gorger(table)
    doc['mulch'] = 999
    for protected in ('gate', 'shop', 'ladder', 'barrier'):
        doc['position'] = _node_of_type(table, sid, protected)
        status, body = db._reclaim(table, sid, doc, {'target': 'loot'})
        assert status == 409, (protected, body)


def test_hazard_is_a_source_but_never_a_target(table):
    sid, doc = _gorger(table)
    doc['mulch'] = 999
    # Overwriting a hazard is the whole fantasy: it eats filth.
    doc['position'] = _node_of_type(table, sid, 'hazard')
    status, _ = db._reclaim(table, sid, doc, {'target': 'loot'})
    assert status == 200
    # Creating one is refused: it could only ever be aimed at other players.
    doc['position'] = _node_of_type(table, sid, 'wild')
    status, _ = db._reclaim(table, sid, doc, {'target': 'hazard'})
    assert status == 400


def test_dig_sites_are_creatable_but_not_overwritable(table):
    sid, doc = _gorger(table)
    doc['mulch'] = 999
    doc['position'] = _node_of_type(table, sid, 'excavation')
    status, _ = db._reclaim(table, sid, doc, {'target': 'loot'})
    assert status == 409
    doc['position'] = _node_of_type(table, sid, 'wild')
    status, _ = db._reclaim(table, sid, doc, {'target': 'excavation'})
    assert status == 200


def test_rest_and_shop_are_refused_in_the_depths(table):
    """restsUsed is tracked per node, so creatable rest nodes underground would
    manufacture extra full heals per descent; a shop is the same failure in
    economic form."""
    for target in ('rest', 'shop'):
        sid, doc = _gorger(table)
        doc['mulch'] = 999
        doc['position'] = _node_of_type(table, sid, 'wild', region='depths')
        status, body = db._reclaim(table, sid, doc, {'target': target})
        assert status == 409, (target, body)


def test_rest_and_shop_are_allowed_on_the_surface(table):
    for target in ('rest', 'shop'):
        sid, doc = _gorger(table)
        doc['mulch'] = 999
        doc['position'] = _node_of_type(table, sid, 'wild', region='cavern')
        status, body = db._reclaim(table, sid, doc, {'target': target})
        assert status == 200, (target, body)


def test_reclaim_refuses_an_unrevealed_fog_node(table):
    sid, doc = _gorger(table)
    doc['mulch'] = 999
    doc['position'] = _node_of_type(table, sid, 'fog')
    status, _ = db._reclaim(table, sid, doc, {'target': 'loot'})
    assert status == 409
    table.put_item(Item={'pk': db._season_pk(sid),
                         'sk': f"FOG#{doc['position']}", 'revealed': True})
    status, _ = db._reclaim(table, sid, doc, {'target': 'loot'})
    assert status == 200


def test_reclaim_refuses_a_no_op_target(table):
    sid, doc = _gorger(table)
    doc['mulch'] = 999
    doc['position'] = _node_of_type(table, sid, 'trove')
    status, _ = db._reclaim(table, sid, doc, {'target': 'trove'})
    assert status == 400


def test_reclaim_refuses_another_players_claim(table):
    sid, doc = _gorger(table)
    doc['mulch'] = 999
    node = _node_of_type(table, sid, 'wild')
    _write_claim(table, sid, node, 'loot', 'wild', by='user-someone-else')
    doc['position'] = node
    status, _ = db._reclaim(table, sid, doc, {'target': 'cache'})
    assert status == 409


def test_a_created_shop_serves_stock(table):
    """Shop stock reaches the client through state's `bazaars` map, which is
    seeded per node. That seeding must honour the claim override or the buyer
    stands on a Bazaar Post with nothing for sale."""
    sid, doc = _gorger(table)
    doc['mulch'] = 999
    node = _node_of_type(table, sid, 'wild', region='cavern')
    doc['position'] = node
    db._put_player(table, doc)
    assert act(table, 'reclaim', target='shop')[0] == 200

    status, body = db.handle_state(table, {'userId': 'user-alex'})
    assert status == 200, body
    stock = body['bazaars'][node]
    assert stock['gear'] or stock['consumables']
    # And landing there greets you as a bazaar rather than a wild.
    doc = db._get_player(table, sid, 'user-alex')
    assert db._resolve_space(table, sid, doc, node, None)['type'] == 'shop'


def test_a_created_dig_site_and_vein_render_as_facilities(table):
    """Same seeding trap as the shop: excavation views and vein depth are built
    off node type, so a bought Dig Site must appear in `excavations`."""
    sid, doc = _gorger(table)
    doc['mulch'] = 999
    node = _node_of_type(table, sid, 'wild', region='cavern')
    doc['position'] = node
    db._put_player(table, doc)
    assert act(table, 'reclaim', target='excavation')[0] == 200
    status, body = db.handle_state(table, {'userId': 'user-alex'})
    assert status == 200, body
    assert node in body['excavations']


def test_insufficient_mulch_changes_nothing(table):
    sid, doc = _gorger(table)
    node = _node_of_type(table, sid, 'wild')
    doc['position'] = node
    doc['mulch'] = 3
    status, _ = db._reclaim(table, sid, doc, {'target': 'loot'})
    assert status == 409
    assert doc['mulch'] == 3
    assert db._effective_type(table, sid, node) == 'wild'


# ── The three-claim cap ──────────────────────────────────────────────────────

def _wilds(table, sid, n):
    nodes = db._season_map(table, sid)
    return [nid for nid, x in nodes.items() if x['type'] == 'wild'][:n]


def _stand_and_reclaim(table, sid, node, target, **payload):
    """Move the saved doc onto `node` and reclaim through the real action path,
    which re-reads the doc each turn (so the optimistic `ver` guard is honoured
    exactly as it is in play)."""
    doc = db._get_player(table, sid, 'user-alex')
    doc['position'] = node
    db._put_player(table, doc)
    return act(table, 'reclaim', target=target, **payload)


def _claim_three(table, sid):
    a, b, c, d = _wilds(table, sid, 4)
    for node in (a, b, c):
        assert _stand_and_reclaim(table, sid, node, 'loot')[0] == 200
    return a, b, c, d


def test_fourth_claim_is_refused_with_the_claim_list(table):
    sid, doc = _gorger(table)
    doc['mulch'] = 999
    db._put_player(table, doc)
    a, b, c, d = _claim_three(table, sid)
    status, body = _stand_and_reclaim(table, sid, d, 'loot')
    assert status == 409, body
    assert sorted(body['claims']) == sorted([a, b, c])


def test_releasing_a_claim_frees_the_slot_and_reverts_the_ground(table):
    sid, doc = _gorger(table)
    doc['mulch'] = 999
    db._put_player(table, doc)
    a, b, c, d = _claim_three(table, sid)
    status, body = _stand_and_reclaim(table, sid, d, 'loot', release=a)
    assert status == 200, body
    assert db._effective_type(table, sid, a) == 'wild'   # reverted
    assert db._effective_type(table, sid, d) == 'loot'
    assert sorted(body['you']['claims']) == sorted([b, c, d])


def test_release_must_name_one_of_your_own_claims(table):
    sid, doc = _gorger(table)
    doc['mulch'] = 999
    db._put_player(table, doc)
    a, b, c, d = _claim_three(table, sid)
    status, _ = _stand_and_reclaim(table, sid, d, 'loot', release=d)
    assert status == 409


def test_relandscaping_your_own_claim_is_not_a_new_claim(table):
    """Re-working ground you already hold costs the new type's FULL price but
    does not consume a fresh slot."""
    sid, doc = _gorger(table)
    doc['mulch'] = 999
    db._put_player(table, doc)
    a, b, c, _ = _claim_three(table, sid)
    before = db._get_player(table, sid, 'user-alex')['mulch']
    status, body = _stand_and_reclaim(table, sid, a, 'trove')
    assert status == 200, body
    assert body['you']['mulch'] == before - config.RECLAIM_PRICES['trove']
    assert len(body['you']['claims']) == 3
    assert db._effective_type(table, sid, a) == 'trove'


def test_released_claim_reverts_to_its_original_type_not_the_previous_one(table):
    sid, doc = _gorger(table)
    doc['mulch'] = 999
    db._put_player(table, doc)
    node = _node_of_type(table, sid, 'hazard')
    assert _stand_and_reclaim(table, sid, node, 'loot')[0] == 200
    assert _stand_and_reclaim(table, sid, node, 'trove')[0] == 200   # re-landscape
    a, b, c = _wilds(table, sid, 3)
    for n in (a, b):
        assert _stand_and_reclaim(table, sid, n, 'loot')[0] == 200
    assert _stand_and_reclaim(table, sid, c, 'loot', release=node)[0] == 200
    assert db._effective_type(table, sid, node) == 'hazard'   # the ORIGINAL


# ── State exposure ───────────────────────────────────────────────────────────

def test_state_exposes_bag_cap_and_mulch(table):
    sid, doc = _gorger(table)
    doc['mulch'] = 7
    db._put_player(table, doc)
    status, body = db.handle_state(table, {'userId': 'user-alex'})
    assert status == 200, body
    assert body['you']['mulch'] == 7
    assert body['you']['bagCap'] == 10


def test_state_bag_cap_is_five_for_everyone_else(table):
    _player_at(table, 'cavern_r2')
    status, body = db.handle_state(table, {'userId': 'user-alex'})
    assert body['you']['bagCap'] == 5


def test_action_responses_carry_the_bag_cap(table):
    sid, doc = _gorger(table)
    doc['gearStash'] = [_first_gear_of_tier(1)]
    db._put_player(table, doc)
    status, body = act(table, 'gorge', kind='gear', index=0)
    assert body['you']['bagCap'] == 10


def test_reclaimed_ground_is_visible_to_other_players(table):
    sid, doc = _gorger(table)
    doc['mulch'] = 99
    node = _node_of_type(table, sid, 'wild')
    doc['position'] = node
    db._put_player(table, doc)
    assert act(table, 'reclaim', target='loot')[0] == 200
    # A DIFFERENT player's state fetch must see the changed ground, or the
    # table renders two different boards.
    status, body = db.handle_state(table, {'userId': 'user-blair'})
    assert status == 200, body
    claim = body['season']['reclaimed'][node]
    assert claim['type'] == 'loot'
    assert claim['origType'] == 'wild'
    assert claim['byName'] == 'Alex'
