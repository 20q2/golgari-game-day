import { ChangeDetectionStrategy, Component, Input } from '@angular/core';

/**
 * A single Guildvault sigil rendered as an inline monochrome SVG glyph.
 *
 * Replaces the old emoji sigils: SVGs share one fixed 1em box so they line up
 * perfectly in the keypad, the combination readout, and the ledger grid (emoji
 * render at wildly different widths, which is what made the ledger look offset).
 * All glyphs paint with `currentColor`, so callers control colour via `color`.
 */
@Component({
  selector: 'app-sigil-icon',
  standalone: true,
  changeDetection: ChangeDetectionStrategy.OnPush,
  host: { '[style.color]': 'color' },
  template: `
    @switch (id) {
      @case ('spore') {
        <svg viewBox="0 0 24 24" fill="currentColor" [attr.aria-label]="label" role="img">
          <path
            d="M12 4C7.6 4 4 6.9 4 10.5c0 .83.67 1.5 1.5 1.5h13c.83 0 1.5-.67 1.5-1.5C20 6.9 16.4 4 12 4Z"
          />
          <path d="M10 13h4v5.5a2 2 0 0 1-4 0V13Z" />
        </svg>
      }
      @case ('bone') {
        <svg viewBox="0 0 24 24" fill="currentColor" [attr.aria-label]="label" role="img">
          <g transform="rotate(-45 12 12)">
            <rect x="5.5" y="10.4" width="13" height="3.2" rx="1.6" />
            <circle cx="6" cy="9.8" r="2.3" />
            <circle cx="6" cy="14.2" r="2.3" />
            <circle cx="18" cy="9.8" r="2.3" />
            <circle cx="18" cy="14.2" r="2.3" />
          </g>
        </svg>
      }
      @case ('web') {
        <svg
          viewBox="0 0 24 24"
          fill="none"
          stroke="currentColor"
          stroke-width="1.4"
          stroke-linecap="round"
          stroke-linejoin="round"
          [attr.aria-label]="label"
          role="img"
        >
          <path d="M3 3 21 21M3 3 21 3M3 3 3 21M3 3 21 12M3 3 12 21" />
          <path d="M8.5 3A5.5 5.5 0 0 1 3 8.5" />
          <path d="M14 3A11 11 0 0 1 3 14" />
          <path d="M19.5 3A16.5 16.5 0 0 1 3 19.5" />
        </svg>
      }
      @case ('moss') {
        <svg
          viewBox="0 0 24 24"
          fill="none"
          stroke="currentColor"
          stroke-width="1.6"
          stroke-linecap="round"
          stroke-linejoin="round"
          [attr.aria-label]="label"
          role="img"
        >
          <path d="M12 21V5" />
          <path d="M12 12c-3.2 0-5.2-2-5.2-5.2 3.2 0 5.2 2 5.2 5.2Z" fill="currentColor" stroke="none" />
          <path d="M12 9c3.2 0 5.2-2 5.2-5.2C14 3.8 12 5.8 12 9Z" fill="currentColor" stroke="none" />
          <path d="M12 16c-3.2 0-5.2-2-5.2-5.2 3.2 0 5.2 2 5.2 5.2Z" fill="currentColor" stroke="none" />
        </svg>
      }
      @case ('skull') {
        <svg
          viewBox="0 0 24 24"
          fill="currentColor"
          fill-rule="evenodd"
          clip-rule="evenodd"
          [attr.aria-label]="label"
          role="img"
        >
          <path
            d="M12 3c-4.4 0-8 3.3-8 7.4 0 2.5 1.3 4.7 3.3 6v2.1a1 1 0 0 0 1 1h.9v-1.9h1.3v1.9h1.6v-1.9h1.3v1.9h.9a1 1 0 0 0 1-1V16.4c2-1.3 3.3-3.5 3.3-6C20 6.3 16.4 3 12 3Zm-3 6.4a1.8 1.8 0 1 0 0 3.6 1.8 1.8 0 0 0 0-3.6Zm6 0a1.8 1.8 0 1 0 0 3.6 1.8 1.8 0 0 0 0-3.6ZM12 13.4l1.1 2.1h-2.2L12 13.4Z"
          />
        </svg>
      }
      @case ('beetle') {
        <svg viewBox="0 0 24 24" fill="currentColor" [attr.aria-label]="label" role="img">
          <g fill="none" stroke="currentColor" stroke-width="1.4" stroke-linecap="round">
            <path d="M7 10 3 8M6.7 13 2.5 13M7 16 3 18M17 10 21 8M17.3 13 21.5 13M17 16 21 18" />
            <path d="M10.5 3.2 8.5 1.6M13.5 3.2 15.5 1.6" />
          </g>
          <ellipse cx="12" cy="13" rx="5" ry="7" />
          <circle cx="12" cy="4.9" r="2.3" />
        </svg>
      }
      @default {
        <svg viewBox="0 0 24 24" fill="currentColor" [attr.aria-label]="label" role="img">
          <circle cx="12" cy="12" r="8" fill="none" stroke="currentColor" stroke-width="1.6" />
          <path d="M12 15v.01M12 8a2 2 0 0 1 1 3.7c-.6.4-1 .8-1 1.3" fill="none" stroke="currentColor" stroke-width="1.6" stroke-linecap="round" />
        </svg>
      }
    }
  `,
  styles: [
    `
      :host {
        display: inline-flex;
        align-items: center;
        justify-content: center;
        width: 1em;
        height: 1em;
        line-height: 1;
      }
      svg {
        width: 100%;
        height: 100%;
        display: block;
      }
    `,
  ],
})
export class SigilIconComponent {
  /** Sigil id — one of spore | bone | web | moss | skull | beetle. */
  @Input({ required: true }) id!: string;
  /** Accessible label (usually the sigil's display name). */
  @Input() label = '';

  /** Distinct hue per sigil so each key reads at a glance. */
  private static readonly PALETTE: Record<string, string> = {
    spore: '#e0705f', // toadstool red
    bone: '#e6dcc2', // ivory
    web: '#9ab8d6', // silver-blue silk
    moss: '#82bd5a', // green
    skull: '#c3aee0', // pale lavender
    beetle: '#e0a94e', // amber carapace
  };

  /** Glyph colour, bound to the host so it inherits via `currentColor`. */
  protected get color(): string {
    return SigilIconComponent.PALETTE[this.id] ?? '#d7c497';
  }
}
