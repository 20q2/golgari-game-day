# Companion-in-Combat Visuals — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Render the player's active attack/defend companion as a sidekick in the combat arena and play a distinct animated beat (lunge on a follow-up hit, hop/shield on a deflect) with an action+number popover.

**Architecture:** Client-only playback enhancement. The server already emits `pet: 'attack'|'defend'`, the follow-up `dmg`, and `deflect` on each `CombatEntry`, so this only touches how the battle component plays that entry stream. Data flows board-tab → `BattleSide.companion` → `interactive-battle` render + a new per-entry animation beat.

**Tech Stack:** Angular 20 standalone component, signals, SCSS keyframe animations. No server/engine/balance changes.

**Spec:** [specs/2026-08-04-undercity-companion-combat-visuals-design.md](2026-08-04-undercity-companion-combat-visuals-design.md)

> **Repo note — no unit-test runner:** This repo has no Karma/Jasmine/ng-test (see CLAUDE.md). Do **not** run `ng test`. The per-task verification gate is a green **`npm run build`** (dev build to `docs/`, the fastest full compile check) plus the described manual observation. Final manual check uses the **run-undercity** skill.
>
> **Commit note:** The user does parallel WIP and commits with `git add -a`. Commit **only the files this plan touches, by explicit path** — never `git add -a`/`git add .`. Committing is fine; deploying is the user's job.

---

## File Structure

- **Modify** `src/app/undercity/tabs/battle-playback.component.ts` — add the `BattleCompanion` interface + optional `companion` field on `BattleSide`.
- **Modify** `src/app/undercity/tabs/board-tab.component.ts` — derive the active combat companion and set it on the attacker `BattleSide` in `openLiveBattle` + `resumeLiveBattle`.
- **Modify** `src/app/undercity/tabs/interactive-battle.component.ts` — `companionSpriteFailed` / `petAnim` / `petPop` signals; companion branch in `animateEntry`; pet-beat timing in `runSequence`.
- **Modify** `src/app/undercity/tabs/interactive-battle.component.html` — sidekick markup inside the attacker `.side`.
- **Modify** `src/app/undercity/tabs/interactive-battle.component.scss` — `.companion` base + idle bob, lunge/block animations, shield flash, `.pet-pop`.

---

## Task 1: Plumb the active companion into the battle payload

**Files:**
- Modify: `src/app/undercity/tabs/battle-playback.component.ts` (`BattleSide`, ~line 15-30)
- Modify: `src/app/undercity/tabs/board-tab.component.ts` (imports; `openLiveBattle` ~line 2732; `resumeLiveBattle` ~line 2783; new helper near the pet helpers ~line 240-290)

- [ ] **Step 1: Add the `BattleCompanion` interface + `BattleSide.companion` field**

In `battle-playback.component.ts`, immediately **above** `export interface BattleSide {`:

```ts
/** A combat companion rendered beside the player in the arena. Only attack/defend
 *  pets appear (the only roles that act in a fight); set on the attacker side only. */
export interface BattleCompanion {
  role: 'attack' | 'defend';
  spriteUrl: string;
  name: string;
}
```

Then inside `BattleSide`, add this field just after `vestige?: boolean;`:

```ts
  /** The player's active combat companion (attack/defend only), shown as a
   *  sidekick in the arena. Only ever set on the attacker side. */
  companion?: BattleCompanion;
```

- [ ] **Step 2: Import the helpers in board-tab**

In `board-tab.component.ts`, add `BattleCompanion` to the existing import from `'./battle-playback.component'` (currently `import { BattlePlaybackComponent, BattleSide, BattleRewards } from './battle-playback.component';`):

```ts
import { BattlePlaybackComponent, BattleSide, BattleRewards, BattleCompanion } from './battle-playback.component';
```

Add `petInfo` to the existing import from `'../data/pets'` (which already imports `petSpriteUrl`, `petRole`, `Pet`). It should now include `petInfo` alongside them.

- [ ] **Step 3: Add the `youCompanion()` helper**

In `board-tab.component.ts`, add this private method near the other pet helpers (the block around lines 240-290 that already uses `petRole` / `petSpriteUrl`):

```ts
/** The player's active combat companion for the arena — a sidekick sprite for
 *  attack/defend pets only (forage/scout/economy never appear in a fight). */
private youCompanion(): BattleCompanion | undefined {
  const you = this.store.you();
  const pet = (you?.pets ?? []).find((p) => p.id === you?.activePetId);
  if (!pet) return undefined;
  const role = petRole(pet.species);
  if (role !== 'attack' && role !== 'defend') return undefined;
  return { role, spriteUrl: petSpriteUrl(pet.species), name: petInfo(pet.species).name };
}
```

- [ ] **Step 4: Set `companion` on the attacker in `openLiveBattle`**

In `openLiveBattle` (~line 2733), the attacker block becomes:

```ts
      attacker: {
        name: this.youBattleName(),
        spriteUrl: this.youSpriteUrl(),
        startHp: preHp,
        maxHp: you?.maxHp ?? preHp,
        level: you?.level,
        tier: you?.tier,
        companion: this.youCompanion(),
      },
```

- [ ] **Step 5: Set `companion` on the attacker in `resumeLiveBattle`**

In `resumeLiveBattle` (~line 2784), the attacker block becomes:

```ts
      attacker: {
        name: this.youBattleName(),
        spriteUrl: this.youSpriteUrl(),
        startHp: pb.playerHp,
        maxHp: you?.maxHp ?? pb.playerHp,
        level: you?.level,
        tier: you?.tier,
        companion: this.youCompanion(),
      },
```

- [ ] **Step 6: Build to verify it compiles**

Run: `npm run build`
Expected: build completes with no TypeScript errors. (`companion` is unused in the template yet — that's fine; it's an optional field.)

- [ ] **Step 7: Commit**

```bash
git add src/app/undercity/tabs/battle-playback.component.ts src/app/undercity/tabs/board-tab.component.ts
git commit -m "feat(undercity): pass active combat companion into the battle payload

Co-Authored-By: Claude Opus 4.8 (1M context) <noreply@anthropic.com>"
```

---

## Task 2: Render the persistent sidekick sprite (idle, no activation yet)

**Files:**
- Modify: `src/app/undercity/tabs/interactive-battle.component.ts` (signals, ~line 122)
- Modify: `src/app/undercity/tabs/interactive-battle.component.html` (attacker `.side`, after the `.body` span ~line 85)
- Modify: `src/app/undercity/tabs/interactive-battle.component.scss` (new `.companion` block)

- [ ] **Step 1: Add the `companionSpriteFailed` signal**

In `interactive-battle.component.ts`, next to `attackerSpriteFailed` / `defenderSpriteFailed` (~line 122-123), add:

```ts
  protected readonly companionSpriteFailed = signal(false);
```

- [ ] **Step 2: Render the sidekick in the attacker side**

In `interactive-battle.component.html`, inside the **attacker** `.side` element — after the `@if (enteredFighters()) { ... }` block that renders the `.body` span (the one ending at line ~86, before the `@if (pop()?.side === 'attacker')` block) — insert:

```html
        @if (enteredFighters() && attacker.companion; as pet) {
          <span class="companion">
            @if (!companionSpriteFailed()) {
              <img class="pet-art" [src]="pet.spriteUrl" [alt]="pet.name" (error)="companionSpriteFailed.set(true)" />
            } @else {
              <mat-icon class="pet-art-icon">{{ pet.role === 'defend' ? 'shield' : 'pets' }}</mat-icon>
            }
          </span>
        }
```

- [ ] **Step 3: Add the base `.companion` styles + idle bob**

In `interactive-battle.component.scss`, add (a good home is right after the `.side { ... }` block that ends ~line 135, so it inherits the `position: relative` parent):

```scss
// Combat companion (attack/defend pet) — a small sidekick tucked at the player's
// near foot. Absolute within the attacker .side so its lunge/hop never disturbs
// the creature's own layout. Sits left of the creature so a lunge reads as moving
// toward the foe (arena is player-left, foe-right).
.companion {
  position: absolute;
  bottom: -4px;
  left: calc(50% - 66px);
  z-index: 3; // above platform + creature, below the dmg-pop (z 4)
  width: 44px;
  height: 44px;
  pointer-events: none;
  animation: uc-pet-bob 2.4s ease-in-out infinite;

  .pet-art {
    width: 100%;
    height: 100%;
    object-fit: contain;
    image-rendering: pixelated;
    filter: drop-shadow(0 4px 5px rgba(0, 0, 0, 0.55));
  }
  .pet-art-icon {
    font-size: 40px;
    width: 44px;
    height: 44px;
    line-height: 44px;
    color: #d8b5b5;
    filter: drop-shadow(0 4px 5px rgba(0, 0, 0, 0.55));
  }
}
@keyframes uc-pet-bob {
  0%, 100% { transform: translateY(0); }
  50% { transform: translateY(-3px); }
}
```

- [ ] **Step 4: Build to verify it compiles**

Run: `npm run build`
Expected: build completes with no errors.

- [ ] **Step 5: Manual check (optional but recommended)**

Via the run-undercity skill, enter a fight with an **attack** or **defend** pet set active. Expected: a small pet sprite sits at your creature's lower-left, gently bobbing, from the moment the fighters drop in. With a forage/scout/economy pet active (or no pet), no sidekick appears.

- [ ] **Step 6: Commit**

```bash
git add src/app/undercity/tabs/interactive-battle.component.ts src/app/undercity/tabs/interactive-battle.component.html src/app/undercity/tabs/interactive-battle.component.scss
git commit -m "feat(undercity): show active combat companion beside you in battle

Co-Authored-By: Claude Opus 4.8 (1M context) <noreply@anthropic.com>"
```

---

## Task 3: Animate the activation beat (lunge / block + popover)

**Files:**
- Modify: `src/app/undercity/tabs/interactive-battle.component.ts` (`petAnim`/`petPop` signals ~line 122; `runSequence` ~line 433; `animateEntry` ~line 487; `dmgIcon` ~line 525)
- Modify: `src/app/undercity/tabs/interactive-battle.component.html` (companion markup from Task 2)
- Modify: `src/app/undercity/tabs/interactive-battle.component.scss` (lunge/block/shield/pet-pop)

- [ ] **Step 1: Add the `petAnim` and `petPop` signals**

In `interactive-battle.component.ts`, next to `companionSpriteFailed` (~line 122-124), add:

```ts
  /** Which activation the sidekick is playing this beat (drives its CSS class). */
  protected readonly petAnim = signal<'attack' | 'defend' | null>(null);
  /** The companion's own popover text ('-N' follow-up dmg, or 'N' deflected). */
  protected readonly petPop = signal<{ text: string; kind: 'dmg' | 'block' } | null>(null);
```

- [ ] **Step 2: Give the companion its own beat in `animateEntry`**

In `interactive-battle.component.ts`, in `animateEntry`, insert this block **immediately after** the `const target: Side = ...` line (~line 492) and **before** the existing `if (e.dmg) {` block:

```ts
    // Companion trigger: give the pet its own beat (lunge / block) + popover, and
    // skip the generic pop for this entry so the pet's message stands alone.
    if (e.pet === 'attack' && e.dmg) {
      const cur = target === 'attacker' ? this.attackerHp() : this.defenderHp();
      (target === 'attacker' ? this.attackerHp : this.defenderHp).set(Math.max(0, cur - e.dmg));
      this.struck.set(target);
      this.timers.push(setTimeout(() => this.struck.set(null), 380));
      this.petAnim.set('attack');
      this.petPop.set({ text: `-${e.dmg}`, kind: 'dmg' });
      this.timers.push(setTimeout(() => this.petAnim.set(null), 650));
      this.timers.push(setTimeout(() => this.petPop.set(null), 900));
      return;
    }
    if (e.pet === 'defend' && e.deflect) {
      this.petAnim.set('defend');
      this.petPop.set({ text: `${e.deflect}`, kind: 'block' });
      this.timers.push(setTimeout(() => this.petAnim.set(null), 650));
      this.timers.push(setTimeout(() => this.petPop.set(null), 900));
      return;
    }
```

- [ ] **Step 3: Remove the now-dead companion handling from the generic path**

In the same `animateEntry`, delete the old deflect branch (companion defends now return early above):

```ts
    } else if (e.deflect) {
      // Defend companion shrugged off part of the hit — badge the blocker's side.
      this.pop.set({ side: e.by as Side, text: 'Block!', kind: 'miss' });
    }
```

so the chain is just `if (e.dmg) { ... } else if (e.miss || e.negated) { ... }`.

Then in `dmgIcon` (~line 526), delete the now-unreachable first line:

```ts
    if (e.pet === 'attack') return { icon: 'pets', svg: false }; // Attack companion follow-up
```

(Attack entries now return early in `animateEntry`, so `dmgIcon` never sees `e.pet === 'attack'`.)

- [ ] **Step 4: Give a pet entry a longer lead in `runSequence`**

In `runSequence` (~line 461-468), replace the effects loop:

```ts
    let first = true;
    for (const e of effects) {
      // First blow lands at the aggressor's impact (~mid leap); rest space out.
      at(first ? (header ? 780 : 220) : 560, () =>
        this.animateEntry(e, header?.aStance, header?.dStance),
      );
      first = false;
    }
```

with:

```ts
    let first = true;
    for (const e of effects) {
      const lead = first ? (header ? 780 : 220) : 560;
      // A companion beat waits a touch longer so it reads as its own moment.
      const delay = e.pet ? Math.max(lead, 720) : lead;
      at(delay, () => this.animateEntry(e, header?.aStance, header?.dStance));
      first = false;
    }
```

- [ ] **Step 5: Clear the pet beat in the settle step**

In `runSequence`, in the final `at(720, () => { ... })` settle block (~line 470-480), add the two resets alongside the existing `this.pop.set(null);`:

```ts
      this.struck.set(null);
      this.pop.set(null);
      this.petAnim.set(null);
      this.petPop.set(null);
      this.resolving.set(false);
      onDone();
```

- [ ] **Step 6: Wire the animation classes + popover into the markup**

In `interactive-battle.component.html`, replace the Task 2 companion markup with:

```html
        @if (enteredFighters() && attacker.companion; as pet) {
          <span
            class="companion"
            [class.lunge]="petAnim() === 'attack'"
            [class.block]="petAnim() === 'defend'"
          >
            @if (petAnim() === 'defend') { <span class="pet-shield"></span> }
            @if (!companionSpriteFailed()) {
              <img class="pet-art" [src]="pet.spriteUrl" [alt]="pet.name" (error)="companionSpriteFailed.set(true)" />
            } @else {
              <mat-icon class="pet-art-icon">{{ pet.role === 'defend' ? 'shield' : 'pets' }}</mat-icon>
            }
            @if (petPop(); as pp) {
              <span class="pet-pop" [class.block]="pp.kind === 'block'">
                <span class="pet-label">{{ pp.kind === 'block' ? 'Blocked' : 'Follow-up!' }}</span>{{ pp.text }}
              </span>
            }
          </span>
        }
```

- [ ] **Step 7: Add the activation animations + popover styles**

In `interactive-battle.component.scss`, add after the `.companion { ... }` / `@keyframes uc-pet-bob` block from Task 2:

```scss
// Follow-up: the sidekick darts toward the foe (rightward) and snaps back. The
// lunge animation replaces the idle bob for its duration.
.companion.lunge { animation: uc-pet-lunge 0.6s cubic-bezier(0.3, 1.4, 0.5, 1); }
@keyframes uc-pet-lunge {
  0%   { transform: translateX(0) scale(1); }
  35%  { transform: translateX(46px) scale(1.12); }
  55%  { transform: translateX(46px) scale(1.12); }
  100% { transform: translateX(0) scale(1); }
}

// Deflect: the sidekick hops up as it throws up a guard.
.companion.block { animation: uc-pet-block 0.6s ease; }
@keyframes uc-pet-block {
  0%   { transform: translateY(0) scale(1); }
  30%  { transform: translateY(-12px) scale(1.12); }
  100% { transform: translateY(0) scale(1); }
}

// Brief shield flash on a deflect (the guard .barrier motif, sidekick-sized).
.companion .pet-shield {
  position: absolute;
  top: 50%;
  left: 50%;
  width: 56px;
  height: 56px;
  margin: -28px 0 0 -28px;
  border-radius: 50%;
  border: 2px solid rgba(130, 205, 255, 0.85);
  background: radial-gradient(circle, rgba(130, 205, 255, 0.18), transparent 68%);
  box-shadow: 0 0 12px rgba(130, 205, 255, 0.55);
  pointer-events: none;
  animation: uc-pet-shield 0.6s ease;
}
@keyframes uc-pet-shield {
  0% { opacity: 0; transform: scale(0.6); }
  30% { opacity: 1; transform: scale(1); }
  100% { opacity: 0; transform: scale(1.1); }
}

// The companion's own popover — sits just above the sidekick. Reuses uc-pop
// (defined for .dmg-pop) for the float-up-and-fade motion.
.companion .pet-pop {
  position: absolute;
  bottom: 48px;
  left: 50%;
  transform: translateX(-50%);
  z-index: 4;
  display: inline-flex;
  align-items: baseline;
  gap: 3px;
  white-space: nowrap;
  font-weight: 800;
  font-size: 1rem;
  color: #fca5a5; // follow-up damage
  text-shadow: 0 2px 4px rgba(0, 0, 0, 0.85);
  animation: uc-pop 0.9s ease forwards;
  &.block { color: #93c5fd; } // deflect
  .pet-label {
    font-size: 0.7rem;
    font-weight: 700;
    letter-spacing: 0.02em;
    opacity: 0.9;
  }
}
```

- [ ] **Step 8: Build to verify it compiles**

Run: `npm run build`
Expected: build completes with no errors.

- [ ] **Step 9: Manual check via run-undercity**

Enter a fight with an **attack** pet active and win reads until a follow-up procs: the sidekick should **dart toward the foe** in its own beat, the foe flashes red + loses HP, and a `Follow-up! -N` popover floats above the pet. Then repeat with a **defend** pet: on a deflect the sidekick **hops up with a blue shield flash** and a `Blocked N` popover appears. Triggers are chance-based, so allow several rounds. Confirm the pet beat reads as its own moment, not blurred into the main exchange.

- [ ] **Step 10: Commit**

```bash
git add src/app/undercity/tabs/interactive-battle.component.ts src/app/undercity/tabs/interactive-battle.component.html src/app/undercity/tabs/interactive-battle.component.scss
git commit -m "feat(undercity): animate companion follow-up/deflect beats in battle

Co-Authored-By: Claude Opus 4.8 (1M context) <noreply@anthropic.com>"
```

---

## Self-Review

**Spec coverage:**
- Client-only, no server change → no engine/`CombatEntry` edits anywhere in the plan. ✓
- Plumb companion (attack/defend only) onto attacker → Task 1 (`youCompanion` gates on role). ✓
- Persistent sidekick sprite → Task 2. ✓
- Action+number popover ("Follow-up! -N" / "Blocked N") → Task 3 Step 6. ✓
- Distinct animated beat (lunge / hop+shield) in its own timeframe → Task 3 Steps 2, 4, 7. ✓
- Fallback to role icon on sprite error → Task 2 Step 2 (`companionSpriteFailed`). ✓
- Combat pets only; forage/scout/economy show nothing → Task 1 role gate. ✓
- Player side only → `companion` only set on attacker; markup only in attacker `.side`. ✓

**Type consistency:** `BattleCompanion { role, spriteUrl, name }` defined in Task 1 and consumed identically in board-tab + template. `petAnim: 'attack'|'defend'|null` and `petPop: {text,kind:'dmg'|'block'}` defined in Task 3 Step 1 and used consistently in Steps 2/6/7. `companionSpriteFailed` introduced in Task 2, reused in Task 3. ✓

**Placeholder scan:** No TBD/TODO; every code step shows full code. ✓
