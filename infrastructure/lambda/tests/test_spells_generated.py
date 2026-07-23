"""Guard: the committed client spell mirror matches the Python source."""
import sys
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parents[1]))

import sync_spells


def test_generated_spells_in_sync():
    committed = sync_spells.OUT.read_text(encoding='utf-8')
    assert committed == sync_spells.render(), \
        'run: python infrastructure/lambda/sync_spells.py'
