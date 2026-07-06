"""
Dump the board graph to public/data/undercity-map.json for the Angular client.

The Python constants in undercity_data.py are the single source of truth for
node ids, types, neighbors, and layout coordinates. Rerun this after any map
change:  python infrastructure/lambda/generate_map_json.py
"""
import json
from pathlib import Path

import undercity_data as data

out_path = Path(__file__).resolve().parents[2] / 'public' / 'data' / 'undercity-map.json'
payload = {
    'worldW': 1800,
    'worldH': 1200,
    'gate': data.GATE_NODE,
    'boss': data.BOSS_NODE,
    'shopTiers': data.SHOP_TIERS,
    'nodes': list(data.MAP_NODES.values()),
}
out_path.write_text(json.dumps(payload, indent=1))
print(f'Wrote {len(data.MAP_NODES)} nodes to {out_path}')
