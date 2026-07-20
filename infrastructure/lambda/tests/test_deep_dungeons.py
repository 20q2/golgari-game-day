"""Deep sigil dungeon feature: torch, rest, trove, depths respawn."""
import sys
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parents[1]))

import undercity_data as data
import undercity_db as db
import undercity_engine as engine
from tests.test_undercity_db import act, table, _sid  # reuse harness + fixture


def _join(t, **kw):
    kw.setdefault('starter', 'pest')
    act(t, 'join', **kw)
    return db._get_player(t, _sid(t), 'user-alex')


def test_torch_toggle_applies_combat_penalty(table):
    doc = _join(table)
    base = engine.effective_stats(doc)
    status, resp = act(table, 'toggle-torch')
    assert status == 200
    assert resp['you']['torchLit'] is True
    lit = engine.effective_stats(db._get_player(table, _sid(table), 'user-alex'))
    assert lit['atk'] == base['atk'] + data.TORCH['atk']   # atk is negative
    assert lit['def'] == base['def'] + data.TORCH['def']
    # Toggling again douses it, restoring stats.
    status, resp = act(table, 'toggle-torch')
    assert resp['you']['torchLit'] is False
    restored = engine.effective_stats(db._get_player(table, _sid(table), 'user-alex'))
    assert restored['atk'] == base['atk']


def test_torch_penalty_floors_at_one(table):
    doc = _join(table)
    doc['atk'] = 1
    doc['def'] = 1
    db._put_player(table, doc)
    act(table, 'toggle-torch')
    lit = engine.effective_stats(db._get_player(table, _sid(table), 'user-alex'))
    assert lit['atk'] >= 1 and lit['def'] >= 1


def test_rest_heals_once_per_descent(table):
    doc = _join(table)
    eff = engine.effective_stats(doc)
    doc['hp'] = 5
    doc['restsUsed'] = []
    db._put_player(table, doc)
    ev = db._rest(table, _sid(table), doc, 'city_rest')
    assert ev['type'] == 'rest'
    assert doc['hp'] == eff['maxHp']            # healed to full
    assert 'city_rest' in doc['restsUsed']
    # Second visit this descent: no heal.
    doc['hp'] = 5
    ev2 = db._rest(table, _sid(table), doc, 'city_rest')
    assert doc['hp'] == 5
    assert 'already' in ev2['text'].lower()


def test_leaving_depths_resets_rest(table):
    doc = _join(table)
    doc['restsUsed'] = ['city_rest']
    db._put_player(table, doc)
    # Landing on a surface (non-depths) node clears the per-descent record.
    surface = next(n for n, spec in data.MAP_NODES.items()
                   if spec.get('region') == 'city' and spec['type'] == 'loot')
    db._resolve_space(table, _sid(table), doc, surface, None)
    assert doc.get('restsUsed', []) == []


def test_trove_pays_once_with_guaranteed_gear(table, monkeypatch):
    doc = _join(table)
    before = doc.get('spores', 0)
    # Force the gear roll to a known upgrade so the guarantee is observable.
    monkeypatch.setattr(db, '_roll_gear_drop',
                        lambda d, tiers: {'outcome': 'equipped', 'id': 'wurm_tooth'})
    ev = db._trove(table, _sid(table), doc, 'city_trove')
    assert ev['type'] == 'trove'
    assert doc['spores'] == before + data.TROVE_REWARD['spores']
    assert ev['gear']['id'] == 'wurm_tooth'
    assert 'trove:city_trove' in doc['poiClaims']
    # Second visit: looted bare, no double pay.
    doc['spores'] = 0
    ev2 = db._trove(table, _sid(table), doc, 'city_trove')
    assert doc['spores'] == 0
    assert 'gear' not in ev2


def test_compost_in_depths_respawns_at_entrance(table):
    doc = _join(table, home='city')
    entrance = data.dungeon_entrance('city')
    assert entrance and data.MAP_NODES[entrance]['region'] == 'depths'
    # Pretend the player died deep in the city dungeon.
    deep = next(n for n, spec in data.MAP_NODES.items()
                if data.dungeon_biome(n) == 'city' and n != entrance)
    doc['position'] = deep
    doc['hp'] = 1
    db._compost(table, _sid(table), doc, 'test death')
    assert doc['position'] == entrance
    assert 'pendingRespawn' not in doc          # no choice for a depths death


def test_compost_on_surface_unchanged(table):
    doc = _join(table, home='city')
    home_gate = data.HOME_GATES['city']
    doc['position'] = home_gate
    db._compost(table, _sid(table), doc, 'test death')
    assert doc['position'] == home_gate


# ── The deep-dungeon mazes (all five biomes) ─────────────────────────────────
import collections
import pytest


def _depths(biome):
    return {n for n, spec in data.MAP_NODES.items()
            if spec.get('region') == 'depths' and n.split('_')[0] == biome}


def _bfs_hops(start, goal):
    seen = {start}
    q = collections.deque([(start, 0)])
    while q:
        cur, d = q.popleft()
        if cur == goal:
            return d
        for nb in data.MAP_NODES[cur]['neighbors']:
            if nb not in seen:
                seen.add(nb)
                q.append((nb, d + 1))
    return None


@pytest.mark.parametrize('biome', sorted(data.BIOMES))
def test_maze_is_large_dark_and_complete(biome):
    nodes = _depths(biome)
    assert len(nodes) >= 24, f'{biome} dungeon should be a real maze, not a pocket'
    types = collections.Counter(data.MAP_NODES[n]['type'] for n in nodes)
    assert types['trove'] == 1
    assert types['rest'] == 1
    assert types['lair'] == 1
    assert types['ladder'] >= 1
    # Every depths node reachable from the entrance mouth.
    entrance = data.dungeon_entrance(biome)
    for n in nodes:
        assert _bfs_hops(entrance, n) is not None, f'{n} is stranded'
    # The lair sits a real journey from the mouth (>= 6 hops of shortest path;
    # actual travel is longer once exact-count movement is applied).
    lair = next(n for n in nodes if data.MAP_NODES[n]['type'] == 'lair')
    assert _bfs_hops(entrance, lair) >= 6


@pytest.mark.parametrize('biome', sorted(data.BIOMES))
def test_maze_edges_are_symmetric(biome):
    for n in _depths(biome):
        for nb in data.MAP_NODES[n]['neighbors']:
            assert n in data.MAP_NODES[nb]['neighbors'], f'{n}->{nb} not mutual'


@pytest.mark.parametrize('biome', sorted(data.BIOMES))
def test_maze_trove_and_rest_are_dead_ends(biome):
    # Hidden rooms hang off branch tips so a dark beeline misses them.
    for t in ('trove', 'rest'):
        node = next(n for n in _depths(biome) if data.MAP_NODES[n]['type'] == t)
        assert len(data.MAP_NODES[node]['neighbors']) == 1, f'{biome} {t} not a dead end'


@pytest.mark.parametrize('biome', sorted(data.BIOMES))
def test_lair_still_grants_the_sigil(biome):
    lair = next(n for n in _depths(biome) if data.MAP_NODES[n]['type'] == 'lair')
    assert lair in data.SIGIL_LAIRS and data.SIGIL_LAIRS[lair] == biome
