import { Game, GameFilter, GameGenre } from '../models/game.model';
import { GameStats } from '../services/data-aggregation.service';

/**
 * Variants used by the featured-trio carousel.
 *
 * - 'most-loved'    : top game by lifetime likes.
 * - 'highest-rated' : top game by community average rating.
 * - 'recently-hot'  : top game by activity (likes + comments + ratings) in the past 14 days.
 */
export type HeroVariant = 'most-loved' | 'highest-rated' | 'recently-hot';

export interface HeroSelection {
  game: Game;
  variant: HeroVariant;
  likeCount: number;
  /** Community average rating; populated for the 'highest-rated' variant. */
  ratingValue?: number;
}

export interface GenreCount {
  genre: GameGenre;
  count: number;
}

const RECENT_WINDOW_MS = 14 * 24 * 60 * 60 * 1000;

/**
 * Pick up to three featured games for the carousel:
 *   1. Most Loved              — highest lifetime likes.
 *   2. Highest Community Rating — top community average among games with ≥1 rating.
 *   3. Recently Applauded       — most activity (likes+comments+ratings) in the past 14 days.
 *
 * Slots are de-duplicated: a game already chosen for an earlier slot is skipped
 * in later slots' rankings. A slot whose ranking is empty after the skip is omitted
 * (the returned array can have 0–3 entries, in fixed order).
 */
export function pickFeaturedTrio(
  games: Game[],
  stats: GameStats[],
  now: Date,
): HeroSelection[] {
  if (games.length === 0) return [];

  const gameById = new Map<string, Game>(games.map(g => [g.id, g]));
  const statsById = new Map<string, GameStats>(stats.map(s => [s.gameId, s]));

  const cutoffMs = now.getTime() - RECENT_WINDOW_MS;
  const result: HeroSelection[] = [];
  const used = new Set<string>();

  // Slot 1: Most Loved
  const mostLoved = stats
    .filter(s => s.totalLikes > 0 && gameById.has(s.gameId))
    .sort((a, b) => {
      const ga = gameById.get(a.gameId)!;
      const gb = gameById.get(b.gameId)!;
      return (
        b.totalLikes - a.totalLikes ||
        (gb.bggRating ?? 0) - (ga.bggRating ?? 0) ||
        ga.title.localeCompare(gb.title)
      );
    })[0];
  if (mostLoved) {
    const game = gameById.get(mostLoved.gameId)!;
    result.push({ game, variant: 'most-loved', likeCount: mostLoved.totalLikes });
    used.add(game.id);
  }

  // Slot 2: Highest Community Rating
  const highestRated = stats
    .filter(s =>
      s.averageRating != null &&
      s.totalRatings > 0 &&
      gameById.has(s.gameId) &&
      !used.has(s.gameId),
    )
    .sort((a, b) => {
      const ga = gameById.get(a.gameId)!;
      const gb = gameById.get(b.gameId)!;
      return (
        (b.averageRating ?? 0) - (a.averageRating ?? 0) ||
        b.totalRatings - a.totalRatings ||
        ga.title.localeCompare(gb.title)
      );
    })[0];
  if (highestRated) {
    const game = gameById.get(highestRated.gameId)!;
    result.push({
      game,
      variant: 'highest-rated',
      likeCount: highestRated.totalLikes,
      ratingValue: highestRated.averageRating ?? undefined,
    });
    used.add(game.id);
  }

  // Slot 3: Recently Applauded
  type RecentRow = { gameId: string; count: number; latestMs: number };
  const recentRows: RecentRow[] = [];
  for (const s of stats) {
    if (!gameById.has(s.gameId) || used.has(s.gameId)) continue;
    let count = 0;
    let latestMs = 0;
    const accumulate = (ts: string | Date | undefined) => {
      if (ts == null) return;
      const ms = ts instanceof Date ? ts.getTime() : new Date(ts).getTime();
      if (Number.isNaN(ms)) return;
      if (ms >= cutoffMs) {
        count += 1;
        if (ms > latestMs) latestMs = ms;
      }
    };
    for (const c of s.comments) accumulate(c.timestamp);
    for (const r of s.ratings) accumulate(r.timestamp);
    for (const l of s.likes) accumulate(l.timestamp);
    if (count > 0) recentRows.push({ gameId: s.gameId, count, latestMs });
  }
  recentRows.sort((a, b) => {
    const ga = gameById.get(a.gameId)!;
    const gb = gameById.get(b.gameId)!;
    return (
      b.count - a.count ||
      b.latestMs - a.latestMs ||
      ga.title.localeCompare(gb.title)
    );
  });
  const hot = recentRows[0];
  if (hot) {
    const game = gameById.get(hot.gameId)!;
    const stat = statsById.get(hot.gameId);
    result.push({
      game,
      variant: 'recently-hot',
      likeCount: stat?.totalLikes ?? 0,
    });
    used.add(game.id);
  }

  return result;
}

/**
 * Count how many distinct games carry each genre across the catalog,
 * return the top N sorted by count desc (ties broken alphabetically).
 */
export function topGenres(games: Game[], n: number): GenreCount[] {
  const counts = new Map<GameGenre, number>();
  for (const game of games) {
    for (const genre of game.genres) {
      counts.set(genre, (counts.get(genre) ?? 0) + 1);
    }
  }
  return Array.from(counts.entries())
    .map(([genre, count]) => ({ genre, count }))
    .sort((a, b) => b.count - a.count || a.genre.localeCompare(b.genre))
    .slice(0, n);
}

/**
 * Count active hidden filters for the gear-button badge.
 * Search text is excluded — the search input is itself visible in the
 * sticky bar, so the badge only signals filters hidden inside the sheet.
 */
export function countActiveFilters(filter: GameFilter): number {
  let n = 0;
  if (filter.genres && filter.genres.length > 0) n += 1;
  if (filter.duration) n += 1;
  if (filter.supportedPlayers != null) n += 1;
  return n;
}
