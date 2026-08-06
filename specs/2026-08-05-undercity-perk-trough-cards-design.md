# Undercity — Attribute perks as chained stat cards

**Date:** 2026-08-05
**Status:** Design — approved layout, pending spec review
**Area:** Frontend only (`src/app/undercity/tabs/creature-tab.component.{html,scss,ts}`)
**Mockup:** `scratchpad/perk-troughs-mockup.html` (chained-cards / base-gear-breakdown version)

## Problem

The Stats panel currently renders in two stacked blocks:

1. A **stat-tiles** row — three interactive tiles (ATK / DEF / SPD) showing the base
   stat big, a `+N` gear badge, and a `+1` spend button.
2. An **attribute-perks** block below it, laid out as **attribute-rows × threshold-columns**:
   each stat is a row, and its three perks (thresholds 6 / 12 / 18) sit in a
   `repeat(3, 1fr)` grid — a "3-up card row to save vertical space" (per the code comment).

The row layout breaks the vertical relationship between a stat and its perks: the ATK
tile is in one block, the ATK perks in another, and the three perks of a track read as
three unrelated cards rather than a progression. The panel also carries a redundant
"Attribute perks" heading and shows the base stat big while the perk thresholds actually
key off the *effective* stat (base + gear), forcing the player to do the math.

## Goal

Merge the stat tile and its perk track into a single **per-stat card**, so each stat reads
as one column: the stat at the top, its three perks chained beneath it. Make the effective
stat (the number the thresholds compare against) the prominent value, while keeping the
base and gear numbers visible. Preserve every existing interaction.

## Design

### Layout — three chained stat cards

Replace the separate stat-tiles row **and** the attribute-perks block with a single
`repeat(3, 1fr)` grid of three cards, one per stat, in `atk / def / spd` order (matching
`perkTrackOrder`). Each card is a rounded, bordered container with a faint gradient and
drop shadow so the three columns read as three distinct objects.

Each card has two zones:

**Header zone (the stat), with a divider under it:**
- Stat icon (from `statInfo[stat].icon`, `mat-icon` — svg icon or ligature as today).
- **Big bold effective stat** = `trackValue(stat)` (base + gear) — the value the `6/12/18`
  thresholds compare against. This is the number that light up the chain, so it earns the
  emphasis.
- Stat name (`ATK` / `DEF` / `SPD`).
- **Breakdown line**: base in muted grey + gear bonus in accent green, e.g. `20 +2`.
  When gear adds nothing, show just the base (e.g. `4`). Base = `you[stat]`, gear =
  `gearMods()[stat]`.
- A hairline divider (`border-bottom`) separates the header from the chain.

**Chain zone (the perks), 6 → 18 top to bottom:**
- The stat's three perk nodes from `trackNodes(stat)`, rendered **6 at top, 18 at bottom**
  (natural reading order; the current row order is preserved, just stacked).
- Each node: a gold threshold "dot" pill (`6/12/18`), the perk name, the perk blurb.
- **Connector line** between consecutive nodes — a short vertical hairline. It lights
  **accent green** when the node *above* it is unlocked (`node.lit`), dim otherwise, so the
  chain visibly fills from the top as the stat climbs.
- **Lit vs. locked:** unlocked node = full opacity, accent-tinted background, green border,
  solid-gold threshold dot. Locked = dimmed + desaturated (as today), dim-outline dot.

Net effect: ATK 22 is a fully-lit green chain, DEF 11 lights only the first (6) node with
both connectors dim, SPD 4 is a fully dark chain. The card is a self-contained progress
gauge for that stat.

### Preserving interactions (Stats tab)

The header zone **is** the interactive stat tile — it must carry everything the old
`.stat-tile` button did:

- **Tap to learn more:** the header is a `<button>` that calls `selectStat(stat)`; the
  existing `.stat-desc` aside (label + prose description) renders **below the three-card
  grid**, full width, for the open stat. `[class.active]` highlights the open card.
  The base/gear/total breakdown that the aside shows today (`.stat-breakdown`) is now
  redundant with the header breakdown line — drop it from the aside, keep the prose.
- **Spend a point:** when `you.statPoints > 0`, the `+1` `plus-btn` appears in the header
  corner (`spendStat(stat)` with `$event.stopPropagation()` so it doesn't also open the
  aside), and the `{{ statPoints }} to spend` chip stays in the section `<h3>`.
- **Roll animation:** the `rolling` / `roll-out` / `roll-in` / `stat-pop` treatment and the
  `[class.celebrate]` state move onto the header's big number, so a stat increase still
  animates. Because the big number is now the *effective* stat, the roll animates the total.
- **`busy()` disabled state** on the spend button carries over unchanged.

### Evolution screen

The same component renders the "EVOLUTION AWAITS — choose your form" panel. It uses the
same stats/perks markup, so the new cards apply there too with no separate work. Spend/roll
affordances only appear when their conditions hold (`statPoints > 0`, `rollStat()`), so the
evolution view degrades to a clean read-only card set automatically.

## Non-goals

- No backend or balance changes. `trackValue`, `trackNodes`, `gearMods`, `perk_stat` and the
  perk data are unchanged — this is purely presentation.
- No change to the Traits block below the perks, or to the Sigils / Wardrobe sub-tabs.
- Not touching perk *definitions* (names, blurbs, thresholds) in `data/perks.ts`.

## Risks / tradeoffs

- **Taller panel.** Three stacked perk cards per column are taller than three short rows.
  Mitigated by slim node padding and tight type; blurbs stay full but compact. On the
  narrowest phones this is the main thing to eyeball when we verify in-browser.
- **Header does double duty** (display + button + spend + roll). The old tile already did
  all this, so it's a re-style, not new behavior — but the `+1` button and roll animation
  need re-testing in their new position.
- **Locked-node density.** All three blurbs always render. If cards feel cramped, a cheap
  follow-up is to hide locked nodes' blurbs (name + threshold only) until unlocked — noted
  as a future option, not in scope here.

## Verification

Per the `run-undercity` skill: dev server against the live AWS backend, reach a creature
with mixed perk state (some tracks over 6/12/18, some under) on both the **Stats tab** and
the **evolution screen**, and confirm: effective number + breakdown correct, chain lights
match unlocked perks, tap-to-learn aside opens, `+1` spend works when points are available,
and the roll animation fires on a stat increase.
