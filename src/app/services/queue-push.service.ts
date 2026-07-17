import { Injectable, inject } from '@angular/core';
import { SwPush } from '@angular/service-worker';
import { firstValueFrom } from 'rxjs';
import { take } from 'rxjs/operators';
import { QueueApiService } from './queue-api.service';

// Paired with VAPID_PRIVATE_KEY on the Lambda (infrastructure/lambda/push.py).
// Public by design — regenerate both together via
// infrastructure/lambda/scripts/generate_vapid_keys.py if this ever changes.
const VAPID_PUBLIC_KEY = 'BEocE_ztntFaa9MVGr_8QznPX_Ivqj2YuBttw2MOZ-e3a5FYwTL6yXyksKuBfVAHk_Qcfj4S1kb_9c3l8B0kUCg';

const OPT_OUT_STORAGE_KEY = 'gameday-queue-push-opt-out';

/**
 * Wraps SwPush so QueueService doesn't need to know about subscription
 * bookkeeping. Subscribing triggers the browser's native permission prompt —
 * that prompt IS the user-facing "get notified?" ask, no custom UI needed.
 */
@Injectable({ providedIn: 'root' })
export class QueuePushService {
  private readonly swPush = inject(SwPush);
  private readonly api = inject(QueueApiService);

  get isSupported(): boolean {
    return this.swPush.isEnabled;
  }

  get hasOptedOut(): boolean {
    return localStorage.getItem(OPT_OUT_STORAGE_KEY) === 'true';
  }

  /** No-op if unsupported, already subscribed, or the user previously declined/dismissed. */
  async ensureSubscribed(): Promise<void> {
    if (!this.isSupported || this.hasOptedOut) return;

    const existing = await firstValueFrom(this.swPush.subscription.pipe(take(1)));
    if (existing) return;

    try {
      const sub = await this.swPush.requestSubscription({ serverPublicKey: VAPID_PUBLIC_KEY });
      await this.api.subscribePush(sub.toJSON());
    } catch {
      // Permission denied, dismissed, or the request failed — remember so we
      // don't re-prompt every time the user joins a lobby.
      localStorage.setItem(OPT_OUT_STORAGE_KEY, 'true');
    }
  }
}
