# Undercity — Persona-style Action Fan (design)

*2026-08-11 · experimental board UI · client-only*

## Goal

Replace the board tab's fixed bottom action band with actions that **fan off the creature they belong to**, in the
style of Persona 5's battle command list: tapered wedges radiating from the token, spikes converging on it.

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

**Wedges.** The primary action (Roll/Blink) takes the top spoke of the leading wing in accent green; the rest are dark
wedges with a green rim. Every one is a real labelled button — icon *and* word — including the facility and Reclaim actions, which
are icon-only in the band today. Discoverability is the point; four-letter abbreviations would defeat it.

**Geometry: radial, not stacked.** Persona's commands are not a stack of skewed rectangles — they're **tapered wedges
radiating from a single point**, each tilted along its own spoke, all narrowing to a spike that converges on the
character. That convergence is the whole effect, and a vertically-stacked list can't produce it: stacked tips form a
vertical line rather than meeting anywhere.

Each chip is absolutely positioned relative to the fan's origin: out to the side by the radius, then stepped vertically
by a fixed pixel amount. Text tilts with its chip, as in the reference.

**Spacing is vertical and in pixels, not angular.** This is the load-bearing decision. A radial fan cannot work at this
scale: with the spikes hard against the disc rim there aren't enough pixels for an angle to separate fixed-height chips,
so the only way to stop them colliding was to fling the whole fan far away from the creature — which then looked
detached. Stepping by a fixed vertical distance (`V_STEP`, which must exceed a chip's height) separates neighbours at
*any* radius and at *any* zoom, which is what lets the chips sit right against the base where they belong.

**The origin is the centre of the disc the creature stands on** — not the sprite's midriff — so the fan belongs to the
space. Chips are drawn **facing the camera**; only their **shadows** are flattened onto the floor by `PROJECTION`, which
is what keeps them looking like objects above a board rather than decals on it.

**Each chip is rotated to the angle from its own spike back to the centre of the space** (`atan2(y, FAN_RADIUS)`), and
its `transform-origin` sits on that spike so the rotation swings the *body* while the tip stays pinned where it was
placed. Rotating about the chip's centre instead drags the tip off its aim.

This is the crux of the layout, and the failure mode is specific: rotate a chip to anything else — its stack position, or
a flat cosmetic tilt — and its spike aims past the disc. Because the sprite stands directly above the disc, "past the
disc" reads unmistakably as *the menu is pointing at my creature*, which is the opposite of the intent. The far wing
negates the angle; without that flip the chip is rotated a half-turn and its text reads upside down.

`FAN_RADIUS` is **exported and used as the positioner's floor** for the real radius. The tilt is derived from it, so if
the two disagreed the spikes would stop aiming at the space.

`PROJECTION = DISC_RY / NODE_R` is **derived from the board's own disc constants** rather than eyeballed, so retuning the
board's projection carries the fan with it.

Two rejected approaches, both instructive:

- **Squashing the chips too** (one `scaleY` wrapping the spokes) is geometrically truer — one transform gives you the
  ellipse *and* the shear for free. But it lays the type face-up on the floor, where it's hard to read. Placement wants
  the ground plane; text wants the camera.
- **`perspective()` / `rotateX`** is wrong for this board. The projection is **orthographic**: a space's ellipse has the
  same `ry/rx` wherever it sits on screen, with no vanishing point. Real 3D perspective would make the fan disagree with
  the tile under it, and it blurs text. An affine offset is the correct match and cheaper.

Because the chips stand up, `--gy` carries the projection pre-multiplied and nothing else in the fan is squashed —
which keeps the two coordinate systems from leaking into each other.

This is why `TokenAnchor` carries `groundY` / `groundR` alongside the token centre: chrome that belongs on the ground
plane needs the disc, and chrome that points *at* the creature (the off-screen indicator) still needs the body.

Two numbers matter more than they look:

- **Spike radius** is `max(34px, 1.45 × disc radius)` — scaled off the disc so it tracks zoom, and far enough out to
  clear the selection ring. An early pass used a fraction of *sprite height* at 0.42× and the wedges landed on top of
  the creature and its name label, burying the one thing the screen is about.
- **Arc bias** swings the fan clear of the sprite. The origin is now the creature's feet, so an unbiased spoke runs
  straight through the body standing on it.

**Zoom.** The radius is `max(FAN_RADIUS, disc radius + 14)` — tight against the base, clear of the selection ring, and
growing with the disc when you zoom in so the sprite never swallows the chips. It does *not* need to grow to prevent
overlap: that job belongs entirely to the fixed vertical step, which is why the fan can stay close.

**Two wings, not one.** Wedges split across *both* sides of the token, as Persona's own command list does. This isn't
only fidelity: piling everything into one wing makes the wedges overlap near the convergence point, which is exactly
where they're closest together. Three actions on one side was visibly too many.

**A wedge's side is declared, never derived.** `FanItem.wing` fixes it (0 = leading, 1 = far), assigned by meaning where
the actions are built: your own verbs (Roll/Blink, Cast) lead, and the situational ones — this space's facility, Reclaim,
the admin tools — take the far side. Every two-choice prompt uses one shape, accept on the leading wing and decline on
the far one; the six Blink faces split 1-2-3 / 4-5-6.

This replaced two earlier mechanisms that both **moved buttons between sides**, and it's the most important rule here:

- Wings were balanced by *label width*, so adding or removing an unrelated action could shuffle a button across the
  creature between turns.
- The fan as a whole mirrored to stay inside the viewport, so panning near an edge threw every wedge to the other side.

Both traded muscle memory for tidier packing. Muscle memory wins: a fan that clips a screen edge is a smaller cost than
a Roll button that isn't where the thumb expects it. Only a **rival's** fan mirrors now, purely to lean away from your
creature — and its wedges all stay on one wing, since a far wing would send one back across the shared space into your
own fan.

`fanAngles` and `fanWings` are **exported and shared** with the positioner: it needs the same numbers to work out a fan's
vertical span, and if the two disagreed the arc-swing would misfire.

**Shape.** A spike at the inner end and a **zigzag torn edge** at the outer — two big teeth, because three small ones
just read as a straight edge at board scale. The silhouette lives in one `--shape` custom property shared by all three
clipped layers.

Each chip casts a **`.shadow`** layer — the layered-offset trick that gives Persona's panels their punch, doubling here as
the cue that the chip is raised off the floor. It's dropped by the same lift that raised the chip and squashed by
`PROJECTION`, so it lands on the ground plane beneath. Committed rather than hinted: a small offset read as a bevel
artifact rather than a deliberate second shape.

It's **translucent black**, not a colour: it picks up whatever terrain is under it instead of fighting the teal board,
and it can't compete with the plate for attention. Coloured versions — violet, with crimson on the primary — were tried
and dropped, because a shadow that changes colour per action stops reading as a shadow. Hierarchy comes from the plate,
text size and the glow instead. The chip's own `drop-shadow` filter stays light, since this layer does the depth work.

It carries the **same torn silhouette** as the plate. Giving it a plain wedge instead was tried and reverted: the doubled
teeth are the look, and the "noise" they create where the layers overlap is wanted, not a defect.

**Labels are heavy uppercase** with a shared minimum length (and a larger floor for the primary). Title case read as an
ordinary web button, and without a length floor a short label like CAST sits between two long wedges as a stub instead
of reading as one set. The floor drops away in `compact` mode, where there are no labels to keep honest.

Because `clip-path` clips its own descendants, the offset shadow cannot be a child of the clipped plate — it would be cut
away to nothing. So a chip is four sibling layers inside the button, painted in DOM order: **shadow, plate (rim), body
(dark inner), face (content)**.

Three consequences worth knowing, because each is easy to get wrong:

- `clip-path` slices a CSS border clean off, so the green rim is a **second clipped layer** behind the face rather
  than a `border`. `box-shadow` is clipped for the same reason, so the drop shadow is a `filter` instead.
- A wing on the far side is a **true reflection** (`scaleX(-1)` on the spoke), which mirrors the wedges so their spikes
  swap edges automatically; only the text needs flipping back. Hand-writing a separate mirrored clip path and a negated
  rotation is the fiddlier, bug-prone route. Leading-vs-far and mirrored-vs-not combine as an XOR, expressed as four
  ordered CSS rules setting a `--flip` factor.
- **No tether.** An earlier pass ran a hairline from the fan back to the token; once the spikes converge on the
  creature the line is redundant, and its length collapses to nearly zero anyway.

**Anchoring.** The fan follows the token's *animated* screen position, so it stays attached while the camera glides.

**Fitting: none, on purpose.** The fan does not adapt to the viewport. Sides are fixed by each item's `wing`, and there
is no clamping, no side-swap and no arc-swing — a fan near a screen edge simply clips. Same rule as the wing decision: a
control that rearranges itself costs more in muscle memory than it saves in packing. In practice the camera keeps your
token centred, and a fan panned fully off-screen hides anyway.

Earlier revisions did adapt — a side-swap when the arc wouldn't fit, then an arc-swing (`--uc-fan-bias`) rotating the
whole fan away from an edge. Both are gone, and the removal was a simplification rather than a loss: they were the only
consumers of the measured chip box, and **measuring forced synchronous layout on a 60fps path**. Dropping the adaptation
deleted the measure pass, its 3-frame re-measure window, the `effect` that armed it, and two `Map`s of cached geometry.
`placeFan` is now a handful of style writes that read nothing back.

**During movement.** The own fan **fades out while `rolling()` or stepping** and pops back on landing. A fan of wedges
chasing the token across the board makes the move itself hard to read. Passed-occupant High Five fans are the
exception — they appear *because* you're stepping, so they show during the walk.

**Crowding.** Two occupants on a space means two small fans. A third or more collapses the far ones to icon-only
wedges, so a busy space degrades rather than becoming an unreadable pile.

## Ownership model

| Fan anchor | Contents |
| --- | --- |
| Your creature | Roll/Blink, Cast, Facility, Reclaim, admin Move — and, when a prompt is live, the prompt |
| Another player's creature (same space) | name slab, Battle, High Five |
| Another player's creature (passed mid-walk) | name slab, High Five |

Other-player fans mirror so they lean *away* from your creature, which keeps the two clusters from colliding on a
shared space. The name wedge is an inverted (light-on-dark reversed) wedge on the spoke above the actions, carrying
`{username}'s {creatureName} (L{level})` — the same string the band shows now, and the shield icon when `o.shielded`
disables Battle.

## Prompts swap into the fan

A prompt does **not** spawn a second surface. The fan's contents swap: routine verbs slide out, a bright header wedge
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
- **Discrete state changes do touch signals** — fan visibility, indicator visibility
  and edge bearing — but each is written only on *change*, so they fire on the order of once per turn, not per frame.

### New components

- `tabs/action-fan.component.ts` — presentational. Inputs: an ordered `FanItem[]` (`{ id, label, icon, kind, disabled,
  run }`), an optional header, and a `compact` flag. Emits nothing but the item's own
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
- **Zoom.** The wedges are DOM at fixed px, so they do **not** scale with camera zoom — only the fan's origin moves
  and the spike radius, which tracks sprite height. Zoomed far out, wedges will look large relative to tiny tokens;
  accepted for v1.
- **Spectator mode** (`interactive: false`) never wires the fan.
- **Legibility over terrain.** Slabs need enough background opacity to beat mottled floor art without reading as a
  solid panel again — a tuning item, flagged for the live pass.

## Verification

- `npm run build` must stay green. (Lint is unreliable in this repo; the build is the gate.)
- No frontend test runner exists, and there are no server changes, so the backend pytest suite is untouched and should
  stay green as a regression check that nothing leaked server-side.
- **Live pass via the `run-undercity` skill** is the real verification, since the two open risks — arc room on a short screen and
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
