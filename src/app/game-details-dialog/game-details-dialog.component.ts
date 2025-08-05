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
import { Rating } from '../services/aws-api.service';

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
  isSubmitting = false;
  awsComments: GameComment[] = [];
  awsAverageRating: number | null = null;

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

    // Load comments and ratings from AWS
    this.loadAwsData();
  }

  private loadAwsData(): void {
    // Load comments from AWS
    this.gamesService.getCommentsFromAws(this.game.id).subscribe({
      next: (comments) => {
        this.awsComments = comments;
        console.log(`✅ Loaded ${comments.length} comments from AWS for ${this.game.id}`);
      },
      error: (error) => {
        console.error('Failed to load comments from AWS:', error);
      }
    });

    // Load average rating from AWS
    this.gamesService.getAverageRatingFromAws(this.game.id).subscribe({
      next: (rating) => {
        this.awsAverageRating = rating;
        if (rating) {
          console.log(`✅ Loaded average rating ${rating} from AWS for ${this.game.id}`);
        }
      },
      error: (error) => {
        console.error('Failed to load rating from AWS:', error);
      }
    });
  }

  ngOnDestroy(): void {
    // No background changes needed for dialogs
  }

  async addComment(): Promise<void> {
    if (!this.newComment.comment.trim()) {
      return;
    }

    this.isSubmitting = true;
    try {
      await this.gamesService.addComment(this.game.id, {
        username: this.newComment.username.trim(), // Can be empty, service will handle
        comment: this.newComment.comment.trim(),
        rating: this.newComment.rating
      });

      // Reset form
      this.newComment = {
        username: '',
        comment: '',
        rating: undefined
      };

      // Reload AWS data to show new comment
      this.loadAwsData();

      console.log('✅ Comment added successfully!');
    } catch (error) {
      console.error('❌ Failed to add comment:', error);
      alert('Failed to add comment. Please try again.');
    } finally {
      this.isSubmitting = false;
    }
  }

  getRatingStars(rating?: number): string {
    if (!rating) return '☆☆☆☆☆';
    const stars = Math.round(rating);
    return '★'.repeat(Math.min(stars, 5)) + '☆'.repeat(Math.max(5 - stars, 0));
  }

  getAverageRating(): number | null {
    // Use AWS rating only
    return this.awsAverageRating;
  }

  getAllComments(): GameComment[] {
    // Use only AWS comments
    return this.awsComments.sort((a, b) => new Date(b.timestamp).getTime() - new Date(a.timestamp).getTime());
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
      [GameGenre.PUSH_YOUR_LUCK]: 'casino',
      [GameGenre.ASYMMETRIC]: 'balance'
    };
    
    return genreIconMap[genre] || 'category';
  }

  close(): void {
    this.dialogRef.close();
  }
}
