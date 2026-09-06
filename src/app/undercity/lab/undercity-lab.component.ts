import { Component, signal } from '@angular/core';
import { CommonModule } from '@angular/common';
import { ColorTestComponent } from '../color-test/color-test.component';
import { MysteryFxLabComponent } from './mystery-fx-lab.component';
import { CinematicLabComponent } from './cinematic-lab.component';

type LabTab = 'sprite' | 'fx' | 'cine';

/**
 * Undercity Lab (route: /undercity/test) — a dev-only sandbox shell.
 * Three tabs: the sprite-recolor sandbox (ColorTestComponent), the
 * mystery-event FX previewer (MysteryFxLabComponent), and the cinematic
 * previewer (CinematicLabComponent) for the full-screen scenes that are
 * otherwise gated behind rare game states. Nothing here touches game state.
 * Localhost-gated in the navbar.
 */
@Component({
  selector: 'app-undercity-lab',
  standalone: true,
  imports: [CommonModule, ColorTestComponent, MysteryFxLabComponent, CinematicLabComponent],
  template: `
    <div class="lab">
      <div class="tabs">
        <button class="tab" [class.active]="tab() === 'sprite'" (click)="tab.set('sprite')">
          Sprite Recolor
        </button>
        <button class="tab" [class.active]="tab() === 'fx'" (click)="tab.set('fx')">
          Mystery FX
        </button>
        <button class="tab" [class.active]="tab() === 'cine'" (click)="tab.set('cine')">
          Cinematics
        </button>
      </div>
      <div class="panel">
        @switch (tab()) {
          @case ('sprite') {
            <app-undercity-color-test />
          }
          @case ('fx') {
            <app-undercity-mystery-fx-lab />
          }
          @case ('cine') {
            <app-undercity-cinematic-lab />
          }
        }
      </div>
    </div>
  `,
  styles: [
    `
      .lab {
        padding: 16px;
        color: #e7dcff;
        min-height: 100vh;
        background: #100c17;
      }
      .tabs {
        display: flex;
        gap: 8px;
        margin-bottom: 16px;
        border-bottom: 1px solid rgba(167, 139, 250, 0.25);
      }
      .tab {
        appearance: none;
        border: none;
        background: transparent;
        color: #9d90b0;
        padding: 10px 16px;
        font-weight: 700;
        font-size: 0.95rem;
        cursor: pointer;
        border-bottom: 2px solid transparent;
        margin-bottom: -1px;
      }
      .tab:hover {
        color: #d8c4ff;
      }
      .tab.active {
        color: #e7dcff;
        border-bottom-color: #a78bfa;
      }
    `,
  ],
})
export class UndercityLabComponent {
  protected readonly tab = signal<LabTab>('fx');
}
