import { Component, OnDestroy, OnInit } from '@angular/core';
import { CommonModule } from '@angular/common';
import { MatDialog } from '@angular/material/dialog';
import { MatBottomSheet } from '@angular/material/bottom-sheet';
import { BreakpointObserver, Breakpoints } from '@angular/cdk/layout';
import { combineLatest, Observable, Subject } from 'rxjs';
import { map, takeUntil } from 'rxjs/operators';

import { GamesService } from '../services/games.service';
import { DataAggregationService, GameStats } from '../services/data-aggregation.service';
import {
  Game,
  GameDuration,
  GameFilter,
  GameGenre,
  SortOrder,
} from '../models/game.model';
import { GameDetailsDialogComponent } from '../game-details-dialog/game-details-dialog.component';

import {
  GamesFilterSheetComponent,
  FilterSheetData,
  FilterSheetResult,
} from './games-filter-sheet/games-filter-sheet.component';
import { GamesSearchBarComponent } from './games-search-bar/games-search-bar.component';
import { GamesGenreStripComponent } from './games-genre-strip/games-genre-strip.component';
import { GamesHeroComponent } from './games-hero/games-hero.component';
import { GamesListComponent } from './games-list/games-list.component';

import {
  countActiveFilters,
  GenreCount,
  HeroSelection,
  pickHero,
  topGenres as topGenresUtil,
} from './games.utils';

interface PersistedFilter {
  genres?: GameGenre[];
  duration?: GameDuration;
  supportedPlayers?: number;
  sort: SortOrder;
}

const STORAGE_KEY = 'gameday-games-filter';
const SURFACE_GENRE_COUNT = 6;

@Component({
  selector: 'app-games',
  standalone: true,
  imports: [
    CommonModule,
    GamesSearchBarComponent,
    GamesGenreStripComponent,
    GamesHeroComponent,
    GamesListComponent,
  ],
  templateUrl: './games.component.html',
  styleUrls: ['./games.component.scss'],
})
export class GamesComponent implements OnInit, OnDestroy {
  // Reactive state
  filteredGames$: Observable<Game[]>;
  hero$: Observable<HeroSelection | null>;
  statsById$: Observable<Record<string, GameStats>>;

  // Mutable filter state (mirrored to GamesService and persisted)
  filter: GameFilter = {};
  sort: SortOrder = SortOrder.TITLE_ASC;
  searchText = '';

  // Catalog-derived (set on first emission, not reactive to filters)
  totalCount = 0;
  topGenresList: GenreCount[] = [];
  allGenreCounts: GenreCount[] = [];
  remainingCount = 0;

  // Whether any filter beyond search hides the hero
  get isFiltered(): boolean {
    return (
      !!this.searchText ||
      (!!this.filter.genres && this.filter.genres.length > 0) ||
      !!this.filter.duration ||
      this.filter.supportedPlayers != null
    );
  }

  get activeFilterCount(): number {
    return countActiveFilters(this.filter);
  }

  /** Surface row's selected genre. null = all. Multi-select reflected via multipleSelected flag. */
  get selectedGenre(): GameGenre | null {
    if (!this.filter.genres || this.filter.genres.length === 0) return null;
    if (this.filter.genres.length === 1) return this.filter.genres[0];
    return null;
  }

  get multipleGenresSelected(): boolean {
    return !!this.filter.genres && this.filter.genres.length > 1;
  }

  private destroy$ = new Subject<void>();

  constructor(
    private gamesService: GamesService,
    private dataAggregation: DataAggregationService,
    private dialog: MatDialog,
    private bottomSheet: MatBottomSheet,
    private breakpoints: BreakpointObserver,
  ) {
    this.filteredGames$ = this.gamesService.getGames();

    this.statsById$ = this.dataAggregation.getAllGamesStats().pipe(
      map(arr => {
        const out: Record<string, GameStats> = {};
        for (const s of arr) out[s.gameId] = s;
        return out;
      }),
    );

    // Hero is computed from the unfiltered catalog so it represents
    // "the most-loved game across the whole collection," not "most-loved
    // among current results." (The hero is also hidden when filters are
    // active, but using the catalog keeps the badge stable when the user
    // clears filters.)
    this.hero$ = combineLatest([
      this.gamesService.getCatalog(),
      this.dataAggregation.getAllGamesStats(),
    ]).pipe(map(([games, stats]) => pickHero(games, stats)));
  }

  ngOnInit(): void {
    document.body.className = 'games-page';

    // Restore persisted filter (excluding searchText)
    const persisted = this.readPersisted();
    if (persisted) {
      this.filter = {
        genres: persisted.genres,
        duration: persisted.duration,
        supportedPlayers: persisted.supportedPlayers,
      };
      this.sort = persisted.sort;
    }

    // Derive catalog-wide counts once from the unfiltered catalog.
    // getCatalog() emits the full list independent of the active filter, so
    // these numbers stay stable as the user narrows results.
    this.gamesService.getCatalog()
      .pipe(takeUntil(this.destroy$))
      .subscribe(catalog => {
        this.totalCount = catalog.length;
        this.allGenreCounts = topGenresUtil(catalog, Number.POSITIVE_INFINITY);
        this.topGenresList = this.allGenreCounts.slice(0, SURFACE_GENRE_COUNT);
        this.remainingCount = Math.max(0, this.allGenreCounts.length - this.topGenresList.length);
      });

    this.gamesService.setFilter({ ...this.filter });
    this.gamesService.setSort(this.sort);
  }

  ngOnDestroy(): void {
    document.body.className = '';
    this.destroy$.next();
    this.destroy$.complete();
  }

  // ---- Search ----

  onSearchTextChange(value: string): void {
    this.searchText = value;
    this.filter.searchText = value || undefined;
    this.gamesService.setFilter({ ...this.filter });
  }

  // ---- Genre strip (single-select) ----

  onSelectGenre(genre: GameGenre | null): void {
    this.filter.genres = genre ? [genre] : undefined;
    this.gamesService.setFilter({ ...this.filter });
    this.persist();
  }

  // ---- Hero ----

  onOpenGame(game: Game): void {
    this.dialog.open(GameDetailsDialogComponent, {
      data: game,
      width: '900px',
      maxWidth: '95vw',
      maxHeight: '95vh',
      panelClass: 'game-details-dialog',
    });
  }

  // ---- Filter sheet ----

  openFilters(): void {
    const data: FilterSheetData = {
      filter: { ...this.filter },
      sort: this.sort,
      genreCounts: this.allGenreCounts,
    };

    const isMobile = this.breakpoints.isMatched(Breakpoints.HandsetPortrait)
      || this.breakpoints.isMatched(Breakpoints.HandsetLandscape);

    if (isMobile) {
      const ref = this.bottomSheet.open<GamesFilterSheetComponent, FilterSheetData, FilterSheetResult>(
        GamesFilterSheetComponent,
        { data, panelClass: 'games-filter-sheet-panel' },
      );
      ref.afterDismissed().subscribe(result => this.applySheetResult(result ?? null));
    } else {
      const ref = this.dialog.open<GamesFilterSheetComponent, FilterSheetData, FilterSheetResult>(
        GamesFilterSheetComponent,
        {
          data,
          width: '480px',
          maxWidth: '90vw',
          panelClass: 'games-filter-sheet-panel',
        },
      );
      ref.afterClosed().subscribe(result => this.applySheetResult(result ?? null));
    }
  }

  private applySheetResult(result: FilterSheetResult | null): void {
    if (!result) return;
    this.filter = { ...result.filter, searchText: this.searchText || undefined };
    this.sort = result.sort;
    this.gamesService.setFilter({ ...this.filter });
    this.gamesService.setSort(this.sort);
    this.persist();
  }

  // ---- Persistence ----

  private readPersisted(): PersistedFilter | null {
    try {
      const raw = localStorage.getItem(STORAGE_KEY);
      if (!raw) return null;
      const parsed = JSON.parse(raw) as PersistedFilter;
      if (!parsed.sort) return null;
      return parsed;
    } catch {
      return null;
    }
  }

  private persist(): void {
    const payload: PersistedFilter = {
      genres: this.filter.genres,
      duration: this.filter.duration,
      supportedPlayers: this.filter.supportedPlayers,
      sort: this.sort,
    };
    try {
      localStorage.setItem(STORAGE_KEY, JSON.stringify(payload));
    } catch {
      // localStorage may be unavailable (private mode); silently ignore.
    }
  }
}
