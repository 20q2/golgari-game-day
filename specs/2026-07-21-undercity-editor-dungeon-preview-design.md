# Undercity — Map-editor generated-dungeon preview

**Date:** 2026-07-21
**Status:** Design approved, pending implementation plan

## Problem

Dungeons are now procedurally generated per night (see the procedural-dungeons
design + Phase A/B/C). The committed depths in `map.json` are only the runtime
fallback, so editing them in the map editor no longer reflects what players
actually descend into. There's no way to *see* the variety the generator
produces.

## Goal

Add a read-only "preview generated dungeons" mode to the map editor: load a
sampled night's depths into the existing pocket-layer view and let the designer
roll fresh samples to eyeball the generator's output. The committed depths stay
editable (they remain the fallback); preview is purely additive.

## Non-goals

- No editing or saving of generated samples (they're throwaway previews; the
  Python generator is the source of truth).
- No TypeScript port of the generator — samples come from the server.
- No change to the live game path (Phase C already ships that).

## Architecture

The Python generator (`undercity_mapgen`, Phase B) stays the single source. The
editor previews its output by fetching a sampled board from the server, so there
is no duplicate generator to keep in sync.

### Server — sample query on `GET /game/map`

Extend `handle_map(table, query_params)`:

- `GET /game/map?sample=<seed>` → returns `merge_map(generate_all_depths(sample))`
  in the `BoardMap` shape (committed surface + freshly generated depths for that
  seed), **ignoring** `PROCEDURAL_DUNGEONS` and the active season. It is a pure
  preview of the generator for an arbitrary seed.
- `GET /game/map` (no `sample`) → unchanged: the live season's board.

`generate_all_depths` takes a season-id string; the `sample` value is passed
straight through as that seed, so any string yields a deterministic sample and
different strings yield different nights.

### Client — `UndercityApiService.getMap(sample?)`

`getMap()` gains an optional `sample?: string` argument; when provided it appends
`?sample=<encoded>` to the request. No other caller passes it, so the live path
is unchanged.

### Editor — an added "Preview dungeons" mode

`map-editor.component.ts` gains a small, self-contained cluster:

- A `previewSeed = signal<string | null>(null)` — `null` means normal editing;
  non-null means preview mode showing that seed's sample.
- A toolbar toggle **Preview dungeons**:
  - **On:** call `api.getMap(seed)` with a fresh random seed, load the returned
    board into the editor canvas, and switch the view to a generated pocket
    layer. The pocket-layer picker works as today (switch biomes).
  - **Off:** reload the committed `map.json` and restore editing.
- A **Roll another** button (visible only in preview mode): pick a new random
  seed, re-fetch, reload the canvas.
- A small **seed label** showing the current sample seed.
- **Read-only enforcement:** while `previewSeed()` is non-null, the mutation
  entry points (place / connect / delete handlers) early-return, and the
  edit-tool buttons + Save are hidden/disabled. This gates behavior at the
  handlers rather than threading a flag through the canvas.

Random seed: a short readable string (e.g. `preview-<n>` where `n` comes from a
monotonic counter or `Date.now()`), so the label is legible and re-rollable.

## Data flow

1. Toggle **Preview dungeons** on → editor sets `previewSeed` → `api.getMap(seed)`
   → server returns surface + generated depths → canvas loads it read-only →
   pocket picker lists the five generated pockets.
2. **Roll another** → new seed → `api.getMap(seed)` → canvas reloads.
3. Toggle off → reload committed `map.json` → editing restored.

Nothing in preview mode writes to disk.

## Error handling

- If the sample fetch fails (endpoint not yet deployed, network), show the
  editor's existing toast with the error and stay in / fall back to normal
  editing (don't blank the canvas).
- The endpoint always returns a valid board (generation is contract-validated in
  Phase B; a generator failure would 500, surfaced as a toast).

## Testing

- **Server:** `handle_map` with `?sample=<seed>` returns generated depths (not
  the committed fallback) and is deterministic for a fixed seed, with the flag
  off and no active season. `handle_map` without `sample` is unchanged.
- **Client:** `npm run build` compiles (no TS unit runner in this repo).

## Deploy note

The sample endpoint needs a Lambda deploy before the editor preview works live.
The editor is a dev/host tool, so shipping the client change ahead of the deploy
is harmless (the toggle just errors via toast until the backend is live).
