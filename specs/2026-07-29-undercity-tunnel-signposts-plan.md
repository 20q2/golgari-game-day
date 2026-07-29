# Tunnel Signposts & Destination Dialogue — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Show players what lies across a tunnel — a planted signpost on the board previewing the destination region's backdrop + name, and a Nyx Weaver toll dialogue that names the destination and its signature draw.

**Architecture:** Extract the existing per-region flavor (name/backdrop/feature) from `hatch-flow` into a shared `regions.ts` with a pure `tunnelDest()` resolver, then reuse both for signposts drawn in the game board's frame loop and for the tunnel-crossing modal. Client-only display — no server, map-data, or new art.

**Tech Stack:** Angular 20 standalone components, HTML5 canvas 2D. No client test runner — tasks are build-verified (`npm run build`) + headless-Chrome screenshots.

**Spec:** [specs/2026-07-29-undercity-tunnel-signposts-design.md](2026-07-29-undercity-tunnel-signposts-design.md)

> **Commit note:** the user keeps parallel WIP and manages their own commits. The `git commit` steps below are the plan's default; during inline execution, make edits + get a clean build, and leave committing to the user.

---

## File Structure
- **Create** `src/app/undercity/data/regions.ts` — `RegionInfo` type, `REGIONS` map (5 surface biomes, extracted verbatim from hatch), `REGION_LIST`, `regionInfo()`, and the pure `tunnelDest()` graph helper.
- **Modify** `src/app/undercity/hatch/hatch-flow.component.ts` — replace the inline `biomes` array with `REGION_LIST` (pure extraction).
- **Modify** `src/app/undercity/engine/board-canvas.ts` — draw planted signposts for overworld tunnel nodes.
- **Modify** `src/app/undercity/tabs/board-tab.component.ts` + `.html` — destination-aware Nyx Weaver modal.

---

## Task 1: Shared region data + destination resolver

**Files:**
- Create: `src/app/undercity/data/regions.ts`
- Modify: `src/app/undercity/hatch/hatch-flow.component.ts` (biomes array ~lines 219–245; import block near top)

- [ ] **Step 1: Create `regions.ts`**

Create `src/app/undercity/data/regions.ts` with the region data lifted verbatim from the current hatch `biomes` array, plus the resolver:

```ts
/**
 * Per-region flavor for the 5 surface biomes — name, backdrop art, hatch perk,
 * lore, and the signature "what you can do here" feature. Single source shared
 * by the hatch home-picker, the board tunnel signposts, and the Nyx Weaver
 * tunnel-crossing dialogue. Only the 5 tunnel-connected surface biomes are
 * defined; regionInfo() returns undefined for others (isle/ruin/depths/wilderness).
 */
export interface RegionInfo {
  id: string;
  name: string;
  bg: string; // 'undercity/<x>_background.webp'
  tint: string;
  perk: string;
  blurb: string;
  lore: string;
  feature: { name: string; desc: string };
}

export const REGION_LIST: RegionInfo[] = [
  { id: 'city', name: 'The Undercity', bg: 'undercity/undercity_background.webp', tint: 'rgba(38, 120, 110, 0.35)',
    perk: 'City Rat', blurb: 'Hatch with a random Tier-1 item, equipped.',
    lore: 'A warren of crooked tunnels and black-market stalls beneath the palace. ' +
      'If it can be bought, stolen, or pried loose, it changes hands down here.',
    feature: { name: 'The Guildvault', desc: 'Crack the tumbler lock — read the sigils right to walk off with a fat prize.' } },
  { id: 'cavern', name: 'Mosslight Cavern', bg: 'undercity/cavern_background.webp', tint: 'rgba(70, 96, 190, 0.35)',
    perk: 'Darkvision', blurb: 'See 2 spaces away in dungeons.',
    lore: 'Deep galleries lit by glowing moss and seams of raw crystal. ' +
      'The dark keeps few secrets from those born to it.',
    feature: { name: 'Crystal Veins', desc: 'Mine glittering gems straight from the cavern walls.' } },
  { id: 'bog', name: 'The Sedgemoor', bg: 'undercity/swamp_background.webp', tint: 'rgba(52, 110, 60, 0.32)',
    perk: 'Mirefoot', blurb: 'Hazards cost you half, and rival spells more often miss you.',
    lore: 'A drowned expanse of reeking sedge and sunken paths, presided over by an old ' +
      'witch who trades in stranger currencies than Spores.',
    feature: { name: 'The Sedgemoor Witch', desc: 'Buy spell scrolls, or inscribe them into a grimoire of your own.' } },
  { id: 'bone', name: 'Ossuary Fields', bg: 'undercity/palace_background.webp', tint: 'rgba(150, 150, 130, 0.30)',
    perk: 'Marrowborn', blurb: '+8 Max HP.',
    lore: 'Endless drifts of bleached bone — the palace’s dead, and older things beneath them. ' +
      'Good digging, if you’re not squeamish.',
    feature: { name: 'Excavation Sites', desc: 'Dig through buried plots to unearth long-lost gear.' } },
  { id: 'garden', name: 'The Rot-Gardens', bg: 'undercity/swamp_background.webp', tint: 'rgba(140, 170, 40, 0.34)',
    perk: 'Composter', blurb: '+2 Spores from every loot space.',
    lore: 'Terraced beds of glorious decay where the Golgari cycle turns fastest — ' +
      'death feeding growth feeding death.',
    feature: { name: 'The Spore Shrine', desc: 'Offer your Spores to permanently raise an attribute.' } },
];

export const REGIONS: Record<string, RegionInfo> = Object.fromEntries(
  REGION_LIST.map((r) => [r.id, r]),
);

export function regionInfo(id: string | undefined): RegionInfo | undefined {
  return REGIONS[id ?? ''];
}

/** Minimal node shape tunnelDest needs (structural — no board-canvas import). */
interface GraphNode {
  id: string;
  region?: string;
  neighbors: string[];
}

/** A tunnel joins two regions; its destination is the neighbor region that
 *  differs from the tunnel's own side. Returns null if it doesn't bridge two. */
export function tunnelDest(nodes: GraphNode[], node: GraphNode): string | null {
  const byId = new Map(nodes.map((n) => [n.id, n]));
  for (const nb of node.neighbors) {
    const r = byId.get(nb)?.region;
    if (r && r !== node.region) return r;
  }
  return null;
}
```

- [ ] **Step 2: Point hatch-flow at the shared list**

In `src/app/undercity/hatch/hatch-flow.component.ts`, add to the imports near the top:

```ts
import { REGION_LIST } from '../data/regions';
```

Then replace the entire inline `biomes` array (the `protected readonly biomes = [ ... ];` block, ~lines 219–245, keeping the doc comment above it) with:

```ts
  protected readonly biomes = REGION_LIST;
```

- [ ] **Step 3: Build to verify the extraction compiles**

Run (from repo root): `npm run build`
Expected: build succeeds, no TS errors.

- [ ] **Step 4: Verify the hatch screen is unchanged**

Launch a headless Chrome against the running dev server (port 4242) at `/undercity` (the hatch flow) — or screenshot the home-biome picker — and confirm the 5 biome cards still render with their names/lore/feature. (See "Headless verification" at the end for the harness.)
Expected: 5 cards identical to before (city / cavern / bog / bone / garden).

- [ ] **Step 5: Commit** (skip during inline execution)

```bash
git add src/app/undercity/data/regions.ts src/app/undercity/hatch/hatch-flow.component.ts
git commit -m "refactor(undercity): extract shared region flavor + tunnelDest resolver"
```

---

## Task 2: Planted signposts on the game board

**Files:**
- Modify: `src/app/undercity/engine/board-canvas.ts` (import; call in `draw()` after the disc loop ~line 1250; new `drawSignposts` + `drawSignpost` methods)

- [ ] **Step 1: Import the shared helpers**

In `src/app/undercity/engine/board-canvas.ts`, add near the other `../data/*` imports:

```ts
import { regionInfo, tunnelDest } from '../data/regions';
```

- [ ] **Step 2: Call the signpost pass in the frame loop**

In `draw(ts)`, immediately after the node/disc loop closes (the `for (const n of this.map.nodes) { … this.drawSpace(n, elapsed); }` block ending ~line 1250) and BEFORE the player-token block (`const byNode = new Map…`), insert:

```ts
    // Signposts beside tunnel mouths preview where the shortcut leads.
    this.drawSignposts();
```

- [ ] **Step 3: Implement `drawSignposts` + `drawSignpost`**

Add these private methods to the class (e.g. just after `drawSpace`, near line 1589). They draw in world coordinates (the frame's transform is already world-space here):

```ts
  /** Planted signposts beside overworld tunnel mouths, previewing the
   *  destination region's backdrop + name. Overworld only — tunnels are
   *  surface, and the map editor uses a separate canvas. */
  private drawSignposts(): void {
    if (this.activeLayerId !== OVERWORLD) return;
    for (const n of this.map.nodes) {
      if (n.type !== 'tunnel' || !this.inActive(n.id) || !this.isLit(n.id)) continue;
      const dest = tunnelDest(this.map.nodes, n);
      const info = dest ? regionInfo(dest) : undefined;
      if (!dest || !info) continue;
      // Point the sign toward the destination-region neighbours.
      let dx = 0;
      let dy = -1;
      const near = n.neighbors
        .map((id) => this.nodeMap.get(id))
        .filter((m): m is BoardNode => !!m && m.region === dest);
      if (near.length) {
        const cx = near.reduce((s, m) => s + m.x, 0) / near.length;
        const cy = near.reduce((s, m) => s + m.y, 0) / near.length;
        const len = Math.hypot(cx - n.x, cy - n.y) || 1;
        dx = (cx - n.x) / len;
        dy = (cy - n.y) / len;
      }
      this.drawSignpost(n, dx, dy, info.name, this.floorTex[dest]);
    }
  }

  /** One planted signpost: a short post rising to a framed backdrop thumbnail
   *  with a name plaque, offset from the tunnel disc toward its destination. */
  private drawSignpost(
    n: BoardNode,
    dx: number,
    dy: number,
    name: string,
    img: HTMLImageElement | undefined,
  ): void {
    const ctx = this.ctx;
    const PW = 96;
    const PH = 74;
    const PLAQUE = 20;
    const POST = 30;
    // Base sits just off the disc toward the destination; panel floats above it.
    const bx = n.x + dx * (NODE_R + 10);
    const by = n.y - DISC_RY * 0.3 + dy * (NODE_R * 0.4);
    const px = bx;
    const py = by - POST - PH / 2;

    ctx.save();
    ctx.shadowColor = 'rgba(0, 0, 0, 0.5)';
    ctx.shadowBlur = 8;
    ctx.shadowOffsetY = 3;

    // Post.
    ctx.fillStyle = '#3b2f22';
    ctx.fillRect(bx - 4, py + PH / 2 - 2, 8, POST + 4);

    // Panel frame.
    const fx = px - PW / 2;
    const fy = py - PH / 2;
    ctx.beginPath();
    ctx.roundRect(fx, fy, PW, PH, 7);
    ctx.fillStyle = '#0d0f0b';
    ctx.fill();
    ctx.shadowColor = 'transparent';
    ctx.lineWidth = 2;
    ctx.strokeStyle = 'rgba(120, 96, 60, 0.9)';
    ctx.stroke();

    // Backdrop thumbnail (cover-fit, clipped to the image area).
    const ix = fx + 4;
    const iy = fy + 4;
    const iw = PW - 8;
    const ih = PH - PLAQUE - 6;
    if (img && img.width) {
      ctx.save();
      ctx.beginPath();
      ctx.roundRect(ix, iy, iw, ih, 4);
      ctx.clip();
      const scale = Math.max(iw / img.width, ih / img.height);
      ctx.drawImage(
        img,
        ix + (iw - img.width * scale) / 2,
        iy + (ih - img.height * scale) / 2,
        img.width * scale,
        img.height * scale,
      );
      ctx.restore();
    }

    // Name plaque.
    ctx.fillStyle = 'rgba(13, 15, 11, 0.92)';
    ctx.fillRect(fx + 3, fy + PH - PLAQUE, PW - 6, PLAQUE - 3);
    ctx.fillStyle = '#e6dcc2';
    ctx.font = '600 11px Georgia, "Times New Roman", serif';
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';
    ctx.fillText(name, px, fy + PH - PLAQUE / 2 - 1, PW - 10);
    ctx.restore();
  }
```

Notes: `NODE_R`/`DISC_RY` are already imported (used by `drawSpace`); `this.floorTex`, `this.nodeMap`, `this.inActive`, `this.isLit`, `OVERWORLD`, and `BoardNode` are all already in scope in this file. `ctx.roundRect` is standard (already used elsewhere in the codebase). `fillText`'s 4th arg (maxWidth) squeezes long names to fit the panel.

- [ ] **Step 4: Build**

Run: `npm run build`
Expected: success, no TS errors.

- [ ] **Step 5: Verify signposts render**

Headless screenshot of the game board (overworld) — see the harness at the end. Confirm each tunnel mouth shows a signpost whose plaque names the destination region and whose thumbnail matches that region's backdrop (e.g. a tunnel sitting in `cavern` shows a "The Sedgemoor" sign; its bog-side partner shows "Mosslight Cavern").

- [ ] **Step 6: Commit** (skip during inline execution)

```bash
git add src/app/undercity/engine/board-canvas.ts
git commit -m "feat(undercity): planted signposts previewing tunnel destinations"
```

---

## Task 3: Destination-aware Nyx Weaver dialogue

**Files:**
- Modify: `src/app/undercity/tabs/board-tab.component.ts` (`bridgeWashBg` ~line 1050; add `bridgeDest`; import)
- Modify: `src/app/undercity/tabs/board-tab.component.html` (bridge modal ~lines 330–383)

- [ ] **Step 1: Import the shared helpers**

In `src/app/undercity/tabs/board-tab.component.ts`, add near the other `../data/*` imports:

```ts
import { RegionInfo, regionInfo, tunnelDest } from '../data/regions';
```

- [ ] **Step 2: Resolve the destination for the open tunnel**

Add this method next to `bridgeTier()` (~line 1670):

```ts
  /** Region the currently-prompted tunnel leads to (null if unresolved). */
  protected bridgeDest(): RegionInfo | null {
    const id = this.bridgePrompt();
    if (!id || !this.map) return null;
    const node = this.map.nodes.find((n) => n.id === id);
    if (!node) return null;
    const dest = tunnelDest(this.map.nodes, node);
    return (dest && regionInfo(dest)) || null;
  }
```

- [ ] **Step 3: Wash the modal with the destination backdrop**

Replace `bridgeWashBg()` (~line 1050) with:

```ts
  protected bridgeWashBg(): string {
    // Peer across: show the destination biome's backdrop behind the tollkeeper,
    // dark enough (under the gradient) that her dialog stays legible. Falls back
    // to the between-worlds silk chasm if the destination can't be resolved.
    const bg = this.bridgeDest()?.bg ?? 'undercity/silk_roads.png';
    return (
      `linear-gradient(to bottom, ` +
      `rgba(16, 14, 11, 0.58) 0%, ` +
      `rgba(16, 14, 11, 0.90) 100%), ` +
      `url('${bg}')`
    );
  }
```

- [ ] **Step 4: Add the destination line to the modal**

In `src/app/undercity/tabs/board-tab.component.html`, inside the bridge modal, right after the closing `}` of the tier `@if/@else` paragraph chain (i.e. after the final `</p>` block around line 370, before `<div class="choice-grid">` at line 371), insert:

```html
        @if (bridgeDest(); as dest) {
          <p class="modal-sub bridge-dest">
            Beyond the silk lies <strong>{{ dest.name }}</strong> &mdash;
            {{ dest.feature.desc }}
          </p>
        }
```

- [ ] **Step 5: Build**

Run: `npm run build`
Expected: success, no TS/template errors.

- [ ] **Step 6: Verify the dialogue**

Headless: open a tunnel's Nyx Weaver modal (drive a player onto a tunnel, or set `bridgePrompt` via the Angular debug API) and confirm the modal shows the destination backdrop wash and the line "Beyond the silk lies <b>Mosslight Cavern</b> — Mine glittering gems straight from the cavern walls" (region + feature matching the tunnel).

- [ ] **Step 7: Commit** (skip during inline execution)

```bash
git add src/app/undercity/tabs/board-tab.component.ts src/app/undercity/tabs/board-tab.component.html
git commit -m "feat(undercity): Nyx Weaver names the tunnel destination + its draw"
```

---

## Headless verification harness

The dev server runs on **port 4242**. For each check, launch a throwaway headless Chrome (own profile + debug port, killed after — never touch the user's Chrome), navigate to the route, and screenshot via CDP `Page.captureScreenshot`. For the signposts, drive the board camera onto a tunnel with the Angular debug API:

```js
// via CDP Runtime.evaluate on the game-board page:
const c = window.ng.getComponent(document.querySelector('app-undercity-board-tab'));
// center the board canvas on a known tunnel and zoom in, then screenshot
```

If reaching the live game board needs season/creature state that isn't available headless, fall back to verifying the **signpost geometry** with a tiny standalone HTML harness that imports nothing (draw one `drawSignpost`-equivalent to a canvas) — but prefer the real board. At minimum, `npm run build` passing + the hatch-unchanged screenshot (Task 1) + a board screenshot are the bar.

## Final verification
- [ ] `npm run build` clean.
- [ ] Hatch screen unchanged (5 biome cards).
- [ ] Overworld board shows a correctly-named, correctly-previewed signpost at tunnel mouths.
- [ ] Nyx Weaver modal shows destination backdrop + "Beyond the silk lies …" line.
- [ ] Note for the user: frontend-only change; ships with a normal frontend deploy (no `cdk deploy` needed).

## Notes / gotchas
- **DRY:** `regions.ts` is the one source of region flavor; hatch, board, and modal all read it. Don't duplicate the biome copy.
- **Coverage:** only the 5 surface biomes have `RegionInfo`; tunnels only connect those, so `regionInfo(dest)` is always defined for a real tunnel. The `!info` guards keep it safe if a map ever adds a tunnel to an undescribed region.
- **Overworld-only:** signposts are gated on `activeLayerId === OVERWORLD`; tunnels don't exist in dungeon pockets, and this keeps the depths view clean.
- **No counter-scaling:** the signpost is a fixed world-size panel (per the approved "small panel" option), so it shrinks at whole-map zoom like the terrain — intended.
