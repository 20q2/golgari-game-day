"""Procedural dungeon generator (Phase B): pure, deterministic, contract-checked."""
import sys
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parents[1]))

import random
import undercity_mapgen as gen


def test_seed_is_deterministic_and_biome_specific():
    assert gen._seed_int('night-1', 'city') == gen._seed_int('night-1', 'city')
    assert gen._seed_int('night-1', 'city') != gen._seed_int('night-1', 'bog')
    assert gen._seed_int('night-1', 'city') != gen._seed_int('night-2', 'city')


def test_carve_spans_every_cell_connected():
    rng = random.Random(1)
    cells, adj = gen._carve(rng, 4, 5)
    assert len(cells) == 20
    # spanning tree: every cell reachable from (0,0), edges symmetric
    seen, stack = {(0, 0)}, [(0, 0)]
    while stack:
        cur = stack.pop()
        for nb in adj[cur]:
            assert cur in adj[nb]                 # symmetric
            if nb not in seen:
                seen.add(nb); stack.append(nb)
    assert seen == set(cells)


def test_bfs_hop_distances():
    # a straight 1x4 corridor: distances 0,1,2,3
    rng = random.Random(0)
    cells, adj = gen._carve(rng, 1, 4)
    dist = gen._bfs(adj, (0, 0))
    assert dist == {(0, 0): 0, (0, 1): 1, (0, 2): 2, (0, 3): 3}
