export interface Game {
  id: string;
  title: string;
  genres: GameGenre[];
  minPlayers: number;
  maxPlayers: number;
  playTime: string;
  description: string;
  imageUrl?: string;
  bggRating?: number;
  comments?: GameComment[]; // Optional - comments now come from AWS
}

export interface GameComment {
  id: string;
  username: string;
  comment: string;
  rating?: number;
  timestamp: Date;
}

export enum GameGenre {
  STRATEGY = 'Strategy',
  FAMILY = 'Family',
  PARTY = 'Party',
  ADVENTURE = 'Adventure',
  DRINKING = 'Drinking',
  COOPERATIVE = 'Cooperative',
  SOCIAL = 'Social',
  ASYMMETRIC = 'Asymmetric',
  DECK_BUILDER = 'Deck Builder',
  ENGINE_BUILDER = 'Engine Builder',
  CARD_DRAFTING = 'Card Drafting',
  CARD_GAME = 'Card Game',
  DICE_ROLLING = 'Dice Rolling'
}

export enum GameDuration {
  SHORT = 'Short (Under 30 min)',
  MEDIUM = 'Medium (30-60 min)', 
  LONG = 'Long (60-120 min)',
  EPIC = 'Epic (2+ hours)'
}

export interface GameFilter {
  genres?: GameGenre[];
  supportedPlayers?: number;
  duration?: GameDuration;
  searchText?: string;
}

export enum SortOrder {
  TITLE_ASC = 'title-asc',
  TITLE_DESC = 'title-desc',
  RATING_ASC = 'rating-asc',
  RATING_DESC = 'rating-desc',
  PLAYERS_ASC = 'players-asc',
  PLAYERS_DESC = 'players-desc'
}

export interface GameJson {
  id: string;
  title: string;
  genres: GameGenre[];
  minPlayers: number;
  maxPlayers: number;
  playTime: string;
  description: string;
  imageUrl?: string;
  bggRating?: number;
}