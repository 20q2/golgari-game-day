# Undercity — relative combat sprite scaling by tier

**Date:** 2026-08-03
**Status:** Design approved, pre-plan

## Problem

In the interactive PvE combat arena both fighters render at a fixed 96×96
(`.sprite` / `.sprite-icon` in `interactive-battle.component.scss`). A tiny pest
and a hulking apex draw at the same size, so there is no visual "size flavor" —
the arena doesn't communicate a mismatch. An earlier attempt at this existed but
was lost.

## Goal

Scale the two fighters relative to each other by **tier**, so size reads at a
glance. Symmetric: the higher-tier fighter grows and the lower-tier one shrinks.
Same tier → both normal.

## Tiers

Both sides map to a tier in **1–3**:

- **Player creature** → `you().tier`. The main creature's evolution tier is
  already exactly 1/2/3 (starter = tier 1; `_evolve` bumps it; apex = tier 3).
  Already present on the client — no new plumbing.
- **Enemy** → the enemy's **spawn-zone (region) difficulty tier**. Regions are
  already marked T1/T2/T3 (`REGION_TIER` in `undercity_data.py`, mirrored in
  `board-enemy-tier.ts`). Elites never jump their region's tier, so the zone
  tier is the enemy tier. **Bosses (Savra) are always tier 3.**

The enemy tier is **stamped by the server** onto the battle payload, because the
server already resolves `region_tier` when it builds the fight and is the
authoritative owner of that mapping. This keeps the client from re-deriving a
node→region→tier lookup and covers every enemy kind uniformly (wild, elite,
lair, boss).

## Scale formula

With both tiers known (1–3):

```
gap        = myTier − foeTier          // −2 … +2
scale(me)  = clamp(1 + 0.125 × gap, 0.75, 1.25)
```

| tier gap | bigger | smaller |
|---------:|-------:|--------:|
| 0        | 1.00   | 1.00    |
| 1        | 1.125  | 0.875   |
| 2        | 1.25   | 0.75    |

So a T1 pest against a T3 elite/boss draws at 72px while the foe draws at 120px;
an even matchup is 96/96. If **either** tier is unknown, both render at 1.0 — no
regression for any code path that lacks tier data.

## Changes

### Server (`infrastructure/lambda/`)

- Add a `tier` field to the npc battle payload built in `undercity_db.py`
  (the wild/elite battle path around the `'npc': { … }` construction that
  already emits `name/id/spriteId/hp/maxHp/level`). Value:
  - wild / elite → `region_tier(spawn zone)` (already computed for the enemy
    pool in `_wild_battle`).
  - lair boss / Savra → `3`.
- Keep the pytest suite green (`cd infrastructure/lambda && python -m pytest
  tests -q`); add/adjust a test asserting the payload carries `tier`.
- Requires a Lambda deploy before enemy scaling takes effect (player-side
  scaling is client-only and works immediately; until deploy, a foe with no
  `tier` simply renders at 1.0 alongside a scaled player, which is harmless).

### Client (`src/app/undercity/`)

- **`BattleSide`** (in `battle-playback.component.ts`): add optional
  `tier?: number`.
- **`board-tab.component.ts`**: when building the `attacker` / `defender`
  `BattleSide` for the **interactive** (PvE) battle, set:
  - `attacker.tier = you()?.tier`
  - `defender.tier = ev.npc.tier` (server-sent)
- **`interactive-battle.component.ts`**: compute a per-side scale from the two
  tiers using the formula above (a small pure helper; clamp guards stray
  values). Expose each side's scale as a CSS custom property `--sprite-scale`
  on the fighter wrapper (`.body`).
- **`interactive-battle.component.scss`**: size the sprite off the var —
  `.sprite`, `.sprite-icon { width: calc(96px * var(--sprite-scale, 1));
  height: calc(96px * var(--sprite-scale, 1)); }`. Sizing goes through
  **width/height, not `transform`**, so it composes with the existing
  flip (`scaleX(-1)`) / struck / lunge transforms already on `.sprite` and
  `.side`. Ensure the sprite **bottom-anchors** to the platform so a larger
  creature stands taller on the same spot instead of floating or clipping.

**Out of scope:** the PvP replay (`battle-playback.component`) is legacy and is
left untouched. The shared `BattleSide.tier` field is harmless there (unused).

## Edge cases

- Missing tier on either side → that side is treated as "no gap"; both draw 1.0.
- Icon fallback (`.sprite-icon`, wild NPCs with no art) scales identically.
- Clamp `[0.75, 1.25]` bounds any unexpected tier value; gaps only ever reach 2
  given tiers 1–3, so the clamp is a safety net, not a normal path.
- Vestige foes (half-strength re-fights) keep their existing filter; scaling is
  orthogonal.

## Verification

No unit runner for the client. Verify in-browser via the `run-undercity` skill:

1. Even matchup (player tier == region tier) → both sprites equal (~96px).
2. Under-tiered: a tier-1 creature fighting in a T3 zone → player visibly
   smaller, foe visibly larger.
3. Boss fight → Savra renders at the T3 size relative to the player.

Production build must pass (`npm run build:prod`). Server change verified by the
lambda pytest suite.
