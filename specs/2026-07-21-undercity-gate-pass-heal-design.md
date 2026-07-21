# Undercity — Gate pass-by heal + heal visuals

**Date:** 2026-07-21
**Status:** Approved design, pending implementation

## Summary

Today a Gate node full-heals a creature **only when it lands on it**
(`_resolve_space`, `ntype == 'gate'`). This feature adds a partial heal for
merely **passing through** a gate during a move, plus the on-screen feedback
for both cases:

- **Land on a gate** → full heal (100%). Unchanged.
- **Pass through a gate** (a gate is an intermediate step of the walked route,
  not the landing space) → heal **50% of max HP**, once per move.
- The heal is committed **only when the move is committed** — during the walk
  it is a promise shown as a sparkle. Retracing off the gate cancels it.
- After any gate heal (pass or land), **green `+N` numbers float off the
  token**.

## Behavior details

- **Once per move.** Passing two gates in one walk still heals 50%, not 100%.
  Capped at max HP.
- **Landing supersedes passing.** If the route passes gate A and lands on gate
  B, the landing 100% applies and the pass-heal does not also fire (no
  double-heal, no >100%).
- **Start node doesn't count.** Standing on a gate at roll time and walking
  away is not "passing by" — only nodes *stepped onto* mid-route count
  (`path[1:-1]`).
- **Order:** the pass-heal is applied *before* the landing space resolves, so
  passing a gate and then landing on a monster means entering that fight
  already topped up by 50%.

## Architecture

### The path problem

The board client walks the route node-by-node: `stepping().path` is the ordered
list of spaces (start first, landing last), built as the player taps each
adjacent space and trimmed when they retrace
(`board-tab.component.ts`). The server's `move` action, however, only receives
the final destination `to` and re-checks it against the roll's legal
destination set — it never sees the route taken.

Because "passing by a gate" depends on the *route*, not just the endpoint, the
client must send the walked path and the server must validate it. This keeps
the heal **server-authoritative**, consistent with the "all game rules live
server-side" design.

## Server changes

### `undercity_config.py`
- New scalar `GATE_PASS_HEAL_FRACTION = 0.5`.

### `undercity_engine.py`
- New pure helper `validate_walk(nodes, path, steps, closed, blocked) -> bool`:
  - `path[0]` equals the pre-move position, `path[-1]` equals `to`.
  - Every consecutive pair is adjacent (`neighbors`).
  - No immediate backtrack (`path[i+1] != path[i-1]`).
  - No node in `blocked`; no walking *through* a `closed` (sealed) barrier
    (a closed node may only be the final landing — the bonk stop).
  - Length rule: `len(path) - 1 == steps`, **or** a bonk-stop where the landing
    is a `closed` barrier and `len(path) - 1 <= steps`.
  - Mirrors the rules already encoded in `legal_destinations`.
  - `steps` is a *set* of allowed counts, not one value: a normal roll allows
    `{pm['value']}`; a Pathfinder roll (`pm['values']`, two faces) allows both.
    The walk length must satisfy the rule for one of them. `_move` passes the
    allowed counts from `pm`.

### Concrete closed / blocked sets

`_move` validates with the same inputs `_roll` used to compute `dests`:
`closed = _closed_barriers(table, sid)`, `blocked = _blocked_nodes(doc)`.

### `undercity_db.py` — `_move`
1. Read `path = payload.get('path')`.
2. Keep the existing `to in pm['dests']` check.
3. **If `path` is present:** validate it with `engine.validate_walk(...)` using
   the same `closed`/`blocked` sets `_roll` used to compute dests. On failure
   return `_err(..., 409)`.
4. **If `path` is absent** (stale client): skip pass-heal, keep today's
   destination-only behavior. No regression.
5. Compute pass-heal: if landing type is **not** `gate` and any node in
   `path[1:-1]` has type `gate`, then
   `heal = round(GATE_PASS_HEAL_FRACTION * maxHp)`,
   `doc['hp'] = min(maxHp, doc['hp'] + heal)`, `doc['hpUpdatedAt'] = _now()`.
   Record `{amount: heal, hp: doc['hp'], kind: 'gate_pass'}`. Apply this
   **before** `_resolve_space`.
   (`regen_hp` already ran at dispatch, so `doc['hp']` is current.)
6. The landing gate branch in `_resolve_space` continues to full-heal; surface
   its amount too so the client can float numbers. Report it as
   `{amount, hp, kind: 'gate_land'}`.
7. `_move` response gains a `heal` field carrying whichever of the two fired
   (or none).

## Client changes

### `board-tab.component.ts`
- **Pending sparkle:** each step, compute whether `stepping().path.slice(1)`
  contains a gate node. Feed that boolean to the canvas as the own token's
  "heal pending" flag. Because it is recomputed from the live path, retracing
  past the gate clears it.
- **Commit:** `move()` sends `{ to, path: this.stepping()?.path }`.
- **Result:** when the `move` response carries `heal`, call the canvas to pop
  green numbers off the own token.

### `undercity_config.py` mirror
- Per repo convention, mirror `GATE_PASS_HEAL_FRACTION` where the client would
  need it. The client does not compute the amount (server-authoritative), so no
  numeric mirror is required; only the pending-sparkle boolean is client-side.

## Canvas changes — `board-canvas.ts`

Reuses the existing `DustMote` particle pattern (`spawnDust`/`updateDust`/
`drawDust`).

- `setSelfHealPending(on: boolean)`: a soft green sparkle/glint aura on the own
  token while a heal is promised during the walk.
- `popHealNumber(userId, amount)`: spawns green `+N` text particles that float
  up and fade off the token. A new lightweight particle list modeled on
  `DustMote`. Fired for both pass (50%) and land (100%) heals.

## Testing

Extend `infrastructure/lambda/tests/` (in-memory FakeTable suite — keep green):

- Pass-through a gate heals exactly 50% of max HP (and caps at max).
- Landing on a gate still heals to full (100%).
- Passing a gate *and* landing on a gate → 100%, applied once (no double-heal).
- Starting on a gate and walking away → no heal.
- Illegal submitted path (non-adjacent / backtrack / wrong length / through a
  sealed barrier) → 409.
- Missing `path` (stale client) → move still succeeds, no pass-heal.
- `validate_walk` unit tests for the adjacency / no-backtrack / bonk-stop rules.

## Out of scope

- No new persistent buff entry (the sparkle is a transient canvas visual, not a
  `doc['buffs']` effect).
- No change to gate landing's full-heal semantics.
