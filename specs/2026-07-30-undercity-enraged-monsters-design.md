# Undercity — Enraged Wilderness Monsters

**Date:** 2026-07-30
**Status:** Design approved, pending implementation plan

## Summary

Introduce **enraged monsters**: a single shared, spell-targetable creature that
haunts the wilderness at any given time and **relocates every 1.5 hours** via a
deterministic wall-clock window. It behaves like a barrier guardian — real
combat when you land on its node, a shared HP pool (~40 HP) that persists across
every attacker, and targetable from range by damage/curse field spells — but it
is an **overlay** on a wilderness node rather than a fixed node type. Killing it
grants the killing-blow player renown + XP + a gear drop, and the spot stays
empty until the next window spawns a fresh one.

Goal: make the wilderness more dangerous and more rewarding, and give players
with good curses and damage spells a reliable, regular target to excel against.

## Requirements (from brainstorming)

- **Interaction model:** guardian-style. Land on its node → interactive combat
  (it swings back). Also targetable from range with damage/curse spells. Shared
  HP pool; wounds persist across all attackers.
- **Spawn model:** one at a time, deterministic node per 1.5h window
  (Umori-style, no cron). Killed before the window ends → empty until the next
  window.
- **Rewards:** last hit only. 15–20 renown + XP + a gear drop.
- **Variety:** a small roster of 4 variants, one picked deterministically per
  window, each rewarding a different build archetype.
- **Ranged-kill rule:** normal `field_damage` spells floor the pool at 1
  (soften only), exactly like barrier guardians. Only a `lethal`-flagged
  `boss_strike` spell (Sear the Throne) may land the killing blow at range and
  claim the reward. Curses (`field_curse`) persist and bite in the melee fight.
  This lets damage/curse casters "excel with regularity" (soften every window)
  while the actual kill needs melee or the one lethal strike.

## Explicitly out of scope (YAGNI)

- No contribution/assist rewards — last hit takes everything.
- No passive "damage for walking nearby" — danger comes from the fight itself.
- No unique art yet — placeholder sprites, swapped later.
- No per-creature frenzy ramp. Frenzy (`_frenzy_from` → `FRENZY_START`) is
  global to all battle kinds and not a per-monster knob, so the Ravager is an
  aggressive all-rounder (high ATK + SPD) rather than a special-ramp variant.

## Existing systems reused

This feature is a hybrid of three working systems; almost every piece has a
template already in the codebase.

| Piece | Template | Location |
| --- | --- | --- |
| Shared HP pool, rooted, spell-targetable, HP bar | Barrier guardians | `undercity_db.py` `_barrier_state`/`_set_barrier_state` (~3239), `_guardian_pools` (~3257) |
| Wilderness overlay + sprite + shared spawn | World Event beast | `undercity_db.py` `_spawn_world_event` (~3338), `_finish_world` (~3823); `board-canvas.ts` `drawWorldEventTile`/`drawWorldEventPiece` |
| Deterministic wall-clock periodic spawn (no cron) | Umori wandering post | `undercity_db.py` `_umori_window` (~66), `_umori_node` (~80); `undercity_config.py` `UMORI_DWELL_MIN` |
| Guardian combat + curse debuffs | Barrier/lair combat | `undercity_db.py` `_barrier` (~3225), `_combat_round` (~3435), `_apply_guardian_debuffs` (~4376), `GUARDIAN_DEBUFF` in `undercity_data.py` (~1173) |
| Spell target routing | Guardian targeting | `undercity_db.py` `_cast_field` (~4604), routing check (~4606), `_cast_at_guardian` (~4611) |
| Gear/loot reward roll | Lair boss rewards | `undercity_db.py` lair finisher / reward tables (`LAIR_BOSSES` in `undercity_data.py` ~1120) |

## Architecture

### Spawn model — deterministic, no cron

Reuse Umori's `_umori_window` pattern so every client computes the same spawn
with zero server tick.

- `window = seconds_since_epoch // (ENRAGED_DWELL_MIN * 60)`, `ENRAGED_DWELL_MIN = 90`.
- `hash(window)` → picks the **node** from the wilderness node list
  (`UMORI_NODES` / `region == 'wilderness'`), **excluding Umori's current node**
  so the two overlays don't stack on the same tile.
- `hash(window, salt)` → picks **which roster monster** spawns.
- Expose an `enragedMovesAt` countdown to clients, like Umori's `movesAt`.

**Rollover is computed on read.** Whenever enraged state is read/resolved, if the
stored `window` != the current window, reset to a fresh spawn (new node, new
monster, full HP, `dead=False`). This single mechanism delivers both "respawn"
and "move" with no scheduled Lambda.

### Shared state & persistence

New DynamoDB item under the season PK:

- `sk = 'ENRAGED'` → `{window, monsterId, node, hp, maxHp, buffs, dead}`.
- Helpers `_enraged_state` / `_set_enraged_state`, modeled on `_barrier_state`.
- Damage uses the **re-read-and-apply-delta** concurrency pattern (like
  `_finish_world`) so parallel attackers don't clobber the pool.
- Killed mid-window → `dead=True, hp=0`; the node reverts to normal behavior
  until the next window rolls over.

### Combat & danger (guardian-style)

- The monster **overlays** its wilderness node. While alive there, landing on
  that node pulls the player into an interactive battle of kind `'enraged'`,
  resolved by the existing `_combat_round`. It swings back — that is the "more
  dangerous wilderness" payoff. When dead/absent, the node behaves normally.
- Rooted, so it gets the same `GUARDIAN_DEBUFF` treatment (roll-halving curses
  convert to speed penalties).
- **Ranged:** targetable by the same damage/curse field spells that already hit
  guardians. Extend `_cast_field`'s target routing (~`undercity_db.py:4606`) and
  `_cast_at_guardian` to accept enraged monster ids. This is the "spell builds
  excel with regularity" payoff.

### Roster (4 variants, ~40 HP, distinct shapes)

New `ENRAGED_MONSTERS` table, same shape as `BARRIER_GUARDIANS`
(`{id, name, hp, atk, def, spd, personality, bluff, bounty, xp, sprite}`):

1. **Brute** — high ATK / low DEF, 38 HP. Punishes toe-to-toe melee; curses &
   kiting shine.
2. **Carapace** — high DEF, 44 HP, low ATK. Wall of meat; rewards raw damage
   spells that ignore the grind.
3. **Swift** — high SPD, 36 HP. Rewards SPD/roll builds and initiative.
4. **Ravager** — aggressive all-rounder (high ATK + SPD), 40 HP. Fastest to
   punish a slow build; no special frenzy (see the out-of-scope note).

Each carries its own `bounty` (15–20 renown), `xp`, `personality`, `bluff`, and
sprite id.

### Rewards — last hit only

`_finish_enraged` awards the killing-blow player: **15–20 renown** (per-monster
`bounty`) + **XP** + a **gear drop** (reuse the lair-boss gear/loot roll). No
contribution tracking — whoever lands the kill takes it.

### Rendering

- `board-canvas.ts`: `setEnraged(...)` feeder + `drawEnragedMonster` (copy of
  `drawGuardian`), reusing `drawGuardianHp` for the HP bar. Art under
  `undercity/enraged/<id>.png`, **placeholder sprites initially** (reuse existing
  guardian/Dino art), swapped later.
- Countdown + target surfaced in `board-tab.component.ts` alongside guardians
  and Umori.

### Frontend plumbing

- `services/undercity-models.ts`: `EnragedMonster` interface + a
  `GameState.enraged` field.
- `services/undercity-state.service.ts`: `enraged = computed(...)`.
- `tabs/board-tab.component.ts`: add to the spell-target list (copy
  `spellGuardianTargets`), wire the render feed in `syncBoard`, add the
  engage/attack path.

### Config & mirrors

- `undercity_config.py`: `ENRAGED_DWELL_MIN = 90`, plus HP/renown/XP tunables.
- Mirror the display numbers in `src/app/undercity/data/` per project convention.

## Testing (pytest — keep the suite green)

- **Spawn determinism:** same window → same node + monster across independent
  computations.
- **Window rollover:** crossing a boundary relocates + refreshes to full HP.
- **Ranged damage:** a spell reduces the shared pool; a second caster sees the
  reduced HP.
- **Melee combat:** resolves and the monster swings back.
- **Reward:** last hit grants renown + XP + gear; non-killers get nothing.
- **Dead-for-window:** stays empty until rollover.
- **Map sync:** `map.json` ↔ `public/data/undercity-map.json` stay in sync.
