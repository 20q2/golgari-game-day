# Undercity — Bridge Tollkeeper — design

**Date:** 2026-07-21
**Status:** Approved, pending planning
**Area:** Undercity board — engine/rules (`infrastructure/lambda/undercity_*.py`) +
board client (`src/app/undercity/tabs/board-tab.component.*`,
`engine/board-canvas.ts`).

## Goal

The biome-boundary **bridges** (the `tunnel` node pairs — the 10 `t_*` spurs) are
currently a silent, half-enforced shortcut: Tier-1 units cross free, evolved
units are *supposed* to pay a spore toll, but the toll is charged only when a
unit **lands** on a bridge mouth. A unit with enough roll simply walks through
the spur — or warps across on landing — and the toll never really bites. Apex
(Tier-3) units can cross too, if they can pay.

Replace this with a **tollkeeper**: a tier-aware dialog that fires whenever a
unit steps onto a bridge, every crossing. It teaches the whole rule in one
breath — *kids travel free, adults pay 50 spores, and dragons & lich lords are
too big to fit* — and enforces it:

- **Tier 1 ("kids")** — cross free, exactly as today. The dialog is a friendly
  confirm.
- **Tier 2 ("adults")** — **forced stop, then cross**: pay 50 spores, stop on
  the bridge mouth this turn, and your **next roll** carries you across free.
  Can't afford 50 → the bridge is blocked (no free pass-through, no overshoot).
- **Tier 3 ("dragons / lich lords")** — **too large to enter at all.** The
  bridge is never a destination and never a corridor. Tapping one still shows a
  playful "you'll never fit" dialog so the tile isn't a dead end.

No one is ever stranded: the Ashen Wilds (open to all tiers) already keep every
biome mutually reachable for evolved units — the existing no-trap invariant.

## Terminology

"Bridge" is the player-facing name for a `tunnel` node. A bridge is a **pair** of
mouth nodes (e.g. `t_cavern_bog0` ↔ `t_cavern_bog1`); each mouth's
`TUNNEL_EXITS` entry is the far-biome node you pop out at (`t_cavern_bog0 →
bog_r1`). This spec uses "bridge" in prose and `tunnel` when naming code.

## Tier bands & the toll table

The whole rule collapses into one config table:

```python
# undercity_config.py
TUNNEL_TOLL = {2: 50}   # tier -> spore toll to cross a bridge. Tier <=
                        # TUNNEL_TIER_MAX (=1) crosses free; a tier absent from
                        # this table is TOO LARGE and blocked from bridges
                        # entirely (Tier 3 today).
```

- `tier <= TUNNEL_TIER_MAX` (1) → free.
- `tier` in `TUNNEL_TOLL` → pays that toll (Tier 2 → 50).
- otherwise → blocked entirely (Tier 3, and any future higher tier).

50 spores is a real economic decision (wilderness bounties are ~30–45), not a
rounding error. It is the single number to retune; no client mirror duplicates
it (the client reads the toll from the dialog payload / rule, in prose).

## Server rules (`infrastructure/lambda/`)

### `_blocked_nodes(doc)` — who may never step onto a bridge

Extend the existing helper (`undercity_db.py`). A unit is barred from all
`TUNNEL_NODES` (never a destination, never a pass-through) when:

- its tier is **not free** (`tier > TUNNEL_TIER_MAX`) **and**
- its tier has **no toll entry** (`TUNNEL_TOLL.get(tier)` is `None`) → Tier 3+,
  *too large*; **or**
- it has a toll entry but **cannot afford it** (`spores < toll`) → Tier 2 broke.

The escape-ladder gating already in `_blocked_nodes` is untouched.

### Forced stop for affordable Tier-2 — bridges become stop-nodes

An affordable Tier-2 must **halt on the near mouth** — it can neither overshoot
the bridge nor slip through the spur for free. Reuse the engine's existing
`closed` mechanism (the same "a walk that reaches this node STOPS at it" rule
sealed barriers use): add `TUNNEL_NODES` to the closed set **only** for a
Tier-2 mover, and **only** at the player movement site.

- New helper `_stop_nodes(table, sid, doc)` = `_closed_barriers(table, sid)`
  unioned with `TUNNEL_NODES` when the mover is an affordable Tier-2, else just
  the sealed barriers.
- `_roll` and `_admin_bot_step` pass `_stop_nodes(...)` as the `closed` argument
  to `legal_destinations` instead of `_closed_barriers(...)` directly.
- This is scoped to movement. Do **not** thread bridge-stops into unrelated
  `board_distance`/pathing callers — they keep using `_closed_barriers` so AI
  distance heuristics and reachability checks are unchanged.

Tier-1 never has bridges in its stop set (kids pass through / warp as today).
Tier-3 has bridges in `blocked`, so `closed` never matters for them.

### `_resolve_space` tunnel branch — landing behavior splits by tier

Today the branch warps every lander across (`doc['position'] =
TUNNEL_EXITS[node]`) and charges the toll inline. Split it:

- **Tier 1** — warp across now, free, consequence-free (unchanged): return the
  current `{'type': 'tunnel', 'to': exit_node, 'toll': 0, 'text': …}`.
- **Tier 2** — this landing is the *forced stop*. Charge 50 spores, **stay on
  the mouth** (do **not** set `position` to the exit), and return a distinct
  payload, e.g. `{'type': 'tunnel', 'paid': True, 'toll': 50, 'to': None,
  'text': 'You squeeze up to the bridge and pay the toll. Your next roll
  carries you across.'}`. No far-side landing effect resolves (consequence-free,
  as today).

Tier-3 never reaches this branch (blocked upstream).

### Carrying a paid Tier-2 across on the next roll

A Tier-2 standing **on a bridge mouth** got there by paying, so their next roll
carries them across for free. In `_roll`, before computing legal destinations:

- If the mover's `position` is in `TUNNEL_NODES` and the mover is evolved
  (`tier > TUNNEL_TIER_MAX`), immediately place them at
  `TUNNEL_EXITS[position]`, consume the roll, charge **no** toll, and return a
  tunnel-cross event (`{'type': 'tunnel', 'to': exit, 'toll': 0, 'text': 'You
  slip across the bridge to the far side.'}`). This is the "your next roll
  carries you across" step, mirroring the escape-ladder feel.

Edge case: a unit deposited on a mouth by teleport/admin/respawn also gets the
free carry-across on its next roll. Acceptable — arriving on a mouth by any
means means the crossing is already committed; it never grants a *second* free
crossing because the carry lands you off the bridge.

## Client (`src/app/undercity/`)

### The tollkeeper dialog (`board-tab.component.ts` + `.html`)

Model the interrupt **1:1 on the existing Ashen Wilds `wildsPrompt`**
(`board-tab.component.ts:882-976`): a signal holding the held step's node id,
plus press/turn-back handlers that reuse `commitStep`.

- New signal `bridgePrompt = signal<string | null>(null)` (the held mouth node,
  or null).
- In `onTapNode`, before `commitStep`: if the tapped next node is a `tunnel`
  node, set `bridgePrompt(nodeId)` and return (hold the step). This fires for
  **every** tier, **every** crossing — there is no once-per-season flag (unlike
  the wilds warning).
- Also allow a **blocked** unit to surface the dialog: if a Tier-3 (or broke
  Tier-2) taps a bridge that isn't a legal step, still open `bridgePrompt` so
  they see *why* — the dialog is informational, and its only button is Turn
  back.
- `payBridge()` — the "cross / pay & cross" action: clear `bridgePrompt` and
  `commitStep(step, mouth)` so the direct-tap and dialog paths run identical
  stepping logic. The server enforces the actual charge / block on landing;
  the client does not compute spores.
- `turnBackBridge()` — clear `bridgePrompt`, leave `stepping` untouched (keep
  remaining steps, reroute), exactly like `turnBackWilds`.

The dialog is **tier-aware** (branch on `store.you()?.tier`):

| Tier | Body | Buttons |
|------|------|---------|
| 1 (kid) | "The bridgekeeper waves you through. *'Little ones cross free — hop along!'*" | **Hop across** / (Turn back) |
| 2 (adult), can afford | "The bridgekeeper eyes your bulk. *'Grown-ups pay the toll — 50 spores to cross.'* (Kids go free; dragons and lich lords don't fit at all.)" | **Pay 50 & cross** / **Turn back** |
| 2 (adult), broke | "*'50 spores or turn around, friend.'* You don't have enough." | **Turn back** only |
| 3 (dragon / lich) | "One look and the bridgekeeper shakes their head. *'No chance — you'll never fit through here. Off you go.'*" | **Turn back** only |

Reuse the `uc-modal-backdrop` / `uc-modal` markup and, like the wilds prompt, do
**not** dismiss on outside click — it's a decision.

### Board rendering (`engine/board-canvas.ts`)

Bridges stay **tappable for all tiers** so the dialog can always fire — remove
(or gate off) the "grey tunnels for tier > 1" lock that would otherwise make a
bridge un-tappable for evolved units. The Tier-3 "won't fit" dialog replaces the
grey-out as the way a dragon/lich learns they can't cross. (A subtle bridge
icon/label is fine but not required by this design.)

## Testing

No frontend test runner exists; verify the client with `npm run build` plus a
manual walk-through (see the `run-undercity` skill for driving the board to a
bridge and reaching the modal).

Backend — `cd infrastructure/lambda && python -m pytest tests -q`:

- **Config:** `TUNNEL_TOLL == {2: 50}`; Tier 3 has no entry.
- **Tier 3 blocked:** a bridge is neither a destination nor a corridor for a
  Tier-3 (`legal_destinations`/`board_distance` with `_blocked_nodes`); it can
  still reach every biome via the Wilderness (existing no-trap test still
  passes).
- **Tier 2 forced stop:** with ≥50 spores, a bridge mouth is a legal
  destination but nothing beyond it is (stop-node), from a biome neighbor.
- **Tier 2 landing:** `_resolve_space` on a mouth charges 50, leaves `position`
  on the mouth (no warp), returns `paid: True`.
- **Tier 2 carry-across:** a `_roll` while standing on a mouth warps to
  `TUNNEL_EXITS[mouth]`, consumes the roll, charges no second toll.
- **Tier 2 broke:** <50 spores → bridge in `_blocked_nodes`, not a destination.
- **Tier 1 unchanged:** warp-on-landing, free, consequence-free.
- **Update existing tests:** the current suite asserts `TUNNEL_TOLL == {2:8,
  3:16}` (`test_tunnel_toll_table`) and Tier-2 warp-on-landing
  (`test_tier2_tunnel_landing_charges_the_toll`, which expects
  `position == TUNNEL_EXITS[...]`). These change: toll is 50, and a Tier-2
  landing now stays on the mouth. Retune those assertions to the new rules.

## Non-goals (YAGNI)

- **Teleport into a bridge** is not specially gated (rare; matches the
  wilds-warning precedent). A teleport that lands a Tier-2 on a mouth simply
  gets the free carry-across next roll.
- **Flat 50 toll** — no per-crossing scaling, no distance/biome variation.
- **No new persistent state** beyond the transient "standing on a mouth" (which
  is just `position`); no localStorage flag (the dialog shows every crossing).
- No change to enemy difficulty, the Wilderness, the boss finale, or PvP.
