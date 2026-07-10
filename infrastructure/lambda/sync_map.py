"""Copy the map source of truth to the client bundle. Run after hand edits.

The map editor (/undercity/map-editor) writes both copies itself; this script
covers hand edits to infrastructure/lambda/map.json. The copies-match pytest
in tests/test_map_file.py fails while they differ.
"""
import shutil
from pathlib import Path

src = Path(__file__).with_name('map.json')
dst = Path(__file__).resolve().parents[2] / 'public' / 'data' / 'undercity-map.json'
shutil.copyfile(src, dst)
print(f'{src} -> {dst}')
