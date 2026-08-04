# Undercity — Companion in Combat (visuals)

**Date:** 2026-08-04
**Status:** Design approved, ready for implementation plan
**Scope:** Client-only. No Lambda / engine / balance changes.

## Goal

When the player has an **attack** or **defend** companion equipped, show that pet
**beside them in the combat arena**, and when it activates during a round —
lands a follow-up hit or deflects damage — play a distinct, readable little beat
(the pet lurches forward to strike, or hops up to block) with a popover stating
what happened.

## Why this is client-only

The server already emits everything needed on each `CombatEntry`
([undercity-models.ts](../src/app/undercity/services/undercity-models.ts)):

- `pet?: 'attack' | 'defend'` — the companion trigger tag by role.
- `dmg` on a `pet: 'attack'` entry — the follow-up hit dealt to the foe.
- `deflect?: number` on a `pet: 'defend'` entry — points shrugged off.

Combat resolution, HP totals, and RNG stay authoritative on the server. This
feature only enriches how the existing entry stream is *played back* in
[interactive-battle.component.ts](../src/app/undercity/tabs/interactive-battle.component.ts).
It replaces the current minimal treatment (a `pets` glyph in front of the
follow-up damage number, and a plain `"Block!"` pop).

## Decisions (locked)

- **Presence:** the pet is **always beside you** for the whole fight (a small
  sidekick tucked at your creature's feet), and animates when it acts.
- **Which pets appear:** **combat pets only** — `attack` and `defend` roles.
  A forage/scout/economy pet shows nothing in the arena (it has no combat action).
- **Popover wording:** **action + number** — `Follow-up! −N` for a follow-up
  hit, `Blocked N!` for a deflect.
- **Sides:** player (attacker) only. NPCs / PvP clones never carry a companion.

## Data flow / plumbing

1. `BattleSide` ([battle-playback.component.ts](../src/app/undercity/tabs/battle-playback.component.ts))
   gains an optional field:

   ```ts
   companion?: {
     role: 'attack' | 'defend';
     spriteUrl: string;
     name: string;
   };
   ```

2. In [board-tab.component.ts](../src/app/undercity/tabs/board-tab.component.ts),
   a small helper derives the active pet (reusing the existing
   `you.pets` / `activePetId` lookup and `petSpriteUrl` / `petRole` from
   [data/pets.ts](../src/app/undercity/data/pets.ts)) and returns a
   `companion` object **only when the active pet's role is `attack` or
   `defend`**, else `undefined`. It is set on the **attacker** `BattleSide` in
   both `openLiveBattle` and `resumeLiveBattle`. Nothing else in the battle
   payload changes.

## Rendering — persistent sidekick

Inside the attacker `.side` in
[interactive-battle.component.html](../src/app/undercity/tabs/interactive-battle.component.html),
render a `.companion` element next to `.body`, shown only when
`attacker.companion` is set:

- Small — roughly **45%** of the creature sprite box — so it reads as a
  sidekick, not a second fighter.
- `image-rendering: pixelated`, `object-fit: contain` (same treatment as the
  hub-tile pet sprite), fixed box so mixed 32/64px art displays uniformly.
- Tucked at the player's near-front foot (arena is player-left, foe-right), so
  the lunge reads as moving *toward* the foe. Must not collide with the
  attacker `.stat-col` or the `dmg-pop`.
- Drops in with the fighters (`enteredFighters()`); gentle idle bob when not
  acting.
- Falls back to the role's Material icon (`pets` / `shield`) if the sprite
  fails to load — mirror the existing `attackerSpriteFailed` pattern with a
  `companionSpriteFailed` signal.

## The activation beat

New component state:

- `petAnim = signal<'attack' | 'defend' | null>(null)` — drives the sidekick's
  CSS animation class.
- `petPop = signal<{ text: string; kind: 'dmg' | 'block' } | null>(null)` —
  the companion's own popover, positioned near the sidekick (separate from the
  main `pop` so both can be on screen and the pet's text sits by the pet).

In `animateEntry`, branch when `e.pet` is set:

- **`e.pet === 'attack'`** (carries `dmg`, target = the foe): set
  `petAnim('attack')`, apply the foe's existing red flash + HP drop, and set
  `petPop({ text: '-' + e.dmg, kind: 'dmg' })` labelled *Follow-up!*. Suppress
  the old paw-glyph main-`pop` for this entry so the pet's popover is the single
  source of the message.
- **`e.pet === 'defend'`** (carries `deflect`, `by` = player): set
  `petAnim('defend')` and `petPop({ text: 'Blocked ' + e.deflect + '!',
  kind: 'block' })`. No HP change (a deflect is prevented damage). Replaces the
  current `"Block!"` main-`pop`.

Sequencer (`runSequence`): give a `pet` entry a slightly larger lead gap than a
normal effect and hold `petAnim` ~650ms before clearing, so the beat is its own
readable moment rather than blurring into the main exchange. Clear
`petAnim` / `petPop` in the round-settle beat and via their own reset timers,
alongside the existing `struck` / `pop` resets.

## CSS

In [interactive-battle.component.scss](../src/app/undercity/tabs/interactive-battle.component.scss):

- `.companion` base: absolute within the attacker `.side`, fixed small box,
  pixelated, z-ordered above the platform but below the `dmg-pop`.
- `@keyframes uc-pet-bob` — subtle idle up/down.
- `.companion.lunge` — quick `translateX` toward the foe and back (~500ms),
  optional slight scale-up on the strike frame.
- `.companion.block` — hop up + scale, paired with a brief shield-flash overlay
  reusing the existing `.barrier` motif (or a small `shield` glyph).
- `.pet-pop` — popover styled like `.dmg-pop`; a `block` variant tinted like the
  existing `miss`/ward pops, a `dmg` variant like a damage pop, each carrying a
  short label ("Follow-up!" / "Blocked").

## Non-goals / out of scope

- No enemy companions.
- No changes to forage/scout/economy pets in combat (they don't appear).
- No server, engine, balance, or `CombatEntry` shape changes.
- No new sprites — uses the existing `public/undercity/pets/<role>/<species>.png`.

## Testing / verification

- No unit-test runner is wired up in this repo — verify with a full
  `npm run build` (must stay green).
- Drive a real fight via the **run-undercity** skill with an `attack` or
  `defend` pet equipped and set active. Triggers are chance-based, so it may
  take several rounds to observe both a follow-up and a deflect. Confirm: the
  sidekick is present from the entrance, lunges on a follow-up with a
  `Follow-up! −N` pop, and hops/blocks on a deflect with a `Blocked N!` pop,
  each in its own readable beat.
- A deploy is required to see it on the live site (handled by the user).
