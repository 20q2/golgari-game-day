import { Component, OnInit } from '@angular/core';
import { CommonModule } from '@angular/common';
import { MatCardModule } from '@angular/material/card';
import { MatIconModule } from '@angular/material/icon';
import { MatChipsModule } from '@angular/material/chips';
import { MatDividerModule } from '@angular/material/divider';
import { Observable } from 'rxjs';
import { GamesService } from '../services/games.service';
import { GlobalStats, UserStats, GameStats } from '../services/data-aggregation.service';

@Component({
  selector: 'app-statistics',
  standalone: true,
  imports: [
    CommonModule,
    MatCardModule,
    MatIconModule,
    MatChipsModule,
    MatDividerModule
  ],
  templateUrl: './statistics.component.html',
  styleUrls: ['./statistics.component.scss']
})
export class StatisticsComponent implements OnInit {
  globalStats$!: Observable<GlobalStats>;
  userStats$!: Observable<UserStats[]>;
  gameStats$!: Observable<GameStats[]>;

  constructor(private gamesService: GamesService) {}

  ngOnInit(): void {
    this.globalStats$ = this.gamesService.getGlobalStats();
    this.userStats$ = this.gamesService.getUserStats();
    this.gameStats$ = this.gamesService.getAllGamesStats();
  }

  getRatingStars(rating: number | null): string {
    if (!rating) return '☆☆☆☆☆';
    const stars = Math.round(rating);
    return '★'.repeat(Math.min(stars, 5)) + '☆'.repeat(Math.max(5 - stars, 0));
  }
}
