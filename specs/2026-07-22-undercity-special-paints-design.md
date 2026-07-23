# Undercity Special Paints — Design

**Date:** 2026-07-22
**Status:** Approved design, pending implementation plan

## Summary

Import Dino Party's four "rare paints" into Undercity as **special paints**: whole-creature
animated cosmetic effects that overlay on top of a creature's existing hues. Sold in the
renown shop for **500 renown** each; owned permanently; equipped and swapped like normal
hue paints. The four effects are **Prismatic**, **Rainbow**, **Metallic**, and **Starry**.

Special paints are distinct from the existing hue-paint system. A hue paint sets a creature's
`paint = {body, belly, stripes}` hues. A special paint is a separate `effect` field that, when
set, draws an animated overlay clipped to the creature's silhouette — on top of whatever hues
are equipped.

## Decisions (from brainstorming)

- **Scope:** whole-creature effect (one `effect` per creature), not the per-region model
  Dino Party uses.
- **Layering:** overlay on the creature's current colors; hues stay underneath.
- **Animation surfaces:** live RAF animation only on board pawns, plaza pawns, and the
  creature-detail preview. Everywhere else (list rows, small portraits) renders a single
  static effect frame — the effect shows, it just doesn't move.
- **Equip flow:** same as hue paints — buy once, then equip/swap freely at the pre-spawn
  shop or via the wardrobe.

## The four effects

Ported from `AlexBirthdayDinos/frontend/src/components/DinoSprite.jsx` (`_drawEffectOverlays`).
All are mask-clipped canvas overlays, time-driven:

| id | name | effect |
|----|------|--------|
| `prismatic` | Prismatic | gentle full-silhouette hue pulse at low alpha (~0.12) |
| `rainbow` | Rainbow | sweeping multi-hue gradient band traversing the silhouette |
| `metallic` | Metallic | sweeping white specular shine band |
| `starry` | Starry | a slowly drifting star-field texture (`starry.jpg`) at ~0.6 alpha |

Dino Party's internal id for starry was `starry_night`; Undercity uses `starry`. Ids are
independent between the two games.

## Data model

### Server (`infrastructure/lambda/`)

`undercity_data.py`:
- `SPECIAL_PAINTS: list[dict]` — `[{'id': 'prismatic', 'name': 'Prismatic'}, ...]` (4 entries).
- `SPECIAL_PAINT_MAP = {p['id']: p for p in SPECIAL_PAINTS}`.
- `SPECIAL_PAINT_PRICE = 500` — placed next to `PAINT_PRICE` / `HAT_PRICES` for locality with
  the other cosmetic prices (consistency with sibling code beats the config/data split here,
  matching where `PAINT_PRICE` already lives).

`undercity_db.py`:
- `perm['effects']: list[str]` — owned special-paint ids. Parallel to `perm['hats']` /
  `perm['paints']`. Defaulted to `[]` where the perm doc is created, and backfilled for
  existing perm docs (same place `paints` is backfilled today).
- `doc['effect']: str | None` — the creature's equipped special paint. Defaulted `None` in
  `_new_player_doc`. Surfaced in every place `paint` / `hat` are already surfaced:
  - the live state serializer (creature block),
  - board-player projection,
  - plaza-partner projection,
  - the wardrobe payload (`out['wardrobe']` gets `effects` alongside `hats` / `paints`).

### Client (`src/app/undercity/`)

`data/cosmetics.ts` (mirror):
- `SpecialPaintInfo { id: string; name: string }`.
- `SPECIAL_PAINTS: SpecialPaintInfo[]` and `SPECIAL_PAINT_MAP`.
- `SPECIAL_PAINT_PRICE = 500`.

`services/undercity-models.ts`:
- Add `effect?: string | null` to the creature, board-player, and wardrobe types.

## Server handlers

`_apply_shop_purchases` (pre-spawn shop — spends banked renown):
- New payload keys `buyEffects: string[]` and `equipEffect: string | null`.
- Validate each `buyEffects` id against `SPECIAL_PAINT_MAP`; reject unknown ids and
  already-owned ids; add `SPECIAL_PAINT_PRICE` per new effect to the cart total.
- `equipEffect` must be in `perm['effects'] ∪ buyEffects`, else 409.
- Preserve the existing "validate the full cart before mutating anything" contract: no
  mutation on any failure.
- On commit: `perm['effects'] += buyEffects`; if `equipEffect`, set `doc['effect'] = equipEffect`.

`_customize` (post-spawn wardrobe swap):
- New payload key `effect`. If present:
  - empty string / `None` → clears (`doc['effect'] = None`);
  - otherwise must be in `perm['effects']`, else 409; set `doc['effect']`.

## Rendering

The performance requirement is explicit: many pawns can be on the board at once, and the
plaza/board already run RAF loops. The design keeps per-frame work to a few cheap canvas ops
and does **zero** per-frame `getImageData` or per-frame recolor (the expensive path Dino Party
took for rainbow/prismatic is deliberately not ported).

### Silhouette mask (built once per sprite)

`sprite-engine.ts` already builds and caches a per-sprite `regionMap: Int8Array` (region ≥ 0
for colored pixels). Add a cached **silhouette mask canvas** derived from it: opaque white
where `regionMap[i] >= 0`, transparent elsewhere. One pass, one `putImageData`, cached in a
`Map` keyed by sprite — built at most once per sprite for the whole session.

### `drawCreatureEffect(ctx, sprite, effect, dx, dy, dw, dh, timeMs)`

- Uses a **single module-level scratch canvas**, resized only when the destination box grows.
  No per-creature / per-frame allocation.
- Steps:
  1. Draw the silhouette mask scaled into the scratch at `(dw, dh)`.
  2. `scratch.globalCompositeOperation = 'source-in'`, then paint the effect over the scratch:
     - **metallic** — linear-gradient white shine band, x-offset driven by `timeMs`.
     - **rainbow** — linear-gradient hue band (hue + position driven by `timeMs`).
     - **prismatic** — solid `hsl` fill at ~0.12 alpha, hue driven by `timeMs`.
     - **starry** — `drawImage` of the drifting star-field texture at ~0.6 alpha; pan offset
       driven by `timeMs`.
  3. Composite the (now silhouette-clipped) scratch onto the main `ctx` at `(dx, dy, dw, dh)`
     with plain `source-over`. Because the scratch is already masked to the silhouette,
     `source-over` overlays only the creature's pixels — no need for `source-atop` against the
     shared canvas.
- Per creature per frame: ~3 canvas ops (mask draw, effect paint, composite). No pixel reads.
- `timeMs` is passed in from the existing RAF timestamp; `Date.now()` is not used.

### Wiring the live loops

- **board-canvas.ts** `drawPlayerToken` (and **plaza-canvas.ts** partner draw): after the
  existing sprite `drawImage`, if `player.effect`, call `drawCreatureEffect(...)` with the same
  destination box, threading the RAF timestamp through.
- The creature-detail preview animates the same way (its own small RAF or shared timestamp).

### Static frames

- Add an effect-aware static variant (e.g. `getRecoloredWithEffect` / extend the existing
  `getRecoloredWithHat` path) that renders **one** representative effect frame (`timeMs = 0`)
  onto the composited canvas, silhouette-clipped, cached by `sprite + hues + hat + effect`.
- Used by list rows and small portraits so they show the effect without each spinning up a RAF.

### Starry texture asset

- Copy Dino Party's `starry_night.jpg` to `public/undercity/effects/starry.jpg`.
- Load it in `preloadAll` (fire-and-forget with graceful fallback: if it hasn't loaded, the
  starry overlay simply skips that frame, exactly as Dino Party guards with `_starryLoaded`).

## Client UI

- **Pre-spawn shop** (`hatch/hatch-flow.component.ts`): a "Special Paints" section listing the
  four at 500 renown, with buy + equip, reusing the existing cart/equip signal pattern
  (`buyEffects`, `equipEffect` mirror `buyPaints` / `equipPaint`).
- **Wardrobe** (`tabs/creature-tab.component.ts`): special-paint swatches to equip/unequip the
  `effect`, sending it in the `customize` payload.

## Testing

Extend `infrastructure/lambda/tests/test_undercity_db.py`:
- Buying a special paint deducts exactly 500 renown and adds it to `perm['effects']`.
- Equipping an owned effect sets `doc['effect']`; it round-trips into the live state and the
  wardrobe payload.
- Equipping an un-owned effect returns 409.
- Buying with insufficient renown is rejected and mutates nothing.
- An unknown effect id is rejected.
- Clearing the effect via `_customize` (empty/None) sets `doc['effect'] = None`.

Run: `cd infrastructure/lambda && python -m pytest tests -q` (keep green).

## Out of scope

- Per-region effects (Dino Party's model).
- Any new effect beyond the four ported.
- Rebalancing existing hue-paint prices or the renown economy.
