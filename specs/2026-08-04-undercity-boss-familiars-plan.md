# Boss Familiars & Sigil Codex — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Replace the borrowed boss-turf signature minions with five bespoke, exclusive **familiars** — mini-elites that each share a named, telegraphable combat trait with their lair boss — and add a tap-to-inspect boss **codex** to the Sigils sub-tab.

**Architecture:** All rules stay server-side (`infrastructure/lambda/`). Enemy specs already flow into the monster `Combatant` via `_npc_combatant`; we (1) let `npc_from_spec` carry `passives`/`spriteId`, (2) add three new snowball/regen mechanics + reuse `swarm`/rot in `engine.resolve_round`, (3) persist the two stacking counters through the round-by-round battle serde, (4) surface each trait as a chip through the existing `_battle_status` → `STATUS_INFO` pipeline, and (5) add a client-only codex panel + boss lore to the `DUNGEONS` mirror. Balance numbers are mirrored into `src/app/undercity/data/*.ts` per the repo's display-mirror rule.

**Tech Stack:** Python 3.11 Lambda (pure engine functions + pytest), Angular 20 standalone components (SCSS), in-memory FakeTable pytest suite.

**Design doc:** [specs/2026-08-04-undercity-boss-familiars-design.md](2026-08-04-undercity-boss-familiars-design.md)

**Conventions:**
- Backend tests: `cd infrastructure/lambda && python -m pytest tests -q` — must stay green.
- Run a single test: `python -m pytest tests/test_undercity_engine.py::test_name -q`.
- Frontend verify: `npm run build` (lint is known-broken in this repo — do **not** rely on `npm run lint`).
- Server balance numbers live in `undercity_config.py`; weighted/data tables in `undercity_data.py`; **mirror display values** into `src/app/undercity/data/*.ts`.
- Commit after each task.

---

## File Structure

**Backend (`infrastructure/lambda/`):**
- `undercity_config.py` — new trait scalars (`GRAVE_GROWTH_*`, `DOOM_*`, `DREDGE_REGEN`).
- `undercity_data.py` — `LAIR_FAMILIAR` registry, `LAIR_SIGNATURE` re-point, `TRAIT_PASSIVES`, boss `passives`.
- `undercity_engine.py` — `Combatant.growth_stacks`/`doom_stacks`; `npc_from_spec` passthrough; three new mechanics + `web_venom` in `resolve_round`.
- `undercity_db.py` — snapshot serde for the two counters + persist `atk`/`spd`; `_wild_battle` familiar lookup + sprite rotation; `_battle_status` trait chips.
- `tests/` — new engine tests, updated signature tests.
- `sim/` — a balance-gate script.

**Frontend (`src/app/undercity/`):**
- `data/combat.ts` — `STATUS_INFO` entries for the five traits; `BattleStatus`/`statusChips` stack counts.
- `services/undercity-models.ts` — `BattleStatus` gains `traits`/`stacks`; npc payload gains `spriteId`.
- `data/dungeons.ts` — `DungeonInfo` gains `lore` + `trait`; sprite-folder set.
- `tabs/board-tab.component.ts` + `engine/board-canvas.ts` — load boss-familiar sprites from `boss_spawns/`.
- `tabs/creature-tab.component.{ts,html,scss}` — sigil codex popout.

---

## Phase 1 — Enemy-passive plumbing, familiar registry & spawn wiring

### Task 1: `npc_from_spec` carries `passives` and `spriteId`

**Files:**
- Modify: `infrastructure/lambda/undercity_engine.py:1000-1004`
- Test: `infrastructure/lambda/tests/test_undercity_engine.py`

- [ ] **Step 1: Write the failing test**

Add to `test_undercity_engine.py`:

```python
def test_npc_from_spec_carries_passives_and_sprite():
    spec = {'id': 'x', 'name': 'X', 'hp': 30, 'atk': 10, 'def': 4, 'spd': 6,
            'bounty': 12, 'xp': 15, 'itemChance': 0.1,
            'passives': ['grave_growth'], 'spriteId': 'x_art'}
    npc = engine.npc_from_spec(spec)
    assert npc['passives'] == ['grave_growth']
    assert npc['spriteId'] == 'x_art'
    # A spec without them stays clean (no keys invented).
    bare = engine.npc_from_spec({'id': 'y', 'name': 'Y', 'hp': 20, 'atk': 5,
        'def': 2, 'spd': 4, 'bounty': 5, 'xp': 8, 'itemChance': 0.0})
    assert 'passives' not in bare and 'spriteId' not in bare
```

- [ ] **Step 2: Run it — expect FAIL**

Run: `cd infrastructure/lambda && python -m pytest tests/test_undercity_engine.py::test_npc_from_spec_carries_passives_and_sprite -q`
Expected: FAIL (`KeyError`/assertion — `passives` not copied).

- [ ] **Step 3: Implement**

Replace `npc_from_spec` (undercity_engine.py:1000):

```python
def npc_from_spec(spec: dict) -> dict:
    """Instantiate a battle NPC dict from a fixed-stat spec. Optional combat
    identity (`passives`) and art override (`spriteId`) ride along when present."""
    npc = {k: spec[k] for k in
           ('id', 'name', 'hp', 'atk', 'def', 'spd', 'bounty', 'xp', 'itemChance')}
    if spec.get('passives'):
        npc['passives'] = list(spec['passives'])
    if spec.get('spriteId'):
        npc['spriteId'] = spec['spriteId']
    return npc
```

- [ ] **Step 4: Run it — expect PASS**

Run: `python -m pytest tests/test_undercity_engine.py::test_npc_from_spec_carries_passives_and_sprite -q`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add infrastructure/lambda/undercity_engine.py infrastructure/lambda/tests/test_undercity_engine.py
git commit -m "feat(undercity): npc_from_spec carries passives + spriteId"
```

---

### Task 2: `LAIR_FAMILIAR` registry + `LAIR_SIGNATURE` re-point

**Files:**
- Modify: `infrastructure/lambda/undercity_data.py:1038-1062`
- Test: `infrastructure/lambda/tests/test_undercity_db.py`

- [ ] **Step 1: Write the failing test**

Add to `test_undercity_db.py`:

```python
def test_lair_familiar_registry_shape():
    fam = data.LAIR_FAMILIAR
    assert set(fam) == {'skullbriars_familiar', 'slimefoots_saprolings',
                        'gitrog_spawn', 'sarulfs_packmate', 'ishkanahs_hatchling'}
    for fid, spec in fam.items():
        assert spec['id'] == fid
        assert spec['passives'] and isinstance(spec['passives'], list)
        assert spec['sprites'] and isinstance(spec['sprites'], list)
        # Mini-elite HP band: below the bosses (40-48) and depths wilds (42-56).
        assert 28 <= spec['hp'] <= 36
    # The five biomes now point at familiars; ruin stays a pool enemy.
    for biome in ('bone', 'garden', 'bog', 'cavern', 'city'):
        assert data.LAIR_SIGNATURE[biome] in fam
    assert data.LAIR_SIGNATURE['ruin'] == 'moldering_karock'
    # Familiars are EXCLUSIVE — never in a general wild/elite pool.
    assert not (set(fam) & set(data.ENEMY_SPECS_BY_ID))
```

- [ ] **Step 2: Run it — expect FAIL**

Run: `python -m pytest tests/test_undercity_db.py::test_lair_familiar_registry_shape -q`
Expected: FAIL (`AttributeError: module ... has no attribute 'LAIR_FAMILIAR'`).

- [ ] **Step 3: Implement**

In `undercity_data.py`, replace the `LAIR_SIGNATURE` block (lines ~1046-1053) with the registry + re-point. Keep `ENEMY_SPECS_BY_ID` as-is below it:

```python
# ── Boss familiars (design 2026-08-04) ───────────────────────────────────────
# Bespoke minions that exist ONLY in their boss's turf (not in any wild/elite
# pool). Each is a mini-elite whose menace is its signature trait, not its HP —
# low HP (below the boss and the depths wilds) so a ~level-5 creature powers
# through, which also keeps the stacking traits from spiralling. Each shares its
# trait with its lair boss (LAIR_BOSSES), so the familiar teaches the fight.
LAIR_FAMILIAR = {
    'skullbriars_familiar': {
        'id': 'skullbriars_familiar', 'name': "Skullbriar's Familiar",
        'hp': 32, 'atk': 12, 'def': 4, 'spd': 6, 'bounty': 20, 'xp': 30,
        'itemChance': 0.25, 'personality': 'brute', 'bluff': 0.18,
        'passives': ['grave_growth'], 'sprites': ['skullbriars_familiar']},
    'slimefoots_saprolings': {
        'id': 'slimefoots_saprolings', 'name': "Slimefoot's Saprolings",
        'hp': 34, 'atk': 10, 'def': 5, 'spd': 5, 'bounty': 20, 'xp': 30,
        'itemChance': 0.25, 'personality': 'balanced', 'bluff': 0.12,
        'passives': ['swarm'], 'sprites': ['slimefoots_saprolings']},
    'gitrog_spawn': {
        'id': 'gitrog_spawn', 'name': 'Gitrog Spawn',
        'hp': 34, 'atk': 10, 'def': 6, 'spd': 5, 'bounty': 20, 'xp': 30,
        'itemChance': 0.25, 'personality': 'turtle', 'bluff': 0.12,
        'passives': ['dredge'], 'sprites': ['gitrog_spawn', 'gitrog_spawn2']},
    'sarulfs_packmate': {
        'id': 'sarulfs_packmate', 'name': "Sarulf's Packmate",
        'hp': 30, 'atk': 11, 'def': 4, 'spd': 8, 'bounty': 20, 'xp': 30,
        'itemChance': 0.25, 'personality': 'trickster', 'bluff': 0.18,
        'passives': ['doom_counters'], 'sprites': ['sarulfs_packmate']},
    'ishkanahs_hatchling': {
        'id': 'ishkanahs_hatchling', 'name': "Ishkanah's Hatchling",
        'hp': 30, 'atk': 11, 'def': 4, 'spd': 8, 'bounty': 20, 'xp': 30,
        'itemChance': 0.25, 'personality': 'trickster', 'bluff': 0.18,
        'passives': ['web_venom'], 'sprites': ['ishankas_hatchling']},
}

# The five biome bosses spawn their familiar on WILD turf; the ruin keeps its
# borrowed pool signature (Lord of Extinction / Doomgape are separate content).
LAIR_SIGNATURE = {
    'bone':   'skullbriars_familiar',
    'garden': 'slimefoots_saprolings',
    'bog':    'gitrog_spawn',
    'cavern': 'sarulfs_packmate',
    'city':   'ishkanahs_hatchling',
    'ruin':   'moldering_karock',
}

# Trait passives surfaced as inspectable battle chips (client STATUS_INFO mirror).
TRAIT_PASSIVES = ('grave_growth', 'doom_counters', 'dredge', 'swarm', 'web_venom')
```

- [ ] **Step 4: Run it — expect PASS**

Run: `python -m pytest tests/test_undercity_db.py::test_lair_familiar_registry_shape -q`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add infrastructure/lambda/undercity_data.py infrastructure/lambda/tests/test_undercity_db.py
git commit -m "feat(undercity): LAIR_FAMILIAR registry, exclusive boss minions"
```

---

### Task 3: `_wild_battle` spawns the familiar + rotates its sprite

**Files:**
- Modify: `infrastructure/lambda/undercity_db.py:3977-3982`
- Test: `infrastructure/lambda/tests/test_undercity_db.py`

The existing signature tests (`test_boss_area_signature_spawns_themed_minion`, `test_boss_area_signature_missed_roll_uses_flat_pool`, `test_boss_area_signature_never_on_elite_spaces`, and the depths-pool test near line 4003) assert the OLD ids. Update them and add sprite-rotation coverage.

- [ ] **Step 1: Update + add tests**

In `test_undercity_db.py`, change the signature assertions to the familiar and add rotation. Replace the body of `test_boss_area_signature_spawns_themed_minion` and add a new test:

```python
def test_boss_area_signature_spawns_themed_minion(table, monkeypatch):
    sid = _sid(table); doc = _doc(table, sid, position='bone_d0')
    monkeypatch.setattr(db._rng, 'random', lambda: 0.0)   # under chance -> familiar
    ev = db._wild_battle(table, sid, doc, elite=False, region='depths')
    assert ev['npc']['id'] == data.LAIR_SIGNATURE['bone'] == 'skullbriars_familiar'
    assert 'grave_growth' in ev['npc'].get('passives', [])
    assert ev['npc']['spriteId'] == 'skullbriars_familiar'

def test_gitrog_spawn_rotates_sprite(table, monkeypatch):
    sid = _sid(table); doc = _doc(table, sid, position='bog_d0')
    monkeypatch.setattr(db._rng, 'random', lambda: 0.0)
    seen = set()
    for choice in ('gitrog_spawn', 'gitrog_spawn2'):
        monkeypatch.setattr(db._rng, 'choice', lambda seq, c=choice: c)
        ev = db._wild_battle(table, sid, doc, elite=False, region='depths')
        seen.add(ev['npc']['spriteId'])
    assert seen == {'gitrog_spawn', 'gitrog_spawn2'}
```

(Match the existing `_sid`/`_doc` helpers already used in that file; mirror the setup of the current signature tests.) Also update the two other signature tests' expected ids to the familiar ids, and the depths-pool test (~line 4003) so its `sig` lookup resolves through `LAIR_FAMILIAR`.

- [ ] **Step 2: Run — expect FAIL**

Run: `python -m pytest tests/test_undercity_db.py -k "signature or gitrog_spawn_rotates" -q`
Expected: FAIL (spec still resolved via `ENEMY_SPECS_BY_ID`; no `spriteId`/`passives`).

- [ ] **Step 3: Implement**

In `_wild_battle` (undercity_db.py), replace the signature resolution (lines ~3977-3982):

```python
    sig_id = None if elite else data.LAIR_SIGNATURE.get(area)
    if sig_id and _rng.random() < data.SIGNATURE_SPAWN_CHANCE:
        spec = data.LAIR_FAMILIAR.get(sig_id) or data.ENEMY_SPECS_BY_ID[sig_id]
    else:
        spec = _rng.choice(pool)
    npc = engine.npc_from_spec(spec)
    if spec.get('sprites'):
        npc['spriteId'] = _rng.choice(spec['sprites'])
    npc['personality'] = spec.get('personality', data.NPC_DEFAULT_PERSONALITY)
    npc['bluff'] = spec.get('bluff', data.NPC_DEFAULT_BLUFF)
    return _start_battle(table, sid, doc, 'elite' if elite else 'wild', npc,
                         node=doc.get('position'))
```

(The `sprites`/`spriteId` handling is additive; pool enemies without `sprites` keep `npc['id']` as their art id, unchanged.)

- [ ] **Step 4: Run — expect PASS**

Run: `python -m pytest tests/test_undercity_db.py -k "signature or gitrog_spawn_rotates" -q`
Expected: PASS.

- [ ] **Step 5: Full suite + commit**

```bash
python -m pytest tests -q      # keep everything green
git add infrastructure/lambda/undercity_db.py infrastructure/lambda/tests/test_undercity_db.py
git commit -m "feat(undercity): _wild_battle spawns boss familiar + rotates sprite"
```

---

## Phase 2 — The five traits in the engine

### Task 4: Config scalars + `Combatant` counters + serde persistence

**Files:**
- Modify: `infrastructure/lambda/undercity_config.py` (append near the combat scalars)
- Modify: `infrastructure/lambda/undercity_engine.py:34-46` (Combatant fields)
- Modify: `infrastructure/lambda/undercity_db.py:626-679` (`_bt_snapshot`/`_bt_to_combatant`/`_bt_store`)
- Test: `infrastructure/lambda/tests/test_undercity_db.py`

- [ ] **Step 1: Write the failing test**

```python
def test_snowball_counters_round_trip_and_persist_stats():
    c = engine.Combatant(name='F', hp=30, max_hp=30, atk=12, dfn=4, spd=6,
                         passives=frozenset({'grave_growth'}))
    c.growth_stacks = 2; c.doom_stacks = 1
    c.atk = 16; c.spd = 8; c.dfn = 6           # simulate mid-fight snowball
    snap = db._bt_snapshot(c)
    assert snap['growth_stacks'] == 2 and snap['doom_stacks'] == 1
    back = db._bt_to_combatant(snap)
    assert back.growth_stacks == 2 and back.doom_stacks == 1
    rec = {}
    db._bt_store(c, rec)
    # atk/spd now persist across rounds (previously only dfn did).
    assert rec['atk'] == 16 and rec['spd'] == 8 and rec['dfn'] == 6
    assert rec['growth_stacks'] == 2 and rec['doom_stacks'] == 1
```

- [ ] **Step 2: Run — expect FAIL**

Run: `python -m pytest tests/test_undercity_db.py::test_snowball_counters_round_trip_and_persist_stats -q`
Expected: FAIL (`AttributeError: 'Combatant' object has no attribute 'growth_stacks'`).

- [ ] **Step 3: Implement — config scalars**

Append to `undercity_config.py` (near the other combat scalars):

```python
# ── Boss-familiar / boss signature traits (design 2026-08-04) ────────────────
# Grave Growth (Skullbriar): unconditional per-round ramp, ATK-leaning, capped.
GRAVE_GROWTH_ATK = 2
GRAVE_GROWTH_DEF = 1
GRAVE_GROWTH_MAX = 6
# Doom Counters (Sarulf): +DOOM_STEP to ATK/DEF/SPD each round the holder wins or
# ties a mirror; bigger but deniable (force it to LOSE and it stalls). Capped.
DOOM_STEP = 2
DOOM_MAX = 4
# Dredge (Gitrog): flat HP regrow each round; kept small so escalating swings
# (and the player's DPS) still out-pace it and the fight terminates.
DREDGE_REGEN = 3
```

- [ ] **Step 4: Implement — Combatant fields**

In `undercity_engine.py`, add after `aggress_ramp` (line 40) inside the `Combatant` dataclass:

```python
    growth_stacks: int = field(default=0, repr=False)  # grave_growth ramp count
    doom_stacks: int = field(default=0, repr=False)    # doom_counters ramp count
```

- [ ] **Step 5: Implement — serde**

In `undercity_db.py`:

`_bt_snapshot` — add to the returned dict (alongside `aggress_ramp`):
```python
        'growth_stacks': int(c.growth_stacks), 'doom_stacks': int(c.doom_stacks),
```
`_bt_to_combatant` — add after `c.aggress_ramp = ...`:
```python
    c.growth_stacks = int(s.get('growth_stacks', 0))
    c.doom_stacks = int(s.get('doom_stacks', 0))
```
`_bt_store` — add (so direct atk/spd snowball survives the round boundary):
```python
    rec_side['atk'] = int(c.atk)
    rec_side['spd'] = int(c.spd)
    rec_side['growth_stacks'] = int(c.growth_stacks)
    rec_side['doom_stacks'] = int(c.doom_stacks)
```

- [ ] **Step 6: Run — expect PASS + full suite**

Run: `python -m pytest tests/test_undercity_db.py::test_snowball_counters_round_trip_and_persist_stats tests -q`
Expected: PASS (and no regressions).

- [ ] **Step 7: Commit**

```bash
git add infrastructure/lambda/undercity_config.py infrastructure/lambda/undercity_engine.py infrastructure/lambda/undercity_db.py infrastructure/lambda/tests/test_undercity_db.py
git commit -m "feat(undercity): trait scalars, Combatant snowball counters + serde"
```

---

### Task 5: Grave Growth + Doom Counters + Dredge in `resolve_round`

**Files:**
- Modify: `infrastructure/lambda/undercity_engine.py` (end-of-round section, before `return entries` at ~line 459)
- Test: `infrastructure/lambda/tests/test_undercity_engine.py`

- [ ] **Step 1: Write the failing tests**

```python
import undercity_config as cfg

def _rng_seq(vals):
    class R:
        def __init__(s): s.i = 0
        def uniform(s, a, b): return (a + b) / 2
        def random(s): return 0.5
        def randint(s, a, b): return a
    return R()

def test_grave_growth_ramps_atk_each_round_and_caps():
    a = engine.Combatant(name='S', hp=999, max_hp=999, atk=10, dfn=4, spd=6,
                         passives=frozenset({'grave_growth'}))
    d = engine.Combatant(name='D', hp=999, max_hp=999, atk=8, dfn=4, spd=6)
    for rnd in range(1, cfg.GRAVE_GROWTH_MAX + 3):
        engine.resolve_round(a, d, 'guard', 'guard', rnd, _rng_seq([]))
    assert a.growth_stacks == cfg.GRAVE_GROWTH_MAX            # capped
    assert a.atk == 10 + cfg.GRAVE_GROWTH_ATK * cfg.GRAVE_GROWTH_MAX
    assert a.dfn == 4 + cfg.GRAVE_GROWTH_DEF * cfg.GRAVE_GROWTH_MAX

def test_doom_counters_stack_on_win_or_tie_only():
    # Holder plays aggress; foe plays feint -> holder wins -> +1 doom.
    a = engine.Combatant(name='W', hp=999, max_hp=999, atk=10, dfn=4, spd=6,
                         passives=frozenset({'doom_counters'}))
    d = engine.Combatant(name='D', hp=999, max_hp=999, atk=8, dfn=4, spd=6)
    engine.resolve_round(a, d, 'aggress', 'feint', 1, _rng_seq([]))
    assert a.doom_stacks == 1 and a.atk == 10 + cfg.DOOM_STEP
    # A mirror tie (guard vs guard) also grants a counter.
    engine.resolve_round(a, d, 'guard', 'guard', 2, _rng_seq([]))
    assert a.doom_stacks == 2
    # Holder LOSES the exchange (guard vs aggress -> foe wins) -> no counter.
    before = a.doom_stacks
    engine.resolve_round(a, d, 'aggress', 'guard', 3, _rng_seq([]))
    assert a.doom_stacks == before

def test_dredge_regens_but_stays_below_max():
    a = engine.Combatant(name='G', hp=10, max_hp=30, atk=8, dfn=6, spd=5,
                         passives=frozenset({'dredge'}))
    d = engine.Combatant(name='D', hp=999, max_hp=999, atk=1, dfn=99, spd=1)
    engine.resolve_round(a, d, 'guard', 'guard', 1, _rng_seq([]))
    assert a.hp == 10 + cfg.DREDGE_REGEN
    a.hp = 29
    engine.resolve_round(a, d, 'guard', 'guard', 2, _rng_seq([]))
    assert a.hp == 30                                        # never exceeds max
```

- [ ] **Step 2: Run — expect FAIL**

Run: `python -m pytest tests/test_undercity_engine.py -k "grave_growth or doom_counters or dredge" -q`
Expected: FAIL (mechanics not implemented).

- [ ] **Step 3: Implement**

In `undercity_engine.py`, insert a new block immediately **before** `return entries` (after the Carapace Grind loop, ~line 458):

```python
    # ── Boss signature traits (design 2026-08-04) ────────────────────────────
    for side, c in (('attacker', attacker), ('defender', defender)):
        if c.hp <= 0:
            continue
        # Grave Growth (Skullbriar): unconditional per-round ramp, ATK-leaning.
        if c.has('grave_growth') and c.growth_stacks < data.GRAVE_GROWTH_MAX:
            c.growth_stacks += 1
            c.atk += data.GRAVE_GROWTH_ATK
            c.dfn += data.GRAVE_GROWTH_DEF
            entries.append({'round': rnd, 'by': side, 'growth': c.growth_stacks})
        # Doom Counters (Sarulf): +stat each round the holder wins or ties.
        won = (winner == side)
        tied = winner in ('clash', 'stall', 'whiff')
        if c.has('doom_counters') and (won or tied) and c.doom_stacks < data.DOOM_MAX:
            c.doom_stacks += 1
            c.atk += data.DOOM_STEP
            c.dfn += data.DOOM_STEP
            c.spd += data.DOOM_STEP
            entries.append({'round': rnd, 'by': side, 'doom': c.doom_stacks})
        # Dredge (Gitrog): flat regrow, bounded by max HP.
        if c.has('dredge') and c.hp < c.max_hp:
            heal = min(data.DREDGE_REGEN, c.max_hp - c.hp)
            c.hp += heal
            entries.append({'round': rnd, 'by': side, 'heal': heal, 'dredge': True})
```

(`winner` is already bound at the top of `resolve_round`; `data.GRAVE_GROWTH_*`/`DOOM_*`/`DREDGE_REGEN` are re-exported into `undercity_data` via its `from undercity_config import *`.)

- [ ] **Step 4: Run — expect PASS**

Run: `python -m pytest tests/test_undercity_engine.py -k "grave_growth or doom_counters or dredge" -q`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add infrastructure/lambda/undercity_engine.py infrastructure/lambda/tests/test_undercity_engine.py
git commit -m "feat(undercity): grave_growth, doom_counters, dredge traits"
```

---

### Task 6: `web_venom` — spider's winning strike applies rot

**Files:**
- Modify: `infrastructure/lambda/undercity_engine.py` (decisive-win branch, after the Rend block ~line 342)
- Test: `infrastructure/lambda/tests/test_undercity_engine.py`

- [ ] **Step 1: Write the failing test**

```python
def test_web_venom_applies_rot_on_a_win():
    a = engine.Combatant(name='I', hp=999, max_hp=999, atk=12, dfn=4, spd=8,
                         passives=frozenset({'web_venom'}))
    d = engine.Combatant(name='D', hp=999, max_hp=999, atk=6, dfn=4, spd=6)
    # aggress vs feint -> holder wins decisively -> +1 rot on the loser.
    engine.resolve_round(a, d, 'aggress', 'feint', 1, _rng_seq([]))
    assert d.rot_stacks == 1
    # A loss applies no venom.
    d.rot_stacks = 0
    engine.resolve_round(a, d, 'guard', 'aggress', 2, _rng_seq([]))  # holder loses
    assert d.rot_stacks == 0
```

- [ ] **Step 2: Run — expect FAIL**

Run: `python -m pytest tests/test_undercity_engine.py::test_web_venom_applies_rot_on_a_win -q`
Expected: FAIL.

- [ ] **Step 3: Implement**

In the decisive-win branch of `resolve_round`, right after the Rend block (undercity_engine.py:340-342):

```python
            # Web Venom (Ishkanah): any decisive win injects a rot stack.
            if winr.has('web_venom') and losr.hp > 0:
                losr.rot_stacks += 1
                entries.append({'round': rnd, 'by': win_side, 'rotApplied': 1})
```

- [ ] **Step 4: Run — expect PASS**

Run: `python -m pytest tests/test_undercity_engine.py::test_web_venom_applies_rot_on_a_win -q`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add infrastructure/lambda/undercity_engine.py infrastructure/lambda/tests/test_undercity_engine.py
git commit -m "feat(undercity): web_venom trait applies rot on a win"
```

---

## Phase 3 — Bosses share the trait

### Task 7: Add signature `passives` to the five lair bosses

**Files:**
- Modify: `infrastructure/lambda/undercity_data.py:1200-1214` (`LAIR_BOSSES`)
- Test: `infrastructure/lambda/tests/test_undercity_db.py`

- [ ] **Step 1: Write the failing test**

```python
def test_lair_bosses_carry_familiar_traits():
    want = {'bone_lair': 'grave_growth', 'garden_lair': 'swarm',
            'bog_lair': 'dredge', 'cavern_lair': 'doom_counters',
            'city_lair': 'web_venom'}
    for node, trait in want.items():
        assert trait in (data.LAIR_BOSSES[node].get('passives') or []), node

def test_lair_boss_combatant_has_trait(table, monkeypatch):
    # Engaging a lair boss builds a combatant carrying its signature passive.
    sid = _sid(table); doc = _doc(table, sid, position='bone_lair')
    ev = db._lair(table, sid, doc, 'bone_lair')
    rec = db._get(table, db._season_pk(sid), 'BATTLE')      # active battle record
    assert 'grave_growth' in (rec['npc'].get('passives') or [])
```

(Adjust the second test to the file's existing lair-engagement helper/fixtures — mirror how other `_lair`/battle tests in the file set `position` and read the battle record. If `_lair`'s signature differs, call it the same way the existing lair tests do.)

- [ ] **Step 2: Run — expect FAIL**

Run: `python -m pytest tests/test_undercity_db.py -k "lair_boss" -q`
Expected: FAIL (bosses have no `passives`).

- [ ] **Step 3: Implement**

Add `'passives': [...]` to each of the five biome entries in `LAIR_BOSSES` (undercity_data.py). Example for two; apply the mapping to all five (bone→grave_growth, garden→swarm, bog→dredge, cavern→doom_counters, city→web_venom):

```python
    'city_lair': {'id': 'ishkanah', 'name': 'Ishkanah, Grafwidow',
                  'hp': 42, 'atk': 14, 'def': 5, 'spd': 8,
                  'personality': 'trickster', 'bluff': 0.35,
                  'passives': ['web_venom'], **_LAIR_REWARD},
    'cavern_lair': {'id': 'sarulf', 'name': 'Sarulf, Realm Eater',
                    'hp': 44, 'atk': 13, 'def': 6, 'spd': 7,
                    'personality': 'balanced', 'bluff': 0.35,
                    'passives': ['doom_counters'], **_LAIR_REWARD},
    'bog_lair': {'id': 'gitrog_monster', 'name': 'The Gitrog Monster',
                 'hp': 48, 'atk': 12, 'def': 7, 'spd': 5,
                 'personality': 'turtle', 'bluff': 0.35,
                 'passives': ['dredge'], **_LAIR_REWARD},
    'bone_lair': {'id': 'skullbriar', 'name': 'Skullbriar, the Walking Grave',
                  'hp': 40, 'atk': 15, 'def': 6, 'spd': 6,
                  'personality': 'brute', 'bluff': 0.35,
                  'passives': ['grave_growth'], **_LAIR_REWARD},
    'garden_lair': {'id': 'slimefoot', 'name': 'Slimefoot, the Stowaway',
                    'hp': 46, 'atk': 13, 'def': 7, 'spd': 4,
                    'personality': 'turtle', 'bluff': 0.35,
                    'passives': ['swarm'], **_LAIR_REWARD},
```

Verify the lair starter builds its npc via `engine.npc_from_spec` (which now carries `passives`). If `_lair` constructs the npc dict by hand instead, add `'passives': g.get('passives')` where it assembles `npc` (grep `def _lair(` in `undercity_db.py`).

- [ ] **Step 4: Run — expect PASS + full suite**

Run: `python -m pytest tests/test_undercity_db.py -k "lair_boss" tests -q`
Expected: PASS. **If a pre-existing lair-clear balance test now fails** (a boss got too strong), that is the balance gate talking — reduce the trait's contribution for bosses via the caps in Task 4, re-run, and note it. Do **not** silently weaken the test.

- [ ] **Step 5: Commit**

```bash
git add infrastructure/lambda/undercity_data.py infrastructure/lambda/tests/test_undercity_db.py
git commit -m "feat(undercity): lair bosses carry their familiar's signature trait"
```

---

## Phase 4 — Client: sprites, trait chips, mirrors

### Task 8: Load boss-familiar sprites from `boss_spawns/`

**Files:**
- Modify: `src/app/undercity/tabs/board-tab.component.ts:2486-2491` (`npcSpriteUrl`)
- Modify: `src/app/undercity/engine/board-canvas.ts:2339` (`loadEnemy` img.src)
- Create (shared const): add to `src/app/undercity/data/dungeons.ts`

- [ ] **Step 1: Add the shared sprite-folder set**

Append to `src/app/undercity/data/dungeons.ts`:

```ts
/** Familiar sprite ids whose art lives in public/undercity/boss_spawns/ rather
 *  than undercity/enemies/. Mirrors LAIR_FAMILIAR[*].sprites in undercity_data.py. */
export const BOSS_SPAWN_SPRITES = new Set<string>([
  'skullbriars_familiar', 'slimefoots_saprolings',
  'gitrog_spawn', 'gitrog_spawn2', 'sarulfs_packmate', 'ishankas_hatchling',
]);

/** Battle-art URL for an enemy sprite id, honoring the boss_spawns/ folder. */
export function enemyArtUrl(spriteId: string): string {
  const folder = BOSS_SPAWN_SPRITES.has(spriteId) ? 'boss_spawns' : 'enemies';
  return `undercity/${folder}/${spriteId}.png`;
}
```

- [ ] **Step 2: Use it in `npcSpriteUrl`**

In `board-tab.component.ts`, import and use it. Replace the body of `npcSpriteUrl` (line ~2486) so the enemy branch routes through `enemyArtUrl`:

```ts
  private npcSpriteUrl(evType: string, npcId: string): string {
    // (unchanged non-enemy branches above)
    return enemyArtUrl(npcId);
  }
```

Add `enemyArtUrl` (and keep existing) to the `dungeons` import at the top of the file.

- [ ] **Step 3: Use it in `board-canvas.ts` `loadEnemy`**

Replace `img.src = `undercity/enemies/${enemyId}.png`;` (line ~2339) with:

```ts
    img.src = enemyArtUrl(enemyId);
```

Add `import { enemyArtUrl } from '../data/dungeons';` to `board-canvas.ts`.

- [ ] **Step 4: Verify the npc payload carries `spriteId` to the client**

Confirm `BattleNpc`/event npc types in `services/undercity-models.ts` include `spriteId?: string` (they do — lines 363/376/488). The server sets `npc['spriteId']` in `_wild_battle` (Task 3); ensure `_start_battle` includes it on the client-facing event npc. Grep `_start_battle` in `undercity_db.py`: if it copies a whitelist of npc keys into the spaceEvent, add `spriteId`. If it passes the npc dict through, no change needed.

- [ ] **Step 5: Build**

Run: `npm run build`
Expected: build succeeds; no TS errors.

- [ ] **Step 6: Commit**

```bash
git add src/app/undercity/data/dungeons.ts src/app/undercity/tabs/board-tab.component.ts src/app/undercity/engine/board-canvas.ts
git commit -m "feat(undercity): load boss-familiar sprites from boss_spawns/"
```

---

### Task 9: Surface trait chips (with live stacks) in battle status

**Files:**
- Modify: `infrastructure/lambda/undercity_db.py:682-690` (`_battle_status`)
- Modify: `src/app/undercity/services/undercity-models.ts` (`BattleStatus`)
- Modify: `src/app/undercity/data/combat.ts:126-182` (`STATUS_INFO` + `statusChips`)
- Test: `infrastructure/lambda/tests/test_undercity_db.py`

- [ ] **Step 1: Write the failing backend test**

```python
def test_battle_status_surfaces_trait_chips_with_stacks():
    side = {'rot_stacks': 0, 'buffs': [], 'statDelta': {},
            'passives': ['doom_counters'], 'doom_stacks': 3, 'growth_stacks': 0}
    st = db._battle_status(side)
    assert 'doom_counters' in st['traits']
    assert st['stacks']['doom_counters'] == 3
```

- [ ] **Step 2: Run — expect FAIL**

Run: `python -m pytest tests/test_undercity_db.py::test_battle_status_surfaces_trait_chips_with_stacks -q`
Expected: FAIL (`KeyError: 'traits'`).

- [ ] **Step 3: Implement backend**

Replace `_battle_status` (undercity_db.py:682):

```python
def _battle_status(side):
    """Client-facing standing status for one combatant snapshot: rot stacks, the
    active buff/debuff kinds, the net temp stat modifier, and any signature
    trait chips (with live stack counts for the two stacking traits)."""
    delta = side.get('statDelta') or {}
    traits = [p for p in (side.get('passives') or []) if p in data.TRAIT_PASSIVES]
    stacks = {}
    if side.get('growth_stacks'):
        stacks['grave_growth'] = int(side['growth_stacks'])
    if side.get('doom_stacks'):
        stacks['doom_counters'] = int(side['doom_stacks'])
    return {'rot': int(side.get('rot_stacks', 0)),
            'buffs': list(side.get('buffs') or []),
            'delta': {s: int(delta.get(s, 0)) for s in ('atk', 'def', 'spd')},
            'traits': traits, 'stacks': stacks}
```

- [ ] **Step 4: Run backend test — expect PASS**

Run: `python -m pytest tests/test_undercity_db.py::test_battle_status_surfaces_trait_chips_with_stacks -q`
Expected: PASS.

- [ ] **Step 5: Client model**

In `services/undercity-models.ts`, extend the `BattleStatus` interface with:

```ts
  /** Signature enemy trait kinds (boss familiars) -> STATUS_INFO chips. */
  traits?: string[];
  /** Live stack counts for stacking traits (grave_growth / doom_counters). */
  stacks?: Record<string, number>;
```

- [ ] **Step 6: Client STATUS_INFO + statusChips**

In `data/combat.ts`, add the five trait entries to `STATUS_INFO` (no emoji — Material ligatures only, per the game's symbol rule):

```ts
  grave_growth: { label: 'Grave Growth', icon: 'trending_up', tone: 'debuff',
    blurb: 'The grave keeps growing: gains ATK/DEF every round it survives.' },
  doom_counters: { label: 'Doom', icon: 'change_history', tone: 'debuff',
    blurb: 'Compounds: +2 ATK/DEF/SPD each round it wins or ties. Force it to lose.' },
  dredge: { label: 'Dredge', icon: 'healing', tone: 'debuff',
    blurb: 'Knits its wounds shut a little each round. Out-pace the regrowth.' },
  swarm: { label: 'Swarm', icon: 'grain', tone: 'debuff',
    blurb: 'The brood piles on: an extra chip hit every round.' },
  web_venom: { label: 'Venom', icon: 'coronavirus', tone: 'debuff',
    blurb: 'Its winning strikes leave rot behind.' },
```

Extend `statusChips` (line 173) to append trait chips with live counts:

```ts
export function statusChips(status: BattleStatus | null | undefined): StatusChip[] {
  if (!status) return [];
  const chips: StatusChip[] = [];
  if (status.rot > 0) chips.push({ kind: 'rot', count: status.rot, info: STATUS_INFO['rot'] });
  const mapped = (status.buffs ?? [])
    .filter((k) => k !== 'rot' && STATUS_INFO[k])
    .map((k) => ({ kind: k, count: 1, info: STATUS_INFO[k] }));
  mapped.sort((a, b) => Number(a.info.tone === 'debuff') - Number(b.info.tone === 'debuff'));
  const traits = (status.traits ?? [])
    .filter((k) => STATUS_INFO[k])
    .map((k) => ({ kind: k, count: status.stacks?.[k] ?? 1, info: STATUS_INFO[k] }));
  return [...chips, ...mapped, ...traits];
}
```

(`StatusChip.count > 1` already renders a `×N` badge — so Grave Growth / Doom show their live stack count, and the existing chip UI in `interactive-battle`/`board-tab` renders the label + blurb, which is the tap-to-inspect the user asked for.)

- [ ] **Step 7: Build + commit**

Run: `npm run build` (expect success), then:
```bash
git add infrastructure/lambda/undercity_db.py infrastructure/lambda/tests/test_undercity_db.py src/app/undercity/services/undercity-models.ts src/app/undercity/data/combat.ts
git commit -m "feat(undercity): surface boss-familiar trait chips with live stacks"
```

---

## Phase 5 — Sigil codex

### Task 10: Boss lore + trait data on the `DUNGEONS` mirror

**Files:**
- Modify: `src/app/undercity/data/dungeons.ts:6-76`

- [ ] **Step 1: Extend `DungeonInfo` + fill all five**

Add to the interface:

```ts
  /** In-world codex flavor (region-lore voice) — Sigils tab boss popout. */
  lore: string;
  /** Signature combat trait, mirrors the boss/familiar passive. */
  trait: { name: string; blurb: string };
```

Then add `lore` + `trait` to each of the five `DUNGEONS` entries (final copy from the design doc §3.2):

```ts
  // city:
  lore: "The Broodwarrens are her pantry, strung wall to wall in grey silk. " +
    "Ishkanah is in no hurry — a single bite keeps working long after you've cut yourself free of the web.",
  trait: { name: 'Venom', blurb: 'Her winning strikes leave rot behind.' },
  // cavern:
  lore: "Gloomroot's apex doesn't hunt so much as accrue. Every kill and every " +
    'stalemate settles onto the wolf like silt, until what leaves the fight is a good deal larger than what walked into it.',
  trait: { name: 'Doom Counters', blurb: "Compounds every round it doesn't lose. Force it to lose and the ramp stalls." },
  // bog:
  lore: 'A frog the size of a barge, and the Drownedway is its gut. The black ' +
    'water rots whatever it swallows, then hands it back for the Gitrog to grow again.',
  trait: { name: 'Dredge', blurb: 'Knits its wounds shut each round — out-hurry it.' },
  // bone:
  lore: "The Marrow Pits don't bury their dead so much as promote them. " +
    'Skullbriar is a shamble of borrowed bone that only gets heavier — every blow it weathers is another rib lashed to the heap.',
  trait: { name: 'Grave Growth', blurb: 'Grows stronger the longer it lives.' },
  // garden:
  lore: 'A fungal stowaway that treats the Rotcellar as one big body. Cut it and ' +
    'it seeds; the thing that answers is never one saproling but a whole squabbling patch of them.',
  trait: { name: 'Saproling Swarm', blurb: 'Its brood piles on every round.' },
```

- [ ] **Step 2: Build**

Run: `npm run build`
Expected: success (all `DungeonInfo` entries satisfy the new required fields — a missing one is a compile error, which is the check).

- [ ] **Step 3: Commit**

```bash
git add src/app/undercity/data/dungeons.ts
git commit -m "feat(undercity): boss codex lore + trait on DUNGEONS mirror"
```

---

### Task 11: Tap-to-inspect codex panel in the Sigils sub-tab

**Files:**
- Modify: `src/app/undercity/tabs/creature-tab.component.ts:844-857`
- Modify: `src/app/undercity/tabs/creature-tab.component.html:704-716`
- Modify: `src/app/undercity/tabs/creature-tab.component.scss`

- [ ] **Step 1: Component state**

In `creature-tab.component.ts`, add a selection signal near `sigilEntries` (line 844):

```ts
  protected readonly selectedBoss = signal<string | null>(null);
  protected toggleBoss(biome: string): void {
    this.selectedBoss.update((b) => (b === biome ? null : biome));
  }
  protected readonly selectedDungeon = computed(() => {
    const b = this.selectedBoss();
    return b ? this.sigilEntries.find((d) => d.biome === b) ?? null : null;
  });
```

(`signal`/`computed` are already imported in this file — it uses them elsewhere.)

- [ ] **Step 2: Make tiles tappable + render the panel**

In `creature-tab.component.html`, make the sigil tile a button-like element and add the codex panel. Replace the `sigil-tile` wrapper (line ~706) to add the click + selected state, and insert the panel after the `sigil-grid` closes:

```html
                <div class="sigil-tile" [class.claimed]="hasSigil(d.biome)"
                     [class.selected]="selectedBoss() === d.biome"
                     role="button" tabindex="0"
                     (click)="toggleBoss(d.biome)"
                     (keyup.enter)="toggleBoss(d.biome)">
                  <div class="sigil-portrait">
                    <img [src]="'undercity/guardians/' + d.lairNpcId + '.png'" [alt]="d.lairName" />
                    @if (!hasSigil(d.biome)) {
                      <mat-icon class="mi sigil-lock">lock</mat-icon>
                    }
                  </div>
                  <span class="sigil-biome">{{ d.biomeName }}</span>
                  <span class="sigil-boss-name">{{ d.lairName }}</span>
                  <span class="sigil-state">{{ hasSigil(d.biome) ? 'Defeated' : 'Undefeated' }}</span>
                </div>
```

After the `</div>` that closes `.sigil-grid`, add:

```html
              @if (selectedDungeon(); as d) {
                <div class="boss-codex">
                  <div class="codex-head">
                    <img [src]="'undercity/guardians/' + d.lairNpcId + '.png'" [alt]="d.lairName" />
                    <div>
                      <span class="codex-name">{{ d.lairName }}</span>
                      <span class="codex-biome muted">{{ d.biomeName }} — {{ d.name }}</span>
                    </div>
                    <button type="button" class="codex-close" (click)="selectedBoss.set(null)"
                            aria-label="Close">
                      <mat-icon class="mi">close</mat-icon>
                    </button>
                  </div>
                  <p class="codex-lore">{{ d.lore }}</p>
                  <div class="codex-trait">
                    <span class="trait-name">{{ d.trait.name }}</span>
                    <span class="trait-blurb muted">{{ d.trait.blurb }}</span>
                  </div>
                </div>
              }
```

- [ ] **Step 3: Styles**

Append to `creature-tab.component.scss` (reuse the Golgari tokens already used in this file — `--accent-color`, existing card/panel patterns):

```scss
.sigil-tile { cursor: pointer; }
.sigil-tile.selected { outline: 2px solid var(--accent-color); border-radius: 8px; }

.boss-codex {
  margin-top: 12px;
  padding: 12px;
  border: 1px solid var(--accent-color);
  border-radius: 10px;
  background: rgba(0, 0, 0, 0.25);

  .codex-head { display: flex; align-items: center; gap: 10px;
    img { width: 48px; height: 48px; object-fit: contain; }
    .codex-name { display: block; font-weight: 600; }
    .codex-biome { display: block; font-size: 0.8rem; }
    .codex-close { margin-left: auto; background: none; border: none; color: inherit; cursor: pointer; }
  }
  .codex-lore { margin: 10px 0; font-style: italic; line-height: 1.45; }
  .codex-trait { display: flex; flex-direction: column; gap: 2px;
    padding-top: 8px; border-top: 1px solid rgba(255, 255, 255, 0.12);
    .trait-name { font-weight: 600; color: var(--accent-color); }
    .trait-blurb { font-size: 0.85rem; }
  }
}
```

- [ ] **Step 4: Build + manual verify**

Run: `npm run build` (expect success). Then (optional, via the `run-undercity` skill) open the creature tab → Sigils, tap a boss, confirm the codex opens with lore + trait and closes.

- [ ] **Step 5: Commit**

```bash
git add src/app/undercity/tabs/creature-tab.component.ts src/app/undercity/tabs/creature-tab.component.html src/app/undercity/tabs/creature-tab.component.scss
git commit -m "feat(undercity): tap-to-inspect boss codex in Sigils sub-tab"
```

---

## Phase 6 — Balance gate & final green

### Task 12: Sim balance gate — familiars are beatable teachers

**Files:**
- Create: `infrastructure/lambda/sim/sim_boss_familiars.py`
- Reference: existing sims in `infrastructure/lambda/sim/` (follow their harness / `proto_fix.verify_real` pattern)

- [ ] **Step 1: Write the sim**

Model a **~level-5 creature powering through** (use the sim harness's existing level-5 loadout builder; mirror an existing sim script's setup). For each familiar in `data.LAIR_FAMILIAR`, autobattle N=2000 fights via `engine.resolve_battle_rounds` (with `frenzy_from=data.FRENZY_START`, the wild default) against good-play stance policy, and assert:

```python
# Pseudocode shape — adapt to the sim harness already in sim/.
THRESHOLD = 0.75   # good play clears a familiar at least this often
for fid, spec in data.LAIR_FAMILIAR.items():
    wr = simulate_winrate(level5_creature(), spec, n=2000)
    print(f'{fid}: {wr:.2%}')
    assert wr >= THRESHOLD, f'{fid} too hard at {wr:.2%}'
```

- [ ] **Step 2: Run the sim**

Run: `cd infrastructure/lambda && python -m sim.sim_boss_familiars` (or the sim/ convention).
Expected: each familiar prints ≥ 75%. **If any is below**, lower that familiar's `atk`/`hp` (Task 2) or the trait caps (Task 4), re-run, and record the final numbers as a comment in `LAIR_FAMILIAR`. Familiars must read as "a level-5 powers through."

- [ ] **Step 3: Commit**

```bash
git add infrastructure/lambda/sim/sim_boss_familiars.py infrastructure/lambda/undercity_data.py infrastructure/lambda/undercity_config.py
git commit -m "test(undercity): sim gate — boss familiars stay beatable"
```

---

### Task 13: Full suite + build, mirror audit

- [ ] **Step 1: Backend green**

Run: `cd infrastructure/lambda && python -m pytest tests -q`
Expected: all pass (including the updated signature/lair tests and `test_all_battle_specs_have_valid_personality`, `test_balance_good_play_beats_fodder`).

- [ ] **Step 2: Frontend build**

Run: `npm run build`
Expected: success.

- [ ] **Step 3: Mirror audit**

Confirm the display mirrors match the server: trait scalars are only referenced server-side (no client duplication needed beyond `STATUS_INFO` blurbs and `BOSS_SPAWN_SPRITES`); `dungeons.ts` `trait` blurbs match `STATUS_INFO`; `BOSS_SPAWN_SPRITES` matches every `sprites` value in `LAIR_FAMILIAR`. Fix any drift.

- [ ] **Step 4: Final commit (if audit changed anything)**

```bash
git add -A
git commit -m "chore(undercity): mirror audit for boss familiars"
```

---

## Self-Review — spec coverage

- **Bespoke exclusive familiars** → Task 2 (`LAIR_FAMILIAR`, exclusivity asserted), Task 3 (spawn).
- **Mini-elite, power-through HP** → Task 2 (hp 30-34 band asserted), Task 12 (sim gate).
- **Five shared traits (3 new + swarm + rot)** → Tasks 5 (grave_growth/doom/dredge), 6 (web_venom), Task 2/7 (swarm assigned).
- **Traits on both familiar and boss** → Task 2 (familiar `passives`), Task 7 (boss `passives`).
- **Round-to-round persistence of snowballs** → Task 4 (serde + atk/spd write-back).
- **Tappable trait chips with live stacks** → Task 9 (`_battle_status` + `STATUS_INFO` + `statusChips` count).
- **Sprites from boss_spawns/, Gitrog rotation, Slimefoot gang art** → Task 3 (rotation), Task 8 (folder loader).
- **Ruin unchanged** → Task 2 (asserts `ruin == 'moldering_karock'`).
- **Sigil codex: tap → in-world lore + trait** → Task 10 (data), Task 11 (UI).
- **Balance "not too hard"** → Task 12 sim gate + Task 7 boss-clear regression note.
- **Mirror rule / no emoji** → Task 9 & 10 (Material icons only), Task 13 (audit).

---

## Execution note

The design doc is the source of truth for copy and numbers; starting stat/scalar
values here are pre-sim and may be adjusted by Task 12's gate — record final
values back into `LAIR_FAMILIAR` / `undercity_config.py` comments when they settle.
