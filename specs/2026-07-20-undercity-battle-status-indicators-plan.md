# In-Battle Status Indicators Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Show icon chips (rot with a stack count, plus buffs/debuffs) next to each fighter's HP bar in interactive PvE combat.

**Architecture:** The battle record already tracks `rot_stacks` and `buffs` per side. Server adds a `_battle_status` helper and attaches `playerStatus`/`npcStatus` to the three battle payloads (start, round, resume). The Angular battle component renders a chip row per HP plate, driven by a `STATUS_INFO` map + `statusChips()` helper; the parent threads the new fields through.

**Tech Stack:** Python 3.11 Lambda (pytest, in-memory FakeTable), Angular 20 standalone components (signals, Material icons). No test runner on the frontend — the type gate is `npm run build`.

**Spec:** [specs/2026-07-20-undercity-battle-status-indicators-design.md](2026-07-20-undercity-battle-status-indicators-design.md)

---

## File structure

- `infrastructure/lambda/undercity_db.py` — add `_battle_status`; attach status to `_start_battle`, `_combat_round`, `_battle_resume`.
- `infrastructure/lambda/tests/test_undercity_db.py` — new tests for the helper + payloads.
- `src/app/undercity/services/undercity-models.ts` — `BattleStatus` interface + optional fields on `CombatRound`, `BattleResume`, `SpaceEvent`.
- `src/app/undercity/data/combat.ts` — `StatusInfo`, `STATUS_INFO`, `StatusChip`, `statusChips()`.
- `src/app/undercity/tabs/interactive-battle.component.ts` — status inputs/signals, `applyRound` param extension, chip helpers.
- `src/app/undercity/tabs/interactive-battle.component.html` — chip row + popover in each HP plate.
- `src/app/undercity/tabs/interactive-battle.component.scss` — chip + popover styles.
- `src/app/undercity/tabs/board-tab.component.ts` — `LiveBattle` fields + wiring in `openLiveBattle`/`resumeLiveBattle`/`onStance`.
- `src/app/undercity/tabs/board-tab.component.html` — bind `[attackerStatus]`/`[defenderStatus]`.

---

## Task 1: Server — expose status in battle payloads

**Files:**
- Modify: `infrastructure/lambda/undercity_db.py`
- Test: `infrastructure/lambda/tests/test_undercity_db.py`

- [ ] **Step 1: Write the failing tests**

Add to `infrastructure/lambda/tests/test_undercity_db.py`, right after `_begin` (currently ~line 1516):

```python
def test_battle_status_reads_rot_and_buffs():
    side = {'rot_stacks': 3, 'buffs': ['harden_shell', 'weaken_hex']}
    assert db._battle_status(side) == {'rot': 3, 'buffs': ['harden_shell', 'weaken_hex']}


def test_battle_status_defaults_empty():
    assert db._battle_status({}) == {'rot': 0, 'buffs': []}


def test_start_battle_includes_status(table, monkeypatch):
    monkeypatch.setattr(db, '_rng', _ZeroRng())
    act(table, 'join', starter='kraul')
    sid = _sid(table)
    ev = _begin(table, sid)
    assert ev['playerStatus'] == {'rot': 0, 'buffs': []}
    assert ev['npcStatus'] == {'rot': 0, 'buffs': []}


def test_combat_round_reports_status(table, monkeypatch):
    monkeypatch.setattr(db, '_rng', _ZeroRng())
    act(table, 'join', starter='kraul')
    sid = _sid(table)
    _begin(table, sid)
    # Seed a standing status on each side, then resolve a no-op round.
    doc = db._get_player(table, sid, 'user-alex')
    doc['battle']['npc']['rot_stacks'] = 3
    doc['battle']['player']['buffs'] = ['harden_shell']
    db._put_player(table, doc)
    monkeypatch.setattr(db.engine, 'resolve_round', lambda *a, **k: [])
    status, resp = act(table, 'combat-round', stance='aggress')
    assert status == 200
    assert resp['combat']['npcStatus']['rot'] == 3
    assert resp['combat']['playerStatus']['buffs'] == ['harden_shell']
```

- [ ] **Step 2: Run the tests to verify they fail**

Run: `cd infrastructure/lambda && python -m pytest tests/test_undercity_db.py -k "battle_status or includes_status or reports_status" -q`
Expected: FAIL — `AttributeError: module ... has no attribute '_battle_status'` and `KeyError: 'playerStatus'`.

- [ ] **Step 3: Add the `_battle_status` helper**

In `undercity_db.py`, immediately after `_bt_store` (ends ~line 373), add:

```python
def _battle_status(side):
    """Client-facing standing status for one combatant snapshot: the rot stack
    count (drives the DoT) and the list of active buff/debuff effect kinds."""
    return {'rot': int(side.get('rot_stacks', 0)),
            'buffs': list(side.get('buffs') or [])}
```

- [ ] **Step 4: Attach status to the three payloads**

In `_start_battle`, extend the returned dict (the `return {'type': 'battle_start', ...}` near line 440) by adding these two keys before `'text':`:

```python
            'playerStatus': _battle_status(rec['player']),
            'npcStatus': _battle_status(rec['npc']),
```

In `_combat_round`, extend the success return (`return _ok(doc, combat={...})` near line 2070) by adding, after `'npcHp': rec['npc']['hp'],`:

```python
                            'playerStatus': _battle_status(rec['player']),
                            'npcStatus': _battle_status(rec['npc']),
```

In `_battle_resume`, extend the returned dict (near line 2135) by adding, after `'playerHp': player_hp,`:

```python
        'playerStatus': _battle_status(rec.get('player', {})),
        'npcStatus': _battle_status(rec.get('npc', {})),
```

- [ ] **Step 5: Run the tests to verify they pass**

Run: `cd infrastructure/lambda && python -m pytest tests/test_undercity_db.py -k "battle_status or includes_status or reports_status" -q`
Expected: PASS (4 passed).

- [ ] **Step 6: Run the full suite to confirm nothing regressed**

Run: `cd infrastructure/lambda && python -m pytest tests -q`
Expected: PASS (all green).

- [ ] **Step 7: Commit**

```bash
git add infrastructure/lambda/undercity_db.py infrastructure/lambda/tests/test_undercity_db.py
git commit -m "feat(undercity): expose per-side battle status in combat payloads"
```

---

## Task 2: Client — model types + status data map

**Files:**
- Modify: `src/app/undercity/services/undercity-models.ts`
- Modify: `src/app/undercity/data/combat.ts`

No frontend test runner exists; the type gate is `npm run build`.

- [ ] **Step 1: Add the `BattleStatus` interface + response fields**

In `undercity-models.ts`, directly above `export interface CombatRound {` (currently ~line 262), add:

```ts
/** A fighter's standing conditions during a battle. */
export interface BattleStatus {
  rot: number; // rot stack count (0 = none); drives the DoT
  buffs: string[]; // active buff/debuff effect kinds
}
```

In the same file, add these two lines to **`CombatRound`** (after `revealNext: boolean;`):

```ts
  playerStatus?: BattleStatus;
  npcStatus?: BattleStatus;
```

Add the same two lines to **`BattleResume`** (after `revealed: Stance | null;`):

```ts
  playerStatus?: BattleStatus;
  npcStatus?: BattleStatus;
```

Add the same two lines to **`SpaceEvent`** (in the `// battle_start` block, after `frenzyFrom?: number | null;` near line 456):

```ts
  playerStatus?: BattleStatus;
  npcStatus?: BattleStatus;
```

- [ ] **Step 2: Add the status data map + chip helper**

In `src/app/undercity/data/combat.ts`, change the import on line 2 from:

```ts
import { Stance } from '../services/undercity-models';
```

to:

```ts
import { Stance, BattleStatus } from '../services/undercity-models';
```

Then append to the end of the file:

```ts
// ── In-battle status chips ────────────────────────────────────────────────────

export interface StatusInfo {
  label: string;
  icon: string; // Material Icons ligature
  tone: 'buff' | 'debuff';
  blurb: string;
}

/** Effect kind -> chip display. `rot` is included alongside the buff kinds.
 *  Icons mirror the ligatures used for these effects in spells.ts. Any kind not
 *  listed here is skipped, so a new buff shows nothing until it gets an entry. */
export const STATUS_INFO: Record<string, StatusInfo> = {
  rot: { label: 'Rot', icon: 'coronavirus', tone: 'debuff',
    blurb: 'Festering: takes damage at the end of each round. More stacks, more damage.' },
  harden_shell: { label: 'Harden Shell', icon: 'shield', tone: 'buff',
    blurb: '+2 DEF for this battle.' },
  rot_surge: { label: 'Rot Surge', icon: 'local_fire_department', tone: 'buff',
    blurb: '+3 ATK; Aggress applies rot to the foe.' },
  glowveil: { label: 'Glowveil', icon: 'flare', tone: 'buff',
    blurb: '+2 SPD and easier to flee this battle.' },
  bone_chill: { label: 'Bone Chill', icon: 'ac_unit', tone: 'debuff',
    blurb: 'Cursed: -2 ATK this battle.' },
  weaken_hex: { label: 'Weaken Hex', icon: 'heart_broken', tone: 'debuff',
    blurb: 'Cursed: -3 ATK this battle.' },
  cursed_idol: { label: 'Cursed', icon: 'dangerous', tone: 'debuff',
    blurb: 'A lingering curse saps this fighter.' },
  vines: { label: 'Bog Snare', icon: 'grass', tone: 'debuff',
    blurb: 'Snared by clinging vines.' },
};

export interface StatusChip {
  kind: string;
  count: number; // >1 shows a ×N badge (rot); buffs are always 1
  info: StatusInfo;
}

/** Ordered chips for one side: rot first (most actionable), then buffs, then
 *  debuffs. Unknown kinds are skipped. */
export function statusChips(status: BattleStatus | null | undefined): StatusChip[] {
  if (!status) return [];
  const chips: StatusChip[] = [];
  if (status.rot > 0) chips.push({ kind: 'rot', count: status.rot, info: STATUS_INFO['rot'] });
  const mapped = (status.buffs ?? [])
    .filter((k) => k !== 'rot' && STATUS_INFO[k])
    .map((k) => ({ kind: k, count: 1, info: STATUS_INFO[k] }));
  mapped.sort((a, b) => Number(a.info.tone === 'debuff') - Number(b.info.tone === 'debuff'));
  return [...chips, ...mapped];
}
```

- [ ] **Step 3: Build to verify types compile**

Run: `npm run build`
Expected: clean compile (only the repo's pre-existing warnings; no errors).

- [ ] **Step 4: Commit**

```bash
git add src/app/undercity/services/undercity-models.ts src/app/undercity/data/combat.ts
git commit -m "feat(undercity): battle status model + status chip data map"
```

---

## Task 3: Client — render chips in the battle component

**Files:**
- Modify: `src/app/undercity/tabs/interactive-battle.component.ts`
- Modify: `src/app/undercity/tabs/interactive-battle.component.html`
- Modify: `src/app/undercity/tabs/interactive-battle.component.scss`

After this task the chip row renders from internal signals; they default to empty (no data fed yet), so the component compiles and runs. Task 4 feeds real data.

- [ ] **Step 1: Import the status types + chip helper**

In `interactive-battle.component.ts`, change the combat-data import (line 14) from:

```ts
import { STANCES, STANCE_MAP, PERSONALITY_TELL, StanceAugment, COUNTER } from '../data/combat';
```

to:

```ts
import { STANCES, STANCE_MAP, PERSONALITY_TELL, StanceAugment, COUNTER, StatusChip, StatusInfo, STATUS_INFO, statusChips } from '../data/combat';
```

and change the models import (line 13) from:

```ts
import { CombatEntry, Stance } from '../services/undercity-models';
```

to:

```ts
import { CombatEntry, Stance, BattleStatus } from '../services/undercity-models';
```

- [ ] **Step 2: Add the status inputs, signals, and helpers**

In `interactive-battle.component.ts`, add two `@Input()`s next to the other optional inputs (after `@Input() defenderStats: CombatStats | null = null;`, ~line 66):

```ts
  /** Standing conditions per side (rot stacks + active buff/debuff kinds). */
  @Input() attackerStatus: BattleStatus | null = null;
  @Input() defenderStatus: BattleStatus | null = null;
```

Add two signals next to `attackerHp`/`defenderHp` (~line 86):

```ts
  protected readonly aStatus = signal<BattleStatus | null>(null);
  protected readonly dStatus = signal<BattleStatus | null>(null);
  /** Which chip's popover is open, or null. */
  protected readonly openChip = signal<{ side: Side; kind: string } | null>(null);
```

In `ngOnInit`, right after `this.defenderHp.set(this.defender.startHp);` (~line 127), add:

```ts
    this.aStatus.set(this.attackerStatus);
    this.dStatus.set(this.defenderStatus);
```

Add these methods near the other `protected` view helpers (e.g. after `augmentsFor`, ~line 193):

```ts
  protected chipsFor(side: Side): StatusChip[] {
    return statusChips(side === 'attacker' ? this.aStatus() : this.dStatus());
  }

  protected toggleChip(side: Side, kind: string): void {
    const c = this.openChip();
    this.openChip.set(c && c.side === side && c.kind === kind ? null : { side, kind });
  }

  /** The StatusInfo whose popover is open on this side, or null. */
  protected chipPopover(side: Side): StatusInfo | null {
    const c = this.openChip();
    return c && c.side === side ? (STATUS_INFO[c.kind] ?? null) : null;
  }
```

- [ ] **Step 3: Update `applyRound` to accept and apply status**

Replace the `applyRound` method (~lines 237-245) with:

```ts
  /** Play one resolved round as an animated bout, then advance + unlock. */
  applyRound(
    entries: CombatEntry[],
    telegraph: Stance | null,
    playerHp: number,
    npcHp: number,
    playerStatus: BattleStatus | null = null,
    npcStatus: BattleStatus | null = null,
  ): void {
    this.hasActed.set(true); // a blow's been traded — fleeing is now allowed
    this.runSequence(entries, playerHp, npcHp, () => {
      this.telegraph = telegraph;
      this.round.update((r) => r + 1);
      this.revealed.set(null); // a scry only lasts its round
      this.aStatus.set(playerStatus);
      this.dStatus.set(npcStatus);
      this.openChip.set(null); // stale popover shouldn't survive the round
      this.busy.set(false);
    });
  }
```

- [ ] **Step 4: Render the chip row + popover in each HP plate**

In `interactive-battle.component.html`, replace the two `.plate` blocks (lines 5-18) with:

```html
      <div class="plate">
        <span class="side-name">You</span>
        <div class="hp-track">
          <div class="hp-fill" [class.low]="hpPct('attacker') <= 50" [class.crit]="hpPct('attacker') <= 25" [style.width.%]="hpPct('attacker')"></div>
        </div>
        <span class="hp-num">{{ attackerHp() }}/{{ attacker.maxHp }} HP</span>
        <div class="status-row">
          @for (chip of chipsFor('attacker'); track chip.kind) {
            <button type="button" class="status-chip" [class.buff]="chip.info.tone === 'buff'" [class.debuff]="chip.info.tone === 'debuff'" (click)="toggleChip('attacker', chip.kind)">
              <mat-icon class="mi">{{ chip.info.icon }}</mat-icon>
              @if (chip.count > 1) { <span class="cnt">×{{ chip.count }}</span> }
            </button>
          }
        </div>
        @if (chipPopover('attacker'); as info) {
          <div class="status-pop"><strong>{{ info.label }}</strong><span>{{ info.blurb }}</span></div>
        }
      </div>
      <div class="plate right">
        <span class="side-name">{{ defender.name }}</span>
        <div class="hp-track">
          <div class="hp-fill" [class.low]="hpPct('defender') <= 50" [class.crit]="hpPct('defender') <= 25" [style.width.%]="hpPct('defender')"></div>
        </div>
        <span class="hp-num">{{ defenderHp() }}/{{ defender.maxHp }} HP</span>
        <div class="status-row">
          @for (chip of chipsFor('defender'); track chip.kind) {
            <button type="button" class="status-chip" [class.buff]="chip.info.tone === 'buff'" [class.debuff]="chip.info.tone === 'debuff'" (click)="toggleChip('defender', chip.kind)">
              <mat-icon class="mi">{{ chip.info.icon }}</mat-icon>
              @if (chip.count > 1) { <span class="cnt">×{{ chip.count }}</span> }
            </button>
          }
        </div>
        @if (chipPopover('defender'); as info) {
          <div class="status-pop"><strong>{{ info.label }}</strong><span>{{ info.blurb }}</span></div>
        }
      </div>
```

- [ ] **Step 5: Style the chips + popover**

In `interactive-battle.component.scss`, inside the existing `.plate` rule (append after the `.hp-num` block, before the rule closes), add:

```scss
  .status-row {
    display: flex;
    gap: 4px;
    margin-top: 3px;
    min-height: 18px; // reserve space so the arena doesn't jump when chips appear
  }
  &.right .status-row { flex-direction: row-reverse; }

  .status-chip {
    display: inline-flex;
    align-items: center;
    gap: 1px;
    padding: 1px 3px;
    border: 1px solid transparent;
    border-radius: 5px;
    background: rgba(0, 0, 0, 0.35);
    cursor: pointer;
    line-height: 1;

    .mi { font-size: 14px; width: 14px; height: 14px; }
    .cnt { font-size: 0.66rem; font-weight: 700; }

    &.buff { color: #99d98c; border-color: rgba(153, 217, 140, 0.4); }
    &.debuff { color: #d86060; border-color: rgba(216, 96, 96, 0.4); }
  }

  .status-pop {
    display: flex;
    flex-direction: column;
    gap: 2px;
    margin-top: 4px;
    padding: 5px 7px;
    max-width: 200px;
    border-radius: 6px;
    background: rgba(12, 10, 8, 0.92);
    border: 1px solid rgba(190, 210, 190, 0.3);
    font-size: 0.7rem;

    strong { font-weight: 700; }
    span { color: #9aa79a; }
  }
  &.right .status-pop { margin-left: auto; text-align: right; }
```

- [ ] **Step 6: Build to verify it compiles**

Run: `npm run build`
Expected: clean compile (pre-existing warnings only).

- [ ] **Step 7: Commit**

```bash
git add src/app/undercity/tabs/interactive-battle.component.ts src/app/undercity/tabs/interactive-battle.component.html src/app/undercity/tabs/interactive-battle.component.scss
git commit -m "feat(undercity): render in-battle status chips on HP plates"
```

---

## Task 4: Client — feed status through the parent

**Files:**
- Modify: `src/app/undercity/tabs/board-tab.component.ts`
- Modify: `src/app/undercity/tabs/board-tab.component.html`

- [ ] **Step 1: Import `BattleStatus`**

In `board-tab.component.ts`, the models import block (lines 20-38) already lists `BattleResult`, `BattleResume`, `CombatRound`, `SpaceEvent`, etc. Add `BattleStatus,` to that block, right after the `BattleResume,` line:

```ts
  BattleResume,
  BattleStatus,
  BazaarView,
```

- [ ] **Step 2: Add status fields to `LiveBattle`**

In `board-tab.component.ts`, add to the `LiveBattle` interface (after `defenderStats: CombatStats | null;`, ~line 90):

```ts
  attackerStatus: BattleStatus | null;
  defenderStatus: BattleStatus | null;
```

- [ ] **Step 3: Populate status in `openLiveBattle`**

In `openLiveBattle`, add to the `this.liveBattle.set({ ... })` object (after `frenzyFrom: ev.frenzyFrom ?? null,`, ~line 1359):

```ts
      attackerStatus: ev.playerStatus ?? null,
      defenderStatus: ev.npcStatus ?? null,
```

- [ ] **Step 4: Populate status in `resumeLiveBattle`**

In `resumeLiveBattle`, add to its `this.liveBattle.set({ ... })` object (after `frenzyFrom: pb.frenzyFrom ?? null,`, ~line 1400):

```ts
      attackerStatus: pb.playerStatus ?? null,
      defenderStatus: pb.npcStatus ?? null,
```

- [ ] **Step 5: Pass status into `applyRound`**

In `onStance`, replace the `applyRound` call (~line 1428):

```ts
        this.liveB?.applyRound(c.entries, c.telegraph, c.playerHp, c.npcHp);
```

with:

```ts
        this.liveB?.applyRound(c.entries, c.telegraph, c.playerHp, c.npcHp, c.playerStatus ?? null, c.npcStatus ?? null);
```

- [ ] **Step 6: Bind the inputs in the template**

In `board-tab.component.html`, add to the `<app-undercity-interactive-battle>` element (after `[defenderStats]="lb.defenderStats"` — insert alongside the other `[...]` bindings, e.g. after line 588):

```html
      [attackerStatus]="lb.attackerStatus"
      [defenderStatus]="lb.defenderStatus"
```

- [ ] **Step 7: Build to verify it compiles**

Run: `npm run build`
Expected: clean compile (pre-existing warnings only).

- [ ] **Step 8: Commit**

```bash
git add src/app/undercity/tabs/board-tab.component.ts src/app/undercity/tabs/board-tab.component.html
git commit -m "feat(undercity): thread battle status into the interactive battle"
```

---

## Task 5: Full verification

**Files:** none (verification only).

- [ ] **Step 1: Run the backend suite**

Run: `cd infrastructure/lambda && python -m pytest tests -q`
Expected: all green.

- [ ] **Step 2: Production build**

Run: `npm run build`
Expected: clean compile.

- [ ] **Step 3: Manual drive (requires the live backend)**

Start the app (`npm start`), enter the Undercity, and start a fight:
1. Equip a Barbed fang (Rusted Fang) and Aggress a wild foe → a `☣` chip appears on the **foe's** plate and its `×N` count climbs each round it isn't cleared.
2. Enter a fight with Harden Shell active (cast it first, or start with it) → a green `🛡` chip shows on **your** plate.
3. Tap a chip → a popover shows its name + effect; tap again (or resolve a round) → it closes.
4. Confirm a clean fighter (no rot, no buffs) shows no chips and the arena layout doesn't jump.

> Note: deploys are run by the maintainer — end here with tests green and the build clean; do not deploy.

---

## Self-review notes

- **Spec coverage:** rot + all mapped buffs/debuffs (Task 2 `STATUS_INFO`); both fighters (Task 3 renders `attacker` + `defender`); server exposes all three payloads (Task 1); tap-for-detail popover (Task 3 Steps 4-5); chips only when active + reserved row height so no layout jump (Task 3). Out-of-scope items (transient ramps, spectator/playback) are intentionally untouched.
- **Type consistency:** `BattleStatus { rot, buffs }` is defined once (Task 2) and reused everywhere; `applyRound`'s new params are optional so Task 3 compiles before Task 4 wires real data; `statusChips`/`STATUS_INFO`/`StatusChip`/`StatusInfo` names match across data + component.
- **No rules change:** server reads existing `rot_stacks`/`buffs`; no engine edit; balance untouched.
