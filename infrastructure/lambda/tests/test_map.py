"""Board-graph invariants from the GDD §6 space-distribution table."""
import sys
from collections import Counter, deque
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parents[1]))

from undercity_data import (MAP_NODES, GATE_NODE, BOSS_NODE, WARP_NODES,
                            TUNNEL_NODES, BIOMES, HOME_GATES)
from undercity_engine import board_distance


def test_node_count():
    # The board is procedurally seeded and then hand-tuned in the map editor, so
    # the exact node count churns with every pass (deep-dungeon mazes, the
    # wilderness/isle, boss-approach loops, escape ladders, the Ashen Fog layer,
    # …). Rather than a snapshot that re-breaks on each edit, assert a sane floor
    # so a catastrophic deletion is still caught. (~310 nodes at time of writing.)
    assert len(MAP_NODES) >= 290


def test_space_type_distribution():
    counts = Counter(n['type'] for n in MAP_NODES.values())
    n = len(BIOMES)
    # Structural invariants only. The "fill" types (wild/loot/hazard/elite/
    # mystery/fog/warp/cache/excavation/crystal_vein/barrier) get reshuffled by
    # every map-editor pass, so pinning their exact counts is pure churn — we
    # assert the singleton feature spaces and the counts tied to fixed structure
    # (one per biome, etc.) instead. A missing boss/witch/lair still trips this.
    for singleton in ('boss', 'ossuary', 'witch', 'shrine', 'vault', 'vault_lock'):
        assert counts[singleton] == 1, f'{singleton} should be a singleton'
    assert counts['gate'] == n                # one home gate per biome
    assert counts['ladder'] == 3 * n          # per biome: _lt + _lb descent pair + _esc escape spur
    assert counts['tunnel'] == 10             # pentagon biome-boundary bridges
    assert counts['trove'] == n               # one hidden trove per dungeon
    assert counts['cache'] == n               # one first-visit cache per dungeon
    assert counts['rest'] >= n                # at least one rest room per dungeon
    assert counts['lair'] >= n                # 5 sigil lairs (+ optional ruin lairs)


def test_evolved_units_can_reach_every_biome_via_wilderness():
    # With tunnels blocked (tier 2+), the Wilderness must keep all five biomes
    # mutually reachable — no unit is ever stranded in its home biome. Gates are
    # taken from HOME_GATES (map-derived) so this survives node-id churn.
    for a, ga in HOME_GATES.items():
        for b, gb in HOME_GATES.items():
            if a == b:
                continue
            d = board_distance(MAP_NODES, ga, gb, 60, blocked=TUNNEL_NODES)
            assert d is not None, f'{a}->{b} unreachable for evolved units'


def test_isle_is_a_journey_via_the_wilderness():
    # Evolved units (tunnels blocked) can walk to the floating isle, but it is a
    # real trek — every biome is >= 8 hops from isl_warp through the wilderness.
    for b, g in HOME_GATES.items():
        d = board_distance(MAP_NODES, g, 'isl_warp', 80, blocked=TUNNEL_NODES)
        assert d is not None and d >= 8, f'{b} ({g})->isl_warp too short/none: {d}'


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
