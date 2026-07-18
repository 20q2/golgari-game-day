import { Component, OnDestroy, OnInit, inject } from '@angular/core';
import { CommonModule } from '@angular/common';
import { MatIconModule } from '@angular/material/icon';
import { QueueService } from '../../services/queue.service';
import { UserService } from '../../services/user.service';
import { GamesService } from '../../services/games.service';

/** One person-slot in a lobby's roster row: a filled seat is taken, an
 * outline seat is still needed to reach the game's minimum player count. */
interface Seat {
  filled: boolean;
}

@Component({
  selector: 'app-queue-panel',
  standalone: true,
  imports: [CommonModule, MatIconModule],
  templateUrl: './queue-panel.component.html',
  styleUrls: ['./queue-panel.component.scss'],
})
export class QueuePanelComponent implements OnInit, OnDestroy {
  readonly queue = inject(QueueService);
  private readonly userService = inject(UserService);
  private readonly gamesService = inject(GamesService);

  ngOnInit(): void {
    this.queue.startPolling();
  }

  ngOnDestroy(): void {
    this.queue.stopPolling();
  }

  imageFor(gameId: string): string | undefined {
    return this.gamesService.getGameById(gameId)?.imageUrl;
  }

  /** Minimum players needed to start, from the catalog. Falls back to the
   * current lobby size (so an unknown game just reads as "ready"). */
  minPlayers(gameId: string): number {
    const joined = this.joinedCount(gameId);
    return this.gamesService.getGameById(gameId)?.minPlayers ?? joined ?? 1;
  }

  joinedCount(gameId: string): number {
    return this.queue.entryFor(gameId)?.joined.length ?? 0;
  }

  isReady(gameId: string): boolean {
    return this.joinedCount(gameId) >= this.minPlayers(gameId);
  }

  /** How many more players are needed to reach the minimum. */
  needed(gameId: string): number {
    return Math.max(0, this.minPlayers(gameId) - this.joinedCount(gameId));
  }

  /** Seat row: one filled seat per joined player, plus outline seats up to
   * the minimum. Never fewer than the minimum, never fewer than the count. */
  seats(gameId: string): Seat[] {
    const joined = this.joinedCount(gameId);
    const total = Math.max(this.minPlayers(gameId), joined);
    return Array.from({ length: total }, (_, i) => ({ filled: i < joined }));
  }

  memberNames(gameId: string): string {
    const entry = this.queue.entryFor(gameId);
    if (!entry) return '';
    return entry.joined.map((m) => m.username || m.userId).join(', ');
  }

  async toggle(gameId: string, gameTitle: string): Promise<void> {
    if (!(await this.userService.requireSignIn())) return;
    if (this.queue.isJoined(gameId)) {
      await this.queue.leave(gameId);
    } else {
      await this.queue.join(gameId, gameTitle);
    }
  }
}
