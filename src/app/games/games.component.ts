import { Component, OnInit, OnDestroy } from '@angular/core';
import { CommonModule } from '@angular/common';
import { FormsModule } from '@angular/forms';
import { MatCardModule } from '@angular/material/card';
import { MatButtonModule } from '@angular/material/button';
import { MatIconModule } from '@angular/material/icon';
import { MatSelectModule } from '@angular/material/select';
import { MatInputModule } from '@angular/material/input';
import { MatFormFieldModule } from '@angular/material/form-field';
import { MatChipsModule } from '@angular/material/chips';
import { MatDialogModule, MatDialog } from '@angular/material/dialog';
import { Observable } from 'rxjs';
import { GamesService } from '../services/games.service';
import { Game, GameGenre, GameFilter, SortOrder, GameDuration } from '../models/game.model';
import { GameDetailsDialogComponent } from '../game-details-dialog/game-details-dialog.component';

@Component({
  selector: 'app-games',
  standalone: true,
  imports: [
    CommonModule,
    FormsModule,
    MatCardModule,
    MatButtonModule,
    MatIconModule,
    MatSelectModule,
    MatInputModule,
    MatFormFieldModule,
    MatChipsModule,
    MatDialogModule
  ],
  templateUrl: './games.component.html',
  styleUrls: ['./games.component.scss']
})
export class GamesComponent implements OnInit, OnDestroy {
  games$: Observable<Game[]>;
  genres = Object.values(GameGenre);
  alphabetizedGenres = Object.values(GameGenre).sort();
  durations = Object.values(GameDuration);
  sortOptions = [
    { value: SortOrder.TITLE_ASC, label: 'Title A-Z' },
    { value: SortOrder.TITLE_DESC, label: 'Title Z-A' },
    { value: SortOrder.RATING_DESC, label: 'Rating High-Low' },
    { value: SortOrder.RATING_ASC, label: 'Rating Low-High' },
    { value: SortOrder.PLAYERS_ASC, label: 'Players Low-High' },
    { value: SortOrder.PLAYERS_DESC, label: 'Players High-Low' }
  ];

  currentFilter: GameFilter = {};
  currentSort: SortOrder = SortOrder.TITLE_ASC;
  searchText = '';
  selectedGenres: GameGenre[] = [];
  selectedDuration?: GameDuration;

  constructor(
    private gamesService: GamesService,
    private dialog: MatDialog
  ) {
    // Get the reactive games observable that responds to all filter/sort changes
    this.games$ = this.gamesService.getGames();
  }

  ngOnInit(): void {
    document.body.className = 'games-page';
    this.gamesService.setFilter(this.currentFilter);
    this.gamesService.setSort(this.currentSort);
  }

  ngOnDestroy(): void {
    document.body.className = '';
  }

  onFilterChange(): void {
    this.currentFilter.searchText = this.searchText || undefined;
    this.gamesService.setFilter({ ...this.currentFilter });
  }

  onSortChange(): void {
    this.gamesService.setSort(this.currentSort);
  }

  clearFilters(): void {
    this.currentFilter = {};
    this.searchText = '';
    this.selectedGenres = [];
    this.selectedDuration = undefined;
    this.gamesService.setFilter(this.currentFilter);
  }

  onGenreFilterChange(genre: GameGenre): void {
    const index = this.selectedGenres.indexOf(genre);
    if (index >= 0) {
      // Remove genre if already selected
      this.selectedGenres.splice(index, 1);
    } else {
      // Add genre if not selected
      this.selectedGenres.push(genre);
    }
    
    this.currentFilter.genres = this.selectedGenres.length > 0 ? [...this.selectedGenres] : undefined;
    this.gamesService.setFilter({ ...this.currentFilter });
  }

  isGenreSelected(genre: GameGenre): boolean {
    return this.selectedGenres.includes(genre);
  }

  isDurationActive(playTime: string): boolean {
    if (!this.selectedDuration) return false;
    const gameDuration = this.parseDurationFromPlayTime(playTime);
    return gameDuration === this.selectedDuration;
  }

  onDurationFilterChange(): void {
    this.currentFilter.duration = this.selectedDuration;
    this.gamesService.setFilter({ ...this.currentFilter });
  }

  openGameDetails(game: Game): void {
    const dialogRef = this.dialog.open(GameDetailsDialogComponent, {
      data: game,
      width: '900px',
      maxWidth: '95vw',
      maxHeight: '95vh',
      panelClass: 'game-details-dialog'
    });

    dialogRef.afterClosed().subscribe(() => {
      // Refresh the games list to show updated comment counts
      this.games$ = this.gamesService.getGames();
    });
  }

  getRatingStars(rating?: number): string {
    if (!rating) return '☆☆☆☆☆';
    const stars = Math.round(rating);
    return '★'.repeat(Math.min(stars, 5)) + '☆'.repeat(Math.max(5 - stars, 0));
  }

  getGenreColor(genre: GameGenre): 'primary' | 'accent' | 'warn' | undefined {
    const genreColorMap: { [key in GameGenre]: 'primary' | 'accent' | 'warn' | undefined } = {
      [GameGenre.STRATEGY]: 'primary',
      [GameGenre.PARTY]: 'accent', 
      [GameGenre.COOPERATIVE]: 'primary',
      [GameGenre.CARD_GAME]: undefined, // Default color
      [GameGenre.DECK_BUILDING]: 'accent',
      [GameGenre.EURO]: 'primary',
      [GameGenre.THEMATIC]: 'warn',
      [GameGenre.ABSTRACT]: undefined,
      [GameGenre.FAMILY]: undefined,
      [GameGenre.WAR_GAME]: 'warn',
      [GameGenre.DRINKING]: 'accent',
      [GameGenre.ENGINE_BUILDING]: 'primary',
      [GameGenre.DEXTERITY]: 'accent',
      [GameGenre.SOCIAL_DEDUCTION]: 'warn',
      [GameGenre.BLUFFING]: 'warn',
      [GameGenre.MEMORY]: undefined,
      [GameGenre.ADVENTURE]: 'warn',
      [GameGenre.HORROR]: 'warn',
      [GameGenre.AREA_CONTROL]: 'primary',
      [GameGenre.RPG]: 'warn',
      [GameGenre.CARD_DRAFTING]: 'accent',
      [GameGenre.MINIATURES]: 'warn',
      [GameGenre.LEGACY]: 'warn',
      [GameGenre.NEGOTIATION]: 'accent',
      [GameGenre.ROUTE_BUILDING]: 'primary',
      [GameGenre.SET_COLLECTION]: 'primary',
      [GameGenre.PUSH_YOUR_LUCK]: undefined
    };
    
    return genreColorMap[genre];
  }

  getGenreIcon(genre: GameGenre): string {
    const genreIconMap: { [key in GameGenre]: string } = {
      [GameGenre.STRATEGY]: 'psychology',
      [GameGenre.PARTY]: 'celebration',
      [GameGenre.COOPERATIVE]: 'groups',
      [GameGenre.CARD_GAME]: 'style',
      [GameGenre.DECK_BUILDING]: 'layers',
      [GameGenre.EURO]: 'account_balance',
      [GameGenre.THEMATIC]: 'auto_stories',
      [GameGenre.ABSTRACT]: 'blur_on',
      [GameGenre.FAMILY]: 'family_restroom',
      [GameGenre.WAR_GAME]: 'gps_fixed',
      [GameGenre.DRINKING]: 'local_bar',
      [GameGenre.ENGINE_BUILDING]: 'settings',
      [GameGenre.DEXTERITY]: 'sports_esports',
      [GameGenre.SOCIAL_DEDUCTION]: 'group_work',
      [GameGenre.BLUFFING]: 'theater_comedy',
      [GameGenre.MEMORY]: 'psychology_alt',
      [GameGenre.ADVENTURE]: 'explore',
      [GameGenre.HORROR]: 'dark_mode',
      [GameGenre.AREA_CONTROL]: 'map',
      [GameGenre.RPG]: 'badge',
      [GameGenre.CARD_DRAFTING]: 'view_carousel',
      [GameGenre.MINIATURES]: 'toys',
      [GameGenre.LEGACY]: 'history_edu',
      [GameGenre.NEGOTIATION]: 'handshake',
      [GameGenre.ROUTE_BUILDING]: 'route',
      [GameGenre.SET_COLLECTION]: 'collections',
      [GameGenre.PUSH_YOUR_LUCK]: 'casino'
    };
    
    return genreIconMap[genre] || 'category';
  }

  trackByGameId(index: number, game: Game): string {
    return game.id;
  }

  onGenreChipClick(event: Event, genre: GameGenre): void {
    event.stopPropagation();
    this.onGenreFilterChange(genre);
  }

  onPlayerCountClick(event: Event, minPlayers: number, maxPlayers: number): void {
    event.stopPropagation();
    
    // Check if this same player count is already selected - if so, clear it
    if (this.currentFilter.minPlayers === minPlayers && this.currentFilter.maxPlayers === maxPlayers) {
      this.currentFilter.minPlayers = undefined;
      this.currentFilter.maxPlayers = undefined;
    } else {
      // Set both min and max player filters based on the clicked game
      this.currentFilter.minPlayers = minPlayers;
      this.currentFilter.maxPlayers = maxPlayers;
    }
    
    this.gamesService.setFilter({ ...this.currentFilter });
  }

  onDurationClick(event: Event, playTime: string): void {
    event.stopPropagation();
    
    // Parse the playTime to determine the appropriate duration filter
    const duration = this.parseDurationFromPlayTime(playTime);
    
    // Check if this same duration is already selected - if so, clear it
    if (this.selectedDuration === duration) {
      this.selectedDuration = undefined;
      this.currentFilter.duration = undefined;
    } else {
      // Set the duration filter
      this.selectedDuration = duration;
      this.currentFilter.duration = duration;
    }
    
    this.gamesService.setFilter({ ...this.currentFilter });
  }

  private parseDurationFromPlayTime(playTime: string): GameDuration | undefined {
    // Extract numbers from playTime string
    const numbers = playTime.match(/\d+/g)?.map(Number) || [];
    if (numbers.length === 0) return undefined;
    
    // Get the maximum time (for ranges, use the higher number)
    const maxTime = Math.max(...numbers);
    
    if (maxTime < 30) {
      return GameDuration.SHORT;
    } else if (maxTime >= 30 && maxTime <= 60) {
      return GameDuration.MEDIUM;
    } else if (maxTime > 60 && maxTime <= 120) {
      return GameDuration.LONG;
    } else {
      return GameDuration.EPIC;
    }
  }
}
