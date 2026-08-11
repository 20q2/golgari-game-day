# Queen's Awakening — Plan 1: Finale Restructure

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Turn Savra from a season-shared HP pool that reforms into a one-shot personal trial, crown the first player to fell her as Queenslayer, and fire a +50% XP world buff for everyone on that first kill.

**Architecture:** The `BOSS` DynamoDB record stops carrying HP and starts carrying season-level finale state (`slayer`, `slayerAt`). `_boss` always spawns a full-HP Queen; `_finish_boss` stops persisting damage. `_award_boss_kill` — the single choke point both the melee and the lethal-spell kill paths already share — claims the crown and sets the world buff. `_grant_xp` is likewise the single choke point for all XP, so the buff multiplier is applied in exactly one place.

**Tech Stack:** Python 3.11 Lambda (`infrastructure/lambda/`), pytest with an in-memory `FakeTable`, Angular 20 client mirrors.

---

## Decision this plan makes that the spec did not cover

`_cast_boss_strike` lets a player chip Savra's pool **from anywhere**, and a spell flagged `lethal` (Sear the Throne, from the Legendary Throneburner Codex) can **kill her at range for the full reward**. A personal trial with no shared pool has nothing to chip, and sniping the Queenslayer crown from across the board contradicts "one fight decides it."

**Resolution taken here:** Savra can no longer be damaged at range. Ranged chipping and the lethal snipe still work on **lair pools**, which remain shared — only the Queen is exempt. Task 2 implements this.

**If the user prefers otherwise**, the alternative is a per-player Savra HP pool that ranged spells soften, which preserves Sear the Throne against her but reintroduces the chip-away attrition the spec set out to remove. That would replace Task 2 only.

---

## File structure

| File | Responsibility in this plan |
|---|---|
| `infrastructure/lambda/undercity_config.py` | New scalars: `QUEENSLAYER_RENOWN`, `AWAKENING_XP_BUFF` |
| `infrastructure/lambda/undercity_db.py` | Finale state helpers, `_boss`, `_finish_boss`, `_award_boss_kill`, `_cast_boss_strike`, `_grant_xp`, state + export payloads |
| `infrastructure/lambda/tests/test_undercity_savra.py` | **New** — all finale tests, so they aren't buried in the 4k-line db test file |
| `src/app/undercity/services/undercity-models.ts` | `finale` block on the state payload; `boss` shape |

---

## Task 1: Savra is a fresh fight every time

Removes the shared pool. `_boss_hp` and `_set_boss_hp` are deleted; nothing persists damage.

**Files:**
- Modify: `infrastructure/lambda/undercity_db.py` (`_boss_hp`, `_set_boss_hp`, `_boss`, `_finish_boss`)
- Test: `infrastructure/lambda/tests/test_undercity_savra.py` (create)

- [ ] **Step 1: Write the failing test**

Create `infrastructure/lambda/tests/test_undercity_savra.py`:

```python
import sys, os
sys.path.insert(0, os.path.join(os.path.dirname(__file__), '..'))

import undercity_db as db
import undercity_data as data
import undercity_config as config
from test_undercity_db import (  # noqa: F401
    table, act, _sid, _finish_started_battle)


def _at_boss(table, sid, user='user-alex'):
    """A player standing on the boss node with the gate already open."""
    doc = db._get_player(table, sid, user)
    doc['position'] = 'boss'
    return doc


def test_every_challenger_faces_a_full_hp_queen(table, monkeypatch):
    """Personal trial: damage never persists between attempts or between
    players. One fight decides it."""
    act(table, 'join', starter='pest')
    act(table, 'boss-awaken', hostKey='swampking')
    sid, _ = db._active_season(table)
    full = data.ROT_SOVEREIGN['hp']

    # First attempt: the player dies, leaving her badly wounded.
    doc = _at_boss(table, sid)
    ev = db._boss(table, sid, doc, 'boss', 'isl_ossuary')
    assert ev['npc']['hp'] == full
    _finish_started_battle(table, monkeypatch, doc, 'defender', defender_hp=12)

    # Second attempt by the SAME player: she is whole again.
    doc = _at_boss(table, sid)
    ev2 = db._boss(table, sid, doc, 'boss', 'isl_ossuary')
    assert ev2['npc']['hp'] == full, 'damage must not carry between attempts'

    # And for a different player.
    act(table, 'join', user='user-bea', name='Bea', starter='kraul')
    doc_b = _at_boss(table, sid, 'user-bea')
    ev3 = db._boss(table, sid, doc_b, 'boss', 'isl_ossuary')
    assert ev3['npc']['hp'] == full, 'damage must not carry between players'
```

- [ ] **Step 2: Run test to verify it fails**

Run: `cd infrastructure/lambda && python -m pytest tests/test_undercity_savra.py -q`
Expected: FAIL — the second attempt sees `hp == 12`, not 560.

- [ ] **Step 3: Delete the pool helpers**

In `undercity_db.py`, delete both functions entirely:

```python
def _boss_hp(table, sid):
    item = _get(table, _season_pk(sid), 'BOSS')
    return int((item or {}).get('hp', data.ROT_SOVEREIGN['hp']))


def _set_boss_hp(table, sid, hp, buffs=None):
    """buffs=None preserves stored curses; pass [] to clear."""
    if buffs is None:
        buffs = (_get(table, _season_pk(sid), 'BOSS') or {}).get('buffs') or []
    item = {'pk': _season_pk(sid), 'sk': 'BOSS', 'hp': int(hp)}
    if buffs:
        item['buffs'] = buffs
    table.put_item(Item=item)
```

- [ ] **Step 4: Spawn her at full HP**

In `_boss`, replace the pool read:

```python
    boss = data.ROT_SOVEREIGN
    hp_before = _boss_hp(table, sid)
    buffs = _boss_buffs(table, sid)
    npc = dict(boss, hp=hp_before, maxHp=boss['hp'])
    _apply_guardian_debuffs(npc, buffs)
    if buffs:
        _set_boss_hp(table, sid, hp_before, [])   # consumed on engagement
    return _start_battle(table, sid, doc, 'boss', npc, node=node,
                         ctx={'hpBefore': hp_before})
```

with:

```python
    # Personal trial (design 2026-08-11): no season-shared pool. Every
    # challenger meets a whole Queen, so one fight decides it.
    boss = data.ROT_SOVEREIGN
    buffs = _boss_buffs(table, sid)
    npc = dict(boss, hp=boss['hp'], maxHp=boss['hp'])
    _apply_guardian_debuffs(npc, buffs)
    if buffs:
        _set_boss_buffs(table, sid, [])           # curses are spent on engagement
    return _start_battle(table, sid, doc, 'boss', npc, node=node,
                         ctx={'hpBefore': boss['hp']})
```

- [ ] **Step 5: Add the buff-only writer that replaces `_set_boss_hp`**

Immediately after `_boss_buffs` in `undercity_db.py`:

```python
def _set_boss_buffs(table, sid, buffs):
    """Persist field-curses laid on the Queen. Her HP is NOT stored — she is a
    personal trial and every challenger meets her whole."""
    rec = dict(_get(table, _season_pk(sid), 'BOSS') or {})
    rec.update({'pk': _season_pk(sid), 'sk': 'BOSS', 'buffs': list(buffs)})
    rec.pop('hp', None)
    table.put_item(Item=rec)
```

- [ ] **Step 6: Stop persisting damage on a loss or timeout**

In `_finish_boss`, replace the two non-win branches:

```python
    elif result['outcome'] == 'defender':
        _set_boss_hp(table, sid, result['defenderHp'])
        _grant_xp(table, sid, doc, data.XP_REWARDS['wild_loss'])
        _compost(table, sid, doc,
                 f"{doc['username']} fell to Savra "
                 f'(she lingers at {result["defenderHp"]} HP — finish her!)')
        out['text'] = (f'The Queen grinds you into the mulch — but your blows told: '
                       f'she lingers at {result["defenderHp"]}/{boss["hp"]} HP.')
    else:
        _set_boss_hp(table, sid, result['defenderHp'])
        _grant_xp(table, sid, doc, data.XP_REWARDS['timeout'])
        out['text'] = (f'You withdraw, bleeding. The Queen seethes at '
                       f'{result["defenderHp"]}/{boss["hp"]} HP.')
        if dealt > 0:
            _event(table, sid, 'boss',
                   f"{doc['username']} wounded Savra, Queen of the Golgari — "
                   f'{result["defenderHp"]}/{boss["hp"]} HP remains!', actor=doc['userId'])
```

with:

```python
    elif result['outcome'] == 'defender':
        _grant_xp(table, sid, doc, data.XP_REWARDS['wild_loss'])
        _compost(table, sid, doc,
                 f"{doc['username']} was broken on the steps of Savra's throne.")
        out['text'] = ('The Queen grinds you into the mulch. Her wounds close as '
                       'you fall — the next challenger meets her whole.')
    else:
        _grant_xp(table, sid, doc, data.XP_REWARDS['timeout'])
        out['text'] = ('You withdraw, bleeding. The rot knits her back together '
                       'behind you — there are no second rounds with the Queen.')
```

- [ ] **Step 7: Fix the one other caller of `_boss_hp`**

`handle_state` still reports the pool. Find it:

Run: `grep -n "_boss_hp" infrastructure/lambda/undercity_db.py`
Expected: one hit in the state payload — `'boss': {'hp': _boss_hp(table, sid), 'maxHp': ...}`

Replace that line with:

```python
        # She is always whole now — a personal trial has no pool to report.
        'boss': {'hp': data.ROT_SOVEREIGN['hp'], 'maxHp': data.ROT_SOVEREIGN['hp']},
```

The client's `boss?: { hp: number; maxHp: number }` shape is unchanged, so no
client edit is needed for this step.

Re-run to confirm no callers remain:
Run: `grep -rn "_boss_hp\|_set_boss_hp" infrastructure/lambda/`
Expected: no hits outside `tests/`.

- [ ] **Step 8: Run the test to verify it passes**

Run: `cd infrastructure/lambda && python -m pytest tests/test_undercity_savra.py -q`
Expected: PASS (1 passed)

- [ ] **Step 9: Run the full suite**

Run: `cd infrastructure/lambda && python -m pytest tests --ignore=tests/test_undercity_discard.py -q`
Expected: failures only where existing tests assert the old pool behaviour. Fix each by deleting the pool assertion — do NOT reintroduce `_set_boss_hp`. Search with:
`grep -rn "_boss_hp\|_set_boss_hp" tests/`

- [ ] **Step 10: Commit**

```bash
git add infrastructure/lambda/undercity_db.py infrastructure/lambda/tests/
git commit -m "feat(undercity): Savra is a personal trial, not a shared pool"
```

---

## Task 2: The Queen cannot be fought at range

**Files:**
- Modify: `infrastructure/lambda/undercity_db.py` (`_cast_boss_strike`)
- Test: `infrastructure/lambda/tests/test_undercity_savra.py`

- [ ] **Step 1: Write the failing test**

Append to `tests/test_undercity_savra.py`:

```python
def test_the_queen_cannot_be_struck_from_afar(table):
    """One fight decides it, so ranged chipping and the lethal snipe are both
    refused for Savra. Lair pools are unaffected — they are still shared."""
    act(table, 'join', starter='pest')
    sid, _ = db._active_season(table)
    doc = db._get_player(table, sid, 'user-alex')

    ordinary = {'name': 'Ember Fleck', 'dmg': 8}
    status, body = db._cast_boss_strike(table, sid, doc, ordinary, 'boss')
    assert status == 409, body
    assert doc.get('bossDamage', 0) == 0

    lethal = {'name': 'Sear the Throne', 'dmg': 9999, 'lethal': True}
    status, body = db._cast_boss_strike(table, sid, doc, lethal, 'boss')
    assert status == 409, body
    assert 'boss' not in (doc.get('poiClaims') or []), 'no sniping the crown'
```

- [ ] **Step 2: Run test to verify it fails**

Run: `cd infrastructure/lambda && python -m pytest tests/test_undercity_savra.py::test_the_queen_cannot_be_struck_from_afar -q`
Expected: FAIL — the call returns 200 and awards the kill.

- [ ] **Step 3: Refuse ranged strikes on the boss target**

In `_cast_boss_strike`, immediately after the docstring, insert:

```python
    if target == 'boss':
        # Personal trial (design 2026-08-11): the Queen is one fight, in person.
        # Lair pools below are still shared and still chippable at range.
        return _err('The rot-wards swallow your magic. Savra must be faced in '
                    'person.', 409)
```

- [ ] **Step 4: Run the test to verify it passes**

Run: `cd infrastructure/lambda && python -m pytest tests/test_undercity_savra.py -q`
Expected: PASS (2 passed)

- [ ] **Step 5: Run the full suite and fix ranged-boss tests**

Run: `cd infrastructure/lambda && python -m pytest tests --ignore=tests/test_undercity_discard.py -q`
Existing tests that snipe the boss must be re-pointed at a lair target or deleted. Find them with:
`grep -rn "_cast_boss_strike\|sear_throne\|lethal" tests/`

- [ ] **Step 6: Commit**

```bash
git add infrastructure/lambda/undercity_db.py infrastructure/lambda/tests/
git commit -m "feat(undercity): Savra must be faced in person"
```

---

## Task 3: The Queenslayer crown

**Files:**
- Modify: `infrastructure/lambda/undercity_config.py`, `infrastructure/lambda/undercity_db.py` (`_award_boss_kill`)
- Test: `infrastructure/lambda/tests/test_undercity_savra.py`

- [ ] **Step 1: Add the scalar**

In `undercity_config.py`, directly below `ENRAGED_KILL_XP`:

```python
# ── The Queen's Awakening (design 2026-08-11) ────────────────────────────────
# Renown to the FIRST player in the season to fell Savra. Sized near 2.5 POI
# claims (RENOWN['per_poi'] is 25) so the crown is the night's single biggest
# prize without eclipsing a whole night of exploration.
QUEENSLAYER_RENOWN = 60
```

- [ ] **Step 2: Write the failing test**

Append to `tests/test_undercity_savra.py`:

```python
def _slay(table, sid, monkeypatch, user='user-alex', name='Alex'):
    doc = db._get_player(table, sid, user)
    doc['position'] = 'boss'
    db._boss(table, sid, doc, 'boss', 'isl_ossuary')
    return _finish_started_battle(table, monkeypatch, doc, 'attacker',
                                  user=user, name=name)


def test_first_kill_takes_the_crown_and_only_the_first(table, monkeypatch):
    """Exactly one Queenslayer per season. Later winners still get the kill."""
    act(table, 'join', starter='pest')
    act(table, 'join', user='user-bea', name='Bea', starter='kraul')
    act(table, 'boss-awaken', hostKey='swampking')
    sid, _ = db._active_season(table)

    first = _slay(table, sid, monkeypatch, 'user-alex', 'Alex')
    assert first['queenslayer'] is True
    assert db._finale(table, sid)['slayer'] == 'user-alex'
    perm = db._get_perm(table, 'user-alex')
    assert perm['renown'] >= config.QUEENSLAYER_RENOWN

    second = _slay(table, sid, monkeypatch, 'user-bea', 'Bea')
    assert second.get('queenslayer') is not True, 'the crown is claimed once'
    assert db._finale(table, sid)['slayer'] == 'user-alex', 'and never reassigned'
    assert second.get('spores'), 'a later kill is still a real reward'
```

- [ ] **Step 3: Run test to verify it fails**

Run: `cd infrastructure/lambda && python -m pytest tests/test_undercity_savra.py::test_first_kill_takes_the_crown_and_only_the_first -q`
Expected: FAIL with `AttributeError: module 'undercity_db' has no attribute '_finale'`

- [ ] **Step 4: Add the finale-state helpers**

In `undercity_db.py`, directly above `_boss_buffs`:

```python
def _finale(table, sid):
    """Season finale state: who took the crown and when. Lives on the BOSS
    record alongside the Queen's field-curses."""
    return dict(_get(table, _season_pk(sid), 'BOSS') or {})


def _claim_crown(table, sid, doc):
    """Record the first Queenslayer of the season. Returns True if THIS player
    took the crown, False if it was already claimed. Idempotent: a concurrent
    second kill reads the stored slayer and loses."""
    rec = _finale(table, sid)
    if rec.get('slayer'):
        return False
    rec.update({'pk': _season_pk(sid), 'sk': 'BOSS',
                'slayer': doc['userId'], 'slayerName': doc.get('username', '?'),
                'slayerAt': _now()})
    table.put_item(Item=rec)
    return True
```

- [ ] **Step 5: Award the crown on the first kill**

In `_award_boss_kill`, replace the opening two lines:

```python
    boss = data.ROT_SOVEREIGN
    _set_boss_hp(table, sid, boss['hp'])
    _claim_first(table, sid, node, 'boss', doc)
```

with:

```python
    boss = data.ROT_SOVEREIGN
    _claim_first(table, sid, node, 'boss', doc)
    # First blood in the season takes the Queenslayer crown — once, ever.
    if _claim_crown(table, sid, doc):
        out['queenslayer'] = True
        perm = _get_perm(table, doc['userId'])
        perm['renown'] = perm.get('renown', 0) + data.QUEENSLAYER_RENOWN
        table.put_item(Item=perm)
        _event(table, sid, 'boss',
               f"{doc['username']} is the QUEENSLAYER — first to fell Savra, "
               'Queen of the Golgari!', actor=doc['userId'])
```

- [ ] **Step 6: Run the test to verify it passes**

Run: `cd infrastructure/lambda && python -m pytest tests/test_undercity_savra.py -q`
Expected: PASS (3 passed)

- [ ] **Step 7: Commit**

```bash
git add infrastructure/lambda/undercity_config.py infrastructure/lambda/undercity_db.py infrastructure/lambda/tests/
git commit -m "feat(undercity): crown the first Queenslayer of the season"
```

---

## Task 4: The world XP buff

**Files:**
- Modify: `infrastructure/lambda/undercity_config.py`, `infrastructure/lambda/undercity_db.py` (`_grant_xp`, `_claim_crown`)
- Test: `infrastructure/lambda/tests/test_undercity_savra.py`

- [ ] **Step 1: Add the scalar**

In `undercity_config.py`, directly below `QUEENSLAYER_RENOWN`:

```python
# Season-wide XP multiplier granted to EVERY player the moment the first
# Queenslayer is crowned, for the rest of the night (Zul'Gurub tradition).
# Deliberately denominated in XP: it is worth a great deal to a level 6 still
# climbing and exactly nothing to a level 12 at cap, so it self-targets the
# players who are behind WITHOUT scaling by how far behind they are — no
# handicap on the leader. See "no rubberbanding" in the design.
AWAKENING_XP_BUFF = 0.50
```

- [ ] **Step 2: Write the failing test**

Append to `tests/test_undercity_savra.py`:

```python
def test_the_crown_fires_a_world_xp_buff_for_everyone(table, monkeypatch):
    """Identical buff for every player, no scaling. It self-targets because a
    capped creature has nothing to spend XP on."""
    act(table, 'join', starter='pest')
    act(table, 'join', user='user-bea', name='Bea', starter='kraul')
    act(table, 'boss-awaken', hostKey='swampking')
    sid, _ = db._active_season(table)

    assert db._xp_multiplier(table, sid) == 1.0
    _slay(table, sid, monkeypatch, 'user-alex', 'Alex')
    assert db._xp_multiplier(table, sid) == 1 + config.AWAKENING_XP_BUFF

    # A bystander who never touched the Queen earns the boosted rate.
    bea = db._get_player(table, sid, 'user-bea')
    before = bea['xp']
    db._grant_xp(table, sid, bea, 100)
    assert bea['xp'] - before == round(100 * (1 + config.AWAKENING_XP_BUFF))


def test_the_buff_is_worthless_at_the_level_cap(table, monkeypatch):
    """The self-targeting property: it must give a capped creature nothing,
    which is what makes it a leg-up rather than a handicap on the leader."""
    act(table, 'join', starter='pest')
    act(table, 'boss-awaken', hostKey='swampking')
    sid, _ = db._active_season(table)
    _slay(table, sid, monkeypatch, 'user-alex', 'Alex')

    doc = db._get_player(table, sid, 'user-alex')
    doc['level'] = data.LEVEL_CAP
    before_level = doc['level']
    db._grant_xp(table, sid, doc, 500)
    assert doc['level'] == before_level, 'a capped creature gains nothing usable'
```

- [ ] **Step 3: Run test to verify it fails**

Run: `cd infrastructure/lambda && python -m pytest tests/test_undercity_savra.py -q -k buff or cap`
Expected: FAIL with `AttributeError: module 'undercity_db' has no attribute '_xp_multiplier'`

- [ ] **Step 4: Read the multiplier from finale state**

In `undercity_db.py`, directly below `_finale`:

```python
def _xp_multiplier(table, sid):
    """Season XP multiplier. 1.0 until the Queen falls; boosted for the rest of
    the night once a Queenslayer is crowned."""
    if _finale(table, sid).get('slayer'):
        return 1 + data.AWAKENING_XP_BUFF
    return 1.0
```

- [ ] **Step 5: Apply it at the single XP choke point**

Replace `_grant_xp` entirely:

```python
def _grant_xp(table, sid, doc, amount):
    # Every XP award in the game funnels through here, so the Awakening's world
    # buff is applied in exactly one place.
    amount = int(round(amount * _xp_multiplier(table, sid)))
    doc['xp'] = doc.get('xp', 0) + amount
    _metric(doc, 'xpGained', amount)
    gained = engine.apply_level_ups(doc)
    if gained:
        _event(table, sid, 'level', f"{doc['username']}'s {_creature_label(doc)} reached level {doc['level']}!",
               actor=doc['userId'])
    return gained
```

- [ ] **Step 6: Announce it when the crown is taken**

In `_award_boss_kill`, inside the `if _claim_crown(...)` block, after the existing `_event` call:

```python
        _event(table, sid, 'boss',
               f'The Queen\'s death-cry echoes through the Undercity — every '
               f'creature feels it. (+{int(data.AWAKENING_XP_BUFF * 100)}% XP '
               'for the rest of the night!)')
        _push_broadcast(table, sid,
                        f'SAVRA HAS FALLEN — +{int(data.AWAKENING_XP_BUFF * 100)}% '
                        'XP for everyone, for the rest of the night!',
                        exclude_user_id=doc['userId'])
```

- [ ] **Step 7: Run the tests to verify they pass**

Run: `cd infrastructure/lambda && python -m pytest tests/test_undercity_savra.py -q`
Expected: PASS (5 passed)

- [ ] **Step 8: Run the full suite**

Run: `cd infrastructure/lambda && python -m pytest tests --ignore=tests/test_undercity_discard.py -q`
Expected: green. Any test asserting an exact XP number after a boss kill needs the multiplier applied — those are correct failures, update the expected value.

- [ ] **Step 9: Commit**

```bash
git add infrastructure/lambda/undercity_config.py infrastructure/lambda/undercity_db.py infrastructure/lambda/tests/
git commit -m "feat(undercity): Queen's fall grants a season-wide XP buff"
```

---

## Task 5: Surface the finale in state and export

**Files:**
- Modify: `infrastructure/lambda/undercity_db.py` (`handle_state` payload, export payload)
- Modify: `src/app/undercity/services/undercity-models.ts`
- Test: `infrastructure/lambda/tests/test_undercity_savra.py`

- [ ] **Step 1: Write the failing test**

Append to `tests/test_undercity_savra.py`:

```python
def test_finale_state_is_visible_and_exported(table, monkeypatch):
    """The client needs to show the buff; the host export must record who took
    the crown, or the next session cannot measure any of this."""
    act(table, 'join', starter='pest')
    act(table, 'boss-awaken', hostKey='swampking')
    sid, _ = db._active_season(table)

    status, state = db.handle_state(table, {'userId': 'user-alex'})
    assert state['finale'] == {'slayer': None, 'slayerName': None, 'xpBonus': 0.0}

    _slay(table, sid, monkeypatch, 'user-alex', 'Alex')
    status, state = db.handle_state(table, {'userId': 'user-alex'})
    assert state['finale']['slayerName'] == 'Alex'
    assert state['finale']['xpBonus'] == config.AWAKENING_XP_BUFF

    _, out = act(table, 'admin', hostKey='swampking', cmd='export')
    assert out['finale']['slayer'] == 'user-alex'
```

- [ ] **Step 2: Run test to verify it fails**

Run: `cd infrastructure/lambda && python -m pytest tests/test_undercity_savra.py::test_finale_state_is_visible_and_exported -q`
Expected: FAIL with `KeyError: 'finale'`

- [ ] **Step 3: Add the public view**

In `undercity_db.py`, directly below `_xp_multiplier`:

```python
def _finale_public(table, sid):
    """Client-facing finale block: who wears the crown and the live XP bonus."""
    rec = _finale(table, sid)
    return {'slayer': rec.get('slayer'), 'slayerName': rec.get('slayerName'),
            'xpBonus': data.AWAKENING_XP_BUFF if rec.get('slayer') else 0.0}
```

- [ ] **Step 4: Add it to both payloads**

In the `handle_state` return dict, directly after the `'boss': {...}` entry:

```python
        'finale': _finale_public(table, sid),
```

In the export return dict (`handle_admin`'s `export` branch), directly after `'boss': _one('BOSS'),`:

```python
        'finale': _one('BOSS'),
```

- [ ] **Step 5: Run the test to verify it passes**

Run: `cd infrastructure/lambda && python -m pytest tests/test_undercity_savra.py -q`
Expected: PASS (6 passed)

- [ ] **Step 6: Mirror the shape on the client**

In `src/app/undercity/services/undercity-models.ts`, beside the other state fields:

```ts
  /** The Queen's Awakening finale. `xpBonus` is the live season-wide XP
   *  multiplier bonus (0 until a Queenslayer is crowned). */
  finale?: {
    slayer: string | null;
    slayerName: string | null;
    xpBonus: number;
  };
```

- [ ] **Step 7: Verify the client builds**

Run: `cd /a/Coding/game-day-site && npm run build`
Expected: `Build at: ...` with no `error TS`.

- [ ] **Step 8: Commit**

```bash
git add infrastructure/lambda/undercity_db.py infrastructure/lambda/tests/ src/app/undercity/services/undercity-models.ts
git commit -m "feat(undercity): expose finale state to client and export"
```

---

## Task 6: Update the stale docs

**Files:**
- Modify: `infrastructure/lambda/undercity_data.py` (the "Savra, 400 HP" comment), `CLAUDE.md`

- [ ] **Step 1: Fix the wrong HP figure**

`undercity_data.py` carries a comment claiming Savra is 400 HP; her stat block says 560. Find it:

Run: `grep -n "400 HP" infrastructure/lambda/undercity_data.py`

Replace `Savra, 400 HP` with `Savra, 560 HP`, and replace the words `huge SHARED persistent pool` with `single-fight personal trial`.

- [ ] **Step 2: Update the project brief**

In `CLAUDE.md`, the Undercity section says the boss finale is "Savra's persistent HP pool plus the host-only 'Awaken the Queen' trigger". Replace that clause with:

```markdown
the boss finale is a **personal trial** — every challenger meets a fresh 560 HP
Savra, the first to fell her is crowned Queenslayer, and that kill grants every
player a season-wide XP buff (`specs/2026-08-11-undercity-queens-awakening-design.md`)
```

- [ ] **Step 3: Verify nothing else claims a shared pool**

Run: `grep -rn "persistent pool\|reforms\|shared pool" infrastructure/lambda/*.py CLAUDE.md src/app/undercity --include=*.ts`
Expected: remaining hits refer to **lair** pools or barrier guardians, which are still shared. Fix any that describe the Queen.

- [ ] **Step 4: Commit**

```bash
git add infrastructure/lambda/undercity_data.py CLAUDE.md
git commit -m "docs(undercity): correct Savra's HP and the finale description"
```

---

## Out of scope for this plan

Deliberately deferred to Plans 2 and 3 (see the design doc):

- The Awakening release trigger on the first third sigil, and globally opening gates — **Plan 2**
- The Scouring Swarm as a board entity — **Plan 2**
- Royal Jelly and the bazaar back room — **Plan 3**

Savra's gate in this plan therefore stays as it is today: three sigils per player, or the host `boss-awaken` override.
