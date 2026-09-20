# Golgari Throne — Plan 1: the foe sprite descriptor

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Make every battle screen draw a player-derived foe as that player's actual creature, instead of falling back to the `pets` paw-print icon.

**Architecture:** The server already builds the sprite descriptor (`form` / `paint` / `hat` / `spriteVariant`) into the PvP clone and stores it in `npcMeta` — it just never sends it to the client. Add one `_sprite_descriptor(npc)` helper and splice it into the three client-facing payloads that drop it. On the client, four call sites independently resolve a foe's art and only one knows about descriptors; collapse all four onto one `foeSpriteUrl(npc, evType)` helper. Nothing is special-cased for the Throne — Plan 3 seats a descriptor-carrying NPC and it renders for free.

**Tech Stack:** Python 3.11 Lambda (`infrastructure/lambda/`), pytest with an in-memory `FakeTable`; Angular 20 standalone components (`src/app/undercity/`), no frontend test runner.

**Design doc:** [specs/2026-09-20-undercity-golgari-throne-design.md](2026-09-20-undercity-golgari-throne-design.md) — "Client — the sprite pipeline (shared fix)".

---

## File Structure

| File | Responsibility | Change |
|---|---|---|
| `infrastructure/lambda/undercity_db.py` | one `_sprite_descriptor` helper; splice into `_start_battle`, `_battle_resume`, `_finish_pvp`, `_finish_boss`; correct the false comment on `_build_clone` | Modify |
| `infrastructure/lambda/tests/test_undercity_foe_sprite.py` | all tests for the descriptor's round trip | Create |
| `src/app/undercity/services/undercity-models.ts` | `BattleResume.npc` gains the four descriptor fields | Modify |
| `src/app/undercity/tabs/board-tab.component.ts` | one `foeSpriteUrl` helper; four call sites collapse onto it; `BossIntroView.spriteUrl` widens to nullable | Modify |

The new test file follows the repo's habit of one file per topic, importing the shared fixtures from `test_undercity_db` the way `test_undercity_savra.py` already does.

---

## Task 1: Server — `_sprite_descriptor` and `_start_battle`

**Files:**
- Create: `infrastructure/lambda/tests/test_undercity_foe_sprite.py`
- Modify: `infrastructure/lambda/undercity_db.py` (add helper near `_start_battle` at line 1005; edit the return at lines 1045–1066; edit the comment at lines 6918–6919)

- [ ] **Step 1: Write the failing tests**

Create `infrastructure/lambda/tests/test_undercity_foe_sprite.py`:

```python
"""A player-derived foe must be drawn as that player's own creature.

The server builds the sprite descriptor (form/paint/hat/spriteVariant) into the
PvP clone and stores it in npcMeta, but historically never sent it to the
client, so every duel fell through to the `pets` paw-print icon.

Design: specs/2026-09-20-undercity-golgari-throne-design.md
Plan:   specs/2026-09-20-undercity-golgari-throne-plan-1.md
"""
import sys, os
sys.path.insert(0, os.path.join(os.path.dirname(__file__), '..'))

import undercity_db as db
import undercity_data as data
from test_undercity_db import (  # noqa: F401
    table, act, _sid, _finish_started_battle)


def _duel_pair(table):
    """Two players on the same node, the target wearing a distinctive look."""
    act(table, 'join', starter='kraul', home='cavern')
    act(table, 'join', user='user-sam', name='Sam', starter='saproling',
        home='cavern')
    sid = _sid(table)
    alex = db._get_player(table, sid, 'user-alex')
    sam = db._get_player(table, sid, 'user-sam')
    alex['position'] = sam['position'] = 'city_r2'
    sam['paint'] = {'body': 200, 'belly': 40, 'stripes': 200}
    sam['hat'] = 'top_hat'
    sam['spriteVariant'] = 'saproling_2'
    db._put_player(table, alex)
    db._put_player(table, sam)
    return sid, alex, sam


def test_sprite_descriptor_is_empty_for_an_ordinary_npc():
    """Wild foes have art-folder PNGs, not creature descriptors. Returning {}
    keeps the payload clean rather than shipping four null keys everywhere."""
    assert db._sprite_descriptor(dict(data.ROT_SOVEREIGN)) == {}
    assert db._sprite_descriptor({}) == {}
    assert db._sprite_descriptor(None) == {}


def test_sprite_descriptor_copies_the_four_fields():
    npc = {'form': 'zombie', 'paint': {'body': 10}, 'hat': 'beanie',
           'spriteVariant': 'zombie_2'}
    assert db._sprite_descriptor(npc) == {
        'form': 'zombie', 'paint': {'body': 10}, 'hat': 'beanie',
        'spriteVariant': 'zombie_2'}


def test_sprite_descriptor_defaults_missing_paint_to_empty():
    """paint is indexed directly by the client recolor; None would throw."""
    assert db._sprite_descriptor({'form': 'pest'})['paint'] == {}


def test_battle_start_carries_the_targets_sprite(table):
    sid, _, sam = _duel_pair(table)

    status, resp = act(table, 'battle', targetUserId='user-sam')
    assert status == 200, resp

    npc = resp['spaceEvent']['npc']
    assert npc['form'] == sam['form']
    assert npc['paint'] == {'body': 200, 'belly': 40, 'stripes': 200}
    assert npc['hat'] == 'top_hat'
    assert npc['spriteVariant'] == 'saproling_2'


def test_battle_start_omits_the_descriptor_for_a_wild_foe(table):
    """A wild NPC must not gain empty descriptor keys — the client treats a
    present `form` as 'draw this as a creature'."""
    act(table, 'join', starter='pest')
    sid = _sid(table)
    doc = db._get_player(table, sid, 'user-alex')
    npc = {'id': 'kraul_warrior', 'name': 'Kraul Warrior',
           'hp': 20, 'maxHp': 20, 'atk': 5, 'def': 3, 'spd': 4}
    # node=doc['position'] matches how the rest of the suite calls this — a
    # freshly joined player stands on their home gate, not an arbitrary node.
    ev = db._start_battle(table, sid, doc, 'wild', npc, node=doc['position'])
    assert 'form' not in ev['npc']
```

- [ ] **Step 2: Run the tests to verify they fail**

```bash
cd infrastructure/lambda && python -m pytest tests/test_undercity_foe_sprite.py -q
```

Expected: FAIL — `AttributeError: module 'undercity_db' has no attribute '_sprite_descriptor'` on the first three, and `KeyError: 'form'` on `test_battle_start_carries_the_targets_sprite`. `test_battle_start_omits_the_descriptor_for_a_wild_foe` will already pass; that is correct — it is the regression guard for the next step.

- [ ] **Step 3: Add the helper**

In `infrastructure/lambda/undercity_db.py`, immediately **above** `def _start_battle(` (currently line 1005):

```python
def _sprite_descriptor(npc):
    """The four fields the client needs to draw a foe as a real creature rather
    than an art-folder PNG. PvP clones and the Golgari Throne carry them;
    ordinary NPCs do not, and for those we return {} so their payload never
    grows empty keys — the client treats a present `form` as the signal to
    recolor a creature sprite."""
    if not (npc or {}).get('form'):
        return {}
    return {'form': npc.get('form'),
            'paint': npc.get('paint') or {},
            'hat': npc.get('hat'),
            'spriteVariant': npc.get('spriteVariant')}
```

- [ ] **Step 4: Splice it into the `_start_battle` return**

In the same file, in `_start_battle`'s return statement, change the `'npc'` dict so the descriptor spreads in as its last entry. Find:

```python
    return {'type': 'battle_start', 'kind': kind,
            'npc': {'name': npc['name'], 'id': npc.get('id'),
                    'spriteId': npc.get('spriteId') or npc.get('sprite'),
                    'hp': npc_snap['hp'], 'maxHp': npc_snap['maxHp'],
                    'atk': npc_snap['atk'], 'def': npc_snap['dfn'],
                    'spd': npc_snap['spd'],
                    'level': data.enemy_level(npc_snap['atk'], npc_snap['dfn'],
                                              npc_snap['spd'], npc_snap['maxHp']),
                    'personality': npc_snap['personality'],
                    'tier': npc_tier},
```

Replace with:

```python
    return {'type': 'battle_start', 'kind': kind,
            'npc': {'name': npc['name'], 'id': npc.get('id'),
                    'spriteId': npc.get('spriteId') or npc.get('sprite'),
                    'hp': npc_snap['hp'], 'maxHp': npc_snap['maxHp'],
                    'atk': npc_snap['atk'], 'def': npc_snap['dfn'],
                    'spd': npc_snap['spd'],
                    'level': data.enemy_level(npc_snap['atk'], npc_snap['dfn'],
                                              npc_snap['spd'], npc_snap['maxHp']),
                    'personality': npc_snap['personality'],
                    'tier': npc_tier,
                    **_sprite_descriptor(npc)},
```

- [ ] **Step 5: Correct the false comment on `_build_clone`**

Still in `undercity_db.py`, at the tail of `_build_clone` (currently lines 6918–6919). Find:

```python
        # Sprite descriptor so the client can draw the target's own creature as
        # the foe (survives into the finisher and battle reloads via npcMeta).
```

Replace with:

```python
        # Sprite descriptor so the client can draw the target's own creature as
        # the foe. These reach the client only because _start_battle,
        # _battle_resume and the finishers each splice in _sprite_descriptor();
        # npcMeta alone is server-side storage and sends nothing.
```

The original claim was false — `npcMeta` held the fields but no payload forwarded them, which is exactly what hid this bug. Do not restore it.

- [ ] **Step 6: Run the tests to verify they pass**

```bash
cd infrastructure/lambda && python -m pytest tests/test_undercity_foe_sprite.py -q
```

Expected: 5 passed.

- [ ] **Step 7: Run the full suite for regressions**

```bash
cd infrastructure/lambda && python -m pytest tests -q
```

Expected: all pass. The spread adds keys only when `form` is present, so no existing NPC payload changes shape.

- [ ] **Step 8: Commit**

```bash
git add infrastructure/lambda/undercity_db.py infrastructure/lambda/tests/test_undercity_foe_sprite.py
git commit -m "fix: send the foe sprite descriptor in battle_start

_build_clone stamped form/paint/hat/spriteVariant onto PvP clones and
claimed in a comment that they survived to the client via npcMeta. They
did not — no payload forwarded them, so every duel fell back to the
paw-print icon. Add _sprite_descriptor() and splice it into the
battle_start payload."
```

---

## Task 2: Server — `_battle_resume`

A refreshed or reloaded page rebuilds the fight from `state.battle`. That payload drops the descriptor too, so even once Task 1 lands, reloading mid-duel still shows the paw print.

**Files:**
- Modify: `infrastructure/lambda/undercity_db.py` (the `'npc'` dict in `_battle_resume`, currently lines 5904–5919)
- Test: `infrastructure/lambda/tests/test_undercity_foe_sprite.py`

- [ ] **Step 1: Write the failing test**

Append to `infrastructure/lambda/tests/test_undercity_foe_sprite.py`:

```python
def test_resumed_duel_still_carries_the_sprite(table):
    """Reloading mid-duel rebuilds the fight from state.battle. That payload
    must carry the descriptor too, or a refresh swaps the opponent's creature
    for the paw print."""
    _duel_pair(table)
    act(table, 'battle', targetUserId='user-sam')

    status, state = db.handle_state(table, {'userId': 'user-alex'})
    assert status == 200, state

    npc = state['battle']['npc']
    assert npc['form'] == 'saproling'
    assert npc['paint'] == {'body': 200, 'belly': 40, 'stripes': 200}
    assert npc['hat'] == 'top_hat'
    assert npc['spriteVariant'] == 'saproling_2'
```

- [ ] **Step 2: Run the test to verify it fails**

```bash
cd infrastructure/lambda && python -m pytest tests/test_undercity_foe_sprite.py::test_resumed_duel_still_carries_the_sprite -q
```

Expected: FAIL with `KeyError: 'form'`.

- [ ] **Step 3: Splice the descriptor into `_battle_resume`**

In `infrastructure/lambda/undercity_db.py`, in `_battle_resume`. Find:

```python
        'npc': {
            'id': (rec.get('npcMeta') or {}).get('id'),
            'spriteId': ((rec.get('npcMeta') or {}).get('spriteId')
                         or (rec.get('npcMeta') or {}).get('sprite')),
            'name': npc.get('name'),
            'hp': npc.get('hp'),
            'maxHp': npc.get('maxHp', npc.get('hp')),
            'atk': npc.get('atk'),
            'def': npc.get('dfn'),
            'spd': npc.get('spd'),
            'level': data.enemy_level(npc.get('atk', 0), npc.get('dfn', 0),
                                      npc.get('spd', 0),
                                      npc.get('maxHp', npc.get('hp', 0))),
            'personality': npc.get('personality'),
            'tier': rec.get('npcTier'),
        },
```

Replace with:

```python
        'npc': {
            'id': (rec.get('npcMeta') or {}).get('id'),
            'spriteId': ((rec.get('npcMeta') or {}).get('spriteId')
                         or (rec.get('npcMeta') or {}).get('sprite')),
            'name': npc.get('name'),
            'hp': npc.get('hp'),
            'maxHp': npc.get('maxHp', npc.get('hp')),
            'atk': npc.get('atk'),
            'def': npc.get('dfn'),
            'spd': npc.get('spd'),
            'level': data.enemy_level(npc.get('atk', 0), npc.get('dfn', 0),
                                      npc.get('spd', 0),
                                      npc.get('maxHp', npc.get('hp', 0))),
            'personality': npc.get('personality'),
            'tier': rec.get('npcTier'),
            # The live combatant snapshot carries no cosmetics — the look comes
            # off the stored spec, same source as `id`/`spriteId` above.
            **_sprite_descriptor(rec.get('npcMeta') or {}),
        },
```

Note the descriptor reads `npcMeta`, not the local `npc` variable: `npc` here is `rec['npc']`, the live combatant snapshot, which holds only combat state.

- [ ] **Step 4: Run the test to verify it passes**

```bash
cd infrastructure/lambda && python -m pytest tests/test_undercity_foe_sprite.py -q
```

Expected: 6 passed.

- [ ] **Step 5: Commit**

```bash
git add infrastructure/lambda/undercity_db.py infrastructure/lambda/tests/test_undercity_foe_sprite.py
git commit -m "fix: send the foe sprite descriptor on battle resume

Reloading mid-duel rebuilt the fight from state.battle, which dropped
the descriptor and swapped the opponent's creature for the paw print."
```

---

## Task 3: Server — the finishers

The victory/defeat card is built from the finisher's `out['npc']`, which drops the descriptor as well. `_finish_boss` gets the same treatment now so Plan 3 has nothing left to wire.

**Files:**
- Modify: `infrastructure/lambda/undercity_db.py` (`_finish_pvp` at line 6012, `_finish_boss` at line 6683)
- Test: `infrastructure/lambda/tests/test_undercity_foe_sprite.py`

- [ ] **Step 1: Write the failing test**

Append to `infrastructure/lambda/tests/test_undercity_foe_sprite.py`:

```python
def test_duel_result_card_carries_the_sprite(table, monkeypatch):
    """The victory card is built from the finisher's out['npc']."""
    sid, _, _ = _duel_pair(table)
    act(table, 'battle', targetUserId='user-sam')

    alex = db._get_player(table, sid, 'user-alex')
    ev = _finish_started_battle(table, monkeypatch, alex, outcome='attacker')

    assert ev['type'] == 'pvp'
    assert ev['npc']['form'] == 'saproling'
    assert ev['npc']['hat'] == 'top_hat'
```

- [ ] **Step 2: Run the test to verify it fails**

```bash
cd infrastructure/lambda && python -m pytest tests/test_undercity_foe_sprite.py::test_duel_result_card_carries_the_sprite -q
```

Expected: FAIL with `KeyError: 'form'`.

- [ ] **Step 3: Splice into `_finish_pvp`**

In `infrastructure/lambda/undercity_db.py`, in `_finish_pvp`. Find:

```python
    out = {'type': 'pvp',
           'npc': {'name': tname, 'id': rec['npcMeta'].get('id')},
           'battle': result}
```

Replace with:

```python
    out = {'type': 'pvp',
           'npc': {'name': tname, 'id': rec['npcMeta'].get('id'),
                   **_sprite_descriptor(rec['npcMeta'])},
           'battle': result}
```

- [ ] **Step 4: Splice into `_finish_boss`**

In the same file, in `_finish_boss`. Find:

```python
    out = {'type': 'boss', 'npc': {'name': boss['name'], 'maxHp': boss['hp']},
           'battle': result}
```

Replace with:

```python
    out = {'type': 'boss',
           'npc': {'name': boss['name'], 'maxHp': boss['hp'],
                   **_sprite_descriptor(rec.get('npcMeta') or {})},
           'battle': result}
```

Savra carries no `form`, so this is a no-op today; it is here so a Throne occupant's result card works the moment Plan 3 seats one.

- [ ] **Step 5: Run the tests to verify they pass**

```bash
cd infrastructure/lambda && python -m pytest tests/test_undercity_foe_sprite.py -q
```

Expected: 7 passed.

- [ ] **Step 6: Run the full suite for regressions**

```bash
cd infrastructure/lambda && python -m pytest tests -q
```

Expected: all pass. Pay attention to `tests/test_undercity_savra.py` — it asserts on `_finish_boss` output.

- [ ] **Step 7: Commit**

```bash
git add infrastructure/lambda/undercity_db.py infrastructure/lambda/tests/test_undercity_foe_sprite.py
git commit -m "fix: send the foe sprite descriptor on the result card

_finish_pvp and _finish_boss both dropped it. The boss path is inert
until the Golgari Throne seats a player-derived occupant."
```

---

## Task 4: Client — one `foeSpriteUrl` helper for all four call sites

Four places in `board-tab.component.ts` independently resolve a foe's art, and only the live-battle one knows about descriptors. That duplication is the bug's real shape, so collapse them rather than patching three more copies.

**Files:**
- Modify: `src/app/undercity/services/undercity-models.ts` (`BattleResume.npc`, lines 593–609)
- Modify: `src/app/undercity/tabs/board-tab.component.ts` (`BossIntroView` line 163; new helper near `npcSpriteUrl` line 3296; call sites at lines 2899, 2929, 3470, 3520)

- [ ] **Step 1: Widen the `BattleResume` model**

In `src/app/undercity/services/undercity-models.ts`, in `BattleResume`, find the closing lines of its `npc` block:

```ts
    /** Size tier (1-3) for relative arena sprite scaling (server-stamped). */
    tier?: number;
  };
}
```

Replace with:

```ts
    /** Size tier (1-3) for relative arena sprite scaling (server-stamped). */
    tier?: number;
    /** Sprite descriptor for a player-derived foe (PvP clone, Golgari Throne)
     *  so a reload redraws the real creature instead of the icon fallback. */
    form?: string;
    paint?: Record<string, number>;
    hat?: string | null;
    spriteVariant?: string | null;
  };
}
```

`SpaceEvent.npc` already declares these four (lines 860–863) — the client was always ready; only the server was silent.

- [ ] **Step 2: Widen `BossIntroView.spriteUrl` to nullable**

In `src/app/undercity/tabs/board-tab.component.ts`, find:

```ts
/** Payload for the pre-fight boss dialogue overlay (design 2026-08-04). */
interface BossIntroView {
  name: string;
  spriteUrl: string;
  lines: string[];
  vestige: boolean;
}
```

Replace with:

```ts
/** Payload for the pre-fight boss dialogue overlay (design 2026-08-04). */
interface BossIntroView {
  name: string;
  /** Null when the foe has neither a creature descriptor nor art on disk;
   *  BossIntroComponent already renders an icon in that case. */
  spriteUrl: string | null;
  lines: string[];
  vestige: boolean;
}
```

`BossIntroComponent` already declares `@Input() spriteUrl: string | null = null` and guards with `@if (spriteUrl)`, so this only aligns the view model with the component it feeds.

- [ ] **Step 3: Add the helper**

In `src/app/undercity/tabs/board-tab.component.ts`, immediately **after** the `npcSpriteUrl` method (the one ending `return enemyArtUrl(npcId);`, around line 3306), add:

```ts
  /** A foe's battle art. A player-derived foe — the PvP clone, the Golgari
   *  Throne — ships a sprite descriptor and is recolored from the real
   *  creature; everything else resolves to its art-folder PNG by id. Every
   *  battle surface routes through here: four call sites used to decide this
   *  separately and only one of them knew about descriptors, so duels drew the
   *  paw-print icon everywhere else. */
  private foeSpriteUrl(
    npc: {
      id?: string;
      spriteId?: string;
      form?: string;
      paint?: Record<string, number>;
      hat?: string | null;
      spriteVariant?: string | null;
    },
    evType: string,
  ): string | null {
    if (npc.form) return this.spriteUrl(npc.form, npc.paint ?? {}, npc.hat, npc.spriteVariant);
    return this.npcSpriteUrl(evType, npc.spriteId ?? npc.id ?? '');
  }
```

- [ ] **Step 4: Collapse call site 1 — the boss intro card (line ~2899)**

Find:

```ts
            name: ev.npc.name,
            // Mirror the battle opener's sprite resolution (spriteId ?? id).
            spriteUrl: this.npcSpriteUrl(ev.kind ?? ev.type, ev.npc.spriteId ?? ev.npc.id),
            lines,
```

Replace with:

```ts
            name: ev.npc.name,
            spriteUrl: this.foeSpriteUrl(ev.npc, ev.kind ?? ev.type),
            lines,
```

- [ ] **Step 5: Collapse call site 2 — the non-interactive result view (line ~2929)**

Find:

```ts
          name: ev.npc.name,
          // Art folder per foe class; a missing file falls back to the icon
          // via the battle card's onerror handling.
          spriteUrl: this.npcSpriteUrl(ev.type, ev.npc.id),
          icon: NPC_ICONS[ev.npc.id] ?? 'bug_report',
```

Replace with:

```ts
          name: ev.npc.name,
          // A missing file falls back to the icon via the card's onerror.
          spriteUrl: this.foeSpriteUrl(ev.npc, ev.type),
          icon: NPC_ICONS[ev.npc.id] ?? 'bug_report',
```

- [ ] **Step 6: Collapse call site 3 — the live battle opener (line ~3470)**

Find:

```ts
        name: ev.npc!.name,
        // A PvP clone draws the target's own creature from the sprite descriptor
        // the server sends; PvE foes use their art-folder sprite by id.
        spriteUrl:
          ev.kind === 'pvp' && ev.npc!.form
            ? this.spriteUrl(ev.npc!.form, ev.npc!.paint ?? {}, ev.npc!.hat, ev.npc!.spriteVariant)
            : this.npcSpriteUrl(ev.kind!, ev.npc!.spriteId ?? ev.npc!.id),
        icon: ev.kind === 'pvp' ? 'pets' : (NPC_ICONS[ev.npc!.id] ?? 'bug_report'),
```

Replace with:

```ts
        name: ev.npc!.name,
        spriteUrl: this.foeSpriteUrl(ev.npc!, ev.kind!),
        icon: ev.kind === 'pvp' ? 'pets' : (NPC_ICONS[ev.npc!.id] ?? 'bug_report'),
```

Leave the `icon` line as it is. It is the last-resort fallback if the sprite itself fails to load, and a paw print still reads better there than `bug_report` for a player's creature.

- [ ] **Step 7: Collapse call site 4 — the battle resume (line ~3520)**

Find:

```ts
        name: pb.npc.name,
        spriteUrl: this.npcSpriteUrl(pb.kind, pb.npc.spriteId ?? pb.npc.id ?? ''),
        icon: NPC_ICONS[pb.npc.id ?? ''] ?? 'bug_report',
```

Replace with:

```ts
        name: pb.npc.name,
        spriteUrl: this.foeSpriteUrl(pb.npc, pb.kind),
        icon: pb.kind === 'pvp' ? 'pets' : (NPC_ICONS[pb.npc.id ?? ''] ?? 'bug_report'),
```

The `icon` change matches call site 3: a resumed duel deserves the same fallback as a fresh one.

- [ ] **Step 8: Verify the build**

```bash
npm run build:prod
```

Expected: build succeeds with no TypeScript errors. There is no frontend test runner in this repo (`tsconfig.spec.json` is gone; do not try `ng test`), so a clean production build is the verification gate. Do not use `npm run lint` — it is broken in this repo.

- [ ] **Step 9: Commit**

```bash
git add src/app/undercity/services/undercity-models.ts src/app/undercity/tabs/board-tab.component.ts
git commit -m "fix: draw a player-derived foe as their real creature everywhere

Four call sites resolved foe art independently and only the live-battle
one handled sprite descriptors, so the boss-intro card, the result card
and a resumed duel all fell back to the paw-print icon. Collapse all
four onto one foeSpriteUrl() helper."
```

---

## Manual verification

Server tests cover the payloads; the rendering needs eyes. Use the `run-undercity` skill to launch against the live backend, then with two players on one space:

1. Attack the other player. The arena foe is their creature, in their colours, wearing their hat — not a paw print.
2. Reload the page mid-fight. The duel reopens and the foe still looks like them.
3. Win or lose. The result card shows their creature.
4. Fight any wild foe and a sigil-lair boss to confirm nothing regressed — wild foes keep their enemy art, lair bosses keep their guardian art and their dialogue card.

---

## What this plan deliberately does not do

- No Throne, no succession, no prestige. Those are Plans 3 and 4; this one only makes a descriptor-carrying foe render, which is the prerequisite they both rest on.
- No change to `npcSpriteUrl`'s art-folder routing. It is correct and well-commented; the bug was never in how PNG paths resolve.
- No `_sprite_descriptor` call in `_finish_lair`, `_finish_barrier`, `_finish_wild` or `_finish_world`. None of those foes can ever carry a descriptor, and adding speculative calls would be the same YAGNI that produced the stale comment.

---

## Remaining plans

- **Plan 2** — `syncBoardWorldState` extraction; the spectator board's ten missing layers; `drawIsleBoss` art on the boss node.
- **Plan 3** — server succession: `_build_throne`, the `throne` record, `dmg_mult` in `engine._base_hit`, `_boss()` occupant selection, lineage.
- **Plan 4** — prestige: the `ascended` state, renown banking and the `_archive_season` leaks, the prestige hatch, the Hall-of-Fame ascension animation.
