# Gate Pass-By Heal + Heal Visuals — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Passing *through* a gate during a move heals 50% of max HP (landing on one still heals 100%), committed only when the move commits, with a pending green sparkle during the walk and floating green `+N` numbers when the heal lands.

**Architecture:** The board client already walks the route node-by-node (`stepping().path`). It now sends that path with the `move` action; the server validates it as a legal walk (new `engine.validate_walk`) and, if a gate sits mid-route, applies the 50% heal server-side before resolving the landing space. The client shows a pending sparkle while a gate is on the walked path (recomputed each step, so retracing cancels it) and pops heal numbers from the `move` response.

**Tech Stack:** Python 3.11 Lambda (pytest, in-memory `FakeTable`), Angular 20 standalone components, a hand-rolled canvas engine (`board-canvas.ts`). No frontend test runner — client tasks verify with `npm run build`.

**Design spec:** [specs/2026-07-21-undercity-gate-pass-heal-design.md](2026-07-21-undercity-gate-pass-heal-design.md)

**Key facts discovered:**
- `GATE_NODE = 'city_r0'`, type `gate`, neighbors `['city_r1', 'city_r9']`; both neighbors are `loot` type. So `['city_r1','city_r0','city_r9']` is a legal 2-hop pass-through, and `['city_r1','city_r0']` is a legal 1-hop landing.
- All five `HOME_GATES` values are type `gate`.
- Config scalars are re-exported into `data` via `from undercity_config import *` in `undercity_data.py`. In `undercity_db.py` the name `config` is the **season-config dict**, so the new constant must be referenced as `data.GATE_PASS_HEAL_FRACTION`, never `config.`.
- `engine.regen_hp(doc, _now())` runs at dispatch (`undercity_db.py:1176`) before any handler, so `doc['hp']` is already current inside `_move`.
- `_ok(doc, **extra)` merges `extra` into the response dict (`undercity_db.py:1227`).
- `pm` stores `pm['value']` (the roll); a Pathfinder roll also stores `pm['values']` (two faces). Allowed hop counts = `set(pm.get('values') or [pm['value']])`.

---

## Task 1: `engine.validate_walk` (server route validation)

**Files:**
- Modify: `infrastructure/lambda/undercity_engine.py` (add after `legal_destinations`, ~line 547)
- Test: `infrastructure/lambda/tests/test_undercity_engine.py`

- [ ] **Step 1: Write the failing tests**

Add to `infrastructure/lambda/tests/test_undercity_engine.py` (it already imports `legal_destinations` from `undercity_engine` and `undercity_data as data` — add `validate_walk` to that import line):

```python
def test_validate_walk_legal_pass_through():
    # city_r1 -> city_r0 (gate) -> city_r9 is a legal 2-hop walk.
    assert validate_walk(data.MAP_NODES, ['city_r1', 'city_r0', 'city_r9'], {2})


def test_validate_walk_rejects_non_adjacent():
    # city_r1's neighbors are city_r0/city_r2 — city_r9 is not adjacent.
    assert not validate_walk(data.MAP_NODES, ['city_r1', 'city_r9'], {1})


def test_validate_walk_rejects_immediate_backtrack():
    assert not validate_walk(data.MAP_NODES, ['city_r1', 'city_r0', 'city_r1'], {2})


def test_validate_walk_rejects_wrong_length():
    assert not validate_walk(data.MAP_NODES, ['city_r1', 'city_r0', 'city_r9'], {3})


def test_validate_walk_rejects_unknown_node():
    assert not validate_walk(data.MAP_NODES, ['city_r1', 'nope'], {1})


def test_validate_walk_bonk_stops_short_at_closed_landing():
    # A synthetic line a-b-c-d where c is sealed: you may bonk and stop at c
    # short of a roll of 3, but never walk THROUGH c to d.
    nodes = {
        'a': {'neighbors': ['b'], 'type': 'loot'},
        'b': {'neighbors': ['a', 'c'], 'type': 'loot'},
        'c': {'neighbors': ['b', 'd'], 'type': 'barrier'},
        'd': {'neighbors': ['c'], 'type': 'loot'},
    }
    closed = frozenset({'c'})
    assert validate_walk(nodes, ['a', 'b', 'c'], {3}, closed)      # bonk stop, hops < roll
    assert not validate_walk(nodes, ['a', 'b', 'c', 'd'], {3}, closed)  # through a seal


def test_validate_walk_rejects_stepping_onto_blocked():
    nodes = {
        'a': {'neighbors': ['b'], 'type': 'loot'},
        'b': {'neighbors': ['a', 'c'], 'type': 'tunnel'},
        'c': {'neighbors': ['b'], 'type': 'loot'},
    }
    assert not validate_walk(nodes, ['a', 'b', 'c'], {2}, frozenset(), frozenset({'b'}))
```

- [ ] **Step 2: Run the tests to verify they fail**

Run: `cd infrastructure/lambda && python -m pytest tests/test_undercity_engine.py -k validate_walk -q`
Expected: FAIL — `NameError` / `ImportError` for `validate_walk`.

- [ ] **Step 3: Implement `validate_walk`**

In `infrastructure/lambda/undercity_engine.py`, add immediately after `legal_destinations` (before `board_distance`):

```python
def validate_walk(nodes: dict, path, steps,
                  closed: frozenset = frozenset(),
                  blocked: frozenset = frozenset()) -> bool:
    """
    True if `path` (ordered node ids, start first, landing last) is a legal
    exact-count walk for one of the allowed hop counts in `steps`.

    Enforces the same rules as legal_destinations: adjacency, no immediate
    backtrack, never step ONTO a `blocked` node, never walk THROUGH a sealed
    `closed` node (a closed node may only be the final landing — the bonk stop).
    A walk whose landing is a closed barrier may stop short of the roll (bonk);
    otherwise the hop count must equal one of `steps` exactly. The start node is
    never treated as blocked or closed, mirroring legal_destinations.
    """
    steps = set(steps)
    if not steps or not path or len(path) < 2:
        return False
    if any(n not in nodes for n in path):
        return False
    hops = len(path) - 1
    if path[-1] in closed:
        if hops < 1 or hops > max(steps):   # bonk: stop at the wall, spend the rest
            return False
    elif hops not in steps:
        return False
    for i in range(1, len(path)):
        cur, prev = path[i], path[i - 1]
        if cur not in nodes[prev]['neighbors']:
            return False                    # not adjacent
        if i >= 2 and cur == path[i - 2]:
            return False                    # immediate backtrack
        if cur in blocked:
            return False                    # never step onto a blocked node
        if cur in closed and i != len(path) - 1:
            return False                    # never a corridor through a seal
    return True
```

- [ ] **Step 4: Run the tests to verify they pass**

Run: `cd infrastructure/lambda && python -m pytest tests/test_undercity_engine.py -k validate_walk -q`
Expected: PASS (7 tests).

- [ ] **Step 5: Commit**

```bash
git add infrastructure/lambda/undercity_engine.py infrastructure/lambda/tests/test_undercity_engine.py
git commit -m "feat(undercity): engine.validate_walk for server-side route validation"
```

---

## Task 2: Server heal in `_move` + config + gate-land amount

**Files:**
- Modify: `infrastructure/lambda/undercity_config.py` (add constant near the HP knobs, ~line 41)
- Modify: `infrastructure/lambda/undercity_db.py` — `_resolve_space` gate branch (~line 2028) and `_move` (~line 1868)
- Test: `infrastructure/lambda/tests/test_undercity_db.py`

- [ ] **Step 1: Write the failing tests**

Add to `infrastructure/lambda/tests/test_undercity_db.py`. These craft a `pendingMove` directly (bypassing the random roll) so the walk is deterministic. Helper + tests:

```python
def _prime_move(table, position, value, dests, hp=None):
    """Put user-alex at `position` with a hand-made pendingMove so a specific
    walk can be exercised deterministically."""
    sid = _sid(table)
    doc = db._get_player(table, sid, 'user-alex')
    doc['position'] = position
    doc['pendingMove'] = {'value': value, 'dests': list(dests)}
    if hp is not None:
        doc['hp'] = hp
    db._put_player(table, doc)
    return doc


def test_pass_through_gate_heals_half(table):
    act(table, 'join', starter='saproling', home='cavern')
    doc = _prime_move(table, 'city_r1', 2, ['city_r9'], hp=1)
    max_hp = engine.effective_stats(doc)['maxHp']
    status, resp = act(table, 'move', to='city_r9',
                       path=['city_r1', 'city_r0', 'city_r9'])
    assert status == 200, resp
    assert resp['heal'] == {'amount': round(0.5 * max_hp), 'hp': 1 + round(0.5 * max_hp),
                            'kind': 'gate_pass'}
    assert resp['you']['hp'] == 1 + round(0.5 * max_hp)


def test_pass_through_gate_caps_at_max(table):
    act(table, 'join', starter='saproling', home='cavern')
    doc = _prime_move(table, 'city_r1', 2, ['city_r9'])  # hp already full
    max_hp = engine.effective_stats(doc)['maxHp']
    status, resp = act(table, 'move', to='city_r9',
                       path=['city_r1', 'city_r0', 'city_r9'])
    assert status == 200, resp
    assert resp['heal'] is None            # already full → no heal, no number
    assert resp['you']['hp'] == max_hp


def test_landing_on_gate_heals_full(table):
    act(table, 'join', starter='saproling', home='cavern')
    doc = _prime_move(table, 'city_r1', 1, ['city_r0'], hp=1)
    max_hp = engine.effective_stats(doc)['maxHp']
    status, resp = act(table, 'move', to='city_r0', path=['city_r1', 'city_r0'])
    assert status == 200, resp
    assert resp['heal'] == {'amount': max_hp - 1, 'hp': max_hp, 'kind': 'gate_land'}
    assert resp['you']['hp'] == max_hp


def test_start_on_gate_does_not_heal(table):
    act(table, 'join', starter='saproling', home='cavern')
    _prime_move(table, 'city_r0', 1, ['city_r1'], hp=5)
    status, resp = act(table, 'move', to='city_r1', path=['city_r0', 'city_r1'])
    assert status == 200, resp
    assert resp['heal'] is None
    assert resp['you']['hp'] == 5


def test_illegal_path_rejected(table):
    act(table, 'join', starter='saproling', home='cavern')
    _prime_move(table, 'city_r1', 2, ['city_r9'], hp=1)
    # Non-adjacent jump city_r1 -> city_r9.
    status, resp = act(table, 'move', to='city_r9', path=['city_r1', 'city_r9'])
    assert status == 409, resp


def test_move_without_path_still_works(table):
    # Stale client that never sends `path`: destination-only behavior, no heal.
    act(table, 'join', starter='saproling', home='cavern')
    _prime_move(table, 'city_r1', 2, ['city_r9'], hp=1)
    status, resp = act(table, 'move', to='city_r9')
    assert status == 200, resp
    assert resp.get('heal') is None
    assert resp['you']['hp'] == 1        # no pass-heal without a path
```

- [ ] **Step 2: Run the tests to verify they fail**

Run: `cd infrastructure/lambda && python -m pytest tests/test_undercity_db.py -k "gate or illegal_path or without_path" -q`
Expected: FAIL — no `heal` key in response / heal semantics not implemented.

- [ ] **Step 3: Add the config constant**

In `infrastructure/lambda/undercity_config.py`, add near the HP knobs (after `HP_REGEN_INTERVAL_MIN`, ~line 42):

```python
GATE_PASS_HEAL_FRACTION = 0.5   # fraction of max HP restored for passing THROUGH a gate (landing still full-heals)
```

- [ ] **Step 4: Report the heal amount from the gate-landing branch**

In `infrastructure/lambda/undercity_db.py`, replace the gate branch in `_resolve_space` (currently ~line 2028):

```python
    if ntype == 'gate':
        doc['hp'] = engine.effective_stats(doc)['maxHp']
        doc['hpUpdatedAt'] = _now()
        return {'type': 'gate', 'text': 'The Gate of the Swarm mends you fully.'}
```

with:

```python
    if ntype == 'gate':
        max_hp = engine.effective_stats(doc)['maxHp']
        healed = max(0, max_hp - int(doc['hp']))
        doc['hp'] = max_hp
        doc['hpUpdatedAt'] = _now()
        return {'type': 'gate', 'text': 'The Gate of the Swarm mends you fully.',
                'healed': healed}
```

- [ ] **Step 5: Add path validation + pass-heal to `_move`**

In `infrastructure/lambda/undercity_db.py`, replace `_move` (currently lines 1868–1888):

```python
def _move(table, sid, doc, payload):
    pm = doc.get('pendingMove')
    to = payload.get('to')
    if not pm:
        return _err('Roll first.', 409)
    if to not in pm['dests']:
        return _err('That space is not reachable with this roll.', 409)

    prev = doc['position']
    nodes = _season_map(table, sid)
    heal = None

    # Server-authoritative route: the client walks node-by-node and sends the
    # path it took. Validate it, then heal for passing THROUGH a gate (landing
    # on one still full-heals in _resolve_space below). A stale client that
    # omits `path` keeps the old destination-only behavior — no pass-heal.
    path = payload.get('path')
    if path is not None:
        allowed = set(pm.get('values') or [pm['value']])
        closed = _closed_barriers(table, sid)
        blocked = _blocked_nodes(doc)
        if (not path or path[0] != prev or path[-1] != to
                or not engine.validate_walk(nodes, path, allowed, closed, blocked)):
            return _err('That route is not a legal walk.', 409)
        passed_gate = any(nodes[n]['type'] == 'gate' for n in path[1:-1])
        if passed_gate and nodes[to]['type'] != 'gate':
            max_hp = engine.effective_stats(doc)['maxHp']
            amount = min(round(data.GATE_PASS_HEAL_FRACTION * max_hp),
                         max_hp - int(doc['hp']))
            if amount > 0:
                doc['hp'] = int(doc['hp']) + amount
                doc['hpUpdatedAt'] = _now()
                heal = {'amount': amount, 'hp': doc['hp'], 'kind': 'gate_pass'}

    doc['pendingMove'] = None
    doc['position'] = to

    space_event = _resolve_space(table, sid, doc, to, prev)

    # Landing on a gate full-heals inside _resolve_space; surface the amount so
    # the client floats heal numbers for it too (supersedes any pass-heal).
    if space_event.get('type') == 'gate':
        healed = space_event.get('healed', 0)
        heal = {'amount': healed, 'hp': doc['hp'], 'kind': 'gate_land'} if healed else None

    conflict = _save_or_conflict(table, doc)
    if conflict:
        return conflict

    # _resolve_space may relocate the unit (tunnel crossing, wild warp) — report
    # occupants of where it actually ended up, not the pre-resolution target.
    occupants = _occupants(table, sid, doc['position'], doc['userId'])
    return _ok(doc, spaceEvent=space_event, occupants=occupants, heal=heal)
```

- [ ] **Step 6: Run the new tests to verify they pass**

Run: `cd infrastructure/lambda && python -m pytest tests/test_undercity_db.py -k "gate or illegal_path or without_path" -q`
Expected: PASS.

- [ ] **Step 7: Run the full backend suite (no regressions)**

Run: `cd infrastructure/lambda && python -m pytest tests -q`
Expected: all pass. (Note: `test_full_join_roll_move_flow` calls `move` without a `path` — the stale-client fallback keeps it green.)

- [ ] **Step 8: Commit**

```bash
git add infrastructure/lambda/undercity_config.py infrastructure/lambda/undercity_db.py infrastructure/lambda/tests/test_undercity_db.py
git commit -m "feat(undercity): 50% heal for passing through a gate, 100% on landing"
```

---

## Task 3: Client — send path, pending sparkle, pop heal numbers

**Files:**
- Modify: `src/app/undercity/services/undercity-models.ts` (`ActionResponse`, ~line 502)
- Modify: `src/app/undercity/tabs/board-tab.component.ts` (`move()` ~line 973, `syncBoard()` ~line 916)

> Canvas methods `setSelfHealPending` / `popHealNumber` are added in Task 4. Build this task and Task 4 before running `npm run build`, or stub the two calls — they are wired here but only exist after Task 4. Recommended: implement Task 4 first, then this task, then build once.

- [ ] **Step 1: Add the `heal` field to `ActionResponse`**

In `src/app/undercity/services/undercity-models.ts`, inside `interface ActionResponse` (after `occupants?: Occupant[];`, ~line 517):

```typescript
  /** A gate heal from the last move: passing through (50%) or landing (100%). */
  heal?: { amount: number; hp: number; kind: 'gate_pass' | 'gate_land' } | null;
```

- [ ] **Step 2: Send the walked path and pop heal numbers on the response**

In `src/app/undercity/tabs/board-tab.component.ts`, replace the body of `move()` (lines 973–986):

```typescript
  private async move(to: string): Promise<void> {
    const preHp = this.store.you()?.hp ?? 0;
    const path = this.stepping()?.path;
    await this.run(async () => {
      const resp = await this.store.action('move', { to, path });
      if (resp.you) this.board?.centerOn(resp.you.position);
      if (resp.heal) this.board?.popHealNumber(this.store.ownUserId, resp.heal.amount);
      const ev = resp.spaceEvent;
      this.occupants.set(resp.occupants ?? []);
      if (!ev) return;
      this.routeSpaceEvent(ev, preHp);
    });
    // A failed move leaves pendingMove intact server-side — reset the local
    // walk so the effect restarts it from the real position with a full count.
    if (this.store.you()?.pendingMove) this.stepping.set(null);
  }
```

- [ ] **Step 3: Drive the pending sparkle from the walked path in `syncBoard()`**

In `src/app/undercity/tabs/board-tab.component.ts`, in `syncBoard()`, right after the `const step = this.stepping();` line (~line 918) add:

```typescript
    // Sparkle promise: lit whenever the route walked so far touches a gate
    // (recomputed each step, so retracing off the gate clears it). The starting
    // space (path[0]) doesn't count — only spaces stepped onto.
    const willHeal =
      !!step &&
      step.path
        .slice(1)
        .some((id) => this.map.nodes.find((n) => n.id === id)?.type === 'gate');
    this.board.setSelfHealPending(willHeal);
```

(Placement note: it must run whenever `syncBoard` runs and `this.board` is set — `syncBoard` already early-returns if `!this.board`, so this is safe.)

- [ ] **Step 4: Build (after Task 4 is in place)**

Run: `npm run build`
Expected: build succeeds with no TypeScript errors. (Do NOT run `npm run lint` — repo lint is known-broken; the build is the source of truth.)

- [ ] **Step 5: Commit**

```bash
git add src/app/undercity/services/undercity-models.ts src/app/undercity/tabs/board-tab.component.ts
git commit -m "feat(undercity): board client sends walk path, shows pending gate-heal sparkle + numbers"
```

---

## Task 4: Canvas — sparkle aura + floating heal numbers

**Files:**
- Modify: `src/app/undercity/engine/board-canvas.ts`

- [ ] **Step 1: Add particle interfaces + state fields**

In `src/app/undercity/engine/board-canvas.ts`, after the `DustMote` interface (~line 227) add:

```typescript
/** Green twinkle around a token that's promised a gate heal (world space). */
interface Sparkle {
  x: number;
  y: number;
  vy: number;
  life: number;
  maxLife: number;
  size: number;
}

/** Floating "+N" heal number that rises and fades off a token (world space). */
interface HealNumber {
  x: number;
  y: number;
  life: number;
  maxLife: number;
  text: string;
}
```

Then near the existing `private dust: DustMote[] = [];` (~line 296) add:

```typescript
  private sparkles: Sparkle[] = [];
  private heals: HealNumber[] = [];
  private healPending = false;
  private sparkleAccum = 0; // time since last sparkle emission
  private pendingHealPops: { userId: string; amount: number }[] = [];
```

- [ ] **Step 2: Add the public API methods**

Add these methods near the other setters (e.g. after `setStepDie`, ~line 674):

```typescript
  /** Lit while the walk-so-far will heal at a gate — draws a green sparkle
   *  aura on your own token until the move commits (or you retrace off it). */
  setSelfHealPending(on: boolean): void {
    this.healPending = on;
  }

  /** Pop a green "+amount" number off a token (fired when a gate heal lands). */
  popHealNumber(userId: string, amount: number): void {
    if (amount > 0) this.pendingHealPops.push({ userId, amount });
  }
```

- [ ] **Step 3: Add spawn/update/draw for both particle systems**

Add after `drawDust()` (~line 1593):

```typescript
  private spawnSparkle(x: number, y: number): void {
    const ttl = 0.5 + Math.random() * 0.4;
    this.sparkles.push({
      x: x + (Math.random() - 0.5) * 34,
      y: y - Math.random() * 30,
      vy: -10 - Math.random() * 12,
      life: ttl,
      maxLife: ttl,
      size: 1.5 + Math.random() * 2,
    });
  }

  private spawnHealNumber(x: number, y: number, amount: number): void {
    this.heals.push({ x, y, life: 1.1, maxLife: 1.1, text: `+${amount}` });
  }

  private updateHealFx(dt: number): void {
    // Emit sparkles around the own token while a heal is promised.
    if (this.healPending) {
      this.sparkleAccum += dt;
      const own = this.tokenAnims.get(this.ownUserId);
      while (this.sparkleAccum > 0.06) {
        this.sparkleAccum -= 0.06;
        if (own) this.spawnSparkle(own.x, own.y);
      }
    } else {
      this.sparkleAccum = 0;
    }
    for (let i = this.sparkles.length - 1; i >= 0; i--) {
      const s = this.sparkles[i];
      s.life -= dt;
      if (s.life <= 0) {
        this.sparkles.splice(i, 1);
        continue;
      }
      s.y += s.vy * dt;
    }
    for (let i = this.heals.length - 1; i >= 0; i--) {
      const h = this.heals[i];
      h.life -= dt;
      if (h.life <= 0) {
        this.heals.splice(i, 1);
        continue;
      }
      h.y -= 34 * dt; // float upward
    }
  }

  private drawSparkles(): void {
    const ctx = this.ctx;
    for (const s of this.sparkles) {
      const a = s.life / s.maxLife;
      ctx.save();
      ctx.globalAlpha = Math.sin(a * Math.PI) * 0.9; // twinkle in and out
      ctx.fillStyle = '#8fe6a0';
      ctx.shadowColor = '#4fd08a';
      ctx.shadowBlur = 6;
      ctx.beginPath();
      ctx.arc(s.x, s.y, s.size, 0, Math.PI * 2);
      ctx.fill();
      ctx.restore();
    }
  }

  private drawHealNumbers(): void {
    const ctx = this.ctx;
    for (const h of this.heals) {
      const a = Math.min(1, h.life / (h.maxLife * 0.5)); // hold, then fade
      ctx.save();
      ctx.globalAlpha = a;
      ctx.font = 'bold 20px system-ui, sans-serif';
      ctx.textAlign = 'center';
      ctx.lineWidth = 3;
      ctx.strokeStyle = 'rgba(0,0,0,0.65)';
      ctx.fillStyle = '#7fe6a0';
      ctx.strokeText(h.text, h.x, h.y);
      ctx.fillText(h.text, h.x, h.y);
      ctx.restore();
    }
  }
```

> Note: `this.tokenAnims.get(this.ownUserId)` gives the eased world position of the own token (`{ x, y, ... }`), which is the same structure `tokenPos` returns — used here to anchor the sparkle without re-deriving node coordinates.

- [ ] **Step 4: Wire updates and draws into the render loop**

In `draw()`, after `this.updateDust(dt);` (~line 938) add:

```typescript
    this.updateHealFx(dt);
```

Immediately after `this.drawDust();` (~line 1035, sparkles sit under the tokens with the dust) add:

```typescript
    this.drawSparkles();
```

Spawn queued heal numbers once token positions are known. Right after the `placed.sort(...)` line and its two token/label draw loops (~line 1040, after `for (const t of placed) this.drawLabel(...)`) add:

```typescript
    // Pop any queued heal numbers at their token's current position.
    if (this.pendingHealPops.length) {
      for (const t of placed) {
        const idx = this.pendingHealPops.findIndex((h) => h.userId === t.p.userId);
        if (idx < 0) continue;
        const targetH = this.tokenHeight(t.p.userId === this.ownUserId) * formSprite(t.p.form).scale;
        this.spawnHealNumber(t.x, t.y - targetH + t.hopY, this.pendingHealPops[idx].amount);
        this.pendingHealPops.splice(idx, 1);
      }
    }
```

Draw the numbers on top of everything token-related. Just before `this.drawInfo();` (~line 1069) add:

```typescript
    this.drawHealNumbers();
```

- [ ] **Step 5: Build**

Run: `npm run build`
Expected: build succeeds, no TypeScript errors.

- [ ] **Step 6: Commit**

```bash
git add src/app/undercity/engine/board-canvas.ts
git commit -m "feat(undercity): canvas gate-heal sparkle aura + floating heal numbers"
```

---

## Final verification

- [ ] **Backend suite green:** `cd infrastructure/lambda && python -m pytest tests -q` — all pass.
- [ ] **Frontend builds:** `npm run build` — succeeds.
- [ ] **Manual smoke (optional, via `/run` or dev server):** roll so the route passes `city_r0`; confirm a green sparkle rides the token mid-walk, it clears if you retrace off the gate, and on commit `+N` green numbers pop and HP rises by ~50%. Land directly on a gate → full heal with `+N` numbers.

**Deploy note:** the balance/rules change is server-side (Lambda). Per project convention, the user runs `cdk deploy` themselves — end with tests green and flag that a deploy is needed for the backend change to go live.

## Self-review notes (author)

- **Spec coverage:** pass-heal 50% (T2), land 100% + amount (T2), server-authoritative path validation (T1+T2), Pathfinder two-value length rule (T2 `allowed`), stale-client fallback (T2), pending sparkle + retrace-cancel (T3), floating green numbers for both heals (T3+T4), reuse of DustMote pattern (T4), tests incl. no-double via `nodes[to]['type'] != 'gate'` guard + start-on-gate + illegal path (T2). All covered.
- **Type consistency:** response field `heal: {amount, hp, kind}` identical in `undercity_db._move`, `ActionResponse`, and `board-tab.move()`. Canvas methods `setSelfHealPending(boolean)` / `popHealNumber(userId, amount)` match their call sites in `board-tab`.
- **No-placeholder:** every code step is complete and runnable.
