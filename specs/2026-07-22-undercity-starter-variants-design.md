# Undercity — Starter sprite variants + `grub`→`insect` rename

**Date:** 2026-07-22
**Status:** Approved, ready for implementation plan

## Goal

Let a player choose between two cosmetic sprite looks for their starting
creature during the hatch flow. Each of the four Tier-1 starters gains a second
variant. The choice is **purely cosmetic** — same form, stats, passive, and
evolution line; only the drawn sprite changes.

As a prerequisite art-cleanup, the `grub` sprite art is promoted to the real
kraul art under the `insect` name, and the stale `grub` references are removed.

## Variant set

| Starter (`form`) | Base sprite | Alt sprite | Recolor (egg hue)? |
|---|---|---|---|
| `pest` | `pest` | `pest_2` | both (masks present) |
| `saproling` | `saproling` | `saproling_2` | both (masks present) |
| `zombie` | `zombie` | `zombie_2` | base only — `zombie_2` has no `.mask.png`, so it draws un-tinted |
| `kraul` | `insect` | `insect_2` | both (masks present) |

The base sprite equals today's `FORM_SPRITES` entry, so existing behavior is
unchanged for anyone who takes the default.

## Data model

- A variant is identified by its **sprite key** (`pest_2`, `saproling_2`,
  `zombie_2`, `insect_2`). The base look uses the plain form key.
- The server stores a new optional `spriteVariant` string on the player doc,
  handled like the existing `paint` / `hat` cosmetics. It is only set when a
  non-base alt is chosen (base → field omitted / `None`).
- The field rides through the doc across evolutions. Tier-2+ forms have no
  variants, so `formSprite` ignores a stale value once the creature evolves.
- Validation lives server-side against a `STARTER_VARIANTS` mirror in
  `undercity_data.py` (`{form: [alt_key, ...]}`). An unknown/invalid value
  falls back to the base (field not stored). This follows the repo's
  "server rules + client display mirror" convention.

## Client — `src/app/undercity/data/species.ts` (art source of truth)

- Add `FORM_VARIANTS: Record<string, SpeciesSprite & { id: string; name: string }[]>`
  listing each look with its sprite key + a short display label
  (e.g. "Classic" / "Alt"). Only pest/saproling/zombie/kraul get entries; the
  first entry equals today's `FORM_SPRITES` value.
- `formSprite(form, variant?)`:
  - If `variant` matches an entry in the form's variant list, return it.
  - Otherwise fall back to the form's base (current behavior). Every existing
    `formSprite(form)` call is therefore unchanged.
- Add the variant sprite keys to `ALL_SPRITES` so the engine preloads them.

## Client — hatch flow (`hatch/hatch-flow.component.*`)

- Add a `chosenVariant` signal, defaulting to the base.
- In the **creature showcase (step 1b)** panel: when the showcased form has more
  than one variant, render a small segmented toggle with a live sprite preview.
  Parameterize the existing `spriteUrl(starter)` helper by variant so the
  preview updates with both the egg hue and the selected look.
- Available in both the normal showcase and the Bravery reveal (cosmetic only).
- `confirmShowcase` captures the chosen variant; `resetCreatureChoice` clears it
  back to base.
- `hatch()` adds `spriteVariant` to the `join` action payload (base → omit or
  send `null`).

## Server — serialization + storage

- `_join` (`undercity_db.py`): read `spriteVariant` from the payload, validate
  against `STARTER_VARIANTS[starter]`, pass the validated value into
  `_new_player_doc`.
- `_new_player_doc`: accept a `sprite_variant` kwarg; set `doc['spriteVariant']`
  only when it is a valid non-base alt.
- Add `'spriteVariant': p.get('spriteVariant')` to:
  - `_public_player` (drives board / spectator / TV),
  - the `_archive_season` standings row (drives the ceremony),
  - the self/`you` object (verify how it is built — if it returns the raw
    cleaned doc, the field rides free; otherwise add it).

## Client — render threading

- Add `spriteVariant?: string | null` to `PublicPlayer` in
  `services/undercity-models.ts` and to the canvas token type in
  `engine/board-canvas.ts`.
- Thread `p.spriteVariant` into the gameplay `formSprite(p.form)` call sites:
  `board-canvas.ts`, `plaza-canvas.ts`, `undercity-page.component.ts`,
  `creature-tab.component.ts`, `log-tab.component.ts`,
  `spectator.component.ts`, `ceremony.component.ts`, `board-tab.component.ts`.
  Objects that map `{ form: p.form, ... }` for the canvases carry the new field
  through.

## `grub` → `insect` rename (art cleanup, do first)

- Rename `public/undercity/player_sprites/grub.png` → `insect.png` and
  `grub.jfif` → `insect.jfif`, overwriting the old `insect.png`/`insect.jfif`.
- Keep `insect.mask.png` / `insect.hat.png` as kraul's recolor + hat guides.
  **Verify** after rename that the recolor regions and hat anchor still line up
  with the new art; if the old mask was authored against the old insect art it
  may need re-authoring (out of scope to redraw here — flag if broken).
- Remove the redundant `'grub'` entry from `scripts/pixelate_sprites.py`
  `TARGETS` and the `color-test` `PLAYER_SPRITES` list (`'insect'` already
  present in both).
- Leave historical `starter='grub'` text in `specs/*.md` — doc-only, not live.

## Testing

- **Server (pytest, `infrastructure/lambda`):** extend the join test —
  - passing a valid `spriteVariant` stores it and surfaces it in public state;
  - an invalid/unknown value falls back to base (field not stored);
  - keep the map-sync and existing suites green.
- **Client:** no test runner. Verify with a production build (`npm run build:prod`)
  and the `run-undercity` skill — eyeball the showcase picker, confirm the
  chosen variant renders on the board / creature tab, and check the renamed
  `insect` kraul art + recolor.

## Out of scope / deferred

- No mid-game "change your look" UI — the variant is chosen once at hatch.
- No new recolor masks for `zombie_2` (draws un-tinted by design for now).
- `squirrel_mage` / `squirrel_general` / `squirrel` / `pest_big` art unused.
