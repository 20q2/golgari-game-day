# Undercity — New-Player Onboarding & Renown-Shop Clarity

- **Date:** 2026-07-21
- **Status:** Design (approved in brainstorming; pending spec review)
- **Scope:** Frontend only (`src/app/undercity/`). No Lambda/engine/economy changes.

## Problem

Two playtest complaints, one root cause:

1. New players don't know what to do.
2. The Renown shop is confusing — "you can't undo a purchase after tapping."

Walking the flow as a first-timer: tap egg ×3 → **pick a creature** (four stat lines, a
passive, an evolution tree — irreversible) → **pick a biome** (a permanent perk like
"+2 DEF vs wild creatures" — good or bad? no basis to judge) → name it → **spend 50
Renown** in a shop on things whose value is unknowable → **spawn** onto a board with no
stated goal.

The two complaints are the same disease: **the onboarding demands three irreversible,
high-agency decisions before giving the player any model of how the game plays.** You are
asked to optimize a build before you know what a build does. The shop is where it hurts
most because there, tapping *also* feels like spending money you can't get back.

Notably, the Renown shop is **already a cart** — `toggleHat`/`togglePaint`/`toggleItem`
in [hatch-flow.component.ts](../src/app/undercity/hatch/hatch-flow.component.ts) only
mutate local `cart*` signals; nothing is spent until the `join` action fires on "Spawn
into the world," and re-tapping removes an item. So "can't undo" is a **perception bug**,
not a logic bug. There is no visible cart *object*: you tap, the card highlights, the
balance number at the top ticks down, and it reads as an irreversible debit.

The game also has a real narrative spine that is invisible until stumbled into: the Swarm
Queen (Savra) sleeps behind a sealed gate; the five biome-lair bosses each hold a **Guild
Sigil**; collect **3** (`SIGILS_REQUIRED`) to unseal her; most Renown by dawn is crowned
champion. This goal is celebrated *on delivery* (the sunburst "Guild Sigil claimed" modal
in [board-tab.component.html](../src/app/undercity/tabs/board-tab.component.html)) but is
never stated up front and has **no persistent tracker** — the HUD never mentions sigils.

## Design principle

> **Every front-loaded choice ships with a good default.**
> Novice path = accept the defaults and flow. Expert path = override.

This *shrinks* the work versus bolting explanatory UI onto every step, and it preserves
the game's roguelike "no takebacks" identity: the choices stay irreversible; we only make
the safe path obvious. A short, skippable cutscene supplies the missing *why*; a single
coach-mark supplies the residual *how*.

## Non-goals / guardrails

- **No engine or economy changes.** `SHOP_START_RENOWN` stays 50; the `join` action, its
  payload, and all balance tables are untouched. Backend pytest suite is unaffected.
- **Irreversibility stays.** Creature / biome / name remain permanent for the night. We
  are not adding undo to those — only making a novice-safe default prominent.
- **No new art pipeline.** Everything reuses in-repo assets (guardian PNGs, gate
  background, Material seal icon). The Queen is a CSS silhouette — no dependency on Savra
  art existing.
- **Onboarding is per-device**, keyed off `localStorage`, matching the existing anonymous
  identity model (`generateUserId` / `getUserName`). A returning player never re-sees it;
  a player on a fresh device sees it once. Acceptable, low-frequency.
- **No server-side "has this user onboarded" state.** UI-only.

## The six moves

Ordered along the player's path. Each is low-cost and additive.

### 1 · Sigil-guardians cutscene (the *why* + handoff to the first *how*)

A new standalone `IntroCutsceneComponent` plays **once**, at the top of the hatch flow,
before the egg. Still panels, cross-fading; **Skip** always visible; tap or auto-advance
(~4 s) between panels. Finishing or skipping sets `localStorage['uc.introSeen']`.

| Panel | Visual (all in-repo) | Narration |
|---|---|---|
| 1 | `undercity/gate_background.png` dimmed; a shadowed silhouette behind a sealed gate (CSS) | "Beneath the game table, the Swarm Queen sleeps behind a sealed gate." |
| 2 | Row of the 5 biome-lair guardian portraits (`undercity/guardians/<id>.png`: `ishkanah`, `sarulf`, `gitrog_monster`, `skullbriar`, `slimefoot`) | "Her guardians hold the Guild Sigils." |
| 3 | Three gold **`workspace_premium`** seals igniting (the Guild-Sigil vocabulary — see Correctness) | "Claim three, and the gate opens. Grow the biggest legend by dawn to be crowned." |
| 4 | A single waiting egg | "But first — you're still in your shell. **Tap to crack it.**" → dissolves into the egg screen |

Panel 4 *is* the handoff: the cutscene ends by naming the first mechanic, so "what do I
do?" is answered before the player even hatches.

- **Where it renders:** inside `HatchFlowComponent`, as the first gate. A `showIntro`
  signal is initialized from `localStorage['uc.introSeen']`. Template becomes
  `@if (showIntro()) { <app-undercity-intro-cutscene (done)="dismissIntro()" /> } @else { …existing egg/starter/… }`.
  Rendering it here (not at the page level) keeps all onboarding in the hatch feature and
  keeps the page component a thin phase switch.
- **Component shape:** self-contained. `PANELS` data array; `index` signal; `next()`,
  `skip()`, and an auto-advance `setTimeout` cleared in `ngOnDestroy` and on every manual
  advance. `@Output() done`. `OnPush`.
- **Art safety:** if a guardian PNG is missing, fall back to the existing placeholder
  convention (`GUARDIAN_PLACEHOLDER_SPRITE` in [items.ts](../src/app/undercity/data/items.ts));
  panel 2 degrades to whatever portraits load. Panels 1/3/4 depend only on the gate image
  and a Material icon, which are guaranteed present.

### 2 · Creature — reposition **Bravery** as the default

The existing **Bravery** card ("let fate choose your creature, +1 roll") is already the
lowest-stress, *rewarded* option — but its copy frames it as the scariest ("you don't get
to choose what climbs out"). Re-aim it for newcomers:

- New blurb: *"Not sure? Let the swarm choose your hatchling — and take a bonus roll for
  the nerve."*
- For first-timers only (i.e. `showIntro` was true on this hatch), render the Bravery card
  **first** in the starter grid and add a badge: **"First time? Start here."** Veterans see
  the card in its current position with its normal styling. Drive this with a `firstHatch`
  signal on `HatchFlowComponent` (captured from `!introSeen` at construction, before the
  flag is set).
- **No mechanic change** — still a random starter + the server-side `bravery` bonus roll.

### 3 · Biome — a safe first home

Add a small **"Good first home"** tag to the **City Rat** biome card (`city`, "+15
Spores" — the most legible perk). Advisory only, shown to everyone; no logic change.

### 4 · Renown shop — basket, not vending machine

All changes live in [hatch-flow.component.html](../src/app/undercity/hatch/hatch-flow.component.html)
/ `.ts` / `.scss`. The cart logic is untouched; this is presentation + one helper.

- **Reorder for priority.** Render **Starter items** (power) first, then **Colors** and
  **Hats** under a single **"Looks — optional"** heading. Signals that items matter and
  cosmetics are optional. (Currently the order is Colors, Hats, Items.)
- **Recommended kit** — a one-tap button that fills the cart with a sensible default:
  **Rusted Fang (25) + Chitin Scrap (25) = 50**, a balanced offense+defense combat start
  that spends the whole budget cleanly with no stranded Renown and uses zero consumable
  bag slots (both are `gear`). New method `fillRecommendedKit()` sets
  `cartItems = ['rusted_fang', 'chitin_scrap']`. *(Tunable — see Knobs.)*
- **Clear** — a button shown whenever the cart is non-empty; resets `cartItems`,
  `cartHats`, `cartPaints`, `equipHat`, `equipPaint` to empty/null.
- **Explicit remove affordance.** Carted cards gain visible text
  **"In cart · tap to remove"** (items, hats, and paints), replacing the current
  colour-only `.carted` cue.
- **Reframe the wallet as a preview, not a debit.** When the cart is non-empty, the
  balance line reads **"Spending {cartCost} · {remaining} left"** and the confirm button
  reads **"Spawn — spend {cartCost} Renown."** When empty: **"50 Renown to spend"** and
  **"Spawn into the world →"** (unchanged).

The pre-filled, removable cart answers the original complaint *by demonstration*: you
learn the cart is editable by editing it, so tapping never reads as a point of no return.

### 5 · First-turn coach-mark (the residual *how*)

A single dismissible pill anchored at the board's `roll-strip`:
**"New here? Tap Roll to take your first turn."**

- **Why just Roll:** the board's Roll button is the unambiguous first action, and once
  rolled the game *already* pins reachable-space popovers while you walk the roll
  ([board-tab.component.ts:1097](../src/app/undercity/tabs/board-tab.component.ts#L1097)).
  The only uncoached step is the initial roll.
- **Show while** `!localStorage['uc.coachSeen']`, on the board tab.
- **Dismiss** (and set `uc.coachSeen`) on the first invocation of `roll()`
  ([board-tab.component.ts:822](../src/app/undercity/tabs/board-tab.component.ts#L822)),
  or when the player taps the pill's close.
- A fresh spawn always has ≥1 banked roll (Bravery grants +1), so the Roll button the pill
  points at is enabled.

### 6 · Persistent Guild-Sigil tracker

A compact HUD chip beside the Rolls/Spores chips in
[undercity-page.component.html](../src/app/undercity/undercity-page.component.html)
(`hud-stats`):

- Renders `store.you()?.sigils ?? 0` over `SIGILS_REQUIRED` — e.g. a gold
  `workspace_premium` seal + **"n/3."**
- Shown from turn 1 (even at 0/3) so the cutscene's goal stays visible between plant and
  payoff.
- Tooltip: *"Claim Guild Sigils from lair bosses to unseal the Queen."*
- No new state: `sigils` already exists on the player model
  ([undercity-models.ts:36](../src/app/undercity/services/undercity-models.ts#L36)).

## Architecture & files

**New file**

- `src/app/undercity/hatch/intro-cutscene.component.ts` — standalone `OnPush` component,
  inline template + styles, `PANELS` data, `@Output() done`. Depends on `MatIconModule`
  and the guardian-PNG path convention.

**Edited files**

| File | Change |
|---|---|
| `hatch/hatch-flow.component.ts` | `showIntro` + `firstHatch` signals from `localStorage`; `dismissIntro()`; `fillRecommendedKit()`; `clearCart()`; import + render the cutscene. |
| `hatch/hatch-flow.component.html` | Cutscene gate; Bravery-first + badge (first-timers); "Good first home" tag; shop reorder; Recommended-kit/Clear buttons; carted "tap to remove" text; reframed balance line + confirm button. |
| `hatch/hatch-flow.component.scss` | Styles for the badges, "Looks — optional" group, kit/clear buttons, carted tag. |
| `tabs/board-tab.component.{ts,html,scss}` | Coach-mark pill at the `roll-strip`; dismiss + flag on first `roll()`. |
| `undercity-page.component.{html,scss}` | HUD Guild-Sigil chip. |

## `localStorage` contract

| Key | Set when | Gates |
|---|---|---|
| `uc.introSeen` | Cutscene finished or skipped | The cutscene (move 1) and the Bravery-first treatment (move 2) |
| `uc.coachSeen` | First `roll()` or pill dismissed | The board coach-mark (move 5) |

Clearing both keys and reloading replays the entire onboarding — the dev/QA reset.

## Correctness notes

- **Two distinct "sigil" systems — do not conflate.** *Guild Sigils* (this feature: the
  boss gate, `player.sigils`, per-biome lair kills, `SIGILS_REQUIRED = 3`) are visualized
  as the gold `workspace_premium` **seal**, matching the existing claim celebration. The
  `app-sigil-icon` component renders the *Guildvault* keypad glyphs
  (spore/bone/web/moss/skull/beetle) — a **different** puzzle at the `vault_lock` space.
  The cutscene (panel 3) and the HUD tracker use the **seal**, never `app-sigil-icon`.
- **Lair count:** exactly the **5 biome lairs** hold Guild Sigils (`city`, `cavern`,
  `bog`, `bone`, `garden`). `lair_titan` (Lord of Extinction) is side content and is **not**
  a sigil holder — it is excluded from the cutscene's guardian row.
- **Cart guards preserved:** `fillRecommendedKit()` picks two `gear` items, so the existing
  `BAG_SIZE`/`cartBagCount` consumable guard and the `canAfford` checks remain satisfied
  (25 + 25 = 50 = full budget).

## Verification

No frontend test runner exists (per CLAUDE.md — Karma/Jasmine removed). Nothing here
touches the Lambda, so the Python pytest suite is unaffected and stays green (run it once
to confirm). Verify the feature via:

1. `npm run build` — must succeed (the project's real gate; lint is known-broken).
2. Manual walk with `uc.introSeen` / `uc.coachSeen` cleared:
   - Cutscene plays, auto-advances, **Skip** works, panel 4 dissolves into the egg.
   - Reload → cutscene does **not** replay (flag honored).
   - First-timer sees Bravery-first + "Start here"; the "Good first home" tag shows on City.
   - Shop: items listed first; **Recommended kit** fills Fang+Chitin to exactly 50;
     **Clear** empties it; carted cards read "tap to remove" and re-tapping removes;
     balance line and confirm button reflect the cart.
   - Spawn → board coach-mark points at Roll; tapping **Roll** dismisses it permanently.
   - HUD shows the sigil chip at 0/3 from turn 1; clearing a lair bumps it.

## Tunable knobs / open questions

- **Recommended kit contents** — `rusted_fang + chitin_scrap` (balanced, spends 50). One
  line to change: swap `chitin_scrap` → `healing_moss` (a safety-net kit, 45, leaves 5) or
  `spore_pouch` (economy) if you prefer a different novice lean.
- **Cutscene narration voice** — copy above is a first draft; easy to re-tone.
- **Replay affordance** — a "Watch intro" link on the idle screen is deliberately out of
  scope (YAGNI); add later if wanted.
