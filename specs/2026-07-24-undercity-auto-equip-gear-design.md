# Undercity — Auto-equip gear into empty slots

**Date:** 2026-07-24
**Status:** Design — approved for planning
**Area:** `infrastructure/lambda/undercity_db.py` (+ tests), client gear-drop rendering

## Summary

When a player acquires a gear piece and has **nothing equipped in that slot**, the
piece auto-equips instead of going to the stash. It never displaces an
already-equipped piece (a piece for a filled slot still goes to the stash). This
applies to **every** way of gaining gear — found drops, starter gear, and
shop/barter purchases — via one shared helper.

## Motivation

Equipping is a manual Plaza action today, so found gear sits unused in the stash
until the next Plaza trip — pure friction, especially early game when slots are
empty. Auto-filling empty slots removes that friction while preserving deliberate
build choices (swapping a *filled* slot still requires an explicit equip).

## Current behaviour

- Equipped gear: `doc['gear']` — a dict of `slot -> gid` (one per slot). Stash:
  `doc['gearStash']` — a list of gids, capped at `GEAR_STASH_SIZE`.
- `_equip_gear` is a manual Plaza action (`equip` route); it's unchanged by this
  work.
- **Found gear** funnels through `_roll_gear_drop(doc, tier_weights)`
  ([undercity_db.py:803](infrastructure/lambda/undercity_db.py#L803)): it rolls a
  slot+tier+gid, appends to the stash, and if the stash is full grinds the piece
  into materials. Callers: loot puzzle, combat/reward rolls, trove, cache, world
  event (~8 sites, all just take the returned dict).
- **Starter gear** appends directly to the stash with explicit "no auto-equip"
  comments: City Rat ([undercity_db.py:1957](infrastructure/lambda/undercity_db.py#L1957))
  and the renown starter kit ([undercity_db.py:2048](infrastructure/lambda/undercity_db.py#L2048)).
- **Purchases** append directly to the stash: shop buy (~4558) and Umori barter
  (~4698); a player-market receive path if present.
- `_gear_drop_view(drop)` ([undercity_db.py:3522](infrastructure/lambda/undercity_db.py#L3522))
  returns `{id, name, tier, ground}` to the client; `_drop_phrase(drop)` maps the
  outcome to a past-tense phrase ("stashed" / "ground into materials").

## Design

### The shared helper

Add `_gain_gear(doc, gid)` — the single decision point for a newly-acquired piece:

```python
def _gain_gear(doc, gid):
    """Route a newly-acquired gear piece. Auto-equip it when its slot is empty
    (fills the slot; never displaces an equipped piece); otherwise stash it, and
    if the stash is full grind it into materials so the piece is never lost.
    Returns {'id','slot','tier','outcome',...} where outcome is 'equipped',
    'stashed', or 'stash-full' (the latter carries 'materials')."""
    g = data.GEAR[gid]
    slot, tier = g['slot'], g['tier']
    gear = doc.setdefault('gear', {})
    if not gear.get(slot):
        gear[slot] = gid
        return {'id': gid, 'slot': slot, 'tier': tier, 'outcome': 'equipped'}
    stash = doc.setdefault('gearStash', [])
    if len(stash) < data.GEAR_STASH_SIZE:
        stash.append(gid)
        return {'id': gid, 'slot': slot, 'tier': tier, 'outcome': 'stashed'}
    gained = _grind_materials(doc, gid)
    return {'id': gid, 'slot': slot, 'tier': tier,
            'outcome': 'stash-full', 'materials': gained}
```

The live `doc['gear']` check per call gives the correct edge-case behaviour for
free: two pieces for the same empty slot in one reward → first equips, second
stashes; a full stash never blocks an empty slot (equip bypasses the stash).

### Routing acquisition through it

- `_roll_gear_drop`: keep the roll (slot/tier/gid), replace the stash/grind tail
  with `return _gain_gear(doc, gid)`. The ~8 call sites are unchanged.
- City Rat starter gear + renown starter-kit gear: replace the direct
  `gearStash.append(...)` with `_gain_gear(doc, gid)`. (Their "no auto-equip"
  comments are updated to describe the new behaviour.)
- Shop buy + Umori barter (+ player-market receive if present): route the
  received piece through `_gain_gear` and use the returned `outcome` for the
  success text.

`_equip_gear`, `_salvage_gear`, `_upgrade_gear`, and the barter *give-away* side
(gear leaving the player) are untouched.

### Truthful UI

- `_gear_drop_view`: add `'equipped': drop['outcome'] == 'equipped'` to the
  returned object.
- `_drop_phrase`: map `'equipped'` → "equipped".
- Buy/barter success text: "…and equipped it" when `outcome == 'equipped'`.
- Client gear-drop rendering (loot / combat-reward / world-event / trove / cache
  modals — exact spots pinned during planning): show "Equipped **X**!" for an
  auto-equipped piece instead of the stash wording, and suppress any "equip it at
  the Plaza" prompt for that piece. The client `GearDrop` view model gains an
  `equipped` boolean mirroring the server field.

## Non-goals

- No change to manual equipping/swapping, salvage, or upgrade.
- No auto-swap: a piece whose slot is already filled still goes to the stash.
- No balance-number changes; no new gear, slots, or stash-size changes.

## Testing / deploy

- **Backend:** `cd infrastructure/lambda && python -m pytest tests -q` stays green.
  Update tests that assert acquired gear lands in the stash for an empty slot
  (e.g. the City Rat starter-gear test, any found-drop-goes-to-stash test) to
  expect it equipped instead; add a focused test for `_gain_gear`
  (empty slot → equipped; filled slot → stashed; filled slot + full stash →
  ground).
- **Client:** `npm run build` succeeds; eyeball via the run-undercity skill — pick
  up gear for an empty slot and confirm it reads as equipped (and a filled slot
  still stashes).
- **Deploy (user runs):** this is a server-side rule, so it needs a **Lambda
  deploy** (`cdk deploy` from `infrastructure/`) to take effect; the client
  wording ships with the normal frontend deploy.

## Files touched

- `infrastructure/lambda/undercity_db.py` — `_gain_gear`, `_roll_gear_drop`,
  City Rat + renown-kit starter gear, shop buy, Umori barter (+ market receive),
  `_gear_drop_view`, `_drop_phrase`.
- `infrastructure/lambda/tests/test_undercity_db.py` — updated + new tests.
- Client gear-drop rendering + `GearDrop` view model (spots pinned during
  planning).
