// Mirror of undercity_data.RESPAWN_LAIRS — the two side-content ruin lairs that
// run a per-player defeat -> abandoned(1h) -> respawn cycle instead of a Vestige.
// spec: specs/2026-08-02-undercity-respawning-ruin-lairs-design.md
export const RUIN_LAIRS = new Set<string>(['lair_titan', 'n288']);

export const RUIN_LAIR_NAMES: Record<string, string> = {
  lair_titan: 'Lord of Extinction',
  n288: 'Doomgape',
};

/** True while this player's abandonment timer for `nodeId` is still in the future. */
export function ruinLairAbandoned(
  nodeId: string,
  ruinLairs: Record<string, { respawnAt: string; scavenged: boolean }> | undefined,
): { scavenged: boolean; minsLeft: number } | null {
  const entry = ruinLairs?.[nodeId];
  if (!entry) return null;
  // Server stamps naive-UTC ISO (no 'Z'); force UTC so the compare is correct.
  const respawnMs = Date.parse(entry.respawnAt + 'Z');
  const leftMs = respawnMs - Date.now();
  if (leftMs <= 0) return null;
  return { scavenged: entry.scavenged, minsLeft: Math.max(1, Math.round(leftMs / 60000)) };
}
