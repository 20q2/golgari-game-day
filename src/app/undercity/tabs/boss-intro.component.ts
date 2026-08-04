import { ChangeDetectionStrategy, Component, EventEmitter, Input, Output } from '@angular/core';
import { CommonModule } from '@angular/common';

/**
 * Pre-fight boss dialogue card (design 2026-08-04). Shown before a biome-lair
 * boss or Savra fight: a dimmed scrim, the boss portrait, its name, the spoken
 * line(s), and a single Fight button. The boss speaks; the player does not
 * reply. Tap-to-begin — the fight starts only on `begin`.
 *
 * Self-contained: inputs + one output, no store access. Styling mirrors the
 * battle overlay (battle-playback.component.scss) so it reads as the same UI
 * family. A Vestige (already-slain, reformed) foe gets a drained/spectral
 * portrait treatment, matching how the overworld renders Vestiges.
 */
@Component({
  selector: 'app-undercity-boss-intro',
  standalone: true,
  changeDetection: ChangeDetectionStrategy.OnPush,
  imports: [CommonModule],
  template: `
    <div class="boss-overlay">
      <div class="boss-card">
        <div class="portrait" [class.vestige]="vestige">
          @if (spriteUrl) {
            <img [src]="spriteUrl" [alt]="name" (error)="imgFailed = true" [class.hidden]="imgFailed" />
          }
          @if (!spriteUrl || imgFailed) {
            <div class="portrait-fallback" aria-hidden="true"></div>
          }
        </div>

        <h2 class="boss-name">{{ name }}</h2>

        <div class="speech">
          @for (line of lines; track $index) {
            <p class="line">&ldquo;{{ line }}&rdquo;</p>
          }
        </div>

        <button class="fight-btn" type="button" (click)="begin.emit()">Fight</button>
      </div>
    </div>
  `,
  styles: [
    `
      .boss-overlay {
        position: fixed;
        inset: 0;
        z-index: 1250;
        background: rgba(8, 6, 4, 0.86);
        backdrop-filter: blur(5px);
        -webkit-backdrop-filter: blur(5px);
        display: flex;
        align-items: center;
        justify-content: center;
        padding: 16px;
        animation: uc-fade-in 0.18s ease;
      }
      @keyframes uc-fade-in {
        from { opacity: 0; }
        to { opacity: 1; }
      }
      .boss-card {
        width: min(420px, 100%);
        max-height: 90vh;
        overflow-y: auto;
        background: #1a1815;
        border: 1px solid rgba(74, 124, 89, 0.45);
        border-radius: 16px;
        padding: 24px 20px 20px;
        display: flex;
        flex-direction: column;
        align-items: center;
        gap: 16px;
        text-align: center;
        box-shadow:
          0 24px 60px rgba(0, 0, 0, 0.65),
          inset 0 1px 0 rgba(183, 228, 199, 0.08);
        animation: uc-boss-in 0.28s cubic-bezier(0.2, 1.4, 0.4, 1);
      }
      @keyframes uc-boss-in {
        from { opacity: 0; transform: translateY(16px) scale(0.94); }
        to { opacity: 1; transform: none; }
      }
      .portrait {
        width: 160px;
        height: 160px;
        display: flex;
        align-items: center;
        justify-content: center;
      }
      .portrait img {
        max-width: 100%;
        max-height: 100%;
        image-rendering: pixelated;
        filter: drop-shadow(0 6px 14px rgba(0, 0, 0, 0.6));
      }
      .portrait img.hidden { display: none; }
      /* Vestige = a drained, spectral echo of the boss. */
      .portrait.vestige img {
        filter: grayscale(0.65) brightness(0.85) drop-shadow(0 0 12px rgba(120, 200, 160, 0.5));
        opacity: 0.85;
      }
      .portrait-fallback {
        width: 120px;
        height: 120px;
        border-radius: 50%;
        background: radial-gradient(circle at 40% 35%, rgba(74, 124, 89, 0.5), rgba(20, 18, 15, 0.9));
      }
      .boss-name {
        margin: 0;
        font-size: 1.35rem;
        font-weight: 700;
        color: #e7d9a8;
        letter-spacing: 0.02em;
      }
      .speech {
        display: flex;
        flex-direction: column;
        gap: 10px;
      }
      .line {
        margin: 0;
        font-style: italic;
        line-height: 1.5;
        color: #d8d2c4;
      }
      .fight-btn {
        margin-top: 4px;
        min-width: 160px;
        padding: 12px 24px;
        font-size: 1.05rem;
        font-weight: 700;
        letter-spacing: 0.04em;
        color: #10140f;
        background: linear-gradient(180deg, #b7e4c7, #4a7c59);
        border: none;
        border-radius: 12px;
        cursor: pointer;
        box-shadow: 0 6px 16px rgba(0, 0, 0, 0.5);
        transition: transform 0.1s ease, filter 0.1s ease;
      }
      .fight-btn:hover { filter: brightness(1.08); }
      .fight-btn:active { transform: translateY(1px); }
    `,
  ],
})
export class BossIntroComponent {
  @Input({ required: true }) name = '';
  @Input({ required: true }) spriteUrl: string | null = null;
  @Input({ required: true }) lines: string[] = [];
  @Input() vestige = false;
  @Output() begin = new EventEmitter<void>();

  protected imgFailed = false;
}
