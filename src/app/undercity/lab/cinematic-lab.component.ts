import { Component, signal } from '@angular/core';
import { CommonModule } from '@angular/common';
import { GatesOpenComponent } from '../gates/gates-open.component';
import { HazardWheelComponent, HazardWheelTarget } from '../tabs/hazard-wheel.component';
import { DUNGEONS } from '../data/dungeons';

/** Every hazard-wheel outcome, as the board tab would build it. Keeping the
 *  presets here (rather than hand-typing targets) means the lab exercises the
 *  same shapes `hazardWheelTarget` produces. */
interface Preset {
  label: string;
  target: HazardWheelTarget;
}

function surface(outcome: string, extra: Partial<HazardWheelTarget> = {}): HazardWheelTarget {
  return { mode: 'surface', outcome, ...extra };
}

function dungeon(biome: string, extra: Partial<HazardWheelTarget> = {}): HazardWheelTarget {
  const d = DUNGEONS[biome];
  return { mode: 'dungeon', bossId: d.lairNpcId, hazardLabel: d.hazardName, ...extra };
}

const PRESETS: Preset[] = [
  { label: 'Surface — Swamp Gas', target: surface('swamp_gas') },
  { label: 'Surface — Vines', target: surface('vines') },
  { label: 'Surface — Spore Cloud', target: surface('spore_cloud') },
  { label: 'Surface — Lucky', target: surface('safe', { avoid: 'lucky' }) },
  {
    label: 'Surface — Resist (Thick Hide)',
    target: surface('safe', { avoid: 'resist', hasPerk: true }),
  },
  { label: 'Surface — Vines w/ Thick Hide', target: surface('vines', { hasPerk: true }) },
  ...Object.keys(DUNGEONS).map((b) => ({
    label: `Lair — ${DUNGEONS[b].hazardName} (${b})`,
    target: dungeon(b),
  })),
  { label: 'Lair — Lucky (city)', target: dungeon('city', { avoid: 'lucky' }) },
  {
    label: 'Lair — Resist (city, Thick Hide)',
    target: dungeon('city', { avoid: 'resist', hasPerk: true }),
  },
];

/**
 * Dev previewer for the two full-screen Undercity cinematics that are otherwise
 * gated behind rare game states: the Queen's Awakening gate, which fires once a
 * night when someone raises a third Sigil, and the hazard wheel, which needs you
 * to actually land on a hazard tile of the right kind.
 *
 * Spinning the same preset repeatedly is the point of the wheel section — the
 * wheel picks a random wedge bearing the true outcome, so the same result should
 * stop somewhere different each time while always landing on the right word.
 */
@Component({
  selector: 'app-undercity-cinematic-lab',
  standalone: true,
  imports: [CommonModule, GatesOpenComponent, HazardWheelComponent],
  template: `
    <div class="cine-lab">
      <section>
        <h3>The Queen's Awakening</h3>
        <p class="note">
          Shown to every player the tick a third Guild Sigil lands. Auto-dismisses;
          tap to skip.
        </p>
        <button class="pill primary" (click)="playGates()">Play gate cinematic</button>
      </section>

      <section>
        <h3>Hazard wheel</h3>
        <p class="note">
          Spin the same preset a few times: it should stop on a different wedge each
          time, and always on the word for the outcome named below.
        </p>
        <div class="grid">
          @for (p of presets; track p.label) {
            <button class="pill" (click)="spin(p)">{{ p.label }}</button>
          }
        </div>
      </section>
    </div>

    @if (gates()) {
      <app-undercity-gates-open (done)="gates.set(false)" />
    }
    <!-- Keyed on the spin nonce so re-picking the same preset re-mounts the
         wheel and runs a fresh spin instead of sitting on the settled one. -->
    @for (s of spinList(); track s.id) {
      <app-undercity-hazard-wheel [target]="s.target" (settled)="spinning.set(null)" />
    }
  `,
  styles: [
    `
      .cine-lab {
        display: flex;
        flex-direction: column;
        gap: 28px;
      }
      h3 {
        margin: 0 0 4px;
        font-size: 1rem;
        color: #e7dcff;
      }
      .note {
        margin: 0 0 12px;
        font-size: 0.82rem;
        color: #9d90b0;
        max-width: 44rem;
      }
      .grid {
        display: flex;
        flex-wrap: wrap;
        gap: 8px;
      }
      .pill {
        appearance: none;
        border: 1px solid rgba(167, 139, 250, 0.35);
        border-radius: 999px;
        background: rgba(167, 139, 250, 0.1);
        color: #e7dcff;
        padding: 8px 14px;
        font-size: 0.82rem;
        font-weight: 700;
        cursor: pointer;
      }
      .pill:hover {
        background: rgba(167, 139, 250, 0.22);
      }
      .pill.primary {
        background: #6d4aa8;
        border-color: #8b63d0;
      }
    `,
  ],
})
export class CinematicLabComponent {
  protected readonly presets = PRESETS;
  protected readonly gates = signal(false);
  /** The wheel currently up, with a nonce so repeat picks re-mount it. */
  protected readonly spinning = signal<{ id: number; target: HazardWheelTarget } | null>(null);
  private nonce = 0;

  /** The active spin as a 0-or-1 list so the template's keyed `@for` recreates
   *  the wheel node per id. */
  protected spinList(): { id: number; target: HazardWheelTarget }[] {
    const s = this.spinning();
    return s ? [s] : [];
  }

  protected playGates(): void {
    this.gates.set(false);
    // Re-mount on the next tick so replaying restarts the animation at frame 0.
    setTimeout(() => this.gates.set(true));
  }

  protected spin(p: Preset): void {
    this.spinning.set({ id: ++this.nonce, target: p.target });
  }
}
