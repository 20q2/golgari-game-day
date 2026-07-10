"""
One-time procedural board generator — retired from runtime use.

The live map is the checked-in `map.json` (source of truth; the map editor at
/undercity/map-editor and hand edits both write it). This module keeps the
original parametric generator so a fresh procedural board can be re-seeded if
ever wanted:  python infrastructure/lambda/map_bootstrap.py

Not imported by the Lambda.
"""
import json
import math
from pathlib import Path

from undercity_data import BIOMES, BOSS_NODE, GATE_NODE, WORLD_H, WORLD_W

ISLAND_XY = (1800, 1150)

# Ring slot types, index 0 = the space facing the island. Slot 3 is the shop,
# slot 5 (outward side) anchors the ladder down to the biome's dungeon, slot
# 9 is the shrine (the Ossuary Fields gamble den replaces theirs).
_RING_TYPES = ['gate', 'loot', 'wild', 'shop', 'mystery',
               'hazard', 'loot', 'warp', 'wild', 'shrine']
_INNER_TYPES = ['mystery', 'wild']

# v6 pocket layouts: {suffix: (type, dx, dy)} + explicit edge list. All planar.
_POCKET_LAYOUTS = {
    # The Broodwarrens — figure-8 warren, hazard at the waist.
    'city': {
        'nodes': {
            '_lb':    ('ladder', 0, -160),
            '_d0':    ('wild',   150, -60),
            '_d1':    ('hazard', 0, 20),      # the waist, degree 4
            '_d3':    ('wild',  -150, -60),
            '_lair':  ('lair',   150, 130),
            '_cache': ('cache',  0, 210),
            '_d2':    ('loot',  -150, 130),
        },
        'edges': [('_lb', '_d0'), ('_d0', '_d1'), ('_d1', '_d3'), ('_d3', '_lb'),
                  ('_d1', '_lair'), ('_lair', '_cache'), ('_cache', '_d2'),
                  ('_d2', '_d1')],
    },
    # Gloomroot Hollow — a spiral that loops back on itself.
    'cavern': {
        'nodes': {
            '_lb':    ('ladder', -200, -140),
            '_d0':    ('wild',    120, -150),
            '_d1':    ('hazard',  190, 60),
            '_d2':    ('loot',    -40, 170),
            '_lair':  ('lair',   -150, 40),
            '_cache': ('cache',   -20, -40),   # innermost coil
        },
        'edges': [('_lb', '_d0'), ('_d0', '_d1'), ('_d1', '_d2'),
                  ('_d2', '_lair'), ('_lair', '_cache'), ('_cache', '_lb')],
    },
    # The Drownedway — flooded ring with the lair on a center island chord.
    'bog': {
        'nodes': {
            '_lb':    ('ladder',  0, -180),
            '_d0':    ('wild',    180, -80),
            '_d1':    ('hazard',  200, 100),
            '_d2':    ('loot',    0, 190),
            '_d3':    ('wild',   -200, 100),
            '_cache': ('cache',  -180, -80),
            '_lair':  ('lair',    0, 0),       # the island
        },
        'edges': [('_lb', '_d0'), ('_d0', '_d1'), ('_d1', '_d2'), ('_d2', '_d3'),
                  ('_d3', '_cache'), ('_cache', '_lb'),
                  ('_d0', '_lair'), ('_lair', '_d3')],
    },
    # The Marrow Pits — 2x3 crypt grid: outer ring plus one center rung.
    'bone': {
        'nodes': {
            '_lb':    ('ladder', -170, -70),
            '_d0':    ('wild',    0, -70),
            '_d1':    ('hazard',  170, -70),
            '_lair':  ('lair',    170, 110),
            '_cache': ('cache',   0, 110),
            '_d2':    ('loot',   -170, 110),
        },
        'edges': [('_lb', '_d0'), ('_d0', '_d1'), ('_d1', '_lair'),
                  ('_lair', '_cache'), ('_cache', '_d2'), ('_d2', '_lb'),
                  ('_d0', '_cache')],
    },
    # The Rotcellar — main root loop with a deeper side loop off the junction.
    'garden': {
        'nodes': {
            '_lb':    ('ladder', 0, -170),
            '_d0':    ('wild',   160, -70),
            '_d2':    ('hazard', 0, 30),      # the junction, degree 4
            '_d1':    ('loot',  -160, -70),
            '_lair':  ('lair',   150, 140),
            '_cache': ('cache',  0, 220),
            '_d3':    ('wild',  -150, 140),
        },
        'edges': [('_lb', '_d0'), ('_d0', '_d2'), ('_d2', '_d1'), ('_d1', '_lb'),
                  ('_d2', '_lair'), ('_lair', '_cache'), ('_cache', '_d3'),
                  ('_d3', '_d2')],
    },
}

# Region metadata seeded into map.json. Backgrounds mirror what the client
# hardcoded before regions{} existed (board-canvas.ts floorSrc).
_REGION_SEED = {
    'city':   ('undercity/undercity_background.png', None),
    'cavern': ('undercity/cavern_background.png', None),
    'bog':    ('undercity/swamp_background.png', None),
    'garden': ('undercity/swamp_background.png', None),
    'bone':   ('undercity/palace_background.png', None),
    'isle':   ('undercity/palace_background.png', 'The Floating Isle'),
    'ruin':   ('undercity/palace_background.png', 'The Ruinways'),
    'depths': ('undercity/cavern_background.png', 'The Depths'),
}


def _ring_point(spec, i, base):
    """Superellipse perimeter point for ring slot `i` (of 10), local frame
    rotated by `base` so slot 0 faces the island."""
    t = i * (2 * math.pi / 10)
    ct, st = math.cos(t), math.sin(t)
    ex = 2.0 / spec.get('sq', 2.0)
    lx = spec['rx'] * math.copysign(abs(ct) ** ex, ct)
    ly = spec['ry'] * math.copysign(abs(st) ** ex, st)
    cb, sb = math.cos(base), math.sin(base)
    return lx * cb - ly * sb, lx * sb + ly * cb


def _build_map():
    nodes = {}
    edges = []

    def add(nid, ntype, x, y, region):
        nodes[nid] = {'id': nid, 'type': ntype, 'x': round(x),
                      'y': round(y), 'region': region, 'neighbors': []}

    def link(u, v):
        edges.append((u, v))

    def loop_link(ids):
        for i in range(len(ids)):
            link(ids[i], ids[(i + 1) % len(ids)])

    def nearest_ring_node(biome, px, py):
        best, bd = None, 1e18
        for i in range(10):
            n = nodes[biome + '_r' + str(i)]
            d = (n['x'] - px) ** 2 + (n['y'] - py) ** 2
            if d < bd:
                best, bd = n['id'], d
        return best

    ix, iy = ISLAND_XY
    for b, spec in BIOMES.items():
        cx, cy = spec['center']
        # Slot 0 faces the island so every gate looks toward the finale.
        base = math.atan2(iy - cy, ix - cx)
        ring = [b + '_r' + str(i) for i in range(10)]
        for i, nid in enumerate(ring):
            ntype = _RING_TYPES[i]
            if b == 'bone':
                # Ossuary Fields is the dig-site biome: its two loot slots and
                # one mystery slot become excavation sites; the shrine is still
                # the gamble den.
                if i in (1, 4, 6):
                    ntype = 'excavation'
                elif ntype == 'shrine':
                    ntype = 'ossuary'
            ox, oy = _ring_point(spec, i, base)
            add(nid, ntype, cx + ox, cy + oy, b)
        loop_link(ring)

        # Inner chord: r2 -> i0 -> i1 -> r8, cutting across the hollow.
        r2, r8 = nodes[b + '_r2'], nodes[b + '_r8']
        for j in range(2):
            t = (j + 1) / 3
            add(b + '_i' + str(j), _INNER_TYPES[j],
                r2['x'] + (r8['x'] - r2['x']) * t,
                r2['y'] + (r8['y'] - r2['y']) * t, b)
        link(b + '_r2', b + '_i0')
        link(b + '_i0', b + '_i1')
        link(b + '_i1', b + '_r8')

        # Dungeon pocket outward from the island, past the ring's r5 slot.
        ux, uy = cx - ix, cy - iy
        ulen = math.hypot(ux, uy) or 1
        ux, uy = ux / ulen, uy / ulen
        dxc = max(340, min(WORLD_W - 340, cx + ux * (spec['rx'] + 330)))
        dyc = max(300, min(WORLD_H - 300, cy + uy * (spec['ry'] + 300)))
        r5 = nodes[b + '_r5']
        lt, lb = b + '_lt', b + '_lb'
        # Sit the ladder stub well past r5 along the outward normal so its ribbon
        # doesn't clip the r4-r5-r6 ring curve.
        add(lt, 'ladder', r5['x'] + ux * 210,
            max(160, min(WORLD_H - 160, r5['y'] + uy * 200)), b)
        # v6: each biome's pocket is a hand-laid, planar, unique shape.
        # Coordinates are local offsets from the pocket center (dxc, dyc);
        # orientation doesn't matter — pockets render in their own sub-view.
        # Contract: door = <b>_lb (only link to the surface), <b>_lair and
        # <b>_cache exist, every node keeps in-pocket degree >= 2.
        P = _POCKET_LAYOUTS[b]
        for suffix, (ntype, ox, oy) in P['nodes'].items():
            add(b + suffix, ntype, dxc + ox, dyc + oy, 'depths')
        for s1, s2 in P['edges']:
            link(b + s1, b + s2)
        link(b + '_r5', lt)
        link(lt, lb)

    # Tunnels between neighboring rings around the pentagon.
    ring_order = ['cavern', 'bog', 'garden', 'city', 'bone']
    tunnel_types = ['loot', 'hazard', 'wild', 'mystery', 'loot',
                    'wild', 'mystery', 'hazard', 'wild', 'loot']
    for k in range(5):
        a, c = ring_order[k], ring_order[(k + 1) % 5]
        ax, ay = BIOMES[a]['center']
        cx2, cy2 = BIOMES[c]['center']
        ids = []
        for j in range(2):
            t = (j + 1) / 3
            nid = 't_' + a + '_' + c + str(j)
            add(nid, tunnel_types[k * 2 + j],
                ax + (cx2 - ax) * t, ay + (cy2 - ay) * t,
                a if j == 0 else c)
            ids.append(nid)
        link(nearest_ring_node(a, nodes[ids[0]]['x'], nodes[ids[0]]['y']), ids[0])
        link(ids[0], ids[1])
        link(ids[1], nearest_ring_node(c, nodes[ids[1]]['x'], nodes[ids[1]]['y']))

    # The floating island: warp in, the trading post, ossuary, and the sealed
    # boss lair. The trading post sits between the warp and ossuary so every
    # player who warps to the isle passes the shared exchange.
    ix, iy = ISLAND_XY
    add('isl_warp', 'warp', ix - 115, iy + 55, 'isle')
    add('isl_trade', 'trading_post', ix - 55, iy + 8, 'isle')
    add('isl_ossuary', 'ossuary', ix, iy - 45, 'isle')
    add('boss', 'boss', ix + 120, iy + 30, 'isle')
    link('isl_warp', 'isl_trade')
    link('isl_trade', 'isl_ossuary')
    link('isl_ossuary', 'boss')

    # Titan's Rest — barrier-gated pocket east, between bog and garden.
    add('e0', 'wild', 3060, 900, 'bog')
    add('bar_e', 'barrier', 3180, 1020, 'ruin')
    add('e1', 'hazard', 3330, 940, 'ruin')
    add('e2', 'loot', 3420, 1100, 'ruin')
    add('lair_titan', 'lair', 3310, 1230, 'ruin')
    add('e3', 'wild', 3160, 1180, 'ruin')
    loop_link(['bar_e', 'e1', 'e2', 'lair_titan', 'e3'])
    link(nearest_ring_node('bog', 3060, 900), 'e0')
    link('e0', 'bar_e')

    # The Sunken Vaults — barrier-gated pocket in the city <-> bone gap.
    add('s0', 'mystery', 1120, 2180, 'city')
    add('bar_s', 'barrier', 950, 2260, 'ruin')
    add('s1', 'wild', 760, 2200, 'ruin')
    add('s2', 'hazard', 580, 2280, 'ruin')
    add('vault', 'vault', 420, 2170, 'ruin')
    add('s3', 'loot', 600, 2090, 'ruin')
    loop_link(['bar_s', 's1', 's3', 'vault', 's2'])
    link(nearest_ring_node('city', 1120, 2180), 's0')
    link('s0', 'bar_s')

    for u, v in edges:
        if v not in nodes[u]['neighbors']:
            nodes[u]['neighbors'].append(v)
            nodes[v]['neighbors'].append(u)

    return nodes


def seed(out_path):
    """Write a fresh procedural board as a v2 map.json."""
    nodes = _build_map()
    regions = {}
    for rid in sorted({n['region'] for n in nodes.values()}):
        background, label = _REGION_SEED.get(rid, ('', None))
        biome = BIOMES.get(rid)
        regions[rid] = {
            'label': label or (biome['name'] if biome else rid.title()),
            'background': background,
            'scatter': True,
            # Fog-of-war dungeon pockets; must match board-layers.ts, which
            # treats regions{}.dark (fallback: region == 'depths') as a pocket.
            'dark': rid == 'depths',
        }
    doc = {'worldW': WORLD_W, 'worldH': WORLD_H,
           'gate': GATE_NODE, 'boss': BOSS_NODE,
           'nodes': list(nodes.values()), 'regions': regions, 'decals': []}
    Path(out_path).write_text(json.dumps(doc, indent=1), encoding='utf-8')
    print(f'Seeded {len(nodes)} nodes to {out_path}')


if __name__ == '__main__':
    seed(Path(__file__).with_name('map.json'))
