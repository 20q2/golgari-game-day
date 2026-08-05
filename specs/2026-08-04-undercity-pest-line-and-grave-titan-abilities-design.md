# Undercity — Pest-line & Grave Titan ability rework (2026-08-04)

## Problem

Three player evolution forms don't deliver on their promised identity:

- **Brackish Trudge** (pest T2, "Bruiser") — passive `undying` (revive once/hour at
  50% HP) has **zero in-combat presence** and almost never triggers. Effectively useless.
- **Vexing Pest** (pest T2, "Speedster") — passive `vexing` (25% enemy-miss + a
  read-rate bonus) leans *speedster*, but speed is the **saproling/fungus line's**
  identity (Slitherhead's `skitter` is the same 25%-miss). The pest line is meant to be
  **spore-scrounging all-rounders**, not a second speed line.
- **Grave Titan** (apex, "HP/DEF colossus") — passive `deathtouch_stomp` (ignore 3 DEF)
  is an *offensive* pierce ability, so it never *feels* like the hulking tank its stats
  and blurb promise.

## Design goals

Re-anchor the **pest line as the Scavenger's Path** — versatile, resourceful survivors
who always come out okay (base Pest = `scrounger`). The two T2 branches stay *well-rounded*
(not speedsters) and split by the apexes they feed: Vexing Pest → nimble/tricky apexes,
Brackish Trudge → sturdy apexes. Grave Titan becomes a genuine wall.

Passives **accumulate** through evolution ([undercity_db.py:6342](../infrastructure/lambda/undercity_db.py#L6342)),
so these new passives also ride onto the apexes each form feeds — that's intended and fine.

---

## Change 1 — Vexing Pest: `vexing` → `improvise`

**Identity:** the elusive all-rounder that has no bad matchup — it shores up whatever
it's weak at, every fight.

- **New passive `improvise`:** at the **start of each battle**, the creature's **lowest of
  ATK / DEF / SPD gets a temporary `+IMPROVISE_BONUS`** (new scalar, **3**) for that fight.
  - Computed from the creature's *base* effective stats (pre-buff) so the buff can't shift
    which stat is "lowest." Deterministic tie-break: fixed order `atk → def → spd` (buff the
    first that ties the minimum).
  - Implemented as a self-targeted **one-battle buff** applied at `_start_battle` (same
    machinery as Deathrite's dynamic Soul Trophy buff: `{'kind': 'improvise', 'stat': …,
    'amount': IMPROVISE_BONUS}`, read in `engine.effective_stats`, cleared via
    `undercity_db.ONE_BATTLE_BUFFS`). Distinct from Wood Lurker's `mimicry`, which copies
    the **foe's** stat.
- **Remove the evasion + read bonus:** drop `'vexing'` from `FLYBY_DODGE`'s check
  ([undercity_engine.py:273](../infrastructure/lambda/undercity_engine.py#L273)) and from
  `READ_PASSIVE_BONUS` ([undercity_data.py:549](../infrastructure/lambda/undercity_data.py#L549)).
  `skitter` (saproling) remains the sole owner of the 25%-miss, ending the toe-stepping.
- **Stat bonus:** `{spd:2, atk:2}` → balanced spread **`{maxHp:6, atk:1, def:1, spd:1}`**.

## Change 2 — Brackish Trudge: `undying` → `bog_forager`

**Identity:** the resourceful survivor for players who lean into **exploration**. Layers on
top of the pest's inherited `scrounger`. Deliberately **utility/economy, not combat** (and
avoids "heal after battle" so it doesn't step on the zombie line's `regrowth`).

- **New passive `bog_forager`, two pillars:**
  1. **Deeper scavenging** — on a **lost / fled / stalemated** wild or elite fight it picks
     more from the bones: `_scrounge_consolation` uses **`BOG_FORAGER_LOSS_FRACTION` (0.5)**
     instead of `SCROUNGER_LOSS_FRACTION` (0.3) when the holder is a bog forager. Its income
     is near survival-independent.
  2. **Explorer's luck** — bad **mystery events reroll once**: add `bog_forager` to the
     `drift` reroll flag passed into `engine.roll_mystery`
     ([undercity_db.py:3942](../infrastructure/lambda/undercity_db.py#L3942)).
- **Stat bonus:** keep sturdy `{maxHp:6, atk:2}`.
- `undying`'s revive branch in `_compost` ([undercity_db.py:2014](../infrastructure/lambda/undercity_db.py#L2014))
  becomes dead code after migration — remove it in the same pass.

## Change 3 — Grave Titan: `deathtouch_stomp` → `colossus`

**Identity:** a pure hulking wall — hard to hurt, enormous HP, wins the sudden-death
Collapse (highest HP-fraction side) by simply outlasting everything.

- **New passive `colossus`:** all **enemy strike damage against it is reduced by
  `COLOSSUS_DR` (0.15)** — a flat multiplier applied *on top of* DEF's proportional
  mitigation. Applies to decisive hits, Guard counters/mitigated hits, clash, and whiff/chip
  strikes. **Does NOT apply to rot ticks or the Collapse ramp** (the tank already wins the
  Collapse on HP fraction — DR there would double-dip).
  - Cleanest engine hook: a `Combatant`-level incoming-damage multiplier
    (`dmg_taken_mult`, default 1.0, set to `1 - COLOSSUS_DR` when `.has('colossus')`),
    applied at each strike damage-application site (`_deal` and the decisive-hit path in
    `resolve_round`). Rot/frenzy application sites are left untouched.
- **Remove** the `deathtouch_stomp` pierce branch
  ([undercity_engine.py:295-296](../infrastructure/lambda/undercity_engine.py#L295-L296));
  `DEATHTOUCH_PIERCE` becomes unused (leave the scalar defined, note it as retired).
- **Stat bonus:** `{maxHp:6, def:2}` → **`{maxHp:12, def:4}`** — a real wall.
- Applies to **all** origins (Grave Titan is the tank apex for the zombie/elf lines too).

---

## Save migration

Extend the load-time passive remap already in `_migrate`
([undercity_db.py:380-383](../infrastructure/lambda/undercity_db.py#L380-L383), the
`flyby`→`vexing` precedent) to remap accumulated keys on existing creatures **and** the
apexes they fed:

| old key | new key |
|---|---|
| `vexing` | `improvise` |
| `undying` | `bog_forager` |
| `deathtouch_stomp` | `colossus` |

One pass over `doc['passives']` handles it. No stat re-grant is needed (evolution bonuses
were already banked into the doc's flat stats); the changed `bonus` tables only affect
creatures that evolve **after** deploy.

## Client mirrors

- `src/app/undercity/data/forms.ts` — update `PASSIVE_NAMES`, `PASSIVE_BLURBS`, and the
  `passive`/`passiveName`/`bonus`/`blurb` on `vexing_pest`, `brackish_trudge`, `grave_titan`.
  Add `improvise`, `bog_forager`, `colossus`; retire `undying`, `deathtouch_stomp`, and the
  dodge/read framing on `vexing`.
- No `perks.ts` change — these are **form passives**, not the ATK/DEF/SPD attribute perks.

## Scalars (new)

In `undercity_config.py` (scalar tunables) unless noted:

- `IMPROVISE_BONUS = 3`
- `COLOSSUS_DR = 0.15`
- `BOG_FORAGER_LOSS_FRACTION = 0.5`

(`SPIKESHELL_RETALIATE`, `DEATHTOUCH_PIERCE`, `FLYBY_DODGE` stay in `undercity_data.py`
alongside the other combat scalars; `DEATHTOUCH_PIERCE` is now unused.)

## Testing

- **Engine** (`tests/test_undercity_engine.py`): Improvise buffs exactly the lowest base
  stat (and the documented tie-break); Colossus reduces enemy strike damage by ~15% but
  leaves rot/frenzy untouched; deathtouch pierce no longer applies.
- **DB/flow** (new `tests/test_undercity_pest_line.py`, mirroring the existing
  `test_undercity_gorgon.py` / `test_undercity_wood_lurker.py` shape): the three
  migrations remap old→new keys; Bog Forager pays the larger consolation on a lost fight and
  rerolls a bad mystery; evolving into each form grants the new passive.
- Keep `test_balance_good_play_beats_fodder` and the SPD/DEF regressions green.
- **Balance validation:** run the headless sim in `infrastructure/lambda/sim/` to confirm
  `COLOSSUS_DR = 0.15` doesn't trivialize deep/abyss/boss content (the boss is intentionally
  a hard epic — do not soften it to fit the tank).

## Out of scope

- Sprites/art (unchanged).
- Other lines' passives, attribute perks, gear, spells.
- Any board/space work.
