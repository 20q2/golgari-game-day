import { CommonModule } from '@angular/common';
import { Component, EventEmitter, Input, Output } from '@angular/core';
import { MatIconModule } from '@angular/material/icon';
import { GameGenre } from '../../models/game.model';
import { GenreIconService } from '../../services/genre-icon.service';
import { RankedGame } from '../home-filter.helpers';

@Component({
  selector: 'app-discovery-results',
  standalone: true,
  imports: [CommonModule, MatIconModule],
  templateUrl: './discovery-results.component.html',
  styleUrls: ['./discovery-results.component.scss'],
})
export class DiscoveryResultsComponent {
  @Input() rankedGames: RankedGame[] = [];
  @Output() gameSelected = new EventEmitter<string>();

  constructor(public iconService: GenreIconService) {}

  badgeClassFor(genre: GameGenre): string {
    const color = this.iconService.colorFor(genre);
    if (color === 'primary') return 'gb-primary';
    if (color === 'accent') return 'gb-accent';
    if (color === 'warn') return 'gb-warn';
    return 'gb-default';
  }

  trackById(_index: number, item: RankedGame): string {
    return item.game.id;
  }

  onSelect(gameId: string): void {
    this.gameSelected.emit(gameId);
  }
}
