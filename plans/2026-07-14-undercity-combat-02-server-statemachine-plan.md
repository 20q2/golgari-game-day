# Undercity Combat Redesign — Plan 2: Server Interactive Battle

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Turn PvE battles from one-shot server resolution into an **interactive, round-driven state machine** over `POST /game/action`: landing on a foe starts a battle and telegraphs the monster's intent; the player submits a stance (and optional combat consumable) each round; the server resolves one exchange with `engine.resolve_round`, re-telegraphs, and applies rewards only when the battle ends. Adds monster personality/telegraph/bluff AI, wires the charm slot + gear riders + buffs into combatants, and implements the combat-consumable effects. PvP stays on the Plan 1 back-compat auto path.

**Architecture:** All work is in `infrastructure/lambda/` — `undercity_engine.py` (AI + consumable round-mods, pure/tested), `undercity_data.py` (personality/bluff on NPC specs, charm equip), `undercity_db.py` (the battle state machine, new actions, reward finishers, guards), verified by the FakeTable integration tests in `tests/`. A pending battle is persisted on the player document as `doc['battle']`; three new actions drive it: `combat-peek` (spend a reveal item), `combat-round` (submit a stance ± item, resolve one exchange), `combat-flee`. The reward/XP/compost logic currently inside `_wild_battle`/`_barrier`/`_lair`/`_boss` is lifted into `_finish_battle` dispatched by battle kind.

**Tech Stack:** Python 3.11, pytest, DynamoDB single-table (FakeTable in tests).

**Reference:** `specs/2026-07-14-undercity-combat-redesign-design.md` (§1 telegraph+personality+bluff, §2 charm slot, §4 consumables/buffs). Builds on Plan 1 (`plans/2026-07-14-undercity-combat-01-engine-core-plan.md`), which delivered `resolve_round`, `exchange_winner`, `flee_attempt`, `resolve_battle_rounds`, riders/buffs/rot on `Combatant`.

### Key design decisions (flagged for review before implementation)

1. **One request per round.** The client submits one stance per HTTP call; the server resolves one exchange and returns the next telegraph. Chatty (≤6 calls/battle) but the only model faithful to "react to the telegraph."
2. **A pending battle blocks other turn actions.** While `doc.get('battle')` exists, `roll`/`move`/`cast`/`buy`/`warp`/etc. return 409 "Finish your fight first." Combat actions and read-only actions are allowed. Battle state is server-side, so closing the app mid-fight resumes cleanly.
3. **Reveal is a pre-commit action (`combat-peek`), not a round modifier.** It must show the true intent *before* the player commits a stance, so it can't ride along in `combat-round`. It consumes the item and returns `npcActual` without resolving.
4. **Buffs freeze at battle start.** Player combat stats, riders and one-battle buffs are snapshotted into the battle record when it starts and consumed on end (mirrors today's `_consume_one_battle_buffs`).
5. **PvP is untouched as a design target.** `_battle` keeps resolving via the back-compat `engine.resolve_battle` auto path from Plan 1. No interactivity, no new code.

### Out of scope for Plan 2

- The client UI (Plan 3) and the `src/app/undercity/data/*.ts` display mirrors (Plan 3).
- Final, playtested balance numbers. Task 11 does a principled starting retune + a regression invariant, not a shipped balance.

---

## File Structure

- **`undercity_engine.py`** — add `STANCE_PERSONALITIES`, `pick_stance`, `telegraph`; extend `resolve_round` with three optional round-modifier params (`force_winner`, `negate_loss_for`, `double_win_for`).
- **`undercity_data.py`** — add `personality`/`bluff` fields (with a `NPC_DEFAULT_PERSONALITY`/`NPC_DEFAULT_BLUFF`) to `NPCS`, `ELITE_NPCS`, `DUNGEON_NPCS`, `BARRIER_GUARDIANS`, `LAIR_BOSSES`, `ROT_SOVEREIGN`; add `'charm'` to the equip slot set; a coarse balance retune of monster stats.
- **`undercity_db.py`** — `_combatant` populates `riders`+`buffs`; battle-record serde (`_bt_snapshot`, `_bt_to_combatant`, `_bt_store`); `_start_battle` (+ per-kind context builders); `combat-peek`/`combat-round`/`combat-flee` handlers; `_finish_battle` + `_finish_wild/_barrier/_lair/_boss`; a `_battle_guard` used by the blocked actions; charm slot in `_buy`.
- **`tests/test_undercity_db.py`** — a `_run_combat(table, stances)` helper that drives a started battle to completion; rewrite the battle-triggering tests (`wild`, `elite`, barrier, lair, boss) to the new flow; new tests for peek/flee/consumables/blocking/charm.
- **`tests/test_undercity_engine.py`** — tests for `pick_stance`, `telegraph`, and the three round-modifiers.

---

## Task 1: Monster AI — personalities, `pick_stance`, `telegraph`

**Files:**
- Modify: `infrastructure/lambda/undercity_data.py` (combat tuning block from Plan 1 Task 1)
- Modify: `infrastructure/lambda/undercity_engine.py` (after `exchange_winner`/`flee_attempt`)
- Test: `infrastructure/lambda/tests/test_undercity_engine.py`

- [ ] **Step 1: Add personality weight tables to `undercity_data.py`**

Append to the "Combat: stance triangle tuning" block:

```python
# Monster AI (spec §1). Each personality is a weight triple over
# (aggress, guard, feint); the monster's true stance is drawn from it and then
# telegraphed truthfully except on a bluff. Bluff rate scales difficulty.
STANCE_PERSONALITIES = {
    'brute':     (0.60, 0.25, 0.15),
    'turtle':    (0.20, 0.60, 0.20),
    'trickster': (0.20, 0.20, 0.60),
    'balanced':  (0.34, 0.33, 0.33),
}
NPC_DEFAULT_PERSONALITY = 'balanced'
NPC_DEFAULT_BLUFF = 0.0   # overworld fodder never bluffs; elites/bosses do
```

- [ ] **Step 2: Write the failing engine tests**

Add to `tests/test_undercity_engine.py`:

```python
from undercity_engine import pick_stance, telegraph


def test_pick_stance_uses_weights_via_cumulative_roll():
    # random() picks along the cumulative (aggress, guard, feint) distribution.
    assert pick_stance('brute', FakeRng(randoms=[0.00])) == 'aggress'
    assert pick_stance('brute', FakeRng(randoms=[0.70])) == 'guard'   # 0.60..0.85
    assert pick_stance('brute', FakeRng(randoms=[0.90])) == 'feint'   # 0.85..1.0
    assert pick_stance('turtle', FakeRng(randoms=[0.50])) == 'guard'


def test_telegraph_truthful_when_no_bluff():
    # bluff 0 => always shows the true stance.
    assert telegraph('aggress', bluff=0.0, rng=FakeRng(randoms=[0.00])) == 'aggress'


def test_telegraph_bluffs_to_a_different_stance():
    # random() < bluff => show a DIFFERENT stance (chosen from the other two).
    shown = telegraph('aggress', bluff=0.5, rng=FakeRng(randoms=[0.10]))
    assert shown in ('guard', 'feint') and shown != 'aggress'
```

- [ ] **Step 3: Run, verify failure**

Run: `cd infrastructure/lambda && python -m pytest tests/test_undercity_engine.py -k "pick_stance or telegraph" -v`
Expected: FAIL — `cannot import name 'pick_stance'`

- [ ] **Step 4: Implement in `undercity_engine.py`** (after `flee_attempt`)

```python
def pick_stance(personality: str, rng) -> str:
    """Draw a monster's true stance from its personality weight triple."""
    weights = data.STANCE_PERSONALITIES.get(
        personality, data.STANCE_PERSONALITIES[data.NPC_DEFAULT_PERSONALITY])
    r = rng.random()
    cum = 0.0
    for stance, w in zip(data.STANCES, weights):
        cum += w
        if r < cum:
            return stance
    return data.STANCES[-1]


def telegraph(actual: str, bluff: float, rng) -> str:
    """What the monster SHOWS for its upcoming stance — the truth, unless it
    bluffs (rng.random() < bluff), in which case it shows one of the other two."""
    if rng.random() < bluff:
        others = [s for s in data.STANCES if s != actual]
        return others[rng.randint(0, len(others) - 1)]
    return actual
```

- [ ] **Step 5: Run, verify pass**

Run: `cd infrastructure/lambda && python -m pytest tests/test_undercity_engine.py -k "pick_stance or telegraph" -v`
Expected: PASS

- [ ] **Step 6: Commit**

```bash
git add infrastructure/lambda/undercity_engine.py infrastructure/lambda/undercity_data.py infrastructure/lambda/tests/test_undercity_engine.py
git commit -m "feat(undercity): monster stance AI (personality weights + telegraph/bluff)"
```

---

## Task 2: Consumable round-modifiers in `resolve_round`

**Files:**
- Modify: `infrastructure/lambda/undercity_engine.py` (`resolve_round` signature + winner selection)
- Test: `infrastructure/lambda/tests/test_undercity_engine.py`

Three general, item-agnostic one-round modifiers (the db maps consumables onto them):
- `force_winner` (`'attacker'`|`'defender'`|`None`) — override the triangle result (Ambush Musk auto-win).
- `double_win_for` (side|`None`) — if that side wins its exchange, double the damage it deals (Rot Bomb).
- `negate_loss_for` (side|`None`) — if that side loses its exchange, cancel the punish it would take (Chitin Ward).

- [ ] **Step 1: Write the failing tests**

```python
def test_force_winner_overrides_triangle():
    a = fighter(atk=10, dfn=5, hp=30, max_hp=30)
    d = fighter(atk=10, dfn=5, hp=30, max_hp=30)
    # a plays feint into d guard: normally a WINS (F>G). force defender instead.
    resolve_round(a, d, 'feint', 'guard', 1, FakeRng(uniform=1.0),
                  force_winner='defender')
    assert a.hp < 30 and d.hp == 30


def test_double_win_for_doubles_winner_damage():
    a = fighter(atk=10, dfn=5, hp=30, max_hp=30)
    d = fighter(atk=10, dfn=4, hp=60, max_hp=60)
    resolve_round(a, d, 'aggress', 'feint', 1, FakeRng(uniform=1.0),
                  double_win_for='attacker')
    assert d.hp == 60 - round(6 * data.STANCE_WIN_MULT) * 2   # 9 -> 18


def test_negate_loss_cancels_punish():
    a = fighter(atk=10, dfn=5, hp=30, max_hp=30)   # winner by triangle
    d = fighter(atk=10, dfn=5, hp=30, max_hp=30)   # loser, negates
    resolve_round(a, d, 'aggress', 'feint', 1, FakeRng(uniform=1.0),
                  negate_loss_for='defender')
    assert d.hp == 30   # punish negated
```

- [ ] **Step 2: Run, verify failure**

Run: `cd infrastructure/lambda && python -m pytest tests/test_undercity_engine.py -k "force_winner or double_win or negate_loss" -v`
Expected: FAIL — `resolve_round() got an unexpected keyword argument`

- [ ] **Step 3: Implement**

Change the signature:

```python
def resolve_round(attacker, defender, a_stance, d_stance, rnd, rng,
                  force_winner=None, double_win_for=None, negate_loss_for=None) -> list:
```

Right after `winner = exchange_winner(a_stance, d_stance)`, override it and stash the flags:

```python
    if force_winner in ('attacker', 'defender'):
        winner = force_winner
```

In the decisive-winner branch, `negate_loss_for` short-circuits the punish (like a full dodge) and `double_win_for` multiplies the winner's damage. In `resolve_round`, the decisive block currently reads:

```python
    if winner in ('attacker', 'defender'):
        win_side = winner
        lose_side = 'defender' if winner == 'attacker' else 'attacker'
        winr, losr = (...)
        win_stance = ...

        if losr.has('flyby') and rng.random() < data.FLYBY_DODGE:
            ...flyby dodge...
        elif win_stance == 'guard':
            ...guard mitigate + counter...
        else:
            ...non-guard winning hit...
```

Add the negate check as the **first** branch of that if/elif chain (so it fully replaces the damage this exchange), and thread `double_win_for` into the two damage sub-branches:

```python
        if negate_loss_for == lose_side:
            entries.append({'round': rnd, 'by': win_side, 'dmg': 0,
                            'negated': True, 'winner': win_side})
        elif losr.has('flyby') and rng.random() < data.FLYBY_DODGE:
            ...flyby dodge (unchanged)...
        elif win_stance == 'guard':
            ...guard mitigate (unchanged)...
            ctr_mult = data.STANCE_GUARD_COUNTER * (1.5 if winr.has_rider('spiked') else 1.0)
            if double_win_for == win_side:
                ctr_mult *= 2
            ...counter deal + harden_shell + scavenge (unchanged)...
        else:
            ...compute dmg with all existing multipliers/bonuses...
            if double_win_for == win_side:
                dmg *= 2
            ...apply dmg + drain + feint riders + scavenge (unchanged)...
```

The negate branch runs before the swarm/rot tail, so rot ticks and swarm chip still apply that round — negate cancels only the decisive exchange, matching Chitin Ward's "cancel the punish from one wrong guess."

- [ ] **Step 4: Run, verify pass**

Run: `cd infrastructure/lambda && python -m pytest tests/test_undercity_engine.py -k "force_winner or double_win or negate_loss" -v`
Expected: PASS. Then full engine suite:
Run: `cd infrastructure/lambda && python -m pytest tests/test_undercity_engine.py -q`
Expected: PASS (no regression to Plan 1 tests).

- [ ] **Step 5: Commit**

```bash
git add infrastructure/lambda/undercity_engine.py infrastructure/lambda/tests/test_undercity_engine.py
git commit -m "feat(undercity): consumable round-modifiers in resolve_round"
```

---

## Task 3: Wire riders + buffs into `_combatant`; add charm equip slot

**Files:**
- Modify: `infrastructure/lambda/undercity_db.py` (`_combatant`, `_buy`/equip slot set)
- Test: `infrastructure/lambda/tests/test_undercity_db.py`

- [ ] **Step 1: Write the failing test**

Add to `tests/test_undercity_db.py` (uses the existing `table`/`act`/`_get_player`/`_sid` helpers):

```python
def test_combatant_carries_riders_and_buffs_from_gear(table):
    act(table, 'join', starter='saproling')
    sid = _sid(table)
    doc = db._get_player(table, sid, 'user-alex')
    doc['gear'] = {'fang': 'kraul_barb', 'charm': 'glint_charm'}
    doc['buffs'] = [{'kind': 'harden_shell'}]
    c = db._combatant(doc)
    assert 'deep_biter' in c.riders and 'glint' in c.riders
    assert 'harden_shell' in c.buffs
```

- [ ] **Step 2: Run, verify failure**

Run: `cd infrastructure/lambda && python -m pytest tests/test_undercity_db.py::test_combatant_carries_riders_and_buffs_from_gear -v`
Expected: FAIL — `c.riders` is empty (default `frozenset()`).

- [ ] **Step 3: Implement**

Add a helper near `_passives` and extend `_combatant`:

```python
def _riders(doc):
    out = set()
    for gid in (doc.get('gear') or {}).values():
        rider = data.GEAR.get(gid, {}).get('rider')
        if rider:
            out.add(rider)
    return frozenset(out)


def _active_buff_kinds(doc):
    return frozenset(b.get('kind') for b in (doc.get('buffs') or []) if b.get('kind'))
```

In `_combatant`, add `riders=_riders(doc), buffs=_active_buff_kinds(doc),` to the `Combatant(...)` call.

Add `'charm'` to the equip slot set. Find the slot validation in `_buy` (search for the existing slots `('fang', 'carapace')` or the gear-equip write) and include `'charm'`:

Run first: `cd infrastructure/lambda && grep -n "fang\|carapace\|slot" undercity_db.py`
Then wherever gear slots are whitelisted for equipping, extend the tuple to `('fang', 'carapace', 'charm')`. If `_buy` writes `doc['gear'][slot] = gid` using `data.GEAR[gid]['slot']` directly (no whitelist), no change is needed there — verify by reading `_buy`.

- [ ] **Step 4: Run, verify pass**

Run: `cd infrastructure/lambda && python -m pytest tests/test_undercity_db.py::test_combatant_carries_riders_and_buffs_from_gear -v`
Expected: PASS

- [ ] **Step 5: Add a charm-buy test and verify**

```python
def test_buy_charm_equips_into_charm_slot(table):
    act(table, 'join', starter='pest')
    sid = _sid(table)
    doc = db._get_player(table, sid, 'user-alex')
    doc['spores'] = 500
    doc['position'] = _first_node_of_type(table, 'shop')   # existing test helper; else set a shop node
    db._put_player(table, doc)
    status, resp = act(table, 'buy', itemId='quartz_charm', kind='gear')
    assert status == 200
    doc = db._get_player(table, sid, 'user-alex')
    assert doc['gear'].get('charm') == 'quartz_charm'
```

If `_first_node_of_type` does not exist, set `doc['position']` to a known shop node id from the committed map (see other buy tests for how they park at a shop). Match the `act(table, 'buy', ...)` payload keys to the real `_buy` signature (read it first).

Run: `cd infrastructure/lambda && python -m pytest tests/test_undercity_db.py -k "charm" -v`
Expected: PASS

- [ ] **Step 6: Commit**

```bash
git add infrastructure/lambda/undercity_db.py infrastructure/lambda/tests/test_undercity_db.py
git commit -m "feat(undercity): wire gear riders + buffs into combatant; charm equip slot"
```

---

## Task 4: Battle-record serde + `_bt_*` helpers

**Files:**
- Modify: `infrastructure/lambda/undercity_db.py`
- Test: `infrastructure/lambda/tests/test_undercity_db.py`

The battle lives on `doc['battle']`. Combatants serialize to plain dicts (DynamoDB-safe: no sets — store passives/riders/buffs as sorted lists).

- [ ] **Step 1: Write the failing test**

```python
def test_battle_combatant_roundtrips_through_dict(table):
    c = db.engine.Combatant(name='X', hp=25, max_hp=40, atk=8, dfn=5, spd=6,
                            passives=frozenset({'swarm'}), riders=frozenset({'barbed'}),
                            buffs=frozenset({'rot_surge'}))
    c.rot_stacks = 2; c.first_win_used = True; c.dmg_penalty = 1
    snap = db._bt_snapshot(c)
    assert isinstance(snap['passives'], list) and snap['hp'] == 25
    c2 = db._bt_to_combatant(snap)
    assert c2.hp == 25 and c2.rot_stacks == 2 and c2.first_win_used
    assert 'barbed' in c2.riders and 'rot_surge' in c2.buffs and 'swarm' in c2.passives
```

- [ ] **Step 2: Run, verify failure**

Run: `cd infrastructure/lambda && python -m pytest tests/test_undercity_db.py::test_battle_combatant_roundtrips_through_dict -v`
Expected: FAIL — `module 'undercity_db' has no attribute '_bt_snapshot'`

- [ ] **Step 3: Implement** (near `_combatant`)

```python
_BT_FLAGS = ('rot_stacks', 'first_win_used', 'dmg_penalty', 'reveal_next')


def _bt_snapshot(c):
    """Serialize a Combatant to a DynamoDB-safe dict (sets -> sorted lists)."""
    return {
        'name': c.name, 'hp': int(c.hp), 'maxHp': int(c.max_hp),
        'atk': int(c.atk), 'dfn': int(c.dfn), 'spd': int(c.spd),
        'passives': sorted(c.passives), 'riders': sorted(c.riders),
        'buffs': sorted(c.buffs), 'flee_bonus': int(c.flee_bonus),
        'has_smoke_spore': bool(c.has_smoke_spore),
        'rot_stacks': int(c.rot_stacks), 'first_win_used': bool(c.first_win_used),
        'dmg_penalty': int(c.dmg_penalty), 'reveal_next': bool(c.reveal_next),
    }


def _bt_to_combatant(s):
    c = engine.Combatant(
        name=s['name'], hp=int(s['hp']), max_hp=int(s['maxHp']),
        atk=int(s['atk']), dfn=int(s['dfn']), spd=int(s['spd']),
        passives=frozenset(s.get('passives') or []),
        riders=frozenset(s.get('riders') or []),
        buffs=frozenset(s.get('buffs') or []),
        flee_bonus=int(s.get('flee_bonus', 0)),
        has_smoke_spore=bool(s.get('has_smoke_spore', False)))
    c.rot_stacks = int(s.get('rot_stacks', 0))
    c.first_win_used = bool(s.get('first_win_used', False))
    c.dmg_penalty = int(s.get('dmg_penalty', 0))
    c.reveal_next = bool(s.get('reveal_next', False))
    return c


def _bt_store(c, rec_side):
    """Write a resolved Combatant's mutable state back into a snapshot dict."""
    rec_side['hp'] = int(max(0, c.hp))
    for f in _BT_FLAGS:
        rec_side[f] = (int(getattr(c, f)) if f in ('rot_stacks', 'dmg_penalty')
                       else bool(getattr(c, f)))
```

- [ ] **Step 4: Run, verify pass**

Run: `cd infrastructure/lambda && python -m pytest tests/test_undercity_db.py::test_battle_combatant_roundtrips_through_dict -v`
Expected: PASS

- [ ] **Step 5: Commit**

```bash
git add infrastructure/lambda/undercity_db.py infrastructure/lambda/tests/test_undercity_db.py
git commit -m "feat(undercity): battle-record combatant serde helpers"
```

---

## Task 5: `_start_battle` + per-kind context; landing triggers a start

**Files:**
- Modify: `infrastructure/lambda/undercity_db.py`
- Test: deferred to Task 8 (needs the round handler); this task adds a direct unit test of the record shape.

- [ ] **Step 1: Write the failing test**

```python
def test_start_battle_persists_record_with_first_telegraph(table):
    act(table, 'join', starter='kraul')
    sid = _sid(table)
    doc = db._get_player(table, sid, 'user-alex')
    npc = {'id': 'drudge_beetle', 'name': 'Drudge Beetle', 'hp': 16, 'atk': 4,
           'def': 1, 'spd': 4, 'bounty': 6, 'xp': 10, 'itemChance': 0.0,
           'personality': 'brute', 'bluff': 0.0}
    ev = db._start_battle(table, sid, doc, 'wild', npc, node=doc['position'])
    assert ev['type'] == 'battle_start'
    rec = doc['battle']
    assert rec['kind'] == 'wild' and rec['round'] == 1
    assert rec['npcShown'] in db.data.STANCES and rec['npcActual'] in db.data.STANCES
    assert ev['telegraph'] == rec['npcShown']
    assert rec['player']['hp'] == doc['hp']
```

- [ ] **Step 2: Run, verify failure**

Run: `cd infrastructure/lambda && python -m pytest tests/test_undercity_db.py::test_start_battle_persists_record_with_first_telegraph -v`
Expected: FAIL — no `_start_battle`.

- [ ] **Step 3: Implement**

```python
def _npc_combatant(npc):
    return engine.Combatant(
        name=npc['name'], hp=npc['hp'], max_hp=npc.get('maxHp', npc['hp']),
        atk=npc['atk'], dfn=npc['def'], spd=npc['spd'],
        passives=frozenset(npc.get('passives') or []))


def _telegraph_next(rec):
    """Pick the npc's next true stance from personality and telegraph it; store
    both on the record. Returns the shown stance."""
    personality = rec['npc'].get('personality', data.NPC_DEFAULT_PERSONALITY)
    bluff = float(rec['npc'].get('bluff', data.NPC_DEFAULT_BLUFF))
    actual = engine.pick_stance(personality, _rng)
    shown = engine.telegraph(actual, bluff, _rng)
    rec['npcActual'] = actual
    rec['npcShown'] = shown
    rec['peeked'] = False
    return shown


def _start_battle(table, sid, doc, kind, npc, node=None, ctx=None):
    """Snapshot combatants into doc['battle'], telegraph round 1, return the
    battle_start space event. Player buffs/stats freeze here."""
    player_c = _combatant(doc)
    if kind in ('wild', 'elite') and doc.get('homeBiome') == 'bone':
        player_c.dfn += 2  # Marrowborn hatch perk vs wilds (preserved)
    npc_snap = _bt_snapshot(_npc_combatant(npc))
    # carry AI + reward context on the npc snapshot
    npc_snap['personality'] = npc.get('personality', data.NPC_DEFAULT_PERSONALITY)
    npc_snap['bluff'] = float(npc.get('bluff', data.NPC_DEFAULT_BLUFF))
    rec = {
        'kind': kind, 'node': node, 'round': 1,
        'player': _bt_snapshot(player_c),
        'npc': npc_snap,
        'npcMeta': npc,          # full spec for reward resolution
        'ctx': ctx or {},        # kind-specific (lair slain flag, boss hp pool, ...)
        'strikes': [],
    }
    doc['battle'] = rec
    shown = _telegraph_next(rec)
    return {'type': 'battle_start', 'kind': kind,
            'npc': {'name': npc['name'], 'id': npc.get('id'),
                    'hp': npc_snap['hp'], 'maxHp': npc_snap['maxHp'],
                    'atk': npc_snap['atk'], 'def': npc_snap['dfn'], 'spd': npc_snap['spd']},
            'telegraph': shown, 'round': 1,
            'text': f'A {npc["name"]} bars your path!'}
```

- [ ] **Step 4: Run, verify pass**

Run: `cd infrastructure/lambda && python -m pytest tests/test_undercity_db.py::test_start_battle_persists_record_with_first_telegraph -v`
Expected: PASS

- [ ] **Step 5: Commit**

```bash
git add infrastructure/lambda/undercity_db.py infrastructure/lambda/tests/test_undercity_db.py
git commit -m "feat(undercity): _start_battle persists battle record + first telegraph"
```

---

## Task 6: `combat-round` / `combat-peek` / `combat-flee` handlers + `_finish_battle`

**Files:**
- Modify: `infrastructure/lambda/undercity_db.py` (dispatch table + handlers + finishers)
- Test: Task 8.

This is the core state machine. `_finish_battle` dispatches to per-kind finishers that contain the reward logic **lifted verbatim** from today's `_wild_battle`/`_barrier`/`_lair`/`_boss` (post-`result` sections), reading `result` from the accumulated battle instead of a one-shot `resolve_battle`.

- [ ] **Step 1: Register the three actions** in the `handlers` dict (line ~448):

```python
        'combat-round': _combat_round, 'combat-peek': _combat_peek,
        'combat-flee': _combat_flee,
```

- [ ] **Step 2: Implement the consumable → round-modifier map + handlers**

```python
# combat consumable id -> (kind, engine round-modifier)
_COMBAT_ITEM = {
    'ambush_musk': 'auto_win', 'rot_bomb': 'double_punish', 'chitin_ward': 'negate',
}


def _combat_peek(table, sid, doc, payload):
    rec = doc.get('battle')
    if not rec:
        return _err('No battle in progress.', 409)
    bag = doc.get('bag') or []
    if 'scrying_spore' not in bag:
        return _err('You have no Scrying Spore.', 409)
    if rec.get('peeked'):
        return _err('You already scried this round.', 409)
    bag.remove('scrying_spore')
    rec['peeked'] = True
    conflict = _save_or_conflict(table, doc)
    if conflict:
        return conflict
    return _ok(doc, peek={'trueIntent': rec['npcActual'], 'round': rec['round']})


def _combat_round(table, sid, doc, payload):
    rec = doc.get('battle')
    if not rec:
        return _err('No battle in progress.', 409)
    stance = (payload or {}).get('stance')
    if stance not in data.STANCES:
        return _err('Pick a stance.', 400)

    force_winner = double_win_for = negate_loss_for = None
    item = (payload or {}).get('item')
    if item:
        effect = _COMBAT_ITEM.get(item)
        if not effect or item not in (doc.get('bag') or []):
            return _err('You cannot use that here.', 409)
        doc['bag'].remove(item)
        if effect == 'auto_win':
            force_winner = 'attacker'
        elif effect == 'double_punish':
            double_win_for = 'attacker'
        elif effect == 'negate':
            negate_loss_for = 'attacker'

    player_c = _bt_to_combatant(rec['player'])
    npc_c = _bt_to_combatant(rec['npc'])
    rnd = rec['round']
    entries = engine.resolve_round(
        player_c, npc_c, stance, rec['npcActual'], rnd, _rng,
        force_winner=force_winner, double_win_for=double_win_for,
        negate_loss_for=negate_loss_for)
    rec['strikes'].extend(entries)
    _bt_store(player_c, rec['player'])
    _bt_store(npc_c, rec['npc'])

    # end conditions: someone dropped, or round cap reached
    over = player_c.hp <= 0 or npc_c.hp <= 0 or rnd >= data.MAX_ROUNDS_COMBAT
    if over:
        if npc_c.hp <= 0 and player_c.hp <= 0:
            outcome = 'attacker' if player_c.hp >= npc_c.hp else 'defender'
        elif npc_c.hp <= 0:
            outcome = 'attacker'
        elif player_c.hp <= 0:
            outcome = 'defender'
        else:  # timeout -> higher HP%
            a_pct = player_c.hp / max(1, player_c.max_hp)
            d_pct = npc_c.hp / max(1, npc_c.max_hp)
            outcome = ('attacker' if a_pct > d_pct
                       else 'defender' if d_pct > a_pct else 'timeout')
        # Regrowth on survivors (mirrors resolve_battle_rounds tail).
        for c in (player_c, npc_c):
            if c.hp > 0 and c.has('regrowth'):
                pct = 0.35 if c.has('rootwall') else 0.20
                c.hp = min(c.max_hp, c.hp + round(c.max_hp * pct))
        result = {'outcome': outcome, 'strikes': rec['strikes'],
                  'attackerHp': max(0, player_c.hp), 'defenderHp': max(0, npc_c.hp),
                  'smokeSporeUsed': False, 'defenderFleeFailed': False}
        return _finish_battle(table, sid, doc, rec, result)

    # continue: advance round + telegraph
    rec['round'] = rnd + 1
    shown = _telegraph_next(rec)
    conflict = _save_or_conflict(table, doc)
    if conflict:
        return conflict
    return _ok(doc, combat={'round': rec['round'], 'entries': entries,
                            'telegraph': shown,
                            'playerHp': rec['player']['hp'],
                            'npcHp': rec['npc']['hp'],
                            'revealNext': rec['player']['reveal_next']})


def _combat_flee(table, sid, doc, payload):
    rec = doc.get('battle')
    if not rec:
        return _err('No battle in progress.', 409)
    if rec['kind'] in ('barrier', 'boss'):
        return _err('There is no fleeing this fight.', 409)
    player_c = _bt_to_combatant(rec['player'])
    npc_c = _bt_to_combatant(rec['npc'])
    r = engine.flee_attempt(player_c, npc_c, _rng)
    if r['escaped']:
        if r['smokeSporeUsed'] and 'smoke_spore' in (doc.get('bag') or []):
            doc['bag'].remove('smoke_spore')
        doc['hp'] = player_c.hp
        doc['hpUpdatedAt'] = _now()
        doc.pop('battle', None)
        _consume_one_battle_buffs(doc)
        conflict = _save_or_conflict(table, doc)
        if conflict:
            return conflict
        return _ok(doc, combat={'fled': True, 'smokeSporeUsed': r['smokeSporeUsed']})
    # failed flee: -1 DEF, forfeit the round (npc gets a free telegraphed hit next round)
    _bt_store(player_c, rec['player'])
    rec['player']['dfn'] = player_c.dfn
    conflict = _save_or_conflict(table, doc)
    if conflict:
        return conflict
    return _ok(doc, combat={'fled': False, 'round': rec['round'],
                            'telegraph': rec['npcShown']})
```

- [ ] **Step 3: Implement `_finish_battle` and per-kind finishers**

`_finish_battle` pops the battle, writes final player HP, consumes one-battle buffs, then dispatches. Each `_finish_*` is the reward/compost/event block moved out of the corresponding original function, operating on `rec['npcMeta']`/`rec['ctx']` and `result`.

```python
def _finish_battle(table, sid, doc, rec, result):
    doc['hp'] = result['attackerHp']
    doc['hpUpdatedAt'] = _now()
    _consume_one_battle_buffs(doc)
    kind = rec['kind']
    doc.pop('battle', None)
    if kind in ('wild', 'elite'):
        out = _finish_wild(table, sid, doc, rec, result)
    elif kind == 'barrier':
        out = _finish_barrier(table, sid, doc, rec, result)
    elif kind == 'lair':
        out = _finish_lair(table, sid, doc, rec, result)
    else:
        out = _finish_boss(table, sid, doc, rec, result)
    conflict = _save_or_conflict(table, doc)
    if conflict:
        return conflict
    return _ok(doc, spaceEvent=out)
```

Then port the reward bodies. For example `_finish_wild` (lifted from `_wild_battle` lines 1061-1085, with `npc = rec['npcMeta']`):

```python
def _finish_wild(table, sid, doc, rec, result):
    npc = rec['npcMeta']
    elite = rec['kind'] == 'elite'
    out = {'type': 'elite' if elite else 'wild', 'npc': {
        'name': npc['name'], 'id': npc.get('id'), 'maxHp': npc['hp']},
        'battle': result}
    if result['outcome'] == 'attacker':
        bounty = npc['bounty'] + (2 if 'scrounger' in _passives(doc) else 0)
        doc['spores'] = doc.get('spores', 0) + bounty
        doc['wildWins'] = doc.get('wildWins', 0) + 1
        levels = _grant_xp(table, sid, doc, npc['xp'])
        out['spores'] = bounty; out['xp'] = npc['xp']
        if levels:
            out['levels'] = levels
        if npc['itemChance'] and _rng.random() < npc['itemChance']:
            item = _give_consumable(doc)
            if item:
                out['item'] = item
        out['text'] = f"You compost the {npc['name']}! +{bounty} Spores."
    elif result['outcome'] == 'defender':
        _grant_xp(table, sid, doc, data.XP_REWARDS['wild_loss'])
        _compost(table, sid, doc,
                 f"{doc['username']}'s {_creature_label(doc)} was composted by a "
                 f"{npc['name']}. The swarm remembers.")
        out['text'] = f"The {npc['name']} grinds you into the mulch. Back to the Gate…"
    else:
        _grant_xp(table, sid, doc, data.XP_REWARDS['timeout'])
        out['text'] = f"You and the {npc['name']} circle each other and part ways."
    return out
```

Port `_finish_barrier` (from `_barrier` 1110-1136; `node = rec['node']`, `g = rec['npcMeta']`), `_finish_lair` (from `_lair` 1163-1213; `node = rec['node']`, `slain`/`vest_max` from `rec['ctx']`), and `_finish_boss` (from `_boss` 1250-1292; `node = rec['node']`, `boss = data.ROT_SOVEREIGN`, `hp_before = rec['ctx']['hpBefore']`) the same way — copy each reward/compost/event branch verbatim, substituting the record fields. Keep the `_compost` calls, `_event` calls, `_set_lair_state`, `_set_boss_hp`, and `poiClaims` logic identical to the originals.

- [ ] **Step 4: Commit** (verified in Task 8)

```bash
git add infrastructure/lambda/undercity_db.py
git commit -m "feat(undercity): interactive combat-round/peek/flee handlers + finishers"
```

---

## Task 7: Rewire landing + battle entry points to start (not resolve); block during battle

**Files:**
- Modify: `infrastructure/lambda/undercity_db.py` (`_wild_battle`, `_barrier`, `_lair`, `_boss` → starters; `_battle_guard`; blocked handlers)
- Test: Task 8.

- [ ] **Step 1: Convert the four entry points to starters**

Replace the bodies of `_wild_battle`, `_barrier`, `_lair`, `_boss` so that instead of calling `_fixed_battle`/`resolve_battle` and resolving, they build the npc (with `personality`/`bluff` from the spec), build the kind-specific `ctx`, and return `_start_battle(...)`. Example for `_wild_battle`:

```python
def _wild_battle(table, sid, doc, elite=False):
    biome = data.dungeon_biome(doc.get('position', ''))
    if biome:
        npc = engine.npc_from_spec(data.DUNGEON_NPCS[biome])
        spec = data.DUNGEON_NPCS[biome]
    else:
        pool = data.ELITE_NPCS if elite else data.NPCS
        spec = _rng.choice(pool)
        npc = engine.npc_from_spec(spec)
    npc['personality'] = spec.get('personality', data.NPC_DEFAULT_PERSONALITY)
    npc['bluff'] = spec.get('bluff', data.NPC_DEFAULT_BLUFF)
    return _start_battle(table, sid, doc, 'elite' if elite else 'wild', npc,
                         node=doc.get('position'))
```

For `_barrier`: keep the `barrier_open` early-return; when a guardian fight is needed build `g = data.BARRIER_GUARDIANS[node]`, `npc = dict(g, **{'personality': g.get('personality','turtle'), 'bluff': g.get('bluff', 0.15)})` (guardians default turtle) and `return _start_battle(..., 'barrier', npc, node=node)`.

For `_lair`: compute `hp_pool, slain, vest_max, display` exactly as today, then `npc = dict(b, hp=hp_pool, name=display, maxHp=(vest_max if slain else b['hp']))` and `ctx = {'slain': slain, 'vestMax': vest_max}`; `return _start_battle(..., 'lair', npc, node=node, ctx=ctx)`.

For `_boss`: keep the sigil-seal early return; else `hp_before = _boss_hp(table, sid)`, `npc = dict(boss, hp=hp_before, maxHp=boss['hp'], personality='trickster', bluff=0.30)`, `ctx = {'hpBefore': hp_before}`; `return _start_battle(..., 'boss', npc, node=node, ctx=ctx)`.

Delete `_fixed_battle` once no caller remains (grep to confirm).

- [ ] **Step 2: Guard turn actions while a battle is pending**

Add a helper and call it at the top of the blocked handlers:

```python
def _battle_guard(doc):
    if doc.get('battle'):
        return _err('Finish your fight first.', 409)
    return None
```

Add `guard = _battle_guard(doc);  if guard: return guard` as the first line of `_roll`, `_move`, `_cast`, `_buy`, `_warp`, `_gamble`, `_trade`, `_dig`, `_strike`, `_vault_guess`, `_shrine`, `_evolve`, `_use_item`, `_attack_boss`, `_battle`, `_poke`. (Read-only/meta actions — `set-stance`, `spend-stat`, `customize`, `ack-events`, `respawn`, `equip-grimoire` — are not blocked.)

- [ ] **Step 3: Commit** (verified in Task 8)

```bash
git add infrastructure/lambda/undercity_db.py
git commit -m "feat(undercity): landings start interactive battles; block turn actions mid-fight"
```

---

## Task 8: Integration tests for the full battle flow

**Files:**
- Modify: `infrastructure/lambda/tests/test_undercity_db.py`

- [ ] **Step 1: Add helpers + rewrite the wild/elite battle tests**

The current battle tests stub `db.engine.resolve_battle` to a canned result (e.g. `monkeypatch.setattr(db.engine, 'resolve_battle', lambda *a, **k: {...})`). The new flow calls `resolve_round` per round instead, so stub *that* deterministically and start battles via `_start_battle` directly (no node-type lookup needed). `_sid`/`act` are the existing module helpers. Add these fixtures:

```python
_COUNTER = {'aggress': 'guard', 'guard': 'feint', 'feint': 'aggress'}

_FODDER = {'id': 'drudge_beetle', 'name': 'Drudge Beetle', 'hp': 6, 'atk': 3,
           'def': 0, 'spd': 1, 'bounty': 6, 'xp': 10, 'itemChance': 0.0,
           'personality': 'brute', 'bluff': 0.0}


def _begin(table, sid, kind='wild', npc=None, ctx=None):
    """Start a battle on the current player and persist it."""
    doc = db._get_player(table, sid, 'user-alex')
    ev = db._start_battle(table, sid, doc, kind, dict(npc or _FODDER),
                          node=doc.get('position'), ctx=ctx)
    db._put_player(table, doc)
    return ev


def _kill_npc(att, dfn, *a, **k):
    dfn.hp = 0
    return [{'round': k.get('rnd', 1), 'by': 'attacker', 'dmg': 99, 'winner': 'attacker'}]


def _kill_player(att, dfn, *a, **k):
    att.hp = 0
    return [{'round': 1, 'by': 'defender', 'dmg': 99, 'winner': 'defender'}]


def _noop_round(att, dfn, *a, **k):
    return []


def test_wild_battle_start_then_round_continues(table, monkeypatch):
    act(table, 'join', starter='kraul')
    sid = _sid(table)
    ev = _begin(table, sid)
    assert ev['type'] == 'battle_start' and ev['telegraph'] in data.STANCES
    monkeypatch.setattr(db.engine, 'resolve_round', _noop_round)  # nobody dies
    status, resp = act(table, 'combat-round', stance='aggress')
    assert status == 200
    assert resp['combat']['round'] == 2 and resp['combat']['telegraph'] in data.STANCES


def test_wild_battle_win_pays_rewards(table, monkeypatch):
    act(table, 'join', starter='kraul')
    sid = _sid(table)
    before = db._get_player(table, sid, 'user-alex').get('spores', 0)
    _begin(table, sid)
    monkeypatch.setattr(db.engine, 'resolve_round', _kill_npc)
    status, resp = act(table, 'combat-round', stance='aggress')
    assert status == 200
    se = resp['spaceEvent']
    assert se['battle']['outcome'] == 'attacker' and se['spores'] == _FODDER['bounty']
    doc = db._get_player(table, sid, 'user-alex')
    assert doc.get('battle') is None and doc['spores'] == before + _FODDER['bounty']


def test_wild_battle_loss_composts(table, monkeypatch):
    act(table, 'join', starter='kraul', home='cavern')
    sid = _sid(table)
    _begin(table, sid)
    monkeypatch.setattr(db.engine, 'resolve_round', _kill_player)
    status, resp = act(table, 'combat-round', stance='aggress')
    assert status == 200
    assert resp['spaceEvent']['battle']['outcome'] == 'defender'
    # composted back to a gate (mirrors old _wild_battle loss behavior)
    assert db._get_player(table, sid, 'user-alex').get('battle') is None
```

Then update the pre-existing battle tests that stub `resolve_battle` and assert on the landing response — `test_wild_win_surfaces_rewards`, `test_elite_battle_pulls_from_elite_pool`, `test_elite_space_resolves_to_elite_battle`, `test_death_offers_respawn_choice_and_respawn`, and the barrier/lair/boss tests — to the new flow: force the landing (or call `_begin(table, sid, kind, npc, ctx)`), stub `resolve_round` with `_kill_npc`/`_kill_player`, submit one `combat-round`, and assert on `resp['spaceEvent']`. For lair/boss pass the same `ctx` the starter builds (`{'slain': ..., 'vestMax': ...}` / `{'hpBefore': ...}`).

- [ ] **Step 2: New tests for the interactive-only mechanics**

```python
def test_battle_blocks_roll_and_move(table):
    act(table, 'join', starter='pest')
    sid = _sid(table)
    doc = db._get_player(table, sid, 'user-alex')
    db._start_battle(table, sid, doc, 'wild',
                     {'id': 'x', 'name': 'X', 'hp': 30, 'atk': 3, 'def': 0, 'spd': 1,
                      'bounty': 1, 'xp': 1, 'itemChance': 0.0,
                      'personality': 'brute', 'bluff': 0.0}, node=doc['position'])
    db._put_player(table, doc)
    status, _ = act(table, 'roll')
    assert status == 409
    status, _ = act(table, 'move', to='anywhere')
    assert status == 409


def test_combat_peek_reveals_true_intent_and_spends_item(table):
    act(table, 'join', starter='pest')
    sid = _sid(table)
    doc = db._get_player(table, sid, 'user-alex')
    doc['bag'] = ['scrying_spore']
    db._start_battle(table, sid, doc, 'wild',
                     {'id': 'x', 'name': 'X', 'hp': 30, 'atk': 3, 'def': 0, 'spd': 1,
                      'bounty': 1, 'xp': 1, 'itemChance': 0.0,
                      'personality': 'brute', 'bluff': 0.0}, node=doc['position'])
    db._put_player(table, doc)
    status, resp = act(table, 'combat-peek')
    assert status == 200
    assert resp['peek']['trueIntent'] == db._get_player(table, sid, 'user-alex')['battle']['npcActual']
    assert 'scrying_spore' not in db._get_player(table, sid, 'user-alex')['bag']


def test_combat_flee_escapes_and_clears_battle(table, monkeypatch):
    act(table, 'join', starter='stinkweed_imp' if False else 'pest')
    sid = _sid(table)
    doc = db._get_player(table, sid, 'user-alex')
    doc['spd'] = 20
    db._start_battle(table, sid, doc, 'wild',
                     {'id': 'x', 'name': 'X', 'hp': 30, 'atk': 3, 'def': 0, 'spd': 1,
                      'bounty': 1, 'xp': 1, 'itemChance': 0.0,
                      'personality': 'brute', 'bluff': 0.0}, node=doc['position'])
    db._put_player(table, doc)
    monkeypatch.setattr(db._rng, 'random', lambda: 0.01)   # flee succeeds
    status, resp = act(table, 'combat-flee')
    assert status == 200 and resp['combat']['fled'] is True
    assert db._get_player(table, sid, 'user-alex').get('battle') is None
```

Match `_first_node_of_type` / `_SeqRng` / `act` / `_sid` to the helpers that already exist in the test module; if a helper does not exist, add a minimal one alongside the existing fixtures rather than inventing an API.

- [ ] **Step 3: Run the DB suite with the committed map**

Combat tests must run against the committed map (the working-tree map edits break unrelated vein/vault tests — see Plan 1 notes). Verify combat tests specifically:

Run: `cd infrastructure/lambda && python -m pytest tests/test_undercity_db.py -k "battle or combat or wild or elite or barrier or lair or boss or peek or flee or respawn" -q`
Expected: PASS. (If the working-tree `map.json` lacks a node type a test needs, set `doc['position']` to a committed-map node of that type, as the pre-existing tests do.)

- [ ] **Step 4: Commit**

```bash
git add infrastructure/lambda/tests/test_undercity_db.py
git commit -m "test(undercity): interactive battle flow integration tests"
```

---

## Task 9: Personality + bluff on all NPC specs

**Files:**
- Modify: `infrastructure/lambda/undercity_data.py`
- Test: `infrastructure/lambda/tests/test_undercity_db.py` (a data-shape assertion)

- [ ] **Step 1: Annotate specs**

Add `'personality'` and `'bluff'` to each entry. Recommended starting values:
- `NPCS` (fodder): Drudge Beetle `brute`/0.0; Sewer Shambler `balanced`/0.0; Myconid `turtle`/0.0.
- `ELITE_NPCS`: Fetid Imp `trickster`/0.15; Rot Shambler `brute`/0.10.
- `DUNGEON_NPCS`: give each a personality fitting its biome; bluff 0.10.
- `BARRIER_GUARDIANS`: `turtle`/0.15.
- `LAIR_BOSSES`: personality per boss theme; bluff 0.20.
- `ROT_SOVEREIGN`: `trickster`/0.30.

Fodder without the fields still works (defaults), but annotate them so the client (Plan 3) can show a personality tell.

- [ ] **Step 2: Add a shape test**

```python
def test_all_battle_specs_have_valid_personality():
    import undercity_data as d
    specs = list(d.NPCS) + list(d.ELITE_NPCS) + list(d.DUNGEON_NPCS.values()) \
        + list(d.BARRIER_GUARDIANS.values()) + list(d.LAIR_BOSSES.values()) + [d.ROT_SOVEREIGN]
    for s in specs:
        p = s.get('personality', d.NPC_DEFAULT_PERSONALITY)
        assert p in d.STANCE_PERSONALITIES, s.get('name')
        assert 0.0 <= s.get('bluff', d.NPC_DEFAULT_BLUFF) <= 1.0
```

- [ ] **Step 3: Run + commit**

Run: `cd infrastructure/lambda && python -m pytest tests/test_undercity_engine.py tests/test_undercity_db.py -k "personality" -q`
Expected: PASS

```bash
git add infrastructure/lambda/undercity_data.py infrastructure/lambda/tests/test_undercity_db.py
git commit -m "feat(undercity): personality + bluff on all battle specs"
```

---

## Task 10: PvP fallback confirmation

**Files:**
- Verify only: `infrastructure/lambda/undercity_db.py` (`_battle`)

- [ ] **Step 1: Confirm PvP still resolves via the back-compat path**

`_battle` (PvP) already calls `engine.resolve_battle(atk_c, def_c, _rng)` (the Plan 1 back-compat wrapper). It must NOT go through the interactive machine. Confirm `_battle_guard` is applied (so you can't start a PvP fight mid-PvE-battle), but `_battle` itself does not create `doc['battle']`. No functional change; add a one-line comment in `_battle`:

```python
    # PvP stays one-shot (auto stances) — interactive combat is PvE-only (spec §7).
```

- [ ] **Step 2: Confirm the PvP test still passes**

Run: `cd infrastructure/lambda && python -m pytest tests/test_undercity_db.py -k "battle and pvp or _battle or attack" -q`
Expected: PASS (existing PvP test green).

- [ ] **Step 3: Commit**

```bash
git add infrastructure/lambda/undercity_db.py
git commit -m "docs(undercity): note PvP stays one-shot (interactive is PvE-only)"
```

---

## Task 11: Balance retune + regression invariant

**Files:**
- Modify: `infrastructure/lambda/undercity_data.py` (monster stats), possibly `undercity_engine.py` stance multipliers
- Test: `infrastructure/lambda/tests/test_undercity_db.py`

The triangle makes damage swingier and monster HP/stats were tuned for the old slugfest. This task sets a **defensible starting point** and locks in an **invariant** (not final balance — that needs playtest, which is Plan 3+).

- [ ] **Step 1: Add a regression invariant test**

Drive a low-level creature through a tier-appropriate wild, playing the *correct counter* to each (non-bluffing) telegraph, and assert a reliable win across seeds. Uses the real `resolve_round` (no stub) with a seeded `db._rng`:

```python
def _play_counter_battle(table, sid, npc):
    """Start a wild battle and each round submit the counter to the shown tell
    until it ends. Returns the final outcome string."""
    _begin(table, sid, 'wild', npc)
    for _ in range(data.MAX_ROUNDS_COMBAT):
        shown = db._get_player(table, sid, 'user-alex')['battle']['npcShown']
        status, resp = act(table, 'combat-round', stance=_COUNTER[shown])
        assert status == 200, resp
        if 'spaceEvent' in resp:
            return resp['spaceEvent']['battle']['outcome']
    raise AssertionError('battle did not end within the round cap')


def test_balance_good_play_beats_fodder(table, monkeypatch):
    import random
    wins = 0
    for seed in range(20):
        monkeypatch.setattr(db, '_rng', random.Random(seed))
        act(table, 'join', starter='kraul')          # fresh mid creature each seed
        sid = _sid(table)
        outcome = _play_counter_battle(table, sid, dict(_FODDER, bluff=0.0))
        wins += 1 if outcome == 'attacker' else 0
    assert wins >= 18   # good play wins ~90%+ vs fodder
```

`act(table, 'join', ...)` on an already-joined user must be idempotent or re-seed per seed; if `join` rejects a repeat, create a fresh `table` per iteration instead (mirror whatever the existing tests do for repeat joins). Keep the assertion a floor (≥18/20), not an exact count, so tuning tweaks don't break it.

- [ ] **Step 2: Tune to satisfy the invariant**

Adjust `NPCS`/`ELITE_NPCS`/`DUNGEON_NPCS` HP and `STANCE_*` multipliers (in `undercity_data.py`) until the invariant passes with comfortable margin and a hand-run of a few battles lands in the 3–6 round range (log a couple with a scratch script; do not commit the script). Document the chosen numbers with a comment: `# balance starting point 2026-07-14 — revisit after playtest`.

- [ ] **Step 3: Run the invariant + full engine/db combat tests**

Run: `cd infrastructure/lambda && python -m pytest tests/test_undercity_db.py -k "balance or combat or battle" tests/test_undercity_engine.py -q`
Expected: PASS

- [ ] **Step 4: Commit**

```bash
git add infrastructure/lambda/undercity_data.py infrastructure/lambda/undercity_engine.py infrastructure/lambda/tests/test_undercity_db.py
git commit -m "balance(undercity): starting-point combat retune + win-rate invariant"
```

---

## Task 12: Full-suite regression + dead-code sweep

**Files:**
- Verify: whole `infrastructure/lambda` package.

- [ ] **Step 1: Confirm removed helpers have no references**

Run: `cd infrastructure/lambda && grep -rn "_fixed_battle\|resolve_battle(" . --include=*.py`
Expected: `_fixed_battle` gone; `resolve_battle(` only in `_battle` (PvP) and the engine back-compat definition/tests.

- [ ] **Step 2: Full suite against the committed map**

Combat is map-agnostic but several DB tests hardcode node ids. Run against the committed map to get a clean signal (stash working-tree map edits, per Plan 1's method):

```bash
cd "a:/Coding/game-day-site" && git stash push -q infrastructure/lambda/map.json public/data/undercity-map.json -m "temp: clean-map test run"
cd infrastructure/lambda && python -m pytest tests -q
cd "a:/Coding/game-day-site" && git stash pop -q
```

Expected: the entire suite passes (the only allowed pre-existing failures are ones tied to the user's uncommitted map redesign, which the stash removes — so with it stashed, expect 0 failures).

- [ ] **Step 3: Commit any cleanup**

```bash
git add -A infrastructure/lambda
git commit -m "chore(undercity): remove _fixed_battle; final Plan 2 regression"
```

---

## Task 13: Combat authoring reference doc

**Files:**
- Create: `specs/undercity-combat.md`
- Modify: `CLAUDE.md` (add a pointer, next to the existing spells-reference bullet)

A living reference — modeled on the existing `specs/undercity-spells.md` — so adding a new enemy, piece of equipment, or effect is a fast, checklist-driven edit rather than a code archaeology dig. Write it **last**, from the code as actually built, so it is accurate (not from this plan's projected shape).

- [ ] **Step 1: Write `specs/undercity-combat.md`** covering, with real symbol names and file/line references as they exist post-implementation:

  1. **Model overview** — the stance triangle (who-beats-whom), how magnitude comes from `_base_hit` × `STANCE_*` multipliers, rot/swarm, the round loop, telegraph/bluff, timeout-by-HP%. One diagram/table of the matchup outcomes.
  2. **Effect-kind vocabulary** — the four levers and where each lives:
     - **Creature passives** (`undercity_data.py` form specs → `Combatant.passives` → branches in `resolve_round`)
     - **Gear riders** (`GEAR[*].rider` + `GEAR_RIDERS` → `Combatant.riders` → `resolve_round`)
     - **Spell-buffs** (`SPELLS`/`buffs` → `Combatant.buffs` → `resolve_round` + `effective_stats`)
     - **Combat consumables** (`CONSUMABLES[*].combat/effect` → `_COMBAT_ITEM` → `resolve_round` round-modifiers)
     Note the exact hook point for each so an author knows which function to touch.
  3. **Add-an-enemy checklist** — append a spec to the right table (`NPCS`/`ELITE_NPCS`/`DUNGEON_NPCS`/`BARRIER_GUARDIANS`/`LAIR_BOSSES`), required fields (`hp/atk/def/spd/bounty/xp/itemChance/personality/bluff`), how it enters battle (which starter routes it), how rewards resolve (which `_finish_*`), and the balance invariant test to update. Include a copy-paste template dict.
  4. **Add-equipment checklist** — a `GEAR` entry (slot ∈ fang/carapace/charm, stats, `rider`) and, if it needs a new rider, the `GEAR_RIDERS` entry + the `resolve_round` branch + a rider unit test. Copy-paste templates + the TS display-mirror pointer (filled in by Plan 3).
  5. **Add-an-effect checklist** — three sub-recipes: a new **passive** (form spec + `resolve_round` hook + test), a new **buff** (`SPELLS` + `ONE_BATTLE_BUFFS` + `resolve_round`/`effective_stats` hook + test), a new **combat consumable** (`CONSUMABLES` + `_COMBAT_ITEM` + engine round-modifier if novel + test).
  6. **Invariants** — no effect may reduce HP below the documented floors; balance numbers are mirrored in `src/app/undercity/data/*.ts` (Plan 3); the pytest suite must stay green; combat is PvE-only (PvP is one-shot).
  7. **Tuning knobs** — the `STANCE_*`, `ROT_*`, `SWARM_*`, `*_BLUFF`, `STANCE_PERSONALITIES` constants, what each does, and the balance-invariant test that guards them.

- [ ] **Step 2: Add a pointer in `CLAUDE.md`**

Under the Undercity section's Spells bullet, add:

```markdown
- **Combat:** stance-triangle model + add-an-enemy / add-equipment / add-an-effect checklists in [specs/undercity-combat.md](specs/undercity-combat.md).
```

- [ ] **Step 3: Verify the doc's references resolve**

Spot-check every file/symbol the doc names still exists (grep a handful): `resolve_round`, `GEAR_RIDERS`, `_COMBAT_ITEM`, `STANCE_PERSONALITIES`, `_finish_wild`. Fix any drift.

- [ ] **Step 4: Commit**

```bash
git add specs/undercity-combat.md CLAUDE.md
git commit -m "docs(undercity): combat authoring reference (add enemy/equipment/effect)"
```

---

## Done criteria (Plan 2)

- Landing on wild/elite/barrier/lair/boss returns a `battle_start` with a telegraph; `combat-round` drives it a round at a time; rewards apply only on end via `_finish_battle`.
- `combat-peek` (reveal), `combat-flee`, and the three combat consumables work and are tested.
- Monsters draw stances from personality weights and telegraph with a bluff chance.
- Charm slot equips; gear riders + buffs flow into `Combatant` in real battles.
- PvP unchanged (one-shot auto).
- Full lambda suite green against the committed map.
- `specs/undercity-combat.md` exists with accurate add-an-enemy / add-equipment / add-an-effect checklists, linked from `CLAUDE.md`.

## Follow-on: Plan 3 (client)

Interactive round loop in `battle-playback.component` (render telegraph + personality tell, three stance buttons + flee + usable consumables + peek, submit `combat-round`, animate `entries`, repeat), charm slot in the creature/gear UI, and the `src/app/undercity/data/*.ts` display mirrors for the new gear/riders/consumables/personalities.
