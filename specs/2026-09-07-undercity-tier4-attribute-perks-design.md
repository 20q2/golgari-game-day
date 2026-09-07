# Undercity Tier-4 Attribute Perks (the 24 nodes) — Design

**Date:** 2026-09-07
**Status:** Approved (brainstorm) — pending spec review
**Related:** [2026-07-21-undercity-attribute-perks-design.md](2026-07-21-undercity-attribute-perks-design.md)
(the original 6/12/18 tracks), combat model in
[undercity-combat.md](undercity-combat.md), boss trial in
[2026-08-11-undercity-queens-awakening-design.md](2026-08-11-undercity-queens-awakening-design.md).

## Motivation

The attribute tracks top out at 18, which a specialist reaches comfortably before
the level cap. Past that node, further investment in a stat buys only the raw
scaling — there is nothing left to *unlock*, so the last stretch of a mono build's
progression is the flattest part of it.

A fourth node at **24** gives that stretch a destination. 24 is the first
threshold a split build genuinely cannot reach, so it is the right place to put
the loudest, most build-defining effects in the game: the reward for having given
up the other two attributes entirely.

## The gate

24 on one stat = species base (5-6) + evolution bonuses (2-6) + equipped gear
(2-8) + very nearly every lifetime stat point. With `LEVEL_CAP = 12` and
`STAT_POINTS_PER_LEVEL = 2` there are 22 lifetime points, so:

- a hard mono build reaches 24 around **L8-12**, depending on gear rarity;
- a build split across two stats **cannot reach it at all**.

Unlock is the existing derived, stateless rule — `engine.perk_stat` (invested base
+ equipped gear, temporary buffs still excluded), `doc[stat] >= 24`. No migration,
no new currency, no stored state. Gear can bridge a creature over the line, and
swapping that gear out dims the perk, exactly as at the lower nodes.

## Design stance

Tier 4 is a **pure capstone spike**: each node amplifies what its track already
does rather than handing the track a new identity. Two consequences were chosen
deliberately:

- **Mono-ATK and mono-DEF become the boss builds.** Shellsplitter and Grindstone
  are tuned to move the solo-Savra math. Specialisation gets a real trophy, and
  the fight stays hard for everyone who spread their points. This is consistent
  with "equal turns, wealth gaps are legitimate" — the lead comes from a
  committed build, not from a catch-up mechanic.
- **Mono-SPD instead owns the board.** Feint is deliberately the weakest swing
  (`FEINT_SIG_WEIGHT` 0.6 against Guard's 1.0 and Aggress's 1.5 double-dip), so
  buying SPD a combat capstone would have meant fighting the stance model. SPD's
  tier-4 is a tempo and reach trophy instead. Three tracks, three win conditions.

## The nodes

| Track | 6 | 12 | 18 | **24** |
|---|---|---|---|---|
| ATK | Brutal Strikes | Menace | Deathdrive | **Shellsplitter** |
| DEF | Thick Hide | Carapace Grind | Last Stand | **Grindstone** |
| SPD | Fleetfoot | Pathfinder | Blink | **Longstride** |

### ATK-24 — Shellsplitter

> Every exchange you win cracks the foe's armour open.

Each exchange the holder **wins** strips `SHELLSPLITTER_STRIP = 2` from the foe's
effective DEF for the rest of the fight, accumulating. Floored at 0 by the
existing `max(0, target.dfn - pierce)` in `_base_hit`, so a full strip is its own
cap and reads as the foe's carapace being in pieces.

**Any won exchange counts, regardless of stance.** Simpler to explain, and it does
not punish a mono-ATK player for holding Guard a round to survive.

DEF is *proportional* mitigation (`mit = min(MITIGATION_CAP, def/(def+MITIGATION_K))`,
K = 10, cap = 0.75), so stripping it is multiplicative on damage. Against Savra
(DEF 12, 54.5% mitigation):

| wins | her DEF | her mitigation | your damage |
|---|---|---|---|
| 0 | 12 | 54.5% | — |
| 1 | 10 | 50.0% | +10% |
| 2 | 8 | 44.4% | +22% |
| 3 | 6 | 37.5% | +37% |
| 4 | 4 | 28.6% | +57% |
| 5 | 2 | 16.7% | +83% |
| 6 | 0 | 0% | **+120%** |

Six wins lands around round 10-12 of a boss fight (hard cap 24 rounds), so the
big number is earned rather than granted. Against a DEF-5 trash mob it maxes in
two wins and is worth far less in absolute terms — the perk **scales with the
foe's armour and the fight's length**, which is precisely the shape of a boss
trophy and precisely not the shape of a trash-clearing tool.

### DEF-24 — Grindstone

> +25 Max HP. Guard grinds the foe down every single round.

Two effects:

1. `GRINDSTONE_MAXHP = 25` bonus Max HP, continuing the DEF track's stacking-HP
   tradition. Cumulative across the track becomes +5 / +15 / +30 / **+55**.
2. Carapace Grind's chip now fires **every round, including the rounds the holder
   wins the exchange**, at `GRINDSTONE_CHIP_COEFF = 0.8` in place of
   `GUARD_CHIP_COEFF = 0.5`.

The turtle's problem against a 560 HP boss was never dying, it was dealing
damage. At DEF 24 with ATK 5 the Guard swing base is `0.5×5 + 1.0×24 = 26.5`, so:

- **today:** `26.5 × 0.5 = 13.25` chip, only on rounds it does not win — roughly
  6.6/round averaged over a fight;
- **with Grindstone:** `26.5 × 0.8 = 21.2` chip every round, rising with the
  frenzy ramp to ~50.9/round by round 10.

That is roughly a **3×** increase in turtle damage output, which is the intended
size of the spike but also the least certain number in this design.
`GRINDSTONE_CHIP_COEFF` is therefore **set by the simulator**, exactly as
`GUARD_CHIP_COEFF = 0.5` was: 0.8 is the starting proposal, not the shipping
value.

### SPD-24 — Longstride

> Combine both dice — travel up to twelve spaces.

Anyone at SPD 24 also holds Pathfinder, which already rolls a second die and
offers the union of both faces' destinations. Longstride makes those two dice
**combinable**: destinations become

```
legal(v1) ∪ legal(v2) ∪ legal(v1 + v2)
```

The player may travel up to 12 spaces on a single roll — or not, since the short
destinations stay on the menu. It is never a forced overshoot.

Costs one banked roll like any other, and carries **no cooldown**. Blink is
untouched: a blink sets `random_roll = False`, so it never combines. Blink stays
the precision tool (name a value 1-6) and Longstride is the distance tool.

Three consequences, all intended:

- **It respects barriers.** `engine.legal_destinations` already honours
  `_stop_nodes` / `_blocked_nodes`, so a 12-step walk bonks on a sigil gate or a
  bridge mouth exactly as a 6-step walk does. Nothing gated gets skipped.
  Movement is exact-count with no immediate edge reversal, so on a sparse part of
  the map the summed value may have *no* legal destinations at all. That needs no
  special handling: the two single-die options remain on the menu, and the
  existing empty-`dests` refund only triggers if the whole union is empty.
- **It halves your landings.** Landing is where loot, hazards and facilities
  happen, so reaching twice as far scoops up half as many spaces per roll. That
  is the price of the perk, and the reason it stays optional.
- **It doubles step-timer recharge.** Spell cooldowns and Last Stand's
  `LAST_STAND_COOLDOWN_STEPS = 12` re-arm count *spaces walked*, so a Longstride
  build recharges its kit at twice the rate. A stealth spike, but the right one
  for a speed creature.

**Known, deliberately unchanged:** vines/snare halving applies to `value` before
Pathfinder rolls `value2`, so Pathfinder already largely shrugs off snares today.
A snared Longstride player combines a halved die with a full one. This is
pre-existing behaviour inherited as-is; fixing the snare/advantage interaction is
out of scope for this design.

## Implementation

### Server

**`undercity_config.py`** — three new scalars:

| scalar | value | note |
|---|---|---|
| `SHELLSPLITTER_STRIP` | 2 | effective DEF stripped per won exchange |
| `GRINDSTONE_MAXHP` | 25 | DEF-24 bonus Max HP |
| `GRINDSTONE_CHIP_COEFF` | 0.8 | replaces `GUARD_CHIP_COEFF` while held — **sim-set** |

**`undercity_data.py`** — a fourth tuple on each `PERK_TRACKS` entry and three
new `PERKS` definitions.

**`undercity_engine.py`**

- `Combatant` gains a fight-scoped `armor_strip: int = 0`, in the same spirit as
  `aggress_ramp`.
- `_base_hit` reads it off the striker:
  `dfn = max(0, target.dfn - pierce - striker.armor_strip)`. Taking it inside
  `_base_hit` rather than at each call site means every strike site inherits the
  strip with no call-site churn, and the existing floor keeps serving as the cap.
- `resolve_round`: when a side wins the exchange and holds `shellsplitter`, add
  `SHELLSPLITTER_STRIP` to its `armor_strip` and emit a tagged log entry so the
  player can see the armour coming off.
- The existing `carapace_grind` end-of-round block: when the holder also has
  `grindstone`, fire regardless of whether it won the exchange, and use
  `GRINDSTONE_CHIP_COEFF`.
- `effective_stats`: add `GRINDSTONE_MAXHP` while the perk holds, alongside the
  existing three DEF-track HP grants.

**`undercity_db.py`**

- `_roll`: inside the Pathfinder branch, also compute `combined = value + value2`
  and union `_legal(combined)` into `dests`; store it as `pm['combined']`.
  Deliberately a **separate field** from `pm['values']`, so Fleetfoot's
  `1 in values` check and the client's two-face display stay untouched.
- `_move`: widen `allowed` to include `pm['combined']` when present, so the
  validated walk length may be the sum.

### Client

- **`data/perks.ts`** — mirror the three new definitions; widen
  `threshold: 6 | 12 | 18` to include `24`.
- **`tabs/creature-tab.component.*`** — no template work. The perk chain is a
  generic `@for` over `trackNodes(stat)`, and the "next at N" text derives from
  `PERK_TRACKS`, so a fourth node renders automatically.
- **`tabs/board-tab.component.ts`** — the only real client change. The board
  walks node-by-node with an exact-count walker seeded from one chosen die
  (`stepping = {path, left: value}`), and Pathfinder surfaces a two-face picker:
  - `pathfinderPick()` must offer a **third option**, the combined value, when
    the holder has Longstride and `pm.combined` has legal destinations.
  - Its "nothing to choose" guard must change. Today matched faces return `null`
    (3+3 is no choice), but under Longstride 3+3 *is* a choice between moving 3
    and moving 6.
  - `chooseDie` needs no change — it seeds the walker with whatever value it is
    given, and the server validates the committed path against `allowed`.

### Docs

Update the "nodes at 6/12/18" statements in [CLAUDE.md](../CLAUDE.md),
[2026-07-21-undercity-attribute-perks-design.md](2026-07-21-undercity-attribute-perks-design.md)
and the `perks.ts` header comment.

While in `undercity_engine.py`, fix the stale `resolve_round` docstring claiming
`frenzy_from=None` disables the ramp for boss/lair fights. `_frenzy_from` returns
`FRENZY_START` for every battle kind, so the boss *does* escalate — a fact this
design's tuning depends on.

## Balance validation

`sim/proto_fix.py` set `GUARD_CHIP_COEFF`, but it is *not* the right tool here:
it prototypes rules by monkeypatching the engine precisely so the engine need not
be edited, and these perks ship in the engine itself. Measure the real rules
through `sim/arena.py` instead (`make_leveled_doc` + `winrate(..., kind='boss')`),
isolating each perk by subtracting it from `attribute_perks` at identical stats —
otherwise the six points of raw stat that come with reaching 24 are counted as
the perk's contribution. Measure all three archetypes against Savra to:

1. set `GRINDSTONE_CHIP_COEFF` — 0.8 is a proposal; pick the value that makes
   mono-DEF/Guard a viable boss path without overshooting mono-ATK;
2. confirm Shellsplitter's measured boss damage matches the ~+40-50% average
   fight multiplier the table above predicts;
3. confirm normal, wilderness and dungeon content stays at its current clear
   rate — these perks should feel enormous against the boss and merely nice
   against a 3-round trash fight.

The sweep's bot never enters dungeons, so it cannot speak to sigil, treasure or
XP pacing; those stay judged from measured export data.

## Tests

New cases in `tests/test_undercity_perks.py`:

- threshold derivation at 24 — base alone, base + gear bridging, gear removal
  dimming the perk, temporary buffs never lighting it;
- Shellsplitter: strip accumulates per won exchange, applies to damage through
  `_base_hit`, floors at 0 DEF, and does not leak between fights;
- Grindstone: chip fires on a won round (the behaviour Carapace Grind alone does
  not have), uses the raised coefficient, and the Max HP grant stacks with the
  three lower DEF nodes;
- Longstride: `dests` includes the combined-value destinations, `pm['combined']`
  is stored separately from `pm['values']`, `_move` accepts a summed-length path
  and still rejects an illegal one, and a walk of the summed length still stops
  at barriers.

## Save compatibility

None required. Perks remain derived from attributes, `armor_strip` is
fight-scoped transient state on the `Combatant`, and `pm['combined']` is absent
on existing pending moves, where the client's current behaviour is unchanged.
