export interface QueueMember {
  userId: string;
  username: string;
}

export type QueueStatus = 'lobby' | 'active';

export interface QueueEntry {
  gameId: string;
  gameTitle: string;
  addedBy: string;
  addedByName: string;
  addedAt: number;
  status: QueueStatus;
  joined: QueueMember[];
}

export interface QueueState {
  seasonId: string | null;
  entries: QueueEntry[];
}

export interface QueueActionResponse {
  ok: boolean;
  entry?: QueueEntry | null;
  closed?: boolean;
  granted?: number;
  banked?: number;
}

/** Result the close-out dialog returns. */
export interface CloseResult {
  hadWinner: boolean;
  winnerType?: 'single' | 'group';
  winnerId?: string;
}
