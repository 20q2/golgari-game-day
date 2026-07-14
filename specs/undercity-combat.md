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
`max(1, round(atk * uniform(0.85,1.15)) - effective_def)` (`engine._base_hit`),
scaled by the matchup multiplier:

- decisive win → `STANCE_WIN_MULT` (winner deals, loser deals nothing)
- Guard beats Aggress → aggressor's hit × `STANCE_GUARD_MITIGATE`, guard counters × `STANCE_GUARD_COUNTER`
- clash → both × `STANCE_CLASH_MULT` (SPD, or `first_bite`, lands first)
- stall → both × `STANCE_STALL_MULT` (chip)
- whiff → nothing

Then per round: **rot** ticks (`ROT_PER_STACK` × stacks), **swarm** chips, and
freshly-applied rot (barbed/rot_surge) is added *after* the tick so it waits a
round. All of this is one pure function: `engine.resolve_round(...)`.

**Round flow (server, `undercity_db.py`):** landing on a foe calls a starter
(`_wild_battle`/`_barrier`/`_lair`/`_boss`) → `_start_battle` snapshots both
combatants onto `doc['battle']`, picks the monster's round-1 stance from its
personality, and telegraphs it. The client submits `combat-round` (a stance ±
one combat consumable); `_combat_round` resolves one exchange, re-telegraphs,
and on end calls `_finish_battle` → the per-kind reward finisher. A pending
`doc['battle']` blocks turn actions (`_BATTLE_ALLOWED_ACTIONS`). A non-kill at
the round cap is a **neutral timeout** — load-bearing for persistent-pool foes
(lair/boss linger; they are NOT slain on a timeout).

**Monster AI:** `STANCE_PERSONALITIES` weight triples (`brute`/`turtle`/
`trickster`/`balanced`) → `engine.pick_stance`; `engine.telegraph(actual, bluff)`
shows the truth unless it bluffs. Bluff rate + stats are the difficulty dials.

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
3. **Plan 3 (client):** mirror the gear/rider into `src/app/undercity/data/*.ts`
   for display.

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
- **Timeout is neutral** — never award a slay/sigil/loot on a round-cap timeout;
  persistent-pool foes must linger.
- **Balance numbers are mirrored** in `src/app/undercity/data/*.ts` for display
  (Plan 3) — update both when you tune.
- **Combat is PvE-only.** PvP uses the one-shot `resolve_battle`; don't route it
  through `doc['battle']`.
- The pytest suite (`cd infrastructure/lambda && python -m pytest tests -q`)
  must stay green (run against the committed `map.json`).

## 7. Tuning knobs (all in `undercity_data.py`)

`STANCE_WIN_MULT`, `STANCE_GUARD_MITIGATE`, `STANCE_GUARD_COUNTER`,
`STANCE_CLASH_MULT`, `STANCE_STALL_MULT`, `ROT_PER_STACK`, `SWARM_CHIP_MULT`,
`SCAVENGE_RETALIATE`, `DEATHTOUCH_PIERCE`, `FLYBY_DODGE`, `VENOM_BARB_BONUS`,
`FIRST_WIN_ROT_BREATH_MULT`, `MAX_ROUNDS_COMBAT`, `STANCE_PERSONALITIES`,
`NPC_DEFAULT_PERSONALITY`, `NPC_DEFAULT_BLUFF`. The
`test_balance_good_play_beats_fodder` invariant guards changes to these.
