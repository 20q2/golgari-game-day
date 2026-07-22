# Undercity Bridge Tollkeeper Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Turn the biome-boundary bridges (`tunnel` nodes) into a tier-aware toll gate — Tier-1 "kids" cross free, Tier-2 "adults" pay a 50-spore toll and cross the same turn, Tier-3 "dragons/lich lords" are too large to enter at all — fronted by a playful tollkeeper dialog that fires on every crossing.

**Architecture:** Server enforces the rule (a bridge is a *forced stop* for evolved units so they can't skip the toll by walking through the spur; Tier-3 is blocked entirely by having no toll-table entry; Tier-2 pays on landing and warps across as today). The Angular board client adds a `bridgePrompt` interrupt dialog modeled 1:1 on the existing Ashen Wilds `wildsPrompt`, and makes bridges a client-side walk-stop for evolved units so the walk halts on the mouth.

**Tech Stack:** Python 3.11 Lambda (pytest, in-memory FakeTable suite), Angular 20 standalone components (signals), canvas board renderer (TypeScript). Map source of truth is `infrastructure/lambda/map.json`; no map edits in this plan.

**Spec:** `specs/2026-07-21-undercity-bridge-tollkeeper-design.md`

**Run all backend tests with:** `cd infrastructure/lambda && python -m pytest tests -q`

---

## Working-tree note (read before committing)

At time of writing, `undercity_config.py`, `undercity_data.py`, `undercity_db.py`,
and `src/app/undercity/tabs/board-tab.component.ts` all carry the user's
**unrelated** uncommitted WIP (a Pest scrounger passive + escape-ladder
stepping). When committing a task, stage only the hunks this plan introduces
(`git add -p <file>`), not the whole file, so you don't sweep in that WIP. If the
full test suite shows a failure unrelated to bridges, it may be pre-existing —
don't try to "fix" it as part of this work.

---

## File Structure

**Backend (Python, `infrastructure/lambda/`):**
- `undercity_config.py` — `TUNNEL_TOLL` value change (`{2: 8, 3: 16}` → `{2: 50}`).
- `undercity_db.py` — `_blocked_nodes` (Tier-3 hard block), new `_stop_nodes` helper, wire it into `_roll` and `_admin_bot_step`.
- `undercity_data.py` — no change (`TUNNEL_NODES`, `TUNNEL_EXITS` already derived).
- `tests/test_undercity_engine.py` — update `test_tunnel_toll_table`.
- `tests/test_undercity_db.py` — new Tier-3 / forced-stop tests (existing tunnel tests auto-track the toll via `data.TUNNEL_TOLL[2]`).

**Frontend (Angular, `src/app/undercity/`):**
- `tabs/board-tab.component.ts` — `bridgePrompt` signal, `payBridge`/`turnBackBridge`/`isBridge` + template helpers, `onTapNode` hook, `commitStep` bridge-stop, `stepChoices` walk-stop set.
- `tabs/board-tab.component.html` — the tollkeeper modal.
- `engine/board-canvas.ts` — no change (tunnel grey-out already removed; bridges are tappable for all tiers).

---

## Task 1: Config — bridge toll is 50 spores (Tier-2 only)

**Files:**
- Modify: `infrastructure/lambda/undercity_config.py:126-130`
- Test: `infrastructure/lambda/tests/test_undercity_engine.py` (`test_tunnel_toll_table`)

- [ ] **Step 1: Update the failing test**

In `tests/test_undercity_engine.py`, change `test_tunnel_toll_table` (currently asserts `{2: 8, 3: 16}`):

```python
def test_tunnel_toll_table():
    # Only Tier-2 has a toll entry. A tier absent from the table (Tier-3) is
    # too large to enter a bridge at all — see _blocked_nodes.
    assert data.TUNNEL_TOLL == {2: 50}
```

- [ ] **Step 2: Run it to verify it fails**

Run: `cd infrastructure/lambda && python -m pytest tests/test_undercity_engine.py -k tunnel_toll_table -v`
Expected: FAIL — `{2: 8, 3: 16} != {2: 50}`.

- [ ] **Step 3: Change the config**

In `undercity_config.py`, replace the `TUNNEL_TOLL` block:

```python
# Spore toll to cross a bridge (a `tunnel` node), keyed by tier. Tiers <=
# TUNNEL_TIER_MAX cross free ("kids"); a tier WITH an entry pays that toll
# ("adults"); a tier with NO entry is too large to fit and is blocked from
# bridges entirely (Tier 3 today — "dragons & lich lords"). See _blocked_nodes
# and _stop_nodes in undercity_db.py. The client mirrors this rule in the
# tollkeeper dialog prose only.
TUNNEL_TOLL = {2: 50}
```

- [ ] **Step 4: Run it to verify it passes**

Run: `cd infrastructure/lambda && python -m pytest tests/test_undercity_engine.py -k tunnel_toll_table -v`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add -p infrastructure/lambda/undercity_config.py infrastructure/lambda/tests/test_undercity_engine.py
git commit -m "feat(undercity): bridge toll is 50 spores, Tier-2 only"
```

---

## Task 2: `_blocked_nodes` — Tier-3 is too large for bridges

**Files:**
- Modify: `infrastructure/lambda/undercity_db.py:308-327`
- Test: `infrastructure/lambda/tests/test_undercity_db.py`

- [ ] **Step 1: Write the failing test**

Add to `tests/test_undercity_db.py` (near the other tunnel tests ~line 296; the file already imports `db`, `engine`, `data` and uses the `act`/`_sid`/`_get_player` helpers):

```python
def test_tier3_is_too_large_for_bridges(table):
    act(table, 'join', starter='pest')
    sid = _sid(table)
    doc = db._get_player(table, sid, 'user-alex')
    doc['tier'] = 3
    doc['spores'] = 9999          # can trivially afford any toll — irrelevant
    # Every bridge node is blocked outright for an apex unit.
    assert data.TUNNEL_NODES <= db._blocked_nodes(doc)
    doc['position'] = 'cavern_r2'
    dests = engine.legal_destinations(
        data.MAP_NODES, doc['position'], 1,
        db._closed_barriers(table, sid), db._blocked_nodes(doc))
    assert 't_bone_cavern1' not in dests
```

- [ ] **Step 2: Run it to verify it fails**

Run: `cd infrastructure/lambda && python -m pytest tests/test_undercity_db.py -k tier3_is_too_large -v`
Expected: FAIL — a well-funded Tier-3 is currently *allowed* onto bridges (`TUNNEL_TOLL.get(3, 0)` is `0`, so `spores < 0` is false → not blocked), so `t_bone_cavern1` is in `dests`.

- [ ] **Step 3: Update `_blocked_nodes`**

In `undercity_db.py`, replace the tier gate inside `_blocked_nodes` (currently lines ~318-322):

```python
    tier = doc.get('tier', 1)
    if tier > data.TUNNEL_TIER_MAX:
        toll = data.TUNNEL_TOLL.get(tier)   # None => too large to fit a bridge
        if toll is None or doc.get('spores', 0) < toll:
            blocked |= data.TUNNEL_NODES
```

Also update the docstring's second sentence to name the Tier-3 block:

```python
    """Nodes this unit may not step onto. Tier-1 units are barred from no
    bridges. Evolved units pay a tier toll (charged on landing in
    _resolve_space): a Tier-2 that cannot afford it is barred from bridges
    entirely, and an apex unit whose tier has no toll entry is too large to fit
    and is barred outright. Post-boss escape ladders stay barred until you have
    personally cleared the matching sigil lair (its node in poiClaims) — that
    per-player gate is what makes the ladder 'appear' only for a player who beat
    the boss."""
```

- [ ] **Step 4: Run it to verify it passes**

Run: `cd infrastructure/lambda && python -m pytest tests/test_undercity_db.py -k "tier3_is_too_large or broke_tier2 or funded_tier2" -v`
Expected: PASS — the new Tier-3 test, plus the existing `test_broke_tier2_is_blocked_from_tunnels` (49 spores → blocked) and `test_funded_tier2_may_enter_a_tunnel` (50 spores → only escape ladders blocked) all pass unchanged.

- [ ] **Step 5: Commit**

```bash
git add -p infrastructure/lambda/undercity_db.py infrastructure/lambda/tests/test_undercity_db.py
git commit -m "feat(undercity): Tier-3 units are too large to enter bridges"
```

---

## Task 3: `_stop_nodes` — evolved units must STOP on a bridge (no free pass-through)

**Files:**
- Modify: `infrastructure/lambda/undercity_db.py` — add `_stop_nodes` beside `_closed_barriers` (~line 215); wire into `_roll` `_legal` (~1863-1866) and `_admin_bot_step` (~1515).
- Test: `infrastructure/lambda/tests/test_undercity_db.py`

- [ ] **Step 1: Write the failing tests**

Add to `tests/test_undercity_db.py` (with the other tunnel tests):

```python
def test_funded_tier2_stops_on_a_bridge_not_through_it(table):
    act(table, 'join', starter='pest')
    sid = _sid(table)
    doc = db._get_player(table, sid, 'user-alex')
    doc['tier'] = 2
    doc['spores'] = data.TUNNEL_TOLL[2]      # funded, so allowed onto bridges
    doc['position'] = 'cavern_r2'
    closed = db._stop_nodes(table, sid, doc)
    blocked = db._blocked_nodes(doc)
    # The near mouth is a valid STOP with a 1-roll...
    assert 't_bone_cavern1' in engine.legal_destinations(
        data.MAP_NODES, doc['position'], 1, closed, blocked)
    # ...but a 2-roll cannot corridor THROUGH it to its paired mouth.
    assert 't_bone_cavern0' not in engine.legal_destinations(
        data.MAP_NODES, doc['position'], 2, closed, blocked)


def test_tier1_passes_through_a_bridge_freely(table):
    act(table, 'join', starter='pest')
    sid = _sid(table)
    doc = db._get_player(table, sid, 'user-alex')
    doc['tier'] = 1
    doc['position'] = 'cavern_r2'
    closed = db._stop_nodes(table, sid, doc)   # Tier-1: bridges NOT added
    blocked = db._blocked_nodes(doc)
    # A 2-roll walks straight through the spur to the paired mouth.
    assert 't_bone_cavern0' in engine.legal_destinations(
        data.MAP_NODES, doc['position'], 2, closed, blocked)
```

- [ ] **Step 2: Run to verify it fails**

Run: `cd infrastructure/lambda && python -m pytest tests/test_undercity_db.py -k "stops_on_a_bridge or passes_through_a_bridge" -v`
Expected: FAIL — `AttributeError: module 'undercity_db' has no attribute '_stop_nodes'`.

- [ ] **Step 3: Add the `_stop_nodes` helper**

In `undercity_db.py`, immediately after `_closed_barriers` (~line 215), add:

```python
def _stop_nodes(table, sid, doc):
    """The engine `closed` set for THIS mover: the shared sealed-barrier /
    escape-ladder stops from _closed_barriers, plus — for evolved units
    (tier > TUNNEL_TIER_MAX) — every bridge (tunnel) node. An evolved unit must
    STOP on a bridge mouth and pay the toll on landing; it can never corridor
    through a bridge for free. Tier-1 units pass/warp through bridges freely, so
    bridges are not added for them. (Bridges a unit can't afford / is too large
    for are already removed by _blocked_nodes, which wins over closed.)"""
    closed = _closed_barriers(table, sid)
    if doc.get('tier', 1) > data.TUNNEL_TIER_MAX:
        closed = closed | data.TUNNEL_NODES
    return closed
```

- [ ] **Step 4: Wire it into `_roll`**

In `_roll`, change the `_legal` closure (currently ~1863-1866) to pass `_stop_nodes` instead of `_closed_barriers`:

```python
    def _legal(v):
        return engine.legal_destinations(nodes, doc['position'], v,
                                         _stop_nodes(table, sid, doc),
                                         _blocked_nodes(doc))
```

- [ ] **Step 5: Wire it into `_admin_bot_step`**

In `_admin_bot_step`, change the `closed` assignment (currently ~1515):

```python
    closed = _stop_nodes(table, sid, doc)
    blocked = _blocked_nodes(doc)
```

- [ ] **Step 6: Run to verify it passes**

Run: `cd infrastructure/lambda && python -m pytest tests/test_undercity_db.py -k "stops_on_a_bridge or passes_through_a_bridge" -v`
Expected: PASS.

- [ ] **Step 7: Commit**

```bash
git add -p infrastructure/lambda/undercity_db.py infrastructure/lambda/tests/test_undercity_db.py
git commit -m "feat(undercity): evolved units stop on a bridge instead of passing through free"
```

---

## Task 4: Full backend suite green

**Files:** none (verification only)

- [ ] **Step 1: Run the whole backend suite**

Run: `cd infrastructure/lambda && python -m pytest tests -q`
Expected: PASS. In particular confirm `test_tier2_tunnel_landing_charges_the_toll` still passes — it sets `spores = 50` and asserts `spores == 50 - data.TUNNEL_TOLL[2]` (now `0`) and `position == TUNNEL_EXITS[...]`; the same-turn model leaves `_resolve_space`'s warp-on-landing untouched, so it needs no edit.

- [ ] **Step 2: If anything unrelated fails**

If a failure is in a Pest / scrounger / escape-ladder test (the user's parallel WIP), it is not this plan's regression — note it and move on. Any failure touching tunnels/tier/toll IS this plan's — fix before proceeding.

---

## Task 5: Client — tollkeeper interrupt state & walk-stop

**Files:**
- Modify: `src/app/undercity/tabs/board-tab.component.ts`

**Verify frontend with:** `npm run build` (lint is known-broken in this repo — use the build).

- [ ] **Step 1: Add the `bridgePrompt` signal**

In `board-tab.component.ts`, beside the existing `wildsPrompt` signal (~line 201), add:

```typescript
  /** Node id of a bridge (tunnel) mouth whose tollkeeper dialog is open, or
   *  null. Shown on every attempt to cross a bridge, tier-aware. */
  protected readonly bridgePrompt = signal<string | null>(null);
```

- [ ] **Step 2: Add `isBridge` + the pay/turn-back handlers**

Add these near the Ashen Wilds handlers (`pressOnWilds` / `turnBackWilds`, ~line 963-976):

```typescript
  // ── Bridge tollkeeper ────────────────────────────────────────────────────────

  private isBridge(nodeId: string): boolean {
    return this.map.nodes.find((n) => n.id === nodeId)?.type === 'tunnel';
  }

  /** True when the held bridge is actually a reachable step this roll (Tier-1 /
   *  funded Tier-2). A blocked unit (Tier-3, or a broke Tier-2) sees the dialog
   *  purely as information — there is nothing to commit. */
  protected bridgeCommittable(): boolean {
    const nodeId = this.bridgePrompt();
    const step = this.stepping();
    return !!(nodeId && step && step.left >= 1 && this.stepChoices(step).includes(nodeId));
  }

  protected bridgeTier(): number {
    return this.store.you()?.tier ?? 1;
  }

  /** "Hop across" (Tier-1) / "Pay 50 & cross" (funded Tier-2): take the held
   *  step. The server charges the toll / enforces the block on landing. */
  protected payBridge(): void {
    const nodeId = this.bridgePrompt();
    const step = this.stepping();
    this.bridgePrompt.set(null);
    if (nodeId && step && this.bridgeCommittableFor(step, nodeId)) {
      this.commitStep(step, nodeId);
    }
  }

  /** "Turn back": dismiss; leave the walk untouched so other routes stay open. */
  protected turnBackBridge(): void {
    this.bridgePrompt.set(null);
  }

  private bridgeCommittableFor(step: StepState, nodeId: string): boolean {
    return step.left >= 1 && this.stepChoices(step).includes(nodeId);
  }
```

(`bridgeCommittable()` re-reads the signals for the template; `bridgeCommittableFor` is the guard `payBridge` uses after clearing the signal.)

- [ ] **Step 3: Hook the dialog into `onTapNode`**

In `onTapNode` (~882-916), add the bridge interrupt in two places. First, inside the committable-step branch, right after the Ashen Wilds check and before `this.commitStep(step, nodeId)`:

```typescript
      if (step.left >= 1 && this.stepChoices(step).includes(nodeId)) {
        if (this.shouldWarnWilds(step, nodeId)) {
          this.hideInfo();
          this.wildsPrompt.set(nodeId);
          return;
        }
        // Every bridge crossing meets the tollkeeper first (Tier-1 free,
        // Tier-2 pays 50) — hold the step and let the dialog commit it.
        if (this.isBridge(nodeId)) {
          this.hideInfo();
          this.bridgePrompt.set(nodeId);
          return;
        }
        this.commitStep(step, nodeId);
        return;
      }
```

Then, replace the final fall-through `this.toggleInfo(nodeId);` (last line of `onTapNode`) with:

```typescript
    // Tapping a bridge that isn't a legal step this roll (Tier-3 too large, or
    // a broke Tier-2) still opens the tollkeeper so they learn why — the dialog
    // is informational there, with only Turn back.
    if (this.isBridge(nodeId)) {
      this.hideInfo();
      this.bridgePrompt.set(nodeId);
      return;
    }
    // Not a walk step — peek at what this space does.
    this.toggleInfo(nodeId);
```

- [ ] **Step 4: Make a bridge mouth a forced stop in `commitStep`**

In `commitStep` (~921-931), extend the auto-commit condition. Replace the `sealedStop` block:

```typescript
    const node = this.map.nodes.find((n) => n.id === nodeId);
    const sealedStop =
      node?.type === 'barrier' && !this.store.barriersOpen().includes(nodeId);
    // Evolved units (tier > 1) halt on a bridge mouth to pay the toll — a bonk
    // stop like a sealed barrier, so the move auto-commits on arrival.
    const bridgeStop = node?.type === 'tunnel' && (this.store.you()?.tier ?? 1) > 1;
    if (step.left === 1 || sealedStop || bridgeStop) void this.move(nodeId);
```

- [ ] **Step 5: Treat bridges as walk-stops for evolved units in `stepChoices`**

In `stepChoices` (~1051-1058), swap the closed set so an evolved player's walk stops on a bridge (mirrors the server's `_stop_nodes`):

```typescript
  private stepChoices(step: StepState): string[] {
    const dests = this.store.you()?.pendingMove?.dests ?? [];
    const closed = this.stepClosedIds();
    return legalSteps(this.map, stepPos(step), stepPrev(step), step.left, dests, closed);
  }

  /** Client walk-stop set: the shared sealed-barrier / escape-ladder stops,
   *  plus every bridge for evolved units (tier > 1) so their walk halts on the
   *  mouth. Mirrors undercity_db._stop_nodes. Scoped to walking only — NOT used
   *  for spell range / distance (those keep closedBarrierIds()). */
  private stepClosedIds(): string[] {
    const closed = this.closedBarrierIds();
    if ((this.store.you()?.tier ?? 1) > 1) {
      const bridges = this.map.nodes.filter((n) => n.type === 'tunnel').map((n) => n.id);
      return [...closed, ...bridges];
    }
    return closed;
  }
```

- [ ] **Step 6: Build**

Run: `npm run build`
Expected: build succeeds, no TypeScript errors. (The modal markup lands in Task 6; the handlers compile standalone.)

- [ ] **Step 7: Commit**

```bash
git add -p src/app/undercity/tabs/board-tab.component.ts
git commit -m "feat(undercity): bridge tollkeeper interrupt state + evolved walk-stop"
```

---

## Task 6: Client — the tollkeeper modal

**Files:**
- Modify: `src/app/undercity/tabs/board-tab.component.html`

- [ ] **Step 1: Add the modal markup**

In `board-tab.component.html`, immediately after the Ashen Wilds `@if (wildsPrompt()) { … }` block (ends ~line 168), add:

```html
  <!-- Bridge tollkeeper: fires on every bridge crossing, tier-aware. No
       backdrop-click dismissal — a button must be tapped. Kids (T1) cross free,
       adults (T2) pay 50 spores, dragons/lich lords (T3) don't fit. -->
  @if (bridgePrompt()) {
    <div class="uc-modal-backdrop">
      <div class="uc-modal" (click)="$event.stopPropagation()">
        <h3><mat-icon class="mi">toll</mat-icon> The Bridgekeeper</h3>
        @if (bridgeTier() >= 3) {
          <p class="modal-sub">
            One look and the bridgekeeper shakes their head. &ldquo;No chance
            &mdash; a beast your size will <em>never</em> fit through here. Off
            you go.&rdquo;
          </p>
        } @else if (bridgeTier() === 2 && !bridgeCommittable()) {
          <p class="modal-sub">
            The bridgekeeper folds their arms. &ldquo;Fifty spores to cross,
            grown-up &mdash; or turn around.&rdquo; You can't afford the toll.
            (Little ones go free; dragons and lich lords don't fit at all.)
          </p>
        } @else if (bridgeTier() === 2) {
          <p class="modal-sub">
            The bridgekeeper eyes your bulk. &ldquo;Grown-ups pay the toll
            &mdash; <strong>50 spores</strong> to cross.&rdquo; (Little ones go
            free; dragons and lich lords don't fit at all.)
          </p>
        } @else {
          <p class="modal-sub">
            The bridgekeeper waves you through with a grin. &ldquo;Little ones
            cross free &mdash; hop along!&rdquo; (Grown-ups pay 50 spores;
            dragons and lich lords don't fit at all.)
          </p>
        }
        <div class="choice-grid">
          <button class="uc-btn" (click)="turnBackBridge()">
            <mat-icon class="mi">undo</mat-icon> Turn back
          </button>
          @if (bridgeCommittable()) {
            <button class="uc-btn uc-btn-primary" (click)="payBridge()">
              <mat-icon class="mi">{{ bridgeTier() === 1 ? 'directions_walk' : 'paid' }}</mat-icon>
              {{ bridgeTier() === 1 ? 'Hop across' : 'Pay 50 &amp; cross' }}
            </button>
          }
        </div>
      </div>
    </div>
  }
```

- [ ] **Step 2: Build**

Run: `npm run build`
Expected: build succeeds, no template errors.

- [ ] **Step 3: Commit**

```bash
git add -p src/app/undercity/tabs/board-tab.component.html
git commit -m "feat(undercity): tollkeeper modal for bridge crossings"
```

---

## Task 7: Manual verification & wrap-up

**Files:** none

- [ ] **Step 1: Full backend suite once more**

Run: `cd infrastructure/lambda && python -m pytest tests -q`
Expected: PASS (bridge tests + no bridge-related regressions).

- [ ] **Step 2: Frontend build**

Run: `npm run build`
Expected: success.

- [ ] **Step 3: Manual walk-through**

Use the `run-undercity` skill to launch the board against the live backend and drive a creature to a bridge. Confirm:
- **Kid (Tier-1):** walking onto a bridge shows "Little ones cross free — hop along!"; **Hop across** warps to the far side; **Turn back** keeps remaining steps.
- **Adult (Tier-2), ≥50 spores:** the walk halts on the bridge mouth; dialog shows the 50-spore toll; **Pay 50 & cross** pops you out the far side the same turn and 50 spores are deducted; **Turn back** keeps steps.
- **Adult (Tier-2), <50 spores:** the bridge is not a reachable step; tapping it shows the "can't afford" dialog with only Turn back.
- **Dragon/Lich (Tier-3):** tapping a bridge shows "you'll never fit"; only Turn back; the bridge is never a legal move. The Ashen Wilds still reach every biome for the apex unit (no stranding).

- [ ] **Step 4: Hand off for deploy**

Do NOT run `cdk deploy` — the user runs deploys. Report that tests are green, the build passes, and a Lambda deploy is required for the new server rules to take effect live.

---

## Self-Review Notes

- **Spec coverage:** toll table `{2: 50}` (Task 1); Tier-3 hard block (Task 2); forced-stop no-free-pass-through for Tier-2 (Task 3); same-turn pay-and-warp preserved by leaving `_resolve_space` untouched (Task 4 verification); tollkeeper dialog every crossing + tier-aware copy + Tier-3/broke tap-to-see-why + evolved walk-stop (Tasks 5-6); manual verification of all four tier paths (Task 7).
- **Type/name consistency:** `_stop_nodes(table, sid, doc)` is defined in Task 3 and used in Tasks 3 (both call sites) and referenced by the client mirror comment; `bridgePrompt` / `isBridge` / `bridgeCommittable` / `bridgeTier` / `payBridge` / `turnBackBridge` / `stepClosedIds` are all defined in Task 5 and consumed in Task 6's template. `commitStep` and `stepChoices` keep their existing signatures.
- **No `_resolve_space` edit:** deliberate — the same-turn model reuses the existing warp-on-landing + `TUNNEL_TOLL.get(tier, 0)` charge; only the toll number and the upstream gating change.
- **Parallel WIP:** every commit uses `git add -p` to avoid capturing the user's unrelated in-flight edits to the same files.
