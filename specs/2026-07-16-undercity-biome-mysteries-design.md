# Undercity: biome-flavored mystery outcomes

## Problem

`roll_mystery()` (`infrastructure/lambda/undercity_engine.py`) is a single d12
table used everywhere a player lands on a mystery space, regardless of which
home ring (biome) they're standing in. The five rings (cavern, bog, garden,
city, bone — `BIOMES` in `undercity_data.py`) each have their own name, art,
and hatch perk, but the mystery table gives no sense of place.

## Design

`roll_mystery(rng, has_drift, has_doubling_rot, biome=None)` gains an optional
`biome` argument: the `region` of the map node the player currently occupies
(`data.MAP_NODES[doc['position']]['region']`). If that region isn't one of
the five home-biome keys (e.g. `depths`, `isle`, `ruin`), `biome` is `None`
and the table behaves exactly as it does today.

Two rolls get biome-conditioned variants layered on top of the existing
generic text/effect — same roll numbers, same odds, so the drift-reroll and
doubling-rot logic don't need to change:

- **Roll 1 (spore stash, base +20×mult Spores):** `garden` and `city` bump
  the amount to +26×mult, with reflavored text ("Composting spores overflow
  the mulch pile" / "A storm-drain stash, rat-picked and ready") — both
  biomes' hatch perks are spore-economy perks (Composter, City Rat), so this
  is a small in-theme bonus rather than a new mechanic.
- **Roll 7 (self buff, base `rot_surge` +3 ATK):** `cavern` swaps in
  `glowveil` (+2 SPD, "Glowcap mist swirls, quick and hard to pin down",
  echoing the Glowblessed flee perk); `bog` and `bone` swap in
  `harden_shell` (+2 DEF), flavored as mud-armor for bog ("Mire mud sets
  like armor") and marrow-armor for bone ("Marrow stiffens under your
  skin"). `garden` and `city` keep the default `rot_surge` — for garden it's
  already thematically exact (the innate biome spell), and city gets its
  unique treatment on roll 1 instead.

All three buff kinds (`rot_surge`, `glowveil`, `harden_shell`) already exist
in `effective_stats()` — no new buff plumbing, no changes to
`data.SPELLS`/`data.BIOME_SPELLS`. This is a pure data/text branch inside
`roll_mystery()`.

## Call-site change

`undercity_db.py::_mystery(table, sid, doc)` currently calls
`engine.roll_mystery(_rng, ...)` with no location info. It gains one line to
look up the biome before calling:

```python
biome = data.MAP_NODES.get(doc['position'], {}).get('region')
if biome not in data.BIOMES:
    biome = None
res = engine.roll_mystery(_rng, 'drift' in _passives(doc),
                          'doubling_rot' in _passives(doc), biome)
```

## Testing

Extend `infrastructure/lambda/tests/test_undercity_engine.py` (wherever the
existing `roll_mystery` coverage lives) with cases pinning `rng` to roll 1
and roll 7 for each of the five biomes plus `None`, asserting the expected
spores/buff-kind/text. Full suite: `cd infrastructure/lambda && python -m
pytest tests -q`.

## Out of scope

- No changes to the "bad" outcomes (8–11) or the jackpot (12) — this pass
  only touches good-outcome flavor, matching the "sprinkle in a few" scope.
- No new buff kinds, no changes to `effective_stats()`.
- No client-side changes — the mystery result text/effect already flows
  through the existing `type: 'mystery'` response shape the Angular client
  renders.
