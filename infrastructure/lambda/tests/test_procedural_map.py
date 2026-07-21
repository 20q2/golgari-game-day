"""Procedural dungeons Phase A: per-season map plumbing (generation still off)."""
import sys
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parents[1]))

import undercity_data as data
import undercity_db as db
import undercity_engine as engine
from tests.test_undercity_db import act, table, _sid  # reuse harness + fixture


def test_flag_defaults_off():
    assert data.PROCEDURAL_DUNGEONS is False


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
