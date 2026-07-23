# Undercity — Neutral paints (black / grey / white)

**Date:** 2026-07-23
**Status:** Approved design, pre-implementation

## Goal

Add three achromatic paints — **white**, **grey**, **black** — to the Undercity
cosmetic system. They behave like every other paint (per-region, 40 renown,
owned by id) but render as greyscale instead of a hue shift.

## Problem

A paint is stored and threaded everywhere as a per-region **hue number**
(`paint: Record<string, number>`, e.g. `{body: 130, belly: 50, stripes: 130}`).
The recolor keeps each pixel's original saturation and brightness and only
shifts hue: `hsvToRgb(newHue, origS, origV)`. Achromatic colours have no hue,
so they cannot ride that path — the recolor must instead crush saturation and
steer brightness.

## Approach — sentinel values in the existing number field

Real hues are `0–359`. Neutrals get **out-of-range sentinel values**, and the
recolor treats "value `< 0`" as "neutral, not a hue":

| Paint | id      | sentinel value | brightness band (v′) |
| ----- | ------- | -------------- | -------------------- |
| White | `white` | `-1`           | `0.68 – 0.97`        |
| Grey  | `grey`  | `-2`           | `0.28 – 0.62`        |
| Black | `black` | `-3`           | `0.04 – 0.32`        |

This is migration-free: persistence, the DynamoDB doc, `Record<string,number>`,
ownership, and pricing all key off the paint **id** and treat the value as an
opaque number. The server already copies `PAINT_MAP[id]['hue']` into the doc
verbatim with no range check, so it stores the sentinel with zero rule changes.

### Rendering (preserve shading)

One shared pixel helper replaces the inline hue-shift in both the engine
(`getRecolored`) and the color-test's own render loop:

```
paintedRgb(origR, origG, origB, value) -> [r, g, b]:
  hsv = rgbToHsv(origR, origG, origB)
  if value >= 0:                        # existing hue paint
      return hsvToRgb(value, hsv.s, hsv.v)
  [lo, hi] = NEUTRAL_BANDS[value]       # -1 / -2 / -3
  return hsvToRgb(0, 0, lo + hsv.v * (hi - lo))   # saturation 0, brightness remapped
```

Remapping the original brightness into a band (rather than a flat fill) keeps
each pixel's relative light-and-shadow, so a white-painted region reads as light
grey with its form intact instead of a flat sticker. Outline/background pixels
are already excluded by the region map, so they stay untouched.

### Swatches

Three UI spots render a paint swatch from its hue via `hsl(hue, …)` — the hatch
egg-shell picker, the creature-tab wardrobe, and the color-test paint row.
`hsl(-2, …)` is invalid, so add a shared helper and swap those inline
expressions to it:

```
paintSwatchCss(value): string
  value === -1 -> '#f2f2f2'   // white
  value === -2 -> '#808080'   // grey
  value === -3 -> '#1e1e1e'   // black
  else         -> `hsl(${value}, 60%, 45%)`
```

Selection checks (`you.paint[region] === p.hue`) and the hue→name lookup
(`PAINTS.find(p => p.hue === value)?.name`) already work by equality, so they
need no change.

## Files

- `src/app/undercity/data/cosmetics.ts` — 3 new `PAINTS` rows; `NEUTRAL_BANDS`,
  `isNeutralPaint(value)`, `paintSwatchCss(value)` helpers.
- `infrastructure/lambda/undercity_data.py` — mirror the 3 `PAINTS` rows (same
  ids + sentinel values). No other server change.
- `src/app/undercity/engine/sprite-engine.ts` (or `colors.ts`) — the shared
  `paintedRgb` helper; `getRecolored`'s per-pixel loop calls it.
- `src/app/undercity/color-test/color-test.component.ts` — its render loop and
  swatch preview call the shared helpers (so the sandbox mirrors the board).
- Swatch call-sites: `hatch/hatch-flow.component.html`,
  `tabs/creature-tab.component.html`, `color-test.component.html`.

## Non-goals (YAGNI)

- No per-paint pricing (flat `PAINT_PRICE` = 40).
- No new "neutral" rarity or grouping — they sit in the normal paint list.
- No egg-shell restriction — neutrals are selectable anywhere paints are.

## Testing

- Python engine suite (`cd infrastructure/lambda && python -m pytest tests -q`)
  stays green — no rule change, only a data-table addition.
- Browser verification via `/undercity/color-test`: apply white/grey/black to a
  masked sprite (e.g. pest), confirm greyscale-with-shading recolor and correct
  achromatic swatches; confirm existing hue paints are unchanged.
