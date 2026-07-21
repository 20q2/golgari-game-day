"""Procedural per-night dungeon generator (Phase B).

Pure, deterministic, no boto3. Given a season id, produces the five biome
depths pockets: grid-carved mazes that keep each biome's identity (theme,
hazard, wild, lair boss stay fixed via the canonical ids + the DUNGEONS tables)
while randomizing layout and content each night. Emits the canonical node ids
the rest of the code relies on (<biome>_lb mouth, _lair, _cache, _trove, _rest,
_esc escape spur). See specs/2026-07-20-undercity-procedural-dungeons-design.md.
"""
import hashlib
import random

from undercity_data import BIOMES   # biome keys only; no map globals used

# Grid shape per biome (rows, cols) biases the maze's character; every pocket
# ends up >= MIN_NODES nodes. Specials come out of grid cells; the escape spur
# is appended.
GRID = {
    'cavern': (5, 6),    # radial-ish hub
    'bog':    (3, 10),   # long corridor
    'city':   (5, 6),    # serpentine
    'bone':   (5, 6),    # lattice (most extra cross-links)
    'garden': (5, 6),    # tangle
}
EXTRA_LOOPS = {'cavern': 2, 'bog': 1, 'city': 1, 'bone': 4, 'garden': 3}
# Pocket-local world origin per biome (near each committed pocket). Pockets
# render in their own sub-view, so exact placement only needs to be consistent.
POCKET_ORIGIN = {
    'city':   (1300, 2300),
    'cavern': (150, 1150),
    'bog':    (2950, 450),
    'bone':   (450, 1950),
    'garden': (2850, 2050),
}
SPACING = 120
MIN_NODES = 24
LAIR_MIN_HOPS = 6
FILLER_ELITE = 2
FILLER_HAZARD_FRAC = 0.30
FILLER_WILD_FRAC = 0.60      # of what remains after elite + hazard; rest = loot
MAX_ATTEMPTS = 40
_DEPTHS_PALETTE = {'ladder', 'lair', 'trove', 'rest', 'cache',
                   'wild', 'loot', 'hazard', 'elite'}


def _seed_int(season_id, biome):
    """Deterministic 64-bit seed from (season, biome) — hashlib, not hash(), so
    it is stable across processes (independent of PYTHONHASHSEED)."""
    h = hashlib.sha256(f'{season_id}:{biome}'.encode()).digest()
    return int.from_bytes(h[:8], 'big')


def _carve(rng, rows, cols):
    """Recursive-backtracker maze over a rows×cols grid. Returns (cells, adj),
    adj mapping a (r, c) cell to the set of connected neighbor cells — a spanning
    tree (every cell reachable, no crossing corridors)."""
    cells = [(r, c) for r in range(rows) for c in range(cols)]
    adj = {cell: set() for cell in cells}
    seen = {(0, 0)}
    stack = [(0, 0)]
    while stack:
        r, c = stack[-1]
        opts = [(r + dr, c + dc) for dr, dc in ((1, 0), (-1, 0), (0, 1), (0, -1))
                if 0 <= r + dr < rows and 0 <= c + dc < cols
                and (r + dr, c + dc) not in seen]
        if not opts:
            stack.pop()
            continue
        nxt = rng.choice(sorted(opts))      # sorted → deterministic given rng
        adj[(r, c)].add(nxt)
        adj[nxt].add((r, c))
        seen.add(nxt)
        stack.append(nxt)
    return cells, adj


def _add_loops(rng, adj, rows, cols, n):
    """Add up to n extra edges between orthogonally-adjacent cells not already
    linked — cycles for a less tree-like maze. Still planar (only grid-adjacent
    cells connect), so corridors never cross."""
    candidates = []
    for r in range(rows):
        for c in range(cols):
            for dr, dc in ((1, 0), (0, 1)):
                nb = (r + dr, c + dc)
                if 0 <= r + dr < rows and 0 <= c + dc < cols and nb not in adj[(r, c)]:
                    candidates.append(((r, c), nb))
    rng.shuffle(candidates)
    for a, b in candidates[:n]:
        adj[a].add(b)
        adj[b].add(a)


def _bfs(adj, start):
    """Hop distance from start to every reachable cell (dict cell -> int)."""
    dist = {start: 0}
    q = [start]
    i = 0
    while i < len(q):
        cur = q[i]; i += 1
        for nb in adj[cur]:
            if nb not in dist:
                dist[nb] = dist[cur] + 1
                q.append(nb)
    return dist


def _assign_and_build(rng, biome):
    """One attempt: carve, place specials, type fillers, emit node dicts. Returns
    the node list, or None if the layout misses a placement precondition (caller
    retries with a fresh rng)."""
    rows, cols = GRID[biome]
    cells, adj = _carve(rng, rows, cols)
    _add_loops(rng, adj, rows, cols, EXTRA_LOOPS[biome])

    mouth = (0, 0)
    dist = _bfs(adj, mouth)
    lair = max(cells, key=lambda cel: (dist[cel], cel))        # deepest cell
    if dist[lair] < LAIR_MIN_HOPS:
        return None
    leaves = sorted((c for c in cells if len(adj[c]) == 1 and c not in (mouth, lair)),
                    key=lambda cel: (-dist[cel], cel))          # dead-end tips, far first
    if len(leaves) < 2:
        return None
    trove, rest = leaves[0], leaves[1]
    taken = {mouth, lair, trove, rest}
    remaining = [c for c in cells if c not in taken]
    cache = remaining[len(remaining) // 2]
    taken.add(cache)

    fillers = [c for c in cells if c not in taken]
    rng.shuffle(fillers)
    ftype = {}
    for c in fillers[:FILLER_ELITE]:
        ftype[c] = 'elite'
    rest_cells = fillers[FILLER_ELITE:]
    n_haz = round(len(rest_cells) * FILLER_HAZARD_FRAC)
    for c in rest_cells[:n_haz]:
        ftype[c] = 'hazard'
    tail = rest_cells[n_haz:]
    n_wild = round(len(tail) * FILLER_WILD_FRAC)
    for i, c in enumerate(tail):
        ftype[c] = 'wild' if i < n_wild else 'loot'

    special = {mouth: 'lb', lair: 'lair', trove: 'trove', rest: 'rest', cache: 'cache'}
    special_type = {'lb': 'ladder', 'lair': 'lair', 'trove': 'trove',
                    'rest': 'rest', 'cache': 'cache'}
    ox, oy = POCKET_ORIGIN[biome]

    def nid(cell):
        suf = special.get(cell)
        return f'{biome}_{suf}' if suf else f'{biome}_g{cell[0]}_{cell[1]}'

    nodes = {}
    for cell in cells:
        r, c = cell
        suf = special.get(cell)
        nodes[nid(cell)] = {
            'id': nid(cell),
            'type': special_type[suf] if suf else ftype[cell],
            'x': ox + c * SPACING, 'y': oy + r * SPACING,
            'region': 'depths',
            'neighbors': sorted(nid(nb) for nb in adj[cell]),
        }
    # Mouth reciprocates the fixed surface bridge (<biome>_lt ↔ <biome>_lb).
    lb = nodes[f'{biome}_lb']
    lb['neighbors'] = sorted(lb['neighbors'] + [f'{biome}_lt'])

    # Boss antechamber: the lair is the deepest cell, so under exact-count
    # movement a dead-end lair is only landable on one precise roll. Pick the
    # lair's mouth-nearest maze neighbour J and append two off-grid gate nodes
    # that each bridge J and the lair. Each gate forms a length-3 (odd) cycle
    # J-lg-lair, so the lair is reachable at consecutive distances (1 direct,
    # 2 via a gate) — both roll parities can land. Grid loops alone can't do
    # this: the grid is bipartite, so every grid cycle is even-length.
    lair_id = f'{biome}_lair'
    j_cell = min((nb for nb in adj[lair]),
                 key=lambda c: (dist[c], c))          # nearest to mouth, stable
    j_id = nid(j_cell)
    lr, lc = lair
    jr, jc = j_cell
    midx = ox + (lc + jc) * SPACING / 2
    midy = oy + (lr + jr) * SPACING / 2
    for k, suf in enumerate(('lg1', 'lg2')):
        gid = f'{biome}_{suf}'
        off = 40 if k == 0 else -40
        nodes[gid] = {
            'id': gid, 'type': 'wild',
            'x': round(midx + off), 'y': round(midy - off),
            'region': 'depths', 'neighbors': sorted([j_id, lair_id]),
        }
        nodes[j_id]['neighbors'] = sorted(nodes[j_id]['neighbors'] + [gid])
        nodes[lair_id]['neighbors'] = sorted(nodes[lair_id]['neighbors'] + [gid])

    # Escape spur off the lair (degree-1 'ladder'), just past it.
    nodes[f'{biome}_esc'] = {
        'id': f'{biome}_esc', 'type': 'ladder',
        'x': ox + lc * SPACING + 70, 'y': oy + lr * SPACING + 70,
        'region': 'depths', 'neighbors': [lair_id],
    }
    nodes[lair_id]['neighbors'] = sorted(nodes[lair_id]['neighbors'] + [f'{biome}_esc'])
    return list(nodes.values())


def _valid(nodes, biome):
    """True iff `nodes` satisfies every board contract for this biome's pocket."""
    by = {n['id']: n for n in nodes}
    ids = set(by)
    if len(nodes) < MIN_NODES:
        return False
    if any(n['type'] not in _DEPTHS_PALETTE for n in nodes):
        return False
    for suf in ('lb', 'lair', 'cache', 'trove', 'rest', 'esc'):
        if f'{biome}_{suf}' not in by:
            return False
    for suf in ('trove', 'rest'):
        if len([x for x in by[f'{biome}_{suf}']['neighbors'] if x in ids]) != 1:
            return False
    if by[f'{biome}_esc']['neighbors'] != [f'{biome}_lair']:
        return False
    if f'{biome}_esc' not in by[f'{biome}_lair']['neighbors']:
        return False
    if f'{biome}_lt' not in by[f'{biome}_lb']['neighbors']:
        return False
    # Boss antechamber: two 'wild' gates, each bridging exactly the same
    # junction J and the lair (odd-cycle -> mixed-parity landings).
    lair_id = f'{biome}_lair'
    junctions = set()
    for suf in ('lg1', 'lg2'):
        gid = f'{biome}_{suf}'
        if gid not in by or by[gid]['type'] != 'wild':
            return False
        gnbrs = {x for x in by[gid]['neighbors'] if x in ids}
        if len(gnbrs) != 2 or lair_id not in gnbrs:
            return False
        (j,) = gnbrs - {lair_id}
        if j not in by[lair_id]['neighbors']:      # J must border the lair directly
            return False
        junctions.add(j)
    if len(junctions) != 1:                        # both gates share one junction
        return False
    for n in nodes:                                    # symmetric within pocket
        for nb in n['neighbors']:
            if nb in ids and n['id'] not in by[nb]['neighbors']:
                return False
    dist = {f'{biome}_lb': 0}                           # reachable + lair depth
    q, i = [f'{biome}_lb'], 0
    while i < len(q):
        cur = q[i]; i += 1
        for nb in by[cur]['neighbors']:
            if nb in ids and nb not in dist:
                dist[nb] = dist[cur] + 1; q.append(nb)
    if set(dist) != ids:
        return False
    return dist[f'{biome}_lair'] >= LAIR_MIN_HOPS


def generate_depths(seed, biome):
    """A biome's depths pocket for the night: a grid-carved maze with canonical
    ids (<biome>_lb mouth, _lair, _cache, _trove, _rest, _esc). Deterministic in
    `seed`; retries layouts until every contract holds."""
    for attempt in range(MAX_ATTEMPTS):
        rng = random.Random(seed + attempt)
        nodes = _assign_and_build(rng, biome)
        if nodes and _valid(nodes, biome):
            return nodes
    raise RuntimeError(f'mapgen: no valid layout for {biome} after {MAX_ATTEMPTS} tries')


def generate_all_depths(season_id):
    """All five biome pockets for a season, as one flat node list — the shape the
    SEASON#<sid>/MAP record stores (Phase C writes it at season-start)."""
    out = []
    for biome in BIOMES:
        out.extend(generate_depths(_seed_int(season_id, biome), biome))
    return out
