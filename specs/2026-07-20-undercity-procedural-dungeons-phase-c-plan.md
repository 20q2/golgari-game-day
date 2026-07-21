# Procedural Dungeons — Phase C (Wire it on) Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Make procedural dungeons live — generate the five pockets at `season-start`, serve them to the client, and flip the flag on — so every new night has fresh mazes.

**Architecture:** `season-start` calls `undercity_mapgen.generate_all_depths(sid)` (Phase B) and stores the result on the season's `MAP` record; `_season_map` (Phase A) already merges it with the fixed surface and `GET /game/map` (Phase A) already serves it. The client fetches `/game/map` instead of the static asset — the pure `computeLayers` groups generated depths into pockets automatically. A test-only `conftest.py` keeps the flag off for the legacy suite; production defaults it on.

**Tech Stack:** Python 3.11 Lambda + pytest; Angular/TypeScript client.

Design: [specs/2026-07-20-undercity-procedural-dungeons-design.md](2026-07-20-undercity-procedural-dungeons-design.md). Depends on Phase A + Phase B (both merged).

**Test loop:** `cd infrastructure/lambda && python -m pytest tests -q`
**Client build:** `npm run build`

**Key facts that shape this plan:**
- The committed `map.json` is untouched — it stays the surface source and the depths *fallback*, so `test_map.py`, `test_map_file.py`, and `test_deep_dungeons.py` keep passing as-is. **No golden→invariant conversion is needed.**
- The client's `computeLayers` ([board-layers.ts](../src/app/undercity/engine/board-layers.ts)) already builds pocket layers by union-find over depths edges — generated depths group with **no client change** beyond the fetch URL.
- Generation runs **once per night at season-start** (not per request/player), so every player sees the same dungeon that night. `_season_map` only reads the stored `MAP` record.
- `data.PROCEDURAL_DUNGEONS` (the runtime flag) is a separate binding from `undercity_config.PROCEDURAL_DUNGEONS` (because `undercity_data` does `from undercity_config import *`). Tests monkeypatch `data.*`; the production default is read from `undercity_config.*`.
- **Scope:** only the player view (`undercity-page`) switches to `/game/map`. The spectator, admin panel, and map editor keep reading the static asset (they are secondary/dev views, and the spectator file has unrelated in-flight edits) — a deliberate, noted follow-up.

---

## File Structure

- `infrastructure/lambda/tests/conftest.py` — **create**: autouse fixture defaulting `PROCEDURAL_DUNGEONS` off in tests.
- `infrastructure/lambda/undercity_config.py` — **modify**: flip `PROCEDURAL_DUNGEONS` default to `True`.
- `infrastructure/lambda/undercity_db.py` — **modify**: import `undercity_mapgen`; generate + store the `MAP` record in `_season_start` when the flag is on.
- `infrastructure/lambda/tests/test_procedural_map.py` — **modify**: replace the default-off assertion; add season-start generation + end-to-end tests.
- `src/app/undercity/services/undercity-api.service.ts` — **modify**: add `getMap()`.
- `src/app/undercity/undercity-page.component.ts` — **modify**: fetch the season map from the API.

---

## Task 1: Test isolation + flip the production default

**Files:**
- Create: `infrastructure/lambda/tests/conftest.py`
- Modify: `infrastructure/lambda/undercity_config.py`
- Modify: `infrastructure/lambda/tests/test_procedural_map.py` (`test_flag_defaults_off`)

- [ ] **Step 1: Add the autouse conftest (flag off in tests)**

Create `infrastructure/lambda/tests/conftest.py`:

```python
"""Shared test setup. Procedural dungeon generation is ON in production but OFF
by default in tests: the legacy suite assumes the committed depths, and leaving
generation off keeps season-start fast and deterministic. Tests that exercise
generation opt in with `monkeypatch.setattr(data, 'PROCEDURAL_DUNGEONS', True)`."""
import sys
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parents[1]))

import pytest
import undercity_data as data


@pytest.fixture(autouse=True)
def _procedural_off(monkeypatch):
    monkeypatch.setattr(data, 'PROCEDURAL_DUNGEONS', False)
```

- [ ] **Step 2: Update the default-assertion test to read the production default**

In `tests/test_procedural_map.py`, replace `test_flag_defaults_off` with a test that reads the untouched config module (the conftest only overrides `data.*`):

```python
def test_procedural_dungeons_on_in_production():
    import undercity_config
    assert undercity_config.PROCEDURAL_DUNGEONS is True
```

- [ ] **Step 3: Run to verify it fails**

Run: `cd infrastructure/lambda && python -m pytest tests/test_procedural_map.py -k production -q`
Expected: FAIL — `undercity_config.PROCEDURAL_DUNGEONS` is still `False`.

- [ ] **Step 4: Flip the production default**

In `infrastructure/lambda/undercity_config.py`, change the flag line (added in Phase A):

```python
PROCEDURAL_DUNGEONS = True
```

Leave its comment block intact.

- [ ] **Step 5: Run the whole suite to confirm isolation holds**

Run: `cd infrastructure/lambda && python -m pytest tests -q`
Expected: all green. The conftest forces `data.PROCEDURAL_DUNGEONS` off for every test, so nothing that assumes committed depths moves; `test_procedural_dungeons_on_in_production` now passes by reading the config module directly.

- [ ] **Step 6: Commit**

```bash
git add infrastructure/lambda/tests/conftest.py infrastructure/lambda/undercity_config.py \
        infrastructure/lambda/tests/test_procedural_map.py
git commit -m "feat(undercity): enable procedural dungeons in production; off in tests"
```

---

## Task 2: Generate + store the night's dungeons at season-start

**Files:**
- Modify: `infrastructure/lambda/undercity_db.py` (imports; `_season_start`)
- Modify: `infrastructure/lambda/tests/test_procedural_map.py`

- [ ] **Step 1: Write the failing tests**

Append to `tests/test_procedural_map.py`:

```python
def test_season_start_stores_generated_depths(table, monkeypatch):
    monkeypatch.setattr(data, 'PROCEDURAL_DUNGEONS', True)
    db._season_map_cache.clear()
    status, resp = act(table, 'season-start', hostKey='swampking')   # fresh night, flag on
    assert status == 200
    sid = _sid(table)
    rec = db._get(table, db._season_pk(sid), 'MAP')
    assert rec and rec.get('depths')
    ids = {n['id'] for n in rec['depths']}
    for biome in data.BIOMES:
        assert f'{biome}_lair' in ids and f'{biome}_lb' in ids and f'{biome}_esc' in ids
    # It is the generator's output, not the committed fallback.
    depths = db._load_season_depths(table, sid)
    assert depths != data.COMMITTED_DEPTHS


def test_season_start_skips_generation_when_flag_off(table, monkeypatch):
    monkeypatch.setattr(data, 'PROCEDURAL_DUNGEONS', False)
    status, _ = act(table, 'season-start', hostKey='swampking')
    assert status == 200
    sid = _sid(table)
    assert db._get(table, db._season_pk(sid), 'MAP') is None   # no MAP record written


def test_generated_dungeon_is_navigable_end_to_end(table, monkeypatch):
    monkeypatch.setattr(data, 'PROCEDURAL_DUNGEONS', True)
    db._season_map_cache.clear()
    act(table, 'season-start', hostKey='swampking')
    act(table, 'join', starter='pest', home='city')
    sid = _sid(table)
    nodes = db._season_map(table, sid)
    # Stand at the generated mouth; a roll of 1 must reach a real generated node.
    doc = db._get_player(table, sid, 'user-alex')
    doc['position'] = 'city_lb'
    dests = engine.legal_destinations(nodes, 'city_lb', 1,
                                      db._closed_barriers(table, sid), db._blocked_nodes(doc))
    assert dests and all(d in nodes for d in dests)
    # The generated lair is reachable and grants the city sigil.
    assert 'city_lair' in nodes and 'city_lair' in data.SIGIL_LAIRS
```

- [ ] **Step 2: Run to verify they fail**

Run: `cd infrastructure/lambda && python -m pytest tests/test_procedural_map.py -k "season_start_stores or navigable" -q`
Expected: FAIL — no `MAP` record is written at season-start yet (`rec` is `None`).

- [ ] **Step 3: Import the generator in `undercity_db.py`**

At the top of `infrastructure/lambda/undercity_db.py`, next to `import undercity_data as data`, add:

```python
import undercity_mapgen as mapgen
```

- [ ] **Step 4: Generate + store in `_season_start`**

In `_season_start`, right after the `META_PK / CURRENT` put_item and before the `_event(...)` call, add:

```python
    if data.PROCEDURAL_DUNGEONS:
        table.put_item(Item={'pk': _season_pk(sid), 'sk': 'MAP',
                             'depths': mapgen.generate_all_depths(sid)})
```

(The `CONFIG` and `CURRENT` writes already ran, so `sid` is in scope. `_season_map` will read this `MAP` record for the rest of the night; with the flag off nothing is written and the committed fallback is used.)

- [ ] **Step 5: Run the new tests, then the full suite**

Run: `cd infrastructure/lambda && python -m pytest tests/test_procedural_map.py -q`
Expected: PASS (generation stored, skipped when off, navigable end-to-end).

Run: `cd infrastructure/lambda && python -m pytest tests -q`
Expected: all green (conftest keeps generation off for the legacy suite).

- [ ] **Step 6: Commit**

```bash
git add infrastructure/lambda/undercity_db.py infrastructure/lambda/tests/test_procedural_map.py
git commit -m "feat(undercity): generate + store the night's dungeons at season-start"
```

---

## Task 3: Client fetches the season map

**Files:**
- Modify: `src/app/undercity/services/undercity-api.service.ts`
- Modify: `src/app/undercity/undercity-page.component.ts`

- [ ] **Step 1: Add `getMap()` to the API service**

In `src/app/undercity/services/undercity-api.service.ts`, add the import and method. At the top, extend the models import:

```typescript
import { ActionResponse, GameState } from './undercity-models';
import type { BoardMap } from '../engine/board-map';
```

(If `BoardMap` lives elsewhere, match the import path used by `undercity-page.component.ts`'s existing `BoardMap` import.)

Add this method inside the class, after `getState()`:

```typescript
  /** The night's board: fixed surface + this season's (possibly generated)
   *  depths. Falls back to the committed board server-side when no season. */
  async getMap(): Promise<BoardMap> {
    const response = await fetch(`${this.API_BASE_URL}/game/map`, {
      method: 'GET', mode: 'cors', headers: { 'Content-Type': 'application/json' },
    });
    if (!response.ok) {
      throw new UndercityApiError(`Failed to load board map (${response.status})`, response.status);
    }
    return response.json();
  }
```

- [ ] **Step 2: Switch the player view's map load to the API**

In `src/app/undercity/undercity-page.component.ts`, ensure the API service is injected (it likely already is via the store; if the component has no direct reference, add near the other `inject(...)` fields):

```typescript
  private readonly api = inject(UndercityApiService);
```

(Import it if not already: `import { UndercityApiService } from './services/undercity-api.service';`.)

Then replace the map fetch in `ngOnInit` (currently `this.http.get<BoardMap>('data/undercity-map.json')`):

```typescript
    void this.api.getMap().then((m) => this.map.set(m));
```

- [ ] **Step 3: Build the client**

Run: `npm run build`
Expected: build succeeds, no TypeScript errors. (No TS unit runner in this repo — the build is the compile gate.)

- [ ] **Step 4: Commit**

```bash
git add src/app/undercity/services/undercity-api.service.ts src/app/undercity/undercity-page.component.ts
git commit -m "feat(undercity): player view loads the night's board from /game/map"
```

---

## Verification (whole phase)

- [ ] `cd infrastructure/lambda && python -m pytest tests -q` — all green.
- [ ] `npm run build` — client compiles.
- [ ] `undercity_config.PROCEDURAL_DUNGEONS is True` (production on); the conftest keeps tests on the committed board except where they opt in.
- [ ] Note for the user: **this phase needs a Lambda + client deploy to see live.** After deploy, each `season-start` mints fresh mazes; players load them via `/game/map`. If a night ever looks wrong, set `PROCEDURAL_DUNGEONS = False` and redeploy to fall back to the committed dungeons instantly.
- [ ] Follow-up (not in this phase): switch the spectator view to `/game/map` too, so viewers see the same generated dungeons (deferred to avoid colliding with in-flight spectator edits).

## Self-Review

**Spec coverage (Phase C slice):**
- Generate at season-start + store `MAP` record → Task 2. ✔
- Flip the flag on in production → Task 1. ✔
- Serve to client via `GET /game/map` (Phase A) + client fetch switch → Task 3. ✔
- Client pocket-layer grouping for generated ids → automatic via `computeLayers` (no code needed); noted. ✔
- Generation once per night, shared by all players → `_season_start` stores; `_season_map` only reads. ✔
- Instant rollback → flag off + redeploy (Verification). ✔
- Golden→invariant conversion → **not needed** (committed map retained as fallback); rationale documented in the header. ✔
- Legacy suite protected from the flag flip → conftest autouse (Task 1). ✔

**Placeholder scan:** none — every step shows concrete code or an exact command. (The two `BoardMap` import notes in Task 3 are conditional guidance to match the existing import path, not placeholders — the code is fully specified.)

**Type/name consistency:** `PROCEDURAL_DUNGEONS`, `_season_map`, `_season_map_cache`, `_load_season_depths`, `_season_pk`, `_get`, `generate_all_depths`, `mapgen`, `getMap`, `BoardMap` used consistently with Phases A/B and the existing client. The `MAP` record shape `{pk: SEASON#<sid>, sk: 'MAP', depths: [...]}` matches Phase A's `_load_season_depths` reader exactly.
