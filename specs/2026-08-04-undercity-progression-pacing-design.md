# Undercity Progression Pacing — XP Curve, Sigil XP, Tier-2 Reward Fix — Design

**Date:** 2026-08-04
**Status:** Approved (brainstorm) — pending spec review
**Related:** economy audit of session `undercity-session-20260725-151118.json`;
prior findings in [`2026-07-26-undercity-playtest-findings-20260725.md`](2026-07-26-undercity-playtest-findings-20260725.md);
enemy ladder in [`2026-07-26-undercity-enemy-ladder-design.md`](2026-07-26-undercity-enemy-ladder-design.md)
and region-tier selection in [`2026-07-26-undercity-region-tier-enemies-design.md`](2026-07-26-undercity-region-tier-enemies-design.md);
balance simulator in `infrastructure/lambda/sim/`. Tuning workflow:
`.claude/skills/tune-undercity-balance`.

## Motivation

A full economy audit of the 2026-07-25 game night (8 players, ~8.8 h, 370 events)
found that **character leveling ends too early and wastes its reward** for the
most engaged players:

- Level cap is 12; the full climb costs **550 XP** (`xp_to_next = 20 + 5·level`).
- Refined Pigeon joined at 20:03 and hit **L12 by ~00:01 — capped in ~4 hours**,
  despite joining late. Engagement, not join time, drove the spread (an early
  joiner disengaged at L4).
- Once at cap, `engine.apply_level_ups` simply stops looping, so overflow XP is
  **inert** — no stat point, HP, spore, or renown. Andrew earned 792 XP (242
  wasted past cap); Refined Pigeon 741 (191 wasted). **~433 XP across the two
  leaders produced nothing.**
- A single elite kill is often a whole level: in the tier-2/3 bands a fight pays
  35–100 XP against per-level costs of 45–75, so progression has no texture at
  the top — you level on essentially every elite.

The audit also found a **reward-ordering bug**: the tier-2 *elite* enemy pool
(`WILDERNESS_NPCS`, which is tankier and hits harder) pays **less** XP than the
tier-2 *wild* pool (`DEPTHS_MID`) — 35–38 vs 42–45 — a side effect of the
region-tier remap composing pools that were not authored as a wild/elite pair.

This design makes leveling last most of a night, gives it texture, and adds a
milestone XP source for the dungeon-quest path — **without adding power** (the
level cap and therefore the boss/enemy balance are untouched).

## Design principles (established in brainstorm)

1. **Leveling should last the whole night**, not cap in ~4 h.
2. **No added power ceiling.** Keep `LEVEL_CAP = 12`. Solo-Savra is intentionally
   a hard epic and the enemy ladder is fixed-stat; more levels would mean more
   stat points + HP and would soften the finale. We slow the *pace*, not raise
   the *ceiling*.
3. **No rubberbanding.** Everyone gets the same number of turns; the lead is
   earned through skill and luck. No throttling leaders, no handouts to trailing
   players. (This is why the spore economy is explicitly left alone — see
   Non-goals.)
4. **Casuals keep their fast early levels.** The curve only steepens after the
   early game, so low-level players still feel steady progress.

## Change 1 — Steeper, anchored XP curve (cap stays 12)

Replace the linear curve with a progressive one that ramps after level 5:

```
xp_to_next(level) = XP_CURVE_BASE
                  + XP_CURVE_LINEAR · level
                  + XP_CURVE_RAMP  · max(0, level − XP_CURVE_RAMP_FROM)²
```

Approved values: `XP_CURVE_BASE = 15`, `XP_CURVE_LINEAR = 5`,
`XP_CURVE_RAMP = 2`, `XP_CURVE_RAMP_FROM = 5`.

Resulting per-level costs and total:

| L→L+1 | XP | vs enemy you meet there |
|---|---|---|
| 1→2 | **20** | 2 basic wild kills (10 XP each) — the "2 enemies to level" anchor |
| 2→3 | 25 | |
| 3→4 | 30 | |
| 4→5 | 35 | ~1.4× a T1 elite (25) |
| 5→6 | 40 | ~0.9× a T2 elite (~47) — T2-entry level |
| 6→7 | 47 | ~1× a T2 elite; ramp begins |
| 7→8 | 58 | ~1.2× |
| 8→9 | 73 | ~0.7–1× a T3 elite (70–100) |
| 9→10 | 92 | ~0.9–1.3× |
| 10→11 | 115 | ~1.2–1.6× |
| 11→12 | 142 | ~1.4–2× |
| **Total** | **677** | **1.23× today's 550** |

**Anchors met:** L1→2 = 20 (two basic wild kills). The ramp keeps most T2/T3
elites below a full level (a fat apex elite can still ≈1 level at a tier's entry —
an accepted trade for fitting the night budget). Levels 1–5 stay at/below today's
values, so casuals are unaffected.

**Pacing — calibrated to the real night, sim-confirmed.** A game night runs
~8–9 h = **16 roll-recharges × 3 = ~48 rolls** (plus a handful from pokes). A sim
"turn" ≈ one roll/landing, so ~48 rolls ≈ ~48 turns. The `sim/` full-game driver
(24 seeds) on the aggressive **pest/city rusher** reaches:

| milestone | turn | vs old curve (550) |
|---|---|---|
| L5 / tier-2 evolve | 16 | 20 |
| L8 | 24 | 34 |
| **apex / tier-3 evolve (L10)** | **34** | 48 |
| **L12 (cap)** | **46** | 34 |

So a dedicated player reaches the **apex form (L10) by ~turn 34 — ~14 rolls to
spare** for the boss questline + Savra — and can push to the **L12 cap right at
the ~48-roll wire** if they really want to. Because lair/boss/sigil fights all
grant XP, "reach apex *and* fight bosses" is one overlapping climb, not two
budgets. This is the exact shape the owner asked for. Slower playstyles
(farmer/tank) finish the night mid-climb, and casuals keep brisk early levels
(L5 by ~turn 16). Overcap XP waste effectively disappears — hitting cap now takes
almost the whole night, so post-cap conversion is unneeded.

The four coefficients live in `undercity_config.py` as new scalars so the curve
is tunable in the `sim/` harness without touching engine code. Steeper reserves
(RAMP 3/4, or RAMP_FROM 4) push cap later if a night ever feels too fast.

**Files:**
- `infrastructure/lambda/undercity_config.py` — add `XP_CURVE_BASE`,
  `XP_CURVE_LINEAR`, `XP_CURVE_RAMP`, `XP_CURVE_RAMP_FROM`.
- `infrastructure/lambda/undercity_data.py:34` — rewrite `xp_to_next` to the
  formula above (reading the config scalars).
- **Client mirror** `src/app/undercity/data/forms.ts:152` — the client has its
  own copy of the curve for the XP bar; update it to match exactly.
- Tests — update `xp_to_next` assertions and any level-progression test that
  asserts "reaches level N after M fights" against the new totals.

## Change 2 — Sigil grants XP

Claiming a Guild Sigil (a player's **first** clear of a biome dungeon lair)
grants a flat **`SIGIL_XP = 50`** on top of the lair boss's existing first-clear
XP. There are five biome sigils, so a player who quests all five dungeons earns
up to **250 bonus XP** — a real *alternative* progression path to grinding wild
spaces, reinforcing "leveling lasts" and rewarding the boss-approach questline.

Server-authoritative; no client mirror (the grant is applied server-side and the
new level arrives in the state payload like any other XP).

**Files:**
- `infrastructure/lambda/undercity_config.py` — add `SIGIL_XP = 50`.
- `infrastructure/lambda/undercity_db.py` — at the sigil-claim site
  (~line 4926, where `out['sigil'] = sigil_biome` is set on a `personal_first`
  biome lair clear), call `_grant_xp(table, sid, doc, data.SIGIL_XP)` and surface
  the granted XP / any level-up in the outbound event (so the client can show it).
- Tests — add a case asserting a first sigil claim grants `SIGIL_XP`; a repeat
  claim grants none.

## Change 3 — Fix the tier-2 reward inversion (XP only)

Raise the tier-2 *elite* pool's XP so the tankier elite out-levels the tier-2
wild, restoring a monotonic XP ladder (T2 wild < T2 elite < T3 wild):

- `WILDERNESS_NPCS` XP: **35–38 → ~46–49** (per enemy, keeping their relative
  spread). Concretely: sluiceway_scorpion 35→46, large_bear 35→46,
  loleth_troll 38→48, mosspit_skeleton 38→49 (final numbers to be confirmed
  against the ladder test).

**Bounty left untouched** to honor the "leave spores alone" principle. This
knowingly leaves a small *spore* inversion on these enemies (T2 elite bounty
22–24 still < T2 wild 26–28); that is a deliberate carve-out, not an oversight —
spore flow is out of scope for this pass (see Non-goals).

**Files:**
- `infrastructure/lambda/undercity_data.py:990` — `WILDERNESS_NPCS` xp fields.
- Tests — update any enemy-reward / tier-ladder assertion referencing those XP
  values.

## Non-goals (explicitly out of scope)

- **Spore economy.** The audit found spores heavily combat-sourced and top-heavy
  (84% held by 3 players), but per principle #3 the spread is legitimate skill +
  luck over equal turns. No income, sink, or redistribution changes. (Change 3
  deliberately does not touch bounty for this reason.)
- **Crafting supplies.** Audited (findings below) but the current mining/salvage
  system post-dates the tracked session and can't be validated from it. No code
  changes this pass.
- **Level cap** stays 12. **No post-cap XP conversion** — the steeper curve makes
  early capping rare, so it is unnecessary. (If the very fastest farmers still
  cap and waste the tail in practice, overflow-conversion is the ready follow-up.)

## Appendix — Crafting-supply audit findings (no code changes)

Verified against the current board and code (design of the mining tap:
`2026-07-27-undercity-mining-materials-design.md`):

- **Moltings are abundant** and not a constraint: salvage alone (`SALVAGE_MOLTINGS`
  1/2/4/6 by rarity) covers the blacksmith's needs (9 Moltings to take one piece
  T1→T4), since gear drops are frequent and salvage is not map-gated.
- **Ichor / Gemstones are the real gate and are geographically concentrated.**
  The only dense source is **3 `crystal_vein` nodes, all in the `cavern` region**
  (`cavern_r3/r4/r6`, ~0.9 Ichor/visit + a one-time Heartstone +2). Salvage yields
  Ichor only from T3+ gear; excavation clears give +1 but are rarely completed
  (1 clear in the entire 8.8 h session). A player whose route avoids the cavern is
  starved of Ichor and cannot reach Mythic (3 Ichor/piece) regardless of how much
  they fight.
- The design target ("~6–9 Gemstones/night tops out a loadout") is *arithmetically*
  reachable but leans entirely on ~7–10 deliberate cavern-vein visits, and there is
  **no empirical evidence** players naturally route through those 3 nodes that
  often (the tracked session predates the vein).
- **Recommendation (future):** instrument the export with a `space.crystal_vein`
  metric and per-material-gain counters before the next game night so this is
  auditable, and sanity-check vein/excavation landing frequency on the live board.

## Validation

1. Backend green: `cd infrastructure/lambda && python -m pytest tests -q`.
2. Client mirror changed → `npm run build` from repo root.
3. Optionally re-run the `sim/` harness to confirm the curve/pacing before the
   host deploys.
4. Nothing changes for players until the host `cdk deploy`s the Lambda — **the
   host runs deploys, not the implementer.** End with tests green and note a
   deploy is needed.
