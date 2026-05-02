import { CommonModule } from '@angular/common';
import { Component, OnDestroy, OnInit } from '@angular/core';
import { MatDialog } from '@angular/material/dialog';
import { BehaviorSubject, combineLatest, Subscription } from 'rxjs';
import { map } from 'rxjs/operators';
import { GameDetailsDialogComponent } from '../game-details-dialog/game-details-dialog.component';
import { Game } from '../models/game.model';
import { DataAggregationService } from '../services/data-aggregation.service';
import { GamesService } from '../services/games.service';
import { ActivityStripComponent } from './activity-strip/activity-strip.component';
import { DiscoveryFilterComponent } from './discovery-filter/discovery-filter.component';
import { DiscoveryResultsComponent } from './discovery-results/discovery-results.component';
import {
  ActivityItem,
  buildActivityItems,
  rankGames,
  RankedGame,
} from './home-filter.helpers';
import {
  DEFAULT_HOME_FILTER,
  HOME_FILTER_STORAGE_KEY,
  HomeFilter,
} from './home-filter.model';

@Component({
  selector: 'app-home',
  standalone: true,
  imports: [
    CommonModule,
    DiscoveryFilterComponent,
    DiscoveryResultsComponent,
    ActivityStripComponent,
  ],
  templateUrl: './home.component.html',
  styleUrls: ['./home.component.scss'],
})
export class HomeComponent implements OnInit, OnDestroy {
  private readonly filterSubject = new BehaviorSubject<HomeFilter>(this.loadInitialFilter());

  filter: HomeFilter = this.filterSubject.value;
  rankedGames: RankedGame[] = [];
  activityItems: ActivityItem[] = [];

  private subscriptions = new Subscription();

  constructor(
    private gamesService: GamesService,
    private dataAggregation: DataAggregationService,
    private dialog: MatDialog,
  ) {}

  ngOnInit(): void {
    document.body.className = 'home-page';

    const dataSub = combineLatest([
      this.gamesService.getGames(),
      this.dataAggregation.allComments$,
      this.dataAggregation.allRatings$,
      this.dataAggregation.allLikes$,
      this.filterSubject,
    ])
      .pipe(
        map(([games, comments, ratings, likes, filter]) => {
          const ranked = rankGames(games, filter, comments, ratings, likes);
          const gameById = new Map<string, Game>(games.map((g) => [g.id, g]));
          const limit = window.matchMedia('(max-width: 768px)').matches ? 2 : 3;
          const activity = buildActivityItems(comments, ratings, likes, gameById, limit);
          return { ranked, activity };
        }),
      )
      .subscribe(({ ranked, activity }) => {
        this.rankedGames = ranked;
        this.activityItems = activity;
      });

    this.subscriptions.add(dataSub);
  }

  ngOnDestroy(): void {
    document.body.className = '';
    this.subscriptions.unsubscribe();
  }

  onFilterChange(filter: HomeFilter): void {
    this.filter = filter;
    this.filterSubject.next(filter);
    this.persistFilter(filter);
  }

  onResetFilter(): void {
    this.onFilterChange(DEFAULT_HOME_FILTER);
  }

  onGameSelected(gameId: string): void {
    const game =
      this.rankedGames.find((r) => r.game.id === gameId)?.game ??
      this.gamesService.getGameById(gameId);
    if (!game) return;
    this.dialog.open(GameDetailsDialogComponent, {
      data: game,
      width: '900px',
      maxWidth: '95vw',
    });
  }

  private loadInitialFilter(): HomeFilter {
    try {
      const raw = localStorage.getItem(HOME_FILTER_STORAGE_KEY);
      if (!raw) return DEFAULT_HOME_FILTER;
      const parsed = JSON.parse(raw) as HomeFilter;
      if (
        typeof parsed.players === 'number' &&
        (parsed.timeMaxMinutes === null || typeof parsed.timeMaxMinutes === 'number') &&
        typeof parsed.mood === 'string'
      ) {
        return parsed;
      }
      return DEFAULT_HOME_FILTER;
    } catch {
      return DEFAULT_HOME_FILTER;
    }
  }

  private persistFilter(filter: HomeFilter): void {
    try {
      localStorage.setItem(HOME_FILTER_STORAGE_KEY, JSON.stringify(filter));
    } catch {
      // Storage unavailable (private mode etc.) — silently ignore.
    }
  }
}
