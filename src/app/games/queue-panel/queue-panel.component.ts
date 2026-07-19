import { Component, OnDestroy, OnInit, inject } from '@angular/core';
import { CommonModule } from '@angular/common';
import { MatIconModule } from '@angular/material/icon';
import { MatDialog } from '@angular/material/dialog';
import { QueueService } from '../../services/queue.service';
import { UserService } from '../../services/user.service';
import { GamesService } from '../../services/games.service';
import { CloseResult } from '../../services/queue-models';
import { CloseOutDialogComponent, CloseOutData } from './close-out-dialog.component';

/**
 * One person-slot in a lobby's roster row.
 *  - filled:   a player is in this seat
 *  - required: this seat counts toward the game's minimum to start
 *  - minEdge:  this is the last required seat — draw the "minimum" divider
 *              after it (only when the game seats more than its minimum)
 *  - overflow: this seat sits past the game's catalogued max — an extra body
 *              we squeezed in (flagged red). Only ever shown when filled.
 */
interface Seat {
  filled: boolean;
  required: boolean;
  minEdge: boolean;
  overflow: boolean;
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
  private readonly dialog = inject(MatDialog);

  ngOnInit(): void {
    this.queue.startPolling();
  }

  ngOnDestroy(): void {
    this.queue.stopPolling();
  }

  imageFor(gameId: string): string | undefined {
    return this.gamesService.getGameById(gameId)?.imageUrl;
  }

  joinedCount(gameId: string): number {
    return this.queue.entryFor(gameId)?.joined.length ?? 0;
  }

  /** Minimum players needed to start, from the catalog. Falls back to the
   * current lobby size (so an unknown game just reads as "ready"). */
  minPlayers(gameId: string): number {
    return this.gamesService.getGameById(gameId)?.minPlayers ?? this.joinedCount(gameId) ?? 1;
  }

  /** Maximum players the game seats, from the catalog. Never less than the
   * minimum, and never less than however many have already piled in. */
  maxPlayers(gameId: string): number {
    const fromCatalog = this.gamesService.getGameById(gameId)?.maxPlayers;
    return Math.max(fromCatalog ?? 0, this.minPlayers(gameId), this.joinedCount(gameId));
  }

  isReady(gameId: string): boolean {
    return this.joinedCount(gameId) >= this.minPlayers(gameId);
  }

  /** How many more players are needed to reach the minimum. */
  needed(gameId: string): number {
    return Math.max(0, this.minPlayers(gameId) - this.joinedCount(gameId));
  }

  /** One seat per player the game can seat (its maximum). Filled seats are
   * players already in; required seats count toward the minimum; the seat at
   * the minimum draws a divider so everything past it reads as extra capacity. */
  seats(gameId: string): Seat[] {
    const joined = this.joinedCount(gameId);
    const min = this.minPlayers(gameId);
    const total = this.maxPlayers(gameId);
    // The game's catalogued ceiling — seats past this are extra bodies we
    // squeezed in beyond what the box seats.
    const cap = this.gamesService.getGameById(gameId)?.maxPlayers ?? total;
    return Array.from({ length: total }, (_, i) => ({
      filled: i < joined,
      required: i < min,
      minEdge: i === min - 1 && min < total,
      overflow: i >= cap,
    }));
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

  isActive(gameId: string): boolean {
    return this.queue.statusOf(gameId) === 'active';
  }

  async start(gameId: string): Promise<void> {
    if (!this.isReady(gameId)) return; // can't start until the minimum is met
    if (!(await this.userService.requireSignIn())) return;
    await this.queue.start(gameId);
  }

  async closeOut(entryGameId: string, gameTitle: string): Promise<void> {
    if (!(await this.userService.requireSignIn())) return;
    const entry = this.queue.entryFor(entryGameId);
    if (!entry) return;
    const data: CloseOutData = { gameTitle, roster: entry.joined };
    const result: CloseResult | null | undefined = await this.dialog
      .open(CloseOutDialogComponent, { data, width: '320px' })
      .afterClosed()
      .toPromise();
    if (result) {
      await this.queue.close(entryGameId, result);
    }
  }
}
