# Undercity — Plaza Economy (umbrella)

**Date:** 2026-07-20
**Status:** Scope agreed; sub-specs in progress
**Type:** Umbrella / index — coordinates several sub-specs, each with its own
spec → plan → implementation cycle.

## The vision

Progression dies after one good find: you equip it, clap every fight, and there's
nothing to strive toward. The root causes and the fixes span several systems, so
this initiative treats them as one coherent arc:

- Make gear **legible** and make rarity **mean something** (stronger effects, not
  just bigger stats).
- Change the **loot lifecycle** from auto-mulch to a real choice (equip / keep /
  salvage / sell).
- Give the Plaza — today a purely-social hub — a **services layer** of buildings
  that let you *invest* toward the build you want: salvage, upgrade, and (later)
  trade.

North star: **every find is a starting point you build on, and there's always a
next thing to strive for**, gated so combat stays tested as you climb.

## Sub-specs

| # | Spec | Scope | Status |
|---|---|---|---|
| 1 | [Gear Rarity & Scaling](2026-07-20-undercity-gear-rarity-design.md) | Rarity legibility (Common/Rare/Legendary), rider magnitude that scales per rarity, full effect-family ladders (~28 new pieces), `GEAR_FAMILY` index | Draft |
| 2 | [Forge Economy](2026-07-20-undercity-forge-economy-design.md) | Capped gear stash, new loot lifecycle, two-tier materials, **Salvage Yard** + **Blacksmith** Plaza buildings | Draft |
| 3 | Player Market | Priced player-to-player marketplace (list at a set Spore price; co-players buy; seller paid). Evolve-vs-add-alongside the existing barter Trading Post to be decided in this spec | Deferred |
| 4 | Bounty Board | Rotating directed objectives paying Spores/materials/renown — directed "strive-for" goals + a controlled material faucet | Deferred |

Dependency order: 1 → 2; 3 and 4 are largely independent and can slot in later.

## Decisions locked (2026-07-20 brainstorm)

- **Rarity = the existing `tier`**, surfaced as Common/Rare/Legendary; effects scale
  via a single `RIDER_SCALE` table; existing 20 pieces are untouched, ~28 rungs
  filled in.
- **Loot holding:** a **small capped gear stash** (start 6), not decide-at-pickup and
  not an unbounded inventory.
- **Materials:** **two tiers** — common (Moltings) from any salvage; rare (Chrysalis
  Ichor) from Legendary salvage / deep drops. Ichor gates the top upgrade rung.
- **Blacksmith:** **upgrade-only** (climb rungs, same rider) — no rider reforge.
- **Salvage Yard:** grind gear → materials, or sell → Spores (preserves the Spore
  faucet lost by removing auto-mulch).
- **Buildings live in the Plaza** as modal-opening services (MVP), diegetic sprites
  later.
- **Player Market + Bounty Board deferred** to their own specs.

## Non-goals (initiative-wide)

- No new riders or combat mechanics; no random-roll/affix loot.
- No enemy-scaling / NG+ treadmill — the fixed zone difficulty ramp (overworld →
  wilderness → deep dungeons → Savra) does the difficulty work.
