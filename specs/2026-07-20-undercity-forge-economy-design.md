# Undercity — Forge Economy (gear stash · Salvage Yard · Blacksmith)

**Date:** 2026-07-20
**Status:** Draft, pending user review
**Part of:** [Plaza Economy umbrella](2026-07-20-undercity-plaza-economy-umbrella.md)
**Depends on:** [Gear Rarity & Scaling](2026-07-20-undercity-gear-rarity-design.md)
(the rarity ladder + `GEAR_FAMILY` index this spec climbs).

## Problem

Found gear is **mulched the moment you find it**: [`_roll_gear_drop`](../infrastructure/lambda/undercity_db.py#L519)
either auto-equips a strict-tier upgrade or instantly salvages the rest to Spores.
The player never chooses. The result — voiced directly in playtest — is that once
you find one piece you like, *there's nothing to strive toward and you clap every
fight.* A good find is an endpoint, not a starting point.

We want the loot lifecycle to become a **decision** ("equip / keep / salvage"), and
we want a reason to keep fighting after the first good find: a **materials economy**
that lets you invest in climbing the piece you love up its rarity ladder. Two Plaza
buildings service that loop.

## Goal

Turn the Plaza from a purely-social hub into a **services layer** with two buildings,
backed by a small gear stash and a two-tier materials economy:

1. **Gear stash** — a small capped hold for gear you aren't wearing, so finds can be
   decided later instead of auto-mulched.
2. **Salvage Yard** — grind unwanted gear into crafting materials (or sell it for
   Spores). The material *faucet*.
3. **Blacksmith** — spend Spores + materials to upgrade an owned piece up its
   family's rarity rungs (Common→Rare→Legendary; same rider, stronger). The material
   *sink* and the answer to "what do I strive for after a good find."

Deferred to their own specs (see umbrella): the **Player Market** (priced player-to-
player sales — the other thing you can do with a stashed piece) and the **Bounty
Board**.

## The loot lifecycle (new)

Replaces the auto-equip/auto-mulch in `_roll_gear_drop`.

```
Find gear ──▶ Gear stash (capped)
                 │
                 ├─▶ Equip           (Creature/Gear tab or stash)
                 ├─▶ Salvage Yard ──▶ materials  ── or ──▶ Spores (sell-back)
                 ├─▶ Blacksmith  ──▶ upgrade (consumes materials + Spores)
                 └─▶ [Player Market — deferred]
```

- On a drop, the piece goes to the **stash** (with a drop-reveal toast showing its
  rarity), rather than auto-equipping/auto-mulching.
- **Stash full on a new find:** surface an immediate choice modal (Equip / Salvage-
  now / Discard) so the find is never silently lost, and the player can also clear
  the stash at the Yard between delves.
- Equipping from the stash swaps the currently-worn piece **back into the stash**
  (no destruction), so experimenting with builds is non-destructive as long as
  there's stash room.

### Gear stash — data & caps

- New per-player, per-season field `gearStash: [gear_id, ...]`, cap
  `GEAR_STASH_SIZE` (start **6**; a config knob). Distinct from the 3-slot
  consumable `bag` and the 3 equipped `gear` slots.
- Persisted in the player doc alongside `gear`/`bag`. Survives death/respawn (it's
  your holdings, not on-board state).
- Client: a **Stash** section in the Gear tab (rarity-badged rows) with per-item
  actions (Equip / send-to-Yard / send-to-Blacksmith).

## Materials — two tiers

Two new inventory materials (not gear, not consumables): counters in the player doc,
shown in the resource header beside Spores.

| Material | Working name | Source | Used for |
|---|---|---|---|
| Common | **Moltings** | Salvaging any gear; small combat drip | Common→Rare upgrades |
| Rare | **Chrysalis Ichor** | Salvaging **Legendary** gear; deep/boss/trove drops | Rare→Legendary upgrades |

- Stored as `materials: {moltings: int, ichor: int}` in the player doc.
- Ichor's scarcity is the **zone gate**: you cannot mint a Legendary without engaging
  deep content (either salvage a found Legendary or farm deep drops). This preserves
  the difficulty ramp the rarity spec relies on.
- Names are placeholders (Golgari decay/fungus theme) — final naming + art is a
  tuning/asset task.

## Salvage Yard (Plaza building)

Converts stashed gear you don't want. Per piece, the player chooses:

- **Grind → materials.** Yield scales with the piece's rarity:
  - Common → `SALVAGE_MOLTINGS[1]` Moltings
  - Rare → `SALVAGE_MOLTINGS[2]` Moltings
  - Legendary → `SALVAGE_MOLTINGS[3]` Moltings **+ 1 Chrysalis Ichor**
- **Sell → Spores.** The existing `GEAR_SELL_BACK` (50% of cost) path, preserved so
  gear is still a Spore faucet with the auto-mulch gone. This is the player's
  "Spores now vs. materials toward an upgrade" decision.

Server: new action `salvage-gear` (stash index, mode ∈ `grind`/`sell`). Validates
the piece is in the stash, removes it, credits materials or Spores. Pure economy — no
combat coupling.

## Blacksmith (Plaza building)

Upgrades an owned piece (equipped **or** stashed) to the next rung of its family,
using the rarity spec's `GEAR_FAMILY[rider][tier+1]` lookup. Same rider, stronger
magnitude + the higher rung's stat line and name.

| Step | Cost |
|---|---|
| Common → Rare | `UPGRADE_SPORES[2]` Spores + `UPGRADE_MOLTINGS[2]` Moltings |
| Rare → Legendary | `UPGRADE_SPORES[3]` Spores + `UPGRADE_ICHOR` Chrysalis Ichor (+ Moltings) |
| Legendary | — (max rung; button disabled) |

- **Upgrade-only** (confirmed): no rider reforge/reroll. Getting a *different* rider
  stays a find/market activity, keeping the loot-hunt meaningful.
- Server: new action `upgrade-gear` (target: an equipped slot or a stash index).
  Validates ownership + a next rung exists + sufficient Spores/materials, debits,
  and swaps the id in-place (equipped slot or stash entry).
- Client: Blacksmith modal listing upgradeable pieces, each with a **before→after**
  preview (rarity pill change, stat delta, scaled effect "Reflect 2 → 3") and the
  cost with a disabled/CTA state when resources are short.

## Plaza buildings — placement & UX

The Plaza is a ported canvas hub ([plaza-tab.component](../src/app/undercity/tabs/plaza-tab.component.ts),
[engine/plaza-canvas.ts](../src/app/undercity/engine/plaza-canvas.ts)) that is
currently purely social.

- **MVP (recommended):** a **Plaza services bar/overlay** with buttons that open the
  Blacksmith and Salvage Yard modals — reusing the board facilities' modal
  patterns (`modal-art` header, `shop-row`/`shop-section` styles) for visual
  consistency. No canvas engine work.
- **Later polish:** place tappable building sprites on the plaza canvas (hit-testing
  in `plaza-canvas.ts`) so the buildings are diegetic. Flagged, not required for v1.

## Files to touch

**Backend ([infrastructure/lambda/](../infrastructure/lambda/)):**
- `undercity_data.py` / `undercity_config.py` — `GEAR_STASH_SIZE`, materials model,
  `SALVAGE_MOLTINGS`, `UPGRADE_SPORES`/`UPGRADE_MOLTINGS`/`UPGRADE_ICHOR` knobs;
  Ichor/Moltings drop hooks on deep sources.
- `undercity_db.py` — rewrite `_roll_gear_drop` to route to the stash + drop-reveal
  (no auto-mulch); new actions `salvage-gear` and `upgrade-gear`; material granting;
  stash-full handling.
- `lambda_function.py` — route the two new actions (existing dispatcher).
- `tests/` — stash add/cap/overflow; salvage grind vs sell (incl. Legendary→Ichor);
  upgrade happy path, insufficient resources, no-next-rung; drop-to-stash flow. Keep
  the full suite green.

**Client ([src/app/undercity/](../src/app/undercity/)):**
- Gear tab — Stash section with per-item actions; materials in the resource header.
- New Blacksmith + Salvage Yard modals (Plaza services bar to open them).
- The action service — `salvage-gear` / `upgrade-gear` calls; drop-reveal shows
  "sent to stash."
- `items.ts` / data mirrors — material display metadata; cost mirrors.

## Balance & invariants

- Upgrading never exceeds a found Legendary's power (same rung table as drops) — the
  Blacksmith is a *deterministic path to the same ceiling*, not a higher one.
- Ichor scarcity gates the top rung to deep-content engagement.
- Removing auto-mulch reduces passive Spore income; the Yard's sell-back mode and
  tuned salvage yields keep the Spore economy whole (validate against current
  earn/spend rates).
- No combat coupling — all three systems are pure economy/inventory.

## Testing

- `cd infrastructure/lambda && python -m pytest tests -q` — green incl. new
  stash/salvage/upgrade tests.
- `npm run build` — client compiles (repo lint is known-broken; verify via build).
- Manual: find gear → lands in stash with rarity badge; grind a Common for Moltings;
  grind a Legendary for Ichor; upgrade Common→Rare with Spores+Moltings; fail
  Rare→Legendary without Ichor, then succeed; fill the stash and confirm the
  overflow choice modal.

## Open / deferred

- Material names + art (Moltings / Chrysalis Ichor are placeholders).
- Exact knob values (stash size, salvage yields, upgrade costs, Ichor drop rate) —
  a tuning pass; use the `tune-undercity-balance` skill.
- Player Market and Bounty Board — separate specs (umbrella).
- Diegetic plaza building sprites — polish pass after the modal MVP.

## Coordination note

`undercity_db.py`, `undercity_data.py`, and the engine/tests have frequent in-flight
working-tree edits. Layer onto whatever is current, not the committed snapshot.
