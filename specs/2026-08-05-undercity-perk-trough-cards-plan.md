# Attribute Perks as Chained Stat Cards — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Replace the Undercity Stats panel's separate stat-tiles row + attribute-perks grid with three per-stat cards, each fusing the stat header (effective value + base/gear breakdown) and its perk chain into one column.

**Architecture:** Pure frontend re-style of one component. All data/methods already exist (`perkTrackOrder`, `trackValue`, `trackNodes`, `gearMods`, `openStat`, `selectStat`, `spendStat`, `busy`, `rollStat`, `rollFrom`, `statInfo`). We rewrite one HTML region and its SCSS; **no TypeScript changes**. Design doc: [specs/2026-08-05-undercity-perk-trough-cards-design.md](2026-08-05-undercity-perk-trough-cards-design.md).

**Tech Stack:** Angular 20 standalone component, SCSS, Material icons. **No frontend test runner exists** (CLAUDE.md: Karma removed, `ng test` unavailable). Verification is `npm run build` (compiles the template + type-checks) plus in-browser checks via the `run-undercity` skill.

---

## File Structure

- **Modify:** `src/app/undercity/tabs/creature-tab.component.html` — replace the `stats-body` block (stat-tiles + stat-desc aside) and the `perk-tracks` block with a single `perk-cards` grid followed by the (unchanged-content) `stat-desc` aside.
- **Modify:** `src/app/undercity/tabs/creature-tab.component.scss` — replace the `.stats-body` / `.stat-tiles` / `.stat-tile` styles and the `.perk-tracks` styles with `.perk-cards` / `.pcard` / `.perk-chain` styles; re-home the roll/celebrate/pop/plus-btn nested rules under `.pcard`; keep all `@keyframes`, `.points-chip`, `.stats-hint`, and `.stat-desc` (restyled to full width).
- **No change:** `creature-tab.component.ts`, `data/perks.ts`, backend.

---

## Task 1: Rebuild the stats panel markup and styles

The HTML and SCSS are tightly coupled (class names must match), so they change together in one commit to avoid a broken intermediate.

**Files:**
- Modify: `src/app/undercity/tabs/creature-tab.component.html` (the `@case ('stats')` region, currently lines ~93–187)
- Modify: `src/app/undercity/tabs/creature-tab.component.scss` (lines ~288–497 and ~593–692)

---

- [ ] **Step 1: Replace the HTML region**

In `creature-tab.component.html`, find the block that starts with `<div class="stats-body">` and ends at the close of the `.perk-tracks` `</div>` (the block right before the `<!-- Traits: ... -->` comment / `<div class="passives">`). Replace that **entire** block with:

```html
<!-- Attribute cards: each stat fuses its effective value + base/gear
     breakdown (the header) with its perk chain (6 → 18, top to bottom).
     The header is the interactive tile: tap to open the description aside,
     +1 to spend a stat point, and the number rolls on increase. Perk nodes
     light as invested atk/def/spd PLUS equipped gear cross 6 / 12 / 18;
     temporary buffs never light a node. -->
<div class="perk-cards">
  @for (stat of perkTrackOrder; track stat) {
    <div
      class="pcard"
      [class.active]="openStat() === stat"
      [class.celebrate]="rollStat() === stat"
    >
      <button type="button" class="pcard-head" (click)="selectStat(stat)">
        @if (statInfo[stat].icon.startsWith('uc-')) {
          <mat-icon class="mi" [svgIcon]="statInfo[stat].icon"></mat-icon>
        } @else {
          <mat-icon class="mi">{{ statInfo[stat].icon }}</mat-icon>
        }
        @if (rollStat() === stat) {
          <span class="pcard-val rolling">
            <span class="roll-out">{{ rollFrom() + gearMods()[stat] }}</span>
            <span class="roll-in">{{ trackValue(stat) }}</span>
          </span>
          <span class="stat-pop">+1</span>
        } @else {
          <span class="pcard-val">{{ trackValue(stat) }}</span>
        }
        <span class="pcard-name">{{ stat.toUpperCase() }}</span>
        <span class="pcard-breakdown">
          <span class="bd-base">{{ $any(you)[stat] }}</span>
          @if (gearMods()[stat] > 0) {
            <span class="bd-gear">+{{ gearMods()[stat] }}</span>
          }
        </span>
        @if (you.statPoints > 0) {
          <span
            class="uc-btn plus-btn"
            role="button"
            [class.disabled]="busy()"
            (click)="spendStat(stat); $event.stopPropagation()"
          >
            +1
          </span>
        }
      </button>
      <div class="perk-chain">
        @for (node of trackNodes(stat); track node.perk.id; let last = $last) {
          <div
            class="perk-node"
            [class.lit]="node.lit"
            [title]="node.perk.name + ' — ' + node.perk.blurb"
          >
            <span class="perk-node-thr">{{ node.threshold }}</span>
            <span class="perk-node-name">{{ node.perk.name }}</span>
            <span class="perk-node-blurb">{{ node.perk.blurb }}</span>
          </div>
          @if (!last) {
            <div class="perk-link" [class.lit]="node.lit"></div>
          }
        }
      </div>
    </div>
  }
</div>
@if (openStat(); as s) {
  <aside class="stat-desc">
    <div class="stat-desc-head">
      @if (statInfo[s].icon.startsWith('uc-')) {
        <mat-icon class="mi" [svgIcon]="statInfo[s].icon"></mat-icon>
      } @else {
        <mat-icon class="mi">{{ statInfo[s].icon }}</mat-icon>
      }
      {{ statInfo[s].label }}
    </div>
    <p>{{ statInfo[s].desc }}</p>
  </aside>
}
```

Notes on what changed and why:
- The old `stats-body` flex wrapper is gone; the `stat-desc` aside now renders **after** the cards grid (full width) instead of beside the tiles.
- The big number is `trackValue(stat)` (base + gear), not `you[stat]` (base).
- Roll count-up adds gear to both ends (`rollFrom() + gearMods()[stat]` → `trackValue(stat)`) so it lands on the effective value, still animating a +1 delta.
- The `stat-breakdown` (base + gear = total) is dropped from the aside — the header's `pcard-breakdown` replaces it — so the aside keeps only the label + prose.
- The per-node stat icon in the old `perk-node-thr` is dropped (the card header already shows it); the threshold number becomes a gold "dot" pill.
- `let last = $last` drives the connector: a `perk-link` is emitted after every node except the last, and it lights when the node above it is unlocked.

- [ ] **Step 2: Replace the SCSS**

In `creature-tab.component.scss`, delete the `.stats-body { … }` rule (starts ~line 288) through the end of the `.stat-tile { … }` rule and its `@keyframes` are KEPT — i.e. remove `.stats-body`, `.stat-tiles`, `.stat-tile` and the now-unused `.stat-tile-mod`, but **keep** `@keyframes uc-stat-celebrate / uc-roll-out / uc-roll-in / uc-stat-pop / uc-desc-in / uc-points`, `.points-chip`, `.stats-hint`, `.stats-hint-end`. Also delete the entire `.perk-tracks { … }` rule (~line 593–692). Keep `.stat-desc` but replace its rule with the full-width version below.

Insert this block where `.stat-tiles` used to be:

```scss
// ── Attribute cards ───────────────────────────────────────────────────────────
// Three per-stat cards: header (effective stat + base/gear breakdown) over a
// vertical perk chain. Replaces the old stat-tiles row + perk-tracks grid.
.perk-cards {
  display: grid;
  grid-template-columns: repeat(3, 1fr);
  gap: 8px;
}

.pcard {
  display: flex;
  flex-direction: column;
  border-radius: 13px;
  background: linear-gradient(180deg, rgba(74, 124, 89, 0.14), rgba(0, 0, 0, 0.18));
  border: 1px solid rgba(74, 124, 89, 0.3);
  box-shadow: 0 4px 14px rgba(0, 0, 0, 0.28), inset 0 1px 0 rgba(255, 255, 255, 0.03);
  overflow: hidden;
  transition: border-color 0.15s ease, background 0.15s ease;

  &.active {
    border-color: #9ac79a;
    background: linear-gradient(180deg, rgba(74, 124, 89, 0.28), rgba(0, 0, 0, 0.18));
  }

  // Spending a point pops the whole card and rolls the number.
  &.celebrate {
    animation: uc-stat-celebrate 0.6s ease;
  }
}

// Header = the interactive tile.
.pcard-head {
  position: relative;
  display: flex;
  flex-direction: column;
  align-items: center;
  gap: 1px;
  padding: 10px 6px 9px;
  border: 0;
  border-bottom: 1px solid rgba(74, 124, 89, 0.3);
  background: rgba(0, 0, 0, 0.18);
  font-family: inherit;
  color: inherit;
  cursor: pointer;

  &:hover { background: rgba(0, 0, 0, 0.28); }

  .mi {
    color: #9ac79a;
    font-size: 1.1rem;
    width: 1.1rem;
    height: 1.1rem;
  }

  .pcard-val {
    font-weight: 800;
    font-size: 1.4rem;
    color: #eafff0;
    line-height: 1.1;
    font-variant-numeric: tabular-nums;

    // Count-up: old digit slides up and out, new gold digit rises in behind it.
    &.rolling {
      position: relative;
      display: inline-grid;
      overflow: hidden;

      .roll-out,
      .roll-in { grid-area: 1 / 1; }
      .roll-out { animation: uc-roll-out 0.45s ease forwards; }
      .roll-in { animation: uc-roll-in 0.45s ease 0.05s both; }
    }
  }

  .pcard-name {
    font-size: 0.58rem;
    letter-spacing: 0.11em;
    color: #8a978a;
    margin-top: 2px;
  }

  // base (muted) + gear bonus (green): 20 +2 -> total 22 shown big above.
  .pcard-breakdown {
    display: flex;
    justify-content: center;
    gap: 4px;
    margin-top: 3px;
    font-size: 0.58rem;
    font-variant-numeric: tabular-nums;

    .bd-base { color: #8a978a; }
    .bd-gear { color: #9ac79a; font-weight: 700; }
  }

  // The little "+1" that floats off the header as the number lands.
  .stat-pop {
    position: absolute;
    top: 4px;
    left: 50%;
    font-size: 0.95rem;
    font-weight: 800;
    color: #fbbf24;
    text-shadow: 0 0 8px rgba(251, 191, 36, 0.75);
    pointer-events: none;
    animation: uc-stat-pop 0.7s ease forwards;
  }

  .plus-btn {
    margin-top: 6px;
    padding: 2px 12px;
    font-size: 0.82rem;
    border-color: rgba(167, 139, 250, 0.6);
    background: rgba(167, 139, 250, 0.18);
    color: #d8ccfa;

    &.disabled {
      opacity: 0.45;
      pointer-events: none;
    }
  }
}

// The perk chain under the header.
.perk-chain {
  display: flex;
  flex-direction: column;
  align-items: stretch;
  padding: 8px 6px 9px;
}

.perk-node {
  border-radius: 8px;
  padding: 6px 7px 7px;
  text-align: center;
  background: rgba(0, 0, 0, 0.22);
  // locked: dim + desaturated until the threshold is crossed.
  opacity: 0.4;
  filter: grayscale(0.55);
  transition: opacity 0.15s ease;

  &.lit {
    opacity: 1;
    filter: none;
    background: rgba(154, 194, 110, 0.14);
    border: 1px solid rgba(154, 194, 110, 0.45);
  }

  .perk-node-thr {
    display: inline-block;
    font-size: 0.6rem;
    font-weight: 800;
    color: #c9b458;
    background: rgba(201, 180, 88, 0.14);
    border: 1px solid rgba(201, 180, 88, 0.32);
    border-radius: 999px;
    padding: 0 7px;
    margin-bottom: 4px;
    font-variant-numeric: tabular-nums;
  }

  &.lit .perk-node-thr {
    color: #14201a;
    background: #c9b458;
    border-color: #c9b458;
  }

  .perk-node-name {
    display: block;
    font-size: 0.68rem;
    font-weight: 700;
    color: #dfe7df;
    line-height: 1.15;
  }
  .perk-node-blurb {
    display: block;
    font-size: 0.6rem;
    color: #a7b5a7;
    line-height: 1.24;
    margin-top: 2px;
  }
}

// Short connector line joining consecutive perks in the chain. Lights green
// when the perk above it is unlocked.
.perk-link {
  width: 2px;
  height: 9px;
  margin: 0 auto;
  background: rgba(255, 255, 255, 0.09);
  border-radius: 2px;

  &.lit { background: rgba(154, 194, 110, 0.75); }
}
```

Then replace the `.stat-desc { … }` rule with this full-width version (the aside now sits below the grid, not beside it):

```scss
.stat-desc {
  margin-top: 12px;
  padding: 12px;
  border-radius: 10px;
  background: rgba(0, 0, 0, 0.28);
  border: 1px solid rgba(74, 124, 89, 0.3);
  animation: uc-desc-in 0.2s ease;

  .stat-desc-head {
    display: flex;
    align-items: center;
    gap: 6px;
    font-weight: 800;
    color: #b7e4c7;
    margin-bottom: 6px;

    .mi { color: #9ac79a; }
  }

  p {
    margin: 0;
    font-size: 0.82rem;
    line-height: 1.45;
    color: #c3d3c3;
  }
}
```

Also update the `uc-desc-in` keyframe's transform from horizontal to vertical (the aside now enters from below, not the side): change `translateX(6px)` to `translateY(6px)` inside `@keyframes uc-desc-in`.

- [ ] **Step 3: Build to verify it compiles**

Run: `npm run build`
Expected: build succeeds with no template/type errors. (A missing method or bad binding in the new template would fail here.)

- [ ] **Step 4: Commit**

```bash
git add src/app/undercity/tabs/creature-tab.component.html src/app/undercity/tabs/creature-tab.component.scss
git commit -m "feat(undercity): fuse stat tiles and perks into chained stat cards"
```

---

## Task 2: In-browser verification

No unit tests exist for this component, so verify behavior live. Use the `run-undercity` skill to launch the dev server against the live AWS backend and reach a creature with mixed perk state.

**Files:** none (verification only)

- [ ] **Step 1: Launch and open the Stats tab**

Follow the `run-undercity` skill to start the dev server and navigate to a creature's **Stats** tab. Confirm the three cards render side by side (ATK / DEF / SPD).

- [ ] **Step 2: Verify the header numbers**

For a stat with equipped gear, confirm: the **big number equals base + gear** (e.g. base 20 + gear 2 → `22`), the breakdown line shows `20 +2` (base muted, gear green), and for a stat with no gear the breakdown shows just the base with no green `+N`.

- [ ] **Step 3: Verify the chain lights**

Confirm perks light exactly when the effective stat crosses 6 / 12 / 18: a maxed track is a fully green chain (nodes + connectors), a partial track lights only the crossed nodes and the connectors below them stay dim, an under-6 track is fully dark.

- [ ] **Step 4: Verify interactions**

- Tap a card header → the description aside opens **below** the grid with the stat's label + prose, and the tapped card gets the `active` highlight. Tap again → closes.
- On a creature with `statPoints > 0`: the `+1` button shows in the header, tapping it spends a point **without** also opening the aside (stopPropagation), the big number rolls up by 1 and lands on the new effective value, and the `+1` pop floats off.

- [ ] **Step 5: Verify the evolution screen**

Reach the "EVOLUTION AWAITS — choose your form" panel (same component) and confirm the same cards render correctly there, degrading to a clean read-only set when no spend/roll affordances apply.

- [ ] **Step 6: Stop the dev server / headless browser**

Shut down only the process you started (never blanket-kill Chrome).

---

## Self-Review

**Spec coverage:**
- Three chained stat cards, atk/def/spd order → Task 1 Step 1 (`perk-cards` grid over `perkTrackOrder`), Step 2 styles. ✓
- Header: icon, big effective stat, name, base/gear breakdown, divider → Task 1 (`pcard-head`, `pcard-breakdown`, `border-bottom`). ✓
- Perks 6→18 top to bottom with lighting connectors → Task 1 (`trackNodes` order, `perk-link` with `[class.lit]`). ✓
- Preserve tap-to-learn / aside → aside rendered below grid, `selectStat`, `active`. ✓
- Preserve `+1` spend with stopPropagation and `busy()` disable → carried verbatim into `pcard-head`. ✓
- Preserve roll/celebrate animation, corrected to effective value → `rollFrom() + gearMods()[stat]` → `trackValue(stat)`, `celebrate` on `.pcard`. ✓
- Drop "Attribute perks" title + aside `stat-breakdown` → both removed in Step 1. ✓
- Evolution screen uses same component → Task 2 Step 5. ✓
- No backend/data/TS changes → File Structure "No change". ✓

**Placeholder scan:** No TBD/TODO; every code step shows complete markup/SCSS. ✓

**Type/name consistency:** Class names match between HTML (Step 1) and SCSS (Step 2): `perk-cards`, `pcard`, `pcard-head`, `pcard-val`, `pcard-name`, `pcard-breakdown`, `bd-base`, `bd-gear`, `stat-pop`, `plus-btn`, `perk-chain`, `perk-node`, `perk-node-thr/-name/-blurb`, `perk-link`, `stat-desc`. Methods/signals (`perkTrackOrder`, `trackValue`, `trackNodes`, `gearMods`, `openStat`, `selectStat`, `spendStat`, `busy`, `rollStat`, `rollFrom`, `statInfo`, `you.statPoints`) all confirmed to exist in the current `.ts`. ✓
