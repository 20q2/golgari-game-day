import { Game, GameGenre } from '../models/game.model';
import { Comment, Like, Rating } from '../services/aws-api.service';
import {
  HomeFilter,
  MoodFilter,
  MOOD_TO_GENRES,
  PlayerCountFilter,
} from './home-filter.model';

export interface GameLiveStats {
  averageRating: number | null;
  totalRatings: number;
  totalComments: number;
  totalLikes: number;
}

export interface RankedGame {
  game: Game;
  stats: GameLiveStats;
  primaryGenre: GameGenre | null;
  secondaryGenre: GameGenre | null;
}

export type ActivityType = 'comment' | 'rating' | 'like';

export interface ActivityItem {
  type: ActivityType;
  username: string;
  gameId: string;
  gameTitle: string;
  detail?: string;
  timestamp: Date;
}

/** Parse the lower bound (in minutes) from a free-text playTime string.
 *  Examples: "40-70 minutes" -> 40, "30 minutes" -> 30, "60-9999 minutes" -> 60.
 *  Returns null if it can't extract a number. */
export function parseMinPlayMinutes(playTime: string | undefined | null): number | null {
  if (!playTime) return null;
  const match = playTime.match(/\d+/);
  if (!match) return null;
  const value = parseInt(match[0], 10);
  return Number.isFinite(value) ? value : null;
}

/** True if the game's player range supports the requested player count.
 *  PlayerCountFilter=7 means "7+" — match games with maxPlayers >= 7. */
export function gameSupportsPlayers(game: Game, players: PlayerCountFilter): boolean {
  if (players === 7) {
    return game.maxPlayers >= 7;
  }
  return game.minPlayers <= players && game.maxPlayers >= players;
}

/** True if the game fits within the time ceiling (lower-bound semantics).
 *  null ceiling = "Any". Games with unparsable playTime only match null. */
export function gameFitsTime(game: Game, timeMaxMinutes: number | null): boolean {
  if (timeMaxMinutes === null) return true;
  const minMinutes = parseMinPlayMinutes(game.playTime);
  if (minMinutes === null) return false;
  return minMinutes <= timeMaxMinutes;
}

/** True if the game's genres intersect the mood's cluster. 'any' matches all. */
export function gameMatchesMood(game: Game, mood: MoodFilter): boolean {
  if (mood === 'any') return true;
  const cluster = MOOD_TO_GENRES[mood];
  return game.genres.some((g) => cluster.includes(g));
}

export function gameMatchesFilter(game: Game, filter: HomeFilter): boolean {
  return (
    gameSupportsPlayers(game, filter.players) &&
    gameFitsTime(game, filter.timeMaxMinutes) &&
    gameMatchesMood(game, filter.mood)
  );
}

/** For a mood selection, return which of a game's genres caused the match
 *  (so the result row badges can show the relevant genre, not just the first). */
export function pickPrimarySecondaryGenre(
  game: Game,
  mood: MoodFilter,
): { primary: GameGenre | null; secondary: GameGenre | null } {
  if (game.genres.length === 0) return { primary: null, secondary: null };
  if (mood !== 'any') {
    const cluster = MOOD_TO_GENRES[mood];
    const matches = game.genres.filter((g) => cluster.includes(g));
    if (matches.length > 0) {
      return {
        primary: matches[0],
        secondary: matches[1] ?? game.genres.find((g) => g !== matches[0]) ?? null,
      };
    }
  }
  return { primary: game.genres[0], secondary: game.genres[1] ?? null };
}

/** Compute live stats for a single game from raw streams. */
export function computeStatsForGame(
  gameId: string,
  comments: Comment[],
  ratings: Rating[],
  likes: Like[],
): GameLiveStats {
  const gameRatings = ratings.filter((r) => r.gameId === gameId);
  const totalRatings = gameRatings.length;
  const averageRating =
    totalRatings > 0
      ? Math.round((gameRatings.reduce((sum, r) => sum + r.rating, 0) / totalRatings) * 10) / 10
      : null;
  return {
    averageRating,
    totalRatings,
    totalComments: comments.filter((c) => c.gameId === gameId).length,
    totalLikes: likes.filter((l) => l.gameId === gameId).length,
  };
}

/** Filter + rank.
 *  Sort: averageRating desc (nulls last), then totalLikes desc, then title asc. */
export function rankGames(
  games: Game[],
  filter: HomeFilter,
  comments: Comment[],
  ratings: Rating[],
  likes: Like[],
): RankedGame[] {
  return games
    .filter((game) => gameMatchesFilter(game, filter))
    .map((game) => {
      const stats = computeStatsForGame(game.id, comments, ratings, likes);
      const { primary, secondary } = pickPrimarySecondaryGenre(game, filter.mood);
      return { game, stats, primaryGenre: primary, secondaryGenre: secondary };
    })
    .sort((a, b) => {
      const ar = a.stats.averageRating;
      const br = b.stats.averageRating;
      if (ar === null && br !== null) return 1;
      if (ar !== null && br === null) return -1;
      if (ar !== null && br !== null && ar !== br) return br - ar;
      if (a.stats.totalLikes !== b.stats.totalLikes) return b.stats.totalLikes - a.stats.totalLikes;
      return a.game.title.localeCompare(b.game.title);
    });
}

/** Build top-N most recent activity items, dropping any whose game isn't in the catalog. */
export function buildActivityItems(
  comments: Comment[],
  ratings: Rating[],
  likes: Like[],
  gameById: Map<string, Game>,
  limit: number,
): ActivityItem[] {
  const items: ActivityItem[] = [];

  for (const c of comments) {
    const game = gameById.get(c.gameId);
    if (!game) continue;
    items.push({
      type: 'comment',
      username: c.username,
      gameId: c.gameId,
      gameTitle: game.title,
      detail: c.comment,
      timestamp: new Date(c.timestamp),
    });
  }
  for (const r of ratings) {
    const game = gameById.get(r.gameId);
    if (!game) continue;
    items.push({
      type: 'rating',
      username: r.username,
      gameId: r.gameId,
      gameTitle: game.title,
      detail: `${r.rating}/10`,
      timestamp: new Date(r.timestamp),
    });
  }
  for (const l of likes) {
    const game = gameById.get(l.gameId);
    if (!game) continue;
    items.push({
      type: 'like',
      username: l.username,
      gameId: l.gameId,
      gameTitle: game.title,
      timestamp: new Date(l.timestamp),
    });
  }

  return items.sort((a, b) => b.timestamp.getTime() - a.timestamp.getTime()).slice(0, limit);
}
