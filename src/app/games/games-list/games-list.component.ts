import { Component, EventEmitter, Input, Output, inject } from '@angular/core';
import { CommonModule } from '@angular/common';
import { MatIconModule } from '@angular/material/icon';
import { Game, GameGenre } from '../../models/game.model';
import { GameStats } from '../../services/data-aggregation.service';
import { GenreIconService } from '../../services/genre-icon.service';
import { QueueService } from '../../services/queue.service';
import { UserService } from '../../services/user.service';

@Component({
  selector: 'app-games-list',
  standalone: true,
  imports: [CommonModule, MatIconModule],
  templateUrl: './games-list.component.html',
  styleUrls: ['./games-list.component.scss'],
})
export class GamesListComponent {
  @Input() games: Game[] = [];
  /** gameId → stats. Missing entries treated as zero-likes/zero-comments. */
  @Input() statsById: Record<string, GameStats> = {};

  @Output() open = new EventEmitter<Game>();

  readonly queue = inject(QueueService);
  private readonly userService = inject(UserService);

  constructor(public iconService: GenreIconService) {}

  trackById(_index: number, g: Game): string {
    return g.id;
  }

  playerLabel(g: Game): string {
    return g.minPlayers === g.maxPlayers ? `${g.minPlayers}` : `${g.minPlayers}–${g.maxPlayers}`;
  }

  topGenres(g: Game): GameGenre[] {
    return g.genres.slice(0, 2);
  }

  extraGenresCount(g: Game): number {
    return Math.max(0, g.genres.length - 2);
  }

  likes(g: Game): number {
    return this.statsById[g.id]?.totalLikes ?? 0;
  }

  comments(g: Game): number {
    return this.statsById[g.id]?.totalComments ?? 0;
  }

  queuedCount(g: Game): number {
    return this.queue.entryFor(g.id)?.joined.length ?? 0;
  }

  async toggleQueue(event: Event, g: Game): Promise<void> {
    event.stopPropagation(); // don't also open the game details dialog
    if (!(await this.userService.requireSignIn())) return;
    if (this.queue.isJoined(g.id)) {
      await this.queue.leave(g.id);
    } else {
      await this.queue.join(g.id, g.title);
    }
  }
}
