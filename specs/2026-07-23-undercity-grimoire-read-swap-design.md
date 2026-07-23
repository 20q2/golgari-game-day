# Undercity — Grimoire "Read First, Then Commit" UI

**Date:** 2026-07-23
**Scope:** Frontend only. The Grimoire `.card` in the creature tab
(`src/app/undercity/tabs/creature-tab.component.{html,ts,scss}`).
Supersedes the shelf portion of
[2026-07-19-undercity-grimoire-swap-ui-design.md](2026-07-19-undercity-grimoire-swap-ui-design.md).

## Problem

Two complaints stand after the 2026-07-19 "Bookshelf, no stow" pass:

1. **You can't read a book before opening it.** The section only renders the
   spells of the *open* book. Every other owned book is a bare name chip, so
   there is no way to see what spells you'd gain before committing to a swap.
2. **The 30-min cooldown is under-communicated.** It's a muted paragraph that
   only appears *after* a swap (`grimoireSwapLeft() > 0`). Nothing warns you at
   the moment you tap that opening a different book locks swapping for 30 min.

## Underlying mechanic (unchanged)

- A player owns N grimoires (`you.grimoires`). Exactly one is **open**
  (`you.equippedGrimoire`); its spells are castable. Innate spells are always
  castable regardless of the open book.
- Opening a *different* book starts a 30-min cooldown
  (`GRIMOIRE_SWAP_COOLDOWN_MIN = 30`, server + `spells.ts` mirror). Server
  action `equip-grimoire` (`_equip_grimoire` in `undercity_db.py`) and its tests
  are **not changed**.
- Book contents come from `bookSpells(book)`, which prefers the player's mutable
  `grimoireSpells[book.id]` and falls back to the static bundle.

## Design — read first, then commit

Three regions inside the Grimoire `.card`.

### 1. Open-loadout panel (top) — unchanged

The existing block: `◆ OPEN` header naming the open book, innate spells, then
the open book's spells, each with a `cooldownLabel()` badge. This is the
"what's castable right now" view. Empty-state copy (owns books but none open /
owns nothing) is unchanged.

### 2. The shelf — now readable

One expandable row per owned book (`ownedBooks()`), replacing the flat chip row.

- **Header** (always tappable to expand, *except* the open book): `menu_book`
  icon + book name + a state marker on the right:
  - Open book → `✓ OPEN` badge; header is **not** expandable (its spells are the
    top panel). No chevron.
  - Any other book → a chevron (`▸` collapsed / `▾` expanded).
- **Reading is always available** — expanding works during a swap cooldown and
  for books you have no intention of opening. Only **one** book is expanded at a
  time (`expandedBook` signal; tapping the open row toggles it shut).
- **Expanded panel** lists that book's spells from `bookSpells(book)` — icon,
  name, and description. No cooldown badge here (non-open books aren't castable;
  the label would be misleading). Below the spell list, an **action row**:
  - Book is the open one → *n/a* (open book isn't expandable, so this row never
    renders for it).
  - `grimoireSwapLeft() > 0` (cooldown active) → disabled control
    `🔒 Locked · {{ grimoireSwapLeft() }}m`.
  - Ready → an `Open this book` button.

### 3. Confirm step guards the swap

Tapping `Open this book` does **not** fire the action. It sets
`confirmOpen = book.id`, and the action row swaps to a confirm prompt — mirroring
the bag's existing drop-confirm idiom (`dropConfirm()`):

> Opening locks swapping for **30 min**. Open **{{ book.name }}**?
> **[ Open ]  [ Cancel ]**

- **Open** → calls the existing `equipBook(book.id)` (unchanged; its
  no-op-on-already-open guard stays), then clears `confirmOpen`/`expandedBook`.
- **Cancel** → clears `confirmOpen`, leaving the panel expanded for more reading.

Only one confirm can be live at a time. Collapsing/expanding another row clears
any pending confirm.

### 4. Always-visible cost line

Under the shelf, always shown (not gated on `grimoireSwapLeft()`):

> One loadout at a time — opening a different book locks swapping for 30 min.

When a cooldown is running, append the live countdown:

> {{ grimoireSwapLeft() }} min until you can open a different book.

## Logic / state changes (`creature-tab.component.ts`)

New signals + helpers; no changes to `equipBook`, the store, or any computed
above it:

```ts
protected readonly expandedBook = signal<string | null>(null);
protected readonly confirmOpen  = signal<string | null>(null);

toggleBook(id: string): void {
  this.confirmOpen.set(null);
  this.expandedBook.set(this.expandedBook() === id ? null : id);
}
askOpen(id: string): void { this.confirmOpen.set(id); }
cancelOpen(): void { this.confirmOpen.set(null); }
```

`equipBook(id)` gains a reset of both signals on success (or just call the
existing method then clear in the template handler). Per-row cooldown minutes
render from the existing `grimoireSwapLeft()` computed — static minute labels
that refresh on state change, no per-second ticking (consistent with the rest of
the tab).

## Out of scope

- No backend, config, or Python test changes. The 30-min value is unchanged.
- No live per-second countdown timer.
- The open book stays collapsed (no tap-to-expand); its spells are the top panel.
- Stowing to no-book remains unreachable from this UI (as of 2026-07-19).

## Testing

No frontend test runner (Karma removed). Verify with `npm run build` plus manual
driving of the creature tab:

1. Expand a non-open book and confirm its spell list (name + desc) renders.
2. Trigger a swap cooldown, then confirm you can **still expand and read** any
   book while the shelf's Open controls show `🔒 Locked · Nm`.
3. Tap `Open this book` → confirm the *"locks swapping for 30 min"* prompt
   appears and no swap fires until **Open** is tapped.
4. Confirm the always-on cost line is present with no cooldown, and appends the
   countdown once a swap is on cooldown.
