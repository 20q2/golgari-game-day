import { Injectable } from '@angular/core';
import { GameGenre } from '../models/game.model';

export type GenreColor = 'primary' | 'accent' | 'warn' | undefined;

/**
 * Single source of truth for genre icons + colors used across the app.
 * Replaces duplicated getGenreIcon / getGenreColor maps that previously
 * lived in GamesComponent and GameDetailsDialogComponent.
 */
@Injectable({ providedIn: 'root' })
export class GenreIconService {
  readonly genreIcons: Readonly<Record<GameGenre, string>> = {
    [GameGenre.STRATEGY]: 'psychology',
    [GameGenre.FAMILY]: 'family_restroom',
    [GameGenre.PARTY]: 'celebration',
    [GameGenre.ADVENTURE]: 'explore',
    [GameGenre.DRINKING]: 'local_bar',
    [GameGenre.COOPERATIVE]: 'groups',
    [GameGenre.SOCIAL]: 'theater_comedy',
    [GameGenre.ASYMMETRIC]: 'balance',
    [GameGenre.DECK_BUILDER]: 'layers',
    [GameGenre.ENGINE_BUILDER]: 'settings',
    [GameGenre.CARD_DRAFTING]: 'view_carousel',
    [GameGenre.CARD_GAME]: 'style',
    [GameGenre.DICE_ROLLING]: 'casino',
  };

  readonly genreColors: Readonly<Record<GameGenre, GenreColor>> = {
    [GameGenre.STRATEGY]: 'primary',
    [GameGenre.FAMILY]: undefined,
    [GameGenre.PARTY]: 'accent',
    [GameGenre.ADVENTURE]: 'warn',
    [GameGenre.DRINKING]: 'accent',
    [GameGenre.COOPERATIVE]: 'primary',
    [GameGenre.SOCIAL]: 'warn',
    [GameGenre.ASYMMETRIC]: 'primary',
    [GameGenre.DECK_BUILDER]: 'accent',
    [GameGenre.ENGINE_BUILDER]: 'primary',
    [GameGenre.CARD_DRAFTING]: 'accent',
    [GameGenre.CARD_GAME]: 'accent',
    [GameGenre.DICE_ROLLING]: 'accent',
  };

  iconFor(genre: GameGenre): string {
    return this.genreIcons[genre] ?? 'category';
  }

  colorFor(genre: GameGenre): GenreColor {
    return this.genreColors[genre];
  }
}
