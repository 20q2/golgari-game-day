# The Undercity — Tunnel Signposts & Destination Dialogue

**Status:** design · 2026-07-29 (approved for planning)

Two additions that tell the player what lies across a tunnel:

1. **Planted signposts** beside each tunnel space on the game board, previewing the destination region's backdrop + name.
2. **The Nyx Weaver toll dialogue** names the destination and its signature draw ("Beyond the silk lies Mosslight Cavern — mine gems from its crystal veins"), and shows the destination's backdrop.

Both reuse data that already exists (the hatch-screen region flavor) and the per-region WebP backdrops. Client-only display — no server, no map-data, no new art.

## 1. Background (current state)

- `tunnel` is a node type: a shortcut between two biomes. Landing on one opens the **Nyx Weaver** toll modal (`bridgePrompt` in `board-tab.component.ts`), tier-gated (T1 free / T2 pays 50 / T3 can't). Its backdrop wash is currently a fixed `undercity/silk_roads.png` (`bridgeWashBg()`).
- There are exactly **10 tunnels**, in linked pairs, each tagged to one side (`t_cavern_bog0` sits in `cavern`, `t_cavern_bog1` in `bog`). Each tunnel's `neighbors` span its own region + one other; the **destination** is the neighbor region that differs from the tunnel's own `region`. Tunnels connect the 5 surface biomes in a ring: cavern↔bog↔garden↔city↔bone↔cavern.
- `hatch-flow.component.ts` already holds a `biomes` array (lines ~219–245) for exactly those 5 biomes, each with: `id`, `name` (e.g. "Mosslight Cavern"), `bg` (the WebP backdrop), `tint`, `perk`, `blurb`, `lore`, and `feature: { name, desc }` — where `feature.desc` is the "what you can do there" line (cavern → "Mine glittering gems straight from the cavern walls", bone → "Dig through buried plots…", etc.).
- The game board (`board-canvas.ts`) loads a `floorTex` image per region from `map.regions[].background`, so the destination backdrop image is already in memory. Its `draw(ts)` frame method (line ~1180) renders terrain + decals + y-sorted discs/tokens live over the baked terrain.

## 2. Shared region data — `src/app/undercity/data/regions.ts` (new)

Move the hatch `biomes` array into a shared, exported table so both hatch and the new board/modal features read one source.

```ts
export interface RegionInfo {
  id: string;
  name: string;
  bg: string;                              // 'undercity/<x>_background.webp'
  tint: string;
  perk: string;                            // hatch home-biome perk name
  blurb: string;                           // hatch perk one-liner
  lore: string;
  feature: { name: string; desc: string }; // the signature activity
}

export const REGIONS: Record<string, RegionInfo> = { /* city, cavern, bog, bone, garden — verbatim from the current hatch biomes array */ };

export const REGION_LIST: RegionInfo[] = Object.values(REGIONS);

export function regionInfo(id: string | undefined): RegionInfo | undefined {
  return REGIONS[id ?? ''];
}
```

- **`hatch-flow.component.ts`**: delete the inline `biomes` array; set `protected readonly biomes = REGION_LIST;` (order preserved: city, cavern, bog, bone, garden). Everything hatch reads (`name/bg/tint/perk/blurb/lore/feature`) is unchanged — pure extraction, no behavior change.
- Only these 5 biomes are defined; that's the complete set tunnels touch. `regionInfo()` returns `undefined` for regions without flavor (isle/ruin/depths/wilderness) — callers guard and skip.

## 3. Destination resolver (shared, pure)

A tunnel's destination is the neighbor region that isn't its own side.

```ts
// in regions.ts (imports the map node shape) or a board util:
export function tunnelDest(
  nodes: { id: string; region?: string; neighbors: string[] }[],
  node: { region?: string; neighbors: string[] },
): string | null {
  const byId = new Map(nodes.map((n) => [n.id, n]));
  for (const nb of node.neighbors) {
    const r = byId.get(nb)?.region;
    if (r && r !== node.region) return r;
  }
  return null;
}
```

Deterministic per tunnel; the paired far-side node resolves the opposite way, so each side of a border gets its own signpost. Used by both the board render and the modal.

## 4. Planted signposts — `board-canvas.ts` (game board only)

Add a `drawSignposts()` pass called from `draw(ts)` **only when `activeLayerId === OVERWORLD`** (tunnels are surface), after terrain/decals and before/among the y-sorted discs so it sits on the ground plane. The map editor's separate canvas is untouched, so editing stays uncluttered.

For each `tunnel` node visible on the overworld:
1. `dest = tunnelDest(this.map.nodes, node)`; `info = regionInfo(dest)`; skip if either is null.
2. Direction: unit vector from the tunnel node toward the centroid of its destination-region neighbors → offset the signpost that way (so it "points" where it leads). Falled back to straight up if degenerate.
3. Draw (world coords, so it scales with zoom):
   - a short **post** (a thin rounded rect / line from the ground to the panel),
   - a **framed panel**: a rounded-rect card with a 2px border, containing a **cropped thumbnail** of `floorTex[dest]` (cover-fit into the panel's image area, clipped to the rounded rect), and below it a **name plaque** with `info.name` (dark strip + light text, `ctx.fillText`).
   - subtle drop shadow so it reads above the terrain.
   - Panel sized in world units (~90×70) and kept a constant minimum on-screen size by clamping against `zoom` where sensible, matching how tier badges counter-scale; at whole-map zoom it stays small, not covering neighbors.
4. If `floorTex[dest]` isn't loaded yet, draw the frame + plaque without the image (the image pops in once loaded — same tolerance the terrain floors already have).

No new assets: post/frame/plaque are drawn procedurally; the thumbnail is the existing region backdrop.

## 5. Nyx Weaver destination dialogue — `board-tab.component.ts` + `.html`

- Add a computed `bridgeDest()` that resolves the current `bridgePrompt()` tunnel node → `{ name, bg, feature }` via `tunnelDest` + `regionInfo` (null if unresolved).
- **`bridgeWashBg()`**: when `bridgeDest()` is present, use its backdrop instead of `silk_roads.png`, keeping the existing dark gradient on top for legibility:
  ```
  linear-gradient(rgba(16,14,11,0.58), rgba(16,14,11,0.90)), url('<dest.bg>')
  ```
  Fall back to the current `silk_roads.png` wash if `bridgeDest()` is null.
- **Modal template**: below the existing tier/toll paragraph, add a destination line shown when `bridgeDest()` exists:
  > Beyond the silk lies **{{ dest.name }}** — {{ dest.feature.desc }}
  
  (rendered in the existing `modal-sub`/hint style). Purely additive; the tier logic, buttons (`turnBackBridge` / `payBridge`), and toll behavior are unchanged.

## 6. Data flow & isolation

- `regions.ts` owns region flavor (data) + `tunnelDest` (pure graph helper). No dependencies beyond the node shape.
- `hatch-flow` consumes `REGION_LIST` (display only).
- `board-canvas` consumes `REGIONS` + `tunnelDest` + its existing `floorTex` to render signposts.
- `board-tab` consumes `regionInfo` + `tunnelDest` for the modal.
- Nothing crosses to the server; the destination is derived from the map graph the client already holds.

## 7. Testing / verification

No client test runner (per project setup), so:
- `npm run build` (from repo root) must succeed.
- Headless screenshot checks: (a) a tunnel on the overworld shows a signpost with the correct destination name + backdrop thumbnail, angled toward the destination side; (b) opening a tunnel's Nyx Weaver modal shows the destination backdrop wash and the "Beyond the silk lies …" line with the right region + feature text; (c) the hatch screen still renders its 5 biome cards unchanged (extraction regression check).

## 8. Out of scope
- Signposts on ladders (dungeon-pocket crossings), the isle causeway, or warps — tunnels only.
- Any new art, map-graph edits, or server changes.
- Region flavor for isle/ruin/depths/wilderness (no tunnels touch them; `regionInfo` returns undefined and callers skip).
