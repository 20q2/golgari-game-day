# Undercity Admin Panel Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Give the host a passphrase-gated `/undercity/admin` page to create puppet bots (real player docs) and manage the live season's roster (grant/heal/teleport/kick) plus broadcast host messages.

**Architecture:** One new server action type `admin` in `undercity_db.py`, gated once by `hostKey` then routed on a `cmd` field. Bots are ordinary `PLAYER#{BOT#…}` documents built by a shared `_new_player_doc` helper extracted from `_join`, so they render everywhere real players do with zero client special-casing. A new standalone `AdminPanelComponent` (lazy route, like the map editor) drives it, reading the live roster from the existing root `UndercityStateService` and dispatching admin commands straight through `UndercityApiService`.

**Tech Stack:** Python 3.11 Lambda (pytest FakeTable suite), Angular 20 standalone components + signals.

---

## File Structure

**Backend (`infrastructure/lambda/`):**
- Modify `undercity_db.py` — add `import random`; extract `_new_player_doc`; add `admin` dispatch + `_admin` router + six `_admin_*` handlers; add `isBot` to `_public_player`.
- Create `tests/test_admin.py` — FakeTable integration tests for every admin cmd.

**Frontend (`src/app/undercity/`):**
- Create `admin/admin-panel.component.ts` / `.html` / `.scss` — the admin page.
- Modify `app.routes.ts` — add the `/undercity/admin` lazy route.
- Modify `services/undercity-models.ts` — add `isBot?: boolean` to `PublicPlayer`.
- Modify `navbar/navbar.component.html` — add a localhost-only Admin link.

There is **no test runner for the frontend** (per CLAUDE.md). Backend tasks use TDD; frontend tasks are verified with `npm run build` and a described manual check.

---

## Task 1: Extract `_new_player_doc` from `_join`

**Files:**
- Modify: `infrastructure/lambda/undercity_db.py` (the `_join` function, ~line 599)
- Test: `infrastructure/lambda/tests/test_undercity_db.py` (existing — reuse as the regression guard)

- [ ] **Step 1: Run the existing join test to confirm the baseline is green**

Run: `cd infrastructure/lambda && python -m pytest tests/test_undercity_db.py::test_full_join_roll_move_flow -q`
Expected: PASS (1 passed). This test is the regression guard for the refactor.

- [ ] **Step 2: Add the shared helper above `_join`**

Insert this function immediately **before** `def _join(` in `undercity_db.py`:

```python
def _new_player_doc(sid, user_id, username, starter, home, *,
                    seals_before=0, egg_hue=None, creature_name='', is_bot=False):
    """Build a fresh, fully-valid season player doc. Shared by human `join`
    and admin `bot-add` so the two can never drift. Perm-record bookkeeping
    (seals/nights) stays in `_join`; bots skip it (they have no account)."""
    s = data.STARTERS[starter]
    body_hue = 130
    if seals_before >= 1 and isinstance(egg_hue, (int, float)):
        body_hue = int(egg_hue) % 360
    doc = {
        'pk': _season_pk(sid), 'sk': f'PLAYER#{user_id}',
        'userId': user_id, 'username': username or user_id,
        'species': starter, 'form': starter, 'tier': 1,
        'creatureName': creature_name or s['name'],
        'passives': [s['passive']],
        'level': 1, 'xp': 0, 'statPoints': 0,
        'spentThisLevel': {'atk': 0, 'def': 0, 'spd': 0},
        'hp': s['hp'], 'maxHp': s['hp'],
        'atk': s['atk'], 'def': s['def'], 'spd': s['spd'],
        'hpUpdatedAt': _now(),
        'position': data.HOME_GATES[home],
        'homeBiome': home,
        'rolls': data.JOIN_ROLLS + min(seals_before, data.SEAL_BONUS_CAP),
        'spores': 15 if home == 'city' else 0,  # City Rat hatch perk
        'bag': [], 'gear': {}, 'stance': 'fight',
        'pendingMove': None, 'buffs': [],
        'grimoires': [], 'equippedGrimoire': None,
        'spellCooldowns': {}, 'awayEvents': [],
        'lastFinishedClaim': None, 'taughtClaims': 0, 'pokesReceived': 0,
        'pvpWins': 0, 'wildWins': 0, 'composts': 0, 'bossDamage': 0,
        'paint': {'body': body_hue, 'belly': 50, 'stripes': body_hue},
        'hat': None, 'joinedAt': _now(), 'ver': 0,
    }
    if is_bot:
        doc['isBot'] = True
    return doc
```

- [ ] **Step 3: Replace the inline doc construction in `_join` with a call to the helper**

In `_join`, delete the block that starts at `s = data.STARTERS[starter]` and ends at the `}` closing the `doc = { … }` literal (the `body_hue`/`egg` lines and the whole dict), and replace it with:

```python
    doc = _new_player_doc(
        sid, user_id, username, starter, home,
        seals_before=seals_before, egg_hue=payload.get('eggHue'),
        creature_name=creature_name,
    )
```

Leave everything else in `_join` unchanged (the `existing`/`starter`/`home`/`creature_name` validation and perm bookkeeping above it; the `_save_or_conflict`, event, and `return _ok(doc)` below it).

- [ ] **Step 4: Run the regression test — behavior must be identical**

Run: `cd infrastructure/lambda && python -m pytest tests/test_undercity_db.py -q`
Expected: PASS (all previously-passing tests still pass — the refactor is behavior-preserving).

- [ ] **Step 5: Commit**

```bash
git add infrastructure/lambda/undercity_db.py
git commit -m "refactor(undercity): extract _new_player_doc shared by join + bots"
```

---

## Task 2: Admin dispatch, hostKey gate, and `broadcast`

**Files:**
- Modify: `infrastructure/lambda/undercity_db.py` (imports; `handle_action` ~line 596; new admin section)
- Test: `infrastructure/lambda/tests/test_admin.py` (create)

- [ ] **Step 1: Write the failing test file**

Create `infrastructure/lambda/tests/test_admin.py`:

```python
"""Integration tests for the host admin command surface."""
import sys
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parents[1]))

import pytest

import undercity_data as data
import undercity_db as db
from test_undercity_db import FakeTable, act


@pytest.fixture
def table():
    t = FakeTable()
    status, _ = act(t, 'season-start', hostKey='swampking')
    assert status == 200
    return t


def _admin(table, cmd, host='swampking', **payload):
    return act(table, 'admin', user='user-host', name='Host',
               cmd=cmd, hostKey=host, **payload)


def test_admin_rejects_wrong_hostkey(table):
    status, resp = _admin(table, 'broadcast', host='nope', text='hi')
    assert status == 403
    assert 'passphrase' in resp['error'].lower()


def test_broadcast_posts_event(table):
    status, resp = _admin(table, 'broadcast', text='The swarm gathers.')
    assert status == 200 and resp['ok'] is True
    _, state = db.handle_state(table, {'userId': 'user-host'})
    assert any(e['text'] == 'The swarm gathers.' for e in state['events'])


def test_broadcast_requires_text(table):
    status, resp = _admin(table, 'broadcast', text='   ')
    assert status == 400


def test_unknown_admin_cmd(table):
    status, resp = _admin(table, 'frobnicate')
    assert status == 400
```

- [ ] **Step 2: Run it to verify it fails**

Run: `cd infrastructure/lambda && python -m pytest tests/test_admin.py -q`
Expected: FAIL — `test_admin_rejects_wrong_hostkey` fails with status 400 ("Unknown action: admin") instead of 403, and the others fail similarly, because `admin` isn't wired up.

- [ ] **Step 3: Add the `random` import**

At the top of `undercity_db.py`, in the stdlib import group (near `import json` / `import uuid`), add:

```python
import random
```

- [ ] **Step 4: Wire `admin` into `handle_action`**

In `handle_action`, immediately **after** the `boss-awaken` block:

```python
    if atype == 'boss-awaken':
        return _boss_awaken(table, sid, config, payload)
```

add:

```python
    if atype == 'admin':
        return _admin(table, sid, config, payload)
```

- [ ] **Step 5: Add the admin section**

Add this new section at the **end** of the "Season lifecycle" region (immediately after `_boss_awaken`):

```python
# ── Host admin (passphrase-gated) ────────────────────────────────────────────

def _admin(table, sid, config, payload):
    """Single gated entry point for host tooling. Verifies the passphrase once,
    then routes on `cmd`. Handlers return plain {'ok': True, ...} envelopes
    (never a `you` doc) — the admin client refreshes state rather than patching
    its own creature."""
    host_key = (payload.get('hostKey') or '').strip()
    if config.get('hostKey') != host_key:
        return _err('Wrong host passphrase.', 403)
    cmd = payload.get('cmd')
    handler = _ADMIN_CMDS.get(cmd)
    if not handler:
        return _err(f'Unknown admin cmd: {cmd}')
    return handler(table, sid, payload)


def _admin_broadcast(table, sid, payload):
    text = str(payload.get('text') or '').strip()[:280]
    if not text:
        return _err('Broadcast text required.')
    _event(table, sid, 'host', text)
    return 200, {'ok': True}


_ADMIN_CMDS = {
    'broadcast': _admin_broadcast,
}
```

- [ ] **Step 6: Run the tests to verify they pass**

Run: `cd infrastructure/lambda && python -m pytest tests/test_admin.py -q`
Expected: PASS (4 passed).

- [ ] **Step 7: Commit**

```bash
git add infrastructure/lambda/undercity_db.py infrastructure/lambda/tests/test_admin.py
git commit -m "feat(undercity): gated admin action dispatch + broadcast"
```

---

## Task 3: `bot-add` and `isBot` in the public shape

**Files:**
- Modify: `infrastructure/lambda/undercity_db.py` (`_public_player`; admin handlers + `_ADMIN_CMDS`)
- Test: `infrastructure/lambda/tests/test_admin.py`

- [ ] **Step 1: Add the failing tests**

Append to `infrastructure/lambda/tests/test_admin.py`:

```python
def test_bot_add_creates_public_player(table):
    status, resp = _admin(table, 'bot-add', species='saproling', home='cavern',
                          name='Mossy')
    assert status == 200
    bot = resp['bot']
    assert bot['isBot'] is True
    assert bot['species'] == 'saproling'
    assert bot['userId'].startswith('BOT#')
    assert bot['hp'] == 38 and bot['position'] == 'cavern_r0'

    # It appears in the season roster like any player.
    _, state = db.handle_state(table, {'userId': 'user-host'})
    ids = [p['userId'] for p in state['players']]
    assert bot['userId'] in ids
    assert any(p.get('isBot') for p in state['players'])


def test_bot_add_random_species_and_home(table):
    status, resp = _admin(table, 'bot-add')  # no species/home => random
    assert status == 200
    bot = resp['bot']
    assert bot['species'] in data.STARTERS
    assert bot['isBot'] is True


def test_bot_add_rejects_bad_species(table):
    status, resp = _admin(table, 'bot-add', species='dragon')
    assert status == 400
```

- [ ] **Step 2: Run to verify failure**

Run: `cd infrastructure/lambda && python -m pytest tests/test_admin.py -k bot_add -q`
Expected: FAIL — "Unknown admin cmd: bot-add".

- [ ] **Step 3: Add `isBot` to `_public_player`**

In `_public_player`, add this line inside the returned dict (next to `'hat'`):

```python
        'isBot': p.get('isBot', False),
```

- [ ] **Step 4: Add the `_admin_bot_add` handler and register it**

Add above the `_ADMIN_CMDS` dict:

```python
def _admin_bot_add(table, sid, payload):
    species = payload.get('species')
    if species in (None, '', 'random'):
        species = random.choice(list(data.STARTERS))
    if species not in data.STARTERS:
        return _err('Unknown species: ' + str(species))
    home = payload.get('home')
    if home in (None, '', 'random'):
        home = random.choice(list(data.BIOMES))
    if home not in data.BIOMES:
        return _err('Unknown home biome: ' + str(home))
    name = str(payload.get('name') or '').strip()[:16]
    bot_id = 'BOT#' + uuid.uuid4().hex[:8]
    username = name or ('Bot ' + bot_id[4:8])
    doc = _new_player_doc(sid, bot_id, username, species, home,
                          creature_name=name, is_bot=True)
    conflict = _save_or_conflict(table, doc)
    if conflict:
        return conflict
    _event(table, sid, 'hatch',
           f"A {data.STARTERS[species]['name']} named {doc['creatureName']} "
           f"skitters into the Undercity.", actor=bot_id)
    return 200, {'ok': True, 'bot': _public_player(doc)}
```

Then add `'bot-add'` to `_ADMIN_CMDS`:

```python
_ADMIN_CMDS = {
    'broadcast': _admin_broadcast,
    'bot-add': _admin_bot_add,
}
```

- [ ] **Step 5: Run to verify pass**

Run: `cd infrastructure/lambda && python -m pytest tests/test_admin.py -q`
Expected: PASS (7 passed).

- [ ] **Step 6: Commit**

```bash
git add infrastructure/lambda/undercity_db.py infrastructure/lambda/tests/test_admin.py
git commit -m "feat(undercity): admin bot-add creates real puppet players"
```

---

## Task 4: `grant`, `heal`, and the target helper

**Files:**
- Modify: `infrastructure/lambda/undercity_db.py` (admin handlers + `_ADMIN_CMDS`)
- Test: `infrastructure/lambda/tests/test_admin.py`

- [ ] **Step 1: Add the failing tests**

Append to `infrastructure/lambda/tests/test_admin.py`:

```python
def _join_alex(table):
    status, resp = act(table, 'join', user='user-alex', name='Alex',
                       starter='pest', home='city')
    assert status == 200
    return resp['you']


def test_grant_rolls_spores_and_xp_levels_up(table):
    _join_alex(table)
    status, resp = _admin(table, 'grant', target='user-alex',
                          rolls=5, spores=10, xp=1000)
    assert status == 200 and resp['ok'] is True
    _, state = db.handle_state(table, {'userId': 'user-alex'})
    me = state['you']
    assert me['rolls'] == 3 + 5
    assert me['spores'] == 15 + 10   # city start (15) + 10
    assert me['level'] > 1           # 1000 xp forces level-ups


def test_grant_unknown_target(table):
    status, resp = _admin(table, 'grant', target='nobody', rolls=1)
    assert status == 400
    assert 'no such player' in resp['error'].lower()


def test_heal_restores_full_hp(table):
    _join_alex(table)
    # Wound Alex directly, then heal.
    doc = db._get_player(table, db._active_season(table)[0], 'user-alex')
    doc['hp'] = 1
    db._put_player(table, doc)
    status, resp = _admin(table, 'heal', target='user-alex')
    assert status == 200
    healed = db._get_player(table, db._active_season(table)[0], 'user-alex')
    assert healed['hp'] == healed['maxHp']
```

- [ ] **Step 2: Run to verify failure**

Run: `cd infrastructure/lambda && python -m pytest tests/test_admin.py -k "grant or heal" -q`
Expected: FAIL — "Unknown admin cmd: grant".

- [ ] **Step 3: Add the target helper and the two handlers**

Add above the `_ADMIN_CMDS` dict:

```python
def _admin_target(table, sid, payload):
    """Resolve payload.target to a live player doc. Returns (doc, None) or
    (None, error_tuple)."""
    target = payload.get('target')
    if not target:
        return None, _err('target userId required.')
    doc = _get_player(table, sid, target)
    if not doc:
        return None, _err('No such player this season.')
    return doc, None


def _admin_grant(table, sid, payload):
    doc, err = _admin_target(table, sid, payload)
    if err:
        return err
    rolls = int(payload.get('rolls') or 0)
    spores = int(payload.get('spores') or 0)
    xp = int(payload.get('xp') or 0)
    if rolls:
        doc['rolls'] = doc.get('rolls', 0) + rolls
    if spores:
        doc['spores'] = doc.get('spores', 0) + spores
    if xp:
        _grant_xp(table, sid, doc, xp)  # mutates doc; fires level events
    conflict = _save_or_conflict(table, doc)
    if conflict:
        return conflict
    return 200, {'ok': True}


def _admin_heal(table, sid, payload):
    doc, err = _admin_target(table, sid, payload)
    if err:
        return err
    doc['hp'] = engine.effective_stats(doc)['maxHp']
    doc['hpUpdatedAt'] = _now()
    conflict = _save_or_conflict(table, doc)
    if conflict:
        return conflict
    return 200, {'ok': True}
```

Then extend `_ADMIN_CMDS`:

```python
_ADMIN_CMDS = {
    'broadcast': _admin_broadcast,
    'bot-add': _admin_bot_add,
    'grant': _admin_grant,
    'heal': _admin_heal,
}
```

- [ ] **Step 4: Run to verify pass**

Run: `cd infrastructure/lambda && python -m pytest tests/test_admin.py -q`
Expected: PASS (10 passed).

- [ ] **Step 5: Commit**

```bash
git add infrastructure/lambda/undercity_db.py infrastructure/lambda/tests/test_admin.py
git commit -m "feat(undercity): admin grant + heal"
```

---

## Task 5: `teleport` and `kick`

**Files:**
- Modify: `infrastructure/lambda/undercity_db.py` (admin handlers + `_ADMIN_CMDS`)
- Test: `infrastructure/lambda/tests/test_admin.py`

- [ ] **Step 1: Add the failing tests**

Append to `infrastructure/lambda/tests/test_admin.py`:

```python
def test_teleport_moves_to_valid_node(table):
    _join_alex(table)
    dest = next(iter(data.MAP_NODES))
    status, resp = _admin(table, 'teleport', target='user-alex', node=dest)
    assert status == 200
    moved = db._get_player(table, db._active_season(table)[0], 'user-alex')
    assert moved['position'] == dest


def test_teleport_rejects_bad_node(table):
    _join_alex(table)
    status, resp = _admin(table, 'teleport', target='user-alex', node='atlantis')
    assert status == 400


def test_kick_removes_player(table):
    _join_alex(table)
    status, resp = _admin(table, 'kick', target='user-alex')
    assert status == 200 and resp['removed'] == 'user-alex'
    _, state = db.handle_state(table, {'userId': 'user-alex'})
    ids = [p['userId'] for p in state['players']]
    assert 'user-alex' not in ids


def test_kick_bot(table):
    _, resp = _admin(table, 'bot-add', species='pest', home='city')
    bot_id = resp['bot']['userId']
    status, resp = _admin(table, 'kick', target=bot_id)
    assert status == 200
    _, state = db.handle_state(table, {'userId': 'user-host'})
    assert bot_id not in [p['userId'] for p in state['players']]
```

- [ ] **Step 2: Run to verify failure**

Run: `cd infrastructure/lambda && python -m pytest tests/test_admin.py -k "teleport or kick" -q`
Expected: FAIL — "Unknown admin cmd: teleport".

- [ ] **Step 3: Add the two handlers**

Add above the `_ADMIN_CMDS` dict:

```python
def _admin_teleport(table, sid, payload):
    doc, err = _admin_target(table, sid, payload)
    if err:
        return err
    node = payload.get('node')
    if node not in data.MAP_NODES:
        return _err('Unknown node: ' + str(node))
    doc['position'] = node
    doc['pendingMove'] = None
    conflict = _save_or_conflict(table, doc)
    if conflict:
        return conflict
    return 200, {'ok': True}


def _admin_kick(table, sid, payload):
    target = payload.get('target')
    if not target:
        return _err('target userId required.')
    doc = _get_player(table, sid, target)
    if not doc:
        return _err('No such player this season.')
    table.delete_item(Key={'pk': _season_pk(sid), 'sk': f'PLAYER#{target}'})
    _event(table, sid, 'host',
           f"{doc.get('username', 'A creature')} left the Undercity.")
    return 200, {'ok': True, 'removed': target}
```

Then extend `_ADMIN_CMDS`:

```python
_ADMIN_CMDS = {
    'broadcast': _admin_broadcast,
    'bot-add': _admin_bot_add,
    'grant': _admin_grant,
    'heal': _admin_heal,
    'teleport': _admin_teleport,
    'kick': _admin_kick,
}
```

- [ ] **Step 4: Run the full admin suite**

Run: `cd infrastructure/lambda && python -m pytest tests/test_admin.py -q`
Expected: PASS (14 passed).

- [ ] **Step 5: Run the whole backend suite (no regressions)**

Run: `cd infrastructure/lambda && python -m pytest tests -q`
Expected: PASS (all tests green, including the map-sync guard and the pre-existing db suite).

- [ ] **Step 6: Commit**

```bash
git add infrastructure/lambda/undercity_db.py infrastructure/lambda/tests/test_admin.py
git commit -m "feat(undercity): admin teleport + kick"
```

---

## Task 6: Admin route + component shell (passphrase gate)

**Files:**
- Modify: `src/app/undercity/services/undercity-models.ts` (`PublicPlayer`)
- Create: `src/app/undercity/admin/admin-panel.component.ts`
- Create: `src/app/undercity/admin/admin-panel.component.html`
- Create: `src/app/undercity/admin/admin-panel.component.scss`
- Modify: `src/app/app.routes.ts`
- Modify: `src/app/navbar/navbar.component.html`

- [ ] **Step 1: Add `isBot` to the `PublicPlayer` model**

In `src/app/undercity/services/undercity-models.ts`, inside `interface PublicPlayer`, add after `renown: number;`:

```typescript
  isBot?: boolean;
```

- [ ] **Step 2: Create the component TypeScript**

Create `src/app/undercity/admin/admin-panel.component.ts`:

```typescript
import { Component, OnDestroy, OnInit, inject, signal } from '@angular/core';
import { CommonModule } from '@angular/common';
import { FormsModule } from '@angular/forms';
import { HttpClient } from '@angular/common/http';
import { firstValueFrom } from 'rxjs';
import { MatIconModule } from '@angular/material/icon';
import { UndercityStateService } from '../services/undercity-state.service';
import { UndercityApiService, UndercityApiError } from '../services/undercity-api.service';
import { HostPanelComponent } from '../host/host-panel.component';

const HOST_KEY_STORAGE = 'undercity-host-key';

interface MapNode {
  id: string;
  region?: string;
  type?: string;
}

/**
 * Host admin surface (dev/host only, reached by URL): create puppet bots and
 * manage the live roster — grant/heal/teleport/kick — plus broadcast messages.
 * Gated by the same host passphrase as the host panel; every request carries it
 * and the server 403s on mismatch. Talks to the API directly (not
 * store.action) so admin edits to other players never clobber the host's own
 * `you` doc; a refresh reconciles the roster after each command.
 */
@Component({
  selector: 'app-undercity-admin-panel',
  standalone: true,
  imports: [CommonModule, FormsModule, MatIconModule, HostPanelComponent],
  templateUrl: './admin-panel.component.html',
  styleUrls: ['./admin-panel.component.scss'],
})
export class AdminPanelComponent implements OnInit, OnDestroy {
  protected readonly store = inject(UndercityStateService);
  private readonly api = inject(UndercityApiService);
  private readonly http = inject(HttpClient);

  protected hostKey = localStorage.getItem(HOST_KEY_STORAGE) ?? '';
  protected readonly busy = signal(false);
  protected readonly message = signal<string | null>(null);
  protected readonly nodes = signal<MapNode[]>([]);

  // Add-bot form state.
  protected readonly speciesList = ['random', 'pest', 'kraul', 'saproling', 'zombie'];
  protected readonly biomeList = ['random', 'city', 'cavern', 'bog', 'garden', 'bone'];
  protected botName = '';
  protected botSpecies = 'random';
  protected botHome = 'random';

  // Grant form state.
  protected grantResource: 'rolls' | 'xp' | 'spores' = 'rolls';
  protected grantAmount = 3;

  // Broadcast state.
  protected broadcastText = '';

  async ngOnInit(): Promise<void> {
    this.store.startPolling();
    void this.store.refresh();
    try {
      const doc = await firstValueFrom(
        this.http.get<{ nodes: MapNode[] }>('data/undercity-map.json'),
      );
      this.nodes.set(doc.nodes ?? []);
    } catch {
      this.nodes.set([]);
    }
  }

  ngOnDestroy(): void {
    this.store.stopPolling();
  }

  protected rememberKey(): void {
    localStorage.setItem(HOST_KEY_STORAGE, this.hostKey);
  }

  /** Fire one admin command, then refresh the roster. */
  private async admin(cmd: string, extra: Record<string, unknown>): Promise<void> {
    if (this.busy() || !this.hostKey.trim()) return;
    this.busy.set(true);
    this.message.set(null);
    try {
      this.rememberKey();
      await this.api.action('admin', { hostKey: this.hostKey, cmd, ...extra });
      await this.store.refresh();
    } catch (e) {
      this.message.set(
        e instanceof UndercityApiError ? e.message : 'Admin action failed',
      );
    } finally {
      this.busy.set(false);
    }
  }

  protected addBot(): void {
    void this.admin('bot-add', {
      name: this.botName.trim(),
      species: this.botSpecies,
      home: this.botHome,
    }).then(() => {
      this.botName = '';
    });
  }

  protected grant(userId: string): void {
    void this.admin('grant', { target: userId, [this.grantResource]: this.grantAmount });
  }

  protected heal(userId: string): void {
    void this.admin('heal', { target: userId });
  }

  protected teleport(userId: string, node: string): void {
    if (!node) return;
    void this.admin('teleport', { target: userId, node });
  }

  protected kick(userId: string): void {
    void this.admin('kick', { target: userId });
  }

  protected broadcast(): void {
    const text = this.broadcastText.trim();
    if (!text) return;
    void this.admin('broadcast', { text }).then(() => {
      this.broadcastText = '';
    });
  }
}
```

- [ ] **Step 3: Create a minimal template (roster + forms come in Tasks 7–8)**

Create `src/app/undercity/admin/admin-panel.component.html`:

```html
<div class="admin">
  <h1 class="admin-title"><mat-icon>shield</mat-icon> Undercity Admin</h1>

  <label class="admin-key">
    Host passphrase
    <input type="password" [(ngModel)]="hostKey" (blur)="rememberKey()"
           autocomplete="off" placeholder="Host passphrase" />
  </label>

  @if (message(); as msg) {
    <p class="admin-msg">{{ msg }}</p>
  }

  <app-undercity-host-panel />

  <!-- Roster, add-bot, grant, and broadcast sections are added in later tasks. -->
</div>
```

- [ ] **Step 4: Create a basic stylesheet**

Create `src/app/undercity/admin/admin-panel.component.scss`:

```scss
.admin {
  max-width: 900px;
  margin: 0 auto;
  padding: 1rem;
  color: var(--primary-color, #e8e8e8);
}

.admin-title {
  display: flex;
  align-items: center;
  gap: 0.4rem;
  font-size: 1.4rem;
}

.admin-key {
  display: flex;
  flex-direction: column;
  gap: 0.25rem;
  max-width: 320px;
  margin: 0.5rem 0 1rem;

  input {
    padding: 0.4rem 0.6rem;
    border-radius: 6px;
    border: 1px solid #555;
    background: #1c1c1c;
    color: inherit;
  }
}

.admin-msg {
  padding: 0.5rem 0.75rem;
  border-radius: 6px;
  background: rgba(180, 60, 60, 0.2);
  border: 1px solid rgba(180, 60, 60, 0.5);
}
```

- [ ] **Step 5: Register the route**

In `src/app/app.routes.ts`, add after the `undercity/map-editor` route:

```typescript
  {
    path: 'undercity/admin',
    loadComponent: () =>
      import('./undercity/admin/admin-panel.component').then((m) => m.AdminPanelComponent),
  },
```

- [ ] **Step 6: Add a localhost-only navbar link**

In `src/app/navbar/navbar.component.html`, inside the existing `@if (isLocalhost) { … }` block (right after the map-editor `<a>…</a>`), add:

```html
      <a
        mat-button
        routerLink="/undercity/admin"
        routerLinkActive="active"
        class="nav-link"
        title="Undercity host admin panel (localhost only)"
      >
        <mat-icon>shield</mat-icon>
        <span class="nav-text">Admin</span>
      </a>
```

- [ ] **Step 7: Build to verify it compiles**

Run: `npm run build`
Expected: build succeeds (no TS/template errors). The `/undercity/admin` route lazy-loads the new component; the page shows the passphrase field and the embedded host panel.

- [ ] **Step 8: Commit**

```bash
git add src/app/undercity/admin src/app/app.routes.ts src/app/navbar/navbar.component.html src/app/undercity/services/undercity-models.ts
git commit -m "feat(undercity): admin route + shell with passphrase gate"
```

---

## Task 7: Roster table with per-row controls

**Files:**
- Modify: `src/app/undercity/admin/admin-panel.component.html`
- Modify: `src/app/undercity/admin/admin-panel.component.scss`

- [ ] **Step 1: Add the roster table + grant controls to the template**

In `admin-panel.component.html`, replace the trailing comment
`<!-- Roster, add-bot, grant, and broadcast sections are added in later tasks. -->`
with:

```html
  <section class="admin-section">
    <h2>Grant defaults</h2>
    <div class="grant-controls">
      <select [(ngModel)]="grantResource">
        <option value="rolls">Rolls</option>
        <option value="xp">XP</option>
        <option value="spores">Spores</option>
      </select>
      <input type="number" [(ngModel)]="grantAmount" min="1" class="amt" />
      <span class="hint">applied by each row's Grant button</span>
    </div>
  </section>

  <section class="admin-section">
    <h2>Roster ({{ store.players().length }})</h2>
    <div class="roster-wrap">
      <table class="roster">
        <thead>
          <tr>
            <th>Name</th><th>Form</th><th>Lvl</th><th>HP</th>
            <th>Node</th><th>Rolls</th><th>Spores</th><th>Actions</th>
          </tr>
        </thead>
        <tbody>
          @for (p of store.players(); track p.userId) {
            <tr [class.is-bot]="p.isBot">
              <td>
                {{ p.creatureName || p.formName }}
                @if (p.isBot) { <span class="bot-tag">BOT</span> }
                <div class="sub">{{ p.username }}</div>
              </td>
              <td>{{ p.formName }}</td>
              <td>{{ p.level }}</td>
              <td>{{ p.hp }}/{{ p.maxHp }}</td>
              <td class="node">{{ p.position }}</td>
              <td>{{ p.rolls }}</td>
              <td>{{ p.spores }}</td>
              <td class="row-actions">
                <button (click)="grant(p.userId)" [disabled]="busy()">Grant</button>
                <button (click)="heal(p.userId)" [disabled]="busy()">Heal</button>
                <select #tp (change)="teleport(p.userId, tp.value); tp.value=''"
                        [disabled]="busy()">
                  <option value="">Teleport…</option>
                  @for (n of nodes(); track n.id) {
                    <option [value]="n.id">{{ n.id }}</option>
                  }
                </select>
                <button class="danger" (click)="kick(p.userId)" [disabled]="busy()">
                  Kick
                </button>
              </td>
            </tr>
          } @empty {
            <tr><td colspan="8" class="empty">No players yet.</td></tr>
          }
        </tbody>
      </table>
    </div>
  </section>
```

- [ ] **Step 2: Add roster styling**

Append to `admin-panel.component.scss`:

```scss
.admin-section {
  margin: 1.25rem 0;

  h2 {
    font-size: 1.05rem;
    margin-bottom: 0.5rem;
  }
}

.grant-controls {
  display: flex;
  align-items: center;
  gap: 0.5rem;

  .amt { width: 5rem; }
  .hint { opacity: 0.6; font-size: 0.85rem; }
}

.roster-wrap { overflow-x: auto; }

.roster {
  width: 100%;
  border-collapse: collapse;
  font-size: 0.9rem;

  th, td {
    text-align: left;
    padding: 0.35rem 0.5rem;
    border-bottom: 1px solid #333;
    white-space: nowrap;
  }

  .sub { opacity: 0.55; font-size: 0.75rem; }
  .node { font-family: monospace; }
  tr.is-bot { background: rgba(90, 140, 90, 0.12); }
  .empty { text-align: center; opacity: 0.6; padding: 1rem; }
}

.bot-tag {
  font-size: 0.6rem;
  background: #4a7a4a;
  color: #fff;
  padding: 0 0.3rem;
  border-radius: 4px;
  vertical-align: middle;
}

.row-actions {
  display: flex;
  gap: 0.3rem;

  button, select {
    padding: 0.2rem 0.4rem;
    border-radius: 5px;
    border: 1px solid #555;
    background: #262626;
    color: inherit;
    cursor: pointer;
  }
  .danger { border-color: #7a3a3a; }
}

select, input, button { font-family: inherit; }
```

- [ ] **Step 3: Build to verify**

Run: `npm run build`
Expected: build succeeds. The roster renders every player + bot with Grant/Heal/Teleport/Kick controls; bot rows are tinted and tagged.

- [ ] **Step 4: Commit**

```bash
git add src/app/undercity/admin
git commit -m "feat(undercity): admin roster table + per-row controls"
```

---

## Task 8: Add-bot form + broadcast, and final verification

**Files:**
- Modify: `src/app/undercity/admin/admin-panel.component.html`

- [ ] **Step 1: Add the add-bot and broadcast sections**

In `admin-panel.component.html`, insert **before** the Roster `<section>`:

```html
  <section class="admin-section">
    <h2>Add bot</h2>
    <div class="grant-controls">
      <input [(ngModel)]="botName" placeholder="Name (optional)" maxlength="16" />
      <select [(ngModel)]="botSpecies">
        @for (s of speciesList; track s) { <option [value]="s">{{ s }}</option> }
      </select>
      <select [(ngModel)]="botHome">
        @for (b of biomeList; track b) { <option [value]="b">{{ b }}</option> }
      </select>
      <button (click)="addBot()" [disabled]="busy() || !hostKey.trim()">
        <mat-icon class="mi">add</mat-icon> Add
      </button>
    </div>
  </section>
```

And insert **after** the Roster `<section>` (as the last section):

```html
  <section class="admin-section">
    <h2>Broadcast</h2>
    <div class="grant-controls">
      <input [(ngModel)]="broadcastText" placeholder="Message to the log / TV ticker"
             maxlength="280" class="broadcast-input" />
      <button (click)="broadcast()" [disabled]="busy() || !hostKey.trim()">
        <mat-icon class="mi">campaign</mat-icon> Send
      </button>
    </div>
  </section>
```

- [ ] **Step 2: Add one style rule for the wide input**

Append to `admin-panel.component.scss`:

```scss
.broadcast-input { flex: 1; min-width: 12rem; }
.mi { font-size: 1.1rem; height: 1.1rem; width: 1.1rem; vertical-align: middle; }
```

- [ ] **Step 3: Build to verify**

Run: `npm run build`
Expected: build succeeds. The admin page now has Add-bot, Grant defaults, Roster, and Broadcast sections plus the embedded host panel.

- [ ] **Step 4: Full backend suite one more time (guard against drift)**

Run: `cd infrastructure/lambda && python -m pytest tests -q`
Expected: PASS (all green).

- [ ] **Step 5: Manual smoke test (described — needs a running dev server + deployed Lambda)**

Run `npm start`, open `http://localhost:4200/undercity/admin`. With the correct host passphrase: (a) **Add bot** → a new tinted BOT row appears in the roster and shows on the board / `/tv`; (b) **Grant** rolls to a player → their Rolls count rises; (c) **Teleport** a player → their Node changes; (d) **Broadcast** a message → it appears in the game log / TV ticker; (e) **Kick** the bot → its row disappears. A wrong passphrase surfaces "Wrong host passphrase." in the message line.

> Note (per project conventions): the user runs deploys. The admin commands hit the live Lambda, so the manual test requires the Task 2–5 backend changes to be deployed. Leave the branch with tests green and note that a `cdk deploy` is needed before the panel is fully functional against production.

- [ ] **Step 6: Commit**

```bash
git add src/app/undercity/admin
git commit -m "feat(undercity): admin add-bot form + broadcast"
```

---

## Self-Review Notes

- **Spec coverage:** route + passphrase gate (Task 6), bots as real docs (Tasks 1, 3), roster view (Task 7), grant/heal/teleport (Tasks 4–5, 7), kick (Tasks 5, 7), broadcast (Tasks 2, 8), `isBot` in public shape (Tasks 3, 6), tests (Tasks 2–5), no CDK change (confirmed — reuses `/game/action`). All covered.
- **Type consistency:** `_admin_target` returns `(doc, err)` and is consumed identically in grant/heal/teleport; `_ADMIN_CMDS` is defined once (Task 2) then extended in-place in Tasks 3/4/5 (each task shows the full dict literal to avoid ambiguity). Client `admin(cmd, extra)` helper is the single dispatch path for all six commands. `isBot?: boolean` on `PublicPlayer` matches the server's `p.get('isBot', False)`.
- **Deferred (not in plan, by design):** bot combat/AI, board reseed, season clock, spawn wild/loot, per-player reset.
