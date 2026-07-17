# Undercity modal containment + tab navigation while a popup is open

## Problem

Every popup in the Undercity board tab (Bazaar, Trading Post, Shrine,
Ossuary, Crystal Vein, Guildvault, Excavation, warp picker, spell pickers,
space-landing event cards, the away-catchup digest) shares one CSS class,
`.uc-modal-backdrop`, which is `position: fixed; inset: 0`. That covers the
*entire browser viewport* — including the Undercity tab bar (Board / Creature
/ Plaza / Log) and even the site's navbar above the game. Concretely: while
standing at the Bazaar deciding whether to buy gear, there is no way to flip
to the Creature tab to check current stats/equipment, because the tab bar is
visually and functionally buried under the modal.

Worse, even if the tab bar were reachable, switching tabs today destroys
`BoardTabComponent` (Angular's `@switch` tears down the inactive branch), and
with it every local signal driving modal visibility. Returning to the Board
tab would show a clean map with no memory that a facility was open.

## Goals

- Contain every popup to the game's play area (between the HUD header and
  the tab bar), so the tab bar is never covered and stays clickable without
  needing to close anything first.
- Let a player freely visit Creature / Plaza / Log while a facility/decision
  modal is open, then return to Board and find it exactly as they left it.
- Don't let a player leave mid-battle to swap gear or level up — combat
  locks the tab bar until it resolves.

## Non-goals

- No change to which events/facilities exist or how their game logic works.
- No restoration for the spell-target/value/boss picker flow, plain
  space-landing event cards, the away-catchup digest, or the mystery-reveal
  reel — these still get the containment fix, but simply close (no memory)
  when you navigate away. They're either purely informational (nothing to
  resume) or an in-progress commit in the same spirit as combat.

## Design

### 1. Containment (`board-tab.component.scss`)

`.uc-modal-backdrop` changes from `position: fixed; inset: 0` to
`position: absolute; inset: 0`. Since board-tab's template root
(`.board-tab`) is itself `position: absolute; inset: 0` inside
`.tab-body` (`undercity-page.component.scss`'s `.tab-body { position:
relative; overflow: hidden }`), the backdrop's new `absolute` positioning
resolves against `.tab-body` — the play area between the HUD and the tab
bar. No z-index changes are needed: the tab bar is a sibling of `.tab-body`
in the page template, outside the modal's containing block entirely, so
it's never in the same paint region as the backdrop.

`.uc-modal`'s `max-height: 80vh` becomes `max-height: 90%` — `80vh`
measures the full viewport, which is now larger than the shorter
`.tab-body` region the modal actually lives in; `90%` keeps it relative to
its real container.

This is a two-line CSS change and applies uniformly to every modal, since
they all share `.uc-modal-backdrop`.

### 2. Battle lock (`undercity-page.component.ts` / `.html`)

Combat already has a server-tracked resume signal,
`UndercityStateService.pendingBattle()` (a computed reading
`store.you()?.battle`), independent of which tab is mounted — it's how a
page reload already resumes an in-progress fight today
(`board-tab.component.ts:520-523`).

Add `protected readonly inBattle = computed(() => !!this.store.pendingBattle());`
to `UndercityPageComponent`. Bind `[disabled]="inBattle()"` on the
Creature/Plaza/Log tab buttons in `undercity-page.component.html` (Board
stays enabled — that's where the battle lives). No new state plumbing: this
reuses a signal that already exists and already survives tab switches.

### 3. Facility-modal state restoration

**New service state** (`undercity-state.service.ts`):

```typescript
export type FacilityKind =
  | 'shop' | 'shrine' | 'ossuary' | 'tradingPost'
  | 'excavation' | 'vein' | 'vault' | 'warp';

readonly openFacility = signal<{ kind: FacilityKind; warpOptions?: string[] } | null>(null);
```

This covers the 8 modals that represent a real decision point: Bazaar,
Trading Post, Shrine, Ossuary, Excavation, Crystal Vein, Guildvault, and the
warp picker.

**On open:** each opener (`openTradingPost`, `openExcavation`, `openVein`,
`openVault`, plus the inline `shop`/`shrine`/`ossuary`/`warp` branches in
`resolveSpaceEvent`) additionally calls
`this.store.openFacility.set({ kind: '<kind>' })` (warp also carries
`warpOptions`, the one payload that isn't re-derivable from a store
computed signal).

**On close:** `closeFacilities()` — already the single chokepoint every
"Leave"/close button routes through — additionally calls
`this.store.openFacility.set(null)`. `shrine()`'s current direct
`this.showShrine.set(false)` is replaced with a call to `closeFacilities()`
for consistency (Shrine has no other local state to reset, so this is a
behavior-neutral cleanup, not a functional change).

**On board-tab (re)construction:** a new block in the constructor checks
`this.store.openFacility()`; if set, it re-invokes the matching opener with
no override args (`openTradingPost()`, `openVein()`, `openVault()`,
`openExcavation()`, or the shop/shrine/ossuary/warp equivalents), which
re-derive fresh data from the store's already-persistent computed signals
(`store.tradingPosts()`, `store.veins()`, `store.vaults()`,
`store.excavations()`, `store.bazaars()`) exactly the way a landing event
does today. This mirrors the existing `pendingBattle` resume pattern
(`board-tab.component.ts:518-523`) rather than introducing a new mechanism.

The Bazaar's sub-tab selection (`shopTab: 'gear' | 'consumables' |
'grimoires'`) is small enough not to warrant its own service signal; it's
folded into the `openFacility` payload as an optional field and set/read
alongside `kind`.

## Files touched

- `src/app/undercity/tabs/board-tab.component.scss` — containment fix (2 rules).
- `src/app/undercity/services/undercity-state.service.ts` — add `FacilityKind` + `openFacility` signal.
- `src/app/undercity/tabs/board-tab.component.ts` — openers write `openFacility`; `closeFacilities()` clears it; `shrine()` routes through `closeFacilities()`; constructor gains a restore block.
- `src/app/undercity/undercity-page.component.ts` — add `inBattle` computed.
- `src/app/undercity/undercity-page.component.html` — bind `[disabled]="inBattle()"` on the three non-Board tab buttons.
