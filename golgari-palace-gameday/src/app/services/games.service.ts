import { Injectable } from '@angular/core';
import { HttpClient } from '@angular/common/http';
import { BehaviorSubject, Observable, combineLatest } from 'rxjs';
import { map, tap, switchMap } from 'rxjs/operators';
import { Game, GameGenre, GameFilter, SortOrder, GameComment, GameJson, GameDuration } from '../models/game.model';

@Injectable({
  providedIn: 'root'
})
export class GamesService {
  private games: Game[] = [];
  private gamesLoaded = false;

  private filterSubject = new BehaviorSubject<GameFilter>({});
  private sortSubject = new BehaviorSubject<SortOrder>(SortOrder.TITLE_ASC);

  constructor(private http: HttpClient) {}

  getGames(): Observable<Game[]> {
    if (!this.gamesLoaded) {
      return this.loadGamesFromJson().pipe(
        switchMap(() => this.getFilteredAndSortedGames())
      );
    }
    
    return this.getFilteredAndSortedGames();
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

  addComment(gameId: string, comment: Omit<GameComment, 'id' | 'timestamp'>): void {
    const game = this.getGameById(gameId);
    if (game) {
      const newComment: GameComment = {
        ...comment,
        id: Date.now().toString(),
        timestamp: new Date()
      };
      game.comments.push(newComment);
      this.saveCommentsToStorage();
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
      if (filter.minPlayers && filter.maxPlayers) {
        // If both min and max are set (clicked from a specific game), show games playable "up to" that many players
        if (game.maxPlayers > filter.maxPlayers) {
          return false;
        }
      } else {
        // Individual filters
        if (filter.minPlayers && game.maxPlayers < filter.minPlayers) {
          return false;
        }
        if (filter.maxPlayers && game.minPlayers > filter.maxPlayers) {
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

  private saveCommentsToStorage(): void {
    const comments: { [gameId: string]: GameComment[] } = {};
    this.games.forEach(game => {
      if (game.comments.length > 0) {
        comments[game.id] = game.comments;
      }
    });
    localStorage.setItem('gameComments', JSON.stringify(comments));
  }

  private loadGamesFromJson(): Observable<void> {
    return this.http.get<GameJson[]>('data/games.json').pipe(
      tap(gamesData => {
        this.games = gamesData.map(gameData => ({
          ...gameData,
          genres: this.stringToGameGenres(gameData.genre),
          comments: []
        }));
        this.gamesLoaded = true;
        this.loadCommentsFromStorage();
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
      } else if (lowerGenre.includes('war') || lowerGenre.includes('one‑vs‑many') || lowerGenre.includes('asymmetric')) {
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
        return maxTime < 30;
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

  private loadCommentsFromStorage(): void {
    const stored = localStorage.getItem('gameComments');
    if (stored) {
      const comments: { [gameId: string]: GameComment[] } = JSON.parse(stored);
      this.games.forEach(game => {
        if (comments[game.id]) {
          game.comments = comments[game.id].map(comment => ({
            ...comment,
            timestamp: new Date(comment.timestamp)
          }));
        }
      });
    }
  }
}
