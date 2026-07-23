# Undercity — World Event: "The Great Beast"

## Problem / goal

Undercity's shared-world moments are currently gated behind personal progress
(each player grinds their own sigils toward the Savra finale). We want a
**season-shared co-op world boss** that appears once the first sigil lair
falls — a big creature that "sits and hangs out" in the wilderness, that any
player can chip away at in bounded skirmishes, and that pays **everyone who
contributed** when it dies, scaled to how much damage they dealt, wherever they
happen to be on the board at the time.

This is the first genuinely cooperative, shared-outcome activity in the game.

## Design

### Terminology

A single **world event** per season: a persistent-pool NPC ("The Great Beast",
sprite tunable) occupying **3 adjacent wilderness nodes**, with its sprite
rendered centered/straddling the run. Players **skirmish** it (a bounded 6-round
fight) to chip its shared HP pool; when the pool empties, contributors are paid
by **damage bracket**.

### Shared session state

Stored like boss HP / barriers / wild-warp under `pk = _season_pk(sid)`:

- `sk = 'WORLDEVENT'`
- Value:
  ```
  {
    spawned: true,
    node:  <center node id>,       # the middle of the 3-node run
    nodes: [n1, n2, n3],           # the three occupied wilderness nodes
    hp:    <int current pool>,
    maxHp: <int WORLD_EVENT_HP>,
    dmg:   { <userId>: <int total damage dealt>, ... },
    dead:  false
  }
  ```
- `_world_event(table, sid)` reads it (returns `None` if never spawned).
- `_set_world_event(table, sid, rec)` writes it.

Only **one** world event exists per season, and it fires **once**.

### Trigger & spawn

The event spawns the first time **any** of the six sigil-lair bosses is slain
this season — i.e. the moment a `LAIR#<node>` pool's `slain` flag transitions
`False → True` (the season-global true-boss kill, in the lair finish path).

At that transition, if no `WORLDEVENT` record exists yet:

1. Choose a run of **3 connected nodes in the wilderness region** from the board
   graph (`data`/`map.json` node `region == 'wilderness'`, walking edges to find
   a length-3 connected chain). Center = the middle node of the chain.
   Selection uses the lambda's `_rng`; the chosen ids are then persisted, so the
   footprint is stable for the rest of the season.
2. Write the `WORLDEVENT` record with `hp = maxHp = WORLD_EVENT_HP`, empty `dmg`,
   `dead = false`.
3. Emit a season `_event(... 'boss'/'world', ...)` announcement and fan an
   `awayEvent` "A Great Beast has emerged in the wilderness!" to every player via
   `_broadcast_away`.

Spawn is idempotent: if `WORLDEVENT` already exists, subsequent lair kills do
nothing to it.

### Board presence (3 nodes, sprite centered)

The three nodes are **overlaid**, not retyped in `map.json` — this keeps the map
source of truth clean and lets the footprint be chosen at runtime.

- `_resolve_space` checks, **before** its normal `ntype` dispatch: is this node
  one of a live (`spawned && !dead`) world event's `nodes`? If so, return a
  `world_event` space event instead of the node's usual behavior.
- `game/state` payload gains a `worldEvent` block when live:
  ```
  worldEvent: { nodes, center, hp, maxHp, name, spriteId, dead }
  ```
- Client `board-canvas.ts`: when `worldEvent` is present and not dead, draw the
  sprite scaled to straddle all three tiles, anchored/centered on `center`, with
  a shared HP bar above it; give the three tiles a highlight ring so players see
  where to land. When `dead`, draw nothing (tiles revert to normal rendering).

**Sprite:** taken from the unused pool in `public/undercity/sigil_boss/`
(`broodmother`, `gloomglow_tyrant`, `marrow_king`, `moor_wyrm`, `rot_shepherd`).
Default choice `moor_wyrm` (reads as a wilderness beast); swapping is a one-line
change to the `WORLD_EVENT.spriteId` mapping. These source files are `.jfif`
(JPEG); the chosen sprite is converted to `.png` to match every other Undercity
sprite and avoid canvas-decode inconsistencies.

### Engagement — 6-round skirmish, repeatable, no limit

Landing on any of the three nodes opens a `world_event` modal with an **Engage**
button (plus flavor + the live shared HP bar). Engaging starts the existing
interactive stance-combat state machine via `_start_battle` with:

- `kind = 'world'`
- The shared pool `hp` loaded as the NPC's current HP (persistent-pool foe, like
  `lair`/`boss`).
- `ctx = { 'roundCap': WORLD_EVENT_ROUND_CAP }` (= 6).

Combat rules:

- The fight **hard-caps at 6 rounds**. On reaching the cap it auto-ends neutrally
  (the skirmish is over; no player KO required). Sudden-death frenzy still
  applies within those 6 rounds as normal, so a skirmish can also end early by
  KO or flee.
- On skirmish end (`_finish_battle` `world` branch): compute damage dealt this
  skirmish = `poolStart - npc_hp_after`. Re-read the live pool (concurrent
  skirmishes may have chipped it), subtract the delta, clamp at 0, and add it to
  the event's `dmg[userId]` contributor map. It is **not** added to the player's
  `bossDamage` counter — that counter already feeds season-end renown via
  `compute_renown`, and double-banking would double-count against the immediate
  bracket renown below. `dmg` is the single source of truth for brackets.
- The beast does **not** die from being disengaged — a capped/fled skirmish just
  leaves it chipped. Any player may re-engage every time they land on a node;
  **no cooldown, no per-player cap** (pure repeatable).
- If a skirmish's damage brings the pool to **0**, the beast dies and payout
  (below) resolves immediately, with the killing player seeing their reward
  inline.

### Death & tiered payout (renown + spores, by damage share)

When the pool reaches 0:

1. Compute each contributor's share = `dmg[uid] / maxHp`.
2. Assign a **bracket**:

   | Bracket    | Condition                    | Reward (tunable) |
   |------------|------------------------------|------------------|
   | Vanquisher | highest total damage dealt   | renown + spores (top) |
   | Major      | share ≥ `WORLD_EVENT_MAJOR_SHARE` (0.25) | renown + spores |
   | Minor      | share ≥ `WORLD_EVENT_MINOR_SHARE` (0.10) | renown + spores |
   | Participant| any damage > 0               | small spores |

   (Ties for Vanquisher: first by highest damage; deterministic tiebreak by
   userId. Vanquisher is exclusive — the top dealer gets Vanquisher even if they
   also clear the Major threshold.)
3. Credit **every** contributor **regardless of board location**: add
   spores + renown directly to their player doc, and push an `awayEvent` line
   describing their bracket + payout via the same `_push_away_event` /
   `_broadcast_away` fan-out used for boss news. Contributors who are the acting
   player get their result inline in the action response.
4. Fan a plain news `awayEvent` ("The Great Beast has fallen!") to
   non-contributors.
5. Set `dead = true` on the `WORLDEVENT` record. The board sprite despawns and
   the three nodes revert to their normal `_resolve_space` behavior.

Best-effort optimistic-lock writes (retry-on-conflict, like `_broadcast_away`);
a lost race drops at most one player's payout line, never double-pays (payout
runs once, guarded by the `dead` flag flip).

### Data / config / mirrors

- `undercity_data.py`: `WORLD_EVENT` spec — `{ id, name, spriteId, atk, def,
  spd, personality, bluff }`.
- `undercity_config.py`: `WORLD_EVENT_HP` (~200), `WORLD_EVENT_ROUND_CAP` (6),
  `WORLD_EVENT_MAJOR_SHARE` (0.25), `WORLD_EVENT_MINOR_SHARE` (0.10), and the
  per-bracket renown/spores reward scalars.
- Client mirrors under `src/app/undercity/data/` (event stats + reward display
  numbers), kept in sync with the server per the CLAUDE.md mirror convention.
- New `world_event` handling in the `undercity_db` action dispatcher (engage →
  `_start_battle`) and `world_event` space/event rendering in the client (modal +
  `items.ts` event styling for the spawn and payout event lines).

Implementation follows the **add-undercity-space** skill, since this introduces
a new landable space type (Python rules + map/graph handling + Angular render +
modal).

## Testing

`infrastructure/lambda/tests/` FakeTable integration suite, deterministic via
`FixedRng` / monkeypatched `db._rng`:

- First lair-boss slain spawns exactly one `WORLDEVENT` on a length-3 connected
  wilderness run; a second lair kill does **not** respawn or reset it.
- Landing on any of the three nodes returns a `world_event` space event (overlay
  wins over the node's normal type); landing elsewhere is unaffected.
- Engaging starts a `kind='world'` battle; the fight ends at the 6-round cap;
  damage dealt is subtracted from the shared pool and banked into `dmg[uid]`
  (overlay also wins over Umori's wandering stall on a shared node).
- Repeated skirmishes by the same and different players keep chipping the same
  shared pool (no cooldown/cap).
- The skirmish that empties the pool sets `dead = true`, pays each contributor by
  the correct bracket (Vanquisher/Major/Minor/Participant), delivers payout to
  an **absent** contributor via `awayEvents`, and pays out exactly once.

Keep the suite green (`cd infrastructure/lambda && python -m pytest tests -q`).

## Out of scope

- More than one concurrent world event, or repeat spawns after the first is
  killed (fires once per season).
- Roaming/relocating the footprint, or an expiry/escape timer (stationary until
  killed).
- Per-player engagement cooldowns or diminishing-returns damage weighting.
- New bespoke art beyond reusing/converting an existing `sigil_boss` sprite.
- PvP interactions.
