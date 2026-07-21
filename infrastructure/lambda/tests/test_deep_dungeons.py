"""Deep sigil dungeon feature: illuminating gear, rest, trove, depths respawn."""
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


# ── Illuminating gear (replaced the universal Swamp Torch) ───────────────────
# Light is now a property of specific gear: equip an illuminating piece and the
# whole dungeon reveals (client-side fog). No universal toggle, no combat penalty.

def test_illuminating_gear_exists():
    lights = {gid: g for gid, g in data.GEAR.items() if g.get('light') == 'full'}
    # Two dedicated light items, in two different slots (fang + charm).
    assert set(lights) == {'torchfang', 'glowspore_charm'}
    assert {g['slot'] for g in lights.values()} == {'fang', 'charm'}


def test_illuminating_gear_has_no_combat_penalty(table):
    doc = _join(table)
    base = engine.effective_stats(doc)
    # Equipping the Torchfang adds only its declared stats — no hidden penalty
    # for carrying a light (the old torch cost −3 ATK / −2 DEF while lit).
    doc['gear'] = {'fang': 'torchfang'}
    lit = engine.effective_stats(doc)
    tf = data.GEAR['torchfang']
    assert lit['atk'] == base['atk'] + tf.get('atk', 0)
    assert lit['def'] == base['def'] + tf.get('def', 0)


def test_toggle_torch_action_removed(table):
    _join(table)
    status, resp = act(table, 'toggle-torch')
    assert status == 400
    assert 'Unknown action' in resp['error']


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


# ── Post-boss escape ladder (specs/2026-07-20-undercity-escape-ladder-*) ──────
# A rusty escape ladder appears beside each sigil lair once you personally clear
# it, teleporting you one-way up to the surface mouth.

@pytest.mark.parametrize('biome', sorted(data.BIOMES))
def test_escape_ladder_adjacent_to_each_sigil_lair(biome):
    esc, lair = biome + '_esc', biome + '_lair'
    assert data.ESCAPE_LADDERS[esc] == lair
    node = data.MAP_NODES[esc]
    assert node['type'] == 'ladder'
    assert node['region'] == 'depths'
    assert node['neighbors'] == [lair]                # degree-1 spur, only the lair
    assert esc in data.MAP_NODES[lair]['neighbors']   # reciprocal edge


@pytest.mark.parametrize('biome', sorted(data.BIOMES))
def test_dungeon_entrance_ignores_escape_ladder(biome):
    # The mouth (respawn point) is <biome>_lb, never the escape spur.
    assert data.dungeon_entrance(biome) == biome + '_lb'


def test_escape_ladder_blocked_until_claimed(table):
    doc = _join(table)                       # fresh join: poiClaims empty
    assert set(data.ESCAPE_LADDERS) <= db._blocked_nodes(doc)
    doc['position'] = 'city_lair'
    dests = engine.legal_destinations(
        data.MAP_NODES, 'city_lair', 1,
        db._closed_barriers(table, _sid(table)), db._blocked_nodes(doc))
    assert 'city_esc' not in dests           # not reachable while unclaimed


def test_escape_ladder_reachable_once_claimed(table):
    doc = _join(table)
    doc['poiClaims'] = ['city_lair']         # you personally cleared this lair
    assert 'city_esc' not in db._blocked_nodes(doc)
    dests = engine.legal_destinations(
        data.MAP_NODES, 'city_lair', 1,
        db._closed_barriers(table, _sid(table)), db._blocked_nodes(doc))
    assert 'city_esc' in dests               # one hop off the lair
    # A lair you have NOT claimed stays barred even for a claimed player.
    assert 'bog_esc' in db._blocked_nodes(doc)


def test_landing_escape_ladder_exits_to_surface_mouth(table):
    doc = _join(table)
    doc['poiClaims'] = ['city_lair']
    doc['position'] = 'city_esc'
    doc['restsUsed'] = ['some_rest']         # left over from the descent
    ev = db._resolve_space(table, _sid(table), doc, 'city_esc', 'city_lair')
    assert ev['type'] == 'ladder'
    assert doc['position'] == 'city_lt'      # teleported up to the surface mouth
    assert doc['restsUsed'] == []            # leaving the depths resets rest


def test_landing_normal_entrance_ladder_does_not_teleport(table):
    doc = _join(table)
    doc['position'] = 'city_lb'              # the maze mouth, a normal ladder
    ev = db._resolve_space(table, _sid(table), doc, 'city_lb', None)
    assert ev['type'] == 'ladder'
    assert doc['position'] == 'city_lb'      # normal ladders don't relocate


def test_wild_warp_never_targets_escape_ladder(monkeypatch):
    captured = {}

    class _Stub:
        def choice(self, seq):
            captured['opts'] = list(seq)
            return captured['opts'][0]

    monkeypatch.setattr(db, '_rng', _Stub())
    db._wild_warp_dest('cavern_r0')
    assert not (set(captured['opts']) & set(data.ESCAPE_LADDERS))
