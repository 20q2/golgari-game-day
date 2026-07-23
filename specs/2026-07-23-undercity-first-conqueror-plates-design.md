# Undercity — First-Conqueror Name-Plates & Plundered Treasure

**Date:** 2026-07-23
**Status:** Design (approved for planning)

## Summary

Add persistent, **season-global** "first conqueror" name-plates to the Undercity
board, marking who first bested each landmark, plus a "plundered" state on treasure
tiles that both looks looted and mechanically thins the loot for later players.

Three landmark families get a plate:

1. **Sigil lairs** (5 biome bosses) — the first player to slay a biome's lair boss.
   The plate renders at that biome's **gate** (the dungeon entrance), not at the
   lair itself.
2. **Savra, Queen of the Golgari** (the final island boss) — the first player to
   land the killing blow. Plate renders at the boss node.
3. **Treasure tiles** — `trove`, `cache`, and `vault`. The first player to crack one
   open gets their name on the plate, the tile flips to a "plundered" visual, and
   every later player picks through a half-emptied strongroom.

Tier-1 `loot` nodes are unaffected — only the three "crack it open" treasure tiles
qualify.

## Loot model (treasure tiles)

A single tunable multiplier governs the plundered haul:

```python
# undercity_config.py
PLUNDERED_LOOT_MULT = 0.5   # later players get half a plundered tile's spores/XP + half its gear chance
```

| Tile  | First player (full)                | Later players (plundered ×0.5)      |
|-------|------------------------------------|-------------------------------------|
| Trove | 110 spores, 30 XP, **guaranteed** gear (T2/T3) | 55 spores, 15 XP, gear @ **50%** |
| Cache | 40 spores, 10 XP, gear @ 50%       | 20 spores, 5 XP, gear @ **25%**     |
| Vault | 80 spores, 20 XP, gear @ 50%       | 40 spores, 10 XP, gear @ **25%**    |

Rules:

- **Spores & XP:** multiplied by `PLUNDERED_LOOT_MULT` for later players, rounded to
  int (`int(reward * mult)`).
- **Gear chance:** multiplied by the same factor. The trove's guaranteed drop
  (currently modelled as an always-roll on `TROVE_GEAR_TIERS`) becomes a
  `PLUNDERED_LOOT_MULT` coin-flip; the cache/vault `GEAR_DROP['treasure']` chance
  (0.50) becomes 0.25. Gear **tiers** (which tier drops when it drops) are unchanged.
- **Repeat visit by the same player:** still yields nothing — the existing
  per-player "you plundered it already" behavior is untouched.
- **Lairs & Savra:** loot is NOT changed. Their existing `first`/`repeat` reward
  split stays as-is; the `FIRST#` record is used only to drive the name-plate.

## Server data model

One new season record per landmark, following the existing per-node record pattern
(`VEIN#`, `VAULT#`, `SHOP#`, …):

- **Key:** `pk = UNDERCITY#{sid}`, `sk = FIRST#<node>`
- **Fields:** `{ by: <username>, uid: <userId>, at: <ts>, kind: 'lair'|'boss'|'trove'|'cache'|'vault' }`

### `_claim_first` helper

```python
def _claim_first(table, sid, node, kind, doc) -> bool:
    """Idempotently record the season-global first conqueror of a landmark.
    Returns True iff THIS call won the race (this player is the global first)."""
```

Implemented as a **conditional put** with `attribute_not_exists(sk)`. If the write
succeeds, this player is the global first (return True). If it raises
`ConditionalCheckFailedException`, a prior player already claimed it (return False).
This is race-safe: exactly one concurrent writer wins.

## Write triggers (undercity_db.py)

- **`_lair`** — in the existing `result['outcome'] == 'attacker'` path, at the
  `if not slain:` branch (already the season-global-first-kill signal). Call
  `_claim_first(table, sid, node, 'lair', doc)`. Purely for the plate; no loot
  change. (`slain` remaining the authoritative first-kill flag means the plate and
  the reward split can't disagree.)
- **`_finish_boss`** — in the `result['outcome'] == 'attacker'` path, call
  `_claim_first(table, sid, node, 'boss', doc)`. No loot change.
- **`_trove` / `_cache` / `_vault`** — restructure each so:
  1. If the per-player claim key is already present → return the existing
     "already looted by you" response (unchanged).
  2. Otherwise call `is_first = _claim_first(...)`; append the per-player claim.
  3. Grant `spores`/`xp` at full if `is_first` else `× PLUNDERED_LOOT_MULT`.
  4. Roll gear at full chance if `is_first` else halved chance.
  5. Emit the flavor event. On `is_first`, the event announces the plunder
     ("<name> was first to crack the …"); later players get the existing quieter
     copy or none.

The per-player claim key (`trove:<node>`, `cache:<node>`, `vault`) is retained
exactly as today — it is orthogonal to `FIRST#`. `FIRST#` is global; the claim is
per-player.

## State delivery

`handle_state` fetches most records with a single `sk >= 'PLAYER#'` range query.
`FIRST#` sorts *before* `PLAYER#`, so it is **not** covered by that range — it needs
its own `begins_with` query, exactly like the existing `MARKET#` and `EVENT#` fetches:

```python
fr = table.query(
    KeyConditionExpression='pk = :pk AND begins_with(sk, :sk)',
    ExpressionAttributeValues={':pk': pk, ':sk': 'FIRST#'})
firsts = {i['sk'].replace('FIRST#', ''):
          {'by': i.get('by'), 'at': i.get('at'), 'kind': i.get('kind')}
          for i in (_clean(x) for x in fr['Items'])}
```

Add to the serialized `out`: `out['firsts'] = firsts`  (`{ node: {by, at, kind} }`).

## Client rendering

- **Model/service:** add `firsts: Record<string, {by: string; at?: number; kind: string}>`
  to the game-state model (`undercity-models.ts`) and thread it through the service to
  the board component, same path the existing board state takes.
- **Name-plates (board-canvas.ts):** a dedicated draw pass (after tokens, with the
  other labels) renders a small bordered plate near each `firsts` node:
  - `kind === 'lair'` → resolve to that biome's **gate** node and draw the plate
    there. Resolution: the lair node id is `<biome>_lair` (mirror of
    `SIGIL_LAIRS = {b+'_lair': b for b in BIOMES}`); the gate is the single node with
    `type === 'gate'` and `region === <biome>`. Copy: **"First cleared by {by}"**.
  - `kind === 'boss'` → draw at the boss node. Copy: **"First to fell the Queen: {by}"**.
  - treasure kinds → draw at the node itself. Copy: **"Plundered by {by}"**.
  - Reuse the existing name-plate / region-label styling (see the Dokapon name banner
    around board-canvas.ts:2089 and the region-label style) rather than inventing new
    typography.
- **Treasure sprites (all three of trove, cache, vault):** render the pixel-art
  set-piece `undercity/icons/treasure_hoard.png`, swapping to
  `undercity/icons/treasure_hoard_plundered.png` when the node has a `firsts` entry.
  Drive the swap purely off the presence of `firsts[node]` — **do not** mutate the
  server node `type` (that would break loot dispatch and the map source-of-truth).
  - This **replaces** the current art for these tiles: the bespoke procedural
    `vault` (gilded door) and `cache` (banded urn) set-pieces in
    `board-terrain.ts`, and troves (which have no set-piece today) gain one.
  - **Render as a dynamic sprite in the per-frame draw loop**, at the node's
    position, chosen by `firsts` — NOT baked into the prerendered terrain layers.
    Baking would force an expensive layer rebuild on every plunder (the terrain
    canvas is large); a per-frame sprite draw at a point feature is cheap and swaps
    instantly when new state arrives. Load both images once at construction
    alongside the existing landmark textures.
  - Consequently, drop `vault` and `cache` from `LANDMARK_TYPES` in
    `board-terrain.ts` so the terrain layer no longer bakes their old procedural
    art (avoids double-drawing under the new sprite). `trove` was never in that
    list. The map-editor sprite/`hideSprite` handling follows from that list, so no
    extra editor change is required.

## Client mirror

If `PLUNDERED_LOOT_MULT` or the treasure numbers need to appear in any client-side
display copy, mirror them per the existing `src/app/undercity/data/*.ts` duplication
rule. (No mirror is needed if the client only ever renders server-supplied reward
text.)

## Testing

Python (`infrastructure/lambda/tests`, in-memory FakeTable suite — keep green):

- `FIRST#<node>` is written once on the first lair kill / boss kill / treasure plunder
  and carries the right `by`/`kind`.
- A second, different player does **not** overwrite the record (conditional put holds).
- Treasure loot: global-first player gets full spores/XP; a later first-time visitor
  gets `× PLUNDERED_LOOT_MULT` spores/XP and the halved gear chance; a repeat visitor
  gets nothing.
- `firsts` appears in the `GET /game/state` payload with the expected shape.
- Existing lair/boss reward tests stay green (loot unchanged there).

No client test runner exists (per CLAUDE.md); verify the client via `npm run build`
and, if useful, the `run-undercity` skill.

## Out of scope

- No new balance numbers beyond `PLUNDERED_LOOT_MULT` (lairs/boss loot untouched).
- No change to the map graph, node types, or `map.json`.
- No achievements/revenge-buff hooks (GDD §14 deferred list stays deferred).
