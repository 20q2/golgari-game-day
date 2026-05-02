import { CommonModule } from '@angular/common';
import { Component, EventEmitter, Input, Output } from '@angular/core';
import { MatIconModule } from '@angular/material/icon';
import { ActivityItem, ActivityType } from '../home-filter.helpers';

@Component({
  selector: 'app-activity-strip',
  standalone: true,
  imports: [CommonModule, MatIconModule],
  templateUrl: './activity-strip.component.html',
  styleUrls: ['./activity-strip.component.scss'],
})
export class ActivityStripComponent {
  @Input() items: ActivityItem[] = [];
  @Output() gameSelected = new EventEmitter<string>();

  iconFor(type: ActivityType): string {
    switch (type) {
      case 'rating':
        return 'star';
      case 'comment':
        return 'chat_bubble_outline';
      case 'like':
        return 'favorite';
    }
  }

  verbFor(type: ActivityType): string {
    switch (type) {
      case 'rating':
        return 'rated';
      case 'comment':
        return 'commented on';
      case 'like':
        return 'liked';
    }
  }

  trackByIndex(i: number): number {
    return i;
  }

  onSelect(gameId: string): void {
    this.gameSelected.emit(gameId);
  }
}
