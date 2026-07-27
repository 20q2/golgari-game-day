# Undercity PvP AI-Clone Duel — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Replace Undercity's one-shot auto-resolved PvP with an interactive round-by-round duel against an AI-controlled clone of the target, where only the attacker risks HP/death and renown is gated by relative level.

**Architecture:** Route PvP through the existing interactive combat machine (currently PvE-only). The `battle` action becomes a `_start_battle(kind='pvp')` call whose "NPC" is a full-HP snapshot clone of the target (gear-inclusive stats, passives, perks, riders) with a stance-AI personality derived from its stat spread. Rounds/flee reuse the existing kind-agnostic handlers; a new `_finish_pvp` finisher applies spore-steal from the *live* target, symmetric XP, level-gated renown, composts the attacker on loss, and pushes a return-popup away-event. The target is never mutated mid-fight.

**Tech Stack:** Python 3.11 Lambda (pure engine + DynamoDB dispatcher), pytest (in-memory FakeTable suite), Angular 20 standalone components (verified via `npm run build:prod`, no frontend test runner).

**Spec:** `specs/2026-07-27-undercity-pvp-clone-duel-design.md`

**Test loop (backend):** `cd infrastructure/lambda && python -m pytest tests -q`
**Build check (frontend):** `npm run build:prod` from repo root.

---

## File Structure

| File | Responsibility | Change |
|---|---|---|
| `infrastructure/lambda/undercity_engine.py` | Pure combat/AI helpers | Add `clone_personality()` |
| `infrastructure/lambda/undercity_config.py` | Scalar tunables | Add `CLONE_DOMINANCE_MARGIN` |
| `infrastructure/lambda/undercity_data.py` | Balance tables + renown | Gate `compute_renown` on `pvpRenownWins`; add `CLONE_BLUFF_BY_LEVEL` |
| `infrastructure/lambda/undercity_db.py` | DynamoDB I/O + dispatcher | Extend `_npc_combatant`; build clone; rewrite `_battle`; add `_finish_pvp`; dispatch; away-event copy |
| `infrastructure/lambda/tests/test_undercity_db.py` | Integration suite | New PvP duel tests |
| `infrastructure/lambda/tests/test_undercity_engine.py` | Engine unit tests | `clone_personality` tests |
| `src/app/undercity/services/undercity-models.ts` | Client types | `AwayEvent` pvp `outcome` + `SpaceEvent` npc sprite fields |
| `src/app/undercity/tabs/board-tab.component.ts` | Board UI + combat | Rewrite `attack()`; pvp sprite in `openLiveBattle`; away-popup copy |

---

## Task 1: `clone_personality()` engine helper

Derives a stance-AI personality from a stat spread. Pure function, no I/O.

**Files:**
- Modify: `infrastructure/lambda/undercity_config.py`
- Modify: `infrastructure/lambda/undercity_engine.py` (near `pick_stance`, ~line 97)
- Test: `infrastructure/lambda/tests/test_undercity_engine.py`

- [ ] **Step 1: Add the config scalar**

In `undercity_config.py`, add near the other combat scalars:

```python
# PvP clone: the top stat must exceed the second-highest by at least this
# fraction to lock in a themed personality; otherwise the clone is 'balanced'.
CLONE_DOMINANCE_MARGIN = 0.20
```

- [ ] **Step 2: Write the failing test**

Add to `test_undercity_engine.py`:

```python
def test_clone_personality_dominant_stats():
    from undercity import undercity_engine as engine
    assert engine.clone_personality(20, 8, 8) == 'brute'      # ATK dominant
    assert engine.clone_personality(8, 20, 8) == 'turtle'     # DEF dominant
    assert engine.clone_personality(8, 8, 20) == 'trickster'  # SPD dominant


def test_clone_personality_flat_spread_is_balanced():
    from undercity import undercity_engine as engine
    # Top within the dominance margin of the runner-up -> balanced.
    assert engine.clone_personality(11, 10, 10) == 'balanced'
    assert engine.clone_personality(10, 10, 10) == 'balanced'
```

(Match the existing import style in the file — if tests import `undercity_engine as engine` directly, use that.)

- [ ] **Step 3: Run it to verify it fails**

Run: `cd infrastructure/lambda && python -m pytest tests/test_undercity_engine.py -k clone_personality -v`
Expected: FAIL — `AttributeError: module ... has no attribute 'clone_personality'`.

- [ ] **Step 4: Implement**

In `undercity_engine.py`, right after `pick_stance` (~line 108):

```python
_STAT_PERSONALITY = {'atk': 'brute', 'dfn': 'turtle', 'spd': 'trickster'}


def clone_personality(atk: float, dfn: float, spd: float) -> str:
    """Pick a stance-AI personality from a PvP clone's gear-inclusive stat
    spread: the dominant stat themes the clone (ATK->brute, DEF->turtle,
    SPD->trickster) only if it clears the runner-up by CLONE_DOMINANCE_MARGIN;
    an even spread yields 'balanced'."""
    stats = [('atk', atk), ('dfn', dfn), ('spd', spd)]
    stats.sort(key=lambda kv: kv[1], reverse=True)
    (top_key, top), (_, second) = stats[0], stats[1]
    if second <= 0 or top >= second * (1 + data.CLONE_DOMINANCE_MARGIN):
        return _STAT_PERSONALITY[top_key]
    return 'balanced'
```

(`data` is already imported in the engine as the config/data module — confirm the alias used at the top of the file, e.g. `from . import undercity_data as data`, and that `CLONE_DOMINANCE_MARGIN` is re-exported there or referenced via the config module the engine already uses. If the engine reads scalars from `undercity_config`, reference that module instead.)

- [ ] **Step 5: Run it to verify it passes**

Run: `cd infrastructure/lambda && python -m pytest tests/test_undercity_engine.py -k clone_personality -v`
Expected: PASS (2 tests).

- [ ] **Step 6: Commit**

```bash
git add infrastructure/lambda/undercity_engine.py infrastructure/lambda/undercity_config.py infrastructure/lambda/tests/test_undercity_engine.py
git commit -m "feat(undercity): clone_personality helper for PvP stat-spread AI"
```

---

## Task 2: Level-gated PvP renown (`pvpRenownWins`)

Renown counts a PvP win only when the target was the attacker's level or higher. New counter feeds `compute_renown`; legacy `pvpWins` keeps its meaning. A legacy-fallback keeps existing players' renown intact.

**Files:**
- Modify: `infrastructure/lambda/undercity_data.py` (`compute_renown`, ~line 1256)
- Test: `infrastructure/lambda/tests/test_undercity_db.py` (unit-style, no table needed)

- [ ] **Step 1: Write the failing test**

Add to `test_undercity_db.py`:

```python
def test_compute_renown_uses_pvp_renown_wins():
    from undercity import undercity_data as data
    base = data.compute_renown({'pvpWins': 0, 'pvpRenownWins': 0})
    gated = data.compute_renown({'pvpWins': 5, 'pvpRenownWins': 2})
    assert gated - base == 2 * data.RENOWN['per_pvp_win']


def test_compute_renown_grandfathers_legacy_pvp_wins():
    from undercity import undercity_data as data
    # A player from before the split (no pvpRenownWins key) keeps renown for
    # their existing pvpWins.
    legacy = data.compute_renown({'pvpWins': 3})
    assert legacy == 3 * data.RENOWN['per_pvp_win']
```

- [ ] **Step 2: Run it to verify it fails**

Run: `cd infrastructure/lambda && python -m pytest tests/test_undercity_db.py -k compute_renown -v`
Expected: FAIL — the first test's delta is `5 * per_pvp_win`, not `2 * per_pvp_win`, because `compute_renown` still reads `pvpWins`.

- [ ] **Step 3: Implement**

In `undercity_data.py`, change `compute_renown` (line 1256):

```python
def compute_renown(player: dict) -> int:
    # PvP renown is gated to wins against equal-or-higher-level foes, tracked in
    # pvpRenownWins. Players from before the split fall back to their raw
    # pvpWins so their earned renown is grandfathered in.
    pvp_renown_wins = player.get('pvpRenownWins', player.get('pvpWins', 0))
    return (RENOWN['per_pvp_win'] * pvp_renown_wins
            + RENOWN['per_wild_win'] * player.get('wildWins', 0)
            + RENOWN['per_poi'] * len(player.get('poiClaims', []))
            + player.get('bossDamage', 0) // RENOWN['boss_damage_per_point'])
```

- [ ] **Step 4: Run it to verify it passes**

Run: `cd infrastructure/lambda && python -m pytest tests/test_undercity_db.py -k compute_renown -v`
Expected: PASS (2 tests).

- [ ] **Step 5: Commit**

```bash
git add infrastructure/lambda/undercity_data.py infrastructure/lambda/tests/test_undercity_db.py
git commit -m "feat(undercity): gate PvP renown on pvpRenownWins with legacy fallback"
```

---

## Task 3: Carry perks/riders on cloned NPCs

`_npc_combatant` currently drops perks/riders — fine for real monsters, wrong for a faithful player clone. Add optional pass-through; existing callers are unaffected (they don't set those keys).

**Files:**
- Modify: `infrastructure/lambda/undercity_db.py` (`_npc_combatant`, line 641)
- Test: `infrastructure/lambda/tests/test_undercity_db.py`

- [ ] **Step 1: Write the failing test**

```python
def test_npc_combatant_carries_perks_and_riders():
    from undercity import undercity_db as db
    npc = {'name': 'Clone', 'hp': 40, 'maxHp': 40, 'atk': 10, 'def': 5, 'spd': 6,
           'passives': ['deathrite'], 'perks': ['carapace_grind'],
           'riders': ['bramble'], 'rider_mag': {'bramble': 3.0}}
    c = db._npc_combatant(npc)
    assert 'carapace_grind' in c.perks
    assert 'bramble' in c.riders
    assert c.rider_mag.get('bramble') == 3.0


def test_npc_combatant_defaults_empty_for_plain_monsters():
    from undercity import undercity_db as db
    c = db._npc_combatant({'name': 'Grub', 'hp': 20, 'atk': 5, 'def': 2, 'spd': 3})
    assert c.perks == frozenset()
    assert c.riders == frozenset()
```

- [ ] **Step 2: Run it to verify it fails**

Run: `cd infrastructure/lambda && python -m pytest tests/test_undercity_db.py -k npc_combatant -v`
Expected: FAIL — perks/riders are empty on the first test (constructor ignores them).

- [ ] **Step 3: Implement**

Replace `_npc_combatant` (line 641):

```python
def _npc_combatant(npc):
    return engine.Combatant(
        name=npc['name'], hp=npc['hp'], max_hp=npc.get('maxHp', npc['hp']),
        atk=npc['atk'], dfn=npc['def'], spd=npc['spd'],
        passives=frozenset(npc.get('passives') or []),
        perks=frozenset(npc.get('perks') or []),
        riders=frozenset(npc.get('riders') or []),
        rider_mag={k: float(v) for k, v in (npc.get('rider_mag') or {}).items()})
```

- [ ] **Step 4: Run it to verify it passes**

Run: `cd infrastructure/lambda && python -m pytest tests/test_undercity_db.py -k npc_combatant -v`
Expected: PASS (2 tests). Then run the full suite to confirm no monster regressions:
Run: `cd infrastructure/lambda && python -m pytest tests -q`
Expected: all green.

- [ ] **Step 5: Commit**

```bash
git add infrastructure/lambda/undercity_db.py infrastructure/lambda/tests/test_undercity_db.py
git commit -m "feat(undercity): let cloned NPCs carry perks/riders/rider_mag"
```

---

## Task 4: Build the clone + start an interactive PvP battle

Rewrite `_battle` (line 4103) so it snapshots a full-HP clone and calls `_start_battle(kind='pvp')`, returning a `battle_start` spaceEvent — instead of one-shot resolving. Stash the target's id + starting spores in `ctx` for the finisher.

**Files:**
- Modify: `infrastructure/lambda/undercity_db.py` (`_battle`, lines 4103–4192)
- Test: `infrastructure/lambda/tests/test_undercity_db.py`

- [ ] **Step 1: Write the failing test**

Use the suite's existing helpers for seeding two players on the same node (mirror an existing PvP test's setup; find it with `grep -n "targetUserId" tests/test_undercity_db.py`).

```python
def test_pvp_starts_interactive_clone_battle():
    table, sid = _fresh_session()                     # use the suite's fixture
    atk = _seed_player(table, sid, 'A', node='n1')
    tgt = _seed_player(table, sid, 'B', node='n1', spores=100, hp=15, maxHp=40)
    status, resp = db.dispatch(table, sid, atk['userId'],
                               'battle', {'targetUserId': tgt['userId']})
    assert status == 200
    ev = resp['spaceEvent']
    assert ev['type'] == 'battle_start'
    assert ev['kind'] == 'pvp'
    # Clone fights at the target's FULL hp, not their current 15.
    assert ev['npc']['hp'] == 40
    # The attacker is now mid-battle (interactive), not resolved in one shot.
    assert resp['you']['battle']['kind'] == 'pvp'
    # The target was NOT touched.
    fresh_tgt = db._get_player(table, sid, tgt['userId'])
    assert fresh_tgt['hp'] == 15
    assert fresh_tgt['spores'] == 100
    assert not fresh_tgt.get('battle')
```

(Adapt `_fresh_session` / `_seed_player` names to the suite's actual fixtures.)

- [ ] **Step 2: Run it to verify it fails**

Run: `cd infrastructure/lambda && python -m pytest tests/test_undercity_db.py -k pvp_starts_interactive -v`
Expected: FAIL — old `_battle` returns a resolved `battle` dict, no `spaceEvent`/`battle_start`.

- [ ] **Step 3: Implement**

Replace the body of `_battle` (lines 4103–4192) with the duel-start version. Keep the existing precondition checks; swap the resolution for a `_start_battle`:

```python
def _battle(table, sid, doc, payload):
    target_id = payload.get('targetUserId')
    if not target_id or target_id == doc['userId']:
        return _err('Pick a target.')
    if doc.get('battle'):
        return _err('You are already in a fight.', 409)
    target = _get_player(table, sid, target_id)
    if not target:
        return _err('Target not found.', 404)
    if target.get('position') != doc.get('position'):
        return _err('They slipped away — not on your space anymore.', 409)
    if _shielded(target):
        return _err('They are protected by a Compost Shield.', 409)
    doc['shieldUntil'] = None  # attacking drops your own shield

    npc = _build_clone(target)
    ctx = {'targetId': target_id, 'targetSporesAtStart': int(target.get('spores', 0)),
           'targetLevel': int(target.get('level', 1))}
    event = _start_battle(table, sid, doc, 'pvp', npc, node=doc['position'], ctx=ctx)
    conflict = _save_or_conflict(table, doc)
    if conflict:
        return conflict
    return _ok(doc, spaceEvent=event)
```

Add `_build_clone` just above `_battle`:

```python
def _build_clone(target):
    """A full-HP snapshot NPC that copies the target's gear-inclusive stats,
    passives, perks, and riders. Transient buffs are stripped so the clone is a
    fair, representative fighter; personality is themed from the stat spread."""
    eff = engine.effective_stats({**target, 'buffs': []})  # base+gear, no temp buffs
    personality = engine.clone_personality(eff['atk'], eff['def'], eff['spd'])
    level = int(target.get('level', 1))
    return {
        'name': f"{target.get('username', '?')}'s {_creature_label(target)}",
        'id': f"pvp:{target['userId']}",
        'hp': int(eff['maxHp']), 'maxHp': int(eff['maxHp']),
        'atk': int(eff['atk']), 'def': int(eff['def']), 'spd': int(eff['spd']),
        'passives': sorted(_passives(target)),
        'perks': sorted(engine.attribute_perks(target)),
        'riders': sorted(_riders(target)),
        'rider_mag': dict(_rider_mags(target)),
        'personality': personality,
        'bluff': data.clone_bluff(level),
        # Sprite descriptor so the client can draw the target's creature.
        'form': target.get('form'), 'paint': target.get('paint') or {},
        'hat': target.get('hat'), 'spriteVariant': target.get('spriteVariant'),
    }
```

Add the bluff curve to `undercity_data.py` (near `STANCE_PERSONALITIES`):

```python
# PvP clones bluff more at higher level (a stronger read/mind-game), mirroring
# how elites/bosses bluff harder than fodder. Capped so it never feels random.
CLONE_BLUFF_BY_LEVEL = 0.02
CLONE_BLUFF_CAP = 0.30


def clone_bluff(level: int) -> float:
    return min(CLONE_BLUFF_CAP, max(0.0, CLONE_BLUFF_BY_LEVEL * level))
```

Note: `_start_battle` already reads `npc['personality']`, `npc['bluff']`, `npc['name']`, `npc['id']`, `npc['hp']`, `npc['maxHp']`, and stores the full dict as `npcMeta` — so the sprite descriptor and reward context survive into the finisher and reloads.

- [ ] **Step 4: Run it to verify it passes**

Run: `cd infrastructure/lambda && python -m pytest tests/test_undercity_db.py -k pvp_starts_interactive -v`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add infrastructure/lambda/undercity_db.py infrastructure/lambda/undercity_data.py infrastructure/lambda/tests/test_undercity_db.py
git commit -m "feat(undercity): PvP spawns an interactive full-HP clone duel"
```

---

## Task 5: `_finish_pvp` finisher + dispatch

When the duel ends, resolve rewards: attacker win → steal spores from the *live* target, symmetric XP, level-gated renown, corrected away-event; attacker loss → compost attacker, XP, `defended` away-event; flee/timeout → no transfer, matching away-event. The target is re-loaded fresh and saved.

**Files:**
- Modify: `infrastructure/lambda/undercity_db.py` (`_finish_battle` dispatch, lines 3497–3506; add `_finish_pvp`)
- Test: `infrastructure/lambda/tests/test_undercity_db.py`

- [ ] **Step 1: Write the failing tests**

Drive a full duel to a decisive end. The suite has helpers to push `combat-round` until a fight resolves — mirror an existing interactive-battle test (`grep -n "combat-round" tests/test_undercity_db.py`). Force determinism by stubbing `db._rng` or by stacking stats so the attacker wins/loses reliably.

```python
def test_pvp_win_steals_spores_and_grants_renown_when_target_higher_level():
    table, sid = _fresh_session()
    atk = _seed_player(table, sid, 'A', node='n1', level=3, atk=40, spores=0)
    tgt = _seed_player(table, sid, 'B', node='n1', level=5, atk=1, def=1, spd=1,
                       spores=100, maxHp=5)
    _drive_pvp_to_attacker_win(table, sid, atk['userId'], tgt['userId'])
    a = db._get_player(table, sid, atk['userId'])
    b = db._get_player(table, sid, tgt['userId'])
    assert a['spores'] > 0 and b['spores'] < 100          # stole spores
    assert a['pvpWins'] == 1
    assert a['pvpRenownWins'] == 1                        # target level >= attacker
    assert b['hp'] == b['maxHp'] or b['hp'] > 0           # target HP untouched (never dropped by duel)
    # Target learns they were beaten on return.
    ev = b['awayEvents'][-1]
    assert ev['kind'] == 'pvp' and ev['outcome'] == 'beaten' and ev['spores'] > 0


def test_pvp_win_against_lower_level_grants_no_renown():
    table, sid = _fresh_session()
    atk = _seed_player(table, sid, 'A', node='n1', level=8, atk=40, spores=0)
    tgt = _seed_player(table, sid, 'B', node='n1', level=2, atk=1, def=1, spd=1,
                       spores=100, maxHp=5)
    _drive_pvp_to_attacker_win(table, sid, atk['userId'], tgt['userId'])
    a = db._get_player(table, sid, atk['userId'])
    assert a['pvpWins'] == 1
    assert a.get('pvpRenownWins', 0) == 0                 # gank -> no renown


def test_pvp_loss_composts_attacker_and_leaves_target_intact():
    table, sid = _fresh_session()
    atk = _seed_player(table, sid, 'A', node='n1', level=3, atk=1, def=1, spd=1,
                       hp=3, maxHp=3, spores=50)
    tgt = _seed_player(table, sid, 'B', node='n1', level=3, atk=40,
                       spores=100, maxHp=200)
    _drive_pvp_to_attacker_loss(table, sid, atk['userId'], tgt['userId'])
    a = db._get_player(table, sid, atk['userId'])
    b = db._get_player(table, sid, tgt['userId'])
    assert a['spores'] == 50                              # NO spore transfer on loss
    assert b['spores'] == 100 and b['hp'] == b['maxHp']   # target fully intact
    assert b['awayEvents'][-1]['outcome'] == 'defended'
    # Attacker was composted (respawned at the gate); position moved to a start node.
    assert a.get('deaths', 0) == 1
```

(Write the `_drive_pvp_to_*` helpers alongside the tests — they loop `dispatch(..., 'combat-round', {'stance': 'aggress'})` until the response carries a finished `spaceEvent` of type `pvp`. Seed stats so the outcome is forced; if RNG still flips it, monkeypatch `db._rng` to a seeded `random.Random`.)

- [ ] **Step 2: Run to verify they fail**

Run: `cd infrastructure/lambda && python -m pytest tests/test_undercity_db.py -k pvp_win or pvp_loss -v`
Expected: FAIL — `_finish_battle` routes `kind='pvp'` into the `else` boss finisher (KeyError / wrong rewards).

- [ ] **Step 3: Implement the dispatch branch**

In `_finish_battle`, add a `pvp` branch before the `else` (after the `world` branch at line 3503):

```python
    elif kind == 'world':
        out = _finish_world(table, sid, doc, rec, result)
    elif kind == 'pvp':
        out = _finish_pvp(table, sid, doc, rec, result)
    else:
        out = _finish_boss(table, sid, doc, rec, result)
```

- [ ] **Step 4: Implement `_finish_pvp`**

Add near `_finish_wild` (~line 3529):

```python
def _finish_pvp(table, sid, doc, rec, result):
    """Resolve a clone duel. Attacker win: steal spores from the LIVE target,
    symmetric XP, level-gated renown, 'beaten' away-event. Attacker loss:
    compost the attacker, XP, 'defended' away-event. Flee/timeout: no transfer.
    The target's HP/creature are never touched by the duel."""
    ctx = rec.get('ctx') or {}
    target_id = ctx.get('targetId')
    target = _get_player(table, sid, target_id) if target_id else None
    tname = rec['npcMeta'].get('name', 'their creature')
    out = {'type': 'pvp',
           'npc': {'name': tname, 'id': rec['npcMeta'].get('id')},
           'battle': result}
    outcome = result['outcome']
    away = {'kind': 'pvp', 'from': doc.get('username', '?'), 'at': _now()}

    if outcome == 'attacker':
        # Attacker beat the clone. Steal from the target's LIVE pile.
        stolen = 0
        if target:
            stolen = engine.pvp_spore_steal(target.get('spores', 0), 'fight',
                                            _passives(doc))
            target['spores'] = max(0, target.get('spores', 0) - stolen)
        doc['spores'] = doc.get('spores', 0) + stolen
        doc['pvpWins'] = doc.get('pvpWins', 0) + 1
        # Level gate: renown only for beating an equal-or-higher-level foe.
        if int(ctx.get('targetLevel', 1)) >= int(doc.get('level', 1)):
            doc['pvpRenownWins'] = doc.get('pvpRenownWins',
                                           doc.get('pvpWins', 1) - 1) + 1
        win_levels = _grant_xp(table, sid, doc, data.XP_REWARDS['pvp_win'])
        out['spores'] = stolen
        out['xp'] = data.XP_REWARDS['pvp_win']
        if win_levels:
            out['levels'] = win_levels
        out['text'] = f"You beat {tname} and loot {stolen} Spores!"
        away['outcome'] = 'beaten'
        away['spores'] = stolen
        if target:
            _grant_xp(table, sid, target, data.XP_REWARDS['pvp_loss'])

    elif outcome == 'defender':
        # Attacker lost — composted. No spore transfer. Target defends untouched.
        _grant_xp(table, sid, doc, data.XP_REWARDS['pvp_loss'])
        _compost(table, sid, doc,
                 f"{doc['username']}'s {_creature_label(doc)} was driven off by "
                 f"{tname}. The swarm remembers.")
        out['text'] = f"{tname} drives you off and grinds you into the mulch…"
        away['outcome'] = 'defended'
        if target:
            _grant_xp(table, sid, target, data.XP_REWARDS['pvp_win'])

    elif outcome == 'fled':
        out['text'] = 'You slip away into the fungus.'
        away['outcome'] = 'fled'
    else:  # timeout
        _grant_xp(table, sid, doc, data.XP_REWARDS['timeout'])
        out['text'] = f"You and {tname} scrap to a standstill."
        away['outcome'] = 'timeout'
        if target:
            _grant_xp(table, sid, target, data.XP_REWARDS['timeout'])

    if target:
        _push_away_event(target, away)
        _put_player(table, target)   # persist steal / XP / notification
    return out
```

Notes:
- `pvpRenownWins` uses the same legacy-fallback shape as `compute_renown` so a first gated win on a pre-split player grandfathers correctly (`get(..., pvpWins-before-increment)`; since `pvpWins` was already incremented above, subtract 1 for the pre-state).
- `_finish_battle` still applies the attacker's final HP and the Last-Stand perk before dispatch, and saves `doc` afterward — `_finish_pvp` only owns the *target* write.
- `_compost` handles Undying/respawn exactly as PvE death does.

- [ ] **Step 5: Run to verify they pass**

Run: `cd infrastructure/lambda && python -m pytest tests/test_undercity_db.py -k "pvp_win or pvp_loss" -v`
Expected: PASS (3 tests). Then full suite:
Run: `cd infrastructure/lambda && python -m pytest tests -q`
Expected: all green.

- [ ] **Step 6: Commit**

```bash
git add infrastructure/lambda/undercity_db.py infrastructure/lambda/tests/test_undercity_db.py
git commit -m "feat(undercity): _finish_pvp — clone-duel rewards, gated renown, attacker-only stakes"
```

---

## Task 6: Away-event model + copy (client types)

Add the new `beaten` pvp outcome and the pvp npc sprite descriptor to the client types.

**Files:**
- Modify: `src/app/undercity/services/undercity-models.ts` (`AwayEvent`, line 66; `SpaceEvent` npc shape)

- [ ] **Step 1: Extend the `AwayEvent` pvp variant**

Change the pvp union member (line 68–74):

```ts
  | {
      kind: 'pvp';
      outcome: 'composted' | 'beaten' | 'defended' | 'fled' | 'timeout';
      from: string;
      spores?: number;
      at: string;
    }
```

(`composted` stays for back-compat with any queued legacy events; new duels emit `beaten`.)

- [ ] **Step 2: Add sprite fields to the SpaceEvent npc shape**

Find the `npc?: { ... }` shape on `SpaceEvent` (search `personality?:` in the file — the interactive-battle npc payload). Add optional pvp sprite fields:

```ts
    form?: string;
    paint?: Record<string, number>;
    hat?: string | null;
    spriteVariant?: string | null;
```

- [ ] **Step 3: Verify it compiles**

Run: `npm run build:prod`
Expected: build succeeds (type-only change).

- [ ] **Step 4: Commit**

```bash
git add src/app/undercity/services/undercity-models.ts
git commit -m "feat(undercity): client types for pvp 'beaten' away-event + clone sprite fields"
```

---

## Task 7: Route `attack()` through the interactive battle + draw the clone sprite

Make the PvP button open the same live combat modal PvE uses, and draw the target's creature as the foe.

**Files:**
- Modify: `src/app/undercity/tabs/board-tab.component.ts` (`attack()`, lines 2012–2040; `openLiveBattle`, line 2434)

- [ ] **Step 1: Rewrite `attack()`**

Mirror `engageWorldEvent` (line 1999) — the server now returns a `battle_start` spaceEvent that `routeSpaceEvent` already knows how to open:

```ts
  async attack(target: Occupant): Promise<void> {
    const preHp = this.store.you()?.hp ?? 0;
    await this.run(async () => {
      const resp = await this.store.action('battle', { targetUserId: target.userId });
      if (resp.spaceEvent) this.routeSpaceEvent(resp.spaceEvent, preHp);
      this.occupants.set([]);
    });
  }
```

- [ ] **Step 2: Draw the clone sprite in `openLiveBattle`**

In `openLiveBattle` (line 2449), the defender sprite currently always calls `npcSpriteUrl(ev.kind!, ev.npc!.id)`. For pvp, build the creature sprite from the descriptor the server sent:

```ts
      defender: {
        name: ev.npc!.name,
        spriteUrl:
          ev.kind === 'pvp' && ev.npc!.form
            ? this.spriteUrl(ev.npc!.form, ev.npc!.paint ?? {}, ev.npc!.hat, ev.npc!.spriteVariant)
            : this.npcSpriteUrl(ev.kind!, ev.npc!.id),
        icon: ev.kind === 'pvp' ? 'pets' : (NPC_ICONS[ev.npc!.id] ?? 'bug_report'),
        startHp: ev.npc!.hp,
        maxHp: ev.npc!.maxHp ?? ev.npc!.hp,
        level: ev.npc!.level,
        vestige: this.isVestigeFoe(ev.npc!.name),
      },
```

- [ ] **Step 3: Verify build**

Run: `npm run build:prod`
Expected: build succeeds.

- [ ] **Step 4: Commit**

```bash
git add src/app/undercity/tabs/board-tab.component.ts
git commit -m "feat(undercity): PvP opens the interactive combat modal vs the clone"
```

---

## Task 8: Return-popup copy for the `beaten` outcome

The away-event popup already renders on return (lines ~1226–1278). Add the `beaten` case so a victim clearly sees they lost a duel (creature survived, spores taken).

**Files:**
- Modify: `src/app/undercity/tabs/board-tab.component.ts` (away-event copy ~1226; icon ~1261; emphasis ~1278)

- [ ] **Step 1: Add the `beaten` message**

In the pvp outcome `switch` (near line 1226), add a case:

```ts
          case 'beaten':
            return `${e.from} beat your creature in a duel and looted ${e.spores ?? 0} Spores. (Your creature survived.)`;
```

- [ ] **Step 2: Icon + emphasis**

- Icon (line ~1261): treat `beaten` like an attack — `return e.outcome === 'defended' ? 'military_tech' : 'sports_kabaddi';` already covers it (non-`defended` → `sports_kabaddi`). No change needed unless you want a distinct icon.
- Emphasis (line ~1278): the "important" predicate is `e.kind === 'pvp' && e.outcome === 'composted'`. Update so a duel loss still stands out:

```ts
    return e.kind === 'spell_hit' || (e.kind === 'pvp' && (e.outcome === 'composted' || e.outcome === 'beaten'));
```

- [ ] **Step 3: Verify build**

Run: `npm run build:prod`
Expected: build succeeds.

- [ ] **Step 4: Commit**

```bash
git add src/app/undercity/tabs/board-tab.component.ts
git commit -m "feat(undercity): return popup makes a lost PvP duel clear to the victim"
```

---

## Task 9: Full verification pass

- [ ] **Step 1: Backend suite green**

Run: `cd infrastructure/lambda && python -m pytest tests -q`
Expected: all tests pass (including the map-sync guard).

- [ ] **Step 2: Frontend production build**

Run: `npm run build:prod`
Expected: build succeeds and `flatten-build` completes.

- [ ] **Step 3: Manual smoke (optional, via run-undercity skill)**

Two creatures on one node → attack → interactive duel opens vs the clone with the target's sprite → win steals spores, target HP unchanged → target's next load shows the "beat your creature in a duel" popup. Note: this hits the **live AWS backend**, so a Lambda deploy is required first (the user runs deploys).

- [ ] **Step 4: Note deploy needed**

Backend changes live in the Python Lambda — they take effect only after `cdk deploy`. Leave the tree green and tell the user a deploy is required to exercise the new PvP in the real app.

---

## Self-Review Notes

- **Spec coverage:** interactive duel (T4), full-HP clone (T4), stat-spread personality (T1), attacker-only death (T5 loss branch composts attacker, target untouched), spore steal from live target (T5), symmetric XP (T5), level-gated renown via `pvpRenownWins` (T2/T5), no spore transfer on loss (T5 loss branch), return popup with corrected copy (T6/T8), clone stance-only/no spells (inherent — clone is an NPC, no spell path), client combat modal (T7). All covered.
- **Deviation from spec wording:** the renown level gate compares the two players' **`level`** fields (visible XP level) rather than `enemy_level(stat block)`. Player level is the intuitive, player-facing metric and is already stored; noted here for the reviewer.
- **Deviation (scope add):** the clone carries the target's **perks and riders** (T3), making it a faithful copy — this satisfies the spec's "+ perks" and goes one better on "a copy of the enemy player." Backward-compatible for real monsters.
- **Type consistency:** away outcome `beaten` added to both the server push (T5) and the client union (T6) and copy (T8). `pvpRenownWins` read identically in `compute_renown` (T2) and written in `_finish_pvp` (T5). `_build_clone` npc keys match what `_start_battle`/`_npc_combatant` consume.
