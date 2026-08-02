# DEF Perk Changes — Thick Hide Hazard Dodge + Last Stand ½ HP Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Turn Thick Hide (DEF-6) into a DEF-scaled chance to fully dodge a hazard (surfaced as "lucky safety wedges" on the hazard wheel, additive to today's HP halving), and make Last Stand (DEF-18) revive at ½ max HP on a real-time 1-hour cooldown instead of at 1 HP once per descent.

**Architecture:** Rules stay server-authoritative (`infrastructure/lambda/`). The server rolls the dodge and stamps a `hazardSafe` flag on the hazard event; the existing cosmetic hazard wheel reads that flag and lands truthfully on a safe wedge. Balance scalars live in `undercity_config.py` (re-exported as `data.*` via `from undercity_config import *`). Client changes are display-only: a new event field, two blurb mirrors, and the wheel + board-tab wiring.

**Tech Stack:** Python 3.11 Lambda (pytest, in-memory FakeTable suite); Angular 20 standalone components (SCSS; no unit-test runner — frontend verified via `npm run build`).

**Spec:** [specs/2026-08-01-undercity-def-perks-hazard-dodge-design.md](2026-08-01-undercity-def-perks-hazard-dodge-design.md)

**Conventions:**
- Run backend tests from `infrastructure/lambda/`: `python -m pytest tests -q`.
- Run a single test: `python -m pytest tests/test_undercity_perks.py::test_name -v`.
- Frontend build (via Bash): `npm run build` from repo root.
- End every commit message with the trailer:
  `Co-Authored-By: Claude Opus 4.8 (1M context) <noreply@anthropic.com>`

---

## File Structure

**Backend (`infrastructure/lambda/`):**
- `undercity_config.py` — new balance scalars: `THICK_HIDE_DODGE_*`, `LAST_STAND_HP_FRAC`, `LAST_STAND_COOLDOWN_MINUTES`.
- `undercity_db.py` — `_hazard_dodge_chance()` helper; dodge gate in `_hazard` / `_dungeon_hazard` with `hazardSafe` stamping; Last Stand ½-HP + 1h-cooldown rewrite in `_finish_battle`; delete the per-descent reset in `handle_action`'s surfacing logic.
- `undercity_data.py` — updated `thick_hide` / `last_stand` blurbs in `PERKS`.
- `tests/test_undercity_db.py` — new hazard-dodge tests (reuse the `_player_at` helper).
- `tests/test_undercity_perks.py` — dodge-chance math test; rewrite the two Last Stand tests for the new HP + cooldown.

**Frontend (`src/app/undercity/`):**
- `services/undercity-models.ts` — `hazardSafe?: boolean` on `SpaceEvent`.
- `data/perks.ts` — mirror the two updated blurbs.
- `tabs/hazard-wheel.component.ts` — `safe` face + `SAFE_TEASE_SLOTS`; `HazardWheelTarget` gains `hasPerk?` / `safe?`; winner + tease wedges + caption.
- `tabs/board-tab.component.ts` — `hazardWheelTarget` reads `ev.hazardSafe`.

---

## Task 1: Config scalars + dodge-chance helper

**Files:**
- Modify: `infrastructure/lambda/undercity_config.py` (after line 101, `THICK_HIDE_MULT`)
- Modify: `infrastructure/lambda/undercity_db.py` (add helper just above `def _hazard`, ~line 3239)
- Test: `infrastructure/lambda/tests/test_undercity_perks.py`

- [ ] **Step 1: Write the failing test**

Add to `tests/test_undercity_perks.py` under the Thick Hide section (near line 199):

```python
def test_hazard_dodge_chance_scales_and_caps():
    # Base 0.15 at def 6, +0.02/pt, capped 0.40; dungeon halves.
    lo = {'atk': 1, 'def': 6, 'spd': 1}          # perk-stat 6
    mid = {'atk': 1, 'def': 12, 'spd': 1}        # perk-stat 12
    cap = {'atk': 1, 'def': 30, 'spd': 1}        # would be 0.63 -> capped
    assert db._hazard_dodge_chance(lo) == pytest.approx(0.15)
    assert db._hazard_dodge_chance(mid) == pytest.approx(0.27)
    assert db._hazard_dodge_chance(cap) == pytest.approx(0.40)
    # Dungeon is half the surface chance.
    assert db._hazard_dodge_chance(mid, dungeon=True) == pytest.approx(0.135)
```

Confirm `import pytest` and `import undercity_db as db` are already at the top of the file (they are used by existing tests); add `import pytest` if missing.

- [ ] **Step 2: Run test to verify it fails**

Run: `python -m pytest tests/test_undercity_perks.py::test_hazard_dodge_chance_scales_and_caps -v`
Expected: FAIL with `AttributeError: module 'undercity_db' has no attribute '_hazard_dodge_chance'`

- [ ] **Step 3: Add the config scalars**

In `undercity_config.py`, immediately after line 101 (`THICK_HIDE_MULT = 0.5 ...`):

```python
# DEF-6 Thick Hide hazard dodge (design 2026-08-01): a DEF-scaled chance to avoid
# a hazard entirely, surfaced as "lucky safety wedges" on the hazard wheel. Scales
# with the DEF perk-stat (base + gear, temp buffs excluded); depths hazards dodge
# at half the chance so the boss approach stays brutal. The THICK_HIDE_MULT halving
# above still applies on a hit — the dodge is additive.
THICK_HIDE_DODGE_BASE = 0.15         # dodge chance at DEF perk-stat 6 (tier-1 unlock)
THICK_HIDE_DODGE_PER_DEF = 0.02      # +chance per DEF point above 6
THICK_HIDE_DODGE_MAX = 0.40          # cap
THICK_HIDE_DODGE_DUNGEON_MULT = 0.5  # depths/dungeon hazards dodge at half the surface chance

# DEF-18 Last Stand (design 2026-08-01): revive at half max HP on an otherwise-
# lethal blow, recharging on a real-time cooldown instead of once per descent.
LAST_STAND_HP_FRAC = 0.5             # fraction of max HP to revive at (was a flat 1)
LAST_STAND_COOLDOWN_MINUTES = 60     # real-time recharge between saves
```

- [ ] **Step 4: Add the helper**

In `undercity_db.py`, directly above `def _hazard(table, sid, doc, node):` (~line 3239):

```python
def _hazard_dodge_chance(doc, dungeon=False):
    """Thick Hide (DEF-6): DEF-scaled chance to fully dodge a hazard. Scales with
    the DEF perk-stat (base + gear; temp buffs excluded — same value that lights
    the perk), capped, and halved in the depths so the boss approach stays hard."""
    d = engine.perk_stat(doc, 'def')
    chance = min(data.THICK_HIDE_DODGE_MAX,
                 data.THICK_HIDE_DODGE_BASE
                 + data.THICK_HIDE_DODGE_PER_DEF * max(0, d - 6))
    if dungeon:
        chance *= data.THICK_HIDE_DODGE_DUNGEON_MULT
    return chance
```

- [ ] **Step 5: Run test to verify it passes**

Run: `python -m pytest tests/test_undercity_perks.py::test_hazard_dodge_chance_scales_and_caps -v`
Expected: PASS

- [ ] **Step 6: Commit**

```bash
git add infrastructure/lambda/undercity_config.py infrastructure/lambda/undercity_db.py infrastructure/lambda/tests/test_undercity_perks.py
git commit -m "feat(undercity): DEF-scaled hazard-dodge chance helper + config"
```

---

## Task 2: Surface hazard dodge in `_hazard`

**Files:**
- Modify: `infrastructure/lambda/undercity_db.py:3239-3265` (`_hazard`)
- Test: `infrastructure/lambda/tests/test_undercity_db.py` (near the existing hazard tests, ~line 1790)

Behavior: for a `thick_hide` creature, roll `_rng.random()` against the surface dodge chance. On a dodge return a "safe" event that applies nothing; on a hit apply today's effect and stamp `hazardSafe: False`. Non-perk creatures are unchanged (no roll, no `hazardSafe`).

- [ ] **Step 1: Write the failing tests**

Add to `tests/test_undercity_db.py` after `test_dungeon_hazard_stamps_biome` (~line 1817). `_player_at` returns `(sid, doc)` with a pest (base def 5); bump `def` to unlock the perk.

```python
def test_surface_hazard_dodged_by_thick_hide(table, monkeypatch):
    # def 8 -> thick_hide; surface chance 0.19, so random()=0.0 always dodges.
    sid, doc = _player_at(table, 'city_r4')
    doc['def'] = 8
    doc['hp'] = 25
    doc['spores'] = 50
    monkeypatch.setattr(db._rng, 'random', lambda: 0.0)
    out = db._hazard(table, sid, doc, 'city_r4')
    assert out['hazardSafe'] is True
    assert out['hazardOutcome'] == 'safe'
    assert doc['hp'] == 25 and doc['spores'] == 50      # nothing applied
    assert not doc.get('buffs')                          # no vines etc.


def test_surface_hazard_hit_flags_not_safe_for_perk(table, monkeypatch):
    # Same creature, but the dodge roll fails (0.99 > 0.19): today's effect lands
    # AND the event carries hazardSafe=False so the wheel shows tease wedges.
    sid, doc = _player_at(table, 'city_r4')
    doc['def'] = 8
    monkeypatch.setattr(db._rng, 'random', lambda: 0.99)
    monkeypatch.setattr(db._rng, 'choice', lambda seq: 'spore_cloud')
    out = db._hazard(table, sid, doc, 'city_r4')
    assert out['hazardSafe'] is False
    assert out['hazardOutcome'] == 'spore_cloud'
    assert out['hp'] < 0                                 # HP was actually lost


def test_surface_hazard_no_perk_has_no_safe_field(table, monkeypatch):
    # Pest (def 5) never rolls a dodge; behaviour identical to today.
    sid, doc = _player_at(table, 'city_r4')
    monkeypatch.setattr(db._rng, 'choice', lambda seq: 'vines')
    out = db._hazard(table, sid, doc, 'city_r4')
    assert 'hazardSafe' not in out
    assert out['hazardOutcome'] == 'vines'
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `python -m pytest tests/test_undercity_db.py -k "surface_hazard_dodged or surface_hazard_hit or surface_hazard_no_perk" -v`
Expected: FAIL (`test_surface_hazard_dodged...` KeyError `hazardSafe`; others also fail on missing/False flag)

- [ ] **Step 3: Rewrite `_hazard`**

Replace the whole body of `_hazard` (lines 3239-3265) with (converts the three early-returns to a single `out` return so the perk stamp is applied once):

```python
def _hazard(table, sid, doc, node):
    # Mirefoot hatch perk: bog natives shrug off half of any hazard's cost.
    mire = doc.get('homeBiome') == 'bog'
    biome = _depths_biome(table, sid, node)
    if biome:
        return _dungeon_hazard(table, sid, doc, node, biome, mire)
    # Thick Hide (DEF-6): a DEF-scaled chance to dodge the hazard entirely. The
    # server decides; the client's hazard wheel lands on a lucky safety wedge.
    perk = 'thick_hide' in engine.attribute_perks(doc)
    if perk and _rng.random() < _hazard_dodge_chance(doc, dungeon=False):
        return {'type': 'hazard', 'hazardOutcome': 'safe', 'hazardSafe': True,
                'text': 'Your thick hide shrugs it off — no harm done. (Thick Hide)'}
    # `hazardOutcome` reports which generic effect rolled so the client's hazard
    # wheel can land on it truthfully (dungeon hazards carry `biome` instead).
    kind = _rng.choice(['swamp_gas', 'vines', 'spore_cloud'])
    if kind == 'swamp_gas':
        lost = min(doc.get('spores', 0), _rng.randint(1, 10))
        if mire:
            lost //= 2
        doc['spores'] = doc.get('spores', 0) - lost
        out = {'type': 'hazard', 'hazardOutcome': kind,
               'text': f'Swamp gas! You drop {lost} Spores in the scramble.',
               'sporesLost': lost}
    elif kind == 'vines':
        if mire:
            out = {'type': 'hazard', 'hazardOutcome': kind,
                   'text': 'Grasping vines slide off your mire-slick hide. (Mirefoot)'}
        else:
            doc.setdefault('buffs', []).append({'kind': 'vines'})
            out = {'type': 'hazard', 'hazardOutcome': kind,
                   'text': 'Grasping vines coil around you — your next roll is halved.'}
    else:
        dmg = _apply_hp_loss(doc, round(doc['hp'] * (0.075 if mire else 0.15)))
        out = {'type': 'hazard', 'hazardOutcome': kind,
               'text': f'A choking spore cloud! You lose {dmg} HP.', 'hp': -dmg}
    if perk:
        out['hazardSafe'] = False
    return out
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `python -m pytest tests/test_undercity_db.py -k "surface_hazard" -v`
Expected: PASS (new tests **and** the existing `test_surface_hazard_stamps_outcome` / `test_surface_hazard_unchanged`)

- [ ] **Step 5: Commit**

```bash
git add infrastructure/lambda/undercity_db.py infrastructure/lambda/tests/test_undercity_db.py
git commit -m "feat(undercity): Thick Hide dodges surface hazards via safety wedges"
```

---

## Task 3: Dungeon hazard dodge in `_dungeon_hazard`

**Files:**
- Modify: `infrastructure/lambda/undercity_db.py:3268-3318` (`_dungeon_hazard`)
- Test: `infrastructure/lambda/tests/test_undercity_db.py`

Behavior: same dodge, but at the reduced dungeon chance. On a dodge, apply nothing and return a "safe" event that still carries `biome` (so the wheel can pick the lair silhouette for the tease). On a hit, stamp `hazardSafe: False`.

- [ ] **Step 1: Write the failing tests**

Add to `tests/test_undercity_db.py` after the Task-2 tests:

```python
def test_dungeon_hazard_dodged_by_thick_hide(table, monkeypatch):
    # def 8 -> thick_hide; dungeon chance 0.095, random()=0.0 always dodges.
    sid, doc = _player_at(table, 'city_d1')   # webbing lair hazard
    doc['def'] = 8
    doc['hp'] = 25
    monkeypatch.setattr(db._rng, 'random', lambda: 0.0)
    out = db._hazard(table, sid, doc, 'city_d1')
    assert out['hazardSafe'] is True
    assert out['biome'] == 'city'
    assert doc['hp'] == 25                     # no bleed
    assert not any(b.get('kind') == 'vines' for b in doc.get('buffs', []))


def test_dungeon_dodge_uses_reduced_chance(table, monkeypatch):
    # random()=0.15 dodges at the surface chance (0.19) but NOT the dungeon
    # chance (0.095) — proving the dungeon halving is applied.
    sid, doc = _player_at(table, 'city_d1')
    doc['def'] = 8
    doc['hp'] = 25
    monkeypatch.setattr(db._rng, 'random', lambda: 0.15)
    out = db._hazard(table, sid, doc, 'city_d1')
    assert out['hazardSafe'] is False          # not dodged in the depths
    assert out['hazardId'] == 'webbing'        # today's effect landed


def test_dungeon_hazard_no_perk_has_no_safe_field(table):
    sid, doc = _player_at(table, 'city_d1')    # pest, def 5
    out = db._hazard(table, sid, doc, 'city_d1')
    assert 'hazardSafe' not in out
    assert out['hazardId'] == 'webbing'
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `python -m pytest tests/test_undercity_db.py -k "dungeon_hazard_dodged or dungeon_dodge_uses or dungeon_hazard_no_perk" -v`
Expected: FAIL (`hazardSafe` KeyError on the dodge test)

- [ ] **Step 3: Edit `_dungeon_hazard`**

Add the dodge gate at the very top of the function body (right after the docstring, before `nodes = _season_map(...)` at line 3274):

```python
    # Thick Hide (DEF-6): DEF-scaled dodge at the reduced dungeon chance. The
    # lair curse still reports its biome so the wheel shows this lair's tease.
    perk = 'thick_hide' in engine.attribute_perks(doc)
    if perk and _rng.random() < _hazard_dodge_chance(doc, dungeon=True):
        return {'type': 'hazard', 'biome': biome, 'hazardSafe': True,
                'text': "The lair's curse slides off your carapace. (Thick Hide)"}
```

Then, at the end of the function, change the final `return out` (line 3318) to:

```python
    if perk:
        out['hazardSafe'] = False
    return out
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `python -m pytest tests/test_undercity_db.py -k "dungeon" -v`
Expected: PASS (new tests **and** existing `test_dungeon_hazard_stamps_biome`, `test_webbing_snares_two_rolls_and_bleeds`, `test_spore_cloud_teleports_and_bleeds`, etc.)

- [ ] **Step 5: Commit**

```bash
git add infrastructure/lambda/undercity_db.py infrastructure/lambda/tests/test_undercity_db.py
git commit -m "feat(undercity): Thick Hide dodges depths hazards at reduced chance"
```

---

## Task 4: Last Stand → ½ max HP on a 1-hour cooldown

**Files:**
- Modify: `infrastructure/lambda/undercity_db.py:3762-3771` (`_finish_battle` Last Stand branch)
- Modify: `infrastructure/lambda/undercity_db.py:2938-2940` (remove per-descent reset)
- Test: `infrastructure/lambda/tests/test_undercity_perks.py:203-226` (rewrite the two Last Stand tests)

- [ ] **Step 1: Rewrite the two failing tests**

Replace `test_last_stand_survives_once_per_descent` and `test_last_stand_not_triggered_without_perk` (lines 203-226) with the four tests below. `_finish_started_battle` returns the `spaceEvent`, whose `battle` key is the raw `result` dict — so `se['battle']['outcome']` is `'timeout'` + `se['battle']['lastStand']` is `True` when the save fires, and `'defender'` when it doesn't (same observable the flee test at `test_undercity_db.py:2956` uses).

```python
def test_last_stand_revives_at_half_max_hp(table, monkeypatch):
    act(table, 'join', starter='pest')
    sid = _sid(table)
    doc = db._get_player(table, sid, 'user-alex')
    doc['def'] = 18   # unlock last_stand (and carapace_grind +15 maxHp)
    doc['hp'] = 20
    db._put_player(table, doc)
    doc = db._get_player(table, sid, 'user-alex')
    db._wild_battle(table, sid, doc)
    se = _finish_started_battle(table, monkeypatch, doc, outcome='defender', defender_hp=5)
    assert se['battle']['outcome'] == 'timeout'   # survived, but no win
    assert se['battle'].get('lastStand') is True
    you = db._get_player(table, sid, 'user-alex')
    mh = db.engine.effective_stats(you)['maxHp']
    assert you['hp'] == max(1, round(mh * 0.5))   # rose at half max HP
    assert you.get('lastStandReadyAt')            # cooldown stamped


def test_last_stand_on_cooldown_does_not_save(table, monkeypatch):
    act(table, 'join', starter='pest')
    sid = _sid(table)
    doc = db._get_player(table, sid, 'user-alex')
    doc['def'] = 18
    doc['hp'] = 20
    doc['lastStandReadyAt'] = '2999-01-01T00:00:00'   # far-future: still charging
    db._put_player(table, doc)
    doc = db._get_player(table, sid, 'user-alex')
    db._wild_battle(table, sid, doc)
    se = _finish_started_battle(table, monkeypatch, doc, outcome='defender', defender_hp=5)
    assert se['battle']['outcome'] == 'defender'      # not saved
    assert not se['battle'].get('lastStand')


def test_last_stand_recharges_after_cooldown(table, monkeypatch):
    act(table, 'join', starter='pest')
    sid = _sid(table)
    doc = db._get_player(table, sid, 'user-alex')
    doc['def'] = 18
    doc['hp'] = 20
    doc['lastStandReadyAt'] = '2000-01-01T00:00:00'   # already elapsed
    db._put_player(table, doc)
    doc = db._get_player(table, sid, 'user-alex')
    db._wild_battle(table, sid, doc)
    se = _finish_started_battle(table, monkeypatch, doc, outcome='defender', defender_hp=5)
    assert se['battle']['outcome'] == 'timeout'       # saved again
    assert se['battle'].get('lastStand') is True


def test_last_stand_not_triggered_without_perk(table, monkeypatch):
    act(table, 'join', starter='pest')  # base def 5, no last_stand
    sid = _sid(table)
    doc = db._get_player(table, sid, 'user-alex')
    db._wild_battle(table, sid, doc)
    se = _finish_started_battle(table, monkeypatch, doc, outcome='defender', defender_hp=5)
    assert se['battle']['outcome'] == 'defender'
    you = db._get_player(table, sid, 'user-alex')
    assert not you.get('lastStandReadyAt')
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `python -m pytest tests/test_undercity_perks.py -k last_stand -v`
Expected: FAIL (revive still sets hp=1; `lastStandReadyAt` never set)

- [ ] **Step 3: Rewrite the Last Stand branch**

Replace lines 3762-3771 in `_finish_battle`:

```python
    # Last Stand (DEF-18 perk): survive an otherwise-lethal blow, rising at half
    # max HP, on a real-time cooldown (design 2026-08-01 — was 1 HP once/descent).
    # It doesn't turn a loss into a win — the outcome drops to a 'timeout' (no
    # compost, no reward; a persistent-pool foe lingers).
    _ls_ready = (not doc.get('lastStandReadyAt')) or doc['lastStandReadyAt'] <= _now()
    if (result['attackerHp'] <= 0 and _ls_ready
            and 'last_stand' in engine.attribute_perks(doc)):
        ready = datetime.utcnow() + timedelta(minutes=data.LAST_STAND_COOLDOWN_MINUTES)
        doc['lastStandReadyAt'] = ready.isoformat(timespec='seconds')
        max_hp = engine.effective_stats(doc)['maxHp']
        result['attackerHp'] = max(1, round(max_hp * data.LAST_STAND_HP_FRAC))
        if result['outcome'] == 'defender':
            result['outcome'] = 'timeout'
        result['lastStand'] = True
```

- [ ] **Step 4: Remove the per-descent reset**

Delete lines 2938-2940 in `handle_action`'s surfacing block:

```python
    # Last Stand recharges on surfacing (once-per-descent).
    if region != 'depths' and doc.get('lastStandUsed'):
        doc.pop('lastStandUsed', None)
```

(Keep the `restsUsed` reset immediately above it. Availability is now time-based; legacy `lastStandUsed` booleans are simply ignored — no migration.)

- [ ] **Step 5: Run tests to verify they pass**

Run: `python -m pytest tests/test_undercity_perks.py -k last_stand -v`
Expected: PASS

- [ ] **Step 6: Run the whole backend suite (guard the removed field)**

Run: `python -m pytest tests -q`
Expected: PASS. In particular confirm the flee test that sets `doc['lastStandUsed'] = True` (`tests/test_undercity_db.py:2951`) still passes — its creature is a pest (def 5, no `last_stand` perk), so the removed field never mattered. If it fails, it is because that creature somehow has the perk; fix by asserting no-perk rather than relying on the flag.

- [ ] **Step 7: Commit**

```bash
git add infrastructure/lambda/undercity_db.py infrastructure/lambda/tests/test_undercity_perks.py
git commit -m "feat(undercity): Last Stand revives at half max HP on a 1h cooldown"
```

---

## Task 5: Update perk blurbs (server)

**Files:**
- Modify: `infrastructure/lambda/undercity_data.py:218-223`

- [ ] **Step 1: Edit the blurbs**

Replace the `thick_hide` and `last_stand` blurbs:

```python
    'thick_hide':     {'name': 'Thick Hide', 'track': 'def', 'threshold': 6,
                       'blurb': 'A chance to dodge hazards entirely; if caught, your hide still halves the HP loss.'},
    'carapace_grind': {'name': 'Carapace Grind', 'track': 'def', 'threshold': 12,
                       'blurb': '+15 Max HP, and holding Guard grinds the foe down even when you don’t win the exchange.'},
    'last_stand':     {'name': 'Last Stand', 'track': 'def', 'threshold': 18,
                       'blurb': 'Survive one lethal blow, rising at half your max HP. Recharges every hour.'},
```

(Only `thick_hide` and `last_stand` change; `carapace_grind` is shown for context — leave it as-is.)

- [ ] **Step 2: Verify nothing broke**

Run: `python -m pytest tests -q`
Expected: PASS

- [ ] **Step 3: Commit**

```bash
git add infrastructure/lambda/undercity_data.py
git commit -m "feat(undercity): update Thick Hide / Last Stand perk blurbs"
```

---

## Task 6: Client model + blurb mirror

**Files:**
- Modify: `src/app/undercity/services/undercity-models.ts` (after `biome?` at line 627)
- Modify: `src/app/undercity/data/perks.ts:38,40`

- [ ] **Step 1: Add the `hazardSafe` field to `SpaceEvent`**

In `undercity-models.ts`, right after the `biome?: string;` block (line 627):

```typescript
  /** Present only when the player has Thick Hide: true = the hazard was dodged
   *  (wheel lands on a lucky safety wedge), false = caught (wheel shows a tease).
   *  Mirrors undercity_db._hazard / _dungeon_hazard. */
  hazardSafe?: boolean;
```

- [ ] **Step 2: Mirror the two blurbs in `perks.ts`**

Replace lines 38 and 40:

```typescript
  thick_hide: { id: 'thick_hide', name: 'Thick Hide', track: 'def', threshold: 6, blurb: 'A chance to dodge hazards entirely; if caught, your hide still halves the HP loss.' },
```

```typescript
  last_stand: { id: 'last_stand', name: 'Last Stand', track: 'def', threshold: 18, blurb: 'Survive one lethal blow, rising at half your max HP. Recharges every hour.' },
```

- [ ] **Step 3: Commit** (build is verified in Task 9)

```bash
git add src/app/undercity/services/undercity-models.ts src/app/undercity/data/perks.ts
git commit -m "feat(undercity): mirror hazardSafe field + perk blurbs on the client"
```

---

## Task 7: Hazard wheel — safe face, tease wedges, caption

**Files:**
- Modify: `src/app/undercity/tabs/hazard-wheel.component.ts`

- [ ] **Step 1: Extend the target interface + add the safe face**

In `HazardWheelTarget` (lines 13-19) add two optional fields:

```typescript
export interface HazardWheelTarget {
  mode: 'surface' | 'dungeon';
  /** Surface: which generic effect rolled (swamp_gas|vines|spore_cloud|safe). */
  outcome?: string;
  /** Dungeon: the lair boss's art id (undercity/guardians/<id>.png). */
  bossId?: string;
  /** Thick Hide active — render a couple of "safe" tease wedges. */
  hasPerk?: boolean;
  /** The hazard was dodged — the winning wedge is a lucky safety wedge. */
  safe?: boolean;
}
```

After `const EFFECT_KEYS = Object.keys(EFFECTS);` (line 32) add a standalone safe
face (kept **out** of `EFFECTS`/`EFFECT_KEYS` so non-perk wheels never show it):

```typescript
/** Lucky "you dodged" face — only shown to Thick Hide creatures. Kept out of the
 *  EFFECT_KEYS cycle so a non-perk wheel is byte-for-byte unchanged. */
const SAFE_FACE: Effect = { icon: 'verified', color: '#7fce8f' };
const SAFE_TEASE_SLOTS = [3, 5]; // surface loser wedges that tease a safe result
```

- [ ] **Step 2: Rewrite `buildWedges` to place safe wedges**

Replace `buildWedges` (lines 295-314) with:

```typescript
  private buildWedges(): Wedge[] {
    const isDungeon = this.target.mode === 'dungeon';
    const safe = this.target.safe === true;
    const outcome = EFFECTS[this.target.outcome ?? ''] ? this.target.outcome! : 'spore_cloud';
    return Array.from({ length: WEDGE_COUNT }, (_, i) => {
      const deg = i * (360 / WEDGE_COUNT);
      const base = {
        pos: `rotate(${deg}deg) translateY(-${SYM_RADIUS}px)`,
        upright: `rotate(${-deg}deg)`,
      };
      if (isDungeon) {
        // Winner (0) is a safe decoy on a Thick-Hide dodge, else the lair boss.
        if ((i === 0 && safe) || (i !== 0 && DUNGEON_DECOY_SLOTS.includes(i))) {
          return { kind: 'decoy', icon: SAFE_FACE.icon, color: SAFE_FACE.color, ...base };
        }
        return { kind: 'boss', icon: '', color: '', ...base };
      }
      // Surface. Winner (0): the safe glyph on a dodge, else the rolled effect.
      if (i === 0) {
        const face = safe ? SAFE_FACE : EFFECTS[outcome];
        return { kind: 'effect', icon: face.icon, color: face.color, ...base };
      }
      // Thick-Hide players also see a couple of "safe" tease wedges among losers.
      if (this.target.hasPerk && SAFE_TEASE_SLOTS.includes(i)) {
        return { kind: 'effect', icon: SAFE_FACE.icon, color: SAFE_FACE.color, ...base };
      }
      const key = EFFECT_KEYS[i % EFFECT_KEYS.length];
      return { kind: 'effect', icon: EFFECTS[key].icon, color: EFFECTS[key].color, ...base };
    });
  }
```

- [ ] **Step 3: Update the caption for a dodge**

Replace `caption()` (lines 274-276):

```typescript
  protected caption(): string {
    if (this.target.safe) return 'Dodged! (Thick Hide)';
    return this.target.mode === 'dungeon' ? 'The lair claims you.' : 'No dodging that.';
  }
```

- [ ] **Step 4: Commit** (build verified in Task 9)

```bash
git add src/app/undercity/tabs/hazard-wheel.component.ts
git commit -m "feat(undercity): hazard wheel shows lucky safety wedges for Thick Hide"
```

---

## Task 8: Board-tab wires `hazardSafe` into the wheel target

**Files:**
- Modify: `src/app/undercity/tabs/board-tab.component.ts:1591-1596` (`hazardWheelTarget`)

- [ ] **Step 1: Read `ev.hazardSafe` when building the target**

Replace `hazardWheelTarget` (lines 1588-1596):

```typescript
  /** Map a hazard event to the wheel it should spin. A dungeon hazard carries a
   *  `biome` (→ that lair's boss silhouette); a surface hazard carries a rolled
   *  `hazardOutcome` (→ one of the three generic effect faces). A Thick Hide
   *  creature also gets `hazardSafe` (present ⇒ show tease wedges; true ⇒ dodged). */
  private hazardWheelTarget(ev: SpaceEvent): HazardWheelTarget {
    const hasPerk = ev.hazardSafe !== undefined;
    const safe = ev.hazardSafe === true;
    if (ev.biome && DUNGEONS[ev.biome]) {
      return { mode: 'dungeon', bossId: DUNGEONS[ev.biome].lairNpcId, hasPerk, safe };
    }
    return { mode: 'surface', outcome: safe ? 'safe' : ev.hazardOutcome, hasPerk, safe };
  }
```

- [ ] **Step 2: Commit** (build verified in Task 9)

```bash
git add src/app/undercity/tabs/board-tab.component.ts
git commit -m "feat(undercity): route hazardSafe into the hazard wheel target"
```

---

## Task 9: Frontend build + manual verification

**Files:** none (verification only)

- [ ] **Step 1: Type-check + build the app**

Run (from repo root, via Bash): `npm run build`
Expected: build completes with no TypeScript errors. If the compiler flags an
unused `EFFECT_KEYS` or type mismatch on `HazardWheelTarget`, fix inline and rebuild.

- [ ] **Step 2: Manual smoke test (documented, run against the live backend per the run-undercity skill)**

Confirm, on a Thick-Hide creature (DEF ≥ 6):
- Surface hazard → wheel shows 1-2 green "verified" tease wedges; on a dodge it
  lands on the green wedge with caption "Dodged! (Thick Hide)" and the card reads
  "no harm done"; on a hit it lands on the effect with the normal card.
- Dungeon hazard → on a dodge lands on a green decoy ("curse slides off"); on a
  hit lands on the boss silhouette as before.
- A creature **without** the perk sees the wheel exactly as today (no green wedges).

- [ ] **Step 3: Final commit if any build fixes were needed**

```bash
git add -A
git commit -m "fix(undercity): build fixes for hazard-dodge wheel"
```

(Skip if Step 1 was clean.)

---

## Done criteria

- `python -m pytest tests -q` green from `infrastructure/lambda/`.
- `npm run build` green from repo root.
- Thick Hide gives a DEF-scaled hazard dodge (surface + reduced dungeon), additive to the existing HP halving; bad-mystery halving untouched.
- Last Stand revives at ½ max HP on a real-time 1-hour cooldown; no per-descent reset remains.
- Perk blurbs updated on server and client mirrors.
