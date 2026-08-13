# Sigil Heat Indicator Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Make the HUD's Guild Sigil chip glow while you're in a dungeon — brighter with every sigil held — and tappable to reveal what those sigils are doing to the enemies in that cave.

**Architecture:** Purely presentational. The server already scales dungeon enemies by `1 + 0.40 × sigils_held`; nothing about that changes. The client mirrors the one scalar, derives everything else from the existing `sigilsHeld()` computed, and a pytest guard pins the mirror to the Python source of truth so the panel can never print a wrong multiplier.

**Tech Stack:** Angular 20 standalone components (signals/computed), SCSS, Python 3.11 + pytest for the drift guard.

**Design:** [2026-08-13-undercity-sigil-heat-indicator-design.md](2026-08-13-undercity-sigil-heat-indicator-design.md)

---

## Testing reality (read before starting)

This repo has **no JS test runner** — Karma/Jasmine were removed and `tsconfig.spec.json` is gone. Do not try `ng test`. For the Angular tasks the verification gate is `npm run build` (lint is unreliable here; the build is what's trusted). Only Task 1 has a genuine red-green test cycle, and it is a real one — write the test first and watch it fail.

Run all `npm` commands from the repo root, all `pytest` commands from `infrastructure/lambda/`.

---

## File structure

| File | Responsibility | Change |
|---|---|---|
| `infrastructure/lambda/tests/test_sigil_mirror.py` | Pins the client mirror to `undercity_config.DUNGEON_SIGIL_SCALING` | **Create** |
| `src/app/undercity/data/dungeons.ts` | Client mirror constant + the five flavor lines (already the home of `SIGILS_REQUIRED`) | Modify, after line 126 |
| `src/app/undercity/undercity-page.component.ts` | `inDungeon`, `sigilMult`, `sigilHeat`, `sigilLine`, panel open/close | Modify |
| `src/app/undercity/undercity-page.component.html` | Chip becomes a button; panel markup | Modify, lines 134-138 |
| `src/app/undercity/undercity-page.component.scss` | pointer-events carve-out, heat ramp, panel styles, reduced-motion | Modify |

No server file changes. No new component files — the chip and panel live in the page component that already owns the purse bar.

### One deliberate divergence from the design doc

The design says the glow is driven by a `--sigil-heat` custom property. This plan uses **discrete `.heat-1`…`.heat-5` classes** that each set CSS custom properties instead. Same result, same single-number input, but it avoids relying on Angular's `[style.--custom-prop]` binding and lets the ramp live entirely in SCSS where it can be read at a glance. Behavior is identical.

---

## Task 1: Mirror the scaling constant, guarded

The panel prints a literal `×2.2`. If someone retunes the Python scalar and the mirror drifts, the UI lies about a live mechanic. This task makes that impossible.

**Files:**
- Test: `infrastructure/lambda/tests/test_sigil_mirror.py` (create)
- Modify: `src/app/undercity/data/dungeons.ts` (after line 126)

- [ ] **Step 1: Write the failing test**

Create `infrastructure/lambda/tests/test_sigil_mirror.py`:

```python
"""The client mirrors DUNGEON_SIGIL_SCALING so the HUD sigil panel can print a
literal multiplier. A drifted mirror makes the UI lie about a live mechanic, so
pin the two together — same idiom as test_map_file.py's client-copy check."""
import re
import sys
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parents[1]))

LAMBDA_DIR = Path(__file__).resolve().parents[1]
REPO_ROOT = LAMBDA_DIR.parents[1]
DUNGEONS_TS = REPO_ROOT / 'src' / 'app' / 'undercity' / 'data' / 'dungeons.ts'


def _mirrored_scaling():
    src = DUNGEONS_TS.read_text(encoding='utf-8')
    m = re.search(r'export const DUNGEON_SIGIL_SCALING\s*=\s*([0-9.]+)\s*;', src)
    assert m, f'DUNGEON_SIGIL_SCALING not found in {DUNGEONS_TS}'
    return float(m.group(1))


def test_client_mirrors_dungeon_sigil_scaling():
    import undercity_config as config
    assert _mirrored_scaling() == config.DUNGEON_SIGIL_SCALING, (
        'src/app/undercity/data/dungeons.ts is out of sync with '
        'undercity_config.DUNGEON_SIGIL_SCALING — the HUD sigil panel would '
        'print the wrong multiplier.')
```

- [ ] **Step 2: Run the test to verify it fails**

```bash
cd infrastructure/lambda && python -m pytest tests/test_sigil_mirror.py -v
```

Expected: FAIL — `AssertionError: DUNGEON_SIGIL_SCALING not found in .../dungeons.ts`

- [ ] **Step 3: Add the mirror**

In `src/app/undercity/data/dungeons.ts`, immediately after line 126 (`export const SIGILS_REQUIRED = 3;`), add:

```ts
/**
 * Enemy stat multiplier per Guild Sigil held, inside a dungeon: a scaled enemy
 * is `base * (1 + DUNGEON_SIGIL_SCALING * sigilsHeld)`. Held counts run 0-5 —
 * five biome lairs exist though only SIGILS_REQUIRED are needed — so the
 * multiplier tops out at x3.0.
 *
 * MIRROR. Source of truth is DUNGEON_SIGIL_SCALING in
 * infrastructure/lambda/undercity_config.py. tests/test_sigil_mirror.py fails
 * while the two disagree, because the HUD sigil panel prints this number.
 */
export const DUNGEON_SIGIL_SCALING = 0.4;
```

- [ ] **Step 4: Run the test to verify it passes**

```bash
cd infrastructure/lambda && python -m pytest tests/test_sigil_mirror.py -v
```

Expected: PASS (1 passed)

- [ ] **Step 5: Prove the guard actually guards**

Temporarily change the TS constant to `0.5`, re-run the test, confirm it FAILS with the sync message, then change it back to `0.4` and confirm it passes again. A guard that cannot fail is not a guard.

- [ ] **Step 6: Commit**

```bash
git add infrastructure/lambda/tests/test_sigil_mirror.py src/app/undercity/data/dungeons.ts
git commit -m "feat(undercity): mirror DUNGEON_SIGIL_SCALING with a drift guard"
```

---

## Task 2: The five flavor lines

**Files:**
- Modify: `src/app/undercity/data/dungeons.ts` (after the constant from Task 1)

- [ ] **Step 1: Add the lines and the lookup**

Append directly below the `DUNGEON_SIGIL_SCALING` block:

```ts
/**
 * What the deep says about the sigils you carry — one line per held count.
 * Keys run 1-5: five biome lairs exist, only SIGILS_REQUIRED are needed, so a
 * player can legitimately hold more than three.
 */
export const SIGIL_HEAT_LINES: Record<number, string> = {
  1: 'One sigil on your belt, and the deep has started paying attention.',
  2: 'Two sigils. What lives down here can smell them on you now.',
  3: 'Three sigils ride your back. Every shadow in this cave knows the weight.',
  4: 'Four. The Undercity has stopped pretending you are welcome.',
  5: 'Five sigils. There is nothing neutral left between you and the Queen.',
};

/** Held sigils clamped into the 1-5 band the heat ramp and lines are keyed on. */
export function sigilHeatStep(held: number): number {
  return Math.min(5, Math.max(1, held));
}
```

- [ ] **Step 2: Verify the build still compiles**

```bash
npm run build
```

Expected: build succeeds (unused exports are fine — they're consumed in Task 3).

- [ ] **Step 3: Commit**

```bash
git add src/app/undercity/data/dungeons.ts
git commit -m "feat(undercity): sigil heat flavor lines"
```

---

## Task 3: Component state

**Files:**
- Modify: `src/app/undercity/undercity-page.component.ts` (import line 22; computeds near line 69; `ngOnDestroy` at line 420)

- [ ] **Step 1: Extend the data import**

Change line 22 from:

```ts
import { DUNGEONS, SIGILS_REQUIRED } from './data/dungeons';
```

to:

```ts
import {
  DUNGEONS,
  SIGILS_REQUIRED,
  DUNGEON_SIGIL_SCALING,
  SIGIL_HEAT_LINES,
  sigilHeatStep,
} from './data/dungeons';
```

- [ ] **Step 2: Add the computeds**

Immediately after the `sigilsHeld` computed (which ends at line 69 with `});`), add:

```ts
  /** True while standing on a depths node — the only region sigils empower.
   *  Same region test board-tab uses for its surface-only Reclaim guard. */
  protected readonly inDungeon = computed(() => {
    const pos = this.store.you()?.position;
    if (!pos) return false;
    return this.map()?.nodes.find((n) => n.id === pos)?.region === 'depths';
  });

  /** Glow step 1-5, driving the .heat-N class on the chip. */
  protected readonly sigilHeat = computed(() => sigilHeatStep(this.sigilsHeld()));

  /** The deep's line about what you're carrying. */
  protected readonly sigilLine = computed(() => SIGIL_HEAT_LINES[this.sigilHeat()]);

  /** Enemy stat multiplier the held sigils impose on dungeon fights — mirrors
   *  the server's `1 + DUNGEON_SIGIL_SCALING * held` (_scale_for_sigils).
   *  Rendered via toFixed because 1 + 0.4 * 3 is 2.2000000000000002 in IEEE754,
   *  and the panel must read "x2.2". */
  protected readonly sigilMultText = computed(
    () => `×${(1 + DUNGEON_SIGIL_SCALING * this.sigilsHeld()).toFixed(1)}`,
  );

  /** Whether the sigil detail panel (tap-to-expand) is open. */
  protected readonly showSigilDetails = signal(false);

  /** Outside-tap dismissal, live only while the panel is open. A document
   *  listener rather than a full-screen catcher div, so the board underneath
   *  stays draggable — see the same note on buffDismiss. */
  private sigilDismiss: ((e: PointerEvent) => void) | null = null;

  protected toggleSigilDetails(): void {
    if (this.showSigilDetails()) {
      this.closeSigilDetails();
      return;
    }
    this.showSigilDetails.set(true);
    // Both the chip and the panel sit inside .sigil-chip-wrap, so neither the
    // opening tap nor a tap inside the panel counts as "outside".
    this.sigilDismiss = (e: PointerEvent) => {
      if (e.target instanceof Element && e.target.closest('.sigil-chip-wrap')) return;
      this.closeSigilDetails();
    };
    document.addEventListener('pointerdown', this.sigilDismiss);
  }

  private closeSigilDetails(): void {
    this.showSigilDetails.set(false);
    if (this.sigilDismiss) {
      document.removeEventListener('pointerdown', this.sigilDismiss);
      this.sigilDismiss = null;
    }
  }
```

- [ ] **Step 3: Clean up the listener on destroy**

In `ngOnDestroy` (line 420), add `this.closeSigilDetails();` directly below the existing `this.closeBuffDetails();` so the result reads:

```ts
  ngOnDestroy(): void {
    document.body.classList.remove('undercity-page');
    this.closeBuffDetails();
    this.closeSigilDetails();
    this.store.stopPolling();
    if (this.sporeDeltaTimer) clearTimeout(this.sporeDeltaTimer);
    if (this.sporePulseTimer) clearTimeout(this.sporePulseTimer);
    if (this.lobbyTimer) clearInterval(this.lobbyTimer);
  }
```

- [ ] **Step 4: Verify the build**

```bash
npm run build
```

Expected: build succeeds.

- [ ] **Step 5: Commit**

```bash
git add src/app/undercity/undercity-page.component.ts
git commit -m "feat(undercity): sigil chip state — dungeon heat and panel toggle"
```

---

## Task 4: The chip and the panel

**Files:**
- Modify: `src/app/undercity/undercity-page.component.html` (lines 134-138)

- [ ] **Step 1: Replace the inert chip**

Replace lines 134-138 in their entirety:

```html
            @if (sigilsHeld() > 0) {
              <span class="purse-chip" title="Claim Guild Sigils from lair bosses to unseal the Queen">
                <mat-icon class="mi gold">workspace_premium</mat-icon> {{ sigilsHeld() }}/{{ sigilsRequired }}
              </span>
            }
```

with:

The heat class goes on the **wrapper**, not the button. The panel is a sibling of the button, so it can only inherit the `--sigil-hue` custom property if that property is set on their shared parent. `.sigil-hot` stays on the button, since only the button glows.

```html
            @if (sigilsHeld() > 0) {
              <span [class]="'sigil-chip-wrap heat-' + sigilHeat()">
                <button
                  type="button"
                  class="purse-chip sigil-chip"
                  [class.sigil-hot]="inDungeon()"
                  [attr.aria-expanded]="showSigilDetails()"
                  aria-label="Guild Sigils — tap for what they do to the deep"
                  (click)="toggleSigilDetails()"
                >
                  <mat-icon class="mi gold">workspace_premium</mat-icon>
                  {{ sigilsHeld() }}/{{ sigilsRequired }}
                </button>
                @if (showSigilDetails()) {
                  <!-- No backdrop catcher: an outside pointerdown dismisses this
                       (see toggleSigilDetails), so the board stays draggable. -->
                  <div class="sigil-details" role="dialog" aria-label="Guild Sigil effect">
                    <h4 class="buff-details-title">
                      {{ inDungeon() ? 'The sigils burn' : 'The sigils wait' }}
                    </h4>
                    <p class="sigil-line">
                      @if (inDungeon()) {
                        {{ sigilLine() }}
                      } @else {
                        In the deep, every sigil you carry makes what lives there stronger.
                      }
                    </p>
                    <div class="sigil-stat-row">
                      <span class="sigil-stat-name">Cave dwellers</span>
                      <span class="sigil-stat-mult">{{ sigilMultText() }}</span>
                      <span class="sigil-stat-stats">HP ATK DEF</span>
                    </div>
                    <div class="sigil-stat-row">
                      <span class="sigil-stat-name">Lair guardian</span>
                      <span class="sigil-stat-mult">{{ sigilMultText() }}</span>
                      <span class="sigil-stat-stats">ATK DEF</span>
                    </div>
                    <p class="sigil-foot">
                      Your home ring is untouched — only the deep answers a sigil.
                    </p>
                  </div>
                }
              </span>
            }
```

- [ ] **Step 2: Verify the build**

```bash
npm run build
```

Expected: build succeeds.

- [ ] **Step 3: Commit**

```bash
git add src/app/undercity/undercity-page.component.html
git commit -m "feat(undercity): tappable sigil chip with the effect panel"
```

---

## Task 5: Glow and panel styles

**Files:**
- Modify: `src/app/undercity/undercity-page.component.scss` (`.purse-chip` block ends line 332; `.buff-details` at line 496; reduced-motion block at line 951)

- [ ] **Step 1: Share the panel shell with `.buff-details`**

At line 496, change the selector from:

```scss
.buff-details {
```

to:

```scss
.buff-details,
.sigil-details {
```

- [ ] **Step 2: Add the chip, heat ramp, and panel rules**

Insert after the `.purse-chip .mi.gold` rule (line 335):

```scss
// The purse bar is pointer-events:none so it never eats a board drag. The sigil
// chip is the one deliberate exception — it's a real button that opens the
// sigil panel. Everything else in .hud-purse stays inert. Don't "fix" this.
.sigil-chip-wrap {
  position: relative;
  display: inline-flex;
  pointer-events: auto;
}

// A <button> brings its own font and chrome; keep it identical to the span chip.
.purse-chip.sigil-chip {
  font: inherit;
  font-size: 0.82rem;
  font-weight: 600;
  cursor: pointer;
  transition:
    border-color 0.18s ease,
    box-shadow 0.18s ease;
}

// Sigil heat. One step per sigil held (five biome lairs exist), ramping glow
// spread, alpha, hue and pulse speed off a single number. Declared on the
// WRAPPER so the detail panel — a sibling of the button — inherits the hue too.
// The ramp only paints while .sigil-hot is on, i.e. while standing in the depths.
.sigil-chip-wrap.heat-1 { --sigil-hue: 251, 191, 36; --sigil-glow: 6px;  --sigil-alpha: 0.30; --sigil-speed: 3.2s; }
.sigil-chip-wrap.heat-2 { --sigil-hue: 252, 174, 26; --sigil-glow: 9px;  --sigil-alpha: 0.42; --sigil-speed: 2.6s; }
.sigil-chip-wrap.heat-3 { --sigil-hue: 251, 147, 20; --sigil-glow: 12px; --sigil-alpha: 0.54; --sigil-speed: 2.0s; }
.sigil-chip-wrap.heat-4 { --sigil-hue: 247, 122, 16; --sigil-glow: 15px; --sigil-alpha: 0.66; --sigil-speed: 1.5s; }
.sigil-chip-wrap.heat-5 { --sigil-hue: 242, 96, 12;  --sigil-glow: 19px; --sigil-alpha: 0.78; --sigil-speed: 1.1s; }

.purse-chip.sigil-chip.sigil-hot {
  border-color: rgba(var(--sigil-hue), 0.65);
  box-shadow: 0 0 var(--sigil-glow) rgba(var(--sigil-hue), var(--sigil-alpha));
  animation: uc-sigil-heat var(--sigil-speed) ease-in-out infinite;

  .mi.gold {
    color: rgb(var(--sigil-hue));
  }
}

@keyframes uc-sigil-heat {
  0%,
  100% {
    filter: brightness(1);
  }
  50% {
    filter: brightness(1.35);
  }
}

// The buff panel hangs off the right of the HUD; the sigil chip sits at the
// left of the purse row, so its panel anchors left instead.
.sigil-details {
  right: auto;
  left: 0;
}

.sigil-line {
  margin: 0;
  font-size: 0.78rem;
  line-height: 1.35;
  color: #cfe3d4;
}

.sigil-stat-row {
  display: flex;
  align-items: baseline;
  gap: 8px;
  font-size: 0.75rem;
  font-variant-numeric: tabular-nums;
}

.sigil-stat-name {
  flex: 1;
  color: #9fc0a4;
}

.sigil-stat-mult {
  font-weight: 700;
  color: rgb(var(--sigil-hue, 251, 191, 36));
}

.sigil-stat-stats {
  color: #7f9a86;
  letter-spacing: 0.04em;
}

.sigil-foot {
  margin: 0;
  font-size: 0.7rem;
  line-height: 1.3;
  color: #7f9a86;
}
```

- [ ] **Step 3: Honor reduced motion**

Extend the block at line 951 so it reads:

```scss
@media (prefers-reduced-motion: reduce) {
  .lvl-rays {
    animation: uc-lvl-in 0.4s ease-out both;
  }

  // Keep the glow (it carries the information); drop only the pulse.
  .purse-chip.sigil-chip.sigil-hot {
    animation: none;
  }
}
```

- [ ] **Step 4: Verify the build**

```bash
npm run build
```

Expected: build succeeds.

- [ ] **Step 5: Commit**

```bash
git add src/app/undercity/undercity-page.component.scss
git commit -m "feat(undercity): sigil heat glow ramp and panel styling"
```

---

## Task 6: Full verification

**Files:** none — verification only.

- [ ] **Step 1: Full Python suite**

```bash
cd infrastructure/lambda && python -m pytest tests -q
```

Expected: `1418 passed` (baseline was 1417, plus the new mirror guard). Zero failures.

- [ ] **Step 2: Production build**

```bash
npm run build
```

Expected: build succeeds with no errors.

- [ ] **Step 3: Manual check in the browser**

Use the `run-undercity` skill to launch and drive the game. Confirm each of these:

1. At **0 sigils** the chip is absent entirely.
2. On the **surface** with ≥1 sigil: chip visible, no glow, no pulse. Tapping opens the panel titled "The sigils wait" with the future-tense line.
3. **Inside a dungeon**: chip glows and pulses. The glow is visibly hotter and faster at 3 sigils than at 1.
4. The panel's multiplier matches the table: 1→×1.4, 2→×1.8, 3→×2.2, 4→×2.6, 5→×3.0. Confirm it reads `×2.2` and never `×2.2000000000000002`.
5. Guardian row says **ATK DEF** only — never HP.
6. With the panel open, **the board still drags**. This is the regression the document-listener dismissal exists to prevent.
7. Tapping outside the panel closes it; tapping inside it does not.

- [ ] **Step 4: Report**

State the pytest count and build result explicitly. Do not claim completion without both. Per repo convention, deployment is the user's to run — end with tests green and note that a deploy is needed.

---

## Self-review notes

**Spec coverage:** trigger (Task 3) · pointer-events carve-out (Task 5 Step 2) · scaling glow (Task 5) · five flavor lines (Task 2) · panel with two stat rows and footnote (Task 4) · surface future-tense variant (Task 4) · reduced motion (Task 5 Step 3) · drift guard (Task 1) · no server change (no task touches `infrastructure/lambda/*.py` except the new test file). All covered.

**Invariants from the design, and where they hold:**
- Chip never appears at 0 sigils — the untouched `@if (sigilsHeld() > 0)` wrapper.
- Glow only on depths nodes — `[class.sigil-hot]="inDungeon()"`.
- Purse bar stays inert apart from this chip — `pointer-events: auto` is scoped to `.sigil-chip-wrap`.
- Displayed multiplier always equals the server's — Task 1's guard.
- Panel never claims guardians scale HP — hardcoded `ATK DEF` in the guardian row.
