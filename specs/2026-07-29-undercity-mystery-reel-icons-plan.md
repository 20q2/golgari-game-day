# Mystery Reel Per-Outcome Icons — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Give the mystery-space lottery reel a distinct icon per outcome instead of collapsing almost everything to the `help` (?) icon.

**Architecture:** Make the outcome server-authoritative: a pure `engine.mystery_outcome(res, out)` helper computes a canonical `outcome` key, `_mystery` stamps it on the event, and the client maps `outcome` → a reel face. The reel's `SYMBOLS` set expands to cover every outcome; `board-tab.mysterySymbol` stops sniffing event fields and just trusts `outcome`.

**Tech Stack:** Python 3.11 Lambda (pytest), Angular 20 standalone components (Material Icons).

Spec: [specs/2026-07-29-undercity-mystery-reel-icons-design.md](2026-07-29-undercity-mystery-reel-icons-design.md)

Run server tests from `infrastructure/lambda`:
```
python -m pytest tests -q -p no:randomly
```
(The repo has known pre-existing failures in `test_map`, `test_deep_dungeons`,
`test_undercity_spells` driven by in-progress `undercity_data.py` work — those are
unrelated to this plan. Scope your assertions to the tests named in each task.)

---

## File Structure

**Server (`infrastructure/lambda/`):**
- `undercity_engine.py` — add pure `mystery_outcome(res, out)` next to `roll_mystery`.
- `undercity_db.py` — `_mystery` stamps `out['outcome'] = engine.mystery_outcome(res, out)`.
- `tests/test_undercity_engine.py` — unit tests for `mystery_outcome`.
- `tests/test_undercity_db.py` — `_mystery` always emits a valid `outcome`.

**Client (`src/app/undercity/`):**
- `services/undercity-models.ts` — add `outcome?: string` to `SpaceEvent`.
- `tabs/mystery-reel.component.ts` — expand `SYMBOLS` to one face per outcome.
- `tabs/board-tab.component.ts` — rewrite `mysterySymbol` to trust `outcome`.

---

## Task 1: Pure `mystery_outcome` helper (engine)

**Files:**
- Modify: `infrastructure/lambda/undercity_engine.py` (add directly after `roll_mystery`, ~line 901)
- Test: `infrastructure/lambda/tests/test_undercity_engine.py`

- [ ] **Step 1: Write the failing tests**

Append to `tests/test_undercity_engine.py`:
```python
from undercity_engine import mystery_outcome


def _res(**kw):
    base = {'roll': 4, 'spores': 0, 'xp': 0, 'hpPct': 0, 'item': None,
            'heal': False, 'buff': None, 'teleport': False, 'curse': False}
    base.update(kw)
    return base


def test_mystery_outcome_jackpot_beats_its_own_rewards():
    # Roll 12 grants spores + xp + item, but reads as the jackpot face.
    assert mystery_outcome(_res(roll=12, spores=30, xp=10, item='random'),
                           {'item': 'mushroom_snack'}) == 'jackpot'


def test_mystery_outcome_gear_grimoire_item_priority():
    assert mystery_outcome(_res(roll=4, item='random'), {'gear': {'id': 'x'}}) == 'gear'
    assert mystery_outcome(_res(roll=4, item='random'), {'grimoire': 'g'}) == 'grimoire'
    assert mystery_outcome(_res(roll=6, item='random'), {'item': 'mushroom_snack'}) == 'item'


def test_mystery_outcome_status_flags():
    assert mystery_outcome(_res(roll=5, heal=True), {}) == 'heal'
    assert mystery_outcome(_res(roll=7, buff='rot_surge'), {}) == 'buff'
    assert mystery_outcome(_res(roll=11, curse=True), {}) == 'curse'
    assert mystery_outcome(_res(roll=10, teleport=True), {'to': 'n5'}) == 'warp'


def test_mystery_outcome_numeric_deltas():
    assert mystery_outcome(_res(roll=9, hpPct=-0.20), {}) == 'hurt'
    assert mystery_outcome(_res(roll=8, spores=-10), {}) == 'theft'
    assert mystery_outcome(_res(roll=1, spores=20), {}) == 'spores'
    assert mystery_outcome(_res(roll=2, xp=10), {}) == 'xp'


def test_mystery_outcome_defensive_fallback():
    assert mystery_outcome(_res(roll=3), {}) == 'mystery'
```

- [ ] **Step 2: Run tests to verify they fail**

Run:
```
cd infrastructure/lambda && python -m pytest tests/test_undercity_engine.py -k mystery_outcome -q -p no:randomly
```
Expected: FAIL — `ImportError: cannot import name 'mystery_outcome'`.

- [ ] **Step 3: Implement the helper**

In `undercity_engine.py`, add immediately after `roll_mystery` (after its `return out`, ~line 901):
```python
def mystery_outcome(res, out):
    """Canonical reel/UI outcome key for a resolved mystery roll.

    `res` is the raw roll dict from `roll_mystery`; `out` is the event dict the db
    layer built (it already carries any resolved 'gear'/'grimoire'/'item'/'to').
    Priority matters: the jackpot face wins over its own spores/xp/item, and a
    resolved treasure (gear > grimoire > consumable) is named specifically before
    the generic numeric-delta faces. Returns one of: jackpot, gear, grimoire,
    item, heal, buff, curse, warp, hurt, theft, spores, xp, mystery."""
    if res.get('roll') == 12:
        return 'jackpot'
    if out.get('gear'):
        return 'gear'
    if out.get('grimoire'):
        return 'grimoire'
    if out.get('item'):
        return 'item'
    if res.get('heal'):
        return 'heal'
    if res.get('buff'):
        return 'buff'
    if res.get('curse'):
        return 'curse'
    if res.get('teleport'):
        return 'warp'
    if res.get('hpPct', 0) < 0:
        return 'hurt'
    if res.get('spores', 0) < 0:
        return 'theft'
    if res.get('spores', 0) > 0:
        return 'spores'
    if res.get('xp', 0) > 0:
        return 'xp'
    return 'mystery'
```

- [ ] **Step 4: Run tests to verify they pass**

Run:
```
cd infrastructure/lambda && python -m pytest tests/test_undercity_engine.py -k mystery_outcome -q -p no:randomly
```
Expected: PASS (5 tests).

- [ ] **Step 5: Commit**

```bash
git add infrastructure/lambda/undercity_engine.py infrastructure/lambda/tests/test_undercity_engine.py
git commit -m "feat(undercity): add mystery_outcome helper for reel faces"
```

---

## Task 2: `_mystery` stamps the outcome on the event

**Files:**
- Modify: `infrastructure/lambda/undercity_db.py` (`_mystery`, the `out = {...}` construction ~line 3108 and the `return out` ~line 3133)
- Test: `infrastructure/lambda/tests/test_undercity_db.py`

- [ ] **Step 1: Write the failing test**

Append to `tests/test_undercity_db.py`:
```python
def test_mystery_event_always_carries_a_valid_outcome(table, monkeypatch):
    valid = {'jackpot', 'gear', 'grimoire', 'item', 'heal', 'buff', 'curse',
             'warp', 'hurt', 'theft', 'spores', 'xp', 'mystery'}
    node = _first_mystery_node()
    sid, doc = _player_at(table, node, spores=50)
    seen = set()
    for r in range(1, 13):
        # Force the d12 roll; _mystery calls engine.roll_mystery(db._rng, ...).
        monkeypatch.setattr(db._rng, 'randint', lambda a, b, _r=r: _r)
        ev = db._mystery(table, sid, doc)
        assert ev['type'] == 'mystery'
        assert ev.get('outcome') in valid, (r, ev.get('outcome'))
        seen.add(ev['outcome'])
    # Across the whole d12 we should see clearly more than one face.
    assert len(seen) >= 5
```
If `_first_mystery_node` / `_player_at` helpers do not already exist in this test
file, find the equivalent loot/space fixtures used by the existing loot-landing
tests (e.g. `_first_loot_node`) and mirror them: locate a node whose
`nodes[nid]['type'] == 'mystery'`. If no such helper pattern fits, place the
player on any node and call `db._mystery(table, sid, doc)` directly (it reads
`doc['position']` only to look up the biome, and tolerates a non-mystery node).

- [ ] **Step 2: Run to verify it fails**

Run:
```
cd infrastructure/lambda && python -m pytest tests/test_undercity_db.py -k mystery_event_always_carries -q -p no:randomly
```
Expected: FAIL — `assert None in valid` (no `outcome` field yet).

- [ ] **Step 3: Implement**

In `undercity_db.py#_mystery`, the event is built as:
```python
    out = {'type': 'mystery', 'roll': res['roll'], 'text': res['text']}
```
Leave that line as-is. Then, just before the final `return out` (~line 3133,
after the `_append_scroll(doc, out, 'mystery')` line), add:
```python
    out['outcome'] = engine.mystery_outcome(res, out)
```
This runs after the gear/grimoire/item and teleport resolution, so
`mystery_outcome` sees the fully-populated `out`.

- [ ] **Step 4: Run to verify it passes**

Run:
```
cd infrastructure/lambda && python -m pytest tests/test_undercity_db.py -k mystery_event_always_carries -q -p no:randomly
```
Expected: PASS.

- [ ] **Step 5: Guard against regressions in the mystery area**

Run:
```
cd infrastructure/lambda && python -m pytest tests/test_undercity_db.py -k mystery -q -p no:randomly
```
Expected: all selected tests pass (no pre-existing mystery test broke).

- [ ] **Step 6: Commit**

```bash
git add infrastructure/lambda/undercity_db.py infrastructure/lambda/tests/test_undercity_db.py
git commit -m "feat(undercity): stamp canonical outcome on mystery events"
```

---

## Task 3: Client model — `SpaceEvent.outcome`

**Files:**
- Modify: `src/app/undercity/services/undercity-models.ts` (`SpaceEvent`, near the other optional fields, ~line 575)

- [ ] **Step 1: Add the field**

In the `SpaceEvent` interface, add after the `roll?: number;` line:
```typescript
  /** Mystery-space canonical outcome (mirrors undercity_db._mystery →
   *  engine.mystery_outcome): drives which reel face the lottery machine lands
   *  on. One of jackpot|gear|grimoire|item|heal|buff|curse|warp|hurt|theft|
   *  spores|xp|mystery. */
  outcome?: string;
```

- [ ] **Step 2: Commit** (typecheck happens in Task 5's build)

```bash
git add src/app/undercity/services/undercity-models.ts
git commit -m "feat(undercity): add SpaceEvent.outcome for mystery reel"
```

---

## Task 4: Expand the reel face set

**Files:**
- Modify: `src/app/undercity/tabs/mystery-reel.component.ts` (`SYMBOLS`, ~line 19-26)

- [ ] **Step 1: Replace the `SYMBOLS` record**

Replace:
```typescript
const SYMBOLS: Record<string, Symbol> = {
  spores: { icon: 'grain', color: '#e0c069' },
  item: { icon: 'backpack', color: '#b79bff' },
  heal: { icon: 'favorite', color: '#7fce8f' },
  hurt: { icon: 'heart_broken', color: '#e07a7a' },
  warp: { icon: 'cyclone', color: '#4fc4bc' },
  mystery: { icon: 'help', color: '#c4a5ff' },
};
```
with:
```typescript
const SYMBOLS: Record<string, Symbol> = {
  spores: { icon: 'grain', color: '#e0c069' },
  xp: { icon: 'auto_awesome', color: '#8fd0ff' },
  item: { icon: 'backpack', color: '#b79bff' },
  gear: { icon: 'shield', color: '#9ec6ff' },
  grimoire: { icon: 'menu_book', color: '#c9a0ff' },
  heal: { icon: 'favorite', color: '#7fce8f' },
  buff: { icon: 'bolt', color: '#ffd24a' },
  theft: { icon: 'money_off', color: '#e0a24a' },
  hurt: { icon: 'heart_broken', color: '#e07a7a' },
  warp: { icon: 'cyclone', color: '#4fc4bc' },
  curse: { icon: 'dangerous', color: '#d47ad0' },
  jackpot: { icon: 'casino', color: '#ffe08a' },
  mystery: { icon: 'help', color: '#c4a5ff' },
};
```
No other change is needed in this component: `KEYS = Object.keys(SYMBOLS)` now
covers every face (so decoy spins show the full variety), and
`ngAfterViewInit` already falls back to `mystery` for any unknown `target`.

- [ ] **Step 2: Commit** (build verifies in Task 5)

```bash
git add src/app/undercity/tabs/mystery-reel.component.ts
git commit -m "feat(undercity): add a reel face per mystery outcome"
```

---

## Task 5: Trust `outcome` in `mysterySymbol` + build

**Files:**
- Modify: `src/app/undercity/tabs/board-tab.component.ts` (`mysterySymbol`, ~line 1525-1533)

> **NOTE — parallel WIP:** `board-tab.component.ts` has unrelated uncommitted
> edits in the working tree (gate-blessing feature). When committing, stage ONLY
> the `mysterySymbol` hunk (e.g. `git add -p`, or a targeted `git apply --cached`
> patch) so the unrelated WIP is left untouched. Do not `git add` the whole file.

- [ ] **Step 1: Replace the method body**

Replace:
```typescript
  /** Map a mystery outcome to a reel face so it lands on something meaningful. */
  private mysterySymbol(ev: SpaceEvent): string {
    if (ev.item) return 'item';
    if (ev.to) return 'warp';
    if ((ev.hp ?? 0) > 0) return 'heal';
    if ((ev.hp ?? 0) < 0 || ev.sporesLost) return 'hurt';
    if (ev.spores) return 'spores';
    return 'mystery';
  }
```
with:
```typescript
  /** Reel face for a mystery outcome. The server stamps a canonical `outcome`
   *  (undercity_db._mystery → engine.mystery_outcome); the reel component falls
   *  back to its own `mystery` face for any key it doesn't recognise. */
  private mysterySymbol(ev: SpaceEvent): string {
    return ev.outcome || 'mystery';
  }
```

- [ ] **Step 2: Build the frontend**

Run (repo root):
```
npm run build
```
Expected: build succeeds with no new TS/template errors (pre-existing warnings
about `GamesHeroComponent`, `aws-test`, `statistics`, `qrcode` are unrelated).

- [ ] **Step 3: Commit (stage only the mysterySymbol hunk)**

```bash
git add -p src/app/undercity/tabs/board-tab.component.ts   # stage ONLY the mysterySymbol change
git commit -m "feat(undercity): map mystery reel face from server outcome"
```
If `git add -p` is unavailable non-interactively, write the single hunk to a
patch file and `git apply --cached --recount <patch>`, then commit — verify with
`git diff --cached --stat` that only `mysterySymbol` is staged.

---

## Task 6: Full verification

- [ ] **Step 1: Server — this plan's tests pass**

Run:
```
cd infrastructure/lambda && python -m pytest tests/test_undercity_engine.py tests/test_undercity_db.py -k "mystery" -q -p no:randomly
```
Expected: all mystery-related tests pass.

- [ ] **Step 2: Frontend build green**

Run (repo root):
```
npm run build
```
Expected: success.

- [ ] **Step 3: Manual smoke (optional, live AWS backend)**

Per the `run-undercity` skill: `npm start`, land on mystery spaces repeatedly, and
confirm the reel lands on varied faces (grain / auto_awesome / shield / menu_book /
favorite / bolt / money_off / heart_broken / cyclone / dangerous / casino) rather
than always `help` (?).

- [ ] **Step 4: Note for the user**

Server changes require a `cdk deploy` (the user runs deploys). End with this
plan's tests + the build green and flag the deploy.

---

## Self-Review Notes

- **Spec coverage:** server `outcome` field → Tasks 1, 2; client model → Task 3;
  reel face set → Task 4; `mysterySymbol` rewrite → Task 5; testing → Tasks 1, 2,
  6. All spec sections covered.
- **Type consistency:** `mystery_outcome(res, out)` (engine), `out['outcome']`
  (db), `SpaceEvent.outcome` (client), `SYMBOLS` keys ↔ the outcome-key vocabulary
  — the same 13 keys (jackpot, gear, grimoire, item, heal, buff, curse, warp,
  hurt, theft, spores, xp, mystery) are used identically across all tasks.
- **No placeholders:** every code step shows full before/after.
- **Parallel-WIP hazard** called out in Task 5 so the engineer stages only their
  hunk of `board-tab.component.ts`.
