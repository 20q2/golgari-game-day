import { Component, Inject, Optional } from '@angular/core';
import { CommonModule } from '@angular/common';
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
import { GenreIconService } from '../../services/genre-icon.service';

export interface FilterSheetData {
  filter: GameFilter;
  sort: SortOrder;
  genreCounts: GenreCount[]; // all genres, with counts
  /** Called every time the user mutates filter/sort inside the sheet, so
   *  the parent can apply changes live without a Done button. */
  onChange?: (state: FilterSheetResult) => void;
}

export interface FilterSheetResult {
  filter: GameFilter;
  sort: SortOrder;
}

@Component({
  selector: 'app-games-filter-sheet',
  standalone: true,
  imports: [CommonModule, MatIconModule],
  templateUrl: './games-filter-sheet.component.html',
  styleUrls: ['./games-filter-sheet.component.scss'],
})
export class GamesFilterSheetComponent {
  filter: GameFilter;
  sort: SortOrder;
  genreCounts: GenreCount[];

  private readonly onChange?: (state: FilterSheetResult) => void;

  durationOptions: { value: GameDuration; label: string }[] = [
    { value: GameDuration.SHORT, label: '< 30m' },
    { value: GameDuration.MEDIUM, label: '30–60m' },
    { value: GameDuration.LONG, label: '1–2h' },
    { value: GameDuration.EPIC, label: '2h+' },
  ];
  playerOptions: { value: number; label: string }[] = [
    { value: 1, label: '1' },
    { value: 2, label: '2' },
    { value: 3, label: '3' },
    { value: 4, label: '4' },
    { value: 5, label: '5' },
    { value: 6, label: '6' },
    { value: 7, label: '7+' },
  ];

  constructor(
    public iconService: GenreIconService,
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
    this.onChange = data.onChange;
  }

  /** Push the current filter/sort to the parent so changes apply live. */
  emit(): void {
    this.onChange?.({ filter: this.filter, sort: this.sort });
  }

  selectDuration(d: GameDuration | undefined): void {
    this.filter.duration = this.filter.duration === d ? undefined : d;
    this.emit();
  }

  selectPlayers(n: number | undefined): void {
    this.filter.supportedPlayers = this.filter.supportedPlayers === n ? undefined : n;
    this.emit();
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
    this.emit();
  }

  isSelected(genre: GameGenre): boolean {
    return !!this.filter.genres && this.filter.genres.includes(genre);
  }

  clearAll(): void {
    this.filter = { searchText: this.filter.searchText };
    this.sort = SortOrder.TITLE_ASC;
    this.emit();
  }

  cancel(): void {
    this.bottomSheetRef?.dismiss();
    this.dialogRef?.close();
  }
}
