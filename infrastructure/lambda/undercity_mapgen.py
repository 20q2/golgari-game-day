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
