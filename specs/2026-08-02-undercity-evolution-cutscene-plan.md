# Evolution Cutscene Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Play a Pokémon-style cutscene (silhouette → accelerating strobe-swap → bloom from silhouette into color) when a creature evolves, instead of the instant overlay-close + toast.

**Architecture:** Client-only. The creature tab snapshots the old sprite data URL, runs the existing `evolve` server action, snapshots the new sprite data URL, then drives a full-screen overlay of two stacked `<img>` silhouette layers animated purely by CSS keyframes. A single JS timer (matched to the CSS timeline) auto-dismisses; tapping skips early. Honors `prefers-reduced-motion` with a plain cross-fade.

**Tech Stack:** Angular 20 standalone signals, SCSS keyframes. No new engine, no server/balance changes.

**Testing note:** This repo has **no frontend test runner** (see CLAUDE.md — Karma/Jasmine removed, don't run `ng test`). Verification is `npm run build` (compiles + typechecks) plus a manual pass via the `run-undercity` skill. Tasks below use build-green + commit as their gate instead of unit tests.

---

## File Structure

- **Modify** `src/app/undercity/tabs/creature-tab.component.ts` — cutscene state signal, timer, reworked `evolve()`, `endEvolveCutscene()`.
- **Modify** `src/app/undercity/tabs/creature-tab.component.html` — the cutscene overlay markup.
- **Modify** `src/app/undercity/tabs/creature-tab.component.scss` — overlay layout + keyframes.

All three files already own the evolution UI and the hero-portrait sprite rendering (`spriteUrl` computed), so the change stays co-located.

---

## Task 1: Cutscene state + reworked `evolve()` (TypeScript)

**Files:**
- Modify: `src/app/undercity/tabs/creature-tab.component.ts`

Context you need:
- Existing signals live around line 108 (`busy`, `toast`).
- `spriteUrl` computed (line 446) returns the current creature's recolored sprite **data URL** (`string | null`), derived from `store.you()` — it recomputes automatically after the store updates to the new form.
- `run(fn)` (line 697) wraps busy-state + error toast. `showToast(text)` (line 709) is private, same class.
- Current `evolve()` is at line 618.

- [ ] **Step 1: Add cutscene state fields**

Insert directly after the `toast` signal (line 109):

```ts
  /** Evolution cutscene: old→new sprite data URLs, or null when idle. */
  protected readonly evolveCutscene = signal<{ from: string; to: string } | null>(null);
  /** Auto-dismiss timer for the cutscene. */
  private cutsceneTimer: ReturnType<typeof setTimeout> | null = null;
  /** Toast queued to fire when the cutscene finishes. */
  private pendingCutsceneToast: string | null = null;
  /** Full cutscene runtime — MUST match the CSS timeline in the .scss. */
  private static readonly CUTSCENE_MS = 2700;
  /** Reduced-motion runtime — MUST match the reduced-motion CSS fallback. */
  private static readonly CUTSCENE_REDUCED_MS = 600;
```

- [ ] **Step 2: Replace `evolve()` with the snapshot + cutscene version**

Replace the whole method at line 618:

```ts
  async evolve(form: FormInfo): Promise<void> {
    // Snapshot the CURRENT sprite (old form) before the server swaps our form.
    const from = this.spriteUrl();
    await this.run(async () => {
      await this.store.action('evolve', { form: form.id });
      this.showEvolve.set(false);
      // spriteUrl recomputes off the now-updated store.you() → new form.
      const to = this.spriteUrl();
      const doneToast = `You are now a ${form.name}! Fully healed.`;
      if (from && to && from !== to) {
        this.playEvolveCutscene(from, to, doneToast);
      } else {
        // Missing sprite (or identical) → fall back to the instant behavior.
        this.showToast(doneToast);
      }
    });
  }

  /** Kick off the silhouette→strobe→color cutscene. */
  private playEvolveCutscene(from: string, to: string, doneToast: string): void {
    if (this.cutsceneTimer) clearTimeout(this.cutsceneTimer);
    const reduced =
      typeof window !== 'undefined' &&
      !!window.matchMedia?.('(prefers-reduced-motion: reduce)').matches;
    const dur = reduced
      ? CreatureTabComponent.CUTSCENE_REDUCED_MS
      : CreatureTabComponent.CUTSCENE_MS;
    this.pendingCutsceneToast = doneToast;
    this.evolveCutscene.set({ from, to });
    this.cutsceneTimer = setTimeout(() => this.endEvolveCutscene(), dur);
  }

  /** End the cutscene (natural completion or tap-to-skip) and fire the toast. */
  protected endEvolveCutscene(): void {
    if (!this.evolveCutscene()) return;
    if (this.cutsceneTimer) {
      clearTimeout(this.cutsceneTimer);
      this.cutsceneTimer = null;
    }
    this.evolveCutscene.set(null);
    if (this.pendingCutsceneToast) {
      this.showToast(this.pendingCutsceneToast);
      this.pendingCutsceneToast = null;
    }
  }
```

Note: `showToast` is private but these methods are in the same class, so the call is legal.

- [ ] **Step 3: Build to verify it compiles**

Run: `npm run build`
Expected: build succeeds (no TS errors). The overlay isn't wired to markup yet, so nothing renders — that's fine.

- [ ] **Step 4: Commit**

```bash
git add src/app/undercity/tabs/creature-tab.component.ts
git commit -m "feat(undercity): evolution cutscene state + snapshot old/new sprite"
```

---

## Task 2: Cutscene overlay markup (HTML)

**Files:**
- Modify: `src/app/undercity/tabs/creature-tab.component.html`

Context: the evolve choice overlay (`@if (showEvolve())`) ends at line 656. Add the cutscene block right after it, still inside the outer `@if (store.you(); as you)`.

- [ ] **Step 1: Add the cutscene overlay after the evolve-overlay block**

Insert after line 656 (`}` closing the `showEvolve` block):

```html
    <!-- Evolution cutscene — silhouette → strobe-swap → color reveal -->
    @if (evolveCutscene(); as cut) {
      <div class="evolve-cutscene" (click)="endEvolveCutscene()">
        <div class="ec-stage">
          <img class="ec-sprite ec-from" [src]="cut.from" alt="" />
          <img class="ec-sprite ec-to" [src]="cut.to" alt="" />
        </div>
        <div class="ec-flash"></div>
        <p class="ec-skip">tap to skip</p>
      </div>
    }
```

- [ ] **Step 2: Build to verify template compiles**

Run: `npm run build`
Expected: build succeeds. (Overlay is unstyled until Task 3, but valid.)

- [ ] **Step 3: Commit**

```bash
git add src/app/undercity/tabs/creature-tab.component.html
git commit -m "feat(undercity): evolution cutscene overlay markup"
```

---

## Task 3: Cutscene styles + keyframes (SCSS)

**Files:**
- Modify: `src/app/undercity/tabs/creature-tab.component.scss`

Context: the existing `.evolve-overlay` block is at line 1131 (fixed, inset 0, z-index 1200, dark backdrop). Reuse that z-layer family. Append the cutscene styles at the **end** of the file.

The timeline below spans 2700ms (100% = 2700ms). Key marks: charge 0–500ms (0–18.5%), strobe 500–1700ms (18.5–63%, accelerating beats), burst 1700–2000ms (63–74%), reveal 2000–2700ms (74–100%). Silhouette = `filter: brightness(0)`; color reveal ramps `brightness(0)→brightness(1)`. The strobe only blinks the **new** sprite (`.ec-to`) on top of the always-visible old silhouette (`.ec-from`), so only one strobe keyframe set is needed and the two are guaranteed complementary.

- [ ] **Step 1: Append the cutscene styles**

Add at the end of `creature-tab.component.scss`:

```scss
/* ---- Evolution cutscene ---- */
.evolve-cutscene {
  position: fixed;
  inset: 0;
  z-index: 1250; // just above .evolve-overlay (1200)
  background: radial-gradient(circle at 50% 45%, rgba(24, 32, 26, 0.9), rgba(4, 6, 4, 0.98));
  display: flex;
  flex-direction: column;
  align-items: center;
  justify-content: center;
  gap: 18px;
  overflow: hidden;
  cursor: pointer;
}

.ec-stage {
  position: relative;
  width: min(62vw, 260px);
  height: min(62vw, 260px);
}

.ec-sprite {
  position: absolute;
  inset: 0;
  width: 100%;
  height: 100%;
  object-fit: contain;
  filter: brightness(0);
  will-change: opacity, filter, transform;
}

.ec-from {
  animation: ec-from 2700ms linear forwards;
}
.ec-to {
  opacity: 0;
  animation: ec-to 2700ms linear forwards;
}

.ec-flash {
  position: fixed;
  inset: 0;
  background: #fff;
  opacity: 0;
  pointer-events: none;
  animation: ec-flash 2700ms linear forwards;
}

.ec-skip {
  margin: 0;
  font-size: 0.8rem;
  letter-spacing: 0.08em;
  text-transform: uppercase;
  color: rgba(183, 228, 199, 0.55);
}

/* Old silhouette: pops in, breathes, underlies the strobe, then clears before color reveal. */
@keyframes ec-from {
  0%    { opacity: 0; filter: brightness(0); transform: scale(0.9); }
  6%    { opacity: 1; transform: scale(1); }
  12%   { transform: scale(1.05); }
  18.5% { transform: scale(1); }
  63%   { opacity: 1; filter: brightness(0); }
  74%   { opacity: 0; }
  100%  { opacity: 0; }
}

/* New sprite: blinks over the old silhouette on accelerating beats,
   settles, then blooms from silhouette (brightness 0) into color (brightness 1). */
@keyframes ec-to {
  0%    { opacity: 0; filter: brightness(0); transform: scale(1); }
  18.5% { opacity: 0; filter: brightness(0); }
  27.8% { opacity: 1; filter: brightness(0); }
  35.9% { opacity: 0; filter: brightness(0); }
  43.0% { opacity: 1; filter: brightness(0); }
  49.3% { opacity: 0; filter: brightness(0); }
  54.8% { opacity: 1; filter: brightness(0); }
  59.6% { opacity: 0; filter: brightness(0); }
  63.0% { opacity: 1; filter: brightness(0); transform: scale(1); }
  74.1% { opacity: 1; filter: brightness(0); transform: scale(1.12); }
  100%  { opacity: 1; filter: brightness(1); transform: scale(1); }
}

/* White veil: small beat flashes, then a big burst before the color reveal. */
@keyframes ec-flash {
  0%, 18.5% { opacity: 0; }
  27.8% { opacity: 0.25; }
  30%   { opacity: 0; }
  43.0% { opacity: 0.32; }
  45%   { opacity: 0; }
  54.8% { opacity: 0.42; }
  56.5% { opacity: 0; }
  63.0% { opacity: 0.5; }
  64.5% { opacity: 0; }
  68%   { opacity: 0.95; }
  74%   { opacity: 0.55; }
  82%   { opacity: 0; }
  100%  { opacity: 0; }
}

/* Reduced motion: no strobe/flash — just cross-fade to the colored new sprite. */
@media (prefers-reduced-motion: reduce) {
  .ec-from { animation: none; opacity: 0; }
  .ec-flash { animation: none; opacity: 0; }
  .ec-to {
    filter: brightness(1);
    animation: ec-reveal-reduced 500ms ease forwards;
  }
  @keyframes ec-reveal-reduced {
    0%   { opacity: 0; }
    100% { opacity: 1; }
  }
}
```

- [ ] **Step 2: Build to verify SCSS compiles**

Run: `npm run build`
Expected: build succeeds, no SCSS errors.

- [ ] **Step 3: Commit**

```bash
git add src/app/undercity/tabs/creature-tab.component.scss
git commit -m "feat(undercity): evolution cutscene styles + keyframes"
```

---

## Task 4: Manual verification

**Files:** none (verification only).

- [ ] **Step 1: Build the app**

Run: `npm run build`
Expected: green.

- [ ] **Step 2: Drive the flow via the run-undercity skill**

Launch the game (per the `run-undercity` skill), reach a creature that is evolve-ready (`showEvolve` opens the choice overlay), and pick a form. Confirm:
- The old sprite snaps to a black silhouette.
- It strobe-flickers between the old and new shapes, accelerating, with white beat-flashes.
- A big white burst, then the new sprite **fades from silhouette into full color**.
- After it ends, the hero portrait shows the new form and the "You are now a …!" toast fires.
- Tapping the overlay mid-animation skips straight to the end (toast fires, no stuck overlay).

- [ ] **Step 3: Verify reduced-motion path**

In the browser devtools, emulate `prefers-reduced-motion: reduce` (Rendering tab), evolve again, and confirm it does a plain quick cross-fade to the colored new sprite (no strobe/flash) and still fires the toast.

---

## Self-Review

**Spec coverage:**
- Snapshot old before / new after action → Task 1, Step 2. ✓
- Fallback when a sprite snapshot is null → Task 1, Step 2 (`if (from && to …)` else instant toast). ✓
- Full-screen overlay, two img layers + flash veil → Tasks 2 & 3. ✓
- Charge / strobe-swap (accelerating) / burst / reveal (silhouette→color) → Task 3 keyframes. ✓
- Tap-to-skip → `(click)="endEvolveCutscene()"` (Task 2) + early-clear logic (Task 1). ✓
- `prefers-reduced-motion` cross-fade + matched JS timer (600ms) → Task 3 media query + Task 1 `CUTSCENE_REDUCED_MS`. ✓
- No server/engine/balance changes → confirmed, client files only. ✓

**Placeholder scan:** No TBD/TODO; every code step is complete. ✓

**Type/name consistency:** `evolveCutscene` signal, `endEvolveCutscene()`, `playEvolveCutscene()`, `pendingCutsceneToast`, `cutsceneTimer`, `CUTSCENE_MS`, `CUTSCENE_REDUCED_MS` used identically across TS and template. CSS class names `evolve-cutscene / ec-stage / ec-sprite / ec-from / ec-to / ec-flash / ec-skip` match between HTML and SCSS. JS `CUTSCENE_MS = 2700` matches the `2700ms` CSS animation duration; `CUTSCENE_REDUCED_MS = 600` covers the 500ms reduced-motion fade with headroom. ✓
