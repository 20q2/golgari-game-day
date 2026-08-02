# Undercity Companions — Plan 2: Egg drops + combat hooks (server) Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Make companion eggs actually drop from play (loot / mystery / combat), and make the two combat pets do something in battle — Fox adds an occasional follow-up hit, Turtle occasionally deflects a few points — scaling with pet level and surviving battle-resume.

**Architecture:** Eggs mirror the existing `GEAR_DROP[source]` weighted-drop pattern: a new `EGG_DROP` table + a `_maybe_drop_egg(doc, source, rng)` helper (reusing Plan 1's `_grant_egg`), called next to the gear-drop rolls at each source. Combat: a pure `engine.pet_combat(pet)` derives four numbers from the active pet; `_combatant(doc)` injects them onto the player's `Combatant` (new fields, defaulted 0), `_bt_snapshot`/`_bt_to_combatant` carry them across resume, and `resolve_round` reads them on the decisive blow — Turtle reduces incoming `dmg`, Fox appends a small extra hit. No client work.

**Tech Stack:** Python 3.11 Lambda, pytest. DB tests use `FakeTable` (`test_undercity_companions.py`); engine tests use `FakeRng` + `fighter()` (`test_undercity_engine.py`).

---

## Verification approach

TDD, same as Plan 1:

- DB/drops tests: `cd infrastructure/lambda && python -m pytest tests/test_undercity_companions.py -q`
- Engine/combat tests: add to `tests/test_undercity_engine.py`; run `python -m pytest tests/test_undercity_engine.py -q`
- Regression: `python -m pytest tests -q` must not exceed the **known pre-existing baseline of 50 failures** (map desync / witch scrolls etc., unrelated to companions). Confirm the companion + engine modules are fully green and the failure count does not rise.

Balance numbers are initial/tunable.

## Design notes (read once)

- **Combat scope:** the pet triggers fire only in the **main decisive-win branch** of `resolve_round` (the `else:` block that computes `dmg` and does `losr.hp -= dmg`), not the guard-counter branch. This is the primary hit — simplest, most legible, and enough for a "small, occasional" nudge. Documented so it isn't mistaken for a gap.
- **No new damage source:** Fox's follow-up is part of the winner's offense (the memory rule forbids *environmental/arena* damage, not pet offense). Turtle only *reduces* damage.
- **RNG order:** each trigger's `rng.random()` is guarded by a truthy pet field (short-circuit), so a fighter with no combat pet consumes no extra RNG — existing combat tests are unaffected.

## Data shapes

```
# engine.pet_combat(pet) -> these four keys, always present:
{'followup_chance': float, 'followup_mult': float,
 'deflect_chance': float,  'deflect_flat': int}
```

---

### Task 1: `EGG_DROP` table + `_maybe_drop_egg` helper

**Files:**
- Modify: `infrastructure/lambda/undercity_data.py`
- Modify: `infrastructure/lambda/undercity_db.py`
- Test: `infrastructure/lambda/tests/test_undercity_companions.py`

- [ ] **Step 1: Write the failing test**

Append to `tests/test_undercity_companions.py`:

```python
class _SeqRng:
    """Deterministic rng: random() replays a script, then returns 0.99."""
    def __init__(self, randoms=None):
        self.randoms = list(randoms or [])
    def random(self):
        return self.randoms.pop(0) if self.randoms else 0.99


def test_maybe_drop_egg_drops_on_low_roll(table):
    sid, doc = _player_at(table, 'n1')
    # chance for 'loot' is EGG_DROP['loot'][0]; a roll below it drops an egg.
    chance = data.EGG_DROP['loot'][0]
    rng = _SeqRng([chance - 0.001, 0.0])   # 1st: pass gate, 2nd: pick tier
    egg = db._maybe_drop_egg(doc, 'loot', rng)
    assert egg is not None
    assert doc['eggs'] and doc['eggs'][0]['id'] == egg['id']
    assert egg['tier'] in data.EGG_DROP['loot'][1]


def test_maybe_drop_egg_noop_on_high_roll(table):
    sid, doc = _player_at(table, 'n1')
    rng = _SeqRng([0.999])
    egg = db._maybe_drop_egg(doc, 'loot', rng)
    assert egg is None
    assert doc['eggs'] == []


def test_maybe_drop_egg_unknown_source_noop(table):
    sid, doc = _player_at(table, 'n1')
    assert db._maybe_drop_egg(doc, 'nope', _SeqRng([0.0])) is None
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `cd infrastructure/lambda && python -m pytest tests/test_undercity_companions.py -k maybe_drop_egg -v`
Expected: FAIL — `AttributeError: module 'undercity_data' has no attribute 'EGG_DROP'`.

- [ ] **Step 3: Add the `EGG_DROP` table**

In `infrastructure/lambda/undercity_data.py`, in the Companions section (below the Plan 1 tables), add:

```python
# Egg drops mirror GEAR_DROP: source -> (chance, {egg_tier: weight}).
# Eggs are rarer than gear; richer sources skew toward higher-tier eggs.
EGG_DROP = {
    'loot':    (0.06, {1: 0.7, 2: 0.3}),
    'mystery': (0.08, {1: 0.5, 2: 0.4, 3: 0.1}),
    'combat':  (0.05, {1: 0.6, 2: 0.4}),
    'cache':   (0.10, {1: 0.4, 2: 0.4, 3: 0.2}),
    'lair':    (0.25, {2: 0.5, 3: 0.4, 4: 0.1}),
}
```

- [ ] **Step 4: Add the `_maybe_drop_egg` helper**

In `infrastructure/lambda/undercity_db.py`, next to `_grant_egg` / `_pick_weighted` (added in Plan 1):

```python
def _maybe_drop_egg(doc, source, rng=None):
    """Roll the EGG_DROP table for a source; grant an egg on success. Returns the
    egg dict or None. Mirrors the GEAR_DROP roll used for gear drops."""
    rng = rng or _rng
    entry = data.EGG_DROP.get(source)
    if not entry:
        return None
    chance, weights = entry
    if rng.random() >= chance:
        return None
    tier = _pick_weighted(rng, weights)
    return _grant_egg(doc, tier)
```

- [ ] **Step 5: Run tests to verify they pass**

Run: `cd infrastructure/lambda && python -m pytest tests/test_undercity_companions.py -k maybe_drop_egg -v`
Expected: PASS (3 tests).

- [ ] **Step 6: Commit**

```bash
git add infrastructure/lambda/undercity_data.py infrastructure/lambda/undercity_db.py infrastructure/lambda/tests/test_undercity_companions.py
git commit -m "feat(undercity): EGG_DROP table + _maybe_drop_egg helper"
```

---

### Task 2: Wire egg drops into the loot / mystery / combat sites

**Files:**
- Modify: `infrastructure/lambda/undercity_db.py` (three call sites)
- Test: `infrastructure/lambda/tests/test_undercity_companions.py`

The three sources roll gear via `data.GEAR_DROP[...]` today. Add a `_maybe_drop_egg` roll beside each, and surface the egg in that path's result payload so the client can announce it.

- [ ] **Step 1: Write the failing integration test**

This forces the egg chance to 1.0 and drives the real mystery path (which existing tests already exercise), asserting an egg lands in the player doc.

```python
def test_mystery_can_drop_egg(table, monkeypatch):
    sid, doc = _player_at(table, 'city_r1')   # a normal board node
    # Force the mystery egg roll to always succeed, tier 1.
    monkeypatch.setitem(db.data.EGG_DROP, 'mystery', (1.0, {1: 1.0}))
    # Force the mystery reel to a benign outcome and drive it.
    before = len(doc.get('eggs') or [])
    db._mystery(table, sid, doc)
    assert len(doc['eggs']) == before + 1
    assert doc['eggs'][-1]['tier'] == 1
```

- [ ] **Step 2: Run test to verify it fails**

Run: `cd infrastructure/lambda && python -m pytest tests/test_undercity_companions.py -k mystery_can_drop_egg -v`
Expected: FAIL — no egg is added (the mystery path doesn't roll eggs yet), so `len == before + 1` fails.

- [ ] **Step 3: Wire the mystery site**

In `undercity_db.py`, inside `_mystery(table, sid, doc)`, immediately after the existing gear-drop roll (the line using `data.GEAR_DROP['mystery']`), add:

```python
        egg = _maybe_drop_egg(doc, 'mystery')
        if egg:
            out['egg'] = {'tier': egg['tier']}
```

(Use the same result-dict variable the function already builds — it is named `out` in `_mystery`; if the local is named differently, attach `egg` to that dict. The egg is persisted because `_mystery` already saves `doc` at its end.)

- [ ] **Step 4: Wire the loot-tile and combat-spoils sites**

Add the identical roll at the other two sources, beside their existing `GEAR_DROP` rolls:

- In the loot-tile resolver (the function rolling `data.GEAR_DROP['loot']`, `_loot_puzzle` / its award helper `_award_gear`), after the gear roll add:

```python
    egg = _maybe_drop_egg(doc, 'loot')
    if egg:
        result['egg'] = {'tier': egg['tier']}
```

- In the combat-victory spoils (the block rolling `data.GEAR_DROP[source]` after a win, in the battle-finish handler), after the gear roll add:

```python
        egg = _maybe_drop_egg(doc, 'combat')
        if egg:
            out['egg'] = {'tier': egg['tier']}
```

Attach `egg` to whatever result dict each path already returns (`result` / `out`). No new save is needed — each path already persists `doc`.

- [ ] **Step 5: Run the integration test + full companion module**

Run: `cd infrastructure/lambda && python -m pytest tests/test_undercity_companions.py -q`
Expected: all PASS (the mystery integration test now adds an egg; the loot/combat wiring is the same one-liner and is covered by the helper's unit tests + full-suite regression).

- [ ] **Step 6: Commit**

```bash
git add infrastructure/lambda/undercity_db.py infrastructure/lambda/tests/test_undercity_companions.py
git commit -m "feat(undercity): drop companion eggs from loot / mystery / combat"
```

---

### Task 3: `PET_COMBAT` table + `engine.pet_combat()`

**Files:**
- Modify: `infrastructure/lambda/undercity_data.py`
- Modify: `infrastructure/lambda/undercity_engine.py`
- Test: `infrastructure/lambda/tests/test_undercity_engine.py`

- [ ] **Step 1: Write the failing test**

Append to `tests/test_undercity_engine.py`:

```python
def test_pet_combat_fox_scales_with_level():
    from undercity_engine import pet_combat
    lo = pet_combat({'species': 'fox', 'tier': 1, 'level': 1})
    hi = pet_combat({'species': 'fox', 'tier': 2, 'level': 4})
    assert lo['followup_chance'] > 0
    assert hi['followup_chance'] > lo['followup_chance']
    assert lo['deflect_chance'] == 0 and lo['deflect_flat'] == 0


def test_pet_combat_turtle_and_noncombat():
    from undercity_engine import pet_combat
    t = pet_combat({'species': 'turtle', 'tier': 1, 'level': 2})
    assert t['deflect_chance'] > 0 and t['deflect_flat'] >= 1
    assert t['followup_chance'] == 0
    # No pet, or a non-combat species -> all zeros.
    assert pet_combat(None)['followup_chance'] == 0
    assert pet_combat({'species': 'bird', 'tier': 1, 'level': 3})['deflect_chance'] == 0
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `cd infrastructure/lambda && python -m pytest tests/test_undercity_engine.py -k pet_combat -v`
Expected: FAIL — `ImportError: cannot import name 'pet_combat'`.

- [ ] **Step 3: Add the `PET_COMBAT` table**

In `undercity_data.py`, in the Companions section:

```python
# Combat-pet magnitudes. Small and level-scaled; the two combat species only.
PET_COMBAT = {
    'fox':    {'followup_chance_base': 0.10, 'followup_chance_per_lvl': 0.03,
               'followup_mult': 0.30},
    'turtle': {'deflect_chance_base': 0.12, 'deflect_chance_per_lvl': 0.03,
               'deflect_flat_base': 2, 'deflect_flat_per_lvl': 0.34},
}
```

- [ ] **Step 4: Add `pet_combat()` to the engine**

In `undercity_engine.py` (which already imports `undercity_data as data`), add near `attribute_perks`:

```python
def pet_combat(pet: dict) -> dict:
    """Derive an active pet's combat contribution: follow-up (Fox) and deflect
    (Turtle), scaled by level. Non-combat species / None -> all zeros."""
    out = {'followup_chance': 0.0, 'followup_mult': 0.0,
           'deflect_chance': 0.0, 'deflect_flat': 0}
    if not pet:
        return out
    cfg = data.PET_COMBAT.get(pet.get('species'))
    if not cfg:
        return out
    lvl = int(pet.get('level', 1))
    if pet['species'] == 'fox':
        out['followup_chance'] = cfg['followup_chance_base'] + cfg['followup_chance_per_lvl'] * (lvl - 1)
        out['followup_mult'] = cfg['followup_mult']
    elif pet['species'] == 'turtle':
        out['deflect_chance'] = cfg['deflect_chance_base'] + cfg['deflect_chance_per_lvl'] * (lvl - 1)
        out['deflect_flat'] = int(cfg['deflect_flat_base'] + cfg['deflect_flat_per_lvl'] * (lvl - 1))
    return out
```

- [ ] **Step 5: Run tests to verify they pass**

Run: `cd infrastructure/lambda && python -m pytest tests/test_undercity_engine.py -k pet_combat -v`
Expected: PASS (2 tests).

- [ ] **Step 6: Commit**

```bash
git add infrastructure/lambda/undercity_data.py infrastructure/lambda/undercity_engine.py infrastructure/lambda/tests/test_undercity_engine.py
git commit -m "feat(undercity): PET_COMBAT table + engine.pet_combat()"
```

---

### Task 4: Combatant pet fields + inject + freeze/restore

**Files:**
- Modify: `infrastructure/lambda/undercity_engine.py` (Combatant dataclass)
- Modify: `infrastructure/lambda/undercity_db.py` (`_combatant`, `_bt_snapshot`, `_bt_to_combatant`)
- Test: `infrastructure/lambda/tests/test_undercity_companions.py`

- [ ] **Step 1: Write the failing test**

Append to `tests/test_undercity_companions.py`:

```python
def test_active_combat_pet_flows_into_combatant(table):
    sid, doc = _player_at(table, 'n1')
    pet = _give_pet(doc, 'fox', tier=1, level=1)
    doc['activePetId'] = pet['id']
    c = db._combatant(doc)
    assert c.pet_followup_chance > 0
    assert c.pet_deflect_chance == 0
    # No active pet -> zeros.
    doc['activePetId'] = None
    assert db._combatant(doc).pet_followup_chance == 0


def test_pet_fields_survive_snapshot_roundtrip(table):
    sid, doc = _player_at(table, 'n1')
    pet = _give_pet(doc, 'turtle', tier=1, level=2)
    doc['activePetId'] = pet['id']
    c = db._combatant(doc)
    restored = db._bt_to_combatant(db._bt_snapshot(c))
    assert restored.pet_deflect_chance == c.pet_deflect_chance
    assert restored.pet_deflect_flat == c.pet_deflect_flat
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `cd infrastructure/lambda && python -m pytest tests/test_undercity_companions.py -k "combat_pet_flows or snapshot_roundtrip" -v`
Expected: FAIL — `AttributeError: 'Combatant' object has no attribute 'pet_followup_chance'`.

- [ ] **Step 3: Add fields to the `Combatant` dataclass**

In `undercity_engine.py`, in the `Combatant` dataclass (class at line 18), add these fields among the other `field(default=..., repr=False)` internals:

```python
    pet_followup_chance: float = field(default=0.0, repr=False)
    pet_followup_mult: float = field(default=0.0, repr=False)
    pet_deflect_chance: float = field(default=0.0, repr=False)
    pet_deflect_flat: int = field(default=0, repr=False)
```

- [ ] **Step 4: Inject in `_combatant`, freeze in `_bt_snapshot`, restore in `_bt_to_combatant`**

In `undercity_db.py` `_combatant(doc)`, compute the active pet's combat contribution and pass the four fields. Replace the `return engine.Combatant(...)` with a version that first resolves the pet:

```python
def _combatant(doc):
    eff = engine.effective_stats(doc)
    pc = engine.pet_combat(_find_pet(doc, doc.get('activePetId')))
    return engine.Combatant(
        name=doc.get('username', '?'), hp=doc['hp'], max_hp=eff['maxHp'],
        atk=eff['atk'], dfn=eff['def'], spd=eff['spd'],
        passives=_passives(doc), stance=doc.get('stance', 'fight'),
        level=doc.get('level', 1),
        riders=_riders(doc), rider_mag=_rider_mags(doc), buffs=_active_buff_kinds(doc),
        perks=engine.attribute_perks(doc),
        has_smoke_spore='smoke_spore' in (doc.get('bag') or []),
        flee_bonus=(15 if any(b.get('kind') == 'glowveil'
                              for b in (doc.get('buffs') or [])) else 0),
        pet_followup_chance=pc['followup_chance'], pet_followup_mult=pc['followup_mult'],
        pet_deflect_chance=pc['deflect_chance'], pet_deflect_flat=pc['deflect_flat'])
```

In `_bt_snapshot(c)`, add to the returned dict:

```python
        'pet_followup_chance': float(c.pet_followup_chance),
        'pet_followup_mult': float(c.pet_followup_mult),
        'pet_deflect_chance': float(c.pet_deflect_chance),
        'pet_deflect_flat': int(c.pet_deflect_flat),
```

In `_bt_to_combatant(s)`, pass them into the `Combatant(...)` constructor:

```python
        pet_followup_chance=float(s.get('pet_followup_chance', 0.0)),
        pet_followup_mult=float(s.get('pet_followup_mult', 0.0)),
        pet_deflect_chance=float(s.get('pet_deflect_chance', 0.0)),
        pet_deflect_flat=int(s.get('pet_deflect_flat', 0)),
```

- [ ] **Step 5: Run tests to verify they pass**

Run: `cd infrastructure/lambda && python -m pytest tests/test_undercity_companions.py -k "combat_pet_flows or snapshot_roundtrip" -v`
Expected: PASS (2 tests).

- [ ] **Step 6: Commit**

```bash
git add infrastructure/lambda/undercity_engine.py infrastructure/lambda/undercity_db.py infrastructure/lambda/tests/test_undercity_companions.py
git commit -m "feat(undercity): carry active-pet combat fields onto the Combatant"
```

---

### Task 5: Fox follow-up in `resolve_round`

**Files:**
- Modify: `infrastructure/lambda/undercity_engine.py` (`resolve_round`, decisive-win branch)
- Test: `infrastructure/lambda/tests/test_undercity_engine.py`

- [ ] **Step 1: Write the failing test**

Append to `tests/test_undercity_engine.py` (uses the module's `fighter()` + `FakeRng`):

```python
def test_fox_followup_adds_extra_hit_on_trigger():
    # Attacker wins aggress vs feint. Fox trigger roll (random()) forced low.
    a = fighter(atk=15, pet_followup_chance=1.0, pet_followup_mult=0.5)
    d = fighter(hp=100, max_hp=100, dfn=4)
    rng = FakeRng(randoms=[0.0], uniform=1.0)   # 0.0 < 1.0 -> follow-up fires
    entries = resolve_round(a, d, 'aggress', 'feint', 1, rng)
    pet_hits = [e for e in entries if e.get('pet') == 'fox']
    assert len(pet_hits) == 1 and pet_hits[0]['dmg'] >= 1


def test_fox_followup_skipped_when_roll_high():
    a = fighter(atk=15, pet_followup_chance=0.2, pet_followup_mult=0.5)
    d = fighter(hp=100, max_hp=100, dfn=4)
    rng = FakeRng(randoms=[0.99], uniform=1.0)   # 0.99 >= 0.2 -> no follow-up
    entries = resolve_round(a, d, 'aggress', 'feint', 1, rng)
    assert not any(e.get('pet') == 'fox' for e in entries)
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `cd infrastructure/lambda && python -m pytest tests/test_undercity_engine.py -k fox_followup -v`
Expected: FAIL — no entry has `pet == 'fox'`.

- [ ] **Step 3: Implement the follow-up**

In `undercity_engine.py`, in `resolve_round`'s decisive-win `else:` branch, immediately after the block that appends the main-hit `entry` (right after `entries.append(entry)` and its `_bramble(...)` call), add:

```python
                # Fox companion: an occasional follow-up nip on the decisive hit.
                if winr.pet_followup_chance and losr.hp > 0 and rng.random() < winr.pet_followup_chance:
                    extra = max(1, round(dmg * winr.pet_followup_mult))
                    losr.hp -= extra
                    entries.append({'round': rnd, 'by': win_side, 'dmg': extra,
                                    'pet': 'fox', 'winner': win_side})
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `cd infrastructure/lambda && python -m pytest tests/test_undercity_engine.py -k fox_followup -v`
Expected: PASS (2 tests).

- [ ] **Step 5: Commit**

```bash
git add infrastructure/lambda/undercity_engine.py infrastructure/lambda/tests/test_undercity_engine.py
git commit -m "feat(undercity): Fox companion follow-up hit in combat"
```

---

### Task 6: Turtle deflect in `resolve_round`

**Files:**
- Modify: `infrastructure/lambda/undercity_engine.py` (`resolve_round`, decisive-win branch)
- Test: `infrastructure/lambda/tests/test_undercity_engine.py`

- [ ] **Step 1: Write the failing test**

```python
def test_turtle_deflect_reduces_decisive_hit():
    # Defender loses the exchange but its Turtle deflects part of the hit.
    a = fighter(atk=15)
    base_d = fighter(hp=100, max_hp=100, dfn=4)
    plain = resolve_round(a, fighter(hp=100, max_hp=100, dfn=4),
                          'aggress', 'feint', 1, FakeRng(uniform=1.0))
    plain_dmg = next(e['dmg'] for e in plain if e.get('winner') == 'attacker' and 'dmg' in e)

    d = fighter(hp=100, max_hp=100, dfn=4, pet_deflect_chance=1.0, pet_deflect_flat=3)
    rng = FakeRng(randoms=[0.0], uniform=1.0)   # deflect fires
    entries = resolve_round(a, d, 'aggress', 'feint', 1, rng)
    hit = next(e['dmg'] for e in entries if e.get('winner') == 'attacker' and 'dmg' in e)
    assert hit == max(0, plain_dmg - 3)
    assert any(e.get('pet') == 'turtle' for e in entries)


def test_turtle_deflect_skipped_when_roll_high():
    a = fighter(atk=15)
    d = fighter(hp=100, max_hp=100, dfn=4, pet_deflect_chance=0.2, pet_deflect_flat=3)
    rng = FakeRng(randoms=[0.99], uniform=1.0)
    entries = resolve_round(a, d, 'aggress', 'feint', 1, rng)
    assert not any(e.get('pet') == 'turtle' for e in entries)
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `cd infrastructure/lambda && python -m pytest tests/test_undercity_engine.py -k turtle_deflect -v`
Expected: FAIL — deflect not applied; `hit == plain_dmg - 3` fails and no `pet == 'turtle'` entry.

- [ ] **Step 3: Implement the deflect**

In `undercity_engine.py` `resolve_round`, in the decisive-win `else:` branch, locate the computed `dmg` and the line `if dmg > 0:` that does `losr.hp -= dmg`. Immediately **before** that `if dmg > 0:` check, add:

```python
            # Turtle companion: occasionally shrugs off part of the decisive hit.
            if dmg > 0 and losr.pet_deflect_chance and rng.random() < losr.pet_deflect_chance:
                blocked = min(dmg, losr.pet_deflect_flat)
                dmg -= blocked
                entries.append({'round': rnd, 'by': lose_side, 'deflect': blocked,
                                'pet': 'turtle'})
```

(`lose_side` is already bound earlier in the branch. This reduces `dmg` before it is applied and before the Fox follow-up computes its `dmg * mult`, so a deflected hit also yields a smaller follow-up — intended.)

- [ ] **Step 4: Run tests to verify they pass**

Run: `cd infrastructure/lambda && python -m pytest tests/test_undercity_engine.py -k turtle_deflect -v`
Expected: PASS (2 tests).

- [ ] **Step 5: Full regression**

Run: `cd infrastructure/lambda && python -m pytest tests/test_undercity_companions.py tests/test_undercity_engine.py -q`
Expected: both modules fully green.
Run: `cd infrastructure/lambda && python -m pytest tests -q`
Expected: failure count does not exceed the pre-existing baseline (50); no new failures.

- [ ] **Step 6: Commit**

```bash
git add infrastructure/lambda/undercity_engine.py infrastructure/lambda/tests/test_undercity_engine.py
git commit -m "feat(undercity): Turtle companion deflects part of the decisive hit"
```

---

## Self-review

- **Spec coverage (Plan 2 scope):** eggs drop from loot/mystery/combat (Tasks 1-2), Fox follow-up (Tasks 3-5), Turtle deflect (Tasks 3,4,6), level scaling (`pet_combat`, Task 3), battle-resume persistence (snapshot/restore, Task 4). Bird/Mouse activated abilities, the Grub trickle, client mirrors, and the Companion UI remain **Plans 3-4**.
- **Placeholder scan:** none — all code steps complete; the loot/combat wiring in Task 2 reuses the exact one-liner shown for mystery, and names the result dict per path. Balance numbers concrete + flagged tunable.
- **Type/name consistency:** `_maybe_drop_egg`, `EGG_DROP`, `pet_combat`, `PET_COMBAT`, and the four Combatant fields (`pet_followup_chance/pet_followup_mult/pet_deflect_chance/pet_deflect_flat`) are named identically across data, engine, db, snapshot/restore, and tests. Reuses Plan 1's `_grant_egg`/`_pick_weighted`/`_find_pet` and the engine's `fighter()`/`FakeRng` harness as they exist.
- **Known risk:** Task 2's loot/combat call sites are described by function + adjacent `GEAR_DROP` anchor rather than line number (the file carries active WIP that shifts lines); the executor attaches the egg to each path's existing result dict. Only the mystery path is integration-tested; loot/combat use the identical, unit-tested helper.
