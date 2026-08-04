# Undercity — Grimoire panel redesign (swap UX)

**Date:** 2026-08-04
**Scope:** Gear → Grimoire section of `creature-tab.component` (html + scss + ts). Display-only; no server, balance, or data-model changes.

## Problem

The current Grimoire panel makes a high-stakes choice (opening a book locks swapping for 30 min) hard to reason about:

- **"Open" is overloaded.** `◆ OPEN` badge (state), `✓ OPEN` chip badge (same state, repeated), and the "Open this book" button (action) all share the word. With one book owned, the book name and an OPEN badge render twice.
- **The 30-min swap lock is invisible until you act** — it lives in grey fine print and inside the per-book expand, never as at-a-glance status.
- **No compare-before-commit.** You expand one book at a time; you never see a candidate loadout next to the active one before making the locked choice.
- **Spell rows lack combat texture** — no source (innate vs book) or cooldown, only a bare `Ready`.
- **`🔒` emoji** violates the game's no-emoji icon rule.

## Design

One component, three template regions, driven by existing store data (`equippedBook()`, `ownedBooks()`, `bookSpells()`, `innateSpells()`, `grimoireSwapLeft()`, `cooldownLabel()`). Icons stay `mat-icon`.

### 1. Header + swap-status pill

`Grimoire (N)` heading with a right-aligned status pill, shown only when more than one book is owned (swapping is only meaningful then):

- **Ready:** green pill, "Swap ready".
- **On cooldown:** amber/red pill, "Swap in {n}m", with a thin bar draining `grimoireSwapLeft() / GRIMOIRE_SWAP_COOLDOWN_MIN`.

### 2. Active loadout

The equipped book is the header of this region with a single **`Active`** tag (no more OPEN badge). Below it, innate spells then the book's spells as enriched rows:

- source chip — `Innate` or `Book`
- cooldown — real-time minutes from `SpellInfo.cooldownMin` ("30m cooldown", or "no cooldown" when 0)
- current readiness — existing `cooldownLabel()` (`Ready` / `{n} min`)

If no book is open (owns books but none equipped) or owns none, keep the existing empty-state copy.

### 3. Book switcher + compare (only when >1 book owned)

A tab strip of all owned books. The equipped one carries the `Active` tag; a tapped non-active tab becomes the highlighted **candidate**.

- Selecting the active tab (or no selection): no compare, just the active loadout from region 2.
- Selecting a **candidate**: render a two-column compare — **Active now** vs **If you open {name}** — each column listing that book's spells (name + short descriptor). Below it, one commit button:
  - swap ready → enabled, label "Open {name} — locks swapping 30m", calls `equipBook(id)`.
  - swap on cooldown → disabled, label "Swap locked · {n}m left".

The commit button's label carries the consequence, so the separate confirm dialog is removed. Selecting a tab then pressing commit is the deliberate two-tap flow.

Compare grid is 2-col, collapsing to stacked single-column under the phone breakpoint (phone-first).

## State model changes (`creature-tab.component.ts`)

- **Remove:** `expandedBook`, `confirmOpen` signals; `toggleBook()`, `askOpen()`, `cancelOpen()`.
- **Add:** `previewBook = signal<string|null>(null)` (tab selection).
- **Add computeds:** `previewedBook` (falls back to equipped), `isComparing` (preview ≠ equipped), `swapReady` (`grimoireSwapLeft() === 0`), `swapPct` (for the bar).
- **Unchanged:** `equipBook(id)` — already the single commit path; it clears related state and toasts the result. It should also clear `previewBook` on success.

## Non-goals

- No change to how books are acquired, inscribed, or priced.
- No server/engine change; cooldowns and swap-lock timing are already server-authoritative and only displayed here.
- No change to innate-spell resolution.

## Verification

No frontend test runner in this repo. Verify with `npm run build` (prod build must pass), and optionally drive the live panel via the `run-undercity` skill to eyeball both states (one book / multiple books, swap ready / locked). Deploy is left to the user.
