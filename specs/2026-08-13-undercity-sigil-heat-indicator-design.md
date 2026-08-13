# Undercity — Sigil Heat Indicator

**Date:** 2026-08-13
**Status:** Design approved, ready for implementation plan
**Scope:** client-only (Angular) + one pytest drift guard. No server or engine changes.
**Related:** dungeon sigil scaling rationale in
[undercity_config.py:561-583](../infrastructure/lambda/undercity_config.py#L561-L583)

## Problem

Dungeons get harder for every Guild Sigil you already hold — enemy stats are
multiplied by `1 + 0.40 × sigils_held`, so the fifth dungeon hits three times as
hard as the first. This is the single most consequential difficulty knob in the
game and **nothing in the UI says so.**

A player who claims their third sigil and dives straight back down meets a
×2.2 cave with no warning, loses, and has no way to attribute the loss to the
sigils. The mechanic exists specifically to push players back to the surface to
re-gear between runs, and it cannot do that job while it is invisible.

The sigil count already sits in the HUD purse bar
([undercity-page.component.html:134-138](../src/app/undercity/undercity-page.component.html#L134-L138))
as a plain, inert `<span>` — the right object in the right place, doing nothing.

## Goal

Make the existing sigil chip **glow while you are in a dungeon**, with an
intensity that rises with each sigil held, and make it **tappable** to reveal
what those sigils are doing to the things in this cave — flavor plus the real
multiplier.

## User decisions

- **Tap reveals flavor *and* exact numbers.** Not flavor alone, not a bare stat
  readout. The player should feel the escalation and be able to act on it.
- **One flavor line per sigil count** (1 through 5), not two or three coarse
  tiers. Every sigil visibly changes the text, so the panel rewards re-checking.
- **Glow intensity scales with sigils held.** The chip communicates escalation
  at a glance; the tap only confirms the number.
- **Multiplier comes from a client mirror plus a pytest drift guard**, not from
  a new state-payload field. Keeps the feature client-only at no payload cost,
  while making silent drift impossible.
- **Tappable everywhere, not just in dungeons.** A control that becomes
  focusable only in certain rooms is hostile to keyboard and screen-reader
  users, and knowing the cost *before* descending is exactly the decision the
  scaling exists to provoke. Only the *glow* is dungeon-gated.

## The mechanic being surfaced

Ground truth, for the panel's copy to stay honest:

| Sigils held | Multiplier |
|---|---|
| 0 | ×1.0 |
| 1 | ×1.4 |
| 2 | ×1.8 |
| 3 | ×2.2 |
| 4 | ×2.6 |
| 5 | ×3.0 |

Five biome lairs exist (`SIGIL_LAIRS`), only three are required to unseal the
Queen, so the held count legitimately reaches 5.

The scaling is **not uniform across enemy kinds**, and the panel must say so:

- **Dungeon wilds** scale `hp`, `atk`, `def`
  ([undercity_db.py:4980-4982](../infrastructure/lambda/undercity_db.py#L4980-L4982)).
- **Lair guardians** scale `atk`, `def` only — their HP pool is season-shared,
  so only per-fight stats may vary by who walked in
  ([undercity_db.py:5202-5206](../infrastructure/lambda/undercity_db.py#L5202-L5206)).
- **SPD is never scaled.** Initiative and the stance triangle are tuned per
  creature; scaling them would change fight *shape*, not just pressure.
- **Home biome rings stay flat.** They are the T1 starting areas by design.

## Trigger

Two new computeds on `UndercityPageComponent`:

```ts
/** True while standing on a depths node — the only region sigils empower. */
protected readonly inDungeon = computed(() => {
  const pos = this.store.you()?.position;
  return !!pos && this.map()?.nodes.find((n) => n.id === pos)?.region === 'depths';
});

/** Enemy stat multiplier the held sigils impose on dungeon fights. */
protected readonly sigilMult = computed(() => 1 + DUNGEON_SIGIL_SCALING * this.sigilsHeld());
```

`inDungeon` uses the same region test as
[board-tab.component.ts:1583](../src/app/undercity/tabs/board-tab.component.ts#L1583).
`sigilsHeld()` already exists at
[undercity-page.component.ts:66-69](../src/app/undercity/undercity-page.component.ts#L66-L69)
and counts `poiClaims` against the client `DUNGEONS` map — which carries all
five biomes, so it agrees with the server's `_sigil_count` exactly.

Visibility is unchanged: the chip still renders only under the existing
`@if (sigilsHeld() > 0)`. That is already correct — zero sigils means no
scaling, so there is nothing to glow about and nothing to explain.

## The pointer-events carve-out

`.hud-purse` sets `pointer-events: none`
([undercity-page.component.scss:307](../src/app/undercity/undercity-page.component.scss#L307))
with the comment *"display-only; never steals a tap from the board."* The purse
bar floats over the draggable board, and swallowing drags there would be a
regression.

The sigil chip therefore re-enables `pointer-events: auto` **on itself only**.
The rest of the purse bar stays inert. This is a deliberate, commented
exception, not an oversight to be "fixed" later.

## The glow

The chip element carries a `--sigil-heat` custom property (1–5, from
`sigilsHeld()`), applied only while `inDungeon()`. One number drives three
dimensions so the escalation reads without a legend:

| Dimension | At 1 sigil | At 5 sigils |
|---|---|---|
| Glow spread / alpha | faint, tight halo | wide, hot bloom |
| Pulse duration | slow breath | fast throb |
| Glyph hue | current `#fbbf24` amber | hot rot-orange |

No new art — it is the existing `workspace_premium` Material glyph. Colors come
from the established palette rather than new tokens.

Under `prefers-reduced-motion: reduce` the pulse animation drops and the glow
holds static at its scaled intensity, so the information survives without the
motion. This extends the existing reduced-motion block at
[undercity-page.component.scss:951](../src/app/undercity/undercity-page.component.scss#L951).

Outside a dungeon the chip renders exactly as it does today — no glow, no
animation.

## The flavor lines

Keyed to sigils held. Golgari register; Material icons only, no emoji.

| Held | Line |
|---|---|
| 1 | One sigil on your belt, and the deep has started paying attention. |
| 2 | Two sigils. What lives down here can smell them on you now. |
| 3 | Three sigils ride your back. Every shadow in this cave knows the weight. |
| 4 | Four. The Undercity has stopped pretending you are welcome. |
| 5 | Five sigils. There is nothing neutral left between you and the Queen. |

## The panel

Reuses the `buff-details` pattern wholesale
([undercity-page.component.html:167-185](../src/app/undercity/undercity-page.component.html#L167-L185),
[scss:496-522](../src/app/undercity/undercity-page.component.scss#L496-L522)):
absolutely positioned under the chip, `role="dialog"`, dismissed by an outside
pointerdown with **no backdrop catcher**, so the board stays draggable while the
panel is up.

```
┌──────────────────────────────────┐
│ ◈ THE SIGILS BURN                │
│                                  │
│ Three sigils ride your back.     │
│ Every shadow in this cave knows  │
│ the weight.                      │
│                                  │
│  Cave dwellers   ×2.2  HP ATK DEF│
│  Lair guardian   ×2.2  ATK DEF   │
│                                  │
│ Your home ring is untouched —    │
│ only the deep answers a sigil.   │
└──────────────────────────────────┘
```

Two stat rows, because the scaling genuinely differs by enemy kind. The
footnote heads off the obvious follow-up question ("why was that surface fight
easy?").

**Outside a dungeon** the same panel shows the same numbers in future tense —
title "THE SIGILS WAIT", and a lead line to the effect that in the deep each
sigil will empower what lives there. The stat rows and footnote are unchanged;
only the framing shifts.

## The drift guard

`DUNGEON_SIGIL_SCALING = 0.4` is mirrored into
`src/app/undercity/data/dungeons.ts`, next to the existing `DUNGEONS` table,
with a comment naming
[undercity_config.py:580](../infrastructure/lambda/undercity_config.py#L580) as
the source of truth.

A new `infrastructure/lambda/tests/test_sigil_mirror.py` reads that TS file,
extracts the constant, and asserts it equals `config.DUNGEON_SIGIL_SCALING`.
The suite fails the moment the two disagree — the same idiom the repo already
uses to keep the two copies of `map.json` in sync.

The guard lives on the Python side because the repo has no JS test runner.

## Non-goals

- **No server change.** No new state field, no engine change, no action.
- **No per-dungeon or per-player variation.** The scaling is one global scalar;
  if that ever changes, the mirror stops being viable and the server must ship
  the number instead. Nothing in the current design points that way.
- **No change to the scaling itself.** This is a display feature. `0.40` stays
  `0.40`.
- **No new art or design tokens.**

## Testing

- `cd infrastructure/lambda && python -m pytest tests -q` — must stay green,
  now including the new mirror guard. Baseline at time of writing: 1417 passed.
- `npm run build` — the repo's lint is unreliable, so the build is the
  verification gate for the Angular side.
- Manual: enter a dungeon at 1 sigil and at 3+, confirm the glow escalates, tap
  the chip and confirm the multiplier matches the table above, confirm the board
  still drags with the panel open, and confirm the chip is absent at 0 sigils.

## Invariants

- The chip never appears at 0 sigils.
- The glow appears only on `region === 'depths'` nodes.
- The purse bar outside this one chip stays `pointer-events: none`.
- The displayed multiplier always equals the server's, enforced by the guard.
- The panel never claims guardians scale HP — they do not.
