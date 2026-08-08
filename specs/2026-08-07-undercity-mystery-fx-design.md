# Undercity — Mystery-event payoff animations + Undercity Lab

**Date:** 2026-08-07
**Status:** approved, ready for implementation
**Scope:** client-only (Angular). No server / pytest impact.

> **Revision (2026-08-07, after v1 review):** the abstract icon-burst animations
> (`MysteryFxComponent`) landed and read well, but the desired feel is
> **character-driven skits**: the player's *actual* creature on stage while a
> cast actor plays out the outcome's flavor (an imp swoops in, pickpockets
> spores, the creature does a surprised take, the imp flees). This revision adds
> a `MysterySkitComponent` that stars the real recolored creature +
> outcome-specific actor sprites. All 13 outcomes get a bespoke skit. The
> abstract `MysteryFxComponent` is retained as a graceful fallback (creature art
> not yet loaded / reduced-motion). See "Skit redesign" below.

## Problem

Landing on a **mystery** space spins the slot-reel (`mystery-reel.component.ts`),
which lands on one of 13 canonical outcomes, then cross-fades into the event
card. The card's banner for a mystery outcome is a flat tinted disc + Material
icon — the reveal has suspense but the *payoff* is static. We want each outcome
to come to life with a short, characterful animation in the card.

## Goals

- A bespoke ~5s animation per outcome (all 13), played in the event-card banner
  when `ev.type === 'mystery'`, keyed off `ev.outcome`.
- Animations are **one-shot** and **non-blocking**: they settle onto a calm
  resting frame; card text, chips, and the OK button are readable/tappable
  immediately.
- A dev review surface to replay each animation on demand.

## Non-goals

- No new runtime dependencies (no Lottie/GIF). Pure CSS keyframes + particles.
- No emoji — Material + `uc-*`/`rot.png` iconography and the biome palette only
  (game symbol-language rule).
- No changes to server outcome logic (`engine.mystery_outcome`) — it already
  stamps the 13 canonical keys the client consumes.

## The 13 outcomes

Canonical keys from `undercity_engine.mystery_outcome`:
`jackpot, gear, grimoire, item, heal, buff, curse, warp, hurt, theft, spores,
xp, mystery`.

| outcome    | scene (all end on a calm settle) |
|------------|----------------------------------|
| `jackpot`  | gold `rot.png` coin fountain + payline-gold flash — biggest payoff |
| `gear`     | shield rises out of a burst, rarity-tinted glint sweep |
| `grimoire` | book opens, pages riffle, arcane motes lift off |
| `item`     | backpack pops, item icon arcs out and settles |
| `heal`     | green bloom + `favorite` pulse, soft rising motes |
| `buff`     | charge-up: bolt aura crackles inward, quick flash |
| `spores`   | `rot.png` spore motes drift upward |
| `xp`       | `auto_awesome` sparkles spiral up, cool-blue |
| `warp`     | cyclone swirl; the disc blinks out and back |
| `curse`    | violet hex-ring contracts, sickly pulse |
| `hurt`     | red impact crack + brief shake |
| `theft`    | coins yanked off-screen, `money_off` slash |
| `mystery`  | (fallback) neutral `help` disc, slow question-mark shimmer |

All share a **burst → reveal → settle** rhythm so they read as one family.

## Architecture

### Shared symbol table
Extract the reel's private `SYMBOLS` map (icon + color for all 13) into
`src/app/undercity/data/mystery-symbols.ts`:

```ts
export interface MysterySymbol { icon: string; color: string; }
export const MYSTERY_SYMBOLS: Record<string, MysterySymbol> = { ... };
export const MYSTERY_OUTCOMES = Object.keys(MYSTERY_SYMBOLS);
```

`mystery-reel.component.ts` imports it instead of its local copy, so the reel
face and the card payoff share one color/icon per outcome (they visually rhyme).

### MysteryFxComponent
`src/app/undercity/tabs/mystery-fx.component.ts`
- Selector `app-undercity-mystery-fx`, standalone, imports `CommonModule` +
  `MatIconModule`.
- `@Input({ required: true }) outcome: string`.
- Template: a fixed-size stage `<div class="mfx mfx-{{key}}">` where `key`
  falls back to `mystery` for unknown outcomes; an internal `@switch (key)`
  renders the bespoke inner markup (icon disc + particle `<span>`s) per outcome.
- All motion is CSS `@keyframes` with `animation-fill-mode: forwards` (one-shot,
  ~5s max, settles). Particle positions use CSS custom props seeded in the
  component (same pattern as the reel's spark burst), not `Math.random()` in the
  template.
- Emits nothing; purely decorative.

### Event-card wiring
In `board-tab.component.html`, the `event-banner` block gains a branch:

```html
@if (ev.type === 'mystery') {
  <app-undercity-mystery-fx [outcome]="ev.outcome ?? 'mystery'" />
} @else if (ev.type === 'loot') { ...existing... }
```

Import `MysteryFxComponent` into `board-tab.component.ts`. Nothing else in the
card changes — text/chips/OK button already render below the banner. The card
only opens after the reel settles, so timing is automatic.

## Skit redesign

### Casting (all art already in `public/undercity/`)
| outcome | creature does | actor | prop |
|---------|---------------|-------|------|
| `theft`    | idle → startled hop, turns around, `!` | `enemies/fetid_imp` swoops in, grabs coin, flees up | `icons/rot.png` coin yanked away |
| `hurt`     | flinch shake + red flash, `!` | `enemies/dreg_mangler` darts in, swipes, retreats | — |
| `curse`    | recoils, sickly hue-shift, `sick` | `enemies/acolyte_of_affliction` casts, cackles, leaves | violet hex ring |
| `item`     | happy bob | `map_events/shopkeeper1` enters, hands over, leaves | `backpack` icon pops out |
| `grimoire` | reads, bob | `enemies/hag_hedgemage` offers a book, leaves | `menu_book` + arcane motes |
| `heal`     | perks up, `favorite` pulse | `enemies/myconid` sprinkles spores | green bloom + rising motes |
| `jackpot`  | joyful jump, `sentiment_very_satisfied` | — | `rot.png` coin rain |
| `spores`   | happy bob | — | `rot.png` motes gather up |
| `xp`       | stands tall / glow, `trending_up` | — | `auto_awesome` sparkles spiral |
| `gear`     | equip flash | — | `shield` icon descends + glint |
| `buff`     | flex / scale-pulse, `bolt` | — | energy bolts converge |
| `warp`     | blinks out and back, `question_mark` | — | cyclone swirl |
| `mystery`  | head-tilt, `question_mark` | — | floating `?` orb |

Emotes are Material icons (never emoji, per the game's symbol rule). Static
sprites convey emotion via **motion + an emote glyph** (startle hop, flinch
shake, turn-around flip, happy jump).

### MysterySkitComponent
`src/app/undercity/tabs/mystery-skit.component.ts`
- `@Input() outcome: string`, `@Input() creatureUrl: string | null` (the
  recolored player-creature data URL from `getRecoloredWithHatDataUrl`).
- A ~260×132 stage: creature `<img>` (pixelated) with a gentle infinite idle
  bob; an optional actor `<img>` cast from the table; prop/particle layers; an
  emote bubble. A per-outcome `[attr.data-fx]` drives all the CSS choreography
  (shared enter/exit/startle/flinch keyframes + per-skit specifics). ~4.5s
  one-shot for the event beats; creature keeps breathing after (non-blocking).
- Reduced-motion: freeze to a static staged frame.

### Event-card wiring (revised)
```html
@if (ev.type === 'mystery') {
  @if (youSpriteUrl(); as cu) {
    <app-undercity-mystery-skit [outcome]="ev.outcome ?? 'mystery'" [creatureUrl]="cu" />
  } @else {
    <app-undercity-mystery-fx [outcome]="ev.outcome ?? 'mystery'" />   <!-- fallback -->
  }
}
```

### Lab (revised)
The Mystery FX tab gains a **creature controls** row (form dropdown + 3 paint
hue sliders, using `getRecoloredWithHatDataUrl` after `preloadAll()`), then
renders all 13 **skits** in mock card frames starring that creature. Replay
per-cell + "Replay all" as before. The abstract-FX grid stays available too.

## Undercity Lab page

Rename the dev sandbox route from `/undercity/color-test` to `/undercity/test`
(Undercity Lab), keeping `/undercity/color-test` as a redirect so existing
bookmarks/muscle-memory still land.

- New shell `src/app/undercity/lab/undercity-lab.component.ts`: a standalone
  component with a two-tab switch (a `signal<'sprite' | 'fx'>`), embedding:
  - **Sprite Recolor** → the existing `ColorTestComponent`, unchanged (embedded
    as a child; its doc-comment route line updated to `/undercity/test`).
  - **Mystery FX** → new `MysteryFxLabComponent`: a grid of the 13 outcomes
    (label + swatch from `MYSTERY_SYMBOLS`); clicking one replays that
    animation inside a mock event-card frame (re-mount via a bumped `@if` key
    so the CSS one-shot restarts). A "Play all" button sweeps them in sequence.
- `app.routes.ts`: point `undercity/test` at the lab shell; add
  `undercity/color-test` → redirect to `undercity/test`.
- Update the navbar link and any other `color-test` route references.

## Files

New:
- `src/app/undercity/data/mystery-symbols.ts`
- `src/app/undercity/tabs/mystery-fx.component.ts`
- `src/app/undercity/lab/undercity-lab.component.ts`
- `src/app/undercity/lab/mystery-fx-lab.component.ts`

Changed:
- `src/app/undercity/tabs/mystery-reel.component.ts` (import shared symbols)
- `src/app/undercity/tabs/board-tab.component.ts` + `.html` (wire FX into banner)
- `src/app/app.routes.ts` (lab route + redirect)
- `src/app/navbar/navbar.component.html` (+ any other route refs)
- `src/app/undercity/color-test/color-test.component.ts` (doc-comment route)

## Verification

Frontend has no test runner, so:
- `npm run build:prod` green.
- Drive `/undercity/test` in a browser (run-undercity skill): replay all 13 in
  the Mystery FX tab; confirm the Sprite Recolor tab is intact; confirm the
  `color-test` redirect resolves.
- Confirmed additive & client-only — safe to land independently of unrelated
  backend test state.
