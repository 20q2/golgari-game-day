import { Game, GameFilter, GameGenre } from '../models/game.model';
import { GameStats } from '../services/data-aggregation.service';

export type HeroVariant = 'most-loved' | 'top-rated';

export interface HeroSelection {
  game: Game;
  variant: HeroVariant;
  likeCount: number;
}

export interface GenreCount {
  genre: GameGenre;
  count: number;
}

/**
 * Pick the hero game for the page header.
 * - If any game has at least one like, return the most-liked
 *   (ties broken by BGG rating desc, then title asc).
 * - Otherwise fall back to the highest BGG-rated game with the
 *   'top-rated' variant. Designed so the hero looks intentional
 *   even before any social activity has accumulated.
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
