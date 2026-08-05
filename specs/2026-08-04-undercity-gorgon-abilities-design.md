# Undercity: Gorgon Abilities — "The Petrifiers"

**Date:** 2026-08-04
**Status:** Implemented. **Phase 3 superseded 2026-08-05 — see banner.**

> **Superseded in part (2026-08-05):** Phase 3's tier-3 wildcard gear slot is
> **no longer a Gorgon feature.** It was reassigned to be the **Daemogoth Titan's**
> signature (the Elf apex added in the elf-tier2 rework): gated on the `arsenal`
> passive — which only the Daemogoth ever holds, so **no other creature, not even
> another Elf apex, gets a 4th slot** — and the wildcard piece **counts once** (no
> doubling). Phases 1–2 below (Petrify/Stone Gaze, Brittle/Shatter) remain current.
> See [2026-08-04-undercity-elf-tier2-rework-design.md](2026-08-04-undercity-elf-tier2-rework-design.md).

## Goal

Give the Gorgon line a **signature combat identity**. Today her `stonewright`
passive is pure economy (Gear+ / pet bonus, no combat hook) and her two tier-2
forms **recycle** existing passives (`vexing`, `spikeshell`), so she has no
combat identity of her own and her forms play like other creatures. This design
adds a **stone/petrify** combat theme expressed as **two distinct archetypes**
across her tier-2 forms, plus a **tier-3 wildcard gear slot** capstone.

Builds on [specs/2026-08-04-undercity-gorgon-species-design.md](2026-08-04-undercity-gorgon-species-design.md)
(the species, already implemented). Combat model reference:
[specs/undercity-combat.md](undercity-combat.md).

## Design decisions (from brainstorming)

1. **Posture:** petrify/stone abilities are **control-flavored, not damage** —
   her raw power ceiling comes from *gear mastery* (Gear+ and the new wildcard
   slot), not from stacking strong combat passives. Keeps her honest against the
   no-power-creep bar.
2. **Base Gorgon stays economy-only.** No combat passive at tier 1 — her early
   combat comes from the +5 banked stats. The combat identity **emerges on
   evolution**, fitting "she changes slowly; her power is in her works."
3. **The two tier-2 forms must play as different archetypes**, not one effect
   with two proc conditions. Medusa owns petrify (the gaze); Basalt gets a
   different win condition entirely.
4. **Thematic inversion:** Medusa turns foes *to* stone (**Petrify**); Basalt
   *cracks* stone (**Shatter**). One stone line, opposite mechanics + playstyles.
5. **Tier-3 payoff is a wildcard gear slot**, gated on the `stonewright` passive
   (not the shared apex form), holding **any one** gear piece incl. duplicates.

## Two new combat effects

Both are **enemy debuffs** carried on the enemy `Combatant`, snapshotted through
the battle record like `aggress_ramp`/`feint_won` (`undercity_db._bt_snapshot`),
applied in `engine.resolve_round`, and **cleared between fights**. Both are stack
counters. Scalars live in `undercity_config.py`.

### Petrify (Medusa's effect — slow → freeze)
- **Each stack:** the enemy's effective **SPD is reduced by `PETRIFY_SLOW`**
  (proposed **2**), floored at 1 — the same debuff shape as `sap_vigor`. SPD is
  the tempo/read stat, so a slowed enemy loses clashes and swings a weaker Feint.
- **At `PETRIFY_FREEZE_AT` stacks (proposed 4):** the enemy is **Petrified** — it
  **skips its next round**: deals no damage and the Gorgon strikes free. Reuse the
  existing one-round `force_winner='attacker'` modifier path on `resolve_round`
  (the same lever combat consumables use). Then **reset stacks to 0**.
- The freeze is gated behind 4 procs so it is *earned*, not spammed.

### Brittle (Basalt's effect — damage amplification)
- **Each stack:** the enemy takes **+`BRITTLE_AMP` damage from the Gorgon's hits**
  (proposed **+15%**), applied as a multiplier on hits *against the brittle target*
  in `engine._base_hit`/`resolve_round` (comparable to how `gutcleaver` conditions
  a +50% hit). Cap at `BRITTLE_MAX` stacks (proposed **3** → +45%).
- Brittle only amplifies **the Gorgon's own** outgoing damage (it is not a general
  vulnerability), keeping it self-contained.

*(Implementation note: Brittle may alternatively be modelled as `pierce`
— reducing the enemy's effective DEF, which `resolve_round` already applies before
mitigation. The plan picks one; the observable "brittle takes more damage" is the
contract.)*

## Form abilities

### Base Gorgon — unchanged
`stonewright` (economy) only. No `resolve_round` hook. Documented here so the plan
does **not** add a base combat passive.

### Medusa Stalker — "Stone Gaze" (the Controller)
*SPD skirmisher / reader.* **Replaces the recycled `vexing`.**
- **Elevated read-rate:** contributes a reader bonus to `_read_chance` (same
  channel as the `vexing`/`first_bite` `READ_PASSIVE_BONUS`), so she reliably sees
  enemy intent.
- **Petrify on read:** on any round the telegraph **read lands** (true intent
  shown), apply **+1 Petrify stack** to the enemy. Because read success is
  determined in the `combat-round` handler (`undercity_db`, via `_telegraph_next`/
  `rec['readChance']`), the stack application is wired there — this read→effect
  coupling is the **main new mechanic** (reads are pure information today).
- **Play:** an active read-race to lock the enemy down (tempo denial). Wants
  read-rate (SPD, Seer/Glint charms) — which the wildcard slot can double down on.

### Basalt Matron — "Shatter" (the Juggernaut-Crusher)
*ATK bruiser, low SPD.* **Replaces the recycled `spikeshell`.**
- **Shatter:** when she wins a **decisive Aggress** exchange (Aggress beats
  Feint), apply **+1 Brittle stack** to the enemy. A `winr.has('shatter')` branch
  in `resolve_round`.
- **Stat tweak:** change her tier-2 `bonus` from `{maxHp: 6, def: 2}` →
  **`{atk: 2, maxHp: 4}`** (a durable bruiser that hits harder and stays slow), so
  the ATK-crusher archetype reads. Update both backend (`undercity_data.TIER2`) and
  the client mirror (`forms.ts`).
- **Play:** commit to Aggress, crack the enemy open, snowball big hits. Her low
  SPD loses clashes (SPD lands first in A-v-A) — that is the counterplay.

### Tier-3 — wildcard gear slot (capstone)
- **Gating:** `'stonewright' in _passives(doc)` **and** `tier == 3`. Gates on the
  passive (persists through evolution) + tier, **not** the apex form id — so all
  four shared apexes a Gorgon can reach grant it, and non-Gorgons who reach the
  same apexes do **not**.
- **Slot:** a new `doc['gear']['wild']` key holding **any one** fang / carapace /
  charm, **duplicates allowed** (second fang, second charm, etc.).
- **Auto-contribution:** `engine.effective_stats` and `engine.perk_stat` already
  iterate `(player['gear']).values()`, so a `wild` piece **auto-sums into stats and
  auto-counts toward attribute perks** with no change to those functions.
- **Work:** the equip flow (`_equip_gear`) must accept a `wild` target (with the
  usual displaced-piece swap) and **reject it unless the player is a tier-3
  Gorgon**; the client renders a 4th slot and lets the equip modal target it.

## Config scalars (`undercity_config.py`)

```
PETRIFY_SLOW = 2          # -SPD per Petrify stack
PETRIFY_FREEZE_AT = 4     # stacks to trigger a one-round freeze (then reset)
BRITTLE_AMP = 0.15        # +damage the Gorgon deals per Brittle stack
BRITTLE_MAX = 3           # Brittle stack cap
```

Client display mirrors for the two status chips live in `combat.ts`
(`STATUS_INFO['petrify']`, `STATUS_INFO['brittle']`).

## Implementation reach

**Backend (Python):**
- `undercity_config.py` — the four scalars above.
- `undercity_engine.py` — a `petrify`/`brittle` stack field on `Combatant`;
  Petrify SPD reduction + freeze (via `force_winner`) and Brittle damage-amp in
  `resolve_round`/`_base_hit`; `Combatant.has('shatter')`/`has('stone_gaze')`
  branches; Medusa's reader bonus in `_read_chance` (or its data mirror).
- `undercity_db.py` — snapshot the new stack fields in `_bt_snapshot` (+ resume);
  the **read→Petrify hook** in the `combat-round` handler where read success is
  known; the **wildcard equip** path + tier-3-Gorgon gate in `_equip_gear`.
- `undercity_data.py` — Medusa/Basalt `passive` ids → `stone_gaze` / `shatter`;
  Basalt `bonus` → `{atk: 2, maxHp: 4}`; blurbs.

**Client (TypeScript mirrors):**
- `forms.ts` — `PASSIVE_NAMES`/`PASSIVE_BLURBS` for `stone_gaze` + `shatter`;
  swap the two tier-2 forms' `passive`/`passiveName`; update Basalt `bonus`.
- `combat.ts` — `STATUS_INFO` chips for `petrify` and `brittle`.
- Gear UI — a 4th "wildcard" slot for tier-3 Gorgons + equip targeting (the
  meatiest client piece).

**Tests (`infrastructure/lambda/tests/`):**
- Petrify: read applies a stack; stacks slow SPD; 4th stack freezes then resets.
- Brittle: a decisive Aggress win applies a stack; stacks amplify the Gorgon's
  damage; cap respected.
- Wildcard: a tier-3 Gorgon can equip a `wild` piece (incl. a duplicate type);
  a non-tier-3 or non-Gorgon is rejected; the piece contributes to
  `effective_stats` and lights attribute perks.
- Keep the existing suite green (note: the branch carries pre-existing failures
  unrelated to this work).

## Phasing (for the implementation plan)

- **Phase 1 — Petrify + Stone Gaze (Medusa):** the read→stack→freeze effect and
  the reader bonus. The novel read-coupling; ship and prove it first.
- **Phase 2 — Brittle + Shatter (Basalt):** the damage-amp effect, the Aggress-win
  proc, and Basalt's stat tweak.
- **Phase 3 — Tier-3 wildcard slot:** the gear-system change (equip path + gate +
  client 4th slot).

Each phase is independently shippable and testable.

## Balance notes

- Petrify is **control, not damage**; the freeze is gated behind 4 reads and
  Medusa's read-rate is bounded by `READ_MAX`, so she cannot chain-freeze. It
  shines in long fights (tanks/bosses), near where the Collapse would end things
  anyway.
- Brittle caps at +45% and only amplifies the Gorgon's own hits; Basalt's low SPD
  (losing clashes) is the built-in counterplay to a snowball.
- The **wildcard slot is the earned power capstone.** Watch the interaction most
  likely to over-perform: a wildcard **second read-charm** (Seer/Glint) stacking
  read-rate into Petrify — tune against `READ_MAX` during the balance pass
  (`infrastructure/lambda/sim/`).

## Non-goals

- No base-form combat passive (base stays economy-only).
- No new tier-3 apex forms (apexes stay shared). *(Superseded 2026-08-05: the
  wildcard slot is no longer a Gorgon payoff — it became the Daemogoth Titan's
  Arsenal signature; see the banner at the top of this doc.)*
- No damage from Petrify (pure tempo denial) and no general vulnerability from
  Brittle (Gorgon-only amp).
- No new gear pieces or riders — abilities only. (Gear+ already exists.)

## Open questions (resolve during planning)

- Brittle as a **damage multiplier** vs **pierce (DEF reduction)** — pick during
  implementation; the observable contract is "+damage from the Gorgon."
- Exact reader-bonus magnitude for Stone Gaze (reuse the `vexing`
  `READ_PASSIVE_BONUS` value, or a dedicated one).
- Whether a Petrify freeze should also **pause the Collapse frenzy** that round or
  simply coexist with it (default: coexist — no special-casing).
