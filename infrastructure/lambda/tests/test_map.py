"""Board-graph invariants from the GDD §6 space-distribution table."""
import sys
from collections import Counter, deque
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parents[1]))

from undercity_data import MAP_NODES, GATE_NODE, BOSS_NODE, WARP_NODES, TUNNEL_NODES, BIOMES
from undercity_engine import board_distance


def test_node_count():
    # v6: five home-biome rings (10 spaces + 2 inner each), pentagon tunnels,
    # the island, two barrier side pockets, and five UNIQUE dungeon pockets
    # (city 7, cavern 6, bog 7, bone 6, garden 7 nodes incl. door).
    # v7 (2026-07 editor pass): +7 nodes (bog loot spur, extra bone digs,
    # relocated city gate + loot), -2 garden inner spaces.
    # v8 (2026-07 editor pass): +2 nodes overall — more hazards/mystery/elites
    # and crystal veins, fewer shrines and vault-locks.
    # v9 (deep dungeons): all five sigil pockets regrown into distinct dark mazes
    # (city serpentine, cavern radial hub, bog long corridor, bone lattice,
    # garden tangle) with hidden rest/trove rooms. See
    # specs/2026-07-19-undercity-deep-dungeons-design.md.
    # v10 (2026-07-20 tunnels + wilderness): +14 wilderness nodes (a central
    # hub-and-spoke crossroads reconnecting the biomes for evolved units). See
    # specs/2026-07-20-undercity-tunnels-wilderness-design.md.
    # v11 (2026-07-20 wilderness expansion): +18 nodes (12 enrichment + a 6-node
    # isle causeway). See specs/2026-07-20-undercity-wilderness-expansion-design.md.
    # v12 (2026-07-20 boss approach loops): +10 wild guardian nodes — a 2-node
    # ring around each dead-end lair (cavern/bog/city/garden) and the island boss
    # so exact-count movement can land on them. See
    # specs/2026-07-20-undercity-boss-approach-loops-design.md.
    # v13 (2026-07-20 escape ladders): +5 post-boss escape spurs, one dead-end
    # 'ladder' node off each sigil lair; also picks up an in-flight editor pass
    # (+1 node, mystery/loot/wild retype). See
    # specs/2026-07-20-undercity-escape-ladder-design.md.
    assert len(MAP_NODES) == 273


def test_space_type_distribution():
    counts = Counter(n['type'] for n in MAP_NODES.values())
    # v9 deep dungeons: five distinct mazes add wild/hazard/loot/elite spaces
    # plus one 'rest' and one 'trove' room each (counts vary by maze shape).
    # v10 (2026-07-20 tunnels): the ten biome-boundary spur nodes retyped from
    # their old loot/hazard/elite/wild/mystery types to safe-passage 'tunnel'
    # spaces. Plus 14 wilderness nodes (cache/elite/hazard/loot/wild) forming
    # the central hub. See specs/2026-07-20-undercity-tunnels-wilderness-design.md.
    # v11 (2026-07-20 wilderness expansion): +6 elite, +8 wild, +4 hazard from
    # the 18 new wilderness/causeway nodes.
    # v12 (2026-07-20 boss approach loops): +10 wild guardian nodes ringing the
    # four biome lairs and the island boss. Also realigned elite/warp/hazard/loot
    # to the committed map (a prior editor pass reshuffled types +3/-1/-1/+2
    # without updating this table — total node count was unchanged so it slipped).
    # v13 (2026-07-20 escape ladders): +5 'ladder' (10->15), one post-boss escape
    # spur off each sigil lair. Also reflects an in-flight editor pass that
    # retyped a few spaces (loot 43->44, wild 68->66, mystery 10->12).
    # v14 (2026-07-21 island bazaar): isl_bg1 retyped mystery->shop to add the
    # central-island endgame bazaar (shop 5->6, mystery 12->11). See
    # specs/2026-07-21-undercity-bazaar-tiers-design.md.
    # v15 (2026-07-21 Umori): isl_trade retyped trading_post->mystery; the trading
    # post is now the wandering Umori (no static node). mystery 11->12, trading_post
    # removed. See specs/2026-07-21-undercity-umori-wandering-post-design.md.
    # v16 (2026-07-23 Sedgemoor Witch): bog_r7 retyped loot->witch (loot 44->43),
    # the singleton magic-crafting space. See
    # specs/2026-07-23-undercity-bog-witch-scrolls-design.md.
    assert counts == {
        'gate': 5, 'loot': 43, 'wild': 66, 'elite': 28, 'shop': 6, 'mystery': 12,
        'hazard': 45, 'warp': 5, 'shrine': 1, 'ladder': 15, 'lair': 6,
        'ossuary': 1, 'boss': 1, 'barrier': 2, 'vault': 1,
        'excavation': 4, 'cache': 6, 'crystal_vein': 4, 'vault_lock': 1,
        'rest': 5, 'trove': 5, 'tunnel': 10, 'witch': 1,
    }


def test_evolved_units_can_reach_every_biome_via_wilderness():
    # With tunnels blocked (tier 2+), the Wilderness must keep all five biomes
    # mutually reachable — no unit is ever stranded in its home biome.
    gates = {'cavern': 'cavern_r0', 'bog': 'bog_r6', 'garden': 'garden_r0',
             'city': 'city_r9', 'bone': 'bone_r1'}
    for a in gates:
        for b in gates:
            if a == b:
                continue
            d = board_distance(MAP_NODES, gates[a], gates[b], 60,
                               blocked=TUNNEL_NODES)
            assert d is not None, f'{a}->{b} unreachable for evolved units'


def test_isle_is_a_journey_via_the_wilderness():
    # Evolved units (tunnels blocked) can walk to the floating isle, but it is a
    # real trek — every biome is >= 8 hops from isl_warp through the wilderness.
    gates = {'cavern': 'cavern_r0', 'bog': 'bog_r6', 'garden': 'garden_r0',
             'city': 'city_r9', 'bone': 'bone_r1'}
    for g in gates.values():
        d = board_distance(MAP_NODES, g, 'isl_warp', 80, blocked=TUNNEL_NODES)
        assert d is not None and d >= 8, f'{g}->isl_warp too short/none: {d}'


def test_wilderness_is_not_a_home_biome():
    # It has no gate and is deliberately absent from BIOMES (no respawn/home perk).
    assert 'wilderness' not in BIOMES
    assert not any(n['type'] == 'gate' and n.get('region') == 'wilderness'
                   for n in MAP_NODES.values())


def test_dungeon_pockets_shapes():
    """Each pocket: door + lair + cache present, all degree >= 2, planar edges.

    The redesigned deep-dungeon mazes are exempt from the degree/planarity guards
    — they deliberately have dead-end branches (hidden rest/trove rooms) and are
    validated instead by tests/test_deep_dungeons.py. Dead-ends never strand a
    player: exact-count movement starts each turn with no `prev`, so the first
    step out is always legal (see engine.legal_destinations)."""
    from undercity_data import BIOMES
    REDESIGNED = set(BIOMES)  # all five mazes covered by test_deep_dungeons.py
    for b in BIOMES:
        pocket = {nid: n for nid, n in MAP_NODES.items()
                  if n.get('region') == 'depths' and nid.startswith(b + '_')}
        assert b + '_lb' in pocket and b + '_lair' in pocket and b + '_cache' in pocket
        if b in REDESIGNED:
            continue
        for nid, n in pocket.items():
            depths_deg = sum(1 for nb in n['neighbors']
                             if MAP_NODES[nb].get('region') == 'depths')
            assert depths_deg >= 2, f'{nid} strandable (degree {depths_deg} in pocket)'

        # Planarity: no two pocket edges cross (segment intersection test).
        edges = set()
        for nid, n in pocket.items():
            for nb in n['neighbors']:
                if nb in pocket:
                    edges.add(tuple(sorted((nid, nb))))
        def cross(e1, e2):
            if set(e1) & set(e2):
                return False
            (a, bb), (c, d) = e1, e2
            p = [(MAP_NODES[x]['x'], MAP_NODES[x]['y']) for x in (a, bb, c, d)]
            def cr(p1, p2, p3):
                return (p2[0]-p1[0])*(p3[1]-p1[1]) - (p2[1]-p1[1])*(p3[0]-p1[0])
            return (cr(p[0], p[1], p[2]) * cr(p[0], p[1], p[3]) < 0
                    and cr(p[2], p[3], p[0]) * cr(p[2], p[3], p[1]) < 0)
        edges = sorted(edges)
        for i in range(len(edges)):
            for j in range(i + 1, len(edges)):
                assert not cross(edges[i], edges[j]), f'{b}: {edges[i]} x {edges[j]}'


def test_five_home_gates():
    from undercity_data import HOME_GATES, BIOMES
    assert set(HOME_GATES) >= set(BIOMES)
    for gate in HOME_GATES.values():
        assert MAP_NODES[gate]['type'] == 'gate'
    # HOME_GATES is found by node type, not naming convention: each home biome
    # holds exactly one gate node, wherever the editor puts it.
    for b in BIOMES:
        gates = [n for n in MAP_NODES.values()
                 if n['region'] == b and n['type'] == 'gate']
        assert len(gates) == 1, f'{b} must hold exactly one gate'
        assert HOME_GATES[b] == gates[0]['id']


def test_gate_and_boss():
    assert MAP_NODES[GATE_NODE]['type'] == 'gate'
    assert MAP_NODES[BOSS_NODE]['type'] == 'boss'


def test_neighbors_symmetric_and_known():
    for nid, node in MAP_NODES.items():
        assert node['neighbors'], f'{nid} has no neighbors'
        for nb in node['neighbors']:
            assert nb in MAP_NODES, f'{nid} points at unknown node {nb}'
            assert nid in MAP_NODES[nb]['neighbors'], f'{nid}->{nb} not symmetric'


def test_everything_reachable_from_gate():
    # Walking edges plus warp teleports must reach every node.
    seen = {GATE_NODE}
    queue = deque([GATE_NODE])
    while queue:
        cur = queue.popleft()
        nbs = list(MAP_NODES[cur]['neighbors'])
        if MAP_NODES[cur]['type'] == 'warp':
            nbs += [w for w in WARP_NODES if w != cur]
        for nb in nbs:
            if nb not in seen:
                seen.add(nb)
                queue.append(nb)
    assert seen == set(MAP_NODES)


def test_every_tier2_form_offers_at_least_two_apexes():
    # Every T2 gives a real T3 choice (>= 2). Most offer 2; the lines that can
    # also become the Calamity Beast (design 2026-07-23 squirrel-simple) offer 3.
    from undercity_data import TIER2, apex_options
    for fid in TIER2:
        assert 2 <= len(apex_options(fid)) <= 3, (fid, apex_options(fid))


def test_dungeon_tables_cover_all_biomes():
    from undercity_data import DUNGEONS, DUNGEON_NPCS, DUNGEON_HAZARDS, BIOMES, CACHE_REWARD
    assert set(DUNGEONS) == set(BIOMES)
    assert set(DUNGEON_NPCS) == set(BIOMES)
    assert set(DUNGEON_HAZARDS) == set(BIOMES)
    for b, d in DUNGEONS.items():
        assert d['name'] and d['rite']
        assert DUNGEON_NPCS[b]['id'] == d['wild']
        assert DUNGEON_HAZARDS[b]['id'] == d['hazard']
    assert CACHE_REWARD['spores'] > 0 and CACHE_REWARD['xp'] > 0


def test_dungeon_biome_helper():
    from undercity_data import dungeon_biome
    assert dungeon_biome('city_d1') == 'city'
    assert dungeon_biome('bog_lair') == 'bog'
    assert dungeon_biome('cavern_r3') is None      # not a depths node
    assert dungeon_biome('boss') is None
