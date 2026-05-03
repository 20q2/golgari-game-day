import { Component, EventEmitter, Input, Output } from '@angular/core';
import { CommonModule } from '@angular/common';
import { MatIconModule } from '@angular/material/icon';
import { Game, GameGenre } from '../../models/game.model';
import { HeroVariant } from '../games.utils';
import { GenreIconService } from '../../services/genre-icon.service';

@Component({
  selector: 'app-games-hero',
  standalone: true,
  imports: [CommonModule, MatIconModule],
  templateUrl: './games-hero.component.html',
  styleUrls: ['./games-hero.component.scss'],
})
export class GamesHeroComponent {
  @Input({ required: true }) game!: Game;
  @Input() variant: HeroVariant = 'most-loved';
  @Input() likeCount = 0;
  @Input() ratingValue?: number;

  @Output() open = new EventEmitter<Game>();

  constructor(public iconService: GenreIconService) {}

  onClick(): void {
    this.open.emit(this.game);
  }

  onKey(event: KeyboardEvent): void {
    if (event.key === 'Enter' || event.key === ' ') {
      event.preventDefault();
      this.open.emit(this.game);
    }
  }

  get badgeText(): string {
    switch (this.variant) {
      case 'most-loved':
        return this.likeCount === 1 ? 'MOST LOVED · 1 LIKE' : `MOST LOVED · ${this.likeCount} LIKES`;
      case 'highest-rated':
        return this.ratingValue != null ? `HIGHEST RATED · ${this.ratingValue.toFixed(1)}` : 'HIGHEST RATED';
      case 'recently-hot':
        return "WHAT'S HOT";
    }
  }

  get badgeIcon(): string {
    switch (this.variant) {
      case 'most-loved':
        return '♥';
      case 'highest-rated':
        return '★';
      case 'recently-hot':
        return '🔥';
    }
  }

  get genresShown(): GameGenre[] {
    return this.game.genres.slice(0, 3);
  }

  get playerLabel(): string {
    const { minPlayers, maxPlayers } = this.game;
    return minPlayers === maxPlayers ? `${minPlayers} players` : `${minPlayers}–${maxPlayers} players`;
  }
}
