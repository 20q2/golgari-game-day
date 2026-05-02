import { Injectable } from '@angular/core';
import { GameGenre } from '../models/game.model';
import { MoodFilter } from '../home/home-filter.model';

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
    [GameGenre.ASYMMETRIC]: 'balance',
  };

  readonly genreColors: Readonly<Record<GameGenre, GenreColor>> = {
    [GameGenre.STRATEGY]: 'primary',
    [GameGenre.PARTY]: 'accent',
    [GameGenre.COOPERATIVE]: 'primary',
    [GameGenre.CARD_GAME]: undefined,
    [GameGenre.DECK_BUILDING]: 'accent',
    [GameGenre.EURO]: 'primary',
    [GameGenre.THEMATIC]: 'warn',
    [GameGenre.ABSTRACT]: undefined,
    [GameGenre.FAMILY]: undefined,
    [GameGenre.WAR_GAME]: 'warn',
    [GameGenre.DRINKING]: 'accent',
    [GameGenre.ENGINE_BUILDING]: 'primary',
    [GameGenre.DEXTERITY]: 'accent',
    [GameGenre.SOCIAL_DEDUCTION]: 'warn',
    [GameGenre.BLUFFING]: 'warn',
    [GameGenre.MEMORY]: undefined,
    [GameGenre.ADVENTURE]: 'warn',
    [GameGenre.HORROR]: 'warn',
    [GameGenre.AREA_CONTROL]: 'primary',
    [GameGenre.RPG]: 'warn',
    [GameGenre.CARD_DRAFTING]: 'accent',
    [GameGenre.MINIATURES]: 'warn',
    [GameGenre.LEGACY]: 'warn',
    [GameGenre.NEGOTIATION]: 'accent',
    [GameGenre.ROUTE_BUILDING]: 'primary',
    [GameGenre.SET_COLLECTION]: 'primary',
    [GameGenre.PUSH_YOUR_LUCK]: undefined,
    [GameGenre.ASYMMETRIC]: 'primary',
  };

  readonly moodIcons: Readonly<Record<MoodFilter, string>> = {
    any: '',
    strategy: 'psychology',
    party: 'celebration',
    family: 'family_restroom',
    coop: 'groups',
    heavy: 'fitness_center',
    card: 'style',
  };

  iconFor(genre: GameGenre): string {
    return this.genreIcons[genre] ?? 'category';
  }

  colorFor(genre: GameGenre): GenreColor {
    return this.genreColors[genre];
  }

  iconForMood(mood: MoodFilter): string {
    return this.moodIcons[mood] ?? '';
  }
}
