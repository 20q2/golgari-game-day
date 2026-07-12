"""Board-graph invariants from the GDD §6 space-distribution table."""
import sys
from collections import Counter, deque
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parents[1]))

from undercity_data import MAP_NODES, GATE_NODE, BOSS_NODE, WARP_NODES


def test_node_count():
    # v6: five home-biome rings (10 spaces + 2 inner each), pentagon tunnels,
    # the island, two barrier side pockets, and five UNIQUE dungeon pockets
    # (city 7, cavern 6, bog 7, bone 6, garden 7 nodes incl. door).
    assert len(MAP_NODES) == 124


def test_space_type_distribution():
    counts = Counter(n['type'] for n in MAP_NODES.values())
    assert counts == {
        'gate': 5, 'loot': 18, 'wild': 22, 'elite': 7, 'shop': 5, 'mystery': 12,
        'hazard': 14, 'warp': 6, 'shrine': 4, 'ladder': 10, 'lair': 6,
        'ossuary': 2, 'boss': 1, 'barrier': 2, 'vault': 1, 'trading_post': 1,
        'excavation': 3, 'cache': 5,
    }


def test_dungeon_pockets_shapes():
    """Each pocket: door + lair + cache present, all degree >= 2, planar edges."""
    from undercity_data import BIOMES
    for b in BIOMES:
        pocket = {nid: n for nid, n in MAP_NODES.items()
                  if n.get('region') == 'depths' and nid.startswith(b + '_')}
        assert b + '_lb' in pocket and b + '_lair' in pocket and b + '_cache' in pocket
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


def test_every_tier2_form_offers_exactly_two_apexes():
    from undercity_data import TIER2, apex_options
    for fid in TIER2:
        assert len(apex_options(fid)) == 2, fid


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
    assert dungeon_biome('city_d0') == 'city'
    assert dungeon_biome('bog_lair') == 'bog'
    assert dungeon_biome('cavern_r3') is None      # not a depths node
    assert dungeon_biome('boss') is None
