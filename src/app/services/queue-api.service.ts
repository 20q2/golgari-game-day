import { Injectable, inject } from '@angular/core';
import { UserService } from './user.service';
import { CloseResult, QueueActionResponse, QueueState } from './queue-models';

/** Raised for non-2xx queue responses so callers can show the server's text. */
export class QueueApiError extends Error {
  constructor(
    message: string,
    public status: number,
  ) {
    super(message);
  }
}

@Injectable({ providedIn: 'root' })
export class QueueApiService {
  // Same Lambda Function URL the rest of the site talks to (AwsApiService).
  private readonly API_BASE_URL =
    'https://en53hl67hhzmm5n4ydc26qxeru0doggy.lambda-url.us-east-1.on.aws';

  private readonly userService = inject(UserService);

  async getState(): Promise<QueueState> {
    const response = await fetch(`${this.API_BASE_URL}/queue/state`, {
      method: 'GET',
      mode: 'cors',
      headers: { 'Content-Type': 'application/json' },
    });
    if (!response.ok) {
      throw new QueueApiError(`Failed to load queue (${response.status})`, response.status);
    }
    return response.json();
  }

  join(gameId: string, gameTitle: string): Promise<QueueActionResponse> {
    return this.action('join', { gameId, gameTitle });
  }

  leave(gameId: string): Promise<QueueActionResponse> {
    return this.action('leave', { gameId });
  }

  start(gameId: string): Promise<QueueActionResponse> {
    return this.action('start', { gameId });
  }

  close(gameId: string, result: CloseResult): Promise<QueueActionResponse> {
    return this.action('close', { gameId, ...result });
  }

  async subscribePush(subscription: unknown): Promise<void> {
    const response = await fetch(`${this.API_BASE_URL}/queue/push/subscribe`, {
      method: 'POST',
      mode: 'cors',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ userId: this.userService.userId(), subscription }),
    });
    if (!response.ok) {
      throw new QueueApiError(`Failed to subscribe to push (${response.status})`, response.status);
    }
  }

  async unsubscribePush(endpoint: string): Promise<void> {
    const response = await fetch(`${this.API_BASE_URL}/queue/push/unsubscribe`, {
      method: 'POST',
      mode: 'cors',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ userId: this.userService.userId(), endpoint }),
    });
    if (!response.ok) {
      throw new QueueApiError(`Failed to unsubscribe from push (${response.status})`, response.status);
    }
  }

  private async action(
    type: string,
    payload: Record<string, unknown>,
  ): Promise<QueueActionResponse> {
    const response = await fetch(`${this.API_BASE_URL}/queue/action`, {
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
    const body = (await response.json()) as QueueActionResponse & { error?: string };
    if (!response.ok) {
      throw new QueueApiError(body?.error ?? `Action failed (${response.status})`, response.status);
    }
    return body;
  }
}
