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
