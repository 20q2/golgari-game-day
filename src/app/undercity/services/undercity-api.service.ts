import { Injectable, inject } from '@angular/core';
import { UserService } from '../../services/user.service';
import { ActionResponse, GameState } from './undercity-models';
import type { BoardMap } from '../engine/board-canvas';

/** Raised for non-2xx action responses so callers can show the server's text. */
export class UndercityApiError extends Error {
  constructor(
    message: string,
    public status: number,
  ) {
    super(message);
  }
}

@Injectable({ providedIn: 'root' })
export class UndercityApiService {
  // Same Lambda Function URL the rest of the site talks to (AwsApiService).
  private readonly API_BASE_URL =
    'https://en53hl67hhzmm5n4ydc26qxeru0doggy.lambda-url.us-east-1.on.aws';

  private readonly userService = inject(UserService);

  async getState(): Promise<GameState> {
    const userId = this.userService.userId() ?? '';
    const response = await fetch(
      `${this.API_BASE_URL}/game/state?userId=${encodeURIComponent(userId)}`,
      { method: 'GET', mode: 'cors', headers: { 'Content-Type': 'application/json' } },
    );
    if (!response.ok) {
      throw new UndercityApiError(`Failed to load game state (${response.status})`, response.status);
    }
    return response.json();
  }

  /** The night's board: fixed surface + this season's (possibly generated)
   *  depths. With `sample`, returns a preview of the generator for that seed
   *  (surface + freshly generated depths), ignoring flag/season. */
  async getMap(sample?: string): Promise<BoardMap> {
    const qs = sample ? `?sample=${encodeURIComponent(sample)}` : '';
    const response = await fetch(`${this.API_BASE_URL}/game/map${qs}`, {
      method: 'GET',
      mode: 'cors',
      headers: { 'Content-Type': 'application/json' },
    });
    if (!response.ok) {
      throw new UndercityApiError(`Failed to load board map (${response.status})`, response.status);
    }
    return response.json();
  }

  async action(type: string, payload: Record<string, unknown> = {}): Promise<ActionResponse> {
    const response = await fetch(`${this.API_BASE_URL}/game/action`, {
      method: 'POST',
      mode: 'cors',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        type,
        userId: this.userService.userId(),
        username: this.userService.username(),
        payload,
      }),
    });
    const body = (await response.json()) as ActionResponse;
    if (!response.ok) {
      throw new UndercityApiError(body?.error ?? `Action failed (${response.status})`, response.status);
    }
    return body;
  }
}
