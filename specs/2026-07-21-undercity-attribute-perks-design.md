# Undercity Attribute Perk Tracks + Guard/DEF Fix — Design

**Date:** 2026-07-21
**Status:** Approved (brainstorm) — pending spec review
**Related:** balance findings in `infrastructure/lambda/sim/FINDINGS.md`;
combat model in [specs/undercity-combat.md](undercity-combat.md); stat scaling in
`2026-07-19-undercity-stance-stat-scaling-design.md`.

## Motivation

The balance simulator showed raw attributes only feed combat, and combat
overwhelmingly rewards ATK+Aggress: a pure-DEF creature *aggressing* out-damages
a pure-ATK creature *guarding* (256 vs 129 to the boss), because Guard's payoff
is conditional on the enemy aggressing — and trickster enemies don't. So DEF and
SPD are dead investments; every build funnels into ATK.

This design fixes that two ways at once:

1. **Attribute perk tracks** — crossing 5 / 10 / 15 in an attribute unlocks a
   perk, giving DEF and SPD identities that live *outside* the damage race
   (survival, traversal, tempo). Pairs with keep-and-swap gear: gear is the
   swappable tactical layer, the perk track is the creature's permanent identity.
2. **Guard/DEF combat fix** — make DEF pay out in a fight every round regardless
   of the stance triangle, so investing in DEF visibly reduces damage taken and
   chips the enemy back no matter what they telegraph.

## Part 1 — Perk tracks

### Threshold mechanic

- A perk unlocks when the creature's **invested** attribute reaches the
  threshold. "Invested" = the base doc stat (`doc['atk']` / `['def']` /
  `['spd']`), which is species base + level-up spends + evolution bonuses.
  **Gear and temporary buffs are excluded** — they change effective stats, never
  perk state, so swapping gear never lights or dims a perk.
- Nodes at **5 / 10 / 15**. Unlock is `doc[stat] >= threshold` — monotonic and
  stateless, so it derives from the save with no migration and no new currency.
- **Base stats light the tier-1 node.** A kraul (atk 8) hatches with *Rend*; a
  saproling (def 7) hatches with *Thick Hide*. This is intended — it reinforces
  species fantasy. (If we later want nodes to always feel *earned*, the only
  change is bumping thresholds to 8/13/18; the mechanic is unchanged.)

### The tracks

| Node | ⚔️ ATK · Aggression | 🛡️ DEF · Endurance | 💨 SPD · Tempo |
|---|---|---|---|
| **5** | **Rend** — a winning Aggress exchange always applies 1 rot stack | **Thick Hide** — halve HP lost to hazards & bad mystery-roll events | **Fleetfoot** — *optional* reroll of a die showing 1 (player may keep the 1) |
| **10** | **Menace** — enemies bluff you less often (their telegraph is true more often) | **Carapace Grind** — while you hold Guard, deal a DEF-scaled chip each round even when you don't win the exchange *(this is the Guard/DEF fix — see Part 2)* | **Pathfinder** — roll with advantage: roll two dice, keep either |
| **15** | **Deathdrive** — while *you* are below 50% HP, your Aggress swings gain bonus damage | **Last Stand** — survive one otherwise-lethal blow per descent at 1 HP | **Blink** — once per turn, choose your die value |

Design intent per track:

- **ATK perks are lateral, not power-inflating** — ATK already wins, so its perks
  add *reliability* and *fantasy*, not more front-loaded damage. Deliberately
  clear of the "enemy-is-low → +damage" lane, which **Gutcleaver** (gear rider)
  owns. *Menace* directly counters the trickster problem the sim flagged;
  *Deathdrive* keys off the player's OWN low HP (berserker comeback) — the
  opposite axis from Gutcleaver.
- **DEF perks are survival** — out-of-combat (*Thick Hide*), pre-combat
  (*Entrench*), and a clutch capstone (*Last Stand*). Combined with the Part-2
  fix, DEF finally justifies itself both offensively and defensively.
- **SPD perks are tempo/traversal** — dice control (the requested "advantage" and
  "pick your value") plus the optional reroll. SPD keeps its existing combat role
  (Feint scaling + read/flee) unchanged.

### Perk → engine hook

| Perk | Hooks into | Effect |
|---|---|---|
| Rend | `resolve_round` (engine) | on a won Aggress, add a rot stack to the foe (reuses existing `rot_stacks`) |
| Menace | `_telegraph_next` (db) | multiply the NPC's effective `bluff` by a `<1` factor |
| Deathdrive | `_swing_base` / `resolve_round` (engine) | when `striker.hp < 0.5*max_hp` and stance == aggress, add a bonus term |
| Thick Hide | `_hazard` / `_dungeon_hazard` / `roll_mystery` application (db + engine) | halve applied negative `hpPct` / HP-loss |
| Carapace Grind | `resolve_round` (engine) | end-of-round: if the creature held Guard and did not win the exchange, deal `round(_swing_base(self,'guard') * ramp * GUARD_CHIP_COEFF)` to the foe. **Gated on the perk (attribute-derived), so only creatures carry it — NPCs never do.** |
| Last Stand | `_finish_battle` / `_compost` (db) | if a blow would drop the player to ≤0 and the once-per-descent flag is unused, set hp=1 and consume the flag; reset flag on surfacing (same trigger as `restsUsed`) |
| Fleetfoot | `_roll` (db) | if rolled value == 1, offer an optional reroll (client-driven; player may decline) |
| Pathfinder | `_roll` (db) | roll two values, return both; the move picker chooses which to use |
| Blink | `_roll` (db) | allow the client to name the die value (gated on the SPD-15 perk, not on `DEBUG`) |

New helper: `engine.attribute_perks(doc) -> frozenset[str]` derives the unlocked
set from `doc['atk'/'def'/'spd']`. Combat perks feed into the `Combatant`
(alongside `passives`/`riders`) so `resolve_round` sees them; roll/traversal
perks are read in `_roll`; hazard/mystery perks in their handlers.

### Save compatibility

No migration. Perks are derived, not stored. New transient fields (`battle`
shield value, a `lastStandUsed`-style per-descent flag) default to absent/false
on existing docs.

## Part 2 — Guard/DEF combat fix (delivered as the DEF perk **Carapace Grind**)

**Problem (from sim):** Guard's big swing only lands on Guard-beats-Aggress; vs
trickster/feint enemies Guard mostly stalls, so DEF never converts to offense. A
pure-DEF/Guard build cannot damage the boss meaningfully (142 dmg, 0% win).

**Prototype outcome (`sim/proto_fix.py`).** Two levers were tested and one route
chosen:

- ❌ **Per-round DEF mitigation — rejected.** Applied symmetrically it also buffs
  every *enemy's* effective DEF, so it *lowered* ATK/SPD damage against the boss
  (pure-ATK 359→344). Blunt and off-target.
- ❌ **Base-stance Guard chip (universal rule) — rejected.** Effective, but as a
  rule both sides get it: it over-buffs turtle enemies and dampens the player's
  own Feint/SPD builds via enemy Guard chip (pure-SPD/Feint 240→166), and chipping
  on a Guard-loses-to-Feint bleeds the Feint>Guard triangle.
- ✅ **Guard chip as a player-only DEF perk — chosen.** Because NPCs have no
  attribute perks, only creatures get the chip → **zero collateral**. Measured at
  `GUARD_CHIP_COEFF = 0.5`:

  | build/stance | shipped boss dmg / win | with Carapace Grind |
  |---|---|---|
  | pure-DEF / Guard | 142 / **0%** | **330 / 11%** (viable ~2-attempt path) |
  | pure-ATK / Aggress | 359 / 62% | 361 / 62% (**unchanged**) |
  | pure-SPD / Feint | 240 / 26% | 244 / 26% (**unchanged**) |
  | all normal/wilderness content | ~100% | ~100% (**unchanged**) |

**Decision:** no base combat-maths change. The fix is the DEF-10 perk *Carapace
Grind* (see the perk table). One tunable in `undercity_config.py`:

- `GUARD_CHIP_COEFF` — coefficient on the Guard swing base for the chip.
  **Prototype value ≈ 0.5** (DEF/Guard becomes co-equal with ATK/Aggress, not
  dominant; 0.7 makes it a stronger single-attempt path, 1.0 overshoots at 90%).

Because the chip is `_swing_base(self,'guard')`-based, it scales naturally with
invested DEF — a splash-DEF build gets a small grind, a dedicated tank a large
one. The existing `STANCE_*` constants are untouched, so the ATK balance the sim
measured is preserved by construction.

## Client

- **Attribute track UI** in the creature panel (`src/app/undercity/`): three
  short tracks (ATK/DEF/SPD) showing the 5/10/15 nodes, which are lit, current
  value, and next node. Reads perk defs from a new
  `src/app/undercity/data/perks.ts` mirror.
- **Roll UX** for SPD perks: Pathfinder shows two dice with a pick; Blink shows a
  value picker (reuses the loaded-die UI pattern); Fleetfoot shows an optional
  "reroll the 1?" prompt.
- Perk display strings mirror the server (blurbs), same pattern as gear/spells
  mirrors noted in CLAUDE.md.

## Server ⇄ client mirror points

Per CLAUDE.md: scalar tunables (`GUARD_CHIP_COEFF`, Deathdrive bonus, Menace
factor, Thick-Hide fraction) live in `undercity_config.py`; perk definitions live in
`undercity_data.py` (or a new `undercity_perks.py`) and are mirrored in
`src/app/undercity/data/perks.ts`. `handle_state`'s `you` view should surface the
unlocked perk set so the client renders without recomputing rules.

## Testing & validation

- **Sim (done):** `sim/proto_fix.py` validated the Guard/DEF fix as a player-only
  DEF perk at `GUARD_CHIP_COEFF ≈ 0.5` — DEF/Guard becomes a viable boss path
  (142→330 dmg) with ATK/SPD and normal content unchanged. Re-run after wiring
  the real perk to confirm parity with the prototype.
- **pytest:** unit tests for `attribute_perks` thresholds (incl. base-stat
  lighting), each perk's engine hook (Rend rot, Menace bluff, Deathdrive bonus,
  Thick Hide halving, Carapace Grind chip present for creatures / absent for NPCs,
  Last Stand survival). Keep the suite green.

## Scope guards / deferred

- Single-player PvE balance only; PvP interactions with new perks are out of
  scope (PvP shelved).
- No perk respec/refund system — perks track the stat you invested; that's the
  commitment. Revisit only if playtest asks for it.
- Thresholds fixed at 5/10/15 (base lights tier-1) unless playtest says otherwise.
