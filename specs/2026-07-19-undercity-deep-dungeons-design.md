# Undercity — Deep Sigil Dungeons

**Status:** Design approved, pre-implementation
**Date:** 2026-07-19
**Scope:** One vertical-slice biome dungeon first (`city` / The Broodwarrens), then replicate the proven template to the other four biomes.

## Problem

A sigil dungeon today is a ~3-node pocket hanging off a biome ring: one themed
wild, one hazard, one cache, and a lair mini-boss whose first clear grants that
biome's Guild Sigil. "Clearing a dungeon" is effectively winning a single
~6-round lair fight. Collect 3 of 5 sigils and Savra's island unseals.

The result: the mid-game between exploring the rings and fighting the final boss
is thin. In live play (~5-6h), a player reached and beat Savra faster than
intended. We want returning players to have real depth to dig into, and the road
*to* Savra is the lever — not just buffing Savra's HP.

The existing **darkness / fog-of-war** mechanic ([board-canvas.ts:858](../src/app/undercity/engine/board-canvas.ts#L858))
already renders `depths` nodes as gloom: your token carries a light radius,
nodes you've stood on stay lit across sessions, and other players only appear
inside your light. Because today's dungeons are tiny, that fog never matters.
Making the dungeons large is what gives darkness teeth.

## Goal

Turn each sigil dungeon into a **~6-turn dark maze delve** — a genuine mid-game
investment that stands between the biome ring and the final boss, so that
reaching Savra is earned rather than a quick errand. Add exploration payoffs
(hidden trove + rest rooms) and a build-defining navigation tradeoff (the torch).

## Design

### 1. The maze

Each `depths` pocket grows from ~3 nodes into a branching maze:

- **Critical path ≈ 20-24 nodes** from the entrance ladder mouth to the sigil
  lair — a minimum of ~6 turns at the game's ~3.5-spaces-per-turn average.
- **Branches and dead-ends** hang off the main path. In the dark you can't tell
  the through-path from a dead-end, so wrong turns cost rolls. This is the
  friction that makes darkness matter without adding empty walking.
- Nodes are populated with the biome's **themed wild + signature hazard**
  (already defined in `DUNGEON_NPCS` / `DUNGEON_HAZARDS`), plus **1-2 elite
  guardians** and loot spaces, escalating slightly in density toward the lair.
- **Entrance** = the depths-side ladder mouth (the node you descend to). This is
  also the respawn point (see §5).

Total node count per dungeon ≈ 30-35 (critical path + branch/room/loot nodes).

### 2. Hidden rooms

Two special nodes tucked onto **side branches**, invisible in the dark until your
light touches them:

- **Trove** — a fat one-time payout: spores + XP + a **guaranteed gear or scroll
  roll**. First-visit-per-player (tracked in `poiClaims` like the vault/cache).
  Reward for exploring instead of beelining.
- **Rest** — a large HP heal + clears lingering hazard debuffs.
  First-visit-per-descent (refreshes each time you re-enter the dungeon). The
  recovery valve that keeps the death model humane.

Because both sit on branches and are hidden by fog, a **dark beeline misses
them**; a lit, exploratory run finds them. That asymmetry is the payoff that
justifies the torch tradeoff.

### 3. Darkness & the Torch

Extends the existing per-player, client-side fog-of-war. Darkness governs what
*you can see*; the server resolves node landings regardless of visibility, and
hidden-room rewards trigger when you actually land on the node (first-visit
claim), so "hidden" is a visibility property, not a separate server gate.

- **No torch**: light radius = your node + immediate neighbors (~1 hop). You see
  one step ahead, navigate blind, and fight at **full strength**.
- **Torch equipped**: light radius widens to ~2-3 hops — you can see branch
  shapes ahead and spot hidden-room glints — but you carry a flat **combat
  penalty while equipped** (starting point: −3 ATK / −2 DEF) and it occupies a
  gear slot. Swap it out before a big fight to reclaim your stats, but then
  you're navigating dark again.
- Fog persistence is unchanged (client-side, per-player; lit nodes stay lit
  across sessions).

**Build tension:** delve *strong-but-blind* (miss rooms, waste rolls, win
fights) vs. delve *lit-but-weak* (efficient, find everything, soft in combat).
Two real playstyles, decided by whether you commit a gear slot to the torch.

### 4. Death / respawn

Compost while in `depths` → **respawn at that dungeon's entrance mouth**, not the
home biome gate. The lit map persists (you remember the layout), so re-descent is
fast rather than a full re-exploration. Rest rooms let a careful player avoid the
death spiral entirely. Tense, but not rage-quit brutal. Revive HP follows
existing compost behavior.

### 5. Reward semantics (unchanged)

Reaching and beating the **sigil lair** at the bottom still grants that biome's
Guild Sigil on first clear, with the existing `LAIR_BOSSES` reward. The *journey*
is the new investment; the reward contract stays the same. Holding
`SIGILS_REQUIRED` (3) still unseals Savra.

## Build strategy — vertical slice

Rebuild **one biome dungeon** (`city` / The Broodwarrens) fully, tune it live in
the next session, then replicate the proven template to the other four biomes via
the dev map editor. This proves darkness-navigation is fun-tense (not
tedious-slog), proves the torch tradeoff, and proves the death model *before*
authoring ~100+ nodes across five dungeons.

## Code touch points

- **Map authoring**: author the `city` maze in `infrastructure/lambda/map.json`
  (nodes/edges + client `regions`/`decals`), then `python
  infrastructure/lambda/sync_map.py` to mirror to
  `public/data/undercity-map.json` (a pytest fails while the copies differ). Use
  `/undercity/map-editor` for layout.
- **New node types**:
  - `trove` — reuse the vault/cache reward pattern in `undercity_db.py`
    (`_vault` / `_cache`), first-visit-per-player via `poiClaims`, with a
    guaranteed gear/scroll roll.
  - `rest` — new heal action/space in `undercity_db.py` + copy in
    `undercity_data.py`; first-visit-per-descent (reset on dungeon re-entry).
  - Register both in `board-tab.component.ts` / `board-space.ts` rendering and
    add modals as needed (see the add-undercity-space skill).
- **Torch item**: new equipment entry in `undercity_data.py` with the ATK/DEF
  penalty; mirror in `src/app/undercity/data/items.ts`. Client
  (`board-canvas.ts`) reads "torch equipped" from equipment state to widen the
  fog-of-war light radius.
- **Respawn**: make compost/respawn `depths`-aware — respawn at the dungeon
  entrance mouth when the player was in `depths`, else the existing home gate.
- **Balance mirrors**: keep `src/app/undercity/data/*.ts` in sync with server
  numbers (follow the tune-undercity-balance skill).
- **Tests**: extend `infrastructure/lambda/tests` — rest-room heal + per-descent
  reset, trove first-visit payout, depths-aware respawn, torch stat penalty
  applied in combat, and the map sync-copy check.

## Open tuning knobs (settle live)

- Exact critical-path length (target min 6 turns).
- Torch penalty magnitude (start −3 ATK / −2 DEF) and light radius (2 vs 3 hops).
- Rest heal amount (to full vs a fixed chunk) and whether it also cures debuffs.
- Trove payout size relative to vault/cache.
- Elite guardian count and placement per dungeon.

## Non-goals

- Not touching the meta-progression / Guild Seal / achievement layer (separate
  effort).
- Not adding procedural dungeon generation — dungeons are hand-authored via the
  map editor.
- Not changing Savra's fight or the sigil-count gate.
- Not building all five dungeons in this pass — vertical slice first.
