import { Component, EventEmitter, Input, Output } from '@angular/core';
import { CommonModule } from '@angular/common';
import { Game } from '../../models/game.model';
import { GameStats } from '../../services/data-aggregation.service';

@Component({
  selector: 'app-games-list',
  standalone: true,
  imports: [CommonModule],
  templateUrl: './games-list.component.html',
  styleUrls: ['./games-list.component.scss'],
})
export class GamesListComponent {
  @Input() games: Game[] = [];
  /** gameId → stats. Missing entries treated as zero-likes/zero-comments. */
  @Input() statsById: Record<string, GameStats> = {};

  @Output() open = new EventEmitter<Game>();

  trackById(_index: number, g: Game): string {
    return g.id;
  }

  playerLabel(g: Game): string {
    return g.minPlayers === g.maxPlayers ? `${g.minPlayers}` : `${g.minPlayers}–${g.maxPlayers}`;
  }

  topGenres(g: Game): string {
    return g.genres.slice(0, 2).join(' · ');
  }

  likes(g: Game): number {
    return this.statsById[g.id]?.totalLikes ?? 0;
  }

  comments(g: Game): number {
    return this.statsById[g.id]?.totalComments ?? 0;
  }
}
