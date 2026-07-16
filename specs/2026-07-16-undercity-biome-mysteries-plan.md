# Undercity Biome-Flavored Mysteries Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Give the mystery-space d12 table (`roll_mystery` in `undercity_engine.py`) biome-specific flavor on two of its "good" outcomes, based on which home ring the player is currently standing in.

**Architecture:** `roll_mystery()` gains an optional `biome` parameter. Rolls 1 and 7 branch on it to swap in reflavored text and (for roll 7) a different existing buff kind; all other rolls are untouched. `undercity_db.py::_mystery()` looks up the player's current node's `region` and passes it through. No new buff kinds, no client changes.

**Tech Stack:** Python 3.11, pytest (`infrastructure/lambda`).

Spec: [specs/2026-07-16-undercity-biome-mysteries-design.md](../specs/2026-07-16-undercity-biome-mysteries-design.md)

---

### Task 1: Biome-conditioned roll 1 and roll 7 in `roll_mystery()`

**Files:**
- Modify: `infrastructure/lambda/undercity_engine.py:536-575` (`roll_mystery`)
- Test: `infrastructure/lambda/tests/test_undercity_engine.py`

- [ ] **Step 1: Write the failing tests**

Add these to the "Mystery table" section of `test_undercity_engine.py` (after the existing `test_mystery_doubling_rot_doubles_spore_gains`, around line 239):

```python
def test_mystery_roll1_biome_bonus():
    garden = roll_mystery(FakeRng(randints=[1]), has_drift=False, has_doubling_rot=False, biome='garden')
    city = roll_mystery(FakeRng(randints=[1]), has_drift=False, has_doubling_rot=False, biome='city')
    plain = roll_mystery(FakeRng(randints=[1]), has_drift=False, has_doubling_rot=False, biome='bog')
    assert garden['spores'] == 26
    assert city['spores'] == 26
    assert plain['spores'] == 20
    # doubling rot still applies to the bumped amount
    doubled = roll_mystery(FakeRng(randints=[1]), has_drift=False, has_doubling_rot=True, biome='city')
    assert doubled['spores'] == 52


def test_mystery_roll7_biome_buff():
    cavern = roll_mystery(FakeRng(randints=[7]), has_drift=False, has_doubling_rot=False, biome='cavern')
    bog = roll_mystery(FakeRng(randints=[7]), has_drift=False, has_doubling_rot=False, biome='bog')
    bone = roll_mystery(FakeRng(randints=[7]), has_drift=False, has_doubling_rot=False, biome='bone')
    garden = roll_mystery(FakeRng(randints=[7]), has_drift=False, has_doubling_rot=False, biome='garden')
    city = roll_mystery(FakeRng(randints=[7]), has_drift=False, has_doubling_rot=False, biome='city')
    plain = roll_mystery(FakeRng(randints=[7]), has_drift=False, has_doubling_rot=False, biome=None)
    assert cavern['buff'] == 'glowveil'
    assert bog['buff'] == 'harden_shell'
    assert bone['buff'] == 'harden_shell'
    assert bog['text'] != bone['text']  # same buff, different flavor
    assert garden['buff'] == 'rot_surge'
    assert city['buff'] == 'rot_surge'
    assert plain['buff'] == 'rot_surge'
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `cd infrastructure/lambda && python -m pytest tests/test_undercity_engine.py -k "mystery_roll1_biome_bonus or mystery_roll7_biome_buff" -v`
Expected: `FAIL` — `TypeError: roll_mystery() got an unexpected keyword argument 'biome'`

- [ ] **Step 3: Implement the biome branches**

Replace the body of `roll_mystery` in `undercity_engine.py:536-575` with:

```python
def roll_mystery(rng, has_drift: bool, has_doubling_rot: bool, biome: str = None) -> dict:
    """
    Roll the d12 mystery table. Returns a description of what happened; the db
    layer applies it. Spore gains double with Doubling Rot; losses never do.
    Drift rerolls a bad outcome (8-11) once. `biome` is the region of the node
    the player currently occupies (a key of data.BIOMES, or None outside the
    home rings) and reflavors rolls 1 and 7 for a few of the five biomes.
    """
    roll = rng.randint(1, 12)
    if has_drift and 8 <= roll <= 11:
        roll = rng.randint(1, 12)

    mult = 2 if has_doubling_rot else 1
    out = {'roll': roll, 'spores': 0, 'xp': 0, 'hpPct': 0, 'item': None,
           'paint': False, 'hat': False, 'heal': False, 'buff': None,
           'teleport': False, 'curse': False}
    if roll == 1:
        if biome == 'garden':
            out.update(text='Composting spores overflow the mulch pile. +{} Spores.'.format(26 * mult),
                        spores=26 * mult)
        elif biome == 'city':
            out.update(text='A storm-drain stash, rat-picked and ready. +{} Spores.'.format(26 * mult),
                        spores=26 * mult)
        else:
            out.update(text='Spore stash! +{} Spores.'.format(20 * mult), spores=20 * mult)
    elif roll == 2:
        out.update(text='A corpse blooms with insight. +10 XP.', xp=10)
    elif roll == 3:
        out.update(text='A lost wardrobe crate! A paint drops.', paint=True)
    elif roll == 4:
        out.update(text='The hat hermit takes a liking to you.', hat=True)
    elif roll == 5:
        out.update(text='A kindly witch mends you fully and cleanses hazards.', heal=True)
    elif roll == 6:
        out.update(text='A free consumable lies discarded.', item='random')
    elif roll == 7:
        if biome == 'cavern':
            out.update(text='Glowcap mist swirls, quick and hard to pin down. +2 SPD next battle.',
                        buff='glowveil')
        elif biome == 'bog':
            out.update(text='Mire mud sets like armor. +2 DEF next battle.', buff='harden_shell')
        elif biome == 'bone':
            out.update(text='Marrow stiffens under your skin. +2 DEF next battle.', buff='harden_shell')
        else:
            out.update(text='Rot surges through you: +3 ATK next battle.', buff='rot_surge')
    elif roll == 8:
        out.update(text='A pickpocket imp! -10 Spores.', spores=-10)
    elif roll == 9:
        out.update(text='Bad mushrooms. Lose 20% of your current HP.', hpPct=-0.20)
    elif roll == 10:
        out.update(text='Cave-in! You are swept to a random tunnel.', teleport=True)
    elif roll == 11:
        out.update(text='A cursed idol whispers: -1 ATK for 20 minutes.', curse=True)
    else:
        out.update(text='JACKPOT BLOOM! +{} Spores, +10 XP, and an item!'.format(30 * mult),
                   spores=30 * mult, xp=10, item='random')
    return out
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `cd infrastructure/lambda && python -m pytest tests/test_undercity_engine.py -k mystery -v`
Expected: all `mystery*` tests `PASS`, including the pre-existing `test_mystery_drift_rerolls_bad_outcomes` and `test_mystery_doubling_rot_doubles_spore_gains` (unaffected since they don't pass `biome`, which defaults to `None`).

- [ ] **Step 5: Commit**

```bash
git add infrastructure/lambda/undercity_engine.py infrastructure/lambda/tests/test_undercity_engine.py
git commit -m "feat(undercity): biome-flavored mystery outcomes on rolls 1 and 7"
```

---

### Task 2: Wire the player's current-position biome into `_mystery()`

**Files:**
- Modify: `infrastructure/lambda/undercity_db.py:1356-1358` (`_mystery`)

- [ ] **Step 1: Update the call site**

In `undercity_db.py`, change:

```python
def _mystery(table, sid, doc):
    res = engine.roll_mystery(_rng, 'drift' in _passives(doc),
                              'doubling_rot' in _passives(doc))
```

to:

```python
def _mystery(table, sid, doc):
    biome = data.MAP_NODES.get(doc['position'], {}).get('region')
    if biome not in data.BIOMES:
        biome = None
    res = engine.roll_mystery(_rng, 'drift' in _passives(doc),
                              'doubling_rot' in _passives(doc), biome)
```

- [ ] **Step 2: Run the full backend test suite**

Run: `cd infrastructure/lambda && python -m pytest tests -q`
Expected: all tests `PASS` (this change only adds an argument; no existing test asserts on the old no-biome call signature since `_mystery` is exercised indirectly through action-dispatch tests, if any, or not directly covered — either way nothing should regress).

- [ ] **Step 3: Commit**

```bash
git add infrastructure/lambda/undercity_db.py
git commit -m "feat(undercity): pass current-position biome into the mystery roll"
```

---

## Notes for the executor

- Do not touch rolls 2-6, 8-12 — out of scope per the design doc.
- Do not add new buff kinds to `effective_stats()` — `rot_surge`, `glowveil`, and `harden_shell` already exist there (`undercity_engine.py:491-503`).
- `data.BIOMES` (in `undercity_data.py`) is the dict of the five home-biome keys (`cavern`, `bog`, `garden`, `city`, `bone`) — use it, don't hardcode the list elsewhere.
- No deploy step — this is a backend Lambda change; per repo convention the user runs `cdk deploy` themselves once this is merged.
