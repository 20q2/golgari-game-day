# The Undercity — Combat Reference

How interactive PvE combat works, and the fast paths for adding **enemies**,
**equipment**, and **effects**. Companion to [undercity-spells.md](undercity-spells.md).
Design origin: [2026-07-14-undercity-combat-redesign-design.md](2026-07-14-undercity-combat-redesign-design.md).

Combat is **PvE-only interactive**. PvP stays one-shot (auto stances) via the
back-compat `engine.resolve_battle`.

## 1. The model

Combat is a per-round **stance triangle**. Each round both sides pick one of
three stances (`undercity_data.STANCES = ('aggress', 'guard', 'feint')`):

| You play | Beats | Loses to |
|---|---|---|
| **Aggress** | Feint | Guard |
| **Feint**   | Guard | Aggress |
| **Guard**   | Aggress | Feint |

`engine.exchange_winner(a, d)` returns `'attacker'`/`'defender'` for a decisive
result, or `'clash'` (A-v-A), `'stall'` (G-v-G), `'whiff'` (F-v-F) for mirrors.

**Magnitude comes from stats.** A "hit" is
`max(1, round(swing * uniform(0.85,1.15) * (1 - mitigation)))` (`engine._base_hit`),
where `swing = _swing_base(striker, stance)` picks the signature stat by stance
(Aggress↔ATK at `1 + STANCE_STAT_WEIGHT`; Guard↔DEF at `GUARD_SIG_WEIGHT`; Feint↔SPD
at the *lighter* `FEINT_SIG_WEIGHT` — SPD is a tempo/read stat, not a heavy hitter),
plus `STANCE_OFFHAND_ATK_WEIGHT × atk` as the partial base on Guard/Feint. **DEF is
proportional mitigation**, not a flat subtraction: `mitigation = min(MITIGATION_CAP,
def / (def + MITIGATION_K))` (`pierce` lowers effective DEF first). So armor scales
gracefully at any level and nothing is invincible. That hit is then scaled by the
matchup multiplier:

- decisive win → `STANCE_WIN_MULT` (winner's big hit). The loser deals nothing —
  EXCEPT a caught **feint into an aggress** still pokes back for `STANCE_STALL_MULT`
  chip (you take the big hit but chip them).
- Guard beats Aggress → aggressor's hit × `STANCE_GUARD_MITIGATE`, guard counters × `STANCE_GUARD_COUNTER`
- clash (A-vs-A) → both × `STANCE_CLASH_MULT` (SPD, or `first_bite`, lands first)
- stall (G-vs-G) → **no damage** (both fully block); only a `thick` carapace chips
  through (× `STANCE_STALL_MULT`)
- whiff (F-vs-F) → both take `STANCE_STALL_MULT` chip (two tricks cancel but both poke)

Then per round: **rot** ticks (`ROT_PER_STACK` × stacks), **swarm** chips, and
freshly-applied rot (barbed/rot_surge) is added *after* the tick so it waits a
round. All of this is one pure function: `engine.resolve_round(...)`.

**Round flow (server, `undercity_db.py`):** landing on a foe calls a starter
(`_wild_battle`/`_barrier`/`_lair`/`_boss`) → `_start_battle` snapshots both
combatants onto `doc['battle']`, picks the monster's round-1 stance from its
personality, and telegraphs it. The client submits `combat-round` (a stance ±
one combat consumable); `_combat_round` resolves one exchange, re-telegraphs,
and on end calls `_finish_battle` → the per-kind reward finisher. A pending
`doc['battle']` blocks turn actions (`_BATTLE_ALLOWED_ACTIONS`). **Sudden death:
every fight runs until a death** — there is no round cap and no neutral timeout.
**The Collapse** guarantees termination for EVERY kind (`wild`/`elite`/`barrier`/
`lair`/`boss`, and the PvP auto-resolver): from `FRENZY_START` onward both
fighters take ramping `max_hp * FRENZY_PCT * tier` end-of-round damage, so the
fight always resolves to a real kill won by the higher-HP-fraction side (the
tank), by ~round 6 (see
[2026-07-19-undercity-combat-collapse-design.md](2026-07-19-undercity-combat-collapse-design.md)).
A persistent-pool foe (lair/boss) lingers at its chipped HP when the **player**
dies, and reforms on a kill. `COMBAT_HARD_CAP` (24) is an unreachable safety
bound, not a stalemate cap.

**Monster AI:** `STANCE_PERSONALITIES` weight triples (`brute`/`turtle`/
`trickster`/`balanced`) → `engine.pick_stance`; `engine.telegraph(actual, bluff)`
shows the truth unless it bluffs. Bluff rate + stats are the difficulty dials.

**Reads (occasional predictions):** the on-screen intent is NOT shown every
round — each round `_telegraph_next` rolls against a per-battle **read chance**
(`_read_chance`, snapshotted at `_start_battle` into `rec['readChance']`):
`READ_BASE` + `READ_SPD_COEFF`×SPD + `READ_PASSIVE_BONUS` (reader passives
`first_bite`/`vexing`) + gear `readBonus` (Seer/Glint charms), capped `READ_MAX`.
When it misses, `_shown_telegraph` returns `None` (client shows a muted "?").
A Scrying Spore (`combat-peek`) forces a true read on demand; a Glint feint-win
sets `reveal_next`, guaranteeing the next round is a true read. The client
telegraph field is therefore nullable everywhere (battle_start / combat-round /
resume).

## 2. Effect-kind vocabulary — the four levers

| Lever | Lives in (data) | Carried on `Combatant` | Applied in |
|---|---|---|---|
| **Creature passive** | form specs `STARTERS`/`TIER2`/`APEX` (`passive`) | `.passives` (via `_passives`) | branches in `engine.resolve_round` |
| **Gear rider** | `GEAR[*].rider` + `GEAR_RIDERS` | `.riders` (via `_riders`) | branches in `engine.resolve_round` |
| **Spell-buff** | `SPELLS` + `ONE_BATTLE_BUFFS` | `.buffs` (via `_active_buff_kinds`) | `engine.resolve_round` + `effective_stats` |
| **Combat consumable** | `CONSUMABLES[*].combat/effect` | — (per-round) | `_COMBAT_ITEM` → `resolve_round` modifiers |

Combat consumables map to three general one-round modifiers on `resolve_round`:
`force_winner` (auto-win), `double_win_for` (double a win), `negate_loss_for`
(cancel a punish). Reveal is the separate `combat-peek` action.

## 3. Add an enemy

1. **Pick the table** in `undercity_data.py`: overworld fodder → `NPCS`;
   elite spaces → `ELITE_NPCS`; a dungeon's themed wild → `DUNGEON_NPCS[biome]`;
   a barrier → `BARRIER_GUARDIANS[node]`; a lair mini-boss → `LAIR_BOSSES[node]`.
2. **Add the spec** (template):
   ```python
   {'id': 'my_beast', 'name': 'My Beast',
    'hp': 24, 'atk': 8, 'def': 3, 'spd': 5, 'bounty': 12, 'xp': 15,
    'itemChance': 0.10,               # wild/elite/dungeon only
    'personality': 'brute',           # brute|turtle|trickster|balanced
    'bluff': 0.10}                    # 0.0 fodder … ~0.30 boss
   ```
   Lair bosses also need `**_LAIR_REWARD` (or `first`/`repeat`). Guardians need
   `bounty`/`xp`. `personality`/`bluff` are optional (defaults
   `NPC_DEFAULT_PERSONALITY`/`NPC_DEFAULT_BLUFF`) but annotate them so the client
   can show a tell.
3. **Entry + rewards are automatic** for existing kinds — the starter routes it
   and the matching `_finish_*` in `undercity_db.py` pays out. A brand-new *kind*
   of foe needs a starter that calls `_start_battle(..., kind, npc, ...)` and a
   `_finish_<kind>` branch in `_finish_battle`.
4. **Test:** `test_all_battle_specs_have_valid_personality` covers the shape; add
   a flow test with `_finish_started_battle` if the kind is new. Keep
   `test_balance_good_play_beats_fodder` green.

## 4. Add equipment

1. **`GEAR` entry** in `undercity_data.py` (slot ∈ `fang`/`carapace`/`charm`):
   ```python
   'my_fang': {'name': 'My Fang', 'slot': 'fang', 'tier': 2, 'cost': 45,
               'atk': 4, 'rider': 'barbed'},   # rider optional
   ```
   Stats (`atk`/`def`/`spd`/`maxHp`) flow through `effective_stats`; the slot is
   equipped generically by `_buy` (no whitelist to touch). Charms lean light on
   stats — their value is the rider.
2. **New rider?** Add to `GEAR_RIDERS` (`stance` + `blurb`), then implement its
   effect in the matching stance branch of `engine.resolve_round` (see the
   `has_rider('...')` checks), and add a unit test in `test_undercity_engine.py`.
3. **Read-rate gear:** add a `readBonus` float to the `GEAR` entry (see Seer /
   Glint charms). `_read_chance` sums it automatically — no other wiring.
4. **Plan 3 (client):** mirror the gear/rider into `src/app/undercity/data/*.ts`
   for display.

**Rarity tiers.** `tier` 1/2/3 = Common/Rare/Legendary; `tier` 4 = **Mythic**,
which is **craft-only** — forged from a Legendary of the same rider family at the
Blacksmith for 3 Chrysalis Ichor (`UPGRADE_ICHOR[4]`) + Spores, never dropped, sold,
or found (no tier-4 in `GEAR_DROP`, the bazaar tier sets, or the boss trove). A
Mythic adds the `RIDER_SCALE[*][4]` magnitude step plus a stat band above T3. Adding
a Mythic = one tier-4 `GEAR` entry (auto-indexes into `GEAR_FAMILY[rider][4]`) + the
`RIDER_SCALE` tier-4 value; see [specs/2026-07-23-undercity-mythic-gear-design.md](2026-07-23-undercity-mythic-gear-design.md).

## 5. Add an effect

- **New passive:** add `passive` to a form spec, implement in `resolve_round`
  (a `winr.has('...')` / `losr.has('...')` branch), add an engine test. Pure
  economy passives (no combat role) just get read elsewhere — no `resolve_round`
  change.
- **New spell-buff:** add to `SPELLS`; if it lasts one battle add its kind to
  `undercity_db.ONE_BATTLE_BUFFS`; implement in `resolve_round`
  (`has_buff('...')`) and/or `engine.effective_stats` (for flat stat shifts);
  add a test.
- **New combat consumable:** add a `CONSUMABLES` entry with `'combat': True` +
  an `effect`; map the id in `undercity_db._COMBAT_ITEM` to one of
  `auto_win`/`double_punish`/`negate`. A genuinely new mechanic needs a new
  optional modifier arg on `engine.resolve_round` + an engine test. Reveal-style
  effects go through `combat-peek`, not `combat-round`.

## 6. Invariants

- **No effect may reduce a combatant below the documented floors** (player/boss
  pools floor per existing rules; `_base_hit` floors damage at 1).
- **Sudden death — no draws.** Every fight resolves to a kill (the Collapse
  guarantees it). A persistent-pool foe (lair/boss) lingers at its chipped HP
  only when the **player** dies; it is never slain, and never awards a
  slay/sigil, without an actual killing blow. The `COMBAT_HARD_CAP` timeout is
  unreachable insurance, not a normal outcome.
- **Balance numbers are mirrored** in `src/app/undercity/data/*.ts` for display
  (Plan 3) — update both when you tune.
- **Interactive combat is PvE-only.** PvP uses the one-shot `resolve_battle`
  (which now autobattles to completion via the Collapse); don't route it through
  `doc['battle']`.
- The pytest suite (`cd infrastructure/lambda && python -m pytest tests -q`)
  must stay green (run against the committed `map.json`).

## 7. Tuning knobs (all in `undercity_data.py`)

`STANCE_WIN_MULT`, `STANCE_GUARD_MITIGATE`, `STANCE_GUARD_COUNTER`,
`STANCE_CLASH_MULT`, `STANCE_STALL_MULT`, `STANCE_STAT_WEIGHT`,
`GUARD_SIG_WEIGHT`, `FEINT_SIG_WEIGHT` (per-stance signature weights — Feint is
lighter so SPD isn't a heavy hitter), `MITIGATION_K`, `MITIGATION_CAP` (the
proportional-DEF curve), `ROT_PER_STACK`, `SWARM_CHIP_MULT`,
`SCAVENGE_RETALIATE`, `DEATHTOUCH_PIERCE`, `FLYBY_DODGE`, `VENOM_BARB_BONUS`,
`FIRST_WIN_ROT_BREATH_MULT`, `MAX_ROUNDS_COMBAT`, `COMBAT_HARD_CAP`,
`FRENZY_START`, `FRENZY_PCT`,
`STANCE_PERSONALITIES`,
`NPC_DEFAULT_PERSONALITY`, `NPC_DEFAULT_BLUFF`. Read-rate knobs: `READ_BASE`,
`READ_MAX`, `READ_SPD_COEFF`, `READ_PASSIVE_BONUS`, and per-gear `readBonus`
(tamed 2026-07-21 so SPD no longer monopolises reads). The
`test_balance_good_play_beats_fodder` invariant plus the
`test_spd_build_no_longer_trivialises_a_boss` / `test_def_measurably_reduces_damage_taken`
regressions guard changes to these. See
[2026-07-21-undercity-combat-rebalance-design.md](2026-07-21-undercity-combat-rebalance-design.md).

## Attribute perks (design 2026-07-21)

Investing in an attribute unlocks threshold perks (nodes at **5 / 10 / 15**),
derived from the **invested base stat** (`doc['atk'/'def'/'spd']` = species base
+ level spends + evolution bonuses — **gear/buffs never light a perk**). Base
stats can already light a tier-1 node (a kraul hatches with *Rend*). The set is
computed by `engine.attribute_perks(doc)` and rides on `Combatant.perks`; it is
surfaced in state as `you.perks` / `player.perks`.

- **ATK** — *Rend* (5: winning Aggress applies rot), *Menace* (10: enemies bluff
  less, via `_telegraph_next`), *Deathdrive* (15: Aggress swing bonus below half
  HP, in `_swing_base`).
- **DEF** — *Thick Hide* (5: halve hazard/mystery HP loss, `_apply_hp_loss`),
  **Carapace Grind** (10: the Guard/DEF fix — a Guard holder that doesn't win the
  exchange still deals a DEF-scaled chip; end of `resolve_round`, coeff
  `GUARD_CHIP_COEFF`), *Last Stand* (15: survive one lethal blow per descent at 1
  HP, in `_finish_battle`; resets on surfacing).
- **SPD** — *Fleetfoot* (5: optional reroll of a 1), *Pathfinder* (10: roll two,
  keep either — union destinations), *Blink* (15: choose the die value); all in
  `_roll`.

Scalars in `undercity_config.py` (`GUARD_CHIP_COEFF`, `DEATHDRIVE_MULT`,
`MENACE_FACTOR`, `THICK_HIDE_MULT`); defs in `undercity_data.PERKS`/`PERK_TRACKS`;
client mirror `src/app/undercity/data/perks.ts`. Tests: `tests/test_undercity_perks.py`.
Balance validated headless in `infrastructure/lambda/sim/` (see `proto_fix.verify_real`).
