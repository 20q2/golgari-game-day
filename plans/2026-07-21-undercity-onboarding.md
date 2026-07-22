# Undercity Onboarding & Renown-Shop Clarity — Implementation Plan

> **For agentic workers:** Steps use checkbox (`- [ ]`) syntax for tracking. This is a
> frontend-only feature with **no test runner** (per CLAUDE.md — Karma/Jasmine removed).
> Each task verifies with `npm run build` (the real gate; lint is known-broken) plus the
> manual check named in the task. The Lambda is untouched, so the pytest suite stays green.

**Goal:** Make the Undercity new-player experience legible — a skippable sigil-guardians
intro cutscene, a novice-friendly creature/biome default, a basket-style Renown shop, a
first-turn coach-mark, and a persistent Guild-Sigil HUD tracker.

**Architecture:** Additive UI + copy + one new standalone component. No engine/economy
changes; `join` payload and all balance tables are untouched. Two `localStorage` flags
(`uc.introSeen`, `uc.coachSeen`) gate the one-time onboarding, matching the existing
anonymous-identity pattern.

**Tech Stack:** Angular 20 standalone components, signals, `OnPush`, Material icons, SCSS.

**Spec:** [specs/2026-07-21-undercity-onboarding-design.md](../specs/2026-07-21-undercity-onboarding-design.md)

---

## File map

| File | Responsibility | Task |
|---|---|---|
| `src/app/undercity/hatch/intro-cutscene.component.ts` (new) | Self-contained still-panel cutscene; `@Output() done` | 1 |
| `src/app/undercity/hatch/hatch-flow.component.ts` | Cutscene gate + `firstHatch`; `fillRecommendedKit()`/`clearCart()`; Bravery/biome copy | 1–3 |
| `src/app/undercity/hatch/hatch-flow.component.html` | Cutscene gate; Bravery-first+badge; "Good first home"; shop reorder/kit/clear/carted-text/balance | 1–3 |
| `src/app/undercity/hatch/hatch-flow.component.scss` | Styles for badges, "Looks — optional", kit/clear buttons, carted tag | 2–3 |
| `src/app/undercity/tabs/board-tab.component.{ts,html,scss}` | First-turn coach-mark pill at the roll-strip | 4 |
| `src/app/undercity/undercity-page.component.{html,scss}` | HUD Guild-Sigil chip | 5 |

Guild-Sigil count source: `store.you()?.sigils` (already on the player model,
[undercity-models.ts:36](../src/app/undercity/services/undercity-models.ts#L36)),
`SIGILS_REQUIRED` from [dungeons.ts](../src/app/undercity/data/dungeons.ts#L79).
Guardian art: `public/undercity/guardians/<id>.png` (all 5 confirmed present).

---

## Task 1: Intro cutscene component + hatch gate (move 1)

**Files:**
- Create: `src/app/undercity/hatch/intro-cutscene.component.ts`
- Modify: `src/app/undercity/hatch/hatch-flow.component.ts`
- Modify: `src/app/undercity/hatch/hatch-flow.component.html`

- [ ] **Step 1: Create the cutscene component.** Standalone, `OnPush`, inline template +
  styles. Data-driven panels; tap or ~4s auto-advance; Skip always visible; emits `done`
  after the last panel or on skip. Clear the timer in `ngOnDestroy` and on every advance.

```ts
import { ChangeDetectionStrategy, Component, EventEmitter, OnDestroy, OnInit, Output, signal } from '@angular/core';
import { CommonModule } from '@angular/common';
import { MatIconModule } from '@angular/material/icon';

interface Panel { kind: 'gate' | 'guardians' | 'seals' | 'egg'; text: string; }

const GUARDIAN_IDS = ['ishkanah', 'sarulf', 'gitrog_monster', 'skullbriar', 'slimefoot'];

@Component({
  selector: 'app-undercity-intro-cutscene',
  standalone: true,
  changeDetection: ChangeDetectionStrategy.OnPush,
  imports: [CommonModule, MatIconModule],
  template: `
    <div class="cutscene" [style.background-image]="bgImage" (click)="next()">
      <button class="skip" (click)="skip(); $event.stopPropagation()">Skip</button>
      @if (panel(); as p) {
        <div class="panel" [class.show]="true">
          @switch (p.kind) {
            @case ('gate')      { <div class="gate-silhouette" aria-hidden="true"></div> }
            @case ('guardians') {
              <div class="guardian-row">
                @for (g of guardians; track g) {
                  <img class="guardian" [src]="'undercity/guardians/' + g + '.png'" alt="" />
                }
              </div>
            }
            @case ('seals') {
              <div class="seal-row" aria-hidden="true">
                @for (s of [0,1,2]; track s) { <mat-icon class="seal">workspace_premium</mat-icon> }
              </div>
            }
            @case ('egg') { <div class="egg-teaser" aria-hidden="true"></div> }
          }
          <p class="narration">{{ p.text }}</p>
        </div>
      }
      <div class="dots">
        @for (p of panels; track $index) { <span class="dot" [class.on]="$index === index()"></span> }
      </div>
      <p class="advance-hint">Tap to continue</p>
    </div>
  `,
  styles: [`/* full-screen dark scene; .panel fade-in; .seal gold; responsive guardian-row; see spec */`],
})
export class IntroCutsceneComponent implements OnInit, OnDestroy {
  @Output() done = new EventEmitter<void>();
  protected readonly guardians = GUARDIAN_IDS;
  protected readonly bgImage =
    "linear-gradient(rgba(8,8,10,0.78), rgba(8,8,10,0.9)), url('undercity/gate_background.png')";
  protected readonly panels: Panel[] = [
    { kind: 'gate', text: 'Beneath the game table, the Swarm Queen sleeps behind a sealed gate.' },
    { kind: 'guardians', text: 'Her guardians hold the Guild Sigils.' },
    { kind: 'seals', text: 'Claim three, and the gate opens. Grow the biggest legend by dawn to be crowned.' },
    { kind: 'egg', text: "But first — you're still in your shell. Tap to crack it." },
  ];
  protected readonly index = signal(0);
  protected panel() { return this.panels[this.index()] ?? null; }
  private timer: ReturnType<typeof setTimeout> | null = null;

  ngOnInit(): void { this.arm(); }
  ngOnDestroy(): void { this.disarm(); }
  private arm(): void { this.disarm(); this.timer = setTimeout(() => this.next(), 4000); }
  private disarm(): void { if (this.timer) { clearTimeout(this.timer); this.timer = null; } }

  next(): void {
    if (this.index() >= this.panels.length - 1) { this.finish(); return; }
    this.index.set(this.index() + 1); this.arm();
  }
  skip(): void { this.finish(); }
  private finish(): void { this.disarm(); this.done.emit(); }
}
```

- [ ] **Step 2: Flesh out the inline `styles`** — full-screen fixed overlay, centered
  column, `.panel` opacity fade-in, gold `.seal` (~48px), `.guardian` images capped at
  ~22vw and wrapping on narrow screens, a top-right `.skip` pill, bottom `.dots`. Reuse
  STYLE_GUIDE tokens where practical. (`.gate-silhouette` / `.egg-teaser` are simple CSS
  shapes — a dark rounded blob is fine.)

- [ ] **Step 3: Gate the cutscene in `hatch-flow.component.ts`.** Add imports and signals:

```ts
import { IntroCutsceneComponent } from './intro-cutscene.component';
// in @Component imports: add IntroCutsceneComponent
// fields:
private static readonly INTRO_KEY = 'uc.introSeen';
protected readonly firstHatch = signal(!localStorage.getItem(HatchFlowComponent.INTRO_KEY));
protected readonly showIntro = signal(!localStorage.getItem(HatchFlowComponent.INTRO_KEY));
dismissIntro(): void {
  localStorage.setItem(HatchFlowComponent.INTRO_KEY, '1');
  this.showIntro.set(false);
}
```

- [ ] **Step 4: Render the gate in `hatch-flow.component.html`.** Wrap the entire existing
  `<div class="hatch">…</div>` so the cutscene shows first:

```html
@if (showIntro()) {
  <app-undercity-intro-cutscene (done)="dismissIntro()" />
} @else {
  <!-- existing <div class="hatch"> … </div> unchanged -->
}
```

- [ ] **Step 5: Build.** Run `npm run build`. Expected: succeeds, no TS/template errors.

- [ ] **Step 6: Manual check.** `npm start`; in devtools run
  `localStorage.removeItem('uc.introSeen')`; reload `/undercity`, sign in → cutscene plays,
  auto-advances, Skip works, last panel → egg screen. Reload again → no replay.

- [ ] **Step 7: Commit.**

```bash
git add src/app/undercity/hatch/intro-cutscene.component.ts src/app/undercity/hatch/hatch-flow.component.ts src/app/undercity/hatch/hatch-flow.component.html
git commit -m "feat(undercity): sigil-guardians intro cutscene for first-time players"
```

---

## Task 2: Bravery-as-default + "Good first home" (moves 2–3)

**Files:** `hatch-flow.component.html`, `hatch-flow.component.scss`

- [ ] **Step 1: Re-copy the Bravery card** in the starter-grid (currently the last
  `starter-card bravery-card` button). Replace its blurb with:
  *"Not sure? Let the swarm choose your hatchling — and take a bonus roll for the nerve."*

- [ ] **Step 2: Badge + reorder for first-timers.** When `firstHatch()`, render the
  Bravery card **first** in the grid with a badge; otherwise keep current order/styling.
  Use two `@if (firstHatch())` / `@else` branches around the grid contents, or a
  `[class.recommended]="firstHatch()"` + a conditional badge span:

```html
@if (firstHatch()) {
  <span class="starter-badge">First time? Start here</span>
}
```
  Simplest: duplicate the bravery `<button>` markup into a leading `@if (firstHatch())`
  block and guard the trailing one with `@if (!firstHatch())` so it never renders twice.

- [ ] **Step 3: "Good first home" tag** on the `city` biome card. In the `biome-grid`
  loop, add under the perk line:

```html
@if (biome.id === 'city') { <span class="biome-firsttag">Good first home</span> }
```

- [ ] **Step 4: SCSS** for `.starter-badge`, `.starter-card.recommended` (subtle accent
  border/glow using `--accent-color`), and `.biome-firsttag` (small pill). Reuse tokens.

- [ ] **Step 5: Build.** `npm run build` — succeeds.

- [ ] **Step 6: Manual check.** With `uc.introSeen` cleared → Bravery card leads with the
  badge and new copy; City biome shows "Good first home". With the flag set (returning
  player) → Bravery in its original spot, no badge.

- [ ] **Step 7: Commit.**

```bash
git add src/app/undercity/hatch/hatch-flow.component.html src/app/undercity/hatch/hatch-flow.component.scss
git commit -m "feat(undercity): novice defaults — Bravery-first + recommended first home"
```

---

## Task 3: Renown shop — basket, not vending machine (move 4)

**Files:** `hatch-flow.component.ts`, `hatch-flow.component.html`, `hatch-flow.component.scss`

- [ ] **Step 1: Add cart helpers to `hatch-flow.component.ts`.**

```ts
/** One-tap balanced starter: +2 ATK fang and +2 DEF carapace (25+25 = full 50). */
fillRecommendedKit(): void {
  this.cartItems.set(['rusted_fang', 'chitin_scrap']);
}
/** Empty the whole cart (items + cosmetics) and any pending equips. */
clearCart(): void {
  this.cartItems.set([]);
  this.cartHats.set([]);
  this.cartPaints.set([]);
  this.equipHat.set(null);
  this.equipPaint.set(null);
}
```

- [ ] **Step 2: Reorder shop sections in `hatch-flow.component.html`.** Move the
  **Starter items** `<h2>`+grid ABOVE the Colors and Hats sections. Wrap Colors + Hats
  under one heading: `<h2 class="shop-head">Looks <span class="shop-sub">optional</span></h2>`
  (keep the two existing grids beneath it).

- [ ] **Step 3: Add the kit + clear controls** just under the Starter-items heading:

```html
<div class="kit-row">
  <button class="uc-btn kit-btn" (click)="fillRecommendedKit()">
    <mat-icon class="mi">auto_awesome</mat-icon> Recommended kit
  </button>
  @if (cartItems().length || cartHats().length || cartPaints().length) {
    <button class="uc-btn clear-btn" (click)="clearCart()">Clear</button>
  }
</div>
```

- [ ] **Step 4: Carted "tap to remove" text.** On each carted card (items, hats, paints),
  add inside the `@if (…carted…)` state a tag:
  `<span class="shop-tag in-cart">In cart · tap to remove</span>`. For items the card has
  no owned/wear branch, so add `@if (cartItems().includes(item.id)) { … }`. For hats/paints
  add it under the existing `[class.carted]` cards (non-owned branch).

- [ ] **Step 5: Reframe the balance line + confirm button.** Replace the `renown-bal`
  paragraph and the primary hatch button:

```html
<p class="renown-bal">
  <mat-icon class="mi">military_tech</mat-icon>
  @if (cartCost() > 0) { Spending {{ cartCost() }} · {{ remaining() }} left }
  @else { {{ balance() }} Renown to spend }
</p>
...
<button class="hatch-btn" (click)="hatch()" [disabled]="joining()">
  @if (cartCost() > 0) { Spawn — spend {{ cartCost() }} Renown } @else { Spawn into the world → }
</button>
```

- [ ] **Step 6: SCSS** for `.kit-row`, `.kit-btn`, `.clear-btn`, `.shop-tag.in-cart`.
  Reuse existing `.shop-tag` styling as the base.

- [ ] **Step 7: Build.** `npm run build` — succeeds.

- [ ] **Step 8: Manual check.** In the shop: items listed first; **Recommended kit** fills
  Fang+Chitin and the balance reads "Spending 50 · 0 left"; carted cards say "tap to
  remove" and re-tapping removes them; **Clear** empties the cart; confirm button reflects
  spend. Spawn still succeeds (cart → `join`).

- [ ] **Step 9: Commit.**

```bash
git add src/app/undercity/hatch/hatch-flow.component.ts src/app/undercity/hatch/hatch-flow.component.html src/app/undercity/hatch/hatch-flow.component.scss
git commit -m "feat(undercity): basket-style Renown shop with one-tap recommended kit"
```

---

## Task 4: First-turn coach-mark (move 5)

**Files:** `board-tab.component.ts`, `board-tab.component.html`, `board-tab.component.scss`

- [ ] **Step 1: Add coach state to `board-tab.component.ts`.**

```ts
private static readonly COACH_KEY = 'uc.coachSeen';
protected readonly showCoach = signal(!localStorage.getItem(BoardTabComponent.COACH_KEY));
protected dismissCoach(): void {
  if (!this.showCoach()) return;
  localStorage.setItem(BoardTabComponent.COACH_KEY, '1');
  this.showCoach.set(false);
}
```

- [ ] **Step 2: Dismiss on first roll.** At the top of the existing `roll()` method
  ([board-tab.component.ts:822](../src/app/undercity/tabs/board-tab.component.ts#L822)),
  call `this.dismissCoach();` (before the `busy()` guard is fine).

- [ ] **Step 3: Render the pill** in `board-tab.component.html`, inside the `roll-strip`
  (near the Roll button), only when `showCoach()`:

```html
@if (showCoach()) {
  <div class="coach-pill" role="status">
    <span>New here? Tap <strong>Roll</strong> to take your first turn.</span>
    <button class="coach-close" (click)="dismissCoach()" aria-label="Dismiss">
      <mat-icon class="mi">close</mat-icon>
    </button>
  </div>
}
```

- [ ] **Step 4: SCSS** for `.coach-pill` — a small accented, gently pulsing pill anchored
  near the roll button; `.coach-close` a plain icon button. Reuse `--accent-color`.

- [ ] **Step 5: Build.** `npm run build` — succeeds.

- [ ] **Step 6: Manual check.** Clear `uc.coachSeen`, reload into a live night on the board:
  pill points at Roll; tapping **Roll** (or the ✕) hides it; reload → stays hidden.

- [ ] **Step 7: Commit.**

```bash
git add src/app/undercity/tabs/board-tab.component.ts src/app/undercity/tabs/board-tab.component.html src/app/undercity/tabs/board-tab.component.scss
git commit -m "feat(undercity): first-turn coach-mark on the Roll button"
```

---

## Task 5: Persistent Guild-Sigil HUD tracker (move 6)

**Files:** `undercity-page.component.html`, `undercity-page.component.scss`

- [ ] **Step 1: Import `SIGILS_REQUIRED`** into `undercity-page.component.ts` from
  `./data/dungeons` and expose it: `protected readonly sigilsRequired = SIGILS_REQUIRED;`
  (verify no name clash; add the import beside existing data imports).

- [ ] **Step 2: Add the chip** to the `hud-stats` block in `undercity-page.component.html`,
  after the Spores chip, reading the player's `sigils`:

```html
<span class="hud-chip" title="Claim Guild Sigils from lair bosses to unseal the Queen">
  <mat-icon class="mi gold">workspace_premium</mat-icon> {{ you.sigils }}/{{ sigilsRequired }}
</span>
```

- [ ] **Step 3: SCSS** — reuse `.hud-chip`; ensure the `.gold` seal icon reads on the HUD.
  (`you` is already the `@if (store.you(); as you)` binding in the `play` case.)

- [ ] **Step 4: Build.** `npm run build` — succeeds.

- [ ] **Step 5: Manual check.** In a live night the HUD shows `0/3` from turn 1; after
  clearing a biome lair the sunburst fires and the chip bumps to `1/3`.

- [ ] **Step 6: Commit.**

```bash
git add src/app/undercity/undercity-page.component.html src/app/undercity/undercity-page.component.scss src/app/undercity/undercity-page.component.ts
git commit -m "feat(undercity): persistent Guild-Sigil HUD tracker (n/3)"
```

---

## Self-review

**Spec coverage:** move 1 → Task 1; moves 2–3 → Task 2; move 4 → Task 3; move 5 → Task 4;
move 6 → Task 5. `localStorage` contract (`uc.introSeen`, `uc.coachSeen`) → Tasks 1 & 4.
All six moves covered.

**Placeholder scan:** the cutscene `styles` block is intentionally summarized (Step 2 of
Task 1 fleshes it out); all logic/template code is concrete. No TBD/TODO in logic steps.

**Type/name consistency:** `showIntro`/`firstHatch`/`dismissIntro`, `fillRecommendedKit`/
`clearCart`, `showCoach`/`dismissCoach`/`COACH_KEY`, `sigilsRequired`/`SIGILS_REQUIRED`,
and player field `sigils` are used consistently across tasks and match the existing
`cart*`/`equip*` signal names in the component.

**Verification:** `npm run build` per task; no test runner exists; pytest unaffected.
