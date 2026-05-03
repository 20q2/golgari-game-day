import { Game, GameFilter, GameGenre } from '../models/game.model';
import { GameStats } from '../services/data-aggregation.service';

/**
 * Variants used by the featured-trio carousel and the legacy single hero.
 *
 * - 'most-loved'    : top game by lifetime likes.
 * - 'highest-rated' : top game by community average rating.
 * - 'recently-hot'  : top game by activity (likes + comments + ratings) in the past 14 days.
 * - 'top-rated'     : DEPRECATED — BGG-rating fallback used by the legacy single hero. Removed in step D.
 */
export type HeroVariant = 'most-loved' | 'top-rated' | 'highest-rated' | 'recently-hot';

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
 * Pick the hero game for the page header (legacy single-hero API).
 * - If any game has at least one like, return the most-liked
 *   (ties broken by BGG rating desc, then title asc).
 * - Otherwise fall back to the highest BGG-rated game with the
 *   'top-rated' variant. Designed so the hero looks intentional
 *   even before any social activity has accumulated.
 *
 * Retired in step D in favor of `pickFeaturedTrio`.
 */
export function pickHero(games: Game[], stats: GameStats[]): HeroSelection | null {
  if (games.length === 0) return null;

  const likesByGame = new Map<string, number>();
  for (const s of stats) {
    if (s.totalLikes > 0) likesByGame.set(s.gameId, s.totalLikes);
  }

  if (likesByGame.size > 0) {
    const ranked = games
      .map(g => ({ game: g, likes: likesByGame.get(g.id) ?? 0 }))
      .filter(x => x.likes > 0)
      .sort((a, b) =>
        b.likes - a.likes ||
        (b.game.bggRating ?? 0) - (a.game.bggRating ?? 0) ||
        a.game.title.localeCompare(b.game.title)
      );
    if (ranked.length > 0) {
      return { game: ranked[0].game, variant: 'most-loved', likeCount: ranked[0].likes };
    }
  }

  const sorted = [...games].sort((a, b) =>
    (b.bggRating ?? 0) - (a.bggRating ?? 0) ||
    a.title.localeCompare(b.title)
  );
  return { game: sorted[0], variant: 'top-rated', likeCount: 0 };
}

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
