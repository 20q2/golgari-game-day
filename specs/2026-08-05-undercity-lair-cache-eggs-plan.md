# Monster Nest & Cache Egg Drops — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Make the two Ruin lairs ("Monster Nests" — Lord of Extinction, Doomgape) the game's dedicated companion-egg farm, give treasure caches a chance egg, and surface every dropped egg in the UI.

**Architecture:** All egg logic is server-authoritative in the Python Lambda: two new `EGG_DROP` sources drive a guaranteed T3 egg on a Nest guardian kill and a guaranteed lesser egg on every Nest scavenge, and the dormant `cache` source is wired in. The Angular client only *displays* eggs — a new `SpaceEvent.egg` renders in the space-event modal (scavenge/cache) and a new `BattleRewards.eggTier` renders in the two battle-victory panels (guardian kill). Copy for the two Ruin nodes is re-themed to "Monster Nest".

**Tech Stack:** Python 3.11 Lambda + pytest (in-memory FakeTable suite); Angular 20 standalone components (SCSS, Material icons). No new deps.

**Design spec:** [specs/2026-08-05-undercity-lair-cache-eggs-design.md](2026-08-05-undercity-lair-cache-eggs-design.md)

**Reference:**
- Egg plumbing: `_maybe_drop_egg(doc, source)` rolls `data.EGG_DROP[source]` = `(chance, {tier: weight})` and calls `_grant_egg(doc, tier)` (appends to `doc['eggs']`). Chance `1.0` = guaranteed (`rng.random() < 1.0` is always true).
- Run backend tests: `cd infrastructure/lambda && python -m pytest tests -q`
- Build client: `npm run build` (from repo root).
- ⚠️ ~50 tests in `test_map.py` / `test_deep_dungeons.py` / `test_undercity_spells.py` already FAIL at clean HEAD (commit 43414e2), unrelated to this work. Judge success by the *new* tests passing and no *new* regressions, not a fully green suite.
- Deploy is run by the host (`cdk deploy`), never by the worker. Finish with tests green and note a deploy is needed.

---

## Task 1: EGG_DROP table — add Nest sources, drop the dead `lair` entry

**Files:**
- Modify: `infrastructure/lambda/undercity_data.py` (the `EGG_DROP` dict, ~line 1845)
- Test: `infrastructure/lambda/tests/test_undercity_nest_eggs.py` (new)

- [ ] **Step 1: Write the failing test**

Create `infrastructure/lambda/tests/test_undercity_nest_eggs.py`:

```python
import undercity_data as data
import undercity_db as db

from tests.test_undercity_db import (  # noqa: F401
    table, act, _sid, _player_at, _finish_started_battle)


def test_egg_drop_table_has_nest_sources_and_no_dead_lair():
    assert data.EGG_DROP['ruin_lair'] == (1.0, {3: 1.0})
    assert data.EGG_DROP['ruin_scavenge'] == (1.0, {1: 0.7, 2: 0.3})
    assert data.EGG_DROP['cache'] == (0.10, {1: 0.4, 2: 0.4, 3: 0.2})
    assert 'lair' not in data.EGG_DROP          # dead entry removed
```

- [ ] **Step 2: Run test to verify it fails**

Run: `cd infrastructure/lambda && python -m pytest tests/test_undercity_nest_eggs.py -q`
Expected: FAIL — `KeyError: 'ruin_lair'` (source not defined yet).

- [ ] **Step 3: Edit the `EGG_DROP` dict**

In `infrastructure/lambda/undercity_data.py`, replace the whole `EGG_DROP` block:

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

with:

```python
# Egg drops mirror GEAR_DROP: source -> (chance, {egg_tier: weight}).
# Monster Nests (the two RESPAWN_LAIRS) are the signature companion farm:
# `ruin_lair` (guaranteed T3 on the guardian kill) and `ruin_scavenge`
# (guaranteed lesser egg on EVERY scavenge of a downed nest). Caches trickle
# eggs like other loot. loot/mystery/combat are unchanged; the old unused
# 'lair' entry was removed (Sigil lairs stay eggless).
EGG_DROP = {
    'loot':          (0.06, {1: 0.7, 2: 0.3}),
    'mystery':       (0.08, {1: 0.5, 2: 0.4, 3: 0.1}),
    'combat':        (0.05, {1: 0.6, 2: 0.4}),
    'cache':         (0.10, {1: 0.4, 2: 0.4, 3: 0.2}),
    'ruin_lair':     (1.0,  {3: 1.0}),
    'ruin_scavenge': (1.0,  {1: 0.7, 2: 0.3}),
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `cd infrastructure/lambda && python -m pytest tests/test_undercity_nest_eggs.py -q`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add infrastructure/lambda/undercity_data.py infrastructure/lambda/tests/test_undercity_nest_eggs.py
git commit -m "feat(undercity): add Monster Nest egg-drop sources, drop dead lair entry"
```

---

## Task 2: Nest guardian kill → guaranteed T3 egg

The Ruin-lair win path is `_lair` → `_respawn_lair` → `_start_battle('lair', ctx={'respawn': True})` → on finish `_finish_lair` sees `ctx['respawn']` → `_finish_respawn_lair` → `_award_respawn_lair_kill` (attacker win). We add the egg there.

**Files:**
- Modify: `infrastructure/lambda/undercity_db.py` — `_award_respawn_lair_kill` (~lines 5139-5148)
- Test: `infrastructure/lambda/tests/test_undercity_nest_eggs.py`

- [ ] **Step 1: Write the failing test**

Append to `infrastructure/lambda/tests/test_undercity_nest_eggs.py`:

```python
def test_nest_guardian_kill_grants_guaranteed_t3_egg(table, monkeypatch):
    act(table, 'join', starter='pest')
    sid = _sid(table)
    doc = db._get_player(table, sid, 'user-alex')
    doc['position'] = 'lair_titan'                 # a RESPAWN_LAIR (Lord of Extinction)
    db._lair(table, sid, doc, 'lair_titan')        # starts a fresh respawn-lair fight
    # Force a deterministic win + drops (guaranteed egg is tier-independent of rng).
    monkeypatch.setattr(db._rng, 'choice', lambda seq: seq[0])
    monkeypatch.setattr(db._rng, 'choices', lambda seq, weights=None, k=1: [seq[0]])
    se = _finish_started_battle(table, monkeypatch, doc, 'attacker')
    assert se['type'] == 'lair'
    assert se['egg'] == {'tier': 3}
    assert doc['eggs'][-1]['tier'] == 3
```

- [ ] **Step 2: Run test to verify it fails**

Run: `cd infrastructure/lambda && python -m pytest tests/test_undercity_nest_eggs.py::test_nest_guardian_kill_grants_guaranteed_t3_egg -q`
Expected: FAIL — `KeyError: 'egg'` on `se['egg']` (no egg granted yet).

- [ ] **Step 3: Add the egg drop + nest-themed text**

In `infrastructure/lambda/undercity_db.py`, in `_award_respawn_lair_kill`, replace:

```python
    chance, tiers = data.GEAR_DROP['lair']
    if _rng.random() < chance:
        drop = _roll_gear_drop(doc, tiers)
        if drop:
            out['gear'] = drop
    until = (datetime.utcnow() + timedelta(minutes=data.LAIR_RESPAWN_MINUTES)) \
        .isoformat(timespec='seconds')
    ruin[node] = {'respawnAt': until, 'scavenged': False}
    out['text'] = (f"The {b['name']} falls! +{reward['spores']} Spores. Its lair "
                   'falls silent — it will stir again within the hour.')
    _append_scroll(doc, out, 'lair')
```

with:

```python
    chance, tiers = data.GEAR_DROP['lair']
    if _rng.random() < chance:
        drop = _roll_gear_drop(doc, tiers)
        if drop:
            out['gear'] = drop
    egg = _maybe_drop_egg(doc, 'ruin_lair')     # guaranteed prize egg from the clutch
    if egg:
        out['egg'] = {'tier': egg['tier']}
    until = (datetime.utcnow() + timedelta(minutes=data.LAIR_RESPAWN_MINUTES)) \
        .isoformat(timespec='seconds')
    ruin[node] = {'respawnAt': until, 'scavenged': False}
    out['text'] = (f"You break the {b['name']}'s guard and raid the nest! "
                   f"+{reward['spores']} Spores and a prize egg from the clutch. "
                   'The nest falls quiet — the guardian returns within the hour.')
    _append_scroll(doc, out, 'lair')
```

(Note: `GEAR_DROP['lair']` is the gear table and is unrelated to the removed
`EGG_DROP['lair']` — leave it untouched.)

- [ ] **Step 4: Run test to verify it passes**

Run: `cd infrastructure/lambda && python -m pytest tests/test_undercity_nest_eggs.py -q`
Expected: PASS (both tests).

- [ ] **Step 5: Commit**

```bash
git add infrastructure/lambda/undercity_db.py infrastructure/lambda/tests/test_undercity_nest_eggs.py
git commit -m "feat(undercity): Monster Nest guardian kill drops a guaranteed T3 egg"
```

---

## Task 3: Nest scavenge → egg on EVERY visit

Restructure `_lair_scavenge` so the egg clutch pays out on every scavenge —
including the "already picked clean" repeat visit — while Spores and the
consumable stay a one-time grab per abandonment.

**Files:**
- Modify: `infrastructure/lambda/undercity_db.py` — `_lair_scavenge` (~lines 4575-4600)
- Test: `infrastructure/lambda/tests/test_undercity_nest_eggs.py`

- [ ] **Step 1: Write the failing tests**

Append to `infrastructure/lambda/tests/test_undercity_nest_eggs.py`:

```python
def test_nest_scavenge_first_visit_gives_egg_and_spores(monkeypatch):
    # random()=0.99 → above the 18% consumable chance (no item), still < 1.0 so
    # the guaranteed egg drops; randint pinned to the low end of the spore range.
    monkeypatch.setattr(db._rng, 'random', lambda: 0.99)
    monkeypatch.setattr(db._rng, 'randint', lambda a, b: a)
    doc = {'userId': 'u1', 'username': 'U', 'spores': 0, 'eggs': []}
    entry = {'respawnAt': '2999-01-01T00:00:00', 'scavenged': False}
    out = db._lair_scavenge(doc, 'lair_titan', entry)
    assert out['type'] == 'lairAbandoned'
    assert out['egg']['tier'] in (1, 2)
    assert out['spores'] == data.LAIR_SCAVENGE_SPORES[0]
    assert len(doc['eggs']) == 1
    assert entry['scavenged'] is True


def test_nest_scavenge_repeat_still_gives_egg_but_no_spores():
    doc = {'userId': 'u1', 'username': 'U', 'spores': 5, 'eggs': []}
    entry = {'respawnAt': '2999-01-01T00:00:00', 'scavenged': True}
    out = db._lair_scavenge(doc, 'lair_titan', entry)
    assert out['egg']['tier'] in (1, 2)     # clutch still yields an egg
    assert 'spores' not in out              # picked clean — no spore grant
    assert doc['spores'] == 5               # unchanged
    assert len(doc['eggs']) == 1
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `cd infrastructure/lambda && python -m pytest tests/test_undercity_nest_eggs.py -k scavenge -q`
Expected: FAIL — `KeyError: 'egg'` (no egg on scavenge yet; and the repeat path currently returns early with no egg).

- [ ] **Step 3: Rewrite `_lair_scavenge`**

In `infrastructure/lambda/undercity_db.py`, replace the entire `_lair_scavenge` function:

```python
def _lair_scavenge(doc, node, entry):
    """Scrounge an abandoned ruin lair once per abandonment: a few Spores + a
    small item chance. Mutates doc (persisted by the move-action wrapper, like
    the ossuary/vault landing handlers). Repeat visits report it picked clean."""
    b = data.LAIR_BOSSES[node]
    dialogue = data.LAIR_ABANDONED_DIALOGUE.get(node, f"The {b['name']}'s lair lies abandoned.")
    out = {'type': 'lairAbandoned', 'node': node, 'text': dialogue}
    if entry.get('scavenged'):
        out['text'] = dialogue + ' You already picked it clean — nothing left to take.'
        return out
    spores = _rng.randint(*data.LAIR_SCAVENGE_SPORES)
    doc['spores'] = doc.get('spores', 0) + spores
    out['spores'] = spores
    if _rng.random() < data.LAIR_SCAVENGE_ITEM_CHANCE:
        item = _scavenge_item(doc)
        if item:
            out['item'] = item
    entry['scavenged'] = True
    doc.setdefault('ruinLairs', {})[node] = entry
    tail = f' You scrounge up {spores} Spores'
    if out.get('item'):
        tail += f" and a {data.CONSUMABLES[out['item']]['name']}."
    else:
        tail += '.'
    out['text'] = dialogue + tail
    return out
```

with:

```python
def _lair_scavenge(doc, node, entry):
    """Scrounge a downed Monster Nest. The egg clutch yields a lesser egg on
    EVERY visit (the pet-farm loop, ungated). The Spores + consumable are a
    one-time grab per abandonment (the `scavenged` flag). Mutates doc (persisted
    by the move-action wrapper, like the ossuary/vault landing handlers)."""
    b = data.LAIR_BOSSES[node]
    dialogue = data.LAIR_ABANDONED_DIALOGUE.get(node, f"The {b['name']}'s nest lies unguarded.")
    out = {'type': 'lairAbandoned', 'node': node, 'text': dialogue}
    # The egg clutch refills for every visitor — ungated by `scavenged`.
    egg = _maybe_drop_egg(doc, 'ruin_scavenge')
    if egg:
        out['egg'] = {'tier': egg['tier']}
    if entry.get('scavenged'):
        out['text'] = dialogue + " You've picked it clean of loot, but lift another egg from the clutch."
        return out
    spores = _rng.randint(*data.LAIR_SCAVENGE_SPORES)
    doc['spores'] = doc.get('spores', 0) + spores
    out['spores'] = spores
    if _rng.random() < data.LAIR_SCAVENGE_ITEM_CHANCE:
        item = _scavenge_item(doc)
        if item:
            out['item'] = item
    entry['scavenged'] = True
    doc.setdefault('ruinLairs', {})[node] = entry
    tail = f' You scrounge up {spores} Spores and an egg from the clutch'
    if out.get('item'):
        tail += f", plus a {data.CONSUMABLES[out['item']]['name']}."
    else:
        tail += '.'
    out['text'] = dialogue + tail
    return out
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `cd infrastructure/lambda && python -m pytest tests/test_undercity_nest_eggs.py -q`
Expected: PASS (all Task 1-3 tests).

- [ ] **Step 5: Commit**

```bash
git add infrastructure/lambda/undercity_db.py infrastructure/lambda/tests/test_undercity_nest_eggs.py
git commit -m "feat(undercity): Monster Nest scavenge drops a lesser egg every visit"
```

---

## Task 4: Wire the cache egg drop

**Files:**
- Modify: `infrastructure/lambda/undercity_db.py` — `_cache` (~lines 5684-5709)
- Test: `infrastructure/lambda/tests/test_undercity_nest_eggs.py`

- [ ] **Step 1: Write the failing tests**

Append to `infrastructure/lambda/tests/test_undercity_nest_eggs.py`:

```python
def test_cache_can_drop_an_egg(table, monkeypatch):
    sid, doc = _player_at(table, 'city_cache', spores=0)
    monkeypatch.setattr(db._rng, 'random', lambda: 0.0)          # under every chance
    monkeypatch.setattr(db._rng, 'choice', lambda seq: seq[0])
    out = db._cache(table, sid, doc, 'city_cache')
    assert out['type'] == 'cache'
    assert out['egg']['tier'] in (1, 2, 3)
    assert doc['eggs']


def test_cache_no_egg_when_roll_misses(table, monkeypatch):
    sid, doc = _player_at(table, 'city_cache', spores=0)
    monkeypatch.setattr(db._rng, 'random', lambda: 0.99)         # above cache egg 0.10
    out = db._cache(table, sid, doc, 'city_cache')
    assert 'egg' not in out
    assert not doc.get('eggs')
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `cd infrastructure/lambda && python -m pytest tests/test_undercity_nest_eggs.py -k cache -q`
Expected: FAIL — `KeyError: 'egg'` on the drop test (cache never grants an egg yet).

- [ ] **Step 3: Wire the egg into `_cache`**

In `infrastructure/lambda/undercity_db.py`, in `_cache`, replace:

```python
    out = {'type': 'cache', 'spores': spores, 'text': text}
    _append_treasure_gear(doc, out, mult)
    _append_scroll(doc, out, 'cache')
    return out
```

with:

```python
    out = {'type': 'cache', 'spores': spores, 'text': text}
    _append_treasure_gear(doc, out, mult)
    egg = _maybe_drop_egg(doc, 'cache')         # eggs trickle from caches like other loot
    if egg:
        out['egg'] = {'tier': egg['tier']}
        out['text'] = out['text'] + ' A companion egg is tucked in the hoard!'
    _append_scroll(doc, out, 'cache')
    return out
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `cd infrastructure/lambda && python -m pytest tests/test_undercity_nest_eggs.py -q`
Expected: PASS (all backend egg tests).

- [ ] **Step 5: Run the full backend suite for regressions**

Run: `cd infrastructure/lambda && python -m pytest tests -q`
Expected: All *new* egg tests pass; the only failures are the ~50 pre-existing `test_map.py` / `test_deep_dungeons.py` / `test_undercity_spells.py` ones (compare the failing set to HEAD — no NEW failures, and none in companions/gear/db). If a companion/gear/db test newly fails, fix before continuing.

- [ ] **Step 6: Commit**

```bash
git add infrastructure/lambda/undercity_db.py infrastructure/lambda/tests/test_undercity_nest_eggs.py
git commit -m "feat(undercity): treasure caches can drop companion eggs"
```

---

## Task 5: Client model — `SpaceEvent.egg` + `BattleRewards.eggTier`

No test runner for the client; these are type additions verified by `npm run build`.

**Files:**
- Modify: `src/app/undercity/services/undercity-models.ts` (the `SpaceEvent` interface)
- Modify: `src/app/undercity/tabs/battle-playback.component.ts` (the `BattleRewards` interface, ~line 44)

- [ ] **Step 1: Add `egg` to `SpaceEvent`**

In `src/app/undercity/services/undercity-models.ts`, find the `SpaceEvent`
interface (it already has a `gear?: { id: string; slot: string; tier: number; outcome: string }` field). Add directly below the `gear?` line:

```typescript
  /** Companion egg dropped by this event (Monster Nest scavenge, cache, loot…). */
  egg?: { tier: number };
```

- [ ] **Step 2: Add `eggTier` to `BattleRewards`**

In `src/app/undercity/tabs/battle-playback.component.ts`, in the `BattleRewards`
interface, add after the `gearIcon?: string;` / `gearStashed?` fields (before the
closing brace):

```typescript
  /** Companion egg tier dropped by a won fight (e.g. a Monster Nest guardian). */
  eggTier?: number;
```

- [ ] **Step 3: Verify the build**

Run: `npm run build`
Expected: build succeeds (no type errors).

- [ ] **Step 4: Commit**

```bash
git add src/app/undercity/services/undercity-models.ts src/app/undercity/tabs/battle-playback.component.ts
git commit -m "feat(undercity): add egg fields to SpaceEvent and BattleRewards"
```

---

## Task 6: Client — show eggs in the space-event modal (scavenge + cache)

**Files:**
- Modify: `src/app/undercity/tabs/board-tab.component.ts` — `eventHasChips` (~lines 1276-1277)
- Modify: `src/app/undercity/tabs/board-tab.component.html` — reward chip row (~line 542)

- [ ] **Step 1: Include eggs in `eventHasChips`**

In `src/app/undercity/tabs/board-tab.component.ts`, find `eventHasChips`:

```typescript
    const spores = ev.spores && ev.spores > 0 && ev.type !== 'loot';
    return !!(spores || ev.sporesLost || ev.hp || ev.item || ev.gear || ev.materials?.moltings);
```

Replace the `return` line with:

```typescript
    return !!(spores || ev.sporesLost || ev.hp || ev.item || ev.gear || ev.egg || ev.materials?.moltings);
```

- [ ] **Step 2: Add the egg chip to the modal**

In `src/app/undercity/tabs/board-tab.component.html`, immediately AFTER the gear
chip block (the `@if (ev.gear && gearInfo(ev.gear.id); as g) { … }` that closes at
`}` on ~line 542) and BEFORE the `@if (ev.materials?.moltings; as m)` block, insert:

```html
            @if (ev.egg) {
              <span class="chip item">
                <mat-icon class="mi">egg</mat-icon>
                Egg
                <span class="rarity-badge {{ tierRarity(ev.egg.tier).key }}">{{ tierRarity(ev.egg.tier).label }}</span>
              </span>
            }
```

(`tierRarity` is already a protected member of the component — used by the gear chip on the line above.)

- [ ] **Step 3: Verify the build**

Run: `npm run build`
Expected: build succeeds.

- [ ] **Step 4: Commit**

```bash
git add src/app/undercity/tabs/board-tab.component.ts src/app/undercity/tabs/board-tab.component.html
git commit -m "feat(undercity): surface dropped eggs in the space-event modal"
```

---

## Task 7: Client — show the guardian-kill egg in the battle-victory panels

The Nest kill is a battle, so its egg rides `BattleRewards`, shown by both
`interactive-battle` (the live fight) and `battle-playback` (replay/spectator).
`buildRewards(ev)` (board-tab) maps the battle `SpaceEvent` into `BattleRewards`.

**Files:**
- Modify: `src/app/undercity/tabs/board-tab.component.ts` — `buildRewards` (~lines 2718-2745)
- Modify: `src/app/undercity/tabs/interactive-battle.component.ts` — `hasRewards` (~line 575)
- Modify: `src/app/undercity/tabs/interactive-battle.component.html` — spoils chips (~line 369)
- Modify: `src/app/undercity/tabs/battle-playback.component.ts` — `hasRewards` (~line 127)
- Modify: `src/app/undercity/tabs/battle-playback.component.html` — spoils chips (~line 143)

- [ ] **Step 1: Map the egg in `buildRewards`**

In `src/app/undercity/tabs/board-tab.component.ts`, update the `buildRewards`
`src` param type — add an `egg` field alongside `gear`:

```typescript
  private buildRewards(src: {
    spores?: number;
    xp?: number;
    renownGained?: number;
    levels?: number;
    item?: string;
    gear?: SpaceEvent['gear'];
    egg?: SpaceEvent['egg'];
  }): BattleRewards {
```

Then, immediately before `return rewards;`, add:

```typescript
    if (src.egg) {
      rewards.eggTier = src.egg.tier;
    }
```

- [ ] **Step 2: Include the egg in `interactive-battle` `hasRewards`**

In `src/app/undercity/tabs/interactive-battle.component.ts`, replace:

```typescript
    return this.outcome() === 'attacker' && !!r && (!!r.spores || !!r.xp || !!r.renown || !!r.levels || !!r.itemName || !!r.gearName);
```

with:

```typescript
    return this.outcome() === 'attacker' && !!r && (!!r.spores || !!r.xp || !!r.renown || !!r.levels || !!r.itemName || !!r.gearName || !!r.eggTier);
```

- [ ] **Step 3: Add the egg chip to `interactive-battle` spoils**

In `src/app/undercity/tabs/interactive-battle.component.html`, after the
`@if (r.gearName) { … }` chip (~line 369) and before the `@if (r.levels)` chip, insert:

```html
          @if (r.eggTier) { <span class="reward-chip item"><mat-icon class="mi">egg</mat-icon> Tier-{{ r.eggTier }} egg</span> }
```

- [ ] **Step 4: Include the egg in `battle-playback` `hasRewards`**

In `src/app/undercity/tabs/battle-playback.component.ts`, replace:

```typescript
      (!!r.spores || !!r.xp || !!r.renown || !!r.levels || !!r.itemName || !!r.gearName)
```

with:

```typescript
      (!!r.spores || !!r.xp || !!r.renown || !!r.levels || !!r.itemName || !!r.gearName || !!r.eggTier)
```

- [ ] **Step 5: Add the egg chip to `battle-playback` spoils**

In `src/app/undercity/tabs/battle-playback.component.html`, after the
`@if (r.gearName) { … }` block (closes ~line 143) and before the `@if (r.levels)`
block, insert:

```html
          @if (r.eggTier) {
            <span class="reward-chip item">
              <mat-icon class="mi">egg</mat-icon> Tier-{{ r.eggTier }} egg
            </span>
          }
```

- [ ] **Step 6: Verify the build**

Run: `npm run build`
Expected: build succeeds.

- [ ] **Step 7: Commit**

```bash
git add src/app/undercity/tabs/board-tab.component.ts src/app/undercity/tabs/interactive-battle.component.ts src/app/undercity/tabs/interactive-battle.component.html src/app/undercity/tabs/battle-playback.component.ts src/app/undercity/tabs/battle-playback.component.html
git commit -m "feat(undercity): show the Monster Nest egg in battle-victory spoils"
```

---

## Task 8: Client — re-theme the two Ruin nodes as "Monster Nests"

Copy-only, scoped to the two Ruin nodes via the existing `RUIN_LAIRS` guard.

**Files:**
- Modify: `src/app/undercity/tabs/board-tab.component.ts` — the `RUIN_LAIRS.has(nodeId)` space-info branch (~lines 2062-2076)

- [ ] **Step 1: Rewrite the Ruin space-info copy**

In `src/app/undercity/tabs/board-tab.component.ts`, replace:

```typescript
    if (RUIN_LAIRS.has(nodeId)) {
      const name = RUIN_LAIR_NAMES[nodeId] ?? 'a ruin beast';
      const ab = ruinLairAbandoned(nodeId, this.store.you()?.ruinLairs);
      if (ab) {
        title = `${name}'s Lair — Abandoned`;
        body = ab.scavenged
          ? `You already picked this lair clean. ${name} will stir again in ~${ab.minsLeft}m.`
          : `${name} lies slain and its lair is abandoned — land here to scrounge what's left. ` +
            `It respawns in ~${ab.minsLeft}m.`;
      } else {
        title = `${name}'s Lair`;
        body =
          `${name} prowls this ruin. Land on it to fight — a fresh challenge each time. ` +
          `Beat it and its lair falls quiet for an hour, leaving scraps to scavenge.`;
      }
    }
```

with:

```typescript
    if (RUIN_LAIRS.has(nodeId)) {
      const name = RUIN_LAIR_NAMES[nodeId] ?? 'a powerful guardian';
      const ab = ruinLairAbandoned(nodeId, this.store.you()?.ruinLairs);
      if (ab) {
        title = 'Monster Nest — Unguarded';
        body = ab.scavenged
          ? `You've picked this nest clean of loot, but the clutch still holds eggs — ` +
            `land here to take another. ${name} returns in ~${ab.minsLeft}m.`
          : `${name} lies slain and the nest is unguarded — land here to raid the egg clutch ` +
            `and scrounge what's left. ${name} returns in ~${ab.minsLeft}m.`;
      } else {
        title = 'Monster Nest';
        body =
          `A clutch of eggs lies within, watched over by ${name}, a powerful guardian. ` +
          `Land here to fight — beat ${name} to seize a prize egg. A fresh challenge each ` +
          `time; win and the nest falls quiet for an hour.`;
      }
    }
```

- [ ] **Step 2: Verify the build**

Run: `npm run build`
Expected: build succeeds.

- [ ] **Step 3: Commit**

```bash
git add src/app/undercity/tabs/board-tab.component.ts
git commit -m "feat(undercity): re-theme the two Ruin lairs as Monster Nests"
```

---

## Task 9: Final verification

- [ ] **Step 1: Backend suite**

Run: `cd infrastructure/lambda && python -m pytest tests -q`
Expected: the six new `test_undercity_nest_eggs.py` tests pass; no NEW failures beyond the known ~50 pre-existing map/dungeon/spell ones.

- [ ] **Step 2: Client build**

Run: `npm run build`
Expected: success.

- [ ] **Step 3: Report**

Summarize: what changed, tests green, and that a `cdk deploy` (run by the host) is required for the server changes to reach players. Note the display-mirror data (`src/app/undercity/data/*.ts`) needs no change — egg odds are server-only.

---

## Self-Review

**Spec coverage:**
- §1 Ruin kill guaranteed T3 egg → Task 2. ✓
- §2 Ruin scavenge egg every visit (ungated; Spores/consumable gated) → Task 3. ✓
- §3 Cache chance egg (wire `cache`) → Task 4. ✓
- §4 `EGG_DROP` add `ruin_lair`/`ruin_scavenge`, keep `cache`, delete `lair` → Task 1. ✓
- §5 Client: `SpaceEvent.egg` (Task 5) + egg chip in space modal (Task 6) + battle-victory surfacing (Task 7). ✓ Covers the spec's "verify combat-finish routes through reward display" — the kill uses `BattleRewards`, handled explicitly in Task 7.
- §6 "Monster Nest" copy → Task 8. ✓
- Loot/mystery/combat unchanged, Sigil lairs eggless → no task touches them; `EGG_DROP['lair']` removal in Task 1 is the only Sigil-adjacent change and only removes dead config. ✓

**Placeholder scan:** No TBD/TODO; every code step shows full before/after. ✓

**Type consistency:** `SpaceEvent.egg` is `{ tier: number }`; `out['egg'] = {'tier': …}` on the server matches. `BattleRewards.eggTier` is `number`; `buildRewards` sets `rewards.eggTier = src.egg.tier`; both victory panels read `r.eggTier`. `_maybe_drop_egg` returns `{'id', 'tier'}` and all call sites read `egg['tier']`. Consistent. ✓

**Note on egg-only persistence (Task 3 repeat path):** the egg mutates `doc['eggs']`; the move-action wrapper persists `doc` on every action (it always stamps `doc['lastActionAt']` and saves), so the repeat-scavenge egg is durably saved even though that path grants no Spores. The direct unit test validates the function's output/mutation; end-to-end persistence follows the existing landing-handler contract.
