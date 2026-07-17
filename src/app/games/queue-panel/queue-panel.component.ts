import { Component, OnDestroy, OnInit, inject } from '@angular/core';
import { CommonModule } from '@angular/common';
import { MatIconModule } from '@angular/material/icon';
import { QueueService } from '../../services/queue.service';
import { UserService } from '../../services/user.service';

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

  ngOnInit(): void {
    this.queue.startPolling();
  }

  ngOnDestroy(): void {
    this.queue.stopPolling();
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
