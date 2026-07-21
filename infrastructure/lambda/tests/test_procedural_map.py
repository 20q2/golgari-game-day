"""Procedural dungeons Phase A: per-season map plumbing (generation still off)."""
import sys
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parents[1]))

import undercity_data as data
import undercity_db as db
import undercity_engine as engine
from tests.test_undercity_db import act, table, _sid  # reuse harness + fixture


def test_procedural_dungeons_on_in_production():
    # The conftest overrides data.PROCEDURAL_DUNGEONS for tests; the production
    # default lives on the untouched config module.
    import undercity_config
    assert undercity_config.PROCEDURAL_DUNGEONS is True


def test_surface_and_committed_depths_partition_the_map():
    assert set(data.SURFACE_NODES) | set(data.COMMITTED_DEPTHS) == set(data.MAP_NODES)
    assert not (set(data.SURFACE_NODES) & set(data.COMMITTED_DEPTHS))
    assert all(n.get('region') != 'depths' for n in data.SURFACE_NODES.values())
    assert all(n.get('region') == 'depths' for n in data.COMMITTED_DEPTHS.values())


def test_merge_map_reconstructs_committed_map():
    assert data.merge_map(data.COMMITTED_DEPTHS) == data.MAP_NODES


def test_season_map_off_returns_committed_object(table, monkeypatch):
    monkeypatch.setattr(data, 'PROCEDURAL_DUNGEONS', False)
    sid = _sid(table)
    assert db._season_map(table, sid) is data.MAP_NODES   # identical object, no copy


def test_season_map_on_merges_stored_depths(table, monkeypatch):
    monkeypatch.setattr(data, 'PROCEDURAL_DUNGEONS', True)
    db._season_map_cache.clear()
    sid = _sid(table)
    stub = [{'id': 'city_lb', 'type': 'ladder', 'x': 7, 'y': 7,
             'region': 'depths', 'neighbors': []}]
    table.put_item(Item={'pk': db._season_pk(sid), 'sk': 'MAP', 'depths': stub})
    nodes = db._season_map(table, sid)
    assert nodes['city_lb']['x'] == 7          # from the stored depths
    assert 'cavern_r0' in nodes                # surface preserved
    assert 'garden_lair' not in nodes          # committed depths NOT mixed in


def test_season_map_on_falls_back_when_no_record(table, monkeypatch):
    monkeypatch.setattr(data, 'PROCEDURAL_DUNGEONS', True)
    db._season_map_cache.clear()
    sid = _sid(table)
    nodes = db._season_map(table, sid)
    assert 'city_lair' in nodes                # committed depths fallback


def test_only_season_map_reads_the_global():
    # The sole allowed reference to the raw global is _season_map's flag-off
    # return; every other read must route through _season_map(table, sid).
    src = (Path(__file__).resolve().parents[1] / 'undercity_db.py').read_text(encoding='utf-8')
    assert src.count('data.MAP_NODES') == 1, \
        'route every map read (except _season_map itself) through _season_map(table, sid)'


def test_movement_follows_generated_depths_when_on(table, monkeypatch):
    monkeypatch.setattr(data, 'PROCEDURAL_DUNGEONS', True)
    db._season_map_cache.clear()
    act(table, 'join', starter='pest', home='cavern')
    sid = _sid(table)
    # Alternate depths: cavern_lb gains a neighbor the committed map never had.
    stub = [
        {'id': 'cavern_lb', 'type': 'ladder', 'x': 100, 'y': 100,
         'region': 'depths', 'neighbors': ['cavern_x9']},
        {'id': 'cavern_x9', 'type': 'loot', 'x': 160, 'y': 100,
         'region': 'depths', 'neighbors': ['cavern_lb']},
    ]
    table.put_item(Item={'pk': db._season_pk(sid), 'sk': 'MAP', 'depths': stub})
    doc = db._get_player(table, sid, 'user-alex')
    doc['position'] = 'cavern_lb'
    dests = engine.legal_destinations(
        db._season_map(table, sid), 'cavern_lb', 1,
        db._closed_barriers(table, sid), db._blocked_nodes(doc))
    assert 'cavern_x9' in dests


def test_handle_map_returns_boardmap_shape(table):
    status, doc = db.handle_map(table, {})
    assert status == 200
    assert {'worldW', 'worldH', 'gate', 'boss', 'nodes', 'regions'} <= set(doc)
    ids = {n['id'] for n in doc['nodes']}
    assert 'cavern_r0' in ids and 'city_lair' in ids   # surface + depths both present


def test_handle_map_serves_generated_depths_when_on(table, monkeypatch):
    monkeypatch.setattr(data, 'PROCEDURAL_DUNGEONS', True)
    db._season_map_cache.clear()
    sid = _sid(table)
    stub = [{'id': 'city_lb', 'type': 'ladder', 'x': 5, 'y': 5,
             'region': 'depths', 'neighbors': []}]
    table.put_item(Item={'pk': db._season_pk(sid), 'sk': 'MAP', 'depths': stub})
    status, doc = db.handle_map(table, {})
    ids = {n['id'] for n in doc['nodes']}
    assert 'city_lb' in ids and 'garden_lair' not in ids   # night's depths, not committed


def test_season_start_stores_generated_depths(table, monkeypatch):
    monkeypatch.setattr(data, 'PROCEDURAL_DUNGEONS', True)
    db._season_map_cache.clear()
    status, resp = act(table, 'season-start', hostKey='swampking')   # fresh night, flag on
    assert status == 200
    sid = _sid(table)
    rec = db._get(table, db._season_pk(sid), 'MAP')
    assert rec and rec.get('depths')
    ids = {n['id'] for n in rec['depths']}
    for biome in data.BIOMES:
        assert f'{biome}_lair' in ids and f'{biome}_lb' in ids and f'{biome}_esc' in ids
    # It is the generator's output, not the committed fallback.
    depths = db._load_season_depths(table, sid)
    assert depths != data.COMMITTED_DEPTHS


def test_season_start_skips_generation_when_flag_off(table, monkeypatch):
    monkeypatch.setattr(data, 'PROCEDURAL_DUNGEONS', False)
    status, _ = act(table, 'season-start', hostKey='swampking')
    assert status == 200
    sid = _sid(table)
    assert db._get(table, db._season_pk(sid), 'MAP') is None   # no MAP record written


def test_generated_dungeon_is_navigable_end_to_end(table, monkeypatch):
    monkeypatch.setattr(data, 'PROCEDURAL_DUNGEONS', True)
    db._season_map_cache.clear()
    act(table, 'season-start', hostKey='swampking')
    act(table, 'join', starter='pest', home='city')
    sid = _sid(table)
    nodes = db._season_map(table, sid)
    # Stand at the generated mouth; a roll of 1 must reach a real generated node.
    doc = db._get_player(table, sid, 'user-alex')
    doc['position'] = 'city_lb'
    dests = engine.legal_destinations(nodes, 'city_lb', 1,
                                      db._closed_barriers(table, sid), db._blocked_nodes(doc))
    assert dests and all(d in nodes for d in dests)
    # The generated lair is present and still grants the city sigil.
    assert 'city_lair' in nodes and 'city_lair' in data.SIGIL_LAIRS
