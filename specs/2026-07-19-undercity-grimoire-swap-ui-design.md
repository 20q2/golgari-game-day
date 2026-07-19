# Undercity — Grimoire Swap UI Redesign

**Date:** 2026-07-19
**Scope:** Frontend only. The Grimoire section of the creature tab
(`src/app/undercity/tabs/creature-tab.component.{html,ts,scss}`).

## Problem

The grimoire swapping UI is confusing on every axis players tested:

1. **Toggle-off is surprising** — clicking the already-open book sends
   `grimoireId: null`, silently un-equipping it and removing all its spells.
   Stowing to no-book has no gameplay benefit, so this is pure footgun.
2. **Cooldown is unclear** — non-open books are `disabled` during the 30-min
   swap cooldown with only a paragraph of text below to explain why.
3. **Equipped vs owned is unclear** — the only signal that a book is open is a
   `.selected` outline; hard to relate the chip row to the spell list above.
4. **No feedback on action** — clicking a chip communicates the result only via
   a transient toast.

## Underlying mechanic (unchanged)

- A player owns N grimoires (`you.grimoires`). Exactly one can be **open**
  (`you.equippedGrimoire`); its spells become castable.
- Opening a *different* grimoire starts a 30-min cooldown
  (`GRIMOIRE_SWAP_COOLDOWN_MIN = 30`, server + `spells.ts` mirror). Stowing
  (`grimoireId: null`) is free but pointless.
- Server action `_equip_grimoire` in `undercity_db.py` and its tests are **not
  changed** — the stow path simply stops being reachable from this UI.

## Design — "Bookshelf, no stow"

Three stacked regions inside the existing Grimoire `.card`.

### 1. Open-book panel (top)

Existing `.spell-rows` block, with additions:

- A header line naming the currently-open book with an `◆ OPEN` badge.
- Innate spell always shown (unchanged).
- Empty state: if the player owns books but `equippedGrimoire == null`, show
  the innate spell plus a prompt — *"Tap a book below to open it."* (reuse the
  `.bag-empty` muted style). The existing "No grimoire open. Books wait in the
  bazaars." copy stays for the owns-nothing case.

### 2. The shelf (chips)

One `.book-chip` per owned book, in three visually distinct states:

- **Open** — accent-filled, `✓ OPEN` badge. Click is a **no-op**: it fires a
  small "Already open." toast and never sends `null`.
- **Ready to open** — normal chip, hint `Tap to open`. Click opens it.
- **Locked** (swap cooldown active AND not the open book) — dimmed, `disabled`,
  shows a `🔒 28m` countdown inline on the chip itself (not only in the note
  below).

### 3. Cooldown copy

Reword the existing note to explain the *why*, shown while
`grimoireSwapLeft() > 0`:

> "Swapping books starts a 30-min cooldown — you carry one loadout at a time.
> {{ grimoireSwapLeft() }} min until you can open a different book."

## Logic change

`equipBook(id)` in `creature-tab.component.ts`:

```
async equipBook(id) {
  if (this.store.you()?.equippedGrimoire === id) {
    this.showToast('Already open.');   // no-op, never send null
    return;
  }
  await this.run(() => this.store.action('equip-grimoire', { grimoireId: id }));
}
```

- Removes the `already ? null : id` toggle entirely.
- Per-chip cooldown minutes render from the existing `grimoireSwapLeft()`
  computed. Consistent with spell cooldowns, these are static minute labels that
  refresh on state change — **no live per-second ticking** (matches the rest of
  the tab; out of scope to add a timer).

## Out of scope

- No backend, config, or Python test changes.
- The 30-min cooldown value is unchanged.
- No live countdown timer.
- The server-side stow action remains; it is simply not triggered by this UI.

## Testing

No automated frontend tests exist (Karma removed). Verify by `npm run build`
plus manual driving of the creature tab: open a book, confirm the OPEN badge and
spell list; click the open book and confirm the "Already open." toast with no
loadout change; swap to another book and confirm the shelf locks with per-chip
`🔒 Nm` countdowns.
