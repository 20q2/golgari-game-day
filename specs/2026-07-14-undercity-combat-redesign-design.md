# The Undercity — Combat Redesign (Stance Mind-Game)

**Date:** 2026-07-14
**Status:** Design approved; ready for implementation planning
**Scope:** PvE combat only. PvP is deliberately shelved (see §7).

## Problem

Combat "gets the job done" but its three player-facing levers are flat and
uninteresting:

- **Stances** (`fight`/`defend`/`flee`) are a stat dial, not a decision.
  `defend` is just ×1.4 DEF / ×0.75 damage; `flee` is a SPD roll. You fight if
  ahead, flee if behind — there is never a reason to *think*.
- **Gear** is pure flat stat sticks (`+2 DEF`, `+4 ATK`…), one item per slot per
  tier, so the only "choice" is "buy the best tier you can afford."
- **States/buffs** are all `±N to one stat for next battle` — interchangeable,
  forgettable, no interaction.

Everything collapses to "bigger stat total wins." Battles resolve server-side in
one shot (`resolve_battle` in `undercity_engine.py`); the client just animates
the strike log via `battle-playback.component`.

## Goal

Make combat a **per-round stance mind-game** where reading and baiting the
opponent is the skill, stats set the *magnitude* of each exchange, and gear +
species + buffs combine into **recognizable build archetypes**. The guiding
rule: **when you pick up a piece of gear or evolve a form, you should
immediately see a build it enables.** If a rider or passive doesn't spark that,
it gets cut or reworked.

## §1 — Core resolution: the stance triangle

Each round both combatants pick one of three stances. The triangle decides who
**wins the exchange**; ATK/DEF/SPD/gear decide **how much it matters**.

| Matchup | Winner | Effect |
|---|---|---|
| **Aggress vs Feint** | Aggress | Feinter caught mid-trick: takes amplified hit, deals nothing back |
| **Feint vs Guard** | Feint | Bait works: break the guard for bonus damage, no counter |
| **Guard vs Aggress** | Guard | Turtle punishes: attacker's damage gutted, defender counters |
| **A vs A** | clash | Both strike full; SPD decides who lands first (matters for a kill) |
| **G vs G** | stall | Almost nothing lands; chip only |
| **F vs F** | whiff | Feints cancel; nothing lands |

**Damage still comes from stats.** "Amplified hit" = the existing
`ATK vs effective-DEF` math × a stance multiplier. A stronger creature that
*loses* the read still chips; a weaker creature that *wins* reads can topple a
stronger one but must win most exchanges to do it. Reads **and** stats matter.

### Round flow (PvE)

1. The monster's intent for the round is **telegraphed** (a "tell" — *coils to
   lunge* → Aggress). At higher tiers / bosses there is a **bluff chance** the
   shown intent is false.
2. The player picks a stance (tap one of three).
3. Resolve simultaneously; apply damage, DoTs, riders, passives; check HP.
4. Repeat up to a round cap (~6). If nobody drops, higher **HP%** wins the
   timeout.

### Flee

Flee stops being a stance. It becomes a separate **"attempt escape" action**
available any round, using the existing SPD-based `flee_chance`. Bailing a bad
fight is its own decision, orthogonal to the triangle.

### Monster AI: telegraph + personality

Each monster archetype carries **stance weights**:

- **Brute** — mostly Aggress
- **Turtle** — mostly Guard
- **Trickster** — mostly Feint

The chosen stance is what the monster telegraphs — truthfully, minus a
**bluff chance** where the shown intent is a random different stance. Weak
monsters are readable and easy *on purpose*; difficulty scales with **bluff
rate** and **raw stats**. Bosses turn both dials up: a high-punish, high-bluff
boss is exactly where the "reader" build (§4) earns its keep — information is
worth most when a wrong guess is expensive.

## §2 — Gear: three slots, one per triangle point

A third gear slot (**charm**) is added so each slot owns one point of the
triangle. Each piece keeps a **modest** stat (tiers still progress) and carries
**one stance rider** that defines a playstyle. The real decision appears when a
slot offers **more than one rider option at a tier** — you pick the rider that
fits how you want to fight, not the bigger number.

**Fang — Aggress riders**
- **Barbed** — your Aggress applies rot DoT *even on a clash or loss* (always get chip in)
- **Deep-biter** — winning exchanges hit harder, nothing on a loss (high-variance, read-dependent)

**Carapace — Guard riders**
- **Spiked** — your Guard counter reflects a chunk of the blocked hit
- **Thick** — your Guard chips even in a G-vs-G stall and softens being wrong (attrition)

**Charm (new slot) — Feint riders**
- **Trickster's Charm** — a *lost* Feint isn't fully punished (safety net)
- **Serrated Charm** — your Feint break also lowers the enemy's next-round damage (tempo)
- **Glint Charm** — winning a Feint reveals the enemy's *true* next intent, bluff or not (reads compound)

A loadout becomes a playstyle statement across all three axes, e.g.
Deep-biter + Thick + Glint = "read-heavy aggressor with a turtle fallback and
intel," vs Barbed + Spiked + Trickster = "chip-and-punish attrition."

**Slot mechanics:** charm joins fang/carapace with the same buy/equip/sell-back
flow (`GEAR_SELL_BACK`) and tiered progression. Charms lean light on raw stats
(a little SPD or HP) since their value is the rider. Shop/loot tables and the
creature/gear UI gain the charm slot. Keep ~2–3 rider options spread across
tiers rather than exploding the shop; exact counts are a balance detail.

## §3 — Build archetypes & synergy (organizing principle)

Gear riders, species passives, and spell-buffs are **ingredients** that combine
into archetypes. Two axes cut across everything: **one big hit vs many small
hits**, and **raw strike vs DoT attrition**.

| Archetype | Subtype | Rough recipe (species + gear + buff) |
|---|---|---|
| **Tank** | *Thorns* | Spiked carapace + `scavenge` + `harden_shell` (Guard heals) → hurts to attack into |
| | *Juggernaut* | Thick carapace + `regrowth`/high HP + Barbed fang → unkillable, inevitable rot chip |
| **Glass cannon** | *Burst* | Deep-biter + `first_bite`/`rot_breath` + high SPD → one devastating winning hit |
| | *Flurry* | `swarm` + `venom_barb` + many small hits → death by a thousand cuts |
| **Feint duelist** | *Reader* | Glint charm + reveal consumables + `vexing` → win exchanges on information |
| | *Tempo* | Serrated charm + `weaken_hex` → grind the enemy's damage down |
| **DoT / attrition** | — | Barbed fang + `rot_surge` (Aggress DoT) + `drain_life` → stack rot, heal off it, outlast |

The classic archetypes each have a viable success path (tanky, glass cannon,
feint/counter), plus subtypes within them.

## §4 — Consumables & spell-buffs

- **Consumables = universal mid-fight mind-game tools** (not archetype-bound;
  the shared tactical layer that creates clutch moments):
  - **Reveal** — show the enemy's true intent this round (defeats a bluff)
  - **Auto-win** — win one exchange regardless of choices
  - **Negate** — cancel the punish from one wrong guess
  - **Double-punish** — double your damage if you win this round

  Existing board consumables (`loaded_die`, `snare`) stay board utilities;
  `smoke_spore` continues to back guaranteed escape; `healing_moss` becomes
  usable mid-fight. New combat consumables are added for the tools above.

- **Spell-buffs = archetype reinforcers** (cast pre-fight, last the battle;
  shift *how a stance behaves* rather than adding flat stats):
  - `rot_surge` → your Aggress applies rot DoT (DoT build)
  - `harden_shell` → your Guard also heals (thorns tank)
  - `glowveil` → your winning Feint reveals next intent (reader)
  - enemy-debuff spells (`bone_chill`, `weaken_hex`) reduce the enemy's exchange
    magnitude (tempo)

## §5 — Remapping existing creature passives

"On strike" becomes "on winning an exchange"; "when struck" becomes "when you
lose an exchange." No form needs redesigning.

| Passive | Today | In the triangle | Feeds |
|---|---|---|---|
| `first_bite` | strikes first round 1 | wins order in an A-vs-A clash | Burst |
| `rot_breath` | round-1 hit ×2 | first **winning** exchange deals double | Burst |
| `venom_barb` | first strike +3 | first winning exchange +bonus | Flurry/Burst |
| `swarm` | +1 strike/round | extra chip each round regardless of stance | Flurry |
| `scavenge` | retaliate 2 when struck | retaliate when you **lose** an exchange | Thorns tank |
| `deathtouch_stomp` | ignore 3 DEF | Aggress pierces some Guard mitigation | Anti-tank aggro |
| `drain_life` | heal 50% dmg dealt | unchanged — heals off any damage incl. rot | DoT sustain |
| `vexing` | 25% enemy miss | 25% chance to dodge an exchange **loss** | Reader/evasion |
| `regrowth`/`rootwall` | post-battle heal | unchanged | Tank |

**Economy/board passives — untouched:** `scrounger`, `doubling_rot`, `drift`,
`dredge`, `undying`. `deathrite` (PvP spore steal) goes dormant in PvE — it
simply doesn't fire; no removal.

The archetype recipes hold with creatures **already in the game**: the Kraul
line (`first_bite`→`venom_barb`→`rot_breath`) is a natural burst/flurry cannon,
the Saproling line (`regrowth`→`rootwall`/`scavenge`) a natural tank, and Izoni's
`swarm` anchors flurry. No re-tuning of which form gets which passive is
required for v1 — only the remap of *how* each fires.

## §6 — Architecture & engineering surface

- **`undercity_engine.py`** — `resolve_battle` moves from a fully autonomous
  loop to a **round-driven state machine**: given both stances for a round, it
  resolves one exchange and returns updated combat state + a telegraph for the
  next round. PvE battles become a sequence of `POST /game/action` round
  submissions (client sends the chosen stance; server returns the exchange
  result + next telegraph). The pure exchange-resolution function stays
  deterministic under an injected `rng` and unit-testable.
- **Combat state** persists between rounds (HP, active DoTs, one-shot consumable
  effects, rider flags, the monster's committed-but-hidden next stance) on the
  player/battle document via `undercity_db.py`.
- **`undercity_data.py`** — add the `charm` gear slot + rider tags on gear;
  add combat consumables; extend monster definitions with **archetype stance
  weights** and **bluff rate**; retag spell-buffs as stance-modifiers. Mirror
  any tuned numbers into the `src/app/undercity/data/*.ts` display copies.
- **Client** — `battle-playback.component` gains an **interactive round loop**:
  show telegraph, present three stance buttons (+ flee, + usable consumables),
  submit, animate the exchange, repeat. Add the charm slot to the creature/gear
  UI.
- **Tests** — extend the pytest suite (`tests/test_undercity_engine.py`,
  `test_undercity_spells.py`): triangle outcome matrix, rider effects, passive
  remaps, telegraph/bluff behavior, flee-as-action, timeout resolution. Keep the
  suite green.
- **Balance pass (explicit work, not hand-waved):** the triangle makes damage
  swingier than the current slugfest, so monster HP/stat tables and stance
  multipliers need retuning so fights land in a satisfying round range and each
  archetype has a real success path.

## §7 — Out of scope (this iteration)

- **PvP.** Shelved until the single-player fight loop is proven fun. The
  round-driven resolver must still produce a sane result for the existing PvP
  path (e.g. fall back to an auto/committed policy so PvP battles don't break),
  but PvP is **not** a design target here. `deathrite` and `pvp_spore_steal`
  stay in place, dormant.
- Revenge buffs, achievements, seal-milestone hats (already deferred, GDD §14).

## Open balance questions (for the plan / tuning, not blockers)

- Exact stance multipliers for win/clash/stall/whiff exchanges.
- Round cap (keep 6 vs shorten for phone pacing).
- Bluff-rate curve across monster tiers and bosses.
- Number of rider options per slot per tier.
- Costs/rarity of the new combat consumables.
