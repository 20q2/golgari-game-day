# Undercity — Dungeon-death respawn choice

**Date:** 2026-07-22
**Status:** Approved, ready for implementation plan

## Problem

Dying in the depths currently teleports you straight to the dungeon mouth
(`<biome>_lb`) with no choice — a deliberate "no escape from the dark" friction
baked into `_compost` ([undercity_db.py:1033-1038](../infrastructure/lambda/undercity_db.py#L1033-L1038)).
Players want agency after a dungeon death: choose to wake at home, at the surface
of the biome the dungeon hangs off, or at the dungeon mouth (today's default).

## Solution

Reuse the existing generic respawn machinery instead of the hardcoded relocate.
Surface deaths already set a `pendingRespawn = {'options': [{gate, label}, ...]}`,
resolved by the `respawn` action (`_respawn`) and rendered by the board-tab modal.
A dungeon death will populate the same structure with up to three options — no new
endpoint, no new client component, no schema change.

### The three options (built in `_compost`)

| Option | Node | Label |
|---|---|---|
| Home | `HOME_GATES[home_biome]` | `"{BIOMES[home_biome].name} (home)"` |
| This biome's surface | `HOME_GATES[died_biome]` | `"{BIOMES[died_biome].name} (surface)"` |
| Dungeon mouth | `dungeon_entrance(died_biome)` | `"{DUNGEONS[died_biome].name} (mouth)"` |

Rules:

- **Dedup by node id.** If your home biome *is* the dungeon's biome, the "home"
  and "surface" gates are the same node — collapse to a single button, preferring
  the "home" label.
- **Guard `dungeon_entrance` returning `None`** — drop that option if absent.
- **All options are equal.** Every choice uses the same respawn HP
  (`COMPOST_RESPAWN_PCT`) and the same `COMPOST_SHIELD_MIN` shield that `_compost`
  already applies before the biome branch. No per-option cost or penalty.

### Provisional position

Keep the provisional `doc['position']` at the **dungeon mouth** (the entrance),
not home. If a player rolls without choosing — the existing "rolling accepts the
provisional gate" path ([undercity_db.py:1962-1963](../infrastructure/lambda/undercity_db.py#L1962-L1963))
pops `pendingRespawn` — they default to staying at the mouth, matching today's
behavior. The choice only *upgrades* the default; it never strands a player.

If `dungeon_entrance` is `None`, fall back to the home gate for the provisional
position (as the surface-death path already does).

### Client

No structural change. The modal already `@for`s over `pr.options` and calls
`respawn(o.gate)` ([board-tab.component.html:169-184](../src/app/undercity/tabs/board-tab.component.html#L169-L184)).
It renders 2–3 buttons automatically. Existing copy ("Where do you crawl back
up?") still fits.

### `_respawn` action

Unchanged. It already validates the chosen `gate` against `pr.options`, so the
surface and mouth nodes are accepted as valid targets with no edit.

## Scope

- **`_compost`** in `infrastructure/lambda/undercity_db.py` — replace the
  hardcoded depths branch with the deduped 3-option builder.
- **`test_deep_dungeons.py`** — `test_compost_in_depths_respawns_at_entrance`
  currently asserts `'pendingRespawn' not in doc`; flip it to assert the
  provisional position is the mouth *and* a `pendingRespawn` with the deduped
  options is present. Add a case for the home-biome == dungeon-biome dedup
  (2 options) versus a foreign-biome death (3 options).
- **No client, schema, or endpoint changes.**

## Non-goals

- No difference in respawn HP or shield between options.
- No changes to surface-death respawn behavior.
- No new UI, icons, or copy beyond the auto-rendered option buttons.
