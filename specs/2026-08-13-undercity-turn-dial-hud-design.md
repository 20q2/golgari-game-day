# Undercity Turn Dial HUD — Design

**Date:** 2026-08-13
**Status:** Approved, not yet implemented
**Scope:** Client only (Angular). No Lambda, engine, or balance-table changes.

## Summary

Add a second, opt-in HUD skin for the Undercity **board tab**: a large circular
"turn dial" anchored bottom-right (Total War / Civ VI end-turn button lineage)
showing the die icon and rolls remaining, ringed by an arc of smaller satellite
buttons (bag, cast, pet, current-space action).

The existing bottom action band remains the default and is **not modified**. The
player flips between skins with a one-tap toggle in the page header.

## Motivation

- **Thumb reachability.** Roll is the overwhelming majority of taps in a session.
  Today it sits in a horizontally-centred strip competing with the tab bar ~10px
  below it. Bottom-right is the cheapest pixel on a phone.
- **Vertical space.** The bottom of the screen currently stacks a 58px+ action
  band on top of the 34px tab bar. On routine turns the dial skin gives the board
  ~64px back.
- **The corner is already a proto-cluster.** `.bag-fab` (bottom 10 / right 10)
  and `.pet-quickuse` (bottom 10 / right 60) already live there. The dial is a
  promotion of something real, not a new invention.

## Non-goals

- Changing the creature or plaza tabs (their bands are navigation and poke UI,
  not turn actions).
- Moving any action logic off `BoardTabComponent`.
- Left-hand mirroring. Deferred until someone asks.
- Replacing the band outright. Both skins ship; band stays the default.

## Prior art referenced

- **Civ VI** — round Next Turn button bottom-right whose *ring* encodes turn
  state. The clearest precedent for "the circle communicates state, not just an
  action".
- **Total War** — corner end-turn cluster.
- **Genshin Impact / Diablo Immortal (mobile)** — dominant primary button
  bottom-right with smaller ability circles on a quarter-arc in the thumb zone.
  Closest phone-first precedent.
- **Material "FAB speed dial"** — the idiom name for a FAB expanding into an arc
  of mini-FABs.
- **GTA V / RDR2 weapon wheels** — referenced for *look* only. Their
  hold-to-open behaviour is explicitly rejected (see Decisions).

## Scope: which band is affected

`UcActionBandComponent` itself is never modified, and two of its three consumers
never change.

| Tab | Band contents | Affected? |
| --- | --- | --- |
| Board | Roll/Blink, Cast, Reclaim, admin Move, facility button, decision morphs | **Yes — this is what the dial replaces** |
| Creature | Stats / Wardrobe / Sigils sub-tab nav (`creature-tab.component.html:933-948`) | No |
| Plaza | Poke card + status editor (`plaza-tab.component.html:7-87`) | No |

## Architecture

Three additions. No rewrites, no logic relocation.

### 1. `HudSkinService` (new, ~25 lines)

Single signal `skin: 'band' | 'dial'`, persisted to a `localStorage` key,
defaulting to `'band'`. A service rather than a component signal because the
toggle lives in the page header (`undercity-page.component.html`) while the dial
lives inside the board tab.

Follows the existing ad-hoc preference pattern (module-level key const +
signal, as in `hatch-flow.component.ts:36-49`). Deliberately **not** a general
settings framework — there is no settings UI in the app today and inventing one
is out of scope.

### 2. `UcTurnDialComponent` (new)

Purely presentational. Inputs and outputs only; no store injection, no API
calls, no business logic. Rendered inside `.board-scene` as an absolutely
positioned overlay, the same way `.bag-fab` is today.

Inputs cover dial state (mode, count, gauge fraction, rested count, countdown
label, disabled, dimmed) and a `satellites` array of
`{ key, icon, label, badge, tone, disabled }`. Outputs are a single `act` event
carrying a satellite key, plus `roll` / `pickFace(n)`.

### 3. Two `@if`s in `board-tab.component.html`

One wraps the routine `.action-row` branch; one mounts the dial. Every handler
(`roll()`, `pickRoll(n)`, `reroll()`, `useBagItem()`, `openReclaim()`,
`showShop.set(true)`, …) stays exactly where it is. `BoardTabComponent` wires
the dial's outputs to methods it already has.

Deleting the dial component and those two `@if`s restores today's build exactly.

### Consequence: no duplicate corner controls

Under the dial skin, `.bag-fab` and `.pet-quickuse` become arc satellites, so
those two overlays render only under the band skin. Otherwise the bag would
appear twice in the same corner.

### Explicitly not refactored

The band's nested `@if/@else` chain would read better as a state enum, but
`board-tab.component.html` is 1739 lines and frequently carries parallel WIP. A
250-line template restructure is a merge hazard for no functional gain. Only one
small `bandHasDecision()` computed is added; the existing conditionals are left
untouched.

## The dial

One control that morphs, mirroring how the Roll button already behaves.

| State | Dial shows | Tap |
| --- | --- | --- |
| Default | die icon + `rollsBanked()` (`∞` in debug), "ROLL" | `roll()` |
| `blinkAllowed()` | bolt + count, "BLINK" | open face ring |
| `pickAllowed()` (dev only: `debug && isDevMode()`) | casino icon, "PICK" | open face ring |
| `rolling()` / `pendingMove` | dimmed, holds position, shows rolled value | inert |
| `rollBlocked()` | dimmed, empty gauge | inert |
| `blinkRecharging()` | normal Roll + "recharges" pill above | `roll()` |

### Face ring

Today's `.roll-picker` is a flat row of six buttons. Under the dial it becomes a
**ring of six faces around the dial** — the one place the wheel metaphor truly
pays off — plus the seventh "random" slot that Blink already offers
(`board-tab.component.html:322-330`). Dev Pick gets six faces, no random slot,
matching current behaviour.

### Preserved behaviours

- The dial **stays in place, dimmed**, through rolling and moving. Today's Roll
  button does this deliberately so the row never collapses mid-turn.
- `rollBlocked()` shows **no explanatory text**, per the reasoning at
  `board-tab.component.ts:2006-2008`: the disabled control plus the countdown
  already convey "out of rolls", and when the cause is a full bag the
  (non-blocking) pickup sorter is already on screen demanding attention.

### Ring semantics: bank gauge, not regen countdown

The ring fill is **`rollsBanked() / ROLL_CAP`** — a tempo gauge.

A draining regen countdown was considered and rejected. `nextRollLabel()` is
minute-granularity, recomputed only on state polls, and returns time-remaining
*without* the period. A smooth arc would therefore need a new 1s ticker plus a
client mirror of `ROLL_REGEN_MINUTES = 30`, and it would render **wrong**
whenever rested rolls are paying a double tick.

The gauge needs one scalar mirror (`ROLL_CAP = 10`, per
`undercity_config.py:17`), no ticker, and answers the more useful question. The
countdown survives as a text label beneath the count — exactly the string
`nextRollLabel()` already produces. Rested rolls render as a thin second outer
arc.

Per repo convention, the `ROLL_CAP` mirror is a display mirror and must be
updated if the server value is tuned.

## The arc

Fixed slot geometry: unavailable actions leave a **hole** rather than reflowing,
so icon positions never move and muscle memory holds. Radius 62px from dial
centre, 30px satellites (~32px arc spacing at 30° — just clears). Dial 62px.
Total footprint ~150×150.

| Angle | Slot | Hole when |
| --- | --- | --- |
| 180° | Bag (`uc-pouch` + count badge) | bag empty |
| 210° | Cast | no castable spells or scrolls |
| 240° | Pet (sprite, ready-pulse, cooldown) — port of `.pet-quickuse` | no active usable pet |
| 270° | Context: node facility → Reclaim (priority order), **or `more_horiz`** | neither applies |

There is no fifth slot. Five satellites across the 180°→270° quarter would need
22.5° spacing — 24px between centres for 30px buttons — so they would overlap.
Four at 30° is the maximum that fits. Overflow therefore collapses **into slot
270°**: when more than one current-space action applies, that slot becomes a
`more_horiz` button badged with the claimant count, and its sheet lists every
claimant including the facility.

Worst-case simultaneous actions is six (bag, cast, pet, facility, Reclaim on
soft ground, admin Move), hence the overflow. **Admin `Move` lives permanently in
the overflow sheet**, never in the main four — it is a dev affordance and should
not cost a player a thumb slot.

Rejected alternatives: a dynamic evenly-spread arc (icons shift between turns →
mis-taps) and a 3-slot arc with a "this space" submenu (adds a tap to the single
most common interaction, opening the facility you just landed on).

### Gesture claim

The board canvas owns pan/drag, but it already excludes `button` elements from
starting a pan (`board-canvas.ts:1421` — its `CONTROLS` selector). Satellites are
`<button>`s, so they need no extra attribute.

What does need care is the wrapper: it is `pointer-events: none` with
`pointer-events: auto` on its buttons, which keeps the board pannable *through*
the arc's gaps while the buttons stay tappable. The face ring's dismissal catcher
carries `data-uc-claim` so a tap on it only closes the ring rather than also
tapping the space underneath (`data-uc-panel` remains for scrollable panels).

## Decision handoff

New computed:

```
bandHasDecision() =
     canReroll()
  || !!pathfinderPick()
  || moveMode()
  || (occupantsHere().length > 0 && !you.pendingMove)
  || (stepping() && occupantsPassing().length > 0)
```

**Every term must mirror the guard on the band branch it would reveal.** The PvP
strip is itself gated on `!pendingMove`, so omitting that guard here makes the
band mount empty for the duration of every walk away from an occupied space —
routine controls hidden, PvP strip suppressed, nothing left but the status stack.

- Band renders when `skin() === 'band' || bandHasDecision()`.
- Routine `.action-row` branch renders only when `skin() === 'band'`.

On a routine turn under the dial skin there is no band at all. The instant a
real decision exists, the band slides up with its existing markup untouched.

**PvP is not a blocking decision.** The current code is explicit that Battle
stays available *alongside* Roll — a player must be able to roll away from
someone camping their space. Therefore the dial dims only for **exclusive**
decisions (Fleetfoot reroll, Pathfinder, move-mode) and stays fully live when
the band is up for PvP occupant rows.

Persistent status text is not a decision, so it never keeps the band alive.
Under the dial skin it re-homes explicitly:

| Today (band) | Under the dial |
| --- | --- |
| `nextRollLabel()` — "new rolls in 4m" | text label inside the dial, beneath the count |
| rested count | thin second outer arc + numeric badge on the dial |
| coach pill ("Tap Roll to take your first turn") | pill anchored directly above the dial |
| blink recharge note | pill anchored directly above the dial |

Because the dial owns that information, the band's own `.band-status-stack` is
suppressed under the dial skin. Otherwise the countdown and rested count would
render twice in the states where the band *is* up (a decision, or PvP).

## Toggle

A ~26px round icon button at the right end of the page header, beside the
purse/buff area, using the Material `dashboard_customize` icon (no emoji — the
game's symbol language is `uc-*` sprites and Material icons). One tap, reachable
from every tab, persisted to `localStorage`. Chosen over a Log-tab settings row (2 taps, too slow for
back-to-back comparison), a long-press on the dial (undiscoverable, and the
reverse gesture on the band is unclear), and a `?hud=dial` URL param (painful on
a phone, players cannot opt in).

Cost: ~26px of permanent header chrome.

## Verification

- `npm run build` green. (There is no frontend test runner — Karma specs were
  removed; see `CLAUDE.md`.)
- Python suite untouched and not run: zero server-side change.
- Manual pass at phone width, flipping the toggle, covering: default Roll,
  out-of-rolls, full-bag block, Blink ready, Blink recharging, dev Pick,
  rolling/moving, Fleetfoot reroll, Pathfinder, move-mode, a PvP occupant, an
  empty bag, no-spells, each facility type, Reclaim stacked on a facility
  (overflow), and drag-from-dial (must not pan the board).

## Open items

None blocking. The live battle and boss trial need no dial work: the
`interactive-battle` overlay already covers the whole tab, so the dial is simply
occluded like the band is today.
