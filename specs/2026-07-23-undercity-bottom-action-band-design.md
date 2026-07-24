# Undercity Bottom Action Band — Design

**Date:** 2026-07-23
**Status:** Approved, pending implementation plan
**Scope:** Client presentation only. No backend / engine changes.

## Goal

Consolidate each play tab's scattered action controls into a single **action band**
that sits in a fixed slot directly above the main navbar, on every play tab. The band's
contents swap to match the active tab and the current moment. The design targets two
things the user called out: **save vertical space** and **keep the available action
obvious** — there should only ever be one place to look for "what can I do right now."

Today those controls float in inconsistent places:
- **Board:** a `.roll-strip` floats at the *top* of the map (Roll/Blink, Cast, contextual
  facility buttons, cooldown hints, reroll/pathfinder prompts) and a separate `.pvp-strip`
  floats at the *bottom*.
- **Creature:** a `.subtab-bar` (Stats / Gear / Wardrobe / Sigils) sits at the top of the tab.
- **Plaza:** a `.forge-bar` (Salvage / Blacksmith / Market + material chips) sits at the top,
  plus a floating `.poke-card` when a player is selected.

## The Action Band

### Shared shell
A new lightweight presentational component `app-uc-action-band` provides the consistent
chrome only:
- Dark panel background matching the navbar (`#15170f`-ish over the game palette).
- A green top border with a soft inset glow, echoing the existing `--accent`/Golgari green.
- Padding + `env(safe-area-inset-bottom)` handling so it never collides with the navbar's
  own safe-area inset (the band sits *above* the navbar, so the inset stays on the navbar).
- The fluid transition (see §Fluid treatment).
- A single projected content slot (`<ng-content>`).

All action logic stays in the individual tab components (board keeps its roll/spell logic,
plaza keeps forge logic, creature keeps its sub-tab state). The band only unifies *look and
position*, not behavior. This avoids hoisting the board's large controller into the page shell.

### Layout mechanics
Each play tab's root becomes a **flex column**:
- The scene (canvas / scrollable panel) fills the top with `flex: 1; min-height: 0`.
- The band pins to the bottom with `flex: none`.

The page shell (`undercity-page.component.html`) is unchanged in structure: `.hud` (top) →
`.tab-body` (holds the active tab) → `.tab-bar` (navbar). Because the band is the bottom
flex child *inside* each tab, it visually reads as one consistent slot just above the navbar
across all tabs.

## Per-tab band contents

### Board
The band shows, left-to-right, whatever is currently available:
- **Roll / Blink** — the existing single primary button that flips between Roll and Blink
  (Blink on a ready turn, Roll while recharging), with the roll count.
- **Cast** — when castable spells or scrolls exist.
- **Facility** — when parked on a special node, a **compact icon-only button** using that
  facility's own icon (Bazaar = storefront, Casino = die/`casino`, Witch = `auto_fix_high`,
  Trading Post = `swap_horiz`, Dig Site = `grid_view`, Crystal Vein = `diamond`,
  Guildvault = `dialpad`). It carries a `title` tooltip with the facility name and opens the
  same full panel/modal on tap. Because a node is only ever one facility type, the maximum is
  Roll + Cast + one facility icon, which fits a single row on a phone.
- **Hint line** — the cooldown / "Blink ready next turn" / "next roll in m:ss" text sits on
  its own line beneath the buttons (as today), only when relevant.

**Morph-to-the-moment:** when a decision is pending, the band replaces its routine buttons
with a short prompt line + that decision's choices, then reverts once resolved:
- **Fleetfoot reroll** — "You rolled a **1**. *Fleetfoot* lets you reroll once." → `Reroll` /
  `Keep the 1`.
- **Pathfinder advantage** — "*Pathfinder* — keep either die." → `Move X` / `Move Y`.
- **PvP** — when an opponent shares your space: "*Name*'s *Creature* (Ln) is here." →
  `Battle` (+ Roll still available, since you may prefer to move on). The shielded state
  disables Battle as today.

The dev-only **Pick** control and its face picker, the **roll picker** (Blink face choice),
and the **coach pill** (first-turn "tap Roll") remain wired to the band's Roll cluster as they
are today.

### Creature
The existing 4 sub-tabs (Stats / Gear / Wardrobe / Sigils) *become* the band, rendered as an
evenly-split sub-navbar. The selected panel's content fills the scene area above. The
unspent-stat-points badge continues to ride on the **Stats** entry. Sub-tab state and its
`localStorage` persistence are unchanged.

### Plaza
Default state: the 3 forge buildings (Salvage / Blacksmith / Market) as an evenly-split
sub-navbar, each keeping its existing count badge (stash size, upgrade count, listings count).
The **Moltings 🌿 / Ichor 🧪** material chips are tucked at the right end of the band (Option A).
Tapping a building opens its existing full forge panel/modal — behavior unchanged.

**Morph-to-the-moment**, mirroring the board:
- Tapping **another player** → band becomes the poke action: "*Name*'s *Creature* (Ln)" →
  `Poke (gift a roll)` / `Deselect`.
- Tapping **yourself** → band becomes the status editor (text input + `Set status`).

## Edge states
- **Log tab** — no actions, so **no band is rendered**; the log list runs straight to the navbar.
- **In battle** — the interactive battle is already a full-screen overlay covering the band and
  navbar, so no special handling is needed. The navbar's existing in-battle disabling is unchanged.
- **Board floating controls** — the camera **focus picker** (top-left) and the **biome chip**
  stay as small floating controls over the map. The biome chip re-anchors to sit just above the
  band's top edge so the two don't overlap. The recent-events **event feed**, **toast**, and the
  various board **overlays/modals** (dice roll, mystery reel, space event, shop, shrine, etc.)
  are unaffected — they already render above everything.

## Fluid treatment
When the band's contents change — a tab switch, or a decision appearing/resolving — apply a
quick **cross-fade + slight height ease (~150ms)** rather than a hard pop. Enough motion to feel
alive without being distracting. Buttons retain the existing `uc-btn` / `uc-btn-primary` /
`uc-btn-danger` styling so the band stays on-brand.

## Files

**New**
- `src/app/undercity/tabs/action-band.component.ts` / `.html` / `.scss` — shared band shell.
- `specs/2026-07-23-undercity-bottom-action-band-design.md` — this doc.

**Edited**
- `tabs/board-tab.component.html` / `.scss` — move roll-strip / pvp-strip / facility buttons
  into the band; restructure root to flex column; facility → icon button; wire morph states.
- `tabs/plaza-tab.component.html` / `.scss` — forge-bar → band (buildings + material chips);
  poke-card → band morph states; restructure root to flex column.
- `tabs/creature-tab.component.html` / `.scss` — subtab-bar → band at the bottom; scene fills above.
- `undercity-page.component.ts` / `.html` / `.scss` — biome-chip reposition above the band;
  ensure no band on the Log tab (nothing to change beyond letting Log render without one).

**Not touched**
- Any Python Lambda / engine / data files. No API, action-contract, or balance changes.

## Non-goals / YAGNI
- No new actions, facilities, or gameplay behavior — this is a relocation + restyle.
- No conversion of the Plaza forge buildings from modals to inline panels (out of scope; they
  keep opening their existing panels).
- No changes to the top HUD contents (avatar, HP/XP, spores, sigils, buffs) beyond leaving room.
