# High Five Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Let a player high-five another creature on their board space — playing a "ready → jump → clap" animation, notifying the recipient, and granting them a +1/+1/+1 one-battle buff.

**Architecture:** Server-authoritative, closely mirroring the existing `poke` social action. A new `high_five` one-battle buff rides the existing `ONE_BATTLE_BUFFS` / `_apply_buff` / `effective_stats` machinery. A new `_high_five` action validates same-space + a per-target cooldown, applies the buff to the target, and pushes a `high_five` away-event. The client adds an occupants-strip button, a notification hook, a status chip, and a canvas animation that folds onto `drawToken`'s existing render params.

**Tech Stack:** Python 3.11 Lambda (pytest), Angular 20 standalone components, HTML5 canvas.

**Design:** [specs/2026-07-23-undercity-high-five-design.md](2026-07-23-undercity-high-five-design.md)

**Verification note:** This repo has no Angular test runner and a broken lint — verify frontend tasks with `npm run build` (dev build to `docs/`), not `npm run lint`. Backend tasks use pytest from `infrastructure/lambda`.

---

### Task 1: `high_five` buff stat effect + one-battle registration + config knob

**Files:**
- Modify: `infrastructure/lambda/undercity_engine.py` (`effective_stats`, ~line 736)
- Modify: `infrastructure/lambda/undercity_db.py` (`ONE_BATTLE_BUFFS`, line 709)
- Modify: `infrastructure/lambda/undercity_config.py` (after line 31)
- Test: `infrastructure/lambda/tests/test_undercity_db.py`

- [ ] **Step 1: Write the failing tests**

Append to `infrastructure/lambda/tests/test_undercity_db.py`:

```python
def test_high_five_buff_adds_one_to_three_stats():
    doc = {'atk': 5, 'def': 4, 'spd': 3, 'maxHp': 20, 'gear': {},
           'buffs': [{'kind': 'high_five'}]}
    eff = engine.effective_stats(doc)
    base = engine.effective_stats({**doc, 'buffs': []})
    assert eff['atk'] - base['atk'] == 1
    assert eff['def'] - base['def'] == 1
    assert eff['spd'] - base['spd'] == 1


def test_high_five_is_consumed_after_one_battle():
    doc = {'buffs': [{'kind': 'high_five'}, {'kind': 'cursed_idol'}]}
    db._consume_one_battle_buffs(doc)
    kinds = [b['kind'] for b in doc['buffs']]
    assert 'high_five' not in kinds
    assert 'cursed_idol' in kinds  # timed curse survives; only one-battle buffs clear
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `cd infrastructure/lambda && python -m pytest tests/test_undercity_db.py::test_high_five_buff_adds_one_to_three_stats tests/test_undercity_db.py::test_high_five_is_consumed_after_one_battle -v`
Expected: FAIL — the `high_five` kind is unhandled, so the delta is 0/0/0 and it is not consumed.

- [ ] **Step 3: Add the config knob**

In `infrastructure/lambda/undercity_config.py`, directly after the `POKE_COOLDOWN_MIN` line (line 31), add:

```python
HIGH_FIVE_COOLDOWN_MIN = 30  # a player can re-high-five the SAME creature only every N min
```

- [ ] **Step 4: Add the effective_stats branch**

In `infrastructure/lambda/undercity_engine.py`, inside the buff loop in `effective_stats`, after the `rust_curse` branch (line 737) and before the closing of the `for` loop, add:

```python
        elif kind == 'high_five':
            eff['atk'] += 1 * mult
            eff['def'] += 1 * mult
            eff['spd'] += 1 * mult
```

- [ ] **Step 5: Register the buff as one-battle**

In `infrastructure/lambda/undercity_db.py`, extend `ONE_BATTLE_BUFFS` (line 709) to include `'high_five'`:

```python
ONE_BATTLE_BUFFS = ('rot_surge', 'acorn_fury', 'bone_chill', 'glowveil', 'harden_shell',
                    'weaken_hex', 'savage_roar', 'iron_hide', 'fleetfoot', 'warding_dance',
                    'sap_vigor', 'rust_curse', 'high_five')
```

- [ ] **Step 6: Run tests to verify they pass**

Run: `cd infrastructure/lambda && python -m pytest tests/test_undercity_db.py::test_high_five_buff_adds_one_to_three_stats tests/test_undercity_db.py::test_high_five_is_consumed_after_one_battle -v`
Expected: PASS

- [ ] **Step 7: Commit**

```bash
git add infrastructure/lambda/undercity_engine.py infrastructure/lambda/undercity_db.py infrastructure/lambda/undercity_config.py infrastructure/lambda/tests/test_undercity_db.py
git commit -m "feat(undercity): high_five one-battle buff (+1 ATK/DEF/SPD)"
```

---

### Task 2: `_high_five` action (same-space + cooldown + notify)

**Files:**
- Modify: `infrastructure/lambda/undercity_db.py` (add `_high_five` after `_poke` ~line 5333; dispatcher line 1476; new-player seed line 1935; `_prune_cooldowns` lines 725-730)
- Test: `infrastructure/lambda/tests/test_undercity_db.py`

- [ ] **Step 1: Write the failing tests**

Append to `infrastructure/lambda/tests/test_undercity_db.py`:

```python
def test_high_five_grants_buff_same_space(table):
    act(table, 'join', starter='pest')                      # user-alex
    act(table, 'join', user='user-sam', name='Sam', starter='zombie')
    sid = _sid(table)
    # Put both creatures on the same node.
    alex = db._get_player(table, sid, 'user-alex')
    sam = db._get_player(table, sid, 'user-sam')
    sam['position'] = alex['position']
    db._put_player(table, sam)
    status, resp = act(table, 'high-five', targetUserId='user-sam')
    assert status == 200
    sam = db._get_player(table, sid, 'user-sam')
    assert any(b['kind'] == 'high_five' for b in sam['buffs'])
    assert any(e['kind'] == 'high_five' and e['fromId'] == 'user-alex'
               for e in sam['awayEvents'])


def test_high_five_off_space_rejected(table):
    act(table, 'join', starter='pest')
    act(table, 'join', user='user-sam', name='Sam', starter='zombie')
    sid = _sid(table)
    alex = db._get_player(table, sid, 'user-alex')
    sam = db._get_player(table, sid, 'user-sam')
    # Force them onto different nodes (join can co-locate at the hub).
    others = [n['id'] for n in db._nodes(table, sid).values()
              if n['id'] != alex['position']] if False else None
    sam['position'] = 'NOWHERE'
    db._put_player(table, sam)
    status, resp = act(table, 'high-five', targetUserId='user-sam')
    assert status == 400
    assert 'space' in resp['error']


def test_high_five_same_target_on_cooldown(table):
    act(table, 'join', starter='pest')
    act(table, 'join', user='user-sam', name='Sam', starter='zombie')
    sid = _sid(table)
    alex = db._get_player(table, sid, 'user-alex')
    sam = db._get_player(table, sid, 'user-sam')
    sam['position'] = alex['position']
    db._put_player(table, sam)
    status, _ = act(table, 'high-five', targetUserId='user-sam')
    assert status == 200
    status, resp = act(table, 'high-five', targetUserId='user-sam')
    assert status == 429
    assert 'min left' in resp['error']
```

Note: `test_high_five_off_space_rejected` sets a bogus position `'NOWHERE'` — the same-space guard only compares equality to the giver's node, so any different value exercises the reject path without needing the node graph.

- [ ] **Step 2: Run tests to verify they fail**

Run: `cd infrastructure/lambda && python -m pytest tests/test_undercity_db.py -k high_five_grants or high_five_off or high_five_same_target -v`
Expected: FAIL — `high-five` is not a registered action (dispatcher returns an unknown-action error).

- [ ] **Step 3: Add the `_high_five` handler**

In `infrastructure/lambda/undercity_db.py`, immediately after `_poke` ends (after line 5333), add:

```python
def _high_five(table, sid, doc, payload):
    target_id = payload.get('targetUserId')
    if not target_id or target_id == doc['userId']:
        return _err('High-five someone else.')
    target = _get_player(table, sid, target_id)
    if not target:
        return _err('Target not found.', 404)
    # Same-space only: you high-five someone you're passing on the board.
    if target.get('position') != doc.get('position'):
        return _err('You can only high-five someone on your space.')
    # Per-target cooldown: can't re-high-five the same creature until it expires.
    cds = doc.get('highFiveCooldowns') or {}
    until = cds.get(target_id)
    if until and until > _now():
        wait = int((datetime.fromisoformat(until) - datetime.utcnow()).total_seconds() // 60) + 1
        return _err(f'You already high-fived {target["username"]} — {wait} min left.', 429)
    # Gift the recipient a one-battle +1/+1/+1 buff (refresh-don't-stack).
    _apply_buff(target, 'high_five')
    _push_away_event(target, {'kind': 'high_five', 'from': doc['username'],
                              'fromId': doc['userId'], 'at': _now()})
    if not _put_player(table, target):
        return _err('The crowd jostles — try again.', 409)
    cds[target_id] = (datetime.utcnow() + timedelta(minutes=data.HIGH_FIVE_COOLDOWN_MIN)).isoformat(timespec='seconds')
    doc['highFiveCooldowns'] = cds
    _put_player(table, doc)
    _event(table, sid, 'high-five',
           f"{doc['username']} high-fived {target['username']}'s {_creature_label(target)}",
           actor=doc['userId'])
    return _ok(doc)
```

- [ ] **Step 4: Register the action in the dispatcher**

In `infrastructure/lambda/undercity_db.py`, in the action map (line 1476), add the `high-five` entry next to `poke`:

```python
        'gamble': _gamble, 'poke': _poke, 'high-five': _high_five, 'customize': _customize,
```

- [ ] **Step 5: Seed + prune the cooldown map**

In the new-player doc seed (line 1935), add `highFiveCooldowns` next to `pokeCooldowns`:

```python
        'spellCooldowns': {}, 'pokeCooldowns': {}, 'highFiveCooldowns': {}, 'awayEvents': [],
```

In `_prune_cooldowns` (lines 725-730), after the `pokeCooldowns` prune, add:

```python
    hfcds = doc.get('highFiveCooldowns') or {}
    doc['highFiveCooldowns'] = {k: v for k, v in hfcds.items() if v > now}
```

- [ ] **Step 6: Run tests to verify they pass**

Run: `cd infrastructure/lambda && python -m pytest tests/test_undercity_db.py -k "high_five_grants or high_five_off or high_five_same_target" -v`
Expected: PASS

- [ ] **Step 7: Run the full backend suite (no regressions)**

Run: `cd infrastructure/lambda && python -m pytest tests -q`
Expected: all pass.

- [ ] **Step 8: Commit**

```bash
git add infrastructure/lambda/undercity_db.py infrastructure/lambda/tests/test_undercity_db.py
git commit -m "feat(undercity): high-five action (same-space, cooldown, notify)"
```

---

### Task 3: Client — AwayEvent variant + recipient notification

**Files:**
- Modify: `src/app/undercity/services/undercity-models.ts` (`AwayEvent` union, lines 63-87)
- Modify: `src/app/undercity/tabs/board-tab.component.ts` (`awayText` ~line 1063, `awayIcon` ~line 1097, `playHitFx` line 546)

- [ ] **Step 1: Add the `high_five` AwayEvent variant**

In `src/app/undercity/services/undercity-models.ts`, add a variant to the `AwayEvent` union (before the closing `market` line 87):

```typescript
  | { kind: 'high_five'; from: string; fromId: string; at: string }
  | { kind: 'market'; text: string; at: string };
```

(Replace the existing final `| { kind: 'market'; ... }` line so the union ends cleanly with `market`.)

- [ ] **Step 2: Add the notification text**

In `src/app/undercity/tabs/board-tab.component.ts` `awayText` (the `switch (e.kind)` starting line 1064), add a case before `case 'market':`:

```typescript
      case 'high_five':
        return `${e.from} high-fived you — +1 to all stats next fight!`;
```

- [ ] **Step 3: Add the notification icon**

In `awayIcon` (the `switch (e.kind)` starting line 1098), add a case before `case 'market':`:

```typescript
      case 'high_five':
        return 'back_hand';
```

- [ ] **Step 4: Replay the animation for the recipient**

In `playHitFx` (line 546), extend the body so a fresh `high_five` event replays the clap when the giver is co-located, else a solo sparkle burst:

```typescript
  /** Flash your own token when a spell landed on you (an away-note arrived). */
  private playHitFx(e: AwayEvent): void {
    const me = this.store.you()?.userId;
    if (!me || !this.board) return;
    if (e.kind === 'spell_hit') this.board.playSpellHit({ targetId: me, dmg: e.dmg });
    else if (e.kind === 'spell_dodged') this.board.playSpellHit({ targetId: me, dodged: true });
    else if (e.kind === 'high_five') {
      const myPos = this.store.you()?.position;
      const giver = this.store.players().find((p) => p.userId === e.fromId);
      if (giver && giver.position === myPos) this.board.playHighFive(e.fromId, me);
      else this.board.burstBuff('#ffd76a', '#f2a900');
    }
  }
```

- [ ] **Step 5: Verify the build compiles**

Run: `npm run build`
Expected: build succeeds. TypeScript will flag `playHighFive` as missing on `BoardCanvas` until Task 6 — so if you build Task 3 in isolation, expect that one error and resolve it by completing Task 6. If executing tasks in order, add a temporary stub in Task 6 first, or run this build after Task 6.

Note for the executor: to keep each task independently green, run the Task 3 build check only after Task 6 lands `playHighFive`. The `burstBuff` call already exists on `BoardCanvas` (line 2008).

- [ ] **Step 6: Commit**

```bash
git add src/app/undercity/services/undercity-models.ts src/app/undercity/tabs/board-tab.component.ts
git commit -m "feat(undercity): high-five recipient notification + replay hook"
```

---

### Task 4: Client — occupants-strip High Five button

**Files:**
- Modify: `src/app/undercity/tabs/board-tab.component.html` (`pvp-row`, lines 194-208)
- Modify: `src/app/undercity/tabs/board-tab.component.ts` (add `highFive` near `attack` ~line 1856)

- [ ] **Step 1: Add the `highFive` method**

In `src/app/undercity/tabs/board-tab.component.ts`, directly after `attack` (which ends before line ~1900), add:

```typescript
  /** Friendly gesture: buff a creature sharing your space and notify them. */
  async highFive(target: Occupant): Promise<void> {
    await this.run(async () => {
      await this.store.action('high-five', { targetUserId: target.userId });
      const me = this.store.ownUserId;
      if (me) this.board?.playHighFive(me, target.userId);
      this.showToast(
        `You high-fived ${target.username} — they'll fight the next battle buffed!`,
      );
    });
  }
```

- [ ] **Step 2: Add the button to the occupants strip**

In `src/app/undercity/tabs/board-tab.component.html`, inside each `pvp-row`, add a High Five button after the Battle button (after line 207, before the row's closing `</div>` on line 208):

```html
          <button
            class="uc-btn pvp-btn"
            [disabled]="busy()"
            (click)="highFive(o)"
          >
            <mat-icon class="mi">back_hand</mat-icon> High Five
          </button>
```

(Note: no `uc-btn-danger` and no `o.shielded` disable — a high-five is friendly and works on shielded players.)

- [ ] **Step 3: Verify the build compiles**

Run: `npm run build`
Expected: build succeeds (after Task 6 provides `playHighFive`; see Task 3 Step 5 note).

- [ ] **Step 4: Commit**

```bash
git add src/app/undercity/tabs/board-tab.component.html src/app/undercity/tabs/board-tab.component.ts
git commit -m "feat(undercity): High Five button in the occupants strip"
```

---

### Task 5: Client — in-battle status chip

**Files:**
- Modify: `src/app/undercity/data/combat.ts` (`STATUS_INFO`, lines 126-155)

- [ ] **Step 1: Add the `high_five` chip**

In `src/app/undercity/data/combat.ts`, add an entry to `STATUS_INFO` after the `rust_curse` line (line 154):

```typescript
  high_five: { label: 'High Five', icon: 'back_hand', tone: 'buff',
    blurb: '+1 ATK/DEF/SPD this battle.' },
```

- [ ] **Step 2: Verify the build compiles**

Run: `npm run build`
Expected: build succeeds.

- [ ] **Step 3: Commit**

```bash
git add src/app/undercity/data/combat.ts
git commit -m "feat(undercity): high-five in-battle status chip"
```

---

### Task 6: Canvas — `playHighFive` ready→jump→clap animation

**Files:**
- Modify: `src/app/undercity/engine/board-canvas.ts` (new state near `TokenAnim` line 211; `playHighFive` near `burstBuff` line 2008; override in the token-placement loop lines 1206-1240)

- [ ] **Step 1: Add the animation state field**

In `src/app/undercity/engine/board-canvas.ts`, add an interface after `TokenAnim` (after line 211):

```typescript
/** An in-flight two-creature high-five (ready → jump → clap → settle). */
interface HighFiveAnim {
  aId: string; // giver
  bId: string; // recipient
  start: number; // ts (ms) when it began
  clapped: boolean; // impact burst fired once at the peak
}
```

Then add a private field to the `BoardCanvas` class alongside the other transient-FX fields (near where `pendingCast` / `sparkles` are declared — search for `private readonly sparkles`):

```typescript
  private highFive: HighFiveAnim | null = null;
```

- [ ] **Step 2: Add the `playHighFive` method**

In `src/app/undercity/engine/board-canvas.ts`, directly before `burstBuff` (line 2008), add:

```typescript
  /** Register a two-creature high-five. Both tokens must be co-located (the
   *  caller guarantees this); the placement loop overrides their x/hop/squash
   *  for HIGH_FIVE_MS and fires an impact burst at the clap. */
  playHighFive(giverId: string, recipientId: string): void {
    this.highFive = { aId: giverId, bId: recipientId, start: this.effectClock, clapped: false };
  }
```

Add the duration constant near the other animation constants (near `HOP_HEIGHT` line 307):

```typescript
const HIGH_FIVE_MS = 1000; // full ready→jump→clap→settle high-five
```

Note: `playHighFive` stamps `start` from `this.effectClock` (the same monotonic ms clock `drawToken` reads at line 2362); confirm the field name by searching `effectClock` and use whichever clock the draw loop advances each frame.

- [ ] **Step 3: Apply the override in the token-placement loop**

In `src/app/undercity/engine/board-canvas.ts`, inside the `list.forEach((p, i) => { ... })` block (lines 1206-1240), after `let hopY = 0; let breath = 1;` and the existing moving/idle branch that sets them (after line 1238, just before `placed.push(...)`), insert the high-five override:

```typescript
        // High-five override: converge the two participants, arc them up, squash
        // on the wind-up and stretch at the peak, then settle back apart.
        const hf = this.highFive;
        if (hf && (p.userId === hf.aId || p.userId === hf.bId)) {
          const ht = Math.min(1, (ts - hf.start) / HIGH_FIVE_MS);
          const other = list.find(
            (q) => q.userId === (p.userId === hf.aId ? hf.bId : hf.aId),
          );
          if (other) {
            const oa = this.tokenAnims.get(other.userId);
            const mid = oa ? (a.x + oa.x) / 2 : a.x;
            const dir = a.x <= mid ? 1 : -1; // move toward the midpoint
            const gap = NODE_R * 0.35; // near-touching at the clap
            let conv = 0; // px moved toward the midpoint
            let arc = 0;
            let squash = 1;
            if (ht < 0.25) {
              // Ready: lean slightly apart, crouch.
              const k = ht / 0.25;
              conv = -6 * k;
              squash = 1 - 0.15 * k;
            } else if (ht < 0.55) {
              // Jump: converge to near-touching, rise, stretch.
              const k = (ht - 0.25) / 0.3;
              conv = (Math.abs(a.x - mid) - gap) * k;
              arc = -Math.sin(k * Math.PI) * HOP_HEIGHT * 1.8;
              squash = 1 + 0.18 * Math.sin(k * Math.PI);
            } else {
              // Settle: bounce back to the resting fan position.
              const k = (ht - 0.55) / 0.45;
              conv = (Math.abs(a.x - mid) - gap) * (1 - k);
              arc = -Math.abs(Math.sin((1 - k) * Math.PI * 0.5)) * HOP_HEIGHT * 0.4;
              squash = 1;
            }
            a.x += dir * conv;
            hopY += arc;
            breath = squash;
            // Clap: one impact burst + dust at the peak (fired once).
            if (!hf.clapped && ht >= 0.55) {
              hf.clapped = true;
              const cx = mid;
              const cy = a.y - 6;
              for (let s = 0; s < 18; s++) {
                const ttl = 0.5 + Math.random() * 0.4;
                const ang = Math.random() * Math.PI * 2;
                this.sparkles.push({
                  x: cx,
                  y: cy,
                  vx: Math.cos(ang) * (30 + Math.random() * 40),
                  vy: Math.sin(ang) * (30 + Math.random() * 40) - 10,
                  life: ttl,
                  maxLife: ttl,
                  size: 1.8 + Math.random() * 2.2,
                  color: '#ffe27a',
                  glow: '#f2a900',
                });
              }
              this.spawnDust(cx, footY);
            }
          }
          if (ht >= 1) this.highFive = null;
        }
```

Notes for the executor:
- `a.x` is the eased token position from `tokenPos`; mutating it here shifts only this frame's render (it is recomputed to the resting target every frame), so the tokens naturally return home when the animation ends.
- `NODE_R`, `HOP_HEIGHT`, `this.sparkles`, `this.spawnDust`, and the `Sparkle` shape (with optional `vx`) all already exist (lines 307, 244-254, 1942). Confirm `NODE_R` is in scope in this file; if it is named differently, use the constant already used at line 1208 (`NODE_R * 0.9`).

- [ ] **Step 4: Verify the build compiles**

Run: `npm run build`
Expected: build succeeds. Now re-run the Task 3/4/5 build check — all should compile since `playHighFive` exists.

- [ ] **Step 5: Manual verification in the browser**

Use the `run-undercity` skill to launch the app against the live backend. Reach a state where two creatures share a space (two joined players, or the debug roll picker to walk one onto the other), open the occupants strip, and tap **High Five**. Confirm:
- The two creatures crouch, jump together, and clap with a spark burst.
- A toast appears for the giver.
- The recipient (second client/session) gets the "high-fived you" note and the buff shows as a **High Five** chip with a +1/+1/+1 delta in their next battle.

- [ ] **Step 6: Commit**

```bash
git add src/app/undercity/engine/board-canvas.ts
git commit -m "feat(undercity): high-five ready→jump→clap board animation"
```

---

## Self-review notes

- **Spec coverage:** buff stat effect (T1), one-battle consume (T1), config knob (T1), action + same-space + cooldown + notify + ticker (T2), seed/prune plumbing (T2), AwayEvent variant + text/icon + recipient replay (T3), occupants button (T4), status chip (T5), animation (T6). All design sections mapped.
- **Cross-task consistency:** `playHighFive(giverId, recipientId)` signature is identical in T3 (caller), T4 (caller), and T6 (definition). `high_five` buff kind is identical across engine, db, combat.ts, and STATUS_INFO. The away-event carries `fromId` in both the server push (T2) and the client union + replay (T3).
- **Verification reality:** frontend build-only (no Angular tests, lint broken — per repo memory); backend via pytest. Deploy is the user's responsibility — end with tests green and note a deploy is needed for the live backend.
