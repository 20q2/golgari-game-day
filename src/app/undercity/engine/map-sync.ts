/**
 * Board-map staleness reducer.
 *
 * The night's board is fetched once from `/game/map` (fixed surface + this
 * season's procedurally-generated depths). The server can serve a *different*
 * set of depths than the client currently holds — a fresh night rolled over,
 * or the loaded bundle predates the procedural-depths feature. When that
 * happens the player's dungeon node (e.g. `bog_g1_1`) is absent from the
 * client's node graph, `layerIndex` silently files it under `overworld`, and
 * the dungeon renders fully lit and unwalkable (no gloom veil, no legal steps).
 *
 * This pure reducer decides when the client must re-fetch the map so it can
 * self-heal from that desync instead of masking it. Kept free of Angular deps
 * so it is unit-testable on its own.
 */

/** What the caller remembers about the currently-loaded map. */
export interface MapSyncState {
  /**
   * Season id the loaded map was fetched for. `undefined` means no map has
   * been fetched yet; `null` means it was fetched while no night was active.
   */
  loadedSeason: string | null | undefined;
  /** True once a position-desync re-fetch was attempted for this loaded map. */
  posHealAttempted: boolean;
}

/** Live inputs from game state + the loaded map. */
export interface MapSyncInputs {
  /** Active night's season id (null when no night is running). */
  season: string | null;
  /** The player's current node id (null/undefined until state has loaded). */
  position: string | null | undefined;
  /** Node ids present in the loaded map, or null when no map is loaded yet. */
  mapNodeIds: ReadonlySet<string> | null;
}

export type MapSyncReason = 'first-load' | 'season-change' | 'position-desync' | 'none';

export interface MapSyncDecision {
  /** Whether the caller should re-fetch `/game/map` now. */
  refetch: boolean;
  reason: MapSyncReason;
  /** State to persist after acting on this decision. */
  next: MapSyncState;
}

/**
 * Decide whether to re-fetch the board map. Priorities, in order:
 *  1. First load — no map fetched yet.
 *  2. Season change — the loaded map belongs to a past night.
 *  3. Position desync — the player's node is missing from the loaded map
 *     (healed once per loaded map, so a genuine server-side desync can't spin).
 */
export function decideMapSync(state: MapSyncState, input: MapSyncInputs): MapSyncDecision {
  if (state.loadedSeason === undefined) {
    return {
      refetch: true,
      reason: 'first-load',
      next: { loadedSeason: input.season, posHealAttempted: false },
    };
  }

  if (input.season !== state.loadedSeason) {
    return {
      refetch: true,
      reason: 'season-change',
      next: { loadedSeason: input.season, posHealAttempted: false },
    };
  }

  if (
    !state.posHealAttempted &&
    input.mapNodeIds != null &&
    input.position != null &&
    !input.mapNodeIds.has(input.position)
  ) {
    return {
      refetch: true,
      reason: 'position-desync',
      next: { loadedSeason: state.loadedSeason, posHealAttempted: true },
    };
  }

  return { refetch: false, reason: 'none', next: state };
}
