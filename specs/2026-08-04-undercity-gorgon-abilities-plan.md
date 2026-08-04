# Gorgon Abilities ("The Petrifiers") Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Give the Gorgon line a signature combat identity — Medusa Stalker's **Stone Gaze** (reads petrify the enemy → slow → freeze), Basalt Matron's **Shatter** (Aggress wins make the enemy Brittle → +damage), and a tier-3 Gorgon-only **wildcard gear slot**.

**Architecture:** Two new per-enemy stack counters (`petrify`, `brittle`) live on `engine.Combatant` and round-trip through the battle snapshot. **Petrify is db-side**: the read→stack hook sits in `_conclude_round` (where read success is known) and the freeze reuses the existing `resolve_round(force_winner='attacker')` lever in `_combat_round`; the slow is a direct SPD reduction on the enemy snapshot. **Brittle is pure engine**: a `resolve_round` branch amplifies the shatter-holder's decisive-win damage and procs on Aggress wins. **Stone Gaze's read-rate** is one entry in `READ_PASSIVE_BONUS`. The **wildcard slot** is a new `gear['wild']` key that `effective_stats`/`perk_stat` already sum; only the equip flow + client need work.

**Tech Stack:** Python 3.11 Lambda + pytest (`FakeTable` integration suite), Angular 20 standalone components with TS data mirrors.

Reference spec: [specs/2026-08-04-undercity-gorgon-abilities-design.md](2026-08-04-undercity-gorgon-abilities-design.md). Combat model: [specs/undercity-combat.md](undercity-combat.md).

---

## Key facts (verified against the codebase)

- **Combatant** (`undercity_engine.py:18`) carries mutable in-battle counters (`aggress_ramp`, `rot_stacks`, …) as `field(default=0, repr=False)`; `.has(passive)` checks membership. Add `petrify` and `brittle` the same way.
- **Snapshot round-trip** is three functions in `undercity_db.py`: `_bt_snapshot` (628, serialize), `_bt_to_combatant` (649, deserialize), `_bt_store` (675, write mutated state back). All three must learn the two new fields.
- **`resolve_round`** (`undercity_engine.py:228`) — the decisive-win path is the `else` branch at ~292; `force_winner` (param) overrides the triangle result; `winr`/`losr` are the exchange winner/loser; `win_stance` is the winning stance.
- **`_combat_round`** (`undercity_db.py:4395`) builds combatants, sets `force_winner` from a consumable, calls `resolve_round`, delegates to **`_conclude_round`** (4429) which `_bt_store`s both sides, then calls **`_telegraph_next(rec)`** (which sets `rec['read']` for the next round).
- **Reads:** `_read_chance` (722) sums `data.READ_PASSIVE_BONUS.get(p,0)` over passives; `READ_PASSIVE_BONUS = {'first_bite':0.20,'vexing':0.15}` (`undercity_data.py:533`), capped by `READ_MAX`. `_telegraph_next` sets `rec['read']` (bool) each round.
- **"Is a Gorgon":** `'stonewright' in _passives(doc)` (persists through evolution).
- **Wildcard auto-sum:** `engine.effective_stats` and `engine.perk_stat` iterate `(player['gear']).values()`, so a `gear['wild']` piece contributes to stats and perks with **no change** to those functions.
- **Status chips:** `_battle_status` (693) emits a `stacks` dict (e.g. `grave_growth`); the client renders `STATUS_INFO[kind]` (`combat.ts:126`).
- **Medusa/Basalt** live in `undercity_data.TIER2` (`medusa_stalker` passive `vexing`; `basalt_matron` passive `spikeshell`, bonus `{maxHp:6,def:2}`) and mirror in `forms.ts`.

---

## File Structure

**Modified (backend):**
- `undercity_config.py` — `PETRIFY_SLOW`, `PETRIFY_FREEZE_AT`, `BRITTLE_AMP`, `BRITTLE_MAX`.
- `undercity_engine.py` — `Combatant.petrify`/`.brittle`; Brittle amp + Shatter proc in `resolve_round`.
- `undercity_db.py` — the two fields in `_bt_snapshot`/`_bt_to_combatant`/`_bt_store`; read→petrify in `_conclude_round`; freeze in `_combat_round`; petrify/brittle in `_battle_status`; the `wild` equip path in `_equip_gear`.
- `undercity_data.py` — `READ_PASSIVE_BONUS['stone_gaze']`; Medusa passive→`stone_gaze`; Basalt passive→`shatter` + bonus→`{atk:2,maxHp:4}`; blurbs.

**Modified (client):**
- `src/app/undercity/data/forms.ts` — passive names/blurbs for `stone_gaze`/`shatter`; swap the two forms' passives; Basalt bonus.
- `src/app/undercity/data/combat.ts` — `STATUS_INFO` for `petrify`/`brittle`.
- Gear UI (equipped-slots component) — a 4th "wildcard" slot for tier-3 Gorgons.

**Test files:** `tests/test_undercity_gorgon_abilities.py` (new), plus additions to `tests/test_undercity_engine.py`.

---

# PHASE 1 — Petrify + Stone Gaze (Medusa)

### Task 1: The `petrify`/`brittle` fields round-trip through the snapshot

**Files:**
- Modify: `infrastructure/lambda/undercity_engine.py` (`Combatant`)
- Modify: `infrastructure/lambda/undercity_db.py` (`_bt_snapshot`, `_bt_to_combatant`, `_bt_store`)
- Create: `infrastructure/lambda/tests/test_undercity_gorgon_abilities.py`

- [ ] **Step 1: Write the failing test**

Create `infrastructure/lambda/tests/test_undercity_gorgon_abilities.py`:

```python
"""Gorgon combat abilities: Petrify (Medusa), Brittle/Shatter (Basalt), wildcard slot."""
import undercity_data as data
import undercity_db as db
import undercity_engine as engine

from tests.test_undercity_db import (  # noqa: F401
    table, act, _sid, _player_at)


def test_combatant_petrify_brittle_round_trip():
    c = engine.Combatant(name='X', hp=20, max_hp=20, atk=5, dfn=5, spd=5)
    c.petrify = 3
    c.brittle = 2
    snap = db._bt_snapshot(c)
    assert snap['petrify'] == 3 and snap['brittle'] == 2
    back = db._bt_to_combatant(snap)
    assert back.petrify == 3 and back.brittle == 2
    back.petrify = 7
    db._bt_store(back, snap)
    assert snap['petrify'] == 7
```

- [ ] **Step 2: Run test to verify it fails**

Run: `cd infrastructure/lambda && python -m pytest tests/test_undercity_gorgon_abilities.py::test_combatant_petrify_brittle_round_trip -q`
Expected: FAIL — `Combatant` has no `petrify` (TypeError/AttributeError).

- [ ] **Step 3: Add the Combatant fields**

In `undercity_engine.py`, in the `Combatant` dataclass, after the `doom_stacks` line (~42):

```python
    petrify: int = field(default=0, repr=False)   # Gorgon Stone Gaze: enemy freeze counter
    brittle: int = field(default=0, repr=False)   # Gorgon Shatter: enemy damage-amp stacks
```

- [ ] **Step 4: Serialize/deserialize/store the fields**

In `undercity_db.py` `_bt_snapshot` (after the `growth_stacks`/`doom_stacks` line):

```python
        'petrify': int(c.petrify), 'brittle': int(c.brittle),
```

In `_bt_to_combatant`, add to the `engine.Combatant(...)` kwargs (near `growth_stacks`/`doom_stacks` if present, else anywhere in the constructor list):

```python
        petrify=int(s.get('petrify', 0)), brittle=int(s.get('brittle', 0)),
```

In `_bt_store` (after the `doom_stacks` line):

```python
    rec_side['petrify'] = int(c.petrify)
    rec_side['brittle'] = int(c.brittle)
```

- [ ] **Step 5: Run test to verify it passes**

Run: `cd infrastructure/lambda && python -m pytest tests/test_undercity_gorgon_abilities.py -q`
Expected: PASS.

- [ ] **Step 6: Commit**

```bash
git add infrastructure/lambda/undercity_engine.py infrastructure/lambda/undercity_db.py infrastructure/lambda/tests/test_undercity_gorgon_abilities.py
git commit -m "feat(undercity): petrify/brittle combatant fields + snapshot round-trip"
```

---

### Task 2: Config scalars + Stone Gaze read-rate + Medusa passive rename

**Files:**
- Modify: `infrastructure/lambda/undercity_config.py`
- Modify: `infrastructure/lambda/undercity_data.py` (`READ_PASSIVE_BONUS`, `TIER2['medusa_stalker']`)
- Modify: `infrastructure/lambda/tests/test_undercity_gorgon_abilities.py`

- [ ] **Step 1: Write the failing test**

Add to `test_undercity_gorgon_abilities.py`:

```python
def test_petrify_scalars_and_stone_gaze_read_bonus():
    assert data.PETRIFY_SLOW == 2
    assert data.PETRIFY_FREEZE_AT == 4
    assert data.READ_PASSIVE_BONUS['stone_gaze'] == 0.15


def test_medusa_has_stone_gaze():
    assert data.TIER2['medusa_stalker']['passive'] == 'stone_gaze'
```

- [ ] **Step 2: Run test to verify it fails**

Run: `cd infrastructure/lambda && python -m pytest tests/test_undercity_gorgon_abilities.py -q -k "scalars or medusa"`
Expected: FAIL — `PETRIFY_SLOW` missing; Medusa passive still `vexing`.

- [ ] **Step 3: Add config scalars**

Append to `infrastructure/lambda/undercity_config.py`:

```python
# ── Gorgon abilities (Petrify / Shatter) ─────────────────────────────────────
PETRIFY_SLOW = 2          # -SPD applied to the enemy per Petrify stack
PETRIFY_FREEZE_AT = 4     # Petrify stacks that trigger a one-round freeze (then reset)
BRITTLE_AMP = 0.15        # +damage the Gorgon deals per Brittle stack
BRITTLE_MAX = 3           # Brittle stack cap
```

- [ ] **Step 4: Add the Stone Gaze read bonus + rename Medusa's passive**

In `undercity_data.py`, extend `READ_PASSIVE_BONUS`:

```python
READ_PASSIVE_BONUS = {'first_bite': 0.20, 'vexing': 0.15, 'stone_gaze': 0.15}
```

In `undercity_data.py` `TIER2['medusa_stalker']`, change the passive + blurb:

```python
    'medusa_stalker': {
        'name': 'Medusa Stalker', 'line': 'gorgon', 'bonus': {'spd': 2, 'atk': 2},
        'passive': 'stone_gaze',
        'blurb': 'Gaze-hunter. Stone Gaze: reads come easily, and every read you land '
                 'petrifies the foe — stacking slow that ends in a one-round freeze.',
    },
```

- [ ] **Step 5: Run test to verify it passes**

Run: `cd infrastructure/lambda && python -m pytest tests/test_undercity_gorgon_abilities.py -q -k "scalars or medusa"`
Expected: PASS.

- [ ] **Step 6: Commit**

```bash
git add infrastructure/lambda/undercity_config.py infrastructure/lambda/undercity_data.py infrastructure/lambda/tests/test_undercity_gorgon_abilities.py
git commit -m "feat(undercity): petrify scalars + Stone Gaze read bonus (Medusa)"
```

---

### Task 3: Read → Petrify stack (slow) in `_conclude_round`

When a Gorgon with `stone_gaze` lands a read, the enemy gains a Petrify stack: `enemy['petrify'] += 1` and `enemy['spd'] -= PETRIFY_SLOW` (floored at 1). Applied on the enemy snapshot right after `_telegraph_next`.

**Files:**
- Modify: `infrastructure/lambda/undercity_db.py` (`_conclude_round`)
- Modify: `infrastructure/lambda/tests/test_undercity_gorgon_abilities.py`

- [ ] **Step 1: Write the failing test**

Add a helper + test to `test_undercity_gorgon_abilities.py`:

```python
def _start_a_fight_as_gorgon(table, monkeypatch, passives):
    """Join, force a wild fight, and stamp the player's battle combatant with the
    given passives (simulating an evolved Gorgon form)."""
    act(table, 'join', starter='gorgon')
    sid = _sid(table)
    doc = db._get_player(table, sid, 'user-alex')
    ev = db._wild_battle(table, sid, doc, region='cavern')
    assert ev['type'] == 'battle_start'
    doc['battle']['player']['passives'] = sorted(passives)
    db._save_or_conflict(table, doc)
    return sid, doc


def test_stone_gaze_read_applies_petrify(table, monkeypatch):
    sid, doc = _start_a_fight_as_gorgon(table, monkeypatch, ['stonewright', 'stone_gaze'])
    monkeypatch.setattr(db._rng, 'random', lambda: 0.0)   # force a read to land
    start_spd = doc['battle']['npc']['spd']
    status, body = db._combat_round(table, sid, doc, {'stance': 'guard'})
    npc = db._get_player(table, sid, 'user-alex')['battle']['npc']
    assert npc['petrify'] == 1
    assert npc['spd'] == max(1, start_spd - data.PETRIFY_SLOW)


def test_no_stone_gaze_no_petrify(table, monkeypatch):
    sid, doc = _start_a_fight_as_gorgon(table, monkeypatch, ['stonewright'])  # no gaze
    monkeypatch.setattr(db._rng, 'random', lambda: 0.0)
    db._combat_round(table, sid, doc, {'stance': 'guard'})
    npc = db._get_player(table, sid, 'user-alex')['battle']['npc']
    assert npc.get('petrify', 0) == 0
```

- [ ] **Step 2: Run test to verify it fails**

Run: `cd infrastructure/lambda && python -m pytest tests/test_undercity_gorgon_abilities.py -q -k "stone_gaze_read or no_stone_gaze"`
Expected: FAIL — `npc['petrify']` stays 0 (no hook yet).

- [ ] **Step 3: Add the read→petrify hook**

In `undercity_db.py` `_conclude_round`, immediately after `shown = _telegraph_next(rec)` (~4464):

```python
    # Gorgon Stone Gaze: a landed read petrifies the foe — a stacking SPD slow.
    if rec['read'] and 'stone_gaze' in (rec['player'].get('passives') or []):
        npc = rec['npc']
        npc['petrify'] = int(npc.get('petrify', 0)) + 1
        npc['spd'] = max(1, int(npc['spd']) - data.PETRIFY_SLOW)
```

- [ ] **Step 4: Run test to verify it passes**

Run: `cd infrastructure/lambda && python -m pytest tests/test_undercity_gorgon_abilities.py -q -k "stone_gaze_read or no_stone_gaze"`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add infrastructure/lambda/undercity_db.py infrastructure/lambda/tests/test_undercity_gorgon_abilities.py
git commit -m "feat(undercity): Stone Gaze read applies stacking Petrify slow"
```

---

### Task 4: Freeze at threshold in `_combat_round`

When the enemy's `petrify` count reaches `PETRIFY_FREEZE_AT`, the enemy skips its next round: force the player to win (via the existing `force_winner='attacker'`) and reset the count to 0 (the accumulated SPD slow persists).

**Files:**
- Modify: `infrastructure/lambda/undercity_db.py` (`_combat_round`)
- Modify: `infrastructure/lambda/tests/test_undercity_gorgon_abilities.py`

- [ ] **Step 1: Write the failing test**

Add to `test_undercity_gorgon_abilities.py`:

```python
def test_petrify_threshold_freezes_and_resets(table, monkeypatch):
    sid, doc = _start_a_fight_as_gorgon(table, monkeypatch, ['stonewright', 'stone_gaze'])
    # Pre-load the enemy at one below the freeze threshold.
    doc['battle']['npc']['petrify'] = data.PETRIFY_FREEZE_AT - 1
    db._save_or_conflict(table, doc)
    monkeypatch.setattr(db._rng, 'random', lambda: 0.0)   # read lands → hits threshold
    # This round's read pushes petrify to the threshold…
    db._combat_round(table, sid, doc, {'stance': 'guard'})
    doc = db._get_player(table, sid, 'user-alex')
    assert doc['battle']['npc']['petrify'] == data.PETRIFY_FREEZE_AT
    # …the NEXT round the enemy is frozen: the player wins regardless of stance,
    # and the counter resets to 0.
    hp_before = doc['battle']['npc']['hp']
    status, body = db._combat_round(table, sid, doc, {'stance': 'guard'})
    npc = db._get_player(table, sid, 'user-alex')['battle']['npc']
    # The freeze reset the counter below the threshold. (A fresh read this same
    # round may immediately re-add 1, so assert "dropped below threshold", not ==0.)
    assert npc['petrify'] < data.PETRIFY_FREEZE_AT
    # Enemy was frozen — the player's forced win landed, the foe never healed.
    assert npc['hp'] <= hp_before
```

- [ ] **Step 2: Run test to verify it fails**

Run: `cd infrastructure/lambda && python -m pytest tests/test_undercity_gorgon_abilities.py::test_petrify_threshold_freezes_and_resets -q`
Expected: FAIL — no freeze/reset (`petrify` stays at the threshold).

- [ ] **Step 3: Add the freeze trigger**

In `undercity_db.py` `_combat_round`, after `npc_c = _bt_to_combatant(rec['npc'])` (~4418) and before the `resolve_round` call:

```python
    # Gorgon Petrify: a fully-petrified foe skips this round (the Gorgon strikes
    # free), then the freeze counter resets. The SPD slow already applied persists.
    if npc_c.petrify >= data.PETRIFY_FREEZE_AT:
        force_winner = 'attacker'
        npc_c.petrify = 0
```

(`npc_c` is written back by `_conclude_round`'s `_bt_store`, so the reset persists.)

- [ ] **Step 4: Run test to verify it passes**

Run: `cd infrastructure/lambda && python -m pytest tests/test_undercity_gorgon_abilities.py::test_petrify_threshold_freezes_and_resets -q`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add infrastructure/lambda/undercity_db.py infrastructure/lambda/tests/test_undercity_gorgon_abilities.py
git commit -m "feat(undercity): Petrify freezes the foe at threshold, then resets"
```

---

### Task 5: Petrify status chip (client)

**Files:**
- Modify: `infrastructure/lambda/undercity_db.py` (`_battle_status`)
- Modify: `src/app/undercity/data/combat.ts` (`STATUS_INFO`)

- [ ] **Step 1: Emit the petrify stack count in `_battle_status`**

In `undercity_db.py` `_battle_status`, inside the `stacks` block (after the `doom_stacks` check):

```python
    if side.get('petrify'):
        stacks['petrify'] = int(side['petrify'])
    if side.get('brittle'):
        stacks['brittle'] = int(side['brittle'])
```

And include them in the returned `traits` list so the client renders the stack chip — change the `traits` line to also surface these two debuffs:

```python
    traits = [p for p in (side.get('passives') or []) if p in data.TRAIT_PASSIVES]
    traits += [k for k in ('petrify', 'brittle') if side.get(k)]
```

- [ ] **Step 2: Add the client chip definitions**

In `src/app/undercity/data/combat.ts` `STATUS_INFO`, add (no emoji — Material icon names, per house rule):

```typescript
  petrify: { label: 'Petrify', icon: 'hourglass_bottom', tone: 'debuff',
    blurb: 'Turning to stone: −SPD per stack; at 4 it freezes for a round, then resets.' },
  brittle: { label: 'Brittle', icon: 'broken_image', tone: 'debuff',
    blurb: 'Cracked open: takes extra damage from the Gorgon.' },
```

- [ ] **Step 3: Verify build + a quick server check**

Run: `cd infrastructure/lambda && python -m pytest tests/test_undercity_gorgon_abilities.py -q` (still green) and `npm run build` (client compiles).
Expected: tests PASS; build succeeds.

- [ ] **Step 4: Commit**

```bash
git add infrastructure/lambda/undercity_db.py src/app/undercity/data/combat.ts
git commit -m "feat(undercity): Petrify/Brittle status chips in battle UI"
```

---

### Task 6: Client mirror for Medusa's Stone Gaze

**Files:**
- Modify: `src/app/undercity/data/forms.ts`

- [ ] **Step 1: Add passive strings + swap Medusa's passive**

In `forms.ts` `PASSIVE_NAMES` add `stone_gaze: 'Stone Gaze',`; in `PASSIVE_BLURBS` add:

```typescript
  stone_gaze: 'Reads come easily; each read petrifies the foe — stacking slow that ends in a one-round freeze.',
```

Change the `medusa_stalker` entry in the `TIER2` array:

```typescript
  { id: 'medusa_stalker', name: 'Medusa Stalker', tier: 2, line: 'gorgon', passive: 'stone_gaze', passiveName: 'Stone Gaze', bonus: { spd: 2, atk: 2 }, blurb: 'Gaze-hunter (+SPD/+ATK).' },
```

- [ ] **Step 2: Verify build**

Run: `npm run build`
Expected: succeeds.

- [ ] **Step 3: Commit**

```bash
git add src/app/undercity/data/forms.ts
git commit -m "feat(undercity): client mirror for Medusa Stone Gaze"
```

---

# PHASE 2 — Brittle + Shatter (Basalt)

### Task 7: Brittle amp + Shatter proc in `resolve_round`

When the shatter-holder wins a decisive exchange, its damage is amplified by the target's Brittle stacks; a decisive **Aggress** win then adds a Brittle stack.

**Files:**
- Modify: `infrastructure/lambda/undercity_engine.py` (`resolve_round`, decisive `else` branch)
- Modify: `infrastructure/lambda/tests/test_undercity_engine.py`

- [ ] **Step 1: Write the failing tests**

Add to `tests/test_undercity_engine.py` (it already imports `resolve_round`, `Combatant` via `engine`):

```python
def _fighter(**kw):
    base = dict(name='F', hp=100, max_hp=100, atk=8, dfn=3, spd=5)
    base.update(kw)
    return engine.Combatant(**base)


def test_shatter_applies_brittle_on_aggress_win():
    import random
    atk = _fighter(passives=frozenset({'shatter'}))
    dfn = _fighter(name='D')
    # Aggress beats Feint → decisive attacker win.
    engine.resolve_round(atk, dfn, 'aggress', 'feint', 1, random.Random(1),
                         frenzy_from=None)
    assert dfn.brittle == 1


def test_brittle_amplifies_gorgon_damage():
    import random
    # Same seed, same exchange; only difference is the target's Brittle stacks.
    a1 = _fighter(passives=frozenset({'shatter'})); d1 = _fighter(name='D', dfn=5)
    a2 = _fighter(passives=frozenset({'shatter'})); d2 = _fighter(name='D', dfn=5, brittle=2)
    engine.resolve_round(a1, d1, 'aggress', 'feint', 1, random.Random(7), frenzy_from=None)
    engine.resolve_round(a2, d2, 'aggress', 'feint', 1, random.Random(7), frenzy_from=None)
    dmg1, dmg2 = d1.max_hp - d1.hp, d2.max_hp - d2.hp
    assert dmg2 > dmg1                      # brittle target took more


def test_brittle_caps():
    import random
    d = _fighter(name='D', brittle=data.BRITTLE_MAX)
    a = _fighter(passives=frozenset({'shatter'}))
    engine.resolve_round(a, d, 'aggress', 'feint', 1, random.Random(1), frenzy_from=None)
    assert d.brittle == data.BRITTLE_MAX     # never exceeds the cap
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `cd infrastructure/lambda && python -m pytest tests/test_undercity_engine.py -q -k "shatter or brittle"`
Expected: FAIL — `brittle` never changes; no amp.

- [ ] **Step 3: Implement amp + proc**

In `undercity_engine.py` `resolve_round`, in the decisive `else` branch: apply the amp where `mult` is assembled (after the `deep_biter`/`gutcleaver` lines, before `bonus = 0`):

```python
            if winr.has('shatter') and losr.brittle:
                mult += data.BRITTLE_AMP * min(losr.brittle, data.BRITTLE_MAX)
```

Then add the Shatter proc alongside the other post-win ramps (next to the `rabid`/`rend` blocks, ~340):

```python
            # Shatter (Basalt Matron): a winning Aggress cracks the foe — a
            # stacking Brittle debuff that amplifies the Gorgon's future hits.
            if win_stance == 'aggress' and winr.has('shatter') and losr.hp > 0:
                losr.brittle = min(data.BRITTLE_MAX, losr.brittle + 1)
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `cd infrastructure/lambda && python -m pytest tests/test_undercity_engine.py -q -k "shatter or brittle"`
Expected: PASS (3 tests).

- [ ] **Step 5: Commit**

```bash
git add infrastructure/lambda/undercity_engine.py infrastructure/lambda/tests/test_undercity_engine.py
git commit -m "feat(undercity): Shatter applies Brittle; Brittle amps the Gorgon's hits"
```

---

### Task 8: Basalt passive → Shatter + bruiser stat tweak

**Files:**
- Modify: `infrastructure/lambda/undercity_data.py` (`TIER2['basalt_matron']`)
- Modify: `infrastructure/lambda/tests/test_undercity_gorgon_abilities.py`

- [ ] **Step 1: Write the failing test**

Add to `test_undercity_gorgon_abilities.py`:

```python
def test_basalt_has_shatter_and_bruiser_bonus():
    b = data.TIER2['basalt_matron']
    assert b['passive'] == 'shatter'
    assert b['bonus'] == {'atk': 2, 'maxHp': 4}
```

- [ ] **Step 2: Run test to verify it fails**

Run: `cd infrastructure/lambda && python -m pytest tests/test_undercity_gorgon_abilities.py::test_basalt_has_shatter_and_bruiser_bonus -q`
Expected: FAIL — passive still `spikeshell`, bonus still `{maxHp:6,def:2}`.

- [ ] **Step 3: Update Basalt**

In `undercity_data.py` `TIER2['basalt_matron']`:

```python
    'basalt_matron': {
        'name': 'Basalt Matron', 'line': 'gorgon', 'bonus': {'atk': 2, 'maxHp': 4},
        'passive': 'shatter',
        'blurb': 'Stone crusher. Shatter: a winning Aggress cracks the foe (Brittle) — '
                 'your blows then hit the cracks for extra.',
    },
```

- [ ] **Step 4: Run test to verify it passes**

Run: `cd infrastructure/lambda && python -m pytest tests/test_undercity_gorgon_abilities.py::test_basalt_has_shatter_and_bruiser_bonus -q`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add infrastructure/lambda/undercity_data.py infrastructure/lambda/tests/test_undercity_gorgon_abilities.py
git commit -m "feat(undercity): Basalt Matron gets Shatter + bruiser statline"
```

---

### Task 9: Client mirror for Basalt's Shatter

**Files:**
- Modify: `src/app/undercity/data/forms.ts`

- [ ] **Step 1: Add passive strings + swap Basalt's passive + bonus**

In `forms.ts` `PASSIVE_NAMES` add `shatter: 'Shatter',`; in `PASSIVE_BLURBS`:

```typescript
  shatter: 'A winning Aggress cracks the foe (Brittle); your blows then hit the cracks for extra.',
```

Change the `basalt_matron` entry in the `TIER2` array:

```typescript
  { id: 'basalt_matron', name: 'Basalt Matron', tier: 2, line: 'gorgon', passive: 'shatter', passiveName: 'Shatter', bonus: { atk: 2, maxHp: 4 }, blurb: 'Stone crusher (+ATK/+HP).' },
```

- [ ] **Step 2: Verify build**

Run: `npm run build`
Expected: succeeds.

- [ ] **Step 3: Commit**

```bash
git add src/app/undercity/data/forms.ts
git commit -m "feat(undercity): client mirror for Basalt Shatter + bruiser bonus"
```

---

# PHASE 3 — Tier-3 wildcard gear slot

### Task 10: Equip into the `wild` slot (backend, gated)

The equip action gains a `wild` target: a tier-3 Gorgon may equip any one piece into `gear['wild']` (duplicates of an existing slot type allowed). Anyone else is rejected.

**Files:**
- Modify: `infrastructure/lambda/undercity_db.py` (`_equip_gear`)
- Modify: `infrastructure/lambda/tests/test_undercity_gorgon_abilities.py`

- [ ] **Step 1: Write the failing tests**

Add to `test_undercity_gorgon_abilities.py`:

```python
def _gorgon_apex_at(table, node='city_r0'):
    sid, doc = _player_at(table, node)
    doc['passives'] = ['stonewright']     # a Gorgon…
    doc['tier'] = 3                        # …at apex
    return sid, doc


def test_tier3_gorgon_equips_wildcard(table):
    sid, doc = _gorgon_apex_at(table)
    doc['gear'] = {'fang': 'rusted_fang'}          # already wearing a fang
    doc['gearStash'] = ['rusted_fang']             # a duplicate fang to slot as wildcard
    status, body = db._equip_gear(
        table, sid, doc, {'index': 0, 'slot': 'wild'})
    assert status == 200
    assert doc['gear']['wild'] == 'rusted_fang'    # duplicate type allowed in wild
    # It contributes to effective stats (two fangs' ATK now sum).
    assert engine.effective_stats(doc)['atk'] >= doc['atk'] + 2 * data.GEAR['rusted_fang']['atk']


def test_non_gorgon_cannot_use_wildcard(table):
    sid, doc = _player_at(table, 'city_r0')         # pest, no stonewright
    doc['tier'] = 3
    doc['gearStash'] = ['rusted_fang']
    status, _ = db._equip_gear(table, sid, doc, {'index': 0, 'slot': 'wild'})
    assert status == 409


def test_pre_apex_gorgon_cannot_use_wildcard(table):
    sid, doc = _player_at(table, 'city_r0')
    doc['passives'] = ['stonewright']; doc['tier'] = 2   # Gorgon but not apex
    doc['gearStash'] = ['rusted_fang']
    status, _ = db._equip_gear(table, sid, doc, {'index': 0, 'slot': 'wild'})
    assert status == 409
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `cd infrastructure/lambda && python -m pytest tests/test_undercity_gorgon_abilities.py -q -k "wildcard"`
Expected: FAIL — `_equip_gear` ignores `slot`, equips into the piece's own slot.

- [ ] **Step 3: Add the wildcard branch to `_equip_gear`**

In `undercity_db.py` `_equip_gear`, after `slot = g['slot']` (~1350), honor an explicit `wild` target with the gate:

```python
    if (payload or {}).get('slot') == 'wild':
        if 'stonewright' not in _passives(doc) or int(doc.get('tier', 1)) < 3:
            return _err('Only an apex Gorgon has a wildcard slot.', 409)
        slot = 'wild'
```

(The rest of the function already swaps `gear[slot]` and returns the displaced piece to the stash — a `wild` piece rides that path unchanged, and `effective_stats`/`perk_stat` already sum `gear.values()`.)

- [ ] **Step 4: Run tests to verify they pass**

Run: `cd infrastructure/lambda && python -m pytest tests/test_undercity_gorgon_abilities.py -q -k "wildcard"`
Expected: PASS (3 tests).

- [ ] **Step 5: Commit**

```bash
git add infrastructure/lambda/undercity_db.py infrastructure/lambda/tests/test_undercity_gorgon_abilities.py
git commit -m "feat(undercity): apex Gorgon wildcard gear slot (equip + gate)"
```

---

### Task 11: Wildcard slot in the client gear UI

Show a 4th "wildcard" slot for tier-3 Gorgons and let the equip modal target it.

**Files:**
- Modify: the equipped-gear component (locate in Step 1).

- [ ] **Step 1: Locate the equipped-slots UI**

Run: `grep -rnE "'fang'|'carapace'|'charm'|gear\?\.\[|slot" src/app/undercity/tabs --include=*.ts | grep -i gear | head`
Identify the component that renders the three equipped slots (fang/carapace/charm) and the equip action call.

- [ ] **Step 2: Render a wildcard slot for apex Gorgons**

In that component's template, after the three fixed slots, conditionally render a 4th slot when the player is a tier-3 Gorgon:

```typescript
// in the component: a getter for visibility
get hasWildcard(): boolean {
  const p = this.player();               // however the component reads player state
  return p?.tier === 3 && (p?.passives ?? []).includes('stonewright');
}
```

Template (mirror the existing slot markup, labelled "Wildcard", reading `player().gear?.wild` and resolving via `gearById`/`GEAR_MAP` — the "+"-aware resolver from the Gear+ work):

```html
@if (hasWildcard) {
  <!-- one more slot cell, same markup as the fang/carapace/charm cells,
       bound to gear.wild; its equip button posts { slot: 'wild' } -->
}
```

- [ ] **Step 3: Post the wildcard target on equip**

Where the component posts the `equip-gear` action, pass `slot: 'wild'` when the chosen destination is the wildcard cell (the stash-piece equip flow already sends `{ index }`; add `slot` for this path). Keep the existing three-slot equip calls unchanged (no `slot` key → backend equips into the piece's own slot as today).

- [ ] **Step 4: Verify build**

Run: `npm run build`
Expected: succeeds.

- [ ] **Step 5: Commit**

```bash
git add src/app/undercity/tabs/
git commit -m "feat(undercity): client wildcard gear slot for apex Gorgons"
```

---

### Task 12: Final gate — full suite + build

**Files:** none (verification only)

- [ ] **Step 1: Full backend suite**

Run: `cd infrastructure/lambda && python -m pytest tests -q`
Expected: the Gorgon-abilities file is green and **no new failures** vs the branch baseline. (The `undercity-boss-familiars` branch carries pre-existing failures unrelated to this work — confirm the failing set is unchanged, e.g. by running the suite at the pre-work commit in a throwaway `git worktree` if in doubt.)

- [ ] **Step 2: Frontend build**

Run: `npm run build`
Expected: succeeds.

- [ ] **Step 3: Manual smoke (optional, via the run-undercity skill)**

Evolve/stamp a Gorgon to Medusa Stalker; land reads and confirm Petrify chips accrue, SPD drops, and a freeze fires at 4 with a reset. As Basalt Matron, win an Aggress and confirm Brittle chips + bigger follow-up hits. At apex, confirm the wildcard slot appears, accepts a duplicate piece, and its stats/perks apply.

---

## Self-review notes (addressed)

- **Spec coverage:** Petrify slow (T3) + freeze (T4) + Stone Gaze read bonus (T2) + chips (T5) + Medusa mirror (T6); Brittle amp/proc (T7) + Basalt data+stat (T8) + mirror (T9); wildcard equip+gate (T10) + client slot (T11). Base-Gorgon-stays-economy is honored (no base combat passive task).
- **Type consistency:** `petrify`/`brittle` are the field names in the `Combatant`, all three snapshot funcs, `_battle_status`, `STATUS_INFO`, and every test. `stone_gaze`/`shatter` passive ids match across data + mirror + engine branches.
- **Open items from the spec** (Brittle-as-multiplier chosen over pierce; Stone Gaze reuses the `vexing` read value `0.15`; freeze coexists with the Collapse, no special-casing) are all resolved in the tasks above.

## Deferred / non-goals (from the spec)

- No base-form combat passive; no new apex forms; no Petrify damage; Brittle amps only the Gorgon's own hits; no new gear/riders.
- Balance pass (`infrastructure/lambda/sim/`) after deploy — watch a wildcard second read-charm stacking read-rate into Petrify against `READ_MAX`. Deploys are run by the user.
```
