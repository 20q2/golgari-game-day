import { Component, Inject, Optional } from '@angular/core';
import { CommonModule } from '@angular/common';
import { FormsModule } from '@angular/forms';
import { MatFormFieldModule } from '@angular/material/form-field';
import { MatSelectModule } from '@angular/material/select';
import { MatInputModule } from '@angular/material/input';
import { MatIconModule } from '@angular/material/icon';
import {
  MatBottomSheetRef,
  MAT_BOTTOM_SHEET_DATA,
} from '@angular/material/bottom-sheet';
import { MatDialogRef, MAT_DIALOG_DATA } from '@angular/material/dialog';
import {
  GameDuration,
  GameFilter,
  GameGenre,
  SortOrder,
} from '../../models/game.model';
import { GenreCount } from '../games.utils';

export interface FilterSheetData {
  filter: GameFilter;
  sort: SortOrder;
  genreCounts: GenreCount[]; // all genres, with counts
}

export interface FilterSheetResult {
  filter: GameFilter;
  sort: SortOrder;
}

@Component({
  selector: 'app-games-filter-sheet',
  standalone: true,
  imports: [
    CommonModule,
    FormsModule,
    MatFormFieldModule,
    MatSelectModule,
    MatInputModule,
    MatIconModule,
  ],
  templateUrl: './games-filter-sheet.component.html',
  styleUrls: ['./games-filter-sheet.component.scss'],
})
export class GamesFilterSheetComponent {
  filter: GameFilter;
  sort: SortOrder;
  genreCounts: GenreCount[];

  durations = Object.values(GameDuration);
  sortOptions = [
    { value: SortOrder.TITLE_ASC, label: 'Title A–Z' },
    { value: SortOrder.TITLE_DESC, label: 'Title Z–A' },
    { value: SortOrder.RATING_DESC, label: 'Rating high → low' },
    { value: SortOrder.RATING_ASC, label: 'Rating low → high' },
    { value: SortOrder.PLAYERS_ASC, label: 'Players low → high' },
    { value: SortOrder.PLAYERS_DESC, label: 'Players high → low' },
  ];

  constructor(
    @Optional() private bottomSheetRef: MatBottomSheetRef<GamesFilterSheetComponent, FilterSheetResult>,
    @Optional() private dialogRef: MatDialogRef<GamesFilterSheetComponent, FilterSheetResult>,
    @Optional() @Inject(MAT_BOTTOM_SHEET_DATA) bottomSheetData: FilterSheetData,
    @Optional() @Inject(MAT_DIALOG_DATA) dialogData: FilterSheetData,
  ) {
    const data = bottomSheetData ?? dialogData;
    // Clone arrays so the sheet can mutate freely without leaking back via reference.
    this.filter = {
      genres: data.filter.genres ? [...data.filter.genres] : undefined,
      duration: data.filter.duration,
      supportedPlayers: data.filter.supportedPlayers,
      searchText: data.filter.searchText,
    };
    this.sort = data.sort;
    this.genreCounts = data.genreCounts;
  }

  toggleGenre(genre: GameGenre): void {
    const current = this.filter.genres ?? [];
    const i = current.indexOf(genre);
    if (i >= 0) {
      const next = [...current];
      next.splice(i, 1);
      this.filter.genres = next.length ? next : undefined;
    } else {
      this.filter.genres = [...current, genre];
    }
  }

  isSelected(genre: GameGenre): boolean {
    return !!this.filter.genres && this.filter.genres.includes(genre);
  }

  clearAll(): void {
    this.filter = { searchText: this.filter.searchText };
    this.sort = SortOrder.TITLE_ASC;
  }

  done(): void {
    const result: FilterSheetResult = { filter: this.filter, sort: this.sort };
    this.bottomSheetRef?.dismiss(result);
    this.dialogRef?.close(result);
  }

  cancel(): void {
    this.bottomSheetRef?.dismiss();
    this.dialogRef?.close();
  }
}
