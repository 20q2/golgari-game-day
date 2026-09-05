# Respawning Ruin Lairs — Design

**Date:** 2026-08-02
**Status:** Approved, pending implementation plan
**Scope:** Undercity sub-game — the two non-sigil "ruin" lairs only.

## Summary

The two side-content ruin lairs — `lair_titan` (Lord of Extinction) and `n288`
(Doomgape) — currently share the same season-pooled HP + permanent **Vestige**
model as the five biome sigil lairs. This design replaces that, for these two
nodes only, with a per-player **defeat → abandoned (1 hour) → respawn** cycle
plus a small scavenge reward while the lair sits empty.

The five sigil lairs (`city_lair`, `cavern_lair`, `bog_lair`, `bone_lair`,
`garden_lair`) keep their existing shared-pool + Vestige behavior, untouched.

## Behavior model

Each player has an independent cycle per ruin lair:

1. **Fightable** — landing on the node starts a **full-HP** fight against the
   boss. Each attempt is fresh and self-contained (like a named wild encounter);
   there is **no lingering HP pool** between attempts, and no shared season pool.
2. **Kill it** — the lair becomes **abandoned for 1 hour, for that player only**.
   A per-player `respawnAt` timestamp is stamped and the `scavenged` flag reset.
3. **Abandoned window** — landing on the node shows the boss-specific
   abandoned-lair dialogue and lets the player **scavenge once**:
   - guaranteed small spores (`LAIR_SCAVENGE_SPORES`, 5–10 range), plus
   - a `LAIR_SCAVENGE_ITEM_CHANCE` (~18%) chance of one minor item from a small
     loot table.
   Revisiting during the same window shows the dialogue but reports the lair is
   "already picked clean" (no further reward).
4. **After 1 hour** — the boss respawns; the next visit is a full fight again.

### Consequences of dropping the shared pool

- A ruin-lair kill **does not** reform a Vestige, **does not** wake the Moor-Wyrm
  world event, and **does not** stamp first-conqueror — it is repeatable farm
  content now, so it must not re-trigger season-global events on each cycle.
- ~~The two ruin lairs are removed from `_guardian_pools`, so field /
  `boss_strike` spells can no longer chip them from afar. This is the correct
  consequence: with per-player fresh fights there is no shared pool to chip. The
  overworld also stops drawing a shared HP bar over these nodes.~~
  **Superseded 2026-09-02 — see "Amendment: ranged softening" below.**

### Amendment: ranged softening (2026-09-02)

Dropping these nodes from `_guardian_pools` left the spell picker with nothing to
list, so casting at Doomgape reported the generic *"Nothing is in range. Stalk
closer"* — advice that could never come true, and cost the player turns walking
toward a target that would never light up.

The lairs are targetable again, but the pool a spell chips is **per-player**,
stored on `doc['ruinLairs'][node]` next to the abandonment timer:

- `hp` / `buffs` are absent until something lands, so a pristine nest carries no
  state; a kill replaces the entry wholesale, so it respawns whole.
- **Damage always floors at 1** — including `sear_throne`'s `lethal` flag, which
  *can* unmake a sigil lair boss at range. A ruin-lair kill hands out a
  guaranteed prize egg and a POI claim, so it has to cost a trip to the nest.
- **Consumed on engagement.** Landing there opens the fight at the chipped HP
  with the curses applied, and resets the pool. Softening buys you one easier
  fight, not a permanent discount — so there is no chip-flee-chip loop, and the
  hourly respawn still caps the farm rate.
- **Not targetable while abandoned** — an empty nest has nothing to wound, and
  `_guardian_pools` omits it (so the overworld drops its HP bar too).
- `_guardian_pools` now takes the viewer's `doc`. The spectator board passes
  none and therefore shows no personal pools — a private pool has no business on
  the broadcast screen.
- The first-kill payout is keyed off `respawnAt`, not the entry's existence: a
  chip creates an entry too, and must not demote your first kill to `repeat`.

## Data

### `undercity_config.py` (scalar tunables)
- `LAIR_RESPAWN_MINUTES = 60`
- `LAIR_SCAVENGE_SPORES = (5, 10)`  — inclusive min/max
- `LAIR_SCAVENGE_ITEM_CHANCE = 0.18`

### `undercity_data.py` (tables)
- `RESPAWN_LAIRS = {'lair_titan', 'n288'}`
- Per-boss abandoned-lair dialogue string (keyed by node id).
- `LAIR_SCAVENGE_ITEMS` — small weighted table of minor consumables / low-tier
  salvage awarded on the item roll.

### Player doc (per-player state)
```
doc['ruinLairs'] = {
  '<node>': { 'respawnAt': '<iso>', 'scavenged': <bool> },
  ...
}
```
No new DynamoDB records — this rides on the existing player document.

## Server wiring (`undercity_db.py`)

- **`_lair(node)`** — if `node in data.RESPAWN_LAIRS`:
  - Read the player's `ruinLairs[node]` entry. If present and
    `now < respawnAt` → the lair is abandoned: return a new `lairAbandoned`
    result carrying the dialogue and the scavenge payout (gated by `scavenged`).
    First scavenge grants spores (+ possible item) and sets `scavenged = True`;
    subsequent visits return the "picked clean" dialogue with no reward.
  - Otherwise (no entry, or `respawnAt` elapsed) → start a **full-HP** fight,
    bypassing `_lair_state` / Vestige entirely. Flag the battle ctx so
    `_finish_lair` knows it is a respawn lair.
- **`_finish_lair`** — on an attacker win against a respawn lair:
  - **Reward tier:** if the player has no prior `ruinLairs[node]` entry, this is
    their first-ever kill of this lair → pay the `first` tier once (the legendary
    first-kill payout). Every later respawn-cycle kill (entry already exists) pays
    the `repeat` tier. The `ruinLairs[node]` entry is never deleted — after the
    hour elapses it simply reads as fightable — so it doubles as the "have I ever
    killed this" marker.
  - stamp `doc['ruinLairs'][node] = {'respawnAt': now + LAIR_RESPAWN_MINUTES, 'scavenged': False}`
  - **skip** `_award_lair_kill` (no Vestige reform, no world-event wake, no
    first-conqueror).
  - Loss / timeout: no persistent pool write — the fight simply ends.
- **`_guardian_pools`** — ~~skip nodes in `data.RESPAWN_LAIRS`~~ report them as
  `kind: 'ruin'` from the viewer's own doc (2026-09-02 amendment).

## Client (`src/app/undercity/`)

- Game state exposes `doc.ruinLairs` so the board can render these nodes as
  "Abandoned — respawns in Xm" (dimmed / altered look) during the window, and as
  a normal fightable lair otherwise.
- Board-tab node modal: for a ruin lair, show the fight prompt when fightable,
  or the abandoned dialogue + scavenge state when abandoned.
- Handle the new `lairAbandoned` landing result (dialogue + reward toast),
  mirroring how existing landing events are surfaced.

## Tests (`infrastructure/lambda/tests`)

Extend the in-memory FakeTable integration suite:
- Kill a respawn lair → assert abandoned state stamped, **no** Vestige, **no**
  world-event wake, **no** first-conqueror stamp.
- Visit while abandoned → scavenge once (spores granted, `scavenged` set); a
  second visit in the same window yields no further reward.
- Advance the clock past `respawnAt` (inject a later `now`) → the next visit
  starts a full-HP fight again.
- Sigil lairs are unaffected (spot-check one still reforms a Vestige).

## Out of scope

- Any change to the five sigil lairs.
- New art / sprites for the abandoned state (reuse existing rendering, dimmed).
- Bounty Board and other deferred Plaza-economy items.
