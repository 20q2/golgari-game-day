export interface QueueMember {
  userId: string;
  username: string;
}

export interface QueueEntry {
  gameId: string;
  gameTitle: string;
  addedBy: string;
  addedByName: string;
  addedAt: number;
  joined: QueueMember[];
}

export interface QueueState {
  seasonId: string | null;
  entries: QueueEntry[];
}

export interface QueueActionResponse {
  ok: boolean;
  entry: QueueEntry | null;
}
