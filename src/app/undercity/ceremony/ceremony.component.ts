import { Component, Input, computed, signal } from '@angular/core';
import { CommonModule } from '@angular/common';
import { HallOfFameNight, SeasonResult, Standing } from '../services/undercity-models';
import { formSprite } from '../data/species';
import { getRecoloredDataUrl } from '../engine/sprite-engine';
import { HAT_MAP } from '../data/cosmetics';

/** End-of-night ceremony: champion center-stage, podium, full Renown table. */
@Component({
  selector: 'app-undercity-ceremony',
  standalone: true,
  imports: [CommonModule],
  templateUrl: './ceremony.component.html',
  styleUrls: ['./ceremony.component.scss'],
})
export class CeremonyComponent {
  private readonly _result = signal<SeasonResult | null>(null);
  @Input() set result(value: SeasonResult | null) {
    this._result.set(value);
  }
  @Input() hallOfFame: HallOfFameNight[] = [];

  protected readonly standings = computed(() => this._result()?.standings ?? []);
  protected readonly champion = computed(() => this._result()?.champion ?? null);
  protected readonly podium = computed(() => this.standings().slice(0, 3));
  protected readonly hatMap = HAT_MAP;

  spriteUrl(s: Standing): string | null {
    const spr = formSprite(s.form);
    return getRecoloredDataUrl(spr.sprite, s.paint ?? {}, spr.regions);
  }

  hatUrl(s: Standing): string | null {
    if (!s.hat || !HAT_MAP[s.hat]) return null;
    return `undercity/hats/${HAT_MAP[s.hat].file}`;
  }
}
