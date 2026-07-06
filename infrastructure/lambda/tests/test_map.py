"""Board-graph invariants from the GDD §6 space-distribution table."""
import sys
from collections import Counter, deque
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parents[1]))

from undercity_data import MAP_NODES, GATE_NODE, BOSS_NODE, WARP_NODES, SHOP_TIERS


def test_forty_nodes():
    assert len(MAP_NODES) == 40


def test_space_type_distribution():
    counts = Counter(n['type'] for n in MAP_NODES.values())
    assert counts == {
        'loot': 8, 'wild': 8, 'mystery': 7, 'shop': 3, 'shrine': 3,
        'hazard': 5, 'warp': 3, 'gate': 1, 'boss': 1, 'ossuary': 1,
    }


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


def test_shop_tiers_cover_all_shops():
    shops = {nid for nid, n in MAP_NODES.items() if n['type'] == 'shop'}
    assert set(SHOP_TIERS) == shops
    assert sorted(SHOP_TIERS.values()) == [1, 2, 3]


def test_every_tier2_form_offers_exactly_two_apexes():
    from undercity_data import TIER2, apex_options
    for fid in TIER2:
        assert len(apex_options(fid)) == 2, fid
