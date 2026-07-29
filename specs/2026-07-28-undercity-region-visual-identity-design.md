# The Undercity — per-region visual identity (board terrain)

**Status:** implemented · build green · on-board live-check pending · 2026-07-28
**Origin:** host feedback — the Sedgemoor's plank *boardwalk* paths and the lantern-post
inter-chamber crossings give that biome a distinct structural identity underfoot; every
other biome falls back to the same studded ribbon, and *every* region-to-region crossing is
the same lantern deck. Goal: give each of the eight overworld biomes its own **path motif**,
its own **border crossing**, and a couple of signature **set-pieces** — in the same spirit.
Design was validated as a canvas mockup gallery (Artifact "Undercity Region Identities") drawn
off the real `REGION_THEMES` palette; host approved a full pass across all eight regions.

All of this lives client-side in `src/app/undercity/engine/board-terrain.ts` (the static
Dokapon-style prerender). No backend, no data mirror, no map.json change. The dev-only map
editor renders through the same `renderTerrain()`, so it picks the changes up for free.

## 1. Principle

Each biome reads as its own place from the ground up. Three layers per region:

1. **Path motif** — the decoration drawn over the base path ribbon on *intra-region* edges
   (the shared shadow/rim/edge/fill ribbon stays; only the top layer changes). Today this is
   round studs everywhere except `bog` (boardwalk planks).
2. **Crossing** — the set-piece on *region-to-region* edges (currently one `drawCrossing`).
3. **Ambience** — biome-specific scatter set-pieces placed in the decoration pass (§6 today).

## 2. Structural change A — per-region path-motif dispatch

In the path-ribbon pass (`renderTerrain` step 7), the base ribbon layers
(`ribbon(36,shadow)…ribbon(23,fill)`) are unchanged. Replace the trailing
`if (bog) { planks } else { studs }` block with a dispatch:

```
const motif = PATH_MOTIFS[keyA] ?? drawStuds;   // keyA === keyB on intra-region edges
motif(ctx, sampleCurve(c, motif.step ?? 48), style, c);
```

`PATH_MOTIFS: Record<string, PathMotifFn>` keyed by overworld region (`city`, `cavern`,
`bog`, `garden`, `bone`, `ruin`, `wilderness`, `isle`). Each fn receives the sampled centre
polyline, the region's `path` style, and the curve, and draws its decoration. `drawStuds`
(the current default) is the fallback for `depths` and all `dungeon:*` pockets — those keep
their existing look this pass (see §7 non-goals). A shared `perp(pts, i)` helper gives the
unit normal for cross-ticks.

### Path motifs (one per biome)

| Region | Motif |
| --- | --- |
| `bog` (reference) | Boardwalk plank ticks (existing) **+ new** rope-and-post handrails: short posts every ~6th sample each side, a sagging rope quad between consecutive posts. |
| `city` | Paved avenue — flagstone pavers (small rotated rects, alternating two greys) tiled along the run + a thin lit gutter-line inset from each edge. |
| `cavern` | Living trail — a dashed bioluminescent moss-fringe just inside each edge + scattered glowing spore dots + one soft teal glow at mid-path. |
| `garden` | Tilled lane — parallel furrow lines *along* the path (dark/dark/lit) + short wattle sticks along the edges. |
| `bone` | Spine road — a run of pale vertebrae discs down the centre with rib-arches straddling the path at intervals. |
| `ruin` | Cracked processional — dashed faded-gold inlay stripe + a jagged centre crack + one "missing slab" dark gap with a plank laid over it. |
| `wilderness` | Ember road — dark charcoal ribbon veined with a glowing ember-orange centre crack + offshoots + coal glow. (Base ribbon already charcoal/ember via theme.) |
| `isle` | Obsidian glass — no studs; a couple of bright violet reflection streaks + faint violet rim lines. |

## 3. Structural change B — biome-aware crossings

`drawCrossing(ctx, c, glowSpots)` becomes a dispatcher. **Selection rule:** the crossing uses
the style of the endpoint region with the higher **depth rank** —
`cavern(0) < bog(1) < garden(2) < city(3) < bone(4) < ruin(5) < wilderness(6) < isle(7)`.
Ties (same region — shouldn't happen on a cross edge) and unknown keys fall back to the
current lantern deck. A `CROSSING_STYLES: Record<string, CrossingFn>` supplies each style;
the dispatcher picks `styles[higherRank(a.region, b.region)]`.

### Crossings (one per biome)

| Region | Crossing |
| --- | --- |
| `bog` | Lantern-post deck — the current `drawCrossing` art (kerb + pale deck + two amber lantern posts). This becomes the `bog` style. |
| `city` | Buttressed stone bridge — arched dark underside beneath the deck + emerald wall-sconce posts. |
| `cavern` | Mushroom-cap stepping stones — a row of flat glowing caps with a stalk dot and teal glow. |
| `garden` | Vine arbor — two posts + a drooping creeper swag with two hanging glowing gourds; earthen deck under. |
| `bone` | Skull-post & bone chain — two skull-topped posts strung with a sagging chain of bone beads; pale deck. |
| `ruin` | Toppled colonnade — fallen column drums laid across the gap (rotated capsules with gold-rune dashes) + flanking stumps. |
| `wilderness` | Jury-rigged bridge — two anchor posts, sagging rope handline + hanging planks, faint ember glow. |
| `isle` | Ritual approach — black deck lined with violet-flame brazier posts. |

Note: `isle` is the highest rank, so any border touching the boss island shows the ritual
approach. `cavern` is lowest, so its mushroom-stone crossing only shows on cavern↔cavern-tier
borders; acceptable (cavern is the known hub). We verify actual coverage live and can re-rank.

## 4. Ambience set-pieces

Extend the region branches of the scatter pass (§6, `nearKey === …`). New draw fns, most
registered in `STAMPS` where they should sway/compose with the editor; static stone ones can
stay direct. Soft/organic ones join `SOFT_FLORA` for the idle sway.

| Region | New/added set-pieces |
| --- | --- |
| `city` | Lancet window-arch (tall pointed arch, glowing emerald interior). |
| `cavern` | Crystal arch (two clusters leaning, glowing seam) alongside existing mushrooms/crystals. |
| `bog` | Wisp-buoys — small floating lights in the existing pools; keep reeds/bog-trees. |
| `garden` | Planting terraces (stepped ledges with sprouts) + a gourd. |
| `bone` | Leaning grave-stele + ash drift, with existing skull piles / bone mounds. |
| `ruin` | Headless statue torso + a glowing gold rune floor-tablet, with existing pillars. |
| `wilderness` | Charred snag tree + a bubbling tar pit + drifting embers. |
| `isle` | Bone-flag standard + obsidian shards. (Isle currently suppresses scatter — allow a small curated set on isle plateaus.) |

## 5. Files

- `src/app/undercity/engine/board-terrain.ts` — all of the above (path motifs, crossing
  dispatch, new draw fns, scatter-branch edits, `STAMPS`/`SOFT_FLORA` additions).
- No other files. (Pure client render; no server, no data mirror, no map.json edit.)

## 6. Verification

- `npm run build` green (lint is known-broken per repo quirks; verify via build).
- Live check with the run-undercity flow: load the board, pan each biome, confirm each path
  motif, each crossing (spot-check several borders incl. an isle border and a cavern-tier
  border), and each ambience set-piece render without artifacts and stay clear of discs/river.
- Deterministic seeding preserved (no `Math.random`/`Date.now` in the render path) so the
  board is stable across reloads.
- Host runs the deploy; this ships with the next site build.

## 7. Scope / non-goals

- **Overworld biomes only.** `depths` and `dungeon:*` pockets keep the default stud path and
  their existing scatter this pass — revisit later if wanted.
- **No new colors** — every motif derives from the region's existing `REGION_THEMES` entry;
  accent glows reuse each biome's established glow hue.
- **Crossing blend** (A→B handoff mid-span) is deferred; v1 uses the single depth-rank style.
- Balance, rules, map graph, sprites: untouched.

## 8. Revision — bold/glow pass (post-live-review)

First live look showed the fine linework washing out: terrain bakes at `TERRAIN_RES`
0.6 then upscales, and the board is viewed zoomed out (default 0.8, whole-map fit ~0.15),
so hairline detail dies. Only the two boldest treatments read — the bog's thick planks
and the wilds' *glowing* ember crack. Lesson: **a motif must be as chunky as the boardwalk
or carried by the glow layer** (glow draws crisp on top at full res, `drawGlows`). The six
weak path motifs were reworked accordingly:

- **cavern** hairline fringe → bright spore-caps + teal glow halos strung down the trail.
- **city** thin pavers/gutters → chunky high-contrast checkered flagstones + emerald lamp glows.
- **garden** thin furrows/wattle → bold alternating soil rows (boardwalk-thick) + green seed-pod glows.
- **bone** thin ribs/small beads → thick rib-arches + big bone-white vertebrae beads (no glow; dead).
- **ruin** hairline crack/dashed inlay → chunky cracked flagstones w/ dark gaps + bold gold stripe + gold glints.
- **isle** thin reflection lines → bold specular streaks + violet glow chain.

`bog` and `wilderness` kept as the reference models. Crossings + ambience set-pieces left
as-is this pass (they read acceptably at zoom); revisit if wanted.

## 9. Revision — crisp per-frame path layer

Even bold baked motifs are softened by the 0.6x terrain bake. To close the sharpness gap
(the demo looked crisp because it rendered full-res), the path decoration was lifted OUT of
the baked terrain onto the crisp per-frame layer where glows/flora already draw — mirroring
the flora un-bake exactly:

- `renderTerrain(..., { animatePaths: true })` (both BoardCanvas call sites) now, instead of
  baking each motif, harvests the motif's glow once into `TerrainArt.glowSpots` (strokes to a
  throwaway ctx) and stashes `{ key, curve, style }` into `TerrainArt.pathMotifs`.
- `BoardCanvas.draw()` calls the new exported `drawPathMotifs(ctx, pathMotifs, view)` right
  after the terrain blit — full res, under the camera transform, **culled to the viewport**
  (bbox test) so per-frame cost stays bounded on phones (the reason terrain is baked at all).
- The base ribbon (shadow/rim/edge/fill) stays baked; only the fine top detail is per-frame.
- The **map editor** does not pass `animatePaths`, so it still bakes motifs in place (it
  renders full-res anyway) — `pathMotifs` is `[]` there.

Caveat: this fixes *sharpness*, not *scale* — at whole-map zoom the detail is still small
because the player is far out (the demo was zoomed in ~5–10x). Bold/glow + crispness together
are as close to the demo as the play view structurally allows.
