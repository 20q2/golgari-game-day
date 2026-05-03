import { Component, EventEmitter, Input, Output } from '@angular/core';
import { CommonModule } from '@angular/common';
import { MatIconModule } from '@angular/material/icon';
import { GameGenre } from '../../models/game.model';
import { GenreCount } from '../games.utils';
import { GenreIconService } from '../../services/genre-icon.service';

@Component({
  selector: 'app-games-genre-strip',
  standalone: true,
  imports: [CommonModule, MatIconModule],
  templateUrl: './games-genre-strip.component.html',
  styleUrls: ['./games-genre-strip.component.scss'],
})
export class GamesGenreStripComponent {
  /** Top genres (already sliced) shown in the surface row. */
  @Input() topGenres: GenreCount[] = [];
  /** Total games in the catalog (for the "All N" chip). */
  @Input() totalCount = 0;
  /** Number of additional genres available behind "+N more". 0 hides the chip. */
  @Input() remainingCount = 0;
  /** Currently selected genre on the surface row. null = "All". */
  @Input() selectedGenre: GameGenre | null = null;
  /** True when more than one genre is selected in the sheet — surface row shows a "Multiple" pill instead. */
  @Input() multipleSelected = false;

  /** Emit a single genre to scope to. null = clear (return to "All"). */
  @Output() selectGenre = new EventEmitter<GameGenre | null>();
  /** Open the filter sheet (used by the "+N more" chip). */
  @Output() openFilters = new EventEmitter<void>();

  constructor(public iconService: GenreIconService) {}

  onChipClick(genre: GameGenre | null): void {
    if (this.multipleSelected) {
      // Tapping a chip while sheet has multi-select replaces with single.
      this.selectGenre.emit(genre);
      return;
    }
    if (genre !== null && this.selectedGenre === genre) {
      // Toggle off — return to "All".
      this.selectGenre.emit(null);
      return;
    }
    this.selectGenre.emit(genre);
  }
}
