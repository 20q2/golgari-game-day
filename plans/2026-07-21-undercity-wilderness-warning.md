# Ashen Wilds First-Entry Warning Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** The first time an under-level-5 player walks across the border into the Ashen Wilds during a game session, show a danger notice they must accept ("Press on") or decline ("Turn back") before the step commits.

**Architecture:** Purely a board-client change in `board-tab.component.{ts,html}`. During the space-by-space walk in `onTapNode`, a guard detects the first wilderness border-crossing (under-leveled, not yet warned this season) and holds the step, showing a modal that reuses the existing `uc-modal` pattern. "Once per session" is persisted in `localStorage` keyed by `seasonId`. No backend, no balance, no new files.

**Tech Stack:** Angular 20 standalone component, signals, Angular Material icons, browser `localStorage`.

> **Testing note:** This repo has **no** frontend test runner (Karma/Jasmine were removed; `ng test` does not work — see CLAUDE.md). TDD-with-a-runner is therefore not possible for this change. Verification is a successful production/dev build plus a scripted manual walkthrough (Task 3). Do not attempt to add or run a frontend test framework.

---

## File Structure

- **Modify** `src/app/undercity/tabs/board-tab.component.ts`
  - Add `wildsPrompt` signal (held-step node id).
  - Refactor the forward-step body of `onTapNode` into a shared `commitStep(step, nodeId)` helper.
  - Add the trigger guard `shouldWarnWilds` + localStorage helpers + `pressOnWilds` / `turnBackWilds`.
- **Modify** `src/app/undercity/tabs/board-tab.component.html`
  - Add the warning modal block (reusing `uc-modal-backdrop` / `uc-modal` / `choice-grid` / `uc-btn` / `uc-btn-primary`, all already used elsewhere in this template).

No files are created.

---

## Task 1: Refactor the walk step into a shared `commitStep` helper

This is a pure refactor with no behavior change — it isolates the forward-step logic so both a direct tap and the "Press on" confirmation run identical code.

**Files:**
- Modify: `src/app/undercity/tabs/board-tab.component.ts` (the `onTapNode` method, currently ~lines 880–915)

- [ ] **Step 1: Replace the forward-step block in `onTapNode`**

Find this block inside `onTapNode`:

```ts
      if (step.left >= 1 && this.stepChoices(step).includes(nodeId)) {
        this.hideInfo();
        this.stepping.set({ path: [...step.path, nodeId], left: step.left - 1 });
        this.board?.centerOn(nodeId);
        // Bonk: a sealed barrier halts the walk immediately — you stop at the
        // wall and spend the rest of the roll, matching the server's dests.
        const sealedStop =
          this.map.nodes.find((n) => n.id === nodeId)?.type === 'barrier' &&
          !this.store.barriersOpen().includes(nodeId);
        if (step.left === 1 || sealedStop) void this.move(nodeId);
        return;
      }
```

Replace it with (the Wilds guard is added in Task 2 — for now just delegate to `commitStep`):

```ts
      if (step.left >= 1 && this.stepChoices(step).includes(nodeId)) {
        this.commitStep(step, nodeId);
        return;
      }
```

- [ ] **Step 2: Add the `commitStep` helper directly after `onTapNode`**

Insert this method immediately after the closing brace of `onTapNode`:

```ts
  /** Advance the local walk onto `nodeId`, honoring the sealed-barrier bonk and
   *  the last-step auto-commit. Shared by a direct tap and the Ashen Wilds
   *  "Press on" confirmation so both paths behave identically. */
  private commitStep(step: StepState, nodeId: string): void {
    this.hideInfo();
    this.stepping.set({ path: [...step.path, nodeId], left: step.left - 1 });
    this.board?.centerOn(nodeId);
    // Bonk: a sealed barrier halts the walk immediately — you stop at the
    // wall and spend the rest of the roll, matching the server's dests.
    const sealedStop =
      this.map.nodes.find((n) => n.id === nodeId)?.type === 'barrier' &&
      !this.store.barriersOpen().includes(nodeId);
    if (step.left === 1 || sealedStop) void this.move(nodeId);
  }
```

- [ ] **Step 3: Verify the build compiles**

Run (npm is invoked through the Bash tool in this repo):

```bash
npm run build
```

Expected: build succeeds (`Application bundle generation complete`), no TypeScript errors. Behavior is unchanged at this point — walking still works exactly as before.

- [ ] **Step 4: Commit**

```bash
git add src/app/undercity/tabs/board-tab.component.ts
git commit -m "refactor(undercity): extract commitStep from onTapNode walk handler"
```

---

## Task 2: Add the Ashen Wilds warning trigger + state

**Files:**
- Modify: `src/app/undercity/tabs/board-tab.component.ts`

- [ ] **Step 1: Add the `wildsPrompt` signal**

Directly after the existing `private readonly stepping = signal<StepState | null>(null);` line (~line 199), add:

```ts
  /** Node id of the wilderness step held pending the danger notice, or null. */
  protected readonly wildsPrompt = signal<string | null>(null);
```

- [ ] **Step 2: Insert the Wilds guard into `onTapNode`**

Update the forward-step block from Task 1 so it checks the guard before committing:

```ts
      if (step.left >= 1 && this.stepChoices(step).includes(nodeId)) {
        // First walk across the Ashen Wilds border, under-leveled, this
        // season: hold the step and warn before committing.
        if (this.shouldWarnWilds(step, nodeId)) {
          this.hideInfo();
          this.wildsPrompt.set(nodeId);
          return;
        }
        this.commitStep(step, nodeId);
        return;
      }
```

- [ ] **Step 3: Add the guard + localStorage helpers + accept/decline handlers**

Insert this block immediately after the `commitStep` method from Task 1:

```ts
  // ── Ashen Wilds first-entry warning ─────────────────────────────────────────

  private regionOf(nodeId: string | null): string | undefined {
    return nodeId ? this.map.nodes.find((n) => n.id === nodeId)?.region : undefined;
  }

  /** localStorage flag key for "already warned this season", or null if the
   *  season id isn't loaded yet. */
  private wildsWarnKey(): string | null {
    const seasonId = this.store.season()?.seasonId;
    return seasonId ? `uc-wilds-warned:${seasonId}` : null;
  }

  private wildsWarned(): boolean {
    const key = this.wildsWarnKey();
    // No season id → fail open (show the notice); otherwise trust the flag.
    return key ? localStorage.getItem(key) === '1' : false;
  }

  /** True when this step first crosses into the Ashen Wilds, the player is
   *  under the recommended level, and they haven't been warned this season. */
  private shouldWarnWilds(step: StepState, nodeId: string): boolean {
    return (
      this.regionOf(nodeId) === 'wilderness' &&
      this.regionOf(stepPos(step)) !== 'wilderness' &&
      (this.store.you()?.level ?? 0) < 5 &&
      !this.wildsWarned()
    );
  }

  /** "Press on" — remember the warning for this season and take the held step. */
  protected pressOnWilds(): void {
    const nodeId = this.wildsPrompt();
    const step = this.stepping();
    this.wildsPrompt.set(null);
    const key = this.wildsWarnKey();
    if (key) localStorage.setItem(key, '1');
    if (nodeId && step) this.commitStep(step, nodeId);
  }

  /** "Turn back" — dismiss; the walk is untouched so other routes stay open. */
  protected turnBackWilds(): void {
    this.wildsPrompt.set(null);
  }
```

Note: `stepPos` is already imported/defined at module scope (used elsewhere in this file), and `this.store.season()` / `this.store.you()` are existing computed signals on `UndercityStateService`.

- [ ] **Step 4: Verify the build compiles**

```bash
npm run build
```

Expected: build succeeds, no TypeScript errors. (No modal renders yet — that's Task 3 — but the guard sets `wildsPrompt` when crossing the border under level 5.)

- [ ] **Step 5: Commit**

```bash
git add src/app/undercity/tabs/board-tab.component.ts
git commit -m "feat(undercity): guard first Ashen Wilds entry (under lvl 5, once per season)"
```

---

## Task 3: Add the warning modal + verify end-to-end

**Files:**
- Modify: `src/app/undercity/tabs/board-tab.component.html`

- [ ] **Step 1: Add the modal block**

Immediately after the respawn-gate modal block (the `@if (store.you()?.pendingRespawn; as pr) { … }` block, closing `}` around line 137), insert:

```html
  <!-- First-entry warning for the Ashen Wilds (wilderness frontier). No
       backdrop-click dismissal: this is a decision, so a button must be tapped. -->
  @if (wildsPrompt()) {
    <div class="uc-modal-backdrop">
      <div class="uc-modal" (click)="$event.stopPropagation()">
        <h3><mat-icon class="mi">warning</mat-icon> The Ashen Wilds</h3>
        <p class="modal-sub">
          Beyond this border the ash-choked frontier crawls with evolved
          predators &mdash; far deadlier than surface fauna. It's recommended you
          reach Level&nbsp;5 before venturing in. Press on anyway?
        </p>
        <div class="choice-grid">
          <button class="uc-btn" (click)="turnBackWilds()">
            <mat-icon class="mi">undo</mat-icon> Turn back
          </button>
          <button class="uc-btn uc-btn-primary" (click)="pressOnWilds()">
            <mat-icon class="mi">local_fire_department</mat-icon> Press on
          </button>
        </div>
      </div>
    </div>
  }
```

All classes (`uc-modal-backdrop`, `uc-modal`, `modal-sub`, `choice-grid`, `uc-btn`, `uc-btn-primary`) and the `<mat-icon class="mi">` pattern are already used by sibling modals in this same template.

- [ ] **Step 2: Verify the build compiles**

```bash
npm run build
```

Expected: build succeeds, no template errors.

- [ ] **Step 3: Manual walkthrough (dev server)**

Run `npm start`, open `http://localhost:4200`, enter the Undercity via the navbar logo, and confirm each case:

1. **Under level 5, first crossing:** With a level < 5 creature, roll and walk a route whose next step lands on a `wilderness`-region node. Expected: the walk halts one space short of the Wilds and the "The Ashen Wilds" modal appears. Backdrop click does nothing.
2. **Turn back:** Click **Turn back**. Expected: modal closes, token stays put, remaining steps are intact — you can walk a different direction.
3. **Press on:** Re-approach the border and click **Press on**. Expected: modal closes and the held step commits (token advances into the Wilds; if it was the last step or a sealed barrier, the move resolves).
4. **No re-show same season:** Walk out and back into the Wilds again. Expected: no modal (already warned this season).
5. **Level 5+ silent:** With a level 5+ creature (or after leveling), cross the border. Expected: no modal ever.
6. **New season re-warns (spot check):** In devtools, delete the `uc-wilds-warned:<seasonId>` localStorage key (simulating a fresh game) and cross under level 5. Expected: modal shows again.

- [ ] **Step 4: Commit**

```bash
git add src/app/undercity/tabs/board-tab.component.html
git commit -m "feat(undercity): Ashen Wilds first-entry danger notice modal"
```

---

## Self-Review

- **Spec coverage:** Trigger conditions (border-crossing + under level 5 + not-warned) → Task 2 `shouldWarnWilds`. Once-per-season persistence → Task 2 `wildsWarnKey`/`wildsWarned` (localStorage by `seasonId`), fail-open when no season → covered. UI (reused modal, Turn back / Press on, no backdrop dismiss) → Task 3. Held-step + identical commit path for both entry routes → Task 1 `commitStep` + Task 2 `pressOnWilds`. Non-goals (teleport, backend) → not implemented, as specified.
- **Placeholder scan:** none — every code step shows full code.
- **Type consistency:** `commitStep(step: StepState, nodeId: string)` defined once (Task 1) and called identically from `onTapNode` (Task 2) and `pressOnWilds` (Task 2). `wildsPrompt`, `pressOnWilds`, `turnBackWilds` names match between the `.ts` handlers and the `.html` bindings. `stepPos`, `StepState`, `store.season()`, `store.you()` all pre-exist in the file/service.
