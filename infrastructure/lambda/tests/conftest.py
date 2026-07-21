"""Shared test setup. Procedural dungeon generation is ON in production but OFF
by default in tests: the legacy suite assumes the committed depths, and leaving
generation off keeps season-start fast and deterministic. Tests that exercise
generation opt in with `monkeypatch.setattr(data, 'PROCEDURAL_DUNGEONS', True)`."""
import sys
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parents[1]))

import pytest
import undercity_data as data


@pytest.fixture(autouse=True)
def _procedural_off(monkeypatch):
    monkeypatch.setattr(data, 'PROCEDURAL_DUNGEONS', False)
