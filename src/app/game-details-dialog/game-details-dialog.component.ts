import { Component, Inject, OnDestroy, OnInit } from '@angular/core';
import { CommonModule } from '@angular/common';
import { FormsModule } from '@angular/forms';
import { MatDialogModule, MatDialogRef, MAT_DIALOG_DATA } from '@angular/material/dialog';
import { MatIconModule } from '@angular/material/icon';
import { Subject } from 'rxjs';
import { takeUntil } from 'rxjs/operators';
import { GamesService } from '../services/games.service';
import { Game, GameComment } from '../models/game.model';
import { UserService } from '../services/user.service';
import { GameStats } from '../services/data-aggregation.service';
import { GenreIconService } from '../services/genre-icon.service';

const MAX_RATING = 10;

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
export class GameDetailsDialogComponent implements OnInit, OnDestroy {
  newComment = { comment: '' };
  isSubmitting = false;
  isTogglingLike = false;
  isSettingRating = false;
  hoverRating: number | null = null;
  stats: GameStats | null = null;

  readonly ratingSlots = Array.from({ length: MAX_RATING }, (_, i) => i + 1);

  private destroy$ = new Subject<void>();

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
    this.gamesService
      .getGameStats(this.game.id)
      .pipe(takeUntil(this.destroy$))
      .subscribe((stats) => (this.stats = stats));
  }

  ngOnDestroy(): void {
    this.destroy$.next();
    this.destroy$.complete();
  }

  getAverageRating(): number | null {
    return this.stats?.averageRating ?? null;
  }

  getAllComments(): GameComment[] {
    if (!this.stats) return [];
    return this.stats.comments
      .slice()
      .sort((a, b) => new Date(b.timestamp).getTime() - new Date(a.timestamp).getTime())
      .map((c) => ({
        id: c.commentId,
        comment: c.comment,
        username: c.username,
        rating: c.rating || undefined,
        timestamp: new Date(c.timestamp),
      }));
  }

  get totalLikes(): number {
    return this.stats?.totalLikes ?? 0;
  }

  get isLiked(): boolean {
    return this.stats?.isLikedByCurrentUser ?? false;
  }

  get myRating(): number | null {
    if (!this.stats) return null;
    const userId = this.userService.userId();
    if (!userId) return null;
    const mine = this.stats.ratings.find((r) => r.userId === userId);
    return mine ? mine.rating : null;
  }

  get displayedRating(): number {
    return this.hoverRating ?? this.myRating ?? 0;
  }

  async toggleLike(): Promise<void> {
    if (this.isTogglingLike) return;
    if (!(await this.userService.requireSignIn())) return;
    this.isTogglingLike = true;
    try {
      await this.gamesService.toggleLike(this.game.id);
    } catch (error) {
      console.error('Failed to toggle like:', error);
      alert('Failed to update like. Please try again.');
    } finally {
      this.isTogglingLike = false;
    }
  }

  async setRating(rating: number): Promise<void> {
    if (this.isSettingRating) return;
    if (!(await this.userService.requireSignIn())) return;
    this.isSettingRating = true;
    try {
      await this.gamesService.addRating(this.game.id, rating);
    } catch (error) {
      console.error('Failed to set rating:', error);
      alert('Failed to save rating. Please try again.');
    } finally {
      this.isSettingRating = false;
    }
  }

  onStarHover(rating: number | null): void {
    this.hoverRating = rating;
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
    } catch (error) {
      console.error('Failed to add comment:', error);
      alert('Failed to add comment. Please try again.');
    } finally {
      this.isSubmitting = false;
    }
  }

  close(): void {
    this.dialogRef.close();
  }
}
