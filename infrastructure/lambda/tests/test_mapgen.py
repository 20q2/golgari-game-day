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


import pytest
from undercity_data import BIOMES


def _by_id(nodes):
    return {n['id']: n for n in nodes}


def _in_pocket_neighbors(node, ids):
    return [x for x in node['neighbors'] if x in ids]


@pytest.mark.parametrize('biome', sorted(BIOMES))
@pytest.mark.parametrize('salt', range(8))     # 8 different layouts per biome
def test_generated_pocket_satisfies_every_contract(biome, salt):
    nodes = gen.generate_depths(gen._seed_int(f'season-{salt}', biome), biome)
    ids = {n['id'] for n in nodes}
    by = _by_id(nodes)

    assert len(nodes) >= gen.MIN_NODES
    assert all(nid.split('_')[0] == biome for nid in ids)
    assert all(n['region'] == 'depths' for n in nodes)
    assert all(n['type'] in gen._DEPTHS_PALETTE for n in nodes)

    for suf in ('lb', 'lair', 'cache', 'trove', 'rest', 'esc'):
        assert sum(1 for n in nodes if n['id'] == f'{biome}_{suf}') == 1
    assert by[f'{biome}_lb']['type'] == 'ladder'
    assert by[f'{biome}_esc']['type'] == 'ladder'

    # trove / rest are dead ends within the pocket
    for suf in ('trove', 'rest'):
        assert len(_in_pocket_neighbors(by[f'{biome}_{suf}'], ids)) == 1
    # escape spur: only the lair, reciprocated
    assert by[f'{biome}_esc']['neighbors'] == [f'{biome}_lair']
    assert f'{biome}_esc' in by[f'{biome}_lair']['neighbors']
    # mouth bridges to the fixed surface ladder-top
    assert f'{biome}_lt' in by[f'{biome}_lb']['neighbors']

    # symmetric within the pocket
    for n in nodes:
        for nb in _in_pocket_neighbors(n, ids):
            assert n['id'] in by[nb]['neighbors']

    # reachable from the mouth, and the lair is a real journey (>= 6 hops)
    seen, stack = {f'{biome}_lb'}, [f'{biome}_lb']
    dist = {f'{biome}_lb': 0}
    while stack:
        cur = stack.pop()
        for nb in _in_pocket_neighbors(by[cur], ids):
            if nb not in seen:
                seen.add(nb); dist[nb] = dist[cur] + 1; stack.append(nb)
    assert seen == ids
    assert dist[f'{biome}_lair'] >= gen.LAIR_MIN_HOPS


@pytest.mark.parametrize('biome', sorted(BIOMES))
def test_generation_is_deterministic(biome):
    seed = gen._seed_int('same-night', biome)
    assert gen.generate_depths(seed, biome) == gen.generate_depths(seed, biome)


def test_generate_all_depths_covers_every_biome_with_unique_ids():
    nodes = gen.generate_all_depths('night-42')
    ids = [n['id'] for n in nodes]
    assert len(ids) == len(set(ids))                       # no duplicate ids
    for biome in BIOMES:
        assert f'{biome}_lair' in ids and f'{biome}_lb' in ids and f'{biome}_esc' in ids
    # every node is a depths node belonging to some biome
    assert all(n['region'] == 'depths' for n in nodes)
    assert all(n['id'].split('_')[0] in BIOMES for n in nodes)


def test_different_nights_differ():
    a = gen.generate_all_depths('night-A')
    b = gen.generate_all_depths('night-B')
    assert a != b                                          # fresh maze each night


def test_same_night_is_reproducible():
    assert gen.generate_all_depths('night-A') == gen.generate_all_depths('night-A')
