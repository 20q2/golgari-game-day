import { Injectable } from '@angular/core';
import { BehaviorSubject, Observable, combineLatest } from 'rxjs';
import { map } from 'rxjs/operators';
import { AwsApiService, Comment, Rating, Like } from './aws-api.service';

export interface GameStats {
  gameId: string;
  totalComments: number;
  averageRating: number | null;
  totalRatings: number;
  totalLikes: number;
  isLikedByCurrentUser: boolean;
  comments: Comment[];
  ratings: Rating[];
  likes: Like[];
}

export interface UserStats {
  userId: string;
  username: string;
  totalComments: number;
  totalRatings: number;
  averageRatingGiven: number | null;
  gamesCommentedOn: string[];
  gamesRated: string[];
  lastActivity: Date;
}

export interface GlobalStats {
  totalUsers: number;
  totalComments: number;
  totalRatings: number;
  mostActiveUsers: UserStats[];
  mostCommentedGames: GameStats[];
  highestRatedGames: GameStats[];
  lastUpdated: Date;
}

@Injectable({
  providedIn: 'root'
})
export class DataAggregationService {
  private allCommentsSubject = new BehaviorSubject<Comment[]>([]);
  private allRatingsSubject = new BehaviorSubject<Rating[]>([]);
  private allLikesSubject = new BehaviorSubject<Like[]>([]);
  private isLoadedSubject = new BehaviorSubject<boolean>(false);

  constructor(private awsApi: AwsApiService) {}

  // Load all data from AWS on startup
  async loadAllData(): Promise<void> {
    console.log('🚀 Loading all data from AWS...');
    
    try {
      // Load comments, ratings, and likes in parallel
      const [commentsResponse, ratingsResponse, likesResponse] = await Promise.all([
        this.awsApi.getAllComments(),
        this.awsApi.getAllRatings(),
        this.awsApi.getAllLikes()
      ]);

      this.allCommentsSubject.next(commentsResponse.comments);
      this.allRatingsSubject.next(ratingsResponse.ratings);
      this.allLikesSubject.next(likesResponse.likes);
      this.isLoadedSubject.next(true);

      console.log(`✅ Loaded ${commentsResponse.totalComments} comments, ${ratingsResponse.totalRatings} ratings, and ${likesResponse.totalLikes} likes`);
    } catch (error) {
      console.error('❌ Failed to load data from AWS:', error);
      this.isLoadedSubject.next(false);
      throw error;
    }
  }

  // Observables for reactive updates
  get allComments$(): Observable<Comment[]> {
    return this.allCommentsSubject.asObservable();
  }

  get allRatings$(): Observable<Rating[]> {
    return this.allRatingsSubject.asObservable();
  }

  get allLikes$(): Observable<Like[]> {
    return this.allLikesSubject.asObservable();
  }

  get isLoaded$(): Observable<boolean> {
    return this.isLoadedSubject.asObservable();
  }

  // Get stats for a specific game
  getGameStats(gameId: string): Observable<GameStats> {
    return combineLatest([this.allComments$, this.allRatings$, this.allLikes$]).pipe(
      map(([comments, ratings, likes]) => {
        const gameComments = comments.filter(c => c.gameId === gameId);
        const gameRatings = ratings.filter(r => r.gameId === gameId);
        const gameLikes = likes.filter(l => l.gameId === gameId);
        
        const averageRating = gameRatings.length > 0
          ? gameRatings.reduce((sum, r) => sum + r.rating, 0) / gameRatings.length
          : null;

        // Check if current user liked this game
        const currentUserId = this.getCurrentUserId();
        const isLikedByCurrentUser = gameLikes.some(like => like.userId === currentUserId);

        return {
          gameId,
          totalComments: gameComments.length,
          averageRating: averageRating ? Math.round(averageRating * 10) / 10 : null,
          totalRatings: gameRatings.length,
          totalLikes: gameLikes.length,
          isLikedByCurrentUser,
          comments: gameComments,
          ratings: gameRatings,
          likes: gameLikes
        };
      })
    );
  }

  // Get all games stats
  getAllGamesStats(): Observable<GameStats[]> {
    return combineLatest([this.allComments$, this.allRatings$, this.allLikes$]).pipe(
      map(([comments, ratings, likes]) => {
        // Get unique game IDs
        const gameIds = new Set([
          ...comments.map(c => c.gameId),
          ...ratings.map(r => r.gameId),
          ...likes.map(l => l.gameId)
        ]);

        const currentUserId = this.getCurrentUserId();

        return Array.from(gameIds).map(gameId => {
          const gameComments = comments.filter(c => c.gameId === gameId);
          const gameRatings = ratings.filter(r => r.gameId === gameId);
          const gameLikes = likes.filter(l => l.gameId === gameId);
          
          const averageRating = gameRatings.length > 0
            ? gameRatings.reduce((sum, r) => sum + r.rating, 0) / gameRatings.length
            : null;

          const isLikedByCurrentUser = gameLikes.some(like => like.userId === currentUserId);

          return {
            gameId,
            totalComments: gameComments.length,
            averageRating: averageRating ? Math.round(averageRating * 10) / 10 : null,
            totalRatings: gameRatings.length,
            totalLikes: gameLikes.length,
            isLikedByCurrentUser,
            comments: gameComments,
            ratings: gameRatings,
            likes: gameLikes
          };
        });
      })
    );
  }

  // Get user statistics
  getUserStats(): Observable<UserStats[]> {
    return combineLatest([this.allComments$, this.allRatings$]).pipe(
      map(([comments, ratings]) => {
        // Get unique user IDs
        const userIds = new Set([
          ...comments.map(c => c.userId),
          ...ratings.map(r => r.userId)
        ]);

        return Array.from(userIds).map(userId => {
          const userComments = comments.filter(c => c.userId === userId);
          const userRatings = ratings.filter(r => r.userId === userId);
          
          // Get username from most recent activity
          const latestActivity = [...userComments, ...userRatings]
            .sort((a, b) => new Date(b.timestamp).getTime() - new Date(a.timestamp).getTime())[0];
          
          const averageRatingGiven = userRatings.length > 0
            ? userRatings.reduce((sum, r) => sum + r.rating, 0) / userRatings.length
            : null;

          return {
            userId,
            username: latestActivity?.username || 'Unknown User',
            totalComments: userComments.length,
            totalRatings: userRatings.length,
            averageRatingGiven: averageRatingGiven ? Math.round(averageRatingGiven * 10) / 10 : null,
            gamesCommentedOn: [...new Set(userComments.map(c => c.gameId))],
            gamesRated: [...new Set(userRatings.map(r => r.gameId))],
            lastActivity: new Date(latestActivity?.timestamp || 0)
          };
        });
      })
    );
  }

  // Get global statistics
  getGlobalStats(): Observable<GlobalStats> {
    return combineLatest([
      this.allComments$, 
      this.allRatings$, 
      this.getUserStats(),
      this.getAllGamesStats()
    ]).pipe(
      map(([comments, ratings, userStats, gameStats]) => {
        // Sort users by activity (comments + ratings)
        const mostActiveUsers = userStats
          .sort((a, b) => (b.totalComments + b.totalRatings) - (a.totalComments + a.totalRatings))
          .slice(0, 10);

        // Sort games by comment count
        const mostCommentedGames = gameStats
          .filter(g => g.totalComments > 0)
          .sort((a, b) => b.totalComments - a.totalComments)
          .slice(0, 10);

        // Sort games by rating (must have at least 1 rating)
        const highestRatedGames = gameStats
          .filter(g => g.averageRating !== null && g.totalRatings > 0)
          .sort((a, b) => (b.averageRating || 0) - (a.averageRating || 0))
          .slice(0, 10);

        return {
          totalUsers: userStats.length,
          totalComments: comments.length,
          totalRatings: ratings.length,
          mostActiveUsers,
          mostCommentedGames,
          highestRatedGames,
          lastUpdated: new Date()
        };
      })
    );
  }

  // Add new comment (update local cache)
  addComment(comment: Comment): void {
    const currentComments = this.allCommentsSubject.value;
    this.allCommentsSubject.next([comment, ...currentComments]);
  }

  // Add new rating (update local cache)
  addRating(rating: Rating): void {
    const currentRatings = this.allRatingsSubject.value;
    // Remove existing rating from same user for same game, then add new one
    const filteredRatings = currentRatings.filter(
      r => !(r.userId === rating.userId && r.gameId === rating.gameId)
    );
    this.allRatingsSubject.next([rating, ...filteredRatings]);
  }

  // Add new like (update local cache)
  addLike(like: Like): void {
    const currentLikes = this.allLikesSubject.value;
    this.allLikesSubject.next([like, ...currentLikes]);
  }

  // Remove like (update local cache)
  removeLike(gameId: string, userId: string): void {
    const currentLikes = this.allLikesSubject.value;
    const filteredLikes = currentLikes.filter(
      l => !(l.gameId === gameId && l.userId === userId)
    );
    this.allLikesSubject.next(filteredLikes);
  }

  // Get current user ID (utility method)
  private getCurrentUserId(): string {
    // Simple user ID generation - in real app you'd use proper auth
    let userId = localStorage.getItem('gameday-user-id');
    if (!userId) {
      userId = 'user-' + Math.random().toString(36).substr(2, 9);
      localStorage.setItem('gameday-user-id', userId);
    }
    return userId;
  }

  // Refresh data from AWS
  async refreshData(): Promise<void> {
    await this.loadAllData();
  }
}