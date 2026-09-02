# Step-Based Spell Cooldowns Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Convert Undercity spell cooldowns, grimoire swap, and Last Stand from real-time minutes to board spaces walked, and show each spell's step cost in the Gear menu's Spells section.

**Architecture:** Each timer becomes a plain integer countdown stored on the player document, decremented in the existing `_tick_step_timers(doc, spaces)` hook (one call site, in the surface move handler). This follows the companion step-timer idiom already in the codebase (`forageRecharge`, `petRecharge`, `incubator.spacesLeft`) rather than introducing a step odometer. Legacy ISO-string values read as "ready" and are pruned, so no data migration is needed.

**Tech Stack:** Python 3.11 Lambda (pytest, no boto3 in engine code), Angular 20 standalone components (signals, SCSS), a generated TS mirror produced by `sync_spells.py`.

**Design doc:** [2026-09-02-undercity-step-based-spell-cooldowns-design.md](2026-09-02-undercity-step-based-spell-cooldowns-design.md)

---

## Orientation for the implementer

Things about this codebase that are not obvious and will cost you time if you miss them:

- **Run tests with** `cd infrastructure/lambda && python -m pytest tests -q`. The suite is an in-memory `FakeTable` integration suite — no AWS needed. Keep it green at every commit.
- **Verify the frontend with** `npm run build` from the repo root. **Do not trust `npm run lint`** — it is unreliable in this repo. There is no frontend test runner (`ng test` does not work; the specs were removed).
- **`src/app/undercity/data/spells.generated.ts` is generated.** Never hand-edit it. After changing the Python spell tables run `python infrastructure/lambda/sync_spells.py`. A pytest (`tests/test_spells_generated.py`) fails while the Python and TS copies disagree.
- **`docs/` is build output and is wiped by every build.** Never put a document there. Committed docs live in `specs/`.
- **The user commits and deploys themselves.** Do not run `cdk deploy` or `npm run deploy`. Finish with tests green and say a deploy is needed.
- **The user may have unrelated work in progress** in the same files (especially `src/app/undercity/tabs/creature-tab.component.*`). Before each commit, `git status` and stage only the exact files the task names. Never `git add -A`.
- **No emoji in game UI.** Use Material icon ligatures or the project's `uc-*` SVG icons.
- Server balance numbers live in `infrastructure/lambda/undercity_config.py` (scalars) and `undercity_data.py` (tables). Client display mirrors duplicate them and must be updated in the same change.

### File map

| File | Responsibility | Change |
|---|---|---|
| `infrastructure/lambda/undercity_data.py` | spell table (source of truth) | `cooldownMin` → `cooldownSteps` on 32 spells |
| `infrastructure/lambda/undercity_config.py` | scalar tunables | swap + Last Stand step constants |
| `infrastructure/lambda/undercity_db.py` | I/O, action dispatch, all three timers | cooldown helpers, pruner, tick, move fallback |
| `infrastructure/lambda/sync_spells.py` | generates the TS mirror | emit `cooldownSteps` |
| `src/app/undercity/data/spells.ts` | types + helpers | `cooldownLeftSteps`, `grimoireSwapLeftSteps` |
| `src/app/undercity/data/spells.generated.ts` | generated data arrays | regenerate only |
| `src/app/undercity/services/undercity-models.ts` | player model | field types |
| `src/app/undercity/tabs/creature-tab.component.{ts,html,scss}` | Gear menu Spells + Library | labels + cost chip |
| `src/app/undercity/tabs/board-tab.component.ts` | board spell list | labels |
| `specs/undercity-spells.md` | living reference | player rules + file map |

### Task order and why

Tasks 1–5 are server-side and each leaves the suite green. Task 6 regenerates the mirror. Tasks 7–9 are client-side. Task 10 updates the reference doc. Task 5 (the move-handler fallback) must land **before** you believe any manual playtest, because without it a cooldown started in Task 2 would never tick down.

---

## Task 1: Spell table — `cooldownMin` → `cooldownSteps`

**Files:**
- Modify: `infrastructure/lambda/undercity_data.py` (the `SPELLS` dict, ~lines 762–925, and its header comment)
- Test: `infrastructure/lambda/tests/test_undercity_spells.py:90` and `:1179`

The full conversion (minutes ÷ 5, rounded):

| steps | spells |
|---:|---|
| 3 | `ember_fleck`, `acorn_fury` |
| 4 | `spore_bolt`, `mend_flesh`, `harden_shell` |
| 5 | `skitter_step`, `sinkstep`, `rot_bolt`, `weaken_hex`, `withering_gout`, `renewing_bloom`, `shadowstep`, `savage_roar`, `iron_hide`, `fleetfoot_draught`, `sap_vigor` |
| 6 | `rot_surge`, `bone_chill`, `bog_snare`, `glowveil`, `scrap_toss`, `necrotic_lance`, `rust_curse`, `spore_burst`, `deep_step`, `deep_mend`, `warding_dance` |
| 8 | `fate_die` |
| 9 | `mycelial_recall` |
| 12 | `queens_bane`, `wish`, `sear_throne` |

- [ ] **Step 1: Update the two data assertions to the new key**

In `tests/test_undercity_spells.py`, line 90, inside `test_spell_fields_match_effect_kind`:

```python
        assert sp['cooldownSteps'] > 0, sid_
```

In the same file, line 1179, inside `test_acorn_fury_data_and_species_map`:

```python
    assert sp['cooldownSteps'] == 3
```

- [ ] **Step 2: Run the tests to verify they fail**

```bash
cd infrastructure/lambda && python -m pytest tests/test_undercity_spells.py -q
```

Expected: FAIL with `KeyError: 'cooldownSteps'`.

- [ ] **Step 3: Rename the key on every spell**

In `undercity_data.py`, replace each `'cooldownMin': N` with `'cooldownSteps': M` using the table above. There are 32 spells. Also update the `SPELLS` header comment, which currently reads:

```python
# a time. Cooldowns are real-time minutes; `range` is BFS board distance.
```

to:

```python
# a time. Cooldowns are board spaces walked (design 2026-09-02 — not a real-time
# clock, so walking always recharges a spell); `range` is BFS board distance.
```

- [ ] **Step 4: Verify no `cooldownMin` remains in the data file**

```bash
cd infrastructure/lambda && grep -n "cooldownMin" undercity_data.py
```

Expected: no output.

- [ ] **Step 5: Confirm the mapping is exactly right**

```bash
cd infrastructure/lambda && python -c "
import undercity_data as d
want = {'ember_fleck':3,'acorn_fury':3,'spore_bolt':4,'mend_flesh':4,'harden_shell':4,
 'skitter_step':5,'sinkstep':5,'rot_bolt':5,'weaken_hex':5,'withering_gout':5,
 'renewing_bloom':5,'shadowstep':5,'savage_roar':5,'iron_hide':5,'fleetfoot_draught':5,
 'sap_vigor':5,'rot_surge':6,'bone_chill':6,'bog_snare':6,'glowveil':6,'scrap_toss':6,
 'necrotic_lance':6,'rust_curse':6,'spore_burst':6,'deep_step':6,'deep_mend':6,
 'warding_dance':6,'fate_die':8,'mycelial_recall':9,'queens_bane':12,'wish':12,'sear_throne':12}
assert set(want) == set(d.SPELLS), set(want) ^ set(d.SPELLS)
bad = {k: (d.SPELLS[k]['cooldownSteps'], v) for k, v in want.items() if d.SPELLS[k]['cooldownSteps'] != v}
print('MISMATCHES:', bad or 'none')
"
```

Expected: `MISMATCHES: none`.

- [ ] **Step 6: Run the spell tests**

```bash
cd infrastructure/lambda && python -m pytest tests/test_undercity_spells.py -q
```

Expected: the two data tests now pass. Others still fail — `sync_spells` and the cast path are not converted yet. That is fine; do not chase them here.

- [ ] **Step 7: Commit**

```bash
git add infrastructure/lambda/undercity_data.py infrastructure/lambda/tests/test_undercity_spells.py
git commit -m "refactor(undercity): spell cooldowns are steps, not minutes, in the data table"
```

---

## Task 2: Spell cooldown helpers store step counts

**Files:**
- Modify: `infrastructure/lambda/undercity_db.py:6836-6847` (`_spell_cd_ready`, `_start_spell_cooldown`)
- Test: `infrastructure/lambda/tests/test_undercity_spells.py`

`_start_spell_cooldown` currently stamps an absolute timestamp:

```python
def _start_spell_cooldown(doc, spell_id):
    minutes = data.SPELLS[spell_id]['cooldownMin']
    # Squirrel Spell Haste: cooldowns are halved (cast twice as often).
    if 'spell_haste' in (doc.get('passives') or []):
        minutes *= data.SPELL_HASTE_MULT
    until = datetime.utcnow() + timedelta(minutes=minutes)
    doc.setdefault('spellCooldowns', {})[spell_id] = until.isoformat(timespec='seconds')
```

- [ ] **Step 1: Replace the haste test with the step version**

In `tests/test_undercity_spells.py`, replace `test_spell_haste_halves_cooldown` (~line 950) entirely with:

```python
def test_spell_cooldown_is_a_step_count():
    doc = {'passives': []}
    db._start_spell_cooldown(doc, 'rot_surge')             # 6 steps base
    assert doc['spellCooldowns'] == {'rot_surge': 6}


def test_spell_haste_halves_cooldown_steps_rounding_up():
    # ceil(x/2), floored at 1: haste is strong but never makes a spell free.
    hasted = {'passives': ['spell_haste']}
    for spell_id, expected in (('rot_surge', 3),      # 6 -> 3
                               ('skitter_step', 3),   # 5 -> 3 (ceil, not 2)
                               ('ember_fleck', 2),    # 3 -> 2
                               ('wish', 6)):          # 12 -> 6
        db._start_spell_cooldown(hasted, spell_id)
        assert hasted['spellCooldowns'][spell_id] == expected, spell_id


def test_spell_cd_ready_treats_zero_and_legacy_timestamps_as_ready():
    assert db._spell_cd_ready({}, 'rot_surge')
    assert db._spell_cd_ready({'spellCooldowns': {'rot_surge': 0}}, 'rot_surge')
    assert not db._spell_cd_ready({'spellCooldowns': {'rot_surge': 1}}, 'rot_surge')
    # A document written before the step conversion: forgive it rather than crash.
    legacy = {'spellCooldowns': {'rot_surge': '2999-01-01T00:00:00'}}
    assert db._spell_cd_ready(legacy, 'rot_surge')
```

- [ ] **Step 2: Run them to verify they fail**

```bash
cd infrastructure/lambda && python -m pytest tests/test_undercity_spells.py -q -k "step_count or halves_cooldown_steps or legacy_timestamps"
```

Expected: FAIL — the stored value is an ISO string, not an int.

- [ ] **Step 3: Rewrite both helpers**

Replace lines 6836–6847 of `undercity_db.py` with:

```python
def _spell_cd_ready(doc, spell_id):
    """Ready when no countdown is stored, or it has walked down to 0. A value
    left over from the pre-step model (an ISO string) reads as ready — those
    documents are forgiven once rather than migrated."""
    left = (doc.get('spellCooldowns') or {}).get(spell_id)
    if not isinstance(left, int):
        return True
    return left <= 0


def _start_spell_cooldown(doc, spell_id):
    """Owe the spell's cooldown in board spaces. Walking pays it down in
    _tick_step_timers — a cooldown can never be finished by idling."""
    steps = data.SPELLS[spell_id]['cooldownSteps']
    # Squirrel Spell Haste: cooldowns are halved (cast twice as often). Rounded
    # UP and floored at 1 so haste never makes a spell free.
    if 'spell_haste' in (doc.get('passives') or []):
        steps = max(1, math.ceil(steps * data.SPELL_HASTE_MULT))
    doc.setdefault('spellCooldowns', {})[spell_id] = steps
```

- [ ] **Step 4: Make sure `math` is imported**

```bash
cd infrastructure/lambda && grep -n "^import math\|^import " undercity_db.py | head -8
```

If `math` is absent, add `import math` alongside the other stdlib imports at the top of the file, keeping alphabetical order with its neighbours.

- [ ] **Step 5: Run the new tests**

```bash
cd infrastructure/lambda && python -m pytest tests/test_undercity_spells.py -q -k "step_count or halves_cooldown_steps or legacy_timestamps"
```

Expected: 3 passed.

- [ ] **Step 6: Commit**

```bash
git add infrastructure/lambda/undercity_db.py infrastructure/lambda/tests/test_undercity_spells.py
git commit -m "feat(undercity): spell cooldowns stored as step countdowns"
```

---

## Task 3: The pruner must handle integers

**Files:**
- Modify: `infrastructure/lambda/undercity_db.py:1097-1102` (`_prune_cooldowns`)
- Test: `infrastructure/lambda/tests/test_undercity_spells.py:235` (`test_prune_cooldowns_drops_expired`)

This is the crash risk in the whole change. The current code compares each value against an ISO string:

```python
def _prune_cooldowns(doc):
    now = _now()
    cds = doc.get('spellCooldowns') or {}
    doc['spellCooldowns'] = {k: v for k, v in cds.items() if v > now}
```

With integer values, `4 > '2026-09-02T…'` raises `TypeError` in Python 3. `_prune_cooldowns` runs on **every** player in the state read (`undercity_db.py:2646`), so leaving it alone breaks `GET /game/state` for everyone.

Note `highFiveCooldowns` in the same function is a **wall-clock** timer and stays exactly as it is — it is social anti-spam, which the design deliberately leaves on the clock.

- [ ] **Step 1: Replace the pruner test**

In `tests/test_undercity_spells.py`, replace `test_prune_cooldowns_drops_expired` (~line 235) with:

```python
def test_prune_cooldowns_drops_ready_spells():
    doc = {'spellCooldowns': {'rot_surge': 0, 'spore_bolt': 3}}
    db._prune_cooldowns(doc)
    assert doc['spellCooldowns'] == {'spore_bolt': 3}


def test_prune_cooldowns_drops_legacy_timestamps():
    # Pre-step documents: dropped, not compared (an int > str compare raises).
    doc = {'spellCooldowns': {'rot_surge': '2999-01-01T00:00:00', 'spore_bolt': 2}}
    db._prune_cooldowns(doc)
    assert doc['spellCooldowns'] == {'spore_bolt': 2}


def test_prune_cooldowns_leaves_high_fives_on_the_clock():
    # highFiveCooldowns is social anti-spam and stays wall-clock by design.
    doc = {'highFiveCooldowns': {'a': '2000-01-01T00:00:00',
                                 'b': '2999-01-01T00:00:00'}}
    db._prune_cooldowns(doc)
    assert doc['highFiveCooldowns'] == {'b': '2999-01-01T00:00:00'}
```

- [ ] **Step 2: Run them to verify they fail**

```bash
cd infrastructure/lambda && python -m pytest tests/test_undercity_spells.py -q -k "prune_cooldowns"
```

Expected: FAIL with `TypeError: '>' not supported between instances of 'int' and 'str'`.

- [ ] **Step 3: Rewrite the spell half of the pruner**

```python
def _prune_cooldowns(doc):
    now = _now()
    # Spell cooldowns are step countdowns: drop them once walked to 0. Anything
    # that isn't an int is a pre-step-conversion leftover — drop it too (never
    # compare it, an int/str compare raises).
    cds = doc.get('spellCooldowns') or {}
    doc['spellCooldowns'] = {k: v for k, v in cds.items()
                             if isinstance(v, int) and v > 0}
    # High fives are social anti-spam and stay on the wall clock.
    hfcds = doc.get('highFiveCooldowns') or {}
    doc['highFiveCooldowns'] = {k: v for k, v in hfcds.items() if v > now}
```

- [ ] **Step 4: Run them to verify they pass**

```bash
cd infrastructure/lambda && python -m pytest tests/test_undercity_spells.py -q -k "prune_cooldowns"
```

Expected: 3 passed.

- [ ] **Step 5: Commit**

```bash
git add infrastructure/lambda/undercity_db.py infrastructure/lambda/tests/test_undercity_spells.py
git commit -m "fix(undercity): prune spell cooldowns as ints, drop legacy timestamps"
```

---

## Task 4: Tick spell cooldowns as the player walks

**Files:**
- Modify: `infrastructure/lambda/undercity_db.py:1388-1405` (`_tick_step_timers`)
- Test: `infrastructure/lambda/tests/test_undercity_spells.py`

- [ ] **Step 1: Write the failing tests**

Append to `tests/test_undercity_spells.py`:

```python
def test_tick_step_timers_counts_spell_cooldowns_down():
    doc = {'spellCooldowns': {'rot_surge': 6, 'spore_bolt': 2}}
    db._tick_step_timers(doc, 2)
    assert doc['spellCooldowns'] == {'rot_surge': 4, 'spore_bolt': 0}


def test_tick_step_timers_clamps_spell_cooldowns_at_zero():
    doc = {'spellCooldowns': {'rot_surge': 3}}
    db._tick_step_timers(doc, 99)
    assert doc['spellCooldowns'] == {'rot_surge': 0}      # never negative


def test_tick_step_timers_ignores_legacy_and_absent_cooldowns():
    legacy = {'spellCooldowns': {'rot_surge': '2999-01-01T00:00:00'}}
    db._tick_step_timers(legacy, 3)                       # must not raise
    assert legacy['spellCooldowns'] == {'rot_surge': '2999-01-01T00:00:00'}
    bare = {}
    db._tick_step_timers(bare, 3)
    assert 'spellCooldowns' not in bare                   # untouched, not created
```

- [ ] **Step 2: Run them to verify they fail**

```bash
cd infrastructure/lambda && python -m pytest tests/test_undercity_spells.py -q -k "tick_step_timers"
```

Expected: FAIL — `rot_surge` is still 6, the tick does not know about spells.

- [ ] **Step 3: Extend the tick**

Add to `_tick_step_timers`, after the `incubator` block, and update the docstring's first line to mention spells:

```python
def _tick_step_timers(doc, spaces):
    """Advance every distance-based countdown by `spaces` walked: forage's
    recharge, each activated role's recharge, the incubating egg, spell
    cooldowns, the grimoire swap, and Last Stand.
    ...
    """
```

```python
    # Spell cooldowns (design 2026-09-02). Non-int values are pre-conversion
    # leftovers — skipped here and dropped by _prune_cooldowns.
    cds = doc.get('spellCooldowns') or {}
    for spell_id, left in list(cds.items()):
        if isinstance(left, int) and left > 0:
            cds[spell_id] = max(0, left - spaces)
```

- [ ] **Step 4: Run them to verify they pass**

```bash
cd infrastructure/lambda && python -m pytest tests/test_undercity_spells.py -q -k "tick_step_timers"
```

Expected: 3 passed.

- [ ] **Step 5: Commit**

```bash
git add infrastructure/lambda/undercity_db.py infrastructure/lambda/tests/test_undercity_spells.py
git commit -m "feat(undercity): walking ticks spell cooldowns down"
```

---

## Task 5: Server-side distance fallback in the move handler

**Files:**
- Modify: `infrastructure/lambda/undercity_db.py:4121-4126` (the tick call site in `_move`)
- Test: `infrastructure/lambda/tests/test_undercity_spells.py`

The tick is currently keyed on the client-supplied `path` and no-ops without it. For a foraging pet that is a harmless missed tick; for spells it would mean **nothing ever recharges**. `pm` (the validated `pendingMove`) is in scope for the whole of `_move` and carries the roll distance, so use it as the fallback.

- [ ] **Step 1: Write the failing tests**

Append to `tests/test_undercity_spells.py`. These mirror the companion walk tests — `_LOOT_PASS` is a known-adjacent 3-node run on the real map, so a `path` of all three is a legal 2-space walk.

```python
_SPELL_WALK = ('n257', 'n258', 'n259')


def _prime_spell_walk(table, sid):
    """Put user-alex at the start of a legal 2-space walk, ready to commit."""
    doc = db._get_player(table, sid, 'user-alex')
    doc['position'] = _SPELL_WALK[0]
    doc['pendingMove'] = {'value': 2, 'dests': [_SPELL_WALK[2]]}
    doc['spellCooldowns'] = {'rot_surge': 6}
    db._save_or_conflict(table, doc)


def test_walking_pays_down_a_spell_cooldown(table):
    act(table, 'join', starter='pest', home='garden')
    sid = _sid(table)
    _prime_spell_walk(table, sid)
    status, resp = act(table, 'move', to=_SPELL_WALK[-1], path=list(_SPELL_WALK))
    assert status == 200, resp
    doc = db._get_player(table, sid, 'user-alex')
    assert doc['spellCooldowns']['rot_surge'] == 4      # 6 - 2 spaces


def test_cooldown_still_ticks_when_the_client_omits_the_path(table):
    # A stale client that sends no `path` must not freeze cooldowns forever —
    # the server falls back to the validated roll distance.
    act(table, 'join', starter='pest', home='garden')
    sid = _sid(table)
    _prime_spell_walk(table, sid)
    status, resp = act(table, 'move', to=_SPELL_WALK[-1])
    assert status == 200, resp
    doc = db._get_player(table, sid, 'user-alex')
    assert doc['spellCooldowns']['rot_surge'] == 4      # 6 - pm['value']
```

- [ ] **Step 2: Run them to verify the second fails**

```bash
cd infrastructure/lambda && python -m pytest tests/test_undercity_spells.py -q -k "walking_pays_down or client_omits_the_path"
```

Expected: `test_walking_pays_down_a_spell_cooldown` passes (Task 4 did that work); `test_cooldown_still_ticks_when_the_client_omits_the_path` FAILS with `6 == 4`.

- [ ] **Step 3: Use the roll distance when there is no path**

Replace the tick call site (lines 4121–4126):

```python
    # Every companion countdown, spell cooldown, and gear timer runs on
    # DISTANCE, not a clock: each board space walked ticks them toward ready.
    # Prefer the validated `path`; a stale client that omits it still ticks by
    # the pending roll's distance, so a cooldown can never freeze forever.
    # Fields are only touched when already live (>0), so they never appear on
    # players who don't use the feature.
    spaces = (len(path) - 1) if path else int(pm['value'])
    _tick_step_timers(doc, spaces)
```

- [ ] **Step 4: Run them to verify both pass**

```bash
cd infrastructure/lambda && python -m pytest tests/test_undercity_spells.py -q -k "walking_pays_down or client_omits_the_path"
```

Expected: 2 passed.

- [ ] **Step 5: Run the companion suite — this call site is shared**

```bash
cd infrastructure/lambda && python -m pytest tests/test_undercity_companions.py -q
```

Expected: all pass. If a test asserted that a pathless move does *not* tick a pet, that assertion encoded the old fallback; update it to expect the roll-distance tick and note the change in your commit message.

- [ ] **Step 6: Commit**

```bash
git add infrastructure/lambda/undercity_db.py infrastructure/lambda/tests/test_undercity_spells.py
git commit -m "fix(undercity): fall back to roll distance when a move omits its path"
```

---

## Task 6: Grimoire swap on steps

**Files:**
- Modify: `infrastructure/lambda/undercity_config.py:39`
- Modify: `infrastructure/lambda/undercity_db.py:7495-7502` (`_equip_grimoire`)
- Modify: `infrastructure/lambda/undercity_db.py` `_tick_step_timers`
- Test: `infrastructure/lambda/tests/test_undercity_spells.py:~700`

- [ ] **Step 1: Write the failing test**

In `tests/test_undercity_spells.py`, find the swap test that ends with this block (~line 700) and replace **just that trailing block** — the part that fast-forwards the clock — with a step-based unlock:

```python
    # Once the countdown is walked off, the swap goes through.
    doc = db._get_player(table, _sid(table), 'user-alex')
    doc['grimoireSwapSteps'] = 0
    db._put_player(table, doc)
    status, resp = act(table, 'equip-grimoire', grimoireId='gardeners_primer')
    assert status == 200 and resp['you']['equippedGrimoire'] == 'gardeners_primer'
```

Then append a dedicated test:

```python
def test_grimoire_swap_is_step_gated(table):
    act(table, 'join', starter='pest', home='garden')
    sid = _sid(table)
    doc = db._get_player(table, sid, 'user-alex')
    doc['grimoires'] = ['gardeners_primer', 'sewer_codex']
    doc['equippedGrimoire'] = 'sewer_codex'
    doc['grimoireSwapSteps'] = 2
    db._save_or_conflict(table, doc)
    status, body = act(table, 'equip-grimoire', grimoireId='gardeners_primer')
    assert status == 429 and 'steps' in body['error']

    doc = db._get_player(table, sid, 'user-alex')
    db._tick_step_timers(doc, 2)                      # walk it off
    db._save_or_conflict(table, doc)
    status, resp = act(table, 'equip-grimoire', grimoireId='gardeners_primer')
    assert status == 200
    # Swapping re-arms the countdown in steps.
    assert resp['you']['grimoireSwapSteps'] == config.GRIMOIRE_SWAP_COOLDOWN_STEPS
```

Check the imports at the top of the test file: if `undercity_config` is not already imported as `config`, add `import undercity_config as config` next to the other module imports.

- [ ] **Step 2: Run to verify it fails**

```bash
cd infrastructure/lambda && python -m pytest tests/test_undercity_spells.py -q -k "grimoire_swap"
```

Expected: FAIL — `config.GRIMOIRE_SWAP_COOLDOWN_STEPS` does not exist.

- [ ] **Step 3: Replace the config constant**

In `undercity_config.py`, replace line 39:

```python
GRIMOIRE_SWAP_COOLDOWN_MIN = 30  # opening a different grimoire is gated for N min
```

with:

```python
# Opening a different grimoire is gated by board spaces walked, not a clock
# (design 2026-09-02) — a loadout swap costs distance, never dead waiting.
GRIMOIRE_SWAP_COOLDOWN_STEPS = 6
```

- [ ] **Step 4: Rewrite the gate**

In `undercity_db.py`, replace lines 7495–7502:

```python
    if gid and gid != doc.get('equippedGrimoire'):
        left = doc.get('grimoireSwapSteps')
        if isinstance(left, int) and left > 0:
            return _err(f'Grimoire swap on cooldown ({left} steps left).', 429)
        doc['grimoireSwapSteps'] = data.GRIMOIRE_SWAP_COOLDOWN_STEPS
```

A legacy `lastGrimoireSwap` string is simply ignored — the field is no longer read, and it costs nothing to leave on old documents.

- [ ] **Step 5: Tick it as the player walks**

Add to `_tick_step_timers`, after the spell-cooldown loop:

```python
    if int(doc.get('grimoireSwapSteps', 0) or 0) > 0:
        doc['grimoireSwapSteps'] = max(0, int(doc['grimoireSwapSteps']) - spaces)
```

- [ ] **Step 6: Confirm the constant is reachable as `data.`**

`undercity_data.py:17` does `from undercity_config import *`, so every config scalar is automatically available as `data.X` — that is why the engine reads `data.GRIMOIRE_SWAP_COOLDOWN_MIN` today, and why no export plumbing is needed for the new name. Verify:

```bash
cd infrastructure/lambda && python -c "
import undercity_data as d
print('steps =', d.GRIMOIRE_SWAP_COOLDOWN_STEPS)
print('old gone:', not hasattr(d, 'GRIMOIRE_SWAP_COOLDOWN_MIN'))
"
```

Expected: `steps = 6` and `old gone: True`.

- [ ] **Step 7: Run the tests**

```bash
cd infrastructure/lambda && python -m pytest tests/test_undercity_spells.py -q -k "grimoire"
```

Expected: all pass.

- [ ] **Step 8: Commit**

```bash
git add infrastructure/lambda/undercity_config.py infrastructure/lambda/undercity_db.py infrastructure/lambda/tests/test_undercity_spells.py
git commit -m "feat(undercity): grimoire swap gated by steps walked"
```

---

## Task 7: Last Stand on steps

**Files:**
- Modify: `infrastructure/lambda/undercity_config.py:205`
- Modify: `infrastructure/lambda/undercity_db.py:5798-5806` (`_finish_battle`)
- Modify: `infrastructure/lambda/undercity_db.py` `_tick_step_timers`
- Test: `infrastructure/lambda/tests/test_undercity_perks.py:236-285`

- [ ] **Step 1: Convert the three Last Stand tests**

In `tests/test_undercity_perks.py`, make these edits:

Line ~243, in `test_last_stand_saves_from_a_lethal_blow`:

```python
    assert you.get('lastStandSteps')               # countdown armed, in steps
```

Line ~252, in `test_last_stand_on_cooldown_does_not_save`:

```python
    doc['lastStandSteps'] = 12                        # still walking it off
```

Line ~267, in `test_last_stand_recharges_after_cooldown`:

```python
    doc['lastStandSteps'] = 0                         # walked off, ready again
```

Line ~284, in `test_last_stand_not_triggered_without_perk`:

```python
    assert not you.get('lastStandSteps')
```

Then append:

```python
def test_last_stand_arms_a_step_countdown_and_walks_off(table, monkeypatch):
    act(table, 'join', starter='pest')
    sid = _sid(table)
    doc = db._get_player(table, sid, 'user-alex')
    doc['def'] = 18
    doc['hp'] = 20
    db._put_player(table, doc)
    doc = db._get_player(table, sid, 'user-alex')
    db._wild_battle(table, sid, doc)
    _finish_started_battle(table, monkeypatch, doc, outcome='defender', defender_hp=5)
    you = db._get_player(table, sid, 'user-alex')
    assert you['lastStandSteps'] == config.LAST_STAND_COOLDOWN_STEPS
    db._tick_step_timers(you, config.LAST_STAND_COOLDOWN_STEPS)
    assert you['lastStandSteps'] == 0                  # walking recharges it
```

If `undercity_config` is not already imported in this test file, add `import undercity_config as config` beside the other module imports.

- [ ] **Step 2: Run to verify they fail**

```bash
cd infrastructure/lambda && python -m pytest tests/test_undercity_perks.py -q -k "last_stand"
```

Expected: FAIL — the code still writes `lastStandReadyAt`.

- [ ] **Step 3: Replace the config constant**

In `undercity_config.py`, replace line 205:

```python
LAST_STAND_COOLDOWN_MINUTES = 60     # real-time recharge between saves
```

with:

```python
# Board spaces walked between death-saves, not a real-time clock (design
# 2026-09-02). Longer than the old 60 min at the observed pace, but a player
# spending banked rolls can re-arm it inside one session.
LAST_STAND_COOLDOWN_STEPS = 12
```

- [ ] **Step 4: Rewrite the gate**

In `undercity_db.py`, replace lines 5798–5806. Note the comment above it names the old model and must change too:

```python
    # Last Stand (DEF-18 perk): survive an otherwise-lethal blow, rising at half
    # max HP, on a step countdown (design 2026-09-02 — was a real-time hour).
    # It doesn't turn a loss into a win — the outcome drops to a 'timeout' (no
    # compost, no reward; a persistent-pool foe lingers).
    _ls_left = doc.get('lastStandSteps')
    _ls_ready = not isinstance(_ls_left, int) or _ls_left <= 0
    if (result['attackerHp'] <= 0 and _ls_ready
            and 'last_stand' in engine.attribute_perks(doc)):
        doc['lastStandSteps'] = data.LAST_STAND_COOLDOWN_STEPS
        max_hp = engine.effective_stats(doc)['maxHp']
```

Leave the rest of the block (`result['attackerHp']`, the `timeout` downgrade, `result['lastStand'] = True`) untouched.

- [ ] **Step 5: Tick it as the player walks**

Add to `_tick_step_timers`, after the grimoire-swap line:

```python
    if int(doc.get('lastStandSteps', 0) or 0) > 0:
        doc['lastStandSteps'] = max(0, int(doc['lastStandSteps']) - spaces)
```

- [ ] **Step 6: Check for other readers of the old field**

```bash
cd infrastructure/lambda && grep -rn "lastStandReadyAt\|LAST_STAND_COOLDOWN_MINUTES" . ../../src
```

Expected: no output. There is a `doc.pop('lastStandUsed', None)` at `undercity_db.py:4199` — that is a *different*, older field; leave it alone.

- [ ] **Step 7: Run the perk tests**

```bash
cd infrastructure/lambda && python -m pytest tests/test_undercity_perks.py -q
```

Expected: all pass.

- [ ] **Step 8: Full server suite — everything server-side should now be green**

```bash
cd infrastructure/lambda && python -m pytest tests -q
```

Expected: all pass except `tests/test_spells_generated.py`, which fails because the TS mirror is stale. Task 8 fixes that. If anything *else* fails, fix it before moving on.

- [ ] **Step 9: Commit**

```bash
git add infrastructure/lambda/undercity_config.py infrastructure/lambda/undercity_db.py infrastructure/lambda/tests/test_undercity_perks.py
git commit -m "feat(undercity): Last Stand recharges over steps walked"
```

---

## Task 8: Regenerate the client mirror

**Files:**
- Modify: `infrastructure/lambda/sync_spells.py:34`
- Regenerate: `src/app/undercity/data/spells.generated.ts`

- [ ] **Step 1: Emit the new key**

In `sync_spells.py`, in `_spell_line`, change:

```python
             f'cooldownMin: {sp["cooldownMin"]}', f'effect: {_ts(sp["effect"])}']
```

to:

```python
             f'cooldownSteps: {sp["cooldownSteps"]}', f'effect: {_ts(sp["effect"])}']
```

- [ ] **Step 2: Regenerate**

```bash
cd "a:/Coding/game-day-site" && python infrastructure/lambda/sync_spells.py
```

Expected: `wrote …/spells.generated.ts`.

- [ ] **Step 3: Verify the copies now match**

```bash
cd infrastructure/lambda && python -m pytest tests/test_spells_generated.py -q
```

Expected: PASS.

- [ ] **Step 4: Confirm the generated file has no stale key**

```bash
cd "a:/Coding/game-day-site" && grep -c "cooldownSteps" src/app/undercity/data/spells.generated.ts && grep -c "cooldownMin" src/app/undercity/data/spells.generated.ts
```

Expected: `32`, then `0` (grep exits 1 with a count of 0 — that is fine).

- [ ] **Step 5: Full server suite, now entirely green**

```bash
cd infrastructure/lambda && python -m pytest tests -q
```

Expected: all pass, no exceptions.

- [ ] **Step 6: Commit**

```bash
git add infrastructure/lambda/sync_spells.py src/app/undercity/data/spells.generated.ts
git commit -m "chore(undercity): regenerate spell mirror with cooldownSteps"
```

---

## Task 9: Client helpers and model types

**Files:**
- Modify: `src/app/undercity/data/spells.ts:47-63` (`SpellInfo`), `:82-102` (helpers)
- Modify: `src/app/undercity/services/undercity-models.ts:229-232`

There is no frontend test runner in this repo, so `npm run build` is the verification gate. TypeScript will point at every call site that needs updating — that is the intended mechanism here.

- [ ] **Step 1: Retype the interface field**

In `spells.ts`, line 52, replace `cooldownMin: number;` with:

```ts
  /** Board spaces that must be walked before recasting (design 2026-09-02). */
  cooldownSteps: number;
```

- [ ] **Step 2: Replace both helpers**

Replace lines 82–102 of `spells.ts`:

```ts
/** Board spaces still owed before a spell is ready again (0 = ready now).
 *  A server-pushed integer, so unlike the old clock it never drifts stale
 *  between polls. A legacy string value reads as ready. */
export function cooldownLeftSteps(
  cooldowns: Record<string, number> | undefined,
  spellId: string,
): number {
  const left = cooldowns?.[spellId];
  return typeof left === 'number' && left > 0 ? left : 0;
}

/** Mirror of GRIMOIRE_SWAP_COOLDOWN_STEPS in infrastructure/lambda/undercity_config.py. */
export const GRIMOIRE_SWAP_COOLDOWN_STEPS = 6;

/** Board spaces still owed before a different grimoire can be opened (0 = ready). */
export function grimoireSwapLeftSteps(left: number | null | undefined): number {
  return typeof left === 'number' && left > 0 ? left : 0;
}

/** A spell's step cost for THIS creature — halved (rounded up, min 1) by the
 *  Squirrel Spell Haste passive, mirroring _start_spell_cooldown in
 *  infrastructure/lambda/undercity_db.py. */
export function spellStepCost(spell: SpellInfo, passives: string[] = []): number {
  const base = spell.cooldownSteps;
  return passives.includes('spell_haste') ? Math.max(1, Math.ceil(base / 2)) : base;
}
```

- [ ] **Step 3: Retype the model fields**

In `undercity-models.ts`, replace lines 229–232:

```ts
  /** Board spaces still owed before a different grimoire can be opened. */
  grimoireSwapSteps?: number;
  /** spellId -> board spaces still owed before it can be recast (0 = ready). */
  spellCooldowns?: Record<string, number>;
```

- [ ] **Step 4: Build and collect the call-site errors**

```bash
cd "a:/Coding/game-day-site" && npm run build
```

Expected: FAIL, with errors in `creature-tab.component.ts` (`cooldownLeftMin`, `grimoireSwapLeftMin`, `GRIMOIRE_SWAP_COOLDOWN_MIN`, `lastGrimoireSwap`) and `board-tab.component.ts` (`cooldownLeftMin`). Task 10 fixes them. Do not commit a red build — go straight on to Task 10 and commit the two together.

---

## Task 10: Gear menu — step labels and cost chips

**Files:**
- Modify: `src/app/undercity/tabs/creature-tab.component.ts:32-34` (imports), `:1230-1247`
- Modify: `src/app/undercity/tabs/creature-tab.component.html:562-649`
- Modify: `src/app/undercity/tabs/creature-tab.component.scss` (near `.spell-power-chip`, ~line 1680)
- Modify: `src/app/undercity/tabs/board-tab.component.ts:60`, `:689-702`

**Watch out:** the user may have uncommitted work in these exact files. `git status` first, read the current content before editing, and stage only these four paths.

- [ ] **Step 1: Fix the creature-tab imports**

In `creature-tab.component.ts`, in the import block from `../data/spells` (lines ~32–35), replace `cooldownLeftMin`, `grimoireSwapLeftMin`, and `GRIMOIRE_SWAP_COOLDOWN_MIN` with `cooldownLeftSteps`, `grimoireSwapLeftSteps`, `GRIMOIRE_SWAP_COOLDOWN_STEPS`, and add `spellStepCost`.

- [ ] **Step 2: Rewrite the label methods**

Replace lines 1230–1247 of `creature-tab.component.ts`:

```ts
  cooldownLabel(spellId: string): string {
    const left = cooldownLeftSteps(this.store.you()?.spellCooldowns, spellId);
    return left > 0 ? `${left} ${left === 1 ? 'step' : 'steps'}` : 'Ready';
  }

  /** A spell's full step cost for this creature — shown before casting so the
   *  cost can be weighed, not just discovered once the spell is spent. */
  protected stepCost(sp: SpellInfo): number {
    return spellStepCost(sp, this.store.you()?.passives ?? []);
  }

  /** Board spaces still owed before a *different* grimoire can be opened. */
  protected readonly grimoireSwapLeft = computed(() =>
    grimoireSwapLeftSteps(this.store.you()?.grimoireSwapSteps),
  );

  /** Whether a different book can be opened right now. */
  protected readonly swapReady = computed(() => this.grimoireSwapLeft() === 0);

  /** Fraction of the swap countdown still remaining (1 → just swapped, 0 → ready),
   *  for the draining bar on the status pill. */
  protected readonly swapPct = computed(() =>
    Math.max(0, Math.min(1, this.grimoireSwapLeft() / GRIMOIRE_SWAP_COOLDOWN_STEPS)),
  );
```

Confirm `SpellInfo` is in that file's type imports from `../data/spells`; add it if not.

- [ ] **Step 3: Add the cost chip to both spell rows**

In `creature-tab.component.html`, the Spells section has two nearly identical row templates: innate (~line 570) and book (~line 599). In **each**, immediately after the `spell-power-chip` block, add:

```html
                          <span class="spell-cost-chip" [title]="'Recharges after ' + stepCost(sp) + ' spaces walked'">
                            <mat-icon class="mi">directions_walk</mat-icon>{{ stepCost(sp) }}
                          </span>
```

Mind the indentation — the innate row's chips sit two spaces shallower than the book row's. Match each block's surrounding lines.

Leave the Scrolls section (~line 738) alone: scrolls are one-shot with no cooldown, so a step cost there would be a lie.

- [ ] **Step 4: Switch the swap pill to steps**

In the same file, line ~645, replace:

```html
                      <mat-icon class="mi">lock</mat-icon> Swap in {{ grimoireSwapLeft() }}m
```

with:

```html
                      <mat-icon class="mi">lock</mat-icon> Swap in {{ grimoireSwapLeft() }}
                      {{ grimoireSwapLeft() === 1 ? 'step' : 'steps' }}
```

- [ ] **Step 5: Style the chip**

In `creature-tab.component.scss`, immediately after the `.spell-power-chip` rule (~line 1689), add:

```scss
.spell-cost-chip {
  display: inline-flex;
  align-items: center;
  gap: 2px;
  padding: 1px 6px 1px 4px;
  border-radius: 999px;
  font-size: 0.62rem;
  font-weight: 700;
  font-variant-numeric: tabular-nums;
  color: #cfe3c0;
  background: rgba(154, 194, 110, 0.16);
  border: 1px solid rgba(154, 194, 110, 0.34);

  .mi {
    font-size: 0.72rem;
    width: 0.72rem;
    height: 0.72rem;
  }
}
```

This deliberately reads quieter than the solid `.spell-power-chip`: damage is the headline, cost is the qualifier.

- [ ] **Step 6: Fix the board tab**

In `board-tab.component.ts`, change the `cooldownLeftMin` import (line ~60) to `cooldownLeftSteps`, then replace lines 689–702:

```ts
  protected cooldownLabel(spellId: string): string {
    const left = cooldownLeftSteps(this.store.you()?.spellCooldowns, spellId);
    return left > 0 ? `${left} ${left === 1 ? 'step' : 'steps'}` : 'Ready';
  }

  /** Level-scaled magnitude label for a spell at the player's level ('' if flat). */
  protected readonly spellPowerLabel = spellPowerLabel;
  protected playerLevel(): number {
    return this.store.you()?.level ?? 1;
  }

  protected spellReady(spellId: string): boolean {
    return cooldownLeftSteps(this.store.you()?.spellCooldowns, spellId) === 0;
  }
```

- [ ] **Step 7: Verify no stale identifiers remain anywhere in the client**

```bash
cd "a:/Coding/game-day-site" && grep -rn "cooldownLeftMin\|grimoireSwapLeftMin\|GRIMOIRE_SWAP_COOLDOWN_MIN\|cooldownMin\|lastGrimoireSwap" src/
```

Expected: no output.

- [ ] **Step 8: Build**

```bash
cd "a:/Coding/game-day-site" && npm run build
```

Expected: success, no TypeScript errors.

- [ ] **Step 9: Commit both client tasks together**

```bash
git status   # confirm you are not sweeping up unrelated work
git add src/app/undercity/data/spells.ts src/app/undercity/services/undercity-models.ts src/app/undercity/tabs/creature-tab.component.ts src/app/undercity/tabs/creature-tab.component.html src/app/undercity/tabs/creature-tab.component.scss src/app/undercity/tabs/board-tab.component.ts
git commit -m "feat(undercity): show spell cooldowns as step costs in the Gear menu"
```

---

## Task 11: Update the living reference

**Files:**
- Modify: `specs/undercity-spells.md` (lines 20, 22, 133, 150, ~220, and the add-a-spell checklist)

- [ ] **Step 1: Rewrite the cooldown player rule**

Line 20 currently reads:

```markdown
- **Cooldowns**, not mana: each spell has a real-time cooldown (15–60 min). Cooldowns keep ticking while your phone is down.
```

Replace with:

```markdown
- **Cooldowns**, not mana: each spell recharges over **board spaces walked** (3–12 steps), not a clock. Walking is the only thing that recharges a spell — idling never does, and a long fight can't be waited out. The Squirrel Spell Haste passive halves the cost (rounded up, minimum 1).
```

- [ ] **Step 2: Fix the dodge and shield notes**

Line 22 ends "A dodged spell still burns your cooldown." — leave the sentence, it is still true. Line 24's "a rejected cast never starts your cooldown" is also still true. No change needed; confirm by reading them.

- [ ] **Step 3: Update the Creature-tab description**

Line 133 says "with live cooldown labels". Replace that phrase with:

```markdown
with each spell's step cost and a live steps-remaining label
```

- [ ] **Step 4: Update the file map**

Line 150 names `cooldownLeftMin()`. Replace that identifier with `cooldownLeftSteps()`, `spellStepCost()`.

- [ ] **Step 5: Update the add-a-spell checklist**

Find every `cooldownMin` in the checklist and change it to `cooldownSteps`, noting the unit is board spaces. Verify none are left:

```bash
cd "a:/Coding/game-day-site" && grep -rn "cooldownMin\|real-time cooldown" specs/undercity-spells.md
```

Expected: no output.

- [ ] **Step 6: Commit**

```bash
git add specs/undercity-spells.md
git commit -m "docs(undercity): spells reference describes step-based cooldowns"
```

---

## Task 12: Final verification

- [ ] **Step 1: Full server suite**

```bash
cd infrastructure/lambda && python -m pytest tests -q
```

Expected: all pass, zero failures.

- [ ] **Step 2: Production frontend build**

```bash
cd "a:/Coding/game-day-site" && npm run build
```

Expected: success.

- [ ] **Step 3: Sweep for any surviving reference to the old model**

```bash
cd "a:/Coding/game-day-site" && grep -rn "cooldownMin\|LAST_STAND_COOLDOWN_MINUTES\|GRIMOIRE_SWAP_COOLDOWN_MIN\|lastStandReadyAt\|lastGrimoireSwap\|cooldownLeftMin\|grimoireSwapLeftMin" infrastructure/lambda src specs --include=*.py --include=*.ts --include=*.html --include=*.md
```

Expected: no output.

- [ ] **Step 4: Report, do not deploy**

The user deploys themselves. Report: tests green, build green, and that this needs a `cdk deploy` (Lambda) plus a frontend deploy to take effect. Mention that the first action each existing player takes will silently forgive any in-flight cooldown, which is the intended one-time migration.

Optional manual check, if the user wants it: the `run-undercity` skill drives the real browser against the live backend — but the backend must be deployed first, so it cannot verify this change until the user has deployed.
