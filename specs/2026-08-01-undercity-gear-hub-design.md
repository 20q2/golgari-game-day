# Undercity Gear landing hub

## Problem

The Creature tab's **Gear** sub-tab (`creature-tab.component.html`, the
`@case ('gear')` block) is one long vertical scroll stacking four unrelated
systems in a row: Equipment (stat preview + 3 worn slots), Stash, Bag, and
Grimoire. On a phone this is a lot of thumb-scrolling, and the Grimoire — a
genuine mini-system with its own book-swap rules — sits at the very bottom
where players don't discover it. The four things have nothing structurally in
common beyond "stuff you carry," so a flat scroll gives no sense of where one
system ends and the next begins.

## Goals

- Replace the single Gear scroll with a **landing hub**: tapping Gear opens a
  three-tile home; tapping a tile drills into that system; a back control
  returns to the grid.
- Each tile is a **live status card**, not a dumb menu row — it shows at a
  glance what's inside (worn count, whether a book is open, bag fullness) so
  the hub reads as a dashboard.
- Give the Grimoire ("Magic") equal billing with Equipment instead of burying
  it, and let it carry a distinct visual accent (the Golgari purple already
  used for magic elsewhere) so it stands apart from the two gear-green tiles.
- Keep every existing item interaction unchanged — the item-detail popup,
  equip-from-stash, use/plant consumables, send-to-market, book open/swap all
  behave exactly as they do today, just reached from inside a section.

## Non-goals

- No change to the four **top-level** Creature sub-tabs (Stats / Gear /
  Wardrobe / Sigils) or the bottom action-band nav. This restructures only
  what renders *inside* the Gear case.
- No change to any game logic, item data, market, or grimoire-swap rules.
- No fourth tile. The 2×2 grid deliberately holds three tiles and leaves the
  bottom-right cell as whitespace rather than padding it with a filler system.
- Wardrobe and Sigils stay where they are (their own sub-tabs); they are not
  folded into the gear hub.

## Design

### Tiles and where each system lives

Three tiles, laid out in a 2-column grid (bottom-right cell intentionally
empty):

| Tile | Contains | Accent |
| --- | --- | --- |
| **Equipment** | stat preview + 3 worn slots (Fang/Carapace/Charm) **and Stash** below | moss green |
| **Magic** | Grimoire: open book, its spells + innate spells, the owned-book list with open/swap | purple |
| **Bag** | consumables (use / plant / market) | moss green |

**Stash moves under Equipment.** Stash is unequipped *gear* you're carrying;
it belongs with the gear you're wearing, not as a peer system. Inside the
Equipment section it renders as a second card directly below the worn slots —
the same `stashRows()` list and `selectItem('stash', …)` tap target that
exists today, just relocated.

### Sub-view state

The Gear case gains an internal view signal, alongside the existing
`subTab` signal (`creature-tab.component.ts:107`):

```typescript
type GearSection = 'home' | 'equip' | 'magic' | 'bag';
protected readonly gearSection = signal<GearSection>('home');
```

- `subTab() === 'gear' && gearSection() === 'home'` → render the 3-tile grid.
- `gearSection() === 'equip' | 'magic' | 'bag'` → render that section's cards
  with a **‹ Gear** back button (a `selectGear(section)` setter opens a tile;
  the back button calls `gearSection.set('home')`).

**Remembered section.** `gearSection` persists to `localStorage` under a new
key (e.g. `uc-gear-section`), mirroring the existing `SUBTAB_KEY` pattern
(`creature-tab.component.ts:46-59`). Entering the Gear tab restores the last
section you were in rather than always dumping you on the hub — so a player
who lives in Equipment isn't forced back through the grid every visit.
Default is `'home'` on first ever use.

Leaving the Gear tab (switching to Stats/Wardrobe/Sigils) does **not** reset
`gearSection`; the restore-on-return is the whole point.

### Tile content (status lines)

Each tile derives its summary from signals that already exist, so the
dashboard stays truthful with zero new game state:

- **Equipment** — count `worn/3` from `you.gear`; status names worn pieces +
  stash fill (`stash 0/6` from `stashRows().length` / `stashCap`); pill shows
  the net gear stat mod (e.g. `ATK +2`) from `gearMods()`.
- **Magic** — count = grimoires collected (`you.grimoires.length`); status =
  open book name (`equippedBook()`) or "no book open"; pill = spells ready.
- **Bag** — count `you.bag.length/3`; status lists the carried items; pill
  flags `full` when at capacity.

### Icons

All-outlined SVG in the app's existing Material-outlined idiom (`mat-icon` /
the `uc-*` custom svg set) — **no emoji**. Tiles use: Equipment → a
crest/armor glyph (not a medical-cross shield), Magic → open book, Bag →
satchel. Slot, spell, and bag-item rows keep the icons they already use
(`uc-fang`, `uc-carapace`, `uc-charm`, `consumableMap[item].icon`, etc.).

### Markup structure

Inside `@case ('gear')`, replace the four stacked `<section class="card">`
blocks with:

```
@switch (gearSection()) {
  @case ('home')  { <div class="gear-hub">…3 tiles…</div> }
  @case ('equip') { <back/> …Equipment card… …Stash card… }
  @case ('magic') { <back/> …Grimoire card… }
  @case ('bag')   { <back/> …Bag card… }
}
```

The Equipment/Stash/Bag/Grimoire card bodies are the **existing markup moved
verbatim** — only their wrapping/placement changes. The hub grid and back
control are new SCSS in `creature-tab.component.scss`, reusing the established
tokens (moss/purple/gold palette, card gradients, `$mobile` breakpoint).

## Files touched

- `src/app/undercity/tabs/creature-tab.component.ts` — add `GearSection` type,
  `gearSection` signal with localStorage persistence (new key + load/save
  mirroring `SUBTAB_KEY`), a `selectGear()` setter, and tile-summary computed
  helpers (worn count / bag fullness / magic status).
- `src/app/undercity/tabs/creature-tab.component.html` — restructure the
  `@case ('gear')` block into a `@switch (gearSection())` with a hub grid and
  three drill-in sections (back button + relocated existing cards; Stash moved
  under Equipment).
- `src/app/undercity/tabs/creature-tab.component.scss` — hub grid + tile
  styles, back-button style, magic-tile purple accent; reuse existing tokens.
