# Undercity DEF Perk Changes — Thick Hide Hazard Dodge + Last Stand ½ HP — Design

**Date:** 2026-08-01
**Status:** Approved (brainstorm) — pending spec review
**Related:** attribute-perk tracks in
[specs/2026-07-21-undercity-attribute-perks-design.md](2026-07-21-undercity-attribute-perks-design.md);
hazard wheel in
[specs/2026-07-30-undercity-hazard-wheel-design.md](2026-07-30-undercity-hazard-wheel-design.md);
combat model in [specs/undercity-combat.md](undercity-combat.md).

## Motivation

Two tweaks to the **DEF** perk track:

1. **Thick Hide (DEF-6)** currently gives a flat, invisible 50% HP-loss halving on
   hazards and bad mystery rolls. We want the perk to *feel* like tough skin: a
   DEF-scaled **chance to dodge a hazard entirely**, surfaced through the existing
   hazard wheel as "lucky safety wedges" the wheel can land on. This turns the
   hazard wheel — today a purely cosmetic reveal — into a genuine tension beat for
   a Thick-Hide creature.
2. **Last Stand (DEF-18)** currently revives you at **1 HP**, **once per descent**,
   on an otherwise-lethal blow. Two problems: rising at 1 HP means you survive only
   to immediately flee, and DEF-18 is a *very* heavy investment for a save that's
   gated per descent. Change it to rise at **½ max HP** and recharge on a **real-time
   1-hour cooldown** instead of per descent.

## Part 1 — Thick Hide becomes a hazard dodge

### Behavior

- On landing a hazard, if the creature has the `thick_hide` perk, the **server**
  rolls a DEF-scaled dodge.
- **Dodge → the whole hazard is negated**: no HP loss, no spore loss, no debuff,
  no teleport. The event returns a "safe" result and the wheel lands on a lucky
  safety wedge.
- **No dodge → today's behavior, unchanged** — including the existing 50% HP
  halving in `_apply_hp_loss` (`THICK_HIDE_MULT = 0.5`). The dodge is **additive**,
  not a replacement, so the perk is a *strict upgrade* over today.

Consequences of layering (not replacing):

- The **bad-mystery-roll** halving is untouched — the mystery slot-reel path still
  calls `_apply_hp_loss`, which still halves. (No dodge on mystery; only hazard
  *spaces* get the wheel dodge.)
- On a hazard **hit**, effects that today ignore Thick Hide still apply in full —
  `swamp_gas` spore loss and `vines`/`webbing`/`grave_chill` debuffs were never
  halved (only HP is). The dodge is the *only* thing that can now save you from
  those; a hit leaves them exactly as today.

### Dodge chance (DEF-scaled)

The chance scales with the **DEF perk-stat** — base DEF (species + level spends +
evolution) **plus equipped gear**, temp buffs excluded — i.e. `engine.perk_stat(doc,
'def')`, the same value that lights the perk. New scalars in
`undercity_config.py`:

```python
THICK_HIDE_DODGE_BASE = 0.15         # dodge chance at DEF perk-stat 6 (tier-1 unlock)
THICK_HIDE_DODGE_PER_DEF = 0.02      # +chance per DEF point above 6
THICK_HIDE_DODGE_MAX = 0.40          # cap
THICK_HIDE_DODGE_DUNGEON_MULT = 0.5  # depths/dungeon hazards dodge at half the surface chance
```

Surface chance: `min(MAX, BASE + PER_DEF * max(0, def_stat - 6))`.
Dungeon chance: `surface_chance * DUNGEON_MULT`.

| DEF (base+gear) | Surface dodge | Dungeon dodge |
|---|---|---|
| 6 | 15% | 7.5% |
| 9 | 21% | 10.5% |
| 12 | 27% | 13.5% |
| 15 | 33% | 16.5% |
| 18 | 39% | 19.5% |
| 20+ | 40% (cap) | 20% |

**Depths stays hard** (memory: keep the boss approach brutal) — a dedicated DEF-18
tank still eats ~4 of 5 lair hazards.

New blurb (server + client mirror): *"A DEF-scaled chance to dodge a hazard
entirely; if caught, your hide still halves the HP loss."*

### Server contract

Rules stay server-authoritative; the wheel only animates the server's decision.
The scalar dodge lives in `undercity_config.py`; the roll and event stamping live
in `undercity_db.py`. Each hazard event gains a `hazardSafe` field **only when the
player has the perk**:

- **Surface `_hazard`:**
  - Perk + dodge → apply nothing; return
    `{'type':'hazard', 'hazardOutcome':'safe', 'hazardSafe': True,
      'text':'Your thick hide shrugs it off — no harm done. (Thick Hide)'}`.
  - Perk + no dodge → today's branch, plus `'hazardSafe': False`.
  - No perk → unchanged (no `hazardSafe` field, no `hazardOutcome:'safe'`).
- **Dungeon `_dungeon_hazard`:**
  - Perk + dodge (dungeon chance) → apply nothing; return
    `{'type':'hazard', 'biome': biome, 'hazardSafe': True,
      'text':"The lair's curse slides off your carapace. (Thick Hide)"}`.
  - Perk + no dodge → today's branch, plus `'hazardSafe': False`.
  - No perk → unchanged.

`hazardSafe: False` (a present-but-false field) is what tells the wheel to render
*teasing* safe wedges — "you almost dodged" — even on a hit.

The dodge roll uses the module RNG (`_rng.random()`), so tests drive it by
monkeypatching `_rng.random`. The perk check reuses `engine.attribute_perks(doc)`
(same call `_apply_hp_loss` already uses).

### Client — event model

`src/app/undercity/services/undercity-models.ts`: add `hazardSafe?: boolean` to
`SpaceEvent` (`hazardOutcome?`/`biome?` already exist from the hazard-wheel work).

### Client — wheel component

`hazard-wheel.component.ts` and its `HazardWheelTarget`:

- Add a **`safe`** face to the effect set (green, e.g. Material `verified` /
  `shield`).
- `HazardWheelTarget` gains `hasPerk?: boolean` and `safe?: boolean`.
  `board-tab.hazardWheelTarget(ev)` sets:
  - `hasPerk = ev.hazardSafe !== undefined`
  - surface: `safe = ev.hazardSafe === true`; `outcome = safe ? 'safe' : ev.hazardOutcome`
  - dungeon: `safe = ev.hazardSafe === true` (existing `bossId` still resolved for the tease)
- Wedge build: when `hasPerk`, seed a couple of safe wedges among the losers.
  Winner (wedge 0) is the safe glyph on a dodge, or the hazard/boss on a hit. In
  dungeon mode a dodge just makes wedge 0 one of the existing decoy wedges.
- Caption/flavor on a safe landing: *"Dodged! (Thick Hide)"*; then the hazard card
  opens showing the "no harm" text. The safe-wedge count is **cosmetic** — it only
  needs to look plausible; the server roll is authoritative.

Non-perk players see the wheel exactly as today (no `hazardSafe`, no safe wedges).

## Part 2 — Last Stand rises at ½ max HP, on a 1-hour cooldown

Two changes to the Last Stand branch in `undercity_db._finish_battle`.

### ½ max HP (was 1)

The branch currently sets `result['attackerHp'] = 1`. Change to:

```python
max_hp = engine.effective_stats(doc)['maxHp']
result['attackerHp'] = max(1, round(max_hp * config.LAST_STAND_HP_FRAC))
```

Use `engine.effective_stats(doc)['maxHp']` (not the raw doc value) so gear/perk
max-HP bonuses — including Carapace Grind's +15 — are included, mirroring the
mystery-heal path. New scalar:

```python
LAST_STAND_HP_FRAC = 0.5   # DEF-18: revive at this fraction of max HP (was a flat 1)
```

### Recharge: real-time 1-hour cooldown (was once per descent)

DEF-18 is a heavy investment, so the save should be broadly available rather than
locked to a single descent. Replace the per-descent `lastStandUsed` boolean with a
**time-gated cooldown**, matching the game's existing real-time regen model
(`_now()` ISO strings; roll regen uses `engine._parse_iso(...) + timedelta(...)`).

- **New field:** `lastStandReadyAt` — an ISO timestamp of when the save is next
  available. Availability check (cheap string compare, like `shieldUntil`):
  `ready = not doc.get('lastStandReadyAt') or doc['lastStandReadyAt'] <= _now()`.
- **On trigger:** set the HP to ½ max as above and stamp
  `doc['lastStandReadyAt'] = (engine._parse_iso(_now()) + timedelta(minutes=config.LAST_STAND_COOLDOWN_MINUTES)).isoformat(timespec='seconds')`.
- **Remove** the per-descent reset block in `handle_action`'s surfacing logic
  (`if region != 'depths' and doc.get('lastStandUsed'): doc.pop('lastStandUsed')`)
  — availability is now time-based, not descent-based. Legacy `lastStandUsed`
  booleans on old docs are simply ignored (optionally popped on surface for
  hygiene); no migration needed.

```python
LAST_STAND_COOLDOWN_MINUTES = 60   # DEF-18: real-time recharge between saves
```

**Cadence note:** vs today, a long deep dive (>1h without surfacing) can now trigger
Last Stand more than once, while a rapid die→resurface→redive loop within the hour
gets *one* save instead of one-per-descent. That's the intended trade for the heavy
DEF-18 cost — the save is reliably there over a play session rather than farmable by
bouncing to the surface.

**Unchanged:** the ½-HP revive still drops an otherwise-losing fight to
`outcome = 'timeout'` — you survive and the foe lingers; you do **not** convert a
loss into a win. Tougher survival, not a free boss kill (memory: solo-boss stays
hard).

New blurb: *"Survive one lethal blow, rising at half your max HP. Recharges every
hour."*

### Optional (deferred) — cooldown display

Surfacing `lastStandReadyAt` in the `you` view would let the creature panel show a
"Last Stand: ready / Xm" cooldown. Nice-to-have, not required for this change; left
out unless playtest wants it.

## Server ⇄ client mirrors

- Blurbs for `thick_hide` and `last_stand` updated in **both**
  `infrastructure/lambda/undercity_data.py` (`PERKS`) and
  `src/app/undercity/data/perks.ts`.
- New scalars (`THICK_HIDE_DODGE_*`, `LAST_STAND_HP_FRAC`,
  `LAST_STAND_COOLDOWN_MINUTES`) live in `undercity_config.py`. They are pure server
  balance knobs and are **not** needed by the client (the client only reads the
  `hazardSafe` outcome), so no mirror is required for them.

## Testing & validation

### Backend (`infrastructure/lambda/tests/`)

- **Surface dodge success:** `thick_hide` creature, `_rng.random` forced below the
  chance → event has `hazardSafe True` and `hazardOutcome 'safe'`; HP, spores,
  buffs, position all unchanged.
- **Surface dodge fail:** forced above the chance → today's outcome applies **and**
  `hazardSafe False` present.
- **No perk:** low-DEF creature → no `hazardSafe` field; behavior identical to
  today (existing hazard assertions stay green).
- **Dungeon dodge:** same success/fail for `_dungeon_hazard`, asserting the
  reduced (× `DUNGEON_MULT`) threshold — pick an RNG value that dodges at the
  surface chance but *not* at the dungeon chance to prove the halving.
- **Last Stand ½ HP:** force an otherwise-lethal result on a DEF-18 creature →
  survives at `round(maxHp * 0.5)`, `outcome == 'timeout'`, `lastStandReadyAt`
  stamped ~1h out.
- **Last Stand cooldown:** a second lethal blow while `lastStandReadyAt > _now()`
  is **not** saved (drops normally); once `lastStandReadyAt <= _now()` (drive by
  setting the field into the past) the save fires again. Surfacing no longer
  refreshes it — assert a resurface/redive within the window still can't re-trigger.
- Keep the existing hazard tests green — verify they use non-perk (low-DEF)
  creatures or force no-dodge so the new roll doesn't perturb them.

### Frontend

- `npm run build` green (no unit-test runner in this repo).
- Manual/visual: drive a Thick-Hide creature into a surface hazard and a dungeon
  hazard; confirm the wheel shows safe wedges, lands on the safe wedge on a dodge
  (card = "no harm"), lands on the hazard on a hit (card = full effect), and that a
  non-perk creature sees the unchanged wheel.

## Files touched

| File | Change |
|---|---|
| `infrastructure/lambda/undercity_config.py` | `THICK_HIDE_DODGE_*`, `LAST_STAND_HP_FRAC`, `LAST_STAND_COOLDOWN_MINUTES` |
| `infrastructure/lambda/undercity_db.py` | Dodge roll + `hazardSafe` stamping in `_hazard`/`_dungeon_hazard`; Last Stand ½-HP + 1h cooldown; remove per-descent reset |
| `infrastructure/lambda/undercity_data.py` | `thick_hide` / `last_stand` blurbs |
| `infrastructure/lambda/tests/test_undercity_db.py` | Dodge + Last Stand tests |
| `src/app/undercity/data/perks.ts` | Mirror blurbs |
| `src/app/undercity/services/undercity-models.ts` | `hazardSafe?: boolean` on `SpaceEvent` |
| `src/app/undercity/tabs/hazard-wheel.component.ts` | `safe` face + safe wedges; `HazardWheelTarget` gains `hasPerk`/`safe` |
| `src/app/undercity/tabs/board-tab.component.ts` | `hazardWheelTarget` reads `hazardSafe` |

## Scope guards / deferred

- Single-player PvE only; no PvP interactions.
- Dodge applies to **hazard spaces only** — not to bad mystery rolls (those keep
  their existing 50% HP halving) and not to combat.
- Dodge chance scales with DEF perk-stat only; no separate dodge currency, no
  respec. Thresholds unchanged (6/12/18).
- Safe-wedge *count* on the wheel is cosmetic; the server roll is the source of
  truth. No new hazard effects or rules beyond the dodge short-circuit.
