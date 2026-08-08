import { Injectable, inject } from '@angular/core';
import { UserService } from '../../services/user.service';
import { ActionResponse, GameState } from './undercity-models';
import type { BoardMap } from '../engine/board-canvas';

/** Raised for non-2xx action responses so callers can show the server's text.
 *  A stalled request that we abort surfaces as status 0. */
export class UndercityApiError extends Error {
  constructor(
    message: string,
    public status: number,
  ) {
    super(message);
  }
}

/** Bound every request. A phone that drops its connection mid-roll (radio sleep,
 *  wifi→cellular handoff, a Lambda cold-start that never returns) leaves a bare
 *  fetch pending forever — the dice overlay is gated on the roll's promise
 *  settling and the poll's `_loading` guard sticks, so the game hard-locks until
 *  a refresh. A timeout turns a stall into a rejection the callers already
 *  recover from. Longer than the 10s poll so a slow cold start isn't false-aborted. */
const REQUEST_TIMEOUT_MS = 15_000;

@Injectable({ providedIn: 'root' })
export class UndercityApiService {
  // Same Lambda Function URL the rest of the site talks to (AwsApiService).
  private readonly API_BASE_URL =
    'https://en53hl67hhzmm5n4ydc26qxeru0doggy.lambda-url.us-east-1.on.aws';

  private readonly userService = inject(UserService);

  /** Run a fetch+parse under an abort timeout so a hung socket can't wedge the
   *  UI. Aborts of both the connection and the body read surface as a friendly
   *  UndercityApiError (status 0); everything else propagates unchanged. */
  private async withTimeout<T>(fn: (signal: AbortSignal) => Promise<T>): Promise<T> {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), REQUEST_TIMEOUT_MS);
    try {
      return await fn(controller.signal);
    } catch (e) {
      if (e instanceof DOMException && e.name === 'AbortError') {
        throw new UndercityApiError('The server took too long to respond — try again.', 0);
      }
      throw e;
    } finally {
      clearTimeout(timer);
    }
  }

  async getState(): Promise<GameState> {
    const userId = this.userService.userId() ?? '';
    return this.withTimeout(async (signal) => {
      const response = await fetch(
        `${this.API_BASE_URL}/game/state?userId=${encodeURIComponent(userId)}`,
        { method: 'GET', mode: 'cors', headers: { 'Content-Type': 'application/json' }, signal },
      );
      if (!response.ok) {
        throw new UndercityApiError(
          `Failed to load game state (${response.status})`,
          response.status,
        );
      }
      return response.json();
    });
  }

  /** The night's board: fixed surface + this season's (possibly generated)
   *  depths. With `sample`, returns a preview of the generator for that seed
   *  (surface + freshly generated depths), ignoring flag/season. */
  async getMap(sample?: string): Promise<BoardMap> {
    const qs = sample ? `?sample=${encodeURIComponent(sample)}` : '';
    return this.withTimeout(async (signal) => {
      const response = await fetch(`${this.API_BASE_URL}/game/map${qs}`, {
        method: 'GET',
        mode: 'cors',
        headers: { 'Content-Type': 'application/json' },
        signal,
      });
      if (!response.ok) {
        throw new UndercityApiError(`Failed to load board map (${response.status})`, response.status);
      }
      return response.json();
    });
  }

  async action(type: string, payload: Record<string, unknown> = {}): Promise<ActionResponse> {
    return this.withTimeout(async (signal) => {
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
        signal,
      });
      const body = (await response.json()) as ActionResponse;
      if (!response.ok) {
        throw new UndercityApiError(
          body?.error ?? `Action failed (${response.status})`,
          response.status,
        );
      }
      return body;
    });
  }
}
