"""Board-graph invariants from the GDD §6 space-distribution table."""
import sys
from collections import Counter, deque
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parents[1]))

from undercity_data import MAP_NODES, GATE_NODE, BOSS_NODE, WARP_NODES


def test_node_count():
    # v4: five home-biome rings (10 spaces + 2 inner + a 7-node dungeon pocket
    # each), pentagon tunnels, the island, and two barrier-gated side pockets.
    assert len(MAP_NODES) == 121


def test_space_type_distribution():
    counts = Counter(n['type'] for n in MAP_NODES.values())
    assert counts == {
        'gate': 5, 'loot': 18, 'wild': 31, 'shop': 5, 'mystery': 12,
        'hazard': 14, 'warp': 6, 'shrine': 4, 'ladder': 10, 'lair': 6,
        'ossuary': 2, 'boss': 1, 'barrier': 2, 'vault': 1, 'trading_post': 1,
        'excavation': 3,
    }


def test_five_home_gates():
    from undercity_data import HOME_GATES, BIOMES
    assert set(HOME_GATES) == set(BIOMES)
    for gate in HOME_GATES.values():
        assert MAP_NODES[gate]['type'] == 'gate'


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
