import { Component, signal } from '@angular/core';
import { CommonModule } from '@angular/common';
import { MatIconModule } from '@angular/material/icon';

/**
 * Landing page for the Shadow War campaign documents.
 *
 * Both documents are standalone static pages under public/shadow-war/ (synced
 * from the artifact sources by scripts/sync-shadow-war.mjs), not Angular
 * views — they carry their own stylesheets and would fight the app's. This
 * page just picks between them and hands over a shareable player link.
 *
 * Hrefs are relative on purpose: they resolve against <base href>, so the
 * same markup works on localhost and under the GitHub Pages subpath.
 */
@Component({
  selector: 'app-shadow-war-page',
  standalone: true,
  imports: [CommonModule, MatIconModule],
  templateUrl: './shadow-war-page.component.html',
  styleUrl: './shadow-war-page.component.scss',
})
export class ShadowWarPageComponent {
  readonly playerPath = 'shadow-war/players.html';
  readonly dmPath = 'shadow-war/dm-kit.html';

  /** Absolute URL for the player handout, for copying and sharing. */
  readonly playerUrl = new URL(this.playerPath, document.baseURI).href;

  readonly copied = signal(false);

  async copyPlayerLink(): Promise<void> {
    try {
      await navigator.clipboard.writeText(this.playerUrl);
    } catch {
      // Clipboard API needs a secure context and can be blocked outright.
      // The URL is on screen either way, so fall back to selecting it.
      const el = document.getElementById('player-url');
      if (el) {
        const range = document.createRange();
        range.selectNodeContents(el);
        const sel = window.getSelection();
        sel?.removeAllRanges();
        sel?.addRange(range);
      }
      return;
    }
    this.copied.set(true);
    setTimeout(() => this.copied.set(false), 2000);
  }
}
