import { Component, computed, inject, signal } from '@angular/core';
import { CommonModule } from '@angular/common';
import { UndercityStateService } from '../services/undercity-state.service';
import { STARTERS, TIER2, FormInfo, PASSIVE_BLURBS } from '../data/forms';
import { PAINTS, PAINT_MAP } from '../data/cosmetics';
import { getRecoloredDataUrl } from '../engine/sprite-engine';
import { formSprite } from '../data/species';

@Component({
  selector: 'app-undercity-hatch-flow',
  standalone: true,
  imports: [CommonModule],
  templateUrl: './hatch-flow.component.html',
  styleUrls: ['./hatch-flow.component.scss'],
})
export class HatchFlowComponent {
  protected readonly store = inject(UndercityStateService);

  protected readonly taps = signal(0);
  protected readonly hatched = computed(() => this.taps() >= 3);
  protected readonly eggHue = signal<number>(130);
  protected readonly joining = signal(false);
  protected readonly error = signal<string | null>(null);

  protected readonly starters = STARTERS;
  protected readonly paints = PAINTS;
  protected readonly passiveBlurbs = PASSIVE_BLURBS;

  protected readonly canPickShell = computed(() => (this.store.wardrobe()?.seals ?? 0) >= 1);
  protected readonly sealBonus = computed(() => Math.min(this.store.wardrobe()?.seals ?? 0, 3));

  tapEgg(): void {
    if (!this.hatched()) this.taps.set(this.taps() + 1);
  }

  pickShell(hue: number): void {
    this.eggHue.set(hue);
  }

  spriteUrl(starter: FormInfo): string | null {
    const spr = formSprite(starter.id);
    return getRecoloredDataUrl(
      spr.sprite,
      { body: this.eggHue(), belly: 50, stripes: this.eggHue(), spines: 50, spines_dark: this.eggHue() },
      spr.regions,
    );
  }

  evolutionPreview(starter: FormInfo): string {
    return TIER2.filter((f) => f.line === starter.id)
      .map((f) => f.name)
      .join(' / ');
  }

  paintName(hue: number): string {
    return PAINTS.find((p) => p.hue === hue)?.name ?? PAINT_MAP['forest'].name;
  }

  async choose(starter: FormInfo): Promise<void> {
    if (this.joining()) return;
    this.joining.set(true);
    this.error.set(null);
    try {
      await this.store.action('join', { starter: starter.id, eggHue: this.eggHue() });
    } catch (e) {
      this.error.set(e instanceof Error ? e.message : 'Could not hatch');
      this.joining.set(false);
    }
  }
}
