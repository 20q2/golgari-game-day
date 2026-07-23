# Undercity — "Why is this greyed out?" reason lines, game-wide

**Date:** 2026-07-23
**Status:** Design approved, pending implementation plan

## Problem

Players reported being "unable to go to the marketplace" and that "entries are
greyed out." Investigation traced the real issue: in the Plaza **Player Market**,
a listing's **Buy** button is greyed by `canBuy()`
([plaza-tab.component.ts](../src/app/undercity/tabs/plaza-tab.component.ts)) when
the player **can't afford it** or the **destination inventory is full** — but the
Market shows **no reason at all**. A greyed button with no explanation reads as
"broken / I can't get in."

This is not a logic bug — the predicates are working as designed. The gap is
**feedback**. And it is not unique to the Market: disabled buttons across the
whole game (shop, shrine, trade, blacksmith, witch, roll, blink, spell-cast) are
silent about *why*.

## Goal

**Every meaningful disabled action states why it's disabled**, game-wide, with
one consistent pattern and consistent wording. The button's own label (crucially,
the **price**) stays visible — the reason is additive, never a replacement.

`busy()` (an in-flight request) is explicitly **excluded** — it is transient and
carries no actionable reason; those buttons stay silently disabled for the
moment the request is in flight.

## Approach

**Reason-returning helpers.** Each disable predicate becomes (or gains) a function
returning `string | null`: `null` = allowed, a non-empty string = the reason. The
template disables on `busy() || !!reason(...)` and renders the reason below the
row when present.

Rejected alternatives:
- **Generic `<uc-block-reason>` component** — the reason must still be computed
  per button, so the component saves DOM boilerplate but not the real work; not
  worth the scaffolding.
- **Single `actionBlock(type, ctx)` dispatcher** — the predicates are too
  heterogeneous (afford vs. cooldown vs. trade eligibility vs. inscribe state) to
  collapse into one switch without a tangle.

Where an existing `can*` boolean is also used for non-display guards (e.g.
`canInscribe()` gating the `inscribe()` handler), it is redefined as
`reasonFn(...) === null` so the display reason and the guard can never drift
apart. One source of truth per predicate.

## 1. Shared reason helper (new file)

`src/app/undercity/data/block-reasons.ts` — pure, dependency-free functions so
the board and plaza tabs phrase identical blockers identically:

```ts
// Spores you can't afford. `have` is your current balance.
affordReason(have: number, cost: number): string | null
  // → 'Not enough Spores (you have 80)'  |  null

// A destination inventory is full. label e.g. 'Stash', 'Bag', 'Scroll satchel'.
containerFullReason(len: number, cap: number, label: string): string | null
  // → 'Stash full — make room first'  |  null

// A cooldown in whole minutes. verb 'Recharging' (blink) | 'On cooldown' (spell).
cooldownReason(minsLeft: number, verb: string): string | null
  // → 'Recharging (2m)'  |  null

// Crafting materials shortfall (Blacksmith). Itemizes what's short.
materialReason(haveMoltings: number, haveIchor: number,
               needMoltings: number, needIchor: number): string | null
  // → 'Need 2 ichor'  |  'Need 1 molting, 2 ichor'  |  null
```

These have no framework deps and no test runner exists for the frontend (per
CLAUDE.md), so they are verified by production build + manual play.

## 2. Per-surface reason functions

Each returns the **first** applicable blocker (priority order matters — the most
useful thing to tell the player first):

| Surface | File | Reason (in priority order) |
|---|---|---|
| Market buy (`canBuy`) | plaza `.ts` | destination-full (by kind) → can't afford |
| Blacksmith upgrade | plaza `.ts` | can't afford Spores → missing material |
| Shop gear buy | board `.ts` | out of stock → stash full → can't afford |
| Shop consumable buy | board `.ts` | out of stock → can't afford |
| Grimoire buy | board `.ts` | already owned → can't afford |
| Shrine bless (`canBless`) | board `.ts` | can't afford (`SHRINE_COST`) |
| Trade (`canTradeFor`) | board `.ts` | nothing eligible to give / pick an item |
| Witch inscribe (`canInscribe`) | board `.ts` | pick a scroll + book → already in this book → book full, pick one to overwrite |
| Roll | board `.html` | 'No rolls left' (when `rollsBanked() < 1`, non-debug) |
| Blink | board `.ts` | 'Recharging (Xm)' (`blinkCooldown`) |
| Spell cast (`spellReady`) | board `.ts` | 'On cooldown (Xm)' (`cooldownLeftMin`) |

Notes:
- **Market buy** destination cap is by kind: gear→`gearStash`/6,
  consumable→`bag`/3, scroll→`scrolls`/6 (same mapping `canBuy` already uses).
- **Market buy** never shows a reason for *own* listings — those render a
  **Cancel** button, not Buy, so they are out of scope.
- **Blacksmith upgrade** cost is `{spores, moltings, ichor}`; the reason
  distinguishes a Spore shortfall from a material shortfall.
- **Shop gear** keeps its existing full-list `.shop-warn` "Stash full" banner
  (line ~427); the per-button reason is additive and consistent with it. If the
  banner and per-button line feel redundant during review, drop the banner in
  favor of the per-button line — decided at implementation, banner removal is not
  required by this spec.

## 3. Template pattern

Applied at each covered button. The price/label stays on the button; the reason
is a full-width muted line rendered **below the row** (matching the existing
`.shop-warn` placement, most robust on narrow phones):

```html
<button class="uc-btn forge-upgrade"
        [disabled]="busy() || !!buyReason(l)" (click)="marketBuy(l.id)">
  {{ l.price }}<img class="rot-coin" src="undercity/icons/rot.png" alt="Spores" />
</button>
@if (!busy() && buyReason(l); as r) {
  <span class="block-reason">{{ r }}</span>
}
```

The `!busy()` guard on the reason keeps the line from flickering during an
in-flight request (button disabled, but no reason shown).

## 4. Styling

One shared rule, `.block-reason`, added to both component SCSS files (identical
declaration; a shared partial is optional and not required):

- muted color (`--text-secondary` or the existing `.shop-warn` color token)
- small font, full row width, a little top margin
- mirrors `.shop-warn` so the game already has visual precedent

## Wording (default — overridable at review)

Plain-but-warm: clear first, lightly themed. Proposed strings:
- `Not enough Spores (you have {n})`
- `Stash full — make room first` / `Bag full — make room first` /
  `Scroll satchel full — make room first`
- `No rolls left`
- `Already owned`
- `Recharging ({m}m)` / `On cooldown ({m}m)`
- `Need {n} ichor` / `Need {n} moltings` / `Need {a} moltings, {b} ichor`
- `Pick a scroll and a book` / `Already in this book` /
  `Book full — pick one to overwrite`
- Trade: `Nothing to trade for this` / `Pick something to give`

## Scope / invariants

- **No backend changes.** This only surfaces *why* the existing client
  predicates block; server rules are untouched.
- **No new balance numbers.** Reuses existing costs, caps, and cooldown data.
- **Price always stays on the button** (explicit user requirement — the reason
  never replaces it).
- **`busy()` stays silent** — transient, no reason line.
- Own market listings (Cancel) and always-enabled buttons are untouched.
```
