# Undercity World-Boss Participation Rewards — Design

**Date:** 2026-07-23
**Status:** Approved (brainstorming) → ready for implementation plan
**Scope:** The Moor-Wyrm world-event boss only (`WORLD_EVENT`). Savra and the
sigil-lair bosses are out of scope.

## Problem

When the Moor-Wyrm (the multi-node "giant rot worm" world event) is defeated, the
raid payoff is thin and invisible:

1. The existing `_world_event_payout` fans a tiered, damage-share reward to every
   contributor — but only **spores + renown**. No XP is banked at the payout (only
   a tiny flat per-skirmish participation grant, `XP_REWARDS['timeout']`), and **no
   equipment** is ever dropped.
2. The "while you were away" popup **never renders the raid result**. The
   `world_kill` / `world_fallen` away-events the server already emits were never
   added to the client `AwayEvent` union, `awayText`/`awayIcon`, or `awayGroups`,
   so they are silently filtered out. The killer sees only a one-line text append
   in their battle-result modal; absent participants see nothing.

## Goal

When the Moor-Wyrm falls, every contributor is rewarded by damage share with
**spores + XP + one guaranteed gear piece** (tier weighted by their accolade
bracket), and a "The Moor-Wyrm Has Fallen" raid-summary popup — styled like the
existing while-you-were-away modal — shows each returning player their accolade
badge, their haul (spores, XP, gear, any level-up), and a ranked roster of every
contributor with their bracket.

The four accolade brackets already exist and are unchanged in meaning:

| Bracket | Trigger |
|---|---|
| **Vanquisher** | single top damage dealer |
| **Major** | damage share ≥ `WORLD_EVENT_MAJOR_SHARE` (0.25) |
| **Minor** | damage share ≥ `WORLD_EVENT_MINOR_SHARE` (0.10) |
| **Participant** | any damage dealt |

## Design decisions (from brainstorming)

- **Boss scope:** Moor-Wyrm only.
- **Reward sizing:** scaled by damage share — reuse the existing bracket system.
- **Equipment:** guaranteed one drop per participant; tier weighting improves with
  bracket.
- **Popup content:** full roster + your rewards (headline, your accolade + loot up
  top, ranked contributor roster below).
- **Gear delivery:** routed through the standard `_roll_gear_drop` flow (stash,
  with the existing auto-grind-to-materials fallback when the stash is full — the
  find is never lost).

## Backend changes

### `undercity_config.py`
Extend each `WORLD_EVENT_REWARDS` bracket with `xp` and a gear `tiers` weight map.
Tier weighting climbs with the bracket so a Vanquisher trends toward better gear
while a Participant reliably gets a T1 piece. Proposed starting values (tunable):

```python
WORLD_EVENT_REWARDS = {
    'vanquisher':  {'spores': 120, 'renown': 5, 'xp': 60, 'tiers': {2: 0.4, 3: 0.6}},
    'major':       {'spores': 80,  'renown': 3, 'xp': 40, 'tiers': {2: 0.7, 3: 0.3}},
    'minor':       {'spores': 45,  'renown': 2, 'xp': 25, 'tiers': {1: 0.5, 2: 0.5}},
    'participant': {'spores': 20,  'renown': 0, 'xp': 15, 'tiers': {1: 1.0}},
}
```

`world_event_reward()` in `undercity_data.py` needs no logic change — it already
returns `(bracket_key, WORLD_EVENT_REWARDS[key])`; the extra keys ride along.

### `undercity_db.py` — `_world_event_payout`
For each contributor `uid` (killer mutated in place; others re-read + optimistic
-lock retry, exactly as today):

1. Grant `reward['xp']` via `_grant_xp(table, sid, <doc>, reward['xp'])`, capturing
   the returned `levels` list for the popup.
2. Grant one guaranteed gear piece via `_roll_gear_drop(<doc>, reward['tiers'])`.
   Keep the returned drop dict (`id`/`slot`/`tier`/`outcome`, plus `materials`
   when the stash was full).
3. Append `xp`, `levels`, and `gear` to that contributor's `results` row.
4. Enrich the `world_kill` away-event payload (absent players) to carry:
   `bracket`, `spores`, `xp`, `gear` (id + display name, or the ground-materials
   note), `leveledTo` (top level reached, if any), and a compact **`roster`**:
   an ordered list of `{name, bracket}` for every contributor, ranked by damage.
   The roster is computed once and shared into each away-event and the killer's
   inline result.

`_grant_xp` already persists via the caller for the killer and via the per-player
put loop for others — no new persistence path. XP-driven level-ups already mutate
stat points in the doc, so nothing else is required.

### `_finish_world` (killer's inline result)
The killer is present, so they resolve through their battle-result modal rather
than the away inbox. Extend `out['reward']` (currently `{bracket, spores, renown}`)
with `xp`, `levels`, `gear`, and the shared `roster`, and set an `out['raid']`
summary object the client can render in the same raid-summary popup shape.

## Frontend changes

### `src/app/undercity/services/undercity-models.ts`
Add to the `AwayEvent` union:

```ts
| {
    kind: 'world_kill';
    name: string;
    bracket: 'vanquisher' | 'major' | 'minor' | 'participant';
    spores: number;
    xp: number;
    renown: number;
    gear?: { id: string; name: string; tier: number; ground?: boolean };
    leveledTo?: number | null;
    roster: { name: string; bracket: string }[];
    at: string;
  }
| { kind: 'world_fallen'; name: string; at: string }
```

Extend the `world_event` finish-result `reward` type with `xp`, `levels`, `gear`,
`roster` (mirrors the enriched `out['reward']`).

### `src/app/undercity/tabs/board-tab.component.ts` (+ template + SCSS)
- Handle `world_kill` / `world_fallen` in `awayText`, `awayIcon`, and `awayGroups`.
  Add a new **"Raid"** group (label e.g. "The Moor-Wyrm Has Fallen") ahead of the
  generic "News" group.
- Render a raid-summary block for `world_kill`: headline, the player's accolade
  badge, their spores/XP/gear/level-up line, then the ranked roster with each
  contributor's bracket. `world_fallen` (players who dealt no damage) stays a
  one-line news note.
- Reuse the same summary block for the killer's inline result when
  `ev.worldKill` — replace the current text-append at
  `board-tab.component.ts:2325-2330` with the structured summary.

### `src/app/undercity/data/world-event.ts`
Mirror the new `xp` / `tiers` numbers so the client display stays in sync with the
server (per the CLAUDE.md "display mirrors" rule).

## Data flow

```
Moor-Wyrm HP pool hits 0 (in _finish_world)
  → _world_event_payout(table, sid, killer_doc)
      for each contributor by damage share:
        bracket, reward = world_event_reward(share, is_top)
        _grant_xp(...)                    # NEW: bracket XP + level-ups
        _roll_gear_drop(doc, reward.tiers)# NEW: guaranteed gear, tier by bracket
        credit spores (season) + renown (perm)   # unchanged
        absent → _push_away_event('world_kill', {...bracket, spores, xp, gear, roster})
      returns enriched results[]
  → killer: out['reward'] + out['raid'] carry xp/gear/roster
  → present killer renders raid summary inline; absent players render it from
    their world_kill away-event on next board load.
```

## Testing

Extend `infrastructure/lambda/tests/test_world_event.py`:
- Multi-contributor kill: assert each bracket receives its `xp` (doc XP rose /
  level-ups where expected) and exactly one gear piece (stash grew by 1, or a
  `stash-full` grind occurred), in addition to the existing spores/renown asserts.
- Away-event payload for absent contributors includes `bracket`, `xp`, `gear`,
  and a `roster` covering all contributors.
- Stash-full contributor: drop is ground to materials, not lost; away-event flags
  it.
- Zero-contributor edge (kill with an empty `dmg` map) still no-ops safely.

Run `cd infrastructure/lambda && python -m pytest tests -q` — keep green. Verify
the client compiles with `npm run build` (lint is known-broken per repo quirks).

## Out of scope / non-goals

- Savra and sigil-lair boss reward changes.
- Any new PvP surface (single-player raid loop only).
- Renown-bracket rebalancing beyond adding `xp`/`tiers` keys.
- New gear items — draws from the existing `GEAR` table by tier.
