# Undercity — Umori, the Wandering Trading Post

**Date:** 2026-07-21
**Status:** Design (approved)

## Problem / intent

The trading post today is a single fixed node (`isl_trade`) tended by Umori, the
collector ooze (keeper sprite `shopkeeper3.png`). We want to turn Umori into a
**wandering NPC** that roams the wilderness, is visible on the overworld, shows a
move-countdown over its head, and — when you land on it — opens the trading-post
barter seeded with **endgame T3 loot** (gear + grimoires). Reaching Umori before
it moves is hard, which is exactly what justifies the T3 payoff.

This is a phone-first, **fully asynchronous** multiplayer game: players check in a
few times a day and act at different wall-clock times on a shared board. The
design's north star is **clarity under async play** — whenever anyone opens the
app, the board must show the one true current state of Umori, identical for
everyone, with no ambiguity about where it is or how long they have.

## Decisions (from brainstorming)

| Question | Decision |
|---|---|
| Movement cadence | Umori moves **every 2 hours** to a new random wilderness node. |
| Visibility | **On the board only** (no global HUD): the occupied space renders as a trading post with the Umori sprite hopping above it and a countdown over its head; tapping shows a tooltip with the same move time. |
| Tracker info | The on-board countdown + tap tooltip (no hops/distance readout). |
| Stock on each move | A fresh **mix of T3 gear + T3 grimoires**, reset every move. |
| Old static post (`isl_trade`) | **Retired** — retyped to a plain node; the trading-post feature exists *only* as wandering Umori. |
| Give-side rule | Umori **accepts only gear or grimoires** (no consumables) — a real-value exchange, no junk→T3 arbitrage. |
| Findability aid | A lightweight **"Find Umori"** button that centers the board camera on Umori's current node. |

## Async & mobile-clarity principles

These are the load-bearing choices that make the feature legible on a phone with
gaps of hours between turns:

1. **Deterministic-from-clock, never a server tick.** Umori's position and stock
   are pure functions of the current wall-clock window. Every client computes the
   identical result with no coordinated write and no background job — so state is
   never stale, never disagrees between players, and survives the Lambda being
   cold. This mirrors the existing bazaar pattern (`_shop_window`).
2. **The telegraph lives on the board, where the decision is made.** The sprite,
   the countdown, and the tap tooltip are all on the space itself, so "where is
   it / how long do I have / is it worth the trip" is answered without leaving the
   map.
3. **The countdown is honest.** It is exactly `now → next window boundary`. With a
   2-hour dwell, a distant player may genuinely not make it — that missable-ness
   *is* the T3 gate, and the honest timer lets players choose the trip fairly.
4. **One-tap findability.** Because there is no HUD and the board has 273 nodes,
   "Find Umori" recenters the camera so a returning player never has to scan.

## Architecture

Umori is a computed overlay on the existing board, not a new persistent map node.
No file becomes a "wandering NPC engine"; the behavior is a handful of pure
functions plus one branch in space resolution and one in the client renderer.

### Server (`infrastructure/lambda/`)

**Window & location (`undercity_db.py`, pure helpers next to `_shop_window`):**

- `_umori_window(now=None)` → `int`: `seconds_since_epoch // (UMORI_DWELL_MIN*60)`.
- `_umori_window_end(window)` → ISO timestamp of the next boundary (the client's
  countdown target), same shape as `_shop_window_end`.
- `_umori_node(window)` → node id: deterministic crc32-seeded pick from the
  wilderness node pool (`data.UMORI_NODES`). Immediate repeats are allowed (~1/31,
  rare enough to ignore).

**Node pool (`undercity_data.py`):**

- `UMORI_NODES` = ids of all `region == 'wilderness'` nodes (31 today: the
  elite/wild/hazard/loot/cache spaces). Computed once from `MAP_NODES` at import,
  so it tracks map edits automatically.

**Stock (`undercity_db.py` + `undercity_data.py`):**

- `_umori_stock(window)` → list of barter lines, deterministic per window: a mix
  of **T3 gear + T3 grimoires** per `data.UMORI_STOCK_SPEC` (default: 2 distinct-slot
  T3 gear pieces + 1 T3 grimoire). Seed shape matches `_seed_stock()`
  (`{'item', 'foundBy': 'the Swarm'}`) so the existing barter UI renders it.
- Intra-window barter persists under `POST#UMORI#<window>` (reusing the trading-post
  record shape). On read for the current window with no record → seed from
  `_umori_stock(window)`. A stale-window record is ignored, which is how the reset
  happens (same idiom as `_shop_stock`).

**Space resolution (`_resolve_space`):** before the normal type dispatch, if the
landed node equals `_umori_node(_umori_window())`, resolve it as a **trading post
for this window** — Umori's presence pacifies the space, overriding its normal
wild/elite/hazard event. Return the existing `trading_post` event shape plus
`umori: True` and `movesAt: _umori_window_end(window)`, with stock from the Umori
record. When Umori moves on, the node reverts to its map type automatically.

**Barter (`_trade`):** generalize the location check from "node type is
`trading_post`" to "the player is standing on the current Umori node." Source and
save stock via the `POST#UMORI#<window>` record. Add the give-side rule: reject
`give_kind == 'consumable'` with a clear message ("Umori only trades in gear and
grimoires."). Everything else (give one / take one, leftover becomes the next
visitor's stock within the window, bag/dup/overflow guards) is unchanged.

**State (`handle_state`):** expose `umori: { node, movesAt }` at the top level so
the client can render Umori anywhere on the board and drive the countdown. Replace
the current "seed POST stock for every `trading_post` node" loop (there are none
now) with seeding the single current Umori node's display stock.

**Retire `isl_trade` (`map.json` → `sync_map.py`):** retype node `isl_trade` from
`"trading_post"` to `"mystery"` (matching its island sibling `isl_bg2`; keeps the
island graph/neighbors intact). No node is a static `trading_post` after this — the
type still exists in the vocabulary but is applied dynamically to the Umori node.

### Client (`src/app/undercity/`)

**State model (`services/undercity-models.ts`):** add
`umori?: { node: string; movesAt: string }` to the game-state model.

**Board rendering (`engine/board-terrain.ts` + `tabs/board-tab.component.ts`):**
when drawing the node whose id equals `state.umori.node`, render it as a
`trading_post` space *plus*:
- the **`shopkeeper3.png` sprite hopping** above the node (a small vertical
  bob animation on the existing render loop);
- a **countdown label** over its head ("1h 20m"), computed from `movesAt` with the
  same math as `bazaarRestockLabel()`.
Tapping the node shows a **tooltip**: "Umori moves in 1h 20m." All other wilderness
nodes render normally.

**"Find Umori" button (`tabs/board-tab.component.*`):** a small map control that
pans/centers the board camera on `state.umori.node`. Hidden if `umori` is absent.

**Trade wiring:** the trade modal opens when the landed space resolves as
`trading_post` (already the trigger), now keyed off the server event rather than a
static node. Keeper art/quote = the existing `tradingKeeper` (the ooze). The T3
stock and give-side rule are enforced server-side; the client surfaces the
rejection message.

## Data / tuning

- `undercity_config.py`: `UMORI_DWELL_MIN = 120` (2-hour window).
- `undercity_data.py`: `UMORI_NODES` (wilderness ids), `UMORI_STOCK_SPEC` (weighted
  table describing the T3 mix, e.g. `{'gear': 2, 'grimoire': 1}` with tier fixed at
  3). T3 grimoires in play: `queensbane_grimoire`, `tome_of_deep_roads`.
- Client mirror: `UMORI_DWELL_MIN` is not duplicated (the client reads `movesAt`
  from state and just formats it), so there is no drift risk.

## Edge cases

- **Window rolls while the trade modal is open:** the server validates against the
  *current* window and the player's position; a trade attempt after Umori has moved
  is rejected ("Umori has moved on."). The client re-syncs on the next state fetch.
- **Player standing on the node when Umori arrives/leaves:** arrival pacifies the
  space and offers the trade next resolution; departure reverts it to the map type.
- **Umori on a dangerous elite/hazard node:** intended — its presence pacifies that
  space for the window (a brief safe harbor). No environmental damage is involved
  (consistent with the no-arena-damage rule).
- **Mid-battle:** unaffected; Umori only matters at space resolution.

## Testing (`tests/`)

- `_umori_window` math (window advances on the boundary), mirroring
  `test_shop_window_math`.
- `_umori_node` is deterministic per window and always a wilderness node.
- `_umori_stock` is deterministic and every line is T3 (gear tier 3 or grimoire
  tier 3); composition matches `UMORI_STOCK_SPEC`.
- `_resolve_space` on the current Umori node returns a `trading_post` event with
  `umori: True` and T3 stock; a non-Umori wilderness node returns its normal event.
- `_trade` succeeds when the player stands on the Umori node; rejects a consumable
  give; rejects when the player is elsewhere or the window has rolled.
- `map.json`: no node has type `trading_post`; the type-distribution test updated
  (`trading_post` 1→0, `mystery` +1); map copies stay in sync.
- Repoint the existing `test_trading_post_*` suite onto the current Umori node.
- Frontend: production build compiles (no unit runner).

## Non-goals / out of scope

- No server tick, cron, or background mover — position is clock-derived.
- No global HUD tracker (deliberately board-only, per the clarity decision).
- Umori does not move mid-window and cannot be "held" in place.
- No PvP interaction at Umori; revenge/achievement/hat stubs untouched.
- No change to bazaar tiers (shipped separately) or the boss finale.
