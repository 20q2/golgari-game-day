# Undercity Bottom Action Band Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Consolidate each Undercity play tab's action controls into one consistent "action band" that sits in a fixed slot directly above the main navbar, morphing its contents per tab and per moment.

**Architecture:** A tiny shared presentational shell component (`app-uc-action-band`) supplies the band's chrome (dark panel, green top-border glow, padding, fade-in) via `<ng-content>`. Each play tab (board / creature / plaza) becomes a flex column — scene fills the top (`flex:1`), the band pins to the bottom (`flex:none`) — and projects its own controls into the shell. All action logic stays in each tab; only look and position are unified. Client-only; no backend/engine changes.

**Tech Stack:** Angular 20 standalone components, SCSS with the project's Golgari palette, Material icons. Verify with `npm run build` (dev build) — there is **no** frontend test runner (`ng test` is gone) and lint is broken, so behavioral checks use the **run-undercity** skill in a browser.

**Reference spec:** [specs/2026-07-23-undercity-bottom-action-band-design.md](2026-07-23-undercity-bottom-action-band-design.md)

**Conventions for every task:**
- Full paths are given per task.
- "Verify build" means: `cd a:/Coding/game-day-site && npm run build` → expect it to finish with `Application bundle generation complete` and no errors (warnings about budget/CommonJS are fine).
- "Verify in browser" means: follow the **run-undercity** skill to reach the relevant tab and confirm the described layout. If the dev server (`npm start`) is already running, just hard-refresh.
- Commit after each task with the given message.

---

### Task 1: Shared action-band shell + global fade keyframe

**Files:**
- Create: `src/app/undercity/tabs/action-band.component.ts`
- Modify: `src/styles.scss` (append one keyframe)

- [ ] **Step 1: Add the global fade keyframe**

Append to the end of `src/styles.scss`:

```scss
/* Undercity action band: subtle fade+rise when the band (or a morph state
   inside it) mounts. Global + unscoped so every tab and the shell can use it. */
@keyframes uc-band-in {
  from {
    opacity: 0;
    transform: translateY(4px);
  }
  to {
    opacity: 1;
    transform: translateY(0);
  }
}
```

- [ ] **Step 2: Create the shell component**

Create `src/app/undercity/tabs/action-band.component.ts`:

```ts
import { Component } from '@angular/core';

/**
 * Presentational shell for the bottom action band shared by the board, creature,
 * and plaza tabs. Supplies the consistent chrome (dark panel, green top-border
 * glow, padding, fade-in) and projects each tab's own controls via <ng-content>.
 * All action logic stays in the host tab — this only unifies look and position.
 */
@Component({
  selector: 'app-uc-action-band',
  standalone: true,
  template: `<ng-content></ng-content>`,
  styles: [
    `
      :host {
        display: block;
        flex: none;
        padding: 9px 10px;
        background: #15170f;
        border-top: 1px solid rgba(103, 194, 128, 0.55);
        box-shadow:
          0 -6px 16px rgba(0, 0, 0, 0.4),
          inset 0 1px 0 rgba(103, 194, 128, 0.15);
        animation: uc-band-in 0.15s ease;
      }
    `,
  ],
})
export class UcActionBandComponent {}
```

- [ ] **Step 3: Verify build**

Run: `cd a:/Coding/game-day-site && npm run build`
Expected: `Application bundle generation complete`. (The component is unused so far but must compile.)

- [ ] **Step 4: Commit**

```bash
git add src/app/undercity/tabs/action-band.component.ts src/styles.scss
git commit -m "feat(undercity): shared action-band shell component + fade keyframe"
```

---

### Task 2: Creature tab — sub-tabs into the band

Simplest tab first: move the existing 4-way sub-tab bar out of the scroll flow and into the band at the bottom; the header + selected panel scroll above it.

**Files:**
- Modify: `src/app/undercity/tabs/creature-tab.component.ts` (imports)
- Modify: `src/app/undercity/tabs/creature-tab.component.html`
- Modify: `src/app/undercity/tabs/creature-tab.component.scss`

- [ ] **Step 1: Import the shell**

In `creature-tab.component.ts`, add the import and register it in the component's `imports:` array:

```ts
import { UcActionBandComponent } from './action-band.component';
```
Add `UcActionBandComponent` to the `imports: [...]` array (alongside `CommonModule`, `MatIconModule`, etc.).

- [ ] **Step 2: Restructure the template**

In `creature-tab.component.html`:
1. Wrap everything that currently renders **above** the `<nav class="subtab-bar">` (the creature header/portrait block, lines ~1–76) **and** the `<div class="subtab-body">…</div>` block (lines ~96–end) together inside a new scroll wrapper, so the file becomes:

```html
<div class="creature-tab">
  <div class="creature-scroll">
    <!-- (existing header/portrait markup, unchanged) -->
    <!-- (existing <div class="subtab-body"> … </div>, unchanged) -->
  </div>

  <app-uc-action-band>
    <!-- moved: the existing <nav class="subtab-bar"> … </nav> block, unchanged markup -->
  </app-uc-action-band>
</div>
```

2. Move the entire existing `<nav class="subtab-bar"> … </nav>` block from its current position (between the header and `subtab-body`) into the `<app-uc-action-band>` slot shown above. Its inner markup (the four `<button>`s with icons + the stat-points `subtab-badge`) is unchanged.

- [ ] **Step 3: Restructure the SCSS**

In `creature-tab.component.scss`, replace the `.creature-tab` rule (currently `position:absolute; inset:0; overflow-y:auto; padding:14px;`) with a flex column, and add the scroll wrapper. Also strip the sub-tab bar's own chrome since the band now provides it.

Replace:

```scss
.creature-tab {
  position: absolute;
  inset: 0;
  overflow-y: auto;
  padding: 14px;
}
```

with:

```scss
.creature-tab {
  position: absolute;
  inset: 0;
  display: flex;
  flex-direction: column;
}

.creature-scroll {
  flex: 1;
  min-height: 0;
  overflow-y: auto;
  padding: 14px;
}
```

Then update the `.subtab-bar` rule so it fills the band cleanly (drop its panel background/border/radius — the band supplies chrome). Change:

```scss
.subtab-bar {
  display: grid;
  grid-template-columns: repeat(4, 1fr);
  gap: 4px;
  padding: 4px;
  background: rgba(0, 0, 0, 0.25);
  border: 1px solid rgba(74, 124, 89, 0.3);
  border-radius: 12px;
```

to:

```scss
.subtab-bar {
  display: grid;
  grid-template-columns: repeat(4, 1fr);
  gap: 4px;
  padding: 0;
  background: transparent;
  border: none;
  border-radius: 0;
```

(Leave the rest of the `.subtab-bar` block — the `button` child styles — as-is.)

- [ ] **Step 4: Verify build**

Run: `cd a:/Coding/game-day-site && npm run build`
Expected: `Application bundle generation complete`, no errors.

- [ ] **Step 5: Verify in browser**

Open the Undercity (run-undercity skill), tap **Creature**. Expected: the Stats/Gear/Wardrobe/Sigils row now sits in the band at the bottom, just above the navbar; the header + panel content scroll above it; the stat-points badge still shows on Stats; switching sub-tabs swaps the content above.

- [ ] **Step 6: Commit**

```bash
git add src/app/undercity/tabs/creature-tab.component.ts src/app/undercity/tabs/creature-tab.component.html src/app/undercity/tabs/creature-tab.component.scss
git commit -m "feat(undercity): creature sub-tabs into bottom action band"
```

---

### Task 3: Plaza tab — forge buildings into the band + poke/status morph

**Files:**
- Modify: `src/app/undercity/tabs/plaza-tab.component.ts` (imports)
- Modify: `src/app/undercity/tabs/plaza-tab.component.html`
- Modify: `src/app/undercity/tabs/plaza-tab.component.scss`

- [ ] **Step 1: Import the shell**

In `plaza-tab.component.ts` add:

```ts
import { UcActionBandComponent } from './action-band.component';
```
and add `UcActionBandComponent` to the `imports: [...]` array.

- [ ] **Step 2: Restructure the template**

In `plaza-tab.component.html`, rework the top of the file so the canvas lives in a scene wrapper and the band holds either the poke/status card (when a player is selected) or the forge buildings + material chips (default). Replace the current opening (the `<canvas>`, the `@if (selected())` poke-card block, and the `<div class="forge-bar">` block — lines ~1–54) with:

```html
<div class="plaza-tab">
  <div class="plaza-scene">
    <canvas #plazaCanvas class="plaza-canvas"></canvas>
  </div>

  <app-uc-action-band>
    @if (selected(); as sel) {
      <!-- Morph: a player (or you) is selected -->
      <div class="poke-card">
        <span class="poke-name">
          {{ sel.username }}'s {{ sel.creatureName || sel.formName }} (L{{ sel.level }})
          @if (sel.shielded) {
            <mat-icon class="mi shield-mi" title="Compost Shield">shield</mat-icon>
          }
        </span>
        @if (sel.userId !== store.ownUserId) {
          <button class="uc-btn uc-btn-primary" [disabled]="busy()" (click)="poke()">
            <mat-icon class="mi">touch_app</mat-icon> Poke (gift a roll)
          </button>
        } @else {
          <div class="status-editor">
            <label class="status-label">Your status</label>
            <input
              class="status-input"
              type="text"
              [maxlength]="STATUS_MAX"
              placeholder="Say something…"
              [(ngModel)]="statusDraft"
              (keyup.enter)="saveStatus()"
            />
            <div class="status-row">
              <span class="status-count">{{ statusDraft().length }}/{{ STATUS_MAX }}</span>
              <button class="uc-btn uc-btn-primary" [disabled]="busy()" (click)="saveStatus()">
                <mat-icon class="mi">chat_bubble</mat-icon> Set status
              </button>
            </div>
          </div>
        }
      </div>
    } @else {
      <!-- Default: forge buildings as a sub-navbar + material chips -->
      <div class="forge-bar">
        <button class="uc-btn forge-btn" (click)="openBuilding('salvage')">
          <mat-icon class="mi">recycling</mat-icon> Salvage
          @if (stashRows().length) { <span class="forge-count">{{ stashRows().length }}</span> }
        </button>
        <button class="uc-btn forge-btn" (click)="openBuilding('blacksmith')">
          <mat-icon class="mi">hardware</mat-icon> Smith
          @if (upgradeRows().length) { <span class="forge-count">{{ upgradeRows().length }}</span> }
        </button>
        <button class="uc-btn forge-btn" (click)="openBuilding('market')">
          <mat-icon class="mi">storefront</mat-icon> Market
          @if (marketRows().length) { <span class="forge-count">{{ marketRows().length }}</span> }
        </button>
        <span class="forge-mats">
          <span class="mat-chip mtl" title="Moltings"><mat-icon class="mi">grass</mat-icon> {{ materials().moltings }}</span>
          <span class="mat-chip ich" title="Chrysalis Ichor"><mat-icon class="mi">science</mat-icon> {{ materials().ichor }}</span>
        </span>
      </div>
    }
  </app-uc-action-band>

  <!-- (the existing @if (building()) { … forge modal … } block stays here, unchanged) -->
  <!-- (the existing @if (toast()) { … } block stays here, unchanged) -->
</div>
```

Leave the `@if (building())` forge-modal block and the `@if (toast())` block exactly where they are (after the band, still direct children of `.plaza-tab`).

- [ ] **Step 3: Restructure the SCSS — root + scene**

In `plaza-tab.component.scss`, replace:

```scss
.plaza-tab {
  position: absolute;
  inset: 0;
}
```

with:

```scss
.plaza-tab {
  position: absolute;
  inset: 0;
  display: flex;
  flex-direction: column;
}

.plaza-scene {
  flex: 1;
  min-height: 0;
  position: relative;
  overflow: hidden;
}
```

(The `.plaza-canvas { position:absolute; inset:0; … }` rule is unchanged — it now fills `.plaza-scene`, its positioned ancestor.)

- [ ] **Step 4: Restructure the SCSS — poke card + forge bar in-band**

Replace the `.poke-card` rule (currently `position:absolute; bottom:14px; left:50%; transform:translateX(-50%); …`) so it lays out inside the band instead of floating:

```scss
.poke-card {
  display: flex;
  align-items: center;
  gap: 10px;
  justify-content: center;
  flex-wrap: wrap;
  animation: uc-band-in 0.15s ease;
}
```

(Keep the child rules — `.poke-name`, `.status-editor`, etc. — as they are.)

Replace the `.forge-bar` rule (currently `position:absolute; top:12px; left:12px; …`) with a full-width sub-navbar row:

```scss
.forge-bar {
  display: flex;
  align-items: center;
  gap: 6px;
}

.forge-btn {
  flex: 1;
  display: inline-flex;
  align-items: center;
  justify-content: center;
  gap: 4px;
}

.forge-mats {
  display: flex;
  gap: 4px;
  padding-left: 6px;
  margin-left: 2px;
  border-left: 1px solid rgba(74, 124, 89, 0.3);
  flex: none;
}
```

(Keep the existing `.forge-count` and `.mat-chip` rules unchanged.)

- [ ] **Step 5: Verify build**

Run: `cd a:/Coding/game-day-site && npm run build`
Expected: `Application bundle generation complete`, no errors.

- [ ] **Step 6: Verify in browser**

Tap **Plaza**. Expected: the band shows Salvage / Smith / Market as three equal buttons with count badges, plus Moltings/Ichor chips at the right end. Tapping a building opens its existing panel. Tapping another player's sprite morphs the band to the "Poke (gift a roll)" card; tapping your own creature morphs it to the status editor.

- [ ] **Step 7: Commit**

```bash
git add src/app/undercity/tabs/plaza-tab.component.ts src/app/undercity/tabs/plaza-tab.component.html src/app/undercity/tabs/plaza-tab.component.scss
git commit -m "feat(undercity): plaza forge buildings + poke into bottom action band"
```

---

### Task 4: Board tab — actions into the band, facility icon button, morph states

The biggest move. The board's floating `.roll-strip` (top) and `.pvp-strip` (bottom) collapse into the band; facility buttons become compact icon buttons; the reroll / pathfinder / PvP prompts become band morph states.

**Files:**
- Modify: `src/app/undercity/tabs/board-tab.component.ts` (imports)
- Modify: `src/app/undercity/tabs/board-tab.component.html`
- Modify: `src/app/undercity/tabs/board-tab.component.scss`

- [ ] **Step 1: Import the shell**

In `board-tab.component.ts` add:

```ts
import { UcActionBandComponent } from './action-band.component';
```
and add `UcActionBandComponent` to the `imports: [...]` array.

- [ ] **Step 2: Wrap the scene**

In `board-tab.component.html`, wrap the canvas and the map-overlay controls that should stay floating (the `<canvas>`, the `.focus-picker` block, the `.board-toast`, and `<app-undercity-event-feed />`) in a `.board-scene` div at the top of `.board-tab`:

```html
<div class="board-tab">
  <div class="board-scene">
    <canvas #boardCanvas class="board-canvas"></canvas>

    <!-- (existing .focus-picker block — unchanged) -->

    @if (toast(); as t) {
      <div class="board-toast">{{ t }}</div>
    }

    <app-undercity-event-feed />
  </div>

  <!-- band goes here (next steps) -->

  <!-- (ALL existing modal/overlay blocks below stay as direct children of
        .board-tab, unchanged: respawn gate, wilds prompt, bridge prompt,
        dice-overlay, mystery-reel, space modal, shop, shrine, warp, ossuary,
        trading post, excavation, flow puzzle, dig cleared, crystal vein,
        guildvault, battle playback, interactive battle, sigil celebration,
        away modal, spell pickers, wish, witch, target/value/boss pickers,
        teleport strip) -->
</div>
```

Move the existing `.focus-picker`, `.board-toast`, and `<app-undercity-event-feed />` markup up into `.board-scene` as shown. The big list of modal `@if` blocks remains after the band, unchanged.

- [ ] **Step 3: Add the band with the roll cluster**

Immediately after the `</div>` that closes `.board-scene`, insert the band. This holds the everyday actions. Move the **contents** of the old `.roll-strip` here, converting facility buttons to icon-only. The full band markup:

```html
  <app-uc-action-band>
    <!-- PvP: someone shares your space — Battle stays available alongside Roll -->
    @if (occupantsHere().length && !store.you()?.pendingMove) {
      <div class="band-morph pvp-strip">
        @for (o of occupantsHere(); track o.userId) {
          <div class="pvp-row">
            <span class="pvp-name">
              {{ o.username }}'s {{ o.creatureName || o.formName }} (L{{ o.level }})
              @if (o.shielded) {
                <mat-icon class="mi shield-mi" title="Compost Shield">shield</mat-icon>
              }
            </span>
            <button
              class="uc-btn uc-btn-danger pvp-btn"
              [disabled]="busy() || o.shielded"
              (click)="attack(o)"
            >
              <mat-icon class="mi">sports_kabaddi</mat-icon> Battle
            </button>
          </div>
        }
      </div>
    }

    <!-- Pending decisions (reroll / pathfinder) take over; otherwise routine actions -->
    @if (!rolling() && store.you()?.pendingMove && canReroll()) {
      <!-- Fleetfoot: reroll a 1 before moving -->
      <div class="band-morph reroll-prompt">
        <div class="reroll-prompt-msg">
          <img class="die-icon" src="undercity/icons/die.png" alt="" />
          You rolled a <strong>1</strong>. <em>Fleetfoot</em> lets you reroll once.
        </div>
        <div class="reroll-prompt-actions">
          <button class="uc-btn uc-btn-primary" [disabled]="busy()" (click)="reroll()">
            <mat-icon class="mi">refresh</mat-icon> Reroll
          </button>
          <button class="uc-btn" [disabled]="busy()" (click)="keepRoll()">Keep the 1</button>
        </div>
      </div>
    } @else if (!rolling() && !canReroll() && pathfinderPick(); as pick) {
      <!-- Pathfinder: keep either die -->
      <div class="band-morph reroll-prompt">
        <div class="reroll-prompt-msg">
          <img class="die-icon" src="undercity/icons/die.png" alt="" />
          <em>Pathfinder</em> — keep either die.
        </div>
        <div class="reroll-prompt-actions">
          @for (v of pick; track v) {
            <button class="uc-btn uc-btn-primary" [disabled]="busy()" (click)="chooseDie(v)">
              Move {{ v }}
            </button>
          }
        </div>
      </div>
    } @else {
      <!-- Routine turn actions -->
      <div class="roll-strip">
        @if (!rolling() && !store.you()?.pendingMove) {
          @if (blinkAllowed()) {
            <button
              class="uc-btn uc-btn-primary roll-btn blink-btn"
              [disabled]="busy() || (!debugMode() && rollsBanked() < 1)"
              (click)="showRollPicker.set(!showRollPicker())"
            >
              <mat-icon class="mi">bolt</mat-icon>
              Blink ({{ debugMode() ? '∞' : rollsBanked() }})
            </button>
            <span class="next-roll-hint blink-note">Blink ready — choose your face</span>
            @if (showRollPicker()) {
              <div class="roll-picker">
                @for (n of [1, 2, 3, 4, 5, 6]; track n) {
                  <button class="uc-btn pick-face" [disabled]="busy()" (click)="pickRoll(n)">{{ n }}</button>
                }
                <button
                  class="uc-btn pick-face pick-random"
                  [disabled]="busy()"
                  title="Roll at random — keeps Blink ready"
                  (click)="roll()"
                >
                  <mat-icon class="mi">casino</mat-icon>
                </button>
              </div>
            }
          } @else {
            <button
              class="uc-btn uc-btn-primary roll-btn"
              [disabled]="busy() || (!debugMode() && rollsBanked() < 1)"
              (click)="roll()"
            >
              <img class="die-icon" src="undercity/icons/die.png" alt="" />
              Roll ({{ debugMode() ? '∞' : rollsBanked() }})
            </button>
            @if (showCoach()) {
              <div class="coach-pill" role="status">
                <span>New here? Tap <strong>Roll</strong> to take your first turn.</span>
                <button class="coach-close" (click)="dismissCoach()" aria-label="Dismiss">
                  <mat-icon class="mi">close</mat-icon>
                </button>
              </div>
            }
            @if (blinkRecharging()) {
              <span class="next-roll-hint blink-note recharging">Blink recharges — ready next turn</span>
            }
            @if (pickAllowed()) {
              <button class="uc-btn pick-btn" [disabled]="busy()" (click)="showRollPicker.set(!showRollPicker())">
                <mat-icon class="mi">casino</mat-icon> Pick
              </button>
              @if (showRollPicker()) {
                <div class="roll-picker">
                  @for (n of [1, 2, 3, 4, 5, 6]; track n) {
                    <button class="uc-btn pick-face" [disabled]="busy()" (click)="pickRoll(n)">{{ n }}</button>
                  }
                </div>
              }
            }
          }
          @if (nextRollLabel(); as nrl) {
            <span class="next-roll-hint">next roll in {{ nrl }}</span>
          }

          @if (castableSpells().length || castableScrolls().length) {
            <button class="uc-btn cast-btn" [disabled]="busy()" (click)="showSpells.set(true)">
              <mat-icon class="mi">auto_fix_high</mat-icon> Cast
            </button>
          }

          <!-- Facility: compact icon-only button; icon reflects the space -->
          @switch (nodeType()) {
            @case ('shop') {
              <button class="uc-btn facility-btn" title="Bazaar" aria-label="Bazaar" (click)="showShop.set(true)">
                <mat-icon class="mi">storefront</mat-icon>
              </button>
            }
            @case ('ossuary') {
              <button class="uc-btn facility-btn" title="The Casino" aria-label="The Casino" (click)="showOssuary.set(true)">
                <mat-icon class="mi">casino</mat-icon>
              </button>
            }
            @case ('witch') {
              <button class="uc-btn facility-btn" title="The Witch" aria-label="The Witch" (click)="showWitch.set(true)">
                <mat-icon class="mi">auto_fix_high</mat-icon>
              </button>
            }
            @case ('trading_post') {
              <button class="uc-btn facility-btn" title="Trading Post" aria-label="Trading Post" (click)="openTradingPost()">
                <mat-icon class="mi">swap_horiz</mat-icon>
              </button>
            }
            @case ('excavation') {
              <button class="uc-btn facility-btn" title="Dig Site" aria-label="Dig Site" (click)="openExcavation()">
                <mat-icon class="mi">grid_view</mat-icon>
              </button>
            }
            @case ('crystal_vein') {
              <button class="uc-btn facility-btn" title="Crystal Vein" aria-label="Crystal Vein" (click)="openVein()">
                <mat-icon class="mi">diamond</mat-icon>
              </button>
            }
            @case ('vault_lock') {
              <button class="uc-btn facility-btn" title="Guildvault" aria-label="Guildvault" (click)="openVault()">
                <mat-icon class="mi">dialpad</mat-icon>
              </button>
            }
          }
        }
      </div>
    }
  </app-uc-action-band>
```

Then **delete** the now-migrated originals from their old positions:
- the old top `<!-- Roll / pending banner --> <div class="roll-strip"> … </div>` block (the one that contained Roll/Blink/Cast/facility/reroll/pathfinder),
- the old `<!-- PvP prompt --> @if (occupantsHere()…) { <div class="pvp-strip"> … </div> }` block.

Note the Shrine (`showShrine`) had no facility trigger in the old roll-strip switch (it opens via other flows), so it is intentionally not in the facility switch — matching current behavior. The Cast button previously lived just below the roll-strip; it is now folded into the routine-actions row above.

- [ ] **Step 4: SCSS — root, scene, roll-strip in-band**

In `board-tab.component.scss`, replace:

```scss
.board-tab {
  position: absolute;
  inset: 0;
}
```

with:

```scss
.board-tab {
  position: absolute;
  inset: 0;
  display: flex;
  flex-direction: column;
}

.board-scene {
  flex: 1;
  min-height: 0;
  position: relative;
  overflow: hidden;
}
```

(`.board-canvas { position:absolute; inset:0; … }` is unchanged — it now fills `.board-scene`.)

Replace the `.roll-strip` rule (currently `position:absolute; top:10px; left:50%; transform:translateX(-50%); …`) with an in-band flex row:

```scss
.roll-strip {
  display: flex;
  flex-wrap: wrap;
  justify-content: center;
  align-items: center;
  gap: 8px;
}
```

Replace the `.pvp-strip` rule (currently `position:absolute; bottom:12px; left:50%; …`) with in-band layout:

```scss
.pvp-strip {
  display: flex;
  flex-direction: column;
  gap: 6px;
  width: 100%;
}
```

Add a shared morph-entry rule and the facility icon-button sizing (place near `.roll-strip`):

```scss
.band-morph {
  animation: uc-band-in 0.15s ease;
}

.facility-btn {
  padding: 8px 12px;

  .mi {
    margin: 0;
    font-size: 1.25rem;
    width: 1.25rem;
    height: 1.25rem;
  }
}
```

(Keep `.roll-picker`, `.coach-pill`, `.reroll-prompt`, `.pvp-row`, `.next-roll-hint`, `.cast-btn`, `.board-toast` rules as-is — they still apply inside the band/scene. The `.reroll-prompt` and `.roll-picker` rules use `flex-basis:100%`, which is harmless in the band.)

- [ ] **Step 5: Verify build**

Run: `cd a:/Coding/game-day-site && npm run build`
Expected: `Application bundle generation complete`, no errors.

- [ ] **Step 6: Verify in browser**

Tap **Board**. Expected:
- Roll/Blink, Cast, and (when parked on a facility) a single icon button sit together in the band at the bottom, above the navbar; the cooldown/blink hint shows on its own line.
- Landing on a shop/casino/etc. shows the matching facility icon; tapping it opens the correct panel; long-press/hover shows its name.
- Rolling a 1 with Fleetfoot replaces the band with the Reroll / Keep prompt; Pathfinder shows the "Move X / Move Y" prompt; standing on another player's space shows the Battle prompt.
- The dice overlay, mystery reel, space-event modal, shop, casino, etc. still open and cover the screen.

- [ ] **Step 7: Commit**

```bash
git add src/app/undercity/tabs/board-tab.component.ts src/app/undercity/tabs/board-tab.component.html src/app/undercity/tabs/board-tab.component.scss
git commit -m "feat(undercity): board actions into bottom action band with morph states"
```

---

### Task 5: Relocate the biome chip above the band

The page shell's biome chip is `position:absolute; bottom:12px` inside `.tab-body`, which now overlaps the board's band. Move it into `.board-scene` (bottom-left, naturally above the band) and let the board tab own it, removing the page's now-dead delegation.

**Files:**
- Modify: `src/app/undercity/tabs/board-tab.component.ts`
- Modify: `src/app/undercity/tabs/board-tab.component.html`
- Modify: `src/app/undercity/tabs/board-tab.component.scss`
- Modify: `src/app/undercity/undercity-page.component.ts`
- Modify: `src/app/undercity/undercity-page.component.html`
- Modify: `src/app/undercity/undercity-page.component.scss`

- [ ] **Step 1: Give the board tab its own biome computed**

In `board-tab.component.ts` the map is a plain `@Input({ required: true }) map!: BoardMap;` (not a signal) and `store` is injected. `computed` is already imported. Add a `currentBiome` computed near the other computeds — it reads `this.map` directly (stable after load) and tracks `store.you()`, mirroring the existing private `regionBgUrl()` pattern:

```ts
/** Label of the biome the player stands in, from the authoritative
 * map.regions table — used by the on-board biome chip. */
protected readonly currentBiome = computed(() => {
  const pos = this.store.you()?.position;
  const region = this.map?.nodes.find((n) => n.id === pos)?.region ?? 'city';
  return this.map?.regions?.[region]?.label ?? null;
});
```

- [ ] **Step 2: Render the chip inside the board scene**

In `board-tab.component.html`, inside `.board-scene` (after `<app-undercity-event-feed />`), add:

```html
    @if (currentBiome(); as biome) {
      <button
        type="button"
        class="biome-chip"
        aria-live="polite"
        title="Center camera on your creature"
        (click)="focusSelf()"
      >
        <mat-icon class="mi">location_on</mat-icon>{{ biome }}
      </button>
    }
```

(`focusSelf()` is the board tab's existing public method — the same one the page currently calls through the ViewChild.)

- [ ] **Step 3: Style the chip in the board tab**

Move the biome-chip styles into `board-tab.component.scss` (append). Copy the existing `.biome-chip { … }` rule from `undercity-page.component.scss` verbatim:

```scss
.biome-chip {
  position: absolute;
  left: 12px;
  bottom: 12px;
  z-index: 5;
  display: inline-flex;
  align-items: center;
  gap: 4px;
  max-width: calc(100% - 24px);
  padding: 5px 12px 5px 9px;
  background: rgba(26, 24, 21, 0.82);
  border: 1px solid rgba(74, 124, 89, 0.5);
  border-radius: 16px;
  color: #b7e4c7;
  font-size: 0.82rem;
  font-weight: 700;
  white-space: nowrap;
  overflow: hidden;
  text-overflow: ellipsis;
  backdrop-filter: blur(3px);
  -webkit-backdrop-filter: blur(3px);
  box-shadow: 0 3px 10px rgba(0, 0, 0, 0.4);
  cursor: pointer;
  font-family: inherit;
  transition:
    transform 0.08s ease,
    border-color 0.15s ease;

  &:hover {
    border-color: rgba(108, 174, 117, 0.85);
  }

  &:active {
    transform: scale(0.94);
  }

  .mi {
    font-size: 1rem;
    height: 1rem;
    width: 1rem;
    color: #6cae75;
    flex-shrink: 0;
  }
}
```

Now `bottom: 12px` is relative to `.board-scene`, so the chip floats just above the band.

- [ ] **Step 4: Remove the page-shell chip and delegation**

In `undercity-page.component.html`, delete the biome-chip block currently inside `<main class="tab-body">`:

```html
          @if (tab() === 'board' && currentBiome(); as biome) {
            <button
              type="button"
              class="biome-chip"
              …
            </button>
          }
```

In `undercity-page.component.ts`, remove the now-unused members: the `@ViewChild(BoardTabComponent) private boardTab?` field, the `focusSelf()` method that delegates to it, and the `currentBiome` computed. Keep `focusOwnCreature()` (HUD avatar → `store.requestRecenter()`) — that is unrelated. Keep the `BoardTabComponent` import (still used in the template and `imports:` array). Remove `ViewChild` from the `@angular/core` import **only if** nothing else in the file uses it. Leave `computed` imported — it's still used elsewhere in the page.

In `undercity-page.component.scss`, delete the `.biome-chip { … }` rule (now owned by the board tab).

- [ ] **Step 5: Verify build**

Run: `cd a:/Coding/game-day-site && npm run build`
Expected: `Application bundle generation complete`, no errors. (If the build complains about an unused import in the page component, remove that import.)

- [ ] **Step 6: Verify in browser**

Tap **Board**. Expected: the biome chip (e.g. "The Rotting Reach") floats at the bottom-left of the map, clearly **above** the action band, and tapping it re-centers the camera on your creature.

- [ ] **Step 7: Commit**

```bash
git add src/app/undercity/tabs/board-tab.component.ts src/app/undercity/tabs/board-tab.component.html src/app/undercity/tabs/board-tab.component.scss src/app/undercity/undercity-page.component.ts src/app/undercity/undercity-page.component.html src/app/undercity/undercity-page.component.scss
git commit -m "feat(undercity): relocate biome chip above the action band"
```

---

### Task 6: Cross-tab verification pass

No new code unless a defect surfaces — a final sweep that the band is consistent and the edge states hold.

- [ ] **Step 1: Full build**

Run: `cd a:/Coding/game-day-site && npm run build`
Expected: `Application bundle generation complete`, no errors.

- [ ] **Step 2: Verify in browser (run-undercity skill)**

Confirm each:
- **Board / Creature / Plaza** all show the band in the same fixed slot directly above the navbar, with identical chrome (dark panel, green top edge, subtle fade-in on tab switch).
- **Log** tab shows **no** band — the log list runs straight to the navbar.
- Enter a battle (PvE or PvP): the interactive battle overlay covers the band and navbar as before; leaving the battle restores the board band.
- Narrow phone width (DevTools device toolbar, ~360px): Roll + Cast + facility icon stay on one row; the plaza forge row + material chips fit without overflowing the viewport.

- [ ] **Step 3: Commit any fixes**

If Step 2 required tweaks, commit them:

```bash
git add -A
git commit -m "fix(undercity): action band cross-tab polish"
```

If no changes were needed, this task closes with the build confirmation above — nothing to commit.

---

## Self-Review notes

- **Spec coverage:** shared shell (Task 1); board actions + morph + facility icon (Task 4); creature sub-tabs (Task 2); plaza buildings + materials Option A + poke/status (Task 3); Log has no band — it renders `<app-undercity-log-tab>` which is untouched, so it simply has no band (verified Task 6); in-battle overlay unchanged (Task 6); biome chip relocation (Task 5); ~150ms fade via `uc-band-in` (Task 1, applied across tabs). All spec sections map to a task.
- **No backend files** are touched, matching the design's client-only scope.
- **Facility icon set** matches the icons already used by each facility's old text button (storefront/casino/auto_fix_high/swap_horiz/grid_view/diamond/dialpad).
- **Naming consistency:** the shell is `UcActionBandComponent` / `app-uc-action-band` everywhere; the morph wrapper class is `band-morph` in both the board template and SCSS.
- **PvP coexists with Roll (faithful to current behavior):** the PvP block is an independent leading `@if` inside the band, not part of the reroll/pathfinder `@else if` chain — so an opponent on your space shows the **Battle** row *above* the normal Roll/Cast row, letting you choose to fight or move on (matching today's separate roll-strip + pvp-strip). Reroll and Pathfinder remain true takeovers because they only occur while a move is pending, when Roll is unavailable anyway.
