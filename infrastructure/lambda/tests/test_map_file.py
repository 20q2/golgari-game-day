"""Tests for the checked-in map file (source of truth for the board)."""
import json
import sys
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parents[1]))

LAMBDA_DIR = Path(__file__).resolve().parents[1]
REPO_ROOT = LAMBDA_DIR.parents[1]


def _load(p):
    return json.loads(p.read_text(encoding='utf-8'))


def test_map_file_exists_with_v2_sections():
    doc = _load(LAMBDA_DIR / 'map.json')
    assert {'worldW', 'worldH', 'gate', 'boss', 'nodes', 'regions', 'decals'} <= set(doc)
    assert len(doc['nodes']) == 124
    assert isinstance(doc['decals'], list)
    for n in doc['nodes']:
        assert n['region'] in doc['regions'], n['id']


def test_client_copy_matches_source():
    src = (LAMBDA_DIR / 'map.json').read_text(encoding='utf-8')
    pub = (REPO_ROOT / 'public' / 'data' / 'undercity-map.json').read_text(encoding='utf-8')
    assert src == pub, 'run: python infrastructure/lambda/sync_map.py'
