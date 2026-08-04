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
        <div
          class="stage"
          [class.vestige]="vestige"
          style="background-image: linear-gradient(rgba(10, 12, 10, 0.3), rgba(10, 12, 10, 0.55)), url('undercity/arena_background.webp')"
        >
          <div class="platform" aria-hidden="true"></div>
          <div class="body">
            @if (spriteUrl) {
              <img [src]="spriteUrl" [alt]="name" (error)="imgFailed = true" [class.hidden]="imgFailed" />
            }
            @if (!spriteUrl || imgFailed) {
              <div class="portrait-fallback" aria-hidden="true"></div>
            }
          </div>
        </div>

        <div class="content">
          <h2 class="boss-name">{{ name }}</h2>

          <div class="speech">
            @for (line of lines; track $index) {
              <p class="line">&ldquo;{{ line }}&rdquo;</p>
            }
          </div>

          <button class="fight-btn" type="button" (click)="begin.emit()">Fight</button>
        </div>
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
        padding: 0;
        overflow: hidden;
        display: flex;
        flex-direction: column;
        box-shadow:
          0 24px 60px rgba(0, 0, 0, 0.65),
          inset 0 1px 0 rgba(183, 228, 199, 0.08);
        animation: uc-boss-in 0.28s cubic-bezier(0.2, 1.4, 0.4, 1);
      }
      @keyframes uc-boss-in {
        from { opacity: 0; transform: translateY(16px) scale(0.94); }
        to { opacity: 1; transform: none; }
      }
      /* Arena stage — same background + framing as the battle screen. */
      .stage {
        position: relative;
        flex-shrink: 0;
        height: 230px;
        display: flex;
        align-items: flex-end;
        justify-content: center;
        padding-bottom: 22px;
        border-radius: 16px 16px 0 0;
        border-bottom: 2px solid rgba(74, 124, 89, 0.5);
        /* background-image is set inline in the template (webpack won't try to
         * resolve the runtime asset URL), matching the battle stage. */
        background-size: cover;
        background-position: center;
      }
      /* Ground shadow under the boss, breathing counter-phase to the sprite. */
      .platform {
        position: absolute;
        bottom: 16px;
        left: 50%;
        transform: translateX(-50%);
        width: 150px;
        max-width: 70%;
        height: 34px;
        background: radial-gradient(ellipse at center, rgba(0, 0, 0, 0.55) 0%, transparent 68%);
        pointer-events: none;
        animation: uc-shadow-breathe 3.2s ease-in-out 0.5s infinite;
      }
      /* Wrapper carries the drop-in + breathe so the img stays clean. */
      .body {
        display: inline-block;
        transform-origin: 50% 100%;
        animation:
          uc-boss-drop 0.5s cubic-bezier(0.2, 1.2, 0.4, 1) both,
          uc-breathe 3.2s ease-in-out 0.5s infinite;
      }
      @keyframes uc-boss-drop {
        0% { opacity: 0; transform: translateY(-90px); }
        70% { opacity: 1; transform: translateY(8px); }
        100% { transform: translateY(0); }
      }
      @keyframes uc-breathe {
        0%, 100% { transform: translateY(0) scale(1); }
        50% { transform: translateY(-4px) scale(1.04); }
      }
      @keyframes uc-shadow-breathe {
        0%, 100% { transform: translateX(-50%) scale(1); opacity: 0.85; }
        50% { transform: translateX(-50%) scale(0.9); opacity: 0.62; }
      }
      .body img {
        display: block;
        width: 200px;
        max-width: 100%;
        height: auto;
        image-rendering: pixelated;
        filter: drop-shadow(0 8px 10px rgba(0, 0, 0, 0.6));
      }
      .body img.hidden { display: none; }
      /* Vestige = a spectral echo — kept bright and near-full-color so it reads
       * clearly against the dark stage; a green halo is the only ghostly tell. */
      .stage.vestige .body img {
        filter: brightness(1.45) contrast(1.1) grayscale(0.25)
          drop-shadow(0 0 8px rgba(150, 230, 190, 0.9))
          drop-shadow(0 0 18px rgba(120, 200, 160, 0.55));
        opacity: 1;
      }
      .portrait-fallback {
        width: 150px;
        height: 150px;
        border-radius: 50%;
        background: radial-gradient(circle at 40% 35%, rgba(74, 124, 89, 0.5), rgba(20, 18, 15, 0.9));
      }
      .content {
        display: flex;
        flex-direction: column;
        align-items: center;
        gap: 16px;
        text-align: center;
        padding: 20px 20px 20px;
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
