import { Component, EventEmitter, Input, Output } from '@angular/core';
import { CommonModule } from '@angular/common';
import { Game } from '../../models/game.model';
import { HeroVariant } from '../games.utils';

@Component({
  selector: 'app-games-hero',
  standalone: true,
  imports: [CommonModule],
  templateUrl: './games-hero.component.html',
  styleUrls: ['./games-hero.component.scss'],
})
export class GamesHeroComponent {
  @Input({ required: true }) game!: Game;
  @Input() variant: HeroVariant = 'top-rated';
  @Input() likeCount = 0;

  @Output() open = new EventEmitter<Game>();

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
    if (this.variant === 'most-loved') {
      return this.likeCount === 1 ? 'MOST LOVED · 1 LIKE' : `MOST LOVED · ${this.likeCount} LIKES`;
    }
    return 'TOP RATED';
  }

  get badgeIcon(): '♥' | '★' {
    return this.variant === 'most-loved' ? '♥' : '★';
  }

  get genresShown(): string[] {
    return this.game.genres.slice(0, 3);
  }

  get playerLabel(): string {
    const { minPlayers, maxPlayers } = this.game;
    return minPlayers === maxPlayers ? `${minPlayers} players` : `${minPlayers}–${maxPlayers} players`;
  }
}
