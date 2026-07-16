# Undercity modal containment + tab navigation — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Contain every Undercity popup to the game's play area (never covering the tab bar), let a player switch to Creature/Plaza/Log while a facility modal is open and find it exactly as they left it on return, and lock tab navigation during an active battle.

**Architecture:** A single CSS change (`.uc-modal-backdrop` from `fixed` to `absolute`, scoped inside the already-relatively-positioned `.tab-body`) contains every modal uniformly, since they all share that class. A new `openFacility` signal on the singleton `UndercityStateService` (which survives `BoardTabComponent` being destroyed/recreated on tab switch) remembers which of the 8 facility/decision modals is open; board-tab's openers write to it, `closeFacilities()` clears it, and `ngAfterViewInit()` replays it on (re)construction — the same idea as the existing `pendingBattle` resume pattern already in the constructor, just running one lifecycle hook later since two of the openers need the `map` input, which isn't populated until after construction. Battle-lock reuses that same pre-existing `pendingBattle` signal at the page level to disable the other three tab buttons.

**Tech Stack:** Angular 20 standalone components, signals. Verified via `npm run build` (no client test runner in this repo, lint is known-broken).

**Design spec:** [specs/2026-07-16-undercity-modal-tab-nav-design.md](2026-07-16-undercity-modal-tab-nav-design.md)

---

## File Structure

- `src/app/undercity/tabs/board-tab.component.scss` — containment fix (2 rules changed).
- `src/app/undercity/services/undercity-state.service.ts` — add `FacilityKind` type + `openFacility` signal.
- `src/app/undercity/tabs/board-tab.component.ts` — 8 openers write `openFacility`; `warpTo()` and `closeFacilities()` clear it; `shrine()` routes through `closeFacilities()`; `ngAfterViewInit()` gains a restore block.
- `src/app/undercity/undercity-page.component.ts` — add `inBattle` computed; `setTab()` guards against navigating away mid-battle.
- `src/app/undercity/undercity-page.component.html` — bind `[disabled]="inBattle()"` on the three non-Board tab buttons.
- `src/app/undercity/undercity-page.component.scss` — small `:disabled` style for tab-bar buttons (none exists today).

Tasks land in dependency order: containment (independent) → service state → board-tab wiring (depends on service state) → page-level battle lock (independent of the others, but done last since it's the smallest).

---

## Task 1: Contain modals to the play area

**Files:**
- Modify: `src/app/undercity/tabs/board-tab.component.scss:128-217`

- [ ] **Step 1: Change the backdrop from viewport-fixed to tab-body-relative**

In `src/app/undercity/tabs/board-tab.component.scss`, change:

```scss
.uc-modal-backdrop {
  position: fixed;
  inset: 0;
```

to:

```scss
.uc-modal-backdrop {
  position: absolute;
  inset: 0;
```

(Everything else in that rule — `z-index: 1100`, background, blur, flex centering, animation — stays as-is. `.board-tab`, board-tab's template root, is already `position: absolute; inset: 0` inside `undercity-page.component.scss`'s `.tab-body { position: relative; overflow: hidden }`, so the backdrop's new `absolute` positioning now resolves against that region — between the HUD and the tab bar — instead of the full browser viewport.)

- [ ] **Step 2: Fix the modal's max-height to match its new container**

In the same file, inside `.uc-modal`, change:

```scss
  max-height: 80vh;
```

to:

```scss
  max-height: 90%;
```

(`80vh` measured the full viewport; the modal's containing block is now the shorter `.tab-body` region, so a percentage keeps it proportional to what it actually lives in.)

- [ ] **Step 3: Verify it compiles**

Run: `npm run build`
Expected: succeeds, no new errors.

- [ ] **Step 4: Commit**

```bash
git add src/app/undercity/tabs/board-tab.component.scss
git commit -m "fix(undercity): contain modals to the play area instead of the full viewport"
```

---

## Task 2: `openFacility` state on the shared store

**Files:**
- Modify: `src/app/undercity/services/undercity-state.service.ts:1-48`

- [ ] **Step 1: Add the `FacilityKind` type and `openFacility` signal**

In `src/app/undercity/services/undercity-state.service.ts`, after the imports (line 4) and before `const POLL_INTERVAL_MS`, add:

```typescript
/** The 8 popups that represent a real decision point — these remember
 * whether they're open across a tab switch, since BoardTabComponent (where
 * they live) is destroyed/recreated every time the active tab changes. */
export type FacilityKind =
  | 'shop'
  | 'shrine'
  | 'ossuary'
  | 'tradingPost'
  | 'excavation'
  | 'vein'
  | 'vault'
  | 'warp';

export interface OpenFacility {
  kind: FacilityKind;
  /** Only 'shop' uses this, to restore the selected Bazaar sub-tab. */
  shopTab?: 'gear' | 'consumables' | 'grimoires';
  /** Only 'warp' uses this — the destination list isn't derivable from any
   * other store signal, so it's carried directly. */
  warpOptions?: string[];
}
```

- [ ] **Step 2: Add the signal to the service class**

In the same file, inside `UndercityStateService`, right after line 48 (`readonly hallOfFame = computed(...)`), add:

```typescript

  /** Which facility/decision modal is open, if any — survives BoardTabComponent
   * being torn down and rebuilt when the player switches tabs. */
  readonly openFacility = signal<OpenFacility | null>(null);
```

- [ ] **Step 3: Verify it compiles**

Run: `npm run build`
Expected: succeeds (nothing references the new signal yet).

- [ ] **Step 4: Commit**

```bash
git add src/app/undercity/services/undercity-state.service.ts
git commit -m "feat(undercity): add openFacility signal to remember which popup is open across tab switches"
```

---

## Task 3: Wire board-tab's openers/closer to `openFacility`

**Files:**
- Modify: `src/app/undercity/tabs/board-tab.component.ts`

- [ ] **Step 1: Import `FacilityKind`/`OpenFacility`**

In `src/app/undercity/tabs/board-tab.component.ts`, find the import block from `'../services/undercity-state.service'`:

```typescript
import { UndercityStateService } from '../services/undercity-state.service';
```

Replace with:

```typescript
import { FacilityKind, UndercityStateService } from '../services/undercity-state.service';
```

- [ ] **Step 2: Set `openFacility` on the shop/shrine/ossuary/warp landing branches**

In `routeSpaceEvent` (around line 798), change:

```typescript
    } else if (ev.type === 'warp' && ev.options) {
      this.showWarp.set(ev.options);
    } else if (ev.type === 'shop') {
      this.shopTab.set('gear');
      this.showShop.set(true);
    } else if (ev.type === 'shrine') {
      this.showShrine.set(true);
    } else if (ev.type === 'ossuary') {
      this.showOssuary.set(true);
    } else if (ev.type === 'trading_post') {
```

to:

```typescript
    } else if (ev.type === 'warp' && ev.options) {
      this.showWarp.set(ev.options);
      this.store.openFacility.set({ kind: 'warp', warpOptions: ev.options });
    } else if (ev.type === 'shop') {
      this.shopTab.set('gear');
      this.showShop.set(true);
      this.store.openFacility.set({ kind: 'shop', shopTab: 'gear' });
    } else if (ev.type === 'shrine') {
      this.showShrine.set(true);
      this.store.openFacility.set({ kind: 'shrine' });
    } else if (ev.type === 'ossuary') {
      this.showOssuary.set(true);
      this.store.openFacility.set({ kind: 'ossuary' });
    } else if (ev.type === 'trading_post') {
```

- [ ] **Step 3: Set `openFacility` on the remaining 4 openers**

`openTradingPost` (around line 878):

```typescript
  openTradingPost(stock?: TradeStockItem[] | null): void {
    const pos = this.store.you()?.position ?? '';
    this.tradingStock.set(stock ?? this.store.tradingPosts()[pos] ?? []);
    this.giveItem.set(null);
    this.showTradingPost.set(true);
    this.store.openFacility.set({ kind: 'tradingPost' });
  }
```

`openExcavation` (around line 908):

```typescript
  openExcavation(grid?: DigGrid | null): void {
    const pos = this.store.you()?.position ?? '';
    this.excavationGrid.set(grid ?? this.store.excavations()[pos] ?? null);
    this.showExcavation.set(true);
    this.store.openFacility.set({ kind: 'excavation' });
  }
```

`openVein` (around line 926):

```typescript
  openVein(ev?: SpaceEvent): void {
    const pos = this.store.you()?.position ?? '';
    const region = this.map?.nodes.find((n) => n.id === pos)?.region ?? '';
    this.veinDepth.set(ev?.depth ?? this.store.veins()[region]?.depth ?? 0);
    this.veinLog.set(ev?.text ?? null);
    this.showVein.set(true);
    this.store.openFacility.set({ kind: 'vein' });
  }
```

`openVault` (around line 947):

```typescript
  openVault(ev?: SpaceEvent): void {
    const pos = this.store.you()?.position ?? '';
    const region = this.map?.nodes.find((n) => n.id === pos)?.region ?? '';
    this.vaultView.set(
      ev?.vault ?? this.store.vaults()[region] ?? { pot: VAULT_POT_SEED, history: [] },
    );
    this.showVault.set(true);
    this.store.openFacility.set({ kind: 'vault' });
  }
```

- [ ] **Step 4: Clear `openFacility` when a warp completes**

`warpTo()` closes the warp picker directly (`this.showWarp.set(null)`)
rather than through `closeFacilities()`, so without this fix `openFacility`
would stay stale at `{ kind: 'warp', ... }` after a successful warp — the
next tab round-trip would incorrectly reopen an already-completed warp
picker. In `board-tab.component.ts`, change `warpTo` (around line 897):

```typescript
  async warpTo(to: string): Promise<void> {
    await this.run(async () => {
      await this.store.action('warp', { to });
      this.showWarp.set(null);
      this.board?.centerOn(to);
    });
  }
```

to:

```typescript
  async warpTo(to: string): Promise<void> {
    await this.run(async () => {
      await this.store.action('warp', { to });
      this.showWarp.set(null);
      this.store.openFacility.set(null);
      this.board?.centerOn(to);
    });
  }
```

- [ ] **Step 5: Keep the Bazaar sub-tab mirrored when the player switches Bazaar tabs**

The Bazaar's `shopTab` selector button already calls `shopTab.set(...)` directly from the template (`board-tab.component.html`'s `.shop-tab` buttons, e.g. `(click)="shopTab.set('gear')"`). Add a small wrapper method so the store mirror stays in sync, then repoint the template at it.

In `board-tab.component.ts`, add this method right after the `shopTab` signal declaration (line 136):

```typescript
  protected setShopTab(tab: 'gear' | 'consumables' | 'grimoires'): void {
    this.shopTab.set(tab);
    this.store.openFacility.set({ kind: 'shop', shopTab: tab });
  }
```

In `board-tab.component.html`, find the three Bazaar tab buttons (in the `showShop()` block):

```html
          <button class="shop-tab" [class.active]="shopTab() === 'gear'" (click)="shopTab.set('gear')">Gear</button>
          <button class="shop-tab" [class.active]="shopTab() === 'consumables'" (click)="shopTab.set('consumables')">Consumables</button>
          <button class="shop-tab" [class.active]="shopTab() === 'grimoires'" (click)="shopTab.set('grimoires')">Grimoires</button>
```

Replace with:

```html
          <button class="shop-tab" [class.active]="shopTab() === 'gear'" (click)="setShopTab('gear')">Gear</button>
          <button class="shop-tab" [class.active]="shopTab() === 'consumables'" (click)="setShopTab('consumables')">Consumables</button>
          <button class="shop-tab" [class.active]="shopTab() === 'grimoires'" (click)="setShopTab('grimoires')">Grimoires</button>
```

- [ ] **Step 6: Clear `openFacility` in `closeFacilities()`, and route `shrine()` through it**

In `board-tab.component.ts`, change `closeFacilities` (around line 1205):

```typescript
  closeFacilities(): void {
    this.showShop.set(false);
    this.showShrine.set(false);
    this.showWarp.set(null);
    this.showOssuary.set(false);
    this.showTradingPost.set(false);
    this.giveItem.set(null);
    this.showExcavation.set(false);
    this.excavationGrid.set(null);
    this.showVein.set(false);
    this.veinLog.set(null);
    this.showVault.set(false);
    this.vaultView.set(null);
    this.gambleResult.set(null);
    this.gambleRolling.set(false);
    this.gambleDie.set(null);
    this.gambleWon.set(null);
  }
```

to:

```typescript
  closeFacilities(): void {
    this.showShop.set(false);
    this.showShrine.set(false);
    this.showWarp.set(null);
    this.showOssuary.set(false);
    this.showTradingPost.set(false);
    this.giveItem.set(null);
    this.showExcavation.set(false);
    this.excavationGrid.set(null);
    this.showVein.set(false);
    this.veinLog.set(null);
    this.showVault.set(false);
    this.vaultView.set(null);
    this.gambleResult.set(null);
    this.gambleRolling.set(false);
    this.gambleDie.set(null);
    this.gambleWon.set(null);
    this.store.openFacility.set(null);
  }
```

And change `shrine()` (around line 865):

```typescript
  async shrine(choice: string): Promise<void> {
    await this.run(async () => {
      const resp = await this.store.action('shrine', { choice });
      this.showToast(resp.text ?? 'The shrine hums.');
      this.showShrine.set(false);
    });
  }
```

to:

```typescript
  async shrine(choice: string): Promise<void> {
    await this.run(async () => {
      const resp = await this.store.action('shrine', { choice });
      this.showToast(resp.text ?? 'The shrine hums.');
      this.closeFacilities();
    });
  }
```

(This is behavior-neutral: Shrine has no other local state for `closeFacilities()` to touch, so the only change is that `openFacility` now also gets cleared.)

- [ ] **Step 7: Restore an open facility once the view (and `map` input) is ready**

`openVein`/`openVault` read `this.map?.nodes.find(...)` to resolve the player's
region. `map` is `@Input({ required: true })` (line 122) — Angular doesn't
populate `@Input()`s until after the constructor runs, so this restore logic
must live in `ngAfterViewInit()` (where `this.map` is already known-good,
since it's used to construct `BoardCanvas` there), not the constructor.

In `board-tab.component.ts`, change `ngAfterViewInit` (around line 542):

```typescript
  ngAfterViewInit(): void {
    this.board = new BoardCanvas(
      this.canvasRef.nativeElement,
      this.map,
      (nodeId) => this.onTapNode(nodeId),
      this.store.ownUserId,
    );
    // First descent per dungeon per session shows its one-line rite card.
    this.board.setOnEnterDungeon((biome) => {
      if (this.ritesShown.has(biome)) return;
      this.ritesShown.add(biome);
      const rite = DUNGEONS[biome]?.rite;
      if (rite) this.showToast(rite);
    });
    this.syncBoard();
    this.board.start();
  }
```

to:

```typescript
  ngAfterViewInit(): void {
    this.board = new BoardCanvas(
      this.canvasRef.nativeElement,
      this.map,
      (nodeId) => this.onTapNode(nodeId),
      this.store.ownUserId,
    );
    // First descent per dungeon per session shows its one-line rite card.
    this.board.setOnEnterDungeon((biome) => {
      if (this.ritesShown.has(biome)) return;
      this.ritesShown.add(biome);
      const rite = DUNGEONS[biome]?.rite;
      if (rite) this.showToast(rite);
    });
    this.syncBoard();
    this.board.start();
    this.restoreOpenFacility();
  }

  /** Reopen whatever facility modal was open before a tab switch destroyed
   * this component — mirrors the pendingBattle resume pattern in the
   * constructor, but runs here because openVein/openVault need `this.map`,
   * which isn't populated until after construction. */
  private restoreOpenFacility(): void {
    const openFacility = this.store.openFacility();
    if (!openFacility) return;
    switch (openFacility.kind) {
      case 'shop':
        this.shopTab.set(openFacility.shopTab ?? 'gear');
        this.showShop.set(true);
        break;
      case 'shrine':
        this.showShrine.set(true);
        break;
      case 'ossuary':
        this.showOssuary.set(true);
        break;
      case 'tradingPost':
        this.openTradingPost();
        break;
      case 'excavation':
        this.openExcavation();
        break;
      case 'vein':
        this.openVein();
        break;
      case 'vault':
        this.openVault();
        break;
      case 'warp':
        this.showWarp.set(openFacility.warpOptions ?? null);
        break;
    }
  }
```

This runs once, synchronously, when the view is ready — not inside an
`effect()`. It only needs to fire once per component (re)construction;
wrapping it in `effect()` would needlessly re-run the restore logic on every
later `openFacility` change, which is already handled by the openers and
`closeFacilities()` keeping local signals in sync directly as the player
interacts with an already-open modal.

- [ ] **Step 8: Verify it compiles**

Run: `npm run build`
Expected: succeeds, no new errors or warnings beyond the pre-existing ones.

- [ ] **Step 9: Commit**

```bash
git add src/app/undercity/tabs/board-tab.component.ts src/app/undercity/tabs/board-tab.component.html
git commit -m "feat(undercity): reopen facility modals where you left them after a tab switch"
```

---

## Task 4: Lock tab navigation during battle

**Files:**
- Modify: `src/app/undercity/undercity-page.component.ts`
- Modify: `src/app/undercity/undercity-page.component.html:104-123`
- Modify: `src/app/undercity/undercity-page.component.scss`

- [ ] **Step 1: Add the `inBattle` computed and guard `setTab`**

In `src/app/undercity/undercity-page.component.ts`, add after the `youSpriteUrl` computed (line 92):

```typescript

  /** True while a battle is in progress — the server tracks this independently
   * of which tab is mounted, via UndercityStateService.pendingBattle(). */
  protected readonly inBattle = computed(() => !!this.store.pendingBattle());
```

Change `setTab` (line 113):

```typescript
  setTab(tab: Tab): void {
    this.tab.set(tab);
  }
```

to:

```typescript
  setTab(tab: Tab): void {
    if (tab !== 'board' && this.inBattle()) return;
    this.tab.set(tab);
  }
```

- [ ] **Step 2: Disable the non-Board tab buttons while in battle**

In `src/app/undercity/undercity-page.component.html`, change the tab bar (lines 104-123):

```html
        <nav class="tab-bar">
          <button [class.active]="tab() === 'board'" (click)="setTab('board')">
            <mat-icon class="tab-icon">map</mat-icon><span class="tab-label">Board</span>
          </button>
          <button [class.active]="tab() === 'creature'" (click)="setTab('creature')">
            <span class="tab-icon-wrap">
              <mat-icon class="tab-icon">pets</mat-icon>
              @if (you.statPoints > 0) {
                <span class="tab-badge">{{ you.statPoints }}</span>
              }
            </span>
            <span class="tab-label">Creature</span>
          </button>
          <button [class.active]="tab() === 'plaza'" (click)="setTab('plaza')">
            <mat-icon class="tab-icon">park</mat-icon><span class="tab-label">Plaza</span>
          </button>
          <button [class.active]="tab() === 'log'" (click)="setTab('log')">
            <mat-icon class="tab-icon">receipt_long</mat-icon><span class="tab-label">Log</span>
          </button>
        </nav>
```

to:

```html
        <nav class="tab-bar">
          <button [class.active]="tab() === 'board'" (click)="setTab('board')">
            <mat-icon class="tab-icon">map</mat-icon><span class="tab-label">Board</span>
          </button>
          <button [class.active]="tab() === 'creature'" [disabled]="inBattle()" (click)="setTab('creature')">
            <span class="tab-icon-wrap">
              <mat-icon class="tab-icon">pets</mat-icon>
              @if (you.statPoints > 0) {
                <span class="tab-badge">{{ you.statPoints }}</span>
              }
            </span>
            <span class="tab-label">Creature</span>
          </button>
          <button [class.active]="tab() === 'plaza'" [disabled]="inBattle()" (click)="setTab('plaza')">
            <mat-icon class="tab-icon">park</mat-icon><span class="tab-label">Plaza</span>
          </button>
          <button [class.active]="tab() === 'log'" [disabled]="inBattle()" (click)="setTab('log')">
            <mat-icon class="tab-icon">receipt_long</mat-icon><span class="tab-label">Log</span>
          </button>
        </nav>
```

- [ ] **Step 3: Add a disabled style for tab-bar buttons**

In `src/app/undercity/undercity-page.component.scss`, inside the `.tab-bar { button { ... } }` block (around line 243-273), add right after the `&.active` rule:

```scss
    &:disabled {
      opacity: 0.35;
      cursor: default;
    }
```

- [ ] **Step 4: Verify it compiles**

Run: `npm run build`
Expected: succeeds, no new errors.

- [ ] **Step 5: Commit**

```bash
git add src/app/undercity/undercity-page.component.ts src/app/undercity/undercity-page.component.html src/app/undercity/undercity-page.component.scss
git commit -m "feat(undercity): lock tab navigation to Board while a battle is in progress"
```

---

## Task 5: Manual verification

**Files:** none (verification only)

- [ ] **Step 1: Run the full build one more time**

Run: `npm run build`
Expected: succeeds with no new errors/warnings beyond pre-existing ones.

- [ ] **Step 2: Manual smoke test (dev server)**

Using the already-running dev server (or `npm start` if it's not up), navigate to `/undercity` and confirm:
- Landing on a Bazaar/Trading Post/Shrine/Ossuary/Excavation/Vein/Vault/warp node opens its modal without covering the tab bar — Board/Creature/Plaza/Log all stay visible and clickable underneath.
- With a facility modal open, tap Creature — the modal closes (board-tab unmounts), Creature tab shows current stats/gear.
- Tap back to Board — the same facility modal reopens, same sub-tab if it was the Bazaar (e.g. still on Consumables if that's where you left it).
- Start a PvP battle (or land on a wild/elite fight) — Creature/Plaza/Log tab buttons visibly dim and don't respond to taps until the battle resolves; Board stays usable throughout.
- A plain space-landing event card (e.g. a loot space) still opens/closes normally and does not attempt to reopen after a tab round-trip (no restoration expected for it).
