# Undercity — Illuminating Gear (replacing the universal torch)

**Date:** 2026-07-20
**Status:** Approved (brainstorm) — ready for implementation plan

## Problem

The dark-dungeon light source today is the **Swamp Torch**: a free `toggle-torch`
action every player has, no item required. Lit, it widens the fog-of-war radius
from 1 to 2 graph hops but saps combat (−3 ATK / −2 DEF). Because it's universal
and forced-available, there's no build decision — everyone has the same light
button. It's not fun.

## Goal

Make **seeing in the dark a build choice**, not a free universal toggle. Light
becomes a property of specific equipment you choose to equip. The tradeoff is
**power for information**: an illuminating item reveals the *entire* dungeon
layer but costs you a gear slot and carries little/no combat stat.

## Design

### Concept

Delete the `toggle-torch` mechanic entirely. Add **two dedicated light items** in
two different gear slots. Equipping either reveals the **whole current dungeon
layer** (full fog lift) while equipped — passive, no toggle, no combat penalty.
The cost is the gear slot plus deliberately weak combat stats.

Illumination is binary (you either light the whole dungeon or you don't), so
there is no incremental "brightness" — the old 2-hop radius concept is gone.

### The two items

New gear field: `light: 'full'` — reveals the entire current dungeon layer while
equipped. Both items are **tier 1** (so they appear in the shop and can drop from
tier-1 gear sources like any other gear), and are **both buyable and droppable**.

| id | name | slot | combat stats | effect |
|---|---|---|---|---|
| `torchfang` | Torchfang | fang | +1 ATK (deliberately weak vs the +2…+6 combat fangs), no rider | `light: 'full'` |
| `glowspore_charm` | Glowspore Charm | charm | none, no rider (vs other charms' +1 SPD + rider) | `light: 'full'` |

Cost: ~30 Spores each (starting point; fine-tune later via the
`tune-undercity-balance` skill). Two different slots mean any build can opt in:
an aggressive build sacrifices its weapon slot; a technical build sacrifices its
charm/rider. Either way you trade power for total information.

### What gets removed

Server (`infrastructure/lambda/`):
- `_toggle_torch` and its `'toggle-torch'` entry in the `undercity_db.py` action dispatcher.
- The `torchLit` penalty block in `effective_stats` (`undercity_engine.py`).
- The `TORCH` constant in `undercity_data.py` (and its explanatory comment).

Client (`src/app/undercity/`):
- `torchLit` on the player model (`services/undercity-models.ts`).
- The torch button, `toggleTorch()` method, and `torchLit()` computed
  (`tabs/board-tab.component.ts` + `.html` + torch styles in `.scss`).
- `TORCH_LIGHT_HOPS` and `ownTorchLit` (`engine/board-canvas.ts`).

### Wiring the reveal (client-only — matches the existing fog architecture)

Fog-of-war is already computed client-side, and the own player's equipped `gear`
(slot→id map) is on the `you` doc. No new server round-trip is needed.

- `board-tab.component.ts` computes `illuminated` = whether `you.gear` contains
  any GEAR entry whose `light === 'full'`, and passes it to the canvas in place of
  the `torchLit` field on the own `BoardPlayer`.
- `board-canvas.ts`: `ownIlluminated` replaces `ownTorchLit`. `isLit()` returns
  `true` for every node when the own player is illuminated and in a dungeon layer
  — the same effect as the existing `revealAll` broadcast path, but per-player.

### Client/server mirror

The two new items are added to both `GEAR` in `undercity_data.py` (server, source
of truth) and `GEAR` in `src/app/undercity/data/items.ts` (client mirror). The
`GearInfo` interface (client) gains the optional `light?: 'full'` field alongside
the existing stat/rider fields.

## Testing

Update `infrastructure/lambda/tests/test_deep_dungeons.py`:
- Remove the two torch-penalty tests (`test_torch_toggle_applies_combat_penalty`,
  `test_torch_penalty_floors_at_one`).
- Add: the two light items exist in `GEAR` with `light == 'full'`.
- Add: `effective_stats` applies no torch penalty (equipping a light item changes
  only its declared stats).
- Add: `toggle-torch` is no longer a dispatched action (dispatcher rejects it).

Keep the engine/map suites green (`cd infrastructure/lambda && python -m pytest tests -q`).
The reveal itself is client-side, so it is not unit-tested server-side; verify it
via the running app.

## Out of scope

- Rebalancing other gear or the shop economy (only the two new items are priced;
  tune later via `tune-undercity-balance`).
- Any incremental/partial light radius — illumination is binary full-reveal.
