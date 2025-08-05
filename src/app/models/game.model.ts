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
  PARTY = 'Party',
  COOPERATIVE = 'Cooperative',
  CARD_GAME = 'Card Game',
  DECK_BUILDING = 'Deck Building',
  EURO = 'Euro',
  THEMATIC = 'Thematic',
  ABSTRACT = 'Abstract',
  FAMILY = 'Family',
  WAR_GAME = 'War Game',
  DRINKING = 'Drinking',
  ENGINE_BUILDING = 'Engine Building',
  DEXTERITY = 'Dexterity',
  SOCIAL_DEDUCTION = 'Social Deduction',
  BLUFFING = 'Bluffing',
  MEMORY = 'Memory',
  ADVENTURE = 'Adventure',
  HORROR = 'Horror',
  AREA_CONTROL = 'Area Control',
  RPG = 'RPG',
  CARD_DRAFTING = 'Card Drafting',
  MINIATURES = 'Miniatures',
  LEGACY = 'Legacy',
  NEGOTIATION = 'Negotiation',
  ROUTE_BUILDING = 'Route Building',
  SET_COLLECTION = 'Set Collection',
  PUSH_YOUR_LUCK = 'Push Your Luck',
  ASYMMETRIC = 'Asymmetric'
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
  genre: string; // String version of GameGenre
  minPlayers: number;
  maxPlayers: number;
  playTime: string;
  description: string;
  imageUrl?: string;
  bggRating?: number;
}