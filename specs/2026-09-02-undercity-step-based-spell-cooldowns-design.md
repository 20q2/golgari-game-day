# Step-Based Spell Cooldowns — Design

**Date:** 2026-09-02
**Status:** Approved, not yet implemented
**Supersedes:** the real-time cooldown model in [undercity-spells.md](undercity-spells.md) §Player rules

## Problem

Every spell recharges on a real-world clock. `SPELLS[*].cooldownMin` (15–60
minutes) is stamped into `doc['spellCooldowns'][spellId]` as an absolute ISO
timestamp and compared against `_now()` on each cast attempt.

Undercity is meant to be dropped into in short bursts. A 30-minute cooldown
inside a 20-minute session means the spell simply **does not exist** for that
session — the player's only way to access it is to stop playing and wait. The
standing design rule is that a timer governing *when you return* is good
(roll regen), but a timer that *idles you while you are playing* is bad.

Two adjacent timers on the same screens have the same defect:
`GRIMOIRE_SWAP_COOLDOWN_MIN` (30 min to open a different grimoire) and
`LAST_STAND_COOLDOWN_MINUTES` (60 min between death-saves).

Secondarily: the Gear menu never told the player what a spell's cooldown *is*.
It showed only a live countdown once the spell was already spent, so cost could
not be factored into a decision before casting.

## Approach

Convert all three timers from wall-clock minutes to **board spaces walked**,
following the step-timer idiom already established for companions
(`PET_FORAGE_RECHARGE_SPACES`, `petRecharge`, `incubator.spacesLeft`), and
surface each spell's step cost in the Gear menu before it is cast.

Walking always finishes a cooldown, so nothing a player starts can only be
completed by putting the phone down.

### Conversion scale

A straight **÷5** from the existing minutes, which preserves the current
relative balance between spells exactly and anchors 30 min → 6 steps, matching
`PET_FORAGE_RECHARGE_SPACES = 6`.

At the observed pace of ~9 spaces/hour this is *longer* in wall-clock terms than
what it replaces. That is intended and acceptable: the dead time is what was
being removed, not the duration. In burst terms — where a player spends banked
rolls back to back — it is far shorter, because ~3.5 spaces arrive per roll.

| min | steps | hasted | spells |
|---:|---:|---:|---|
| 15 | 3 | 2 | `ember_fleck`, `acorn_fury` |
| 20 | 4 | 2 | `spore_bolt`, `mend_flesh`, `harden_shell` |
| 25 | 5 | 3 | `skitter_step`, `sinkstep`, `rot_bolt`, `weaken_hex`, `renewing_bloom`, `shadowstep`, `savage_roar`, `iron_hide`, `fleetfoot_draught`, `sap_vigor` |
| 26 | 5 | 3 | `withering_gout` |
| 28 | 6 | 3 | `necrotic_lance`, `rust_curse` |
| 30 | 6 | 3 | `rot_surge`, `bone_chill`, `bog_snare`, `glowveil`, `scrap_toss`, `spore_burst`, `deep_step`, `deep_mend`, `warding_dance` |
| 40 | 8 | 4 | `fate_die` |
| 45 | 9 | 5 | `mycelial_recall` |
| 60 | 12 | 6 | `queens_bane`, `wish`, `sear_throne` |

Grimoire swap: 30 min → **6 steps**. Last Stand: 60 min → **12 steps**.

Squirrel **Spell Haste** keeps `SPELL_HASTE_MULT = 0.5`, applied as
`max(1, ceil(steps × mult))` — never zero, so haste is strong but a hasted
spell always costs at least one space.

## Architecture

### Storage: countdown integers

Each field becomes a plain integer count of spaces still owed, decremented as
the player walks. This mirrors the companion counters rather than introducing a
new monotonic step odometer, so there is one storage idiom in the document
instead of two.

| Field | Before | After |
|---|---|---|
| `spellCooldowns` | `{spellId: "2026-09-02T14:30:00"}` | `{spellId: 4}` |
| `lastGrimoireSwap` | ISO timestamp | `grimoireSwapSteps: 6` |
| `lastStandReadyAt` | ISO timestamp | `lastStandSteps: 12` |

A counter reaching 0 is **deleted**, so these keys never appear on a player who
does not use the feature — matching how `forageRecharge` behaves today.

### Ticking

All three counters advance in the existing `_tick_step_timers(doc, spaces)`
(`undercity_db.py`), which already has exactly one call site, in the surface
move handler. No new hook is needed.

**Server-side distance fallback.** The tick is currently keyed on the
client-supplied `path`, with a documented fallback of "a stale client that omits
`path` simply doesn't tick." That is harmless for a foraging pet but
unacceptable for spells, where it would mean *nothing ever recharges*. The
server already knows the distance from the validated pending move, so the call
site becomes:

```python
spaces = (len(path) - 1) if path else int(pm['value'])
_tick_step_timers(doc, spaces)
```

Companion counters tick more reliably as a side effect. This is a deliberate
improvement, not an accident of the refactor.

Only ordinary board movement ticks. Dungeon fights, plaza idling, and
teleport/recall spells that relocate without walking a path do not advance any
counter — consistent with how companion recharges already behave.

### Legacy documents

Live player documents hold ISO strings in all three fields. No migration script:
the read helpers treat a non-integer value as **ready**, and the pruner drops
it, so the first action after deploy clears the stale value. The cost is that
in-flight cooldowns are forgiven once, which is negligible.

`_prune_cooldowns` **must be rewritten**, not merely left in place — it
currently filters with `v > now`, a string comparison that raises `TypeError`
when the values are integers. It becomes an integer filter that drops
non-integers.

### Client mirror

- `sync_spells.py` emits `cooldownSteps` instead of `cooldownMin`; regenerate
  `spells.generated.ts` (the copies-match pytest in `test_spells_generated.py`
  fails while they differ).
- `spells.ts`: `cooldownLeftMin()` → `cooldownLeftSteps()`, returning the stored
  integer directly — no `Date` math. `GRIMOIRE_SWAP_COOLDOWN_MIN` →
  `GRIMOIRE_SWAP_COOLDOWN_STEPS`; `grimoireSwapLeftMin()` →
  `grimoireSwapLeftSteps()`.
- `undercity-models.ts`: `spellCooldowns?: Record<string, number>`, plus
  `grimoireSwapSteps?: number` and `lastStandSteps?: number`.

Because the labels are now server-pushed integers, the client no longer shows a
countdown that drifts stale between polls.

## Gear menu display

In the Spells section of the creature/Gear tab, every spell row gains an
always-visible **cost chip** beside the existing power chip, and the cast button
shows steps remaining instead of minutes:

```
[icon]  Rot Surge     Innate   12 dmg   [walk] 6      [ Cast ]
[icon]  Spore Burst   Book     18 dmg   [walk] 6      [ 3 steps ]
```

The chip uses the Material `directions_walk` icon (never an emoji — icons carry
the symbol language) and shows the **haste-adjusted** number, so a squirrel sees
its own real cost rather than the table default.

The same label change applies to the board tab's spell list, and the Library
swap pill reads "swap in 4 steps".

## Testing

Existing sites moving to integer semantics: roughly 15 assertions across
`tests/test_undercity_spells.py` and `tests/test_undercity_perks.py` (which
sets `lastStandReadyAt` to far-future/past ISO strings).

New coverage:

- a cast stores an integer step count, haste applies `ceil`
- walking N spaces decrements by N; a spell is castable at exactly 0
- a counter at 0 is pruned from the document
- a legacy ISO-string value reads as ready and is dropped
- grimoire swap is step-gated; Last Stand is step-gated and re-arms after 12
- the distance fallback ticks when the client omits `path`

Run with `cd infrastructure/lambda && python -m pytest tests -q`. Frontend
verification is `npm run build` (the repo's lint is unreliable).

## Documentation to update

`specs/undercity-spells.md` states the real-time model in its player rules
(§Cooldowns, "15–60 min", "keep ticking while your phone is down"), references
`cooldownLeftMin()` in its file map, and its add-a-spell checklist names
`cooldownMin`. All must be updated in the same change so the living reference
does not contradict the code.

## Accepted consequences

- **Last Stand at 12 steps is a buff in wall-clock terms** (~80 min of walking
  vs. 60 min of idling) but a nerf in burst terms: a player with banked rolls
  can re-arm it within one session, which the clock forbade. This is the
  intended shape of the conversion.
- **A long fight cannot be waited out.** Spells recharge only while walking, so
  a player enters a boss or dungeon encounter with whatever is currently up.
  This is the point of the change rather than a side effect.

## Out of scope

- `PET_INCUBATE_MINUTES` — the egg timer the user explicitly asked to keep on a
  clock.
- `PET_ABILITY_COOLDOWN_MIN['scout']` — the last unconverted companion timer.
- Wall-clock timers that are correctly wall-clock: roll regen, shop restock,
  enraged dwell, lair respawn, poke/high-five anti-spam, post-death shield.
