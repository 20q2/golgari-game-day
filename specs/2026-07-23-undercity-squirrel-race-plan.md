# Squirrel Caster Race + Acorn Stash + In-Combat Casting — Implementation Plan

> ⚠️ **SUPERSEDED (2026-07-23)** by the simpler multiplier-based squirrel in
> [2026-07-23-undercity-squirrel-simple-design.md](2026-07-23-undercity-squirrel-simple-design.md),
> implemented inline. This plan (acorns + in-combat casting) is NOT being built.
> Retained for history.

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add the Squirrel — a fifth playable race (T1 + two T2 evolutions + one new T3 apex) built on a new **Acorn Stash** resource: a per-roll-refilling charge pool spent to recast on-cooldown spells (board) and to cast spells mid-combat (the caster's signature).

**Architecture:** Server is source of truth. New forms go in `undercity_data.py` (mirrored to `data/forms.ts`). A pure `engine.acorn_config(passives)` derives cap/overflow/spend-buff from the creature's passive set so stacked passives compose. Acorns live in one doc field `acorns`, regen in `_roll`, and are spent in two places: `_cast` (board cooldown-bypass, already partially specced) and `_combat_round` (new optional in-combat cast that resolves before the stance exchange and can land the killing blow).

**Tech Stack:** Python 3.11 Lambda (pytest FakeTable suite) + Angular 20 standalone components (verify with `npm run build`; drive with the `run-undercity` skill).

**Prerequisite:** Plan `2026-07-23-undercity-spell-scaling-plan.md` (in-combat damage uses `engine.spell_power`). Land that first.

Design source: [2026-07-22-undercity-squirrel-caster-design.md](2026-07-22-undercity-squirrel-caster-design.md).

---

## Part A — Forms & data

### Task 1: Acorn scalars in config

**Files:**
- Modify: `infrastructure/lambda/undercity_config.py`

- [ ] **Step 1: Add the scalars**

```python
# ── Acorn Stash (squirrel caster, design 2026-07-22) ─────────────────────────
ACORN_CAP_BASE = 3            # stockpile (T1) cap
ACORN_CAP_DEEP = 5            # hoarder (T2) / archmage (T3) cap
ACORN_REGEN_PER_ROLL = 1      # acorns gained per board turn
ACORN_START = 1              # acorns a squirrel hatches with
ACORN_OVERFLOW_CHANCE = 0.35  # archmage: chance a spent acorn is NOT consumed
ACORN_WARLOCK_ATK = 2        # warlock: +ATK one-battle buff on an acorn spend
```

- [ ] **Step 2: Verify re-export**

Run: `cd infrastructure/lambda && python -c "import undercity_data as d; print(d.ACORN_CAP_BASE, d.ACORN_OVERFLOW_CHANCE)"`
Expected: `3 0.35`

- [ ] **Step 3: Commit**

```bash
git add infrastructure/lambda/undercity_config.py
git commit -m "feat(undercity): acorn stash scalars"
```

---

### Task 2: Squirrel forms in the server tables

**Files:**
- Modify: `infrastructure/lambda/undercity_data.py` (`STARTERS`, `TIER2`, `APEX`)
- Test: `infrastructure/lambda/tests/test_undercity_db.py`

- [ ] **Step 1: Write the failing test**

Add to `tests/test_undercity_db.py`:

```python
def test_squirrel_line_wired_end_to_end():
    import undercity_data as data
    # T1 exists with the stockpile passive
    assert data.STARTERS['squirrel']['passive'] == 'stockpile'
    # Two T2 forms, both on the squirrel line
    t2 = data.tier2_options('squirrel')
    assert set(t2) == {'acorn_hoarder', 'acorn_warlock'}
    # The new apex is reachable from BOTH squirrel T2s and only those
    assert set(data.apex_options('acorn_hoarder')) >= {'acorn_archmage'}
    assert set(data.apex_options('acorn_warlock')) >= {'acorn_archmage'}
    # Archmage is squirrel-exclusive: not reachable from any non-squirrel T2
    for form, spec in data.TIER2.items():
        if spec['line'] != 'squirrel':
            assert 'acorn_archmage' not in data.apex_options(form)
```

- [ ] **Step 2: Run test to verify it fails**

Run: `cd infrastructure/lambda && python -m pytest tests/test_undercity_db.py::test_squirrel_line_wired_end_to_end -v`
Expected: FAIL — `KeyError: 'squirrel'`.

- [ ] **Step 3: Add the starter**

In `undercity_data.py`, add to `STARTERS`:

```python
    'squirrel': {
        'name': 'Squirrel', 'hp': 25, 'atk': 4, 'def': 4, 'spd': 7,
        'passive': 'stockpile',
        'blurb': 'A twitchy hoarder of magic. Acorn Stash: bank up to 3 acorns '
                 '(+1 each turn); spend one to recast a spell on cooldown — or to '
                 'cast mid-battle.',
    },
```

- [ ] **Step 4: Add the two T2 forms**

Add to `TIER2`:

```python
    'acorn_hoarder': {
        'name': 'Acorn Hoarder', 'line': 'squirrel', 'bonus': {'maxHp': 4, 'spd': 2},
        'passive': 'acorn_hoarder',
        'blurb': 'Bigger Stash: your acorn cap rises to 5.',
    },
    'acorn_warlock': {
        'name': 'Acorn Warlock', 'line': 'squirrel', 'bonus': {'atk': 2, 'spd': 2},
        'passive': 'acorn_warlock',
        'blurb': 'Charged Cast: spending an acorn also grants +2 ATK for your next battle.',
    },
```

- [ ] **Step 5: Add the apex**

Add to `APEX`:

```python
    'acorn_archmage': {
        'name': 'Acorn Archmage', 'bonus': {'spd': 2, 'maxHp': 6},
        'passive': 'acorn_archmage',
        'from': ['acorn_hoarder', 'acorn_warlock'],
        'blurb': 'Overflow: acorn cap 5, and a spent acorn has a 35% chance not to be consumed.',
    },
```

- [ ] **Step 6: Run test + shape sweeps**

Run: `cd infrastructure/lambda && python -m pytest tests/test_undercity_db.py::test_squirrel_line_wired_end_to_end tests -q -k "form or starter or evolve or personality"`
Expected: PASS (new test + any `ALL_FORMS`/evolution sweeps still green).

- [ ] **Step 7: Commit**

```bash
git add infrastructure/lambda/undercity_data.py infrastructure/lambda/tests/test_undercity_db.py
git commit -m "feat(undercity): squirrel starter, T2 hoarder/warlock, T3 archmage"
```

---

## Part B — Acorn engine + board mechanics

### Task 3: `acorn_config` derived helper

**Files:**
- Modify: `infrastructure/lambda/undercity_engine.py`
- Test: `infrastructure/lambda/tests/test_undercity_db.py`

- [ ] **Step 1: Write the failing test**

```python
def test_acorn_config_composes_passives():
    import undercity_engine as engine
    none = engine.acorn_config(frozenset())
    assert none['has_stash'] is False
    base = engine.acorn_config(frozenset({'stockpile'}))
    assert (base['has_stash'], base['cap'], base['overflow'], base['spend_buff']) == (True, 3, 0.0, False)
    hoard = engine.acorn_config(frozenset({'stockpile', 'acorn_hoarder'}))
    assert hoard['cap'] == 5
    war = engine.acorn_config(frozenset({'stockpile', 'acorn_warlock'}))
    assert war['spend_buff'] is True and war['cap'] == 3
    arch = engine.acorn_config(frozenset({'stockpile', 'acorn_warlock', 'acorn_archmage'}))
    assert arch['cap'] == 5 and arch['overflow'] == 0.35 and arch['spend_buff'] is True
```

- [ ] **Step 2: Run to verify it fails**

Run: `cd infrastructure/lambda && python -m pytest tests/test_undercity_db.py::test_acorn_config_composes_passives -v`
Expected: FAIL — no attribute `acorn_config`.

- [ ] **Step 3: Implement**

Add to `undercity_engine.py` (near `attribute_perks`):

```python
def acorn_config(passives) -> dict:
    """Derive the Acorn Stash parameters from a creature's passive set, so
    stacked squirrel passives compose. Pure. `passives` is any iterable of ids."""
    p = frozenset(passives or ())
    has = 'stockpile' in p
    deep = 'acorn_hoarder' in p or 'acorn_archmage' in p
    return {
        'has_stash': has,
        'cap': data.ACORN_CAP_DEEP if deep else data.ACORN_CAP_BASE,
        'overflow': data.ACORN_OVERFLOW_CHANCE if 'acorn_archmage' in p else 0.0,
        'spend_buff': 'acorn_warlock' in p,
    }
```

- [ ] **Step 4: Run to verify it passes**

Run: `cd infrastructure/lambda && python -m pytest tests/test_undercity_db.py::test_acorn_config_composes_passives -v`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add infrastructure/lambda/undercity_engine.py infrastructure/lambda/tests/test_undercity_db.py
git commit -m "feat(undercity): acorn_config derived stash params"
```

---

### Task 4: Seed acorns on hatch + surface in state

**Files:**
- Modify: `infrastructure/lambda/undercity_db.py` (`_new_player_doc`, `_ok`)
- Test: `infrastructure/lambda/tests/test_undercity_db.py`

- [ ] **Step 1: Write the failing test**

```python
def test_squirrel_hatches_with_acorns_and_cap(fresh_table):
    table, sid = fresh_table
    doc = db._new_player_doc(sid, 'u1', 'Nut', 'squirrel', 'bog')
    assert doc['acorns'] == 1              # ACORN_START
    # non-squirrel gets the field but stays empty
    z = db._new_player_doc(sid, 'u2', 'Z', 'zombie', 'bog')
    assert z['acorns'] == 0
    # _ok surfaces acornCap for a squirrel
    status, body = db._ok(doc)
    assert body['you']['acorns'] == 1 and body['you']['acornCap'] == 3
```

- [ ] **Step 2: Run to verify it fails**

Run: `cd infrastructure/lambda && python -m pytest tests/test_undercity_db.py::test_squirrel_hatches_with_acorns_and_cap -v`
Expected: FAIL — `KeyError: 'acorns'`.

- [ ] **Step 3: Seed the field**

In `_new_player_doc`, after the `'shiny': ...` line inside the doc dict (or right after the dict is built), add the field derived from the starter's passive. Simplest: add to the dict literal:

```python
        # Acorn Stash (squirrels only); non-squirrels carry an empty pool.
        'acorns': data.ACORN_START if s['passive'] == 'stockpile' else 0,
```

- [ ] **Step 4: Surface the cap in `_ok`**

In `_ok`, before `return`, add:

```python
    cfg = engine.acorn_config(doc.get('passives') or [])
    you['acornCap'] = cfg['cap'] if cfg['has_stash'] else 0
    # `acorns` is already copied from the doc; clamp echo to cap for safety.
    if cfg['has_stash']:
        you['acorns'] = min(doc.get('acorns', 0), cfg['cap'])
```

Do the same surface in `_public_player` (line ~1238) so other players see a rival's cap consistently (add the same two-line `acornCap` derive there).

- [ ] **Step 5: Run to verify it passes**

Run: `cd infrastructure/lambda && python -m pytest tests/test_undercity_db.py::test_squirrel_hatches_with_acorns_and_cap -v`
Expected: PASS.

- [ ] **Step 6: Commit**

```bash
git add infrastructure/lambda/undercity_db.py infrastructure/lambda/tests/test_undercity_db.py
git commit -m "feat(undercity): seed acorns on hatch, surface acornCap in state"
```

---

### Task 5: Regen acorns on roll

**Files:**
- Modify: `infrastructure/lambda/undercity_db.py` (`_roll`)
- Test: `infrastructure/lambda/tests/test_undercity_db.py`

- [ ] **Step 1: Write the failing test**

```python
def test_acorns_regen_on_roll_up_to_cap(fresh_table):
    table, sid = fresh_table
    doc = _seed_squirrel(table, sid)          # helper: joins a squirrel, returns loaded doc
    doc['acorns'] = 2
    _put(table, doc)
    for _ in range(5):                        # roll several turns
        doc = _roll_once(table, sid, doc)     # helper wrapping db._roll with a pending-move resolve
    assert _load(table, sid, doc['userId'])['acorns'] == 3    # clamped to ACORN_CAP_BASE
```

(Add `_seed_squirrel`/`_roll_once` next to existing roll-test helpers if absent; reuse the file's existing roll harness.)

- [ ] **Step 2: Run to verify it fails**

Run: `cd infrastructure/lambda && python -m pytest tests/test_undercity_db.py::test_acorns_regen_on_roll_up_to_cap -v`
Expected: FAIL — acorns stays at 2.

- [ ] **Step 3: Implement regen**

In `_roll`, immediately after the roll is confirmed to consume a turn (after the dice value is committed — locate the point where a roll is definitely spent, near where `perks = engine.attribute_perks(doc)` is computed) add:

```python
    cfg = engine.acorn_config(doc.get('passives') or [])
    if cfg['has_stash']:
        doc['acorns'] = min(cfg['cap'], doc.get('acorns', 0) + data.ACORN_REGEN_PER_ROLL)
```

(Place it so it runs once per actual roll, not per reroll/advantage die — put it after the final `picked` value is settled but before the return/save.)

- [ ] **Step 4: Run to verify it passes**

Run: `cd infrastructure/lambda && python -m pytest tests/test_undercity_db.py::test_acorns_regen_on_roll_up_to_cap -v`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add infrastructure/lambda/undercity_db.py infrastructure/lambda/tests/test_undercity_db.py
git commit -m "feat(undercity): regen acorns per board roll, clamped to cap"
```

---

### Task 6: Board cooldown-bypass spend + Warlock buff kind

**Files:**
- Modify: `infrastructure/lambda/undercity_engine.py` (`effective_stats`)
- Modify: `infrastructure/lambda/undercity_db.py` (`ONE_BATTLE_BUFFS`, `_cast`)
- Test: `infrastructure/lambda/tests/test_undercity_spells.py`

- [ ] **Step 1: Register the `acorn_charge` buff**

In `undercity_engine.effective_stats`, add a branch alongside the other buffs:

```python
        elif buff.get('kind') == 'acorn_charge':
            eff['atk'] += data.ACORN_WARLOCK_ATK
```

In `undercity_db.py`, extend the consumed-after-battle tuple:

```python
ONE_BATTLE_BUFFS = ('rot_surge', 'bone_chill', 'glowveil', 'harden_shell', 'weaken_hex', 'acorn_charge')
```

- [ ] **Step 2: Write the failing test (board cooldown bypass)**

```python
def test_squirrel_spends_acorn_to_bypass_cooldown(fresh_table):
    table, sid = fresh_table
    doc = _seed_squirrel(table, sid, level=1)
    _equip_spell(table, sid, doc['userId'], 'mend_flesh')
    doc = _load(table, sid, doc['userId'])
    doc['hp'] = 5; doc['acorns'] = 2
    _put(table, doc)
    # First cast: normal, starts cooldown
    db._cast(table, sid, _load(table, sid, doc['userId']),
             {'spellId': 'mend_flesh', 'source': 'grimoire'})
    d = _load(table, sid, doc['userId'])
    assert d['acorns'] == 2                       # no acorn spent on a ready cast
    # Second cast while on cooldown: spends an acorn instead of erroring
    status, body = db._cast(table, sid, d, {'spellId': 'mend_flesh', 'source': 'grimoire'})
    assert status == 200
    assert _load(table, sid, doc['userId'])['acorns'] == 1
```

- [ ] **Step 3: Run to verify it fails**

Run: `cd infrastructure/lambda && python -m pytest tests/test_undercity_spells.py::test_squirrel_spends_acorn_to_bypass_cooldown -v`
Expected: FAIL — second cast returns 429 `spell_on_cooldown`.

- [ ] **Step 4: Implement the bypass**

In `_cast`, replace the on-cooldown guard:

```python
    if not _spell_cd_ready(doc, spell_id):
        return _spell_err(f"{spell['name']} is still recharging.",
                          'spell_on_cooldown', 429)
```
with:
```python
    spent_acorn = False
    if not _spell_cd_ready(doc, spell_id):
        cfg = engine.acorn_config(doc.get('passives') or [])
        if not (cfg['has_stash'] and doc.get('acorns', 0) > 0):
            return _spell_err(f"{spell['name']} is still recharging.",
                              'spell_on_cooldown', 429)
        spent_acorn = True   # consumed only after the cast resolves successfully
```

Then, at the very end of `_cast` — after the effect resolved but **before** `_start_spell_cooldown` (so a rejected effect never spends the acorn) — add:

```python
    if spent_acorn:
        cfg = engine.acorn_config(doc.get('passives') or [])
        import random as _r  # module already imports `random`; reuse module-level _rng
        if _rng.random() >= cfg['overflow']:        # overflow: chance NOT consumed
            doc['acorns'] = max(0, doc.get('acorns', 0) - 1)
        if cfg['spend_buff']:
            _apply_buff(doc, 'acorn_charge')
```
(Do not add a new import — `_rng` is the module-level RNG already used throughout `undercity_db.py`. Remove the `import random` comment line; it's only a reminder.)

- [ ] **Step 5: Run to verify it passes + full spell suite**

Run: `cd infrastructure/lambda && python -m pytest tests/test_undercity_spells.py -q`
Expected: PASS.

- [ ] **Step 6: Commit**

```bash
git add infrastructure/lambda/undercity_engine.py infrastructure/lambda/undercity_db.py infrastructure/lambda/tests/test_undercity_spells.py
git commit -m "feat(undercity): board acorn cooldown-bypass + warlock acorn_charge buff"
```

---

## Part C — In-combat casting

### Task 7: Resolve an optional in-combat cast in `_combat_round`

**Files:**
- Modify: `infrastructure/lambda/undercity_db.py` (`_combat_round`, new `_combat_cast`)
- Test: `infrastructure/lambda/tests/test_undercity_spells.py`

The in-combat cast operates on the battle snapshot dicts `rec['player']` / `rec['npc']` (keys: `hp`, `maxHp`, `atk`, `dfn`, `spd`, `buffs`, …). It resolves BEFORE the stance exchange and can drop the npc to 0 (killing blow).

- [ ] **Step 1: Write the failing test (damage kills)**

```python
def test_in_combat_cast_damages_and_can_kill(fresh_table):
    table, sid = fresh_table
    doc = _seed_squirrel(table, sid, level=1)
    _equip_spell(table, sid, doc['userId'], 'spore_bolt')     # 12 dmg at level 1
    doc = _start_wild_battle(table, sid, doc, npc_hp=10)      # helper: begin a wild fight
    doc['acorns'] = 2
    _put(table, doc)
    status, body = db._combat_round(table, sid, _load(table, sid, doc['userId']),
        {'stance': 'guard', 'castSpellId': 'spore_bolt', 'castSource': 'grimoire'})
    assert status == 200
    # 12 dmg to a 10-HP npc => dead this round; acorn spent
    assert body.get('cast', {}).get('dmg') == 12 or body.get('result', {}).get('outcome') == 'attacker'
    assert _load(table, sid, doc['userId'])['acorns'] == 1
```

- [ ] **Step 2: Run to verify it fails**

Run: `cd infrastructure/lambda && python -m pytest tests/test_undercity_spells.py::test_in_combat_cast_damages_and_can_kill -v`
Expected: FAIL — cast ignored (no `castSpellId` handling).

- [ ] **Step 3: Implement `_combat_cast` + wire into `_combat_round`**

Add a helper near `_combat_round`:

```python
# Spells that make sense inside a fight, mapped to how they touch the snapshot.
_COMBAT_CASTABLE = {
    'field_damage': 'damage',      # -> npc hp
    'self_heal':    'heal',        # -> player hp
    'self_buff':    'buff',        # -> player stat delta this fight
    'field_curse':  'curse',       # -> npc stat delta this fight
}
# Stat deltas applied directly to the combat snapshot for buff/curse casts.
_COMBAT_BUFF_DELTA = {
    'rot_surge':   ('atk', +3), 'glowveil': ('spd', +2), 'harden_shell': ('def', +2),
    'acorn_charge': ('atk', 0),  # warlock buff already handled via spend; no stack
}
_COMBAT_CURSE_DELTA = {'bone_chill': ('atk', -2), 'weaken_hex': ('atk', -3), 'vines': ('atk', 0)}


def _combat_cast(doc, rec, spell_id, source):
    """Resolve one acorn-fueled in-combat cast against the battle snapshot.
    Returns a (cast-result dict) on success or an (status, payload) error tuple.
    Mutates rec['player']/rec['npc'] and doc['acorns']. Damage can reach 0 (kill)."""
    cfg = engine.acorn_config(doc.get('passives') or [])
    if not (cfg['has_stash'] and doc.get('acorns', 0) > 0):
        return _err('No acorns to spend.', 409)
    spell = data.SPELLS.get(spell_id)
    if not spell:
        return _spell_err('Unknown spell.', 'unknown_spell', 400)
    kind = _COMBAT_CASTABLE.get(spell['effect'])
    if not kind:
        return _spell_err('That spell has no effect in battle.', 'not_castable', 400)
    # Must be in the caster's loadout (innate for their biome, or open grimoire).
    if source == 'innate':
        if data.BIOME_SPELLS.get(doc.get('homeBiome')) != spell_id:
            return _spell_err("That is not your biome's gift.", 'not_castable')
    else:
        spells = _book_spells(doc, doc.get('equippedGrimoire') or '') if '_book_spells' in globals() \
                 else (data.GRIMOIRES.get(doc.get('equippedGrimoire') or '', {}).get('spells') or [])
        if spell_id not in spells:
            return _spell_err('That spell is not in your open grimoire.', 'not_castable')

    p, n = rec['player'], rec['npc']
    result = {'spellId': spell_id, 'effect': spell['effect']}
    if kind == 'damage':
        dmg = engine.spell_power(spell, doc)
        n['hp'] = max(0, int(n['hp']) - dmg)      # 0 allowed: in-person kill
        result['dmg'] = dmg
        result['text'] = f"{spell['name']} tears into {n['name']} for {dmg}!"
    elif kind == 'heal':
        heal = engine.spell_power(spell, doc)
        p['hp'] = min(int(p['maxHp']), int(p['hp']) + heal)
        result['hp'] = heal
        result['text'] = f"{spell['name']} knits your wounds (+{heal} HP)."
    elif kind == 'buff':
        stat, delta = _COMBAT_BUFF_DELTA.get(spell.get('buffKind'), ('atk', 0))
        if delta:
            key = 'dfn' if stat == 'def' else stat
            p[key] = int(p.get(key, 0)) + delta
        result['text'] = f"{spell['name']} takes hold."
    elif kind == 'curse':
        stat, delta = _COMBAT_CURSE_DELTA.get(spell.get('buffKind'), ('atk', 0))
        if delta:
            key = 'dfn' if stat == 'def' else stat
            n[key] = max(1, int(n.get(key, 0)) + delta)
        result['text'] = f"{spell['name']} weakens {n['name']}."

    # Spend the acorn (overflow may refund); warlock buff is battle-only, so bump
    # the snapshot ATK directly rather than the persistent doc buff list.
    if _rng.random() >= cfg['overflow']:
        doc['acorns'] = max(0, doc.get('acorns', 0) - 1)
    if cfg['spend_buff']:
        p['atk'] = int(p.get('atk', 0)) + data.ACORN_WARLOCK_ATK
    return result
```

Then, in `_combat_round`, after the `item` handling block and before building `player_c`/`npc_c`, insert:

```python
    cast_result = None
    cast_id = (payload or {}).get('castSpellId')
    if cast_id:
        out = _combat_cast(doc, rec, cast_id, (payload or {}).get('castSource', 'grimoire'))
        if isinstance(out, tuple):        # error (status, payload)
            return out
        cast_result = out
        # If the cast dropped the npc, end the fight now (no stance exchange).
        if int(rec['npc']['hp']) <= 0:
            player_c = _bt_to_combatant(rec['player'])
            npc_c = _bt_to_combatant(rec['npc'])
            result = {'outcome': 'attacker', 'strikes': rec['strikes'],
                      'attackerHp': max(0, player_c.hp), 'defenderHp': 0,
                      'smokeSporeUsed': False, 'defenderFleeFailed': False}
            fin = _finish_battle(table, sid, doc, rec, result)
            # attach the cast to the finish payload
            if isinstance(fin, tuple) and isinstance(fin[1], dict):
                fin[1]['cast'] = cast_result
            return fin
```

Finally, pass the cast through the ongoing-round payload: change the `_conclude_round(...)` call in `_combat_round` to forward `extra={'cast': cast_result}` when a cast happened:

```python
    return _conclude_round(table, sid, doc, rec, player_c, npc_c, entries,
                           frenzy_from, extra={'cast': cast_result} if cast_result else None)
```

(Read `_conclude_round`'s `extra` handling — it already merges `extra` into the combat payload.)

- [ ] **Step 4: Run to verify it passes**

Run: `cd infrastructure/lambda && python -m pytest tests/test_undercity_spells.py::test_in_combat_cast_damages_and_can_kill -v`
Expected: PASS.

- [ ] **Step 5: Add coverage for the other paths**

Add tests: heal caps at maxHp; self_buff bumps player atk this round; field_curse lowers npc atk (floored at 1); traversal/boss spell → `not_castable`; no acorn → 409; a non-squirrel with `castSpellId` → 409 (`No acorns`). Then:

Run: `cd infrastructure/lambda && python -m pytest tests/test_undercity_spells.py -q`
Expected: PASS.

- [ ] **Step 6: Full suite (no combat regressions)**

Run: `cd infrastructure/lambda && python -m pytest tests -q`
Expected: all green.

- [ ] **Step 7: Commit**

```bash
git add infrastructure/lambda/undercity_db.py infrastructure/lambda/tests/test_undercity_spells.py
git commit -m "feat(undercity): acorn-fueled in-combat casting (damage can kill)"
```

---

### Task 8: Extend the combat-round action contract note

**Files:**
- Modify: `specs/undercity-combat.md`

- [ ] **Step 1: Document the new payload**

In `specs/undercity-combat.md` §1 (round flow), add a sentence: the client `combat-round` submission accepts optional `castSpellId` + `castSource`; a stash-holder spends 1 acorn to cast an add-on spell (damage→foe/can kill, heal→self, buff/curse→this fight) resolved before the exchange. Cross-link the squirrel design doc.

- [ ] **Step 2: Commit**

```bash
git add specs/undercity-combat.md
git commit -m "docs(undercity): document in-combat casting in combat reference"
```

---

## Part D — Client mirrors & UX

### Task 9: Mirror forms + passives + sprites

**Files:**
- Modify: `src/app/undercity/data/forms.ts`
- Modify: `src/app/undercity/data/species.ts`

- [ ] **Step 1: Passive names + blurbs**

In `forms.ts`, add to `PASSIVE_NAMES`:
```typescript
  stockpile: 'Acorn Stash',
  acorn_hoarder: 'Bigger Stash',
  acorn_warlock: 'Charged Cast',
  acorn_archmage: 'Overflow',
```
and to `PASSIVE_BLURBS`:
```typescript
  stockpile: 'Bank up to 3 acorns (+1 per turn); spend one to recast on cooldown or to cast mid-battle.',
  acorn_hoarder: 'Your acorn cap rises to 5.',
  acorn_warlock: 'Spending an acorn also grants +2 ATK for your next battle.',
  acorn_archmage: 'Acorn cap 5, and a spent acorn has a 35% chance not to be consumed.',
```

- [ ] **Step 2: Starter / T2 / APEX entries**

Add to `STARTERS`:
```typescript
  {
    id: 'squirrel', name: 'Squirrel', tier: 1, passive: 'stockpile', passiveName: 'Acorn Stash',
    blurb: 'A twitchy hoarder of magic — casts on its own tempo.',
    stats: { hp: 25, atk: 4, def: 4, spd: 7 },
  },
```
Add to `TIER2`:
```typescript
  { id: 'acorn_hoarder', name: 'Acorn Hoarder', tier: 2, line: 'squirrel', passive: 'acorn_hoarder', passiveName: 'Bigger Stash', bonus: { maxHp: 4, spd: 2 }, blurb: 'Deep stash (+HP/+SPD).' },
  { id: 'acorn_warlock', name: 'Acorn Warlock', tier: 2, line: 'squirrel', passive: 'acorn_warlock', passiveName: 'Charged Cast', bonus: { atk: 2, spd: 2 }, blurb: 'Battle-caster (+ATK/+SPD).' },
```
Add to `APEX`:
```typescript
  { id: 'acorn_archmage', name: 'Acorn Archmage', tier: 3, passive: 'acorn_archmage', passiveName: 'Overflow', bonus: { spd: 2, maxHp: 6 }, blurb: 'The hoarder-caster peak.', from: ['acorn_hoarder', 'acorn_warlock'] },
```

- [ ] **Step 3: Sprites**

In `species.ts` `FORM_SPRITES`, add:
```typescript
  squirrel: { sprite: 'squirrel', regions: PLAYER_REGIONS, scale: 0.7 },
  acorn_hoarder: { sprite: 'squirrel_mage', regions: [], scale: 1.0 },
  acorn_warlock: { sprite: 'squirrel_general', regions: [], scale: 1.0 },
  acorn_archmage: { sprite: 'squirrel_mage', regions: [], scale: 1.1 },  // placeholder art
```

- [ ] **Step 4: Build**

Run: `npm run build`
Expected: succeeds. (Confirms sprite keys resolve; assets `squirrel*.png` already exist in `public/undercity/player_sprites/`.)

- [ ] **Step 5: Commit**

```bash
git add src/app/undercity/data/forms.ts src/app/undercity/data/species.ts
git commit -m "feat(undercity): client mirror for squirrel forms + sprites"
```

---

### Task 10: Hatch flow — archetype + starter appears

**Files:**
- Modify: `src/app/undercity/hatch/hatch-flow.component.ts`

- [ ] **Step 1: Add the archetype label**

In `hatch-flow.component.ts`, add to the `ARCHETYPES` map:
```typescript
    squirrel: 'Caster',
```

- [ ] **Step 2: Build + drive**

Run: `npm run build`
Then use `run-undercity` to open the hatch flow and confirm the Squirrel appears in the lineup with a stat sheet (SPD bar highest) and "Caster" label, and its evolution preview lists Acorn Hoarder / Acorn Warlock.

- [ ] **Step 3: Commit**

```bash
git add src/app/undercity/hatch/hatch-flow.component.ts
git commit -m "feat(undercity): squirrel Caster archetype in hatch lineup"
```

---

### Task 11: Types — acorns on the player doc

**Files:**
- Modify: `src/app/undercity/services/undercity-models.ts`

- [ ] **Step 1: Add fields**

Add to the `YouDoc` interface (near `perks`):
```typescript
  /** Acorn Stash (squirrels): current banked acorns and the derived cap (0 if
   *  not a stash-holder). */
  acorns?: number;
  acornCap?: number;
```
Add optional cast fields to the combat-round request type / cast result type used by the board tab (locate `CastResult` and the combat-round payload type):
```typescript
  // on the combat-round payload type:
  castSpellId?: string;
  castSource?: 'innate' | 'grimoire';
```

- [ ] **Step 2: Build**

Run: `npm run build`
Expected: succeeds.

- [ ] **Step 3: Commit**

```bash
git add src/app/undercity/services/undercity-models.ts
git commit -m "feat(undercity): acorn + in-combat-cast fields on client models"
```

---

### Task 12: Acorn Stash display (creature + board) — UX

**Files:**
- Modify: `src/app/undercity/tabs/creature-tab.component.html`
- Modify: `src/app/undercity/tabs/creature-tab.component.scss`
- Modify: `src/app/undercity/tabs/board-tab.component.ts`

Goal: a clear, glanceable **acorn meter** (filled/empty pips 🌰) wherever casting happens, only for stash-holders.

- [ ] **Step 1: Acorn meter on the Grimoire card**

In `creature-tab.component.html`, in the Grimoire card header, add (guarded on `acornCap`):
```html
<div class="acorn-meter" *ngIf="(store.you()?.acornCap ?? 0) > 0" title="Acorn Stash">
  <span class="acorn-pip"
        *ngFor="let i of acornPips()"
        [class.filled]="i < (store.you()?.acorns ?? 0)">🌰</span>
</div>
```
In `creature-tab.component.ts`, add:
```typescript
protected acornPips(): number[] {
  return Array.from({ length: this.store.you()?.acornCap ?? 0 }, (_, i) => i);
}
```

- [ ] **Step 2: Style the pips**

In `creature-tab.component.scss`:
```scss
.acorn-meter { display: inline-flex; gap: 2px; }
.acorn-pip { font-size: 0.9rem; filter: grayscale(1) opacity(0.35); }
.acorn-pip.filled { filter: none; }
```

- [ ] **Step 3: Build + drive**

Run: `npm run build`
Then use `run-undercity` with a squirrel creature to confirm the acorn meter renders and fills as you roll.

- [ ] **Step 4: Commit**

```bash
git add src/app/undercity/tabs/creature-tab.component.html src/app/undercity/tabs/creature-tab.component.scss src/app/undercity/tabs/creature-tab.component.ts
git commit -m "feat(undercity): acorn stash meter UI"
```

---

### Task 13: In-combat cast control — UX

**Files:**
- Modify: `src/app/undercity/tabs/interactive-battle.component.ts`
- Modify: `src/app/undercity/tabs/interactive-battle.component.html`
- Modify: `src/app/undercity/tabs/interactive-battle.component.scss`

Goal: when the player is a stash-holder with acorns > 0, the battle screen offers a "Cast (🌰)" affordance alongside the stance buttons. Selecting a castable spell attaches `castSpellId`/`castSource` to the submitted round; the acorn meter and a "will spend 🌰" hint show the cost.

- [ ] **Step 1: Find the stance-submit path**

Run: `grep -n "combat-round\|stance\|submitRound\|action(" src/app/undercity/tabs/interactive-battle.component.ts | head`
Identify how a stance is submitted (the call that sends `combat-round`).

- [ ] **Step 2: Add cast state + castable list**

In `interactive-battle.component.ts`:
```typescript
import { SPELLS, spellPowerLabel } from '../data/spells';
// ...
protected readonly castChoice = signal<string | null>(null);   // spellId or null
protected readonly spellPowerLabel = spellPowerLabel;
private static readonly COMBAT_CASTABLE = new Set(['field_damage','self_heal','self_buff','field_curse']);
protected castableSpells(): { id: string; source: 'innate'|'grimoire'; name: string; label: string }[] {
  const you = this.store.you();
  if (!you || (you.acornCap ?? 0) === 0 || (you.acorns ?? 0) <= 0) return [];
  const ids = new Set<string>();
  const innate = /* biome innate id from store */ this.store.innateSpellId?.() ?? null;
  const book = /* open grimoire spells from store */ this.store.openGrimoireSpells?.() ?? [];
  const out: { id: string; source: 'innate'|'grimoire'; name: string; label: string }[] = [];
  const add = (id: string, source: 'innate'|'grimoire') => {
    const s = SPELLS.find(x => x.id === id);
    if (s && IB.COMBAT_CASTABLE.has(s.effect) && !ids.has(id)) {
      ids.add(id); out.push({ id, source, name: s.name, label: spellPowerLabel(s, you.level ?? 1) });
    }
  };
  if (innate) add(innate, 'innate');
  for (const id of book) add(id, 'grimoire');
  return out;
}
```
(Replace the `/* ... */` accessors with the real store getters this component already uses to know the innate spell and open book — grep the file/store for how the cast picker in board-tab obtains them and reuse the same source. `IB` = the component class name for the static set.)

- [ ] **Step 3: Attach the cast to the submitted round**

Where the stance is submitted, include the chosen cast:
```typescript
const cast = this.castChoice();
const chosen = this.castableSpells().find(c => c.id === cast);
await this.store.action('combat-round', {
  stance,
  ...(chosen ? { castSpellId: chosen.id, castSource: chosen.source } : {}),
});
this.castChoice.set(null);
```

- [ ] **Step 4: Cast UI (chips) + acorn hint**

In `interactive-battle.component.html`, near the stance buttons:
```html
<div class="combat-cast" *ngIf="castableSpells().length">
  <span class="cast-label">Cast <span class="acorn-cost">🌰</span></span>
  <button type="button" class="cast-chip"
          *ngFor="let c of castableSpells()"
          [class.active]="castChoice() === c.id"
          (click)="castChoice.set(castChoice() === c.id ? null : c.id)">
    {{ c.name }}<span class="cast-mag" *ngIf="c.label"> · {{ c.label }}</span>
  </button>
</div>
```

- [ ] **Step 5: Style (reuse tokens, theme-aware)**

In `interactive-battle.component.scss`:
```scss
.combat-cast { display: flex; flex-wrap: wrap; gap: 6px; align-items: center; margin-top: 8px; }
.combat-cast .cast-label { font-size: 0.78rem; opacity: 0.8; }
.cast-chip {
  border: 1px solid var(--accent-color, #e91e63);
  background: transparent; color: var(--accent-color, #e91e63);
  border-radius: 14px; padding: 3px 10px; font-size: 0.78rem; cursor: pointer;
}
.cast-chip.active { background: var(--accent-color, #e91e63); color: #fff; }
.cast-mag { font-weight: 700; }
```

- [ ] **Step 6: Build + drive the full loop**

Run: `npm run build`
Then use `run-undercity`: on a squirrel with acorns, enter a wild fight, pick a damage spell chip + a stance, submit, and confirm the enemy takes the scaled damage, the acorn meter drops, and a lethal cast ends the fight. Confirm non-squirrels see no cast row.

- [ ] **Step 7: Commit**

```bash
git add src/app/undercity/tabs/interactive-battle.component.ts src/app/undercity/tabs/interactive-battle.component.html src/app/undercity/tabs/interactive-battle.component.scss
git commit -m "feat(undercity): in-combat cast control with acorn cost + scaled magnitude"
```

---

## Self-review notes

- **Spec coverage:** forms T1/T2/T3 (Task 2), stats 4/4/7 (Task 2/9), acorn field + regen + cap (Tasks 1,4,5), derived config composing passives (Task 3), board cooldown-bypass + overflow + warlock buff (Task 6), in-combat casting resolving pre-exchange and able to kill, with heal/buff/curse and rejections (Task 7), state surface (Task 4), client mirrors + sprites (Task 9), hatch archetype (Task 10), types (Task 11), acorn meter UX (Task 12), in-combat cast UX with scaled magnitude (Task 13), docs (Task 8). ✔
- **Invariants:** board never-kill preserved (Task 6 only bypasses cooldown; damage still floored elsewhere); in-combat kill is the scoped exception (Task 7); existing combat unaffected when no `castSpellId` (Task 7 guards on `cast_id`). ✔
- **Naming consistency:** server `acorn_config`/`_combat_cast`/`acorn_charge`/`castSpellId`/`castSource`; client `acorns`/`acornCap`/`castSpellId`/`castSource`/`spellPowerLabel`. Sprites `squirrel`/`squirrel_mage`/`squirrel_general`. ✔
- **Overflow RNG** uses the module `_rng` (deterministic under the suite's seeding), so Task 7 overflow tests can seed it. ✔
- **Placeholder callouts:** Tasks 12–13 intentionally reference store accessors "the file already uses" for the open book/innate — the executor must grep and wire the real getters (they exist for the board-tab cast picker); this is a wiring instruction, not a value placeholder.
