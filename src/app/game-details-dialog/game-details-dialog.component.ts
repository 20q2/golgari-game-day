import { Component, Inject, OnInit } from '@angular/core';
import { CommonModule } from '@angular/common';
import { FormsModule } from '@angular/forms';
import { MatDialogModule, MatDialogRef, MAT_DIALOG_DATA } from '@angular/material/dialog';
import { MatIconModule } from '@angular/material/icon';
import { GamesService } from '../services/games.service';
import { Game, GameComment } from '../models/game.model';
import { UserService } from '../services/user.service';
import { GenreIconService } from '../services/genre-icon.service';

@Component({
  selector: 'app-game-details-dialog',
  standalone: true,
  imports: [
    CommonModule,
    FormsModule,
    MatDialogModule,
    MatIconModule,
  ],
  templateUrl: './game-details-dialog.component.html',
  styleUrls: ['./game-details-dialog.component.scss'],
})
export class GameDetailsDialogComponent implements OnInit {
  newComment = { comment: '' };
  isSubmitting = false;
  awsComments: GameComment[] = [];
  awsAverageRating: number | null = null;

  constructor(
    public iconService: GenreIconService,
    public dialogRef: MatDialogRef<GameDetailsDialogComponent>,
    @Inject(MAT_DIALOG_DATA) public game: Game,
    private gamesService: GamesService,
    private userService: UserService,
  ) {}

  ngOnInit(): void {
    const updatedGame = this.gamesService.getGameById(this.game.id);
    if (updatedGame) {
      this.game = updatedGame;
    }
    this.loadAwsData();
  }

  private loadAwsData(): void {
    this.gamesService.getCommentsFromAws(this.game.id).subscribe({
      next: (comments) => {
        this.awsComments = comments;
      },
      error: (error) => {
        console.error('Failed to load comments from AWS:', error);
      },
    });

    this.gamesService.getAverageRatingFromAws(this.game.id).subscribe({
      next: (rating) => {
        this.awsAverageRating = rating;
      },
      error: (error) => {
        console.error('Failed to load rating from AWS:', error);
      },
    });
  }

  async addComment(): Promise<void> {
    if (!this.newComment.comment.trim()) {
      return;
    }
    if (!(await this.userService.requireSignIn())) {
      return;
    }
    this.isSubmitting = true;
    try {
      await this.gamesService.addComment(this.game.id, {
        username: '',
        comment: this.newComment.comment.trim(),
      });
      this.newComment = { comment: '' };
      this.loadAwsData();
    } catch (error) {
      console.error('Failed to add comment:', error);
      alert('Failed to add comment. Please try again.');
    } finally {
      this.isSubmitting = false;
    }
  }

  getAverageRating(): number | null {
    return this.awsAverageRating;
  }

  getAllComments(): GameComment[] {
    return this.awsComments
      .slice()
      .sort((a, b) => new Date(b.timestamp).getTime() - new Date(a.timestamp).getTime());
  }

  close(): void {
    this.dialogRef.close();
  }
}
