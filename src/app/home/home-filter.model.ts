import { GameGenre } from '../models/game.model';

/** Players selected. 7 represents "7+" (match games where maxPlayers >= 7). */
export type PlayerCountFilter = 2 | 3 | 4 | 5 | 6 | 7;

/** Time ceiling in minutes; null means "Any length". */
export type TimeBucket = 30 | 60 | 120 | null;

export type MoodFilter = 'any' | 'strategy' | 'party' | 'family' | 'coop' | 'heavy' | 'card';

export interface HomeFilter {
  players: PlayerCountFilter;
  timeMaxMinutes: TimeBucket;
  mood: MoodFilter;
}

export const DEFAULT_HOME_FILTER: HomeFilter = {
  players: 5,
  timeMaxMinutes: 120,
  mood: 'any',
};

export const HOME_FILTER_STORAGE_KEY = 'gameday-home-filter';

/** Maps each mood (except 'any') to a cluster of underlying GameGenre values.
 *  A game matches a mood if any of its genres is in the cluster. */
export const MOOD_TO_GENRES: Record<Exclude<MoodFilter, 'any'>, GameGenre[]> = {
  strategy: [
    GameGenre.STRATEGY,
    GameGenre.EURO,
    GameGenre.AREA_CONTROL,
    GameGenre.ENGINE_BUILDING,
  ],
  party: [
    GameGenre.PARTY,
    GameGenre.SOCIAL_DEDUCTION,
    GameGenre.BLUFFING,
    GameGenre.DRINKING,
    GameGenre.DEXTERITY,
  ],
  family: [
    GameGenre.FAMILY,
    GameGenre.ABSTRACT,
    GameGenre.MEMORY,
    GameGenre.SET_COLLECTION,
    GameGenre.ROUTE_BUILDING,
    GameGenre.PUSH_YOUR_LUCK,
  ],
  coop: [GameGenre.COOPERATIVE],
  heavy: [
    GameGenre.WAR_GAME,
    GameGenre.MINIATURES,
    GameGenre.LEGACY,
    GameGenre.RPG,
    GameGenre.THEMATIC,
    GameGenre.ASYMMETRIC,
    GameGenre.ADVENTURE,
    GameGenre.HORROR,
  ],
  card: [GameGenre.CARD_GAME, GameGenre.DECK_BUILDING, GameGenre.CARD_DRAFTING],
};

export const PLAYER_OPTIONS: { value: PlayerCountFilter; label: string }[] = [
  { value: 2, label: '2' },
  { value: 3, label: '3' },
  { value: 4, label: '4' },
  { value: 5, label: '5' },
  { value: 6, label: '6' },
  { value: 7, label: '7+' },
];

export const TIME_OPTIONS: { value: TimeBucket; label: string; mobileLabel: string }[] = [
  { value: 30, label: '≤30 min', mobileLabel: '≤30m' },
  { value: 60, label: '≤1 hour', mobileLabel: '≤1h' },
  { value: 120, label: '≤2 hours', mobileLabel: '≤2h' },
  { value: null, label: 'Any', mobileLabel: 'Any' },
];

export const MOOD_OPTIONS: { value: MoodFilter; label: string }[] = [
  { value: 'any', label: 'Any' },
  { value: 'strategy', label: 'Strategy' },
  { value: 'party', label: 'Party' },
  { value: 'family', label: 'Family' },
  { value: 'coop', label: 'Co-op' },
  { value: 'heavy', label: 'Heavy' },
  { value: 'card', label: 'Card' },
];
