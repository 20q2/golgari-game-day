# Undercity — Persona-style Action Fan (design)

*2026-08-11 · experimental board UI · client-only*

## Goal

Replace the board tab's fixed bottom action band with actions that **fan off the creature they belong to**, in the
style of Persona 5's battle command list: skewed labelled slabs cascading diagonally from the token.

Three payoffs, in priority order:

1. **Ownership is spatial.** Your verbs hang off your creature; interaction verbs (Battle, High Five) hang off
   *the other player's* creature. Today High Five sits in a band strip with the target's name spelled out in text —
   the player has to read a list and match a name to a sprite. Moving the button onto the body it acts on makes both
   *when* it appears and *why* self-evident.
2. **Reclaimed vertical space.** The band is `min-height: 58px` plus `9px` padding, and grows to two or three rows
   whenever extras (roll picker, coach pill, hints) stack under the button row. On a phone that's a meaningful slice
   of a portrait board.
3. **Character.** The board is the game's signature screen; a plain button bar undersells it.

This is an **experiment behind a toggle**, not a one-way removal. The band and the fan are both live; a preference
picks between them, so the fan can be judged against the real board with real art and reverted with one tap.

Server-side: **no changes at all.** Every action contract, every guard, every `store.action(...)` call is untouched.
This is a presentation-layer swap.

## What the band holds today

Full inventory from [board-tab.component.html:98-348](../src/app/undercity/tabs/board-tab.component.html#L98-L348), because
the fan has to account for all of it.

**Routine verbs (idle turn):**

| Action | Condition | Current form |
| --- | --- | --- |
| Roll (N) | default | primary button, die icon |
| Blink (N) | `blinkAllowed()` | replaces Roll; opens the face picker |
| Cast | `castableSpells().length \|\| castableScrolls().length` | secondary button |
| Move | `isAdmin()` | secondary button, enters move-mode |
| Reclaim | `canReclaim()` | icon-only round button |
| Facility | by `nodeType()` — `shop`→Bazaar, `ossuary`→The Casino, `witch`→The Witch, `trading_post`→Trading Post, `excavation`→Dig Site, `crystal_vein`→Crystal Vein, `vault_lock`→Guildvault | icon-only round button |

All of the above are gated on `busy()`, `rolling()`, and `!store.you()?.pendingMove`.

**Extras that stack onto extra rows:** the Blink face picker (faces 1–6 + random), the `Pick` button and its picker
(`pickAllowed()`), the "Blink ready — choose your face" note, the "Blink recharges" note, and the first-run coach pill.

**Morph states that take over the band:**

- **PvP strip** (`occupantsHere()`, not pending-move): per occupant — name line, **Battle** (disabled when
  `o.shielded`, with a shield icon), **High Five**.
- **Passing strip** (`stepping() && occupantsPassing()`): per occupant — name line, **High Five** only. Battle is
  landing-only.
- **Fleetfoot reroll** (`pendingMove && canReroll()`): message + **Reroll** / **Keep the 1**.
- **Pathfinder pick** (`pathfinderPick()`): message + a **Move N** button per die.
- **Move mode** (`moveMode()`): instruction + **Move here** / **Cancel**.

**Passive status** (band top-left stack): `new rolls in {nextRollLabel()}`, and `{restedRolls()} rested` with a
`bedtime` icon and its explanatory tooltip.

**Already floating on the canvas and unchanged by this work:** pet quick-use box, focus picker, board toast, event
feed, bag FAB, biome chip.

## The fan

**Geometry.** Slabs cascade **down and away** from the token: each successive slab steps further from the creature
along the diagonal. Skew is `-11deg` with the text counter-skewed so labels stay upright and readable. The primary
action (Roll/Blink) is the slab nearest the creature, in the accent green; the rest are dark slabs with a green rim.
Every slab is a real labelled button — icon *and* word — including the facility and Reclaim actions, which are
icon-only today. Discoverability is the point; four-letter abbreviations would defeat it.

**Anchoring.** The fan follows the token's *animated* screen position, so it stays attached while the camera glides.

**Flipping.** The fan picks its quadrant from available room:

- Not enough horizontal room on the default side → mirror across the token (skew inverts, cascade runs the other way).
- Not enough vertical room below → cascade upward instead.

Both are computed from the emitted viewport size, so a short phone with a centered token doesn't push slabs under the
tab bar. This is the single most likely thing to need tuning once it's on a real device.

**During movement.** The own fan **fades out while `rolling()` or stepping** and pops back on landing. Four slabs
chasing the token across the board makes the move itself hard to read. Passed-occupant High Five fans are the
exception — they appear *because* you're stepping, so they show during the walk.

**Crowding.** Two occupants on a space means two small fans. A third or more collapses the far ones to icon-only
slabs, so a busy space degrades rather than becoming an unreadable pile.

## Ownership model

| Fan anchor | Contents |
| --- | --- |
| Your creature | Roll/Blink, Cast, Facility, Reclaim, admin Move — and, when a prompt is live, the prompt |
| Another player's creature (same space) | name slab, Battle, High Five |
| Another player's creature (passed mid-walk) | name slab, High Five |

Other-player fans mirror so they lean *away* from your creature, which keeps the two clusters from colliding on a
shared space. The name slab is an inverted (light-on-dark reversed) slab above the fan, carrying
`{username}'s {creatureName} (L{level})` — the same string the band shows now, and the shield icon when `o.shielded`
disables Battle.

## Prompts swap into the fan

A prompt does **not** spawn a second surface. The fan's contents swap: routine verbs slide out, a bright header slab
plus the prompt's choices slide in, at the same anchor with the same geometry. Fleetfoot, Pathfinder, and move-mode
all use this shape. Precedence matches the current template's `@if` chain exactly, so behaviour can't drift:

1. Fleetfoot reroll (`pendingMove && canReroll()`)
2. Pathfinder pick
3. Move mode
4. Routine verbs

**Passive status never joins the fan.** `new rolls in …`, `rested`, and the Blink notes become corner chips styled
like the existing biome chip. The coach pill stays a pill but repositions near the fan so "tap Roll" points at
something visible.

## Off-screen indicator

Pan the camera away from your creature and the fan has nothing to hang on. It hides — no floating detached actions —
and a Smash-Bros-style indicator takes over.

- A **circular badge carrying your form sprite** via the board tab's existing `youSpriteUrl()`, which already returns
  your recolored-and-hatted sprite (the same art the focus picker lists), so it reads as *you* — your paint, your hat —
  when several creatures are loose.
- Pinned to the screen edge **at the true bearing** to your creature: it slides along whichever edge the line to the
  token crosses. Diagonal bearings clamp into the corner with the arrow chip rotated to the real angle, so the
  indicator never lies about direction.
- An **arrow chip on the outer rim**, pointing out of frame.
- A slow pulse, so it reads as live rather than as static furniture.
- Positioned clear of the biome chip, bag FAB, and tab bar — the badge yields to existing furniture.
- Appears only once the token has **fully** left the viewport, with a dead-zone so it can't flicker while the camera is
  nudged at the boundary. Tapping it runs the existing `focusSelf()` camera glide.

No distance readout in v1 — considered and dropped as noise.

## Architecture

### Anchor feed (`engine/board-canvas.ts`)

The canvas already computes every visible token's world position per frame into `placed`
([board-canvas.ts:1658](../src/app/undercity/engine/board-canvas.ts#L1658)), and the camera transform is a plain
`screen = (world - cam) * zoom` off `camX`/`camY`/`zoom`. Add a callback in the existing `setOnEnterDungeon` style:

```ts
export interface TokenAnchor {
  userId: string;
  x: number;      // CSS-logical px, relative to the canvas element
  y: number;      // the token's head/anchor point, not its foot
  onScreen: boolean;
}
export interface AnchorFrame {
  viewW: number;
  viewH: number;
  own: TokenAnchor | null;   // null when your token isn't on the active layer
  others: TokenAnchor[];     // other players on the active layer
}
setOnAnchors(cb: (f: AnchorFrame) => void): void
```

Emitted once per rendered frame from the draw loop, after `placed` is built. `onScreen` is a viewport test in logical
units. Off-screen tokens are still reported with their (out-of-bounds) coordinates — the indicator needs the bearing.

### Positioning without 60Hz change detection

**This is the main technical risk.** Writing an Angular signal every frame would trigger change detection ~60×/sec
against a very large board-tab template. So the two concerns are split:

- **Contents are reactive.** Which slabs exist, their labels, and their disabled states come from the existing
  computed signals and re-render only when those change — which is rarely.
- **Position is imperative.** The anchor callback writes `style.transform = translate3d(x, y, 0)` directly on each fan
  container via `ElementRef`, outside Angular's zone. No signal write, no CD tick.
- **Discrete state changes do touch signals** — mirror side, cascade direction, fan visibility, indicator visibility
  and edge bearing — but each is written only on *change*, so they fire on the order of once per turn, not per frame.

### New components

- `tabs/action-fan.component.ts` — presentational. Inputs: an ordered `FanItem[]` (`{ id, label, icon, kind, disabled,
  run }`), a mirror flag, a cascade-direction flag, and an optional header slab. Emits nothing but the item's own
  handler. Holds no game logic; the board tab builds the item list.
- `tabs/offscreen-indicator.component.ts` — presentational. Inputs: sprite URL, edge, bearing angle. Output: tap.

Both are standalone with explicit `imports:` arrays, SCSS-in-component, and reuse the palette and breakpoint tokens
from [STYLE_GUIDE.md](../STYLE_GUIDE.md) — no new colors.

Keeping the fan presentational matters: [board-tab.component.ts](../src/app/undercity/tabs/board-tab.component.ts) is
already ~3.6k lines. This work adds item-list builders and anchor wiring to it, and removes the band markup from its
template; it must not add a second copy of the action logic.

### Toggle

A `localStorage`-backed preference (`uc-action-fan`), following the existing `COACH_KEY` pattern in the board tab, with
a small icon toggle in the board's existing overlay control cluster. Default **on**, so the fan is what you actually
experience, with the band one tap away for comparison. When the band is selected, the fan and indicator don't render
and `app-uc-action-band` returns exactly as it is today — including keeping `action-band.component.ts` untouched, since
the creature and plaza tabs still use it.

## Edge cases

- **Own token not on the active layer** (you're in a dungeon pocket, camera on the overworld): no fan, no indicator.
- **`busy()`** (an action in flight): slabs stay rendered but disabled, matching the band's current behaviour so the fan
  doesn't collapse and re-expand mid-turn. This is distinct from `rolling()`/stepping above, where the whole own fan
  fades out — a dice animation or a walk is a moment where the fan would obscure the thing you're watching, whereas
  `busy()` is a network wait during which the fan should hold its shape.
- **Zoom.** The fan is DOM at fixed px, so it does **not** scale with camera zoom — only its anchor moves. Zoomed far
  out, slabs will look large relative to tiny tokens; accepted for v1.
- **Spectator mode** (`interactive: false`) never wires the fan.
- **Legibility over terrain.** Slabs need enough background opacity to beat mottled floor art without reading as a
  solid panel again — a tuning item, flagged for the live pass.

## Verification

- `npm run build` must stay green. (Lint is unreliable in this repo; the build is the gate.)
- No frontend test runner exists, and there are no server changes, so the backend pytest suite is untouched and should
  stay green as a regression check that nothing leaked server-side.
- **Live pass via the `run-undercity` skill** is the real verification, since the two open risks — vertical room and
  legibility over real terrain — are only judgeable on the actual board. Checklist: idle fan; a facility space; a
  shared space with another creature; a Fleetfoot 1; a walk past an occupant; camera panned away in each of the four
  directions plus a corner; and the toggle flipped back to the band.

## Out of scope

- Any change to the creature or plaza tabs' action bands.
- Any server, balance, or action-contract change.
- Re-skinning the pet quick-use box, bag FAB, focus picker, or event feed.
- A distance readout on the off-screen indicator.
- Reusing the indicator to point at anything other than your own creature (the Umori, an enraged monster) — plausible
  later, not now.
