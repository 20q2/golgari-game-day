import { Component, Inject, OnInit, OnDestroy } from '@angular/core';
import { CommonModule } from '@angular/common';
import { FormsModule } from '@angular/forms';
import { MatDialogModule, MatDialogRef, MAT_DIALOG_DATA } from '@angular/material/dialog';
import { MatButtonModule } from '@angular/material/button';
import { MatIconModule } from '@angular/material/icon';
import { MatFormFieldModule } from '@angular/material/form-field';
import { MatInputModule } from '@angular/material/input';
import { MatSelectModule } from '@angular/material/select';
import { MatChipsModule } from '@angular/material/chips';
import { MatCardModule } from '@angular/material/card';
import { MatDividerModule } from '@angular/material/divider';
import { GamesService } from '../services/games.service';
import { Game, GameComment, GameGenre } from '../models/game.model';

@Component({
  selector: 'app-game-details-dialog',
  standalone: true,
  imports: [
    CommonModule,
    FormsModule,
    MatDialogModule,
    MatButtonModule,
    MatIconModule,
    MatFormFieldModule,
    MatInputModule,
    MatSelectModule,
    MatChipsModule,
    MatCardModule,
    MatDividerModule
  ],
  templateUrl: './game-details-dialog.component.html',
  styleUrls: ['./game-details-dialog.component.scss']
})
export class GameDetailsDialogComponent implements OnInit, OnDestroy {
  newComment = {
    username: '',
    comment: '',
    rating: undefined as number | undefined
  };

  ratings = [1, 2, 3, 4, 5, 6, 7, 8, 9, 10];

  constructor(
    public dialogRef: MatDialogRef<GameDetailsDialogComponent>,
    @Inject(MAT_DIALOG_DATA) public game: Game,
    private gamesService: GamesService
  ) {}

  ngOnInit(): void {
    // Update game data to get latest comments
    const updatedGame = this.gamesService.getGameById(this.game.id);
    if (updatedGame) {
      this.game = updatedGame;
    }
  }

  ngOnDestroy(): void {
    // No background changes needed for dialogs
  }

  addComment(): void {
    if (this.newComment.username.trim() && this.newComment.comment.trim()) {
      this.gamesService.addComment(this.game.id, {
        username: this.newComment.username.trim(),
        comment: this.newComment.comment.trim(),
        rating: this.newComment.rating
      });

      // Update local game data
      const updatedGame = this.gamesService.getGameById(this.game.id);
      if (updatedGame) {
        this.game = updatedGame;
      }

      // Reset form
      this.newComment = {
        username: '',
        comment: '',
        rating: undefined
      };
    }
  }

  getRatingStars(rating?: number): string {
    if (!rating) return '☆☆☆☆☆';
    const stars = Math.round(rating);
    return '★'.repeat(Math.min(stars, 5)) + '☆'.repeat(Math.max(5 - stars, 0));
  }

  getAverageRating(): number | null {
    const ratingsWithValues = this.game.comments.filter(c => c.rating).map(c => c.rating!);
    if (ratingsWithValues.length === 0) return null;
    return ratingsWithValues.reduce((sum, rating) => sum + rating, 0) / ratingsWithValues.length;
  }

  getGenreIcon(genre: GameGenre): string {
    const genreIconMap: { [key in GameGenre]: string } = {
      [GameGenre.STRATEGY]: 'psychology',
      [GameGenre.PARTY]: 'celebration',
      [GameGenre.COOPERATIVE]: 'groups',
      [GameGenre.CARD_GAME]: 'style',
      [GameGenre.DECK_BUILDING]: 'layers',
      [GameGenre.EURO]: 'account_balance',
      [GameGenre.THEMATIC]: 'auto_stories',
      [GameGenre.ABSTRACT]: 'blur_on',
      [GameGenre.FAMILY]: 'family_restroom',
      [GameGenre.WAR_GAME]: 'gps_fixed',
      [GameGenre.DRINKING]: 'local_bar',
      [GameGenre.ENGINE_BUILDING]: 'settings',
      [GameGenre.DEXTERITY]: 'sports_esports',
      [GameGenre.SOCIAL_DEDUCTION]: 'group_work',
      [GameGenre.BLUFFING]: 'theater_comedy',
      [GameGenre.MEMORY]: 'psychology_alt',
      [GameGenre.ADVENTURE]: 'explore',
      [GameGenre.HORROR]: 'dark_mode',
      [GameGenre.AREA_CONTROL]: 'map',
      [GameGenre.RPG]: 'badge',
      [GameGenre.CARD_DRAFTING]: 'view_carousel',
      [GameGenre.MINIATURES]: 'toys',
      [GameGenre.LEGACY]: 'history_edu',
      [GameGenre.NEGOTIATION]: 'handshake',
      [GameGenre.ROUTE_BUILDING]: 'route',
      [GameGenre.SET_COLLECTION]: 'collections',
      [GameGenre.PUSH_YOUR_LUCK]: 'casino'
    };
    
    return genreIconMap[genre] || 'category';
  }

  close(): void {
    this.dialogRef.close();
  }
}
