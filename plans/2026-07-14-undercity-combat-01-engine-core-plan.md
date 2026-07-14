# Undercity Combat Redesign — Plan 1: Engine Core

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Replace the flat stat-slugfest combat resolver with a pure, per-round **stance-triangle** rules engine (Aggress/Guard/Feint) where stats set exchange magnitude, gear riders + creature passives + spell-buffs layer on, and a full battle can be run from stance-picking policies — all deterministic and unit-tested, with **no I/O and no client changes**.

**Architecture:** Everything in this plan lives in `infrastructure/lambda/undercity_engine.py` (logic) and `undercity_data.py` (tuning constants + gear/consumable data), verified by `infrastructure/lambda/tests/test_undercity_engine.py`. The core primitive is `resolve_round(attacker, defender, a_stance, d_stance, rnd, rng)`, which resolves ONE round and mutates the combatants. A thin `resolve_battle_rounds(...)` runner drives it from two stance-picker callables. The existing `resolve_battle(attacker, defender, rng)` is retained as a back-compat wrapper (maps old `fight`/`defend`/`flee` stances onto the new model) so `undercity_db.py` call sites keep working until Plan 2 rewires PvE to be interactive.

**Tech Stack:** Python 3.11, pytest. No boto3, no clocks, no global randomness (injected `rng` with `.uniform/.random/.randint/.choice`).

**Reference spec:** `specs/2026-07-14-undercity-combat-redesign-design.md` (§1 triangle, §2 gear riders, §4 buffs/consumables, §5 passive remap).

**Out of scope for Plan 1:** monster AI/telegraph/bluff, the DB round-driven state machine, the API, the client UI, the charm-slot UI, and final balance tuning. Those are Plans 2–3.

---

## File Structure

- **Modify `infrastructure/lambda/undercity_data.py`**
  - Add combat tuning constants (stance multipliers, rot/swarm/scavenge numbers).
  - Add gear `rider` tags + the new `charm` slot gear entries.
  - Add combat `CONSUMABLES` entries (mind-game tools) — data only; effects consumed by Plan 2.
- **Modify `infrastructure/lambda/undercity_engine.py`**
  - Extend `Combatant` with per-battle state (`rot_stacks`, `first_win_used`, `dmg_penalty`, `reveal_next`, `riders`, `buffs`).
  - Add `STANCES`, `exchange_winner`, `_base_hit`, `resolve_round`, `resolve_battle_rounds`, `flee_attempt`.
  - Rewrite `resolve_battle` as a back-compat wrapper over the new runner.
  - Keep `flee_chance`, `pvp_spore_steal`, `effective_stats`, and all movement/leveling code untouched.
- **Modify `infrastructure/lambda/tests/test_undercity_engine.py`**
  - Add the triangle outcome matrix, rider tests, passive-remap tests, buff tests, flee test, full-battle runner tests. Keep every existing test green.

---

## Task 1: Combat tuning constants + stance vocabulary

**Files:**
- Modify: `infrastructure/lambda/undercity_data.py` (append a new "Combat tuning" block near the other combat constants)

- [ ] **Step 1: Add the constants**

Append after the existing `GEAR`/`CONSUMABLES`/`BAG_SIZE` block (around line 168):

```python
# ── Combat: stance triangle tuning (spec 2026-07-14 §1) ──────────────────────
# The triangle decides who wins an exchange; ATK/DEF set the magnitude. A "hit"
# is max(1, round(atk * uniform(0.85,1.15)) - effective_def); the multipliers
# below scale that hit per matchup. Starting values — balance pass is Plan 2/3.
STANCES = ('aggress', 'guard', 'feint')

STANCE_WIN_MULT       = 1.5   # decisive winner (A>F, F>G) deals hit * this
STANCE_GUARD_MITIGATE = 0.4   # aggressor's hit when Guard wins (G>A)
STANCE_GUARD_COUNTER  = 0.6   # guard's counter hit when Guard wins (G>A)
STANCE_CLASH_MULT     = 1.0   # both sides on A-vs-A
STANCE_STALL_MULT     = 0.15  # both sides on G-vs-G
# F-vs-F is a whiff: no damage either way.

ROT_PER_STACK   = 2   # damage per rot stack, ticked at end of each round
SWARM_CHIP_MULT = 0.5 # swarm: extra hit each round = hit * this (min 1)
SCAVENGE_RETALIATE = 2  # scavenge: damage dealt back when you LOSE an exchange
DEATHTOUCH_PIERCE  = 3  # deathtouch_stomp: Aggress reduces target eff-DEF by this
FLYBY_DODGE        = 0.25  # chance to dodge the punish when you LOSE an exchange
VENOM_BARB_BONUS   = 3   # first winning exchange +this
FIRST_WIN_ROT_BREATH_MULT = 2  # rot_breath: first winning exchange * this

MAX_ROUNDS_COMBAT = 6  # round cap; higher HP% wins a timeout
```

- [ ] **Step 2: Verify it imports**

Run: `cd infrastructure/lambda && python -c "import undercity_data as d; print(d.STANCES, d.STANCE_WIN_MULT)"`
Expected: `('aggress', 'guard', 'feint') 1.5`

- [ ] **Step 3: Commit**

```bash
git add infrastructure/lambda/undercity_data.py
git commit -m "feat(undercity): combat stance-triangle tuning constants"
```

---

## Task 2: Gear riders + charm slot + combat consumables (data only)

**Files:**
- Modify: `infrastructure/lambda/undercity_data.py` (`GEAR`, `CONSUMABLES`)

- [ ] **Step 1: Add `rider` tags to existing gear and add charm-slot gear**

Replace the `GEAR` dict (lines ~151-158) with:

```python
GEAR = {
    # Fang — Aggress riders
    'rusted_fang':  {'name': 'Rusted Fang',  'slot': 'fang', 'tier': 1, 'cost': 20, 'atk': 2, 'rider': 'barbed'},
    'kraul_barb':   {'name': 'Kraul Barb',   'slot': 'fang', 'tier': 2, 'cost': 45, 'atk': 4, 'rider': 'deep_biter'},
    'wurm_tooth':   {'name': 'Wurm Tooth',   'slot': 'fang', 'tier': 3, 'cost': 80, 'atk': 6, 'spd': 1, 'rider': 'deep_biter'},
    # Carapace — Guard riders
    'chitin_scrap': {'name': 'Chitin Scrap', 'slot': 'carapace', 'tier': 1, 'cost': 20, 'def': 2, 'rider': 'thick'},
    'bark_hide':    {'name': 'Bark Hide',    'slot': 'carapace', 'tier': 2, 'cost': 45, 'def': 4, 'rider': 'spiked'},
    'troll_hide':   {'name': 'Troll Hide',   'slot': 'carapace', 'tier': 3, 'cost': 80, 'def': 5, 'maxHp': 6, 'rider': 'spiked'},
    # Charm — Feint riders (new slot; light on raw stats, value is the rider)
    'quartz_charm':   {'name': 'Quartz Charm',   'slot': 'charm', 'tier': 1, 'cost': 20, 'spd': 1, 'rider': 'trickster'},
    'serrated_charm': {'name': 'Serrated Charm', 'slot': 'charm', 'tier': 2, 'cost': 45, 'spd': 1, 'rider': 'serrated'},
    'glint_charm':    {'name': 'Glint Charm',    'slot': 'charm', 'tier': 3, 'cost': 80, 'spd': 2, 'rider': 'glint'},
}

# Rider → the stance it modifies + a human blurb (client reads this in Plan 3).
GEAR_RIDERS = {
    'barbed':    {'stance': 'aggress', 'blurb': 'Your Aggress applies rot even on a clash or loss.'},
    'deep_biter':{'stance': 'aggress', 'blurb': 'Winning exchanges hit harder; nothing on a loss.'},
    'thick':     {'stance': 'guard',   'blurb': 'Your Guard chips in a stall and softens being wrong.'},
    'spiked':    {'stance': 'guard',   'blurb': 'Your Guard counter reflects part of the blocked hit.'},
    'trickster': {'stance': 'feint',   'blurb': 'A lost Feint is not fully punished.'},
    'serrated':  {'stance': 'feint',   'blurb': 'Your Feint break lowers the enemy next-round damage.'},
    'glint':     {'stance': 'feint',   'blurb': 'Winning a Feint reveals the enemy true next intent.'},
}
```

- [ ] **Step 2: Add combat consumables to `CONSUMABLES`**

Add these entries to the existing `CONSUMABLES` dict (keep the existing 4):

```python
    'scrying_spore': {'name': 'Scrying Spore', 'cost': 20, 'combat': True,
                      'effect': 'reveal', 'blurb': 'In battle: reveal the enemy true intent this round.'},
    'rot_bomb':      {'name': 'Rot Bomb', 'cost': 22, 'combat': True,
                      'effect': 'double_punish', 'blurb': 'In battle: double your damage if you win this round.'},
    'chitin_ward':   {'name': 'Chitin Ward', 'cost': 22, 'combat': True,
                      'effect': 'negate', 'blurb': 'In battle: cancel the punish from one wrong guess.'},
    'ambush_musk':   {'name': 'Ambush Musk', 'cost': 25, 'combat': True,
                      'effect': 'auto_win', 'blurb': 'In battle: win one exchange regardless of choices.'},
```

- [ ] **Step 3: Verify**

Run: `cd infrastructure/lambda && python -c "import undercity_data as d; print([g['slot'] for g in d.GEAR.values()]); print(len(d.GEAR_RIDERS)); print([k for k,v in d.CONSUMABLES.items() if v.get('combat')])"`
Expected: nine slots incl. three `'charm'`; `7`; the four combat consumable ids.

- [ ] **Step 4: Commit**

```bash
git add infrastructure/lambda/undercity_data.py
git commit -m "feat(undercity): gear riders, charm slot, combat consumables (data)"
```

---

## Task 3: Extend `Combatant` with per-battle state

**Files:**
- Modify: `infrastructure/lambda/undercity_engine.py:22-39` (the `Combatant` dataclass)

- [ ] **Step 1: Add fields**

Replace the `Combatant` dataclass (lines 22-39) with (keeping every existing field):

```python
@dataclass
class Combatant:
    name: str
    hp: int
    max_hp: int
    atk: int
    dfn: int
    spd: int
    passives: frozenset = frozenset()
    stance: str = 'fight'          # legacy pre-battle stance (back-compat only)
    level: int = 1
    has_smoke_spore: bool = False
    flee_bonus: int = 0            # home-biome perk (Glowblessed: +10)
    riders: frozenset = frozenset()   # gear rider tags (barbed, spiked, glint, ...)
    buffs: frozenset = frozenset()    # active stance-modifier buff kinds
    # internal battle state (mutated during a battle)
    rot_stacks: int = field(default=0, repr=False)
    first_win_used: bool = field(default=False, repr=False)
    dmg_penalty: int = field(default=0, repr=False)   # -damage on NEXT round (serrated)
    reveal_next: bool = field(default=False, repr=False)  # glint set a reveal
    struck_yet: bool = field(default=False, repr=False)

    def has(self, passive):
        return passive in self.passives

    def has_rider(self, rider):
        return rider in self.riders

    def has_buff(self, kind):
        return kind in self.buffs
```

- [ ] **Step 2: Verify existing tests still import/run**

Run: `cd infrastructure/lambda && python -m pytest tests/test_undercity_engine.py -q`
Expected: PASS (the added fields are optional; `resolve_battle` untouched so far).

- [ ] **Step 3: Commit**

```bash
git add infrastructure/lambda/undercity_engine.py
git commit -m "refactor(undercity): Combatant carries per-battle stance state"
```

---

## Task 4: The stance triangle — `exchange_winner`

**Files:**
- Modify: `infrastructure/lambda/undercity_engine.py` (add after `flee_chance`, ~line 45)
- Test: `infrastructure/lambda/tests/test_undercity_engine.py`

- [ ] **Step 1: Write the failing test**

Add to the test file:

```python
from undercity_engine import exchange_winner

def test_exchange_triangle():
    # decisive matchups
    assert exchange_winner('aggress', 'feint') == 'attacker'
    assert exchange_winner('feint', 'aggress') == 'defender'
    assert exchange_winner('feint', 'guard') == 'attacker'
    assert exchange_winner('guard', 'feint') == 'defender'
    assert exchange_winner('guard', 'aggress') == 'attacker'
    assert exchange_winner('aggress', 'guard') == 'defender'
    # mirrors
    assert exchange_winner('aggress', 'aggress') == 'clash'
    assert exchange_winner('guard', 'guard') == 'stall'
    assert exchange_winner('feint', 'feint') == 'whiff'
```

- [ ] **Step 2: Run it, verify failure**

Run: `cd infrastructure/lambda && python -m pytest tests/test_undercity_engine.py::test_exchange_triangle -v`
Expected: FAIL — `ImportError: cannot import name 'exchange_winner'`

- [ ] **Step 3: Implement**

Add to `undercity_engine.py` after `flee_chance`:

```python
# ── Stance triangle (spec 2026-07-14 §1) ─────────────────────────────────────
# Aggress beats Feint, Feint beats Guard, Guard beats Aggress. Returns the side
# that WINS the exchange ('attacker'|'defender') or the mirror kind.
_BEATS = {('aggress', 'feint'), ('feint', 'guard'), ('guard', 'aggress')}
_MIRROR = {'aggress': 'clash', 'guard': 'stall', 'feint': 'whiff'}


def exchange_winner(a_stance: str, d_stance: str) -> str:
    if a_stance == d_stance:
        return _MIRROR[a_stance]
    if (a_stance, d_stance) in _BEATS:
        return 'attacker'
    return 'defender'
```

- [ ] **Step 4: Run, verify pass**

Run: `cd infrastructure/lambda && python -m pytest tests/test_undercity_engine.py::test_exchange_triangle -v`
Expected: PASS

- [ ] **Step 5: Commit**

```bash
git add infrastructure/lambda/undercity_engine.py infrastructure/lambda/tests/test_undercity_engine.py
git commit -m "feat(undercity): stance triangle exchange_winner"
```

---

## Task 5: Base hit + `resolve_round` (magnitude, no riders/passives yet)

**Files:**
- Modify: `infrastructure/lambda/undercity_engine.py`
- Test: `infrastructure/lambda/tests/test_undercity_engine.py`

The `_effective_def` helper stays but drops the legacy `defend` branch (kept only `deathtouch_stomp`, and we now pass a pierce flag). We add `_base_hit` and `resolve_round`.

- [ ] **Step 1: Write the failing tests**

```python
from undercity_engine import resolve_round
import undercity_data as data

def test_round_aggress_beats_feint_full_punish():
    # uniform=1.0 so hit = round(atk*1.0) - def; atk10 vs def4 => 6, *WIN_MULT 1.5 => 9
    a = fighter(atk=10, dfn=5, spd=5)
    d = fighter(atk=10, dfn=4, spd=5, hp=30, max_hp=30)
    rng = FakeRng(uniform=1.0)
    entries = resolve_round(a, d, 'aggress', 'feint', 1, rng)
    assert d.hp == 30 - round(6 * data.STANCE_WIN_MULT)   # 30 - 9 = 21
    assert a.hp == 30                                       # feinter dealt nothing
    assert any(e.get('winner') == 'attacker' for e in entries)

def test_round_guard_beats_aggress_mitigate_and_counter():
    a = fighter(atk=10, dfn=5, spd=5, hp=30, max_hp=30)   # aggressor
    d = fighter(atk=10, dfn=5, spd=5, hp=30, max_hp=30)   # guard
    rng = FakeRng(uniform=1.0)
    resolve_round(a, d, 'aggress', 'guard', 1, rng)
    # aggressor hit 10-5=5, mitigated *0.4 => 2 to guard
    assert d.hp == 30 - round(5 * data.STANCE_GUARD_MITIGATE)  # 30 - 2 = 28
    # guard counters 10-5=5 *0.6 => 3 to aggressor
    assert a.hp == 30 - round(5 * data.STANCE_GUARD_COUNTER)   # 30 - 3 = 27

def test_round_clash_both_take_full():
    a = fighter(atk=10, dfn=5, hp=30, max_hp=30, spd=6)
    d = fighter(atk=10, dfn=5, hp=30, max_hp=30, spd=5)
    rng = FakeRng(uniform=1.0)
    resolve_round(a, d, 'aggress', 'aggress', 1, rng)
    assert a.hp == 25 and d.hp == 25   # both 10-5=5 full

def test_round_whiff_nobody_hit():
    a = fighter(hp=30, max_hp=30); d = fighter(hp=30, max_hp=30)
    resolve_round(a, d, 'feint', 'feint', 1, FakeRng(uniform=1.0))
    assert a.hp == 30 and d.hp == 30
```

- [ ] **Step 2: Run, verify failure**

Run: `cd infrastructure/lambda && python -m pytest tests/test_undercity_engine.py -k "round_" -v`
Expected: FAIL — `cannot import name 'resolve_round'`

- [ ] **Step 3: Implement**

Replace `_effective_def` (lines 47-53) with:

```python
def _effective_def(target: Combatant, pierce: int = 0) -> int:
    return max(0, target.dfn - pierce)
```

Add after `exchange_winner`:

```python
def _base_hit(striker: Combatant, target: Combatant, rng, pierce: int = 0) -> int:
    """The raw ATK-vs-DEF hit before stance multipliers. Floors at 1."""
    swing = round(striker.atk * rng.uniform(0.85, 1.15))
    return max(1, swing - _effective_def(target, pierce))


def _deal(striker, target, side, rnd, raw, mult, entries, tag=None):
    """Apply round(raw*mult) damage striker->target; log an entry; drain_life."""
    dmg = max(0, round(raw * mult))
    if dmg <= 0:
        return
    target.hp -= dmg
    entry = {'round': rnd, 'by': side, 'dmg': dmg}
    if tag:
        entry[tag] = True
    if striker.has('drain_life'):
        heal = round(dmg * 0.5)
        striker.hp = min(striker.max_hp, striker.hp + heal)
        entry['heal'] = heal
    entries.append(entry)


def resolve_round(attacker, defender, a_stance, d_stance, rnd, rng) -> list:
    """
    Resolve ONE round given both stances. Mutates both combatants (hp only in
    this task; riders/passives/rot added in later tasks). Returns a list of log
    entries. Damage magnitude comes from _base_hit; the triangle picks who
    lands the amplified hit.
    """
    entries = []
    winner = exchange_winner(a_stance, d_stance)
    entries.append({'round': rnd, 'winner': winner,
                    'aStance': a_stance, 'dStance': d_stance})

    if winner == 'attacker':
        raw = _base_hit(attacker, defender, rng)
        _deal(attacker, defender, 'attacker', rnd, raw, data.STANCE_WIN_MULT, entries)
    elif winner == 'defender':
        raw = _base_hit(defender, attacker, rng)
        _deal(defender, attacker, 'defender', rnd, raw, data.STANCE_WIN_MULT, entries)
    elif winner == 'clash':
        # A-vs-A: both strike full; SPD-first lands first (matters for a kill).
        first = 'attacker' if attacker.spd >= defender.spd else 'defender'
        order = [first, 'defender' if first == 'attacker' else 'attacker']
        for side in order:
            s, t = ((attacker, defender) if side == 'attacker'
                    else (defender, attacker))
            if s.hp <= 0:
                continue
            raw = _base_hit(s, t, rng)
            _deal(s, t, side, rnd, raw, data.STANCE_CLASH_MULT, entries)
    elif winner == 'stall':
        # G-vs-G: chip only.
        for side, (s, t) in (('attacker', (attacker, defender)),
                             ('defender', (defender, attacker))):
            raw = _base_hit(s, t, rng)
            _deal(s, t, side, rnd, raw, data.STANCE_STALL_MULT, entries)
    # whiff: nothing.
    return entries
```

Note: the guard-wins branch (mitigate + counter) is NOT the generic `winner=='defender'` path — a Guard beating an Aggress is a `'defender'` win by the triangle, but needs the two-part mitigate/counter. Fix the `defender`/`attacker` branches to special-case a guarding winner:

Replace the `if winner == 'attacker'` / `elif winner == 'defender'` block with:

```python
    if winner in ('attacker', 'defender'):
        win_side = winner
        lose_side = 'defender' if winner == 'attacker' else 'attacker'
        winr, losr = ((attacker, defender) if winner == 'attacker'
                      else (defender, attacker))
        win_stance = a_stance if winner == 'attacker' else d_stance
        if win_stance == 'guard':
            # Guard beats Aggress: aggressor's hit is mitigated, guard counters.
            raw_agg = _base_hit(losr, winr, rng)
            _deal(losr, winr, lose_side, rnd, raw_agg,
                  data.STANCE_GUARD_MITIGATE, entries, tag='mitigated')
            raw_ctr = _base_hit(winr, losr, rng)
            _deal(winr, losr, win_side, rnd, raw_ctr,
                  data.STANCE_GUARD_COUNTER, entries, tag='counter')
        else:
            raw = _base_hit(winr, losr, rng)
            _deal(winr, losr, win_side, rnd, raw, data.STANCE_WIN_MULT, entries)
    elif winner == 'clash':
```

- [ ] **Step 4: Run, verify pass**

Run: `cd infrastructure/lambda && python -m pytest tests/test_undercity_engine.py -k "round_" -v`
Expected: PASS (all four)

- [ ] **Step 5: Commit**

```bash
git add infrastructure/lambda/undercity_engine.py infrastructure/lambda/tests/test_undercity_engine.py
git commit -m "feat(undercity): resolve_round stance-triangle magnitude"
```

---

## Task 6: Rot DoT + swarm chip + end-of-round tick

**Files:**
- Modify: `infrastructure/lambda/undercity_engine.py` (`resolve_round`)
- Test: `infrastructure/lambda/tests/test_undercity_engine.py`

- [ ] **Step 1: Write the failing tests**

```python
def test_swarm_adds_chip_each_round():
    a = fighter(atk=10, dfn=5, hp=30, max_hp=30, passives=frozenset({'swarm'}))
    d = fighter(atk=10, dfn=5, hp=30, max_hp=30)
    resolve_round(a, d, 'feint', 'feint', 1, FakeRng(uniform=1.0))  # whiff
    # whiff deals nothing, but swarm chips: hit 10-5=5 * 0.5 => 3 (min 1)
    assert d.hp == 30 - max(1, round(5 * data.SWARM_CHIP_MULT))  # 30 - 3 = 27

def test_rot_stacks_tick_end_of_round():
    a = fighter(hp=30, max_hp=30); d = fighter(hp=30, max_hp=30)
    d.rot_stacks = 2
    resolve_round(a, d, 'feint', 'feint', 1, FakeRng(uniform=1.0))
    assert d.hp == 30 - 2 * data.ROT_PER_STACK  # 30 - 4 = 26
```

- [ ] **Step 2: Run, verify failure**

Run: `cd infrastructure/lambda && python -m pytest tests/test_undercity_engine.py -k "swarm or rot_stacks" -v`
Expected: FAIL (swarm chip / rot tick not applied)

- [ ] **Step 3: Implement**

At the END of `resolve_round`, just before `return entries`, add (order matters — the rot **tick** must run before any newly-applied rot in Task 8, so fresh stacks don't tick the same round):

```python
    # Swarm: one extra chip hit per round regardless of stance.
    for side, (s, t) in (('attacker', (attacker, defender)),
                         ('defender', (defender, attacker))):
        if s.has('swarm') and s.hp > 0 and t.hp > 0:
            raw = _base_hit(s, t, rng)
            _deal(s, t, side, rnd, raw, data.SWARM_CHIP_MULT, entries, tag='swarm')

    # Rot DoT ticks at end of round.
    for side, c in (('attacker', attacker), ('defender', defender)):
        if c.rot_stacks > 0 and c.hp > 0:
            tick = c.rot_stacks * data.ROT_PER_STACK
            c.hp -= tick
            entries.append({'round': rnd, 'by': side, 'dmg': tick, 'rot': True})
```

Note `_deal` uses `max(0, round(raw*mult))`; SWARM at 0.5 of a 5 hit = round(2.5)=2. To honor "min 1" for swarm, change the swarm `_deal` call to floor at 1 by passing raw already floored: replace the swarm loop's `_deal(...)` with an explicit floor:

```python
        if s.has('swarm') and s.hp > 0 and t.hp > 0:
            chip = max(1, round(_base_hit(s, t, rng) * data.SWARM_CHIP_MULT))
            t.hp -= chip
            entry = {'round': rnd, 'by': side, 'dmg': chip, 'swarm': True}
            if s.has('drain_life'):
                heal = round(chip * 0.5)
                s.hp = min(s.max_hp, s.hp + heal); entry['heal'] = heal
            entries.append(entry)
```

(Recompute the test expectation: base hit 10-5=5, *0.5=2.5, round=2, but max(1,2)=2 — wait, round(2.5)=2 in banker's rounding. Update the test to `28`? No: Python `round(2.5)==2`. Set the test to `30 - 2 = 28`.)

Fix the test in Step 1 to:

```python
    assert d.hp == 28  # swarm chip: round(5*0.5)=2
```

- [ ] **Step 4: Run, verify pass**

Run: `cd infrastructure/lambda && python -m pytest tests/test_undercity_engine.py -k "swarm or rot_stacks" -v`
Expected: PASS

- [ ] **Step 5: Commit**

```bash
git add infrastructure/lambda/undercity_engine.py infrastructure/lambda/tests/test_undercity_engine.py
git commit -m "feat(undercity): rot DoT tick + swarm chip in resolve_round"
```

---

## Task 7: Passive remap — first_bite, rot_breath, venom_barb, scavenge, deathtouch, flyby

**Files:**
- Modify: `infrastructure/lambda/undercity_engine.py` (`resolve_round`, `_base_hit`, `_deal`)
- Test: `infrastructure/lambda/tests/test_undercity_engine.py`

Behaviors (spec §5):
- `first_bite`: wins the SPD order in an A-vs-A clash (strikes first regardless of SPD).
- `rot_breath`: first WINNING exchange deals `* FIRST_WIN_ROT_BREATH_MULT`.
- `venom_barb`: first WINNING exchange deals `+ VENOM_BARB_BONUS`.
- `deathtouch_stomp`: a winning **Aggress** pierces `DEATHTOUCH_PIERCE` of target DEF.
- `scavenge`: when you LOSE an exchange (take the punish), retaliate `SCAVENGE_RETALIATE`.
- `flyby`: `FLYBY_DODGE` chance to negate the punish you'd take on an exchange loss.

- [ ] **Step 1: Write the failing tests**

```python
def test_venom_barb_first_win_bonus_once():
    a = fighter(atk=10, dfn=5, hp=30, max_hp=30, passives=frozenset({'venom_barb'}))
    d = fighter(atk=10, dfn=4, hp=60, max_hp=60)
    rng = FakeRng(uniform=1.0)
    resolve_round(a, d, 'aggress', 'feint', 1, rng)   # win: 6*1.5=9 +3 =12
    assert d.hp == 60 - (round(6 * data.STANCE_WIN_MULT) + data.VENOM_BARB_BONUS)
    assert a.first_win_used
    hp_after_first = d.hp
    resolve_round(a, d, 'aggress', 'feint', 2, rng)   # no bonus second time: 9
    assert d.hp == hp_after_first - round(6 * data.STANCE_WIN_MULT)

def test_rot_breath_first_win_doubles():
    a = fighter(atk=10, dfn=5, hp=30, max_hp=30, passives=frozenset({'rot_breath'}))
    d = fighter(atk=10, dfn=4, hp=60, max_hp=60)
    resolve_round(a, d, 'feint', 'guard', 1, FakeRng(uniform=1.0))  # feint>guard win
    # base 6*1.5=9, *2 => 18
    assert d.hp == 60 - round(6 * data.STANCE_WIN_MULT) * data.FIRST_WIN_ROT_BREATH_MULT

def test_scavenge_retaliates_on_loss():
    a = fighter(atk=10, dfn=5, hp=30, max_hp=30)                       # winner
    d = fighter(atk=10, dfn=5, hp=30, max_hp=30, passives=frozenset({'scavenge'}))
    resolve_round(a, d, 'aggress', 'feint', 1, FakeRng(uniform=1.0))   # d loses
    assert a.hp == 30 - data.SCAVENGE_RETALIATE   # d retaliates 2

def test_flyby_dodges_the_punish():
    a = fighter(atk=10, dfn=5, hp=30, max_hp=30)
    d = fighter(atk=10, dfn=5, hp=30, max_hp=30, passives=frozenset({'flyby'}))
    # random() returns 0.10 < 0.25 => dodge
    resolve_round(a, d, 'aggress', 'feint', 1, FakeRng(randoms=[0.10], uniform=1.0))
    assert d.hp == 30   # punish dodged

def test_deathtouch_aggress_pierces_def():
    a = fighter(atk=10, dfn=5, hp=30, max_hp=30, passives=frozenset({'deathtouch_stomp'}))
    d = fighter(atk=10, dfn=8, hp=60, max_hp=60)
    resolve_round(a, d, 'aggress', 'feint', 1, FakeRng(uniform=1.0))
    # pierce 3 => eff def 5; hit 10-5=5 *1.5 => round(7.5)=8
    assert d.hp == 60 - round((10 - (8 - data.DEATHTOUCH_PIERCE)) * data.STANCE_WIN_MULT)

def test_first_bite_wins_clash_order():
    a = fighter(atk=10, dfn=0, hp=6, max_hp=6, spd=1, passives=frozenset({'first_bite'}))
    d = fighter(atk=10, dfn=0, hp=30, max_hp=30, spd=9)  # faster, but...
    resolve_round(a, d, 'aggress', 'aggress', 1, FakeRng(uniform=1.0))
    # first_bite makes A strike first; A deals 10 -> d.hp 20; then d strikes back
    assert d.hp == 20
```

- [ ] **Step 2: Run, verify failure**

Run: `cd infrastructure/lambda && python -m pytest tests/test_undercity_engine.py -k "venom or rot_breath or scavenge or flyby or deathtouch or first_bite" -v`
Expected: FAIL

- [ ] **Step 3: Implement**

Extend `_base_hit` to accept a deathtouch flag via caller (already has `pierce`). In the winning-exchange branch, compute pierce + first-win bonuses + flyby + scavenge. Replace the `if winner in ('attacker','defender'):` block body with:

```python
    if winner in ('attacker', 'defender'):
        win_side = winner
        lose_side = 'defender' if winner == 'attacker' else 'attacker'
        winr, losr = ((attacker, defender) if winner == 'attacker'
                      else (defender, attacker))
        win_stance = a_stance if winner == 'attacker' else d_stance

        # flyby: loser may dodge the whole punish.
        if losr.has('flyby') and rng.random() < data.FLYBY_DODGE:
            entries.append({'round': rnd, 'by': win_side, 'dmg': 0,
                            'miss': True, 'winner': win_side})
        elif win_stance == 'guard':
            raw_agg = _base_hit(losr, winr, rng)
            _deal(losr, winr, lose_side, rnd, raw_agg,
                  data.STANCE_GUARD_MITIGATE, entries, tag='mitigated')
            raw_ctr = _base_hit(winr, losr, rng)
            _deal(winr, losr, win_side, rnd, raw_ctr,
                  data.STANCE_GUARD_COUNTER, entries, tag='counter')
            _scavenge(losr, winr, lose_side, rnd, entries)  # winr took the agg hit
        else:
            pierce = (data.DEATHTOUCH_PIERCE
                      if win_stance == 'aggress' and winr.has('deathtouch_stomp') else 0)
            raw = _base_hit(winr, losr, rng, pierce)
            mult = data.STANCE_WIN_MULT
            bonus = 0
            if not winr.first_win_used:
                if winr.has('rot_breath'):
                    mult *= data.FIRST_WIN_ROT_BREATH_MULT
                if winr.has('venom_barb'):
                    bonus += data.VENOM_BARB_BONUS
                winr.first_win_used = True
            dmg = max(0, round(raw * mult) + bonus)
            if dmg > 0:
                losr.hp -= dmg
                entry = {'round': rnd, 'by': win_side, 'dmg': dmg, 'winner': win_side}
                if winr.has('drain_life'):
                    heal = round(dmg * 0.5)
                    winr.hp = min(winr.max_hp, winr.hp + heal); entry['heal'] = heal
                entries.append(entry)
            _scavenge(losr, winr, lose_side, rnd, entries)
    elif winner == 'clash':
```

Add the scavenge helper before `resolve_round`:

```python
def _scavenge(loser, winner, loser_side, rnd, entries):
    """A losing combatant with scavenge retaliates a flat amount."""
    if loser.has('scavenge') and winner.hp > 0:
        winner.hp -= data.SCAVENGE_RETALIATE
        entries.append({'round': rnd, 'by': loser_side, 'dmg': data.SCAVENGE_RETALIATE,
                        'retaliation': True})
```

For `first_bite` in the clash branch, replace the `first = ...` line with:

```python
        if attacker.has('first_bite') and not defender.has('first_bite'):
            first = 'attacker'
        elif defender.has('first_bite') and not attacker.has('first_bite'):
            first = 'defender'
        else:
            first = 'attacker' if attacker.spd >= defender.spd else 'defender'
```

- [ ] **Step 4: Run, verify pass**

Run: `cd infrastructure/lambda && python -m pytest tests/test_undercity_engine.py -k "venom or rot_breath or scavenge or flyby or deathtouch or first_bite" -v`
Expected: PASS

- [ ] **Step 5: Commit**

```bash
git add infrastructure/lambda/undercity_engine.py infrastructure/lambda/tests/test_undercity_engine.py
git commit -m "feat(undercity): remap creature passives onto exchanges"
```

---

## Task 8: Gear riders in `resolve_round`

**Files:**
- Modify: `infrastructure/lambda/undercity_engine.py` (`resolve_round`)
- Test: `infrastructure/lambda/tests/test_undercity_engine.py`

Rider behaviors (spec §2):
- `barbed` (fang): your **Aggress** applies +1 rot stack to the target regardless of win/clash/loss.
- `deep_biter` (fang): your winning exchange multiplier gets `+0.5`.
- `spiked` (carapace): when your **Guard** wins, the counter deals `+50%`.
- `thick` (carapace): in a G-vs-G stall your chip is doubled; when your Guard *loses* (you're the aggressor? no — thick softens being wrong: when you Guard and still take damage), reduce incoming by 1.
- `trickster` (charm): when your **Feint** loses (F vs A), your punish taken is halved.
- `serrated` (charm): when your **Feint** wins (breaks guard), apply `dmg_penalty` to the enemy's NEXT round (`+2` penalty subtracted from their next base hit).
- `glint` (charm): when your **Feint** wins, set `winner.reveal_next = True` (Plan 2/3 acts on it).

- [ ] **Step 1: Write the failing tests**

```python
def test_barbed_aggress_applies_rot_even_on_loss():
    a = fighter(atk=10, dfn=5, hp=30, max_hp=30, riders=frozenset({'barbed'}))
    d = fighter(atk=10, dfn=5, hp=30, max_hp=30)
    resolve_round(a, d, 'aggress', 'guard', 1, FakeRng(uniform=1.0))  # a loses (G>A)
    assert d.rot_stacks == 1   # rot applied despite losing the exchange

def test_deep_biter_boosts_winning_hit():
    a = fighter(atk=10, dfn=5, hp=30, max_hp=30, riders=frozenset({'deep_biter'}))
    d = fighter(atk=10, dfn=4, hp=60, max_hp=60)
    resolve_round(a, d, 'aggress', 'feint', 1, FakeRng(uniform=1.0))
    # 6 * (1.5+0.5) = 12
    assert d.hp == 60 - round(6 * (data.STANCE_WIN_MULT + 0.5))

def test_spiked_boosts_guard_counter():
    a = fighter(atk=10, dfn=5, hp=30, max_hp=30)                        # aggressor
    d = fighter(atk=10, dfn=5, hp=30, max_hp=30, riders=frozenset({'spiked'}))
    resolve_round(a, d, 'aggress', 'guard', 1, FakeRng(uniform=1.0))
    # counter 5*0.6=3, spiked *1.5 => round(4.5)=4
    assert a.hp == 30 - round(5 * data.STANCE_GUARD_COUNTER * 1.5)

def test_trickster_halves_lost_feint_punish():
    a = fighter(atk=10, dfn=5, hp=30, max_hp=30)                        # aggressor wins
    d = fighter(atk=10, dfn=5, hp=30, max_hp=30, riders=frozenset({'trickster'}))
    resolve_round(a, d, 'aggress', 'feint', 1, FakeRng(uniform=1.0))
    # normal punish 5*1.5=8 (round 7.5->8), halved => 4
    assert d.hp == 30 - round(round(5 * data.STANCE_WIN_MULT) / 2)

def test_serrated_penalizes_enemy_next_round():
    a = fighter(atk=10, dfn=5, hp=30, max_hp=30, riders=frozenset({'serrated'}))
    d = fighter(atk=10, dfn=5, hp=60, max_hp=60)
    resolve_round(a, d, 'feint', 'guard', 1, FakeRng(uniform=1.0))  # a's feint wins
    assert d.dmg_penalty == 2

def test_glint_sets_reveal():
    a = fighter(hp=30, max_hp=30, riders=frozenset({'glint'}))
    d = fighter(hp=60, max_hp=60)
    resolve_round(a, d, 'feint', 'guard', 1, FakeRng(uniform=1.0))
    assert a.reveal_next is True
```

- [ ] **Step 2: Run, verify failure**

Run: `cd infrastructure/lambda && python -m pytest tests/test_undercity_engine.py -k "barbed or deep_biter or spiked or trickster or serrated or glint" -v`
Expected: FAIL

- [ ] **Step 3: Implement**

Thread riders through the exchange. Changes to `resolve_round`:

**(a) deep_biter** — in the non-guard winning branch, after `mult = data.STANCE_WIN_MULT`:

```python
            if winr.has_rider('deep_biter'):
                mult += 0.5
```

**(b) spiked** — in the guard-win branch, replace the counter `_deal` with a rider-aware multiplier:

```python
            ctr_mult = data.STANCE_GUARD_COUNTER * (1.5 if winr.has_rider('spiked') else 1.0)
            raw_ctr = _base_hit(winr, losr, rng)
            _deal(winr, losr, win_side, rnd, raw_ctr, ctr_mult, entries, tag='counter')
```

**(c) trickster** — in the non-guard winning branch, after computing `dmg` but before applying it, halve when the loser is a trickster feinting:

```python
            lose_stance = d_stance if winner == 'attacker' else a_stance
            if lose_stance == 'feint' and losr.has_rider('trickster'):
                dmg = round(dmg / 2)
```

**(d) serrated + glint** — a Feint win. After the winning damage is applied in the non-guard branch, add:

```python
            if win_stance == 'feint':
                if winr.has_rider('serrated'):
                    losr.dmg_penalty += 2
                if winr.has_rider('glint'):
                    winr.reveal_next = True
```

**(e) barbed** — apply rot for any side that chose Aggress and has barbed. This block MUST go **after** the rot-tick loop added in Task 6 (so a stack applied this round first ticks next round), i.e. it is the last thing before `return entries`:

```python
    for side, (s, t), st in (('attacker', (attacker, defender), a_stance),
                             ('defender', (defender, attacker), d_stance)):
        if st == 'aggress' and s.has_rider('barbed') and t.hp > 0:
            t.rot_stacks += 1
            entries.append({'round': rnd, 'by': side, 'rotApplied': 1})
```

**(f) dmg_penalty consumption** — `_base_hit` must subtract the striker's pending `dmg_penalty` once. Update `_base_hit`:

```python
def _base_hit(striker, target, rng, pierce=0):
    swing = round(striker.atk * rng.uniform(0.85, 1.15))
    hit = max(1, swing - _effective_def(target, pierce))
    if striker.dmg_penalty:
        hit = max(1, hit - striker.dmg_penalty)
        striker.dmg_penalty = 0
    return hit
```

**(g) thick** — stall chip doubled + soften. In the stall branch, multiply thick-holder's chip; and in the guard-win mitigate path reduce incoming by 1 when the guard holder is thick. Add in stall branch:

```python
        mult = data.STANCE_STALL_MULT * (2 if s.has_rider('thick') else 1)
        raw = _base_hit(s, t, rng)
        _deal(s, t, side, rnd, raw, mult, entries)
```

(These are already-scoped edits within the branches created in Tasks 5–7; keep the `dmg_penalty` reset ordering so serrated affects exactly the next hit.)

- [ ] **Step 4: Run, verify pass**

Run: `cd infrastructure/lambda && python -m pytest tests/test_undercity_engine.py -k "barbed or deep_biter or spiked or trickster or serrated or glint" -v`
Expected: PASS

- [ ] **Step 5: Commit**

```bash
git add infrastructure/lambda/undercity_engine.py infrastructure/lambda/tests/test_undercity_engine.py
git commit -m "feat(undercity): gear stance riders in resolve_round"
```

---

## Task 9: Spell-buffs as stance modifiers

**Files:**
- Modify: `infrastructure/lambda/undercity_engine.py` (`resolve_round`)
- Test: `infrastructure/lambda/tests/test_undercity_engine.py`

Buff behaviors (spec §4) — buffs live in `Combatant.buffs`:
- `rot_surge`: your **Aggress** applies +1 rot stack (like barbed, but from a spell).
- `harden_shell`: when your **Guard** wins, you heal a small flat amount (`3`).
- `glowveil`: your winning **Feint** sets `reveal_next` (like glint).

- [ ] **Step 1: Write the failing tests**

```python
def test_rot_surge_buff_applies_rot_on_aggress():
    a = fighter(atk=10, dfn=5, hp=30, max_hp=30, buffs=frozenset({'rot_surge'}))
    d = fighter(atk=10, dfn=5, hp=30, max_hp=30)
    resolve_round(a, d, 'aggress', 'guard', 1, FakeRng(uniform=1.0))
    assert d.rot_stacks == 1

def test_harden_shell_heals_on_guard_win():
    a = fighter(atk=10, dfn=5, hp=30, max_hp=30)                    # aggressor
    d = fighter(atk=10, dfn=5, hp=20, max_hp=30, buffs=frozenset({'harden_shell'}))
    resolve_round(a, d, 'aggress', 'guard', 1, FakeRng(uniform=1.0))
    # d took mitigated 5*0.4=2 (->18) then heals 3 (->21)
    assert d.hp == 20 - round(5 * data.STANCE_GUARD_MITIGATE) + 3
```

- [ ] **Step 2: Run, verify failure**

Run: `cd infrastructure/lambda && python -m pytest tests/test_undercity_engine.py -k "rot_surge_buff or harden_shell" -v`
Expected: FAIL

- [ ] **Step 3: Implement**

**rot_surge** — extend the barbed rot loop's condition to also fire on the buff:

```python
        if st == 'aggress' and (s.has_rider('barbed') or s.has_buff('rot_surge')) and t.hp > 0:
```

**glowveil** — extend the feint-win reveal to also fire on the buff:

```python
                if winr.has_rider('glint') or winr.has_buff('glowveil'):
                    winr.reveal_next = True
```

**harden_shell** — in the guard-win branch, after the mitigate/counter, add:

```python
            if winr.has_buff('harden_shell'):
                heal = min(winr.max_hp - winr.hp, 3)
                if heal:
                    winr.hp += heal
                    entries.append({'round': rnd, 'by': win_side, 'heal': heal})
```

- [ ] **Step 4: Run, verify pass**

Run: `cd infrastructure/lambda && python -m pytest tests/test_undercity_engine.py -k "rot_surge_buff or harden_shell" -v`
Expected: PASS

- [ ] **Step 5: Commit**

```bash
git add infrastructure/lambda/undercity_engine.py infrastructure/lambda/tests/test_undercity_engine.py
git commit -m "feat(undercity): spell-buffs act as stance modifiers"
```

---

## Task 10: Flee as an action

**Files:**
- Modify: `infrastructure/lambda/undercity_engine.py` (add `flee_attempt`)
- Test: `infrastructure/lambda/tests/test_undercity_engine.py`

- [ ] **Step 1: Write the failing test**

```python
from undercity_engine import flee_attempt

def test_flee_attempt_success_and_smoke_fallback():
    # spd 8 vs 5 => chance 35+15=50; random 0.10*100=10 < 50 => escaped
    f = fighter(spd=8, hp=20, max_hp=30)
    e = fighter(spd=5)
    assert flee_attempt(f, e, FakeRng(randoms=[0.10]))['escaped'] is True
    # fail, but smoke spore saves it
    f2 = fighter(spd=1, hp=20, max_hp=30, has_smoke_spore=True)
    e2 = fighter(spd=9)
    r = flee_attempt(f2, e2, FakeRng(randoms=[0.99]))
    assert r['escaped'] is True and r['smokeSporeUsed'] is True
    # fail, no smoke => not escaped, DEF drop applied
    f3 = fighter(spd=1, hp=20, max_hp=30, dfn=5)
    r3 = flee_attempt(f3, fighter(spd=9), FakeRng(randoms=[0.99]))
    assert r3['escaped'] is False and f3.dfn == 4
```

- [ ] **Step 2: Run, verify failure**

Run: `cd infrastructure/lambda && python -m pytest tests/test_undercity_engine.py::test_flee_attempt_success_and_smoke_fallback -v`
Expected: FAIL — `cannot import name 'flee_attempt'`

- [ ] **Step 3: Implement**

```python
def flee_attempt(fleer: Combatant, enemy: Combatant, rng) -> dict:
    """
    One flee action (replaces the old flee stance). Uses the existing
    SPD-based flee_chance + home-biome bonus; smoke spore auto-succeeds a
    failed roll. On failure the fleer is caught off guard (-1 DEF).
    """
    chance = min(95, flee_chance(fleer.spd, enemy.spd) + fleer.flee_bonus)
    if rng.random() * 100 < chance:
        return {'escaped': True, 'smokeSporeUsed': False}
    if fleer.has_smoke_spore:
        return {'escaped': True, 'smokeSporeUsed': True}
    fleer.dfn = max(0, fleer.dfn - 1)
    return {'escaped': False, 'smokeSporeUsed': False}
```

- [ ] **Step 4: Run, verify pass**

Run: `cd infrastructure/lambda && python -m pytest tests/test_undercity_engine.py::test_flee_attempt_success_and_smoke_fallback -v`
Expected: PASS

- [ ] **Step 5: Commit**

```bash
git add infrastructure/lambda/undercity_engine.py infrastructure/lambda/tests/test_undercity_engine.py
git commit -m "feat(undercity): flee_attempt action (flee no longer a stance)"
```

---

## Task 11: Full-battle runner + `resolve_battle` back-compat

**Files:**
- Modify: `infrastructure/lambda/undercity_engine.py` (add `resolve_battle_rounds`; rewrite `resolve_battle`)
- Test: `infrastructure/lambda/tests/test_undercity_engine.py`

The runner drives `resolve_round` from two stance-picker callables and applies end-of-battle Regrowth + timeout resolution. `resolve_battle` becomes a wrapper that maps the legacy `.stance` (`fight`→`aggress`, `defend`→`guard`) onto fixed policies and routes `flee` through `flee_attempt`, so existing `undercity_db.py` call sites keep producing a valid result dict.

- [ ] **Step 1: Write the failing tests**

```python
from undercity_engine import resolve_battle_rounds

def _always(stance):
    return lambda me, foe, rnd, rng: stance

def test_runner_aggro_beats_feinter_and_regrowth():
    a = fighter(atk=12, dfn=5, hp=40, max_hp=40)
    d = fighter(atk=6, dfn=5, hp=20, max_hp=20, passives=frozenset({'regrowth'}))
    res = resolve_battle_rounds(a, d, FakeRng(uniform=1.0),
                                _always('aggress'), _always('feint'))
    assert res['outcome'] == 'attacker'
    assert res['attackerHp'] > 0 and res['defenderHp'] == 0

def test_runner_timeout_higher_hp_pct_wins():
    a = fighter(atk=1, dfn=99, hp=40, max_hp=40)   # nobody can hurt anybody
    d = fighter(atk=1, dfn=99, hp=10, max_hp=40)
    res = resolve_battle_rounds(a, d, FakeRng(uniform=1.0),
                                _always('guard'), _always('guard'))
    assert res['outcome'] == 'attacker'   # 100% vs 25% HP

def test_resolve_battle_backcompat_maps_legacy_stance():
    a = fighter(atk=12, dfn=5, hp=40, max_hp=40, stance='fight')
    d = fighter(atk=6, dfn=5, hp=18, max_hp=18, stance='defend')
    res = resolve_battle(a, d, FakeRng(uniform=1.0))
    assert res['outcome'] in ('attacker', 'defender', 'timeout')
    assert 'strikes' in res and 'attackerHp' in res

def test_resolve_battle_flee_stance_routes_to_flee_attempt():
    a = fighter(atk=12, dfn=5, hp=40, max_hp=40, stance='fight')
    d = fighter(atk=6, dfn=5, hp=18, max_hp=18, spd=9, stance='flee')
    res = resolve_battle(a, d, FakeRng(randoms=[0.10], uniform=1.0))
    assert res['outcome'] == 'fled'
```

- [ ] **Step 2: Run, verify failure**

Run: `cd infrastructure/lambda && python -m pytest tests/test_undercity_engine.py -k "runner or backcompat or flee_stance" -v`
Expected: FAIL

- [ ] **Step 3: Implement**

Replace the existing `resolve_battle` (lines 115-168) and the now-unused `_strike`/`_round_order` helpers with the new runner + wrapper. Delete `_strike` and `_round_order` (superseded by `resolve_round`); grep to confirm no other references first.

```python
def resolve_battle_rounds(attacker, defender, rng, pick_a, pick_d) -> dict:
    """
    Drive resolve_round for up to MAX_ROUNDS_COMBAT rounds. pick_a/pick_d are
    callables (me, foe, rnd, rng) -> stance. Applies Regrowth to survivors and
    resolves a timeout by higher HP%. Combatants are mutated/consumed.
    """
    strikes = []
    outcome = 'timeout'
    for rnd in range(1, data.MAX_ROUNDS_COMBAT + 1):
        a_stance = pick_a(attacker, defender, rnd, rng)
        d_stance = pick_d(defender, attacker, rnd, rng)
        strikes.extend(resolve_round(attacker, defender, a_stance, d_stance, rnd, rng))
        if defender.hp <= 0 and attacker.hp <= 0:
            outcome = 'attacker' if attacker.hp >= defender.hp else 'defender'
            break
        if defender.hp <= 0:
            outcome = 'attacker'; break
        if attacker.hp <= 0:
            outcome = 'defender'; break

    if outcome == 'timeout':
        a_pct = attacker.hp / attacker.max_hp if attacker.max_hp else 0
        d_pct = defender.hp / defender.max_hp if defender.max_hp else 0
        if a_pct != d_pct:
            outcome = 'attacker' if a_pct > d_pct else 'defender'

    for c in (attacker, defender):
        if c.hp > 0 and c.has('regrowth'):
            pct = 0.35 if c.has('rootwall') else 0.20
            c.hp = min(c.max_hp, c.hp + round(c.max_hp * pct))

    return {'outcome': outcome, 'strikes': strikes,
            'attackerHp': max(0, attacker.hp), 'defenderHp': max(0, defender.hp),
            'smokeSporeUsed': False, 'defenderFleeFailed': False}


_LEGACY_STANCE = {'fight': 'aggress', 'defend': 'guard'}


def resolve_battle(attacker: Combatant, defender: Combatant, rng) -> dict:
    """
    Back-compat wrapper for existing call sites. Legacy `.stance` values map to
    fixed triangle policies (fight->aggress, defend->guard). A defender set to
    `flee` attempts to flee first (as before). This path is a transitional
    stopgap; interactive PvE and monster AI arrive in Plan 2.
    """
    if defender.stance == 'flee':
        r = flee_attempt(defender, attacker, rng)
        if r['escaped']:
            return {'outcome': 'fled', 'strikes': [], 'attackerHp': attacker.hp,
                    'defenderHp': defender.hp,
                    'smokeSporeUsed': r['smokeSporeUsed'], 'defenderFleeFailed': False}
        flee_failed = True
    else:
        flee_failed = False

    a_pol = _always_policy(_LEGACY_STANCE.get(attacker.stance, 'aggress'))
    d_pol = _always_policy(_LEGACY_STANCE.get(defender.stance, 'aggress'))
    res = resolve_battle_rounds(attacker, defender, rng, a_pol, d_pol)
    res['defenderFleeFailed'] = flee_failed
    return res


def _always_policy(stance):
    return lambda me, foe, rnd, rng: stance
```

- [ ] **Step 4: Verify the whole suite is green**

Run: `cd infrastructure/lambda && python -m pytest tests/test_undercity_engine.py -q`
Expected: PASS (new + all pre-existing engine tests). Then run the full suite:
Run: `cd infrastructure/lambda && python -m pytest tests -q`
Expected: PASS — db/routing/spells/map tests still green (they call `resolve_battle`, which still returns the same result shape).

- [ ] **Step 5: Commit**

```bash
git add infrastructure/lambda/undercity_engine.py infrastructure/lambda/tests/test_undercity_engine.py
git commit -m "feat(undercity): round-driven battle runner + resolve_battle back-compat"
```

---

## Task 12: Full-suite regression + dead-code sweep

**Files:**
- Verify only: whole `infrastructure/lambda` package.

- [ ] **Step 1: Confirm no lingering references to deleted helpers**

Run: `cd infrastructure/lambda && grep -rn "_round_order\|_strike\b\|DEFEND_DEF_MULT\|DEFEND_DMG_MULT\|FLYBY_MISS" . --include=*.py`
Expected: no matches outside comments. If `DEFEND_DEF_MULT`/`DEFEND_DMG_MULT`/`FLYBY_MISS`/`MAX_ROUNDS` module constants at the top of `undercity_engine.py` are now unused, delete them.

- [ ] **Step 2: Run the entire lambda test suite**

Run: `cd infrastructure/lambda && python -m pytest tests -q`
Expected: PASS, zero failures.

- [ ] **Step 3: Sanity-check a battle end-to-end from Python**

Run:
```bash
cd infrastructure/lambda && python -c "
import random, undercity_engine as e
a=e.Combatant(name='A',hp=40,max_hp=40,atk=12,dfn=5,spd=6,riders=frozenset({'deep_biter'}))
d=e.Combatant(name='B',hp=40,max_hp=40,atk=10,dfn=6,spd=5,passives=frozenset({'scavenge'}))
print(e.resolve_battle_rounds(a,d,random.Random(1),
      e._always_policy('aggress'), e._always_policy('guard'))['outcome'])
"`
Expected: prints `attacker` or `defender` (a real outcome, no exception).

- [ ] **Step 4: Commit any cleanup**

```bash
git add infrastructure/lambda/undercity_engine.py
git commit -m "chore(undercity): drop superseded slugfest combat constants/helpers"
```

---

## Done criteria (Plan 1)

- `python -m pytest tests -q` in `infrastructure/lambda` is fully green.
- The engine exposes `exchange_winner`, `resolve_round`, `resolve_battle_rounds`, `flee_attempt`, and a back-compat `resolve_battle`.
- Gear riders, the charm slot, and combat consumables exist in `undercity_data.py` (data only).
- No client, DB, or API code changed; existing battles still resolve (via the back-compat wrapper) without breaking.

## Follow-on plans (not in this plan)

- **Plan 2 — Server state machine + AI:** round-driven battle persistence in `undercity_db.py`, `POST /game/action` per-round stance submission + telegraph in the response, monster **personality stance weights + bluff** in `undercity_data.py`/`pick_npc`, combat-consumable effects (reveal/auto-win/negate/double-punish) resolved server-side, charm slot wired into `_combatant`/gear equip, PvP fallback policy. Balance pass on monster HP/stats + stance multipliers.
- **Plan 3 — Client:** interactive round loop in `battle-playback.component` (telegraph → three stance buttons + flee + usable consumables → animate exchange → repeat), charm slot in the creature/gear UI, rider/telegraph copy, and the `src/app/undercity/data/*.ts` display mirrors for the new constants/gear/consumables.
