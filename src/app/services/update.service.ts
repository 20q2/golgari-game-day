import { Injectable, NgZone, inject } from '@angular/core';
import { SwUpdate, VersionReadyEvent } from '@angular/service-worker';
import { MatSnackBar } from '@angular/material/snack-bar';
import { filter } from 'rxjs/operators';

/**
 * Watches the Angular service worker for a freshly-deployed build and offers a
 * one-tap refresh via a snackbar toast.
 *
 * Why this exists: the SW serves the app cache-first and pins each open tab to
 * the version it first loaded, so a device left open during a game day won't
 * pick up a new deploy on its own. We poll for updates and, when one has
 * finished downloading, prompt the player to refresh rather than reloading them
 * out from under a live turn.
 */
@Injectable({ providedIn: 'root' })
export class UpdateService {
  private readonly swUpdate = inject(SwUpdate);
  private readonly snackBar = inject(MatSnackBar);
  private readonly zone = inject(NgZone);

  // How often to ask the server whether a newer build is live. During a game
  // day we may push last-minute fixes; a minute keeps open devices from lagging
  // more than ~a poll behind.
  private readonly POLL_MS = 60_000;

  init(): void {
    if (!this.swUpdate.isEnabled) {
      // Service worker is disabled under `ng serve` (dev). Nothing to watch.
      return;
    }

    // Fires once the new build has finished downloading in the background.
    this.swUpdate.versionUpdates
      .pipe(filter((e): e is VersionReadyEvent => e.type === 'VERSION_READY'))
      .subscribe(() => this.promptRefresh());

    // One check now, then on an interval. Run the timer outside Angular so it
    // doesn't trip change detection every minute for no reason.
    void this.checkForUpdate();
    this.zone.runOutsideAngular(() => {
      setInterval(() => void this.checkForUpdate(), this.POLL_MS);
    });
  }

  private async checkForUpdate(): Promise<void> {
    try {
      await this.swUpdate.checkForUpdate();
    } catch {
      // Offline / transient network error — the next tick retries.
    }
  }

  private promptRefresh(): void {
    const ref = this.snackBar.open('A new version is available.', 'Refresh');
    ref.onAction().subscribe(() => {
      void this.swUpdate.activateUpdate().then(() => document.location.reload());
    });
  }
}
