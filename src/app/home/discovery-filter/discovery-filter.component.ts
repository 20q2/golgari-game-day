import { CommonModule } from '@angular/common';
import { Component, EventEmitter, Input, Output } from '@angular/core';
import { MatIconModule } from '@angular/material/icon';
import { GenreIconService } from '../../services/genre-icon.service';
import {
  DEFAULT_HOME_FILTER,
  HomeFilter,
  MOOD_OPTIONS,
  MoodFilter,
  PLAYER_OPTIONS,
  PlayerCountFilter,
  TIME_OPTIONS,
  TimeBucket,
} from '../home-filter.model';

@Component({
  selector: 'app-discovery-filter',
  standalone: true,
  imports: [CommonModule, MatIconModule],
  templateUrl: './discovery-filter.component.html',
  styleUrls: ['./discovery-filter.component.scss'],
})
export class DiscoveryFilterComponent {
  @Input() filter: HomeFilter = DEFAULT_HOME_FILTER;
  @Input() matchCount = 0;
  @Output() filterChange = new EventEmitter<HomeFilter>();
  @Output() resetClicked = new EventEmitter<void>();

  readonly playerOptions = PLAYER_OPTIONS;
  readonly timeOptions = TIME_OPTIONS;
  readonly moodOptions = MOOD_OPTIONS;

  constructor(public iconService: GenreIconService) {}

  selectPlayers(value: PlayerCountFilter): void {
    if (this.filter.players === value) return;
    this.filterChange.emit({ ...this.filter, players: value });
  }

  selectTime(value: TimeBucket): void {
    if (this.filter.timeMaxMinutes === value) return;
    this.filterChange.emit({ ...this.filter, timeMaxMinutes: value });
  }

  selectMood(value: MoodFilter): void {
    if (this.filter.mood === value) return;
    this.filterChange.emit({ ...this.filter, mood: value });
  }

  onReset(): void {
    this.resetClicked.emit();
  }
}
