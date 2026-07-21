# Undercity: Tunnel Toll & Free Crossing — Design

**Date:** 2026-07-20
**Status:** Approved, ready for planning
**Supersedes** the tunnel gating half of
[2026-07-20-undercity-tunnels-wilderness-design.md](2026-07-20-undercity-tunnels-wilderness-design.md).
The Wilderness half of that doc is unaffected.

## Summary

Rework the five biome-boundary `tunnel` spur pairs from a hard Tier-1-only gate
into a paid fast path:

- **Tier-1 units cross free** (unchanged).
- **Tier-2/Tier-3 units may now use tunnels by paying a tier-scaled Spore toll**
  instead of being barred outright. A unit that cannot afford the toll is blocked
  exactly as before (tunnel is impassable — not a destination and not a
  pass-through step).
- **Landing on a tunnel carries you fully across the boundary for free** (movement-
  wise): you are relocated to the far biome's connecting node. The crossing is a
  **consequence-free** safe teleport — the far node's landing effect does **not**
  resolve. For Tier-2/3 this landing is where the toll is charged.

## Motivation

Evolved units were completely stranded from the tunnels and forced through the
longer Wilderness. That is too binary. A toll keeps the Wilderness meaningful as
the cheaper evolved-unit route while letting a flush evolved unit buy a shortcut,
and the free cross-hop rewards *landing on* the tunnel (a short roll) over walking
the full spur (a longer roll).

## Current-state facts (verified)

- `tunnel` nodes are 10 degree-2 spurs in 5 pairs: `t_cavern_bog{0,1}`,
  `t_bog_garden{0,1}`, `t_garden_city{0,1}`, `t_city_bone{0,1}`,
  `t_bone_cavern{0,1}`. Each `t_X_Y0` sits in region X with neighbors
  `[<X biome node>, t_X_Y1]`; `t_X_Y1` sits in region Y with neighbors
  `[t_X_Y0, <Y biome node>]`. Verified against `map.json`.
- `undercity_config.py`: `TUNNEL_TIER_MAX = 1`.
- `undercity_data.py`: `TUNNEL_NODES` — frozenset of ids where `type == 'tunnel'`.
- `undercity_db.py`:
  - `_blocked_nodes(doc)` returns `TUNNEL_NODES` when `tier > TUNNEL_TIER_MAX`,
    else `frozenset()`. Consumed by `_roll` (L~1418), bot movement (L~1095), and
    spell range via `board_distance`.
  - `_resolve_space(table, sid, doc, node, prev)` dispatches by node type; the
    `tunnel` branch (L~1673) currently returns inert flavor. `wild`/`warp` show
    the relocate-and-return pattern (`doc['position'] = dest`; no re-resolve).
  - `_move` (L~1433) sets `doc['position'] = to`, calls `_resolve_space`, then
    reports `_occupants(..., to, ...)` — uses the pre-relocation `to`.
- Client mirror: `board-canvas.ts` greys tunnels when `ownTier > 1`
  (`recomputeLocked`, the `ownTier > 1` block ~L620); `items.ts` holds
  `SPACE_BLURBS.tunnel`, `SPACE_LABELS.tunnel`, `SPACE_ICONS.tunnel`,
  `TYPE_COLORS.tunnel`. Move destinations come from the server, so client greying
  is only a legibility hint.

## Design

### 1. Config — `undercity_config.py`

Keep `TUNNEL_TIER_MAX = 1` (tiers ≤ this travel free). Add:

```python
# Spore toll an evolved unit pays to use a tunnel (tier -> cost). Tiers <=
# TUNNEL_TIER_MAX travel free; a unit that cannot afford its toll is blocked
# from tunnels entirely (see _blocked_nodes). Mirror any change in the client
# tunnel blurb (src/app/undercity/data/items.ts).
TUNNEL_TOLL = {2: 8, 3: 16}
```

### 2. Data — `undercity_data.py`

Precompute each tunnel node's far-side exit — the non-tunnel neighbor of its
paired tunnel node:

```python
def _tunnel_exit(nid):
    pair = next(x for x in MAP_NODES[nid]['neighbors']
                if MAP_NODES[x]['type'] == 'tunnel')
    return next(x for x in MAP_NODES[pair]['neighbors']
                if MAP_NODES[x]['type'] != 'tunnel')

TUNNEL_EXITS = {nid: _tunnel_exit(nid) for nid in TUNNEL_NODES}
```

### 3. Movement gate — `_blocked_nodes(doc)`

Block tunnels for an evolved unit only when it can't afford the toll:

```python
def _blocked_nodes(doc):
    tier = doc.get('tier', 1)
    if tier > data.TUNNEL_TIER_MAX:
        toll = data.TUNNEL_TOLL.get(tier, 0)
        if doc.get('spores', 0) < toll:
            return data.TUNNEL_NODES
    return frozenset()
```

Because tunnels are degree-2 spurs, "can't land" ⇒ "can't cross", so a broke
evolved unit is fully barred (no destination, no pass-through) — matching prior
behavior. A funded evolved unit sees tunnels as normal passable nodes; T1 always
free. No change to `legal_destinations`/`board_distance` signatures — they already
take the blocked set.

### 4. Landing = consequence-free free crossing — `_resolve_space` tunnel branch

```python
if ntype == 'tunnel':
    exit_node = data.TUNNEL_EXITS[node]
    tier = doc.get('tier', 1)
    paid = 0
    if tier > data.TUNNEL_TIER_MAX:
        paid = data.TUNNEL_TOLL.get(tier, 0)
        doc['spores'] = doc.get('spores', 0) - paid   # gate guarantees affordable
    doc['position'] = exit_node                        # free hop, consequence-free
    return {'type': 'tunnel', 'to': exit_node, 'toll': paid,
            'text': 'You slip through the tunnel and out the far side.'}
```

- Applies to **all** tiers (T1 pays nothing, still gets the free hop).
- The far node is always a non-tunnel biome node, so there is no chaining and no
  recursion. Its landing effect is deliberately **not** resolved (safe teleport).
- `_move`: report occupants of the final position — change the `_occupants` call
  to use `doc['position']` instead of `to` (also corrects the latent wild-warp
  case).
- Bot movement path resolves spaces through the same `_resolve_space`, so bots
  landing on a tunnel are carried across too; no extra bot code.
- **Intended:** the toll and the free hop fire only on *landing*. A funded T2/3
  that merely *passes through* a tunnel mid-roll to a farther node pays nothing —
  landing is strictly cheaper (a short roll reaches the same far node), so there
  is no exploit to close. Do not attempt to charge pass-through.

### 5. Client — `board-canvas.ts` + `items.ts`

- Remove the `ownTier > 1` tunnel-locking block in `recomputeLocked()` (evolved
  units can now use tunnels; server reachability already hides them from a unit
  that can't afford the toll). The `tier` plumbing may stay (harmless) — only the
  auto-grey block is removed.
- `items.ts`: update `SPACE_BLURBS.tunnel` to describe the new rule, e.g.
  *"A shortcut between biomes. Tier-1 units cross free; evolved units pay Spores.
  Land on it to be carried across to the far side for free."* Keep the exact toll
  numbers out of the prose to avoid drift with `TUNNEL_TOLL`.

### 6. Config/data coupling note

The only duplicated display value is the tunnel blurb text (no number mirrored).
`TUNNEL_TOLL` is server-authoritative; the client never computes it.

## Testing

- **Gate:** funded T2/T3 → tunnels absent from blocked set (reachable/pass-through);
  broke T2/T3 → `TUNNEL_NODES` blocked (not a destination, not pass-through); T1 →
  never blocked. Assert in both `legal_destinations` and `board_distance`.
- **Landing:** `_resolve_space` on a tunnel relocates `doc['position']` to
  `TUNNEL_EXITS[node]`; deducts `TUNNEL_TOLL[tier]` for T2/T3, deducts nothing for
  T1; the far node's effect does **not** fire (consequence-free).
- **No-trap invariant:** a broke T2/T3 still reaches every biome via the Wilderness.
- **Map integrity:** `map.json` and `public/data/undercity-map.json` stay in sync;
  `TUNNEL_EXITS` covers all 10 tunnel nodes with valid non-tunnel targets.
- Update existing tunnel tests in `test_undercity_engine.py` / `test_undercity_db.py`
  that assert the old "T2 fully barred" behavior.

## Out of scope

- The Wilderness region (built separately, unchanged here).
- Per-tier toll beyond a flat lookup, dynamic pricing, or refunds.
- Any change to depths, warps, boss finale, or PvP.
