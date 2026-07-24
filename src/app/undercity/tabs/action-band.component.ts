import { Component } from '@angular/core';

/**
 * Presentational shell for the bottom action band shared by the board, creature,
 * and plaza tabs. Supplies the consistent chrome (dark panel, green top-border
 * glow, padding, fade-in) and projects each tab's own controls via <ng-content>.
 * All action logic stays in the host tab — this only unifies look and position.
 */
@Component({
  selector: 'app-uc-action-band',
  standalone: true,
  template: `<ng-content></ng-content>`,
  styles: [
    `
      :host {
        display: block;
        flex: none;
        padding: 9px 10px;
        background: #15170f;
        border-top: 1px solid rgba(103, 194, 128, 0.55);
        box-shadow:
          0 -6px 16px rgba(0, 0, 0, 0.4),
          inset 0 1px 0 rgba(103, 194, 128, 0.15);
        animation: uc-band-in 0.15s ease;
      }
    `,
  ],
})
export class UcActionBandComponent {}
