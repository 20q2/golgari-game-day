import { Component, computed, effect, signal } from '@angular/core';
import { CommonModule } from '@angular/common';
import { MysterySkitComponent } from '../tabs/mystery-skit.component';
import { MysteryFxComponent } from '../tabs/mystery-fx.component';
import { MYSTERY_OUTCOMES, MYSTERY_SYMBOLS } from '../data/mystery-symbols';
import { FORM_SPRITES, formSprite } from '../data/species';
import { getRecoloredWithHatDataUrl, preloadAll } from '../engine/sprite-engine';

type Region = 'body' | 'belly' | 'stripes';

/**
 * Dev previewer for the mystery-event payoff scenes. Shows all 13 outcomes at
 * once, each in a mock event-card banner frame. Two modes: the character
 * **skits** (default — stars a chosen recolored creature) and the abstract
 * **FX** fallback. A creature picker (form + body/belly/stripes paint) drives
 * the skit star, mirroring how the real card renders the player's creature.
 *
 * Scenes are one-shot, so replay re-mounts the component: a per-outcome nonce
 * feeds a `@for … track`; bumping it restarts the animation from frame 0.
 */
@Component({
  selector: 'app-undercity-mystery-fx-lab',
  standalone: true,
  imports: [CommonModule, MysterySkitComponent, MysteryFxComponent],
  template: `
    <div class="fx-lab">
      <div class="controls">
        <div class="mode">
          <button class="pill" [class.on]="mode() === 'skit'" (click)="mode.set('skit')">Skits</button>
          <button class="pill" [class.on]="mode() === 'fx'" (click)="mode.set('fx')">Abstract FX</button>
        </div>

        @if (mode() === 'skit') {
          <label class="ctl">
            Creature
            <select (change)="pickForm($event)">
              @for (f of forms; track f) {
                <option [value]="f" [selected]="f === form()">{{ f }}</option>
              }
            </select>
          </label>
          <label class="ctl swatch-ctl" [style.--sw]="hueCss('body')">
            Body
            <input type="range" min="0" max="360" [value]="paint().body" (input)="setHue('body', $event)" />
          </label>
          <label class="ctl swatch-ctl" [style.--sw]="hueCss('belly')">
            Belly
            <input type="range" min="0" max="360" [value]="paint().belly" (input)="setHue('belly', $event)" />
          </label>
          <label class="ctl swatch-ctl" [style.--sw]="hueCss('stripes')">
            Stripes
            <input type="range" min="0" max="360" [value]="paint().stripes" (input)="setHue('stripes', $event)" />
          </label>
          @if (!ready()) { <span class="hint">loading sprites…</span> }
        }

        <button class="pill primary" (click)="replayAll()">Replay all</button>
      </div>

      <div class="grid">
        @for (o of outcomes; track o) {
          <button class="cell" (click)="replay(o)" [title]="o">
            <span class="frame">
              @for (n of [nonce()[o]]; track n) {
                @if (mode() === 'skit') {
                  <app-undercity-mystery-skit [outcome]="o" [creatureUrl]="creatureUrl()" />
                } @else {
                  <app-undercity-mystery-fx [outcome]="o" />
                }
              }
            </span>
            <span class="label">
              <i class="swatch" [style.background]="sym(o).color"></i>
              {{ o }}
            </span>
          </button>
        }
      </div>
    </div>
  `,
  styles: [
    `
      .fx-lab { padding: 8px 4px 24px; }
      .controls {
        display: flex;
        flex-wrap: wrap;
        align-items: flex-end;
        gap: 14px;
        margin-bottom: 18px;
      }
      .mode { display: flex; gap: 6px; }
      .ctl {
        display: flex;
        flex-direction: column;
        gap: 4px;
        font-size: 0.78rem;
        color: #b7a9cf;
      }
      .ctl select,
      .ctl input {
        min-width: 120px;
      }
      .swatch-ctl input[type='range'] {
        accent-color: var(--sw);
      }
      .hint { color: #9d90b0; font-size: 0.85rem; align-self: center; }
      .pill {
        appearance: none;
        border: 1px solid rgba(167, 139, 250, 0.4);
        background: #241d30;
        color: #d8c4ff;
        padding: 7px 14px;
        border-radius: 999px;
        cursor: pointer;
        font-weight: 700;
        font-size: 0.85rem;
      }
      .pill.on { background: linear-gradient(180deg, #4a3d63, #322845); border-color: #a78bfa; color: #f0e8ff; }
      .pill.primary { border-color: rgba(196, 181, 253, 0.7); }
      .pill:hover { border-color: rgba(196, 181, 253, 0.9); }
      .grid {
        display: grid;
        grid-template-columns: repeat(auto-fill, minmax(200px, 1fr));
        gap: 14px;
      }
      .cell {
        appearance: none;
        border: 1px solid rgba(167, 139, 250, 0.22);
        background: transparent;
        border-radius: 14px;
        padding: 0 0 10px;
        cursor: pointer;
        color: #d8c4ff;
        display: flex;
        flex-direction: column;
        align-items: center;
        transition: border-color 0.15s ease, transform 0.15s ease;
      }
      .cell:hover { border-color: rgba(196, 181, 253, 0.7); transform: translateY(-2px); }
      /* Mimics the event card's banner region. */
      .frame {
        width: 100%;
        height: 140px;
        border-radius: 13px 13px 0 0;
        margin-bottom: 10px;
        display: flex;
        align-items: center;
        justify-content: center;
        background:
          radial-gradient(120% 90% at 50% 0%, rgba(60, 48, 82, 0.55), transparent 70%),
          linear-gradient(180deg, #1c1726, #14101c);
        overflow: hidden;
      }
      .label { display: inline-flex; align-items: center; gap: 7px; font-size: 0.9rem; font-weight: 700; }
      .swatch { width: 12px; height: 12px; border-radius: 3px; box-shadow: 0 0 6px currentColor; }
    `,
  ],
})
export class MysteryFxLabComponent {
  protected readonly outcomes = MYSTERY_OUTCOMES;
  protected readonly forms = Object.keys(FORM_SPRITES);

  protected readonly mode = signal<'skit' | 'fx'>('skit');
  protected readonly form = signal<string>('pest');
  protected readonly paint = signal<Record<Region, number>>({ body: 130, belly: 50, stripes: 200 });
  protected readonly ready = signal(false);

  /** Per-outcome replay counter; bumping one re-mounts just that scene. */
  protected readonly nonce = signal<Record<string, number>>(
    Object.fromEntries(MYSTERY_OUTCOMES.map((o) => [o, 0])),
  );

  /** Recolored creature data URL for the chosen form + paint (null until the
   *  sprite art has preloaded). */
  protected readonly creatureUrl = computed<string | null>(() => {
    if (!this.ready()) return null;
    const spr = formSprite(this.form());
    return getRecoloredWithHatDataUrl(spr.sprite, this.paint(), spr.regions, null);
  });

  constructor() {
    void preloadAll().then(() => this.ready.set(true));
    // Any creature-control change restarts every scene so the new creature shows.
    effect(() => {
      this.creatureUrl();
      this.replayAll();
    });
  }

  protected sym(o: string) {
    return MYSTERY_SYMBOLS[o];
  }

  protected hueCss(r: Region): string {
    return `hsl(${this.paint()[r]} 65% 55%)`;
  }

  protected pickForm(e: Event): void {
    this.form.set((e.target as HTMLSelectElement).value);
  }

  protected setHue(r: Region, e: Event): void {
    this.paint.update((p) => ({ ...p, [r]: Number((e.target as HTMLInputElement).value) }));
  }

  protected replay(o: string): void {
    this.nonce.update((n) => ({ ...n, [o]: n[o] + 1 }));
  }

  protected replayAll(): void {
    this.nonce.update((n) => {
      const next: Record<string, number> = {};
      for (const o of this.outcomes) next[o] = n[o] + 1;
      return next;
    });
  }
}
