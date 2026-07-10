---
name: add-undercity-space
description: Use when adding a new kind of space/tile/node to the Undercity board game — a new space type players can land on (shop-like facility, hazard, reward, mini-game, etc.), covering the Python Lambda rules, the map graph, and the Angular client rendering + modal.
---

# Add an Undercity Space Type

## Overview

A "space" is a node `type` on the board. [`undercity_data.py`](../../../infrastructure/lambda/undercity_data.py) `MAP_NODES` is the source of truth for the graph; the **Python Lambda** owns all rules and is authoritative; the Angular client mirrors display metadata and renders the node + any modal. Balance numbers are duplicated Python↔TS on purpose (see CLAUDE.md) — mirror anything you display.

There are two flavors — build only what you need:

- **Passive space** (like `loot`, `hazard`, `mystery`, `gate`): landing computes an effect server-side and returns an event; the client shows the generic event modal. No action, no persistence, no custom modal.
- **Facility space** (like `shop`, `shrine`, `ossuary`, `trading_post`): interactive — needs a new server action, a client modal + contextual button, and often shared per-node state.

## Server (do first — it's authoritative)

1. **Add the node(s)** in `_build_map()` in [`undercity_data.py`](../../../infrastructure/lambda/undercity_data.py): `add(id, type, x, y, region)` then `link(a, b)` for each edge. Insert **in-series on an existing path** (e.g. the island chain `isl_warp → isl_trade → isl_ossuary → boss`) rather than a dead-end spur — exact-count movement makes spurs hard to land on and leave. Note the tradeoff: inserting on a path that a movement test pins (the island chain is pinned by `test_dead_end_paths_die_out`) *will* break that test; splicing into a biome ring segment instead usually won't. Add any balance/seed constants here too.
2. **Resolve the landing** in `_resolve_space()` in [`undercity_db.py`](../../../infrastructure/lambda/undercity_db.py): `if ntype == '<type>': return {'type': '<type>', 'text': '…', …}`. Passive spaces mutate `doc` (spores/hp/xp) and return the result inline; facility spaces return the data the modal needs (e.g. `stock`).
3. **(Facility) Add an action**: write a handler `_myaction(table, sid, doc, payload)`, then register it in the `handlers` dict in `handle_action`. Guard first: `node = doc.get('position'); if data.MAP_NODES.get(node, {}).get('type') != '<type>': return _err(..., 409)`. Then mutate `doc`, `_save_or_conflict(table, doc)`, and `return _ok(doc, text=…)`. Mirror the **closest** existing handler: `_shrine` or `_gamble` for a single-purpose effect (heal/buff/mini-game), `_buy`/`_trade` for inventory/cost/swap logic.
4. **(Facility, shared state)** Persist a per-node record like `POST#{node}` / `SPACE#{node}` (see `_trading_post_stock`/`_save_trading_post`). Surface it in `handle_state` (add an `elif item['sk'].startswith('POST#')` in the item loop and a key in the `out` payload) so every client sees it, and expose it on the state service. NB: the state scan is `sk >= 'PLAYER#'`, so `POST#`/`SPACE#`/`RESULT` come through it; records lexically below `PLAYER#` (e.g. `BARRIERS`) need a separate fetch. Shared records have no version guard (last-writer-wins) — fine at ≤15 players.
5. **Regenerate the client map**: `python infrastructure/lambda/generate_map_json.py` → `public/data/undercity-map.json`. **Always do this after touching `MAP_NODES`**, or the client graph desyncs.
6. **Tests** (`cd infrastructure/lambda && python -m pytest tests -q`): in `test_map.py`, bump `test_node_count` and add a `'<type>': N` key to `test_space_type_distribution` — it's an **exact-equality Counter assert**, so a missing key fails. If you changed edges, fix movement expectations in `test_undercity_engine.py` (exact-count reachability shifts — e.g. `test_dead_end_paths_die_out`). Add action tests in `test_undercity_db.py` (happy path + each guard).

## Client

7. **Metadata** in [`data/items.ts`](../../../src/app/undercity/data/items.ts): add your type to `SPACE_ICONS` (Material Icons ligature), `SPACE_TINTS`, `SPACE_NAMES`, `SPACE_BLURBS`.
8. **Coin-disc color** in [`engine/board-canvas.ts`](../../../src/app/undercity/engine/board-canvas.ts) `TYPE_COLORS`.
9. **Building sprite (optional)** in [`engine/board-terrain.ts`](../../../src/app/undercity/engine/board-terrain.ts): only if the space needs art — add the type to `landmarkTypes` and a `drawLandmark` branch. Otherwise it renders as a plain coin disc with your icon (fine for most).
10. **(Facility) Models** in [`services/undercity-models.ts`](../../../src/app/undercity/services/undercity-models.ts): extend `SpaceEvent` with any new fields, `ActionResponse` for your action's return, `GameState` for shared state; add interfaces. Often a **no-op** — if the landing event only uses `text` and your action returns just `you`/`text`, those fields already exist; only add fields you actually introduce.
11. **(Facility, shared state)** expose a computed on [`undercity-state.service.ts`](../../../src/app/undercity/services/undercity-state.service.ts).
12. **(Facility) Wire the tab** in [`tabs/board-tab.component.ts`](../../../src/app/undercity/tabs/board-tab.component.ts): a `show<Thing>` signal + any data signals; an action method calling `this.store.action('<action>', …)`; a landing branch in `move()` (`else if (ev.type === '<type>')`); reset in `closeFacilities()`. In `.html`: a contextual button inside `@switch (nodeType())` and the modal (mirror the shop/ossuary modal). Add styles in `.scss`.
13. **Build**: `node node_modules/@angular/cli/bin/ng.js build --configuration development` (the `npm`/`npx` shims mangle paths on this Windows box — call the CLI directly). Confirm **your** files have zero errors; the build may be red from unrelated in-progress work.

## Worked example

The `trading_post` (central-island swap shop) touched exactly these points. See [docs/superpowers/specs/2026-07-09-trading-post-design.md](../../../docs/superpowers/specs/2026-07-09-trading-post-design.md) and grep `trading_post` / `_trade` / `TRADING_POST_SEED` across the tree for the full concrete diff.

## Common mistakes

- **Forgetting to regenerate `undercity-map.json`** — the board silently uses the stale graph.
- **Breaking movement tests** — inserting/removing edges changes exact-count reachability; rerun `pytest` and update expectations rather than assuming they still hold.
- **Only changing the client** — the server owns rules; a client-only space does nothing and can't be trusted. Server first.
- **Hardcoding old node ids** — ids are biome-prefixed (`city_r0`, `isl_trade`), not `n13`.
- **Not mirroring displayed constants** to the TS data files.
- **Expecting it live without deploy** — Lambda changes need `cd infrastructure && cdk deploy` (the user runs deploys).
