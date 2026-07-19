# Undercity — Guardian targeting & pacing lair bosses

**Date:** 2026-07-19
**Status:** Design approved, pending implementation plan

Two related Undercity changes:

1. **Lair bosses pace behind their spaces** — a menacing idle animation so the
   sigil-boss dungeons feel alive (the boss lurks behind its gate).
2. **Range spells can hit guardians** — the `field_damage` / `field_curse`
   spells, which today only reach rival players, can also target guardians of
   any kind (barrier guardians like the Golgari Grave-Troll, the biome lair
   bosses, and Savra) when they are within the spell's range.

---

## Part 1 — Menacing lair bosses (client only)

Today `BoardCanvas.drawGuardian()` ([board-canvas.ts:1061](../src/app/undercity/engine/board-canvas.ts#L1061))
draws a creature doing a shallow bob on *sealed barrier* nodes, lazily loading
transparent art from `undercity/guardians/<id>.png` with a placeholder-sprite
fallback. Lair nodes currently render only the temple/lair building sprite —
no creature.

### Change

Add `drawLairBoss(node, elapsed)`, called from the node-draw path for `lair`
nodes on the dungeon layers, drawn **behind** the lair building sprite so the
beast is partly occluded — it reads as pacing behind the gate. It reuses the
existing `guardianArt()` loader keyed by the lair's art id. The client already
mirrors lair node → art id (`lairNpcId` in the dungeons data, used by
`creature-tab`), so no new mapping table is needed.

### Animation: menacing idle

Distinct from the barrier guardian's small bob:

- **Heavy breathing** — a slow, deep vertical scale wobble (slower and larger
  amplitude than the player-token `BREATH_*` constants).
- **Occasional lunge** — every few seconds the sprite does a brief forward dip
  + rear-up, then settles. Phase is desynced per node (seed from a hash of the
  node id) so multiple lairs never lunge in lockstep.
- **Near-stationary** — minimal side sway; the creature holds its ground.

New constants live beside the existing `GUARDIAN_*` block (`LAIR_BREATH_SPEED`,
`LAIR_BREATH_AMT`, `LAIR_LUNGE_PERIOD`, `LAIR_LUNGE_AMT`, `LAIR_H`).

A slain lair (Vestige state) still shows the boss but dimmed/slightly smaller,
signalling it has already fallen once. Slain state is not currently pushed to
the canvas per-node; if it isn't readily available, v1 renders every lair boss
at full presence and the dim-when-slain nuance is deferred.

**Scope:** pure client render. No server, state, or gameplay change in Part 1.

---

## Part 2 — Range spells can target guardians

### Current behaviour

- `field_damage` / `field_curse` route through `_cast_at_player`
  ([undercity_db.py:2399](../infrastructure/lambda/undercity_db.py#L2399)):
  range-checked via `board_distance`, dodge roll on the target's SPD, damage
  floored at 1 HP (never composts a player) or a buff written to the target's
  `buffs[]`.
- `boss_strike` (Queen's Bane) already chips Savra or a lair boss **from
  anywhere** (no range check), flooring the pool at 1.
- Barrier guardians have **no persistent HP** — a barrier is a binary
  open/closed gate; you fight the guardian in person and winning opens it for
  the whole season.
- Lair bosses and Savra have persistent season-shared HP pools
  (`_lair_state`, `_boss_hp`).

### New persistent state (server)

Both barrier guardians and lair bosses/Savra need a persistent pool **and**
persisted debuffs.

| Entity | Record | Fields |
| --- | --- | --- |
| Barrier guardian | `BARRIER#{node}` (new) | `hp` (default = full), `buffs[]` |
| Lair boss | `LAIR#{node}` (exists) | + `buffs[]` |
| Savra | `BOSS` (exists) | + `buffs[]` |

New helpers `_barrier_state(table, sid, node) -> (hp, buffs)` and
`_set_barrier_state(...)`, mirroring `_lair_state` / `_set_lair_state`.
`_lair_state` / boss helpers extended to round-trip `buffs[]`.

A barrier that has already been opened for the season (`_open_barriers`) has no
guardian left — it is not a legal target.

### Casting — target dispatcher

Generalize `_cast_at_player` into `_cast_at_target`, dispatching on the target
token:

- **Rival player id** → unchanged (dodge on SPD, damage floored at 1, or buff).
- **Barrier node id** (in `BARRIER_GUARDIANS`, not yet open) → range-checked;
  `field_damage` chips the barrier pool floored at 1; `field_curse` appends the
  buff to the barrier record's `buffs[]`.
- **Lair node id** (in `LAIR_BOSSES`) → range-checked; chip the lair pool
  floored at 1 / append buff.
- **`'boss'`** (Savra) → range-checked; chip the boss pool floored at 1 /
  append buff.

Rules for guardian/boss targets:

- **Range-checked** with `board_distance(caster.position, target_node,
  spell['range'], closed_barriers)`. Unlike the anywhere-reach `boss_strike`,
  field spells require proximity. Barrier and lair nodes are reachable
  landing spaces, so the BFS resolves normally; `out_of_range` returns before
  the cooldown starts (spec §"cooldowns only start on a successful cast").
- **No dodge** — guardians and bosses are rooted; a ranged chip never whiffs
  (matches `boss_strike`, which never dodges).
- **Floored at 1** — the pool can never be emptied remotely. The in-person kill
  is still required to open a barrier or slay a lair/Savra. (Per design choice:
  chip-to-soften, not remote-open.)
- **No reward** — ranged chips pay no bounty/renown (parity with `boss_strike`
  on lairs; the per-POI renown is paid only on the real break/first-kill).

### Applying persisted state in battle

`_barrier` and `_lair` (and the Savra fight) read the stored pool HP (lairs
already do this) and translate stored `buffs[]` into NPC stat debuffs at battle
start, via a small `GUARDIAN_DEBUFF` map:

| Buff kind | NPC effect |
| --- | --- |
| `bone_chill` | −2 ATK |
| `weaken_hex` | −3 ATK |
| `vines` / `bog_snare` | −SPD (roll-halving is meaningless for an NPC, so it maps to a speed penalty) |

ATK/SPD floored at 1 after debuffs. The debuffs are **consumed when the battle
begins** — the same one-battle model as player buffs, and consumed by *any*
challenger's engagement (win or lose), per design choice. Barrier guardian HP
otherwise lingers across the season exactly like a lair pool.

### Frontend

- `spellTargets()` ([board-tab.component.ts:226](../src/app/undercity/tabs/board-tab.component.ts#L226))
  gains in-range guardians/bosses alongside rivals: barrier guardians (not yet
  open), lair bosses, and Savra — each with board distance and current pool HP.
  Tapping one casts with `target: <node | 'boss'>`.
- The field-spell target picker renders guardian/boss entries in the same list
  as rival players (name, distance, HP).
- The state serializer ([undercity_db.py ~652](../infrastructure/lambda/undercity_db.py#L652))
  already exposes `boss.hp` and `barriersOpen`; add lair pool HP and barrier
  guardian pool HP so the picker can show real HP.

### Tests (FakeTable pytest suite — keep green)

- `field_damage` chips a barrier guardian pool and floors at 1 (never opens it).
- Out-of-range guardian target rejected with `out_of_range`, cooldown NOT
  started.
- `field_curse` on a barrier persists and applies the ATK/SPD debuff when the
  next challenger fights it; the debuff is consumed after that battle starts.
- `field_damage` / `field_curse` chip and curse a lair boss and Savra,
  range-gated.
- Reward parity: a ranged chip pays no bounty/renown.

---

## Out of scope / deferred

- Dim-when-slain nuance for lair bosses if slain state isn't readily available
  to the canvas (v1 renders full presence).
- Any new spell — this reuses the existing `field_damage` / `field_curse`
  spells and their ranges.
- Remote **opening** of a barrier (chip-to-0 opens it) — explicitly rejected;
  the in-person kill stays required.
