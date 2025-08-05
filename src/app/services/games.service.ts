import { Injectable } from '@angular/core';
import { HttpClient } from '@angular/common/http';
import { BehaviorSubject, Observable, combineLatest, from, of } from 'rxjs';
import { map, tap, switchMap, catchError } from 'rxjs/operators';
import { Game, GameGenre, GameFilter, SortOrder, GameComment, GameJson, GameDuration } from '../models/game.model';
import { AwsApiService } from './aws-api.service';
import { DataAggregationService } from './data-aggregation.service';

@Injectable({
  providedIn: 'root'
})
export class GamesService {
  private games: Game[] = [];
  private gamesLoaded = false;

  private filterSubject = new BehaviorSubject<GameFilter>({});
  private sortSubject = new BehaviorSubject<SortOrder>(SortOrder.TITLE_ASC);

  constructor(
    private http: HttpClient,
    private awsApi: AwsApiService,
    private dataAggregation: DataAggregationService
  ) {}

  getGames(): Observable<Game[]> {
    if (!this.gamesLoaded) {
      return this.loadGamesFromJson().pipe(
        tap(() => {
          // Load all AWS data when games are first loaded
          this.loadAwsDataOnStartup();
        }),
        switchMap(() => this.getFilteredAndSortedGames())
      );
    }
    
    return this.getFilteredAndSortedGames();
  }

  private async loadAwsDataOnStartup(): Promise<void> {
    try {
      console.log('🚀 Loading all AWS data on app startup...');
      await this.dataAggregation.loadAllData();
      console.log('✅ AWS data loaded successfully');
    } catch (error) {
      console.error('❌ Failed to load AWS data on startup:', error);
      // Continue without AWS data - app should still work with localStorage
    }
  }

  private getFilteredAndSortedGames(): Observable<Game[]> {
    return combineLatest([
      this.filterSubject,
      this.sortSubject
    ]).pipe(
      map(([filter, sort]) => {
        let filteredGames = this.filterGames(this.games, filter);
        return this.sortGames(filteredGames, sort);
      })
    );
  }

  setFilter(filter: GameFilter): void {
    this.filterSubject.next(filter);
  }

  setSort(sort: SortOrder): void {
    this.sortSubject.next(sort);
  }

  getGameById(id: string): Game | undefined {
    return this.games.find(game => game.id === id);
  }

  // 💬 AWS BACKEND INTEGRATION - Comments
  async addComment(gameId: string, comment: Omit<GameComment, 'id' | 'timestamp'>): Promise<void> {
    try {
      const userId = this.awsApi.generateUserId();
      // Use provided username or generate one
      const username = comment.username.trim() || this.awsApi.getUserName();
      
      const result = await this.awsApi.addComment(gameId, {
        userId,
        username,
        comment: comment.comment,
        rating: comment.rating
      });

      // Update the local aggregated data cache
      const newComment = {
        commentId: result.commentId,
        gameId: gameId,
        userId,
        username,
        comment: comment.comment,
        rating: comment.rating,
        timestamp: new Date().toISOString()
      };
      
      this.dataAggregation.addComment(newComment);
    } catch (error) {
      console.error('Failed to add comment to AWS:', error);
      throw error;
    }
  }


  // ⭐ AWS BACKEND INTEGRATION - Ratings  
  async addRating(gameId: string, rating: number): Promise<void> {
    try {
      const userId = this.awsApi.generateUserId();
      const username = this.awsApi.getUserName();
      
      await this.awsApi.addRating(gameId, {
        userId,
        username,
        rating
      });

      // Update the local aggregated data cache
      const newRating = {
        gameId: gameId,
        userId,
        username,
        rating,
        timestamp: new Date().toISOString()
      };
      
      this.dataAggregation.addRating(newRating);

      console.log(`✅ Rating ${rating} added for game ${gameId}`);
    } catch (error) {
      console.error('Failed to add rating to AWS:', error);
      throw error;
    }
  }

  // Get comments from aggregated data for a specific game
  getCommentsFromAws(gameId: string): Observable<GameComment[]> {
    return this.dataAggregation.getGameStats(gameId).pipe(
      map(gameStats => gameStats.comments.map(comment => ({
        id: comment.commentId,
        comment: comment.comment,
        username: comment.username,
        rating: comment.rating || undefined,
        timestamp: new Date(comment.timestamp)
      })))
    );
  }

  // Get average rating from aggregated data for a specific game
  getAverageRatingFromAws(gameId: string): Observable<number | null> {
    return this.dataAggregation.getGameStats(gameId).pipe(
      map(gameStats => gameStats.averageRating)
    );
  }

  // Get game stats for enhanced features
  getGameStats(gameId: string) {
    return this.dataAggregation.getGameStats(gameId);
  }

  // Get all games stats for rankings and features
  getAllGamesStats() {
    return this.dataAggregation.getAllGamesStats();
  }

  // Get user statistics for rankings
  getUserStats() {
    return this.dataAggregation.getUserStats();
  }

  // Get global statistics
  getGlobalStats() {
    return this.dataAggregation.getGlobalStats();
  }

  // ❤️ AWS BACKEND INTEGRATION - Likes
  async toggleLike(gameId: string): Promise<void> {
    try {
      const result = await this.awsApi.toggleLike(gameId);
      
      const userId = this.awsApi.generateUserId();
      const username = this.awsApi.getUserName();
      
      if (result.isLiked) {
        // Like was added
        const newLike = {
          gameId: gameId,
          userId,
          username,
          timestamp: new Date().toISOString()
        };
        this.dataAggregation.addLike(newLike);
      } else {
        // Like was removed
        this.dataAggregation.removeLike(gameId, userId);
      }

      console.log(`✅ Like toggled for game ${gameId}: ${result.isLiked ? 'added' : 'removed'}`);
    } catch (error) {
      console.error('Failed to toggle like:', error);
      throw error;
    }
  }

  private filterGames(games: Game[], filter: GameFilter): Game[] {
    return games.filter(game => {
      if (filter.genres && filter.genres.length > 0) {
        // Game must have at least one of the selected genres
        const hasMatchingGenre = filter.genres.some(selectedGenre => 
          game.genres.includes(selectedGenre)
        );
        if (!hasMatchingGenre) {
          return false;
        }
      }
      if (filter.supportedPlayers) {
        // Check if the game supports the specified number of players
        if (filter.supportedPlayers < game.minPlayers || filter.supportedPlayers > game.maxPlayers) {
          return false;
        }
      }
      if (filter.duration) {
        if (!this.matchesDuration(game.playTime, filter.duration)) {
          return false;
        }
      }
      if (filter.searchText) {
        const searchLower = filter.searchText.toLowerCase();
        return game.title.toLowerCase().includes(searchLower) ||
               game.description.toLowerCase().includes(searchLower);
      }
      return true;
    });
  }

  private sortGames(games: Game[], sort: SortOrder): Game[] {
    return [...games].sort((a, b) => {
      switch (sort) {
        case SortOrder.TITLE_ASC:
          return a.title.localeCompare(b.title);
        case SortOrder.TITLE_DESC:
          return b.title.localeCompare(a.title);
        case SortOrder.RATING_ASC:
          return (a.bggRating || 0) - (b.bggRating || 0);
        case SortOrder.RATING_DESC:
          return (b.bggRating || 0) - (a.bggRating || 0);
        case SortOrder.PLAYERS_ASC:
          return a.maxPlayers - b.maxPlayers;
        case SortOrder.PLAYERS_DESC:
          return b.maxPlayers - a.maxPlayers;
        default:
          return 0;
      }
    });
  }


  private loadGamesFromJson(): Observable<void> {
    return this.http.get<GameJson[]>('data/games.json').pipe(
      tap(gamesData => {
        this.games = gamesData.map(gameData => ({
          ...gameData,
          genres: this.stringToGameGenres(gameData.genre)
        }));
        this.gamesLoaded = true;
      }),
      map(() => void 0)
    );
  }

  private stringToGameGenres(genreString: string): GameGenre[] {
    // Split by '/' and trim whitespace, then map each part to a genre
    const genreParts = genreString.split('/').map(part => part.trim());
    const genres: GameGenre[] = [];
    
    for (const part of genreParts) {
      const lowerGenre = part.toLowerCase();
      
      // Handle specific genres first (most specific to least specific)
      if (lowerGenre.includes('card drafting')) {
        genres.push(GameGenre.CARD_DRAFTING);
      } else if (lowerGenre.includes('set‑collection') || lowerGenre.includes('set-collection')) {
        genres.push(GameGenre.SET_COLLECTION);
      } else if (lowerGenre.includes('route‑building') || lowerGenre.includes('route-building')) {
        genres.push(GameGenre.ROUTE_BUILDING);
      } else if (lowerGenre.includes('push‑your‑luck') || lowerGenre.includes('push-your-luck')) {
        genres.push(GameGenre.PUSH_YOUR_LUCK);
      } else if (lowerGenre.includes('engine-building') || lowerGenre.includes('engine‑building')) {
        genres.push(GameGenre.ENGINE_BUILDING);
      } else if (lowerGenre.includes('social deduction') || lowerGenre.includes('hidden role')) {
        genres.push(GameGenre.SOCIAL_DEDUCTION);
      } else if (lowerGenre.includes('area control') || lowerGenre.includes('territory')) {
        genres.push(GameGenre.AREA_CONTROL);
      } else if (lowerGenre.includes('rpg') || lowerGenre.includes('rpg-style')) {
        genres.push(GameGenre.RPG);
      } else if (lowerGenre.includes('miniatures') || lowerGenre.includes('arena combat')) {
        genres.push(GameGenre.MINIATURES);
      } else if (lowerGenre.includes('legacy') || lowerGenre.includes('campaign')) {
        genres.push(GameGenre.LEGACY);
      } else if (lowerGenre.includes('negotiation')) {
        genres.push(GameGenre.NEGOTIATION);
      } else if (lowerGenre.includes('deck‑builder') || lowerGenre.includes('deck-builder') || lowerGenre.includes('deck‑building') || lowerGenre.includes('deck-building')) {
        genres.push(GameGenre.DECK_BUILDING);
      } else if (lowerGenre.includes('dungeon crawl') || lowerGenre.includes('adventure')) {
        genres.push(GameGenre.ADVENTURE);
      } else if (lowerGenre.includes('dexterity') || lowerGenre.includes('action')) {
        genres.push(GameGenre.DEXTERITY);
      } else if (lowerGenre.includes('drinking')) {
        genres.push(GameGenre.DRINKING);
      } else if (lowerGenre.includes('horror')) {
        genres.push(GameGenre.HORROR);
      } else if (lowerGenre.includes('memory')) {
        genres.push(GameGenre.MEMORY);
      } else if (lowerGenre.includes('bluffing')) {
        genres.push(GameGenre.BLUFFING);
      } else if (lowerGenre.includes('strategy')) {
        genres.push(GameGenre.STRATEGY);
      } else if (lowerGenre.includes('party') || lowerGenre.includes('word game')) {
        genres.push(GameGenre.PARTY);
      } else if (lowerGenre.includes('cooperative') || lowerGenre.includes('co‑op') || lowerGenre.includes('boss‑battler')) {
        genres.push(GameGenre.COOPERATIVE);
      } else if (lowerGenre.includes('card') || lowerGenre.includes('drafting') || lowerGenre.includes('loot‑driven') || lowerGenre.includes('civilization building') || lowerGenre.includes('dice') || lowerGenre.includes('tableau') || lowerGenre.includes('risk‑management') || lowerGenre.includes('strategic card game')) {
        genres.push(GameGenre.CARD_GAME);
      } else if (lowerGenre.includes('euro')) {
        genres.push(GameGenre.EURO);
      } else if (lowerGenre.includes('thematic') || lowerGenre.includes('fantasy') || lowerGenre.includes('steampunk') || lowerGenre.includes('electronic')) {
        genres.push(GameGenre.THEMATIC);
      } else if (lowerGenre.includes('abstract') || lowerGenre.includes('puzzle') || lowerGenre.includes('tile-drafting') || lowerGenre.includes('map-building')) {
        genres.push(GameGenre.ABSTRACT);
      } else if (lowerGenre.includes('family') || lowerGenre.includes('garden')) {
        genres.push(GameGenre.FAMILY);
      } else if (lowerGenre.includes('asymmetric')) {
        genres.push(GameGenre.ASYMMETRIC);
      } else if (lowerGenre.includes('war') || lowerGenre.includes('one‑vs‑many')) {
        genres.push(GameGenre.WAR_GAME);
      } else {
        // Default fallback for unrecognized genres
        genres.push(GameGenre.STRATEGY);
      }
    }
    
    // Remove duplicates and return
    return Array.from(new Set(genres));
  }

  private matchesDuration(playTime: string, duration: GameDuration): boolean {
    // Extract numbers from playTime string
    const numbers = playTime.match(/\d+/g)?.map(Number) || [];
    if (numbers.length === 0) return false;
    
    // Get the maximum time (for ranges, use the higher number)
    const maxTime = Math.max(...numbers);
    
    switch (duration) {
      case GameDuration.SHORT:
        return maxTime <= 30;
      case GameDuration.MEDIUM:
        return maxTime >= 30 && maxTime <= 60;
      case GameDuration.LONG:
        return maxTime > 60 && maxTime <= 120;
      case GameDuration.EPIC:
        return maxTime > 120;
      default:
        return false;
    }
  }

}
